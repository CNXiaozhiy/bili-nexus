import { qqBotConfigManager } from "../config";

/**
 * 权限校验：superAdmin 恒通过；其余按 admins 表中配置的 permission 比较。
 * @param qid 请求者 QQ 号
 * @param permission 所需权限等级（默认 1）
 */
export function auth(qid: number, permission = 1): boolean {
  if (qqBotConfigManager.get("superAdmin") == qid) return true;

  const isAdmin = qqBotConfigManager.get("admins")[qid.toString()];

  return isAdmin && isAdmin.permission >= permission;
}
