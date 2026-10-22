import { describe, expect, it } from "vitest";
import { EXPENSE_CATEGORIES, isValidCategory } from "@moroku-enrich/taxonomy";
import {
  CATEGORY,
  NON_EXPENSE,
  ALL_PLACEHOLDER_CATEGORIES,
  isPendingCategory,
  reconcileCategories,
} from "../src/categories.js";

describe("category registry (decision §9.1, reconciled by ext-002)", () => {
  it("binds every constant to a real taxonomy id — no pending sentinels remain", () => {
    for (const value of ALL_PLACEHOLDER_CATEGORIES) {
      expect(isPendingCategory(value)).toBe(false);
      expect(isValidCategory(value)).toBe(true);
    }
  });

  it("covers the given anchors", () => {
    expect(CATEGORY.OTHER_EXPENSES).toBe("other_expenses");
    expect(CATEGORY.VEHICLE_RUNNING).toBe("vehicle_running");
    expect(CATEGORY.DINING_ENTERTAINMENT).toBe("dining_entertainment");
    expect(CATEGORY.GROCERIES).toBe("groceries");
    expect(CATEGORY.RENT).toBe("rent");
    expect(CATEGORY.HEALTHCARE).toBe("healthcare");
    // ext-007 (ENR-24)
    expect(CATEGORY.SACC_LOAN).toBe("sacc_loan");
    expect(CATEGORY.WAGE_ADVANCE).toBe("wage_advance");
    expect(CATEGORY.DEBT_COLLECTION).toBe("debt_collection");
    expect(CATEGORY.FINES_PENALTIES).toBe("fines_penalties");
    // ext-008 (ENR-25) — gambling in CATEGORY, crypto in NON_EXPENSE
    expect(CATEGORY.GAMBLING_WAGERING).toBe("gambling_wagering");
    expect(CATEGORY.GAMBLING_CASINO).toBe("gambling_casino");
    expect(CATEGORY.GAMBLING_LOTTERY).toBe("gambling_lottery");
    expect(CATEGORY.QUASI_CASH).toBe("quasi_cash");
    expect(NON_EXPENSE.CRYPTO_EXCHANGE).toBe("crypto_exchange");
    expect(NON_EXPENSE.CRYPTO_ATM).toBe("crypto_atm");
  });
});

describe("placeholder ↔ taxonomy reconciliation tripwire (ext-002 §6.1)", () => {
  it("fully reconciles — no pending sentinels, no invalid bindings", () => {
    expect(EXPENSE_CATEGORIES.length).toBe(25); // 15 verbatim + 2 (ext-006) + 4 (ext-007) + 4 (ext-008)
    const { pending, invalid } = reconcileCategories();
    expect(pending).toEqual([]);
    expect(invalid).toEqual([]);
  });
});
