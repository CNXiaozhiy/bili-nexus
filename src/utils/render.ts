import { readFileSync } from "fs";
import path from "path";

let cachedBase64: string | null = null;

export function getErrorImageBase64() {
  if (cachedBase64) return cachedBase64;
  return (cachedBase64 = readFileSync(
    path.join(process.cwd(), "templates", "resource", "error.png")
  ).toString("base64"));
}
