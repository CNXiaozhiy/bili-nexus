import EventEmitter from "events";
import LiveMonitor from "./live-monitor";
import LiveRecorder from "./live-recorder";
import {
  appConfigManager,
  biliConfigManager,
  liveConfigManager,
} from "@/common";
import BiliApiService from "../bili-api";
import getLogger from "@/utils/logger";
import { LiveRoomInfo, LiveRoomStatus, UserCard } from "@/types/bili";
import { UploadOptions as CustomOptions } from "@/common/config";
import BiliUtils from "@/utils/bili";
import DiskSpaceMonitor from "../system/disk-space-monitor";
import notifyEmitter from "../system/notify-emitter";
import VideoUploader from "../video/video-uploader";
import FormatUtils from "@/utils/format";
import { getVersion } from "../version";
import fs from "fs";

const logger = getLogger("LiveAutomationManager");

export interface RoomManageOptions {
  autoRecord: boolean;
  autoUpload: boolean;
}

export interface UploadOptions {
  hash: string;
  file: string;
  roomInfo: LiveRoomInfo; // 开播时的房间数据
  live: { startTime: number; stopTime: number; duration: number };
  recorder: { startTime: number; stopTime: number; duration: number };
  additionalDesc?: string;
  customOptions?: CustomOptions;
}

export type UploadEventOptions = UploadOptions & { userCard: UserCard };

export interface LiveAutomationManagerEvents {
  "new-monitor": [liveMonitor: LiveMonitor, roomId: number];
  "new-recorder": [liveRecorder: LiveRecorder, hash: string];
  "new-uploader": [
    videoUploader: VideoUploader,
    hash: string,
    uploadEventOptions: UploadEventOptions
  ];
  "remove-room": [roomId: number];
}

export default class LiveAutomationManager extends EventEmitter<LiveAutomationManagerEvents> {
  private rooms = new Set<number>();
  private hashToRoomIdMap: Map<string, number> = new Map(); // Hash -> RoomId

  public liveMonitors: Map<number, LiveMonitor> = new Map(); // RoomId -> LiveMonitor
  public liveRecorders: Map<string, LiveRecorder> = new Map(); // Hash -> LiveRecorder
  public videoUploaders: Map<string, VideoUploader> = new Map(); // Hash -> VideoUploader
  public diskSpaceMonitor: DiskSpaceMonitor = new DiskSpaceMonitor(
    appConfigManager.get("recordingDir"),
    {
      checkInterval: 30000,
      lowSpaceThreshold: 10 * 1024 * 1024 * 1024, // 10GB
      criticalSpaceThreshold: 5 * 1024 * 1024 * 1024, // 5GB
      fatalSpaceThreshold: 100 * 1024 * 1024, // 100MB
    }
  );

  private recordTimeouts = new Map<string, NodeJS.Timeout>(); // Hash -> Timeout

  private waitingForRestartRecordTask = new Set<string>(); // 直播Hash

  constructor() {
    super();

    this.initDiskSpaceMonitor();
  }

