import { MarkdownRenderChild, Notice, setIcon } from "obsidian";
import type DeskmatePlugin from "../main";
import { dayKey, dueLabel } from "../lib/dates";
import {
	Task,
	addTask,
	completeTask,
	deleteTask,
	editTask,
	isDone,
	isOpen,
	reopenTask,
	restoreTask,
	taskDescription,
} from "../lib/tasks";

const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

/**
 * ```deskmate-today
 * ```
 * Today's goal (one line, saved per day) and tasks due today or overdue.
 */
export class TodayWidget extends MarkdownRenderChild {
	private day = dayKey();
	private goalEl!: HTMLElement;
	private listEl!: HTMLElement;
	private countEl!: HTMLElement;

	constructor(containerEl: HTMLElement, private plugin: DeskmatePlugin, private sourcePath: string) {
		super(containerEl);
	}

	onload(): void {
		const root = this.containerEl.createDiv({ cls: "dm-today" });

		const goalCard = root.createDiv({ cls: "dm-card dm-goal" });
		goalCard.createDiv({ cls: "dm-label", text: "Today's goal" });
		this.goalEl = goalCard.createDiv("dm-goal-body");
		this.renderGoal();

		const tasksCard = root.createDiv({ cls: "dm-card dm-tasks" });
		const head = tasksCard.createDiv("dm-card-head");
		head.createDiv({ cls: "dm-label", text: "To do today" });
		this.countEl = head.createDiv("dm-count");
		this.listEl = tasksCard.createDiv("dm-task-list");
		this.renderAdd(tasksCard);

		this.register(this.plugin.tasks.subscribe(() => this.renderTasks()));
		this.renderTasks();

		// Roll over to a new day at midnight without reopening the note.
		this.registerInterval(
			window.setInterval(() => {
				if (dayKey() === this.day) return;
				this.day = dayKey();
				this.renderGoal();
				this.renderTasks();
			}, 30 * 1000),
		);
	}

