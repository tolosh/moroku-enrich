# Moroku Enrich — Transaction Enrichment Service, Specification v1

***Moroku Enrich*** *(`enrich.moroku.com`, repo `moroku-enrich`). Standalone AWS service, built with Claude Code. Kanopi is customer zero; the service is designed from day one to be sold to other Australian fintechs, brokers and advisers as a per-transaction enrichment API. Categorisation is the v1 feature; recurrence detection and merchant identity follow.*

*Status: decisions locked with Colin 2 Aug 2026 — see §9. Ready for phase 1 build.*

---

## 1. Why a service

Kanopi currently runs three divergent copies of a ~30-brand regex chain (`docuscan-webhook`, `recalculate-expenses`, `generate-freedom-report`). The strongest available signal (MCC) is stored and never read; unknown merchants silently default to `discretionary`, which inflates borrowing capacity under HEM shading — an RG 209 exposure, not just an accuracy problem.

As a shared service, every classification learned once serves every customer forever. The merchant dictionary becomes a compounding asset — the same thing Basiq, Frollo and Ntropy sell underneath, but Australian-specific and same-legal-entity for Kanopi (Moroku Pty Ltd), so no second data processor enters the CDR story.

**Design principles**

1. **Deterministic first.** MCC tables and dictionary lookups give the same answer every time and cite their reason. The LLM classifies each unknown merchant *once*, then its cached answer is deterministic too.
2. **Auditable.** Every response carries `source`, `confidence` and `engine_version`. "Groceries because MCC 5411, engine 1.2.0" is a defensible RG 209 statement; a regex chain is not.
3. **Conservative fallback.** Unknown spend is flagged `unverified` and classified `essential`, never silently `discretionary`. Affordability must not be flattered by ignorance.
4. **Corrections are first-class.** When any consuming app recategorises a transaction, the app takes the correction locally *and* posts it back to the service. The service learns at the right scope (user → tenant → global) and the correction stream becomes labelled training data for the LLM tier.
5. **Tenant isolation, merchant-level sharing.** User- and tenant-scoped learning never leaks. Only merchant-level facts (canonical merchant → category), corroborated across independent sources, are promoted to the global dictionary. Merchant identities are not personal data once severed from the person.

---

## 2. Taxonomy

Taxonomy v1 is lifted verbatim from Kanopi's existing engine: the ~16 expense categories × 3 classifications (`essential` | `discretionary` | `financial_commitment`), plus two non-expense outcomes that today's engine drops on the floor and this service instead returns explicitly:

- `transfer` — internal transfers, cash advances, ATM (`excluded: true`); the caller decides whether to drop it.
- `income` — credits recognised as salary/benefits (phase 2; v1 processes debits and returns credits as `uncategorised_credit`).

The taxonomy is versioned (`taxonomy_version`) and served by `GET /v1/taxonomy` so consuming apps never hard-code it. Category changes are additive-only within a major version.

---

## 3. API contract

Base URL `https://enrich.moroku.com`. Auth: per-tenant bearer key (`Authorization: Bearer mk_live_…`) validated by a **Lambda authorizer on an HTTP API (v2)** — not REST-API usage plans, which HTTP APIs don't support. Keys are stored SHA-256-hashed in a `tenants` table (tenant id, name, status, plan); the authorizer resolves key → tenant context, and its result is cached ~5 minutes keyed on the token. Per-tenant rate limiting is a soft quota enforced in the authorizer (counters in DynamoDB) with stage-level throttling as the hard backstop — real metering arrives with the second tenant. OAuth client-credentials later if a customer requires it. All endpoints JSON. All writes idempotent via `Idempotency-Key` header.

### 3.1 `POST /v1/categorise` — batch categorisation

Up to 1,000 transactions per call. Stateless per call except for lookups.

Request (per transaction):

