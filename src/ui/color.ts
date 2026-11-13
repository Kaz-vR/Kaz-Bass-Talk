// Colours read from CSS custom properties come back as written in the built stylesheet, and the build's minifier
// rewrites some hex colours as names (#ff0000 becomes "red"). Code that works with '#rrggbb' strings reads every
// colour through toHex(), which lets the browser turn any CSS colour into '#rrggbb' (or rgba() when transparent).
let g: CanvasRenderingContext2D | null = null;
const cache = new Map<string, string>();
export const toHex = (c: string): string => {
  if (!c || /^#[0-9a-f]{6}$/i.test(c)) return c;
  let v = cache.get(c);
  if (v) return v;
  g ??= document.createElement('canvas').getContext('2d');
  if (!g) return c;
  g.fillStyle = '#000000'; g.fillStyle = c; v = String(g.fillStyle);
  cache.set(c, v);
  return v;
};
