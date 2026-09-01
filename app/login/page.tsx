import Image from 'next/image';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

const MESSAGES: Record<string, string> = {
  config: 'ยังตั้งค่าการเชื่อมต่อ LINE ไม่ครบ',
  session: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const message = error ? (MESSAGES[error] ?? error) : null;

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <span className="brand-art" aria-hidden="true">
          <img src="/tungan-logo-th.png" width={1774} height={887} alt="" />
        </span>
        <span className="sr-only">ทันงาน</span>
        <h1>งานจาก LINE ไม่หล่น</h1>
        <p>เข้าสู่ระบบด้วยบัญชี LINE เพื่อดูงานของคุณ</p>
        {message && (
          <p className="auth-error" role="alert">
            {message}
          </p>
        )}
        <Link className="auth-line-button" href="/api/auth/line/start">
          เข้าสู่ระบบด้วย LINE
        </Link>
      </div>
    </div>
  );
}
