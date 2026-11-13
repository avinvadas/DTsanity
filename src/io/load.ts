import { JsonParseError, parseJson, serialize } from '../json/cst';
import { detectLegacyKind, legacyToDtcg } from '../legacy/convert';
import { DEFAULT_SETTINGS } from '../model/defaults';
import { detectFormat } from '../model/format';
import type { Settings, SourceFile } from '../model/types';
import type { LoadError } from '../state/app';

/**
 * Turning user input into SourceFiles. Everything here runs in the browser:
 * files are read with the File API, and the only network request is the
 * user-initiated fetch of a URL they typed.
 */

export interface RawSource {
  name: string;
  text: string;
  origin: 'file' | 'url';
  url?: string;
  handle?: FileSystemFileHandle;
  blob?: File;
}

export const ACCEPT = '.json,.json5,.jsonc,.tokens,application/json,application/json5,application/design-tokens+json';

/** Files named as JSON5 or JSONC are read as such; others as JSON, then as JSON5 if they aren't strict JSON. */
export const isJson5Name = (name: string) => /\.(json5|jsonc)$/i.test(name);

function parseText(name: string, text: string): ReturnType<typeof parseJson> & { json5: boolean } {
  if (isJson5Name(name)) return { ...parseJson(text, { json5: true }), json5: true };
  try {
    return { ...parseJson(text), json5: false };
  } catch (strict) {
    // A .json file with comments or trailing commas: read it, and report it (most JSON tools won't), rather than refuse it.
    try {
      return { ...parseJson(text, { json5: true }), json5: true };
    } catch {
      throw strict;
    }
  }
}
const MAX_BYTES = 50 * 1024 * 1024;

let nextId = 0;

/**
 * Parse a source into a SourceFile. Legacy files are converted to DTCG when
 * the setting allows it; otherwise they load as-is and are reported.
 */
export function parseSource(raw: RawSource, settings: Settings = DEFAULT_SETTINGS): SourceFile | LoadError {
  try {
    const { doc: parsed, duplicates, json5 } = parseText(raw.name, raw.text);
    const format = detectFormat(parsed.root);
    let doc = parsed;
    const file: SourceFile = {
      id: `f${++nextId}`,
      name: raw.name,
      origin: raw.origin,
      text: raw.text,
      baseText: raw.text,
      doc,
      duplicates,
      format,
    };
    if (json5) file.syntax = 'json5';
    if (format === 'legacy') {
      file.legacyKind = detectLegacyKind(parsed.root);
      if (settings.acceptLegacy) {
        const converted = legacyToDtcg(parsed);
        doc = converted.doc;
        file.doc = doc;
        file.baseText = serialize(doc);
        file.converted = true;
        file.conversionNotes = converted.notes;
      }
    }
    if (raw.url) file.url = raw.url;
    if (raw.handle) file.handle = raw.handle;
    if (raw.blob) file.blob = raw.blob;
    return file;
  } catch (err) {
    if (err instanceof JsonParseError) {
      return {
        name: raw.name,
        message: err.message,
        line: err.pos.line,
        col: err.pos.col,
        excerpt: excerpt(raw.text, err.pos.line, err.pos.col),
      };
    }
    return { name: raw.name, message: err instanceof Error ? err.message : String(err) };
  }
}

export const isLoadError = (x: SourceFile | LoadError): x is LoadError => !('doc' in x);

/** Up to two lines of context before the error line, plus a caret under the column. */
function excerpt(text: string, line: number, col: number): string {
  const lines = text.split(/\r?\n/);
  const from = Math.max(0, line - 3);
  const width = String(line).length;
  const out = lines.slice(from, line).map((l, i) => `${String(from + i + 1).padStart(width)} | ${truncate(l)}`);
  out.push(`${' '.repeat(width)} | ${' '.repeat(Math.min(col - 1, 120))}^`);
  return out.join('\n');
}

const truncate = (s: string) => (s.length > 160 ? `${s.slice(0, 160)}…` : s);

/** The browser's own explanation of a failure, for messages. */
const reason = (err: unknown) =>
  err instanceof Error && (err.name !== 'Error' || err.message) ? ` The browser said: ${err.name}${err.message ? `: ${err.message}` : ''}` : '';

