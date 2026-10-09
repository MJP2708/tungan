'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, Trash2, Video } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
} from '@/components/ui/select';
import { api, ApiError, newIdempotencyKey, type ApiEvent, type EventInputBody } from '@/lib/api/client';
import { ALL_DAY_NOTIFY, TIMED_NOTIFY, notifyRecipients } from '@/lib/calendar-event-rules';
import { dayKey, type DayKey } from '@/lib/calendar';
import { fromZonedWallClock } from '@/lib/deadline';
import { meetingLinkLabel, normalizeMeetingLink } from '@/lib/meeting-link';
import { t, intlLocale } from '@/lib/i18n';

/**
 * Add or change something on the calendar (2026-10-09): an event — for me,
 * the whole workspace or picked people, with a LINE notification — or a
 * personal reminder (the same as เตือนฉัน). Other people's events open
 * read-only, with the join link.
 *
 * No native date or time pickers: the day is the one picked on the calendar,
 * stepped with ‹ ›, and times are themed selects.
 */

type Member = { id: string; nickname: string };

export type EventDialogTarget =
  | { mode: 'new'; day: DayKey }
  | { mode: 'edit'; event: ApiEvent };

const TIMES = Array.from(
  { length: 96 },
  (_, i) => `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`,
);

const pad = (n: number) => String(n).padStart(2, '0');

function bangkokTime(at: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(at);
}

function instantOf(day: DayKey, time: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return fromZonedWallClock(y, m, d, hh, mm);
}

function shiftDay(day: DayKey, by: number): DayKey {
  const [y, m, d] = day.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + by));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

export function dayLabel(day: DayKey): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Intl.DateTimeFormat(intlLocale(), {
    timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short',
  }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}

export function notifyLabel(minutes: number | null): string {
  switch (minutes) {
    case null: return t('ไม่เตือน');
    case 0: return t('ตอนเริ่ม');
    case 10: return t('10 นาทีก่อน');
    case 30: return t('30 นาทีก่อน');
    case 60: return t('1 ชั่วโมงก่อน');
    case 1440: return t('1 วันก่อน');
    case -540: return t('เช้าวันนั้น 09:00');
    case 900: return t('วันก่อนหน้า 09:00');
    default: return t('ไม่เตือน');
  }
}

/** "09:00–10:30", or "ทั้งวัน". */
export function eventTimeLabel(event: Pick<ApiEvent, 'allDay' | 'startsAt' | 'endsAt'>): string {
  if (event.allDay) return t('ทั้งวัน');
  const start = bangkokTime(new Date(event.startsAt));
  return event.endsAt ? `${start}–${bangkokTime(new Date(event.endsAt))}` : start;
}

export function audienceLabel(event: Pick<ApiEvent, 'audience' | 'attendees'>): string {
  if (event.audience === 'everyone') return t('ทุกคน');
  if (event.audience === 'people') return t('{0} คน', event.attendees.length + 1);
  return t('ส่วนตัว');
}

