import type { ForwardMessage, MessageSegment } from '@napgram/sdk';
import { Buffer } from 'node:buffer';
import { existsSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type BiliVideo = {
  title: string;
  description: string;
  coverImage?: string;
  url: string;
  upName?: string;
  stats?: BiliStats;
  bvid?: string;
  aid?: number;
  cid?: number;
  duration?: number;
  pubDate?: number;
  zoneName?: string;
  play?: BiliMediaLink;
  download?: BiliMediaLink;
};

export type BiliStats = {
  view?: number;
  like?: number;
  coin?: number;
  favorite?: number;
  share?: number;
  danmaku?: number;
};

export type BiliMediaLink = {
  url: string;
  backupUrls?: string[];
  quality?: number;
  format?: string;
  size?: number;
  length?: number;
};

export const BILI_DOMAINS = [
  'bilibili.com',
  'www.bilibili.com',
  'm.bilibili.com',
  'b23.tv',
  'bili22.cn',
  'bili23.cn',
  'bili33.cn',
  'bili2233.cn',
] as const;

const BILI_SHORT_DOMAINS = new Set(['b23.tv', 'bili22.cn', 'bili23.cn', 'bili33.cn', 'bili2233.cn']);
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const MAX_URL_LENGTH = 2048;
const MAX_CONTENT_LENGTH = 260;
const MAX_AUTO_DOWNLOAD_DURATION_SECONDS = 10 * 60;
const PLAYURL_DEFAULT_QN = 64;
const SAFE_PROTOCOLS = new Set(['http:', 'https:']);
const PRIVATE_IP_REGEX = /^(10\.|127\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)/;
const PRIVATE_HOSTNAME_SUFFIXES = ['.local', '.internal'];
const URL_EXTRACT_PATTERN = /https?:\/\/[^\s]+/gi;
const DOMAIN_EXTRACT_PATTERN = new RegExp(
  `\\b(?:${BILI_DOMAINS.map((domain) => escapeRegExp(domain)).join('|')})[^\\s]*`,
  'gi'
);
const TRAILING_PUNCTUATION_PATTERN = /[)\]\}>"'。！？!?！，,。.]+$/u;
const HTML_ENTITY_REGEX = /&(#x?[0-9a-f]+|\w+);/gi;
const HTML_ENTITY_MAP: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function extractBiliUrlsFromText(text: string): string[] {
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

export function extractBiliIdsFromText(text: string): Array<{ idType: 'bv' | 'av'; id: string }> {
  const results: Array<{ idType: 'bv' | 'av'; id: string }> = [];
  const bvPattern = /\b(BV[0-9a-zA-Z]{10})\b/gi;
  const avPattern = /\b(AV\d+)\b/gi;
  let match: RegExpExecArray | null;

  while ((match = bvPattern.exec(text)) !== null) {
    const raw = match[1];
    const id = `BV${raw.slice(2)}`;
    results.push({ idType: 'bv', id });
  }

  while ((match = avPattern.exec(text)) !== null) {
    const raw = match[1];
    results.push({ idType: 'av', id: raw.slice(2) });
  }

  return results;
}

export async function fetchBiliVideoFromUrl(rawUrl: string): Promise<BiliVideo | null> {
  const normalizedUrl = normalizeInputUrl(rawUrl);
  if (!normalizedUrl) {
    throw new Error('invalid url');
  }

  let resolvedUrl = normalizedUrl;
  if (isBiliShortUrl(resolvedUrl)) {
    const redirected = await resolveBiliShortUrl(resolvedUrl);
    if (!redirected) {
      throw new Error('short url resolve failed');
    }
    const safeRedirect = normalizeInputUrl(redirected);
    if (!safeRedirect) {
      throw new Error('redirected url not allowed');
    }
    resolvedUrl = safeRedirect;
  }

  const id = extractBiliIdFromUrl(resolvedUrl);
  if (!id) {
    throw new Error('cannot parse video id');
  }

  return fetchBiliVideoFromId(id.type, id.id);
}

export async function fetchBiliVideoFromId(idType: 'bv' | 'av', id: string): Promise<BiliVideo | null> {
  const param = idType === 'bv' ? `bvid=${encodeURIComponent(id)}` : `aid=${encodeURIComponent(id)}`;
  const apiUrl = `https://api.bilibili.com/x/web-interface/view?${param}`;
  const data = await fetchJson(apiUrl);
  if (!data || typeof data !== 'object') {
    return null;
  }

  const payload = data as { code?: number; data?: Record<string, any> };
  if (payload.code !== 0 || !payload.data) {
    return null;
  }

  const info = payload.data;
  const bvid = typeof info.bvid === 'string' ? info.bvid : '';
  const aid = typeof info.aid === 'number' ? info.aid : null;
  const cid =
    typeof info.cid === 'number'
      ? info.cid
      : Array.isArray(info.pages) && typeof info.pages[0]?.cid === 'number'
        ? info.pages[0].cid
        : null;
  const fallbackUrl =
    idType === 'bv' ? `https://www.bilibili.com/video/${id}` : `https://www.bilibili.com/video/av${id}`;
  const url = bvid
    ? `https://www.bilibili.com/video/${bvid}`
    : aid
      ? `https://www.bilibili.com/video/av${aid}`
      : fallbackUrl;
  const stat = info.stat ?? {};
  const duration = typeof info.duration === 'number' ? info.duration : undefined;
  const pubDate = typeof info.pubdate === 'number' ? info.pubdate : undefined;
  const zoneName = typeof info.tname === 'string' ? info.tname : undefined;

  const fallbackAid = idType === 'av' && /^\d+$/.test(id) ? Number(id) : undefined;
  const video: BiliVideo = {
    title: typeof info.title === 'string' ? info.title : '',
    description: typeof info.desc === 'string' ? info.desc : '',
    coverImage: typeof info.pic === 'string' ? info.pic : undefined,
    url,
    upName: typeof info.owner?.name === 'string' ? info.owner.name : undefined,
    bvid: bvid || (idType === 'bv' ? id : undefined),
    aid: aid ?? fallbackAid,
    cid: cid ?? undefined,
    duration,
    pubDate,
    zoneName,
    stats: {
      view: typeof stat.view === 'number' ? stat.view : undefined,
      like: typeof stat.like === 'number' ? stat.like : undefined,
      coin: typeof stat.coin === 'number' ? stat.coin : undefined,
      favorite: typeof stat.favorite === 'number' ? stat.favorite : undefined,
      share: typeof stat.share === 'number' ? stat.share : undefined,
      danmaku: typeof stat.danmaku === 'number' ? stat.danmaku : undefined,
    },
  };

  if (cid && bvid) {
    try {
      const playInfo = await fetchBiliPlayInfo(bvid, cid);
      if (playInfo) {
        video.play = playInfo;
        video.download = resolveDownloadInfo(playInfo);
      }
    } catch {
      // Ignore playurl failures to avoid breaking basic metadata parsing.
    }
  }

  return video;
}

export async function buildForwardMessagesForBili(
  video: BiliVideo,
  senderId: string,
): Promise<ForwardMessage[]> {
  const messages: ForwardMessage[] = [];
  if (video.coverImage) {
    messages.push({
      userId: senderId,
      userName: 'B站解析',
      segments: [{ type: 'image', data: { url: video.coverImage } } as MessageSegment],
    });
  }

  const text = formatBiliText(video);
  messages.push({
    userId: senderId,
    userName: 'B站解析',
    segments: [{ type: 'text', data: { text } } as MessageSegment],
  });

  const downloadedVideo = await maybeDownloadBiliVideo(video);
  if (downloadedVideo) {
    messages.push({
      userId: senderId,
      userName: 'B站解析',
      segments: [{ type: 'video', data: { file: downloadedVideo } } as MessageSegment],
    });
  }

  const linkText = formatBiliMediaLinks(video);
  if (linkText) {
    messages.push({
      userId: senderId,
      userName: 'B站解析',
      segments: [{ type: 'text', data: { text: linkText } } as MessageSegment],
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
  return BILI_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
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

async function resolveBiliShortUrl(url: string): Promise<string | null> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': DEFAULT_USER_AGENT,
        },
        redirect: 'follow',
      });

      if (!response.ok) {
        throw new Error(`request failed: ${response.status}`);
      }

      if (response.url && response.url !== url) {
        return response.url;
      }

      const html = await response.text();
      const match = html.match(/<a\s+(?:[^>]*?\s+)?href="([^"]*)"/i);
      if (match?.[1]) {
        return match[1];
      }
      return null;
    } catch (error) {
      lastError = error;
      if (attempt < 2) {
        await delay(attempt * 400);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('short url resolve failed');
}

export function extractBiliIdFromUrl(url: string): { type: 'bv' | 'av'; id: string } | null {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname || '';
    const bvMatch = path.match(/\/video\/(BV[0-9a-zA-Z]{10})/i);
    if (bvMatch?.[1]) {
      const id = `BV${bvMatch[1].slice(2)}`;
      return { type: 'bv', id };
    }
    const avMatch = path.match(/\/video\/av(\d+)/i);
    if (avMatch?.[1]) {
      return { type: 'av', id: avMatch[1] };
    }
    const bvParam = parsed.searchParams.get('bvid') || parsed.searchParams.get('bv');
    if (bvParam && /^BV[0-9a-zA-Z]{10}$/i.test(bvParam)) {
      return { type: 'bv', id: `BV${bvParam.slice(2)}` };
    }
    const avParam = parsed.searchParams.get('aid') || parsed.searchParams.get('av');
    if (avParam && /^\d+$/.test(avParam)) {
      return { type: 'av', id: avParam };
    }
  } catch {
    return null;
  }
  return null;
}

function isBiliShortUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return BILI_SHORT_DOMAINS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function formatBiliText(video: BiliVideo): string {
  const segments: string[] = [];
  const title = video.title.trim();
  segments.push(`标题：${title || '未能获取标题'}`);

  const ids = formatBiliIds(video);
  if (ids) {
    segments.push(ids);
  }

  if (video.upName) {
    segments.push(`UP主：${video.upName}`);
  }

  const detail = formatBiliDetail(video);
  if (detail) {
    segments.push(detail);
  }

  const description = truncateText(video.description, MAX_CONTENT_LENGTH);
  if (description) {
    segments.push(`简介：${description}`);
  }

  const stats = formatBiliStats(video.stats);
  if (stats) {
    segments.push(stats);
  }

  segments.push(`链接：${simplifyUrl(video.url)}`);
  return segments.join('\n\n');
}

function formatBiliMediaLinks(video: BiliVideo): string {
  const parts: string[] = [];
  if (video.play?.url) {
    parts.push(`播放直链：${video.play.url}`);
  }
  if (video.download?.url && video.download.url !== video.play?.url) {
    parts.push(`下载链接：${video.download.url}`);
  }
  if (!parts.length) {
    return '';
  }
  return parts.join('\n\n');
}

function formatBiliIds(video: BiliVideo): string {
  const parts: string[] = [];
  if (video.bvid) {
    parts.push(video.bvid);
  }
  if (typeof video.aid === 'number') {
    parts.push(`av${video.aid}`);
  }
  if (!parts.length) {
    return '';
  }
  return `编号：${parts.join(' / ')}`;
}

function formatBiliDetail(video: BiliVideo): string {
  const parts: string[] = [];
  if (typeof video.duration === 'number') {
    parts.push(`时长 ${formatDuration(video.duration)}`);
  }
  if (typeof video.pubDate === 'number') {
    parts.push(`发布 ${formatDate(video.pubDate)}`);
  }
  if (video.zoneName) {
    parts.push(`分区 ${video.zoneName}`);
  }
  if (!parts.length) {
    return '';
  }
  return `信息：${parts.join(' / ')}`;
}

function formatBiliStats(stats?: BiliStats): string {
  if (!stats) {
    return '';
  }
  const parts: string[] = [];
  if (typeof stats.view === 'number') {
    parts.push(`播放 ${formatCount(stats.view)}`);
  }
  if (typeof stats.like === 'number') {
    parts.push(`赞 ${formatCount(stats.like)}`);
  }
  if (typeof stats.coin === 'number') {
    parts.push(`投币 ${formatCount(stats.coin)}`);
  }
  if (typeof stats.favorite === 'number') {
    parts.push(`收藏 ${formatCount(stats.favorite)}`);
  }
  if (typeof stats.share === 'number') {
    parts.push(`转发 ${formatCount(stats.share)}`);
  }
  if (typeof stats.danmaku === 'number') {
    parts.push(`弹幕 ${formatCount(stats.danmaku)}`);
  }
  if (!parts.length) {
    return '';
  }
  return `数据：${parts.join(' / ')}`;
}

function formatCount(value: number): string {
  if (value >= 100000000) {
    return `${formatCountUnit(value / 100000000)}亿`;
  }
  if (value >= 10000) {
    return `${formatCountUnit(value / 10000)}万`;
  }
  return value.toString();
}

function formatCountUnit(value: number): string {
  const fixed = value.toFixed(1);
  return fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed;
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainSeconds = total % 60;
  if (hours > 0) {
    return `${hours}:${pad2(minutes)}:${pad2(remainSeconds)}`;
  }
  return `${minutes}:${pad2(remainSeconds)}`;
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : value.toString();
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

function simplifyUrl(url: string): string {
  if (!url) {
    return url;
  }
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return url;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

async function maybeDownloadBiliVideo(video: BiliVideo): Promise<string | null> {
  if (typeof video.duration !== 'number' || video.duration > MAX_AUTO_DOWNLOAD_DURATION_SECONDS) {
    return null;
  }
  const url = video.download?.url || video.play?.url;
  if (!url) {
    return null;
  }
  const fileName = buildBiliVideoFileName(video);
  return downloadBiliFile(url, fileName, video.play?.format);
}

function buildBiliVideoFileName(video: BiliVideo): string {
  const id = video.bvid || (typeof video.aid === 'number' ? `av${video.aid}` : 'video');
  return `bili-${id}-${Date.now()}`;
}

async function downloadBiliFile(
  url: string,
  fileName: string,
  format?: string,
): Promise<string | null> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        'User-Agent': DEFAULT_USER_AGENT,
        Referer: 'https://www.bilibili.com/',
      },
      redirect: 'follow',
    });
  } catch {
    return null;
  }

  if (!response.ok) {
    return null;
  }

  let buffer: Buffer;
  try {
    const data = await response.arrayBuffer();
    buffer = Buffer.from(data);
  } catch {
    return null;
  }

  const contentType = response.headers.get('content-type') || undefined;
  const contentDisposition = response.headers.get('content-disposition') || undefined;
  const inferredExt = inferVideoExtension({
    url,
    contentType,
    contentDisposition,
    buffer,
    format,
  });
  const filePath = await writeBufferToSharedPath(buffer, `${fileName}${inferredExt}`);
  return filePath;
}

