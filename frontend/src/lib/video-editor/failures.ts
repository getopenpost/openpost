export type VideoEditorFailureCode =
	| 'capability.webcodecs'
	| 'capability.webgl2'
	| 'capability.opfs'
	| 'codec.decoder'
	| 'codec.encoder'
	| 'source.missing'
	| 'source.unsupported'
	| 'storage.quota'
	| 'storage.persistence-denied'
	| 'storage.write'
	| 'export.sink'
	| 'export.validation'
	| 'model.download'
	| 'model.hash'
	| 'model.runtime'
	| 'model.timeout'
	| 'model.language'
	| 'capture.permission'
	| 'capture.external-stop'
	| 'capture.device-loss'
	| 'recording.corrupt'
	| 'recording.duration'
	| 'cloud.quota'
	| 'cloud.conflict'
	| 'cloud.upload'
	| 'stock.unavailable'
	| 'stock.rate-limited'
	| 'stock.removed'
	| 'stock.unconfigured'
	| 'unknown';

export interface VideoEditorFailurePresentation {
	explanation: string;
	preservation: string;
	recovery: string;
	retryable: boolean;
}

const PRESENTATIONS: Record<VideoEditorFailureCode, VideoEditorFailurePresentation> = {
	'capability.webcodecs': {
		explanation:
			'This browser does not provide the video codec engine required by OpenPost Video Editor.',
		preservation: 'Your existing local projects have not been changed.',
		recovery: 'Open the project in a current desktop version of Chrome or Edge.',
		retryable: false
	},
	'capability.webgl2': {
		explanation: 'WebGL2 is unavailable, so OpenPost Video Editor cannot compose frames reliably.',
		preservation: 'Your existing local projects have not been changed.',
		recovery: 'Enable hardware graphics support or use another supported Chromium device.',
		retryable: true
	},
	'capability.opfs': {
		explanation: 'Private local file storage is unavailable in this browser context.',
		preservation: 'No project files were uploaded.',
		recovery: 'Leave private browsing and allow site storage, then try again.',
		retryable: true
	},
	'codec.decoder': {
		explanation: 'This browser cannot decode one of the source tracks.',
		preservation: 'The project and original source remain available.',
		recovery: 'Replace the source with H.264/AAC MP4 or VP9/Opus WebM.',
		retryable: false
	},
	'codec.encoder': {
		explanation: 'The selected output codec is unavailable for these exact export settings.',
		preservation: 'The project and completed formats remain available.',
		recovery: 'Choose the offered WebM fallback or use a supported Chrome or Edge device.',
		retryable: false
	},
	'source.missing': {
		explanation: 'A referenced local source could not be opened.',
		preservation: 'The project document has been preserved.',
		recovery: 'Restore or replace the missing source.',
		retryable: true
	},
	'source.unsupported': {
		explanation: 'The selected source format is not supported.',
		preservation: 'The project document has been preserved.',
		recovery: 'Convert the source to a supported MP4, WebM, image, or audio file.',
		retryable: false
	},
	'storage.quota': {
		explanation: 'There is not enough local storage for this operation and its working space.',
		preservation: 'Existing originals and completed writes were preserved.',
		recovery: 'Free local project space or choose a smaller operation.',
		retryable: true
	},
	'storage.persistence-denied': {
		explanation: 'The browser did not grant persistent local storage.',
		preservation:
			'You can continue, but the browser may clear local projects under storage pressure.',
		recovery:
			'Export backups and grant persistent storage from the project library when available.',
		retryable: true
	},
	'storage.write': {
		explanation: 'The browser could not finish writing a local file.',
		preservation: 'Completed files and project metadata were preserved where possible.',
		recovery: 'Check available storage, then retry.',
		retryable: true
	},
	'export.sink': {
		explanation: 'The selected export destination is no longer writable.',
		preservation: 'The project and any earlier completed formats remain available.',
		recovery: 'Choose another file or use local project storage.',
		retryable: true
	},
	'export.validation': {
		explanation: 'The rendered container failed its final media checks.',
		preservation: 'The project remains unchanged.',
		recovery: 'Retry with the fallback codec or another supported device.',
		retryable: true
	},
	'model.download': {
		explanation: 'A local analysis model could not finish downloading.',
		preservation: 'Your media and project remain local and unchanged.',
		recovery: 'Check the connection and resume the model download.',
		retryable: true
	},
	'model.hash': {
		explanation: 'A downloaded model did not match its pinned integrity hash.',
		preservation: 'The invalid model file was discarded; your media was not changed.',
		recovery: 'Retry the download or contact the instance operator.',
		retryable: true
	},
	'model.runtime': {
		explanation: 'The local model runtime could not start.',
		preservation: 'Your media and project remain unchanged.',
		recovery: 'Retry with the WASM backend.',
		retryable: true
	},
	'model.timeout': {
		explanation: 'Local analysis stopped responding.',
		preservation: 'No suggestion was applied to the timeline.',
		recovery: 'Retry the affected window or switch to WASM.',
		retryable: true
	},
	'model.language': {
		explanation: 'The transcription language could not be selected with enough confidence.',
		preservation: 'No uncertain transcript was applied.',
		recovery: 'Choose the spoken language and retry.',
		retryable: true
	},
	'capture.permission': {
		explanation: 'Screen or device capture permission was not granted.',
		preservation: 'No recording was created or uploaded.',
		recovery: 'Start recording again and approve the requested sources.',
		retryable: true
	},
	'capture.external-stop': {
		explanation: 'Screen sharing was stopped from the browser controls.',
		preservation: 'Flushed recording tracks remain recoverable.',
		recovery: 'Finish recovery, or start a new screen segment.',
		retryable: true
	},
	'capture.device-loss': {
		explanation: 'A camera or microphone stopped during recording.',
		preservation: 'The screen and other surviving tracks continued where possible.',
		recovery: 'Reconnect the device and add a new track segment.',
		retryable: true
	},
	'recording.corrupt': {
		explanation: 'The last recording data is incomplete or corrupt.',
		preservation: 'Verified chunks and original recovery files were preserved.',
		recovery: 'Recover to the last verified, decodable boundary.',
		retryable: true
	},
	'recording.duration': {
		explanation: 'Recorded tracks have an unexpected duration difference.',
		preservation: 'Every original track remains available.',
		recovery: 'Review the explicit gaps, then apply synchronization correction.',
		retryable: true
	},
	'cloud.quota': {
		explanation: 'The workspace does not have enough cloud storage for the referenced sources.',
		preservation: 'The local project and sources remain unchanged.',
		recovery: 'Free workspace storage or remove unused referenced media.',
		retryable: true
	},
	'cloud.conflict': {
		explanation: 'A newer cloud revision exists.',
		preservation: 'Your local changes have not been overwritten.',
		recovery: 'Reload the cloud version or save this local state as a new project.',
		retryable: false
	},
	'cloud.upload': {
		explanation: 'A source upload was interrupted.',
		preservation: 'The local source and project remain available.',
		recovery: 'Resume the explicit cloud sync.',
		retryable: true
	},
	'stock.unavailable': {
		explanation: 'The selected stock provider is temporarily unavailable.',
		preservation: 'Existing project media is unchanged.',
		recovery: 'Retry later or choose another configured provider.',
		retryable: true
	},
	'stock.rate-limited': {
		explanation: 'The stock provider rate limit has been reached.',
		preservation: 'Existing project media is unchanged.',
		recovery: 'Wait before searching again or choose another provider.',
		retryable: true
	},
	'stock.removed': {
		explanation: 'The stock result was removed before it could be imported.',
		preservation: 'No temporary provider URL was added to the project.',
		recovery: 'Return to search and select another asset.',
		retryable: false
	},
	'stock.unconfigured': {
		explanation: 'This stock provider is not configured on the OpenPost instance.',
		preservation: 'Existing project media is unchanged.',
		recovery: 'Choose a configured provider or ask the instance operator to add its key.',
		retryable: false
	},
	unknown: {
		explanation: 'OpenPost Video Editor could not finish the operation.',
		preservation: 'The project was preserved where technically possible.',
		recovery: 'Retry the operation and open technical details if it fails again.',
		retryable: true
	}
};

