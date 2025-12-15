import XzQbot, { ReplyFunction } from "@/core/bot/xz-qbot";
import {
  GroupMessageEvent,
  MessageEvent,
  Messages,
  OneBotMessageUtils,
  PrivateMessageEvent,
  SegmentMessage,
  SegmentMessages,
} from "@/types/one-bot";
import { LiveRoomInfo, LiveRoomStatus } from "@/types/bili";
import { QQBotError, QQBotServiceSetupError } from "@/types/errors/qq-bot";
import getLogger from "@/utils/logger";
import LiveAutomationManager, {
  UploadEventOptions,
} from "../live/live-automation-manager";
import DynamicAutomationManager from "../dynamic/dynamic-automation-manager";
import {
  liveConfigManager,
  qqBotConfigManager,
  userDynamicConfigManager,
} from "@/common";
import LiveMonitor from "../live/live-monitor";
import LiveRecorder from "../live/live-recorder";
import SpaceDynamicMonitor from "../dynamic/space-dynamic-monitor";
import HtmlTemplatesRender from "./html-template-render";
import CommandProcessor from "@/utils/command-processor";
import FormatUtils from "@/utils/format";
import BiliApiService from "../bili-api";
import notifyEmitter from "../system/notify-emitter";
import VideoUploader from "../video/video-uploader";
import { DataStore } from "@/common/config";
import { screenshotSync } from "@/utils/ffmpeg";
import { loginAccount } from "../acc/login";
import BiliUtils from "@/utils/bili";

const logger = getLogger("QQBotService");

class AuthError extends Error {}

type ProcessorContext<T, F = ReplyFunction<any>> = {
  event: T;
  reply: F;
  bot: XzQbot;
};

export default class QQBotService {
  private htmlTemplatesRender = new HtmlTemplatesRender("./templates");
  private bot: XzQbot | null = null;
  private commandProcessor = new CommandProcessor<
    ProcessorContext<MessageEvent>,
    Messages | null
  >();
  private groupCommandProcessor = new CommandProcessor<
    ProcessorContext<GroupMessageEvent>,
    Messages | null
  >();
  private privateCommandProcessor = new CommandProcessor<
    ProcessorContext<PrivateMessageEvent>,
    Messages | null
  >();

  constructor(
    private readonly liveAutomationManager: LiveAutomationManager,
    private readonly spaceDynamicMonitors: DynamicAutomationManager
  ) {}

  public async init() {
    const websocketClient = qqBotConfigManager.get("websocketClient");
    if (!websocketClient || !websocketClient.url) {
      throw new QQBotServiceSetupError(
        "未配置 websocketClient.url, 请在 config/qq-bot.json 中配置后重启服务"
      );
    }

    this.bot = new XzQbot(websocketClient.url);

    await this.bot.connect();

    this.installEventListeners();

    this.registerCommands();

    this.bot.on("private_message", async (e, reply) => {
      if (e.post_type === "message_sent") return;

      const r = await this.privateCommandProcessor.execute(e.raw_message, {
        event: e,
        reply,
        bot: this.bot!,
      });

      if (r.error && !r.error.startsWith("Unknown command")) {
        reply(r.error);
      } else if (r.success && r.result) {
        reply(r.result);
      } else {
        // 全局 commandProcessor
        const r = await this.commandProcessor.execute(e.raw_message, {
          event: e,
          reply,
          bot: this.bot!,
        });
        if (r.error && !r.error.startsWith("Unknown command")) {
          reply(r.error);
        } else if (r.success && r.result) {
          reply(r.result);
        }
      }
    });

    this.bot.on("group_message", async (e, reply) => {
      if (e.post_type === "message_sent") return;

      const r = await this.groupCommandProcessor.execute(e.raw_message, {
        event: e,
        reply,
        bot: this.bot!,
      });

      if (r.error && !r.error.startsWith("Unknown command")) {
        reply(r.error);
      } else if (r.success && r.result) {
        reply(r.result);
      } else {
        // 全局 commandProcessor
        const r = await this.commandProcessor.execute(e.raw_message, {
          event: e,
          reply,
          bot: this.bot!,
        });
        if (r.error && !r.error.startsWith("Unknown command")) {
          reply(r.error);
        } else if (r.success && r.result) {
          reply(r.result);
        }
      }
    });

    notifyEmitter.on("msg-warn", (message) => {
      logger.info(`收到 notifyEmitter 警告通知，将通知 superAdmin`);
      const superAdmin = qqBotConfigManager.get("superAdmin");
      if (!superAdmin) {
        logger.error("未配置 superAdmin, 通知失败, 请尽快处理!");
        return;
      }
      const msg = `BiliLiveHub System 警告通知⚠️\n\n时间: ${new Date().toISOString()}\n\n${message}`;
      this.bot?.sendPrivate(superAdmin, [OneBotMessageUtils.Text(msg)]);
    });

    notifyEmitter.on("msg-error", (message) => {
      logger.info(`收到 notifyEmitter 致命错误⚠️，将通知 superAdmin`);
      const superAdmin = qqBotConfigManager.get("superAdmin");
      if (!superAdmin) {
        logger.error("未配置 superAdmin, 通知失败, 请尽快处理!");
        return;
      }
      const msg = `BiliLiveHub System 致命错误🆘\n\n时间: ${new Date().toISOString()}\n\n${message}`;
      this.bot?.sendPrivate(superAdmin, [OneBotMessageUtils.Text(msg)]);
    });
  }

