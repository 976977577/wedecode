# Wedecode 桌面版

微信小程序 `wxapkg` 反编译工具的桌面应用封装。

## 设计原则

**不修改 `src/` 任何文件。** 桌面版只是给现有的 `WorkspaceServer`(express + ws)
套一层 Electron 原生外壳,反编译能力与Web UI 完全一致。

```
Electron 主进程 (main.js)
   ↓ 自动挑选空闲端口
   ↓ 拉起现有 WorkspaceServer
   ↓ BrowserWindow 载入 http://127.0.0.1:<port>
现有 public/index.html 界面(原样复用)
```

## 环境要求

- macOS(已验证 arm64 / macOS 27.0)
- Node.js 18+
- 依赖:`vm2@3.9.19`、`jsdom@24`、`express@5` 等均由父项目 `package.json` 管理

## 开发运行

```bash
# 1. 先构建父项目的编译产物(桌面版依赖 dist/)
cd .. && pnpm install && pnpm build

# 2. 再运行桌面版
cd desktop && pnpm install && pnpm start
```

## 打包

```bash
cd desktop

# 仅生成 .app 目录(最快,适合验证)
pnpm build:app# → release/mac-arm64/Wedecode.app

# 生成可分发的 dmg
pnpm build:dmg      # → release/Wedecode-0.1.0.dmg
```

打出的 `.app` **未签名**,首次打开需右键选择「打开」,或在
系统设置 → 隐私与安全性中放行。

## 关键实现说明

| 点 | 做法 | 原因 |
|---|---|---|
| 端口 | 构造前`isPortFree()` 预检, 3000-3049 逐个顺延 | 服务内部 WebSocket 监听失败抛的是 EventEmitter `'error'` 事件, `try/catch` 抓不到, 必须提前规避 |
| 窗口尺寸 | `minWidth420 / minHeight 360`,并记忆上次尺寸 | 桌面工具需适配小屏与分屏;记忆位置存`userData/window-state.json` |
| 就绪等待 | 轮询 `/api/health` 直到返回 200 | 避免窗口先显示白屏 |
| 工作区目录 | `app.getPath('userData')/workspaces` | 放在系统应用数据目录,不污染项目 |
| 进程模型 | 关闭窗口即 `app.quit()` | 桌面应用不应在后台常驻 |
| 单实例 | `requestSingleInstanceLock` | 重复启动时聚焦已有窗口 |
| 外部链接 | `setWindowOpenHandler` 转系统浏览器 | 防止在应用内开新窗口 |
| 路径兼容 | 开发态回溯 `__dirname` 上级, 打包态用 `process.resourcesPath` | 两种形态产物位置不同 |
| 构造函数解析 | 按实例方法签名识别, 不硬编码类名 | vite 压缩后 `workspace-server.js` 导出键仅 `['W']` |

## 文件说明

- `main.js` — 主进程:选端口、拉服务、开窗口、生命周期管理
- `preload.cjs` — contextBridge 安全桥,仅暴露必要原生能力
- `store.cjs` — 界面偏好持久化(目前存窗口尺寸)
- `package.json` — Electron 与 electron-builder 配置
- `pnpm-workspace.yaml` — pnpm 12 构建脚本白名单(与父目录同名文件内容一致)

## 已知限制

- 目前仅配置了 macOS arm64 的 `dir` 与 `dmg` 目标;需Windows/Linux 需补配置
- 未做代码签名与公证,分发给他人时对方需手动放行
- 应用图标使用 Electron 默认图标,可替换 `build/icon.icns`