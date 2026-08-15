/**
 * ext-006 — income recognition + savings subtyping + the two new expense
 * categories. Every behaviour delta against engine 1.2.0 is pinned here.
 */
import { describe, expect, it } from "vitest";
import { categorise } from "../src/chain.js";
import { CATEGORY, NON_EXPENSE } from "../src/categories.js";
import { EMPTY_LOOKUPS } from "../src/types.js";
import type { CategoriseInput } from "../src/types.js";
import { INCOME_CONFIDENCE } from "../src/income.js";
import { normaliseMerchant } from "../src/normaliser.js";
import { isExplicitSavingsMovement, resolveSavingsOutcome } from "../src/savings.js";

const base: CategoriseInput = {
  id: "t1",
  currency: "AUD",
  date: "2026-07-14",
  user_ref: "u1",
  description: "",
};

function run(description: string, extra: Partial<CategoriseInput> = {}) {
  return categorise({ ...base, description, amount: -10, ...extra }, EMPTY_LOOKUPS);
}

// ---------------------------------------------------------------------------
// Income
// ---------------------------------------------------------------------------

describe("ext-006 — income recognition (spec §2, pulled forward)", () => {
  it("recognises salary/payroll/wage credits as income, excluded", () => {
    for (const desc of [
      "SALARY ACME PTY LTD",
      "ACME PAYROLL",
      "PAYRUN JUL",
      "WAGES FORTNIGHTLY",
    ]) {
      const r = run(desc, { amount: 4200 });
      expect(r.source, desc).toBe("income");
      expect(r.category, desc).toBe(NON_EXPENSE.INCOME);
      expect(r.excluded, desc).toBe(true);
      expect(r.confidence, desc).toBe(INCOME_CONFIDENCE);
    }
  });

  it("recognises the named benefit agencies", () => {
    for (const desc of ["CENTRELINK BENEFIT", "SERVICES AUSTRALIA", "AGE PENSION"]) {
      expect(run(desc, { amount: 900 }).category, desc).toBe(NON_EXPENSE.INCOME);
    }
  });

  it("matches agency cues the normaliser would have destroyed", () => {
    // Regression: normaliseMerchant("SERVICES AUSTRALIA") === "services",
    // because the normaliser strips trailing location tokens. Matching the raw
    // description as well as the key is what keeps place-name cues reachable.
    expect(normaliseMerchant("SERVICES AUSTRALIA").match_key).toBe("services");
    expect(run("SERVICES AUSTRALIA", { amount: 900 }).source).toBe("income");
  });

  it("still matches via source_category_description alone", () => {
    const r = run("ACME PTY LTD", {
      amount: 4200,
      source_category_description: "Salary and wages",
    });
    expect(r.source).toBe("income");
  });

  it("income clears the low-confidence threshold — no flag", () => {
    const r = run("SALARY ACME PTY LTD", { amount: 4200 });
    expect(r.flags).toEqual([]);
  });

  it("leaves an unrecognised credit as uncategorised_credit (recognition is additive)", () => {
    for (const desc of ["REFUND ZZZ MERCHANT", "DIRECT CREDIT 12345", "DEPOSIT"]) {
      const r = run(desc, { amount: 500 });
      expect(r.source, desc).toBe("credit");
      expect(r.category, desc).toBe(NON_EXPENSE.UNCATEGORISED_CREDIT);
    }
  });

  it("never recognises income on a DEBIT — a salary-sacrifice outflow is not income", () => {
    const r = run("SALARY SACRIFICE SUPER", { amount: -500 });
    expect(r.source).not.toBe("income");
    expect(r.category).not.toBe(NON_EXPENSE.INCOME);
  });

  it("an exclusion still outranks income (a transfer described as salary is a transfer)", () => {
    const r = run("TRANSFER SALARY ACCT", { amount: 4200 });
    expect(r.source).toBe("exclusion");
    expect(r.category).toBe(NON_EXPENSE.TRANSFER);
  });
});

// ---------------------------------------------------------------------------
// Savings
// ---------------------------------------------------------------------------

