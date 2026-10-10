/**
 * Wedecode 桌面版 —— preload 桥
 *
 * 仅暴露必要的原生能力给渲染进程, 保持 contextIsolation 有效。
 * 渲染进程 (public/app.js) 通过 window.wedecodeDesktop 可选地使用这些能力,
 * 浏览器直接访问时该对象不存在, 功能自动降级。
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('wedecodeDesktop', {
  isDesktop: true,
  platform: process.platform,

  /**
   * 在系统文件管理器中打开工作区目录。
   * 由主进程菜单的「打开工作区目录」触发。
   */
  openWorkspacesDir: () => ipcRenderer.send('open-workspaces-dir'),

  /**
   * 在系统文件管理器中打开指定目录 (仅限工作区目录内, 主进程侧校验)。
   * 返回 Promise<{ success: boolean, error?: string }>。
   */
  openPath: (targetPath) => ipcRenderer.invoke('open-path', targetPath),

  /**
   * 主进程主动通知(预留)
   */
  onOpenWorkspacesDir: (handler) => {
    ipcRenderer.on('open-workspaces-dir', () => handler())
  }
})