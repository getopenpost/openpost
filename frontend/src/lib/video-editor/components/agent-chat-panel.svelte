<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';
	import { m } from '$lib/paraglide/messages';
	import { onMount } from 'svelte';
	import { agentStore } from '$lib/video-editor/agent/store.svelte';
	import { ProtectedIcon, ThemeIcon } from '$lib/themes/icons';

	const suggestions: Array<{ key: string; text: string }> = [
		{ key: 'silence', text: m.video_editor_agent_suggestion_silence() },
		{ key: 'fillers', text: m.video_editor_agent_suggestion_fillers() },
		{ key: 'title', text: m.video_editor_agent_suggestion_title() },
		{ key: 'split', text: m.video_editor_agent_suggestion_split() }
	];

	let {
		projectId = null,
		storageSufficient = true,
		storageUnknown = false
	}: {
		projectId?: string | null;
		storageSufficient?: boolean;
		storageUnknown?: boolean;
	} = $props();

	let input = $state('');
	let scrollRef: HTMLDivElement | null = $state(null);
	let textareaRef: HTMLTextAreaElement | null = $state(null);

	$effect(() => {
		agentStore.setProjectId(projectId);
	});

	const busy = $derived(agentStore.phase !== 'idle');
	const canSend = $derived(
		input.trim().length > 0 &&
			!busy &&
			agentStore.supported &&
			(storageSufficient || storageUnknown)
	);
	const composerDisabledReason = $derived.by(() => {
		if (!agentStore.supported) return m.video_editor_agent_webgpu_required();
		if (!storageSufficient && !storageUnknown)
			return m.video_editor_agent_composer_disabled_storage();
		return null;
	});

	function scrollToBottom(): void {
		if (!scrollRef) return;
		scrollRef.scrollTop = scrollRef.scrollHeight;
	}

	$effect(() => {
		void agentStore.messages.length;
		void agentStore.phase;
		void agentStore.streamingText;
		queueMicrotask(scrollToBottom);
	});

	function send(text: string): void {
		const trimmed = text.trim();
		if (!trimmed || busy) return;
		if (composerDisabledReason) return;
		input = '';
		void agentStore.submit(trimmed, {
			projectId,
			storageSufficient: storageSufficient || storageUnknown
		});
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			if (canSend) send(input);
		}
	}

	onMount(() => {
		textareaRef?.focus();
	});
</script>

