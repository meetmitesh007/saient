import assert from "node:assert/strict";
import {
  isPrivateLanHost,
  validatedDesktopBinding,
  validatedDesktopUrl,
} from "../lib/desktop-url.ts";

const privateUrls = [
  "127.0.0.1:18788",
  "http://10.0.0.2:18788",
  "http://169.254.2.3:18788",
  "http://172.16.0.1:18788",
  "http://172.31.255.254:18788",
  "http://192.168.0.44:18788",
  "http://desktop.local:18788",
  "http://[::1]:18788",
  "http://[fd00::1]:18788",
  "http://[fe80::1]:18788",
];
for (const url of privateUrls) {
  assert.doesNotThrow(() => validatedDesktopUrl(url), url);
}
assert.equal(validatedDesktopUrl("192.168.0.44:18788"), "http://192.168.0.44:18788");
assert.equal(validatedDesktopUrl("https://studio.example.com"), "https://studio.example.com");

const rejectedUrls = [
  "ftp://192.168.0.44:18788",
  "http://8.8.8.8:18788",
  "http://172.15.0.1:18788",
  "http://172.32.0.1:18788",
  "http://example.com:18788",
  "http://user:password@192.168.0.44:18788",
  "http://192.168.0.44:18788/api",
  "http://192.168.0.44:18788?token=leak",
  "http://192.168.0.44:18788#fragment",
];
for (const url of rejectedUrls) {
  assert.throws(() => validatedDesktopUrl(url), undefined, url);
}

const token = "a".repeat(64);
assert.deepEqual(
  validatedDesktopBinding({ url: "192.168.0.44:18788", token }),
  { url: "http://192.168.0.44:18788", token },
);
assert.throws(() => validatedDesktopBinding({ url: "192.168.0.44:18788", token: "short" }));
assert.throws(() => validatedDesktopBinding({ url: "192.168.0.44:18788", token: `${"a".repeat(32)}\nInjected` }));
assert.throws(() => validatedDesktopBinding({ url: "192.168.0.44:18788", token: "a".repeat(257) }));
assert.equal(isPrivateLanHost("192.168.1.1"), true);
assert.equal(isPrivateLanHost("192.169.1.1"), false);

console.log(`desktop URL policy: ${privateUrls.length} allowed and ${rejectedUrls.length} rejected cases passed`);
