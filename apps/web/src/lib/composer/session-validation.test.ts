import { describe, expect, it } from 'vitest';
import { ComposerSession, type ComposerPublicationClient, type PublicationDraft } from './session';

function draft(sourceText: string): PublicationDraft {
	return {
		title: '',
		creation_preset: 'post',
		content_profile: 'short_text',
		source_text: sourceText,
		metadata: {},
		segments: [{ id: 'segment-1', body: sourceText, media: [] }],
		renditions: [
			{
				social_account_id: 'account-1',
				profile: 'post',
				output_profile: 'bluesky.post',
				body: sourceText,
				media: [],
				segments: [{ publication_segment_id: 'segment-1', body: sourceText, media: [] }]
			}
		]
	};
}

function clientWith(overrides: Partial<ComposerPublicationClient>): ComposerPublicationClient {
	const unavailable = async () => {
		throw new Error('Unexpected composer client call.');
	};
	return {
		load: unavailable,
		create: unavailable,
		update: unavailable,
		validate: unavailable,
		schedule: unavailable,
		publishNow: unavailable,
		retry: unavailable,
		cancel: unavailable,
		delete: unavailable,
		...overrides
	};
}

describe('ComposerSession validation', () => {
	it('clears an old validation issue when the edited draft removes the URL', async () => {
		const issue = {
			code: 'unsupported_setting',
			fallback_message: 'url is not supported for Threads thread',
			message: 'url is not supported for Threads thread',
			severity: 'error',
			scope: 'rendition',
			scope_id: 'account-1'
		};
		const session = new ComposerSession({
			workspaceId: 'workspace-1',
			client: clientWith({
				async create(workspaceId) {
					return { id: 'publication-1', workspace_id: workspaceId, revision: 1, status: 'draft' };
				},
				async validate() {
					return { issues: [issue] };
				}
			})
		});

		session.edit(draft('Read https://example.com'));
		expect(await session.validate()).toEqual([issue]);
		session.edit(draft('Corrected post without the URL'));

		expect(session.snapshot.validationIssues).toEqual([]);
	});

	it('revalidates a changed draft instead of restoring an old URL warning', async () => {
		const issue = {
			code: 'unsupported_setting',
			fallback_message: 'url is not supported for Threads thread',
			message: 'url is not supported for Threads thread',
			severity: 'error'
		};
		let finishOldValidation!: (value: { issues: (typeof issue)[] }) => void;
		let validationStarted!: () => void;
		const oldValidation = new Promise<{ issues: (typeof issue)[] }>((resolve) => {
			finishOldValidation = resolve;
		});
		const started = new Promise<void>((resolve) => {
			validationStarted = resolve;
		});
		let validationCalls = 0;
		const session = new ComposerSession({
			workspaceId: 'workspace-1',
			client: clientWith({
				async create(workspaceId) {
					return { id: 'publication-1', workspace_id: workspaceId, revision: 1, status: 'draft' };
				},
				async update(_id, _revision, updated) {
					return {
						id: 'publication-1',
						workspace_id: 'workspace-1',
						revision: 2,
						status: 'draft',
						draft: updated
					};
				},
				async validate() {
					validationCalls += 1;
					if (validationCalls === 1) {
						validationStarted();
						return oldValidation;
					}
					return { issues: [] };
				}
			})
		});

		session.edit(draft('Read https://example.com'));
		await session.save();
		const pending = session.validate();
		await started;
		session.edit(draft('URL removed'));
		finishOldValidation({ issues: [issue] });

		expect(await pending).toEqual([]);
		expect(session.snapshot.validationIssues).toEqual([]);
		expect(validationCalls).toBe(2);
	});
});
