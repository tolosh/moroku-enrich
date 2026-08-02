import { describe, expect, it } from "vitest";
import type { EnrichResult, Source } from "@moroku-enrich/engine";
import { summarise } from "../src/summary.js";

function result(source: Source, confidence: number): EnrichResult {
  return {
    category: "x",
    classification: "essential",
    confidence,
    source,
    excluded: false,
    flags: [],
    merchant: { match_key: "x", canonical_name: "X", normalised_from: "X" },
    engine_version: "1.0.0",
    taxonomy_version: "1",
  };
}

describe("summarise (spec §3.1)", () => {
  it("computes count, confident_pct (≥ 0.8) and by_source mix", () => {
    const s = summarise([
      result("mcc", 0.95),
      result("dictionary", 0.9),
      result("rules", 0.7),
      result("fallback", 0.3),
    ]);
    expect(s.count).toBe(4);
    expect(s.confident_pct).toBe(0.5); // 2 of 4 at ≥ 0.8
    expect(s.by_source).toEqual({ mcc: 1, dictionary: 1, rules: 1, fallback: 1 });
  });

  it("is zero-safe on an empty batch", () => {
    expect(summarise([])).toEqual({ count: 0, confident_pct: 0, by_source: {} });
  });
});
