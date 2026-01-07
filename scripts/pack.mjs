import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function sanitizeId(input) {
  return String(input || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 64) || 'plugin';
}

const type = process.argv[2];
if (!['zip', 'tgz'].includes(type)) {
  console.error('usage: node scripts/pack.mjs <zip|tgz>');
  process.exit(1);
}

const pkg = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'));
const meta = JSON.parse(await fs.readFile(new URL('../napgram-plugin.json', import.meta.url), 'utf8'));
const id = sanitizeId(meta.id || pkg.name);
const version = pkg.version;

const root = path.resolve(process.cwd());
const distDir = path.join(root, 'dist');
const releaseDir = path.join(root, 'release');
await fs.mkdir(releaseDir, { recursive: true });

// Prefer .mjs entry for ESM-safe runtime loading (works even outside any package.json "type": "module" scope).
try {
  const entryRel = String(meta.entry || 'dist/index.mjs');
  if (entryRel.endsWith('.mjs')) {
    const entryAbs = path.join(root, entryRel);
    const jsFallback = entryAbs.replace(/\.mjs$/i, '.js');
    const hasMjs = await fs.access(entryAbs).then(() => true).catch(() => false);
    const hasJs = await fs.access(jsFallback).then(() => true).catch(() => false);
    if (!hasMjs && hasJs) {
      await fs.copyFile(jsFallback, entryAbs);
    }
  }
} catch {
  // best-effort
}

const out = path.join(releaseDir, `${id}-${version}.${type === 'zip' ? 'zip' : 'tgz'}`);

const baseFiles = ['dist', 'package.json', 'README.md', 'napgram-plugin.json'];
try {
  await fs.access(path.join(root, 'LICENSE'));
  baseFiles.push('LICENSE');
} catch {}

if (type === 'zip') {
  await execFileAsync('zip', ['-r', out, ...baseFiles], { cwd: root, maxBuffer: 20 * 1024 * 1024 });
} else {
  await execFileAsync('tar', ['-czf', out, ...baseFiles], { cwd: root, maxBuffer: 20 * 1024 * 1024 });
}

const buf = await fs.readFile(out);
const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
await fs.writeFile(`${out}.sha256`, `${sha256}  ${path.basename(out)}\n`, 'utf8');

console.log(JSON.stringify({ file: path.basename(out), sha256 }, null, 2));
