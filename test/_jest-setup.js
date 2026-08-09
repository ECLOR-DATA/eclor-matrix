// jsdom does not ship a Web Crypto implementation. Bind Node's webcrypto so
// `globalThis.crypto.subtle` is available in tests.
const { webcrypto } = require("node:crypto");
if (!globalThis.crypto || !globalThis.crypto.subtle) {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true
  });
}

// jsdom < 22 also lacks the standard TextEncoder/TextDecoder globals.
const { TextEncoder, TextDecoder } = require("node:util");
if (typeof globalThis.TextEncoder === "undefined") {
  globalThis.TextEncoder = TextEncoder;
}
if (typeof globalThis.TextDecoder === "undefined") {
  globalThis.TextDecoder = TextDecoder;
}
