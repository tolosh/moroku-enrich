# Moroku Enrich — Build Status & Handover

_Last updated: 2026-08-03. Phase 1 (core service) + extensions 001/002 applied
and **deployed to dev**. Reader is assumed to have the spec
(`docs/moroku-enrich-spec.md`), the two extension specs (`docs/extensions/`), and
this repo, but none of the originating conversation. Read this file top to bottom
before writing code._

---

## 0. Deployment (dev) — LIVE

First dev deploy done 2026-08-03 into the Moroku Dev Sandbox
(**932027117528** / **ap-southeast-2**) via CDK. Smoke test passed end-to-end.

- **Stack:** `MorokuEnrich-dev` (bootstrap qualifier `hnb659fds`).
- **Public URL:** `https://enrich.moroku.digital` (ext-003) — verified live over a
  valid ACM cert (`CN=enrich.moroku.digital`, Amazon RSA 2048 M04, exp 2027-02-16).
- **API base URL (fallback):** `https://rspyx0mz34.execute-api.ap-southeast-2.amazonaws.com`
  — stays enabled; Kanopi's shadow client uses it until the `ENRICH_API_URL`
  secret is switched to the custom domain.
- **Custom domain (ext-003):** ACM cert DNS-validated via GoDaddy (external DNS).
  Two public CNAMEs now live in the `moroku.digital` zone (GoDaddy Name form):
  - validation: `_624aca0b0d7d98b1a0ec02a3d50f8b6c.enrich` → `…acm-validations.aws`
  - alias: `enrich` → `d-myqy4nmd6b.execute-api.ap-southeast-2.amazonaws.com`
  Regional apigw v2 DomainName (TLS 1.2) + root ApiMapping to `$default`; the
  same construct re-points at a prod stage later by changing one mapping.
- **Dashboard:** `moroku-enrich-dev` · **Queue:** `moroku-enrich-dev-unknown-merchant`
- **Seeded tenant:** Kanopi (`tenant_id: kanopi`), plan `internal`, status
  `active`, in **both** `test` and `live` environments. Keys are held in the team
  password manager (never stored in this repo).
- **Deploy identity:** IAM user `moroku-enrich-deploy` — assumes the CDK
  `cdk-hnb659fds-*` roles (needs `sts:AssumeRole` on them) **and** has scoped
  DynamoDB data access + `sqs`/`cloudwatch` read for seeding/verification. Both
  policy statements must coexist (a data-only policy that drops the assume-role
  statement breaks `cdk deploy`).
- **LLM tier is OFF** (`/moroku-enrich/dev/config/llm-tier-enabled=false`): the
  classifier's SQS event source is **disabled**, so unknown-merchant keys
  accumulate on the queue unconsumed. Flip the SSM flag + redeploy to enable.
- **Redeploy:** `AWS_PROFILE=enrich-deploy npm run build && (cd infra && npx cdk deploy --context stage=dev --require-approval never)`.

## 1. What is built and working

`npm run build` (`tsc --build`, all projects), `npm test` (**126 pass, 0 todo**)
and `npm run synth` (`cdk synth`, dev) are all **green**, and the stack is
deployed to dev (§0).

- **Monorepo** — npm workspaces: `packages/{taxonomy,engine,service-lib}`,
  `services/{authorizer,categorise,corrections,read,classifier,promotion}`,
  `infra`, `scripts`. TypeScript strict, Vitest, Prettier.
- **Taxonomy v1** (`packages/taxonomy`) — **15 verbatim Kanopi categories** +
  default classifications (ext-002 §1). Guard test asserts `.toBe(15)`. Plus the
  non-expense outcomes `transfer` / `uncategorised_credit`.
- **Engine** (`packages/engine`, pure, zero AWS):
  - Merchant normaliser (37 tests).
  - Full spec §4 signal chain: exclusion → **credit** → user/tenant override →
    MCC → dictionary → rules → llm_cache → fallback. Injected `LookupContext`.
  - **Credit branch**: amount > 0 → `uncategorised_credit`, `excluded: true`,
    source `credit`, confidence 1.0 (income recognition proper is phase 2).
    Excluded results (transfers + credits) are removed from `confident_pct` and
    the fallback-rate denominators.
  - Fallback forces `other_expenses`/`essential`/`["unverified"]`; a test proves
    it never emits `discretionary`.
  - **Category registry reconciled** — every `CATEGORY.*` binds a real taxonomy
    id; no `__pending__` sentinels; reconciliation tripwire passes.
  - **MCC table** completed against real ids (fuel 5541/5542 → vehicle_running,
    7011 → other_expenses, 6513 → rent, …); every row targets a valid category.
  - **Rules tier** — merged word-bounded Kanopi chain (2 priority cues + 14
    rules) at conf 0.7; all six ext-002 §3 deviations pinned; baseline
    regressions green through the full chain.
- **service-lib** (`packages/service-lib`) — HTTP/DynamoDB glue: zod schemas,
  `Repository` (DynamoDB + `InMemoryRepository`), batched `LookupContext`, tenant
  context, EMF metrics, learning-tier logic, key encoding, config, **usage
  metering** (`incrementUsage`), **tenant-key issuance** (`tenant-keys.ts`).
- **Lambda authorizer** (`services/authorizer`) — bearer `mk_test_`/`mk_live_` →
  SHA-256 → `tenants`; passes plan + environment; denies suspended (cache-lag
  documented). Pure helpers in `authorize.ts`.
