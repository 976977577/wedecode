import fs from 'node:fs';
import path from 'node:path';
import { printLog } from '@/utils/common';
import { readLocalFile } from '@/utils/fs-process';

/**
 * 小程序信息工具类 —— 只做「本地可读信息」的提取。
 *
 * 注意: 小程序昵称/描述不在 wxapkg 包内, 客户端侧又落在加密的 WCDB 里,
 * 唯一来源是第三方付费查询接口 (open.kainy.cn), 本项目已明确不接入,
 * 因此列表只显示 appid。这里不做任何网络请求。
 */
export class WxAppInfoUtils {
  /**
   * 从app.json文件中提取appid
   * @param appJsonPath app.json文件路径
   * @returns appid或null
   */
  static extractAppIdFromAppJson(appJsonPath: string): string | null {
    try {
      if (!fs.existsSync(appJsonPath)) {
        return null;
      }

      const appJsonContent = readLocalFile(appJsonPath);
      if (!appJsonContent) {
        return null;
      }

      const appJson = JSON.parse(appJsonContent);
      return appJson.appid || null;
    } catch (error) {
      console.warn('解析app.json失败:', error.message);
      return null;
    }
  }

  /**
   * 从app-config.json文件中提取appid
   * @param appConfigPath app-config.json文件路径
   * @returns appid或null
   */
  static extractAppIdFromConfig(appConfigPath: string): string | null {
    try {
      if (!fs.existsSync(appConfigPath)) {
        return null;
      }

      const appConfigContent = readLocalFile(appConfigPath);
      if (!appConfigContent) {
        return null;
      }

      const appConfig = JSON.parse(appConfigContent);
      return appConfig.appid || appConfig.extAppid || null;
    } catch (error) {
      console.warn('解析app-config.json失败:', error.message);
      return null;
    }
  }

  /**
   * 从多个来源提取小程序ID（只从app.json中提取）
   * @param outputPath 输出路径
   * @returns appid或null
   */
  static extractAppIdFromMultipleSources(outputPath: string): string | null {
    // 首先尝试从app.json中提取
    const appJsonPath = path.join(outputPath, 'app.json');
    let appId = this.extractAppIdFromAppJson(appJsonPath);
    
    if (appId) {
      printLog(`📱 从app.json中找到appid: ${appId}`, { isEnd: true });
      return appId;
    }

    return null;
  }

}