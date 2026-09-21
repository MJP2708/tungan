'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  Bell,
  Bot,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock3,
  ExternalLink,
  Inbox,
  LayoutGrid,
  Link2,
  ListTodo,
  LogIn,
  LogOut,
  Menu,
  MessageCircle,
  Pencil,
  Play,
  Plus,
  BrainCircuit,
  LockKeyhole,
  Search,
  Send,
  Settings2,
  Share2,
  ShieldCheck,
  Sparkles,
  Users,
  UserRound,
  X,
  Hourglass,
  PencilLine,
} from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { TaskEntryDialog } from '@/components/task-entry-dialog';
import {
  validateTaskEntry,
  type EntryError,
} from '@/lib/task-entry';
import {
  resolveDeadline,
  formatDeadline,
  isOverdue,
  dayBucket,
  fromZonedWallClock,
  zonedDateParts,
  quickDayDate,
  relativeDeadline,
  type DayBucket,
} from '@/lib/deadline';
import { th } from 'date-fns/locale';
import { api, ApiError, newIdempotencyKey } from '@/lib/api/client';
import { taskIdFromSearch } from '@/lib/deep-link.ts';
import { BLOCKED_REASONS } from '@/lib/tasks/reasons';
import { initialsFor } from '@/lib/initials';
import { mayEditTaskFields } from '@/lib/tasks/permissions';
import { useToast, ToastHost } from '@/components/toast-host';
import * as queue from '@/lib/api/queue';
import { toUiTask, toUiCapture, toUiMember } from '@/lib/api/adapters';
import {
  appNavigation,
  mobilePrimaryPages,
  mobileNavLabels,
  defaultSettings,
  normalizeSettings,
  visibleInTaskList,
  type AppSettings,
  type Page,
} from '@/lib/app-preferences';

/** `review` is รอตรวจ and `done` is closed. Submitting is not closing:
 *  the worker hands in, somebody with review rights signs off. */
type Status = 'todo' | 'progress' | 'blocked' | 'review' | 'done';
type Priority = 'urgent' | 'high' | 'normal';
type ReviewState = 'working' | 'review' | 'approved' | 'revision';
type ManageTab = 'members' | 'teams' | 'projects' | 'ai';
type ProjectSource = 'line' | 'manual';
type Evidence = { label: string; url: string };
type Member = {
  id: string;
  lineName: string;
  nickname: string;
  initials: string;
  role: string;
  /** ok | not_friend (cannot receive DMs) | not_signed_in (never opened the app) */
  linkStatus?: 'ok' | 'not_friend' | 'not_signed_in';
};
type Account = {
  loggedIn: boolean;
  lineConnected: boolean;
  lineName: string;
  displayName: string;
};
type Team = { id: string; name: string; memberIds: string[] };
type Project = {
  id: string;
  name: string;
  source: ProjectSource;
  groupLabel: string;
  members: Member[];
  teams: Team[];
};
type Task = {
  id: string;
  projectId: string;
  title: string;
  assigneeType: 'member' | 'team';
  assigneeId: string;
  primaryAssigneeType?: 'member' | 'team';
  primaryAssigneeId?: string;
  source: string;
  /** Real instant, resolved in Asia/Bangkok when the task was created.
   *  null means no deadline was ever set — never a status word. */
  dueAt: string | null;
  status: Status;
  priority: Priority;
  note: string;
  activity: { text: string; time: string }[];
  evidence: Evidence[];
  acceptedAt?: string;
  reviewState?: ReviewState;
  /** Set while a handoff is waiting for this person to accept. */
  pendingAssigneeId?: string | null;
  blockedReason?: string | null;
  /** Who asked for the work. Decides who may sign it off. */
  createdById?: string | null;
  submittedAt?: string | null;
  closedAt?: string | null;
};
type Capture = {
  id: string;
  projectId: string;
  sender: string;
  senderInitials: string;
  message: string;
  title: string;
  assigneeType: 'member' | 'team';
  assigneeId: string;
  /** What the sender wrote, shown for confirmation. */
  dueText: string;
  /** What the rules read out of it, or null when nothing was named. */
  dueAt: string | null;
  confidence: 'explicit' | 'inferred' | 'fallback';
  state: 'pending' | 'created' | 'dismissed';
};
type Reminder = {
  id: string;
  title: string;
  date: string;
  time: string;
  repeat: 'once' | 'daily' | 'weekly';
  done: boolean;
  /** Set when a send failed, so a dropped reminder is visible not silent. */
  failureReason?: string | null;
};

/** Stands in until the first workspace arrives from the server, so the shell
 *  renders an empty state instead of crashing on `projects[0]`. */
const EMPTY_PROJECT: Project = {
  id: '',
  name: 'ยังไม่มีพื้นที่งาน',
  source: 'manual',
  groupLabel: 'เชื่อมกลุ่ม LINE หรือสร้างงานของคุณเอง',
  members: [],
  teams: [],
};

const statusMeta: Record<Status, { label: string; icon: typeof Circle }> = {
  todo: { label: 'ต้องทำ', icon: Circle },
  progress: { label: 'กำลังทำ', icon: Play },
  blocked: { label: 'ติดปัญหา', icon: AlertCircle },
  // Deliberately not "เสร็จแล้ว". The worker has handed in; nobody has agreed
  // it is finished yet, and wording that says otherwise is what let the
  // approval step be skipped in practice.
  review: { label: 'รอตรวจ', icon: Hourglass },
  done: { label: 'ปิดงานแล้ว', icon: CheckCircle2 },
};
const navigationIcons = {
  home: LayoutGrid,
  inbox: Inbox,
  tasks: ListTodo,
  calendar: CalendarDays,
  reports: BarChart3,
  reminders: Bell,
  ai: Bot,
  manage: Users,
  settings: Settings2,
};

/** For the seeded task that is deliberately late. */

const timeOptions = Array.from(
  { length: 96 },
  (_, index) =>
    `${String(Math.floor(index / 4)).padStart(2, '0')}:${String((index % 4) * 15).padStart(2, '0')}`,
);

function PersonAvatar({
  initials,
  size = 'default',
}: {
  initials: string;
  size?: 'sm' | 'default' | 'lg';
}) {
  return (
    <Avatar size={size}>
      <AvatarFallback className="avatar-mono">{initials}</AvatarFallback>
    </Avatar>
  );
}
function StatusChip({ status }: { status: Status }) {
  const Icon = statusMeta[status].icon;
  return (
    <span className={`status-chip status-${status}`}>
      <Icon />
      {statusMeta[status].label}
    </span>
  );
}
function Brand({ mobile = false }: { mobile?: boolean }) {
  return (
    <div className={mobile ? 'mobile-wordmark' : 'wordmark'}>
      <span className="brand-art" aria-hidden="true">
        <Image
          src="/tungan-logo-th.png"
          width={1774}
          height={887}
          alt=""
          priority
        />
      </span>
      <span className="sr-only">ทันงาน</span>
    </div>
  );
}
/** Shaped like the real rows so the layout does not jump when data arrives. */
function SkeletonList({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div className="skeleton-row" key={i}>
          <div className="skeleton-bar wide" />
          <div className="skeleton-bar mid" />
          <div className="skeleton-bar narrow" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty-state">
      <CheckCircle2 />
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  );
}

