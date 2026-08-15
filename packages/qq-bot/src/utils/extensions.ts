// 实现代码
if (!Array.prototype.intersperse) {
  Array.prototype.intersperse = function <T, S>(
    this: T[],
    separator: S
  ): (T | S)[] {
    const result: (T | S)[] = [];
    for (let i = 0; i < this.length; i++) {
      result.push(this[i]);
      if (i < this.length - 1) result.push(separator);
    }
    return result;
  };
}
