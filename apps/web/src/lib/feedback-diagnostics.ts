export interface FeedbackFailedRequest {
	method: string;
	path: string;
	status: number;
	duration_ms: number;
	timestamp: string;
}

export interface FeedbackClientError {
	name: string;
	message: string;
	timestamp: string;
}

export interface FeedbackDiagnosticsSnapshot {
	route_path: string;
	component?: string;
	viewport: {
		width: number;
		height: number;
		pixel_ratio: number;
	};
	browser: string;
	navigation: string[];
	failed_requests: FeedbackFailedRequest[];
	errors: FeedbackClientError[];
}

class FeedbackDiagnostics {
	private navigation: string[] = [];
	private failedRequests: FeedbackFailedRequest[] = [];
	private errors: FeedbackClientError[] = [];
	private requestStarts = new WeakMap<Request, number>();
	private initialized = false;

	initialize() {
		if (this.initialized || typeof window === 'undefined') return;
		this.initialized = true;
		window.addEventListener('error', (event) => {
			this.recordError(event.error instanceof Error ? event.error : new Error(event.message));
		});
		window.addEventListener('unhandledrejection', (event) => {
			const reason = event.reason;
			this.recordError(reason instanceof Error ? reason : new Error('Unhandled promise rejection'));
		});
	}

	recordNavigation(value: string) {
		const path = safeFeedbackPath(value);
		if (!path || this.navigation.at(-1) === path) return;
		this.navigation = [...this.navigation, path].slice(-10);
	}

	recordRequestStart(request: Request) {
		this.requestStarts.set(request, performance.now());
	}

	recordResponse(request: Request, response: Response) {
		if (response.status < 400) return;
		const parsed = new URL(request.url, window.location.origin);
		const path = safeFeedbackPath(parsed.pathname);
		if (!path.startsWith('/api/v1/')) return;
		const startedAt = this.requestStarts.get(request) ?? performance.now();
		this.failedRequests = [
			...this.failedRequests,
			{
				method: request.method.slice(0, 8).toUpperCase(),
				path,
				status: response.status,
				duration_ms: Math.max(0, Math.min(60_000, Math.round(performance.now() - startedAt))),
				timestamp: new Date().toISOString()
			}
		].slice(-15);
	}

	snapshot(routePath: string, component = ''): FeedbackDiagnosticsSnapshot {
		return {
			route_path: safeFeedbackPath(routePath),
			component: safeText(component, 80) || undefined,
			viewport: {
				width: Math.min(window.innerWidth, 4096),
				height: Math.min(window.innerHeight, 4096),
				pixel_ratio: Math.min(window.devicePixelRatio || 1, 2)
			},
			browser: browserFamilyVersion(),
			navigation: [...this.navigation],
			failed_requests: this.failedRequests.map((request) => ({ ...request })),
			errors: this.errors.map((error) => ({ ...error }))
		};
	}

	private recordError(error: Error) {
		const message = sanitizeFeedbackErrorMessage(error.message);
		const name = safeText(error.name, 48);
		if (!name && !message) return;
		this.errors = [...this.errors, { name, message, timestamp: new Date().toISOString() }].slice(
			-10
		);
	}
}

export function safeFeedbackPath(
	value: string,
	origin = typeof window === 'undefined' ? 'https://openpost.invalid' : window.location.origin
) {
	try {
		const path = new URL(value, origin).pathname;
		return path.startsWith('/') ? path.slice(0, 240) : '';
	} catch {
		return '';
	}
}

export function sanitizeFeedbackErrorMessage(value: string) {
	const normalized = value.toLowerCase();
	if (/\b(abort|cancel(?:led|ed)?)\b/.test(normalized)) return 'Client operation cancelled';
	if (/\b(timeout|timed out)\b/.test(normalized)) return 'Client operation timed out';
	if (/\b(network|fetch|offline|connection)\b/.test(normalized)) return 'Network request failed';
	if (/\b(permission|not allowed|denied)\b/.test(normalized))
		return 'Client permission check failed';
	return 'Client operation failed';
}

function safeText(value: string, length: number) {
	let cleaned = '';
	for (const character of value) {
		const code = character.charCodeAt(0);
		if (code >= 0x20 && code !== 0x7f) cleaned += character;
	}
	return cleaned.trim().slice(0, length);
}

function browserFamilyVersion() {
	const ua = navigator.userAgent;
	const candidates: Array<[string, RegExp]> = [
		['Edge', /Edg\/(\d+(?:\.\d+)?)/],
		['Chrome', /Chrome\/(\d+(?:\.\d+)?)/],
		['Firefox', /Firefox\/(\d+(?:\.\d+)?)/],
		['Safari', /Version\/(\d+(?:\.\d+)?).*Safari/]
	];
	for (const [family, pattern] of candidates) {
		const match = ua.match(pattern);
		if (match?.[1]) return `${family} ${match[1]}`;
	}
	return 'Other browser';
}

export const feedbackDiagnostics = new FeedbackDiagnostics();
