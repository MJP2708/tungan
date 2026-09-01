import 'server-only';

/**
 * Check an evidence link at the moment it is submitted.
 *
 * The failure this prevents: someone pastes a Drive link only they can open,
 * the task moves to "waiting for review", and the reviewer discovers it is
 * locked hours later — by which time the submitter has moved on and the
 * reviewer is blocked. Catching it while the person is still looking at the
 * screen costs them ten seconds instead.
 *
 * This is a warning, never a block. Plenty of legitimate links refuse a HEAD
 * from a datacentre, and refusing the submission would be worse than the
 * problem: work that was done would stop being recordable.
 */

export type LinkCheck = {
  ok: boolean;
  status: number | null;
  /** Set when there is something worth telling the submitter. */
  warning: string | null;
};

const TIMEOUT_MS = 4000;

export async function checkEvidenceLink(
  url: string,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<LinkCheck> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, status: null, warning: 'ลิงก์ไม่ถูกต้อง' };
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { ok: false, status: null, warning: 'ใช้ได้เฉพาะลิงก์ http หรือ https' };
  }
  // Never let a submitted link make the server fetch its own network.
  if (/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[?::1)/i.test(parsed.hostname)) {
    return { ok: false, status: null, warning: 'ลิงก์ภายในเครื่อง คนอื่นเปิดไม่ได้' };
  }

  const doFetch = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await doFetch(parsed.toString(), {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': 'tungan-link-check' },
    });
    if (res.status === 401 || res.status === 403) {
      return {
        ok: true,
        status: res.status,
        warning: 'ลิงก์นี้ต้องขอสิทธิ์ก่อนเปิด · คนตรวจอาจเปิดไม่ได้ ลองตั้งเป็นใครมีลิงก์ก็เปิดได้',
      };
    }
    if (res.status === 404 || res.status === 410) {
      return { ok: true, status: res.status, warning: 'ลิงก์นี้เปิดไม่เจอ ตรวจอีกครั้ง' };
    }
    if (res.status >= 500) {
      return { ok: true, status: res.status, warning: null };
    }
    return { ok: true, status: res.status, warning: null };
  } catch {
    // A refused HEAD from a datacentre is common and means nothing about
    // whether a person can open it, so this is silent.
    return { ok: true, status: null, warning: null };
  } finally {
    clearTimeout(timer);
  }
}
