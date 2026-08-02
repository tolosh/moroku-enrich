import { describe, expect, it } from "vitest";
import { CategoriseRequestSchema, CorrectionsRequestSchema } from "../src/schemas.js";

describe("CategoriseRequestSchema (spec §3.1)", () => {
  it("accepts a valid batch", () => {
    const r = CategoriseRequestSchema.safeParse({
      transactions: [{ id: "1", description: "THE DAILY GRIND", amount: -5.6, mcc: "5814" }],
    });
    expect(r.success).toBe(true);
  });

  it("rejects an empty batch and a non-4-digit mcc", () => {
    expect(CategoriseRequestSchema.safeParse({ transactions: [] }).success).toBe(false);
    expect(
      CategoriseRequestSchema.safeParse({
        transactions: [{ id: "1", description: "X", amount: 1, mcc: "58" }],
      }).success,
    ).toBe(false);
  });

  it("rejects a batch over 1000", () => {
    const transactions = Array.from({ length: 1001 }, (_, i) => ({
      id: String(i),
      description: "X",
      amount: -1,
    }));
    expect(CategoriseRequestSchema.safeParse({ transactions }).success).toBe(false);
  });
});

describe("CorrectionsRequestSchema (spec §3.2)", () => {
  it("applies scope_hint and actor defaults", () => {
    const r = CorrectionsRequestSchema.parse({
      corrections: [
        { description: "THE DAILY GRIND", user_ref: "u1", corrected_category: "dining_entertainment" },
      ],
    });
    expect(r.corrections[0]!.scope_hint).toBe("merchant");
    expect(r.corrections[0]!.actor).toBe("consumer");
  });

  it("requires corrected_category and user_ref", () => {
    expect(
      CorrectionsRequestSchema.safeParse({
        corrections: [{ description: "X", corrected_category: "groceries" }],
      }).success,
    ).toBe(false);
    expect(
      CorrectionsRequestSchema.safeParse({
        corrections: [{ description: "X", user_ref: "u1" }],
      }).success,
    ).toBe(false);
  });
});
