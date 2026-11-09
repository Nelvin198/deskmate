import { Notice, Platform, Plugin, TFile, normalizePath } from "obsidian";
import { DEFAULT_SETTINGS, DeskmateSettingTab, DeskmateSettings } from "./settings";
import { TaskIndex } from "./lib/tasks";
import { parseOptions } from "./lib/options";
import { dayKey } from "./lib/dates";
import { HeaderWidget } from "./widgets/header";
import { TodayWidget } from "./widgets/today";
import { SubjectsWidget } from "./widgets/subjects";
import { RecentWidget } from "./widgets/recent";
import { DayLogWidget } from "./widgets/daylog";
import { TabsWidget } from "./widgets/tabs";
import { DailyItem, DailyWidget } from "./widgets/daily";
import { GenerateOptions, isDownloaded, isSupported, local } from "./ai/engine";
import type { ChatCompletionMessageParam } from "@mlc-ai/web-llm";

export type AiStatus = "off" | "unsupported" | "not-downloaded" | "ready";

interface DeskmateData {
	settings: DeskmateSettings;
	goals: Record<string, string>;
	daily: Record<string, DailyItem>;
}

const KEEP_GOALS_DAYS = 60;

const DASHBOARD = `---
cssclasses: deskmate
---

\`\`\`deskmate-header
subtitle: Notes, thoughts and things that matter.
\`\`\`

\`\`\`deskmate-today
\`\`\`

\`\`\`deskmate-daily
\`\`\`

\`\`\`deskmate-daylog
\`\`\`

\`\`\`deskmate-subjects
\`\`\`

\`\`\`deskmate-recent
\`\`\`
`;

export default class DeskmatePlugin extends Plugin {
	settings: DeskmateSettings = { ...DEFAULT_SETTINGS };
	private goals: Record<string, string> = {};
	private daily: Record<string, DailyItem> = {};
	private dailyListeners = new Set<() => void>();
	private supported?: Promise<boolean>;
	private downloaded?: Promise<boolean>;
	private taskExclusions = "";
	/** Daily lines being written right now, so two open cards don't both write them. */
	generating = new Set<string>();
	tasks!: TaskIndex;

