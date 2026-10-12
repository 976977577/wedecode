import path from "node:path";
import { clearScreen } from "@/utils/common";
import { glob } from "glob";
import { SacnPackagesPathItem, ScanPackagesResultInfo } from "@/typings/index";
import { getAppletIconPath, getAppletIconStats, refreshAppletIconIndex } from "@/utils/wxapp-icon";
import colors from "picocolors";
import prompts from "@/bin/wedecode/inquirer";
import { AppMainPackageNames, globPathList, YesOrNoEnum } from "@/bin/wedecode/enum";
import { findWxAppIdForPath, findWxAppIdPath, getPathSplitList, stopCommander } from "@/bin/wedecode/common";
import fs from "node:fs";
import os from "node:os";

/**
 * 判断是否是个可能扫描大量文件系统的路径
 * */
function inDangerScanPathList(_path: string) {
  _path = path.resolve(_path)
  let partList: string[]
  if (_path.includes(':')) _path = _path.split(':')[1] // 去掉盘符
  partList = getPathSplitList(_path).partList
  return partList.map(s => s.trim()).filter(Boolean).length <= 1
}

/**
 * 通过指定的目录找到该目录下子目录中的所有小程序包
 * */
async function findWxMiniProgramPackDir(manualScanPath: string): Promise<SacnPackagesPathItem[]> {
  const foundPackageList: SacnPackagesPathItem[] = []
  // 异步 glob: 同步版本会把整个 Node 事件循环堵住(实测扫描期间其它接口延迟翻 11 倍)
  const matchedPaths = await glob(path.resolve(manualScanPath, '**/*.wxapkg'), {
    dot: true,
    windowsPathsNoEscape: true,
    nocase: true
  })
  matchedPaths
    .map((_path) => {
      const foundMainPackage = AppMainPackageNames.find(fileName => _path.endsWith(fileName))
      if (foundMainPackage) return _path
      return false
    })
    .filter(Boolean)
    .reduce((pre: string[], cur: string) => {
      if (pre.includes(cur)) return pre
      pre.push(cur)
      return pre
    }, [])
    .forEach(_path => {
      const foundPath = findWxAppIdPath(_path)
      const isFoundWxId = !!foundPath
      let appIdPath = path.dirname(_path)
      const { partList } = getPathSplitList(appIdPath)
      let appId = partList.filter(Boolean).pop() // 默认使用所在文件夹名称
      if (isFoundWxId) {
        appIdPath = foundPath
        // 如果有找到 appId 则使用其作为名称
        appId = findWxAppIdForPath(_path)
      }
      foundPackageList.push({
        isAppId: isFoundWxId,
        appId: appId,
        path: isFoundWxId ? foundPath : appIdPath,
        storagePath: path.dirname(_path)
      })
    })
  return foundPackageList
}

/**
 * 检测微信数据目录是否因缺少系统授权而不可读。
 *
 * macOS 的 TCC 机制: 未授予「完全磁盘访问权限」时, 访问
 * ~/Library/Containers/com.tencent.xinWeChat/ 下的目录会返回 EPERM,
 * 而 glob 遇到无权限目录是静默跳过的 —— 表现为「扫不到任何包且没有任何提示」。
 * 这里主动探测一次, 把权限问题暴露出来, 让界面能给出明确的引导。
 *
 * 探测方式: 从已知的微信数据路径逐级向上找第一个真实存在的祖先目录,
 * 对它做 readdir: EPERM/EACCES => 授权缺失; ENOENT => 继续向上; 能读 => 无问题。
 * (Windows/Linux 无 TCC, 此检测目前仅对 darwin 有意义, 但逻辑平台无关)
 * */
