import { browser } from '$app/environment';
import { IS_CAPACITOR } from '$lib/env';

const STORAGE_KEY = 'openpost_instance_url';

let instanceUrl = $state<string | null>(null);
let isLoading = $state(true);

function normalizeUrl(raw: string): string {
	let url = raw.trim();
	if (!url) return '';

	// If no protocol is provided
	if (!url.startsWith('http://') && !url.startsWith('https://')) {
		// Default to HTTP for IP addresses, HTTPS for everything else
		const isIp = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}/.test(url);
		if (isIp) {
			url = 'http://' + url;
		} else {
			url = 'https://' + url;
		}
	}

	return url.replace(/\/+$/, '');
}

export function getApiBase(): string {
	if (IS_CAPACITOR && instanceUrl) {
		return `${instanceUrl}/api/v1`;
	}
	return '/api/v1';
}

export function getMediaBase(): string {
	if (IS_CAPACITOR && instanceUrl) {
		return instanceUrl;
	}
	return '';
}

export function isInstanceConfigured(): boolean {
	if (!IS_CAPACITOR) return true;
	return instanceUrl !== null && instanceUrl.length > 0;
}

export function instanceStore() {
	return {
		get instanceUrl() {
			return instanceUrl;
		},
		get isLoading() {
			return isLoading;
		},

		initialize() {
			if (!browser) {
				isLoading = false;
				return;
			}

			const stored = localStorage.getItem(STORAGE_KEY);
			if (stored) {
				instanceUrl = stored;
			} else if (!IS_CAPACITOR) {
				// Web mode: no instance URL needed
			}
			isLoading = false;
		},

		async setInstanceUrl(raw: string): Promise<{ success: boolean; error?: string }> {
			const url = normalizeUrl(raw);
			if (!url) return { success: false, error: 'Enter a server URL.' };

			if (IS_CAPACITOR && (url.includes('localhost') || url.includes('127.0.0.1'))) {
				return {
					success: false,
					error:
						"Don't use 'localhost' or '127.0.0.1' on mobile. Use your computer's local IP address instead (e.g., http://192.168.1.50:8080)."
				};
			}

			const result = await testInstanceConnection(url);
			if (!result.ok) {
				return { success: false, error: result.error };
			}

			instanceUrl = url;
			if (browser) {
				localStorage.setItem(STORAGE_KEY, url);
			}
			return { success: true };
		},

		clearInstanceUrl() {
			instanceUrl = null;
			if (browser) {
				localStorage.removeItem(STORAGE_KEY);
			}
		}
	};
}

export async function testInstanceConnection(
	url: string
): Promise<{ ok: boolean; error?: string }> {
	try {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 10000);

		const resp = await fetch(`${url}/api/v1/ready`, {
			signal: controller.signal
		});
		clearTimeout(timeout);

		if (!resp.ok) {
			return { ok: false, error: `Server responded with ${resp.status}` };
		}

		const data = await resp.json();
		if (data?.status !== 'ready' || data?.database !== 'ok') {
			return { ok: false, error: 'OpenPost is not ready. Check server logs and database access.' };
		}

		return { ok: true };
	} catch (e) {
		const err = e as Error;
		if (err.name === 'AbortError') {
			return { ok: false, error: 'Connection timed out. Check the URL and try again.' };
		}
		return { ok: false, error: `Could not connect: ${err.message}` };
	}
}
