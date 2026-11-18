// A finding's lasting name, for the maturity record (scripts/corpus.mjs).

/**
 * A finding's lasting name: its rule and what it is about (the tokens, the
 * file, the themes), without line numbers, measured values or wording, so a
 * verdict survives rewording and edits elsewhere in the file. Readable on
 * purpose: the verdict files are for people too.
 */
export function keyOf(rule, line) {
  const [before] = line.split('References:');
  const subject = before
    .split(/: (?=[^`]*(?:`|$))/)[0]
    .replace(/:\d+(?= ›)/g, '')
    .replace(/\s*\(line \d+[^)]*\)/g, '')
    .trim();
  const ids = [...new Set([...before.matchAll(/`([^`]+)`/g)].map((m) => m[1]))].filter((id) => !subject.includes(`\`${id}\``)).sort();
  return `${rule} · ${subject}${ids.length ? ` · ${ids.join(', ')}` : ''}`;
}
