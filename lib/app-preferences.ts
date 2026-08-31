export const appNavigation = [
  { page: 'home', label: 'วันนี้', icon: 'home' },
  { page: 'inbox', label: 'จาก LINE', icon: 'inbox' },
  { page: 'tasks', label: 'งาน', icon: 'tasks' },
  { page: 'calendar', label: 'กำหนดส่ง', icon: 'calendar' },
  { page: 'reports', label: 'ผลงาน', icon: 'reports' },
  { page: 'reminders', label: 'เตือนฉัน', icon: 'reminders' },
  { page: 'ai', label: 'AI', icon: 'ai' },
  { page: 'manage', label: 'ทีม', icon: 'manage' },
  { page: 'settings', label: 'ตั้งค่า', icon: 'settings' },
] as const;

export type Page = (typeof appNavigation)[number]['page'];
export const mobilePrimaryPages: readonly Page[] = [
  'home',
  'inbox',
  'tasks',
  'reminders',
];

export type AppSettings = {
  cutoff: string;
  startPage: Page;
  notificationBadge: boolean;
  showCompleted: boolean;
  reducedMotion: boolean;
};

export const defaultSettings: AppSettings = {
  cutoff: '17:00',
  startPage: 'home',
  notificationBadge: true,
  showCompleted: true,
  reducedMotion: false,
};

// Older device-local saves contain only cutoff and placeholder LINE preferences.
export function normalizeSettings(value: unknown): AppSettings {
  const input =
    value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {};
  return {
    cutoff:
      typeof input.cutoff === 'string' &&
      /^([01]\d|2[0-3]):[0-5]\d$/.test(input.cutoff)
        ? input.cutoff
        : defaultSettings.cutoff,
    startPage: appNavigation.some(({ page }) => page === input.startPage)
      ? (input.startPage as Page)
      : defaultSettings.startPage,
    notificationBadge:
      typeof input.notificationBadge === 'boolean'
        ? input.notificationBadge
        : defaultSettings.notificationBadge,
    showCompleted:
      typeof input.showCompleted === 'boolean'
        ? input.showCompleted
        : defaultSettings.showCompleted,
    reducedMotion:
      typeof input.reducedMotion === 'boolean'
        ? input.reducedMotion
        : defaultSettings.reducedMotion,
  };
}

export function visibleInTaskList(
  status: string,
  filter: string,
  showCompleted: boolean,
) {
  return filter === 'all'
    ? showCompleted || status !== 'done'
    : status === filter;
}
