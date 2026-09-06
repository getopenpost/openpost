export type ImageEditorMetricName =
	| 'document_load'
	| 'canvas_ready'
	| 'autosave'
	| 'preview_generation'
	| 'export'
	| 'background_removal';

export function startImageEditorMetric(
	name: ImageEditorMetricName
): (outcome?: 'success' | 'error') => void {
	const startedAt = globalThis.performance?.now() ?? Date.now();
	return (outcome = 'success') => {
		const duration = Math.max(0, (globalThis.performance?.now() ?? Date.now()) - startedAt);
		globalThis.dispatchEvent?.(
			new CustomEvent('openpost:image-editor-metric', {
				detail: { name, outcome, duration_ms: Math.round(duration) }
			})
		);
	};
}