  public initDiskSpaceMonitor() {
    // diskSpaceMonitor.on("space-info");
    let isWarning = false;
    this.diskSpaceMonitor.on("abnormal-space", () => {
      isWarning = false;
      logger.info("磁盘空间恢复");

      logger.info("即将开始恢复等待重启的录制任务");

      this.waitingForRestartRecordTask.forEach((hash) => {
        const recorder = this.liveRecorders.get(hash);
        if (!recorder) {
          logger.warn(`尝试恢复录制失败 ❌ -> 录制器不存在`);
          return;
        }

        recorder.startRecord();
        logger.info(`已重启 负责 ${hash} 的录制器`);
      });
    });
    this.diskSpaceMonitor.on("abnormal-space", (info, level) => {
      if (isWarning && level !== "critical") return;

      isWarning = true;
      logger.error("磁盘空间严重不足，尝试停止任务并放入等待队列");

      const taskMap = new Map<string, boolean>();

      this.liveRecorders.forEach((recorder, hash) => {
        if (this.waitingForRestartRecordTask.has(hash)) return;
        taskMap.set(hash, recorder.isRunning());
      });

      logger.info("当前任务状态 -> ", taskMap);

      const taskCount = taskMap.size;
      if (taskCount === 0) {
        notifyEmitter.emit(
          "msg-warn",
          "严重警告: 磁盘空间不足，且当前无录制任务，请立即检查磁盘状态！"
        );
        logger.error("磁盘空间不足，且当前无录制任务，请立即检查磁盘状态");
        return;
      }

      const randomTaskCount = Math.floor(taskCount * 0.5);
      logger.info(`即将随机暂停 ${randomTaskCount} 个任务`);

      const allHashes = Array.from(this.liveRecorders.keys());
      const shuffledHashes = allHashes.sort(() => 0.5 - Math.random());

      const hashesToStop = shuffledHashes.slice(
        0,
        Math.min(randomTaskCount, allHashes.length)
      );

      hashesToStop.forEach((hash) => {
        const recorder = this.liveRecorders.get(hash);
        logger.info(`开始停止任务 -> ${hash}`);
        if (recorder) {
          this.forceStopRecord(recorder, hash)
            .then(() => {
              logger.info(`停止任务 ${hash} -> 成功`);
            })
            .catch((e) => {
              logger.error(`停止任务 ${hash} -> 失败,`, e);
              logger.warn(`停止录制任务失败, 则这个任务仍会继续运行`);
            });
        }
      });
    });
    this.diskSpaceMonitor.startMonitor();
  }

