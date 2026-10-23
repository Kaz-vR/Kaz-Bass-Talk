// DEV ONLY. Breath lives in the Noise strip (texture.type = breath, owner's call): a preset that
// uses breath plays the breath type, and its texture bed goes. N (filter.route_n) decides whether
// the breath goes through the filter, as the old breath route did.

/** Turn a preset with breath into the breath Noise type (in place). */
export function breathAsNoise(p: Record<string, unknown>): void {
  const breath = Number(p['breath.level'] ?? 0) > 0 || Number(p['breath.chiff'] ?? 0) > 0;
  if (breath && p['texture.type'] !== 'breath') {
    p['texture.type'] = 'breath';
    p['filter.route_n'] = p['filter.route_br'] ?? true;
  }
  delete p['filter.route_br'];
  delete p['filter.route_cl'];
}
