// Dates and times the way the design writes them. The viewer's own time zone, 24-hour clock.

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** "today 10:42", "yesterday 16:20", or the date ("28 Oct", with the year when it isn't this one). */
export function dayAndTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const days = Math.round((dayStart(now) - dayStart(d)) / 86_400_000);
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (days === 0) return `today ${time}`;
  if (days === 1) return `yesterday ${time}`;
  return d.getFullYear() === now.getFullYear()
    ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "3 Nov 2026". */
export function dateText(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
