interface DownloadProgressLike {
	file?: string;
	loaded?: number;
	total?: number;
}

export type DownloadProgressCache = Map<string, { loaded: number; total: number }>;

export function updateDownloadProgress(
	progress: DownloadProgressLike,
	cache: DownloadProgressCache
): { loaded: number; total: number; fraction: number } | null {
	if (!progress.file || !progress.total) return null;
	cache.set(progress.file, { loaded: progress.loaded ?? 0, total: progress.total });
	let loaded = 0;
	let total = 0;
	for (const entry of cache.values()) {
		loaded += entry.loaded;
		total += entry.total;
	}
	return total > 0 ? { loaded, total, fraction: Math.min(0.99, loaded / total) } : null;
}
