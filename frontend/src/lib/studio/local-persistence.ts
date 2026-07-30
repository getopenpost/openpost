import {
	blankStudioDocument,
	cloneStudioDocument,
	cloneStudioPage,
	defaultImageAdjustments,
	defaultTransform,
	studioID
} from './document';
import {
	isLocalStudioMediaID,
	localStudioMediaURL,
	registerLocalStudioMedia,
	releaseLocalStudioMedia
} from './local-media-url';
import { m } from '$lib/paraglide/messages';
import type { StockMediaProvenance } from '@openpost/video-project';
import type {
	StudioDocument,
	StudioDocumentResponse,
	StudioLayer,
	StudioMediaItem,
	StudioPreset,
	StudioTemplate
} from './types';

export const STUDIO_RECOVERY_STORE = 'documents';
const GUEST_DESIGN_STORE = 'guest-designs';
const GUEST_MEDIA_STORE = 'guest-media';
const DB_NAME = 'openpost-studio';
const DB_VERSION = 2;
const OPFS_DIRECTORY = 'openpost-studio-media';
const LOCAL_DESIGN_PREFIX = 'local_design_';

export interface LocalStudioDesign {
	id: string;
	revision: number;
	created_at: string;
	updated_at: string;
	document: StudioDocument;
	migrated_to?: string;
}

interface LocalStudioMedia {
	id: string;
	design_id: string;
	name: string;
	mime_type: string;
	size: number;
	width: number;
	height: number;
	created_at: string;
	storage: 'opfs' | 'indexeddb';
	blob?: Blob;
	provenance?: StockMediaProvenance;
}

type StorageManagerWithDirectory = StorageManager & {
	getDirectory?: () => Promise<FileSystemDirectoryHandle>;
};

export function isLocalStudioDesignID(value: string): boolean {
	return value.startsWith(LOCAL_DESIGN_PREFIX);
}

export async function openStudioDatabase(): Promise<IDBDatabase> {
	return await new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(STUDIO_RECOVERY_STORE)) {
				db.createObjectStore(STUDIO_RECOVERY_STORE, { keyPath: 'design_id' });
			}
			if (!db.objectStoreNames.contains(GUEST_DESIGN_STORE)) {
				const designs = db.createObjectStore(GUEST_DESIGN_STORE, { keyPath: 'id' });
				designs.createIndex('updated_at', 'updated_at');
			}
			if (!db.objectStoreNames.contains(GUEST_MEDIA_STORE)) {
				const media = db.createObjectStore(GUEST_MEDIA_STORE, { keyPath: 'id' });
				media.createIndex('design_id', 'design_id');
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () =>
			reject(request.error ?? new Error(m.studio_public_storage_open_failed()));
		request.onblocked = () => reject(new Error(m.studio_public_storage_blocked()));
	});
}

export async function requestGuestStudioPersistence(): Promise<boolean | undefined> {
	if (!navigator.storage?.persist) return undefined;
	try {
		return await navigator.storage.persist();
	} catch {
		return undefined;
	}
}

export async function createGuestStudioDesign(
	preset: StudioPreset,
	title: string
): Promise<StudioDocumentResponse> {
	const now = new Date().toISOString();
	const record: LocalStudioDesign = {
		id: `${LOCAL_DESIGN_PREFIX}${crypto.randomUUID()}`,
		revision: 1,
		created_at: now,
		updated_at: now,
		document: { ...blankStudioDocument(preset), title }
	};
	await putGuestDesign(record);
	return guestDesignResponse(record);
}

export async function createGuestStudioDesignFromTemplate(
	template: StudioTemplate,
	title: string
): Promise<StudioDocumentResponse> {
	const now = new Date().toISOString();
	const document = cloneStudioDocument(template.document);
	document.title = title;
	document.brand_kit_id = undefined;
	document.brand_kit_revision = 0;
	document.pages = document.pages.map((page, index) =>
		cloneStudioPage(page, page.name || `Page ${index + 1}`)
	);
	const record: LocalStudioDesign = {
		id: `${LOCAL_DESIGN_PREFIX}${crypto.randomUUID()}`,
		revision: 1,
		created_at: now,
		updated_at: now,
		document
	};
	await putGuestDesign(record);
	return guestDesignResponse(record);
}

