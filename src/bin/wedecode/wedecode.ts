#!/usr/bin/env node

import { Command } from 'commander';
import pkg from '../../../package.json';
import {clearScreen, printLog, sleep} from "@/utils/common";
import {
  createSlogan
} from "@/bin/wedecode/common";
import {startMainCommanderProcess} from "@/bin/wedecode/main-commander-process";
import { WorkspaceServer } from "@/workspace/workspace-server";

const program = new Command();

program
  .name('wedecode')
  .usage("<command> [options]")
  .description('\u25B6 wxapkg 反编译工具')
  .version(pkg.version)
  .option("-o, --out <out-path>", '指定编译输出地目录， 正常是主包目录')
  .option("--open-dir", ' 结束编译后打开查看产物目录')
  .option("--clear", '是否清空旧的产物')
  .option("--px", '是否使用 px 像素单位解析 css， 默认使用的是 rpx 单位')
  .option("--unpack-only", '是否只进行解包，不进行反编译')
  .option("--wxid <wxid>", '指定微信小程序的 WXID，用于解密加密的 wxapkg 包')
  .action(async (argMap: Record<any, any>, options: Record<any, any>) => {
    await sleep(200)
    const args = options.args || []
    clearScreen()
    await sleep(100)
    printLog(createSlogan(), {isStart: true});
    /* ----------------------------------开始交互页面------------------------------------- */
    await startMainCommanderProcess(args, argMap)
    process.exit(0)
  })

// 添加 ui 子命令
program
  .command('ui')
  .description('启动 Web UI 界面')
  .option('-p, --port <port>', '指定服务器端口', '3000')
  .action(async (options) => {
    const port = parseInt(options.port);
    
    clearScreen()
    await sleep(100)
    printLog(createSlogan(), {isStart: true});
    // 启动服务器
    new WorkspaceServer(port);
  })

// 必须显式指定 from:'node': commander 见到 process.versions.electron 会切到
// 'electron' 参数约定, 而打包后的 app 里 process.defaultApp 为 undefined,
// 导致 argv.slice(1) —— 脚本路径 dist/wedecode.js 被当成位置参数(输入包),
// 表现为「检测到加密包但无法提取 wxid」。本入口只会以 node / ELECTRON_RUN_AS_NODE
// 模式运行(桌面版 spawn 时已设 ELECTRON_RUN_AS_NODE=1), argv 恒为 node 格式。
program.parse(process.argv, { from: 'node' });
