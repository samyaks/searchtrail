import { handlers } from '@/mocks/handlers';
import { operations } from '../contract';

/** The handler's method and path as "GET /api/v1/matters/:matterId". */
const handled = handlers.map((h) => (h.info as { header: string }).header);

/** The contract's operation as MSW writes it: {matterId} becomes :matterId and the prefix is added. */
const mswKey = ({ method, path }: { method: string; path: string }) => `${method} /api/v1${path.replace(/\{(\w+)\}/g, ':$1')}`;

test('every operation in the contract has a handler', () => {
  const missing = Object.entries(operations)
    .filter(([, op]) => !handled.includes(mswKey(op)))
    .map(([operationId, op]) => `${operationId} (${op.method} ${op.path})`);
  expect(missing).toEqual([]);
});

test('every handler is an operation in the contract', () => {
  const known = Object.values(operations).map(mswKey);
  expect(handled.filter((h) => !known.includes(h))).toEqual([]);
  expect(handled).toHaveLength(Object.keys(operations).length);
});
