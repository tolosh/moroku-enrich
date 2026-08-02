# Moroku Enrich — Build Status & Handover

_Last updated: 2026-08-02. Phase 1 (core service). Reader is assumed to have the
spec (`docs/moroku-enrich-spec.md`) and this repo, but none of the originating
conversation. Read this file top to bottom before writing code._

---

## 1. What is built and working

- **Monorepo scaffold** — npm workspaces: `packages/{engine,taxonomy}`,
  `services/{categorise,corrections,read,classifier}` (empty dirs), `infra`
  (empty dir). TypeScript strict (`tsconfig.base.json`), Vitest, Prettier.
  `npm run build` (`tsc --build`) and `npm test` are **green**.
- **Merchant normaliser** — `packages/engine/src/normaliser.ts`. Pure function,
  zero AWS imports, implements the full spec §4 pipeline: uppercase → strip
  gateway prefixes (`SQ *`, `PAYPAL *`, `ZIP *`, `EZI*`, `SP * `, `TST* `, and a
  few aliases) → strip card fragments + embedded dates → strip trailing
  store/terminal numbers and trailing AU location tokens (country → state →
  gazetteer suburb) → whitespace-collapse → `{ match_key, canonical_name,
  normalised_from }`. **37 unit tests, all passing**, including the interleaved
  `...4821 SYDNEY AU` case (number sits _before_ the location suffix).
  Versioned via `NORMALISER_VERSION` in `packages/engine/src/version.ts`.
- **Taxonomy v1 structure** — `packages/taxonomy/src/index.ts`. Classifications
  frozen (`essential | discretionary | financial_commitment`), the two additive
  non-expense outcomes (`transfer`, `uncategorised_credit`) defined, plus
  validation/lookup helpers and `taxonomyDocument()` for `GET /v1/taxonomy`.
  **9 tests passing** (1 `todo`).

Git: two commits on the default branch. Nothing is deployed to AWS. No AWS
resources have been created (build brief requires asking before creating any).

## 2. What is in progress / deliberately incomplete

- **`packages/taxonomy` — `EXPENSE_CATEGORIES` is intentionally an empty array.**
  Per decision §9.1, the 16 Kanopi expense-category identifiers must be lifted
  **verbatim** from Kanopi's code and must not be invented. The structure,
  types, and helpers are ready; only the data is missing.
  - **Guard to be aware of:** `packages/taxonomy/test/taxonomy.test.ts` asserts
    `expect(EXPENSE_CATEGORIES.length).toBe(0)` and has an `it.todo(...)` for the
    16-category check. When you populate the list, **flip that assertion to
    `.toBe(16)` and convert the `it.todo` into a real test**, or the suite goes
    red the moment you add a category.
- **Everything downstream of the taxonomy is not started** because it references
  category identifiers: MCC table, rules tier, signal-chain orchestrator, the
  engine result type, fallback logic.
- **`services/*` and `infra` are empty directories.** No CDK, no handlers yet.

## 3. Decisions taken this session that are NOT yet in the repo's spec file

> ⚠️ The `docs/moroku-enrich-spec.md` in this repo is **stale on API auth**. A
> corrected copy is being supplied separately by Colin — do not edit the spec
> file yourself. Until it lands, treat the following as authoritative over spec §6.

