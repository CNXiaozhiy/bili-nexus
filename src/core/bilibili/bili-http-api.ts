import request from "@/utils/request";
import BiliUtils from "@/utils/bili";
import crypto from "crypto";
import {
  DynamicDetail,
  LiveRoomInfo,
  LiveRoomPlayInfo,
  LoginInfo,
  SpaceDynamic,
  UserCard,
  UserInfo,
  VideoInfo,
  DanmuInfo,
} from "@/types/bilibili";
import { Response } from "@/types/bilibili/bili-http-api";
import { BiliHttpApiError } from "@/types/errors/bili-api";
import {
  AccountLoginExpiredError,
  UploadVideoError,
} from "@/types/errors/bili-http-api";
import fs from "fs";
import { AxiosError, AxiosProgressEvent } from "axios";
import { IBiliHttpApi } from "@/types/bilibili/bili-http-api";

function checkResponseCode<T>(resp: Response<T>) {
  if (resp.code !== 0)
    throw new BiliHttpApiError(resp.message, resp.code, resp.data ?? {});
}

// class Account {
//   constructor(private cookie: string) {}
// }

const videoApiCachePool: Map<string, VideoInfo> = new Map(); // bvid -> VideoInfo
const userCardCachePool: Map<number, UserCard> = new Map(); // mid -> UserCard
const userInfoCachePool: Map<number, UserInfo> = new Map(); // mid -> Userinfo

export default abstract class BiliHttpApi implements IBiliHttpApi {
  constructor() {}

  abstract getCookie(): string;

  // 账号类

  /**
   * 生成登录二维码
   * @returns
   */
  async generateLoginQrcode() {
    const resp = await request.get<
      Response<{ url: string; qrcode_key: string }>
    >("https://passport.bilibili.com/x/passport-login/web/qrcode/generate");

    checkResponseCode(resp.data);

    return resp.data.data;
  }

  /**
   * 根据二维码 key 获取 refresh_token 和 cookie
   * @param qrcode_key
   * @returns
   */
  async LoginByQrcodeKey(qrcode_key: string) {
    const resp = await request.get<
      Response<{
        url: string;
        refresh_token: string;
        timestamp: number;
        code: 0 | 86038 | 86090 | 86101;
      }>
    >(
      `https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=${qrcode_key}`
    );

    checkResponseCode(resp.data);

    let cookie: string | null = null;

    if (resp.data.data.code === 0) {
      if (
        resp.headers["set-cookie"] &&
        Array.isArray(resp.headers["set-cookie"])
      ) {
        cookie = BiliUtils.parseCookies(resp.headers["set-cookie"]);
      } else {
        throw new Error("获取 set-cookie 失败");
      }
    }

    return { ...resp.data.data, cookie };
  }

  /**
   * 检查 cookie 是否过期
   * @returns
   */
  async checkCookie() {
    const csrf = BiliUtils.getCSRF(this.getCookie());
    const resp = await request.get<{
      code: 0 | -101;
      message: string;
      data: { refresh: boolean; timestamp: number };
    }>(
      `https://passport.bilibili.com/x/passport-login/web/cookie/info?csrf=${csrf}`,
      {
        headers: { cookie: this.getCookie() },
      }
    );

    checkResponseCode(resp.data);

    return resp.data;
  }

