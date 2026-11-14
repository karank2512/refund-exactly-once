import test from "node:test";
import assert from "node:assert/strict";
import { runTrial, worldViolations } from "../src/sweep.js";

const TRIALS = Number(process.env.TRIALS ?? 40);

test(`hardened: ${TRIALS} seeded random fault runs, invariants always hold`, async () => {
  for (let seed = 1; seed <= TRIALS; seed++) {
    const w = await runTrial("hardened", seed);
    const ctx = `seed ${seed}`;
    const v = await worldViolations(w);
    assert.deepEqual(v, [], `${ctx}: ${v.join(", ")}`);
    const keys = w.provider.moved.map((m) => m.idempotencyKey);
    assert.equal(new Set(keys).size, keys.length, `${ctx}: a refund moved money twice`);
  }
});

test(`naive: same ${TRIALS} runs, count how many break (expect many)`, async () => {
  let broken = 0;
  for (let seed = 1; seed <= TRIALS; seed++) {
    const w = await runTrial("baseline", seed);
    if ((await worldViolations(w)).length > 0) broken++;
  }
  console.log(`  naive: ${broken}/${TRIALS} runs over-refunded or drifted from the provider`);
  assert.ok(broken > TRIALS / 2, `only ${broken} naive runs broke`);
});
