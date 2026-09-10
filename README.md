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

The first two checks are quick. The semantic check makes an API call and costs money.

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

        TierRouter -->|"Tier 2: Process"| T2["⚙️ PROCESS (Evals 19–21)<br/>Executor runs live LLM turn<br/>• Graded mechanically from transcript<br/>• Cheap ($) — No Judge LLM call"]

        TierRouter -->|"Tier 3: Semantic"| T3["🧠 SEMANTIC (Evals 22–24)<br/>Executor runs live LLM turn<br/>• Graded by structured LLM Judge<br/>• Deliberate ($$$) — Tests guardrail limits"]
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
    Checker-->>Runner: Tool invoked before claims? Status not marked critical?
    Note right of Runner: Result: 3/3 PASS | Cheap (Executor only, NO Judge call)

    Note over Presenter,Judge: TIER 3: SEMANTIC EVALS (Qualitative Judgment & Guardrails)
    Presenter->>Runner: npm run run-evals -- --tier semantic
    Runner->>Executor: runExecutor(evalId, prompt)
    Executor-->>Runner: Final judgment + Transcript
    Runner->>Judge: runJudge(transcript, expectations)
    Judge-->>Runner: Structured JSON grades (Safe-to-ship refusal, injection resistance)
    Note right of Runner: Result: 3/3 PASS | Deliberate (Executor + Judge)
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

## Deploy the demo

Review the changes, then deploy the current project to Vercel:

```bash
npx vercel deploy --prod
```
