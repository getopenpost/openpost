import { expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import MediaPoolList from './media-pool-list.svelte';
import { mediaTasks } from '../media/media-tasks.svelte';
import { mediaRecovery } from '../media/media-recovery.svelte';

it('does not count preview preparation as a media failure', async () => {
	mediaRecovery.reset();
	mediaTasks.reset();
	mediaTasks.start({ id: 'proxy:first', kind: 'proxy', label: 'First recording' });
	mediaTasks.start({ id: 'proxy:second', kind: 'proxy', label: 'Second recording' });
	try {
		const screen = await render(MediaPoolList, { projectId: 'preparing-recordings' });
		await expect
			.element(screen.getByRole('button', { name: /media issues need attention/ }))
			.not.toBeInTheDocument();
		mediaRecovery.sourceIssues = [{ kind: 'missing', mediaId: 'missing', fileName: 'missing.mp4' }];
		await expect
			.element(screen.getByRole('button', { name: '1 media issues need attention', exact: true }))
			.toBeVisible();
	} finally {
		mediaTasks.reset();
		mediaRecovery.reset();
	}
});
