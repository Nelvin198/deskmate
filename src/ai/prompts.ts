import type { ChatCompletionMessageParam } from "@mlc-ai/web-llm";

const SYSTEM = "You write short, warm, simple English. You never use emojis, hashtags or quotation marks, and you never name a speaker.";

export function encouragementPrompt(): ChatCompletionMessageParam[] {
	return [
		{ role: "system", content: SYSTEM },
		{
			role: "user",
			content:
				"Write one short encouraging sentence for a student starting their day. At most 20 words. Reply with the sentence only.",
		},
	];
}

export function descriptionPrompt(thing: string): ChatCompletionMessageParam[] {
	return [
		{ role: "system", content: SYSTEM },
		{
			role: "user",
			content: `Describe ${thing} in one or two simple, vivid sentences, using everyday English and the present tense. At most 35 words. Reply with the description only.`,
		},
	];
}

export type DayPart = "morning" | "afternoon" | "evening";

/**
 * Groups "HH:mm text" lines into morning (before 12:00), afternoon (12:00–16:59) and evening (17:00 on).
 * Small models lose track of long lists, so each part is summarised on its own. Empty parts are left out.
 */
export function splitDay(lines: string[]): { part: DayPart; lines: string[] }[] {
	const parts: Record<DayPart, string[]> = { morning: [], afternoon: [], evening: [] };
	for (const line of lines) {
		const hour = Number(line.match(/^(\d{1,2}):\d{2}/)?.[1] ?? 12);
		parts[hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening"].push(line);
	}
	return (Object.keys(parts) as DayPart[]).filter((p) => parts[p].length).map((part) => ({ part, lines: parts[part] }));
}

/**
 * One part of the day summary. The parts are joined into one paragraph, so later parts open with a
 * transition and the last one ends on something that went well.
 */
export function partPrompt(part: DayPart, lines: string[], position: { first: boolean; last: boolean }, words: number): ChatCompletionMessageParam[] {
	const opening = position.first
		? "Open naturally, as the start of a diary paragraph."
		: `Open with a short transition into the ${part}, such as "Later," or "As evening settled in,". Do not greet me or restart the story.`;
	const ending = position.last ? "End on one thing that went well today." : "Do not wrap up the day yet; more of it comes after this.";
	return [
		{ role: "system", content: SYSTEM },
		{
			role: "user",
			content: [
				`Here is what I logged this ${part}, one item per line:`,
				...lines.map((l) => `- ${l}`),
				"",
				`Write 3 to 4 vivid, descriptive diary sentences about my ${part}, speaking to me as "you", in the order the items happened. At most ${words} words.`,
				"Use lively verbs and a little sensory detail (sights, sounds, how things felt) to bring each moment to life.",
				opening,
				ending,
				"Only describe what is in the list: do not invent new events, people or places. Use the exact words from the list for foods, drinks and objects — do not swap or rename them. Reply with the sentences only.",
			].join("\n"),
		},
	];
}

/** Keeps at most `max` words, ending at the last full sentence that fits (never mid-sentence). */
export function limitWords(text: string, max: number): string {
	const words = text.trim().split(/\s+/);
	if (words.length <= max) return text.trim();
	const cut = words.slice(0, max).join(" ");
	const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "), /[.!?]$/.test(cut) ? cut.length - 1 : -1);
	return end > 0 ? cut.slice(0, end + 1) : `${cut}…`;
}

/**
 * Small models like to add "Sure! Here's…", quotes, labels or emojis. This keeps just the text,
 * cut to the first `sentences` sentences and `maxWords` words.
 */
export function cleanReply(raw: string, sentences: number, maxWords: number): string {
	let text = raw
		.replace(/<think>[\s\S]*?<\/think>/gi, "")
		.replace(/^\s*(sure|okay|ok|certainly|of course|here(?:'s| is| are))\b[^:\n]*[:\n]/i, "")
		.replace(/^\s*(encouragement|description|summary|sentence)\s*:\s*/i, "")
		.replace(/[\p{Extended_Pictographic}️]/gu, "")
		.replace(/#\w+/g, "")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/^["“”'‘’*]+|["“”'‘’*]+$/g, "")
		.trim();

	const parts = text.match(/[^.!?]+[.!?]+(\s|$)/g);
	if (parts && parts.length > sentences) text = parts.slice(0, sentences).join("").trim();

	const words = text.split(" ");
	if (words.length > maxWords) text = `${words.slice(0, maxWords).join(" ").replace(/[,;:]$/, "")}…`;
	return text;
}
