import { describe, expect, it } from 'vitest';
import { readDropped } from '../src/io/load';

const file = (name: string) => new File(['{"a":{"$type":"number","$value":1}}'], name, { type: 'application/json' });
const item = (f: File | null) => ({ kind: 'file', getAsFile: () => f });

describe('dropped files', () => {
  it('reads every dropped file', async () => {
    const files = [file('a.json'), file('b.json')];
    const out = await readDropped({ items: files.map(item), files } as unknown as DataTransfer);
    expect(out.map((r) => r.name)).toEqual(['a.json', 'b.json']);
  });

  it('reports dropped items the browser gave no file for', async () => {
    const files = [file('a.json')];
    const out = await readDropped({ items: [item(files[0]!), item(null), item(null)], files } as unknown as DataTransfer);
    expect(out.map((r) => r.name)).toEqual(['a.json', '2 dropped items']);
    expect('message' in out[1]!).toBe(true);
  });

  it('sets aside a file that isn’t a token file, without reading it as broken JSON', async () => {
    const css = new File([':root { --x: red; }'], 'Alert.module.css', { type: 'text/css' });
    const files = [file('a.json'), css, file('package.json')];
    const out = await readDropped({ items: files.map(item), files } as unknown as DataTransfer);
    expect(out[0]).toMatchObject({ name: 'a.json', text: expect.any(String) });
    expect(out[1]).toMatchObject({ name: 'Alert.module.css', skipped: true });
    expect(out[2]).toMatchObject({ name: 'package.json', skipped: true });
  });
});