```json
{
  "transactions": [
    {
      "id": "client-supplied opaque id (echoed back)",
      "description": "SQ *THE DAILY GRIND 4821 SYDNEY AU",
      "mcc": "5814",                  // optional — open banking has it, statements don't
      "amount": -5.60,                // signed; negative = debit
      "currency": "AUD",
      "date": "2026-07-14",
      "source_category_code": "GROC", // optional — e.g. DocuScan's code
      "source_category_description": "Groceries", // optional
      "account_type": "transaction",  // optional: transaction | credit_card | savings
      "user_ref": "opaque per-tenant user id"     // enables user-scoped overrides
    }
  ]
}
```

Response (per transaction, same order, `id` echoed):

```json
{
  "results": [
    {
      "id": "…",
      "category": "dining_entertainment",
      "classification": "discretionary",
      "confidence": 0.97,
      "source": "dictionary",   // exclusion | user_override | tenant_override | mcc | dictionary | rules | llm_cache | fallback
      "excluded": false,        // true for transfer/atm/cash-advance
      "flags": [],              // e.g. ["unverified"] on fallback, ["low_confidence"] under threshold
      "merchant": {
        "canonical_name": "The Daily Grind",
        "match_key": "the daily grind",
        "normalised_from": "SQ *THE DAILY GRIND 4821 SYDNEY AU"
      },
      "engine_version": "1.0.0",
      "taxonomy_version": "1"
    }
  ],
  "summary": {
    "count": 143,
    "confident_pct": 0.91,      // share with confidence ≥ 0.8 — the report-level trust number
    "by_source": { "mcc": 61, "dictionary": 54, "rules": 12, "llm_cache": 9, "fallback": 7 }
  }
}
```

`summary.confident_pct` is deliberately surfaced so Kanopi can print "**91% of spend confidently categorised**" on every report — the accuracy KPI and the sales number.

### 3.2 `POST /v1/corrections` — the learning loop

**This is the contract Colin specified: when any transaction is recategorised in a consuming app, the app applies the recategorisation for itself immediately, and posts it here so the model learns.** Subsequent `/v1/categorise` calls reflect the correction (user scope is effective immediately), so the app's local copy is a latency optimisation, not a source of truth.

Request:

```json
{
  "corrections": [
    {
      "transaction_id": "the id previously sent to /categorise (optional but preferred)",
      "description": "SQ *THE DAILY GRIND 4821 SYDNEY AU",
      "mcc": "5814",
      "amount": -5.60,
      "date": "2026-07-14",
      "user_ref": "opaque per-tenant user id",
      "previous_category": "other_expenses",
      "corrected_category": "dining_entertainment",
      "corrected_classification": "discretionary",   // optional; defaults to taxonomy default
      "scope_hint": "merchant",   // "merchant" = applies to this merchant generally; "transaction" = one-off
      "actor": "consumer"         // consumer | adviser | admin — advisers corroborate faster.
                                  // Decision (2 Aug 2026): Kanopi wires CONSUMER corrections only for now;
                                  // the actor field stays in the contract so adviser weighting is a
                                  // frontend change later, not an API change.
    }
  ]
}
```

Response (per correction):

```json
{
  "results": [
    {
      "accepted": true,
      "applied_scope": "user",            // user | tenant | global_pending | global
      "match_key": "the daily grind",
      "supersedes": "prior user override id or null"
    }
  ]
}
```

**Learning tiers and promotion rules:**

1. **User scope (immediate).** `(tenant, user_ref, match_key) → category`. Authoritative for that user on the next categorise call. This replaces Kanopi's `transaction_category_learning` owner-scoped rows.
2. **Tenant scope.** When ≥ 3 distinct `user_ref`s in a tenant agree on the same `match_key → category` (or one `actor: adviser|admin` correction — a path that stays dormant until Kanopi wires adviser corrections), a tenant-level mapping is written. Applies to all of that tenant's users without their own override.
3. **Global promotion (guarded).** A merchant mapping is promoted to the global dictionary when corroborated by ≥ 2 independent tenants *or* ≥ 5 distinct users, with no competing category holding ≥ 30% of corrections for that key. Promotion writes to a review queue first while volume is low (admin approves in the ops console); auto-promotion is a config flag to flip once trust is established. **One tenant can never write the global dictionary alone** — this is the poisoning guard.
4. **Conflicts.** If corrections for a key genuinely split (e.g. AMAZON = shopping vs subscriptions), the key is marked `ambiguous`; the service keeps per-user learning and lowers global confidence rather than thrash.

