import type { ChatCompletionMessageParam, InitProgressReport, MLCEngine } from "@mlc-ai/web-llm";

/**
 * A small language model running on this device's graphics chip (WebGPU) via WebLLM.
 * The model is downloaded once, only when the user asks, into Obsidian's own browser cache
 * (not the vault), so it never syncs. After that everything runs offline.
 */

export const MODELS = {
	"Llama-3.2-1B-Instruct-q4f16_1-MLC": "Llama 3.2 1B: balanced (about 0.9 GB)",
	"SmolLM2-360M-Instruct-q4f16_1-MLC": "SmolLM2 360M: lightest (about 0.4 GB)",
	"Qwen3-1.7B-q4f16_1-MLC": "Qwen3 1.7B: best writing (about 2 GB)",
} as const;

export type ModelId = keyof typeof MODELS;
export const DEFAULT_MODEL: ModelId = "Llama-3.2-1B-Instruct-q4f16_1-MLC";

const IDLE_UNLOAD_MS = 2 * 60 * 1000;

// Loaded only the first time AI is used, so Obsidian starts as fast as before.
const webllm = () => import("@mlc-ai/web-llm");

interface NavigatorWithGpu {
	gpu?: { requestAdapter(): Promise<unknown> };
}

export async function isSupported(): Promise<boolean> {
	const gpu = (navigator as NavigatorWithGpu).gpu;
	if (!gpu) return false;
	try {
		return !!(await gpu.requestAdapter());
	} catch {
		return false;
	}
}

export async function isDownloaded(model: ModelId): Promise<boolean> {
	try {
		return await (await webllm()).hasModelInCache(model);
	} catch {
		return false;
	}
}

export async function deleteModel(model: ModelId): Promise<void> {
	await local.unload();
	await (await webllm()).deleteModelAllInfoInCache(model);
}

export interface GenerateOptions {
	temperature: number;
	maxTokens: number;
}

class LocalModel {
	private engine?: MLCEngine;
	private model?: ModelId;
	private loading?: Promise<MLCEngine>;
	private idleTimer = 0;

	/** Loads (and on first use downloads) the model. Progress goes from 0 to 1. */
	async load(model: ModelId, onProgress?: (progress: number, text: string) => void): Promise<MLCEngine> {
		if (this.engine && this.model === model) return this.engine;
		if (this.loading && this.model === model) return this.loading;
		await this.unload();
		this.model = model;
		this.loading = (async () => {
			const { CreateMLCEngine } = await webllm();
			const engine = await CreateMLCEngine(model, {
				initProgressCallback: (report: InitProgressReport) => onProgress?.(report.progress, report.text),
				logLevel: "WARN",
			});
			this.engine = engine;
			return engine;
		})();
		try {
			return await this.loading;
		} finally {
			this.loading = undefined;
		}
	}

	async generate(model: ModelId, messages: ChatCompletionMessageParam[], options: GenerateOptions): Promise<string> {
		window.clearTimeout(this.idleTimer);
		const engine = await this.load(model);
		try {
			const reply = await engine.chat.completions.create({
				messages,
				temperature: options.temperature,
				max_tokens: options.maxTokens,
				// Qwen3 "thinks" out loud by default; we only want the answer.
				...(model.startsWith("Qwen3") ? { extra_body: { enable_thinking: false } } : {}),
			});
			return reply.choices[0]?.message?.content ?? "";
		} finally {
			// Free the graphics memory when AI hasn't been used for a while.
			this.idleTimer = window.setTimeout(() => void this.unload(), IDLE_UNLOAD_MS);
		}
	}

	async unload(): Promise<void> {
		window.clearTimeout(this.idleTimer);
		const engine = this.engine;
		this.engine = undefined;
		if (engine) await engine.unload();
	}
}

export const local = new LocalModel();