  private registerCommands() {
    this.commandProcessor.setDefaultHandler(async () => {
      return null;
    });

    const subscribeLiveRoom = (
      qid: number,
      gid: number,
      roomId: number
    ): string => {
      const liveRoomsConfig = qqBotConfigManager.get("liveRoom");

      const roomConfig = liveRoomsConfig[roomId.toString()];
      if (!roomConfig) {
        throw "未被授权, 请联系管理员授权";
      }

      if (!roomConfig.group[gid]) {
        logger.warn(`不存在当前群聊 ${gid} 配置, 将使用默认配置`);
        roomConfig.group[gid] = {
          offical: false,
          users: [],
        };
      } else if (!Array.isArray(roomConfig.group[gid].users)) {
        logger.warn(
          `当前群聊 ${gid} 配置中订阅用户组不为数组, 将初始化为空用户组`
        );
        roomConfig.group[gid].users = [];
      }

      if (roomConfig.group[gid].users.find((u) => u === qid) === undefined) {
        roomConfig.group[gid].users.push(qid);
        qqBotConfigManager.set("liveRoom", liveRoomsConfig);

        const _liveRoomConfig =
          liveConfigManager.get("rooms")[roomId.toString()];

        if (!_liveRoomConfig)
          return (
            "订阅成功 🎉\n\n" + "警告⚠️: 主直播间配置未初始化, 请联系管理员处理"
          );
        return "订阅成功 🎉";
      } else {
        throw "你已经订阅过该直播间";
      }
    };

    const subscribeUserDynamic = (
      qid: number,
      gid: number,
      userId: number
    ): string => {
      const usersDynamicConfig = qqBotConfigManager.get("userDynamic");
      const userConfig = usersDynamicConfig[userId.toString()];

      if (!userConfig) {
        throw "主播未被授权, 请联系管理员授权";
      }

      if (!userConfig.group[gid]) {
        logger.warn(`不存在当前群聊 ${gid} 配置, 将使用默认配置`);
        userConfig.group[gid] = {
          offical: false,
          users: [],
        };
      } else if (!Array.isArray(userConfig.group[gid].users)) {
        logger.warn(
          `当前群聊 ${gid} 配置中订阅用户组不为数组, 将初始化为空用户组`
        );
        userConfig.group[gid].users = [];
      }

      if (userConfig.group[gid].users.find((u) => u === qid) === undefined) {
        userConfig.group[gid].users.push(qid);
        qqBotConfigManager.set("userDynamic", usersDynamicConfig);
        return "订阅成功 🎉";
      } else {
        return "你已经订阅过该主播";
      }
    };

    const subscribeUser = async (qid: number, gid: number, mid: number) => {
      let _messages: [string, string] = ["", ""];

      const userInfo = await BiliApiService.getDefaultInstance().getUserInfo(
        mid
      );

      const roomId = userInfo.live_room.roomid;

      // roomId 可能为 0
      if (userInfo.live_room.roomStatus === 0 || roomId <= 0) {
        _messages[0] = "该主播无直播间\n";
      } else {
        try {
          const msg = subscribeLiveRoom(qid, gid, roomId);
          _messages[0] = `${msg}`;
        } catch (e) {
          const err = e as string;
          _messages[0] = `${err}`;
        }
      }

      try {
        const msg = subscribeUserDynamic(qid, gid, userInfo.mid);
        _messages[1] = `${msg}`;
      } catch (e) {
        const err = e as string;
        _messages[1] = `${err}`;
      }

      return [
        OneBotMessageUtils.UrlImage(userInfo.face),
        OneBotMessageUtils.Text(
          `UP主 ${userInfo.name}\n` +
            `- 等级: Lv${userInfo.level}\n` +
            `- 会员: ${BiliUtils.transformVipType(userInfo.vip.type)}\n` +
            `- 用户ID: ${userInfo.mid}\n` +
            `- 直播间: ${
              userInfo.live_room.roomStatus === 0
                ? "无"
                : userInfo.live_room.roomid
            }\n` +
            `- 订阅状态:\n` +
            `  - 直播间: ${_messages[0]}\n` +
            `  - 主播动态: ${_messages[1]}`
        ),
      ];
    };

    const canOneClickSubscribe = (gid: number) => {
      const liveRoomsConfig = qqBotConfigManager.get("liveRoom");
      const usersDynamicConfig = qqBotConfigManager.get("userDynamic");

      const liveRoomsQuery = new SubscriptionQuery(liveRoomsConfig);
      const usersDynamicQuery = new SubscriptionQuery(usersDynamicConfig);

      const room = liveRoomsQuery.getOfficialResource(gid);
      const user = usersDynamicQuery.getOfficialResource(gid);

      return {
        can: room || user,
        room,
        user,
      };
    };

    const initLiveRoom = (roomId: number) => {
      const liveRoomsConfig = qqBotConfigManager.get("liveRoom");
      const _liveRoomsConfig = liveConfigManager.get("rooms");
      const roomConfig = liveRoomsConfig[roomId];

      if (roomConfig) {
        if (!_liveRoomsConfig) {
          throw "主配置存在问题 ⚠️";
        }
        return "已授权过";
      }

      _liveRoomsConfig[roomId] = {
        enable: true,
        autoRecord: true,
        autoUpload: true,
      };

      liveRoomsConfig[roomId] = {
        notify: true,
        group: {},
      };

      qqBotConfigManager.set("liveRoom", liveRoomsConfig);
      liveConfigManager.set("rooms", _liveRoomsConfig);

      const _roomConfig = _liveRoomsConfig[roomId];

      this.liveAutomationManager.addRoom(roomId, {
        autoRecord: _roomConfig.autoRecord,
        autoUpload: _roomConfig.autoUpload,
      });

      return "授权成功 ✅";
    };

    const initUserDynamic = (mid: number) => {
      const usersDynamicConfig = qqBotConfigManager.get("userDynamic");
      const _usersDynamicConfig = userDynamicConfigManager.get("users");

      // qq-bot.json
      const userDynamicConfig = usersDynamicConfig[mid];

      if (userDynamicConfig) {
        if (!_usersDynamicConfig[mid]) {
          throw "主配置存在问题 ⚠️";
        }
        return "已授权过";
      }

      _usersDynamicConfig[mid] = true;

      usersDynamicConfig[mid] = {
        notify: true,
        group: {},
      };

      qqBotConfigManager.set("userDynamic", usersDynamicConfig);
      userDynamicConfigManager.set("users", _usersDynamicConfig);

      this.spaceDynamicMonitors.addUser(mid);

      return "授权成功 ✅";
    };

    const initUser = async (mid: number) => {
      let _messages: [string, string] = ["", ""];

      const userInfo = await BiliApiService.getDefaultInstance().getUserInfo(
        mid
      );

      const roomId = userInfo.live_room.roomid;

      // roomId 可能为 0
      if (userInfo.live_room.roomStatus === 0 || roomId <= 0) {
        _messages[0] = "该主播无直播间\n";
      } else {
        try {
          const msg = initLiveRoom(roomId);
          _messages[0] = `直播间 ${msg}\n`;
        } catch (e) {
          const err = e as string;
          _messages[0] = `直播间 ${err}\n`;
        }
      }

      try {
        const msg = initUserDynamic(userInfo.mid);
        _messages[1] = `UP主动态 ${msg}`;
      } catch (e) {
        const err = e as string;
        _messages[1] = `UP主动态 ${err}`;
      }

      return [
        OneBotMessageUtils.UrlImage(userInfo.face),
        OneBotMessageUtils.Text(
          `UP主 ${userInfo.name}\n` +
            `- 等级: Lv${userInfo.level}\n` +
            `- 会员: ${BiliUtils.transformVipType(userInfo.vip.type)}\n` +
            `- 用户ID: ${userInfo.mid}\n` +
            `- 直播间: ${
              userInfo.live_room.roomStatus === 0
                ? "无"
                : userInfo.live_room.roomid
            }\n` +
            `- 授权状态:\n` +
            `  -${_messages[0]}\n` +
            `  -${_messages[1]}`
        ),
      ];
    };

    this.commandProcessor.register(".blh.help", async () => {
      const base64 = await this.htmlTemplatesRender.render("help", {
        message: "暂无",
      });
      return [OneBotMessageUtils.Base64Image(base64)];
    });

    this.commandProcessor.register(".blh.room", async (args, context) => {
      if (!Utils.auth(context.event.user_id, 1))
        throw new AuthError("权限不足");
      const liveRoomsConfig = qqBotConfigManager.get("liveRoom");
      const query = new SubscriptionQuery(liveRoomsConfig);
      const rooms = query.getSubscriptions();

      if (rooms.length == 0) {
        return "暂无订阅";
      }
      return rooms.join(", ");
    });

    this.commandProcessor.register(".blh.stop", async (args, context) => {
      if (!Utils.auth(context.event.user_id, 20))
        throw new AuthError("权限不足");

      logger.warn("程序即将结束");

      this.liveAutomationManager
        .forceStopRecordAll()
        .then(() => {
          context.reply("所有任务已结束，程序已停止");
          process.exit(0);
        })
        .catch(() => {
          context.reply("所有任务结束失败，程序已停止");
          process.exit(0);
        });

      return "正在结束所有录制任务";
    });

    this.groupCommandProcessor.register("一键订阅", async (args, context) => {
      const oneClickSubscribe = canOneClickSubscribe(context.event.group_id);
      if (!oneClickSubscribe.can) {
        return [OneBotMessageUtils.Text("本群不是官方群聊，无法使用一键订阅")];
      }

      if (oneClickSubscribe.user) {
        logger.debug("存在用户动态官方群，将直接采用 订阅UP 功能完成一键订阅");
        return await subscribeUser(
          context.event.user_id,
          context.event.group_id,
          oneClickSubscribe.user
        );
      } else if (oneClickSubscribe.room) {
        return subscribeLiveRoom(
          context.event.user_id,
          context.event.group_id,
          oneClickSubscribe.room
        );
      } else {
        return "None";
      }
    });

    this.groupCommandProcessor.register("订阅UP", async (args, context) => {
      const users = args;

      if (
        args.length === 0 &&
        canOneClickSubscribe(context.event.group_id).can
      ) {
        return [
          OneBotMessageUtils.Text(
            "本群为官方群聊，您可以\n使用 '一键订阅' 命令来完成订阅"
          ),
        ];
      }

      if (args.length < 1 || !users.every((e) => parseInt(e) > 0)) {
        return [OneBotMessageUtils.Text("订阅UP [UP主ID...]")];
      }

      const messages: SegmentMessages = [];

      for (let user of users) {
        messages.push(
          ...(await subscribeUser(
            context.event.user_id,
            context.event.group_id,
            parseInt(user)
          ))
        );
      }

      return messages.intersperse(OneBotMessageUtils.Text("\n\n"));
    });

    this.groupCommandProcessor.register("订阅直播间", async (args, context) => {
      const rooms = args;

      if (
        args.length === 0 &&
        !!canOneClickSubscribe(context.event.group_id).room
      ) {
        return [
          OneBotMessageUtils.Text(
            "本群为官方群聊，您可以\n使用 '一键订阅' 命令来完成订阅"
          ),
        ];
      }

      if (args.length < 1 || !rooms.every((e) => parseInt(e) > 0)) {
        return [OneBotMessageUtils.Text("订阅直播间 [直播间ID...]")];
      }

      const messages: string[] = [];

      for (let _roomId of rooms) {
        const roomId = parseInt(_roomId);

        try {
          const msg = subscribeLiveRoom(
            context.event.user_id,
            context.event.group_id,
            roomId
          );
          messages.push(rooms.length !== 1 ? `${roomId} ${msg}` : msg);
        } catch (e) {
          const err = e as string;
          messages.push(rooms.length !== 1 ? `${roomId} ${err}` : err);
        }
      }

      return messages.join("\n");
    });

    this.groupCommandProcessor.register(
      "订阅主播动态",
      async (args, context) => {
        const users = args;

        if (
          args.length === 0 &&
          !!canOneClickSubscribe(context.event.group_id).user
        ) {
          return [
            OneBotMessageUtils.Text(
              "本群为官方群聊，您可以\n使用 '一键订阅' 命令来完成订阅\n\n或者: 订阅主播动态 [用户ID...]"
            ),
          ];
        }

        if (args.length < 1 || !users.every((e) => parseInt(e) > 0)) {
          return [
            OneBotMessageUtils.Text(
              "订阅主播动态 [用户ID...]" +
                "查询UP主用户ID可以使用\n" +
                "'查询主播 [主播名]' 命令"
            ),
          ];
        }

        const messages: string[] = [];

        for (let _userId of users) {
          const mid = parseInt(_userId);

          try {
            const msg = subscribeUserDynamic(
              context.event.user_id,
              context.event.group_id,
              mid
            );
            messages.push(users.length !== 1 ? `${mid} ${msg}` : msg);
          } catch (e) {
            const err = e as string;
            messages.push(users.length !== 1 ? `${mid} ${err}` : err);
          }
        }

        return messages.join("\n");
      }
    );

    this.groupCommandProcessor.register("直播间", async (args, context) => {
      const query = new SubscriptionQuery(qqBotConfigManager.get("liveRoom"));
      const rooms = query.getUserGroupSubscriptions(
        context.event.user_id,
        context.event.group_id
      );

      if (rooms.length == 0) {
        return "您在本群暂无订阅";
      }

      const messages: SegmentMessages = [];
      const biliApi = BiliApiService.getDefaultInstance();

      for (const _roomId of rooms) {
        const roomInfo = await biliApi.getLiveRoomInfo(_roomId);
        const userCard = await biliApi.getUserCard(roomInfo.uid);

        if (rooms.length === 1) {
          const base64 = await Utils.renderLiveStatusTemplate(
            this.htmlTemplatesRender,
            roomInfo,
            ""
          );

          logger.debug("渲染完成 ✅");
          messages.push(OneBotMessageUtils.Base64Image(base64));
          break;
        }

        messages.push(
          OneBotMessageUtils.UrlImage(roomInfo.keyframe || roomInfo.user_cover),
          OneBotMessageUtils.Text(
            `${roomInfo.title}\n` +
              `- 直播间ID: ${_roomId}\n` +
              `- 直播UP主: ${userCard.card.name}\n` +
              `- UP主UID: ${userCard.card.mid}\n` +
              `- 直播状态: ${BiliUtils.transformLiveStatus(
                roomInfo.live_status
              )}\n` +
              (roomInfo.live_status === LiveRoomStatus.LIVE
                ? `- 开播时间: ${roomInfo.live_time}\n`
                : "") +
              `- 直播间分区: ${roomInfo.area_name}\n` +
              `- 直播间简介: \n` +
              `${roomInfo.description || "无"}\n` +
              `- 直播间人气: ${roomInfo.online}`
          )
        );
      }

      return messages.intersperse(OneBotMessageUtils.Text("\n\n"));
    });

    this.groupCommandProcessor.register("投稿进度", async (args, context) => {
      const query = new SubscriptionQuery(qqBotConfigManager.get("liveRoom"));
      const rooms = query.getUserGroupSubscriptions(
        context.event.user_id,
        context.event.group_id
      );

      if (rooms.length == 0) {
        return "您在本群暂无订阅";
      }

      const result: SegmentMessages = [];

      let index = 0;
      for (let _roomId of rooms) {
        index++;
        const roomId = parseInt(_roomId);
        const uploaders =
          this.liveAutomationManager.getUploadersMapByRoomId(roomId);

        result.push(OneBotMessageUtils.Text(`直播间${_roomId} 投稿器列表:`));
        if (uploaders.size === 0) {
          result.push(OneBotMessageUtils.Text("投稿器"));
          continue;
        }

        uploaders.forEach((uploader, hash) => {
          const tasks = uploader.getTasks();

          result.push(
            OneBotMessageUtils.Text(`投稿器 ${hash.substring(0, 7)}:`)
          );

          tasks.forEach((videoTask, index) => {
            const videoName = index === 0 ? "主投稿" : `视频 ${index}`;

            videoTask.forEach((task, index) => {});

            result.push(
              OneBotMessageUtils.Text(
                `${videoName}\n` +
                  `- 投稿进度:\n` +
                  videoTask
                    .map((task, index) => {
                      return (
                        `- ${task.name}\n` +
                        `  - 状态: ${
                          task.status === "success"
                            ? "成功 ✅"
                            : task.status === "error"
                            ? "失败 ❌"
                            : "操作 ⌛️"
                        }\n` +
                        `  - 信息: ${task.message || "无"}\n` +
                        `  - 进度: ${task.process || "无"}\n` +
                        `  - 耗时: ${task.duration || "未知"}`
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

    this.groupCommandProcessor.register("录制状态", async (args, context) => {
      const query = new SubscriptionQuery(qqBotConfigManager.get("liveRoom"));
      const rooms = query.getUserGroupSubscriptions(
        context.event.user_id,
        context.event.group_id
      );

      if (rooms.length == 0) {
        return "您在本群暂无订阅";
      }

      const result: SegmentMessages = [];

      let index = 0;
      for (let _roomId of rooms) {
        index++;
        const roomId = parseInt(_roomId);
        const recorders =
          this.liveAutomationManager.getRecordersMapByRoomId(roomId);

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
                `- 录制状态: ${
                  recorder.isRunning() ? "运行中 🟢" : "未运行 🔴"
                }\n` +
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

    this.groupCommandProcessor.register("直播间图片", async (args, context) => {
      const query = new SubscriptionQuery(qqBotConfigManager.get("liveRoom"));
      const rooms = query.getUserGroupSubscriptions(
        context.event.user_id,
        context.event.group_id
      );

      if (rooms.length == 0) {
        return "您在本群暂无订阅";
      }

      const biliApi = BiliApiService.getDefaultInstance();

      const result: SegmentMessages = [];

      let index = 0;
      for (let roomId of rooms) {
        index++;

        const roomInfo = await biliApi.getLiveRoomInfo(roomId);

        if (roomInfo.live_status !== LiveRoomStatus.LIVE) {
          result.push(
            OneBotMessageUtils.Text(
              `${roomInfo.title}\n` +
                `- 直播间ID: ${roomId}\n` +
                `- 未在直播 🔴` +
                `${index !== rooms.length ? "\n\n" : ""}`
            )
          );

          continue;
        }

        if (rooms.length !== 1) {
          result.push(
            OneBotMessageUtils.Text(`${roomInfo.title}\n直播间ID: ${roomId}\n`)
          );
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

    this.groupCommandProcessor.register("设置UP官群", async (args, context) => {
      if (!Utils.auth(context.event.user_id, 10))
        throw new AuthError("权限不足");

      if (args.length !== 1 || parseInt(args[0]) < 0) {
        return "设置UP官群 [UP主ID]";
      }

      logger.debug("开始设置UP官群");

      const gid = context.event.group_id;

      const liveRoomsConfig = qqBotConfigManager.get("liveRoom");
      const usersDynamicConfig = qqBotConfigManager.get("userDynamic");

      const messages: [string, string] = ["", ""];

      const mid = parseInt(args[0]);

      const userInfo = await BiliApiService.getDefaultInstance().getUserInfo(
        mid
      );

      if (
        userInfo.live_room.roomStatus === 0 ||
        userInfo.live_room.roomid <= 0
      ) {
        messages[0] = "该主播无直播间";
      } else {
        const roomId = userInfo.live_room.roomid;
        const roomConfig = liveRoomsConfig[roomId];

        if (roomConfig) {
          if (roomConfig.group[gid]) {
            if (roomConfig.group[gid].offical) {
              messages[0] = "本群已经是官群了";
            } else {
              roomConfig.group[gid].offical = true;
              qqBotConfigManager.set("liveRoom", liveRoomsConfig);
              messages[0] = "设置成功 ✅";
            }
          } else {
            roomConfig.group[gid] = {
              offical: true,
              users: [],
            };

            qqBotConfigManager.set("liveRoom", liveRoomsConfig);
            messages[0] = "设置成功 ✅";
          }
        } else {
          messages[0] = "请先授权直播间";
        }
      }

      const userDynamicConfig = usersDynamicConfig[mid];

      if (userDynamicConfig) {
        if (userDynamicConfig.group[gid]) {
          if (userDynamicConfig.group[gid].offical) {
            messages[1] = "本群已经是官群了";
          } else {
            userDynamicConfig.group[gid].offical = true;

            qqBotConfigManager.set("userDynamic", usersDynamicConfig);
            messages[1] = "设置成功 ✅";
          }
        } else {
          userDynamicConfig.group[gid] = {
            offical: true,
            users: [],
          };

          qqBotConfigManager.set("userDynamic", usersDynamicConfig);
          messages[1] = "设置成功 ✅";
        }
      } else {
        messages[1] = "请先授权主播动态";
      }

      return [
        OneBotMessageUtils.UrlImage(userInfo.face),
        OneBotMessageUtils.Text(
          `UP主 ${userInfo.name}\n` +
            `- 等级: Lv${userInfo.level}\n` +
            `- 会员: ${BiliUtils.transformVipType(userInfo.vip.type)}\n` +
            `- 用户ID: ${userInfo.mid}\n` +
            `- 直播间: ${
              userInfo.live_room.roomStatus === 0
                ? "无"
                : userInfo.live_room.roomid
            }\n` +
            `- 设置结果:\n` +
            `  - 直播间: ${messages[0]}\n` +
            `  - 主播动态: ${messages[1]}`
        ),
      ];
    });

    this.commandProcessor.register("授权直播间", async (args, context) => {
      if (!Utils.auth(context.event.user_id, 10))
        throw new AuthError("权限不足");

      const rooms = args;

      if (args.length < 1 || !rooms.every((e) => parseInt(e) > 0)) {
        return [OneBotMessageUtils.Text("授权直播间 [直播间ID...]")];
      }

      const messages: string[] = [];

      for (let _roomId of rooms) {
        const roomId = parseInt(_roomId);

        try {
          const msg = initLiveRoom(roomId);
          messages.push(rooms.length === 1 ? msg : `${roomId} ${msg}`);
        } catch (e) {
          const err = e as string;
          messages.push(rooms.length === 1 ? err : `${roomId} ${err}`);
        }
      }

      return messages.join("\n");
    });

    this.commandProcessor.register("授权主播动态", async (args, context) => {
      if (!Utils.auth(context.event.user_id, 10))
        throw new AuthError("权限不足");

      const users = args;

      if (args.length < 1 || !users.every((e) => parseInt(e) > 0)) {
        return [OneBotMessageUtils.Text("授权用户动态 [UP主ID...]")];
      }

      const messages: string[] = [];

      for (let _user of users) {
        const mid = parseInt(_user);

        try {
          const msg = initUserDynamic(mid);
          messages.push(users.length === 1 ? msg : `${mid} ${msg}`);
        } catch (e) {
          const err = e as string;
          messages.push(users.length === 1 ? err : `${mid} ${err}`);
        }
      }

      return messages.join("\n");
    });

    this.commandProcessor.register("授权UP主", async (args, context) => {
      if (!Utils.auth(context.event.user_id, 10))
        throw new AuthError("权限不足");

      const users = args;

      const messages: SegmentMessages = [];

      for (let user of users) {
        messages.push(...(await initUser(parseInt(user))));
      }

      return messages.intersperse(OneBotMessageUtils.Text("\n\n"));
    });

    this.commandProcessor.register("解约直播间", async (args, context) => {
      if (!Utils.auth(context.event.user_id, 10))
        throw new AuthError("权限不足");

      const rooms = args;

      if (args.length < 1 || !rooms.every((e) => parseInt(e) > 0)) {
        return [OneBotMessageUtils.Text("解约直播间 [直播间ID...]")];
      }

      const messages: string[] = [];

      for (let _roomId of rooms) {
        logger.info(`解约直播间 -> ${_roomId}`);

        const roomId = parseInt(_roomId);

        const liveRoomsConfig = qqBotConfigManager.get("liveRoom");
        const _liveRoomConfig = liveConfigManager.get("rooms");

        if (liveRoomsConfig[_roomId]) {
          delete liveRoomsConfig[_roomId];
        }

        if (_liveRoomConfig[_roomId]) {
          delete _liveRoomConfig[_roomId];
        }

        qqBotConfigManager.set("liveRoom", liveRoomsConfig);
        liveConfigManager.set("rooms", _liveRoomConfig);

        logger.info(`直播间 ${roomId} 已从配置文件中删除`);

        this.liveAutomationManager.removeRoom(roomId);

        logger.info(`直播间 -> liveAutomationManager.removeRoom`);

        messages.push(
          rooms.length == 1 ? "删除成功 ✅" : `${roomId} 删除成功 ✅`
        );
      }

      return messages.join("\n");
    });

    this.commandProcessor.register("解约用户动态", async (args, context) => {
      if (!Utils.auth(context.event.user_id, 10))
        throw new AuthError("权限不足");

      const users = args;

      if (args.length < 1 || !users.every((e) => parseInt(e) > 0)) {
        return [OneBotMessageUtils.Text("解约用户动态 [UP主ID...]")];
      }

      const messages: string[] = [];

      for (let _user of users) {
        logger.info(`解约用户动态 -> ${_user}`);

        const mid = parseInt(_user);

        const usersDynamicConfig = qqBotConfigManager.get("userDynamic");
        const _usersDynamicConfig = userDynamicConfigManager.get("users");

        if (usersDynamicConfig[mid]) {
          delete usersDynamicConfig[mid];
        }

        if (_usersDynamicConfig[mid]) {
          delete _usersDynamicConfig[mid];
        }

        qqBotConfigManager.set("userDynamic", usersDynamicConfig);
        userDynamicConfigManager.set("users", _usersDynamicConfig);

        logger.info(`主播动态配置 ${mid} 已从配置文件中删除`);

        this.spaceDynamicMonitors.removeUser(mid);

        logger.info(`直播间 -> spaceDynamicMonitors.removeRoom`);

        messages.push(users.length == 1 ? "删除成功 ✅" : `${mid} 删除成功 ✅`);
      }

      return messages.join("\n");
    });

    this.commandProcessor.register("添加账号", async (args, context) => {
      if (!Utils.auth(context.event.user_id, 2))
        throw new AuthError("权限不足");

      loginAccount({
        isDefaultAccount: false,
        qrcodeCallback: (url, base64) => {
          context.reply(
            [
              OneBotMessageUtils.Text("请扫描二维码登陆\n"),
              OneBotMessageUtils.Base64Image(base64),
            ],
            { reference: true }
          );
        },
      })
        .then(async (userAccount) => {
          const biliApi = BiliApiService.register(userAccount);
          const accountInfo = await biliApi.getAccountInfo();
          context.reply([
            OneBotMessageUtils.UrlImage(accountInfo.face),
            OneBotMessageUtils.Text(
              "添加成功 ✅\n\n" +
                `用户昵称: ${accountInfo.uname}\n` +
                `用户ID: ${userAccount.getUid()}\n` +
                (accountInfo.vip_label.text
                  ? `会员: ${accountInfo.vip_label.text}\n`
                  : "") +
                `等级: Lv${accountInfo.level_info.current_level}`
            ),
          ]);
        })
        .catch((e) => {
          context.reply(`添加账号失败: ${e.toString()}`, { reference: true });
        });

      return null;
    });

    this.commandProcessor.register("添加管理员", async (args, context) => {
      const qid = parseInt(args[0]);
      const perm = parseInt(args[1]);
      if (args.length !== 2 || qid <= 0 || perm <= 0 || perm > 100)
        return "添加管理员 [QQ] [Perm]";

      if (!Utils.auth(context.event.user_id, Math.max(5, parseInt(args[1]))))
        throw new AuthError("权限不足");

      const adminsConfig = qqBotConfigManager.get("admins");

      let result = "添加成功";
      if (adminsConfig[args[0]]) {
        adminsConfig[args[0]].permission = parseInt(args[1]);

        result =
          perm >= adminsConfig[args[0]].permission
            ? "提升成功 ✅"
            : "降级成功 ✅";
      } else {
        adminsConfig[args[0]] = {
          permission: perm,
        };
      }

      qqBotConfigManager.set("admins", adminsConfig);

      return result;
    });
  }

  private installEventListeners() {
    const liveMonitors = this.liveAutomationManager.getLiveMonitors();
    const liveRecorders = this.liveAutomationManager.getLiveRecorders();
    const spaceDynamicMonitors =
      this.spaceDynamicMonitors.getSpaceDynamicMonitors();

    liveMonitors.forEach(this.installLiveMonitorEventListeners.bind(this));
    liveRecorders.forEach(this.installLiveRecorderEventListeners.bind(this));
    spaceDynamicMonitors.forEach(
      this.installSpaceDynamicMonitorEventListeners.bind(this)
    );

    this.liveAutomationManager.on("new-monitor", (liveMonitor, roomId) => {
      logger.debug(`热装载 LiveMonitor 监听器`);
      this.installLiveMonitorEventListeners(liveMonitor, roomId);
    });
    this.liveAutomationManager.on("new-recorder", (liveRecorder, hash) => {
      logger.debug(`热装载 LiveRecorder 监听器`);
      this.installLiveRecorderEventListeners(liveRecorder, hash);
    });
    this.liveAutomationManager.on(
      "new-uploader",
      (videoUploader, hash, roomId) => {
        logger.debug(`收到新的投稿器, 热装载 VideoUploader 监听器`);
        this.installVideoUploaderEventListeners(videoUploader, hash, roomId);
      }
    );
    this.spaceDynamicMonitors.on("new-monitor", (spaceDynamicMonitor, mid) => {
      logger.debug(`热装载 SpaceDynamicMonitor 监听器`);
      this.installSpaceDynamicMonitorEventListeners(spaceDynamicMonitor, mid);
    });
  }

  private installLiveMonitorEventListeners(
    liveMonitor: LiveMonitor,
    roomId: number
  ) {
    liveMonitor.on("live-start", async (liveHash, roomInfo) => {
      logger.debug(
        `收到 liveMonitor 的事件 -> live-start, roomId: ${roomId}, liveHash: ${liveHash}`
      );

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
      } else {
        const base64 = await Utils.renderLiveStatusTemplate(
          this.htmlTemplatesRender,
          roomInfo,
          liveHash
        );

        logger.debug("渲染完成 ✅");

        Object.entries(notifyGroups).forEach(async ([_gid, group]) => {
          const gid = parseInt(_gid);

          if (!this.bot) {
            logger.error("机器人实例对象不存在！");
            return;
          }

          let shouldAtAll = false;
          try {
            const botUid = this.bot.getQID();

            shouldAtAll =
              query.isOfficialGroup(roomId, gid) &&
              ["admin", "owner"].includes(
                (await this.bot.getGroupMemberInfo(gid, botUid)).data.role
              );
          } catch (e) {
            logger.warn(`判断是否需要At全体时出错:`, e);
          }

          const atSegmentMessage = shouldAtAll
            ? [OneBotMessageUtils.At("all")]
            : group.users.map<SegmentMessage>((qq) => {
                return OneBotMessageUtils.At(qq);
              });

          await this.bot.sendGroup(gid, [
            OneBotMessageUtils.Base64Image(base64),
          ]);

          await this.bot.sendGroup(gid, [
            OneBotMessageUtils.Text("您订阅的直播间开始直播啦\n"),
            ...atSegmentMessage,
          ]);

          logger.debug(`群聊通知完成 -> Group ${gid}`);
        });
      }
    });

    liveMonitor.on(
      "live-end",
      async (liveHash, roomInfo, lastRoomInfo, liveDuration_ms) => {
        logger.debug(
          `收到 liveMonitor 的事件 -> live-end, roomId: ${roomId}, liveHash: ${liveHash}, liveDuration_ms: ${liveDuration_ms}`
        );
        const liveRoomConfig =
          qqBotConfigManager.get("liveRoom")[roomId.toString()];

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
        } else {
          const base64 = await Utils.renderLiveStatusTemplate(
            this.htmlTemplatesRender,
            roomInfo,
            liveHash
          );

          Object.entries(notifyGroups).forEach(async ([gid, group]) => {
            if (!this.bot) {
              logger.error("机器人实例对象不存在！");
              return;
            }

            await this.bot.sendGroup(parseInt(gid), [
              OneBotMessageUtils.Base64Image(base64),
            ]);

            await this.bot.sendGroup(parseInt(gid), [
              OneBotMessageUtils.Text("您订阅的直播间已经结束直播啦"),
            ]);

            logger.debug(`群聊通知完成 -> Group ${gid}`);
          });
        }
      }
    );
  }

  private installLiveRecorderEventListeners(
    liveRecorder: LiveRecorder,
    hash: string
  ) {
    liveRecorder.on("start", () => {});
    liveRecorder.on("end", (duration) => {});
    liveRecorder.on("err", (error) => {});
  }

  private installSpaceDynamicMonitorEventListeners(
    spaceDynamicMonitor: SpaceDynamicMonitor,
    mid: number
  ) {
    spaceDynamicMonitor.on("new", (dynamicId, dynamic) => {
      logger.debug(
        `收到 spaceDynamicMonitor 的事件 -> new, mid: ${mid}, dynamicId: ${dynamicId}, dynamic:`,
        dynamic
      );

      if (
        ["DYNAMIC_TYPE_LIVE_RCMD", "DYNAMIC_TYPE_LIVE"].includes(dynamic.type)
      ) {
        logger.info(`收到直播通知类型动态，跳过通知`);
        return;
      }

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

      logger.debug(
        `开始动态通知 -> 用户 ${mid}, 群组: ${userConfig.group}, 动态ID: ${dynamicId}`
      );

      Object.entries(notifyGroups).forEach(async ([_gid, group]) => {
        const gid = parseInt(_gid);

        if (!this.bot) {
          logger.error("机器人实例对象不存在！");
          return;
        }

        let shouldAtAll = false;
        try {
          const botUid = this.bot.getQID();

          shouldAtAll =
            query.isOfficialGroup(mid, gid) &&
            ["admin", "owner"].includes(
              (await this.bot.getGroupMemberInfo(gid, botUid)).data.role
            );
        } catch (e) {
          logger.warn(`判断是否需要At全体时出错:`, e);
        }

        const atSegmentMessage = shouldAtAll
          ? [OneBotMessageUtils.At("all")]
          : group.users.map<SegmentMessage>((qq) => {
              return OneBotMessageUtils.At(qq);
            });

        await this.bot.sendGroup(gid, [
          OneBotMessageUtils.Base64Image(
            await this.htmlTemplatesRender.newDynamic(dynamicId)
          ),
        ]);

        if (
          Math.floor(Date.now() / 1000) -
            parseInt(dynamic.modules.module_author.pub_ts as any) >
          60 * 60
        ) {
          logger.warn(
            `动态过久，停止通知 :`,
            Math.floor(Date.now() / 1000) -
              parseInt(dynamic.modules.module_author.pub_ts as any)
          );
          return;
        }

        await this.bot.sendGroup(gid, [
          OneBotMessageUtils.Text(
            `UP发布新动态啦\n发布时间: ${dynamic.modules.module_author.pub_time}`
          ),
          ...atSegmentMessage,
        ]);

        logger.debug(`群聊通知完成 -> Group ${gid}`);
      });
    });
  }

  private installVideoUploaderEventListeners(
    videoUploader: VideoUploader,
    hash: string,
    {
      file,
      roomInfo,
      live,
      recorder,
      userCard,
      additionalDesc,
    }: UploadEventOptions
  ) {
    const roomId = roomInfo.room_id;

    const liveRoomConfig =
      qqBotConfigManager.get("liveRoom")[roomId.toString()];
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
      Object.entries(notifyGroups).forEach(async ([gid, group]) => {
        if (!this.bot) {
          logger.error("机器人实例对象不存在！");
          return;
        }
        await this.bot.sendGroup(parseInt(gid), [
          OneBotMessageUtils.Text(
            `录播开始投稿\n` +
              `hash: ${hash.substring(0, 7)}\n` +
              (additionalDesc ? `${additionalDesc}\n\n` : `\n`) +
              `录制时长: ${FormatUtils.formatDurationWithoutSeconds(
                recorder.duration
              )}`
          ),
        ]);

        logger.debug(`群聊通知完成 -> Group ${gid}`);
      });
    }

    videoUploader.on("done", (uploadVideoInfo) => {
      const liveRoomConfig =
        qqBotConfigManager.get("liveRoom")[roomId.toString()];

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
        Object.entries(notifyGroups).forEach(async ([gid, group]) => {
          if (!this.bot) {
            logger.error("机器人实例对象不存在！");
            return;
          }
          await this.bot.sendGroup(parseInt(gid), [
            OneBotMessageUtils.Text(
              `录播投稿完成✅\n` +
                `hash: ${hash.substring(0, 7)}\n\n` +
                `录制时长: ${FormatUtils.formatDurationWithoutSeconds(
                  recorder.duration
                )}\n\n` +
                `投稿耗时: ${FormatUtils.formatDurationWithoutSeconds(
                  uploadVideoInfo.duration
                )}\n` +
                `视频地址: \nhttps://www.bilibili.com/video/${uploadVideoInfo.bvid}`
            ),
          ]);

          logger.debug(`群聊通知完成 -> Group ${gid}`);
        });
      }
    });
  }
}

class Utils {
  static async renderLiveStatusTemplate(
    htmlTemplatesRender: HtmlTemplatesRender,
    roomInfo: LiveRoomInfo,
    liveHash: string
  ) {
    return await htmlTemplatesRender.render("live_status_landscape", {
      status: roomInfo.live_status,
      background_image: roomInfo.background,
      cover_image: roomInfo.user_cover,
      parent_area_name: roomInfo.parent_area_name,
      area_name: roomInfo.area_name,
      live_time:
        roomInfo.live_status === LiveRoomStatus.LIVE
          ? roomInfo.live_time
          : "未开播",
      title: roomInfo.title,
      description: roomInfo.description,
      popularity: roomInfo.online.toString(),
      duration:
        roomInfo.live_status === LiveRoomStatus.LIVE
          ? FormatUtils.formatDurationDetailed(
              Date.now() - new Date(roomInfo.live_time).getTime()
            )
          : "未开播",
      liveHash: liveHash,
    });
  }

  static auth(qid: number, permission = 1) {
    if (qqBotConfigManager.get("superAdmin") == qid) return true;

    const isAdmin = qqBotConfigManager.get("admins")[qid.toString()];

    return isAdmin && isAdmin.permission >= permission;
  }
}

class SubscriptionQuery<T extends DataStore<string>> {
  private readonly data: T;

  constructor(data: T) {
    this.data = data;
  }

  /**
   * 获取订阅的所有资源
   * @param userId 用户ID
   * @returns 用户订阅的资源key数组
   */
  getSubscriptions(): string[] {
    const subscriptions: string[] = [];

    for (const [resourceId, _] of Object.entries(this.data)) {
      subscriptions.push(resourceId);
    }

    return subscriptions;
  }

  /**
   * 获取用户在所有群组中订阅的所有资源
   * @param userId 用户ID
   * @returns 用户订阅的资源key数组
   */
  getUserSubscriptions(userId: number): string[] {
    const subscriptions: string[] = [];

    for (const [resourceId, config] of Object.entries(this.data)) {
      // 检查用户是否在任何一个群组中
      const hasSubscription = Object.values(config.group).some((group) =>
        group.users.includes(userId)
      );

      if (hasSubscription) {
        subscriptions.push(resourceId);
      }
    }

    return subscriptions;
  }

  /**
   * 获取用户在特定群组中订阅的所有资源
   * @param userId 用户ID
   * @param groupId 群组ID
   * @returns 用户在群组中订阅的资源key数组
   */
  getUserGroupSubscriptions(userId: number, groupId: number): string[] {
    const subscriptions: string[] = [];

    for (const [resourceId, config] of Object.entries(this.data)) {
      const group = config.group[groupId.toString()];

      if (group && group.users.includes(userId)) {
        subscriptions.push(resourceId);
      }
    }

    return subscriptions;
  }

  /**
   * 获取群组中所有订阅的资源
   * @param groupId 群组ID
   * @returns 群组订阅的资源key数组
   */
  getGroupSubscriptions(groupId: number): string[] {
    const subscriptions: string[] = [];

    for (const [resourceId, config] of Object.entries(this.data)) {
      if (config.group[groupId.toString()]) {
        subscriptions.push(resourceId);
      }
    }

    return subscriptions;
  }

  /**
   * 获取特定资源的所有订阅者（用户ID）
   * @param resourceId 资源ID
   * @returns 所有订阅该资源的用户ID数组
   */
  getResourceSubscribers(resourceId: number): number[] {
    const subscribers = new Set<number>();
    const config = this.data[resourceId.toString()];

    if (!config) return [];

    for (const group of Object.values(config.group)) {
      group.users.forEach((userId) => subscribers.add(userId));
    }

    return Array.from(subscribers);
  }

  /**
   * 获取特定资源在特定群组中的所有订阅者
   * @param resourceId 资源ID
   * @param groupId 群组ID
   * @returns 群组中订阅该资源的用户ID数组
   */
  getResourceGroupSubscribers(resourceId: number, groupId: number): number[] {
    const config = this.data[resourceId.toString()];
    if (!config) return [];

    const group = config.group[groupId.toString()];
    return group ? [...group.users] : [];
  }

  /**
   * 检查用户是否订阅了某个资源
   * @param resourceId 资源ID
   * @param userId 用户ID
   * @param groupId 群组ID（可选，不传则检查所有群组）
   */
  hasUserSubscribed(
    resourceId: number,
    userId: number,
    groupId?: number
  ): boolean {
    const config = this.data[resourceId.toString()];
    if (!config) return false;

    if (groupId) {
      const group = config.group[groupId.toString()];
      return group ? group.users.includes(userId) : false;
    }

    return Object.values(config.group).some((group) =>
      group.users.includes(userId)
    );
  }

  /**
   * 获取资源的所有官方群组ID
   * @param resourceId 资源ID
   * @returns 该资源的官方群组ID数组
   */
  getOfficialGroups(resourceId: number): number[] {
    const config = this.data[resourceId.toString()];
    if (!config) return [];

    const officialGroups: number[] = [];

    for (const [groupId, group] of Object.entries(config.group)) {
      if (group.offical) {
        officialGroups.push(parseInt(groupId));
      }
    }

    return officialGroups;
  }

  /**
   * 获取群组的所有官方资源
   * @param groupId 群组ID
   * @returns 该群组的官方资源ID，如果没有则返回null
   */
  getOfficialResource(groupId: number): number | null {
    const groupIdStr = groupId.toString();

    for (const [resourceId, config] of Object.entries(this.data)) {
      const group = config.group[groupIdStr];
      if (group && group.offical) {
        return parseInt(resourceId);
      }
    }

    return null;
  }

  /**
   * 检查群组是否为某个资源的官方群组
   * @param resourceId 资源ID
   * @param groupId 群组ID
   * @returns 是否为官方群组
   */
  isOfficialGroup(resourceId: number, groupId: number): boolean {
    const config = this.data[resourceId.toString()];
    if (!config) return false;

    const group = config.group[groupId.toString()];
    return group ? group.offical : false;
  }
}
