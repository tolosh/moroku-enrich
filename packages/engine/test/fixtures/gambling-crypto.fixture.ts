/**
 * Labelled fixture for ext-008 (ENR-25) — gambling & crypto-exchange recognition.
 *
 * Covers every seed brand across the three channels (card with MCC, PayID /
 * description, BPAY biller code), both directions (deposits and winnings / crypto
 * sales), the MCC-only and quasi-cash fallbacks, and the collision set the spec
 * calls out (Crown Street, "Table", "Star" cafés, TAB/TABLE/TABACCO, Treasury
 * Wine). `high-risk-flow.test.ts` runs the full chain over this and scores
 * precision / recall against the acceptance bar.
 *
 * Open-banking feeds carry a clean `merchant_name`; statement feeds carry only
 * `description` (which the normaliser strips of location tokens — so a casino's
 * venue qualifier survives only in `merchant_name`, mirrored here). `expect` is
 * the required category, or `null` for a collision case that must NOT be tagged
 * gambling or crypto.
 */
import type { CategoriseInput } from "../../src/types.js";

export interface FixtureCase {
  label: string;
  input: CategoriseInput;
  /** Required category, or null = must not be a gambling/crypto/quasi tag. */
  expect: string | null;
  direction?: "in" | "out";
  excluded?: boolean;
  confidence?: number;
  channel: "card" | "payid" | "bpay" | "statement";
}

const GAMBLING_WAGERING = "gambling_wagering";
const GAMBLING_CASINO = "gambling_casino";
const GAMBLING_LOTTERY = "gambling_lottery";
const QUASI_CASH = "quasi_cash";
const CRYPTO_EXCHANGE = "crypto_exchange";
const CRYPTO_ATM = "crypto_atm";

/** A card debit: brand in merchant_name + description, with an MCC → 0.95. */
function card(label: string, brand: string, mcc: string, expect: string): FixtureCase {
  return {
    label,
    input: { description: brand.toUpperCase(), merchant_name: brand, mcc, amount: -50 },
    expect,
    direction: "out",
    excluded: expect.startsWith("crypto_"),
    confidence: 0.95,
    channel: "card",
  };
}

/** A PayID / statement debit: brand only, no MCC → 0.80. */
function brandOnly(label: string, brand: string, expect: string): FixtureCase {
  return {
    label,
    input: { description: brand.toUpperCase(), merchant_name: brand, amount: -50 },
    expect,
    direction: "out",
    excluded: expect.startsWith("crypto_"),
    confidence: 0.8,
    channel: "payid",
  };
}

