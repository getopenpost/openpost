import {
	referencedSourceIDs,
	type VariantID,
	type VideoProjectDocumentV1
} from '@openpost/video-project';
import { openVideoProjectPreviewSource } from './source-url';

export interface PreviewEngineState {
	ready: boolean;
	rendered_timestamp_us: number;
	error?: string;
	diagnostics?: PreviewEngineDiagnostics;
}

export interface PreviewEngineDiagnostics {
	active_video_decoders: number;
	peak_video_decoders: number;
	dropped_render_requests: number;
	proxy_source_count: number;
	sample_requests: number;
	discontinuity_seeks: number;
	render_ms: number;
	quality: 'full' | 'adaptive';
}

export class VideoEditorPreviewEngine {
	private readonly worker: Worker;
	private readonly projectID?: string;
	private readonly onState: (state: PreviewEngineState) => void;
	private controller: AbortController | undefined;
	private revision = 0;
	private requestID = 0;
	private disposed = false;
	private lastVariantID: VariantID | undefined;
	private lastTimestampUS = 0;

	constructor(
		canvas: HTMLCanvasElement,
		projectID: string | undefined,
		onState: (state: PreviewEngineState) => void
	) {
		if (!canvas.transferControlToOffscreen) {
			throw new Error('OffscreenCanvas preview is unavailable.');
		}
		this.projectID = projectID;
		this.onState = onState;
		this.worker = new Worker(new URL('./preview-render.worker.ts', import.meta.url), {
			type: 'module'
		});
		this.worker.onmessage = (event) => this.receive(event);
		this.worker.onerror = (event) =>
			this.onState({ ready: false, rendered_timestamp_us: 0, error: event.message });
		const offscreen = canvas.transferControlToOffscreen();
		this.worker.postMessage({ type: 'initialize', canvas: offscreen }, [offscreen]);
	}

	async configure(project: VideoProjectDocumentV1): Promise<void> {
		if (this.disposed) return;
		this.controller?.abort();
		const controller = new AbortController();
		this.controller = controller;
		const revision = ++this.revision;
		const files = await Promise.all(
			referencedSourceIDs(project).map(async (sourceID) => {
				const source = await openVideoProjectPreviewSource(
					this.projectID,
					project.sources[sourceID]!,
					controller.signal
				);
				return {
					source_id: sourceID,
					file: source.file,
					using_proxy: source.using_proxy
				};
			})
		);
		controller.signal.throwIfAborted();
		this.worker.postMessage({
			type: 'configure',
			revision,
			project: structuredClone(project),
			files
		});
	}

	render(variantID: VariantID, timestampUS: number, playing = false): void {
		if (this.disposed) return;
		this.lastVariantID = variantID;
		this.lastTimestampUS = timestampUS;
		this.worker.postMessage({
			type: 'render',
			request_id: ++this.requestID,
			variant_id: variantID,
			timestamp_us: timestampUS,
			playing
		});
	}

	dispose(): void {
		this.disposed = true;
		this.controller?.abort();
		this.worker.postMessage({ type: 'dispose' });
		this.worker.terminate();
	}

	private receive(event: MessageEvent<Record<string, unknown>>): void {
		if (event.data.type === 'ready') {
			this.onState({ ready: false, rendered_timestamp_us: 0 });
		} else if (event.data.type === 'configured') {
			if (this.lastVariantID) this.render(this.lastVariantID, this.lastTimestampUS);
		} else if (event.data.type === 'frame') {
			this.onState({
				ready: true,
				rendered_timestamp_us: Number(event.data.timestamp_us ?? 0),
				diagnostics: event.data.diagnostics as PreviewEngineDiagnostics
			});
		} else if (event.data.type === 'error') {
			this.onState({
				ready: false,
				rendered_timestamp_us: 0,
				error: String(event.data.message ?? 'The preview renderer stopped.')
			});
		}
	}
}
