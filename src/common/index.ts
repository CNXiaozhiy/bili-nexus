// src/common/index.ts
import "@/utils/extensions";
import ConfigManager from "@/utils/config";
import {
  AppConfig,
  BiliConfig,
  AccountConfig,
  LiveConfig,
  UserDynamicConfig,
  QQBotConfig,
  ApiConfig,
  WebConfig,
} from "./config";
import HtmlRender from "@/core/render/html-render";

export interface GlobalVariables {
  version: string;
}

class GlobalVariablesManager<T extends Record<string, any>> {
  public variables: T = {} as T;

  public set(key: keyof T, value: T[keyof T]) {
    this.variables[key] = value;
  }

  public get(key: string) {
    return this.variables[key];
  }
}

function getDefaultAppConfig(): AppConfig {
  const config = {} as AppConfig;

  if (process.platform === "win32") {
    config.ffmpegBinPath = "./vendor/ffmpeg/bin/ffmpeg.exe";
    config.chromeBinPath = "./vendor/chrome/chrome.exe";
  } else {
    config.ffmpegBinPath = "./vendor/ffmpeg/bin/ffmpeg";
    config.chromeBinPath = "./vendor/chrome/chrome";
  }

  config.recordingDir = "./recordings";

  config.ffmpegBinPath = process.env.FFMPEG_BIN_PATH || config.ffmpegBinPath;
  config.chromeBinPath = process.env.CHROME_BIN_PATH || config.chromeBinPath;
  config.recordingDir = process.env.RECORDING_DIR || config.recordingDir;

  return config;
}

export const globalVariables = new GlobalVariablesManager<GlobalVariables>();
export const appConfigManager = new ConfigManager<AppConfig>(
  "config/app.json",
  getDefaultAppConfig()
);
export const biliConfigManager = new ConfigManager<BiliConfig>(
  "config/bili.json",
  {
    slideshowAsEnd: true,
  }
);
export const accountConfigManager = new ConfigManager<AccountConfig>(
  "config/account.json",
  {
    accounts: {},
    defaultUid: 0,
  }
);
export const liveConfigManager = new ConfigManager<LiveConfig>(
  "config/live.json",
  {
    rooms: {},
    liveBroadcastRecords: [],
  }
);
export const userDynamicConfigManager = new ConfigManager<UserDynamicConfig>(
  "config/dynamic.json",
  {
    users: {},
  }
);
export const apiConfigManager = new ConfigManager<ApiConfig>(
  "config/api.json",
  {
    enable: true,
    port: 3000,
    apiKey: "",
  }
);
export const webConfigManager = new ConfigManager<WebConfig>(
  "config/web.json",
  {
    enable: true,
    port: 3001,
  }
);

// 适配器
export const qqBotConfigManager = new ConfigManager<QQBotConfig>(
  "config/qq-bot.json",
  {
    enable: false,
    websocketClient: {
      url: "",
      retryDelay: 30000,
    },
    superAdmin: 0,
    admins: {},
    liveRoom: {},
    liveDanmaku: {},
    userDynamic: {},
  }
);

export const htmlRender = new HtmlRender();
