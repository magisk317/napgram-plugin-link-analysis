import {
  definePlugin,
  type ForwardMessage,
  type MessageSegment,
  prepareForwardMessagesForQQ,
  resolveConfig,
} from '@napgram/sdk';
import { Buffer } from 'node:buffer';
import {
  extractXhsUrlsFromText,
  fetchXhsNote,
  buildForwardMessagesForXhs,
  XHS_DOMAINS,
} from './xhs.js';
import {
  extractBiliUrlsFromText,
  extractBiliIdsFromText,
  fetchBiliVideoFromUrl,
  fetchBiliVideoFromId,
  buildForwardMessagesForBili,
  extractBiliIdFromUrl,
  type BiliVideo,
} from './bili.js';
import { defaultConfig, type LinkAnalysisConfig } from './config.js';
import {
  checkAndMarkParsed,
  checkAndAddToSeen,
  markRecentlyParsed as markParsed,
} from './dedup-utils.js';

type LinkTarget =
  | { kind: 'xhs'; url: string }
  | { kind: 'bili'; url: string }
  | { kind: 'bili-id'; idType: 'bv' | 'av'; id: string };

const MAX_URLS = 5;

// 内存缓存：存储最近解析的链接和时间戳
const recentlyParsed = new Map<string, number>();
const CACHE_DURATION_MS = 60 * 1000; // 1分钟
const recentlyHandledMessages = new Map<string, number>();
const MESSAGE_CACHE_DURATION_MS = 15 * 1000;