	async onload(): Promise<void> {
		await this.loadAll();
		this.taskExclusions = this.settings.excludedFolders;
		this.tasks = new TaskIndex(this.app, () => this.excludedFolders());
		this.register(() => this.tasks.dispose());

		this.addSettingTab(new DeskmateSettingTab(this.app, this));

		this.registerMarkdownCodeBlockProcessor("deskmate-header", (source, el, ctx) => {
			ctx.addChild(new HeaderWidget(el, this, parseOptions(source)));
		});
		this.registerMarkdownCodeBlockProcessor("deskmate-today", (_source, el, ctx) => {
			ctx.addChild(new TodayWidget(el, this, ctx.sourcePath));
		});
		this.registerMarkdownCodeBlockProcessor("deskmate-subjects", (source, el, ctx) => {
			ctx.addChild(new SubjectsWidget(el, this, parseOptions(source), ctx.sourcePath));
		});
		this.registerMarkdownCodeBlockProcessor("deskmate-recent", (source, el, ctx) => {
			ctx.addChild(new RecentWidget(el, this, parseOptions(source), ctx.sourcePath));
		});
		this.registerMarkdownCodeBlockProcessor("deskmate-daylog", (source, el, ctx) => {
			ctx.addChild(new DayLogWidget(el, this, parseOptions(source), ctx.sourcePath));
		});
		this.registerMarkdownCodeBlockProcessor("deskmate-daily", (_source, el, ctx) => {
			ctx.addChild(new DailyWidget(el, this));
		});
		this.registerMarkdownCodeBlockProcessor("deskmate-tabs", (source, el, ctx) => {
			ctx.addChild(new TabsWidget(el, this, source, ctx.sourcePath));
		});

		this.addCommand({
			id: "create-dashboard",
			name: "Create dashboard note",
			callback: () => void this.createDashboard(),
		});

		const refresh = () => this.tasks.refresh();
		this.registerEvent(this.app.metadataCache.on("changed", (file, data) => this.tasks.update(file, data)));
		this.registerEvent(this.app.vault.on("delete", (file) => {
			if (file instanceof TFile && file.extension === "md") this.tasks.remove(file.path);
		}));
		this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
			if (file instanceof TFile) {
				if (oldPath.endsWith(".md")) this.tasks.remove(oldPath);
				this.tasks.update(file);
			} else refresh();
		}));
		this.registerEvent(this.app.vault.on("create", (file) => {
			if (file instanceof TFile) this.tasks.update(file);
		}));
		this.app.workspace.onLayoutReady(refresh);
	}

	onunload(): void {
		void local.unload();
	}

	// Daily lines (encouragement, description, summary), shared across devices through plugin data.

	getDaily(day: string): DailyItem {
		return this.daily[day] ?? {};
	}

	async setDaily(day: string, patch: Partial<DailyItem>): Promise<void> {
		this.daily[day] = { ...this.getDaily(day), ...patch };
		await this.saveAll();
		this.dailyChanged();
	}

	onDailyChange(listener: () => void): () => void {
		this.dailyListeners.add(listener);
		return () => this.dailyListeners.delete(listener);
	}

	dailyChanged(): void {
		for (const listener of this.dailyListeners) listener();
	}

	// Local AI. Desktop only: phones show the laptop's daily lines or the built-in ones.

	async aiStatus(): Promise<AiStatus> {
		if (Platform.isMobile) return "unsupported";
		if (!this.settings.aiEnabled) return "off";
		this.supported ??= isSupported();
		if (!(await this.supported)) return "unsupported";
		this.downloaded ??= isDownloaded(this.settings.aiModel);
		return (await this.downloaded) ? "ready" : "not-downloaded";
	}

	async aiReady(): Promise<boolean> {
		return (await this.aiStatus()) === "ready";
	}

	/** Call after downloading, deleting or switching the model, or turning AI on or off. */
	aiChanged(): void {
		this.downloaded = undefined;
		if (!this.settings.aiEnabled) void local.unload();
		this.dailyChanged();
	}

	aiGenerate(messages: ChatCompletionMessageParam[], options: GenerateOptions): Promise<string> {
		return local.generate(this.settings.aiModel, messages, options);
	}

	excludedFolders(): string[] {
		return this.settings.excludedFolders.split(",").map((f) => f.trim()).filter(Boolean);
	}

	getGoal(day: string): string {
		return this.goals[day] ?? "";
	}

	async setGoal(day: string, text: string): Promise<void> {
		if (text) this.goals[day] = text;
		else delete this.goals[day];
		await this.saveAll();
	}

	async saveSettings(): Promise<void> {
		await this.saveAll();
		if (this.taskExclusions !== this.settings.excludedFolders) {
			this.taskExclusions = this.settings.excludedFolders;
			this.tasks.refresh();
		}
	}

	private async loadAll(): Promise<void> {
		const data = ((await this.loadData()) ?? {}) as Partial<DeskmateData>;
		this.settings = { ...DEFAULT_SETTINGS, ...(data.settings ?? {}) };
		this.goals = data.goals ?? {};
		this.daily = data.daily ?? {};
	}

	private async saveAll(): Promise<void> {
		// Only keep recent goals so the data file stays small.
		const oldest = dayKey(new Date(Date.now() - KEEP_GOALS_DAYS * 864e5));
		for (const day of Object.keys(this.goals)) if (day < oldest) delete this.goals[day];
		for (const day of Object.keys(this.daily)) if (day < oldest) delete this.daily[day];
		await this.saveData({ settings: this.settings, goals: this.goals, daily: this.daily } satisfies DeskmateData);
	}

	private async createDashboard(): Promise<void> {
		let path = normalizePath("Dashboard.md");
		for (let i = 1; this.app.vault.getAbstractFileByPath(path); i++) path = normalizePath(`Dashboard ${i}.md`);
		try {
			const file = await this.app.vault.create(path, DASHBOARD);
			if (file instanceof TFile) await this.app.workspace.getLeaf(false).openFile(file);
		} catch (error) {
			new Notice(`Couldn't create the dashboard: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
}
