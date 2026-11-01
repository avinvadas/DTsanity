import { describe, expect, it, vi } from 'vitest';
import { createStore } from '../src/state/store';

describe('store', () => {
  it('keeps notifying the other listeners when one throws', () => {
    const store = createStore({ n: 0 });
    const seen: number[] = [];
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    store.subscribe(() => {
      throw new Error('broken view');
    });
    store.select((s) => s.n, (n) => seen.push(n));
    store.set({ n: 1 });
    expect(seen).toEqual([0, 1]);
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });
});
