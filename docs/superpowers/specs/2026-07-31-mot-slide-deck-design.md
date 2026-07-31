# MoT Chapter Session Slide Deck — Design Spec

**Status:** Design only. No implementation yet — this doc is the spec for a
future implementation pass, not the deck itself.

## Context

This is the slide deck for a Ministry of Testing AI Chapter session on
Guardrails & Evals, presented by Maneesh Maddala. Session logistics: 60
minutes total, 40-45 minutes of presentation, remainder for intros/Q&A.
Audience is a mix of functional testers, API testers, and SDET/automation
engineers — the deck should read cleanly for the non-coders in the room
while staying credible to the SDETs.

The demo material for this session is the `contract-drift-judge` repo
(this repo) — a real Claude Skill plus a tiered eval harness. The talk's
central argument comes from a real prior experience: running 10 evals the
naive way (LLM executor + LLM judge for every eval) cost ~450K tokens
across 22 agent invocations and didn't scale. The tiered eval pyramid
(structural → process → semantic) is presented as the fix.

This is the second session in a "Field Notes" series — the first was
*Skills & Plugins for Testers* (`everyday-ai-coding.vercel.app`), built
around a trail-map analogy (a Skill is like a trail map: written once,
followed every time). This deck should read as session 2 of that same
series, not a new visual identity.

## Format & Visual System

Reuse the reference deck's system exactly, not just its spirit:

- **Structure:** single-file HTML, fixed 1920×1080 stage scaled to fit
  the viewport, `<section class="slide">` per slide, click/arrow/scroll
  navigation with click-to-reveal fragments (`[data-step]`), a progress
  dot bar, keyboard nav, touch swipe, mobile zoom toggle, print support
  (`@media print` unrolls all slides to a linear page-per-slide layout).
- **Type:** Fraunces (display/headlines), IBM Plex Mono (kickers, labels,
  code, meta), Newsreader italic (body/lead text).
- **Color:** deep green/black background (`--bg-deep: #10140f`), warm
  paper foreground (`--paper: #f8f4ea`), rust-orange accent
  (`--rust-bright: #f28e4f`) for kickers, emphasis, and active states.
- **Recurring components to reuse as-is:**
  - `fg-coord` / `fg-page` header (top-left coordinates, top-right page
    count) — update the coordinate text to signal a new "location" for
    this talk (see Slide 1) while keeping the same visual treatment.
  - Waypoint trail bar (title slide + closing slide) showing the talk's
    major sections as a dotted path.
  - Ledger table (3-column comparison, used for Vocabulary) — reuse for
    the Guardrail vs. Eval vocabulary slide and for the Unit/Integration/
    E2E testing-analogy slide.
  - Card grid (used for "Skills We Use") — reuse for the Best Practices
    slide.
  - Terminal-window panel pair (used for the before/after demo) — reuse
    for the Live Demo setup slide.
  - Log-entry grid (WHAT WE TRIED / WHERE IT BROKE / WHAT WE CHANGED /
    WHAT IT DOES NOW) — reuse for the Our Story slide.
  - Closing quote + Q&A treatment — reuse as-is.
- **New components needed (not present in the reference deck):**
  1. **Pyramid diagram** — three horizontal bands narrowing top to
     bottom (or a literal triangle), labeled Structural/Unit (widest,
     free), Process/Integration (narrower, cheap), Semantic/E2E
     (narrowest, expensive). Needs a cost/count annotation per band
     (e.g. eval count and $ per band) so it reads as data, not just
     decoration.
  2. **Railing/ranger analogy panels** — an outdoor scene distinct from
     session 1's forest (a cliff-edge trail rather than a forest
     interior), consistent with the `fg-contours` SVG background style
     already established. Likely two visual beats on this slide: the
     railing itself, and a simple 3-step inspection ladder (visual walk
     → hands-on check → load test) that foreshadows the pyramid slide.

## Narrative Spine

The through-line for the whole deck is: **a guardrail is the railing on
the cliff-edge trail — a hard constraint that holds regardless of how the
hiker got close to the edge. An eval is how the park verifies the railing
actually holds, and it does that in tiers of increasing cost and rigor:**

- **Tier 1 — daily visual walk.** Is the railing there, visibly intact?
  Free, instant, done on every stretch every day. → Structural tier /
  unit tests.
- **Tier 2 — quarterly hands-on check.** Ranger grabs each post, confirms
  mounting bolts are torqued, confirms the inspection *procedure* itself
  was followed and logged. → Process tier / integration tests.
- **Tier 3 — annual certified load test.** An engineer rigs a hydraulic
  press to the railing and applies real force, proving it holds under
  real-world stress, not just that it looks fine. → Semantic tier / e2e
  tests.

