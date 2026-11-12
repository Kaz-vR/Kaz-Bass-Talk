// DEV ONLY: captures the synth for trailer shots (tools/trailer-render.mjs): the whole instrument at 4x, and one
// knob turning, one picture per video frame, so the 3D shots show the real, moving UI.
//   node tools/trailer-capture.mjs <out_dir> [sound] [tab] [knob label] [frames]
// Writes <out>/base.png (the instrument, wood to wood), <out>/knob/NNN.png (the knob's box per frame) and <out>/meta.json.
import { spawn, execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT ?? 'playwright');
const [OUT = 'renders/trailer/capture', SOUND = 'Cavern', TAB = 'OSC', KNOB = 'Cutoff', FRAMES = '100'] = process.argv.slice(2);
const PORT = 4183, DSF = 4;
const exe = process.env.CHROMIUM ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
mkdirSync(`${OUT}/knob`, { recursive: true });

if (!process.env.NOBUILD) execSync('npx vite build', { stdio: 'inherit' });
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
try {
  for (let i = 0; i < 50; i++) {
    try { await fetch(`http://localhost:${PORT}/`); break; } catch { await new Promise((r) => setTimeout(r, 200)); }
  }
  const b = await chromium.launch(exe ? { executablePath: exe } : {});
  const p = await b.newPage({ viewport: { width: 1500, height: 900 }, deviceScaleFactor: DSF });
  await p.goto(`http://localhost:${PORT}/`);
  await p.click('#start button').catch(() => {});
  await p.waitForTimeout(700);
  await p.getByText('PRESETS', { exact: true }).first().click();
  await p.waitForTimeout(400);
  const item = p.locator('.preset-page').getByText(SOUND, { exact: true }).first();
  await item.scrollIntoViewIfNeeded(); await item.click();
  await p.waitForTimeout(300);
  await p.locator('.v2-top-right').getByText(TAB, { exact: true }).click();
  await p.waitForTimeout(500);
  await p.keyboard.down('a');                                   // a held note: envelopes, LFOs and scopes are alive
  await p.waitForTimeout(1500);
  const l = await p.locator('.wood-l').boundingBox(), r = await p.locator('.wood-r').boundingBox();
  const clip = { x: Math.floor(l.x), y: Math.floor(l.y), width: Math.ceil(r.x + r.width - l.x), height: Math.ceil(l.height) };
  await p.screenshot({ path: `${OUT}/base.png`, clip });
  // the knob: its patch (dial, label and value) relative to the instrument, in css px
  const k = p.locator('.k').filter({ has: p.locator('.k-label', { hasText: new RegExp(`^${KNOB}$`) }) }).first();
  // the patch is the knob's whole box, so its display (e.g. the filter curve) moves with the knob
  const kb = await k.evaluate((el) => { let e = el; while (e.parentElement && (e.getBoundingClientRect().width < 250 || e.getBoundingClientRect().height < 150)) e = e.parentElement; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
  const patch = { x: Math.floor(kb.x), y: Math.floor(kb.y), width: Math.ceil(kb.width), height: Math.ceil(kb.height) };
  const cv = await k.locator('canvas').boundingBox();
  const cx = cv.x + cv.width / 2, cy = cv.y + cv.height / 2;
  // turn it: down, then a slow sweep down and back up (a dark close then an opening), one picture per step
  await p.mouse.move(cx, cy); await p.mouse.down();
  const n = Number(FRAMES);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), y = cy + 40 * Math.sin(Math.PI * t) - 30 * t;        // ease out and back, ending a bit higher
    await p.mouse.move(cx, y);
    await p.waitForTimeout(40);
    await p.screenshot({ path: `${OUT}/knob/${String(i).padStart(3, '0')}.png`, clip: patch });
  }
  await p.mouse.up();
  await p.keyboard.up('a');
  const rel = { x: patch.x - clip.x, y: patch.y - clip.y, w: patch.width, h: patch.height, cx: cx - clip.x, cy: cy - clip.y };
  writeFileSync(`${OUT}/meta.json`, JSON.stringify({ sound: SOUND, tab: TAB, knob: KNOB, dsf: DSF, W: clip.width, H: clip.height,
    woodL: [0, Math.round(l.width)], woodR: [Math.round(r.x - clip.x), Math.round(r.width)], patch: rel, frames: n }, null, 1));
  await b.close();
  console.log('captured', clip.width, 'x', clip.height, 'css px at', DSF, 'x; knob patch', rel);
} finally {
  server.kill();
}
