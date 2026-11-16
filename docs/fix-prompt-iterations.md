# Fix prompt: a report the design system's own brain can act on

**Target:** after one round (the prompt goes to the user's system, the system
changes its tokens, and the result is loaded into a *fresh* DTsanity, or any
other checker), at least 90% of the listed findings are gone, nothing new
appears, and every finding that is left is one the system's report declined
with a reason.

## Principles (these decide every step below)

1. **DTsanity reports; the system decides.** Design systems have their own
   "brains": generators, Figma pipelines, naming rules, scripts, agents with
   repository access. The prompt describes each problem with enough context for
   that brain to fix it *its* way. It never prescribes a solution ("point X at
   Y"), picks a token, or applies edits.
2. **Every finding stands on its own.** An LLM with no other context than the
   prompt and the files must understand each item and work out a correct fix.
   Nothing refers to DTsanity's screens, settings or earlier runs.
3. **The check is objective and fresh.** An item says what must be true
   afterwards, in terms any checker can verify against the spec it cites. The
   result passes or fails on a fresh run, whatever the starting point.
   DTsanity keeps nothing between sessions and doesn't compare against the
   original.
4. **Spec rules and conventions stay apart.** A finding backed by a standard
   (DTCG 2025.10, WCAG 2.2) is a requirement. A finding from a DTsanity
   convention (tiers, naming, look-alike typography) is advice. The system's
   own rules may override it, and declining it with a reason counts as done.
5. **Nothing is tuned to a sample.** Every change holds on all ten samples,
   and no message, rule or threshold mentions a sample's tokens.

## What changes from the current prompt

| Today | Becomes |
|---|---|
| The prompt suggests fixes ("→ `{size.a}`") and asks the assistant to rewrite files | Each item states the problem, the evidence and the "done when"; the fix belongs to the system |
| Rules say how to change the files | Rules say what the result must satisfy, and ask the system to fix tokens where it produces them (source, generator, Figma) when the files are generated |
| A finding is a line of text | A finding is an item: id, where, rule and its source, evidence, done when, and a way to decline |
| Contrast says "below AA, has 3.9" | It also gives both colors per theme, the alias chain to the base value, and the themes where it must pass |
| Everything reads as a must | Each item is marked **Required (spec)** or **Advice (convention)** |
| The report is free-form | The report lists each item id: fixed, or declined and why |

An item, as the system would receive it:

```
### C-12 · Required (WCAG 2.2, 1.4.3) · contrast
Where: semantic/light.tokens.json:88, semantic/dark.tokens.json:88
Problem: `fgColor.muted` used as text on `bgColor.default` is below 4.5:1.
Evidence: light 3.9:1 (#6e7781 on #ffffff), dark 4.1:1 (#7d8590 on #0d1117).
  Chain: fgColor.muted → base.neutral.8 → #6e7781 (light).
Done when: this pair reaches 4.5:1 in light and dark.
Decline if: these two tokens are never used together as text on background
  (DTsanity paired them by name). Say so in the report.
```

The system chooses how to reach 4.5:1: another step of its scale, a new value,
or a different pairing. DTsanity only checks the outcome.

## Step 0. One instrument

- [ ] The theme-variant work in the tree is committed or parked. Localhost and
      dtsanity.com run the same code.
- [ ] The page footer and the prompt name the build (commit) and the settings
      that change counts, so a fresh run can be matched to the prompt it
      answers.

**Validation:** the same files show the same count and build on localhost and
on dtsanity.com.

## Step 1. Remove DTsanity's misreadings (the biggest lever)

A finding that comes from DTsanity reading a valid set wrongly sends the
system's brain to change correct tokens. No prompt can fix that, and it costs
the user the most. Audit every rule on all ten samples. Look first at the
rules with the most findings per set (SAP's theme files, Cloudscape's modes,
variant files read as duplicates).

**Validation:** each misreading fixed gets a fixture test. No sample's count
rises.

### Audit results (2026-11-15, working tree with the theme-variant work)

Run with `npm run audit -- <out.json>`: counted findings of every sample by
rule, with every finding listed, legacy formats accepted.

**The theme-variant work already removes misreadings.** Compared with the
committed code:
- Primer falls from 946 to 613: 243 false duplicate paths and 190 false tier
  findings go once `dark.dimmed` and `dark.high-contrast` are read as variants
  of `dark`.
- Designsystemet falls from 616 to 596, and GitLab from 501 to 495.
- What rises comes from themes that were never checked before: high-contrast
  variants, now held to the enhanced level, and mode alphas, now applied.

**What is still misread, by kind (counts are estimates from token names, to
confirm rule by rule):**

| Misreading | Rule | Sets | Findings |
|---|---|---|---|
| Theme files with the same paths read as one set (`sap_horizon`, `_dark`, `_hcb`, `_hcw`): every token is a "duplicate" | duplicate-path | SAP | 18,511 |
| Per-theme values inside a token not read as themes (`"$value": {"light", "dark"}`; `"sets": {"light", "dark"}`) | reference-to-group; contrast never checked | Spectrum, Cloudscape | 329, plus hidden contrast |
| A border checked against its own component's fill. WCAG 1.4.11 asks that the component stand out from what's around it, not the border from its own fill | contrast (ui) | Primer, Atlassian, GitLab, Carbon | about 180 |
| A name read by its first role word: `button.outline.bgColor` read as an outline (a foreground), not a background | contrast | Primer, Carbon, Backpack | about 65 |
| Disabled states counted, though WCAG 1.4.3 and 1.4.11 exempt inactive components | contrast | Primer, Atlassian, Carbon | about 50 |

**Conditional, not misread:** a border on the page background (`border-subtle`
on `background`) must pass only when it's the only thing that shows a
component's edge or state. Decorative dividers are exempt. DTsanity can't
tell which from the files, so these are Advice with a "decline if".

**Estimated share per set** (misread / advice / required):

| Set | Counted | Misread | Advice | Required |
|---|---|---|---|---|
| Atlassian | 2,078 | 4% | 3% | 93% |
| Backpack | 157 | 1% | 1% | 98% |
| Carbon | 49 | 39% | 37% | 24% |
| Cloudscape | 5,140 | 0% (contrast hidden) | 0% | 100% |
| Designsystemet | 596 | 0% | 34% | 66% |
| GitLab | 495 | 2% | 18% | 80% |
| Open Props | 718 | 0% | 0% | 100% |
| Primer | 613 | 37% | 18% | 45% |
| SAP Horizon | 30,633 | 60% | 3% | 37% |
| Spectrum | 4,443 | 7% | 2% | 91% |

Advice is the tier rules, status-color groups and conditional borders.

**What "required" mostly is:** one format choice repeated in every token,
which the system fixes once in its generator:
- Atlassian: flat names with dots, 1,868.
- Cloudscape: no `$type`, 5,139.
- Spectrum: `$schema` and `uuid` on every token, 2,823.
- SAP: expressions and the type `internal`, 11,159.

The prompt should name the cause once per pattern, with its places, so the
system can fix it at the source rather than token by token.

### Misreadings fixed (2026-11-15)

Each fix has a fixture test:
- **Files that define the same tokens are themes.** SAP's four files become
  four themes, and its 18,511 false duplicates go. Each file's own findings
  now count once per file: they were hidden behind the file that won.
- **Values by mode written in the token are read as themes** (legacy formats
  accepted). This covers `"$value": {"light", "dark"}` and Spectrum's
  `"sets"`. Only maps whose keys all name a mode count, so states
  (`default`/`disabled`) and densities (`comfortable`/`compact`) don't.
  - One finding per file says this isn't DTCG (`value-per-mode`).
  - Spectrum loses 329 false references to groups and 777 false "neither
    token nor group" findings. GitLab loses 321 per-mode maps that had been
    read as broken colors.
  - Contrast is now checked in GitLab's themes.
- **A name's role is its last role word** (`button.outline.bgColor` is a
  background). Only that word leaves the pairing key, so the outline button's
  text pairs with the outline button's background.
