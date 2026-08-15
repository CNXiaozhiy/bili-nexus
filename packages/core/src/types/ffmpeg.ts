export interface FfmpegStats {
  frame?: string;
  fps?: string;
  quality?: string;
  size?: string;
  sizeBytes?: number;
  time?: string;
  bitrate?: string;
  speed?: string;
  timestamp: number;
}

export interface FfmpegFinalStats {
  duration: number;
  fileSize: number;
  averageBitrate: number;
  framesProcessed: number;
}

export enum FfmpegRecorderStatus {
  NOT_RECORDING = "not_recording",
  RECORDING = "recording",
  STOPPING = "stopping",
}

export enum FfmpegCommandStatus {
  NOT_STARTED = "not_started",
  RUNNING = "running",
  COMPLETED = "completed",
  ERROR = "error",
}

export enum FfmpegScreenshotStatus {
  NOT_STARTED = "not_started",
  CAPTURING = "capturing",
  COMPLETED = "completed",
  ERROR = "error",
}
