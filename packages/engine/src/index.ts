/**
 * @moroku-enrich/engine — pure domain logic for the signal chain.
 * Zero AWS imports; every export is a pure function or versioned data.
 *
 * More exports (mcc table, rules, signal-chain orchestrator, result types)
 * land once taxonomy v1 category names are confirmed — they reference category
 * identifiers, which must come from Kanopi's code (spec §9.1), not be invented.
 */
export * from "./version.js";
export * from "./normaliser.js";
