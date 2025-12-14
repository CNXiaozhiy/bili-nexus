/**
 * @author Xzy
 * @description OneBot.d.ts 基于 GO-CQHTTP 文档开发 https://docs.go-cqhttp.org/
 * @link https://github.com/CNXiaozhiy/node-one-bot.git
 */

export type QQNumber = number;
export type AtQQNumber = QQNumber | "all";
export type MessageID = number & { __brand: "MessageID" };
export type ForwardMessageID = string & { __brand: "ForwardMessageID" };
export type ImageID = string & { __brand: "ImageID" };
export type FileID = string & { __brand: "FileID" };
export type FriendAddRequestFlag = string & { __brand: "FriendAddRequestFlag" };
export type AnonymousFlag = string & { __brand: "AnonymousFlag" };
export type GroupAddRequestFlag = string & { __brand: "GroupAddRequestFlag" };
export type GroupAddRequestSubType = ("add" | "invite") & {
  __brand: "sub_type";
};

type FilePath = string;
/* 
    绝对路径 file:///C:\\Users\Richard\Pictures\1.png
    网络 URL http://i1.piimg.com/567571/fdd6e7b6d93f1ef0.jpg
    Base64 base64://iVBORw0KGgoAAAANSUhEUgAAABQAAAAVCAIAAADJt1n/AAAAKElEQVQ4EWPk5+RmIBcwkasRpG9UM4mhNxpgowFGMARGEwnBIEJVAAAdBgBNAZf+QAAAAABJRU5ErkJggg==
*/

type MessageType = "private" | "group";
type Sex = "male" | "female" | "unknown";
type GroupRole = "owner" | "admin" | "member";
type SupportedFormat =
  | "mp3"
  | "amr"
  | "wma"
  | "m4a"
  | "spx"
  | "ogg"
  | "wav"
  | "flac";
type Device = { app_id: number; device_name: string; device_kind: string };
type Sender = { nickname: string; user_id: QQNumber };
type FileUpload = { id: FileID; name: string; size: number; busid: number };
type FileOffline = { name: string; size: number; url: string };
type vector2 = any; // 无参考资料
type TextDetection = {
  text: string;
  confidence: number;
  coordinates: vector2[];
};

export type Anonymous = {
  id: QQNumber; // 匿名用户 ID
  name: string; // 匿名用户名称
  flag: AnonymousFlag; // 匿名用户 flag, 在调用禁言 API 时需要传入
};

export type GroupInfo = {
  group_id: QQNumber;
  group_name: string;
  group_memo: string;
  group_create_time: number;
  group_level: number;
  member_count: number;
  max_member_count: number;
};
export type _GroupHonorInfo = {
  user_id: QQNumber;
  nickname: string;
  avatar: string;
  description: string;
};

export type GroupHonorInfo_CurrentTalkative = Exclude<
  _GroupHonorInfo,
  "description"
> & {
  day_count: number;
};
export type GroupHonorInfo_TalkativeList = _GroupHonorInfo[];
export type GroupHonorInfo_PerformerList = _GroupHonorInfo[];
export type GroupHonorInfo_LegendList = _GroupHonorInfo[];
export type GroupHonorInfo_StrongNewbieList = _GroupHonorInfo[];
export type GroupHonorInfo_EmotionList = _GroupHonorInfo[];

export type GroupMemberInfo = {
  group_id: number; //群号
  user_id: number; //QQ 号
  nickname: string; //昵称
  card: Sex; //群名片／备注
  sex: string; //性别, male 或 female 或 unknown
  age: number; //年龄
  area: string; //地区
  join_time: number; //加群时间戳
  last_sent_time: number; //最后发言时间戳
  level: string; //成员等级
  role: GroupRole; //角色, owner 或 admin 或 member
  unfriendly: boolean; //是否不良记录成员
  title: string; //专属头衔
  title_expire_time: number; //专属头衔过期时间戳
  card_changeable: boolean; //是否允许修改群名片
  shut_up_timestamp: number; //禁言到期时间
};

export type StrangerInfo = {
  user_id: number;
  nickname: string;
  sex: Sex;
  age: number;
  qid: string;
  level: number;
  login_days: number;
};

