// Golbal NotifyEmitter

import EventEmitter from "events";

export interface Events {
  "msg-warn": [message: string];
  "msg-error": [message: string, rawError?: unknown];
}

type e = Record<
  string,
  [
    {
      message: string;
      type: "info" | "warn" | "error";
      data: any;
    }
  ]
>;

const notifyEmitter = new EventEmitter<Events>();

export default notifyEmitter;
