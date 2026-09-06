import { sanitizeWorkspaceFileName } from '../workspace-fs/paths';
import { importFile, type ImportOptions } from './import.svelte';

export const MAX_REMOTE_MEDIA_BYTES = 2 * 1024 * 1024 * 1024;

type RemoteMediaFetcher = (input: URL, init: RequestInit) => Promise<Response>;

const REMOTE_MIME_EXTENSIONS = new Map([
	['audio/mpeg', '.mp3'],
	['audio/wav', '.wav'],
	['image/gif', '.gif'],
	['image/jpeg', '.jpg'],
	['image/png', '.png'],
	['image/svg+xml', '.svg'],
	['image/webp', '.webp'],
	['video/mp4', '.mp4'],
	['video/quicktime', '.mov'],
	['video/webm', '.webm']
]);

function parseImportUrl(value: string): URL {
	let url: URL;
	try {
		url = new URL(value.trim());
	} catch {
		throw new Error('Enter a complete HTTP or HTTPS URL.');
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error('Only HTTP and HTTPS media URLs are supported.');
	}
	if (url.username || url.password) {
		throw new Error('Media URLs cannot include a username or password.');
	}
	return url;
}

function normalizedMimeType(value: string | null): string {
	return value?.split(';')[0]?.trim().toLowerCase() ?? '';
}

function isPageMimeType(value: string): boolean {
	return value === 'text/html' || value === 'application/xhtml+xml';
}

function decoded(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

function contentDispositionFileName(value: string | null): string | null {
	if (!value) return null;
	const encoded = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(value)?.[1]?.trim();
	if (encoded) return decoded(encoded.replace(/^"|"$/g, ''));
	const quoted = /filename\s*=\s*"([^"]+)"/i.exec(value)?.[1]?.trim();
	if (quoted) return quoted;
	return /filename\s*=\s*([^;]+)/i.exec(value)?.[1]?.trim() ?? null;
}

function extensionForMimeType(mimeType: string): string {
	return REMOTE_MIME_EXTENSIONS.get(mimeType) ?? '';
}

function remoteFileName(
	requestedUrl: URL,
	responseUrl: string,
	contentDisposition: string | null,
	mimeType: string
): string {
	const fromHeader = contentDispositionFileName(contentDisposition);
	let fromPath = '';
	try {
		const finalUrl = responseUrl ? new URL(responseUrl) : requestedUrl;
		fromPath = decoded(finalUrl.pathname.split('/').filter(Boolean).at(-1) ?? '');
	} catch {
		fromPath = decoded(requestedUrl.pathname.split('/').filter(Boolean).at(-1) ?? '');
	}
	const candidate = sanitizeWorkspaceFileName(fromHeader || fromPath || 'remote-media');
	if (/\.[a-z0-9]{1,8}$/i.test(candidate)) return candidate;
	return `${candidate}${extensionForMimeType(mimeType)}`;
}

export async function fetchRemoteMediaFile(
	value: string,
	fetcher: RemoteMediaFetcher = fetch
): Promise<File> {
	const url = parseImportUrl(value);
	let response: Response;
	try {
		response = await fetcher(url, {
			credentials: 'omit',
			referrerPolicy: 'no-referrer',
			redirect: 'follow'
		});
	} catch {
		throw new Error(
			'The file could not be downloaded. The server may block browser downloads or require sign-in.'
		);
	}
	if (!response.ok) {
		throw new Error(`The media download failed with HTTP ${response.status}.`);
	}
	const mimeType = normalizedMimeType(response.headers.get('content-type'));
	if (isPageMimeType(mimeType)) {
		throw new Error('That URL opens a web page. Paste a direct media file URL.');
	}
	const declaredSize = Number(response.headers.get('content-length') ?? 0);
	if (Number.isFinite(declaredSize) && declaredSize > MAX_REMOTE_MEDIA_BYTES) {
		throw new Error('The remote file is larger than the 2 GB import limit.');
	}
	const blob = await response.blob();
	if (blob.size === 0) throw new Error('The downloaded file is empty.');
	if (blob.size > MAX_REMOTE_MEDIA_BYTES) {
		throw new Error('The remote file is larger than the 2 GB import limit.');
	}
	const resolvedMimeType = normalizedMimeType(blob.type) || mimeType;
	return new File(
		[blob],
		remoteFileName(
			url,
			response.url,
			response.headers.get('content-disposition'),
			resolvedMimeType
		),
		{ type: resolvedMimeType, lastModified: Date.now() }
	);
}

export async function importMediaFromUrl(value: string, options: ImportOptions): Promise<string> {
	const file = await fetchRemoteMediaFile(value);
	// SAFETY: importFile only reads name, kind, and getFile from this copy-only handle.
	const handle = {
		kind: 'file',
		name: file.name,
		getFile: async () => file
	} as FileSystemFileHandle;
	return importFile(handle, { ...options, storageMode: 'copy' });
}
