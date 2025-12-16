import UserAccount from "./account";
import BiliHttpApi from "./bili-http-api";

export default class BiliApi extends BiliHttpApi {
  private userAccount: UserAccount;

  constructor(account: UserAccount) {
    super();
    this.userAccount = account;
  }

  public getCookie(): string {
    return this.userAccount.getCookie();
  }

  public getAccount() {
    return this.userAccount;
  }
}
