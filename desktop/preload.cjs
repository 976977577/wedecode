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
   * 弹出系统目录选择框, 返回 Promise<绝对路径 | null(取消)>。
   * 用于设置里的「选择输出目录」; 浏览器模式没有该能力, 前端自动隐藏入口。
   */
  chooseDirectory: () => ipcRenderer.invoke('choose-directory'),

  /**
   * 主进程主动通知(预留)
   */
  onOpenWorkspacesDir: (handler) => {
    ipcRenderer.on('open-workspaces-dir', () => handler())
  }
})