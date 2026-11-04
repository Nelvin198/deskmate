import { MarkdownRenderChild, Notice, TFile, debounce, setIcon } from "obsidian";
import type DeskmatePlugin from "../main";
import { dayKey, moment } from "../lib/dates";
import { LogEntry, addEntry, deleteEntry, editEntry, entriesFor, findLog, findOrCreateLog, restoreEntry } from "../lib/daylog";
import { addSummaryToJournal } from "../lib/journal";
import { cleanReply, summaryPrompt } from "../ai/prompts";

const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

/**
 * ```deskmate-daylog
 * note: Day Log
 * ```
 * A quick "what's happening?" box. Each line is saved with the time under today's heading.
 */
export class DayLogWidget extends MarkdownRenderChild {
	private day = dayKey();
	private listEl!: HTMLElement;
	private summaryEl!: HTMLElement;
	private entries: LogEntry[] = [];
	private dateEl!: HTMLElement;

	constructor(containerEl: HTMLElement, private plugin: DeskmatePlugin, private options: Record<string, string>, private sourcePath: string) {
		super(containerEl);
	}

	private get note(): string {
		return this.options.note || this.plugin.settings.dayLogNote || "Day Log";
	}

	onload(): void {
		const root = this.containerEl.createDiv({ cls: "dm-card dm-daylog" });
		const head = root.createDiv("dm-card-head");
		head.createDiv({ cls: "dm-label", text: this.options.title || "Day log" });
		this.dateEl = head.createDiv("dm-count");

		this.renderAdd(root);
		this.listEl = root.createDiv("dm-log-list");
		this.summaryEl = root.createDiv("dm-log-summary");

		const open = root.createEl("a", { cls: "dm-log-open", text: "Open full log", href: "#" });
		open.addEventListener("click", (e) => {
			e.preventDefault();
			findOrCreateLog(this.plugin.app, this.note, this.sourcePath)
				.then((file) => this.plugin.app.workspace.getLeaf(false).openFile(file))
				.catch((error: unknown) => new Notice(errorText(error, "Couldn't open the day log.")));
		});

		const refresh = debounce(() => void this.render(), 300, true);
		this.register(this.plugin.onDailyChange(refresh));
		this.registerEvent(
			this.plugin.app.vault.on("modify", (file) => {
				if (file instanceof TFile && file.path === this.file()?.path) refresh();
			}),
		);
		this.registerEvent(this.plugin.app.vault.on("create", refresh));
		this.registerEvent(this.plugin.app.vault.on("rename", refresh));
		this.registerInterval(
			window.setInterval(() => {
				if (dayKey() === this.day) return;
				this.day = dayKey();
				void this.render();
			}, 30 * 1000),
		);
		void this.render();
	}

	private file(): TFile | null {
		return findLog(this.plugin.app, this.note, this.sourcePath);
	}

	private async render(): Promise<void> {
		this.dateEl.setText(moment(this.day).format("dddd, D MMM"));
		const file = this.file();
		const entries = file ? entriesFor(await this.plugin.app.vault.cachedRead(file), this.day) : [];
		this.entries = entries;
		this.listEl.empty();
		if (!file || !entries.length) this.listEl.createDiv({ cls: "dm-empty", text: "Nothing logged yet today." });
		else for (const entry of entries) this.renderEntry(file, entry);
		await this.renderSummary();
	}

	/** "Your day": an AI summary of today's entries that can be saved to the journal. */
	private async renderSummary(): Promise<void> {
		const day = this.day;
		const item = this.plugin.getDaily(day);
		const ai = await this.plugin.aiReady();
		const el = this.summaryEl;
		el.empty();
		// Only where it can be written, or once one exists.
		if (!ai && !item.summary) return;

		el.createDiv({ cls: "dm-label", text: "Your day" });
		if (item.summary) el.createDiv({ cls: "dm-daily-text", text: item.summary });
		else el.createDiv({ cls: "dm-daily-text dm-placeholder", text: "Log a few moments, then sum up your day." });
		if (!ai) return;

		const actions = el.createDiv("dm-daily-actions");
		const summarise = actions.createEl("button", { text: item.summary ? "Summarise again" : "Summarise my day" });
		summarise.addEventListener("click", () => void this.summarise(summarise));
		if (item.summary && !item.summarySaved) {
			const save = actions.createEl("button", { cls: "mod-cta", text: "Add to journal" });
			save.addEventListener("click", () => void this.saveToJournal(item.summary ?? "", save));
		}
	}

