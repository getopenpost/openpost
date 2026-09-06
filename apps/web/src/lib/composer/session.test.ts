import { describe, expect, it } from 'vitest';
import {
	ComposerClientError,
	ComposerSession,
	type ComposerPublicationClient,
	type PublicationDraft
} from './session';

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

function quietSwitchAdapters() {
	return {
		save: async () => ({ ok: true }),
		discard: () => undefined,
		invalidate: () => undefined,
		resume: () => undefined
	};
}

describe('ComposerSession', () => {
	it('owns a dirty Workspace switch until the user stays', async () => {
		const resumed: string[] = [];
		const session = new ComposerSession({
			workspaceId: 'workspace-1',
			client: clientWith({})
		});
		const decision = session.requestWorkspaceSwitch({
			fromWorkspaceId: 'workspace-1',
			toWorkspaceId: 'workspace-2',
			toWorkspaceName: 'Second Workspace',
			dirty: true,
			adapters: {
				save: async () => ({ ok: true }),
				discard: () => undefined,
				invalidate: () => undefined,
				resume: () => resumed.push('autosave')
			}
		});

		expect(session.snapshot.workspaceSwitch).toEqual({
			toWorkspaceId: 'workspace-2',
			toWorkspaceName: 'Second Workspace',
			intent: null,
			error: null
		});
		await session.decideWorkspaceSwitch('stay');

		await expect(decision).resolves.toBe(false);
		expect(session.snapshot.workspaceSwitch).toBeNull();
		expect(resumed).toEqual(['autosave']);
		expect(session.snapshot.workspaceId).toBe('workspace-1');
	});

	it('flushes saves before allowing a Workspace switch and invalidates the old session', async () => {
		const order: string[] = [];
		const session = new ComposerSession({
			workspaceId: 'workspace-1',
			client: clientWith({})
		});
		const decision = session.requestWorkspaceSwitch({
			fromWorkspaceId: 'workspace-1',
			toWorkspaceId: 'workspace-2',
			toWorkspaceName: 'Second Workspace',
			dirty: true,
			adapters: {
				save: async () => {
					order.push('save');
					return { ok: true };
				},
				discard: () => order.push('discard'),
				invalidate: () => order.push('invalidate'),
				resume: () => order.push('resume')
			}
		});

		await session.decideWorkspaceSwitch('save');

		await expect(decision).resolves.toBe(true);
		expect(order).toEqual(['save', 'invalidate']);
		expect(session.snapshot.workspaceId).toBe('workspace-1');
		expect(() => session.edit(draft('Wrong Workspace'))).toThrow('session_inactive');
	});

	it('keeps a failed switch save pending before one ordered discard', async () => {
		const order: string[] = [];
		const session = new ComposerSession({
			workspaceId: 'workspace-1',
			client: clientWith({})
		});
		const decision = session.requestWorkspaceSwitch({
			fromWorkspaceId: 'workspace-1',
			toWorkspaceId: 'workspace-2',
			toWorkspaceName: 'Second Workspace',
			dirty: true,
			adapters: {
				save: async () => ({ ok: false, error: 'Save the draft before switching.' }),
				discard: () => order.push('discard'),
				invalidate: () => order.push('invalidate'),
				resume: () => order.push('resume')
			}
		});

		await session.decideWorkspaceSwitch('save');
		expect(session.snapshot.workspaceSwitch).toMatchObject({
			intent: null,
			error: 'Save the draft before switching.'
		});
		await session.decideWorkspaceSwitch('discard');

		await expect(decision).resolves.toBe(true);
		expect(order).toEqual(['discard', 'invalidate']);
	});

	it('rejects a switch that does not originate in the active session Workspace', async () => {
		const session = new ComposerSession({
			workspaceId: 'workspace-1',
			client: clientWith({})
		});

		await expect(
			session.requestWorkspaceSwitch({
				fromWorkspaceId: 'workspace-9',
				toWorkspaceId: 'workspace-2',
				toWorkspaceName: 'Second Workspace',
				dirty: false,
				adapters: {
					save: async () => ({ ok: true }),
					discard: () => undefined,
					invalidate: () => undefined,
					resume: () => undefined
				}
			})
		).resolves.toBe(false);
		expect(session.snapshot.workspaceId).toBe('workspace-1');
	});

	it('ignores load and validation results that complete after Workspace deactivation', async () => {
		let finishLoad!: (value: Awaited<ReturnType<ComposerPublicationClient['load']>>) => void;
		const loadResult = new Promise<Awaited<ReturnType<ComposerPublicationClient['load']>>>(
			(resolve) => {
				finishLoad = resolve;
			}
		);
		const loading = new ComposerSession({
			workspaceId: 'workspace-1',
			client: clientWith({ load: async () => loadResult })
		});
		const pendingLoad = loading.load('publication-1');
		await loading.requestWorkspaceSwitch({
			fromWorkspaceId: 'workspace-1',
			toWorkspaceId: 'workspace-2',
			toWorkspaceName: 'Second Workspace',
			dirty: false,
			adapters: quietSwitchAdapters()
		});
		finishLoad({
			publication: {
				id: 'publication-1',
				workspace_id: 'workspace-1',
				revision: 4,
				status: 'draft'
			},
			draft: draft('Late load')
		});
		await pendingLoad;
		expect(loading.snapshot.publicationId).toBeNull();

		let finishValidation!: (value: { issues: [] }) => void;
		const validationResult = new Promise<{ issues: [] }>((resolve) => (finishValidation = resolve));
		const validating = new ComposerSession({
			workspaceId: 'workspace-1',
			client: clientWith({
				create: async (workspaceId) => ({
					id: 'publication-2',
					workspace_id: workspaceId,
					revision: 1,
					status: 'draft'
				}),
				validate: async () => validationResult
			})
		});
		validating.edit(draft('Validate later'));
		await validating.save();
		const pendingValidation = validating.validate();
		await Promise.resolve();
		await validating.requestWorkspaceSwitch({
			fromWorkspaceId: 'workspace-1',
			toWorkspaceId: 'workspace-2',
			toWorkspaceName: 'Second Workspace',
			dirty: false,
			adapters: quietSwitchAdapters()
		});
		finishValidation({ issues: [] });
		await pendingValidation;
		expect(validating.snapshot.phase).toBe('validating');
	});

	it.each(['schedule', 'publish', 'retry', 'cancel', 'delete'] as const)(
		'ignores a late %s completion after Workspace deactivation',
		async (operation) => {
			let finish!: (value: never) => void;
			const result = new Promise<never>((resolve) => (finish = resolve));
			const action = {
				message: 'Done',
				publication_id: 'publication-1',
				revision: 2,
				renditions: []
			};
			const session = new ComposerSession({
				workspaceId: 'workspace-1',
				client: clientWith({
					create: async (workspaceId) => ({
						id: 'publication-1',
						workspace_id: workspaceId,
						revision: 1,
						status: 'draft'
					}),
					validate: async () => ({ issues: [] }),
					schedule: async () => result,
					publishNow: async () => result,
					retry: async () => result,
					cancel: async () => result,
					delete: async () => result
				})
			});
			session.edit(draft('Pending action'));
			await session.save();
			const pending =
				operation === 'schedule'
					? session.schedule()
					: operation === 'publish'
						? session.publishNow()
						: operation === 'retry'
							? session.retry('account-1')
							: operation === 'cancel'
								? session.cancel()
								: session.delete();
			const pendingPhase = {
				schedule: 'scheduling',
				publish: 'publishing',
				retry: 'retrying',
				cancel: 'cancelling',
				delete: 'deleting'
			}[operation];
			for (let turn = 0; turn < 8 && session.snapshot.phase !== pendingPhase; turn += 1) {
				await Promise.resolve();
			}
			await session.requestWorkspaceSwitch({
				fromWorkspaceId: 'workspace-1',
				toWorkspaceId: 'workspace-2',
				toWorkspaceName: 'Second Workspace',
				dirty: false,
				adapters: quietSwitchAdapters()
			});
			// SAFETY: Promise<never> is the shared pending seam for methods with action and void results;
			// the session is inactive before this synthetic late completion is released.
			finish((operation === 'delete' ? undefined : action) as never);
			await pending;

			expect(session.snapshot).toMatchObject({
				publicationId: 'publication-1',
				revision: 1,
				status: 'draft',
				delivery: []
			});
		}
	);

	it('keeps server-assigned segment identity for the first edit after creation', async () => {
		const firstDraft: PublicationDraft = {
			...draft('First idea'),
			segments: [{ body: 'First idea', media: [] }]
		};
		const updates: PublicationDraft[] = [];
		const client = clientWith({
			async create(workspaceId, input) {
				const [segment] = input.segments ?? [];
				if (!segment) throw new Error('Test draft has no segment.');
				return {
					id: 'publication-1',
					workspace_id: workspaceId,
					revision: 1,
					status: 'draft',
					draft: {
						...input,
						segments: [{ ...segment, id: 'server-segment-1' }]
					}
				};
			},
			async update(_publicationID, _revision, input) {
				updates.push(input);
				return { id: 'publication-1', workspace_id: 'workspace-1', revision: 2, status: 'draft' };
			}
		});
		const session = new ComposerSession({ workspaceId: 'workspace-1', client });

		session.edit(firstDraft);
		await session.save();
		session.edit({
			...firstDraft,
			source_text: 'Second idea',
			segments: [{ body: 'Second idea', media: [] }]
		});
		await session.save();

		expect(updates).toHaveLength(1);
		expect(updates[0].segments?.[0]?.id).toBe('server-segment-1');
	});

	it('serializes queued saves and sends the last accepted revision', async () => {
		let finishCreate!: (publication: {
			id: string;
			workspace_id: string;
			revision: number;
			status: string;
		}) => void;
		const createResult = new Promise<{
			id: string;
			workspace_id: string;
			revision: number;
			status: string;
		}>((resolve) => (finishCreate = resolve));
		const calls: string[] = [];
		const client = clientWith({
			async create() {
				calls.push('create');
				return createResult;
			},
			async update(_id, revision, input) {
				calls.push(`update:${revision}:${input.source_text}`);
				return { id: 'publication-1', workspace_id: 'workspace-1', revision: 2, status: 'draft' };
			}
		});
		const session = new ComposerSession({ workspaceId: 'workspace-1', client });

		session.edit(draft('First'));
		const firstSave = session.save();
		session.edit(draft('Second'));
		const secondSave = session.save();
		await Promise.resolve();
		expect(calls).toEqual(['create']);

		finishCreate({
			id: 'publication-1',
			workspace_id: 'workspace-1',
			revision: 1,
			status: 'draft'
		});
		await Promise.all([firstSave, secondSave]);

		expect(calls).toEqual(['create', 'update:1:Second']);
		expect(session.snapshot).toMatchObject({ revision: 2, dirty: false, phase: 'idle' });
	});

	it('keeps a failed save dirty and retries it from the last accepted revision', async () => {
		let attempts = 0;
		const client = clientWith({
			async create(workspaceId) {
				return { id: 'publication-1', workspace_id: workspaceId, revision: 1, status: 'draft' };
			},
			async update(_id, revision) {
				attempts += 1;
				expect(revision).toBe(1);
				if (attempts === 1) throw new ComposerClientError('unavailable', 'Network unavailable');
				return { id: 'publication-1', workspace_id: 'workspace-1', revision: 2, status: 'draft' };
			}
		});
		const session = new ComposerSession({ workspaceId: 'workspace-1', client });
		session.edit(draft('First'));
		await session.save();
		session.edit(draft('Changed'));

		await expect(session.save()).rejects.toThrow('Network unavailable');
		expect(session.snapshot).toMatchObject({
			revision: 1,
			dirty: true,
			error: 'Network unavailable'
		});

		await session.save();
		expect(session.snapshot).toMatchObject({ revision: 2, dirty: false, error: null });
	});

	it('enters an explicit conflict state when another session accepts a revision first', async () => {
		let serverRevision = 1;
		const client = clientWith({
			async load(id) {
				return {
					publication: {
						id,
						workspace_id: 'workspace-1',
						revision: serverRevision,
						status: 'draft'
					},
					draft: draft('Shared')
				};
			},
			async update(id, expectedRevision) {
				if (expectedRevision !== serverRevision) {
					throw new ComposerClientError('conflict', 'Revision conflict', serverRevision);
				}
				serverRevision += 1;
				return {
					id,
					workspace_id: 'workspace-1',
					revision: serverRevision,
					status: 'draft'
				};
			}
		});
		const first = new ComposerSession({ workspaceId: 'workspace-1', client });
		const second = new ComposerSession({ workspaceId: 'workspace-1', client });
		await Promise.all([first.load('publication-1'), second.load('publication-1')]);

		first.edit(draft('First tab'));
		await first.save();
		second.edit(draft('Second tab'));
		await expect(second.save()).rejects.toThrow('Revision conflict');

		expect(second.snapshot.conflict).toEqual({ expectedRevision: 1, currentRevision: 2 });
		expect(second.snapshot).toMatchObject({ revision: 1, dirty: true, phase: 'idle' });
		await expect(second.save()).rejects.toThrow('Revision conflict');
		expect(serverRevision).toBe(2);
		await second.overwriteConflict();
		expect(second.snapshot).toMatchObject({ revision: 3, conflict: null, dirty: false });
	});

	it('keeps destination validation issues in observable session state', async () => {
		const issue = {
			code: 'text_too_long',
			fallback_message: 'Text is too long',
			message: 'Text is too long',
			severity: 'error',
			scope: 'rendition',
			scope_id: 'account-1'
		};
		const client = clientWith({
			async create(workspaceId) {
				return { id: 'publication-1', workspace_id: workspaceId, revision: 1, status: 'draft' };
			},
			async validate() {
				return { issues: [issue] };
			}
		});
		const session = new ComposerSession({ workspaceId: 'workspace-1', client });
		session.edit(draft('Needs validation'));

		expect(await session.validate()).toEqual([issue]);
		expect(session.snapshot.validationIssues).toEqual([issue]);
	});

	it('publishes now only after saving and validation', async () => {
		const calls: string[] = [];
		const client = clientWith({
			async create(workspaceId) {
				calls.push('create');
				return { id: 'publication-1', workspace_id: workspaceId, revision: 1, status: 'draft' };
			},
			async validate() {
				calls.push('validate');
				return { issues: [] };
			},
			async publishNow(id, revision) {
				calls.push(`publish:${id}:${revision}`);
				return { message: 'Publishing', publication_id: id, revision: 2, renditions: [] };
			}
		});
		const session = new ComposerSession({ workspaceId: 'workspace-1', client });
		session.edit(draft('Publish this'));

		await session.publishNow();

		expect(calls).toEqual(['create', 'validate', 'publish:publication-1:1']);
		expect(session.snapshot).toMatchObject({ status: 'publishing', revision: 2 });
	});

	it('retries one failed Rendition through the Publication client', async () => {
		const client = clientWith({
			async create(workspaceId) {
				return { id: 'publication-1', workspace_id: workspaceId, revision: 1, status: 'failed' };
			},
			async retry(id, accountId, targetKey) {
				expect([id, accountId, targetKey]).toEqual(['publication-1', 'account-1', 'feed']);
				return {
					message: 'Retry queued',
					publication_id: id,
					renditions: [
						{
							id: 'rendition-1',
							platform: 'bluesky',
							social_account_id: accountId,
							status: 'pending',
							target_key: targetKey ?? ''
						}
					]
				};
			}
		});
		const session = new ComposerSession({ workspaceId: 'workspace-1', client });
		session.edit(draft('Retry this'));
		await session.save();

		await session.retry('account-1', 'feed');

		expect(session.snapshot.delivery[0]).toMatchObject({ id: 'rendition-1', status: 'pending' });
	});

	it('cancels scheduled delivery with the accepted revision', async () => {
		const client = clientWith({
			async create(workspaceId) {
				return { id: 'publication-1', workspace_id: workspaceId, revision: 3, status: 'scheduled' };
			},
			async cancel(id, revision) {
				expect([id, revision]).toEqual(['publication-1', 3]);
				return { message: 'Cancelled', publication_id: id, revision: 4, renditions: [] };
			}
		});
		const session = new ComposerSession({ workspaceId: 'workspace-1', client });
		session.edit(draft('Cancel this'));
		await session.save();

		await session.cancel();

		expect(session.snapshot).toMatchObject({ status: 'draft', revision: 4 });
	});

	it('deletes the Publication with explicit revision confirmation', async () => {
		const client = clientWith({
			async create(workspaceId) {
				return { id: 'publication-1', workspace_id: workspaceId, revision: 2, status: 'draft' };
			},
			async delete(id, revision) {
				expect([id, revision]).toEqual(['publication-1', 2]);
			}
		});
		const session = new ComposerSession({ workspaceId: 'workspace-1', client });
		session.edit(draft('Delete this'));
		await session.save();

		await session.delete();

		expect(session.snapshot).toMatchObject({
			publicationId: null,
			revision: null,
			status: 'deleted',
			dirty: false
		});
	});

	it('resets a completed new-publication session for the next success path', async () => {
		const client = clientWith({
			async create(workspaceId) {
				return { id: 'publication-1', workspace_id: workspaceId, revision: 1, status: 'draft' };
			}
		});
		const session = new ComposerSession({ workspaceId: 'workspace-1', client });
		session.edit(draft('Done'));
		await session.save();

		session.reset();

		expect(session.draft).toBeNull();
		expect(session.snapshot).toMatchObject({
			publicationId: null,
			revision: null,
			status: null,
			dirty: false,
			validationIssues: [],
			delivery: []
		});
	});

	it('binds an editor return to its Workspace, Publication, revision, and one-time token', async () => {
		const session = new ComposerSession({
			workspaceId: 'workspace-1',
			client: clientWith({
				async create(workspaceId) {
					return { id: 'publication-1', workspace_id: workspaceId, revision: 4, status: 'draft' };
				}
			})
		});
		session.edit(draft('Open in editor'));
		await session.save();

		const binding = session.bindEditorHandoff('return-token');
		expect(binding).toEqual({
			workspaceId: 'workspace-1',
			publicationId: 'publication-1',
			revision: 4,
			returnToken: 'return-token'
		});
		expect(session.acceptEditorHandoff(binding)).toEqual(binding);
		expect(() => session.acceptEditorHandoff(binding)).toThrow('editor_return_already_used');
	});

	it('fails editor returns closed when their Workspace or Publication binding changes', async () => {
		const session = new ComposerSession({
			workspaceId: 'workspace-1',
			client: clientWith({
				async create(workspaceId) {
					return { id: 'publication-1', workspace_id: workspaceId, revision: 2, status: 'draft' };
				}
			})
		});
		session.edit(draft('Bound editor'));
		await session.save();

		expect(() =>
			session.acceptEditorHandoff({
				workspaceId: 'workspace-2',
				publicationId: 'publication-1',
				revision: 2,
				returnToken: 'workspace-token'
			})
		).toThrow('editor_return_workspace_mismatch');
		expect(() =>
			session.acceptEditorHandoff({
				workspaceId: 'workspace-1',
				publicationId: 'publication-2',
				revision: 2,
				returnToken: 'publication-token'
			})
		).toThrow('editor_return_publication_mismatch');
	});

	it('restores the handoff revision so a stale return uses the normal save conflict path', async () => {
		let serverRevision = 4;
		const session = new ComposerSession({
			workspaceId: 'workspace-1',
			client: clientWith({
				async load(id) {
					return {
						publication: {
							id,
							workspace_id: 'workspace-1',
							revision: serverRevision,
							status: 'draft'
						},
						draft: draft('Current')
					};
				},
				async update(id, expectedRevision) {
					if (expectedRevision !== serverRevision) {
						throw new ComposerClientError('conflict', 'Revision conflict', serverRevision);
					}
					serverRevision += 1;
					return { id, workspace_id: 'workspace-1', revision: serverRevision, status: 'draft' };
				}
			})
		});
		await session.load('publication-1');

		session.acceptEditorHandoff({
			workspaceId: 'workspace-1',
			publicationId: 'publication-1',
			revision: 3,
			returnToken: 'stale-token'
		});
		session.edit(draft('Returned editor change'));

		await expect(session.save()).rejects.toThrow('Revision conflict');
		expect(session.snapshot.conflict).toEqual({ expectedRevision: 3, currentRevision: 4 });
	});
});
