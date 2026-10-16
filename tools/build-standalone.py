#!/usr/bin/env python3
"""DEV ONLY: pack the built web prototype (dist/) into one HTML file you open straight in
Chrome or Edge. Opened directly (not inside another page's frame), the browser lets it use
your MIDI keyboard. Run `npx vite build` first.

    python3 tools/build-standalone.py [out.html]
"""
import base64, glob, os, re, sys

out = sys.argv[1] if len(sys.argv) > 1 else 'dist/low-talk-standalone.html'
html = open('dist/index.html').read()
js_name = re.search(r'assets/(index-[^"]+\.js)', html).group(1)
css = open(glob.glob('dist/assets/index-*.css')[0]).read()
js = open('dist/assets/' + js_name).read()
worklet = glob.glob('dist/assets/worklet-*.js')[0]
data = base64.b64encode(open(worklet, 'rb').read()).decode()
# The audio worklet is loaded by URL: point that URL at an inline copy instead.
js, n = re.subn(r'(["\'`])[^"\'`]*' + re.escape(os.path.basename(worklet)) + r'\1', lambda m: '"data:text/javascript;base64,' + data + '"', js)
assert n == 1, f'expected one worklet reference, found {n}'
body = re.search(r'<body>(.*)</body>', html, re.S).group(1)
js = js.replace('</script', '<\\/script')
open(out, 'w').write(
    '<!doctype html>\n<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">'
    '<title>Low Talk</title><link rel="icon" href="data:,"><style>' + css + '</style></head><body>' + body
    + '<script type="module">' + js + '</script></body></html>\n')
print(f'{out}: {os.path.getsize(out) / 1e6:.1f} MB')