  /**
   * 更新账号 cookie
   * @param refresh_token
   * @returns 新的 refresh_token 和 cookie
   */
  async refreshCookie(refresh_token: string) {
    const timestamp = Date.now();
    const csrf = BiliUtils.getCSRF(this.getCookie());

    const publicKey = await crypto.subtle.importKey(
      "jwk",
      {
        kty: "RSA",
        n: "y4HdjgJHBlbaBN04VERG4qNBIFHP6a3GozCl75AihQloSWCXC5HDNgyinEnhaQ_4-gaMud_GF50elYXLlCToR9se9Z8z433U3KjM-3Yx7ptKkmQNAMggQwAVKgq3zYAoidNEWuxpkY_mAitTSRLnsJW-NCTa0bqBFF6Wm1MxgfE",
        e: "AQAB",
      },
      { name: "RSA-OAEP", hash: "SHA-256" },
      true,
      ["encrypt"]
    );

    async function getCorrespondPath(timestamp: number) {
      const data = new TextEncoder().encode(`refresh_${timestamp}`);
      const encrypted = new Uint8Array(
        await crypto.subtle.encrypt({ name: "RSA-OAEP" }, publicKey, data)
      );
      return encrypted.reduce(
        (str, c) => str + c.toString(16).padStart(2, "0"),
        ""
      );
    }

    const correspondPath = await getCorrespondPath(timestamp);

    const { data: html } = await request.get<string>(
      `https://www.bilibili.com/correspond/1/${correspondPath}`,
      {
        headers: {
          cookie: this.getCookie(),
        },
      }
    );

    const regex = /<div id="1-name">(.*?)<\/div>/;
    const match = html.match(regex);

    if (!match || !match[1]) {
      throw new BiliHttpApiError("获取 refresh_csrf 失败");
    }

    const refresh_csrf = match[1];

    const resp = await request.post<
      Response<{ status: number; message: string; refresh_token: string }>
    >(
      `https://passport.bilibili.com/x/passport-login/web/cookie/refresh?csrf=${csrf}&refresh_csrf=${refresh_csrf}&source=main_web&refresh_token=${refresh_token}`,
      {
        method: "POST",
        headers: {
          cookie: this.getCookie(),
        },
      }
    );

    if (resp.data.code === -101) {
      throw new AccountLoginExpiredError(resp.data.message);
    }

    checkResponseCode(resp.data);

    if (
      resp.headers["set-cookie"] &&
      Array.isArray(resp.headers["set-cookie"])
    ) {
      const new_refresh_token = resp.data.data.refresh_token;
      const newCookie = BiliUtils.parseCookies(resp.headers["set-cookie"]);

      await request.post(
        `https://passport.bilibili.com/x/passport-login/web/confirm/refresh?csrf=${csrf}&refresh_token=${refresh_token}`,
        {
          headers: {
            cookie: newCookie,
          },
        }
      );

      return {
        cookie: newCookie,
        refresh_token: new_refresh_token,
      };
    } else {
      throw new BiliHttpApiError("获取 cookie 失败");
    }
  }

  // 直播类
  async getLiveRoomInfo(roomId: string | number, noRetry = false) {
    const resp = await request.get<Response<LiveRoomInfo>>(
      `https://api.live.bilibili.com/room/v1/Room/get_info?room_id=${roomId}`,
      {
        headers: {
          Referer: "https://live.bilibili.com/",
          cookie: this.getCookie(),
          "No-Retry": noRetry,
        },
      }
    );

    checkResponseCode(resp.data);

    return resp.data.data;
  }

  async getLiveStreamUrl(roomId: string | number) {
    const resp = await request.get<Response<LiveRoomPlayInfo>>(
      `https://api.live.bilibili.com/room/v1/Room/playUrl?cid=${roomId}&qn=0&platform=web`,
      {
        headers: {
          Referer: "https://live.bilibili.com/",
          cookie: this.getCookie(),
        },
        shouldRetry: (resp) => resp.data.code === 19001012, // bvc-play-url-one
      }
    );

    checkResponseCode(resp.data);

    if (!resp.data.data.durl || resp.data.data.durl.length === 0)
      throw new Error("durl not found");
    const urls = resp.data.data.durl
      .map((item) => item?.url)
      .filter((url) => url !== undefined);
    return urls;
  }

  async getDMConfigByGroup(roomId: string | number) {
    const resp = await request.get<Response<any>>(
      `https://api.live.bilibili.com/xlive/web-room/v1/dM/GetDMConfigByGroup?${encWbi(
        {
          room_id: roomId,
        },
        await this.getAccountInfo()
      )}`,
      {
        headers: {
          cookie: this.getCookie(),
        },
      }
    );

    checkResponseCode(resp.data);

    return resp.data.data;
  }

