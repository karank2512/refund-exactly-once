import test from "node:test";
import assert from "node:assert/strict";
import { judge, makeWorld } from "../src/harness.js";

// Each mutation removes exactly one defence from the hardened flow. The matching
// scenario must break, proving the defence is load-bearing and not decoration.

test("mutation: removing the idempotency key breaks timeout-after-success", async () => {
  const w = await makeWorld("hardened", 10_000, "no-idempotency-key");
  w.provider.inject("timeout_after_success");
  await w.refund({ requestKey: "k1", amountCents: 4000 });
  await w.restart();
  const o = await judge(w, 4000);
  assert.ok(o.violations.length > 0, "expected the mutation to break the invariant");
  assert.equal(o.movedCents, 8000);
});

test("mutation: removing the balance guard breaks concurrent over-refund", async () => {
  const w = await makeWorld("hardened", 10_000, "no-balance-guard");
  await Promise.all([
    w.refund({ requestKey: "k1", amountCents: 7000 }),
    w.refund({ requestKey: "k2", amountCents: 7000 }),
  ]);
  await w.restart();
  const o = await judge(w, 7000);
  assert.ok(o.violations.length > 0, "expected the mutation to break the invariant");
  assert.equal(o.movedCents, 14_000);
});

test("control: intact hardened code holds in both scenarios", async () => {
  const w1 = await makeWorld("hardened");
  w1.provider.inject("timeout_after_success");
  await w1.refund({ requestKey: "k1", amountCents: 4000 });
  await w1.restart();
  assert.deepEqual((await judge(w1, 4000)).violations, []);

  const w2 = await makeWorld("hardened");
  await Promise.all([
    w2.refund({ requestKey: "k1", amountCents: 7000 }),
    w2.refund({ requestKey: "k2", amountCents: 7000 }),
  ]);
  await w2.restart();
  assert.deepEqual((await judge(w2, 7000)).violations, []);
});
