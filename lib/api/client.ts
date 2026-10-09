'use client';
import { t } from '../i18n/index.ts';
import { track, isBackgroundRequest } from './activity.ts';

// The UI's only route to data. Swapping transport later touches this file and
// nothing else, which is why no component may call fetch directly.

export type ApiWorkspace = {
  id: string;
  name: string;
  role: string;
  cutoff: string;
  quietHoursStart?: string;
  quietHoursEnd?: string;
  /** Connected to a LINE group (a team workspace). Only from /api/auth/me. */
  bound?: boolean;
};

export type ApiMember = {
  userId: string;
  displayName: string;
  nickname: string;
  role: string;
  /** False when the member has not added the OA as a friend. The UI must show
   *  this as a warning: they cannot receive reminder DMs. */
  canReceiveDirectMessages: boolean;
  /** ok | not_friend | not_signed_in — different problems, different fixes. */
  linkStatus: 'ok' | 'not_friend' | 'not_signed_in';
};

export type ApiGroup = {
  id: string;
  name: string;
  bound: boolean;
  workspaceId: string | null;
  workspaceName: string | null;
};

export type ApiTask = {
  id: string;
  workspaceId: string;
  title: string;
  note: string;
  assigneeUserId: string | null;
  primaryAssigneeUserId: string | null;
  source: string;
  /** ISO instant or null. Never a label, never a status word. */
  dueAt: string | null;
  /** `review` is รอตรวจ, `done` is closed. Submitting is not closing. */
  status: 'todo' | 'progress' | 'blocked' | 'review' | 'done';
  priority: string;
  reviewState: string;
  acceptedAt: string | null;
  submittedAt?: string | null;
  reviewerUserId?: string | null;
  closedAt?: string | null;
  createdByUserId?: string | null;
  evidenceUrl: string | null;
  /** Shared by every copy of a ทุกคน (@All) task. */
  batchId?: string | null;
  pendingAssigneeUserId?: string | null;
  blockedReason?: string | null;
  statusChangedAt?: string;
};

export type ApiInboxItem = {
  id: string;
  workspaceId: string;
  senderName: string;
  rawMessage: string | null;
  suggestedTitle: string;
  suggestedAssigneeUserId: string | null;
  suggestedDueAt: string | null;
  /** Tagged @All: confirming gives everyone their own copy. */
  assignAll?: boolean;
  confidence: 'explicit' | 'inferred' | 'fallback';
};

/** Something everyone in a workspace needs to know. */
export type ApiAnnouncement = {
  id: string;
  workspaceId: string;
  workspaceName: string;
  title: string;
  body: string;
  link?: string | null;
  authorName: string | null;
  createdAt: string;
  read: boolean;
  /** On the workspace history only. */
  readCount?: number;
  audience?: number;
  /** Who has not seen it: for the author, owners and admins; else null. */
  unreadNames?: string[] | null;
};

/** A calendar event, as the person asking may see it. */
export type ApiEvent = {
  id: string;
  workspaceId: string;
  title: string;
  note: string;
  link: string | null;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  audience: 'me' | 'everyone' | 'people';
  notifyMinutes: number | null;
  createdByUserId: string | null;
  createdByName: string | null;
  attendees: Array<{ userId: string; name: string }>;
  canEdit: boolean;
};

export type EventInputBody = {
  title: string;
  note?: string;
  link?: string | null;
  startsAt: string;
  endsAt?: string | null;
  allDay: boolean;
  audience: 'me' | 'everyone' | 'people';
  attendeeIds?: string[];
  notifyMinutes: number | null;
};

export class ApiError extends Error {
  // Assigned in the body rather than as a parameter property: Node's
  // type-stripping (used by the tests) does not support the shorthand.
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(
  path: string,
  init: RequestInit & { idempotencyKey?: string } = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('content-type', 'application/json');
  // Every mutating call carries a key so a retry cannot duplicate the work.
  if (init.idempotencyKey) headers.set('idempotency-key', init.idempotencyKey);

  const work = (async () => {
    const res = await fetch(path, { ...init, headers, credentials: 'same-origin' });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new ApiError(res.status, body.error ?? t('คำขอล้มเหลว ({0})', res.status));
    }
    return res.json() as Promise<T>;
  })();
  // Counted for the progress bar unless the app is only checking by itself.
  return isBackgroundRequest(path, init.method) ? work : track(work);
}

