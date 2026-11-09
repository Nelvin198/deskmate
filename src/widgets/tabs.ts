import { Component, MarkdownRenderChild, MarkdownRenderer, Notice, TFile, debounce, normalizePath, setIcon } from "obsidian";
import type DeskmatePlugin from "../main";

interface Tab {
	label: string;
	link: string;
}

/**
 * ```deskmate-tabs
 * Today: [[Home/Today]]
 * Trackers: [[Home/Trackers]]
 * ```
 * Each tab shows another note, rendered in place, so any block inside it keeps working.
 */
export class TabsWidget extends MarkdownRenderChild {
	private tabs: Tab[];
	private current = 0;
	private buttons: HTMLButtonElement[] = [];
	private panel!: HTMLElement;
	private content?: Component;
	private renderToken = 0;
	private unloaded = false;
	private rendered?: { path: string; body: string };

	constructor(containerEl: HTMLElement, private plugin: DeskmatePlugin, source: string, private sourcePath: string) {
		super(containerEl);
		this.tabs = source
			.split("\n")
			.map((line) => line.match(/^\s*([^:]+?)\s*:\s*(.+?)\s*$/))
			.filter((m): m is RegExpMatchArray => !!m)
			.map((m) => ({ label: m[1], link: m[2].replace(/^\[\[|\]\]$/g, "").split("|")[0].trim() }));
	}

	private get storageKey(): string {
		return `deskmate-tab:${this.sourcePath}`;
	}

	onload(): void {
		const root = this.containerEl.createDiv("dm-tabs");
		if (!this.tabs.length) {
			root.createDiv({ cls: "dm-empty", text: "Add tabs as lines like \"Today: [[Home/Today]]\"." });
			return;
		}

		const bar = root.createDiv("dm-tab-bar");
		const list = bar.createDiv("dm-tab-list");
		list.setAttribute("role", "tablist");
		this.tabs.forEach((tab, i) => {
			const button = list.createEl("button", { cls: "dm-tab", text: tab.label });
			button.setAttribute("role", "tab");
			button.addEventListener("click", () => void this.select(i));
			button.addEventListener("keydown", (e) => {
				const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
				if (!step) return;
				e.preventDefault();
				const next = (this.current + step + this.tabs.length) % this.tabs.length;
				void this.select(next);
				this.buttons[next].focus();
			});
			this.buttons.push(button);
		});

		const edit = bar.createEl("button", { cls: "clickable-icon dm-tab-edit" });
		setIcon(edit, "pencil");
		edit.setAttribute("aria-label", "Edit this tab");
		edit.addEventListener("click", () => {
			const file = this.fileFor(this.tabs[this.current]);
			if (file) void this.plugin.app.workspace.getLeaf(false).openFile(file);
		});

		this.panel = root.createDiv({ cls: "dm-tab-panel markdown-rendered" });
		this.panel.setAttribute("role", "tabpanel");

		const refresh = debounce(() => void this.select(this.current, true), 400, true);
		this.register(() => refresh.cancel());
		this.registerEvent(
			this.plugin.app.vault.on("modify", (file) => {
				if (file.path === this.fileFor(this.tabs[this.current])?.path) refresh();
			}),
		);
		this.registerEvent(this.plugin.app.vault.on("rename", refresh));

		const saved = Number(this.plugin.app.loadLocalStorage(this.storageKey));
		void this.select(Number.isInteger(saved) && saved >= 0 && saved < this.tabs.length ? saved : 0);
	}

	onunload(): void {
		this.unloaded = true;
		this.renderToken++;
		this.content?.unload();
	}

	private fileFor(tab: Tab): TFile | null {
		return this.plugin.app.metadataCache.getFirstLinkpathDest(tab.link, this.sourcePath);
	}

	private async select(index: number, force = false): Promise<void> {
		if (this.unloaded || (!force && index === this.current && this.rendered)) return;
		const token = ++this.renderToken;
		this.current = index;
		this.plugin.app.saveLocalStorage(this.storageKey, String(index));
		this.buttons.forEach((b, i) => {
			b.toggleClass("is-active", i === index);
			b.setAttribute("aria-selected", String(i === index));
			b.tabIndex = i === index ? 0 : -1;
		});

		const tab = this.tabs[index];
		const file = this.fileFor(tab);
		if (!file) {
			this.showContent(null);
			this.renderMissing(tab);
			return;
		}
		if (file.path === this.sourcePath) {
			this.showContent(null);
			this.panel.createDiv({ cls: "dm-empty", text: "A tab can't show the note it's in." });
			return;
		}

		let text: string;
		try {
			text = await this.plugin.app.vault.cachedRead(file);
		} catch (error) {
			if (token === this.renderToken) new Notice(error instanceof Error ? error.message : "Couldn't load that tab.");
			return;
		}
		if (this.unloaded || token !== this.renderToken) return;
		const cache = this.plugin.app.metadataCache.getFileCache(file);
		const body = text.slice(cache?.frontmatterPosition?.end.offset ?? 0);
		if (this.rendered?.path === file.path && this.rendered.body === body) return;
		if (/^```+\s*deskmate-tabs/m.test(body)) {
			this.showContent(null);
			this.panel.createDiv({ cls: "dm-empty", text: `"${file.basename}" has its own tabs block, which can't go inside another one.` });
			return;
		}

		const component = this.showContent(new Component());
		const target = createDiv();
		try {
			await MarkdownRenderer.render(this.plugin.app, body, target, file.path, component);
			if (this.unloaded || token !== this.renderToken) return;
			this.panel.replaceChildren(target);
			this.rendered = { path: file.path, body };
		} catch (error) {
			if (token === this.renderToken) new Notice(error instanceof Error ? error.message : "Couldn't render that tab.");
		} finally {
			if (this.unloaded || token !== this.renderToken || !this.rendered) component.unload();
		}
	}

	/** Unloads the previous tab's blocks (timers, events) and keeps the new one alive. */
	private showContent<T extends Component | null>(component: T): T {
		this.content?.unload();
		this.rendered = undefined;
		this.content = component ?? undefined;
		if (component) component.load();
		else this.panel.empty();
		return component;
	}

	private renderMissing(tab: Tab): void {
		const wrap = this.panel.createDiv("dm-empty");
		wrap.appendText(`"${tab.link}" doesn't exist yet. `);
		const create = wrap.createEl("a", { text: "Create it", href: "#" });
		create.addEventListener("click", (e) => {
			e.preventDefault();
			const path = normalizePath(`${tab.link}.md`);
			const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
			const make = async () => {
				if (folder && !this.plugin.app.vault.getAbstractFileByPath(folder)) await this.plugin.app.vault.createFolder(folder);
				const file = await this.plugin.app.vault.create(path, "");
				await this.plugin.app.workspace.getLeaf(false).openFile(file);
			};
			make().catch((error: unknown) => new Notice(error instanceof Error ? error.message : "Couldn't create that note."));
		});
	}
}
