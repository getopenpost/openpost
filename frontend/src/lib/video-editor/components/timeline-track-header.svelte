<script lang="ts">
	import { tick } from 'svelte';
	import { Portal } from 'bits-ui';
	import { m } from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import type { TimelineTrack } from '$lib/video-editor/project/types';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import EyeOffIcon from '@lucide/svelte/icons/eye-off';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import FolderIcon from '@lucide/svelte/icons/folder';
	import LockIcon from '@lucide/svelte/icons/lock';
	import LockOpenIcon from '@lucide/svelte/icons/lock-open';
	import MoreHorizontalIcon from '@lucide/svelte/icons/more-horizontal';
	import Link2Icon from '@lucide/svelte/icons/link-2';
	import RadioIcon from '@lucide/svelte/icons/radio';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import UngroupIcon from '@lucide/svelte/icons/ungroup';
	import Volume2Icon from '@lucide/svelte/icons/volume-2';
	import VolumeXIcon from '@lucide/svelte/icons/volume-x';

	let {
		track,
		effectiveTrack = track,
		itemCount,
		canDelete,
		selected = false,
		child = false,
		inheritedLocked = false,
		inheritedVisible = false,
		inheritedMuted = false,
		inheritedSolo = false,
		onselect = () => {},
		oncollapse = () => {},
		onungroup = () => {},
		ondeletegroup = () => {},
		onmoveup = () => {},
		onmovedown = () => {},
		onrename = () => {},
		onvisibility,
		onmute,
		onsolo,
		onlock,
		onsynclock,
		ondelete
	}: {
		track: TimelineTrack;
		effectiveTrack?: TimelineTrack;
		itemCount: number;
		canDelete: boolean;
		selected?: boolean;
		child?: boolean;
		inheritedLocked?: boolean;
		inheritedVisible?: boolean;
		inheritedMuted?: boolean;
		inheritedSolo?: boolean;
		onselect?: (event: MouseEvent) => void;
		oncollapse?: () => void;
		onungroup?: () => void;
		ondeletegroup?: () => void;
		onmoveup?: () => void;
		onmovedown?: () => void;
		onrename?: (name: string) => void;
		onvisibility: () => void;
		onmute: () => void;
		onsolo: () => void;
		onlock: () => void;
		onsynclock: () => void;
		ondelete: () => void;
	} = $props();

	const controlClass =
		'size-6 rounded text-[oklch(0.65_0.015_55)] hover:bg-[oklch(0.27_0.012_55)] hover:text-white focus-visible:ring-2 focus-visible:ring-[oklch(0.66_0.14_45)] data-[active=true]:bg-[oklch(0.66_0.14_45_/_0.16)] data-[active=true]:text-[oklch(0.76_0.14_45)]';
	const menuItemClass =
		'flex h-10 w-full items-center justify-start gap-2 rounded px-2.5 text-left text-sm hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-[oklch(0.66_0.14_45)] focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 data-[active=true]:bg-muted';
	let editingName = $state(false);
	let nameDraft = $state('');
	let nameInput = $state<HTMLInputElement | null>(null);
	let moreOpen = $state(false);
	let moreMenu = $state<HTMLDivElement | null>(null);
	let moreButton = $state<HTMLButtonElement | null>(null);
	let moreMenuContent = $state<HTMLDivElement | null>(null);
	let moreMenuLeft = $state(0);
	let moreMenuTop = $state(0);

	function runMoreAction(action: () => void): void {
		moreOpen = false;
		action();
	}

	function closeMoreOnOutsideClick(event: MouseEvent): void {
		const path = event.composedPath();
		if (moreOpen && !path.includes(moreMenu!) && !path.includes(moreMenuContent!)) moreOpen = false;
	}

	async function toggleMore(): Promise<void> {
		if (moreOpen) {
			moreOpen = false;
			return;
		}
		const triggerRect = moreButton?.getBoundingClientRect();
		if (!triggerRect) return;
		moreMenuLeft = Math.min(triggerRect.right + 4, Math.max(8, window.innerWidth - 232));
		moreMenuTop = Math.max(8, triggerRect.top);
		moreOpen = true;
		await tick();
		const menuRect = moreMenuContent?.getBoundingClientRect();
		if (menuRect)
			moreMenuTop = Math.min(moreMenuTop, Math.max(8, window.innerHeight - menuRect.height - 8));
	}

	function closeMoreOnEscape(event: KeyboardEvent): void {
		if (moreOpen && event.key === 'Escape') {
			event.preventDefault();
			moreOpen = false;
		}
	}

	async function startRename(): Promise<void> {
		nameDraft = track.name;
		editingName = true;
		await tick();
		nameInput?.focus();
		nameInput?.select();
	}

	function finishRename(commit: boolean): void {
		if (!editingName) return;
		editingName = false;
		if (commit && nameDraft.trim() && nameDraft.trim() !== track.name) onrename(nameDraft.trim());
	}

	function nameKeydown(event: KeyboardEvent): void {
		if (event.key === 'F2') {
			event.preventDefault();
			void startRename();
		} else if (event.altKey && event.key === 'ArrowUp') {
			event.preventDefault();
			onmoveup();
		} else if (event.altKey && event.key === 'ArrowDown') {
			event.preventDefault();
			onmovedown();
		}
	}
