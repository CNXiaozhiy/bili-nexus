import EventEmitter from "events";
import getLogger from "@/utils/logger";
import { BiliAccount } from "@/core/bilibili/bili-account";
import { DynamicNewCardsMember } from "@/types/bilibili";

const logger = getLogger("DynamicAutomationManager");

export interface DynamicAutomationManagerEvents {
  "new-user": [mid: string];
  "remove-user": [mid: string];
  "new-dynamic": [mid: string, dynamicId: string, card: DynamicNewCardsMember];
}

export default class DynamicAutomationManager extends EventEmitter<DynamicAutomationManagerEvents> {
  private users = new Set<string>();
  private isRunning = false;

  private latestDynamicPostTime = 0;

  constructor(private readonly biliAccount: BiliAccount) {
    super();
  }

  public addUser(mid: string) {
    if (this.users.has(mid)) {
      logger.debug(`用户已添加过, 跳过`);
      return;
    }

    logger.info(`添加用户 ${mid} 成功 ✅`);
    this.users.add(mid);
    logger.debug(`发射事件 new-user -> ${mid}`);
    this.emit("new-user", mid);
  }

  public removeUser(mid: string) {
    if (!this.users.has(mid)) {
      logger.debug(`用户未添加过, 跳过`);
      return;
    }

    logger.debug(`移除用户 ${mid}`);
    this.users.delete(mid.toString());
    this.emit("remove-user", mid);
    logger.debug(`发射事件 remove-user -> ${mid}`);
  }

  public startMonitor() {
    if (this.isRunning) {
      logger.debug(`动态监控自动化已启动, 跳过`);
      return;
    }

    this.isRunning = true;
    this.pool();

    logger.info(`动态监控自动化已启动 ✅`);
  }

  public stopMonitor() {
    this.isRunning = false;
  }

  private pool() {
    const biliApi = this.biliAccount.getBiliApi();

    biliApi
      .getDynamicNew()
      .then((resp) => {
        const data = resp.data;

        if (data.new_num > 0) {
          logger.info(`检测到 ${data.new_num} 条新动态`);
        }

        if (data.cards.length === 0) {
          return;
        }

        // const cards = data.cards.sort((a, b) => b.desc.timestamp - a.desc.timestamp);
        const cards = data.cards;

        if (!this.latestDynamicPostTime) {
          this.latestDynamicPostTime = cards[0].desc.timestamp;
          logger.info(`最新动态时间 -> ${this.latestDynamicPostTime}`);
          return;
        }

        const _latestDynamicPostTime = cards[0].desc.timestamp;

        if (_latestDynamicPostTime <= this.latestDynamicPostTime) {
          // 动态没变化，或上次的最新动态被删除
          return;
        }

        for (let i = 0; i < data.cards.length; i++) {
          const card = data.cards[i];

          const uid = card.desc.uid.toString();
          const dynamicId = card.desc.dynamic_id;
          const timestamp = card.desc.timestamp;

          if (!this.users.has(uid)) {
            continue;
          }

          if (timestamp > this.latestDynamicPostTime) {
            logger.info(`检测到用户 ${uid} 发布了新动态 ->`, dynamicId);
            logger.debug(`发射事件 new-dynamic -> ${uid} -> ${dynamicId}`);
            this.emit("new-dynamic", uid, dynamicId, card);
          } else {
            break;
          }
        }

        this.latestDynamicPostTime = _latestDynamicPostTime;

        // for (let i = 0; i < data.cards.length; i++) {
        //   const card = data.cards[i];

        //   const uid = card.desc.uid.toString();
        //   const dynamicId = card.desc.dynamic_id;
        //   const timestamp = card.desc.timestamp;

        //   if (timestamp < this.startMonitorTime) {
        //     continue;
        //   }

        //   if (!this.users.has(uid)) {
        //     continue;
        //   }

        //   if (!this.latestDynamicMap.has(uid) || this.latestDynamicMap.get(uid)! < timestamp) {
        //     this.latestDynamicMap.set(uid, timestamp);

        //     logger.info(`检测到用户 ${uid} 发布了新动态 ->`, dynamicId);
        //     logger.debug(`发射事件 new-dynamic -> ${uid} -> ${dynamicId}`);
        //     this.emit("new-dynamic", uid, dynamicId, card);
        //   }
        // }

        // 递归pool
        if (this.isRunning) {
          setTimeout(() => this.pool(), 3000);
        }
      })
      .catch((error) => {
        logger.error(`获取动态失败: ${error}`);
        if (this.isRunning) {
          setTimeout(() => this.pool(), 5000);
        }
      });
  }
}
