import {
  AuditAegisState,
  AuditState,
  FormatUtils,
  getLogger,
} from "@bili-nexus/core";
import type {
  LiveAutomationManager,
  UploadEventOptions,
  VideoUploader,
} from "@bili-nexus/core";
import { AxiosError } from "axios";
import { qqBotConfigManager } from "../../config";
import { OneBotMessageUtils } from "../../types/one-bot";
import type { SegmentMessage } from "../../types/one-bot";
import { SubscriptionQuery } from "../subscription/store";
import { renderLiveEndTemplate, renderLiveStartTemplate } from "../templates";
import type XzQBot from "../../client/xz-qbot";

const logger = getLogger("QQBotNotifier:Live");

const UPLOAD_AUDIT_TIMEOUT = 60 * 60 * 1000; // 投稿审核追踪超时 1h

/** 直播开播/关播/投稿事件 → QQ 群通知 */
export function installLiveNotifier(bot: XzQBot, live: LiveAutomationManager): void {
  live.on("live-start", async ({ roomId, hash: liveHash, roomInfo, isFirst }) => {
    logger.debug(`收到 liveAutomationManager 开始直播(live-start)🟢 事件 -> live-start, roomId: ${roomId}, liveHash: ${liveHash}, isFirst: ${isFirst}`);

    if (isFirst) {
      logger.info(`房间 ${roomId} 为首次直播状态通知，跳过QQ直播通知`);
      return;
    }

    const liveRoomsConfig = qqBotConfigManager.get("liveRoom");
    const roomConfig = liveRoomsConfig[roomId.toString()];
    const query = new SubscriptionQuery(liveRoomsConfig);

    if (!roomConfig) {
      logger.warn(`直播间 ${roomId} 配置不存在或未配置`);
      return;
    }
    if (!roomConfig.notify) {
      logger.debug(`直播间 ${roomId} 通知已禁用！`);
      return;
    }

    const notifyGroups = roomConfig.group || {};

    if (Object.keys(notifyGroups).length === 0) {
      logger.debug(`直播间 ${roomId} 无群组订阅, 跳过通知`);
      return;
    }

    const liveStatusMessages = await renderLiveStartTemplate(roomInfo, liveHash);

    Object.entries(notifyGroups).forEach(async ([_gid, group]) => {
      const gid = parseInt(_gid);

      let shouldAtAll = false;
      try {
        const botUid = bot.getQID();

        shouldAtAll = query.isOfficialGroup(roomId, gid) && ["admin", "owner"].includes((await bot.getGroupMemberInfo(gid, botUid)).data.role);
      } catch (e) {
        logger.warn(`判断是否需要At全体时出错:`, e);
      }

      let atSegmentMessage: SegmentMessage[] = [];
      let unavailableGroupUserArr: number[] = [];

      if (shouldAtAll) {
        logger.debug("需要At全体");
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

          roomConfig.group[gid].users = availableGroupUserArr;
          qqBotConfigManager.set("liveRoom", liveRoomsConfig);
          logger.info(`通知用户组检查 -> 已设置 ${gid} 的最新配置✅`);
        } else {
          logger.info("通知用户组检查 -> 检测通过，均为存在用户✅");
        }

        atSegmentMessage = availableGroupUserArr.map((qq) => {
          return OneBotMessageUtils.At(qq);
        });
      }

      await bot.sendGroup(gid, liveStatusMessages);

      await bot.sendGroup(gid, [OneBotMessageUtils.Text("您订阅的直播间开始直播啦\n"), ...atSegmentMessage]);

      logger.debug(`群聊通知完成✅ -> Group ${gid}, 通知用户数: ${atSegmentMessage.length}`);

      if (unavailableGroupUserArr.length > 0) {
        await bot.sendGroup(gid, [OneBotMessageUtils.Text(`警告：已删除 ${unavailableGroupUserArr.length} 个不可用的用户\n\n${unavailableGroupUserArr.join(", ")}`)]);
      }
    });
  });

  live.on(
    "live-end",
    async ({ roomId, hash: liveHash, liveStartRoomInfo, liveEndRoomInfo, liveDuration, isFirst }) => {
      logger.debug(`收到 liveAutomationManager 结束直播(live-end)🔴 事件, roomId: ${roomId}, liveHash: ${liveHash}, isFirst: ${isFirst}`);

      if (isFirst) {
        logger.info(`房间 ${roomId} 为首次直播状态通知，跳过QQ直播通知`);
        return;
      }

      const liveRoomConfig = qqBotConfigManager.get("liveRoom")[roomId.toString()];

      if (!liveRoomConfig) {
        logger.warn(`直播间 ${roomId} 配置不存在或未配置`);
        return;
      }
      if (!liveRoomConfig.notify) {
        logger.debug(`直播间 ${roomId} 通知已禁用！`);
        return;
      }

      const notifyGroups = liveRoomConfig.group || {};

      if (Object.keys(notifyGroups).length === 0) {
        logger.debug(`直播间 ${roomId} 无群组订阅, 跳过通知`);
        return;
      }

      const liveStatusMessages = await renderLiveEndTemplate({
        liveStartRoomInfo,
        liveEndRoomInfo,
        liveHash,
        liveDuration,
      });

      Object.entries(notifyGroups).forEach(async ([gid, group]) => {
        await bot.sendGroup(parseInt(gid), liveStatusMessages);

        await bot.sendGroup(parseInt(gid), [OneBotMessageUtils.Text("您订阅的直播间已经结束直播啦")]);

        logger.debug(`群聊通知完成✅ -> Group ${gid}`);
      });
    }
  );

  live.on("new-uploader", (videoUploader, hash, options) => {
    logger.debug(`收到新的投稿器, 热装载 VideoUploader 通知监听器`);
    installVideoUploaderNotifier(bot, videoUploader, hash, options);
  });
}