  async getDanmuInfo(roomId: string | number) {
    const resp = await request.get<Response<DanmuInfo>>(
      `https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?${encWbi(
        { id: roomId },
        await this.getAccountInfo()
      )}`,
      {
        headers: {
          cookie: this.getCookie(),
        },
      }
    );

    checkResponseCode(resp.data);

    return resp.data.data;
  }

  // room_id 似乎没用
  async getLiveRoomContributionRank(
    uid: string | number,
    room_id: string | number = 1,
    page = 1,
    page_size = 1
  ) {
    const resp = await request.get<Response<any>>(
      `https://api.live.bilibili.com/xlive/general-interface/v1/rank/queryContributionRank?ruid=${uid}&room_id=${room_id}&page=${page}&page_size=${page_size}&type=online_rank`,
      {
        headers: {
          Referer: "https://live.bilibili.com/",
        },
      }
    );

    checkResponseCode(resp.data);

    return resp.data.data;
  }

  // 视频类
  async getVideoInfo(bvid: string, useCache = true) {
    // 使用 Cache Pool
    if (useCache) {
      const cache = videoApiCachePool.get(bvid);
      if (cache) return cache;
    }

    const resp = await request.get<Response<VideoInfo>>(
      `https://api.bilibili.com/x/web-interface/wbi/view?bvid=${bvid}`,
      {
        headers: {
          Referer: "https://live.bilibili.com/",
          cookie: this.getCookie(),
        },
      }
    );

    checkResponseCode(resp.data);

    // 更新 Cache
    videoApiCachePool.set(bvid, resp.data.data);
    return resp.data.data;
  }

  // 用户类

  /**
   * 根据 cookie 获取当前用户信息
   * @returns
   */
  async getAccountInfo() {
    const resp = await request.get<Response<LoginInfo>>(
      "https://api.bilibili.com/x/web-interface/nav",
      {
        headers: { cookie: this.getCookie() },
      }
    );

    checkResponseCode(resp.data);

    return resp.data.data;
  }

  async getUserCard(mid: number, useCache = true) {
    // 使用 Cache Pool
    if (useCache) {
      const cache = userCardCachePool.get(mid);
      if (cache) return cache;
    }

    const resp = await request.get<Response<UserCard>>(
      `https://api.bilibili.com/x/web-interface/card?mid=${mid}`,
      {
        headers: { cookie: this.getCookie() },
      }
    );

    checkResponseCode(resp.data);

    userCardCachePool.set(mid, resp.data.data);
    return resp.data.data;
  }

  async getUserInfo(mid: number, useCache = true) {
    // 使用 Cache Pool
    if (useCache) {
      const cache = userInfoCachePool.get(mid);
      if (cache) return cache;
    }

    const url = `https://api.bilibili.com/x/space/wbi/acc/info?${encWbi(
      { mid },
      await this.getAccountInfo()
    )}`;

    const resp = await request.get<Response<UserInfo>>(url, {
      headers: { cookie: this.getCookie() },
    });

    checkResponseCode(resp.data);

    userInfoCachePool.set(mid, resp.data.data);
    return resp.data.data;
  }

  // 动态类
  async getSpaceDynamic(uid: number, noRetry = false) {
    const resp = await request.get<Response<SpaceDynamic>>(
      `https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space?host_mid=${uid}`,
      {
        headers: { cookie: this.getCookie(), "No-Retry": noRetry },
      }
    );

    checkResponseCode(resp.data);

    return resp.data;
  }

  async getDynamicDetail(dynamicId: number) {
    const resp = await request.get<Response<DynamicDetail>>(
      `https://api.vc.bilibili.com/dynamic_svr/v1/dynamic_svr/get_dynamic_detail?dynamic_id=${dynamicId}`,
      {
        headers: { cookie: this.getCookie() },
      }
    );

    checkResponseCode(resp.data);

    return resp.data;
  }

  // 投稿类

