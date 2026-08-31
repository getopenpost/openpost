<script lang="ts">
	import { onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import RotateIcon from '@lucide/svelte/icons/rotate-ccw';
	import UploadIcon from '@lucide/svelte/icons/upload';
	import {
		EDITOR_SHORTCUT_DEFINITIONS,
		browserShortcutConflict,
		createShortcutPreset,
		findShortcutConflicts,
		formatShortcutBindingWithLabels,
		hasShortcutPrimaryToken,
		parseShortcutPreset,
		resolveEditorShortcuts,
		shortcutBindingFromEvent,
		type EditorShortcutDefinition,
		type EditorShortcutId,
		type EditorShortcutSection,
		type ShortcutPresetImport
	} from '$lib/video-editor/settings/keyboard-shortcuts';
	import {
		keyboardLayoutLabelForToken,
		loadKeyboardLayoutMap,
		type KeyboardLayoutApi
	} from '$lib/video-editor/settings/keyboard-layout';
	import { keyboardShortcuts } from '$lib/video-editor/settings/keyboard-shortcuts.svelte';

	type Filter = 'all' | 'custom' | 'conflicts' | 'unassigned';
	type Feedback = { tone: 'success' | 'error'; text: string };

	let search = $state('');
	let filter = $state<Filter>('all');
	let captureId = $state<EditorShortcutId | null>(null);
	let draftBinding = $state('');
	let feedback = $state<Feedback | null>(null);
	let confirmReset = $state(false);
	let importInput = $state<HTMLInputElement | null>(null);
	let layoutMap = $state<ReadonlyMap<string, string> | null>(null);
	let layoutStatus = $state<'loading' | 'native' | 'fallback'>('loading');

	onMount(() => {
		let cancelled = false;
		// SAFETY: Keyboard Map is an optional Chromium API, so the extended field may be absent.
		const keyboard = (navigator as Navigator & { keyboard?: KeyboardLayoutApi }).keyboard;
		void loadKeyboardLayoutMap(keyboard).then((map) => {
			if (cancelled) return;
			layoutMap = map;
			layoutStatus = map ? 'native' : 'fallback';
		});
		return () => {
			cancelled = true;
		};
	});

	function formatBinding(binding: string): string {
		return formatShortcutBindingWithLabels(binding, {
			labelForToken: (token) => keyboardLayoutLabelForToken(layoutMap, token)
		});
	}

	const commandLabels = {
		PLAY_PAUSE: m.video_editor_shortcuts_command_play_pause,
		PREVIOUS_FRAME: m.video_editor_shortcuts_command_previous_frame,
		NEXT_FRAME: m.video_editor_shortcuts_command_next_frame,
		GO_TO_START: m.video_editor_shortcuts_command_go_to_start,
		GO_TO_END: m.video_editor_shortcuts_command_go_to_end,
		PREVIOUS_SNAP_POINT: m.video_editor_shortcuts_command_previous_edit_point,
		NEXT_SNAP_POINT: m.video_editor_shortcuts_command_next_edit_point,
		SHUTTLE_REVERSE: m.video_editor_shortcuts_command_shuttle_reverse,
		SHUTTLE_PAUSE: m.video_editor_shortcuts_command_shuttle_pause,
		SHUTTLE_FORWARD: m.video_editor_shortcuts_command_shuttle_forward,
		MARK_IN: m.video_editor_mark_in,
		MARK_OUT: m.video_editor_mark_out,
		CLEAR_IN_OUT: m.video_editor_source_clear_marks,
		QUICK_CUT_ADD_SEGMENT: m.quick_cut_add_segment,
		QUICK_CUT_TOGGLE_LOOP: m.quick_cut_loop_label,
		INSERT_EDIT: m.video_editor_source_insert,
		OVERWRITE_EDIT: m.video_editor_source_overwrite,
		SPLIT_AT_PLAYHEAD: m.video_editor_shortcuts_command_split,
		SPLIT_AT_PLAYHEAD_ALT: m.video_editor_shortcuts_command_split_alt,
		SPLIT_AT_CURSOR: m.video_editor_shortcuts_command_split_cursor,
		JOIN_ITEMS: m.video_editor_shortcuts_command_join,
		CLEAR_KEYFRAMES: m.video_editor_shortcuts_command_clear_keyframes,
		DELETE_SELECTED: m.video_editor_shortcuts_command_delete,
		DELETE_SELECTED_ALT: m.video_editor_shortcuts_command_delete_alt,
		RIPPLE_DELETE: m.video_editor_shortcuts_command_ripple_delete,
		RIPPLE_DELETE_ALT: m.video_editor_shortcuts_command_ripple_delete_alt,
		FREEZE_FRAME: m.video_editor_shortcuts_command_freeze,
		LINK_AUDIO_VIDEO: m.video_editor_shortcuts_command_link,
		UNLINK_AUDIO_VIDEO: m.video_editor_shortcuts_command_unlink,
		TOGGLE_LINKED_SELECTION: m.video_editor_shortcuts_command_linked_selection,
		NUDGE_LEFT: m.video_editor_shortcuts_command_nudge_left,
		NUDGE_RIGHT: m.video_editor_shortcuts_command_nudge_right,
		NUDGE_UP: m.video_editor_shortcuts_command_nudge_up,
		NUDGE_DOWN: m.video_editor_shortcuts_command_nudge_down,
		NUDGE_LEFT_LARGE: m.video_editor_shortcuts_command_nudge_left_large,
		NUDGE_RIGHT_LARGE: m.video_editor_shortcuts_command_nudge_right_large,
		NUDGE_UP_LARGE: m.video_editor_shortcuts_command_nudge_up_large,
		NUDGE_DOWN_LARGE: m.video_editor_shortcuts_command_nudge_down_large,
		COPY: m.video_editor_shortcuts_command_copy,
		CUT: m.video_editor_shortcuts_command_cut,
		PASTE: m.video_editor_shortcuts_command_paste,
		COMPOSITION_DUPLICATE: m.video_editor_composition_timeline_duplicate,
		COMPOSITION_SELECT_ALL: m.image_editor_select_all,
		COMPOSITION_GROUP: m.video_editor_composition_timeline_group,
		COMPOSITION_NUDGE_LEFT: m.video_editor_shortcuts_command_composition_nudge_left,
		COMPOSITION_NUDGE_RIGHT: m.video_editor_shortcuts_command_composition_nudge_right,
		COMPOSITION_NUDGE_LEFT_FAST: m.video_editor_shortcuts_command_composition_nudge_left_fast,
		COMPOSITION_NUDGE_RIGHT_FAST: m.video_editor_shortcuts_command_composition_nudge_right_fast,
		COMPOSITION_REORDER_UP: m.video_editor_shortcuts_command_composition_reorder_up,
		COMPOSITION_REORDER_DOWN: m.video_editor_shortcuts_command_composition_reorder_down,
		TRACK_RENAME: m.video_editor_shortcuts_command_track_rename,
		TRACK_MOVE_UP: m.video_editor_shortcuts_command_track_move_up,
		TRACK_MOVE_DOWN: m.video_editor_shortcuts_command_track_move_down,
		UNDO: m.video_editor_shortcuts_command_undo,
		REDO: m.video_editor_shortcuts_command_redo,
		GRAPH_SELECT_ALL: m.video_editor_shortcuts_command_graph_select_all,
		GRAPH_CLEAR_SELECTION: m.video_editor_shortcuts_command_graph_clear_selection,
		GRAPH_NUDGE_LEFT: m.video_editor_shortcuts_command_graph_nudge_left,
		GRAPH_NUDGE_RIGHT: m.video_editor_shortcuts_command_graph_nudge_right,
		GRAPH_NUDGE_UP: m.video_editor_shortcuts_command_graph_nudge_up,
		GRAPH_NUDGE_DOWN: m.video_editor_shortcuts_command_graph_nudge_down,
		GRAPH_NUDGE_LEFT_FAST: m.video_editor_shortcuts_command_graph_nudge_left_fast,
		GRAPH_NUDGE_RIGHT_FAST: m.video_editor_shortcuts_command_graph_nudge_right_fast,
		GRAPH_NUDGE_UP_FAST: m.video_editor_shortcuts_command_graph_nudge_up_fast,
		GRAPH_NUDGE_DOWN_FAST: m.video_editor_shortcuts_command_graph_nudge_down_fast,
		KEYFRAME_EDITOR_GRAPH: m.video_editor_shortcuts_command_keyframe_graph,
		KEYFRAME_EDITOR_DOPESHEET: m.video_editor_shortcuts_command_keyframe_dopesheet,
		KEYFRAME_EDITOR_SPLIT: m.video_editor_shortcuts_command_keyframe_split,
		EDIT_KEYFRAME_ADD: m.video_editor_shortcuts_command_keyframe_add,
		KEYFRAME_PREVIOUS: m.video_editor_shortcuts_command_keyframe_previous,
		KEYFRAME_NEXT: m.video_editor_shortcuts_command_keyframe_next,
		KEYFRAME_TOGGLE_AUTO: m.video_editor_shortcuts_command_keyframe_auto,
		KEYFRAME_FIT: m.video_editor_shortcuts_command_keyframe_fit,
		ZOOM_IN: m.video_editor_shortcuts_command_zoom_in,
		ZOOM_OUT: m.video_editor_shortcuts_command_zoom_out,
		ZOOM_TO_FIT: m.video_editor_shortcuts_command_zoom_fit,
		ZOOM_TO_100: m.video_editor_shortcuts_command_zoom_100,
		ZOOM_TO_100_ALT: m.video_editor_shortcuts_command_zoom_100_alt,
		RATE_STRETCH_TOOL: m.video_editor_shortcuts_command_rate_stretch,
		RAZOR_TOOL: m.video_editor_shortcuts_command_razor_tool,
		SELECTION_TOOL: m.video_editor_shortcuts_command_selection_tool,
		SLIP_TOOL: m.video_editor_shortcuts_command_slip_tool,
		SLIDE_TOOL: m.video_editor_shortcuts_command_slide_tool,
		SAVE: m.video_editor_shortcuts_command_save,
		EXPORT: m.video_editor_shortcuts_command_export,
		OPEN_SETTINGS: m.video_editor_shortcuts_command_settings,
		OPEN_SCENE_BROWSER: m.video_editor_shortcuts_command_open_scene_browser,
		TOGGLE_SNAP: m.video_editor_shortcuts_command_snap,
		TOGGLE_CANVAS_SNAP: m.video_editor_shortcuts_command_canvas_snap,
		WORKSPACE_EDIT: m.video_editor_shortcuts_command_workspace_edit,
		WORKSPACE_COLOR: m.video_editor_shortcuts_command_workspace_color,
		WORKSPACE_MOTION: m.video_editor_shortcuts_command_workspace_motion,
		ADD_MARKER: m.video_editor_shortcuts_command_add_marker,
		REMOVE_MARKER: m.video_editor_shortcuts_command_remove_marker,
		PREVIOUS_MARKER: m.video_editor_shortcuts_command_previous_marker,
		NEXT_MARKER: m.video_editor_shortcuts_command_next_marker
	} satisfies Record<EditorShortcutId, () => string>;

	const sectionLabels = {
		playback: m.video_editor_shortcuts_section_playback,
		editing: m.video_editor_shortcuts_section_editing,
		timeline: m.video_editor_shortcuts_section_timeline,
		project: m.video_editor_shortcuts_section_project
	} satisfies Record<EditorShortcutSection, () => string>;
	const sectionOrder: EditorShortcutSection[] = ['playback', 'editing', 'timeline', 'project'];
	const filters: Array<{ id: Filter; label: () => string }> = [
		{ id: 'all', label: m.video_editor_shortcuts_filter_all },
		{ id: 'custom', label: m.video_editor_shortcuts_filter_custom },
		{ id: 'conflicts', label: m.video_editor_shortcuts_filter_conflicts },
		{ id: 'unassigned', label: m.video_editor_shortcuts_filter_unassigned }
	];

	const captureConflicts = $derived(
		captureId && draftBinding
			? findShortcutConflicts(keyboardShortcuts.bindings, draftBinding, captureId)
			: []
	);
	const captureBrowserConflict = $derived(
		draftBinding ? browserShortcutConflict(draftBinding) : null
	);

	function hasConflict(id: EditorShortcutId): boolean {
		return (
			findShortcutConflicts(keyboardShortcuts.bindings, keyboardShortcuts.bindings[id], id).length >
			0
		);
	}

	function filterCount(id: Exclude<Filter, 'all'>): number {
		return EDITOR_SHORTCUT_DEFINITIONS.filter(({ id: commandId }) => {
			if (id === 'custom') return commandId in keyboardShortcuts.overrides;
			if (id === 'unassigned') return keyboardShortcuts.bindings[commandId] === '';
			return hasConflict(commandId);
		}).length;
	}

	const visibleDefinitions = $derived.by(() => {
		const query = search.trim().toLowerCase();
		return EDITOR_SHORTCUT_DEFINITIONS.filter((definition) => {
			const { id } = definition;
			if (filter === 'custom' && !(id in keyboardShortcuts.overrides)) return false;
			if (filter === 'conflicts' && !hasConflict(id)) return false;
			if (filter === 'unassigned' && keyboardShortcuts.bindings[id] !== '') return false;
			if (!query) return true;
			return [
				commandLabels[id](),
				sectionLabels[definition.section](),
				formatBinding(keyboardShortcuts.bindings[id]),
				formatBinding(keyboardShortcuts.defaultBinding(id))
			].some((value) => value.toLowerCase().includes(query));
		});
	});

	function definitionsFor(section: EditorShortcutSection): readonly EditorShortcutDefinition[] {
		return visibleDefinitions.filter((definition) => definition.section === section);
	}

	function beginCapture(id: EditorShortcutId): void {
		captureId = id;
		draftBinding = '';
		feedback = null;
	}

	function cancelCapture(): void {
		captureId = null;
		draftBinding = '';
	}

	function captureKeydown(event: KeyboardEvent): void {
		if (!captureId) return;
		event.preventDefault();
		event.stopImmediatePropagation();
		if (event.key === 'Escape') {
			cancelCapture();
			return;
		}
		const binding = shortcutBindingFromEvent(event);
		if (binding && hasShortcutPrimaryToken(binding)) draftBinding = binding;
	}

	function applyCapture(replace: boolean): void {
		if (!captureId || !draftBinding) return;
		if (captureConflicts.length > 0 && !replace) return;
		const next = { ...keyboardShortcuts.overrides };
		if (replace) for (const id of captureConflicts) next[id] = '';
		next[captureId] = draftBinding;
		keyboardShortcuts.replaceOverrides(next);
		cancelCapture();
	}

	function unbind(id: EditorShortcutId): void {
		keyboardShortcuts.unbind(id);
		if (captureId === id) cancelCapture();
	}

	function reset(id: EditorShortcutId): void {
		keyboardShortcuts.resetBinding(id);
		if (captureId === id) cancelCapture();
	}

	function presetConflictCount(result: ShortcutPresetImport): number {
		const bindings = resolveEditorShortcuts(result.overrides);
		return Math.floor(
			EDITOR_SHORTCUT_DEFINITIONS.reduce(
				(count, { id }) => count + findShortcutConflicts(bindings, bindings[id], id).length,
				0
			) / 2
		);
	}

	async function importPreset(file: File): Promise<void> {
		try {
			const result = parseShortcutPreset(JSON.parse(await file.text()));
			const conflicts = presetConflictCount(result);
			if (conflicts > 0) {
				feedback = {
					tone: 'error',
					text: m.video_editor_shortcuts_import_conflicts({ count: conflicts })
				};
				return;
			}
			keyboardShortcuts.replaceOverrides(result.overrides);
			feedback = {
				tone: 'success',
				text: [
					m.video_editor_shortcuts_imported({ count: result.importedCount }),
					result.ignoredCount > 0
						? m.video_editor_shortcuts_import_ignored({ count: result.ignoredCount })
						: ''
				]
					.filter(Boolean)
					.join(' ')
			};
		} catch {
			feedback = { tone: 'error', text: m.video_editor_shortcuts_import_failed() };
		}
	}

	function exportPreset(): void {
		const document = createShortcutPreset(keyboardShortcuts.overrides);
		const name = `openpost-shortcuts-${document.exportedAt.slice(0, 10)}.json`;
		const url = URL.createObjectURL(
			new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' })
		);
		const anchor = window.document.createElement('a');
		anchor.href = url;
		anchor.download = name;
		anchor.click();
		URL.revokeObjectURL(url);
		feedback = { tone: 'success', text: m.video_editor_shortcuts_exported({ name }) };
	}

	function resetAll(): void {
		keyboardShortcuts.resetAll();
		confirmReset = false;
		cancelCapture();
		feedback = { tone: 'success', text: m.video_editor_shortcuts_reset_done() };
	}
</script>

<svelte:window onkeydown={captureKeydown} />

<section class="space-y-4" data-editor-shortcuts-disabled aria-labelledby="shortcut-settings-title">
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div>
			<h3 id="shortcut-settings-title" class="text-sm font-medium">
				{m.video_editor_settings_shortcuts()}
			</h3>
			<p class="mt-1 text-xs text-[var(--video-editor-muted)]">
				{m.video_editor_shortcuts_description()}
			</p>
			{#if layoutStatus === 'fallback'}
				<p class="mt-1 max-w-lg text-[11px] leading-relaxed text-[var(--video-editor-muted)]">
					{m.video_editor_shortcuts_layout_fallback()}
				</p>
			{/if}
		</div>
		<div class="flex flex-wrap gap-1.5">
			<Input
				bind:ref={importInput}
				type="file"
				accept="application/json,.json"
				class="hidden"
				aria-hidden="true"
				tabindex={-1}
				onchange={(event) => {
					const file = event.currentTarget.files?.[0];
					if (file) void importPreset(file);
					event.currentTarget.value = '';
				}}
			/>
			<Button type="button" variant="outline" size="sm" onclick={() => importInput.click()}>
				<UploadIcon class="size-3.5" aria-hidden="true" />
				{m.video_editor_shortcuts_import()}
			</Button>
			<Button type="button" variant="outline" size="sm" onclick={exportPreset}>
				<DownloadIcon class="size-3.5" aria-hidden="true" />
				{m.video_editor_shortcuts_export()}
			</Button>
		</div>
	</div>

	{#if feedback}
		<p
			class={`rounded-md border px-3 py-2 text-xs ${
				feedback.tone === 'error'
					? 'border-red-500/30 bg-red-500/10 text-red-200'
					: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-100'
			}`}
			role="status"
		>
			{feedback.text}
		</p>
	{/if}

	<div class="space-y-2">
		<Input bind:value={search} type="search" placeholder={m.video_editor_shortcuts_search()} />
		<div class="flex gap-1 overflow-x-auto pb-1" aria-label={m.video_editor_shortcuts_filter_all()}>
			{#each filters as item (item.id)}
				<button
					type="button"
					class="min-h-9 shrink-0 rounded-md border border-[oklch(0.29_0.014_55)] px-2.5 text-xs text-[var(--video-editor-muted)] focus-visible:outline-2 focus-visible:outline-[var(--video-editor-focus)] data-[active=true]:border-[var(--video-editor-focus)] data-[active=true]:text-[var(--video-editor-focus)]"
					data-active={filter === item.id}
					aria-pressed={filter === item.id}
					onclick={() => (filter = item.id)}
				>
					<span>{item.label()}</span>
					{#if item.id !== 'all'}
						<span class="ml-1 text-[10px] tabular-nums">{filterCount(item.id)}</span>
					{/if}
				</button>
			{/each}
		</div>
	</div>

	{#if captureId}
		<div
			class="rounded-lg border border-[var(--video-editor-focus)]/50 bg-[oklch(0.2_0.018_50)] p-3"
			role="group"
			aria-label={m.video_editor_shortcuts_change()}
		>
			<p class="text-sm font-medium">
				{m.video_editor_shortcuts_listening({ command: commandLabels[captureId]() })}
			</p>
			<p class="mt-0.5 text-xs text-[var(--video-editor-muted)]">
				{m.video_editor_shortcuts_listening_hint()}
			</p>
			{#if draftBinding}
				<p class="mt-3 text-xs">
					{m.video_editor_shortcuts_captured({
						binding: formatBinding(draftBinding)
					})}
				</p>
				{#if captureConflicts.length > 0}
					<p class="mt-1 text-xs text-amber-200" role="alert">
						{m.video_editor_shortcuts_conflict({
							command: captureConflicts.map((id) => commandLabels[id]()).join(', ')
						})}
					</p>
				{/if}
				{#if captureBrowserConflict}
					<p class="mt-1 text-xs text-amber-200">
						{m.video_editor_shortcuts_browser_conflict({
							action: captureBrowserConflict.browserAction.toLowerCase()
						})}
					</p>
				{/if}
			{/if}
			<div class="mt-3 flex flex-wrap justify-end gap-2">
				<Button type="button" variant="ghost" size="sm" onclick={cancelCapture}>
					{m.video_editor_shortcuts_cancel()}
				</Button>
				{#if captureConflicts.length > 0}
					<Button
						type="button"
						size="sm"
						disabled={!draftBinding}
						onclick={() => applyCapture(true)}
					>
						{m.video_editor_shortcuts_replace()}
					</Button>
				{:else}
					<Button
						type="button"
						size="sm"
						disabled={!draftBinding}
						onclick={() => applyCapture(false)}
					>
						{m.video_editor_shortcuts_use()}
					</Button>
				{/if}
			</div>
		</div>
	{/if}

	<div
		class="divide-y divide-[oklch(0.27_0.014_55)] rounded-lg border border-[oklch(0.29_0.014_55)]"
	>
		{#each sectionOrder as section (section)}
			{@const definitions = definitionsFor(section)}
			{#if definitions.length > 0}
				<div
					class="bg-[oklch(0.19_0.012_50)] px-3 py-2 text-[10px] font-medium tracking-wide text-[var(--video-editor-muted)] uppercase"
				>
					{sectionLabels[section]()}
				</div>
				{#each definitions as definition (definition.id)}
					{@const id = definition.id}
					{@const binding = keyboardShortcuts.bindings[id]}
					<div
						class="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center"
						role="group"
						aria-label={commandLabels[id]()}
					>
						<div class="min-w-0 flex-1">
							<div class="flex flex-wrap items-center gap-1.5">
								<span class="text-sm">{commandLabels[id]()}</span>
								{#if id in keyboardShortcuts.overrides}
									<span
										class="rounded border border-[oklch(0.34_0.03_48)] px-1.5 py-0.5 text-[9px] text-[var(--video-editor-focus)] uppercase"
									>
										{m.video_editor_shortcuts_custom()}
									</span>
								{/if}
							</div>
							<kbd
								class="mt-1 inline-block rounded border border-[oklch(0.33_0.014_55)] bg-[oklch(0.21_0.012_50)] px-2 py-1 font-mono text-[10px] text-[var(--video-editor-muted)]"
							>
								{binding ? formatBinding(binding) : m.video_editor_shortcuts_unassigned()}
							</kbd>
						</div>
						<div class="flex flex-wrap gap-1.5 sm:justify-end">
							<Button type="button" variant="outline" size="sm" onclick={() => beginCapture(id)}>
								{m.video_editor_shortcuts_change()}
							</Button>
							<Button type="button" variant="ghost" size="sm" onclick={() => unbind(id)}>
								{m.video_editor_shortcuts_unbind()}
							</Button>
							{#if id in keyboardShortcuts.overrides}
								<Button type="button" variant="ghost" size="sm" onclick={() => reset(id)}>
									{m.video_editor_shortcuts_reset_one()}
								</Button>
							{/if}
						</div>
					</div>
				{/each}
			{/if}
		{/each}
		{#if visibleDefinitions.length === 0}
			<p class="px-3 py-8 text-center text-xs text-[var(--video-editor-muted)]">
				{m.video_editor_shortcuts_no_results()}
			</p>
		{/if}
	</div>

	<div
		class="flex flex-wrap items-center justify-end gap-2 border-t border-[oklch(0.27_0.014_55)] pt-3"
	>
		{#if confirmReset}
			<span class="mr-auto text-xs text-[var(--video-editor-muted)]">
				{m.video_editor_shortcuts_reset_confirm()}
			</span>
			<Button type="button" variant="ghost" size="sm" onclick={() => (confirmReset = false)}>
				{m.common_cancel()}
			</Button>
			<Button type="button" variant="destructive" size="sm" onclick={resetAll}>
				{m.video_editor_shortcuts_reset_all()}
			</Button>
		{:else}
			<Button type="button" variant="ghost" size="sm" onclick={() => (confirmReset = true)}>
				<RotateIcon class="size-3.5" aria-hidden="true" />
				{m.video_editor_shortcuts_reset_all()}
			</Button>
		{/if}
	</div>
</section>
