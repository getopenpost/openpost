import { z } from 'zod';
import { applyAPIRequestHeaders } from '$lib/api/client';

const BACKUP_API = '/api/v1/admin/backup';

export const BACKUP_EXPORT_URL = `${BACKUP_API}/export`;
export const RESTORE_CONFIRMATION_WORD = 'restore';

const backupSummarySchema = z.object({
	created_at: z.string(),
	app_version: z.string(),
	database_bytes: z.number(),
	media_files: z.number(),
	media_bytes: z.number(),
	schema_version: z.number(),
	staged_at: z.string().optional()
});

const backupStatusSchema = z.object({
	supported: z.boolean(),
	unsupported_reason: z.enum(['database', 'storage', 'process_role']).optional(),
	pending: backupSummarySchema.optional(),
	restore_points: z.array(
		z.object({
			name: z.string(),
			created_at: z.string(),
			bytes: z.number()
		})
	)
});

const backupErrorCodeSchema = z.enum([
	'invalid_backup',
	'incompatible_backup',
	'backup_too_new',
	'key_mismatch',
	'busy',
	'nothing_staged',
	'restart_unavailable',
	'confirmation_required',
	'stage_failed',
	'unknown'
]);

const errorBodySchema = z.object({
	error: z.string().optional(),
	code: backupErrorCodeSchema.optional()
});

export type BackupSummary = z.infer<typeof backupSummarySchema>;
export type BackupStatus = z.infer<typeof backupStatusSchema>;
export type BackupErrorCode = z.infer<typeof backupErrorCodeSchema>;

export class InstanceBackupError extends Error {
	readonly code: BackupErrorCode;
	readonly status: number;

	constructor(code: BackupErrorCode, status: number, message: string) {
		super(message);
		this.name = 'InstanceBackupError';
		this.code = code;
		this.status = status;
	}
}

function parseJSON(text: string) {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

function errorFromResponse(status: number, text: string): InstanceBackupError {
	const parsed = errorBodySchema.safeParse(parseJSON(text));
	const body = parsed.success ? parsed.data : {};
	return new InstanceBackupError(body.code ?? 'unknown', status, body.error ?? `HTTP ${status}`);
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
	const headers = applyAPIRequestHeaders(new Headers(init.headers));
	const response = await fetch(`${BACKUP_API}${path}`, {
		...init,
		headers,
		credentials: 'include'
	});
	if (!response.ok) throw errorFromResponse(response.status, await response.text());
	return response;
}

export async function fetchBackupStatus(signal?: AbortSignal): Promise<BackupStatus> {
	const response = await request('', { signal });
	return backupStatusSchema.parse(await response.json());
}

export function uploadBackup(
	file: File,
	onProgress: (fraction: number) => void,
	signal: AbortSignal
): Promise<BackupSummary> {
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open('POST', `${BACKUP_API}/restore/upload`);
		xhr.withCredentials = true;
		xhr.setRequestHeader('Content-Type', 'application/zip');
		for (const [name, value] of applyAPIRequestHeaders(new Headers())) {
			xhr.setRequestHeader(name, value);
		}
		const abort = () => xhr.abort();
		signal.addEventListener('abort', abort, { once: true });
		const cleanup = () => signal.removeEventListener('abort', abort);
		xhr.upload.onprogress = (event) => {
			if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
		};
		xhr.onload = () => {
			cleanup();
			if (xhr.status < 200 || xhr.status >= 300) {
				reject(errorFromResponse(xhr.status, xhr.responseText));
				return;
			}
			const parsed = backupSummarySchema.safeParse(parseJSON(xhr.responseText));
			if (!parsed.success) {
				reject(new InstanceBackupError('unknown', xhr.status, 'unexpected response'));
				return;
			}
			resolve(parsed.data);
		};
		xhr.onerror = () => {
			cleanup();
			reject(new InstanceBackupError('unknown', 0, 'network error'));
		};
		xhr.onabort = () => {
			cleanup();
			reject(new DOMException('Upload cancelled', 'AbortError'));
		};
		xhr.send(file);
	});
}

export async function confirmRestore(): Promise<void> {
	await request('/restore/confirm', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ confirm: RESTORE_CONFIRMATION_WORD })
	});
}

export async function cancelRestore(): Promise<void> {
	await request('/restore/pending', { method: 'DELETE' });
}

export async function deleteRestorePoint(name: string): Promise<void> {
	await request(`/restore-points/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

async function serverIsReady(): Promise<boolean> {
	try {
		const response = await fetch('/api/v1/ready', { cache: 'no-store' });
		return response.ok;
	} catch {
		return false;
	}
}

export async function waitForRestart(
	signal: AbortSignal,
	{ intervalMs = 2000, timeoutMs = 180_000 } = {}
): Promise<boolean> {
	const startedAt = Date.now();
	const deadline = startedAt + timeoutMs;
	let wentDown = false;
	await new Promise((resolve) => setTimeout(resolve, 3000));
	while (Date.now() < deadline && !signal.aborted) {
		const ready = await serverIsReady();
		if (!ready) wentDown = true;
		if (ready && (wentDown || Date.now() - startedAt > 20_000)) return true;
		await new Promise((resolve) => setTimeout(resolve, intervalMs));
	}
	return false;
}
