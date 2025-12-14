<div align="center">

# BiliNexus

![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat-square&logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat-square&logo=nodedotjs&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat-square&logo=docker&logoColor=white)
![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg?style=flat-square)

_Automate, Monitor, Control — Your All-in-One Bilibili Live Solution._

> **哔哩哔哩直播 自动化生态系统**

</div>

## ✨ 简介

**BiliNexus** 是一个基于 TypeScript/Node.js 开发的 B 站直播全自动管理平台。采用模块化设计和容器化部署，提供一站式的直播录制、监控、管理和自动化投稿解决方案。

## ⚠️ 部署建议

**本项目为服务器级应用，建议在具备以下条件的长期运行服务器上部署：**

- 24×7 不间断运行的云服务器/VPS
- 稳定的网络连接和高带宽
- 充足的磁盘空间（建议 100GB+）
- 良好的 CPU 性能用于视频处理

**不推荐在家用电脑上部署**，因为：

- 需要持续运行监控服务
- 硬盘长期读写可能影响硬件寿命
- 家用网络环境不稳定可能导致录制中断

### 🔍 核心优势：主动监听 vs 被动接流

与传统的推流方案不同，BiliNexus 采用**主动监听模式**，直接从 B 站服务器获取直播流，解决了以下痛点：

**传统方案的问题：**

- 🖥️ **B 站直播姬**：配置复杂，不支持多流同时管理
- ⚙️ **OBS 多流配置**：需要复杂的推流服务器配置，网络要求高

**BiliNexus 的解决方案：**

- ✅ **免推流配置**：无需设置推流地址和密钥
- ✅ **多流自动管理**：同时监控和录制多个直播间
- ✅ **简化操作**：基于 B 站 API，配置简单直观
- ✅ **网络友好**：只需下载流，无需上传推流

## 🚀 快速开始

详细的部署指南请查看：[快速开始文档](docs/quick-start/README.md)

## ⭐ 核心特性

### 🔧 模块化架构

- **高度解耦设计**：各功能模块独立，易于维护和扩展
- **插件化系统**：支持自定义插件扩展功能
- **事件驱动**：采用事件总线实现模块间通信
- **配置驱动**：通过配置文件调整系统行为，支持热重载

### ⚡ 主动式监控

- **直播间状态实时监控**：7×24 小时不间断监控
- **主播动态追踪**：自动关注主播最新动态
- **系统健康检查**：实时监控硬盘容量与健康状态

### 🔄 全自动流程

- **智能录制**：直播开始/结束自动录制
- **自动投稿**：录制完成后自动处理并投稿到 B 站
- **异常恢复**：自动处理程序异常导致的幽灵文件等问题

### 🤖 多平台集成

- **机器人支持**：可接入多种通知/互动机器人
- **消息推送**：支持 Telegram、QQ、微信等平台

## 📋 功能列表

### 核心功能

- ✨ **全自动录制+投稿**
- ✨ **全自动直播间监控/管理**
- ✨ **全自动主播动态监控**
- ✨ **全自动硬盘容量/健康状态监控**
- ✨ **全自动容错处理**
  - 异常退出恢复
  - 幽灵录制文件处理
  - 断流重连机制
- ✨ **多账号支持**
  - 支持多个账号登录
  - 自定义投稿账号

### 扩展功能

- 🤖 **机器人接入**
  - BiliBili Dynamic Bot（支持直播间互动、打赏感谢等）
  - Telegram Bot
  - QQ Bot
- 🔌 **插件系统**
  - B 站每日任务插件
  - 自定义插件支持
  - 第三方插件市场

## 🏗️ 技术栈

- **运行时**: Node.js 18+
- **语言**: TypeScript 5.x
- **容器**: Docker & Docker Compose
- **数据库**: JsonConfigManager (默认) / MySQL / PostgreSQL
- **缓存**: Redis（可选）

### 环境要求

- Node.js 18+ 或 Docker
- FFmpeg 6.0+
- 至少 50GB 可用磁盘空间

## ⚙️ 配置说明

项目配置位于 `config/` 目录下，主要配置文件包括：

- `app.json` - 主应用配置
- `account.json` - 账号配置
- `api.json` - Api 服务配置
- `bili.json` - 哔哩哔哩服务配置
- `dynamic.json` - 主播动态配置
- `live.json` - 直播间配置
- `qq-bot.json` - QQ 机器人配置
- `web.json` - Web 控制面板配置

详细配置说明请查看：[配置文档](docs/config/README.md)

## 🔌 插件系统

### 内置插件

- **DailyTaskPlugin**: B 站每日任务自动化

### 开发插件

```typescript
import { Plugin, PluginContext } from "BiliNexus";

export class MyCustomPlugin implements Plugin {
  name = "MyCustomPlugin";
  version = "1.0.0";

  async initialize(ctx: PluginContext): Promise<void> {
    ctx.logger.info(`${this.name} 插件已加载`);
  }
}
```

详细插件开发指南：[插件开发文档](docs/plugin-dev/README.md)

## 🤝 参与贡献

我们欢迎所有形式的贡献！请查看 [CONTRIBUTING.md](docs/CONTRIBUTING.md) 了解如何参与项目开发。

### 开发流程

1. Fork 项目
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 📄 许可证

本项目采用 Apache License 2.0 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。

## ⚠️ 免责声明

本项目仅供学习和研究使用，请遵守哔哩哔哩相关用户协议，不得用于商业用途或侵犯他人权益。使用本软件产生的一切后果由使用者承担。

## 📞 支持与交流

- 📖 **文档**: [查看完整文档](docs/README.md)
- 🐛 **问题反馈**: [GitHub Issues](https://github.com/cnxiaozhiy/bili-nexus/issues)
- 💬 **Discord**：[加入社区](https://discord.gg/YwvRgfsb)
- 💬 **QQ 群**: [加入群聊](https://qm.qq.com/q/P3hYNxchSs)
- 📧 **邮箱**: admin@bili-nexus.tech

## 🎯 路线图

- [ ] 插件市场开发
- [ ] Web 控制面板开发
- [ ] 多用户支持与权限管理
- [ ] 云存储集成（阿里云 OSS、腾讯云 COS 等）
- [ ] AI 智能剪辑功能
- [ ] 分布式部署支持

---

**⭐ 如果这个项目对你有帮助，请给我们一个 Star！**
