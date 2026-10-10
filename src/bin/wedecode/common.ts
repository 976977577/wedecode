import fs from "node:fs";
import { isWxAppid, printLog, sleep } from "@/utils/common";
import path from "node:path";
import {glob} from "glob";
import {
  CacheClearEnum
} from "@/bin/wedecode/enum";
import prompts from "@/bin/wedecode/inquirer";
import colors from "picocolors";
import figlet from "figlet";
import process from "node:process";
import axios from "axios";


/**
 * 创建 slogan 大字横幅
 * */
export function createSlogan(str: string = '    wedecode'): string {
  const slogan = figlet.textSync(str, {
    horizontalLayout: "default",
    verticalLayout: "default",
    whitespaceBreak: true,
  })
  return colors.bold(colors.yellow(slogan))
}

/**
 * 询问是否清空旧产物
 * @param {Boolean} isClear 外部指定是否进行清空
 * @param inputPath
 * @param outputPath
 * */
export async function startCacheQuestionProcess(isClear: boolean, inputPath: string, outputPath: string): Promise<void> {
  const OUTPUT_PATH = path.resolve(outputPath)
  if (fs.existsSync(OUTPUT_PATH)) {
    const isClearCache = isClear ? CacheClearEnum.clear : (await prompts.isClearOldCache(OUTPUT_PATH))['isClearCache']
    if (isClearCache === CacheClearEnum.clear || isClear) {
      fs.rmSync(OUTPUT_PATH, { recursive: true })
      printLog(`\n \u25B6 移除旧产物成功 `)
    }
  }
}

export function checkExistsWithFilePath(targetPath: string, opt: {
  throw?: boolean,
  checkWxapkg?: boolean,
  showInputPathLog?: boolean
}): boolean {
  const { throw: isThrow = true, checkWxapkg = true, showInputPathLog = true } = opt || {}
  const printErr = (log: string) => {
    if (showInputPathLog) {
      console.log('\n输入路径: ', colors.yellow(path.resolve(targetPath)));
    }
    isThrow && console.log(`${colors.red(`\u274C   ${log}`)}\n`)
  }
  if (!fs.existsSync(targetPath)) {
    printErr('文件 或者 目录不存在, 请检查!')
    return false
  }
  if (checkWxapkg) {
    const isDirectory = fs.statSync(targetPath).isDirectory()
    if (isDirectory) {
      const wxapkgPathList = glob.globSync(`${targetPath}/*.wxapkg`)
      if (!wxapkgPathList.length) {
        console.log(
          '\n',
          colors.red('\u274C  文件夹下不存在 .wxapkg 包'),
          colors.yellow(path.resolve(targetPath)),
          '\n')
        return false
      }
    }
  }
  return true
}

export function stopCommander() {
  console.log(colors.red('\u274C  操作已主动终止!'))
  process.exit(0)
}

/**
 * 获取 win mac linux 路径分割列表
 * */
export function getPathSplitList(_path: string) {
  let delimiter = '\\'
  let partList: string[]
  partList = _path.split('\\') // win 
  if (partList.length <= 1) {
    delimiter = '/'
    partList = _path.split('/') // win 第二种路径或者 unix 路径
  }
  return {
    partList,
    delimiter
  }
}

export function findWxAppIdPath(_path: string) {
  const { partList, delimiter } = getPathSplitList(_path)
  let newPathList = [...partList]
  for (const index in partList.reverse()) {
    const dirName = partList[index]
    if (isWxAppid(dirName)) {
      break
    }
    newPathList.pop()
  }
  return newPathList.join(delimiter).trim()
}

export function findWxAppIdForPath(_path: string) {
  return path.parse(findWxAppIdPath(_path)).name
}

export async function internetAvailable() {
  return axios
    .request({
      url: 'https://bing.com',
      maxRedirects: 0,
      timeout: 2000,
      validateStatus: () => true
    })
    .then(() => true)
    .catch(() => Promise.resolve(false))
}
