export const FIRST_VIEWPORT_LOADING_DELAY_MS = 150;

export function createDelayedVisibility(
	readActive: () => boolean,
	delayMs = FIRST_VIEWPORT_LOADING_DELAY_MS
) {
	let visible = $state(false);

	$effect(() => {
		visible = false;
		if (!readActive()) return;
		if (delayMs <= 0) {
			visible = true;
			return;
		}

		const timer = globalThis.setTimeout(() => {
			visible = true;
		}, delayMs);

		return () => globalThis.clearTimeout(timer);
	});

	return {
		get current() {
			return visible;
		}
	};
}
