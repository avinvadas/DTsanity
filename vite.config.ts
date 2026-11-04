/// <reference types="vitest/config" />
import { execSync } from 'node:child_process';
import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * Content Security Policy injected into the built page.
 *
 * Everything is inlined by vite-plugin-singlefile, so the page needs no
 * external scripts, styles, fonts or images. `connect-src` stays open to
 * https (and local http) only so the user can load a tokens file from a URL.
 * The hosted build will add the usability-recorder domains in milestone 8;
 * the strict build never will.
 */
/**
 * Which build a page is: the commit (with "+changes" when the working tree
 * had uncommitted edits) and the build time. Shown in the page source and the
 * console, so a hosted copy can be told apart from a newer local one.
 */
function buildStamp(): string {
  const git = (cmd: string) => {
    try {
      return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      return '';
    }
  };
  const commit = git('git rev-parse --short HEAD') || 'unknown';
  const dirty = git('git status --porcelain --untracked-files=no -- src index.html') ? '+changes' : '';
  return `${commit}${dirty} ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

function csp(strict: boolean, stamp: string): Plugin {
  const policy = [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    'font-src data:',
    'img-src data: blob:',
    'connect-src https: http://localhost:* http://127.0.0.1:*',
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  return {
    name: 'tt-csp',
    apply: 'build',
    transformIndexHtml(html) {
      const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
      const label = `<meta name="tt-build" content="${strict ? 'strict' : 'hosted'}">`;
      const version = `<meta name="tt-version" content="${stamp}">`;
      return html.replace('<!-- tt:csp -->', `${meta}\n    ${label}\n    ${version}`);
    },
  };
}

export default defineConfig(({ mode }) => {
  const strict = mode === 'strict';
  const stamp = buildStamp();
  return {
    base: './',
    define: { __STRICT__: JSON.stringify(strict), __VERSION__: JSON.stringify(stamp) },
    plugins: [csp(strict, stamp), viteSingleFile()],
    build: {
      outDir: strict ? 'dist-strict' : 'dist',
      target: 'es2022',
    },
    test: {
      include: ['tests/**/*.test.ts'],
      environment: 'node',
    },
  };
});
