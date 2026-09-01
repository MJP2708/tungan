export type EntryError = { field: string; message: string };

export function validateTaskEntry(input: {
  title: string;
  message?: string;
  evidenceUrl?: string;
  customDate?: boolean;
  date?: Date;
}): EntryError | null {
  if (input.message !== undefined && !input.message.trim())
    return { field: 'message', message: 'วางข้อความจาก LINE ก่อน' };
  if (!input.title.trim()) return { field: 'title', message: 'ใส่ชื่องานก่อน' };
  if (
    input.customDate &&
    (!input.date || !Number.isFinite(input.date.getTime()))
  )
    return { field: 'date', message: 'เลือกกำหนดส่งก่อน' };
  if (input.evidenceUrl?.trim()) {
    try {
      const url = new URL(input.evidenceUrl.trim());
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
    } catch {
      return {
        field: 'evidenceUrl',
        message: 'ใส่ลิงก์ http:// หรือ https:// ที่ถูกต้อง',
      };
    }
  }
  return null;
}

// Count-based IDs collided when tasks came from different creation flows.
export function nextTaskId(tasks: readonly { id: string }[]): string {
  return `TNG-${Math.max(260, ...tasks.map(({ id }) => Number(/^TNG-(\d+)$/.exec(id)?.[1]) || 0)) + 1}`;
}

export function visibleFormViewport(viewport: {
  height: number;
  offsetTop: number;
}) {
  return {
    height: Math.max(1, viewport.height),
    top: Math.max(0, viewport.offsetTop),
  };
}
