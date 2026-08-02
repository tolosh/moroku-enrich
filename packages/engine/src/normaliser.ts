/**
 * Merchant normaliser — spec §4.
 *
 * Deterministic, pure-function pipeline that reduces a raw transaction
 * description to a stable `match_key` used for every dictionary / override /
 * LLM lookup. Because the same normaliser runs on both the write path
 * (corrections) and the read path (categorise), the key is internally
 * consistent even where a heuristic is imperfect: a correction posted for
 * "OFFICE 365 SYDNEY AU" and a later lookup of the same string resolve to the
 * same key regardless of whether "365" is semantically a store number.
 *
 * The pipeline is versioned (NORMALISER_VERSION) because changing it re-keys
 * the dictionary; the version is a component of engine_version.
 *
 * Zero AWS imports. Zero I/O. Fully unit-testable.
 */

import { NORMALISER_VERSION } from "./version.js";

export interface NormalisedMerchant {
  /** Canonical lookup key: lowercased, stripped, whitespace-collapsed. */
  match_key: string;
  /** Human-facing display name derived from the match_key (title-cased). */
  canonical_name: string;
  /** The original, untouched description (trimmed) — for audit / display. */
  normalised_from: string;
}

/**
 * Payment-gateway / aggregator prefixes (spec §4). Matched at the start of the
 * uppercased string as `<TOKEN> *` with any spacing around the star, so this
 * one set covers `SQ *`, `PAYPAL *`, `ZIP *`, `EZI*`, `SP * `, `TST* `.
 * Exported + versioned so the set is auditable and extensible from real data.
 */
export const GATEWAY_PREFIX_TOKENS = [
  "SQ", // Square
  "SQC", // Square (alt)
  "PAYPAL",
  "PP", // PayPal (alt)
  "ZIP", // Zip Pay
  "EZI", // Ezidebit
  "SP", // generic storefront (Shopify / Stripe-style)
  "TST", // Toast
  "PY", // generic pay aggregator
] as const;

const GATEWAY_PREFIX_RE = new RegExp(
  `^(?:${GATEWAY_PREFIX_TOKENS.join("|")})\\s*\\*\\s*`,
  "i",
);

/** Australian state / territory abbreviations used as trailing location tokens. */
export const AU_STATES = new Set([
  "NSW",
  "VIC",
  "QLD",
  "QLND",
  "WA",
  "SA",
  "TAS",
  "ACT",
  "NT",
]);

/** Country tokens that trail Australian transaction descriptions. */
export const COUNTRY_TOKENS = new Set(["AU", "AUS", "AUST", "AUSTRALIA"]);

/**
 * Seed gazetteer of common AU place tokens. Used only to strip *trailing*
 * location words once a state/country marker has already been found, so the
 * blast radius is limited — a brand word never in this set is never stripped.
 * Deliberately small and versioned; extend from real Kanopi data. REPLACEABLE.
 */
export const SUBURB_TOKENS = new Set([
  // capitals + major cities
  "SYDNEY",
  "MELBOURNE",
  "BRISBANE",
  "PERTH",
  "ADELAIDE",
  "HOBART",
  "DARWIN",
  "CANBERRA",
  "NEWCASTLE",
  "WOLLONGONG",
  "GEELONG",
  "TOWNSVILLE",
  "CAIRNS",
  "TOOWOOMBA",
  "BALLARAT",
  "BENDIGO",
  "LAUNCESTON",
  // common suburbs / multi-word location fragments
  "GOLD",
  "COAST",
  "SUNSHINE",
  "BONDI",
  "JUNCTION",
  "PARRAMATTA",
  "CHATSWOOD",
  "MANLY",
  "CBD",
  "NORTH",
  "SOUTH",
  "EAST",
  "WEST",
  "CENTRAL",
  "HEIGHTS",
  "PARK",
  "BAY",
  "HILL",
  "HILLS",
  "POINT",
  "CREEK",
  "VALE",
  "VALLEY",
  "RIDGE",
  "WATERS",
  "BEACH",
]);

/** Tokens that mark an adjacent number as a store / terminal / point-of-sale id. */
const STORE_MARKER_TOKENS = new Set([
  "STORE",
  "STR",
  "TERM",
  "TERMINAL",
  "POS",
  "TILL",
  "REG",
  "SHOP",
  "UNIT",
  "LANE",
  "PUMP",
]);

function stripGatewayPrefixes(input: string): string {
  let s = input;
  // Loop to unwind stacked prefixes (e.g. "PP *SQ *NAME"), bounded by length.
  for (let i = 0; i < 4; i++) {
    const next = s.replace(GATEWAY_PREFIX_RE, "");
    if (next === s) break;
    s = next.trimStart();
  }
  return s;
}

