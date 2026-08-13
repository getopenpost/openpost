import { browser } from '$app/environment';

const CELEBRATION_DURATION_MS = 1600;
let clearCelebrationTimer: ReturnType<typeof setTimeout> | undefined;

export async function celebrateSchedule() {
	if (!browser || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

	document.documentElement.dataset.celebratingSchedule = 'true';
	if (clearCelebrationTimer) clearTimeout(clearCelebrationTimer);
	clearCelebrationTimer = setTimeout(() => {
		delete document.documentElement.dataset.celebratingSchedule;
		clearCelebrationTimer = undefined;
	}, CELEBRATION_DURATION_MS);

	const { default: confetti } = await import('canvas-confetti');
	const colors = ['#b74c05', '#f18a3b', '#ffd6ad', '#fff7ed'];
	const shared = {
		colors,
		disableForReducedMotion: true,
		gravity: 0.95,
		origin: { y: 0.72 },
		scalar: 0.92,
		spread: 72,
		startVelocity: 42,
		ticks: 180,
		zIndex: 300
	} as const;

	confetti({ ...shared, particleCount: 72, angle: 68, origin: { x: 0.18, y: 0.72 } });
	confetti({ ...shared, particleCount: 72, angle: 112, origin: { x: 0.82, y: 0.72 } });
}
