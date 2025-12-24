import getLogger from "@/utils/logger";
import puppeteer, {
  Browser,
  LaunchOptions,
  ScreenshotOptions,
} from "puppeteer-core";
import { HtmlRenderError } from "@/types/errors/html-render";

import express from "express";
import cors from "cors";
import path from "path";

const resourcePath = path.join(process.cwd(), "templates/resource");

const app = express();
app.use(cors());
app.use("/resource", express.static(resourcePath));

const logger = getLogger("HtmlRender");

// 任务队列类
class TaskQueue {
  private queue: Array<{
    task: () => Promise<any>;
    resolve: (value: any) => void;
    reject: (reason?: any) => void;
  }> = [];
  private isProcessing = false;

  async enqueue<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this.processNext();
    });
  }

  private async processNext() {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;
    const { task, resolve, reject } = this.queue.shift()!;

    try {
      const result = await task();
      resolve(result);
    } catch (error) {
      reject(error);
    } finally {
      this.isProcessing = false;
      this.processNext();
    }
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  isBusy(): boolean {
    return this.isProcessing;
  }
}

export default class HtmlRender {
  private browser: Browser | null = null;
  private server = app.listen(0);
  private taskQueue = new TaskQueue();

  constructor() {
    logger.debug(
      "资源服务器启动 -> ",
      this.server.address(),
      `, resourcePath: ${resourcePath}`
    );
  }

  public async setBrowser(browser: Browser) {
    this.browser = browser;
  }

  public getResourceUrl(resource: string) {
    const address = this.server.address();
    if (address == null) throw new HtmlRenderError("资源服务器未启动");
    if (typeof address === "string")
      throw new HtmlRenderError(
        "server listening on a pipe or Unix domain socket"
      );
    return `http://localhost:${address.port}/resource/${resource}`;
  }

  public async init(launchOption: LaunchOptions) {
    this.browser = await puppeteer.launch(launchOption);
    // TEST
    await this.renderHtmlCodeToBase64("<h1>TEST PAGE</h1>");
    logger.info("浏览器初始化成功");

    process.on("SIGINT", async () => {
      logger.warn("收到 SIGINT 信号，正在关闭浏览器...");
      await this.browser?.close();
    });

    process.on("SIGTERM", async () => {
      logger.warn("收到 SIGTERM 信号，正在关闭浏览器...");
      await this.browser?.close();
    });

    setInterval(async () => {
      if (!this.taskQueue.isBusy()) {
        logger.info("开始重启 htmlRender");
        this.browser?.close();
        this.browser = await puppeteer.launch(launchOption);
        logger.info("重启完成 ✅");
      } else {
        logger.warn("当前有任务正在处理，跳过重启 htmlRender");
      }
    }, 60 * 60 * 1000);
  }

  private async waitForAllResources(page: any, timeout = 30000) {
    await page
      .evaluate(() => {
        // 等待所有图片加载
        return Promise.all(
          Array.from(document.images, (img: HTMLImageElement) => {
            if (img.complete) return Promise.resolve();
            return new Promise((resolve, reject) => {
              img.addEventListener("load", resolve);
              img.addEventListener("error", reject);
            });
          })
        );
      })
      .catch((e: Error) => {
        logger.warn(`渲染时出错, 加载图片资源失败`, e);
      });
  }

  public async renderHtmlCodeToImage(
    html: string,
    screenshotPath: ScreenshotOptions["path"]
  ): Promise<string> {
    return this.taskQueue.enqueue(() =>
      this._renderHtmlCodeToImage(html, screenshotPath)
    );
  }

  private async _renderHtmlCodeToImage(
    html: string,
    screenshotPath: ScreenshotOptions["path"]
  ): Promise<string> {
    if (!this.browser) throw new HtmlRenderError("浏览器未初始化");

    const page = await this.browser.newPage();
    try {
      await page.setContent(html, {
        waitUntil: ["load", "networkidle0", "domcontentloaded"],
      });

      await this.waitForAllResources(page);

      const path = await page.screenshot({
        type: "png",
        path: screenshotPath,
        fullPage: true,
      });
      return typeof path === "string" ? path : (screenshotPath as string);
    } finally {
      await page.close();
    }
  }

  public async renderHtmlCodeToBase64(html: string): Promise<string> {
    return this.taskQueue.enqueue(() => this._renderHtmlCodeToBase64(html));
  }

  private async _renderHtmlCodeToBase64(html: string): Promise<string> {
    if (!this.browser) throw new HtmlRenderError("浏览器未初始化");

    const page = await this.browser.newPage();
    try {
      await page.setContent(html, {
        waitUntil: ["load", "networkidle0", "domcontentloaded"],
      });

      await this.waitForAllResources(page);

      const base64 = await page.screenshot({
        type: "png",
        encoding: "base64",
        fullPage: true,
      });
      return base64 as string;
    } finally {
      await page.close();
    }
  }

  public async renderToImage(
    url: string,
    screenshotPath: ScreenshotOptions["path"]
  ): Promise<string> {
    return this.taskQueue.enqueue(() =>
      this._renderToImage(url, screenshotPath)
    );
  }

  private async _renderToImage(
    url: string,
    screenshotPath: ScreenshotOptions["path"]
  ): Promise<string> {
    if (!this.browser) throw new HtmlRenderError("浏览器未初始化");

    const page = await this.browser.newPage();
    try {
      await page.goto(url, {
        waitUntil: ["load", "networkidle0", "domcontentloaded"],
      });

      await this.waitForAllResources(page);

      const width = (await page.evaluate(
        "document.body.scrollWidth"
      )) as number;
      const height = (await page.evaluate(
        "document.body.scrollHeight"
      )) as number;
      await page.setViewport({ width, height });
      const path = await page.screenshot({
        type: "png",
        path: screenshotPath,
        fullPage: true,
      });
      return typeof path === "string" ? path : (screenshotPath as string);
    } finally {
      await page.close();
    }
  }

  public async renderToBase64(url: string): Promise<string> {
    return this.taskQueue.enqueue(() => this._renderToBase64(url));
  }

  private async _renderToBase64(url: string): Promise<string> {
    if (!this.browser) throw new HtmlRenderError("浏览器未初始化");

    const page = await this.browser.newPage();
    try {
      await page.goto(url, {
        waitUntil: ["load", "networkidle0", "domcontentloaded"],
      });

      await this.waitForAllResources(page);

      const width = (await page.evaluate(
        "document.body.scrollWidth"
      )) as number;
      const height = (await page.evaluate(
        "document.body.scrollHeight"
      )) as number;
      await page.setViewport({ width, height });
      const base64 = await page.screenshot({
        type: "png",
        encoding: "base64",
        fullPage: true,
      });
      return base64 as string;
    } finally {
      await page.close();
    }
  }

  public getBrowser() {
    return this.browser;
  }

  // 获取队列状态
  public getQueueStatus() {
    return {
      queueLength: this.taskQueue.getQueueLength(),
      isBusy: this.taskQueue.isBusy(),
    };
  }

  // 等待所有任务完成
  public async waitForQueueEmpty(): Promise<void> {
    while (this.taskQueue.getQueueLength() > 0 || this.taskQueue.isBusy()) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  public async destroy() {
    // 等待队列中所有任务完成
    await this.waitForQueueEmpty();

    if (this.browser) await this.browser.close();
    if (this.server) await this.server.close();
  }
}
