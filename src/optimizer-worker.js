import { parentPort, workerData } from 'node:worker_threads';
import { optimize } from './optimizer.js';
try {
  const result = optimize(workerData, (variants) =>
    parentPort.postMessage({ type: 'progress', variants }),
  );
  parentPort.postMessage({ type: 'result', result });
} catch (error) {
  parentPort.postMessage({
    type: 'error',
    message: error.status
      ? error.message
      : 'Die Routenberechnung konnte nicht abgeschlossen werden.',
  });
}