const plugin = definePlugin({
  id: 'link-analysis',
  name: 'Link Analysis (XHS/Bilibili)',
  version: '0.1.0',
  author: 'NapLink',
  description: 'Parse Xiaohongshu and Bilibili share links and render a quick preview.',
  defaultConfig,
  async install(ctx, config) {
    const resolvedConfig = resolveConfig(
      (config ?? ctx?.config) as LinkAnalysisConfig | undefined,
      defaultConfig,
    );
    const logEnabled = resolveLogEnabled(resolvedConfig?.logEnabled);
    const logger = createPluginLogger(ctx.logger, logEnabled);

    logger.info('Link analysis plugin installed');

    // 定期清理过期缓存
    const cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, timestamp] of recentlyParsed.entries()) {
        if (now - timestamp > CACHE_DURATION_MS) {
          recentlyParsed.delete(key);
        }
      }
      for (const [key, timestamp] of recentlyHandledMessages.entries()) {
        if (now - timestamp > MESSAGE_CACHE_DURATION_MS) {
          recentlyHandledMessages.delete(key);
        }
      }
    }, 30 * 1000); // 每30秒清理一次

    ctx.on('message', async (event) => {
      const messageId = String((event as any)?.message?.id ?? (event as any)?.messageId ?? '');
      if (messageId) {
        const lastSeen = recentlyHandledMessages.get(messageId);
        const now = Date.now();
        if (lastSeen && now - lastSeen < MESSAGE_CACHE_DURATION_MS) {
          logger.debug(`Skipping duplicate message event: ${messageId}`);
          return;
        }
        recentlyHandledMessages.set(messageId, now);
      }
      if (shouldSkipSelfMessage(event)) {
        return;
      }
      const shareMeta = extractShareMeta(event);
      const preferredXhsUrl = shareMeta.jumpUrl;
      const preferredXhsId = extractXhsNoteId(preferredXhsUrl);
      const text = extractText(event.message.text, event.message.segments, event.raw);
      if (!text) {
        return;
      }

      const targets = extractLinkTargets(text);
      if (!targets.length) {
        return;
      }

      const uniqueTargets = deduplicateLinkTargets(targets).slice(0, MAX_URLS);

      // 过滤掉最近1分钟内已解析的链接，并立即标记通过的链接（原子操作）
      const now = Date.now();
      const targetsToProcess: LinkTarget[] = [];

      for (const target of uniqueTargets) {
        const cacheKeys = getCacheKeys(target);
        // 原子操作：检查并立即标记，避免并发竞态
        if (checkAndMarkParsed(cacheKeys, recentlyParsed, CACHE_DURATION_MS, now)) {
          logger.info(`链接去重：跳过最近已解析的链接 ${cacheKeys[0] ?? 'unknown'}`);
          continue;
        }
        // 已在checkAndMarkParsed中标记
        logger.info(`链接去重：标记链接为已处理 ${cacheKeys[0] ?? 'unknown'}`);
        targetsToProcess.push(target);
      }

      if (!targetsToProcess.length) {
        logger.info('链接去重：所有链接都在1分钟内已解析过，跳过处理');
        return;
      }

      const forwardMessages: ForwardMessage[] = [];
      const seenCanonical = new Set<string>();

      for (const target of targetsToProcess) {

        if (target.kind === 'xhs') {
          try {
            const targetId = extractXhsNoteId(target.url);
            const fetchUrl = preferredXhsId && targetId && preferredXhsId === targetId ? preferredXhsUrl! : target.url;
            const note = await fetchXhsNote(fetchUrl);
            if (shareMeta.desc) {
              note.content = shareMeta.desc;
            }
            if (preferredXhsUrl && targetId && preferredXhsId === targetId) {
              note.sourceUrl = preferredXhsUrl;
            }
            const dedupKey = targetId ? `xhs:${targetId}` : canonicalizeUrlForDedup(note.url || target.url);
            if (checkAndAddToSeen(dedupKey, seenCanonical)) {
              // 当前批次内去重，标记实际获取到的URL
              if (note.url && note.url !== target.url) {
                markParsed(getCacheKeys({ kind: 'xhs', url: note.url }), recentlyParsed, now);
              }
              continue;
            }
            // seenCanonical已在checkAndAddToSeen中更新
            forwardMessages.push(...buildForwardMessagesForXhs(note, event.sender.userId));
            // 标记实际获取到的URL（可能与输入URL不同）
            if (note.url && note.url !== target.url) {
              markParsed(getCacheKeys({ kind: 'xhs', url: note.url }), recentlyParsed, now);
            }
          } catch (error) {
            logger.warn(`XHS parse failed: ${formatError(error)}`);
          }
          continue;
        }

        try {
          const video =
            target.kind === 'bili'
              ? await fetchBiliVideoFromUrl(target.url)
              : await fetchBiliVideoFromId(target.idType, target.id);
          if (video) {
            const canonicalUrl = canonicalizeUrlForDedup(video.url || (target.kind === 'bili' ? target.url : ''));
            const videoCacheKeys = getBiliCacheKeysFromVideo(video);

            // 当前批次内去重检查
            if (checkAndAddToSeen(canonicalUrl, seenCanonical)) {
              // 标记视频的其他缓存键（BV、AV等）
              markParsed(videoCacheKeys, recentlyParsed, now);
              continue;
            }
            // seenCanonical已在checkAndAddToSeen中更新
            forwardMessages.push(...await buildForwardMessagesForBili(video, event.sender.userId));
            // 标记视频的所有缓存键（URL、BV、AV等）
            markParsed(videoCacheKeys, recentlyParsed, now);
          }
        } catch (error) {
          logger.warn(`Bilibili parse failed: ${formatError(error)}`);
        }
      }

      if (!forwardMessages.length) {
        return;
      }

      await sendForwardPreview(ctx, event, forwardMessages, logger);
    });

    ctx.onUnload(() => {
      clearInterval(cleanupInterval);
      logger.info('Link analysis plugin unloaded');
    });
  },
});

export default plugin;

function getCacheKeys(target: LinkTarget): string[] {
  if (target.kind === 'xhs') {
    return getXhsCacheKeys(target.url);
  }
  if (target.kind === 'bili') {
    return getBiliCacheKeysFromUrl(target.url);
  }
  return getBiliCacheKeysFromId(target.idType, target.id);
}

function getXhsCacheKeys(url: string): string[] {
  const noteId = extractXhsNoteId(url);
  if (noteId) {
    return [`xhs:${noteId}`];
  }
  return [`xhs:${url}`];
}

function getBiliCacheKeysFromUrl(url: string): string[] {
  const keys = new Set<string>();
  const canonicalUrl = canonicalizeUrlForDedup(url) || url;
  keys.add(`bili:${canonicalUrl}`);
  const parsed = extractBiliIdFromUrl(url);
  if (parsed) {
    for (const key of getBiliCacheKeysFromId(parsed.type, parsed.id)) {
      keys.add(key);
    }
  }
  return Array.from(keys);
}

