import { useEffect, useState } from 'react';

export interface AmbientPalette {
  r: number;
  g: number;
  b: number;
  hex: string;
  glowSoft: string;
  glowStrong: string;
  accentGradient: string;
}

const DEFAULT_AMBIENT: AmbientPalette = {
  r: 79,
  g: 107,
  b: 255,
  hex: '#4F6BFF',
  glowSoft: 'rgba(79, 107, 255, 0.22)',
  glowStrong: 'rgba(79, 107, 255, 0.42)',
  accentGradient: 'linear-gradient(90deg, rgba(79,107,255,0.95), rgba(139,92,246,0.9))',
};

const STUDIO_FALLBACK_PALETTES: Array<[number, number, number]> = [
  [79, 107, 255], // Studio cobalt
  [16, 185, 129], // Emerald acoustic
  [236, 72, 153], // Velvet rose
  [245, 158, 11], // Warm amber gold
  [139, 92, 246], // Deep violet
  [56, 189, 248], // Cyan mist
  [244, 63, 94],  // Crimson stage
  [20, 184, 166], // Teal resonance
];

const colorCache = new Map<string, AmbientPalette>();

function toHex(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n)))
    .toString(16)
    .padStart(2, '0');
}

function buildPalette(r: number, g: number, b: number): AmbientPalette {
  const cr = Math.max(25, Math.min(245, Math.round(r)));
  const cg = Math.max(25, Math.min(245, Math.round(g)));
  const cb = Math.max(25, Math.min(245, Math.round(b)));
  const hex = `#${toHex(cr)}${toHex(cg)}${toHex(cb)}`;
  const lighterR = Math.min(255, cr + 38);
  const lighterG = Math.min(255, cg + 38);
  const lighterB = Math.min(255, cb + 38);
  return {
    r: cr,
    g: cg,
    b: cb,
    hex,
    glowSoft: `rgba(${cr}, ${cg}, ${cb}, 0.24)`,
    glowStrong: `rgba(${cr}, ${cg}, ${cb}, 0.48)`,
    accentGradient: `linear-gradient(90deg, rgb(${cr}, ${cg}, ${cb}), rgb(${lighterR}, ${lighterG}, ${lighterB}))`,
  };
}

function hashSeedPalette(seed: string): AmbientPalette {
  if (!seed) return DEFAULT_AMBIENT;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const [r, g, b] = STUDIO_FALLBACK_PALETTES[hash % STUDIO_FALLBACK_PALETTES.length];
  return buildPalette(r, g, b);
}

function extractColorFromImageUrl(url: string, seedKey: string): Promise<AmbientPalette> {
  return new Promise((resolve) => {
    if (!url || typeof document === 'undefined') {
      resolve(hashSeedPalette(seedKey));
      return;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';

    const timer = window.setTimeout(() => {
      resolve(hashSeedPalette(seedKey));
    }, 3000);

    img.onload = () => {
      window.clearTimeout(timer);
      try {
        const canvas = document.createElement('canvas');
        const size = 24;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          resolve(hashSeedPalette(seedKey));
          return;
        }
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;

        let bestR = 0;
        let bestG = 0;
        let bestB = 0;
        let totalWeight = 0;

        for (let i = 0; i < data.length; i += 4) {
          const a = data[i + 3];
          if (a < 128) continue;
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          const lum = (r + g + b) / 3;
          // Skip near-black and near-white washed out pixels
          if (lum < 28 || lum > 232) continue;
          const sat = max === 0 ? 0 : (max - min) / max;
          const weight = 0.25 + sat * 2.2;
          bestR += r * weight;
          bestG += g * weight;
          bestB += b * weight;
          totalWeight += weight;
        }

        if (totalWeight <= 0.1) {
          resolve(hashSeedPalette(seedKey));
          return;
        }

        const avgR = bestR / totalWeight;
        const avgG = bestG / totalWeight;
        const avgB = bestB / totalWeight;

        // Slightly boost saturation if color is overly muted
        const maxC = Math.max(avgR, avgG, avgB);
        const minC = Math.min(avgR, avgG, avgB);
        if (maxC - minC < 18) {
          resolve(hashSeedPalette(seedKey));
          return;
        }

        resolve(buildPalette(avgR, avgG, avgB));
      } catch {
        // Cross-origin image tainted canvas -> graceful deterministic studio palette
        resolve(hashSeedPalette(seedKey));
      }
    };

    img.onerror = () => {
      window.clearTimeout(timer);
      resolve(hashSeedPalette(seedKey));
    };

    img.src = url;
  });
}

export function useAmbientColor(imageUrl?: string | null, seedKey?: string | null): AmbientPalette {
  const cacheKey = `${imageUrl || ''}::${seedKey || ''}`;
  const [palette, setPalette] = useState<AmbientPalette>(() => {
    if (colorCache.has(cacheKey)) return colorCache.get(cacheKey)!;
    return hashSeedPalette(seedKey || imageUrl || 'vibra');
  });

  useEffect(() => {
    if (!imageUrl && !seedKey) {
      setPalette(DEFAULT_AMBIENT);
      return;
    }

    const existing = colorCache.get(cacheKey);
    if (existing) {
      setPalette(existing);
      return;
    }

    let cancelled = false;
    setPalette(hashSeedPalette(seedKey || imageUrl || 'vibra'));

    void extractColorFromImageUrl(imageUrl || '', seedKey || imageUrl || 'vibra').then((res) => {
      if (colorCache.size > 200) {
        const first = colorCache.keys().next().value;
        if (first !== undefined) colorCache.delete(first);
      }
      colorCache.set(cacheKey, res);
      if (!cancelled) setPalette(res);
    });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, imageUrl, seedKey]);

  return palette;
}
