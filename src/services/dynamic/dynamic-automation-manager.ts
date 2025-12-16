import EventEmitter from "events";
import SpaceDynamicMonitor from "@/core/bilibili/dynamic/space-dynamic-monitor";
import { getLogger } from "log4js";
import { BiliAccount } from "@/core/bilibili/bili-account";

const logger = getLogger("DynamicAutomationManager");

export interface DynamicAutomationManagerEvents {
  "new-monitor": [monitor: SpaceDynamicMonitor, mid: number];
  "remove-user": [mid: number];
}

export default class DynamicAutomationManager extends EventEmitter<DynamicAutomationManagerEvents> {
  private monitors: Map<number, SpaceDynamicMonitor> = new Map(); // mid -> SpaceDynamicMonitor
  private users = new Set<number>();

  constructor(private readonly biliAccount: BiliAccount) {
    super();
  }

  public addUser(mid: number) {
    if (this.users.has(mid)) {
      logger.debug(`用户已添加过, 跳过`);
    }

    logger.debug(`添加用户 ${mid}`);
    this.users.add(mid);
    const monitor = new SpaceDynamicMonitor(
      { mid },
      this.biliAccount.getBiliApi()
    );
    this.monitors.set(mid, monitor);
    logger.debug(`发射事件 new-monitor -> SpaceDynamicMonitor.mid: ${mid}`);
    this.emit("new-monitor", monitor, mid);
    monitor.startMonitor();
  }

  public removeUser(mid: number) {
    if (!this.users.has(mid)) {
      logger.debug(`用户未添加过, 跳过`);
    }

    logger.debug(`移除用户 ${mid}`);
    this.users.delete(mid);
    this.emit("remove-user", mid);
    logger.debug(`发射事件 remove-user -> ${mid}`);
    const monitor = this.monitors.get(mid);
    if (!monitor) {
      logger.debug(`移除用户失败 -> ${mid} 不存在`);
      return;
    }
    monitor.stopMonitor();
    this.monitors.delete(mid);
  }

  public getSpaceDynamicMonitors() {
    return this.monitors;
  }
}
