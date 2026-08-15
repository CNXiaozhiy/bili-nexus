import {
  BiliAccountService,
  FormatUtils,
  getLogger,
  LiveRoomStatus,
  notifyEmitter,
  screenshotSync,
} from "@bili-nexus/core";
import type { VideoUploader } from "@bili-nexus/core";
import { qqBotConfigManager } from "../../config";
import { auth } from "../auth";
import { AuthError } from "../context";
import type { CommandContext, CommandProcessors, ProcessorContext } from "../context";
import { OneBotMessageUtils } from "../../types/one-bot";
import type { SegmentMessages, GroupMessageEvent, MessageEvent } from "../../types/one-bot";
import { SubscriptionQuery } from "../subscription/store";
import { renderLiveStatusTemplate } from "../templates";

const logger = getLogger("QQBotCommands:Live");

/** 直播录制/投稿/状态类命令（全局 + 群聊处理器） */
export function registerLiveCommands(processors: CommandProcessors, ctx: CommandContext): void {
  const { global, group } = processors;

  // ---------- 全局命令 ----------

  global.register(".bn.drop.room", async (args, context: ProcessorContext<MessageEvent>) => {
    if (!auth(context.event.user_id, 10)) throw new AuthError("权限不足");

    let normal = false;

    if (args[0] === "normal") {
      normal = true;
      args = args.slice(1);
      logger.debug("销毁所有录制任务 -> 正常模式");
    }

    logger.info("销毁房间所有录制任务 ->", args);

    if (args.length < 1 || !args.every((e) => parseInt(e) > 0)) {
      return "参数错误";
    }

    const rooms = args;
    const targetRooms = new Set(rooms);

    for (const _roomId of targetRooms) {
      const roomId = parseInt(_roomId);
      const recorders = ctx.liveAutomationManager.getRecordersMapByRoomId(roomId);

      if (recorders.size > 0) {
        for (const [hash, _] of recorders) {
          if (normal) {
            context.reply(`开始提前完成录制任务[${hash}]`);
            ctx.liveAutomationManager
              .forceStopRecording(hash, true)
              .then(() => context.reply(`录制任务已结束[${hash}]`))
              .catch((e) => {
                context.reply(`销毁录制任务[${hash}]失败\n\n${e}`);
                notifyEmitter.emit("msg-warn", FormatUtils.formatErrorMessage("DropRecording", e));
              });
          } else {
            ctx.liveAutomationManager.forceClearRecording(hash, true);
            context.reply(`已销毁录制任务[${hash}]`);
          }
        }
      } else {
        context.reply("直播间无录制任务");
      }
    }

    return null;
  });

  global.register(".bn.drop.recording", async (args, context: ProcessorContext<MessageEvent>) => {
    if (!auth(context.event.user_id, 10)) throw new AuthError("权限不足");

    let normal = false;

    if (args[0] === "normal") {
      normal = true;
      args = args.slice(1);
      logger.debug("销毁录制任务 -> 正常模式");
    }

    logger.info("销毁录制任务 ->", args);

    if (args.length < 1 || !args.every((e) => e.length >= 7)) {
      return "参数错误，hash 至少七位";
    }

    const targetHashes = new Set(args);
    const liveRecorders = ctx.liveAutomationManager.getLiveRecorders();

    const matchedHashes = Array.from(liveRecorders)
      .filter(([hash]) => Array.from(targetHashes).some((targetHash) => hash.startsWith(targetHash)))
      .map(([hash, _]) => hash);

    if (matchedHashes.length > 0) {
      matchedHashes.forEach((hash) => {
        const targetHash = Array.from(targetHashes).find((th) => hash.startsWith(th));

        logger.info(`已找到指定录制任务，即将销毁 ${hash}, by targetHash -> ${targetHash}`);

        if (normal) {
          context.reply(`开始提前完成录制任务[${targetHash}]`);
          ctx.liveAutomationManager
            .forceStopRecording(hash, true)
            .then(() => context.reply(`录制任务已结束[${targetHash}]`))
            .catch((e) => {
              context.reply(`销毁录制任务[${targetHash}]失败\n\n${e}`);
              notifyEmitter.emit("msg-warn", FormatUtils.formatErrorMessage("DropRecording", e));
            });
        } else {
          ctx.liveAutomationManager.forceClearRecording(hash, true);
          context.reply(`已销毁录制任务[${targetHash}]`);
        }
      });

      logger.info(`共销毁 ${matchedHashes.length} 个录制任务`);
    } else {
      logger.warn("未找到匹配的录制器", {
        targetHashes: Array.from(targetHashes),
      });
      context.reply("未找到匹配的录制器");
    }

    return null;
  });

  // ---------- 群聊命令 ----------

  group.register("直播间", async (args, context: ProcessorContext<GroupMessageEvent>) => {
    const query = new SubscriptionQuery(qqBotConfigManager.get("liveRoom"));
    const rooms = query.getUserGroupSubscriptions(context.event.user_id, context.event.group_id);

    if (rooms.length == 0) {
      return "您在本群暂无订阅";
    }

    const messages: SegmentMessages = [];
    const biliApi = BiliAccountService.getDefault().getBiliApi();

    for (const _roomId of rooms) {
      const roomInfo = await biliApi.getLiveRoomInfo(_roomId);

      try {
        const liveStatusMessages = await renderLiveStatusTemplate(roomInfo, "-");

        logger.debug("渲染完成 ✅ -> ", _roomId);

        liveStatusMessages.forEach((e) => messages.push(e));
      } catch (e) {
        logger.warn("渲染失败 ❌ -> ", _roomId);
      }
    }

    return messages.intersperse(OneBotMessageUtils.Text("\n\n"));
  });

  group.register("投稿进度", async (args, context: ProcessorContext<GroupMessageEvent>) => {
    const query = new SubscriptionQuery(qqBotConfigManager.get("liveRoom"));
    const rooms = query.getUserGroupSubscriptions(context.event.user_id, context.event.group_id);

    if (rooms.length == 0) {
      return "您在本群暂无订阅";
    }

    const result: SegmentMessages = [];

    let index = 0;
    for (let _roomId of rooms) {
      index++;
      const roomId = parseInt(_roomId);
      let uploaders = ctx.liveAutomationManager.getUploadersMapByRoomId(roomId);

      if (typeof args[0] === "string") {
        const uploader = ctx.liveAutomationManager.getUploader(args[0]);

        if (uploader) {
          uploaders = new Map<string, VideoUploader>();
          uploaders.set(args[0], uploader);
        } else {
          return "未找到指定的投稿器";
        }
      }

      result.push(OneBotMessageUtils.Text(`直播间${_roomId} 投稿器列表:`));
      if (uploaders.size === 0) {
        result.push(OneBotMessageUtils.Text("投稿器"));
        continue;
      }

      uploaders.forEach((uploader, hash) => {
        const tasks = uploader.getTasks();

        result.push(OneBotMessageUtils.Text(`投稿器 ${hash.substring(0, 7)}:`));

        tasks.forEach((videoTask, index) => {
          const videoName = index === 0 ? "主投稿" : `视频 ${index}`;

          result.push(
            OneBotMessageUtils.Text(
              `${videoName}\n` +
                `- 投稿进度:\n` +
                videoTask
                  .map((task, index) => {
                    return (
                      `- ${task.name}\n` +
                      `  - 状态: ${task.status === "success" ? "成功 ✅" : task.status === "error" ? "失败 ❌" : "操作 ⌛️"}\n` +
                      (task.message ? `  - 信息: ${task.message}\n` : "") +
                      (task.process ? `  - 进度: ${task.process}\n` : "") +
                      `  - 耗时: ${Math.floor(task.duration / 1000) + " 秒"}`
                    );
                  })
                  .join("\n")
            )
          );
        });
      });
    }

    if (result.length === 1) return [OneBotMessageUtils.Text("无投稿器")];
    return result.intersperse(OneBotMessageUtils.Text("\n\n"));
  });

  group.register("录制状态", async (_args, context: ProcessorContext<GroupMessageEvent>) => {
    const query = new SubscriptionQuery(qqBotConfigManager.get("liveRoom"));
    const rooms = query.getUserGroupSubscriptions(context.event.user_id, context.event.group_id);

    if (rooms.length == 0) {
      return "您在本群暂无订阅";
    }

    const result: SegmentMessages = [];

    for (let _roomId of rooms) {
      const roomId = parseInt(_roomId);
      const recorders = ctx.liveAutomationManager.getRecordersMapByRoomId(roomId);

      result.push(OneBotMessageUtils.Text(`直播间${_roomId} 录制器列表:`));
      if (recorders.size === 0) {
        result.push(OneBotMessageUtils.Text("无录制器"));
        continue;
      }

      recorders.forEach((recorder, hash) => {
        const stats = recorder.getStats();
        result.push(
          OneBotMessageUtils.Text(
            `录制器 ${hash.substring(0, 7)}\n` +
              `- 录制状态: ${recorder.isRunning() ? "运行中 🟢" : "未运行 🔴"}\n` +
              `- 录制分段: ${recorder.getSegmentFilesCount()}\n` +
              `- 录制时长: ${stats.ffmpegStats?.time || "未知"}\n` +
              `- 录制帧率: ${stats.ffmpegStats?.fps || "未知"}\n` +
              `- 文件大小: ${stats.ffmpegStats?.size || "未知"}`
          )
        );
      });
    }

    if (result.length === 1) return [OneBotMessageUtils.Text("无录制器")];
    return result.intersperse(OneBotMessageUtils.Text("\n\n"));
  });

  group.register("直播间图片", async (_args, context: ProcessorContext<GroupMessageEvent>) => {
    const query = new SubscriptionQuery(qqBotConfigManager.get("liveRoom"));
    const rooms = query.getUserGroupSubscriptions(context.event.user_id, context.event.group_id);

    if (rooms.length == 0) {
      return "您在本群暂无订阅";
    }

    const biliApi = BiliAccountService.getDefault().getBiliApi();

    const result: SegmentMessages = [];

    let index = 0;
    for (let roomId of rooms) {
      index++;

      const roomInfo = await biliApi.getLiveRoomInfo(roomId);

      if (roomInfo.live_status !== LiveRoomStatus.LIVE) {
        result.push(OneBotMessageUtils.Text(`${roomInfo.title}\n` + `- 直播间ID: ${roomId}\n` + `- 未在直播 🔴` + `${index !== rooms.length ? "\n\n" : ""}`));

        continue;
      }

      if (rooms.length !== 1) {
        result.push(OneBotMessageUtils.Text(`${roomInfo.title}\n直播间ID: ${roomId}\n`));
      }

      const base64 = await screenshotSync(roomId, biliApi);
      result.push(OneBotMessageUtils.Base64Image(base64));

      if (index !== rooms.length) {
        result.push(OneBotMessageUtils.Text("\n\n"));
      }

      logger.debug(`直播间 ${roomId}(${roomInfo.title}) 截图完成`);
    }

    return result;
  });

  group.register("手动重投", async (args, context: ProcessorContext<GroupMessageEvent>) => {
    if (!auth(context.event.user_id, 10)) throw new AuthError("权限不足");

    if (args.length !== 1 || parseInt(args[0]) < 0) {
      return "手动重投 [Encoded Option]";
    }

    try {
      const decoded = Buffer.from(args[0], "base64").toString("utf8");
      const options = JSON.parse(decoded);

      // 存在校验
      if (
        options.hash === undefined ||
        options.file === undefined ||
        options.liveStartTime === undefined ||
        options.liveStopTime === undefined ||
        options.liveDuration === undefined ||
        options.recordStartTime === undefined ||
        options.recordStopTime === undefined ||
        options.recordDuration === undefined
      ) {
        throw new Error("数据校验失败: 必要数据缺失");
      }

      // 类型校验
      if (
        typeof options.hash !== "string" ||
        typeof options.file !== "string" ||
        typeof options.liveStartTime !== "number" ||
        typeof options.liveStopTime !== "number" ||
        typeof options.liveDuration !== "number" ||
        typeof options.recordStartTime !== "number" ||
        typeof options.recordStopTime !== "number" ||
        typeof options.recordDuration !== "number"
      ) {
        throw new Error("数据校验失败: 数据类型错误");
      }

      if (!options.liveRoomInfo) {
        if (!options.roomId || typeof options.roomId !== "number") {
          throw new Error("liveRoomInfo 补全失败: roomId 缺失");
        }

        options.liveRoomInfo = await BiliAccountService.getDefault().getBiliApi().getLiveRoomInfo(options.roomId);

        logger.debug("liveRoomInfo 补全成功");
      }

      if (typeof options.liveRoomInfo !== "object") {
        throw new Error("数据校验失败: liveRoomInfo 类型错误");
      }

      if (
        options.liveRoomInfo.title === undefined ||
        options.liveRoomInfo.uid === undefined ||
        options.liveRoomInfo.room_id === undefined ||
        options.liveRoomInfo.description === undefined ||
        options.liveRoomInfo.user_cover === undefined
      ) {
        throw new Error("liveRoomInfo 初检失败: 必要数据缺失");
      }

      if (options.customOptions) {
        if (typeof options.customOptions !== "object") {
          throw new Error("数据校验失败: customOptions 类型错误");
        }

        if (options.customOptions.account && typeof options.customOptions.account !== "number") {
          throw new Error("数据校验失败: customOptions.account 类型错误");
        }

        if (options.customOptions.cover && typeof options.customOptions.cover !== "string") {
          throw new Error("数据校验失败: customOptions.cover 类型错误");
        }

        if (options.customOptions.title && typeof options.customOptions.title !== "string") {
          throw new Error("数据校验失败: customOptions.title 类型错误");
        }

        if (options.customOptions.desc && typeof options.customOptions.desc !== "string") {
          throw new Error("数据校验失败: customOptions.desc 类型错误");
        }

        if (options.customOptions.tid && typeof options.customOptions.tid !== "number") {
          throw new Error("数据校验失败: customOptions.tid 类型错误");
        }

        if (options.customOptions.tag && typeof options.customOptions.tag !== "string") {
          throw new Error("数据校验失败: customOptions.tag 类型错误");
        }
      }

      options.additionalDesc = "注意: 本次录像为手动重投";

      ctx.liveAutomationManager.manualAddFailedSubmission(options);
      ctx.liveAutomationManager.retryUpload(options.hash);
      return "手动重投已开始✅";
    } catch (e) {
      logger.error("手动重投失败❌", e);
      return "手动重投失败❌\n\n" + e;
    }
  });

  group.register("重新投稿", async (args, context: ProcessorContext<GroupMessageEvent>) => {
    if (!auth(context.event.user_id, 10)) throw new AuthError("权限不足");

    if (args.length !== 1 || parseInt(args[0]) < 0) {
      return "重新投稿 [hash]";
    }

    logger.debug("开始重新投稿");

    ctx.liveAutomationManager
      .retryUpload(args[0])
      .then((resp) => {
        if (resp === null) {
          context.reply("未找到失败的投稿任务", {
            reference: true,
          });

          return;
        }
        logger.info("重新投稿成功✅", resp);
      })
      .catch((e) => {
        logger.error("重新投稿失败❌", e);
      });

    return null;
  });
}