export const FIXTURES: readonly FixtureCase[] = [
  // ---- Wagering, card + MCC 7995 (→ 0.95) ----
  ...(
    [
      "Sportsbet",
      "Tabcorp",
      "TABtouch",
      "bet365",
      "Ladbrokes",
      "Neds",
      "PointsBet",
      "Betfair",
      "Unibet",
      "BlueBet",
      "Betr",
      "Dabble",
      "PlayUp",
      "TopSport",
      "Palmerbet",
    ] as const
  ).map((b) => card(`wagering card: ${b}`, b, "7995", GAMBLING_WAGERING)),

  // ---- Casino, card + MCC 7801 (→ 0.95). Venue qualifier in merchant_name. ----
  ...(
    [
      "Crown Melbourne",
      "Crown Sydney",
      "Crown Perth",
      "The Star Sydney",
      "The Star Gold Coast",
      "Star Entertainment",
      "SkyCity Adelaide",
      "Treasury Brisbane",
    ] as const
  ).map((b) => card(`casino card: ${b}`, b, "7801", GAMBLING_CASINO)),

  // ---- Lottery, card + MCC 7800 (→ 0.95) ----
  ...(["The Lott", "Lotterywest", "Keno"] as const).map((b) =>
    card(`lottery card: ${b}`, b, "7800", GAMBLING_LOTTERY),
  ),

  // ---- Crypto exchange, card + MCC 6051 (→ 0.95, excluded) ----
  ...(
    [
      "CoinSpot",
      "Swyftx",
      "Independent Reserve",
      "BTC Markets",
      "CoinJar",
      "Digital Surge",
      "Coinbase",
      "Binance",
      "Kraken",
      "Crypto.com",
    ] as const
  ).map((b) => card(`crypto card: ${b}`, b, "6051", CRYPTO_EXCHANGE)),

  // ---- Crypto ATM, card + MCC 6051 (brand wins → crypto_atm, 0.95) ----
  ...(["Coinflip", "Localcoin"] as const).map((b) =>
    card(`crypto atm card: ${b}`, b, "6051", CRYPTO_ATM),
  ),

  // ---- Brand-only (PayID / statement, no MCC → 0.80) ----
  brandOnly("wagering payid: Sportsbet", "Sportsbet", GAMBLING_WAGERING),
  brandOnly("wagering payid: Ladbrokes", "Ladbrokes", GAMBLING_WAGERING),
  brandOnly("crypto payid: CoinSpot", "CoinSpot", CRYPTO_EXCHANGE),
  brandOnly("crypto payid: Binance", "Binance", CRYPTO_EXCHANGE),

  // ---- BPAY: biller code is the signal (→ 0.80) ----
  {
    label: "wagering bpay: Sportsbet biller 89672",
    input: {
      description: "BPAY PAYMENT",
      biller_code: "89672",
      biller_name: "Sportsbet",
      amount: -100,
    },
    expect: GAMBLING_WAGERING,
    direction: "out",
    excluded: false,
    confidence: 0.8,
    channel: "bpay",
  },

  // ---- MCC-only, no brand (gambling 0.80 / quasi-cash 0.50) ----
  {
    label: "wagering mcc-only 7995",
    input: { description: "ACME BETTING CO", mcc: "7995", amount: -30 },
    expect: GAMBLING_WAGERING,
    direction: "out",
    excluded: false,
    confidence: 0.8,
    channel: "card",
  },
  {
    label: "casino mcc-only 7801",
    input: { description: "A LOCAL CASINO", mcc: "7801", amount: -30 },
    expect: GAMBLING_CASINO,
    direction: "out",
    confidence: 0.8,
    channel: "card",
  },
  {
    label: "lottery mcc-only 7800",
    input: { description: "STATE LOTTERY", mcc: "7800", amount: -10 },
    expect: GAMBLING_LOTTERY,
    direction: "out",
    confidence: 0.8,
    channel: "card",
  },
  {
    label: "racing mcc-only 9754",
    input: { description: "RACE DAY", mcc: "9754", amount: -20 },
    expect: GAMBLING_WAGERING,
    direction: "out",
    confidence: 0.8,
    channel: "card",
  },
  {
    label: "quasi-cash mcc-only 6051 (no brand) → quasi_cash 0.50",
    input: { description: "ACME FX SERVICES", mcc: "6051", amount: -200 },
    expect: QUASI_CASH,
    direction: "out",
    excluded: false,
    confidence: 0.5,
    channel: "card",
  },

  // ---- Lottery brand must beat a wagering MCC (no lottery-as-wagering) ----
  {
    label: "lottery brand on wagering MCC: TAB Keno 7995 → lottery",
    input: { description: "TAB KENO", merchant_name: "TAB Keno", mcc: "7995", amount: -15 },
    expect: GAMBLING_LOTTERY,
    direction: "out",
    confidence: 0.95,
    channel: "card",
  },

  // ---- Inflows: never income, keep the category, excluded, direction in ----
  {
    label: "inflow: bet365 winnings (credit) → wagering, excluded, not income",
    input: { description: "BET365 WINNINGS", merchant_name: "bet365", amount: 320 },
    expect: GAMBLING_WAGERING,
    direction: "in",
    excluded: true,
    confidence: 0.8,
    channel: "payid",
  },
  {
    label: "inflow: Sportsbet payout (credit)",
    input: { description: "SPORTSBET PAYOUT", merchant_name: "Sportsbet", amount: 90 },
    expect: GAMBLING_WAGERING,
    direction: "in",
    excluded: true,
    confidence: 0.8,
    channel: "payid",
  },
  {
    label: "inflow: CoinSpot sale / off-ramp (credit) → crypto_exchange, not income",
    input: { description: "COINSPOT", merchant_name: "CoinSpot", amount: 1500 },
    expect: CRYPTO_EXCHANGE,
    direction: "in",
    excluded: true,
    confidence: 0.8,
    channel: "payid",
  },

  // ---- Collision set: must NOT be tagged gambling/crypto (expect null) ----
  { label: "collision: Crown Street café", input: { description: "CROWN ST CAFE", merchant_name: "Crown Street Cafe", amount: -8 }, expect: null, channel: "statement" },
  { label: "collision: Crown Street bakery", input: { description: "CROWN STREET BAKERY", merchant_name: "Crown Street Bakery", amount: -12 }, expect: null, channel: "statement" },
  { label: "collision: The Table restaurant", input: { description: "THE TABLE RESTAURANT", merchant_name: "The Table Restaurant", amount: -64 }, expect: null, channel: "statement" },
  { label: "collision: tobacco shop", input: { description: "TABACCO STATION PTY", merchant_name: "Tabacco Station", amount: -25 }, expect: null, channel: "statement" },
  { label: "collision: Lucky Star takeaway", input: { description: "LUCKY STAR TAKEAWAY", merchant_name: "Lucky Star Takeaway", amount: -22 }, expect: null, channel: "statement" },
  { label: "collision: Starbucks", input: { description: "STARBUCKS COFFEE", merchant_name: "Starbucks", amount: -6 }, expect: null, channel: "statement" },
  { label: "collision: Treasury Wine Estates", input: { description: "TREASURY WINE ESTATES", merchant_name: "Treasury Wine Estates", amount: -40 }, expect: null, channel: "statement" },
  { label: "collision: ordinary groceries", input: { description: "WOOLWORTHS METRO", merchant_name: "Woolworths", mcc: "5411", amount: -70 }, expect: null, channel: "card" },
];
