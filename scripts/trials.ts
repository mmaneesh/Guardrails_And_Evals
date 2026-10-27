import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { EvalsFile } from "./config.js";

/**
 * Runs run-evals N times and prints how often each eval passed every check.
 * Usage: tsx scripts/trials.ts [--trials 5] [any run-evals option, e.g. --tier semantic --rule-off]
 */
const args = process.argv.slice(2);
const t = args.indexOf("--trials");
const trials = t >= 0 ? Number(args[t + 1]) : 5;
const passthrough = t >= 0 ? args.filter((_, i) => i !== t && i !== t + 1) : args;
if (!Number.isInteger(trials) || trials < 1) {
  console.error("--trials needs a whole number, e.g. --trials 5");
  process.exit(1);
}

const opt = (name: string) => passthrough[passthrough.indexOf(name) + 1];
const tier = passthrough.includes("--tier") ? opt("--tier") : "all";
const ids = passthrough.includes("--ids") ? opt("--ids").split(",").map(Number) : undefined;
const ruleOff = passthrough.includes("--rule-off");

const evals = (JSON.parse(readFileSync("evals/evals.json", "utf-8")) as EvalsFile).evals.filter(
  (e) => (tier === "all" || e.tier === tier) && (!ids || ids.includes(e.id))
);

const clean = new Map<number, number>(evals.map((e) => [e.id, 0]));
let costUsd = 0;
let failedRuns = 0;

console.log(`${trials} trials of ${evals.length} eval(s)${ruleOff ? " (rule off)" : ""}`);
for (let trial = 1; trial <= trials; trial++) {
  const started = Date.now();
  const run = spawnSync(
    "npx",
    ["tsx", "--env-file=.env", "scripts/run-evals.ts", ...passthrough, "--max-cost", "1"],
    { encoding: "utf-8" }
  );
  const cost = /Total: \$([\d.]+)/.exec(run.stdout ?? "");
  costUsd += cost ? Number(cost[1]) : 0;

  // A trial counts only if its result files were written during this run (no stale reads).
  let ok = run.status === 0;
  for (const e of evals) {
    const dir = resolve("runs", ruleOff ? "rule-off" : "", String(e.id));
    const file = ["judge.json", "grades.json"].map((f) => resolve(dir, f)).find((f) => existsSync(f));
    if (!ok || !file || statSync(file).mtimeMs < started) {
      ok = false;
      continue;
    }
    const parsed = JSON.parse(readFileSync(file, "utf-8"));
    const grades: { passed: boolean }[] = Array.isArray(parsed) ? parsed : parsed.grades;
    if (grades.every((g) => g.passed)) clean.set(e.id, clean.get(e.id)! + 1);
  }
  if (!ok) failedRuns++;
  console.log(`  trial ${trial}/${trials}${ok ? "" : " — run failed, not counted cleanly"}`);
}

console.log("\n=== Clean passes (every check passed) ===");
console.table(evals.map((e) => ({ eval: e.id, tier: e.tier, clean: `${clean.get(e.id)}/${trials}` })));
console.log(`Cost: $${costUsd.toFixed(4)}${failedRuns ? `, ${failedRuns} trial(s) had errors — rerun them` : ""}`);
