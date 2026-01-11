import type { ForwardMessage, MessageSegment } from '@napgram/sdk';

export interface PreviewMetadata {
    title: string;
    author?: string;
    desc?: string;
    cover?: string;
    url: string;
    videoUrl?: string;
    images?: string[];
    footer?: string; // For stats like "播放 10万 赞 5000"
}

export function buildPreviewMessages(
    meta: PreviewMetadata,
    senderId: string,
    sourceName: string
): ForwardMessage[] {
    const messages: ForwardMessage[] = [];

    // 1. Cover Image (or first image)
    const coverUrl = meta.cover || (meta.images && meta.images.length > 0 ? meta.images[0] : undefined);
    if (coverUrl) {
        messages.push({
            userId: senderId,
            userName: sourceName,
            segments: [{ type: 'image', data: { url: coverUrl } } as MessageSegment],
        });
    }

    // 2. Text Info (Title, Author, Desc, Stats, Link)
    const textSegments: string[] = [];
    if (meta.title) textSegments.push(`标题：${meta.title}`);
    if (meta.author) textSegments.push(`作者：${meta.author}`);
    if (meta.desc) {
        // Simple truncation
        const maxLen = 100;
        const desc = meta.desc.length > maxLen ? meta.desc.slice(0, maxLen) + '...' : meta.desc;
        textSegments.push(`简介：${desc}`);
    }
    if (meta.footer) textSegments.push(meta.footer);
    if (meta.url) textSegments.push(`链接：${meta.url}`);

    if (textSegments.length > 0) {
        messages.push({
            userId: senderId,
            userName: sourceName,
            segments: [{ type: 'text', data: { text: textSegments.join('\n') } } as MessageSegment],
        });
    }

    // 3. Extra Images (if any, e.g. XHS)
    if (meta.images && meta.images.length > 1) {
        // Limit to 6 images total
        const extraImages = meta.images.slice(1, 6);
        for (const img of extraImages) {
            messages.push({
                userId: senderId,
                userName: sourceName,
                segments: [{ type: 'image', data: { url: img } } as MessageSegment],
            });
        }
    }

    // 4. Video (if available)
    if (meta.videoUrl) {
        messages.push({
            userId: senderId,
            userName: sourceName,
            segments: [{ type: 'video', data: { file: meta.videoUrl } } as MessageSegment],
        });
    }

    return messages;
}
