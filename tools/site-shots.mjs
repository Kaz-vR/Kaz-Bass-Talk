// DEV ONLY: the website's product images, taken from the synth itself, so the site always shows the synth as it is now.
//   node tools/site-shots.mjs            (builds the synth, serves it, writes website/assets/shots/*.jpg)
// Needs Playwright with a Chromium (preinstalled in the dev container; elsewhere set CHROMIUM=<path>).
import { spawn, execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT ?? 'playwright');
const PORT = 4179, OUT = 'website/assets/shots';
const exe = process.env.CHROMIUM ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

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
  // the opening shelf's second sound (Destroyed Reese), a note held so every print is alive
  await p.click('.pre-step >> nth=1');
  await p.waitForTimeout(300);
  await p.keyboard.down('a');
  await p.waitForTimeout(1500);
  // the whole instrument as it looks: the page and its wooden side panels (the owner's images), nothing around them
  const l = await p.locator('.wood-l').boundingBox(), r = await p.locator('.wood-r').boundingBox();
  const clip = { x: Math.floor(l.x), y: Math.floor(l.y), width: Math.ceil(r.x + r.width - l.x), height: Math.ceil(l.height) };
  await p.screenshot({ path: `${OUT}/osc.jpg`, clip, type: 'jpeg', quality: 86 });
  await p.getByText('RUIN', { exact: true }).first().click();
  await p.waitForTimeout(1200);
  await p.screenshot({ path: `${OUT}/ruin.jpg`, clip, type: 'jpeg', quality: 86 });
  await p.keyboard.up('a');
  await b.close();
  console.log(`wrote ${OUT}/osc.jpg and ${OUT}/ruin.jpg`);
} finally {
  server.kill();
}
