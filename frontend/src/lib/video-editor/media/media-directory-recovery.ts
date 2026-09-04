import type { MediaSourceIssue } from './media-recovery';
import type { MediaMetadata } from './types';

export interface MediaRecoveryDirectoryFile {
	path: string;
	file: File;
	handle: FileSystemFileHandle;
}

interface MediaDirectoryRecoveryEntryBase {
	mediaId: string;
	fileName: string;
	media: MediaMetadata;
}

export type MediaDirectoryRecoveryEntry =
	| (MediaDirectoryRecoveryEntryBase & {
			status: 'exact';
			candidatePath: string;
			candidate: MediaRecoveryDirectoryFile;
	  })
	| (MediaDirectoryRecoveryEntryBase & {
			status: 'conflict';
			candidatePaths: string[];
	  })
	| (MediaDirectoryRecoveryEntryBase & { status: 'unmatched' });

export interface MediaDirectoryRecoveryPlan {
	directoryName: string;
	entries: MediaDirectoryRecoveryEntry[];
}

export interface MediaDirectoryRecoveryResult {
	restoredMediaIds: string[];
	failures: Array<{ mediaId: string; fileName: string; message: string }>;
}

type RecoverMediaSource = (
	media: MediaMetadata,
	handle: FileSystemFileHandle,
	sourcePath: string
) => Promise<MediaMetadata>;

function normalized(value: string): string {
	return value.replaceAll('\\', '/').replace(/^\.\//, '').toLocaleLowerCase('en-US');
}

async function scanDirectory(
	directory: FileSystemDirectoryHandle,
	parentPath: string,
	files: MediaRecoveryDirectoryFile[]
): Promise<void> {
	for await (const entry of directory.values()) {
		const path = parentPath ? `${parentPath}/${entry.name}` : entry.name;
		if (entry.kind === 'directory') {
			// SAFETY: the File System Access API kind discriminant identifies a directory handle.
			await scanDirectory(entry as FileSystemDirectoryHandle, path, files);
			continue;
		}
		// SAFETY: the File System Access API kind discriminant identifies a file handle.
		const handle = entry as FileSystemFileHandle;
		files.push({ path, file: await handle.getFile(), handle });
	}
}

export async function scanMediaRecoveryDirectory(
	directory: FileSystemDirectoryHandle
): Promise<MediaRecoveryDirectoryFile[]> {
	const files: MediaRecoveryDirectoryFile[] = [];
	await scanDirectory(directory, '', files);
	return files.sort((left, right) => left.path.localeCompare(right.path));
}

function exactCandidate(
	media: MediaMetadata,
	candidates: readonly MediaRecoveryDirectoryFile[]
): MediaRecoveryDirectoryFile | null {
	if (!media.sourcePath) return null;
	const expectedPath = normalized(media.sourcePath);
	const expectedSize = media.sourceFileSize ?? media.fileSize;
	return (
		candidates.find(
			(candidate) =>
				normalized(candidate.path) === expectedPath && candidate.file.size === expectedSize
		) ?? null
	);
}

function planEntry(
	issue: MediaSourceIssue,
	media: MediaMetadata,
	candidates: readonly MediaRecoveryDirectoryFile[]
): MediaDirectoryRecoveryEntry {
	const pathMatch = exactCandidate(media, candidates);
	if (pathMatch) {
		return {
			mediaId: media.id,
			fileName: issue.fileName,
			media,
			status: 'exact',
			candidatePath: pathMatch.path,
			candidate: pathMatch
		};
	}

	const expectedName = media.sourceFileName ?? issue.fileName;
	const expectedSize = media.sourceFileSize ?? media.fileSize;
	const sameName = candidates.filter(
		(candidate) => normalized(candidate.file.name) === normalized(expectedName)
	);
	const sameNameAndSize = sameName.filter((candidate) => candidate.file.size === expectedSize);
	if (sameNameAndSize.length === 1) {
		const candidate = sameNameAndSize[0];
		// SAFETY: length === 1 proves the candidate exists.
		return {
			mediaId: media.id,
			fileName: issue.fileName,
			media,
			status: 'exact',
			candidatePath: candidate!.path,
			candidate: candidate!
		};
	}
	if (sameName.length > 0) {
		return {
			mediaId: media.id,
			fileName: issue.fileName,
			media,
			status: 'conflict',
			candidatePaths: sameName
				.map((candidate) => candidate.path)
				.sort((left, right) => left.localeCompare(right))
		};
	}
	return { mediaId: media.id, fileName: issue.fileName, media, status: 'unmatched' };
}

export function planMediaDirectoryRecovery(
	issues: readonly MediaSourceIssue[],
	media: readonly MediaMetadata[],
	candidates: readonly MediaRecoveryDirectoryFile[],
	directoryName: string
): MediaDirectoryRecoveryPlan {
	const mediaById = new Map(media.map((entry) => [entry.id, entry]));
	const entries = issues.flatMap((issue) => {
		const source = mediaById.get(issue.mediaId);
		return source ? [planEntry(issue, source, candidates)] : [];
	});
	return { directoryName, entries };
}

export async function applyMediaDirectoryRecovery(
	plan: MediaDirectoryRecoveryPlan,
	recover: RecoverMediaSource
): Promise<MediaDirectoryRecoveryResult> {
	const restoredMediaIds: string[] = [];
	const failures: MediaDirectoryRecoveryResult['failures'] = [];
	for (const entry of plan.entries) {
		if (entry.status !== 'exact') continue;
		try {
			await recover(entry.media, entry.candidate.handle, entry.candidatePath);
			restoredMediaIds.push(entry.mediaId);
		} catch (error) {
			failures.push({
				mediaId: entry.mediaId,
				fileName: entry.fileName,
				message: error instanceof Error ? error.message : String(error)
			});
		}
	}
	return { restoredMediaIds, failures };
}
