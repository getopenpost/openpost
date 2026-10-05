<script lang="ts">
	import { createWorkspaceGate } from './workspace-gate.svelte';
	const gate = createWorkspaceGate();
</script>

<output aria-label="Workspace state">{gate.state}</output>
<p>{gate.workspaceName}</p>
