import {
  appConfigManager,
  BiliAccountService,
  FormatUtils,
  LiveRoomStatus,
  SpaceDynamicRender,
} from "@bili-nexus/core";
import type { DynamicNewCardsMember, LiveRoomInfo } from "@bili-nexus/core";
import { OneBotMessageUtils } from "../../types/one-bot";
import type { SegmentMessages } from "../../types/one-bot";

/** 直播状态文案 */
export function getLiveRoomStatusText(liveRoomStatus: LiveRoomStatus): string {
  let status = "未知 ❓";

  if (liveRoomStatus === LiveRoomStatus.LIVE) {
    status = "直播中 🟢";
  } else if (liveRoomStatus === LiveRoomStatus.SLIDESHOW) {
    status = "轮播中 🟡";
  } else if (liveRoomStatus === LiveRoomStatus.END) {
    status = "未开播 🔴";
  }

  return status;
}

/** 直播中/未开播通用状态模板 */
export async function renderLiveStatusTemplate(roomInfo: LiveRoomInfo, liveHash: string): Promise<SegmentMessages> {
  const upUserInfo = await BiliAccountService.getDefault().getBiliApi().getUserInfo(roomInfo.uid);

  if (roomInfo.live_status === LiveRoomStatus.LIVE) return renderLiveStartTemplate(roomInfo, liveHash);

  return [
    OneBotMessageUtils.UrlImage(roomInfo.user_cover),
    OneBotMessageUtils.Text(
      `【${upUserInfo.name}】${roomInfo.title}\n` +
        `🆔 直播间ID: ${roomInfo.room_id}\n` +
        `📝 直播间简介: ${roomInfo.description}\n` +
        `📊 直播间状态: ${getLiveRoomStatusText(roomInfo.live_status)}\n\n` +
        `https://live.bilibili.com/${roomInfo.room_id}`
    ),
  ];
}

/** 开播通知模板 */
export async function renderLiveStartTemplate(roomInfo: LiveRoomInfo, liveHash: string): Promise<SegmentMessages> {
  const upUserInfo = await BiliAccountService.getDefault().getBiliApi().getUserInfo(roomInfo.uid);

  const liveTime = new Date(roomInfo.live_time);
  const nowTiem = new Date();

  return [
    OneBotMessageUtils.UrlImage(roomInfo.user_cover),
    OneBotMessageUtils.Text(
      `【${upUserInfo.name}】${roomInfo.title}\n` +
        `🆔 直播间ID: ${roomInfo.room_id}\n` +
        `📝 直播间简介: ${roomInfo.description}\n` +
        `📊 直播间状态: ${getLiveRoomStatusText(roomInfo.live_status)}\n` +
        `🎬 直播间场次: ${FormatUtils.formatDateWithSession(liveTime)}\n` +
        `🔥 直播间人气: ${roomInfo.online}\n` +
        `🔑 直播场哈希: ${liveHash.substring(0, 7)}\n` +
        `⏰ 开播时间: ${FormatUtils.formatDateTime(liveTime)}\n` +
        `⏱️ 直播时长: ${FormatUtils.formatDurationDetailed(nowTiem.getTime() - liveTime.getTime())}\n\n` +
        `https://live.bilibili.com/${roomInfo.room_id}`
    ),
  ];
}

/** 关播通知模板 */
export async function renderLiveEndTemplate({
  liveStartRoomInfo,
  liveEndRoomInfo,
  liveHash,
  liveDuration,
}: {
  liveStartRoomInfo: LiveRoomInfo;
  liveEndRoomInfo: LiveRoomInfo;
  liveHash: string;
  liveDuration: number;
}): Promise<SegmentMessages> {
  const upUserInfo = await BiliAccountService.getDefault().getBiliApi().getUserInfo(liveEndRoomInfo.uid);

  const liveTime = new Date(liveStartRoomInfo.live_time);
  const nowTiem = new Date();

  return [
    OneBotMessageUtils.UrlImage(liveEndRoomInfo.user_cover),
    OneBotMessageUtils.Text(
      `【${upUserInfo.name}】${liveEndRoomInfo.title}\n` +
        `🆔 直播间ID: ${liveEndRoomInfo.room_id}\n` +
        `📝 直播间简介: ${liveEndRoomInfo.description}\n` +
        `📊 直播间状态: ${getLiveRoomStatusText(liveEndRoomInfo.live_status)}\n` +
        `🎬 直播间场次: ${FormatUtils.formatDateWithSession(liveTime)}\n` +
        `🔑 直播场哈希: ${liveHash.substring(0, 7)}\n` +
        `⏰ 开播时间: ${FormatUtils.formatDateTime(liveTime)}\n` +
        `🛑 关播时间: ${FormatUtils.formatDateTime(nowTiem)}\n` +
        `⏱️ 直播时长: ${FormatUtils.formatDurationDetailed(liveDuration)}\n\n` +
        `https://live.bilibili.com/${liveEndRoomInfo.room_id}`
    ),
  ];
}

/** 新动态通知模板（优先走动态渲染服务，失败时降级为文本） */
export async function renderNewDynamic(card: DynamicNewCardsMember): Promise<SegmentMessages> {
  try {
    const dynamicRenderConfig = appConfigManager.get("dynamicRender");
    const base64 = await SpaceDynamicRender.render(dynamicRenderConfig, card, BiliAccountService.getDefault().getAccount().getCookie());
    return [OneBotMessageUtils.Base64Image(base64)];
  } catch (e) {
    return [OneBotMessageUtils.Text("渲染失败: " + e)];
  }
}
