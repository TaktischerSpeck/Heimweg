import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/auto-merge.yml', import.meta.url), 'utf8');
const source = workflow.split('          script: |\n')[1].split('\n')
  .map(line => line.replace(/^            /, '')).join('\n');
const execute = new (Object.getPrototypeOf(async function () {}).constructor)(
  'github', 'context', 'core', source,
);

async function run(change = {}) {
  const pr = {
    number: 12, state: 'open', draft: false, base: { ref: 'main' },
    head: { sha: 'tested-head', repo: { full_name: 'TaktischerSpeck/Heimweg' } },
    user: { login: 'TaktischerSpeck' }, mergeable: true, ...change.pr,
  };
  const jobs = ['test', 'mariadb (10.11)', 'mariadb (11.4)'].map(name => ({
    name, status: 'completed', conclusion: 'success',
  }));
  const runs = [{ id: 1, head_sha: pr.head.sha, status: 'completed', conclusion: 'success' }];
  const calls = [];
  const api = {
    pulls: {
      list: async () => [pr], get: async () => ({ data: pr }),
      listReviews: async () => change.reviews ?? [],
      merge: async args => {
        calls.push(args);
        if (change.mergeError) throw { status: change.mergeError };
        return { data: { merged: true } };
      },
    },
    actions: {
      listWorkflowRuns: async () => change.runs ?? runs,
      listJobsForWorkflowRun: async () => change.jobs ?? jobs,
    },
    checks: { listForRef: async () => change.checks ?? [] },
    repos: { getCombinedStatusForRef: async () => ({
      data: change.status ?? { total_count: 0, state: 'pending' },
    }) },
  };
  await execute({ rest: api, paginate: async (fn, args) => fn(args) },
    { repo: { owner: 'TaktischerSpeck', repo: 'Heimweg' } },
    { info() {}, warning() {} });
  return calls;
}

test('auto-merge accepts owner and Dependabot only after all matrix jobs pass', async () => {
  for (const login of ['TaktischerSpeck', 'dependabot[bot]']) {
    const calls = await run({ pr: { user: { login } } });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].sha, 'tested-head');
    assert.equal(calls[0].merge_method, 'squash');
  }
});

test('auto-merge rejects drafts, forks, other authors, bases and conflicts', async () => {
  for (const pr of [
    { draft: true }, { mergeable: false }, { mergeable: null },
    { user: { login: 'someone' } }, { base: { ref: 'release' } },
    { head: { sha: 'tested-head', repo: { full_name: 'someone/Heimweg' } } },
  ]) assert.equal((await run({ pr })).length, 0);
});

test('auto-merge rejects missing, stale, failed and pending CI', async () => {
  for (const runs of [[],
    [{ id: 1, head_sha: 'old-head', status: 'completed', conclusion: 'success' }],
    [{ id: 1, head_sha: 'tested-head', status: 'completed', conclusion: 'failure' }],
    [{ id: 2, head_sha: 'tested-head', status: 'in_progress', conclusion: null }],
  ]) assert.equal((await run({ runs })).length, 0);
  assert.equal((await run({ jobs: [] })).length, 0);
});

test('auto-merge respects external checks, statuses and requested changes', async () => {
  for (const change of [
    { checks: [{ status: 'in_progress', conclusion: null }] },
    { checks: [{ status: 'completed', conclusion: 'failure' }] },
    { status: { total_count: 1, state: 'failure' } },
    { reviews: [{ user: { login: 'reviewer' }, state: 'CHANGES_REQUESTED' }] },
  ]) assert.equal((await run(change)).length, 0);
});

test('auto-merge respects merge API conflicts and propagates permission failures', async () => {
  assert.equal((await run({ mergeError: 409 })).length, 1);
  await assert.rejects(run({ mergeError: 403 }), error => error.status === 403);
});
