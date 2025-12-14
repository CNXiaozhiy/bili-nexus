export class HtmlRenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HtmlRenderError";
  }
}
