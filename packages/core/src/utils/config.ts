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

export class ConcurrentSafeConfigManager<T extends Record<string, any>> {
  private _config: T;
  private readonly _configPath: string;
  private readonly _fileLock: { [path: string]: boolean } = {};
  private readonly _writeQueue: Array<() => Promise<void>> = [];
  private _isProcessingQueue = false;
  private _changeListeners: Array<(config: T) => void> = [];
  private _configLock = {
    read: 0,
    write: false,
    pendingWriters: 0,
  };

  constructor(filePath: string, defaultConfig?: T) {
    this._configPath = path.resolve(filePath);
    this._config = {} as T;

    this.initializeConfig(defaultConfig);
  }

  private async initializeConfig(defaultConfig?: T): Promise<void> {
    const dir = path.dirname(this._configPath);
    await this.ensureDirectoryExists(dir);

    if (!fs.existsSync(this._configPath)) {
      this._config = defaultConfig ? { ...defaultConfig } : ({} as T);
      await this.saveConfigInternal();
    } else {
      await this.loadConfigInternal();

      // 合并缺失的字段
      if (defaultConfig) {
        await this.mergeWithDefault(defaultConfig);
      }
    }

    this.setupFileWatch();
  }

  private setupFileWatch(): void {
    let changeTimeout: NodeJS.Timeout | null = null;

    fs.watchFile(this._configPath, { interval: 1000 }, () => {
      if (changeTimeout) {
        clearTimeout(changeTimeout);
      }

      changeTimeout = setTimeout(async () => {
        try {
          logger.debug(
            `Config file changed: ${this._configPath}, reloading...`
          );
          await this.reload();
          this.notifyChangeListeners();
        } catch (error) {
          logger.error(`Failed to reload config:`, error);
        }
      }, 500); // 500ms 防抖
    });
  }

  private async ensureDirectoryExists(dir: string): Promise<void> {
    if (!fs.existsSync(dir)) {
      await fs.promises.mkdir(dir, { recursive: true });
    }
  }

  private async withReadLock<T>(operation: () => Promise<T>): Promise<T> {
    // 等待没有写入操作
    while (this._configLock.write || this._configLock.pendingWriters > 0) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }

