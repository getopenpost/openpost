import { SOUND_TOUCH_PREVIEW_PROCESSOR_NAME } from './soundtouch-preview-shared';
import workletModuleUrl from './soundtouch-preview-processor.worklet.ts?worker&url';

const pendingWorkletLoads = new WeakMap<AudioContext, Promise<boolean>>();

function canUseSoundTouchPreviewWorklet(context: AudioContext): boolean {
	return typeof AudioWorkletNode !== 'undefined' && typeof context.audioWorklet !== 'undefined';
}

export async function ensureSoundTouchPreviewWorkletLoaded(
	context: AudioContext
): Promise<boolean> {
	if (!canUseSoundTouchPreviewWorklet(context)) return false;
	const pending = pendingWorkletLoads.get(context);
	if (pending) return pending;
	const loadPromise = context.audioWorklet
		.addModule(workletModuleUrl)
		.then(() => true)
		.catch(() => {
			pendingWorkletLoads.delete(context);
			return false;
		});
	pendingWorkletLoads.set(context, loadPromise);
	return loadPromise;
}

export { SOUND_TOUCH_PREVIEW_PROCESSOR_NAME };
