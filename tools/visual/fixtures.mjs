// Made-up API answers for the visual harness. Every /api/* request the app
// makes is answered from here, so no database or LINE call ever happens.
const now = Date.now();
export const iso = (h) => new Date(now + h * 3600e3).toISOString();

export const me = {
  user: { userId: 'u1', lineUserId: 'U1', displayName: 'พิมพ์ชนก', isOaFriend: true },
  workspaces: [
    { id: 'w1', name: 'ทีม Operations ฝ่ายอีเวนต์และโปรดักชันภาคกลาง', role: 'owner', cutoff: '17:00' },
    { id: 'w2', name: 'งานของฉัน', role: 'owner', cutoff: '17:00' },
  ],
};
export const members = {
  completeness: 'known_members_only',
  completenessNote: 'แสดงเฉพาะสมาชิกที่เคยพูดในกลุ่มหรือเข้าใช้แอปแล้ว',
  members: [
    { userId: 'u1', displayName: 'พิมพ์ชนก', nickname: 'พิม', role: 'owner', canReceiveDirectMessages: true, linkStatus: 'ok' },
    { userId: 'u2', displayName: 'ศุภวัฒน์ เจริญพงศ์ไพศาล', nickname: 'ศุภวัฒน์ เจริญพงศ์ไพศาล', role: 'member', canReceiveDirectMessages: false, linkStatus: 'not_friend' },
    { userId: 'u3', displayName: 'เมย์', nickname: 'เมย์ 🌸', role: 'member', canReceiveDirectMessages: true, linkStatus: 'ok' },
    { userId: 'u4', displayName: 'Tony', nickname: 'โทนี่ (ฝ่ายขาย)', role: 'member', canReceiveDirectMessages: false, linkStatus: 'not_signed_in' },
  ],
};
const T = (id, title, status, due, who, extra = {}) => ({
  id, workspaceId: 'w1', title, note: '', assigneeUserId: who, primaryAssigneeUserId: who,
  source: 'LINE · กลุ่ม', dueAt: due, status, priority: 'normal',
  reviewState: status === 'review' ? 'review' : 'working',
  acceptedAt: status === 'todo' ? null : iso(-5), evidenceUrl: null, statusChangedAt: iso(-3), ...extra,
});
export const tasks = { tasks: [
  T('t1', 'ส่งใบเสนอราคาให้ลูกค้า ABC Corporation สำหรับงานเปิดตัวสินค้าไตรมาสสี่ พร้อมแนบแบบบูธ', 'todo', iso(3), 'u1'),
  T('t2', 'เช็คของหน้าร้าน', 'progress', iso(-2), 'u2'),
  T('t3', 'โทรหาลูกค้า', 'blocked', iso(20), 'u3', { blockedReason: 'รอลูกค้า' }),
  T('t4', 'สรุปงบประมาณอีเวนต์ Bangkok Design Week 2026 ส่งหัวหน้าก่อนประชุม', 'review', iso(28), 'u4', { evidenceUrl: 'https://example.com/a/very/long/path/that/should/wrap/somewhere/ok' }),
  T('t5', 'จองรถตู้', 'done', iso(-30), 'u1'),
  T('t6', 'Prepare the English deck for the sponsor meeting and send it to everyone', 'todo', null, null, { source: 'สร้างในทันงาน' }),
  T('t7', 'อัปเดตสถานะ', 'todo', iso(50), 'u3', { pendingAssigneeUserId: 'u1' }),
  T('t8', 'ออกแบบป้ายหน้างาน', 'progress', iso(30), 'u1'),
] };
export const inbox = { items: [
  { id: 'i1', workspaceId: 'w1', senderName: 'ศุภวัฒน์ เจริญพงศ์ไพศาล', rawMessage: '@ทันงาน @เมย์ ส่งใบเสนอราคาให้ ABC พรุ่งนี้ 16:00 แล้วก็โทรหาลูกค้าบ่าย 3 ด้วยนะครับ ขอบคุณครับ', suggestedTitle: 'ส่งใบเสนอราคาให้ ABC', suggestedAssigneeUserId: 'u3', suggestedDueAt: iso(26), confidence: 'explicit' },
  { id: 'i2', workspaceId: 'w1', senderName: 'เมย์', rawMessage: '@ทันงาน เช็คของ', suggestedTitle: 'เช็คของ', suggestedAssigneeUserId: null, suggestedDueAt: null, confidence: 'fallback' },
] };
const fixed = {
  '/api/auth/me': me,
  '/api/workspaces': { workspaces: me.workspaces },
  '/api/groups': { groups: [
    { id: 'g1', name: 'ทีม Ops 2026 (ห้ามลบ)', bound: true, workspaceId: 'w1', workspaceName: me.workspaces[0].name },
    { id: 'g2', name: 'ลูกค้า ABC x Agency', bound: false, workspaceId: null, workspaceName: null },
  ] },
  '/api/tasks': tasks,
  '/api/inbox': inbox,
  '/api/reminders': { reminders: [
    { id: 'r1', title: 'ส่งรายงานประจำสัปดาห์ให้หัวหน้าฝ่าย', sendAt: iso(2), state: 'pending', failureReason: null },
    { id: 'r2', title: null, sendAt: iso(-1), state: 'failed', failureReason: 'ผู้รับยังไม่ได้เพิ่มเพื่อน' },
  ] },
  '/api/usage': { month: '2026-09', used: 212, cap: 300, remaining: 88 },
};
const bySuffix = {
  schedule: { startsAt: '09:00', endsAt: '18:00', source: 'learned', note: 'เรียนรู้จากเวลาที่คุณอัปเดตงาน' },
  blocked: { items: [{ id: 't3', title: 'โทรหาลูกค้า', assigneeName: 'เมย์', needs: 'รอลูกค้า', since: iso(-20) }] },
  members,
  sweep: { items: [] },
  summary: { days: 30, count: 7, text: 'สรุปงานที่เสร็จแล้ว' },
  changes: { version: 'v1', pendingInbox: 2 },
  questions: { questions: [] },
  workspace: { workspaceId: 'w3', name: 'ลูกค้า ABC x Agency', membersGranted: 2 },
  'confirm-batch': { created: 2, skipped: 0 },
};

