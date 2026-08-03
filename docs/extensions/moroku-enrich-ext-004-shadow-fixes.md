# Moroku Enrich — Extension 004: Shadow-Data Fixes

*Extension to `moroku-enrich-spec.md`. Self-contained. Five defects/gaps surfaced by real Kanopi shadow traffic (3 Aug 2026, engine 1.1.0). Commit to `docs/extensions/` when applying. Work the items in order, separate commits, push each.*

## 1. Catch-all DocuScan codes must not force a category (the Opal bug)

**Observed:** on docuscan-path runs, `Opal Top-up` classifies `utilities` via `rules` at 0.70. Root-cause hypothesis: rule 4 (utilities) matches category codes `UTIL, UTLW, OTHD` (inherited verbatim from legacy via ext-002), and DocuScan stamps these transactions with a catch-all code (`OTHD` ≈ "other debits"), which fires before rule 7's description regex (which contains `opal`) is ever consulted.

**Work:** confirm the actual code on the failing transactions (log/fixture), then: remove `OTHD` from rule 4's code list — a catch-all code carries no category signal and must never short-circuit description matching. Audit every code list in the ruleset for other catch-alls with the same failure mode (anything meaning "other"/"miscellaneous" gets removed from code matching entirely). If `OTHD` turns out to be semantically specific after all, document what it means and fix accordingly — but the default posture is: codes only match when they are specific.

**Tests:** `Opal Top-up` + code `OTHD` → `transport` via rule 7 (description). A genuinely-utilities description + `OTHD` → still `utilities` via description. `UTIL`-coded transaction with unrelated description → still `utilities` via code (specific codes keep working).

## 2. Exclusions must gate the unknown-merchant enqueue

**Observed:** `paypal transfer` reached the LLM queue and was classified (0.30, untrusted). The exclusions tier (`\btransfer\b`) should have terminated the chain before any enqueue.

**Work:** ensure the unknown-merchant enqueue happens only for transactions that pass the exclusions tier (and are debits). Excluded transactions must never enter the queue — otherwise the cache slowly fills with transfer/withdrawal noise.

**Tests:** a transfer-matching description produces no SQS enqueue; a genuine unknown still enqueues.

## 3. Classifier: cache-check before Bedrock invoke

**Observed:** the drain made 115 Bedrock calls for 36 distinct merchants — the classifier invokes per message without a `GetItem` on `llm_cache` first.

**Work:** classifier worker does `GetItem(match_key, prompt_version)` before `InvokeModel`; on hit, skip the invoke (optionally refresh nothing — the cache is append-once per prompt_version). Also dedupe within a single batch receive.

**Tests:** two messages with the same match_key in one batch → one invoke. A message whose key is already cached → zero invokes.

## 4. Normaliser: strip POS prefixes, card fragments, and date tokens

**Observed:** `EFTPOS THE BOATHOUSE PALM BEACH` and `the boathouse palm beach` cache as two keys; `PetBarn Mona Vale 17Feb CardXX1234` carries a date token and card fragment through normalisation.

**Work:** extend the pipeline: strip leading `EFTPOS `, `VISA `, `V `, `DEBIT ` POS prefixes; strip `card ?xx\d{2,4}`-style fragments case-insensitively; strip compact date tokens (`17Feb`, `02/17`, `17-02` style) anywhere in the string. Bump the normaliser version (part of engine_version) — note this re-keys affected dictionary/cache rows; run a one-time migration that re-normalises existing `llm_cache` and `merchants_global` keys, merging rows that collapse to the same new key (keep highest confidence on conflict, log merges).

**Tests:** the boathouse variants above normalise identically; petbarn example → `petbarn mona vale`; migration merges a synthetic duplicate pair correctly.

## 5. Corrections API: accept `transfer` as a correction target

**Decision (recorded 3 Aug):** users must be able to correct a miscategorised transaction to "not an expense" (e.g. TRANSFER TO SAVINGS sitting in other_expenses). Extend `POST /v1/corrections` to accept `corrected_category: "transfer"`: validation allows it alongside the 15 expense categories; the learned override stores it; subsequent categorise calls return `category: "transfer"`, `excluded: true`, `source: user_override`, confidence 1.0 for that user+match_key. Corrections log records it like any correction. Promotion rules apply unchanged (a merchant-level transfer mapping can promote — some descriptors are always transfers).

**Tests:** correction to `transfer` → accepted, applied_scope user; re-categorise returns excluded with user_override source; taxonomy endpoint unchanged (transfer is an outcome, not an expense category).

## Also note (no code change)

`confident_pct` near zero on docuscan runs is **correct behaviour**, not a defect: statement transactions carry no MCC, so rules-tier hits (0.70) sit below the 0.8 confidence bar by design. The number rises as the dictionary/cache cover the statement merchants. Add one sentence to the API docs defining confident_pct and this expectation, so consuming teams don't misread it.

## Acceptance

All five items tested as above; full suite + synth green; engine version bumped (normaliser change forces it); deployed to dev with the standard context flags (`llmTier=on`, `bedrockModelId=au.anthropic.claude-haiku-4-5-20251001-v1:0` — do not drop them); STATUS.md updated; every commit pushed.
