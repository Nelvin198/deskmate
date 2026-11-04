import { App, TFile, debounce, normalizePath } from "obsidian";
import { moment } from "./dates";

/**
 * Tasks use the Tasks plugin's emoji format, so Deskmate works with or without it:
 *   - [ ] Buy milk 📅 2026-11-03
 *   - [x] Buy milk 📅 2026-11-03 ✅ 2026-11-03
 */
export interface Task {
	file: TFile;
	line: number;
	raw: string;
	text: string;
	status: string;
	due?: string;
	doneDate?: string;
}

const TASK_LINE = /^(\s*(?:[-*+]|\d+[.)])\s+\[)(.)(\].*)$/;
const DUE = /📅\s*(\d{4}-\d{2}-\d{2})/u;
const DONE = /✅\s*(\d{4}-\d{2}-\d{2})/u;
// Everything after the first Tasks signifier is metadata, not the task's text.
const SIGNIFIERS = /\s*(?:📅|✅|➕|⏳|🛫|🔁|❌|🆔|⛔|⏫|🔼|🔽|🔺|⏬).*$/u;

export const isOpen = (t: Task) => t.status === " ";
export const isDone = (t: Task) => t.status === "x" || t.status === "X";

export function isExcluded(path: string, excluded: string[]): boolean {
	return excluded.some((folder) => {
		const f = folder.replace(/^\/+|\/+$/g, "");
		return f !== "" && (path === f || path.startsWith(`${f}/`));
	});
}

function displayText(body: string): string {
	return body
		.replace(SIGNIFIERS, "")
		.replace(/\s\^[\w-]+\s*$/, "")
		.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
		.replace(/\[\[([^\]]+)\]\]/g, "$1")
		.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
		.replace(/(\*\*|__|==|~~)/g, "")
		.trim();
}

/** Keeps one up-to-date list of every task in the vault for all widgets to share. */
export class TaskIndex {
	tasks: Task[] = [];
	noteCount = 0;
	private listeners = new Set<() => void>();

	constructor(private app: App, private excluded: () => string[]) {}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	refresh = debounce(() => void this.scan(), 400, true);

	private run = 0;

	private async scan(): Promise<void> {
		// If a newer scan starts while this one is reading files, this one's result is dropped.
		const run = ++this.run;
		const excluded = this.excluded();
		const files = this.app.vault.getMarkdownFiles();
		const tasks: Task[] = [];
		for (const file of files) {
			if (isExcluded(file.path, excluded)) continue;
			const items = this.app.metadataCache.getFileCache(file)?.listItems?.filter((i) => i.task !== undefined);
			if (!items?.length) continue;
			const lines = (await this.app.vault.cachedRead(file)).split("\n");
			for (const item of items) {
				const line = item.position.start.line;
				const raw = lines[line]?.replace(/\r$/, "");
				const match = raw?.match(TASK_LINE);
				if (!raw || !match) continue;
				const body = match[3].slice(1);
				tasks.push({
					file,
					line,
					raw,
					text: displayText(body),
					status: match[2],
					due: body.match(DUE)?.[1],
					doneDate: body.match(DONE)?.[1],
				});
			}
		}
		if (run !== this.run) return;
		this.tasks = tasks;
		this.noteCount = files.length;
		for (const listener of this.listeners) listener();
	}
}

/** Finds the task's current line, even if lines above it moved since the last scan. */
function findLine(lines: string[], task: Task): number {
	const strip = (l: string | undefined) => l?.replace(/\r$/, "");
	if (strip(lines[task.line]) === task.raw) return task.line;
	return lines.findIndex((l) => strip(l) === task.raw);
}

function rewriteTask(app: App, task: Task, change: (line: string) => string): Promise<string> {
	return app.vault.process(task.file, (text) => {
		const lines = text.split("\n");
		const at = findLine(lines, task);
		if (at < 0) throw new Error("This task changed since it was loaded. Try again.");
		const cr = lines[at].endsWith("\r") ? "\r" : "";
		lines[at] = change(lines[at].replace(/\r$/, "")) + cr;
		return lines.join("\n");
	});
}

/** Splits a task line into its checkbox, the user's own words, the Tasks metadata and a block id. */
function splitTask(line: string): { prefix: string; description: string; metadata: string; block: string } {
	const match = line.match(TASK_LINE);
	if (!match) return { prefix: "- [ ]", description: line.trim(), metadata: "", block: "" };
	const rest = match[3].slice(1);
	const blockMatch = rest.match(/\s\^[\w-]+\s*$/);
	const block = blockMatch ? blockMatch[0].trimEnd() : "";
	const core = blockMatch ? rest.slice(0, blockMatch.index) : rest;
	const at = core.search(SIGNIFIERS);
	return {
		prefix: `${match[1]}${match[2]}]`,
		description: (at < 0 ? core : core.slice(0, at)).trim(),
		metadata: at < 0 ? "" : core.slice(at).trim(),
		block,
	};
}

/** The task's words as written in the note (with links and formatting), for editing. */
export function taskDescription(task: Task): string {
	return splitTask(task.raw).description;
}

