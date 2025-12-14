import { BiliApiError } from "./bili-api";

export class AccountLoginExpiredError extends BiliApiError {
  constructor(message: string) {
    super(message);
    this.name = "AccountLoginExpiredError";
  }
}

export class UploadVideoError extends BiliApiError {
  constructor(message: string) {
    super(message);
    this.name = "UploadVideoError";
  }
}
