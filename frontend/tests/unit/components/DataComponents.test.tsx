import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { Banner, BarBreakdown, CountTile, EmptyState, InlineError, MethodologyCard, MonthChart, TileGrid, type Bar } from '@/components';
import { markTerms } from '@/components/markTerms';
import { describeMonths } from '@/components/monthSummary';
import { expectNoA11yViolations } from '../a11y';

// -- count tiles -------------------------------------------------------------------------------------------------
test('count tiles are a description list: each label is a term, its number the value', async () => {
  const { container } = render(
    <TileGrid>
      <CountTile label="Items matching" value={1206} note="29.0 MB" />
      <CountTile label="Partially indexed" value={25} note="21.7 MB · included in export" noteTone="ok" />
      <CountTile label="Size" value="50.7 MB" />
    </TileGrid>,
  );
  const terms = screen.getAllByRole('term').map((t) => t.textContent);
  expect(terms).toEqual(['Items matching', 'Partially indexed', 'Size']);
  expect(screen.getByText('1,206')).toBeInTheDocument(); // thousands separators
  expect(screen.getByText('50.7 MB')).toBeInTheDocument(); // text is shown as given
  expect(screen.getByText('21.7 MB · included in export')).toHaveAttribute('data-tone', 'ok');
  expect(screen.getByText('29.0 MB')).toHaveAttribute('data-tone', 'muted');
  await expectNoA11yViolations(container);
});

test('a tile with no note has no empty line', () => {
  render(
    <TileGrid>
      <CountTile label="Locations" value={0} />
    </TileGrid>,
  );
  expect(screen.getAllByRole('definition')).toHaveLength(1);
  expect(screen.getByText('0')).toBeInTheDocument(); // zero is a count, not nothing
});

// -- bar breakdowns ----------------------------------------------------------------------------------------------
const BARS: Bar[] = [
  { key: 'alex', label: 'Alex Wilber', count: 312 },
  { key: 'megan', label: 'Megan Bowen', count: 156 },
  { key: 'none', label: 'No label', count: 0, quiet: true },
];
const widthOf = (name: RegExp) => within(screen.getByRole('button', { name })).getByText('', { selector: 'span[style]' }).style.width;

test('each bar is as long as its count compared with the largest', () => {
  render(<BarBreakdown title="By custodian" bars={BARS} onSelect={() => {}} />);
  expect(widthOf(/Alex Wilber/)).toBe('100%');
  expect(widthOf(/Megan Bowen/)).toBe('50%');
  expect(widthOf(/No label/)).toBe('0%');
});

test('a breakdown is a section named by its title, listing each value with its count', async () => {
  const { container } = render(<BarBreakdown title="By custodian" bars={BARS} />);
  const section = screen.getByRole('region', { name: 'By custodian' });
  expect(within(section).getAllByRole('listitem')).toHaveLength(3);
  expect(within(section).getByText('312')).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument(); // no filter wired: only a picture
  await expectNoA11yViolations(container);
});

function Filtering() {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <>
      <BarBreakdown title="By custodian" bars={BARS} selectedKey={selected} onSelect={setSelected} />
      <p data-testid="chosen">{selected ?? 'none'}</p>
    </>
  );
}

test('choosing a bar filters by it, and choosing it again clears the filter', async () => {
  const { container } = render(<Filtering />);
  const alex = screen.getByRole('button', { name: /Alex Wilber/ });
  expect(alex).toHaveAttribute('aria-pressed', 'false');
  await userEvent.click(alex);
  expect(screen.getByTestId('chosen')).toHaveTextContent('alex');
  expect(alex).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: /Megan Bowen/ })).toHaveAttribute('aria-pressed', 'false');
  await userEvent.click(screen.getByRole('button', { name: /Megan Bowen/ }));
  expect(screen.getByTestId('chosen')).toHaveTextContent('megan'); // choosing another moves the filter
  await userEvent.click(screen.getByRole('button', { name: /Megan Bowen/ }));
  expect(screen.getByTestId('chosen')).toHaveTextContent('none');
  await expectNoA11yViolations(container);
});

