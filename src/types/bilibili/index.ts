export enum LiveRoomStatus {
  "END",
  "LIVE",
  "SLIDESHOW",
}

export enum RecorderStatus {
  "NOT_RECORDING",
  "RECORDING",
  "STOPPING",
}

export interface VipInfoLabel {
  path: string;
  text: string;
  label_theme: string;
  text_color: string;
  bg_style: number;
  bg_color: string;
  border_color: string;
  use_img_label: true;
  img_label_uri_hans?: string;
  img_label_uri_hant?: string;
  img_label_uri_hans_static?: string;
  img_label_uri_hant_static?: string;
}

export interface LiveRoomPlayInfo {
  current_quality: number;
  accept_quality: string[];
  current_qn: number;
  quality_description: {
    qn: number;
    desc: string;
  }[];
  durl: {
    url: string;
    length: number;
    order: number;
    stream_type: number;
    p2p_type: number;
  }[];
}

export interface UserCard {
  card: {
    mid: number;
    name: string;
    approve: boolean;
    sex: "男" | "女";
    rank: number;
    face: string;
    face_nft: number;
    face_nft_type: number;
    DisplayRank: number;
    regtime: number;
    spacesta: number;
    birthday: string;
    place: string;
    description: string;
    article: number;
    attentions: any[];
    fans: number;
    friend: number;
    attention: number;
    sign: string;
    level_info: {
      current_level: number;
      current_min: number;
      current_exp: number;
      next_exp: number;
    };
    pendant: {
      pid: number;
      name: string;
      image: string;
      expire: number;
      image_enhance: string;
      image_enhance_frame: string;
      n_pid: number;
    };
    nameplate: {
      nid: number;
      name: string;
      image: string;
      image_small: string;
      level: string;
      condition: string;
    };
    Official: {
      role: number;
      title: string;
      desc: string;
      type: number;
    };
    official_verify: {
      type: number;
      desc: string;
    };
    vip: {
      type: number;
      status: number;
      due_date: number;
      vip_pay_type: number;
      theme_type: number;
      label: VipInfoLabel;
      avatar_subscript: number;
      nickname_color: string;
      role: number;
      avatar_subscript_url: string;
      tv_vip_status: number;
      tv_vip_pay_type: number;
      tv_due_date: number;
      avatar_icon: {
        icon_type: number;
        icon_resource: {};
      };
      vipType: number;
      vipStatus: number;
    };
    is_senior_member: number;
    name_render: null;
  };
  following: boolean;
  archive_count: number;
  article_count: number;
  follower: number;
  like_num: number;
}

/**
 * 用户信息接口
 * 对应B站用户空间信息
 */
export interface UserInfo {
  /** 用户mid */
  mid: number;
  /** 昵称 */
  name: string;
  /** 性别 */
  sex: "男" | "女" | "保密";
  /** 头像链接 */
  face: string;
  /** 是否为 NFT 头像 0：不是 NFT 头像 1：是 NFT 头像 */
  face_nft: number;
  /** NFT 头像类型 */
  face_nft_type: number;
  /** 签名 */
  sign: string;
  /**
   * 用户权限等级
   * 5000：0级未答题
   * 10000：普通会员
   * 20000：字幕君
   * 25000：VIP
   * 30000：真·职人
   * 32000：管理员
   */
  rank: number;
  /** 当前等级 0-6 级 */
  level: number;
  /** 注册时间（此接口返回恒为0） */
  jointime: number;
  /** 节操值（此接口返回恒为0） */
  moral: number;
  /** 封禁状态 0：正常 1：被封 */
  silence: number;
  /**
   * 硬币数
   * 需要登录（Cookie）只能查看自己的
   * 默认为0
   */
  coins: number;
  /** 是否具有粉丝勋章 */
  fans_badge: boolean;
  /** 粉丝勋章信息 */
  fans_medal: FansMedal;
  /** 认证信息 */
  official: Official;
  /** 会员信息 */
  vip: Vip;
  /** 头像框信息 */
  pendant: Pendant;
  /** 勋章信息 */
  nameplate: Nameplate;
  /** 用户荣誉信息 */
  user_honour_info: UserHonourInfo;
  /** 是否关注此用户（需要登录Cookie，未登录恒为false） */
  is_followed: boolean;
  /** 主页头图链接 */
  top_photo: string;
  /** 主题信息 */
  theme: object;
  /** 系统通知（主要用于展示如用户争议、纪念账号等等的小黄条） */
  sys_notice: SysNotice;
  /** 直播间信息 */
  live_room: LiveRoom;
  /** 生日（MM-DD，如设置隐私为空） */
  birthday: string;
  /** 学校信息 */
  school: School;
  /** 专业资质信息 */
  profession: Profession;
  /** 个人标签 */
  tags: string[] | null;
  /** 系列信息 */
  series: Series;
  /** 是否为硬核会员 0：否 1：是 */
  is_senior_member: number;
  /** MCN信息 */
  mcn_info: null;
  /** Gaia资源类型 */
  gaia_res_type: number;
  /** Gaia数据 */
  gaia_data: null;
  /** 风险标识 */
  is_risk: boolean;
  /** 充电信息 */
  elec: Elec;
  /** 老粉计划信息 */
  contract: Contract;
  /** 证书显示标识 */
  certificate_show: boolean;
  /** 昵称渲染信息 */
  name_render: object | null;
}

