/**
 * Marks tags whose text wraps onto more than one line with `.multi-line`, so
 * they can be styled as a padded frame rather than a stretched pill (CSS
 * can't tell how many lines an element takes). Watches every tag added to
 * the page, and re-checks as their width changes.
 */
const TAGS = '.theme-tag, .tier-tag, .remedy';

const sizes = new ResizeObserver((entries) => {
  for (const { target } of entries) {
    const el = target as HTMLElement;
    // One line of its own text, from its line height; padding and border aside.
    const style = getComputedStyle(el);
    const line = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5;
    const content = el.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    // Measured without the multi-line padding, so the mark doesn't feed back on itself.
    const wasMulti = el.classList.contains('multi-line');
    const lines = content / line;
    el.classList.toggle('multi-line', wasMulti ? lines > 1.2 : lines > 1.5);
  }
});

const watch = (root: ParentNode) => {
  for (const el of root.querySelectorAll<HTMLElement>(TAGS)) sizes.observe(el);
};

/** Start watching the page's tags, now and as views render. */
export function watchWrappingTags() {
  watch(document);
  new MutationObserver((records) => {
    for (const r of records) for (const n of r.addedNodes) if (n instanceof HTMLElement) n.matches(TAGS) ? sizes.observe(n) : watch(n);
  }).observe(document.body, { childList: true, subtree: true });
}
