import fs from 'node:fs/promises';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidId(value) {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(value);
}

function isValidPath(value) {
  return isNonEmptyString(value) && value.startsWith('dist/');
}

const errors = [];

const pkg = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'));
const meta = JSON.parse(await fs.readFile(new URL('../napgram-plugin.json', import.meta.url), 'utf8'));

if (meta.schemaVersion !== 1) {
  errors.push('napgram-plugin.json: schemaVersion must be 1');
}

if (meta.kind !== 'native') {
  errors.push('napgram-plugin.json: kind must be "native"');
}

if (!isNonEmptyString(meta.id) || !isValidId(meta.id)) {
  errors.push('napgram-plugin.json: id must match [a-zA-Z0-9_-]{1,64}');
}

if (!isNonEmptyString(meta.name)) {
  errors.push('napgram-plugin.json: name is required');
}

if (!isNonEmptyString(meta.description)) {
  errors.push('napgram-plugin.json: description is required');
}

if (!isValidPath(meta.entry)) {
  errors.push('napgram-plugin.json: entry must be under dist/');
}

if (!isNonEmptyString(pkg.name)) {
  errors.push('package.json: name is required');
}

if (!isNonEmptyString(pkg.version)) {
  errors.push('package.json: version is required');
}

const permissions = meta.permissions || {};
if (!Array.isArray(permissions.instances)) {
  errors.push('napgram-plugin.json: permissions.instances must be an array');
}
if (!Array.isArray(permissions.network)) {
  errors.push('napgram-plugin.json: permissions.network must be an array');
}
if (!Array.isArray(permissions.fs)) {
  errors.push('napgram-plugin.json: permissions.fs must be an array');
}

if (errors.length > 0) {
  const message = errors.join('\n');
  console.error(message);
  process.exit(1);
}

console.log('validate-plugin: ok');
