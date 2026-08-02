import { describe, expect, it } from "vitest";
import { EXPENSE_CATEGORIES, isValidCategory } from "@moroku-enrich/taxonomy";
import {
  CATEGORY,
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
  });
});

describe("placeholder ↔ taxonomy reconciliation tripwire (ext-002 §6.1)", () => {
  it("fully reconciles — no pending sentinels, no invalid bindings", () => {
    expect(EXPENSE_CATEGORIES.length).toBe(15);
    const { pending, invalid } = reconcileCategories();
    expect(pending).toEqual([]);
    expect(invalid).toEqual([]);
  });
});
