import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { Button, ButtonLink, IconButton } from '@/components';
import { expectNoA11yViolations } from '../a11y';

test('a button is a button, and does not submit a form by default', async () => {
  const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
  const onClick = vi.fn();
  render(
    <form onSubmit={onSubmit}>
      <Button onClick={onClick}>Save</Button>
    </form>,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(onClick).toHaveBeenCalledTimes(1);
  expect(onSubmit).not.toHaveBeenCalled();
});

test('type="submit" still submits', async () => {
  const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
  render(
    <form onSubmit={onSubmit}>
      <Button type="submit">Create</Button>
    </form>,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Create' }));
  expect(onSubmit).toHaveBeenCalledTimes(1);
});

test('works from the keyboard and not when disabled', async () => {
  const onClick = vi.fn();
  render(
    <>
      <Button onClick={onClick}>Estimate</Button>
      <Button onClick={onClick} disabled>
        Export
      </Button>
    </>,
  );
  await userEvent.tab();
  expect(screen.getByRole('button', { name: 'Estimate' })).toHaveFocus();
  await userEvent.keyboard('{Enter}');
  await userEvent.keyboard(' ');
  expect(onClick).toHaveBeenCalledTimes(2);
  await userEvent.click(screen.getByRole('button', { name: 'Export' }));
  expect(onClick).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();
});

test('an icon is decoration: the label is the name', () => {
  render(<Button icon={<svg data-testid="icon" />}>Download CSV</Button>);
  expect(screen.getByRole('button', { name: 'Download CSV' })).toBeInTheDocument();
  expect(screen.getByTestId('icon').closest('[aria-hidden="true"]')).not.toBeNull();
});

test('a link that looks like a button is a link, with a real href', async () => {
  render(
    <MemoryRouter>
      <ButtonLink to="/matters/mat_falcon/preview" variant="primary">
        Preview
      </ButtonLink>
    </MemoryRouter>,
  );
  expect(screen.getByRole('link', { name: 'Preview' })).toHaveAttribute('href', '/matters/mat_falcon/preview');
});

test('an icon button is named by its label', async () => {
  const onClick = vi.fn();
  render(
    <IconButton label="Remove Alex Wilber" onClick={onClick}>
      <svg />
    </IconButton>,
  );
  const button = screen.getByRole('button', { name: 'Remove Alex Wilber' });
  expect(button).toHaveAttribute('title', 'Remove Alex Wilber');
  await userEvent.click(button);
  expect(onClick).toHaveBeenCalledTimes(1);
});

test('has no accessibility violations in any variant or size', async () => {
  const { container } = render(
    <MemoryRouter>
      <Button variant="primary">Primary</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="neutral" size="sm">
        Neutral
      </Button>
      <Button variant="highlight">Highlight</Button>
      <Button variant="danger" disabled>
        Danger
      </Button>
      <ButtonLink to="/matters">Link</ButtonLink>
      <IconButton label="Close">
        <svg />
      </IconButton>
    </MemoryRouter>,
  );
  await expectNoA11yViolations(container);
});
