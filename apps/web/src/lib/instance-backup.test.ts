import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	confirmRestore,
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

	it('sends the confirmation word when restoring', async () => {
		const fetchMock = vi.fn().mockResolvedValue(respond(202, { restarting: true }));
		vi.stubGlobal('fetch', fetchMock);

		await confirmRestore();

		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('/api/v1/admin/backup/restore/confirm');
		expect(init.method).toBe('POST');
		expect(JSON.parse(init.body)).toEqual({ confirm: 'restore' });
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
