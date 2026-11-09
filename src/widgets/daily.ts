import { MarkdownRenderChild, Notice, debounce, setIcon } from "obsidian";
import type DeskmatePlugin from "../main";
import { dayKey, moment } from "../lib/dates";
import { ENCOURAGEMENTS } from "../ai/encouragements";
import { TOPICS } from "../ai/topics";
import { cleanReply, descriptionPrompt, encouragementPrompt } from "../ai/prompts";

export interface DailyItem {
	encouragement?: string;
	description?: string;
	summary?: string;
	summarySaved?: boolean;
}

const dayIndex = (day: string) => moment(day).dayOfYear() - 1;
export const topicFor = (day: string) => TOPICS[dayIndex(day) % TOPICS.length];
export const fallbackEncouragement = (day: string) => ENCOURAGEMENTS[dayIndex(day) % ENCOURAGEMENTS.length];

/**
 * ```deskmate-daily
 * ```
 * An encouraging sentence and an everyday thing described simply. (The day summary lives in the day log card.)
 * Fresh text comes from the local AI (laptop); otherwise built-in lines are shown.
 */
export class DailyWidget extends MarkdownRenderChild {
	private day = dayKey();
	private root!: HTMLElement;
	private busy = new Set<string>();
	private attempted = new Set<string>();
	private renderToken = 0;
	private unloaded = false;

	constructor(containerEl: HTMLElement, private plugin: DeskmatePlugin) {
		super(containerEl);
	}

	onload(): void {
		this.root = this.containerEl.createDiv({ cls: "dm-card dm-daily" });
		const refresh = debounce(() => void this.render(), 200, true);
		this.register(() => refresh.cancel());
		this.register(this.plugin.onDailyChange(refresh));
		this.registerInterval(
			window.setInterval(() => {
				if (dayKey() === this.day) return;
				this.day = dayKey();
				void this.render();
			}, 30 * 1000),
		);
		void this.render();
	}

	onunload(): void {
		this.unloaded = true;
		this.renderToken++;
	}

	private async render(): Promise<void> {
		if (this.unloaded) return;
		const token = ++this.renderToken;
		const day = this.day;
		const ai = await this.plugin.aiReady();
		if (this.unloaded || token !== this.renderToken || day !== this.day) return;
		const item = this.plugin.getDaily(day);
		this.root.empty();

		const top = this.root.createDiv("dm-daily-top");
		this.section(
			top,
			"Today's encouragement",
			undefined,
			item.encouragement ?? fallbackEncouragement(day),
			ai ? () => void this.generate("encouragement") : undefined,
			"dm-daily-encourage",
		);
		this.section(
			top,
			"",
			capitalise(topicFor(day)),
			item.description ?? (ai && (!this.attempted.has(`${day}:description`) || this.plugin.generating.has(`${day}:description`))
				? "Writing…" : "Picture it for a moment: what does it look, sound and feel like?"),
			ai ? () => void this.generate("description") : undefined,
			"dm-daily-describe",
		);

		// First view of the day on the laptop: write today's lines once.
		if (ai && !item.encouragement && !this.attempted.has(`${day}:encouragement`)) void this.generate("encouragement");
		if (ai && !item.description && !this.attempted.has(`${day}:description`)) void this.generate("description");
	}

	private section(
		parent: HTMLElement,
		label: string,
		title: string | undefined,
		text: string,
		regenerate: (() => void) | undefined,
		cls: string,
	): void {
		const wrap = parent.createDiv(`dm-daily-section ${cls}`);
		const head = wrap.createDiv("dm-card-head");
		// With no label, the title (e.g. "A cold drink on a hot day") is the heading.
		if (label) head.createDiv({ cls: "dm-label", text: label });
		else if (title) head.createDiv({ cls: "dm-daily-title", text: title });
		if (regenerate) {
			const button = head.createEl("button", { cls: "clickable-icon dm-daily-refresh" });
			setIcon(button, "refresh-cw");
			button.setAttribute("aria-label", "Write a new one");
			button.addEventListener("click", regenerate);
		}
		if (label && title) wrap.createDiv({ cls: "dm-daily-title", text: title });
		wrap.createDiv({ cls: "dm-daily-text", text });
	}

	private async generate(kind: "encouragement" | "description"): Promise<void> {
		const day = this.day;
		const key = `${day}:${kind}`;
		if (this.busy.has(key) || this.plugin.generating.has(key)) return;
		this.attempted.add(key);
		this.busy.add(key);
		this.plugin.generating.add(key);
		this.root.querySelector(kind === "encouragement" ? ".dm-daily-encourage .dm-daily-text" : ".dm-daily-describe .dm-daily-text")?.setText("Writing…");
		try {
			const raw =
				kind === "encouragement"
					? await this.plugin.aiGenerate(encouragementPrompt(), { temperature: 0.9, maxTokens: 60 })
					: await this.plugin.aiGenerate(descriptionPrompt(topicFor(day)), { temperature: 0.8, maxTokens: 90 });
			const text = kind === "encouragement" ? cleanReply(raw, 1, 24) : cleanReply(raw, 2, 40);
			if (text) await this.plugin.setDaily(day, { [kind]: text });
			else void this.render();
		} catch (error) {
			new Notice(`Deskmate AI: ${error instanceof Error ? error.message : "couldn't write that"}`);
			void this.render();
		} finally {
			this.busy.delete(key);
			this.plugin.generating.delete(key);
		}
	}
}

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
