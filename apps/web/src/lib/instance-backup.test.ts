import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	InstanceBackupError,
	confirmRestore,
	deleteRestorePoint,
	fetchBackupStatus,
	uploadBackup,
	waitForRestart,
	type BackupStatus
} from './instance-backup';

type ResponsePayload =
	| Partial<BackupStatus>
	| { error: string; code: string }
	| { restarting: true };

function respond(status: number, body: ResponsePayload) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

describe('instance backup client', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it('parses the backup status', async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			respond(200, {
				supported: true,
				pending: {
					created_at: '2026-10-23T10:00:00Z',
					app_version: '7.26.0',
					database_bytes: 10,
					media_files: 2,
					media_bytes: 20,
					schema_version: 191
				},
				restore_points: [
					{ name: 'pre-restore-20261023T100000Z', created_at: '2026-10-23T10:00:00Z', bytes: 5 }
				]
			})
		);
		vi.stubGlobal('fetch', fetchMock);

		const status = await fetchBackupStatus();

		expect(status.supported).toBe(true);
		expect(status.pending?.media_files).toBe(2);
		expect(status.restore_points).toHaveLength(1);
		expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/admin/backup');
		expect(fetchMock.mock.calls[0][1].credentials).toBe('include');
	});

	it('reports an unsupported setup without pending data', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValue(
					respond(200, { supported: false, unsupported_reason: 'storage', restore_points: [] })
				)
		);

		const status = await fetchBackupStatus();

		expect(status.supported).toBe(false);
		expect(status.unsupported_reason).toBe('storage');
		expect(status.pending).toBeUndefined();
	});

	it('turns an error response into a typed error', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(respond(422, { error: 'different key', code: 'key_mismatch' }))
		);

		await expect(fetchBackupStatus()).rejects.toMatchObject({
			name: 'InstanceBackupError',
			code: 'key_mismatch',
			status: 422
		});
	});

	it('falls back to an unknown error for an unreadable response', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>', { status: 502 })));

		const failure = await fetchBackupStatus().catch((cause) => cause);

		expect(failure).toBeInstanceOf(InstanceBackupError);
		expect(failure.code).toBe('unknown');
		expect(failure.status).toBe(502);
	});

	it('sends the confirmation word when restoring', async () => {
		const fetchMock = vi.fn().mockResolvedValue(respond(202, { restarting: true }));
		vi.stubGlobal('fetch', fetchMock);

		await confirmRestore();

		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('/api/v1/admin/backup/restore/confirm');
		expect(init.method).toBe('POST');
		expect(JSON.parse(init.body)).toEqual({ confirm: 'restore' });
	});

	it('encodes restore point names in the request path', async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
		vi.stubGlobal('fetch', fetchMock);

		await deleteRestorePoint('pre-restore/point name?#');

		expect(fetchMock.mock.calls[0][0]).toBe(
			'/api/v1/admin/backup/restore-points/pre-restore%2Fpoint%20name%3F%23'
		);
		expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
	});
	it('does not start an upload with an already cancelled signal', async () => {
		const xhr = vi.fn();
		vi.stubGlobal('XMLHttpRequest', xhr);
		await expect(
			uploadBackup(new File(['zip'], 'backup.zip'), vi.fn(), AbortSignal.abort())
		).rejects.toMatchObject({ name: 'AbortError' });
		expect(xhr).not.toHaveBeenCalled();
	});

	it('bounds restart polling even when the readiness connection never answers', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				(_url, init: RequestInit) =>
					new Promise((_resolve, reject) => {
						init.signal?.addEventListener(
							'abort',
							() => reject(new DOMException('timeout', 'AbortError')),
							{ once: true }
						);
					})
			)
		);
		const result = waitForRestart(new AbortController().signal, {
			timeoutMs: 80,
			intervalMs: 5
		});
		await expect(result).resolves.toBe(false);
		expect(fetch).toHaveBeenCalled();
	});
});
