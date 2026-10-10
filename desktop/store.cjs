/**
 * 桌面版的极简持久化存储。
 *
 * 只存界面偏好(如窗口尺寸), 不存反编译产物 —— 那些由 WorkspaceServer
 * 放在 userData/workspaces 下。
 */
const { app } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

const FILE = path.join(app.getPath('userData'), 'window-state.json')

const DEFAULTS = {
  windowBounds: { width: 1280, height: 900 }
}

function read () {
  try {
    if (!fs.existsSync(FILE)) return { ...DEFAULTS }
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(FILE, 'utf-8')) }
  } catch {
    return { ...DEFAULTS }
  }
}

function write (data) {
  try {
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf-8')
  } catch (err) {
    // 持久化失败不应影响使用
    console.warn('保存窗口状态失败:', err.message)
  }
}

const cache = read()

module.exports = {
  get: key => cache[key],
  set (key, value) {
    cache[key] = value
    write(cache)
  }
}