function getBiliCacheKeysFromId(idType: 'bv' | 'av', id: string): string[] {
  const normalizedId = normalizeBiliId(idType, id);
  const keys = new Set<string>();
  keys.add(`bili-id:${idType}:${normalizedId}`);
  const canonicalUrl =
    idType === 'bv'
      ? `https://www.bilibili.com/video/${normalizedId}`
      : `https://www.bilibili.com/video/av${normalizedId}`;
  keys.add(`bili:${canonicalizeUrlForDedup(canonicalUrl)}`);
  return Array.from(keys);
}

function getBiliCacheKeysFromVideo(video: BiliVideo): string[] {
  const keys = new Set<string>();
  if (video.url) {
    for (const key of getBiliCacheKeysFromUrl(video.url)) {
      keys.add(key);
    }
  }
  if (video.bvid) {
    for (const key of getBiliCacheKeysFromId('bv', video.bvid)) {
      keys.add(key);
    }
  }
  if (typeof video.aid === 'number') {
    for (const key of getBiliCacheKeysFromId('av', String(video.aid))) {
      keys.add(key);
    }
  }
  return Array.from(keys);
}

function normalizeBiliId(idType: 'bv' | 'av', id: string): string {
  if (!id) {
    return id;
  }
  if (idType === 'bv') {
    if (/^bv/i.test(id)) {
      return `BV${id.slice(2)}`;
    }
    return `BV${id}`;
  }
  return id.replace(/^av/i, '');
}

// 去重辅助函数已移至 dedup-utils.ts

const LINK_HINT_REGEX = /(https?:\/\/|www\.|xhslink\.com|xiaohongshu\.com|b23\.tv|bilibili\.com|bv[0-9a-z]{8,}|av\d{6,})/i;
const MAX_CANDIDATE_TEXTS = 80;
const MAX_RAW_DEPTH = 4;

function extractText(rawText?: string, segments?: Array<any>, rawEvent?: any): string {
  const pieces = new Set<string>();
  const addPiece = (value?: string) => {
    if (!value) {
      return;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    pieces.add(trimmed);
  };

  addPiece(rawText);

  if (Array.isArray(segments)) {
    for (const segment of segments) {
      if (!segment) {
        continue;
      }
      if (segment.type === 'text' && typeof segment.data?.text === 'string') {
        addPiece(segment.data.text);
        continue;
      }
      for (const candidate of collectCandidateStrings(segment.data, 2)) {
        addPiece(candidate);
      }
    }
  }

  const rawPayload = rawEvent?.metadata?.raw ?? rawEvent?.raw ?? rawEvent;
  for (const candidate of collectCandidateStrings(rawPayload, MAX_RAW_DEPTH)) {
    addPiece(candidate);
  }

  return Array.from(pieces).join(' ');
}

function collectCandidateStrings(value: unknown, maxDepth: number): string[] {
  const results: string[] = [];
  const visited = new WeakSet<object>();

  const pushCandidate = (text: string) => {
    if (!text) {
      return;
    }
    if (!LINK_HINT_REGEX.test(text)) {
      return;
    }
    results.push(text);
  };

  const walk = (node: unknown, depth: number) => {
    if (results.length >= MAX_CANDIDATE_TEXTS) {
      return;
    }
    if (node == null) {
      return;
    }
    if (typeof node === 'string') {
      pushCandidate(node);
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
      if (depth <= 0) {
        return;
      }
      for (const item of node) {
        walk(item, depth - 1);
        if (results.length >= MAX_CANDIDATE_TEXTS) {
          return;
        }
      }
      return;
    }

    if (depth <= 0) {
      return;
    }
    const record = node as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      const value = record[key];
      if (typeof value === 'string') {
        pushCandidate(value);
      } else {
        walk(value, depth - 1);
      }
      if (results.length >= MAX_CANDIDATE_TEXTS) {
        return;
      }
    }
  };

  walk(value, maxDepth);
  return results;
}

function extractLinkTargets(text: string): LinkTarget[] {
  const results: LinkTarget[] = [];

  for (const url of extractXhsUrlsFromText(text)) {
    results.push({ kind: 'xhs', url });
  }

  for (const url of extractBiliUrlsFromText(text)) {
    results.push({ kind: 'bili', url });
  }

  for (const id of extractBiliIdsFromText(text)) {
    results.push({ kind: 'bili-id', idType: id.idType, id: id.id });
  }

  return results;
}

