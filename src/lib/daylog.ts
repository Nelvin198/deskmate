import { App, TFile, normalizePath } from "obsidian";
import { moment } from "./dates";

/**
 * A day log note looks like this, newest day first:
 *
 *   ## 2026-11-04 (Wednesday)
 *   - 09:10 Gym: 50 push-ups
 *   - 14:32 Finished German lesson 2
 */
export interface LogEntry {
	time: string;
	text: string;
	line: number;
	raw: string;
}

const DAY_HEADING = /^##\s+(\d{4}-\d{2}-\d{2})\b/;
const ENTRY = /^[-*]\s+(\d{1,2}:\d{2})\s+(.*)$/;

const eolOf = (text: string) => (text.includes("\r\n") ? "\r\n" : "\n");
const linesOf = (text: string) => text.split(/\r?\n/);

/** Index of the "## day" heading and the line after its section ends. */
function section(lines: string[], day: string): { start: number; end: number } | undefined {
	const start = lines.findIndex((l) => l.match(DAY_HEADING)?.[1] === day);
	if (start < 0) return undefined;
	let end = start + 1;
	while (end < lines.length && !/^#{1,2}\s/.test(lines[end])) end++;
	return { start, end };
}

export function entriesFor(text: string, day: string): LogEntry[] {
	const lines = linesOf(text);
	const range = section(lines, day);
	if (!range) return [];
	const entries: LogEntry[] = [];
	for (let i = range.start + 1; i < range.end; i++) {
		const match = lines[i].match(ENTRY);
		if (match) entries.push({ time: match[1], text: match[2].trim(), line: i, raw: lines[i] });
	}
	return entries;
}

/** Adds "- HH:mm text" under the day's heading, creating the heading at the top if it is a new day. */
export function insertEntry(text: string, day: string, time: string, entry: string): string {
	const eol = eolOf(text);
	const lines = linesOf(text);
	const line = `- ${time} ${entry}`;
	const range = section(lines, day);
	if (range) {
		let at = range.end;
		while (at > range.start + 1 && lines[at - 1].trim() === "") at--;
		lines.splice(at, 0, line);
		return lines.join(eol);
	}
	const heading = `## ${day} (${moment(day).format("dddd")})`;
	// Newest day first: put it above the first existing day, or at the end of the intro.
	let at = lines.findIndex((l) => DAY_HEADING.test(l));
	if (at < 0) {
		while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
		lines.push("", heading, line, "");
	} else {
		lines.splice(at, 0, heading, line, "");
	}
	return lines.join(eol);
}

function findEntry(lines: string[], entry: LogEntry): number {
	if (lines[entry.line] === entry.raw) return entry.line;
	return lines.findIndex((l) => l === entry.raw);
}

function changeFile(app: App, file: TFile, change: (lines: string[]) => void): Promise<string> {
	return app.vault.process(file, (text) => {
		const lines = linesOf(text);
		change(lines);
		return lines.join(eolOf(text));
	});
}

export async function findOrCreateLog(app: App, note: string, sourcePath: string): Promise<TFile> {
	const name = note.replace(/^\[\[|\]\]$/g, "").replace(/\.md$/, "").trim() || "Day Log";
	const existing = app.metadataCache.getFirstLinkpathDest(name, sourcePath);
	if (existing) return existing;
	const path = normalizePath(`${name}.md`);
	const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
	if (folder && !app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder);
	const title = name.split("/").pop() ?? "Day log";
	return app.vault.create(path, `# ${title}\nWhat happened each day, newest first.\n`);
}

export function findLog(app: App, note: string, sourcePath: string): TFile | null {
	const name = note.replace(/^\[\[|\]\]$/g, "").replace(/\.md$/, "").trim() || "Day Log";
	return app.metadataCache.getFirstLinkpathDest(name, sourcePath);
}

export async function addEntry(app: App, file: TFile, day: string, time: string, text: string): Promise<void> {
	const clean = text.replace(/\s+/g, " ").trim();
	if (!clean) return;
	await app.vault.process(file, (data) => insertEntry(data, day, time, clean));
}

export async function editEntry(app: App, file: TFile, entry: LogEntry, text: string): Promise<void> {
	const clean = text.replace(/\s+/g, " ").trim();
	if (!clean) return;
	await changeFile(app, file, (lines) => {
		const at = findEntry(lines, entry);
		if (at < 0) throw new Error("This entry changed since it was loaded. Try again.");
		lines[at] = `- ${entry.time} ${clean}`;
	});
}

export async function deleteEntry(app: App, file: TFile, entry: LogEntry): Promise<{ index: number; line: string }> {
	let removed = { index: -1, line: "" };
	await changeFile(app, file, (lines) => {
		const at = findEntry(lines, entry);
		if (at < 0) throw new Error("This entry changed since it was loaded. Try again.");
		removed = { index: at, line: lines[at] };
		lines.splice(at, 1);
	});
	return removed;
}

export async function restoreEntry(app: App, file: TFile, removed: { index: number; line: string }): Promise<void> {
	await changeFile(app, file, (lines) => {
		lines.splice(Math.min(removed.index, lines.length), 0, removed.line);
	});
}
