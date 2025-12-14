## ⚙️ 配置说明

### 基础配置 (`config/app.json`)

配置文件路径，填写对应的程序路径和存储目录。

```json
{
  "ffmpegBinPath": "Ffmpeg 可执行文件路径",
  "chromeBinPath": "Chrome 可执行文件路径",
  "recordingDir": "录像文件保存目录"
}
```

### 账号配置 (`config/account.json`)

⚠️ **敏感信息警告**：此文件包含账号的认证信息，请妥善保管，切勿泄露。  
⚠️ **注意**：此配置文件通常由系统自动生成和维护，无需手动配置。

```json
{
  "accounts": {
    "用户1 UID": {
      "cookie": "B站登录Cookie",
      "refresh_token": "刷新令牌"
    },
    "用户2 UID": {
      "cookie": "B站登录Cookie",
      "refresh_token": "刷新令牌"
    }
  },
  "defaultUid": 123456 // 默认使用的用户UID
}
```

### 直播间配置 (`config/live.json`)

管理直播间的录制和投稿行为。

```json
{
  "rooms": {
    "直播间1 ID": {
      "enable": true, // 是否启用该直播间
      "autoRecord": true, // 开播时自动开始录制
      "autoUpload": true, // 下播后自动投稿到B站
      "uploadOptions": {
        // 自定义投稿参数, 可选
        "account": 123456, // 自定义投稿账号
        "cover": "https://i1.hdslb.com/xxx", // 封面 URL
        "title": "@RoomTitle 直播录像", // 标题, 支持模版字符串
        "desc": "@RoomDesc", // 简介, 支持模版字符串
        "tag": "直播录像,煮面" // 视频标签, 多标签使用英文逗号分隔
      }
    },
    "直播间2 ID": {
      "enable": true,
      "autoRecord": true,
      "autoUpload": false // 仅录制，不自动投稿
    }
  },
  "liveBroadcastRecords": [] // 直播记录（系统自动维护）
}
```

### QQ 机器人配置 (`config/qq-bot.json`)

配置基于 Onebot 协议的 QQ 机器人功能，仅支持 WebSocket 客户端模式。

```json
{
  "enable": true, // 是否启用QQ机器人功能

  "websocketClient": {
    "url": "ws://localhost:6700", // OneBot WebSocket 服务器地址
    "retryDelay": 30000 // 连接断开后重试延迟（毫秒）
  },

  "admins": {
    "管理员1 QQ号": {
      "permission": 10 // 权限等级 0-100，数值越高权限越大
    },
    "管理员2 QQ号": {
      "permission": 5
    }
  },

  "liveRoom": {
    "直播间1 ID": {
      "notify": true, // 是否开启开播通知
      "group": {
        "群聊1 QQ号": {
          "official": false, // 是否为官方群
          "subscribers": [123, 456] // 订阅此通知的用户QQ号
        }
      }
    }
  },

  "userDynamic": {
    "UP主1 ID": {
      "notify": true, // 是否开启动态更新通知
      "group": {
        "群聊1 QQ号": {
          "official": false,
          "subscribers": [123, 456] // 订阅此UP主动态的用户
        }
      }
    }
  },

  "liveDanmaku": {}, // 直播弹幕功能（保留字段）

  "superAdmin": 123456 // 超级管理员QQ号，接收系统警告和关键通知
}
```
