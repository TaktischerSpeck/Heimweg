import { test } from 'node:test';
import assert from 'node:assert/strict';
import { optimize } from '../src/optimizer.js';
import { matrix } from './helpers.js';

function input(n, seats = [4, 3], supervisors = 1) {
  return {
    children: Array.from({ length: n }, (_, i) => ({ id: `child-${i}`, name: `Synthetic ${i}` })),
    fleet: seats.map((s, i) => ({ id: `v-${i}`, name: `V${i}`, seats: s, supervisors })),
    matrix: matrix(n),
  };
}
function invariants(result, source) {
  for (const variant of result.variants.filter((v) => v.computed)) {
    const ids = variant.routes.flatMap((r) => r.stops.map((c) => c.id));
    assert.deepEqual(ids.toSorted(), source.children.map((c) => c.id).toSorted());
    assert.equal(new Set(ids).size, ids.length);
    for (const route of variant.routes)
      assert.ok(route.stops.length <= route.vehicle.seats - route.vehicle.supervisors);
  }
}
test('zero children, zero vehicles, invalid supervisors and insufficient capacity fail', () => {
  for (const data of [input(0), input(2, []), input(5, [2, 2]), input(2, [2], 2), input(2, [9], 3)])
    assert.throws(() => optimize(data));
  const duplicate = input(2);
  duplicate.children[1].id = duplicate.children[0].id;
  assert.throws(() => optimize(duplicate));
});
test('one, two and multiple vehicles with heterogeneous capacities and 1/2 supervisors', () => {
  for (const data of [input(3, [4]), input(5, [4, 3]), input(7, [6, 4, 3], 2), input(1, [4, 3, 3])])
    invariants(optimize(data), data);
});
test('unused vehicles are allowed; the fewest are chosen on ties', () => {
  const data = input(3, [9, 9, 9]);
  const result = optimize(data);
  assert.equal(result.bestCount, 1);
  assert.equal(result.variants[0].unusedVehicles.length, 2);
  assert.equal(result.referenceCount, 1);
});
test('variants and savings use optimized reference and distinguish total driving from makespan', () => {
  const data = input(2, [3, 3]);
  data.matrix = {
    durations: [
      [0, 60, 60],
      [60, 0, 100],
      [60, 100, 0],
    ],
    distances: [
      [0, 600, 600],
      [600, 0, 1000],
      [600, 1000, 0],
    ],
  };
  const result = optimize(data);
  assert.equal(result.variants[0].latestArrival, 160);
  assert.equal(result.variants[1].latestArrival, 60);
  assert.equal(result.variants[1].savings.latestSeconds, 100);
  assert.equal(result.variants[1].savings.totalSeconds, 40);
  assert.equal(result.bestCount, 2);
  data.matrix.durations = [
    [0, 100, 100],
    [100, 0, 1],
    [100, 1, 0],
  ];
  const costly = optimize(data);
  assert.equal(costly.variants[1].savings.totalSeconds, -99);
});
test('unreachable destinations and invalid matrices fail instead of inventing distances', () => {
  const data = input(2);
  data.matrix.durations[0][1] = null;
  assert.throws(() => optimize(data));
  data.matrix = matrix(2);
  data.matrix.distances[2][0] = Infinity;
  assert.throws(() => optimize(data));
});
test('asymmetric street direction, dwell time and return trip are separate', () => {
  const data = input(2, [3]);
  data.dwellSeconds = 30;
  data.matrix.durations = [
    [0, 100, 10],
    [600, 0, 100],
    [900, 1, 0],
  ];
  const route = optimize(data).variants[0].routes[0];
  assert.deepEqual(
    route.stops.map((c) => c.id),
    ['child-1', 'child-0'],
  );
  assert.equal(route.duration, 41);
  assert.equal(route.driving, 11);
  assert.equal(route.returnDuration, 600);
  assert.equal(route.stops[0].arrivalSeconds, 10);
});
test('large-instance local search is deterministic and maintains all assignment constraints', () => {
  const data = input(12, [6, 5, 5], 1);
  const a = optimize(data),
    b = optimize(data);
  invariants(a, data);
  assert.deepEqual(a, b);
  assert.equal(a.variants.find((v) => v.computed).optimal, false);
});
test('exact solver matches exhaustive enumeration on a small asymmetric problem', () => {
  const data = input(5, [4, 3, 3]);
  data.matrix.durations = Array.from({ length: 6 }, (_, i) =>
    Array.from({ length: 6 }, (_, j) => (i === j ? 0 : ((i * 31 + j * 17 + i * j * 7) % 97) + 1)),
  );
  let best;
  const routes = [[], [], []];
  function permute(remaining) {
    if (!remaining.length) {
      const times = routes
        .filter((r) => r.length)
        .map((r) => r.reduce((s, node, i) => s + data.matrix.durations[i ? r[i - 1] : 0][node], 0));
      const score = [Math.max(...times), times.reduce((a, b) => a + b, 0), times.length];
      if (
        !best ||
        score[0] < best[0] ||
        (score[0] === best[0] &&
          (score[1] < best[1] || (score[1] === best[1] && score[2] < best[2])))
      )
        best = score;
      return;
    }
    for (const node of remaining)
      for (let v = 0; v < routes.length; v++) {
        if (routes[v].length >= data.fleet[v].seats - 1) continue;
        routes[v].push(node);
        permute(remaining.filter((n) => n !== node));
        routes[v].pop();
      }
  }
  permute([1, 2, 3, 4, 5]);
  const result = optimize(data),
    variant = result.variants.find((v) => v.count === result.bestCount);
  assert.deepEqual([variant.latestArrival, variant.totalDuration, variant.count], best);
});
