/**
 * 订阅数据模型与查询工具。
 * 订阅配置形如：{ [resourceId]: { notify, group: { [gid]: { offical, users } } } }
 */

export type SubscriptionConfig = {
  notify: boolean;
  group: Record<
    string,
    {
      offical: boolean;
      users: number[];
    }
  >;
};

export type DataStore<T extends string = string> = Record<T, SubscriptionConfig>;

export class SubscriptionQuery<T extends DataStore<string>> {
  private readonly data: T;

  constructor(data: T) {
    this.data = data;
  }

  /**
   * 获取订阅的所有资源
   * @returns 资源key数组
   */
  getSubscriptions(): string[] {
    return Object.keys(this.data);
  }

  /**
   * 获取用户在所有群组中订阅的所有资源
   * @param userId 用户ID
   * @returns 用户订阅的资源key数组
   */
  getUserSubscriptions(userId: number): string[] {
    const subscriptions: string[] = [];

    for (const [resourceId, config] of Object.entries(this.data)) {
      const hasSubscription = Object.values(config.group).some((group) => group.users.includes(userId));

      if (hasSubscription) {
        subscriptions.push(resourceId);
      }
    }

    return subscriptions;
  }

  /**
   * 获取用户在特定群组中订阅的所有资源
   * @param userId 用户ID
   * @param groupId 群组ID
   * @returns 用户在群组中订阅的资源key数组
   */
  getUserGroupSubscriptions(userId: number, groupId: number): string[] {
    const subscriptions: string[] = [];

    for (const [resourceId, config] of Object.entries(this.data)) {
      const group = config.group[groupId.toString()];

      if (group && group.users.includes(userId)) {
        subscriptions.push(resourceId);
      }
    }

    const officialResource = this.getOfficialResource(groupId);
    if (officialResource && !subscriptions.includes(officialResource.toString())) subscriptions.push(officialResource.toString());

    return subscriptions;
  }

  /**
   * 获取群组中所有订阅的资源
   * @param groupId 群组ID
   * @returns 群组订阅的资源key数组
   */
  getGroupSubscriptions(groupId: number): string[] {
    const subscriptions: string[] = [];

    for (const [resourceId, config] of Object.entries(this.data)) {
      if (config.group[groupId.toString()]) {
        subscriptions.push(resourceId);
      }
    }

    return subscriptions;
  }

  /**
   * 获取特定资源的所有订阅者（用户ID）
   * @param resourceId 资源ID
   * @returns 所有订阅该资源的用户ID数组
   */
  getResourceSubscribers(resourceId: number): number[] {
    const subscribers = new Set<number>();
    const config = this.data[resourceId.toString()];

    if (!config) return [];

    for (const group of Object.values(config.group)) {
      group.users.forEach((userId) => subscribers.add(userId));
    }

    return Array.from(subscribers);
  }

  /**
   * 获取特定资源在特定群组中的所有订阅者
   * @param resourceId 资源ID
   * @param groupId 群组ID
   * @returns 群组中订阅该资源的用户ID数组
   */
  getResourceGroupSubscribers(resourceId: number, groupId: number): number[] {
    const config = this.data[resourceId.toString()];
    if (!config) return [];

    const group = config.group[groupId.toString()];
    return group ? [...group.users] : [];
  }

  /**
   * 检查用户是否订阅了某个资源
   * @param resourceId 资源ID
   * @param userId 用户ID
   * @param groupId 群组ID（可选，不传则检查所有群组）
   */
  hasUserSubscribed(resourceId: number, userId: number, groupId?: number): boolean {
    const config = this.data[resourceId.toString()];
    if (!config) return false;

    if (groupId) {
      const group = config.group[groupId.toString()];
      return group ? group.users.includes(userId) : false;
    }

    return Object.values(config.group).some((group) => group.users.includes(userId));
  }

  /**
   * 获取资源的所有官方群组ID
   * @param resourceId 资源ID
   * @returns 该资源的官方群组ID数组
   */
  getOfficialGroups(resourceId: number): number[] {
    const config = this.data[resourceId.toString()];
    if (!config) return [];

    const officialGroups: number[] = [];

    for (const [groupId, group] of Object.entries(config.group)) {
      if (group.offical) {
        officialGroups.push(parseInt(groupId));
      }
    }

    return officialGroups;
  }

  /**
   * 获取群组的所有官方资源
   * @param groupId 群组ID
   * @returns 该群组的官方资源ID，如果没有则返回null
   */
  getOfficialResource(groupId: number): number | null {
    const groupIdStr = groupId.toString();

    for (const [resourceId, config] of Object.entries(this.data)) {
      const group = config.group[groupIdStr];
      if (group && group.offical) {
        return parseInt(resourceId);
      }
    }

    return null;
  }

  /**
   * 检查群组是否为某个资源的官方群组
   * @param resourceId 资源ID
   * @param groupId 群组ID
   * @returns 是否为官方群组
   */
  isOfficialGroup(resourceId: number | string, groupId: number): boolean {
    const config = this.data[resourceId.toString()];
    if (!config) return false;

    const group = config.group[groupId.toString()];
    return group ? group.offical : false;
  }
}
