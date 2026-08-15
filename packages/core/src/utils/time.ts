export default class TimeUtils {
  static parseTimeToMsRegex(timeStr: string) {
    // 分组: 小时(:分(:秒(.毫秒)?)?)?
    const regex = /^(?:(\d+):)?(?:(\d+):)?(\d+)(?:\.(\d+))?$/;
    const match = timeStr.match(regex);

    if (!match) return 0;

    // 解析匹配结果
    const hours = match[1] ? parseInt(match[1], 10) : 0;
    const minutes = match[2] ? parseInt(match[2], 10) : 0;
    const seconds = parseInt(match[3], 10);
    const milliseconds = match[4]
      ? parseInt(match[4].padEnd(3, "0").slice(0, 3), 10)
      : 0;

    return (hours * 3600 + minutes * 60 + seconds) * 1000 + milliseconds;
  }
}
