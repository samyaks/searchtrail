// The month chart's arithmetic and wording, apart from the component so it can be tested and reused.
import type { MonthCount } from './MonthChart';

export const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LONG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** The height, in px, of the tallest bar. */
export const BAR_AREA = 130;

/** "2024-09" as the year and the month's index (0 for January). */
export function parseMonth(month: string) {
  const [year = '', number = ''] = month.split('-');
  return { year, index: Number(number) - 1 };
}

/** "2024-09" as "September 2024". */
export function monthName(month: string): string {
  const { year, index } = parseMonth(month);
  return `${LONG_MONTHS[index] ?? month} ${year}`;
}

/** What a screen reader hears for the picture: the span, and where the lowest and highest months are. */
export function describeMonths(months: readonly MonthCount[]): string {
  if (months.length === 0) return 'No months to show.';
  const lowest = months.reduce((a, b) => (b.count < a.count ? b : a));
  const highest = months.reduce((a, b) => (b.count > a.count ? b : a));
  const first = months[0]!;
  const last = months[months.length - 1]!;
  return (
    `Items per month, ${monthName(first.month)} to ${monthName(last.month)}. ` +
    `Lowest ${lowest.count.toLocaleString('en-US')} in ${monthName(lowest.month)}, highest ${highest.count.toLocaleString('en-US')} in ${monthName(highest.month)}.`
  );
}
