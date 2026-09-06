import { gemmaLlmAdapter } from './adapter';
import type { LlmAdapter } from './types';

const adapters = new Map<string, LlmAdapter>([[gemmaLlmAdapter.id, gemmaLlmAdapter]]);
const defaultId = gemmaLlmAdapter.id;

export function getDefaultLlmAdapter(): LlmAdapter {
	const found = adapters.get(defaultId);
	if (!found) throw new Error('No default LLM adapter registered');
	return found;
}

export function getLlmAdapter(id: string): LlmAdapter {
	const found = adapters.get(id);
	if (!found) throw new Error(`Unknown LLM adapter: ${id}`);
	return found;
}

export function listLlmAdapters(): readonly LlmAdapter[] {
	return [...adapters.values()];
}

export function registerLlmAdapter(adapter: LlmAdapter): () => void {
	const previous = adapters.get(adapter.id);
	adapters.set(adapter.id, adapter);
	return () => {
		if (adapters.get(adapter.id) === adapter) {
			if (previous) adapters.set(adapter.id, previous);
			else adapters.delete(adapter.id);
		}
	};
}
