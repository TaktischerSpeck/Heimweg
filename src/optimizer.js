import { ensure } from './validation.js';
import { validateMatrix } from './providers.js';

const sum = (values) => values.reduce((a, b) => a + b, 0);
const countBits = (n) => {
  let count = 0;
  for (; n; n &= n - 1) count++;
  return count;
};
const lexLess = (a, b) =>
  !b ||
  a.some((v, i) => v < b[i] - 1e-7 && a.slice(0, i).every((p, j) => Math.abs(p - b[j]) < 1e-7));
function routeTime(stops, matrix, dwell) {
  return stops.reduce(
    (total, point, index) =>
      total + matrix[index ? stops[index - 1] : 0][point] + (index ? dwell : 0),
    0,
  );
}
function score(routes, matrix, dwell) {
  const values = routes
    .filter((route) => route.length)
    .map((route) => routeTime(route, matrix, dwell));
  return [Math.max(0, ...values), sum(values), values.length];
}
function heldKarp(n, matrix, dwell) {
  const size = 1 << n;
  const costs = new Float64Array(size * n).fill(Infinity);
  const parents = new Int16Array(size * n).fill(-1);
  const routeCosts = new Float64Array(size).fill(Infinity);
  const ends = new Int16Array(size).fill(-1);
  routeCosts[0] = 0;
  for (let mask = 1; mask < size; mask++) {
    for (let end = 0; end < n; end++) {
      if (!(mask & (1 << end))) continue;
      const previousMask = mask ^ (1 << end);
      const index = mask * n + end;
      if (!previousMask) costs[index] = matrix[0][end + 1];
      else
        for (let previous = 0; previous < n; previous++) {
          if (!(previousMask & (1 << previous))) continue;
          const cost = costs[previousMask * n + previous] + matrix[previous + 1][end + 1] + dwell;
          if (cost < costs[index]) {
            costs[index] = cost;
            parents[index] = previous;
          }
        }
      if (costs[index] < routeCosts[mask]) {
        routeCosts[mask] = costs[index];
        ends[mask] = end;
      }
    }
  }
  function path(mask) {
    let end = ends[mask];
    const points = [];
    while (mask) {
      points.push(end + 1);
      const previous = parents[mask * n + end];
      mask ^= 1 << end;
      end = previous;
    }
    return points.reverse();
  }
  return { routeCosts, path };
}
function exactVariant(n, fleet, k, paths) {
  const size = 1 << n;
  const all = size - 1;
  const populations = Array.from({ length: size }, (_, i) => countBits(i));
  const thresholds = [...new Set([...paths.routeCosts].filter(Number.isFinite))].sort(
    (a, b) => a - b,
  );
  function partition(limit, trace = false) {
    let current = new Float64Array((k + 1) * size).fill(Infinity);
    current[0] = 0;
    const history = [];
    for (let v = 0; v < fleet.length; v++) {
      const next = current.slice();
      const choices = trace ? new Int32Array(current.length).fill(-1) : null;
      for (let used = 0; used < k; used++)
        for (let mask = 0; mask < size; mask++) {
          const cost = current[used * size + mask];
          if (!Number.isFinite(cost)) continue;
          const remaining = all ^ mask;
          for (let subset = remaining; subset; subset = (subset - 1) & remaining) {
            if (populations[subset] > fleet[v].capacity || paths.routeCosts[subset] > limit)
              continue;
            const index = (used + 1) * size + (mask | subset);
            const candidate = cost + paths.routeCosts[subset];
            if (candidate < next[index]) {
              next[index] = candidate;
              if (choices) choices[index] = subset;
            }
          }
        }
      current = next;
      if (trace) history.push(choices);
    }
    if (!Number.isFinite(current[k * size + all])) return null;
    if (!trace) return true;
    const routes = Array.from({ length: fleet.length }, () => []);
    let mask = all,
      used = k;
    for (let v = fleet.length - 1; v >= 0; v--) {
      const subset = history[v][used * size + mask];
      if (subset !== -1) {
        routes[v] = paths.path(subset);
        mask ^= subset;
        used--;
      }
    }
    return routes;
  }
  let low = 0,
    high = thresholds.length - 1;
  if (!partition(thresholds[high])) return null;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (partition(thresholds[mid])) high = mid;
    else low = mid + 1;
  }
  return partition(thresholds[low], true);
}
function combinations(length, k) {
  const result = [];
  function walk(start, chosen) {
    if (chosen.length === k) {
      result.push(chosen);
      return;
    }
    for (let i = start; i < length; i++) walk(i + 1, [...chosen, i]);
  }
  walk(0, []);
  return result;
}
function heuristic(n, fleet, indices, matrix, dwell, seed) {
  const caps = indices.map((i) => fleet[i].capacity);
  const k = caps.length;
  const children = Array.from({ length: n }, (_, i) => i + 1);
  children.sort((a, b) =>
    seed === 0
      ? matrix[0][b] - matrix[0][a] || a - b
      : seed === 1
        ? matrix[0][a] - matrix[0][b] || a - b
        : ((a * 2654435761 + seed * 1013904223) >>> 0) -
          ((b * 2654435761 + seed * 1013904223) >>> 0),
  );
  let routes = caps.map((_, i) => [children[i]]);
  for (const child of children.slice(k)) {
    let best = null,
      bestScore = null;
    for (let v = 0; v < k; v++) {
      if (routes[v].length >= caps[v]) continue;
      for (let position = 0; position <= routes[v].length; position++) {
        const candidate = routes.map((route) => route.slice());
        candidate[v].splice(position, 0, child);
        const candidateScore = score(candidate, matrix, dwell);
        if (lexLess(candidateScore, bestScore)) {
          best = candidate;
          bestScore = candidateScore;
        }
      }
    }
    if (!best) return null;
    routes = best;
  }
  // Deterministic local search: order reversal, relocation and cross-vehicle exchange.
  for (let pass = 0; pass < 16; pass++) {
    let best = routes,
      bestScore = score(routes, matrix, dwell);
    function consider(candidate) {
      const candidateScore = score(candidate, matrix, dwell);
      if (lexLess(candidateScore, bestScore)) {
        best = candidate;
        bestScore = candidateScore;
      }
    }
    for (let v = 0; v < k; v++) {
      for (let a = 0; a < routes[v].length; a++) {
        for (let b = a + 1; b < routes[v].length; b++) {
          const candidate = routes.map((route) => route.slice());
          candidate[v].splice(a, b - a + 1, ...candidate[v].slice(a, b + 1).reverse());
          consider(candidate);
        }
        for (let w = 0; w < k; w++) {
          if (w === v) continue;
          for (let b = 0; b <= routes[w].length; b++) {
            if (routes[v].length > 1 && routes[w].length < caps[w]) {
              const candidate = routes.map((route) => route.slice());
              candidate[w].splice(b, 0, candidate[v].splice(a, 1)[0]);
              consider(candidate);
            }
            if (b < routes[w].length && w > v) {
              const candidate = routes.map((route) => route.slice());
              [candidate[v][a], candidate[w][b]] = [candidate[w][b], candidate[v][a]];
              consider(candidate);
            }
          }
        }
      }
    }
    if (best === routes) break;
    routes = best;
  }
  const full = fleet.map(() => []);
  indices.forEach((v, i) => {
    full[v] = routes[i];
  });
  return full;
}
export function prepare(input) {
  const { children, fleet, matrix } = input;
  ensure(
    Array.isArray(children) && children.length > 0 && children.length <= 40,
    'Bitte 1 bis 40 Kinder auswählen.',
  );
  ensure(
    new Set(children.map((c) => c.id)).size === children.length,
    'Kinder dürfen nicht doppelt ausgewählt sein.',
  );
  ensure(
    Array.isArray(fleet) && fleet.length > 0 && fleet.length <= 8,
    'Bitte 1 bis 8 Fahrzeuge auswählen.',
  );
  ensure(
    new Set(fleet.map((v) => v.id)).size === fleet.length,
    'Fahrzeuge dürfen nicht doppelt ausgewählt sein.',
  );
  ensure(
    fleet.every(
      (v) => [1, 2].includes(v.supervisors) && Number.isInteger(v.seats) && v.seats > v.supervisors,
    ),
    'Ein Fahrzeug hat keine verfügbaren Kinderplätze.',
  );
  const vehicles = fleet.map((v) => ({ ...v, capacity: v.seats - v.supervisors }));
  ensure(
    sum(vehicles.map((v) => v.capacity)) >= children.length,
    'Die ausgewählten Fahrzeuge haben zu wenige Kinderplätze.',
  );
  validateMatrix(matrix, children.length + 1);
  const dwell = input.dwellSeconds ?? 0;
  ensure(Number.isInteger(dwell) && dwell >= 0 && dwell <= 300, 'Ungültige Ausstiegszeit.');
  return { ...input, fleet: vehicles, dwellSeconds: dwell };
}
export function summarize(routes, input, optimal = false) {
  const { children, fleet, matrix, dwellSeconds } = input;
  const assigned = routes.flat();
  ensure(
    assigned.length === children.length &&
      new Set(assigned).size === children.length &&
      assigned.every((i) => i > 0 && i <= children.length),
    'Keine vollständige gültige Lösung gefunden.',
    422,
  );
  const details = routes
    .map((points, v) => {
      ensure(
        points.length <= fleet[v].capacity,
        'Eine Fahrzeugkapazität wurde überschritten.',
        422,
      );
      let elapsed = 0,
        driving = 0,
        distance = 0;
      const stops = points.map((point, i) => {
        const from = i ? points[i - 1] : 0;
        driving += matrix.durations[from][point];
        elapsed += matrix.durations[from][point] + (i ? dwellSeconds : 0);
        distance += matrix.distances[from][point];
        return { ...children[point - 1], arrivalSeconds: elapsed };
      });
      const last = points.at(-1);
      return {
        vehicle: fleet[v],
        stops,
        duration: elapsed,
        driving,
        distance,
        returnDuration: last ? matrix.durations[last][0] : 0,
        returnDistance: last ? matrix.distances[last][0] : 0,
      };
    })
    .filter((route) => route.stops.length);
  return {
    count: details.length,
    feasible: true,
    computed: true,
    optimal,
    routes: details,
    latestArrival: Math.max(...details.map((r) => r.duration)),
    totalDuration: sum(details.map((r) => r.driving)),
    totalElapsed: sum(details.map((r) => r.duration)),
    totalDistance: sum(details.map((r) => r.distance)),
    unusedVehicles: fleet.filter((v) => !details.some((r) => r.vehicle.id === v.id)),
  };
}
export function compareVariants(variants) {
  const valid = variants.filter((v) => v.computed).sort((a, b) => a.count - b.count);
  ensure(
    valid.length,
    'Innerhalb der Rechenzeit wurde keine vollständige Lösung gefunden. Bitte die Rechenzeit erhöhen.',
    422,
  );
  const reference = valid[0];
  const best = valid.reduce((a, b) =>
    lexLess(
      [b.latestArrival, b.totalDuration, b.count],
      [a.latestArrival, a.totalDuration, a.count],
    )
      ? b
      : a,
  );
  for (const variant of valid) {
    const latest = reference.latestArrival - variant.latestArrival;
    const total = reference.totalDuration - variant.totalDuration;
    variant.savings = {
      latestSeconds: latest,
      totalSeconds: total,
      latestPercent: reference.latestArrival ? (latest / reference.latestArrival) * 100 : null,
      totalPercent: reference.totalDuration ? (total / reference.totalDuration) * 100 : null,
    };
  }
  return {
    variants,
    bestCount: best.count,
    referenceCount: reference.count,
    hasComparison: valid.length > 1,
  };
}
export function optimize(raw, onProgress = () => {}) {
  const input = prepare(raw);
  const { children, fleet, matrix, dwellSeconds } = input;
  const n = children.length;
  const variants = fleet.map((_, i) => ({
    count: i + 1,
    feasible:
      i < n &&
      sum(
        fleet
          .map((v) => v.capacity)
          .sort((a, b) => b - a)
          .slice(0, i + 1),
      ) >= n,
    computed: false,
  }));
  const paths = n <= 9 ? heldKarp(n, matrix.durations, dwellSeconds) : null;
  for (const variant of variants) {
    if (!variant.feasible) continue;
    if (paths) {
      const routes = exactVariant(n, fleet, variant.count, paths);
      if (routes) Object.assign(variant, summarize(routes, input, true));
      onProgress(structuredClone(variants));
      continue;
    }
    const choices = combinations(fleet.length, variant.count).filter(
      (indices) => sum(indices.map((i) => fleet[i].capacity)) >= n,
    );
    for (const indices of choices)
      for (let seed = 0; seed < 4; seed++) {
        const routes = heuristic(n, fleet, indices, matrix.durations, dwellSeconds, seed);
        if (!routes) continue;
        const candidate = summarize(routes, input);
        if (
          !variant.computed ||
          lexLess(
            [candidate.latestArrival, candidate.totalDuration],
            [variant.latestArrival, variant.totalDuration],
          )
        ) {
          Object.assign(variant, candidate);
          onProgress(structuredClone(variants));
        }
      }
  }
  return compareVariants(variants);
}
