let enabled = new URLSearchParams(globalThis.location?.search).get('profile') === '1';

/** Workers inherit the page's explicit profiling choice with their job. */
export function configureProfiling(options: { enabled: boolean }): void {
	enabled = options.enabled;
}

export function isProfilingEnabled(): boolean {
	return enabled;
}

/** Use fixed operation names only, never project names, URLs, or user content. */
export function startProfileSpan(area: string, operation: string): (() => void) | undefined {
	if (!enabled) return undefined;
	const start = performance.now();
	let finished = false;
	return () => {
		if (finished) return;
		finished = true;
		const name = `OpenPost/${area}/${operation}`;
		performance.measure(name, {
			start,
			end: performance.now(),
			detail: {
				devtools: {
					dataType: 'track-entry',
					track: area,
					trackGroup: 'OpenPost',
					color: 'tertiary'
				}
			}
		});
		// Observers and DevTools receive the entry; long exports retain no per-frame history.
		performance.clearMeasures(name);
	};
}