- **API handlers** (`services/{categorise,corrections,read}`) — zod-validated,
  injectable. categorise + corrections meter usage atomically (test/live split).
- **CDK stack** (`infra`) — HTTP API v2 + authorizer; **seven** DynamoDB tables
  (spec §5 five + `tenants` + `usage`); SQS + DLQ; six Lambdas; dashboard +
  fallback-rate alarm; SSM config; least-privilege IAM; tagged
  `project:moroku-enrich`, `stage:dev`.
- **Admin scripts** (`scripts`, run with tsx) — `issue-tenant-key.ts` (default
  `--plan internal`, refuses external plans without `--allow-external`, prints
  plaintext once, stores hash only), `revoke-tenant-key.ts` (suspend by key_hash
  or tenant_id). Kanopi seed commands documented in `scripts/README.md`.

## 2. What is deferred / not yet built (nothing is blocked)

- **`classifier` and `promotion` Lambdas are stubs** — phase 2 (Bedrock Haiku,
  `LLM_TIER_ENABLED=false`) and the async global-corroboration/approval worker
  (cross-tenant ≥2-tenant + competing-share enforcement → merchants_global).
- **Income recognition** (spec §2 phase 2) — credits are returned as
  `uncategorised_credit`; salary/benefit recognition is later.
- **ext-001 §4 deferred items** — trial-corrections quarantine, developer-
  agreement workflow, one-time secret-link delivery, invoicing, ops portal. The
  schema already carries every field these need; do NOT build them now.
- **Seed data** — `merchants_global` seeding and the Kanopi tenant rows are a
  deploy-time step (scripts + seed exist; run at first deploy).

## 3. Key decisions & mechanisms (context for reviewers)

- **Credit branch** wired like transfers (excluded from spend denominators) so it
  never pollutes `confident_pct` or the fallback-rate alarm. Source enum gained
  `credit`.
- **ext-002 §0: taxonomy is 15, not 16.** Guards flipped to 15. The category
  registry (`packages/engine/src/categories.ts`) is the single source of truth;
  MCC/rules/fallback reference `CATEGORY.*`. Concepts absent from taxonomy v1
  (retail, travel, personal care, government, …) resolve to `other_expenses`.
- **`other_expenses`** defaults `discretionary` as a taxonomy default; the
  fallback path still forces `essential` + `unverified`. Rule/dictionary hits on
  it keep the discretionary default.
- **Rules** match on source-category code OR the lowercased haystack
  (source_category_description + normalised key), word-bounded (fixes the
  substring-`includes` "current" → rent bug). Priority cues evaluate first.
- **ext-001 usage table** — PK `tenant_id` / SK `<environment>#<month>` so test
  and live counters are distinct rows under one tenant_id (satisfies acceptance
  test 3 while staying per-month). `incrementUsage` is one atomic ADD per request.
- **Key gate** — the only key-creation path (the issuance script) enforces
  internal-only access; `assertPlanAllowed` refuses external plans without
  `--allow-external`. Keys stored SHA-256-hashed only.
- **service-lib / scripts** keep AWS out of `packages/engine` (still pure).
- **infra `exactOptionalPropertyTypes` relaxed for `infra` only** (aws-cdk-lib
  types); zod `.default()` fields are coalesced in handlers.
- **Unknown-merchant enqueue is unconditional** (spec §4); the *classifier's*
  SQS event source is what's gated by the LLM-tier flag. Verified in dev: with
  the tier off, a first-sighting unknown lands on the queue and sits unconsumed.

## 4. Open questions — none outstanding

Both prior flags are resolved: the credit branch (step 1) and the blocked
taxonomy/rules inputs (ext-002). No open questions block the build.

## 5. Next concrete steps, in order

1. **First dev deploy — DONE** (§0). Stack live, Kanopi seeded (test+live),
   smoke test green. Still outstanding: seed `merchants_global` with Kanopi's
   brand lists (a data step; the service works without it, just more fallbacks).
2. **Phase 2** — classifier (Bedrock Haiku, cache keyed `match_key#prompt_version`,
   reject < 0.6, merchant-strings-only) and the promotion worker (cross-tenant
   corroboration, competing-share, manual approval → merchants_global). Turning
   the tier on = flip `/moroku-enrich/dev/config/llm-tier-enabled` + redeploy
   (re-enables the classifier's SQS event source).
3. **Kanopi cutover** (spec §7) — shared client, delete duplicate engines,
   corrections wiring, learning-table migration, report trust number.

## 6. Gotchas

- **`cdk` is not global** — use `npm run synth` / `npx cdk` (infra devDep).
- **Build before synth** — esbuild bundles handlers from the workspace packages'
  `dist`, so `npm run build` must run first.
- **AWS identity** — account `932027117528` (ap-southeast-2). Re-verify before
  any deploy.
- **Scripts** need AWS creds + the deployed `tenants` table (run after deploy).
- **Bedrock Haiku in ap-southeast-2** unconfirmed — check during phase 2;
  cross-region inference is the sanctioned fallback (LLM sees merchant strings only).
- Vitest prints EMF metric JSON to stdout during handler tests — benign.

## 7. How to run

```
npm install
npm run build   # tsc --build, all projects — must stay green
npm test        # 126 tests, all pass
npm run synth   # cdk synth (dev) — must pass; does NOT deploy
```
