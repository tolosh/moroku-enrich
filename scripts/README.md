# Admin scripts (ext-001)

Operational CLIs for tenant key issuance and revocation. They write to the
`tenants` table directly, so they require AWS credentials for the target account
(dev = 932027117528 / ap-southeast-2) and the table to exist (i.e. after the
first `cdk deploy`). Run with `tsx`.

## Issue a key

```bash
npx tsx scripts/issue-tenant-key.ts <name> [--plan internal|trial|commercial] \
  [--env test|live] [--allow-external] [--tenant-id id] [--quota n] \
  [--contact email] [--stage dev] [--region ap-southeast-2] [--table name]
```

- Defaults to `--plan internal --env live`.
- Refuses `trial`/`commercial` unless `--allow-external` is passed (the MVP gate).
- Prints the plaintext key to **stdout exactly once** (not recoverable — only its
  SHA-256 hash is stored). Store it in the team password manager.

## Revoke a key

```bash
npx tsx scripts/revoke-tenant-key.ts <key_hash|tenant_id> [--stage dev] [--region ...] [--table ...]
```

Sets `status: suspended`. A 64-hex argument is treated as a `key_hash` (one row);
anything else as a `tenant_id` (all its rows via the GSI). Revocation is effective
within the authorizer cache TTL (~5 min) — see
`services/authorizer/src/authorize.ts`.

## Seed Kanopi (run once, at first deploy — ext-001 §2)

```bash
npx tsx scripts/issue-tenant-key.ts Kanopi --tenant-id kanopi --plan internal --env test --stage dev
npx tsx scripts/issue-tenant-key.ts Kanopi --tenant-id kanopi --plan internal --env live --stage dev
```

Two rows, one `tenant_id` (`kanopi`), distinct `key_hash` + `environment`.
