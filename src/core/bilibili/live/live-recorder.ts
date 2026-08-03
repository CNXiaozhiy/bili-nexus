import EventEmitter from "events";
import fs from "fs";
import Ffmpeg, { RecordFfmpeg } from "@/core/ffmpeg";
import { FfmpegStats } from "@/types/ffmpeg";
import getLogger from "@/utils/logger";
import { FfmpegError } from "@/types/errors/ffmpeg";
import { LiveRecorderIsDestroyedError, LiveRecorderMaxRetriesError } from "@/types/errors/live-recorder";
import path from "path";
import FormatUtils from "@/utils/format";
import TimeUtils from "@/utils/time";
import notifyEmitter from "@/core/app/notify-emitter";

export interface LiveRecorderEvents {
  start: [isFirst: boolean];
  progress: [stats: FfmpegStats];
  end: [duration: number];
  err: [error: Error];
}

export default class LiveRecorder extends EventEmitter<LiveRecorderEvents> {
  public static BASE_RETRY_DELAY: number = 10000;
  public static MAX_RETRY_DELAY: number = 120000;
  public static MAX_RETRY_COUNT: number = Infinity;
  public static WATCHDOG_CHECK_INTERVAL: number = 30000;
  public static WATCHDOG_HEARTBEAT_TIMEOUT: number = 60000;

  private logger;

  private _destroyed: boolean = false;

  private inputUrl: string;
  private recordingDir: string;
  public hash: string; // 每一次直播的唯一标识
  public sessionHash: string;

  private recFfmpeg: RecordFfmpeg | null = null;
  private ffmpegRunning: boolean = false;

  private segmentFiles: string[] = [];

  // Stats
  private retryCount: number = 0;
  private startTime: number = 0;
  private stopTime: number = 0;
  private totalDuration: number = 0;

  // Important
  private ffmpegStats: FfmpegStats | null = null;

  // Watchdog
  private lastProgressHeartbeat: number = 0;
  private watchdogTimeout: NodeJS.Timeout | null = null;

  private retryTimeout: NodeJS.Timeout | null = null;

  private static calculateRetryDelay(retryCount: number) {
    const delay = Math.pow(2, retryCount) * LiveRecorder.BASE_RETRY_DELAY;

    if (delay > LiveRecorder.MAX_RETRY_DELAY) return LiveRecorder.MAX_RETRY_DELAY;

    return delay;
  }

  public isRunning() {
    return this.ffmpegRunning;
  }

  constructor(options: { hash: string; sessionHash: string; inputUrl: string; recordingDir: string }) {
    super();
    this.logger = getLogger("LiveRecorder." + options.hash.substring(0, 7));
    this.hash = options.hash;
    this.sessionHash = options.sessionHash;
    this.inputUrl = options.inputUrl;
    this.recordingDir = path.resolve(options.recordingDir);
  }

  private _runWatchdog() {
    this._killWatchdog();

    this.watchdogTimeout = setInterval(() => {
      if (Date.now() - this.lastProgressHeartbeat > LiveRecorder.WATCHDOG_HEARTBEAT_TIMEOUT) {
        this.logger.warn("[Watchdog]", "检测到录制进程长时间未响应❌，可能已经卡死，准备结束分段");
        this._killWatchdog();
        this.logger.debug("[Watchdog]", "killed Watchdog");

        this.logger.debug("[Watchdog]", "当前分段文件数组", this.segmentFiles);

        if (this.ffmpegStats) {
          this.logger.debug("[Watchdog]", "当前分段ffmpegStats", this.ffmpegStats);
          this.totalDuration += TimeUtils.parseTimeToMsRegex(this.ffmpegStats.time!);
          this.logger.debug("[Watchdog]", "totalDuration 更新成功", this.totalDuration, ", 本次分段 stats.time: ", this.ffmpegStats.time);
        } else {
          this.logger.debug("[Watchdog]", "totalDuration 更新失败, 本次分段录制失败, 无 stats 数据");
          // 录制失败
        }

        if (!this.recFfmpeg) {
          this.logger.error("[Watchdog]", "录制进程不存在，尝试重启进程");
          this.retryRecord();
        } else {
          this.recFfmpeg.removeAllListeners();

          const timeout = setTimeout(() => {
            this.logger.warn("[Watchdog]", "录制进程无法安全结束，强制结束并重启进程");
            this.recFfmpeg?.removeAllListeners();
            this.recFfmpeg?.kill();
            this.retryRecord();
          }, 10 * 1000);

          this.recFfmpeg.once("exit", () => {
            clearTimeout(timeout);

            this.logger.info("[Watchdog]", "录制进程已安全退出，尝试重启进程");
            this.retryRecord();
          });

          this.logger.warn("[Watchdog]", "尝试安全结束录制进程");
          this.recFfmpeg.stop();
        }
      }
    }, LiveRecorder.WATCHDOG_CHECK_INTERVAL);
  }

