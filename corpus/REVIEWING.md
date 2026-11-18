# Reviewing findings

How a finding on a sample design system gets its verdict. People and the
review agent follow the same guide; each verdict says who gave it. The record
is what DTsanity's grades are built on (see [README.md](README.md)), so a
verdict must be one you could defend from the files.

## What to review

`corpus/queue/<set>.json` lists the findings of one design system that are
waiting for a verdict: each with its `key`, its `rule` and the report's `line`.
The set's files are in `samples/<set>/`, as published. What each rule means,
what it stands on and when it may be declined is in `src/policy/criteria.ts`
(problem, done when, decline if) and `src/policy/rules.ts` (its title and
about).

To see a finding in its full report, with its rule's basis and criteria:

```bash
node dist-cli/dtsanity-check.mjs samples/<set> --rules <rule>
```

## The verdicts

**right**: the finding is true of this system as published. Read the files
and confirm it.

- For a required finding (from DTCG, WCAG or JSON), true is enough: a file in
  Style Dictionary format really isn't DTCG, and a pair really is below the
  WCAG level. Whether the system should change is its own decision, not part
  of the verdict.
- For a contrast or color-vision finding, also confirm the two tokens are
  really used together (their names, descriptions or the system's structure
  say so) and that the role read is right: text is text, a border outlines a
  component.

**misreading**: DTsanity read the system wrong, so the finding isn't true of
it. Examples: two tokens paired that are never used together; a divider read
as a component's border; hover and pressed states read as steps of a scale; a
tier read from a name that means something else here; a value or reference
parsed wrong; a token that is fine and was flagged because of how the file was
read.

**depends**: true, but a convention this system can reasonably reject: advice
(not required by a standard) that its own structure contradicts on purpose.
Give it when the system clearly does otherwise by design; say what it does
instead. A person confirms these.

When you can't tell from the files, give no verdict: leave the finding in the
queue and say why in your notes.

## Writing verdicts

Add them to `corpus/verdicts/<set>.json` (create it if missing), keyed by the
finding's `key` copied exactly from the queue:

```json
{
  "set": "<set>",
  "verdicts": {
    "<key>": { "verdict": "right", "by": "agent", "why": "One sentence of evidence from the files.", "at": "YYYY-MM-DD" }
  },
  "misses": []
}
```

- `why` cites evidence: the token's value, its description, the file it is
  in, the token it points at. Not “looks right”.
- A real problem you notice that DTsanity didn't flag goes in `misses`:
  `{ "rule": "<the check that should have>", "what": "…", "by": "agent", "at": "…" }`.
  Only when you are sure; misses don't lower a grade, they inform it.
- Keep existing verdicts. Change one only with new evidence, and say so in
  its `why`.

## What not to do

- Don't edit `samples/`, `src/`, `tests/`, the queue or the report.
- Don't fix the checks. A misreading is reported, with the general idea
  DTsanity got wrong, so it can be fixed as a rule that holds across systems
  (see “When a rule or exception is added” in [README.md](README.md)).

## Notes for each review

End each review with a short note: how many findings got each verdict, the
ones left without one and why, and the misreadings grouped by the general idea
behind them (“states read as scale steps”, not one line per token), each with
the systems and keys it covers.