Every correction is appended to an immutable `corrections_log` (tenant, user_ref, before/after, actor, timestamp) — the audit trail, and the labelled dataset for evaluating and later fine-tuning the LLM tier.

**`scope_hint: "transaction"`** records a one-off recategorisation (e.g. "this particular Kmart purchase was a gift") in the log without touching any mapping — apps need this so one-offs don't corrupt merchant learning.

### 3.3 Supporting endpoints

- `GET /v1/taxonomy` — categories, classifications, versions.
- `GET /v1/merchants/{match_key}` — current mapping, source, confidence, correction count (tenant-scoped view; global fields visible to all).
- `GET /v1/overrides?user_ref=…` — a user's learned overrides; `DELETE /v1/overrides/{id}` revokes one (writes to the log; never hard-deletes history).
- `GET /v1/health` — liveness + current engine/taxonomy versions.
- **Phase 2:** `POST /v1/analyse/recurrence` — takes a window of already-categorised transactions, returns detected recurring series (merchant, cadence, amount band, type: subscription | rent | loan_repayment | insurance | bnpl_instalment). Kept out of v1 because it is stateful and must not delay the accuracy jump.

---

## 4. The signal chain

Evaluated in priority order; first hit wins. Every input path gets the full chain — statements simply have no MCC, so step 3 is skipped for them.

| # | Signal | Source label | Notes |
|---|--------|--------------|-------|
| 1 | Exclusions | — | transfer/ATM/cash-advance codes (`TNFC`/`OTFD`) and patterns → `transfer`, `excluded: true`, confidence 1.0. Returned, not dropped. |
| 2 | User override | `user_override` | `(tenant, user_ref, match_key)` lookup. Confidence 1.0. |
| 2b | Tenant override | `tenant_override` | `(tenant, match_key)` lookup. Confidence 0.98. |
| 3 | **MCC table** | `mcc` | ISO 18245 → taxonomy, ~300-row static table shipped in code, versioned with the engine. Priority cues live here as MCC-level facts (5541/5542 fuel → `vehicle_running` regardless of "Coles Express"). Confidence 0.95. |
| 4 | **Global dictionary** | `dictionary` | normalise description → `match_key` → canonical merchant → category. The compounding asset. Confidence stored per row (0.85–0.98). |
| 5 | Rules | `rules` | Today's regex chain, ported once into the shared module as the legacy floor, ordered and tested. Includes the fuel/cinema priority cues for MCC-less inputs. Confidence 0.7. |
| 6 | **LLM cache / classify** | `llm_cache` | Unknown `match_key` → queued for one-time Bedrock classification (batched, async). If already cached, served synchronously. Model returns category + confidence; below 0.6 it is *not* trusted (falls through to 7). Cache is per-merchant, global, versioned by prompt. |
| 7 | Conservative fallback | `fallback` | `other_expenses` / **`essential`** / `flags: ["unverified"]`. Never `discretionary`. |

**LLM tier detail.** Synchronous categorise calls never wait on the LLM. First sighting of an unknown merchant returns the fallback (flagged), and the merchant key goes onto an SQS queue; a worker batches unique unknown keys (~2–5k distinct merchants total, not per-user), classifies them with Claude Haiku on Bedrock using the taxonomy + few-shot examples drawn from the corrections log, and writes the cache. The consuming app can re-poll or simply benefit on the next sync. Cost is trivial (thousands of classifications once, not millions per month).

