export const MAX_PASTED_IMAGE_BYTES = 50 * 1024 * 1024;

export interface PasteMediaUploadTarget {
	workspaceId: string;
	postKey: string;
	variantAccountId: string | null;
}

export type PasteMediaUploadStatus = 'queued' | 'uploading' | 'paused' | 'failed';

export interface PasteMediaUploadItem {
	id: string;
	file: File;
	previewURL: string;
	target: PasteMediaUploadTarget;
	status: PasteMediaUploadStatus;
	progress: number | null;
	error: string;
}

export interface ClipboardFileItem {
	kind: string;
	type: string;
	getAsFile(): File | null;
}

export type PastedImageRejectionReason = 'empty' | 'too_large' | 'duplicate' | 'capacity';

export interface PastedImageSelection {
	accepted: File[];
	rejected: Array<{ file: File; reason: PastedImageRejectionReason }>;
	hasImageFiles: boolean;
}

interface InternalPasteMediaUploadItem<Result> extends PasteMediaUploadItem {
	generation: number;
	controller: AbortController | null;
	hasResult: boolean;
	result: Result | undefined;
}

interface PasteMediaUploadQueueOptions<Result> {
	upload: (input: {
		file: File;
		target: PasteMediaUploadTarget;
		signal: AbortSignal;
		onProgress: (fraction: number) => void;
	}) => Promise<Result>;
	onComplete: (
		item: PasteMediaUploadItem,
		result: Result
	) => boolean | void | Promise<boolean | void>;
	onChange: (items: PasteMediaUploadItem[]) => void;
	errorMessage: (cause: unknown) => string;
	createPreviewURL?: (file: File) => string;
	revokePreviewURL?: (url: string) => void;
	createID?: () => string;
	maxConcurrentUploads?: number;
}

export function pasteMediaTargetKey(target: PasteMediaUploadTarget): string {
	return `${target.workspaceId}\u0000${target.postKey}\u0000${target.variantAccountId ?? ''}`;
}

export function pastedImageFileSignature(file: File): string {
	return `${file.name}\u0000${file.size}\u0000${file.lastModified}`;
}

export function availablePasteMediaSlots(
	persistedCount: number,
	pendingCount: number,
	maximum: number
): number {
	return Math.max(0, maximum - Math.max(0, persistedCount) - Math.max(0, pendingCount));
}

export function hasUnsettledPasteMediaUploads(items: Iterable<PasteMediaUploadItem>): boolean {
	return [...items].some(
		(item) =>
			item.status === 'queued' ||
			item.status === 'uploading' ||
			item.status === 'paused' ||
			item.status === 'failed'
	);
}

export function acceptedPastedImageFiles(
	items: Iterable<ClipboardFileItem>,
	capacity: number,
	existingSignatures: Iterable<string> = []
): File[] {
	return selectPastedImageFiles(items, capacity, existingSignatures).accepted;
}

export function selectPastedImageFiles(
	items: Iterable<ClipboardFileItem>,
	capacity: number,
	existingSignatures: Iterable<string> = []
): PastedImageSelection {
	const signatures = new Set(existingSignatures);
	const accepted: File[] = [];
	const rejected: PastedImageSelection['rejected'] = [];
	let hasImageFiles = false;
	for (const item of items) {
		if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
		const file = item.getAsFile();
		if (!file || !file.type.startsWith('image/')) continue;
		hasImageFiles = true;
		if (file.size <= 0) {
			rejected.push({ file, reason: 'empty' });
			continue;
		}
		if (file.size > MAX_PASTED_IMAGE_BYTES) {
			rejected.push({ file, reason: 'too_large' });
			continue;
		}
		const signature = pastedImageFileSignature(file);
		if (signatures.has(signature)) {
			rejected.push({ file, reason: 'duplicate' });
			continue;
		}
		signatures.add(signature);
		if (accepted.length >= Math.max(0, capacity)) {
			rejected.push({ file, reason: 'capacity' });
			continue;
		}
		accepted.push(file);
	}
	return { accepted, rejected, hasImageFiles };
}

export class PasteMediaUploadQueue<Result> {
	readonly #options: Required<
		Pick<PasteMediaUploadQueueOptions<Result>, 'createPreviewURL' | 'revokePreviewURL' | 'createID'>
	> &
		Omit<
			PasteMediaUploadQueueOptions<Result>,
			'createPreviewURL' | 'revokePreviewURL' | 'createID' | 'maxConcurrentUploads'
		>;
	#items: InternalPasteMediaUploadItem<Result>[] = [];
	#generation = 0;
	readonly #activeTargets = new Set<string>();
	#activeUploadCount = 0;
	readonly #maxConcurrentUploads: number;

