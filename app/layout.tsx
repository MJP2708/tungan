import type { Metadata } from 'next';
import { Geist_Mono, Prompt } from 'next/font/google';
import './globals.css';

const prompt = Prompt({
  variable: '--font-prompt',
  subsets: ['thai', 'latin'],
  weight: ['300', '400', '500', '600', '700'],
});
const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

// Deadlines are resolved against the current time, so this route must not be
// frozen into static HTML at build time — a prerendered "วันนี้" is wrong the
// next day. The app runs inside the LINE WebView behind a login and needs no
// SEO, so there is nothing to lose here.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'ทันงาน — งานจาก LINE ไม่หล่น',
  description:
    'แปลงข้อความจาก LINE เป็นงาน มีคนรับผิดชอบ เตือน ส่งหลักฐาน และขออนุมัติ โดยทีมไม่ต้องย้ายแอป',
  openGraph: {
    title: 'ทันงาน — งานจาก LINE ไม่หล่น',
    description: 'รับเรื่องจาก LINE จนถึงส่งหลักฐานและอนุมัติงาน',
    type: 'website',
    locale: 'th_TH',
    images: [
      {
        url: '/og.png',
        width: 1200,
        height: 630,
        alt: 'ทันงาน — งานจาก LINE ไม่หล่น',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ทันงาน — งานจาก LINE ไม่หล่น',
    description: 'รับเรื่องจาก LINE จนถึงส่งหลักฐานและอนุมัติงาน',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th">
      <body className={`${prompt.variable} ${geistMono.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
