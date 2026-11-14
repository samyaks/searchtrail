import { render, screen, within } from '@testing-library/react';
import { DataTable, type Column } from '@/components';
import { expectNoA11yViolations } from '../a11y';

type Row = { id: string; name: string; custodians: number; stage: string };
const ROWS: Row[] = [
  { id: 'a', name: 'Project Falcon investigation', custodians: 2, stage: 'Previewed' },
  { id: 'b', name: 'Harlow v. Contoso', custodians: 5, stage: 'Scoping' },
];
const COLUMNS: Column<Row>[] = [
  { key: 'name', header: 'Matter', cell: (r) => r.name, rowHeader: true },
  { key: 'stage', header: 'Stage', cell: (r) => r.stage },
  { key: 'custodians', header: 'Custodians', cell: (r) => r.custodians, numeric: true },
  { key: 'actions', header: 'Actions', cell: () => <button type="button">Open</button>, hideHeader: true },
];

function renderTable(props: Partial<Parameters<typeof DataTable<Row>>[0]> = {}) {
  return render(<DataTable caption="Matters" columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} {...props} />);
}

test('is a table named by its caption, with a column header for each column', () => {
  renderTable();
  const table = screen.getByRole('table', { name: 'Matters' });
  expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Matter', 'Stage', 'Custodians', 'Actions']);
  expect(within(table).getAllByRole('row')).toHaveLength(3);
});

test('the name column holds row headers, so a cell is announced with its row', () => {
  renderTable();
  expect(screen.getByRole('rowheader', { name: 'Project Falcon investigation' })).toBeInTheDocument();
  const row = screen.getByRole('row', { name: /Harlow/ });
  expect(within(row).getByRole('cell', { name: 'Scoping' })).toBeInTheDocument();
});

test('a column of buttons keeps its header for screen readers only', () => {
  renderTable();
  expect(screen.getByRole('columnheader', { name: 'Actions' })).toBeInTheDocument();
  expect(within(screen.getByRole('columnheader', { name: 'Actions' })).getByText('Actions')).toHaveClass('st-visually-hidden');
});

test('numbers are marked so they line up', () => {
  renderTable();
  expect(screen.getByRole('cell', { name: '5' })).toHaveAttribute('data-numeric', 'true');
});

test('the selected row is marked for everyone, not only by colour', () => {
  renderTable({ selectedKey: 'b' });
  expect(screen.getByRole('row', { name: /Harlow/ })).toHaveAttribute('aria-current', 'true');
  expect(screen.getByRole('row', { name: /Falcon/ })).not.toHaveAttribute('aria-current');
});

test('with no rows it says so', () => {
  renderTable({ rows: [], emptyMessage: 'No matters match.' });
  expect(screen.getByRole('cell', { name: 'No matters match.' })).toHaveAttribute('colspan', '4');
});

test('the scrolling region can be reached with the keyboard', () => {
  renderTable();
  expect(screen.getByRole('region', { name: 'Matters' })).toHaveAttribute('tabindex', '0');
});

test('has no accessibility violations, filled or empty', async () => {
  const { container } = renderTable({ selectedKey: 'a' });
  await expectNoA11yViolations(container);
  const empty = renderTable({ rows: [] });
  await expectNoA11yViolations(empty.container);
});
