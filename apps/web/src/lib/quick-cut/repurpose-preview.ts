import { m } from '$lib/paraglide/messages';
import { exportSegments, discardScratchFile, type QuickCutExportProgress } from './export';
import { createSegment } from './model';
import type { QuickCutSource } from './types';

export async function prepareRepurposePreview(
	source: QuickCutSource,
	range: { start: number; end: number },
	audioTrackIndex: number,
	signal: AbortSignal,
	onProgress: (progress: QuickCutExportProgress) => void
) {
	const artifacts = await exportSegments({
		sources: [{ ...source, selectedAudioTrackIndices: [audioTrackIndex] }],
		segments: [
			createSegment(range.start, range.end, {
				sourceId: source.id,
				cutMode: 'exact'
			})
		],
		cutMode: 'exact',
		merge: false,
		signal,
		onProgress
	});
	const artifact = artifacts[0];
	if (!artifact) throw new Error(m.repurpose_preview_failed());
	if (signal.aborted) {
		await Promise.all(artifacts.map((item) => discardScratchFile(item.scratchPath)));
		throw signal.reason;
	}
	const url = URL.createObjectURL(artifact.scratchFile);
	return {
		url,
		dispose: async () => {
			URL.revokeObjectURL(url);
			await Promise.all(artifacts.map((item) => discardScratchFile(item.scratchPath)));
		}
	};
}
