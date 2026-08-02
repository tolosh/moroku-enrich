import { describe, expect, it } from "vitest";
import { EXPENSE_CATEGORIES } from "@moroku-enrich/taxonomy";
import {
  CATEGORY,
  ALL_PLACEHOLDER_CATEGORIES,
  isPendingCategory,
  reconcileCategories,
} from "../src/categories.js";

describe("placeholder category registry (decision §9.1)", () => {
  it("binds the ids given directly by the spec/kickoff (not invented)", () => {
    expect(CATEGORY.OTHER_EXPENSES).toBe("other_expenses");
    expect(CATEGORY.VEHICLE_RUNNING).toBe("vehicle_running");
    expect(CATEGORY.DINING_ENTERTAINMENT).toBe("dining_entertainment");
    expect(CATEGORY.GROCERIES).toBe("groceries");
    for (const bound of [
      CATEGORY.OTHER_EXPENSES,
      CATEGORY.VEHICLE_RUNNING,
      CATEGORY.DINING_ENTERTAINMENT,
      CATEGORY.GROCERIES,
    ]) {
      expect(isPendingCategory(bound)).toBe(false);
    }
  });

  it("marks not-yet-known concepts as unmistakable pending sentinels", () => {
    expect(isPendingCategory(CATEGORY.UTILITIES)).toBe(true);
    expect(isPendingCategory(CATEGORY.HEALTH_MEDICAL)).toBe(true);
    // A pending value must never look like a plausible real category id.
    expect(CATEGORY.UTILITIES.startsWith("__pending__:")).toBe(true);
  });

  it("exposes every registry value for reconciliation", () => {
    expect(ALL_PLACEHOLDER_CATEGORIES).toContain("other_expenses");
    expect(ALL_PLACEHOLDER_CATEGORIES.length).toBe(Object.keys(CATEGORY).length);
  });
});

describe("placeholder ↔ taxonomy reconciliation guard (decision §9.1)", () => {
  if (EXPENSE_CATEGORIES.length === 0) {
    // Blocked input: the verbatim 16-list has not landed. The bound ids are not
    // yet in the taxonomy and several concepts are still pending — expected.
    it("still has unresolved placeholders while EXPENSE_CATEGORIES is empty", () => {
      expect(reconcileCategories().pending.length).toBeGreaterThan(0);
    });
    it.todo(
      "every placeholder reconciles to a real category id once EXPENSE_CATEGORIES lands",
    );
  } else {
    // Flips on automatically when the taxonomy is populated: prove nothing was
    // left pending and every bound value is a real category id.
    it("fully reconciles — no pending sentinels, no invalid bindings", () => {
      const { pending, invalid } = reconcileCategories();
      expect(pending).toEqual([]);
      expect(invalid).toEqual([]);
    });
  }
});