	constructor(options: PasteMediaUploadQueueOptions<Result>) {
		this.#options = {
			...options,
			createPreviewURL: options.createPreviewURL ?? ((file) => URL.createObjectURL(file)),
			revokePreviewURL: options.revokePreviewURL ?? ((url) => URL.revokeObjectURL(url)),
			createID: options.createID ?? (() => crypto.randomUUID())
		};
		this.#maxConcurrentUploads = Math.max(1, Math.floor(options.maxConcurrentUploads ?? 3));
	}

	enqueue(files: File[], target: PasteMediaUploadTarget): string[] {
		const additions = files.map<InternalPasteMediaUploadItem<Result>>((file) => ({
			id: this.#options.createID(),
			file,
			previewURL: this.#options.createPreviewURL(file),
			target: { ...target },
			status: 'queued',
			progress: null,
			error: '',
			generation: this.#generation,
			controller: null,
			hasResult: false,
			result: undefined
		}));
		if (additions.length === 0) return [];
		this.#items = [...this.#items, ...additions];
		this.#emit();
		this.#schedule();
		return additions.map((item) => item.id);
	}

	retry(id: string): void {
		const item = this.#find(id);
		if (!item || (item.status !== 'failed' && item.status !== 'paused')) return;
		item.status = 'queued';
		item.progress = null;
		item.error = '';
		this.#emit();
		this.#schedule();
	}

	cancel(id: string): void {
		const item = this.#find(id);
		if (!item || item.status !== 'uploading') return;
		item.status = 'paused';
		item.progress = null;
		item.error = '';
		this.#emit();
		item.controller?.abort();
	}

	remove(id: string): void {
		const item = this.#find(id);
		if (!item) return;
		this.#remove(item);
		this.#emit();
		this.#schedule();
	}

	discardWhere(predicate: (item: PasteMediaUploadItem) => boolean): void {
		const removed = this.#items.filter((item) => predicate(this.#publicItem(item)));
		if (removed.length === 0) return;
		const removedIDs = new Set(removed.map((item) => item.id));
		this.#items = this.#items.filter((item) => !removedIDs.has(item.id));
		for (const item of removed) {
			item.controller?.abort();
			this.#revoke(item.previewURL);
		}
		this.#emit();
		this.#schedule();
	}

	reset(): void {
		this.#generation += 1;
		const removed = this.#items;
		this.#items = [];
		for (const item of removed) {
			item.controller?.abort();
			this.#revoke(item.previewURL);
		}
		this.#emit();
		this.#schedule();
	}

	#find(id: string): InternalPasteMediaUploadItem<Result> | undefined {
		return this.#items.find((item) => item.id === id);
	}

	#isLive(item: InternalPasteMediaUploadItem<Result>): boolean {
		return item.generation === this.#generation && this.#find(item.id) === item;
	}

	#schedule(): void {
		while (this.#activeUploadCount < this.#maxConcurrentUploads) {
			const item = this.#items.find((candidate) => {
				if (candidate.generation !== this.#generation || candidate.status !== 'queued') {
					return false;
				}
				const targetKey = pasteMediaTargetKey(candidate.target);
				const firstForTarget = this.#items.find(
					(other) =>
						other.generation === candidate.generation &&
						pasteMediaTargetKey(other.target) === targetKey
				);
				return (
					firstForTarget === candidate &&
					!this.#activeTargets.has(`${candidate.generation}\u0000${targetKey}`)
				);
			});
			if (!item) return;
			const lockKey = `${item.generation}\u0000${pasteMediaTargetKey(item.target)}`;
			this.#activeTargets.add(lockKey);
			this.#activeUploadCount += 1;
			void this.#process(item, lockKey);
		}
	}

	async #process(item: InternalPasteMediaUploadItem<Result>, lockKey: string): Promise<void> {
		const controller = new AbortController();
		item.controller = controller;
		item.status = 'uploading';
		item.progress = null;
		item.error = '';
		this.#emit();
		try {
			if (!item.hasResult) {
				item.result = await this.#options.upload({
					file: item.file,
					target: item.target,
					signal: controller.signal,
					onProgress: (fraction) => {
						if (!this.#isLive(item) || item.status !== 'uploading') return;
						item.progress = Math.max(0, Math.min(1, fraction));
						this.#emit();
					}
				});
				item.hasResult = true;
			}
			if (!this.#isLive(item) || controller.signal.aborted) return;
			const applied = await this.#options.onComplete(this.#publicItem(item), item.result as Result);
			if (!this.#isLive(item)) return;
			this.#remove(item);
			this.#emit();
			if (applied === false) return;
		} catch (cause) {
			if (!this.#isLive(item)) return;
			item.controller = null;
			if (controller.signal.aborted) {
				if (item.status === 'uploading') item.status = 'paused';
			} else {
				item.status = 'failed';
				item.error = this.#options.errorMessage(cause);
			}
			item.progress = null;
			this.#emit();
		} finally {
			this.#activeTargets.delete(lockKey);
			this.#activeUploadCount = Math.max(0, this.#activeUploadCount - 1);
			this.#schedule();
		}
	}

	#remove(item: InternalPasteMediaUploadItem<Result>): void {
		this.#items = this.#items.filter((candidate) => candidate !== item);
		item.controller?.abort();
		item.controller = null;
		this.#revoke(item.previewURL);
	}

	#revoke(url: string): void {
		if (url) this.#options.revokePreviewURL(url);
	}

	#emit(): void {
		this.#options.onChange(this.#items.map((item) => this.#publicItem(item)));
	}

	#publicItem(item: InternalPasteMediaUploadItem<Result>): PasteMediaUploadItem {
		return {
			id: item.id,
			file: item.file,
			previewURL: item.previewURL,
			target: { ...item.target },
			status: item.status,
			progress: item.progress,
			error: item.error
		};
	}
}