export type InvitedRequest = {
  request_id: number; // 请求ID
  invitor_uin: number; // 邀请者
  invitor_nick: string; // 邀请者昵称
  group_id: number; // 群号
  group_name: string; // 群名
  checked: boolean; // 是否已被处理
  actor: number; // 处理者, 未处理为0
};

export type JoinRequest = {
  request_id: number; // 请求ID
  requester_uin: number; // 请求者ID
  requester_nick: string; // 请求者昵称
  message: string; // 验证消息
  group_id: number; // 群号
  group_name: string; // 群名
  checked: boolean; // 是否已被处理
  actor: number; // 处理者, 未处理为0
};

type FriendListItem = {
  user_id: string;
  nickname: string;
  remark: string;
};

type UnidirectionalFriendListItem = {
  user_id: string;
  nickname: string;
  source: string;
};

export interface ActionMap {
  get_login_info: {
    params: null;
    resp: { user_id: QQNumber; nickname: string };
  };
  set_qq_profile: {
    params: Partial<{
      nickname: string;
      company: string;
      email: string;
      college: string;
      personal_note: string;
    }>;
    resp: null;
  };
  qidian_get_account_info: {
    params: null;
    resp: { name: string };
  };
  _get_model_show: {
    params: { model: string };
    resp: { variants: { model_show: string; need_pay: boolean }[] };
  };
  _set_model_show: {
    params: { model: string; model_show: string };
    resp: null;
  };
  get_online_clients: {
    params: { no_cache: boolean };
    resp: { clients: Device[] };
  };
  get_stranger_info: {
    params: { user_id: QQNumber; no_cache?: boolean };
    resp: StrangerInfo;
  };
  get_friend_list: {
    params: null;
    resp: FriendListItem[];
  };
  get_unidirectional_friend_list: {
    params: null;
    resp: UnidirectionalFriendListItem[];
  };
  delete_friend: {
    params: { user_id: QQNumber };
    resp: null;
  };
  delete_unidirectional_friend: {
    params: { user_id: QQNumber };
    resp: null;
  };
  send_private_msg: {
    params: {
      user_id: QQNumber;
      group_id?: QQNumber;
      message: Messages;
      auto_escape?: boolean;
    };
    resp: { message_id: MessageID };
  };
  send_group_msg: {
    params: { group_id: QQNumber; message: Messages; auto_escape?: boolean };
    resp: { message_id: MessageID };
  };
  send_msg: {
    params: { message_type?: MessageType } & (
      | { user_id: QQNumber; message: Messages; auto_escape?: boolean }
      | { group_id: QQNumber; message: Messages; auto_escape?: boolean }
    );
    resp: { message_id: MessageID };
  };
  get_msg: {
    params: { message_id: MessageID };
    resp: {
      group: boolean;
      group_id: number;
      message_id: MessageID;
      real_id: number;
      message_type: MessageType;
      sender: Sender;
      time: number;
      message: SegmentMessages;
      raw_message: RawMessage;
    };
  };
  delete_msg: {
    params: { message_id: MessageID };
    resp: null;
  };
  mark_msg_as_read: {
    params: { message_id: MessageID };
    resp: null;
  };
  get_forward_msg: {
    params: { message_id: ForwardMessageID };
    resp: ForwardMessages;
  };
  send_group_forward_msg: {
    params: { group_id: QQNumber; messages: ForwardNodes };
    resp: { message_id: MessageID; forward_id: ForwardMessageID };
  };
  send_private_forward_msg: {
    params: { user_id: QQNumber; messages: ForwardNodes };
    resp: { message_id: MessageID; forward_id: ForwardMessageID };
  };
  get_group_msg_history: {
    params: { message_seq?: number; group_id: QQNumber };
    resp: SegmentMessages;
  };
  get_image: {
    params: { file: FilePath };
    resp: { size: number; filename: string; url: string };
  };
  can_send_image: {
    params: null;
    resp: { yes: boolean };
  };
  ocr_image: {
    params: { image: ImageID };
    resp: { texts: TextDetection[]; language: string };
  };
  get_record: {
    params: { file: FilePath; out_format: SupportedFormat };
    resp: { file: FilePath };
  };
  can_send_record: {
    params: null;
    resp: { yes: boolean };
  };
  set_friend_add_request: {
    params: { flag: FriendAddRequestFlag; approve?: boolean; remark?: string };
    resp: null;
  };
  set_group_add_request: {
    params: {
      flag: GroupAddRequestFlag;
      sub_type: GroupAddRequestSubType;
      approve?: boolean;
      reason?: string;
    };
    resp: {
      master_id: QQNumber;
      ext_name: string;
      create_time: number;
    };
  };
  get_group_info: {
    params: { group_id: QQNumber; no_cache?: boolean };
    resp: GroupInfo;
    // 这里提供了一个API用于获取群图片, group_id 为群号 https://p.qlogo.cn/gh/{group_id}/{group_id}/100
  };
  get_group_list: {
    params: { no_cache?: boolean };
    resp: GroupInfo[];
  };
  get_group_member_info: {
    params: { group_id: QQNumber; user_id: QQNumber; no_cache?: boolean };
    resp: GroupMemberInfo;
  };
  get_group_member_list: {
    params: { group_id: QQNumber; no_cache?: boolean };
    resp: Exclude<GroupMemberInfo, "area" | "title">[];
    // 例如 area、title 等字段在获取列表时无法获得, 具体应以单独的成员信息为准。
  };
  get_group_honor_info: {
    params: {
      group_id: QQNumber;
      type:
        | "talkative"
        | "performer"
        | "legend"
        | "strong_newbie"
        | "emotion"
        | "all";
    };
    resp: {
      group_id: QQNumber;
      current_talkative?: GroupHonorInfo_CurrentTalkative;
      talkative_list?: GroupHonorInfo_TalkativeList;
      performer_list?: GroupHonorInfo_PerformerList;
      legend_list?: GroupHonorInfo_LegendList;
      strong_newbie_list?: GroupHonorInfo_StrongNewbieList;
      emotion_list?: GroupHonorInfo_EmotionList;
    };
  };
  get_group_system_msg: {
    params: null;
    resp: {
      invited_requests: InvitedRequest[] | null;
      join_requests: JoinRequest[] | null;
    };
  };
  get_essence_msg_list: {
    params: { group_id: QQNumber };
    resp: {
      sender_id: number; //发送者QQ 号
      sender_nick: string; //发送者昵称
      sender_time: number; //消息发送时间
      operator_id: number; //操作者QQ 号
      operator_nick: string; //操作者昵称
      operator_time: number; //精华设置时间
      message_id: MessageID; //消息ID
    };
  };
  get_group_at_all_remain: {
    params: { group_id: QQNumber };
    resp: {
      can_at_all: boolean;
      remain_at_all_count_for_group: number;
      remain_at_all_count_for_uin: number;
    };
  };
  set_group_name: {
    params: { group_id: QQNumber; group_name: string };
    resp: null;
  };
  set_group_portrait: {
    params: { group_id: QQNumber; file: FilePath; cache?: 1 | 0 };
    resp: null;
  };
  set_group_admin: {
    params: { group_id: QQNumber; user_id: QQNumber; enable?: boolean };
    resp: null;
  };
  set_group_card: {
    params: { group_id: QQNumber; user_id: QQNumber; card?: string };
    resp: null;
  };
  set_group_special_title: {
    params: {
      group_id: QQNumber;
      user_id: QQNumber;
      special_title?: string;
      duration?: -1 | number;
    };
    resp: null;
  };
  set_group_ban: {
    params: { group_id: QQNumber; user_id: QQNumber; duration?: number }; // 禁言时长, 单位秒, 0 表示取消禁言
    resp: null;
  };
  set_group_whole_ban: {
    params: { group_id: QQNumber; enable?: boolean };
    resp: null;
  };
  set_group_anonymous_ban: {
    params: {
      group_id: QQNumber;
      anonymous: Anonymous;
      anonymous_flag: AnonymousFlag;
      duration?: number;
    };
    resp: null;
  };
  set_essence_msg: {
    params: { message_id: MessageID };
    resp: null;
  };
  delete_essence_msg: {
    params: { message_id: MessageID };
    resp: null;
  };
  send_group_sign: {
    params: { group_id: QQNumber };
    resp: null;
  };
  set_group_anonymous: {
    params: { group_id: QQNumber; enable?: boolean };
    resp: null;
  };
  _send_group_notice: {
    params: {
      group_id: QQNumber;
      content: string;
      image?: FilePath;
    };
    resp: null;
  };
  _get_group_notice: {
    params: { group_id: QQNumber };
    resp: {
      sender_id: QQNumber;
      publish_time: number;
      message: {
        text: string;
        images: {
          height: string;
          width: string;
          id: ImageID;
        }[];
      };
    }[];
  };
  set_group_kick: {
    params: {
      group_id: QQNumber;
      user_id: QQNumber;
      reject_add_request?: boolean;
    };
    resp: null;
  };
  set_group_leave: {
    params: { group_id: QQNumber; is_dismiss?: boolean };
    resp: null;
  };

