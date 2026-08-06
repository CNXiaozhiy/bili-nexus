import EventEmitter from "events";
import LiveMessageStreamClient from "@/core/bilibili/live/live-message-stream";
import LiveRecorder from "@/core/bilibili/live/live-recorder";
import { appConfigManager, biliConfigManager, liveConfigManager } from "@/common";
import BiliAccountService from "../account/bili-account-service";
import getLogger from "@/utils/logger";
import { LiveRoomInfo, LiveRoomStatus, OpenState, UserCard } from "@/types/bilibili";
import { UploadOptions as CustomOptions } from "@/common/config";
import BiliUtils from "@/utils/bili";
import DiskSpaceMonitor from "@/core/disk/disk-space-monitor";
import notifyEmitter from "@/core/app/notify-emitter";
import VideoUploader from "@/core/bilibili/video/video-uploader";
import FormatUtils from "@/utils/format";
import { getVersion } from "../version";
import { BiliAccount } from "@/core/bilibili/bili-account";
import fs from "fs";

const logger = getLogger("LiveAutomationManager");

const MAX_RECORD_TIMEOUT = 8 * 60 * 60 * 1000;
const MANUAL_POOL_INTERVAL = 60 * 1000;

export class CustomBiliAccountNotFound extends Error {}

export interface RoomManageOptions {
  autoRecord: boolean;
  autoUpload: boolean;
}

export interface UploadOptions {
  hash: string;
  file: string;
  roomInfo: LiveRoomInfo; // 最好是开播时的房间数据，一般直播结束的瞬间的数据也能用
  live: { startTime: number; stopTime: number; duration: number };
  recorder: { startTime: number; stopTime: number; duration: number };
  additionalDesc?: string;
  customOptions?: CustomOptions;
}

export type UploadEventOptions = UploadOptions & { userCard: UserCard };

export interface LiveAutomationManagerEvents {
  "new-recorder": [liveRecorder: LiveRecorder, hash: string];
  "new-uploader": [videoUploader: VideoUploader, hash: string, uploadEventOptions: UploadEventOptions];

  "new-room": [roomId: number, client: LiveMessageStreamClient];
  "remove-room": [roomId: number];

  "live-start": [{ roomId: number; hash: string; roomInfo: LiveRoomInfo; isFirst: boolean }];
  "live-end": [
    | {
        roomId: number;
        hash: null;
        liveStartRoomInfo: null;
        liveEndRoomInfo: LiveRoomInfo;
        liveDuration: null;
        isFirst: true;
      }
    | {
        roomId: number;
        hash: string;
        liveStartRoomInfo: LiveRoomInfo;
        liveEndRoomInfo: LiveRoomInfo;
        liveDuration: number;
        isFirst: false;
      }
  ];
}

export default class LiveAutomationManager extends EventEmitter<LiveAutomationManagerEvents> {
  private rooms = new Set<number>();

  private roomIdToHashMap: Map<number, string> = new Map();
  private roomIdToRoomManageOptions: Map<number, RoomManageOptions> = new Map();
  private hashToRoomInfoMap: Map<
    string,
    {
      roomId: number;
      liveStartTime: number;
      liveStartRoomInfo: LiveRoomInfo; // 开播时的房间数据
    }
  > = new Map(); // Hash -> RoomInfo

  private firstFlagMap: Set<number> = new Set(); // roomId
  private liveStatusMap: Map<number, boolean> = new Map(); // RoomId -> IsLive

  public liveMessageStreamClients: Map<number, LiveMessageStreamClient> = new Map(); // RoomId -> Client
  public liveRecorders: Map<string, LiveRecorder> = new Map(); // Hash -> LiveRecorder
  public videoUploaders: Map<string, VideoUploader> = new Map(); // Hash -> VideoUploader

  public failedSubmission: Map<string, () => Promise<any>> = new Map(); // short Hash -> submission function

  public diskSpaceMonitor: DiskSpaceMonitor = new DiskSpaceMonitor(appConfigManager.get("recordingDir"), {
    checkInterval: 30000,
    lowSpaceThreshold: 10 * 1024 * 1024 * 1024, // 10GB
    criticalSpaceThreshold: 5 * 1024 * 1024 * 1024, // 5GB
    fatalSpaceThreshold: 100 * 1024 * 1024, // 100MB
  });

  // 录制超时计时器
  private recordTimeouts = new Map<string, NodeJS.Timeout>(); // Hash -> Timeout

  private manualPollInterval: NodeJS.Timeout | null = null;

  private waitingForRestartRecordTask = new Set<string>(); // 直播Hash

