import { describe, expect, it } from "vitest";
import { categorise } from "../src/chain.js";
import { CATEGORY } from "../src/categories.js";
import { EMPTY_LOOKUPS } from "../src/types.js";
import type {
  CategoriseInput,
  DictionaryRecord,
  LlmCacheRecord,
  LookupContext,
  OverrideRecord,
} from "../src/types.js";

/** Build a LookupContext seeded with the rows a test wants present. */
function lookups(rows: {
  user?: OverrideRecord;
  tenant?: OverrideRecord;
  dictionary?: DictionaryRecord;
  llmCache?: LlmCacheRecord;
}): LookupContext {
  return {
    userOverride: () => rows.user,
    tenantOverride: () => rows.tenant,
    dictionary: () => rows.dictionary,
    llmCache: () => rows.llmCache,
  };
}

const base: CategoriseInput = {
  id: "t1",
  description: "THE DAILY GRIND 4821 SYDNEY AU",
  amount: -5.6,
  currency: "AUD",
  date: "2026-07-14",
  user_ref: "u1",
};

describe("signal chain — priority ordering (spec §4, first hit wins)", () => {
  it("exclusion beats every other tier", () => {
    const r = categorise(
      { ...base, description: "ATM WITHDRAWAL COMMBANK", mcc: "5411" },
      lookups({
        user: { category: CATEGORY.GROCERIES },
        dictionary: { category: CATEGORY.GROCERIES, confidence: 0.95 },
      }),
    );
    expect(r.source).toBe("exclusion");
    expect(r.category).toBe("transfer");
    expect(r.excluded).toBe(true);
    expect(r.confidence).toBe(1.0);
  });

  it("user override beats tenant override, MCC and dictionary", () => {
    const r = categorise(
      { ...base, mcc: "5541" },
      lookups({
        user: { category: CATEGORY.DINING_ENTERTAINMENT, classification: "discretionary" },
        tenant: { category: CATEGORY.GROCERIES },
        dictionary: { category: CATEGORY.GROCERIES, confidence: 0.95 },
      }),
    );
    expect(r.source).toBe("user_override");
    expect(r.category).toBe(CATEGORY.DINING_ENTERTAINMENT);
    expect(r.classification).toBe("discretionary");
    expect(r.confidence).toBe(1.0);
  });

  it("tenant override beats MCC and dictionary", () => {
    const r = categorise(
      { ...base, mcc: "5541" },
      lookups({
        tenant: { category: CATEGORY.GROCERIES },
        dictionary: { category: CATEGORY.DINING_ENTERTAINMENT, confidence: 0.9 },
      }),
    );
    expect(r.source).toBe("tenant_override");
    expect(r.category).toBe(CATEGORY.GROCERIES);
    expect(r.confidence).toBe(0.98);
  });

  it("MCC beats dictionary and LLM cache", () => {
    const r = categorise(
      { ...base, mcc: "5541" }, // fuel
      lookups({
        dictionary: { category: CATEGORY.GROCERIES, confidence: 0.95 },
        llmCache: { category: CATEGORY.GROCERIES, confidence: 0.9 },
      }),
    );
    expect(r.source).toBe("mcc");
    expect(r.category).toBe(CATEGORY.VEHICLE_RUNNING);
    expect(r.confidence).toBe(0.95);
  });

  it("dictionary beats rules and LLM cache when there is no MCC", () => {
    const r = categorise(
      base, // no mcc (statement-style)
      lookups({
        dictionary: { category: CATEGORY.DINING_ENTERTAINMENT, confidence: 0.92 },
        llmCache: { category: CATEGORY.GROCERIES, confidence: 0.9 },
      }),
    );
    expect(r.source).toBe("dictionary");
    expect(r.category).toBe(CATEGORY.DINING_ENTERTAINMENT);
    expect(r.confidence).toBe(0.92);
  });

  it("LLM cache is used only when confidence clears the trust threshold", () => {
    const trusted = categorise(
      base,
      lookups({ llmCache: { category: CATEGORY.DINING_ENTERTAINMENT, confidence: 0.7 } }),
    );
    expect(trusted.source).toBe("llm_cache");

    const untrusted = categorise(
      base,
      lookups({ llmCache: { category: CATEGORY.DINING_ENTERTAINMENT, confidence: 0.5 } }),
    );
    expect(untrusted.source).toBe("fallback"); // below 0.6 → not trusted, falls through
  });

  it("attaches low_confidence under the threshold but not above it", () => {
    const low = categorise(
      base,
      lookups({ dictionary: { category: CATEGORY.GROCERIES, confidence: 0.75 } }),
    );
    expect(low.flags).toContain("low_confidence");

    const high = categorise(
      base,
      lookups({ dictionary: { category: CATEGORY.GROCERIES, confidence: 0.9 } }),
    );
    expect(high.flags).not.toContain("low_confidence");
  });
});

describe("credits (spec §2 — v1 debits-only)", () => {
  it("returns uncategorised_credit, excluded, for a positive amount", () => {
    const r = categorise({ ...base, description: "SALARY ACME PTY LTD", amount: 4200 }, EMPTY_LOOKUPS);
    expect(r.source).toBe("credit");
    expect(r.category).toBe("uncategorised_credit");
    expect(r.excluded).toBe(true);
    expect(r.confidence).toBe(1.0);
    expect(r.classification).toBe("essential"); // taxonomy default, as for transfer
  });

  it("does not run the expense tiers for a credit (no override/MCC/dictionary wins)", () => {
    const r = categorise(
      { ...base, amount: 100, mcc: "5541", user_ref: "u1" },
      lookups({
        user: { category: CATEGORY.DINING_ENTERTAINMENT },
        dictionary: { category: CATEGORY.GROCERIES, confidence: 0.95 },
      }),
    );
    expect(r.source).toBe("credit");
  });

  it("an explicit transfer still wins over the credit branch", () => {
    const r = categorise({ ...base, description: "TRANSFER FROM SAVINGS", amount: 250 }, EMPTY_LOOKUPS);
    expect(r.source).toBe("exclusion");
    expect(r.category).toBe("transfer");
  });

  it("a debit (negative amount) is unaffected and reaches the normal tiers", () => {
    const r = categorise({ ...base, amount: -50, mcc: "5541" }, EMPTY_LOOKUPS);
    expect(r.source).toBe("mcc");
  });
});

describe("conservative fallback (spec §4 step 7, kickoff)", () => {
  it("returns other_expenses / essential / unverified for an unknown merchant", () => {
    const r = categorise({ ...base, description: "ZZZ UNKNOWN MERCHANT" }, EMPTY_LOOKUPS);
    expect(r.source).toBe("fallback");
    expect(r.category).toBe(CATEGORY.OTHER_EXPENSES);
    expect(r.classification).toBe("essential");
    expect(r.flags).toEqual(["unverified"]);
    expect(r.excluded).toBe(false);
  });

  it("the fallback path NEVER emits discretionary (forced essential)", () => {
    // Many distinct unknown merchants, all with no lookups and no MCC → fallback.
    for (let i = 0; i < 50; i++) {
      const r = categorise({ ...base, description: `UNKNOWN MERCHANT ${i}` }, EMPTY_LOOKUPS);
      expect(r.source).toBe("fallback");
      expect(r.classification).toBe("essential");
      expect(r.classification).not.toBe("discretionary");
    }
  });

  it("stamps engine and taxonomy versions on every result", () => {
    const r = categorise(base, EMPTY_LOOKUPS);
    expect(r.engine_version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(r.taxonomy_version).toBe("1");
    expect(r.merchant.match_key).toBe("the daily grind");
  });
});