  // 群文件操作类不想写了

  get_cookies: {
    params: { domain: string };
    resp: { cookies: string };
  };
  get_csrf_token: {
    params: null;
    resp: { token: number };
  };
  get_credentials: {
    params: { domain: string };
    resp: { cookies: string; csrf_token: number };
  };

  // get_version_info get_status set_restart

  // 自定义
  register_plugin: {
    params: {
      id: string;
      name: string;
      version: string;
      cert: string;
      sign: string;
    };
    resp: { ok: boolean };
  };
}

export interface SegmentMessageMap {
  text: { text: string };
  face: { id: number };
  image: { file: FilePath };
  record: { file: FilePath };
  video: { file: FilePath };
  at: { qq: AtQQNumber };
  rps: {};
  dice: {};
  shake: {};
  poke: { type: string; id: string };
  anonymous: {};
  share: { url: string; title: string; content?: string; image?: string };
  contact: { type: "qq"; id: QQNumber } | { type: "group"; id: QQNumber };
  location: { lat: string; lon: string };
  music:
    | { type: "qq" | "163" | "xm"; id: string }
    | { type: "custom"; url: string; audio: string; title: string };
  reply: { id: MessageID };
  forward: { id: ForwardMessageID };
  node:
    | { id: MessageID }
    | { user_id: QQNumber; nickname: string; content: Messages };
  xml: { data: string };
  json: { data: string };
}

