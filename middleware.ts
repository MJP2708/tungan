import { NextResponse, type NextRequest } from 'next/server';

const SESSION_COOKIE = 'tungan_session';

/**
 * The single auth gate. Everything except the login page, the auth routes and
 * the LINE webhook requires a session, so no screen has to check for itself.
 *
 * This only checks that a cookie is present — the cookie's validity is proved
 * in the route handlers by requireSession(), which is the real boundary. A
 * middleware database call would run on every asset request.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isPublic =
    pathname === '/login' ||
    pathname.startsWith('/api/auth/line') ||
    // LINE calls this one with a signature, not a session.
    pathname.startsWith('/api/webhooks/') ||
    // Reports presence booleans only, so it is safe unauthenticated and can
    // still diagnose a login that fails before a session exists.
    pathname === '/api/health';

  if (isPublic) return NextResponse.next();

  if (!req.cookies.get(SESSION_COOKIE)) {
    // API callers get a status they can act on; pages get the login screen.
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'ต้องเข้าสู่ระบบก่อน' }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Everything except Next internals and static files in public/.
    '/((?!_next/static|_next/image|favicon.svg|og.png|tungan-logo-th.png).*)',
  ],
};
