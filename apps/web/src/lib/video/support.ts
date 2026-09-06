const AVC_PROBE = { codec: 'avc' as const, config: 'avc1.42001f' };
const cache = new Map<string, Promise<'avc' | null>>();

interface VideoEncodingResources {
	encoder: VideoEncoder | null;
	frame: VideoFrame | null;
}

/**
 * Returns H.264 only after a real frame was encoded at the requested size.
 * Provider uploads need a common codec, so a browser's AV1/VP9 support does not
 * count as a usable fallback.
 */
export function firstPlatformVideoCodec(width: number, height: number): Promise<'avc' | null> {
	const normalizedWidth = Math.max(2, Math.floor(width / 2) * 2);
	const normalizedHeight = Math.max(2, Math.floor(height / 2) * 2);
	const key = `${normalizedWidth}x${normalizedHeight}`;
	let result = cache.get(key);
	if (!result) {
		result = canEncode(AVC_PROBE.config, normalizedWidth, normalizedHeight).then((supported) =>
			supported ? AVC_PROBE.codec : null
		);
		cache.set(key, result);
	}
	return result;
}

async function canEncode(codec: string, width: number, height: number): Promise<boolean> {
	if (
		typeof window === 'undefined' ||
		!('VideoEncoder' in window) ||
		typeof VideoFrame === 'undefined'
	) {
		return false;
	}

	const config: VideoEncoderConfig = {
		codec,
		width,
		height,
		bitrate: 1_000_000,
		framerate: 30
	};
	const resources: VideoEncodingResources = {
		encoder: null,
		frame: null
	};
	try {
		const { supported } = await VideoEncoder.isConfigSupported(config);
		if (!supported) return false;

		return await new Promise<boolean>((resolve) => {
			let settled = false;
			const finish = (value: boolean) => {
				if (settled) return;
				settled = true;
				resolve(value);
			};
			resources.encoder = new VideoEncoder({
				output: () => finish(true),
				error: () => finish(false)
			});
			resources.encoder.configure(config);
			const canvas = document.createElement('canvas');
			canvas.width = width;
			canvas.height = height;
			canvas.getContext('2d')?.fillRect(0, 0, width, height);
			resources.frame = new VideoFrame(canvas, { timestamp: 0 });
			resources.encoder.encode(resources.frame, { keyFrame: true });
			void resources.encoder
				.flush()
				.then(() => finish(false))
				.catch(() => finish(false));
		});
	} catch {
		return false;
	} finally {
		try {
			resources.frame?.close();
		} catch {
			// The encoder may already own and close the frame.
		}
		try {
			resources.encoder?.close();
		} catch {
			// The encoder may already be closed after an error.
		}
	}
}