/**
 * 粉丝勋章信息
 */
export interface FansMedal {
  /** 是否显示 */
  show: boolean;
  /** 是否佩戴了粉丝勋章 */
  wear: boolean;
  /** 粉丝勋章详细信息 */
  medal: Medal;
}

/**
 * 粉丝勋章详细信息
 */
export interface Medal {
  /** 此用户mid */
  uid: number;
  /** 粉丝勋章所属UP的mid */
  target_id: number;
  /** 粉丝勋章id */
  medal_id: number;
  /** 粉丝勋章等级 */
  level: number;
  /** 粉丝勋章名称 */
  medal_name: string;
  /** 粉丝勋章颜色 */
  medal_color: number;
  /** 当前亲密度 */
  intimacy: number;
  /** 下一等级所需亲密度 */
  next_intimacy: number;
  /** 每日亲密度获取上限 */
  day_limit: number;
  /** 今日已获得亲密度 */
  today_feed: number;
  /** 粉丝勋章颜色（十进制数，可转为十六进制颜色代码） */
  medal_color_start: number;
  /** 粉丝勋章颜色（十进制数，可转为十六进制颜色代码） */
  medal_color_end: number;
  /** 粉丝勋章边框颜色（十进制数，可转为十六进制颜色代码） */
  medal_color_border: number;
  /** 是否点亮 */
  is_lighted: number;
  /** 点亮状态 */
  light_status: number;
  /** 当前是否佩戴 0：未佩戴 1：已佩戴 */
  wearing_status: number;
  /** 分数 */
  score: number;
}

/**
 * 认证信息
 */
export interface Official {
  /**
   * 认证类型
   * 见 用户认证类型一览
   */
  role: number;
  /** 认证信息（无为空） */
  title: string;
  /** 认证备注（无为空） */
  desc: string;
  /**
   * 是否认证
   * -1：无
   * 0：个人认证
   * 1：机构认证
   */
  type: number;
}

export enum VipType {
  /** 0：无 */
  Null = 0,
  /** 1：月大会员 */
  Monthly_Membership = 1,
  /** 2：年度及以上大会员 */
  Annual_Membership = 2,
}

/**
 * 会员信息
 */
export interface Vip {
  /**
   * 会员类型
   * 0：无
   * 1：月大会员
   * 2：年度及以上大会员
   */
  type: VipType;
  /** 会员状态 0：无 1：有 */
  status: number;
  /** 会员过期时间（毫秒时间戳） */
  due_date: number;
  /**
   * 支付类型
   * 0：未开启自动续费
   * 1：已开启自动续费
   */
  vip_pay_type: number;
  /** 主题类型（作用尚不明确） */
  theme_type: number;
  /** 会员标签 */
  label: VipLabel;
  /** 是否显示会员图标 0：不显示 1：显示 */
  avatar_subscript: number;
  /** 会员昵称颜色（颜色码，一般为#FB7299） */
  nickname_color: string;
  /**
   * 大角色类型
   * 1：月度大会员
   * 3：年度大会员
   * 7：十年大会员
   * 15：百年大会员
   */
  role: number;
  /** 大会员角标地址 */
  avatar_subscript_url: string;
  /** 电视大会员状态 0：未开通 */
  tv_vip_status: number;
  /** 电视大会员支付类型 */
  tv_vip_pay_type: number;
  /** 电视大会员过期时间（秒级时间戳） */
  tv_due_date: number;
  /** 大会员角标信息 */
  avatar_icon: AvatarIcon;
}

/**
 * 会员标签
 */
