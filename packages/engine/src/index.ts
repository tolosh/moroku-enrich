/**
 * @moroku-enrich/engine — pure domain logic for the signal chain (spec §4).
 * Zero AWS imports; every export is a pure function or versioned data.
 *
 * The signal chain is wired end-to-end. Category identifiers referenced by the
 * MCC table, rules and fallback flow through the placeholder registry in
 * ./categories (decision §9.1): given ids are bound, the rest are `pending`
 * sentinels reconciled against the taxonomy once the verbatim 16-list lands.
 */
export * from "./version.js";
export * from "./normaliser.js";
export * from "./categories.js";
export * from "./types.js";
export * from "./exclusions.js";
export * from "./mcc.js";
export * from "./rules.js";
export * from "./chain.js";
