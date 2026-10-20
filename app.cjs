// Passenger loads this CommonJS entry point; the application itself uses ES modules.
import('./src/server.js').catch(() => {
  console.error('Application bootstrap failed. Check the configured Node.js version.');
  process.exitCode = 1;
});