export type ForwardNodes = SegmentMessageMap["node"][];

export type RawMessage = string;

export type SegmentMessageTypes = keyof SegmentMessageMap;

export type SegmentMessage = {
  [K in SegmentMessageTypes]: {
    type: K;
    data: SegmentMessageMap[K];
  };
}[SegmentMessageTypes];

export type ForwardMessage = {
  content: RawMessage;
  sender: Sender;
  time: number;
};

export type SegmentMessages = SegmentMessage[];
export type ForwardMessages = ForwardMessage[];

export type Messages = RawMessage | SegmentMessages;

interface BaseOkResponse<T> {
  status: "ok";
  retcode: 0;
  data: T;
}

interface BaseAsyncResponse {
  status: "async";
  retcode: 1;
}

interface BaseFailedResponse {
  status: "failed";
  retcode: number;
  msg: string;
  wording: string;
}

type BaseResponse<T> =
  | BaseOkResponse<T>
  | BaseAsyncResponse
  | BaseFailedResponse;

export type Actions = keyof ActionMap;
export type ActionParams<A extends Actions> = ActionMap[A]["params"];
export type ActionResponse<A extends keyof ActionMap> = BaseResponse<
  ActionMap[A]["resp"]
>;
export type ActionOkResponse<A extends keyof ActionMap> = BaseOkResponse<
  ActionMap[A]["resp"]
>;

export type ActionPayload<A extends Actions> = {
  action: A;
  params: ActionParams<A>;
  echo?: string;
};

// Events

interface BaseEventFields {
  time: number;
  self_id: QQNumber;
}

// post_type: "message" | "message_sent" | "request" | "notice" | "meta_event";

