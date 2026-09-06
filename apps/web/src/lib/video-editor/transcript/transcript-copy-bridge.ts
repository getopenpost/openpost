interface TranscriptCopyHandler {
	isActive: () => boolean;
	copy: (cut: boolean) => void;
}

let handler: TranscriptCopyHandler | null = null;

export function registerTranscriptCopyHandler(next: TranscriptCopyHandler): () => void {
	handler = next;
	return () => {
		if (handler === next) handler = null;
	};
}

export function handleTranscriptClipboardCopy(cut: boolean): boolean {
	if (!handler?.isActive()) return false;
	handler.copy(cut);
	return true;
}
