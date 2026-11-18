# Decisions

Each change to how DTsanity reads design systems, with the systems it comes
from, the numbers before and after, and what it gives up. See “When a rule or
exception is added” in [README.md](README.md).

## 1. Pair colors only where a system shows they are seen together

*2026-11-18 · contrast-text, contrast-ui, contrast-border, contrast-inactive*

The first review of the ten systems found contrast checks right only 37–50%
of the time. Most misreadings were pairs a system never shows together. Four
general ideas replace guessing, each stated as a meaning:

1. **A description's surface wins over the name.** When a token's
   description puts it on a surface (“text on subtle blue accent
   backgrounds”, “on a dark background color”, “tiles on layer 01”), it is
   paired only with backgrounds of that surface; with none, it isn't checked.
   *Atlassian (19), GitLab (2), Carbon (layer borders).*
2. **What can't be seen isn't measured.** A fully transparent foreground draws
   nothing, and a fully transparent background shows whatever is under the
   component, which the files don't say. *GitLab (20 transparent borders),
   Carbon (a gradient's transparent stop).*
3. **A color the same as its background isn't a pair.** It is hidden on
   purpose, or two roles share a color. *Primer (a gutter marker set to the
   background), Backpack (hero text and surface).*
4. **Subtle, muted and decorative lines are exempt, not required.** WCAG
   1.4.11 asks contrast only of a border that shows a component. A line a
   system names subtle, muted, faint or decorative, a divider or a separator,
   is listed as “Low contrast, exempt” (info, not counted), like a disabled
   state. *Carbon, Primer, Designsystemet, Atlassian.* No new check: the
   exempt check (`contrast-inactive`) covers it.

Also: a legacy token's own description (a Figma export's
`attributes.description`) is now read as its description, so idea 1 works on
those files too.

| Check | Precision before | After | Reviewed findings still found |
|---|---|---|---|
| contrast-text | 37% | 76% | 52 → 25 |
| contrast-border | 41% | 90% | 75 → 16 |
| contrast-ui | 50% | 83% | 6 → 4 |

No finding reviewed as right was lost on any system.

**What it gives up.** A token described for a surface DTsanity can't find
among the backgrounds isn't checked at all, even if it fails there (Carbon's
`text-placeholder` sits in fields, and is recorded as a miss). Subtle borders
that do show a component (an input's only edge) are listed, not counted: the
name can't tell, and a person decides.

**Still open, one system each.** Primer writes a translucent token's alpha
beside `$value`, which DTsanity doesn't read yet (5 misreadings); GitLab's
`text.tertiary` is disabled through a deprecated alias; GitLab's tooltip text
sits on a fixed dark surface no name or description states; Backpack's “ON”
means selected, not “on top of”.