  public addRoom(roomId: number, roomManageOptions: RoomManageOptions) {
    logger.info(`添加房间 ${roomId}`);

    if (this.rooms.has(roomId)) {
      logger.debug(`房间已添加, 添加失败`);
      return;
    }

    this.rooms.add(roomId);

    const liveMonitor = new LiveMonitor({
      roomId: roomId,
      slideshowAsEnd: biliConfigManager.get("slideshowAsEnd"),
    });

    this.liveMonitors.set(roomId, liveMonitor);

    this.emit("new-monitor", liveMonitor, roomId);
    logger.debug(`发射事件 new-monitor -> LiveMonitor.roomId: ${roomId}`);

    // Install listeners
    liveMonitor.on("live-start", async (hash, roomInfo) => {
      this.hashToRoomIdMap.set(hash, roomId);
      logger.debug(`已创建 Hash -> RoomId 映射: ${hash} -> ${roomId}`);

      logger.info(`房间 ${roomId} 开始直播`);
      if (!roomManageOptions.autoRecord) {
        logger.info(`房间 ${roomId} 自动录制已禁用`);
        return;
      } else {
        logger.info(`房间 ${roomId} 准备录制`);
      }
      const inputUrls =
        await BiliApiService.getDefaultInstance().getLiveStreamUrl(roomId);
      const inputUrl = inputUrls[0];
      const recorder = new LiveRecorder(
        hash,
        inputUrl,
        appConfigManager.get("recordingDir")
      );
      this.recordTimeouts.set(
        hash,
        setTimeout(() => {
          logger.warn(
            `录制任务 ${hash} 超过最大录制时长限制, 尝试强制停止录制任务`
          );
          this.forceStopRecord(recorder, hash)
            .then(() => {
              logger.info(`停止任务 ${hash} -> 成功`);
            })
            .catch((e) => {
              logger.error(`停止任务 ${hash} -> 失败,`, e);
              logger.warn(`停止录制任务失败, 则这个任务仍会继续运行`);
            });
        }, 8 * 60 * 60 * 1000)
      );

      recorder.on("end", () => {
        liveMonitor.poll().then((status) => {
          logger.info(
            `收到 LiveRecorder(${hash}) 录制完成 事件, 开始检查是否未异常结束`
          );
          if (status === LiveRoomStatus.LIVE) {
            logger.info(`${hash} 录制为异常结束`);
            recorder.retryRecord();
          } else {
            logger.debug(
              `${hash} 录制为正常结束, 由liveMonitor的live-end事件Handler处理剩余事务`
            );
          }
        });
      });
      recorder.on("err", (err) => {
        logger.error(`房间 ${roomId} 录制失败: ${err}`);
        logger.debug("尝试更换直播流");

        BiliApiService.getDefaultInstance()
          .getLiveStreamUrl(roomId)
          .then((urls) => {
            recorder.updateInputUrl(urls[0]);
            logger.debug(`已更换`);
          })
          .catch((e) => {
            logger.error(`获取直播流失败`, e);
          });
      });
      this.liveRecorders.set(hash, recorder);

      this.emit("new-recorder", recorder, hash);
      logger.debug(`发射事件 new-recorder -> LiveRecorder.hash: ${hash}`);

      recorder.startRecord();
      logger.info(`房间 ${roomId} 开始录制`);
    });

    liveMonitor.on("live-end", async (hash, _, roomInfo, liveDuration_ms) => {
      logger.debug(`房间 ${roomId} 结束直播`);

      if (hash == null) {
        logger.debug(`首次 live-end, hash -> null`);
        return;
      }

      if (this.recordTimeouts.has(hash)) {
        logger.debug(`清理录制超时计时器, hash:`, hash);
        clearTimeout(this.recordTimeouts.get(hash)!);
        this.recordTimeouts.delete(hash);
      }

      if (this.waitingForRestartRecordTask.delete(hash)) {
        logger.warn(
          `本场直播 ${hash} 仍位于等待重启的投稿任务中, 将放弃剩余事务`
        );
        logger.debug(`由于直播已结束, 删除等待重启的投稿任务 -> ${hash}`);

        const recorder = this.liveRecorders.get(hash);
        if (recorder) {
          recorder.destroy(true);
          this.liveRecorders.delete(hash);
          logger.debug(`清理负责 ${hash} 的录制器完成 ✅`);
        }

        logger.debug("liveMonitor.event.live-end's Handler -> 放弃剩余事务");
        return;
      }

      const liveStartTime = new Date(roomInfo.live_time).getTime();
      const liveStopTime = Date.now();

      const recorder = this.liveRecorders.get(hash);
      if (!recorder) {
        logger.debug(
          `未找到 ${hash} 的录制器, liveMonitor.event.live-end's Handler -> 放弃剩余事务`
        );
        return;
      }
      logger.info(
        `房间 ${roomId} 开始停止录制, ${hash} 录制器 -> stopRecord()`
      );

      if (!recorder.isRunning()) {
        logger.debug(`WARN: ${hash} 的录制器未在录制`);
      }

      const resp = await recorder.stopRecordAndMerge();

      const customOptions =
        liveConfigManager.get("rooms")[roomId]?.uploadOptions;

      if (roomManageOptions.autoUpload) {
        logger.info(`房间 ${roomId} 开始自动投稿`);
        await this.upload({
          hash,
          file: resp.file,
          roomInfo,
          live: {
            startTime: liveStartTime,
            stopTime: liveStopTime,
            duration: liveDuration_ms,
          },
          recorder: {
            startTime: resp.startTime,
            stopTime: resp.stopTime,
            duration: resp.duration,
          },
          customOptions,
        });
        logger.info(`房间 ${roomId} 开始自动投稿结束`);
      } else {
        logger.info(`房间 ${roomId} 自动投稿已禁用, 投稿已取消`);
      }

      recorder.destroy();
      this.liveRecorders.delete(hash);
      this.hashToRoomIdMap.delete(hash);

      // Recorder 的生命结束
      logger.debug(`录制器 ${hash} 的生命结束，已从 liveRecorders 移除`);
      logger.debug(`录制器 ${hash} 的生命结束，映射已从 hashToRoomIdMap 移除`);
    });

    liveMonitor.on("status-change", (roomInfo) => {
      logger.info(
        `房间 ${roomId} 状态变化 -> ${BiliUtils.transformLiveStatus(
          roomInfo.live_status
        )}`
      );
    });

    logger.debug(`liveMonitor.startMonitor -> ${roomId}`);
    liveMonitor.startMonitor();
  }

