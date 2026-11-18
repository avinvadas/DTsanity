import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { fixPrompt } from '../src/io/prompt';
import { addFiles, clearAll, store, updateSettings } from '../src/state/app';
import { parse, SAMPLES, SETTINGS, setTexts } from './oracle/samples';

/**
 * The offline check (src/cli/check.ts, bundled by scripts/build-cli.mjs) prints the report a
 * fresh DTsanity tab gives, so an assistant, a script or a team can check its own changes
 * without the page and without sending anything anywhere.
 */

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'dtsanity-cli-'));
const cli = join(dir, 'check.mjs');
const run = (...args: string[]) => spawnSync('node', [cli, ...args], { encoding: 'utf8' });
const stamp = (text: string) => text.replace(/^Checked with: DTsanity build [^,]+,/m, 'Checked with: DTsanity build X,').trimEnd();

beforeAll(() => {
  execFileSync('node', [join(ROOT, 'scripts/build-cli.mjs'), cli], { cwd: ROOT, stdio: 'ignore' });
}, 60_000);

describe('offline check', () => {
  it('prints the same report as the page for the same files', () => {
    clearAll();
    updateSettings(SETTINGS);
    addFiles(parse(setTexts('backpack')));
    const page = fixPrompt(store.get()).text;
    const r = run(join(SAMPLES, 'backpack'));
    expect(stamp(r.stdout)).toBe(stamp(page));
    // Findings left: a failing exit, for scripts and CI.
    expect(r.status).toBe(1);
  });

  it('says its build and that it ran offline', () => {
    expect(run(join(SAMPLES, 'backpack')).stdout).toMatch(/^Checked with: DTsanity build \S+ \(offline check\)/m);
  });

  it('counts by rule with --summary', () => {
    expect(run(join(SAMPLES, 'backpack'), '--summary').stdout).toMatch(/^153 counted \+ \d+ others\nlegacy-conversion \d+/);
  });

  it('reports a file that is not JSON as a finding, and passes a clean folder', () => {
    const bad = mkdtempSync(join(tmpdir(), 'dtsanity-bad-'));
    writeFileSync(join(bad, 'x.json'), '{"a": {');
    expect(run(bad, '--summary').stdout).toContain('unreadable-file 1');
    const ok = mkdtempSync(join(tmpdir(), 'dtsanity-ok-'));
    writeFileSync(join(ok, 'tokens.json'), JSON.stringify({ space: { $type: 'dimension', sm: { $value: { value: 4, unit: 'px' } } } }));
    const r = run(ok, '--summary');
    expect(r.stdout).toMatch(/^0 counted/);
    expect(r.status).toBe(0);
  });

  it('keeps only the named rules with --rules, as a group prompt does', () => {
    const out = run(join(SAMPLES, 'backpack'), '--summary', '--rules', 'contrast-text').stdout;
    // A pair comes with its color-vision finding, as in the round builder.
    expect(out).toMatch(/^5 counted \+ 0 others\ncontrast-text 4\ncvd-pair 1$/m);
    expect(out).not.toContain('missing-type');
  });
});

describe('the maturity record', () => {
  it('lists each finding as data with --json, numbered as the report numbers them', () => {
    const out = JSON.parse(run(join(SAMPLES, 'backpack'), '--json').stdout);
    expect(out.findings.length).toBeGreaterThan(0);
    expect(out.findings[0]).toMatchObject({ no: 1, rule: expect.any(String), line: expect.any(String), n: expect.any(Number), counted: expect.any(Boolean) });
    expect(out.count).toBe(out.findings.filter((f: { counted: boolean }) => f.counted).reduce((n: number, f: { n: number }) => n + f.n, 0));
  });

  it('names a finding by its rule and subject, not its line, values or wording', async () => {
    // @ts-expect-error: a plain .mjs script
    const { keyOf } = await import('../scripts/corpus-key.mjs');
    const a = keyOf('contrast-border', '`border-subtle-01` on `background` (UI part): below AA large text & UI (3) in white (has 1.71, #c6c6c6 on #ffffff). References: white: `border-subtle-01` → `gray.30`.');
    const b = keyOf('contrast-border', '`border-subtle-01` on `background` (UI part): under the UI level in white (has 2.10, #aaaaaa on #ffffff). References: white: `border-subtle-01` → `gray.40`.');
    expect(a).toBe('contrast-border · `border-subtle-01` on `background` (UI part)');
    expect(b).toBe(a);
    const c = keyOf('tier-hardcoded', 'themes/white/button.tokens.json:59 › `button-danger-hover` (white only): Component token with a raw value.');
    expect(c).toBe(keyOf('tier-hardcoded', 'themes/white/button.tokens.json:61 › `button-danger-hover` (white only): A component token with a raw value; point it at a base token.'));
  });
});
