import { beforeEach, describe, expect, it } from 'vitest';
import { exportText } from '../src/io/export';
import type { Fix } from '../src/model/types';
import { addFiles, applyFixes, clearAll, store, undo, updateSettings } from '../src/state/app';
import { issuesOf, parse, SETTINGS } from './oracle/samples';
import { strayLines } from './oracle/text';

/**
 * The fixed files keep the way each file is written (part A3 of the output
 * test plan). Each file below is written in an unusual way and holds two
 * defects with a fix: a legacy "value" key and a misspelled "$valeu". After
 * every fix: both are gone, only their lines changed, the file's own
 * way of writing is kept, and undo gives back the exact text.
 */

const T = 30_000;

/** One small set, written with `nl` line breaks and `ind` indentation. */
const pretty = (nl: string, ind: string, extra = '') =>
  [
    '{',
    `${ind}"color": {`,
    `${ind}${ind}"$type": "color",`,
    `${ind}${ind}"red": { "value": { "colorSpace": "srgb", "components": [1, 0, 0] } },`,
    `${ind}${ind}"blue": {`,
    `${ind}${ind}${ind}"$valeu": { "colorSpace": "srgb", "components": [0, 0, 1] }${extra ? ',' : ''}`,
    ...(extra ? [`${ind}${ind}${ind}${extra}`] : []),
    `${ind}${ind}},`,
    `${ind}${ind}"green": { "$value": { "colorSpace": "srgb", "components": [0, 1, 0] } }`,
    `${ind}}`,
    '}',
    '',
  ].join(nl);

const CASES: { name: string; text: string; keeps: (out: string) => void }[] = [
  {
    name: 'tabs.tokens.json',
    text: pretty('\n', '\t'),
    keeps: (out) => expect(out.split('\n').filter((l) => /^ +\S/.test(l)), 'indented with tabs only').toEqual([]),
  },
  {
    name: 'crlf.tokens.json',
    text: pretty('\r\n', '  '),
    keeps: (out) => expect(/[^\r]\n/.test(out), 'every line break stays CRLF').toBe(false),
  },
  {
    name: 'bom.tokens.json',
    text: `﻿${pretty('\n', '  ')}`,
    keeps: (out) => expect(out.charCodeAt(0), 'the byte-order mark stays').toBe(0xfeff),
  },
  {
    name: 'no-final-newline.tokens.json',
    text: pretty('\n', '  ').trimEnd(),
    keeps: (out) => expect(out.endsWith('}'), 'no newline is added at the end').toBe(true),
  },
  {
    name: 'four-spaces.tokens.json',
    text: pretty('\n', '    '),
    keeps: (out) => expect(out.split('\n').filter((l) => /^( {1,3}| {5,7})"/.test(l)), 'indented by fours').toEqual([]),
  },
  {
    name: 'names.tokens.json',
    text: pretty('\n', '  ', '"$description": "Ünïcödé — 日本語 · 🎨 \\u00e9 \\"quoted\\""'),
    keeps: (out) => {
      expect(out).toContain('Ünïcödé — 日本語 · 🎨');
      expect(out, 'escapes stay as written').toContain('\\u00e9 \\"quoted\\"');
    },
  },
  {
    name: 'long-line.tokens.json',
    text: pretty('\n', '  ', `"$description": "${'long '.repeat(2000)}"`),
    keeps: (out) => expect(out).toContain(`"$description": "${'long '.repeat(2000)}"`),
  },
  {
    name: 'minified.tokens.json',
    text: JSON.stringify(JSON.parse(pretty('\n', '  '))),
    keeps: (out) => expect(out.includes('\n'), 'stays on one line').toBe(false),
  },
  {
    name: 'duplicate.tokens.json',
    text: pretty('\n', '  ', '"$description": "first", "$description": "second"'),
    keeps: (out) => expect(out, 'both copies of a duplicate key stay').toContain('"$description": "first", "$description": "second"'),
  },
  {
    name: 'commented.json5',
    text: [
      '// Brand colors',
      '{',
      '  color: {',
      "    $type: 'color', /* every token here is a color */",
      "    red: { value: { colorSpace: 'srgb', components: [1, 0, 0,], }, },",
      '    blue: {',
      "      $valeu: { colorSpace: 'srgb', components: [0, 0, 1] }, // misspelled",
      '    },',
      "    green: { $value: { colorSpace: 'srgb', components: [0, 1, 0] } },",
      '  },',
      '}',
      '',
    ].join('\n'),
    keeps: (out) => {
      for (const c of ['// Brand colors', '/* every token here is a color */', '// misspelled']) expect(out).toContain(c);
      expect(out, 'keys stay bare, strings single-quoted').toMatch(/\$value: \{ colorSpace: 'srgb'/);
      expect(out, 'trailing commas stay').toContain('[1, 0, 0,], },');
    },
  },
];

beforeEach(() => {
  clearAll();
  updateSettings(SETTINGS);
});

const editFixes = (): Fix[] => issuesOf(store.get()).flatMap((i) => (i.fix && 'edits' in i.fix ? [i.fix] : []));

describe.each(CASES)('fixed file written as $name', ({ name, text, keeps }) => {
  it(
    'changes only the defects, the way the file is written',
    () => {
      addFiles(parse([{ name, text }]));
      const f0 = store.get().files[0]!;
      expect(exportText(f0) === text, 'exports as loaded before any fix').toBe(true);
      const codes = (s = store.get()) => issuesOf(s).filter((i) => i.fix).map((i) => i.code).sort();
      expect(codes(), 'both defects found, each with a fix').toEqual(expect.arrayContaining(['legacy-property', 'unknown-property']));

      for (let round = 0; round < 3 && editFixes().length; round++) applyFixes(editFixes());
      const out = exportText(store.get().files[0]!);
      expect(codes(), 'nothing left to fix').toEqual([]);
      const s = strayLines(text, out, name.endsWith('.json5'));
      expect([s.removed, s.added], 'only the defects’ lines changed').toEqual([[], []]);
      expect(s.changes.map((c) => c.path.join('.')).sort()).toEqual(['color.blue.$valeu', 'color.blue.$value', 'color.red.$value', 'color.red.value']);
      keeps(out);
      // Exactly the two keys renamed, nothing else.
      const json5 = name.endsWith('.json5');
      const want = json5 ? text.replace('{ value:', '{ $value:').replace('$valeu:', '$value:') : text.replace(/"value"(\s*):/, '"$$value"$1:').replace('"$valeu"', '"$value"');
      expect(out === want, 'the text is the loaded text with the two keys renamed').toBe(true);

      while (store.get().past.length) undo();
      expect(exportText(store.get().files[0]!) === text, 'undo gives back the exact text').toBe(true);
    },
    T,
  );
});
