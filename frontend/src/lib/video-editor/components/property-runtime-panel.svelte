<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import type {
		DirectLinkableProperty,
		PropertyExpression,
		TimelineItem,
		VectorKeyframeProperty
	} from '$lib/video-editor/project/types';
	import {
		removeDirectPropertyLink,
		removePropertyExpression,
		setDirectPropertyLink,
		setPropertyExpression
	} from '$lib/video-editor/timeline/actions/property-runtime';
	import {
		coupleVectorDimensions,
		hasVectorDimensionAuthoringConflict,
		separateVectorDimensions,
		vectorDimensionsNeedBake,
		vectorSeparationNeedsBake
	} from '$lib/video-editor/timeline/actions/vector-dimensions';
	import {
		activeVectorKeyframes,
		VECTOR_COMPONENTS
	} from '$lib/video-editor/timeline/vector-keyframes';
	import {
		getAnimatablePropertiesForItem,
		resolvePreExpressionItemAt
	} from '$lib/video-editor/timeline/animated-properties';
	import {
		areDirectLinkPropertiesCompatible,
		isDirectLinkableProperty,
		isExpressionValueCompatible,
		type ExpressionValue
	} from '$lib/video-editor/timeline/property-expression';
	import { evaluateItemPropertyExpression } from '$lib/video-editor/timeline/property-runtime';

	let {
		item,
		items,
		availableProperties,
		currentFrame,
		fps,
		onedit
	}: {
		item: TimelineItem;
		items: TimelineItem[];
		availableProperties: string[];
		currentFrame: number;
		fps: number;
		onedit: () => void;
	} = $props();

	interface Endpoint {
		itemId: string;
		property: DirectLinkableProperty;
	}

	interface PickDrag {
		mode: 'link' | 'reference';
		pointerId: number;
		startX: number;
		startY: number;
		currentX: number;
		currentY: number;
	}

	const targetProperties = $derived.by<DirectLinkableProperty[]>(() => {
		const properties = availableProperties.filter(isDirectLinkableProperty);
		return withVectorProperties(properties);
	});
	let targetProperty = $state<DirectLinkableProperty>('x');
	let sourceItemId = $state('');
	let sourceProperty = $state<DirectLinkableProperty>('x');
	let offsetFrames = $state(0);
	let expressionSource = $state('value');
	let expressionEnabled = $state(true);
	let status = $state('');
	let showGuide = $state(false);
	let pickDrag = $state<PickDrag | null>(null);
	let expressionInput = $state<HTMLTextAreaElement | null>(null);

	const sourceItems = $derived(items);
	const selectedSource = $derived(sourceItems.find((candidate) => candidate.id === sourceItemId));
	const sourceProperties = $derived(selectedSource ? eligibleProperties(selectedSource) : []);
	const currentLink = $derived(
		item.propertyLinks?.find((link) => link.targetProperty === targetProperty)
	);
	const currentExpression = $derived(
		item.expressions?.find((expression) => expression.targetProperty === targetProperty)
	);
	const runtimeContext = $derived({
		absoluteFrame: currentFrame,
		fps,
		items,
		resolvePreExpressionItem: resolvePreExpressionItemAt
	});
	const draftExpression = $derived<PropertyExpression>({
		type: 'expression',
		targetProperty,
		source: expressionSource,
		enabled: expressionEnabled
	});
	const preExpressionValue = $derived.by<ExpressionValue>(() => {
		const withoutTarget = {
			...item,
			expressions: item.expressions?.filter((entry) => entry.targetProperty !== targetProperty)
		};
		return evaluateItemPropertyExpression(withoutTarget, targetProperty, runtimeContext).value;
	});
	const draftPreview = $derived(
		evaluateItemPropertyExpression(
			{
				...item,
				expressions: [
					...(item.expressions ?? []).filter((entry) => entry.targetProperty !== targetProperty),
					draftExpression
				]
			},
			targetProperty,
			runtimeContext
		)
	);
	const draftError = $derived(
		draftPreview.error ??
			(isExpressionValueCompatible(targetProperty, draftPreview.value)
				? null
				: m.video_editor_expression_wrong_type())
	);
	const dimensionRows = $derived(
		(['position', 'scale', 'anchor'] as const).map((property) => ({
			property,
			coupled: Boolean(activeVectorKeyframes(item, property)),
			hasAnimation: hasVectorDimensionAnimation(property),
			needsBake: activeVectorKeyframes(item, property)
				? vectorSeparationNeedsBake(item, property)
				: vectorDimensionsNeedBake(item, property)
		}))
	);

	$effect(() => {
		if (!targetProperties.includes(targetProperty)) targetProperty = targetProperties[0] ?? 'x';
	});

	$effect(() => {
		const link = currentLink;
		if (link) {
			sourceItemId = link.sourceItemId;
			sourceProperty = link.sourceProperty;
			offsetFrames = link.timeOffsetFrames;
		} else if (!sourceItems.some((candidate) => candidate.id === sourceItemId)) {
			sourceItemId =
				sourceItems.find((candidate) => candidate.id !== item.id)?.id ?? sourceItems[0]?.id ?? '';
		}
	});

	$effect(() => {
		const expression = currentExpression;
		expressionSource = expression?.source ?? 'value';
		expressionEnabled = expression?.enabled ?? true;
	});

	$effect(() => {
		if (!sourceProperties.includes(sourceProperty)) sourceProperty = sourceProperties[0] ?? 'x';
	});

	function linkableProperties(candidate: TimelineItem): DirectLinkableProperty[] {
		const properties: DirectLinkableProperty[] = getAnimatablePropertiesForItem(candidate).flatMap(
			(property) => (isDirectLinkableProperty(property) ? [property] : [])
		);
		return withVectorProperties(properties);
	}

	function withVectorProperties(properties: DirectLinkableProperty[]): DirectLinkableProperty[] {
		const next = [...properties];
		if (next.includes('x') && next.includes('y')) next.unshift('position');
		if (next.includes('width') && next.includes('height')) next.unshift('scale');
		if (next.includes('anchorX') && next.includes('anchorY')) next.unshift('anchor');
		return [...new Set(next)];
	}

	function eligibleProperties(candidate: TimelineItem): DirectLinkableProperty[] {
		return linkableProperties(candidate).filter(
			(property) =>
				areDirectLinkPropertiesCompatible(targetProperty, property) &&
				(candidate.id !== item.id || property !== targetProperty)
		);
	}

	function label(property: DirectLinkableProperty): string {
		if (property === 'position') return m.video_editor_expression_position();
		if (property === 'scale') return m.video_editor_expression_scale();
		if (property === 'anchor') return m.video_editor_expression_anchor();
		return property.replace(/([a-z])([A-Z])/g, '$1 $2');
	}

	function itemLabel(itemId: string): string {
		return items.find((candidate) => candidate.id === itemId)?.label ?? itemId;
	}

	function valueLabel(value: ExpressionValue): string {
		if (Object(value) === value) {
			// SAFETY: Object(value)===value guarantees value is an object; vectors in this branch carry x/y numbers.
			const vector = value as { x: number; y: number };
			return `${vector.x.toFixed(2)}, ${vector.y.toFixed(2)}`;
		}
		return Number(value).toFixed(2);
	}

	function applyLink(endpoint?: Endpoint): void {
		const source = endpoint ?? { itemId: sourceItemId, property: sourceProperty };
		if (!source.itemId) return;
		const result = setDirectPropertyLink(item.id, {
			type: 'link',
			targetProperty,
			sourceItemId: source.itemId,
			sourceProperty: source.property,
			enabled: true,
			timeOffsetFrames: Math.round(offsetFrames)
		});
		status = result.ok
			? m.video_editor_expression_linked({
					source: `${itemLabel(source.itemId)} ${label(source.property)}`
				})
			: result.reason === 'cycle'
				? m.video_editor_expression_cycle()
				: m.video_editor_expression_link_failed();
		if (result.ok) onedit();
	}

	function removeLink(): void {
		if (removeDirectPropertyLink(item.id, targetProperty)) {
			status = m.video_editor_expression_link_removed();
			onedit();
		}
	}

	function applyExpression(): void {
		if (draftError) {
			status = draftError;
			return;
		}
		setPropertyExpression(item.id, draftExpression);
		status = m.video_editor_expression_saved();
		onedit();
	}

	function removeExpression(): void {
		if (removePropertyExpression(item.id, targetProperty)) {
			status = m.video_editor_expression_removed();
			onedit();
		}
	}

	function cancelExpression(): void {
		expressionSource = currentExpression?.source ?? 'value';
		expressionEnabled = currentExpression?.enabled ?? true;
		status = m.video_editor_expression_cancelled();
	}

	function startPick(event: PointerEvent, mode: PickDrag['mode']): void {
		if (event.button !== 0) return;
		event.preventDefault();
		pickDrag = {
			mode,
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			currentX: event.clientX,
			currentY: event.clientY
		};
	}

	function movePick(event: PointerEvent): void {
		if (!pickDrag || event.pointerId !== pickDrag.pointerId) return;
		pickDrag = { ...pickDrag, currentX: event.clientX, currentY: event.clientY };
	}

	function finishPick(event: PointerEvent): void {
		const drag = pickDrag;
		if (!drag || event.pointerId !== drag.pointerId) return;
		const endpoint = endpointAt(event.clientX, event.clientY);
		pickDrag = null;
		if (!endpoint) {
			status = m.video_editor_expression_pick_cancelled();
			return;
		}
		if (drag.mode === 'link') applyLink(endpoint);
		else insertReference(endpoint);
	}

	function endpointAt(clientX: number, clientY: number): Endpoint | null {
		const chip = document
			.elementFromPoint(clientX, clientY)
			?.closest<HTMLElement>('[data-property-source-item][data-property-source-name]');
		const itemId = chip?.dataset.propertySourceItem;
		const property = chip?.dataset.propertySourceName;
		if (!itemId || !property || !isDirectLinkableProperty(property)) return null;
		if (itemId === item.id && property === targetProperty) return null;
		return areDirectLinkPropertiesCompatible(targetProperty, property)
			? { itemId, property }
			: null;
	}

	function insertReference(endpoint: Endpoint): void {
		const reference = `prop("${endpoint.itemId}", "${endpoint.property}")`;
		const cursorStart = expressionInput?.selectionStart ?? expressionSource.length;
		const cursorEnd = expressionInput?.selectionEnd ?? cursorStart;
		const replaceDefault = expressionSource.trim() === 'value' && cursorStart === cursorEnd;
		const start = replaceDefault ? 0 : cursorStart;
		const end = replaceDefault ? expressionSource.length : cursorEnd;
		expressionSource = `${expressionSource.slice(0, start)}${reference}${expressionSource.slice(end)}`;
		requestAnimationFrame(() => {
			expressionInput?.focus();
			expressionInput?.setSelectionRange(start + reference.length, start + reference.length);
		});
		status = m.video_editor_expression_reference_inserted({ source: itemLabel(endpoint.itemId) });
	}

	function cancelPick(event: KeyboardEvent): void {
		if (event.key !== 'Escape' || !pickDrag) return;
		event.preventDefault();
		pickDrag = null;
		status = m.video_editor_expression_pick_cancelled();
	}

	function hasVectorDimensionAnimation(property: VectorKeyframeProperty): boolean {
		if (activeVectorKeyframes(item, property)) return true;
		const [xProperty, yProperty] = VECTOR_COMPONENTS[property];
		return Boolean(item.keyframes?.[xProperty] || item.keyframes?.[yProperty]);
	}

	function toggleVectorDimensions(property: VectorKeyframeProperty, coupled: boolean): void {
		if (hasVectorDimensionAuthoringConflict(item, property, coupled)) {
			status = m.video_editor_expression_dimensions_conflict();
			return;
		}
		const needsBake = coupled
			? vectorSeparationNeedsBake(item, property)
			: vectorDimensionsNeedBake(item, property);
		const changed = coupled
			? separateVectorDimensions(item.id, property, needsBake)
			: coupleVectorDimensions(item.id, property, undefined, needsBake);
		if (!changed) return;
		status = coupled
			? m.video_editor_expression_dimensions_separated({ property: label(property) })
			: m.video_editor_expression_dimensions_coupled({ property: label(property) });
		onedit();
	}
