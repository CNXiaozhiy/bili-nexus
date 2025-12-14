import Ffmpeg from "@/core/ffmpeg";
import { BiliApi } from "@/services/bili-api";
import { LiveRoomStatus } from "@/types/bili";
import fs from "fs";
import path from "path";

const tempDir = path.join(process.cwd(), "temp");
fs.mkdirSync(tempDir, { recursive: true });

export async function screenshotSync(
  roomId: number | string,
  biliApiInstance: BiliApi
) {
  if (
    (await biliApiInstance.getLiveRoomInfo(roomId)).live_status !==
    LiveRoomStatus.LIVE
  ) {
    throw new Error("直播间未开播");
  }
  const urls = await biliApiInstance.getLiveStreamUrl(roomId);
  const outputFilePath = path.join(tempDir, `${Date.now()}.png`);
  const resp = await Ffmpeg.screenshotSync(urls[0], outputFilePath, {
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
    headers: {
      Referer: "https://live.bilibili.com/",
    },
  });

  const imageData = fs.readFileSync(resp);
  fs.unlinkSync(resp);

  return Buffer.from(imageData).toString("base64");
}