  async preuploadVideo(options: { fileName: string; fileSize: number }) {
    const resp = await request.get<{
      OK: number;
      auth: string;
      biz_id: number;
      chunk_retry: number;
      chunk_retry_delay: number;
      chunk_size: number;
      endpoint: string;
      endpoints: string[];
      expose_params: null;
      put_query: string;
      threads: number;
      timeout: number;
      uip: string;
      upos_uri: string;
    }>(
      `https://member.bilibili.com/preupload?probe_version=20250923&name=${options.fileName}&upcdn=tx&zone=cs&r=upos&ssl=0&profile=ugcfx%2Fbup&ssl=0&size=${options.fileSize}&version=2.14.0.0&build=2140000`,
      {
        headers: {
          Referer: "https://member.bilibili.com/platform/upload/video/frame",
          cookie: this.getCookie(),
        },
      }
    );

    if (resp.data.OK !== 1) throw new UploadVideoError("获取上传元数据失败");

    return resp.data;
  }

  async getUploadID(options: {
    uploadUrl: string;
    fileSize: number;
    partSize: number;
    bizId: number;
    auth: string;
  }) {
    const resp = await request.post<{
      OK: number;
      bucket: string;
      key: string;
      upload_id: string;
    }>(
      `${options.uploadUrl}?uploads&output=json&profile=ugcfx%2Fbup&filesize=${options.fileSize}&partsize=${options.partSize}&biz_id=${options.bizId}`,
      {
        method: "POST",
        headers: {
          Origin: "https://member.bilibili.com",
          Referer: "https://member.bilibili.com/",
          "X-Upos-Auth": options.auth,
          cookie: this.getCookie(),
        },
      }
    );

    if (resp.data.OK !== 1) throw new UploadVideoError("获取上传 ID 失败");
    return resp.data;
  }

  async validateVideo(options: {
    uploadUrl: string;
    fileName: string;
    auth: string;
    bizId: number;
    uploadId: string;
  }) {
    const resp = await request.post<{
      OK: number;
      location: string;
      bucket: string;
      key: string;
    }>(
      `${options.uploadUrl}?output=json&name=${options.fileName}&profile=ugcfx%2Fbup&uploadId=${options.uploadId}&biz_id=${options.bizId}`,
      {
        method: "POST",
        headers: {
          Origin: "https://member.bilibili.com",
          Referer: "https://member.bilibili.com/",
          "X-Upos-Auth": options.auth,
          Cookie: this.getCookie(),
        },
      }
    );

    if (resp.data.OK !== 1) throw new UploadVideoError("视频合片失败");
    return resp.data;
  }

  async uploadCover(cover: string) {
    const csrf = BiliUtils.getCSRF(this.getCookie());

    const resp = await request.instance<{
      code: number;
      message: string;
      ttl: number;
      data: { url: string };
    }>(`https://member.bilibili.com/x/vu/web/cover/up`, {
      method: "POST",
      headers: {
        Origin: "https://member.bilibili.com",
        Referer: "https://member.bilibili.com/",
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: this.getCookie(),
      },
      data: {
        csrf,
        cover: cover,
      },
    });

    if (resp.data.code !== 0) throw new UploadVideoError(resp.data.message);

    return resp.data.data;
  }

  async uploadChunk(options: {
    filePath: string;
    fileSize?: number;
    auth: string;
    uploadId: string;
    chunkIndex: number;
    chunkSize: number;
    uploadUrl: string;
    totalChunks: number;
    onUploadProgress?: (progressEvent: AxiosProgressEvent) => void;
  }) {
    const {
      filePath,
      auth,
      uploadId,
      chunkIndex,
      chunkSize: _chunkSize,
      uploadUrl,
      totalChunks,
    } = options;
    let { fileSize } = options;
    fileSize = fileSize || fs.statSync(filePath).size;

    const start = chunkIndex * _chunkSize;
    const end = Math.min(start + _chunkSize, fileSize);
    const actualChunkSize = end - start; // 实际分片大小

    // 构建参数
    const params = new URLSearchParams({
      partNumber: `${chunkIndex + 1}`,
      uploadId,
      chunk: `${chunkIndex}`,
      chunks: `${totalChunks}`,
      size: `${actualChunkSize}`,
      start: `${start}`,
      end: `${end}`,
      total: `${fileSize}`,
      output: "json",
    });

    try {
      const resp = await request.put<{ OK: number; title: string }>(
        `${uploadUrl}?${params.toString()}`,
        {
          headers: {
            Origin: "https://member.bilibili.com",
            Referer: "https://member.bilibili.com",
            Connection: "keep-alive",
            "Content-Type": "application/octet-stream",
            "Content-Length": actualChunkSize.toString(),
            "X-Upos-Auth": auth,
            "No-Throttleo": "1",
          },
          timeout: 10000,
          onUploadProgress: options.onUploadProgress,
        },
        () =>
          fs.createReadStream(filePath, {
            start,
            end: end - 1,
            highWaterMark: 64 * 1024,
          })
      );

      return resp.data;
    } catch (e: any) {
      const err = e as AxiosError;
      throw new BiliHttpApiError(
        err.message,
        err.response?.status,
        err.response?.data
      );
    }
  }

