# Moroku Enrich — Extension 003: Custom Domain `enrich.moroku.digital`

*Extension to `moroku-enrich-spec.md`. Self-contained. Commit to `docs/extensions/` when applying.*

*Decision (Colin, 2 Aug 2026): the public hostname is **`enrich.moroku.digital`** — this supersedes every `enrich.moroku.com` reference in the base spec. DNS for `moroku.digital` is hosted at **GoDaddy**, so certificate validation and the final alias are manual CNAME entries Colin pastes into GoDaddy's DNS panel; everything else is CDK.*

*GoDaddy quirk — when printing records for Colin, print them GoDaddy-style: the **Name** field takes only the host part relative to the zone (e.g. `_abc123.enrich`, NOT `_abc123.enrich.moroku.digital`), and the **Value** should omit any trailing dot. Print both the raw ACM form and the GoDaddy-ready form.*

*For now the domain fronts the dev stack — the only stack, already serving Kanopi's shadow traffic. At prod promotion, the same construct re-points by changing one mapping.*

## 1. CDK changes (infra)

1. **ACM certificate** for `enrich.moroku.digital`, DNS-validated, in `ap-southeast-2` (regional HTTP API custom domains use a same-region cert). Tagged like everything else.
2. **API Gateway custom domain** (`apigatewayv2.DomainName`): regional endpoint, TLS 1.2 security policy, the cert above.
3. **ApiMapping** from the domain to the existing HTTP API's default stage (no path prefix — `https://enrich.moroku.digital/v1/...` maps straight through).
4. **Outputs**: the domain's `regionalDomainName` (the CNAME target, looks like `d-xxxx.execute-api.ap-southeast-2.amazonaws.com`) and the certificate ARN.
5. The default `execute-api` endpoint **stays enabled** — Kanopi's shadow client currently points at it, and it must keep working until the secret is switched. Disabling the default endpoint is a later hardening step, not this extension.

## 2. Deploy choreography (external DNS — the deploy pauses once)

CloudFormation will not finish creating the certificate until its validation record exists in DNS. Sequence:

1. Start `cdk deploy`. When the cert resource shows `CREATE_IN_PROGRESS`, fetch the validation record in a second terminal:
   `aws acm describe-certificate --certificate-arn <arn> --query 'Certificate.DomainValidationOptions[0].ResourceRecord'`
   (find the pending arn via `aws acm list-certificates` if needed).
2. **Print the validation CNAME (name + value) clearly for Colin** and wait. Colin adds it at the moroku.digital DNS provider. Validation typically completes within minutes of the record propagating; the deploy then finishes on its own. Do not cancel the deploy while waiting.
3. After deploy completes, **print the second record for Colin**: CNAME `enrich.moroku.digital` → the `regionalDomainName` output.
4. Once Colin confirms the record is in, verify (allow for propagation, retry politely):
   - `curl https://enrich.moroku.digital/v1/health` → 200, correct engine/taxonomy versions, valid certificate.
   - A categorise smoke call over the custom domain with the Kanopi TEST key → identical behaviour to the execute-api URL.
   - The old execute-api URL still works.

## 3. After verification (Kanopi side — not this repo)

Colin updates the `ENRICH_API_URL` Supabase secret to `https://enrich.moroku.digital` (no code change — the shadow client reads the secret). The execute-api URL remains as fallback.

## 4. Acceptance

1. `https://enrich.moroku.digital/v1/health` → 200 over a valid cert.
2. Categorise + auth-reject smoke over the custom domain matches execute-api behaviour.
3. execute-api URL unaffected.
4. `npm run build` / `npm test` / `cdk synth` green; STATUS.md updated with the domain and the two DNS records that now exist (names only, they're public anyway).
5. Committed and pushed to origin. **Standing instruction from here on: push to origin after every commit.**
