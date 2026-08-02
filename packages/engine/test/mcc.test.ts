import { describe, expect, it } from "vitest";
import { CATEGORY } from "../src/categories.js";
import { lookupMcc, MCC_TABLE, MCC_CONFIDENCE } from "../src/mcc.js";

describe("MCC table (spec §4 step 3)", () => {
  it("maps fuel 5541/5542 → vehicle_running at confidence 0.95 (kickoff priority cue)", () => {
    for (const code of ["5541", "5542"]) {
      const hit = lookupMcc(code);
      expect(hit).toEqual({ category: CATEGORY.VEHICLE_RUNNING, confidence: 0.95 });
    }
    expect(MCC_CONFIDENCE).toBe(0.95);
  });

  it("maps restaurant + cinema MCCs → dining_entertainment", () => {
    expect(lookupMcc("5812")?.category).toBe(CATEGORY.DINING_ENTERTAINMENT);
    expect(lookupMcc("7832")?.category).toBe(CATEGORY.DINING_ENTERTAINMENT); // cinema
  });

  it("maps supermarket 5411 → groceries", () => {
    expect(lookupMcc("5411")?.category).toBe(CATEGORY.GROCERIES);
  });

  it("returns undefined for unknown or missing MCCs", () => {
    expect(lookupMcc("0000")).toBeUndefined();
    expect(lookupMcc(undefined)).toBeUndefined();
    expect(lookupMcc("")).toBeUndefined();
  });

  it("trims whitespace before lookup", () => {
    expect(lookupMcc(" 5541 ")?.category).toBe(CATEGORY.VEHICLE_RUNNING);
  });

  it("never maps one MCC to two categories (table built without collisions)", () => {
    // Construction throws on a duplicate; reaching here means the table is clean.
    expect(MCC_TABLE.size).toBeGreaterThan(50);
  });
});
