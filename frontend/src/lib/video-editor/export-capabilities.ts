export type VideoEditorExportFormat = 'mp4' | 'webm';
export type ExportVideoCodec = 'avc' | 'vp9' | 'vp8';
export type ExportAudioCodec = 'aac' | 'opus';
export type ExportHardwareAcceleration = 'no-preference' | 'prefer-hardware' | 'prefer-software';

export interface ExportCapabilityRequest {
	format: VideoEditorExportFormat;
	width: number;
	height: number;
	frameRate: number;
	videoBitrate: number;
	audioBitrate: number;
	hasAudio: boolean;
}

export interface ExportVideoCandidate {
	codec: ExportVideoCodec;
	fullCodecString: string;
	hardwareAcceleration: ExportHardwareAcceleration;
	bitrate: number;
}

export interface ExportEncoderPlan extends ExportVideoCandidate {
	format: VideoEditorExportFormat;
	audioCodec: ExportAudioCodec;
	audioBitrate: number;
}

export interface ExportCodecProbe {
	video(config: VideoEncoderConfig): Promise<boolean>;
	audio(config: AudioEncoderConfig): Promise<boolean>;
}

const MIN_H264_BITRATE = 2_500_000;
const MIN_WEBM_BITRATE = 1_500_000;

export function destinationVideoBitrate(
	maxBytes: number,
	durationSeconds: number,
	audioBitrate: number,
	minimumBitrate: number,
	maximumBitrate: number
): number | null {
	if (
		!Number.isFinite(maxBytes) ||
		maxBytes <= 0 ||
		!Number.isFinite(durationSeconds) ||
		durationSeconds <= 0
	) {
		return null;
	}
	const calculated = ((maxBytes * 8) / durationSeconds - audioBitrate) * 0.92;
	if (!Number.isFinite(calculated) || calculated < minimumBitrate) return null;
	return Math.floor(Math.min(maximumBitrate, calculated) / 1_000) * 1_000;
}

export function exportVideoCandidates(
	request: Pick<
		ExportCapabilityRequest,
		'format' | 'width' | 'height' | 'frameRate' | 'videoBitrate'
	>
): ExportVideoCandidate[] {
	const requested = Math.max(1, Math.round(request.videoBitrate));
	if (request.format === 'webm') {
		const bitrate = Math.min(requested, 8_000_000);
		return [
			{
				codec: 'vp9',
				fullCodecString: vp9CodecString(request.width, request.height, bitrate),
				hardwareAcceleration: 'no-preference',
				bitrate
			},
			{
				codec: 'vp8',
				fullCodecString: 'vp8',
				hardwareAcceleration: 'no-preference',
				bitrate
			}
		];
	}

	const bitrates = uniqueNumbers([
		requested,
		Math.max(MIN_H264_BITRATE, Math.min(requested, 8_000_000)),
		Math.max(MIN_H264_BITRATE, Math.min(requested, 6_000_000)),
		Math.max(MIN_H264_BITRATE, Math.min(requested, 4_000_000))
	]);
	const level = h264Level(request.width, request.height, request.frameRate, requested);
	const profiles = ['6400', '4d40', '42e0'];
	const candidates: ExportVideoCandidate[] = [];
	for (const bitrate of bitrates) {
		for (const profile of profiles) {
			candidates.push({
				codec: 'avc',
				fullCodecString: `avc1.${profile}${level}`,
				hardwareAcceleration: 'no-preference',
				bitrate
			});
		}
	}
	return candidates;
}

