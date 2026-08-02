# Moroku Enrich — Extension 001: Developer Access, Key Issuance & Usage Metering

*Feature/security extension to `moroku-enrich-spec.md`. Self-contained: apply without modifying the base spec file. Supersedes any earlier conversational instructions about §10, tenant plans, or metering.*

*Apply at a natural break in the build — after the current work item completes, before starting the next. Commit this file to `docs/extensions/` when applying.*

---

## Context & decisions

Access to the Enrich API is **Moroku/Kanopi-only for the MVP**. Third-party developer onboarding (agreements, trials, billing) is a documented future model, not a build target. Two things are built now because they are near-free today and painful to retrofit: hashed key storage with a test/live split, and per-tenant usage metering. Kanopi's metered usage becomes the pricing evidence when the API opens to third parties later.

Decisions locked with Colin, 2 Aug 2026:

- **D-EXT1.1** MVP access = internal tenants only, enforced by the only key-creation path that exists (the issuance script), not by policy.
- **D-EXT1.2** Metering from day one; internal tenants are metered and billed $0.
- **D-EXT1.3** Future pricing is per-1k transactions categorised, not LLM cost passthrough; `llm_classifications_triggered` is tracked per tenant as the internal COGS number.
- **D-EXT1.4** Third-party machinery (developer agreement workflow, trial-corrections quarantine, one-time secret-link key delivery, self-serve portal) is **deferred** — documented in §4 below so it bolts on without schema or API-contract changes.

## 1. Schema changes

**`tenants` table** — add attributes (PK remains `key_hash`, GSI on `tenant_id` unchanged):

| Attribute | Values | Notes |
|---|---|---|
| `plan` | `internal` \| `trial` \| `commercial` | Only `internal` is creatable in MVP (see §2) |
| `environment` | `test` \| `live` | Test and live keys are separate rows; prefixes `mk_test_…` / `mk_live_…` |
| `quota` | number | Soft monthly transaction quota; authorizer-enforced later, stored now |
| `contact_email` | string | — |
| `agreement_version`, `agreement_signed_at` | string, ISO date | Unused in MVP; populated when third-party onboarding exists |

The Lambda authorizer passes `plan` and `environment` through to handlers in the tenant context.

**New `usage` table**:

| | |
|---|---|
| PK / SK | `tenant_id` / `month` (e.g. `2026-08`) |
| Counters | `transactions_categorised`, `corrections_received`, `llm_classifications_triggered`, plus `by_source.*` counters mirroring the categorise summary |
| Write pattern | One `UpdateItem` with `ADD` per request (atomic increment) — never read-modify-write |
| Role | Billing source of truth for future invoicing. Nothing in this service ever charges anyone. |

## 2. Key issuance & revocation (admin scripts, no UI)

- `scripts/issue-tenant-key.ts <name> --plan <plan> --env <test|live>`
  - Generates the key with the correct prefix, stores the **SHA-256 hash only**, prints the plaintext key to stdout exactly once with a not-recoverable warning.
  - Defaults to `--plan internal`. **Refuses `trial`/`commercial` unless `--allow-external` is passed** (off by default). This flag is the MVP gate — add a test proving the refusal.
- `scripts/revoke-tenant-key.ts <key_hash|tenant_id>` — sets `status: suspended`. Authorizer must treat suspended as unauthorized (test this, including within the authorizer cache TTL window — document the up-to-5-min revocation lag or key the cache appropriately).
- Seed tenant: **Kanopi**, `plan: internal`, both environments.
- MVP key delivery: team password manager. No one-time-link ceremony yet.

## 3. Tests (acceptance for this extension)

1. Issuance script refuses non-internal plans without `--allow-external`.
2. Only hashes at rest — no plaintext key appears in any table, log, or CloudWatch output.
3. `mk_test_…` keys authenticate and are metered; their usage rows are distinguishable from live (`environment` in the tenant context).
4. A categorise call of N transactions increments `transactions_categorised` by exactly N, atomically, including under concurrent requests.
5. Revoked key → 401/403 (with documented cache-lag behaviour).

## 4. Deferred (documentation only — do not build)

When the first external developer signs: trial-corrections quarantine (trial/test corrections effective at user/tenant scope but never eligible for promotion-queue writes or tenant-threshold counting), the developer-agreement workflow (email → agreement → countersign → issue), one-time secret-link key delivery, monthly invoicing from the `usage` table, and the ops-console developer portal. The schema above already carries every field these need; none of them require API-contract changes.

The commercial model, agreement clauses (CDR outsourced-provider commitments, merchant-level-only learning contribution, no re-identification), and pricing rationale live in the master spec's §10 held in the Kanopi project — consult it when opening access, not during this build.
