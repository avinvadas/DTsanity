import type { Issue } from '../model/types';
import { ruleTitle } from '../model/rules';
import { h } from './dom';

/**
 * The parts every issue shows, on both layouts, in one order:
 * Title (the rule, in a few words) · target (the token or group) · detail
 * (only what the two leave out). The rule code, severity, target and place
 * ride along as data attributes, so tools reading the page get them whole.
 */

/** Machine-readable attributes for an issue's element. */
export const issueData = (i: Issue, where: string): Record<string, string | undefined> => ({
  'data-rule': i.code,
  'data-severity': i.severity,
  'data-target': i.target,
  'data-where': where || undefined,
});

/** The title line: the rule's name, then the token or group it's about. */
export const issueHead = (i: Issue, extra?: Node | null) =>
  h(
    'span',
    { class: 'issue-head' },
    h('strong', { class: 'issue-title', title: i.code }, ruleTitle(i.code)),
    i.target ? h('code', { class: 'issue-target' }, i.target) : null,
    extra ?? null,
  );

export const issueDetail = (i: Issue) => (i.message ? h('p', { class: 'issue-detail' }, i.message) : null);
