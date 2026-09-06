import type { MediaDragData } from './media-drag';

class MediaPlacementController {
	request = $state<{ payload: MediaDragData; requestId: number } | null>(null);
	#nextRequestId = 1;

	begin(payload: MediaDragData): void {
		this.request = { payload, requestId: this.#nextRequestId };
		this.#nextRequestId += 1;
	}

	cancel(): void {
		this.request = null;
	}
}

/** Shared accessible placement request between the media pool and timeline. */
export const mediaPlacement = new MediaPlacementController();
