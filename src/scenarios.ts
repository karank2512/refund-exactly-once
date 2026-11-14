import { judge, makeWorld, surviving, type Outcome, type Variant } from "./harness.js";

export interface Scenario {
  name: string;
  fault: string;
  run(variant: Variant): Promise<Outcome>;
}

export const scenarios: Scenario[] = [
  {
    name: "duplicate-tool-call",
    fault: "the agent emits the same refund call twice (a repeated tool call, or the whole turn retried)",
    async run(v) {
      const w = await makeWorld(v);
      await w.refund({ requestKey: "k1", amountCents: 4000 });
      await w.refund({ requestKey: "k1", amountCents: 4000 });
      return judge(w, 4000);
    },
  },
  {
    name: "timeout-after-success",
    fault: "the provider moves the money but the response is lost; the runtime retries the tool call",
    async run(v) {
      const w = await makeWorld(v);
      w.provider.inject("timeout_after_success");
      await w.refund({ requestKey: "k1", amountCents: 4000 });
      await w.restart();
      return judge(w, 4000);
    },
  },
  {
    name: "concurrent-approvals",
    fault:
      "the agent and a human approve refunds racing on the same payment (two 7000 refunds on a 10000 payment)",
    async run(v) {
      const w = await makeWorld(v);
      await Promise.all([
        w.refund({ requestKey: "k1", amountCents: 7000 }),
        w.refund({ requestKey: "k2", amountCents: 7000 }),
      ]);
      await w.restart();
      return judge(w, 7000);
    },
  },
  {
    name: "crash-after-tool-call",
    fault:
      "the runtime dies after the provider moved money, before writing state; the turn is retried after restart",
    async run(v) {
      const w = await makeWorld(v);
      w.provider.inject("crash_after_success");
      await surviving(w.refund({ requestKey: "k1", amountCents: 4000 }));
      await w.restart();
      await w.refund({ requestKey: "k1", amountCents: 4000 });
      return judge(w, 4000);
    },
  },
  {
    name: "transient-5xx (control)",
    fault: "the provider returns 500 twice, then recovers. Nothing should go wrong in either version",
    async run(v) {
      const w = await makeWorld(v);
      w.provider.inject("http_500", "http_500");
      await w.refund({ requestKey: "k1", amountCents: 4000 });
      await w.restart();
      return judge(w, 4000);
    },
  },
];