export interface VideoEditorDiagnostic {
	at: string;
	code: VideoEditorFailureCode;
	operation: string;
	browser_major?: number;
	duration_bucket?: '<1s' | '1-10s' | '10-60s' | '1-5m' | '>5m';
	size_bucket?: '<1MB' | '1-10MB' | '10-100MB' | '100MB-1GB' | '>1GB';
	worker_state?: string;
	engine_version?: string;
	capabilities?: Record<string, boolean>;
}

export function failurePresentation(code: VideoEditorFailureCode): VideoEditorFailurePresentation {
	return PRESENTATIONS[code];
}

export function classifyVideoEditorFailure(cause: unknown): VideoEditorFailureCode {
	const message =
		cause instanceof Error ? cause.message.toLowerCase() : String(cause).toLowerCase();
	if (cause instanceof DOMException && cause.name === 'NotAllowedError')
		return 'capture.permission';
	if (/quota|not enough local space|insufficient storage/u.test(message)) return 'storage.quota';
	if (/missing from local|could not be opened/u.test(message)) return 'source.missing';
	if (/cannot decode|codec.*decode/u.test(message)) return 'codec.decoder';
	if (/cannot encode|encoder configuration|output codec/u.test(message)) return 'codec.encoder';
	if (/failed validation|readable video container|has no video track/u.test(message)) {
		return 'export.validation';
	}
	if (/sha-256|integrity check/u.test(message)) return 'model.hash';
	if (/model.*download/u.test(message)) return 'model.download';
	if (/stopped responding|timeout/u.test(message)) return 'model.timeout';
	if (/revision conflict|newer cloud revision/u.test(message)) return 'cloud.conflict';
	return 'unknown';
}

export function recordVideoEditorDiagnostic(
	diagnostic: Omit<VideoEditorDiagnostic, 'at'>,
	storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = globalThis.localStorage
): void {
	if (!storage) return;
	const key = 'openpost-video-editor-diagnostics-v1';
	let entries: VideoEditorDiagnostic[] = [];
	try {
		entries = JSON.parse(storage.getItem(key) ?? '[]') as VideoEditorDiagnostic[];
	} catch {
		entries = [];
	}
	entries.push({ ...structuredClone(diagnostic), at: new Date().toISOString() });
	storage.setItem(key, JSON.stringify(entries.slice(-100)));
}
