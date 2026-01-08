import fs from 'node:fs/promises';
import path from 'node:path';

function sanitizeId(input) {
  return String(input || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 64) || 'plugin';
}

const pkg = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'));
const meta = JSON.parse(await fs.readFile(new URL('../napgram-plugin.json', import.meta.url), 'utf8'));
const id = sanitizeId(meta.id || pkg.name);
const version = pkg.version;

const releaseDir = path.resolve('release');
const entries = await fs.readdir(releaseDir).catch(() => []);

function pick(ext) {
  return entries.find(f => f === `${id}-${version}.${ext}`);
}

const zip = pick('zip');
const tgz = pick('tgz');

async function readSha(file) {
  const shaFile = path.join(releaseDir, `${file}.sha256`);
  const raw = await fs.readFile(shaFile, 'utf8');
  return raw.split(/\s+/)[0].trim();
}

const repo = process.env.GITHUB_REPOSITORY;
const tag = process.env.GITHUB_REF_NAME;
const distHost = process.env.MARKETPLACE_DIST_HOST;

function buildUrl(file) {
  if (distHost) {
    return `${distHost.replace(/\/$/, '')}/${file}`;
  }
  if (repo && tag) {
    return `https://github.com/${repo}/releases/download/${tag}/${file}`;
  }
  return `https://YOUR_HOST/${file}`;
}

function normalizeRepoUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  return raw.replace(/^git\+/, '').replace(/\.git$/, '');
}

function resolveRepoSlug() {
  if (repo) return repo;
  const pkgRepo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  const normalized = normalizeRepoUrl(pkgRepo);
  if (!normalized) return '';
  const match = normalized.match(/github\.com[:/](.+?)(\/)?$/i);
  if (match) return match[1].replace(/\.git$/, '');
  if (/^[^/]+\/[^/]+$/.test(normalized)) return normalized;
  return '';
}

function buildReadmeUrl() {
  const slug = resolveRepoSlug();
  if (!slug) return '';
  const ref = tag || 'main';
  return `https://raw.githubusercontent.com/${slug}/${ref}/README.md`;
}

const description = String(meta.description || pkg.description || '').trim();
const readme = buildReadmeUrl();

const out = {
  schemaVersion: 1,
  kind: "native",
  plugins: [
    {
      id,
      name: meta.name || 'NapGram Plugin',
      description: description || undefined,
      readme: readme || undefined,
      versions: [
        {
          version,
          entry: { type: 'file', path: String(meta.entry || 'dist/index.mjs') },
          dist: zip ? { type: 'zip', url: buildUrl(zip), sha256: await readSha(zip) }
            : tgz ? { type: 'tgz', url: buildUrl(tgz), sha256: await readSha(tgz) }
              : { type: 'zip', url: 'https://YOUR_HOST/FILE.zip', sha256: '...sha256...' }
        }
      ]
    }
  ]
};

console.log(JSON.stringify(out, null, 2));
