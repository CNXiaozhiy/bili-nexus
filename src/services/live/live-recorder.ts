import EventEmitter from "events";
import fs from "fs";
import Ffmpeg, { RecordFfmpeg } from "@/core/ffmpeg";
import { FfmpegStats } from "@/types/ffmpeg";
import getLogger from "@/utils/logger";
import { FfmpegError } from "@/types/errors/ffmpeg";
import {
  LiveRecorderIsDestroyedError,
  LiveRecorderMaxRetriesError,
} from "@/types/errors/live-recorder";
import path from "path";
import FormatUtils from "@/utils/format";

const logger = getLogger("LiveRecorder");

export interface LiveRecorderEvents {
  start: [void];
  progress: [stats: FfmpegStats];
  end: [duration: number];
  err: [error: Error];
}

export default class LiveRecorder extends EventEmitter<LiveRecorderEvents> {
  public static BASE_RETRY_DELAY: number = 10000;
  public static MAX_RETRY_DELAY: number = 120000;
  public static MAX_RETRY_COUNT: number = Infinity;

  private _destroyed: boolean = false;

  private inputUrl: string;
  private recordingDir: string;
  public hash: string; // 每一次直播的唯一标识

  private recFfmpeg: RecordFfmpeg | null = null;
  private ffmpegRunning: boolean = false;

  private segmentFiles: { filePath: string; start: number }[] = [];

  // Stats
  private duration: number = 0; // 录制总时长
  private retryCount: number = 0;
  private startTime: number = 0;
  private stopTime: number = 0;
  private ffmpegStats: FfmpegStats | null = null;

  private retryTimeout: NodeJS.Timeout | null = null;

  private static calculateRetryDelay(retryCount: number) {
    const delay = Math.pow(2, retryCount) * LiveRecorder.BASE_RETRY_DELAY;

    if (delay > LiveRecorder.MAX_RETRY_DELAY)
      return LiveRecorder.MAX_RETRY_DELAY;

    return delay;
  }

  public isRunning() {
    return this.ffmpegRunning;
  }

  constructor(hash: string, inputUrl: string, recordingDir: string) {
    super();
    this.hash = hash;
    this.inputUrl = inputUrl;
    this.recordingDir = path.resolve(recordingDir);
  }

  // 低于 60s 的录制会被忽略，duration 为 ms
  private checkDuration() {
    let index = 0;
    for (const segment of this.segmentFiles) {
      const duration = Date.now() - segment.start;
      if (duration < 60000) {
        logger.debug(
          `分段 [${index}] -> 录制时长过短: ${duration / 1000}s , 删除分段`
        );
        this.segmentFiles.splice(this.segmentFiles.indexOf(segment), 1);
        if (!fs.existsSync(segment.filePath)) {
          logger.debug(
            `删除不足60s的分段 [${index}] -> 录制文件不存在: ${segment.filePath}`
          );
          return;
        }
        try {
          fs.unlinkSync(segment.filePath);
        } catch (e) {
          logger.error(`删除不足60s的分段 [${index}] -> 失败, err: `, e);
        }
      } else {
        logger.debug(
          `分段 [${index}] -> 录制时长: ${FormatUtils.formatDurationDetailed(
            duration
          )} , 保留分段`
        );
      }
      index++;
    }
  }

