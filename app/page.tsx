'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
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
  nextTaskId,
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
  type DayBucket,
} from '@/lib/deadline';
import { th } from 'date-fns/locale';
import { api, ApiError, newIdempotencyKey } from '@/lib/api/client';
import { toUiTask, toUiCapture, toUiMember } from '@/lib/api/adapters';
import {
  appNavigation,
  mobilePrimaryPages,
  defaultSettings,
  normalizeSettings,
  visibleInTaskList,
  type AppSettings,
  type Page,
} from '@/lib/app-preferences';

type Status = 'todo' | 'progress' | 'blocked' | 'done';
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
  done: { label: 'เสร็จแล้ว', icon: CheckCircle2 },
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
function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty-state">
      <CheckCircle2 />
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  );
}
function deadlineRank(task: Task) {
  if (!task.dueAt) return Number.MAX_SAFE_INTEGER;
  const at = new Date(task.dueAt).getTime();
  return Number.isFinite(at) ? at : Number.MAX_SAFE_INTEGER;
}

function initialsFor(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length > 1)
    return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
  return name.trim().slice(0, 2).toUpperCase();
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
  const [blockedItems, setBlockedItems] = useState<
    { id: string; title: string; assigneeName: string | null; needs: string }[]
  >([]);
  const [questions, setQuestions] = useState<
    { id: string; question: string; answer: string | null; answeredAt: string | null; askedOfUserId: string; askedOfName: string | null }[]
  >([]);
  const [history, setHistory] = useState<
    { id: string; kind: string; detail: string; at: string; actorName: string | null }[]
  >([]);
  const [lineGroups, setLineGroups] = useState<
    { id: string; name: string; bound: boolean; workspaceName: string | null }[]
  >([]);
  const [hydrated, setHydrated] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [taskDialog, setTaskDialog] = useState(false);
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
  const [notice, setNotice] = useState('');
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
  const [forwardProjectId, setForwardProjectId] = useState('ops');
  const [forwardAssignee, setForwardAssignee] = useState('member:may');
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

        const current = list[0];
        const membersRes = await api.members(current.id);
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

        const [tasksRes, inboxRes] = await Promise.all([
          api.tasks(current.id),
          api.inbox(current.id),
        ]);
        if (cancelled) return;
        setTasks(tasksRes.tasks.map(toUiTask) as Task[]);
        setCaptures(inboxRes.items.map(toUiCapture) as unknown as Capture[]);
        await refreshGroups();
        await refreshReminders();
        await refreshBlocked();
        await refreshUsage();
      } catch (error) {
        if (cancelled) return;
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

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 2800);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    document.documentElement.dataset.motion = settings.reducedMotion
      ? 'reduced'
      : 'system';
    return () => {
      delete document.documentElement.dataset.motion;
    };
  }, [settings.reducedMotion]);
  useEffect(() => {
    if (taskDialog) {
      setTaskError(null);
      setTaskAssignee(
        taskProject.members[0] ? `member:${taskProject.members[0].id}` : '',
      );
      setTaskPriority('normal');
      setTaskDueDay('today');
      setTaskTime(settings.cutoff);
      setTaskDate(undefined);
      setDeadlineMode('picker');
      setNaturalDeadline('');
    }
  }, [taskDialog, taskProject.id, settings.cutoff]);
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
    ]);
    setTasks(tasksRes.tasks.map(toUiTask) as Task[]);
    setCaptures(inboxRes.items.map(toUiCapture) as unknown as Capture[]);
    await refreshReminders();
    await refreshBlocked();
    await refreshUsage();
  }

  // Live updates.
  //
  // Vercel runs this app as short-lived serverless functions, so a held-open
  // WebSocket or SSE stream is not something we can rely on. Instead the
  // client asks a cheap probe whether anything changed and only re-fetches
  // when it did, which is a few hundred bytes per poll rather than the whole
  // workspace. Polling stops while the tab is hidden, so a phone left open in
  // LINE does not sit and drain battery.
  useEffect(() => {
    if (!hydrated || !selectedProjectId) return;
    let version = '';
    let stopped = false;

    async function probe() {
      if (stopped || document.visibilityState !== 'visible') return;
      try {
        const res = await api.changes(selectedProjectId);
        if (stopped) return;
        if (version && res.version !== version) {
          await refreshWorkspace(selectedProjectId);
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
  }, [hydrated, selectedProjectId]);

  async function refreshUsage() {
    if (!selectedProject.id) return;
    try {
      setUsage(await api.usage(selectedProject.id));
    } catch {
      // Non-fatal.
    }
  }

  async function refreshBlocked() {
    if (!selectedProject.id) return;
    try {
      const res = await api.blocked(selectedProject.id);
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

  async function answerQuestion(questionId: string) {
    const answer = window.prompt('ตอบว่าอะไร');
    if (!answer?.trim()) return;
    setBusy(true);
    try {
      await api.answerQuestion(questionId, answer.trim());
      if (selectedTask) {
        const res = await api.questions(selectedTask.id);
        setQuestions(res.questions);
        await refreshWorkspace(selectedTask.projectId);
      }
      setNotice('ตอบแล้ว · งานกลับไปที่ผู้รับผิดชอบ');
    } catch (error) {
      reportError(error, 'ตอบไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
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
      overdue: projectTasks.filter(
        (task) => task.status !== 'done' && isOverdue(task.dueAt ?? '', now),
      ).length,
      waiting: projectTasks.filter((task) => task.reviewState === 'review')
        .length,
      blocked: projectTasks.filter((task) => task.status === 'blocked').length,
      unaccepted: projectTasks.filter(
        (task) => task.status !== 'done' && !task.acceptedAt,
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
    ['todo', 'progress', 'blocked', 'done'] as Status[]
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
  function canEditTask(task: Task) {
    const primaryType = task.primaryAssigneeType || task.assigneeType;
    const primaryId = task.primaryAssigneeId || task.assigneeId;
    return (
      assignmentIsMine(task.projectId, task.assigneeType, task.assigneeId) ||
      assignmentIsMine(task.projectId, primaryType, primaryId)
    );
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
  function chooseProject(id: string) {
    setSelectedProjectId(id);
    setPage('home');
    const nextProject = projects.find((project) => project.id === id);
    setNotice(`เปลี่ยนเป็น ${nextProject?.name || 'พื้นที่งานใหม่'} แล้ว`);
  }
  function loginWithLine() {
    window.location.href = '/api/auth/line/start';
  }
  async function logout() {
    setNotificationOpen(false);
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

  async function moveTask(
    task: Task,
    action:
      | 'accept' | 'info' | 'blocked' | 'handoff' | 'submit'
      | 'approve' | 'revision'
      | 'accept_handoff' | 'decline_handoff',
    extra: {
      assigneeUserId?: string; evidenceUrl?: string; note?: string; reason?: string;
    } = {},
    successText = 'อัปเดตแล้ว',
  ) {
    if (!canEditTask(task))
      return setNotice('งานนี้ดูได้อย่างเดียว เพราะคุณไม่ใช่ผู้รับผิดชอบ');
    setBusy(true);
    try {
      await api.moveTask(task.id, action, extra);
      await refreshWorkspace(task.projectId);
      setSelectedTask(null);
      setNotice(successText);
    } catch (error) {
      reportError(error, 'อัปเดตสถานะไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  function updateStatus(task: Task, status: Status) {
    if (status === 'blocked') {
      // A preset, so blocked work is countable. Free text stays optional:
      // a required prose field becomes "-" and stops meaning anything.
      const reasons = ['รอลูกค้า', 'รอของ', 'รอคนอื่น', 'อื่นๆ'];
      const pick = window.prompt(
        `ติดเพราะอะไร\n${reasons.map((r, i) => `${i + 1}. ${r}`).join('\n')}`,
      );
      const reason = reasons[Number(pick) - 1];
      if (!reason) return;
      const note = window.prompt('เพิ่มรายละเอียด (ไม่ใส่ก็ได้)') ?? '';
      return moveTask(
        task, 'blocked', { reason, note: note.trim() }, 'แจ้งว่าติดปัญหาแล้ว',
      );
    }
    return moveTask(task, 'accept', {}, 'อัปเดตสถานะเรียบร้อย');
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
  async function requestMoreInfo(task: Task) {
    const others = selectedProject.members.filter((m) => m.id !== meUserId);
    if (!others.length) {
      return setNotice('ยังไม่รู้จักใครในพื้นที่งานนี้ ให้เขาพิมพ์ในกลุ่มหรือเข้าแอปก่อน');
    }
    const list = others.map((m, i) => `${i + 1}. ${m.nickname}`).join('\n');
    const pick = window.prompt(`ถามใคร\n${list}`);
    const index = Number(pick) - 1;
    const target = others[index];
    if (!target) return;
    const question = window.prompt(`ถาม ${target.nickname} ว่าอะไร`);
    if (!question?.trim()) return;
    setBusy(true);
    try {
      await api.askQuestion(task.id, target.id, question.trim());
      await refreshWorkspace(task.projectId);
      setSelectedTask(null);
      setNotice(`ส่งคำถามถึง ${target.nickname} แล้ว · งานนี้รอเขาอยู่`);
    } catch (error) {
      reportError(error, 'ส่งคำถามไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
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
  function requestRevision(task: Task, client = false) {
    return moveTask(task, 'revision', {}, 'ส่งกลับให้แก้ไขแล้ว').then(() =>
      setClientApprovalOpen(false),
    );
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
        newIdempotencyKey(),
      );
      await refreshWorkspace(capture.projectId);
      setNotice('สร้างงานและมอบหมายแล้ว');
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

  async function refreshReminders() {
    if (!selectedProject.id) return;
    try {
      const res = await api.reminders(selectedProject.id);
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
    return (
      <button
        title={editable ? 'เปิดและจัดการงาน' : 'เปิดดูรายละเอียด — แก้ไขไม่ได้'}
        className={`task-row ${compact ? 'compact' : ''} ${!editable ? 'read-only' : ''} ${task.priority === 'urgent' && task.status !== 'done' ? 'deadline-glow' : ''}`}
        onClick={() => setSelectedTask(task)}
      >
        <div className="task-row-main">
          <span className="task-code">{task.id}</span>
          <h3>{task.title}</h3>
          <p>
            <MessageCircle />
            {task.source}
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
          {task.dueAt ? formatDeadline(task.dueAt, { now }) : 'ไม่มีกำหนด'}
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
          onClick={() => setTaskDialog(true)}
        >
          <Plus />
          สร้างงาน
        </Button>
      </section>
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
          <button className="ai-shortcut-card" onClick={() => navigate('ai')}>
            <span className="shortcut-icon">
              <Bot />
            </span>
            <span className="shortcut-copy">
              <strong>คุยกับ AI</strong>
            </span>
            <span className="soon-pill">เร็ว ๆ นี้</span>
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
            <small>เตือนงานฟรี · AI ทดลอง 50 ครั้ง</small>
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
                  เข้าใจแท็ก · @{assignee.label}
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
                <div className="capture-actions">
                  <Button onClick={() => confirmCapture(capture)}>
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
          onClick={() => setTaskDialog(true)}
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
        {(['all', 'todo', 'progress', 'blocked', 'done'] as const).map(
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
            {(['all', 'todo', 'progress', 'blocked', 'done'] as const).map(
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
          <Button className="share-button" onClick={shareReport}>
            <Share2 />
            แชร์ Work Story
          </Button>
          <p className="privacy-note">แชร์เฉพาะตัวเลขสรุป ไม่มีชื่อลูกค้าหรือเนื้องาน</p>
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
          <h3>เร็ว ๆ นี้</h3>
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
          <p className="connection-notice">ยังไม่ส่งข้อความหรือเรียกใช้ AI</p>
          <div className="ai-suggestions">
            <button disabled>สรุปงานที่ต้องทำวันนี้</button>
            <button disabled>มีงานไหนเสี่ยงเกินกำหนด</button>
            <button disabled>ช่วยแบ่งงานให้ทีม</button>
          </div>
        </div>
        <div className="ai-composer">
          <Input disabled placeholder="รอเชื่อมต่อ AI จริงก่อนเริ่มคุย" />
          <Button disabled aria-label="ส่งข้อความ">
            <Send />
          </Button>
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
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => connectGroup(group.id)}
                >
                  เชื่อมกับพื้นที่งานนี้
                </Button>
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
    return (
      <main className="auth-page">
        <section className="auth-card">
          <Brand />
          <p>กำลังโหลดงานของคุณ</p>
        </section>
      </main>
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
          {loadError && <p className="auth-error">{loadError}</p>}
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
                {label}
                {item === 'inbox' && projectCaptures.length > 0 && (
                  <i>{projectCaptures.length}</i>
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
          เพิ่มเติม
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
      {notice && (
        <div className="toast">
          <CheckCircle2 />
          {notice}
        </div>
      )}

      <Dialog open={taskDialog} onOpenChange={setTaskDialog}>
        <TaskEntryDialog
          open={taskDialog}
          key={`${taskProject.id}-${settings.cutoff}`}
          className="form-dialog task-create-dialog"
        >
          <DialogHeader>
            <DialogTitle>สร้างงาน</DialogTitle>
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
              <section className="deadline-composer">
                <div className="deadline-composer-heading">
                  <div>
                    <span>กำหนดส่ง</span>
                    <strong>
                      {deadlineMode === 'natural'
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
                  <Textarea name="note" placeholder="เพิ่มบริบทสั้น ๆ" />
                </label>
              </div>
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
              <Button type="submit">สร้างงาน</Button>
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
                    setForwardAssignee(`member:${next.members[0].id}`);
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
              {selectedTask?.id} · {selectedTask?.source}
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
              {!canEditTask(selectedTask) && (
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
                    rel="noreferrer"
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
                  canEditTask(selectedTask) && (
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
                    rel="noreferrer"
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
