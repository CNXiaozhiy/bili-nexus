import fs from "fs";
import os from "os";
import { EventEmitter } from "events";
import path from "path";
import getLogger from "@/utils/logger";
import {
  DiskSpaceMonitorError,
  DiskSpaceMonitorSetupError,
} from "@/types/errors/disk-space-monitor";

const logger = getLogger("DiskSpaceMonitor");

export interface DiskSpaceOptions {
  checkInterval?: number; // 检查间隔（毫秒），默认 60000 (1分钟)
  lowSpaceThreshold?: number; // 低容量阈值（字节），默认 5GB
  criticalSpaceThreshold?: number; // 极低容量阈值（字节），默认 1GB
  fatalSpaceThreshold?: number; // 致命容量阈值（字节），默认 100MB
}

export interface DiskSpaceInfo {
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  freePercentage: number;
  usedPercentage: number;
  path: string;
  status: DiskSpaceStatus; // 当前磁盘空间状态
}

export type DiskSpaceStatus = "normal" | "abnormal";
export type AbnormalLevel = "low" | "critical" | "fatal";

export interface DiskSpaceMonitorEvents {
  "space-info": [DiskSpaceInfo]; // 周期性容量信息事件
  "normal-space": [DiskSpaceInfo]; // 正常容量事件
  "abnormal-space": [DiskSpaceInfo, AbnormalLevel]; // 异常容量事件，包含子状态
  error: [Error];
}

class DiskSpaceMonitor extends EventEmitter<DiskSpaceMonitorEvents> {
  private directory: string;
  private checkInterval: number;
  private lowSpaceThreshold: number;
  private criticalSpaceThreshold: number;
  private fatalSpaceThreshold: number;
  private timer: NodeJS.Timeout | null = null;
  private isMonitoring: boolean = false;
  private lastSpaceInfo: DiskSpaceInfo | null = null;
  private lastStatus: DiskSpaceStatus = "normal"; // 记录上次状态
  private lastAbnormalLevel: AbnormalLevel | null = null; // 记录上次异常等级

  constructor(directory: string, options: DiskSpaceOptions = {}) {
    super();

    this.directory = path.resolve(directory);
    this.checkInterval = options.checkInterval || 60000; // 默认1分钟
    this.lowSpaceThreshold =
      options.lowSpaceThreshold || 5 * 1024 * 1024 * 1024; // 默认5GB
    this.criticalSpaceThreshold =
      options.criticalSpaceThreshold || 1 * 1024 * 1024 * 1024; // 默认1GB
    this.fatalSpaceThreshold = options.fatalSpaceThreshold || 100 * 1024 * 1024; // 默认100MB

    this.validateOptions();
  }

  /**
   * 验证选项参数
   */
  private validateOptions(): void {
    if (this.checkInterval < 1000) {
      throw new DiskSpaceMonitorSetupError("检查间隔不能小于1000毫秒");
    }

    if (this.fatalSpaceThreshold >= this.criticalSpaceThreshold) {
      throw new DiskSpaceMonitorSetupError("致命容量阈值必须小于极低容量阈值");
    }

    if (this.criticalSpaceThreshold >= this.lowSpaceThreshold) {
      throw new DiskSpaceMonitorSetupError("极低容量阈值必须小于低容量阈值");
    }
  }

  /**
   * 获取目录所在磁盘的空间信息
   */
  private async getDiskSpace(): Promise<DiskSpaceInfo> {
    return new Promise((resolve, reject) => {
      // fs.statfs (Node.js 18.15.0+)
      if (fs.statfs) {
        fs.statfs(this.directory, (err, stats) => {
          if (err) {
            reject(err);
            return;
          }

          // 根据平台计算磁盘空间
          const totalBytes = stats.blocks * stats.bsize;
          const freeBytes = stats.bfree * stats.bsize;
          const usedBytes = totalBytes - freeBytes;
          const freePercentage = (freeBytes / totalBytes) * 100;
          const usedPercentage = (usedBytes / totalBytes) * 100;

          // 确定当前状态
          const status = this.determineSpaceStatus(freeBytes);

          resolve({
            totalBytes,
            freeBytes,
            usedBytes,
            freePercentage,
            usedPercentage,
            path: this.directory,
            status,
          });
        });
      } else {
        // 跨平台
        this.getDiskSpaceViaCommand().then(resolve).catch(reject);
      }
    });
  }

  /**
   * 根据可用空间确定状态
   */
  private determineSpaceStatus(freeBytes: number): DiskSpaceStatus {
    if (freeBytes > this.lowSpaceThreshold) {
      return "normal";
    }
    return "abnormal";
  }

