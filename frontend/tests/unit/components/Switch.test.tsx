import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { Switch } from '@/components';
import { expectNoA11yViolations } from '../a11y';

function Harness({ initial = false, onChange }: { initial?: boolean; onChange?: (checked: boolean) => void }) {
  const [checked, setChecked] = useState(initial);
  return (
    <Switch
      label="Place on hold"
      checked={checked}
      onChange={(next) => {
        setChecked(next);
        onChange?.(next);
      }}
    />
  );
}

test('is a switch, named by its label, announced as off or on', async () => {
  render(<Harness />);
  const toggle = screen.getByRole('switch', { name: 'Place on hold' });
  expect(toggle).toHaveAttribute('aria-checked', 'false');
  await userEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-checked', 'true');
});

test('reports the new value, from the mouse and from the keyboard', async () => {
  const onChange = vi.fn();
  render(<Harness onChange={onChange} />);
  await userEvent.click(screen.getByRole('switch'));
  await userEvent.tab(); // focus leaves, then comes back round
  await userEvent.tab({ shift: true });
  expect(screen.getByRole('switch')).toHaveFocus();
  await userEvent.keyboard(' ');
  await userEvent.keyboard('{Enter}');
  expect(onChange.mock.calls.map(([checked]) => checked)).toEqual([true, false, true]);
});

test('the label can be hidden and is still the accessible name', () => {
  render(<Switch label="Mailbox" hideLabel checked onChange={() => {}} />);
  expect(screen.getByRole('switch', { name: 'Mailbox' })).toHaveAttribute('aria-checked', 'true');
});

test('a disabled switch does not change', async () => {
  const onChange = vi.fn();
  render(<Switch label="Hold" checked={false} disabled onChange={onChange} />);
  await userEvent.click(screen.getByRole('switch'));
  expect(onChange).not.toHaveBeenCalled();
});

test('has no accessibility violations on, off, disabled or with a hidden label', async () => {
  const { container } = render(
    <>
      <Switch label="Mailbox and Teams chats" checked onChange={() => {}} />
      <Switch label="OneDrive" checked={false} onChange={() => {}} />
      <Switch label="Hold" checked={false} disabled onChange={() => {}} />
      <Switch label="Include partially indexed items" hideLabel checked onChange={() => {}} />
    </>,
  );
  await expectNoA11yViolations(container);
});
