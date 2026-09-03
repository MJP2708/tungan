'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { X } from 'lucide-react';

/**
 * One toast at a time.
 *
 * Stacking is deliberately impossible: a queue of toasts on a phone covers the
 * thing the person is trying to press, and by the third one nobody is reading
 * them. A new toast replaces the current one.
 *
 * Placement is handled in CSS so it sits above the bottom navigation and the
 * safe area on mobile, and bottom-right on desktop — it must never cover the
 * control that was just pressed.
 */

export type Toast = {
  /** Names what happened to WHAT: "รับงานแล้ว: ส่งรายงานลูกค้า". */
  text: string;
  /** Present for reversible actions. Undo replaces confirmation dialogs. */
  action?: { label: string; run: () => void | Promise<void> };
  tone?: 'ok' | 'error';
};

/** Longer when there is something to press, since reading plus deciding takes longer. */
const PLAIN_MS = 4000;
const WITH_ACTION_MS = 8000;

export function useToast() {
  const [toast, setToast] = useState<(Toast & { key: number }) | null>(null);
  const timer = useRef<number | null>(null);

  const dismiss = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    setToast(null);
  }, []);

  const show = useCallback(
    (next: Toast) => {
      if (timer.current) window.clearTimeout(timer.current);
      setToast({ ...next, key: Date.now() });
      timer.current = window.setTimeout(
        () => setToast(null),
        next.action ? WITH_ACTION_MS : PLAIN_MS,
      );
    },
    [],
  );

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  return { toast, show, dismiss };
}

export function ToastHost({
  toast,
  onDismiss,
}: {
  toast: (Toast & { key: number }) | null;
  onDismiss: () => void;
}) {
  const startX = useRef<number | null>(null);
  if (!toast) return null;

  return (
    <div
      className={`toast-host ${toast.tone === 'error' ? 'toast-error' : ''}`}
      // Announced to screen readers. An error that needs a decision is not a
      // toast at all, so polite is right for everything that reaches here.
      role="status"
      aria-live="polite"
      onTouchStart={(e) => {
        startX.current = e.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(e) => {
        const from = startX.current;
        const to = e.changedTouches[0]?.clientX ?? null;
        if (from != null && to != null && Math.abs(to - from) > 60) onDismiss();
        startX.current = null;
      }}
    >
      <span className="toast-text">{toast.text}</span>
      {toast.action && (
        <button
          type="button"
          className="toast-action"
          onClick={() => {
            void toast.action?.run();
            onDismiss();
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        className="toast-close"
        aria-label="ปิดข้อความ"
        onClick={onDismiss}
      >
        <X />
      </button>
    </div>
  );
}
