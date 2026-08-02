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

describe("taxonomy v1 — expense category list (decision §9.1)", () => {
  // Enabled once the 16 Kanopi categories are lifted verbatim from their code.
  // Kept as `todo` so the suite stays green while the list is outstanding, but
  // the outstanding work stays visible in every test run.
  it.todo(
    `has the ${EXPECTED_EXPENSE_CATEGORY_COUNT} Kanopi expense categories (populate EXPENSE_CATEGORIES first)`,
  );

  it("does not (yet) invent any category names", () => {
    // Guard against accidental invention: until the real list lands, the
    // expense registry must stay empty. Flip this to `toBe(16)` when populated.
    expect(EXPENSE_CATEGORIES.length).toBe(0);
  });
});
