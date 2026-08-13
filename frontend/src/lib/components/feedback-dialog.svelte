<script lang="ts">
	import { tick } from 'svelte';
	import { page } from '$app/state';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Textarea } from '$lib/components/ui/textarea';
	import * as RadioGroup from '$lib/components/ui/radio-group';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { client } from '$lib/api/client';
	import { feedbackDiagnostics, type FeedbackDiagnosticsSnapshot } from '$lib/feedback-diagnostics';
	import { ui } from '$lib/stores/ui.svelte';
	import { m } from '$lib/paraglide/messages';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import CheckIcon from '@lucide/svelte/icons/circle-check';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import XIcon from '@lucide/svelte/icons/x';

	type FeedbackCategory = 'bug' | 'idea' | 'question';
	type FeedbackConfig = {
		enabled: boolean;
		recipient?: string;
		support_url?: string;
		app_version: string;
		max_message_characters: number;
		max_screenshot_bytes: number;
		diagnostic_categories: string[];
	};

	let open = $state(false);
	let config = $state<FeedbackConfig | null>(null);
	let loading = $state(false);
	let sending = $state(false);
	let error = $state('');
	let success = $state(false);
	let category = $state<FeedbackCategory>('bug');
	let message = $state('');
	let includeScreenshot = $state(false);
	let screenshotDataURL = $state('');
	let screenshotBytes = $state(0);
	let screenshotLoading = $state(false);
	let screenshotError = $state('');
	let includeDiagnostics = $state(false);
	let diagnosticsPreview = $state<FeedbackDiagnosticsSnapshot | null>(null);
	let loadSequence = 0;

	$effect(() => {
		open = ui.isFeedbackOpen;
		if (open) void loadConfig();
	});

	function handleOpenChange(isOpen: boolean) {
		open = isOpen;
		if (!isOpen) {
			loadSequence++;
			ui.closeFeedback();
		}
	}

	async function loadConfig() {
		const sequence = ++loadSequence;
		loading = true;
		error = '';
		try {
			const { data, error: configError } = await client.GET('/feedback/config');
			if (sequence !== loadSequence || !ui.isFeedbackOpen) return;
			if (configError || !data) {
				throw new Error(configError?.detail || m.feedback_load_failed());
			}
			config = {
				...data,
				diagnostic_categories: data.diagnostic_categories ?? []
			};
		} catch (cause) {
			if (sequence === loadSequence) {
				error = cause instanceof Error ? cause.message : m.feedback_load_failed();
			}
		} finally {
			if (sequence === loadSequence) loading = false;
		}
	}

	function diagnosticsSnapshot() {
		const snapshot = feedbackDiagnostics.snapshot(page.url.pathname, page.route.id ?? '');
		diagnosticsPreview = snapshot;
		return snapshot;
	}

	async function toggleScreenshot(checked: boolean) {
		includeScreenshot = checked;
		screenshotError = '';
		if (!checked) {
			screenshotDataURL = '';
			screenshotBytes = 0;
			return;
		}
		await captureScreenshot();
	}

	async function captureScreenshot() {
		screenshotLoading = true;
		screenshotError = '';
		document.documentElement.dataset.feedbackCapturing = 'true';
		await tick();
		await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
		try {
			const { toCanvas } = await import('html-to-image');
			const width = Math.min(window.innerWidth, 1600);
			const height = Math.min(window.innerHeight, 1200);
			const canvas = await toCanvas(document.documentElement, {
				width,
				height,
				canvasWidth: width,
				canvasHeight: height,
				pixelRatio: 1,
				skipFonts: true,
				cacheBust: false,
				style: {
					transform: `translate(${-window.scrollX}px, ${-window.scrollY}px)`,
					transformOrigin: 'top left'
				},
				backgroundColor: getComputedStyle(document.documentElement).backgroundColor || '#ffffff',
				imagePlaceholder: 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=',
				filter: includeFeedbackNode
			});
			let dataURL = canvas.toDataURL('image/jpeg', 0.78);
			let bytes = encodedDataURLBytes(dataURL);
			if (bytes > (config?.max_screenshot_bytes ?? 1_048_576)) {
				const scale = Math.sqrt((config?.max_screenshot_bytes ?? 1_048_576) / bytes) * 0.9;
				const resized = document.createElement('canvas');
				resized.width = Math.max(1, Math.floor(canvas.width * scale));
				resized.height = Math.max(1, Math.floor(canvas.height * scale));
				resized.getContext('2d')?.drawImage(canvas, 0, 0, resized.width, resized.height);
				dataURL = resized.toDataURL('image/jpeg', 0.68);
				bytes = encodedDataURLBytes(dataURL);
			}
			if (bytes > (config?.max_screenshot_bytes ?? 1_048_576)) {
				throw new Error('screenshot too large');
			}
			screenshotDataURL = dataURL;
			screenshotBytes = bytes;
		} catch {
			includeScreenshot = false;
			screenshotDataURL = '';
			screenshotBytes = 0;
			screenshotError = m.feedback_screenshot_failed();
		} finally {
			delete document.documentElement.dataset.feedbackCapturing;
			screenshotLoading = false;
		}
	}

	function includeFeedbackNode(node: Node) {
		if (!(node instanceof Element)) return true;
		if (
			node.closest(
				'[data-feedback-ignore],[data-feedback-redact],[contenteditable="true"],[contenteditable=""]'
			)
		) {
			return false;
		}
		if (
			node instanceof HTMLInputElement ||
			node instanceof HTMLTextAreaElement ||
			node instanceof HTMLSelectElement ||
			node instanceof HTMLVideoElement ||
			node instanceof HTMLCanvasElement ||
			node instanceof HTMLIFrameElement ||
			node.getAttribute('contenteditable') === 'true'
		) {
			return false;
		}
		if (node instanceof HTMLImageElement && node.currentSrc) {
			try {
				const source = new URL(node.currentSrc, window.location.href);
				if (source.protocol.startsWith('http') && source.origin !== window.location.origin) {
					return false;
				}
			} catch {
				return false;
			}
		}
		return true;
	}

	function encodedDataURLBytes(dataURL: string) {
		const encoded = dataURL.split(',', 2)[1] ?? '';
		return Math.floor((encoded.length * 3) / 4);
	}

	function resetForm() {
		success = false;
		error = '';
		category = 'bug';
		message = '';
		includeScreenshot = false;
		screenshotDataURL = '';
		screenshotBytes = 0;
		screenshotError = '';
		includeDiagnostics = false;
		diagnosticsPreview = null;
	}

	async function submit() {
		if (!message.trim()) {
			error = m.feedback_message_required();
			return;
		}
		sending = true;
		error = '';
		try {
			const encodedScreenshot = screenshotDataURL.split(',', 2)[1] ?? '';
			const { error: submitError } = await client.POST('/feedback', {
				body: {
					category,
					message: message.trim(),
					...(includeScreenshot && encodedScreenshot
						? {
								screenshot: {
									mime_type: 'image/jpeg',
									data: encodedScreenshot
								}
							}
						: {}),
					...(includeDiagnostics ? { diagnostics: diagnosticsSnapshot() } : {})
				}
			});
			if (submitError) {
				throw new Error(submitError.detail || m.feedback_send_failed());
			}
			success = true;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.feedback_send_failed();
		} finally {
			sending = false;
		}
	}