describe("ext-006 — savings subtyping", () => {
  it("direction comes from the DESCRIPTION when the row is not the savings account", () => {
    // -500 on a transaction account, "to savings" = money INTO savings.
    // The sign is the counterparty's view and must not decide direction.
    const deposit = run("TRANSFER TO SAVINGS", { amount: -500 });
    expect(deposit.source).toBe("savings");
    expect(deposit.category).toBe(NON_EXPENSE.SAVINGS_DEPOSIT);

    const withdrawal = run("TRANSFER FROM SAVINGS", { amount: 250 });
    expect(withdrawal.source).toBe("savings");
    expect(withdrawal.category).toBe(NON_EXPENSE.SAVINGS_WITHDRAWAL);
  });

  it("direction comes from the SIGN when the row IS the savings account", () => {
    const deposit = run("TFR", { amount: 500, account_type: "savings" });
    expect(deposit.category).toBe(NON_EXPENSE.SAVINGS_DEPOSIT);

    const withdrawal = run("TFR", { amount: -500, account_type: "savings" });
    expect(withdrawal.category).toBe(NON_EXPENSE.SAVINGS_WITHDRAWAL);
  });

  it("catches a savings deposit the exclusion patterns miss (no TRANSFER/TFR token)", () => {
    const r = run("AUTO SAVE TO SAVINGS", { amount: -50 });
    expect(r.source).toBe("savings");
    expect(r.category).toBe(NON_EXPENSE.SAVINGS_DEPOSIT);
  });

  it("account_type alone NEVER promotes an ordinary transaction to a savings movement", () => {
    // The regression this guards: booking every card purchase made from a
    // savings account as a deposit/withdrawal.
    const purchase = run("WOOLWORTHS METRO", { amount: -84.2, account_type: "savings" });
    expect(purchase.source).toBe("rules");
    expect(purchase.category).toBe(CATEGORY.GROCERIES);

    const interest = run("CREDIT INTEREST PAID", { amount: 3.11, account_type: "savings" });
    expect(interest.source).toBe("credit");
    expect(interest.category).toBe(NON_EXPENSE.UNCATEGORISED_CREDIT);
  });

  it("a directionless savings transfer stays `transfer` — no guessing", () => {
    const r = run("SAVINGS TFR", { amount: -100 });
    expect(r.source).toBe("exclusion");
    expect(r.category).toBe(NON_EXPENSE.TRANSFER);
  });

  it("non-savings exclusions are untouched", () => {
    for (const desc of ["ATM WITHDRAWAL COMMBANK", "PAYPAL TRANSFER", "CASH ADVANCE"]) {
      const r = run(desc);
      expect(r.source, desc).toBe("exclusion");
      expect(r.category, desc).toBe(NON_EXPENSE.TRANSFER);
    }
  });

  it("savings outcomes stay excluded, so no spend denominator moves", () => {
    for (const desc of ["TRANSFER TO SAVINGS", "TRANSFER FROM SAVINGS"]) {
      expect(run(desc, { amount: -100 }).excluded, desc).toBe(true);
    }
  });

  it("a merchant that merely contains a savings word is not a savings movement", () => {
    expect(isExplicitSavingsMovement({ description: "SAVERS PLUS PHARMACY" })).toBe(false);
    expect(resolveSavingsOutcome({ description: "SAVERS PLUS PHARMACY" })).toBeUndefined();
    const r = run("SAVERS PLUS PHARMACY", { amount: -22 });
    expect(r.category).toBe(CATEGORY.HEALTHCARE);
  });
});

// ---------------------------------------------------------------------------
// New expense categories
// ---------------------------------------------------------------------------

describe("ext-006 — bnpl and general_retail", () => {
  it("BNPL brands resolve to bnpl / financial_commitment", () => {
    for (const desc of ["AFTERPAY INSTALMENT", "ZIP PAY", "KLARNA AU", "HUMM PAYMENT"]) {
      const r = run(desc);
      expect(r.category, desc).toBe(CATEGORY.BNPL);
      expect(r.classification, desc).toBe("financial_commitment");
    }
  });

  it("the ZIP * gateway prefix is still a purchase, not a BNPL repayment", () => {
    // The normaliser strips `ZIP *`, so this is the underlying merchant.
    const r = run("ZIP *WOOLWORTHS METRO");
    expect(r.category).toBe(CATEGORY.GROCERIES);
  });

  it("retail MCCs resolve to general_retail with the classification unchanged", () => {
    for (const mcc of ["5311", "5399", "5999", "5732"]) {
      const r = run("SOME RETAILER", { mcc });
      expect(r.source, mcc).toBe("mcc");
      expect(r.category, mcc).toBe(CATEGORY.GENERAL_RETAIL);
      expect(r.classification, mcc).toBe("discretionary");
    }
  });

  it("other_expenses keeps travel, personal care, services and government", () => {
    for (const mcc of ["7011", "7230", "7311", "9211"]) {
      expect(run("SOMETHING", { mcc }).category, mcc).toBe(CATEGORY.OTHER_EXPENSES);
    }
  });
});

// ---------------------------------------------------------------------------
// Kill switch
// ---------------------------------------------------------------------------

describe("ext-006 — incomeSavingsEnabled:false restores 1.2.0 outcomes exactly", () => {
  const off = { incomeSavingsEnabled: false };

  it("credits go back to uncategorised_credit", () => {
    const r = categorise(
      { ...base, description: "SALARY ACME PTY LTD", amount: 4200 },
      EMPTY_LOOKUPS,
      off,
    );
    expect(r.source).toBe("credit");
    expect(r.category).toBe(NON_EXPENSE.UNCATEGORISED_CREDIT);
  });

  it("savings movements go back to plain transfer", () => {
    const r = categorise(
      { ...base, description: "TRANSFER TO SAVINGS", amount: -500 },
      EMPTY_LOOKUPS,
      off,
    );
    expect(r.source).toBe("exclusion");
    expect(r.category).toBe(NON_EXPENSE.TRANSFER);
  });

  it("a non-exclusion savings deposit falls through to the expense tiers when off", () => {
    // "AUTO SAVE TO SAVINGS" has no TRANSFER/TFR token, so with the tier off it
    // is not an exclusion at all — it must not be silently swallowed.
    const r = categorise(
      { ...base, description: "AUTO SAVE TO SAVINGS", amount: -50 },
      EMPTY_LOOKUPS,
      off,
    );
    expect(r.source).toBe("fallback");
  });

  it("the new expense categories are unaffected by the switch (taxonomy, not tier)", () => {
    const r = categorise({ ...base, description: "AFTERPAY", amount: -30 }, EMPTY_LOOKUPS, off);
    expect(r.category).toBe(CATEGORY.BNPL);
  });
});
