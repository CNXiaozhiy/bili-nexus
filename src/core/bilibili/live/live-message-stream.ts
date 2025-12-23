import zlib from "zlib";
import { decompress } from "brotli";
import WebSocket, { EventEmitter } from "ws";
import { BiliAccount } from "@/core/bilibili/bili-account";
import getLogger from "@/utils/logger";

const logger = getLogger("LiveMessageStreamClient");

class LiveMessageStreamError extends Error {}
class ParsePacketError extends LiveMessageStreamError {}
class UnsupportedProtocolError extends LiveMessageStreamError {}

export interface CommandDataMap {
  ONLINE_RANK_COUNT: {
    data: {
      count: number;
      count_text: string;
      online_count: number;
      online_count_text: string;
    };
  };

  DANMU_MSG: {
    dm_v2: string;
    info: [
      [
        number,
        number, // 弹幕模式
        number, // 弹幕字体大小
        number, // 弹幕颜色
        number, // 发送时的 UNIX 毫秒时间戳
        number, // unknown
        number, // 0?
        string, // 可能为颜色? 一个 16 进制数
        number, // 弹幕字体大小
        number, // 0?
        number, // 0?
        number, // 0?
        string, // 空串?
        number, // 0?
        string, // 字符串JSON 空?
        string, // 字符串JSON 空?
        {
          extra: string;
          mode: number;
          show_player_type: number;
          user: {
            base: {
              face: string; //弹幕发送用户头像
              is_mystery: boolean;
              name: boolean; //弹幕发送用户名称
              name_color: number;
              name_color_str: string;
              official_info: {
                desc: string;
                role: number;
                title: string;
                type: number;
              };
              origin_info: {
                face: string;
                name: string;
              };
              risk_ctrl_info: null;
            };
            guard: null;
            guard_leader: {
              is_guard_leader: boolean;
            };
            medal: {
              color: number; //粉丝牌颜色(10进制)#2d0855
              color_border: number; //粉丝牌边框颜色(10进制)#ffe854
              color_end: number; //粉丝牌渐变颜色结束(10进制)#9d9bff
              color_start: number; //粉丝牌渐变颜色开始(10进制)#2d0855
              guard_icon: string; //粉丝牌左边的图标
              guard_level: number; //类型 1.总督 2.提督 3，舰长
              honor_icon: string;
              id: number;
              is_light: number;
              level: number; //粉丝牌等级
              name: string; //粉丝牌名称
              ruid: number; //粉丝牌创建者UID
              score: number;
              typ: number;
              user_receive_count: number;
              v2_medal_color_border: "#D47AFFFF" | string; //粉丝牌边框颜色(APP)
              v2_medal_color_end: "#9660E5CC" | string; //粉丝牌渐变颜色结束(APP)
              v2_medal_color_level: "#6C00A099" | string; //粉丝牌右边等级数字颜色(APP)
              v2_medal_color_start: "#9660E5CC" | string; //粉丝牌渐变颜色开始(APP)
              v2_medal_color_text: "#FFFFFFFF" | string; //粉丝牌右边圆形颜色(APP)
            };
            title: {
              old_title_css_id: string;
              title_css_id: string;
            };
            uhead_frame: null;
            uid: number; //弹幕发送用户UID
            wealth: null;
          };
        }, // 弹幕补充信息
        unknown, // 活动相关信息?
        number, // 0?
        null // unknown
      ],
      string, // 弹幕文本
      [
        number, // 发送者 mid
        string, // 发送者用户名
        number, // 0?
        number, // 0?
        number, // 0?
        number, // 用户权限等级?
        number, // unknown
        string // unknown
      ],
      []
    ];
    msg_id?: string;
    p_is_ack?: boolean;
    p_msg_type?: number;
    send_time?: number;
  };

  // 😋
  PREPARING: {
    round?: 1 | 0; // 轮播状态: 1正在轮播 0未轮播 开启轮播时存在
    roomid: string; // 直播间ID 未知是真实ID还是短号
    msg_id: string; // 信息id?
    p_is_ack: boolean; // 未知
    p_msg_type: number; // 1 未知
    send_time: number; // 发送时间 UNIX 毫秒时间戳
  };

  // 😋
  LIVE: {
    live_key: string; // 标记直播场次的key 与开始直播接口获得的live_key相同
    voice_background: string; // ?
    sub_session_key: string; // ?
    live_platform: string; // 开播平台? 推测由开播接口决定
    live_model: number; // ?
    live_time: number; // 开播时间 UNIX 秒级时间戳，只有请求了开始直播后立刻下发的那个数据包里存在
    roomid: number; // 直播间号
  };
}

type CommandData = {
  [K in keyof CommandDataMap]: {
    cmd: K;
  } & CommandDataMap[K];
}[keyof CommandDataMap];

type CommandDataEvents = {
  [K in keyof CommandDataMap]: [CommandDataMap[K]];
};

interface LiveMessageStreamClientEvents extends CommandDataEvents {
  WS_open: [websocketClient: WebSocket];
  WS_error: [error: Error];
  WS_close: [code: number];
  CLIENT_OK: [];
  PACKET_cmd: [data: CommandData];
}

