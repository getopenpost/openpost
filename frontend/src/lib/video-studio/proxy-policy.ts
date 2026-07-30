import type { VideoSource } from '@openpost/video-project';

export type ProxyReason = 'dimensions' | 'frame-rate' | 'codec' | null;

export function proxyReason(
	source: Pick<VideoSource, 'width' | 'height' | 'video_codec'>,
	estimatedFrameRate: number
): ProxyReason {
	const longSide = Math.max(source.width, source.height);
	const shortSide = Math.min(source.width, source.height);
	if (longSide > 1920 || shortSide > 1080) return 'dimensions';
	if (estimatedFrameRate > 30.5) return 'frame-rate';
	if (source.video_codec === 'hevc' || source.video_codec === 'av1') return 'codec';
	return null;
}
