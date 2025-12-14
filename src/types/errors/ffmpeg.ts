export class FfmpegError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FfmpegError";
  }
}

export class FfmpegSetupError extends FfmpegError {
  constructor(message: string) {
    super(message);
    this.name = "FfmpegSetupError";
  }
}

export class FfmpegExitError extends FfmpegError {
  code: number | null;
  signal: string | null;
  constructor(message: string, code: number | null, signal: string | null) {
    super(message);
    this.name = "FfmpegExitError";
    this.code = code;
    this.signal = signal;
  }
}
