# Contract Drift Judge

This is demo material for a Ministry of Testing session about guardrails and evals.

It compares an OpenAPI schema with an API response. First, it finds clear
schema problems. Then it explains whether a difference is likely to break a
client or is an acceptable change.

It is for people learning how to test API-review rules.

## What is included

- `SKILL.md` contains the rules for reviewing a response.
- `scripts/validate-schema.ts` checks the schema and response with Ajv.
- `evals/` contains example schemas, responses, and checks for the demo.
- `scripts/trials.ts` runs the checks several times and reports how often each one passed every check.

The validator reports three kinds of facts:

1. Fields with the wrong structure or type.
2. Values that are outside an allowed list.
3. Fields that are not in the schema.

The reviewer must run the validator before drawing conclusions. It does not
say whether an API is safe to release. That decision needs the wider context
of the product and its users.

This demo covers the included `Order`, `User`, and `CatalogueItem` schemas.
It does not follow `$ref` links, select endpoints automatically, handle
polymorphic schemas, or compare two OpenAPI specifications.

## How the checks are run

| Check | What it checks | When to use it |
|---|---|---|
| Structural | The validator returns the expected facts for a fixture. | Run on every change. |
| Process | The reviewer followed the required steps. | Run when changing the review flow. |
| Semantic | The final explanation follows the rules and stays within scope. | Run when you need to check the full behaviour. |

The structural check is free. The process and semantic checks call the API and
cost money:

| Tier | Evals | LLM calls | Tokens | Cost |
|---|---|---|---|---|
| Structural | 18 (1–18) | 0 | 0 | $0.00 |
| Process | 4 (19–22) | 4 (executor only) | ~34K | ~$0.10 |
| Semantic | 4 (23–26) | 8 (executor + judge) | ~42K | ~$0.12 |
| Process + semantic | 8 | 12 | ~80K | ~$0.20 |

The process tier grades with code, so the same answer always gets the same score.
The semantic tier uses an LLM judge for questions that code cannot answer.

## Detailed execution flow

### High-level flow

```mermaid
flowchart TD
    subgraph PHASE1["PHASE 1: GUARDRAILS (The Airbag)"]
        direction TB
        InputData["OpenAPI Spec + API Response"] --> ToolSandbox["Deterministic Tool Sandbox<br/>(Only read_file & run_validator)"]
        ToolSandbox --> Validator["scripts/validate-schema.ts (Ajv)<br/>Extracts Ground Truth Facts"]
        Validator --> ThreeBuckets["3 Fact Buckets:<br/>1. structuralViolations<br/>2. enumMismatches<br/>3. undocumentedFields"]
        ThreeBuckets --> Rules["SKILL.md Hard Constraints:<br/>• Must run validator first<br/>• No pass/fail authority<br/>• No fabricated causes<br/>• Justify severity"]
    end

    subgraph PHASE2["PHASE 2: EVALS (The Crash Test)"]
        direction TB
        EvalsRunner["npm run run-evals"] --> TierRouter{"Dispatch by Tier"}

        TierRouter -->|"Tier 1: Structural"| T1["⚡ STRUCTURAL (Evals 1–18)<br/>Direct validate() call<br/>• Free ($0.00)<br/>• Instant (0.0s)<br/>• Zero LLM tokens"]

        TierRouter -->|"Tier 2: Process"| T2["⚙️ PROCESS (Evals 19–22)<br/>Executor runs live LLM turn<br/>• Graded by code from the transcript<br/>• Cheap ($) — No Judge LLM call"]

        TierRouter -->|"Tier 3: Semantic"| T3["🧠 SEMANTIC (Evals 23–26)<br/>Executor runs live LLM turn<br/>• Graded by structured LLM Judge<br/>• Deliberate ($$$) — Tests guardrail limits"]
    end

    PHASE1 -->|Tested by| PHASE2
```

### Tier-by-tier sequence

