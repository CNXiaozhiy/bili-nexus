export class BiliApiError extends Error {}

export class BiliHttpApiError extends Error {
  code: number;
  message: string;
  raw_data: any;

  constructor(message: string, code: number = 0, raw_data?: any) {
    super(message);
    this.name = "BiliApiError";
    this.code = code;
    this.message = message;
    this.raw_data = raw_data;
  }
}