- **Borders are checked on the default backgrounds**, never on the fill they
  surround.
- **Disabled and inactive pairs are listed, not counted.** The new policy
  rule `contrast-inactive` defaults to info, and the user can raise it. The
  prompt leaves info-level pairs out, as the Issues page does.

Two related fixes came out of the tests:
- A number named as a weight gets the type `fontWeight`, not `number`.
- Export to a Style Dictionary file writes `{a.b.value}` only if the file did.

| Set | Before | After | Themes |
|---|---|---|---|
| Atlassian | 2,078 | 2,001 | 4 |
| Backpack | 157 | 155 | 0 |
| Carbon | 49 | 40 | 4 |
| Cloudscape | 5,140 | 5,141 | 0 → 2 |
| Designsystemet | 596 | 596 | 12 |
| GitLab | 495 | 396 | 0 → 2 |
| Open Props | 718 | 718 | 0 |
| Primer | 613 | 531 | 5 |
| SAP Horizon | 30,633 | 28,595 | 0 → 4 |
| Spectrum | 4,443 | 2,878 | 0 → 3 |

**Still open:**
- Atlassian's borders go unchecked. Its names carry the theme
  (`tokens.Dark/color.…`), so no background reads as the default.
- Cloudscape's contrast is still unchecked: none of its tokens has a type, so
  none is read as a color.
