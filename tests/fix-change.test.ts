import { beforeEach, describe, expect, it } from 'vitest';
import { addFiles, applyEdits, applyFixes, clearAll, store } from '../src/state/app';
import { changeText, findingChange, findings } from '../src/ui/findings';
import { loadText } from './helpers';

/**
 * What the message after a fix says comes from a fresh check of the files, not
 * from the old count less the fixes: findings a fix resolves on the way count as
 * gone, and findings it causes count as new.
 */

beforeEach(() => clearAll());

const text = JSON.stringify({
  color: {
    $type: 'color',
    red: { $value: { colorSpace: 'srgb', components: [0.8, 0, 0] } },
    blue: { value: { colorSpace: 'srgb', components: [0, 0, 0.8] } },
  },
});

describe('the change a fresh check finds', () => {
  it('counts what a fix resolves, from the files checked again', () => {
    addFiles([loadText(text, 'colors.tokens.json')]);
    const before = findings(store.get());
    const fixes = before.fixable;
    expect(fixes.length, 'the set has a fix to apply').toBeGreaterThan(0);
    applyFixes(fixes);
    const after = findings(store.get());
    const change = findingChange(before, after);
    expect(change.gone).toBeGreaterThan(0);
    expect(change.gone - change.added, 'the net change is the count the cards show').toBe(
      before.format.length + before.tiers.length - after.format.length - after.tiers.length,
    );
  });

  it('counts a finding an edit causes as new', () => {
    addFiles([loadText(text, 'colors.tokens.json')]);
    const before = findings(store.get());
    const file = store.get().files[0]!;
    applyEdits('Break a reference', [{ fileId: file.id, path: ['color', 'red', '$value'], value: '{color.missing}' }]);
    const change = findingChange(before, findings(store.get()));
    expect(change.added).toBeGreaterThan(0);
  });

  it('says it in plain words', () => {
    expect(changeText({ gone: 14, added: 1 })).toBe('Checked again: 14 findings gone, 1 new');
    expect(changeText({ gone: 1, added: 0 })).toBe('Checked again: 1 finding gone');
    expect(changeText({ gone: 0, added: 2 })).toBe('Checked again: 2 new findings');
    expect(changeText({ gone: 0, added: 0 })).toBe('Checked again: no finding changed');
  });
});
