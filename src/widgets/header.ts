import { MarkdownRenderChild, Platform } from "obsidian";
import type DeskmatePlugin from "../main";
import { dayKey, greeting, moment } from "../lib/dates";
import { isDone, isOpen } from "../lib/tasks";
import { isOff, isOn } from "../lib/options";
import { AmbientScene } from "../three/ambient";

/**
 * ```deskmate-header
 * title: My vault
 * subtitle: Notes, thoughts and things that matter.
 * name: Sam
 * 3d: off
 * ```
 */
export class HeaderWidget extends MarkdownRenderChild {
	private greetingEl!: HTMLElement;
	private timeEl!: HTMLElement;
	private secondsEl!: HTMLElement;
	private dateEl!: HTMLElement;
	private stats: Record<"notes" | "open" | "done", HTMLElement> = {} as never;
	private ambient?: AmbientScene;

	constructor(containerEl: HTMLElement, private plugin: DeskmatePlugin, private options: Record<string, string>) {
		super(containerEl);
	}

	onload(): void {
		const root = this.containerEl.createDiv({ cls: "dm-card dm-header" });
		const body = root.createDiv("dm-header-body");

		const left = body.createDiv("dm-header-left");
		left.createDiv({ cls: "dm-eyebrow", text: this.options.title || this.plugin.app.vault.getName() });
		this.greetingEl = left.createEl("h2", { cls: "dm-greeting" });
		if (this.options.subtitle) left.createDiv({ cls: "dm-subtitle", text: this.options.subtitle });

		const statsEl = left.createDiv("dm-stats");
		for (const [key, label] of [["notes", "notes"], ["open", "open tasks"], ["done", "done today"]] as const) {
			const chip = statsEl.createDiv("dm-stat");
			this.stats[key] = chip.createSpan({ cls: "dm-stat-num", text: "–" });
			chip.createSpan({ cls: "dm-stat-label", text: label });
		}

		const right = body.createDiv("dm-header-right");
		const clock = right.createDiv("dm-clock");
		this.timeEl = clock.createSpan("dm-time");
		this.secondsEl = clock.createSpan("dm-seconds");
		this.dateEl = right.createDiv("dm-date");

		if (this.wants3D()) {
			try {
				this.ambient = new AmbientScene(root);
				this.registerEvent(this.plugin.app.workspace.on("css-change", () => this.ambient?.recolor()));
			} catch (error) {
				// No WebGL (old GPU or disabled): the header simply has no 3D background.
				console.warn("Deskmate: 3D background unavailable", error);
			}
		}

		this.tick();
		this.registerInterval(window.setInterval(() => this.tick(), 1000));
		this.register(this.plugin.tasks.subscribe(() => this.renderStats()));
		this.renderStats();
	}

	onunload(): void {
		this.ambient?.dispose();
	}

	private wants3D(): boolean {
		const option = this.options["3d"];
		if (isOff(option)) return false;
		if (isOn(option)) return true;
		const s = this.plugin.settings;
		return Platform.isMobile ? s.threeD && s.threeDOnMobile : s.threeD;
	}

	private tick(): void {
		const now = moment();
		const s = this.plugin.settings;
		const name = this.options.name ?? s.name;
		this.greetingEl.setText(name ? `${greeting(now.hour())}, ${name}.` : `${greeting(now.hour())}.`);
		this.timeEl.setText(now.format(s.clock24h ? "HH:mm" : "h:mm"));
		const seconds = s.showSeconds ? now.format(":ss") : "";
		this.secondsEl.setText(s.clock24h ? seconds : `${seconds} ${now.format("A")}`);
		this.dateEl.setText(now.format("dddd, D MMMM YYYY"));
	}

	private renderStats(): void {
		const { tasks, noteCount } = this.plugin.tasks;
		const today = dayKey();
		this.stats.notes.setText(String(noteCount));
		this.stats.open.setText(String(tasks.filter(isOpen).length));
		this.stats.done.setText(String(tasks.filter((t) => isDone(t) && t.doneDate === today).length));
	}
}