export interface PrivateMessageEvent extends BaseEventFields {
  post_type: "message";
  message_type: "private";
  sub_type: "friend" | "group" | "group_self" | "other";
  message_id: MessageID;
  user_id: QQNumber;
  message: SegmentMessages;
  raw_message: RawMessage;
  font: number;
  sender: Sender;
  target_id: QQNumber;
  temp_source?: number;
}

export interface GroupMessageEvent extends BaseEventFields {
  post_type: "message";
  message_type: "group";
  sub_type: "normal" | "anonymous" | "notice";
  message_id: MessageID;
  user_id: QQNumber;
  message: SegmentMessages;
  raw_message: RawMessage;
  font: number;
  sender: Sender;
  group_id: QQNumber;
  anonymous?: Anonymous;
}

export type MessageEvent = PrivateMessageEvent | GroupMessageEvent;

export type PrivateMessageSentEvent = Omit<PrivateMessageEvent, "post_type"> & {
  post_type: "message_sent";
};

export type GroupMessageSentEvent = Omit<GroupMessageEvent, "post_type"> & {
  post_type: "message_sent";
};

export type MessageSentEvent = PrivateMessageSentEvent | GroupMessageSentEvent;

export interface PrivateMessageRecallNoticeEvent extends BaseEventFields {
  post_type: "notice";
  notice_type: "friend_recall";
  user_id: QQNumber;
  message_id: MessageID; // 被撤回的消息 ID
}

export interface GroupMessageRecallNoticeEvent extends BaseEventFields {
  post_type: "notice";
  notice_type: "group_recall";
  group_id: QQNumber;
  user_id: QQNumber; // 消息发送者 QQ 号
  operator_id: QQNumber;
  message_id: MessageID; // 被撤回的消息 ID
}

export interface GroupIncreaseNoticeEvent extends BaseEventFields {
  post_type: "notice";
  notice_type: "group_increase";
  sub_type: "approve" | "invite";
  group_id: QQNumber;
  operator_id: QQNumber;
  user_id: QQNumber; // 加入者 QQ 号
}

export interface GroupDecreaseNoticeEvent extends BaseEventFields {
  post_type: "notice";
  notice_type: "group_decrease";
  sub_type: "leave" | "kick" | "kick_me";
  group_id: QQNumber;
  operator_id: QQNumber; // 操作者 QQ 号 ( 如果是主动退群, 则和 user_id 相同 )
  user_id: QQNumber; // 离开者 QQ 号
}

export interface GroupAdminNoticeEvent extends BaseEventFields {
  post_type: "notice";
  notice_type: "group_admin";
  sub_type: "set" | "unset";
  group_id: QQNumber;
  user_id: QQNumber; // 操作者 QQ 号
}

export interface GroupUploadNoticeEvent extends BaseEventFields {
  post_type: "notice";
  notice_type: "group_upload";
  group_id: QQNumber;
  user_id: QQNumber; // 发送者 QQ 号
  file: FileUpload;
}

export interface GroupBanNoticeEvent extends BaseEventFields {
  post_type: "notice";
  notice_type: "group_ban";
  group_id: QQNumber;
  operator_id: QQNumber; // 操作者 QQ 号
  user_id: QQNumber; // 被禁言的 QQ 号 (为全员禁言时为0)
  duration: number; // 禁言时长, 单位秒 (为全员禁言时为-1)
}

export interface FriendAddNoticeEvent extends BaseEventFields {
  post_type: "notice";
  notice_type: "friend_add";
  user_id: QQNumber;
}

export interface PokeNotifyNoticeEvent extends BaseEventFields {
  post_type: "notice";
  notice_type: "notify";
  sub_type: "poke";
  sender_id?: QQNumber;
  group_id?: QQNumber;
  user_id: QQNumber;
  target_id: QQNumber;
}

export interface LuckyKingNotifyNoticeEvent extends BaseEventFields {
  post_type: "notice";
  notice_type: "notify";
  sub_type: "lucky_king";
  group_id: QQNumber;
  user_id: QQNumber;
  target_id: QQNumber;
}

