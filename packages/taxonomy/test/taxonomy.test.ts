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

  it("is version 1", () => {
    expect(TAXONOMY_VERSION).toBe("1");
  });

  it("includes the additive non-expense outcomes named in the spec", () => {
    const ids = NON_EXPENSE_OUTCOMES.map((c) => c.id);
    expect(ids).toContain("transfer");
    expect(ids).toContain("uncategorised_credit");
  });

  it("marks transfer as excluded", () => {
    expect(getCategory("transfer")?.excluded).toBe(true);
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
    expect(doc.taxonomy_version).toBe("1");
    expect(doc.categories).toEqual(allCategories());
  });
});

describe("taxonomy v1 — expense category list (decision §9.1, ext-002 §0)", () => {
  it(`has exactly the ${EXPECTED_EXPENSE_CATEGORY_COUNT} verbatim Kanopi expense categories`, () => {
    expect(EXPENSE_CATEGORIES.length).toBe(EXPECTED_EXPENSE_CATEGORY_COUNT);
    expect(EXPENSE_CATEGORIES.length).toBe(15);
  });

  it("has the exact verbatim ids and default classifications (ext-002 §1)", () => {
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
