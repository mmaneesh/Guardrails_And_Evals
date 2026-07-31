// Central place to change models/limits after a live run shows real cost —
// swap JUDGE_MODEL to "claude-haiku-4-5" once you've measured the actual
// executor/judge token split (see README).
export const EXECUTOR_MODEL = "claude-sonnet-5";
export const JUDGE_MODEL = "claude-sonnet-5";

// Executor tool-use loop only ever needs read-file -> run-validator -> respond.
// Keeping this low bounds live cost/time if the model gets stuck in a loop.
export const MAX_EXECUTOR_TURNS = 6;

// $ per million tokens. Sonnet 5 figures are the introductory rate active
// through 2026-08-31; standard $3 / $15 applies after that date.
export const PRICING: Record<string, { input: number; output: number }> = {
  "claude-sonnet-5": { input: 2.0, output: 10.0 },
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
};

export type Usage = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
};

export function emptyUsage(): Usage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  };
}

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheCreationInputTokens: a.cacheCreationInputTokens + b.cacheCreationInputTokens,
    cacheReadInputTokens: a.cacheReadInputTokens + b.cacheReadInputTokens,
  };
}

// Cache reads/writes are still input tokens, priced off the same input rate.
// This is an estimate for live console visibility, not a billing reconciliation.
export function estimateCostUsd(usage: Usage, model: string): number {
  const rate = PRICING[model];
  if (!rate) return 0;
  const billableInput =
    usage.inputTokens + usage.cacheCreationInputTokens + usage.cacheReadInputTokens;
  return (billableInput * rate.input + usage.outputTokens * rate.output) / 1_000_000;
}

export type TranscriptEntry =
  | { type: "text"; text: string }
  | { type: "tool_call"; name: string; input: unknown; output: unknown; isError: boolean };

export type ExecutorResult = {
  evalId: number;
  model: string;
  toolCalls: Record<string, number>;
  totalToolCalls: number;
  totalSteps: number;
  outputChars: number;
  transcriptChars: number;
  errorsEncountered: number;
  incomplete: boolean;
  durationMs: number;
  usage: Usage;
  finalText: string;
  transcript: TranscriptEntry[];
};

export type JudgeGrade = {
  text: string;
  passed: boolean;
  evidence: string;
};

export type JudgeResult = {
  evalId: number;
  model: string;
  grades: JudgeGrade[];
  summary: { passed: number; failed: number; total: number; passRate: number };
  durationMs: number;
  usage: Usage;
};

export function summarizeGrades(grades: JudgeGrade[]): JudgeResult["summary"] {
  const passed = grades.filter((g) => g.passed).length;
  const total = grades.length;
  return {
    passed,
    failed: total - passed,
    total,
    passRate: total === 0 ? 0 : passed / total,
  };
}
