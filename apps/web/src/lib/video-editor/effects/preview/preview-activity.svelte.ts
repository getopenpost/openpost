const PREVIEW_INTENT_DELAY_MS = 180;

/** One deliberate preview, suspended when offscreen, hidden, or motion is reduced. */
export function createPreviewActivity(
	active: () => boolean,
	target: () => HTMLElement | undefined
) {
	let visible = $state(false);
	let pageVisible = $state(true);
	let reducedMotion = $state(false);
	let running = $state(false);

	$effect(() => {
		const element = target();
		if (!element) return;
		const observer = new IntersectionObserver(([entry]) => {
			visible = entry?.isIntersecting === true;
		});
		observer.observe(element);
		return () => observer.disconnect();
	});
	$effect(() => {
		const motion = matchMedia('(prefers-reduced-motion: reduce)');
		const update = () => {
			pageVisible = !document.hidden;
			reducedMotion = motion.matches;
		};
		update();
		motion.addEventListener('change', update);
		document.addEventListener('visibilitychange', update);
		return () => {
			motion.removeEventListener('change', update);
			document.removeEventListener('visibilitychange', update);
		};
	});
	$effect(() => {
		running = false;
		if (!active() || !visible || !pageVisible || reducedMotion) return;
		const timeout = setTimeout(() => (running = true), PREVIEW_INTENT_DELAY_MS);
		return () => clearTimeout(timeout);
	});
	return {
		get active() {
			return running;
		}
	};
}
