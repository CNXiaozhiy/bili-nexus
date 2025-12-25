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
import TimeUtils from "@/utils/time";
import notifyEmitter from "@/core/app/notify-emitter";

const logger = getLogger("LiveRecorder");

export interface LiveRecorderEvents {
  start: [isFirst: boolean];
  progress: [stats: FfmpegStats];
  end: [duration: number];
  err: [error: Error];
}

type SegMentFileMate = { start: number; end: number };

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

  private segmentFiles = new Map<string, SegMentFileMate>();

  // Stats
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
    for (const [filePath, meta] of this.segmentFiles) {
      if (!meta.end) {
        logger.warn("逻辑错误，meta.end 未设置");
        meta.end = Date.now();
      }
      const duration = meta.end - meta.start;
      if (duration < 60000) {
        logger.debug(
          `分段 [${index}] -> 录制时长过短: ${duration / 1000}s , 删除分段`
        );

        this.segmentFiles.delete(filePath);

        if (!fs.existsSync(filePath)) {
          logger.debug(
            `删除不足60s的分段 [${index}] -> 录制文件不存在: ${filePath}`
          );
          return;
        }
        try {
          fs.unlinkSync(filePath);
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

  private checkSegmentFiles() {
    this.segmentFiles.forEach((meta, filePath) => {
      if (!fs.existsSync(filePath)) {
        logger.debug("checkSegmentFiles -> 文件不存在 ❌", filePath);
        if (!this.segmentFiles.delete(filePath)) {
          logger.warn(
            "删除 segmentFiles 元素失败",
            filePath,
            "Map ->",
            this.segmentFiles
          );
        } else {
          logger.debug("已删除 segmentFile 元素", filePath);
        }
      }
    });
  }

  private _getCuttentSegmentFileMate() {
    const segmentFiles = Array.from(this.segmentFiles);
    const segmentFile = segmentFiles[segmentFiles.length - 1];
    const segmentFileFilePath = segmentFile[0];
    const segmentFileMate = segmentFile[1];

    return {
      segmentFileFilePath,
      segmentFileMate,
      segmentFinished: !!segmentFileMate.end,
    };
  }

  private _setCurrentSegmentFileMateEndTime() {
    const { segmentFileFilePath, segmentFileMate, segmentFinished } =
      this._getCuttentSegmentFileMate();

    if (segmentFinished) {
      logger.warn("分段已结束，设置结束失败");
    } else {
      segmentFileMate.end = Date.now();
      logger.debug(
        "已设置分段的结束时间 ->",
        segmentFileFilePath,
        "mate ->",
        segmentFileMate
      );
    }
  }

  public startRecord() {
    this._checkIfDestroyed();
    const isFirst = this.startTime === 0;

    if (isFirst) {
      logger.debug(`第一次录制开始, startTime 将被设置`);
      this.startTime = Date.now();
    }

    const filePath = this.generateNewFilePath(this.getSegmentFilesCount());

    // 浅拷贝
    this.segmentFiles.set(filePath, {
      start: Date.now(),
      end: 0,
    });

    this.ffmpegStats = null;
    logger.debug("录制开始，已清理之前的ffmpegStats");

    this.recFfmpeg = Ffmpeg.createRecordingCommand(this.inputUrl, filePath, {
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
      headers: {
        Referer: "https://live.bilibili.com/",
      },
    });

    this.recFfmpeg.once("start", () => {
      this.retryCount = 0;
      this.ffmpegRunning = true;
      logger.debug("录制进程开始工作");
      logger.info(
        `${this.hash} 分段[${this.getSegmentFilesCount() - 1}] -> 开始录制 ✅`
      );
      this.emit("start", isFirst);
    });

    this.recFfmpeg.on("progress", (stats: FfmpegStats) => {
      if (!this.ffmpegStats) logger.debug("录制真正开始");
      this.ffmpegStats = stats;
      this.emit("progress", stats);
    });

    this.recFfmpeg.once("exit", (code, signal) => {
      this.ffmpegRunning = false;
      this._setCurrentSegmentFileMateEndTime();
      logger.info(`${this.hash} -> ffmpeg 退出 -> `, code);
      if (code == 0) return; // 交给 done 事件处理
    });

    this.recFfmpeg.once("err", (error: FfmpegError) => {
      logger.error(`${this.hash} -> 录制失败 ❌`, error);
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
    logger.info(`${this.hash} -> stopRecord()`);
    logger.debug(`${this.hash} -> 将设置(覆盖) stopTime, segmentMate`);
    this.stopTime = Date.now();

    return await new Promise<{
      segmentFiles: string[];
      startTime: number;
      stopTime: number;
      duration: number;
    }>((resolve, reject) => {
      const _stop = () => {
        logger.debug(`录制 _stop -> 结束`);

        this._setCurrentSegmentFileMateEndTime();

        logger.info(
          `录制时长: ${FormatUtils.formatDurationWithoutSeconds(
            this.getDuration()
          )}`
        );

        this.recFfmpeg = null;
        this.ffmpegRunning = false;
        logger.debug(
          `结束标志设置完成 ffmpegRunning -> false, recFfmpeg -> null`
        );

        this.checkSegmentFiles();

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
      logger.info("开始合并分段", resp.segmentFiles);

      const concatFfmpeg = Ffmpeg.createConcatCommand(
        resp.segmentFiles,
        this.generateNewFilePath("merge")
      );

      concatFfmpeg.once("start", () => {
        logger.info(`concatFfmpeg 开始合并任务`);
      });

      concatFfmpeg.once("exit", (code, signal) => {
        logger.debug(`concatFfmpeg 退出, code: ${code}, signal: ${signal}`);
      });

      concatFfmpeg.once("err", reject);

      concatFfmpeg.once("done", (outputPath) => {
        logger.info("合并文件完成，开始清理文件");

        this.segmentFiles.forEach((_, filePath) => {
          try {
            fs.unlinkSync(filePath);
            logger.info(`文件清理成功:`, filePath);
          } catch (e) {
            logger.error(`删除录像文件失败:`, e);
          }
        });

        const _metas = this.segmentFiles.entries().next().value;
        this.segmentFiles.clear();

        if (_metas) {
          this.segmentFiles.set(outputPath, { ..._metas[1] });
          logger.debug("合并后的分段已使用第一次分段的 meta");
        } else {
          logger.warn(
            "未找到最初的录制分段，合并后的分段开始时间将以十分钟之前开始计算"
          );
          logger.warn("⚠️ 不应该出现的问题，请报告开发者");
          notifyEmitter.emit(
            "msg-warn",
            `致命Bug🐛：在 stopRecordAndMerge 中未找到第一次分段的meta`
          );
          this.segmentFiles.set(outputPath, {
            start: Date.now() - 10 * 60 * 1000,
            end: Date.now(),
          });
        }

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
      duration: this.getDuration(),
      retryCount: this.retryCount,
      startTime: this.startTime,
      stopTime: this.stopTime,
      ffmpegStats: this.ffmpegStats,
    };
  }

  public getSegmentFilesCount() {
    this._checkIfDestroyed();

    return this.segmentFiles.size;
  }

  public getSegmentFiles() {
    this._checkIfDestroyed();

    return Array.from(this.segmentFiles).map(([filePath]) => filePath);
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
    await this.stopRecord();

    if (deleteFile) {
      logger.info("开始删除录像文件");
      this.segmentFiles.forEach((_, filePath) => {
        try {
          fs.unlinkSync(filePath);
          logger.info(`删除录制文件 ${filePath} 成功 ✅`);
        } catch (e) {
          logger.error(`删除录像文件 ${filePath} 失败 ❌ ->`, e);
        }
      });
    }

    this.segmentFiles.clear();
    this.retryCount = 0;
    this.startTime = 0;
    this.stopTime = 0;

    logger.info("录制器重置完成 ✅");
  }

  public getDuration() {
    this._checkIfDestroyed();

    return Array.from(this.segmentFiles)
      .map(([, mate]) => mate.end - mate.start)
      .reduce((acc, cur) => acc + cur, 0);
  }

  public destroy(deleteFile = false) {
    this._checkIfDestroyed();

    logger.debug("录制器被销毁");

    this.stopRecord()
      .then(() => {
        if (deleteFile) {
          this.segmentFiles.forEach((_, filePath) => {
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
