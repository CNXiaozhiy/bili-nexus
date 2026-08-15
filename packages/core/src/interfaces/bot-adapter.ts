/**
 * 通知/交互适配器端口（Port）。
 *
 * 领域层（core）只依赖该抽象，不感知任何具体平台（QQ / Telegram / Web...）。
 * 各平台适配器（如 @bili-nexus/qq-bot）实现本接口，由组合根（app.ts）负责装配。
 */
export interface BotAdapter {
  /** 适配器名称，用于日志与诊断 */
  readonly name: string;

  /** 初始化并开始工作（连接、注册事件监听等） */
  init(): Promise<void>;

  /** 优雅关闭（断开连接、清理定时器等） */
  shutdown(): Promise<void>;
}
