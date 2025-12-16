export default class UserAccount {
  constructor(
    private uid: number,
    private cookie: string,
    private refreshToken: string
  ) {}

  getUid() {
    return this.uid;
  }

  getCookie() {
    return this.cookie;
  }

  getRefreshToken() {
    return this.refreshToken;
  }

  update(cookie?: string, refreshToken?: string) {
    if (cookie) this.cookie = cookie;
    if (refreshToken) this.refreshToken = refreshToken;
  }
}