	private renderGoal(): void {
		const el = this.goalEl;
		el.empty();
		const goal = this.plugin.getGoal(this.day);
		const text = el.createDiv({
			cls: goal ? "dm-goal-text" : "dm-goal-text dm-placeholder",
			text: goal || "What's the one thing that matters today?",
		});
		text.setAttribute("role", "button");
		text.tabIndex = 0;
		text.setAttribute("aria-label", "Edit today's goal");
		const edit = () => this.editGoal(goal);
		text.addEventListener("click", edit);
		text.addEventListener("keydown", (e) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				edit();
			}
		});
	}

	private editGoal(current: string): void {
		const el = this.goalEl;
		el.empty();
		const input = el.createEl("textarea", { cls: "dm-goal-input" });
		input.value = current;
		input.rows = 2;
		input.placeholder = "One thing that would make today a good day";
		input.focus();
		let done = false;
		const finish = async (save: boolean) => {
			if (done) return;
			done = true;
			if (save) await this.plugin.setGoal(this.day, input.value.trim());
			this.renderGoal();
		};
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				void finish(true);
			} else if (e.key === "Escape") {
				e.preventDefault();
				void finish(false);
			}
		});
		input.addEventListener("blur", () => void finish(true));
	}

	private renderTasks(): void {
		const today = this.day;
		const all = this.plugin.tasks.tasks;
		const due = all
			.filter((t) => isOpen(t) && t.due !== undefined && t.due <= today)
			.sort((a, b) => (a.due ?? "").localeCompare(b.due ?? "") || a.text.localeCompare(b.text));
		const doneToday = all.filter((t) => isDone(t) && t.doneDate === today);

		this.countEl.setText(due.length || doneToday.length ? `${doneToday.length} of ${due.length + doneToday.length} done` : "");
		this.listEl.empty();
		if (!due.length && !doneToday.length) {
			this.listEl.createDiv({ cls: "dm-empty", text: "Nothing due today. Add a task below, or enjoy the free time." });
			return;
		}
		for (const task of due) this.renderTask(task, false);
		for (const task of doneToday) this.renderTask(task, true);
	}

	private renderTask(task: Task, done: boolean): void {
		const row = this.listEl.createDiv({ cls: done ? "dm-task is-done" : "dm-task" });
		const box = row.createEl("input", { type: "checkbox", cls: "task-list-item-checkbox dm-check" });
		box.checked = done;
		box.setAttribute("aria-label", done ? `Mark "${task.text}" as not done` : `Mark "${task.text}" as done`);
		box.addEventListener("click", (e) => {
			e.stopPropagation();
			box.disabled = true;
			const change = done ? reopenTask(this.plugin.app, task) : completeTask(this.plugin.app, task, this.day);
			change
				.then(() => row.toggleClass("is-done", !done))
				.catch((error: unknown) => {
					new Notice(error instanceof Error ? error.message : "Couldn't update that task.");
					box.checked = done;
					box.disabled = false;
				});
		});

		const body = row.createDiv("dm-task-body");
		const text = body.createDiv({ cls: "dm-task-text", text: task.text || "(empty task)" });
		text.setAttribute("role", "button");
		text.setAttribute("aria-label", `Edit "${task.text}"`);
		text.tabIndex = 0;
		text.addEventListener("click", () => this.editTaskText(task, text));
		text.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				this.editTaskText(task, text);
			}
		});

		const remove = row.createEl("button", { cls: "clickable-icon dm-task-delete" });
		setIcon(remove, "trash-2");
		remove.setAttribute("aria-label", "Delete task");
		remove.addEventListener("click", (e) => {
			e.stopPropagation();
			remove.disabled = true;
			deleteTask(this.plugin.app, task)
				.then((removed) => this.offerUndo(task, removed))
				.catch((error: unknown) => {
					new Notice(errorText(error, "Couldn't delete that task."));
					remove.disabled = false;
				});
		});

		const meta = body.createDiv("dm-task-meta");
		if (!done && task.due) {
			const label = dueLabel(task.due, this.day);
			meta.createSpan({ cls: task.due < this.day ? "dm-due is-overdue" : "dm-due", text: label });
		}
		const link = meta.createEl("a", { cls: "dm-task-file", text: task.file.basename, href: "#" });
		link.addEventListener("click", (e) => {
			e.preventDefault();
			void this.plugin.app.workspace.openLinkText(task.file.path, this.sourcePath, false, { eState: { line: task.line } });
		});
	}

	/** Swaps the task's text for an input. Enter or clicking away saves; Escape cancels. */
	private editTaskText(task: Task, textEl: HTMLElement): void {
		const original = taskDescription(task);
		const input = createEl("input", { type: "text", cls: "dm-task-input" });
		input.value = original;
		input.setAttribute("aria-label", "Task text");
		textEl.replaceWith(input);
		input.focus();
		input.select();

		let finished = false;
		const finish = (save: boolean) => {
			if (finished) return;
			finished = true;
			const value = input.value.trim();
			if (!save || !value || value === original) {
				input.replaceWith(textEl);
				return;
			}
			textEl.setText(value);
			input.replaceWith(textEl);
			editTask(this.plugin.app, task, value).catch((error: unknown) => {
				new Notice(errorText(error, "Couldn't edit that task."));
				textEl.setText(task.text);
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

	private offerUndo(task: Task, removed: { index: number; line: string }): void {
		const message = createFragment((f) => {
			f.appendText(`Deleted "${task.text}". `);
			const undo = f.createEl("a", { text: "Undo", href: "#" });
			undo.addEventListener("click", (e) => {
				e.preventDefault();
				notice.hide();
				restoreTask(this.plugin.app, task.file, removed).catch((error: unknown) => {
					new Notice(errorText(error, "Couldn't restore that task."));
				});
			});
		});
		const notice = new Notice(message, 8000);
	}

	private renderAdd(card: HTMLElement): void {
		const form = card.createDiv("dm-add");
		const icon = form.createSpan("dm-add-icon");
		setIcon(icon, "plus");
		const input = form.createEl("input", { type: "text", cls: "dm-add-input", placeholder: "Add a task for today" });
		input.setAttribute("aria-label", "Add a task for today");
		input.addEventListener("keydown", (e) => {
			if (e.key !== "Enter" || e.isComposing || !input.value.trim()) return;
			e.preventDefault();
			const text = input.value;
			input.value = "";
			addTask(this.plugin.app, this.plugin.settings.taskFile || "To-do.md", text, this.day).catch((error: unknown) => {
				input.value = text;
				new Notice(error instanceof Error ? error.message : "Couldn't add that task.");
			});
		});
	}
}