</script>

<svelte:window
	onclick={closeMoreOnOutsideClick}
	onkeydown={closeMoreOnEscape}
	onresize={() => (moreOpen = false)}
	onscroll={() => (moreOpen = false)}
/>

<div
	class="flex size-full min-w-0 flex-col justify-center gap-0.5 border-r border-[oklch(0.25_0.015_55)] bg-[oklch(0.16_0.008_55)] px-2"
	class:ring-1={selected}
	class:ring-inset={selected}
	class:ring-[oklch(0.66_0.14_45)]={selected}
	data-track-header={track.id}
>
	<div class="flex min-w-0 items-center gap-1 {child ? 'pl-3' : ''}">
		{#if track.isGroup}
			<Button
				variant="ghost"
				size="icon"
				class="size-5 rounded"
				data-track-primary-control
				aria-label={track.isCollapsed
					? m.video_editor_track_group_expand()
					: m.video_editor_track_group_collapse()}
				title={track.isCollapsed
					? m.video_editor_track_group_expand()
					: m.video_editor_track_group_collapse()}
				onclick={oncollapse}
			>
				{#if track.isCollapsed}<ChevronRightIcon class="size-3.5" />{:else}<ChevronDownIcon
						class="size-3.5"
					/>{/if}
			</Button>
			<FolderIcon class="size-3.5 shrink-0 text-[oklch(0.76_0.14_45)]" />
		{/if}
		{#if editingName}
			<Input
				bind:ref={nameInput}
				bind:value={nameDraft}
				class="h-5 min-w-0 flex-1 rounded border border-[oklch(0.66_0.14_45)] bg-[oklch(0.12_0.008_55)] px-1 text-[11px] text-white shadow-none focus-visible:ring-0"
				aria-label={m.video_editor_track_rename()}
				onblur={() => finishRename(true)}
				onkeydown={(event) => {
					if (event.key === 'Enter') finishRename(true);
					else if (event.key === 'Escape') finishRename(false);
				}}
			/>
		{:else}
			<button
				type="button"
				class="min-w-0 flex-1 truncate rounded-sm text-left text-[11px] font-medium text-white/90 focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
				aria-pressed={selected}
				aria-keyshortcuts="F2 Alt+ArrowUp Alt+ArrowDown"
				data-track-primary-control
				title={m.video_editor_track_name_hint({ name: track.name })}
				onclick={onselect}
				ondblclick={startRename}
				onkeydown={nameKeydown}>{track.name}</button
			>
		{/if}
		<span class="shrink-0 font-mono text-[9px] text-[oklch(0.58_0.015_55)]">
			{itemCount}
		</span>
	</div>
	<div class="relative flex flex-nowrap items-center gap-0.5">
		<Button
			variant="ghost"
			size="icon"
			class={controlClass}
			data-track-primary-control
			data-active={!effectiveTrack.visible}
			disabled={inheritedVisible}
			aria-label={effectiveTrack.visible
				? m.video_editor_track_hide()
				: m.video_editor_track_show()}
			title={inheritedVisible
				? m.video_editor_track_group_visibility_inherited()
				: effectiveTrack.visible
					? m.video_editor_track_hide()
					: m.video_editor_track_show()}
			onclick={onvisibility}
		>
			{#if effectiveTrack.visible}<EyeIcon class="size-3.5" />{:else}<EyeOffIcon
					class="size-3.5"
				/>{/if}
		</Button>
		<Button
			variant="ghost"
			size="icon"
			class={controlClass}
			data-track-primary-control
			data-active={effectiveTrack.locked}
			disabled={inheritedLocked}
			aria-label={effectiveTrack.locked
				? m.video_editor_track_unlock()
				: m.video_editor_track_lock()}
			title={inheritedLocked
				? m.video_editor_track_group_lock_inherited()
				: effectiveTrack.locked
					? m.video_editor_track_unlock()
					: m.video_editor_track_lock()}
			onclick={onlock}
		>
			{#if effectiveTrack.locked}<LockIcon class="size-3.5" />{:else}<LockOpenIcon
					class="size-3.5"
				/>{/if}
		</Button>
		<div
			bind:this={moreMenu}
			class="relative size-10 max-w-10 min-w-10 shrink-0"
			style="width:40px;min-width:40px;max-width:40px;height:40px;flex:0 0 40px"
		>
			<button
				bind:this={moreButton}
				type="button"
				class="flex size-10 cursor-pointer list-none items-center justify-center rounded text-[oklch(0.65_0.015_55)] hover:bg-[oklch(0.27_0.012_55)] hover:text-white focus-visible:ring-2 focus-visible:ring-[oklch(0.66_0.14_45)] focus-visible:outline-none [&::-webkit-details-marker]:hidden"
				data-track-primary-control
				style="width:40px;height:40px"
				aria-expanded={moreOpen}
				aria-haspopup="menu"
				aria-label={m.video_editor_track_more_actions()}
				title={m.video_editor_track_more_actions()}
				onclick={toggleMore}
			>
				<MoreHorizontalIcon class="size-3.5" />
			</button>
			{#if moreOpen}
				<Portal>
					<div
						bind:this={moreMenuContent}
						class="video-editor-theme fixed z-[100] min-w-56 space-y-1 rounded-md border border-border bg-popover p-1.5 text-popover-foreground shadow-md"
						style={`left:${moreMenuLeft}px;top:${moreMenuTop}px`}
						role="menu"
					>
						<button
							type="button"
							role="menuitem"
							class={menuItemClass}
							data-active={effectiveTrack.muted}
							disabled={inheritedMuted}
							title={inheritedMuted ? m.video_editor_track_group_mute_inherited() : undefined}
							onclick={() => runMoreAction(onmute)}
						>
							{#if effectiveTrack.muted}<VolumeXIcon class="size-4" />{:else}<Volume2Icon
									class="size-4"
								/>{/if}
							{effectiveTrack.muted ? m.video_editor_track_unmute() : m.video_editor_track_mute()}
						</button>
						<button
							type="button"
							role="menuitem"
							class={menuItemClass}
							data-active={effectiveTrack.solo}
							disabled={inheritedSolo}
							title={inheritedSolo ? m.video_editor_track_group_solo_inherited() : undefined}
							onclick={() => runMoreAction(onsolo)}
						>
							<RadioIcon class="size-4" />
							{effectiveTrack.solo ? m.video_editor_track_unsolo() : m.video_editor_track_solo()}
						</button>
						{#if !track.isGroup}
							<button
								type="button"
								role="menuitem"
								class={menuItemClass}
								data-active={track.syncLock !== false}
								onclick={() => runMoreAction(onsynclock)}
							>
								<Link2Icon class="size-4" />
								{track.syncLock !== false
									? m.video_editor_track_sync_unlock()
									: m.video_editor_track_sync_lock()}
							</button>
						{:else}
							<button
								type="button"
								role="menuitem"
								class={menuItemClass}
								onclick={() => runMoreAction(onungroup)}
							>
								<UngroupIcon class="size-4" />
								{m.video_editor_track_group_ungroup_hint()}
							</button>
						{/if}
						<button
							type="button"
							role="menuitem"
							class="{menuItemClass} text-red-300 hover:bg-red-500/15 hover:text-red-200"
							disabled={!canDelete}
							title={canDelete ? undefined : m.video_editor_track_keep_one()}
							onclick={() => runMoreAction(track.isGroup ? ondeletegroup : ondelete)}
						>
							<Trash2Icon class="size-4" />
							{track.isGroup ? m.video_editor_track_group_delete() : m.video_editor_track_delete()}
						</button>
					</div>
				</Portal>
			{/if}
		</div>
	</div>
</div>
