import assert from "node:assert/strict";
import test from "node:test";
import { debounce, deferred, loadSource, waitFor } from "./helpers.mjs";

async function fixture(size = 3) {
  const { TaskIndex } = await loadSource("src/lib/tasks.ts", { __obsidian: { debounce } });
  const files = Array.from({ length: size }, (_, i) => ({ path: `Notes/${i}.md`, extension: "md" }));
  const text = new Map(files.map((file, i) => [file, `- [ ] Task ${i} 📅 2026-11-06\n`]));
  const reads = [];
  let excluded = [];
  const app = {
    vault: { getMarkdownFiles: () => files, cachedRead: async (file) => { reads.push(file.path); return text.get(file); } },
    metadataCache: { getFileCache: (file) => ({ listItems: (text.get(file) ?? "").split("\n").flatMap((line, i) => /^- \[.\]/.test(line) ? [{ task: line[3], position: { start: { line: i } } }] : []) }) },
  };
  const index = new TaskIndex(app, () => excluded);
  let notifications = 0;
  index.subscribe(() => notifications++);
  const flush = async () => { index.schedule.run(); await waitFor(() => !index.scanning); };
  return { app, index, files, text, reads, flush, exclude: (folders) => { excluded = folders; }, notifications: () => notifications };
}

test("editing one task in 1,000 notes uses event data without rereading the vault", async (t) => {
  const f = await fixture(1000);
  t.after(() => f.index.dispose());
  f.index.refresh();
  await f.flush();
  assert.equal(f.index.tasks.length, 1000);
  assert.equal(f.reads.length, 1000);
  f.reads.length = 0;
  const file = f.files[417];
  const changed = "- [x] Finished 📅 2026-11-06 ✅ 2026-11-06\n";
  f.text.set(file, changed);
  f.index.update(file, changed);
  await f.flush();
  assert.equal(f.reads.length, 0);
  assert.equal(f.index.tasks.find((task) => task.file === file).doneDate, "2026-11-06");
  assert.equal(f.index.tasks.length, 1000);
  console.log("1,000-note fixture: initial 1,000 reads; single edit 0 reads (previous full scan: 1,000).");
});

test("edits outside tasks do not notify widgets or replace the shared task list", async (t) => {
  const f = await fixture(); t.after(() => f.index.dispose());
  f.index.refresh(); await f.flush();
  const tasks = f.index.tasks;
  const notifications = f.notifications();
  const file = f.files[0];
  f.text.set(file, f.text.get(file) + "Unrelated paragraph\n");
  f.index.update(file, f.text.get(file)); await f.flush();
  assert.equal(f.index.tasks, tasks);
  assert.equal(f.notifications(), notifications);
});

test("task removals, renames, deleted notes and exclusion changes reconcile correctly", async (t) => {
  const f = await fixture(); t.after(() => f.index.dispose());
  f.index.refresh(); await f.flush();
  f.text.set(f.files[0], "No tasks left.");
  f.index.update(f.files[0], f.text.get(f.files[0])); await f.flush();
  assert.equal(f.index.tasks.length, 2);
  const file = f.files[1], oldPath = file.path;
  file.path = "Archive/renamed.md";
  f.index.remove(oldPath); f.index.update(file); await f.flush();
  assert.equal(f.index.tasks.filter((task) => task.file === file).length, 1);
  f.exclude(["Archive"]); f.index.refresh(); await f.flush();
  assert.equal(f.index.tasks.length, 1);
  f.exclude([]); f.index.refresh(); await f.flush();
  assert.equal(f.index.tasks.length, 2);
  f.files.splice(f.files.indexOf(file), 1); f.index.remove(file.path); await f.flush();
  assert.equal(f.index.tasks.length, 1);
  assert.equal(f.index.noteCount, 2);
});

test("a newer edit arriving during a file read wins", async (t) => {
  const f = await fixture(1); t.after(() => f.index.dispose());
  const read = deferred();
  f.app.vault.cachedRead = () => read.promise;
  f.index.refresh(); f.index.schedule.run();
  await waitFor(() => f.index.scanning);
  const changed = "- [ ] Newest task 📅 2026-11-07\n";
  f.text.set(f.files[0], changed); f.index.update(f.files[0], changed);
  read.resolve("- [ ] Old task 📅 2026-11-06\n");
  await waitFor(() => !f.index.scanning);
  assert.equal(f.index.tasks[0].text, "Newest task");
});

test("a failed file read preserves existing tasks and does not block other updates", async (t) => {
  const f = await fixture(); t.after(() => f.index.dispose());
  f.index.refresh(); await f.flush();
  const previous = f.index.tasks[0];
  const original = f.app.vault.cachedRead;
  f.app.vault.cachedRead = (file) => file === f.files[0] ? Promise.reject(new Error("temporarily unavailable")) : original(file);
  f.index.update(f.files[0]);
  const changed = "- [ ] Still updates\n";
  f.text.set(f.files[1], changed); f.index.update(f.files[1], changed); await f.flush();
  assert.equal(f.index.tasks[0], previous);
  assert.equal(f.index.tasks.find((task) => task.file === f.files[1]).text, "Still updates");
});

test("disabling the plugin cancels pending and in-flight indexing", async () => {
  const f = await fixture(1), read = deferred();
  f.app.vault.cachedRead = () => read.promise;
  f.index.refresh(); f.index.schedule.run();
  f.index.dispose(); read.resolve("- [ ] Late task\n");
  await waitFor(() => !f.index.scanning);
  assert.equal(f.notifications(), 0);
  assert.equal(f.index.tasks.length, 0);
  f.index.refresh(); assert.equal(f.index.fullScan, false);
});
