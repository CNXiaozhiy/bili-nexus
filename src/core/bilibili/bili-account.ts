import UserAccount from "./account";
import BiliApi from "./bili-api";

export class BiliAccount {
  protected account: UserAccount;
  protected biliApi: BiliApi;

  constructor(account: UserAccount) {
    this.account = account;
    this.biliApi = new BiliApi(account);
  }

  public getAccount() {
    return this.account;
  }

  public getBiliApi() {
    return this.biliApi;
  }
}
