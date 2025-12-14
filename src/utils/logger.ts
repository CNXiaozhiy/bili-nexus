import * as log4js from "log4js";

log4js.configure({
  appenders: {
    out: {
      type: "stdout",
      layout: {
        type: "pattern",
        pattern: "[%d{MM/dd hh:mm:ss.SSS}] [%[%p%]] [%[%c%]] %m",
      },
    },
    app: {
      type: "dateFile",
      filename: "logs/app.log",
      encoding: "utf-8",
      pattern: "yyyy-MM-dd",
      maxLogSize: 10485760,
      numBackups: 2,
      keepFileExt: true,
      alwaysIncludePattern: true,
      compress: true,
    },
    http: {
      type: "dateFile",
      filename: "logs/http.log",
      encoding: "utf-8",
      pattern: "yyyy-MM-dd",
      maxLogSize: 10485760,
      numBackups: 2,
      keepFileExt: true,
      alwaysIncludePattern: true,
      compress: true,
    },
  },
  categories: {
    default: { appenders: ["out", "app"], level: "debug" },
    http: { appenders: ["http"], level: "debug" },
  },
});

const getLogger = log4js.getLogger;

export default getLogger;
