// node scripts/thin.mjs
// Writes samples-thin/<set>/: a small part of a sample set, for quick checks on a
// thin but realistic system. Each set keeps the groups listed below, plus every
// token they point at (and what those point at), so no reference is broken by
// the trimming. Tokens keep their names, values, types and descriptions as
// published; files keep their paths. samples/ itself is never touched.
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SRC = join(ROOT, 'samples');
const OUT = join(ROOT, 'samples-thin');

/** Per set: file → the token paths kept from it ('*' keeps the whole file). */
const SETS = {
  gitlab: {
    note: 'Four hues and the neutral ramp, spacing, radius and type; the core semantic colors; buttons (default, confirm, danger, disabled) and alerts.',
    keep: {
      'constant/color.neutral.tokens.json': '*',
      'constant/color.blue.tokens.json': '*',
      'constant/color.red.tokens.json': '*',
      'constant/color.green.tokens.json': '*',
      'constant/color.orange.tokens.json': '*',
      'constant/border.tokens.json': '*',
      'constant/spacing_scale.tokens.json': '*',
      'constant/font.tokens.json': '*',
      'constant/line_height.tokens.json': '*',
      'semantic/background.tokens.json': '*',
      'semantic/text.tokens.json': '*',
      'semantic/border.tokens.json': '*',
      'semantic/icon.tokens.json': '*',
      'semantic/feedback.tokens.json': '*',
      'semantic/focus-ring.tokens.json': '*',
      'semantic/action.tokens.json': ['action.border', 'action.neutral', 'action.confirm', 'action.danger', 'action.disabled'],
      'contextual/button.tokens.json': ['button.border', 'button.default.primary', 'button.confirm.primary', 'button.danger.primary', 'button.disabled'],
      'contextual/alert.tokens.json': '*',
    },
  },
  designsystemet: {
    note: 'Light and dark, one size and one typeface; the accent, neutral, success and danger colors; the semantic style file.',
    keep: {
      'primitives/globals.json': '*',
      'primitives/modes/size/medium.json': '*',
      'primitives/modes/size/global.json': '*',
      'primitives/modes/typography/size/medium.json': '*',
      'primitives/modes/typography/primary/designsystemet.json': '*',
      'primitives/modes/color-scheme/light/designsystemet.json': ['designsystemet.accent', 'designsystemet.neutral', 'designsystemet.success', 'designsystemet.danger', 'designsystemet.link', 'designsystemet.focus'],
      'primitives/modes/color-scheme/dark/designsystemet.json': ['designsystemet.accent', 'designsystemet.neutral', 'designsystemet.success', 'designsystemet.danger', 'designsystemet.link', 'designsystemet.focus'],
      'themes/designsystemet.json': ['color.accent', 'color.neutral', 'color.success', 'color.danger', 'color.link', 'color.focus', 'font-family', 'font-weight', 'border-radius'],
      'semantic/color/accent.json': '*',
      'semantic/color/neutral.json': '*',
      'semantic/color/success.json': '*',
      'semantic/color/danger.json': '*',
      'semantic/style.json': ['color.accent', 'color.neutral', 'color.success', 'color.danger', 'color.focus', 'link', 'border-width', 'border-radius', 'opacity', 'typography', 'shadow', 'size'],
    },
  },
  carbon: {
    note: 'Two themes (white and g100) of the four; the gray, blue, red, green and yellow ramps; backgrounds, layers 01–02, fields, borders, text, links, icons, support colors and focus; buttons and notifications.',
    keep: {
      'colors/tokens/colors.tokens.json': ['black', 'white', 'gray', 'blue', 'red', 'green', 'yellow'],
      ...Object.fromEntries(
        ['white', 'g100'].flatMap((t) => [
          [`themes/tokens/themes/${t}/theme.tokens.json`, [/^(background|layer-0[12]|layer-(active|hover|selected)-0[12]|field-0[12]|field-hover-0[12]|border-(subtle|strong)-0[12]|border-(interactive|inverse|disabled)|text-|link-|icon-|support-|focus|interactive|highlight|overlay)/]],
          [`themes/tokens/themes/${t}/button.tokens.json`, '*'],
          [`themes/tokens/themes/${t}/notification.tokens.json`, '*'],
        ]),
      ),
    },
  },
  cloudscape: {
    note: 'Text, background and border colors for the body, layout, containers, buttons, inputs, links and status; type sizes, weights and line heights; static spacing and the main radii; the alert and header contexts. No chart colors.',
    keep: {
      'cloudscape.tokens.json': [
        /^(tokens|contexts\.(alert|header)\.tokens)\.(color-(text|background|border)-(body|layout|container|button|input|link|status|notification|control|dropdown|item|divider|heading|home)|font-(size|weight|family)-|line-height-|space-static-|border-radius-(button|input|container|alert))/,
      ],
    },
  },
  atlassian: {
    note: 'Light and dark (not the increased-contrast themes); text, icon, border and link colors, the neutral, brand, status, input, selected and disabled backgrounds, and the surfaces. No accent colors.',
    keep: Object.fromEntries(
      ['atlassian-light.json', 'atlassian-dark.json'].map((f) => [
        f,
        [/^tokens\.[^/]+\/(color\.(text|icon|border|link)(\.(?!accent)|$)|color\.background\.(neutral|brand|danger|success|warning|information|input|selected|disabled)|elevation\.surface)/],
      ]),
    ),
  },
  backpack: {
    note: 'Core, text, surface, line and status colors; button colors; spacing, radii, font weights and type settings. The aliases they point at come along; the rest of the palette does not.',
    roots: ['aliases'],
    keep: {
      'base.raw.json': [
        (id, n) => id.startsWith('props.') && ['core-colors', 'text-colors', 'surface-colors', 'line-colors', 'status-colors', 'button-colors', 'spacings', 'radii', 'font-weights', 'typesettings'].includes(n.category),
      ],
    },
  },
  'sap-horizon': {
    note: 'Two themes (Horizon light and dark) of the four; the semantic colors, the standard and emphasized buttons, standard inputs, links, focus and text; the content spacing. No charts or shell categories.',
    keep: Object.fromEntries(
      ['sap_horizon.json', 'sap_horizon_dark.json'].map((f) => [
        f,
        ['Semantic', 'Button.Standard', 'Button.Emphasized', 'Input.Standard', 'Link', 'Focus', 'Text', /^sapContent_(Margin|Padding|Space)_/],
      ]),
    ),
  },
};

