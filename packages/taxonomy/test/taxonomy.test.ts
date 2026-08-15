import { describe, expect, it } from "vitest";
import {
  CLASSIFICATIONS,
  EXPECTED_EXPENSE_CATEGORY_COUNT,
  EXPENSE_CATEGORIES,
  NON_EXPENSE_OUTCOMES,
  TAXONOMY_VERSION,
  allCategories,
  defaultClassificationFor,
  getCategory,
  isValidClassification,
  taxonomyDocument,
} from "../src/index.js";

describe("taxonomy v1 — frozen invariants (spec §2)", () => {
  it("has exactly the three v1 classifications", () => {
    expect([...CLASSIFICATIONS]).toEqual([
      "essential",
      "discretionary",
      "financial_commitment",
    ]);
  });

  it("is version 1.1 — additive within major 1 (ext-006)", () => {
    expect(TAXONOMY_VERSION).toBe("1.1");
    // The major must not have moved: ext-006 renames, removes and
    // re-classifies nothing.
    expect(TAXONOMY_VERSION.split(".")[0]).toBe("1");
  });

  it("includes the additive non-expense outcomes named in the spec", () => {
    const ids = NON_EXPENSE_OUTCOMES.map((c) => c.id);
    expect(ids).toContain("transfer");
    expect(ids).toContain("uncategorised_credit");
    // ext-006
    expect(ids).toContain("income");
    expect(ids).toContain("savings_deposit");
    expect(ids).toContain("savings_withdrawal");
  });

  it("marks every non-expense outcome as excluded — none of them are spend", () => {
    for (const c of NON_EXPENSE_OUTCOMES) {
      expect(c.excluded, c.id).toBe(true);
      expect(c.kind, c.id).toBe("non_expense");
    }
    expect(getCategory("transfer")?.excluded).toBe(true);
    // ext-006 deviation 1: uncategorised_credit was `false` here while the
    // chain forced `true`, so a user override to it counted as spend.
    expect(getCategory("uncategorised_credit")?.excluded).toBe(true);
    expect(getCategory("income")?.excluded).toBe(true);
  });

  it("validates classifications", () => {
    expect(isValidClassification("essential")).toBe(true);
    expect(isValidClassification("nonsense")).toBe(false);
  });

  it("resolves default classifications for known categories", () => {
    expect(defaultClassificationFor("transfer")).toBe("essential");
    expect(defaultClassificationFor("does-not-exist")).toBeUndefined();
  });

  it("serves a well-formed taxonomy document", () => {
    const doc = taxonomyDocument();
    expect(doc.taxonomy_version).toBe("1.1");
    expect(doc.categories).toEqual(allCategories());
  });
});

describe("taxonomy v1 — expense category list (decision §9.1, ext-002 §0)", () => {
  it(`has exactly ${EXPECTED_EXPENSE_CATEGORY_COUNT} expense categories (15 verbatim + 2 ext-006)`, () => {
    expect(EXPENSE_CATEGORIES.length).toBe(EXPECTED_EXPENSE_CATEGORY_COUNT);
    expect(EXPENSE_CATEGORIES.length).toBe(17);
  });

  it("preserves the 15 verbatim Kanopi ids unchanged (ext-002 §1 still holds)", () => {
    // The ext-006 guarantee: additive only. Every original id is still present
    // with its original default classification.
    const byId = Object.fromEntries(
      EXPENSE_CATEGORIES.map((c) => [c.id, c.default_classification]),
    );
    const verbatim = {
      mortgage: "financial_commitment",
      rent: "financial_commitment",
      loan_repayment: "financial_commitment",
      groceries: "essential",
      utilities: "essential",
      vehicle_running: "essential",
      transport: "essential",
      insurance: "essential",
      strata: "essential",
      education: "essential",
      subscriptions: "discretionary",
      dining_entertainment: "discretionary",
      clothing: "discretionary",
      healthcare: "essential",
      other_expenses: "discretionary",
    } as const;
    for (const [id, classification] of Object.entries(verbatim)) {
      expect(byId[id], id).toBe(classification);
    }
    expect(Object.keys(verbatim).length).toBe(15);
  });

  it("has the exact ids and default classifications (ext-002 §1 + ext-006)", () => {
    const byId = Object.fromEntries(
      EXPENSE_CATEGORIES.map((c) => [c.id, c.default_classification]),
    );
    expect(byId).toEqual({
      mortgage: "financial_commitment",
      rent: "financial_commitment",
      loan_repayment: "financial_commitment",
      groceries: "essential",
      utilities: "essential",
      vehicle_running: "essential",
      transport: "essential",
      insurance: "essential",
      strata: "essential",
      education: "essential",
      subscriptions: "discretionary",
      dining_entertainment: "discretionary",
      clothing: "discretionary",
      healthcare: "essential",
      other_expenses: "discretionary",
      // ext-006
      bnpl: "financial_commitment",
      general_retail: "discretionary",
    });
  });

  it("every expense category is a real, valid classification", () => {
    for (const c of EXPENSE_CATEGORIES) {
      expect(isValidClassification(c.default_classification)).toBe(true);
      expect(c.kind).toBe("expense");
      expect(c.excluded).toBe(false);
    }
  });
});
