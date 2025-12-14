export default class UserAccount {
  constructor(private uid: number, private cookie: string) {}

  getUid() {
    return this.uid;
  }

  getCookie() {
    return this.cookie;
  }
}
