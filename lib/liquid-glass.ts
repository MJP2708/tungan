/**
 * Our own liquid glass (2026-10-09). SVG and CSS only: no WebGPU, no image
 * files, no library.
 *
 * Three levels, decided per device:
 *  - `refract`: Chromium (LINE on Android included) can run an SVG filter as
 *    a backdrop-filter, so the page behind a glass surface really bends at
 *    its rim. Each surface gets a displacement map drawn for its exact size.
 *  - `frost`: everywhere else (Safari and LINE on iPhone, Firefox): blur,
 *    saturation, a specular highlight and a lit rim — still reads as glass.
 *  - Solid: no backdrop-filter at all, or reduced transparency asked for;
 *    the existing fallbacks in theme-glass.css / theme-atelier.css apply.
 *
 * This file is pure (no DOM), so it is tested directly; the browser part is
 * components/liquid-glass.tsx.
 */

export type LiquidLevel = 'refract' | 'frost';

/**
 * Which level this device gets. Refraction costs GPU time on every scroll
 * frame, so it needs Chromium, the filter support, and a phone that is not
 * low-end; and it is skipped when the person asked for less motion or less
 * transparency.
 */
export function liquidLevel(env: {
  userAgent: string;
  supportsUrlBackdrop: boolean;
  deviceMemory?: number;
  cores?: number;
  reducedMotion: boolean;
  reducedTransparency: boolean;
}): LiquidLevel {
  if (env.reducedTransparency || env.reducedMotion) return 'frost';
  // Chrome on iOS is WebKit underneath (CriOS), and WebKit does not run SVG
  // filters as a backdrop, whatever CSS.supports says.
  const chromium = /\bChrome\/\d+/.test(env.userAgent) && !/\b(CriOS|FxiOS|EdgiOS)\b/.test(env.userAgent);
  if (!chromium || !env.supportsUrlBackdrop) return 'frost';
  if ((env.deviceMemory ?? 4) < 4 || (env.cores ?? 4) < 4) return 'frost';
  return 'refract';
}

/** Sizes are rounded so near-identical surfaces share one filter. */
export const SIZE_STEP = 4;

export type LensSpec = { w: number; h: number; r: number };

export function lensSpec(width: number, height: number, radius: number): LensSpec | null {
  const w = Math.round(width / SIZE_STEP) * SIZE_STEP;
  const h = Math.round(height / SIZE_STEP) * SIZE_STEP;
  if (w < 24 || h < 24) return null;
  return { w, h, r: Math.round(Math.min(Math.max(0, radius), w / 2, h / 2)) };
}

export const lensId = (s: LensSpec) => `lg-${s.w}x${s.h}r${s.r}`;

/** How wide the bending band at the rim is, and how far it bends. */
export function lensStrength(s: LensSpec): { edge: number; scale: number } {
  const edge = Math.max(8, Math.min(18, Math.round(Math.min(s.w, s.h) * 0.28)));
  return { edge, scale: Math.round(edge * 1.8) };
}

/**
 * The displacement map, as an SVG data URI. Red is the x shift and green the
 * y shift (128 = none): two gradients across the whole lens, with the middle
 * painted neutral and feathered, so only the rim bends and text under the
 * middle of the glass stays where it is.
 */
export function lensMap(s: LensSpec): string {
  const { edge } = lensStrength(s);
  const inset = edge * 0.6;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${s.w}" height="${s.h}" viewBox="0 0 ${s.w} ${s.h}">` +
    `<defs>` +
    `<linearGradient id="x" x1="0" x2="1"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#f00"/></linearGradient>` +
    `<linearGradient id="y" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#0f0"/></linearGradient>` +
    `<filter id="f" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${(edge / 3).toFixed(2)}"/></filter>` +
    `</defs>` +
    `<rect width="${s.w}" height="${s.h}" fill="url(#x)"/>` +
    `<rect width="${s.w}" height="${s.h}" fill="url(#y)" style="mix-blend-mode:screen"/>` +
    `<rect x="${inset}" y="${inset}" width="${s.w - inset * 2}" height="${s.h - inset * 2}" ` +
    `rx="${Math.max(0, s.r - inset)}" fill="rgb(128,128,128)" filter="url(#f)"/>` +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** The <filter> element's inner markup for one lens. */
export function lensFilterMarkup(s: LensSpec): string {
  const { scale } = lensStrength(s);
  return (
    `<feImage href="${lensMap(s)}" x="0" y="0" width="${s.w}" height="${s.h}" result="map" preserveAspectRatio="none"/>` +
    `<feDisplacementMap in="SourceGraphic" in2="map" scale="${scale}" xChannelSelector="R" yChannelSelector="G"/>`
  );
}