export function detectScanPermissionIssue(): { denied: boolean; deniedPath: string | null } {
  if (process.platform === 'darwin') {
    const home = os.homedir()
    const probes = [
      path.join(home, 'Library/Containers/com.tencent.xinWeChat/Data/.wxapplet/packages'),
      path.join(home, 'Library/Containers/com.tencent.xinWeChat/Data/Documents/app_data/radium/Applet/packages'),
      path.join(home, 'Library/Containers/com.tencent.xinWeChat/Data/Documents/app_data/radium/users'),
    ]
    for (const probe of probes) {
      let cur = probe
      while (cur !== path.dirname(cur)) {
        try {
          fs.readdirSync(cur)
          break // 该探测路径可读, 无权限问题
        } catch (err: any) {
          if (err && (err.code === 'EPERM' || err.code === 'EACCES')) {
            return { denied: true, deniedPath: cur }
          }
          if (err && err.code === 'ENOENT') {
            cur = path.dirname(cur) // 这一层不存在, 向上找
            continue
          }
          break // 其它错误(如 ENOTDIR), 不判定为权限问题
        }
      }
    }
  }
  return { denied: false, deniedPath: null }
}

/**
 * 纯扫描: 在给定目录(或默认的微信包路径)下查找所有小程序主包。
 *
 * 与 CLI 交互流程解耦 —— 不弹提示、不清屏、不退出进程,
 * 因此可以被 Web/桌面端直接调用。返回值按修改时间倒序。
 * */
export async function scanPackagesPure(manualScanPath: string = ''): Promise<SacnPackagesPathItem[]> {
  const scanPathList: string[] = manualScanPath.trim()
    ? [path.resolve(manualScanPath)]
    : globPathList

  // 多个候选路径并发扫描: 墙钟时间取决于最慢的那一个, 而不是全部相加
  const foundPackageList: SacnPackagesPathItem[] = (
    await Promise.all(scanPathList.map(matchPath => findWxMiniProgramPackDir(matchPath)))
  ).flat()

  // 每个包只 stat 一次, 结果挂在 item.mtimeMs 上供排序与展示复用
  await Promise.all(foundPackageList.map(async item => {
    try {
      const stat = await fs.promises.stat(item.storagePath)
      item.mtimeMs = stat.mtimeMs
    } catch {
      // 目录可能已被清理, 保持 0 排在末尾
      item.mtimeMs = 0
    }
  }))

  // 按包所在目录的修改时间倒序(最近用过的排前面)
  return foundPackageList.sort((a, b) => (b.mtimeMs ?? 0) - (a.mtimeMs ?? 0))
}

/**
 * 扫描包并附带展示信息(名字/时间/描述), 供界面列表直接渲染。
 * 不包含任何交互式选择。
 * */
export async function scanPackagesForDisplay(manualScanPath: string = ''): Promise<{
  packages: Array<{
    appId: string
    storagePath: string
    isAppId: boolean
    appName: string
    updateDate: string
    description: string
    nameResolved: boolean
    /** 微信本地缓存中是否存在该小程序的图标 */
    hasIcon: boolean
  }>
  scannedPathList: string[]
  /** 图标索引诊断信息, 便于排查「为什么没图标」 */
  iconStats: { indexed: number; dirs: string[] }
  /** 微信数据目录因缺少「完全磁盘访问权限」等系统授权而不可读 */
  permissionDenied: boolean
  /** 触发权限拒绝的具体目录(诊断用) */
  permissionDeniedPath: string | null
}> {
  const scanPathList: string[] = manualScanPath.trim()
    ? [path.resolve(manualScanPath)]
    : globPathList

  const list = await scanPackagesPure(manualScanPath)

  // 建立本地图标索引(纯本地, 不联网)。必须放在扫描之后,
  // 因为图标目录是从实际扫到的包路径向上推导出来的。
  await refreshAppletIconIndex(list.map(item => item.storagePath))

  // 昵称的唯一来源是第三方付费查询接口, 本项目不接入, 故展示名就是 appid。
  // 整个扫描过程纯本地、不发任何网络请求。
  const packages = await Promise.all(list.map(async item => {
    // 复用扫描时 stat 到的 mtime, 不再二次 stat
    const mtime = item.mtimeMs ? new Date(item.mtimeMs) : new Date()
    return {
      appId: item.appId,
      storagePath: item.storagePath,
      isAppId: item.isAppId,
      appName: item.appId,
      updateDate: `${mtime.getMonth() + 1}/${mtime.getDate()} ${mtime.toLocaleTimeString()}`,
      description: item.storagePath,
      nameResolved: false,
      hasIcon: Boolean(await getAppletIconPath(item.appId))
    }
  }))

  // 扫不到包时, 主动区分「确实没有包」和「没有系统授权读不到」
  const permission = detectScanPermissionIssue()

  return {
    packages,
    scannedPathList: scanPathList,
    iconStats: getAppletIconStats(),
    permissionDenied: permission.denied,
    permissionDeniedPath: permission.deniedPath
  }
}

