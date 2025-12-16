import EventEmitter from "events";
import BiliApiService from "../bili-api";
import getLogger from "@/utils/logger";
import { SpaceDynamicItem } from "@/types/bili";

const logger = getLogger("SpaceDynamicMonitor");

export interface SpaceDynamicMonitorOptions {
  mid: number;
  interval?: number;
}

export interface SpaceDynamicMonitorEvents {
  new: [id: string, dynamic: SpaceDynamicItem];
}

export default class SpaceDynamicMonitor extends EventEmitter<SpaceDynamicMonitorEvents> {
  public readonly mid: number;
  public interval: number;

  private checkIntervalId?: NodeJS.Timeout;
  private lastDynamicId: string = "";
  private lastDynamicPubTs: number = 0;

  constructor(options: SpaceDynamicMonitorOptions) {
    super();
    this.mid = options.mid;
    this.interval = options.interval ?? 10000;
  }

  public async poll() {
    try {
      const { data: spaceDynamic } =
        await BiliApiService.getDefaultInstance().getSpaceDynamic(
          this.mid,
          true
        );
      let item = spaceDynamic.items[0];
      if (item.modules.module_tag && item.modules.module_tag.text === "置顶")
        item = spaceDynamic.items[1];

      const dynamicId = item.id_str;

      if (!this.lastDynamicId) {
        logger.info(`记录初始动态, ${this.mid} -> 的最新动态 ${dynamicId}`);
      }

      if (this.lastDynamicId && this.lastDynamicId !== dynamicId) {
        logger.info(`检测到动态更新, ${this.mid} -> 的最新动态ID ${dynamicId}`);
        if (this.lastDynamicPubTs === item.modules.module_author.pub_ts) {
          // 仅 ID 变化
          logger.warn(
            "检测到最新动态ID变化但pub_ts未变化，判定为动态ID调整而非新动态发布"
          );
          logger.warn("该动态发布于: " + item.modules.module_author.pub_time);
        } else {
          this.emit("new", dynamicId, item);
        }
      }

      this.lastDynamicId = dynamicId;
      this.lastDynamicPubTs = item.modules.module_author.pub_ts;
    } catch (e) {}
  }

  public startMonitor() {
    logger.info(`开始监控 ${this.mid} 的动态`);
    this.poll();
    this.checkIntervalId = setInterval(() => {
      this.poll();
    }, this.interval);
  }

  public stopMonitor() {
    logger.info(`停止监控 ${this.mid} 的动态`);
    if (this.checkIntervalId) {
      clearInterval(this.checkIntervalId);
    }
  }

  public destroy() {
    this.stopMonitor();
    this.removeAllListeners();
  }
}
