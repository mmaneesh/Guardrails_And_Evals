import Anthropic from "@anthropic-ai/sdk";
import {
  JUDGE_MODEL,
  createWithRetry,
  describeError,
  summarizeGrades,
  toUsage,
  type ExecutorResult,
  type JudgeGrade,
  type JudgeResult,
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

/**
 * Formats transcript entries, final output, and expectations into a user prompt for the judge.
 */
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

/**
 * Calls the LLM judge using structured JSON outputs to grade the transcript against expectations.
 */
export async function runJudge(
  evalId: number,
  executorResult: ExecutorResult,
  expectations: string[]
): Promise<JudgeResult> {
  const client = new Anthropic();
  const start = Date.now();

  const response = await createWithRetry(
    client,
    {
      model: JUDGE_MODEL,
      max_tokens: 4096,
      system: JUDGE_SYSTEM_PROMPT,
      output_config: { effort: "low", format: { type: "json_schema", schema: GRADE_SCHEMA } },
      thinking: { type: "disabled" },
      messages: [{ role: "user", content: buildUserMessage(executorResult, expectations) }],
    },
    "Judge"
  );

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
    if (!parsed || !Array.isArray(parsed.grades)) {
      throw new Error("missing grades array");
    }
    if (parsed.grades.length !== expectations.length) {
      throw new Error(
        `expected ${expectations.length} grades but received ${parsed.grades.length}`
      );
    }
    for (const [index, grade] of parsed.grades.entries()) {
      if (
        !grade ||
        typeof grade.text !== "string" ||
        grade.text !== expectations[index] ||
        typeof grade.passed !== "boolean" ||
        typeof grade.evidence !== "string"
      ) {
        throw new Error(`invalid grade at index ${index}`);
      }
    }
    grades = parsed.grades;
  } catch (err) {
    throw new Error(
      `Judge response for eval ${evalId} failed validation despite output_config.format: ${describeError(err)}`
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