  public removeRoom(roomId: number) {
    logger.info(`移除房间 ${roomId}`);

    if (!this.rooms.has(roomId)) {
      logger.debug(`无此房间，移除失败`);
      return;
    }

    this.emit("remove-room", roomId);
    logger.debug(`发射事件 remove-room -> ${roomId}`);

    this.rooms.delete(roomId);

    this.liveMonitors.get(roomId)?.destroy();
    this.liveMonitors.delete(roomId);

    logger.debug(`开始寻找该直播间的录制器 (roomId -> hash)`);

    let hashs: string[] = [];
    this.hashToRoomIdMap.forEach((_roomId, hash) => {
      if (_roomId === roomId) {
        logger.debug(`找到欲移除直播间的直播 Hash -> ${hash}`);
        hashs.push(hash);
      }
    });

    hashs.forEach((hash) => {
      const recorder = this.liveRecorders.get(hash);
      if (!recorder) {
        logger.warn(`意外的情况: 无负责录制的录制器的 Hash -> ${hash}`);
        this.hashToRoomIdMap.delete(hash);
        return;
      }

      recorder.destroy(true);
      logger.info(`负责 ${hash} 的录制器已销毁`);
    });
  }

  private async upload(options: UploadOptions) {
    const { hash, file, roomInfo, live, recorder, customOptions } = options;
    logger.debug(`采用投稿账号 -> ${customOptions?.account || "默认账号"}`);
    const biliApiInstance = customOptions?.account
      ? BiliApiService.getInstance(customOptions.account)
      : BiliApiService.getDefaultInstance();
    const userCard = await biliApiInstance.getUserCard(roomInfo.uid);
    const userName = userCard.card.name; // UP主 名字

    if (!live.startTime) throw new Error("开播时间未知");

    const session = FormatUtils.formatDateWithSession(new Date(live.startTime));

    const title = `【${userName}】${session} - ${roomInfo.title}`;

    const desc =
      `UP主: ${userName}\n` +
      `https://space.bilibili.com/${roomInfo.uid}\n\n` +
      `场次: ${session}\n` +
      `开播时间: ${
        live.startTime ? FormatUtils.formatDateTime(live.startTime) : "未知"
      }\n` +
      `结束直播: ${
        live.stopTime ? FormatUtils.formatDateTime(live.stopTime) : "未知"
      }\n` +
      `直播时长: ${FormatUtils.formatDurationWithoutSeconds(
        live.duration
      )}\n\n` +
      `开始录制: ${
        recorder.startTime
          ? FormatUtils.formatDateTime(recorder.startTime)
          : "未知"
      }\n` +
      `结束录制: ${
        recorder.stopTime
          ? FormatUtils.formatDateTime(recorder.stopTime)
          : "未知"
      }\n` +
      `录制时长: ${FormatUtils.formatDurationWithoutSeconds(
        recorder.duration
      )}\n\n` +
      `直播间标题: ${roomInfo.title}\n` +
      `直播间简介: ${roomInfo.description || "无"}\n` +
      `直播间地址: https://live.bilibili.com/${roomInfo.room_id}\n` +
      `侵权请私信\n\n` +
      (options.additionalDesc ? `${options.additionalDesc}\n\n` : "") +
      `本场直播 Hash: ${hash.substring(0, 7)}\n` +
      `由 Bili-Live-Hub v${getVersion()} 系统全自动录制`;

    const uploader = new VideoUploader(hash.substring(0, 7), biliApiInstance, {
      videos: [{ filePath: file, title: "", desc: "" }],
      videoInfo: {
        title: customOptions?.title || title,
        desc: customOptions?.desc || desc,
        cover: customOptions?.cover || roomInfo.keyframe,
        tid: customOptions?.tid || 27,
        tag: customOptions?.tag || "直播录像",
        season: {
          name: userName,
          autoCreate: {},
        },
      },
    });

    this.videoUploaders.set(hash, uploader);
    this.emit("new-uploader", uploader, hash, {
      ...options,
      userCard,
    });

    const resp = await uploader.upload();
    return resp;
  }

