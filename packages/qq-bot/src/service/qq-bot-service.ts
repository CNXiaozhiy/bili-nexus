import { getLogger } from "@bili-nexus/core";
import type { BotAdapter, DynamicAutomationManager, LiveAutomationManager } from "@bili-nexus/core";
import XzQBot from "../client/xz-qbot";
import CommandProcessor from "../command/command-processor";
import { qqBotConfigManager } from "../config";
import { QQBotServiceSetupError } from "../types/errors";
import type { GroupMessageEvent, MessageEvent, Messages, PrivateMessageEvent } from "../types/one-bot";
import { registerCommands } from "./commands";
import { SubscribeFreeState } from "./context";
import type { CommandProcessors, ProcessorContext } from "./context";
import { installNotifiers } from "./notifier";

const logger = getLogger("QQBotService");

/**
 * QQ 机器人适配器（@bili-nexus/qq-bot）。
 *
 * 职责：
 * - 连接 OneBot v11 正向 WebSocket；
 * - 注册全局/群聊/私聊命令处理器；
 * - 订阅 core 领域事件（直播/动态/系统通知）并转发到 QQ 群。
 *
 * 依赖注入：通过构造函数接收 LiveAutomationManager / DynamicAutomationManager，
 * 不直接依赖 core 之外的任何平台实现。
 */
export default class QQBotService implements BotAdapter {
  readonly name = "qq-bot";

  private bot: XzQBot | null = null;

  private readonly commandProcessor = new CommandProcessor<ProcessorContext<MessageEvent>, Messages | null>();
  private readonly groupCommandProcessor = new CommandProcessor<ProcessorContext<GroupMessageEvent>, Messages | null>();
  private readonly privateCommandProcessor = new CommandProcessor<ProcessorContext<PrivateMessageEvent>, Messages | null>();

  private readonly subscribeFree = new SubscribeFreeState();

  constructor(
    private readonly liveAutomationManager: LiveAutomationManager,
    private readonly dynamicAutomationManager: DynamicAutomationManager
  ) {}

  public async init(): Promise<void> {
    const websocketClient = qqBotConfigManager.get("websocketClient");
    if (!websocketClient || !websocketClient.url) {
      throw new QQBotServiceSetupError("未配置 websocketClient.url, 请在 config/qq-bot.json 中配置后重启服务");
    }

    const bot = new XzQBot(websocketClient.url, qqBotConfigManager.get("qq"));
    this.bot = bot;

    await bot.connect();

    this.installMessageListeners(bot);

    registerCommands(
      {
        global: this.commandProcessor,
        group: this.groupCommandProcessor,
        private: this.privateCommandProcessor,
      } satisfies CommandProcessors,
      {
        bot,
        liveAutomationManager: this.liveAutomationManager,
        dynamicAutomationManager: this.dynamicAutomationManager,
        subscribeFree: this.subscribeFree,
      }
    );

    installNotifiers(bot, {
      liveAutomationManager: this.liveAutomationManager,
      dynamicAutomationManager: this.dynamicAutomationManager,
    });
  }

  public async shutdown(): Promise<void> {
    logger.info("QQBotService 正在关闭...");
    this.subscribeFree.disable();
    if (this.bot) {
      this.bot.destroy();
      this.bot = null;
    }
  }

  private installMessageListeners(bot: XzQBot): void {
    bot.on("private_message", async (e, reply) => {
      if (e.post_type === "message_sent") return;

      const r = await this.privateCommandProcessor.execute(e.raw_message, {
        event: e,
        reply,
        bot,
      });

      if (r.error && !r.error.startsWith("Unknown command")) {
        reply(r.error);
      } else if (r.success && r.result) {
        reply(r.result);
      } else {
        // 全局 commandProcessor
        const r = await this.commandProcessor.execute(e.raw_message, {
          event: e,
          reply,
          bot,
        });
        if (r.error && !r.error.startsWith("Unknown command")) {
          reply(r.error);
        } else if (r.success && r.result) {
          reply(r.result);
        }
      }
    });

    bot.on("group_message", async (e, reply) => {
      if (e.post_type === "message_sent") return;

      const r = await this.groupCommandProcessor.execute(e.raw_message, {
        event: e,
        reply,
        bot,
      });

      if (r.error && !r.error.startsWith("Unknown command")) {
        reply(r.error);
      } else if (r.success && r.result) {
        reply(r.result);
      } else {
        // 全局 commandProcessor
        const r = await this.commandProcessor.execute(e.raw_message, {
          event: e,
          reply,
          bot,
        });
        if (r.error && !r.error.startsWith("Unknown command")) {
          reply(r.error);
        } else if (r.success && r.result) {
          reply(r.result);
        }
      }
    });
  }
}
