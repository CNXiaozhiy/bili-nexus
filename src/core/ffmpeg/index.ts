import EventEmitter from "events";
import fs from "fs";
import path from "path";
import { ChildProcess, spawn } from "child_process";
import {
  FfmpegError,
  FfmpegSetupError,
  FfmpegExitError,
  FfmpegExitWithError,
} from "@/types/errors/ffmpeg";
import {
  FfmpegStats,
  FfmpegFinalStats,
  FfmpegCommandStatus,
  FfmpegRecorderStatus,
  FfmpegScreenshotStatus,
} from "@/types/ffmpeg";
import getLogger from "@/utils/logger";
import { error } from "console";

const logger = getLogger("Ffmpeg");

export interface FfmpegEvents {
  start: [void];
  progress: [stats: FfmpegStats];
  done: [outputPath: string, stats: FfmpegFinalStats];
  err: [error: FfmpegError];
  exit: [code: number | null, signal: string | null];
  stdout: [data: string];
  stderr: [data: string];
  screenshotDone: [outputPath: string];
}

export interface ConcatOptions {
  cleanup?: boolean;
  format?: string;
  videoCodec?: string;
  audioCodec?: string;
  fileListPath?: string;
}

// 基础 FFmpeg 命令类
export abstract class FfmpegCommand extends EventEmitter<FfmpegEvents> {
  protected process: ChildProcess | null = null;
  protected args: string[];
  protected outputPath: string;
  protected startTime: number = 0;
  protected status: FfmpegCommandStatus = FfmpegCommandStatus.NOT_STARTED;
  protected isRunning: boolean = false;
  protected stats: FfmpegStats[] = [];
  protected ffmpegErrorLines: string = "";

  constructor(args: string[]) {
    super();
    this.args = args;
    this.outputPath = this.extractOutputPath(args);
  }

  protected extractOutputPath(args: string[]): string {
    const outputIndex = args.indexOf("-o") + 1 || args.indexOf("-output") + 1;
    if (outputIndex > 0 && outputIndex < args.length) {
      return args[outputIndex];
    }

    for (let i = args.length - 1; i >= 0; i--) {
      if (!args[i].startsWith("-") && args[i].includes(".")) {
        return args[i];
      }
    }

    return "unknown_output";
  }

