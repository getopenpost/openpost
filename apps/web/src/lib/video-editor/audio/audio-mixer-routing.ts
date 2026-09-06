import { mixerDbToGain } from './mixer-utils';

const ANALYSER_FFT_SIZE = 2048;
type MixerContext = AudioContext | OfflineAudioContext;

interface StereoMeterTap {
	splitter: ChannelSplitterNode;
	left: AnalyserNode;
	right: AnalyserNode;
	silentOutput: GainNode;
	leftSamples: Float32Array<ArrayBuffer>;
	rightSamples: Float32Array<ArrayBuffer>;
}

interface TrackBus {
	input: GainNode;
	meter: StereoMeterTap;
	attachments: number;
}

export interface StereoMeterLevels {
	left: number;
	right: number;
	peakLeft: number;
	peakRight: number;
}

const SILENCE: StereoMeterLevels = { left: 0, right: 0, peakLeft: 0, peakRight: 0 };

function createMeterTap(context: MixerContext, source: AudioNode): StereoMeterTap {
	const splitter = context.createChannelSplitter(2);
	const left = context.createAnalyser();
	const right = context.createAnalyser();
	const silentOutput = context.createGain();
	left.fftSize = ANALYSER_FFT_SIZE;
	right.fftSize = ANALYSER_FFT_SIZE;
	left.smoothingTimeConstant = 0;
	right.smoothingTimeConstant = 0;
	silentOutput.gain.value = 0;
	source.connect(splitter);
	splitter.connect(left, 0, 0);
	splitter.connect(right, 1, 0);
	left.connect(silentOutput);
	right.connect(silentOutput);
	silentOutput.connect(context.destination);
	return {
		splitter,
		left,
		right,
		silentOutput,
		leftSamples: new Float32Array(left.fftSize),
		rightSamples: new Float32Array(right.fftSize)
	};
}

function disposeMeterTap(tap: StereoMeterTap): void {
	tap.splitter.disconnect();
	tap.left.disconnect();
	tap.right.disconnect();
	tap.silentOutput.disconnect();
}

function readChannel(analyser: AnalyserNode, samples: Float32Array<ArrayBuffer>): [number, number] {
	analyser.getFloatTimeDomainData(samples);
	let squared = 0;
	let peak = 0;
	for (const sample of samples) {
		const absolute = Math.abs(sample);
		peak = Math.max(peak, absolute);
		squared += sample * sample;
	}
	return [Math.sqrt(squared / samples.length), peak];
}

function readTap(tap: StereoMeterTap): StereoMeterLevels {
	const [left, peakLeft] = readChannel(tap.left, tap.leftSamples);
	const [right, peakRight] = readChannel(tap.right, tap.rightSamples);
	return { left, right, peakLeft, peakRight };
}

export class AudioMixerRouting {
	readonly master: GainNode;
	private readonly masterMeter: StereoMeterTap;
	private readonly tracks = new Map<string, TrackBus>();

	constructor(readonly context: MixerContext) {
		this.master = context.createGain();
		this.master.channelCount = 2;
		this.master.channelCountMode = 'explicit';
		this.master.channelInterpretation = 'speakers';
		this.master.gain.value = 1;
		this.master.connect(context.destination);
		this.masterMeter = createMeterTap(context, this.master);
	}

	private ensureTrack(trackId: string): TrackBus {
		const existing = this.tracks.get(trackId);
		if (existing) return existing;
		const input = this.context.createGain();
		input.channelCount = 2;
		input.channelCountMode = 'explicit';
		input.channelInterpretation = 'speakers';
		input.gain.value = 1;
		input.connect(this.master);
		const track = { input, meter: createMeterTap(this.context, input), attachments: 0 };
		this.tracks.set(trackId, track);
		return track;
	}

	attach(source: AudioNode, trackId: string): () => void {
		const track = this.ensureTrack(trackId);
		source.connect(track.input);
		track.attachments += 1;
		let attached = true;
		return () => {
			if (!attached) return;
			attached = false;
			try {
				source.disconnect(track.input);
			} catch {
				// A completed one-shot source may already have disconnected.
			}
			track.attachments -= 1;
			if (track.attachments > 0 || this.tracks.get(trackId) !== track) return;
			track.input.disconnect();
			disposeMeterTap(track.meter);
			this.tracks.delete(trackId);
		};
	}

	setMaster(db: number, muted: boolean): void {
		this.master.gain.value = muted ? 0 : mixerDbToGain(db);
	}

	setTrackPreviewGain(trackId: string, gain: number): void {
		const track = this.tracks.get(trackId);
		if (track) track.input.gain.value = Math.max(0, Number.isFinite(gain) ? gain : 1);
	}

	readMasterLevels(): StereoMeterLevels {
		return readTap(this.masterMeter);
	}

	readTrackLevels(trackId: string): StereoMeterLevels {
		const track = this.tracks.get(trackId);
		return track ? readTap(track.meter) : SILENCE;
	}

	activeTrackIds(): string[] {
		return [...this.tracks.keys()];
	}

	attachmentCount(trackId: string): number {
		return this.tracks.get(trackId)?.attachments ?? 0;
	}

	dispose(): void {
		for (const track of this.tracks.values()) {
			track.input.disconnect();
			disposeMeterTap(track.meter);
		}
		this.tracks.clear();
		this.master.disconnect();
		disposeMeterTap(this.masterMeter);
	}
}