  private _killWatchdog() {
    if (this.watchdogTimeout) clearInterval(this.watchdogTimeout);
  }

  public startRecord() {
    this._checkIfDestroyed();
    const isFirst = this.startTime === 0;

    if (isFirst) {
      this.logger.debug(`第一次录制开始, startTime 将被设置`);
      this.startTime = Date.now();
    }

    const filePath = this.generateNewFilePath(this.getSegmentFilesCount());

    this.ffmpegStats = null;
    this.logger.debug("录制开始，已清理之前的ffmpegStats");

    this.recFfmpeg = Ffmpeg.createRecordingCommand(this.inputUrl, filePath, {
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
      headers: {
        Referer: "https://live.bilibili.com/",
      },
    });

    this.recFfmpeg.once("start", () => {
      this.retryCount = 0;
      this.ffmpegRunning = true;
      this.logger.debug("录制进程即将开始工作 ⏳");
      this.logger.info(`${this.hash.substring(0, 32)} -> 分段[${this.getSegmentFilesCount()}] 即将开始录制 ⏳`);
      this.emit("start", isFirst);

      this.logger.info("看门狗已启动✅");
      this._runWatchdog();
    });

    this.recFfmpeg.on("progress", (stats: FfmpegStats) => {
      if (!stats.time) {
        this.logger.debug("录制进程返回数据缺失", stats);
        return;
      }

      this.lastProgressHeartbeat = Date.now();

      if (!this.ffmpegStats) {
        this.logger.info("录制真正开始✅ 🔴REC");

        if (!fs.existsSync(filePath)) {
          this.logger.warn("异常行为：录制文件不存在❌", filePath);
          notifyEmitter.emit("msg-warn", `${this.hash} 录制出现异常行为：录制真正开始后未找到录制文件❌\n\n${filePath}`);
        }

        this.logger.debug("文件已进入segmentFiles");
        this.segmentFiles.push(filePath);
      }
      this.ffmpegStats = stats;
      this.emit("progress", stats);
    });

    this.recFfmpeg.once("exit", (code, signal) => {
      this.ffmpegRunning = false;
      this.logger.info(`${this.hash.substring(0, 32)} -> ffmpeg 退出 ❌, code:`, code);

      this.logger.debug("看门狗已 Killed✅");
      this._killWatchdog();

      // 检查录制是否成功
      if (!this.ffmpegStats) {
        // 从进程启动到退出都没开始录制
        this.logger.warn(`${this.hash.substring(0, 32)} -> 未检测到 ffmpeg 的输出信息 ❌ （本分段录制失败）`, this.ffmpegStats);

        try {
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch (e) {
          this.logger.error(`删除录制文件失败:`, e);
        }

        // 此时 segmentFile 还没进入 segmentFiles
      } else {
        this.logger.info(`分段[${this.getSegmentFilesCount()}] 录制成功✅，录制时长: ${this.ffmpegStats.time!}`);

        this.totalDuration += TimeUtils.parseTimeToMsRegex(this.ffmpegStats.time!);
        this.logger.debug(`当前总时长: ${this.totalDuration}`);
      }

      // 检查时长
      // if (TimeUtils.parseTimeToMsRegex(this.ffmpegStats.time!) < 10 * 1000) {
      //   this.logger.warn(
      //     `${this.hash.substring(
      //       0,
      //       32
      //     )} -> 录制时长太短 <10s❌，可能是网络问题，将进行重试`
      //   );

      //   try {
      //     if (fs.existsSync(filePath)) {
      //       this.logger.info("删除时长不足的录制文件成功✅", filePath);
      //       fs.unlinkSync(filePath);
      //     }
      //   } catch (e) {
      //     this.logger.error(`删除录制文件失败❌:`, e);
      //   }

      //   if (this.segmentFiles[this.segmentFiles.length - 1] === filePath) {
      //     this.logger.debug("文件已从 segmentFiles 移除");
      //     this.segmentFiles.pop();
      //   } else {
      //     this.logger.warn(
      //       "异常行为：当前分段录制文件不是最后一个录制文件❌",
      //       filePath
      //     );
      //     notifyEmitter.emit(
      //       "msg-warn",
      //       `${this.hash} 录制出现异常行为：当前分段录制文件不是最后一个录制文件❌\n\n${filePath}`
      //     );
      //   }
      // }

      if (code == 0) return; // 交给 done 事件处理

      // 异常退出
      this.logger.warn(`${this.hash.substring(0, 32)} -> ffmpeg 异常退出 ❌，将在5s后重试录制`);

      setTimeout(() => {
        this.logger.info(`${this.hash.substring(0, 32)} -> 重试录制`);
        this.retryRecord();
      });
    });

    this.recFfmpeg.once("err", (error: FfmpegError) => {
      this.logger.error(`${this.hash.substring(0, 32)} -> 录制出错 ❌`, error);
      this.emit("err", error);
    });

    this.recFfmpeg.once("done", async (outputPath, stats) => {
      this.logger.info(`${this.hash.substring(0, 32)} -> ffmpeg 录制结束🔴`);
      this.emit("end", this.getDuration());
    });

    this.recFfmpeg.start();
  }

  /**
   * 注意: 本方法不会 emit(end)
   * @returns
   */
  public async stopRecord() {
    this._checkIfDestroyed();

    if (this.retryTimeout) clearTimeout(this.retryTimeout);
    this.logger.info(`${this.hash.substring(0, 32)} -> stopRecord()`);
    this.logger.debug(`${this.hash.substring(0, 32)} -> 将设置(覆盖) stopTime`);
    this.stopTime = Date.now();

    this.logger.debug("stopRecord 调用，Watchdog Killed");
    this._killWatchdog();

    return await new Promise<{
      segmentFiles: string[];
      startTime: number;
      stopTime: number;
      duration: number;
    }>((resolve, reject) => {
      const _stop = () => {
        this.logger.debug(`录制 _stop -> 结束`);

        this.logger.info(`录制时长: ${FormatUtils.formatDurationWithoutSeconds(this.getDuration())}`);

        this.recFfmpeg = null;
        this.ffmpegRunning = false;
        this.logger.debug(`结束标志设置完成 ffmpegRunning -> false, recFfmpeg -> null`);

        resolve({
          segmentFiles: this.getSegmentFiles(),
          startTime: this.startTime,
          stopTime: this.stopTime,
          duration: this.getDuration(),
        });
      };

      if (this.ffmpegRunning) {
        let forceTimeout: NodeJS.Timeout | null = null;

        const stoped = () => {
          this.logger.info(`${this.hash.substring(0, 32)} -> Ffmpeg 进程已被 stopRecord() 关闭，录制已结束`);
          this.logger.debug(`${this.hash.substring(0, 32)} -> stopRecord() -> stoped() 录制已完成`);
          if (forceTimeout) clearTimeout(forceTimeout);

          if (this.ffmpegStats) {
            this.totalDuration += TimeUtils.parseTimeToMsRegex(this.ffmpegStats.time!);
            this.logger.debug("totalDuration 更新成功", this.totalDuration, ", 本次分段 stats.time: ", this.ffmpegStats.time);
          } else {
            this.logger.debug("totalDuration 更新失败, 本次分段录制失败, 无 stats 数据");
          }

          _stop();
        };

        this.recFfmpeg?.removeAllListeners();
        this.recFfmpeg?.once("exit", stoped);
        this.recFfmpeg?.stop();

        forceTimeout = setTimeout(() => {
          this.logger.debug(`${this.hash.substring(0, 32)} -> stopRecord() -> forceTimeout() , 原因: recFfmpeg.stop() 长时间未响应 -> 强制结束录制`);
          forceTimeout = null;
          this.recFfmpeg?.removeAllListeners();
          this.recFfmpeg?.kill();
          stoped();
        }, 15000);
      } else {
        this.logger.debug(`${this.hash.substring(0, 32)} -> stopRecord() -> ffmpegRunning 为 false，录制已结束`);
        _stop();
      }
    });
  }

  public async stopRecordAndMerge(): Promise<{
    file: string;
    startTime: number;
    stopTime: number;
    duration: number;
  }> {
    this._checkIfDestroyed();

    const resp = await this.stopRecord();

    if (resp.segmentFiles.length <= 1) {
      return {
        ...resp,
        file: resp.segmentFiles[0],
      };
    }

    return await new Promise((resolve, reject) => {
      this.logger.info("开始合并分段", resp.segmentFiles);

      const concatFfmpeg = Ffmpeg.createConcatCommand(resp.segmentFiles, this.generateNewFilePath("merge", resp.startTime));

      concatFfmpeg.once("start", () => {
        this.logger.info(`concatFfmpeg 开始合并任务`);
      });

      concatFfmpeg.once("exit", (code, signal) => {
        this.logger.debug(`concatFfmpeg 退出, code: ${code}, signal: ${signal}`);
      });

      concatFfmpeg.once("err", reject);

      concatFfmpeg.once("done", (outputPath) => {
        this.logger.info("合并文件完成，开始清理文件");

        this.segmentFiles.forEach((filePath) => {
          try {
            fs.unlinkSync(filePath);
            this.logger.info(`文件清理成功:`, filePath);
          } catch (e) {
            this.logger.error(`删除录像文件失败:`, e);
          }
        });

        this.segmentFiles = [];

        resolve({
          ...resp,
          file: outputPath,
        });
      });

      this.logger.info("开始合并文件任务 -> ", resp.segmentFiles);
      concatFfmpeg.start();
    });
  }

  public getStats() {
    this._checkIfDestroyed();

    return {
      hash: this.hash,
      duration: this.getDuration(),
      retryCount: this.retryCount,
      startTime: this.startTime,
      stopTime: this.stopTime,
      ffmpegStats: this.ffmpegStats,
    };
  }

  public getSegmentFilesCount() {
    this._checkIfDestroyed();

    return this.segmentFiles.length;
  }

  public getSegmentFiles() {
    this._checkIfDestroyed();

    return this.segmentFiles;
  }

  public generateNewFilePath(index: number | string, timestamp = Date.now()) {
    this._checkIfDestroyed();

    return `${this.recordingDir}/${timestamp}-${this.sessionHash.substring(0, 16)}-${this.hash.substring(0, 32)}_${index}.flv`;
  }

  /**
   * 重试录制
   * @param force 为true时 绕过指数退避
   * @returns
   */
  public retryRecord(force: boolean = false) {
    this._checkIfDestroyed();

    this.logger.debug(`${this.hash.substring(0, 32)} -> retryRecord(force: ${force})`);

    if (force) {
      this.startRecord();
      return;
    }

    if (this.retryCount > LiveRecorder.MAX_RETRY_COUNT) throw new LiveRecorderMaxRetriesError(this.hash);

    const delay = LiveRecorder.calculateRetryDelay(this.retryCount);
    this.logger.debug(`${this.hash.substring(0, 32)} -> retryRecord() -> 指数退避重试 -> 将在 ${delay}ms 后重试录制`);
    this.retryTimeout = setTimeout(() => {
      this.startRecord();
    }, delay);
    this.retryCount++;
  }

  public updateInputUrl(newUrl: string) {
    this._checkIfDestroyed();

    this.inputUrl = newUrl;
    this.logger.debug(`已更换直播流 -> ${newUrl}`);
  }

  /**
   * 清理当前所有录制信息并等待重新开始
   * @param deleteFile 是否删除录像文件
   */
  public async reset(deleteFile = false) {
    this._checkIfDestroyed();

    this.logger.info("开始重置当前录制器");
    await this.stopRecord();

    if (deleteFile) {
      this.logger.info("开始删除录像文件");
      this.segmentFiles.forEach((filePath) => {
        try {
          fs.unlinkSync(filePath);
          this.logger.info(`删除录制文件 ${filePath} 成功 ✅`);
        } catch (e) {
          this.logger.error(`删除录像文件 ${filePath} 失败 ❌ ->`, e);
        }
      });
    }

    this.segmentFiles = [];
    this.retryCount = 0;
    this.startTime = 0;
    this.stopTime = 0;

    this.logger.info("录制器重置完成 ✅");
  }

  public getDuration() {
    this._checkIfDestroyed();

    return this.totalDuration;
  }

  public destroy(deleteFile = false) {
    this._checkIfDestroyed();

    this.logger.debug("录制器被销毁");

    this.stopRecord()
      .then(() => {
        if (deleteFile) {
          this.segmentFiles.forEach((filePath) => {
            try {
              fs.unlinkSync(filePath);
              this.logger.info(`文件清理成功:`, filePath);
            } catch (e) {
              this.logger.error(`删除录像文件失败:`, e);
            }
          });
        }
      })
      .catch((error) => {
        this.logger.error("停止录制失败:", error);
      });

    this.removeAllListeners();

    this._destroyed = true;
  }

  private _checkIfDestroyed() {
    if (this._destroyed) {
      throw new LiveRecorderIsDestroyedError(this.hash);
    }
  }
}
