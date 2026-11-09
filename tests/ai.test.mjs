import assert from "node:assert/strict";
import test from "node:test";
import { deferred, loadSource, waitFor } from "./helpers.mjs";

async function fixture() {
  const workers = [], engines = [];
  const timers = new Map();
  let nextTimer = 0;
  let nextLoadGate;
  class Worker {
    constructor() {
      this.events = {}; this.terminated = false; workers.push(this);
      this.scope = { postMessage: (data) => { if (!this.terminated) this.events.message?.({ data }); } };
      this.ready = loadSource("src/ai/worker.ts", {
        self: this.scope,
        __webllm: {
          CreateMLCEngine: async (_model, config) => {
            const engine = new Engine(this);
            config.initProgressCallback({ progress: 0.5, text: "Loading" });
            await engine.reload(); return engine;
          },
          hasModelInCache: async () => true,
          deleteModelAllInfoInCache: async () => {},
        },
      });
    }
    addEventListener(name, callback) { this.events[name] = callback; }
    postMessage(data) { void this.ready.then(() => { if (!this.terminated) this.scope.onmessage({ data }); }); }
    terminate() { this.terminated = true; }
  }
  class Engine {
    constructor(worker) {
      this.worker = worker; this.reloads = 0; this.active = 0; this.maxActive = 0;
      this.reloadGate = nextLoadGate;
      this.chat = { completions: { create: async () => {
        this.maxActive = Math.max(this.maxActive, ++this.active);
        try { if (this.generationGate) await this.generationGate.promise; return { choices: [{ message: { content: "Done" } }] }; }
        finally { this.active--; }
      } } };
      engines.push(this);
    }
    async reload() { this.reloads++; if (this.reloadGate) await this.reloadGate.promise; }
    async unload() { this.unloaded = true; }
  }
  const { local, DEFAULT_MODEL } = await loadSource("src/ai/engine.ts", {
    Worker, Blob,
    URL: { createObjectURL: () => "blob:test", revokeObjectURL: () => {} },
    window: { setTimeout: (callback) => { const id = ++nextTimer; timers.set(id, callback); return id; }, clearTimeout: (id) => timers.delete(id) },
  });
  return { local, model: DEFAULT_MODEL, workers, engines, timers, holdLoad: (gate) => { nextLoadGate = gate; }, generate: () => local.generate(DEFAULT_MODEL, [], { temperature: 0.6, maxTokens: 20 }) };
}

test("simultaneous daily AI requests share one worker and run sequentially", async () => {
  const f = await fixture();
  await f.local.load(f.model);
  const engine = f.engines[0];
  engine.generationGate = deferred();
  const first = f.generate(), second = f.generate();
  await waitFor(() => engine.active === 1);
  assert.equal(f.workers.length, 1);
  assert.equal(f.timers.size, 0, "no idle unload while generation is active or queued");
  engine.generationGate.resolve();
  assert.equal(await first, "Done"); assert.equal(await second, "Done");
  assert.equal(engine.maxActive, 1); assert.equal(engine.reloads, 1);
  assert.equal(f.timers.size, 1);
  await f.local.unload(); assert.equal(f.workers[0].terminated, true); assert.equal(f.timers.size, 0);
});

test("unloading interrupts an active generation, cancels queued requests and permits a fresh worker", async () => {
  const f = await fixture(); await f.local.load(f.model);
  f.engines[0].generationGate = deferred();
  const first = f.generate(), second = f.generate();
  const firstRejected = assert.rejects(first, /cancelled/), secondRejected = assert.rejects(second, /cancelled/);
  await waitFor(() => f.engines[0].active === 1);
  await f.local.unload(); await Promise.all([firstRejected, secondRejected]);
  assert.equal(f.workers[0].terminated, true);
  assert.equal(await f.generate(), "Done"); assert.equal(f.workers.length, 2);
  await f.local.unload();
});

test("a worker crash rejects the request and the next request recovers", async () => {
  const f = await fixture(); await f.local.load(f.model);
  f.engines[0].generationGate = deferred();
  const result = f.generate(); const rejected = assert.rejects(result, /GPU worker failed/);
  await waitFor(() => f.engines[0].active === 1);
  f.workers[0].events.error({ message: "GPU worker failed" }); await rejected;
  assert.equal(await f.generate(), "Done"); assert.equal(f.workers.length, 2);
  assert.equal(f.workers[0].terminated, true); await f.local.unload();
});

test("an idle worker is released", async () => {
  const f = await fixture(); await f.generate();
  const idle = [...f.timers.values()][0]; idle();
  await waitFor(() => f.local.pending === 0);
  assert.equal(f.workers[0].terminated, true); assert.equal(f.timers.size, 0);
});

test("cache checks avoid loading a model, and load progress travels back from the worker", async () => {
  const f = await fixture();
  assert.equal(await f.local.cached(f.model), true);
  await f.local.delete(f.model);
  assert.equal(f.engines.length, 0);
  const progress = [];
  await f.local.load(f.model, (fraction, text) => progress.push([fraction, text]));
  assert.deepEqual(progress, [[0.5, "Loading"]]);
  assert.equal(f.workers.length, 1);
  await f.local.load("SmolLM2-360M-Instruct-q4f16_1-MLC");
  assert.equal(f.engines[0].unloaded, true);
  assert.equal(f.engines.length, 2);
  await f.local.unload();
});

test("unloading during model initialization rejects promptly without leaving an orphan worker", async () => {
  const f = await fixture(), gate = deferred(); f.holdLoad(gate);
  const loading = f.local.load(f.model), rejected = assert.rejects(loading, /cancelled/);
  await waitFor(() => f.engines.length === 1);
  await f.local.unload(); await rejected;
  assert.equal(f.workers[0].terminated, true);
  f.holdLoad(undefined); gate.resolve();
  assert.equal(await f.generate(), "Done"); assert.equal(f.workers.length, 2);
  await f.local.unload();
});

test("failed initialization releases the worker and allows a retry", async () => {
  const f = await fixture(), gate = deferred(); f.holdLoad(gate);
  const loading = f.local.load(f.model), rejected = assert.rejects(loading, /not enough memory/);
  await waitFor(() => f.engines.length === 1);
  gate.reject(new Error("not enough memory")); await rejected;
  assert.equal(f.workers[0].terminated, true);
  f.holdLoad(undefined); assert.equal(await f.generate(), "Done");
  await f.local.unload();
});
