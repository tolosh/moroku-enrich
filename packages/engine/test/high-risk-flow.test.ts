import { describe, expect, it } from "vitest";
import { categorise } from "../src/chain.js";
import { detectHighRiskFlow } from "../src/high-risk-flow.js";
import { normaliseMerchant } from "../src/normaliser.js";
import { EMPTY_LOOKUPS } from "../src/types.js";
import { FIXTURES } from "./fixtures/gambling-crypto.fixture.js";

const isGambling = (c: string | null | undefined) => !!c && c.startsWith("gambling_");
const isCrypto = (c: string | null | undefined) => !!c && c.startsWith("crypto_");

function run(input: Parameters<typeof categorise>[0]) {
  return categorise(input, EMPTY_LOOKUPS);
}

describe("ext-008 (ENR-25): gambling & crypto detection — per-case behaviour", () => {
  for (const c of FIXTURES) {
    it(c.label, () => {
      const r = run(c.input);
      if (c.expect === null) {
        // Collision / control: must never be tagged gambling or crypto.
        expect(isGambling(r.category), `${c.label} → ${r.category}`).toBe(false);
        expect(isCrypto(r.category), `${c.label} → ${r.category}`).toBe(false);
        return;
      }
      expect(r.category, c.label).toBe(c.expect);
      expect(r.source, c.label).toBe("high_risk");
      if (c.direction) expect(r.direction, c.label).toBe(c.direction);
      if (c.excluded !== undefined) expect(r.excluded, c.label).toBe(c.excluded);
      if (c.confidence !== undefined) expect(r.confidence, c.label).toBe(c.confidence);
      // An inflow must keep its category and never be reclassified as income.
      if (c.direction === "in") {
        expect(r.source, `${c.label} must not be income`).not.toBe("income");
        expect(r.excluded, `${c.label} inflow excluded`).toBe(true);
      }
      // Traceability (spec §6).
      expect(r.matched_rule_id, c.label).toBeTruthy();
    });
  }
});

describe("ext-008: scored acceptance (spec §8)", () => {
  const scored = FIXTURES.map((c) => ({ c, actual: run(c.input).category }));

  it("gambling precision ≥ 95% and recall ≥ 90%", () => {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    for (const { c, actual } of scored) {
      const expectedG = isGambling(c.expect);
      const actualG = isGambling(actual);
      if (expectedG && actualG) tp++;
      else if (!expectedG && actualG) fp++;
      else if (expectedG && !actualG) fn++;
    }
    const precision = tp / (tp + fp);
    const recall = tp / (tp + fn);
    expect(precision, `precision ${precision} (tp ${tp}, fp ${fp})`).toBeGreaterThanOrEqual(0.95);
    expect(recall, `recall ${recall} (tp ${tp}, fn ${fn})`).toBeGreaterThanOrEqual(0.9);
  });

  it("crypto_exchange precision ≥ 95% (with a brand match)", () => {
    let tp = 0;
    let fp = 0;
    for (const { c, actual } of scored) {
      const expectedC = isCrypto(c.expect);
      const actualC = isCrypto(actual);
      if (expectedC && actualC) tp++;
      else if (!expectedC && actualC) fp++;
    }
    const precision = tp / (tp + fp);
    expect(precision, `crypto precision ${precision} (tp ${tp}, fp ${fp})`).toBeGreaterThanOrEqual(
      0.95,
    );
  });

  it("zero false gambling tags on the collision set", () => {
    const falsePositives = scored.filter(
      ({ c, actual }) => c.expect === null && isGambling(actual),
    );
    expect(falsePositives.map((f) => `${f.c.label} → ${f.actual}`)).toEqual([]);
  });

  it("no gambling/crypto inflow is ever tagged income", () => {
    const inflows = FIXTURES.filter((c) => c.direction === "in");
    expect(inflows.length).toBeGreaterThan(0);
    for (const c of inflows) {
      const r = run(c.input);
      expect(r.source, c.label).toBe("high_risk");
      expect(r.source, c.label).not.toBe("income");
    }
  });

  it("no lottery line is tagged wagering where a lottery brand is present", () => {
    // TAB Keno on a wagering MCC must resolve to lottery, not wagering.
    const r = run({ description: "TAB KENO", merchant_name: "TAB Keno", mcc: "7995", amount: -15 });
    expect(r.category).toBe("gambling_lottery");
  });
});

describe("ext-008: confidence model (spec §6)", () => {
  const merch = (d: string) => normaliseMerchant(d);

  it("brand + consistent MCC → 0.95", () => {
    const hit = detectHighRiskFlow(merch("SPORTSBET"), {
      description: "SPORTSBET",
      merchant_name: "Sportsbet",
      mcc: "7995",
    });
    expect(hit?.category).toBe("gambling_wagering");
    expect(hit?.confidence).toBe(0.95);
  });

  it("brand alone → 0.80", () => {
    const hit = detectHighRiskFlow(merch("SPORTSBET"), {
      description: "SPORTSBET",
      merchant_name: "Sportsbet",
    });
    expect(hit?.confidence).toBe(0.8);
  });

  it("gambling MCC alone → 0.80", () => {
    const hit = detectHighRiskFlow(merch("UNKNOWN BETTING"), {
      description: "UNKNOWN BETTING",
      mcc: "7995",
    });
    expect(hit?.category).toBe("gambling_wagering");
    expect(hit?.confidence).toBe(0.8);
    expect(hit?.matchedRuleId).toBe("mcc-7995");
  });

  it("quasi-cash MCC alone → 0.50 / quasi_cash", () => {
    const hit = detectHighRiskFlow(merch("ACME FX"), { description: "ACME FX", mcc: "6051" });
    expect(hit?.category).toBe("quasi_cash");
    expect(hit?.confidence).toBe(0.5);
  });

  it("an inconsistent MCC does not bump a brand match (brand wins at 0.80)", () => {
    // Gambling brand with a crypto/quasi MCC: the brand wins, MCC is ignored.
    const hit = detectHighRiskFlow(merch("SPORTSBET"), {
      description: "SPORTSBET",
      merchant_name: "Sportsbet",
      mcc: "6051",
    });
    expect(hit?.category).toBe("gambling_wagering");
    expect(hit?.confidence).toBe(0.8);
  });

  it("returns undefined for an ordinary merchant", () => {
    expect(detectHighRiskFlow(merch("WOOLWORTHS METRO"), { description: "WOOLWORTHS METRO" })).toBeUndefined();
  });
});

describe("ext-008: venue cash-withdrawal flag (spec §7)", () => {
  it("flags an ATM withdrawal at a licensed venue, keeping the excluded transfer outcome", () => {
    const r = run({ description: "ATM WITHDRAWAL THE FOOTBALL CLUB", amount: -100 });
    expect(r.excluded).toBe(true);
    expect(r.flags).toContain("venue_cash_withdrawal");
  });

  it("does not flag an ordinary ATM withdrawal", () => {
    const r = run({ description: "ATM WITHDRAWAL MAIN ST", amount: -100 });
    expect(r.flags).not.toContain("venue_cash_withdrawal");
  });
});
