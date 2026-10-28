import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import InlineNotice from './inline-notice.svelte';

describe('inline notice live-region contract', () => {
	it('announces errors assertively', async () => {
		const screen = await render(InlineNotice, {
			tone: 'error',
			message: 'Export failed'
		});

		const notice = screen.getByRole('alert');
		expect(notice.element()).toHaveAttribute('aria-live', 'assertive');
		expect(notice.element()).toHaveTextContent('Export failed');
		expect(notice.element()).toHaveClass('bg-action-destructive');
		expect(notice.element()).toHaveClass('text-action-destructive-foreground');
		expect(notice.element()).toHaveClass('border-action-destructive-foreground/20');
	});

	it.each(['warning', 'info', 'success'] as const)(
		'announces %s notices politely as status',
		async (tone) => {
			const screen = await render(InlineNotice, {
				tone,
				message: 'Take note',
				onDismiss: tone === 'warning' ? vi.fn() : undefined,
				dismissLabel: 'Dismiss notice'
			});

			const notice = screen.getByRole('status');
			expect(notice.element()).toHaveAttribute('aria-live', 'polite');
			expect(notice.element()).toHaveTextContent('Take note');
			if (tone === 'warning') {
				expect(screen.container.querySelector('[data-protected-icon]')).toHaveAttribute(
					'data-protected-icon',
					'warning'
				);
				expect(
					screen
						.getByRole('button', { name: 'Dismiss notice' })
						.element()
						.querySelector('[data-theme-icon]')
				).toHaveAttribute('data-theme-icon', 'close');
			}
		}
	);

	it('supports a compact size for dense editor surfaces', async () => {
		const screen = await render(InlineNotice, {
			tone: 'error',
			message: 'Export failed',
			size: 'compact'
		});

		const notice = screen.getByRole('alert').element();
		expect(notice.classList.contains('text-xs')).toBe(true);
		expect(notice.classList.contains('text-sm')).toBe(false);
	});

	it('labels the notice region when provided', async () => {
		const screen = await render(InlineNotice, {
			tone: 'error',
			label: 'Validation issues'
		});

		expect(screen.getByRole('alert').element()).toHaveAttribute('aria-label', 'Validation issues');
	});

	it('dismisses through the dismiss action', async () => {
		const onDismiss = vi.fn();
		const screen = await render(InlineNotice, {
			tone: 'error',
			message: 'Export failed',
			onDismiss,
			dismissLabel: 'Dismiss error'
		});

		await screen.getByRole('button', { name: 'Dismiss error' }).click();
		expect(onDismiss).toHaveBeenCalledOnce();
	});
});
