import { afterEach, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import RecordPage from './+page.svelte';
import { CloudVideoProjectRepository } from '$lib/video-editor/cloud/project-repository';
import { recorderPreferences } from '$lib/video-editor/recorder/recorder-preferences.svelte';
import { ScreenCaptureRecorder } from '$lib/video-editor/recorder/recorder.svelte';
import { workspaceCtx } from '$lib/stores/workspace.svelte';
import type { Workspace } from '$lib/api/client';
import { queryClient } from '$lib/query/client';
import { mediaQueryKeys } from '@openpost/query-catalog';
import type { RecorderCloudDocument } from '$lib/video-editor/cloud/cloud-recording';
import '../layout.css';

const workspace = {
	id: 'recording-workspace',
	name: 'Recorder fixture',
	avatar_url: '',
	color: '#f97316',
	created_at: '2026-09-01T10:00:00Z',
	organization_id: '',
	organization_name: '',
	role: 'admin',
	can_edit: true,
	sso_required: false,
	sso_authenticated: true,
	sso_identity_linked: true
} satisfies Workspace;

afterEach(() => vi.restoreAllMocks());

async function recordingFixture() {
	const priorWorkspace = workspaceCtx.currentWorkspace;
	const priorPreferences = { ...recorderPreferences.value };
	workspaceCtx.currentWorkspace = workspace;
	recorderPreferences.set('includeScreen', true);
	recorderPreferences.set('includeCamera', false);
	recorderPreferences.set('includeMicrophone', false);
	recorderPreferences.set('countdownSeconds', 0);
	const canvas = document.createElement('canvas');
	canvas.width = 160;
	canvas.height = 90;
	const context = canvas.getContext('2d')!;
	context.fillStyle = 'red';
	context.fillRect(0, 0, 160, 90);
	const stream = canvas.captureStream(30);
	vi.spyOn(navigator.mediaDevices, 'getDisplayMedia').mockResolvedValue(stream);
	const screen = await render(RecordPage);
	const drawing = setInterval(() => context.fillRect(0, 0, 160, 90), 33);
	let disposed = false;
	return {
		screen,
		async dispose() {
			if (disposed) return;
			disposed = true;
			clearInterval(drawing);
			await screen.unmount();
			screen.container.remove();
			await new ScreenCaptureRecorder().clearRecoverableAndDiscard();
			stream.getTracks().forEach((track) => track.stop());
			workspaceCtx.currentWorkspace = priorWorkspace;
			recorderPreferences.set('includeScreen', priorPreferences.includeScreen);
			recorderPreferences.set('includeCamera', priorPreferences.includeCamera);
			recorderPreferences.set('includeMicrophone', priorPreferences.includeMicrophone);
			recorderPreferences.set('countdownSeconds', priorPreferences.countdownSeconds);
		}
	};
}

it('keeps ordinary cloud recording saves out of recovery until persistence fails', async () => {
	const fixture = await recordingFixture();
	const { screen } = fixture;
	let rejectSave: (error: Error) => void = () => {};
	const create = vi.spyOn(CloudVideoProjectRepository.prototype, 'createWithId').mockImplementation(
		() =>
			new Promise((_, reject) => {
				rejectSave = reject;
			})
	);
	const stop = vi.spyOn(ScreenCaptureRecorder.prototype, 'stop');
	try {
		await screen.getByRole('button', { name: 'Start recording', exact: true }).click();
		await expect
			.element(screen.getByRole('button', { name: 'Stop and save', exact: true }))
			.toBeVisible();
		await new Promise((resolve) => setTimeout(resolve, 350));
		await screen.getByRole('button', { name: 'Stop and save', exact: true }).click();
		await expect.poll(() => create.mock.calls.length).toBe(1);
		const artifacts = await stop.mock.results[0]!.value;
		expect(artifacts[0].blob.size).toBeGreaterThan(0);
		expect(artifacts[0].scratchId).toBeDefined();
		await expect.element(screen.getByRole('status')).toHaveTextContent('Saving');
		await expect
			.element(screen.getByRole('button', { name: 'Save to OpenPost', exact: true }))
			.not.toBeInTheDocument();
		await expect
			.element(screen.getByRole('button', { name: 'Remove recording', exact: true }))
			.not.toBeInTheDocument();
		await expect
			.element(screen.getByRole('button', { name: 'Start recording', exact: true }))
			.not.toBeInTheDocument();
		rejectSave(new Error('Fixture cloud storage unavailable'));
		await expect
			.element(screen.getByRole('button', { name: 'Save to OpenPost', exact: true }))
			.toBeEnabled();
		await expect.element(screen.getByText('A recording is still on this device.')).toBeVisible();
		const recovered = await new ScreenCaptureRecorder().loadRecoverableArtifacts();
		expect(recovered[0].sizeBytes).toBe(artifacts[0].sizeBytes);
		screen.getByRole('button', { name: 'Remove recording', exact: true }).element().focus();
		await userEvent.keyboard('{Enter}');
		await expect
			.element(screen.getByRole('button', { name: 'Save to OpenPost', exact: true }))
			.not.toBeInTheDocument();
		expect(await new ScreenCaptureRecorder().loadRecoverableArtifacts()).toEqual([]);
	} finally {
		rejectSave(new Error('Fixture teardown'));
		await fixture.dispose();
	}
});

it('finishes a normal cloud handoff once before releasing scratch and exposing its Edit link', async () => {
	let completeCreate: () => void = () => {};
	let savedDocument: RecorderCloudDocument | undefined;
	const create = vi
		.spyOn(CloudVideoProjectRepository.prototype, 'createWithId')
		.mockImplementation(async (id, name, document) => {
			await new Promise<void>((resolve) => {
				completeCreate = resolve;
			});
			// SAFETY: This adapter receives the captured-video document authored by the real recorder cloud service.
			savedDocument = structuredClone(document) as RecorderCloudDocument;
			return {
				id,
				name,
				document,
				workspaceId: workspace.id,
				headRevision: 1,
				syncStatus: 'synced',
				attentionReason: '',
				trashedAt: '',
				updatedAt: '2026-10-02T10:00:00Z'
			};
		});
	const reserve = vi
		.spyOn(CloudVideoProjectRepository.prototype, 'reserveAsset')
		.mockResolvedValue('fixture-asset');
	queryClient.setQueryData(mediaQueryKeys.storage(workspace.id), { direct_upload_supported: true });
	const originalFetch = globalThis.fetch;
	const upload = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
		if (String(input).endsWith('/media/upload-session'))
			return Promise.resolve(
				Response.json({
					media_id: 'saved-media',
					deduped: true,
					complete_url: '/api/v1/media/upload-session/saved-media/complete',
					upload: {
						method: 'PUT',
						url: '/api/v1/media/upload-session/saved-media/content',
						headers: {},
						expires_at: '2099-01-01T00:00:00Z',
						object_key: 'fixture.webm'
					}
				})
			);
		return originalFetch(input, init);
	});
	const fixture = await recordingFixture();
	const { screen } = fixture;
	try {
		await screen.getByRole('button', { name: 'Start recording', exact: true }).click();
		await expect
			.element(screen.getByRole('button', { name: 'Stop and save', exact: true }))
			.toBeVisible();
		await new Promise((resolve) => setTimeout(resolve, 350));
		await screen.getByRole('button', { name: 'Stop and save', exact: true }).click();
		await expect.poll(() => create.mock.calls.length).toBe(1);
		await expect.element(screen.getByRole('status')).toHaveTextContent('Saving');
		expect(
			(await new ScreenCaptureRecorder().loadRecoverableArtifacts())[0].sizeBytes
		).toBeGreaterThan(0);
		completeCreate();
		const link = screen.getByRole('link', { name: 'Open video editor', exact: true });
		await expect.element(link).toBeVisible();
		expect(link.element().getAttribute('href')).toContain('?storage=cloud&workspace=edit');
		expect(savedDocument?.timeline?.items).toHaveLength(1);
		expect(savedDocument?.metadata.width).toBe(160);
		expect(savedDocument?.metadata.height).toBe(90);
		expect(reserve).toHaveBeenCalledOnce();
		expect(
			upload.mock.calls.filter(([input]) => String(input).endsWith('/media/upload-session'))
		).toHaveLength(1);
		expect(await new ScreenCaptureRecorder().loadRecoverableArtifacts()).toEqual([]);
		await fixture.dispose();
		const reopened = await render(RecordPage);
		await expect
			.element(reopened.getByRole('button', { name: 'Start recording', exact: true }))
			.toBeVisible();
		await expect
			.element(reopened.getByText('A recording is still on this device.'))
			.not.toBeInTheDocument();
		await reopened.unmount();
		reopened.container.remove();
	} finally {
		completeCreate();
		await fixture.dispose();
		queryClient.clear();
	}
});
