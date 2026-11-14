import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { SegmentedControl } from '@/components';
import { expectNoA11yViolations } from '../a11y';

const MODES = [
  { value: 'any', label: 'Any term' },
  { value: 'all', label: 'All terms' },
] as const;

function Harness({ onChange }: { onChange?: (value: string) => void }) {
  const [value, setValue] = useState<'any' | 'all'>('any');
  return (
    <SegmentedControl
      label="Match"
      options={MODES}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

test('is a named group of toggle buttons with exactly one pressed', () => {
  render(<Harness />);
  const group = screen.getByRole('group', { name: 'Match' });
  expect(group).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Any term' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: 'All terms' })).toHaveAttribute('aria-pressed', 'false');
});

test('choosing a segment reports it and moves the pressed state', async () => {
  const onChange = vi.fn();
  render(<Harness onChange={onChange} />);
  await userEvent.click(screen.getByRole('button', { name: 'All terms' }));
  expect(onChange).toHaveBeenCalledWith('all');
  expect(screen.getByRole('button', { name: 'All terms' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: 'Any term' })).toHaveAttribute('aria-pressed', 'false');
});

test('every segment is reachable with Tab and chosen with Space', async () => {
  const onChange = vi.fn();
  render(<Harness onChange={onChange} />);
  await userEvent.tab();
  await userEvent.tab();
  expect(screen.getByRole('button', { name: 'All terms' })).toHaveFocus();
  await userEvent.keyboard(' ');
  expect(onChange).toHaveBeenCalledWith('all');
});

test('a disabled segment cannot be chosen', async () => {
  const onChange = vi.fn();
  render(
    <SegmentedControl
      label="Label"
      value="any"
      onChange={onChange}
      options={[
        { value: 'only', label: 'Only', tone: 'only' },
        { value: 'any', label: 'Any' },
        { value: 'exclude', label: 'Exclude', tone: 'exclude', disabled: true },
      ]}
    />,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Exclude' }));
  expect(onChange).not.toHaveBeenCalled();
});

test('has no accessibility violations with a tone on each side', async () => {
  const { container } = render(
    <SegmentedControl
      label="Sensitivity label Confidential"
      value="exclude"
      onChange={() => {}}
      options={[
        { value: 'only', label: 'Only', tone: 'only' },
        { value: 'any', label: 'Any' },
        { value: 'exclude', label: 'Exclude', tone: 'exclude' },
      ]}
    />,
  );
  await expectNoA11yViolations(container);
});