- Borders on the page background are conditional (step 2: Advice).

## Step 2. Sort every rule: requirement or advice

Tag each rule with its source: a DTCG section, a WCAG criterion, or "DTsanity
convention". Rules with neither are reviewed: either they become advice, or
they go.

**Validation:** a test fails if any rule lacks a source.

### Done (2026-11-15)

`src/policy/basis.ts` gives every rule a source and a standing. The Policy
page shows both, and `tests/policy.test.ts` fails if a rule has none.
- **DTCG rules** cite Format or Color Module 2025.10 by section number and
  title, taken from the published table of contents.
- **WCAG rules** cite the success criterion.
- **DTsanity conventions** are always Advice: tiers, scales, typography,
  color-blindness simulation, and one token defined in several files.

What the spec settled:
- **DTCG doesn't address the same token defined in two files**, so
  `duplicate-path` is a DTsanity convention, not a requirement.
- **DTCG reserves unknown `$` properties but doesn't forbid them** (5.1.1), so
  `unknown-property` is Advice. This covers Spectrum's `$schema`.
- **Borders now have their own rule, `contrast-border`**, which is Advice.
  WCAG 1.4.11 applies only where a border is what shows the component or its
  state, and the files can't say which. Inactive pairs are Advice too.
- **DTCG 5.2.2 says tools must not guess a token's type from its value.** The
  missing-type one-click fix does exactly that, as an offer the user reviews.
  The prompt must not present such a guess as the answer.

Counted findings per sample, now split by standing:

| Set | Counted | Required | Advice |
|---|---|---|---|
| Atlassian | 2,001 | 1,941 | 60 |
| Backpack | 155 | 152 | 3 |
| Carbon | 40 | 7 | 33 |
| Cloudscape | 5,141 | 5,141 | 0 |
| Designsystemet | 596 | 396 | 200 |
| GitLab | 396 | 147 | 249 |
| Open Props | 718 | 718 | 0 |
| Primer | 531 | 298 | 233 |
| SAP Horizon | 28,595 | 25,459 | 3,136 |
| Spectrum | 2,878 | 732 | 2,146 |

## Step 3. Make each item self-contained

For every rule, write the item fields: where, problem, evidence, done when,
and decline if. "Done when" must be the rule's own check, in words any tool
can run. Grouping stays: shared context is written once per group, and only
the places and their evidence repeat.

**Validations (free, in CI):**
- **Prompt lint:** every item on every sample has all the fields, and no item
  prescribes a value or token.
- **Criterion test:** for each rule, a fixture is fixed in two *different*
  valid ways. Both must clear the finding on a fresh run. If only one does,
  the rule or its "done when" assumes a solution, and that is a bug.
- **Size:** tokens per finding, measured per sample. Large sets split by group
  (fix prompts are for groups only).

### Done (2026-11-15)

