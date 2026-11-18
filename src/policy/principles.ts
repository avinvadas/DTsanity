export interface Principle {
  title: string;
  text: string;
}

/**
 * How DTsanity works: findings are flags for the user's own environment, and
 * the user's design system prevails; the one-click fixes change the format,
 * never the design. One source for the "How DTsanity works" page, the
 * findings report's framing and rules, and docs/features.md, so they never
 * disagree.
 */

export const PRINCIPLE = 'DTsanity flags. Your design system decides.';

export const PRINCIPLE_ABOUT =
  'DTsanity checks your token files against the DTCG format, contrast (WCAG 2.2 or APCA), color blindness and common token conventions, and reports what it finds as flags. You use them where you work: with your AI assistant, your own tooling or a ticket. Nothing in them overrides how your system is built.';

/** The findings report's framing, said once at its top. */
export const FLAGS =
  '**These findings are flags, not instructions.** Your design system’s own rules, conventions and decisions come first. Where a finding conflicts with them, leave it as it is and say which rule prevails. A finding is closed when its check passes, or when you decline it with your reason.';

/** What a finding is, and what it isn't. */
export const FLAG_PRINCIPLES: readonly Principle[] = [
  {
    title: 'Your system comes first',
    text: 'Your design system’s rules, conventions and decisions prevail. Where a finding conflicts with them, keep yours and decline the finding, naming the rule that prevails.',
  },
  {
    title: 'Required, or advice',
    text: 'Required findings come from a standard (DTCG 2025.10, WCAG 2.2, JSON); advice comes from common conventions. Either can be declined for a reason. Declining a required one names your rule and the standard it departs from.',
  },
  {
    title: 'What, not how',
    text: 'Each finding gives the problem, the evidence and what must be true when it is done. How to get there is for your system to decide: its tiers, scales, naming and generators. If your files are generated, the change belongs where they are produced.',
  },
  {
    title: 'Closed by a fresh check',
    text: 'A finding is closed when its check passes on a fresh run, or when you decline it with your reason. DTsanity keeps no record of your files or your decisions: each check starts from the files as they are.',
  },
  {
    title: 'Used where you work',
    text: 'Copy the findings as a prompt for your AI assistant, run the offline check in your own scripts, or file them as tickets. The changes are made in your environment, by your rules.',
  },
];


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
  when: 'always' | 'files' | 'advice';
}

/**
 * How the findings report asks to be worked through. It reports; the reader's
 * design system decides. So the rules say what a finding gives, what the
 * result must keep, and how to answer, never how to change a token: each
 * finding carries its own problem, evidence, "done when" and "decline if"
 * (src/policy/criteria.ts).
 */
export const PROMPT_RULES: readonly PromptRule[] = [
  {
    when: 'always',
    text: 'Each finding says what is wrong, the evidence, and what must be true when it is done. How to get there is yours to decide, by your design system’s own rules (its tiers, scales, naming, generators). If these files are generated, from design files or a script, make the change where they are produced.',
  },
  {
    when: 'always',
    text: 'Required findings come from a standard (DTCG 2025.10, WCAG 2.2, JSON): they are done when their check passes. Where your system departs from the standard on purpose, decline it, and name your rule and the standard it departs from. A file that can’t be read is the exception: no tool can use it until it is valid.',
  },
  {
    when: 'advice',
    text: 'Advice comes from common conventions, not a standard. Follow it, or decline it when your system does otherwise, and say how.',
  },
  { when: 'files', text: 'First make the files that couldn’t be read valid, changing nothing else in them; then they can be checked.' },
  {
    when: 'always',
    text: 'Change what a finding needs, including a value people see, where its “done when” can’t be met otherwise. Keep the rest: token names, structure and order, and the value every other token resolves to in every theme. Other tokens and code refer to tokens by name.',
  },
  {
    when: 'always',
    text: 'A change must not cause a finding of its own: a broken reference, a value DTCG can’t read, a pair that falls below its level, also as the color-vision deficiencies this report simulates see it, where it simulates them. If a finding needs a choice that neither the files nor your system’s rules settle, leave it and ask.',
  },
  {
    when: 'always',
    text: 'End with a report that lists every finding by its number (#1, #2…): done, or declined and why. Then every token whose resolved value changed, in which theme and why, and your questions.',
  },
];

/** Why the findings report describes findings instead of prescribing fixes, for the page. */
export const PROMPT_WHY =
  'A design system has its own rules for how its tokens are made. The report gives each finding the context to fix it that way, and a check any tool can run afterwards, so the result is judged on a fresh run, not against DTsanity’s idea of the fix. It states only the rules that apply to what it lists.';
