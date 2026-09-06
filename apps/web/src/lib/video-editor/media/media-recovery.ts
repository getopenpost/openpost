import type { TimelineItem, TimelineItemKind } from '../project/types';
import type { MediaMetadata } from './types';
import { mediaLibraryKind } from './library-view';

export type MediaSourceIssueKind = 'permission' | 'missing' | 'changed';
export type RecoverableTimelineMediaKind = Extract<
	TimelineItemKind,
	'video' | 'audio' | 'image' | 'lottie'
>;

export interface MediaSourceIssue {
	mediaId: string;
	fileName: string;
	kind: MediaSourceIssueKind;
}

export interface OrphanedTimelineClip {
	itemId: string;
	mediaId: string;
	label: string;
	itemType: RecoverableTimelineMediaKind;
	linkedGroupId?: string;
}

function recoverableItemType(item: TimelineItem): RecoverableTimelineMediaKind | null {
	switch (item.type) {
		case 'video':
		case 'audio':
		case 'image':
		case 'lottie':
			return item.type;
		default:
			return null;
	}
}

export function mediaCanRecoverItemType(
	itemType: RecoverableTimelineMediaKind,
	media: MediaMetadata
): boolean {
	const kind = mediaLibraryKind(media);
	if (itemType === 'audio') return kind === 'audio' || (kind === 'video' && !!media.audioCodec);
	return itemType === kind;
}

export function orphanedTimelineClips(
	items: readonly TimelineItem[],
	media: readonly MediaMetadata[]
): OrphanedTimelineClip[] {
	const knownMediaIds = new Set(media.map((entry) => entry.id));
	return items.flatMap((item) => {
		const itemType = recoverableItemType(item);
		if (!itemType || !item.mediaId || knownMediaIds.has(item.mediaId)) return [];
		return [
			{
				itemId: item.id,
				mediaId: item.mediaId,
				label: item.label,
				itemType,
				linkedGroupId: item.linkedGroupId
			}
		];
	});
}

export function compatibleRecoveryMedia(
	orphan: Pick<OrphanedTimelineClip, 'itemType'>,
	media: readonly MediaMetadata[]
): MediaMetadata[] {
	return media.filter((entry) => mediaCanRecoverItemType(orphan.itemType, entry));
}

function normalizedFileName(value: string): string {
	return value.trim().toLowerCase();
}

export function automaticOrphanMatches(
	orphans: readonly OrphanedTimelineClip[],
	media: readonly MediaMetadata[]
): Map<string, string> {
	const matches = new Map<string, string>();
	for (const orphan of orphans) {
		const candidates = compatibleRecoveryMedia(orphan, media).filter(
			(entry) => normalizedFileName(entry.fileName) === normalizedFileName(orphan.label)
		);
		const candidate = candidates.length === 1 ? candidates[0] : undefined;
		if (candidate) matches.set(orphan.itemId, candidate.id);
	}
	return matches;
}
