import fs from "fs";
import path from "path";
import { globalVariables } from "@/common";

export function initVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf-8"));
    if (!pkg.version) throw new Error("package.json 异常");
    globalVariables.set("version", pkg.version);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

export function getVersion() {
  return globalVariables.get("version");
}
