type CommandHandler<E, R> = (
  args: string[],
  e: E,
  command?: string
) => void | Promise<R>;

interface CommandInfo<E, R> {
  handler: CommandHandler<E, R>;
  description?: string;
  usage?: string;
}

interface ExecuteResult<R> {
  success: boolean;
  result: R | null;
  error?: string;
  command?: string;
}

export default class CommandProcessor<E = null, R = void> {
  private commands: Map<string, CommandInfo<E, R>> = new Map();
  private defaultHandler?: CommandHandler<E, R>;

  /**
   * 注册命令
   */
  register(
    name: string,
    handler: CommandHandler<E, R>,
    description?: string,
    usage?: string
  ): void {
    if (this.commands.has(name.toLowerCase())) {
      throw new Error(`Command '${name}' is already registered`);
    }

    this.commands.set(name.toLowerCase(), {
      handler,
      description,
      usage,
    });
  }

  /**
   * 设置默认命令处理程序
   */
  setDefaultHandler(handler: CommandHandler<E, R>): void {
    this.defaultHandler = handler;
  }

  /**
   * 执行命令
   */
  async execute(input: string, e: E): Promise<ExecuteResult<R>> {
    try {
      const { command, args } = this.parseInput(input);

      if (!command) {
        if (this.defaultHandler) {
          const result = await this.defaultHandler(args, e);
          return { success: true, result: result ?? null, command: undefined };
        }
        return {
          success: false,
          result: null,
          error: "No command provided and no default handler set",
        };
      }

      const commandInfo = this.commands.get(command);

      if (!commandInfo) {
        if (this.defaultHandler) {
          const result = await this.defaultHandler(args, e, command);
          return { success: true, result: result ?? null, command };
        }
        return {
          success: false,
          result: null,
          error: `Unknown command: ${command}`,
          command,
        };
      }

      const result = await commandInfo.handler(args, e);
      return { success: true, result: result ?? null, command };
    } catch (error) {
      return {
        success: false,
        result: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 简化的执行方法，保持向后兼容
   */
  async executeSimple(input: string, e: E): Promise<R | null> {
    const result = await this.execute(input, e);
    return result.success ? result.result : null;
  }

  /**
   * 解析输入字符串
   */
  private parseInput(input: string): { command: string; args: string[] } {
    const tokens = this.tokenize(input.trim());

    if (tokens.length === 0) {
      return { command: "", args: [] };
    }

    const command = tokens[0].toLowerCase();
    const args = tokens.slice(1);

    return { command, args };
  }

  /**
   * 将输入字符串拆分为令牌，支持引号
   */
  private tokenize(input: string): string[] {
    const tokens: string[] = [];
    let currentToken = "";
    let inQuotes = false;
    let quoteChar = "";

    for (let i = 0; i < input.length; i++) {
      const char = input[i];

      if ((char === '"' || char === "'") && !inQuotes) {
        inQuotes = true;
        quoteChar = char;
        continue;
      }

      if (char === quoteChar && inQuotes) {
        inQuotes = false;
        quoteChar = "";
        if (currentToken) {
          tokens.push(currentToken);
          currentToken = "";
        }
        continue;
      }

      if (char === " " && !inQuotes) {
        if (currentToken) {
          tokens.push(currentToken);
          currentToken = "";
        }
        continue;
      }

      currentToken += char;
    }

    if (currentToken) {
      tokens.push(currentToken);
    }

    return tokens;
  }

  /**
   * 获取所有注册的命令信息
   */
  getCommands(): Map<string, CommandInfo<E, R>> {
    return new Map(this.commands);
  }

  /**
   * 获取特定命令的信息
   */
  getCommand(name: string): CommandInfo<E, R> | undefined {
    return this.commands.get(name);
  }

  /**
   * 检查命令是否存在
   */
  hasCommand(name: string): boolean {
    return this.commands.has(name);
  }

  /**
   * 卸载命令
   */
  unregister(name: string): boolean {
    return this.commands.delete(name);
  }

  /**
   * 生成帮助信息
   */
  getHelp(): string {
    const lines: string[] = ["Available commands:"];

    if (this.commands.size === 0) {
      lines.push("  No commands registered.");
    } else {
      this.commands.forEach((info, name) => {
        lines.push(`  ${name}`);
        if (info.description) {
          lines.push(`    Description: ${info.description}`);
        }
        if (info.usage) {
          lines.push(`    Usage: ${info.usage}`);
        }
        lines.push("");
      });
    }

    return lines.join("\n");
  }

  /**
   * 清空所有命令
   */
  clear(): void {
    this.commands.clear();
  }

  /**
   * 获取命令数量
   */
  get size(): number {
    return this.commands.size;
  }
}
