import { m } from '$lib/paraglide/messages';
import { imageEditorErrorMessage } from '$lib/image-editor/animation-error-message';
import { ImageEditorImportError } from '../image-import';

/* Error classification shared by the Image Editor shell and its dialogs. */

export function isAbortError(cause: unknown): boolean {
	return cause instanceof DOMException && cause.name === 'AbortError';
}

export function apiErrorStatus(cause: unknown): number | undefined {
	if (cause === null || !(cause instanceof Object) || !('status' in cause)) {
		return undefined;
	}
	return Number.isFinite(cause.status) ? Number(cause.status) : undefined;
}

export function imageEditorImportErrorMessage(cause: unknown): string {
	if (!(cause instanceof ImageEditorImportError)) {
		return imageEditorErrorMessage(cause) ?? m.image_editor_external_drop_failed();
	}
	switch (cause.code) {
		case 'unsupported_type':
			return m.image_editor_import_unsupported_type();
		case 'file_too_large':
			return m.image_editor_import_file_too_large();
		case 'unsafe_svg':
			return m.image_editor_import_unsafe_svg();
		case 'decode_failed':
			return m.image_editor_import_decode_failed();
		case 'dimensions_too_large':
			return m.image_editor_import_dimensions_too_large();
		case 'batch_memory_limit':
			return m.image_editor_import_batch_too_large();
		case 'layer_limit':
			return m.image_editor_import_layer_limit();
	}
}
