<script lang="ts">
	import { Calendar as CalendarPrimitive } from 'bits-ui';
	import * as CalendarParts from './index.js';
	import { cn, type WithoutChildrenOrChild } from '../../utils.js';
	import type { ButtonVariant } from '../button/button.svelte';
	import { isEqualMonth, type DateValue } from '@internationalized/date';
	import type { Snippet } from 'svelte';
	import { getUiMessages } from '../../messages.js';
	const m = getUiMessages();

	let {
		ref = $bindable(null),
		value = $bindable(),
		placeholder = $bindable(),
		class: className,
		weekdayFormat = 'short',
		buttonVariant = 'ghost',
		captionLayout = 'label',
		locale = 'en-US',
		months: monthsProp,
		years,
		monthFormat: monthFormatProp,
		yearFormat = 'numeric',
		day,
		captionAction,
		disableDaysOutsideMonth = false,
		...restProps
	}: WithoutChildrenOrChild<CalendarPrimitive.RootProps> & {
		buttonVariant?: ButtonVariant;
		captionLayout?: 'dropdown' | 'dropdown-months' | 'dropdown-years' | 'label';
		months?: CalendarPrimitive.MonthSelectProps['months'];
		years?: CalendarPrimitive.YearSelectProps['years'];
		monthFormat?: CalendarPrimitive.MonthSelectProps['monthFormat'];
		yearFormat?: CalendarPrimitive.YearSelectProps['yearFormat'];
		day?: Snippet<[{ day: DateValue; outsideMonth: boolean }]>;
		captionAction?: Snippet;
	} = $props();

	const monthFormat = $derived.by(() => {
		if (monthFormatProp) return monthFormatProp;
		if (captionLayout.startsWith('dropdown')) return 'short';
		return 'long';
	});
</script>

<!--
Discriminated Unions + Destructing (required for bindable) do not
get along, so we shut typescript up by casting `value` to `never`.
-->
<CalendarPrimitive.Root
	bind:value={value as never}
	bind:ref
	bind:placeholder
	{weekdayFormat}
	{disableDaysOutsideMonth}
	class={cn(
		'group/calendar bg-background p-3 [--cell-radius:var(--radius-md)] [--cell-size:--spacing(6)] in-data-[slot=card-content]:bg-transparent in-data-[slot=popover-content]:bg-transparent',
		className
	)}
	{locale}
	{monthFormat}
	{yearFormat}
	calendarLabel={m.calendar_label()}
	{...restProps}
>
	{#snippet children({ months, weekdays })}
		<CalendarParts.Months>
			<CalendarParts.Nav>
				<CalendarParts.PrevButton variant={buttonVariant} />
				<CalendarParts.NextButton variant={buttonVariant} />
			</CalendarParts.Nav>
			{#each months as month, monthIndex (month)}
				<CalendarParts.Month>
					<CalendarParts.Header>
						<CalendarParts.Caption
							{captionLayout}
							months={monthsProp}
							{monthFormat}
							{years}
							{yearFormat}
							month={month.value}
							bind:placeholder
							{locale}
							{monthIndex}
						/>
						{#if captionAction && monthIndex === 0}
							{@render captionAction()}
						{/if}
					</CalendarParts.Header>
					<CalendarParts.Grid>
						<CalendarParts.GridHead>
							<CalendarParts.GridRow class="select-none">
								{#each weekdays as weekday (weekday)}
									<CalendarParts.HeadCell>
										{weekday.slice(0, 2)}
									</CalendarParts.HeadCell>
								{/each}
							</CalendarParts.GridRow>
						</CalendarParts.GridHead>
						<CalendarParts.GridBody>
							{#each month.weeks as weekDates (weekDates)}
								<CalendarParts.GridRow class="mt-2 w-full">
									{#each weekDates as date (date)}
										<CalendarParts.Cell {date} month={month.value}>
											{#if day}
												{@render day({
													day: date,
													outsideMonth: !isEqualMonth(date, month.value)
												})}
											{:else}
												<CalendarParts.Day />
											{/if}
										</CalendarParts.Cell>
									{/each}
								</CalendarParts.GridRow>
							{/each}
						</CalendarParts.GridBody>
					</CalendarParts.Grid>
				</CalendarParts.Month>
			{/each}
		</CalendarParts.Months>
	{/snippet}
</CalendarPrimitive.Root>
