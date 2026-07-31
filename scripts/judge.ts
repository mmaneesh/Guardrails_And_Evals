import Anthropic from "@anthropic-ai/sdk";
import {
  JUDGE_MODEL,
  summarizeGrades,
  type ExecutorResult,
  type JudgeGrade,
  type JudgeResult,
  type Usage,
} from "./config.js";

const JUDGE_SYSTEM_PROMPT = `You are grading a transcript produced by an AI skill against a fixed list of expectations.

For each expectation, decide pass or fail based ONLY on what actually appears in the transcript (tool calls, tool results, and the final text output) — not on what you'd expect a good skill to do in general. Cite the specific part of the transcript that justifies your verdict in "evidence". If an expectation cannot be verified from the transcript, mark it as failed and say why in "evidence" rather than guessing.

Grade every expectation independently. Do not let one failure bias your grading of the others.`;

const GRADE_SCHEMA = {
  type: "object",
  properties: {
    grades: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string", description: "The expectation text, copied verbatim" },
          passed: { type: "boolean" },
          evidence: {
            type: "string",
            description: "The specific transcript detail that justifies the verdict",
          },
        },
        required: ["text", "passed", "evidence"],
        additionalProperties: false,
      },
    },
  },
  required: ["grades"],
  additionalProperties: false,
} as const;

function isRetryable(err: unknown): boolean {
  if (err instanceof Anthropic.RateLimitError) return true;
  if (err instanceof Anthropic.APIConnectionError) return true;
  if (err instanceof Anthropic.InternalServerError) return true;
  if (err instanceof Anthropic.APIError && typeof err.status === "number" && err.status >= 500) return true;
  return false;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function toUsage(u: Anthropic.Usage): Usage {
  return {
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheCreationInputTokens: u.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: u.cache_read_input_tokens ?? 0,
  };
}

function buildUserMessage(executorResult: ExecutorResult, expectations: string[]): string {
  const transcriptLines = executorResult.transcript.map((entry) => {
    if (entry.type === "text") return `[text] ${entry.text}`;
    return `[tool_call:${entry.name}${entry.isError ? " ERROR" : ""}] input=${JSON.stringify(
      entry.input
    )} output=${JSON.stringify(entry.output)}`;
  });
  if (executorResult.incomplete) {
    transcriptLines.push(
      `[note] Executor hit its turn cap without reaching a final answer — treat as incomplete.`
    );
  }

  return [
    "TRANSCRIPT:",
    transcriptLines.join("\n"),
    "",
    "FINAL TEXT OUTPUT:",
    executorResult.finalText || "(none — executor did not complete)",
    "",
    "EXPECTATIONS TO GRADE:",
    ...expectations.map((e, i) => `${i + 1}. ${e}`),
  ].join("\n");
}

// Strict no-fallback, same as the executor: retry once on a retryable
// failure, then surface a clear error.
async function createWithRetry(
  client: Anthropic,
  params: Anthropic.MessageCreateParamsNonStreaming
): Promise<Anthropic.Message> {
  try {
    return await client.messages.create(params);
  } catch (err) {
    if (!isRetryable(err)) {
      throw new Error(`Judge API call failed (not retryable): ${describeError(err)}`);
    }
    console.error(`  [judge] retryable error (${describeError(err)}) — retrying once in 2s...`);
    await sleep(2000);
    try {
      return await client.messages.create(params);
    } catch (err2) {
      throw new Error(`Judge API call failed twice: ${describeError(err2)}`);
    }
  }
}

export async function runJudge(
  evalId: number,
  executorResult: ExecutorResult,
  expectations: string[]
): Promise<JudgeResult> {
  const client = new Anthropic();
  const start = Date.now();

  const response = await createWithRetry(client, {
    model: JUDGE_MODEL,
    max_tokens: 4096,
    system: JUDGE_SYSTEM_PROMPT,
    // Grading a fixed transcript against a fixed expectation list is
    // mechanical, not exploratory — low effort and no thinking keeps the
    // cheap tier cheap. Sonnet 5 (unlike Opus 5) accepts disabled thinking
    // at any effort level.
    output_config: { effort: "low", format: { type: "json_schema", schema: GRADE_SCHEMA } },
    thinking: { type: "disabled" },
    messages: [{ role: "user", content: buildUserMessage(executorResult, expectations) }],
  });

  const durationMs = Date.now() - start;
  const usage = toUsage(response.usage);

  const textBlock = response.content.find(
    (b): b is Anthropic.TextBlock => b.type === "text"
  );
  if (!textBlock) {
    throw new Error(`Judge response for eval ${evalId} contained no text block to parse`);
  }

  let grades: JudgeGrade[];
  try {
    const parsed = JSON.parse(textBlock.text) as { grades: JudgeGrade[] };
    grades = parsed.grades;
  } catch (err) {
    throw new Error(
      `Judge response for eval ${evalId} was not valid JSON despite output_config.format: ${describeError(err)}`
    );
  }

  return {
    evalId,
    model: JUDGE_MODEL,
    grades,
    summary: summarizeGrades(grades),
    durationMs,
    usage,
  };
}
