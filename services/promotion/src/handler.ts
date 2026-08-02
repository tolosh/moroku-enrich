/**
 * promotion worker (spec §3.2, §6) — scheduled sweep.
 *
 * Stub for the CDK build (task 1). Later: corroborate corrections across tenants
 * and users, apply the guarded promotion rules (≥ 2 tenants or ≥ 5 users, no
 * competing category ≥ 30%), and write pending promotions to the review queue.
 * One tenant can never write merchants_global alone (the poisoning guard).
 */
import type { ScheduledHandler } from "aws-lambda";

export const handler: ScheduledHandler = async () => {
  console.log(JSON.stringify({ at: "promotion.stub", swept: 0 }));
  // No-op until the corroboration logic lands.
};