	private async summarise(button: HTMLButtonElement): Promise<void> {
		const lines = this.entries.filter((e) => !/^Summary:/i.test(e.text)).map((e) => `${e.time} ${e.text}`);
		if (!lines.length) {
			new Notice("Add a few lines to today's log first.");
			return;
		}
		button.disabled = true;
		button.setText("Summarising…");
		try {
			const raw = await this.plugin.aiGenerate(summaryPrompt(lines), { temperature: 0.6, maxTokens: 280 });
			await this.plugin.setDaily(this.day, { summary: cleanReply(raw, 5, 120), summarySaved: false });
		} catch (error) {
			new Notice(`Deskmate AI: ${errorText(error, "couldn't summarise")}`);
			button.disabled = false;
			button.setText("Summarise my day");
		}
	}

	private async saveToJournal(summary: string, button: HTMLButtonElement): Promise<void> {
		button.disabled = true;
		try {
			const note = await addSummaryToJournal(this.plugin.app, this.day, summary);
			await this.plugin.setDaily(this.day, { summarySaved: true });
			new Notice(`Summary added to ${note.basename}.`);
		} catch (error) {
			new Notice(errorText(error, "Couldn't save the summary to your journal."));
			button.disabled = false;
		}
	}

	private renderEntry(file: TFile, entry: LogEntry): void {
		const row = this.listEl.createDiv("dm-log-row");
		row.createSpan({ cls: "dm-log-time", text: entry.time });
		const text = row.createDiv({ cls: "dm-task-text dm-log-text", text: entry.text });
		text.setAttribute("role", "button");
		text.setAttribute("aria-label", `Edit "${entry.text}"`);
		text.tabIndex = 0;
		const edit = () => this.editEntryText(file, entry, text);
		text.addEventListener("click", edit);
		text.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				edit();
			}
		});

		const remove = row.createEl("button", { cls: "clickable-icon dm-task-delete" });
		setIcon(remove, "trash-2");
		remove.setAttribute("aria-label", "Delete entry");
		remove.addEventListener("click", (e) => {
			e.stopPropagation();
			remove.disabled = true;
			deleteEntry(this.plugin.app, file, entry)
				.then((removed) => {
					const message = createFragment((f) => {
						f.appendText(`Deleted "${entry.text}". `);
						const undo = f.createEl("a", { text: "Undo", href: "#" });
						undo.addEventListener("click", (ev) => {
							ev.preventDefault();
							notice.hide();
							restoreEntry(this.plugin.app, file, removed).catch((error: unknown) =>
								new Notice(errorText(error, "Couldn't restore that entry.")),
							);
						});
					});
					const notice = new Notice(message, 8000);
				})
				.catch((error: unknown) => {
					new Notice(errorText(error, "Couldn't delete that entry."));
					remove.disabled = false;
				});
		});
	}

	private editEntryText(file: TFile, entry: LogEntry, textEl: HTMLElement): void {
		const input = createEl("input", { type: "text", cls: "dm-task-input" });
		input.value = entry.text;
		input.setAttribute("aria-label", "Entry text");
		textEl.replaceWith(input);
		input.focus();
		input.select();
		let finished = false;
		const finish = (save: boolean) => {
			if (finished) return;
			finished = true;
			const value = input.value.trim();
			input.replaceWith(textEl);
			if (!save || !value || value === entry.text) return;
			textEl.setText(value);
			editEntry(this.plugin.app, file, entry, value).catch((error: unknown) => {
				new Notice(errorText(error, "Couldn't edit that entry."));
				textEl.setText(entry.text);
			});
		};
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && !e.isComposing) {
				e.preventDefault();
				finish(true);
			} else if (e.key === "Escape") {
				e.preventDefault();
				finish(false);
			}
		});
		input.addEventListener("blur", () => finish(true));
	}

	private renderAdd(card: HTMLElement): void {
		const form = card.createDiv("dm-add dm-log-add");
		const icon = form.createSpan("dm-add-icon");
		setIcon(icon, "pencil");
		const input = form.createEl("input", { type: "text", cls: "dm-add-input", placeholder: "What's happening?" });
		input.setAttribute("aria-label", "Add to today's log");
		input.addEventListener("keydown", (e) => {
			if (e.key !== "Enter" || e.isComposing || !input.value.trim()) return;
			e.preventDefault();
			const text = input.value;
			input.value = "";
			findOrCreateLog(this.plugin.app, this.note, this.sourcePath)
				.then((file) => addEntry(this.plugin.app, file, dayKey(), moment().format("HH:mm"), text))
				.then(() => this.render())
				.catch((error: unknown) => {
					input.value = text;
					new Notice(errorText(error, "Couldn't save that entry."));
				});
		});
	}
}
