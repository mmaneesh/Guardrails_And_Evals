# Evaluation-practice comparison (planning note)

**Scope:** planned OpenAPI 3.1 / JSON Schema 2020-12 response-validation skill. One run accepts a captured JSON response plus method, path, status, and an OpenAPI document. It resolves internal references, emits normalized deterministic findings, and provides bounded evidence to an LLM judgment layer. The result is structured JSON and never makes a release decision.

## Sources reviewed

- [Hamel Husain, *Using LLM-as-a-Judge For Evaluation*](https://hamel.dev/blog/posts/llm-judge/)
- [ai-evals-course/evals-skills](https://github.com/ai-evals-course/evals-skills), especially [eval-audit](https://github.com/ai-evals-course/evals-skills/blob/main/skills/eval-audit/SKILL.md), [write-judge-prompt](https://github.com/ai-evals-course/evals-skills/blob/main/skills/write-judge-prompt/SKILL.md), [validate-evaluator](https://github.com/ai-evals-course/evals-skills/blob/main/skills/validate-evaluator/SKILL.md), and [generate-synthetic-data](https://github.com/ai-evals-course/evals-skills/blob/main/skills/generate-synthetic-data/SKILL.md).

## Alignment

| Source practice | Planned design | Assessment |
| --- | --- | --- |
| Use code for objectively checkable criteria; reserve LLM judgment for interpretation. | Schema selection, reference resolution, and response validation are deterministic; the LLM judges bounded facts/impact. | Strong alignment. [eval-audit](https://github.com/ai-evals-course/evals-skills/blob/main/skills/eval-audit/SKILL.md) explicitly flags LLM judges for schema conformance as a misuse. |
| Evaluate a specific failure mode with an explicit binary definition, not a vague quality score. | Guardrail checks can be individual binary evaluators (e.g., “does not invent a cause”, “does not make release decisions”). | Strong alignment if each guardrail is evaluated separately, rather than one broad “good report” judge. [write-judge-prompt](https://github.com/ai-evals-course/evals-skills/blob/main/skills/write-judge-prompt/SKILL.md) specifies one failure mode per judge. |
| Give a judge the context necessary to judge and require a critique/evidence trail. | The judge receives operation/schema location and minimal relevant schema/payload excerpts with each normalized finding. | Strong alignment. The bounded context is also a useful security boundary. Hamel recommends detailed critiques and sufficient context. |
| Use representative, diverse data and exercise the real system. | A schema corpus will cover independent shapes/features and run through the actual validator/skill path. | Strong alignment, provided the corpus is dimension-based and not just hand-picked happy paths. |
| Keep humans in the loop; use domain-expert labels to define acceptable behaviour. | `requires_human_decision` avoids autonomous release authority. | Strong alignment for operational safety, but the project still needs named domain owners to label/report-review examples. |

## Gaps to close before calling the eval design production-ready

1. **Error analysis first.** Both sources say evaluators should be grounded in observed/anticipated failure modes, not generic brainstormed checks. Define a failure taxonomy from captured test/production traces (or reasoned hypotheses while no traces exist), then link every eval to one failure mode. [evals-skills README](https://github.com/ai-evals-course/evals-skills#the-error-discovery-skill)

2. **Judge calibration is not optional.** The LLM judgment layer needs human-labelled Pass/Fail examples for each semantic guardrail; keep train examples for few-shot prompting separate from dev and held-out test data. Measure TPR and TNR rather than raw agreement/accuracy, inspect every disagreement, and freeze the prompt before the final test run. [validate-evaluator](https://github.com/ai-evals-course/evals-skills/blob/main/skills/validate-evaluator/SKILL.md); [Hamel’s calibration guidance](https://hamel.dev/blog/posts/llm-judge/#keep-iterating-on-the-prompt-until-convergence-with-domain-expert)

3. **Split the semantic judgment.** Do not make one judge decide all of “correctness, client impact, uncertainty, and safety.” Create atomic pass/fail judges only where code cannot decide: for example, evidence-backed impact language and unsupported causal claims. Keep output-shape, prohibited release language, citation/evidence presence, and validator ordering deterministic.

4. **Build a corpus from explicit dimensions.** Suggested axes: schema construct (`object`, array, enum, nullable, format, `$ref`, composition); operation-selection condition (method/path/status/content type); response condition (valid, required-field missing, wrong type, extra property, invalid enum); boundary (unsupported schema, bad reference, malformed spec); and adversarial/untrusted-content placement. Use pairwise/combinatorial coverage rather than claiming exhaustive combinations. [generate-synthetic-data](https://github.com/ai-evals-course/evals-skills/blob/main/skills/generate-synthetic-data/SKILL.md)

5. **Re-evaluate after material changes.** Version the corpus, prompt, validator, and model configuration; rerun deterministic regressions on every change and periodically re-label/recalibrate the LLM judges using fresh traces. Hamel recommends regular human review and re-running after material changes; eval-audit warns against set-and-forget evaluators. [Hamel](https://hamel.dev/blog/posts/llm-judge/#how-often-should-you-evaluate); [eval-audit](https://github.com/ai-evals-course/evals-skills/blob/main/skills/eval-audit/SKILL.md)

## Planning implication

The proposed architecture follows the important principle in both sources: deterministic validation establishes facts; an LLM is a narrowly scoped, calibrated evaluator of the residual judgment. It is not sufficient by itself. “Production-ready” requires the failure taxonomy, corpus, human labels, calibration report, and ongoing maintenance loop above. The skill must state a finite supported schema surface and return a structured limitation for everything outside it—not claim support for every possible schema.
