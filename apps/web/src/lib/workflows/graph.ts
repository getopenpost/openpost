import type { Definition, Step, Run } from './api';
import type { ThemeIconRole } from '$lib/themes';
import {
	actionCatalog,
	actionCategory,
	sourceIcon,
	sourceLabel,
	type NodeCategory
} from './catalog';
import { workflowIssues, type Issue } from './validation';
import { m } from '$lib/paraglide/messages';
export type Port = 'after' | 'then' | 'else';
export type GraphNode = {
	id: string;
	x: number;
	y: number;
	label: string;
	description: string;
	icon: ThemeIconRole;
	category: NodeCategory;
	source?: boolean;
	branch?: boolean;
	issues: number;
	state?: string;
};
type GraphEdge = {
	id: string;
	source: string;
	target: string;
	port: Port;
};
export function workflowGraph(
	definition: Definition,
	run?: Run,
	issues: Issue[] = workflowIssues(definition, run?.source)
) {
	const nodes: GraphNode[] = [
		{
			id: 'source',
			x: 0,
			y: 0,
			label: sourceLabel(definition.source.kind),
			description: m.workflows_trigger(),
			icon: sourceIcon(definition.source.kind),
			category: 'triggers',
			source: true,
			issues: issues.filter((x) => x.node === 'source').length,
			state: run ? 'succeeded' : undefined
		}
	];
	const edges: GraphEdge[] = [];
	type End = { id: string; port: Port };
	function height(steps: Step[]): number {
		return Math.max(
			1,
			...steps.map((step) =>
				step.kind === 'condition' || step.kind === 'ai_decision'
					? height(step.then ?? []) + height(step.else ?? [])
					: 1
			)
		);
	}
	type SequenceTail = { x: number; ends: End[] };
	function sequence(steps: Step[], x: number, y: number, ends: End[]): SequenceTail {
		for (const step of steps) {
			const entry = actionCatalog().find((item) => item.kind === step.kind);
			const branch = step.kind === 'condition' || step.kind === 'ai_decision';
			nodes.push({
				id: step.id,
				x,
				y,
				label: step.name || entry?.label || step.kind,
				description: entry?.label ?? '',
				icon: entry?.icon ?? 'settings',
				category: actionCategory(step.kind),
				branch,
				issues: issues.filter((issue) => issue.node === step.id).length,
				state: run?.steps?.find((result) => result.step_id === step.id)?.state
			});
			for (const end of ends)
				edges.push({
					id: `${end.id}:${end.port}:${step.id}`,
					source: end.id,
					target: step.id,
					port: end.port
				});
			x += 300;
			ends = [{ id: step.id, port: 'after' }];
			if (branch) {
				const yes = sequence(step.then ?? [], x, y - height(step.else ?? []) * 80, [
					{ id: step.id, port: 'then' }
				]);
				const no = sequence(step.else ?? [], x, y + height(step.then ?? []) * 80, [
					{ id: step.id, port: 'else' }
				]);
				x = Math.max(yes.x, no.x);
				ends = [...yes.ends, ...no.ends];
			}
		}
		return { x, ends };
	}
	sequence(definition.steps ?? [], 300, 0, [{ id: 'source', port: 'after' }]);
	return { nodes, edges };
}