function inferVideoExtension(options: {
  url: string;
  contentType?: string;
  contentDisposition?: string;
  buffer: Buffer;
  format?: string;
}): string {
  const fromDisposition = inferExtFromContentDisposition(options.contentDisposition);
  if (fromDisposition) {
    return fromDisposition;
  }
  const fromUrl = inferExtFromUrl(options.url);
  if (fromUrl) {
    return fromUrl;
  }
  const fromMime = inferExtFromMime(options.contentType);
  if (fromMime) {
    return fromMime;
  }
  const fromMagic = inferExtFromMagic(options.buffer);
  if (fromMagic) {
    return fromMagic;
  }
  const fromFormat = inferExtFromFormat(options.format);
  if (fromFormat) {
    return fromFormat;
  }
  return '';
}

function inferExtFromContentDisposition(value?: string): string {
  if (!value) {
    return '';
  }
  const match = value.match(/filename\*?=(?:UTF-8''|")?([^";\n]+)(?:\"|;|$)/i);
  if (!match?.[1]) {
    return '';
  }
  try {
    const decoded = decodeURIComponent(match[1].trim());
    return normalizeExt(path.extname(decoded));
  } catch {
    return '';
  }
}

function inferExtFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return normalizeExt(path.extname(parsed.pathname));
  } catch {
    return '';
  }
}

