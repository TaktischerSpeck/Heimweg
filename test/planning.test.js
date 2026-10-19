import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runOptimizer } from '../src/planning.js';
import { matrix } from './helpers.js';

test('worker deadline produces an explicit error and never publishes an incomplete assignment', async () => {
  const input = {
    children: [{ id: 'one' }],
    fleet: [{ id: 'v', seats: 2, supervisors: 1 }],
    matrix: matrix(1),
  };
  await assert.rejects(runOptimizer(input, 0), /Rechenzeit/);
  const result = await runOptimizer(input, 5);
  assert.equal(result.variants[0].routes[0].stops[0].id, 'one');
});
