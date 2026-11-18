# The maturity record

DTsanity is tested against the token files of real design systems
([samples/](../samples/README.md)). This folder keeps what those tests taught:
a reviewed verdict for findings on each system, and the grade each check has
earned from them. It only grows; a new system adds evidence, and nothing is
reset.

The goal is not to detect every issue. It is to report the right ones with
very high probability, from a small number of general rules that hold across
systems.

## What is here

- `verdicts/<set>.json`: the reviewed verdicts for one design system. Edited by
  people and by the review agent; each verdict says who gave it.
- `queue/<set>.json`: the findings of that system still waiting for a verdict
  (generated).
- `report.md` and `report.json`: the grades (generated).

Run `node scripts/corpus.mjs` to refresh the queue and the report, after
`npm run build:cli`. With `--check` it fails when a finding reviewed as right
is no longer found.

## Verdicts

Each finding the offline check lists gets one verdict:

- **right**: a real issue in that system.
- **misreading**: DTsanity read the system wrong (a divider taken for a
  component border, a state taken for a scale step).
- **depends**: a convention this system can reasonably reject. Left for a
  person to give.

A finding is named by its rule and what it is about (its tokens, file and
themes), not by line numbers, measured values or wording, so a verdict
survives edits elsewhere and rewording.

```json
{
  "set": "carbon",
  "verdicts": {
    "contrast-border · `border-subtle-00` on `background` (UI part)": {
      "verdict": "misreading",
      "by": "human",
      "why": "A decorative divider; WCAG 1.4.11 exempts it.",
      "at": "2026-11-18"
    }
  },
  "misses": [
    { "rule": "contrast-text", "what": "`link-primary` on `layer-01` isn't checked", "by": "agent", "at": "2026-11-18" }
  ]
}
```

Not every finding of a big system is reviewed: each check's sample is its
first 20 findings on that system, in key order, so it stays the same from run
to run.

## The score

For each check:

- **Precision**: right ÷ (right + misreading), per design system, then
  averaged, so each system counts once whatever its size.
- **Systems**: how many systems have a decided verdict for it.
- **Contested**: the share reviewed as depends. A high share means the check is
  a convention, not a rule.
- **Misses**: real problems it didn't flag. Recorded, but they don't lower the
  grade: a check that says less and is right is doing its job.

| Grade | Needs |
|---|---|
| Stable | 6+ systems, 95%+ precision, 100+ reviewed, 30%+ of them by a person, no open misses |
| Beta | 3+ systems, 80%+ precision, 30+ reviewed |
| Experimental | anything less |

What a grade changes:

- **Stable**: reports at its full level and counts toward “findings remain”.
- **Beta**: reports as it does now; its findings say it is still maturing.
- **Experimental**: listed, not counted; it never fails a run.
- **A regression** (a finding reviewed as right is gone) blocks the change
  until it is reviewed.
- **Contested over 30%**: the check moves to advice, or gets a clearer
  “decline if”.

## When a rule or exception is added

A misreading is first fixed by sharpening a rule, not by adding one. A new
rule or exception is added only when:

1. **the standard makes the distinction** (WCAG exempts disabled and decorative
   parts), or it is **a meaning seen in two or more independent systems**,
   stated as a meaning: names are its evidence, not the rule;
2. **sharpening an existing rule was tried** and couldn't do it without losing
   right findings;
3. **it raises precision on every system together** and loses no finding
   reviewed as right anywhere;
4. **it is written down**: the systems it comes from, the numbers before and
   after, and what it gives up.

A convention that only one system has is that system's to declare (declining
a finding with its reason, or a setting of its own), not a DTsanity rule. When
a check can't reach high precision, it is narrowed to the cases it is sure of,
or turned off by default, instead of patched.

The report also counts DTsanity's checks against the systems it covers: that
count should flatten as systems are added. If it keeps rising, DTsanity is
memorizing systems instead of understanding them.