</script>

<Dialog.Root {open} onOpenChange={handleOpenChange}>
	<Dialog.Content
		class="max-h-[min(90dvh,48rem)] overflow-y-auto sm:max-w-xl"
		data-feedback-ignore
		overlayProps={{ 'data-feedback-ignore': '' }}
	>
		<Dialog.Header>
			<Dialog.Title>{m.feedback_title()}</Dialog.Title>
			<Dialog.Description>{m.feedback_description()}</Dialog.Description>
		</Dialog.Header>

		{#if loading && !config}
			<div class="flex min-h-40 items-center justify-center text-sm text-muted-foreground">
				<LoaderIcon class="mr-2 size-4 animate-spin" />
				{m.feedback_loading()}
			</div>
		{:else if !config}
			<InlineNotice tone="error" message={error || m.feedback_load_failed()} />
		{:else if !config.enabled}
			<div class="space-y-4 py-2">
				<InlineNotice tone="info">
					<p class="font-medium">{m.feedback_disabled_title()}</p>
					<p class="mt-1 text-muted-foreground">{m.feedback_disabled_body()}</p>
				</InlineNotice>
				{#if config.support_url}
					<Button href={config.support_url} target="_blank" rel="noreferrer">
						{m.feedback_open_support()}
						<ExternalLinkIcon class="ml-2 size-4" />
					</Button>
				{/if}
			</div>
		{:else if success}
			<div class="space-y-5 py-4 text-center">
				<CheckIcon class="mx-auto size-10 text-emerald-600" />
				<div>
					<h3 class="font-medium">{m.feedback_success_title()}</h3>
					<p class="mt-1 text-sm text-muted-foreground">
						{m.feedback_success_body({ recipient: config.recipient || '' })}
					</p>
				</div>
				<div class="flex justify-center gap-2">
					<Button variant="outline" onclick={resetForm}>{m.feedback_send_another()}</Button>
					<Button onclick={() => ui.closeFeedback()}>{m.common_done()}</Button>
				</div>
			</div>
		{:else}
			<form
				class="space-y-5"
				onsubmit={(event) => {
					event.preventDefault();
					void submit();
				}}
			>
				<p class="rounded-md border bg-muted/35 px-3 py-2 text-sm font-medium">
					{m.feedback_recipient({ recipient: config.recipient || '' })}
				</p>

				<fieldset class="space-y-2">
					<legend class="text-sm font-medium">{m.feedback_category()}</legend>
					<RadioGroup.Root
						class="grid grid-cols-3 gap-2"
						value={category}
						onValueChange={(value) => (category = value as FeedbackCategory)}
						aria-label={m.feedback_category()}
					>
						{#each [['bug', m.feedback_category_bug()], ['idea', m.feedback_category_idea()], ['question', m.feedback_category_question()]] as option (option[0])}
							<label
								class={[
									'flex min-h-11 cursor-pointer items-center justify-center rounded-md border px-3 text-sm',
									category === option[0] && 'border-primary bg-primary/8 text-primary'
								]}
							>
								<RadioGroup.Item class="sr-only" value={option[0]} aria-label={option[1]} />
								{option[1]}
							</label>
						{/each}
					</RadioGroup.Root>
				</fieldset>

				<label class="block space-y-2">
					<span class="text-sm font-medium">{m.feedback_message()}</span>
					<Textarea
						class="min-h-28"
						bind:value={message}
						maxlength={config.max_message_characters}
						placeholder={m.feedback_message_placeholder()}
						required
					/>
				</label>

				<div class="space-y-3 rounded-md border p-3">
					<label class="flex cursor-pointer items-start gap-3">
						<Checkbox
							class="mt-0.5"
							checked={includeScreenshot}
							disabled={screenshotLoading}
							onCheckedChange={(checked) => void toggleScreenshot(checked)}
						/>
						<span>
							<span class="block text-sm font-medium">{m.feedback_screenshot()}</span>
							<span class="mt-1 block text-xs leading-5 text-muted-foreground">
								{m.feedback_screenshot_help()}
							</span>
						</span>
					</label>
					{#if screenshotLoading}
						<p class="flex items-center text-xs text-muted-foreground">
							<LoaderIcon class="mr-2 size-3.5 animate-spin" />
							{m.feedback_screenshot_capturing()}
						</p>
					{:else if screenshotDataURL}
						<div class="relative overflow-hidden rounded-md border bg-muted">
							<img
								src={screenshotDataURL}
								alt={m.feedback_screenshot()}
								class="max-h-52 w-full object-contain"
							/>
							<Button
								type="button"
								variant="secondary"
								size="icon-sm"
								class="absolute top-2 right-2"
								aria-label={m.feedback_screenshot_remove()}
								onclick={() => void toggleScreenshot(false)}
							>
								<XIcon class="size-4" />
							</Button>
							<p class="px-2 py-1 text-right text-[0.6875rem] text-muted-foreground">
								{Math.ceil(screenshotBytes / 1024)} KB
							</p>
						</div>
					{/if}
					{#if screenshotError}
						<p class="text-xs text-destructive">{screenshotError}</p>
					{/if}
				</div>

				<div class="space-y-3 rounded-md border p-3">
					<label class="flex cursor-pointer items-start gap-3">
						<Checkbox
							class="mt-0.5"
							bind:checked={includeDiagnostics}
							onCheckedChange={() => {
								diagnosticsPreview = includeDiagnostics ? diagnosticsSnapshot() : null;
							}}
						/>
						<span>
							<span class="block text-sm font-medium">{m.feedback_diagnostics()}</span>
							<span class="mt-1 block text-xs leading-5 text-muted-foreground">
								{m.feedback_diagnostics_help()}
							</span>
						</span>
					</label>
					<ul class="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
						{#each config.diagnostic_categories as diagnostic (diagnostic)}
							<li>{diagnostic}</li>
						{/each}
					</ul>
					{#if includeDiagnostics && diagnosticsPreview}
						<details class="rounded-md bg-muted/45 p-2 text-xs">
							<summary class="cursor-pointer font-medium">
								{m.feedback_diagnostics_preview()}
							</summary>
							<pre
								class="mt-2 max-h-40 overflow-auto break-all whitespace-pre-wrap">{JSON.stringify(
									diagnosticsPreview,
									null,
									2
								)}</pre>
						</details>
					{/if}
				</div>

				{#if error}<InlineNotice tone="error" message={error} />{/if}

				<Dialog.Footer>
					<Button type="button" variant="outline" onclick={() => ui.closeFeedback()}>
						{m.common_cancel()}
					</Button>
					<Button type="submit" disabled={sending || screenshotLoading || !message.trim()}>
						{#if sending}<LoaderIcon class="mr-2 size-4 animate-spin" />{/if}
						{sending ? m.feedback_sending() : m.feedback_send()}
					</Button>
				</Dialog.Footer>
			</form>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<style>
	:global(html[data-feedback-capturing='true'] [data-feedback-ignore]) {
		visibility: hidden !important;
		backdrop-filter: none !important;
		animation: none !important;
	}
</style>
