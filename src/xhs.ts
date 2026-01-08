import type { ForwardMessage, MessageSegment } from '@napgram/sdk';

export type XhsNote = {
  title: string;
  content: string;
  images: string[];
  coverImage?: string;
  url: string;
  sourceUrl?: string;
};

export const XHS_DOMAINS = ['xiaohongshu.com', 'www.xiaohongshu.com', 'xhslink.com'] as const;

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const MAX_URL_LENGTH = 2048;
const MAX_IMAGES = 6;
const MAX_CONTENT_LENGTH = 260;
const SAFE_PROTOCOLS = new Set(['http:', 'https:']);
const PRIVATE_IP_REGEX = /^(10\.|127\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)/;
const PRIVATE_HOSTNAME_SUFFIXES = ['.local', '.internal'];
const URL_EXTRACT_PATTERN = /https?:\/\/[^\s]+/gi;
const DOMAIN_EXTRACT_PATTERN = new RegExp(
  `\\b(?:${XHS_DOMAINS.map((domain) => escapeRegExp(domain)).join('|')})[^\\s]*`,
  'gi'
);
const TRAILING_PUNCTUATION_PATTERN = /[)\]\}>"'!?.,]+$/u;
const HTML_ENTITY_REGEX = /&(#x?[0-9a-f]+|\w+);/gi;
const HTML_ENTITY_MAP: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function extractXhsUrlsFromText(text: string): string[] {
  const candidates = extractCandidateUrls(text);
  const results: string[] = [];
  for (const candidate of candidates) {
    const normalized = normalizeInputUrl(candidate);
    if (normalized) {
      results.push(normalized);
    }
  }
  return results;
}

export async function fetchXhsNote(rawUrl: string): Promise<XhsNote> {
  const normalizedUrl = normalizeInputUrl(rawUrl);
  if (!normalizedUrl) {
    throw new Error('invalid url');
  }

  const { html, url } = await fetchXhsHtml(normalizedUrl);
  const note = parseXhsNote(html, url);
  note.sourceUrl = rawUrl;
  return note;
}

export function buildForwardMessagesForXhs(note: XhsNote, senderId: string): ForwardMessage[] {
  const text = formatXhsText(note);
  const messages: ForwardMessage[] = [
    {
      userId: senderId,
      userName: '小红书解析',
      segments: [{ type: 'text', data: { text } } as MessageSegment],
    },
  ];

  const images = note.images.length ? note.images : note.coverImage ? [note.coverImage] : [];
  for (const imageUrl of images.slice(0, MAX_IMAGES)) {
    messages.push({
      userId: senderId,
      userName: '小红书解析',
      segments: [{ type: 'image', data: { url: imageUrl } } as MessageSegment],
    });
  }

  return messages;
}

function normalizeInputUrl(input: string): string | null {
  if (!input) {
    return null;
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.length <= MAX_URL_LENGTH) {
    const direct = normalizeSingleUrl(trimmed);
    if (direct) {
      return direct;
    }
  }

  const candidates = extractCandidateUrls(trimmed);
  for (const candidate of candidates) {
    const normalized = normalizeSingleUrl(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function normalizeSingleUrl(candidate: string): string | null {
  if (!candidate || candidate.length > MAX_URL_LENGTH) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    try {
      parsed = new URL(`https://${candidate}`);
    } catch {
      return null;
    }
  }

  if (!SAFE_PROTOCOLS.has(parsed.protocol)) {
    return null;
  }

  const hostname = parsed.hostname.toLowerCase();
  if (isPrivateHostname(hostname)) {
    return null;
  }

  if (!isAllowedDomain(hostname)) {
    return null;
  }

  parsed.hash = '';
  return parsed.toString();
}

function isAllowedDomain(hostname: string): boolean {
  return XHS_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

function isPrivateHostname(hostname: string): boolean {
  if (!hostname) {
    return true;
  }
  if (hostname === 'localhost') {
    return true;
  }
  if (PRIVATE_IP_REGEX.test(hostname)) {
    return true;
  }
  return PRIVATE_HOSTNAME_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
}

function extractCandidateUrls(text: string): string[] {
  const results = new Set<string>();
  const matches = text.match(URL_EXTRACT_PATTERN) ?? [];
  const domainMatches = text.match(DOMAIN_EXTRACT_PATTERN) ?? [];

  for (const raw of [...matches, ...domainMatches]) {
    const sanitized = sanitizeExtractedUrl(raw);
    if (sanitized) {
      results.add(sanitized);
    }
  }

  return Array.from(results);
}

function sanitizeExtractedUrl(raw: string): string | null {
  if (!raw) {
    return null;
  }

  const cleaned = raw.replace(TRAILING_PUNCTUATION_PATTERN, '');
  const trimmed = cleaned.trim();
  if (!trimmed) {
    return null;
  }

  return decodeHtmlEntities(trimmed);
}

function decodeHtmlEntities(value: string): string {
  if (!value || !value.includes('&')) {
    return value;
  }

  return value.replace(HTML_ENTITY_REGEX, (match, entity) => {
    if (!entity) {
      return match;
    }

    if (entity[0] === '#') {
      const isHex = entity[1]?.toLowerCase() === 'x';
      const numericSlice = isHex ? entity.slice(2) : entity.slice(1);
      const codePoint = parseInt(numericSlice, isHex ? 16 : 10);
      if (!Number.isNaN(codePoint)) {
        try {
          return String.fromCodePoint(codePoint);
        } catch {
          return match;
        }
      }
      return match;
    }

    const mapped = HTML_ENTITY_MAP[entity.toLowerCase()];
    return mapped ?? match;
  });
}

async function fetchXhsHtml(url: string): Promise<{ html: string; url: string }> {
  const headers = {
    'User-Agent': DEFAULT_USER_AGENT,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  };

  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetch(url, {
        headers,
        redirect: 'follow',
      });

      if (!response.ok) {
        throw new Error(`request failed: ${response.status}`);
      }

      const html = await response.text();
      return { html, url: response.url || url };
    } catch (error) {
      lastError = error;
      if (attempt < 2) {
        await delay(attempt * 400);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('request failed');
}

function parseXhsNote(html: string, url: string): XhsNote {
  const metaTitle = extractMeta(html, 'og:title') || extractTitle(html) || '';
  const metaDescription =
    extractMeta(html, 'og:description') || extractMeta(html, 'description') || '';
  const metaCover =
    extractMeta(html, 'og:image') ||
    extractMeta(html, 'og:image:secure_url') ||
    extractMeta(html, 'image') ||
    '';

  const note: XhsNote = {
    title: '',
    content: '',
    images: [],
    url,
  };

  const jsonLd = extractJsonLd(html);
  if (jsonLd) {
    const jsonTitle = firstString(jsonLd.headline, jsonLd.alternativeHeadline, jsonLd.name);
    const jsonContent = firstString(jsonLd.articleBody, jsonLd.description);
    const jsonImages = normalizeImages(jsonLd.image);

    if (jsonTitle) {
      note.title = jsonTitle;
    }
    if (jsonContent) {
      note.content = jsonContent;
    }
    if (jsonImages.length) {
      note.images.push(...jsonImages);
    }
  }

  const imageListImages = extractImageListFromHtml(html);
  if (imageListImages.length) {
    note.images.push(...imageListImages);
  }

  const embeddedImages = extractImagesFromHtml(html);
  if (embeddedImages.length) {
    note.images.push(...embeddedImages);
  }

  if (!note.title.trim()) {
    note.title = metaTitle.trim() || '未能获取标题';
  }

  if (!note.content.trim()) {
    note.content = metaDescription.trim();
  }

  if (!note.images.length && metaCover) {
    note.images.push(metaCover.trim());
  }

  note.title = note.title.trim() || '未能获取标题';
  note.content = note.content.trim();
  note.images = deduplicateXhsImages(note.images);
  note.coverImage = note.images[0] || metaCover.trim() || undefined;

  return note;
}

function extractJsonLd(html: string): Record<string, any> | null {
  const pattern = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const matches = html.matchAll(pattern);
  for (const match of matches) {
    const content = match[1]?.trim();
    if (!content) {
      continue;
    }

    const parsed = safeJsonParse(content);
    if (!parsed) {
      continue;
    }

    const candidate = findJsonLdCandidate(parsed);
    if (candidate) {
      return candidate;
    }
  }
  return null;
}

function findJsonLdCandidate(data: unknown): Record<string, any> | null {
  if (!data) {
    return null;
  }
  if (Array.isArray(data)) {
    for (const item of data) {
      const candidate = findJsonLdCandidate(item);
      if (candidate) {
        return candidate;
      }
    }
    return null;
  }
  if (typeof data === 'object') {
    const record = data as Record<string, any>;
    if (record['@graph']) {
      const candidate = findJsonLdCandidate(record['@graph']);
      if (candidate) {
        return candidate;
      }
    }
    if (isUsefulJsonLd(record)) {
      return record;
    }
  }
  return null;
}

function isUsefulJsonLd(record: Record<string, any>): boolean {
  return Boolean(record.headline || record.name || record.description || record.articleBody || record.image);
}

function safeJsonParse(value: string): Record<string, any> | null {
  try {
    return JSON.parse(value) as Record<string, any>;
  } catch {
    return null;
  }
}

function extractMeta(html: string, key: string): string | null {
  const escapedKey = escapeRegExp(key);
  const pattern = new RegExp(`<meta[^>]+(?:property|name)=["']${escapedKey}["'][^>]*>`, 'i');
  const match = html.match(pattern);
  if (!match) {
    return null;
  }
  const tag = match[0];
  const contentMatch = tag.match(/content=(?:"([^"]*)"|'([^']*)')/i);
  const content = contentMatch?.[1] ?? contentMatch?.[2];
  return content ? decodeHtmlEntities(content.trim()) : null;
}

function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) {
    return null;
  }
  return decodeHtmlEntities(match[1].trim());
}

function normalizeImages(value: unknown): string[] {
  if (!value) {
    return [];
  }
  if (typeof value === 'string') {
    return normalizeImageArray([value]);
  }
  if (Array.isArray(value)) {
    return normalizeImageArray(value);
  }
  if (typeof value === 'object') {
    const record = value as Record<string, any>;
    if (typeof record.url === 'string') {
      return normalizeImageArray([record.url]);
    }
    if (Array.isArray(record.url)) {
      return normalizeImageArray(record.url);
    }
  }
  return [];
}

function normalizeImageArray(values: unknown[]): string[] {
  const results: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') {
      continue;
    }
    const normalized = normalizeMediaUrl(value);
    if (normalized) {
      results.push(normalized);
    }
  }
  return results;
}

function normalizeMediaUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const withProtocol = trimmed.startsWith('//') ? `https:${trimmed}` : trimmed;
  try {
    const parsed = new URL(withProtocol);
    if (!SAFE_PROTOCOLS.has(parsed.protocol)) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function firstString(...values: Array<unknown>): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function deduplicateUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const results: string[] = [];
  for (const url of urls) {
    if (!url) {
      continue;
    }
    const trimmed = url.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    results.push(trimmed);
  }
  return results;
}

function formatXhsText(note: XhsNote): string {
  const segments: string[] = [];
  const title = note.title.trim();
  segments.push(`标题：${title || '未能获取标题'}`);

  const content = truncateText(note.content, MAX_CONTENT_LENGTH);
  if (content) {
    segments.push(`内容：${content}`);
  }

  segments.push(`链接：${note.sourceUrl || note.url}`);
  return segments.join('\n\n');
}

function truncateText(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength).trimEnd()}...`;
}

function extractImagesFromHtml(html: string): string[] {
  const sources: Array<Record<string, any>> = [];
  const nextData = extractJsonScriptById(html, '__NEXT_DATA__');
  if (nextData) {
    sources.push(nextData);
  }
  for (const marker of ['window.__INITIAL_STATE__', 'window.__PRELOADED_STATE__', 'window.__INITIAL_DATA__']) {
    const jsonText = extractJsonAssignment(html, marker);
    if (!jsonText) {
      continue;
    }
    const parsed = safeJsonParse(jsonText);
    if (parsed) {
      sources.push(parsed);
    }
  }
  const results: string[] = [];
  for (const source of sources) {
    results.push(...collectImageUrls(source, 6));
  }
  const rawMatches = html.match(/https?:\/\/[^"'<>\\s]+/gi) ?? [];
  for (const match of rawMatches) {
    const decoded = decodeUnicodeEscapes(match);
    if (decoded && isLikelyImageUrl(decoded)) {
      results.push(decoded);
    }
  }
  const escapedMatches = html.match(/https?:\\u002F\\u002F[^"'<>\\s]+/gi) ?? [];
  for (const match of escapedMatches) {
    const decoded = decodeUnicodeEscapes(match);
    if (decoded && isLikelyImageUrl(decoded)) {
      results.push(decoded);
    }
  }
  return deduplicateUrls(results);
}

function extractImageListFromHtml(html: string): string[] {
  const marker = '"imageList":';
  const index = html.indexOf(marker);
  if (index === -1) {
    return [];
  }
  const arrayStart = html.indexOf('[', index + marker.length);
  if (arrayStart === -1) {
    return [];
  }
  const arrayText = extractJsonArray(html, arrayStart);
  if (!arrayText) {
    return [];
  }
  const wrapper = `{${marker}${arrayText}}`;
  const parsed = safeJsonParse(wrapper);
  const list = Array.isArray(parsed?.imageList) ? parsed.imageList : [];
  const results: string[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const infoList = Array.isArray(item.infoList) ? item.infoList : [];
    let url = selectImageUrl(infoList, 'WB_DFT');
    if (!url) {
      url = selectImageUrl(infoList, 'WB_PRV');
    }
    if (!url) {
      url = selectImageUrl(infoList, '');
    }
    if (!url && typeof item.url === 'string') {
      url = item.url;
    }
    const normalized = url ? normalizeMediaUrl(url) : null;
    if (normalized) {
      results.push(normalized);
    }
  }
  return results;
}

function extractJsonArray(html: string, startIndex: number): string | null {
  let depth = 0;
  let inString = false;
  let escapeNext = false;
  let quoteChar = '';
  for (let i = startIndex; i < html.length; i += 1) {
    const ch = html[i];
    if (inString) {
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      if (ch === '\\') {
        escapeNext = true;
        continue;
      }
      if (ch === quoteChar) {
        inString = false;
      }
      continue;
    }
    if (ch === '"' || ch === '\'') {
      inString = true;
      quoteChar = ch;
      continue;
    }
    if (ch === '[') {
      depth += 1;
    } else if (ch === ']') {
      depth -= 1;
      if (depth === 0) {
        return html.slice(startIndex, i + 1);
      }
    }
  }
  return null;
}

function selectImageUrl(list: Array<Record<string, any>>, scene: string): string | undefined {
  if (!Array.isArray(list)) {
    return undefined;
  }
  for (const item of list) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    if (scene && item.imageScene !== scene) {
      continue;
    }
    if (typeof item.url === 'string') {
      return item.url;
    }
  }
  if (!scene) {
    return undefined;
  }
  return selectImageUrl(list, '');
}

function extractJsonScriptById(html: string, id: string): Record<string, any> | null {
  const escapedId = escapeRegExp(id);
  const pattern = new RegExp(`<script[^>]+id=["']${escapedId}["'][^>]*>([\\s\\S]*?)<\\/script>`, 'i');
  const match = html.match(pattern);
  if (!match) {
    return null;
  }
  const content = match[1]?.trim();
  if (!content) {
    return null;
  }
  return safeJsonParse(content);
}

