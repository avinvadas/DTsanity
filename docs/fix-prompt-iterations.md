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

## Step 5. Real rounds, few and recorded

Run on three sets of different shapes (one contrast-heavy, one format-heavy,
one multi-theme), each with two models, in both modes from step 4. Each round
starts in a fresh session and is checked in a fresh DTsanity tab.

**Pass:**
- at least 90% of listed items are fixed;
- nothing new appears;
- every item left is declined in the report with a reason a person would
  accept.

**Record per round:** the prompt, the model, the report, the fresh count and
the build.

Our own before-and-after comparisons stay a local development tool
(`npm run compare` on the gitignored `corrected/` folder). The product never
needs them.

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