  async uploadVideo(data: any) {
    const csrf = BiliUtils.getCSRF(this.getCookie());

    const resp = await request.instance<
      Response<{ aid: number; bvid: string }>
    >(`https://member.bilibili.com/x/vu/web/add/v3?csrf=${csrf}`, {
      method: "POST",
      headers: {
        Origin: "https://member.bilibili.com",
        Referer: "https://member.bilibili.com/",
        "Content-Type": "application/json",
        Cookie: this.getCookie(),
      },
      data: {
        csrf,
        ...data,
      },
    });

    if (resp.data.code !== 0) throw new UploadVideoError(resp.data.message);

    return resp.data.data;
  }

  async getRecommendTags(options: {
    upload_id?: string;
    subtype_id?: string;
    title?: string;
    filename?: string;
    description?: string;
    cover_url?: string;
  }) {
    const params = new URLSearchParams(options);
    const resp = await request.get<
      Response<{ tag: string; checked: number; request_id: string }[]>
    >(
      `https://member.bilibili.com/x/vupre/web/tag/recommend?${params.toString()}`,
      {
        headers: {
          cookie: this.getCookie(),
        },
      }
    );

    checkResponseCode(resp.data);

    return resp.data.data;
  }

  async addSeason(options: { title: string; desc: string; cover?: string }) {
    const csrf = BiliUtils.getCSRF(this.getCookie());
    const resp = await request.post<Response<number>>(
      `https://member.bilibili.com/x2/creative/web/season/add`,
      {
        headers: {
          Origin: "https://member.bilibili.com",
          Referer: "https://member.bilibili.com",
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: this.getCookie(),
        },
      },
      {
        title: options.title,
        desc: options.desc,
        cover:
          options.cover ||
          "https://s1.hdslb.com/bfs/templar/york-static/viedeo_material_default.png",
        season_price: 0,
        csrf,
      }
    );

    if (resp.data.code !== 0)
      new BiliHttpApiError(resp.data.message, resp.data.code, resp.data);

    return resp.data;
  }

  async addSeasonEpisodes(options: {
    episodes: { aid: number; cid: number; title: string }[];
    sectionId: number;
  }) {
    const csrf = BiliUtils.getCSRF(this.getCookie());
    const resp = await request.post<{
      code: number;
      message: string;
      ttl: number;
    }>(
      `https://member.bilibili.com/x2/creative/web/season/section/episodes/add?csrf=${csrf}`,
      {
        headers: {
          Origin: "https://member.bilibili.com",
          Referer: "https://member.bilibili.com",
          "Content-Type": "application/json",
          Cookie: this.getCookie(),
        },
      },
      {
        episodes: options.episodes,
        sectionId: options.sectionId,
      }
    );

    if (resp.data.code !== 0)
      new BiliHttpApiError(resp.data.message, resp.data.code, resp.data);

    return resp.data;
  }

