import { paintStyle, type ColorInfo, type Gamut } from '../color/format';
import type { PairGlyph } from '../semantic/pairs';

/**
 * Swatches are painted on <canvas> rather than as CSS backgrounds: usability
 * recorders capture DOM styles but not canvas pixels, so brand colors never
 * end up in a recording.
 */

/** The gamut this screen can actually show for the chosen target. */
export function displayGamut(target: Gamut): Gamut {
  return target === 'p3' && typeof matchMedia === 'function' && matchMedia('(color-gamut: p3)').matches ? 'p3' : 'srgb';
}

/** A canvas's size on screen, in CSS pixels. */
interface Size {
  w: number;
  h: number;
}
/** A swatch canvas: it repaints itself, at a size measured beforehand or measured now. */
type Painted = HTMLCanvasElement & { paint?: (size?: Size) => void };

const measure = (c: HTMLCanvasElement): Size => ({ w: c.clientWidth, h: c.clientHeight });

/** `mark`: draw the corner triangle on colors outside the gamut (off where a badge says so instead). */
export function swatchCanvas(info: ColorInfo, gamut: Gamut, mark = true): HTMLCanvasElement {
  const canvas = document.createElement('canvas') as Painted;
  canvas.className = 'swatch-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.paint = (size = measure(canvas)) => paint(canvas, info, gamut, mark, size);
  return canvas;
}

/**
 * Repaint every swatch canvas inside `root` at its current size. Every size is
 * read first, then every canvas painted: sizing a canvas invalidates layout,
 * so reading the next one's size in between would lay out the page again for
 * each canvas (thousands, for a set with many themes and pairs).
 */
export function paintAll(root: ParentNode) {
  const canvases = [...root.querySelectorAll<Painted>('canvas.swatch-canvas')];
  // A large view (a set with many themes and pairs holds thousands) paints what is on screen, and the rest as it scrolls in.
  // Each view's observer starts over on every repaint, so canvases a re-render removed aren't kept.
  observers.get(root)?.disconnect();
  if (canvases.length > LAZY_FROM && typeof IntersectionObserver === 'function') {
    const io = new IntersectionObserver(
      (entries) => {
        const near = entries.filter((e) => e.isIntersecting).map((e) => e.target as Painted);
        near.forEach((c) => io.unobserve(c));
        paintNow(near);
      },
      { rootMargin: '600px 0px' },
    );
    observers.set(root, io);
    canvases.forEach((c) => io.observe(c));
    return;
  }
  paintNow(canvases);
}

const LAZY_FROM = 300;
/** The lazy painter of each view that has one. */
const observers = new WeakMap<ParentNode, IntersectionObserver>();

function paintNow(canvases: Painted[]) {
  const sizes = canvases.map(measure);
  canvases.forEach((c, i) => c.paint?.(sizes[i]));
}

/**
 * A foreground on its background: "Aa" for text, a line around the
 * background for borders, a ring and bar for other UI parts (icons).
 * Painted like swatches, so the colors stay out of recordings.
 */
export function pairCanvas(fg: ColorInfo, bg: ColorInfo, glyph: PairGlyph, gamut: Gamut): HTMLCanvasElement {
  const canvas = document.createElement('canvas') as Painted;
  canvas.className = `swatch-canvas pair-canvas ${glyph}`;
  canvas.setAttribute('aria-hidden', 'true');
  canvas.paint = (size = measure(canvas)) => {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(size.w * dpr));
    const h = Math.max(1, Math.round(size.h * dpr));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const ctx = canvas.getContext('2d', { colorSpace: gamut === 'p3' ? 'display-p3' : 'srgb' });
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    if (bg.oklch.alpha < 1) checkerboard(ctx, w, h, 6 * dpr);
    ctx.fillStyle = paintStyle(bg, gamut);
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = ctx.strokeStyle = paintStyle(fg, gamut);
    if (glyph === 'border') {
      // Along the edge of the background shape; the rounded corners come from the canvas's own radius.
      const lw = 2 * dpr;
      ctx.lineWidth = lw;
      ctx.strokeRect(lw / 2, lw / 2, w - lw, h - lw);
    } else if (glyph === 'text') {
      ctx.font = `600 ${Math.round(h * 0.5)}px 'Sofia Sans', system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Aa', w / 2, h / 2 + h * 0.03);
    } else {
      const r = h * 0.22;
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      ctx.arc(w * 0.33, h / 2, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillRect(w * 0.55, h / 2 - dpr, w * 0.25, 2 * dpr);
    }
  };
  return canvas;
}

function paint(canvas: HTMLCanvasElement, info: ColorInfo, gamut: Gamut, mark: boolean, size: Size) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(size.w * dpr));
  const h = Math.max(1, Math.round(size.h * dpr));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d', { colorSpace: gamut === 'p3' ? 'display-p3' : 'srgb' });
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);
  if (info.oklch.alpha < 1) checkerboard(ctx, w, h, 6 * dpr);
  ctx.fillStyle = paintStyle(info, gamut);
  ctx.fillRect(0, 0, w, h);
  const outside = gamut === 'p3' ? !info.inP3 : !info.inSrgb;
  if (outside && mark) {
    // Corner mark: this swatch is a mapped approximation of the real color.
    const s = Math.min(w, h) * 0.32;
    ctx.fillStyle = info.oklch.l > 0.6 ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.75)';
    ctx.beginPath();
    ctx.moveTo(w - s, 0);
    ctx.lineTo(w, 0);
    ctx.lineTo(w, s);
    ctx.closePath();
    ctx.fill();
  }
}

function checkerboard(ctx: CanvasRenderingContext2D, w: number, h: number, size: number) {
  for (let y = 0; y < h; y += size) {
    for (let x = 0; x < w; x += size) {
      ctx.fillStyle = (x / size + y / size) % 2 < 1 ? '#ffffff' : '#d0d4da';
      ctx.fillRect(x, y, size, size);
    }
  }
}
