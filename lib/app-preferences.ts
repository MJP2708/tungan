import { t } from './i18n/index.ts';

export const appNavigation = [
  { page: 'home', get label() { return t('วันนี้'); }, icon: 'home' },
  { page: 'inbox', get label() { return t('จาก LINE'); }, icon: 'inbox' },
  { page: 'tasks', get label() { return t('งาน'); }, icon: 'tasks' },
  { page: 'calendar', get label() { return t('กำหนดส่ง'); }, icon: 'calendar' },
  { page: 'reports', get label() { return t('ภาพรวม'); }, icon: 'reports' },
  { page: 'reminders', get label() { return t('เตือนฉัน'); }, icon: 'reminders' },
  { page: 'ai', get label() { return t('AI'); }, icon: 'ai' },
  { page: 'manage', get label() { return t('ทีม'); }, icon: 'manage' },
  { page: 'settings', get label() { return t('ตั้งค่า'); }, icon: 'settings' },
] as const;

export type Page = (typeof appNavigation)[number]['page'];

/**
 * The small index line above each screen's title ("03 — TASKS"). Swiss
 * numbering in the atelier theme: it is rendered from a data attribute by
 * app/theme-atelier.css, so without that stylesheet nothing shows.
 */
const kickerWords: Record<Page, string> = {
  home: 'TODAY',
  inbox: 'FROM LINE',
  tasks: 'TASKS',
  calendar: 'DEADLINES',
  reports: 'OVERVIEW',
  reminders: 'REMINDERS',
  ai: 'ASSIST',
  manage: 'TEAM',
  settings: 'SETTINGS',
};
export function pageKicker(page: Page): string {
  const index = appNavigation.findIndex((item) => item.page === page) + 1;
  return `${String(index).padStart(2, '0')} — ${kickerWords[page]}`;
}
/**
 * Shorter labels for the phone's bottom bar only (master plan §4/§5). Five
 * items share ~350px there; the sidebar keeps the full wording.
 */
export const mobileNavLabels: Partial<Record<Page, string>> = {
  inbox: 'LINE',
  get reminders() { return t('เตือน'); },
};
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
  /** 'auto' follows the phone's language: Thai on a Thai phone, else English. */
  language: 'auto' | 'th' | 'en';
};

export const defaultSettings: AppSettings = {
  cutoff: '17:00',
  startPage: 'home',
  notificationBadge: true,
  showCompleted: true,
  reducedMotion: false,
  language: 'auto',
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
    language: ['auto', 'th', 'en'].includes(input.language as string)
      ? (input.language as AppSettings['language'])
      : defaultSettings.language,
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