/** `path` names the file inside a folder that was dropped or chosen ("carbon/themes/white/theme.tokens.json"). */
async function readFile(file: File, handle?: FileSystemFileHandle, path = file.name): Promise<RawSource | LoadError> {
  if (file.size > MAX_BYTES) return { name: path, message: `The file is ${(file.size / 1024 / 1024).toFixed(0)} MB; the limit is 50 MB.` };
  try {
    const raw: RawSource = { name: path, text: await file.text(), origin: 'file', blob: file };
    if (handle) raw.handle = handle;
    return raw;
  } catch (err) {
    return { name: path, message: `The file could not be read.${reason(err)}` };
  }
}

/** Files chosen one by one, or a folder chosen with the standard input (which gives each file its path in it). */
export function readFiles(files: Iterable<File>): Promise<(RawSource | LoadError)[]> {
  const list = [...files];
  const inFolder = (f: File) => !!f.webkitRelativePath;
  if (list.some(inFolder)) {
    const top = list.find(inFolder)!.webkitRelativePath.split('/')[0]!;
    const kept = list.filter((f) => isTokenPath(f.webkitRelativePath || f.name));
    if (!kept.length) return Promise.resolve([noTokenFiles(top)]);
    return Promise.all(kept.map((f) => readFile(f, undefined, f.webkitRelativePath || f.name)));
  }
  return Promise.all(list.map((f) => readFile(f)));
}

// ---------------------------------------------------------------------------
// Folders

/** Files a folder may hold tokens in. */
const TOKEN_FILE = /\.(json|json5|jsonc|tokens)$/i;
/** JSON files that are never tokens: package manifests and tool configs. */
const NOT_TOKENS = /^(package(-lock)?\.json|tsconfig(\..*)?\.json|jsconfig\.json|composer\.json|\..*)$/i;
/** Folders never read: dependencies and hidden folders. */
const SKIP_DIR = /^(node_modules|\..*)$/;
/** Enough for any token set; a folder past this is probably not one. */
const MAX_FILES = 2000;

const isTokenPath = (path: string) => {
  const parts = path.split('/');
  return TOKEN_FILE.test(parts.at(-1)!) && !NOT_TOKENS.test(parts.at(-1)!) && !parts.slice(0, -1).some((d) => SKIP_DIR.test(d));
};

const noTokenFiles = (folder: string): LoadError => ({ name: folder, message: 'This folder has no token files (.json, .json5, .jsonc or .tokens).' });
const tooMany = (folder: string): LoadError => ({ name: folder, message: `This folder has more than ${MAX_FILES} token files; only the first ${MAX_FILES} were read. Choose the folder that holds the tokens.` });

/** Every token file in a folder handle, with its path from the folder (its name included), keeping handles for Reload. */
async function readDirHandle(dir: FileSystemDirectoryHandle): Promise<(RawSource | LoadError)[]> {
  const found: { handle: FileSystemFileHandle; path: string }[] = [];
  const walk = async (d: FileSystemDirectoryHandle, prefix: string) => {
    const entries: FileSystemHandle[] = [];
    for await (const e of d.values()) entries.push(e);
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (found.length > MAX_FILES) return;
      const path = `${prefix}/${e.name}`;
      if (e.kind === 'directory') {
        if (!SKIP_DIR.test(e.name)) await walk(e as FileSystemDirectoryHandle, path);
      } else if (isTokenPath(path)) found.push({ handle: e as FileSystemFileHandle, path });
    }
  };
  await walk(dir, dir.name);
  if (!found.length) return [noTokenFiles(dir.name)];
  const read = await Promise.all(found.slice(0, MAX_FILES).map(async ({ handle, path }) => readFile(await handle.getFile(), handle, path)));
  return found.length > MAX_FILES ? [...read, tooMany(dir.name)] : read;
}

