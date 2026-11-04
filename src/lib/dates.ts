import { moment as obsidianMoment } from "obsidian";
import type { Moment, MomentInput } from "moment";

// Obsidian ships moment; its type is declared as a namespace, which newer TypeScript won't call.
export const moment = obsidianMoment as unknown as (input?: MomentInput) => Moment;

/** Local date as YYYY-MM-DD. */
export function dayKey(date: Date = new Date()): string {
	return moment(date).format("YYYY-MM-DD");
}

export function greeting(hour: number = new Date().getHours()): string {
	if (hour < 5) return "Good night";
	if (hour < 12) return "Good morning";
	if (hour < 18) return "Good afternoon";
	if (hour < 22) return "Good evening";
	return "Good night";
}

/** "Today", "Yesterday", "2 days overdue" or a short date. */
export function dueLabel(due: string, today: string): string {
	const days = moment(today).diff(moment(due), "days");
	if (days === 0) return "Today";
	if (days === 1) return "Yesterday";
	if (days > 1) return `${days} days overdue`;
	return moment(due).format("D MMM");
}