/**
 * Remove card fragments (masked PANs) and embedded dates anywhere in the
 * string. These never carry merchant meaning.
 */
function stripCardAndDateNoise(input: string): string {
  return (
    input
      // masked card fragments: XX1234, XXXX1234, X1234, ************1234
      .replace(/\bX{1,4}\d{2,6}\b/g, " ")
      .replace(/\*{2,}\d{2,6}\b/g, " ")
      // ISO dates: 2026-07-14
      .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
      // numeric dates: 14/07, 14/07/26, 07-14
      .replace(/\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/g, " ")
      // compact dates: 14JUL, 14JUL26
      .replace(/\b\d{1,2}(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\d{0,4}\b/g, " ")
  );
}

/** Tokenise on whitespace, dropping empties. */
function tokens(s: string): string[] {
  return s.split(/\s+/).filter((t) => t.length > 0);
}

function isStoreNumberToken(token: string): boolean {
  // #4821, pure digits (>=2), single-letter-prefixed ids like T4821 / P07.
  if (/^#\d+$/.test(token)) return true;
  if (/^\d{2,}$/.test(token)) return true;
  if (/^[A-Z]\d{2,}$/.test(token)) return true;
  return false;
}

/**
 * Strip trailing store / terminal numbers (spec §4). Pops from the end while
 * the trailing token is a store-number token or a store-marker word. Never
 * empties the token list.
 */
function stripTrailingStoreNumbers(toks: string[]): string[] {
  const out = [...toks];
  while (out.length > 1) {
    const last = out[out.length - 1]!;
    if (isStoreNumberToken(last)) {
      out.pop();
      // A marker word immediately before the number (STORE 4821) goes too.
      const prev = out[out.length - 1];
      if (out.length > 1 && prev && STORE_MARKER_TOKENS.has(prev)) out.pop();
      continue;
    }
    break;
  }
  return out;
}

/**
 * Strip trailing location tokens (spec §4): country -> state -> suburb.
 * Suburb words are only removed once a state/country marker has been seen, and
 * only when present in the gazetteer, so brand words are never eaten.
 */
function stripTrailingLocation(toks: string[]): string[] {
  const out = [...toks];
  let markerSeen = false;

  // Country token(s) at the very end.
  while (out.length > 1 && COUNTRY_TOKENS.has(out[out.length - 1]!)) {
    out.pop();
    markerSeen = true;
  }
  // State token.
  if (out.length > 1 && AU_STATES.has(out[out.length - 1]!)) {
    out.pop();
    markerSeen = true;
  }
  // Suburb tokens — bounded, gazetteer-gated, only after a marker.
  if (markerSeen) {
    let popped = 0;
    while (out.length > 1 && popped < 3 && SUBURB_TOKENS.has(out[out.length - 1]!)) {
      out.pop();
      popped++;
    }
  }
  return out;
}

function titleCase(matchKey: string): string {
  return matchKey
    .split(" ")
    .filter((w) => w.length > 0)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Normalise a raw transaction description into a stable merchant key.
 * Pure function; identical input always yields identical output.
 */
export function normaliseMerchant(rawDescription: string): NormalisedMerchant {
  const normalised_from = (rawDescription ?? "").trim();

  // Stage 1: uppercase working copy.
  let work = normalised_from.toUpperCase();

  // Stage 2: strip gateway prefixes.
  work = stripGatewayPrefixes(work);

  // Stage 3: strip card fragments + embedded dates.
  work = stripCardAndDateNoise(work);

  // Stage 4/5: token-level trailing strips. Store numbers and location tokens
  // interleave in the wild ("...4821 SYDNEY AU"), so run both to a fixpoint
  // rather than a single ordered pass.
  let toks = tokens(work);
  const beforeStrip = [...toks];
  for (let i = 0; i < toks.length; i++) {
    const len = toks.length;
    toks = stripTrailingStoreNumbers(toks);
    toks = stripTrailingLocation(toks);
    if (toks.length === len) break;
  }

  // Guard: never return an empty key. If stripping consumed everything
  // meaningful, fall back to the pre-strip tokens (still prefix/noise cleaned).
  if (toks.length === 0) toks = beforeStrip;

  // Stage 6: collapse whitespace, lowercase -> match_key.
  const match_key = toks.join(" ").toLowerCase().trim();
  const canonical_name = titleCase(match_key);

  return { match_key, canonical_name, normalised_from };
}

/** The normaliser version — a component of engine_version (spec §4). */
export const normaliserVersion = NORMALISER_VERSION;
