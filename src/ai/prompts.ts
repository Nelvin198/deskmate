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

export function summaryPrompt(lines: string[]): ChatCompletionMessageParam[] {
	return [
		{ role: "system", content: SYSTEM },
		{
			role: "user",
			content: [
				"Here is what I logged today, one item per line:",
				...lines.map((l) => `- ${l}`),
				"",
				"Write a vivid, descriptive summary of my day as one short diary paragraph of 4 or 5 sentences, speaking to me as \"you\".",
				"Follow the day in order from morning to night. Use lively verbs and a little sensory detail (sights, sounds, how things felt) to bring each moment to life, and end on one thing that went well.",
				"Only describe what is in the list: do not invent new events, people or places. Reply with the paragraph only.",
			].join("\n"),
		},
	];
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
