// DEV ONLY: our own reference library of software and synth UIs (owner's call: the software twin of references/).
//   node tools/ui-references.mjs [slug,slug]   → references-ui/<slug>/raw/  (page screens + the page's largest images)
// For each app: open the maker's official product page, take the first screen, scroll through it, and download the
// biggest images on it (that is where the UI screenshots are). Claude then looks at every candidate and keeps the ones
// that show the interface (`keep` in references-ui/picks.json); `node tools/ui-references-index.mjs` builds the rest.
// We study these UIs; never copy a maker's branding, art or layout one to one. Never shipped, never imported at runtime.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT ?? 'playwright');
const ROOT = 'references-ui', APPS = JSON.parse(readFileSync(join(ROOT, 'apps.json'), 'utf8'));
const only = process.argv[2], CONCURRENCY = 4, MAX_IMAGES = 10, SCREENS = 5;

const CONSENT = /^(accept( all)?( cookies)?|allow( all)?( cookies)?|i accept( cookies)?|i agree|agree( and close)?|ok(ay)?|got it|accept all cookies|accept & close|alle akzeptieren|tout accepter)$/i;
const dismiss = async (p) => {
  // click the consent button if there is one (buttons and links, any case)
  // also inside shadow roots (consent tools often live there), then Escape for newsletter and region pop-ups
  await p.evaluate((src) => {
    const re = new RegExp(src, 'i');
    const all = (root) => { const out = []; for (const e of root.querySelectorAll('*')) { out.push(e); if (e.shadowRoot) out.push(...all(e.shadowRoot)); } return out; };
    const el = all(document).find((e) => /^(BUTTON|A|INPUT)$/.test(e.tagName) || e.getAttribute?.('role') === 'button' ? re.test((e.textContent || e.value || '').trim()) && e.getBoundingClientRect().width > 0 : false);
    el?.click();
  }, CONSENT.source).catch(() => {});
  await p.keyboard.press('Escape').catch(() => {});
  // consent tools in their own frames
  for (const f of p.frames()) {
    if (f === p.mainFrame()) continue;
    await f.evaluate((src) => { const re = new RegExp(src, 'i'); [...document.querySelectorAll('button, a, [role="button"]')].find((e) => re.test((e.textContent || '').trim()))?.click(); }, CONSENT.source).catch(() => {});
  }
  await p.waitForTimeout(600);
  // then hide whatever consent layer is left: the common consent tools, and fixed boxes that talk about cookies
  await p.addStyleTag({ content: 'html,body{filter:none!important;overflow:auto!important} [style*="blur"]{filter:none!important} iframe[src*="consent" i],iframe[title*="consent" i],iframe[src*="cookie" i]{display:none!important} #onetrust-consent-sdk,#onetrust-banner-sdk,#CybotCookiebotDialog,#CybotCookiebotDialogBodyUnderlay,#usercentrics-root,#didomi-host,.cc-window,.cookie-banner,#cookie-banner,[aria-label*="cookie" i],[id*="cookie-consent" i],[class*="cookie-consent" i],[id*="cookiebanner" i],[class*="CookieBanner"],#truste-consent-track,.osano-cm-window,#qc-cmp2-container{display:none!important}' }).catch(() => {});
  await p.evaluate(() => {
    for (const e of document.querySelectorAll('body *')) {
      const c = getComputedStyle(e);
      const floating = c.position === 'fixed' || c.position === 'sticky' || (c.position === 'absolute' && (parseInt(c.zIndex, 10) || 0) > 50);
      if (c.backdropFilter && c.backdropFilter !== 'none' && floating) e.style.setProperty('backdrop-filter', 'none', 'important');
      if (floating && /cookie|consent|privacy settings|we value your privacy|newsletter|store locator|you're in|country redirect|personalised experiences/i.test(e.textContent || '') && (e.textContent || '').length < 3000) e.style.setProperty('display', 'none', 'important');
    }
    document.documentElement.style.overflow = ''; document.body.style.overflow = '';
  }).catch(() => {});
};

const webp = (src, dst, width) => {
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-vf', `scale='min(${width},iw)':-2:flags=lanczos`, '-frames:v', '1', '-c:v', 'libwebp', '-quality', '72', dst]);
  rmSync(src);
};
// every large image on the page: <img> (the biggest srcset entry), <picture> sources, video posters, CSS backgrounds
const IMAGES = () => {
  const out = new Map();
  const add = (url, w, h, alt) => { if (!url || url.startsWith('data:') || /\.svg(\?|$)/i.test(url)) return; const u = new URL(url, location.href).href; const o = out.get(u); if (!o || w * h > o.w * o.h) out.set(u, { url: u, w, h, alt }); };
  const best = (srcset) => (srcset || '').split(',').map((s) => s.trim().split(/\s+/)).filter((p) => p[0]).map(([u, d]) => [u, parseFloat(d) || 1]).sort((a, b) => b[1] - a[1])[0]?.[0];
  for (const i of document.images) { const r = i.getBoundingClientRect(); add(best(i.srcset) || i.currentSrc || i.src, i.naturalWidth || r.width, i.naturalHeight || r.height, i.alt || ''); }
  for (const s of document.querySelectorAll('picture source')) { const im = s.parentElement.querySelector('img'); add(best(s.srcset), im?.naturalWidth || 1200, im?.naturalHeight || 700, im?.alt || ''); }
  for (const v of document.querySelectorAll('video[poster]')) add(v.poster, v.videoWidth || 1600, v.videoHeight || 900, 'video poster');
  for (const e of document.querySelectorAll('body *')) { const r = e.getBoundingClientRect(); if (r.width < 500 || r.height < 280) continue; const m = getComputedStyle(e).backgroundImage.match(/url\(["']?([^"')]+)/); if (m) add(m[1], r.width * 1.5, r.height * 1.5, 'background'); }
  // full-size versions behind lightbox links
  for (const a of document.querySelectorAll('a[href]')) if (/\.(jpe?g|png|webp|avif)(\?|$)/i.test(a.href)) { const im = a.querySelector('img'); add(a.href, Math.max(1400, (im?.naturalWidth || 0) * 2), Math.max(800, (im?.naturalHeight || 0) * 2), (im?.alt || 'link') + ' (full size)'); }
  return [...out.values()].filter((i) => i.w >= 600 && i.h >= 300 && i.w / i.h < 4 && i.h / i.w < 2.2).sort((a, b) => b.w * b.h - a.w * a.h);
};

const shoot = async (b, app) => {
  const dir = join(ROOT, app.slug), raw = join(dir, 'raw');
  rmSync(raw, { recursive: true, force: true }); mkdirSync(raw, { recursive: true });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' });
  const p = await ctx.newPage(), got = { url: app.url, screens: 0, images: [] }, seen = new Map();
  p.on('response', async (r) => { try { if (/^image\//.test(r.headers()['content-type'] || '') && !/svg/.test(r.headers()['content-type'])) seen.set(r.url(), await r.body()); } catch {} });
  try {
    await p.goto(app.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await p.waitForTimeout(5000); await dismiss(p); await p.waitForTimeout(600);
    // screens down the page (product pages show the UI a few screens in), loading lazy images on the way
    const h = await p.evaluate(() => document.documentElement.scrollHeight);
    const step = Math.max(900, Math.floor(Math.min(h, 14000) / SCREENS));
    for (let i = 0, y = 0; i < SCREENS && y < h; i++, y += step) {
      await p.evaluate((y) => scrollTo(0, y), y); await p.waitForTimeout(1400);
      if (i === 0) await dismiss(p);
      await p.screenshot({ path: join(raw, `screen-${i}.png`), timeout: 20000 }); webp(join(raw, `screen-${i}.png`), join(raw, `screen-${i}.webp`), 1440); got.screens++;
    }
    for (let y = 0; y < Math.min(h, 14000); y += 700) { await p.evaluate((y) => scrollTo(0, y), y); await p.waitForTimeout(120); }
    const imgs = (await p.evaluate(IMAGES)).slice(0, MAX_IMAGES * 2);
    for (const im of imgs) {
      if (got.images.length >= MAX_IMAGES) break;
      try {
        // through the browser (it has the network proxy): what it already loaded, else open the image itself
        let buf = seen.get(im.url);
        if (!buf) { const q = await ctx.newPage(); try { const r = await q.goto(im.url, { timeout: 25000 }); if (r?.ok()) buf = await r.body(); } catch {} await q.close(); }
        if (!buf || buf.length < 25000) continue;
        const n = got.images.length, tmp = join(raw, `img-${n}.bin`); writeFileSync(tmp, buf);
        try { webp(tmp, join(raw, `img-${n}.webp`), 1800); } catch { rmSync(tmp, { force: true }); continue; }
        got.images.push({ file: `img-${n}.webp`, url: im.url, alt: im.alt.slice(0, 120) });
      } catch {}
    }
  } catch (e) { got.error = e.message.split('\n')[0]; }
  await ctx.close();
  writeFileSync(join(raw, 'sources.json'), JSON.stringify(got, null, 1));
  return got;
};

const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const queue = APPS.filter((a) => !only || only.split(',').some((o) => a.slug.includes(o)));
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (queue.length) {
    const a = queue.shift(); const r = await shoot(b, a).catch((e) => ({ error: e.message, screens: 0, images: [] }));
    console.log(a.slug.padEnd(26), `screens ${r.screens}  images ${r.images.length}`, r.error ? `ERROR ${r.error}` : '');
  }
}));
await b.close();
