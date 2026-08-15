import type { CommandContext, CommandProcessors } from "../context";
import { registerLiveCommands } from "./live";
import { registerSubscriptionCommands } from "./subscription";
import { registerSystemCommands } from "./system";

/** 注册全部 QQ 机器人命令 */
export function registerCommands(processors: CommandProcessors, ctx: CommandContext): void {
  registerSystemCommands(processors, ctx);
  registerLiveCommands(processors, ctx);
  registerSubscriptionCommands(processors, ctx);
}
