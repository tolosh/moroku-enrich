import { describe, expect, it } from "vitest";
import {
  buildUserPrompt,
  categoryMenu,
  isExpenseCategory,
  parseClassification,
} from "../src/classify.js";

describe("classifier prompt (merchant-string-only)", () => {
  it("includes the merchant key and the real category ids", () => {
    const p = buildUserPrompt("the boathouse palm beach");
    expect(p).toContain("the boathouse palm beach");
    expect(categoryMenu()).toContain("dining_entertainment");
    expect(categoryMenu()).toContain("other_expenses");
  });
});

describe("parseClassification (hallucination guard)", () => {
  it("parses strict JSON and clamps confidence", () => {
    expect(parseClassification('{"category":"dining_entertainment","confidence":0.82}')).toEqual({
      category: "dining_entertainment",
      confidence: 0.82,
    });
    expect(parseClassification('{"category":"groceries","confidence":1.4}')?.confidence).toBe(1);
  });

  it("extracts JSON even with surrounding prose", () => {
    const r = parseClassification('Sure! {"category":"healthcare","confidence":0.7} hope that helps');
    expect(r).toEqual({ category: "healthcare", confidence: 0.7 });
  });

  it("rejects a non-expense / hallucinated category", () => {
    expect(parseClassification('{"category":"transfer","confidence":0.9}')).toBeUndefined();
    expect(parseClassification('{"category":"space_travel","confidence":0.9}')).toBeUndefined();
  });

  it("rejects unparseable output", () => {
    expect(parseClassification("no json here")).toBeUndefined();
    expect(parseClassification('{"category":"groceries"}')).toBeUndefined(); // no confidence
  });

  it("only expense categories are choosable (transfer/credit excluded)", () => {
    expect(isExpenseCategory("groceries")).toBe(true);
    expect(isExpenseCategory("subscriptions")).toBe(true);
    expect(isExpenseCategory("transfer")).toBe(false);
    expect(isExpenseCategory("uncategorised_credit")).toBe(false);
  });
});
