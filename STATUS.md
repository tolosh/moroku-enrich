# Moroku Enrich — Build Status & Handover

_Last updated: 2026-08-02. Phase 1 (core service). Reader is assumed to have the
spec (`docs/moroku-enrich-spec.md`, now the corrected HTTP API v2 copy) and this
repo, but none of the originating conversation. Read this file top to bottom
before writing code._

---

## 1. What is built and working

`npm run build` (`tsc --build`, all projects), `npm test` (**92 pass, 2 todo**)
and `npm run synth` (`cdk synth`, dev) are all **green**. Nothing is deployed;
no AWS resources exist.

- **Monorepo** — npm workspaces: `packages/{taxonomy,engine,service-lib}`,
  `services/{authorizer,categorise,corrections,read,classifier,promotion}`,
  `infra`. TypeScript strict, Vitest, Prettier.
- **Taxonomy v1** (`packages/taxonomy`) — classifications frozen, the two
  non-expense outcomes defined, helpers + `taxonomyDocument()`.
  `EXPENSE_CATEGORIES` intentionally **empty** (blocked input — see §2).
- **Merchant normaliser** (`packages/engine`) — unchanged from last session, 37
  tests.
- **Signal chain** (`packages/engine`, spec §4) — full priority chain wired
  end-to-end and **pure** (injected `LookupContext`, zero AWS): exclusion → user
  override → tenant override → MCC → dictionary → rules (empty floor) → llm_cache
  (trust threshold) → conservative fallback. Fallback forces
  `other_expenses`/`essential`/`["unverified"]`, overriding the taxonomy default;
  a test proves it **never emits `discretionary`**.
- **MCC table** (`packages/engine`) — typed ISO 18245 → taxonomy, confidence
  0.95, fuel 5541/5542 → `vehicle_running`; every target via the placeholder
  registry. Representative cross-section (~90 codes), extensible to the full ~300.
- **Placeholder category registry** (`packages/engine/src/categories.ts`) — the
  sanctioned bridge for decision §9.1 (see §3.1).
- **service-lib** (`packages/service-lib`) — HTTP + DynamoDB glue so the engine
  stays pure: zod schemas, `Repository` (DynamoDB impl + `InMemoryRepository`),
  batched `LookupContext`, tenant-context extraction, EMF metrics, the pure
  learning-tier logic, key encoding, config loader.
- **Lambda authorizer** (`services/authorizer`) — **real**: bearer `mk_live_…` →
  SHA-256 → `tenants` GetItem → tenant context. Never stores/echoes raw keys.
- **API handlers** (`services/{categorise,corrections,read}`) — real, zod-
  validated, injectable (`makeXHandler(repo, cfg)` + a default export):
  - `POST /v1/categorise` — batch, per-tier batched lookups, engine chain,
    summary (`confident_pct`, `by_source`), enqueues unknown merchants.
  - `POST /v1/corrections` — learning tiers (user immediate; tenant ≥ 3 users or
    adviser/admin; global → promotion_queue candidate only), immutable log,
    Idempotency-Key replay. **No merchants_global write path exists** (guard).
  - `read` — `/v1/taxonomy`, `/v1/merchants/{match_key}`, `/v1/overrides`,
    `DELETE /v1/overrides/{id}` (logs a revocation), `/v1/health` (unauth).
- **CDK stack** (`infra`, spec §6) — HTTP API v2 + Lambda authorizer (5 min
  identity cache) + stage throttling; six DynamoDB tables incl. `tenants`
  (PK `key_hash`, GSI `tenant_id-index`); SQS queue + DLQ; six Lambdas
  (nodejs22.x, arm64, esbuild, aws-sdk externalised); CloudWatch dashboard +
  fallback-rate alarm (> 15%); SSM config `/moroku-enrich/dev/config/*`;
  least-privilege per-Lambda IAM; everything tagged `project:moroku-enrich`,
  `stage:dev`.

Git: on `master`, several commits. Nothing deployed.

## 2. What is blocked / deliberately incomplete

- **`EXPENSE_CATEGORIES` is empty** (blocked: verbatim 16-category list). Guard
  test `packages/taxonomy/test/taxonomy.test.ts` asserts `.toBe(0)` with an
  `it.todo`. When the list lands: populate verbatim, **flip `.toBe(0)` →
  `.toBe(16)` and the `it.todo` into a real test**, then reconcile the
  placeholder registry (§3.1) — the `categories.test.ts` guard flips
  automatically once the taxonomy is non-empty.
- **Rules tier is an empty ruleset** (blocked: merged Kanopi regex). `RULES = []`
  in `packages/engine/src/rules.ts`; the tier is wired and tested, so the real
  chains drop in without touching `applyRules` or the chain.
- **`classifier` and `promotion` Lambdas are stubs** — phase 2 (Bedrock Haiku;
  `LLM_TIER_ENABLED=false`) and the async global-corroboration/approval worker.
