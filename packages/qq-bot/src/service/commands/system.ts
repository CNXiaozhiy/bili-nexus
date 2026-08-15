import {
  appConfigManager,
  getLogger,
  getVersion,
  SpaceDynamicRender,
} from "@bili-nexus/core";
import { qqBotConfigManager } from "../../config";
import { auth } from "../auth";
import { AuthError } from "../context";
import type { CommandContext, CommandProcessors, ProcessorContext } from "../context";
import type { MessageEvent } from "../../types/one-bot";
import { SubscriptionQuery } from "../subscription/store";

const logger = getLogger("QQBotCommands:System");

/** 系统/服务控制类命令（全局处理器） */
export function registerSystemCommands(processors: CommandProcessors, ctx: CommandContext): void {
  const { global } = processors;

  global.register(".bn.room", async (_args, context: ProcessorContext<MessageEvent>) => {
    if (!auth(context.event.user_id, 1)) throw new AuthError("权限不足");
    const liveRoomsConfig = qqBotConfigManager.get("liveRoom");
    const query = new SubscriptionQuery(liveRoomsConfig);
    const rooms = query.getSubscriptions();

    if (rooms.length == 0) {
      return "暂无订阅";
    }
    return rooms.join(", ");
  });

  global.register(".bn.stop", async (_args, context: ProcessorContext<MessageEvent>) => {
    if (!auth(context.event.user_id, 20)) throw new AuthError("权限不足");

    logger.warn("程序即将结束");

    ctx.liveAutomationManager
      .forceStopRecordAll()
      .then(() => {
        context.reply("所有任务已结束，程序已停止");
        process.exit(0);
      })
      .catch(() => {
        context.reply("所有任务结束失败，程序已停止");
        process.exit(0);
      });

    return "正在结束所有录制任务";
  });

  global.register(".bn.sf", async (_args, context: ProcessorContext<MessageEvent>) => {
    if (!auth(context.event.user_id, 10)) throw new AuthError("权限不足");

    ctx.subscribeFree.enable(() => {
      if (ctx.liveAutomationManager.getLiveRecorders().size === 0) {
        ctx.subscribeFree.disable();
        context.reply("BN-Subscribe-Free 状态空闲");
      }
    });

    logger.debug("BN-Subscribe-Free 已启用");
    return "BN-Subscribe-Free 已启用";
  });

  global.register(".bn", async () => {
    const mainServerHealth = true;
    const spaceDynamicRenderHealth = await SpaceDynamicRender.health(appConfigManager.get("dynamicRender"));

    // 获取内存使用情况
    const memoryUsage = process.memoryUsage();
    const rss = (memoryUsage.rss / 1024 / 1024).toFixed(2);
    const heapUsed = (memoryUsage.heapUsed / 1024 / 1024).toFixed(2);
    const heapTotal = (memoryUsage.heapTotal / 1024 / 1024).toFixed(2);
    const external = (memoryUsage.external / 1024 / 1024).toFixed(2);

    return (
      `BiliNexus 服务状态\n\n` +
      `⚙️ 主服务: ${mainServerHealth ? "正常✅" : "异常❌"}\n` +
      `⚙️ 动态渲染服务: ${spaceDynamicRenderHealth ? "正常✅" : "异常❌"}\n` +
      `\n📊 内存使用情况:\n` +
      `  💾 RSS: ${rss} MB\n` +
      `  📦 堆内存: ${heapUsed} / ${heapTotal} MB\n` +
      `  🔗 外部内存: ${external} MB\n` +
      `\nPowered by BN v${getVersion()}`
    );
  });
}
