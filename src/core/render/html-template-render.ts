import fs from "fs";
import ejs from "ejs";
import path from "path";
import getLogger from "@/utils/logger";
import { HtmlTemplateRenderError } from "@/types/errors/html-template-render";
import { htmlRender } from "@/common";

const logger = getLogger("HtmlTemplatesRender");

export interface Templates {
  help: {};
  live_status_landscape: {
    status: 0 | 1 | 2;
    background_image: string;
    cover_image: string;
    parent_area_name: string;
    area_name: string;
    live_time: string;
    title: string;
    description: string;
    popularity: string;
    duration: string;
    liveHash: string;
  };
  record_start: {};
  record_end: {};
  record_error: {};
}

export default class HtmlTemplateRender {
  private readonly templatesDir: string;
  private readonly htmlRender = htmlRender;

  constructor(templatesDir: string) {
    this.templatesDir = path.resolve(templatesDir);
    logger.debug(`模板目录: ${this.templatesDir}`);
  }

  public async render<K extends keyof Templates>(
    templateName: K,
    data: Templates[K]
  ) {
    const templateHtmlCode = fs.readFileSync(
      path.resolve(this.templatesDir, `${templateName}.ejs`),
      "utf-8"
    );

    data = {
      ...{ FONT_PATH_AaCute: this.htmlRender.getResourceUrl("AaCute.woff") },
      ...data,
    };

    logger.debug(`渲染模板 -> ${templateName}, 数据: ${JSON.stringify(data)}`);

    const html = ejs.render(templateHtmlCode, data);
    const resp = await this.htmlRender.renderHtmlCodeToBase64(html);
    logger.debug(`渲染模板 -> ${templateName} -> OK ✅`);
    return resp;
  }

  public async newDynamic(dynamicId: number | string) {
    const bowser = this.htmlRender.getBrowser();
    if (!bowser) throw new HtmlTemplateRenderError("浏览器未初始化");

    const page = await bowser.newPage();
    await page.goto(`https://t.bilibili.com/${dynamicId}`, {});

    try {
      await page.waitForSelector("#bili-header-container");
      await page.waitForSelector("#app > div.content > div.card");

      const card = await page.$("#app > div.content > div.card");

      if (!card) throw new HtmlTemplateRenderError("未找到动态卡片");

      await page.evaluate(() => {
        // @ts-ignore
        document.querySelector("#bili-header-container").remove();
        // @ts-ignore
        document
          .querySelector(
            "#app > div.content > div.card > div.bili-tabs.dyn-tabs"
          )
          .remove();
        // @ts-ignore
        document.querySelector("#app > div.content > div.card").style[
          "padding-bottom"
        ] = "20px";
        // @ts-ignore
        document.querySelector("#app > div.content > div.card").style[
          "border-radius"
        ] = "0px";
      });

      return await card.screenshot({ encoding: "base64" });
    } finally {
      page.close();
    }
  }
}
