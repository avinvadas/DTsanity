import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fixPrompt } from '../src/io/prompt';
import { CRITERIA } from '../src/policy/criteria';
import { PROMPT_RULES } from '../src/policy/principles';
import { addFiles, allModels, clearAll, store, updateSettings } from '../src/state/app';
import { parse, SETS, SETTINGS, setTexts } from './oracle/samples';

/**
 * docs/reference-system.md stands in for a design system's own rules in test rounds (step 4).
 * It is written for no sample, and the prompt never refers to it: a prompt that needed it
 * would fail principle 2 (an assistant with only the prompt and the files works it out).
 */

const TEXT = readFileSync(fileURLToPath(new URL('../docs/reference-system.md', import.meta.url)), 'utf8');

describe('the stand-in design system', () => {
  it('names no sample set and no tool', () => {
    for (const set of SETS) expect(TEXT.toLowerCase(), set).not.toContain(set.split('-')[0]!);
    expect(TEXT).not.toMatch(/DTsanity/i);
  });

  it(
    'uses no token name of any sample longer than two parts',
    () => {
      const named = [...TEXT.matchAll(/`([^`\s]+)`/g)].map((m) => m[1]!.replace(/^…|…$/g, '').replace(/^\.|\.$/g, ''));
      const hits: string[] = [];
      for (const set of SETS) {
        clearAll();
        updateSettings(SETTINGS);
        addFiles(parse(setTexts(set)));
        const ids = new Set(allModels(store.get()).flatMap((m) => [...m.tokens.keys()]));
        for (const n of named) if (n.split('.').length > 2 && ids.has(n)) hits.push(`${set}: ${n}`);
      }
      expect(hits).toEqual([]);
    },
    300_000,
  );

  it('is never referred to by the prompt', () => {
    const texts = [...PROMPT_RULES.map((r) => r.text), ...Object.values(CRITERIA).flatMap((c) => Object.values(c))];
    for (const t of texts) expect(t).not.toMatch(/reference[- ]system|our rules/i);
    clearAll();
    addFiles(parse([{ name: 't.tokens.json', text: '{"color":{"$type":"color","x":{"$value":"{color.y}"}}}' }]));
    expect(fixPrompt(store.get()).text).not.toMatch(/reference[- ]system/i);
  });

  it('answers each finding by number, as the prompt asks', () => {
    expect(TEXT).toMatch(/Answer every finding by its number/);
    expect(TEXT).toMatch(/declined/);
  });
});