/**
 * 扫描小程序包 TODO 做降级方案， 如果扫描不到第一次的包，则扩大扫描范围
 * @param manualScanPath 手动输入的 wxapkg 包存放目录，不能是文件
 * */
async function sacnPackages(manualScanPath: string = ''): Promise<SacnPackagesPathItem[]> {
  const foundPackageList = []
  let scanPathList: string[] = globPathList
  if (Boolean(manualScanPath.trim())) {  // 这里空字符串的话将会使用默认 globPathList 列表去匹配
    const absolutePath = path.resolve(manualScanPath)
    if (inDangerScanPathList(absolutePath)) {
      const { dangerScan } = await prompts.showDangerScanPrompt(absolutePath)
      if (dangerScan === YesOrNoEnum.no) {
        stopCommander()
      }
    }
    scanPathList = [absolutePath]
  }
  if (scanPathList.length) {
    console.log(' 扫描中...')
  }

  const scanResults = await Promise.all(
    scanPathList.map(matchPath => findWxMiniProgramPackDir(matchPath))
  )
  scanResults.forEach(foundPList => foundPList.forEach(item => foundPackageList.push(item)))
  // console.log(foundPackageList)

  if (foundPackageList.length === 0) {
    console.log(`
      ${colors.red('未找到小程序包，您需要电脑先访问某个小程序后产生缓存再扫描， 如果还扫描不到请反馈 ')}    
      当前所处目录: $ ${colors.yellow(path.resolve(manualScanPath || './'))}
      
      \u25B6 随着微信版本更新, 新版本小程序路径可能和已知位置不一样, 如果出现问题请到 github 反馈
      \u25B6 提交时请带上您电脑中小程序的 '${colors.bold('微信官方的 wxapkg 包在硬盘中的存放路径')}' 和 '${colors.bold('微信版本号')}'
      \u25B6 https://github.com/biggerstar/wedecode/issues
      `)
    stopCommander()
  }
  return foundPackageList
}

/**
 * 开始进行扫描小程序包流程
 * */
export async function startSacnPackagesProcess(manualScanPath?: string): Promise<ScanPackagesResultInfo> {
  const foundPackageList: SacnPackagesPathItem[] = await sacnPackages(manualScanPath)
  const sortedPackageList = (await Promise.all(
    foundPackageList.map(async item => {
      // 扫描阶段已经 stat 过就直接用, 没有才补一次
      let mtimeMs = item.mtimeMs ?? 0
      if (!mtimeMs) {
        try {
          mtimeMs = (await fs.promises.stat(item.storagePath)).mtimeMs
        } catch {
          mtimeMs = 0
        }
      }
      return { item, mtimeMs }
    })
  )).sort((a, b) => b.mtimeMs - a.mtimeMs)
  // console.log(foundPackageList)
  const columns = [
    {
      name: "名字",
      value: "appName"
    },
    {
      name: "修改时间",
      value: "updateDate"
    },
    {
      name: "描述",
      value: "description"
    },
  ]
  const rows = sortedPackageList
    .map(({ item, mtimeMs }) => {
      const date = new Date(mtimeMs)
      // 昵称需付费接口查询, 本项目不接入, 展示名直接用 appid
      return {
        appName: item.appId,
        updateDate: `${date.getMonth() + 1}/${date.getDate()} ${date.toLocaleTimeString()}`,
        description: item.storagePath
      };
    })
  if (rows.length) {
    clearScreen()
    console.log('$ 选择一个包进行编译: ')
  }
  const result = await prompts.showScanPackTable({
    columns,
    rows
  })
  const foundIndex = rows
    .findIndex(item => item.appName === result.packInfo?.appName)
  const packInfo = { ...rows[foundIndex], ...sortedPackageList[foundIndex].item }
  console.log(`$ 选择了 ${packInfo.appName}( ${packInfo.appId} )`)

  return packInfo
}
