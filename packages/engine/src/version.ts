/**
 * Component versions that roll up into the engine_version stamped on every
 * result. Bumping the normaliser re-keys the dictionary (a match_key produced
 * by v1.1.0 may differ from v1.0.0), so it is versioned independently and its
 * value is a component of ENGINE_VERSION per spec §4.
 *
 * ENGINE_VERSION is the released semver reproduced on every categorise result;
 * it is what makes replay (spec §6) deterministic: re-running a historical
 * batch on a pinned engine_version reproduces the report exactly.
 */
export const NORMALISER_VERSION = "1.0.0";
// 1.1.0: 4899 + digital-subscription MCCs (5815-5818, 5968) → subscriptions
// (were misclassifying streaming as utilities/essential). Shadow-mode fix.
export const MCC_TABLE_VERSION = "1.1.0";
export const RULES_VERSION = "1.0.0";

/** The released engine semver. Bump when any component below changes. */
export const ENGINE_VERSION = "1.1.0";

/**
 * The taxonomy version this engine build targets. The authoritative taxonomy
 * (categories + classifications) lives in @moroku-enrich/taxonomy and is served
 * by GET /v1/taxonomy so consumers never hard-code it.
 */
export const TAXONOMY_VERSION = "1";