/** A stored instant as the date and HH:MM a person in Bangkok would read. */
function bangkokWallClock(iso: string) {
  const at = new Date(iso);
  if (!Number.isFinite(at.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const n = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return {
    year: Number(n('year')),
    month: Number(n('month')),
    day: Number(n('day')),
    time: `${n('hour')}:${n('minute')}`,
  };
}

/** Device preferences, saved per phone. */
const SETTINGS_KEY = 'tungan-device-settings-v1';

/**
 * Where a task came from, in words.
 *
 * Stored values are 'LINE · กลุ่ม', 'LINE · DM' and 'สร้างในทันงาน' (plus the
 * bare 'line'/'manual' older rows used). Anything else is shown as written
 * rather than mislabelled.
 */
function sourceLabel(source: string) {
  if (source === 'LINE · กลุ่ม') return 'จากกลุ่ม LINE';
  if (source === 'LINE · DM') return 'จากแชท LINE';
  if (/^line\b/i.test(source)) return 'จาก LINE';
  if (source === 'สร้างในทันงาน' || source === 'manual' || !source) return 'สร้างในแอป';
  return source;
}

function deadlineRank(task: Task) {
  if (!task.dueAt) return Number.MAX_SAFE_INTEGER;
  const at = new Date(task.dueAt).getTime();
  return Number.isFinite(at) ? at : Number.MAX_SAFE_INTEGER;
}

function nicknameAcrossProjects(
  projects: Project[],
  lineName: string,
  nickname: string,
) {
  return projects.map((project) => ({
    ...project,
    members: project.members.map((member) =>
      member.lineName === lineName
        ? { ...member, nickname, initials: initialsFor(nickname) }
        : member,
    ),
  }));
}

function normalizeTask(task: Task): Task {
  const activity = task.activity || [];
  // Saves from the prototype carried a Thai label in `due` ("วันนี้ 16:00",
  // and also status words like "เสร็จ 11:24"). Those are ambiguous — the day
  // they referred to is unrecoverable — so they are dropped rather than
  // guessed, and the task shows as having no deadline until someone sets one.
  const legacy = task as Task & { due?: unknown };
  const dueAt =
    typeof task.dueAt === 'string' && Number.isFinite(new Date(task.dueAt).getTime())
      ? task.dueAt
      : null;
  if (legacy.due !== undefined) delete legacy.due;
  const acceptedEvent = activity.find((item) => item.text.includes('รับงานแล้ว'));
  const reviewEvent = activity.some((item) =>
    item.text.includes('ส่งงานให้ตรวจ'),
  );
  return {
    ...task,
    dueAt,
    evidence: task.evidence || [],
    activity,
    acceptedAt: task.acceptedAt || acceptedEvent?.time,
    reviewState:
      task.reviewState ||
      (task.status === 'done'
        ? 'approved'
        : reviewEvent
          ? 'review'
          : 'working'),
  };
}

/** Current time, refreshed every minute so day boundaries are honoured. */
function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export default function Home() {
  const now = useNow();
  const [page, setPage] = useState<Page>('home');
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState('mine');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  // Device preferences only (start page, show completed, reduced motion).
  // They were never saved, so every reload reset them while the page said
  // "บันทึกในอุปกรณ์นี้". A fresh key: prototype data is never read back.
  const settingsLoaded = useRef(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) setSettings(normalizeSettings(JSON.parse(raw)));
    } catch {
      // Blocked or corrupt storage: defaults are fine.
    }
    settingsLoaded.current = true;
  }, []);
  useEffect(() => {
    if (!settingsLoaded.current) return;
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // Private mode or full storage: the setting still applies this session.
    }
  }, [settings]);
  const [menuOpen, setMenuOpen] = useState(false);
  // Filled from the server session. Nothing here is trusted from the browser.
  const [account, setAccount] = useState<Account>({
    loggedIn: false,
    lineConnected: false,
    lineName: '',
    displayName: '',
  });
  const [meUserId, setMeUserId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<{ used: number; cap: number; remaining: number } | null>(null);
  const [schedule, setSchedule] = useState<{ startsAt: string; endsAt: string; note: string } | null>(null);
  const [online, setOnline] = useState(true);
  const [queued, setQueued] = useState<queue.QueuedAction[]>([]);
  const [blockedItems, setBlockedItems] = useState<
    { id: string; title: string; assigneeName: string | null; needs: string }[]
  >([]);
  const [questions, setQuestions] = useState<
    { id: string; question: string; answer: string | null; answeredAt: string | null; askedOfUserId: string; askedOfName: string | null }[]
  >([]);
  const [history, setHistory] = useState<
    {
      id: string; kind: string; detail: string; at: string;
      actorName: string | null;
      /** Who can read this note. Shown on the note itself. */
      visibility?: string; actorUserId?: string | null;
    }[]
  >([]);
  // My open tasks in every workspace, so nobody has to switch to find them.
  const [myTasksEverywhere, setMyTasksEverywhere] = useState<
    Awaited<ReturnType<typeof api.myTasks>>['tasks']
  >([]);
  const [lineGroups, setLineGroups] = useState<
    { id: string; name: string; bound: boolean; workspaceName: string | null }[]
  >([]);
  const [hydrated, setHydrated] = useState(false);
  // An id, not a copy. A copy went stale the moment the list refreshed, and
  // every action then wrote that stale object back (BUG-7).
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;
  const setSelectedTask = (task: Task | null) => setSelectedTaskId(task?.id ?? null);
  const [taskDialog, setTaskDialog] = useState(false);
  // The same entry sheet edits an existing task or corrects a LINE draft
  // before it becomes one. Null means "create a new task".
  const [editTarget, setEditTarget] = useState<
    { kind: 'task'; task: Task } | { kind: 'capture'; capture: Capture } | null
  >(null);
  // Editing must not invent a deadline: it is only sent if the person
  // actually touched the deadline controls.
  const [dueTouched, setDueTouched] = useState(false);
  // One themed sheet for the small decisions that used to be window.prompt:
  // ติดปัญหา, ขอข้อมูล, ขอแก้ไข, answering, working hours. In LINE's WebView
  // those were grey browser boxes asking people to type a NUMBER to pick a
  // reason or a person.
  const [actionSheet, setActionSheet] = useState<
    | { kind: 'blocked'; task: Task }
    | { kind: 'ask'; task: Task }
    | { kind: 'revision'; task: Task }
    | { kind: 'answer'; questionId: string; question: string }
    | { kind: 'schedule' }
    | null
  >(null);
  const [sheetReason, setSheetReason] = useState('');
  const [sheetShare, setSheetShare] = useState(false);
  const [sheetPerson, setSheetPerson] = useState('');
  const [sheetDays, setSheetDays] = useState(2);
  const [sheetStart, setSheetStart] = useState('09:00');
  const [sheetEnd, setSheetEnd] = useState('18:00');
  const [sheetText, setSheetText] = useState('');
  const [sheetError, setSheetError] = useState('');
  const [forwardDialog, setForwardDialog] = useState(false);
  const [clientApprovalOpen, setClientApprovalOpen] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [teamDialog, setTeamDialog] = useState(false);
  const [projectDialog, setProjectDialog] = useState(false);
  const [reminderDialog, setReminderDialog] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notificationsSeen, setNotificationsSeen] = useState(false);
  const [nicknameMember, setNicknameMember] = useState<Member | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | Status>('all');
  const [calendarDay, setCalendarDay] = useState<DayBucket>('today');
  const [manageTab, setManageTab] = useState<ManageTab>('members');
  const [deadlineMode, setDeadlineMode] = useState<'picker' | 'natural'>(
    'picker',
  );
  const [naturalDeadline, setNaturalDeadline] = useState('');
  const { toast, show: showToast, dismiss: dismissToast } = useToast();
  // Kept so the 32 existing call sites keep working; they now route to the
  // toast rather than the old inline strip.
  const setNotice = (text: string) => {
    if (text) showToast({ text });
  };
  const [taskAssignee, setTaskAssignee] = useState('');
  const [taskPriority, setTaskPriority] = useState<Priority>('normal');
  const [taskDueDay, setTaskDueDay] =
    useState<'today' | 'tomorrow' | 'friday' | 'nextweek' | 'later'>('today');
  const [taskTime, setTaskTime] = useState('17:00');
  const [taskDate, setTaskDate] = useState<Date | undefined>();
  const [projectSource, setProjectSource] = useState<ProjectSource>('manual');
  const [reminderRepeat, setReminderRepeat] =
    useState<Reminder['repeat']>('once');
  const [delegateTarget, setDelegateTarget] = useState('');
  const [reminderDay, setReminderDay] = useState<'today' | 'tomorrow'>(
    'tomorrow',
  );
  const [reminderTime, setReminderTime] = useState('09:00');
  const [quickReminderTitle, setQuickReminderTitle] = useState('');
  const [quickReminderDay, setQuickReminderDay] = useState<
    'today' | 'tomorrow'
  >('today');
  const [quickReminderTime, setQuickReminderTime] = useState('17:00');
  const [forwardProjectId, setForwardProjectId] = useState('');
  const [forwardAssignee, setForwardAssignee] = useState('');
  const [forwardDueDay, setForwardDueDay] = useState<
    'today' | 'tomorrow' | 'later'
  >('today');
  const [forwardDate, setForwardDate] = useState<Date | undefined>();
  const [forwardTime, setForwardTime] = useState('17:00');
  const [taskError, setTaskError] = useState<EntryError | null>(null);
  const [forwardError, setForwardError] = useState<EntryError | null>(null);
  const selectedProject =
    projects.find((project) => project.id === selectedProjectId) ||
    projects[0] ||
    EMPTY_PROJECT;
  const taskProject =
    selectedProjectId === 'mine'
      ? projects.find((project) => project.id === 'personal') || selectedProject
      : selectedProject;
  const forwardProject =
    projects.find((project) => project.id === forwardProjectId) ||
    projects.find((project) => project.source === 'line') ||
    taskProject;

  // The server is the only source of truth for application data. Prototype
  // localStorage is deliberately not imported: it belongs to nobody.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await api.me();
        if (cancelled) return;
        setMeUserId(me.user.userId);
        setAccount({
          loggedIn: true,
          lineConnected: me.user.isOaFriend,
          lineName: me.user.displayName,
          displayName: me.user.displayName,
        });

        const list = me.workspaces;
        if (!list.length) {
          setProjects([]);
          setLoading(false);
          setHydrated(true);
          return;
        }

        // Everything below depends only on the workspace id, so it goes out in
        // one round trip rather than nine. On mobile data the difference is the
        // gap between a screen that appears and one that looks broken.
        const current = list[0];
        const [membersRes, tasksRes, inboxRes] = await Promise.all([
          api.members(current.id),
          api.tasks(current.id),
          api.inbox(current.id),
          refreshGroups(),
          refreshMyTasks(),
          refreshReminders(current.id),
          refreshBlocked(current.id),
          refreshUsage(current.id),
          refreshSchedule(current.id),
        ]);
        if (cancelled) return;
        setProjects(
          list.map((w) => ({
            id: w.id,
            name: w.name,
            source: 'manual' as const,
            groupLabel: w.name,
            members: w.id === current.id ? membersRes.members.map(toUiMember) : [],
            teams: [],
          })),
        );
        setSelectedProjectId(current.id);
        setSettings((prev) => ({ ...prev, cutoff: current.cutoff || prev.cutoff }));
        setTasks(tasksRes.tasks.map(toUiTask) as Task[]);
        setCaptures(inboxRes.items.map(toUiCapture) as unknown as Capture[]);
      } catch (error) {
        if (cancelled) return;
        // The cookie was there but the session behind it has ended. Go and
        // sign in again, and come back to the same place afterwards.
        if (error instanceof ApiError && error.status === 401) {
          const here = window.location.pathname + window.location.search;
          window.location.replace(
            here === '/' ? '/login' : `/login?next=${encodeURIComponent(here)}`,
          );
          return;
        }
        setLoadError(
          error instanceof ApiError ? error.message : 'โหลดข้อมูลไม่สำเร็จ',
        );
      } finally {
        if (!cancelled) {
          setLoading(false);
          setHydrated(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // A LINE link to one task: `?task=<id>`, or the same wrapped in liff.state
  // on the first hop through LIFF. Opened once, after the first load.
  const deepLinkHandled = useRef(false);
  useEffect(() => {
    if (!hydrated || deepLinkHandled.current) return;
    deepLinkHandled.current = true;
    const taskId = taskIdFromSearch(window.location.search);
    if (!taskId) return;
    // Drop it from the address so a refresh or Back does not reopen it.
    window.history.replaceState(null, '', window.location.pathname);
    if (tasks.some((task) => task.id === taskId)) {
      setSelectedTaskId(taskId);
      return;
    }
    // It lives in another workspace. The server decides whether this person
    // may see it; the id in the link grants nothing by itself.
    void (async () => {
      try {
        const res = await api.task(taskId);
        const workspaceId = String(res.task.workspaceId ?? '');
        if (!workspaceId) return;
        setSelectedProjectId(workspaceId);
        await refreshWorkspace(workspaceId);
        setSelectedTaskId(taskId);
      } catch (error) {
        reportError(error, 'เปิดงานจากลิงก์ไม่สำเร็จ');
      }
    })();
  }, [hydrated, tasks]);

  useEffect(() => {
    document.documentElement.dataset.motion = settings.reducedMotion
      ? 'reduced'
      : 'system';
    return () => {
      delete document.documentElement.dataset.motion;
    };
  }, [settings.reducedMotion]);
  useEffect(() => {
    if (!taskDialog) {
      // Cleared after the close animation, so the closing sheet does not
      // flash "สร้างงาน" over the task that was just edited.
      const t = window.setTimeout(() => setEditTarget(null), 300);
      return () => window.clearTimeout(t);
    }
    setTaskError(null);
    setDeadlineMode('picker');
    setNaturalDeadline('');
    setDueTouched(false);
    const editing =
      editTarget?.kind === 'task'
        ? { assignee: editTarget.task.assigneeId, dueAt: editTarget.task.dueAt, priority: editTarget.task.priority }
        : editTarget?.kind === 'capture'
          ? { assignee: editTarget.capture.assigneeId, dueAt: editTarget.capture.dueAt, priority: 'normal' as Priority }
          : null;
    if (editing) {
      setTaskAssignee(editing.assignee ? `member:${editing.assignee}` : '');
      setTaskPriority(editing.priority);
      const wall = editing.dueAt ? bangkokWallClock(editing.dueAt) : null;
      // Shown as the date it already has, so saving without touching it
      // changes nothing.
      // Highlight a quick button when the date is one of them, rather than
      // opening the full calendar for "tomorrow".
      const preset = wall
        ? (['today', 'tomorrow', 'friday', 'nextweek'] as const).find((key) => {
            const d = quickDayDate(key, { now, endOfDay: settings.cutoff });
            return d.year === wall.year && d.month === wall.month && d.day === wall.day;
          })
        : undefined;
      setTaskDueDay(preset ?? (wall ? 'later' : 'today'));
      setTaskDate(wall && !preset ? new Date(wall.year, wall.month - 1, wall.day) : undefined);
      setTaskTime(wall ? wall.time : settings.cutoff);
      return;
    }
    setTaskAssignee(
      taskProject.members[0] ? `member:${taskProject.members[0].id}` : '',
    );
    setTaskPriority('normal');
    setTaskDueDay('today');
    setTaskTime(settings.cutoff);
    setTaskDate(undefined);
  }, [taskDialog, taskProject.id, settings.cutoff, editTarget]);
  useEffect(() => {
    if (!selectedTask) {
      setHistory([]);
      return;
    }
    setDelegateTarget(`${selectedTask.assigneeType}:${selectedTask.assigneeId}`);
    // The activity log lives on the server, so it shows what everyone did,
    // not only what this browser happened to do.
    let cancelled = false;
    api
      .task(selectedTask.id)
      .then((res) => {
        if (!cancelled) setHistory(res.history);
      })
      .catch(() => {
        if (!cancelled) setHistory([]);
      });
    api
      .questions(selectedTask.id)
      .then((res) => {
        if (!cancelled) setQuestions(res.questions);
      })
      .catch(() => {
        if (!cancelled) setQuestions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedTask?.id]);
  useEffect(() => {
    if (reminderDialog) {
      setReminderDay('tomorrow');
      setReminderTime('09:00');
      setReminderRepeat('once');
    }
  }, [reminderDialog]);
  useEffect(() => {
    if (!forwardDialog) return;
    setForwardError(null);
    const preferred =
      selectedProject.source === 'line'
        ? selectedProject
        : projects.find((project) => project.source === 'line') || taskProject;
    setForwardProjectId(preferred.id);
    setForwardAssignee(
      preferred.members[0] ? `member:${preferred.members[0].id}` : '',
    );
    setForwardDueDay('today');
    setForwardDate(undefined);
    setForwardTime(settings.cutoff);
  }, [forwardDialog, selectedProject.id, settings.cutoff]);

  /** Re-read the workspace after a mutation. The UI never claims a change the
   *  server has not confirmed. */
  async function refreshWorkspace(workspaceId: string) {
    const [tasksRes, inboxRes] = await Promise.all([
      api.tasks(workspaceId),
      api.inbox(workspaceId),
      refreshMyTasks(),
    ]);
    setTasks(tasksRes.tasks.map(toUiTask) as Task[]);
    setCaptures(inboxRes.items.map(toUiCapture) as unknown as Capture[]);
    await Promise.all([
      loadMembers(workspaceId),
      refreshReminders(workspaceId),
      refreshBlocked(workspaceId),
      refreshUsage(workspaceId),
      refreshSchedule(workspaceId),
    ]);
  }

  // Offline handling.
  //
  // Front-line teams work where there is no signal. A change that silently
  // fails there is worse than one that visibly waits, because the person
  // believes it is recorded and stops thinking about it.
  useEffect(() => {
    const sync = async () => {
      const res = await queue.flush();
      setQueued(queue.pending());
      if (res.sent > 0) {
        showToast({ text: `ส่งการเปลี่ยนแปลงที่ค้างไว้แล้ว ${res.sent} รายการ` });
        if (selectedProjectId) await refreshWorkspace(selectedProjectId);
      }
      for (const f of res.failed) {
        showToast({ text: `${f.label} ไม่สำเร็จ · ${f.lastError ?? ''}`, tone: 'error' });
      }
    };
    const goOnline = () => {
      setOnline(true);
      void sync();
    };
    const goOffline = () => setOnline(false);
    setOnline(navigator.onLine);
    setQueued(queue.pending());
    if (navigator.onLine) void sync();
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, [selectedProjectId]);

  // Live updates.
  //
  // Vercel runs this app as short-lived serverless functions, so a held-open
  // WebSocket or SSE stream is not something we can rely on. Instead the
  // client asks a cheap probe whether anything changed and only re-fetches
  // when it did, which is a few hundred bytes per poll rather than the whole
  // workspace. Polling stops while the tab is hidden, so a phone left open in
  // LINE does not sit and drain battery.
  useEffect(() => {
    // `selectedProjectId` can be the "mine" sentinel, which means "my tasks
    // across workspaces" and is not a workspace id at all. Polling it asked
    // the server about a workspace that does not exist — and because it is
    // also the INITIAL value, a login that failed left the app polling a 401
    // every twelve seconds forever behind the login screen. Each of those
    // wakes the database, which is metered.
    const pollId = selectedProject.id;
    if (!hydrated || !pollId) return;
    let version = '';
    let stopped = false;

    async function probe() {
      if (stopped || document.visibilityState !== 'visible') return;
      try {
        const res = await api.changes(pollId);
        if (stopped) return;
        if (version && res.version !== version) {
          await refreshWorkspace(pollId);
        }
        version = res.version;
      } catch {
        // A failed probe is not worth showing: the next one usually works.
      }
    }

    void probe();
    const id = window.setInterval(probe, 12000);
    const onVisible = () => void probe();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [hydrated, selectedProject.id]);

  async function refreshMyTasks() {
    try {
      setMyTasksEverywhere((await api.myTasks()).tasks);
    } catch {
      // Non-fatal: the current workspace still shows everything it has.
    }
  }

  /** Open a task that lives in another workspace. */
  async function openTaskElsewhere(workspaceId: string, taskId: string) {
    setSelectedProjectId(workspaceId);
    setPage('home');
    try {
      await refreshWorkspace(workspaceId);
      setSelectedTaskId(taskId);
    } catch (error) {
      reportError(error, 'เปิดงานไม่สำเร็จ');
    }
  }

  async function refreshUsage(workspaceId = selectedProject.id) {
    if (!workspaceId) return;
    try {
      setUsage(await api.usage(workspaceId));
    } catch {
      // Non-fatal.
    }
  }

  async function refreshSchedule(workspaceId = selectedProject.id) {
    if (!workspaceId) return;
    try {
      setSchedule(await api.schedule(workspaceId));
    } catch {
      // Non-fatal.
    }
  }

  /** Your own hours only — a schedule you cannot see or change is surveillance. */
  function editSchedule() {
    if (!schedule) return;
    openActionSheet({ kind: 'schedule' });
    setSheetStart(schedule.startsAt);
    setSheetEnd(schedule.endsAt);
  }

  async function refreshBlocked(workspaceId = selectedProject.id) {
    if (!workspaceId) return;
    try {
      const res = await api.blocked(workspaceId);
      setBlockedItems(res.items);
    } catch {
      // Non-fatal.
    }
  }

  async function refreshGroups() {
    try {
      const res = await api.groups();
      setLineGroups(res.groups);
    } catch {
      // Not fatal: the rest of the screen still works without the list.
    }
  }

  /** Connect a LINE group so its messages land in this workspace. */
  async function connectGroup(groupId: string) {
    setBusy(true);
    try {
      await api.bindGroup(groupId, selectedProject.id);
      await refreshGroups();
      setNotice('เชื่อมกลุ่มแล้ว · ข้อความที่ติด @ทันงาน จะเข้ามาที่นี่');
    } catch (error) {
      reportError(error, 'เชื่อมกลุ่มไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  /** Reload the workspace list, keeping members already fetched. */
  async function reloadWorkspaces() {
    const res = await api.workspaces();
    setProjects((current) =>
      res.workspaces.map(
        (w) =>
          current.find((p) => p.id === w.id) ?? {
            id: w.id,
            name: w.name,
            source: 'manual' as const,
            groupLabel: w.name,
            members: [],
            teams: [],
          },
      ),
    );
    return res.workspaces;
  }

  /**
   * One tap: a workspace named after the LINE group, owned by me, with the
   * group connected and everyone already seen in it given access.
   */
  async function createGroupWorkspace(groupId: string) {
    setBusy(true);
    try {
      const created = await api.createGroupWorkspace(groupId);
      await reloadWorkspaces();
      await refreshGroups();
      chooseProject(created.workspaceId);
      setNotice(
        `สร้าง “${created.name}” แล้ว · ข้อความที่ติด @ทันงาน ในกลุ่มนี้จะเข้ามาที่นี่`,
      );
    } catch (error) {
      // Already connected by someone else: we now have access to it.
      if (error instanceof ApiError && error.status === 409) {
        await reloadWorkspaces().catch(() => {});
        await refreshGroups();
      }
      reportError(error, 'สร้างพื้นที่งานไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  function answerQuestion(questionId: string) {
    const q = questions.find((item) => item.id === questionId);
    openActionSheet({ kind: 'answer', questionId, question: q?.question ?? '' });
  }

  function openTaskById(id: string) {
    const found = tasks.find((t) => t.id === id);
    if (found) setSelectedTask(found);
  }

  function reportError(error: unknown, fallback: string) {
    setNotice(error instanceof ApiError ? error.message : fallback);
  }

  const getProject = (id: string) =>
    projects.find((project) => project.id === id) || projects[0] || EMPTY_PROJECT;
  // "Is this mine" is decided by the id the server put in our session, not by
  // a list of demo ids compiled into the bundle.
  const assignmentIsMine = (
    projectId: string,
    type: 'member' | 'team',
    id: string,
  ) => {
    if (!meUserId) return false;
    if (type === 'member') return id === meUserId;
    return (
      getProject(projectId)
        .teams.find((team) => team.id === id)
        ?.memberIds.includes(meUserId) || false
    );
  };
  const belongsToMe = (
    item: Pick<Task, 'projectId' | 'assigneeType' | 'assigneeId'> &
      Partial<Pick<Task, 'primaryAssigneeType' | 'primaryAssigneeId'>>,
  ) => {
    if (assignmentIsMine(item.projectId, item.assigneeType, item.assigneeId))
      return true;
    return !!(
      item.primaryAssigneeType &&
      item.primaryAssigneeId &&
      assignmentIsMine(
        item.projectId,
        item.primaryAssigneeType,
        item.primaryAssigneeId,
      )
    );
  };
  const projectTasks =
    selectedProjectId === 'mine'
      ? tasks.filter(belongsToMe)
      : tasks.filter((task) => task.projectId === selectedProjectId);
  const projectCaptures = captures.filter(
    (capture) =>
      capture.state === 'pending' &&
      (selectedProjectId === 'mine' || capture.projectId === selectedProjectId),
  );
  const counts = useMemo(
    () => ({
      open: projectTasks.filter((task) => task.status !== 'done').length,
      due: projectTasks.filter(
        (task) =>
          dayBucket(task.dueAt, now) === 'today' && task.status !== 'done',
      ).length,
      blocked: projectTasks.filter((task) => task.status === 'blocked').length,
      done: projectTasks.filter((task) => task.status === 'done').length,
    }),
    [projectTasks],
  );
  const dailyBrief = useMemo(
    () => ({
      // Submitted work is not late. Counting it as overdue blames the worker
      // for time the task is spending in the reviewer's queue.
      overdue: projectTasks.filter(
        (task) =>
          task.status !== 'done' &&
          task.status !== 'review' &&
          isOverdue(task.dueAt ?? '', now),
      ).length,
      waiting: projectTasks.filter((task) => task.status === 'review').length,
      blocked: projectTasks.filter((task) => task.status === 'blocked').length,
      unaccepted: projectTasks.filter(
        (task) => task.status !== 'done' && task.status !== 'review' && !task.acceptedAt,
      ).length,
    }),
    [projectTasks],
  );
  const betaProgress = useMemo(() => {
    const completed = projectTasks.filter(
      (task) => task.status === 'done',
    ).length;
    const participants = new Set(
      projectTasks
        .filter((task) => task.acceptedAt)
        .map((task) => `${task.projectId}:${task.assigneeId}`),
    ).size;
    return {
      completed: Math.min(completed, 10),
      participants: Math.min(participants, 2),
    };
  }, [projectTasks]);
  const totalTaskCount = projectTasks.length;
  const completionRate = totalTaskCount
    ? Math.round((counts.done / totalTaskCount) * 100)
    : 0;
  const acceptedCount = projectTasks.filter((task) => task.acceptedAt).length;
  const progressCount = projectTasks.filter(
    (task) => task.status === 'progress',
  ).length;
  const statusBreakdown = (
    ['todo', 'progress', 'blocked', 'review', 'done'] as Status[]
  ).map((status) => ({
    status,
    count: projectTasks.filter((task) => task.status === status).length,
  }));
  const maxStatusCount = Math.max(
    1,
    ...statusBreakdown.map((item) => item.count),
  );
  const calendarDates = useMemo(() => {
    const bangkokParts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const value = (type: Intl.DateTimeFormatPartTypes) =>
      Number(bangkokParts.find((part) => part.type === type)?.value || 0);
    const base = new Date(
      Date.UTC(value('year'), value('month') - 1, value('day')),
    );
    const tomorrow = new Date(base);
    tomorrow.setUTCDate(base.getUTCDate() + 1);
    const friday = new Date(base);
    const daysUntilFriday = (5 - base.getUTCDay() + 7) % 7 || 7;
    friday.setUTCDate(base.getUTCDate() + daysUntilFriday);
    const number = (date: Date) => String(date.getUTCDate()).padStart(2, '0');
    return {
      today: number(base),
      tomorrow: number(tomorrow),
      friday: number(friday),
    };
  }, [now]);
  function getAssignee(
    task: Pick<Task, 'projectId' | 'assigneeType' | 'assigneeId'>,
  ) {
    const project = getProject(task.projectId);
    if (task.assigneeType === 'team') {
      const team = project.teams.find((item) => item.id === task.assigneeId);
      return {
        label: team?.name || 'ทั้งทีม',
        initials: `${team?.memberIds.length || 0} คน`,
      };
    }
    const member = project.members.find((item) => item.id === task.assigneeId);
    return {
      label: member?.nickname || 'ยังไม่ระบุ',
      initials: member?.initials || '?',
    };
  }
  function getPrimaryAssignee(task: Task) {
    return getAssignee({
      projectId: task.projectId,
      assigneeType: task.primaryAssigneeType || task.assigneeType,
      assigneeId: task.primaryAssigneeId || task.assigneeId,
    });
  }
  /**
   * May this person change the task's details (title, deadline, assignee)?
   * The server's rule, shared from lib/tasks/permissions.ts, so the button
   * is offered to exactly the people the edit route accepts — including the
   * person who assigned it and workspace managers, who do not do the work.
   */
  function canEditFields(task: Task) {
    const role = selectedProject.members.find((m) => m.id === meUserId)?.role ?? 'member';
    return mayEditTaskFields(
      {
        assigneeUserId: task.assigneeId || null,
        primaryAssigneeUserId: task.primaryAssigneeId || null,
        createdByUserId: task.createdById ?? null,
      },
      { userId: meUserId, role },
    );
  }
  function canEditTask(task: Task) {
    const primaryType = task.primaryAssigneeType || task.assigneeType;
    const primaryId = task.primaryAssigneeId || task.assigneeId;
    return (
      assignmentIsMine(task.projectId, task.assigneeType, task.assigneeId) ||
      assignmentIsMine(task.projectId, primaryType, primaryId)
    );
  }
  /**
   * Whether this person may CLOSE the task, which is a different right from
   * being able to work on it.
   *
   * Mirrors the server rule in app/api/tasks/[id]/status/route.ts so the
   * button is not offered and then refused. The server is still the authority
   * — this only decides what to draw.
   */
  function canReviewTask(task: Task) {
    const role = selectedProject.members.find((m) => m.id === meUserId)?.role;
    const mine = assignmentIsMine(task.projectId, task.assigneeType, task.assigneeId);
    const askedBySomeoneElse = !!task.createdById && task.createdById !== task.assigneeId;
    // Signing off your own work when somebody else asked for it would make
    // every approval on the record potentially self-issued.
    if (mine && askedBySomeoneElse) return false;
    return role === 'owner' || role === 'admin' || task.createdById === meUserId;
  }

  // Preset day + themed time select -> one real instant in Asia/Bangkok.
  function pickerDueAt(
    dueDay: 'today' | 'tomorrow' | 'friday' | 'nextweek' | 'later',
    customDate: Date | undefined,
    time: string,
  ): string {
    const [hour, minute] = time.split(':').map(Number);
    const today = zonedDateParts(now);
    if (dueDay === 'later' && customDate) {
      return fromZonedWallClock(
        customDate.getFullYear(),
        customDate.getMonth() + 1,
        customDate.getDate(),
        hour,
        minute,
      ).toISOString();
    }
    // One rule for what these buttons mean, shared with the label so the
    // button cannot promise a date the save then ignores.
    const d = quickDayDate(dueDay as 'today' | 'tomorrow' | 'friday' | 'nextweek', {
      now,
      endOfDay: settings.cutoff,
    });
    return fromZonedWallClock(d.year, d.month, d.day, hour, minute).toISOString();
  }
  function taskDueLabel() {
    if (taskDueDay === 'later' && taskDate)
      return taskDate.toLocaleDateString('th-TH', {
        day: 'numeric',
        month: 'short',
      });
    return taskDueDay === 'today'
      ? 'วันนี้'
      : taskDueDay === 'tomorrow'
        ? 'พรุ่งนี้'
        : taskDueDay === 'friday'
          ? 'วันศุกร์'
          : taskDueDay === 'nextweek'
            ? 'สัปดาห์หน้า'
            : 'เลือกวัน';
  }
  function forwardDueLabel() {
    if (forwardDueDay === 'later' && forwardDate)
      return forwardDate.toLocaleDateString('th-TH', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    return forwardDueDay === 'today'
      ? 'วันนี้'
      : forwardDueDay === 'tomorrow'
        ? 'พรุ่งนี้'
        : 'เลือกวัน';
  }
  const filteredTasks = projectTasks.filter((task) => {
    const q = search.trim().toLowerCase();
    return (
      visibleInTaskList(task.status, filter, settings.showCompleted) &&
      (!q ||
        `${task.title} ${getAssignee(task).label} ${task.id}`
          .toLowerCase()
          .includes(q))
    );
  });
  const priorityTasks = [...projectTasks]
    .filter((task) => task.status !== 'done')
    .sort((a, b) => deadlineRank(a) - deadlineRank(b));
  const activeReminderCount = reminders.filter(
    (reminder) => !reminder.done,
  ).length;
  const notificationCount =
    Number(projectCaptures.length > 0) +
    Number(priorityTasks.length > 0) +
    Number(activeReminderCount > 0);
  function navigate(next: Page) {
    setMenuOpen(false);
    setNotificationOpen(false);
    setPage(next);
    setFilter('all');
    setSearch('');
    window.scrollTo({
      top: 0,
      behavior: settings.reducedMotion ? 'instant' : 'smooth',
    });
  }
  function updatePreference<K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K],
  ) {
    setSettings((current) => ({ ...current, [key]: value }));
    setNotice('บันทึกแล้ว');
  }
  /**
   * Load one workspace's members into `projects`.
   *
   * Only the workspace open at login had its members fetched, and switching
   * never fetched the next one — so every other workspace showed an empty
   * assignee picker and an empty team list, as though nobody were in it.
   */
  async function loadMembers(workspaceId: string) {
    try {
      const res = await api.members(workspaceId);
      setProjects((all) =>
        all.map((project) =>
          project.id === workspaceId
            ? { ...project, members: res.members.map(toUiMember) }
            : project,
        ),
      );
    } catch {
      // Non-fatal: the rest of the workspace still works, and the picker
      // already degrades to "known members only".
    }
  }

  function chooseProject(id: string) {
    setSelectedProjectId(id);
    setPage('home');
    const nextProject = projects.find((project) => project.id === id);
    // Tasks, inbox and members are fetched on switch, not only at login. Only
    // the workspace open at login used to be loaded, so every other workspace
    // showed an empty task list.
    if (id !== 'mine') {
      void refreshWorkspace(id).catch((error) =>
        reportError(error, 'โหลดพื้นที่งานไม่สำเร็จ'),
      );
    }
    setNotice(`เปลี่ยนเป็น ${nextProject?.name || 'พื้นที่งานใหม่'} แล้ว`);
  }
  function loginWithLine() {
    window.location.href = '/api/auth/line/start';
  }
  async function logout() {
    setNotificationOpen(false);
    // Actions queued offline belong to this person. Left behind, they would
    // be sent under whoever signs in next on this phone.
    queue.clear();
    try {
      await api.logout();
    } finally {
      // Always leave, even if the call failed: the cookie may already be gone.
      window.location.href = '/login';
    }
  }
  function saveAccountName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const displayName = String(
      new FormData(event.currentTarget).get('displayName') || '',
    ).trim();
    if (!displayName) return;
    setAccount((current) => ({ ...current, displayName }));
    setProjects((all) =>
      nicknameAcrossProjects(all, account.lineName, displayName),
    );
    setNotice('บันทึกชื่อที่ใช้ในทันงานแล้ว');
  }
  function WorkspacePicker({ mobile = false }: { mobile?: boolean }) {
    const personalProjects = projects.filter(
      (project) => project.source === 'manual',
    );
    const lineProjects = projects.filter(
      (project) => project.source === 'line',
    );
    const projectOption = (project: Project) => (
      <SelectItem
        key={project.id}
        value={project.id}
        className="workspace-option"
      >
        <span className="option-icon">
          {project.source === 'line' ? <MessageCircle /> : <LayoutGrid />}
        </span>
        <span>
          <strong>{project.name}</strong>
          <small>{project.groupLabel}</small>
        </span>
      </SelectItem>
    );
    return (
      <Select
        value={selectedProjectId}
        onValueChange={(value) => chooseProject(value as string)}
      >
        <SelectTrigger
          aria-label="เลือกพื้นที่งาน"
          className={
            mobile
              ? 'mobile-project themed-workspace-trigger'
              : 'workspace-card themed-workspace-trigger'
          }
        >
          <span className="workspace-trigger-icon">
            {selectedProject.source === 'line' ? (
              <MessageCircle />
            ) : (
              <LayoutGrid />
            )}
          </span>
          <div>
            {mobile && <span className="workspace-kicker">พื้นที่งาน</span>}
            <strong>{selectedProject.name}</strong>
            <small>
              {/* The member count belongs here: it is how someone confirms
                  they are switched into the right team before assigning work
                  to it. */}
              {mobile
                ? `${selectedProject.source === 'line' ? 'กลุ่ม LINE' : 'พื้นที่ของฉัน'}${
                    selectedProject.members.length
                      ? ` · ${selectedProject.members.length} คน`
                      : ''
                  }`
                : selectedProject.groupLabel}
            </small>
          </div>
        </SelectTrigger>
        <SelectContent
          align="start"
          className="themed-select-content workspace-menu"
        >
          <SelectGroup>
            <SelectLabel>ของฉัน</SelectLabel>
            {personalProjects.map(projectOption)}
          </SelectGroup>
          <SelectGroup>
            <SelectLabel>กลุ่ม LINE</SelectLabel>
            {lineProjects.map(projectOption)}
          </SelectGroup>
        </SelectContent>
      </Select>
    );
  }
  function AssignmentPicker({
    project,
    value,
    onChange,
    label = 'ผู้รับผิดชอบหลัก',
  }: {
    project: Project;
    value: string;
    onChange: (value: string) => void;
    label?: string;
  }) {
    const [type, id] = value.split(':');
    const current =
      type && id
        ? getAssignee({
            projectId: project.id,
            assigneeType: type as 'member' | 'team',
            assigneeId: id,
          })
        : { label: 'เลือกคนหรือทีม', initials: '?' };
    return (
      <Select value={value} onValueChange={(next) => onChange(next as string)}>
        <SelectTrigger className="themed-field-trigger" aria-label={label}>
          <span className="select-person">
            <PersonAvatar initials={current.initials} size="sm" />
            <span>{current.label}</span>
          </span>
        </SelectTrigger>
        <SelectContent
          align="start"
          alignItemWithTrigger={false}
          className="themed-select-content"
        >
          <SelectGroup>
            <SelectLabel>สมาชิกในกลุ่ม</SelectLabel>
            {project.members.map((member) => (
              <SelectItem key={member.id} value={`member:${member.id}`}>
                <PersonAvatar initials={member.initials} size="sm" />
                <span className="option-copy">
                  <strong>{member.nickname}</strong>
                  <small>LINE: {member.lineName}</small>
                </span>
              </SelectItem>
            ))}
          </SelectGroup>
          {project.teams.length > 0 && (
            <SelectGroup>
              <SelectLabel>มอบหมายทั้งทีม</SelectLabel>
              {project.teams.map((team) => (
                <SelectItem key={team.id} value={`team:${team.id}`}>
                  <span className="team-option-icon">
                    <Users />
                  </span>
                  <span className="option-copy">
                    <strong>{team.name}</strong>
                    <small>{team.memberIds.length} คน</small>
                  </span>
                </SelectItem>
              ))}
            </SelectGroup>
          )}
        </SelectContent>
      </Select>
    );
  }

  /**
   * Move a task, optimistically.
   *
   * The row changes immediately and rolls back if the server disagrees. On a
   * mid-range Android on mobile data this is the difference between an app
   * that feels usable and one that feels broken — the alternative is a
   * spinner on every tap over a connection with 400ms of latency.
   *
   * The toast carries undo rather than a confirmation dialog in front of the
   * action: asking "are you sure" before every status change costs a tap on
   * every correct action to protect against the rare wrong one.
   */
  async function moveTask(
    task: Task,
    action:
      | 'accept' | 'info' | 'blocked' | 'handoff' | 'submit'
      | 'approve' | 'revision'
      | 'accept_handoff' | 'decline_handoff',
    extra: {
      assigneeUserId?: string; evidenceUrl?: string; note?: string;
      reason?: string; dueAt?: string;
      visibility?: 'private' | 'workspace' | 'client';
    } = {},
    successText = 'อัปเดตแล้ว',
  ) {
    // Reviewing is a different right from doing the work: the person who
    // approves or asks for changes is normally NOT the assignee. This guard
    // used to require the assignee for every action, so อนุมัติ and ขอแก้
    // never reached the server for the reviewer they are meant for.
    const isReview = action === 'approve' || action === 'revision';
    const allowed = isReview
      ? canReviewTask(task)
      : canEditTask(task) || task.pendingAssigneeId === meUserId;
    if (!allowed) {
      return setNotice(
        isReview
          ? 'ตรวจงานได้เฉพาะผู้สั่งงานหรือผู้ดูแลพื้นที่งาน'
          : 'งานนี้ดูได้อย่างเดียว เพราะคุณไม่ใช่ผู้รับผิดชอบ',
      );
    }

    const OPTIMISTIC_STATUS: Partial<Record<typeof action, Status>> = {
      accept: 'progress',
      blocked: 'blocked',
      info: 'blocked',
      submit: 'review',
      approve: 'done',
      revision: 'progress',
      accept_handoff: 'progress',
    };
    const before = tasks;
    const optimistic = OPTIMISTIC_STATUS[action];
    if (optimistic) {
      setTasks((all) =>
        all.map((t) => (t.id === task.id ? { ...t, status: optimistic } : t)),
      );
    }

    // Offline: queue it and say so. The row shows as pending rather than as
    // final, so nobody is told the work is recorded when it is not.
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      queue.enqueue({
        taskId: task.id,
        action,
        extra: extra as Record<string, unknown>,
        optimisticStatus: optimistic,
        label: `${successText}: ${task.title}`,
      });
      setQueued(queue.pending());
      setSelectedTask(null);
      showToast({ text: `บันทึกไว้ก่อน · จะส่งเมื่อกลับมาออนไลน์: ${task.title}` });
      return;
    }

    try {
      const res = await api.moveTask(task.id, action, extra);
      await refreshWorkspace(task.projectId);
      setSelectedTask(null);
      const eventId = (res as { eventId?: string }).eventId;
      const warning = (res as { warning?: string | null }).warning;
      showToast({
        // Names what happened to what, never a bare "สำเร็จ".
        text: warning ?? `${successText}: ${task.title}`,
        tone: warning ? 'error' : 'ok',
        action: eventId
          ? {
              label: 'ยกเลิก',
              run: async () => {
                try {
                  await api.undo(task.id, eventId);
                  await refreshWorkspace(task.projectId);
                  showToast({ text: `ยกเลิกแล้ว: ${task.title}` });
                } catch (error) {
                  showToast({
                    text: error instanceof ApiError ? error.message : 'ยกเลิกไม่สำเร็จ',
                    tone: 'error',
                  });
                }
              },
            }
          : undefined,
      });
    } catch (error) {
      // Put the row back exactly as it was, and say why.
      setTasks(before);
      showToast({
        text: error instanceof ApiError ? error.message : 'อัปเดตสถานะไม่สำเร็จ',
        tone: 'error',
        action: {
          label: 'ลองใหม่',
          run: () => moveTask(task, action, extra, successText),
        },
      });
    }
  }

  function updateStatus(task: Task, status: Status) {
    if (status === 'blocked') {
      // Preset reasons as one tap each, so blocked work is countable. Free
      // text stays optional, and the note is private unless the person opts
      // in to sharing it — the default is the one you get by doing nothing.
      openActionSheet({ kind: 'blocked', task });
      return;
    }
    return moveTask(task, 'accept', {}, 'อัปเดตสถานะเรียบร้อย');
  }

  /** Widen a note you wrote. The task's own status never changes with it. */
  async function shareNote(eventId: string, taskId: string) {
    setBusy(true);
    try {
      await api.setEventVisibility(eventId, 'workspace');
      const res = await api.task(taskId);
      setHistory(res.history);
      showToast({ text: 'ทุกคนในพื้นที่งานเห็นบันทึกนี้แล้ว' });
    } catch (error) {
      reportError(error, 'เปลี่ยนการมองเห็นไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  function acceptTask(task: Task) {
    if (task.acceptedAt) return setNotice('รับงานนี้แล้ว');
    return moveTask(task, 'accept', {}, 'รับงานแล้ว · ทีมเห็นเจ้าของงานชัดเจนแล้ว');
  }
  /**
   * ขอข้อมูล is a request to a named person, not a status.
   *
   * Without a name it is the old behaviour: a label that reaches nobody, and
   * the delay reads as the assignee's fault.
   */
  function requestMoreInfo(task: Task) {
    const others = selectedProject.members.filter((m) => m.id !== meUserId);
    if (!others.length) {
      return setNotice('ยังไม่รู้จักใครในพื้นที่งานนี้ ให้เขาพิมพ์ในกลุ่มหรือเข้าแอปก่อน');
    }
    openActionSheet({ kind: 'ask', task });
    setSheetPerson(`member:${others[0].id}`);
  }
  function submitForReview(task: Task) {
    const evidenceUrl = task.evidence[0]?.url;
    if (!evidenceUrl) return setNotice('เพิ่มลิงก์หลักฐานก่อนส่งตรวจ');
    return moveTask(task, 'submit', { evidenceUrl }, 'ส่งตรวจแล้ว');
  }
  // Approval closes a task and is the one transition a customer sees, so it
  // was the one place with no permission check at all — not even the
  // client-side one every other mutation here performs. The client review
  // screen called straight through. Until a tokenised review link exists,
  // approval follows the same rule as every other edit.
  function approveTask(task: Task, client = false) {
    return moveTask(task, 'approve', {}, 'อนุมัติและปิดงานแล้ว').then(() =>
      setClientApprovalOpen(false),
    );
  }
  function requestRevision(task: Task, _client = false) {
    openActionSheet({ kind: 'revision', task });
  }

  function openActionSheet(next: NonNullable<typeof actionSheet>) {
    setSheetReason('');
    setSheetShare(false);
    setSheetPerson('');
    setSheetDays(2);
    setSheetText('');
    setSheetError('');
    setActionSheet(next);
  }

  /** The new deadline a revision gets: N days out, at the end of that day. */
  function revisionDueAt(days: number) {
    const target = zonedDateParts(new Date(now.getTime() + days * 86400000));
    const [hour, minute] = settings.cutoff.split(':').map(Number);
    return fromZonedWallClock(target.year, target.month, target.day, hour, minute);
  }

  async function submitActionSheet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const sheet = actionSheet;
    if (!sheet) return;
    const text = sheetText.trim();
    const fail = (message: string) => setSheetError(message);

    if (sheet.kind === 'blocked') {
      if (!sheetReason) return fail('เลือกว่าติดเพราะอะไร');
      setActionSheet(null);
      return moveTask(
        sheet.task,
        'blocked',
        { reason: sheetReason, note: text, visibility: sheetShare ? 'workspace' : 'private' },
        sheetShare
          ? 'แจ้งว่าติดปัญหาแล้ว · ทุกคนในพื้นที่งานเห็นเหตุผล'
          : 'แจ้งว่าติดปัญหาแล้ว · เห็นเฉพาะคุณกับหัวหน้า',
      );
    }
    if (sheet.kind === 'revision') {
      if (!text) return fail('บอกด้วยว่าต้องแก้อะไร');
      setActionSheet(null);
      return moveTask(
        sheet.task,
        'revision',
        { note: text, dueAt: revisionDueAt(sheetDays).toISOString() } as never,
        'ส่งกลับพร้อมกำหนดใหม่แล้ว',
      ).then(() => setClientApprovalOpen(false));
    }

    setBusy(true);
    try {
      if (sheet.kind === 'ask') {
        const targetId = sheetPerson.split(':')[1];
        const target = selectedProject.members.find((m) => m.id === targetId);
        if (!target) return fail('เลือกว่าจะถามใคร');
        if (!text) return fail('พิมพ์คำถามก่อน');
        await api.askQuestion(sheet.task.id, target.id, text);
        await refreshWorkspace(sheet.task.projectId);
        setActionSheet(null);
        setSelectedTask(null);
        setNotice(`ส่งคำถามถึง ${target.nickname} แล้ว · งานนี้รอเขาอยู่`);
      } else if (sheet.kind === 'answer') {
        if (!text) return fail('พิมพ์คำตอบก่อน');
        await api.answerQuestion(sheet.questionId, text);
        if (selectedTask) {
          const res = await api.questions(selectedTask.id);
          setQuestions(res.questions);
          await refreshWorkspace(selectedTask.projectId);
        }
        setActionSheet(null);
        setNotice('ตอบแล้ว · งานกลับไปที่ผู้รับผิดชอบ');
      } else if (sheet.kind === 'schedule') {
        if (sheetStart >= sheetEnd) return fail('เวลาเลิกงานต้องหลังเวลาเริ่มงาน');
        await api.setSchedule(selectedProject.id, sheetStart, sheetEnd);
        await refreshSchedule();
        setActionSheet(null);
        setNotice('บันทึกเวลาทำงานแล้ว · การเตือนจะใช้เวลานี้');
      }
    } catch (error) {
      fail(error instanceof ApiError ? error.message : 'บันทึกไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  /** Completed work with its links, ready to paste to a client. */
  async function shareSummary() {
    setBusy(true);
    try {
      const s = await api.summary(selectedProject.id, 30);
      if (navigator.share) await navigator.share({ title: 'สรุปงานที่เสร็จแล้ว', text: s.text });
      else {
        await navigator.clipboard.writeText(s.text);
        setNotice(`คัดลอกสรุป ${s.count} งานแล้ว`);
      }
    } catch (error) {
      reportError(error, 'สร้างสรุปไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }
  function showEntryError(form: HTMLFormElement, error: EntryError) {
    const field = form.elements.namedItem(error.field);
    if (field instanceof HTMLElement) {
      field.focus({ preventScroll: true });
      field.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    }
  }
  async function createForwardedTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const message = String(form.get('message') || '').trim();
    const title = String(form.get('title') || '').trim();
    const evidenceUrl = String(form.get('evidenceUrl') || '').trim();
    const error = validateTaskEntry({
      title, message, evidenceUrl,
      customDate: forwardDueDay === 'later',
      date: forwardDate,
    });
    setForwardError(error);
    if (error) return showEntryError(event.currentTarget, error);

    const assigneeUserId = (forwardAssignee || '').split(':')[1] || null;
    setBusy(true);
    try {
      const created = await api.createTask(
        {
          workspaceId: forwardProject.id,
          title,
          note: `ส่งต่อจาก LINE: “${message}”`,
          assigneeUserId,
          dueAt: pickerDueAt(forwardDueDay, forwardDate, forwardTime),
          source: 'นำเข้าด้วยมือ',
        },
        newIdempotencyKey(),
      );
      if (evidenceUrl) {
        await api.updateTask(created.id, { evidenceUrl });
      }
      await refreshWorkspace(forwardProject.id);
      setForwardDialog(false);
      navigate('tasks');
      setNotice('สร้างงานจากข้อความ LINE แล้ว');
    } catch (err) {
      reportError(err, 'สร้างงานไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }
  async function confirmCapture(capture: Capture) {
    setBusy(true);
    try {
      // The idempotency key makes a double tap safe: the second call returns
      // the first task instead of creating a second one.
      await api.confirmInbox(
        capture.id,
        {
          title: capture.title,
          assigneeUserId: capture.assigneeId || null,
          dueAt: capture.dueAt ?? null,
        },
        // One key per draft, so a second tap — or a retry after a dropped
        // connection — is recognised as the same request.
        `inbox-confirm:${capture.id}`,
      );
      await refreshWorkspace(capture.projectId);
      setNotice('สร้างงานและมอบหมายแล้ว');
    } catch (error) {
      reportError(error, 'ยืนยันไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  /** Several drafts that were read correctly: one tap instead of one each. */
  async function confirmAllCaptures() {
    const ids = projectCaptures.map((c) => c.id);
    if (!ids.length) return;
    setBusy(true);
    try {
      const res = await api.confirmInboxBatch(ids);
      await refreshWorkspace(selectedProject.id);
      setNotice(
        res.skipped
          ? `สร้าง ${res.created} งาน · ${res.skipped} รายการถูกจัดการไปแล้ว`
          : `สร้าง ${res.created} งานแล้ว`,
      );
    } catch (error) {
      reportError(error, 'ยืนยันไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }
  async function dismissCapture(capture: Capture) {
    setBusy(true);
    try {
      await api.dismissInbox(capture.id);
      await refreshWorkspace(capture.projectId);
      setNotice('ปิดข้อความนี้แล้ว');
    } catch (error) {
      reportError(error, 'ปิดข้อความไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }
  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get('title') || '').trim();
    const error = validateTaskEntry({
      title,
      customDate: deadlineMode === 'picker' && taskDueDay === 'later',
      date: taskDate,
    });
    setTaskError(error);
    if (error) return showEntryError(event.currentTarget, error);

    // Resolved to a real instant here, so the server stores a timestamp and
    // never a phrase like "พรุ่งนี้".
    const dueAt =
      deadlineMode === 'natural'
        ? resolveDeadline(naturalDeadline, { now, cutoff: settings.cutoff }).at.toISOString()
        : pickerDueAt(taskDueDay, taskDate, taskTime);
    const assignee = (taskAssignee || '').split(':')[1] || null;
    const note = String(form.get('note') || '');

    if (editTarget) return saveEdit(editTarget, { title, note, assignee, dueAt });

    setBusy(true);
    try {
      await api.createTask(
        {
          workspaceId: taskProject.id,
          title,
          note,
          assigneeUserId: assignee,
          dueAt,
          priority: taskPriority,
          source: 'สร้างในทันงาน',
        },
        newIdempotencyKey(),
      );
      await refreshWorkspace(taskProject.id);
      setTaskDialog(false);
      setNaturalDeadline('');
      navigate('tasks');
      setNotice('สร้างงานเรียบร้อย');
    } catch (err) {
      reportError(err, 'สร้างงานไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }
  /** Save the entry sheet when it was opened on an existing task or a draft. */
  async function saveEdit(
    target: NonNullable<typeof editTarget>,
    values: { title: string; note: string; assignee: string | null; dueAt: string },
  ) {
    setBusy(true);
    try {
      if (target.kind === 'task') {
        const t = target.task;
        const patch: Parameters<typeof api.updateTask>[1] = {};
        if (values.title !== t.title) patch.title = values.title;
        if (values.note !== t.note) patch.note = values.note;
        if ((values.assignee ?? '') !== (t.assigneeId ?? '')) patch.assigneeUserId = values.assignee;
        if (taskPriority !== t.priority) patch.priority = taskPriority;
        if (dueTouched) patch.dueAt = values.dueAt;
        if (Object.keys(patch).length) {
          await api.updateTask(t.id, patch);
          await refreshWorkspace(t.projectId);
        }
        setTaskDialog(false);
        setNotice(Object.keys(patch).length ? 'บันทึกการแก้ไขแล้ว' : 'ไม่มีอะไรเปลี่ยน');
        return;
      }
      const c = target.capture;
      await api.confirmInbox(
        c.id,
        {
          title: values.title,
          assigneeUserId: values.assignee,
          // Untouched means "keep what was read from the message".
          dueAt: dueTouched ? values.dueAt : (c.dueAt ?? null),
        },
        `inbox-confirm:${c.id}`,
      );
      await refreshWorkspace(c.projectId);
      setTaskDialog(false);
      setNotice('สร้างงานและมอบหมายแล้ว');
    } catch (err) {
      reportError(err, target.kind === 'task' ? 'บันทึกไม่สำเร็จ' : 'ยืนยันไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }
  function openCreateTask() {
    setEditTarget(null);
    setTaskDialog(true);
  }
    function openEditTask(task: Task) {
    setEditTarget({ kind: 'task', task });
    setTaskDialog(true);
  }
  function openEditCapture(capture: Capture) {
    setEditTarget({ kind: 'capture', capture });
    setTaskDialog(true);
  }
  async function addEvidence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTask) return;
    if (!canEditTask(selectedTask))
      return setNotice('งานนี้ดูได้อย่างเดียว เพราะคุณไม่ใช่ผู้รับผิดชอบ');
    const url = String(new FormData(event.currentTarget).get('url') || '').trim();
    setBusy(true);
    try {
      await api.updateTask(selectedTask.id, { evidenceUrl: url });
      await refreshWorkspace(selectedTask.projectId);
      setEvidenceOpen(false);
      setSelectedTask(null);
      setNotice('เพิ่มลิงก์แล้ว — ไม่มีการเก็บไฟล์');
    } catch (error) {
      reportError(error, 'เพิ่มลิงก์ไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  /** Remove a task for everyone, not just from this screen. */
  async function deleteTask(target: Task) {
    setBusy(true);
    try {
      await api.deleteTask(target.id);
      await refreshWorkspace(target.projectId);
      setSelectedTask(null);
      setNotice('ลบงานแล้ว');
    } catch (error) {
      reportError(error, 'ลบงานไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }
  async function updateNickname(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!nicknameMember) return;
    const nickname = String(
      new FormData(event.currentTarget).get('nickname') || '',
    ).trim();
    if (!nickname) return;
    setBusy(true);
    try {
      await api.renameMember(selectedProject.id, nicknameMember.id, nickname);
      // Close as soon as the write lands. Waiting for the member list to come
      // back too meant about three seconds of a dialog that looked frozen,
      // which reads as a broken button rather than a slow one.
      setNicknameMember(null);
      setNotice('บันทึกชื่อเล่นแล้ว');
      const members = await api.members(selectedProject.id);
      setProjects((all) =>
        all.map((project) =>
          project.id === selectedProject.id
            ? { ...project, members: members.members.map(toUiMember) }
            : project,
        ),
      );
    } catch (error) {
      reportError(error, 'บันทึกชื่อเล่นไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }
  function createTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get('teamName') || '').trim();
    if (!name) return;
    const team = {
      id: `team-${Date.now()}`,
      name,
      memberIds: selectedProject.members
        .filter((member) => form.get(`member-${member.id}`) === 'on')
        .map((member) => member.id),
    };
    setProjects((all) =>
      all.map((project) =>
        project.id === selectedProjectId
          ? { ...project, teams: [...project.teams, team] }
          : project,
      ),
    );
    setTeamDialog(false);
    setNotice(`สร้าง ${name} แล้ว`);
  }
  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(
      new FormData(event.currentTarget).get('projectName') || '',
    ).trim();
    if (!name) return;
    setBusy(true);
    try {
      const created = await api.createWorkspace(name);
      const me = await api.me();
      setProjects(
        me.workspaces.map((w) => ({
          id: w.id,
          name: w.name,
          source: 'manual' as const,
          groupLabel: w.name,
          members: [],
          teams: [],
        })),
      );
      setSelectedProjectId(created.id);
      setProjectDialog(false);
      setNotice('สร้างพื้นที่งานใหม่แล้ว');
    } catch (error) {
      reportError(error, 'สร้างพื้นที่งานไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }
  async function createReminder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = String(new FormData(event.currentTarget).get('title') || '').trim();
    if (!title) return;
    const dueAt = pickerDueAt(
      reminderDay === 'today' ? 'today' : 'tomorrow',
      undefined,
      reminderTime,
    );
    setBusy(true);
    try {
      const created = await api.createReminder(
        { workspaceId: selectedProject.id, dueAt, leadMinutes: 0 },
        newIdempotencyKey(),
      );
      await refreshReminders();
      setReminderDialog(false);
      setNotice(
        created.shifted === 'none'
          ? 'สร้างเตือนแล้ว'
          : `${created.reason} · จะเตือน ${formatDeadline(created.sendAt, { now })}`,
      );
    } catch (error) {
      reportError(error, 'สร้างเตือนไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }
  async function createQuickReminder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = quickReminderTitle.trim();
    if (!title) return setNotice('พิมพ์เรื่องที่อยากให้เตือนก่อน');
    const dueAt = pickerDueAt(
      quickReminderDay === 'today' ? 'today' : 'tomorrow',
      undefined,
      quickReminderTime,
    );
    setBusy(true);
    try {
      const created = await api.createReminder(
        { workspaceId: selectedProject.id, dueAt, leadMinutes: 0 },
        newIdempotencyKey(),
      );
      await refreshReminders();
      setQuickReminderTitle('');
      // Quiet hours may have moved it, so report the time that will be used
      // rather than the one that was asked for.
      setNotice(
        created.shifted === 'none'
          ? `ตั้งเตือน ${formatDeadline(created.sendAt, { now })} แล้ว`
          : `${created.reason} · จะเตือน ${formatDeadline(created.sendAt, { now })}`,
      );
    } catch (error) {
      reportError(error, 'ตั้งเตือนไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  async function refreshReminders(workspaceId = selectedProject.id) {
    if (!workspaceId) return;
    try {
      const res = await api.reminders(workspaceId);
      setReminders(
        res.reminders.map((r) => ({
          id: r.id,
          title: r.title ?? 'การเตือน',
          date: formatDeadline(r.sendAt, { now }),
          time: new Intl.DateTimeFormat('th-TH', {
            timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false,
          }).format(new Date(r.sendAt)),
          repeat: 'once' as const,
          done: r.state === 'sent',
          failureReason: r.failureReason,
        })),
      );
    } catch {
      // Non-fatal: the rest of the screen still works.
    }
  }
  async function toggleReminder(id: string) {
    const current = reminders.find((r) => r.id === id);
    if (!current) return;
    setBusy(true);
    try {
      await api.updateReminder(id, { done: !current.done });
      await refreshReminders();
    } catch (error) {
      reportError(error, 'อัปเดตการเตือนไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }
  async function snoozeReminder(id: string) {
    const current = reminders.find((r) => r.id === id);
    if (!current) return;
    setBusy(true);
    try {
      // Ten minutes from now, not from the old time, so snoozing a reminder
      // that is already late actually moves it into the future.
      await api.updateReminder(id, {
        sendAt: new Date(now.getTime() + 10 * 60000).toISOString(),
      });
      await refreshReminders();
      setNotice('เลื่อนเตือนออกไป 10 นาทีแล้ว');
    } catch (error) {
      reportError(error, 'เลื่อนเตือนไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }
  function delegateTask(task: Task) {
    if (!delegateTarget) return;
    const [, assigneeId] = delegateTarget.split(':');
    if (!assigneeId) return;
    if (assigneeId === task.assigneeId)
      return setNotice('งานนี้อยู่กับผู้รับคนนี้แล้ว');
    return moveTask(task, 'handoff', { assigneeUserId: assigneeId }, 'ส่งงานต่อแล้ว');
  }
  async function shareReport() {
    const text = `พื้นที่ ${selectedProject.name} มี ${totalTaskCount} งาน · ปิดแล้ว ${counts.done} งาน (${completionRate}%) — ทันงาน.`;
    try {
      if (navigator.share)
        await navigator.share({ title: 'My work week · ทันงาน', text });
      else {
        await navigator.clipboard.writeText(text);
        setNotice('คัดลอกข้อความสำหรับแชร์แล้ว');
      }
    } catch {
      return;
    }
  }

  function TaskRow({
    task,
    compact = false,
  }: {
    task: Task;
    compact?: boolean;
  }) {
    const assignee = getAssignee(task);
    const editable = canEditTask(task);
    const waiting = queued.some((q) => q.taskId === task.id);
    return (
      <button
        title={editable ? 'เปิดและจัดการงาน' : 'เปิดดูรายละเอียด — แก้ไขไม่ได้'}
        className={`task-row ${compact ? 'compact' : ''} ${!editable ? 'read-only' : ''} ${waiting ? 'row-pending' : ''} ${task.priority === 'urgent' && task.status !== 'done' ? 'deadline-glow' : ''}`}
        onClick={() => setSelectedTask(task)}
      >
        <div className="task-row-main">
          <h3>{task.title}</h3>
          <p>
            <MessageCircle />
            {sourceLabel(task.source)}
          </p>
        </div>
        <div className="task-owner">
          <PersonAvatar initials={assignee.initials} size="sm" />
          <span>{assignee.label}</span>
          {!editable && (
            <LockKeyhole className="row-lock" aria-label="ดูอย่างเดียว" />
          )}
        </div>
        <div className="task-due">
          <Clock3 />
          {/* Lists are scanned: "อีก 2 ชม." answers the reader's question,
              where an absolute date makes them do the subtraction. The detail
              view keeps the exact time. */}
          {relativeDeadline(task.dueAt, now)}
        </div>
        <StatusChip status={task.status} />
        <ChevronRight className="task-chevron" />
      </button>
    );
  }

  const renderHome = () => (
    <>
      <section className="welcome-block">
        <div>
          <h2>วันนี้</h2>
        </div>
        <Button
          className="primary-action desktop-create"
          onClick={() => openCreateTask()}
        >
          <Plus />
          สร้างงาน
        </Button>
      </section>
      {lineGroups.some((group) => !group.bound) && (
        // First run: the bot is in a group nobody has connected yet. Setting
        // it up used to mean finding it in Settings; it is one tap here.
        <section className="panel group-setup-card">
          <div>
            <strong>เชื่อมกลุ่ม LINE ของทีม</strong>
            <small>ข้อความที่ติด @ทันงาน ในกลุ่มจะกลายเป็นงานในพื้นที่งานของกลุ่มนั้น</small>
          </div>
          {lineGroups
            .filter((group) => !group.bound)
            .slice(0, 3)
            .map((group) => (
              <div className="connection-row" key={group.id}>
                <span>
                  <Users />
                  {group.name}
                </span>
                <Button disabled={busy} onClick={() => createGroupWorkspace(group.id)}>
                  สร้างพื้นที่งานของกลุ่มนี้
                </Button>
              </div>
            ))}
        </section>
      )}
      {myTasksEverywhere.some((t) => t.workspaceId !== selectedProject.id) && (
        <section className="panel elsewhere-card">
          <div className="elsewhere-heading">
            <strong>งานของคุณในพื้นที่งานอื่น</strong>
            <small>
              {myTasksEverywhere.filter((t) => t.workspaceId !== selectedProject.id).length} งาน
            </small>
          </div>
          {myTasksEverywhere
            .filter((t) => t.workspaceId !== selectedProject.id)
            .slice(0, 5)
            .map((t) => (
              <button
                type="button"
                key={t.id}
                className="elsewhere-row"
                onClick={() => openTaskElsewhere(t.workspaceId, t.id)}
              >
                <span>
                  <strong>{t.title}</strong>
                  <small>
                    {t.workspaceName}
                    {' · '}
                    {t.pendingAssigneeUserId === meUserId
                      ? 'รอคุณกดรับ'
                      : t.dueAt
                        ? formatDeadline(t.dueAt, { now })
                        : 'ไม่มีกำหนด'}
                  </small>
                </span>
                <ChevronRight />
              </button>
            ))}
        </section>
      )}
      <section className="home-shortcuts">
        <button
          className="line-attention-card"
          onClick={() => navigate('inbox')}
        >
          <span className="shortcut-icon">
            <MessageCircle />
          </span>
          <span className="shortcut-copy">
            <small>ข้อความจาก LINE</small>
            <strong>
              {projectCaptures[0]?.message || 'ข้อความใหม่จาก LINE จะมารอที่นี่'}
            </strong>
            <em>{projectCaptures.length} ข้อความรอตรวจ · แตะเพื่อดู</em>
          </span>
          <ArrowRight />
        </button>
        <div className="home-side-shortcuts">
          <button
            className="forward-shortcut-card"
            // The AI card that shared this grid is gone until AI is connected;
            // span the whole grid rather than sit at half width beside a gap.
            style={{ gridColumn: '1 / -1', gridRow: '1 / -1' }}
            onClick={() => setForwardDialog(true)}
          >
            <span className="shortcut-icon">
              <Send />
            </span>
            <span className="shortcut-copy">
              <strong>นำข้อความจาก LINE</strong>
            </span>
            <ArrowRight />
          </button>
        </div>
      </section>
      <div className="desktop-split">
        <section className="panel task-panel">
          <div className="panel-heading">
            <div>
              <h3>ทำก่อน</h3>
            </div>
            <button onClick={() => navigate('tasks')}>
              ดูทั้งหมด <ChevronRight />
            </button>
          </div>
          <div className="task-list">
            {priorityTasks.slice(0, 4).map((task) => (
              <TaskRow key={task.id} task={task} compact />
            ))}
            {priorityTasks.length === 0 && (
              <EmptyState
                title="พื้นที่นี้ยังไม่มีงาน"
                body="สร้างงานแรก หรือเปลี่ยนไปยังกลุ่มอื่น"
              />
            )}
          </div>
        </section>
      <section className="daily-brief deadline-glow">
        <div className="brief-metrics">
          <span>
            <b>{counts.due}</b>ส่งวันนี้
          </span>
          <span>
            <b>{dailyBrief.overdue}</b>เกินกำหนด
          </span>
          <span>
            <b>{dailyBrief.waiting}</b>รอตรวจ
          </span>
          <span>
            <b>{dailyBrief.blocked}</b>ติดปัญหา
          </span>
        </div>
      </section>
        <section className="panel focus-panel">
          <div className="panel-heading">
            <div>
              <h3>ภาพรวมทีม</h3>
            </div>
          </div>
          <div
            className="completion-ring"
            style={{
              background: `conic-gradient(#090909 ${completionRate}%, #ededeb 0)`,
            }}
          >
            <strong>{completionRate}%</strong>
            <span>ปิดงานแล้ว</span>
          </div>
          <div className="mini-bars">
            <div>
              <span>งานเสร็จ</span>
              <i>
                <b style={{ width: `${completionRate}%` }} />
              </i>
              <strong>{counts.done}</strong>
            </div>
            <div>
              <span>กำลังทำ</span>
              <i>
                <b
                  style={{
                    width: `${totalTaskCount ? Math.round((progressCount / totalTaskCount) * 100) : 0}%`,
                  }}
                />
              </i>
              <strong>{progressCount}</strong>
            </div>
            <div>
              <span>ติดปัญหา</span>
              <i>
                <b
                  style={{
                    width: `${totalTaskCount ? Math.round((counts.blocked / totalTaskCount) * 100) : 0}%`,
                  }}
                />
              </i>
              <strong>{counts.blocked}</strong>
            </div>
          </div>
          <button className="text-link" onClick={() => navigate('reports')}>
            ดูและแชร์ผลการทำงาน <ArrowRight />
          </button>
        </section>
      </div>
      <section className="beta-strip">
        <div className="beta-copy">
          <Badge>FREE BETA</Badge>
          <div>
            <strong>ใช้ฟรีช่วงทดสอบ · ไม่ต้องใส่บัตร</strong>
            <small>ช่วงทดสอบยังไม่คิดเงิน</small>
          </div>
        </div>
        <div className="beta-unlock">
          <span>ปลดล็อก 3 กลุ่ม</span>
          <div>
            <i>
              <b style={{ width: `${betaProgress.completed * 10}%` }} />
            </i>
            <small>
              {betaProgress.completed}/10 งานจบ · {betaProgress.participants}/2
              คนใช้งาน
            </small>
          </div>
        </div>
      </section>
    </>
  );

  const renderInbox = () => (
    <section className="page-section">
      <div className="section-intro">
        <div>
          <h2>จาก LINE</h2>
        </div>
        <Button
          className="forward-entry-button"
          onClick={() => setForwardDialog(true)}
        >
          <Send />
          นำข้อความเข้า
        </Button>
      </div>
      {projectCaptures.length >= 2 && (
        <div className="confirm-all-row">
          <span>ตรวจแล้วถูกทุกรายการ?</span>
          <Button variant="outline" disabled={busy} onClick={confirmAllCaptures}>
            <Check />
            ยืนยันทั้งหมด {projectCaptures.length} รายการ
          </Button>
        </div>
      )}
      <div className="capture-list">
        {projectCaptures.map((capture) => {
          const assignee = getAssignee(capture);
          return (
            <article className="capture-card" key={capture.id}>
              <div className="capture-message">
                <div className="person-line">
                  <PersonAvatar initials={capture.senderInitials} />
                  <div>
                    <strong>{capture.sender}</strong>
                    <span>{getProject(capture.projectId).groupLabel}</span>
                  </div>
                </div>
                <p>{capture.message}</p>
                <span className="mention-pill">
                  {capture.assigneeId
                    ? `เข้าใจแท็ก · @${assignee.label}`
                    : 'ยังไม่รู้ว่าให้ใคร'}
                </span>
              </div>
              <div className="capture-draft">
                <div className="draft-label">
                  <Sparkles />
                  <span>งานที่ระบบเข้าใจ</span>
                </div>
                <h3>{capture.title}</h3>
                <dl>
                  <div>
                    <dt>ผู้รับผิดชอบ</dt>
                    <dd>
                      <PersonAvatar initials={assignee.initials} size="sm" />
                      {assignee.label}
                    </dd>
                  </div>
                  <div>
                    <dt>กำหนดส่ง</dt>
                    <dd>
                      <Clock3 />
                      {capture.dueText}
                    </dd>
                  </div>
                </dl>
                <button
                  type="button"
                  className="text-link capture-edit-link"
                  onClick={() => openEditCapture(capture)}
                >
                  <PencilLine />
                  แก้ชื่อ ผู้รับผิดชอบ หรือกำหนดส่งก่อนสร้าง
                </button>
                <div className="capture-actions">
                  <Button disabled={busy} onClick={() => confirmCapture(capture)}>
                    <Check />
                    ยืนยันสร้างงาน
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => dismissCapture(capture)}
                  >
                    <X />
                    ไม่ใช่งาน
                  </Button>
                </div>
              </div>
            </article>
          );
        })}
        {projectCaptures.length === 0 && (
          <div className="panel">
            <EmptyState title="ตรวจครบแล้ว" body="ข้อความใหม่จะมารอให้คุณยืนยันตรงนี้" />
          </div>
        )}
      </div>
    </section>
  );

  const renderTasks = () => (
    <section className="page-section">
      <div className="section-intro">
        <div>
          <h2>งาน</h2>
        </div>
        <Button
          className="primary-action desktop-create"
          onClick={() => openCreateTask()}
        >
          <Plus />
          สร้างงาน
        </Button>
      </div>
      <div className="task-toolbar">
        <label className="search-box">
          <Search />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="ค้นหางาน คน หรือรหัส"
          />
        </label>
      </div>
      <div className="filter-row">
        {(['all', 'todo', 'progress', 'blocked', 'review', 'done'] as const).map(
          (item) => (
            <button
              key={item}
              className={filter === item ? 'active' : ''}
              onClick={() => setFilter(item)}
            >
              {item === 'all' ? 'ทั้งหมด' : statusMeta[item].label}
              <span>
                {item === 'all'
                  ? settings.showCompleted
                    ? projectTasks.length
                    : counts.open
                  : projectTasks.filter((task) => task.status === item).length}
              </span>
            </button>
          ),
        )}
      </div>
      <div className="mobile-task-filter">
        <Select
          value={filter}
          onValueChange={(value) => setFilter(value as typeof filter)}
        >
          <SelectTrigger
            aria-label="กรองสถานะงาน"
            className="themed-field-trigger"
          >
            <span>
              {filter === 'all' ? 'ทั้งหมด' : statusMeta[filter].label} ·{' '}
              {filteredTasks.length}
            </span>
          </SelectTrigger>
          <SelectContent className="themed-select-content">
            {(['all', 'todo', 'progress', 'blocked', 'review', 'done'] as const).map(
              (item) => (
                <SelectItem key={item} value={item}>
                  {item === 'all' ? 'ทั้งหมด' : statusMeta[item].label}
                </SelectItem>
              ),
            )}
          </SelectContent>
        </Select>
      </div>
      <div className="panel task-list">
        {filteredTasks.map((task) => (
          <TaskRow key={task.id} task={task} />
        ))}
        {filteredTasks.length === 0 && (
          <EmptyState title="ไม่พบงาน" body="ลองเปลี่ยนคำค้นหาหรือตัวกรอง" />
        )}
      </div>
    </section>
  );

  const renderCalendar = () => (
    <section className="page-section">
      <div className="section-intro">
        <div>
          <h2>กำหนดส่ง</h2>
        </div>
      </div>
      <div className="calendar-strip">
        {(
          [
            { key: 'today', label: 'วันนี้', number: calendarDates.today },
            {
              key: 'tomorrow',
              label: 'พรุ่งนี้',
              number: calendarDates.tomorrow,
            },
            { key: 'friday', label: 'ศุกร์', number: calendarDates.friday },
            { key: 'later', label: 'ถัดไป', number: '—' },
          ] as const
        ).map((item) => (
          <button
            key={item.key}
            className={calendarDay === item.key ? 'active' : ''}
            onClick={() => setCalendarDay(item.key)}
          >
            <span>{item.label}</span>
            <strong>{item.number}</strong>
            <small>
              {
                projectTasks.filter(
                  (task) => dayBucket(task.dueAt, now) === item.key,
                ).length
              }{' '}
              งาน
            </small>
          </button>
        ))}
      </div>
      <div className="panel calendar-agenda">
        <div className="panel-heading">
          <div>
            <h3>
              {calendarDay === 'today'
                ? 'วันนี้'
                : calendarDay === 'tomorrow'
                  ? 'พรุ่งนี้'
                  : 'กำหนดส่งถัดไป'}
            </h3>
          </div>
        </div>
        <div className="task-list">
          {projectTasks
            .filter((task) => dayBucket(task.dueAt, now) === calendarDay)
            .map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          {projectTasks.filter((task) => dayBucket(task.dueAt, now) === calendarDay)
            .length ===
            0 && (
            <EmptyState
              title="ไม่มีงานในวันนี้"
              body="เลือกวันอื่น หรือสร้างงานพร้อมกำหนดเวลา"
            />
          )}
        </div>
      </div>
    </section>
  );

  const renderReports = () => (
    <section className="page-section report-page">
      <div className="section-intro">
        <div>
          <h2>ผลงาน</h2>
        </div>
      </div>
      <div className="report-layout">
        <div className="report-data">
          <section className="report-metrics">
            <article>
              <span>งานทั้งหมด</span>
              <strong>{totalTaskCount}</strong>
              <small>{counts.open} งานยังเปิดอยู่</small>
            </article>
            <article>
              <span>ปิดงานแล้ว</span>
              <strong>{completionRate}%</strong>
              <small>{counts.done} งานอนุมัติหรือเสร็จสิ้น</small>
            </article>
            <article>
              <span>มีคนรับงานแล้ว</span>
              <strong>{acceptedCount}</strong>
              <small>{dailyBrief.unaccepted} งานยังรอคนรับ</small>
            </article>
          </section>
          <section className="panel status-breakdown-panel">
            <div className="panel-heading">
              <div>
                <h3>สถานะงาน</h3>
              </div>
            </div>
            <div className="status-breakdown">
              {statusBreakdown.map((item) => (
                <div key={item.status}>
                  <span>{statusMeta[item.status].label}</span>
                  <i>
                    <b
                      style={{
                        width: `${(item.count / maxStatusCount) * 100}%`,
                      }}
                    />
                  </i>
                  <strong>{item.count}</strong>
                </div>
              ))}
            </div>
          </section>
          <section className="panel workload-panel">
            <div className="panel-heading">
              <div>
                <h3>ภาระงาน</h3>
              </div>
            </div>
            {selectedProject.members.map((member) => {
              const memberTasks =
                selectedProjectId === 'mine'
                  ? projectTasks.length
                  : projectTasks.filter((task) => {
                      if (task.assigneeType === 'member')
                        return task.assigneeId === member.id;
                      return !!getProject(task.projectId)
                        .teams.find((team) => team.id === task.assigneeId)
                        ?.memberIds.includes(member.id);
                    }).length;
              return (
                <div className="load-row" key={member.id}>
                  <PersonAvatar initials={member.initials} size="sm" />
                  <span>{member.nickname}</span>
                  <i>
                    <b
                      style={{
                        width: `${totalTaskCount ? (memberTasks / totalTaskCount) * 100 : 0}%`,
                      }}
                    />
                  </i>
                  <strong>{memberTasks} งาน</strong>
                </div>
              );
            })}
          </section>
        </div>
        <aside className="story-shell">
          <div className="story-card">
            <div className="story-top">
              <Brand mobile />
              <span>LIVE WORK STORY</span>
            </div>
            <p>
              POV: งานจาก LINE
              <br />
              ไม่หล่นแล้ว
            </p>
            <strong>{totalTaskCount}</strong>
            <h3>งานทั้งหมด</h3>
            <div className="story-stats">
              <div>
                <b>{completionRate}%</b>
                <span>ปิดแล้ว</span>
              </div>
              <div>
                <b>{dailyBrief.waiting}</b>
                <span>รอตรวจ</span>
              </div>
            </div>
            <div className="story-footer">
              <span>{selectedProject.name}</span>
              <small>#ชีวิตคนทำงาน #งานกอง</small>
            </div>
          </div>
          <Button className="share-button" disabled={busy} onClick={shareSummary}>
            <Share2 />
            คัดลอกสรุปงานที่เสร็จ
          </Button>
          <p className="privacy-note">
            รวมชื่องานและลิงก์หลักฐานที่เสร็จใน 30 วัน ไม่มีชื่อคนทำ · ตรวจก่อนส่งให้ลูกค้า
          </p>
        </aside>
      </div>
    </section>
  );

  const renderReminders = () => {
    const activeReminders = reminders.filter((reminder) => !reminder.done);
    const nextReminder = activeReminders[0];
    const laterReminders = activeReminders.slice(1);
    const completedCount = reminders.length - activeReminders.length;

    return (
      <section className="page-section reminder-page">
        <div className="section-intro reminder-intro">
          <div>
            <h2>เตือนฉัน</h2>
          </div>
          <Badge variant="outline">ไม่เสียเงินเพิ่ม</Badge>
        </div>

        <form className="reminder-composer" onSubmit={createQuickReminder}>
          <div className="reminder-composer-heading">
            <span>
              <Bell />
            </span>
            <div>
              <strong>อยากให้เตือนอะไร</strong>
            </div>
          </div>
          <Input
            aria-label="เรื่องที่อยากให้เตือน"
            value={quickReminderTitle}
            onChange={(event) => setQuickReminderTitle(event.target.value)}
            placeholder="เช่น โทรยืนยันคิวกับลูกค้า"
          />
          <div className="reminder-composer-controls">
            <div className="quick-day-switch" aria-label="เลือกวันที่เตือน">
              <button
                type="button"
                className={quickReminderDay === 'today' ? 'active' : ''}
                onClick={() => setQuickReminderDay('today')}
              >
                วันนี้
              </button>
              <button
                type="button"
                className={quickReminderDay === 'tomorrow' ? 'active' : ''}
                onClick={() => setQuickReminderDay('tomorrow')}
              >
                พรุ่งนี้
              </button>
            </div>
            <Select
              value={quickReminderTime}
              onValueChange={(value) => setQuickReminderTime(value as string)}
            >
              <SelectTrigger
                aria-label="เลือกเวลาเตือน"
                className="quick-reminder-time themed-field-trigger"
              >
                <Clock3 />
                <strong>{quickReminderTime}</strong>
              </SelectTrigger>
              <SelectContent
                align="start"
                className="themed-select-content time-menu"
              >
                <SelectGroup>
                  <SelectLabel>เลือกเวลา</SelectLabel>
                  {timeOptions.map((time) => (
                    <SelectItem value={time} key={time}>
                      <Clock3 />
                      {time}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Button className="quick-reminder-submit" type="submit">
              ตั้งเตือน
              <ArrowRight />
            </Button>
          </div>
          <button
            type="button"
            className="advanced-reminder-link"
            onClick={() => setReminderDialog(true)}
          >
            ตัวเลือกเพิ่มเติม <ChevronRight />
          </button>
        </form>

        <div className="reminder-dashboard">
          <section className="next-reminder-card">
            <div className="next-reminder-label">
              <span>รายการถัดไป</span>
              {nextReminder && <Badge variant="outline">กำลังรอเตือน</Badge>}
            </div>
            {nextReminder ? (
              <>
                <div className="next-reminder-main">
                  <div className="next-reminder-time">
                    <strong>{nextReminder.time}</strong>
                    <span>{nextReminder.date}</span>
                  </div>
                  <div className="next-reminder-copy">
                    <strong>{nextReminder.title}</strong>
                    {/* A reminder that could not be delivered must never look
                        the same as one that was. */}
                    <p>
                      {nextReminder.failureReason
                        ? `ส่งไม่สำเร็จ · ${nextReminder.failureReason}`
                        : nextReminder.repeat === 'daily'
                          ? 'เตือนซ้ำทุกวัน'
                          : nextReminder.repeat === 'weekly'
                            ? 'เตือนซ้ำทุกสัปดาห์'
                            : 'เตือนครั้งเดียว'}
                    </p>
                  </div>
                </div>
                <div className="next-reminder-actions">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => snoozeReminder(nextReminder.id)}
                  >
                    <Clock3 />
                    เลื่อน 10 นาที
                  </Button>
                  <Button
                    type="button"
                    onClick={() => toggleReminder(nextReminder.id)}
                  >
                    <Check />
                    เสร็จแล้ว
                  </Button>
                </div>
              </>
            ) : (
              <EmptyState
                title="ไม่มีรายการที่รอเตือน"
                body="ตั้งเตือนใหม่ด้านบน แล้วกลับไปทำงานต่อได้เลย"
              />
            )}
          </section>

          <section className="panel reminder-list redesigned">
            <div className="panel-heading">
              <div>
                <h3>{laterReminders.length} รายการ</h3>
              </div>
              <button onClick={() => setReminderDialog(true)}>
                เพิ่ม <Plus />
              </button>
            </div>
            {laterReminders.length ? (
              laterReminders.map((reminder) => (
                <button
                  className="reminder-row"
                  key={reminder.id}
                  onClick={() => toggleReminder(reminder.id)}
                >
                  <span className="check-circle" />
                  <div>
                    <strong>{reminder.title}</strong>
                    <small>
                      {reminder.date} · {reminder.time} ·{' '}
                      {reminder.repeat === 'daily'
                        ? 'ทุกวัน'
                        : reminder.repeat === 'weekly'
                          ? 'ทุกสัปดาห์'
                          : 'ครั้งเดียว'}
                    </small>
                  </div>
                  <ChevronRight />
                </button>
              ))
            ) : (
              <p className="reminder-list-empty">ยังไม่มีรายการต่อจากนี้</p>
            )}
            {completedCount > 0 && (
              <p className="completed-reminder-count">
                วันนี้ทำเสร็จแล้ว {completedCount} รายการ
              </p>
            )}
          </section>
        </div>

        <section className="line-reminder-note">
          <span>
            <MessageCircle />
          </span>
          <div>
            <strong>เตือนผ่าน LINE</strong>
            <p>ยังไม่เชื่อม LINE จริง</p>
          </div>
          <Badge variant="outline">รวมในแพ็กเกจ</Badge>
        </section>
      </section>
    );
  };

  const renderAi = () => (
    <section className="page-section ai-chat-page">
      <div className="section-intro">
        <div>
          <h2>AI</h2>
        </div>
        <Badge variant="outline">ยังไม่เชื่อม AI</Badge>
      </div>
      <section className="ai-chat-shell">
        <div className="ai-chat-header">
          <span>
            <Bot />
          </span>
          <div>
            <strong>ทันงาน AI</strong>
            <small>ยังไม่ส่งข้อมูลออกจากระบบ</small>
          </div>
          <i />
        </div>
        <div className="ai-empty">
          <span>
            <Sparkles />
          </span>
          <h3>AI ยังไม่เชื่อมต่อ</h3>
          <p>
            เมื่อเปิดใช้ AI จะช่วยอ่านข้อความที่ระบบอ่านไม่ออก แล้วให้คุณยืนยันก่อนสร้างงานทุกครั้ง
          </p>
          {schedule && (
            <div className="connection-row">
              <span>
                <Clock3 />
                เวลาทำงานของคุณ
              </span>
              <Button variant="outline" disabled={busy} onClick={editSchedule}>
                {schedule.startsAt}–{schedule.endsAt} · แก้
              </Button>
            </div>
          )}
          {usage && (
            <div className="connection-row">
              <span>
                <Bell />
                โควตาข้อความเดือนนี้
              </span>
              <Badge variant="outline">
                {usage.used}/{usage.cap} · เหลือ {usage.remaining}
              </Badge>
            </div>
          )}
          <p className="connection-notice">ยังไม่ส่งข้อความใดไปให้ AI</p>
        </div>
      </section>
    </section>
  );

  const renderSettings = () => (
    <section className="page-section preferences-page">
      <div className="section-intro">
        <h2>ตั้งค่า</h2>
        <Badge variant="outline">บันทึกในอุปกรณ์นี้</Badge>
      </div>
      <div className="preferences-layout">
        <section className="panel account-panel">
          <div className="panel-heading">
            <h3>บัญชี</h3>
            <Badge variant="outline">บัญชีทดลอง</Badge>
          </div>
          <form
            key={account.displayName}
            className="account-form"
            onSubmit={saveAccountName}
          >
            <label>
              <span>ชื่อจาก LINE</span>
              <Input value={account.lineName} readOnly />
            </label>
            <label>
              <span>ชื่อเล่น</span>
              <Input
                name="displayName"
                defaultValue={account.displayName}
                required
                maxLength={40}
              />
            </label>
            <div className="account-actions">
              <Button type="submit" disabled={busy}>
                {busy ? 'กำลังบันทึก…' : 'บันทึกชื่อ'}
              </Button>
              <Button type="button" variant="outline" onClick={logout}>
                <LogOut />
                ออกจากระบบ
              </Button>
            </div>
          </form>
        </section>
        <section className="panel preferences-panel">
          <div className="panel-heading">
            <h3>การใช้งาน</h3>
          </div>
          <div className="preference-row">
            <label id="cutoff-label">เวลาเลิกงาน</label>
            <Select
              value={settings.cutoff}
              onValueChange={(value) =>
                updatePreference('cutoff', value as string)
              }
            >
              <SelectTrigger
                aria-labelledby="cutoff-label"
                className="themed-field-trigger"
              >
                <Clock3 />
                <span>{settings.cutoff}</span>
              </SelectTrigger>
              <SelectContent className="themed-select-content preference-time-menu">
                {Array.from(new Set([...timeOptions, settings.cutoff]))
                  .sort()
                  .map((time) => (
                    <SelectItem key={time} value={time}>
                      {time}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="preference-row">
            <label id="start-page-label">หน้าเริ่มต้น</label>
            <Select
              value={settings.startPage}
              onValueChange={(value) =>
                updatePreference('startPage', value as Page)
              }
            >
              <SelectTrigger
                aria-labelledby="start-page-label"
                className="themed-field-trigger"
              >
                <span>
                  {
                    appNavigation.find(
                      (item) => item.page === settings.startPage,
                    )?.label
                  }
                </span>
              </SelectTrigger>
              <SelectContent className="themed-select-content">
                {appNavigation.map((item) => (
                  <SelectItem value={item.page} key={item.page}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="preference-row">
            <span>แสดงงานที่เสร็จ</span>
            <Switch
              checked={settings.showCompleted}
              onCheckedChange={(value) =>
                updatePreference('showCompleted', value)
              }
            />
          </label>
          <label className="preference-row">
            <span>จุดแจ้งเตือน</span>
            <Switch
              checked={settings.notificationBadge}
              onCheckedChange={(value) =>
                updatePreference('notificationBadge', value)
              }
            />
          </label>
          <label className="preference-row">
            <span>ลดภาพเคลื่อนไหว</span>
            <Switch
              checked={settings.reducedMotion}
              onCheckedChange={(value) =>
                updatePreference('reducedMotion', value)
              }
            />
          </label>
        </section>
        <section className="panel connection-panel">
          <div className="panel-heading">
            <h3>การเชื่อมต่อ</h3>
          </div>
          <div className="connection-row">
            <span>
              <MessageCircle />
              LINE
            </span>
            <Badge variant="outline">
              {account.lineConnected ? 'เชื่อมแล้ว' : 'ยังไม่ได้แอดบอท'}
            </Badge>
          </div>
          {lineGroups.map((group) => (
            <div className="connection-row" key={group.id}>
              <span>
                <Users />
                {group.name}
              </span>
              {group.bound ? (
                <Badge variant="outline">เชื่อมกับ {group.workspaceName}</Badge>
              ) : (
                <span className="group-connect-actions">
                  <Button disabled={busy} onClick={() => createGroupWorkspace(group.id)}>
                    สร้างพื้นที่งานของกลุ่มนี้
                  </Button>
                  <button
                    type="button"
                    className="text-link"
                    disabled={busy}
                    onClick={() => connectGroup(group.id)}
                  >
                    หรือเชื่อมกับ “{selectedProject.name}”
                  </button>
                </span>
              )}
            </div>
          ))}
          <div className="connection-row">
            <span>
              <Bot />
              AI
            </span>
            <Badge variant="outline">เร็ว ๆ นี้</Badge>
          </div>
          {schedule && (
            <div className="connection-row">
              <span>
                <Clock3 />
                เวลาทำงานของคุณ
              </span>
              <Button variant="outline" disabled={busy} onClick={editSchedule}>
                {schedule.startsAt}–{schedule.endsAt} · แก้
              </Button>
            </div>
          )}
          {usage && (
            <div className="connection-row">
              <span>
                <Bell />
                โควตาข้อความเดือนนี้
              </span>
              <Badge variant="outline">
                {usage.used}/{usage.cap} · เหลือ {usage.remaining}
              </Badge>
            </div>
          )}
          <p className="connection-notice">
            {lineGroups.length === 0
              ? 'เชิญบอท @108ahzwq เข้ากลุ่ม LINE แล้วพิมพ์ในกลุ่มหนึ่งครั้ง กลุ่มจะขึ้นมาให้เชื่อมที่นี่ · กลุ่มหนึ่งมีบัญชีทางการได้บัญชีเดียว ถ้าเชิญไม่ได้ให้ทักหาบอทโดยตรงแทน ข้อความจะเข้ากล่องเดียวกัน'
              : 'กลุ่มหนึ่งมีบัญชีทางการได้บัญชีเดียว ถ้าเชิญบอทเข้ากลุ่มไม่ได้ ให้ทักหาบอทโดยตรง ข้อความจะเข้ากล่องเดียวกัน'}
          </p>
        </section>
      </div>
    </section>
  );

  const renderManage = () => (
    <section className="page-section">
      <div className="section-intro">
        <div>
          <h2>ทีม</h2>
        </div>
      </div>
      <div className="manage-tabs">
        {(
          [
            { tab: 'members', label: 'สมาชิก', Icon: Users },
            { tab: 'teams', label: 'ทีมย่อย', Icon: BriefcaseBusiness },
            { tab: 'projects', label: 'พื้นที่งาน', Icon: LayoutGrid },
            { tab: 'ai', label: 'โควตา AI', Icon: BrainCircuit },
          ] as const
        ).map(({ tab, label, Icon }) => (
          <button
            key={tab}
            className={manageTab === tab ? 'active' : ''}
            onClick={() => setManageTab(tab)}
          >
            <Icon />
            {label}
          </button>
        ))}
      </div>
      {manageTab === 'members' && (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h3>สมาชิก · {selectedProject.members.length}</h3>
            </div>
          </div>
          <div className="member-list">
            {selectedProject.members.map((member) => (
              <button key={member.id} onClick={() => setNicknameMember(member)}>
                <PersonAvatar initials={member.initials} />
                <div>
                  <strong>{member.nickname}</strong>
                  <span>
                    LINE: {member.lineName} · {member.role}
                  </span>
                </div>
                <Badge variant="outline">
                  {member.linkStatus === 'not_friend'
                    ? 'ยังไม่ได้แอดบอท · เตือนไม่ถึง'
                    : member.linkStatus === 'not_signed_in'
                      ? 'ยังไม่เคยเข้าแอป'
                      : member.lineName === account.lineName
                        ? 'คุณ · แก้ชื่อเล่น'
                        : 'แก้ชื่อเล่น'}
                </Badge>
                <Pencil />
              </button>
            ))}
          </div>
          {blockedItems.length > 0 && (
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h3>ต้องช่วยตรงไหน</h3>
                </div>
              </div>
              <div className="member-list">
                {blockedItems.map((item) => (
                  <button key={item.id} onClick={() => openTaskById(item.id)}>
                    <div>
                      <strong>{item.title}</strong>
                      <span>
                        {item.needs}
                        {item.assigneeName ? ` · ${item.assigneeName}` : ''}
                      </span>
                    </div>
                    <ChevronRight />
                  </button>
                ))}
              </div>
            </section>
          )}
          <div className="info-strip">
            <Users />
            <p>
              แสดงเฉพาะสมาชิกที่เคยพูดในกลุ่มหรือเข้าใช้แอปแล้ว ยังดึงรายชื่อทั้งกลุ่มไม่ได้
              เพราะต้องใช้บัญชีที่ผ่านการยืนยันจาก LINE · คนที่ยังไม่ได้แอดบอทจะไม่ได้รับการเตือนทางแชท
            </p>
          </div>
        </section>
      )}
      {manageTab === 'teams' && (
        <>
          <div className="manage-action">
            <div>
              <h3>ทีมย่อย</h3>
            </div>
            <Button
              className="primary-action"
              onClick={() => setTeamDialog(true)}
            >
              <Plus />
              สร้างทีมย่อย
            </Button>
          </div>
          <div className="team-grid">
            {selectedProject.teams.map((team) => (
              <article className="panel team-card" key={team.id}>
                <div>
                  <span>{team.memberIds.length} คน</span>
                  <h3>{team.name}</h3>
                </div>
                <div className="avatar-stack">
                  {team.memberIds.map((id) => {
                    const member = selectedProject.members.find(
                      (item) => item.id === id,
                    );
                    return member ? (
                      <PersonAvatar key={id} initials={member.initials} />
                    ) : null;
                  })}
                </div>
                <p>
                  {team.memberIds
                    .map(
                      (id) =>
                        selectedProject.members.find((item) => item.id === id)
                          ?.nickname,
                    )
                    .filter(Boolean)
                    .join(' · ') || 'ยังไม่มีสมาชิก'}
                </p>
                <Badge variant="outline">เลือกมอบหมายทั้งทีมได้</Badge>
              </article>
            ))}
            {selectedProject.teams.length === 0 && (
              <div className="panel">
                <EmptyState title="ยังไม่มีทีมย่อย" body="สร้างทีมจากสมาชิกในพื้นที่นี้" />
              </div>
            )}
          </div>
        </>
      )}
      {manageTab === 'projects' && (
        <>
          <div className="manage-action">
            <div>
              <h3>พื้นที่งาน</h3>
            </div>
            <Button
              className="primary-action"
              onClick={() => setProjectDialog(true)}
            >
              <Plus />
              เพิ่มพื้นที่
            </Button>
          </div>
          <div className="project-grid">
            {projects.map((project) => (
              <button
                className={`project-card ${project.id === selectedProjectId ? 'active' : ''}`}
                key={project.id}
                onClick={() => chooseProject(project.id)}
              >
                <span>
                  {project.source === 'line' ? (
                    <MessageCircle />
                  ) : (
                    <LayoutGrid />
                  )}
                </span>
                <div>
                  <strong>{project.name}</strong>
                  <small>
                    {project.groupLabel} · {project.members.length} คน
                  </small>
                </div>
                {project.id === selectedProjectId ? (
                  <Check />
                ) : (
                  <ChevronRight />
                )}
              </button>
            ))}
          </div>
        </>
      )}
      {manageTab === 'ai' && (
        <div className="ai-grid">
          <section className="panel ai-flow">
            <div className="panel-heading">
              <div>
                <h3>การใช้ AI</h3>
              </div>
              <Badge variant="outline">Free Beta · 50 ครั้ง</Badge>
            </div>
            <div className="ai-steps">
              <article>
                <span>01</span>
                <div>
                  <strong>อ่านในเครื่องก่อน</strong>
                  <p>@tag วันเวลา และคำสั่งชัดเจน ใช้กฎในระบบ ไม่เสียค่า AI</p>
                </div>
              </article>
              <article>
                <span>02</span>
                <div>
                  <strong>จำจากสิ่งที่ทีมแก้</strong>
                  <p>ดึงตัวอย่างเดิมของพื้นที่นี้มาช่วย โดยไม่เอาข้อมูลไปปนกับทีมอื่น</p>
                </div>
              </article>
              <article>
                <span>03</span>
                <div>
                  <strong>ถามโมเดลเมื่อไม่แน่ใจ</strong>
                  <p>เรียกโมเดลขนาดเล็กเฉพาะข้อความที่ซับซ้อน แล้วให้คนยืนยันก่อนสร้างงาน</p>
                </div>
              </article>
            </div>
          </section>
          <section className="panel ai-usage">
            <div className="panel-heading">
              <div>
                <h3>โควตา AI</h3>
              </div>
            </div>
            <div className="ai-number">
              <strong>50</strong>
              <span>ครั้งคงเหลือ</span>
            </div>
            <div className="ai-meter">
              <i>
                <b style={{ width: '0%' }} />
              </i>
              <small>ใช้แล้ว 0/50 · ยังไม่มีค่า AI เกิดขึ้น</small>
            </div>
            <div className="ai-privacy">
              <ShieldCheck />
              <p>การเรียนรู้จากคำแก้ไขจะเปิดใช้ต่อเมื่อทีมยินยอม และลบข้อมูลได้</p>
            </div>
          </section>
        </div>
      )}
    </section>
  );

  if (loading) {
    // Deliberately the app shell with skeletons, not a centred spinner: the
    // page that appears is the page that stays, so nothing moves under the
    // reader's eye when the data lands.
    return (
      <div className="app-shell">
        <main className="app-main">
          <div className="content-area" aria-busy="true">
            <span className="sr-only">กำลังโหลดงานของคุณ</span>
            <SkeletonList rows={4} />
          </div>
        </main>
      </div>
    );
  }

  if (loadError || !account.loggedIn) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <Brand />
          <div className="auth-icon">
            <UserRound />
          </div>
          <div>
            <h1>เข้าสู่ระบบ</h1>
          </div>
          {loadError && <p className="entry-error">{loadError}</p>}
          <Button className="auth-line-button" onClick={loginWithLine}>
            <LogIn />
            เข้าสู่ระบบด้วย LINE
          </Button>
        </section>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <aside className="desktop-sidebar">
        <div className="brand">
          <Brand />
        </div>
        <WorkspacePicker />
        <nav aria-label="เมนูหลัก">
          {appNavigation.map(({ page: item, label, icon }) => {
            const Icon = navigationIcons[icon];
            return (
              <button
                key={item}
                className={page === item ? 'active' : ''}
                aria-current={page === item ? 'page' : undefined}
                onClick={() => navigate(item)}
              >
                <Icon />
                {label}
                {item === 'inbox' && projectCaptures.length > 0 && (
                  <b>{projectCaptures.length}</b>
                )}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-health">
          <CheckCircle2 />
          <div>
            <strong>{account.displayName}</strong>
            <small>LINE: {account.lineName}</small>
          </div>
        </div>
      </aside>
      <main className="app-main">
        <header className="topbar">
          <div className="mobile-brand-shell">
            <Brand mobile />
          </div>
          <WorkspacePicker mobile />
          <div className="page-title">
            <span>{selectedProject.name}</span>
          </div>
          <div className="top-actions">
            <Popover open={notificationOpen} onOpenChange={setNotificationOpen}>
              <PopoverTrigger
                aria-label={
                  notificationsSeen
                    ? 'การแจ้งเตือน'
                    : `การแจ้งเตือนใหม่ ${notificationCount} รายการ`
                }
                className="bell-button"
              >
                <Bell />
                {settings.notificationBadge &&
                  !notificationsSeen &&
                  notificationCount > 0 && <i />}
              </PopoverTrigger>
              <PopoverContent
                align="end"
                sideOffset={8}
                className="notification-popover"
              >
                <PopoverHeader className="notification-header">
                  <div>
                    <PopoverTitle>มีอะไรใหม่</PopoverTitle>
                    <span>{notificationCount} หมวดที่ต้องดู</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setNotificationsSeen(true)}
                  >
                    อ่านแล้วทั้งหมด
                  </button>
                </PopoverHeader>
                <div className="notification-list">
                  {projectCaptures.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setNotificationsSeen(true);
                        setNotificationOpen(false);
                        navigate('inbox');
                      }}
                    >
                      <span className="notification-icon">
                        <MessageCircle />
                      </span>
                      <span className="notification-copy">
                        <strong>มีข้อความใหม่จาก LINE</strong>
                        <small>
                          {projectCaptures.length} ข้อความรอให้ตรวจและสร้างเป็นงาน
                        </small>
                        <em>เมื่อสักครู่</em>
                      </span>
                      {!notificationsSeen && <i />}
                    </button>
                  )}
                  {priorityTasks.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setNotificationsSeen(true);
                        setNotificationOpen(false);
                        setSelectedTask(priorityTasks[0]);
                      }}
                    >
                      <span className="notification-icon">
                        <Clock3 />
                      </span>
                      <span className="notification-copy">
                        <strong>มีงานใกล้ถึงกำหนดส่ง</strong>
                        <small>{priorityTasks[0].title}</small>
                        <em>
                          {priorityTasks[0].dueAt
                            ? formatDeadline(priorityTasks[0].dueAt, { now })
                            : 'ไม่มีกำหนด'}
                        </em>
                      </span>
                      {!notificationsSeen && <i />}
                    </button>
                  )}
                  {activeReminderCount > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setNotificationsSeen(true);
                        setNotificationOpen(false);
                        navigate('reminders');
                      }}
                    >
                      <span className="notification-icon">
                        <Bell />
                      </span>
                      <span className="notification-copy">
                        <strong>เตือนส่วนตัวกำลังรออยู่</strong>
                        <small>
                          {activeReminderCount} รายการจะเตือนกลับมาตามเวลาที่ตั้งไว้
                        </small>
                        <em>ดูรายการเตือน</em>
                      </span>
                      {!notificationsSeen && <i />}
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  className="notification-view-all"
                  onClick={() => {
                    setNotificationsSeen(true);
                    setNotificationOpen(false);
                    navigate('inbox');
                  }}
                >
                  ดูการอัปเดตทั้งหมด <ArrowRight />
                </button>
              </PopoverContent>
            </Popover>
            <button
              className="settings-button"
              aria-label="ตั้งค่า"
              aria-current={page === 'settings' ? 'page' : undefined}
              onClick={() => navigate('settings')}
            >
              <Settings2 />
            </button>
          </div>
        </header>
        <div className="content-area">
          {page === 'home' && renderHome()}
          {page === 'inbox' && renderInbox()}
          {page === 'tasks' && renderTasks()}
          {page === 'calendar' && renderCalendar()}
          {page === 'reports' && renderReports()}
          {page === 'reminders' && renderReminders()}
          {page === 'ai' && renderAi()}
          {page === 'manage' && renderManage()}
          {page === 'settings' && renderSettings()}
        </div>
      </main>
      <nav className="mobile-nav" aria-label="เมนูหลัก">
        {appNavigation
          .filter((item) => mobilePrimaryPages.includes(item.page))
          .map(({ page: item, label, icon }) => {
            const Icon = navigationIcons[icon];
            return (
              <button
                key={item}
                className={page === item ? 'active' : ''}
                aria-current={page === item ? 'page' : undefined}
                onClick={() => navigate(item)}
              >
                <Icon />
                <span>{mobileNavLabels[item] ?? label}</span>
                {item === 'inbox' && projectCaptures.length > 0 && (
                  <i aria-label={`${projectCaptures.length} ข้อความรอตรวจ`}>
                    {projectCaptures.length > 99 ? '99+' : projectCaptures.length}
                  </i>
                )}
              </button>
            );
          })}
        <button
          className={
            menuOpen || !mobilePrimaryPages.includes(page) ? 'active' : ''
          }
          onClick={() => setMenuOpen(true)}
          aria-expanded={menuOpen}
          aria-label="เมนูทั้งหมด"
        >
          <Menu />
          <span>เพิ่มเติม</span>
        </button>
      </nav>
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="bottom" className="navigation-sheet">
          <SheetHeader>
            <SheetTitle>เมนู</SheetTitle>
            <SheetDescription className="sr-only">
              ทุกฟีเจอร์ในทันงาน
            </SheetDescription>
          </SheetHeader>
          <nav className="navigation-grid" aria-label="ทุกฟีเจอร์">
            {appNavigation.map(({ page: item, label, icon }) => {
              const Icon = navigationIcons[icon];
              return (
                <button
                  key={item}
                  className={page === item ? 'active' : ''}
                  aria-current={page === item ? 'page' : undefined}
                  onClick={() => navigate(item)}
                >
                  <Icon />
                  <span>{label}</span>
                </button>
              );
            })}
          </nav>
        </SheetContent>
      </Sheet>
      {!online && (
        <div className="offline-banner" role="status">
          <AlertCircle />
          ออฟไลน์อยู่ · สิ่งที่ทำไว้จะถูกส่งเมื่อกลับมาออนไลน์
          {queued.length > 0 ? ` (ค้างอยู่ ${queued.length} รายการ)` : ''}
        </div>
      )}
      <ToastHost toast={toast} onDismiss={dismissToast} />

      <Dialog open={taskDialog} onOpenChange={setTaskDialog}>
        <TaskEntryDialog
          open={taskDialog}
          key={`${taskProject.id}-${settings.cutoff}-${editTarget?.kind === 'task' ? editTarget.task.id : editTarget?.kind === 'capture' ? editTarget.capture.id : 'new'}`}
          className="form-dialog task-create-dialog"
        >
          <DialogHeader>
            <DialogTitle>
              {editTarget?.kind === 'task'
                ? 'แก้ไขงาน'
                : editTarget?.kind === 'capture'
                  ? 'ตรวจแล้วสร้างงาน'
                  : 'สร้างงาน'}
            </DialogTitle>
            <DialogDescription className="sr-only">
              ใส่ข้อมูลสำคัญก่อน
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={createTask}
            onInput={() => taskError && setTaskError(null)}
            noValidate
            className="task-entry-form"
          >
            <div className="stack-form task-entry-fields compact-task-form">
              <label>
                <span>ชื่องาน</span>
                <Input
                  name="title"
                  required
                  defaultValue={
                    editTarget?.kind === 'task'
                      ? editTarget.task.title
                      : editTarget?.kind === 'capture'
                        ? editTarget.capture.title
                        : undefined
                  }
                  aria-invalid={taskError?.field === 'title'}
                  aria-describedby={
                    taskError?.field === 'title'
                      ? 'task-entry-error'
                      : undefined
                  }
                  placeholder="เช่น ส่งใบเสนอราคาให้ลูกค้า"
                />
              </label>
              <label>
                <span>ผู้รับผิดชอบหลัก</span>
                <AssignmentPicker
                  project={taskProject}
                  value={taskAssignee}
                  onChange={setTaskAssignee}
                />
              </label>
              <section
                className="deadline-composer"
                // Any tap or change in here — including the time menu, whose
                // popup is portalled but still a React child — means the
                // person is setting a deadline on purpose.
                onClickCapture={() => setDueTouched(true)}
                onChangeCapture={() => setDueTouched(true)}
              >
                <div className="deadline-composer-heading">
                  <div>
                    <span>กำหนดส่ง</span>
                    <strong>
                      {editTarget && !dueTouched && !(editTarget.kind === 'task' ? editTarget.task.dueAt : editTarget.capture.dueAt)
                        ? 'ไม่มีกำหนด · แตะเพื่อตั้ง'
                        : deadlineMode === 'natural'
                        ? formatDeadline(
                            resolveDeadline(naturalDeadline, {
                              now,
                              cutoff: settings.cutoff,
                            }).at,
                            { now },
                          )
                        : `${taskDueLabel()} · ${taskTime}`}
                    </strong>
                  </div>
                  <button
                    type="button"
                    className="natural-deadline-button"
                    onClick={() =>
                      setDeadlineMode(
                        deadlineMode === 'natural' ? 'picker' : 'natural',
                      )
                    }
                  >
                    <MessageCircle />
                    {deadlineMode === 'natural'
                      ? 'เลือกแบบเร็ว'
                      : 'พิมพ์เหมือนใน LINE'}
                  </button>
                </div>
                {deadlineMode === 'natural' ? (
                  <label className="natural-deadline-field">
                    <span>พิมพ์วันและเวลาได้เลย</span>
                    <Input
                      value={naturalDeadline}
                      onChange={(event) =>
                        setNaturalDeadline(event.target.value)
                      }
                      placeholder="พรุ่งนี้ 9 โมง / ภายในวันนี้"
                    />
                    <small className="parse-preview">
                      <Sparkles />
                      ระบบจะแสดงสิ่งที่เข้าใจก่อนสร้างงาน
                    </small>
                  </label>
                ) : (
                  <>
                    <div className="day-presets">
                      {(
                        [
                          { key: 'today', label: 'วันนี้' },
                          { key: 'tomorrow', label: 'พรุ่งนี้' },
                          { key: 'friday', label: 'ศุกร์' },
                          { key: 'nextweek', label: 'สัปดาห์หน้า' },
                        ] as const
                      ).map((item) => {
                        // Showing the date each button resolves to removes the
                        // ambiguity that matters most: "ศุกร์" on a Friday.
                        const d = quickDayDate(item.key, {
                          now,
                          endOfDay: settings.cutoff,
                        });
                        return (
                          <button
                            type="button"
                            key={item.key}
                            className={taskDueDay === item.key ? 'active' : ''}
                            onClick={() => setTaskDueDay(item.key)}
                          >
                            {item.label}
                            <small>
                              {new Intl.DateTimeFormat('th-TH', {
                                timeZone: 'Asia/Bangkok',
                                day: 'numeric',
                                month: 'short',
                              }).format(
                                new Date(Date.UTC(d.year, d.month - 1, d.day, 5)),
                              )}
                            </small>
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        className={taskDueDay === 'later' ? 'active' : ''}
                        onClick={() => {
                          setTaskDueDay('later');
                          if (!taskDate) {
                            const next = new Date();
                            next.setDate(next.getDate() + 2);
                            setTaskDate(next);
                          }
                        }}
                      >
                        <CalendarDays />
                        วันอื่น
                      </button>
                    </div>
                    {taskDueDay === 'later' && (
                      <div className="inline-calendar">
                        <Calendar
                          mode="single"
                          required
                          defaultMonth={taskDate}
                          selected={taskDate}
                          onSelect={setTaskDate}
                          locale={th}
                          showOutsideDays={false}
                        />
                      </div>
                    )}
                    <label className="time-select-row">
                      <span>เวลา</span>
                      <Select
                        value={taskTime}
                        onValueChange={(value) => setTaskTime(value as string)}
                      >
                        <SelectTrigger className="themed-field-trigger time-trigger">
                          <Clock3 />
                          <strong>{taskTime}</strong>
                        </SelectTrigger>
                        <SelectContent
                          align="start"
                          alignItemWithTrigger={false}
                          className="themed-select-content time-menu"
                        >
                          <SelectGroup>
                            <SelectLabel>เวลาที่ใช้บ่อย</SelectLabel>
                            {timeOptions.map((time) => (
                              <SelectItem key={time} value={time}>
                                <Clock3 />
                                {time}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </label>
                  </>
                )}
              </section>
              {editTarget?.kind !== 'capture' && (
              <div className="optional-fields">
                <label>
                  <span>ความสำคัญ</span>
                  <Select
                    value={taskPriority}
                    onValueChange={(value) =>
                      setTaskPriority(value as Priority)
                    }
                  >
                    <SelectTrigger className="themed-field-trigger">
                      <span>
                        {taskPriority === 'normal'
                          ? 'ปกติ'
                          : taskPriority === 'high'
                            ? 'สำคัญ'
                            : 'เร่งด่วน'}
                      </span>
                    </SelectTrigger>
                    <SelectContent
                      align="start"
                      className="themed-select-content"
                    >
                      <SelectItem value="normal">ปกติ</SelectItem>
                      <SelectItem value="high">สำคัญ</SelectItem>
                      <SelectItem value="urgent">
                        <span className="urgent-option-dot" />
                        เร่งด่วน
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </label>
                <label>
                  <span>
                    รายละเอียด <small>ไม่บังคับ</small>
                  </span>
                  <Textarea
                    name="note"
                    placeholder="เพิ่มบริบทสั้น ๆ"
                    defaultValue={editTarget?.kind === 'task' ? editTarget.task.note : undefined}
                  />
                </label>
              </div>
              )}
            </div>
            {taskError && (
              <p className="entry-error" id="task-entry-error" role="alert">
                {taskError.message}
              </p>
            )}
            <DialogFooter className="task-entry-actions">
              <Button
                type="button"
                variant="outline"
                onClick={() => setTaskDialog(false)}
              >
                ยกเลิก
              </Button>
              <Button type="submit" disabled={busy}>
                {editTarget?.kind === 'task' ? 'บันทึก' : 'สร้างงาน'}
              </Button>
            </DialogFooter>
          </form>
        </TaskEntryDialog>
      </Dialog>
      <Dialog open={!!actionSheet} onOpenChange={(open) => !open && setActionSheet(null)}>
        <TaskEntryDialog open={!!actionSheet} className="form-dialog action-sheet-dialog">
          <DialogHeader>
            <DialogTitle>
              {actionSheet?.kind === 'blocked'
                ? 'ติดปัญหาเพราะอะไร'
                : actionSheet?.kind === 'ask'
                  ? 'ขอข้อมูลจากใคร'
                  : actionSheet?.kind === 'revision'
                    ? 'ขอแก้ไขงาน'
                    : actionSheet?.kind === 'answer'
                      ? 'ตอบคำถาม'
                      : 'เวลาทำงานของคุณ'}
            </DialogTitle>
            <DialogDescription>
              {actionSheet?.kind === 'blocked'
                ? 'ทีมจะเห็นว่างานนี้ติดอยู่ ส่วนเหตุผลเห็นเฉพาะคุณกับหัวหน้า เว้นแต่คุณเลือกแชร์'
                : actionSheet?.kind === 'ask'
                  ? 'คำถามจะส่งเป็นแชทส่วนตัวถึงคนนั้น และงานจะรอเขาตอบ'
                  : actionSheet?.kind === 'revision'
                    ? 'งานจะกลับไปที่ผู้รับผิดชอบพร้อมกำหนดส่งใหม่'
                    : actionSheet?.kind === 'answer'
                      ? actionSheet.question
                      : 'การเตือนจะส่งในช่วงเวลานี้เท่านั้น'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitActionSheet} noValidate className="task-entry-form">
            <div className="stack-form task-entry-fields">
              {actionSheet?.kind === 'blocked' && (
                <div className="day-presets" role="radiogroup" aria-label="เหตุผล">
                  {BLOCKED_REASONS.map((reason) => (
                    <button
                      type="button"
                      key={reason}
                      role="radio"
                      aria-checked={sheetReason === reason}
                      className={sheetReason === reason ? 'active' : ''}
                      onClick={() => {
                        setSheetReason(reason);
                        setSheetError('');
                      }}
                    >
                      {reason}
                    </button>
                  ))}
                </div>
              )}
              {actionSheet?.kind === 'ask' && (
                <label>
                  <span>ถามใคร</span>
                  <AssignmentPicker
                    project={{
                      ...selectedProject,
                      members: selectedProject.members.filter((m) => m.id !== meUserId),
                      teams: [],
                    }}
                    value={sheetPerson}
                    onChange={setSheetPerson}
                    label="ถามใคร"
                  />
                </label>
              )}
              {actionSheet?.kind === 'revision' && (
                <div className="day-presets" role="radiogroup" aria-label="ให้เวลาแก้">
                  {[1, 2, 3, 7].map((days) => (
                    <button
                      type="button"
                      key={days}
                      role="radio"
                      aria-checked={sheetDays === days}
                      className={sheetDays === days ? 'active' : ''}
                      onClick={() => setSheetDays(days)}
                    >
                      {days === 7 ? '1 สัปดาห์' : `${days} วัน`}
                      <small>{formatDeadline(revisionDueAt(days), { now })}</small>
                    </button>
                  ))}
                </div>
              )}
              {actionSheet?.kind === 'schedule' ? (
                <div className="schedule-fields">
                  {(
                    [
                      ['เริ่มงาน', sheetStart, setSheetStart],
                      ['เลิกงาน', sheetEnd, setSheetEnd],
                    ] as const
                  ).map(([label, value, set]) => (
                    <label className="time-select-row" key={label}>
                      <span>{label}</span>
                      <Select value={value} onValueChange={(next) => set(next as string)}>
                        <SelectTrigger className="themed-field-trigger time-trigger">
                          <Clock3 />
                          <strong>{value}</strong>
                        </SelectTrigger>
                        <SelectContent
                          align="start"
                          alignItemWithTrigger={false}
                          className="themed-select-content time-menu"
                        >
                          <SelectGroup>
                            {timeOptions.map((time) => (
                              <SelectItem key={time} value={time}>
                                <Clock3 />
                                {time}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </label>
                  ))}
                </div>
              ) : (
                actionSheet && (
                  <label>
                    <span>
                      {actionSheet.kind === 'blocked' ? (
                        <>
                          รายละเอียด <small>ไม่บังคับ</small>
                        </>
                      ) : actionSheet.kind === 'ask' ? (
                        'ถามว่าอะไร'
                      ) : actionSheet.kind === 'revision' ? (
                        'ต้องแก้อะไร'
                      ) : (
                        'คำตอบ'
                      )}
                    </span>
                    <Textarea
                      value={sheetText}
                      onChange={(event) => {
                        setSheetText(event.target.value);
                        setSheetError('');
                      }}
                      placeholder={
                        actionSheet.kind === 'blocked'
                          ? 'เช่น รอไฟล์ขนาดบูธจากลูกค้า'
                          : actionSheet.kind === 'ask'
                            ? 'เช่น ขอไฟล์โลโก้ความละเอียดสูง'
                            : actionSheet.kind === 'revision'
                              ? 'เช่น เปลี่ยนสีโลโก้ให้ตรงแบรนด์'
                              : 'พิมพ์คำตอบ'
                      }
                      maxLength={300}
                    />
                  </label>
                )
              )}
              {actionSheet?.kind === 'blocked' && (
                <label className="share-toggle-row">
                  <span>
                    <strong>ให้ทุกคนในพื้นที่งานเห็นเหตุผล</strong>
                    <small>ปิดไว้ = เห็นเฉพาะคุณกับหัวหน้า (แนะนำ)</small>
                  </span>
                  <Switch checked={sheetShare} onCheckedChange={(on) => setSheetShare(Boolean(on))} />
                </label>
              )}
            </div>
            {sheetError && (
              <p className="entry-error" role="alert">
                {sheetError}
              </p>
            )}
            <DialogFooter className="task-entry-actions">
              <Button type="button" variant="outline" onClick={() => setActionSheet(null)}>
                ยกเลิก
              </Button>
              <Button type="submit" disabled={busy}>
                {actionSheet?.kind === 'blocked'
                  ? 'แจ้งว่าติดปัญหา'
                  : actionSheet?.kind === 'ask'
                    ? 'ส่งคำถาม'
                    : actionSheet?.kind === 'revision'
                      ? 'ส่งกลับให้แก้'
                      : actionSheet?.kind === 'answer'
                        ? 'ส่งคำตอบ'
                        : 'บันทึก'}
              </Button>
            </DialogFooter>
          </form>
        </TaskEntryDialog>
      </Dialog>
      <Dialog open={forwardDialog} onOpenChange={setForwardDialog}>
        <TaskEntryDialog
          open={forwardDialog}
          className="form-dialog forward-dialog"
        >
          <DialogHeader>
            <DialogTitle>นำเข้าจาก LINE</DialogTitle>
            <DialogDescription className="sr-only">
              สำหรับกลุ่มที่เพิ่มทันงานเข้าไปไม่ได้ หรือมีบอทอื่นอยู่แล้ว
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={createForwardedTask}
            onInput={() => forwardError && setForwardError(null)}
            noValidate
            className="task-entry-form"
          >
            <div className="stack-form task-entry-fields forward-form">
              <div className="demo-note">
                <MessageCircle />
                <span>วางข้อความเอง · ยังไม่เชื่อม LINE</span>
              </div>
              <label>
                <span>ข้อความจาก LINE</span>
                <Textarea
                  name="message"
                  required
                  rows={3}
                  aria-invalid={forwardError?.field === 'message'}
                  aria-describedby={
                    forwardError?.field === 'message'
                      ? 'forward-entry-error'
                      : undefined
                  }
                  placeholder="วางข้อความที่ต้องการเก็บเป็นงาน"
                />
              </label>
              <label>
                <span>ชื่องาน</span>
                <Input
                  name="title"
                  required
                  aria-invalid={forwardError?.field === 'title'}
                  aria-describedby={
                    forwardError?.field === 'title'
                      ? 'forward-entry-error'
                      : undefined
                  }
                  placeholder="เช่น ส่งใบเสนอราคาให้ลูกค้า"
                />
              </label>
              <label>
                <span>พื้นที่งาน</span>
                <Select
                  value={forwardProject.id}
                  onValueChange={(value) => {
                    const next = projects.find(
                      (project) => project.id === value,
                    );
                    if (!next) return;
                    setForwardProjectId(value as string);
                    // A workspace whose members have not loaded has an empty
                    // list; reading [0].id there threw and, with no error
                    // boundary, took the whole app down to a blank screen.
                    setForwardAssignee(next.members[0] ? `member:${next.members[0].id}` : '');
                    if (!next.members.length) void loadMembers(next.id);
                  }}
                >
                  <SelectTrigger className="themed-field-trigger">
                    <MessageCircle />
                    <strong>{forwardProject.name}</strong>
                  </SelectTrigger>
                  <SelectContent className="themed-select-content">
                    <SelectGroup>
                      <SelectLabel>เลือกกลุ่มหรือโปรเจกต์</SelectLabel>
                      {projects
                        .filter((project) => project.id !== 'mine')
                        .map((project) => (
                          <SelectItem key={project.id} value={project.id}>
                            {project.source === 'line' ? (
                              <MessageCircle />
                            ) : (
                              <LayoutGrid />
                            )}
                            {project.name}
                          </SelectItem>
                        ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </label>
              <label>
                <span>ผู้รับผิดชอบหลัก</span>
                <AssignmentPicker
                  project={forwardProject}
                  value={forwardAssignee}
                  onChange={setForwardAssignee}
                />
              </label>
              <div className="forward-deadline-row">
                <div className="day-presets">
                  <button
                    type="button"
                    className={forwardDueDay === 'today' ? 'active' : ''}
                    onClick={() => setForwardDueDay('today')}
                  >
                    วันนี้
                  </button>
                  <button
                    type="button"
                    className={forwardDueDay === 'tomorrow' ? 'active' : ''}
                    onClick={() => setForwardDueDay('tomorrow')}
                  >
                    พรุ่งนี้
                  </button>
                  <button
                    type="button"
                    className={forwardDueDay === 'later' ? 'active' : ''}
                    onClick={() => {
                      setForwardDueDay('later');
                      if (!forwardDate) {
                        const nextDate = new Date();
                        nextDate.setHours(12, 0, 0, 0);
                        nextDate.setDate(nextDate.getDate() + 2);
                        setForwardDate(nextDate);
                      }
                    }}
                  >
                    <CalendarDays />
                    {forwardDueDay === 'later' && forwardDate
                      ? forwardDate.toLocaleDateString('th-TH', {
                          day: 'numeric',
                          month: 'short',
                        })
                      : 'วันอื่น'}
                  </button>
                </div>
                <Select
                  value={forwardTime}
                  onValueChange={(value) => setForwardTime(value as string)}
                >
                  <SelectTrigger
                    className="themed-field-trigger time-trigger"
                    aria-label="เวลา"
                  >
                    <Clock3 />
                    <strong>{forwardTime}</strong>
                  </SelectTrigger>
                  <SelectContent
                    className="themed-select-content time-menu"
                    alignItemWithTrigger={false}
                  >
                    {timeOptions.map((time) => (
                      <SelectItem key={time} value={time}>
                        {time}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {forwardDueDay === 'later' && (
                <div className="inline-calendar forward-calendar">
                  <Calendar
                    mode="single"
                    required
                    defaultMonth={forwardDate}
                    selected={forwardDate}
                    onSelect={setForwardDate}
                    locale={th}
                    showOutsideDays={false}
                    disabled={{ before: new Date() }}
                  />
                </div>
              )}
              <label>
                <span>
                  ลิงก์ภาพหรือไฟล์ <small>ไม่บังคับ</small>
                </span>
                <Input
                  name="evidenceUrl"
                  type="url"
                  inputMode="url"
                  autoCapitalize="none"
                  autoCorrect="off"
                  aria-invalid={forwardError?.field === 'evidenceUrl'}
                  aria-describedby={
                    forwardError?.field === 'evidenceUrl'
                      ? 'forward-entry-error'
                      : undefined
                  }
                  placeholder="https://drive.google.com/..."
                />
              </label>
            </div>
            {forwardError && (
              <p className="entry-error" id="forward-entry-error" role="alert">
                {forwardError.message}
              </p>
            )}
            <DialogFooter className="task-entry-actions">
              <Button
                type="button"
                variant="outline"
                onClick={() => setForwardDialog(false)}
              >
                ยกเลิก
              </Button>
              <Button type="submit">
                <Plus />
                สร้างงาน
              </Button>
            </DialogFooter>
          </form>
        </TaskEntryDialog>
      </Dialog>
      <Sheet
        open={!!selectedTask}
        onOpenChange={(open) => !open && setSelectedTask(null)}
      >
        <SheetContent className="task-detail">
          <SheetHeader>
            <SheetDescription>
              {selectedTask ? sourceLabel(selectedTask.source) : ''}
            </SheetDescription>
            <SheetTitle>{selectedTask?.title}</SheetTitle>
          </SheetHeader>
          {selectedTask && (
            <div className="detail-body">
              <section
                className={`detail-deadline ${selectedTask.priority === 'urgent' ? 'deadline-glow' : ''}`}
              >
                <span>
                  <Clock3 />
                  กำหนดส่ง
                </span>
                <strong>
                  {selectedTask.dueAt
                    ? formatDeadline(selectedTask.dueAt, { now })
                    : 'ไม่มีกำหนด'}
                </strong>
              </section>
              {canEditFields(selectedTask) && selectedTask.status !== 'done' && (
                <Button
                  variant="outline"
                  className="edit-task-button"
                  onClick={() => openEditTask(selectedTask)}
                >
                  <PencilLine />
                  แก้ไขงาน · ชื่อ กำหนดส่ง ผู้รับผิดชอบ
                </Button>
              )}
              {!canEditTask(selectedTask) && !canEditFields(selectedTask) && (
                <section className="read-only-banner">
                  <LockKeyhole />
                  <div>
                    <strong>งานนี้ดูได้อย่างเดียว</strong>
                    <p>
                      คุณดูรายละเอียดและหลักฐานได้ แต่แก้สถานะ ส่งต่อ
                      หรือเพิ่มข้อมูลแทนเจ้าของงานไม่ได้
                    </p>
                  </div>
                </section>
              )}
              <dl className="detail-facts">
                <div>
                  <dt>ผู้รับผิดชอบหลัก</dt>
                  <dd>
                    <PersonAvatar
                      initials={getPrimaryAssignee(selectedTask).initials}
                      size="sm"
                    />
                    {getPrimaryAssignee(selectedTask).label}
                  </dd>
                </div>
                {(selectedTask.primaryAssigneeId ||
                  selectedTask.primaryAssigneeType) &&
                  (selectedTask.assigneeId !== selectedTask.primaryAssigneeId ||
                    selectedTask.assigneeType !==
                      selectedTask.primaryAssigneeType) && (
                    <div>
                      <dt>ผู้รับงานต่อ</dt>
                      <dd>
                        <PersonAvatar
                          initials={getAssignee(selectedTask).initials}
                          size="sm"
                        />
                        {getAssignee(selectedTask).label}
                      </dd>
                    </div>
                  )}
                <div>
                  <dt>สถานะ</dt>
                  <dd>
                    <StatusChip status={selectedTask.status} />
                  </dd>
                </div>
              </dl>
              {canEditTask(selectedTask) && (
                <section className="detail-section delegate-section">
                  <div className="detail-section-heading">
                    <div>
                      <h3>ส่งงานต่อ</h3>
                      <p>ผู้รับผิดชอบหลักยังคงเห็นและติดตามงานนี้ได้</p>
                    </div>
                    <span className="primary-owner-badge">
                      <ShieldCheck />
                      สิทธิ์ผู้รับผิดชอบหลัก
                    </span>
                  </div>
                  <div className="delegate-controls">
                    <AssignmentPicker
                      project={getProject(selectedTask.projectId)}
                      value={delegateTarget}
                      onChange={setDelegateTarget}
                      label="เลือกผู้รับงานต่อ"
                    />
                    <Button
                      type="button"
                      onClick={() => delegateTask(selectedTask)}
                    >
                      ส่งต่อ
                    </Button>
                  </div>
                </section>
              )}
              <section className="detail-section">
                <h3>รายละเอียด</h3>
                <p>{selectedTask.note}</p>
              </section>
              <section className="detail-section">
                <div className="detail-section-heading">
                  <h3>หลักฐาน</h3>
                  {canEditTask(selectedTask) && (
                    <button onClick={() => setEvidenceOpen(true)}>
                      <Plus />
                      เพิ่ม
                    </button>
                  )}
                </div>
                <p className="storage-note">
                  <Link2 />
                  ทันงานไม่เก็บไฟล์ รองรับ Drive, Dropbox และลิงก์เว็บ
                </p>
                {selectedTask.evidence.map((evidence) => (
                  <a
                    className="evidence-link"
                    href={evidence.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    key={evidence.label}
                  >
                    <ExternalLink />
                    <span>{evidence.label}</span>
                    <ChevronRight />
                  </a>
                ))}
                {selectedTask.evidence.length === 0 &&
                  (canEditTask(selectedTask) ? (
                    <button
                      className="empty-evidence"
                      onClick={() => setEvidenceOpen(true)}
                    >
                      <Link2 />
                      วางลิงก์หลักฐานชิ้นแรก
                    </button>
                  ) : (
                    <div className="empty-evidence locked">
                      <LockKeyhole />
                      ยังไม่มีหลักฐานจากเจ้าของงาน
                    </div>
                  ))}
              </section>
              <section className="detail-section approval-section">
                <div className="detail-section-heading">
                  <div>
                    <h3>ตรวจงาน</h3>
                    <p>งานจบเมื่อผ่านการตรวจ ไม่ใช่แค่กดว่าเสร็จ</p>
                  </div>
                  <span
                    className={`review-chip review-${selectedTask.reviewState || 'working'}`}
                  >
                    {selectedTask.reviewState === 'review'
                      ? 'รอตรวจ'
                      : selectedTask.reviewState === 'approved'
                        ? 'อนุมัติแล้ว'
                        : selectedTask.reviewState === 'revision'
                          ? 'ขอแก้'
                          : 'กำลังทำ'}
                  </span>
                </div>
                {selectedTask.reviewState === 'review' &&
                  canReviewTask(selectedTask) && (
                    <div className="approval-actions">
                      <Button
                        variant="outline"
                        onClick={() => requestRevision(selectedTask)}
                      >
                        ขอแก้
                      </Button>
                      <Button onClick={() => approveTask(selectedTask)}>
                        <Check />
                        อนุมัติ
                      </Button>
                    </div>
                  )}
                {selectedTask.reviewState === 'review' && (
                  <button
                    className="client-review-demo"
                    onClick={() => setClientApprovalOpen(true)}
                  >
                    <ExternalLink />
                    เปิดหน้าลูกค้าตรวจงาน
                    <Badge variant="outline">เดโม</Badge>
                  </button>
                )}
              </section>
              {questions.filter((q) => !q.answeredAt).length > 0 && (
                <section className="detail-section">
                  <h3>รอคำตอบ</h3>
                  {questions
                    .filter((q) => !q.answeredAt)
                    .map((q) => (
                      <div className="activity-row" key={q.id}>
                        <i />
                        <span>
                          {q.question}
                          {/* Naming who it waits on is what stops this
                              reading as the assignee being slow. */}
                          {q.askedOfName ? ` · รอ ${q.askedOfName}` : ''}
                        </span>
                        {q.askedOfUserId === meUserId && (
                          <Button
                            variant="outline"
                            disabled={busy}
                            onClick={() => answerQuestion(q.id)}
                          >
                            ตอบ
                          </Button>
                        )}
                      </div>
                    ))}
                </section>
              )}
              <section className="detail-section">
                <h3>กิจกรรม</h3>
                {history.length === 0 && (
                  <div className="activity-row">
                    <i />
                    <span>ยังไม่มีความเคลื่อนไหว</span>
                  </div>
                )}
                {history.map((entry) => (
                  <div className="activity-row" key={entry.id}>
                    <i />
                    <span>
                      {entry.detail}
                      {entry.actorName ? ` · ${entry.actorName}` : ''}
                      {/* Who can read this, on the note itself. Nobody should
                          have to remember what they chose, or guess. */}
                      {entry.visibility && entry.visibility !== 'workspace' && (
                        <em className="note-audience">
                          {entry.visibility === 'private' ? 'เห็นเฉพาะคุณกับหัวหน้า' : 'ลูกค้าเห็นด้วย'}
                        </em>
                      )}
                      {/* Only the author may widen it. Kept inside the span so
                          the row stays the three-column grid it already is. */}
                      {entry.actorUserId === meUserId && entry.visibility === 'private' && (
                        <button
                          type="button"
                          className="note-share-button"
                          disabled={busy}
                          onClick={() => shareNote(entry.id, selectedTask.id)}
                        >
                          ให้ทีมเห็น
                        </button>
                      )}
                    </span>
                    <small>{formatDeadline(entry.at, { now })}</small>
                  </div>
                ))}
              </section>
              {selectedTask.pendingAssigneeId === meUserId && (
                <div className="status-actions accountable-actions">
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => moveTask(selectedTask, 'decline_handoff', {}, 'ส่งกลับให้คนเดิมแล้ว')}
                  >
                    ปฏิเสธ
                  </Button>
                  <Button
                    disabled={busy}
                    onClick={() => moveTask(selectedTask, 'accept_handoff', {}, 'รับงานที่ส่งต่อมาแล้ว')}
                  >
                    <Check />
                    รับงานที่ส่งต่อมา
                  </Button>
                </div>
              )}
              {canEditTask(selectedTask) && (
                <div className="status-actions accountable-actions">
                  {!selectedTask.acceptedAt &&
                  selectedTask.status !== 'done' ? (
                    <Button
                      className="accept-task-button"
                      onClick={() => acceptTask(selectedTask)}
                    >
                      <Check />
                      รับงาน
                    </Button>
                  ) : selectedTask.reviewState !== 'review' &&
                    selectedTask.reviewState !== 'approved' ? (
                    <>
                      <Button
                        variant="outline"
                        onClick={() => requestMoreInfo(selectedTask)}
                      >
                        ขอข้อมูลเพิ่ม
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => updateStatus(selectedTask, 'blocked')}
                      >
                        ติดปัญหา
                      </Button>
                      <Button onClick={() => submitForReview(selectedTask)}>
                        <Send />
                        ส่งตรวจ
                      </Button>
                    </>
                  ) : selectedTask.reviewState === 'approved' ? (
                    <div className="approved-message">
                      <CheckCircle2 /> งานนี้อนุมัติและปิดแล้ว
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
      <Dialog open={clientApprovalOpen} onOpenChange={setClientApprovalOpen}>
        <DialogContent className="client-review-dialog">
          <DialogHeader>
            <DialogTitle>ตรวจงาน</DialogTitle>
            <DialogDescription className="sr-only">
              หน้าเดโมสำหรับลูกค้า ไม่ต้องสมัครบัญชี
            </DialogDescription>
          </DialogHeader>
          {selectedTask && (
            <div className="client-review-card">
              <Badge variant="outline">DEMO · ลิงก์จริงต้องเชื่อม BACKEND</Badge>
              <h3>{selectedTask.title}</h3>
              <p>{selectedTask.note}</p>
              <div className="client-evidence-list">
                {selectedTask.evidence.map((evidence) => (
                  <a
                    key={evidence.url}
                    href={evidence.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Link2 />
                    {evidence.label}
                    <ExternalLink />
                  </a>
                ))}
              </div>
              <div className="approval-actions">
                <Button
                  variant="outline"
                  onClick={() => requestRevision(selectedTask, true)}
                >
                  ขอแก้
                </Button>
                <Button onClick={() => approveTask(selectedTask, true)}>
                  <Check />
                  อนุมัติงาน
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={evidenceOpen} onOpenChange={setEvidenceOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>เพิ่มหลักฐาน</DialogTitle>
            <DialogDescription className="sr-only">
              ทันงานจะไม่อัปโหลดหรือเก็บไฟล์
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={addEvidence} className="stack-form">
            <label>
              <span>ชื่อหลักฐาน</span>
              <Input name="label" placeholder="ใบเสนอราคาเวอร์ชันอนุมัติ" />
            </label>
            <label>
              <span>ลิงก์</span>
              <Input
                name="url"
                type="url"
                required
                placeholder="https://drive.google.com/..."
              />
            </label>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEvidenceOpen(false)}
              >
                ยกเลิก
              </Button>
              <Button type="submit">เพิ่มลิงก์</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!nicknameMember}
        onOpenChange={(open) => !open && setNicknameMember(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ชื่อเล่น</DialogTitle>
            <DialogDescription className="sr-only">
              LINE: {nicknameMember?.lineName} · ชื่อเล่นนี้ใช้กับทุกพื้นที่งาน
              และไม่เปลี่ยนชื่อใน LINE
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={updateNickname} className="stack-form">
            <label>
              <span>ชื่อเล่น</span>
              {/* Keyed on the member so switching people resets the field.
                  This key used to sit on DialogContent, where it changed at
                  the same moment `open` went false and orphaned the closing
                  dialog in the DOM, leaving cancel, X and Escape all dead. */}
              <Input
                key={nicknameMember?.id || 'nickname'}
                name="nickname"
                defaultValue={nicknameMember?.nickname}
                required
              />
            </label>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setNicknameMember(null)}
              >
                ยกเลิก
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? 'กำลังบันทึก…' : 'บันทึกชื่อ'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={teamDialog} onOpenChange={setTeamDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>สร้างทีมย่อย</DialogTitle>
            <DialogDescription className="sr-only">
              เลือกสมาชิกจาก {selectedProject.name}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={createTeam} className="stack-form">
            <label>
              <span>ชื่อทีม</span>
              <Input name="teamName" required placeholder="เช่น ทีมคอนเทนต์" />
            </label>
            <fieldset className="member-checks">
              <legend>สมาชิกในทีม</legend>
              {selectedProject.members.map((member) => (
                <label key={member.id}>
                  <input type="checkbox" name={`member-${member.id}`} />
                  <PersonAvatar initials={member.initials} size="sm" />
                  <span>
                    <strong>{member.nickname}</strong>
                    <small>{member.role}</small>
                  </span>
                </label>
              ))}
            </fieldset>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setTeamDialog(false)}
              >
                ยกเลิก
              </Button>
              <Button type="submit">สร้างทีม</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={projectDialog} onOpenChange={setProjectDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>เพิ่มพื้นที่</DialogTitle>
            <DialogDescription className="sr-only">
              ใช้ได้ทั้งกลุ่ม LINE และงานจากช่องทางอื่น
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={createProject} className="stack-form">
            <label>
              <span>ชื่อพื้นที่</span>
              <Input
                name="projectName"
                required
                placeholder="เช่น Campaign Q4"
              />
            </label>
            <label>
              <span>ประเภท</span>
              <Select
                value={projectSource}
                onValueChange={(value) =>
                  setProjectSource(value as ProjectSource)
                }
              >
                <SelectTrigger className="themed-field-trigger">
                  <span>
                    {projectSource === 'line'
                      ? 'กลุ่ม LINE'
                      : 'โปรเจกต์อื่นที่สร้างเอง'}
                  </span>
                </SelectTrigger>
                <SelectContent align="start" className="themed-select-content">
                  <SelectItem value="line">
                    <MessageCircle />
                    กลุ่ม LINE
                  </SelectItem>
                  <SelectItem value="manual">
                    <LayoutGrid />
                    โปรเจกต์อื่นที่สร้างเอง
                  </SelectItem>
                </SelectContent>
              </Select>
            </label>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setProjectDialog(false)}
              >
                ยกเลิก
              </Button>
              <Button type="submit">สร้างพื้นที่</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={reminderDialog} onOpenChange={setReminderDialog}>
        <DialogContent key={`reminder-${settings.cutoff}`}>
          <DialogHeader>
            <DialogTitle>ตั้งเตือน</DialogTitle>
            <DialogDescription className="sr-only">
              รวมอยู่ในทุกแพ็กเกจ ไม่มีค่าใช้จ่ายเพิ่มต่อรายการ
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={createReminder} className="stack-form">
            <label>
              <span>เตือนเรื่อง</span>
              <Input name="title" required placeholder="เช่น โทรติดตามลูกค้า" />
            </label>
            <div className="reminder-quick-date">
              <span>เตือนเมื่อ</span>
              <div>
                <button
                  type="button"
                  className={reminderDay === 'today' ? 'active' : ''}
                  onClick={() => setReminderDay('today')}
                >
                  วันนี้
                </button>
                <button
                  type="button"
                  className={reminderDay === 'tomorrow' ? 'active' : ''}
                  onClick={() => setReminderDay('tomorrow')}
                >
                  พรุ่งนี้
                </button>
              </div>
            </div>
            <label>
              <span>เวลา</span>
              <Select
                value={reminderTime}
                onValueChange={(value) => setReminderTime(value as string)}
              >
                <SelectTrigger className="themed-field-trigger">
                  <Clock3 />
                  <strong>{reminderTime}</strong>
                </SelectTrigger>
                <SelectContent
                  align="start"
                  className="themed-select-content time-menu"
                >
                  <SelectGroup>
                    <SelectLabel>เลือกเวลา</SelectLabel>
                    {timeOptions.map((time) => (
                      <SelectItem value={time} key={time}>
                        <Clock3 />
                        {time}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </label>
            <label>
              <span>ทำซ้ำ</span>
              <Select
                value={reminderRepeat}
                onValueChange={(value) =>
                  setReminderRepeat(value as Reminder['repeat'])
                }
              >
                <SelectTrigger className="themed-field-trigger">
                  <span>
                    {reminderRepeat === 'once'
                      ? 'ครั้งเดียว'
                      : reminderRepeat === 'daily'
                        ? 'ทุกวัน'
                        : 'ทุกสัปดาห์'}
                  </span>
                </SelectTrigger>
                <SelectContent align="start" className="themed-select-content">
                  <SelectItem value="once">ครั้งเดียว</SelectItem>
                  <SelectItem value="daily">ทุกวัน</SelectItem>
                  <SelectItem value="weekly">ทุกสัปดาห์</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setReminderDialog(false)}
              >
                ยกเลิก
              </Button>
              <Button type="submit">สร้างเตือน</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
