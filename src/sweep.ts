import { makeWorld, surviving, type Variant, type World } from "./harness.js";
import type { Fault } from "./provider.js";
import { snapshot } from "./db.js";

export function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FAULTS: Fault[] = ["timeout_before", "http_500", "timeout_after_success", "crash_after_success"];
export const FAULT_RATE = 0.4;

/**
 * One seeded random workload: 8 tool calls over 5 request keys, random faults,
 * mixed concurrent and sequential execution, crashes, then a healthy restart and
 * one client retry of every call.
 */
export async function runTrial(variant: Variant, seed: number): Promise<World> {
  const rnd = mulberry32(seed);
  const w = await makeWorld(variant);
  const amountFor = Array.from({ length: 5 }, () => 1000 * (1 + Math.floor(rnd() * 10)));
  const reqs = Array.from({ length: 8 }, () => {
    const k = Math.floor(rnd() * 5);
    return { requestKey: `k${k}`, amountCents: amountFor[k]! };
  });
  w.provider.setRandomFaults(() => (rnd() < FAULT_RATE ? FAULTS[Math.floor(rnd() * FAULTS.length)]! : "ok"));
  for (let i = 0; i < reqs.length;) {
    const n = rnd() < 0.5 ? 1 : 2; // sometimes two calls at once
    const batch = reqs.slice(i, i + n);
    i += n;
    await Promise.all(batch.map((r) => surviving(w.refund(r))));
  }
  // Restart with a healthy provider, recover, then every client retries once.
  w.provider.setRandomFaults(null);
  await w.restart();
  for (const r of reqs) await surviving(w.refund(r));
  await w.restart();
  return w;
}

/** The invariants every run must satisfy: no over-refund, provider and database agree, nothing stuck. */
export async function worldViolations(w: World): Promise<string[]> {
  const s = await snapshot(w.db, w.paymentId);
  const moved = w.provider.totalMoved(w.paymentId);
  const v: string[] = [];
  if (moved > w.paymentCents) v.push("over-refund");
  if (moved !== s.succeededCents) v.push("provider vs database drift");
  if (moved !== s.refundedCents) v.push("payment total drift");
  if (s.pending > 0) v.push("stuck pending");
  return v;
}

/** Run `trials` seeded workloads and count how many violate an invariant. */
export async function countBroken(variant: Variant, trials: number): Promise<number> {
  let broken = 0;
  for (let seed = 1; seed <= trials; seed++) {
    const w = await runTrial(variant, seed);
    if ((await worldViolations(w)).length > 0) broken++;
  }
  return broken;
}
