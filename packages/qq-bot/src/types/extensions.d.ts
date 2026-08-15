declare global {
  interface Array<T> {
    /**
     * 在数组元素间插入分隔符，返回新数组
     * @example
     * [1, 2, 3].joinArray(0) // => [1, 0, 2, 0, 3]
     */
    intersperse<S>(separator: S): (T | S)[];
  }
}

export {};
