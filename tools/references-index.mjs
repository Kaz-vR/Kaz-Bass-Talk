// DEV ONLY: writes each reference's DESIGN.md (from its measured tokens.json and the notes in references/notes.json)
// and the library's index, references/README.md, grouped by tag.
//   node tools/references-index.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'references';
const sites = JSON.parse(readFileSync(join(ROOT, 'sites.json'), 'utf8'));
const notes = existsSync(join(ROOT, 'notes.json')) ? JSON.parse(readFileSync(join(ROOT, 'notes.json'), 'utf8')) : {};
const hex = (c) => { const m = (c || '').match(/[\d.]+/g); if (!m) return c; const [r, g, b, a] = m.map(Number); const h = '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join(''); return a !== undefined && a < 1 ? `${h} at ${Math.round(a * 100)}%` : h; };
const type = (t) => (t ? `${t.font}, ${t.size}px, weight ${t.weight}${t.case && t.case !== 'none' ? `, ${t.case}` : ''}${t.tracking && t.tracking !== 'normal' ? `, tracking ${t.tracking}` : ''} (“${t.sample}”)` : 'not measured');

const index = {};
for (const s of sites) {
  const dir = join(ROOT, s.slug), tf = join(dir, 'tokens.json');
  if (!existsSync(tf)) continue;
  const t = JSON.parse(readFileSync(tf, 'utf8')), k = t.tokens || {}, n = notes[s.slug] || {};
  const ok = existsSync(join(dir, 'desktop.webp'));
  const md = `# ${s.slug}

${s.url}
Tags: ${s.tags.join(', ')}
Picked because: ${s.why}

## What makes it work
${n.works || '_to be written_'}

## Good reference for
${n.goodFor || '_to be written_'}

## Lesson for RUIN-1
${n.lesson || '_to be written_'}

## Measured (from the live page)
- First screen: ${t.darkFirstScreen ? 'dark' : 'light'} (average brightness ${t.firstScreenLuminance ?? '?'})
- Background: ${hex(k.background)}; palette by area: ${(k.palette || []).slice(0, 6).map(hex).join(', ') || '?'}; accent: ${k.accent ? hex(k.accent) : 'none'}
- Fonts: ${(k.fonts || []).join(', ') || '?'}
- Headline: ${type(k.h1)}
- Section title: ${type(k.h2)}
- Body: ${type(k.body)}
- Navigation: ${type(k.nav)}
- Buttons: ${(k.buttons || []).map((b) => `“${b.text}” ${b.height}px tall, radius ${b.radius}, ${b.font}${b.border ? `, border ${b.border}` : ''}`).join('; ') || 'none found'}
- Section spacing (median vertical padding): ${k.sectionPaddingMedian ? Math.round(k.sectionPaddingMedian) + 'px' : '?'}; page height ${k.pageHeight || '?'}px
- Phone: headline ${t.phone?.h1 ? `${t.phone.h1.size}px` : '?'}, side margin ${t.phone?.sidePadding ?? '?'}px

## Screenshots
${ok ? '![desktop](desktop.webp) ![phone](phone.webp)\n\nWhole page: [desktop](desktop-full.webp) · [phone](phone-full.webp)' : '_capture failed_'}
`;
  writeFileSync(join(dir, 'DESIGN.md'), md);
  for (const tag of s.tags) (index[tag] ||= []).push(s);
}

const order = ['lorn', 'dark', 'hero', 'product', 'music', 'type-led', 'motion', 'specs', 'mobile', 'film', 'games', 'score', 'synth', 'hardware', 'audio', 'software', 'studio', 'luxury', 'fashion', 'outlier'];
const tags = [...order.filter((t) => index[t]), ...Object.keys(index).filter((t) => !order.includes(t)).sort()];
writeFileSync(join(ROOT, 'README.md'), `# RUIN-1 reference library

Our own hand-picked library of top-tier websites (like UXKIN, but chosen for RUIN-1): ${sites.length} sites, each with
desktop and phone screenshots (first screen and whole page), the design measured from the live page, and notes on
what makes it work and what RUIN-1 can learn from it. We study these sites; we never copy their branding or content.

- Rebuild the captures: \`node tools/references.mjs [slug]\` (dev only). Rebuild this index and the DESIGN.md files:
  \`node tools/references-index.mjs\`.
- Use: pick the tag that fits the task, read those DESIGN.md files and look at their screenshots, and take 5 to 8 of
  them as the brief. **lorn** = sites in line with RUIN-1's concept (dark, worn, cinematic, analog, slow, alive).

${tags.map((t) => `## ${t} (${index[t].length})\n${index[t].map((s) => `- [${s.slug}](${s.slug}/DESIGN.md): ${s.why}`).join('\n')}`).join('\n\n')}
`);
console.log('wrote', Object.values(index).flat().length ? sites.length : 0, 'sites,', tags.length, 'tags');
