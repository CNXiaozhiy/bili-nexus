/**
 * @bili-nexus/core — BiliNexus 领域层与基础设施的公共 API。
 *
 * 依赖方向约定：
 * - core 不依赖任何具体平台适配器（QQ / Telegram / Web ...）；
 * - 平台适配器（如 @bili-nexus/qq-bot）依赖 core，并实现 core 定义的端口（BotAdapter）。
 */

// ---- common：配置管理器与全局变量 ----
export {
  GlobalVariablesManager,
  globalVariables,
  appConfigManager,
  biliConfigManager,
  accountConfigManager,
  liveConfigManager,
  userDynamicConfigManager,
  apiConfigManager,
  webConfigManager,
} from "./common";
export type { GlobalVariables } from "./common";
export type {
  AppConfig,
  BiliConfig,
  AccountConfig,
  LiveConfig,
  UserDynamicConfig,
  ApiConfig,
  WebConfig,
  RoomOptions,
  liveBroadcastRecord,
} from "./common/config";
// 注意：common/config 与 live-automation-manager 均导出 UploadOptions，
// 公共 API 保留 live 侧的语义（投稿事件选项），配置侧别名导出。
export type { UploadOptions as CustomUploadOptions } from "./common/config";
export type { BiliAccount as BiliAccountConfig } from "./common/config";

// ---- 端口 ----
export type { BotAdapter } from "./interfaces/bot-adapter";

// ---- 事件总线 ----
export { default as notifyEmitter } from "./core/app/notify-emitter";
export type { Events as NotifyEmitterEvents } from "./core/app/notify-emitter";

// ---- B 站领域 ----
export { default as UserAccount } from "./core/bilibili/account";
export { BiliAccount } from "./core/bilibili/bili-account";
export { default as BiliApi } from "./core/bilibili/bili-api";
export { default as BiliHttpApi } from "./core/bilibili/bili-http-api";
export { loginAccount, loginAccountByConsole } from "./core/bilibili/account-login";
export { default as LiveRecorder } from "./core/bilibili/live/live-recorder";
export type { LiveRecorderEvents } from "./core/bilibili/live/live-recorder";
export { default as LiveMessageStreamClient } from "./core/bilibili/live/live-message-stream";
export { default as VideoUploader } from "./core/bilibili/video/video-uploader";
export type { VideoInfo, VideoUploaderOptions, Task } from "./core/bilibili/video/video-uploader";
export { default as VideoTracker } from "./core/bilibili/video/video-tracker";
export { default as SpaceDynamicRender } from "./core/bilibili/dynamic/space-dynamic-render";
export type { SpaceDynamicRenderConfig } from "./core/bilibili/dynamic/space-dynamic-render";
export { default as DiskSpaceMonitor } from "./core/disk/disk-space-monitor";
export type {
  DiskSpaceOptions,
  DiskSpaceInfo,
  DiskSpaceStatus,
  AbnormalLevel,
  DiskSpaceMonitorEvents,
} from "./core/disk/disk-space-monitor";
export {
  default as Ffmpeg,
  FfmpegCommand,
  RecordFfmpeg,
  ConcatFfmpeg,
  ScreenshotFfmpeg,
} from "./core/ffmpeg";
export type { FfmpegEvents, ConcatOptions } from "./core/ffmpeg";

// ---- 自动化服务 ----
export { default as LiveAutomationManager } from "./services/live/live-automation-manager";
export type {
  LiveAutomationManagerEvents,
  RoomManageOptions,
  UploadOptions,
  UploadEventOptions,
} from "./services/live/live-automation-manager";
export { CustomBiliAccountNotFound } from "./services/live/live-automation-manager";
export { default as DynamicAutomationManager } from "./services/dynamic/dynamic-automation-manager";
export type { DynamicAutomationManagerEvents } from "./services/dynamic/dynamic-automation-manager";
export {
  default as BiliAccountService,
  BiliAccountServiceError,
} from "./services/account/bili-account-service";
export { initVersion, getVersion } from "./services/version";

// ---- 基础设施 ----
export { default as getLogger } from "./utils/logger";
export { default as ConfigManager, ConcurrentSafeConfigManager } from "./utils/config";
export { default as FormatUtils } from "./utils/format";
export { default as BiliUtils } from "./utils/bili";
export { screenshotSync } from "./utils/ffmpeg";
export { deleteFolderRecursive, isFolderEmpty } from "./utils/file";
export { default as request } from "./utils/request";
export { default as TimeUtils } from "./utils/time";
export { default as WebsocketUtils } from "./utils/websocket";
export type { ListenerHandler } from "./utils/websocket";

// ---- 领域类型 ----
export * from "./types/bilibili";
export * from "./types/bilibili/bili-http-api";
export * from "./types/ffmpeg";
export * from "./types/errors/bili-api";
export * from "./types/errors/bili-http-api";
export * from "./types/errors/disk-space-monitor";
export * from "./types/errors/ffmpeg";
export * from "./types/errors/live-recorder";
export * from "./types/errors/login";
