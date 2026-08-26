import {
	copyShuttleGrainSamples,
	REVERSE_SHUTTLE_GRAIN_FADE_SECONDS,
	REVERSE_SHUTTLE_GRAIN_OUTPUT_SECONDS,
	REVERSE_SHUTTLE_LOOKAHEAD_SECONDS,
	resolveReverseShuttleGrainPlan
} from './reverse-shuttle-grain';

const SCHEDULER_INTERVAL_MS = 30;
const START_SAFETY_SECONDS = 0.01;

export interface ReverseShuttleSchedulerOptions {
	context: AudioContext;
	buffer: AudioBuffer;
	bufferStartSeconds: number;
	getSourceCursorSeconds: () => number;
	authoredPlaybackRate: number;
	authoredReversed: boolean;
	getTransportRate: () => number;
	getGain: () => number;
	destination: AudioNode;
}

export function createReverseShuttleScheduler(options: ReverseShuttleSchedulerOptions) {
	const {
		context,
		buffer,
		bufferStartSeconds,
		getSourceCursorSeconds,
		authoredPlaybackRate,
		authoredReversed,
		getTransportRate,
		getGain,
		destination
	} = options;

	const scheduled = new Set<AudioBufferSourceNode>();
	let nextContextTime = context.currentTime + START_SAFETY_SECONDS;
	let sourceCursor: number | null = null;
	let intervalId: number | null = null;
	let disposed = false;

	function stopScheduled() {
		for (const node of scheduled) {
			try {
				node.stop();
			} catch {
				// already ended
			}
			node.disconnect();
		}
		scheduled.clear();
	}

	function createGrainBuffer(plan: ReturnType<typeof resolveReverseShuttleGrainPlan>) {
		if (!plan) return null;
		const sourceStartInBuffer = plan.sourceStartSeconds - bufferStartSeconds;
		const sourceFrameCount = Math.max(
			1,
			Math.round(plan.sourceDurationSeconds * buffer.sampleRate)
		);
		const sourceStartSample = Math.max(
			0,
			Math.min(
				buffer.length - sourceFrameCount,
				Math.round(sourceStartInBuffer * buffer.sampleRate)
			)
		);
		const grain = context.createBuffer(
			buffer.numberOfChannels,
			sourceFrameCount,
			buffer.sampleRate
		);
		for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
			copyShuttleGrainSamples(
				buffer.getChannelData(channel),
				grain.getChannelData(channel),
				sourceStartSample,
				plan.reverseSamples
			);
		}
		return grain;
	}

	function schedule() {
		if (disposed) return;
		const transportRate = getTransportRate();
		if (transportRate >= 0) {
			stopScheduled();
			sourceCursor = null;
			nextContextTime = context.currentTime + START_SAFETY_SECONDS;
			return;
		}
		const now = context.currentTime;
		const clockCursor = getSourceCursorSeconds();
		const sourceRate = Math.max(
			0.0625,
			Math.min(16, Math.abs(authoredPlaybackRate * transportRate))
		);
		const maxDrift =
			REVERSE_SHUTTLE_LOOKAHEAD_SECONDS * sourceRate +
			REVERSE_SHUTTLE_GRAIN_OUTPUT_SECONDS * sourceRate * 2;
		if (sourceCursor === null || Math.abs(sourceCursor - clockCursor) > maxDrift) {
			stopScheduled();
			sourceCursor = clockCursor;
			nextContextTime = now + START_SAFETY_SECONDS;
		}
		while (nextContextTime < now + REVERSE_SHUTTLE_LOOKAHEAD_SECONDS) {
			if (sourceCursor === null) break;
			const plan = resolveReverseShuttleGrainPlan({
				sourceCursorSeconds: sourceCursor,
				authoredPlaybackRate,
				transportPlaybackRate: transportRate,
				authoredReversed,
				bufferStartSeconds,
				bufferDurationSeconds: buffer.duration
			});
			if (!plan) break;
			const grainBuffer = createGrainBuffer(plan);
			if (!grainBuffer) break;
			const source = context.createBufferSource();
			const envelope = context.createGain();
			source.buffer = grainBuffer;
			source.playbackRate.value = plan.playbackRate;
			const startAt = Math.max(nextContextTime, now + START_SAFETY_SECONDS);
			const outputDuration = plan.sourceDurationSeconds / plan.playbackRate;
			const endAt = startAt + outputDuration;
			const gain = getGain();
			envelope.gain.setValueAtTime(0, startAt);
			envelope.gain.linearRampToValueAtTime(gain, startAt + REVERSE_SHUTTLE_GRAIN_FADE_SECONDS);
			envelope.gain.setValueAtTime(
				gain,
				Math.max(startAt, endAt - REVERSE_SHUTTLE_GRAIN_FADE_SECONDS)
			);
			envelope.gain.linearRampToValueAtTime(0, endAt);
			source.connect(envelope);
			envelope.connect(destination);
			scheduled.add(source);
			source.onended = () => {
				scheduled.delete(source);
				source.disconnect();
				envelope.disconnect();
			};
			source.start(startAt);
			sourceCursor = plan.nextSourceCursorSeconds;
			nextContextTime = endAt;
		}
	}

	function start() {
		if (context.state === 'suspended') void context.resume().catch(() => undefined);
		schedule();
		if (intervalId !== null) window.clearInterval(intervalId);
		intervalId = window.setInterval(schedule, SCHEDULER_INTERVAL_MS);
	}

	function stop() {
		if (intervalId !== null) {
			window.clearInterval(intervalId);
			intervalId = null;
		}
		stopScheduled();
		sourceCursor = null;
		nextContextTime = context.currentTime + START_SAFETY_SECONDS;
	}

	function dispose() {
		disposed = true;
		stop();
	}

	return { start, stop, dispose, schedule };
}
