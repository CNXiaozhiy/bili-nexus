import { LiveRoomStatus, VipType } from "@/types/bilibili";
import Crypto from "crypto";
import FormatUtils from "./format";

export default class BiliUtils {
  static computeHash(roomId: number, startTime: number) {
    const session = FormatUtils.formatDateWithSession(new Date(startTime));

    return {
      hash: Crypto.createHash("sha256").update(`${roomId}-${startTime}`).digest("hex"),
      sessionHash: Crypto.createHash("sha256").update(session).digest("hex"),
    };
  }
  static transformLiveStatus(status: LiveRoomStatus) {
    switch (status) {
      case LiveRoomStatus.END:
        return "未开播 🔴";
      case LiveRoomStatus.LIVE:
        return "直播中 🟢";
      case LiveRoomStatus.SLIDESHOW:
        return "轮播中 🟡";
      default:
        return "未知状态";
    }
  }

  static transformVipType(type: VipType) {
    switch (type) {
      case VipType.Null:
        return "无";
      case VipType.Monthly_Membership:
        return "月度大会员";
      case VipType.Annual_Membership:
        return "年度大会员";
      default:
        return "未知";
    }
  }

  static parseCookies(cookieStrings: string[]): string {
    return cookieStrings
      .map((cookie) => {
        const [keyValue] = cookie.split(";");
        return keyValue.trim();
      })
      .join("; ");
  }

  static parseCookieString(cookieString: string): Record<string, string> {
    if (!cookieString || typeof cookieString !== "string") {
      return {};
    }

    const result: Record<string, string> = {};

    const cookies = cookieString.split(";");

    for (const cookie of cookies) {
      const trimmedCookie = cookie.trim();

      const equalsIndex = trimmedCookie.indexOf("=");

      if (equalsIndex === -1) {
        // 如果没有等号，跳过此项
        continue;
      }

      const key = trimmedCookie.substring(0, equalsIndex).trim();
      const value = trimmedCookie.substring(equalsIndex + 1).trim();

      if (key) {
        result[key] = value;
      }
    }

    return result;
  }

  static getCSRF(cookie: string) {
    const match = cookie.match(/bili_jct=([^\s;]+)/);
    if (!match || !Array.isArray(match)) throw new Error("bili_jct not found");
    return match[1];
  }
}
