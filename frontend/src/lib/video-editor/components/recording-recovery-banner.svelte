<script lang="ts">
	import { onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	import { showToast } from '$lib/toast';
	import {
		discardRecordingSession,
		listRecoverableSessions,
		readRecordingBlob,
		readRecordingCursor,
		type RecordingSessionManifest
	} from '$lib/video-editor/recorder/recording-sessions';
	import { insertRecordingAtPlayhead } from '$lib/video-editor/recorder/insert-recording';

	interface Props {
		projectId: string;
		onRecovered?: (itemId: string) => void;
	}

	let { projectId, onRecovered }: Props = $props();
	let sessions = $state<RecordingSessionManifest[]>([]);
	let busyId = $state<string | null>(null);

	async function refresh(): Promise<void> {
		try {
			sessions = await listRecoverableSessions();
		} catch {
			sessions = [];
		}
	}

	onMount(() => {
		void refresh();
		const id = setInterval(() => void refresh(), 4000);
		return () => clearInterval(id);
	});

	async function handleRecover(session: RecordingSessionManifest): Promise<void> {
		if (busyId) return;
		busyId = session.id;
		try {
			const blob = await readRecordingBlob(session.id);
			if (!blob || blob.size === 0) {
				showToast(m.video_editor_recording_error_codec(), 'error');
				return;
			}
			const cursor = await readRecordingCursor(session.id);
			const kind = session.source === 'audio' ? 'audio' : 'video';
			const stamp = new Date(session.createdAt).toISOString().slice(0, 19).replace(/[:.]/g, '-');
			const fileName = `recovered-${session.source}-${stamp}.webm`;
			const itemId = await insertRecordingAtPlayhead({
				blob,
				mimeType: session.mimeType,
				projectId,
				fileName,
				kind
			});
			if (!itemId) {
				showToast(m.video_editor_recording_insert_failed(), 'error');
				return;
			}
			await discardRecordingSession(session.id);
			sessions = sessions.filter((s) => s.id !== session.id);
			onRecovered?.(itemId);
			showToast(m.video_editor_recording_inserted(), 'success');
			if (cursor && cursor.mode === 'hidden') {
				showToast(m.video_editor_recording_cursor_burned_in(), 'info');
			}
		} catch (error) {
			showToast(error instanceof Error ? error.message : String(error), 'error');
		} finally {
			busyId = null;
			void refresh();
		}
	}

	async function handleDiscard(session: RecordingSessionManifest): Promise<void> {
		if (busyId) return;
		if (!confirm(m.video_editor_recording_discard_confirm())) return;
		busyId = session.id;
		try {
			await discardRecordingSession(session.id);
			sessions = sessions.filter((s) => s.id !== session.id);
			showToast(m.video_editor_recording_cancelled_hint(), 'info');
		} catch (error) {
			showToast(error instanceof Error ? error.message : String(error), 'error');
		} finally {
			busyId = null;
		}
	}
</script>

{#if sessions.length > 0}
	<section
		aria-label={m.video_editor_recording_recover_title()}
		class="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3"
	>
		<div class="flex flex-wrap items-center justify-between gap-2">
			<div class="min-w-0">
				<p class="text-sm font-medium text-amber-100">{m.video_editor_recording_recover_title()}</p>
				<p class="text-xs text-amber-100/80">{m.video_editor_recording_recover_description()}</p>
			</div>
		</div>
		<ul class="mt-2 space-y-2">
			{#each sessions as session (session.id)}
				<li
					class="flex flex-wrap items-center justify-between gap-2 rounded-md bg-[oklch(0.18_0.01_55)] p-2"
				>
					<span class="text-xs text-[oklch(0.85_0.01_55)]">
						{session.source} · {session.chunks.length} chunks · {new Date(
							session.createdAt
						).toLocaleString()}
					</span>
					<span class="flex gap-1.5">
						<Button
							size="xs"
							variant="outline"
							disabled={busyId === session.id}
							onclick={() => void handleRecover(session)}
							aria-label={m.video_editor_recording_recover_action()}
						>
							{m.video_editor_recording_recover_action()}
						</Button>
						<Button
							size="xs"
							variant="ghost"
							disabled={busyId === session.id}
							onclick={() => void handleDiscard(session)}
							aria-label={m.video_editor_recording_discard_action()}
						>
							{m.video_editor_recording_discard_action()}
						</Button>
					</span>
				</li>
			{/each}
		</ul>
	</section>
{/if}