interface AuthPacketData {
  uid: number;
  roomid: number;
  protover: number;
  platform: string;
  type: number;
  key: string;
}

interface AuthReply {
  code: number;
}

interface ParsedPacket {
  totalLength: number;
  headerSize: number;
  protocolVersion: number;
  operation: number;
  sequence: number;
  body: Buffer;
}

export default class LiveMessageStreamClient extends EventEmitter<LiveMessageStreamClientEvents> {
  private websocketClient: WebSocket | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private sequence: number = 1;
  private roomId: number;
  private account: BiliAccount;

  constructor(roomId: number, account: BiliAccount) {
    super();
    this.roomId = roomId;
    this.account = account;
  }

  public async connect(): Promise<void> {
    try {
      const danmuInfo = await this.account
        .getBiliApi()
        .getDanmuInfo(this.roomId);
      const host = danmuInfo.host_list[0];
      const wsUrl = `wss://${host.host}:${host.wss_port}/sub`;

      this.websocketClient = new WebSocket(wsUrl);

      this.setupEventListeners(danmuInfo.token);

      // 设置连接超时
      setTimeout(() => {
        if (this.websocketClient?.readyState !== WebSocket.OPEN) {
          logger.error("连接超时");
          this.disconnect();
        }
      }, 10000);
    } catch (error) {
      logger.error("初始化错误:", error);
      throw error;
    }
  }

