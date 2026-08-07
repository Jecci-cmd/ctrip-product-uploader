import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');
export const AUTH_FILE = path.join(ROOT, '.auth', 'ctrip.json');
export const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';

export async function ensurePrivateDir(dir) {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.chmod(dir, 0o700);
}

export async function launch(options = {}) {
  return chromium.launch({
    executablePath: CHROME,
    headless: process.env.HEADLESS !== '0',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    ...options,
  });
}
