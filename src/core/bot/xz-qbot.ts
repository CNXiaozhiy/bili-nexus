import { WebSocket } from "ws";
import { v4 as uuid } from "uuid";
import EventEmitter from "events";
import * as OneBot from "@/types/one-bot";
import getLogger from "@/utils/logger";
import WebsocketUtils from "@/utils/websocket";

const logger = getLogger("XzQbot");

export type ReplyFunction<T> = (
  message: OneBot.Messages,
  options?: {
    at?: boolean;
    reference?: boolean;
  }
) => Promise<T>;

const NETWORK_LATENCY_TOLERANCE = 5 * 1000; // 网络延迟容忍度 5s

export interface XzQbotEvents {
  event: [data: { e: OneBot.Events }];
  message: [
    e: OneBot.MessageEvent,
    reply: ReplyFunction<
      | OneBot.ActionOkResponse<"send_group_msg">
      | OneBot.ActionOkResponse<"send_private_msg">
    >
  ];
  group_message: [
    e: OneBot.GroupMessageEvent | OneBot.GroupMessageSentEvent,
    reply: ReplyFunction<OneBot.ActionOkResponse<"send_group_msg">>
  ];
  private_message: [
    e: OneBot.PrivateMessageEvent | OneBot.PrivateMessageSentEvent,
    reply: ReplyFunction<OneBot.ActionOkResponse<"send_private_msg">>
  ];
  group_recall: [
    e: OneBot.GroupMessageRecallNoticeEvent,
    message_id: OneBot.MessageID
  ];
}

export class AbsXzQbot extends EventEmitter<XzQbotEvents> {
  protected wsUrl: string;
  protected ws: WebSocket;
  protected connectionPromise: Promise<void> | null = null;

  protected heartbeatTimeout: NodeJS.Timeout | null = null; // 心跳超时

  protected selfId: number = 0;

  constructor(wsUrl: string) {
    super();
    this.wsUrl = wsUrl;
    this.ws = new WebSocket(wsUrl);
    this.ws.setMaxListeners(Infinity);
    this.installListener(this.ws);
  }

  reconnectWebsocket() {
    this.ws?.removeAllListeners();
    this.ws = new WebSocket(this.wsUrl);
    this.ws.setMaxListeners(Infinity);
    this.installListener(this.ws);
  }

  async connect() {
    if (!this.connectionPromise) {
      this.connectionPromise = new Promise((resolve, reject) => {
        if (this.ws.readyState === WebSocket.OPEN) {
          resolve();
        } else {
          this.ws.on("open", resolve);
          this.ws.on("error", reject);
        }
      });
    }
    return this.connectionPromise;
  }

  private installListener(ws: WebSocket) {
    ws.on("close", (code) => {
      this._clearHeartbeatTimeout();
      logger.warn(
        "[XzQbot Websocket]",
        "连接断开，将在 30s 后尝试重新连接, Code:",
        code
      );
      setTimeout(() => this.reconnectWebsocket(), 30 * 1000);
    });
    ws.on("error", (err) => {
      this._clearHeartbeatTimeout();
      logger.error(
        "[XzQbot Websocket]",
        "连接发生错误，将在 30s 后尝试重新连接",
        err
      );
      setTimeout(() => this.reconnectWebsocket(), 30 * 1000);
    });

    const chooseHandler = (e: OneBot.Events) => {
      // logger.debug(JSON.stringify(e));

      if (!e.post_type) {
        // logger.warn("[XzQbot Websocket]", "未定义的消息", e);
        return;
      }
      if (e.post_type === "relay-welcome") this._xzQBotGroupRelayHandler(e);
      else if (e.post_type === "relay-warning")
        this._xzQBotGroupRelayHandler(e);
      else if (e.post_type === "message") this._messageHandler(e);
      else if (e.post_type === "message_sent") this._messageHandler(e);
      else if (e.post_type === "notice") this._notifyHandler(e);
      else if (e.post_type === "meta_event") this._metaEventHandler(e);
      else if (e.post_type === "request") this._requestHandler(e);
      else {
        logger.warn("未订阅的 postType ->", (e as any).post_type);
        return;
      }
    };

    WebsocketUtils.createWsListener<OneBot.Events>(ws, "message", (e) =>
      chooseHandler(e)
    );

    // 默认 60s 心跳 （不可超过 60s)
    this._setNextHeartbeatTimeout(60 * 1000 + NETWORK_LATENCY_TOLERANCE);
  }

  private _xzQBotGroupRelayHandler(e: OneBot.RelayEvent) {
    logger.info("[XzQBot Group Relay]", e.message);
  }

