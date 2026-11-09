import { Keymap, MarkdownRenderChild, TFile, debounce, getAllTags } from "obsidian";
import type DeskmatePlugin from "../main";

/**
 * ```deskmate-subjects
 * folder: Subjects
 * ```
 * or `tag: #subject`. Each note becomes a card. Optional properties on the note:
 *   cover: [[image.png]]   icon: 🦉   description: Short line under the title
 */
export class SubjectsWidget extends MarkdownRenderChild {
	private gridEl!: HTMLElement;
	private renderToken = 0;
	private signature?: string;
	private unloaded = false;

	constructor(containerEl: HTMLElement, private plugin: DeskmatePlugin, private options: Record<string, string>, private sourcePath: string) {
		super(containerEl);
	}

	onload(): void {
		const root = this.containerEl.createDiv({ cls: "dm-subjects" });
		if (this.options.title !== "") root.createDiv({ cls: "dm-label dm-section-label", text: this.options.title ?? "Subjects" });
		this.gridEl = root.createDiv("dm-subject-grid");
		const refresh = debounce(() => void this.render(), 500, true);
		this.register(() => refresh.cancel());
		this.registerEvent(this.plugin.app.metadataCache.on("resolved", refresh));
		this.registerEvent(this.plugin.app.vault.on("rename", refresh));
		void this.render();
	}

	onunload(): void {
		this.unloaded = true;
		this.renderToken++;
	}

	private files(): TFile[] {
		const { app, settings } = this.plugin;
		const tag = this.options.tag?.replace(/^#/, "").toLowerCase();
		const files = app.vault.getMarkdownFiles().filter((file) => {
			if (file.path === this.sourcePath) return false;
			if (tag) {
				const cache = app.metadataCache.getFileCache(file);
				const tags = cache ? getAllTags(cache) ?? [] : [];
				return tags.some((t) => t.replace(/^#/, "").toLowerCase() === tag);
			}
			const folder = (this.options.folder ?? settings.subjectsFolder ?? "Subjects").replace(/^\/+|\/+$/g, "");
			return file.parent?.path === folder;
		});
		return files.sort((a, b) => a.basename.localeCompare(b.basename));
	}

	private async render(): Promise<void> {
		if (this.unloaded) return;
		const token = ++this.renderToken;
		const files = this.files();
		// Count backlinks once, rather than walking the whole link graph for every card.
		const links = new Map(files.map((file) => [file.path, 0]));
		for (const targets of Object.values(this.plugin.app.metadataCache.resolvedLinks)) {
			for (const path of Object.keys(targets)) {
				if (targets[path] && links.has(path)) links.set(path, links.get(path)! + 1);
			}
		}
		const cards = await Promise.all(files.map((f) => this.cardData(f, links.get(f.path) ?? 0)));
		if (this.unloaded || token !== this.renderToken) return;
		const signature = JSON.stringify(cards.map((card) => [card.file.path, card.description, card.icon, card.cover, card.links]));
		if (signature === this.signature) return;
		this.signature = signature;
		const grid = this.gridEl;
		grid.empty();
		if (!cards.length) {
			const where = this.options.tag ? `tagged ${this.options.tag}` : `in the "${this.options.folder ?? this.plugin.settings.subjectsFolder}" folder`;
			grid.createDiv({ cls: "dm-empty", text: `No subject notes ${where} yet.` });
			return;
		}
		for (const card of cards) this.renderCard(card);
	}

	private async cardData(file: TFile, links: number) {
		const { app } = this.plugin;
		const cache = app.metadataCache.getFileCache(file);
		const fm = cache?.frontmatter ?? {};
		let description = typeof fm.description === "string" ? fm.description : "";
		if (!description) {
			const text = await app.vault.cachedRead(file);
			description = firstParagraph(text.slice(cache?.frontmatterPosition?.end.offset ?? 0));
		}
		return {
			file,
			description,
			icon: typeof fm.icon === "string" ? fm.icon : "",
			cover: this.coverUrl(fm.cover, file),
			links,
		};
	}

	/** Only local vault images, so Deskmate never goes online. */
	private coverUrl(value: unknown, file: TFile): string | undefined {
		if (typeof value !== "string" || !value.trim() || /^[a-z]+:\/\//i.test(value.trim())) return undefined;
		const link = value.trim().replace(/^!?\[\[|\]\]$/g, "").split("|")[0].trim();
		const target = this.plugin.app.metadataCache.getFirstLinkpathDest(link, file.path);
		return target ? this.plugin.app.vault.getResourcePath(target) : undefined;
	}

	private renderCard(data: Awaited<ReturnType<SubjectsWidget["cardData"]>>): void {
		const card = this.gridEl.createDiv({ cls: "dm-card dm-subject" });
		card.tabIndex = 0;
		card.setAttribute("role", "link");
		card.setAttribute("aria-label", `Open ${data.file.basename}`);

		const cover = card.createDiv("dm-cover");
		if (data.cover) {
			cover.addClass("has-image");
			cover.style.setProperty("background-image", `url("${data.cover.replace(/"/g, "%22")}")`);
		} else {
			cover.style.setProperty("--dm-hue", String(hue(data.file.basename)));
		}
		if (data.icon) cover.createDiv({ cls: "dm-icon", text: data.icon });

		const body = card.createDiv("dm-subject-body");
		body.createDiv({ cls: "dm-subject-title", text: data.file.basename });
		if (data.description) body.createDiv({ cls: "dm-subject-desc", text: data.description });
		body.createDiv({ cls: "dm-subject-meta", text: data.links === 1 ? "1 linked note" : `${data.links} linked notes` });

		const open = (e: MouseEvent | KeyboardEvent) =>
			void this.plugin.app.workspace.openLinkText(data.file.path, this.sourcePath, Keymap.isModEvent(e));
		card.addEventListener("click", open);
		card.addEventListener("keydown", (e) => {
			if (e.key === "Enter") open(e);
		});
	}
}

function hue(name: string): number {
	let h = 0;
	for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
	return h;
}

function firstParagraph(markdown: string): string {
	for (const block of markdown.split(/\n\s*\n/)) {
		const text = block.trim();
		if (!text || /^(#|>|```|---|\||!\[|- |\* |\d+\. |%%)/.test(text)) continue;
		const plain = text
			.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
			.replace(/\[\[([^\]]+)\]\]/g, "$1")
			.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
			.replace(/(\*\*|__|==|~~|\*|_|`)/g, "")
			.replace(/\s+/g, " ")
			.trim();
		return plain.length > 140 ? `${plain.slice(0, 137).trimEnd()}…` : plain;
	}
	return "";
}