**Merchant normaliser.** Deterministic pipeline before any dictionary/LLM lookup: uppercase → strip payment-gateway prefixes (`SQ *`, `PAYPAL *`, `ZIP *`, `EZI*`, `SP * `, `TST* `) → strip trailing store/terminal numbers, dates, card fragments (`xx1234`) → strip trailing location tokens (suburb + state + `AU`) → collapse whitespace → `match_key`. The pipeline is pure-function and heavily unit-tested; its version is part of `engine_version` because changing it re-keys the dictionary.

---

## 5. Data model (DynamoDB, single-table-per-concern)

| Table | PK / SK | Contents |
|---|---|---|
| `tenants` | `key_hash` | tenant_id, name, status (`active` \| `suspended`), plan, quota, created_at — the Lambda authorizer's lookup table; GSI on tenant_id for admin listing |
| `merchants_global` | `match_key` | canonical_name, category, classification, confidence, source (`llm` \| `promoted` \| `seed`), correction_count, ambiguous flag, updated_at |
| `overrides` | `tenant#user_ref` / `match_key` | user-scope learning; SK pattern `TENANT#match_key` for tenant scope rows |
| `corrections_log` | `tenant` / `ts#uuid` | append-only; full before/after payload; the training dataset |
| `llm_cache` | `match_key#prompt_version` | raw model output, category, confidence, model id, classified_at |
| `promotion_queue` | `match_key` | pending global promotions awaiting corroboration/approval |

MCC table and taxonomy ship as versioned code (they change with releases, not at runtime). Seed `merchants_global` at launch from (a) Kanopi's existing brand lists, (b) the global rows of `transaction_category_learning`, (c) a one-time LLM pass over Kanopi's historical distinct merchant strings — so the service beats the old engine on day one.

---

## 6. AWS architecture

Boring on purpose; near-zero idle cost; a Claude Code-sized build.

- **API Gateway** (HTTP API v2) — Lambda authorizer per §3 (bearer key → hashed lookup in `tenants`, ~5 min identity-based cache); stage-level throttling as backstop, per-tenant soft quotas in the authorizer. Request validation happens at the handler boundary with zod — HTTP APIs lack REST-API model validation, and zod gives better error messages anyway.
- **Lambda** (Node 22 / TypeScript) — `categorise` handler (sync), `corrections` handler (sync), `llm-classifier` worker (SQS-triggered), `promotion` worker.
- **DynamoDB** — tables above, on-demand billing.
- **SQS** — unknown-merchant queue (with DLQ).
- **Bedrock** — Claude Haiku for the classifier tier.
- **CloudWatch** — structured logs, dashboards: `confident_pct` by tenant, source mix, fallback rate, LLM queue depth, correction volume. Alarm on fallback rate > 15%.
- **CDK** (TypeScript) — whole stack as one app; `dev` and `prod` stages; secrets in SSM.

**Account & region (decision, 2 Aug 2026):** deploy into the **Moroku Dev Sandbox** account — **932027117528** (`aws+devsandbox@moroku.com`) — region `ap-southeast-2` (Sydney), as the starting environment. CDK stages make promotion to a production account later a redeploy, not a rebuild. Because the account is shared, the CDK app must be strictly self-contained: everything tagged `project:moroku-enrich`, its own IAM roles with least privilege, no reliance on pre-existing resources, and a cost-allocation tag activated so Enrich's spend is separable on the bill from day one (this substitutes for the account-level billing separation a dedicated account would have given). Confirm Bedrock Haiku availability in Sydney during setup; cross-region inference within AWS is the fallback — acceptable because the LLM tier only ever sees merchant strings, never amounts or user identifiers. **Needed at kickoff: account ID / SSO profile and confirmation of region.**

Non-functional targets: p95 < 300 ms for a 1,000-txn batch with warm caches; 99.9% availability; all lookups batched (`BatchGetItem`) — one round-trip per tier, not per transaction. Engine version stamped on every result enables **replay**: re-running a historical batch on a pinned version reproduces the report exactly (RG 209 audit).

