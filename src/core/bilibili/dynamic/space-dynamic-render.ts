import { DynamicNewCardsMember } from "@/types/bilibili";
import getLogger from "@/utils/logger";
import request from "@/utils/request";

export interface SpaceDynamicRenderConfig {
  host: string;
  port: number;
}

const logger = getLogger("SpaceDynamicRender");

export default class SpaceDynamicRender {
  static async render(renderConfig: SpaceDynamicRenderConfig, card: DynamicNewCardsMember, cookie: string): Promise<string> {
    const resp = await request.post<{
      code: number;
      message: string;
      data: {
        base64: string;
      };
    }>(
      `http://${renderConfig.host}:${renderConfig.port}/render`,
      {},
      {
        card,
        cookie,
      }
    );

    if (resp.data.code !== 0) throw new Error(resp.data.message);

    return resp.data.data.base64;
  }

  static async health(renderConfig: SpaceDynamicRenderConfig): Promise<boolean> {
    try {
      const resp = await request.get<{
        code: number;
        message: string;
      }>(`http://${renderConfig.host}:${renderConfig.port}/health`);

      if (resp.data.code !== 0) throw new Error(resp.data.message);

      return true;
    } catch (e) {
      logger.error(`SpaceDynamicRender health check failed: ${e}`);
      return false;
    }
  }
}