  public disconnect(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.websocketClient) {
      this.websocketClient.close();
      this.websocketClient = null;
    }
  }

  private setupEventListeners(token: string): void {
    if (!this.websocketClient) return;

    this.websocketClient.on("open", () => {
      logger.info(`已连接到直播间信息流通道 ${this.roomId}`);
      this.emit("WS_open", this.websocketClient!);

      const authPacket = this.createAuthPacket(
        this.roomId,
        token,
        this.account.getAccount().getUid()
      );
      this.websocketClient?.send(authPacket);

      logger.info("认证数据包已发送");

      this.heartbeatInterval = setInterval(() => {
        this.sequence++;
        const heartbeatPacket = this.createHeartbeatPacket(this.sequence);
        this.websocketClient?.send(heartbeatPacket);
        // logger.debug(`心跳包已发送，sequence: ${this.sequence}`);
      }, 30000);
    });

    this.websocketClient.on("close", (code) => {
      logger.warn(`与直播间 ${this.roomId} 的信息流连接已断开`);
      this.disconnect();
      this.emit("WS_close", code);
    });

    this.websocketClient.on("error", (error: Error) => {
      logger.error("WebSocket错误:", error);
      this.emit("WS_error", error);
    });

    this.websocketClient.on("message", (data: Buffer) => {
      if (Buffer.isBuffer(data)) {
        this.handleIncomingData(data);
      } else {
        logger.error("数据非 Buffer", data);
      }
    });
  }

  private handleIncomingData(data: Buffer): void {
    try {
      const packet = this.parsePacket(data);

      //   logger.debug(
      //     `收到数据包: 操作码=${packet.operation}, 协议版本=${packet.protocolVersion}`
      //   );

      // switch 操作码（封包类型）
      switch (packet.operation) {
        case 3:
          // 心跳包回复
          const popularity = packet.body.readUInt32BE(0);
          logger.debug(`收到心跳包回复，人气值: ${popularity}`);
          break;
        case 5:
          // 普通命令包
          this.handleCommandPacket(packet.protocolVersion, packet.body);
          break;
        case 8:
          // 认证包回复
          try {
            const reply: AuthReply = JSON.parse(packet.body.toString("utf-8"));
            logger.debug("认证回复:", reply);

            if (reply.code === 0) {
              logger.info("认证成功");
              this.emit("CLIENT_OK");
            } else {
              logger.error("认证失败:", reply);
            }
          } catch (error) {
            logger.error("无法解析认证回复", error);
          }
          break;

        default:
          logger.warn("未知操作码:", packet.operation);
      }
    } catch (e) {
      if (e instanceof ParsePacketError) {
        logger.warn("无法解析数据包", e);
      } else {
        logger.error("处理信息流失败", e);
      }
    }
  }

  private async handleCommandPacket(
    protocolVersion: number,
    body: Buffer
  ): Promise<void> {
    try {
      if (protocolVersion === 2 || protocolVersion === 3) {
        // 普通包 (正文使用 zlib 压缩 或 使用 brotli 压缩的多个带文件头的普通包)
        await this.handleCompressedData(protocolVersion, body);
      } else if (protocolVersion === 0 || protocolVersion === 1) {
        // 普通包,心跳及认证包 正文不使用压缩
        this.processCommandPacket(body);
      } else {
        logger.error(`不支持的协议版本: ${protocolVersion}`);
      }
    } catch (error) {
      logger.error("处理命令包失败:", error);
    }
  }

  public sendCustomMessage(message: any): boolean {
    if (this.websocketClient?.readyState === WebSocket.OPEN) {
      try {
        const messageStr = JSON.stringify(message);
        const bodyBuffer = Buffer.from(messageStr, "utf-8");
        const totalLength = 16 + bodyBuffer.length;
        const header = this.createPacketHeader(
          totalLength,
          1,
          5,
          this.sequence++
        );
        const packet = Buffer.concat([header, bodyBuffer]);

        this.websocketClient.send(packet);
        return true;
      } catch (error) {
        logger.error("发送消息失败:", error);
        return false;
      }
    }
    return false;
  }

  // 创建数据包头部
  private createPacketHeader(
    totalLength: number,
    protocolVersion: number,
    operation: number,
    sequence: number
  ): Buffer {
    const buffer = Buffer.alloc(16);

    buffer.writeUInt32BE(totalLength, 0);
    buffer.writeUInt16BE(16, 4);
    buffer.writeUInt16BE(protocolVersion, 6);
    buffer.writeUInt32BE(operation, 8);
    buffer.writeUInt32BE(sequence, 12);

    return buffer;
  }

  // 创建认证包
  private createAuthPacket(
    roomId: number,
    token: string,
    uid: number = 0,
    protover: number = 3
  ): Buffer {
    const authData: AuthPacketData = {
      uid,
      roomid: roomId,
      protover,
      platform: "web",
      type: 2,
      key: token,
    };

    const body = JSON.stringify(authData);
    const bodyBuffer = Buffer.from(body, "utf-8");
    const totalLength = 16 + bodyBuffer.length;

    const header = this.createPacketHeader(totalLength, 1, 7, 1);
    return Buffer.concat([header, bodyBuffer]);
  }

  // 创建心跳包
  private createHeartbeatPacket(sequence: number): Buffer {
    const body = "[object Object]";
    const bodyBuffer = Buffer.from(body, "utf-8");
    const totalLength = 16 + bodyBuffer.length;

    const header = this.createPacketHeader(totalLength, 1, 2, sequence);
    return Buffer.concat([header, bodyBuffer]);
  }

  // 解析收到的数据包
  private parsePacket(buffer: Buffer): ParsedPacket {
    if (buffer.length < 16) {
      throw new ParsePacketError("数据包太小");
    }

    const totalLength = buffer.readUInt32BE(0);
    const headerSize = buffer.readUInt16BE(4);
    const protocolVersion = buffer.readUInt16BE(6);
    const operation = buffer.readUInt32BE(8);
    const sequence = buffer.readUInt32BE(12);

    if (buffer.length < totalLength) {
      throw new ParsePacketError("数据包不完整");
    }

    const body = buffer.slice(headerSize, totalLength);

    return {
      totalLength,
      headerSize,
      protocolVersion,
      operation,
      sequence,
      body,
    };
  }

  // 处理命令包 (汇聚)
  private processCommandPacket(body: Buffer): void {
    try {
      const commandData: CommandData = JSON.parse(body.toString("utf-8"));
      logger.debug("收到命令 -> ", commandData);
      this.emit("PACKET_cmd", commandData);

      const cmd = commandData.cmd;
      if (cmd) {
        switch (cmd) {
          case "DANMU_MSG":
            this.emit(commandData.cmd, commandData);
            logger.debug(
              `收到弹幕消息: ${commandData.info?.[1]} (用户: ${commandData.info?.[2]?.[1]})`
            );
            break;
          case "ONLINE_RANK_COUNT":
            this.emit(commandData.cmd, commandData);
            break;
          case "LIVE":
            this.emit(commandData.cmd, commandData);
            break;
          case "PREPARING":
            this.emit(commandData.cmd, commandData);
            break;
          default:
          // logger.warn("未知的 Command", cmd);
        }
      }
    } catch (error) {
      logger.error("无法解析命令:", error);
    }
  }

  // 处理 Brotli 的压缩包 （协议3）
  private processBrotliCompressedPackets(buffer: Buffer): void {
    const totalLength = buffer.readUInt32BE(0);
    const headerSize = buffer.readUInt16BE(4);
    const protocolVersion = buffer.readUInt16BE(6);
    const operation = buffer.readUInt32BE(8);

    // logger.debug(
    //   `BrotliCompressedPackets 数据包总大小: ${totalLength}, 头部大小: ${headerSize}, 协议: ${protocolVersion}, 类型: ${operation}`
    // );

    const body = buffer.slice(headerSize, totalLength);
    this.processCommandPacket(body);
  }

  // 处理压缩数据
  async handleCompressedData(
    protocolVersion: number,
    body: Buffer
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      switch (protocolVersion) {
        case 2: // zlib压缩
          zlib.inflate(body, (err, decompressed) => {
            if (err) {
              logger.error("zlib解压失败:", err);
              reject(err);
            } else {
              this.processCommandPacket(decompressed);
              resolve();
            }
          });
          break;

        case 3: // brotli压缩
          const decompressed = decompress(body);
          if (decompressed) {
            this.processBrotliCompressedPackets(Buffer.from(decompressed));
          }
          resolve();
          break;

        default:
          logger.error("不支持的协议版本:", protocolVersion);
          reject(
            new UnsupportedProtocolError(`不支持的协议版本: ${protocolVersion}`)
          );
      }
    });
  }
}