test('a breakdown with no bars says so, and a long label keeps its full text for hovering', () => {
  const { rerender } = render(<BarBreakdown title="By label" bars={[]} />);
  expect(screen.getByText('Nothing to show.')).toBeInTheDocument();
  rerender(<BarBreakdown title="By label" bars={[{ key: 'x', label: 'Confidential/Finance/Quarterly', count: 3 }]} />);
  expect(screen.getByText('Confidential/Finance/Quarterly')).toHaveAttribute('title', 'Confidential/Finance/Quarterly');
});

test('with every count zero no bar has a length, and nothing divides by zero', () => {
  render(<BarBreakdown title="By type" bars={[{ key: 'a', label: 'Email', count: 0 }]} onSelect={() => {}} />);
  expect(widthOf(/Email/)).toBe('0%');
});

// -- the month chart ---------------------------------------------------------------------------------------------
const MONTHS = [
  { month: '2024-11', count: 10 },
  { month: '2024-12', count: 40 },
  { month: '2025-01', count: 5 },
  { month: '2025-02', count: 40 },
];

test('the chart is a picture with a sentence for a screen reader: the span, the lowest and the highest month', () => {
  expect(describeMonths(MONTHS)).toBe('Items per month, November 2024 to February 2025. Lowest 5 in January 2025, highest 40 in December 2024.');
  expect(describeMonths([])).toBe('No months to show.');
  render(<MonthChart title="By month" months={MONTHS} />);
  expect(screen.getByRole('img', { name: describeMonths(MONTHS) })).toBeInTheDocument();
});

test('the same numbers are there as a table for a screen reader', () => {
  render(<MonthChart title="By month" months={MONTHS} />);
  const table = screen.getByRole('table', { name: 'By month' });
  expect(within(table).getAllByRole('row').slice(1).map((r) => r.textContent)).toEqual(['November 202410', 'December 202440', 'January 20255', 'February 202540']);
  expect(table).toHaveClass('st-visually-hidden');
});

test('bars are scaled to the busiest month, and the busiest months are the black ones', () => {
  const { container } = render(<MonthChart title="By month" months={MONTHS} />);
  const bars = [...container.querySelectorAll<HTMLElement>('[style*="height"]')].filter((el) => el.className.includes('bar'));
  expect(bars.map((b) => b.style.height)).toEqual(['33px', '130px', '16px', '130px']); // 10/40, 40/40, 5/40, 40/40 of 130px
  expect(bars.map((b) => b.hasAttribute('data-peak'))).toEqual([false, true, false, true]);
});

test('the axis names each month, and the year under the first month and under each January', () => {
  const { container } = render(<MonthChart title="By month" months={MONTHS} />);
  const ticks = [...container.querySelectorAll('[aria-hidden="true"] > span')].map((t) => t.textContent!.trim());
  expect(ticks).toEqual(['Nov2024', 'Dec', 'Jan2025', 'Feb']);
});

test('the heading level, the note beside it, and a chart with nothing in it', async () => {
  const { container, rerender } = render(<MonthChart title="By month" months={MONTHS} note="Nov 2024 to Feb 2025" headingLevel={3} />);
  expect(screen.getByRole('heading', { level: 3, name: 'By month' })).toBeInTheDocument();
  expect(screen.getByText('Nov 2024 to Feb 2025')).toBeInTheDocument();
  await expectNoA11yViolations(container);
  rerender(<MonthChart title="By month" months={[]} />);
  expect(screen.getByText('No dated items to chart.')).toBeInTheDocument();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
});

test('months with no items are bars of no height, and an all-zero chart has no peak', () => {
  const { container } = render(<MonthChart title="By month" months={[{ month: '2025-01', count: 0 }, { month: '2025-02', count: 0 }]} />);
  expect(container.querySelectorAll('[data-peak]')).toHaveLength(0);
});

// -- the methodology card ----------------------------------------------------------------------------------------
const TERMS = ['"project falcon"', 'invoic*', 'kickback', '"side letter"'];
const TERMS_LINE = 'Containing ANY of these terms: "project falcon", invoic*, kickback, "side letter".';

