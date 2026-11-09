import type { ChatCompletionMessageParam } from "@mlc-ai/web-llm";
import type { GenerateOptions, ModelId } from "./engine";

export type AiCommand =
	| { kind: "load" | "cached" | "delete"; model: ModelId }
	| { kind: "generate"; model: ModelId; messages: ChatCompletionMessageParam[]; options: GenerateOptions };

export type AiRequest = AiCommand & { id: number };
export type AiResponse =
	| { id: number; kind: "progress"; progress: number; text: string }
	| { id: number; kind: "result"; value: unknown }
	| { id: number; kind: "error"; error: string };
