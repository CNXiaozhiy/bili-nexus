import fs from "fs";
import path from "path";

export function deleteFolderRecursive(folderPath: string) {
  if (fs.existsSync(folderPath)) {
    fs.readdirSync(folderPath).forEach((file) => {
      const curPath = path.join(folderPath, file);
      if (fs.lstatSync(curPath).isDirectory()) {
        deleteFolderRecursive(curPath);
      } else {
        fs.unlinkSync(curPath);
      }
    });
  }
}

export function isFolderEmpty(folderPath: string): boolean {
  try {
    const files = fs.readdirSync(folderPath);
    return files.length === 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`文件夹不存在: ${folderPath}`);
    }
    throw error;
  }
}
