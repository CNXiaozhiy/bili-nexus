import UserAccount from "@/core/bilibili/account";
import QRCode from "qrcode";
import path from "path";
import BiliHttpApi from "@/core/bilibili/bili-http-api";
import { LoginInfo } from "@/types/bilibili";
import { LoginAccountError } from "@/types/errors/login";
import { accountConfigManager } from "@/common";
import { getLogger } from "log4js";

const logger = getLogger("LoginAccount");

class CCookieBiliApi extends BiliHttpApi {
  private cookie = "";

  public getCookie(): string {
    return this.cookie;
  }

  public setCookie(cookie: string) {
    this.cookie = cookie;
  }
}

/**
 * 从控制台登录
 */
export async function loginAccountByConsole(
  isDefaultAccount: boolean = false
): Promise<UserAccount> {
  const biliApi = new CCookieBiliApi(); // 无 cookie 模式

  const { url, qrcode_key } = await biliApi.generateLoginQrcode();

  const qrcode_path = path.join(process.cwd(), "qrcode.png");
  QRCode.toFile(qrcode_path, url, { type: "png" });
  const buffer = await QRCode.toBuffer(url, { type: "png" });

  logger.info("开始登录账号");

  console.log("* 终端二维码");
  console.log(await QRCode.toString(url, { type: "terminal", small: true }));
  QRCode.toFile(qrcode_path, url, { type: "png" });
  console.log("* 本地二维码路径", qrcode_path);
  console.log(
    "* 打开浏览器扫描二维码",
    `https://api.qrtool.cn/?text=${encodeURIComponent(
      url
    )}&size=500&margin=20&level=H`
  );

  const { uid, cookie, refresh_token, accountInfo } = await _loginAccount(
    biliApi,
    qrcode_key
  );

  const accounts = accountConfigManager.get("accounts");
  accounts[accountInfo.mid.toString()] = {
    cookie: cookie,
    refresh_token: refresh_token,
  };
  if (isDefaultAccount) {
    accountConfigManager.set("defaultUid", accountInfo.mid);
    logger.info("设置默认账号成功✅ -> " + accountInfo.mid);
  }
  accountConfigManager.set("accounts", accounts);
  // 保存配置
  accountConfigManager.saveConfig();

  logger.info("登录成功✅");

  return new UserAccount(uid, cookie, refresh_token);
}

type LoginAccountOptions = {
  isDefaultAccount: boolean;
  qrcodeCallback: (url: string, base64: string) => void;
};

export async function loginAccount({
  isDefaultAccount = false,
  qrcodeCallback,
}: LoginAccountOptions): Promise<UserAccount> {
  const biliApi = new CCookieBiliApi(); // 无 cookie 模式

  let qrcode_url: string, web_qrcode_url: string;

  const { url, qrcode_key } = await biliApi.generateLoginQrcode();

  const buffer = await QRCode.toBuffer(url, { type: "png" });
  qrcodeCallback(url, buffer.toString("base64"));

  qrcode_url = url;
  web_qrcode_url = `https://api.qrtool.cn/?text=${encodeURIComponent(
    url
  )}&size=500&margin=20&level=H`;

  logger.info("开始登录账号", { qrcode_url, web_qrcode_url });

  const { uid, cookie, refresh_token, accountInfo } = await _loginAccount(
    biliApi,
    qrcode_key
  );

  const accounts = accountConfigManager.get("accounts");
  accounts[accountInfo.mid.toString()] = {
    cookie: cookie,
    refresh_token: refresh_token,
  };
  if (isDefaultAccount) {
    accountConfigManager.set("defaultUid", accountInfo.mid);
    logger.info("设置默认账号成功✅ -> " + accountInfo.mid);
  }
  accountConfigManager.set("accounts", accounts);
  // 保存配置
  accountConfigManager.saveConfig();

  logger.info("登录成功✅");

  return new UserAccount(uid, cookie, refresh_token);
}

function _loginAccount(biliApi: CCookieBiliApi, qrcode_key: string) {
  return new Promise<{
    uid: number;
    info: LoginInfo;
    cookie: string;
    refresh_token: string;
    accountInfo: LoginInfo;
  }>(async (resolve, reject) => {
    const interval = setInterval(async () => {
      const { code, cookie, refresh_token } = await biliApi.LoginByQrcodeKey(
        qrcode_key
      );
      if (code === 0) {
        if (!cookie)
          throw new LoginAccountError("biliApi.LoginByQrcodeKey 未返回 cookie");

        biliApi.setCookie(cookie);
        const accountInfo = await biliApi.getAccountInfo();

        resolve({
          uid: accountInfo.mid,
          info: accountInfo,
          cookie: cookie,
          refresh_token: refresh_token,
          accountInfo,
        });

        clearInterval(interval);
      } else if (code === 86038) {
        logger.warn("二维码已过期❌");

        reject("二维码已过期❌");
        clearInterval(interval);
      } else if (code === 86090) {
        logger.info("等待用户确认登录⏳");
      } else if (code === 86101) {
        logger.info("等待扫描二维码⏳");
      }
    }, 5000);
  });
}