export interface VipLabel {
  /** 路径（作用尚不明确） */
  path: string;
  /** 会员类型文案 */
  text: string;
  /**
   * 会员标签
   * vip：大会员
   * annual_vip：年度大会员
   * ten_annual_vip：十年大会员
   * hundred_annual_vip：百年大会员
   * fools_day_hundred_annual_vip：最强绿鲤鱼
   */
  label_theme: string;
  /** 会员标签文本颜色 */
  text_color: string;
  /** 样式编号 */
  bg_style: number;
  /** 会员标签背景颜色（颜色码，一般为#FB7299） */
  bg_color: string;
  /** 会员标签边框颜色（未使用） */
  border_color: string;
  /** 是否使用图片标签 */
  use_img_label: boolean;
  /** 简体图片标签URI（空串） */
  img_label_uri_hans: string;
  /** 繁体图片标签URI（空串） */
  img_label_uri_hant: string;
  /** 简体静态图片标签URI */
  img_label_uri_hans_static: string;
  /** 繁体静态图片标签URI */
  img_label_uri_hant_static: string;
}

/**
 * 大会员角标信息
 */
export interface AvatarIcon {
  /** 角标类型（作用尚不明确） */
  icon_type: number;
  /** 角标资源（作用尚不明确） */
  icon_resource: object;
}

/**
 * 头像框信息
 * 普通头像框的image与image_enhance内容相同
 * 动态头像框的image为png静态图片，image_enhance为webp动态图片
 */
export interface Pendant {
  /** 头像框id */
  pid: number;
  /** 头像框名称 */
  name: string;
  /** 头像框图片url */
  image: string;
  /** 过期时间（此接口返回恒为0） */
  expire: number;
  /** 增强版头像框图片url */
  image_enhance: string;
  /** 头像框图片逐帧序列url */
  image_enhance_frame: string;
  /** 新版头像框id */
  n_pid: number;
}

/**
 * 勋章信息
 */
export interface Nameplate {
  /** 勋章id */
  nid: number;
  /** 勋章名称 */
  name: string;
  /** 勋章图标 */
  image: string;
  /** 勋章图标（小） */
  image_small: string;
  /** 勋章等级 */
  level: string;
  /** 获取条件 */
  condition: string;
}

/**
 * 用户荣誉信息
 */
export interface UserHonourInfo {
  /** 用户mid */
  mid: number;
  /** 颜色 */
  colour: string | null;
  /** 标签 */
  tags: any[] | null;
}

/**
 * 系统通知
 */
export interface SysNotice {
  /** 通知id */
  id: number;
  /** 显示文案 */
  content: string;
  /** 跳转地址 */
  url: string;
  /** 提示类型 1,2 */
  notice_type: number;
  /** 前缀图标 */
  icon: string;
  /** 文字颜色 */
  text_color: string;
  /** 背景颜色 */
  bg_color: string;
}

/**
 * 直播间信息
 */
export interface LiveRoom {
  /**
   * 直播间状态
   * 0：无房间
   * 1：有房间
   */
  roomStatus: number;
  /**
   * 直播状态
   * 0：未开播
   * 1：直播中
   */
  liveStatus: number;
  /** 直播间网页url */
  url: string;
  /** 直播间标题 */
  title: string;
  /** 直播间封面url */
  cover: string;
  /** 观看数据展示 */
  watched_show: WatchedShow;
  /** 直播间id */
  roomid: number;
  /**
   * 轮播状态
   * 0：未轮播
   * 1：轮播
   */
  roundStatus: number;
  /** 广播类型 */
  broadcast_type: number;
}

/**
 * 观看数据展示
 */
export interface WatchedShow {
  /** 开关标识 */
  switch: boolean;
  /** 观看用户总数 */
  num: number;
  /** 小文本 */
  text_small: string;
  /** 大文本 */
  text_large: string;
  /** 观看图标url */
  icon: string;
  /** 图标位置 */
  icon_location: string;
  /** 网页版观看图标url */
  icon_web: string;
}

/**
 * 学校信息
 */
export interface School {
  /** 就读大学名称（没有则为空） */
  name: string;
}

/**
 * 专业资质信息
 */
export interface Profession {
  /** 资质名称 */
  name: string;
  /** 职位 */
  department: string;
  /** 所属机构 */
  title: string;
  /** 是否显示 0：不显示 1：显示 */
  is_show: number;
}

/**
 * 系列信息
 */
