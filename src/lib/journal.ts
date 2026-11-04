import type { App, TFile } from "obsidian";
import { appHasDailyNotesPluginLoaded, createDailyNote, getAllDailyNotes, getDailyNote } from "obsidian-daily-notes-interface";
import { moment } from "./dates";

const HEADING = "## Day summary";

/**
 * Puts the summary under "## Day summary" at the end of a journal note.
 * If that section already exists its text is replaced, so saving again never duplicates it.
 */
export function withDaySummary(text: string, summary: string): string {
	const eol = text.includes("\r\n") ? "\r\n" : "\n";
	const lines = text.split(/\r?\n/);
	const at = lines.findIndex((l) => l.trim() === HEADING);
	if (at >= 0) {
		let end = at + 1;
		while (end < lines.length && !/^#{1,2}\s/.test(lines[end])) end++;
		const after = lines.slice(end);
		const section = [HEADING, summary, ""];
		return [...lines.slice(0, at), ...section, ...after].join(eol);
	}
	while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
	return [...lines, "", HEADING, summary, ""].join(eol);
}

/** The journal (daily) note for a day, created from the Daily notes template if it doesn't exist yet. */
async function journalNote(day: string): Promise<TFile> {
	if (!appHasDailyNotesPluginLoaded()) {
		throw new Error("Turn on the Daily notes core plugin to save summaries to your journal.");
	}
	const date = moment(day);
	let note: TFile | undefined;
	try {
		note = getDailyNote(date, getAllDailyNotes()) ?? undefined;
	} catch {
		// The journal folder doesn't exist yet; creating the note makes it.
	}
	note ??= await createDailyNote(date);
	if (!note) throw new Error("Couldn't create today's journal note.");
	return note;
}

export async function addSummaryToJournal(app: App, day: string, summary: string): Promise<TFile> {
	const note = await journalNote(day);
	await app.vault.process(note, (text) => withDaySummary(text, summary));
	return note;
}
