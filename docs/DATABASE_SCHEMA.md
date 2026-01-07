# 数据库 Schema 开发指南

## 📋 概述

如果你的插件需要存储数据到数据库，需要在 `src/schema.ts` 中定义 Drizzle ORM schema。主项目构建时会自动扫描并集成你的 schema。

## 🚀 快速开始

### 1. 创建 Schema 文件

将 `src/schema.example.ts` 复制为 `src/schema.ts`：

```bash
cp src/schema.example.ts src/schema.ts
```

### 2. 定义你的表结构

```typescript
import { pgSchema, serial, text, integer } from 'drizzle-orm/pg-core';

// 使用独立的 schema namespace
export const myPluginSchema = pgSchema('my_plugin');

// 定义表
export const users = myPluginSchema.table('my_plugin_users', {
    id: serial('id').primaryKey(),
    userId: text('userId').notNull(),
    coins: integer('coins').default(0).notNull(),
});
```

### 3. 在插件中使用

```typescript
import { definePlugin } from '@napgram/sdk';
import { users } from './schema';
import { eq } from 'drizzle-orm';

const plugin = definePlugin({
    async install(ctx) {
        // 使用 ctx.database 访问数据库
        const db = ctx.database;
        
        ctx.on('message', async (event) => {
            const userId = event.sender.userId;
            
            // 查询用户
            const user = await db.select()
                .from(users)
                .where(eq(users.userId, userId))
                .limit(1);
            
            if (user.length === 0) {
                // 创建新用户
                await db.insert(users).values({
                    userId,
                    coins: 100,
                });
                await event.reply('欢迎新用户！获得 100 金币');
            } else {
                await event.reply(`你有 ${user[0].coins} 金币`);
            }
        });
    }
});
```

## ⚠️ 重要规则

### 1. 文件路径

**必须**是 `src/schema.ts`，不能是其他路径。

```
✅ src/schema.ts
❌ src/db/schema.ts
❌ src/schemas.ts
```

### 2. 只能 Import Drizzle ORM

Schema 文件会被复制到主项目，**不能引用插件的其他文件**。

```typescript
// ✅ 允许
import { pgSchema, serial, text } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ❌ 禁止
import { MyType } from './types';  // 会在主项目中找不到
import config from './config';     // 不可用
```

### 3. 使用独立的 Schema Namespace

避免与其他插件的表名冲突。

```typescript
// ✅ 推荐：使用独立 namespace
export const myPluginSchema = pgSchema('my_plugin');
export const users = myPluginSchema.table('my_plugin_users', { ... });

// ❌ 不推荐：使用 public schema（可能冲突）
export const users = pgTable('users', { ... });
```

### 4. 表名约定

建议使用 `{plugin_name}_{table_name}` 格式。

```typescript
// ✅ 清晰的表名
export const users = myPluginSchema.table('my_plugin_users', { ... });
export const items = myPluginSchema.table('my_plugin_items', { ... });

// ❌ 容易冲突
export const users = myPluginSchema.table('users', { ... });
```

## 📊 Schema 同步流程

### 开发阶段

1. **插件开发者：** 在 `src/schema.ts` 中定义表
2. **本地开发：** 直接在插件代码中使用
3. **提交代码：** 将 `src/schema.ts` 提交到插件仓库

### 集成到主项目

当主项目构建时：

```bash
# 主项目执行
pnpm --filter @napgram/database db:generate

# 内部流程：
# 1. 运行 db:sync 脚本
#    → 扫描 ../../../packages/napgram-plugin-* 目录
#    → 查找每个插件的 src/schema.ts
#    → 复制到 packages/database/src/schema/plugins/
#
# 2. 运行 drizzle-kit generate
#    → 基于合并后的 schema 生成 SQL 迁移文件
#    → 输出到 packages/database/drizzle/
```

### 部署阶段

```bash
# 应用数据库迁移
pnpm --filter @napgram/database db:migrate

# 你的表会被自动创建 ✅
```

## 🎯 完整示例

### schema.ts

```typescript
import { pgSchema, serial, text, integer, bigint, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const economySchema = pgSchema('economy');

// 用户表
export const players = economySchema.table('economy_players', {
    id: serial('id').primaryKey(),
    userId: text('userId').notNull(),
    nickname: text('nickname').notNull(),
    balance: integer('balance').default(0).notNull(),
    level: integer('level').default(1).notNull(),
    exp: integer('exp').default(0).notNull(),
    lastLoginAt: bigint('lastLoginAt', { mode: 'bigint' }),
    createdAt: timestamp('createdAt').defaultNow().notNull(),
}, (t) => ({
    uniqueUserId: uniqueIndex('economy_players_userId_key').on(t.userId),
    idxLevel: index('economy_players_level_idx').on(t.level),
}));

// 物品表
export const items = economySchema.table('economy_items', {
    id: serial('id').primaryKey(),
    userId: text('userId').notNull(),
    itemId: text('itemId').notNull(),
    quantity: integer('quantity').default(1).notNull(),
    metadata: text('metadata'), // JSON string
    acquiredAt: timestamp('acquiredAt').defaultNow().notNull(),
}, (t) => ({
    idxUserItem: index('economy_items_userId_itemId_idx').on(t.userId, t.itemId),
}));

// 定义关系（可选）
export const playersRelations = relations(players, ({ many }) => ({
    items: many(items),
}));

export const itemsRelations = relations(items, ({ one }) => ({
    player: one(players, {
        fields: [items.userId],
        references: [players.userId],
    }),
}));

// 导出类型
export type Player = typeof players.$inferSelect;
export type NewPlayer = typeof players.$inferInsert;
export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;
```

