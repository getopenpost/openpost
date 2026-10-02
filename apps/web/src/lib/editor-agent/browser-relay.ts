/* oxlint-disable anti-slop/no-unsafe-dictionary-type, anti-slop/no-runtime-typeof, anti-slop/no-unknown-parameters, anti-slop/require-safety-comment-for-type-assertion -- Huma owns relay response schemas; each editor executor validates operation fields before mutation. This transport also canonicalizes authored JSON. */
export type EditorAgentKind = 'video' | 'image';

export interface EditorAgentRequest {
	id: string;
	operation: string;
	arguments: Record<string, unknown>;
	status: string;
}

interface EditorAgentRegistration {
	session: { id: string };
	epoch: string;
}

export interface EditorAgentConnection {
	workspaceID: string;
	projectID: string;
	kind: EditorAgentKind;
	handle: (request: EditorAgentRequest) => Promise<Record<string, unknown>>;
	onStatus?: (status: 'connected' | 'disconnected' | 'working') => void;
	onSession?: (sessionID: string | null) => void;
}

const relayPath = '/api/v1/editor-agent/sessions';
const activeRequestHeartbeatMs = 10_000;

async function relayJSON<T>(url: string, options: RequestInit = {}): Promise<T> {
	const response = await fetch(url, { ...options, credentials: 'include' });
	if (!response.ok) throw new Error(`Editor connection failed (${response.status})`);
	return (await response.json()) as T;
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		if (signal.aborted) return resolve();
		const timer = setTimeout(done, ms);
		function done() {
			clearTimeout(timer);
			signal.removeEventListener('abort', done);
			resolve();
		}
		signal.addEventListener('abort', done, { once: true });
	});
}

/** The editor owns the operation. The server only routes requests and keeps receipts. */
export function connectEditorAgent(connection: EditorAgentConnection): () => void {
	const controller = new AbortController();
	let current: EditorAgentRegistration | null = null;
	const processed = new Map<
		string,
		{ result: Record<string, unknown>; error: Record<string, unknown> }
	>();

	async function register(): Promise<EditorAgentRegistration> {
		return relayJSON<EditorAgentRegistration>(relayPath, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				workspace_id: connection.workspaceID,
				project_id: connection.projectID,
				editor_kind: connection.kind
			}),
			signal: controller.signal
		});
	}

	async function poll(registration: EditorAgentRegistration): Promise<void> {
		const base = `${relayPath}/${encodeURIComponent(registration.session.id)}`;
		const epoch = encodeURIComponent(registration.epoch);
		const payload = await relayJSON<{ request: EditorAgentRequest | null }>(
			`${base}/next?epoch=${epoch}`,
			{ signal: controller.signal }
		);
		const request = payload.request;
		if (!request) {
			await pause(500, controller.signal);
			return;
		}
		connection.onStatus?.('working');
		let reply = processed.get(request.id);
		if (!reply) {
			const currentRequest = await relayJSON<EditorAgentRequest>(
				`${base}/requests/${encodeURIComponent(request.id)}?epoch=${epoch}`,
				{ signal: controller.signal }
			);
			if (currentRequest.status !== 'leased') return;
			const heartbeat = setInterval(() => {
				void relayJSON<EditorAgentRequest>(
					`${base}/requests/${encodeURIComponent(request.id)}?epoch=${epoch}`,
					{ signal: controller.signal }
				).catch(() => {});
			}, activeRequestHeartbeatMs);
			try {
				const result = await connection.handle(request);
				reply = { result, error: {} };
			} catch (error) {
				reply = {
					result: {},
					error: {
						code: error instanceof EditorAgentOperationError ? error.code : 'operation_failed',
						message: error instanceof Error ? error.message : 'Editor operation failed'
					}
				};
			} finally {
				clearInterval(heartbeat);
			}
			processed.set(request.id, reply);
		}
		await relayJSON(`${base}/requests/${encodeURIComponent(request.id)}/response`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ epoch: registration.epoch, ...reply }),
			signal: controller.signal
		});
		processed.delete(request.id);
		connection.onStatus?.('connected');
	}

	void (async () => {
		while (!controller.signal.aborted) {
			try {
				current = await register();
				connection.onSession?.(current.session.id);
				connection.onStatus?.('connected');
				while (!controller.signal.aborted) await poll(current);
			} catch {
				if (controller.signal.aborted) break;
				connection.onStatus?.('disconnected');
				if (current) {
					void fetch(
						`${relayPath}/${encodeURIComponent(current.session.id)}?epoch=${encodeURIComponent(current.epoch)}`,
						{ method: 'DELETE', credentials: 'include', keepalive: true }
					).catch(() => {});
				}
				await pause(1500, controller.signal);
			} finally {
				current = null;
				processed.clear();
				connection.onSession?.(null);
			}
		}
	})();

	return () => {
		const registration = current;
		controller.abort();
		connection.onSession?.(null);
		connection.onStatus?.('disconnected');
		if (registration) {
			void fetch(
				`${relayPath}/${encodeURIComponent(registration.session.id)}?epoch=${encodeURIComponent(registration.epoch)}`,
				{ method: 'DELETE', credentials: 'include', keepalive: true }
			);
		}
	};
}

export class EditorAgentOperationError extends Error {
	constructor(
		readonly code: string,
		message: string
	) {
		super(message);
	}
}

export function editorCanonicalJSON(value: unknown): string {
	return JSON.stringify(value, (_key, entry) =>
		entry && typeof entry === 'object' && !Array.isArray(entry)
			? Object.fromEntries(
					Object.entries(entry).sort(([left], [right]) =>
						left < right ? -1 : left > right ? 1 : 0
					)
				)
			: entry
	);
}

export async function editorAuthoredRevision(document: unknown): Promise<string> {
	const bytes = new TextEncoder().encode(editorCanonicalJSON(document));
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return Array.from(new Uint8Array(digest), (part) => part.toString(16).padStart(2, '0')).join('');
}
