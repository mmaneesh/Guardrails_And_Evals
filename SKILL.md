---
name: contract-drift-judge
description: Judges whether a discrepancy between an OpenAPI spec and an actual API response is a real breaking change or acceptable drift. Use this skill whenever the user provides an OpenAPI/Swagger spec alongside an actual API response (or a diff between two spec versions) and asks whether something "broke," is "backward compatible," or needs a severity/impact assessment. Also trigger when the user mentions contract testing, API drift, breaking changes, or schema validation combined with a judgment question like "does this matter" or "is this safe." Do not use this skill for plain schema validation with no judgment question attached - that's a job for a validator library directly, not this skill.
---

# Contract Drift Judge

## What this skill is (and isn't)

This skill does **not** re-implement schema validation. A deterministic
validator (`scripts/validate-schema.ts`, using `ajv` - the same job `zod`
or `openapi-schema-validator` would do) already tells you, with certainty,
whether required fields are missing or types don't match. Always run that
script first and treat its output as ground truth for facts.

What this skill adds is the layer a validator library cannot provide:
**judgment about real-world impact** - is a given discrepancy actually
going to break a real client, given context the schema alone doesn't
capture? That judgment is the entire value of using an LLM here. If a task
only needs the deterministic facts, say so and stop - don't manufacture
judgment where none is needed.

## Guardrails

These are hard constraints, not suggestions. Violating any of these makes
the output actively misleading, not just imperfect.

1. **No false positives from unlisted requirements** - never mark a field
   as "breaking" unless it is genuinely required or genuinely alters client
   behavior. Absence of an optional field is never a violation.
2. **No scope creep beyond the spec** - only comment on fields, endpoints,
   or behavior the provided spec actually covers. Do not editorialize about
   naming conventions, style, or anything not in scope.
3. **No fabricated values or causes** - only quote values that actually
   appear in the response. Never guess what a missing field "probably"
   contained, and never assert *why* a discrepancy exists unless the
   evidence supports it.
4. **No pass/fail authority** - this skill reports violations and judgment;
   it never declares an API "safe to ship" or "passing." That decision
   belongs to a human.
5. **Severity must be justified, not asserted** - every severity rating
   must cite the specific field and the specific spec clause it violates.

## Instructions

1. Run the deterministic validator first:
   ```
   npx tsx scripts/validate-schema.ts <spec.yaml> <response.json>
   ```
   This returns three buckets: `structuralViolations` (hard facts),
   `enumMismatches` (facts needing judgment), and `undocumentedFields`
   (facts, not violations by default).

2. For every item in `structuralViolations`, report it as-is - these are
   deterministic and require no judgment. Do not second-guess the
   validator's severity for required-field violations.

3. For every item in `enumMismatches` and `undocumentedFields`, apply the
   judgment framework in `references/breaking_change_judgment.md` before
   assigning a severity or deciding whether to surface it at all. Read that
   file before making these calls - do not improvise criteria.

4. Produce a structured report: for each finding, include `field`,
   `expected`, `actual`, `severity`, and a one-sentence `justification`
   that a human could verify by checking the spec themselves.

5. End with a plain-language summary, but never a pass/fail verdict on the
   API as a whole (Guardrail #4).

## Reference files

- `references/breaking_change_judgment.md` - the criteria for classifying
  enum mismatches and undocumented fields as breaking, non-breaking, or
  needing clarification. Read this before making any severity call that
  isn't a straightforward required-field violation.