export interface Series {
  /** 用户升级状态 */
  user_upgrade_status: number;
  /** 是否显示升级窗口 */
  show_upgrade_window: boolean;
}

/**
 * 充电信息
 */
export interface Elec {
  /** 显示的充电信息 */
  show_info: ElecShowInfo;
}

/**
 * 充电显示信息
 */
export interface ElecShowInfo {
  /** 是否显示充电按钮 */
  show: boolean;
  /**
   * 充电功能开启状态
   * -1：未开通充电功能
   * 1：已开通自定义充电
   * 2：已开通包月、自定义充电
   * 3：已开通包月高档、自定义充电
   */
  state: number;
  /** 充电按钮显示文字（空字符串或 充电 或 充电中） */
  title: string;
  /** 充电图标 */
  icon: string;
  /** 跳转url */
  jump_url: string;
}

/**
 * 老粉计划信息
 */
export interface Contract {
  /** 是否显示 */
  is_display: boolean;
  /** 是否在显示老粉计划 */
  is_follow_display: boolean;
}

export interface LoginInfo {
  isLogin: boolean; // 是否已登录
  email_verified: 0 | 1; // 是否验证邮箱地址	0：未验证 1：已验证
  face: string;
  level_info: {
    current_level: number; // 当前等级
    current_min: number; // 当前等级经验最低值
    current_exp: number; // 当前经验
    next_exp: number | "--"; // 小于6级时：num 6级时：str , 升级下一等级需达到的经验	当用户等级为Lv6时，值为--，代表无穷大
  };
  mid: number;
  mobile_verified: 0 | 1; // 	是否验证手机号	0：未验证 1：已验证
  money: number; // 拥有硬币数
  moral: number; // 当前节操值
  official: {
    role: number; // 认证类型 见 https://github.com/SocialSisterYi/bilibili-API-collect/blob/master/docs/user/official_role.md
    title: string; // 认证信息
    desc: string; // 认证备注
    type: 0 | -1; // 是否认证 -1：无 0：认证
  }; // 认证信息
  officialVerify: {
    type: 0 | -1; // 是否认证 -1：无 0：认证
    desc: string; // 认证信息
  }; // 认证信息 2
  pendant: {
    pid: number; // 挂件id
    name: string; // 挂件名称
    image: string; //	挂件图片url
    expire: number; //（？）
  }; // 头像框信息
  scores: number; // ?
  uname: string; // 用户昵称
  vipDueDate: number; // 会员到期时间 毫秒 时间戳
  vipStatus: 0 | 1; // 会员开通状态 0：无 1：有
  vipType: 0 | 1 | 2; // 	会员类型 0：无 1：月度大会员 2：年度及以上大会员
  vip_pay_type: 0 | 1; // 会员开通状态 0：无 1：有
  vip_theme_type: number; // ?
  vip_label: {
    path: string; //	（？）
    text: string; //	会员名称
    label_theme: "vip" | "annual_vip" | "ten_annual_vip" | "hundred_annual_vip"; //	会员标签	vip：大会员 annual_vip：年度大会员 ten_annual_vip：十年大会员 hundred_annual_vip：百年大会员
  };
  vip_avatar_subscript: 0 | 1; // 是否显示会员图标	0：不显示 1：显示
  vip_nickname_color: string; // 会员昵称颜色	颜色码
  wallet: {
    mid: number; // 登录用户mid
    bcoin_balance: number; //	拥有B币数
    coupon_balance: number; //	每月奖励B币数
    coupon_due_time: number; //	（？）
  }; //	B币钱包信息
  has_shop: boolean; // 是否拥有推广商品
  shop_url: string; // 商品推广页面 url
  allowance_count: number;
  answer_status: number;
  is_senior_member: 0 | 1; // 是否硬核会员
  wbi_img: {
    img_url: string; // Wbi 签名参数 imgKey的伪装 url	详见文档 https://github.com/SocialSisterYi/bilibili-API-collect/blob/master/docs/misc/sign/wbi.md
    sub_url: string; // Wbi 签名参数 subKey的伪装 url	详见文档 https://github.com/SocialSisterYi/bilibili-API-collect/blob/master/docs/misc/sign/wbi.md
  };
  is_jury: boolean; // 是否风纪委员
}

