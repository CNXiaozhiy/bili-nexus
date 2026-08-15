import Ffmpeg from "@/core/ffmpeg";
import { LiveRoomStatus } from "@/types/bilibili";
import { IBiliHttpApi } from "@/types/bilibili/bili-http-api";
import fs from "fs";
import path from "path";

const tempDir = path.join(process.cwd(), "temp");
fs.mkdirSync(tempDir, { recursive: true });

interface IBiliApi {}

export async function screenshotSync(
  roomId: number | string,
  biliApi: IBiliHttpApi
) {
  if (
    (await biliApi.getLiveRoomInfo(roomId)).live_status !== LiveRoomStatus.LIVE
  ) {
    throw new Error("直播间未开播");
  }
  const urls = await biliApi.getLiveStreamUrl(roomId);
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
