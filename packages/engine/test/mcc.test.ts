import { describe, expect, it } from "vitest";
import { isValidCategory } from "@moroku-enrich/taxonomy";
import { CATEGORY } from "../src/categories.js";
import { lookupMcc, MCC_TABLE, MCC_CONFIDENCE } from "../src/mcc.js";

describe("MCC table (spec §4 step 3; completed ext-002 §5)", () => {
  it("maps fuel 5541/5542 → vehicle_running at confidence 0.95 (kickoff priority cue)", () => {
    for (const code of ["5541", "5542"]) {
      expect(lookupMcc(code)).toEqual({ category: CATEGORY.VEHICLE_RUNNING, confidence: 0.95 });
    }
    expect(MCC_CONFIDENCE).toBe(0.95);
  });

  it("maps the ext-002 §5 anchors to real taxonomy ids", () => {
    const anchors: Record<string, string> = {
      "5411": CATEGORY.GROCERIES,
      "5812": CATEGORY.DINING_ENTERTAINMENT,
      "5912": CATEGORY.HEALTHCARE,
      "5651": CATEGORY.CLOTHING,
      "5691": CATEGORY.CLOTHING,
      "4900": CATEGORY.UTILITIES,
      "6300": CATEGORY.INSURANCE,
      "4111": CATEGORY.TRANSPORT,
      "4121": CATEGORY.TRANSPORT,
      "4131": CATEGORY.TRANSPORT,
      "7011": CATEGORY.OTHER_EXPENSES, // lodging (deviation 4)
      "8211": CATEGORY.EDUCATION,
      "8220": CATEGORY.EDUCATION,
      "8299": CATEGORY.EDUCATION,
      "6513": CATEGORY.RENT,
    };
    for (const [code, category] of Object.entries(anchors)) {
      expect(lookupMcc(code)?.category).toBe(category);
    }
  });

  it("every row targets a real taxonomy id (ext-002 §6.4)", () => {
    for (const [code, category] of MCC_TABLE.entries()) {
      expect(isValidCategory(category), `MCC ${code} → ${category}`).toBe(true);
    }
  });

  it("returns undefined for unknown or missing MCCs and trims whitespace", () => {
    expect(lookupMcc("0000")).toBeUndefined();
    expect(lookupMcc(undefined)).toBeUndefined();
    expect(lookupMcc(" 5541 ")?.category).toBe(CATEGORY.VEHICLE_RUNNING);
  });
});
