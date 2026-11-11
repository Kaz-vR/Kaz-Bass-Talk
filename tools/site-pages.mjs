// DEV ONLY: the website's moving page clips (the "Every page, moving" strip), recorded from the synth itself.
//   node tools/site-pages.mjs        (builds the synth, serves it, writes website/assets/pages/<page>.mp4 + .jpg)
// Each clip: the page above the play bar, notes played on a rhythm so envelopes, LFOs and RUIN move, a seamless
// loop (the end fades into the start), H.264 so every browser plays it like a GIF (muted, autoplay, loop).
// Needs Playwright with a Chromium and ffmpeg with libx264.
import { spawn, execSync, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT ?? 'playwright');
const PORT = 4181, OUT = 'website/assets/pages', SECONDS = 7, FADE = 0.8, WIDTH = 1600;
const exe = process.env.CHROMIUM ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
// page tab → the sound it is shown with (one that uses that page, so it moves)
const PAGES = [['osc', 'OSC', 'Cavern'], ['lfo', 'LFO', 'Iron Wobble'], ['wobbler', 'WOBBLER', 'Iron Wobble'], ['ruin', 'RUIN', 'Destroyed Reese'], ['fx', 'FX', 'Cavern'], ['presets', 'PRESETS', 'Destroyed Reese']];

mkdirSync(OUT, { recursive: true });
execSync('npx vite build', { stdio: 'inherit' });
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
try {
  for (let i = 0; i < 50; i++) {
    try { await fetch(`http://localhost:${PORT}/`); break; } catch { await new Promise((r) => setTimeout(r, 200)); }
  }
  const b = await chromium.launch(exe ? { executablePath: exe } : {});
  const p = await b.newPage({ viewport: { width: 1500, height: 900 }, deviceScaleFactor: 2 });
  await p.goto(`http://localhost:${PORT}/`);
  await p.click('#start button').catch(() => {});
  await p.waitForTimeout(700);
  const cdp = await p.context().newCDPSession(p);
  for (const [key, tab, sound] of PAGES) {
    await p.keyboard.up('a');
    await p.getByText('PRESETS', { exact: true }).first().click();
    await p.waitForTimeout(400);
    const item = p.locator('.preset-page').getByText(sound, { exact: true }).first();
    await item.scrollIntoViewIfNeeded();
    await item.click();
    await p.waitForTimeout(300);
    await p.locator('.v2-top-right').getByText(tab, { exact: true }).click();
    await p.waitForTimeout(500);
    // the page above the play bar, in device pixels
    const v2 = await p.locator('.v2').boundingBox(), bot = await p.locator('.v2-bottom').boundingBox();
    const box = { x: v2.x, y: v2.y, w: v2.width, h: bot.y - v2.y - 4 };
    // record frames with their own timestamps (screencast), playing notes on a rhythm meanwhile
    const dir = mkdtempSync(join(tmpdir(), 'pages-'));
    const frames = [];
    const onFrame = async ({ data, metadata, sessionId }) => {
      const f = join(dir, `${String(frames.length).padStart(5, '0')}.jpg`);
      writeFileSync(f, Buffer.from(data, 'base64'));
      frames.push([f, metadata.timestamp]);
      await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    };
    cdp.on('Page.screencastFrame', onFrame);
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 3000, maxHeight: 1800, everyNthFrame: 1 });
    const t0 = Date.now();
    while (Date.now() - t0 < (SECONDS + 0.6) * 1000) {
      await p.keyboard.down('a');
      await p.waitForTimeout(1500);
      await p.keyboard.up('a');
      await p.waitForTimeout(250);
    }
    await cdp.send('Page.stopScreencast');
    cdp.off('Page.screencastFrame', onFrame);
    // the frames' own scale (the screencast picks it), from the first frame's size against the 1500 px viewport
    const fw = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width', '-of', 'csv=p=0', frames[0][0]]).toString().trim());
    const k = fw / 1500, crop = { x: Math.round(box.x * k), y: Math.round(box.y * k), w: Math.round(box.w * k) & ~1, h: Math.round(box.h * k) & ~1 };
    // frames → a clip at their real timing (concat with durations), cropped and scaled
    let list = '';
    for (let i = 0; i < frames.length - 1; i++) list += `file '${frames[i][0]}'\nduration ${(frames[i + 1][1] - frames[i][1]).toFixed(4)}\n`;
    list += `file '${frames[frames.length - 1][0]}'\n`;
    writeFileSync(join(dir, 'list.txt'), list);
    const raw = join(dir, 'raw.mp4');
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(dir, 'list.txt'),
      '-vf', `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y},scale=${WIDTH}:-2:flags=lanczos,fps=30`, '-c:v', 'libx264', '-crf', '14', '-pix_fmt', 'yuv420p', raw]);
    // a seamless loop: the clip's last FADE seconds fade into its first
    const len = SECONDS;
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-filter_complex',
      `[0]trim=0:${len + 0.5},setpts=PTS-STARTPTS,split[a][b];[a]trim=${FADE}:${len},setpts=PTS-STARTPTS[main];[b]trim=0:${FADE},setpts=PTS-STARTPTS[head];[main][head]xfade=transition=fade:duration=${FADE}:offset=${len - 2 * FADE}[v]`,
      '-map', '[v]', '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', join(OUT, `${key}.mp4`)]);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', join(OUT, `${key}.mp4`), '-frames:v', '1', '-q:v', '3', join(OUT, `${key}.jpg`)]);
    rmSync(dir, { recursive: true, force: true });
    console.log(`${key}: ${frames.length} frames`);
  }
  await p.keyboard.up('a');
  await b.close();
  console.log(`wrote ${OUT}/*.mp4 and *.jpg`);
} finally {
  server.kill();
}
