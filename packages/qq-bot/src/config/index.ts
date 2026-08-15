import { ConfigManager } from "@bili-nexus/core";
import type { DataStore } from "../service/subscription/store";

/**
 * QQ 机器人配置（config/qq-bot.json）。
 * 由 qq-bot 包自持，与 core 的配置体系完全解耦。
 */
export interface QQBotConfig {
  /** 是否启用 QQ 机器人适配器 */
  enable: boolean;
  /** 机器人 QQ 号 */
  qq: number;
  websocketClient: {
    /** OneBot v11 正向 WebSocket 地址，如 ws://127.0.0.1:6700 */
    url: string;
    retryDelay: number;
  };
  /** 超级管理员 QQ 号 */
  superAdmin: number;
  /** 管理员表：QQ号 -> 权限等级 */
  admins: Record<string, { permission: number }>;
  /** 直播间订阅配置 */
  liveRoom: DataStore<string>;
  /** 主播动态订阅配置 */
  userDynamic: DataStore<string>;
  /** 弹幕订阅配置（预留） */
  liveDanmaku: Record<string, never>;
}

export const qqBotConfigManager = new ConfigManager<QQBotConfig>("config/qq-bot.json", {
  enable: false,
  qq: 0,
  websocketClient: {
    url: "",
    retryDelay: 30000,
  },
  superAdmin: 0,
  admins: {},
  liveRoom: {},
  liveDanmaku: {},
  userDynamic: {},
});
