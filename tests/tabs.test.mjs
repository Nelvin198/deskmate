import assert from "node:assert/strict";
import test from "node:test";
import { deferred, loadSource, waitFor } from "./helpers.mjs";

async function fixture() {
  const renders = [];
  class Component {
    constructor() { this.cleanups = []; }
    load() { this.loaded = true; }
    unload() { this.loaded = false; this.cleanups.splice(0).forEach((callback) => callback()); }
    register(callback) { this.cleanups.push(callback); }
  }
  const { TabsWidget } = await loadSource("src/widgets/tabs.ts", {
    __obsidian: { Component, MarkdownRenderChild: Component, MarkdownRenderer: { render: async (_app, body, target, _path, component) => {
      const render = { body, target, component }; renders.push(render);
      if (body.startsWith("Slow")) { render.gate = deferred(); await render.gate.promise; }
      component.register(() => { render.cleaned = true; });
      target.body = body;
    } }, Notice: class { constructor(message) { throw new Error(message); } } },
    createDiv: () => ({}),
  });
  const files = [{ path: "Home/Today.md", basename: "Today" }, { path: "Home/Notes.md", basename: "Notes" }];
  const text = new Map([[files[0], "Today content"], [files[1], "Notes content"]]);
  const plugin = { app: {
    saveLocalStorage() {},
    metadataCache: { getFirstLinkpathDest: (link) => files.find((file) => file.path.replace(/\.md$/, "") === link), getFileCache: () => ({}) },
    vault: { cachedRead: async (file) => text.get(file) },
  } };
  const widget = new TabsWidget({}, plugin, "Today: [[Home/Today]]\nNotes: [[Home/Notes]]", "Home.md");
  widget.panel = { replaceChildren(target) { this.target = target; }, empty() { this.target = undefined; } };
  return { widget, plugin, files, text, renders };
}

test("clicking the current tab or refreshing identical content keeps existing widgets alive", async () => {
  const f = await fixture(); await f.widget.select(0);
  const first = f.renders[0];
  await f.widget.select(0); await f.widget.select(0, true);
  assert.equal(f.renders.length, 1); assert.equal(first.component.loaded, true);
  f.text.set(f.files[0], "Updated content"); await f.widget.select(0, true);
  assert.equal(f.renders.length, 2); assert.equal(first.cleaned, true);
  f.widget.onunload(); assert.equal(f.renders[1].cleaned, true);
});

test("leaving a tab during a read prevents late rendering", async () => {
  const f = await fixture(), read = deferred();
  f.plugin.app.vault.cachedRead = () => read.promise;
  const selected = f.widget.select(0); f.widget.onunload();
  read.resolve("Loaded too late"); await selected;
  assert.equal(f.renders.length, 0); assert.equal(f.widget.panel.target, undefined);
});

test("rapid tab changes dispose late render resources and show only the latest tab", async () => {
  const f = await fixture(); f.text.set(f.files[0], "Slow content");
  const first = f.widget.select(0); await waitFor(() => f.renders.length === 1);
  await f.widget.select(1);
  const latest = f.widget.panel.target;
  f.renders[0].gate.resolve(); await first;
  assert.equal(f.widget.panel.target, latest); assert.equal(latest.body, "Notes content");
  assert.equal(f.renders[0].component.loaded, false); assert.equal(f.renders[0].cleaned, true);
  f.widget.onunload(); assert.equal(f.renders[1].cleaned, true);
});
