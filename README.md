# Moroku Enrich

Standalone transaction-enrichment API for Moroku Pty Ltd. Kanopi is customer zero.
Deterministic-first categorisation with an auditable signal chain, a compounding
merchant dictionary, and a conservative fallback that never flatters affordability.

Source of truth: [`docs/moroku-enrich-spec.md`](docs/moroku-enrich-spec.md).

## Layout

```
infra/       CDK app (TypeScript) — one app, dev + prod stages
services/    Lambdas: categorise, corrections, read, classifier (SQS/Bedrock, phase 2)
packages/
  engine/    pure-TS domain logic (normaliser, MCC table, rules, income,
             savings, signal chain) — zero AWS imports
  taxonomy/  taxonomy 1.1, versioned
docs/        spec + generated API docs
fixtures/    anonymised transaction fixtures for engine tests
```

## Toolchain

Node 22 (Lambda `nodejs22.x`), TypeScript strict, Vitest, esbuild via CDK `NodejsFunction`.
npm workspaces monorepo.

```
npm install
npm test          # vitest across packages + services
npm run build     # tsc --build (composite project references)
npm run deploy:dev
```

## Build status

| Component | State |
|---|---|
| Repo scaffold + tooling | ✅ |
| Merchant normaliser (pure, 37 tests) | ✅ |
| Taxonomy 1.1 — 17 expense + 5 non-expense | ✅ |
| MCC table | ✅ |
| Rules tier | ✅ |
| Signal chain orchestrator | ✅ |
| CDK stack + Lambda handlers | ✅ |
| Classifier (LLM tier, Bedrock Haiku 4.5) | ✅ live in dev |
| Income recognition + savings subtyping (ext-006) | ✅ built, **not yet deployed** |
| Promotion worker | ⏳ stub |

`npm test` — 185 pass. Full detail, deployment state and the Kanopi shadow-diff
consequence of ext-006 are in [`STATUS.md`](STATUS.md).

## Deployment target

Moroku Dev Sandbox account **932027117528**, region **ap-southeast-2**.
Everything tagged `project: moroku-enrich`, `stage: dev`; own least-privilege IAM;
no reliance on pre-existing resources.