export interface LiveRoomInfo {
  uid: number;
  room_id: number;
  short_id: number;
  attention: number;
  online: number;
  is_portrait: boolean;
  description: string;
  live_status: LiveRoomStatus;
  area_id: number;
  parent_area_id: number;
  parent_area_name: string;
  old_area_id: number;
  background: string;
  title: string;
  user_cover: string;
  keyframe: string;
  is_strict_room: boolean;
  live_time: string;
  tags: string;
  is_anchor: number;
  room_silent_type: string;
  room_silent_level: number;
  room_silent_second: number;
  area_name: string;
  pendants: string;
  area_pendants: string;
  hot_words: string[];
  hot_words_status: number;
  verify: string;
  new_pendants: any;
  up_session: string;
  pk_status: number;
  pk_id: number;
  battle_id: number;
  allow_change_area_time: number;
  allow_upload_cover_time: number;
  studio_info: {
    status: number;
    master_list: any[];
  };
}

export interface VideoInfo {
  bvid: string;
  aid: string;
  videos: number;
  tid: number;
  tname: string;
  copyright: 1 | 2;
  pic: string;
  title: string;
  pubdate: number;
  ctime: number;
  desc: string;
  desc_v2: any[];
  state: number;
  duration: number;
  forward: number;
  mission_id: number;
  redirect_url: string;
  rights: any;
  owner: UserCard;
  stat: any;
  dynamic: string;
  cid: number;
  dimension: any;
  premiere: null;
  teenage_mode: number;
  is_chargeable_season: boolean;
  is_story: boolean;
  is_upower_exclusive: boolean;
  is_upower_pay: boolean;
  is_upower_show: boolean;
  no_cache: boolean;
  pages: any[];
  subtitle: any;
  staff: any[];
  is_season_display: boolean;
  user_garb: any;
  honor_reply: any;
  like_icon: string;
  need_jump_bv: boolean;
  disable_show_up_info: boolean;
  is_story_play: boolean;
  is_view_self: boolean;
  argue_info: any;
}

export interface DanmuInfo {
  group: "live";
  business_id: number;
  refresh_row_factor: number;
  refresh_rate: number;
  max_delay: number;
  token: string;
  host_list: {
    host: string;
    port: number;
    wss_port: number;
    ws_port: number;
  }[];
}

export type DynamicType =
  | "DYNAMIC_TYPE_NONE"
  | "DYNAMIC_TYPE_FORWARD"
  | "DYNAMIC_TYPE_AV"
  | "DYNAMIC_TYPE_PGC"
  | "DYNAMIC_TYPE_COURSES"
  | "DYNAMIC_TYPE_WORD"
  | "DYNAMIC_TYPE_DRAW"
  | "DYNAMIC_TYPE_ARTICLE"
  | "DYNAMIC_TYPE_MUSIC"
  | "DYNAMIC_TYPE_COMMON_SQUARE"
  | "DYNAMIC_TYPE_COMMON_VERTICAL"
  | "DYNAMIC_TYPE_LIVE"
  | "DYNAMIC_TYPE_MEDIALIST"
  | "DYNAMIC_TYPE_COURSES_SEASON"
  | "DYNAMIC_TYPE_COURSES_BATCH"
  | "DYNAMIC_TYPE_AD"
  | "DYNAMIC_TYPE_APPLET"
  | "DYNAMIC_TYPE_SUBSCRIPTION"
  | "DYNAMIC_TYPE_LIVE_RCMD"
  | "DYNAMIC_TYPE_BANNER"
  | "DYNAMIC_TYPE_UGC_SEASON"
  | "DYNAMIC_TYPE_SUBSCRIPTION_NEW";

