import { describe, expect, it } from "vitest";
import { applyRules, RULES } from "../src/rules.js";
import { CATEGORY } from "../src/categories.js";
import type { CategoriseInput } from "../src/types.js";

/** Apply the rules chain to a normalised key (+ optional code / source desc). */
function ruleFor(key: string, opts: { code?: string; scd?: string } = {}) {
  const merchant = { match_key: key, canonical_name: "", normalised_from: "" };
  const input: CategoriseInput = {
    description: "",
    ...(opts.code ? { source_category_code: opts.code } : {}),
    ...(opts.scd ? { source_category_description: opts.scd } : {}),
  };
  return applyRules(merchant, input);
}

describe("merged rules chain — deviations (ext-002 §3, each pinned)", () => {
  it("D1: word boundaries — 'current account fee' is NOT rent or education", () => {
    const hit = ruleFor("current account fee");
    expect(hit).toBeUndefined();
  });

  it("D2: bare 'fees' removed from education", () => {
    expect(ruleFor("annual card fee")).toBeUndefined();
    expect(ruleFor("school fees term 3")?.category).toBe(CATEGORY.EDUCATION);
  });

  it("D3 (superseded by ext-006): BNPL now classifies as bnpl, not loan_repayment", () => {
    // ext-002 D3 routed BNPL through the loan_repayment rule because there was
    // no BNPL category. ext-006 adds one; the classification is unchanged
    // (financial_commitment), so no affordability number moves.
    expect(ruleFor("afterpay")?.category).toBe(CATEGORY.BNPL);
    expect(ruleFor("zip pay")?.category).toBe(CATEGORY.BNPL);
    expect(ruleFor("klarna")?.category).toBe(CATEGORY.BNPL);
    expect(ruleFor("humm")?.category).toBe(CATEGORY.BNPL);

    // Genuine loans stay on rule 3 — Latitude writes personal loans as well as
    // LatitudePay, so the bare brand must NOT be swept into bnpl.
    expect(ruleFor("personal loan repayment")?.category).toBe(CATEGORY.LOAN_REPAYMENT);
    expect(ruleFor("latitude financial")?.category).toBe(CATEGORY.LOAN_REPAYMENT);
    expect(ruleFor("latitudepay")?.category).toBe(CATEGORY.BNPL);
  });

  it("ext-006: general_retail is last, so specific rules keep first refusal", () => {
    expect(ruleFor("jb hi-fi")?.category).toBe(CATEGORY.GENERAL_RETAIL);
    expect(ruleFor("officeworks")?.category).toBe(CATEGORY.GENERAL_RETAIL);
    expect(ruleFor("amazon marketplace au")?.category).toBe(CATEGORY.GENERAL_RETAIL);
    // 11-subscriptions must still win for Prime, and apparel department stores
    // stay on 13-clothing.
    expect(ruleFor("amazon prime")?.category).toBe(CATEGORY.SUBSCRIPTIONS);
    expect(ruleFor("kmart")?.category).toBe(CATEGORY.CLOTHING);
    expect(ruleFor("myer")?.category).toBe(CATEGORY.CLOTHING);
  });

  it("D4: hotel/bar stay in dining_entertainment", () => {
    expect(ruleFor("the grand hotel")?.category).toBe(CATEGORY.DINING_ENTERTAINMENT);
    expect(ruleFor("rooftop bar")?.category).toBe(CATEGORY.DINING_ENTERTAINMENT);
  });

  it("D5: union of both chains — statements-path gaps covered", () => {
    expect(ruleFor("diesel")?.category).toBe(CATEGORY.VEHICLE_RUNNING);
    expect(ruleFor("the good coffee co")?.category).toBe(CATEGORY.DINING_ENTERTAINMENT);
    expect(ruleFor("agl energy")?.category).toBe(CATEGORY.UTILITIES);
  });

  it("D6: modernised brand additions", () => {
    expect(ruleFor("ampol")?.category).toBe(CATEGORY.VEHICLE_RUNNING);
    expect(ruleFor("linkt tolls")?.category).toBe(CATEGORY.TRANSPORT);
    expect(ruleFor("menulog order")?.category).toBe(CATEGORY.DINING_ENTERTAINMENT);
  });
});

describe("ext-004 item 1: catch-all codes must not short-circuit description matching", () => {
  it("Opal Top-up + catch-all code OTHD -> transport via description (not utilities)", () => {
    expect(ruleFor("opal top-up", { code: "OTHD" })?.category).toBe(CATEGORY.TRANSPORT);
  });
  it("a genuine utilities description + OTHD -> still utilities (via description)", () => {
    expect(ruleFor("sydney water bill", { code: "OTHD" })?.category).toBe(CATEGORY.UTILITIES);
  });
  it("a UTIL-coded transaction with unrelated description -> still utilities (specific code)", () => {
    expect(ruleFor("acme holdings pty", { code: "UTIL" })?.category).toBe(CATEGORY.UTILITIES);
  });
});

describe("merged rules chain — precedence & reachability (ext-002 §4)", () => {
  it("priority cues outrank the brand rules (P1 fuel beats rule 4 groceries)", () => {
    expect(ruleFor("coles express fuel")?.ruleId).toBe("P1-fuel");
    expect(ruleFor("hoyts cinema")?.ruleId).toBe("P2-cinema");
  });

  it("matches on source-category code as well as description", () => {
    expect(ruleFor("some unknown shop", { code: "GROC" })?.category).toBe(CATEGORY.GROCERIES);
    expect(ruleFor("some unknown shop", { code: "MRTG" })?.category).toBe(CATEGORY.MORTGAGE);
  });

  it("every rule is reachable via a representative match", () => {
    const samples: Record<string, string> = {
      "P1-fuel": "shell fuel",
      "P2-cinema": "village cinemas",
      "P3-bnpl": "afterpay",
      "1-mortgage": "home loan repayment nab",
      "2-rent": "rental payment agent",
      "3-loan": "personal loan",
      "4-groceries": "woolworths metro",
      "5-utilities": "telstra bill",
      "6-fuel-brands": "diesel caltex",
      "7-transport": "uber trip",
      "8-insurance": "nrma insurance",
      "9-strata": "body corporate levy",
      "10-education": "university tuition",
      "11-subscriptions": "netflix",
      "12-dining": "restaurant dinner",
      "13-clothing": "uniqlo",
      "14-healthcare": "priceline pharmacy",
      "15-general-retail": "jb hi-fi",
    };
    const reached = new Set<string>();
    for (const [expectedId, key] of Object.entries(samples)) {
      const hit = ruleFor(key);
      expect(hit?.ruleId, `'${key}' should hit ${expectedId}`).toBe(expectedId);
      if (hit) reached.add(hit.ruleId);
    }
    // Every rule in the chain is covered by the samples above.
    expect(reached.size).toBe(RULES.length);
  });
});
