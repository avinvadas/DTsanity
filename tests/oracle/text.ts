import { parseJson, toJS, type JNode, type JPath } from '../../src/json/cst';

/**
 * Text-level helpers for checking output files as files: which lines changed,
 * where a key's lines are, which values changed, and what a zip holds. Written
 * apart from the app's own code paths, so the checks don't agree with the app
 * only because they share its code.
 */

// ---------------------------------------------------------------------------
// Line diff

export interface LineDiff {
  /** 0-based lines of `before` that are not in `after`. */
  removed: number[];
  /** 0-based lines of `after` that are not in `before`. */
  added: number[];
}

/** Lines removed and added between two texts (Myers' shortest edit script, after trimming the common ends). */
export function lineDiff(before: string, after: string): LineDiff {
  const a = before.split('\n');
  const b = after.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const x = a.slice(start, endA);
  const y = b.slice(start, endB);
  const { removed, added } = myers(x, y);
  return { removed: removed.map((i) => i + start), added: added.map((i) => i + start) };
}

function myers(a: string[], b: string[]): LineDiff {
  const n = a.length;
  const m = b.length;
  if (!n || !m) return { removed: [...Array(n).keys()], added: [...Array(m).keys()] };
  const max = n + m;
  const off = max;
  let v: Int32Array = new Int32Array(2 * max + 2);
  const trace: Int32Array[] = [];
  outer: for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1]! < v[off + k + 1]!) ? v[off + k + 1]! : v[off + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[off + k] = x;
      if (x >= n && y >= m) break outer;
    }
    // Large rewrites: give up on the shortest script, call every line in between changed.
    if (d > 4000) return { removed: [...Array(n).keys()], added: [...Array(m).keys()] };
  }
  const removed: number[] = [];
  const added: number[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d > 0; d--) {
    v = trace[d]!;
    const k = x - y;
    const prevK = k === -d || (k !== d && v[off + k - 1]! < v[off + k + 1]!) ? k + 1 : k - 1;
    const prevX = v[off + prevK]!;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
    }
    if (x === prevX) added.push(--y);
    else removed.push(--x);
  }
  return { removed: removed.reverse(), added: added.reverse() };
}

// ---------------------------------------------------------------------------
// Where a key is

const stripBom = (t: string) => (t.charCodeAt(0) === 0xfeff ? t.slice(1) : t);

/** The offset just after the value that starts at `at`: brackets matched, strings and comments skipped. */
function valueEnd(text: string, at: number): number {
  let depth = 0;
  for (let i = at; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"' || c === "'") {
      for (i++; i < text.length && text[i] !== c; i++) if (text[i] === '\\') i++;
      if (depth === 0) return i + 1;
      continue;
    }
    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2) + 1;
      continue;
    }
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      depth--;
      if (depth <= 0) return i + 1;
    } else if (depth === 0 && (c === ',' || c === '\n' || c === '\r')) return i;
  }
  return text.length;
}

const lineOf = (text: string, offset: number) => {
  let n = 0;
  for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
};

/**
 * The 0-based first and last line of the entry at `path` (its key to the end
 * of its value), or of the nearest enclosing entry when the path goes into an
 * array; undefined when it isn't in the text.
 */
export function entryLines(text: string, path: JPath, json5: boolean): [number, number] | undefined {
  const body = stripBom(text);
  const { doc } = parseJson(body, { json5 });
  let cur: JNode | undefined = doc.root;
  let found: { key: number; value: number } | undefined;
  for (const seg of path) {
    if (!cur || typeof seg === 'number' || cur.kind !== 'object') break;
    let e: (typeof cur.entries)[number] | undefined;
    for (let i: number = cur.entries.length - 1; i >= 0; i--) if (cur.entries[i]!.key === seg) e = cur.entries[i];
    if (!e?.pos || !e.value.pos) return found && [lineOf(body, found.key), lineOf(body, valueEnd(body, found.value))];
    found = { key: e.pos.offset, value: e.value.pos.offset };
    cur = e.value;
  }
  return found && [lineOf(body, found.key), lineOf(body, valueEnd(body, found.value))];
}

// ---------------------------------------------------------------------------
// What values changed

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export interface ValueChange {
  path: string[];
  kind: 'changed' | 'added' | 'removed';
}

/** The deepest keys whose values differ between two documents (arrays compared whole). */
export function valueChanges(before: unknown, after: unknown, path: string[] = []): ValueChange[] {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (isObject(before) && isObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
    return keys.flatMap((k) =>
      !(k in before) ? [{ path: [...path, k], kind: 'added' as const }] : !(k in after) ? [{ path: [...path, k], kind: 'removed' as const }] : valueChanges(before[k], after[k], [...path, k]),
    );
  }
  return [{ path, kind: 'changed' }];
}

/** A document's value, read as JSON5 where `json5` (as the app reads .json5 and .jsonc files). */
export const readDoc = (text: string, json5: boolean): unknown => toJS(parseJson(stripBom(text), { json5 }).doc.root);

/**
 * Lines changed outside the entries whose values changed: what a minimal edit
 * should never touch. Each changed entry may also move the line before and
 * after it (a comma added or removed beside it).
 */
export function strayLines(before: string, after: string, json5: boolean): { removed: string[]; added: string[]; changes: ValueChange[]; lines: { before: number; after: number } } {
  const changes = valueChanges(readDoc(before, json5), readDoc(after, json5));
  // Cut the lines of every entry that changed, in each text; what is left must match line for line.
  // Cutting first keeps the diff from pairing a changed block's lines (`},`) with an unchanged one's.
  const lines = { before: 0, after: 0 };
  const rest = (text: string, kinds: ValueChange['kind'][], side: 'before' | 'after') => {
    const cut = new Set<number>();
    for (const c of changes) {
      if (!kinds.includes(c.kind)) continue;
      const span = entryLines(text, c.path, json5);
      if (span) for (let l = span[0]; l <= span[1]; l++) cut.add(l);
    }
    lines[side] = cut.size;
    // A comma comes or goes beside an entry that was added or removed: not a change of its own.
    return text
      .split('\n')
      .filter((_, i) => !cut.has(i))
      .map((l) => l.replace(/,?\s*$/, ''));
  };
  const a = rest(before, ['changed', 'removed'], 'before');
  const b = rest(after, ['changed', 'added'], 'after');
  const diff = lineDiff(a.join('\n'), b.join('\n'));
  return { removed: diff.removed.map((l) => a[l]!), added: diff.added.map((l) => b[l]!), changes, lines };
}

// ---------------------------------------------------------------------------
// Reading a zip

export interface ZipFile {
  path: string;
  text: string;
}

/** The entries of a zip with stored (uncompressed) files, read from its central directory as zip tools do. */
export function unzip(bytes: Uint8Array): ZipFile[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error('No end of central directory.');
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const dec = new TextDecoder('utf-8', { fatal: true });
  const files: ZipFile[] = [];
  for (let i = 0; i < count; i++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error(`Bad central directory entry ${i}.`);
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLen = view.getUint16(at + 28, true);
    const extraLen = view.getUint16(at + 30, true);
    const commentLen = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const path = dec.decode(bytes.subarray(at + 46, at + 46 + nameLen));
    if (method !== 0) throw new Error(`${path}: compressed entries aren't expected.`);
    if (view.getUint32(local, true) !== 0x04034b50) throw new Error(`${path}: bad local header.`);
    const data = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    files.push({ path, text: dec.decode(bytes.subarray(data, data + size)) });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}
