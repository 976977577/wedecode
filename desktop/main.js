/**
 * Wedecode 桌面版 —— Electron 主进程
 *
 * 设计要点:
 * 1. 不修改 src/ 任何文件, 直接复用现有 WorkspaceServer (express + ws)
 * 2. 自动挑选空闲端口, 避免与用户已开的服务冲突
 * 3. 关闭窗口即停止服务, 不留后台残留进程
 * 4. 工作区数据放在 Electron userData 下, 不污染项目目录
 */

const { app, BrowserWindow, shell, dialog, Menu, ipcMain } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const http = require('node:http')
const store = require('./store.cjs')

// electron-builder 打包后:
//   __dirname         = Contents/Resources/app.asar (仅含 main.js / preload.cjs)
//   process.resourcesPath = Contents/Resources  →  extraResources 把 dist 与 public 放在 resources/app/ 下
// 开发态下 dist 与 public 在项目根目录, 故回溯 __dirname 的上级
const isPackaged = app.isPackaged
const appRoot = isPackaged ? path.join(process.resourcesPath, 'app') : path.join(__dirname, '..')

let mainWindow = null
let workspaceServer = null
let serverPort = null

/**
 * 等待 HTTP 服务就绪, 避免窗口打开时白屏。
 */
function waitForServer (port, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const probe = () => {
      http
        .get({ host: '127.0.0.1', port, path: '/api/health', timeout: 1000 }, res => {
          res.resume()
          if (res.statusCode && res.statusCode < 500) return resolve()
          retry()
        })
        .on('error', retry)
        .on('timeout', function () {
          this.destroy()
          retry()
        })
    }
    const retry = () => {
      if (Date.now() - start > timeout) {
        return reject(new Error('本地服务启动超时'))
      }
      setTimeout(probe, 250)
    }
    probe()
  })
}

/**
 * 启动内置的 WorkspaceServer (复用 src/workspace/workspace-server.ts)
 */
async function startWorkspaceServer () {
  // 工作区根目录: 显式传给 WorkspaceServer。
  // 不能只依赖 process.env.WORKSPACE_ROOT —— vite 以 browser 平台打包时会把
  // `process.env` 静态替换为构建时快照, 运行时设置的环境变量不会生效
  // (实测产物里变成 define_process_env_default, 服务端只能回退到 cwd/workspaces,
  // 导致工作区被写到应用启动目录, 打包后甚至可能写到 app 包内或根目录)。
  const userDataDir = app.getPath('userData')
  const workspacesDir = path.join(userDataDir, 'workspaces')
  fs.mkdirSync(workspacesDir, { recursive: true })

  // 打包产物在 resources/app/dist 下, 开发态在项目根的 dist 下
  const candidates = [
    path.join(appRoot, 'dist/workspace/workspace-server.js'),
    path.join(appRoot, 'dist/workspace/workspace-server.cjs'),
    path.join(__dirname, '../dist/workspace/workspace-server.js'),
  ]
  const serverEntry = candidates.find(p => fs.existsSync(p))
  if (!serverEntry) {
    throw new Error(`未找到编译产物, 请先执行 pnpm build\n已查找:\n${candidates.join('\n')}`)
  }

  const mod = await import(`file://${serverEntry}`)

  // vite 打包时 exports:'named' + preserveModules:false 会把所有模块合并,
  // 类名被压缩成 W / E 之类的短名(实测 workspace-server.js 导出键仅 ['W'])。
  // 因此按「实例方法签名」识别, 而不是硬编码被压缩的名字。
  const WorkspaceServer = mod.WorkspaceServer || findByShape(mod)
  if (typeof WorkspaceServer !== 'function') {
    throw new Error(`WorkspaceServer 未找到, 模块实际导出: ${Object.keys(mod).join(', ')}`)
  }

  // 端口占用必须在new 之前预检: WorkspaceServer 内部的 WebSocketServer
  // 监听失败时抛的是 EventEmitter 的 'error' 事件而非同步异常,
  // try/catch 抓不到, 会直接冒泡成未捕获错误让进程崩溃。
  let lastError = null
  for (let port = 3000; port < 3050; port++) {
    if (!(await isPortFree(port))) continue
    try {
      const instance = new WorkspaceServer(port, workspacesDir)
      await waitForServer(port)
      workspaceServer = instance
      serverPort = port
      return port
    } catch (err) {
      lastError = err
      if (err && err.code === 'EADDRINUSE') continue
      throw err
    }
  }
  throw new Error(`3000-3049 范围内无可用端口: ${lastError && lastError.message}`)
}

