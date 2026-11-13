// DEV ONLY: renders trailer test shots (tools/trailer/shots.js) frame by frame in headless Chromium, then encodes
// each to an MP4 (25 fps) and a GIF (960 wide) with ffmpeg.
//   node tools/trailer-render.mjs [out_dir] [shot,shot,...] [width, default 1280]      (run tools/trailer-capture.mjs first)
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, mkdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { extname, join, normalize } from 'node:path';
import { existsSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT ?? 'playwright');
const [OUT = 'renders/trailer/shots', LIST = 'slide,knob,card', WIDTH = '1280'] = process.argv.slice(2);
const WW = Number(WIDTH), HH = Math.round(WW * 9 / 16);
const exe = process.env.CHROMIUM ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2' };
const server = createServer(async (q, s) => {
  try { const f = join(process.cwd(), normalize(decodeURIComponent(q.url.split('?')[0]))); const body = await readFile(f);
    s.writeHead(200, { 'content-type': TYPES[extname(f)] ?? 'application/octet-stream' }); s.end(body); }
  catch { s.writeHead(404); s.end(); }
}).listen(4185);
await mkdir(OUT, { recursive: true });
const b = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: WW, height: HH }, deviceScaleFactor: 1 });
p.on('console', (m) => m.type() === 'error' && console.log('page:', m.text()));
p.on('pageerror', (e) => console.log('page error:', e.message));
await p.goto(`http://localhost:4185/tools/trailer/render.html?w=${WW}`);
await p.waitForFunction(() => window.ready, null, { timeout: 120000 });
for (const name of LIST.split(',')) {
  const dir = join(OUT, name.replace('@', '-')); await rm(dir, { recursive: true, force: true }); await mkdir(dir, { recursive: true });
  const n = await p.evaluate((s) => window.setup(s), name);
  const t0 = Date.now();
  const idx = process.env.PICK ? process.env.PICK.split(',').map((x) => Math.min(n - 1, Number(x))) : process.env.SAMPLE ? [0, Math.floor(n / 2), n - 1] : [...Array(n).keys()];   // SAMPLE=1: three stills; PICK=frames
  for (const i of idx) {
    await p.evaluate((k) => window.frame(k), i);
    await p.screenshot({ path: join(dir, `${String(i).padStart(4, '0')}.png`) });
  }
  if (process.env.SAMPLE || process.env.PICK) { console.log(`${name}: sampled ${idx}`); continue; }
  console.log(`${name}: ${n} frames in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '25', '-i', join(dir, '%04d.png'), '-c:v', 'libx264', '-crf', '14', '-pix_fmt', 'yuv420p', join(OUT, `${name}.mp4`)]);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '25', '-i', join(dir, '%04d.png'), '-vf',
    'fps=25,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=256:stats_mode=full[p];[b][p]paletteuse=dither=sierra2_4a', join(OUT, `${name}.gif`)]);
}
await b.close(); server.close();
