// DEV ONLY: renders the lava-rock texture (mockups/texture/lava-rock.html, all procedural) at the website's width and full
// page height, as the site's background: website/assets/bg-rock.jpg.
//   node tools/site-texture.mjs [width] [height] [seed]
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT ?? 'playwright');
const [w = 1440, h = 3600, seed = 7] = process.argv.slice(2).map(Number);
const exe = process.env.CHROMIUM ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const b = await chromium.launch(exe ? { executablePath: exe } : {});
const p = await b.newPage({ viewport: { width: w, height: h } });
await p.goto(`file://${resolve('mockups/texture/lava-rock.html')}?w=${w}&h=${h}&seed=${seed}`);
await p.waitForFunction(() => document.title === 'done', null, { timeout: 300000 });
await p.screenshot({ path: 'website/assets/bg-rock.jpg', type: 'jpeg', quality: 82, clip: { x: 0, y: 0, width: w, height: h } });
await b.close();
console.log(`wrote website/assets/bg-rock.jpg (${w} x ${h})`);
