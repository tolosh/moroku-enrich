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
  engine/    pure-TS domain logic (normaliser, MCC table, rules, signal chain) — zero AWS imports
  taxonomy/  taxonomy v1, versioned
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

## Build status (Phase 1)

| Component | State |
|---|---|
| Repo scaffold + tooling | ✅ |
| Merchant normaliser (pure, 37 tests) | ✅ |
| Taxonomy v1 structure | ✅ (category list pending — see below) |
| MCC table | ⛔ blocked on category list |
| Rules tier | ⛔ blocked on category list + Kanopi regex source |
| Signal chain orchestrator | ⛔ blocked on above |
| CDK stack | ⏳ |
| Lambda handlers | ⏳ |
| Classifier stub (LLM tier, flag off) | ⏳ |
| Fixtures + tests + deploy | ⏳ |

**Blocked:** per decision §9.1, the 16 Kanopi expense-category identifiers must be
lifted verbatim from Kanopi's code — they are not invented here.
`packages/taxonomy/src/index.ts` has the structure; `EXPENSE_CATEGORIES` is empty
until the list is supplied. The rules tier additionally needs Kanopi's existing
regex chains (statements + open-banking copies) to port.

## Deployment target

Moroku Dev Sandbox account **932027117528**, region **ap-southeast-2**.
Everything tagged `project: moroku-enrich`, `stage: dev`; own least-privilege IAM;
no reliance on pre-existing resources.
