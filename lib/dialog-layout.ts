export type DialogLayout = 'centered' | 'custom';

// Custom layouts own their position entirely. Do not combine independent
// Tailwind translate utilities with a CSS transform reset: production CSS
// optimization can preserve the former while rewriting the latter.
export function dialogLayoutClasses(layout: DialogLayout): string {
  return layout === 'centered'
    ? 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95'
    : '';
}
