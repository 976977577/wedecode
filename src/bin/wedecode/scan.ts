import path from "node:path";
import { clearScreen } from "@/utils/common";
import { glob } from "glob";
import { SacnPackagesPathItem, ScanPackagesResultInfo } from "@/typings/index";
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
function findWxMiniProgramPackDir(manualScanPath: string) {
  const foundPackageList: SacnPackagesPathItem[] = []
  glob.globSync(path.resolve(manualScanPath, '**/*.wxapkg'), {
    dot: true,
    windowsPathsNoEscape: true,
    nocase: true
  })
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
 * 纯扫描: 在给定目录(或默认的微信包路径)下查找所有小程序主包。
 *
 * 与 CLI 交互流程解耦 —— 不弹提示、不清屏、不退出进程,
 * 因此可以被 Web/桌面端直接调用。返回值按修改时间倒序。
 * */
export function scanPackagesPure(manualScanPath: string = ''): SacnPackagesPathItem[] {
  const scanPathList: string[] = manualScanPath.trim()
    ? [path.resolve(manualScanPath)]
    : globPathList

  const foundPackageList: SacnPackagesPathItem[] = []
  scanPathList.forEach(matchPath => {
    findWxMiniProgramPackDir(matchPath).forEach(item => foundPackageList.push(item))
  })

  // 按包所在目录的修改时间倒序(最近用过的排前面)
  return [...foundPackageList]
    .map(item => {
      let mtimeMs = 0
      try {
        mtimeMs = fs.statSync(item.storagePath).mtimeMs
      } catch {
        // 目录可能已被清理, 保持 0 排在末尾
      }
      return { item, mtimeMs }
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .map(({ item }) => item)
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
  }>
  scannedPathList: string[]
}> {
  const scanPathList: string[] = manualScanPath.trim()
    ? [path.resolve(manualScanPath)]
    : globPathList

  const list = scanPackagesPure(manualScanPath)

  // 昵称的唯一来源是第三方付费查询接口, 本项目不接入, 故展示名就是 appid。
  // 整个扫描过程纯本地、不发任何网络请求。
  const packages = list.map(item => {
    let mtime = new Date()
    try {
      mtime = fs.statSync(item.storagePath).mtime
    } catch {
      // 目录可能已被清理
    }
    return {
      appId: item.appId,
      storagePath: item.storagePath,
      isAppId: item.isAppId,
      appName: item.appId,
      updateDate: `${mtime.getMonth() + 1}/${mtime.getDate()} ${mtime.toLocaleTimeString()}`,
      description: item.storagePath,
      nameResolved: false
    }
  })

  return {
    packages,
    scannedPathList: scanPathList
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

  scanPathList.forEach(matchPath => {
    const foundPList = findWxMiniProgramPackDir(matchPath)
    foundPList.forEach(item => foundPackageList.push(item))
  })
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
  const sortedPackageList = [...foundPackageList]
    .map(item => ({
      item,
      statInfo: fs.statSync(item.storagePath)
    }))
    .sort((a, b) => b.statInfo.mtimeMs - a.statInfo.mtimeMs)
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
    .map(({ item, statInfo }) => {
      const date = new Date(statInfo.mtime)
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
