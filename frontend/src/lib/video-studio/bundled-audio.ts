export interface BundledAudioItem {
	id: string;
	name: string;
	kind: 'music' | 'effect';
	duration_seconds: number;
}

export const BUNDLED_AUDIO_ITEMS: BundledAudioItem[] = [
	{ id: 'warm-pulse', name: 'Warm pulse', kind: 'music', duration_seconds: 8 },
	{ id: 'bright-step', name: 'Bright step', kind: 'music', duration_seconds: 8 },
	{ id: 'calm-grid', name: 'Calm grid', kind: 'music', duration_seconds: 8 },
	{ id: 'night-drive', name: 'Night drive', kind: 'music', duration_seconds: 8 },
	{ id: 'soft-launch', name: 'Soft launch', kind: 'music', duration_seconds: 8 },
	{ id: 'clean-motion', name: 'Clean motion', kind: 'music', duration_seconds: 8 },
	{ id: 'ambient-focus', name: 'Ambient focus', kind: 'music', duration_seconds: 8 },
	{ id: 'upbeat-loop', name: 'Upbeat loop', kind: 'music', duration_seconds: 8 },
	{ id: 'soft-click', name: 'Soft click', kind: 'effect', duration_seconds: 0.18 },
	{ id: 'deep-click', name: 'Deep click', kind: 'effect', duration_seconds: 0.24 },
	{ id: 'pop', name: 'Pop', kind: 'effect', duration_seconds: 0.32 },
	{ id: 'bright-pop', name: 'Bright pop', kind: 'effect', duration_seconds: 0.38 },
	{ id: 'short-whoosh', name: 'Short whoosh', kind: 'effect', duration_seconds: 0.65 },
	{ id: 'long-whoosh', name: 'Long whoosh', kind: 'effect', duration_seconds: 1.1 },
	{ id: 'success-chime', name: 'Success chime', kind: 'effect', duration_seconds: 0.9 },
	{ id: 'alert-chime', name: 'Alert chime', kind: 'effect', duration_seconds: 0.8 },
	{ id: 'transition-up', name: 'Transition up', kind: 'effect', duration_seconds: 0.7 },
	{ id: 'transition-down', name: 'Transition down', kind: 'effect', duration_seconds: 0.7 },
	{ id: 'tap', name: 'Tap', kind: 'effect', duration_seconds: 0.15 },
	{ id: 'confirm', name: 'Confirm', kind: 'effect', duration_seconds: 0.55 }
];

const SAMPLE_RATE = 48_000;

export function renderBundledAudio(item: BundledAudioItem): File {
	const frames = Math.ceil(item.duration_seconds * SAMPLE_RATE);
	const left = new Float32Array(frames);
	const right = new Float32Array(frames);
	const index = BUNDLED_AUDIO_ITEMS.findIndex((candidate) => candidate.id === item.id);
	if (item.kind === 'music') synthesizeMusic(left, right, index);
	else synthesizeEffect(left, right, index - 8);
	const encoded = encodeWAV(left, right);
	return new File([encoded], `${item.id}.wav`, {
		type: 'audio/wav',
		lastModified: Date.now()
	});
}

