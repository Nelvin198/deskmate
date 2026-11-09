import { build } from "esbuild";
import vm from "node:vm";

export function debounce(callback, delay, reset) {
  let timer;
  let args;
  const call = (...next) => {
    args = next;
    if (reset) clearTimeout(timer);
    if (!timer || reset) timer = setTimeout(() => { timer = undefined; callback(...args); }, delay);
  };
  call.cancel = () => { clearTimeout(timer); timer = undefined; };
  call.run = () => { if (timer) { call.cancel(); return callback(...args); } };
  return call;
}

export async function loadSource(entry, globals = {}) {
  const result = await build({
    entryPoints: [entry], bundle: true, write: false, platform: "node", format: "cjs",
    plugins: [{ name: "test-runtime", setup(builder) {
      builder.onResolve({ filter: /^(obsidian|@mlc-ai\/web-llm|deskmate:ai-worker)$/ }, ({ path }) => ({ path, namespace: "test" }));
      builder.onLoad({ filter: /.*/, namespace: "test" }, ({ path }) => ({
        contents: path === "deskmate:ai-worker" ? 'export default "// test worker"' : `module.exports = globalThis.${path === "obsidian" ? "__obsidian" : "__webllm"};`,
        loader: "js",
      }));
    } }],
  });
  const module = { exports: {} };
  const context = vm.createContext({ module, exports: module.exports, console, setTimeout, clearTimeout, window: { setTimeout, clearTimeout }, ...globals });
  vm.runInContext(result.outputFiles[0].text, context, { filename: entry });
  return module.exports;
}

export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

export async function waitFor(predicate) {
  const end = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() > end) throw new Error("Timed out waiting for operation");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
