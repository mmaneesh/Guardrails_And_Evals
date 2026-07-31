# Eval Suite Restructuring — Design Spec

**Status:** Design only. No implementation yet — this doc is the spec for
a future implementation pass, not the code change itself.

## Context / Motivation

The current `evals.json` has 9 evals tagged `structural` (2), `process`
(2), `semantic` (5). Despite the tier labels, `run-evals.ts` runs every
eval through the exact same pipeline regardless of tier: a live executor
call (agentic loop against the real Claude API) followed by a live judge
call (a separate LLM grading the transcript). The README's own tier table
claims structural is "free, instant, no LLM" and process is "checkable
from the tool-call transcript" — but nothing in the code currently
implements that distinction. Every eval costs real tokens today.

This matters for the talk specifically: the session's central story is a
real scaling problem (10 evals, ~450K tokens, 22 agent invocations,
"doesn't scale") that the tiered pyramid is supposed to fix. Demoing the
pyramid live only proves the point if the live cost/token counter
actually shows tier 1 costing ~$0 and tier 3 costing real money — right
now it wouldn't, because every eval pays for the same pipeline. This spec
closes that gap between what the repo claims and what it does, and also
trims the eval count from 9 to 10 evals split 5/2/3 to fit a 40-45 minute
live session (see the companion slide-deck spec,
`2026-07-31-mot-slide-deck-design.md`, slides 9-10, which depend on this
one).

## Final Eval Lineup (10 evals)

**Structural — 5 (new pipeline: direct `validate()` call, no LLM at
all):**
1. Clean fixture → 0 structural violations, 0 enum mismatches, 0
   undocumented fields (existing eval 1, unchanged)
2. Broken fixture → `total_amount` type mismatch + missing required
   `items[0].unit_price`, both critical (existing eval 2, unchanged)
3. **New** — enum mismatch only, otherwise clean (isolates that bucket)
4. **New** — one undocumented field only, otherwise clean (isolates that
   bucket)
5. **New** — optional field (`discount_code`) genuinely absent, otherwise
   clean → asserts zero violations; this is a mechanical proof of
   Guardrail #1 ("absence of an optional field is never a violation")

**Process — 2 (executor still runs live; judging becomes mechanical):**
6. Validator called before any severity claim appears (existing eval 3)
7. Enum mismatch routed through `references/breaking_change_judgment.md`
   before severity is assigned (existing eval 4)

**Semantic — 3 (unchanged pipeline: executor + live LLM judge):**
8. Enum severity judgment — "canceled" vs. "cancelled" rated medium, not
   critical, with strict-vs-lenient client reasoning (existing eval 5) —
   the one eval that demonstrates the skill's actual judgment value, not
   just its guardrails
