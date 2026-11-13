/**
 * How DTsanity fixes: the principles behind its one-click fixes and the
 * guidance in the fix prompt. One source for the "How DTsanity fixes" page,
 * the fix prompt's rules and docs/features.md, so the three never disagree.
 *
 * The short version: DTsanity changes the format, never the design. What is
 * mechanical it fixes itself; what needs a design decision it leaves to you
 * (or to the assistant you give the fix prompt to), with guidance.
 */

export const PRINCIPLE = 'DTsanity changes the format, never the design.';

export const PRINCIPLE_ABOUT =
  'What is mechanical, DTsanity fixes itself. What needs a design decision is left to you, or to the AI assistant you give the fix prompt to, with guidance on how to make it.';

export interface Principle {
  title: string;
  text: string;
}

/** What every one-click fix holds to. */
export const FIX_PRINCIPLES: readonly Principle[] = [
  {
    title: 'Only when the answer is clear',
    text: 'A broken reference is fixed only when one token is a close match, a missing type only when the value gives it away, and a rename only when the new name is free. When the right change isn’t clear, there is no fix button.',
  },
  {
    title: 'The DTCG spec decides what is right',
    text: 'Fixes bring a file to the DTCG format (2025.10): its keys, value shapes and types. They don’t apply a house style or rename tokens to taste.',
  },
  {
    title: 'Nothing is lost',
    text: 'Properties DTCG has no place for are kept under “$extensions”, not deleted, and are written back when a file is exported to its original format.',
  },
  {
    title: 'The smallest edit',
    text: 'A fix changes only the lines it is about. Files with no fixes download exactly as they were loaded.',
  },
  {
    title: 'Shown first, and undoable',
    text: 'Every fix shows its change before you apply it, and can be undone, one at a time or as a batch.',
  },
  {
    title: 'Design values are yours',
    text: 'Colors, sizes and the meaning of tokens are never changed for you. Contrast, color blindness, color scales and typography come with tools to work on them (re-aliasing, the curve editor) and you decide.',
  },
];

/** The two fixes that go a step further than the format, and why they are still offered. */
export const FIX_EXCEPTIONS: readonly Principle[] = [
  {
    title: 'Write the value instead',
    text: 'A base token that points at another token can be given the value it resolves to. This changes how the set is built, not only its format, so it is offered only where the reference resolves, shows the value first, and can be undone.',
  },
  {
    title: 'Remove the empty group',
    text: 'The one fix that deletes something. It applies only to a group with nothing in it, not even a misspelled “$value”; it is an info-level note, and can be undone.',
  },
];

export interface PromptRule {
  text: string;
  /** When the rule applies: always, or only when the prompt lists findings of that kind. */
  when: 'always' | 'files' | 'tiers' | 'contrast' | 'status';
}

/** The guidance the fix prompt gives with its corrections. */
export const PROMPT_RULES: readonly PromptRule[] = [
  { when: 'files', text: 'First make the files that couldn’t be read valid (JSON, or JSON5 in .json5 and .jsonc files), changing nothing else in them; then they can be checked.' },
  { when: 'always', text: 'Keep each file’s structure, token names and order unless a correction says otherwise.' },
  { when: 'always', text: 'Change the format, not the design: don’t change colors, sizes or what a token means unless a correction asks for it.' },
  { when: 'tiers', text: 'Tiers: base tokens hold values only; semantic tokens point at base or semantic tokens; component tokens point at semantic or base tokens.' },
  {
    when: 'contrast',
    text: 'To fix contrast, prefer pointing a semantic or component token at another existing base token over changing base values. Change a base value only when no existing token works, and say which.',
  },
  { when: 'status', text: 'To tell status colors apart, separate them by lightness, not only by hue: hue is what color blindness takes away.' },
  { when: 'always', text: 'List every change you make, per file.' },
];

/** Why the prompt's contrast rule prefers re-aliasing, for the page. */
export const PROMPT_WHY =
  'Re-pointing a token keeps the palette as it is and changes one use of a color; changing a base value changes every token that points at it. The fix prompt states only the rules that apply to what it lists.';
