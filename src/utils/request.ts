import axios, {
  AxiosRequestConfig,
  AxiosResponse,
  InternalAxiosRequestConfig,
  AxiosError,
} from "axios";
import getLogger from "./logger";
import { throttledQueue } from "throttled-queue";

interface ExtendedAxiosRequestConfig extends AxiosRequestConfig {
  shouldRetry?: (response: AxiosResponse) => boolean | Promise<boolean>;
}

class GetConfigError extends Error {
  error: Error;
  constructor(message: string, error: Error) {
    super(message);
    this.error = error;
  }
}

const apiThrottle = throttledQueue({
  maxPerInterval: 5,
  interval: 1000,
});

const logger = getLogger("request");
const httpLogger = getLogger("http");

// 指数退避
const MAX_RETRIES = 10;
const BASE_DELAY = 1000; // 1秒基础延迟
const MAX_DELAY = 60000; // 最大延迟60秒

const instance = axios.create({
  timeout: 30000,
  headers: {
    "Content-Type": "application/json",
  },
});

// 判断是否应该重试的错误类型
function shouldRetry(error: AxiosError): boolean {
  // 网络错误（无响应）
  if (!error.response) {
    return true;
  }

  const status = error.response.status;

  // 5xx 服务器错误
  if (status >= 500 && status < 600) {
    return true;
  }

  // 429 请求过多
  if (status === 429) {
    return true;
  }

  // 408 请求超时
  if (status === 408) {
    return true;
  }

  return false;
}

// 计算退避延迟
function calculateBackoffDelay(retryCount: number): number {
  const delay = Math.min(BASE_DELAY * Math.pow(2, retryCount), MAX_DELAY);
  // 添加随机抖动避免惊群效应
  const jitter = delay * 0.1 * Math.random();
  return delay + jitter;
}

// 延迟函数
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 重试请求
async function retryRequest<T>(
  getConfig: () =>
    | ExtendedAxiosRequestConfig
    | Promise<ExtendedAxiosRequestConfig>,
  retryCount: number = 0
): Promise<AxiosResponse<T>> {
  try {
    let config:
      | ExtendedAxiosRequestConfig
      | Promise<ExtendedAxiosRequestConfig>;
    try {
      config = await getConfig();
    } catch (e) {
      throw new GetConfigError("获取请求配置失败", e as Error);
    }

    const response = await instance.request<T>(config);
    if (config.shouldRetry && config.shouldRetry(response)) {
      const delayTime = calculateBackoffDelay(retryCount);
      logger.warn(
        `请求失败，触发用户自定义重试规则，第 ${
          retryCount + 1
        } 次重试，延迟 ${delayTime}ms`,
        {
          url: config.url,
          status: response.status,
          response: response.data,
        }
      );

      await delay(delayTime);
      return retryRequest(getConfig, retryCount + 1);
    }

    return response;
  } catch (error) {
    if (error instanceof GetConfigError) {
      logger.error(`获取请求配置失败 ❌`, error);
    }

    const axiosError = error as AxiosError;
    const config = await getConfig();

    config.headers = config.headers || {};

    // 检查是否应该重试
    if (
      !config.headers["No-Retry"] &&
      retryCount < MAX_RETRIES &&
      shouldRetry(axiosError)
    ) {
      const delayTime = calculateBackoffDelay(retryCount);
      logger.warn(
        `请求失败，第 ${retryCount + 1} 次重试，延迟 ${delayTime}ms`,
        {
          url: config.url,
          status: axiosError.response?.status,
          message: axiosError.message,
          response: axiosError.response,
        }
      );

      await delay(delayTime);
      return retryRequest(getConfig, retryCount + 1);
    }

    // 不重试或达到最大重试次数，抛出错误
    throw error;
  }
}

instance.interceptors.request.use(async (config) => {
  if (config.headers["No-Throttle"]) {
    delete config.headers["No-Throttle"];
    return config;
  }

  return await apiThrottle(async () => {
    config.headers["User-Agent"] ??=
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";
    config.headers["Referer"] ??= "https://www.bilibili.com";
    config.headers["Origin"] ??= "https://www.bilibili.com";
    return config;
  });
});

// Http Logger - interceptors

