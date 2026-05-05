import express from "express";
import { apiConfigManager } from "@/common";
import DynamicAutomationManager from "../dynamic/dynamic-automation-manager";
import LiveAutomationManager from "../live/live-automation-manager";
import getLogger from "@/utils/logger";

export default class HttpApiSerivce {
  private readonly logger = getLogger(HttpApiSerivce.name);

  private port = apiConfigManager.get("port");
  private apiKey = apiConfigManager.get("apiKey");
  private app = express();

  constructor(
    private readonly liveAutomationManager: LiveAutomationManager,
    private readonly dynamicAutomationManager: DynamicAutomationManager,
  ) {}

  public init() {
    this.app.use(express.json());

    this.registerRoutes();

    this.app.listen(this.port, () => {
      this.logger.info(`HttpApiSerivce listening on port ${this.port}`);
    });
  }

  private registerRoutes() {
    // this.app.use(router);

    this.app.get("/health", (req, res) => {
      res.json({
        code: 0,
        message: "ok",
      });
    });
  }
}