export interface HonorNotifyNoticeEvent extends BaseEventFields {
  post_type: "notice";
  notice_type: "notify";
  sub_type: "honor";
  group_id: QQNumber;
  user_id: QQNumber;
  honor_type: "talkative" | "performer" | "emotion";
}

export interface TitleNotifyNoticeEvent extends BaseEventFields {
  post_type: "notice";
  notice_type: "notify";
  sub_type: "title";
  group_id: QQNumber;
  user_id: QQNumber;
  title: string;
}

export interface GroupCardNoticeEvent extends BaseEventFields {
  post_type: "notice";
  notice_type: "group_card";
  group_id: QQNumber;
  user_id: QQNumber;
  card_new: string;
  card_old: string;
}

export interface OfflineFileNoticeEvent extends BaseEventFields {
  post_type: "notice";
  notice_type: "offline_file";
  user_id: QQNumber;
  file: FileOffline;
}

export interface ClientStatusNoticeEvent extends BaseEventFields {
  post_type: "notice";
  notice_type: "client_status";
  client: Device;
  online: boolean;
}

export interface EssenceNoticeEvent extends BaseEventFields {
  post_type: "notice";
  notice_type: "essence";
  sub_type: "add" | "delete";
  group_id: QQNumber;
  sender_id: QQNumber;
  operator_id: QQNumber;
  message_id: MessageID;
}

export type NoticeEvent =
  | PrivateMessageRecallNoticeEvent
  | GroupMessageRecallNoticeEvent
  | GroupIncreaseNoticeEvent
  | GroupDecreaseNoticeEvent
  | GroupAdminNoticeEvent
  | GroupUploadNoticeEvent
  | GroupBanNoticeEvent
  | FriendAddNoticeEvent
  | PokeNotifyNoticeEvent
  | LuckyKingNotifyNoticeEvent
  | HonorNotifyNoticeEvent
  | TitleNotifyNoticeEvent
  | GroupCardNoticeEvent
  | OfflineFileNoticeEvent
  | ClientStatusNoticeEvent
  | EssenceNoticeEvent;

export interface FriendRequestEvent extends BaseEventFields {
  post_type: "request";
  request_type: "friend";
  user_id: QQNumber;
  comment: string;
  flag: FriendAddRequestFlag;
}

export interface GroupRequestEvent extends BaseEventFields {
  post_type: "request";
  request_type: "group";
  sub_type: GroupAddRequestSubType;
  group_id: QQNumber;
  user_id: QQNumber;
  comment: string;
  flag: GroupAddRequestFlag;
}

export type RequestEvent = FriendRequestEvent | GroupRequestEvent;

export interface HeartbeatMetaEvent extends BaseEventFields {
  post_type: "meta_event";
  meta_event_type: "heartbeat";
  status: {
    app_initialized: boolean;
    app_enabled: boolean;
    plugins_good: boolean;
    app_good: boolean;
    online: boolean;
    stat: {
      packet_received: number;
      packet_sent: number;
      packet_lost: number;
      message_received: number;
      message_sent: number;
      disconnect_times: number;
      lost_times: number;
      last_message_time: number;
    };
  };
  interval: number;
}

export interface LifecycleMetaEvent extends BaseEventFields {
  post_type: "meta_event";
  meta_event_type: "lifecycle";
  sub_type: "enable" | "disable" | "connect";
}

export type MetaEvent = HeartbeatMetaEvent | LifecycleMetaEvent;

// XzQBot Group 的自定义事件
export type RelayEvent = {
  post_type: "relay-welcome" | "relay-warning";
  message: string;
};

export type Events =
  | RelayEvent
  | MessageEvent
  | MessageSentEvent
  | RequestEvent
  | NoticeEvent
  | MetaEvent;

// Utils

export class OneBotMessageUtils {
  static At(qq: AtQQNumber): SegmentMessage {
    return { type: "at", data: { qq: qq } };
  }
  static Text(text: string): SegmentMessage {
    return { type: "text", data: { text } };
  }
  static UrlImage(url: string): SegmentMessage {
    return { type: "image", data: { file: url } };
  }
  static Base64Image(base64: string): SegmentMessage {
    return { type: "image", data: { file: `base64://${base64}` } };
  }
}
