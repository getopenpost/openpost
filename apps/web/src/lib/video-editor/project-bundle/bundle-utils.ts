import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';
import { z } from 'zod';
import { sanitizeWorkspaceFileName } from '../workspace-fs/paths';
import {
	PROJECT_BUNDLE_COVER_PATH,
	PROJECT_BUNDLE_EXTENSION,
	PROJECT_BUNDLE_MANIFEST_PATH,
	PROJECT_BUNDLE_SNAPSHOT_PATH,
	PROJECT_BUNDLE_VERSION,
	type ProjectBundleManifest
} from './bundle-types';
import type { JsonValue } from './snapshot-types';

const MAX_BUNDLE_MEDIA = 100_000;
const HASH_CHUNK_BYTES = 256 * 1024;
const maxFileSize = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const relativePathSchema = z
	.string()
	.min(1)
	.max(4_096)
	.refine((path) => isSafeBundlePath(path), 'Unsafe bundle path');

const fileEntrySchema = z.object({
	relativePath: relativePathSchema,
	fileSize: maxFileSize,
	sha256: hashSchema
});

const mediaEntrySchema = fileEntrySchema.extend({
	originalId: z.string().min(1).max(4_096),
	fileName: z.string().min(1).max(4_096),
	mimeType: z.string().min(1).max(4_096),
	metadata: z.looseObject({
		duration: z.number().finite().nonnegative(),
		width: z.number().finite().nonnegative(),
		height: z.number().finite().nonnegative(),
		fps: z.number().finite().nonnegative(),
		codec: z.string().max(4_096),
		bitrate: z.number().finite().nonnegative(),
		tags: z.array(z.string().max(4_096)).max(10_000)
	})
});

const manifestSchema = z.object({
	version: z.literal(PROJECT_BUNDLE_VERSION),
	createdAt: z.iso.datetime(),
	editorVersion: z.string().max(4_096),
	projectId: z.string().min(1).max(4_096),
	projectName: z.string().min(1).max(4_096),
	project: fileEntrySchema,
	media: z.array(mediaEntrySchema).max(MAX_BUNDLE_MEDIA),
	cover: fileEntrySchema.optional(),
	checksum: hashSchema
});

export function createSha256() {
	return sha256.create();
}

export function sha256Hex(bytes: Uint8Array): string {
	return bytesToHex(sha256(bytes));
}

export function bundleAbortError(): DOMException {
	return new DOMException('Project bundle operation canceled.', 'AbortError');
}

export function throwIfBundleAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : bundleAbortError();
}

export async function hashBlob(
	blob: Blob,
	onChunk?: (bytes: number) => void,
	signal?: AbortSignal
): Promise<string> {
	const hash = createSha256();
	for (let offset = 0; offset < blob.size; offset += HASH_CHUNK_BYTES) {
		throwIfBundleAborted(signal);
		const end = Math.min(blob.size, offset + HASH_CHUNK_BYTES);
		const bytes = new Uint8Array(await blob.slice(offset, end).arrayBuffer());
		throwIfBundleAborted(signal);
		hash.update(bytes);
		onChunk?.(bytes.byteLength);
	}
	throwIfBundleAborted(signal);
	return bytesToHex(hash.digest());
}

export function computeBundleManifestChecksum(manifest: ProjectBundleManifest): string {
	const { checksum: _checksum, ...unsigned } = manifest;
	// SAFETY: JSON serialization removes undefined optional fields and leaves only JsonValue data.
	const jsonValue = JSON.parse(JSON.stringify(unsigned)) as JsonValue;
	return sha256Hex(new TextEncoder().encode(canonicalJson(jsonValue)));
}

function canonicalJson(value: JsonValue): string {
	if (value === null || typeof value !== 'object') return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	return `{${Object.keys(value)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`)
		.join(',')}}`;
}

export function validateBundleManifest(
	value: JsonValue | ProjectBundleManifest
): ProjectBundleManifest {
	const result = manifestSchema.safeParse(value);
	if (!result.success) {
		throw new Error(
			result.error.issues
				.map((issue) => `${issue.path.join('.') || 'manifest'}: ${issue.message}`)
				.join('\n')
		);
	}
	// SAFETY: Zod checked every manifest field before this domain cast.
	const manifest = result.data as ProjectBundleManifest;
	if (computeBundleManifestChecksum(manifest) !== manifest.checksum) {
		throw new Error('Bundle manifest checksum does not match.');
	}
	if (manifest.project.relativePath !== PROJECT_BUNDLE_SNAPSHOT_PATH) {
		throw new Error(`Bundle project must be stored at ${PROJECT_BUNDLE_SNAPSHOT_PATH}.`);
	}
	if (manifest.cover && manifest.cover.relativePath !== PROJECT_BUNDLE_COVER_PATH) {
		throw new Error(`Bundle cover must be stored at ${PROJECT_BUNDLE_COVER_PATH}.`);
	}
	const originalIds = new Set<string>();
	const pathFiles = new Map<string, { hash: string; size: number }>();
	for (const entry of manifest.media) {
		if (
			!entry.relativePath.startsWith(`media/${entry.sha256}/`) ||
			entry.relativePath === PROJECT_BUNDLE_MANIFEST_PATH
		) {
			throw new Error(`Bundle media path does not match its hash: ${entry.relativePath}`);
		}
		if (originalIds.has(entry.originalId)) {
			throw new Error(`Bundle repeats media id: ${entry.originalId}`);
		}
		originalIds.add(entry.originalId);
		const knownFile = pathFiles.get(entry.relativePath);
		if (knownFile && (knownFile.hash !== entry.sha256 || knownFile.size !== entry.fileSize)) {
			throw new Error(`Bundle path has conflicting file metadata: ${entry.relativePath}`);
		}
		pathFiles.set(entry.relativePath, { hash: entry.sha256, size: entry.fileSize });
	}
	return manifest;
}

export function isSafeBundlePath(path: string): boolean {
	if (!path || path.startsWith('/') || path.includes('\\') || path.includes('\0')) return false;
	const segments = path.split('/');
	return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

export function bundleMediaPath(hash: string, fileName: string): string {
	const safeName = sanitizeWorkspaceFileName(fileName).replace(/^[. ]+/g, '');
	return `media/${hash}/${safeName || 'media'}`;
}

export function sanitizeBundleFileName(projectName: string): string {
	const safe = sanitizeWorkspaceFileName(projectName).replace(/\.+$/g, '').slice(0, 180);
	return `${safe || 'project'}${PROJECT_BUNDLE_EXTENSION}`;
}
