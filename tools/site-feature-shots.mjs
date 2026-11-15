// DEV ONLY: the features strip's pictures, one per page, shot the way the header's synth is (tools/site-shots.mjs):
// at 2x, the page with its wooden sides, a note held so every display is alive. The strip draws each as the same 3D
// box as the header (website/hero3d.js). Same sounds per page as the old clips (tools/site-pages.mjs).
//   node tools/site-feature-shots.mjs     (builds the synth, serves it, writes website/assets/shots/pages/<page>.jpg)
import { spawn, execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT ?? 'playwright');
const PORT = 4181, OUT = 'website/assets/shots/pages';
const exe = process.env.CHROMIUM ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const PAGES = [['osc', 'OSC', 'Cavern'], ['lfo', 'LFO', 'Iron Wobble'], ['wobbler', 'WOBBLER', 'Iron Wobble'], ['ruin', 'RUIN', 'Destroyed Reese'], ['fx', 'FX', 'Cavern'], ['presets', 'PRESETS', 'Destroyed Reese']];

mkdirSync(OUT, { recursive: true });
if (!process.env.NOBUILD) execSync('npx vite build', { stdio: 'inherit' });
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
  for (const [key, tab, sound] of PAGES) {
    await p.keyboard.up('a');
    await p.getByText('PRESETS', { exact: true }).first().click();
    await p.waitForTimeout(400);
    const item = p.locator('.preset-page').getByText(sound, { exact: true }).first();
    await item.scrollIntoViewIfNeeded();
    await item.click();
    await p.waitForTimeout(300);
    await p.locator('.v2-top-right').getByText(tab, { exact: true }).click();
    await p.waitForTimeout(400);
    await p.keyboard.down('a');
    await p.waitForTimeout(1500);
    const l = await p.locator('.wood-l').boundingBox(), r = await p.locator('.wood-r').boundingBox();
    const clip = { x: Math.floor(l.x), y: Math.floor(l.y), width: Math.ceil(r.x + r.width - l.x), height: Math.ceil(l.height) };
    await p.screenshot({ path: `${OUT}/${key}.jpg`, clip, type: 'jpeg', quality: 86 });
    console.log(`wrote ${OUT}/${key}.jpg`);
  }
  await p.keyboard.up('a');
  await b.close();
} finally {
  server.kill();
}
