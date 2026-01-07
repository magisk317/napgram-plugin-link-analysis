import fs from 'node:fs/promises';
import path from 'node:path';

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

const indexPath = argValue('--index') || 'index.json';
const snippetPath = argValue('--snippet') || 'marketplace-index-snippet.json';

const indexRaw = await fs.readFile(path.resolve(indexPath), 'utf8');
const snippetRaw = await fs.readFile(path.resolve(snippetPath), 'utf8');

const indexData = JSON.parse(indexRaw);
const snippet = JSON.parse(snippetRaw);
const plugin = snippet?.plugins?.[0];

if (!plugin) {
  throw new Error('snippet missing plugins[0]');
}

if (!Array.isArray(indexData.plugins)) {
  indexData.plugins = [];
}

const existing = indexData.plugins.find(item => item.id === plugin.id);
const version = plugin.versions?.[0];

if (!existing) {
  indexData.plugins.push(plugin);
} else {
  if (plugin.name) existing.name = plugin.name;
  if (plugin.description) existing.description = plugin.description;
  if (plugin.readme) existing.readme = plugin.readme;
  if (!Array.isArray(existing.versions)) existing.versions = [];
  if (version) {
    const idx = existing.versions.findIndex(item => item.version === version.version);
    if (idx >= 0) {
      existing.versions[idx] = version;
    } else {
      existing.versions.push(version);
    }
  }
}

await fs.writeFile(path.resolve(indexPath), `${JSON.stringify(indexData, null, 2)}\n`, 'utf8');
