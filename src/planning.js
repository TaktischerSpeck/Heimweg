import { Worker } from 'node:worker_threads';
import { HttpError } from './validation.js';

export function runOptimizer(input, seconds = 10) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./optimizer-worker.js', import.meta.url), {
      workerData: input,
    });
    let settled = false;
    function finish(error, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      if (error) reject(error);
      else resolve(result);
    }
    // A hardware-dependent partial search must not silently change the result for identical input.
    // The deterministic search either finishes within the limit or returns an explicit timeout.
    const timer = setTimeout(
      () =>
        finish(
          new HttpError(
            422,
            'Die Rechenzeit wurde überschritten. Bitte die Rechenzeit erhöhen; es wurde keine neue Planung übernommen.',
          ),
        ),
      seconds * 1000,
    );
    worker.on('message', (message) => {
      if (message.type === 'progress') return;
      else if (message.type === 'result') finish(null, { ...message.result, timedOut: false });
      else finish(new HttpError(422, message.message));
    });
    worker.on('error', () =>
      finish(new HttpError(500, 'Die Routenberechnung konnte nicht gestartet werden.')),
    );
    worker.on('exit', (code) => {
      if (!settled && code !== 0)
        finish(new HttpError(500, 'Die Routenberechnung wurde unterbrochen.'));
    });
  });
}
