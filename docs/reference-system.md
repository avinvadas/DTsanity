# Reference design system: how we change our tokens

This file stands in for a design system's own rules in tests of the fix
prompt. It belongs to no real system, and the findings report never refers to it.
Give it to the assistant beside the prompt and the token files, as a team
would give its own guidelines.

These are our rules. Where a finding's "done when" can be met in several
ways, choose by these rules. Where a finding is advice and these rules say
otherwise, decline it and name the rule.

## 1. Where tokens come from

- The token files are the source. Nothing generates them, so change them
  directly.
- The files are DTCG 2025.10. Anything a DTCG reader doesn't need goes under
  `$extensions`, in our namespace `org.example.ds` unless a tool's own key
  is already there.
- Each theme's values live in a file (or set) of its own, and a resolver
  document chooses them. One value per token per file: values per mode are
  never written inside a token.

## 2. Tiers

- **Base** tokens are the palette and the scales (`…blue.500`, `…space.4`).
  They hold values, never references.
- **Semantic** tokens name a role (`…bg.default`, `…text.muted`,
  `…border.subtle`). They reference base or other semantic tokens.
- **Component** tokens belong to one component (`button.…`). They reference
  semantic tokens, or base tokens where no semantic role fits.
- A token that sits in the wrong tier moves to the right one only if no
  code would lose it. Otherwise it is re-pointed in place.
- A value written directly in a semantic or component token is allowed for
  one-off values that belong to no scale (a fixed overlay alpha, a hairline
  width). Leave those as they are and say so.

## 3. Names

- Names are never changed for style. A rename happens only when a standard
  requires it (a character DTCG forbids), and then every reference to the old
  name is updated in the same change. List every rename in the report.
- A character DTCG forbids becomes a group level where the name already reads
  as a path (`space.small` becomes `space` › `small`), and a dash otherwise.

## 4. Types

- Put `$type` on the group when every token in it shares it; otherwise on
  each token.
- The type is what the token is for, read from its name, its group and where
  it is used, not only from its value. A number named weight is a
  `fontWeight`; a number named opacity or alpha is a `number`. When those
  disagree or say nothing, ask.

## 5. Color and contrast

Choose a contrast fix in this order:

1. Re-point the semantic or component token to another step of the same base
   scale that passes, in every theme the pair is in.
2. If no step passes in every theme, add a step to the scale between two
   existing ones, or change the step's lightness (OKLCH L) only, keeping its
   hue and chroma. Check every other token that points at a changed step,
   and list them.
3. Never change a brand color (anything under a `brand` group). Decline and
   say so.

- A token's role decides what it must pass against. Text and icons pass
  against the backgrounds of their own group. Tokens named `on-…` pass
  against the fills they name, not against the page.
- Borders of inputs, controls and focus rings must reach 3:1. Borders named
  `divider`, `separator`, `subtle` or `muted` are decorative: decline those
  findings.
- Disabled and inactive states are exempt.
- A high-contrast theme is held to the enhanced level. A fix in one theme
  must keep the pair passing in every other theme.
- Status colors (danger, warning, success, info) differ in lightness as well
  as hue. Every use of a status color also shows an icon, so a sibling
  finding about status colors that look alike may be declined for that
  reason, but only when each status color passes contrast against the
  surface it sits on (status colors are not compared with each other).

## 6. Scales and typography

- Scales run light to dark in step order. A step that is out of order is
  fixed in lightness, not by renaming steps.
- No text style is below 12px, except styles named `legal` or `caption-fine`,
  which are declined with that reason.
- Two text styles that resolve to the same values are kept when they name
  different uses. Decline and name the uses.

## 7. When to ask instead of changing

- Deleting a token, or a change that alters a value someone sees, beyond what
  a finding requires.
- Choosing between two types, two tiers or two scales when these rules don't
  decide.
- A finding whose only fix would break another rule here.

## 8. Report

Answer every finding by its number: **done** (what changed), or **declined**
(the rule here, or the reason). Then list every token whose resolved value
changed, in which theme, and every rename. Questions go last.