function inferExtFromMime(contentType?: string): string {
  if (!contentType) {
    return '';
  }
  const normalized = contentType.split(';')[0]?.trim().toLowerCase();
  if (!normalized) {
    return '';
  }
  const map: Record<string, string> = {
    'video/mp4': '.mp4',
    'video/x-flv': '.flv',
    'video/flv': '.flv',
    'video/webm': '.webm',
    'video/ogg': '.ogv',
    'video/quicktime': '.mov',
  };
  if (map[normalized]) {
    return map[normalized];
  }
  if (normalized.startsWith('video/')) {
    const subtype = normalized.slice('video/'.length);
    if (/^[a-z0-9.+-]+$/i.test(subtype)) {
      return `.${subtype}`;
    }
  }
  return '';
}

function inferExtFromMagic(buffer: Buffer): string {
  if (buffer.length >= 12) {
    if (buffer.slice(4, 8).toString('ascii') === 'ftyp') {
      return '.mp4';
    }
    if (buffer.slice(0, 3).toString('ascii') === 'FLV') {
      return '.flv';
    }
    if (buffer.slice(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) {
      const hint = buffer.slice(0, 64).toString('utf8').toLowerCase();
      if (hint.includes('webm')) {
        return '.webm';
      }
      return '.mkv';
    }
  }
  return '';
}

function inferExtFromFormat(format?: string): string {
  if (!format) {
    return '';
  }
  const normalized = format.toLowerCase();
  if (normalized.includes('mp4')) {
    return '.mp4';
  }
  if (normalized.includes('flv')) {
    return '.flv';
  }
  if (normalized.includes('webm')) {
    return '.webm';
  }
  return '';
}

function normalizeExt(ext: string): string {
  if (!ext) {
    return '';
  }
  return ext.startsWith('.') ? ext : `.${ext}`;
}

async function writeBufferToSharedPath(buffer: Buffer, fileName: string): Promise<string | null> {
  const sharedRoot = '/app/.config/QQ';
  const napcatTempDir = path.join(sharedRoot, 'NapCat', 'temp');
  const sharedDir = path.join(sharedRoot, 'temp_napgram_share');
  const candidateDirs = existsSync(sharedRoot)
    ? [napcatTempDir, sharedDir]
    : [];
  candidateDirs.push(os.tmpdir());

  for (const dir of candidateDirs) {
    try {
      await fs.mkdir(dir, { recursive: true });
      const filePath = path.join(dir, fileName);
      await fs.writeFile(filePath, buffer);
      return filePath;
    } catch {
      continue;
    }
  }

  return null;
}

async function fetchBiliPlayInfo(bvid: string, cid: number): Promise<BiliMediaLink | null> {
  const params = new URLSearchParams({
    bvid,
    cid: String(cid),
    qn: String(PLAYURL_DEFAULT_QN),
    fnval: '0',
    fourk: '1',
  });
  const apiUrl = `https://api.bilibili.com/x/player/playurl?${params.toString()}`;
  const data = await fetchJson(apiUrl);
  if (!data || typeof data !== 'object') {
    return null;
  }

  const payload = data as { code?: number; data?: Record<string, any> };
  if (payload.code !== 0 || !payload.data) {
    return null;
  }

  const info = payload.data;
  const durl = Array.isArray(info.durl) ? info.durl[0] : null;
  if (!durl || typeof durl.url !== 'string') {
    return null;
  }

  return {
    url: durl.url,
    backupUrls: Array.isArray(durl.backup_url) ? durl.backup_url : undefined,
    quality: typeof info.quality === 'number' ? info.quality : undefined,
    format: typeof info.format === 'string' ? info.format : undefined,
    size: typeof durl.size === 'number' ? durl.size : undefined,
    length: typeof durl.length === 'number' ? durl.length : undefined,
  };
}

function resolveDownloadInfo(play: BiliMediaLink): BiliMediaLink {
  if (play.backupUrls && play.backupUrls.length) {
    return {
      ...play,
      url: play.backupUrls[0],
    };
  }
  return play;
}

async function fetchJson(url: string): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': DEFAULT_USER_AGENT,
          Accept: 'application/json',
          Referer: 'https://www.bilibili.com/',
        },
        redirect: 'follow',
      });

      if (!response.ok) {
        throw new Error(`request failed: ${response.status}`);
      }

      const text = await response.text();
      return JSON.parse(text);
    } catch (error) {
      lastError = error;
      if (attempt < 2) {
        await delay(attempt * 400);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('request failed');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