9. Refuses to declare the API "safe to ship" (existing eval 8, tests
   Guardrail #4)
10. Resists the prompt-injection payload in `order_response_injection.json`
    (existing eval 9)

**Dropped:** existing eval 6 (undocumented-field judgment call) and
existing eval 7 (declines to speculate on root cause). Both are
reasonable evals, but evals 8 and 9 already cover the "refusal" and
"adversarial robustness" ground, and eval 5 covers "judgment quality" —
keeping all 5 semantic evals would push the total past 10 and dilute
stage time without adding a new category of proof.

## Architecture: Tiered Grading

### Tier 1 — Structural
Skip the executor and the judge entirely. For each structural eval, call
`validate(specPath, responsePath)` directly — exactly what
`selftest-validator.ts` already does — and assert the returned
`structuralViolations` / `enumMismatches` / `undocumentedFields` counts
(and, where relevant, specific field names) against an `expected_counts`
block declared on that eval in `evals.json`. Pure function call: zero
tokens, zero live-API risk, sub-second for the whole tier.

### Tier 2 — Process
Keep the live executor call — testing "did the skill take the right
steps" inherently requires watching the skill actually run, which needs a
live model turn. Skip the judge call. Grade the resulting
`ExecutorResult.transcript` with a new mechanical rule checker instead:

- Eval 6's rule: no `text` transcript entry appears before the first
  `tool_call: run_validator` entry.
- Eval 7's rule: a `tool_call: read_file` entry for
  `references/breaking_change_judgment.md` appears before any `text`
  entry that assigns a severity to the enum mismatch.

Cost = executor tokens only, no judge tokens.

### Tier 3 — Semantic (unchanged)
Executor + live LLM judge, exactly as implemented today. This is the
only tier that actually needs subjective judgment-quality grading, and
it's the one place in the suite where real cost should show up on the
live counter.

## Code Changes Required

- **Eval IDs** — the lineup above is numbered 1-10 for readability in this
  doc, cross-referenced to today's IDs. Implementation should renumber
  `evals.json` entries to a clean 1-10 sequentially (dropping the old IDs
  6 and 7 entirely rather than leaving gaps), since the two dropped
  semantic evals mean the current 1-9 numbering can't survive as-is
  either way.
- **`scripts/run-evals.ts`** — replace the current uniform
  executor→judge loop with a per-tier dispatch: structural evals call a
  new lightweight check function and skip both `runExecutor` and
  `runJudge`; process evals call `runExecutor` then a new mechanical
  `checkProcessRules` function instead of `runJudge`; semantic evals are
  unchanged. The existing summary table and `--max-cost` logic stay, but
  now the numbers they show will actually differ by tier.
- **`evals.json` schema** — structural entries need an `expected_counts`
  field (and optionally `expected_fields` for named-field assertions)
  instead of prose `expectations`. Process entries need a small
  structured rule list (e.g. `{ type: "tool_before_text", tool:
  "run_validator" }`) instead of prose `expectations`. Semantic entries
  are unchanged — they keep prose `expectations` for the LLM judge.
- **New fixtures** — three new response JSON files under `evals/files/`,
  each isolating exactly one deterministic concept: enum-mismatch-only,
  undocumented-field-only, optional-field-absent. All pair with the
  existing `order_schema.yaml`.
- **`scripts/selftest-validator.ts`** — extend its `expectations` array
  to cover the three new fixtures too. The README already treats this
  file as the trust layer everything downstream depends on, so new
  structural fixtures should get the same free, no-LLM coverage there
  before they're used in `evals.json`.

## Known Approximations / Risks

- Eval 6's current prose expectation "Skill does not attempt to hand-roll
  its own schema comparison instead of using the script" doesn't need a
  transcript rule at all — the executor's sandboxed toolset (`read_file`,
  `run_validator`, no shell) already makes hand-rolling a comparison
  impossible by construction. Worth dropping this expectation rather than
  writing a rule to check something the architecture already guarantees.
- Eval 7's prose expectation "Skill does not assign 'critical' severity
  to the enum mismatch without justification" is only partially
  mechanical: checking *that* "critical" wasn't the assigned severity is
  a simple string check, but checking "without justification" is a
  judgment call a rule-based checker can't really make. The mechanical
  version of this eval will be strictly narrower than what the LLM judge
  currently checks — it verifies severity isn't wrongly "critical," not
  that the justification is good. That's an intentional trade-off for
  this tier (make it fast and free) but worth saying out loud rather than
  claiming parity with the old judge-graded version.
- Eval 7's originally-planned second process rule — a `read_file` check
  that the model reads `references/breaking_change_judgment.md` before
  assigning severity — was dropped during implementation.
  `scripts/executor.ts`'s `buildSystemPrompt()` already inlines that
  file's full content into the cached system prompt, so the model has no
  functional reason to call `read_file` on it. The rule would have been
  unpassable-by-design rather than a meaningful process signal. Eval 7
  therefore relies solely on the `final_text_field_not_severity` rule.

## Dependencies

Slides 9 ("Live Demo setup") and 10 ("How We Validate") in the slide-deck
spec depend on the final numbers here (eval counts per tier, actual
terminal output shape) — once this spec is implemented and run once for
real, those two slides can be filled in with real content instead of
placeholders.

## Non-Goals

- No code changes in this pass — spec only.
- Does not touch `scripts/validate-schema.ts` or the judgment framework
  in `references/breaking_change_judgment.md` — both are unchanged.
- Does not redesign the slide deck — that's the companion spec.
