import type { NextConfig } from 'next';

/**
 * Security headers (2026-11-06).
 *
 * The Content-Security-Policy goes out as Report-Only first: LIFF loads code
 * and talks to hosts we do not control, and a policy that blocks one of them
 * breaks the app inside LINE for everyone. Violations are reported to
 * /api/csp-report and logged. Once a deploy has been used inside LINE on a
 * phone with no reports, CSP_ENFORCE turns it on — together with
 * X-Frame-Options, which has no report-only form.
 *
 * What LIFF needs, read from the SDK (node_modules/@liff): scripts from
 * static.line-scdn.net (its extensions, analytics and alert UI), a manifest
 * from liffsdk.line-scdn.net, analytics to uts-front.line-apps.com, and
 * liff.line.me / api.line.me / access.line.me. Profile pictures come from
 * *.line-scdn.net. Fonts are self-hosted by next/font.
 *
 * 'unsafe-inline' for scripts is what Next.js's no-nonce setup needs; a
 * nonce would make every page dynamic per request.
 */
export const CSP_ENFORCE = false;

const LINE_SCRIPTS = 'https://static.line-scdn.net';
const LINE_CONNECT = [
  'https://api.line.me',
  'https://access.line.me',
  'https://liff.line.me',
  'https://*.line-scdn.net',
  'https://uts-front.line-apps.com',
].join(' ');

export const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' ${LINE_SCRIPTS}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.line-scdn.net",
  "font-src 'self' data:",
  `connect-src 'self' ${LINE_CONNECT}`,
  "frame-src https://*.line.me",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://access.line.me",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests',
  'report-uri /api/csp-report',
].join('; ');

export const securityHeaders = [
  { key: CSP_ENFORCE ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only', value: contentSecurityPolicy },
  ...(CSP_ENFORCE ? [{ key: 'X-Frame-Options', value: 'DENY' }] : []),
  // No includeSubDomains: other names under the domain are not ours to force.
  { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
};

export default nextConfig;