**The prompt is a report.** Findings come by rule, under `# Required` then
`# Advice`. Each rule's section says once:
- **Basis:** its standing and source ("Required · DTCG Format 7.2 Reference
  Resolution"; "Advice · DTsanity convention: token tiers…").
- **Problem:** what is wrong and why it matters.
- **Done when:** the outcome, as a check any tool can run on the files.
- **Decline if:** for every advice rule, and for required rules whose scope
  the files can't show (contrast pairs DTsanity paired by name).

Then its findings, numbered `#1, #2…` across the prompt, each with its place
and evidence. The rule texts live in `src/policy/criteria.ts`. The general
rules (`PROMPT_RULES`) now say only how to work through it: the system
decides how, at the source if the files are generated; required means the
check passes and advice may be declined; keep what no finding is about; add no
finding; report every number, done or declined and why.

**What was taken out, as prescriptions:**
- one-click fixes ("Fix: … → …");
- "prefer re-pointing to an existing base token" for contrast;
- in messages, "Did you mean X?". It became "Closest existing name: X".
- the type guessed from a value. DTCG 5.2.2 forbids guessing.
- "point at one of the tokens in it";
- "switch the target gamut", a DTsanity setting.

The page keeps its own wording; only the prompt changes
(`evidence()` in `src/io/prompt.ts`).

**Contrast evidence:** the ratio and both colors in each failing theme (and
the blended color for a translucent foreground), plus the references each
token follows to its value. Themes that share references are named together.

**Validations:**
- **Prompt lint** (`tests/prompt-lint.test.ts`, and B4 in
  `tests/output-prompt.test.ts` on all ten samples): every rule has a problem
  and a check; every advice rule can be declined and asks why. Every
  section in every sample prompt is whole, findings are numbered in order, and
  no rule text or finding contains a word that steers the fix
  (`tests/prompt-words.ts`).
- **Criterion test** (`tests/criteria.test.ts`): 21 rules, each fixed two
  different valid ways (point at a token, or hold a value; a type on the
  token, or on its group; a file per mode, or the modes under
  `$extensions`; re-point the text, or change the base value…). Checked with
  a fresh prompt built from the fixed files alone. All 42 fixes clear their
  finding with no new required finding. One first draft didn't: darkening a
  background to fix an icon made another pair fail. The test caught it as it
  should, and that fix was replaced.
- **Size** (`SAMPLES_REPORT=1 npx vitest run tests/output-prompt.test.ts`):

| Set | Findings | Before (chars) | Now (chars) | Tokens per finding |
|---|---|---|---|---|
| Atlassian | 2,013 | 303,664 | 183,511 | 23 |
| Backpack | 314 | 18,595 | 21,430 | 17 |
| Carbon | 116 | 18,077 | 29,878 | 64 |
| Cloudscape | 7,022 | 500,889 | 502,274 | 18 |
| Designsystemet | 644 | 155,363 | 159,305 | 62 |
| GitLab | 459 | 84,441 | 137,582 | 75 |
| Open Props | 736 | 113,145 | 74,490 | 25 |
| Primer | 609 | 90,906 | 173,280 | 71 |
| SAP Horizon | 30,529 | 3,249,588 | 3,250,450 | 27 |
| Spectrum | 2,911 | 136,347 | 137,998 | 12 |

Sets with many contrast pairs grow, Primer and GitLab most. A pair's
evidence (about 500 characters) is mostly its reference chains in each theme,
which is what a system needs to choose the token to change. Border contrast,
which is advice, is the largest section in both. Sets that had many one-click
fixes shrink. The full prompts of SAP and Cloudscape remain too large to paste
whole; their group prompts are what is meant to be used.

**Seen while reading the prompts (for later):**
- Carbon's `text-on-color` and `icon-on-color` are paired with the page
  background, though "on color" says they sit on colored fills.
- Primer's `codeMirror.gutterMarker.fgColor.default` resolves to the
  background it is paired with, likely on purpose. "Decline if" covers it.

## Step 4. A stand-in brain for testing

Real systems bring their own rules. For tests we write one neutral file,
`docs/reference-system.md`: a generic design system's decision rules
(token tiers, how a contrast fix is chosen, where non-DTCG data lives, naming,
when to ask). It is written once, for no sample in particular, and the prompt
never refers to it.

Each test round runs twice:
- **Prompt + files only.** This tests principle 2: can an LLM with no context
  work it out?
- **Prompt + files + reference-system.md.** This tests that a system with its
  own brain gets what it needs, and that its own rules are respected.

### Done (2026-11-15)

- **`docs/reference-system.md`** is the stand-in brain, the rules of no real
  system. It covers:
  - where tokens come from (the files are the source; non-DTCG data goes
    under `$extensions` in `org.example.ds`; one file per mode, chosen by a
    resolver);
  - tiers, and when a hard-coded value is fine;
  - names (renamed only when a standard requires it, with every reference
    updated);
  - types (on the group when all share it; read from the name and use, not
    the value; ask when unclear);
  - an order for contrast fixes (another step of the same scale, then a
    lightness-only change, never a brand color), with decorative borders,
    disabled states and status colors shown with icons declined;
  - scales and typography, when to ask, and the report.

  It gives answers where the prompt leaves choices, so a round with it tests
  that the prompt's "done when" and "decline if" leave room for a system's
  own rules.
- **`tests/reference-system.test.ts`** keeps it neutral. It checks that the
  file:
  - names no sample set and no tool, and uses no sample token name of more
    than two parts;
  - is never referred to by the prompt or its rule texts;
  - asks for the same numbered report as the prompt.
- **`npm run round -- <set or folder> <out> [--brain] [--rules a,b]`**
  writes one round:
  - `files/` (a copy of the set) and `prompt.md`;
  - `BRIEF.md`, which says only what a person handing it over would;
  - `reference-system.md` when run with `--brain`;
  - `round.json` (counts by rule, size).

  `--rules` keeps only those rules' findings, as a group's prompt does.
  Contrast is filtered by pair, so a pair's color-blindness findings come
  with it. Run without an out folder, it is the fresh check: the findings of
  a folder by rule, from the files alone. Copying a sample and checking it
  afresh gives the sample's own counts.

## Step 5. Real rounds, few and recorded

Run on three sets of different shapes (one contrast-heavy, one format-heavy,
one multi-theme), each with two models, in both modes from step 4. Each round
starts in a fresh session and is checked in a fresh DTsanity tab.

**Pass (first version, used in rounds 1–3):**
- at least 90% of listed items are fixed;
- nothing new appears;
- every item left is declined in the report with a reason a person would
  accept.

**Pass (revised after round 3, kept 2026-11-16).** The 90% bar counted as failures the
declines the prompt invites (advice a system does otherwise) and DTsanity's
own misreadings. It measured the checker as much as the prompt. A round
passes when a fresh check of its files and a reading of its report show:

1. **Answered.** Every finding has an answer by its number: done, declined,
   or asked.
2. **True.** Every "done" holds in the fresh check. A claim the check
   contradicts ("both groups fixed", "no pair that passed now fails") fails
   the round, whatever else it did.
3. **Required findings settled.** Each is done, or declined or asked for a
   reason at the standard's level: the standard has no form for the value
   (an em length in DTCG), or the report names it a misreading. A named
   misreading is a DTsanity issue to check before the next round.
4. **Nothing new unreported.** No new required finding. A new advice finding
   passes only when the report names it.
5. **Advice declined for a reason.** No share of advice must be done. A
   decline names something a person can check: a rule of the system, how the
   token is used, or what the change would cost.

The step passes when every round passes on the larger model (Sonnet). Rounds
on the smaller model (Haiku) are recorded and show where the prompt needs
more for a smaller reader, but don't block the step.

**Record per round:** the prompt, the model, the report, the fresh count and
the build.

Our own before-and-after comparisons stay a local development tool
(`npm run compare` on the gitignored `corrected/` folder). The product never
needs them.

### Round 1 (2026-11-16): not passed

Build b523931. Twelve rounds: Carbon (contrast-heavy, whole prompt),
Backpack (format-heavy, whole prompt), Designsystemet (multi-theme, the
`contrast-border` and `cvd-siblings` group), each with Sonnet and Haiku, with
and without `reference-system.md`. Each round was a fresh assistant that saw
only its round folder, given the four-line prompt "read BRIEF.md and do what
it asks; work only inside this folder". Each was checked afresh with
`npm run round -- <folder>/files`. The folders, reports and fresh counts are in
`corrected/rounds/` (gitignored, local only).

Counted findings before → after the round; "required" covers the standard rules.

| Round | Counted | Required | New findings | Items left unanswered |
|---|---|---|---|---|
| Carbon, Sonnet | 40 → 40 | 7 → 7 | none | none: all declined, #1 wrongly |
| Carbon, Sonnet, rules | 40 → 39 | 7 → 6 | none | none |
| Carbon, Haiku | 40 → 38 | 7 → 6 | none | 12, asked |
| Carbon, Haiku, rules | 40 → 28 | 7 → 6 | none counted; one it reported itself | 3, asked |
| Backpack, Sonnet | 155 → 89 | 152 → 85 | 37, all from a checker bug | some, asked |
| Backpack, Sonnet, rules | 155 → 94 | 152 → 91 | 40, all from a checker bug | some, asked |
| Backpack, Haiku | 155 → 35 | 152 → 32 | none | contrast #15–#20, asked |
| Backpack, Haiku, rules | 155 → 49 | 152 → 44 | cvd-pair +2 (advice) | some, asked |
| Designsystemet, Sonnet | 29 → 29 | 0 | none | 11, asked |
| Designsystemet, Sonnet, rules | 29 → 29 | 0 | none | none: all declined by rule |
| Designsystemet, Haiku | 29 → 29 | 0 | none | none |
| Designsystemet, Haiku, rules | 29 → 29 | 0 | none | 11, asked |

No round reached 90% fixed. Most of what was left is not the assistants'
failing: they declined it, correctly, as DTsanity misreading the files. That
has to be fixed first.

**DTsanity misreadings the rounds found** (the fresh count can't be trusted
until these are fixed):
- `src/legacy/convert.ts` `isLegacyToken`: a legacy `value` that holds a DTCG
  composite with dimension objects (`offsetX: {value, unit}`) is read as a
  group of legacy tokens. All 37 and 40 "new" Backpack findings
  (`invalid-node` and shadow `invalid-value`) come from this.
- Backpack tiers: the 157 `aliases.*` entries (the raw palette and scales) are
  called semantic tokens, and so are steps added to them.
  `props.COLOR_SYSTEM_GREEN`/`RED` are flagged though their `originalValue`
  references `{!MONTEVERDE}`/`{!PANJIN}` like every other prop. All four
  Backpack rounds declined these.
- Carbon: the `…Hover` entries inside each scale are read as scale steps (48
  `scale-inversion` and 12 `scale-uneven-lightness` findings). Three rounds
  declined them. Carbon, Haiku, rules instead rewrote all 48 hover steps
  in the palette. That changed dozens of hover tokens, made link hovers
  equal their resting colors, and dropped `icon-inverse` on dark hover
  fills to 1.89:1, which DTsanity doesn't pair. A misreading that looks like
  a finding is the most harmful kind.
- Carbon: `text-on-color`, `icon-on-color` and `link-inverse-*` are paired
  with the page background (noted in step 3). All four rounds declined them.

**Prompt.** "Keep … the value every token resolves to in every theme" is read
as forbidding any visible change:
- Carbon, Sonnet (no rules) declined the required placeholder contrast fix
  for that reason.
- Backpack, Haiku (no rules) left all six required contrast findings as
  questions.

The rule must say a value may change where a finding requires it.

**Stand-in rules.** In rule 5, "only when the pair's contrast passes" is
ambiguous for status siblings: one round read it as the status colors against
each other, which always fails. It should name the pair: each status color
against the surface it sits on.

**With rules vs without.**
- With the rules, Sonnet cited a rule for every decline, and both models
  fixed contrast in the order the rules give (re-point, then add a step).
- Without them, assistants declined or asked more, but they never invented a
  system rule.

**Advice-level side effects.** Contrast fixes that pass with typical vision
can fail under simulated color-vision deficiency, which the assistant can't
see without the checker (Backpack, +1 and +2 `cvd-pair`). Sonnet noticed and
asked. Haiku didn't.

**Harness note.** Some round assistants were refused writing `report.md` and
returned the report as text; it was saved to the folder by hand.

## Order and stop points

1. Step 0, then step 1. **Stop and review**: how many findings were
   misreadings, per sample.
2. Steps 2–3 with the CI validations. **Stop and review** an item list from
   two samples before any paid round.
3. Step 4, then step 5. Paid rounds come only after the free checks pass.

## Out of scope

- One-click fixes stay in DTsanity for people editing the files by hand. The
  prompt doesn't depend on them.
- DTsanity doesn't apply an assistant's answer, store results or compare runs.

### Round 2 (2026-11-16): much closer, not passed

Build a136d21, after fixing the round 1 misreadings and the prompt sentence
(it now says a value may change where a finding needs it). Same twelve rounds,
same four-line launch prompt, each checked afresh.

Before → after the round, counted findings (required in brackets).

| Round | Carbon (37 [4]) | Backpack (155 [152]) | Designsystemet (29 advice) |
|---|---|---|---|
| Sonnet | 36 [2] | 57 [51] | 29: all declined with reasons |
| Sonnet, rules | 36 [2] | 48 [42] | 29: all declined by rule |
| Haiku | 23 [1] | 26 [22] | 29: all left as questions |
| Haiku, rules | 21 [2] | 24 [20] | 29: all declined by rule |

What changed from round 1:
- **Plain rounds now fix contrast.** Both Carbon rounds fixed the required
  placeholder contrast (round 1 Sonnet declined it), and Backpack Haiku fixed
  all six contrast findings (round 1 left them as questions).
- **The fixed misreadings stayed fixed.** No `invalid-node`, no hover-step
  findings, no `aliases` tier findings. Nobody rewrote the Carbon palette.
- **The clarified stand-in rule works.** Designsystemet with rules declined the
  11 status siblings by rule 5 in both models. Haiku checked each status color
  against its surface, as the rule now says. Backpack Haiku with rules declined
  the night status fills, which pass against their surface. It kept the day
  fills open, because they don't pass.

What is left:
- **Required leftovers are declined or asked, with reasons.** Backpack's em
  letter spacing, `100%` radius and media-query tokens have no DTCG form. Each
  round asked which tools read them, or which font size the em values are for.
- **Advice-level side effects of contrast fixes.** Every Backpack round ended
  with one new `cvd-pair`: the day destructive text re-pointed to `BERRY_75`
  passes 4.5:1 with typical vision but not under simulated deficiencies.
  Carbon, Haiku, rules raised tag and AI borders to 3:1, and nine of them now
  fail under simulated deficiencies. The assistant can't see that without the
  checker. Sonnet noticed and asked; Haiku didn't.
- **Two misreadings remain.** Every Carbon round declined them:
  - `content-switcher-selected` is a fill, but "content" is read as a text
    role.
  - `button-separator` is a separator, decorative by WCAG 1.4.11, yet it is
    counted as a required `contrast-ui` finding.
- **Pairs DTsanity doesn't check.** The assistants found pairs that matter and
  aren't checked:
  - status text on Designsystemet's `surface-active` (3.99:1);
  - Carbon's placeholder on the dark `layer-02/03` and `field-02/03` surfaces;
  - Carbon link hovers that now equal their resting colors.

  A fix can make an unchecked pair worse, and the fresh run won't show it.

**Against the pass rule.** No round fixed 90% of its counted findings. The
rule counts advice that a design system rightly declines, and findings with
no DTCG form, as failures. By "every finding done, or declined or asked with a
reason a person would accept", eleven rounds pass and Designsystemet, Haiku
doesn't. By "nothing new", the Backpack rounds and Carbon, Haiku, rules fail,
on advice only.

**Fixed after round 2** (no round run on it yet):
- A token whose own description calls it a background or fill is read as one,
  whatever its name says (`content-switcher-selected`).
- Separators and dividers are checked as borders (`contrast-border`, advice),
  not as required UI parts.
- The prompt says a change must keep pairs passing under the color-vision
  deficiencies the report simulates, where it simulates them.
- On the ten samples, only Carbon's counts changed: 37 → 36 counted, 4 → 1
  required.

### Round 3 (2026-11-16): every finding answered, side effects remain

Build 545d91f. Same twelve rounds, each checked afresh. Counted findings
before → after (required in brackets), and new findings the round caused.

| Round | Carbon (36 [1]) | Backpack (155 [152]) | Designsystemet (29 advice) |
|---|---|---|---|
| Sonnet | 27 [0], none new | 48 [47], +1 cvd-pair | no change, all declined |
| Sonnet, rules | 27 [0], none new | 87 [85], +84 required (see below) | no change, all declined by rule |
| Haiku | 18 [0], +1 cvd-pair | 22 [19], +2 cvd-pair | 18 fixed, +16 cvd-pair |
| Haiku, rules | 21 [0], +1 cvd-pair | 27 [23], +2 cvd-pair | 25 declined by rule, 4 asked |

- **Carbon has no required finding left in any round.** Both Sonnet rounds
  fixed or declined everything and caused nothing new.
- **Every round answered every finding**: done, declined with a reason, or
  asked. Required findings left open are values with no DTCG form (em,
  `100%`, media queries), each with a question.
- **The color-vision sentence helped Sonnet, not Haiku.**
  - Sonnet, rules on Backpack left the day hero text as a question, because
    no step passes without failing a simulation.
  - Haiku still caused 1–16 new `cvd-pair` findings per round. Once it even
    noted the deficiency and left it.
  - Every new finding in Haiku rounds is advice.
- **Backpack, Sonnet, rules converted the file to DTCG.** That is what the
  stand-in rules ask for, and it was done well (references from
  `originalValue`, legacy fields under `$extensions`). But the first fresh
  check showed 364 false `tier-base-reference` findings. The file name
  `base.raw.json` made every token base, including `props`, which now pointed
  at `aliases`.
  - **Fixed in DTsanity:** a group that points at another group of the same
    base-named file is semantic. On the samples, counts are unchanged.
  - **What is left is the round's own doing:** four tokens with no DTCG form
    were left in the older shape inside the converted file (`invalid-node` 48,
    `legacy-property` 36).

**Pairs DTsanity doesn't check, again.**
- Designsystemet's status text on `surface-active` (4.00:1).
- Backpack's `INPUT_BORDER` on white (1.70:1), which the stand-in rules say
  must reach 3:1.
- Backpack's `PRIVATE_SEGMENTED_CONTROL_SURFACE_CONTRAST_ON_NIGHT`, which
  Sonnet called a fill misread as text: "on" in its name makes it a
  foreground.

**Against the pass rule.**
- 90% fixed: no round.
- Every finding answered with a reason: all twelve.
- Nothing new: five rounds (Carbon Sonnet ×2, Designsystemet Sonnet ×2 and
  Designsystemet, Haiku, rules).

### Round 3 under the revised pass rule

Rounds 1 and 2 ran on builds with misreadings since fixed, so only round 3 is
scored. The numbers refer to the five conditions of the revised rule.

| Round | Carbon | Backpack | Designsystemet |
|---|---|---|---|
| Sonnet | pass | fails 4: white hero text now fails tritanopia, not named | pass |
| Sonnet, rules | pass | fails 4: 84 new required findings from tokens left in the older format | pass |
| Haiku | fails 2, 4: says every check passes; `ai-border-end` now fails color-vision checks | fails 2, 4: says both sibling groups are fixed, one is not; two new `cvd-pair` not named | fails 2, 4: says no passing pair now fails; 16 do |
| Haiku, rules | fails 2, 4: says every pair was checked under the simulations; `ai-border-start` fails | fails 4: names the destructive text, not the hero text | pass |

Sonnet: 4 of 6 pass. Haiku: 1 of 6. The step has not passed. The two Sonnet
failures are both on Backpack:
- one color-vision side effect left unnamed;
- a DTCG conversion left half done.

Every Haiku failure is a claim the fresh check contradicts. A smaller model
checking its own work against a re-implemented checker is the weak point,
not the prompt's wording.