<div class="flex h-full min-h-0 flex-col" data-testid="agent-chat-panel">
	{#if !agentStore.supported}
		<div class="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
			<ThemeIcon role="sparkles" class="size-6 text-muted-foreground" />
			<p class="text-sm font-medium text-foreground">
				{m.video_editor_agent_unavailable_title()}
			</p>
			<p class="max-w-64 text-xs leading-relaxed text-muted-foreground">
				{m.video_editor_agent_unavailable_body()}
			</p>
		</div>
	{:else}
		<div bind:this={scrollRef} class="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
			<p class="text-[11px] leading-relaxed text-muted-foreground">
				{m.video_editor_agent_intro()}
			</p>

			{#if agentStore.messages.length === 0 && agentStore.phase === 'idle'}
				<div class="flex flex-wrap gap-1.5">
					{#each suggestions as suggestion (suggestion.key)}
						<button
							type="button"
							class="min-h-11 rounded-full border border-border bg-muted px-2.5 py-2 text-[11px] leading-none text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:min-h-0 md:py-1.5"
							onclick={() => send(suggestion.text)}
						>
							{suggestion.text}
						</button>
					{/each}
				</div>
			{/if}

			{#each agentStore.messages as message (message.id)}
				<div class="flex {message.role === 'user' ? 'justify-end' : 'justify-start'}">
					<div
						class="max-w-[85%] rounded-lg px-2.5 py-1.5 text-xs leading-relaxed break-words {message.role ===
						'user'
							? 'bg-primary text-primary-foreground'
							: 'border border-border bg-card text-foreground'}"
					>
						{message.content}
					</div>
				</div>
			{/each}

			{#if agentStore.streamingText}
				<div
					class="rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs leading-relaxed whitespace-pre-wrap text-foreground"
				>
					{agentStore.streamingText}
				</div>
			{/if}

			{#if agentStore.phase === 'planning'}
				<div
					class="flex items-center gap-2 text-xs text-muted-foreground"
					role="status"
					aria-live="polite"
				>
					<ProtectedIcon icon="loading" class="size-3.5 animate-spin motion-reduce:animate-none" />
					{#if agentStore.modelStatus === 'loading'}
						<span>{m.video_editor_agent_loading_model({ percent: agentStore.loadPercent })}</span>
					{:else}
						<span>{m.video_editor_agent_planning()}</span>
					{/if}
				</div>
			{/if}

			{#if agentStore.plan && agentStore.plan.length > 0}
				<div class="rounded-lg border border-border bg-card p-2.5" data-testid="agent-plan-card">
					<div
						class="mb-1.5 text-[11px] font-medium tracking-widest text-muted-foreground uppercase"
					>
						{m.video_editor_agent_plan_title()}
					</div>
					<ol class="space-y-1.5">
						{#each agentStore.plan as step, index (index)}
							<li class="flex items-start gap-2 text-xs">
								{#if step.status === 'running'}
									<ProtectedIcon
										icon="loading"
										class="mt-0.5 size-3.5 shrink-0 animate-spin text-primary motion-reduce:animate-none"
									/>
								{:else if step.status === 'done'}
									<ProtectedIcon
										icon="success"
										class="mt-0.5 size-3.5 shrink-0 text-success-foreground"
									/>
								{:else if step.status === 'error'}
									<ProtectedIcon icon="warning" class="mt-0.5 size-3.5 shrink-0 text-destructive" />
								{:else if step.status === 'skipped'}
									<ProtectedIcon
										icon="pending"
										class="mt-0.5 size-3.5 shrink-0 text-muted-foreground opacity-60"
									/>
								{:else}
									<ProtectedIcon
										icon="pending"
										class="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
									/>
								{/if}
								<div class="min-w-0">
									<span class="text-foreground">{step.summary}</span>
									{#if step.handoff}
										<span
											class="ml-1 rounded bg-info px-1 py-0.5 text-[9px] font-medium text-info-foreground"
											>{m.video_editor_agent_review_label()}</span
										>
									{/if}
									{#if step.status === 'error' && step.result}
										<span class="block text-[11px] text-destructive">{step.result}</span>
									{/if}
									{#if step.status === 'done' && step.result}
										<span class="block text-[11px] text-muted-foreground">{step.result}</span>
									{/if}
									{#if step.status === 'skipped' && step.result}
										<span class="block text-[11px] text-muted-foreground">{step.result}</span>
									{/if}
								</div>
							</li>
						{/each}
					</ol>

					{#if agentStore.plan.some((s) => s.handoff) && agentStore.phase === 'awaiting-confirm'}
						<p class="mt-2 text-[11px] leading-relaxed text-muted-foreground">
							{m.video_editor_agent_handoff_note()}
						</p>
					{/if}
					{#if agentStore.plan.some((s) => s.destructive) && agentStore.phase === 'awaiting-confirm'}
						<p class="mt-1 text-[11px] leading-relaxed text-destructive">
							{m.video_editor_agent_destructive_note()}
						</p>
					{/if}

					{#if agentStore.phase === 'awaiting-confirm'}
						<div class="mt-2.5 flex items-center gap-1.5">
							<Button
								size="sm"
								class="h-11 flex-1 gap-1.5 md:h-7"
								onclick={() => void agentStore.runPlan({ projectId })}
								data-testid="agent-run-plan">{m.video_editor_agent_run()}</Button
							>
							<Button
								size="sm"
								variant="ghost"
								class="h-11 gap-1.5 text-muted-foreground md:h-7"
								onclick={() => agentStore.dismissPlan()}
								data-testid="agent-discard-plan"
								><ThemeIcon role="close" class="size-3.5" />{m.video_editor_agent_discard()}</Button
							>
						</div>
					{/if}
					{#if agentStore.phase === 'running'}
						<p class="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
							<ProtectedIcon
								icon="loading"
								class="size-3 animate-spin motion-reduce:animate-none"
							/>{m.video_editor_agent_running()}
						</p>
					{/if}
				</div>
			{/if}

			{#if agentStore.loadError && agentStore.phase === 'idle'}
				<div
					class="rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-[11px] text-destructive"
					role="alert"
				>
					{agentStore.loadError}
				</div>
			{/if}
		</div>

		{#if composerDisabledReason}
			<p
				class="shrink-0 border-t border-border px-2.5 py-1.5 text-[11px] leading-relaxed text-destructive"
				role="status"
			>
				{composerDisabledReason}
			</p>
		{/if}
		<div class="shrink-0 border-t border-border p-2.5">
			{#if agentStore.modelStatus === 'loading'}
				<div class="mb-2 h-1 overflow-hidden rounded-full bg-muted">
					<div
						class="h-full rounded-full bg-primary transition-[width] duration-300"
						style:width={`${agentStore.loadPercent}%`}
					></div>
				</div>
			{/if}
			<div class="flex items-end gap-1.5">
				<Textarea
					bind:ref={textareaRef}
					bind:value={input}
					onkeydown={handleKeydown}
					rows={1}
					placeholder={composerDisabledReason ?? m.video_editor_agent_placeholder()}
					disabled={!!composerDisabledReason && agentStore.phase === 'idle'}
					maxlength={500}
					class="placeholder:text-field-placeholder max-h-28 min-h-11 flex-1 resize-none rounded-md border border-field-border bg-field px-2.5 py-2.5 text-xs leading-relaxed text-field-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60 md:min-h-9 md:py-1.5"
					aria-label="Assistant message"
					aria-describedby="agent-input-limit"
				/>
				{#if agentStore.phase === 'planning'}
					<Button
						size="icon"
						variant="ghost"
						class="size-11 shrink-0 md:size-9"
						onclick={() => agentStore.cancel()}
						aria-label={m.video_editor_agent_cancel_label()}
						><ThemeIcon role="close" class="size-4" /></Button
					>
				{:else}
					<Button
						size="icon"
						class="size-11 shrink-0 md:size-9"
						disabled={!canSend}
						onclick={() => send(input)}
						aria-label={m.video_editor_agent_send_label()}
						data-testid="agent-send"><ThemeIcon role="send" class="size-4" /></Button
					>
				{/if}
			</div>
			<p id="agent-input-limit" class="mt-1 text-right text-[10px] text-muted-foreground">
				{input.length}/500
			</p>
			{#if agentStore.messages.length > 0}
				<div class="mt-1.5 flex justify-end">
					<Button
						variant="ghost"
						size="sm"
						class="h-11 gap-1 px-2 text-[11px] text-muted-foreground md:h-6"
						onclick={() => agentStore.clearChat()}
						disabled={agentStore.phase === 'running'}
						data-testid="agent-clear"
					>
						<ThemeIcon role="delete" class="size-3" />{m.video_editor_agent_clear()}
					</Button>
				</div>
			{/if}
		</div>
	{/if}
</div>
