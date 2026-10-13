// Architecture rules from CLAUDE.md that can be checked statically.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|js|mjs|html)$/.test(f) ? [p] : [];
  });
}

const runtime = [...files(join(ROOT, 'src')), join(ROOT, 'index.html')];

describe('architecture boundaries', () => {
  it('runtime code never imports dev-only tools/', () => {
    for (const f of runtime) {
      const src = readFileSync(f, 'utf8');
      expect(/from\s+['"][^'"]*tools\//.test(src) || /import\(['"][^'"]*tools\//.test(src), relative(ROOT, f)).toBe(false);
    }
  });

  it('runtime code makes no network requests', () => {
    const banned = /\b(fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|navigator\.sendBeacon|https?:\/\/(?!www\.w3\.org))/;
    for (const f of runtime) {
      expect(banned.test(readFileSync(f, 'utf8')), relative(ROOT, f)).toBe(false);
    }
  });

  it('the engine core and schema use no browser APIs (portable to the plugin)', () => {
    const core = [...files(join(ROOT, 'src/engine/core')), ...files(join(ROOT, 'src/schema'))];
    const browser = /\b(window\.|document\.|navigator\.|new AudioContext|localStorage|requestAnimationFrame)/;
    for (const f of core) expect(browser.test(readFileSync(f, 'utf8')), relative(ROOT, f)).toBe(false);
  });

  it('no ML runtimes or model dependencies', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    const ml = /(tensorflow|onnx|transformers|torch|ml5|brain\.js|openai|anthropic|langchain|llama|gguf)/i;
    expect(deps.filter((d) => ml.test(d))).toEqual([]);
  });
});
