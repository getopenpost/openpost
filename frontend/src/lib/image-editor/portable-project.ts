import { strFromU8, strToU8, Unzip, UnzipInflate, zipSync } from 'fflate';
import {
	cloneImageEditorDocument,
	cloneImageEditorPage,
	migrateImageEditorDocument
} from './document';
import type { ImageEditorDocument } from './types';

export const IMAGE_EDITOR_PROJECT_MIME = 'application/x-openpost-image-project+zip';
export const IMAGE_EDITOR_PROJECT_EXTENSION = '.openpost-image';
const PROJECT_FORMAT = 'openpost-image-project';
const PROJECT_VERSION = 1;
const MAX_PROJECT_ARCHIVE_BYTES = 128 * 1024 * 1024;
const MAX_PROJECT_MEDIA_BYTES = 50 * 1024 * 1024;
const MAX_PROJECT_TOTAL_MEDIA_BYTES = 200 * 1024 * 1024;
const MAX_PROJECT_MEDIA_ITEMS = 500;

export interface ImageEditorProjectMediaSource {
	name: string;
	mimeType: string;
	blob: Blob;
}

export interface ImageEditorProjectMediaEntry {
	id: string;
	path: string;
	name: string;
	mime_type: string;
	size: number;
}

interface ImageEditorProjectManifest {
	format: typeof PROJECT_FORMAT;
	version: typeof PROJECT_VERSION;
	exported_at: string;
	document: ImageEditorDocument;
	media: ImageEditorProjectMediaEntry[];
}

export interface ParsedImageEditorProject {
	document: ImageEditorDocument;
	media: Array<ImageEditorProjectMediaEntry & { file: File }>;
}

export function imageEditorPortableMediaIDs(document: ImageEditorDocument): string[] {
	const ids = new Set<string>();
	for (const page of document.pages) {
		if (page.background?.type === 'image' && page.background.image?.media_id) {
			ids.add(page.background.image.media_id);
		}
		for (const layer of page.layers) {
			if (layer.image?.media_id) ids.add(layer.image.media_id);
			if (layer.text?.font_asset_id) ids.add(layer.text.font_asset_id);
		}
	}
	return [...ids];
}

export async function createImageEditorProjectArchive(
	document: ImageEditorDocument,
	loadMedia: (id: string) => Promise<ImageEditorProjectMediaSource>
): Promise<Blob> {
	const projectDocument = cloneImageEditorDocument(document);
	projectDocument.brand_kit_id = undefined;
	projectDocument.brand_kit_revision = 0;
	for (const page of projectDocument.pages) {
		page.preview_media_id = undefined;
		page.latest_export_media_id = undefined;
	}
	const files: Record<string, Uint8Array> = {};
	const media: ImageEditorProjectMediaEntry[] = [];
	let totalBytes = 0;
	for (const [index, id] of imageEditorPortableMediaIDs(projectDocument).entries()) {
		const source = await loadMedia(id);
		if (source.blob.size > MAX_PROJECT_MEDIA_BYTES) {
			throw new Error(`Project media ${source.name} exceeds the 50 MB portable-project limit.`);
		}
		totalBytes += source.blob.size;
		if (totalBytes > MAX_PROJECT_TOTAL_MEDIA_BYTES) {
			throw new Error('Project media exceeds the 200 MB portable-project limit.');
		}
		const path = `media/${String(index + 1).padStart(3, '0')}-${safeProjectName(source.name)}`;
		files[path] = new Uint8Array(await source.blob.arrayBuffer());
		media.push({
			id,
			path,
			name: safeProjectName(source.name),
			mime_type: source.mimeType || source.blob.type || 'application/octet-stream',
			size: source.blob.size
		});
	}
	const manifest: ImageEditorProjectManifest = {
		format: PROJECT_FORMAT,
		version: PROJECT_VERSION,
		exported_at: new Date().toISOString(),
		document: projectDocument,
		media
	};
	files['project.json'] = strToU8(JSON.stringify(manifest));
	const archive = zipSync(files, { level: 6 });
	if (archive.byteLength > MAX_PROJECT_ARCHIVE_BYTES) {
		throw new Error('The compressed project exceeds the 128 MB portable-project limit.');
	}
	return new Blob([Uint8Array.from(archive).buffer], { type: IMAGE_EDITOR_PROJECT_MIME });
}

