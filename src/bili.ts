import type { ForwardMessage, MessageSegment } from '@napgram/sdk';

export type BiliVideo = {
  title: string;
  description: string;
  coverImage?: string;
  url: string;
  upName?: string;
  stats?: BiliStats;
};

export type BiliStats = {
  view?: number;
  like?: number;
  coin?: number;
  favorite?: number;
  share?: number;
  danmaku?: number;
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
const SAFE_PROTOCOLS = new Set(['http:', 'https:']);
const PRIVATE_IP_REGEX = /^(10\.|127\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)/;
const PRIVATE_HOSTNAME_SUFFIXES = ['.local', '.internal'];
const URL_EXTRACT_PATTERN = /https?:\/\/[^\s]+/gi;
const TRAILING_PUNCTUATION_PATTERN = /[)\]\}>"'!?.,]+$/u;

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
  const bvPattern = /(?:^|\s)(bv[0-9a-zA-Z]{10})(?:\s|$)/gi;
  const avPattern = /(?:^|\s)(av\d+)(?:\s|$)/gi;
  let match: RegExpExecArray | null;

  while ((match = bvPattern.exec(text)) !== null) {
    const raw = match[1];
    const id = raw.startsWith('BV') ? raw : `BV${raw.slice(2)}`;
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
  const fallbackUrl =
    idType === 'bv' ? `https://www.bilibili.com/video/${id}` : `https://www.bilibili.com/video/av${id}`;
  const url = bvid
    ? `https://www.bilibili.com/video/${bvid}`
    : aid
      ? `https://www.bilibili.com/video/av${aid}`
      : fallbackUrl;
  const stat = info.stat ?? {};

  return {
    title: typeof info.title === 'string' ? info.title : '',
    description: typeof info.desc === 'string' ? info.desc : '',
    coverImage: typeof info.pic === 'string' ? info.pic : undefined,
    url,
    upName: typeof info.owner?.name === 'string' ? info.owner.name : undefined,
    stats: {
      view: typeof stat.view === 'number' ? stat.view : undefined,
      like: typeof stat.like === 'number' ? stat.like : undefined,
      coin: typeof stat.coin === 'number' ? stat.coin : undefined,
      favorite: typeof stat.favorite === 'number' ? stat.favorite : undefined,
      share: typeof stat.share === 'number' ? stat.share : undefined,
      danmaku: typeof stat.danmaku === 'number' ? stat.danmaku : undefined,
    },
  };
}

export function buildForwardMessagesForBili(video: BiliVideo, senderId: string): ForwardMessage[] {
  const text = formatBiliText(video);
  const messages: ForwardMessage[] = [
    {
      userId: senderId,
      userName: 'B站解析',
      segments: [{ type: 'text', data: { text } } as MessageSegment],
    },
  ];

  if (video.coverImage) {
    messages.push({
      userId: senderId,
      userName: 'B站解析',
      segments: [{ type: 'image', data: { url: video.coverImage } } as MessageSegment],
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
  const matches = text.match(URL_EXTRACT_PATTERN);
  if (!matches) {
    return [];
  }

  return matches
    .map((raw) => sanitizeExtractedUrl(raw))
    .filter((value): value is string => Boolean(value));
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

  return trimmed;
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

function extractBiliIdFromUrl(url: string): { type: 'bv' | 'av'; id: string } | null {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname || '';
    const bvMatch = path.match(/\/video\/(BV[0-9a-zA-Z]{10})/i);
    if (bvMatch?.[1]) {
      const id = bvMatch[1].startsWith('BV') ? bvMatch[1] : `BV${bvMatch[1].slice(2)}`;
      return { type: 'bv', id };
    }
    const avMatch = path.match(/\/video\/av(\d+)/i);
    if (avMatch?.[1]) {
      return { type: 'av', id: avMatch[1] };
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

  if (video.upName) {
    segments.push(`UP主：${video.upName}`);
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
