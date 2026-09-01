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
    action:
      | 'accept' | 'info' | 'blocked' | 'handoff' | 'submit' | 'approve' | 'revision'
      | 'accept_handoff' | 'decline_handoff',
    extra: { assigneeUserId?: string; evidenceUrl?: string; note?: string; reason?: string } = {},
  ) =>
    request<{ ok: true }>(`/api/tasks/${encodeURIComponent(taskId)}/status`, {
      method: 'POST',
      body: JSON.stringify({ action, ...extra }),
    }),

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
    input: { workspaceId: string; taskId?: string | null; dueAt: string; leadMinutes?: number },
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
      history: Array<{ id: string; kind: string; detail: string; at: string; actorName: string | null }>;
    }>(`/api/tasks/${encodeURIComponent(taskId)}`),

  /** Cheap change probe for live updates. */
  changes: (workspaceId: string) =>
    request<{ version: string; pendingInbox: number }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/changes`,
    ),

  usage: (workspaceId: string) =>
    request<{ month: string; used: number; cap: number; remaining: number }>(
      `/api/usage?workspaceId=${encodeURIComponent(workspaceId)}`,
    ),
};
