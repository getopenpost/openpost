export type TimerStyle = 'numbers' | 'ring' | 'bar' | 'bomb' | 'tomato';
export interface TimerSettings {
	style: TimerStyle;
	direction: 'down' | 'up';
	format: 'clock' | 'seconds' | 'percent';
	finishText?: string;
	warningSound?: boolean;
	finishHoldSeconds?: number;
	progressColor?: string;
	trackColor?: string;
	trackOpacity?: number;
	thickness?: number;
	startAngle?: number;
	segments?: number;
	rounded?: boolean;
	showValue?: boolean;
	bodyColor?: string;
	accentColor?: string;
	finishEffect?: boolean;
}

export function timerTiming(settings: TimerSettings, duration: number, fps: number) {
	const holdFrames = Math.min(
		Math.max(0, duration - 1),
		Math.max(0, Math.round((settings.finishHoldSeconds ?? 0) * fps))
	);
	return { holdFrames, activeFrames: duration - holdFrames };
}

export function timerValue(
	settings: TimerSettings,
	localFrame: number,
	duration: number,
	fps: number
) {
	const { holdFrames } = timerTiming(settings, duration, fps);
	const lastFrame = Math.max(1, duration - Math.max(1, holdFrames));
	const frame = Math.max(0, Math.min(localFrame, lastFrame));
	const finished = frame >= lastFrame;
	const progress = frame / lastFrame;
	const remaining = finished ? 0 : Math.ceil((duration - holdFrames - frame) / fps);
	const seconds =
		settings.direction === 'down'
			? remaining
			: Math.floor((finished ? duration - holdFrames : frame) / fps);
	const fraction = settings.direction === 'down' ? 1 - progress : progress;
	let text = String(seconds);
	if (settings.format === 'percent') text = `${Math.round(fraction * 100)}%`;
	if (settings.format === 'clock') {
		const hours = Math.floor(seconds / 3600);
		text = `${hours ? `${hours}:` : ''}${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
	}
	if (finished && settings.finishText) text = settings.finishText;
	return {
		text,
		fraction,
		progress,
		finished,
		finishProgress: finished
			? Math.min(1, (localFrame - lastFrame) / Math.max(1, holdFrames - 1))
			: 0
	};
}