  /**
   * 根据可用空间确定异常等级
   */
  private determineAbnormalLevel(freeBytes: number): AbnormalLevel {
    if (freeBytes <= this.fatalSpaceThreshold) {
      return "fatal";
    } else if (freeBytes <= this.criticalSpaceThreshold) {
      return "critical";
    } else {
      return "low";
    }
  }

  /**
   * 通过系统命令获取磁盘空间 (跨平台兼容)
   */
  private async getDiskSpaceViaCommand(): Promise<DiskSpaceInfo> {
    const { exec } = await import("child_process");

    return new Promise((resolve, reject) => {
      const platform = os.platform();
      let command: string;

      if (platform === "win32") {
        // Windows
        command = `wmic logicaldisk where "DeviceID='${this.directory.substring(
          0,
          2
        )}'" get Size,FreeSpace /value`;
      } else if (platform === "darwin" || platform === "linux") {
        // macOS 或 Linux
        command = `df -k "${this.directory}" | tail -1`;
      } else {
        reject(new DiskSpaceMonitorError(`不支持的平台: ${platform}`));
        return;
      }

      exec(command, (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }

        if (stderr) {
          reject(new Error(stderr));
          return;
        }

        try {
          const spaceInfo = this.parseDiskSpaceOutput(stdout, platform);
          // 确定当前状态
          spaceInfo.status = this.determineSpaceStatus(spaceInfo.freeBytes);
          resolve(spaceInfo);
        } catch (parseError) {
          reject(parseError);
        }
      });
    });
  }

  /**
   * 解析磁盘空间命令输出
   */
  private parseDiskSpaceOutput(
    output: string,
    platform: string
  ): DiskSpaceInfo {
    if (platform === "win32") {
      // Windows WMIC 输出解析
      const freeMatch = output.match(/FreeSpace=(\d+)/);
      const totalMatch = output.match(/Size=(\d+)/);

      if (!freeMatch || !totalMatch) {
        throw new DiskSpaceMonitorError("无法解析Windows磁盘空间信息");
      }

      const freeBytes = parseInt(freeMatch[1], 10);
      const totalBytes = parseInt(totalMatch[1], 10);
      const usedBytes = totalBytes - freeBytes;
      const freePercentage = (freeBytes / totalBytes) * 100;
      const usedPercentage = (usedBytes / totalBytes) * 100;

      return {
        totalBytes,
        freeBytes,
        usedBytes,
        freePercentage,
        usedPercentage,
        path: this.directory,
        status: "normal", // 将在外部设置
      };
    } else {
      // macOS/Linux df 输出解析
      const lines = output.trim().split("\n");
      const lastLine = lines[lines.length - 1];
      const parts = lastLine.split(/\s+/).filter((part) => part !== "");

      if (parts.length < 4) {
        throw new DiskSpaceMonitorError("无法解析磁盘空间信息");
      }

      // df -k 输出以KB为单位，需要转换为字节
      const totalBytes = parseInt(parts[1], 10) * 1024;
      const usedBytes = parseInt(parts[2], 10) * 1024;
      const freeBytes = parseInt(parts[3], 10) * 1024;
      const freePercentage = (freeBytes / totalBytes) * 100;
      const usedPercentage = (usedBytes / totalBytes) * 100;

      return {
        totalBytes,
        freeBytes,
        usedBytes,
        freePercentage,
        usedPercentage,
        path: this.directory,
        status: "normal", // 将在外部设置
      };
    }
  }

  /**
   * 检查是否需要发送通知
   */
  private shouldNotify(
    currentStatus: DiskSpaceStatus,
    currentAbnormalLevel: AbnormalLevel | null
  ): boolean {
    // 状态变化：从正常到异常或从异常到正常
    if (currentStatus !== this.lastStatus) {
      return true;
    }

    // 仍然是异常状态，但异常等级升高
    if (
      currentStatus === "abnormal" &&
      currentAbnormalLevel &&
      this.lastAbnormalLevel
    ) {
      // 定义异常等级严重程度顺序
      const severityOrder: Record<AbnormalLevel, number> = {
        low: 1,
        critical: 2,
        fatal: 3,
      };

      return (
        severityOrder[currentAbnormalLevel] >
        severityOrder[this.lastAbnormalLevel]
      );
    }

    return false;
  }

  /**
   * 检查磁盘空间并触发相应事件
   */
  private async checkSpace(): Promise<void> {
    try {
      const spaceInfo = await this.getDiskSpace();

      // 总是更新最后一次空间信息
      this.lastSpaceInfo = spaceInfo;

      this.emit("space-info", spaceInfo);

      // 确定当前异常等级（如果是异常状态）
      let currentAbnormalLevel: AbnormalLevel | null = null;
      if (spaceInfo.status === "abnormal") {
        currentAbnormalLevel = this.determineAbnormalLevel(spaceInfo.freeBytes);
      }

      // 检查是否需要发送通知
      if (this.shouldNotify(spaceInfo.status, currentAbnormalLevel)) {
        if (spaceInfo.status === "normal") {
          // 状态变为正常，发送正常容量事件
          this.emit("normal-space", spaceInfo);
          logger.info(
            `磁盘空间恢复正常: ${this.formatBytes(spaceInfo.freeBytes)} 可用`
          );
        } else {
          // 状态变为异常或异常等级升高，发送异常容量事件
          this.emit("abnormal-space", spaceInfo, currentAbnormalLevel!);

          const levelText = {
            low: "低容量",
            critical: "极低容量",
            fatal: "致命容量",
          }[currentAbnormalLevel!];

          logger.warn(
            `磁盘空间${levelText}: ${this.formatBytes(
              spaceInfo.freeBytes
            )} 可用`
          );
        }
      }

      // 更新状态记录
      this.lastStatus = spaceInfo.status;
      this.lastAbnormalLevel = currentAbnormalLevel;
    } catch (error) {
      this.emit("error", error as Error);
      logger.error(`检查磁盘空间时出错: ${error}`);
    }
  }

  /**
   * 格式化字节数为易读格式
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return "0 Bytes";

    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }

  startMonitor(): void {
    if (this.isMonitoring) {
      return;
    }

    this.isMonitoring = true;

    // 立即执行一次检查
    this.checkSpace();

    // 设置定时检查
    this.timer = setInterval(() => {
      this.checkSpace();
    }, this.checkInterval);

    logger.info(
      `开始监控目录: ${this.directory}, 检查间隔: ${this.checkInterval}ms`
    );
  }

  stopMonitor(): void {
    if (!this.isMonitoring) {
      return;
    }

    this.isMonitoring = false;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    logger.info(`停止监控目录: ${this.directory}`);
  }

  /**
   * 获取最后一次空间信息
   */
  getLastSpaceInfo(): DiskSpaceInfo | null {
    return this.lastSpaceInfo;
  }

  /**
   * 获取当前状态
   */
  getCurrentStatus(): {
    status: DiskSpaceStatus;
    abnormalLevel: AbnormalLevel | null;
  } {
    return {
      status: this.lastStatus,
      abnormalLevel: this.lastAbnormalLevel,
    };
  }

  /**
   * 更新监控选项
   */
  updateOptions(options: Partial<DiskSpaceOptions>): void {
    let shouldRestart = false;

    if (options.checkInterval !== undefined) {
      this.checkInterval = options.checkInterval;
      shouldRestart = true;
    }

    if (options.lowSpaceThreshold !== undefined) {
      this.lowSpaceThreshold = options.lowSpaceThreshold;
    }

    if (options.criticalSpaceThreshold !== undefined) {
      this.criticalSpaceThreshold = options.criticalSpaceThreshold;
    }

    if (options.fatalSpaceThreshold !== undefined) {
      this.fatalSpaceThreshold = options.fatalSpaceThreshold;
    }

    this.validateOptions();

    // 如果正在监控，重启监控以应用新的间隔
    if (this.isMonitoring && shouldRestart) {
      this.stopMonitor();
      this.startMonitor();
    }

    logger.info("监控选项已更新");
  }

  /**
   * 获取监控状态
   */
  getStatus(): {
    isMonitoring: boolean;
    directory: string;
    currentStatus: DiskSpaceStatus;
    abnormalLevel: AbnormalLevel | null;
  } {
    return {
      isMonitoring: this.isMonitoring,
      directory: this.directory,
      currentStatus: this.lastStatus,
      abnormalLevel: this.lastAbnormalLevel,
    };
  }

  /**
   * 手动触发一次检查
   */
  async manualCheck(): Promise<DiskSpaceInfo> {
    const spaceInfo = await this.getDiskSpace();
    this.lastSpaceInfo = spaceInfo;
    return spaceInfo;
  }

  /**
   * 销毁监控器
   */
  destroy(): void {
    this.stopMonitor();
    this.removeAllListeners();
    logger.info("磁盘空间监控器已销毁");
  }
}

export default DiskSpaceMonitor;
