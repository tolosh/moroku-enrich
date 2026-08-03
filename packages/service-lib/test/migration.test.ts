import { describe, expect, it } from "vitest";
import { planKeyMigration } from "../src/migration.js";

describe("planKeyMigration (ext-004 §4)", () => {
  it("leaves unchanged, unique keys alone", () => {
    const plan = planKeyMigration([
      { key: "woolworths", newKey: "woolworths", confidence: 0.9, item: { c: 0.9 } },
    ]);
    expect(plan.writes).toEqual([]);
    expect(plan.deletes).toEqual([]);
    expect(plan.merges).toEqual([]);
  });

  it("rewrites a moved key under its new key and deletes the old", () => {
    const plan = planKeyMigration([
      { key: "eftpos the boathouse#1", newKey: "the boathouse#1", confidence: 0.9, item: { x: 1 } },
    ]);
    expect(plan.writes).toEqual([{ newKey: "the boathouse#1", item: { x: 1 } }]);
    expect(plan.deletes).toEqual(["eftpos the boathouse#1"]);
    expect(plan.merges).toEqual([]);
  });

  it("merges a duplicate pair keeping the highest confidence", () => {
    const plan = planKeyMigration([
      { key: "eftpos the boathouse#1", newKey: "the boathouse#1", confidence: 0.70, item: { id: "a" } },
      { key: "the boathouse#1", newKey: "the boathouse#1", confidence: 0.92, item: { id: "b" } },
    ]);
    // winner (0.92) already sits at newKey → no write, only the loser is deleted.
    expect(plan.writes).toEqual([]);
    expect(plan.deletes).toEqual(["eftpos the boathouse#1"]);
    expect(plan.merges).toEqual([
      { newKey: "the boathouse#1", kept: "the boathouse#1", dropped: ["eftpos the boathouse#1"] },
    ]);
  });

  it("never deletes the new key when the winner moves in over a lower row", () => {
    // winner "eftpos x#1" (0.95) moves to "x#1"; loser "x#1" (0.60) already there.
    const plan = planKeyMigration([
      { key: "eftpos x#1", newKey: "x#1", confidence: 0.95, item: { id: "hi" } },
      { key: "x#1", newKey: "x#1", confidence: 0.6, item: { id: "lo" } },
    ]);
    expect(plan.writes).toEqual([{ newKey: "x#1", item: { id: "hi" } }]);
    expect(plan.deletes).toEqual(["eftpos x#1"]); // NOT "x#1" — it's the write target
    expect(plan.merges[0]!.dropped).toEqual(["x#1"]);
  });

  it("merges when the winner is itself a moved key", () => {
    const plan = planKeyMigration([
      { key: "eftpos the boathouse#1", newKey: "the boathouse#1", confidence: 0.95, item: { id: "hi" } },
      { key: "visa the boathouse#1", newKey: "the boathouse#1", confidence: 0.60, item: { id: "lo" } },
    ]);
    expect(plan.writes).toEqual([{ newKey: "the boathouse#1", item: { id: "hi" } }]);
    expect(plan.deletes.sort()).toEqual(["eftpos the boathouse#1", "visa the boathouse#1"]);
    expect(plan.merges[0]!.kept).toBe("eftpos the boathouse#1");
  });
});
