# Tungan interaction patterns

## Quick deadline

Use quick presets for the common path and keep natural language optional.

- Day presets: วันนี้, พรุ่งนี้, ศุกร์, วันอื่น
- Time: use the themed Select component; never use browser-native date or time inputs
- Natural language: a small secondary action, not a full-width mode switch
- Summary: always show the interpreted deadline before submission
- Keyboard: preset buttons are focusable; Select supports arrows, Enter, and Escape; Calendar uses the DayPicker keyboard model

## Permission-aware task detail

- Editable: current assignee or primary owner can change status, add evidence, and delegate
- Read-only: everyone else can view details, evidence, and activity, but no edit controls are rendered
- Read-only state must show a lock explanation instead of relying on disabled controls alone

## Gradient usage

- `--blue`: the only brand blue is `#0080FF`; do not introduce alternative blue or violet hues
- `--gradient-brand`: high-attention LINE inbox and AI identity only
- `--gradient-soft`: supporting informational surfaces
- `--gradient-border`: deadline emphasis without filling the whole form with color
- `--shadow-outline-glow`: soft `#0080FF` light outside gradient borders; use on priority shortcuts and reminder focus surfaces
- `--shadow-outline-glow-hover`: stronger external glow for hover only
- Keep ordinary task cards, forms, and navigation monochrome

## AI-ready state

- Clearly label the page as not connected
- Disable the composer until a real AI service is configured
- Never imply that messages are processed or create simulated AI responses

## Reminder pricing

Reminders are included in every plan. Do not show per-reminder quotas or paid reminder-only tiers.

## Notification popover

- The top bell opens a compact popover; it does not navigate away from the current page
- Show no more than three recent updates with a clear type icon, short description, and time
- A blue dot means unread; opening an item or choosing “อ่านแล้วทั้งหมด” clears the unread state
- Each item links to its relevant destination, while “ดูการอัปเดตทั้งหมด” opens the LINE inbox
- Keep the full reminder center accessible from the sidebar rather than using the bell as its shortcut
