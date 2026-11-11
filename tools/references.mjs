// DEV ONLY: our own reference library of top-tier websites (owner's call: like UXKIN, but hand-picked for RUIN-1).
//   node tools/references.mjs [slug-filter]     → references/<slug>/{desktop,desktop-full,phone,phone-full}.webp + tokens.json
// For each site: dismiss cookie banners, take the first screen and the whole page on desktop (1440) and phone (390),
// and measure the design from the page itself (fonts, type sizes, tracking, colours, buttons, section spacing).
// The list and its tags live in references/sites.json. We study these sites; we never copy their branding or content.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT ?? 'playwright');
const ROOT = 'references', SITES = JSON.parse(readFileSync(join(ROOT, 'sites.json'), 'utf8'));
const only = process.argv[2], CONCURRENCY = 4, MAX_FULL = 9000;

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
// load lazy content by scrolling through, then back to the top
const settle = async (p) => {
  const h = await p.evaluate(() => document.documentElement.scrollHeight).catch(() => 0);
  for (let y = 0; y < Math.min(h, MAX_FULL); y += 700) { await p.evaluate((y) => scrollTo(0, y), y).catch(() => {}); await p.waitForTimeout(140); }
  await p.evaluate(() => scrollTo(0, 0)).catch(() => {});
  await p.waitForTimeout(900);
};
const webp = (src, dst, width) => {
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-vf', `scale=${width}:-2:flags=lanczos`, '-c:v', 'libwebp', '-quality', '62', dst]);
  rmSync(src);
};
// measured in the page: what a designer would note down
const MEASURE = () => {
  const cs = (e) => getComputedStyle(e);
  const first = (s) => [...document.querySelectorAll(s)].find((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (e.textContent || '').trim(); });
  const fam = (f) => f.split(',')[0].replace(/["']/g, '').trim();
  const rgb = (c) => (c.match(/[\d.]+/g) || []).map(Number);
  const lum = (c) => { const [r, g, b] = rgb(c); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };
  const type = (s) => { const e = first(s); if (!e) return null; const c = cs(e); return { font: fam(c.fontFamily), size: Math.round(parseFloat(c.fontSize)), weight: c.fontWeight, tracking: c.letterSpacing, case: c.textTransform, lineHeight: c.lineHeight, color: c.color, sample: e.textContent.trim().replace(/\s+/g, ' ').slice(0, 60) }; };
  // the page's background: the first opaque background from the body up through the first big blocks
  let bg = 'rgb(255, 255, 255)';
  for (const e of [document.body, document.documentElement, ...document.querySelectorAll('main, section, div')].slice(0, 60)) { const c = cs(e).backgroundColor; if (c && !c.includes(', 0)') && c !== 'transparent') { bg = c; break; } }
  // colours by how much area uses them (text and backgrounds), to find the palette and the accent
  const area = {};
  for (const e of [...document.querySelectorAll('body *')].slice(0, 4000)) {
    const r = e.getBoundingClientRect(); if (r.width * r.height < 40) continue;
    const c = cs(e);
    for (const [col, w] of [[c.color, Math.min(r.width * r.height, 20000) * 0.1], [c.backgroundColor, r.width * r.height]]) {
      if (!col || col.includes(', 0)') || col === 'transparent') continue; area[col] = (area[col] || 0) + w;
    }
  }
  const palette = Object.entries(area).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([c]) => c);
  const sat = (c) => { const [r, g, b] = rgb(c); const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx ? (mx - mn) / mx : 0; };
  const accent = palette.find((c) => sat(c) > 0.35) || null;
  // buttons: the first few visible links/buttons that look like buttons
  const buttons = [...document.querySelectorAll('a, button')].filter((e) => { const c = cs(e), r = e.getBoundingClientRect(); return r.width > 50 && r.height > 28 && r.height < 90 && (c.borderStyle !== 'none' || !c.backgroundColor.includes(', 0)')) && (e.textContent || '').trim(); }).slice(0, 4)
    .map((e) => { const c = cs(e); return { text: e.textContent.trim().replace(/\s+/g, ' ').slice(0, 30), radius: c.borderRadius, height: Math.round(e.getBoundingClientRect().height), bg: c.backgroundColor, border: c.borderStyle !== 'none' ? `${c.borderWidth} ${c.borderColor}` : null, font: `${Math.round(parseFloat(c.fontSize))}px ${c.fontWeight} ${c.textTransform}` }; });
  // section rhythm: the vertical padding of the large blocks
  const pads = [...document.querySelectorAll('section, main > div, [class*="section"]')].map((e) => parseFloat(cs(e).paddingTop) + parseFloat(cs(e).paddingBottom)).filter((v) => v > 0).sort((a, b) => a - b);
  const fonts = [...new Set([...document.querySelectorAll('h1,h2,h3,p,a,button,li,span')].slice(0, 600).map((e) => fam(cs(e).fontFamily)))].slice(0, 6);
  return {
    title: document.title, dark: lum(bg) < 0.35, background: bg, palette, accent, fonts,
    h1: type('h1') || type('h2'), h2: type('h2'), body: type('p'), nav: type('nav a, header a'), buttons,
    sectionPaddingMedian: pads.length ? pads[Math.floor(pads.length / 2)] : null,
    pageHeight: document.documentElement.scrollHeight,
  };
};

const shoot = async (b, site) => {
  const dir = join(ROOT, site.slug); mkdirSync(dir, { recursive: true });
  const out = { url: site.url };
  for (const [kind, vp] of [['desktop', { width: 1440, height: 900, deviceScaleFactor: 1 }], ['phone', { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }]]) {
    const ctx = await b.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.deviceScaleFactor, isMobile: vp.isMobile, hasTouch: vp.hasTouch, locale: 'en-US',
      userAgent: kind === 'phone' ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' });
    const p = await ctx.newPage();
    try {
      await p.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await p.waitForTimeout(site.tags.includes('studio') || site.tags.includes('motion') ? 9000 : 4000); await dismiss(p); await p.waitForTimeout(800);
      await p.screenshot({ path: join(dir, `${kind}.png`), timeout: 20000 });
      await settle(p); await dismiss(p);
      const h = Math.min(MAX_FULL, await p.evaluate(() => document.documentElement.scrollHeight));
      await p.setViewportSize({ width: vp.width, height: vp.height });
      await p.screenshot({ path: join(dir, `${kind}-full.png`), fullPage: true, clip: { x: 0, y: 0, width: vp.width, height: h }, timeout: 40000 });
      if (kind === 'desktop') out.tokens = await p.evaluate(MEASURE);
      else out.phone = await p.evaluate(() => ({ h1: (() => { const e = document.querySelector('h1'); if (!e) return null; const c = getComputedStyle(e); return { size: Math.round(parseFloat(c.fontSize)), tracking: c.letterSpacing }; })(), sidePadding: Math.round(([...document.querySelectorAll('h1,h2,p')].find((e) => e.getBoundingClientRect().width > 0)?.getBoundingClientRect().left) ?? 0) }));
      webp(join(dir, `${kind}.png`), join(dir, `${kind}.webp`), kind === 'desktop' ? 1440 : 390);
      webp(join(dir, `${kind}-full.png`), join(dir, `${kind}-full.webp`), kind === 'desktop' ? 720 : 390);
    } catch (e) { out[`${kind}Error`] = e.message.split('\n')[0]; }
    await ctx.close();
  }
  writeFileSync(join(dir, 'tokens.json'), JSON.stringify({ ...out, tags: site.tags, why: site.why }, null, 1));
  return out;
};

const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const queue = SITES.filter((s) => !only || only.split(',').some((o) => s.slug.includes(o)));
const report = [];
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (queue.length) {
    const s = queue.shift();
    const r = await shoot(b, s).catch((e) => ({ fatal: e.message }));
    const ok = existsSync(join(ROOT, s.slug, 'desktop.webp')) && existsSync(join(ROOT, s.slug, 'phone.webp'));
    report.push([s.slug, ok ? 'ok' : `FAILED ${r.desktopError || r.phoneError || r.fatal || ''}`]);
    console.log(s.slug.padEnd(24), ok ? 'ok' : `FAILED ${r.desktopError || r.phoneError || r.fatal || ''}`);
  }
}));
await b.close();
writeFileSync(join(ROOT, 'last-run.json'), JSON.stringify(report.sort(), null, 1));
