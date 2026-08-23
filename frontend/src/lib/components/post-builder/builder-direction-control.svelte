<script lang="ts">
	import SlidersIcon from '@lucide/svelte/icons/sliders-horizontal';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import * as Dialog from '$lib/components/ui/dialog';
	import AppSelect from '$lib/components/app-select.svelte';
	import { postBuilderDirectionLabel, type PostBuilderDirection } from '$lib/post-builder';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		open?: boolean;
		direction: PostBuilderDirection;
		disabled?: boolean;
		onChange: (direction: PostBuilderDirection) => void;
	}

	let { open = $bindable(false), direction, disabled = false, onChange }: Props = $props();
	let draft = $state<PostBuilderDirection>({});
	const directionLabel = $derived(postBuilderDirectionLabel(direction));

	function openEditor(): void {
		draft = { ...direction };
		open = true;
	}

	function clear(): void {
		draft = { research: 'auto', destinationStrategy: 'recommend' };
	}

	function apply(): void {
		onChange({
			goal: draft.goal?.trim() || undefined,
			audience: draft.audience?.trim() || undefined,
			angle: draft.angle?.trim() || undefined,
			tone: draft.tone?.trim() || undefined,
			media: draft.media?.trim() || undefined,
			research: 'auto',
			destinationStrategy: draft.destinationStrategy ?? 'recommend'
		});
		open = false;
	}
</script>

<Button
	type="button"
	variant="outline"
	class="min-w-0 justify-start"
	{disabled}
	onclick={openEditor}
>
	<SlidersIcon class="size-4" />
	<span class="min-w-0 truncate">{m.post_builder_direction()}: {directionLabel}</span>
</Button>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-xl">
		<Dialog.Header>
			<Dialog.Title>{m.post_builder_direction_title()}</Dialog.Title>
			<Dialog.Description>{m.post_builder_direction_description()}</Dialog.Description>
		</Dialog.Header>

		<div class="grid gap-4 py-1 sm:grid-cols-2">
			<div class="space-y-2">
				<Label for="post-builder-goal">{m.post_builder_goal()}</Label>
				<AppSelect
					id="post-builder-goal"
					value={draft.goal ?? ''}
					options={[
						{ value: '', label: m.post_builder_auto() },
						{ value: 'Build authority', label: m.post_builder_goal_authority() },
						{ value: 'Start discussion', label: m.post_builder_goal_discussion() },
						{ value: 'Announce', label: m.post_builder_goal_announce() },
						{ value: 'Get users', label: m.post_builder_goal_users() },
						{ value: 'Make people laugh', label: m.post_builder_goal_laugh() }
					]}
					onValueChange={(value) => (draft.goal = value)}
				/>
			</div>

			<div class="space-y-2">
				<Label for="post-builder-policy">{m.post_builder_destination_policy()}</Label>
				<AppSelect
					id="post-builder-policy"
					value={draft.destinationStrategy ?? 'recommend'}
					options={[
						{ value: 'recommend', label: m.post_builder_policy_recommend() },
						{ value: 'require_all', label: m.post_builder_policy_all() }
					]}
					onValueChange={(value) =>
						(draft.destinationStrategy = value === 'require_all' ? 'require_all' : 'recommend')}
				/>
			</div>

			<div class="space-y-2 sm:col-span-2">
				<Label for="post-builder-audience">{m.post_builder_audience()}</Label>
				<Input
					id="post-builder-audience"
					value={draft.audience ?? ''}
					maxlength={1000}
					placeholder={m.post_builder_audience_placeholder()}
					oninput={(event) => (draft.audience = event.currentTarget.value)}
				/>
			</div>

			<div class="space-y-2 sm:col-span-2">
				<Label for="post-builder-angle">{m.post_builder_angle()}</Label>
				<Textarea
					id="post-builder-angle"
					value={draft.angle ?? ''}
					maxlength={1500}
					placeholder={m.post_builder_angle_placeholder()}
					class="min-h-20"
					oninput={(event) => (draft.angle = event.currentTarget.value)}
				/>
			</div>

			<div class="space-y-2">
				<Label for="post-builder-tone">{m.post_builder_tone()}</Label>
				<Input
					id="post-builder-tone"
					value={draft.tone ?? ''}
					maxlength={500}
					placeholder={m.post_builder_tone_placeholder()}
					oninput={(event) => (draft.tone = event.currentTarget.value)}
				/>
			</div>

			<div class="space-y-2">
				<Label for="post-builder-media">{m.post_builder_media_preference()}</Label>
				<Input
					id="post-builder-media"
					value={draft.media ?? ''}
					maxlength={500}
					placeholder={m.post_builder_media_placeholder()}
					oninput={(event) => (draft.media = event.currentTarget.value)}
				/>
			</div>
		</div>

		<Dialog.Footer>
			<Button type="button" variant="ghost" onclick={clear}
				>{m.post_builder_clear_direction()}</Button
			>
			<Button type="button" onclick={apply}>{m.common_done()}</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
