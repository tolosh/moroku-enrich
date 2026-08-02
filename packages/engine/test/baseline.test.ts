import { describe, expect, it } from "vitest";
import { categorise } from "../src/chain.js";
import { CATEGORY } from "../src/categories.js";
import { EMPTY_LOOKUPS } from "../src/types.js";
import type { CategoriseInput } from "../src/types.js";

/** Statement-style debit (no MCC) through the full chain. */
function run(description: string, extra: Partial<CategoriseInput> = {}) {
  return categorise({ description, amount: -10, ...extra }, EMPTY_LOOKUPS);
}

describe("Kanopi baseline regression — full chain (ext-002 §4)", () => {
  it("COLES EXPRESS 5512 FUEL → vehicle_running (P1 fuel beats groceries)", () => {
    const r = run("COLES EXPRESS 5512 FUEL");
    expect(r.category).toBe(CATEGORY.VEHICLE_RUNNING);
    expect(r.source).toBe("rules");
  });

  it("7-ELEVEN 4102 BURNLEY FUEL → vehicle_running", () => {
    expect(run("7-ELEVEN 4102 BURNLEY FUEL").category).toBe(CATEGORY.VEHICLE_RUNNING);
  });

  it("WOOLWORTHS PETROL RICHMOND → vehicle_running (petrol cue beats groceries)", () => {
    expect(run("WOOLWORTHS PETROL RICHMOND").category).toBe(CATEGORY.VEHICLE_RUNNING);
  });

  it("COLES 0234 RICHMOND → groceries (no cue; rule 4)", () => {
    const r = run("COLES 0234 RICHMOND");
    expect(r.category).toBe(CATEGORY.GROCERIES);
    expect(r.source).toBe("rules");
  });

  it("cinema chains → dining_entertainment", () => {
    for (const name of [
      "VILLAGE CINEMAS",
      "HOYTS",
      "EVENT CINEMAS",
      "TICKETEK",
      "TICKETMASTER",
    ]) {
      expect(run(name).category, name).toBe(CATEGORY.DINING_ENTERTAINMENT);
    }
  });

  it("MCC outranks the rules tier (5541 fuel MCC wins even without a fuel word)", () => {
    const r = run("COLES EXPRESS 123", { mcc: "5541" });
    expect(r.source).toBe("mcc");
    expect(r.category).toBe(CATEGORY.VEHICLE_RUNNING);
  });

  it("exclusions outrank everything", () => {
    const r = run("ATM WITHDRAWAL COLES", { mcc: "5411" });
    expect(r.source).toBe("exclusion");
    expect(r.excluded).toBe(true);
  });

  it("rule hits carry the category's taxonomy default classification", () => {
    // subscriptions default = discretionary; loan_repayment = financial_commitment.
    expect(run("NETFLIX.COM").classification).toBe("discretionary");
    expect(run("AFTERPAY INSTALMENT").classification).toBe("financial_commitment");
  });
});