/** The same for a dropped folder entry, where the browser gives no handles (Reload re-reads the File). */
async function readDirEntry(dir: FileSystemDirectoryEntry): Promise<(RawSource | LoadError)[]> {
  const found: { entry: FileSystemFileEntry; path: string }[] = [];
  const list = (d: FileSystemDirectoryEntry) =>
    new Promise<FileSystemEntry[]>((done, fail) => {
      const reader = d.createReader();
      const all: FileSystemEntry[] = [];
      // readEntries returns the entries in batches, then an empty one.
      const next = () => reader.readEntries((batch) => (batch.length ? (all.push(...batch), next()) : done(all)), fail);
      next();
    });
  const walk = async (d: FileSystemDirectoryEntry, prefix: string) => {
    const entries = (await list(d)).sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (found.length > MAX_FILES) return;
      const path = `${prefix}/${e.name}`;
      if (e.isDirectory) {
        if (!SKIP_DIR.test(e.name)) await walk(e as FileSystemDirectoryEntry, path);
      } else if (isTokenPath(path)) found.push({ entry: e as FileSystemFileEntry, path });
    }
  };
  try {
    await walk(dir, dir.name);
  } catch (err) {
    return [{ name: dir.name, message: `The folder could not be read.${reason(err)}` }];
  }
  if (!found.length) return [noTokenFiles(dir.name)];
  const read = await Promise.all(
    found.slice(0, MAX_FILES).map(
      ({ entry, path }) => new Promise<File>((done, fail) => entry.file(done, fail)).then((f) => readFile(f, undefined, path), (err) => ({ name: path, message: `The file could not be read.${reason(err)}` })),
    ),
  );
  return found.length > MAX_FILES ? [...read, tooMany(dir.name)] : read;
}

/** Choose a folder: with a handle where the browser offers one (for Reload), else with the standard folder input. */
export async function pickFolder(fallback: HTMLInputElement): Promise<(RawSource | LoadError)[] | null> {
  if (typeof window.showDirectoryPicker !== 'function' || pickerBroken) {
    fallback.click();
    return null;
  }
  try {
    return await readDirHandle(await window.showDirectoryPicker({ mode: 'read' }));
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return null;
    pickerBroken = true;
    fallback.click();
    return null;
  }
}

/**
 * Read through a file handle so Reload can see later changes on disk. Some
 * browsers (embedded Chromium builds in particular) expose the API but fail
 * to read through it; then use the plain File when there is one.
 */
async function readHandle(h: FileSystemHandle | null, fallback: File | null | undefined): Promise<RawSource | LoadError> {
  if (!h) return fallback ? readFile(fallback) : { name: 'Unknown item', message: 'This item is not a file.' };
  if (h.kind !== 'file') return { name: h.name, message: 'This item is not a file.' };
  const fh = h as FileSystemFileHandle;
  let result: RawSource | LoadError;
  try {
    result = await readFile(await fh.getFile(), fh);
  } catch (err) {
    result = { name: fh.name, message: `The file could not be read.${reason(err)}` };
  }
  if ('text' in result || !fallback) return result;
  return readFile(fallback);
}

export const canKeepHandles = () => typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function' && !pickerBroken;

/** Set once reading through the picker has failed; later clicks use the standard file input. */
let pickerBroken = false;

/**
 * Open the system file picker. Where the browser supports it, keep file
 * handles so Reload can read the current file from disk later.
 * Resolves to null when the user cancels or the standard input takes over.
 */
