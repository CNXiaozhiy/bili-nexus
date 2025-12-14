export interface Response<T> {
  code: number;
  message: string;
  ttl?: number;
  data: T;
}
