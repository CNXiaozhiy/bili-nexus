import { accountConfigManager } from "@/common";
import UserAccount from "@/core/bilibili/account";
import { BiliAccount } from "@/core/bilibili/bili-account";
import getLogger from "@/utils/logger";
import notifyEmitter from "@/core/app/notify-emitter";
import FormatUtils from "@/utils/format";

export class BiliAccountServiceError extends Error {}

const logger = getLogger("BiliAccountService");

export default class BiliAccountService {
  private static DefaultBiliAccount: BiliAccount | null = null;
  private static BiliAccounts: BiliAccount[] = [];

  private static accountCheckInterval: NodeJS.Timeout;

  constructor() {
    BiliAccountService.accountCheckInterval = setInterval(
      BiliAccountService.checkAccounts,
      60 * 60 * 1000
    );
    logger.info(`周期性账号健康检查定时器已设置成功 ✅`);
  }

  public static register(account: UserAccount) {
    const biliAccount = new BiliAccount(account);
    BiliAccountService.BiliAccounts.push(biliAccount);

    logger.info("账号注册: ", account.getUid());
    return biliAccount;
  }

  public static registerDefault(account: UserAccount) {
    logger.info("设置默认账号: ", account.getUid());
    return (BiliAccountService.DefaultBiliAccount =
      BiliAccountService.register(account));
  }

  public static getDefault() {
    if (!BiliAccountService.DefaultBiliAccount)
      throw new BiliAccountServiceError("No default account registered");
    return BiliAccountService.DefaultBiliAccount;
  }

  public static getBiliAccount(account: UserAccount | number) {
    return BiliAccountService.BiliAccounts.find(
      (instance) =>
        instance.getAccount().getUid() ===
        (typeof account === "number" ? account : account.getUid())
    );
  }

  public static getBiliAccounts() {
    return BiliAccountService.BiliAccounts;
  }

  private static checkAccounts() {
    const failedAccount: number[] = [];
    BiliAccountService.getBiliAccounts().forEach(async (account) => {
      const userAccount = account.getAccount();
      const biliApi = account.getBiliApi();
      const uid = userAccount.getUid();
      logger.info(`开始检查账号 ${uid}`);

      try {
        const checkCookieResult = await biliApi.checkCookie();
        if (checkCookieResult.code === -101 || checkCookieResult.data.refresh) {
          logger.info(`账号 ${uid} Cookie 已过期❌，尝试刷新账号⚙️`);
          const { cookie, refresh_token } = await biliApi.refreshCookie(
            userAccount.getRefreshToken()
          );
          userAccount.update(cookie, refresh_token);
          const accountsConfig = accountConfigManager.get("accounts");
          accountsConfig[uid].cookie = cookie;
          accountsConfig[uid].refresh_token = refresh_token;
          accountConfigManager.set("accounts", accountsConfig);
          const accountInfo = biliApi.getAccountInfo();
          logger.info(`账号 ${(await accountInfo).uname}(${uid}) 刷新成功✅`);
        }
      } catch (e) {
        logger.error(`账号 ${uid} 刷新失败❌，请重新登陆, Err:`, e);
        notifyEmitter.emit(
          "msg-warn",
          `账号 ${uid} 已失效且刷新失败❌\n\n` +
            FormatUtils.formatErrorMessage("ACCOUNT_REFRESH_ERROR", e)
        );
        failedAccount.push(uid);
      }
    });

    if (
      failedAccount.includes(
        BiliAccountService.getDefault().getAccount().getUid()
      )
    ) {
      logger.error(`致命错误: 主(默认)账号失效且刷新失败，请立即处理 !!`);
      notifyEmitter.emit(
        "msg-error",
        `主账号已失效且刷新失败❌\n\n请立即处理 !!`
      );
    }
  }
}
