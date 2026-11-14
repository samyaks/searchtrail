import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChipList, FilterChip, Pill, RemovableChip } from '@/components';
import { expectNoA11yViolations } from '../a11y';

test('a filter chip is a toggle: it says whether it is on, and its count', async () => {
  const onClick = vi.fn();
  render(
    <FilterChip pressed={false} count={3} onClick={onClick}>
      Previewed
    </FilterChip>,
  );
  const chip = screen.getByRole('button', { name: 'Previewed 3' });
  expect(chip).toHaveAttribute('aria-pressed', 'false');
  await userEvent.click(chip);
  expect(onClick).toHaveBeenCalledTimes(1);
});

test('a pressed filter chip says so', () => {
  render(<FilterChip pressed>All</FilterChip>);
  expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
});

test('a pill carries its meaning in text, whatever its tone', () => {
  render(
    <>
      <Pill>Scoping</Pill>
      <Pill tone="highlight">Previewed</Pill>
      <Pill tone="ink">Exporting 64%</Pill>
      <Pill tone="ok">Exported</Pill>
      <Pill tone="danger">Blocked</Pill>
    </>,
  );
  for (const text of ['Scoping', 'Previewed', 'Exporting 64%', 'Exported', 'Blocked']) {
    expect(screen.getByText(text)).toBeVisible();
  }
});

test('removable chips are a labelled list, each with a named remove button', async () => {
  const onRemove = vi.fn();
  render(
    <ChipList label="Search terms">
      <RemovableChip tone="term" removeLabel="Remove invoic*" onRemove={onRemove}>
        invoic*
      </RemovableChip>
      <RemovableChip tone="term" removeLabel="Remove kickback" onRemove={() => {}}>
        kickback
      </RemovableChip>
    </ChipList>,
  );
  const list = screen.getByRole('list', { name: 'Search terms' });
  expect(within(list).getAllByRole('listitem')).toHaveLength(2);
  await userEvent.click(within(list).getByRole('button', { name: 'Remove invoic*' }));
  expect(onRemove).toHaveBeenCalledTimes(1);
});

test('a chip can be removed from the keyboard', async () => {
  const onRemove = vi.fn();
  render(
    <ChipList label="File types">
      <RemovableChip removeLabel="Remove pdf" onRemove={onRemove}>
        pdf
      </RemovableChip>
    </ChipList>,
  );
  await userEvent.tab();
  expect(screen.getByRole('button', { name: 'Remove pdf' })).toHaveFocus();
  await userEvent.keyboard('{Enter}');
  expect(onRemove).toHaveBeenCalledTimes(1);
});

test('has no accessibility violations in any tone', async () => {
  const { container } = render(
    <>
      <FilterChip pressed>All</FilterChip>
      <FilterChip pressed={false} count={2}>
        Scoping
      </FilterChip>
      <Pill tone="ok">Exported</Pill>
      <ChipList label="Search terms">
        <RemovableChip tone="term" removeLabel="Remove a" onRemove={() => {}}>
          a
        </RemovableChip>
      </ChipList>
      <ChipList label="Exclusions">
        <RemovableChip tone="exclude" removeLabel="Stop excluding weekly digest" onRemove={() => {}}>
          weekly digest
        </RemovableChip>
      </ChipList>
      <ChipList label="File types">
        <RemovableChip removeLabel="Remove docx" onRemove={() => {}}>
          docx
        </RemovableChip>
      </ChipList>
    </>,
  );
  await expectNoA11yViolations(container);
});