export async function createGuestStudioDesignFromImage(
	file: File,
	title: string
): Promise<StudioDocumentResponse> {
	assertSupportedGuestImage(file);
	const dimensions = await imageDimensions(file);
	const canvasSize = fitSourceSize(dimensions.width, dimensions.height);
	const preset: StudioPreset = {
		key: 'custom',
		name: 'Custom',
		width_px: canvasSize.width,
		height_px: canvasSize.height,
		default_format: file.type === 'image/jpeg' ? 'jpeg' : 'png',
		profiles: []
	};
	const response = await createGuestStudioDesign(preset, title);
	try {
		const media = await storeGuestStudioMedia(response.id, file);
		const document = cloneStudioDocument(response.document);
		const imageLayer: StudioLayer = {
			id: studioID('layer'),
			type: 'image',
			name: file.name.replace(/\.[^.]+$/u, '') || 'Image',
			visible: true,
			locked: false,
			opacity: 1,
			transform: defaultTransform(document.width_px, document.height_px),
			image: {
				media_id: media.id,
				source_width: dimensions.width,
				source_height: dimensions.height,
				fit: 'stretch',
				crop: { x: 0, y: 0, width: 1, height: 1 },
				adjustments: defaultImageAdjustments()
			}
		};
		document.pages[0].layers.push(imageLayer);
		return await saveGuestStudioDesign(response.id, document);
	} catch (cause) {
		await deleteGuestStudioDesign(response.id);
		throw cause;
	}
}

export async function loadGuestStudioDesign(id: string): Promise<StudioDocumentResponse> {
	const record = await getGuestDesign(id);
	if (!record) throw new Error(m.studio_public_design_missing());
	await warmGuestStudioMedia(record.document);
	return guestDesignResponse(record);
}

export async function saveGuestStudioDesign(
	id: string,
	document: StudioDocument
): Promise<StudioDocumentResponse> {
	const record = await getGuestDesign(id);
	if (!record) throw new Error(m.studio_public_design_missing());
	const next: LocalStudioDesign = {
		...record,
		revision: record.revision + 1,
		updated_at: new Date().toISOString(),
		document: cloneStudioDocument(document)
	};
	await putGuestDesign(next);
	return guestDesignResponse(next);
}

export async function listGuestStudioDesigns(limit = 12): Promise<LocalStudioDesign[]> {
	const db = await openStudioDatabase();
	const records = await new Promise<LocalStudioDesign[]>((resolve, reject) => {
		const request = db.transaction(GUEST_DESIGN_STORE).objectStore(GUEST_DESIGN_STORE).getAll();
		request.onsuccess = () => resolve((request.result as LocalStudioDesign[]) ?? []);
		request.onerror = () => reject(request.error);
	});
	db.close();
	const result = records
		.sort((left, right) => right.updated_at.localeCompare(left.updated_at))
		.slice(0, limit);
	await Promise.all(result.map((record) => warmGuestStudioMedia(record.document)));
	return result;
}

export async function deleteGuestStudioDesign(id: string): Promise<void> {
	const media = await listGuestMediaRecords(id);
	const db = await openStudioDatabase();
	await new Promise<void>((resolve, reject) => {
		const transaction = db.transaction([GUEST_DESIGN_STORE, GUEST_MEDIA_STORE], 'readwrite');
		transaction.objectStore(GUEST_DESIGN_STORE).delete(id);
		for (const item of media) transaction.objectStore(GUEST_MEDIA_STORE).delete(item.id);
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => reject(transaction.error);
	});
	db.close();
	await Promise.all(
		media.map(async (item) => {
			releaseLocalStudioMedia(item.id);
			if (item.storage === 'opfs') await removeOPFSFile(item.id);
		})
	);
}

export async function listGuestStudioMedia(
	designID: string,
	search = ''
): Promise<StudioMediaItem[]> {
	const records = await listGuestMediaRecords(designID);
	const query = search.trim().toLocaleLowerCase();
	const filtered = query
		? records.filter((record) => record.name.toLocaleLowerCase().includes(query))
		: records;
	await Promise.all(filtered.map((record) => warmGuestMediaRecord(record)));
	return filtered
		.sort((left, right) => right.created_at.localeCompare(left.created_at))
		.map(guestMediaItem);
}

export async function storeGuestStudioMedia(
	designID: string,
	file: File,
	options: { provenance?: StockMediaProvenance } = {}
): Promise<StudioMediaItem> {
	assertSupportedGuestImage(file);
	const dimensions = await imageDimensions(file);
	const id = `local_media_${crypto.randomUUID()}`;
	const record: LocalStudioMedia = {
		id,
		design_id: designID,
		name: file.name || 'Image',
		mime_type: file.type,
		size: file.size,
		width: dimensions.width,
		height: dimensions.height,
		created_at: new Date().toISOString(),
		storage: 'indexeddb',
		blob: file,
		provenance: options.provenance
	};
	if (await writeOPFSFile(id, file)) {
		record.storage = 'opfs';
		record.blob = undefined;
	}
	const db = await openStudioDatabase();
	try {
		await new Promise<void>((resolve, reject) => {
			const transaction = db.transaction(GUEST_MEDIA_STORE, 'readwrite');
			transaction.objectStore(GUEST_MEDIA_STORE).put(record);
			transaction.oncomplete = () => resolve();
			transaction.onerror = () => reject(transaction.error);
		});
	} catch (cause) {
		if (record.storage === 'opfs') await removeOPFSFile(id);
		throw cause;
	} finally {
		db.close();
	}
	registerLocalStudioMedia(id, file);
	return guestMediaItem(record);
}

