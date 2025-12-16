import {
  appConfigManager,
  liveConfigManager,
  accountConfigManager,
  htmlRender,
  userDynamicConfigManager,
  qqBotConfigManager,
} from "@/common";
import getLogger from "./utils/logger";
import { initVersion, getVersion } from "./services/version";
import Ffmpeg from "./core/ffmpeg";
import { deleteFolderRecursive, isFolderEmpty } from "./utils/file";
import LiveAutomationManager from "./services/live/live-automation-manager";
import BiliAccountService from "./services/account/bili-account-service";
import UserAccount from "./core/bilibili/account";
import { loginAccountByConsole } from "./core/bilibili/account-login";
import QQBotService from "./services/qq-bot/qq-bot-service";
import DynamicAutomationManager from "./services/dynamic/dynamic-automation-manager";
import { existsSync, mkdirSync } from "fs";
import BiliUtils from "./utils/bili";

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
else if (process.env.NODE_ENV === "production")
  logger.debug("当前处于 生产环境");
else logger.error("无法识别当前工作环境，请检查环境NODE_ENV是否配置！");

export class App {
  private liveAutomationManager: LiveAutomationManager | null = null;
  private dynamicAutomationManager: DynamicAutomationManager | null = null;

  // 适配器
  private qqBotService: QQBotService | null = null;

  constructor() {}

  public async run() {
    // 初始化 默认文件夹
    const recordingDir = appConfigManager.get("recordingDir");
    mkdirSync(recordingDir, { recursive: true });

    if (!isFolderEmpty(recordingDir)) {
      logger.warn(
        "将在 5s 后清理录制文件夹内的所有文件, 如需备份请立即结束本程序"
      );
      await new Promise((resolve) => setTimeout(resolve, 5000));
      deleteFolderRecursive(recordingDir);
      logger.info("文件清理完成 ✅");
    }

    // 初始化 Ffmpeg
    const ffmpegBinPath = appConfigManager.get("ffmpegBinPath");

    if (ffmpegBinPath) {
      if (!existsSync(ffmpegBinPath)) {
        logger.error(
          "FFmpeg 二进制文件不存在，请检查 config/app.json 中配置后重启服务"
        );
        await new Promise((resolve) => setTimeout(resolve, 5000));
        process.exit(1);
      }

      Ffmpeg.setup(ffmpegBinPath);
    } else {
      logger.warn(
        "FFmpeg 二进制文件路径未配置，请在 config/app.json 中配置后重启服务"
      );
      await new Promise((resolve) => setTimeout(resolve, 5000));
      process.exit(1);
    }

    logger.debug("Ffmpeg 初始化完成");

    // 初始化 HtmlRender
    const chromeBinPath = appConfigManager.get("chromeBinPath");
    if (chromeBinPath) {
      if (!existsSync(chromeBinPath)) {
        logger.error(
          "Chrome 二进制文件不存在，请 config/app.json 中检查配置后重启服务"
        );
        await new Promise((resolve) => setTimeout(resolve, 5000));
        process.exit(1);
      }
      await htmlRender.init({ executablePath: chromeBinPath, headless: true });
    } else {
      logger.warn(
        "Chrome 二进制文件路径未配置，请在 config/app.json 中配置后重启服务"
      );
      await new Promise((resolve) => setTimeout(resolve, 5000));
      process.exit(1);
    }

    logger.debug("HtmlRender 初始化完成");

    // 初始化 BiliApiService
    const defaultAccount = accountConfigManager.get("defaultUid");
    const accounts = accountConfigManager.get("accounts");

    let defaultBiliAccount: BiliAccount;

    if (!defaultAccount) {
      logger.warn(
        "默认账号未配置，请在 config/account.json 中配置后重启服务或使用命令行登录"
      );
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
        new UserAccount(
          defaultAccount,
          accounts[defaultAccount].cookie,
          accounts[defaultAccount].refresh_token
        )
      );

      // 设置 SESSDATA
      const SESSDATA = BiliUtils.parseCookieString(
        accounts[defaultAccount].cookie
      )["SESSDATA"];
      if (!SESSDATA) {
        logger.error("获取 Cookie 中的 SESSDATA 失败");
        process.exit(1);
      }

      const browser = htmlRender.getBrowser();
      if (!browser) {
        logger.error("HtmlRender 获取浏览器失败");
        process.exit(1);
      }

      await browser.setCookie({
        name: "SESSDATA",
        value: SESSDATA,
        domain: ".bilibili.com",
        path: "/",
      });
    }

    // 注册其他账号
    for (const uid in accounts) {
      if (parseInt(uid) === defaultAccount) continue;
      const account = accounts[uid];
      BiliAccountService.register(
        new UserAccount(parseInt(uid), account.cookie, account.refresh_token)
      );
    }

    logger.debug("BiliApiService 初始化完成");

    // 初始化 LiveAutomationManager
    const rooms = liveConfigManager.get("rooms");
    this.liveAutomationManager = new LiveAutomationManager(defaultBiliAccount);

    for (const roomId in rooms) {
      if (!rooms[roomId].enable) {
        logger.info(`房间 ${roomId} 已禁用 ${rooms}`);
        continue;
      }
      this.liveAutomationManager.addRoom(parseInt(roomId), {
        autoRecord: rooms[roomId].autoRecord,
        autoUpload: rooms[roomId].autoUpload,
      });
    }

    logger.debug("LiveAutomationManager 初始化完成");

    logger.info("正在等待 LiveMonitors 全部 Pool 完成");
    await this.liveAutomationManager.awaitLiveMonitorsPool();
    logger.info("LiveMonitors 全部 Pool 完成 ✅");

    // 初始化 DynamicAutomationManager
    this.dynamicAutomationManager = new DynamicAutomationManager(
      defaultBiliAccount
    );
    const users = userDynamicConfigManager.get("users");
    for (const uid in users) {
      this.dynamicAutomationManager.addUser(parseInt(uid));
    }

    logger.debug("SpaceDynamicMonitor 初始化完成");

    // 初始化 QQBotService
    if (qqBotConfigManager.get("enable")) {
      this.qqBotService = new QQBotService(
        this.liveAutomationManager,
        this.dynamicAutomationManager
      );
      try {
        await this.qqBotService.init();
        logger.info("QQBotService 初始化成功");
      } catch (e) {
        logger.error("QQBotService 初始化失败", e);
        process.exit(1);
      }
    } else {
      logger.warn(`QQBotService 适配器 -> 已禁用`);
    }

    logger.debug("QQBotService 初始化完成");

    return;
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

import notifyEmitter from "./services/system/notify-emitter";
import FormatUtils from "./utils/format";
import { BiliAccount } from "./core/bilibili/bili-account";

if (true) {
  process.on("uncaughtException", (error) => {
    const errorMessage = FormatUtils.formatErrorMessage(
      "uncaughtException",
      error
    );
    notifyEmitter.emit("msg-error", errorMessage);
  });

  process.on("unhandledRejection", (reason, promise) => {
    const errorMessage = FormatUtils.formatErrorMessage(
      "unhandledRejection",
      reason,
      promise
    );
    notifyEmitter.emit("msg-error", errorMessage);
  });
}

export default app;
