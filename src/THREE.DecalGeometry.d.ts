import { BufferGeometry, ColorRepresentation, Euler, Intersection, Material, Mesh, Object3D, Vector3 } from 'three';

/** What a decal is cut from: a mesh, a list of them, or an object that has them under it. */
export type DecalTarget = Mesh | Object3D | Array<Mesh | Object3D>;

export interface DecalFade {
	/** From how many degrees away from facing the decal it starts to fade. 45 by default. */
	angle?: number;
	/** The part of the depth of the box that fades at each end. .3 by default. */
	depth?: number;
}

export interface DecalOptions {
	/** Which pairs of sides of the box clip the mesh, with 1 or 0 for each one. */
	check?: Vector3;
	/** How far a triangle can be from facing the decal, in degrees. 180 by default. */
	maxAngle?: number;
	/** The decal in the coordinates of the mesh. Only when it's cut from one mesh. */
	local?: boolean;
	/** The decal with the bones of a SkinnedMesh. Only when it's cut from one mesh. */
	skin?: boolean;
	/** The decal with the morphs of the mesh. Only when it's cut from one mesh. */
	morph?: boolean;
	/** Which one to cut, of an InstancedMesh. */
	instanceId?: number;
	/** Edges that fade away, in the alpha of the colors of the vertices. */
	fade?: boolean | DecalFade;
	/** The color of the vertices. */
	color?: ColorRepresentation;
	/** How far from the surface, along its normals. */
	offset?: number;
	/** Tangents along the x of the box. */
	tangents?: boolean;
	/** Triangles that share the vertices that the ones of the mesh share. */
	indexed?: boolean;
	/** The part of the texture that the decal shows: [ u0, v0, u1, v1 ]. */
	uvRect?: [ number, number, number, number ];
	/** false to look at every triangle of the mesh. */
	grid?: boolean;
}

export interface IntersectionOptions extends DecalOptions {
	/** How much the decal is turned around the way it looks, in radians. */
	angle?: number;
	/** What to cut, when it's more than what was hit. */
	target?: DecalTarget;
}

export interface DecalBox {
	mesh: Object3D;
	position: Vector3;
	rotation: Euler;
	dimensions: Vector3;
	instanceId: number | undefined;
}

export class DecalGeometry extends BufferGeometry {

	readonly isDecalGeometry: true;

	constructor( target?: DecalTarget, position?: Vector3, rotation?: Euler | Vector3, dimensions?: Vector3, options?: DecalOptions );
	constructor( target: DecalTarget, position: Vector3, rotation: Euler | Vector3, dimensions: Vector3, check: Vector3 | null, options?: DecalOptions );

	static fromIntersection( hit: Intersection, size?: number | Vector3, options?: IntersectionOptions ): DecalGeometry;

	update( target: DecalTarget, position?: Vector3, rotation?: Euler | Vector3, dimensions?: Vector3, options?: DecalOptions ): this;
	update( target: DecalTarget, position: Vector3, rotation: Euler | Vector3, dimensions: Vector3, check: Vector3 | null, options?: DecalOptions ): this;

}

export interface BatchedDecal {
	/** Its first vertex in the geometry. */
	start: number;
	/** How many vertices it has. */
	count: number;
	/** When it was added, in seconds. */
	born: number;
	opacity: number;
}

export interface DecalBatchOptions extends DecalOptions {
	/** The vertices to make room for at first. 1024 by default. */
	capacity?: number;
	/** The most vertices that it can have. When it's full, the oldest decals make room. */
	maxVertices?: number;
	/** The seconds that a decal lasts. */
	lifetime?: number;
	/** The seconds that a decal takes to go away. 1 by default. */
	fadeTime?: number;
}

export interface BatchAddOptions extends DecalOptions {
	/** When the decal is added, in seconds. Now by default. */
	time?: number;
}

export class DecalBatch extends BufferGeometry {

	readonly isDecalBatch: true;

	options: DecalBatchOptions;
	maxVertices: number;
	lifetime: number;
	fadeTime: number;

	/** Where the vertices end. */
	count: number;
	/** The decals there are, the oldest first. */
	decals: BatchedDecal[];

	constructor( options?: DecalBatchOptions );

	add( target: DecalTarget, position: Vector3, rotation: Euler | Vector3, dimensions: Vector3, options?: BatchAddOptions ): BatchedDecal | null;
	addFromIntersection( hit: Intersection, size?: number | Vector3, options?: BatchAddOptions & IntersectionOptions ): BatchedDecal | null;
	remove( decal: BatchedDecal ): void;
	setOpacity( decal: BatchedDecal, opacity: number ): void;
	update( time?: number ): void;
	clear(): void;

}

export function createDecal( mesh: Mesh, geometry: BufferGeometry, material: Material | Material[] ): Mesh;
export const createSkinnedDecal: typeof createDecal;

export function boxFromIntersection( hit: Intersection, size?: number | Vector3, angle?: number ): DecalBox;

export function prepare( target: DecalTarget | BufferGeometry ): void;
export function prepareAsync( target: DecalTarget | BufferGeometry ): Promise<void[]>;