/**
 * 用一次真实的 bind/listen/close 判断端口是否空闲。
 * 与 WorkspaceServer 的监听方式(http server + WebSocketServer)保持一致。
 */
function isPortFree (port) {
  return new Promise(resolve => {
    const tester = http.createServer()
    tester.once('error', () => resolve(false))
    tester.once('listening', () => tester.close(() => resolve(true)))
    tester.listen(port)
  })
}

/**
 * 从模块导出里找出 WorkspaceServer: 唯一拥有 setupMiddleware/setupRoutes
 * 这组实例方法的构造函数。
 */
function findByShape (mod) {
  const MARKERS = ['setupMiddleware', 'setupRoutes', 'setupWebSocket']
  return Object.values(mod).find(
    value =>
      typeof value === 'function' &&
      MARKERS.every(m => typeof value.prototype?.[m] === 'function')
  )
}

/**
 * 渲染进程请求弹出系统目录选择框 (设置里的「选择输出目录」)。
 * 返回所选目录绝对路径, 取消返回 null。
 */
ipcMain.handle('choose-directory', async () => {
  const win = BrowserWindow.getAllWindows()[0]
  const result = await dialog.showOpenDialog(win, {
    title: '选择反编译输出目录',
    properties: ['openDirectory', 'createDirectory']
  })
  return result.canceled ? null : result.filePaths[0]
})

function createWindow (port) {
  const saved = store.get('windowBounds') || { width: 1280, height: 900 }

  mainWindow = new BrowserWindow({
    width: saved.width,
    height: saved.height,
    x: saved.x,
    y: saved.y,
    minWidth: 420,
    minHeight: 360,
    resizable: true,
    maximizable: true,
    fullscreenable: true,
    title: 'Wedecode',
    backgroundColor: '#667eea',
    show: false,
    // hiddenInset 会连标题栏的可拖动区域一起隐藏, 导致窗口无法拖动。
    // 改用 hidden: 红绿灯按钮保留, 页面顶部通过 -webkit-app-region: drag 提供拖动区。
    titleBarStyle: process.platform === 'darwin' ? 'hidden' : 'default',
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false // 需要 require 以加载 dist 产物
    }
  })

  mainWindow.loadURL(`http://127.0.0.1:${port}/`)

  // 记住上次窗口尺寸: 用户调整后持久化, 下次启动恢复。
  // 仅在非最小化/最大化状态下记录, 避免把最大化尺寸存进去。
  const saveBounds = () => {
    if (!mainWindow || mainWindow.isMinimized() || mainWindow.isMaximized()) return
    store.set('windowBounds', mainWindow.getNormalBounds())
  }
  mainWindow.on('resized', saveBounds)
  mainWindow.on('moved', saveBounds)
  mainWindow.on('close', saveBounds)

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  // 外部链接走系统浏览器, 不在应用内开新窗口
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function buildMenu () {
  const isMac = process.platform === 'darwin'
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: '文件',
      submenu: [
        {
          label: '打开工作区目录',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => {
            if (!mainWindow) return
            mainWindow.webContents.send('open-workspaces-dir')
          }
        },
        { type: 'separator' },
        isMac ? { role: 'close', label: '关闭窗口' } : { role: 'quit', label: '退出' }
      ]
    },
    { role: 'editMenu', label: '编辑' },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' }
      ]
    },
    { role: 'windowMenu', label: '窗口' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// 单实例: 再次启动时聚焦已有窗口
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    try {
      const port = await startWorkspaceServer()
      buildMenu()
      createWindow(port)
      console.log(`Wedecode 桌面版已启动: http://127.0.0.1:${port}`)
    } catch (err) {
      dialog.showErrorBox('启动失败', String(err && err.message ? err.message : err))
      app.quit()
    }
  })

  app.on('window-all-closed', () => {
    // 关闭所有窗口即退出(桌面应用不应常驻后台)
    app.quit()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && serverPort) {
      createWindow(serverPort)
    }
  })
}