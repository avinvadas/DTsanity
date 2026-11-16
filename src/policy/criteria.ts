/**
 * What the findings report says about each rule, so a finding stands on its own
 * for a reader with no other context (often an AI assistant, or a design
 * system's own tooling):
 * - problem: what is wrong and why it matters;
 * - done: what must be true afterwards, as a check any tool can run against
 *   the files. It names the outcome, never the change: the design system
 *   decides how to get there;
 * - decline: when the system may leave a finding as it is, saying why in its
 *   report. Every advice rule has one; a required rule has one only when the
 *   files can't show whether the rule applies.
 *
 * tests/prompt-lint.test.ts holds every rule to this, and keeps the texts
 * free of prescriptions (no "→", no "use X", no token to point at).
 */

export interface Criterion {
  problem: string;
  done: string;
  decline?: string;
}

/** A finding not tied to a rule on the Policy page: a file whose text isn't JSON. */
export const UNREADABLE = 'unreadable-file';

const tierDecline = 'your system defines its tiers differently (other names, other directions, or none). Say how it does.';
const scaleDecline = 'the scale is meant to be this way (a deliberate accent step, a brand color kept as is). Say why.';
const typeDecline = 'the two are different on purpose in a way the tokens don’t show (different use, platform or language). Say how they differ.';