function synthesizeMusic(left: Float32Array, right: Float32Array, preset: number): void {
	const roots = [110, 146.83, 130.81, 98, 164.81, 123.47, 174.61, 138.59];
	const bpms = [90, 112, 82, 104, 96, 118, 74, 124];
	const root = roots[preset] ?? 110;
	const beatSeconds = 60 / (bpms[preset] ?? 100);
	let noise = 0x12345678 ^ preset;
	for (let frame = 0; frame < left.length; frame += 1) {
		const time = frame / SAMPLE_RATE;
		const beatTime = time % beatSeconds;
		const barPhase = (time / (beatSeconds * 4)) % 1;
		const chord = [1, 1.12246, 1.33484, 1.49831][Math.floor(barPhase * 4)] ?? 1;
		const pad =
			Math.sin(time * Math.PI * 2 * root * chord) * 0.1 +
			Math.sin(time * Math.PI * 2 * root * chord * 1.5) * 0.05 +
			Math.sin(time * Math.PI * 2 * root * chord * 2) * 0.025;
		const kick =
			Math.sin(time * Math.PI * 2 * (52 + 48 * Math.exp(-beatTime * 20))) *
			Math.exp(-beatTime * 14) *
			0.32;
		noise = (noise * 1664525 + 1013904223) >>> 0;
		const hatTime = time % (beatSeconds / 2);
		const hat = ((noise / 0xffffffff) * 2 - 1) * Math.exp(-hatTime * 55) * 0.045;
		const edge = Math.min(1, time / 0.04, (left.length / SAMPLE_RATE - time) / 0.04);
		const sample = Math.tanh((pad + kick + hat) * Math.max(0, edge));
		left[frame] = sample * (0.94 + 0.06 * Math.sin(time * 0.7));
		right[frame] = sample * (0.94 + 0.06 * Math.cos(time * 0.73));
	}
}

function synthesizeEffect(left: Float32Array, right: Float32Array, preset: number): void {
	let noise = 0x9e3779b9 ^ preset;
	for (let frame = 0; frame < left.length; frame += 1) {
		const time = frame / SAMPLE_RATE;
		const progress = frame / Math.max(1, left.length - 1);
		const envelope = Math.sin(Math.PI * progress) * Math.exp(-progress * (preset < 4 ? 4 : 1));
		noise = (noise * 1103515245 + 12345) >>> 0;
		const white = (noise / 0xffffffff) * 2 - 1;
		let sample: number;
		if (preset === 4 || preset === 5) {
			sample =
				white * envelope * 0.28 +
				Math.sin(time * Math.PI * 2 * (180 + 900 * progress)) * envelope * 0.08;
		} else if (preset === 8 || preset === 9) {
			const sweep = preset === 8 ? 180 + progress * 900 : 980 - progress * 800;
			sample = Math.sin(time * Math.PI * 2 * sweep) * envelope * 0.3;
		} else {
			const base = [520, 180, 330, 720, 0, 0, 523, 392, 0, 0, 680, 587][preset] ?? 440;
			const second = preset === 6 || preset === 11 ? base * 1.5 : base * 1.25;
			sample =
				(Math.sin(time * Math.PI * 2 * base) * 0.28 +
					Math.sin(time * Math.PI * 2 * second) * 0.16 +
					white * 0.03) *
				envelope;
		}
		left[frame] = Math.max(-1, Math.min(1, sample));
		right[frame] = left[frame] * 0.97;
	}
}

function encodeWAV(left: Float32Array, right: Float32Array): ArrayBuffer {
	const dataBytes = left.length * 4;
	const buffer = new ArrayBuffer(44 + dataBytes);
	const view = new DataView(buffer);
	writeASCII(view, 0, 'RIFF');
	view.setUint32(4, 36 + dataBytes, true);
	writeASCII(view, 8, 'WAVE');
	writeASCII(view, 12, 'fmt ');
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 2, true);
	view.setUint32(24, SAMPLE_RATE, true);
	view.setUint32(28, SAMPLE_RATE * 4, true);
	view.setUint16(32, 4, true);
	view.setUint16(34, 16, true);
	writeASCII(view, 36, 'data');
	view.setUint32(40, dataBytes, true);
	let offset = 44;
	for (let frame = 0; frame < left.length; frame += 1) {
		view.setInt16(offset, Math.round(Math.max(-1, Math.min(1, left[frame] ?? 0)) * 32767), true);
		view.setInt16(
			offset + 2,
			Math.round(Math.max(-1, Math.min(1, right[frame] ?? 0)) * 32767),
			true
		);
		offset += 4;
	}
	return buffer;
}

function writeASCII(view: DataView, offset: number, value: string): void {
	for (let index = 0; index < value.length; index += 1) {
		view.setUint8(offset + index, value.charCodeAt(index));
	}
}
