import { describe, expect, it } from 'vitest';
import { BASIS } from '../src/policy/basis';
import { CRITERIA, UNREADABLE } from '../src/policy/criteria';
import { PROMPT_RULES } from '../src/policy/principles';
import { RULES } from '../src/policy/rules';
import { evidence } from '../src/io/prompt';
import { PRESCRIBES } from './prompt-words';

/**
 * The prompt reports; the design system decides (docs/fix-prompt-iterations.md, step 3).
 * Every rule says what is wrong, what must be true afterwards, and, for advice, when it may be
 * declined; none of it names a change to make, a token to point at, or a DTsanity screen.
 */


describe('what the prompt says about each rule', () => {
  const ids = [UNREADABLE, ...RULES.map((r) => r.id)];

  it('gives every rule a problem and a check, and no rule that doesn’t exist', () => {
    expect(ids.filter((id) => !CRITERIA[id]?.problem || !CRITERIA[id]?.done), 'rules without problem or check').toEqual([]);
    expect(Object.keys(CRITERIA).filter((id) => !ids.includes(id)), 'criteria without a rule').toEqual([]);
  });

  it('lets every piece of advice be declined, and says how', () => {
    const advice = RULES.filter((r) => BASIS[r.id]?.standing === 'advice').map((r) => r.id);
    expect(advice.filter((id) => !CRITERIA[id]!.decline), 'advice without "decline if"').toEqual([]);
    for (const id of ids) {
      const d = CRITERIA[id]!.decline;
      if (d) expect(d, `${id}: a decline asks for the reason`).toMatch(/Say (why|so|which|how|what)/);
    }
  });

  it('states outcomes, not changes', () => {
    for (const id of ids) {
      const c = CRITERIA[id]!;
      for (const [field, text] of Object.entries(c)) expect(text, `${id}.${field}`).not.toMatch(PRESCRIBES);
    }
    for (const r of PROMPT_RULES) expect(r.text).not.toMatch(PRESCRIBES);
  });

  it('keeps what a message shows and drops what it steers', () => {
    expect(evidence("{color.bsae} doesn't exist. Did you mean {color.base}?")).toBe("{color.bsae} doesn't exist. Closest existing name: {color.base}.");
    expect(evidence('{color} is a group. Did you mean its root token {color.$root}?')).toBe('{color} is a group. Closest existing root token: {color.$root}.');
    expect(evidence('Set “$type” here or on a parent group. The value looks like a dimension.')).toBe('Set “$type” here or on a parent group.');
    expect(evidence('{color} is a group. Point at one of the tokens in it; which one is a design choice.')).toBe('{color} is a group.');
    expect(evidence("100 is outside sRGB, so it is shown mapped into sRGB. Switch the target gamut to Display P3 if that's intended.")).toBe('100 is outside sRGB, so it is shown mapped into sRGB.');
  });
});
