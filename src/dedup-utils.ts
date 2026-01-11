/**
 * 去重工具函数
 * 提供链接去重相关的核心逻辑
 */

// 内存缓存：存储最近解析的链接和时间戳
const recentlyParsed = new Map<string, number>();
const CACHE_DURATION_MS = 60 * 1000; // 1分钟

/**
 * 原子去重检查：检查并标记链接为已处理
 * 
 * @param cacheKeys - 缓存键数组
 * @returns 如果链接已处理返回true，否则返回false并标记为已处理
 */
export function checkAndMarkParsed(cacheKeys: string[]): boolean {
    const now = Date.now();

    // 检查是否最近已解析
    for (const key of cacheKeys) {
        const lastParsed = recentlyParsed.get(key);
        if (typeof lastParsed === 'number' && now - lastParsed < CACHE_DURATION_MS) {
            return true; // 已处理，跳过
        }
    }

    // 标记为已处理
    for (const key of cacheKeys) {
        recentlyParsed.set(key, now);
    }

    return false; // 未处理，已标记
}

/**
 * 批次内去重检查：使用Set检查是否在当前批次内已见过
 * 
 * @param canonicalKey - 规范化的去重键
 * @param seenSet - 当前批次已见过的键集合
 * @returns 如果已见过返回true，否则返回false并添加到集合
 */
export function checkAndAddToSeen(
    canonicalKey: string | undefined,
    seenSet: Set<string>,
): boolean {
    if (!canonicalKey) {
        return false;
    }

    if (seenSet.has(canonicalKey)) {
        return true; // 已见过
    }

    seenSet.add(canonicalKey);
    return false; // 未见过，已添加
}

/**
 * 标记链接为已处理
 * 
 * @param keys - 缓存键数组
 */
export function markRecentlyParsed(keys: string[]): void {
    const now = Date.now();
    for (const key of keys) {
        recentlyParsed.set(key, now);
    }
}

/**
 * 检查是否最近已解析
 * 
 * @param keys - 缓存键数组
 * @returns 如果任一键在缓存时间内被解析过返回true
 */
export function isRecentlyParsed(keys: string[]): boolean {
    const now = Date.now();
    for (const key of keys) {
        const lastParsed = recentlyParsed.get(key);
        if (typeof lastParsed === 'number' && now - lastParsed < CACHE_DURATION_MS) {
            return true;
        }
    }
    return false;
}

// 清理过期缓存 (可选，避免内存泄漏)
setInterval(() => {
    const now = Date.now();
    for (const [key, time] of recentlyParsed.entries()) {
        if (now - time > CACHE_DURATION_MS * 2) {
            recentlyParsed.delete(key);
        }
    }
}, CACHE_DURATION_MS * 5);
