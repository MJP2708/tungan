'use client';

/**
 * Actions taken while offline.
 *
 * Front-line teams work on mobile data in places with no signal. A status
 * change that silently fails there is worse than one that visibly waits: the
 * person believes the work is recorded and stops thinking about it.
 *
 * Queued actions survive a reload, because the common case is not a brief
 * network blip — it is a phone put away in a basement and taken out an hour
 * later, by which time the tab has been discarded.
 */

import { api, ApiError } from './client.ts';

const STORAGE_KEY = 'tungan-pending-actions';
/** Give up after this many tries and surface it as a row-level error. */
const MAX_ATTEMPTS = 6;

export type QueuedAction = {
  id: string;
  taskId: string;
  /** What the row should look like while this is waiting. */
  optimisticStatus?: string;
  action:
    | 'accept' | 'info' | 'blocked' | 'handoff' | 'submit'
    | 'approve' | 'revision' | 'accept_handoff' | 'decline_handoff';
  extra: Record<string, unknown>;
  label: string;
  attempts: number;
  lastError?: string;
  queuedAt: number;
};

function read(): QueuedAction[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as QueuedAction[]) : [];
  } catch {
    // A corrupt queue must not brick the app; losing it is the lesser harm.
    return [];
  }
}

function write(items: QueuedAction[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Private mode, or full storage. The in-memory run still works.
  }
}

export function pending(): QueuedAction[] {
  return read();
}

export function pendingForTask(taskId: string): QueuedAction | null {
  return read().find((a) => a.taskId === taskId) ?? null;
}

export function enqueue(action: Omit<QueuedAction, 'id' | 'attempts' | 'queuedAt'>) {
  const items = read();
  items.push({ ...action, id: crypto.randomUUID(), attempts: 0, queuedAt: Date.now() });
  write(items);
  return items;
}

export function remove(id: string) {
  write(read().filter((a) => a.id !== id));
}

function backoffMs(attempts: number) {
  return Math.min(60_000, 2 ** attempts * 1000);
}

export type FlushResult = {
  sent: number;
  failed: QueuedAction[];
  stillQueued: number;
};

/**
 * Try to send everything waiting, oldest first.
 *
 * Order is preserved deliberately: two changes to the same task must land in
 * the order the person made them, or the last thing they did is not the state
 * they end up in.
 */
export async function flush(now = Date.now()): Promise<FlushResult> {
  const items = read();
  const result: FlushResult = { sent: 0, failed: [], stillQueued: 0 };
  if (!items.length) return result;

  const keep: QueuedAction[] = [];
  for (const item of items) {
    // Respect the backoff rather than hammering a server that just refused.
    if (item.attempts > 0 && now - item.queuedAt < backoffMs(item.attempts)) {
      keep.push(item);
      continue;
    }
    try {
      await api.moveTask(item.taskId, item.action, item.extra as never);
      result.sent += 1;
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 0;
      // A rejection is final: retrying a 403 or a 409 forever will never
      // succeed, and it hides the real problem from the person.
      const permanent = status >= 400 && status < 500;
      const next = {
        ...item,
        attempts: item.attempts + 1,
        lastError: error instanceof ApiError ? error.message : 'ส่งไม่สำเร็จ',
      };
      if (permanent || next.attempts >= MAX_ATTEMPTS) {
        result.failed.push(next);
      } else {
        keep.push(next);
      }
    }
  }
  write(keep);
  result.stillQueued = keep.length;
  return result;
}