- **Credit handling deferred.** Spec §2 says v1 returns credits as
  `uncategorised_credit`; the engine chain (per the kickoff's explicit tier list)
  does not yet branch on credits, and the source-label for that outcome is
  unresolved. Debits categorise correctly; a credit currently falls through to
  fallback. Wire at the handler boundary once the source label is decided. See §4.
- **MCC table is a representative subset**, not the full ~300 rows (structure +
  lookup + fuel cue are done; remaining rows are additive).

## 3. Decisions taken this session (context for reviewers)

The stale-spec warning is **resolved**: `docs/moroku-enrich-spec.md` is the
corrected HTTP API v2 copy and is committed. Spec §6 is authoritative again.

### 3.1 Placeholder category mechanism (decision §9.1)
`packages/engine/src/categories.ts` is the **single source of truth** for
category ids used by structural code (MCC, rules, fallback). Ids given directly
by the spec/kickoff are bound now (`other_expenses`, `vehicle_running`,
`dining_entertainment`, `groceries`); every other concept is a `__pending__:`
sentinel that cannot be mistaken for a real id. `reconcileCategories()` + a gated
test are the tripwire: once `EXPENSE_CATEGORIES` is populated they assert no
sentinel remains and every bound value is a real id. Rebinding is a one-file
change; no tier logic moves. `EXPENSE_CATEGORIES` itself stays empty.

### 3.2 Other decisions
- **`service-lib` package** holds all AWS/HTTP glue so `packages/engine` stays
  pure (no AWS imports). Handlers are thin and injectable for testing.
- **Six Lambdas.** The kickoff's "four Lambdas" = spec §6's compute set
  (categorise, corrections, classifier, promotion). Added: the **authorizer**
  (its own function) and a **read** handler (serves taxonomy/merchants/overrides/
  health — the scaffolded `services/read` dir). Nothing from spec §6 dropped.
- **Idempotency store** lives in the `corrections_log` table under a namespaced
  `IDEMP#<tenant>` partition (TTL `expires_at`), so no 7th table was added.
  `corrections` Lambda therefore has read+write on `corrections_log`.
- **Overrides key encoding** (single-table, `pk`/`sk`): user =
  `T#<tenant>#U#<user> / M#<match_key>`; tenant = `T#<tenant> / TENANT#<match_key>`;
  agreement aggregate = `AGG#<tenant> / <match_key>#<category>`. All in
  `packages/service-lib/src/keys.ts`.
- **Global corroboration** is accumulated per correction into a promotion_queue
  document (pure `mergeCorroboration`); the handler only enqueues **candidates**.
  Rigorous ≥2-tenant / competing-share enforcement + manual approval belongs to
  the promotion **worker** (reads `corrections_log`) — not yet built.
- **infra `exactOptionalPropertyTypes` relaxed for the `infra` project only**
  (aws-cdk-lib widget types trip it); `packages/*` stay fully strict.
- **zod `.default()` fields** infer as `T | undefined` in this zod version;
  handlers coalesce (`?? "consumer"`) rather than trust the inferred type.
- **CDK account/region default to 932027117528 / ap-southeast-2** so `cdk synth`
  runs offline. A real deploy still resolves creds — verify the account first.

## 4. Open questions

- **`other_expenses` — RESOLVED.** One of the 16 categories; keeps its taxonomy
  default on rule/dictionary paths; the **fallback path** forces `essential` and
  flags `unverified`. Implemented + tested.
- **Credit → `uncategorised_credit` source label.** The response `source` enum
  (spec §3.1) has no credit tier. Decide how a returned credit is labelled before
  wiring credit handling (see §2).
- **MCC → classification while taxonomy is empty.** MCC/rule results derive
  classification from the taxonomy default, which is unavailable until
  `EXPENSE_CATEGORIES` lands, so they currently fall back to `essential`. Correct
  automatically once the taxonomy is populated — no code change.

## 5. Next concrete steps, in order

1. **When the blocked inputs land:** populate `EXPENSE_CATEGORIES` verbatim; flip
   the taxonomy guard (`.toBe(16)` + real test); reconcile the placeholder
   registry (rebind `__pending__` concepts, confirm bound ids); port the merged
   Kanopi ruleset into `RULES`. Pin fuel/cinema priority cues with zero-regression
   tests (spec §8).
2. **Deploy to dev** (only after the above make the smoke test meaningful):
   `aws sts get-caller-identity` **must be 932027117528** (build brief);
   **stop and ask before `cdk deploy` or creating any AWS resource.** Then seed
   `tenants` (a hashed `mk_live_…` key) + `merchants_global`, and smoke-test.
3. **Phase 2** — classifier (Bedrock Haiku, cache keyed `match_key#prompt_version`,
   reject < 0.6, merchant-strings-only) and the promotion worker (cross-tenant
   corroboration, competing-share, manual approval → merchants_global).

## 6. Gotchas

- **Taxonomy guard + placeholder reconcile test** both flip the moment
  `EXPENSE_CATEGORIES` becomes non-empty — update the assertion (§2) or the suite
  goes red.
- **`cdk` is not global** — use `npm run synth` / `npx cdk` (infra devDep).
- **Build before synth** — esbuild bundles handlers from the workspace packages'
  `dist`, so `npm run build` must run first (already part of a clean flow).
- **AWS identity** — account `932027117528` (ap-southeast-2). Re-verify before any
  deploy.
- **Bedrock Haiku in ap-southeast-2** unconfirmed — check during phase 2;
  cross-region inference is the sanctioned fallback (LLM sees merchant strings only).
- Vitest prints EMF metric JSON to stdout during handler tests — benign.

## 7. How to run

```
npm install
npm run build   # tsc --build, all projects — must stay green
npm test        # 94 tests (92 pass, 2 todo)
npm run synth   # cdk synth (dev) — must pass; does NOT deploy
```
