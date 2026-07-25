import EventEmitter from "events";
import { BiliAccount } from "../bili-account";
import getLogger from "@/utils/logger";
import { AuditAegisState, AuditState, OpenState, VideoDetailAudit, VideoDetailXcode, XcodeState } from "@/types/bilibili";

export default class VideoTracker extends EventEmitter<{
  auditStateChange: [AuditState: AuditState, lastAuditState: AuditState | null, detail: VideoDetailAudit];
  auditAegisStateChange: [AegisState: AuditAegisState, lastAegisState: AuditAegisState | null, detail: VideoDetailAudit];
  openStateChange: [OpenState: OpenState, lastOpenState: OpenState | null];
}> {
  private logger;
  private biliApi;
  private _running = false;

  private lastAegisState: AuditAegisState | null = null;
  private lastAuditState: AuditState | null = null; // 主要状态
  private lastOpenState: OpenState | null = null;

  constructor(private readonly name: string, private readonly biliAccount: BiliAccount, private readonly bvid: string) {
    super();
    this.logger = getLogger("VideoTracker." + this.name);
    this.biliApi = biliAccount.getBiliApi();
  }

  start() {
    this.logger.info("开始跟踪视频:", this.bvid);
    this._running = true;
    this.pool();
  }

  stop() {
    this._running = false;
    this.logger;
  }

  private async pool() {
    if (!this._running) return;

    try {
      const auditDetail = await this.biliApi.getVideoDetailAudit(this.bvid);
      if (this.lastAegisState !== auditDetail.aegis_state) {
        // 状态变化
        this.logger.debug(`aegis_state 变化: ${this.lastAegisState} -> ${auditDetail.aegis_state}`, auditDetail);

        this.emit("auditAegisStateChange", auditDetail.aegis_state, this.lastAegisState, auditDetail);

        this.lastAegisState = auditDetail.aegis_state;
      }

      if (this.lastAuditState !== auditDetail.state) {
        // 状态变化
        this.logger.debug(`state 变化: ${this.lastAuditState} -> ${auditDetail.state}`, auditDetail);

        this.emit("auditStateChange", auditDetail.state, this.lastAuditState, auditDetail);

        this.lastAuditState = auditDetail.state;
      }

      const archiveDetail = await this.biliApi.getVideoDetailArchive(this.bvid);
      if (this.lastOpenState !== archiveDetail.open_state) {
        // 状态变化
        this.logger.debug(`open_state 变化: ${this.lastOpenState} -> ${archiveDetail.open_state}`, archiveDetail);

        this.emit("openStateChange", archiveDetail.open_state, this.lastOpenState);

        this.lastOpenState = archiveDetail.open_state;
      }
    } catch (error) {
      this.logger.error("跟踪视频失败:", error);
    } finally {
      setTimeout(() => this.pool(), 5000);
    }
  }

  async getXcodeState() {
    const videos = (await this.biliApi.getVideos(this.bvid)).videos;
    const resp: VideoDetailXcode[] = [];

    for (const video of videos) {
      resp.push(await this.biliApi.getVideoDetailXcode(this.bvid, video.cid));
    }

    return resp;
  }

  destroy() {
    this.stop();
    this.removeAllListeners();
  }
}
