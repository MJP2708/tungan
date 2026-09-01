'use client';

// LIFF bootstrap. The only public value in the whole system is the LIFF ID.
//
// Development outside LINE uses an explicitly marked mock identity. The mock
// produces no ID token, so POST /api/auth/line has nothing to verify and the
// server refuses it — the mock cannot authenticate against a real backend even
// by accident.

export type LiffState =
  | { status: 'loading' }
  | { status: 'ready'; inClient: boolean; idToken: string }
  | { status: 'mock'; reason: string }
  | { status: 'error'; message: string };

const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID;

export async function initLiff(): Promise<LiffState> {
  if (!LIFF_ID) {
    return {
      status: 'mock',
      reason: 'ยังไม่ได้ตั้งค่า NEXT_PUBLIC_LIFF_ID — โหมดพัฒนาเท่านั้น',
    };
  }

  try {
    const liff = (await import('@line/liff')).default;
    await liff.init({ liffId: LIFF_ID });

    if (!liff.isLoggedIn()) {
      // Sends the browser to LINE and returns here afterwards.
      liff.login();
      return { status: 'loading' };
    }

    const idToken = liff.getIDToken();
    if (!idToken) {
      return { status: 'error', message: 'LINE ไม่ได้ให้ ID token กลับมา' };
    }
    return { status: 'ready', inClient: liff.isInClient(), idToken };
  } catch (error) {
    return { status: 'error', message: (error as Error).message };
  }
}

/**
 * Hand the ID token to our server and take back a session cookie.
 * The profile object from liff.getProfile() is deliberately not sent: it is
 * ordinary JSON and proves nothing.
 */
export async function signInWithLiff(idToken: string) {
  const res = await fetch('/api/auth/line', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? 'เข้าสู่ระบบไม่สำเร็จ');
  }
  return res.json();
}
