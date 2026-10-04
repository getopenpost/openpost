import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import { QueryClientProvider } from '@tanstack/svelte-query';
import { queryClient } from '$lib/query/client';
import { createBlankProject } from '$lib/video-editor/project/defaults';
import { createProject, getProject } from '$lib/video-editor/workspace-fs/projects';
import { setWorkspaceRoot } from '$lib/video-editor/workspace-fs/root';
import { saveWorkspaceHandleRecord } from '$lib/video-editor/workspace-fs/handles-db';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import { editorSession } from '$lib/video-editor/editor.svelte';
import { mediaRecovery } from '$lib/video-editor/media/media-recovery.svelte';
import { createFloat32WavBlob } from '$lib/video-editor/local-ai/audio';
import { kokoroTtsService } from '$lib/video-editor/local-ai/tts/kokoro-service';
import {
	getStoredLocalTtsEngine,
	setStoredLocalTtsEngine
} from '$lib/video-editor/local-ai/tts/preferences';
import VideoEditorPage from './+page.svelte';
import '../../layout.css';

const route = vi.hoisted(() => ({
	params: { id: '' },
	url: new URL('https://example.com/video-editor')
}));
// SvelteKit supplies route identity in the app; the component runner has no router.
// oxlint-disable-next-line anti-slop/no-module-mocking
vi.mock('$app/state', () => ({ page: route }));

const initialEngine = getStoredLocalTtsEngine();
let permissionPrototype: object;
let originalPermission: PropertyDescriptor | undefined;

afterEach(async () => {
	editorSession.stopAutosaveTimers();
	await editorSession.flushAutosave();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	setStoredLocalTtsEngine(initialEngine);
	if (permissionPrototype) {
		if (originalPermission)
			Object.defineProperty(permissionPrototype, 'queryPermission', originalPermission);
		else Reflect.deleteProperty(permissionPrototype, 'queryPermission');
	}
});

it.each([
	{ linked: true, link: true },
	{ linked: false, link: true },
	{ linked: true, link: false }
])(
	'generated voice link=$link selection=$linked preserves nudge and Undo',
	async ({ linked, link }) => {
		await page.viewport(1280, 850);
		const root = await (
			await navigator.storage.getDirectory()
		).getDirectoryHandle(crypto.randomUUID(), { create: true });
		vi.stubGlobal('showDirectoryPicker', async () => root);
		vi.stubGlobal('showOpenFilePicker', async () => []);
		permissionPrototype = Object.getPrototypeOf(root);
		originalPermission = Object.getOwnPropertyDescriptor(permissionPrototype, 'queryPermission');
		Object.defineProperty(permissionPrototype, 'queryPermission', {
			configurable: true,
			value: async () => 'granted'
		});
		setWorkspaceRoot(root);
		await saveWorkspaceHandleRecord(root);
		const project = createBlankProject('Generated voice selection');
		const timeline = project.timeline;
		if (!timeline) throw new Error('Blank project has no timeline');
		timeline.items = [
			{
				id: 'title',
				type: 'text',
				trackId: timeline.tracks[0]!.id,
				from: 10,
				durationInFrames: 150,
				label: 'Hello',
				text: 'Hello',
				fontSize: 60,
				color: '#ffffff',
				transform: { x: 960, y: 540, width: 600, height: 100, opacity: 1 }
			}
		];
		await createProject(project);
		route.params.id = project.id;
		route.url = new URL(`https://example.com/video-editor/${project.id}`);
		const blob = createFloat32WavBlob([new Float32Array(24000)], 24000);
		setStoredLocalTtsEngine('kokoro');
		vi.spyOn(kokoroTtsService, 'generateSpeechFile').mockResolvedValue({
			blob,
			file: new File([blob], 'controlled-voice.wav', { type: 'audio/wav' }),
			duration: 1,
			sampleRate: 24000
		});
		if (!linked) {
			// Loading exposes the project before media recovery finishes; keep this case in that gap.
			const originalScan = mediaRecovery.scan.bind(mediaRecovery);
			vi.spyOn(mediaRecovery, 'scan').mockImplementation(async (...args) => {
				await new Promise((resolve) => setTimeout(resolve, 500));
				return originalScan(...args);
			});
		}
		const screen = await render(
			VideoEditorPage,
			{},
			{
				wrapper: QueryClientProvider,
				wrapperProps: { client: queryClient }
			}
		);
		await expect.poll(() => editorSession.project?.id).toBe(project.id);
		const title = screen.getByRole('button', { name: /^Hello\./ });
		await expect.element(title).toBeVisible();
		if (timelineStore.linkedSelectionEnabled !== linked)
			await userEvent.keyboard('{Shift>}l{/Shift}');
		expect(timelineStore.linkedSelectionEnabled).toBe(linked);
		await title.click();
		await screen.getByRole('button', { name: 'Create voice from text', exact: true }).click();
		if (!link) await screen.getByRole('button', { name: 'Use playhead', exact: true }).click();
		await screen.getByRole('button', { name: 'Generate voiceover', exact: true }).click();
		await screen
			.getByRole('button', {
				name: link ? 'Add and link' : 'Add at playhead',
				exact: true
			})
			.click();
		await expect
			.poll(() => timelineStore.items.filter((item) => item.type === 'audio').length)
			.toBe(1);
		const audio = timelineStore.items.find((item) => item.type === 'audio')!;
		if (link) {
			expect(audio.linkedGroupId).toEqual(expect.any(String));
			expect(audio.linkedGroupId).toBe(timelineStore.itemById.get('title')?.linkedGroupId);
		} else expect(audio.linkedGroupId).toBeUndefined();
		await expect.element(title).toHaveAttribute('aria-pressed', String(linked && link));
		await screen
			.getByRole('button', { name: /^controlled-voice\.wav\. Drag/ })
			.element()
			.focus();
		await userEvent.keyboard('{ArrowRight}');
		await expect.poll(() => timelineStore.itemById.get(audio.id)?.from).toBe(link ? 11 : 1);
		expect(timelineStore.itemById.get('title')?.from).toBe(linked && link ? 11 : 10);
		const modifier = navigator.platform.includes('Mac') ? 'Meta' : 'Control';
		await userEvent.keyboard(`{${modifier}>}z{/${modifier}}`);
		await expect.poll(() => timelineStore.itemById.get(audio.id)?.from).toBe(link ? 10 : 0);
		expect(timelineStore.itemById.get('title')?.from).toBe(10);
		await editorSession.flushAutosave();
		const stored = await getProject(project.id);
		expect(stored?.timeline?.items.find((item) => item.id === audio.id)?.from).toBe(link ? 10 : 0);
		expect(stored?.timeline?.items.find((item) => item.id === 'title')?.from).toBe(10);
		for (const width of linked && link ? [1280, 390, 320] : []) {
			await page.viewport(width, 850);
			for (const dark of [false, true]) {
				document.documentElement.classList.toggle('dark', dark);
				await page.screenshot({
					path: `__screenshots__/lc001-${linked}-${link}-${width}-${dark ? 'dark' : 'light'}.png`
				});
			}
		}
		document.documentElement.classList.remove('dark');
		await screen.unmount();
	}
);