**Known gap to bridge explicitly on stage:** unlike a vault or a bear
canister, a railing has no natural adversary. The load test slide should
include one explicit bridge line connecting "does it hold under real
force" to "does it hold when something is actively trying to defeat it"
(storm, rockslide, or an unexpected crowd leaning on it at once) so the
audience is primed for the prompt-injection eval later without the
analogy having to carry that weight on its own.

## Slide-by-Slide Breakdown (12 slides)

1. **Title** — Same coordinate/compass treatment as session 1, but a new
   "location" (cliff-edge, not forest) to signal continuity-with-a-twist.
   Kicker: session series name. Headline: "Guardrails & Evals." Subtitle:
   one line establishing the railing/ranger frame before it's explained.
   Footer: presenter, MoT AI Chapter, date.

2. **Agenda** — Same waypoint-line list component as session 1, seven
   items matching this outline's major beats: The Analogy, The
   Vocabulary, Best Practices, The Testing Analogy, The Pyramid, Our
   Story, Live Demo. ("How We Validate" and "Takeaways" fold under the
   Live Demo agenda item rather than getting their own line, matching
   how session 1's agenda didn't give every slide a separate entry.)

3. **The Analogy** — The railing/ranger story in full, per the Narrative
   Spine above. Ends on the explicit "what if something's actively
   trying to get past it" bridge line.

4. **The Vocabulary** — Ledger table, two rows: **Guardrail** (a
   constraint the skill must obey, defined in `SKILL.md`) vs. **Eval** (a
   test that checks whether it actually did, defined in `evals.json`).
   Make the distinction concrete with one line each pulled from this
   repo, e.g. Guardrail #4 ("never declare safe to ship") next to the
   eval that tests it (eval 8/refusal).

5. **Best Practices** — Card grid, split into two groups: writing
   guardrails (falsifiable, specific, tied to one real failure mode —
   not vague principles) and writing evals (tiered by cost, include at
   least one adversarial case, grade only what the tier can actually
   verify).

6. **The Testing Analogy** — Ledger-style 3-row table: Unit /
   Integration / E2E, mapped to Structural / Process / Semantic, each
   row annotated with relative cost and how often you'd run it in CI
   (every commit / every PR / deliberately). This is where "cheap tiers
   run freely, expensive tier runs deliberately" gets said explicitly for
   the first time in test-suite language the audience already knows.

7. **The Pyramid** — The new pyramid diagram component. Same three tiers,
   now shown as a single shape (wide free base, narrow expensive tip)
   rather than a table — the visual payoff of slide 6.

8. **Our Story** — Log-entry grid, same 4-beat structure as session 1's
   "Our Story" slide: WHAT WE TRIED (LLM executor + LLM judge on every
   eval) / WHERE IT BROKE (10 evals, ~450K tokens, 22 agent invocations —
   "this doesn't scale") / WHAT WE CHANGED (tiered the evals by what they
   actually need) / WHAT IT DOES NOW (cheap tiers run on every change,
   expensive tier runs deliberately).

9. **Live Demo (setup)** — Terminal-panel pair or single prompt-box
   introducing what's about to run live, tier by tier. Exact terminal
   content depends on the final eval lineup and CLI output format, which
   is being spec'd separately (eval-suite restructuring spec, not yet
   written) — placeholder content only until that spec exists.

10. **How We Validate** — Explains the grading split (mechanical checks
    for tiers 1-2, live LLM judge for tier 3) and closes on "the receipt"
    — the real cost/token summary table from the live run, tied back to
    slide 8's 450K-token number. Like slide 9, final content depends on
    the eval-suite spec.

11. **Takeaways** — 3-4 principles, plain list: separate facts from
    judgment; tier evals by what they actually need; write guardrails as
    things you can adversarially test; run cheap tiers on every change,
    expensive tier deliberately.

12. **Closing / Q&A** — Same quote + Q&A + footer treatment as session 1.
    Quote TBD — should echo the railing/ranger frame (e.g. something
    about guardrails only being worth trusting once they've been tested,
    not just installed).

## Dependencies / Open Items

- Slides 9 and 10's exact content (terminal output, final cost numbers)
  depend on the eval-suite restructuring (5 structural / 2 process / 3
  semantic evals, mechanical grading for tiers 1-2) discussed and agreed
  in conversation but **not yet written up as its own spec**. That's a
  separate design doc to write before either slide can be finalized.
- Closing quote (slide 12) is a placeholder — needs actual copy.
- Exact pyramid diagram proportions/annotations (eval counts, $ per tier)
  should be filled in once the eval-suite spec locks the final numbers.

## Non-Goals

- No HTML/CSS/JS implementation in this pass — spec only.
- Does not cover the eval-suite code changes (`run-evals.ts`,
  `evals.json` schema, new fixtures) — separate spec.
