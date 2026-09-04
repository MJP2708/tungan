'use client';

// Maps API rows onto the shapes the existing screens already render.
//
// The UI keeps its own vocabulary (project, member, capture) so no component
// or piece of markup has to change when the backend replaced the seed data.
// Everything crossing this boundary is server-owned; nothing here invents data.

import { api, type ApiTask, type ApiMember, type ApiWorkspace, type ApiInboxItem } from './client.ts';

export type UiMember = {
  id: string;
  lineName: string;
  nickname: string;
  initials: string;
  role: string;
  /** False when they have not added the OA, so reminders cannot reach them. */
  canReceiveDirectMessages: boolean;
  linkStatus: 'ok' | 'not_friend' | 'not_signed_in';
};

export type UiProject = {
  id: string;
  name: string;
  source: 'line' | 'manual';
  groupLabel: string;
  members: UiMember[];
  teams: { id: string; name: string; memberIds: string[] }[];
};

export function initialsFor(name: string) {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length > 1) return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
  return (name ?? '').trim().slice(0, 2).toUpperCase() || '?';
}

export function toUiMember(m: ApiMember): UiMember {
  const nickname = m.nickname || m.displayName || 'ไม่ทราบชื่อ';
  return {
    id: m.userId,
    lineName: m.displayName || nickname,
    nickname,
    initials: initialsFor(nickname),
    role: m.role,
    canReceiveDirectMessages: m.canReceiveDirectMessages,
    linkStatus: m.linkStatus ?? 'ok',
  };
}

export function toUiProject(w: ApiWorkspace, members: ApiMember[]): UiProject {
  return {
    id: w.id,
    name: w.name,
    // A workspace linked to a LINE group is labelled as one; the personal
    // workspace created at first login is not.
    source: 'manual',
    groupLabel: w.name,
    members: members.map(toUiMember),
    teams: [],
  };
}

export type UiTask = {
  id: string;
  projectId: string;
  title: string;
  assigneeType: 'member' | 'team';
  assigneeId: string;
  primaryAssigneeType?: 'member' | 'team';
  primaryAssigneeId?: string;
  source: string;
  dueAt: string | null;
  status: 'todo' | 'progress' | 'blocked' | 'review' | 'done';
  priority: 'urgent' | 'high' | 'normal';
  note: string;
  activity: { text: string; time: string }[];
  evidence: { label: string; url: string }[];
  acceptedAt?: string;
  reviewState?: 'working' | 'review' | 'approved' | 'revision';
  /** Set while a handoff is waiting for this person to accept. */
  pendingAssigneeId?: string | null;
  blockedReason?: string | null;
  /** Who asked for the work. Null when nobody is recorded. */
  createdById?: string | null;
  submittedAt?: string | null;
  closedAt?: string | null;
};

export function toUiTask(t: ApiTask): UiTask {
  return {
    id: t.id,
    projectId: t.workspaceId,
    title: t.title,
    assigneeType: 'member',
    assigneeId: t.assigneeUserId ?? '',
    primaryAssigneeType: 'member',
    primaryAssigneeId: t.primaryAssigneeUserId ?? undefined,
    source: t.source,
    dueAt: t.dueAt,
    status: t.status,
    priority: (t.priority as UiTask['priority']) ?? 'normal',
    note: t.note ?? '',
    activity: [],
    evidence: t.evidenceUrl ? [{ label: 'ลิงก์หลักฐาน', url: t.evidenceUrl }] : [],
    acceptedAt: t.acceptedAt ?? undefined,
    reviewState: (t.reviewState as UiTask['reviewState']) ?? 'working',
    pendingAssigneeId: t.pendingAssigneeUserId ?? null,
    blockedReason: t.blockedReason ?? null,
    // Needed to decide whether this person may sign the work off. Somebody
    // who does a task cannot close it when someone else asked for it, so the
    // button must not be offered and then refused.
    createdById: t.createdByUserId ?? null,
    submittedAt: t.submittedAt ?? null,
    closedAt: t.closedAt ?? null,
  };
}

export type UiCapture = {
  id: string;
  projectId: string;
  sender: string;
  senderInitials: string;
  message: string;
  title: string;
  assigneeType: 'member' | 'team';
  assigneeId: string;
  dueText: string;
  dueAt: string | null;
  confidence: ApiInboxItem['confidence'];
  state: 'pending' | 'created' | 'dismissed';
};

export function toUiCapture(item: ApiInboxItem): UiCapture {
  return {
    id: item.id,
    projectId: item.workspaceId,
    sender: item.senderName || 'ไม่ทราบชื่อ',
    senderInitials: initialsFor(item.senderName),
    message: item.rawMessage ?? '(ข้อความถูกลบแล้ว)',
    title: item.suggestedTitle,
    assigneeType: 'member',
    assigneeId: item.suggestedAssigneeUserId ?? '',
    // The confirmation screen shows what was read, and low confidence is
    // shown as such rather than presented as a decision already made.
    dueText:
      item.confidence === 'fallback'
        ? 'ยังไม่ระบุเวลา'
        : (item.suggestedDueAt ?? 'ยังไม่ระบุเวลา'),
    dueAt: item.suggestedDueAt,
    confidence: item.confidence,
    state: 'pending',
  };
}

/** Load everything one workspace needs, in one place. */
export async function loadWorkspaceData(workspaceId: string) {
  const [membersRes, tasksRes, inboxRes] = await Promise.all([
    api.members(workspaceId),
    api.tasks(workspaceId),
    api.inbox(workspaceId),
  ]);
  return {
    members: membersRes.members,
    tasks: tasksRes.tasks.map(toUiTask),
    captures: inboxRes.items.map(toUiCapture),
  };
}