  public startRecord() {
    this._checkIfDestroyed();

    if (this.startTime === 0) {
      logger.debug(`第一次录制开始, startTime 将被设置`);
      this.startTime = Date.now();
    }
    const filePath = this.generateNewFilePath(this.getSegmentFilesCount());
    this.segmentFiles.push({ filePath, start: Date.now() });
    this.recFfmpeg = Ffmpeg.createRecordingCommand(this.inputUrl, filePath, {
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
      headers: {
        Referer: "https://live.bilibili.com/",
      },
    });

    this.recFfmpeg.once("start", () => {
      this.ffmpegRunning = true;
      this.retryCount = 0;
      logger.info(`${this.hash} 分段[${this.getSegIndex()}] -> 开始录制`);
    });

    this.recFfmpeg.on("progress", (stats: FfmpegStats) => {
      this.ffmpegStats = stats;
      this.emit("progress", stats);
    });

    this.recFfmpeg.once("exit", (code, signal) => {
      this.ffmpegRunning = false;
      logger.info(`${this.hash} -> ffmpeg 退出 -> `, code);
      if (code == 0) return; // 交给 done 事件处理
    });

    this.recFfmpeg.once("err", (error: FfmpegError) => {
      logger.error(`${this.hash} -> 录制失败`, error);
      this.emit("err", error);
      this.recFfmpeg?.kill();
      setTimeout(() => {
        logger.debug(
          `${this.hash} -> 收到事件 recFfmpeg.event.err -> 将在 5s 后尝试重试录制`
        );
        this.checkDuration();
        this.retryRecord();
      }, 5000);
    });

    this.recFfmpeg.once("done", async (outputPath, stats) => {
      logger.info(`${this.hash} -> ffmpeg 录制结束`);
      this.duration += stats.duration;
      this.emit("end", this.duration);
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
    logger.info(`${this.hash} -> stopRecord()`);
    logger.debug(`${this.hash} -> 将设置(覆盖) stopTime`);
    this.stopTime = Date.now();

    return await new Promise<{
      segmentFiles: string[];
      startTime: number;
      stopTime: number;
      duration: number;
    }>((resolve, reject) => {
      const _stop = () => {
        logger.debug(`录制 _stop -> 结束`);

        this.recFfmpeg = null;
        this.ffmpegRunning = false;
        logger.debug(
          `结束标志设置完成 ffmpegRunning -> false, recFfmpeg -> null`
        );
        resolve({
          segmentFiles: this.segmentFiles.map((segment) => segment.filePath),
          startTime: this.startTime,
          stopTime: this.stopTime,
          duration: this.duration,
        });
      };

      if (this.ffmpegRunning) {
        let forceTimeout: NodeJS.Timeout | null = null;

        const stoped = () => {
          logger.info(
            `${this.hash} -> Ffmpeg 进程已被 stopRecord() 关闭，录制已结束`
          );
          logger.debug(`${this.hash} -> stopRecord() -> stoped() 录制已完成`);
          if (forceTimeout) clearTimeout(forceTimeout);

          _stop();
        };

        this.recFfmpeg?.removeAllListeners();
        this.recFfmpeg?.once("exit", stoped);
        this.recFfmpeg?.stop();

        forceTimeout = setTimeout(() => {
          logger.debug(
            `${this.hash} -> stopRecord() -> forceTimeout() , 原因: recFfmpeg.stop() 长时间未响应 -> 强制结束录制`
          );
          forceTimeout = null;
          this.recFfmpeg?.removeAllListeners();
          this.recFfmpeg?.kill();
          stoped();
        }, 15000);
      } else {
        logger.debug(
          `${this.hash} -> stopRecord() -> ffmpegRunning 为 false，录制已结束`
        );
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
      const concatFfmpeg = Ffmpeg.createConcatCommand(
        resp.segmentFiles,
        this.generateNewFilePath("merge")
      );

      concatFfmpeg.on("start", () => {
        logger.info(`concatFfmpeg 开始合并任务`);
      });

      concatFfmpeg.on("exit", (code, signal) => {
        logger.debug(`concatFfmpeg 退出, code: ${code}, signal: ${signal}`);
      });

      concatFfmpeg.on("err", reject);

      concatFfmpeg.on("done", (outputPath) => {
        logger.info("合并文件完成，开始清理文件");

        this.segmentFiles.forEach(({ filePath }) => {
          try {
            fs.unlinkSync(filePath);
            logger.info(`文件清理成功:`, filePath);
          } catch (e) {
            logger.error(`删除录像文件失败:`, e);
          }
        });

        this.segmentFiles = [
          {
            start: this.segmentFiles[0].start,
            filePath: outputPath,
          },
        ];

        resolve({
          ...resp,
          file: outputPath,
        });
      });

      logger.info("开始合并文件任务 -> ", resp.segmentFiles);
      concatFfmpeg.start();
    });
  }

  public getStats() {
    this._checkIfDestroyed();

    return {
      hash: this.hash,
      duration: this.duration,
      retryCount: this.retryCount,
      startTime: this.startTime,
      stopTime: this.stopTime,
      ffmpegStats: this.ffmpegStats,
    };
  }

  public getSegIndex() {
    this._checkIfDestroyed();

    return this.segmentFiles.length - 1;
  }

  public getSegmentFilesCount() {
    this._checkIfDestroyed();

    return this.segmentFiles.length;
  }

  public generateNewFilePath(index: number | string) {
    this._checkIfDestroyed();

    return `${this.recordingDir}/${this.hash}_${index}.flv`;
  }

  /**
   * 重试录制
   * @param force 为true时 绕过指数退避
   * @returns
   */
  public retryRecord(force: boolean = false) {
    this._checkIfDestroyed();

    logger.debug(`${this.hash} -> retryRecord(force: ${force})`);

    if (force) {
      this.startRecord();
      return;
    }

    if (this.retryCount > LiveRecorder.MAX_RETRY_COUNT)
      throw new LiveRecorderMaxRetriesError(this.hash);

    const delay = LiveRecorder.calculateRetryDelay(this.retryCount);
    logger.debug(
      `${this.hash} -> retryRecord() -> 指数退避重试 -> 将在 ${delay}ms 后重试录制`
    );
    this.retryTimeout = setTimeout(() => {
      this.startRecord();
    }, delay);
    this.retryCount++;
  }

  public updateInputUrl(newUrl: string) {
    this._checkIfDestroyed();

    this.inputUrl = newUrl;
    logger.debug(`已更换直播流 -> ${newUrl}`);
  }

  /**
   * 清理当前所有录制信息并等待重新开始
   * @param deleteFile 是否删除录像文件
   */
  public async reset(deleteFile = false) {
    this._checkIfDestroyed();

    logger.info("开始重置当前录制器");
    const resp = await this.stopRecord();
    if (deleteFile) {
      logger.info("开始删除录像文件");
      resp.segmentFiles.forEach((file, index) => {
        try {
          fs.unlinkSync(file);
          logger.info(`删除录制文件 ${file} 成功 ✅`);
        } catch (e) {
          logger.error(`删除录像文件 ${file} 失败 ❌ ->`, e);
        }
      });

      resp.segmentFiles = [];
    }

    this.segmentFiles = [];
    this.duration = 0;
    this.retryCount = 0;
    this.startTime = 0;
    this.stopTime = 0;

    logger.info("录制器重置完成 ✅");
  }

  public destroy(deleteFile = false) {
    this._checkIfDestroyed();

    this.stopRecord()
      .then(() => {
        if (deleteFile) {
          this.segmentFiles.forEach(({ filePath }) => {
            try {
              fs.unlinkSync(filePath);
              logger.info(`文件清理成功:`, filePath);
            } catch (e) {
              logger.error(`删除录像文件失败:`, e);
            }
          });
        }
      })
      .catch(logger.error);

    this.removeAllListeners();

    this._destroyed = true;
  }

  private _checkIfDestroyed() {
    if (this._destroyed) {
      throw new LiveRecorderIsDestroyedError(this.hash);
    }
  }
}
