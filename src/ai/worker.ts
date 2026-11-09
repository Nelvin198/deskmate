import { CreateMLCEngine, deleteModelAllInfoInCache, hasModelInCache } from "@mlc-ai/web-llm";
import type { MLCEngine } from "@mlc-ai/web-llm";
import type { AiRequest, AiResponse } from "./protocol";

// Inference and model initialization run away from Obsidian's UI thread.
let engine: MLCEngine | undefined;
const respond = (response: AiResponse) => self.postMessage(response);

self.onmessage = (event: MessageEvent<AiRequest>) => {
	const request = event.data;
	void handle(request).then(
		(value) => respond({ id: request.id, kind: "result", value }),
		(error: unknown) => respond({ id: request.id, kind: "error", error: error instanceof Error ? error.message : String(error) }),
	);
};

async function handle(request: AiRequest): Promise<unknown> {
	switch (request.kind) {
		case "cached": return hasModelInCache(request.model);
		case "delete": return deleteModelAllInfoInCache(request.model);
		case "load": {
			await engine?.unload();
			engine = undefined;
			engine = await CreateMLCEngine(request.model, {
				logLevel: "WARN",
				initProgressCallback: ({ progress, text }) => respond({ id: request.id, kind: "progress", progress, text }),
			});
			return;
		}
		case "generate": {
			if (!engine) throw new Error("The local AI model isn't loaded.");
			const reply = await engine.chat.completions.create({
				messages: request.messages,
				temperature: request.options.temperature,
				max_tokens: request.options.maxTokens,
				...(request.model.startsWith("Qwen3") ? { extra_body: { enable_thinking: false } } : {}),
			});
			return reply.choices[0]?.message?.content ?? "";
		}
	}
}
