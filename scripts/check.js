import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
for (const directory of ['src', 'public', 'scripts', 'test']) {
  for (const name of await readdir(directory, { recursive: true })) {
    if (!name.endsWith('.js')) continue;
    const result = spawnSync(process.execPath, ['--check', `${directory}/${name}`], {
      stdio: 'inherit',
    });
    if (result.status) process.exit(result.status);
  }
}
console.log('Syntax checks passed.');
