import type {
	ItemKeyframes,
	PathVertexKeyframeComponent,
	PathVertexKeyframeProperty,
	ShapePathVertex
} from '../project/types';

const PATH_VERTEX_COMPONENTS = [
	'positionX',
	'positionY',
	'inX',
	'inY',
	'outX',
	'outY'
] as const satisfies readonly PathVertexKeyframeComponent[];

export function buildPathVertexKeyframeProperty(
	vertexIndex: number,
	component: PathVertexKeyframeComponent
): PathVertexKeyframeProperty {
	return `pathVertex:${vertexIndex}:${component}`;
}

export function parsePathVertexKeyframeProperty(
	property: string
): { vertexIndex: number; component: PathVertexKeyframeComponent } | null {
	const match = /^pathVertex:(\d+):(positionX|positionY|inX|inY|outX|outY)$/.exec(property);
	if (!match) return null;
	const component = pathVertexComponent(match[2]);
	if (!component) return null;
	return {
		vertexIndex: Number(match[1]),
		component
	};
}

function pathVertexComponent(value: string | undefined): PathVertexKeyframeComponent | null {
	switch (value) {
		case 'positionX':
		case 'positionY':
		case 'inX':
		case 'inY':
		case 'outX':
		case 'outY':
			return value;
		default:
			return null;
	}
}

export function isPathVertexKeyframeProperty(
	property: string
): property is PathVertexKeyframeProperty {
	return parsePathVertexKeyframeProperty(property) !== null;
}

export function pathVertexKeyframeProperties(
	vertices: readonly ShapePathVertex[] | undefined
): PathVertexKeyframeProperty[] {
	if (!vertices) return [];
	return vertices.flatMap((_, vertexIndex) =>
		PATH_VERTEX_COMPONENTS.map((component) =>
			buildPathVertexKeyframeProperty(vertexIndex, component)
		)
	);
}

export function pathVertexPropertyValue(
	vertices: readonly ShapePathVertex[] | undefined,
	property: PathVertexKeyframeProperty
): number {
	const parsed = parsePathVertexKeyframeProperty(property);
	const vertex = parsed ? vertices?.[parsed.vertexIndex] : undefined;
	if (!parsed || !vertex) return 0;
	return componentValue(vertex, parsed.component);
}

export function setPathVertexPropertyValue(
	vertices: ShapePathVertex[],
	property: PathVertexKeyframeProperty,
	value: number
): boolean {
	const parsed = parsePathVertexKeyframeProperty(property);
	const vertex = parsed ? vertices[parsed.vertexIndex] : undefined;
	if (!parsed || !vertex) return false;
	setComponentValue(vertex, parsed.component, value);
	return true;
}

export function clonePathVertices(vertices: readonly ShapePathVertex[]): ShapePathVertex[] {
	return vertices.map((vertex) => ({
		...vertex,
		position: [...vertex.position],
		inHandle: [...vertex.inHandle],
		outHandle: [...vertex.outHandle]
	}));
}

export function hasPathVertexKeyframes(keyframes: ItemKeyframes | undefined): boolean {
	return Object.entries(keyframes ?? {}).some(
		([property, track]) => isPathVertexKeyframeProperty(property) && (track?.frames.length ?? 0) > 0
	);
}

export function changedPathVertexValues(
	previous: readonly ShapePathVertex[],
	next: readonly ShapePathVertex[],
	tolerance = 0.000001
): Array<{ property: PathVertexKeyframeProperty; value: number }> {
	if (previous.length !== next.length) return [];
	const changed: Array<{ property: PathVertexKeyframeProperty; value: number }> = [];
	for (const property of pathVertexKeyframeProperties(next)) {
		const previousValue = pathVertexPropertyValue(previous, property);
		const nextValue = pathVertexPropertyValue(next, property);
		if (Math.abs(previousValue - nextValue) > tolerance) {
			changed.push({ property, value: nextValue });
		}
	}
	return changed;
}

export function pathVertexPropertyLabel(property: string): string | null {
	const parsed = parsePathVertexKeyframeProperty(property);
	if (!parsed) return null;
	const label = {
		positionX: 'X',
		positionY: 'Y',
		inX: 'In X',
		inY: 'In Y',
		outX: 'Out X',
		outY: 'Out Y'
	} satisfies Record<PathVertexKeyframeComponent, string>;
	return `Vertex ${parsed.vertexIndex + 1} ${label[parsed.component]}`;
}

function componentValue(vertex: ShapePathVertex, component: PathVertexKeyframeComponent): number {
	switch (component) {
		case 'positionX':
			return vertex.position[0];
		case 'positionY':
			return vertex.position[1];
		case 'inX':
			return vertex.inHandle[0];
		case 'inY':
			return vertex.inHandle[1];
		case 'outX':
			return vertex.outHandle[0];
		case 'outY':
			return vertex.outHandle[1];
	}
}

function setComponentValue(
	vertex: ShapePathVertex,
	component: PathVertexKeyframeComponent,
	value: number
): void {
	switch (component) {
		case 'positionX':
			vertex.position[0] = value;
			return;
		case 'positionY':
			vertex.position[1] = value;
			return;
		case 'inX':
			vertex.inHandle[0] = value;
			return;
		case 'inY':
			vertex.inHandle[1] = value;
			return;
		case 'outX':
			vertex.outHandle[0] = value;
			return;
		case 'outY':
			vertex.outHandle[1] = value;
	}
}
