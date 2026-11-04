import { Keymap, MarkdownRenderChild, TFile, debounce, setIcon } from "obsidian";
import type DeskmatePlugin from "../main";
import { moment } from "../lib/dates";
import { isExcluded } from "../lib/tasks";

/**
 * ```deskmate-recent
 * folder: Notes
 * limit: 6
 * show: subject, status
 * ```
 * The most recently edited notes, with chosen properties shown as small chips.
 */
export class RecentWidget extends MarkdownRenderChild {
	private listEl!: HTMLElement;

	constructor(containerEl: HTMLElement, private plugin: DeskmatePlugin, private options: Record<string, string>, private sourcePath: string) {
		super(containerEl);
	}

	onload(): void {
		const root = this.containerEl.createDiv({ cls: "dm-card dm-recent" });
		if (this.options.title !== "") root.createDiv({ cls: "dm-label", text: this.options.title ?? "Recently edited" });
		this.listEl = root.createDiv("dm-recent-list");

		const refresh = debounce(() => this.render(), 600, true);
		this.registerEvent(this.plugin.app.metadataCache.on("changed", refresh));
		this.registerEvent(this.plugin.app.vault.on("rename", refresh));
		this.registerEvent(this.plugin.app.vault.on("delete", refresh));
		// Keep "5 minutes ago" accurate.
		this.registerInterval(window.setInterval(() => this.render(), 60 * 1000));
		this.render();
	}

	private files(): TFile[] {
		const folder = this.options.folder?.replace(/^\/+|\/+$/g, "");
		const excluded = this.plugin.excludedFolders();
		const limit = Math.max(1, Math.min(30, Number(this.options.limit) || 6));
		return this.plugin.app.vault
			.getMarkdownFiles()
			.filter((f) => f.path !== this.sourcePath && !isExcluded(f.path, excluded))
			.filter((f) => !folder || f.path.startsWith(`${folder}/`))
			.sort((a, b) => b.stat.mtime - a.stat.mtime)
			.slice(0, limit);
	}

	private render(): void {
		const files = this.files();
		const show = (this.options.show ?? "subject, status")
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
		this.listEl.empty();
		if (!files.length) {
			this.listEl.createDiv({ cls: "dm-empty", text: "No notes edited yet." });
			return;
		}
		for (const file of files) this.renderRow(file, show);
	}

	private renderRow(file: TFile, show: string[]): void {
		const fm = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
		const row = this.listEl.createDiv({ cls: "dm-recent-row" });
		row.tabIndex = 0;
		row.setAttribute("role", "link");
		row.setAttribute("aria-label", `Open ${file.basename}`);

		const icon = row.createDiv("dm-recent-icon");
		if (typeof fm.icon === "string" && fm.icon) icon.setText(fm.icon);
		else setIcon(icon, "file-text");

		const body = row.createDiv("dm-recent-body");
		body.createDiv({ cls: "dm-recent-title", text: file.basename });
		const chips = body.createDiv("dm-recent-chips");
		for (const key of show) {
			for (const value of values(fm[key])) {
				const chip = chips.createSpan({ cls: `dm-chip dm-chip-${key.toLowerCase()}`, text: value });
				chip.dataset.value = value.toLowerCase();
			}
		}
		if (!chips.childElementCount) chips.remove();

		row.createDiv({ cls: "dm-recent-time", text: moment(file.stat.mtime).fromNow() });

		const open = (e: MouseEvent | KeyboardEvent) =>
			void this.plugin.app.workspace.openLinkText(file.path, this.sourcePath, Keymap.isModEvent(e));
		row.addEventListener("click", open);
		row.addEventListener("keydown", (e) => {
			if (e.key === "Enter") open(e);
		});
	}
}

/** Turns a property value (text, link, list or number) into short labels. */
function values(value: unknown): string[] {
	const list = Array.isArray(value) ? value : value === undefined || value === null || value === "" ? [] : [value];
	return list
		.filter((v): v is string | number | boolean => ["string", "number", "boolean"].includes(typeof v))
		.map((v) =>
			String(v)
				.replace(/^\[\[([^\]|]+)\|([^\]]+)\]\]$/, "$2")
				.replace(/^\[\[([^\]]+)\]\]$/, "$1")
				.replace(/^#/, "")
				.trim(),
		)
		.filter(Boolean);
}
