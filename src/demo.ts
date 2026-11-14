import { scenarios } from "./scenarios.js";

const rows: string[][] = [
  ["scenario", "naive: moved / recorded", "naive verdict", "hardened: moved / recorded", "hardened verdict"],
];
for (const s of scenarios) {
  const cells = [s.name];
  for (const v of ["baseline", "hardened"] as const) {
    const o = await s.run(v);
    cells.push(`${o.movedCents} / ${o.db.succeededCents} (want ${o.expectedMovedCents})`);
    cells.push(o.violations.length ? "FAIL: " + o.violations[0] : "ok");
  }
  rows.push(cells);
}
const widths = rows[0]!.map((_, i) => Math.max(...rows.map((r) => r[i]!.length)));
for (const r of rows)
  console.log(
    r
      .map((c, i) => c.padEnd(widths[i]!))
      .join(" | ")
      .trimEnd(),
  );
console.log("\nAmounts are cents. Fake provider, in-memory Postgres (PGlite). Nothing real is called.");
