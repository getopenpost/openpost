import { firstPlatformVideoCodec } from '$lib/video/support';
import type { VideoEditorCapabilities } from './types';

type StorageManagerWithDirectory = StorageManager & {
	getDirectory?: () => Promise<FileSystemDirectoryHandle>;
};

export async function detectVideoEditorCapabilities(): Promise<VideoEditorCapabilities> {
	const browser = typeof window !== 'undefined';
	const videoDecoder = browser && 'VideoDecoder' in window;
	const videoEncoder = browser && 'VideoEncoder' in window;
	const webCodecs = videoDecoder && videoEncoder && typeof VideoFrame !== 'undefined';
	const opfs = Boolean(
		(navigator.storage as StorageManagerWithDirectory | undefined)?.getDirectory
	);
	const webgl2 = canCreateWebGL2Context();
	const h264Encoder = videoEncoder ? (await firstPlatformVideoCodec(640, 360)) === 'avc' : false;
	const aacEncoder = await canEncodeAAC();
	const touchOnlyPhone =
		navigator.maxTouchPoints > 0 &&
		matchMedia('(pointer: coarse) and (hover: none)').matches &&
		window.innerWidth < 768;
	const editorMode: VideoEditorCapabilities['editorMode'] = touchOnlyPhone
		? 'compact'
		: matchMedia('(min-width: 80rem)').matches
			? 'full'
			: 'compact';
	const desktopTimeline = true;
	const reasons: string[] = [];

	if (!webCodecs) reasons.push('This browser does not provide the WebCodecs video engine.');
	if (!opfs) reasons.push('This browser does not provide durable origin-private file storage.');
	if (!webgl2) reasons.push('This browser cannot create the WebGL2 preview compositor.');

	return {
		supported: webCodecs && opfs && webgl2,
		editorMode,
		desktopTimeline,
		webCodecs,
		videoDecoder,
		videoEncoder,
		h264Encoder,
		aacEncoder,
		webgl2,
		offscreenCanvas: browser && typeof OffscreenCanvas !== 'undefined',
		audioWorklet: browser && 'AudioWorkletNode' in window,
		opfs,
		filePicker: browser && 'showSaveFilePicker' in window,
		screenCapture: Boolean(navigator.mediaDevices?.getDisplayMedia),
		mediaRecorder: browser && typeof MediaRecorder !== 'undefined',
		webGPU: 'gpu' in navigator,
		reasons
	};
}

async function canEncodeAAC(): Promise<boolean> {
	if (typeof AudioEncoder === 'undefined') return false;
	try {
		const result = await AudioEncoder.isConfigSupported({
			codec: 'mp4a.40.2',
			sampleRate: 48_000,
			numberOfChannels: 2,
			bitrate: 192_000
		});
		return result.supported === true;
	} catch {
		return false;
	}
}

function canCreateWebGL2Context(): boolean {
	if (typeof document === 'undefined') return false;
	const canvas = document.createElement('canvas');
	return Boolean(canvas.getContext('webgl2'));
}
