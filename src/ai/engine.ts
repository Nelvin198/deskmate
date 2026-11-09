import type { ChatCompletionMessageParam } from "@mlc-ai/web-llm";
import type { AiCommand, AiResponse } from "./protocol";
import workerSource from "deskmate:ai-worker";

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
		return await local.cached(model);
	} catch {
		return false;
	}
}

export async function deleteModel(model: ModelId): Promise<void> {
	await local.unload();
	await local.delete(model);
}

export interface GenerateOptions {
	temperature: number;
	maxTokens: number;
}

class LocalModel {
	private worker?: Worker;
	private model?: ModelId;
	private idleTimer = 0;
	private queue: Promise<unknown> = Promise.resolve();
	private pending = 0;
	private generation = 0;
	private nextId = 0;
	private requests = new Map<number, {
		resolve: (value: unknown) => void;
		reject: (error: Error) => void;
		onProgress?: (progress: number, text: string) => void;
	}>();

	/** Loads (and on first use downloads) the model. Progress goes from 0 to 1. */
	load(model: ModelId, onProgress?: (progress: number, text: string) => void): Promise<void> {
		return this.enqueue(() => this.loadModel(model, onProgress));
	}

	cached(model: ModelId): Promise<boolean> {
		return this.enqueue(() => this.request<boolean>({ kind: "cached", model }));
	}

	delete(model: ModelId): Promise<void> {
		return this.enqueue(() => this.request<void>({ kind: "delete", model }));
	}

	private async loadModel(model: ModelId, onProgress?: (progress: number, text: string) => void): Promise<void> {
		if (this.worker && this.model === model) return;
		this.model = undefined;
		try {
			await this.request<void>({ kind: "load", model }, onProgress);
		} catch (error) {
			this.stop(error instanceof Error ? error : new Error(String(error)));
			throw error;
		}
		this.model = model;
	}

	private getWorker(): Worker {
		if (this.worker) return this.worker;
		const url = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
		try {
			this.worker = new Worker(url, { name: "deskmate-ai" });
		} finally {
			URL.revokeObjectURL(url);
		}
		const worker = this.worker;
		worker.addEventListener("error", (event) => {
			if (this.worker === worker) this.stop(new Error(event.message || "The local AI worker stopped."));
		});
		worker.addEventListener("messageerror", () => {
			if (this.worker === worker) this.stop(new Error("Couldn't read the local AI worker's response."));
		});
		worker.addEventListener("message", (event: MessageEvent<AiResponse>) => {
			if (this.worker !== worker) return;
			const response = event.data;
			const request = this.requests.get(response.id);
			if (!request) return;
			if (response.kind === "progress") {
				request.onProgress?.(response.progress, response.text);
				return;
			}
			this.requests.delete(response.id);
			if (response.kind === "error") request.reject(new Error(response.error));
			else request.resolve(response.value);
		});
		return this.worker;
	}

	generate(model: ModelId, messages: ChatCompletionMessageParam[], options: GenerateOptions): Promise<string> {
		return this.enqueue(async () => {
			const generation = this.generation;
			await this.loadModel(model);
			if (generation !== this.generation) throw new Error("Local AI request cancelled.");
			return this.request<string>({ kind: "generate", model, messages, options });
		});
	}

	/** Serialize model operations: daily cards can request two generations at once. */
	private enqueue<T>(action: () => Promise<T>): Promise<T> {
		window.clearTimeout(this.idleTimer);
		const generation = this.generation;
		this.pending++;
		const result = this.queue.then(async () => {
			if (generation !== this.generation) throw new Error("Local AI request cancelled.");
			return action();
		});
		const settled = result.finally(() => {
			if (--this.pending === 0 && this.worker) {
				this.idleTimer = window.setTimeout(() => void this.unload(), IDLE_UNLOAD_MS);
			}
		});
		this.queue = settled.catch(() => {});
		return settled;
	}

	private request<T>(command: AiCommand, onProgress?: (progress: number, text: string) => void): Promise<T> {
		const worker = this.getWorker();
		const id = ++this.nextId;
		return new Promise<T>((resolve, reject) => {
			this.requests.set(id, { resolve: (value) => resolve(value as T), reject, onProgress });
			try {
				worker.postMessage({ ...command, id });
			} catch (error) {
				this.requests.delete(id);
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		});
	}

	unload(): Promise<void> {
		window.clearTimeout(this.idleTimer);
		this.generation++;
		// Stop loading or generating immediately, including when the plugin is disabled.
		this.stop(new Error("Local AI request cancelled."));
		return this.queue.then(() => {});
	}

	private stop(error: Error): void {
		this.worker?.terminate();
		this.worker = undefined;
		this.model = undefined;
		for (const request of this.requests.values()) request.reject(error);
		this.requests.clear();
	}
}

export const local = new LocalModel();
