#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { WorkspaceServer } from '@/workspace/workspace-server';
import { Command } from 'commander';

const program = new Command();

program
  .name('wedecode-workspace')
  .description('Wedecode 工作区服务器')
  .version('1.0.0');

program
  .command('start')
  .description('启动工作区服务器')
  .option('-p, --port <port>', '服务器端口', '3000')
  .option('-w, --workspace-dir <dir>', '工作区目录', './workspaces')
  .action(async (options) => {
    const port = parseInt(options.port);
    const workspaceDir = path.resolve(options.workspaceDir);

    console.log('🚀 启动 Wedecode 工作区服务器...');
    console.log(`📁 工作区目录: ${workspaceDir}`);
    console.log(`🌐 端口: ${port}`);
    
    // 确保工作区目录存在
    if (!fs.existsSync(workspaceDir)) {
      fs.mkdirSync(workspaceDir, { recursive: true });
    }
    
    // 启动服务器: 工作区目录显式传入 (环境变量在打包产物里不生效)
    new WorkspaceServer(port, workspaceDir);
  });

// 如果直接运行此文件，则解析命令行参数
if (import.meta.url === `file://${process.argv[1]}`) {
  program.parse();
}

export { WorkspaceServer };