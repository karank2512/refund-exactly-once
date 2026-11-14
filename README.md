# refund-exactly-once

Agents take actions with real side effects: approving invoices, placing orders, issuing refunds. Runtimes retry tool calls - after timeouts, after crashes, when the same call gets emitted twice. When the tool moves money, a naive retry moves it twice.

This repo shows what that looks like and what it takes to make the call safe to repeat: a refund tool against a **fake provider written for this repo**, executed two ways on real Postgres semantics (PGlite) - a naive version that breaks under ordinary faults, and a hardened exactly-once version that holds.

This is a standalone resilience exercise. There are no real payments, no keys, no network calls, and nothing here is modelled on any particular company's product or API.

```
$ npm run demo
scenario                | naive: moved / recorded   | naive verdict                            | hardened: moved / recorded | hardened verdict
duplicate-tool-call     | 8000 / 8000 (want 4000)   | FAIL: provider moved 8000, expected 4000 | 4000 / 4000 (want 4000)    | ok
timeout-after-success   | 8000 / 4000 (want 4000)   | FAIL: provider moved 8000, expected 4000 | 4000 / 4000 (want 4000)    | ok
concurrent-approvals    | 14000 / 14000 (want 7000) | FAIL: refunded 14000 on a 10000 payment  | 7000 / 7000 (want 7000)    | ok
crash-after-tool-call   | 8000 / 4000 (want 4000)   | FAIL: provider moved 8000, expected 4000 | 4000 / 4000 (want 4000)    | ok
transient-5xx (control) | 4000 / 4000 (want 4000)   | ok                                       | 4000 / 4000 (want 4000)    | ok
```

Amounts are cents. Output abbreviated; run it for the full table. [REPORT.md](REPORT.md) has the generated results, including the seeded random sweep and the mutation checks.

## Run it

Requires Node 20 or newer. No database server or Docker: tests run on [PGlite](https://pglite.dev), Postgres compiled to WASM.

```
npm install
npm test          # typecheck + all tests, under a minute
npm run demo      # the comparison table above
npm run report    # regenerate REPORT.md from a real run
npm run check     # lint + format check + typecheck + tests (what CI runs)
```

`TRIALS=150 npm test` runs a longer random sweep. The default is 40 seeds per variant.

## What it shows

`src/baseline.ts` is the version an agent runtime ships first: check the balance, call the provider, record the result. `src/hardened.ts` is the same tool call with the failure modes handled.

| Scenario                | Fault injected                                                                                           | Naive                             | Hardened       |
| ----------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------- | -------------- |
| duplicate-tool-call     | the agent emits the same refund call twice (a repeated tool call, or the whole turn retried)             | refunds twice                     | once           |
| timeout-after-success   | the provider moves the money but the response is lost; the runtime retries the tool call                 | refunds twice, database shows one | once, recorded |
| concurrent-approvals    | the agent and a human approve refunds racing on the same payment (two 7000 refunds on a 10000 payment)   | 14000 refunded on a 10000 payment | 7000, recorded |
| crash-after-tool-call   | the runtime dies after the provider moved money, before writing state; the turn is retried after restart | refunds twice, database shows one | once, recorded |
| transient-5xx (control) | the provider returns 500 twice, then recovers                                                            | ok                                | ok             |

## The hardened flow

1. **Durable intent first.** One transaction inserts a `pending` refund row, unique on `(payment_id, request_key)`, and reserves the amount with an atomic conditional `UPDATE ... WHERE reserved + amount <= total`. A repeated tool call finds the existing row. Racing calls cannot reserve the same balance. If the reservation fails, the insert rolls back with it.
2. **Idempotency key to the provider**, derived from the row id. Any retry, including one after a crash, is a replay and moves no extra money.
3. **Guarded finalise.** `pending -> succeeded` happens at most once, and the payment total is updated in the same transaction, so finalising twice cannot double count.
4. **`reconcile()`** drives any row left `pending` (crash, or a run of provider errors) to completion. It is safe to run repeatedly, so it is what a runtime runs on startup.
5. **Database constraints** (`reserved <= amount`, `refunded <= reserved`) as a last line of defence.
6. **Key reuse with a different amount** is rejected rather than silently applied.

Why the order matters: the durable intent (the `pending` row) exists before any money can move, and the provider call is made safe to repeat. That turns "did it go through?" after a crash or timeout from a question with no answer into a retry that is always safe.

Layout:

```
src/provider.ts   fake provider with injectable faults and idempotency-key replay
src/db.ts         schema (naive and hardened variants) and snapshots
src/baseline.ts   naive tool execution
src/hardened.ts   hardened exactly-once execution and reconcile()
src/harness.ts    builds a world per variant, judges invariants
src/scenarios.ts  the five named scenarios
src/sweep.ts      the seeded random workload
src/demo.ts       prints the comparison table
src/report.ts     regenerates REPORT.md from a real run
test/             scenario, unit, mutation and seeded random-fault tests
```

## How it is tested

- `test/scenarios.test.ts` runs each scenario on both variants. The naive version must break (so the fault is really reproduced), the hardened version must hold every invariant, and the control must pass on both.
- `test/units.test.ts` covers the fake provider's semantics, pending-then-reconcile, key reuse, a rejected over-refund leaving no stray row or reservation, and the DB constraint.
- `test/random.test.ts` is a seeded random sweep: timeouts, 5xx, lost responses, crashes, concurrent pairs, client retries. Hardened invariants must hold on every seed: never more than the payment, provider total equals database total, no pending rows left, no refund moved twice. The same seeds run against the naive version and report how many runs break (28/40 at the default settings).
- `test/mutations.test.ts` removes one defence at a time (the idempotency key, then the balance guard) and asserts the matching scenario breaks. Each defence is load-bearing, not decoration.
- [REPORT.md](REPORT.md) is generated by `npm run report` from a real run. CI regenerates it and fails if the checked-in copy is stale.

## Limits

- The fake provider is a simplified model: idempotency keys are remembered forever and a replay returns the first result. Real providers differ.
- PGlite is a single connection, so the concurrency tests interleave async operations rather than using parallel database sessions. The hardened code is written for real Postgres (unique index, `ON CONFLICT`, atomic conditional update), but this repo does not test parallel sessions.
- One payment, partial refunds, one currency. No auth, no webhooks, no provider-side failure after acceptance.
- The 0.4 fault rate is chosen to exercise the failure modes, not measured from any production system.
- It is a demonstration, not a payments library.

## Reproduce

```
npm ci && npm run check && npm run report
```
