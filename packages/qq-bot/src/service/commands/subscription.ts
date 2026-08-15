import {
  BiliAccountService,
  BiliUtils,
  getLogger,
  liveConfigManager,
  loginAccount,
  userDynamicConfigManager,
} from "@bili-nexus/core";
import { qqBotConfigManager } from "../../config";
import { auth } from "../auth";
import { AuthError } from "../context";
import type { CommandContext, CommandProcessors, ProcessorContext } from "../context";
import { OneBotMessageUtils } from "../../types/one-bot";
import type { SegmentMessages, GroupMessageEvent, MessageEvent } from "../../types/one-bot";
import { SubscriptionQuery } from "../subscription/store";
import {
  canOneClickSubscribe,
  initLiveRoom,
  initUser,
  initUserDynamic,
  subscribeLiveRoom,
  subscribeUser,
  subscribeUserDynamic,
} from "../subscription/actions";

const logger = getLogger("QQBotCommands:Subscription");

/** 订阅/授权/解约/账号管理类命令 */
export function registerSubscriptionCommands(processors: CommandProcessors, ctx: CommandContext): void {
  const { global, group } = processors;

  // ---------- 群聊命令 ----------

  group.register("一键订阅", async (_args, context: ProcessorContext<GroupMessageEvent>) => {
    const oneClickSubscribe = canOneClickSubscribe(context.event.group_id);
    if (!oneClickSubscribe.can) {
      return [OneBotMessageUtils.Text("本群不是官方群聊，无法使用一键订阅")];
    }

    if (oneClickSubscribe.user) {
      logger.debug("存在用户动态官方群，将直接采用 订阅UP 功能完成一键订阅");
      return await subscribeUser(context.event.user_id, context.event.group_id, oneClickSubscribe.user);
    } else if (oneClickSubscribe.room) {
      return subscribeLiveRoom(context.event.user_id, context.event.group_id, oneClickSubscribe.room);
    } else {
      return "None";
    }
  });

  group.register("订阅UP", async (args, context: ProcessorContext<GroupMessageEvent>) => {
    const users = args;

    if (args.length === 0 && canOneClickSubscribe(context.event.group_id).can) {
      return [OneBotMessageUtils.Text("本群为官方群聊，您可以\n使用 '一键订阅' 命令来完成订阅")];
    }

    if (args.length < 1 || !users.every((e) => parseInt(e) > 0)) {
      return [OneBotMessageUtils.Text("订阅UP [UP主ID...]")];
    }

    const messages: SegmentMessages = [];

    for (let user of users) {
      messages.push(...(await subscribeUser(context.event.user_id, context.event.group_id, parseInt(user))));
    }

    return messages.intersperse(OneBotMessageUtils.Text("\n\n"));
  });

  group.register("订阅直播间", async (args, context: ProcessorContext<GroupMessageEvent>) => {
    const rooms = args;

    if (args.length === 0 && !!canOneClickSubscribe(context.event.group_id).room) {
      return [OneBotMessageUtils.Text("本群为官方群聊，您可以\n使用 '一键订阅' 命令来完成订阅")];
    }

    if (args.length < 1 || !rooms.every((e) => parseInt(e) > 0)) {
      return [OneBotMessageUtils.Text("订阅直播间 [直播间ID...]")];
    }

    const messages: string[] = [];

    for (let _roomId of rooms) {
      const roomId = parseInt(_roomId);

      try {
        const msg = subscribeLiveRoom(context.event.user_id, context.event.group_id, roomId);
        messages.push(rooms.length !== 1 ? `${roomId} ${msg}` : msg);
      } catch (e) {
        const err = e as string;
        messages.push(rooms.length !== 1 ? `${roomId} ${err}` : err);
      }
    }

    return messages.join("\n");
  });

  group.register("订阅主播动态", async (args, context: ProcessorContext<GroupMessageEvent>) => {
    const users = args;

    if (args.length === 0 && !!canOneClickSubscribe(context.event.group_id).user) {
      return [OneBotMessageUtils.Text("本群为官方群聊，您可以\n使用 '一键订阅' 命令来完成订阅\n\n或者: 订阅主播动态 [用户ID...]")];
    }

    if (args.length < 1 || !users.every((e) => parseInt(e) > 0)) {
      return [OneBotMessageUtils.Text("订阅主播动态 [用户ID...]" + "查询UP主用户ID可以使用\n" + "'查询主播 [主播名]' 命令")];
    }

    const messages: string[] = [];

    for (let _userId of users) {
      const mid = parseInt(_userId);

      try {
        const msg = subscribeUserDynamic(context.event.user_id, context.event.group_id, mid);
        messages.push(users.length !== 1 ? `${mid} ${msg}` : msg);
      } catch (e) {
        const err = e as string;
        messages.push(users.length !== 1 ? `${mid} ${err}` : err);
      }
    }

    return messages.join("\n");
  });

  group.register("设置UP官群", async (args, context: ProcessorContext<GroupMessageEvent>) => {
    if (!auth(context.event.user_id, 10)) throw new AuthError("权限不足");

    if (args.length !== 1 || parseInt(args[0]) < 0) {
      return "设置UP官群 [UP主ID]";
    }

    logger.debug("开始设置UP官群");

    const gid = context.event.group_id;

    const liveRoomsConfig = qqBotConfigManager.get("liveRoom");
    const usersDynamicConfig = qqBotConfigManager.get("userDynamic");

    const messages: [string, string] = ["", ""];

    const mid = parseInt(args[0]);

    const userInfo = await BiliAccountService.getDefault().getBiliApi().getUserInfo(mid);

    if (userInfo.live_room.roomStatus === 0 || userInfo.live_room.roomid <= 0) {
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
          `- 直播间: ${userInfo.live_room.roomStatus === 0 ? "无" : userInfo.live_room.roomid}\n` +
          `- 设置结果:\n` +
          `  - 直播间: ${messages[0]}\n` +
          `  - 主播动态: ${messages[1]}`
      ),
    ];
  });

  // ---------- 全局命令 ----------

  global.register("授权直播间", async (args, context: ProcessorContext<MessageEvent>) => {
    if (!auth(context.event.user_id, 10)) throw new AuthError("权限不足");

    const rooms = args;

    if (args.length < 1 || !rooms.every((e) => parseInt(e) > 0)) {
      return [OneBotMessageUtils.Text("授权直播间 [直播间ID...]")];
    }

    const messages: string[] = [];

    for (let _roomId of rooms) {
      const roomId = parseInt(_roomId);

      try {
        const msg = initLiveRoom({ liveAutomationManager: ctx.liveAutomationManager, dynamicAutomationManager: ctx.dynamicAutomationManager }, roomId);
        messages.push(rooms.length === 1 ? msg : `${roomId} ${msg}`);
      } catch (e) {
        const err = e as string;
        messages.push(rooms.length === 1 ? err : `${roomId} ${err}`);
      }
    }

    return messages.join("\n");
  });

  global.register("授权主播动态", async (args, context: ProcessorContext<MessageEvent>) => {
    if (!auth(context.event.user_id, 10)) throw new AuthError("权限不足");

    const users = args;

    if (args.length < 1 || !users.every((e) => parseInt(e) > 0)) {
      return [OneBotMessageUtils.Text("授权用户动态 [UP主ID...]")];
    }

    const messages: string[] = [];

    for (let _user of users) {
      const mid = _user;

      try {
        const msg = initUserDynamic({ liveAutomationManager: ctx.liveAutomationManager, dynamicAutomationManager: ctx.dynamicAutomationManager }, mid);
        messages.push(users.length === 1 ? msg : `${mid} ${msg}`);
      } catch (e) {
        const err = e as string;
        messages.push(users.length === 1 ? err : `${mid} ${err}`);
      }
    }

    return messages.join("\n");
  });

  global.register("授权UP主", async (args, context: ProcessorContext<MessageEvent>) => {
    if (!auth(context.event.user_id, 10)) throw new AuthError("权限不足");

    const users = args;

    const messages: SegmentMessages = [];

    for (let user of users) {
      messages.push(...(await initUser({ liveAutomationManager: ctx.liveAutomationManager, dynamicAutomationManager: ctx.dynamicAutomationManager }, parseInt(user))));
    }

    return messages.intersperse(OneBotMessageUtils.Text("\n\n"));
  });

  global.register("解约直播间", async (args, context: ProcessorContext<MessageEvent>) => {
    if (!auth(context.event.user_id, 10)) throw new AuthError("权限不足");

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

      ctx.liveAutomationManager.removeRoom(roomId);

      logger.info(`直播间 -> liveAutomationManager.removeRoom`);

      messages.push(rooms.length == 1 ? "删除成功 ✅" : `${roomId} 删除成功 ✅`);
    }

    return messages.join("\n");
  });

  global.register("解约用户动态", async (args, context: ProcessorContext<MessageEvent>) => {
    if (!auth(context.event.user_id, 10)) throw new AuthError("权限不足");

    const users = args;

    if (args.length < 1 || !users.every((e) => parseInt(e) > 0)) {
      return [OneBotMessageUtils.Text("解约用户动态 [UP主ID...]")];
    }

    const messages: string[] = [];

    for (let _user of users) {
      logger.info(`解约用户动态 -> ${_user}`);

      const mid = _user;

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

      ctx.dynamicAutomationManager.removeUser(mid);

      logger.info(`直播间 -> spaceDynamicMonitors.removeUser`);

      messages.push(users.length == 1 ? "删除成功 ✅" : `${mid} 删除成功 ✅`);
    }

    return messages.join("\n");
  });

  global.register("添加账号", async (_args, context: ProcessorContext<MessageEvent>) => {
    if (!auth(context.event.user_id, 2)) throw new AuthError("权限不足");

    loginAccount({
      isDefaultAccount: false,
      qrcodeCallback: (url, base64) => {
        context.reply([OneBotMessageUtils.Text("请扫描二维码登陆\n"), OneBotMessageUtils.Base64Image(base64)], { reference: true });
      },
    })
      .then(async (userAccount) => {
        const biliApi = BiliAccountService.register(userAccount).getBiliApi();
        const accountInfo = await biliApi.getAccountInfo();
        context.reply([
          OneBotMessageUtils.UrlImage(accountInfo.face),
          OneBotMessageUtils.Text(
            "添加成功 ✅\n\n" +
              `用户昵称: ${accountInfo.uname}\n` +
              `用户ID: ${userAccount.getUid()}\n` +
              (accountInfo.vip_label.text ? `会员: ${accountInfo.vip_label.text}\n` : "") +
              `等级: Lv${accountInfo.level_info.current_level}`
          ),
        ]);
      })
      .catch((e) => {
        context.reply(`添加账号失败: ${e.toString()}`, { reference: true });
      });

    return null;
  });

  global.register("添加管理员", async (args, context: ProcessorContext<MessageEvent>) => {
    const qid = parseInt(args[0]);
    const perm = parseInt(args[1]);
    if (args.length !== 2 || qid <= 0 || perm <= 0 || perm > 100) return "添加管理员 [QQ] [Perm]";

    if (!auth(context.event.user_id, Math.max(5, parseInt(args[1])))) throw new AuthError("权限不足");

    const adminsConfig = qqBotConfigManager.get("admins");

    let result = "添加成功";
    if (adminsConfig[args[0]]) {
      adminsConfig[args[0]].permission = parseInt(args[1]);

      result = perm >= adminsConfig[args[0]].permission ? "提升成功 ✅" : "降级成功 ✅";
    } else {
      adminsConfig[args[0]] = {
        permission: perm,
      };
    }

    qqBotConfigManager.set("admins", adminsConfig);

    return result;
  });
}
