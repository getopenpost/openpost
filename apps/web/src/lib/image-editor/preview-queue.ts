import type { ImageEditorDocument, ImageEditorPage } from './types';
import { renderImageEditorPreview } from './static-renderer';

const MAX_CONCURRENT_PREVIEWS = 2;

export function createImageEditorPreviewQueue(
	render: (
		document: ImageEditorDocument,
		page: ImageEditorPage,
		signal: AbortSignal
	) => Promise<Blob>
): (
	document: ImageEditorDocument,
	page: ImageEditorPage,
	signal: AbortSignal,
	previewKey: symbol
) => Promise<Blob> {
	let activePreviews = 0;
	const pendingPreviews: Array<{
		document: ImageEditorDocument;
		page: ImageEditorPage;
		signal: AbortSignal;
		previewKey: symbol;
		removeAbortListener: () => void;
		resolve: (blob: Blob) => void;
		reject: (error: Error) => void;
	}> = [];

	function startPendingPreviews(): void {
		while (activePreviews < MAX_CONCURRENT_PREVIEWS && pendingPreviews.length > 0) {
			const pending = pendingPreviews.shift()!;
			pending.removeAbortListener();
			if (pending.signal.aborted) {
				pending.reject(new DOMException('Preview canceled', 'AbortError'));
				continue;
			}
			activePreviews++;
			void render(pending.document, pending.page, pending.signal)
				.then((blob) => {
					if (pending.signal.aborted)
						pending.reject(new DOMException('Preview canceled', 'AbortError'));
					else pending.resolve(blob);
				})
				.catch((error: Error) => pending.reject(error))
				.finally(() => {
					activePreviews--;
					startPendingPreviews();
				});
		}
	}

	return (document, page, signal, previewKey) =>
		new Promise((resolve, reject) => {
			if (signal.aborted) {
				reject(new DOMException('Preview canceled', 'AbortError'));
				return;
			}
			for (let index = pendingPreviews.length - 1; index >= 0; index--) {
				const pending = pendingPreviews[index];
				if (pending.previewKey !== previewKey) continue;
				pendingPreviews.splice(index, 1);
				pending.removeAbortListener();
				pending.reject(new DOMException('Preview superseded', 'AbortError'));
			}
			const cancel = () => {
				const index = pendingPreviews.indexOf(pending);
				if (index !== -1) pendingPreviews.splice(index, 1);
				pending.removeAbortListener();
				reject(new DOMException('Preview canceled', 'AbortError'));
			};
			const pending = {
				document,
				page,
				signal,
				previewKey,
				resolve,
				reject,
				removeAbortListener: () => signal.removeEventListener('abort', cancel)
			};
			signal.addEventListener('abort', cancel, { once: true });
			pendingPreviews.push(pending);
			startPendingPreviews();
		});
}

export const queueImageEditorPreview = createImageEditorPreviewQueue(renderImageEditorPreview);
