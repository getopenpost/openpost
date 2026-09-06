import type { MediaMetadata } from './types';

export type MediaLibraryFilter = 'all' | 'video' | 'audio' | 'image' | 'lottie';
export type MediaLibrarySort = 'added' | 'name' | 'duration' | 'size';
export type MediaLibraryKind = Exclude<MediaLibraryFilter, 'all'> | 'other';

export interface MediaLibraryGroup {
	kind: MediaLibraryKind;
	media: MediaMetadata[];
}

const GROUP_ORDER: MediaLibraryKind[] = ['video', 'audio', 'image', 'lottie', 'other'];
const GRID_MIN_WIDTH_BY_SIZE = new Map([
	[1, 80],
	[2, 110],
	[3, 140],
	[4, 200],
	[5, 280]
]);

export function mediaLibraryGridTemplate(itemSize: number): string {
	const minWidth = GRID_MIN_WIDTH_BY_SIZE.get(itemSize) ?? 110;
	return `repeat(auto-fill, minmax(min(${minWidth}px, 100%), 1fr))`;
}

export function mediaLibraryKind(media: MediaMetadata): MediaLibraryKind {
	if (media.tags.includes('lottie')) return 'lottie';
	if (media.tags.includes('audio') || media.mimeType.startsWith('audio/')) return 'audio';
	if (media.tags.includes('image') || media.mimeType.startsWith('image/')) return 'image';
	if (media.tags.includes('video') || media.mimeType.startsWith('video/')) return 'video';
	return 'other';
}

function searchText(media: MediaMetadata): string {
	return [
		media.fileName,
		media.mimeType,
		media.codec,
		media.audioCodec ?? '',
		...media.tags,
		media.attribution?.provider ?? '',
		media.attribution?.author ?? ''
	]
		.join(' ')
		.toLocaleLowerCase();
}

export function filterAndSortMedia(
	media: readonly MediaMetadata[],
	query: string,
	filter: MediaLibraryFilter,
	sort: MediaLibrarySort
): MediaMetadata[] {
	const normalizedQuery = query.trim().toLocaleLowerCase();
	const addedOrder = new Map(media.map((item, index) => [item.id, index]));
	const filtered = media.filter((item) => {
		if (filter !== 'all' && mediaLibraryKind(item) !== filter) return false;
		return normalizedQuery.length === 0 || searchText(item).includes(normalizedQuery);
	});

	return filtered.toSorted((left, right) => {
		switch (sort) {
			case 'name':
				return left.fileName.localeCompare(right.fileName, undefined, {
					numeric: true,
					sensitivity: 'base'
				});
			case 'duration':
				return right.duration - left.duration || left.fileName.localeCompare(right.fileName);
			case 'size':
				return right.fileSize - left.fileSize || left.fileName.localeCompare(right.fileName);
			default:
				return (addedOrder.get(right.id) ?? 0) - (addedOrder.get(left.id) ?? 0);
		}
	});
}

export function groupMediaByKind(media: readonly MediaMetadata[]): MediaLibraryGroup[] {
	const groups = new Map<MediaLibraryKind, MediaMetadata[]>();
	for (const item of media) {
		const kind = mediaLibraryKind(item);
		const group = groups.get(kind) ?? [];
		group.push(item);
		groups.set(kind, group);
	}
	return GROUP_ORDER.flatMap((kind) => {
		const items = groups.get(kind);
		return items && items.length > 0 ? [{ kind, media: items }] : [];
	});
}

export function formatMediaDuration(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
	const total = Math.floor(seconds);
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const remaining = total % 60;
	return hours > 0
		? `${hours}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`
		: `${minutes}:${String(remaining).padStart(2, '0')}`;
}

export function formatMediaBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	const unit = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
	const value = bytes / 1024 ** unit;
	return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

export function formatMediaBitrate(bitsPerSecond: number): string {
	if (!Number.isFinite(bitsPerSecond) || bitsPerSecond <= 0) return '0 bps';
	const units = ['bps', 'kbps', 'Mbps', 'Gbps'];
	const unit = Math.min(units.length - 1, Math.floor(Math.log(bitsPerSecond) / Math.log(1000)));
	const value = bitsPerSecond / 1000 ** unit;
	const formatted =
		value >= 10 || unit === 0 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, '');
	return `${formatted} ${units[unit]}`;
}

export function formatMediaListSummary(media: MediaMetadata): string {
	if (media.duration > 0) return formatMediaDuration(media.duration);
	if (media.width > 0 && media.height > 0) return `${media.width} × ${media.height}`;
	return formatMediaBytes(media.fileSize);
}
