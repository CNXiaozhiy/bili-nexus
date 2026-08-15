import { FormatUtils, getLogger } from "@bili-nexus/core";
import type { DynamicAutomationManager } from "@bili-nexus/core";
import { qqBotConfigManager } from "../../config";
import { OneBotMessageUtils } from "../../types/one-bot";
import type { SegmentMessage } from "../../types/one-bot";
import { SubscriptionQuery } from "../subscription/store";
import { renderNewDynamic } from "../templates";
import type XzQBot from "../../client/xz-qbot";

const logger = getLogger("QQBotNotifier:Dynamic");

/** 主播新动态事件 → QQ 群通知 */
export function installDynamicNotifier(bot: XzQBot, dynamic: DynamicAutomationManager): void {
  dynamic.on("new-dynamic", (mid, dynamicId, card) => {
    logger.debug(`收到 spaceDynamicMonitor 的事件 -> new, mid: ${mid}, dynamicId: ${dynamicId}`);

    const usersDynamicConfig = qqBotConfigManager.get("userDynamic");
    const userConfig = usersDynamicConfig[mid];
    const query = new SubscriptionQuery(usersDynamicConfig);

    if (!userConfig) {
      logger.info(`用户 ${mid} 没有设置动态通知配置, 通知已取消`);
      return;
    }
    if (!userConfig.notify) {
      logger.debug(`用户 ${mid} 没有开启动态通知, 通知已取消`);
      return;
    }

    const notifyGroups = userConfig.group || {};

    if (!notifyGroups) {
      logger.debug(`用户 ${mid} 没有设置动态通知群组, 通知已取消`);
      return;
    }

    logger.debug(`开始动态通知 -> 用户 ${mid}, 动态ID: ${dynamicId}`);

    Object.entries(notifyGroups).forEach(async ([_gid, group]) => {
      const gid = parseInt(_gid);

      let shouldAtAll = false;
      try {
        const botUid = bot.getQID();

        shouldAtAll = !botUid ? false : query.isOfficialGroup(mid, gid) && ["admin", "owner"].includes((await bot.getGroupMemberInfo(gid, botUid)).data.role);
      } catch (e) {
        logger.warn(`判断是否需要At全体时出错:`, e);
      }

      let atSegmentMessage: SegmentMessage[] = [];
      let unavailableGroupUserArr: number[] = [];

      if (shouldAtAll) {
        atSegmentMessage = [OneBotMessageUtils.At("all")];
      } else {
        const targetUserArr = group.users;

        logger.info("通知用户组检查 -> 开始校验有效用户列表");

        let actualGroupMemberSet = new Set<number>();

        try {
          const memberResult = await bot.getGroupMemberList(gid);
          actualGroupMemberSet = new Set(memberResult.data.map((e) => e.user_id));
        } catch (error) {
          logger.error("通知用户组检查 -> 获取群成员列表失败", error);
        }

        const availableGroupUserArr = targetUserArr.filter((e) => actualGroupMemberSet.has(e));

        unavailableGroupUserArr = targetUserArr.filter((e) => !actualGroupMemberSet.has(e));

        if (availableGroupUserArr.length < targetUserArr.length) {
          logger.warn("通知用户组检查 -> 检测到不可用的用户 ->", unavailableGroupUserArr);
          logger.warn("通知用户组检查 -> 即将更新配置文件");

          userConfig.group[gid].users = availableGroupUserArr;
          qqBotConfigManager.set("userDynamic", usersDynamicConfig);
          logger.info(`通知用户组检查 -> 已设置 ${gid} 的最新动态配置✅`);
        } else {
          logger.info("通知用户组检查 -> 检测通过，均为存在用户✅");
        }

        atSegmentMessage = availableGroupUserArr.map<SegmentMessage>((qq) => {
          return OneBotMessageUtils.At(qq);
        });
      }

      await bot.sendGroup(gid, await renderNewDynamic(card));

      await bot.sendGroup(gid, [OneBotMessageUtils.Text(`UP发布新动态啦\n发布于: ${FormatUtils.formatTimeAgo(Date.now() - card.desc.timestamp * 1000)}\n\n`), ...atSegmentMessage]);

      logger.debug(`群聊通知完成✅ -> Group ${gid}, 通知用户数: ${atSegmentMessage.length}`);

      if (unavailableGroupUserArr.length > 0) {
        await bot.sendGroup(gid, [OneBotMessageUtils.Text(`警告：已删除 ${unavailableGroupUserArr.length} 个不可用的用户\n\n${unavailableGroupUserArr.join(", ")}`)]);
      }
    });
  });
}
