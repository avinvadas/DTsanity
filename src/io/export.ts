import { serialize } from '../json/cst';
import { dtcgToLegacy } from '../legacy/convert';
import type { SourceFile } from '../model/types';
import type { AppState } from '../state/app';
import { changesMarkdown } from './changes';
import { zip } from './zip';

export type ExportFormat = 'dtcg' | 'original';

export const exportText = (f: SourceFile): string => serialize(f.doc);

/**
 * Text to download. Converted legacy files export as DTCG by default, or back
 * in their original format; `notes` lists what couldn't be converted back.
 */
/** The name a source downloads under: its own, or for pasted code a file name made from it (“Pasted code 2” → pasted-code-2.json). */
export function fileNameOf(f: Pick<SourceFile, 'name' | 'origin'>): string {
  return f.origin === 'paste' ? `${f.name.toLowerCase().replace(/\s+/g, '-')}.json` : f.name;
}

export function exportAs(f: SourceFile, format: ExportFormat = 'dtcg'): { text: string; notes: string[] } {
  if (format === 'original' && f.converted && f.legacyKind) {
    // A Style Dictionary file writes references as "{a.b.value}" only if it did so when loaded (Spectrum writes "{a.b}").
    const suffix = f.legacyKind === 'style-dictionary' && (/\{[^{}]+\.value\}/.test(f.text) || !/\{[^{}]+\}/.test(f.text));
    const { doc, notes } = dtcgToLegacy(f.doc, f.legacyKind, suffix);
    return { text: serialize(doc), notes };
  }
  return { text: exportText(f), notes: [] };
}

/** True when the file has no edits: exporting gives back what was loaded (or its DTCG conversion). */
export const isUnchanged = (f: SourceFile): boolean => exportText(f) === f.baseText;

/** Save text (JSON by default) or bytes as a file. The Blob never leaves the browser. */
export function download(name: string, data: string | Uint8Array, type = 'application/json') {
  const blob = new Blob([data as BlobPart], { type });
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

/** The folder a fixed set downloads into, and the zip's name. */
export const FIXED_FOLDER = 'tokens-fixed';

/**
 * The whole loaded set with its changes, as one zip holding one folder:
 * every file under its own name and in its own format (converted legacy
 * files go back to Tokens Studio or Style Dictionary), plus CHANGES.md.
 */
export function fixedSet(s: Pick<AppState, 'files' | 'past'>, now = new Date(), open: readonly string[] = []): Uint8Array {
  const notes = new Map<string, string[]>();
  const files = s.files.map((f) => {
    const out = exportAs(f, f.converted ? 'original' : 'dtcg');
    notes.set(fileNameOf(f), out.notes);
    return { path: `${FIXED_FOLDER}/${fileNameOf(f)}`, text: out.text };
  });
  return zip([...files, { path: `${FIXED_FOLDER}/CHANGES.md`, text: changesMarkdown(s, notes, now, open) }], now);
}
