'use client';

import { useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api, ApiError, newIdempotencyKey } from '@/lib/api/client';
import { t } from '@/lib/i18n';

/**
 * The three AI helpers on screen (2026-10-25). Each is one press, one answer,
 * shown in place and labelled as AI's. None changes anything: the order of
 * งานฉัน stays its own, and a summary is something to read, not a chat.
 *
 * The parent shows these only when AI is on for the workspace. A press keeps
 * its key until it gets an answer or a refusal, so a retry after a dropped
 * connection is neither charged again nor asked again.
 */

function useAiCall<T>() {
  const key = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function run(call: (key: string) => Promise<T>) {
    key.current ??= newIdempotencyKey();
    setBusy(true);
    setError(null);
    try {
      setResult(await call(key.current));
      key.current = null;
    } catch (err) {
      // The server answered (a refusal: off, used up, no answer): that key is
      // spent. A dropped connection keeps it, so trying again is the same
      // request and is not charged twice.
      if (err instanceof ApiError) key.current = null;
      setError(err instanceof ApiError ? t(err.message) : t('AI ไม่ตอบในตอนนี้ · ลองใหม่อีกครั้ง'));
    } finally {
      setBusy(false);
    }
  }
  return { busy, result, error, run, reset: () => setResult(null) };
}

function AiLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="ai-panel-label">
      <Sparkles />
      <span>{children}</span>
    </p>
  );
}

/** งานฉัน: "what first?" — up to three of my tasks, each with a reason. */
export function AiPriorities({
  workspaceId,
  titleOf,
  onOpen,
}: {
  workspaceId: string;
  titleOf: (taskId: string) => string | null;
  onOpen: (taskId: string) => void;
}) {
  const call = useAiCall<Array<{ taskId: string; reason: string }>>();
  const picks = (call.result ?? []).filter((p) => titleOf(p.taskId));
  return (
    <div className="panel ai-panel">
      <AiLabel>{t('AI ช่วยจัดลำดับ · เป็นคำแนะนำ ลำดับด้านล่างไม่เปลี่ยน')}</AiLabel>
      {call.result && (
        picks.length ? (
          <ol className="ai-picks">
            {picks.map((p) => (
              <li key={p.taskId}>
                <button type="button" onClick={() => onOpen(p.taskId)}>
                  <strong>{titleOf(p.taskId)}</strong>
                  <small>{p.reason}</small>
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <p className="ai-panel-text">{t('AI ไม่มีคำแนะนำเพิ่มจากลำดับเดิม')}</p>
        )
      )}
      {call.error && <p className="ai-panel-error">{call.error}</p>}
      <Button
        variant="outline"
        disabled={call.busy}
        onClick={() => void call.run(async (key) => (await api.aiPriorities(workspaceId, key)).suggestions)}
      >
        <Sparkles />
        {call.busy ? t('กำลังคิด…') : call.result ? t('ถามใหม่') : t('ควรทำอะไรก่อน')}
      </Button>
    </div>
  );
}

/** Task sheet: where this task stands, from its history as I may read it. */
export function AiTaskSummary({ taskId }: { taskId: string }) {
  const call = useAiCall<{ summary: string; nextStep: string | null }>();
  return (
    <div className="ai-panel ai-panel-inline">
      {call.result ? (
        <>
          <AiLabel>{t('สรุปโดย AI · ตรวจกับประวัติด้านล่าง')}</AiLabel>
          <p className="ai-panel-text">{call.result.summary}</p>
          {call.result.nextStep && (
            <p className="ai-panel-text">
              <strong>{t('ขั้นต่อไป')}</strong> {call.result.nextStep}
            </p>
          )}
        </>
      ) : (
        <Button
          variant="outline"
          disabled={call.busy}
          onClick={() => void call.run((key) => api.aiTaskSummary(taskId, key))}
        >
          <Sparkles />
          {call.busy ? t('กำลังสรุป…') : t('สรุปด้วย AI')}
        </Button>
      )}
      {call.error && <p className="ai-panel-error">{call.error}</p>}
    </div>
  );
}

/** ภาพรวม: the group's day or week, in a few lines. */
export function AiPeriodSummary({ workspaceId }: { workspaceId: string }) {
  const call = useAiCall<{ range: 'day' | 'week'; summary: string; highlights: string[] }>();
  return (
    <div className="panel ai-panel">
      <AiLabel>
        {call.result
          ? call.result.range === 'day'
            ? t('สรุปวันนี้โดย AI')
            : t('สรุปสัปดาห์นี้โดย AI')
          : t('ให้ AI สรุปงานของกลุ่ม')}
      </AiLabel>
      {call.result && (
        <>
          <p className="ai-panel-text">{call.result.summary}</p>
          {call.result.highlights.length > 0 && (
            <ul className="ai-highlights">
              {call.result.highlights.map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ul>
          )}
        </>
      )}
      {call.error && <p className="ai-panel-error">{call.error}</p>}
      <div className="ai-panel-actions">
        <Button
          variant="outline"
          disabled={call.busy}
          onClick={() => void call.run((key) => api.aiPeriodSummary(workspaceId, 'day', key))}
        >
          <Sparkles />
          {t('สรุปวันนี้@@ai')}
        </Button>
        <Button
          variant="outline"
          disabled={call.busy}
          onClick={() => void call.run((key) => api.aiPeriodSummary(workspaceId, 'week', key))}
        >
          <Sparkles />
          {t('สรุปสัปดาห์นี้')}
        </Button>
      </div>
    </div>
  );
}
