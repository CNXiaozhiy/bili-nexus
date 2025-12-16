// Golbal NotifyEmitter

import EventEmitter from "events";

export interface Events {
  "msg-warn": [string];
  "msg-error": [string];
}

type e = Record<
  string,
  [{ message: string; type: "info" | "warn" | "error"; data: any }]
>;

const notifyEmitter = new EventEmitter<Events>();

export default notifyEmitter;
