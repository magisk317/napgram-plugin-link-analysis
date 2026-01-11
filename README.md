# napgram-plugin-link-analysis

[NapGram](https://github.com/NapGram/NapGram) 原生插件：链接解析与预览（支持小红书 / B 站）。

自动识别消息中的小红书与 B 站链接，抓取标题/简介/封面并生成预览消息。

## 功能特点

- ✅ **小红书链接解析** - 支持 xiaohongshu.com、xhslink.com 等域名
- ✅ **B站链接解析** - 支持 bilibili.com、b23.tv 等短链接
- ✅ **BV/AV号识别** - 自动识别文本中的 BV/AV 号
- ✅ **智能缓存** - 同一分钟内相同链接不重复解析
- ✅ **批量解析** - 单条消息最多解析 5 个链接
- ✅ **安全防护** - 内置 SSRF 防护和私有地址过滤

## 使用方法

安装插件后，直接在群聊或私聊中发送包含以下内容的消息：

### 小红书
- 完整链接：`https://www.xiaohongshu.com/explore/...`
- 短链接：`https://xhslink.com/...`

### B站
- 视频链接：`https://www.bilibili.com/video/BV...` 或 `https://www.bilibili.com/video/av...`
- 短链接：`https://b23.tv/...`
- BV号：直接发送 `BV1xx...` 格式的 BV 号
- AV号：直接发送 `av123456` 格式的 AV 号

插件会自动识别并返回包含标题、简介、封面图的预览消息。

## 开发

### 安装依赖

```bash
pnpm install
```

### 构建

```bash
pnpm build
```

### 本地安装

```bash
./scripts/install-local.sh /path/to/napgram/data
```

### 打包发布

```bash
# 打包为 zip
pnpm pack:zip

# 打包为 tgz
pnpm pack:tgz
```

## 技术实现

### 解析流程

1. 监听消息事件
2. 提取消息中的链接和 BV/AV 号
3. 检查缓存（1分钟有效期）
4. 请求目标网站获取数据
5. 解析 HTML/JSON 提取信息
6. 构建转发消息并发送
7. 更新缓存

### 项目结构

```
src/
├── index.ts    # 主插件文件，事件监听和缓存管理
├── xhs.ts      # 小红书解析模块
└── bili.ts     # B站解析模块
```

## License

MIT
