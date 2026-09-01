'use client';

import { useEffect, useRef, type ComponentProps } from 'react';
import { DialogContent } from '@/components/ui/dialog';
import { visibleFormViewport } from '@/lib/task-entry';

// One fixed shell, one scrolling field area, and an in-flow action bar.
// iOS keyboards shrink the visual viewport, not necessarily 100dvh.
export function TaskEntryDialog({
  open,
  className = '',
  ...props
}: ComponentProps<typeof DialogContent> & { open: boolean }) {
  const popup = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const viewport = window.visualViewport;
    let frame = 0;
    const update = () => {
      const bounds = visibleFormViewport(
        viewport || { height: window.innerHeight, offsetTop: 0 },
      );
      popup.current?.style.setProperty(
        '--entry-visible-height',
        `${bounds.height}px`,
      );
      popup.current?.style.setProperty(
        '--entry-visible-top',
        `${bounds.top}px`,
      );
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    schedule();
    viewport?.addEventListener('resize', schedule);
    viewport?.addEventListener('scroll', schedule);
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener('resize', schedule);
      viewport?.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [open]);

  return (
    <DialogContent
      {...props}
      layout="custom"
      ref={popup}
      className={`task-entry-dialog ${className}`}
      initialFocus={() => popup.current}
    />
  );
}
