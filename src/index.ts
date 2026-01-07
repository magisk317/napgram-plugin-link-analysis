import { definePlugin, type ForwardMessage } from '@napgram/sdk';
import {
  XHS_DOMAINS,
  extractXhsUrlsFromText,
  fetchXhsNote,
  buildForwardMessagesForXhs,
} from './xhs';
import {
  BILI_DOMAINS,
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
const NETWORK_ALLOWLIST = Array.from(
  new Set([...XHS_DOMAINS, ...BILI_DOMAINS, 'api.bilibili.com'])
) as string[];

// 内存缓存：存储最近解析的链接和时间戳
const recentlyParsed = new Map<string, number>();
const CACHE_DURATION_MS = 60 * 1000; // 1分钟

const plugin = definePlugin({
  id: 'link-analysis',
  name: 'Link Analysis (XHS/Bilibili)',
  version: '0.1.0',
  author: 'NapLink',
  description: 'Parse Xiaohongshu and Bilibili share links and render a quick preview.',
  permissions: {
    instances: [0],
    network: NETWORK_ALLOWLIST,
  },
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
      const text = extractText(event.message.text, event.message.segments);
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

      await event.reply([{ type: 'forward', data: { messages: forwardMessages } }]);
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


function extractText(rawText?: string, segments?: Array<any>): string {
  if (rawText && rawText.trim()) {
    return rawText.trim();
  }

  if (!Array.isArray(segments)) {
    return '';
  }

  const pieces = segments
    .filter((segment) => segment?.type === 'text' && typeof segment.data?.text === 'string')
    .map((segment) => segment.data.text.trim())
    .filter(Boolean);

  return pieces.join(' ');
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
