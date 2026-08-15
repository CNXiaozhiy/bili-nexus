import { getLogger, notifyEmitter } from "@bili-nexus/core";
import { qqBotConfigManager } from "../../config";
import { OneBotMessageUtils } from "../../types/one-bot";
import { XzQBotError } from "../../client/xz-qbot";
import type XzQBot from "../../client/xz-qbot";

const logger = getLogger("QQBotNotifier:System");

/** 订阅全局通知事件（msg-warn / msg-error），转发给 superAdmin 私聊 */
export function installSystemNotifier(bot: XzQBot): void {
  notifyEmitter.on("msg-warn", (message) => {
    logger.info(`收到 notifyEmitter 警告通知，将通知 superAdmin`);
    const superAdmin = qqBotConfigManager.get("superAdmin");
    if (!superAdmin) {
      logger.error("未配置 superAdmin, 通知失败, 请尽快处理!");
      return;
    }
    const msg = `BiliNexus 警告通知⚠️\n\n时间: ${new Date().toISOString()}\n\n${message}`;
    bot.sendPrivate(superAdmin, [OneBotMessageUtils.Text(msg)]);
  });

  notifyEmitter.on("msg-error", (message, error) => {
    logger.info(`收到 notifyEmitter 致命错误⚠️，将通知 superAdmin`);
    if (error instanceof XzQBotError) {
      logger.error("🆘 错误为XzQBot错误，无法通过 QBot 通知，请尽快处理!");
      return;
    }
    const superAdmin = qqBotConfigManager.get("superAdmin");
    if (!superAdmin) {
      logger.error("未配置 superAdmin, 通知失败, 请尽快处理!");
      return;
    }
    const msg = `BiliNexus 致命错误🆘\n\n时间: ${new Date().toISOString()}\n\n${message}`;
    bot.sendPrivate(superAdmin, [OneBotMessageUtils.Text(msg)]);
  });
}
