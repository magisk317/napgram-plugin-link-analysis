import { pgSchema, serial, text, integer, bigint, boolean, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * 定义插件的数据库 schema
 * 
 * ⚠️ 重要规则：
 * 1. 此文件路径必须是 src/schema.ts
 * 2. 只能 import drizzle-orm 相关包，不能引用插件的其他文件
 * 3. 必须 export 所有表定义
 * 4. 建议使用独立的 schema namespace 避免冲突
 * 
 * 主项目构建时会自动扫描并复制此文件到数据库包中
 */

// 1. 定义独立的 schema namespace（避免与其他插件冲突）
export const myPluginSchema = pgSchema('my_plugin');

// 2. 定义表结构
export const users = myPluginSchema.table('my_plugin_users', {
    id: serial('id').primaryKey(),
    userId: text('userId').notNull(),
    username: text('username').notNull(),
    coins: integer('coins').default(0).notNull(),
    level: integer('level').default(1).notNull(),
    createdAt: timestamp('createdAt').defaultNow().notNull(),
    lastActiveAt: bigint('lastActiveAt', { mode: 'bigint' }),
}, (table) => ({
    // 定义索引
    uniqueUserId: uniqueIndex('my_plugin_users_userId_key').on(table.userId),
    idxUsername: index('my_plugin_users_username_idx').on(table.username),
}));

export const items = myPluginSchema.table('my_plugin_items', {
    id: serial('id').primaryKey(),
    userId: text('userId').notNull(),
    itemType: text('itemType').notNull(),
    quantity: integer('quantity').default(1).notNull(),
    acquiredAt: timestamp('acquiredAt').defaultNow().notNull(),
}, (table) => ({
    idxUserItem: index('my_plugin_items_userId_itemType_idx').on(table.userId, table.itemType),
}));

// 3. 导出类型（可选，用于插件代码中的类型提示）
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;
