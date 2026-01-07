import { definePlugin } from '@napgram/sdk';

/**
 * Ping Pong 插件
 *
 * 原生 NapGram 插件示例：收到 "ping" 回复 "pong"
 */
const plugin = definePlugin({
  // 插件元信息
  id: 'ping-pong',
  name: 'Ping Pong Plugin (Template)',
  version: '0.1.0',
  author: 'NapLink',
  description: 'A native NapGram plugin example that replies pong to ping.',

  // 权限声明
  permissions: {
    instances: [0], // 访问实例 0
  },

  // 插件安装
  async install(ctx) {
    ctx.logger.info('Ping Pong plugin installed');

    // 监听消息事件
    ctx.on('message', async (event) => {
      const text = (event.message.text || '').toLowerCase().trim();

      // 匹配 "ping" 或 "/ping"
      if (text === 'ping' || text === '/ping') {
        // 回复消息
        await event.reply('pong');

        ctx.logger.info(`Replied to ${event.sender.userName} in ${event.channelId}`);
      }
    });

    // 注册卸载钩子
    ctx.onUnload(() => {
      ctx.logger.info('Ping Pong plugin unloaded');
    });
  },
});

// 导出插件（默认导出）
export default plugin;