if (process.env.NODE_ENV === "development") {
  instance.interceptors.request.use(
    async (config: InternalAxiosRequestConfig) => {
      const requestLog = {
        timestamp: new Date().toISOString(),
        method: config.method?.toUpperCase(),
        url: config.url,
        baseURL: config.baseURL,
        headers: config.headers,
        params: config.params,
        data: config.data,
        timeout: config.timeout,
        withCredentials: config.withCredentials,
        auth: config.auth,
      };

      httpLogger.info("=== HTTP Request ===");
      httpLogger.info(`Time Stamp: ${requestLog.timestamp}`);
      httpLogger.info(`${requestLog.method} ${requestLog.url}`);

      if (requestLog.baseURL) {
        httpLogger.info(`Base URL: ${requestLog.baseURL}`);
      }

      if (requestLog.params && Object.keys(requestLog.params).length > 0) {
        httpLogger.info(
          "Query Parameters:",
          JSON.stringify(requestLog.params, null, 2)
        );
      }

      if (requestLog.headers) {
        const filteredHeaders = { ...requestLog.headers };
        // if (filteredHeaders.Authorization || filteredHeaders.authorization) {
        //   filteredHeaders.Authorization = "[FILTERED]";
        //   filteredHeaders.authorization = "[FILTERED]";
        // }

        httpLogger.info("Headers:", JSON.stringify(filteredHeaders, null, 2));
      }

      if (requestLog.data) {
        let dataToLog = requestLog.data;

        if (typeof dataToLog === "string") {
          try {
            const parsed = JSON.parse(dataToLog);
            httpLogger.info("Request Body:", JSON.stringify(parsed, null, 2));
          } catch {
            httpLogger.info(
              "Request Body:",
              dataToLog.substring(0, 1000) +
                (dataToLog.length > 1000 ? "... (truncated)" : "")
            );
          }
        } else if (dataToLog instanceof FormData) {
          // FormData
          const formDataObj: Record<string, any> = {};
          dataToLog.forEach((value, key) => {
            formDataObj[key] = value;
          });
          httpLogger.info("FormData:", JSON.stringify(formDataObj, null, 2));
        } else if (typeof dataToLog === "object") {
          httpLogger.info("Request Body:", JSON.stringify(dataToLog, null, 2));
        } else {
          httpLogger.info("Request Body:", String(dataToLog));
        }
      }

      httpLogger.info("===================\n");

      return config;
    }
  );

  instance.interceptors.response.use(
    (response: AxiosResponse) => {
      const { config, status, statusText, headers, data } = response;
      const requestConfig = config as InternalAxiosRequestConfig;

      // 创建响应日志对象
      const responseLog = {
        timestamp: new Date().toISOString(),
        request: {
          method: requestConfig.method?.toUpperCase(),
          url: requestConfig.url,
          baseURL: requestConfig.baseURL,
        },
        response: {
          status,
          statusText,
          headers,
          data,
        },
      };

      httpLogger.info("=== HTTP Response ===");
      httpLogger.info(`Time Stamp: ${responseLog.timestamp}`);
      httpLogger.info(
        `${responseLog.request.method} ${responseLog.request.url}`
      );
      httpLogger.info(
        `Status: ${responseLog.response.status} ${responseLog.response.statusText}`
      );

      if (responseLog.response.headers) {
        const filteredHeaders = { ...responseLog.response.headers };
        // if (filteredHeaders["set-cookie"]) {
        //   (filteredHeaders["set-cookie"] as any) = "[FILTERED]";
        // }
        // if (filteredHeaders["authorization"]) {
        //   filteredHeaders["authorization"] = "[FILTERED]";
        // }

        httpLogger.info("Headers:", JSON.stringify(filteredHeaders, null, 2));
      }

      if (responseLog.response.data) {
        const responseData = responseLog.response.data;

        if (typeof responseData === "string") {
          try {
            const parsed = JSON.parse(responseData);
            httpLogger.info("Response Body:", JSON.stringify(parsed, null, 2));
          } catch {
            const maxLength = 2000;
            if (responseData.length > maxLength) {
              httpLogger.info(
                "Response Body (truncated):",
                responseData.substring(0, maxLength) + "..."
              );
            } else {
              httpLogger.info("Response Body:", responseData);
            }
          }
        } else if (typeof responseData === "object") {
          httpLogger.info(
            "Response Body:",
            JSON.stringify(responseData, null, 2)
          );
        } else {
          httpLogger.info("Response Body:", String(responseData));
        }
      }

      httpLogger.info("====================\n");

      return response;
    },
    (error) => {
      if (error.response) {
        const { config, status, statusText, headers, data } = error.response;
        const requestConfig = config as InternalAxiosRequestConfig;

        const errorLog = {
          timestamp: new Date().toISOString(),
          request: {
            method: requestConfig.method?.toUpperCase(),
            url: requestConfig.url,
            baseURL: requestConfig.baseURL,
          },
          response: {
            status,
            statusText,
            headers,
            data,
          },
          error: {
            message: error.message,
            code: error.code,
          },
        };

        httpLogger.error("=== HTTP Error Response ===");
        httpLogger.error(`Time Stamp: ${errorLog.timestamp}`);
        httpLogger.error(`${errorLog.request.method} ${errorLog.request.url}`);
        httpLogger.error(
          `Status: ${errorLog.response.status} ${errorLog.response.statusText}`
        );
        httpLogger.error(
          `Error: ${errorLog.error.message} (${errorLog.error.code})`
        );

        if (errorLog.response.data) {
          const errorData = errorLog.response.data;

          if (typeof errorData === "string") {
            try {
              const parsed = JSON.parse(errorData);
              httpLogger.error(
                "Error Response Body:",
                JSON.stringify(parsed, null, 2)
              );
            } catch {
              const maxLength = 2000;
              if (errorData.length > maxLength) {
                httpLogger.error(
                  "Error Response Body (truncated):",
                  errorData.substring(0, maxLength) + "..."
                );
              } else {
                httpLogger.error("Error Response Body:", errorData);
              }
            }
          } else if (typeof errorData === "object") {
            httpLogger.error(
              "Error Response Body:",
              JSON.stringify(errorData, null, 2)
            );
          } else {
            httpLogger.error("Error Response Body:", String(errorData));
          }
        }

        httpLogger.error("=======================\n");
      } else if (error.request) {
        // 请求已发送但没有收到响应（网络错误等）
        const requestConfig = error.config as InternalAxiosRequestConfig;

        httpLogger.error("=== HTTP Request Failed ===");
        httpLogger.error(`Time Stamp: ${new Date().toISOString()}`);
        httpLogger.error(
          `${requestConfig.method?.toUpperCase()} ${requestConfig.url}`
        );
        httpLogger.error(`Error: ${error.message}`);
        httpLogger.error("No response received from server");
        httpLogger.error("==========================\n");
      } else {
        // 请求配置出错
        httpLogger.error("=== HTTP Request Error ===");
        httpLogger.error(`Error: ${error.message}`);
        httpLogger.error("=========================\n");
      }

      return Promise.reject(error);
    }
  );

  logger.debug("http -> httpLogger 拦截器已安装 [OK]");
}

