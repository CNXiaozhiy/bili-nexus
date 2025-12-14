/**
 * 工具函数集合
 */
export default class FormatUtils {
  /**
   * 添加千位分隔符
   * @param num 要格式化的数字
   * @param separator 分隔符，默认为逗号
   * @returns 格式化后的字符串
   */
  static addThousandsSeparator(num: number | string, separator: string = ","): string {
    // 转换为字符串并处理小数部分
    const numStr = num.toString();
    const [integerPart, decimalPart] = numStr.split(".");

    // 为整数部分添加千位分隔符
    const formattedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, separator);

    // 如果有小数部分，重新拼接
    return decimalPart ? `${formattedInteger}.${decimalPart}` : formattedInteger;
  }

  /**
   * 格式化时间为 YYYY-MM-DD HH:mm:ss 格式
   * @param date 要格式化的日期，可以是 Date 对象、时间戳或日期字符串
   * @param fillZero 是否补零，默认为 true
   * @returns 格式化后的时间字符串
   */
  static formatDateTime(date: Date | number | string = new Date(), fillZero: boolean = true): string {
    const dateObj = typeof date === "string" || typeof date === "number" ? new Date(date) : date;

    if (isNaN(dateObj.getTime())) {
      throw new Error("Invalid date");
    }

    const year = dateObj.getFullYear();
    const month = dateObj.getMonth() + 1;
    const day = dateObj.getDate();
    const hours = dateObj.getHours();
    const minutes = dateObj.getMinutes();
    const seconds = dateObj.getSeconds();

    // 补零函数
    const padZero = (num: number): string => {
      return fillZero ? num.toString().padStart(2, "0") : num.toString();
    };

    return `${year}-${padZero(month)}-${padZero(day)} ${padZero(hours)}:${padZero(minutes)}:${padZero(seconds)}`;
  }

  /**
   * 获取当前时间并格式化为 YYYY-MM-DD HH:mm:ss
   * @returns 格式化后的当前时间字符串
   */
  static getCurrentDateTime(): string {
    return this.formatDateTime(new Date());
  }

  static formatDurationWithoutSeconds(ms: number): string {
    const totalMinutes = Math.floor(ms / (1000 * 60));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;

    const parts = [];

    if (days > 0) {
      parts.push(`${days} 天`);
    }
    if (remainingHours > 0) {
      parts.push(`${remainingHours} 小时`);
    }
    if (minutes > 0 || parts.length === 0) {
      parts.push(`${minutes} 分钟`);
    }

    return parts.join(" ");
  }

  static formatDurationDetailed(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;

    const parts = [];

    if (days > 0) {
      parts.push(`${days} 天`);
    }
    if (hours > 0) {
      parts.push(`${hours} 小时`);
    }
    if (minutes > 0) {
      parts.push(`${minutes} 分钟`);
    }
    if (remainingSeconds > 0 || parts.length === 0) {
      parts.push(`${remainingSeconds} 秒`);
    }

    return parts.join(" ");
  }

  static formatDateWithSession(date = new Date()) {
    const d = date instanceof Date ? date : new Date(date);

    const hours = d.getHours();

    let displayDate = d;
    if (hours >= 0 && hours < 5) {
      displayDate = new Date(d);
      displayDate.setDate(displayDate.getDate() - 1);
    }

    const month = displayDate.getMonth() + 1;
    const day = displayDate.getDate();

    let session;
    if (hours >= 5 && hours < 11) {
      session = "上午场";
    } else if (hours >= 11 && hours < 14) {
      session = "中午场";
    } else if (hours >= 14 && hours < 18) {
      session = "下午场";
    } else if (hours >= 18 && hours < 23) {
      session = "晚间场";
    } else {
      session = "午夜场"; // 23:00-次日4:59
    }

    return `${month}.${day} ${session}`;
  }
}
