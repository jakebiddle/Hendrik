/* global globalThis */
import "groq-sdk/shims/node";
import "web-streams-polyfill/dist/polyfill.min.js";
import { TextEncoder, TextDecoder } from "util";

global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

// Polyfill Web API globals required by @mistralai/mistralai SDK in jsdom
if (typeof globalThis.Request === "undefined") {
  globalThis.Request = class Request {
    constructor(input, init) {
      this.url = typeof input === "string" ? input : input?.url || "";
      this.method = init?.method || "GET";
      this.headers = new (globalThis.Headers || Map)(init?.headers);
      this.body = init?.body || null;
    }
  };
}
if (typeof globalThis.Response === "undefined") {
  globalThis.Response = class Response {
    constructor(body, init) {
      this.body = body;
      this.status = init?.status || 200;
      this.statusText = init?.statusText || "";
      this.headers = new (globalThis.Headers || Map)(init?.headers);
    }
  };
}
