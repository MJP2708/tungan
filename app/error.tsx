'use client';

import { useEffect } from 'react';

/**
 * What a crash looks like.
 *
 * Without this file a thrown render turns the whole app into a blank white
 * screen — no message, no way back, and nothing to tell anyone what happened.
 * That was audit finding SEC-4, and it is what made a single unguarded
 * `members[0].id` able to take down the entire page.
 *
 * Deliberately plain: no brand chrome, no stack trace, and no apology. The
 * person needs to know their work is not lost and how to get back.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Goes to the server logs, where a digest can be matched to the real
    // stack. Never rendered: an error message can carry internals.
    console.error('[app] render failed', error.digest ?? '', error.message);
  }, [error]);

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div>
          <h1>หน้านี้มีปัญหา</h1>
          <p>
            งานของคุณยังอยู่ครบ ไม่มีอะไรหายไป — หน้าจอนี้แสดงผลไม่สำเร็จเท่านั้น
          </p>
        </div>
        <button type="button" className="auth-line-button" onClick={() => reset()}>
          ลองใหม่
        </button>
        <button
          type="button"
          className="auth-line-button"
          onClick={() => {
            window.location.href = '/';
          }}
        >
          กลับหน้าแรก
        </button>
        {error.digest && (
          // The only thing worth showing: it is what support can look up.
          <p className="entry-error">รหัสอ้างอิง {error.digest}</p>
        )}
      </section>
    </main>
  );
}
