/**
 * Wedecode 桌面版 —— preload 桥
 *
 * 仅暴露必要的原生能力给渲染进程, 保持 contextIsolation 有效。
 * 渲染进程 (public/app.js) 本身仍是普通网页, 无需改动一行。
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
   * 主进程主动通知(预留)
   */
  onOpenWorkspacesDir: (handler) => {
    ipcRenderer.on('open-workspaces-dir', () => handler())
  }
})