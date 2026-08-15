import { existsSync, mkdirSync } from "fs";

import {
  accountConfigManager,
  appConfigManager,
  BiliAccountService,
  deleteFolderRecursive,
  DynamicAutomationManager,
  Ffmpeg,
  FormatUtils,
  getLogger,
  getVersion,
  initVersion,
  isFolderEmpty,
  LiveAutomationManager,
  liveConfigManager,
  loginAccountByConsole,
  notifyEmitter,
  UserAccount,
  userDynamicConfigManager,
} from "@bili-nexus/core";
import type { BiliAccount, BotAdapter, RoomManageOptions } from "@bili-nexus/core";
import { QQBotService, qqBotConfigManager } from "@bili-nexus/qq-bot";

const logger = getLogger("App");
initVersion();

console.log(`
    ____     _     __    _     _   __                              
   / __ )   (_)   / /   (_)   / | / /  ___    _  __  __  __   _____
  / __  |  / /   / /   / /   /  |/ /  / _ \\  | |/_/ / / / /  / ___/
 / /_/ /  / /   / /   / /   / /|  /  /  __/ _>. <  / /_/ /  (__  ) 
/_____/  /_/   /_/   /_/   /_/ |_/   \\___/ /_/|_|  \\__,_/  /____/  

`);

logger.info("Bili Nexus (>. <) v" + getVersion());
if (process.env.NODE_ENV === "development") logger.debug("当前处于 开发环境");
else if (process.env.NODE_ENV === "production") logger.debug("当前处于 生产环境");
else logger.error("无法识别当前工作环境，请检查环境NODE_ENV是否配置！");

// 全局异常处理（尽早注册，避免初始化期异常丢失）
process.on("uncaughtException", (error) => {
  logger.error("uncaughtException", error);

  const errorMessage = FormatUtils.formatErrorMessage("uncaughtException", error);
  notifyEmitter.emit("msg-error", errorMessage, error);
});

process.on("unhandledRejection", (reason, promise) => {
  logger.error("unhandledRejection", reason);

  const errorMessage = FormatUtils.formatErrorMessage("unhandledRejection", reason, promise);
  notifyEmitter.emit("msg-error", errorMessage, reason);
});

/**
 * 组合根（Composition Root）：
 * 负责装配 core 领域服务与各平台适配器（BotAdapter 端口）。
 */
export class App {
  private liveAutomationManager: LiveAutomationManager | null = null;
  private dynamicAutomationManager: DynamicAutomationManager | null = null;

  /** 已注册的平台适配器 */
  private readonly adapters: BotAdapter[] = [];

  constructor() {}

