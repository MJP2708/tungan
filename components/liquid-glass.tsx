'use client';

import { useEffect } from 'react';
import { lensFilterMarkup, lensId, lensSpec, liquidLevel, type LensSpec } from '@/lib/liquid-glass';

/**
 * The surfaces that are liquid glass. Everything else stays as it was.
 * Kept short on purpose: each refracting surface costs GPU time while the
 * page scrolls under it.
 */
export const LIQUID_SURFACES = [
  '.mobile-nav',
  '.topbar',
  '.desktop-sidebar',
  '.toast-host',
].join(', ');
// Menus (select/popover popups) are frosted, never refracting: a list of
// options over a list of tasks has to read cleanly before it looks clever.

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Decides the device's level once (html[data-liquid]), then, on refracting
 * devices, keeps one SVG lens per surface size and points each surface at
 * its own (--lg-filter, data-lg). app/liquid.css does the drawing. Mounted
 * once in the layout; renders nothing.
 */
export function LiquidGlass() {
  useEffect(() => {
    const root = document.documentElement;
    const media = (q: string) => window.matchMedia?.(q).matches ?? false;
    const nav = navigator as Navigator & { deviceMemory?: number };
    const level = liquidLevel({
      userAgent: navigator.userAgent,
      supportsUrlBackdrop: typeof CSS !== 'undefined' && CSS.supports('backdrop-filter', 'url(#lg)'),
      deviceMemory: nav.deviceMemory,
      cores: navigator.hardwareConcurrency,
      reducedMotion: media('(prefers-reduced-motion: reduce)') || root.dataset.motion === 'reduced',
      reducedTransparency: media('(prefers-reduced-transparency: reduce)'),
    });
    root.dataset.liquid = level;
    if (level !== 'refract') return () => void delete root.dataset.liquid;

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.style.position = 'absolute';
    svg.style.pointerEvents = 'none';
    const defs = document.createElementNS(SVG_NS, 'defs');
    svg.appendChild(defs);
    document.body.appendChild(svg);

    const made = new Set<string>();
    const ensure = (spec: LensSpec) => {
      const id = lensId(spec);
      if (made.has(id)) return id;
      const filter = document.createElementNS(SVG_NS, 'filter');
      filter.setAttribute('id', id);
      filter.setAttribute('x', '0');
      filter.setAttribute('y', '0');
      filter.setAttribute('width', String(spec.w));
      filter.setAttribute('height', String(spec.h));
      filter.setAttribute('filterUnits', 'userSpaceOnUse');
      filter.setAttribute('color-interpolation-filters', 'sRGB');
      // Markup we build ourselves from numbers (lib/liquid-glass.ts), never
      // from page content.
      filter.innerHTML = lensFilterMarkup(spec);
      defs.appendChild(filter);
      made.add(id);
      return id;
    };

    const fit = (el: HTMLElement) => {
      // Layout size, not getBoundingClientRect: a popup mid zoom-in would
      // otherwise get a lens drawn for its shrunken size.
      const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
      const spec = lensSpec(el.offsetWidth, el.offsetHeight, radius);
      if (!spec) {
        el.removeAttribute('data-lg');
        return;
      }
      el.style.setProperty('--lg-filter', `url(#${ensure(spec)})`);
      el.setAttribute('data-lg', '');
    };

    const watched = new Set<HTMLElement>();
    const sizes = new ResizeObserver((entries) => {
      for (const entry of entries) fit(entry.target as HTMLElement);
    });
    const scan = () => {
      for (const el of document.querySelectorAll<HTMLElement>(LIQUID_SURFACES)) {
        if (watched.has(el)) continue;
        watched.add(el);
        sizes.observe(el);
        fit(el);
      }
      for (const el of watched) {
        if (!el.isConnected) {
          sizes.unobserve(el);
          watched.delete(el);
        }
      }
    };
    // Popups and toasts come and go; look again when the page changes, at
    // most once a frame.
    let queued = 0;
    const changes = new MutationObserver(() => {
      if (queued) return;
      queued = requestAnimationFrame(() => {
        queued = 0;
        scan();
      });
    });
    scan();
    changes.observe(document.body, { childList: true, subtree: true });

    return () => {
      changes.disconnect();
      sizes.disconnect();
      cancelAnimationFrame(queued);
      for (const el of watched) {
        el.removeAttribute('data-lg');
        el.style.removeProperty('--lg-filter');
      }
      svg.remove();
      delete root.dataset.liquid;
    };
  }, []);

  return null;
}
