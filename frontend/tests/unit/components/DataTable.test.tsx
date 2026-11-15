import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

// jsdom has no layout, so these tests stand in for the browser's measurements and its ResizeObserver.
function measure(widths: { scroll: number; client: number }) {
  const sizes = { ...widths };
  const scroll = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(() => sizes.scroll);
  const client = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => sizes.client);
  let notify: () => void = () => {};
  class FakeResizeObserver {
    constructor(callback: () => void) {
      notify = callback;
    }
    observe() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  return {
    sizes,
    resize: () => act(() => notify()),
    restore: () => {
      scroll.mockRestore();
      client.mockRestore();
      vi.unstubAllGlobals();
    },
  };
}

test('a table that fits has no extra Tab stop and no landmark of its own', async () => {
  const stub = measure({ scroll: 300, client: 300 });
  try {
    renderTable();
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    await userEvent.tab();
    expect(screen.getAllByRole('button', { name: 'Open' })[0]).toHaveFocus(); // straight to the first thing inside
    expect(document.querySelector('[tabindex="0"]')).toBeNull();
    expect(screen.getByRole('table', { name: 'Matters' })).toBeInTheDocument();
  } finally {
    stub.restore();
  }
});

test('a table that scrolls sideways becomes a named region that the keyboard can reach', async () => {
  const stub = measure({ scroll: 900, client: 400 });
  try {
    renderTable();
    const region = screen.getByRole('region', { name: 'Matters, scrolls sideways' });
    expect(region).toHaveAttribute('tabindex', '0');
    await userEvent.tab();
    expect(region).toHaveFocus(); // first, so the arrow keys scroll it
    expect(screen.getByRole('table', { name: 'Matters' })).toBeInTheDocument();
    await expectNoA11yViolations(region);
  } finally {
    stub.restore();
  }
});

test('it follows the width: a table that stops fitting becomes a region, and back', async () => {
  const stub = measure({ scroll: 300, client: 300 });
  try {
    renderTable();
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    stub.sizes.scroll = 900; // the window got narrower
    stub.resize();
    expect(screen.getByRole('region', { name: 'Matters, scrolls sideways' })).toBeInTheDocument();
    stub.sizes.scroll = 300; // and wider again
    stub.resize();
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  } finally {
    stub.restore();
  }
});

test('has no accessibility violations, filled or empty', async () => {
  const { container } = renderTable({ selectedKey: 'a' });
  await expectNoA11yViolations(container);
  const empty = renderTable({ rows: [] });
  await expectNoA11yViolations(empty.container);
});