  private _messageHandler(e: OneBot.MessageEvent | OneBot.MessageSentEvent) {
    const formatMessage = (
      message: OneBot.Messages,
      at?: boolean,
      reference?: boolean
    ): OneBot.SegmentMessages => {
      let segmentMessages: OneBot.SegmentMessages;
      if (typeof message === "string") {
        segmentMessages = [this._textToSegmentMessage(message)];
      } else {
        segmentMessages = message;
      }
      if (reference)
        segmentMessages.unshift({ type: "reply", data: { id: e.message_id } });
      if (at)
        segmentMessages.unshift({ type: "at", data: { qq: e.sender.user_id } });
      return segmentMessages;
    };
    if (e.message_type === "group") {
      const reply: ReplyFunction<OneBot.ActionOkResponse<"send_group_msg">> = (
        message,
        options
      ) =>
        this._action({
          action: "send_group_msg",
          params: {
            group_id: e.group_id,
            message: formatMessage(message, options?.at, options?.reference),
          },
        });
      this.emit("group_message", e, reply);
    } else if (e.message_type === "private") {
      const reply: ReplyFunction<
        OneBot.ActionOkResponse<"send_private_msg">
      > = (message, options) =>
        this._action({
          action: "send_private_msg",
          params: {
            user_id: e.user_id,
            message: formatMessage(message, options?.at, options?.reference),
          },
        });
      this.emit("private_message", e, reply);
    }
  }

  private _textToSegmentMessage(str: string): OneBot.SegmentMessage {
    return {
      type: "text",
      data: {
        text: str,
      },
    };
  }

  private _notifyHandler(e: OneBot.NoticeEvent) {
    if (e.notice_type === "group_recall") {
      // this.getMsg()
      //   .then((resp) => {
      //     this.emit("group_recall", e, resp.data.message);
      //   })
      //   .catch((e) => logger.error(e));

      this.emit("group_recall", e, e.message_id);
    }
  }

  private _metaEventHandler(e: OneBot.MetaEvent) {
    if (!this.selfId) this.selfId = e.self_id;
    if (e.meta_event_type === "heartbeat") {
      // logger.debug("收到心跳, interval ->", e.interval);
      if (this.heartbeatTimeout) this._clearHeartbeatTimeout();
      this._setNextHeartbeatTimeout(e.interval + NETWORK_LATENCY_TOLERANCE);
    }
  }

  private _requestHandler(e: OneBot.RequestEvent) {}

  private _clearHeartbeatTimeout() {
    if (this.heartbeatTimeout) {
      // logger.debug("清除心跳超时计时器");
      clearTimeout(this.heartbeatTimeout);
      this.heartbeatTimeout = null;
    }
  }

  /**
   * 设置下次心跳超时
   * @param interval 检查间隔
   */
  private _setNextHeartbeatTimeout(interval: number) {
    // logger.debug("设置下次心跳超时", new Date(Date.now() + interval));
    this.heartbeatTimeout = setTimeout(
      () => this._heartbeatTimeout(),
      interval
    );
  }

  /**
   * 机器人心跳超时
   */
  private _heartbeatTimeout() {
    logger.warn("[XzQbot Websocket]", "心跳超时, 尝试重连...");
    this.ws.close();
  }

  private __send(data: OneBot.ActionPayload<OneBot.Actions>): void {
    this.ws.send(JSON.stringify(data));
  }

  private _send<A extends OneBot.Actions>(
    params: OneBot.ActionPayload<A>
  ): Promise<OneBot.ActionOkResponse<A>> {
    if (!this.connect()) return Promise.reject("Websocket not connected");

    const echo = uuid();
    this.__send({ ...params, echo });

    return new Promise((resolve, reject) => {
      WebsocketUtils.createWsListener(this.ws, "message", (data, uninstall) => {
        if (data.echo !== echo) return;
        delete data.echo;

        uninstall();
        if (data.status !== "ok") {
          reject(data.message);
          return;
        }
        resolve(data);
      });
    });
  }

  /**
   * 内部方法
   * @param params ActionPayload
   * @returns
   */
  public _action = this._send;

  public getQID() {
    return this.selfId;
  }
}

export default class XzQBot extends AbsXzQbot {
  getLoginInfo() {
    return this._action({ action: "get_login_info", params: null });
  }

  setQQProfile(params: OneBot.ActionMap["set_qq_profile"]["params"]) {
    return this._action({ action: "set_qq_profile", params });
  }

  getQidianAccountInfo() {
    return this._action({ action: "qidian_get_account_info", params: null });
  }

  sendGroup(group_id: number, message: OneBot.SegmentMessages) {
    return this._action({
      action: "send_group_msg",
      params: { group_id, message },
    });
  }

  sendPrivate(user_id: number, message: OneBot.SegmentMessages) {
    return this._action({
      action: "send_private_msg",
      params: { user_id, message },
    });
  }

  getMsg(message_id: OneBot.MessageID) {
    return this._action({ action: "get_msg", params: { message_id } });
  }

  getImage(file: string) {
    return this._action({ action: "get_image", params: { file } });
  }

  getGroupMemberInfo(group_id: number, user_id: number) {
    return this._action({
      action: "get_group_member_info",
      params: { group_id, user_id },
    });
  }
}
