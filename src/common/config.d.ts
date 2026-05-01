export interface AppConfig {
  ffmpegBinPath: string;
  recordingDir: string;
  dynamicRender: {
    enable: boolean;
    host: string;
    port: number;
  };
}

export interface BiliConfig {
  slideshowAsEnd: boolean;
}

export interface BiliAccount {
  cookie: string;
  refresh_token: string;
}

export interface AccountConfig {
  accounts: Record<string, BiliAccount>; // uid -> BiliAccount
  defaultUid: number;
}

export interface liveBroadcastRecord {
  room_id: number;
  hash: string;
  start_time: number;
  end_time?: number;
  rec_start_time?: number;
  rec_end_time?: number;
}

export interface UploadOptions {
  account?: number;
  cover?: string;
  title?: string;
  desc?: string;
  tid?: number;
  tag?: string;
}

export interface RoomOptions {
  enable: boolean;
  autoRecord: boolean;
  autoUpload: boolean;
  uploadOptions?: UploadOptions;
}

export interface LiveConfig {
  rooms: Record<string, RoomOptions>; // 房间号 -> RoomOptions
  liveBroadcastRecords: liveBroadcastRecord[];
}

export interface UserDynamicConfig {
  users: Record<string, boolean>; // uid -> boolean
}

export interface ApiConfig {
  enable: boolean;
  port: number;
  apiKey: string;
}

export interface WebConfig {
  enable: boolean;
  port: number;
}

export type SubscriptionConfig = {
  notify: boolean;
  group: Record<
    string,
    {
      offical: boolean;
      users: number[];
    }
  >;
};

export type DataStore<T = string> = Record<T, SubscriptionConfig>;

// 适配器
export interface QQBotConfig {
  enable: boolean;
  qq: number;
  websocketClient: {
    url: string;
    retryDelay: number;
  };
  superAdmin: number;
  admins: Record<string, { permission: number }>;
  liveRoom: DataStore<string>;
  userDynamic: DataStore<string>;
  liveDanmaku: {};
}
