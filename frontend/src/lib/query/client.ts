import { QueryClient } from '@tanstack/svelte-query';
import { openPostQueryDefaults } from '@openpost/query-catalog';

export const queryClient = new QueryClient({ defaultOptions: openPostQueryDefaults });
