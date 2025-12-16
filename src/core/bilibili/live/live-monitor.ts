import EventEmitter from "events";
import { BiliAccount } from "@/core/bilibili/bili-account";
import BiliUtils from "@/utils/bili";
import { LiveRoomInfo, LiveRoomStatus } from "@/types/bilibili";
import getLogger from "@/utils/logger";

const logger = getLogger("LiveMonitor");

export interface LiveMonitorOptions {
  roomId: number;
  slideshowAsEnd?: boolean;
  interval?: number;
}

export interface LiveMonitorEvents {
  "live-start": [liveHash: string, currentRoomInfo: LiveRoomInfo];
  "live-slideshow": [currentRoomInfo: LiveRoomInfo];
  "live-end": [
    liveHash: string,
    roomInfo: LiveRoomInfo,
    lastRoomInfo: LiveRoomInfo,
    liveDuration_ms: number
  ];
  "status-change": [currentRoomInfo: LiveRoomInfo];
}

export default class LiveMonitor extends EventEmitter<LiveMonitorEvents> {
  public readonly roomId: number;
  public slideshowAsEnd: boolean;
  public interval: number;

  private readonly biliAccount: BiliAccount;

  private lastLiveStatus: LiveRoomStatus | null = null;
  private lastLiveHash: string | null = null;
  private lastRoomInfo: LiveRoomInfo | null = null;
  private fristPoolPromise: Promise<LiveRoomStatus | null> | null = null;

  private isRunning = false;

  private checkIntervalId?: NodeJS.Timeout;

  constructor(options: LiveMonitorOptions, biliAccount: BiliAccount) {
    super();
    this.roomId = options.roomId;
    this.biliAccount = biliAccount;
    this.slideshowAsEnd = !!options.slideshowAsEnd;
    this.interval = options.interval ?? 10000;
  }

  public async poll() {
    try {
      const roomInfo = await this.biliAccount
        .getBiliApi()
        .getLiveRoomInfo(this.roomId, true);

      if (roomInfo.live_status === this.lastLiveStatus)
        return roomInfo.live_status;

      // const isFirstStatusChange = this.lastLiveStatus === null;
      const isFirstStatusChange = false;

      this.emit("status-change", roomInfo);

      if (!isFirstStatusChange) {
        if (roomInfo.live_status === LiveRoomStatus.LIVE) {
          this.lastLiveHash = BiliUtils.computeHash(
            this.roomId,
            new Date(roomInfo.live_time).getTime()
          );
          this.emit("live-start", this.lastLiveHash, roomInfo);
        } else if (roomInfo.live_status === LiveRoomStatus.SLIDESHOW) {
          this.emit("live-slideshow", roomInfo);
          if (this.slideshowAsEnd) {
            this.emit(
              "live-end",
              this.lastLiveHash!,
              roomInfo,
              this.lastRoomInfo ?? roomInfo,
              this.lastRoomInfo
                ? Date.now() - new Date(this.lastRoomInfo.live_time).getTime()
                : 0
            );
          }
        } else if (roomInfo.live_status === LiveRoomStatus.END) {
          this.emit(
            "live-end",
            this.lastLiveHash!,
            roomInfo,
            this.lastRoomInfo ?? roomInfo,
            this.lastRoomInfo
              ? Date.now() - new Date(this.lastRoomInfo.live_time).getTime()
              : 0
          );
          this.lastLiveHash = null;
        }
      }

      this.lastLiveStatus = roomInfo.live_status;
      this.lastRoomInfo = roomInfo;

      return roomInfo.live_status;
    } catch (e) {
      return null;
    }
  }

  public startMonitor() {
    if (this.isRunning) {
      logger.warn(`LiveMonitor 正在运行, 请勿重复 startMonitor`);
      return;
    }
    this.isRunning = true;
    logger.info(`开始监控直播间 ${this.roomId}`);
    this.fristPoolPromise = this.poll();
    this.checkIntervalId = setInterval(() => {
      this.poll();
    }, this.interval);
  }

  public stopMonitor() {
    this.isRunning = false;

    logger.info(`停止监控直播间 ${this.roomId}`);
    if (this.checkIntervalId) {
      clearInterval(this.checkIntervalId);
    }
  }

  public getFirstPoolPromise() {
    return this.fristPoolPromise;
  }

  public destroy() {
    this.stopMonitor();
    this.removeAllListeners();
  }
}