1. **API Gateway: HTTP API v2 + Lambda authorizer** (NOT REST API usage plans).
   Spec §6's "API-key auth via usage plans" was an error — usage plans are a
   REST API (v1) feature, incompatible with the `Authorization: Bearer mk_live_…`
   contract in §3. REST v1 is rejected. Concretely:
   - **New `tenants` DynamoDB table** (a 6th table, beyond spec §5's five):
     - PK `key_hash` = SHA-256 of the bearer key (never store raw keys)
     - attrs: `tenant_id`, `name`, `status` (`active | suspended`), `plan`,
       `quota`, `created_at`
     - GSI on `tenant_id` for admin listing
   - **Lambda authorizer** resolves `key_hash` → tenant context, passed to
     handlers. Identity-source response caching, ~5 min TTL keyed on the token.
   - **Per-tenant rate limiting** = soft quota counters in DynamoDB enforced in
     the authorizer; **stage-level throttling on the HTTP API as the hard
     backstop**. No usage plans anywhere.
   - **Request validation with `zod`** at the handler boundary (HTTP APIs have no
     built-in model validation).
2. **Normaliser heuristics (design intent, so nobody "fixes" them):**
   - Suburb stripping is **gazetteer-gated and only fires after a state/country
     marker** (`SUBURB_TOKENS` in `normaliser.ts`). This is deliberately
     conservative: a brand word never in the gazetteer is never stripped, even
     at the cost of leaving some real suburbs in. `SUBURB_TOKENS` is a small seed
     set marked **REPLACEABLE** — extend it from real Kanopi merchant strings.
   - Trailing store-numbers and location tokens are stripped in a **fixpoint
     loop** because they interleave in the wild (`NAME 4821 SYDNEY AU`).
   - Rationale for accepting imperfect heuristics (e.g. `OFFICE 365` → `office`):
     the **same normaliser runs on both the corrections write-path and the
     categorise read-path**, so keys are internally consistent regardless. Favour
     consistency over perfect semantics.
3. **Node 24 locally; Lambda runtime target is `nodejs22.x`.** Don't pin local
   tooling to 22.
4. **Root `tsconfig.json` intentionally omits `services/*` and `infra`.** They
   have no `tsconfig.json`/source yet; referencing them makes `tsc --build` fail
   with "no inputs were found". **Add each reference back as you create it.**

## 4. Open question for Colin (still outstanding)

- Is the fallback bucket **`other_expenses` one of the 16 categories, or a
  separate 17th bucket?** The conservative fallback (spec §4 step 7) returns
  `other_expenses` / `essential` / `flags:["unverified"]`. Needed before wiring
  the fallback and the taxonomy list.

## 5. Next concrete steps, in order

1. **Unblock the taxonomy.** Get the 16 category identifiers + labels + default
   classifications from Kanopi's code, and Kanopi's two regex rule chains
   (statements + open-banking). Populate `EXPENSE_CATEGORIES` verbatim; flip the
   taxonomy guard test (§2 above); resolve the `other_expenses` question (§4).
2. **Engine result type + signal-chain orchestrator** (`packages/engine`, pure).
   Priority order: exclusions → user override → tenant override → MCC → global
   dictionary → rules → llm_cache → conservative fallback. Emits the full result
   record (`category, classification, confidence, source, excluded, flags,
   merchant{…}, engine_version, taxonomy_version`). Lookups are **injected** (the
   engine stays pure; the handler supplies batched DynamoDB results). Fallback
   must prove `essential` + `unverified`, **never `discretionary`** — pin with a
   test.
3. **MCC table (~300 rows, conf 0.95)** and **rules tier (port Kanopi regex
   union, conf 0.7)**. Fuel MCC 5541/5542 → `vehicle_running`; entertainment
   MCCs → `dining_entertainment`. Pin the current fuel/cinema behaviour with
   tests (zero-regression requirement, spec §8).
4. **CDK stack** (`infra`, HTTP API v2 + authorizer per §3 above). Resources:
   the 5 tables from spec §5 **plus `tenants`**, SQS unknown-merchant queue +
   DLQ, 4 Lambdas (`NodejsFunction`, `nodejs22.x`, esbuild), CloudWatch
   dashboard (`confident_pct`, source mix, fallback rate, queue depth, correction
   volume) + alarm on fallback rate > 15%, SSM config under
   `/moroku-enrich/dev/*`. Tag **everything** `project: moroku-enrich`,
   `stage: dev`; least-privilege per-Lambda IAM; no pre-existing resources.
   Add `aws-cdk` as an infra devDependency (not installed globally). **Synth
   locally; do not deploy until the engine is real and the smoke test is
   meaningful.**
5. **Handlers** (`categorise`, `corrections`, `read`) with `zod` validation,
   one `BatchGetItem` per lookup tier per request, `summary.confident_pct`,
   `Idempotency-Key` on writes; corrections learning tiers (user immediate;
   tenant ≥3 agreeing users; global → `promotion_queue` only, manual approval)
   and the poisoning guard (a single tenant can never write `merchants_global`).
   Then the **classifier stub** (SQS + Bedrock Haiku, `LLM_TIER_ENABLED=false`,
   `llm_cache` keyed `match_key#prompt_version`, reject < 0.6, enforce
   merchant-string-only in code). Then AU fixtures (marked replaceable), the
   full test matrix, and finally `cdk deploy` to dev + smoke test + dashboard
   verification.

## 6. Gotchas

- **Stale spec file** — see §3. Don't trust §6's API-auth wording.
- **Taxonomy guard test** flips red as soon as you add a category unless you also
  update the assertion — see §2.
- **AWS identity** — verified this session as account `932027117528`
  (ap-southeast-2), via IAM user `odyssey-simulator-deploy` (a shared-account
  user, not a dedicated role). Re-run `aws sts get-caller-identity` before any
  deploy and confirm the account, per the build brief.
- **`cdk` is not installed globally** — use `npx aws-cdk` or the infra
  devDependency once added.
- **Vitest prints a CJS-deprecation warning** — benign, ignore.
- **Bedrock Haiku availability in ap-southeast-2** is unconfirmed — check during
  CDK/classifier work; cross-region inference is the sanctioned fallback (the LLM
  tier only ever sees merchant strings).

## 7. How to run

```
npm install
npm test        # 46 tests (45 pass, 1 todo)
npm run build   # tsc --build, composite project refs — must stay green
```
