# 🚀 快速开始

本指南将帮助您快速部署 BiliNexus。请根据您的操作系统和环境选择适合的部署方式。

## 📋 系统要求

### 🖥️ 硬件配置参考

| 直播间数量 | 推荐内存 | 推荐 CPU | 推荐带宽 | 存储容量(24 小时) |
| ---------- | -------- | -------- | -------- | ----------------- |
| 1-6 个     | 2GB+     | 2 核+    | 50Mbps+  | 24-48GB           |
| 7-12 个    | 4GB+     | 4 核+    | 100Mbps+ | 48-96GB           |
| 13-24 个   | 8GB+     | 4 核+    | 200Mbps+ | 96-192GB          |
| 25 个以上  | 16GB+    | 8 核+    | 500Mbps+ | 200GB+            |

### ⚠️ 重要提示

- **CPU 要求不高**：由于使用 `-copy` 流不涉及转码，CPU 消耗较低
- **内存是关键**：主要消耗在于并发录制和浏览器实例
- **带宽需求**：每个直播间约需 **5-15Mbps**
- **存储消耗**：每个直播间每小时约 **1-2GB**

### 💾 软件依赖

| 依赖项               | 必需性    | 用途                 | 下载地址                                     |
| -------------------- | --------- | -------------------- | -------------------------------------------- |
| **FFmpeg**           | ✅ 必需   | 视频流处理           | [官方下载](https://ffmpeg.org/download.html) |
| **Chrome/Chromium**  | ✅ 必需   | 模板渲染、页面自动化 | [镜像下载](#chrome安装)                      |
| **Node.js 18+**      | ✅ 必需   | 运行环境             | [Node.js 官网](https://nodejs.org/)          |
| **Redis**            | ⭕ 开发中 | 缓存和消息队列       | [Redis 官网](https://redis.io/)              |
| **MySQL/PostgreSQL** | ⭕ 开发中 | 生产环境数据库       | 按需选择                                     |

### 🌐 网络要求

- 稳定的网络连接（24×7 不间断）
- 能正常访问哔哩哔哩 API 和直播流
- 对有无公网 IP 无限制

## 📦 部署方式选择

根据您的环境选择最适合的部署方式：

| 部署方式             | 推荐指数   | 适用场景             | 维护性 | 性能 |
| -------------------- | ---------- | -------------------- | ------ | ---- |
| **Docker 一键部署**  | ⭐⭐⭐⭐⭐ | 生产环境、快速部署   | 优秀   | 良好 |
| **Node.js 一键部署** | ⭐⭐⭐⭐☆  | 原生环境、自定义需求 | 良好   | 优秀 |
| **手动部署**         | ⭐⭐☆☆☆    | 开发调试、高级定制   | 灵活   | 优秀 |

## 🎯 控制面板说明

> ⚠️ **重要提醒**：Web 控制面板正在开发中，当前推荐使用 QQ 机器人进行管理

### 当前推荐的管理方式：

**强烈建议配置 QQ 机器人**，它提供了完整的管理功能，包括：

- 📱 直播间监控管理
- 📊 系统状态查看
- ⚙️ 配置修改
- 📋 任务状态监控

查看：[QQ 机器人命令文档](../qq-bot/commands.md)

## 🐳 Docker 部署（推荐）

```bash
# 构建镜像（基于 pnpm workspace）
docker build -t bili-nexus .

# 运行
docker run -d \
  --name bili-nexus \
  --restart unless-stopped \
  -v $(pwd)/config:/app/config \
  -v $(pwd)/recordings:/app/recordings \
  -v $(pwd)/logs:/app/logs \
  bili-nexus
```

### Windows Server

```powershell
docker build -t bili-nexus .
docker run -d --name bili-nexus --restart unless-stopped -v ${PWD}/config:/app/config -v ${PWD}/recordings:/app/recordings -v ${PWD}/logs:/app/logs bili-nexus
```

## ⚙️ Node.js 部署

```bash
# 1. 克隆项目
git clone https://github.com/cnxiaozhiy/bili-nexus.git
cd bili-nexus

# 2. 安装依赖（需 pnpm，可先 `npm install -g pnpm`）
pnpm install

# 3. 构建项目（构建所有 workspace 包与应用）
pnpm build

# 4. 配置QQ机器人（推荐）
# 编辑 config/qq-bot.json 配置机器人

# 5. 使用PM2启动
npm install -g pm2
pm2 start dist/app.js --name bili-nexus --time

# 6. 开机自启
pm2 startup
pm2 save
```

## 🔧 依赖安装指南（非 Docker 部署）

### Chrome/Chromium 安装

#### 📥 镜像下载地址（国内推荐）

使用以下镜像站快速下载：

| 系统平台    | 下载地址                                                                                            | 最新版本号 |
| ----------- | --------------------------------------------------------------------------------------------------- | ---------- |
| **Windows** | `https://cdn.npmmirror.com/binaries/chromium-browser-snapshots/Win_x64/{版本号}/chrome-win.zip`     | 1535714    |
| **Linux**   | `https://cdn.npmmirror.com/binaries/chromium-browser-snapshots/Linux_x64/{版本号}/chrome-linux.zip` | 1557932    |
| **macOS**   | `https://cdn.npmmirror.com/binaries/chromium-browser-snapshots/Mac/{版本号}/chrome-mac.zip`         | 1557933    |

**查看所有版本**：[registry.npmmirror.com/binary.html?path=chromium-browser-snapshots/](https://registry.npmmirror.com/binary.html?path=chromium-browser-snapshots/)

#### 🛠️ 一键安装脚本

```bash
# Linux 安装脚本
curl -fsSL https://raw.githubusercontent.com/cnxiaozhiy/bili-nexus/main/scripts/install-chrome.sh | bash

# Windows PowerShell
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/cnxiaozhiy/bili-nexus/main/scripts/install-chrome.ps1" -OutFile "install-chrome.ps1"
.\install-chrome.ps1
```

#### 📁 手动安装步骤

**Linux:**

```bash
# 下载Chrome
wget https://cdn.npmmirror.com/binaries/chromium-browser-snapshots/Linux_x64/1557932/chrome-linux.zip

# 解压到指定目录
unzip chrome-linux.zip -d /opt/chrome
sudo ln -sf /opt/chrome/chrome-linux/chrome /usr/bin/chromium

# 在 config/app.json 中配置二进制文件路径

# ffmpegBinPath: /usr/bin/chromium
```

**Windows:**

```powershell
# 下载并解压
Invoke-WebRequest -Uri "https://cdn.npmmirror.com/binaries/chromium-browser-snapshots/Win_x64/1535714/chrome-win.zip" -OutFile "chrome-win.zip"
Expand-Archive -Path "chrome-win.zip" -DestinationPath "D:\chrome"

# 在 config/app.json 中配置二进制文件路径

# ffmpegBinPath: D:/chrome/chrome.exe
```

### FFmpeg 安装

#### 一键安装

```bash
# Linux
curl -fsSL https://raw.githubusercontent.com/cnxiaozhiy/bili-nexus/main/scripts/install-ffmpeg.sh | bash

# Windows
powershell -ExecutionPolicy Bypass -File "https://raw.githubusercontent.com/cnxiaozhiy/bili-nexus/main/scripts/install-ffmpeg.ps1"
```

#### 各系统手动安装

| 系统              | 安装命令                                                      |
| ----------------- | ------------------------------------------------------------- |
| **Ubuntu/Debian** | `sudo apt update && sudo apt install -y ffmpeg`               |
| **CentOS/RHEL**   | `sudo dnf install -y ffmpeg ffmpeg-devel`                     |
| **Windows**       | 下载 [官方 Windows 版本](https://www.gyan.dev/ffmpeg/builds/) |
| **macOS**         | `brew install ffmpeg`                                         |

## ⚡ 快速验证

部署完成后，运行验证脚本确保所有依赖就绪：

```bash
ffmpeg -version  # 验证FFmpeg
chromium --version  # 验证Chrome
node --version  # 验证Node.js
```

## ⚙️ 配置说明

详细的配置说明请查看配置文档：  
📖 **[配置文档](../config/README.md)**

### 📁 配置文件概览

| 配置文件       | 用途                   | 必需性      |
| -------------- | ---------------------- | ----------- |
| `app.json`     | 主应用配置             | ✅ 必需     |
| `qq-bot.json`  | QQ 机器人配置          | ✅ 推荐     |
| `api.json`     | API 服务配置           | ✅ 必需     |
| `bili.json`    | 哔哩哔哩服务配置       | ✅ 必需     |
| `account.json` | 哔哩哔哩账号配置       | 🔶 系统维护 |
| `dynamic.json` | 主播动态监控配置       | 🔶 系统维护 |
| `live.json`    | 直播间监控配置         | 🔶 系统维护 |
| `web.json`     | Web 面板配置（开发中） | ⭕ 无效     |

### 🔑 首次配置关键步骤

1. **配置 App**

   ```bash
   # 配置依赖的二进制路径等
   nano config/app.json
   ```

2. **配置 QQ 机器人**
   ```bash
   # 配置机器人的 WebsocketClient 等
   nano config/qq-bot.json
   ```

## 🚦 启动与管理

### 启动服务

```bash
# Node.js方式（使用PM2）
pm2 start dist/app.js --name bili-nexus
```

### 查看状态

```bash
# 查看运行状态
docker-compose ps  # Docker
pm2 status bili-nexus  # Node.js

# 查看实时日志
docker-compose logs -f  # Docker
pm2 logs bili-nexus --lines 100  # Node.js
```

### 常用命令

| 操作     | Docker 命令                                   | Node.js(PM2)命令         |
| -------- | --------------------------------------------- | ------------------------ |
| 启动     | `docker-compose up -d`                        | `pm2 start bili-nexus`   |
| 停止     | `docker-compose down`                         | `pm2 stop bili-nexus`    |
| 重启     | `docker-compose restart`                      | `pm2 restart bili-nexus` |
| 查看日志 | `docker-compose logs -f`                      | `pm2 logs bili-nexus`    |
| 更新重启 | `docker-compose pull && docker-compose up -d` | `pm2 reload bili-nexus`  |

## 🔍 故障排查

### 常见问题解决

| 问题现象             | 可能原因                                       | 解决方案                                                               |
| -------------------- | ---------------------------------------------- | ---------------------------------------------------------------------- |
| ❌ Chrome 初始化失败 | 1. Chrome 未安装<br>2. 权限不足<br>3. 配置错误 | 1. 重新安装 Chrome<br>2. 使用 root 权限运行<br>3. 配置为二进制文件路径 |
| ❌ FFmpeg 初始化失败 | 1. FFmpeg 未安装<br>2. 配置错误                | 1. 安装 FFmpeg<br>2. 配置为二进制文件路径                              |
| 📉 录制中断          | 1. 网络波动<br>2. 磁盘空间不足                 | 1. 检查网络稳定性<br>2. 清理磁盘空间                                   |

## 📊 性能监控建议

### 资源监控指标

| 监控项     | 正常范围 | 警报阈值 |
| ---------- | -------- | -------- |
| 内存使用率 | < 80%    | > 90%    |
| CPU 使用率 | < 60%    | > 85%    |
| 磁盘使用率 | < 85%    | > 95%    |
| 网络带宽   | < 80%    | > 95%    |

### 更新 BiliNexus

```bash
# Git Pull
cd /path/to/bili-nexus
git pull

# Node.js 更新
pnpm install
pnpm build
pm2 reload bili-nexus
```

## 📞 获取帮助

### 问题排查流程

1. ✅ 检查 [配置文档](../config/README.md)
2. ✅ 查看服务日志：`pm2 logs bili-nexus` 或 `docker-compose logs -f`
3. ✅ 搜索现有 [Issues](https://github.com/cnxiaozhiy/bili-nexus/issues)

### 社区支持

- 💬 **Discord**：[加入社区](https://discord.gg/YwvRgfsb)
- 💬 **QQ 群**：[加入讨论](https://qm.qq.com/q/P3hYNxchSs)
- 🐛 **提交问题**：[GitHub Issues](https://github.com/cnxiaozhiy/bili-nexus/issues)

### 📚 推荐阅读

1. [QQ 机器人命令手册](../qq-bot/commands.md)
2. [配置详解文档](../config/README.md)
3. [插件开发指南](../plugin-dev/README.md)

## ✅ 部署完成检查清单

- [ ] Chrome/Chromium 已正确安装
- [ ] FFmpeg 已安装并可用
- [ ] 配置文件已根据需求修改
- [ ] QQ 机器人已配置（推荐）
- [ ] 磁盘空间充足（100GB+）
- [ ] 网络带宽满足需求
- [ ] 服务正常运行无报错
- [ ] 测试录制功能正常

<br />

# 恭喜！

### 至此，您的 BiliNexus 已部署完成

_Enjoy it !_

> ⭐ 如果这个项目对您有帮助，欢迎给我们一个 Star！
