#!/usr/bin/env node
/**
 * CDK app entry — Moroku Enrich (spec §6).
 *
 * One app, one stack per stage. `dev` deploys into the Moroku Dev Sandbox
 * account 932027117528 / ap-southeast-2 (decision §9.2). Account/region default
 * to those literals so `cdk synth` works offline; a real deploy still resolves
 * CDK_DEFAULT_ACCOUNT from the caller's credentials and MUST be verified against
 * 932027117528 before `cdk deploy` (build brief).
 */
import { App, Tags } from "aws-cdk-lib";
import { MorokuEnrichStack } from "../lib/moroku-enrich-stack";

const app = new App();

const stage = (app.node.tryGetContext("stage") as string | undefined) ?? "dev";

// Sandbox account/region are the documented defaults so synth needs no creds.
const account = process.env.CDK_DEFAULT_ACCOUNT ?? "932027117528";
const region = process.env.CDK_DEFAULT_REGION ?? "ap-southeast-2";

new MorokuEnrichStack(app, `MorokuEnrich-${stage}`, {
  stage,
  env: { account, region },
  description: `Moroku Enrich (${stage}) — transaction enrichment service`,
});

// Cost-allocation + isolation tags applied to every resource in the app (spec §6).
// Activate `project` as a cost-allocation tag in Billing so Enrich's spend is
// separable on the shared account's bill.
Tags.of(app).add("project", "moroku-enrich");
Tags.of(app).add("stage", stage);