export async function probeExportEncoderPlan(
	request: ExportCapabilityRequest,
	probe: ExportCodecProbe = browserCodecProbe()
): Promise<ExportEncoderPlan> {
	const audioCodec: ExportAudioCodec = request.format === 'mp4' ? 'aac' : 'opus';
	if (
		request.hasAudio &&
		!(await probe.audio({
			codec: audioCodec === 'aac' ? 'mp4a.40.2' : 'opus',
			numberOfChannels: 2,
			sampleRate: 48_000,
			bitrate: request.audioBitrate,
			bitrateMode: 'variable',
			...(audioCodec === 'aac' ? { aac: { format: 'aac' as const } } : {})
		}))
	) {
		throw new Error(
			request.format === 'mp4'
				? 'This browser cannot encode AAC-LC audio at 48 kHz stereo. MP4 export is unavailable for this project.'
				: 'This browser cannot encode Opus audio at 48 kHz stereo. WebM export is unavailable for this project.'
		);
	}

	for (const candidate of exportVideoCandidates(request)) {
		const supported = await probe.video({
			codec: candidate.fullCodecString,
			width: request.width,
			height: request.height,
			framerate: request.frameRate,
			bitrate: candidate.bitrate,
			alpha: 'discard',
			bitrateMode: 'variable',
			hardwareAcceleration: candidate.hardwareAcceleration,
			latencyMode: 'quality',
			...(candidate.codec === 'avc' ? { avc: { format: 'avc' as const } } : {})
		});
		if (supported) {
			return {
				...candidate,
				format: request.format,
				audioCodec,
				audioBitrate: request.audioBitrate
			};
		}
	}

	throw new Error(
		request.format === 'mp4'
			? `This browser cannot encode H.264 at ${request.width}×${request.height}, ${formatFrameRate(request.frameRate)} fps. Download a WebM instead or choose a supported Chrome or Edge device.`
			: `This browser cannot encode WebM at ${request.width}×${request.height}, ${formatFrameRate(request.frameRate)} fps. Choose a smaller format or use a supported Chrome or Edge device.`
	);
}

function browserCodecProbe(): ExportCodecProbe {
	return {
		async video(config) {
			if (typeof VideoEncoder === 'undefined') return false;
			try {
				return (await VideoEncoder.isConfigSupported(config)).supported === true;
			} catch {
				return false;
			}
		},
		async audio(config) {
			if (typeof AudioEncoder === 'undefined') return false;
			try {
				return (await AudioEncoder.isConfigSupported(config)).supported === true;
			} catch {
				return false;
			}
		}
	};
}

function h264Level(width: number, height: number, frameRate: number, bitrate: number): string {
	const macroblocks = Math.ceil(width / 16) * Math.ceil(height / 16);
	const macroblocksPerSecond = macroblocks * frameRate;
	const levels = [
		{ code: '1f', frames: 108_000, picture: 3_600, bitrate: 14_000_000 },
		{ code: '20', frames: 216_000, picture: 5_120, bitrate: 20_000_000 },
		{ code: '28', frames: 245_760, picture: 8_192, bitrate: 25_000_000 },
		{ code: '29', frames: 245_760, picture: 8_192, bitrate: 62_500_000 },
		{ code: '2a', frames: 522_240, picture: 8_704, bitrate: 62_500_000 },
		{ code: '32', frames: 589_824, picture: 22_080, bitrate: 168_750_000 },
		{ code: '33', frames: 983_040, picture: 36_864, bitrate: 300_000_000 }
	];
	return (
		levels.find(
			(level) =>
				macroblocksPerSecond <= level.frames &&
				macroblocks <= level.picture &&
				bitrate <= level.bitrate
		)?.code ?? '33'
	);
}

function vp9CodecString(width: number, height: number, bitrate: number): string {
	const pixels = width * height;
	const levels = [
		{ code: '30', pixels: 552_960, bitrate: 7_200_000 },
		{ code: '31', pixels: 983_040, bitrate: 12_000_000 },
		{ code: '40', pixels: 2_228_224, bitrate: 18_000_000 },
		{ code: '41', pixels: 2_228_224, bitrate: 30_000_000 },
		{ code: '50', pixels: 8_912_896, bitrate: 60_000_000 }
	];
	const level =
		levels.find((candidate) => pixels <= candidate.pixels && bitrate <= candidate.bitrate)?.code ??
		'50';
	return `vp09.00.${level}.08`;
}

function uniqueNumbers(values: number[]): number[] {
	return [...new Set(values)];
}

function formatFrameRate(value: number): string {
	return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export const EXPORT_MINIMUM_BITRATES = {
	mp4: MIN_H264_BITRATE,
	webm: MIN_WEBM_BITRATE
} as const;
