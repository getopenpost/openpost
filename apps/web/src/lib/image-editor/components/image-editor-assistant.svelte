<script lang="ts">
	import { Dialog as DialogPrimitive } from 'bits-ui';
	import * as Sheet from '$lib/components/ui/sheet';
	import { Button } from '$lib/components/ui/button';
	import { ThemeIcon } from '$lib/themes/icons';
	import { m } from '$lib/paraglide/messages';
	import HostedChatPanel from '$lib/editor-agent/hosted-chat-panel.svelte';

	let {
		workspaceId,
		projectId,
		sessionId
	}: {
		workspaceId: string;
		projectId: string;
		sessionId: string | null;
	} = $props();
	let open = $state(false);
	let mounted = $state(false);
</script>

<Sheet.Root
	{open}
	onOpenChange={(next) => {
		open = next;
		if (next) mounted = true;
	}}
>
	<Sheet.Trigger>
		{#snippet child({ props })}
			<Button
				{...props}
				variant={open ? 'secondary' : 'ghost'}
				size="icon-sm"
				class="size-8 shrink-0 [@media(pointer:coarse)]:size-11"
				title={m.video_editor_agent_assistant()}
				aria-label={m.video_editor_agent_assistant()}
			>
				<ThemeIcon role="assistant" />
			</Button>
		{/snippet}
	</Sheet.Trigger>
	{#if mounted}
		<Sheet.Portal>
			<!-- Use the dialog behavior without the modal sheet scrim so the canvas stays usable. -->
			<DialogPrimitive.Content
				forceMount
				trapFocus={false}
				preventScroll={false}
				onInteractOutside={(event) => event.preventDefault()}
			>
				{#snippet child({ props })}
					<div
						{...props}
						aria-modal="false"
						aria-describedby={undefined}
						hidden={!open}
						inert={!open}
						class="fixed inset-x-0 bottom-0 z-30 h-[60dvh] min-h-64 flex-col border-t border-border bg-background text-foreground outline-none lg:top-20 lg:left-auto lg:h-auto lg:w-80 lg:border-t-0 lg:border-l {open
							? 'flex'
							: 'hidden'}"
						onkeydown={(event) => {
							if (event.key !== 'Escape') event.stopPropagation();
						}}
					>
						<div
							class="flex shrink-0 items-center justify-between border-b border-border px-3 py-1"
						>
							<Sheet.Title class="text-sm font-medium"
								>{m.video_editor_agent_assistant()}</Sheet.Title
							>
							<Sheet.Close>
								{#snippet child({ props })}
									<Button
										{...props}
										variant="ghost"
										size="icon-sm"
										class="size-8 [@media(pointer:coarse)]:size-11"
										aria-label={m.common_close()}
										title={m.common_close()}
									>
										<ThemeIcon role="close" />
									</Button>
								{/snippet}
							</Sheet.Close>
						</div>
						<div class="min-h-0 flex-1 pb-[env(safe-area-inset-bottom)]">
							<HostedChatPanel {workspaceId} {projectId} {sessionId} kind="image" />
						</div>
					</div>
				{/snippet}
			</DialogPrimitive.Content>
		</Sheet.Portal>
	{/if}
</Sheet.Root>