  async getSeasons(options: { page: number; pageNumber: number }) {
    const resp = await request.get<
      Response<{
        seasons: {
          season: {
            id: number;
            title: string;
            desc: string;
            cover: string;
            isEnd: number;
            mid: number;
            isAct: number;
            is_pay: number;
            state: number;
            partState: number;
            signState: number;
            rejectReason: string;
            ctime: number;
            mtime: number;
            no_section: 1;
            forbid: number;
            protocol_id: string;
            ep_num: number;
            season_price: number;
            is_opened: number;
            has_charging_pay: number;
            has_pugv_pay: number;
            SeasonUpfrom: number;
          };
          course: null;
          checkin: {
            status: number;
            status_reason: string;
            season_status: number;
          };
          seasonStat: {
            view: number;
            danmaku: number;
            reply: number;
            fav: number;
            coin: number;
            share: number;
            nowRank: number;
            hisRank: number;
            like: number;
            subscription: number;
            vt: number;
          };
          sections: {
            sections: {
              id: number;
              type: number;
              seasonId: number;
              title: string;
              order: number;
              state: number;
              partState: number;
              rejectReason: string;
              ctime: number;
              mtime: number;
              epCount: number;
              cover: string;
              has_charging_pay: number;
              Episodes: null;
              show: number;
              has_pugv_pay: number;
            }[];
          };
          part_episodes: {
            id: number;
            title: string;
            aid: number;
            bvid: string;
            cid: number;
            seasonId: number;
            sectionId: number;
            order: number;
            videoTitle: string;
            archiveTitle: string;
            archiveState: number;
            rejectReason: string;
            state: number;
            cover: string;
            is_free: number;
            aid_owner: boolean;
            charging_pay: number;
            member_first: number;
            pugv_pay: number;
            limited_free: boolean;
          }[];
        }[];
        tip: {
          title: string;
          url: string;
        };
        total: number;
        play_type: number;
      }>
    >(
      `https://member.bilibili.com/x2/creative/web/seasons?pn=${options.page}&ps=${options.pageNumber}`,
      {
        headers: {
          Origin: "https://member.bilibili.com",
          Referer: "https://member.bilibili.com",
          "Content-Type": "application/json",
          Cookie: this.getCookie(),
        },
      }
    );

    if (resp.data.code !== 0)
      new BiliHttpApiError(resp.data.message, resp.data.code, resp.data);

    return resp.data.data;
  }
}

// 签名

function encWbi(params: Record<string, any>, loginInfo: LoginInfo) {
  const mixinKeyEncTab = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
    33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
    61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
    36, 20, 34, 44, 52,
  ];

  // 对 imgKey 和 subKey 进行字符顺序打乱编码
  const getMixinKey = (orig: string) =>
    mixinKeyEncTab
      .map((n) => orig[n])
      .join("")
      .slice(0, 32);

  // 获取最新的 img_key 和 sub_key
  const getWbiKeys = () => {
    const {
      wbi_img: { img_url, sub_url },
    } = loginInfo;

    return {
      img_key: img_url.slice(
        img_url.lastIndexOf("/") + 1,
        img_url.lastIndexOf(".")
      ),
      sub_key: sub_url.slice(
        sub_url.lastIndexOf("/") + 1,
        sub_url.lastIndexOf(".")
      ),
    };
  };

  // 为请求参数进行 wbi 签名
  const encWbi = (
    params: Record<string, any>,
    img_key: string,
    sub_key: string
  ) => {
    const mixin_key = getMixinKey(img_key + sub_key),
      curr_time = Math.round(Date.now() / 1000),
      chr_filter = /[!'()*]/g;

    Object.assign(params, { wts: curr_time }); // 添加 wts 字段
    // 按照 key 重排参数
    const query = Object.keys(params)
      .sort()
      .map((key) => {
        // 过滤 value 中的 "!'()*" 字符
        const value = params[key].toString().replace(chr_filter, "");
        return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
      })
      .join("&");

    const wbi_sign = crypto
      .createHash("md5")
      .update(query + mixin_key)
      .digest("hex"); // 计算 w_rid

    return query + "&w_rid=" + wbi_sign;
  };

  const web_keys = getWbiKeys();
  const img_key = web_keys.img_key,
    sub_key = web_keys.sub_key;
  const query = encWbi(params, img_key, sub_key);

  return query;
}