    this._configLock.read++;
    try {
      return await operation();
    } finally {
      this._configLock.read--;
    }
  }

  private async withWriteLock<T>(operation: () => Promise<T>): Promise<T> {
    this._configLock.pendingWriters++;

    // 等待没有读取和写入操作
    while (this._configLock.read > 0 || this._configLock.write) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }

    this._configLock.write = true;
    this._configLock.pendingWriters--;

    try {
      return await operation();
    } finally {
      this._configLock.write = false;
    }
  }

  private async loadConfigInternal(): Promise<void> {
    await this.withReadLock(async () => {
      try {
        const fileContent = await fs.promises.readFile(
          this._configPath,
          "utf-8"
        );
        this._config = JSON.parse(fileContent);
        logger.debug(`Loaded config from ${this._configPath}`);
      } catch (error) {
        logger.error(`Failed to load config from ${this._configPath}:`, error);
        throw new Error(
          `Config file is corrupted or has invalid format: ${this._configPath}`
        );
      }
    });
  }

  /**
   * 保存配置到文件
   */
  private async saveConfigInternal(): Promise<void> {
    await this.withWriteLock(async () => {
      try {
        const configDir = path.dirname(this._configPath);
        await this.ensureDirectoryExists(configDir);

        const configStr = JSON.stringify(this._config, null, 2);

        // 使用原子写入：先写入临时文件，然后重命名
        const tempPath = `${this._configPath}.tmp.${Date.now()}`;
        await fs.promises.writeFile(tempPath, configStr, "utf-8");
        await fs.promises.rename(tempPath, this._configPath);

        logger.debug(`Saved config to ${this._configPath}`);
      } catch (error) {
        logger.error(`Failed to write config file: ${this._configPath}`, error);
        throw new Error(`Failed to write config file: ${this._configPath}`);
      }
    });
  }

  /**
   * 用默认配置合并当前配置
   */
  private async mergeWithDefault(defaultConfig: T): Promise<void> {
    await this.withWriteLock(async () => {
      let hasChanges = false;

      for (const key in defaultConfig) {
        if (!(key in this._config)) {
          this._config[key] = defaultConfig[key];
          hasChanges = true;
        }
      }

      if (hasChanges) {
        await this.saveConfigInternal();
      }
    });
  }

  /**
   * 队列化写操作
   */
  private async enqueueWriteOperation(
    operation: () => Promise<void>
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      this._writeQueue.push(async () => {
        try {
          await operation();
          resolve();
        } catch (error) {
          reject(error);
        }
      });

      this.processWriteQueue();
    });
  }

  private async processWriteQueue(): Promise<void> {
    if (this._isProcessingQueue || this._writeQueue.length === 0) {
      return;
    }

    this._isProcessingQueue = true;

    try {
      while (this._writeQueue.length > 0) {
        const operation = this._writeQueue.shift();
        if (operation) {
          try {
            await operation();
          } catch (error) {
            logger.error("Write operation failed:", error);
          }
        }
      }
    } finally {
      this._isProcessingQueue = false;
    }
  }

  /**
   * 获取整个配置对象（深拷贝）
   */
  async getConfig(): Promise<T> {
    return await this.withReadLock(async () => {
      return JSON.parse(JSON.stringify(this._config));
    });
  }

  /**
   * 获取配置值
   */
  async get<K extends keyof T>(key: K): Promise<T[K]> {
    return await this.withReadLock(async () => {
      if (!(key in this._config)) {
        throw new Error(`Config key "${String(key)}" does not exist`);
      }
      return this._config[key];
    });
  }

  /**
   * 设置配置值
   */
  async set<K extends keyof T>(key: K, value: T[K]): Promise<void> {
    await this.enqueueWriteOperation(async () => {
      await this.withWriteLock(async () => {
        this._config[key] = value;
        await this.saveConfigInternal();
      });
    });
  }

  /**
   * 批量设置配置值（原子操作）
   */
  async setMultiple(updates: Partial<T>): Promise<void> {
    await this.enqueueWriteOperation(async () => {
      await this.withWriteLock(async () => {
        Object.assign(this._config, updates);
        await this.saveConfigInternal();
      });
    });
  }

  /**
   * 检查配置项是否存在
   */
  async has<K extends keyof T>(key: K): Promise<boolean> {
    return await this.withReadLock(async () => {
      return key in this._config;
    });
  }

  /**
   * 删除配置项
   */
  async delete<K extends keyof T>(key: K): Promise<void> {
    await this.enqueueWriteOperation(async () => {
      await this.withWriteLock(async () => {
        if (key in this._config) {
          delete this._config[key];
          await this.saveConfigInternal();
        }
      });
    });
  }

  /**
   * 重置配置为默认值
   */
  async reset(defaultConfig: T): Promise<void> {
    await this.enqueueWriteOperation(async () => {
      await this.withWriteLock(async () => {
        this._config = JSON.parse(JSON.stringify(defaultConfig));
        await this.saveConfigInternal();
      });
    });
  }

  /**
   * 重新从文件加载配置
   */
  async reload(): Promise<void> {
    await this.loadConfigInternal();
  }

  /**
   * 保存配置到文件（
   */
  async saveConfig(): Promise<void> {
    await this.enqueueWriteOperation(async () => {
      await this.saveConfigInternal();
    });
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
  async backup(backupPath?: string): Promise<string> {
    return await this.withReadLock(async () => {
      const backupFile =
        backupPath || `${this._configPath}.backup.${Date.now()}.json`;

      if (!this.exists()) {
        throw new Error("Config file does not exist, cannot create backup");
      }

      try {
        await fs.promises.copyFile(this._configPath, backupPath || backupFile);
        return backupFile;
      } catch (error) {
        logger.error(`Failed to create backup: ${backupFile}`, error);
        throw new Error(`Failed to create backup: ${backupFile}`);
      }
    });
  }

  /**
   * 从备份恢复配置
   */
  async restore(backupPath: string): Promise<void> {
    await this.enqueueWriteOperation(async () => {
      if (!fs.existsSync(backupPath)) {
        throw new Error(`Backup file does not exist: ${backupPath}`);
      }

      try {
        await fs.promises.copyFile(backupPath, this._configPath);
        await this.loadConfigInternal();
      } catch (error) {
        logger.error(`Failed to restore from backup: ${backupPath}`, error);
        throw new Error(`Failed to restore from backup: ${backupPath}`);
      }
    });
  }

  /**
   * 添加配置变更监听器
   */
  addChangeListener(listener: (config: T) => void): void {
    this._changeListeners.push(listener);
  }

  /**
   * 移除配置变更监听器
   */
  removeChangeListener(listener: (config: T) => void): void {
    const index = this._changeListeners.indexOf(listener);
    if (index > -1) {
      this._changeListeners.splice(index, 1);
    }
  }

  private notifyChangeListeners(): void {
    const configCopy = JSON.parse(JSON.stringify(this._config));
    this._changeListeners.forEach((listener) => {
      try {
        listener(configCopy);
      } catch (error) {
        logger.error("Change listener error:", error);
      }
    });
  }

  /**
   * 获取当前配置的快照（同步版本）
   */
  getSnapshot(): T {
    return JSON.parse(JSON.stringify(this._config));
  }

  /**
   * 清理资源
   */
  dispose(): void {
    fs.unwatchFile(this._configPath);
    this._changeListeners = [];
  }
}