export interface SpaceDynamicItem {
  basic: {
    comment_id_str: string;
    comment_type: number;
    like_icon: {
      action_url: string;
      end_url: string;
      id: number;
      start_url: string;
    };
    rid_str: string;
  };
  id_str: string;
  modules: {
    module_author: {
      avatar: {
        container_size: {
          height: number;
          width: number;
        };
        fallback_layers: {
          is_critical_group: boolean;
          layers: {
            general_spec: {
              pos_spec: {
                axis_x: number;
                axis_y: number;
                coordinate_pos: number;
              };
              render_spec: {
                opacity: number;
              };
              size_spec: {
                height: number;
                width: number;
              };
            };
            layer_config: {
              is_critical: boolean;
              tags: {
                AVATAR_LAYER: {};
                GENERAL_CFG: {
                  config_type: number;
                  general_config: {
                    web_css_style: {
                      borderRadius: string;
                    };
                  };
                };
              };
            };
            resource: {
              res_image: {
                image_src: {
                  placeholder: number;
                  remote: {
                    bfs_style: string;
                    url: string;
                  };
                  src_type: number;
                };
              };
              res_type: number;
            };
            visible: boolean;
          }[];
        };
        mid: string;
      };
      face: string;
      face_nft: boolean;
      following: null;
      jump_url: string;
      label: string;
      mid: number;
      name: string;
      official_verify: {
        desc: string;
        type: number;
      };
      pendant: {
        expire: number;
        image: string;
        image_enhance: string;
        image_enhance_frame: string;
        n_pid: number;
        name: string;
        pid: number;
      };
      pub_action: string;
      pub_location_text: string;
      pub_time: string;
      pub_ts: string;
      type: string;
      vip: {
        avatar_subscript: number;
        avatar_subscript_url: string;
        due_date: number;
        label: {
          bg_color: string;
          bg_style: number;
          border_color: string;
          img_label_uri_hans: string;
          img_label_uri_hans_static: string;
          img_label_uri_hant: string;
          img_label_uri_hant_static: string;
          label_theme: string;
          path: string;
          text: string;
          text_color: string;
          use_img_label: boolean;
        };
        nickname_color: string;
        status: number;
        theme_type: boolean;
        type: boolean;
      };
    };
    module_dynamic: {
      additional: null;
      desc: null;
      major: {
        draw: {
          id: number;
          items: {
            height: number;
            size: number;
            src: string;
            tags: [];
            width: number;
          }[];
        };
        type: string;
      };
      topic: null;
    };
    module_more: {
      three_point_items: {
        label: string;
        type: string;
      }[];
    };
    module_stat: {
      comment: {
        count: number;
        forbidden: boolean;
      };
      forward: {
        count: number;
        forbidden: boolean;
      };
      like: {
        count: number;
        forbidden: boolean;
        status: boolean;
      };
    };
    module_tag: {
      text: string;
    };
  };
  type: DynamicType;
  visible: boolean;
}

export interface SpaceDynamic {
  has_more: boolean;
  items: SpaceDynamicItem[];
  offset: string;
  update_baseline: string;
  update_num: string;
}

export interface DynamicDetail {
  card: {
    desc: {
      uid: number;
      type: number;
      rid: number;
      acl: number;
      view: number;
      repost: number;
      comment: number;
      like: number;
      is_liked: number;
      dynamic_id: number;
      timestamp: number;
      pre_dy_id: number;
      orig_dy_id: number;
      orig_type: number;
      user_profile: {
        info: {
          uid: number;
          uname: string;
          face: string;
        };
        card: {
          official_verify: {
            type: number;
          };
        };
        vip: {
          vipType: number;
          vipDueDate: number;
          dueRemark: string;
          accessStatus: number;
          vipStatus: number;
          vipStatusWarn: string;
          themeType: number;
          label: VipInfoLabel;
          avatar_subscript: number;
          nickname_color: string;
          role: number;
          avatar_subscript_url: string;
        };
        pendant: {
          pid: number;
          name: string;
          image: string;
          expire: number;
          image_enhance: string;
          image_enhance_frame: string;
        };
        rank: string;
        sign: string;
        level_info: {
          current_level: number;
          current_min: number;
          current_exp: number;
          next_exp: string;
        };
      };
      spec_type: number;
      uid_type: number;
      stype: number;
      r_type: number;
      inner_id: number;
      status: number;
      dynamic_id_str: string;
      pre_dy_id_str: string;
      orig_dy_id_str: string;
      rid_str: string;
      origin: null;
      bvid: string;
      previous: null;
    };
    card: string; // DynamicDetailCard json string
    extend_json: string;
    display: {
      origin: null;
      usr_action_txt: string;
      relation: {
        status: number;
        is_follow: number;
        is_followed: number;
      };
      live_info: {
        live_status: number;
        live_url: string;
      };
      emoji_info: {
        emoji_details: null;
      };
      highlight: null;
    };
  };
}

export interface DynamicDetailCard {
  item: {
    id: number;
    description: string;
    pictures: {
      img_height: number;
      img_width: number;
      img_src: string;
      img_size: number;
    }[];
    pictures_count: number;
    reply: number;
    upload_time: number;
  };
  user: {
    uid: number;
    name: string;
    head_url: string;
    vip: {
      type: number;
      due_date: number;
      status: number;
      theme_type: number;
      label: VipInfoLabel;
      avatar_subscript: number;
      nickname_color: string;
      vip_pay_type: number;
    };
  };
}
