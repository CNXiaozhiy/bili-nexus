import fs from "fs";
import path from "path";
import pLimit from "p-limit";
import getLogger from "@/utils/logger";
import EventEmitter from "events";
import BiliApi from "@/core/bilibili/bili-api";
import { BiliAccount } from "@/core/bilibili/bili-account";

export interface VideoInfo {
  title: string;
  cover: string; // url
  coverBase64?: string; // base64
  tid: number;
  tag: string;
  desc: string;
  season?: {
    sectionId?: number; // 合集小节ID
    seasonId?: number; // 合集ID
    name?: string; // 合集标题
    autoCreate?: {
      // 仅在使用name时有效
      cover?: string;
      desc?: string;
    };
  }; // 是否添加到合集
}

const logger = getLogger("VideoUploader");

export interface VideoUploaderOptions {
  videos: { filePath: string; title: string; desc: string }[];
  videoInfo: VideoInfo;
}

export interface Task {
  name: string;
  status: "success" | "pending" | "error";
  time: number;
  process: string;
  message: string;
  duration: number; //ms
}

interface DoneResponse {
  bizIds: number[];
  tasks: Task[][];
  aid: number;
  bvid: string;
  warnings: string[];
  duration: number;
}

export default class VideoUploader extends EventEmitter<{
  "task-update": [Task[][]];
  done: [DoneResponse];
}> {
  private status = 0;
  private duration = 0; // 总耗时
  private tasks: Task[][] = []; // 0 视频为主投稿，自 1 开始

  private readonly biliApi: BiliApi;

  constructor(
    private readonly name: string,
    private readonly biliAccount: BiliAccount,
    private readonly options: VideoUploaderOptions
  ) {
    super();
    this.biliApi = biliAccount.getBiliApi();
  }

  public async upload(): Promise<DoneResponse> {
    const startTime = Date.now();

    // 基础数据
    const { videoInfo } = this.options;
    this.tasks = Array.from(
      { length: this.options.videos.length + 1 },
      () => []
    );

    const warnings: string[] = [];

    const biliFileNames: string[] = [];
    const bizIds: number[] = []; // cids

    interface TaskActions {
      success(message?: string): void;
      error(message?: string): void;
      process(process: string): void;
    }

    const pushTask = (name: string, videoIndex?: number): TaskActions => {
      const cVideoTasks = this.tasks[videoIndex || iVideo];
      const taskIndex =
        cVideoTasks.push({
          name,
          status: "pending",
          time: Date.now(),
          process: "",
          message: "",
          duration: 0,
        }) - 1;
      const cVideoTask = cVideoTasks[taskIndex];

      this.emit("task-update", this.getTasks());

      return {
        success: (message?: string) => {
          cVideoTask.status = "success";
          cVideoTask.message = message || "";
          cVideoTask.duration = Date.now() - cVideoTask.time;
          this.emit("task-update", this.getTasks());
        },
        error: (message?: string) => {
          cVideoTask.status = "error";
          cVideoTask.message = message || "";
          cVideoTask.duration = Date.now() - cVideoTask.time;
          this.emit("task-update", this.getTasks());
        },
        process: (process: string) => {
          cVideoTask.process = process;
          this.emit("task-update", this.getTasks());
        },
      };
    };

    let iVideo = 0;
    let task: TaskActions = pushTask("准备投稿");

    task.success();

    try {
      //
      iVideo = 1;
      for (const video of this.options.videos) {
        const { filePath } = video;
        const fileName = path.basename(video.filePath);
        const fileSize = fs.statSync(video.filePath).size;

        task = pushTask("预上传");

        const preuploadResp = await this.biliApi.preuploadVideo({
          fileName,
          fileSize,
        });

        task.success();

        logger.info(`投稿器[${this.name}] -> 视频[${iVideo}] 预上传完成`);

        // 整理信息
        const {
          auth,
          endpoints,
          biz_id: bizId,
          chunk_retry,
          chunk_retry_delay,
          chunk_size,
          threads,
          timeout,
          upos_uri,
        } = preuploadResp;

        const chunkSize = Math.ceil(chunk_size / 2);

        const totalChunks = Math.ceil(fileSize / chunkSize);

        const uposUri = upos_uri.replace("upos://", "");
        const endpoint = endpoints[endpoints.length - 1];
        logger.debug(`使用 endpoint -> ${endpoint}`);
        const uploadUrl = `https:${endpoint}/${uposUri}`;
        const biliFileName = path.parse(uposUri).name;

        task = pushTask("获取上传元数据");

        const { upload_id: uploadId } = await this.biliApi.getUploadID({
          uploadUrl,
          fileSize,
          partSize: chunkSize,
          bizId,
          auth,
        });

        task.success();

        logger.info(
          `投稿器[${this.name}] -> 视频[${iVideo}] 获取上传元数据完成`
        );

        task = pushTask("视频上传");
        task.process(`0/${totalChunks}`);

        const limit = pLimit(threads + 1);
        const uploadChunkTasks = [];

        for (let i = 0; i < totalChunks; i++) {
          uploadChunkTasks.push(
            limit(async () => {
              try {
                const resp = await this.biliApi.uploadChunk({
                  filePath,
                  fileSize,
                  auth,
                  uploadId,
                  chunkIndex: i,
                  chunkSize,
                  uploadUrl,
                  totalChunks,
                  // onUploadProgress: (progressEvent) => {
                  //   const percent = progressEvent.total
                  //     ? Math.round(
                  //         (progressEvent.loaded * 100) / progressEvent.total
                  //       )
                  //     : 0;
                  //   logger.debug(
                  //     `投稿器[${this.name}] -> 视频[${iVideo}] 分片[${i}] 上传进度: ${percent}%`
                  //   );
                  // },
                });

                task.process(`${i + 1}/${totalChunks}`);

                // logger.info(
                //   `投稿器[${this.name}] -> 视频[${iVideo}] 分片[${
                //     i + 1
                //   }/${totalChunks}] 上传 ->`,
                //   resp
                // );
              } catch (e: any) {
                logger.error(
                  `投稿器[${this.name}] -> 视频[${iVideo}] 分片[${
                    i + 1
                  }/${totalChunks}] 上传失败 ->`,
                  e
                );
                return;
              }
            })
          );
        }

        await Promise.all(uploadChunkTasks);

        task.success();

        logger.info(`投稿器[${this.name}] -> 视频[${iVideo}] 视频上传完成`);

        task = pushTask("校验结果");

        const validateVideoResp = await this.biliApi.validateVideo({
          uploadUrl,
          fileName,
          auth,
          bizId,
          uploadId,
        });

        task.success();

        logger.info(`投稿器[${this.name}] -> 视频[${iVideo}] 校验结果完成`);

        biliFileNames.push(biliFileName);
        bizIds.push(bizId);

        iVideo++;
      }

      // 主投稿
      iVideo = 0;

      task = pushTask("上传封面");

      const coverUrl = videoInfo.coverBase64
        ? (await this.biliApi.uploadCover(videoInfo.coverBase64)).url
        : videoInfo.cover;

      task.success();

      logger.info(`投稿器[${this.name}] -> 视频 上传封面完成: ${coverUrl}`);

      task = pushTask("正式投稿");

      const resp = await this.biliApi.uploadVideo({
        cover: coverUrl,
        title: videoInfo.title,
        copyright: 1,
        tid: videoInfo.tid,
        tag: videoInfo.tag,
        desc_format_id: 0,
        desc: videoInfo.desc,
        recreate: -1,
        dynamic: "",
        interactive: 0,
        videos: this.options.videos.map((e, i) => {
          return {
            filename: biliFileNames[i],
            title: e.title,
            desc: e.desc,
            cid: bizIds[i],
          };
        }),
        act_reserve_create: 0,
        no_disturbance: 0,
        adorder_type: 9,
        no_reprint: 1,
        subtitle: {
          open: 0,
          lan: "",
        },
        dolby: 0,
        lossless_music: 0,
        up_selection_reply: false,
        up_close_reply: false,
        up_close_danmu: false,
        web_os: 1,
      });

      task.success();

      logger.info(`投稿器[${this.name}] -> 视频 投稿完成 ->`, resp);

      if (videoInfo.season) {
        task = pushTask("添加至合集");

        logger.info(`即将添加至合集 ->`, videoInfo.season);
        let seasonResp = await this.biliApi.getSeasons({
          page: 1,
          pageNumber: 30,
        });

        if (videoInfo.season && videoInfo.season.sectionId) {
          await this.addToSeason(videoInfo.season.sectionId, {
            aid: resp.aid,
            cid: bizIds[0],
            title: videoInfo.title,
          });
          logger.info(
            `已将视频添加至合集 -> ${videoInfo.season.sectionId}(sectionId)`
          );
          task.success();
        } else if (
          videoInfo.season &&
          (videoInfo.season.seasonId || videoInfo.season.name)
        ) {
          let season = seasonResp.seasons.find(
            videoInfo.season.seasonId
              ? (e) => e.season.id === videoInfo.season?.seasonId
              : (e) => e.season.title === videoInfo.season?.name
          );

          if (!season && videoInfo.season.name && videoInfo.season.autoCreate) {
            logger.info(`合集 ${videoInfo.season.name} 不存在, 开始自动创建`);
            const { data: seasonId } = await this.biliApi.addSeason({
              title: videoInfo.season.name,
              cover: videoInfo.season.autoCreate.cover,
              desc: videoInfo.season.autoCreate.desc || "",
            });
            logger.info(`合集创建成功, 合集ID:`, seasonId);

            // 重新获取
            seasonResp = await this.biliApi.getSeasons({
              page: 1,
              pageNumber: 30,
            });
            season = seasonResp.seasons.find((e) => e.season.id === seasonId);
          }

          if (!season) {
            logger.error(`添加至合集失败: 未找到合集, by ->`, videoInfo.season);
            warnings.push(
              `添加至合集失败: 未找到合集 ${JSON.stringify(videoInfo.season)}`
            );
          } else {
            const sectionId = season.sections.sections[0].id;
            logger.debug(
              `找到合集小节ID (sectionId) -> ${sectionId}, by ->`,
              videoInfo.season
            );
            await this.addToSeason(sectionId, {
              aid: resp.aid,
              cid: bizIds[0],
              title: videoInfo.title,
            });
            logger.info(`已将视频添加至合集 -> ${season.season.title}`);
            task.success();
          }
        }
      }

      this.duration = Date.now() - startTime;

      const res = {
        warnings,
        ...resp,
        bizIds,
        tasks: this.getTasks(),
        duration: this.duration,
      };

      this.emit("done", res);

      return res;
    } catch (e) {
      task.error((e as Error).message);
      throw e;
    }
  }

  private async addToSeason(
    sectionId: number,
    episode: { aid: number; cid: number; title: string }
  ) {
    const { aid, cid, title } = episode;
    const resp = await this.biliApi.addSeasonEpisodes({
      episodes: [
        {
          aid,
          cid,
          title,
        },
      ],
      sectionId,
    });
    return resp.code === 0;
  }

  public getStatus() {
    return this.status;
  }

  public getTasks() {
    return this.tasks;
  }
}