export const CRITERIA: Record<string, Criterion> = {
  [UNREADABLE]: {
    problem: 'The file isn’t valid JSON (or JSON5, for .json5 and .jsonc files), so nothing in it could be checked.',
    done: 'The file parses as JSON (JSON5 for .json5 and .jsonc), with the same tokens and values as before.',
  },
  // Format
  'legacy-format': {
    problem: 'The file is in an older format (Tokens Studio or Style Dictionary), not DTCG.',
    done: 'The file is DTCG: every token has “$value”, and types are given as “$type”.',
  },
  'legacy-conversion': {
    problem: 'Something in this older-format file has no exact DTCG equivalent, so it was left as it was written.',
    done: 'The value is written in a form the DTCG type allows, and resolves to what it meant before.',
    decline: 'your tools read this value as it is and no DTCG reader needs it. Say which tools.',
  },
  'json5-syntax': {
    problem: 'A .json file uses JSON5 syntax (comments, trailing commas, unquoted keys), which most JSON tools can’t read.',
    done: 'The file parses as plain JSON, or its extension is .json5.',
  },
  'resolver-missing': {
    problem: 'The resolver document names a file for a theme that wasn’t loaded with the others, so that theme was checked without it.',
    done: 'Every file the resolver names is loaded with it, or the resolver names only files that exist.',
    decline: 'the file exists and was only left out of this check. Say which file.',
  },
  'value-per-mode': {
    problem: 'Tokens hold one value per mode inside the token (“$value”: {“light”: …, “dark”: …}). DTCG gives a token a single value, so other tools read each such token as one object, not as one value per mode.',
    done: 'Each token has one value per file. The values of each mode come from a file (or set) of their own, chosen by a resolver document, or sit under “$extensions”.',
  },
  'unsupported-format': {
    problem: 'Most tokens in the file can’t be read as DTCG, so checks that need values skip them.',
    done: 'The tokens in the file read as DTCG tokens: each has “$value”, a type, and a name DTCG allows.',
  },
  'no-tokens': {
    problem: 'The file has no “$value” anywhere, so it holds no tokens.',
    done: 'The file holds tokens, or isn’t loaded as a token file.',
    decline: 'the file is meant to hold only groups or metadata. Say what it is for.',
  },
  'file-not-in-theme': {
    problem: 'No theme reads this file, so its tokens weren’t checked in any theme.',
    done: 'A theme reads the file, or the resolver document says it isn’t part of any.',
    decline: 'the file is loaded on its own, outside the themes. Say how it is used.',
  },
  // Structure
  'root-not-object': {
    problem: 'The top level of the file isn’t a JSON object, so it holds no tokens or groups.',
    done: 'The top level is an object of tokens and groups.',
  },
  'duplicate-key': {
    problem: 'The same key appears twice in one object. JSON parsers keep only one of them, usually the last, so the other is lost without notice.',
    done: 'Every key appears once in its object.',
  },
  'duplicate-path': {
    problem: 'The same token is defined in more than one file loaded together. DTCG doesn’t say which one wins; tools usually keep the last one read, so the result depends on file order.',
    done: 'Each token path is defined in one file of the files loaded together, or the files are themes of their own (chosen by a resolver document), not loaded together.',
    decline: 'the files are meant to override each other in a set order your tools guarantee. Say which order.',
  },
  'invalid-node': {
    problem: 'An entry is neither a token (an object with “$value”) nor a group (an object of tokens and groups), so DTCG tools can’t read it.',
    done: 'Every entry is a token or a group; data about a group or token sits under its “$extensions”.',
  },
  'unknown-property': {
    problem: 'A “$” property the DTCG format doesn’t define. DTCG keeps names starting with “$” for its own properties, now and later.',
    done: 'Tokens and groups use only the “$” properties DTCG defines; other data sits under “$extensions”.',
    decline: 'your tools need the property where it is and no DTCG reader is affected. Say which tools.',
  },
  'token-has-children': {
    problem: 'A token also holds keys that DTCG reads as tokens or groups inside it. DTCG requires this to be reported as an error, and readers ignore those keys or reject the file.',
    done: 'The token has only “$” properties. Whatever its other keys did is kept: inside “$value” if it changes the value (an alpha, say), under “$extensions” if it doesn’t.',
  },
  'legacy-property': {
    problem: 'A property written without the “$” (“value”, “type”), as older formats did. DTCG reads it as a token or group name.',
    done: 'Token properties are written with the “$” (“$value”, “$type”, “$description”).',
  },
  'invalid-name': {
    problem: 'A token or group name contains “{”, “}” or “.”. DTCG forbids these in names, since references use them: such a token can’t be referenced.',
    done: 'No token or group name contains “{”, “}” or “.”, and every reference to a renamed token follows the new name.',
  },
  'empty-group': {
    problem: 'A group with nothing in it.',
    done: 'The group holds tokens, or is gone.',
    decline: 'the group is a placeholder your tools fill in later. Say which.',
  },
  'token-group-conflict': {
    problem: 'The same path is a token in one file and a group in another, so it can’t be both when the files are read together.',
    done: 'Each path is either a token or a group in every file loaded together.',
  },
  // Types and values
  'missing-type': {
    problem: 'The token has no “$type”, on it, on a parent group, or through the token it references. DTCG makes such a token invalid and forbids tools from guessing its type from the value.',
    done: 'Every token has a type: its own “$type”, a parent group’s, or the type of the token it references. The type is the one the token is meant to have, which only its design system can say.',
  },
  'unknown-type': {
    problem: 'The “$type” isn’t one DTCG defines, so DTCG tools can’t read or check the value.',
    done: 'Every “$type” is a DTCG type, and the value fits it.',
  },
  'alias-type-mismatch': {
    problem: 'A token references a token of another type, so the value it gets doesn’t fit its own type.',
    done: 'Each token that references another has the same type as the token it references.',
  },
  'invalid-value': {
    problem: 'The value doesn’t fit the token’s type as DTCG defines it, so DTCG tools reject it or read it wrongly.',
    done: 'Each value fits its type as the DTCG Format and Color modules define it (a dimension has a number and a unit of px or rem, a color a color space and components, and so on), and resolves to what it meant before.',
  },
  'legacy-value': {
    problem: 'The value is written in an older syntax (a color as a CSS string, a dimension as “16px”). DTCG 2025.10 defines it as an object.',
    done: 'Each value is written in the DTCG 2025.10 form for its type, and resolves to the same color or size as before.',
  },
  'inconsistent-value': {
    problem: 'A value DTCG accepts but that tools are likely to read differently (or a likely mistake).',
    done: 'The value reads the same in any tool that reads DTCG.',
    decline: 'the value is meant as written. Say what it means.',
  },
  'font-fallback': {
    problem: 'A font stack that doesn’t end with a generic family (sans-serif, serif, monospace…), so text falls back to the platform default if no named font loads.',
    done: 'Each font family list ends with a generic family.',
    decline: 'the fonts are always bundled with the product. Say so.',
  },
  // References
  'unresolved-reference': {
    problem: 'A reference to a token that doesn’t exist in the files loaded together, so the token has no value.',
    done: 'Every reference names a token that exists in the files loaded together, in every theme the token is in.',
  },
  'reference-to-group': {
    problem: 'A reference names a group, not a token, so it has no value to resolve to.',
    done: 'Every reference names a token.',
  },
  'circular-reference': {
    problem: 'References lead back to the token they start from, so none of them has a value.',
    done: 'Every reference chain ends at a token with a value.',
  },
  'invalid-ref': {
    problem: 'A “$ref” isn’t a valid JSON pointer.',
    done: 'Every “$ref” is a JSON pointer (“#/…”) to a part of a token.',
  },
  'unresolved-ref': {
    problem: 'A “$ref” points at something that doesn’t exist.',
    done: 'Every “$ref” points at a value that exists.',
  },
  'circular-extends': {
    problem: 'A group extends itself through “$extends”, directly or through other groups.',
    done: 'No chain of “$extends” leads back to the group it starts from.',
  },
  'invalid-extends': {
    problem: 'An “$extends” that isn’t a reference to a group.',
    done: 'Every “$extends” is a reference to a group.',
  },
  'extends-token': {
    problem: 'An “$extends” points at a token; only a group can be extended.',
    done: 'Every “$extends” names a group.',
  },
  'unresolved-extends': {
    problem: 'An “$extends” names a group that doesn’t exist.',
    done: 'Every “$extends” names a group that exists in the files loaded together.',
  },
  'embedded-reference': {
    problem: 'A reference sits inside a longer text value (a formula, a list). DTCG resolves a reference only when it is the whole value, so tools read this one as plain text.',
    done: 'Every reference is the whole value of a token or of a part of a composite value.',
    decline: 'your build computes these values before any DTCG reader sees them. Say which build.',
  },
  'deprecated-reference': {
    problem: 'A token references a token marked “$deprecated”.',
    done: 'No token references a deprecated token.',
    decline: 'the deprecated token is kept on purpose for this one. Say why.',
  },
  // Tiers
  'tier-base-reference': {
    problem: 'A base token (one holding the palette, the scale) references another token instead of holding a value. A common convention, not a DTCG rule: base tokens hold values, the other tiers point at them.',
    done: 'Each base token holds a value, not a reference.',
    decline: tierDecline,
  },
  'tier-reference': {
    problem: 'A token references a tier it shouldn’t by a common convention: base tokens hold values, semantic tokens point at base or semantic tokens, component tokens at semantic or base tokens. Not a DTCG rule.',
    done: 'Each token references only the tiers the convention allows it.',
    decline: tierDecline,
  },
  'tier-hardcoded': {
    problem: 'A semantic or component token holds a value instead of referencing a base token, so it won’t follow changes to the palette or scale. A convention, not a DTCG rule.',
    done: 'Each semantic and component token references another token.',
    decline: 'the value is meant to stand alone (it isn’t part of any scale). Say why.',
  },
  // Metadata
  'invalid-description': { problem: 'A “$description” that isn’t text.', done: 'Every “$description” is a string.' },
  'invalid-type-property': { problem: 'A “$type” that isn’t text.', done: 'Every “$type” is a string naming a DTCG type.' },
  'invalid-deprecated': { problem: 'A “$deprecated” that is neither true, false nor text.', done: 'Every “$deprecated” is true, false or a string.' },
  'invalid-extensions': { problem: 'An “$extensions” that isn’t an object.', done: 'Every “$extensions” is an object.' },
  'extension-naming': {
    problem: 'An “$extensions” key that isn’t a reverse domain name. DTCG recommends one (“com.example.tool”) so tools don’t collide.',
    done: 'Every “$extensions” key is a reverse domain name.',
    decline: 'the key is one a tool you use requires. Say which tool.',
  },
  // Contrast
  'contrast-text': {
    problem: 'Text in this foreground on this background is below the contrast level the theme is held to (WCAG 2.2 1.4.3; 1.4.6 in high-contrast themes), so people with low vision may not read it. DTsanity paired the two tokens by their names.',
    done: 'The foreground, shown on the background (an alpha blended over it), reaches the level named for the pair, in every theme named.',
    decline: 'these two tokens are never used together as text on that background, or the text is decorative or part of a logo. Say which.',
  },
  'contrast-ui': {
    problem: 'An icon or other part of the interface in this color on this background is below 3:1 (WCAG 2.2 1.4.11), so people with low vision may not see it. DTsanity paired the two tokens by their names.',
    done: 'The foreground, shown on the background, reaches the level named for the pair, in every theme named.',
    decline: 'these two tokens are never used together, or the part is decorative and conveys nothing. Say which.',
  },
  'contrast-border': {
    problem: 'A border or outline below 3:1 on the background around it. WCAG 2.2 1.4.11 requires it only where the border is what shows the component (its edge, or its state); the files can’t tell which borders those are.',
    done: 'The border reaches the level named for the pair on that background, in every theme named.',
    decline: 'the border is decorative (a divider), or the component is shown some other way that passes (its fill, its text, an icon). Say which.',
  },
  'contrast-inactive': {
    problem: 'A disabled or inactive state below its contrast level. WCAG 2.2 exempts inactive components, so this is listed, not required.',
    done: 'The pair reaches the level named for it in every theme named.',
    decline: 'the state is disabled or inactive. Say so.',
  },
  // Color blindness
  'cvd-pair': {
    problem: 'The pair reaches its contrast level with typical vision but not as people with the color-vision deficiencies named see it (simulated), so for them it falls below the level. A check DTsanity makes, beyond WCAG’s requirements.',
    done: 'The pair reaches its contrast level under each deficiency named, in every theme named.',
    decline: 'the pair is never used where its contrast matters. Say why.',
  },
  'cvd-siblings': {
    problem: 'Status colors (danger, warning, success…) look alike as people with the color-vision deficiencies named see them (simulated), so color alone doesn’t tell them apart. Color blindness takes away mostly hue: a difference in lightness is what remains. WCAG 1.4.1 asks that color not be the only way information is shown.',
    done: 'Each two colors named differ by at least the distance given (ΔE in OKLab) under each deficiency named, in every theme named.',
    decline: 'every use of these colors also shows the status another way (an icon, a label). Say which.',
  },
  // Base color scales
  'scale-inversion': {
    problem: 'A step is lighter or darker than its place in the scale says, so a token that moves along the scale doesn’t move the way its name suggests.',
    done: 'Lightness changes in one direction along the scale’s steps.',
    decline: scaleDecline,
  },
  'scale-near-duplicate': {
    problem: 'Two neighbouring steps look almost the same, so one of them adds nothing.',
    done: 'Each two neighbouring steps differ by at least the distance given.',
    decline: scaleDecline,
  },
  'scale-outside-gamut': {
    problem: 'Steps are outside the target gamut, so screens of that gamut show a different color.',
    done: 'Every step is inside the target gamut.',
    decline: 'the steps are meant for wider-gamut screens, with a fallback for the others. Say which.',
  },
  'scale-hue-drift': {
    problem: 'The hue wanders across the scale’s steps.',
    done: 'The hue stays within the range given across the steps.',
    decline: scaleDecline,
  },
  'scale-uneven-lightness': {
    problem: 'The lightness gaps between steps vary a lot.',
    done: 'The lightness gaps between steps are close to even.',
    decline: scaleDecline,
  },
  'scale-missing-steps': {
    problem: 'The scale lacks steps the other full scales have.',
    done: 'The scale has the steps the other full scales have.',
    decline: 'the scale is meant to be shorter. Say why.',
  },
  'scale-unordered': {
    problem: 'Step names don’t follow a known order, so the scale can’t be checked in order.',
    done: 'Step names follow an order (numbers, or names such as light to dark).',
    decline: 'the steps have no order. Say so.',
  },
  'scale-p3': {
    problem: 'Display P3 colors outside sRGB: screens without P3 show a different color.',
    done: 'Each color is inside sRGB, or has an sRGB fallback.',
    decline: 'the product targets P3 screens only. Say so.',
  },
  // Typography
  'type-same': {
    problem: 'Text styles resolve to exactly the same values, so they can’t be told apart.',
    done: 'No two text styles resolve to the same values in every part.',
    decline: typeDecline,
  },
  'type-close': {
    problem: 'Neighbouring sizes with the same family and weight are less than 10% apart, too close to tell apart.',
    done: 'Neighbouring sizes of the same family and weight differ by at least 10%.',
    decline: typeDecline,
  },
  'type-small': {
    problem: 'Text smaller than 12px is hard to read.',
    done: 'No text style is smaller than 12px.',
    decline: 'the style is for something people don’t need to read (a legal mark, a badge count shown another way). Say which.',
  },
};
