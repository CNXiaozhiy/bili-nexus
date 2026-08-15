/**
 * @bili-nexus/qq-bot — QQ 机器人适配器。
 *
 * 依赖方向：qq-bot 依赖 @bili-nexus/core（领域层），core 不感知 qq-bot。
 * 通过实现 core 的 BotAdapter 端口，由组合根（app.ts）装配。
 */
import "./utils/extensions";

// 客户端（OneBot v11 WebSocket）
export { default as XzQBot, AbsXzQBot, XzQBotError, XzQBbotWebsocketError, XzQBotSendError } from "./client/xz-qbot";

// 命令框架
export { default as CommandProcessor } from "./command/command-processor";

// 配置（config/qq-bot.json）
export { qqBotConfigManager } from "./config";
export type { QQBotConfig } from "./config";

// 服务
export { default as QQBotService } from "./service/qq-bot-service";
export type { CommandContext, CommandProcessors, ProcessorContext, ReplyFunction, SubscribeFreeState } from "./service/context";
export { SubscriptionQuery } from "./service/subscription/store";
export type { DataStore, SubscriptionConfig } from "./service/subscription/store";

// 类型与错误
export * from "./types/one-bot";
export * from "./types/errors";