</script>

<svelte:window
	onpointermove={movePick}
	onpointerup={finishPick}
	onpointercancel={() => (pickDrag = null)}
	onkeydown={cancelPick}
/>

{#if targetProperties.length > 0}
	<section class="runtime-panel" aria-labelledby="property-runtime-title">
		<header>
			<div>
				<h3 id="property-runtime-title">{m.video_editor_expression_title()}</h3>
				<p>{m.video_editor_expression_description()}</p>
			</div>
			<select aria-label={m.video_editor_expression_target()} bind:value={targetProperty}>
				{#each targetProperties as property}<option value={property}>{label(property)}</option
					>{/each}
			</select>
		</header>

		<div class="runtime-grid">
			<div class="card">
				<div class="card-heading">
					<strong>{m.video_editor_expression_link_title()}</strong>{#if currentLink}<span
							>{m.video_editor_expression_active()}</span
						>{/if}
				</div>
				<div class="source-row">
					<select aria-label={m.video_editor_expression_source_layer()} bind:value={sourceItemId}>
						<option value="">{m.video_editor_expression_choose_layer()}</option>
						{#each sourceItems as source}<option value={source.id}>{source.label}</option>{/each}
					</select>
					<select
						aria-label={m.video_editor_expression_source_property()}
						bind:value={sourceProperty}
					>
						{#each sourceProperties as property}<option value={property}>{label(property)}</option
							>{/each}
					</select>
				</div>
				<label class="offset"
					>{m.video_editor_expression_offset()}<input
						type="number"
						min="-900"
						max="900"
						bind:value={offsetFrames}
					/></label
				>
				<div class="actions">
					<button
						type="button"
						class="pick"
						aria-label={m.video_editor_expression_pick_link()}
						onpointerdown={(event) => startPick(event, 'link')}>⌁</button
					>
					<button type="button" class="primary" disabled={!sourceItemId} onclick={() => applyLink()}
						>{m.video_editor_expression_apply_link()}</button
					>
					{#if currentLink}<button type="button" onclick={removeLink}
							>{m.video_editor_expression_remove_link()}</button
						>{/if}
				</div>
			</div>

			<div class="card expression-card">
				<div class="card-heading">
					<strong>{m.video_editor_expression_editor()}</strong>{#if currentExpression}<span
							>{m.video_editor_expression_active()}</span
						>{/if}
				</div>
				<textarea
					bind:this={expressionInput}
					bind:value={expressionSource}
					aria-label={m.video_editor_expression_source()}
					spellcheck="false"></textarea>
				<div class="preview-values">
					<span
						>{m.video_editor_expression_pre()}
						<output>{valueLabel(preExpressionValue)}</output></span
					>
					<span
						>{m.video_editor_expression_post()}
						<output>{valueLabel(draftPreview.value)}</output></span
					>
				</div>
				{#if draftError}<p class="error" role="alert">{draftError}</p>{/if}
				<label class="enabled"
					><input type="checkbox" bind:checked={expressionEnabled} />
					{m.video_editor_expression_enabled()}</label
				>
				<div class="actions">
					<button
						type="button"
						class="pick"
						aria-label={m.video_editor_expression_pick_reference()}
						onpointerdown={(event) => startPick(event, 'reference')}>⌁</button
					>
					<button type="button" onclick={() => (showGuide = !showGuide)}
						>{m.video_editor_expression_guide()}</button
					>
					<button type="button" onclick={cancelExpression}
						>{m.video_editor_expression_cancel()}</button
					>
					<button
						type="button"
						class="primary"
						disabled={Boolean(draftError)}
						onclick={applyExpression}>{m.video_editor_expression_apply()}</button
					>
					{#if currentExpression}<button type="button" onclick={removeExpression}
							>{m.video_editor_expression_delete()}</button
						>{/if}
				</div>
				{#if showGuide}
					<div class="guide">
						<code>value · frame · time · prop("layer-id", "x")</code><code>+ − * / · [x, y]</code
						><code>abs · sin · cos · min · max · clamp · lerp</code>
					</div>
				{/if}
			</div>
		</div>
		<div class="dimension-strip" aria-label={m.video_editor_expression_dimensions_title()}>
			<div>
				<strong>{m.video_editor_expression_dimensions_title()}</strong>
				<span>{m.video_editor_expression_dimensions_description()}</span>
			</div>
			{#each dimensionRows as row}
				<div class="dimension-row">
					<span>{label(row.property)}</span>
					<small
						>{row.coupled
							? m.video_editor_expression_dimensions_coupled_state()
							: m.video_editor_expression_dimensions_separated_state()}</small
					>
					<button
						type="button"
						disabled={!row.hasAnimation}
						title={row.needsBake
							? row.coupled
								? m.video_editor_expression_dimensions_separate_bake_help()
								: m.video_editor_expression_dimensions_bake_help()
							: undefined}
						onclick={() => toggleVectorDimensions(row.property, row.coupled)}
						>{row.coupled
							? row.needsBake
								? m.video_editor_expression_dimensions_bake_separate()
								: m.video_editor_expression_dimensions_separate()
							: row.needsBake
								? m.video_editor_expression_dimensions_bake_couple()
								: m.video_editor_expression_dimensions_couple()}</button
					>
				</div>
			{/each}
		</div>
		<p class="status" aria-live="polite">{status}</p>

		{#if pickDrag}
			<div class="pick-targets" role="group" aria-label={m.video_editor_expression_pick_targets()}>
				<p>
					{pickDrag.mode === 'link'
						? m.video_editor_expression_drop_link()
						: m.video_editor_expression_drop_reference()}
				</p>
				{#each sourceItems as source}
					<div>
						<strong>{source.label}</strong>
						<div>
							{#each eligibleProperties(source) as property}
								<button
									type="button"
									data-property-source-item={source.id}
									data-property-source-name={property}>{label(property)}</button
								>
							{/each}
						</div>
					</div>
				{/each}
			</div>
			<svg class="pick-line" aria-hidden="true"
				><line
					x1={pickDrag.startX}
					y1={pickDrag.startY}
					x2={pickDrag.currentX}
					y2={pickDrag.currentY}
				/></svg
			>
		{/if}
	</section>
{/if}

<style>
	.runtime-panel {
		border-top: 1px solid oklch(0.25 0.015 55);
		padding: 0.55rem 0.65rem;
		color: oklch(0.86 0.015 70);
	}
	header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
	}
	h3,
	p {
		margin: 0;
	}
	h3 {
		font-size: 0.6875rem;
	}
	header p,
	.status {
		margin-top: 0.15rem;
		color: oklch(0.62 0.015 60);
		font-size: 0.5625rem;
	}
	select,
	input,
	textarea,
	button {
		border: 1px solid oklch(0.3 0.016 55);
		border-radius: 0.3rem;
		background: oklch(0.18 0.01 55);
		color: oklch(0.88 0.015 70);
		font: inherit;
	}
	select,
	input,
	button {
		min-height: 1.75rem;
		padding: 0 0.4rem;
	}
	.runtime-grid {
		display: grid;
		grid-template-columns: minmax(14rem, 0.8fr) minmax(18rem, 1.2fr);
		gap: 0.45rem;
		margin-top: 0.45rem;
	}
	.card {
		border: 1px solid oklch(0.26 0.014 55);
		border-radius: 0.4rem;
		padding: 0.45rem;
		background: oklch(0.155 0.008 55);
		font-size: 0.625rem;
	}
	.card-heading {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		margin-bottom: 0.35rem;
	}
	.card-heading span {
		color: oklch(0.78 0.12 55);
		font-size: 0.5625rem;
	}
	.source-row,
	.preview-values {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.35rem;
	}
	.dimension-strip {
		display: grid;
		grid-template-columns: minmax(12rem, 1fr) repeat(3, minmax(8rem, auto));
		gap: 0.35rem;
		align-items: center;
		margin-top: 0.45rem;
		border: 1px solid oklch(0.26 0.014 55);
		border-radius: 0.4rem;
		padding: 0.4rem 0.45rem;
		background: oklch(0.155 0.008 55);
		font-size: 0.625rem;
	}
	.dimension-strip > div:first-child,
	.dimension-row {
		display: grid;
		gap: 0.15rem;
	}
	.dimension-strip > div:first-child span,
	.dimension-row small {
		color: oklch(0.62 0.015 60);
		font-size: 0.5625rem;
	}
	.dimension-row button {
		margin-top: 0.15rem;
	}
	.offset {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.4rem;
		margin-top: 0.35rem;
		color: oklch(0.65 0.015 60);
	}
	.offset input {
		width: 5rem;
	}
	textarea {
		width: 100%;
		min-height: 4rem;
		resize: vertical;
		padding: 0.4rem;
		font-family: ui-monospace, monospace;
		line-height: 1.4;
	}
	.preview-values {
		margin-top: 0.3rem;
		color: oklch(0.62 0.015 60);
	}
	.preview-values span {
		display: flex;
		justify-content: space-between;
		gap: 0.4rem;
	}
	output {
		color: oklch(0.88 0.015 70);
		font-family: ui-monospace, monospace;
	}
	.enabled {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		margin-top: 0.3rem;
	}
	.enabled input {
		min-height: auto;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		margin-top: 0.4rem;
	}
	.actions button {
		cursor: pointer;
	}
	.actions .primary {
		border-color: oklch(0.58 0.13 45);
		background: oklch(0.52 0.13 45);
		color: white;
	}
	.actions .pick {
		width: 2rem;
		padding: 0;
		color: oklch(0.8 0.12 55);
		font-size: 1rem;
		cursor: crosshair;
	}
	button:disabled {
		cursor: not-allowed;
		opacity: 0.45;
	}
	.error {
		margin-top: 0.25rem;
		color: oklch(0.72 0.17 25);
		font-size: 0.5625rem;
	}
	.guide {
		display: grid;
		gap: 0.2rem;
		margin-top: 0.4rem;
		border-radius: 0.3rem;
		padding: 0.35rem;
		background: oklch(0.12 0.008 55);
		color: oklch(0.7 0.02 65);
	}
	.pick-targets {
		position: fixed;
		z-index: 1000;
		right: 1rem;
		bottom: 1rem;
		width: min(32rem, calc(100vw - 2rem));
		max-height: 50vh;
		overflow: auto;
		border: 1px solid oklch(0.65 0.13 50);
		border-radius: 0.5rem;
		padding: 0.55rem;
		background: oklch(0.14 0.012 55 / 0.98);
		box-shadow: 0 1rem 3rem oklch(0.05 0.01 55 / 0.6);
	}
	.pick-targets > p {
		margin-bottom: 0.4rem;
		color: oklch(0.8 0.02 65);
		font-size: 0.625rem;
	}
	.pick-targets > div {
		display: grid;
		grid-template-columns: 8rem 1fr;
		gap: 0.4rem;
		align-items: start;
		margin-top: 0.3rem;
	}
	.pick-targets > div > div {
		display: flex;
		flex-wrap: wrap;
		gap: 0.2rem;
	}
	.pick-targets button {
		min-height: 1.65rem;
		cursor: crosshair;
	}
	.pick-line {
		position: fixed;
		z-index: 1001;
		inset: 0;
		width: 100vw;
		height: 100vh;
		pointer-events: none;
	}
	.pick-line line {
		stroke: oklch(0.75 0.15 50);
		stroke-width: 2;
		stroke-dasharray: 5 4;
	}
	button:focus-visible,
	select:focus-visible,
	input:focus-visible,
	textarea:focus-visible {
		outline: 2px solid oklch(0.66 0.14 45);
		outline-offset: 2px;
	}
	@media (max-width: 48rem) {
		.runtime-grid {
			grid-template-columns: 1fr;
		}
		.dimension-strip {
			grid-template-columns: 1fr;
		}
	}
</style>
