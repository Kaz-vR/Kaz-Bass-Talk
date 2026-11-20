// DEV ONLY: renders the whole trailer from its timeline (tools/trailer/timeline.json), in one of two modes that share
// the same timeline, shots, moves and text:
//   node tools/trailer-cut.mjs rough [out]   the previs: 640 x 360, 15 fps, flat and unlit, no effects (a few minutes)
//   node tools/trailer-cut.mjs final [out]   the full look: 1920 x 1080, 25 fps (hours)
// Each shot keeps its own clock (25 fps), so a shot moves the same in both modes; the frame rate only samples it.
// Writes <out>/cut.mp4 (H.264; with the guide track tools/trailer-music.ts made, if <out>/../track.wav exists).
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, mkdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { extname, join, normalize } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT ?? 'playwright');
const [MODE = 'rough', OUT = `renders/trailer/cut-${MODE}`] = process.argv.slice(2);
const TL = JSON.parse(readFileSync(process.env.TL ?? 'tools/trailer/timeline.json', 'utf8'));   // TL=<file>: another timeline (e.g. a set of options)
const rough = MODE === 'rough', FPS = rough ? 15 : 25, WW = rough ? 640 : 1920, HH = WW * 9 / 16, beat = 60 / TL.bpm;
const exe = process.env.CHROMIUM ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2' };
const server = createServer(async (q, s) => {
  try { const f = join(process.cwd(), normalize(decodeURIComponent(q.url.split('?')[0]))); const body = await readFile(f);
    s.writeHead(200, { 'content-type': TYPES[extname(f)] ?? 'application/octet-stream' }); s.end(body); }
  catch { s.writeHead(404); s.end(); }
}).listen(4186);
const dir = join(OUT, 'frames'); await rm(dir, { recursive: true, force: true }); await mkdir(dir, { recursive: true });
const b = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: WW, height: HH }, deviceScaleFactor: 1 });
p.setDefaultTimeout(0);
p.on('pageerror', (e) => console.log('page error:', e.message));
await p.goto(`http://localhost:4186/tools/trailer/render.html?w=${WW}`);
await p.waitForFunction(() => window.ready, null, { timeout: 120000 });
const t0 = Date.now(); let n = 0, tAt = 0;                          // n: frames written; tAt: the edit's clock (s)
for (const e of TL.shots) {
  const len = e.beats * beat, frames = Math.round((tAt + len) * FPS) - Math.round(tAt * FPS);
  const look = rough ? 'rough=1' : (TL.looks[e.look] ?? '');
  const name = e.shot === 'black' ? 'slide@ruin:rough=1' : `${e.shot}@ruin:${[look, e.opts].filter(Boolean).join(',')}`;
  await p.evaluate((s) => window.setup(s), name);
  for (let k = 0; k < frames; k++) {
    const tl = k / FPS, fi = e.fadeIn ? Math.min(1, tl / (e.fadeIn * beat)) : 1, fo = e.fadeOut ? Math.min(1, (len - tl) / (e.fadeOut * beat)) : 1;
    const fade = e.shot === 'black' ? 0 : Math.min(fi, fo);
    if (fade > 0) await p.evaluate(([i, f]) => { window.setFade(f); return window.frame(i); }, [tl * 25, fade]);
    else await p.evaluate(() => window.setFade(0));
    await p.screenshot({ path: join(dir, `${String(n++).padStart(5, '0')}.jpg`), type: 'jpeg', quality: rough ? 80 : 95 });
  }
  tAt += len; console.log(`${e.shot.padEnd(9)} ${e.beats} beats  ${(tAt).toFixed(2)} s  (${((Date.now() - t0) / 1000).toFixed(0)} s so far)`);
}
await b.close(); server.close();
const track = join(OUT, '..', 'track.wav'), mp4 = join(OUT, 'cut.mp4');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(dir, '%05d.jpg'), ...(existsSync(track) && !process.env.NOAUDIO ? ['-i', track, '-c:a', 'aac', '-b:a', '160k', '-shortest'] : []),
  '-c:v', 'libx264', '-preset', rough ? 'veryfast' : 'slow', '-crf', rough ? '24' : '14', '-pix_fmt', 'yuv420p', mp4]);
console.log(`${n} frames, ${tAt.toFixed(2)} s, rendered in ${((Date.now() - t0) / 1000).toFixed(0)} s -> ${mp4}`);
