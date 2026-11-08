import './styles.css';
import { readDropped } from './io/load';
import { redo, store, undo } from './state/app';
import { TTFiles } from './ui/files';
import { TTIssues } from './ui/issues';
import { confirmClearAll, contrastControl, filesBar, ingest, reloadAll, TTLoader } from './ui/loader';
import { openFilesDialog } from './ui/files-dialog';
import { TIP } from './ui/tips';
import { h, icon } from './ui/dom';
import { logo } from './ui/logo';
import { TTMobile } from './ui/mobile';
import { TTNav } from './ui/nav';
import { TTPalettes } from './ui/palettes';
import { TTSemantic } from './ui/semantic';
import { TTSettings } from './ui/settings';
import { TTThemes } from './ui/themes';
import { TTTokens } from './ui/tokens';
import { installTooltips } from './ui/tooltip';
import { initTheme, themeToggle } from './ui/theme';

// The logo in the page's static places (sidebar, landing title); their text stays as the fallback.
document.querySelectorAll('[data-logo]').forEach((el) => el.replaceWith(logo()));

customElements.define('tt-loader', TTLoader);
customElements.define('tt-files', TTFiles);
customElements.define('tt-issues', TTIssues);
customElements.define('tt-tokens', TTTokens);
customElements.define('tt-settings', TTSettings);
customElements.define('tt-palettes', TTPalettes);
customElements.define('tt-themes', TTThemes);
customElements.define('tt-semantic', TTSemantic);
customElements.define('tt-nav', TTNav);
customElements.define('tt-mobile', TTMobile);
installTooltips();
initTheme();
// Top right of the viewport; the phone layout carries its own in its header.
document.body.append(themeToggle('desk-theme'));

// Under the sidebar's logo, above the tabs, the global settings: the loaded files (count, last change, actions), then the contrast target.
document.querySelector('.sidebar .brand')?.after(
  filesBar([
    { label: 'Add files…', icon: 'plus', tip: TIP.addMoreFiles, act: openFilesDialog },
    { label: 'Reload files', icon: 'refresh', tip: TIP.reload, act: () => void reloadAll() },
    { label: 'Clear all', icon: 'x', tip: TIP.clearAll, act: confirmClearAll },
  ]).el,
  contrastControl('theme-pick sidebar-contrast').el,
);

store.select(
  (s) => s.files.length > 0,
  (has) => document.body.classList.toggle('has-files', has),
);

// Accept files dropped anywhere on the page. With files in, an overlay says so while they're dragged
// over (desktop only; it takes no clicks and is hidden from screen readers: Add files in the menu
// does the same without dragging, and the file status announces the result).
document.body.append(
  h('div', { class: 'drop-overlay', 'aria-hidden': 'true' }, h('div', { class: 'drop-card' }, icon('plus'), h('strong', null, 'Drop to add files'), h('span', null, 'A file with the same name replaces the loaded one'))),
);
const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false;
let depth = 0;
document.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  depth++;
  document.body.classList.add('dragging');
});
document.addEventListener('dragleave', (e) => {
  if (!hasFiles(e)) return;
  // Leaving the window ends the drag here, whatever the count says.
  const out = e.clientX <= 0 || e.clientY <= 0 || e.clientX >= innerWidth || e.clientY >= innerHeight;
  if (--depth <= 0 || out) {
    depth = 0;
    document.body.classList.remove('dragging');
  }
});
document.addEventListener('dragover', (e) => {
  if (hasFiles(e)) e.preventDefault();
});
document.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  depth = 0;
  document.body.classList.remove('dragging');
  if (e.dataTransfer?.files.length) void ingest(readDropped(e.dataTransfer));
});

// A drag cancelled outside the window (or with Escape) may never send a last dragleave.
const endDrag = () => {
  depth = 0;
  document.body.classList.remove('dragging');
};
window.addEventListener('blur', endDrag);
document.addEventListener('dragend', endDrag);

document.addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
  const el = e.target as HTMLElement | null;
  if (el?.closest('input, textarea, select, [contenteditable]')) return;
  e.preventDefault();
  if (e.shiftKey) redo();
  else undo();
});

// Which build this is, for telling a hosted copy from a newer one.
console.info(`DTsanity build ${__VERSION__}`);
