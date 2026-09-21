'use client';

import { useEffect, useState } from 'react';
import { initLiff, signInWithLiff } from '@/lib/liff/client.ts';

/**
 * Inside LINE, sign in without a second login.
 *
 * LINE already knows who this is, so LIFF hands us an ID token that the server
 * verifies with LINE before minting our own session cookie. Outside LINE this
 * renders nothing and the ordinary "เข้าสู่ระบบด้วย LINE" button does the work
 * — LIFF would otherwise bounce a desktop browser through LINE Login anyway.
 */
const TRIED_KEY = 'tungan_liff_tried_at';

export function LiffSignIn({ next }: { next: string }) {
  const [state, setState] = useState<'idle' | 'working' | 'failed'>('idle');

  useEffect(() => {
    // The LINE in-app browser (LIFF included) identifies itself as " Line/".
    if (!/\bLine\//i.test(navigator.userAgent)) return;
    // If a WebView drops the cookie, the app sends us straight back here.
    // One automatic try a minute stops that becoming a redirect loop.
    try {
      const last = Number(sessionStorage.getItem(TRIED_KEY) ?? 0);
      if (Date.now() - last < 60_000) return;
      sessionStorage.setItem(TRIED_KEY, String(Date.now()));
    } catch {
      // Storage blocked: still try once; there is no loop without a reload.
    }
    let cancelled = false;
    (async () => {
      setState('working');
      const liff = await initLiff();
      if (cancelled) return;
      if (liff.status !== 'ready') {
        // 'loading' means liff.login() is already navigating away.
        if (liff.status !== 'loading') setState('failed');
        return;
      }
      try {
        await signInWithLiff(liff.idToken);
        if (!cancelled) window.location.replace(next);
      } catch {
        if (!cancelled) setState('failed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [next]);

  if (state === 'working') {
    return (
      <p className="connection-notice" aria-live="polite">
        กำลังเข้าสู่ระบบด้วย LINE…
      </p>
    );
  }
  if (state === 'failed') {
    return (
      <p className="entry-error" role="alert">
        เข้าสู่ระบบอัตโนมัติไม่สำเร็จ กดปุ่มด้านล่างเพื่อลองอีกครั้ง
      </p>
    );
  }
  return null;
}
