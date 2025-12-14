import fs from "fs";
import path from "path";
import getLogger from "./logger";

const logger = getLogger("ConfigManager");

export default class ConfigManager<T extends Record<string, any>> {
  private _config: T;
  private readonly _configPath: string;

  constructor(filePath: string, defaultConfig?: T) {
    this._configPath = path.resolve(filePath);
    this._config = {} as T;

    this.initializeConfig(defaultConfig);
  }

  private initializeConfig(defaultConfig?: T): void {
    const dir = path.dirname(this._configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (!fs.existsSync(this._configPath)) {
      this._config = defaultConfig || ({} as T);
      this.saveConfig();
    } else {
      this.loadConfig();

      // 合并缺失的字段
      if (defaultConfig) {
        this.mergeWithDefault(defaultConfig);
      }
    }

    fs.watchFile(this._configPath, () => {
      logger.debug(`Config file changed: ${this._configPath}, reloading...`);
      this.loadConfig();
    });
  }

  private loadConfig(): void {
    try {
      const fileContent = fs.readFileSync(this._configPath, "utf-8");
      this._config = JSON.parse(fileContent);
      logger.debug(`Loaded config from ${this._configPath}`);
    } catch (error) {
      logger.error(`Failed to load config from ${this._configPath}:`, error);
      throw new Error(
        `Config file is corrupted or has invalid format: ${this._configPath}`
      );
    }
  }

  /**
   * 保存配置到文件
   * @throws {Error} 如果保存失败
   */
  saveConfig(): void {
    try {
      const configDir = path.dirname(this._configPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      const configStr = JSON.stringify(this._config, null, 2);
      fs.writeFileSync(this._configPath, configStr, "utf-8");
      logger.debug(`Saved config to ${this._configPath}`);
    } catch (error) {
      logger.error(`Failed to write config file: ${this._configPath}`);
      throw new Error(`Failed to write config file: ${this._configPath}`);
    }
  }

  /**
   * 用默认配置合并当前配置（补充缺失的字段）
   */
  private mergeWithDefault(defaultConfig: T): void {
    let hasChanges = false;

    for (const key in defaultConfig) {
      if (!(key in this._config)) {
        this._config[key] = defaultConfig[key];
        hasChanges = true;
      }
    }

    if (hasChanges) {
      this.saveConfig();
    }
  }

  /**
   * 获取整个配置对象
   */
  get config(): T {
    return { ...this._config };
  }

  /**
   * 获取配置值
   */
  get<K extends keyof T>(key: K): T[K] {
    return this._config[key];
  }

  /**
   * 设置配置值
   */
  set<K extends keyof T>(key: K, value: T[K]): void {
    this._config[key] = value;
    this.saveConfig();
  }

  /**
   * 批量设置配置值
   */
  setMultiple(updates: Partial<T>): void {
    Object.assign(this._config, updates);
    this.saveConfig();
  }

  /**
   * 检查配置项是否存在
   */
  has<K extends keyof T>(key: K): boolean {
    return key in this._config;
  }

  /**
   * 删除配置项
   */
  delete<K extends keyof T>(key: K): void {
    if (key in this._config) {
      delete this._config[key];
      this.saveConfig();
    }
  }

  /**
   * 重置配置为默认值
   */
  reset(defaultConfig: T): void {
    this._config = { ...defaultConfig };
    this.saveConfig();
  }

  /**
   * 重新从文件加载配置
   */
  reload(): void {
    this.loadConfig();
  }

  /**
   * 获取配置文件路径
   */
  get configPath(): string {
    return this._configPath;
  }

  /**
   * 检查配置文件是否存在
   */
  exists(): boolean {
    return fs.existsSync(this._configPath);
  }

  /**
   * 备份配置文件
   */
  backup(backupPath?: string): string {
    const backupFile =
      backupPath || `${this._configPath}.backup.${Date.now()}.json`;

    if (!this.exists()) {
      throw new Error("Config file does not exist, cannot create backup");
    }

    try {
      fs.copyFileSync(this._configPath, backupPath || backupFile);
      return backupFile;
    } catch (error) {
      logger.error(`Failed to create backup: ${backupFile}`);
      throw new Error(`Failed to create backup: ${backupFile}`);
    }
  }

  /**
   * 从备份恢复配置
   */
  restore(backupPath: string): void {
    if (!fs.existsSync(backupPath)) {
      throw new Error(`Backup file does not exist: ${backupPath}`);
    }

    try {
      fs.copyFileSync(backupPath, this._configPath);
      this.loadConfig();
    } catch (error) {
      logger.error(`Failed to restore from backup: ${backupPath}`);
      throw new Error(`Failed to restore from backup: ${backupPath}`);
    }
  }
}