  public async run() {
    // 初始化 默认文件夹
    const recordingDir = appConfigManager.get("recordingDir");
    mkdirSync(recordingDir, { recursive: true });

    if (!isFolderEmpty(recordingDir)) {
      logger.warn("将在 5s 后清理录制文件夹内的所有文件, 如需备份请立即结束本程序");
      await new Promise((resolve) => setTimeout(resolve, 5000));
      deleteFolderRecursive(recordingDir);
      logger.info("文件清理完成 ✅");
    }

    // 初始化 Ffmpeg
    const ffmpegBinPath = appConfigManager.get("ffmpegBinPath");

    if (ffmpegBinPath) {
      if (!existsSync(ffmpegBinPath)) {
        logger.error("FFmpeg 二进制文件不存在，请检查 config/app.json 中配置后重启服务");
        await new Promise((resolve) => setTimeout(resolve, 5000));
        process.exit(1);
      }

      Ffmpeg.setup(ffmpegBinPath);
    } else {
      logger.warn("FFmpeg 二进制文件路径未配置，请在 config/app.json 中配置后重启服务");
      await new Promise((resolve) => setTimeout(resolve, 5000));
      process.exit(1);
    }

    logger.debug("Ffmpeg 初始化完成");

    // 初始化 DynamicRender
    const dynamicRenderConfig = appConfigManager.get("dynamicRender");
    if (dynamicRenderConfig.enable) {
      // HTTP TEST (挖坑)
    } else {
      logger.warn("动态渲染服务未开启，部分功能将无法使用");
    }

    logger.debug("DynamicRender 初始化完成");

    // 初始化 BiliAccountService
    const defaultAccount = accountConfigManager.get("defaultUid");
    const accounts = accountConfigManager.get("accounts");

    logger.info("检测到", Object.keys(accounts).length, "个账号");

    let defaultBiliAccount: BiliAccount;

    if (!defaultAccount) {
      logger.warn("默认账号未配置，请在 config/account.json 中配置后重启服务或使用命令行登录");
      // 登录默认账号
      try {
        const userAccount = await loginAccountByConsole(true);
        defaultBiliAccount = BiliAccountService.registerDefault(userAccount);
      } catch (e) {
        logger.error("登录失败", e);
        process.exit(1);
      }
    } else {
      // 注册默认账号
      defaultBiliAccount = BiliAccountService.registerDefault(
        new UserAccount(defaultAccount, accounts[defaultAccount].cookie, accounts[defaultAccount].refresh_token),
      );
    }

    // 注册其他账号
    for (const uid in accounts) {
      if (parseInt(uid) === defaultAccount) continue;
      const account = accounts[uid];
      BiliAccountService.register(new UserAccount(parseInt(uid), account.cookie, account.refresh_token));
    }

    BiliAccountService.init();

    logger.debug("BiliAccountService 初始化完成");

    // 实例化类（初始化应在通知型服务之后）
    this.liveAutomationManager = new LiveAutomationManager(defaultBiliAccount);
    logger.info("LiveAutomationManager 实例化成功✔️");

    this.dynamicAutomationManager = new DynamicAutomationManager(defaultBiliAccount);
    logger.info("DynamicAutomationManager 实例化完成✔️");

    // 初始化平台适配器（BotAdapter 端口）
    if (qqBotConfigManager.get("enable")) {
      await this.registerAdapter(new QQBotService(this.liveAutomationManager, this.dynamicAutomationManager));
    } else {
      logger.warn(`QQBotService 适配器 -> 已禁用🚫`);
    }

    logger.debug("通知型服务初始化完成✔️");

    // 初始化 LiveAutomationManager
    logger.info("开始初始化 LiveAutomationManager⏳");

    const rooms = liveConfigManager.get("rooms");
    const _rooms: { roomId: number; roomManageOptions: RoomManageOptions }[] = [];
    for (const roomId in rooms) {
      if (!rooms[roomId].enable) {
        logger.info(`房间 ${roomId} 已禁用 ${rooms}`);
        continue;
      }

      _rooms.push({
        roomId: parseInt(roomId),
        roomManageOptions: {
          autoRecord: rooms[roomId].autoRecord,
          autoUpload: rooms[roomId].autoUpload,
        },
      });
    }

    this.liveAutomationManager.batchAddRooms(_rooms);

    logger.debug("LiveAutomationManager 初始化完成✔️");

    // 初始化 DynamicAutomationManager
    logger.info("开始初始化 DynamicAutomationManager⏳");

    const users = userDynamicConfigManager.get("users");
    for (const uid in users) {
      this.dynamicAutomationManager.addUser(uid);
    }

    this.dynamicAutomationManager.startMonitor();

    logger.debug("SpaceDynamicMonitor 初始化完成✔️");

    return;
  }

  /** 注册并初始化一个平台适配器 */
  private async registerAdapter(adapter: BotAdapter): Promise<void> {
    try {
      await adapter.init();
      logger.info(`适配器 [${adapter.name}] 初始化成功✔️`);
      this.adapters.push(adapter);
    } catch (e) {
      logger.error(`适配器 [${adapter.name}] 初始化失败❌`, e);
      process.exit(1);
    }
  }

  /** 优雅关闭所有已注册适配器 */
  public async shutdown(): Promise<void> {
    logger.info("正在关闭所有适配器...");
    await Promise.allSettled(this.adapters.map((adapter) => adapter.shutdown()));
  }

  public getLiveAutomationManager() {
    return this.liveAutomationManager;
  }

  public getDynamicAutomationManager() {
    return this.dynamicAutomationManager;
  }
}

const app = new App();

app.run().then(() => logger.info("App 启动成功✅"));

// 优雅退出
const gracefulShutdown = (signal: string) => {
  logger.info(`收到退出信号 ${signal}, 开始优雅关闭...`);
  app
    .shutdown()
    .catch((e) => logger.error("优雅关闭失败", e))
    .finally(() => process.exit(0));
};

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

export default app;
