import EventEmitter from "events";
import getLogger from "@/utils/logger";
import { SpaceDynamicItem } from "@/types/bilibili";
import BiliApi from "@/core/bilibili/bili-api";

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

  constructor(
    options: SpaceDynamicMonitorOptions,
    private readonly biliApi: BiliApi
  ) {
    super();
    this.mid = options.mid;
    this.interval = options.interval ?? 30000;
  }

  public async poll() {
    try {
      const { data: spaceDynamic } = await this.biliApi.getSpaceDynamic(
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

      const pubTs = parseInt(item.modules.module_author.pub_ts);

      if (this.lastDynamicId && this.lastDynamicId !== dynamicId) {
        logger.info(
          `检测到 ${this.mid} 动态更新, ${this.lastDynamicId} -> ${dynamicId}`
        );
        if (pubTs <= this.lastDynamicPubTs) {
          // 动态发布的比上一次的最新的动态还早，可能发生了删除动态动作
          logger.warn(
            "检测到最新动态发布时间异常，判定为动态更改或删除而非新动态发布"
          );
          logger.warn("该动态发布于: " + item.modules.module_author.pub_time);
        } else {
          logger.info(
            `检测到 ${this.mid} 的最新动态 -> ${dynamicId}, 发布于: ${item.modules.module_author.pub_time}`
          );
          this.emit("new", dynamicId, item);
        }
      }

      this.lastDynamicId = dynamicId;
      this.lastDynamicPubTs = pubTs;
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
