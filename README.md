# napgram-plugin-template

NapGram 原生插件模板仓库（可作为 GitHub **Template repository** 使用）。

这是 **NapGram 原生插件** 模板：插件直接运行在 NapGram 进程内，通过原生 API 访问平台功能。

## 特点

- ✅ **原生集成** - 直接运行在 NapGram 进程内，无需独立进程
- ✅ **类型安全** - 内置最小 TypeScript 类型，开箱即用
- ✅ **高性能** - 内存级事件通信，零延迟
- ✅ **简单易用** - 清晰的 API，开箱即用

## 快速开始

### 0) 使用模板创建仓库

1. 打开本仓库，点击 **Use this template** 创建新仓库
2. 克隆新仓库到本地
3. 修改 `napgram-plugin.json`（id/name/description/permissions）
4. 修改 `package.json`（name/version/description）

### 1) 安装依赖

```bash
pnpm install
```

### 2) 开发插件

编辑 `src/index.ts`，实现你的插件逻辑：

```typescript
import { definePlugin } from '@napgram/sdk';

const plugin = definePlugin({
  id: 'my-plugin',
  name: 'My Plugin',
  version: '1.0.0',
  
  async install(ctx) {
    ctx.on('message', async (event) => {
      if (event.message.text === 'ping') await event.reply('pong');
    });
  }
});

export default plugin;
```

> 注：模板内包含 `src/types/@napgram/sdk/index.d.ts` 的最小类型声明，便于离线开发与通过 CI；构建产物不会包含该声明。平台运行时已内置 `@napgram/sdk`，插件可直接 `import { definePlugin } from '@napgram/sdk'`。

### 3) 构建

```bash
pnpm build
```

### 3.1) 本地安装（可选）

将构建产物安装到 NapGram 的 data 目录（无需改 `plugins.yaml`）：

```bash
./scripts/install-local.sh /path/to/napgram/data
```

重载方式（二选一）：

- 重启 NapGram
- `POST /api/admin/plugins/reload`（全量重载）或 `POST /api/admin/plugins/:id/reload`（单插件重载）

### 4) 打包发布

```bash
# 打包为 zip
pnpm pack:zip

# 打包为 tgz
pnpm pack:tgz

# 生成 marketplace 索引片段
pnpm marketplace:snippet
```

产物位于 `release/` 目录。

## 插件 API

### 核心接口

- **PluginContext** - 插件上下文，提供所有 API
- **MessageEvent** - 消息事件
- **MessageAPI** - 发送/撤回消息
- **InstanceAPI** - 实例管理
- **UserAPI** - 用户信息
- **GroupAPI** - 群组管理
- **PluginStorage** - 数据存储
- **PluginLogger** - 日志记录

### 事件监听

```typescript
ctx.on('message', async (event) => {
  // 处理消息
});

ctx.on('friend-request', async (event) => {
  // 处理好友请求
});
```

### 消息发送

```typescript
// 回复消息
await event.reply('Hello!');

// 发送消息
await event.send([
  { type: 'text', data: { text: 'Hello ' } },
  { type: 'at', data: { userId: 'user123' } }
]);
```

### 数据存储

```typescript
// 保存数据
await ctx.storage.set('key', { data: 'value' });

// 读取数据
const data = await ctx.storage.get('key');

// 删除数据
await ctx.storage.delete('key');
```

### 数据库 Schema（可选）

如果需要使用数据库存储结构化数据，在 `src/schema.ts` 中定义 Drizzle ORM schema：

```typescript
import { pgSchema, serial, text, integer } from 'drizzle-orm/pg-core';

export const mySchema = pgSchema('my_plugin');

export const users = mySchema.table('my_plugin_users', {
    id: serial('id').primaryKey(),
    userId: text('userId').notNull(),
    coins: integer('coins').default(0).notNull(),
});
```

在插件中使用：

```typescript
import { users } from './schema';
import { eq } from 'drizzle-orm';

// 查询
const user = await ctx.database.select()
    .from(users)
    .where(eq(users.userId, 'user123'))
    .limit(1);

// 插入
await ctx.database.insert(users).values({
    userId: 'user123',
    coins: 100,
});
```

详见 [`docs/DATABASE_SCHEMA.md`](docs/DATABASE_SCHEMA.md)。

### 日志记录

```typescript
ctx.logger.info('插件已启动');
ctx.logger.debug('调试信息');
ctx.logger.warn('警告信息');
ctx.logger.error('错误信息');
```

## 权限声明

在 `napgram-plugin.json` 中声明插件权限：

```json
{
  "permissions": {
    "instances": [0],        // 可访问的实例（按需填写）
    "network": [],           // 网络访问 allowlist（默认空 = 不申请）
    "fs": []                 // 文件系统访问（默认空 = 不申请）
  }
}
```

## 目录结构

```
napgram-plugin-template/
├── src/
│   ├── index.ts              # 插件主文件
│   ├── schema.ts             # 数据库 schema（可选）
│   └── types/                # 内置类型声明（仅用于开发）
├── docs/
│   └── DATABASE_SCHEMA.md    # 数据库 schema 开发指南
├── scripts/
│   ├── pack.mjs              # 打包脚本
│   ├── marketplace-snippet.mjs
│   └── marketplace-upsert.mjs
├── napgram-plugin.json       # 插件元信息
├── package.json
├── tsconfig.json
└── README.md
```

## 发布到 Marketplace

1. 打包插件：`pnpm pack:zip`
2. 上传到 GitHub Release 或 CDN
3. 生成索引片段：`pnpm marketplace:snippet`
4. 提交 PR 到 NapGram Marketplace 仓库

### 自动化发布（推荐）

推送 tag 后 Release workflow 会自动：
1. 打包产物并生成 `marketplace-index-snippet.json`
2. 若配置了 `MARKETPLACE_PR_TOKEN`，自动向 **NapGram/marketplace** 提交 PR（请关注 `https://github.com/NapGram/marketplace/pulls`）

需要在**实际插件仓库**配置以下 Secrets：
- `NPM_TOKEN`：npm automation token（用于 publish）
- `MARKETPLACE_PR_TOKEN`：GitHub PAT（需要 **repo** + **workflow** 权限）

`MARKETPLACE_PR_TOKEN` 权限建议（fine-grained）：
- Repository access：选择你的插件仓库
- Permissions：Contents（read/write）、Pull requests（read/write）、Workflows（read/write）

可选配置：
- `MARKETPLACE_DIST_HOST`：自定义资源下载域名，未设置时默认使用 GitHub Release 下载链接

## 示例插件

查看 `src/index.ts` 中的 Ping Pong 插件示例。

## License

MIT
