export const isWindows = /^win/.test(process.platform);
export const isMac = /^darwin/.test(process.platform);

/**
 * 小程序信息查询接口 (按 appid 查昵称/描述/头像等)。
 *
 * 旧接口 https://kainy.cn/api/weapp/info/ 已无法访问 (实测被 Cloudflare 403 拦截),
 * 现改用官方新域名 open.kainy.cn, 鉴权方式为请求头 x-api-key。
 * key 可在 https://open.kainy.cn/register/ 自行申请后替换下面的值。
 * */
export const WXAPP_QUERY_API = 'https://open.kainy.cn/api/AppidQuery';
export const WXAPP_QUERY_API_KEY = '26c0418c202032f5537dcac8836a06a756f6a952274e0d5b721c0d03f105d101';

export const cssBodyToPageReg = /body\s*\{/g

/**
 * 默认输出路径， 基于 inputPath 路径
 * */
export const PUBLIC_OUTPUT_PATH = 'OUTPUT'
/**
 * 插件目录统一重命名映射
 * */
export const pluginDirRename = ['__plugin__', 'plugin_']

/**
 * 清理缓存时移除文件的命中关键词，需要保证唯一特殊性
 * */
export const removeAppFileList = [
  // 'app-config.json',
  'page-frame.html',
  'app-wxss.js',
  'app-service.js',
  'index.appservice.js',
  'index.webview.js',
  'appservice.app.js',
  'page-frame.js',
  'webview.app.js',
  'common.app.js',
  // 'plugin.json',
]

export const removeGameFileList = [
  // 'app-config.json',
  // 'game.js',
  'subContext.js',
  'worker.js',
]

export const appJsonExcludeKeys = [
  'navigateToMiniProgramAppIdList',
]

export const GameJsonExcludeKeys = [
  'openDataContext',
]
