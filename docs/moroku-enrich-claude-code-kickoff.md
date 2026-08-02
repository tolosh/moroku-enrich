# Moroku Enrich — Claude Code Kickoff Prompt (Phase 1)

*Paste everything below the line into a fresh Claude Code session, run from an empty directory, with AWS credentials for the Moroku Dev Sandbox configured (account 932027117528, region ap-southeast-2). Put `moroku-enrich-spec.md` in the same directory first — the prompt references it as the source of truth.*

---

You are building **Moroku Enrich**, a standalone transaction-enrichment API for Moroku Pty Ltd. Kanopi (kanopi.one) is customer zero. The full specification is in `moroku-enrich-spec.md` in this directory — read it first; it is the source of truth. This prompt covers Phase 1 (core service) plus the Phase 2 LLM tier stubs.

## Environment

- AWS account: **932027117528** (Moroku Dev Sandbox, `aws+devsandbox@moroku.com`)
- Region: **ap-southeast-2**
- The account is shared with other workloads. Everything you create must be tagged `project: moroku-enrich` and `stage: dev`, use its own least-privilege IAM roles, and reference no pre-existing resources. Activate `project` as a cost-allocation tag if not already active.
- Verify credentials before deploying: `aws sts get-caller-identity` must return account 932027117528. Stop and ask if it doesn't.

## Repository

Create repo scaffold `moroku-enrich`:

```
moroku-enrich/
  infra/          # CDK app (TypeScript) — single app, `dev` and `prod` stages
  services/
    categorise/   # Lambda: POST /v1/categorise
    corrections/  # Lambda: POST /v1/corrections
    read/         # Lambda: GET taxonomy / merchants / overrides / health
    classifier/   # Lambda: SQS worker — Bedrock LLM tier (stub in phase 1)
  packages/
    engine/       # pure-TS domain logic: normaliser, MCC table, rules, signal chain
    taxonomy/     # taxonomy v1 definition, versioned
  docs/           # moroku-enrich-spec.md lives here; generated API docs
  fixtures/       # anonymised transaction fixtures for engine tests
```

`packages/engine` must be pure functions with zero AWS imports — the signal chain is testable without any infrastructure. Node 22, TypeScript strict, Vitest, esbuild bundling via CDK `NodejsFunction`.

## Stack (CDK)

Per spec §6: HTTP API Gateway (API-key auth via usage plans, per-tenant keys), the four Lambdas, DynamoDB tables per spec §5 (`merchants_global`, `overrides`, `corrections_log`, `llm_cache`, `promotion_queue` — on-demand billing, PITR on), SQS unknown-merchant queue + DLQ, CloudWatch dashboard (confident_pct, source mix, fallback rate, queue depth, correction volume) and an alarm on fallback rate > 15%. Secrets/config in SSM under `/moroku-enrich/dev/*`. No custom domain yet — output the execute-api URL; `enrich.moroku.com` comes later.

## Engine (the heart of phase 1)

Implement the signal chain exactly as spec §4, in priority order: exclusions → user override → tenant override → MCC table → global dictionary → rules → llm_cache → conservative fallback (`other_expenses` / `essential` / `flags:["unverified"]` — NEVER discretionary). Every result carries `category, classification, confidence, source, excluded, flags, merchant{canonical_name, match_key, normalised_from}, engine_version, taxonomy_version`.

- **Taxonomy v1**: the 16 Kanopi categories × 3 classifications, frozen verbatim (decision §9.1), plus `transfer` and `uncategorised_credit`. I will paste the extracted category list from Kanopi's code when you ask for it — ask before inventing names.
- **Merchant normaliser**: deterministic pipeline per spec §4 (gateway prefixes `SQ *`/`PAYPAL *`/`ZIP *`/`EZI*`/`SP * `/`TST* `, terminal/store numbers, card fragments, trailing location tokens, whitespace collapse → `match_key`). Pure function, exhaustively unit-tested; its version is a component of `engine_version`.
- **MCC table**: ISO 18245 → taxonomy v1, ~300 rows, shipped as versioned code with per-row confidence 0.95. Fuel MCCs (5541/5542) → `vehicle_running`; entertainment MCCs → `dining_entertainment` (these replace Kanopi's fuel/cinema priority-cue hacks).
- **Rules tier**: port Kanopi's existing regex chain once (union of both divergent copies — statements and open-banking), ordered, confidence 0.7, with tests that pin the current fuel/cinema behaviour.
- **Batching**: one `BatchGetItem` round-trip per lookup tier per request, not per transaction. p95 target < 300 ms for a 1,000-transaction batch with warm caches.

## API

Implement `POST /v1/categorise`, `POST /v1/corrections`, `GET /v1/taxonomy`, `GET /v1/merchants/{match_key}`, `GET /v1/overrides?user_ref=`, `DELETE /v1/overrides/{id}`, `GET /v1/health` — request/response shapes exactly as spec §3, including the `summary.confident_pct` block and `Idempotency-Key` support on writes.

Corrections learning tiers per spec §3.2: user scope effective immediately; tenant scope at ≥3 agreeing users (adviser one-step path implemented but dormant — Kanopi sends `actor: consumer` only for now, decision §9.4); global promotion writes to `promotion_queue` only — **manual approval, no auto-promotion** (decision §9.3). Every correction appends to `corrections_log` (append-only). `scope_hint: "transaction"` logs without touching mappings.

## Phase 2 stub

`classifier/` Lambda wired to the SQS queue but behind an env flag `LLM_TIER_ENABLED=false`: on unknown merchant, categorise returns the conservative fallback and enqueues the `match_key`. Implement the Bedrock call (Claude Haiku, taxonomy + few-shot from corrections_log, reject below confidence 0.6, write `llm_cache` keyed by `match_key#prompt_version`) but keep it flag-off until fixtures pass. Confirm Haiku availability in ap-southeast-2; fall back to AWS cross-region inference if unavailable (acceptable: the LLM tier only ever sees merchant strings — never amounts, dates, or user identifiers; enforce that in the code, not just the prompt).

## Tests & acceptance

- Vitest: normaliser (heavy), signal-chain priority order, corrections tier transitions, promotion-queue guards (single tenant can never write `merchants_global`), conservative fallback (prove unknown → essential+unverified, never discretionary), idempotency.
- Fixtures: I will provide anonymised Kanopi transaction sets; until then generate realistic AU fixtures (Coles Express fuel, SQ */PAYPAL * prefixes, transfers, BNPL) and mark them replaceable.
- Integration: one smoke test hitting the deployed dev stage end-to-end (categorise → correct → re-categorise reflects the correction).
- Done when: `cdk deploy` to dev succeeds in 932027117528/ap-southeast-2, smoke test green, dashboard shows metrics, and a 1,000-txn synthetic batch returns with correct summary maths.

## Working style

Work phase by phase, committing as you go. Ask before: choosing the final 16-category list, seeding `merchants_global`, or anything that would create resources outside this stack's tags. Never log raw transaction descriptions at INFO in production paths — structured logs carry `match_key` only.
