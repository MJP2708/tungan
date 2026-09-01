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
} from '@tungan/shared/task-entry';
import {
  resolveDeadline,
  formatDeadline,
  isOverdue,
  dayBucket,
  fromZonedWallClock,
  zonedDateParts,
  type DayBucket,
} from '@tungan/shared/deadline';
import { th } from 'date-fns/locale';
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
  state: 'pending' | 'created' | 'dismissed';
};
type Reminder = {
  id: string;
  title: string;
  date: string;
  time: string;
  repeat: 'once' | 'daily' | 'weekly';
  done: boolean;
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

/** Demo fixtures resolve to real instants relative to today. */
function seedAt(dayOffset: number, time: string): string {
  const today = zonedDateParts(new Date());
  const [hour, minute] = time.split(':').map(Number);
  return fromZonedWallClock(
    today.year,
    today.month,
    today.day + dayOffset,
    hour,
    minute,
  ).toISOString();
}
/** For the seeded task that is deliberately late. */
function seedHoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3600000).toISOString();
}

const initialProjects: Project[] = [
  {
    id: 'mine',
    name: 'งานของฉัน',
    source: 'manual',
    groupLabel: 'งานของคุณจากทุกกลุ่ม',
    members: [
      {
        id: 'me-view',
        lineName: 'Pim P.',
        nickname: 'Pim P.',
        initials: 'PP',
        role: 'มุมมองมาตรฐาน',
      },
    ],
    teams: [],
  },
  {
    id: 'ops',
    name: 'ทีม Operations',
    source: 'line',
    groupLabel: 'LINE · ทีม Operations',
    members: [
      {
        id: 'pim',
        lineName: 'Pim P.',
        nickname: 'Pim P.',
        initials: 'PP',
        role: 'ผู้ดูแลกลุ่ม',
      },
      {
        id: 'may',
        lineName: 'May W.',
        nickname: 'เมย์',
        initials: 'มย',
        role: 'Account',
      },
      {
        id: 'nont',
        lineName: 'Nont S.',
        nickname: 'นนท์',
        initials: 'นน',
        role: 'Operations',
      },
      {
        id: 'art',
        lineName: 'Art K.',
        nickname: 'อาร์ต',
        initials: 'อท',
        role: 'Field team',
      },
    ],
    teams: [
      { id: 'field', name: 'ทีมหน้างาน', memberIds: ['nont', 'art'] },
      { id: 'docs', name: 'ทีมเอกสาร', memberIds: ['pim', 'may'] },
    ],
  },
  {
    id: 'nami',
    name: 'Project Nami',
    source: 'line',
    groupLabel: 'LINE · Project Nami',
    members: [
      {
        id: 'pim-nami',
        lineName: 'Pim P.',
        nickname: 'Pim P.',
        initials: 'PP',
        role: 'Account',
      },
      {
        id: 'anne',
        lineName: 'Anne N.',
        nickname: 'แอน',
        initials: 'อน',
        role: 'Client',
      },
      {
        id: 'poom',
        lineName: 'Poom C.',
        nickname: 'ภูมิ',
        initials: 'ภม',
        role: 'Creative',
      },
    ],
    teams: [{ id: 'creative', name: 'ทีม Creative', memberIds: ['poom'] }],
  },
  {
    id: 'personal',
    name: 'งานส่วนตัว',
    source: 'manual',
    groupLabel: 'สร้างในทันงาน',
    members: [
      {
        id: 'me',
        lineName: 'Pim P.',
        nickname: 'Pim P.',
        initials: 'PP',
        role: 'เจ้าของ',
      },
    ],
    teams: [],
  },
];
const initialTasks: Task[] = [
  {
    id: 'TNG-241',
    projectId: 'ops',
    title: 'ส่งใบเสนอราคาแคมเปญ Q4 ให้ ABC',
    assigneeType: 'member',
    assigneeId: 'may',
    source: 'LINE · ทีม Operations',
    dueAt: seedAt(0, '16:00'),
    status: 'todo',
    priority: 'urgent',
    note: 'ตรวจส่วนลดแพ็กเกจรายปี และแนบ media plan เวอร์ชันล่าสุด',
    activity: [
      { text: 'สร้างจากข้อความใน LINE', time: '10:14' },
      { text: 'เมย์รับงานแล้ว', time: '10:16' },
    ],
    evidence: [],
    acceptedAt: '10:16',
    reviewState: 'working',
  },
  {
    id: 'TNG-238',
    projectId: 'ops',
    title: 'ยืนยันจำนวนสื่อหน้าร้านกับทีมติดตั้ง',
    assigneeType: 'team',
    assigneeId: 'field',
    source: 'LINE · ทีม Operations',
    dueAt: seedAt(1, '10:00'),
    status: 'todo',
    priority: 'high',
    note: 'ขอจำนวน standee และจุดติดตั้งที่ยืนยันแล้ว',
    activity: [{ text: 'สร้างโดยพิม', time: 'เมื่อวาน 16:42' }],
    evidence: [],
  },
  {
    id: 'TNG-236',
    projectId: 'nami',
    title: 'แก้ artwork ตาม feedback รอบสอง',
    assigneeType: 'member',
    assigneeId: 'poom',
    source: 'LINE · Project Nami',
    dueAt: seedAt(0, '18:00'),
    status: 'progress',
    priority: 'urgent',
    note: 'แก้ headline และเพิ่ม legal line ตามข้อความต้นทาง',
    activity: [{ text: 'สร้างจากข้อความใน LINE', time: '09:20' }],
    evidence: [
      {
        label: 'Artwork draft v2 · Google Drive',
        url: 'https://drive.google.com/',
      },
    ],
    acceptedAt: '09:24',
    reviewState: 'working',
  },
  {
    id: 'TNG-231',
    projectId: 'nami',
    title: 'สรุปผล performance campaign สัปดาห์ 34',
    assigneeType: 'member',
    assigneeId: 'pim-nami',
    source: 'Weekly operation',
    dueAt: seedAt(3, '15:00'),
    status: 'progress',
    priority: 'normal',
    note: 'สรุป KPI, insight และ next action ในหน้าเดียว',
    activity: [{ text: 'สร้างจากงานประจำสัปดาห์', time: 'จ. 09:00' }],
    evidence: [],
  },
  {
    id: 'TNG-225',
    projectId: 'ops',
    title: 'รอลูกค้าอนุมัติ storyboard',
    assigneeType: 'member',
    assigneeId: 'pim',
    source: 'LINE · ทีม Operations',
    dueAt: seedHoursAgo(2),
    status: 'blocked',
    priority: 'urgent',
    note: 'ส่ง reminder แล้ว 1 ครั้ง รอการยืนยัน scene 4–6',
    activity: [{ text: 'พิมส่งงานให้ตรวจ', time: 'เมื่อวาน 14:10' }],
    evidence: [
      {
        label: 'Storyboard v3 · Google Drive',
        url: 'https://drive.google.com/',
      },
    ],
    acceptedAt: 'เมื่อวาน 10:04',
    reviewState: 'review',
  },
  {
    id: 'TNG-219',
    projectId: 'ops',
    title: 'อัปโหลดรูปหน้างานครบ 12 สาขา',
    assigneeType: 'team',
    assigneeId: 'field',
    source: 'LINE · ทีม Operations',
    dueAt: seedAt(0, '11:24'),
    status: 'done',
    priority: 'normal',
    note: 'รูปทั้งหมดผ่านการตรวจและประกาศกลับเข้ากลุ่มแล้ว',
    activity: [{ text: 'ทีมหน้างานเพิ่มลิงก์หลักฐาน', time: '11:20' }],
    evidence: [
      { label: 'รูปหน้างาน 12 สาขา · Drive', url: 'https://drive.google.com/' },
    ],
    acceptedAt: '08:45',
    reviewState: 'approved',
  },
];
const initialCaptures: Capture[] = [
  {
    id: 'CAP-01',
    projectId: 'ops',
    sender: 'พิม',
    senderInitials: 'พม',
    message: '@เมย์ ของาน สวล. ส่งให้ลูกค้าภายในวันนี้นะ',
    title: 'ส่งเอกสาร สวล. ให้ลูกค้า',
    assigneeType: 'member',
    assigneeId: 'may',
    dueText: 'ภายในวันนี้',
    state: 'pending',
  },
  {
    id: 'CAP-02',
    projectId: 'ops',
    sender: 'อาร์ต',
    senderInitials: 'อท',
    message: '@ทีมหน้างาน ช่วยเช็กของเข้าคลังพรุ่งนี้เช้าด้วยครับ',
    title: 'เช็กของเข้าคลัง',
    assigneeType: 'team',
    assigneeId: 'field',
    dueText: 'พรุ่งนี้เช้า',
    state: 'pending',
  },
  {
    id: 'CAP-03',
    projectId: 'nami',
    sender: 'แอน',
    senderInitials: 'อน',
    message: '@ภูมิ ปรับ headline ตามคอมเมนต์ล่าสุดก่อนบ่าย 3',
    title: 'ปรับ headline ตามคอมเมนต์ล่าสุด',
    assigneeType: 'member',
    assigneeId: 'poom',
    dueText: 'ก่อนบ่าย 3',
    state: 'pending',
  },
];
const initialReminders: Reminder[] = [
  {
    id: 'REM-01',
    title: 'โทรยืนยันคิวกับลูกค้า',
    date: '29 ส.ค.',
    time: '09:00',
    repeat: 'once',
    done: false,
  },
  {
    id: 'REM-02',
    title: 'สรุปงานค้างก่อนเลิกงาน',
    date: 'ทุกวันทำงาน',
    time: '16:45',
    repeat: 'daily',
    done: false,
  },
];
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
function parseNaturalDeadline(text: string, cutoff: string) {
  const value = text.trim();
  if (!value) return 'ลองพิมพ์ “พรุ่งนี้ 9 โมง” หรือ “ภายในวันนี้”';
  const tomorrow = value.includes('พรุ่งนี้');
  let time = tomorrow && value.includes('เช้า') ? '09:00' : cutoff;
  const exact = value.match(/(\d{1,2})[:.](\d{2})/);
  const hourThai = value.match(/(\d{1,2})\s*โมง/);
  const afternoon = value.match(/ก่อนบ่าย\s*(\d{1,2})/);
  if (exact) time = `${exact[1].padStart(2, '0')}:${exact[2]}`;
  else if (afternoon)
    time = `${String(Number(afternoon[1]) + 12).padStart(2, '0')}:00`;
  else if (hourThai) {
    let hour = Number(hourThai[1]);
    if ((value.includes('เย็น') || value.includes('บ่าย')) && hour < 12)
      hour += 12;
    time = `${String(hour).padStart(2, '0')}:00`;
  }
  return `${tomorrow ? 'พรุ่งนี้' : value.includes('วันนี้') ? 'วันนี้' : 'เวลาที่อ่านได้'} · ${time}`;
}

