import {
  definePlugin,
  type ForwardMessage,
  type MessageSegment,
  prepareForwardMessagesForQQ,
} from '@napgram/sdk';
import {
  extractXhsUrlsFromText,
  fetchXhsNote,
  buildForwardMessagesForXhs,
} from './xhs';
import {
  extractBiliUrlsFromText,
  extractBiliIdsFromText,
  fetchBiliVideoFromUrl,
  fetchBiliVideoFromId,
  buildForwardMessagesForBili,
} from './bili';

type LinkTarget =
  | { kind: 'xhs'; url: string }
  | { kind: 'bili'; url: string }
  | { kind: 'bili-id'; idType: 'bv' | 'av'; id: string };

const MAX_URLS = 5;

// 内存缓存：存储最近解析的链接和时间戳
const recentlyParsed = new Map<string, number>();
const CACHE_DURATION_MS = 60 * 1000; // 1分钟

const plugin = definePlugin({
  id: 'link-analysis',
  name: 'Link Analysis (XHS/Bilibili)',
  version: '0.1.0',
  author: 'NapLink',
  description: 'Parse Xiaohongshu and Bilibili share links and render a quick preview.',
  async install(ctx) {
    ctx.logger.info('Link analysis plugin installed');

    // 定期清理过期缓存
    const cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, timestamp] of recentlyParsed.entries()) {
        if (now - timestamp > CACHE_DURATION_MS) {
          recentlyParsed.delete(key);
        }
      }
    }, 30 * 1000); // 每30秒清理一次

    ctx.on('message', async (event) => {
      const text = extractText(event.message.text, event.message.segments, event.raw);
      if (!text) {
        return;
      }

      const targets = extractLinkTargets(text);
      if (!targets.length) {
        return;
      }

      const uniqueTargets = deduplicateLinkTargets(targets).slice(0, MAX_URLS);
      
      // 过滤掉最近1分钟内已解析的链接
      const now = Date.now();
      const targetsToProcess = uniqueTargets.filter((target) => {
        const cacheKey = getCacheKey(target);
        const lastParsed = recentlyParsed.get(cacheKey);
        if (lastParsed && now - lastParsed < CACHE_DURATION_MS) {
          ctx.logger.debug(`Skipping recently parsed link: ${cacheKey}`);
          return false;
        }
        return true;
      });

      if (!targetsToProcess.length) {
        ctx.logger.debug('All links were recently parsed, skipping');
        return;
      }

      const forwardMessages: ForwardMessage[] = [];

      for (const target of targetsToProcess) {
        const cacheKey = getCacheKey(target);
        
        if (target.kind === 'xhs') {
          try {
            const note = await fetchXhsNote(target.url);
            forwardMessages.push(...buildForwardMessagesForXhs(note, event.sender.userId));
            recentlyParsed.set(cacheKey, now);
          } catch (error) {
            ctx.logger.warn(`XHS parse failed: ${formatError(error)}`);
          }
          continue;
        }

        try {
          const video =
            target.kind === 'bili'
              ? await fetchBiliVideoFromUrl(target.url)
              : await fetchBiliVideoFromId(target.idType, target.id);
          if (video) {
            forwardMessages.push(...buildForwardMessagesForBili(video, event.sender.userId));
            recentlyParsed.set(cacheKey, now);
          }
        } catch (error) {
          ctx.logger.warn(`Bilibili parse failed: ${formatError(error)}`);
        }
      }

      if (!forwardMessages.length) {
        return;
      }

      await sendForwardPreview(ctx, event, forwardMessages);
    });

    ctx.onUnload(() => {
      clearInterval(cleanupInterval);
      ctx.logger.info('Link analysis plugin unloaded');
    });
  },
});

export default plugin;

function getCacheKey(target: LinkTarget): string {
  if (target.kind === 'bili-id') {
    return `${target.kind}:${target.idType}:${target.id}`;
  }
  return `${target.kind}:${target.url}`;
}


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

function resolveChannelId(event: any): string {
  const platform = resolvePlatform(event);
  if (platform === 'qq') {
    const channelType = event?.channelType === 'private' ? 'private' : 'group';
    return `qq:${channelType}:${event.channelId}`;
  }
  return `tg:${event.channelId}`;
}

async function sendForwardPreview(ctx: any, event: any, messages: ForwardMessage[]): Promise<void> {
  if (!messages.length) {
    return;
  }

  const platform = resolvePlatform(event);
  const preparedMessages =
    platform === 'qq' ? await prepareForwardMessagesForQQ(messages) : messages;
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