export function EventDialog({
  target,
  onClose,
  workspaceId,
  members,
  meUserId,
  onSaved,
}: {
  target: EventDialogTarget | null;
  onClose: () => void;
  workspaceId: string;
  members: Member[];
  meUserId: string;
  /** After any change, with what to tell the person. */
  onSaved: (notice: string) => void;
}) {
  const editing = target?.mode === 'edit' ? target.event : null;
  const readOnly = !!editing && !editing.canEdit;

  const [kind, setKind] = useState<'event' | 'reminder'>('event');
  const [title, setTitle] = useState('');
  const [day, setDay] = useState<DayKey>('');
  const [allDay, setAllDay] = useState(false);
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('10:00');
  const [audience, setAudience] = useState<ApiEvent['audience']>('me');
  const [attendees, setAttendees] = useState<string[]>([]);
  const [notify, setNotify] = useState<number | null>(30);
  const [link, setLink] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [armedDelete, setArmedDelete] = useState(false);

  // Fill the form each time it opens.
  useEffect(() => {
    if (!target) return;
    setError('');
    setArmedDelete(false);
    setBusy(false);
    if (target.mode === 'edit') {
      const e = target.event;
      setKind('event');
      setTitle(e.title);
      setDay(dayKey(e.startsAt) ?? '');
      setAllDay(e.allDay);
      setStart(bangkokTime(new Date(e.startsAt)));
      setEnd(e.endsAt ? bangkokTime(new Date(e.endsAt)) : bangkokTime(new Date(new Date(e.startsAt).getTime() + 3600000)));
      setAudience(e.audience);
      setAttendees(e.attendees.map((a) => a.userId).filter((id) => id !== e.createdByUserId));
      setNotify(e.notifyMinutes);
      setLink(e.link ?? '');
      setNote(e.note);
      return;
    }
    // A new one starts at the next whole hour today, or 09:00 another day.
    const isToday = target.day === dayKey(new Date());
    const hourNow = Number(bangkokTime(new Date()).slice(0, 2)) + 1;
    const startHour = isToday ? Math.min(23, hourNow) : 9;
    setKind('event');
    setTitle('');
    setDay(target.day);
    setAllDay(false);
    setStart(`${pad(startHour)}:00`);
    setEnd(`${pad(Math.min(23, startHour + 1))}:${startHour >= 23 ? '45' : '00'}`);
    setAudience('me');
    setAttendees([]);
    setNotify(30);
    setLink('');
    setNote('');
  }, [target]);

  const notifyChoices: Array<number | null> = allDay ? [null, ...ALL_DAY_NOTIFY] : [null, ...TIMED_NOTIFY];
  // Switching all-day changes what "remind me" can mean.
  useEffect(() => {
    if (notify !== null && !notifyChoices.includes(notify)) setNotify(allDay ? -540 : 30);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allDay]);

  const cost = useMemo(
    () =>
      notify === null
        ? 0
        : notifyRecipients({
            audience,
            createdBy: editing?.createdByUserId ?? meUserId,
            attendeeIds: attendees,
            memberIds: members.map((m) => m.id),
          }).length,
    [notify, audience, attendees, members, meUserId, editing],
  );

  function body(): EventInputBody {
    return {
      title: title.trim(),
      note: note.trim(),
      link: link.trim() || null,
      allDay,
      startsAt: (allDay ? instantOf(day, '00:00') : instantOf(day, start)).toISOString(),
      endsAt: allDay ? null : instantOf(day, end).toISOString(),
      audience,
      attendeeIds: audience === 'people' ? attendees : [],
      notifyMinutes: notify,
    };
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim()) return setError(kind === 'event' ? t('ใส่ชื่อกิจกรรมก่อน') : t('พิมพ์เรื่องที่อยากให้เตือนก่อน'));
    setError('');
    if (kind === 'reminder') {
      const at = instantOf(day, start);
      if (at.getTime() <= Date.now()) return setError(t('เวลานี้ผ่านไปแล้ว · เลือกพรุ่งนี้หรือเวลาอื่น'));
      setBusy(true);
      try {
        await api.createReminder(
          { workspaceId, dueAt: at.toISOString(), leadMinutes: 0, note: title.trim() },
          newIdempotencyKey(),
        );
        onSaved(t('ตั้งเตือนแล้ว'));
        onClose();
      } catch (e) {
        setError(e instanceof ApiError ? t(e.message) : t('ตั้งเตือนไม่สำเร็จ'));
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!allDay && end <= start) return setError(t('เวลาจบต้องหลังเวลาเริ่ม'));
    if (audience === 'people' && attendees.length === 0) return setError(t('เลือกคนที่จะเชิญอย่างน้อยหนึ่งคน'));
    try {
      normalizeMeetingLink(link);
    } catch (e) {
      return setError((e as Error).message);
    }
    setBusy(true);
    try {
      const res = editing
        ? await api.updateEvent(editing.id, body())
        : await api.createEvent(workspaceId, body(), newIdempotencyKey());
      onSaved(
        (editing ? t('บันทึกกิจกรรมแล้ว') : t('เพิ่มกิจกรรมแล้ว')) +
          (res.recipients ? t(' · จะแจ้งเตือนทาง LINE {0} คน', res.recipients) : ''),
      );
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? t(e.message) : t('บันทึกไม่สำเร็จ'));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!editing) return;
    if (!armedDelete) return setArmedDelete(true);
    setBusy(true);
    try {
      await api.deleteEvent(editing.id);
      onSaved(t('ลบกิจกรรมแล้ว'));
      onClose();
    } catch (e) {
      // Already gone counts as done.
      if (e instanceof ApiError && e.status === 404) {
        onSaved(t('ลบกิจกรรมแล้ว'));
        onClose();
      } else {
        setError(e instanceof ApiError ? t(e.message) : t('ลบไม่สำเร็จ'));
      }
    } finally {
      setBusy(false);
    }
  }

  const timeSelect = (value: string, onChange: (v: string) => void, label: string) => (
    <Select value={value} onValueChange={(v) => onChange(v as string)}>
      <SelectTrigger className="themed-field-trigger" aria-label={label}>
        <Clock3 />
        <strong>{value}</strong>
      </SelectTrigger>
      <SelectContent align="start" className="themed-select-content time-menu">
        <SelectGroup>
          <SelectLabel>{label}</SelectLabel>
          {TIMES.map((time) => (
            <SelectItem value={time} key={time}>
              <Clock3 />
              {time}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="event-dialog">
        <DialogHeader>
          <DialogTitle>
            {readOnly ? editing!.title : editing ? t('แก้ไขกิจกรรม') : t('เพิ่มในปฏิทิน')}
          </DialogTitle>
          <DialogDescription className={readOnly ? 'event-meta' : 'sr-only'}>
            {readOnly
              ? `${dayLabel(dayKey(editing!.startsAt) ?? '')} · ${eventTimeLabel(editing!)} · ${audienceLabel(editing!)}`
              : t('กิจกรรมหรือการเตือนในวันที่เลือก')}
          </DialogDescription>
        </DialogHeader>

        {readOnly ? (
          <div className="stack-form">
            {editing!.link && (
              <a className="announce-link announcement-join" href={editing!.link} target="_blank" rel="noopener noreferrer">
                <Video />
                {meetingLinkLabel(editing!.link)}
              </a>
            )}
            {editing!.note && <p className="announcement-body">{editing!.note}</p>}
            <p className="event-meta">
              {t('สร้างโดย {0}', editing!.createdByName ?? t('ไม่ทราบชื่อ'))}
              {editing!.notifyMinutes !== null ? ` · ${t('เตือน')} ${notifyLabel(editing!.notifyMinutes)}` : ''}
            </p>
          </div>
        ) : (
          <form className="stack-form" onSubmit={submit}>
            {!editing && (
              <div className="quick-day-switch event-kind" role="group" aria-label={t('ประเภท')}>
                <button type="button" className={kind === 'event' ? 'active' : ''} onClick={() => setKind('event')}>
                  {t('กิจกรรม')}
                </button>
                <button type="button" className={kind === 'reminder' ? 'active' : ''} onClick={() => setKind('reminder')}>
                  {t('เตือนฉัน')}
                </button>
              </div>
            )}
            <label>
              <span>{kind === 'event' ? t('ชื่อกิจกรรม') : t('เตือนเรื่อง')}</span>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={kind === 'event' ? 120 : 200}
                placeholder={kind === 'event' ? t('เช่น ประชุมลูกค้า ABC') : t('เช่น โทรติดตามลูกค้า')}
              />
            </label>

            <div className="event-day">
              <span>{t('วัน')}</span>
              <div>
                <button type="button" aria-label={t('วันก่อนหน้า')} onClick={() => setDay(shiftDay(day, -1))}>
                  <ChevronLeft />
                </button>
                <strong>
                  <CalendarDays />
                  {day ? dayLabel(day) : ''}
                </strong>
                <button type="button" aria-label={t('วันถัดไป')} onClick={() => setDay(shiftDay(day, 1))}>
                  <ChevronRight />
                </button>
              </div>
            </div>

            {kind === 'event' && (
              <label className="event-switch">
                <span>{t('ทั้งวัน')}</span>
                <Switch checked={allDay} onCheckedChange={setAllDay} />
              </label>
            )}

            {(kind === 'reminder' || !allDay) && (
              <div className="event-times">
                <label>
                  <span>{kind === 'event' ? t('เริ่ม') : t('เวลา')}</span>
                  {timeSelect(start, (v) => {
                    setStart(v);
                    if (end <= v) setEnd(TIMES[Math.min(TIMES.length - 1, TIMES.indexOf(v) + 4)]);
                  }, t('เลือกเวลา'))}
                </label>
                {kind === 'event' && (
                  <label>
                    <span>{t('จบ')}</span>
                    {timeSelect(end, setEnd, t('เลือกเวลา'))}
                  </label>
                )}
              </div>
            )}

            {kind === 'event' && (
              <>
                <div className="event-audience">
                  <span>{t('ใครเห็น')}</span>
                  <div className="quick-day-switch" role="group" aria-label={t('ใครเห็น')}>
                    {(['me', 'everyone', 'people'] as const).map((value) => (
                      <button
                        type="button"
                        key={value}
                        className={audience === value ? 'active' : ''}
                        onClick={() => setAudience(value)}
                      >
                        {value === 'me' ? t('ฉัน') : value === 'everyone' ? t('ทุกคน') : t('เลือกคน')}
                      </button>
                    ))}
                  </div>
                  {audience === 'people' && (
                    <div className="event-people">
                      {members
                        .filter((m) => m.id !== (editing?.createdByUserId ?? meUserId))
                        .map((m) => (
                          <button
                            type="button"
                            key={m.id}
                            aria-pressed={attendees.includes(m.id)}
                            className={attendees.includes(m.id) ? 'active' : ''}
                            onClick={() =>
                              setAttendees((list) =>
                                list.includes(m.id) ? list.filter((id) => id !== m.id) : [...list, m.id],
                              )
                            }
                          >
                            {m.nickname}
                          </button>
                        ))}
                    </div>
                  )}
                </div>

                <label>
                  <span>{t('แจ้งเตือน')}</span>
                  <Select
                    value={notify === null ? 'none' : String(notify)}
                    onValueChange={(v) => setNotify(v === 'none' ? null : Number(v))}
                  >
                    <SelectTrigger className="themed-field-trigger" aria-label={t('แจ้งเตือน')}>
                      <span>{notifyLabel(notify)}</span>
                    </SelectTrigger>
                    <SelectContent align="start" className="themed-select-content">
                      {notifyChoices.map((value) => (
                        <SelectItem key={String(value)} value={value === null ? 'none' : String(value)}>
                          {notifyLabel(value)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {/* Say what it costs before it is spent: LINE bills per person. */}
                  {cost > 0 && (
                    <small className="event-cost">
                      {t('ส่งทาง LINE ถึง {0} คน · ใช้ {0} ข้อความจากโควตาเดือนนี้', cost)}
                    </small>
                  )}
                </label>

                <label>
                  <span>
                    {t('ลิงก์ประชุม')} <small>{t('ไม่บังคับ · Google Meet, Zoom หรือ LINE')}</small>
                  </span>
                  <Input
                    value={link}
                    onChange={(e) => setLink(e.target.value)}
                    inputMode="url"
                    autoComplete="off"
                    maxLength={500}
                    placeholder="https://meet.google.com/..."
                  />
                </label>
                <label>
                  <span>
                    {t('รายละเอียด')} <small>{t('ไม่บังคับ')}</small>
                  </span>
                  <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={3} />
                </label>
              </>
            )}

            {error && (
              <p className="entry-error" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" disabled={busy}>
              {kind === 'reminder' ? t('ตั้งเตือน') : editing ? t('บันทึก') : t('เพิ่มกิจกรรม')}
            </Button>
            {editing && (
              <button type="button" className={`reminder-delete-link ${armedDelete ? 'armed' : ''}`} disabled={busy} onClick={() => void remove()}>
                <Trash2 />
                {armedDelete ? t('แตะอีกครั้งเพื่อลบ') : t('ลบกิจกรรมนี้')}
              </button>
            )}
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
