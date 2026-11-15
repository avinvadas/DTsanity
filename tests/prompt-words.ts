/**
 * Words that steer a fix or need DTsanity to understand: a suggested change, a guessed type,
 * a DTsanity screen or setting. Neither the rule texts nor the findings in a prompt use them.
 */
export const PRESCRIBES = /Did you mean|\bFix:|looks like an? [a-z]|Switch the target|one-click|curve editor|tier view|themes matrix|re-?alias|\bprefer\b|→ \{/i;