---

## 7. Kanopi integration (customer zero)

1. **One client, both paths.** `_shared/categoriseClient.ts` in Supabase Edge Functions wraps the API: batches, 2 s timeout, retry once. `docuscan-webhook` and `recalculate-expenses` both call it; their embedded rule chains are deleted. `generate-freedom-report`'s `mapCategory()` collapses to a lookup on the taxonomy endpoint's benchmark mapping.
2. **Degrade gracefully.** On timeout/5xx, fall back to the current legacy function (kept as a frozen module, clearly marked) so report generation never depends on service uptime. Log the degradation to `audit_log`.
3. **Wire the corrections loop — consumers only for v1.** On the consumer-facing report screens, the existing write to `transaction_category_learning` is replaced by: apply locally → `POST /v1/corrections` (`user_ref` = Kanopi user id, `actor: consumer`). Adviser recategorisation UI is deferred; when it lands it sends `actor: adviser` and gets one-step tenant corroboration with no API change. Migrate existing learning rows into `overrides` (owner-scoped → user scope; global rows → seed candidates).
4. **Surface the trust number.** `summary.confident_pct` and per-transaction `flags` flow into `expenses` provenance; Affordability and Freedom reports print "X% of spend confidently categorised" and list unverified spend for adviser review instead of silently calling it discretionary.
5. **Provenance.** Store `source`, `confidence`, `engine_version` per transaction alongside the category — the RG 209 audit answer.

---

## 8. Build phases

| Phase | Scope | Effort feel |
|---|---|---|
| **1 — Core service** | CDK stack, normaliser, MCC table, ported rules, dictionary lookups, categorise + corrections endpoints, seed data, unit tests against Kanopi's historical transactions as fixtures | The bulk of v1 |
| **2 — LLM tier** | SQS worker, Bedrock classifier, cache, one-time backfill over Kanopi's distinct merchants | Small |
| **3 — Kanopi cutover** | Shared client, delete duplicate engines, corrections wiring, learning-table migration, report trust number | Medium |
| **4 — Recurrence engine** | `/v1/analyse/recurrence`: cluster by match_key + amount tolerance + period; emits subscriptions, rent, loan repayments, insurance, BNPL instalments | The next big win |
| **5 — Productise** | Ops console (promotion queue, tenant dashboards), API docs, pricing (per-1k transactions), second-tenant onboarding | When a prospect exists |

**Acceptance for phase 3 cutover:** on a replay of existing Kanopi datasets, `confident_pct` ≥ 85% (vs ~long-tail-to-`other_expenses` today), zero regressions on the existing fuel/cinema priority-cue tests, and both data paths producing identical categories for identical inputs.

---

## 9. Decisions — locked with Colin, 2 Aug 2026

1. **Taxonomy** — freeze the current 16 Kanopi categories verbatim as taxonomy v1, plus the additive `transfer` / `uncategorised_credit` outcomes. Exact list to be extracted from the current Kanopi code as the first build step. Restructuring deferred to a future v2.
2. **AWS** — deploy into the existing **Moroku Dev Sandbox** account, **932027117528** (`aws+devsandbox@moroku.com`), `ap-southeast-2`, to start. Strict tagging + isolated IAM + cost-allocation tag per §6. Promote to a production account later via CDK stages.
3. **Promotions** — **manual approval first** via a simple admin page; flip to auto-promotion once reversal rate proves near-zero. Ambiguous keys stay manual permanently.
4. **Corrections actors** — **consumers only for v1.** The `actor` field remains in the API contract; adviser-weighted corrections become a frontend change later, not an API change.
5. **Name** — **Moroku Enrich**, committed now: repo `moroku-enrich`, domain `enrich.moroku.com`, docs and API branded Enrich from day one. Nothing to rename later.
