import { DynamicNewCardsMember } from "@/types/bilibili";
import request from "@/utils/request";

export interface SpaceDynamicRenderConfig {
  host: string;
  port: number;
}

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
}
