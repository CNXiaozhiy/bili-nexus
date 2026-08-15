import type { DynamicAutomationManager, LiveAutomationManager } from "@bili-nexus/core";
import type XzQBot from "../client/xz-qbot";
import type CommandProcessor from "../command/command-processor";
import type { GroupMessageEvent, MessageEvent, Messages, PrivateMessageEvent } from "../types/one-bot";

/** 回复函数（由 XzQBot 注入，自动携带原消息引用） */
export type ReplyFunction = (message: Messages, options?: { at?: boolean; reference?: boolean }) => Promise<unknown>;

/** 命令处理器上下文（event + reply + bot） */
export type ProcessorContext<T> = {
  event: T;
  reply: ReplyFunction;
  bot: XzQBot;
};

/** 命令处理器集合 */
export interface CommandProcessors {
  global: CommandProcessor<ProcessorContext<MessageEvent>, Messages | null>;
  group: CommandProcessor<ProcessorContext<GroupMessageEvent>, Messages | null>;
  private: CommandProcessor<ProcessorContext<PrivateMessageEvent>, Messages | null>;
}

/** 命令注册所需的实例级依赖 */
export interface CommandContext {
  bot: XzQBot;
  liveAutomationManager: LiveAutomationManager;
  dynamicAutomationManager: DynamicAutomationManager;
  /** BN-Subscribe-Free 调试开关状态 */
  subscribeFree: SubscribeFreeState;
}

/** 权限不足异常（抛出后被 CommandProcessor 捕获并作为错误消息回复） */
export class AuthError extends Error {}

/** BN-Subscribe-Free 调试开关（无录制任务时自动关闭） */
export class SubscribeFreeState {
  private _enabled = false;
  private _interval: NodeJS.Timeout | null = null;

  get enabled(): boolean {
    return this._enabled;
  }

  /** 开启开关，并每隔 10s 检测一次：无录制任务时回调 onIdle 并自动关闭 */
  enable(onIdle: () => void): void {
    if (this._enabled) return;
    this._enabled = true;
    this._interval = setInterval(() => {
      if (this._enabled) onIdle();
    }, 10 * 1000);
  }

  /** 关闭开关并清理定时器 */
  disable(): void {
    this._enabled = false;
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
  }
}
