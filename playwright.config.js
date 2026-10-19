import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
export default defineConfig({
  testDir: './test/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: 'http://127.0.0.1:3100',
    headless: true,
    launchOptions: existsSync(chrome) ? { executablePath: chrome } : {},
  },
  webServer: {
    command: 'node test/browser-server.js',
    url: 'http://127.0.0.1:3100/healthz',
    reuseExistingServer: false,
    timeout: 30000,
  },
  reporter: 'list',
});
