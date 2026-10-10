import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { glob } from 'glob';

/**
 * 微信小程序本地图标探测。
 *
 * 微信会把每个小程序的图标单独缓存到一个 icon 目录里, 且该目录就在我们所扫描的
 * packages 目录的同级。已知形态(多来源交叉验证):
 *
 *   macOS 3.x   ~/Library/Containers/com.tencent.xinWeChat/Data/.wxapplet/icon
 *   macOS 4.x   .../Documents/app_data/radium/Applet/icon
 *   macOS 4.1.7 .../Documents/app_data/radium/users/<hash>/applet/icon
 *   Windows 4.x %AppData%\Tencent\xwechat\radium\Applet\icon
 *
 * 文件命名规则为 <appid>_<hash>.png (例如 wxd45c635d754dbf59_ffc1df56d2b795a6f14b13501dcec670.png),
 * 下划线前半段即 appid, 因此可以纯本地、离线地从 appid 反查图标, 无需任何网络请求。
 *
 * 另有一份图标缓存在 xwechat_files/<账号>/cache/<YYYY-MM>/WeAppIcon/, 一并纳入。
 *
 * 与昵称不同: 昵称由微信服务端下发且落在加密的 SQLite(WCDB) 里, 本地取不到明文,
 * 所以只有图标能做到 100% 本地化。
 */

/** 视为图标的扩展名 */
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.ico']);

/** 图标目录的已知位置模式(兜底用, 优先从实际扫到的包路径推导) */
const macIconDirPatterns: string[] = [
  '/Users/*/Library/Containers/*/Data/.wxapplet/icon',
  '/Users/*/Library/Containers/*/Data/Documents/app_data/radium/Applet/icon',
  '/Users/*/Library/Containers/*/Data/Documents/app_data/radium/users/*/applet/icon',
  '/Users/*/Library/Containers/*/Data/Documents/xwechat_files/*/cache/*/WeAppIcon',
];

const winIconDirPatterns: string[] = [
  'C:/Users/*/AppData/Roaming/*/xwechat/radium/Applet/icon',
  'C:/Users/*/AppData/Roaming/*/xwechat/radium/users/*/applet/icon',
  'C:/Users/*/Documents/WeChat Files/*/Applet/icon',
  'C:/Users/*/AppData/Roaming/*/xwechat_files/*/cache/*/WeAppIcon',
];

function platformIconDirPatterns(): string[] {
  switch (os.platform()) {
    case 'darwin':
      return macIconDirPatterns;
    case 'win32':
      return winIconDirPatterns;
    default:
      return [];
  }
}

/** 是否为图片文件 */
function isImageFile(fileName: string): boolean {
  return IMAGE_EXT.has(path.extname(fileName).toLowerCase());
}

/**
 * 从图标文件名中提取 appid。
 * 规则: wx 开头 + 16 位字符, 其后必须是分隔符(_ - .)或文件名结束,
 * 避免 wx1234567890123456_extra 之外的同名前缀误匹配。
 */
function extractAppIdFromIconName(fileName: string): string | null {
  const matched = fileName.match(/^(wx[0-9a-z]{16})(?:[_.\-]|$)/i);
  return matched ? matched[1] : null;
}

/**
 * 从小程序包所在目录向上推导 applet 根目录。
 * 目录结构形如 <appletRoot>/packages/<appid>/<version>/__APP__.wxapkg,
 * 因此找到名为 packages 的那一层, 其父目录即 applet 根目录。
 */
function deriveAppletRoot(storagePath: string): string | null {
  let current = path.resolve(storagePath);
  for (let depth = 0; depth < 8; depth++) {
    if (path.basename(current).toLowerCase() === 'packages') {
      return path.dirname(current);
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

/** 收集所有可能存放图标的目录(去重, 且仅保留真实存在的目录) */
function collectIconDirs(scanStoragePaths: string[]): string[] {
  const dirSet = new Set<string>();

  // 1) 从实际扫到的包路径推导 —— 最可靠, 天然跟随微信版本变化
  scanStoragePaths.forEach(storagePath => {
    const appletRoot = deriveAppletRoot(storagePath);
    if (!appletRoot) return;
    ['icon', 'icons', 'Icon'].forEach(name => dirSet.add(path.join(appletRoot, name)));
  });

  // 2) 已知位置模式兜底 —— 处理推导不出来或目录名不同的情况
  platformIconDirPatterns().forEach(pattern => {
    try {
      glob.globSync(pattern, { dot: true, windowsPathsNoEscape: true, nocase: true })
        .forEach(dir => dirSet.add(dir));
    } catch {
      // glob 在路径不可读时可能抛错, 忽略即可
    }
  });

  // 必须真的能列举才算可用: 某些系统(如 macOS 未授权完全磁盘访问时)
  // stat 能过但 readdir 会被 EPERM 拒绝, 这类目录留着只会让诊断信息失真
  return [...dirSet].filter(dir => {
    try {
      fs.readdirSync(dir);
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * 建立 appid -> 图标文件路径 的索引。
 *
 * @param scanStoragePaths 本次扫描得到的包所在目录, 用于推导 applet 根目录
 * @returns 索引, 以及用于诊断的目录清单
 */
export function buildAppletIconIndex(scanStoragePaths: string[] = []): {
  index: Map<string, string>;
  dirs: string[];
} {
  const dirs = collectIconDirs(scanStoragePaths);
  const index = new Map<string, string>();

  dirs.forEach(dir => {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    entries.forEach(entry => {
      if (!entry.isFile() || !isImageFile(entry.name)) return;
      const appid = extractAppIdFromIconName(entry.name);
      if (!appid) return;

      const filePath = path.join(dir, entry.name);
      const previous = index.get(appid);
      if (!previous) {
        index.set(appid, filePath);
        return;
      }
      // 同一 appid 存在多份缓存时, 保留修改时间较新的那份
      try {
        if (fs.statSync(filePath).mtimeMs > fs.statSync(previous).mtimeMs) {
          index.set(appid, filePath);
        }
      } catch {
        // 读取失败时保留已有项
      }
    });
  });

  return { index, dirs };
}

/* ---------------------------------- 进程内缓存 ---------------------------------- */

let cachedIndex: Map<string, string> | null = null;
let cachedDirs: string[] = [];

/** 重建图标索引(每次扫描后调用, 以便跟随实际扫到的路径推导) */
export function refreshAppletIconIndex(scanStoragePaths: string[] = []): void {
  const { index, dirs } = buildAppletIconIndex(scanStoragePaths);
  cachedIndex = index;
  cachedDirs = dirs;
}

/** 查询本地图标路径, 未命中返回 null */
export function getAppletIconPath(appid: string): string | null {
  if (!cachedIndex) {
    // 尚未扫描过(例如直接访问图标接口), 用兜底模式建一次
    refreshAppletIconIndex();
  }
  const target = cachedIndex?.get(appid);
  if (!target) return null;
  try {
    return fs.existsSync(target) ? target : null;
  } catch {
    return null;
  }
}

/** 诊断信息: 索引了多少个 appid、扫描了哪些目录 */
export function getAppletIconStats(): { indexed: number; dirs: string[] } {
  return {
    indexed: cachedIndex?.size || 0,
    dirs: cachedDirs
  };
}