/** A fresh key per user action, reused across retries of that same action. */
export function newIdempotencyKey() {
  return crypto.randomUUID();
}

export const api = {
  me: () =>
    request<{
      user: {
        userId: string;
        lineUserId: string;
        displayName: string;
        /** Checked with LINE when the stored flag says no: false means
         *  no reminder can reach this person at all. */
        isOaFriend: boolean;
        /** Only when isOaFriend is false, and only if LINE answered. */
        addFriendUrl: string | null;
      };
      workspaces: ApiWorkspace[];
    }>('/api/auth/me'),

  logout: () => request<{ ok: true }>('/api/auth/logout', { method: 'POST' }),

  workspaces: () => request<{ workspaces: ApiWorkspace[] }>('/api/workspaces'),

  createWorkspace: (name: string) =>
    request<{ id: string; name: string }>('/api/workspaces', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  members: (workspaceId: string) =>
    request<{ members: ApiMember[]; completeness: string; completenessNote: string }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/members`,
    ),

  /** LINE groups this user has been seen in. */
  groups: () => request<{ groups: ApiGroup[] }>('/api/groups'),

  bindGroup: (groupId: string, workspaceId: string) =>
    request<{ ok: true }>(`/api/groups/${encodeURIComponent(groupId)}/bind`, {
      method: 'POST',
      body: JSON.stringify({ workspaceId }),
    }),

  /** Announcements this person has not closed, from every workspace they are in. */
  unreadAnnouncements: () =>
    request<{ announcements: ApiAnnouncement[] }>('/api/announcements'),

  /** Closed with X or รับทราบ: it will not pop up again, on any device. */
  readAnnouncement: (id: string) =>
    request<{ ok: true }>(`/api/announcements/${encodeURIComponent(id)}/read`, { method: 'POST' }),

  announcements: (workspaceId: string) =>
    request<{ announcements: ApiAnnouncement[] }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/announcements`,
    ),

  /** Owners and admins only; the server checks. */
  postAnnouncement: (
    workspaceId: string,
    input: { title: string; body: string; link?: string | null },
    idempotencyKey: string,
  ) =>
    request<{ id: string; replayed?: boolean }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/announcements`,
      { method: 'POST', body: JSON.stringify(input), idempotencyKey },
    ),

  deleteAnnouncement: (id: string) =>
    request<{ ok: true }>(`/api/announcements/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  /** Confirm several drafts exactly as read. Each is claimed, so none doubles. */
  confirmInboxBatch: (ids: string[]) =>
    request<{ created: number; skipped: number }>('/api/inbox/confirm-batch', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),

  /** My open tasks in every workspace I belong to. */
  myTasks: () =>
    request<{
      tasks: Array<{
        id: string; workspaceId: string; workspaceName: string; title: string;
        dueAt: string | null; status: string; pendingAssigneeUserId: string | null;
      }>;
    }>('/api/tasks?mine=1'),

  /** Create a workspace named after the group, owned by the caller, and bind it. */
  createGroupWorkspace: (groupId: string) =>
    request<{ workspaceId: string; name: string; membersGranted: number }>(
      `/api/groups/${encodeURIComponent(groupId)}/workspace`,
      { method: 'POST' },
    ),

  unbindGroup: (groupId: string) =>
    request<{ ok: true }>(`/api/groups/${encodeURIComponent(groupId)}/bind`, {
      method: 'DELETE',
    }),

  tasks: (workspaceId: string) =>
    request<{ tasks: ApiTask[] }>(
      `/api/tasks?workspaceId=${encodeURIComponent(workspaceId)}`,
    ),

  createTask: (
    input: {
      workspaceId: string;
      title: string;
      note?: string;
      assigneeUserId?: string | null;
      dueAt?: string | null;
      priority?: string;
      source?: string;
      /** ทุกคน: one copy per person who can be given work here. */
      assignAll?: boolean;
    },
    idempotencyKey: string,
  ) =>
    request<{ id: string; replayed?: boolean; batchId?: string | null; created?: number }>('/api/tasks', {
      method: 'POST',
      body: JSON.stringify(input),
      idempotencyKey,
    }),

  /** The five mobile transitions. */
  moveTask: (
    taskId: string,
    action:
      | 'accept' | 'info' | 'blocked' | 'handoff' | 'submit' | 'approve' | 'revision'
      | 'accept_handoff' | 'decline_handoff',
    extra: {
      assigneeUserId?: string; evidenceUrl?: string; note?: string;
      reason?: string; dueAt?: string;
      /** Who may read the note. ติดปัญหา defaults to private server-side. */
      visibility?: 'private' | 'workspace' | 'client';
    } = {},
  ) =>
    request<{
      ok: true;
      warning?: string | null;
      eventId?: string;
      visibility?: string;
      /** Plain Thai for who can read it, shown on the note itself. */
      audienceNote?: string;
    }>(
      `/api/tasks/${encodeURIComponent(taskId)}/status`,
      { method: 'POST', body: JSON.stringify({ action, ...extra }) },
    ),

  /** Reverse one change. Idempotent server-side, so a double tap is safe. */
  undo: (taskId: string, eventId: string) =>
    request<{ ok: true; alreadyUndone?: boolean }>(
      `/api/tasks/${encodeURIComponent(taskId)}/undo`,
      { method: 'POST', body: JSON.stringify({ eventId }) },
    ),

  updateTask: (
    taskId: string,
    patch: {
      title?: string; note?: string; dueAt?: string | null;
      assigneeUserId?: string | null; priority?: string; evidenceUrl?: string;
    },
  ) =>
    request<{ ok: true }>(`/api/tasks/${encodeURIComponent(taskId)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  deleteTask: (taskId: string) =>
    request<{ ok: true }>(`/api/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' }),

  reminders: (workspaceId: string) =>
    request<{ reminders: Array<{ id: string; title: string | null; sendAt: string; state: string; failureReason: string | null }> }>(
      `/api/reminders?workspaceId=${encodeURIComponent(workspaceId)}`,
    ),

  createReminder: (
    input: {
      workspaceId: string; taskId?: string | null; dueAt: string; leadMinutes?: number;
      /** What a personal reminder is about; shown in the list and the DM. */
      note?: string;
    },
    idempotencyKey: string,
  ) =>
    request<{ id: string; sendAt: string; shifted: string; reason: string }>('/api/reminders', {
      method: 'POST',
      body: JSON.stringify(input),
      idempotencyKey,
    }),

  updateReminder: (id: string, patch: { done?: boolean; sendAt?: string }) =>
    request<{ ok: true }>(`/api/reminders/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  deleteReminder: (id: string) =>
    request<{ ok: true }>(`/api/reminders/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  /** Turn AI help on or off for a workspace. Owners and admins only. */
  setWorkspaceAi: (workspaceId: string, aiEnabled: boolean) =>
    request<{ ok: true; aiEnabled: boolean }>(`/api/workspaces/${encodeURIComponent(workspaceId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ aiEnabled }),
    }),

  /** Rename a workspace. Owners and admins only (enforced server-side). */
  renameWorkspace: (workspaceId: string, name: string) =>
    request<{ ok: true; name: string }>(`/api/workspaces/${encodeURIComponent(workspaceId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),

  renameMember: (workspaceId: string, userId: string, nickname: string) =>
    request<{ ok: true }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(userId)}`,
      { method: 'PATCH', body: JSON.stringify({ nickname }) },
    ),

  inbox: (workspaceId: string) =>
    request<{ items: ApiInboxItem[] }>(
      `/api/inbox?workspaceId=${encodeURIComponent(workspaceId)}`,
    ),

  confirmInbox: (
    id: string,
    input: { title?: string; assigneeUserId?: string | null; assignAll?: boolean; dueAt?: string | null },
    idempotencyKey: string,
  ) =>
    request<{ id: string; replayed?: boolean; created?: number }>(
      `/api/inbox/${encodeURIComponent(id)}/confirm`,
      { method: 'POST', body: JSON.stringify(input), idempotencyKey },
    ),

  dismissInbox: (id: string) =>
    request<{ ok: true }>(`/api/inbox/${encodeURIComponent(id)}/dismiss`, {
      method: 'POST',
    }),

  questions: (taskId: string) =>
    request<{ questions: Array<{ id: string; question: string; answer: string | null; answeredAt: string | null; askedOfUserId: string; askedOfName: string | null }> }>(
      `/api/tasks/${encodeURIComponent(taskId)}/questions`,
    ),

  askQuestion: (taskId: string, askedOfUserId: string, question: string) =>
    request<{ id: string }>(`/api/tasks/${encodeURIComponent(taskId)}/questions`, {
      method: 'POST',
      body: JSON.stringify({ askedOfUserId, question }),
    }),

  answerQuestion: (questionId: string, answer: string) =>
    request<{ ok: true }>(`/api/questions/${encodeURIComponent(questionId)}/answer`, {
      method: 'POST',
      body: JSON.stringify({ answer }),
    }),

  /** Everything a reviewer needs, assembled server-side. */
  review: (taskId: string) =>
    request<{
      task: Record<string, unknown>;
      history: Array<{ kind: string; detail: string; at: string; actorName: string | null }>;
      questions: Array<{ question: string; answer: string | null; askedOfName: string | null }>;
      origin: string | null;
      canReview: boolean;
    }>(`/api/tasks/${encodeURIComponent(taskId)}/review`),

  /** Completed work with evidence links, for sending on to a client. */
  summary: (workspaceId: string, days = 30) =>
    request<{ days: number; count: number; text: string }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/summary?days=${days}`,
    ),

  /** Your own working hours in this workspace. */
  schedule: (workspaceId: string) =>
    request<{ startsAt: string; endsAt: string; source: string; note: string }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/schedule`,
    ),

  setSchedule: (workspaceId: string, startsAt: string, endsAt: string) =>
    request<{ ok: true }>(`/api/workspaces/${encodeURIComponent(workspaceId)}/schedule`, {
      method: 'PUT',
      body: JSON.stringify({ startsAt, endsAt }),
    }),

  /** What has not moved today, with how long it has been stuck. */
  sweep: (workspaceId: string) =>
    request<{ items: Array<{ id: string; title: string; status: string; blockedReason: string | null; daysInState: number; assigneeName: string | null; awaitingHandoff: boolean }> }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/sweep`,
    ),

  /** Tasks waiting on something, with what they need. */
  blocked: (workspaceId: string) =>
    request<{ items: Array<{ id: string; title: string; assigneeName: string | null; needs: string; since: string | null }> }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/blocked`,
    ),

  /** One task with its full history. */
  task: (taskId: string) =>
    request<{
      task: Record<string, unknown>;
      history: Array<{
        id: string; kind: string; detail: string; at: string;
        actorName: string | null;
        /** Notes you are not entitled to read never arrive at all. */
        visibility?: string; actorUserId?: string | null;
      }>;
    }>(`/api/tasks/${encodeURIComponent(taskId)}`),

  /** Cheap change probe for live updates. */
  /** Events between from and to that this person may see. */
  events: (workspaceId: string, from: string, to: string) =>
    request<{ events: ApiEvent[] }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    ),

  /** `recipients`: how many LINE messages one notification will use. */
  createEvent: (workspaceId: string, input: EventInputBody, idempotencyKey: string) =>
    request<{ id: string; recipients: number; replayed?: boolean }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/events`,
      { method: 'POST', body: JSON.stringify(input), idempotencyKey },
    ),

  updateEvent: (id: string, input: EventInputBody) =>
    request<{ id: string; recipients: number }>(`/api/events/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  deleteEvent: (id: string) =>
    request<{ ok: true }>(`/api/events/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  changes: (workspaceId: string) =>
    request<{ version: string; pendingInbox: number }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/changes`,
    ),

  /** Widen or narrow a note you wrote. Only its author may change it. */
  setEventVisibility: (eventId: string, visibility: 'private' | 'workspace' | 'client') =>
    request<{ ok: true; visibility: string }>(
      `/api/events/${encodeURIComponent(eventId)}/visibility`,
      { method: 'PATCH', body: JSON.stringify({ visibility }) },
    ),

  usage: (workspaceId: string) =>
    request<{
      month: string; used: number; cap: number; remaining: number;
      ai?: {
        configured: boolean; enabled: boolean; remaining: number;
        allowance: number; usedToday: number; dailyCap: number;
      };
    }>(
      `/api/usage?workspaceId=${encodeURIComponent(workspaceId)}`,
    ),
};
