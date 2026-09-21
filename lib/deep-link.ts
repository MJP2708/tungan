// Links into the app, in both directions.
//
// Out: every link the bot sends into LINE goes through appLink(). It is a LIFF
// URL, so tapping it inside LINE opens the app already signed in, instead of
// LINE's plain in-app browser and a second login.
//
// In: a LIFF URL reaches us as `/?liff.state=<path-and-query>`, and a person
// with no session is bounced to `/login?next=<that>`. These helpers unwrap
// both without ever sending the browser to another origin.

const ORIGIN = 'https://app.invalid';

/** The link to put in a LINE message. Server-side only (reads env). */
export function appLink(target: { task?: string } = {}): string {
  const query = target.task ? `?task=${encodeURIComponent(target.task)}` : '';
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
  if (liffId) return `https://liff.line.me/${liffId}${query}`;
  const base = (process.env.APP_BASE_URL ?? '').replace(/\/$/, '');
  return `${base}/${query}`;
}

/**
 * A same-origin path to return to, or '/' when the input is anything else.
 * Refuses absolute URLs, protocol-relative `//host`, and backslash tricks.
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return '/';
  try {
    const url = new URL(next, ORIGIN);
    if (url.origin !== ORIGIN) return '/';
    return unwrapLiffState(url.pathname + url.search);
  } catch {
    return '/';
  }
}

/**
 * `/?liff.state=%3Ftask%3Dabc` means "go to `/?task=abc`". LIFF adds the
 * wrapper on the first hop; the SDK would unwrap it, but pages behind the
 * session check never get to run the SDK, so it is done here.
 */
function unwrapLiffState(path: string): string {
  const url = new URL(path, ORIGIN);
  const state = url.searchParams.get('liff.state');
  if (state === null) return path;
  // LIFF only ever produces a path or a query here; anything else is not ours.
  if (!(state.startsWith('/') || state.startsWith('?'))) return '/';
  const inner = state;
  if (inner.startsWith('//') || inner.includes('\\')) return '/';
  const resolved = new URL(inner, ORIGIN);
  if (resolved.origin !== ORIGIN) return '/';
  return resolved.pathname + resolved.search;
}

/** The task a link asks to open, from `?task=` directly or inside liff.state. */
export function taskIdFromSearch(search: string): string | null {
  const path = safeNextPath(`/${search.startsWith('?') ? search : `?${search}`}`);
  const id = new URL(path, ORIGIN).searchParams.get('task');
  return id && /^[\w-]{1,64}$/.test(id) ? id : null;
}
