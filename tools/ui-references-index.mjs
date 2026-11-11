// DEV ONLY: builds the software-UI reference library from what tools/ui-references.mjs captured.
//   node tools/ui-references-index.mjs
// 1. For each app with a fresh capture (references-ui/<slug>/raw/), keeps only the candidates Claude picked by eye
//    (references-ui/picks.json) as shot-1.webp, shot-2.webp ... (max 1440 px wide), records where each came from in
//    sources.json, and deletes the rest of raw/.
// 2. Writes references-ui/<slug>/DESIGN.md from apps.json + notes.json, and the index references-ui/README.md.
// The rulebook (references-ui/RULES.md) is written by hand from the notes; this script never touches it.
import { readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = 'references-ui';
const read = (f) => JSON.parse(readFileSync(join(ROOT, f), 'utf8'));
const APPS = read('apps.json'), NOTES = read('notes.json'), PICKS = read('picks.json');
const GROUPS = {
  siren: ['The Siren family', 'Software and devices from the brands behind the website\'s look (Hasselblad, Teenage Engineering, Apple, Leica): calm, premium, few colours. The most weight when choosing a style.'],
  synth: ['Synths and plugins', 'The genre: knobs, displays, dense panels, modulation. The most weight on how controls work.'],
  hardware: ['Hardware that feels expensive', 'Materials, real skeuomorphism, light on dark objects.'],
  lorn: ['Dark, cinematic, LORN-fit', 'Mood: worn, dark, dangerous, cinematic.'],
  pro: ['Pro software with dense, clear controls', 'How many controls stay calm on one page.'],
};

for (const a of APPS) {
  const dir = join(ROOT, a.slug), raw = join(dir, 'raw');
  if (existsSync(raw)) {
    const src = existsSync(join(raw, 'sources.json')) ? JSON.parse(readFileSync(join(raw, 'sources.json'), 'utf8')) : { images: [] };
    for (const f of readdirSync(dir)) if (/^shot-\d+\.webp$/.test(f)) rmSync(join(dir, f));
    const kept = (PICKS[a.slug] || []).map((p, i) => {
      const from = join(raw, `${p}.webp`), to = join(dir, `shot-${i + 1}.webp`);
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', from, '-vf', "scale='min(1440,iw)':-2:flags=lanczos", '-c:v', 'libwebp', '-quality', '70', to]);
      const img = src.images.find((x) => x.file === `${p}.webp`);
      return { shot: `shot-${i + 1}.webp`, from: img ? img.url : `screenshot of ${a.url} (${p})` };
    });
    writeFileSync(join(dir, 'sources.json'), JSON.stringify({ page: a.url, shots: kept }, null, 1));
    rmSync(raw, { recursive: true, force: true });
  }
  const shots = existsSync(dir) ? readdirSync(dir).filter((f) => /^shot-\d+\.webp$/.test(f)).sort((x, y) => parseInt(x.slice(5), 10) - parseInt(y.slice(5), 10)) : [];
  const n = NOTES[a.slug] || {};
  writeFileSync(join(dir, 'DESIGN.md'), `# ${a.name}

Group: **${GROUPS[a.group][0]}** · Tags: ${a.tags.map((t) => `\`${t}\``).join(' ')}
Source: ${a.url} (the maker's official product page; images are the maker's, kept here for study only)

**Why it is here:** ${a.why}

- **What makes it work:** ${n.works || '-'}
- **Controls:** ${n.controls || '-'}
- **Displays:** ${n.displays || '-'}
- **Colour:** ${n.colour || '-'}
- **Lesson for RUIN-1:** ${n.lesson || '-'}

${shots.map((s) => `![${a.name}](${s})`).join('\n')}
`);
}

const tags = {};
for (const a of APPS) for (const t of a.tags) (tags[t] ||= []).push(a.slug);
const shotsOf = (s) => (existsSync(join(ROOT, s)) ? readdirSync(join(ROOT, s)).filter((f) => /^shot-/.test(f)).length : 0);
writeFileSync(join(ROOT, 'README.md'), `# Software UI reference library

Our own hand-picked library of ${APPS.length} software and instrument interfaces, the software twin of the website library in
\`references/\` (owner's call). Use it for every synth UI decision, before relying on taste. **Read \`RULES.md\` first**:
it sums up what the best of these share and how RUIN-1 should use it.

Dev-only: never shipped with the plugin, never imported by runtime code. Images come from each maker's official product
page and belong to the maker; they are here for study. Study the patterns; never copy a maker's art, branding or layout one to one.

## How to use it
Pick the groups and tags that fit the task, open 5 to 8 of the \`DESIGN.md\` files with their shots, and name the
references used in every pitch. The **Siren family** decides the style (it matches the website); **Synths and plugins**
decide how controls work.

## Rebuild or extend it
Add apps to \`apps.json\`, run \`node tools/ui-references.mjs slug,slug\` (captures the page and its biggest images into
\`<slug>/raw/\`), look at every candidate and list the ones that show the interface in \`picks.json\`, add notes to
\`notes.json\`, then \`node tools/ui-references-index.mjs\`. Capturing needs open internet access in the cloud environment.

${Object.entries(GROUPS).map(([g, [title, text]]) => `## ${title}\n${text}\n\n${APPS.filter((a) => a.group === g).map((a) => `- [${a.name}](${a.slug}/DESIGN.md) (${shotsOf(a.slug)} shots): ${a.why}`).join('\n')}`).join('\n\n')}

## By tag
${Object.entries(tags).sort((x, y) => y[1].length - x[1].length).map(([t, s]) => `- \`${t}\` (${s.length}): ${s.join(', ')}`).join('\n')}
`);
console.log(`${APPS.length} apps, ${APPS.reduce((n, a) => n + shotsOf(a.slug), 0)} shots`);