export async function pickFiles(fallback: HTMLInputElement): Promise<(RawSource | LoadError)[] | null> {
  if (!canKeepHandles()) {
    fallback.click();
    return null;
  }
  let handles: FileSystemFileHandle[];
  try {
    handles = await window.showOpenFilePicker!({
      multiple: true,
      types: [{ description: 'Design tokens', accept: { 'application/json': ['.json', '.json5', '.jsonc', '.tokens'] } }],
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return null;
    pickerBroken = true;
    fallback.click();
    return null;
  }
  const results = await Promise.all(handles.map((h) => readHandle(h, null)));
  if (results.some((r) => !('text' in r))) {
    // The picker returned files this browser can't read. Switch to the standard
    // input for next time; it can't be opened here because the click is used up.
    pickerBroken = true;
    return results.map((r) =>
      'text' in r ? r : { ...r, message: `${r.message} Click the drop zone again to choose it with the standard dialog, or drag it onto the page.` },
    );
  }
  return results;
}

/** How long to wait for dropped files' handles before reading the files without them. */
const HANDLE_MS = 1000;

/** Read dropped files, keeping handles where the browser offers them. Must be called during the drop event. */
export function readDropped(dt: DataTransfer): Promise<(RawSource | LoadError)[]> {
  const items = [...dt.items].filter((i) => i.kind === 'file');
  // Captured synchronously: the DataTransfer is emptied after the drop event.
  const entries = items.map((i) => (typeof i.webkitGetAsEntry === 'function' ? i.webkitGetAsEntry() : null));
  const files = items.map((i) => i.getAsFile());
  const flat = (xs: (RawSource | LoadError)[][]) => xs.flat();
  // Without handles: folders through their entries, files as they are.
  const byEntries = () =>
    Promise.all(
      items.map((_, i) => {
        const e = entries[i];
        if (e?.isDirectory) return readDirEntry(e as FileSystemDirectoryEntry);
        const f = files[i];
        return f ? readFile(f).then((r) => [r]) : Promise.resolve(unreadable(1));
      }),
    ).then(flat);
  if (items.length && items.every((i) => typeof i.getAsFileSystemHandle === 'function')) {
    const pending = items.map((i) => i.getAsFileSystemHandle!());
    // Some embedded browsers never settle the handles; read without them then.
    const stalled = new Promise<never>((_, fail) => setTimeout(() => fail(new Error('timeout')), HANDLE_MS));
    return Promise.race([Promise.all(pending), stalled]).then(
      (handles) =>
        Promise.race([
          Promise.all(handles.map((h, i) => (h?.kind === 'directory' ? readDirHandle(h as FileSystemDirectoryHandle) : readHandle(h, files[i]).then((r) => [r])))).then(flat),
          // A folder may take longer to read than files; only the handles themselves are timed.
          ...(handles.some((h) => h?.kind === 'directory') ? [] : [stalled]),
        ]).catch(byEntries),
      byEntries,
    );
  }
  if (entries.some((e) => e?.isDirectory)) return byEntries();
  // Counted now: the DataTransfer is emptied after the drop event.
  const missing = items.length - dt.files.length;
  return readFiles(dt.files).then((read) => [...read, ...unreadable(missing)]);
}

/** An error for dropped items the browser gave no file for, so a partial drop never passes unnoticed. */
function unreadable(n: number): LoadError[] {
  return n > 0 ? [{ name: n === 1 ? 'A dropped item' : `${n} dropped items`, message: "The browser didn't hand over these items as files, so they weren't read. Drop the files again, or click the drop zone to choose them." }] : [];
}

/** Read a loaded file's source again: refetch its URL or re-read it from disk. */
export async function reloadSource(f: SourceFile): Promise<RawSource | LoadError> {
  if (f.origin === 'url' && f.url) {
    return { ...(await fetchSource(f.url)), name: f.name };
  }
  if (f.handle) {
    try {
      return await readFile(await f.handle.getFile(), f.handle, f.name);
    } catch (err) {
      return { name: f.name, message: `Couldn't read “${f.name}” again. It may have been moved, renamed or deleted.${reason(err)}` };
    }
  }
  if (f.blob) {
    try {
      return { name: f.name, text: await f.blob.text(), origin: 'file', blob: f.blob };
    } catch (err) {
      return {
        name: f.name,
        message: `This browser can't read “${f.name}” again after it changed on disk. Drop or choose the file again to reload it.${reason(err)}`,
      };
    }
  }
  return { name: f.name, message: `There is no source to reload “${f.name}” from.` };
}

/** github.com/o/r/blob/branch/path → raw.githubusercontent.com/o/r/branch/path */
export function normalizeUrl(input: string): { url: URL; rewritten: boolean } {
  const url = new URL(input.trim());
  if (url.hostname === 'github.com') {
    const m = /^\/([^/]+)\/([^/]+)\/blob\/(.+)$/.exec(url.pathname);
    if (m) return { url: new URL(`https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}`), rewritten: true };
  }
  return { url, rewritten: false };
}

export async function fetchSource(input: string): Promise<RawSource | LoadError> {
  let url: URL;
  try {
    url = normalizeUrl(input).url;
  } catch {
    return { name: input, message: 'That is not a valid URL.' };
  }
  const name = decodeURIComponent(url.pathname.split('/').filter(Boolean).at(-1) ?? '') || 'tokens.json';
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { name, message: 'Only http and https URLs can be loaded.' };
  let res: Response;
  try {
    // No cookies, no referrer: the request carries nothing about this page or the user.
    res = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', mode: 'cors' });
  } catch {
    return {
      name,
      message:
        "Couldn't load the URL. The server may not allow cross-origin requests (CORS), or it may be unreachable. " +
        'Try a raw file URL (for GitHub, raw.githubusercontent.com), or download the file and drop it here.',
    };
  }
  if (!res.ok) return { name, message: `The server answered ${res.status} ${res.statusText}.`.trim() };
  const length = Number(res.headers.get('content-length') ?? 0);
  if (length > MAX_BYTES) return { name, message: 'The file is larger than the 50 MB limit.' };
  return { name, text: await res.text(), origin: 'url', url: url.href };
}
