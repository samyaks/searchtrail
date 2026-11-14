import examples from '@/mocks/examples.json';
import { operations, requestProblems, responseProblems, statusesOf } from './contract';

type ExampleFile = Record<string, { examples: Record<string, Record<string, unknown>> }>;

test('finds all 39 operations of the contract', () => {
  expect(Object.keys(operations)).toHaveLength(39);
  expect(statusesOf('getMatter')).toEqual([200, 401, 404]);
});

test('every JSON example in the contract conforms to its own schema (so the validator can be trusted)', () => {
  let checked = 0;
  for (const [operationId, entry] of Object.entries(examples as ExampleFile)) {
    for (const [status, byName] of Object.entries(entry.examples)) {
      if (status === 'request') continue;
      for (const [name, value] of Object.entries(byName)) {
        if (typeof value === 'string') continue; // a CSV example
        expect(responseProblems(operationId, Number(status), value), `${operationId} ${status} ${name}`).toEqual([]);
        checked += 1;
      }
    }
  }
  expect(checked).toBeGreaterThan(80);
});

test('request examples conform too', () => {
  for (const [operationId, entry] of Object.entries(examples as ExampleFile)) {
    for (const [name, value] of Object.entries(entry.examples.request ?? {})) {
      expect(requestProblems(operationId, value), `${operationId} ${name}`).toEqual([]);
    }
  }
});

test('catches a response that breaks the contract', () => {
  const matter = (examples as ExampleFile).getMatter!.examples['200']!.falcon as Record<string, unknown>;
  expect(responseProblems('getMatter', 200, { ...matter, stage: 'done' }).join()).toContain('allowed values');
  expect(responseProblems('getMatter', 200, { ...matter, matter_number: undefined }).join()).toContain('matter_number');
  expect(responseProblems('getMatter', 200, { ...matter, created_at: 'yesterday' }).join()).toContain('format');
  expect(responseProblems('getMatter', 200, matter)).toEqual([]);
  expect(responseProblems('getMatter', 418, {})[0]).toContain('no 418 response');
});