### index.ts（插件主文件）

```typescript
import { definePlugin } from '@napgram/sdk';
import { players, items, type Player, type Item } from './schema';
import { eq, and } from 'drizzle-orm';

const plugin = definePlugin({
    id: 'economy-game',
    name: 'Economy Game',
    version: '1.0.0',
    
    async install(ctx) {
        const db = ctx.database;
        
        // 注册玩家
        ctx.command('register', async (event) => {
            const userId = event.sender.userId;
            const nickname = event.sender.userName || 'Player';
            
            // 检查是否已注册
            const existing = await db.select()
                .from(players)
                .where(eq(players.userId, userId))
                .limit(1);
            
            if (existing.length > 0) {
                await event.reply('你已经注册过了！');
                return;
            }
            
            // 创建新玩家
            await db.insert(players).values({
                userId,
                nickname,
                balance: 100,
                level: 1,
                exp: 0,
                lastLoginAt: BigInt(Date.now()),
            });
            
            await event.reply(`欢迎 ${nickname}！获得 100 金币`);
        });
        
        // 查询余额
        ctx.command('balance', async (event) => {
            const userId = event.sender.userId;
            
            const user = await db.select()
                .from(players)
                .where(eq(players.userId, userId))
                .limit(1);
            
            if (user.length === 0) {
                await event.reply('请先注册！发送 register');
                return;
            }
            
            await event.reply(`💰 你的余额: ${user[0].balance} 金币`);
        });
        
        // 购买物品
        ctx.command('buy', async (event, itemId: string) => {
            const userId = event.sender.userId;
            const price = 50;
            
            // 在事务中执行
            await db.transaction(async (tx) => {
                // 扣除金币
                const user = await tx.select()
                    .from(players)
                    .where(eq(players.userId, userId))
                    .limit(1);
                
                if (user.length === 0 || user[0].balance < price) {
                    throw new Error('金币不足');
                }
                
                await tx.update(players)
                    .set({ balance: user[0].balance - price })
                    .where(eq(players.userId, userId));
                
                // 添加物品
                await tx.insert(items).values({
                    userId,
                    itemId,
                    quantity: 1,
                });
            });
            
            await event.reply(`✅ 购买成功！花费 ${price} 金币`);
        });
    }
});

export default plugin;
```

## 🔧 常用 Drizzle 操作

### 查询

```typescript
// 查询所有
const allUsers = await db.select().from(users);

// 条件查询
const user = await db.select()
    .from(users)
    .where(eq(users.userId, 'user123'))
    .limit(1);

// 多条件
const result = await db.select()
    .from(users)
    .where(and(
        eq(users.level, 5),
        gte(users.coins, 100)
    ));

// 排序
const topUsers = await db.select()
    .from(users)
    .orderBy(desc(users.coins))
    .limit(10);
```

### 插入

```typescript
// 插入单条
await db.insert(users).values({
    userId: 'user123',
    username: 'Alice',
    coins: 100,
});

// 插入多条
await db.insert(users).values([
    { userId: 'user1', username: 'Alice' },
    { userId: 'user2', username: 'Bob' },
]);

// 返回插入的数据
const [newUser] = await db.insert(users)
    .values({ userId: 'user123' })
    .returning();
```

### 更新

```typescript
// 更新
await db.update(users)
    .set({ coins: 200 })
    .where(eq(users.userId, 'user123'));

// SQL 表达式
await db.update(users)
    .set({ coins: sql`${users.coins} + 10` })
    .where(eq(users.userId, 'user123'));
```

### 删除

```typescript
await db.delete(users)
    .where(eq(users.userId, 'user123'));
```

### 事务

```typescript
await db.transaction(async (tx) => {
    // 所有操作在同一事务中
    await tx.update(users).set({ coins: 100 }).where(...);
    await tx.insert(items).values({ ... });
    // 如果任何操作失败，会自动回滚
});
```

## 📚 更多资源

- [Drizzle ORM 官方文档](https://orm.drizzle.team/)
- [PostgreSQL Column Types](https://orm.drizzle.team/docs/column-types/pg)
- [Drizzle Queries](https://orm.drizzle.team/docs/rqb)

## ❓ 常见问题

### Q: 如何测试 schema？

A: 在本地 NapGram 环境测试：

```bash
# 1. 构建插件
pnpm build

# 2. 安装到本地 NapGram
./scripts/install-local.sh /path/to/napgram/data

# 3. 在 NapGram 主项目生成迁移
cd /path/to/napgram
pnpm --filter @napgram/database db:generate

# 4. 应用迁移
pnpm --filter @napgram/database db:push

# 5. 重启 NapGram
```

### Q: 如何修改已有的表结构？

A: 直接修改 `src/schema.ts`，主项目会自动生成新的迁移文件。

```typescript
// 添加新字段
export const users = myPluginSchema.table('my_plugin_users', {
    id: serial('id').primaryKey(),
    userId: text('userId').notNull(),
    coins: integer('coins').default(0).notNull(),
    vipLevel: integer('vipLevel').default(0).notNull(), // ← 新增
});
```

### Q: 如何在插件间共享数据？

A: 不推荐。每个插件应该维护自己的表。如果确实需要，可以：
1. 使用 public schema（注意冲突）
2. 通过插件间通信 API
3. 使用 NapGram 提供的共享存储

### Q: 支持其他数据库吗？

A: 目前只支持 PostgreSQL。未来可能支持 SQLite、MySQL 等。
