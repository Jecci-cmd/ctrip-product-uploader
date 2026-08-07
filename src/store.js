import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ROOT } from './browser.js';

const DATA_DIR = path.join(ROOT, 'data', 'products');
const fileFor = (id) => path.join(DATA_DIR, `${id}.json`);

export async function createRecord({ product, parser, warning, rawText }) {
  await fs.mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
  const now = new Date().toISOString();
  const record = { id: randomUUID(), status: 'internal_review', parser, warning, createdAt: now, updatedAt: now, product, rawText };
  await fs.writeFile(fileFor(record.id), JSON.stringify(record, null, 2), { mode: 0o600 });
  return record;
}

export async function getRecord(id) {
  return JSON.parse(await fs.readFile(fileFor(id), 'utf8'));
}

export async function updateRecord(id, product) {
  const record = await getRecord(id);
  record.product = product;
  record.updatedAt = new Date().toISOString();
  await fs.writeFile(fileFor(id), JSON.stringify(record, null, 2), { mode: 0o600 });
  return record;
}

export async function updateRecordState(id, patch) {
  const record = await getRecord(id);
  Object.assign(record, patch, { updatedAt: new Date().toISOString() });
  await fs.writeFile(fileFor(id), JSON.stringify(record, null, 2), { mode: 0o600 });
  return record;
}

export async function listRecords() {
  await fs.mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
  const files = (await fs.readdir(DATA_DIR)).filter((x) => x.endsWith('.json'));
  const records = await Promise.all(files.map((x) => fs.readFile(path.join(DATA_DIR, x), 'utf8').then(JSON.parse)));
  return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(({ rawText, ...record }) => record);
}
