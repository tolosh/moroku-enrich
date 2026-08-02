import { describe, expect, it } from "vitest";
import { normaliseMerchant } from "../src/normaliser.js";

/** Helper: assert just the match_key for terse table-driven cases. */
function key(desc: string): string {
  return normaliseMerchant(desc).match_key;
}

describe("normaliseMerchant — gateway prefixes (spec §4)", () => {
  it.each([
    ["SQ *THE DAILY GRIND 4821 SYDNEY AU", "the daily grind"],
    ["PAYPAL *STEAM GAMES", "steam games"],
    ["ZIP *COTTON ON 123", "cotton on"],
    ["EZI*ANYTIME FITNESS", "anytime fitness"],
    ["SP * BRANDLESS STORE", "brandless store"],
    ["TST* THE LOCAL CAFE", "the local cafe"],
    ["PP *NETFLIX.COM", "netflix.com"],
  ])("strips %s -> %s", (input, expected) => {
    expect(key(input)).toBe(expected);
  });

  it("unwinds stacked prefixes", () => {
    expect(key("PP *SQ *THE DAILY GRIND")).toBe("the daily grind");
  });

  it("tolerates varied spacing around the star", () => {
    expect(key("SQ*THE DAILY GRIND")).toBe("the daily grind");
    expect(key("SQ  *  THE DAILY GRIND")).toBe("the daily grind");
  });

  it("does not strip a gateway token that is part of a real word", () => {
    // 'SPUDBAR' starts with SP but has no ' *' — must not be touched.
    expect(key("SPUDBAR MELBOURNE VIC")).toBe("spudbar");
  });
});

describe("normaliseMerchant — store / terminal numbers", () => {
  it.each([
    ["THE DAILY GRIND 4821", "the daily grind"],
    ["WOOLWORTHS #1234", "woolworths"],
    ["BUNNINGS STORE 55", "bunnings"],
    ["KMART T4821", "kmart"],
    ["COLES POS 07", "coles"],
  ])("strips trailing store number in %s", (input, expected) => {
    expect(key(input)).toBe(expected);
  });

  it("keeps a merchant that is only a number-free name", () => {
    expect(key("BUNNINGS")).toBe("bunnings");
  });

  it("does not strip a number embedded mid-name", () => {
    expect(key("7-ELEVEN 2093 BONDI NSW")).toBe("7-eleven");
  });
});

describe("normaliseMerchant — card fragments and dates", () => {
  it.each([
    ["NETFLIX XX4821", "netflix"],
    ["SPOTIFY XXXX1234", "spotify"],
    ["UBER 2026-07-14", "uber"],
    ["AMAZON 14/07", "amazon"],
    ["AMAZON 14JUL", "amazon"],
    ["STAN 14JUL26", "stan"],
  ])("removes noise from %s", (input, expected) => {
    expect(key(input)).toBe(expected);
  });
});

describe("normaliseMerchant — trailing location (country / state / suburb)", () => {
  it.each([
    ["THE DAILY GRIND SYDNEY AU", "the daily grind"],
    ["COLES EXPRESS MELBOURNE VIC", "coles express"],
    ["BUNNINGS WAREHOUSE BRISBANE QLD", "bunnings warehouse"],
    ["JB HI-FI PERTH WA AU", "jb hi-fi"],
    ["SOME CAFE GOLD COAST QLD", "some cafe"],
  ])("strips location from %s", (input, expected) => {
    expect(key(input)).toBe(expected);
  });

  it("does not strip a location word when no state/country marker is present", () => {
    // 'PARK' is a gazetteer word but there is no marker, so it stays — safe.
    expect(key("CENTENNIAL PARK CAFE")).toBe("centennial park cafe");
  });

  it("never strips a brand word that is not in the gazetteer, even after a marker", () => {
    expect(key("THE DAILY GRIND NSW")).toBe("the daily grind");
  });
});

describe("normaliseMerchant — full pipeline composition", () => {
  it("applies prefix + number + location together (canonical example)", () => {
    const r = normaliseMerchant("SQ *THE DAILY GRIND 4821 SYDNEY AU");
    expect(r.match_key).toBe("the daily grind");
    expect(r.canonical_name).toBe("The Daily Grind");
    expect(r.normalised_from).toBe("SQ *THE DAILY GRIND 4821 SYDNEY AU");
  });

  it("handles a messy real-world BNPL string", () => {
    expect(key("ZIP *REBEL SPORT 0921 CHATSWOOD NSW AU")).toBe("rebel sport");
  });
});

describe("normaliseMerchant — determinism and safety", () => {
  it("is idempotent on its own match_key when re-fed as a description", () => {
    const once = normaliseMerchant("SQ *THE DAILY GRIND 4821 SYDNEY AU").match_key;
    const twice = normaliseMerchant(once).match_key;
    expect(twice).toBe(once);
  });

  it("produces identical output for identical input", () => {
    const a = normaliseMerchant("PAYPAL *STEAM GAMES 14/07");
    const b = normaliseMerchant("PAYPAL *STEAM GAMES 14/07");
    expect(a).toEqual(b);
  });

  it("never returns an empty match_key even for all-noise input", () => {
    const r = normaliseMerchant("SQ *4821 SYDNEY AU");
    expect(r.match_key.length).toBeGreaterThan(0);
  });

  it("handles empty / whitespace input without throwing", () => {
    expect(normaliseMerchant("").match_key).toBe("");
    expect(normaliseMerchant("   ").match_key).toBe("");
  });

  it("preserves normalised_from verbatim (trimmed)", () => {
    expect(normaliseMerchant("  UBER TRIP  ").normalised_from).toBe("UBER TRIP");
  });
});