  // 状态锁，防止并发清理
  private processingHashes = new Set<string>(); // 正在处理的Hash
  private hashLocks = new Map<string, Promise<void>>(); // Hash级别的锁

  constructor(private readonly biliAccount: BiliAccount) {
    super();

    this.initDiskSpaceMonitor();

    this.manualPollInterval = setInterval(() => this.manualPoll(), MANUAL_POOL_INTERVAL);
    logger.info("混合拉取 -> 已安装 manualPoll 定时器");
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
        notifyEmitter.emit("msg-warn", "严重警告: 磁盘空间不足，且当前无录制任务，请立即检查磁盘状态！");
        logger.error("磁盘空间不足，且当前无录制任务，请立即检查磁盘状态");
        return;
      }

      const randomTaskCount = Math.floor(taskCount * 0.5);
      logger.info(`即将随机暂停 ${randomTaskCount} 个任务`);

      const allHashes = Array.from(this.liveRecorders.keys());
      const shuffledHashes = allHashes.sort(() => 0.5 - Math.random());

      const hashesToStop = shuffledHashes.slice(0, Math.min(randomTaskCount, allHashes.length));

      hashesToStop.forEach((hash) => {
        const recorder = this.liveRecorders.get(hash);
        logger.info(`开始停止任务 -> ${hash}`);
        if (recorder) {
          this.forceStopRecord(recorder, hash, true)
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

  public addRoom(roomId: number, roomManageOptions: RoomManageOptions, manualPoll = true) {
    logger.info(`添加房间 ${roomId} 成功 ✅`);

    if (this.rooms.has(roomId)) {
      logger.debug(`房间已添加, 添加失败`);
      return;
    }

    this.rooms.add(roomId);
    this.roomIdToRoomManageOptions.set(roomId, roomManageOptions);

    const client = new LiveMessageStreamClient(roomId, this.biliAccount);

    this.liveMessageStreamClients.set(roomId, client);

    this.emit("new-room", roomId, client);
    logger.debug(`发射事件 new-room -> roomId: ${roomId}`);

    this.installLiveMessageStreamClientEventListeners(client, roomId, roomManageOptions);

    logger.info(`开始连接直播间信息流 -> ${roomId}`);
    logger.debug(`client.connect -> ${roomId}`);
    client.connect();

    if (manualPoll) this.manualPoll(roomId);
  }

  public batchAddRooms(options: { roomId: number; roomManageOptions: RoomManageOptions }[]) {
    options.forEach(({ roomId, roomManageOptions }) => this.addRoom(roomId, roomManageOptions, false));

    logger.debug("批量添加房间完成，开始拉取数据");
    this.manualPoll();
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

    const client = this.liveMessageStreamClients.get(roomId);
    if (client) {
      client.destroy();
      this.liveMessageStreamClients.delete(roomId);
    }

    logger.debug(`开始寻找该直播间的录制器 (roomId -> hash)`);

    let hashs: string[] = [];
    this.hashToRoomInfoMap.forEach(({ roomId: _roomId }, hash) => {
      if (_roomId === roomId) {
        logger.debug(`找到欲移除直播间的直播 Hash -> ${hash}`);
        hashs.push(hash);
      }
    });

    hashs.forEach((hash) => {
      const recorder = this.liveRecorders.get(hash);
      if (!recorder) {
        logger.warn(`意外的情况: 无负责录制的录制器的 Hash -> ${hash}`);
        this.hashToRoomInfoMap.delete(hash);
        return;
      }

      recorder.destroy(true);
      logger.info(`负责 ${hash} 的录制器已销毁`);
    });
  }

  public async retryUpload(hash: string) {
    const submissionFunc = this.failedSubmission.get(hash);

    if (!submissionFunc) {
      logger.warn(`无法找到失败的投稿任务 -> ${hash}`);
      return null;
    }

    try {
      const resp = await submissionFunc();

      this.failedSubmission.delete(hash);
      logger.debug("已从失败任务列表中删除该任务");

      logger.info(hash + " 重试投稿成功✅", resp);
      return resp;
    } catch (e) {
      logger.error(hash + " 重试投稿失败❌", e);
      throw e;
    }
  }

  public manualAddFailedSubmission(options: {
    hash: string;
    file: string;
    liveRoomInfo: LiveRoomInfo;
    liveStartTime: number;
    liveStopTime: number;
    liveDuration: number;
    recordStartTime: number;
    recordStopTime: number;
    recordDuration: number;
    customOptions: CustomOptions;
  }) {
    const submissionFunc = async () => {
      return await this.upload({
        hash: options.hash,
        file: options.file,
        roomInfo: options.liveRoomInfo,
        live: {
          startTime: options.liveStartTime,
          stopTime: options.liveStopTime,
          duration: options.liveDuration,
        },
        recorder: {
          startTime: options.recordStartTime,
          stopTime: options.recordDuration,
          duration: options.recordDuration,
        },
        customOptions: options.customOptions,
      });
    };

    logger.debug("手动添加失败的投稿任务成功 -> " + options.hash);
    this.failedSubmission.set(options.hash, submissionFunc);
  }

  // 用于强制结束程序
  public forceStopRecordAll() {
    const promises: Promise<void>[] = [];
    this.liveRecorders.forEach((recorder, hash) => {
      promises.push(this.forceStopRecord(recorder, hash, false));
    });
    return Promise.all(promises);
  }

  public forceClearRecording(hash: string, deleteFile: boolean) {
    this.clearRecording(hash, deleteFile);
  }

  public forceStopRecording(hash: string, allowRestart = true) {
    const recorder = this.liveRecorders.get(hash);
    if (!recorder) return Promise.reject("无效 Hash，未找到对应的录制器");

    return this.forceStopRecord(recorder, hash, allowRestart);
  }

  private installLiveMessageStreamClientEventListeners(client: LiveMessageStreamClient, roomId: number, roomManageOptions: RoomManageOptions) {
    // Install listeners
    client.on("LIVE", async () => {
      logger.debug(`房间 ${roomId} -> 触发 LIVE 事件`);

      if (this.liveStatusMap.get(roomId) === true) {
        logger.warn(`房间 ${roomId} -> 重复触发 LIVE 事件, 跳过处理`);
        return;
      }

      this.liveStatusMap.set(roomId, true);

      const roomInfo = await this.biliAccount.getBiliApi().getLiveRoomInfo(roomId);

      if (roomInfo.live_status !== LiveRoomStatus.LIVE) {
        notifyEmitter.emit("msg-error", `${roomId} -> 直播状态不同步, Client: ${LiveRoomStatus.LIVE}, API: ${roomInfo.live_status}`);
        logger.error(`${roomId} -> 直播状态不同步, Client: ${LiveRoomStatus.LIVE}, API: ${roomInfo.live_status}`);
        return;
      }

      const hashs = BiliUtils.computeHash(roomId, new Date(roomInfo.live_time).getTime());

      this.handleLiveStart(hashs, roomInfo, roomManageOptions);
    });

    client.on("PREPARING", async () => {
      logger.debug(`房间 ${roomId} -> 触发 PREPARING 事件`);

      if (this.liveStatusMap.get(roomId) === false) {
        logger.warn(`房间 ${roomId} -> 重复触发 PREPARING 事件, 跳过处理`);
        return;
      }

      this.liveStatusMap.set(roomId, false);

      const hash = this.roomIdToHashMap.get(roomId);
      if (!hash) {
        logger.error(`无法找到 Hash -> ${roomId} 的映射`);
        return;
      }

      const roomInfo = await this.biliAccount.getBiliApi().getLiveRoomInfo(roomId);

      this.handleLiveEnd({
        hash,
        roomId,
        liveEndRoomInfo: roomInfo,
        roomManageOptions,
      });
    });
  }

  private manualPoll(roomIds: number | number[] | null = null) {
    const rooms = roomIds ? (Array.isArray(roomIds) ? roomIds : [roomIds]) : Array.from(this.rooms);

    if (rooms.length === 0) return;

    this.biliAccount
      .getBiliApi()
      .batchGetLiveRoomInfo(rooms)
      .then(({ by_room_ids: roomInfos }) => {
        for (const key in roomInfos) {
          const roomInfo = roomInfos[key];
          const roomId = roomInfo.room_id;

          if (roomInfo.live_status === LiveRoomStatus.LIVE) {
            if (this.liveStatusMap.get(roomId) === true) return; // 已经被 LiveMessageStream 通知过
            if (!this.firstFlagMap.has(roomId)) {
              logger.debug(`房间 ${roomId} -> 首次拉取(直播中)`);
            } else {
              logger.warn(`房间 ${roomId} -> LiveMessageStream 漏触发 LIVE 事件, 开始处理`);
              notifyEmitter.emit("msg-warn", `[manualPoll]\n房间 ${roomId} -> LiveMessageStream 漏触发 LIVE 事件, 开始处理`);
            }
            this.liveStatusMap.set(roomId, true);

            this.biliAccount
              .getBiliApi()
              .getLiveRoomInfo(roomId)
              .then((roomInfo) => {
                if (roomInfo.live_status !== LiveRoomStatus.LIVE) {
                  logger.warn(`manualPoll -> 房间 ${roomId} -> 直播状态不同步, Client: ${LiveRoomStatus.LIVE}, API: ${roomInfo.live_status}, 触发直播通知流程中断`);
                  notifyEmitter.emit("msg-error", `[manualPoll]\n房间 ${roomId} -> manualPoll 直播状态不同步, Client: ${LiveRoomStatus.LIVE}, API: ${roomInfo.live_status}, 触发直播通知流程中断`);
                  return;
                }

                const roomManageOptions = this.roomIdToRoomManageOptions.get(roomId);

                if (!roomManageOptions) {
                  logger.error(`无法找到 RoomId -> RoomManageOptions 的映射 -> ${roomId}`);
                  notifyEmitter.emit("msg-error", `[manualPoll]\n无法找到 ${roomId} -> RoomManageOptions 的映射, 触发直播通知流程中断`);
                  return;
                }

                this.handleLiveStart(BiliUtils.computeHash(roomId, new Date(roomInfo.live_time).getTime()), roomInfo, roomManageOptions);
              })
              .catch((err) => {
                logger.error(`房间 ${roomId} -> 获取直播信息失败 -> ${err}, 触发直播通知流程中断`);
                notifyEmitter.emit("msg-error", `[manualPoll]\n房间 ${roomId} -> 获取直播信息失败 -> ${err}, 触发直播通知流程中断`);
              });
          } else if (roomInfo.live_status === LiveRoomStatus.SLIDESHOW || roomInfo.live_status === LiveRoomStatus.END) {
            if (this.liveStatusMap.get(roomId) === false) return; // 已经被 LiveMessageStream 通知过
            if (!this.firstFlagMap.has(roomId)) {
              logger.debug(`WARN: 房间 ${roomId} -> 首次拉取(轮播/关播)，不存在开播时的直播数据`);
            } else {
              logger.warn(`房间 ${roomId} -> LiveMessageStream 漏触发 PREPARING 事件, 开始处理`);
              notifyEmitter.emit("msg-warn", `[manualPoll]\n房间 ${roomId} -> LiveMessageStream 漏触发 PREPARING 事件, 开始处理`);
            }
            this.liveStatusMap.set(roomId, false);

            this.biliAccount
              .getBiliApi()
              .getLiveRoomInfo(roomId)
              .then((roomInfo) => {
                if (roomInfo.live_status === LiveRoomStatus.LIVE) {
                  logger.warn(`manualPoll -> 房间 ${roomId} -> 直播状态不同步, Client: ${LiveRoomStatus.LIVE}, API: ${roomInfo.live_status}, 触发直播通知流程中断`);
                  notifyEmitter.emit("msg-error", `[manualPoll]\n房间 ${roomId} -> manualPoll 直播状态不同步, Client: ${LiveRoomStatus.LIVE}, API: ${roomInfo.live_status}, 触发直播通知流程中断`);
                  return;
                }

                const roomManageOptions = this.roomIdToRoomManageOptions.get(roomId);

                if (!roomManageOptions) {
                  logger.error(`无法找到 RoomId -> RoomManageOptions 的映射 -> ${roomId}, 触发直播结束通知流程中断`);
                  notifyEmitter.emit("msg-error", `[manualPoll]\n无法找到 ${roomId} -> RoomManageOptions 的映射, 触发直播结束通知流程中断`);
                  return;
                }

                this.handleLiveEnd({
                  hash: null,
                  roomId,
                  liveEndRoomInfo: roomInfo,
                  roomManageOptions,
                });
              })
              .catch((err) => {
                logger.error(`房间 ${roomId} -> 获取直播信息失败 -> ${err}, 触发直播结束通知流程中断`);
                notifyEmitter.emit("msg-error", `[manualPoll]\n房间 ${roomId} -> 获取直播信息失败 -> ${err}, 触发直播结束通知流程中断`);
              });
          } else {
            notifyEmitter.emit("msg-error", `[manualPoll]\n房间 ${roomId} -> 直播状态未知, API: ${roomInfo.live_status}`);
            logger.error(`${roomId} -> 直播状态未知, API: ${roomInfo.live_status}`);
          }
        }
      })
      .catch((err) => {
        logger.warn(`manualPoll -> 获取直播信息失败 -> ${err}`);
      });
  }

  private async handleLiveStart({ hash, sessionHash }: { hash: string; sessionHash: string }, roomInfo: LiveRoomInfo, roomManageOptions: RoomManageOptions) {
    const roomId = roomInfo.room_id;

    this.hashToRoomInfoMap.set(hash, {
      roomId,
      liveStartRoomInfo: roomInfo,
      liveStartTime: new Date(roomInfo.live_time).getTime(),
    });

    logger.debug(`已创建 Hash -> RoomInfo 映射: ${hash} -> ${roomId}`);

    this.roomIdToHashMap.set(roomId, hash);

    logger.debug(`已创建 RoomId -> Hash 映射: ${roomId} -> ${hash}`);

    logger.info(`房间 ${roomId} 开始直播`);

    const isFirst = !this.firstFlagMap.has(roomId);

    logger.debug(`发射事件 live-start -> roomId: ${roomId}, hash: ${hash}, isFirst: ${isFirst}`);
    this.emit("live-start", { roomId, hash, roomInfo, isFirst });

    if (isFirst) {
      logger.debug(`已标记房间 ${roomId} 为首次检查直播状态`);
      this.firstFlagMap.add(roomId);
    }

    if (!roomManageOptions.autoRecord) {
      logger.info(`房间 ${roomId} 自动录制已禁用`);
    } else {
      logger.info(`房间 ${roomId} 准备录制`);

      const inputUrls = await this.biliAccount.getBiliApi().getLiveStreamUrl(roomId);
      const inputUrl = inputUrls[0];
      const recordingDir = appConfigManager.get("recordingDir");
      const recorder = new LiveRecorder({
        hash,
        sessionHash,
        inputUrl,
        recordingDir,
      });

      // Install Listeners
      recorder.on("start", (isFirst) => {
        if (isFirst) {
          this.recordTimeouts.set(
            hash,
            setTimeout(() => {
              logger.warn(`录制任务 ${hash} 超过最大录制时长限制, 尝试强制停止录制任务`);

              this.forceStopRecord(recorder, hash, true)
                .then(() => {
                  logger.info(`停止任务 ${hash} -> 成功`);
                })
                .catch((e) => {
                  logger.error(`停止任务 ${hash} -> 失败,`, e);
                  logger.warn(`停止录制任务失败, 则这个任务仍会继续运行`);
                });

              clearTimeout(this.recordTimeouts.get(hash));
              this.recordTimeouts.delete(hash);
            }, MAX_RECORD_TIMEOUT)
          );
          logger.debug(`已设置 ${hash} 的录制时长超时计时器`);
        }

        logger.debug(`录制器 ${hash} 开始录制`);
      });

      recorder.on("end", () => {
        this.biliAccount
          .getBiliApi()
          .getLiveRoomInfo(roomId)
          .then((roomInfo) => {
            logger.info(`收到 LiveRecorder.${hash} 录制完成 事件, 开始检查是否未异常结束`);
            if (roomInfo.live_status === LiveRoomStatus.LIVE) {
              logger.info(`${hash} 录制为异常结束`);
              recorder.retryRecord();
            } else {
              logger.debug(`${hash} 录制为正常结束, 由 handleLiveEnd 处理剩余事务`);
            }
          });
      });

      recorder.on("err", (err) => {
        logger.error(`房间 ${roomId} 录制失败: ${err}`);
        logger.debug("尝试更换直播流");

        this.biliAccount
          .getBiliApi()
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

      if (this.diskSpaceMonitor.getCurrentStatus().status === "abnormal") {
        this.waitingForRestartRecordTask.add(hash);
        logger.warn(`当前磁盘处于异常状态，已将录制任务放入等待区`);
      } else {
        recorder.startRecord();
        logger.info(`房间 ${roomId} 开始录制`);
      }
    }
  }

  private async handleLiveEnd(options: { hash: string | null; roomId: number; liveEndRoomInfo: LiveRoomInfo; roomManageOptions: RoomManageOptions }) {
    const { hash, roomId, liveEndRoomInfo, roomManageOptions } = options;

    if (!this.firstFlagMap.has(roomId)) {
      logger.debug(`已标记房间 ${roomId} 为首次检查直播状态`);
      this.firstFlagMap.add(roomId);
    }

    if (hash == null) {
      logger.debug(`首次 live-end, hash -> null`);
      this.emit("live-end", {
        roomId,
        hash: null,
        liveStartRoomInfo: null,
        liveEndRoomInfo,
        liveDuration: null,
        isFirst: true,
      });
      return;
    }

    const _roomInfo = this.hashToRoomInfoMap.get(hash);

    if (!_roomInfo) {
      logger.warn(`无法找到 Hash -> RoomInfo 映射 -> ${hash}`);
      return;
    }

    const { liveStartRoomInfo, liveStartTime } = _roomInfo;
    const liveStopTime = Date.now();
    const liveDuration = liveStopTime - liveStartTime;

    logger.info(`房间 ${roomId} 结束直播`);

    logger.debug(`发射事件 live-end -> roomId: ${roomId}`);
    this.emit("live-end", {
      roomId,
      hash,
      liveStartRoomInfo,
      liveEndRoomInfo,
      liveDuration,
      isFirst: false,
    });

    // 清除录制超时计时器
    if (this.recordTimeouts.has(hash)) {
      logger.debug(`清理录制超时计时器, hash:`, hash);
      clearTimeout(this.recordTimeouts.get(hash)!);
      this.recordTimeouts.delete(hash);
    }

    // 检查是否正在被处理（防止并发清理）
    if (this.processingHashes.has(hash)) {
      logger.info(`hash ${hash} 正在被处理中，等待处理完成后再继续LiveEnd事务`);

      // 等待当前 hashLock 处理完成
      const lock = this.hashLocks.get(hash);
      if (lock) {
        logger.debug(`等待hash ${hash} 的当前 HashLock 处理完成`);
        await lock;
        logger.debug(`${hash} 的hashLock 已解锁🔓，继续LiveEnd事务`);
      } else {
        logger.debug(`hash ${hash} 正在被处理中，却不存在HashLock，说明可能处理已结束但标记未清除`);
      }
      this.processingHashes.delete(hash);
    }

    try {
      // 标记为正在处理
      this.processingHashes.add(hash);

      // 是否仍然位于等待队列
      if (this.waitingForRestartRecordTask.has(hash)) {
        logger.info(`本场直播 ${hash} 仍位于等待队列，清理录制器`);
        const recorder = this.liveRecorders.get(hash);
        if (recorder) {
          this.clearRecording(hash, true); // deleteFile = true 正常情况无意义
          logger.debug(`清理负责 ${hash} 的录制器完成 ✅`);
        }

        logger.debug("handleLiveEnd -> 放弃剩余事务");
        return;
      }

      const recorder = this.liveRecorders.get(hash);

      if (!recorder) {
        logger.debug(`未找到 ${hash} 的录制器, handleLiveEnd -> 放弃剩余事务`);
        return;
      }

      logger.info(`房间 ${roomId} 开始停止录制, ${hash} 录制器 -> stopRecord()`);

      if (!recorder.isRunning()) {
        logger.debug(`WARN: ${hash} 的录制器未在录制`);
      }

      const customOptions = liveConfigManager.get("rooms")[roomId]?.uploadOptions;

      try {
        const resp = await recorder.stopRecordAndMerge();
        const { file } = resp;

        const fileStat = fs.statSync(file);
        logger.debug(`房间 ${roomId}.${hash} 最终录制文件大小:`, fileStat.size);

        if (roomManageOptions.autoUpload) {
          logger.info(`房间 ${roomId} 开始自动投稿`);

          const submissionFunc = async () => {
            return await this.upload({
              hash,
              file: resp.file,
              roomInfo: liveStartRoomInfo,
              live: {
                startTime: liveStartTime,
                stopTime: liveStopTime,
                duration: liveDuration,
              },
              recorder: {
                startTime: resp.startTime,
                stopTime: resp.stopTime,
                duration: resp.duration,
              },
              customOptions,
            });
          };

          try {
            const resp = await submissionFunc();
            logger.info(`房间 ${roomId} 自动投稿成功✅`, resp);

            resp.tracker.once("open", () => {
              this.clearRecording(hash, true);

              try {
                if (fs.existsSync(file)) {
                  fs.unlinkSync(file);
                }

                logger.info(`审核通过，录制器 ${hash} 录制文件已清理 🧹`);
              } catch (e) {
                logger.error(`清理 ${hash} 的录制文件失败❌`, e);
              }
            });

            logger.debug(`投稿成功，房间 ${roomId} 的录制器 ${hash} 会在视频审核通过后自动清理 once(open)`);
          } catch (e) {
            logger.debug(`房间 ${roomId} 自动投稿失败❌, 已创建重投函数`);
            this.failedSubmission.set(hash, submissionFunc);
            throw e;
          }

          logger.info(`房间 ${roomId} 自动投稿结束`);
        } else {
          logger.info(`房间 ${roomId} 自动投稿已禁用, 投稿已取消`);
        }

        // Recorder 的生命结束
        logger.debug(`录制器 ${hash} 的生命已结束`);
      } catch (e) {
        logger.error("停止录制或投稿失败 ❌", e);

        notifyEmitter.emit(
          "msg-warn",
          `停止录制或投稿失败 ❌\n\n` +
            "错误：\n" +
            FormatUtils.formatErrorMessage("UploadVideoError", e as Error) +
            `\n\n` +
            `您可以尝试重新投稿\n` +
            `文件：${recorder.getSegmentFiles().join(", ")}\n` +
            `部分投稿配置：\n` +
            JSON.stringify({
              hash,
              roomInfo: liveEndRoomInfo,
              live: {
                startTime: liveStartTime,
                stopTime: liveStopTime,
                duration: liveDuration,
              },
              recorder: {
                startTime: recorder.getStats().startTime,
                stopTime: recorder.getStats().stopTime,
                duration: recorder.getStats().duration,
              },
              customOptions,
            })
        );

        this.clearRecording(hash, false);

        // Recorder 的生命结束
        logger.debug(`录制器 ${hash} 的生命已结束，由于投稿失败，资源暂未清理 ⌛️`);
      }

      logger.debug("handleLiveEnd -> 完成");
    } finally {
      // 清理处理标记
      logger.debug(`${hash} -> 处理完成`);
      this.processingHashes.delete(hash);
    }
  }

  private async upload(options: UploadOptions) {
    const { hash, file, roomInfo, live, recorder, customOptions } = options;
    logger.debug(`采用投稿账号 -> ${customOptions?.account || "默认账号"}`);
    const biliAccount = customOptions?.account ? BiliAccountService.getBiliAccount(customOptions.account) : this.biliAccount;

    if (!biliAccount) {
      throw new CustomBiliAccountNotFound();
    }

    const biliApi = biliAccount.getBiliApi();
    const userCard = await biliApi.getUserCard(roomInfo.uid);
    const userName = userCard.card.name; // UP主 名字

    // if (!live.startTime) throw new Error("开播时间未知");

    const session = live.startTime ? FormatUtils.formatDateWithSession(new Date(live.startTime)) : "";

    const title = `【${userName}】${session} - ${roomInfo.title}`;

    const desc =
      `UP主: ${userName}\n` +
      `https://space.bilibili.com/${roomInfo.uid}\n\n` +
      `场次: ${session}\n` +
      `开播时间: ${live.startTime ? FormatUtils.formatDateTime(live.startTime) : "未知"}\n` +
      `结束直播: ${live.stopTime ? FormatUtils.formatDateTime(live.stopTime) : "未知"}\n` +
      `直播时长: ${live.duration ? FormatUtils.formatDurationWithoutSeconds(live.duration) : "未知"}\n\n` +
      `开始录制: ${recorder.startTime ? FormatUtils.formatDateTime(recorder.startTime) : "未知"}\n` +
      `结束录制: ${recorder.stopTime ? FormatUtils.formatDateTime(recorder.stopTime) : "未知"}\n` +
      `录制时长: ${recorder.duration ? FormatUtils.formatDurationWithoutSeconds(recorder.duration) : "未知"}\n\n` +
      `直播间标题: ${roomInfo.title}\n` +
      `直播间简介: ${roomInfo.description || "无"}\n` +
      `直播间地址: https://live.bilibili.com/${roomInfo.room_id}\n` +
      `侵权请私信\n\n` +
      (options.additionalDesc ? `${options.additionalDesc}\n\n` : "") +
      `本场直播 Hash: ${hash.substring(0, 7)}\n` +
      `由 Bili-Nexus v${getVersion()} 系统全自动录制`;

    const uploader = new VideoUploader(hash.substring(0, 7), biliAccount, {
      videos: [{ filePath: file, title: "", desc: "" }],
      videoInfo: {
        title: customOptions?.title || title,
        desc: customOptions?.desc || desc,
        cover: customOptions?.cover || roomInfo.keyframe || roomInfo.user_cover,
        tid: customOptions?.tid || 27,
        tag: customOptions?.tag,
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

  private async forceStopRecord(recorder: LiveRecorder, hash: string, allowRestart = true) {
    logger.debug(`${hash} -> 任务开始强制结束`);

    let resolveLock: (() => void) | undefined;
    const lockPromise = new Promise<void>((resolve) => {
      resolveLock = resolve;
    });
    this.hashLocks.set(hash, lockPromise);

    logger.debug(`${hash} -> foreceStop -> HashLock 上锁🔒`);

    if (allowRestart) {
      this.waitingForRestartRecordTask.add(hash);
      logger.info(`任务 ${hash} 已放入等待区`);
    }

    try {
      this.processingHashes.add(hash);

      let shouldUpload = false;

      const roomInfo = this.hashToRoomInfoMap.get(hash);

      if (roomInfo === undefined) {
        throw new Error(`强制停止时通过映射获取房间信息失败, hash: ${hash}`);
      }

      const roomId = roomInfo.roomId;

      const liveRoomConfig = liveConfigManager.get("rooms");
      const roomConfig = liveRoomConfig[roomId];

      try {
        if (!roomConfig) throw new Error(`未找到房间 ${roomId} 的配置文件`);
        if (typeof roomConfig.autoUpload !== "boolean") throw new Error(`房间 ${roomId} 的配置文件可以已经损坏, autoUpload 非逻辑值`);
        shouldUpload = roomConfig.autoUpload;
      } catch (e) {
        logger.error((e as Error).message);
      }

      if (shouldUpload) {
        const resp = await recorder.stopRecordAndMerge();
        // 手动获取直播间信息
        const roomInfo = await this.biliAccount.getBiliApi().getLiveRoomInfo(roomId);

        const liveStartTime = new Date(roomInfo.live_time).getTime();

        logger.info(`${hash}录像 开始投稿`);

        const submissionFunc = async () => {
          return await this.upload({
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
        };

        try {
          const uploadResp = await submissionFunc();
          logger.info("视频投稿成功✅", uploadResp);
        } catch (e) {
          this.failedSubmission.set(hash, submissionFunc);
          logger.debug(`房间 ${roomId} 自动投稿失败❌, 已创建重投函数`);

          throw e;
        }

        if (allowRestart) {
          // 重置录制器，如要删除请在录制结束后删除
          await recorder.reset(true);
          logger.info(`强制停止 -> 参数: 允许 allowRestart，已重置录制器`);
        } else {
          this.clearRecording(hash);
          logger.debug("强制停止 -> 参数: 禁用 allowRestart，已清理录制器");
        }
      } else {
        logger.info(`即将删除录像文件, 并不投稿`);
        this.clearRecording(hash, true);
      }
    } catch (e) {
      logger.warn(`强制停止失败,`, e);
      if (allowRestart) {
        this.waitingForRestartRecordTask.delete(hash);
        logger.info(`强制停止任务失败，任务 ${hash} 已移出等待区`);
      }
      throw e;
    } finally {
      logger.debug(`${hash} -> forceStop -> finally -> HashLock 解锁🔓`);
      this.processingHashes.delete(hash);
      if (resolveLock) resolveLock();
      this.hashLocks.delete(hash);
    }
  }

  private clearRecording(hash: string, deleteFile = false) {
    logger.debug(`开始清理录制记录 -> ${hash}`);

    if (this.liveRecorders.has(hash)) {
      logger.debug(`已开始销毁录制器 -> ${hash}`);
      this.liveRecorders.get(hash)?.destroy(deleteFile);

      logger.debug(`已从录制器组中删除录制器 -> ${hash}`);
      this.liveRecorders.delete(hash);
    } else {
      logger.warn(`录制器组中无此录制器 -> ${hash}`);
    }

    if (this.hashToRoomInfoMap.has(hash)) {
      logger.debug(`已删除 Hash -> RoomInfo 映射: ${hash} -> ${this.hashToRoomInfoMap.get(hash)}`);
      this.hashToRoomInfoMap.delete(hash);
    }

    if (this.waitingForRestartRecordTask.has(hash)) {
      logger.debug(`已从等待队列中删除录制器 -> ${hash}`);
      this.waitingForRestartRecordTask.delete(hash);
    }
  }

  public getClients() {
    return this.liveMessageStreamClients;
  }

  public getLiveRecorders() {
    return this.liveRecorders;
  }

  public getVideoUploaders() {
    return this.videoUploaders;
  }

  public getRecordersMapByRoomId(roomId: number) {
    const recorders = new Map<string, LiveRecorder>();
    this.hashToRoomInfoMap.forEach(({ roomId: _roomId }, hash) => {
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

  public getUploadersMapByRoomId(roomId: number) {
    const uploaders = new Map<string, VideoUploader>();
    this.hashToRoomInfoMap.forEach(({ roomId: _roomId }, hash) => {
      if (_roomId === roomId) {
        const uploader = this.videoUploaders.get(hash);
        if (uploader) {
          uploaders.set(hash, uploader);
        } else {
          logger.warn(`存在无录制器器负责的 hash -> ${hash}`);
        }
      }
    });

    return uploaders;
  }

  public getUploader(hash: string) {
    return this.videoUploaders.get(hash);
  }
}