// Sorting is a comparison of instants. The prototype ranked by reading a
// Thai label with a regex, so a genuinely late task sorted as on-time
// unless someone had typed the word "เกินกำหนด" into it.
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
  const acceptedEvent = activity.find((item) => item.text.includes('รับงานแล้ว'));
  const reviewEvent = activity.some((item) =>
    item.text.includes('ส่งงานให้ตรวจ'),
  );
  return {
    ...task,
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
  const [projects, setProjects] = useState(initialProjects);
  const [selectedProjectId, setSelectedProjectId] = useState('mine');
  const [tasks, setTasks] = useState(initialTasks);
  const [captures, setCaptures] = useState(initialCaptures);
  const [reminders, setReminders] = useState(initialReminders);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [menuOpen, setMenuOpen] = useState(false);
  const [account, setAccount] = useState<Account>({
    loggedIn: true,
    lineConnected: true,
    lineName: 'Pim P.',
    displayName: 'Pim P.',
  });
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
    useState<'today' | 'tomorrow' | 'friday' | 'later'>('today');
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
    projects.find((project) => project.id === selectedProjectId) || projects[0];
  const taskProject =
    selectedProjectId === 'mine'
      ? projects.find((project) => project.id === 'personal') || selectedProject
      : selectedProject;
  const forwardProject =
    projects.find((project) => project.id === forwardProjectId) ||
    projects.find((project) => project.source === 'line') ||
    taskProject;

  useEffect(() => {
    const saved = localStorage.getItem('tungan-v4-state');
    if (saved) {
      try {
        const data = JSON.parse(saved);
        if (data.projects)
          setProjects(
            data.account
              ? data.projects
              : nicknameAcrossProjects(data.projects, 'Pim P.', 'Pim P.'),
          );
        if (data.tasks) setTasks((data.tasks as Task[]).map(normalizeTask));
        if (data.captures) setCaptures(data.captures);
        if (data.reminders) setReminders(data.reminders);
        if (data.settings) {
          const preferences = normalizeSettings(data.settings);
          setSettings(preferences);
          setPage(preferences.startPage);
        }
        if (data.account) setAccount(data.account);
        if (data.selectedProjectId)
          setSelectedProjectId(data.selectedProjectId);
      } catch {
        localStorage.removeItem('tungan-v4-state');
      }
    }
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(
      'tungan-v4-state',
      JSON.stringify({
        schemaVersion: 5,
        projects,
        tasks,
        captures,
        reminders,
        settings,
        account,
        selectedProjectId,
      }),
    );
  }, [
    account,
    captures,
    hydrated,
    projects,
    reminders,
    selectedProjectId,
    settings,
    tasks,
  ]);
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
      setTaskAssignee(`member:${taskProject.members[0].id}`);
      setTaskPriority('normal');
      setTaskDueDay('today');
      setTaskTime(settings.cutoff);
      setTaskDate(undefined);
      setDeadlineMode('picker');
      setNaturalDeadline('');
    }
  }, [taskDialog, taskProject.id, settings.cutoff]);
  useEffect(() => {
    if (selectedTask)
      setDelegateTarget(
        `${selectedTask.assigneeType}:${selectedTask.assigneeId}`,
      );
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
    setForwardAssignee(`member:${preferred.members[0].id}`);
    setForwardDueDay('today');
    setForwardDate(undefined);
    setForwardTime(settings.cutoff);
  }, [forwardDialog, selectedProject.id, settings.cutoff]);

  const getProject = (id: string) =>
    projects.find((project) => project.id === id) || projects[0];
  const assignmentIsMine = (
    projectId: string,
    type: 'member' | 'team',
    id: string,
  ) => {
    if (type === 'member')
      return (
        ['pim', 'pim-nami', 'me', 'me-view'].includes(id) ||
        id.startsWith('owner-')
      );
    return (
      getProject(projectId)
        .teams.find((team) => team.id === id)
        ?.memberIds.some((memberId) =>
          ['pim', 'pim-nami', 'me'].includes(memberId),
        ) || false
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
    dueDay: 'today' | 'tomorrow' | 'friday' | 'later',
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
    const offset =
      dueDay === 'tomorrow'
        ? 1
        : dueDay === 'friday'
          ? (5 - today.weekday + 7) % 7 || 7
          : 0;
    return fromZonedWallClock(
      today.year,
      today.month,
      today.day + offset,
      hour,
      minute,
    ).toISOString();
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
    const displayName = account.displayName.trim() || account.lineName;
    setAccount((current) => ({
      ...current,
      loggedIn: true,
      lineConnected: true,
      displayName,
    }));
    setProjects((all) =>
      nicknameAcrossProjects(all, account.lineName, displayName),
    );
    setPage(settings.startPage);
    setNotice('เข้าสู่เดโมแล้ว');
  }
  function logout() {
    setAccount((current) => ({ ...current, loggedIn: false }));
    setNotificationOpen(false);
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
              {mobile
                ? selectedProject.source === 'line'
                  ? 'กลุ่ม LINE'
                  : 'พื้นที่ของฉัน'
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

  function updateStatus(task: Task, status: Status) {
    if (!canEditTask(task))
      return setNotice('งานนี้ดูได้อย่างเดียว เพราะคุณไม่ใช่ผู้รับผิดชอบ');
    const updated = {
      ...task,
      status,
      activity: [
        ...task.activity,
        { text: `เปลี่ยนสถานะเป็น ${statusMeta[status].label}`, time: 'เมื่อสักครู่' },
      ],
    };
    setTasks((all) =>
      all.map((item) => (item.id === task.id ? updated : item)),
    );
    setSelectedTask(updated);
    setNotice('อัปเดตสถานะเรียบร้อย');
  }
  function saveTaskUpdate(updated: Task, noticeText: string) {
    setTasks((all) =>
      all.map((item) => (item.id === updated.id ? updated : item)),
    );
    setSelectedTask(updated);
    setNotice(noticeText);
  }
  function acceptTask(task: Task) {
    if (!canEditTask(task)) return setNotice('มีเฉพาะผู้รับผิดชอบที่รับงานนี้ได้');
    if (task.acceptedAt) return setNotice('รับงานนี้แล้ว');
    saveTaskUpdate(
      {
        ...task,
        acceptedAt: 'เมื่อสักครู่',
        status: 'progress',
        reviewState: 'working',
        activity: [
          ...task.activity,
          { text: `${getAssignee(task).label}รับงานแล้ว`, time: 'เมื่อสักครู่' },
        ],
      },
      'รับงานแล้ว · ทีมเห็นเจ้าของงานชัดเจนแล้ว',
    );
  }
  function requestMoreInfo(task: Task) {
    if (!canEditTask(task)) return;
    saveTaskUpdate(
      {
        ...task,
        status: 'blocked',
        reviewState: 'working',
        activity: [
          ...task.activity,
          { text: 'ขอข้อมูลเพิ่มก่อนทำงานต่อ', time: 'เมื่อสักครู่' },
        ],
      },
      'แจ้งว่ารอข้อมูลเพิ่มแล้ว',
    );
  }
  function submitForReview(task: Task) {
    if (!canEditTask(task)) return;
    if (!task.evidence.length) return setNotice('เพิ่มลิงก์หลักฐานก่อนส่งตรวจ');
    saveTaskUpdate(
      {
        ...task,
        status: 'progress',
        reviewState: 'review',
        activity: [
          ...task.activity,
          { text: 'ส่งหลักฐานให้ตรวจ', time: 'เมื่อสักครู่' },
        ],
      },
      'ส่งตรวจแล้ว',
    );
  }
  // Approval closes a task and is the one transition a customer sees, so it
  // was the one place with no permission check at all — not even the
  // client-side one every other mutation here performs. The client review
  // screen called straight through. Until a tokenised review link exists,
  // approval follows the same rule as every other edit.
  function approveTask(task: Task, client = false) {
    if (!canEditTask(task))
      return setNotice('อนุมัติงานได้เฉพาะผู้รับผิดชอบงานนี้');
    saveTaskUpdate(
      {
        ...task,
        status: 'done',
        reviewState: 'approved',
        activity: [
          ...task.activity,
          {
            text: client ? 'ลูกค้าอนุมัติผ่านหน้าตรวจงาน' : 'อนุมัติงานแล้ว',
            time: 'เมื่อสักครู่',
          },
        ],
      },
      'อนุมัติและปิดงานแล้ว',
    );
    setClientApprovalOpen(false);
  }
  function requestRevision(task: Task, client = false) {
    if (!canEditTask(task))
      return setNotice('ขอแก้ไขงานได้เฉพาะผู้รับผิดชอบงานนี้');
    saveTaskUpdate(
      {
        ...task,
        status: 'progress',
        reviewState: 'revision',
        activity: [
          ...task.activity,
          {
            text: client ? 'ลูกค้าขอแก้ไขงาน' : 'ขอแก้ไขและเปิดงานอีกครั้ง',
            time: 'เมื่อสักครู่',
          },
        ],
      },
      'ส่งกลับให้แก้ไขแล้ว',
    );
    setClientApprovalOpen(false);
  }
  function showEntryError(form: HTMLFormElement, error: EntryError) {
    const field = form.elements.namedItem(error.field);
    if (field instanceof HTMLElement) {
      field.focus({ preventScroll: true });
      field.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    }
  }
  function revealCreatedTask(task: Task) {
    setTasks((all) => [task, ...all]);
    setSelectedProjectId(task.projectId);
    navigate('tasks');
  }
  function createForwardedTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const message = String(form.get('message') || '').trim();
    const title = String(form.get('title') || '').trim();
    const evidenceUrl = String(form.get('evidenceUrl') || '').trim();
    const error = validateTaskEntry({
      title,
      message,
      evidenceUrl,
      customDate: forwardDueDay === 'later',
      date: forwardDate,
    });
    setForwardError(error);
    if (error) return showEntryError(event.currentTarget, error);
    const [assigneeType, assigneeId] = forwardAssignee.split(':') as [
      'member' | 'team',
      string,
    ];
    const task: Task = {
      id: nextTaskId(tasks),
      projectId: forwardProject.id,
      title,
      assigneeType,
      assigneeId,
      primaryAssigneeType: assigneeType,
      primaryAssigneeId: assigneeId,
      source: `DM บอท · ${forwardProject.name}`,
      dueAt: pickerDueAt(forwardDueDay, forwardDate, forwardTime),
      status: 'todo',
      priority: 'normal',
      note: `ส่งต่อจาก LINE: “${message}”`,
      activity: [{ text: 'นำข้อความจาก LINE มาสร้างงาน', time: 'เมื่อสักครู่' }],
      evidence: evidenceUrl
        ? [{ label: 'ลิงก์ประกอบจาก LINE', url: evidenceUrl }]
        : [],
    };
    revealCreatedTask(task);
    setForwardDialog(false);
    setNotice('สร้างงานจากข้อความ LINE แล้ว');
    event.currentTarget.reset();
  }
  function confirmCapture(capture: Capture) {
    const exists = tasks.some(
      (task) =>
        task.title === capture.title && task.projectId === capture.projectId,
    );
    if (!exists) {
      const task: Task = {
        id: nextTaskId(tasks),
        projectId: capture.projectId,
        title: capture.title,
        assigneeType: capture.assigneeType,
        assigneeId: capture.assigneeId,
        primaryAssigneeType: capture.assigneeType,
        primaryAssigneeId: capture.assigneeId,
        source: getProject(capture.projectId).groupLabel,
        dueAt: resolveDeadline(capture.dueText, {
          now,
          cutoff: settings.cutoff,
        }).at.toISOString(),
        status: 'todo',
        priority: 'normal',
        note: `สร้างจากข้อความ “${capture.message}”`,
        activity: [{ text: 'ยืนยันจาก LINE Smart Capture', time: 'เมื่อสักครู่' }],
        evidence: [],
      };
      setTasks((all) => [task, ...all]);
    }
    setCaptures((all) =>
      all.map((item) =>
        item.id === capture.id ? { ...item, state: 'created' } : item,
      ),
    );
    setNotice(exists ? 'งานนี้มีอยู่แล้ว ระบบจึงไม่สร้างซ้ำ' : 'สร้างงานและมอบหมายแล้ว');
  }
  function createTask(event: FormEvent<HTMLFormElement>) {
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
    const assignee = (
      taskAssignee || `member:${taskProject.members[0].id}`
    ).split(':');
    const dueAt =
      deadlineMode === 'natural'
        ? resolveDeadline(naturalDeadline, {
            now,
            cutoff: settings.cutoff,
          }).at.toISOString()
        : pickerDueAt(taskDueDay, taskDate, taskTime);
    const task: Task = {
      id: nextTaskId(tasks),
      projectId: taskProject.id,
      title,
      assigneeType: assignee[0] as 'member' | 'team',
      assigneeId: assignee[1],
      primaryAssigneeType: assignee[0] as 'member' | 'team',
      primaryAssigneeId: assignee[1],
      source: taskProject.groupLabel,
      dueAt,
      status: 'todo',
      priority: taskPriority,
      note: String(form.get('note') || ''),
      activity: [{ text: 'สร้างโดยคุณและกำหนดผู้รับผิดชอบหลัก', time: 'เมื่อสักครู่' }],
      evidence: [],
    };
    revealCreatedTask(task);
    setTaskDialog(false);
    setNaturalDeadline('');
    setNotice(`สร้าง ${task.id} เรียบร้อย`);
    event.currentTarget.reset();
  }
  function addEvidence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTask) return;
    if (!canEditTask(selectedTask))
      return setNotice('งานนี้ดูได้อย่างเดียว เพราะคุณไม่ใช่ผู้รับผิดชอบ');
    const form = new FormData(event.currentTarget);
    const label = String(form.get('label') || '').trim();
    const url = String(form.get('url') || '').trim();
    if (!/^https?:\/\//i.test(url)) {
      setNotice('กรุณาวางลิงก์ http หรือ https');
      return;
    }
    const updated = {
      ...selectedTask,
      evidence: [
        ...selectedTask.evidence,
        { label: label || 'ลิงก์หลักฐาน', url },
      ],
      activity: [
        ...selectedTask.activity,
        { text: `เพิ่มหลักฐาน: ${label}`, time: 'เมื่อสักครู่' },
      ],
    };
    setTasks((all) =>
      all.map((item) => (item.id === updated.id ? updated : item)),
    );
    setSelectedTask(updated);
    setEvidenceOpen(false);
    setNotice('เพิ่มลิงก์แล้ว — ไม่มีการเก็บไฟล์');
  }
  function updateNickname(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!nicknameMember) return;
    const nickname = String(
      new FormData(event.currentTarget).get('nickname') || '',
    ).trim();
    if (!nickname) return;
    setProjects((all) =>
      nicknameAcrossProjects(all, nicknameMember.lineName, nickname),
    );
    if (nicknameMember.lineName === account.lineName)
      setAccount((current) => ({ ...current, displayName: nickname }));
    setNicknameMember(null);
    setNotice('บันทึกชื่อเล่นในทุกพื้นที่งานแล้ว');
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
  function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get('projectName') || '').trim();
    if (!name) return;
    const source = projectSource;
    const id = `project-${Date.now()}`;
    const project: Project = {
      id,
      name,
      source,
      groupLabel: source === 'line' ? `LINE · ${name}` : 'สร้างในทันงาน',
      members: [
        {
          id: `owner-${id}`,
          lineName: account.lineName,
          nickname: account.displayName,
          initials: initialsFor(account.displayName),
          role: 'เจ้าของ',
        },
      ],
      teams: [],
    };
    setProjects((all) => [...all, project]);
    setSelectedProjectId(id);
    setProjectDialog(false);
    setNotice('สร้างพื้นที่งานใหม่แล้ว');
  }
  function createReminder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get('title') || '').trim();
    if (!title) return;
    setReminders((all) => [
      {
        id: `REM-${Date.now()}`,
        title,
        date: reminderDay === 'today' ? 'วันนี้' : 'พรุ่งนี้',
        time: reminderTime,
        repeat: reminderRepeat,
        done: false,
      },
      ...all,
    ]);
    setReminderDialog(false);
    setNotice('สร้างเตือนแล้ว — ไม่เสียค่าใช้จ่ายเพิ่ม');
    event.currentTarget.reset();
  }
  function createQuickReminder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = quickReminderTitle.trim();
    if (!title) return setNotice('พิมพ์เรื่องที่อยากให้เตือนก่อน');
    setReminders((all) => [
      {
        id: `REM-${Date.now()}`,
        title,
        date: quickReminderDay === 'today' ? 'วันนี้' : 'พรุ่งนี้',
        time: quickReminderTime,
        repeat: 'once',
        done: false,
      },
      ...all,
    ]);
    setQuickReminderTitle('');
    setNotice(
      `ตั้งเตือน${quickReminderDay === 'today' ? 'วันนี้' : 'พรุ่งนี้'} ${quickReminderTime} แล้ว`,
    );
  }
  function toggleReminder(id: string) {
    setReminders((all) =>
      all.map((item) =>
        item.id === id ? { ...item, done: !item.done } : item,
      ),
    );
  }
  function snoozeReminder(id: string) {
    setReminders((all) =>
      all.map((item) => {
        if (item.id !== id) return item;
        const [hour, minute] = item.time.split(':').map(Number);
        const total = (hour * 60 + minute + 10) % (24 * 60);
        return {
          ...item,
          time: `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`,
        };
      }),
    );
    setNotice('เลื่อนเตือนออกไป 10 นาทีแล้ว');
  }
  function delegateTask(task: Task) {
    if (!canEditTask(task)) return setNotice('มีเฉพาะผู้รับผิดชอบงานนี้ที่ส่งงานต่อได้');
    if (!delegateTarget) return;
    const [assigneeType, assigneeId] = delegateTarget.split(':') as [
      'member' | 'team',
      string,
    ];
    if (assigneeType === task.assigneeType && assigneeId === task.assigneeId)
      return setNotice('งานนี้อยู่กับผู้รับคนนี้แล้ว');
    const nextAssignee = getAssignee({
      projectId: task.projectId,
      assigneeType,
      assigneeId,
    });
    const updated: Task = {
      ...task,
      primaryAssigneeType: task.primaryAssigneeType || task.assigneeType,
      primaryAssigneeId: task.primaryAssigneeId || task.assigneeId,
      assigneeType,
      assigneeId,
      activity: [
        ...task.activity,
        { text: `ผู้รับผิดชอบหลักส่งงานต่อให้ ${nextAssignee.label}`, time: 'เมื่อสักครู่' },
      ],
    };
    setTasks((all) =>
      all.map((item) => (item.id === updated.id ? updated : item)),
    );
    setSelectedTask(updated);
    setNotice(`ส่งงานต่อให้ ${nextAssignee.label} แล้ว`);
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
                    onClick={() =>
                      setCaptures((all) =>
                        all.map((item) =>
                          item.id === capture.id
                            ? { ...item, state: 'dismissed' }
                            : item,
                        ),
                      )
                    }
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
                    <p>
                      {nextReminder.repeat === 'daily'
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
              <Button type="submit">บันทึกชื่อ</Button>
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
            <Badge variant="outline">ยังไม่เชื่อมจริง</Badge>
          </div>
          <div className="connection-row">
            <span>
              <Bot />
              AI
            </span>
            <Badge variant="outline">เร็ว ๆ นี้</Badge>
          </div>
          <p className="connection-notice">การเตือนผ่าน LINE ยังไม่เปิดใช้</p>
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
                  {member.lineName === account.lineName
                    ? 'คุณ · แก้ชื่อเล่น'
                    : 'แก้ชื่อเล่น'}
                </Badge>
                <Pencil />
              </button>
            ))}
          </div>
          <div className="info-strip">
            <Users />
            <p>รายชื่ออ้างอิงจากสมาชิกในกลุ่ม LINE นี้ ส่วนชื่อเล่นแก้เฉพาะในทันงาน</p>
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

  if (!account.loggedIn) {
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
          <Button className="auth-line-button" onClick={loginWithLine}>
            <LogIn />
            เข้าสู่เดโม
          </Button>
          <small>โหมด Public Beta · ข้อมูลตัวอย่างเก็บในอุปกรณ์นี้</small>
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
                        ? parseNaturalDeadline(naturalDeadline, settings.cutoff)
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
                        ] as const
                      ).map((item) => (
                        <button
                          type="button"
                          key={item.key}
                          className={taskDueDay === item.key ? 'active' : ''}
                          onClick={() => setTaskDueDay(item.key)}
                        >
                          {item.label}
                        </button>
                      ))}
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
              <section className="detail-section">
                <h3>กิจกรรม</h3>
                {selectedTask.activity.map((activity, index) => (
                  <div className="activity-row" key={index}>
                    <i />
                    <span>{activity.text}</span>
                    <small>{activity.time}</small>
                  </div>
                ))}
              </section>
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
        <DialogContent key={nicknameMember?.id || 'nickname'}>
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
              <Input
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
              <Button type="submit">บันทึกชื่อ</Button>
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