/** Replaces the task's words, keeping its checkbox, dates, repeat rule and block id. */
export async function editTask(app: App, task: Task, description: string): Promise<void> {
	const clean = description.replace(/\s+/g, " ").trim();
	if (!clean) return;
	await rewriteTask(app, task, (line) => {
		const parts = splitTask(line);
		return `${parts.prefix} ${clean}${parts.metadata ? ` ${parts.metadata}` : ""}${parts.block}`;
	});
}

/** Removes the task's line from its note and returns what is needed to put it back. */
export async function deleteTask(app: App, task: Task): Promise<{ index: number; line: string }> {
	let removed = { index: -1, line: "" };
	await app.vault.process(task.file, (text) => {
		const lines = text.split("\n");
		const at = findLine(lines, task);
		if (at < 0) throw new Error("This task changed since it was loaded. Try again.");
		removed = { index: at, line: lines[at] };
		lines.splice(at, 1);
		return lines.join("\n");
	});
	return removed;
}

export async function restoreTask(app: App, file: TFile, removed: { index: number; line: string }): Promise<void> {
	await app.vault.process(file, (text) => {
		const lines = text.split("\n");
		lines.splice(Math.min(removed.index, lines.length), 0, removed.line);
		return lines.join("\n");
	});
}

const RECURRENCE = /🔁\s*every\s+(?:(\d+)\s+)?(weekday|day|week|month|year)s?\b(?:\s+on\s+\w+)?(\s+when done)?/iu;

/**
 * Next due date for a repeating task, using the Tasks plugin's 🔁 rules:
 * from the due date, or from the done date with "when done".
 */
export function nextDue(line: string, due: string | undefined, today: string): string | undefined {
	const match = line.match(RECURRENCE);
	if (!match) return undefined;
	const [, count, unit, whenDone] = match;
	const from = moment(whenDone || !due ? today : due);
	const n = Number(count ?? 1);
	switch (unit.toLowerCase()) {
		case "day":
			return from.add(n, "days").format("YYYY-MM-DD");
		case "week":
			return from.add(n, "weeks").format("YYYY-MM-DD");
		case "month":
			return from.add(n, "months").format("YYYY-MM-DD");
		case "year":
			return from.add(n, "years").format("YYYY-MM-DD");
		default: {
			// weekday: the next Monday to Friday
			const next = from.add(1, "days");
			while (next.day() === 0 || next.day() === 6) next.add(1, "days");
			return next.format("YYYY-MM-DD");
		}
	}
}

export async function completeTask(app: App, task: Task, today: string): Promise<void> {
	const next = RECURRENCE.test(task.raw) ? nextDue(task.raw, task.due, today) : undefined;
	await app.vault.process(task.file, (text) => {
		const lines = text.split("\n");
		const at = findLine(lines, task);
		if (at < 0) throw new Error("This task changed since it was loaded. Try again.");
		const cr = lines[at].endsWith("\r") ? "\r" : "";
		const line = lines[at].replace(/\r$/, "");
		const ticked = line.replace(TASK_LINE, "$1x$3").replace(/\s*✅\s*\d{4}-\d{2}-\d{2}/u, "");
		// Keep a block id (^abc) at the very end, after the done date.
		const block = ticked.match(/(\s\^[\w-]+)\s*$/);
		const base = block ? ticked.slice(0, block.index) : ticked.replace(/\s+$/, "");
		lines[at] = `${base} ✅ ${today}${block ? block[1] : ""}${cr}`;
		if (next) {
			// Like the Tasks plugin: the next occurrence goes above the finished one, without the block id.
			const fresh = line
				.replace(/\s\^[\w-]+\s*$/, "")
				.replace(/\s*✅\s*\d{4}-\d{2}-\d{2}/u, "")
				.replace(DUE, `📅 ${next}`);
			lines.splice(at, 0, (DUE.test(line) ? fresh : `${fresh.replace(/\s+$/, "")} 📅 ${next}`) + cr);
		}
		return lines.join("\n");
	});
}

export function reopenTask(app: App, task: Task): Promise<string> {
	return rewriteTask(app, task, (line) => line.replace(TASK_LINE, "$1 $3").replace(/\s*✅\s*\d{4}-\d{2}-\d{2}/u, ""));
}

export async function addTask(app: App, path: string, text: string, due: string): Promise<void> {
	const clean = text.replace(/\s+/g, " ").trim();
	if (!clean) return;
	const line = `- [ ] ${clean} 📅 ${due}`;
	const target = normalizePath(path.endsWith(".md") ? path : `${path}.md`);
	const existing = app.vault.getAbstractFileByPath(target);
	if (existing instanceof TFile) {
		await app.vault.process(existing, (data) => {
			const eol = data.includes("\r\n") ? "\r\n" : "\n";
			return `${data.replace(/\s+$/, "")}${eol}${line}${eol}`;
		});
		return;
	}
	const folder = target.includes("/") ? target.slice(0, target.lastIndexOf("/")) : "";
	if (folder && !app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder);
	await app.vault.create(target, `${line}\n`);
}
