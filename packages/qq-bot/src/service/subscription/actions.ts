import {
  BiliAccountService,
  BiliUtils,
  getLogger,
  liveConfigManager,
  userDynamicConfigManager,
} from "@bili-nexus/core";
import type { DynamicAutomationManager, LiveAutomationManager } from "@bili-nexus/core";
import { qqBotConfigManager } from "../../config";
import { OneBotMessageUtils } from "../../types/one-bot";
import type { SegmentMessages } from "../../types/one-bot";
import { SubscriptionQuery } from "./store";

const logger = getLogger("QQBotSubscription");

export interface SubscriptionActionsDeps {
  liveAutomationManager: LiveAutomationManager;
  dynamicAutomationManager: DynamicAutomationManager;
}

/** 订阅直播间（qid 订阅 gid 群内的 roomId） */
export function subscribeLiveRoom(qid: number, gid: number, roomId: number): string {
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
    logger.warn(`当前群聊 ${gid} 配置中订阅用户组不为数组, 将初始化为空用户组`);
    roomConfig.group[gid].users = [];
  }

  if (roomConfig.group[gid].users.find((u) => u === qid) === undefined) {
    roomConfig.group[gid].users.push(qid);
    qqBotConfigManager.set("liveRoom", liveRoomsConfig);

    const _liveRoomConfig = liveConfigManager.get("rooms")[roomId.toString()];

    if (!_liveRoomConfig) return "订阅成功 🎉\n\n" + "警告⚠️: 主直播间配置未初始化, 请联系管理员处理";
    return "订阅成功 🎉";
  } else {
    throw "你已经订阅过该直播间";
  }
}

/** 订阅主播动态（qid 订阅 gid 群内的 userId） */
export function subscribeUserDynamic(qid: number, gid: number, userId: number): string {
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
    logger.warn(`当前群聊 ${gid} 配置中订阅用户组不为数组, 将初始化为空用户组`);
    userConfig.group[gid].users = [];
  }

  if (userConfig.group[gid].users.find((u) => u === qid) === undefined) {
    userConfig.group[gid].users.push(qid);
    qqBotConfigManager.set("userDynamic", usersDynamicConfig);
    return "订阅成功 🎉";
  } else {
    return "你已经订阅过该主播";
  }
}

/** 订阅 UP 主（同时订阅其直播间与主播动态） */
export async function subscribeUser(qid: number, gid: number, mid: number): Promise<SegmentMessages> {
  let _messages: [string, string] = ["", ""];

  const userInfo = await BiliAccountService.getDefault().getBiliApi().getUserInfo(mid);

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
        `- 直播间: ${userInfo.live_room.roomStatus === 0 ? "无" : userInfo.live_room.roomid}\n` +
        `- 订阅状态:\n` +
        `  - 直播间: ${_messages[0]}\n` +
        `  - 主播动态: ${_messages[1]}`
    ),
  ];
}

/** 判断当前群是否可一键订阅（存在官方直播间或官方主播动态） */
export function canOneClickSubscribe(gid: number): { can: boolean; room: number | null; user: number | null } {
  const liveRoomsConfig = qqBotConfigManager.get("liveRoom");
  const usersDynamicConfig = qqBotConfigManager.get("userDynamic");

  const liveRoomsQuery = new SubscriptionQuery(liveRoomsConfig);
  const usersDynamicQuery = new SubscriptionQuery(usersDynamicConfig);

  const room = liveRoomsQuery.getOfficialResource(gid);
  const user = usersDynamicQuery.getOfficialResource(gid);

  return {
    can: !!room || !!user,
    room,
    user,
  };
}

/** 授权直播间（初始化主配置与订阅配置，并加入 LiveAutomationManager） */
export function initLiveRoom(deps: SubscriptionActionsDeps, roomId: number): string {
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

  deps.liveAutomationManager.addRoom(roomId, {
    autoRecord: _roomConfig.autoRecord,
    autoUpload: _roomConfig.autoUpload,
  });

  return "授权成功 ✅";
}

/** 授权主播动态（初始化主配置与订阅配置，并加入 DynamicAutomationManager） */
export function initUserDynamic(deps: SubscriptionActionsDeps, mid: string): string {
  const usersDynamicConfig = qqBotConfigManager.get("userDynamic");
  const _usersDynamicConfig = userDynamicConfigManager.get("users");

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

  deps.dynamicAutomationManager.addUser(mid);

  return "授权成功 ✅";
}

/** 授权 UP 主（同时授权其直播间与主播动态） */
export async function initUser(deps: SubscriptionActionsDeps, mid: number): Promise<SegmentMessages> {
  let _messages: [string, string] = ["", ""];

  const userInfo = await BiliAccountService.getDefault().getBiliApi().getUserInfo(mid);

  const roomId = userInfo.live_room.roomid;

  // roomId 可能为 0
  if (userInfo.live_room.roomStatus === 0 || roomId <= 0) {
    _messages[0] = "该主播无直播间\n";
  } else {
    try {
      const msg = initLiveRoom(deps, roomId);
      _messages[0] = `直播间 ${msg}\n`;
    } catch (e) {
      const err = e as string;
      _messages[0] = `直播间 ${err}\n`;
    }
  }

  try {
    const msg = initUserDynamic(deps, userInfo.mid.toString());
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
        `- 直播间: ${userInfo.live_room.roomStatus === 0 ? "无" : userInfo.live_room.roomid}\n` +
        `- 授权状态:\n` +
        `  -${_messages[0]}\n` +
        `  -${_messages[1]}`
    ),
  ];
}
