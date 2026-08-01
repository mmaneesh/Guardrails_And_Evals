import Anthropic from "@anthropic-ai/sdk";

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
export function billableInputTokens(usage: Usage): number {
  return usage.inputTokens + usage.cacheCreationInputTokens + usage.cacheReadInputTokens;
}

// This is an estimate for live console visibility, not a billing reconciliation.
export function estimateCostUsd(usage: Usage, model: string): number {
  const rate = PRICING[model];
  if (!rate) return 0;
  return (billableInputTokens(usage) * rate.input + usage.outputTokens * rate.output) / 1_000_000;
}

// Shared by executor.ts and judge.ts — both retry once on a retryable error
// (rate limit, connection error, 5xx) then fail loudly. No silent fallback.
export function isRetryable(err: unknown): boolean {
  if (err instanceof Anthropic.RateLimitError) return true;
  if (err instanceof Anthropic.APIConnectionError) return true;
  if (err instanceof Anthropic.InternalServerError) return true;
  if (err instanceof Anthropic.APIError && typeof err.status === "number" && err.status >= 500) return true;
  return false;
}

export function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function toUsage(u: Anthropic.Usage): Usage {
  return {
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheCreationInputTokens: u.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: u.cache_read_input_tokens ?? 0,
  };
}

export async function createWithRetry(
  client: Anthropic,
  params: Anthropic.MessageCreateParamsNonStreaming,
  label: string,
  onError?: () => void
): Promise<Anthropic.Message> {
  try {
    return await client.messages.create(params);
  } catch (err) {
    if (!isRetryable(err)) {
      onError?.();
      throw new Error(`${label} API call failed (not retryable): ${describeError(err)}`);
    }
    console.error(`  [${label.toLowerCase()}] retryable error (${describeError(err)}) — retrying once in 2s...`);
    await sleep(2000);
    try {
      return await client.messages.create(params);
    } catch (err2) {
      onError?.();
      throw new Error(`${label} API call failed twice: ${describeError(err2)}`);
    }
  }
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

export type Tier = "structural" | "process" | "semantic";

export type ProcessRule =
  | { type: "tool_before_any_text"; tool: string }
  | { type: "final_text_field_not_severity"; field: string; severity: string };

type EvalBase = {
  id: number;
  prompt: string;
  expected_output: string;
};

export type StructuralEvalDef = EvalBase & {
  tier: "structural";
  specPath: string;
  responsePath: string;
  expected_counts: {
    structuralViolations: number;
    enumMismatches: number;
    undocumentedFields: number;
  };
  expected_fields?: {
    structuralViolations?: string[];
    enumMismatches?: string[];
    undocumentedFields?: string[];
  };
};

export type ProcessEvalDef = EvalBase & {
  tier: "process";
  process_rules: ProcessRule[];
};

export type SemanticEvalDef = EvalBase & {
  tier: "semantic";
  expectations: string[];
};

export type EvalDef = StructuralEvalDef | ProcessEvalDef | SemanticEvalDef;

export type EvalsFile = { skill_name: string; evals: EvalDef[] };
