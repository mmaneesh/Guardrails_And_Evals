import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runExecutor } from "./executor.js";
import { runJudge } from "./judge.js";
import { runStructuralCheck, checkProcessRules } from "./mechanical-checks.js";
import {
  EXECUTOR_MODEL,
  JUDGE_MODEL,
  addUsage,
  emptyUsage,
  estimateCostUsd,
  summarizeGrades,
  type EvalsFile,
  type JudgeGrade,
  type Tier,
} from "./config.js";

function parseArgs(argv: string[]): { tier: Tier | "all"; maxCostUsd?: number } {
  let tier: Tier | "all" = "all";
  let maxCostUsd: number | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--tier") {
      const value = argv[i + 1];
      if (value !== "structural" && value !== "process" && value !== "semantic" && value !== "all") {
        console.error(`Invalid --tier value: ${value}. Expected structural|process|semantic|all.`);
        process.exit(1);
      }
      tier = value;
      i++;
    } else if (argv[i] === "--max-cost") {
      const value = Number(argv[i + 1]);
      if (Number.isNaN(value) || value <= 0) {
        console.error(`Invalid --max-cost value: ${argv[i + 1]}. Expected a positive number.`);
        process.exit(1);
      }
      maxCostUsd = value;
      i++;
    }
  }
  return { tier, maxCostUsd };
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(4)}`;
}

function fmtMs(n: number): string {
  return `${(n / 1000).toFixed(1)}s`;
}

async function main() {
  const { tier, maxCostUsd } = parseArgs(process.argv.slice(2));

  const evalsPath = resolve(process.cwd(), "evals/evals.json");
  const evalsFile = JSON.parse(readFileSync(evalsPath, "utf-8")) as EvalsFile;
  const selected = evalsFile.evals.filter((e) => tier === "all" || e.tier === tier);

  console.log(`Running ${selected.length} eval(s) (tier: ${tier})`);
  console.log(`  executor model: ${EXECUTOR_MODEL}`);
  console.log(`  judge model:    ${JUDGE_MODEL}`);
  if (maxCostUsd !== undefined) {
    console.log(`  cost cap:       ${fmtUsd(maxCostUsd)}`);
  }
  console.log("");

  let runningUsage = emptyUsage();
  let runningCostUsd = 0;
  let runningDurationMs = 0;

  const summaryRows: {
    id: number;
    tier: Tier;
    passRate: string;
    tokens: number;
    durationMs: number;
  }[] = [];

  for (const evalDef of selected) {
    if (maxCostUsd !== undefined && runningCostUsd >= maxCostUsd) {
      console.log(
        `\n--max-cost ${fmtUsd(maxCostUsd)} reached (spent ${fmtUsd(runningCostUsd)}) — stopping before eval ${evalDef.id}.`
      );
      break;
    }

    console.log(`--- eval ${evalDef.id} (${evalDef.tier}) ---`);
    console.log(`  prompt: ${evalDef.prompt}`);

    const runDir = resolve(process.cwd(), "runs", String(evalDef.id));
    mkdirSync(runDir, { recursive: true });

    if (evalDef.tier === "structural") {
      const grades = runStructuralCheck(evalDef);
      writeFileSync(resolve(runDir, "grades.json"), JSON.stringify(grades, null, 2));
      const summary = summarizeGrades(grades);
      console.log(`  structural: ${summary.passed}/${summary.total} passed, $0.0000, instant`);
      for (const grade of grades) {
        console.log(`    [${grade.passed ? "PASS" : "FAIL"}] ${grade.text}`);
        if (!grade.passed) console.log(`           ${grade.evidence}`);
      }
      console.log(
        `  running total: ${fmtUsd(runningCostUsd)}, ${fmtMs(runningDurationMs)}, ` +
          `${runningUsage.inputTokens + runningUsage.cacheReadInputTokens + runningUsage.cacheCreationInputTokens} in / ${runningUsage.outputTokens} out tokens\n`
      );
      summaryRows.push({
        id: evalDef.id,
        tier: evalDef.tier,
        passRate: `${summary.passed}/${summary.total}`,
        tokens: 0,
        durationMs: 0,
      });
      continue;
    }

    const executorResult = await runExecutor(evalDef.id, evalDef.prompt);
    writeFileSync(resolve(runDir, "executor.json"), JSON.stringify(executorResult, null, 2));

    const executorCost = estimateCostUsd(executorResult.usage, executorResult.model);
    runningUsage = addUsage(runningUsage, executorResult.usage);
    runningCostUsd += executorCost;
    runningDurationMs += executorResult.durationMs;

    console.log(
      `  executor: ${executorResult.totalToolCalls} tool call(s), ${executorResult.totalSteps} step(s), ` +
        `${executorResult.usage.inputTokens + executorResult.usage.cacheReadInputTokens + executorResult.usage.cacheCreationInputTokens} in / ${executorResult.usage.outputTokens} out tokens, ` +
        `${fmtMs(executorResult.durationMs)}, ${fmtUsd(executorCost)}` +
        (executorResult.incomplete ? " [INCOMPLETE — hit turn cap]" : "") +
        (executorResult.errorsEncountered > 0 ? ` [${executorResult.errorsEncountered} error(s)]` : "")
    );

    let grades: JudgeGrade[];
    let judgeUsage = emptyUsage();
    let judgeCost = 0;
    let judgeDurationMs = 0;

    if (evalDef.tier === "process") {
      grades = checkProcessRules(executorResult, evalDef.process_rules);
      writeFileSync(resolve(runDir, "grades.json"), JSON.stringify(grades, null, 2));
      const summary = summarizeGrades(grades);
      console.log(`  process:  ${summary.passed}/${summary.total} passed, $0.0000 (mechanical, no judge call)`);
    } else {
      const judgeResult = await runJudge(evalDef.id, executorResult, evalDef.expectations);
      writeFileSync(resolve(runDir, "judge.json"), JSON.stringify(judgeResult, null, 2));
      grades = judgeResult.grades;
      judgeUsage = judgeResult.usage;
      judgeCost = estimateCostUsd(judgeResult.usage, judgeResult.model);
      judgeDurationMs = judgeResult.durationMs;
      runningUsage = addUsage(runningUsage, judgeUsage);
      runningCostUsd += judgeCost;
      runningDurationMs += judgeDurationMs;
      const summary = summarizeGrades(grades);
      console.log(
        `  judge:    ${summary.passed}/${summary.total} passed, ` +
          `${judgeUsage.inputTokens + judgeUsage.cacheReadInputTokens + judgeUsage.cacheCreationInputTokens} in / ${judgeUsage.outputTokens} out tokens, ` +
          `${fmtMs(judgeDurationMs)}, ${fmtUsd(judgeCost)}`
      );
    }

    for (const grade of grades) {
      console.log(`    [${grade.passed ? "PASS" : "FAIL"}] ${grade.text}`);
      if (!grade.passed) console.log(`           ${grade.evidence}`);
    }

    console.log(
      `  running total: ${fmtUsd(runningCostUsd)}, ${fmtMs(runningDurationMs)}, ` +
        `${runningUsage.inputTokens + runningUsage.cacheReadInputTokens + runningUsage.cacheCreationInputTokens} in / ${runningUsage.outputTokens} out tokens\n`
    );

    const totalTokens =
      executorResult.usage.inputTokens +
      executorResult.usage.outputTokens +
      executorResult.usage.cacheCreationInputTokens +
      executorResult.usage.cacheReadInputTokens +
      judgeUsage.inputTokens +
      judgeUsage.outputTokens +
      judgeUsage.cacheCreationInputTokens +
      judgeUsage.cacheReadInputTokens;

    const summary = summarizeGrades(grades);
    summaryRows.push({
      id: evalDef.id,
      tier: evalDef.tier,
      passRate: `${summary.passed}/${summary.total}`,
      tokens: totalTokens,
      durationMs: executorResult.durationMs + judgeDurationMs,
    });
  }

  console.log("=== Summary ===");
  console.table(
    summaryRows.map((r) => ({
      eval: r.id,
      tier: r.tier,
      passRate: r.passRate,
      tokens: r.tokens,
      duration: fmtMs(r.durationMs),
    }))
  );
  console.log(
    `Total: ${fmtUsd(runningCostUsd)} across ${summaryRows.length} eval(s), ${fmtMs(runningDurationMs)}`
  );
}

main().catch((err) => {
  console.error("run-evals failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