export async function getGuestStudioMediaBlob(mediaID: string): Promise<Blob> {
	const record = await getGuestMediaRecord(mediaID);
	if (!record) throw new Error(m.studio_public_image_missing());
	const blob = await guestMediaBlob(record);
	if (!blob) throw new Error(m.studio_public_image_missing());
	if (!localStudioMediaURL(mediaID)) registerLocalStudioMedia(mediaID, blob);
	return blob;
}

export async function getGuestStudioMediaForMigration(
	mediaID: string
): Promise<{ blob: Blob; name: string; mimeType: string; provenance?: StockMediaProvenance }> {
	const record = await getGuestMediaRecord(mediaID);
	if (!record) throw new Error(m.studio_public_image_missing());
	return {
		blob: await getGuestStudioMediaBlob(mediaID),
		name: record.name,
		mimeType: record.mime_type,
		provenance: record.provenance
	};
}

export async function guestStudioMigrationTarget(id: string): Promise<string> {
	return (await getGuestDesign(id))?.migrated_to ?? '';
}

export async function markGuestStudioDesignMigrated(
	id: string,
	workspaceDesignID: string
): Promise<void> {
	const record = await getGuestDesign(id);
	if (!record) return;
	await putGuestDesign({ ...record, migrated_to: workspaceDesignID });
}

export function guestStudioMediaIDs(document: StudioDocument): string[] {
	const ids = new Set<string>();
	for (const page of document.pages) {
		const backgroundID =
			page.background?.type === 'image' ? page.background.image?.media_id : undefined;
		if (backgroundID && isLocalStudioMediaID(backgroundID)) ids.add(backgroundID);
		for (const layer of page.layers) {
			if (layer.image?.media_id && isLocalStudioMediaID(layer.image.media_id)) {
				ids.add(layer.image.media_id);
			}
			if (layer.text?.font_asset_id && isLocalStudioMediaID(layer.text.font_asset_id)) {
				ids.add(layer.text.font_asset_id);
			}
		}
	}
	return [...ids];
}

export function replaceGuestStudioMediaIDs(
	document: StudioDocument,
	replacements: ReadonlyMap<string, string>
): StudioDocument {
	const next = cloneStudioDocument(document);
	for (const page of next.pages) {
		if (page.background?.type === 'image' && page.background.image) {
			page.background.image.media_id =
				replacements.get(page.background.image.media_id) ?? page.background.image.media_id;
		}
		page.preview_media_id = undefined;
		page.latest_export_media_id = undefined;
		for (const layer of page.layers) {
			if (layer.image) {
				layer.image.media_id = replacements.get(layer.image.media_id) ?? layer.image.media_id;
			}
			if (layer.text?.font_asset_id) {
				layer.text.font_asset_id =
					replacements.get(layer.text.font_asset_id) ?? layer.text.font_asset_id;
			}
		}
	}
	return next;
}

async function putGuestDesign(record: LocalStudioDesign): Promise<void> {
	const db = await openStudioDatabase();
	await new Promise<void>((resolve, reject) => {
		const transaction = db.transaction(GUEST_DESIGN_STORE, 'readwrite');
		transaction.objectStore(GUEST_DESIGN_STORE).put(record);
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => reject(transaction.error);
	});
	db.close();
}

async function getGuestDesign(id: string): Promise<LocalStudioDesign | null> {
	const db = await openStudioDatabase();
	const record = await new Promise<LocalStudioDesign | undefined>((resolve, reject) => {
		const request = db.transaction(GUEST_DESIGN_STORE).objectStore(GUEST_DESIGN_STORE).get(id);
		request.onsuccess = () => resolve(request.result as LocalStudioDesign | undefined);
		request.onerror = () => reject(request.error);
	});
	db.close();
	return record ?? null;
}

async function listGuestMediaRecords(designID: string): Promise<LocalStudioMedia[]> {
	const db = await openStudioDatabase();
	const records = await new Promise<LocalStudioMedia[]>((resolve, reject) => {
		const index = db
			.transaction(GUEST_MEDIA_STORE)
			.objectStore(GUEST_MEDIA_STORE)
			.index('design_id');
		const request = index.getAll(designID);
		request.onsuccess = () => resolve((request.result as LocalStudioMedia[]) ?? []);
		request.onerror = () => reject(request.error);
	});
	db.close();
	return records;
}

