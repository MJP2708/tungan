'use client';

// The UI's only route to data. Swapping transport later touches this file and
// nothing else, which is why no component may call fetch directly.

export type ApiWorkspace = {
  id: string;
  name: string;
  role: string;
  cutoff: string;
  quietHoursStart?: string;
  quietHoursEnd?: string;
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
  status: 'todo' | 'progress' | 'blocked' | 'done';
  priority: string;
  reviewState: string;
  acceptedAt: string | null;
  evidenceUrl: string | null;
};

export type ApiInboxItem = {
  id: string;
  workspaceId: string;
  senderName: string;
  rawMessage: string | null;
  suggestedTitle: string;
  suggestedAssigneeUserId: string | null;
  suggestedDueAt: string | null;
  confidence: 'explicit' | 'inferred' | 'fallback';
};

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
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

  const res = await fetch(path, { ...init, headers, credentials: 'same-origin' });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(res.status, body.error ?? `คำขอล้มเหลว (${res.status})`);
  }
  return res.json() as Promise<T>;
}

/** A fresh key per user action, reused across retries of that same action. */
export function newIdempotencyKey() {
  return crypto.randomUUID();
}

export const api = {
  me: () =>
    request<{
      user: { userId: string; lineUserId: string; displayName: string; isOaFriend: boolean };
      workspaces: ApiWorkspace[];
    }>('/api/auth/me'),

  logout: () => request<{ ok: true }>('/api/auth/logout', { method: 'POST' }),

  workspaces: () => request<{ workspaces: ApiWorkspace[] }>('/api/workspaces'),

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
    },
    idempotencyKey: string,
  ) =>
    request<{ id: string; replayed?: boolean }>('/api/tasks', {
      method: 'POST',
      body: JSON.stringify(input),
      idempotencyKey,
    }),

  /** The five mobile transitions. */
  moveTask: (
    taskId: string,
    action: 'accept' | 'info' | 'blocked' | 'handoff' | 'submit',
    extra: { assigneeUserId?: string; evidenceUrl?: string } = {},
  ) =>
    request<{ ok: true }>(`/api/tasks/${encodeURIComponent(taskId)}/status`, {
      method: 'POST',
      body: JSON.stringify({ action, ...extra }),
    }),

  inbox: (workspaceId: string) =>
    request<{ items: ApiInboxItem[] }>(
      `/api/inbox?workspaceId=${encodeURIComponent(workspaceId)}`,
    ),

  confirmInbox: (
    id: string,
    input: { title?: string; assigneeUserId?: string | null; dueAt?: string | null },
    idempotencyKey: string,
  ) =>
    request<{ id: string; replayed?: boolean }>(
      `/api/inbox/${encodeURIComponent(id)}/confirm`,
      { method: 'POST', body: JSON.stringify(input), idempotencyKey },
    ),

  dismissInbox: (id: string) =>
    request<{ ok: true }>(`/api/inbox/${encodeURIComponent(id)}/dismiss`, {
      method: 'POST',
    }),

  usage: (workspaceId: string) =>
    request<{ month: string; used: number; cap: number; remaining: number }>(
      `/api/usage?workspaceId=${encodeURIComponent(workspaceId)}`,
    ),
};
