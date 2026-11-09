// Exercise the worker embedded in the release bundle in an isolated Chrome profile.
// No vault files, saved sign-ins, model downloads or GPU inference are needed.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";

let source;
class Component {}
class Blob { constructor(parts) { source = parts.join(""); } }
class Worker {
  constructor() { this.events = {}; }
  addEventListener(kind, callback) { this.events[kind] = callback; }
  postMessage(request) { queueMicrotask(() => this.events.message({ data: { id: request.id, kind: "result", value: false } })); }
  terminate() {}
}
const module = { exports: {} };
const runtime = vm.createContext({
  module, exports: module.exports, console, Blob, Worker, queueMicrotask,
  URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} },
  navigator: { gpu: { requestAdapter: async () => ({}) } },
  window: { setTimeout, clearTimeout },
  require: (name) => {
    assert.equal(name, "obsidian");
    return { Plugin: Component, PluginSettingTab: Component, MarkdownRenderChild: Component, Platform: { isMobile: false }, moment() {} };
  },
});
vm.runInContext(await readFile("main.js", "utf8"), runtime);
const plugin = new module.exports.default();
plugin.settings.aiEnabled = true;
await plugin.aiStatus();
plugin.onunload();
assert.ok(source?.length > 1000, "release bundle must contain the worker");

let finish;
const completed = new Promise((resolve) => { finish = resolve; });
const html = `<!doctype html><script>
(async () => {
  const results = [];
  try {
    const url = URL.createObjectURL(new Blob([${JSON.stringify(source).replace(/</g, "\\u003c")}], {type: "text/javascript"}));
    const worker = new Worker(url);
    URL.revokeObjectURL(url);
    let id = 0;
    const request = (payload) => new Promise((resolve, reject) => {
      const next = ++id;
      worker.onerror = (event) => reject(new Error(event.message));
      worker.onmessage = ({data}) => { if (data.id === next && data.kind !== "progress") resolve(data); };
      worker.postMessage({...payload, id: next});
    });
    results.push(await request({kind: "cached", model: "Llama-3.2-1B-Instruct-q4f16_1-MLC"}));
    results.push(await request({kind: "generate", model: "Llama-3.2-1B-Instruct-q4f16_1-MLC", messages: [], options: {temperature: 0.6, maxTokens: 1}}));
    worker.terminate();
  } catch (error) { results.push({failure: String(error)}); }
  await fetch("/result", {method: "POST", body: JSON.stringify(results)});
})();
</script>`;
const server = http.createServer((request, response) => {
  if (request.url === "/result") {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => { response.end("OK"); finish(JSON.parse(body)); });
  } else { response.setHeader("Content-Type", "text/html"); response.end(html); }
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const tempRoot = path.resolve(tmpdir());
const profile = await mkdtemp(path.join(tempRoot, "deskmate-smoke-"));
const browser = spawn(process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", [
  "--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-background-networking",
  `--user-data-dir=${profile}`, `http://127.0.0.1:${server.address().port}`,
], { windowsHide: true, stdio: "ignore" });
let timer;
try {
  const results = await Promise.race([
    completed,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Browser worker smoke test timed out")), 30000); }),
    new Promise((_, reject) => browser.once("error", reject)),
  ]);
  assert.equal(results[0]?.kind, "result", JSON.stringify(results));
  assert.equal(results[0].value, false, "fresh browser profile has no model cached");
  assert.equal(results[1]?.kind, "error", JSON.stringify(results));
  assert.match(results[1].error, /isn't loaded/);
  console.log("Packaged worker passed in headless Chrome: startup, real Cache API check and error response; no model downloaded.");
} finally {
  clearTimeout(timer);
  const closed = once(browser, "exit");
  browser.kill(); await closed;
  server.close();
  if (!path.resolve(profile).startsWith(`${tempRoot}${path.sep}`) || !path.basename(profile).startsWith("deskmate-smoke-")) throw new Error("Refusing to remove unexpected test profile path");
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