  private async forceStopRecord(
    recorder: LiveRecorder,
    hash: string,
    allowRestart = true
  ) {
    if (allowRestart) {
      this.waitingForRestartRecordTask.add(hash);
      logger.info(`任务 ${hash} 已放入等待区`);
    }

    const roomId = this.hashToRoomIdMap.get(hash);

    let shouldUpload = false;

    if (roomId === undefined) {
      logger.debug("强制停止失败, 从 waitingForRestartRecordTask 移除 hash");

      throw new Error(`强制停止时通过映射获取房间号失败, hash: ${hash}`);
    }

    try {
      const liveRoomConfig = liveConfigManager.get("rooms");
      const roomConfig = liveRoomConfig[roomId];

      try {
        if (!roomConfig) throw new Error(`未找到房间 ${roomId} 的配置文件`);
        if (typeof roomConfig.autoUpload !== "boolean")
          throw new Error(
            `房间 ${roomId} 的配置文件可以已经损坏, autoUpload 非逻辑值`
          );
        shouldUpload = roomConfig.autoUpload;
      } catch (e) {
        logger.error((e as Error).message);
      }

      if (shouldUpload) {
        const resp = await recorder.stopRecordAndMerge();
        // 手动获取直播间信息
        const roomInfo =
          await BiliApiService.getDefaultInstance().getLiveRoomInfo(roomId);

        const liveStartTime = new Date(roomInfo.live_time).getTime();

        logger.info(`${hash}录像 开始投稿`);
        const uploadResp = await this.upload({
          hash,
          file: resp.file,
          roomInfo,
          live: {
            startTime: liveStartTime,
            stopTime: 0,
            duration: 0,
          },
          recorder: {
            startTime: resp.startTime,
            stopTime: resp.stopTime,
            duration: resp.duration,
          },
          additionalDesc: "注意: 本次录像存在被异常终止情况",
          customOptions: roomConfig?.uploadOptions,
        });
        logger.info("视频投稿成功", uploadResp);

        if (allowRestart) {
          // 重置录制器，如要删除请在录制结束后删除
          await recorder.reset(true);
          logger.info(`强制停止允许 allowRestart，已 reset 录制器`);
        } else {
          recorder.destroy(true);
          this.liveRecorders.delete(hash);
          this.hashToRoomIdMap.delete(hash);
          logger.debug("强制停止禁用 allowRestart，已清理录制器");
        }
      } else {
        logger.info(`即将删除录像文件, 并不投稿`);
        const resp = await recorder.stopRecord();
        for (let file of resp.segmentFiles) {
          logger.debug(`delete file -> ${file}`);
          try {
            fs.unlinkSync(file);
            logger.info(`删除文件成功 -> ${file}`);
          } catch (e) {
            logger.error(`删除录像文件失败 ->`, e);
          }
        }
      }
    } catch (e) {
      if (allowRestart) {
        this.waitingForRestartRecordTask.delete(hash);
        logger.info(`强制停止任务失败，任务 ${hash} 已移出等待区`);
      }
      throw e;
    }
  }

  public getLiveMonitors() {
    return this.liveMonitors;
  }

  public getLiveRecorders() {
    return this.liveRecorders;
  }

  public getVideoUploaders() {
    return this.videoUploaders;
  }

  public getRecordersMapByRoomId(roomId: number) {
    const recorders = new Map<string, LiveRecorder>();
    this.hashToRoomIdMap.forEach((_roomId, hash) => {
      if (_roomId === roomId) {
        const recorder = this.liveRecorders.get(hash);
        if (recorder) {
          recorders.set(hash, recorder);
        } else {
          logger.warn(`存在无录制器负责的 hash -> ${hash}`);
        }
      }
    });

    return recorders;
  }

  public awaitLiveMonitorsPool() {
    const promises: Promise<any>[] = [];
    this.liveMonitors.forEach((monitor) => {
      promises.push(monitor.getFirstPoolPromise()!);
    });
    return Promise.all(promises);
  }
}