function deduplicateLinkTargets(targets: LinkTarget[]): LinkTarget[] {
  const seen = new Set<string>();
  const results: LinkTarget[] = [];

  for (const target of targets) {
    const key =
      target.kind === 'bili-id'
        ? `${target.kind}:${target.idType}:${target.id}`
        : `${target.kind}:${target.url}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    results.push(target);
  }

  return results;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function resolvePlatform(event: any): 'qq' | 'tg' {
  return event?.platform === 'tg' || event?.platform === 'telegram' ? 'tg' : 'qq';
}

function canonicalizeUrlForDedup(url?: string): string {
  if (!url) {
    return '';
  }
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    parsed.search = '';
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return url;
  }
}

function extractXhsNoteId(url?: string): string {
  if (!url) {
    return '';
  }
  const match = url.match(/(?:discovery\/item|explore|exploration|notes)\/([0-9a-fA-F]{24})/);
  if (match?.[1]) {
    return match[1].toLowerCase();
  }
  try {
    const parsed = new URL(url);
    const candidate =
      parsed.searchParams.get('source_note_id')
      || parsed.searchParams.get('noteId')
      || parsed.searchParams.get('note_id');
    return candidate ? candidate.toLowerCase() : '';
  } catch {
    return '';
  }
}

function extractDigits(value?: string): string {
  if (!value) {
    return '';
  }
  return value.match(/\d+/g)?.join('') || '';
}

function shouldSkipSelfMessage(event: any): boolean {
  if (resolvePlatform(event) !== 'qq') {
    return false;
  }
  const raw = event?.raw ?? event?.message?.raw ?? event;
  const selfId = raw?.metadata?.raw?.self_id ?? raw?.raw?.self_id ?? raw?.self_id;
  if (!selfId) {
    return false;
  }
  const senderId = extractDigits(event?.sender?.userId ?? event?.sender?.id);
  return senderId !== '' && String(senderId) === String(selfId);
}

function extractShareMeta(event: any): { desc?: string; jumpUrl?: string } {
  const raw = event?.raw ?? event?.message?.raw ?? event;
  const rawPayload = raw?.metadata?.raw ?? raw?.raw ?? raw;
  const candidates: Array<Record<string, any>> = [];
  if (rawPayload && typeof rawPayload === 'object') {
    candidates.push(rawPayload as Record<string, any>);
  }
  const segments = Array.isArray(rawPayload?.message) ? rawPayload.message : [];
  for (const segment of segments) {
    if (!segment) {
      continue;
    }
    const data = segment?.data?.data;
    if (typeof data === 'string') {
      const parsed = safeJsonParse(data);
      if (parsed) {
        candidates.push(parsed);
      }
    }
  }
  if (typeof rawPayload?.raw_message === 'string') {
    const jsonText = extractJsonPayloadFromRawMessage(rawPayload.raw_message);
    if (jsonText) {
      const parsed = safeJsonParse(jsonText);
      if (parsed) {
        candidates.push(parsed);
      }
    }
  }
  let desc: string | undefined;
  let jumpUrl: string | undefined;
  for (const candidate of candidates) {
    desc = desc || findFirstStringByKeys(candidate, ['desc']);
    const nextJump = findFirstStringByKeys(candidate, ['jumpUrl']);
    if (!jumpUrl && nextJump && isLikelyXhsLink(nextJump)) {
      jumpUrl = nextJump;
    }
    if (desc && jumpUrl) {
      break;
    }
  }
  return {
    desc: desc?.trim() || undefined,
    jumpUrl: jumpUrl?.trim() || undefined,
  };
}

function isLikelyXhsLink(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return XHS_DOMAINS.some(domain => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

function findFirstStringByKeys(
  value: unknown,
  keys: string[],
  maxDepth = 5,
): string | undefined {
  if (!value || maxDepth < 0) {
    return undefined;
  }
  if (typeof value !== 'object') {
    return undefined;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstStringByKeys(item, keys, maxDepth - 1);
      if (found) {
        return found;
      }
    }
    return undefined;
  }
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    if (typeof record[key] === 'string') {
      return record[key] as string;
    }
  }
  for (const child of Object.values(record)) {
    const found = findFirstStringByKeys(child, keys, maxDepth - 1);
    if (found) {
      return found;
    }
  }
  return undefined;
}

function safeJsonParse(text: string): Record<string, any> | null {
  try {
    return JSON.parse(text) as Record<string, any>;
  } catch {
    return null;
  }
}

function extractJsonPayloadFromRawMessage(rawMessage: string): string | null {
  const start = rawMessage.indexOf('[CQ:json,');
  if (start === -1) {
    return null;
  }
  const dataIndex = rawMessage.indexOf('data=', start);
  if (dataIndex === -1) {
    return null;
  }
  const raw = rawMessage.slice(dataIndex + 5);
  const end = raw.lastIndexOf(']');
  const payload = end === -1 ? raw : raw.slice(0, end);
  const unescaped = payload
    .replace(/&#44;/g, ',')
    .replace(/&#91;/g, '[')
    .replace(/&#93;/g, ']')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
  return unescaped.trim();
}

function resolveChannelId(event: any): string {
  const platform = resolvePlatform(event);
  if (platform === 'qq') {
    const channelType = event?.channelType === 'private' ? 'private' : 'group';
    return `qq:${channelType}:${event.channelId}`;
  }
  return `tg:${event.channelId}`;
}

function summarizeString(value?: string, maxLength = 120): string | undefined {
  if (!value) {
    return value;
  }
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function summarizeSegments(segments: MessageSegment[]): Array<Record<string, unknown>> {
  return (segments || []).map((seg) => {
    if (!seg) {
      return { type: 'unknown' };
    }
    switch (seg.type) {
      case 'text':
        return { type: 'text', text: summarizeString(seg.data?.text, 200) };
      case 'image':
      case 'video':
      case 'audio':
      case 'file':
        {
          const file = seg.data?.file;
          const fileKind = Buffer.isBuffer(file) ? 'buffer' : typeof file;
          const fileSize = Buffer.isBuffer(file) ? file.length : undefined;
          const fileValue = typeof file === 'string' ? summarizeString(file, 160) : undefined;
          return {
            type: seg.type,
            url: summarizeString(seg.data?.url, 160),
            fileKind,
            fileSize,
            fileValue,
          };
        }
      case 'forward':
        return {
          type: 'forward',
          count: Array.isArray(seg.data?.messages) ? seg.data.messages.length : 0,
        };
      default:
        return { type: seg.type };
    }
  });
}

function summarizeForwardMessages(messages: ForwardMessage[]): Array<Record<string, unknown>> {
  return (messages || []).map((message) => ({
    userId: message?.userId,
    userName: message?.userName,
    segments: summarizeSegments(message?.segments || []),
  }));
}

async function sendForwardPreview(
  ctx: any,
  event: any,
  messages: ForwardMessage[],
  logger: PluginLogger,
): Promise<void> {
  if (!messages.length) {
    return;
  }

  const platform = resolvePlatform(event);
  const preparedMessages =
    platform === 'qq' ? await prepareForwardMessagesForQQ(messages) : messages;
  if (logger.enabled) {
    logger.info('LinkAnalysis forward preview', {
      platform,
      messageCount: preparedMessages.length,
      messages: summarizeForwardMessages(preparedMessages.slice(0, 4)),
    });
  }
  const channelId = resolveChannelId(event);
  const segments: MessageSegment[] = [
    { type: 'forward', data: { messages: preparedMessages } } as MessageSegment
  ];

  await ctx.message.send({
    instanceId: event.instanceId,
    channelId,
    threadId: event.threadId ?? undefined,
    content: segments,
  });
}

type PluginLogger = {
  enabled: boolean;
  info: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  debug: (...args: any[]) => void;
  error: (...args: any[]) => void;
};

function resolveLogEnabled(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) {
      return true;
    }
    if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) {
      return false;
    }
  }
  return defaultConfig.logEnabled;
}

function createPluginLogger(base: any, enabled: boolean): PluginLogger {
  const makeHandler = (method: 'info' | 'warn' | 'debug' | 'error') => {
    if (!enabled || typeof base?.[method] !== 'function') {
      return () => { };
    }
    return base[method].bind(base);
  };

  return {
    enabled,
    info: makeHandler('info'),
    warn: makeHandler('warn'),
    debug: makeHandler('debug'),
    error: makeHandler('error'),
  };
}