/** The JSON to answer a request with. `mine=1` gets tasks from another workspace. */
export function answer(url) {
  const u = new URL(url);
  if (u.pathname === '/api/tasks' && u.searchParams.get('mine') === '1') {
    return { tasks: [
      { id: 'x1', workspaceId: 'w2', workspaceName: 'งานของฉัน', title: 'ต่อทะเบียนรถ', dueAt: iso(5), status: 'todo', pendingAssigneeUserId: null },
    ] };
  }
  if (fixed[u.pathname]) return fixed[u.pathname];
  const key = Object.keys(bySuffix).find((k) => u.pathname.endsWith('/' + k));
  if (key) return bySuffix[key];
  const m = u.pathname.match(/^\/api\/tasks\/([^/]+)$/);
  if (m) return { task: tasks.tasks.find((t) => t.id === m[1]) ?? tasks.tasks[0], history: [
    { id: 'e1', kind: 'created', detail: 'สร้างจากข้อความ LINE', at: iso(-6), actorName: 'พิมพ์ชนก' },
    { id: 'e2', kind: 'blocked', detail: 'ติดปัญหา: รอลูกค้า · รอไฟล์ขนาดบูธ', at: iso(-3), actorName: 'เมย์', visibility: 'private' },
  ] };
  return { ok: true };
}

/** A signed-in phone page with every API call answered from fixtures. */
export async function fixturePage(browser, base, { width = 390, height = 844 } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    locale: 'th-TH', timezoneId: 'Asia/Bangkok',
  });
  // The session gate only checks that a cookie exists; the API is faked.
  await ctx.addCookies([{ name: 'tungan_session', value: 'fixture', url: base }]);
  const page = await ctx.newPage();
  const sent = [];
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => { errors.push('native dialog: ' + d.message()); void d.dismiss(); });
  await page.route('**/api/**', (route) => {
    const req = route.request();
    if (req.method() !== 'GET') {
      let body = null;
      try { body = req.postDataJSON(); } catch {}
      sent.push({ method: req.method(), path: new URL(req.url()).pathname, body });
    }
    return route.fulfill({ json: answer(req.url()) });
  });
  return { ctx, page, sent, errors };
}
