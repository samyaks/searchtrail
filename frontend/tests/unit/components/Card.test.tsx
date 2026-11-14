import { render, screen } from '@testing-library/react';
import { Button, Card } from '@/components';
import { expectNoA11yViolations } from '../a11y';

test('a card with a title is a region named by that heading', () => {
  render(<Card title="Counts">630 items</Card>);
  const card = screen.getByRole('region', { name: 'Counts' });
  expect(card).toHaveTextContent('630 items');
  expect(screen.getByRole('heading', { level: 2, name: 'Counts' })).toBeInTheDocument();
});

test('the heading level follows the page', () => {
  render(<Card title="Sources" headingLevel={3}>x</Card>);
  expect(screen.getByRole('heading', { level: 3, name: 'Sources' })).toBeInTheDocument();
});

test('actions sit beside the title', () => {
  render(
    <Card title="Custodians" actions={<Button size="sm">Add custodian</Button>}>
      x
    </Card>,
  );
  expect(screen.getByRole('button', { name: 'Add custodian' })).toBeInTheDocument();
});

test('a card without a title is just a container, not a region', () => {
  render(<Card as="div">hello</Card>);
  expect(screen.queryByRole('region')).not.toBeInTheDocument();
  expect(screen.getByText('hello')).toBeInTheDocument();
});

test('has no accessibility violations', async () => {
  const { container } = render(
    <>
      <Card title="Counts">x</Card>
      <Card title="Items" padding="none" headingLevel={3} actions={<Button size="sm">Download CSV</Button>}>
        x
      </Card>
      <Card as="article" padding="lg">
        y
      </Card>
    </>,
  );
  await expectNoA11yViolations(container);
});