instance.interceptors.response.use(
  (response) => response,
  (error) => {
    // logger.error("请求失败", {
    //   url: error.config?.url,
    //   status: error.response?.status,
    //   data: error.response?.data,
    //   message: error.message,
    // });
    return Promise.reject(error);
  }
);

// 封装
const request = {
  async get<T = any>(
    url: string,
    config?: ExtendedAxiosRequestConfig
  ): Promise<AxiosResponse<T>> {
    return retryRequest<T>(() => ({ ...config, method: "GET", url }));
  },
  async post<T = any>(
    url: string,
    config?: ExtendedAxiosRequestConfig,
    getData?: (() => any | Promise<any>) | any
  ): Promise<AxiosResponse<T>> {
    return retryRequest<T>(async () => {
      return {
        ...config,
        method: "POST",
        url,
        data: typeof getData === "function" ? await getData() : getData,
      };
    });
  },
  async put<T = any>(
    url: string,
    config?: ExtendedAxiosRequestConfig,
    getData?: (() => any | Promise<any>) | any
  ): Promise<AxiosResponse<T>> {
    return retryRequest<T>(async () => {
      return {
        ...config,
        method: "PUT",
        url,
        data: typeof getData === "function" ? await getData() : getData,
      };
    });
  },
  async delete<T = any>(
    url: string,
    config?: ExtendedAxiosRequestConfig
  ): Promise<AxiosResponse<T>> {
    return retryRequest<T>(() => ({ ...config, method: "DELETE", url }));
  },
  instance,
};

export default request;
