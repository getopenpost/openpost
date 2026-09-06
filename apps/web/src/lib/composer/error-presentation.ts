import { m } from '$lib/paraglide/messages';
import { ComposerClientError, ComposerSessionError, type ComposerErrorCode } from './session';

const composerErrorMessages = {
	publication_request_failed: m.compose_error_publication_request_failed,
	publication_workspace_mismatch: m.compose_error_publication_workspace_mismatch,
	session_content_missing: m.compose_error_session_content_missing,
	revision_conflict_unresolved: m.compose_error_revision_conflict_unresolved,
	editor_return_token_required: m.compose_error_editor_return_token_required,
	editor_return_token_mismatch: m.compose_error_editor_return_token_mismatch,
	editor_requires_saved_publication: m.compose_error_editor_requires_saved_publication,
	editor_return_already_used: m.compose_error_editor_return_already_used,
	editor_return_workspace_mismatch: m.compose_error_editor_return_workspace_mismatch,
	editor_return_publication_mismatch: m.compose_error_editor_return_publication_mismatch,
	editor_return_revision_invalid: m.compose_error_editor_return_revision_invalid,
	revision_conflict_missing: m.compose_error_revision_conflict_missing,
	session_reset_pending_save: m.compose_error_session_reset_pending_save,
	session_inactive: m.compose_error_session_inactive,
	publication_revision_missing: m.compose_error_publication_revision_missing,
	session_request_failed: m.compose_error_session_request_failed,
	image_editor_return_inactive: m.compose_error_image_editor_return_inactive,
	image_editor_return_workspace_mismatch: m.compose_error_image_editor_return_workspace_mismatch,
	editor_origin_segment_missing: m.compose_error_editor_origin_segment_missing
} satisfies Record<ComposerErrorCode, () => string>;

export function composerErrorMessage(cause: unknown): string {
	if (cause instanceof ComposerSessionError) return composerErrorMessages[cause.code]();
	if (cause instanceof ComposerClientError) {
		return localizedComposerError(cause.message, cause.presentationCode);
	}
	if (cause instanceof Error) return localizedComposerError(cause.message);
	if (String(cause) === cause) return localizedComposerError(String(cause));
	return composerErrorMessages.session_request_failed();
}

function localizedComposerError(
	value: string,
	fallback: ComposerErrorCode = 'session_request_failed'
) {
	const normalized = value.trim();
	if (isComposerErrorCode(normalized)) return composerErrorMessages[normalized]();
	return normalized || composerErrorMessages[fallback]();
}

function isComposerErrorCode(value: string): value is ComposerErrorCode {
	return value in composerErrorMessages;
}