/** 单个投稿器的通知监听（开始投稿/完成/失败/审核结果） */
function installVideoUploaderNotifier(bot: XzQBot, videoUploader: VideoUploader, hash: string, { roomInfo, recorder, additionalDesc }: UploadEventOptions): void {
  const roomId = roomInfo.room_id;

  const liveRoomConfig = qqBotConfigManager.get("liveRoom")[roomId.toString()];
  if (!liveRoomConfig) {
    logger.debug(`直播间 ${roomId} 配置不存在或未配置`);
    return;
  }
  if (!liveRoomConfig.notify) {
    logger.debug(`直播间 ${roomId} 通知已禁用！`);
    return;
  }

  const notifyGroups = liveRoomConfig.group || {};

  if (Object.keys(notifyGroups).length === 0) {
    logger.debug(`直播间 ${roomId} 无群组订阅, 跳过通知`);
  } else {
    Object.entries(notifyGroups).forEach(async ([gid]) => {
      await bot.sendGroup(parseInt(gid), [
        OneBotMessageUtils.Text(
          `录播开始投稿\n` + `hash: ${hash.substring(0, 7)}\n` + (additionalDesc ? `${additionalDesc}\n\n` : `\n`) + `录制时长: ${FormatUtils.formatDurationWithoutSeconds(recorder.duration)}`
        ),
      ]);

      logger.debug(`群聊通知完成✅ -> Group ${gid}`);
    });
  }

  videoUploader.on("done", (uploadVideoInfo) => {
    const liveRoomConfig = qqBotConfigManager.get("liveRoom")[roomId.toString()];

    if (!liveRoomConfig) {
      logger.debug(`直播间 ${roomId} 配置不存在或未配置`);
      return;
    }
    if (!liveRoomConfig.notify) {
      logger.debug(`直播间 ${roomId} 通知已禁用！`);
      return;
    }

    const notifyGroups = liveRoomConfig.group || {};

    if (Object.keys(notifyGroups).length === 0) {
      logger.debug(`直播间 ${roomId} 无群组订阅, 跳过通知`);
      return;
    }

    Object.entries(notifyGroups).forEach(async ([gid]) => {
      await bot.sendGroup(parseInt(gid), [
        OneBotMessageUtils.Text(
          `录播投稿完成，等待转码审核⏳\n` +
            `hash: ${hash.substring(0, 7)}\n\n` +
            `录制时长: ${FormatUtils.formatDurationWithoutSeconds(recorder.duration)}\n\n` +
            `投稿耗时: ${FormatUtils.formatDurationWithoutSeconds(uploadVideoInfo.duration)}`
        ),
      ]);

      logger.debug(`群聊通知完成✅ -> Group ${gid}`);
    });

    const { tracker, bvid } = uploadVideoInfo;

    const trackerTimeOut = setTimeout(() => {
      logger.debug(`录播转码审核超时，已销毁追踪 -> ${bvid}, 通知群组...`);
      tracker.destroy();

      Object.entries(notifyGroups).forEach(async ([gid]) => {
        await bot.sendGroup(parseInt(gid), [OneBotMessageUtils.Text(`录播审核超时，已停止追踪⚠️\n` + `hash: ${hash.substring(0, 7)}`)]);

        logger.debug(`群聊通知完成✅ -> Group ${gid}`);
      });
    }, UPLOAD_AUDIT_TIMEOUT);

    tracker.on("open", async () => {
      logger.debug("视频审核通过, 开始通知群组");

      Object.entries(notifyGroups).forEach(async ([gid]) => {
        await bot.sendGroup(parseInt(gid), [OneBotMessageUtils.Text(`录播审核已通过✅\n` + `hash: ${hash.substring(0, 7)}\n\n` + `视频地址: \nhttps://www.bilibili.com/video/${bvid}`)]);

        logger.debug(`群聊通知完成✅ -> Group ${gid}`);
      });

      clearTimeout(trackerTimeOut);
    });

    tracker.on("fail", async (auditState, ageisState, problemDetail) => {
      let message = `录播转码审核未通过❌\n` + `hash: ${hash.substring(0, 7)}\n\n` + `状态：`;

      if (auditState === AuditState.TRANSCODE_FAIL) {
        logger.debug("视频转码失败， 销毁Tracker");
        tracker.destroy();
        clearTimeout(trackerTimeOut);

        // 视频稿件问题
        message += "转码失败❌";
        const xcodeDetails = await tracker.getXcodeState();

        xcodeDetails.forEach((detail, index) => {
          message += `\n\n视频 ${index + 1} 问题: ${detail.fail_tip || "无"}`;
        });
      } else {
        // 审核问题
        if (ageisState === AuditAegisState.REJECT) {
          // 这里使用 aegis_state 是因为哔哩哔哩web官方使用的就是aegis_state
          message += "已退回⛔";
        } else if (ageisState === AuditAegisState.LIMITED) {
          message += "流量受影响📉";
        } else if (ageisState === AuditAegisState.LOCKED) {
          message += "已锁定🔒";
        } else {
          message += "未知状态❓";
        }

        if (!problemDetail || problemDetail.length === 0) {
          message += "\n\n问题详情：未知";
        } else {
          problemDetail.forEach((detail, index) => {
            message += `\n\n稿件问题 ${index + 1}:\n${detail.reject_reason}\n\n`;
            message += `违规时间点: ${detail.violation_time || "无"}\n\n`;
            message += `违规位置: ${detail.violation_position || "无"}\n\n`;
            message += `修改建议:\n${detail.modify_advise}`;
          });
        }
      }

      message += "\n\nBN SYSTEM";

      Object.entries(notifyGroups).forEach(async ([gid]) => {
        await bot.sendGroup(parseInt(gid), [OneBotMessageUtils.Text(message)]);

        logger.debug(`群聊通知完成✅ -> Group ${gid}`);
      });
    });
  });

  videoUploader.on("fail", (error) => {
    const liveRoomConfig = qqBotConfigManager.get("liveRoom")[roomId.toString()];

    if (!liveRoomConfig) {
      logger.debug(`直播间 ${roomId} 配置不存在或未配置`);
      return;
    }
    if (!liveRoomConfig.notify) {
      logger.debug(`直播间 ${roomId} 通知已禁用！`);
      return;
    }

    const notifyGroups = liveRoomConfig.group || {};

    if (Object.keys(notifyGroups).length === 0) {
      logger.debug(`直播间 ${roomId} 无群组订阅, 跳过通知`);
      return;
    }

    Object.entries(notifyGroups).forEach(async ([gid]) => {
      let errMessage = error.message;

      if (error instanceof AxiosError) {
        errMessage = `请求失败❌\n` + `错误原因: ${error.message}\n` + `响应错误: ${error.response?.data.message || "无"}\n` + `响应数据: ${error.response?.data}`;
      }

      await bot.sendGroup(parseInt(gid), [
        OneBotMessageUtils.Text(`录播投稿失败❌\n` + `hash: ${hash.substring(0, 7)}\n\n` + `错误原因: ${errMessage}\n\n` + `使用下面命令重新投稿: \n` + `重新投稿 ${hash}`),
      ]);

      logger.debug(`群聊通知完成✅ -> Group ${gid}`);
    });
  });
}