  public start(): void {
    try {
      this.process = spawn(Ffmpeg.ffmpegBinPath, this.args);
      this.isRunning = true;
      this.startTime = Date.now();
      this.status = FfmpegCommandStatus.RUNNING;
      this.ffmpegErrorLines = "";
      this.emit("start");

      this.process.stdout?.on("data", (data: Buffer) => {
        const output = data.toString();
        this.emit("stdout", output);
        this.parseOutput(output);
      });

      this.process.stderr?.on("data", (data: Buffer) => {
        const output = data.toString();
        this.emit("stderr", output);
        this.parseOutput(output);
      });

      this.process.on("exit", (code: number | null, signal: string | null) => {
        this.isRunning = false;
        this.emit("exit", code, signal);

        if (code === 0) {
          this.handleCompletion();
        } else {
          this.status = FfmpegCommandStatus.ERROR;
          if (this.ffmpegErrorLines) {
            const error = new FfmpegExitWithError(
              `FFmpeg process exited with code ${code}`,
              code,
              signal,
              new FfmpegError(this.ffmpegErrorLines)
            );
            this.emit("err", error);
          } else {
            const error = new FfmpegExitError(
              `FFmpeg process exited with code ${code}`,
              code,
              signal
            );
            this.emit("err", error);
          }
        }
      });

      this.process.on("error", (error: Error) => {
        this.isRunning = false;
        this.status = FfmpegCommandStatus.ERROR;
        const ffmpegError = new FfmpegError(
          `FFmpeg process error: ${error.message}`
        );
        this.emit("err", ffmpegError);
      });
    } catch (error) {
      this.status = FfmpegCommandStatus.ERROR;
      const ffmpegError = new FfmpegSetupError(
        `Failed to start FFmpeg: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      this.emit("err", ffmpegError);
    }
  }

  public stop(): void {
    if (this.process && this.isRunning) {
      this.process.kill("SIGINT");
      this.isRunning = false;
    }
  }

  public kill(): void {
    if (this.process) {
      this.process.kill("SIGKILL");
      this.isRunning = false;
    }
  }

  protected parseOutput(output: string): void {
    const lines = output.split("\n");

    for (const line of lines) {
      if (line.trim() === "") continue;

      const stats = this.parseStats(line);
      if (stats && Object.keys(stats).length > 1) {
        this.stats.push(stats);
        this.emit("progress", stats);
      }

      this.checkForErrors(line);
    }
  }

  protected parseStats(line: string): FfmpegStats | null {
    const stats: FfmpegStats = { timestamp: Date.now() };

    const frameMatch = line.match(/frame=\s*(\d+)/);
    const fpsMatch = line.match(/fps=\s*([\d.]+)/);
    const qualityMatch = line.match(/q=([\d.-]+)/);
    const sizeMatch = line.match(/size=\s*([\d.]+)([KMG]?i?B)/i);
    const timeMatch = line.match(/time=(\d+:\d+:\d+\.\d+)/);
    const bitrateMatch = line.match(/bitrate=\s*([\d.]+)([KM]?)bits\/s/);
    const speedMatch = line.match(/speed=\s*([\d.]+)x/);

    if (frameMatch) stats.frame = frameMatch[1];
    if (fpsMatch) stats.fps = fpsMatch[1];
    if (qualityMatch) stats.quality = qualityMatch[1];
    if (timeMatch) stats.time = timeMatch[1];
    if (speedMatch) stats.speed = speedMatch[1];

    if (sizeMatch) {
      const sizeBytes = this.parseSizeToBytes(
        parseFloat(sizeMatch[1]),
        sizeMatch[2]
      );
      stats.sizeBytes = sizeBytes;
      stats.size = this.formatSize(sizeBytes);
    }

    if (bitrateMatch) {
      stats.bitrate = `${bitrateMatch[1]} ${bitrateMatch[2]}bits/s`;
    }

    return Object.keys(stats).length > 1 ? stats : null;
  }

  protected parseSizeToBytes(size: number, unit: string): number {
    const unitMap: Record<string, number> = {
      KIB: 1024,
      KB: 1024,
      MIB: 1024 * 1024,
      MB: 1024 * 1024,
      GIB: 1024 * 1024 * 1024,
      GB: 1024 * 1024 * 1024,
    };
    return size * (unitMap[unit.toUpperCase()] || 1);
  }

  protected checkForErrors(line: string): void {
    const errorPatterns = [
      /error:/i,
      /failed/i,
      /invalid/i,
      /cannot/i,
      /unknown/i,
      /not found/i,
      /permission denied/i,
    ];

    if (errorPatterns.some((pattern) => pattern.test(line))) {
      const error = new FfmpegError(`FFmpeg error: ${line.trim()}`);
      this.ffmpegErrorLines += line.trim() + "\n";
      logger.warn("Maybe Error: ", error);
      // this.emit("err", error);
    }
  }

  protected handleCompletion(): void {
    this.status = FfmpegCommandStatus.COMPLETED;
    const finalStats = this.calculateFinalStats();
    this.emit("done", this.outputPath, finalStats);
  }

  protected calculateFinalStats(): FfmpegFinalStats {
    const lastStats = this.stats[this.stats.length - 1];
    return {
      duration: Date.now() - this.startTime,
      fileSize: lastStats?.sizeBytes || 0,
      averageBitrate: this.calculateAverageBitrate(),
      framesProcessed: parseInt(lastStats?.frame || "0"),
    };
  }

  protected calculateAverageBitrate(): number {
    const bitrates = this.stats
      .map((stat) => {
        const match = stat.bitrate?.match(/([\d.]+)\s*([KM]?)bits\/s/);
        if (!match) return 0;

        let bitrate = parseFloat(match[1]);
        const unit = match[2];

        if (unit === "K") bitrate *= 1000;
        if (unit === "M") bitrate *= 1000000;

        return bitrate;
      })
      .filter((bitrate) => bitrate > 0);

    return bitrates.length > 0
      ? bitrates.reduce((sum, bitrate) => sum + bitrate, 0) / bitrates.length
      : 0;
  }

  protected formatSize(bytes: number): string {
    const units = ["B", "KB", "MB", "GB", "TB"];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }

  public getStatus() {
    return {
      isRunning: this.isRunning,
      status: this.status,
      outputPath: this.outputPath,
      duration: Date.now() - this.startTime,
      currentStats: this.stats[this.stats.length - 1],
    };
  }
}

// 录制类
export class RecordFfmpeg extends FfmpegCommand {
  private recorderStatus: FfmpegRecorderStatus =
    FfmpegRecorderStatus.NOT_RECORDING;

  constructor(args: string[]) {
    super(args);
  }

  public start(): void {
    this.recorderStatus = FfmpegRecorderStatus.RECORDING;
    super.start();
  }

  public stop(): void {
    super.stop();
    this.recorderStatus = FfmpegRecorderStatus.NOT_RECORDING;
  }

  public kill(): void {
    super.kill();
    this.recorderStatus = FfmpegRecorderStatus.NOT_RECORDING;
  }

  public getStatus() {
    const baseStatus = super.getStatus();
    return {
      ...baseStatus,
      recorderStatus: this.recorderStatus,
    };
  }
}

// 拼接类
export class ConcatFfmpeg extends FfmpegCommand {
  private inputFiles: string[];
  private fileListPath: string;
  private options: ConcatOptions;

  constructor(
    args: string[],
    inputFiles: string[],
    fileListPath: string,
    options: ConcatOptions = {}
  ) {
    super(args);
    this.inputFiles = inputFiles;
    this.fileListPath = fileListPath;
    this.options = options;
  }

  protected handleCompletion(): void {
    super.handleCompletion();
    this.cleanup();
  }

  private cleanup(): void {
    this.cleanupFileList();
    if (this.options.cleanup) {
      this.cleanupInputFiles();
    }
  }

  private cleanupFileList(): void {
    try {
      if (fs.existsSync(this.fileListPath)) {
        fs.unlinkSync(this.fileListPath);
      }
    } catch (error) {
      logger.error("Failed to cleanup file list:", error);
    }
  }

  private cleanupInputFiles(): void {
    try {
      for (const file of this.inputFiles) {
        if (fs.existsSync(file)) {
          fs.unlinkSync(file);
        }
      }
    } catch (error) {
      logger.error("Failed to cleanup input files:", error);
    }
  }
}

export class ScreenshotFfmpeg extends FfmpegCommand {
  private screenshotStatus: FfmpegScreenshotStatus =
    FfmpegScreenshotStatus.NOT_STARTED;

  constructor(args: string[]) {
    super(args);
  }

  public start(): void {
    this.screenshotStatus = FfmpegScreenshotStatus.CAPTURING;
    super.start();
  }

  protected handleCompletion(): void {
    this.screenshotStatus = FfmpegScreenshotStatus.COMPLETED;
    this.emit("screenshotDone", this.outputPath);
  }

  public getStatus() {
    const baseStatus = super.getStatus();
    return {
      ...baseStatus,
      screenshotStatus: this.screenshotStatus,
    };
  }
}

// 主工厂类
export default class Ffmpeg {
  static ffmpegBinPath: string = "";

  public static setup(ffmpegBinPath: string): void {
    this.ffmpegBinPath = ffmpegBinPath;
  }

  private static checkSetup(): void {
    if (!this.ffmpegBinPath) {
      throw new FfmpegSetupError(
        "FFmpeg binary path is not set up. Call Ffmpeg.setup() first."
      );
    }
  }

  public static record(args: string[]): RecordFfmpeg {
    this.checkSetup();
    return new RecordFfmpeg(args);
  }

  public static concat(
    args: string[],
    inputFiles: string[],
    fileListPath: string,
    options: ConcatOptions = {}
  ): ConcatFfmpeg {
    this.checkSetup();
    return new ConcatFfmpeg(args, inputFiles, fileListPath, options);
  }

  public static createRecordingCommand(
    inputUrl: string,
    outputPath: string,
    options: {
      quality?: string;
      format?: string;
      duration?: number;
      videoCodec?: string;
      audioCodec?: string;
      userAgent?: string;
      headers?: Record<string, string>;
    } = {}
  ): RecordFfmpeg {
    if (fs.existsSync(outputPath)) {
      throw new FfmpegSetupError(`Output file already exists: ${outputPath}`);
    }

    const args = [];

    if (options.userAgent) {
      args.push("-user_agent", options.userAgent);
    }

    if (options.headers) {
      const headerLines = Object.entries(options.headers).map(
        ([key, value]) => `${key}: ${value}`
      );
      if (headerLines.length > 0) {
        args.push("-headers", headerLines.join("\\r\\n"));
      }
    }

    args.push("-i", inputUrl);
    args.push(
      "-c:v",
      options.videoCodec || "copy",
      "-c:a",
      options.audioCodec || "copy",
      "-f",
      options.format || "flv"
    );

    if (options.quality) args.push("-q:v", options.quality);
    if (options.duration) args.push("-t", options.duration.toString());
    args.push(outputPath);

    return this.record(args);
  }

  public static createConcatCommand(
    inputFiles: string[],
    outputPath: string,
    options: ConcatOptions = {}
  ): ConcatFfmpeg {
    if (fs.existsSync(outputPath)) {
      throw new FfmpegSetupError(`Output file already exists: ${outputPath}`);
    }

    for (const file of inputFiles) {
      if (!fs.existsSync(file)) {
        throw new FfmpegSetupError(`Input file does not exist: ${file}`);
      }
    }

    const fileListPath =
      options.fileListPath || this.generateFileListPath(outputPath);
    const fileListContent = inputFiles
      .map((file) => `file '${this.escapeFilePath(file)}'`)
      .join("\n");

    try {
      fs.writeFileSync(fileListPath, fileListContent, "utf8");
    } catch (error) {
      throw new FfmpegSetupError(
        `Failed to create file list: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    const args = [
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      fileListPath,
      "-c",
      "copy",
      "-y",
    ];

    if (options.videoCodec && options.videoCodec !== "copy")
      args.push("-c:v", options.videoCodec);
    if (options.audioCodec && options.audioCodec !== "copy")
      args.push("-c:a", options.audioCodec);
    if (options.format) args.push("-f", options.format);
    args.push(outputPath);

    return this.concat(args, inputFiles, fileListPath, options);
  }

  public static screenshot(args: string[]): ScreenshotFfmpeg {
    this.checkSetup();
    return new ScreenshotFfmpeg(args);
  }

  public static createScreenshotCommand(
    inputUrl: string,
    outputPath: string,
    options: {
      timestamp?: string; // 格式: "HH:MM:SS" 或 "SS" 或 "SS.MS"
      frameNumber?: number; // 帧号（如果使用帧号而不是时间戳）
      quality?: number; // 图片质量 1-31（2-5通常很好）
      format?: string; // 输出格式，如 "jpg", "png"
      width?: number; // 缩放宽
      height?: number; // 缩放高
      keepAspectRatio?: boolean; // 保持宽高比
      userAgent?: string;
      headers?: Record<string, string>;
    } = {}
  ): ScreenshotFfmpeg {
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath); // 删除已存在的文件
    }

    const args = [];

    if (options.userAgent) {
      args.push("-user_agent", options.userAgent);
    }

    if (options.headers) {
      const headerLines = Object.entries(options.headers).map(
        ([key, value]) => `${key}: ${value}`
      );
      if (headerLines.length > 0) {
        args.push("-headers", headerLines.join("\\r\\n"));
      }
    }

    args.push("-i", inputUrl);

    // 时间点或帧号
    if (options.timestamp) {
      args.push("-ss", options.timestamp);
    } else if (options.frameNumber !== undefined) {
      args.push("-vf", `select=eq(n\\,${options.frameNumber})`);
    } else {
      args.push("-ss", "00:00:00"); // 默认截取第一帧
    }

    // 只取一帧
    args.push("-vframes", "1");

    // 图片质量
    if (options.quality) {
      args.push("-q:v", options.quality.toString());
    } else {
      args.push("-q:v", "2"); // 默认高质量
    }

    // 缩放
    if (options.width || options.height) {
      const scaleFilter = [];
      if (options.width && options.height) {
        if (options.keepAspectRatio) {
          scaleFilter.push(
            `scale=w=${options.width}:h=${options.height}:force_original_aspect_ratio=decrease`
          );
        } else {
          scaleFilter.push(`scale=${options.width}:${options.height}`);
        }
      } else if (options.width) {
        scaleFilter.push(`scale=${options.width}:-1`);
      } else if (options.height) {
        scaleFilter.push(`scale=-1:${options.height}`);
      }
      if (scaleFilter.length > 0) {
        args.push("-vf", scaleFilter.join(","));
      }
    }

    // 输出格式
    if (options.format) {
      args.push("-f", options.format);
    }

    args.push("-update", "1");

    args.push("-y", outputPath);

    return this.screenshot(args);
  }

  public static async screenshotSync(
    inputUrl: string,
    outputPath: string,
    options: {
      timestamp?: string;
      frameNumber?: number;
      quality?: number;
      format?: string;
      width?: number;
      height?: number;
      keepAspectRatio?: boolean;
      userAgent?: string;
      headers?: Record<string, string>;
    } = {}
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const instance = this.createScreenshotCommand(
        inputUrl,
        outputPath,
        options
      );

      instance.once("screenshotDone", (savedPath) => resolve(savedPath));
      instance.once("err", (error) => reject(error));

      instance.start();
    });
  }

  private static generateFileListPath(outputPath: string): string {
    const outputDir = path.dirname(outputPath);
    const outputName = path.basename(outputPath, path.extname(outputPath));
    return path.join(outputDir, `${outputName}_filelist.txt`);
  }

  private static escapeFilePath(filePath: string): string {
    return filePath.replace(/'/g, "'\\''");
  }

  public static async concatSync(
    inputFiles: string[],
    outputPath: string,
    options: ConcatOptions = {}
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const instance = this.createConcatCommand(
        inputFiles,
        outputPath,
        options
      );

      instance.once("done", () => resolve());
      instance.once("err", (error) => reject(error));
      instance.start();
    });
  }
}
