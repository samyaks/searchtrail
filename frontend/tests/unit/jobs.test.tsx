import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { act, type ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { isFinished, pollDelay, useJob, useMatterJobs, useTrackedJob } from '@/api/jobs';
import { makeQueryClient } from '@/app/queryClient';
import { server } from '@/mocks/server';
import { setScenario } from '@/mocks/scenarios';
import { FALCON, get, post, tick } from './mocks/api';

const M = `/matters/${FALCON}`;
const fast = { pollMs: () => 10 }; // poll every 10 ms; the job itself follows the mock clock, which tick() moves

function setup() {
  const client = makeQueryClient();
  client.setDefaultOptions({ queries: { retry: false } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
}

const startPreview = async () => (await post(`${M}/previews`)).json as { id: string };

test('a job is followed from queued to its typed result, and then no longer asked about', async () => {
  const { wrapper } = setup();
  const job = await startPreview();
  let asked = 0;
  server.events.on('request:start', ({ request }) => request.url.endsWith(`/jobs/${job.id}`) && (asked += 1));
  const { result } = renderHook(() => useJob<'preview'>(job.id, fast), { wrapper });

  expect(result.current.isRunning).toBe(true); // before the first answer
  await waitFor(() => expect(result.current.job?.status).toBe('queued'));
  expect(result.current.progress).toBe(0);

  tick(4.5); // half of the 9 seconds a mock job takes
  await waitFor(() => expect(result.current.job?.status).toBe('running'));
  expect(result.current.progress).toBeCloseTo(0.5, 1);
  expect(result.current.result).toBeNull();

  tick(10);
  await waitFor(() => expect(result.current.isSucceeded).toBe(true));
  expect(result.current.isRunning).toBe(false);
  expect(result.current.progress).toBe(1);
  expect(result.current.result?.version).toBeGreaterThan(0); // a Preview: typed by the job's kind
  expect(result.current.failure).toBeNull();

  const answers = asked;
  await new Promise((resolve) => setTimeout(resolve, 80));
  expect(asked).toBe(answers); // done: it stopped asking
});

test('a failed job says why, with the contract\'s error, and stops', async () => {
  setScenario({ failJobs: ['preview'] });
  const { wrapper } = setup();
  const job = await startPreview();
  const { result } = renderHook(() => useJob<'preview'>(job.id, fast), { wrapper });
  tick(10);
  await waitFor(() => expect(result.current.isFailed).toBe(true));
  expect(result.current.isRunning).toBe(false);
  expect(result.current.result).toBeNull();
  expect(result.current.failure?.code).toBe('purview_operation_failed');
  expect(result.current.failure?.message).not.toBe('');
});

test('nothing is asked while there is no job yet', async () => {
  const { wrapper } = setup();
  let asked = 0;
  server.events.on('request:start', () => (asked += 1));
  const { result } = renderHook(() => useJob(null, fast), { wrapper });
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(asked).toBe(0);
  expect(result.current.isRunning).toBe(false);
  expect(result.current.job).toBeUndefined();
});

test("when a job ends, what it may have changed is refreshed once: the matter, the Matters list, previews, exports", async () => {
  const { client, wrapper } = setup();
  const invalidated = vi.spyOn(client, 'invalidateQueries');
  const job = await startPreview();
  const { result } = renderHook(() => useJob(job.id, fast), { wrapper });
  await waitFor(() => expect(result.current.job).toBeDefined());
  expect(invalidated).not.toHaveBeenCalled(); // not while it runs

  tick(10);
  await waitFor(() => expect(result.current.isSucceeded).toBe(true));
  expect(invalidated.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([['matters'], ['previews'], ['exports']]);

  // The finished job is asked about again, and its data has changed (a later timestamp): still only once.
  const finished = result.current.job!;
  server.use(http.get('/api/v1/jobs/:jobId', () => HttpResponse.json({ ...finished, updated_at: '2030-01-01T00:00:00Z' })));
  await act(async () => {
    await result.current.refetch();
  });
  await waitFor(() => expect(result.current.job?.updated_at).toBe('2030-01-01T00:00:00Z'));
  expect(invalidated).toHaveBeenCalledTimes(3);
});

test('a failed request for the job is a query error, not a failed job', async () => {
  server.use(http.get('/api/v1/jobs/:jobId', () => HttpResponse.json({ code: 'not_found', message: 'No job.', details: {} }, { status: 404 })));
  const { wrapper } = setup();
  const { result } = renderHook(() => useJob('job_gone', fast), { wrapper });
  await waitFor(() => expect(result.current.queryError).toBeTruthy());
  expect(result.current.isFailed).toBe(false);
  expect(result.current.isRunning).toBe(false);
});

test('once the server says no about a job, it is no longer asked about', async () => {
  let asked = 0;
  server.use(
    http.get('/api/v1/jobs/:jobId', () => {
      asked += 1;
      return HttpResponse.json({ code: 'not_found', message: 'No job.', details: {} }, { status: 404 });
    }),
  );
  const { wrapper } = setup();
  const { result } = renderHook(() => useJob('job_gone', fast), { wrapper });
  await waitFor(() => expect(result.current.queryError).toBeTruthy());
  await new Promise((resolve) => setTimeout(resolve, 30)); // let any request already on its way finish
  const askedBefore = asked;
  await new Promise((resolve) => setTimeout(resolve, 100)); // ten polls' worth
  expect(asked).toBe(askedBefore);
  expect(result.current.isRunning).toBe(false);
});

test('a passing server error keeps the job running and asked about', async () => {
  let asked = 0;
  server.use(
    http.get('/api/v1/jobs/:jobId', () => {
      asked += 1;
      return HttpResponse.json({ code: 'internal_error', message: 'Down.', details: {} }, { status: 500 });
    }),
  );
  const { wrapper } = setup();
  const { result } = renderHook(() => useJob('job_busy', fast), { wrapper });
  await waitFor(() => expect(asked).toBeGreaterThan(2));
  expect(result.current.isRunning).toBe(true);
});

test("jobs already running are found when a screen opens, with the matter's other jobs left out", async () => {
  const { wrapper } = setup();
  const running = await startPreview();
  const { result } = renderHook(() => useMatterJobs(FALCON, { active: true }, fast), { wrapper });
  await waitFor(() => expect(result.current.data?.items.map((j) => j.id)).toEqual([running.id]));
  tick(10); // it finishes: the list notices on its next poll and stops asking
  await waitFor(() => expect(result.current.data?.items).toEqual([]));
});

test('a screen picks up a job that was already running, with no tracking from the screen (a reload, or another tab)', async () => {
  const { wrapper } = setup();
  const running = await startPreview();
  tick(3);
  const { result } = renderHook(() => useTrackedJob(FALCON, 'preview', fast), { wrapper });
  await waitFor(() => expect(result.current.jobId).toBe(running.id));
  await waitFor(() => expect(result.current.isRunning).toBe(true));
  expect(result.current.progress).toBeCloseTo(0.33, 1);
  tick(10);
  await waitFor(() => expect(result.current.isSucceeded).toBe(true));
  expect(result.current.jobId).toBe(running.id); // it keeps showing the finished job, and its result
  expect(result.current.result).not.toBeNull();
});

test('only a job of the kind the screen shows is picked up', async () => {
  const { wrapper } = setup();
  await startPreview();
  const { result } = renderHook(() => useTrackedJob(FALCON, 'term_report', fast), { wrapper });
  await new Promise((resolve) => setTimeout(resolve, 80));
  expect(result.current.jobId).toBeNull();
  expect(result.current.isRunning).toBe(false);
});

test('a job the screen starts is tracked at once, and the next one replaces it', async () => {
  const { wrapper } = setup();
  const first = await startPreview();
  const { result } = renderHook(() => useTrackedJob(FALCON, 'preview', fast), { wrapper });
  await waitFor(() => expect(result.current.jobId).toBe(first.id));
  tick(10);
  await waitFor(() => expect(result.current.isSucceeded).toBe(true));

  const second = await startPreview(); // a new run, started from this screen
  act(() => result.current.track(second.id));
  await waitFor(() => expect(result.current.jobId).toBe(second.id));
  await waitFor(() => expect(result.current.job?.id).toBe(second.id));
  expect(result.current.isSucceeded).toBe(false);
});

test('the wait between polls: every 3 seconds at first, then less often, never over 10', () => {
  expect([0, 5, 9].map(pollDelay)).toEqual([3000, 3000, 3000]);
  expect([10, 15, 19].map(pollDelay)).toEqual([5000, 5000, 5000]);
  expect([20, 100, 10_000].map(pollDelay)).toEqual([10_000, 10_000, 10_000]);
  expect(isFinished({ status: 'running' })).toBe(false);
  expect(isFinished({ status: 'succeeded' })).toBe(true);
  expect(isFinished({ status: 'failed' })).toBe(true);
});

test('the job list asks the same API as the matter screens do', async () => {
  expect((await get(`${M}/jobs`, { active: true })).status).toBe(200);
});