test('markTerms marks each search term in the line that lists them, and nothing else', () => {
  const pieces = markTerms(TERMS_LINE, TERMS);
  expect(pieces.filter((p) => p.term).map((p) => p.text)).toEqual(TERMS);
  expect(pieces.map((p) => p.text).join('')).toBe(TERMS_LINE); // nothing lost or repeated
  // The same word in an exclusion is not marked: only the line that lists the terms is.
  expect(markTerms('Excluding items containing any of: kickback.', TERMS)).toEqual([{ text: 'Excluding items containing any of: kickback.', term: false }]);
});

test('markTerms copes with wildcards, an ALL line, overlapping terms and no terms', () => {
  expect(markTerms('Containing ALL of these terms: invoic*, invoice.', ['invoic*', 'invoice']).filter((p) => p.term).map((p) => p.text)).toEqual(['invoic*', 'invoice']);
  // The longer term wins where one is part of the other, whichever order they are given in.
  for (const terms of [['kick', 'kickback'], ['kickback', 'kick']]) {
    expect(markTerms('Containing ANY of these terms: kickback.', terms).filter((p) => p.term).map((p) => p.text)).toEqual(['kickback']);
  }
  expect(markTerms(TERMS_LINE, [])).toEqual([{ text: TERMS_LINE, term: false }]);
  expect(markTerms(TERMS_LINE, [''])).toEqual([{ text: TERMS_LINE, term: false }]);
  // A character that means something in a pattern is only itself.
  expect(markTerms('Containing ANY of these terms: a.b, axb.', ['a.b']).filter((p) => p.term).map((p) => p.text)).toEqual(['a.b']);
});

test('the card lists each statement, marks the terms in yellow, and keeps the line numbers out of the reading', async () => {
  const { container } = render(<MethodologyCard lines={['Item types: emails.', TERMS_LINE]} terms={TERMS} />);
  expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Item types: emails.', TERMS_LINE]);
  expect([...container.querySelectorAll('mark')].map((m) => m.textContent)).toEqual(TERMS);
  expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull(); // the rules and the numbers
  expect(screen.queryByText('CULLING METHODOLOGY')).not.toBeInTheDocument();
  await expectNoA11yViolations(container);
});

test('with a title page it names the matter and the query version', () => {
  render(<MethodologyCard lines={['Item types: emails.']} heading={{ matter: 'M-2026-0142', version: 'Query v3' }} />);
  expect(screen.getByText('CULLING METHODOLOGY')).toBeInTheDocument();
  expect(screen.getByText('Matter M-2026-0142 · Query v3')).toBeInTheDocument();
});

// -- banners, errors and empty states ----------------------------------------------------------------------------
test('a notice is announced politely, with a bold lead and an action', async () => {
  const onClick = vi.fn();
  const { container } = render(
    <Banner title="You changed the query." actions={<button onClick={onClick}>Estimate v4</button>}>
      These counts are still for v3.
    </Banner>,
  );
  const notice = screen.getByRole('status');
  expect(notice).toHaveAttribute('data-tone', 'notice');
  expect(within(notice).getByText('You changed the query.').tagName).toBe('STRONG');
  await userEvent.click(within(notice).getByRole('button', { name: 'Estimate v4' }));
  expect(onClick).toHaveBeenCalledTimes(1);
  await expectNoA11yViolations(container);
});

test('a warning is an alert, and the role can be changed', () => {
  const { rerender } = render(<Banner tone="warning">You are leaving out 25 items.</Banner>);
  expect(screen.getByRole('alert')).toHaveAttribute('data-tone', 'warning');
  rerender(<Banner tone="warning" role="status">You are leaving out 25 items.</Banner>);
  expect(screen.getByRole('status')).toBeInTheDocument();
});

test('an inline error is announced as it appears', () => {
  render(<InlineError>Enter a term or a phrase.</InlineError>);
  expect(screen.getByRole('alert')).toHaveTextContent('Enter a term or a phrase.');
});

test('an empty state says what is missing, with a title and a way out when it has them', async () => {
  const { container, rerender } = render(<EmptyState>No matters match. Clear the search or choose All.</EmptyState>);
  expect(screen.getByText('No matters match. Clear the search or choose All.')).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  rerender(
    <EmptyState title="No matters yet" action={<button>New matter</button>}>
      A matter is a Purview case.
    </EmptyState>,
  );
  expect(screen.getByText('No matters yet')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'New matter' })).toBeInTheDocument();
  await expectNoA11yViolations(container);
});
