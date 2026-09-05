import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { validate } from "./validate-schema.js";
import {
  EXECUTOR_MODEL,
  MAX_EXECUTOR_TURNS,
  addUsage,
  createWithRetry,
  emptyUsage,
  toUsage,
  type ExecutorResult,
  type TranscriptEntry,
} from "./config.js";

const REPO_ROOT = process.cwd();
const ALLOWED_READ_PREFIXES = ["SKILL.md", "references/", "evals/files/"];

/**
 * Ensures requested file paths do not escape the sandbox boundary.
 */
function resolveSafePath(requestedPath: string): string {
  const resolved = resolve(REPO_ROOT, requestedPath);
  const canonicalRoot = realpathSync(REPO_ROOT);
  const canonicalPath = realpathSync(resolved);
  const rel = relative(canonicalRoot, canonicalPath);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Path escapes the repository root: ${requestedPath}`);
  }
  const allowed = ALLOWED_READ_PREFIXES.some((prefix) => rel === prefix || rel.startsWith(prefix));
  if (!allowed) {
    throw new Error(`Path not permitted (must be SKILL.md, references/, or evals/files/): ${requestedPath}`);
  }
  return canonicalPath;
}

/**
 * Builds the cached system prompt combining SKILL.md and reference documents.
 */
function buildSystemPrompt(): Anthropic.TextBlockParam[] {
  const skill = readFileSync(resolve(REPO_ROOT, "SKILL.md"), "utf-8");
  const judgment = readFileSync(
    resolve(REPO_ROOT, "references/breaking_change_judgment.md"),
    "utf-8"
  );
  const combined = `${skill}\n\n---\n\n${judgment}`;
  return [{ type: "text", text: combined, cache_control: { type: "ephemeral" } }];
}

const TOOLS: Anthropic.Tool[] = [
  {
    name: "read_file",
    description:
      "Read a file from this repository. Only SKILL.md, files under references/, and files under evals/files/ can be read.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Repo-relative path, e.g. references/breaking_change_judgment.md",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "run_validator",
    description:
      "Run the deterministic ajv-based contract validator against an OpenAPI spec and an actual API response. Returns structuralViolations (hard facts), enumMismatches (facts needing judgment), and undocumentedFields (facts, not violations by default). Always run this before making any claims about a response.",
    input_schema: {
      type: "object",
      properties: {
        specPath: { type: "string", description: "Repo-relative path to the OpenAPI spec YAML file" },
        responsePath: {
          type: "string",
          description: "Repo-relative path to the captured API response JSON file",
        },
      },
      required: ["specPath", "responsePath"],
    },
  },
];

/**
 * Executes a tool requested by the model within sandboxed bounds.
 */
function executeTool(name: string, input: unknown): { output: unknown; isError: boolean } {
  try {
    if (name === "read_file") {
      if (!isRecord(input) || typeof input.path !== "string") {
        throw new Error("read_file requires a string path");
      }
      const { path } = input;
      return { output: readFileSync(resolveSafePath(path), "utf-8"), isError: false };
    }
    if (name === "run_validator") {
      if (
        !isRecord(input) ||
        typeof input.specPath !== "string" ||
        typeof input.responsePath !== "string"
      ) {
        throw new Error("run_validator requires string specPath and responsePath");
      }
      const { specPath, responsePath } = input;
      const result = validate(resolveSafePath(specPath), resolveSafePath(responsePath));
      return { output: result, isError: false };
    }
    return { output: `Unknown tool: ${name}`, isError: true };
  } catch (err) {
    return { output: err instanceof Error ? err.message : String(err), isError: true };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Runs the agentic executor loop for an evaluation prompt, tracking turns, tools, and token metrics.
 */
export async function runExecutor(evalId: number, prompt: string): Promise<ExecutorResult> {
  const client = new Anthropic();
  const system = buildSystemPrompt();
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];

  const transcript: TranscriptEntry[] = [];
  const toolCalls: Record<string, number> = {};
  let usage = emptyUsage();
  let errorsEncountered = 0;
  let finalText = "";
  let incomplete = true;
  let totalSteps = 0;

  const start = Date.now();

  for (let turn = 0; turn < MAX_EXECUTOR_TURNS; turn++) {

    totalSteps++;

    const response = await createWithRetry(
      client,
      {
        model: EXECUTOR_MODEL,
        max_tokens: 4096,
        system,
        tools: TOOLS,
        output_config: { effort: "medium" },
        messages,
      },
      "Executor",
      () => {
        errorsEncountered++;
      }
    );

    usage = addUsage(usage, toUsage(response.usage));

    const textParts = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text);
    if (textParts.length) {
      const text = textParts.join("\n");
      transcript.push({ type: "text", text });
      finalText = text;
    }

    if (response.stop_reason !== "tool_use") {
      incomplete = false;
      break;
    }

    messages.push({ role: "assistant", content: response.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      toolCalls[block.name] = (toolCalls[block.name] ?? 0) + 1;
      const { output, isError } = executeTool(block.name, block.input);
      transcript.push({ type: "tool_call", name: block.name, input: block.input, output, isError });
      if (isError) errorsEncountered++;
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: typeof output === "string" ? output : JSON.stringify(output),
        is_error: isError,
      });
    }
    messages.push({ role: "user", content: toolResults });
  }

  const durationMs = Date.now() - start;

  return {
    evalId,
    model: EXECUTOR_MODEL,
    toolCalls,
    totalToolCalls: Object.values(toolCalls).reduce((a, b) => a + b, 0),
    totalSteps,
    outputChars: finalText.length,
    transcriptChars: JSON.stringify(transcript).length,
    errorsEncountered,
    incomplete,
    durationMs,
    usage,
    finalText,
    transcript,
  };
}
