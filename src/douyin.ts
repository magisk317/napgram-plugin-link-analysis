import type { ForwardMessage, MessageSegment } from '@napgram/sdk';

export type DouyinVideo = {
    title: string;
    author: string;
    cover: string;
    videoUrl: string;
    desc: string;
    duration?: number; // milliseconds
    dataSize?: number; // bytes
    diggCount?: number;
    shareCount?: number;
    commentCount?: number;
    collectCount?: number;
};


// 正则表达式匹配抖音链接
// 适配原插件逻辑: https?:\/\/(?:www.?)?(douyin.com\/video\/|v.douyin.com\/|iesdouyin.com\/share\/video\/)[^\s]+
const DOUYIN_REGEX = /https?:\/\/(?:www\.)?(douyin\.com\/video\/|v\.douyin\.com\/|iesdouyin\.com\/share\/video\/)[^\s]+/g;

// Simple User-Agent to avoid some blocks
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export function extractDouyinUrlsFromText(text: string): string[] {
    if (!text) return [];
    const matches = text.match(DOUYIN_REGEX);
    return matches ? Array.from(new Set(matches)) : [];
}

export async function fetchDouyinVideo(url: string): Promise<DouyinVideo | null> {
    const apiUrl = `https://apis.jxcxin.cn/api/douyin?url=${encodeURIComponent(url)}`;
    try {
        const response = await fetch(apiUrl, {
            headers: {
                'User-Agent': USER_AGENT,
            }
        });
        if (!response.ok) {
            throw new Error(`API request failed: ${response.status} ${response.statusText}`);
        }
        const data = await response.json();

        if (data.code === 200 && data.data) {
            const info = data.data;
            return {
                title: info.title || '无标题',
                author: info.author || '未知作者',
                cover: info.cover,
                videoUrl: info.url,
                desc: info.title || undefined,
                duration: 0,
                diggCount: info.like || 0,
                shareCount: 0,
                commentCount: 0,
                collectCount: 0,
            }
        }
        console.warn(`Douyin API returned code ${data.code}: ${data.msg}`);
        return null;

    } catch (error) {
        console.error(`Error fetching Douyin video [${url}]:`, error);
        throw error;
    }
}

import { buildPreviewMessages, type PreviewMetadata } from './common.js';

export function buildForwardMessagesForDouyin(video: DouyinVideo, senderId: string): ForwardMessage[] {
    const meta: PreviewMetadata = {
        title: video.title,
        author: video.author,
        cover: video.cover,
        url: video.videoUrl, // Use video URL as the primary link? Or should we use original URL? 
        // Logic: videoUrl is the direct link to MP4 usually. 
        // The original share link is what user sent.
        // Let's stick to videoUrl or maybe we should pass original URL if we had it.
        // But DouyinVideo doesn't have original URL field currently.
        videoUrl: video.videoUrl,
        desc: video.desc,
        footer: video.duration ? `时长: ${video.duration}ms` : undefined, // Add more stats if available
    };

    return buildPreviewMessages(meta, senderId, '抖音解析');
}
