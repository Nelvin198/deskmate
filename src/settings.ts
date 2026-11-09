import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type DeskmatePlugin from "./main";
import { DEFAULT_MODEL, MODELS, ModelId, deleteModel, local } from "./ai/engine";

export interface DeskmateSettings {
	name: string;
	clock24h: boolean;
	showSeconds: boolean;
	threeD: boolean;
	threeDOnMobile: boolean;
	taskFile: string;
	excludedFolders: string;
	subjectsFolder: string;
	dayLogNote: string;
	aiEnabled: boolean;
	aiModel: ModelId;
}

export const DEFAULT_SETTINGS: DeskmateSettings = {
	name: "",
	clock24h: true,
	showSeconds: true,
	threeD: true,
	threeDOnMobile: false,
	taskFile: "To-do.md",
	excludedFolders: "Templates",
	subjectsFolder: "Subjects",
	dayLogNote: "Day Log",
	aiEnabled: false,
	aiModel: DEFAULT_MODEL,
};

// The declarative getSettingDefinitions() API is Obsidian 1.13.0+, but our minAppVersion is 1.9.0,
// so we keep the imperative display() to support 1.9–1.12. Revisit if the floor is raised to 1.13.
export class DeskmateSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: DeskmatePlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		const s = this.plugin.settings;
		containerEl.empty();

		const text = (name: string, desc: string, key: "name" | "taskFile" | "excludedFolders" | "subjectsFolder" | "dayLogNote", placeholder: string) =>
			new Setting(containerEl)
				.setName(name)
				.setDesc(desc)
				.addText((t) =>
					t.setPlaceholder(placeholder).setValue(s[key]).onChange(async (v) => {
						s[key] = v.trim();
						await this.plugin.saveSettings();
					}),
				);
		const toggle = (name: string, desc: string, key: "clock24h" | "showSeconds" | "threeD" | "threeDOnMobile") =>
			new Setting(containerEl)
				.setName(name)
				.setDesc(desc)
				.addToggle((t) =>
					t.setValue(s[key]).onChange(async (v) => {
						s[key] = v;
						await this.plugin.saveSettings();
					}),
				);

		new Setting(containerEl).setName("Header").setHeading();
		text("Your name", "Used in the greeting, like \"Good morning, Sam\". Leave empty for no name.", "name", "Sam");
		toggle("24-hour clock", "Off shows a 12-hour clock with AM and PM.", "clock24h");
		toggle("Show seconds", "Show seconds on the clock.", "showSeconds");
		toggle("3D background", "A slow, subtle 3D scene behind the header. It pauses when you scroll away.", "threeD");
		toggle("3D background on mobile", "Off by default to save battery.", "threeDOnMobile");

		new Setting(containerEl).setName("Tasks").setHeading();
		text("New tasks go to", "The note that the \"Add a task\" box writes to. It is created if it doesn't exist.", "taskFile", "To-do.md");
		text("Ignore folders", "Comma-separated folders whose tasks are not shown or counted.", "excludedFolders", "Templates, Archive");

		new Setting(containerEl).setName("Subjects").setHeading();
		text("Subjects folder", "Default folder for subject cards. A block can override it with \"folder:\" or \"tag:\".", "subjectsFolder", "Subjects");

		new Setting(containerEl).setName("Day log").setHeading();
		text("Day log note", "Where the day log saves entries. It is found by name, so you can move it. A block can override it with \"note:\".", "dayLogNote", "Day Log");

		this.displayAi(containerEl);
	}

	/** Local AI: a small model downloaded once into this device's cache, then run offline. */
	private displayAi(containerEl: HTMLElement): void {
		const s = this.plugin.settings;
		new Setting(containerEl).setName("AI on this device").setHeading();
		containerEl.createEl("p", {
			cls: "setting-item-description",
			text:
				"Writes the daily encouragement, the daily description and your day summary with a small AI model that runs on this computer. " +
				"The model is downloaded once from huggingface.co and github.com when you press Download, and kept in Obsidian's cache on this device (not in your vault). " +
				"After that it works offline, and your day log never leaves this device.",
		});

		const status = new Setting(containerEl).setName("Status").setDesc("Checking…");
		const refreshStatus = async () => {
			const state = await this.plugin.aiStatus();
			status.setDesc(
				{
					unsupported: "Not available here: this device has no WebGPU (phones and some older computers). Daily lines come from your laptop or the built-in list.",
					off: "Off.",
					"not-downloaded": "On, but the model isn't downloaded yet.",
					ready: "Ready. Runs offline on this device.",
				}[state],
			);
		};
		void refreshStatus();

		new Setting(containerEl)
			.setName("Use AI")
			.setDesc("Turn on to get fresh AI-written lines each day.")
			.addToggle((t) =>
				t.setValue(s.aiEnabled).onChange(async (v) => {
					s.aiEnabled = v;
					await this.plugin.saveSettings();
					this.plugin.aiChanged();
					void refreshStatus();
				}),
			);

		new Setting(containerEl)
			.setName("Model")
			.setDesc("Bigger models write better but download more and use more memory.")
			.addDropdown((d) => {
				for (const [id, label] of Object.entries(MODELS)) d.addOption(id, label);
				d.setValue(s.aiModel).onChange(async (v) => {
					s.aiModel = v as ModelId;
					await this.plugin.saveSettings();
					await local.unload();
					this.plugin.aiChanged();
					void refreshStatus();
				});
			});

		const download = new Setting(containerEl).setName("Download model").setDesc("One-time download of the selected model.");
		download.addButton((b) =>
			b.setButtonText("Download").setCta().onClick(async () => {
				b.setDisabled(true);
				try {
					await local.load(s.aiModel, (progress, text) => {
						download.setDesc(`${Math.round(progress * 100)}%: ${text}`);
					});
					await local.unload();
					download.setDesc("Downloaded.");
					new Notice("Deskmate AI is ready.");
				} catch (error) {
					download.setDesc(`Download failed: ${error instanceof Error ? error.message : String(error)}`);
				} finally {
					b.setDisabled(false);
					this.plugin.aiChanged();
					void refreshStatus();
				}
			}),
		);

		new Setting(containerEl)
			.setName("Delete model")
			.setDesc("Remove the downloaded model from this device to free space.")
			.addButton((b) =>
				b.setButtonText("Delete").setClass("mod-warning").onClick(async () => {
					b.setDisabled(true);
					try {
						await deleteModel(s.aiModel);
						new Notice("Deskmate AI model deleted from this device.");
					} catch (error) {
						new Notice(`Couldn't delete the model: ${error instanceof Error ? error.message : String(error)}`);
					} finally {
						b.setDisabled(false);
						this.plugin.aiChanged();
						void refreshStatus();
					}
				}),
			);
	}
}
