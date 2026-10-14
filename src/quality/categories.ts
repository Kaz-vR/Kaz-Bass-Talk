// The 14 preset-bank categories (data/categories.json): how each is measured
// (its loop and register) and its critic limits and LORN fingerprint zone.

import categoriesJson from '../../data/categories.json';

export type Limit = { max?: number; min?: number; maxAbs?: number; label?: string };

export interface Category {
  id: string;
  name: string;
  description: string;
  recipe: string;
  poly: number;
  audition: string;
  analysis: {
    loop: string;
    seconds: number;
    probes: { low: number; mid: number; high: number };
    hold: number;
    decaying: boolean;
  };
  /** Critic overrides for the category (same codes as data/quality.json). */
  limits: Record<string, Limit>;
  /** LORN fingerprint: limits on the vibe measurements (vibeBright, vibeAir, vibeDirt, vibeWidth, vibeTail). */
  zone: Record<string, Limit>;
}

export const categories: Category[] = (categoriesJson as unknown as { categories: Category[] }).categories;

/** The mod wheel move a preset is designed with: its category's, or snarl for the bass collections. */
export function wheelDefault(category: string | undefined): string {
  return (categoryById(category) as { wheel?: string } | undefined)?.wheel ?? 'snarl';
}

export function categoryById(id: string | undefined): Category | undefined {
  return id ? categories.find((c) => c.id === id) : undefined;
}

/** How to analyze a patch: its category's loop, length, register and hold (bass defaults otherwise). */
export function analysisSetup(meta: { [key: string]: unknown } | undefined): {
  loop: string;
  opts: { loopSeconds: number; holdSeconds: number; probes: { low: number; mid: number; high: number } };
} {
  const c = categoryById(meta?.category as string | undefined);
  if (!c) return { loop: 'groove', opts: { loopSeconds: 2, holdSeconds: 1.2, probes: { low: 33, mid: 45, high: 57 } } };
  return { loop: c.analysis.loop, opts: { loopSeconds: c.analysis.seconds, holdSeconds: c.analysis.hold, probes: c.analysis.probes } };
}
