import { entry, toJS } from '../json/cst';
import { makeIssue } from '../model/build';
import type { Issue, Model } from '../model/types';
import { walkNodes } from './walk';

/** Metadata rules: `$description`, `$extensions`, `$deprecated` and `$type` must have the right shape. */
export function metadataRules(model: Model): Issue[] {
  const issues: Issue[] = [];
  for (const v of walkNodes(model.files)) {
    const { file, node, keyPath } = v;
    const at = (key: string) => ({ fileId: file.id, target: v.path.join('.'), keyPath: [...keyPath, key], pos: node.entries.find((e) => e.key === key)?.pos });

    const desc = entry(node, '$description')?.value;
    if (desc && desc.kind !== 'string') {
      const text = desc.kind === 'number' || desc.kind === 'boolean' ? String(desc.value) : JSON.stringify(toJS(desc));
      issues.push(
        makeIssue('error', 'metadata', 'invalid-description', 'Must be text.', at('$description'), {
          label: 'Convert to text',
          preview: { before: JSON.stringify(toJS(desc)), after: JSON.stringify(text) },
          edits: [{ fileId: file.id, path: [...keyPath, '$description'], value: text }],
        }),
      );
    }

    const type = entry(node, '$type')?.value;
    if (type && type.kind !== 'string') issues.push(makeIssue('error', 'metadata', 'invalid-type-property', 'Must be text.', at('$type')));

    const dep = entry(node, '$deprecated')?.value;
    if (dep && dep.kind !== 'boolean' && dep.kind !== 'string') {
      issues.push(makeIssue('error', 'metadata', 'invalid-deprecated', 'Must be true, false, or text saying what to use instead.', at('$deprecated')));
    }

    const ext = entry(node, '$extensions')?.value;
    if (ext && ext.kind !== 'object') {
      issues.push(makeIssue('error', 'metadata', 'invalid-extensions', 'Must be an object.', at('$extensions')));
    } else if (ext?.kind === 'object') {
      const loose = ext.entries.filter((e) => !e.key.includes('.')).map((e) => e.key);
      if (loose.length) {
        issues.push(
          makeIssue(
            'warning',
            'metadata',
            'extension-naming',
            `${loose.map((k) => `“${k}”`).join(', ')} should be a reverse domain, like “com.example.tool”.`,
            at('$extensions'),
          ),
        );
      }
    }
  }
  return issues;
}