function extractJsonAssignment(html: string, marker: string): string | null {
  const index = html.indexOf(marker);
  if (index === -1) {
    return null;
  }
  const equalIndex = html.indexOf('=', index);
  if (equalIndex === -1) {
    return null;
  }
  const start = html.indexOf('{', equalIndex);
  if (start === -1) {
    return null;
  }
  let depth = 0;
  let inString = false;
  let escapeNext = false;
  let quoteChar = '';
  for (let i = start; i < html.length; i += 1) {
    const ch = html[i];
    if (inString) {
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      if (ch === '\\') {
        escapeNext = true;
        continue;
      }
      if (ch === quoteChar) {
        inString = false;
      }
      continue;
    }
    if (ch === '"' || ch === '\'') {
      inString = true;
      quoteChar = ch;
      continue;
    }
    if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return html.slice(start, i + 1);
      }
    }
  }
  return null;
}

function collectImageUrls(value: unknown, maxDepth: number): string[] {
  const results: string[] = [];
  const visited = new WeakSet<object>();
  const imageKeyHint = /image|images|imageList|pic|pics|photo|cover/i;
  const imageFieldKeys = ['url', 'origin', 'originUrl', 'original', 'originalUrl', 'src', 'path', 'file'];

  const pushUrl = (url?: string) => {
    if (!url) {
      return;
    }
    const normalized = normalizeMediaUrl(url);
    if (normalized && isLikelyImageUrl(normalized)) {
      results.push(normalized);
    }
  };

  const extractFromValue = (node: unknown) => {
    if (!node) {
      return;
    }
    if (typeof node === 'string') {
      pushUrl(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) {
        extractFromValue(item);
      }
      return;
    }
    if (typeof node === 'object') {
      const record = node as Record<string, any>;
      for (const key of imageFieldKeys) {
        if (typeof record[key] === 'string') {
          pushUrl(record[key]);
        }
      }
      if (Array.isArray(record.url)) {
        for (const url of record.url) {
          if (typeof url === 'string') {
            pushUrl(url);
          }
        }
      }
    }
  };

  const walk = (node: unknown, depth: number) => {
    if (node == null || depth < 0) {
      return;
    }
    if (typeof node === 'string') {
      pushUrl(node);
      return;
    }
    if (typeof node !== 'object') {
      return;
    }
    if (visited.has(node as object)) {
      return;
    }
    visited.add(node as object);

    if (Array.isArray(node)) {
      for (const item of node) {
        walk(item, depth - 1);
      }
      return;
    }

    const record = node as Record<string, unknown>;
    for (const [key, child] of Object.entries(record)) {
      if (imageKeyHint.test(key)) {
        extractFromValue(child);
      }
      walk(child, depth - 1);
    }
  };

  walk(value, maxDepth);
  return results;
}

function isLikelyImageUrl(url: string): boolean {
  const lowered = url.toLowerCase();
  if (/\.(jpg|jpeg|png|webp|gif)(\?|#|$)/i.test(lowered)) {
    return true;
  }
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host.includes('xhscdn.com') || host.includes('xiaohongshu.com')) {
      const path = parsed.pathname.toLowerCase();
      if (path.endsWith('.js') || path.endsWith('.css') || path.endsWith('.svg')) {
        return false;
      }
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

function decodeUnicodeEscapes(value: string): string {
  return value.replace(/\\u([0-9a-fA-F]{4})/g, (_, code) => {
    const parsed = Number.parseInt(code, 16);
    if (Number.isNaN(parsed)) {
      return _;
    }
    return String.fromCharCode(parsed);
  });
}

function deduplicateXhsImages(urls: string[]): string[] {
  const seen = new Set<string>();
  const results: string[] = [];
  for (const url of urls) {
    if (!url) {
      continue;
    }
    const trimmed = url.trim();
    if (!trimmed) {
      continue;
    }
    const key = trimmed.includes('xhscdn.com') && trimmed.includes('!')
      ? trimmed.split('!')[0]
      : trimmed;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    results.push(trimmed);
  }
  return results;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