const isToken = (n) => n && typeof n === 'object' && !Array.isArray(n) && ('$value' in n || 'value' in n);
// {curly} references (Style Dictionary's {!NAME} too) and JSON pointers into a token ("$ref": "#/gray/50/$value/…").
const refsIn = (v) => {
  const s = JSON.stringify(v ?? null);
  return [
    ...[...s.matchAll(/\{!?([^{}"\s;]+)\}/g)].map((m) => m[1]),
    ...[...s.matchAll(/"\$ref":"#\/([^"]+)"/g)].map((m) => m[1].split('/$value')[0].split('/').join('.')),
  ];
};
const matches = (spec, t) =>
  spec === '*' || spec.some((p) => (typeof p === 'function' ? p(t.id, t.node) : p instanceof RegExp ? p.test(t.id) : t.id === p || t.id.startsWith(p + '.')));
const hasToken = (n) => isToken(n) || (n && typeof n === 'object' && Object.entries(n).some(([k, v]) => !k.startsWith('$') && hasToken(v)));
const walk = (d) => readdirSync(d).sort().flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));

function tokensOf(node, path = [], out = []) {
  if (isToken(node)) out.push({ id: path.join('.'), node });
  else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) if (!k.startsWith('$')) tokensOf(v, [...path, k], out);
  return out;
}

/** The node with only the kept tokens; group-level $ properties stay with any group that keeps a token. */
function prune(node, keep, path = []) {
  if (isToken(node)) return keep.has(path.join('.')) ? node : undefined;
  if (!node || typeof node !== 'object') return undefined;
  // What holds no tokens (a file's name, a rename map) stays as published.
  if (!hasToken(node)) return node;
  const out = {};
  let any = false;
  for (const [k, v] of Object.entries(node)) {
    if (k.startsWith('$')) continue;
    const kept = prune(v, keep, [...path, k]);
    if (kept !== undefined) ((out[k] = kept), (any = true));
  }
  if (!any && path.length) return undefined;
  // $ properties first, as the files have them.
  const meta = Object.fromEntries(Object.entries(node).filter(([k]) => k.startsWith('$')));
  return { ...meta, ...out };
}

for (const [set, { keep, note, roots = [] }] of Object.entries(SETS)) {
  const src = join(SRC, set);
  const files = walk(src).filter((p) => p.endsWith('.json') && !/\/\$(themes|metadata)\.json$/.test(p));
  const docs = new Map(files.map((p) => [relative(src, p), JSON.parse(readFileSync(p, 'utf8'))]));
  // Every token id, in every file that defines it (modes define the same ids).
  const where = new Map();
  for (const [f, doc] of docs) for (const t of tokensOf(doc)) where.set(t.id, [...(where.get(t.id) ?? []), { f, node: t.node }]);

  const kept = new Map([...docs.keys()].map((f) => [f, new Set()]));
  const queue = [];
  for (const [f, spec] of Object.entries(keep)) {
    if (!docs.has(f)) throw new Error(`${set}: no file ${f}`);
    for (const t of tokensOf(docs.get(f))) if (matches(spec, t)) (kept.get(f).add(t.id), queue.push(t.node));
  }
  // What the kept tokens point at comes along, from every file that defines it.
  const missing = new Set();
  while (queue.length) {
    for (const ref of refsIn(queue.pop())) {
      // A bare name may live under a root group (Backpack's {!NAME} is aliases.NAME).
      const defs = where.get(ref) ?? roots.map((r) => where.get(`${r}.${ref}`)).find(Boolean);
      if (!defs) {
        missing.add(ref);
        continue;
      }
      // From the chosen files when they define it (one mode, not every mode); otherwise from wherever it is.
      const chosen = defs.filter((d) => d.f in keep);
      const id = where.has(ref) ? ref : `${roots.find((r) => where.has(`${r}.${ref}`))}.${ref}`;
      for (const { f, node } of chosen.length ? chosen : defs) if (!kept.get(f).has(id)) (kept.get(f).add(id), queue.push(node));
    }
  }

  const out = join(OUT, set);
  rmSync(out, { recursive: true, force: true });
  const written = [];
  let count = 0;
  for (const [f, ids] of kept) {
    if (!ids.size || !hasToken(docs.get(f))) continue;
    const doc = prune(docs.get(f), ids);
    mkdirSync(dirname(join(out, f)), { recursive: true });
    writeFileSync(join(out, f), JSON.stringify(doc, null, 2) + '\n');
    written.push(f.replace(/\.json$/, ''));
    count += ids.size;
  }
  // A DTCG resolver keeps only the files that are left, and only the themes that still have files.
  for (const [f, doc] of docs) {
    if (!f.endsWith('.resolver.json')) continue;
    const here = dirname(f);
    const exists = (r) => r.startsWith('#') || written.includes(join(here, r).replace(/\.json$/, ''));
    const clean = (n) => {
      if (Array.isArray(n)) return n.filter((x) => !(x && typeof x.$ref === 'string' && !exists(x.$ref))).map(clean);
      if (!n || typeof n !== 'object') return n;
      const o = {};
      for (const [k, v] of Object.entries(n)) {
        const c = clean(v);
        if (!(Array.isArray(v) && v.length && Array.isArray(c) && !c.length)) o[k] = c;
      }
      return o;
    };
    mkdirSync(dirname(join(out, f)), { recursive: true });
    writeFileSync(join(out, f), JSON.stringify(clean(doc), null, 2) + '\n');
  }
  // Tokens Studio: the theme and set lists name only the files that are left.
  if (statSync(join(src, '$metadata.json'), { throwIfNoEntry: false })) {
    const meta = JSON.parse(readFileSync(join(src, '$metadata.json'), 'utf8'));
    meta.tokenSetOrder = meta.tokenSetOrder.filter((s) => written.includes(s));
    writeFileSync(join(out, '$metadata.json'), JSON.stringify(meta, null, 2) + '\n');
  }
  if (statSync(join(src, '$themes.json'), { throwIfNoEntry: false })) {
    const themes = JSON.parse(readFileSync(join(src, '$themes.json'), 'utf8'))
      // A theme that lost any of its sets (another size, typeface or color) is left out whole.
      .filter((t) => Object.keys(t.selectedTokenSets).every((s) => written.includes(s)));
    writeFileSync(join(out, '$themes.json'), JSON.stringify(themes, null, 2) + '\n');
  }
  for (const l of ['LICENSE', 'NOTICE']) if (statSync(join(src, l), { throwIfNoEntry: false })) copyFileSync(join(src, l), join(out, l));
  const source = readFileSync(join(src, 'SOURCE.md'), 'utf8').split('\n')[0];
  writeFileSync(
    join(out, 'SOURCE.md'),
    `${source} — thin edition\n\nA trimmed copy of [samples/${set}](../../samples/${set}/SOURCE.md), for quick checks on a small but realistic system. Made by \`node scripts/thin.mjs\`; not edited by hand.\n\n- Kept: ${note}\n- Also kept: every token those point at, so no reference is broken by the trimming.\n- Tokens are as published: same names, values, types and descriptions. Only whole tokens, files and themes were left out.\n- ${count} tokens in ${written.length} files.\n`,
  );
  console.log(`${set}: ${count} tokens in ${written.length} files${missing.size ? `; refs not found in the original either: ${[...missing].slice(0, 5).join(', ')}${missing.size > 5 ? '…' : ''}` : ''}`);
}
