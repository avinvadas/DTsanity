// npm run serve [-- <folder>] [--port <n>]
//
// Serves a built DTsanity page (dist-strict/ by default, or dist/) on this machine only, at
// http://127.0.0.1:<port>. A page opened from disk (file://) can't read dropped folders in
// some browsers (Brave, for one); served like this, folder drops work and nothing leaves the
// machine. No dependencies; it only reads files from the folder and answers local requests.
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';

const args = process.argv.slice(2);
const portAt = args.indexOf('--port');
const port = portAt >= 0 ? Number(args[portAt + 1]) : 4173;
const root = resolve(args.find((a, i) => !a.startsWith('--') && (portAt < 0 || i !== portAt + 1)) ?? 'dist-strict');

if (!existsSync(join(root, 'index.html'))) {
  console.error(`No index.html in ${root}. Build it first: npm run build:strict (or npm run build).`);
  process.exit(1);
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json', '.js': 'text/javascript', '.css': 'text/css' };

createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? '/', 'http://127.0.0.1').pathname);
  let file = normalize(join(root, path));
  // Only files inside the folder.
  if (file !== root && !file.startsWith(root + sep)) return res.writeHead(403).end();
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(readFileSync(file));
})
  .listen(port, '127.0.0.1', () => console.log(`DTsanity at http://127.0.0.1:${port} (from ${root}, this machine only). Ctrl+C to stop.`))
  .on('error', (err) => {
    console.error(err.code === 'EADDRINUSE' ? `Port ${port} is in use. Try: npm run serve -- --port ${port + 1}` : err.message);
    process.exit(1);
  });
