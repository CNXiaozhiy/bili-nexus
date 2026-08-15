import type { DynamicAutomationManager, LiveAutomationManager } from "@bili-nexus/core";
import type XzQBot from "../../client/xz-qbot";
import { installDynamicNotifier } from "./dynamic-notifier";
import { installLiveNotifier } from "./live-notifier";
import { installSystemNotifier } from "./system-notifier";

export interface NotifierDeps {
  liveAutomationManager: LiveAutomationManager;
  dynamicAutomationManager: DynamicAutomationManager;
}

/** 安装全部通知监听器 */
export function installNotifiers(bot: XzQBot, deps: NotifierDeps): void {
  installSystemNotifier(bot);
  installLiveNotifier(bot, deps.liveAutomationManager);
  installDynamicNotifier(bot, deps.dynamicAutomationManager);
}