export async function parseImageEditorProjectArchive(
	file: File
): Promise<ParsedImageEditorProject> {
	if (file.size <= 0 || file.size > MAX_PROJECT_ARCHIVE_BYTES) {
		throw new Error('The project file must be between 1 byte and 128 MB.');
	}
	let archive: Record<string, Uint8Array>;
	try {
		archive = unzipProjectSafely(new Uint8Array(await file.arrayBuffer()));
		if (Object.keys(archive).length === 0) throw new Error('Empty archive');
	} catch {
		throw new Error('The project archive is damaged or is not an OpenPost Image Editor project.');
	}
	const projectJSON = archive['project.json'];
	if (!projectJSON || projectJSON.byteLength > 10 * 1024 * 1024) {
		throw new Error('The project manifest is missing or too large.');
	}
	let manifest: ImageEditorProjectManifest;
	try {
		manifest = JSON.parse(strFromU8(projectJSON)) as ImageEditorProjectManifest;
	} catch {
		throw new Error('The project manifest is not valid JSON.');
	}
	if (manifest.format !== PROJECT_FORMAT || manifest.version !== PROJECT_VERSION) {
		throw new Error('This OpenPost Image Editor project version is not supported.');
	}
	if (!Array.isArray(manifest.media) || manifest.media.length > MAX_PROJECT_MEDIA_ITEMS) {
		throw new Error('The project media manifest is invalid.');
	}
	const migrated = migrateImageEditorDocument(manifest.document);
	if (!migrated.document || migrated.readOnly) {
		throw new Error(migrated.error || 'The project document is invalid.');
	}
	const expectedIDs = new Set(imageEditorPortableMediaIDs(migrated.document));
	const seenIDs = new Set<string>();
	const seenPaths = new Set<string>();
	let totalBytes = 0;
	const media = manifest.media.map((entry) => {
		if (
			!entry ||
			typeof entry.id !== 'string' ||
			!expectedIDs.has(entry.id) ||
			seenIDs.has(entry.id) ||
			typeof entry.path !== 'string' ||
			!/^media\/[A-Za-z0-9._-]+$/u.test(entry.path) ||
			seenPaths.has(entry.path) ||
			typeof entry.name !== 'string' ||
			typeof entry.mime_type !== 'string'
		) {
			throw new Error('The project media manifest contains an unsafe or duplicate entry.');
		}
		const bytes = archive[entry.path];
		if (!bytes || bytes.byteLength !== entry.size || bytes.byteLength > MAX_PROJECT_MEDIA_BYTES) {
			throw new Error(`Project media ${entry.name || entry.id} is missing or has an invalid size.`);
		}
		totalBytes += bytes.byteLength;
		if (totalBytes > MAX_PROJECT_TOTAL_MEDIA_BYTES) {
			throw new Error('Project media exceeds the 200 MB portable-project limit.');
		}
		seenIDs.add(entry.id);
		seenPaths.add(entry.path);
		return {
			...entry,
			file: new File([Uint8Array.from(bytes).buffer], safeProjectName(entry.name), {
				type: entry.mime_type
			})
		};
	});
	if (seenIDs.size !== expectedIDs.size) {
		throw new Error('The project is missing one or more referenced media files.');
	}
	for (const path of Object.keys(archive)) {
		if (path === 'project.json' || seenPaths.has(path)) continue;
		throw new Error('The project archive contains an unexpected file.');
	}
	const importedDocument = cloneImageEditorDocument(migrated.document);
	importedDocument.pages = importedDocument.pages.map((page, index) =>
		cloneImageEditorPage(page, page.name || `Page ${index + 1}`)
	);
	return { document: importedDocument, media };
}

function unzipProjectSafely(compressed: Uint8Array): Record<string, Uint8Array> {
	const archive: Record<string, Uint8Array> = {};
	let totalOutputBytes = 0;
	let entryCount = 0;
	const unzip = new Unzip((entry) => {
		entryCount++;
		if (entryCount > MAX_PROJECT_MEDIA_ITEMS + 1) {
			throw new Error('The project contains too many files.');
		}
		const maximum = entry.name === 'project.json' ? 10 * 1024 * 1024 : MAX_PROJECT_MEDIA_BYTES;
		if (entry.originalSize !== undefined && entry.originalSize > maximum) {
			throw new Error('A project entry exceeds its safe extraction limit.');
		}
		const chunks: Uint8Array[] = [];
		let entryBytes = 0;
		entry.ondata = (error, data, final) => {
			if (error) throw error;
			entryBytes += data.byteLength;
			totalOutputBytes += data.byteLength;
			if (
				entryBytes > maximum ||
				totalOutputBytes > MAX_PROJECT_TOTAL_MEDIA_BYTES + 10 * 1024 * 1024
			) {
				entry.terminate();
				throw new Error('The project exceeds its safe extraction limit.');
			}
			chunks.push(data);
			if (!final) return;
			const output = new Uint8Array(entryBytes);
			let offset = 0;
			for (const chunk of chunks) {
				output.set(chunk, offset);
				offset += chunk.byteLength;
			}
			archive[entry.name] = output;
		};
		entry.start();
	});
	unzip.register(UnzipInflate);
	unzip.push(compressed, true);
	return archive;
}

export function safeImageEditorProjectFilename(title: string): string {
	const base = title
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/gu, '')
		.replace(/[^A-Za-z0-9._-]+/gu, '-')
		.replace(/^-+|-+$/gu, '')
		.slice(0, 100);
	return `${base || 'openpost-design'}${IMAGE_EDITOR_PROJECT_EXTENSION}`;
}

function safeProjectName(name: string): string {
	return (
		name
			.normalize('NFKC')
			.replace(/[^A-Za-z0-9._-]+/gu, '-')
			.replace(/^\.+/u, '')
			.slice(0, 120) || 'media'
	);
}