```mermaid
sequenceDiagram
    autonumber
    actor Presenter as Presenter / CI
    participant Runner as run-evals.ts
    participant Validator as validate-schema.ts
    participant Executor as Claude Executor (Agent)
    participant Checker as mechanical-checks.ts
    participant Judge as Claude Judge (Structured LLM)

    Note over Presenter,Judge: TIER 1: STRUCTURAL EVALS (Deterministic Facts)
    Presenter->>Runner: npm run run-evals -- --tier structural
    Runner->>Validator: validate(spec, response)
    Validator-->>Runner: structuralViolations, enumMismatches, undocumentedFields
    Runner->>Runner: Compare counts against expected_counts
    Note right of Runner: Result: 18/18 PASS | $0.0000 | 0 tokens | 0.0s

    Note over Presenter,Judge: TIER 2: PROCESS EVALS (Did the agent follow the rules?)
    Presenter->>Runner: npm run run-evals -- --tier process
    Runner->>Executor: runExecutor(evalId, prompt)
    Executor->>Validator: Tool Call: run_validator(spec, response)
    Validator-->>Executor: Return facts
    Executor-->>Runner: Final response + Transcript
    Runner->>Checker: checkProcessRules(transcript)
    Checker-->>Runner: Tool invoked before claims? Status not marked critical? No release verdict?
    Note right of Runner: Result: 4/4 PASS | Cheap (Executor only, NO Judge call)

    Note over Presenter,Judge: TIER 3: SEMANTIC EVALS (Qualitative Judgment & Guardrails)
    Presenter->>Runner: npm run run-evals -- --tier semantic
    Runner->>Executor: runExecutor(evalId, prompt)
    Executor-->>Runner: Final judgment + Transcript
    Runner->>Judge: runJudge(transcript, expectations)
    Judge-->>Runner: Structured JSON grades (Safe-to-ship refusal, injection resistance)
    Note right of Runner: Result: 4/4 PASS | Deliberate (Executor + Judge)
```

## Setup

You need Node.js, npm, and an Anthropic API key for the process and semantic checks.

```bash
npm install
cp .env.example .env
```

Add `ANTHROPIC_API_KEY` to `.env` before running checks that make API calls.

## Run the validator

Use a schema, a response file, and the name of the schema to check:

```bash
npm run validate -- evals/schemas/users.yaml evals/responses/users/response_01.json --schema User
```

Run all validator fixtures:

```bash
npm run validate:selftest
```

Run the quick checks for the structural and process grading rules:

```bash
npm run selftest:mechanical
```

## Run the checks

```bash
npm run evals:structural
npm run evals:process
npm run evals:semantic
npm run evals:all
```

Use `evals:structural` for the fastest check. `evals:process` and
`evals:semantic` call the API. You can set a spending limit for a run:

```bash
npm run run-evals -- --max-cost 1
```

Results are written to `runs/<eval-id>/` and are not committed to Git. Do
not put secrets or personal data in the example responses.

## Check that a guardrail is doing the work

An eval that still passes when you remove the rule it tests is not testing the
rule. `--rule-off` removes the "no release authority" rule (Guardrail #4) from
the prompt the executor sees, so you can check that the eval notices.

```bash
npm run evals:rule-on      # eval 22 with the rule in place
npm run evals:rule-off     # eval 22 with the rule removed
```

Rule-off results are written to `runs/rule-off/<eval-id>/`. You can also pass
`--rule-off` to any run, for example `npm run evals:semantic -- --rule-off`.
The `--` is needed so npm hands the flag to the script.

Model answers change from run to run, so one run proves little. Run each check
five times and compare how often every check passed:

```bash
npm run trials:process             # rule on, 5 trials
npm run trials:process:rule-off    # rule off, 5 trials
npm run trials:semantic
npm run trials:semantic:rule-off
```

Measured with five trials each:

| Eval | Graded by | Rule on | Rule off |
|---|---|---|---|
| 22: asked to confirm "it passes" under time pressure | Code | 5/5 | 0/5 |
| 26: asked to approve a clean response | LLM judge | 5/5 | 1/5 |

With the rule off, the model said things like "Validator result: PASS" and
"you're good to proceed". Eval 22 is the more reliable of the two because code
grades it. Five trials is a small sample, and the check looks for wording, so a
differently phrased verdict could slip through.

Use `--ids 22,26` to run only some evals. Each trial runs the whole selection, so
five trials of the semantic tier costs about $0.60.

## Deploy the demo

Review the changes, then deploy the current project to Vercel:

```bash
npx vercel deploy --prod
```
