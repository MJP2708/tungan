import Link from 'next/link';
import { safeNextPath } from '@/lib/deep-link.ts';
import { LiffSignIn } from './liff-sign-in.tsx';

export const dynamic = 'force-dynamic';

const MESSAGES: Record<string, string> = {
  config: 'ยังตั้งค่าการเชื่อมต่อ LINE ไม่ครบ',
  session: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่',
  // These three separate "LINE said yes but our side failed" from "LINE said
  // no", which a single generic message used to hide.
  db_not_configured: 'ยังไม่ได้ตั้งค่าฐานข้อมูลบนเซิร์ฟเวอร์',
  db_unreachable: 'เชื่อมต่อฐานข้อมูลไม่ได้',
  session_failed: 'สร้างเซสชันไม่สำเร็จ',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next: rawNext } = await searchParams;
  const next = safeNextPath(rawNext);
  const message = error ? (MESSAGES[error] ?? error) : null;

  return (
    // .auth-page is the app's existing full-height centring wrapper and
    // .auth-card the existing card. The first version of this page invented
    // .auth-screen, which no stylesheet defines, so the card sat unstyled in
    // the top-left corner.
    <main className="auth-page">
      <section className="auth-card">
        <span className="brand-art" aria-hidden="true">
          <img src="/tungan-logo-th.png" width={1774} height={887} alt="" />
        </span>
        <span className="sr-only">ทันงาน</span>
        <div>
          <h1>งานจาก LINE ไม่หล่น</h1>
        </div>
        <p>เข้าสู่ระบบด้วยบัญชี LINE เพื่อดูงานของคุณ</p>
        {!message && <LiffSignIn next={next} />}
        {message && (
          <p className="entry-error" role="alert">
            {message}
          </p>
        )}
        <Link className="auth-line-button" href={
            next === '/'
              ? '/api/auth/line/start'
              : `/api/auth/line/start?next=${encodeURIComponent(next)}`
          }
        >
          เข้าสู่ระบบด้วย LINE
        </Link>
      </section>
    </main>
  );
}
