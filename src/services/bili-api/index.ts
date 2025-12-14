// src/services/api/bili-api.ts

import UserAccount from "@/core/bilibili/account";
import BiliHttpApi from "@/core/bilibili/bili-http-api";
import { BiliApiServiceError } from "@/types/errors/bili-api";

import getLogger from "@/utils/logger";

const logger = getLogger("BiliApiService");

export class BiliApi extends BiliHttpApi {
  private account: UserAccount;

  constructor(account: UserAccount) {
    super(account.getCookie());
    this.account = account;
  }

  public getAccount() {
    return this.account;
  }
}

export default class BiliApiService {
  private static DefaultInstance: BiliApi | null = null;
  private static BiliApiInstances: BiliApi[] = [];

  constructor() {}

  public static register(account: UserAccount) {
    const biliApi = new BiliApi(account);
    BiliApiService.BiliApiInstances.push(biliApi);

    logger.info("账号注册: ", account.getUid());
    return biliApi;
  }

  public static registerDefault(account: UserAccount) {
    logger.info("设置默认账号: ", account.getUid());
    BiliApiService.DefaultInstance = BiliApiService.register(account);
  }

  public static getDefaultInstance() {
    if (!BiliApiService.DefaultInstance)
      throw new BiliApiServiceError("No default account registered");
    return BiliApiService.DefaultInstance;
  }

  public static getInstance(account: UserAccount | number) {
    const index = BiliApiService.BiliApiInstances.findIndex(
      (instance) =>
        instance.getAccount().getUid() ===
        (typeof account === "number" ? account : account.getUid())
    );
    if (index === -1) throw new BiliApiServiceError("Account not found");
    return BiliApiService.BiliApiInstances[index];
  }

  public static getInstances() {
    return BiliApiService.BiliApiInstances;
  }
}