async function getGuestMediaRecord(id: string): Promise<LocalStudioMedia | null> {
	const db = await openStudioDatabase();
	const record = await new Promise<LocalStudioMedia | undefined>((resolve, reject) => {
		const request = db.transaction(GUEST_MEDIA_STORE).objectStore(GUEST_MEDIA_STORE).get(id);
		request.onsuccess = () => resolve(request.result as LocalStudioMedia | undefined);
		request.onerror = () => reject(request.error);
	});
	db.close();
	return record ?? null;
}

async function warmGuestStudioMedia(document: StudioDocument): Promise<void> {
	await Promise.all(
		guestStudioMediaIDs(document).map(async (mediaID) => {
			if (localStudioMediaURL(mediaID)) return;
			const record = await getGuestMediaRecord(mediaID);
			if (record) await warmGuestMediaRecord(record);
		})
	);
}

async function warmGuestMediaRecord(record: LocalStudioMedia): Promise<void> {
	if (localStudioMediaURL(record.id)) return;
	const blob = await guestMediaBlob(record);
	if (blob) registerLocalStudioMedia(record.id, blob);
}

async function guestMediaBlob(record: LocalStudioMedia): Promise<Blob | null> {
	if (record.storage === 'indexeddb') return record.blob ?? null;
	return await readOPFSFile(record.id);
}

function guestDesignResponse(record: LocalStudioDesign): StudioDocumentResponse {
	return {
		id: record.id,
		workspace_id: '',
		created_by_id: '',
		revision: record.revision,
		can_edit: true,
		created_at: record.created_at,
		updated_at: record.updated_at,
		document: cloneStudioDocument(record.document)
	};
}

function guestMediaItem(record: LocalStudioMedia): StudioMediaItem {
	const path = `/media/${record.id}`;
	return {
		id: record.id,
		workspace_id: '',
		mime_type: record.mime_type,
		size: record.size,
		original_filename: record.name,
		width: record.width,
		height: record.height,
		alt_text: record.name,
		is_favorite: false,
		created_at: record.created_at,
		url: path,
		thumbnail_url: path,
		usage_count: 0,
		can_delete: false,
		processing_status: 'ready',
		processing_progress: 100,
		analysis_status: 'not_requested',
		duration_ms: 0,
		frame_rate: 0,
		source: 'local',
		asset_kind: 'library',
		provenance: record.provenance,
		collections: [],
		tags: []
	};
}

function assertSupportedGuestImage(file: File): void {
	if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
		throw new Error(m.studio_public_image_type());
	}
}

async function imageDimensions(blob: Blob): Promise<{ width: number; height: number }> {
	try {
		const bitmap = await createImageBitmap(blob);
		const dimensions = { width: bitmap.width, height: bitmap.height };
		bitmap.close();
		if (dimensions.width < 1 || dimensions.height < 1) throw new Error();
		return dimensions;
	} catch {
		throw new Error(m.studio_public_image_open_failed());
	}
}

function fitSourceSize(width: number, height: number): { width: number; height: number } {
	const scale = Math.min(1, 4096 / width, 4096 / height, Math.sqrt(25_000_000 / (width * height)));
	return {
		width: Math.max(64, Math.round(width * scale)),
		height: Math.max(64, Math.round(height * scale))
	};
}

async function opfsDirectory(create: boolean): Promise<FileSystemDirectoryHandle | null> {
	const storage = navigator.storage as StorageManagerWithDirectory | undefined;
	if (!storage?.getDirectory) return null;
	try {
		const root = await storage.getDirectory();
		return await root.getDirectoryHandle(OPFS_DIRECTORY, { create });
	} catch {
		return null;
	}
}

async function writeOPFSFile(id: string, blob: Blob): Promise<boolean> {
	const directory = await opfsDirectory(true);
	if (!directory) return false;
	try {
		const handle = await directory.getFileHandle(id, { create: true });
		const writable = await handle.createWritable();
		await writable.write(blob);
		await writable.close();
		return true;
	} catch {
		return false;
	}
}

async function readOPFSFile(id: string): Promise<File | null> {
	const directory = await opfsDirectory(false);
	if (!directory) return null;
	try {
		return await (await directory.getFileHandle(id)).getFile();
	} catch {
		return null;
	}
}

async function removeOPFSFile(id: string): Promise<void> {
	const directory = await opfsDirectory(false);
	if (!directory) return;
	try {
		await directory.removeEntry(id);
	} catch {
		// The browser may already have evicted or cleared the file.
	}
}
