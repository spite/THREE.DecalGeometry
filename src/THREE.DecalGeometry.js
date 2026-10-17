import {
	Box3,
	BufferAttribute,
	BufferGeometry,
	Color,
	Euler,
	Matrix3,
	Matrix4,
	Mesh,
	Object3D,
	Quaternion,
	SkinnedMesh,
	Sphere,
	Vector3
} from 'three';

const _one = new Vector3( 1, 1, 1 );
const _white = new Color( 1, 1, 1 );
const _v = new Vector3();
const _n = new Vector3();
const _t = new Vector3();
const _b = new Vector3();
const _xAxis = new Vector3();
const _yAxis = new Vector3();
const _zAxis = new Vector3();
const _color = new Color();
const _euler = new Euler();
const _quaternion = new Quaternion();
const _boxMatrix = new Matrix4();
const _boxInverse = new Matrix4();
const _meshMatrix = new Matrix4();
const _meshInverse = new Matrix4();
const _toBox = new Matrix4();
const _fromBox = new Matrix4();
const _boxToMesh = new Matrix4();
const _normalMatrix = new Matrix3();
const _worldNormalMatrix = new Matrix3();
const _sphere = new Sphere();
const _box = new Box3();
const _bone = new Matrix4();
const _helper = new Object3D();

// what each bone does to a vertex, all the way to the box: 16 numbers for each
let _boneMatrices = new Float64Array( 0 );

// a vertex being clipped: its position in the box, its normal, how much it faces the decal, and its weight for each corner
const STRIDE = 10;
let _polygon = new Float64Array( 12 * STRIDE );
let _clipped = new Float64Array( 12 * STRIDE );

// the positions of the vertices in the box, and when each one was put there
let _positions = new Float32Array( 0 );
let _stamps = new Uint32Array( 0 );
let _shared = new Int32Array( 0 );
let _stamp = 0;

// the decal that was cut last, before it goes to a geometry
const _out = {
	vertices: 0,
	indices: 0,
	position: new Float32Array( 0 ),
	normal: new Float32Array( 0 ),
	uv: new Float32Array( 0 ),
	color: new Float32Array( 0 ),
	tangent: new Float32Array( 0 ),
	skinIndex: new Uint16Array( 0 ),
	skinWeight: new Float32Array( 0 ),
	index: new Uint32Array( 0 ),
	morphs: [],
	attributes: []
};

const sizes = { position: 3, normal: 3, uv: 2, color: 4, tangent: 4, skinIndex: 4, skinWeight: 4 };

// room in an array for a number of items more, keeping what it has
function grow( name, itemSize, count ) {

	const array = _out[ name ];

	if ( array.length >= count * itemSize ) return array;

	const bigger = new array.constructor( Math.max( count * itemSize, array.length * 2 ) );
	bigger.set( array );

	return ( _out[ name ] = bigger );

}

const smoothstep = ( a, b, v ) => {

	const t = Math.min( 1, Math.max( 0, ( v - a ) / ( b - a ) ) );
	return t * t * ( 3 - 2 * t );

};

// the part of a polygon that is on the inside of a side of the box. Returns how many vertices are left
function clip( from, count, to, axis, sign, size ) {

	let out = 0;

	for ( let j = 0; j < count; j ++ ) {

		const a = j * STRIDE;
		const b = ( ( j + 1 ) % count ) * STRIDE;
		const d0 = sign * from[ a + axis ] - size;
		const d1 = sign * from[ b + axis ] - size;

		if ( d0 <= 0 ) {

			for ( let k = 0; k < STRIDE; k ++ ) to[ out * STRIDE + k ] = from[ a + k ];
			out ++;

		}

		// the edge crosses the side: a new vertex where it does, with everything in between
		if ( ( d0 < 0 && d1 > 0 ) || ( d0 > 0 && d1 < 0 ) ) {

			const s = d0 / ( d0 - d1 );

			for ( let k = 0; k < STRIDE; k ++ ) to[ out * STRIDE + k ] = from[ a + k ] + s * ( from[ b + k ] - from[ a + k ] );
			out ++;

		}

	}

	return out;

}

// ---- a grid over a geometry, to look only at the triangles that are near the box

const _grids = new WeakMap();

// It only uses what it's given, so it can run in a worker
function buildGrid( source, stride, offset, indices, triangles ) {

	const min = [ Infinity, Infinity, Infinity ], max = [ - Infinity, - Infinity, - Infinity ];

	for ( let t = 0; t < triangles * 3; t ++ ) {

		const id = indices ? indices[ t ] : t;

		for ( let k = 0; k < 3; k ++ ) {

			const value = source[ id * stride + offset + k ];
			if ( value < min[ k ] ) min[ k ] = value;
			if ( value > max[ k ] ) max[ k ] = value;

		}

	}

	const extent = [ max[ 0 ] - min[ 0 ], max[ 1 ] - min[ 1 ], max[ 2 ] - min[ 2 ] ];
	const longest = Math.max( extent[ 0 ], extent[ 1 ], extent[ 2 ], 1e-9 );

	// about two triangles in each cell, if they were all the same
	const n = Math.cbrt( triangles / 2 );
	const res = extent.map( e => Math.max( 1, Math.min( 64, Math.ceil( n * e / longest ) ) ) );
	const scale = extent.map( ( e, k ) => e > 0 ? res[ k ] / e : 0 );
	const cells = res[ 0 ] * res[ 1 ] * res[ 2 ];

	// the cells that each triangle touches, as a range in each axis
	const ranges = new Uint8Array( triangles * 6 );
	const cellStart = new Uint32Array( cells + 1 );

	for ( let t = 0; t < triangles; t ++ ) {

		for ( let k = 0; k < 3; k ++ ) {

			let lo = Infinity, hi = - Infinity;

			for ( let c = 0; c < 3; c ++ ) {

				const id = indices ? indices[ t * 3 + c ] : t * 3 + c;
				const value = source[ id * stride + offset + k ];
				if ( value < lo ) lo = value;
				if ( value > hi ) hi = value;

			}

			ranges[ t * 6 + k ] = Math.min( res[ k ] - 1, Math.max( 0, Math.floor( ( lo - min[ k ] ) * scale[ k ] ) ) );
			ranges[ t * 6 + 3 + k ] = Math.min( res[ k ] - 1, Math.max( 0, Math.floor( ( hi - min[ k ] ) * scale[ k ] ) ) );

		}

		for ( let z = ranges[ t * 6 + 2 ]; z <= ranges[ t * 6 + 5 ]; z ++ ) for ( let y = ranges[ t * 6 + 1 ]; y <= ranges[ t * 6 + 4 ]; y ++ ) for ( let x = ranges[ t * 6 ]; x <= ranges[ t * 6 + 3 ]; x ++ ) cellStart[ ( z * res[ 1 ] + y ) * res[ 0 ] + x + 1 ] ++;

	}

	for ( let c = 0; c < cells; c ++ ) cellStart[ c + 1 ] += cellStart[ c ];

	const items = new Uint32Array( cellStart[ cells ] );
	const next = cellStart.slice( 0, cells );

	for ( let t = 0; t < triangles; t ++ ) {

		for ( let z = ranges[ t * 6 + 2 ]; z <= ranges[ t * 6 + 5 ]; z ++ ) for ( let y = ranges[ t * 6 + 1 ]; y <= ranges[ t * 6 + 4 ]; y ++ ) for ( let x = ranges[ t * 6 ]; x <= ranges[ t * 6 + 3 ]; x ++ ) items[ next[ ( z * res[ 1 ] + y ) * res[ 0 ] + x ] ++ ] = t;

	}

	return { min, scale, res, cellStart, items };

}

// what a geometry is, to know if its grid is the one of what it has now
function gridInput( geometry ) {

	const positions = geometry.attributes.position;
	const index = geometry.index;
	const interleaved = positions.isInterleavedBufferAttribute === true;

	return {
		key: positions.version + ':' + positions.count + ':' + ( index ? index.version + ':' + index.count : '' ),
		source: interleaved ? positions.data.array : positions.array,
		stride: interleaved ? positions.data.stride : 3,
		offset: interleaved ? positions.offset : 0,
		indices: index ? index.array : null,
		triangles: Math.floor( ( index ? index.count : positions.count ) / 3 )
	};

}

function keepGrid( geometry, key, built, triangles ) {

	const grid = { key, ...built, seen: new Uint32Array( triangles ), stamp: 0, found: new Uint32Array( triangles ) };
	_grids.set( geometry, grid );

	return grid;

}

function getGrid( geometry ) {

	const input = gridInput( geometry );
	const grid = _grids.get( geometry );

	if ( grid !== undefined && grid.key === input.key ) return grid;

	return keepGrid( geometry, input.key, buildGrid( input.source, input.stride, input.offset, input.indices, input.triangles ), input.triangles );

}

// Makes the grid of a geometry, or of the ones of everything under an object, before the first decal needs it
function prepare( target ) {

	for ( const geometry of geometriesOf( target ) ) getGrid( geometry );

}

// The same in a worker, without stopping the page. It makes them here if it can't
function prepareAsync( target ) {

	return Promise.all( geometriesOf( target ).map( function ( geometry ) {

		const input = gridInput( geometry );
		const grid = _grids.get( geometry );

		if ( grid !== undefined && grid.key === input.key ) return Promise.resolve();

		return new Promise( function ( resolve ) {

			const here = function () {

				getGrid( geometry );
				resolve();

			};

			try {

				const url = URL.createObjectURL( new Blob( [ buildGrid.toString() + '; onmessage = e => { const g = buildGrid( ...e.data ); postMessage( g, [ g.cellStart.buffer, g.items.buffer ] ); };' ], { type: 'text/javascript' } ) );
				const worker = new Worker( url );

				const done = function () {

					worker.terminate();
					URL.revokeObjectURL( url );

				};

				worker.onmessage = function ( e ) {

					done();

					// the geometry may have changed while its grid was being made
					if ( gridInput( geometry ).key === input.key ) keepGrid( geometry, input.key, e.data, input.triangles );

					resolve();

				};

				worker.onerror = function () {

					done();
					here();

				};

				worker.postMessage( [ input.source, input.stride, input.offset, input.indices, input.triangles ] );

			} catch ( e ) {

				here();

			}

		} );

	} ) );

}

// the meshes to cut: one, a list, or the ones under an object. The decals are left out
const isDecal = object => object.geometry && ( object.geometry.isDecalGeometry === true || object.geometry.isDecalBatch === true );
const isCuttable = object => object.isMesh === true && ! isDecal( object ) && object.geometry && object.geometry.attributes.position !== undefined;

function meshesOf( target ) {

	if ( Array.isArray( target ) ) return target.flatMap( meshesOf );
	if ( ! target || target.isObject3D !== true ) return [];
	if ( target.isMesh === true ) return isCuttable( target ) ? [ target ] : [];

	const meshes = [];

	target.traverseVisible( function ( object ) {

		if ( isCuttable( object ) ) meshes.push( object );

	} );

	return meshes;

}

const geometriesOf = target => target && target.isBufferGeometry ? [ target ] : [ ...new Set( meshesOf( target ).map( mesh => mesh.geometry ) ) ];

// the triangles of the cells that a box touches, each one once. Returns how many
function queryGrid( grid, box ) {

	const { min, scale, res, cellStart, items, seen, found } = grid;
	const lo = [ box.min.x, box.min.y, box.min.z ], hi = [ box.max.x, box.max.y, box.max.z ];
	const from = [ 0, 0, 0 ], to = [ 0, 0, 0 ];

	for ( let k = 0; k < 3; k ++ ) {

		from[ k ] = Math.floor( ( lo[ k ] - min[ k ] ) * scale[ k ] );
		to[ k ] = Math.floor( ( hi[ k ] - min[ k ] ) * scale[ k ] );

		if ( to[ k ] < 0 || from[ k ] > res[ k ] - 1 ) return 0;

		from[ k ] = Math.max( 0, from[ k ] );
		to[ k ] = Math.min( res[ k ] - 1, to[ k ] );

	}

	const stamp = ++ grid.stamp;
	let count = 0;

	for ( let z = from[ 2 ]; z <= to[ 2 ]; z ++ ) for ( let y = from[ 1 ]; y <= to[ 1 ]; y ++ ) for ( let x = from[ 0 ]; x <= to[ 0 ]; x ++ ) {

		const cell = ( z * res[ 1 ] + y ) * res[ 0 ] + x;

		for ( let i = cellStart[ cell ]; i < cellStart[ cell + 1 ]; i ++ ) {

			const t = items[ i ];

			if ( seen[ t ] !== stamp ) {

				seen[ t ] = stamp;
				found[ count ++ ] = t;

			}

		}

	}

	return count;

}

// ---- the cut

// the bones of a vertex of the decal: the ones of the corners of its triangle, as much as it is of each, and the 4 that count most
const _bones = new Map();

function mixBones( skinIndex, skinWeight, ids, weights, target, at ) {

	_bones.clear();

	for ( let c = 0; c < 3; c ++ ) {

		if ( weights[ c ] <= 0 ) continue;

		for ( let k = 0; k < 4; k ++ ) {

			const weight = skinWeight.getComponent( ids[ c ], k ) * weights[ c ];
			if ( weight <= 0 ) continue;

			const bone = skinIndex.getComponent( ids[ c ], k );
			_bones.set( bone, ( _bones.get( bone ) || 0 ) + weight );

		}

	}

	const sorted = [ ..._bones ].sort( ( a, b ) => b[ 1 ] - a[ 1 ] ).slice( 0, 4 );
	const total = sorted.reduce( ( sum, entry ) => sum + entry[ 1 ], 0 ) || 1;

	for ( let k = 0; k < 4; k ++ ) {

		target.skinIndex[ at * 4 + k ] = k < sorted.length ? sorted[ k ][ 0 ] : 0;
		target.skinWeight[ at * 4 + k ] = k < sorted.length ? sorted[ k ][ 1 ] / total : 0;

	}

}

// cuts the decal into _out and says which attributes it has, with the options of DecalOptions in the .d.ts
function cut( target, position, rotation, dimensions, check, options, forceColor ) {

	if ( check !== null && check !== undefined && check.isVector3 !== true ) {

		options = check;
		check = null;

	}

	options = options || {};
	check = check || options.check || _one;

	const meshes = meshesOf( target );

	if ( meshes.length === 0 ) throw new TypeError( 'THREE.DecalGeometry: it needs a Mesh that has a geometry with positions, or a list of them, or an object that has them' );
	if ( ! ( dimensions.x > 0 && dimensions.y > 0 && dimensions.z > 0 ) ) throw new RangeError( 'THREE.DecalGeometry: the dimensions of the box have to be bigger than zero' );

	// a decal of many meshes is in the world: it can't be in the coordinates of all of them
	const single = meshes.length === 1 ? meshes[ 0 ] : null;
	const skin = single !== null && options.skin === true && single.isSkinnedMesh === true && single.geometry.attributes.skinIndex !== undefined;
	const morphs = single !== null && options.morph === true && Array.isArray( single.geometry.morphAttributes.position ) ? single.geometry.morphAttributes.position : null;
	const local = single !== null && ( options.local === true || skin || morphs !== null );

	_out.vertices = 0;
	_out.indices = 0;
	_out.indexed = options.indexed === true && ! forceColor && meshes.every( mesh => mesh.geometry.attributes.normal !== undefined && ( skin || ! isDeformed( mesh ) ) );
	_out.attributes = [ 'position', 'normal', 'uv' ];
	if ( forceColor || options.fade || options.color !== undefined ) _out.attributes.push( 'color' );
	if ( options.tangents === true ) _out.attributes.push( 'tangent' );
	if ( skin ) _out.attributes.push( 'skinIndex', 'skinWeight' );

	_out.morphCount = morphs !== null ? morphs.length : 0;
	_out.morphsRelative = morphs !== null && single.geometry.morphTargetsRelative === true;
	while ( _out.morphs.length < _out.morphCount ) _out.morphs.push( new Float32Array( 0 ) );

	for ( const mesh of meshes ) cutMesh( mesh, position, rotation, dimensions, check, options, local, skin, morphs );

	return _out;

}

const isDeformed = mesh => mesh.isSkinnedMesh === true || ( Array.isArray( mesh.morphTargetInfluences ) && mesh.morphTargetInfluences.some( v => v !== 0 ) );

function cutMesh( mesh, position, rotation, dimensions, check, options, local, skin, morphOut ) {

	const geometry = mesh.geometry;
	const positions = geometry.attributes.position;
	const normals = geometry.attributes.normal;
	const index = geometry.index;

	// the vertices come from where they are at rest when the decal is going to be moved as the mesh is
	const rest = skin || morphOut !== null;

	const maxAngle = options.maxAngle !== undefined ? options.maxAngle : 180;
	const minFacing = Math.cos( Math.min( Math.max( maxAngle, 0 ), 180 ) * Math.PI / 180 );
	const culling = maxAngle < 180;

	// from where the decal starts to fade as it turns away, to where there is none, and how much of its depth fades
	const fade = options.fade ? ( options.fade === true ? {} : options.fade ) : null;
	const fadeTo = Math.cos( Math.min( maxAngle, 90 ) * Math.PI / 180 );
	const fadeFrom = fade ? Math.max( fadeTo + 1e-6, Math.cos( ( fade.angle !== undefined ? fade.angle : 45 ) * Math.PI / 180 ) ) : 1;
	const fadeDepth = fade ? ( fade.depth !== undefined ? fade.depth : .3 ) : 0;

	const hasColor = _out.attributes.includes( 'color' );
	const hasTangents = _out.attributes.includes( 'tangent' );
	const offset = options.offset || 0;
	const indexed = _out.indexed;

	// the part of the texture that the decal has
	const rect = options.uvRect || null;
	const u0 = rect ? rect[ 0 ] : 0, v0 = rect ? rect[ 1 ] : 0;
	const us = rect ? rect[ 2 ] - rect[ 0 ] : 1, vs = rect ? rect[ 3 ] - rect[ 1 ] : 1;

	if ( options.color !== undefined ) _color.set( options.color ); else _color.copy( _white );

	if ( rotation.isEuler ) _euler.copy( rotation ); else _euler.set( rotation.x, rotation.y, rotation.z );

	_boxMatrix.compose( position, _quaternion.setFromEuler( _euler ), _one );
	_boxInverse.copy( _boxMatrix ).invert();

	mesh.updateWorldMatrix( true, false );
	_meshMatrix.copy( mesh.matrixWorld );

	if ( mesh.isInstancedMesh && options.instanceId !== undefined ) {

		mesh.getMatrixAt( options.instanceId, _toBox );
		_meshMatrix.multiply( _toBox );

	}

	_meshInverse.copy( _meshMatrix ).invert();
	_toBox.multiplyMatrices( _boxInverse, _meshMatrix );
	_boxToMesh.copy( _toBox ).invert();

	// out of the box: to the world, or back to the mesh
	if ( local ) _fromBox.copy( _boxToMesh ); else _fromBox.copy( _boxMatrix );

	// the normals go to the world, unless the decal stays with the mesh
	_worldNormalMatrix.getNormalMatrix( _meshMatrix );
	if ( local ) _normalMatrix.identity(); else _normalMatrix.copy( _worldNormalMatrix );

	// the sides of the box where the decal is, for the tangents and to know what faces it
	_xAxis.setFromMatrixColumn( _boxMatrix, 0 );
	_yAxis.setFromMatrixColumn( _boxMatrix, 1 );
	_zAxis.setFromMatrixColumn( _boxMatrix, 2 );

	if ( local ) {

		_xAxis.transformDirection( _meshInverse );
		_yAxis.transformDirection( _meshInverse );

	}

	// a distance in the world, in the mesh
	const offsetOut = local ? offset / ( Math.cbrt( Math.abs( _meshMatrix.determinant() ) ) || 1 ) : offset;

	// a mesh that is moved by its bones or its morphs is cut as it is now
	const deformed = isDeformed( mesh );
	const useNormals = normals !== undefined && ( ! deformed || skin );

	// the morphs that are on, and what each bone does, to put the vertices where they are now
	const influences = mesh.morphTargetInfluences;
	const targets = geometry.morphAttributes.position;
	const active = [];

	if ( Array.isArray( influences ) && Array.isArray( targets ) ) {

		for ( let k = 0; k < targets.length; k ++ ) if ( influences[ k ] ) active.push( k );

	}

	const relative = geometry.morphTargetsRelative === true;
	const skinIndex = geometry.attributes.skinIndex, skinWeight = geometry.attributes.skinWeight;
	const boned = mesh.isSkinnedMesh === true && mesh.skeleton && skinIndex !== undefined && skinWeight !== undefined;

	if ( boned ) {

		const skeleton = mesh.skeleton;

		if ( _boneMatrices.length < skeleton.bones.length * 16 ) _boneMatrices = new Float64Array( skeleton.bones.length * 16 );

		// to the bones, where each one has it, back to the mesh, and to the box
		for ( let j = 0; j < skeleton.bones.length; j ++ ) {

			_bone.multiplyMatrices( skeleton.bones[ j ].matrixWorld, skeleton.boneInverses[ j ] ).multiply( mesh.bindMatrix ).premultiply( mesh.bindMatrixInverse ).premultiply( _toBox );
			_boneMatrices.set( _bone.elements, j * 16 );

		}

	}

	const hx = dimensions.x / 2, hy = dimensions.y / 2, hz = dimensions.z / 2;
	const half = [ hx, hy, hz ];
	const cx = !! check.x, cy = !! check.y, cz = !! check.z;

	const vertexCount = positions.count;
	const total = index ? index.count : vertexCount;
	const start = Math.max( 0, geometry.drawRange.start );
	const end = Math.min( total, start + geometry.drawRange.count );
	const indices = index ? index.array : null;

	// the triangles to look at: the ones near the box if the mesh has a grid, or all of them
	let candidates = null, candidateCount = 0;

	if ( ! deformed ) {

		// nothing to do if the whole mesh is away from the box
		if ( geometry.boundingSphere === null ) geometry.computeBoundingSphere();

		_sphere.copy( geometry.boundingSphere ).applyMatrix4( _toBox );
		const c = _sphere.center, r = _sphere.radius;

		if ( ( cx && Math.abs( c.x ) > hx + r ) || ( cy && Math.abs( c.y ) > hy + r ) || ( cz && Math.abs( c.z ) > hz + r ) ) return;

		// a box that is not clipped on a side has no end on it, and no cells to look in
		if ( options.grid !== false && cx && cy && cz && total >= 3000 ) {

			const grid = getGrid( geometry );

			_box.makeEmpty();
			for ( let k = 0; k < 8; k ++ ) _box.expandByPoint( _v.set( k & 1 ? hx : - hx, k & 2 ? hy : - hy, k & 4 ? hz : - hz ).applyMatrix4( _boxToMesh ) );

			candidates = grid.found;
			candidateCount = queryGrid( grid, _box );

		}

	}

	if ( _stamps.length < vertexCount ) {

		_positions = new Float32Array( vertexCount * 3 );
		_stamps = new Uint32Array( vertexCount );
		_shared = new Int32Array( vertexCount );
		_stamp = 0;

	}

	const stamp = ++ _stamp;
	const p = _positions;
	const ids = [ 0, 0, 0 ];
	const weights = [ 0, 0, 0 ];
	const loops = candidates ? candidateCount : Math.floor( ( end - start ) / 3 );
	const m = _boneMatrices;

	for ( let l = 0; l < loops; l ++ ) {

		const i = candidates ? candidates[ l ] * 3 : start + l * 3;

		if ( i < start || i + 2 >= end ) continue;

		const a = indices ? indices[ i ] : i;
		const b = indices ? indices[ i + 1 ] : i + 1;
		const c = indices ? indices[ i + 2 ] : i + 2;

		ids[ 0 ] = a; ids[ 1 ] = b; ids[ 2 ] = c;

		// every vertex goes to the box once, the first time that a triangle needs it
		for ( let k = 0; k < 3; k ++ ) {

			const id = ids[ k ];

			if ( _stamps[ id ] === stamp ) continue;

			_v.fromBufferAttribute( positions, id );

			for ( let j = 0; j < active.length; j ++ ) {

				const target = targets[ active[ j ] ];
				_t.fromBufferAttribute( target, id );
				if ( ! relative ) _t.sub( _n.fromBufferAttribute( positions, id ) );
				_v.addScaledVector( _t, influences[ active[ j ] ] );

			}

			if ( boned ) {

				// as much of what each of its bones does as the weight it has
				const x = _v.x, y = _v.y, z = _v.z;
				let px = 0, py = 0, pz = 0;

				for ( let j = 0; j < 4; j ++ ) {

					const weight = skinWeight.getComponent( id, j );
					if ( weight === 0 ) continue;

					const o = skinIndex.getComponent( id, j ) * 16;

					px += weight * ( m[ o ] * x + m[ o + 4 ] * y + m[ o + 8 ] * z + m[ o + 12 ] );
					py += weight * ( m[ o + 1 ] * x + m[ o + 5 ] * y + m[ o + 9 ] * z + m[ o + 13 ] );
					pz += weight * ( m[ o + 2 ] * x + m[ o + 6 ] * y + m[ o + 10 ] * z + m[ o + 14 ] );

				}

				_v.set( px, py, pz );

			} else {

				_v.applyMatrix4( _toBox );

			}

			p[ id * 3 ] = _v.x;
			p[ id * 3 + 1 ] = _v.y;
			p[ id * 3 + 2 ] = _v.z;

			_stamps[ id ] = stamp;
			_shared[ id ] = - 1;

		}

		const ax = p[ a * 3 ], ay = p[ a * 3 + 1 ], az = p[ a * 3 + 2 ];
		const bx = p[ b * 3 ], by = p[ b * 3 + 1 ], bz = p[ b * 3 + 2 ];
		const cxx = p[ c * 3 ], cyy = p[ c * 3 + 1 ], czz = p[ c * 3 + 2 ];

		// most of the mesh is on the outside of one of the sides
		if ( cx && ( ( ax > hx && bx > hx && cxx > hx ) || ( ax < - hx && bx < - hx && cxx < - hx ) ) ) continue;
		if ( cy && ( ( ay > hy && by > hy && cyy > hy ) || ( ay < - hy && by < - hy && cyy < - hy ) ) ) continue;
		if ( cz && ( ( az > hz && bz > hz && czz > hz ) || ( az < - hz && bz < - hz && czz < - hz ) ) ) continue;

		// the way the triangle looks, in the box
		const ux = bx - ax, uy = by - ay, uz = bz - az;
		const wx = cxx - ax, wy = cyy - ay, wz = czz - az;
		const fx = uy * wz - uz * wy, fy = uz * wx - ux * wz, fz = ux * wy - uy * wx;
		const fl = Math.sqrt( fx * fx + fy * fy + fz * fz );

		// the ones that look away from the decal, or are on their side to it
		if ( culling && fz < minFacing * fl ) continue;

		for ( let k = 0; k < 3; k ++ ) {

			const id = ids[ k ];
			const o = k * STRIDE;

			_polygon[ o ] = p[ id * 3 ];
			_polygon[ o + 1 ] = p[ id * 3 + 1 ];
			_polygon[ o + 2 ] = p[ id * 3 + 2 ];

			let facing = fl > 0 ? fz / fl : 0;

			// without normals to use, the one of the triangle
			if ( useNormals ) {

				_n.fromBufferAttribute( normals, id );

				// how much the normal looks along the z of the box, where it is now if it has not been moved
				if ( fade !== null && ! deformed ) facing = _t.copy( _n ).applyMatrix3( _worldNormalMatrix ).normalize().dot( _zAxis );

				_n.applyMatrix3( _normalMatrix );

			} else {

				_n.set( fx, fy, fz ).transformDirection( _fromBox );

			}

			_polygon[ o + 3 ] = _n.x;
			_polygon[ o + 4 ] = _n.y;
			_polygon[ o + 5 ] = _n.z;
			_polygon[ o + 6 ] = fade !== null ? smoothstep( fadeTo, fadeFrom, facing ) : 1;
			_polygon[ o + 7 ] = k === 0 ? 1 : 0;
			_polygon[ o + 8 ] = k === 1 ? 1 : 0;
			_polygon[ o + 9 ] = k === 2 ? 1 : 0;

		}

		let count = 3;
		let from = _polygon, to = _clipped;

		for ( let axis = 0; axis < 3 && count >= 3; axis ++ ) {

			if ( ! ( axis === 0 ? cx : axis === 1 ? cy : cz ) ) continue;

			count = clip( from, count, to, axis, 1, half[ axis ] );
			count = clip( to, count, from, axis, - 1, half[ axis ] );

		}

		if ( count < 3 ) continue;

		// room for what is left of the triangle, which is a fan
		const needed = _out.vertices + ( count - 2 ) * 3;

		for ( const name of _out.attributes ) grow( name, sizes[ name ], needed );
		if ( indexed ) grow( 'index', 1, _out.indices + ( count - 2 ) * 3 );

		for ( let k = 0; k < _out.morphCount; k ++ ) {

			if ( _out.morphs[ k ].length >= needed * 3 ) continue;

			const bigger = new Float32Array( Math.max( needed * 3, _out.morphs[ k ].length * 2 ) );
			bigger.set( _out.morphs[ k ] );
			_out.morphs[ k ] = bigger;

		}

		for ( let k = 1; k + 1 < count; k ++ ) {

			for ( let corner = 0; corner < 3; corner ++ ) {

				const j = corner === 0 ? 0 : k + corner - 1;
				const o = j * STRIDE;

				weights[ 0 ] = from[ o + 7 ]; weights[ 1 ] = from[ o + 8 ]; weights[ 2 ] = from[ o + 9 ];

				// a corner of the triangle that was not clipped is a vertex of the mesh, that other triangles have
				const whole = weights[ 0 ] === 1 ? a : weights[ 1 ] === 1 ? b : weights[ 2 ] === 1 ? c : - 1;

				if ( indexed && whole !== - 1 && _shared[ whole ] !== - 1 ) {

					_out.index[ _out.indices ++ ] = _shared[ whole ];
					continue;

				}

				const at = _out.vertices ++;

				if ( indexed ) {

					_out.index[ _out.indices ++ ] = at;
					if ( whole !== - 1 ) _shared[ whole ] = at;

				}

				_out.uv[ at * 2 ] = u0 + us * ( .5 + from[ o ] / dimensions.x );
				_out.uv[ at * 2 + 1 ] = v0 + vs * ( .5 + from[ o + 1 ] / dimensions.y );

				_n.set( from[ o + 3 ], from[ o + 4 ], from[ o + 5 ] ).normalize();

				if ( rest ) {

					// where the vertex is when the mesh is at rest: its bones and its morphs take it to where it was cut
					_v.set( 0, 0, 0 );
					for ( let w = 0; w < 3; w ++ ) if ( weights[ w ] !== 0 ) _v.addScaledVector( _t.fromBufferAttribute( positions, ids[ w ] ), weights[ w ] );

					if ( skin ) mixBones( skinIndex, skinWeight, ids, weights, _out, at );

					for ( let q = 0; q < _out.morphCount; q ++ ) {

						_b.set( 0, 0, 0 );
						for ( let w = 0; w < 3; w ++ ) if ( weights[ w ] !== 0 ) _b.addScaledVector( _t.fromBufferAttribute( morphOut[ q ], ids[ w ] ), weights[ w ] );

						_out.morphs[ q ][ at * 3 ] = _b.x;
						_out.morphs[ q ][ at * 3 + 1 ] = _b.y;
						_out.morphs[ q ][ at * 3 + 2 ] = _b.z;

					}

				} else {

					_v.set( from[ o ], from[ o + 1 ], from[ o + 2 ] ).applyMatrix4( _fromBox );

				}

				if ( offsetOut !== 0 ) _v.addScaledVector( _n, offsetOut );

				_out.position[ at * 3 ] = _v.x;
				_out.position[ at * 3 + 1 ] = _v.y;
				_out.position[ at * 3 + 2 ] = _v.z;

				_out.normal[ at * 3 ] = _n.x;
				_out.normal[ at * 3 + 1 ] = _n.y;
				_out.normal[ at * 3 + 2 ] = _n.z;

				if ( hasColor ) {

					// less of it near the ends of the depth of the box
					const depth = fadeDepth > 0 ? 1 - smoothstep( 1 - fadeDepth, 1, Math.abs( from[ o + 2 ] ) / hz ) : 1;

					_out.color[ at * 4 ] = _color.r;
					_out.color[ at * 4 + 1 ] = _color.g;
					_out.color[ at * 4 + 2 ] = _color.b;
					_out.color[ at * 4 + 3 ] = from[ o + 6 ] * depth;

				}

				if ( hasTangents ) {

					// along the x of the texture, on the surface. The sign says where its y is
					_t.copy( _xAxis ).addScaledVector( _n, - _n.dot( _xAxis ) );
					if ( _t.lengthSq() < 1e-12 ) _t.copy( _yAxis ).cross( _n );
					_t.normalize();

					_out.tangent[ at * 4 ] = _t.x;
					_out.tangent[ at * 4 + 1 ] = _t.y;
					_out.tangent[ at * 4 + 2 ] = _t.z;
					_out.tangent[ at * 4 + 3 ] = _b.crossVectors( _n, _t ).dot( _yAxis ) < 0 ? - 1 : 1;

				}

			}

		}

	}

}

// the box of a decal where a ray hit, looking out of the surface and turned by angle around that
function boxFromIntersection( hit, size = 1, angle = 0 ) {

	const object = hit.object;
	const normal = _n.set( 0, 0, 1 );

	object.updateWorldMatrix( true, false );
	_meshMatrix.copy( object.matrixWorld );

	if ( object.isInstancedMesh && hit.instanceId !== undefined ) {

		object.getMatrixAt( hit.instanceId, _bone );
		_meshMatrix.multiply( _bone );

	}

	// the way the surface looks there, in the world
	if ( hit.face && hit.face.normal ) normal.copy( hit.face.normal ).applyMatrix3( _worldNormalMatrix.getNormalMatrix( _meshMatrix ) ).normalize();

	_helper.position.copy( hit.point );
	_helper.up.set( 0, 1, 0 );
	if ( Math.abs( normal.y ) > .999 ) _helper.up.set( 0, 0, 1 );
	_helper.lookAt( _v.copy( hit.point ).add( normal ) );
	_helper.rotateZ( angle );

	return {
		mesh: object,
		position: hit.point.clone(),
		rotation: _helper.rotation.clone(),
		dimensions: size.isVector3 ? size.clone() : new Vector3( size, size, size ),
		instanceId: hit.instanceId
	};

}

// ---- the bounds of what is drawn, which is not all that there is room for

// ranges is a list of { start, count }, or nothing for what there is from the start
function computeBounds( geometry, count, ranges ) {

	const array = geometry.attributes.position.array;

	if ( geometry.boundingBox === null ) geometry.boundingBox = new Box3();
	if ( geometry.boundingSphere === null ) geometry.boundingSphere = new Sphere();

	const box = geometry.boundingBox.makeEmpty();
	const sphere = geometry.boundingSphere;
	const each = function ( fn ) {

		if ( ranges ) for ( const range of ranges ) for ( let i = range.start; i < range.start + range.count; i ++ ) fn( _v.fromArray( array, i * 3 ) );
		else for ( let i = 0; i < count; i ++ ) fn( _v.fromArray( array, i * 3 ) );

	};

	each( v => box.expandByPoint( v ) );

	sphere.radius = 0;

	if ( box.isEmpty() ) {

		box.min.set( 0, 0, 0 );
		box.max.set( 0, 0, 0 );
		sphere.center.set( 0, 0, 0 );
		return;

	}

	box.getCenter( sphere.center );

	let radiusSq = 0;
	each( v => { radiusSq = Math.max( radiusSq, sphere.center.distanceToSquared( v ) ); } );

	sphere.radius = Math.sqrt( radiusSq );

}

const createAttribute = ( name, capacity ) => new BufferAttribute( new ( name === 'skinIndex' ? Uint16Array : Float32Array )( capacity * sizes[ name ] ), sizes[ name ] );

// what cut() takes, from where a ray hit
function hitArguments( hit, size, options = {} ) {

	const box = boxFromIntersection( hit, size, options.angle || 0 );

	return [ options.target || box.mesh, box.position, box.rotation, box.dimensions, box.instanceId !== undefined && options.instanceId === undefined ? { ...options, instanceId: box.instanceId } : options ];

}

// the part of a mesh inside a box, to draw over it: the decal looks along the z of the box, with the texture on its x and y
class DecalGeometry extends BufferGeometry {

	constructor( mesh, position, rotation, dimensions, check, options ) {

		super();

		this.isDecalGeometry = true;
		this.type = 'DecalGeometry';

		// how many vertices and indices there is room for, and how many there are
		this._capacity = 0;
		this._indexCapacity = 0;
		this._vertices = 0;

		if ( mesh !== undefined ) this.update( mesh, position, rotation, dimensions, check, options );

	}

	// a decal where a Raycaster hit; the options also take angle, and target to cut something other than what was hit
	static fromIntersection( hit, size, options ) {

		return new DecalGeometry( ...hitArguments( hit, size, options ) );

	}

	// makes the decal again, in the same geometry. The options can go in the place of check, with check as one of them
	update( mesh, position = new Vector3(), rotation = new Euler(), dimensions = _one, check = null, options = null ) {

		const out = cut( mesh, position, rotation, dimensions, check, options, false );
		const names = out.attributes;
		const morphs = this.morphAttributes.position;

		// remade for another kind of decal or one that doesn't fit, and always with morphs, which three.js caches by geometry
		const same = Object.keys( this.attributes ).join() === names.join() && ( this.index !== null ) === out.indexed && out.morphCount === 0 && morphs === undefined;

		if ( ! same || out.vertices > this._capacity || out.indices > this._indexCapacity ) {

			this.dispose();

			for ( const name of Object.keys( this.attributes ) ) this.deleteAttribute( name );

			this._capacity = Math.max( out.vertices, same ? Math.ceil( this._capacity * 1.5 ) : 0 );
			this._indexCapacity = Math.max( out.indices, same ? Math.ceil( this._indexCapacity * 1.5 ) : 0 );

			for ( const name of names ) this.setAttribute( name, createAttribute( name, this._capacity ) );

			this.setIndex( out.indexed ? new BufferAttribute( new Uint32Array( this._indexCapacity ), 1 ) : null );

			delete this.morphAttributes.position;

			if ( out.morphCount > 0 ) {

				this.morphAttributes.position = out.morphs.slice( 0, out.morphCount ).map( array => new BufferAttribute( array.slice( 0, this._capacity * 3 ), 3 ) );
				this.morphTargetsRelative = out.morphsRelative;

			}

		}

		for ( const name of names ) {

			const attribute = this.attributes[ name ];

			attribute.array.set( out[ name ].subarray( 0, out.vertices * sizes[ name ] ) );
			attribute.needsUpdate = true;

		}

		if ( out.indexed ) {

			this.index.array.set( out.index.subarray( 0, out.indices ) );
			this.index.needsUpdate = true;

		}

		this._vertices = out.vertices;
		this.setDrawRange( 0, out.indexed ? out.indices : out.vertices );

		this.boundingBox = null;
		this.boundingSphere = null;

		return this;

	}

	computeBoundingBox() {

		computeBounds( this, this._vertices );

	}

	computeBoundingSphere() {

		computeBounds( this, this._vertices );

	}

}

// many decals in one geometry, drawn at once, each with its color in the vertex colors, so the material needs vertexColors
class DecalBatch extends BufferGeometry {

	constructor( options = {} ) {

		super();

		this.isDecalBatch = true;
		this.type = 'DecalBatch';

		this.options = options;
		this.maxVertices = options.maxVertices || Infinity;
		this.lifetime = options.lifetime || Infinity;
		this.fadeTime = options.fadeTime !== undefined ? options.fadeTime : 1;

		// where the vertices end, and the decals there are: { start, count, born, opacity }, the oldest first
		this.count = 0;
		this.decals = [];

		this._capacity = 0;
		this._holes = [];
		this._mesh = null;
		this._names = [ 'position', 'normal', 'uv', 'color' ];
		if ( options.tangents ) this._names.push( 'tangent' );
		if ( options.skin ) this._names.push( 'skinIndex', 'skinWeight' );

		// the alpha that each vertex was cut with, to fade from
		this._alpha = new Float32Array( 0 );

		this._reserve( Math.min( options.capacity || 1024, this.maxVertices ) );

	}

	_reserve( capacity ) {

		if ( capacity <= this._capacity ) return;

		const old = this.attributes;
		const alpha = this._alpha;

		this.dispose();
		this._capacity = Math.min( this.maxVertices, Math.max( capacity, this._capacity * 2 ) );

		for ( const name of this._names ) {

			const attribute = createAttribute( name, this._capacity );
			if ( old[ name ] !== undefined ) attribute.array.set( old[ name ].array.subarray( 0, this.count * sizes[ name ] ) );
			this.setAttribute( name, attribute );

		}

		this._alpha = new Float32Array( this._capacity );
		this._alpha.set( alpha.subarray( 0, this.count ) );

	}

	// only what changed goes to the graphics card, where three.js can do it
	_changed( start, count, names = this._names ) {

		for ( const name of names ) {

			const attribute = this.attributes[ name ];

			if ( typeof attribute.addUpdateRange === 'function' ) attribute.addUpdateRange( start * sizes[ name ], count * sizes[ name ] );
			attribute.needsUpdate = true;

		}

		this.boundingBox = null;
		this.boundingSphere = null;

	}

	// its triangles are left with no size, and its place for another
	_erase( decal ) {

		this.attributes.position.array.fill( 0, decal.start * 3, ( decal.start + decal.count ) * 3 );
		this._changed( decal.start, decal.count, [ 'position' ] );
		this._holes.push( { start: decal.start, count: decal.count } );

	}

	// a place for a number of vertices: a hole that was left, the end, or where the oldest decals are
	_place( count ) {

		const hole = this._holes.findIndex( h => h.count >= count );

		if ( hole !== - 1 ) {

			const { start } = this._holes[ hole ];

			this._holes[ hole ].start += count;
			this._holes[ hole ].count -= count;
			if ( this._holes[ hole ].count === 0 ) this._holes.splice( hole, 1 );

			return start;

		}

		if ( this.count + count <= this.maxVertices ) {

			this._reserve( this.count + count );
			this.count += count;

			return this.count - count;

		}

		// full: the oldest go, until the holes that they leave are one that is big enough
		while ( this.decals.length > 0 ) {

			this._erase( this.decals.shift() );
			this._mergeHoles();

			if ( this._holes.some( h => h.count >= count ) ) return this._place( count );

		}

		return - 1;

	}

	_mergeHoles() {

		this._holes.sort( ( a, b ) => a.start - b.start );

		for ( let i = this._holes.length - 1; i > 0; i -- ) {

			if ( this._holes[ i - 1 ].start + this._holes[ i - 1 ].count !== this._holes[ i ].start ) continue;

			this._holes[ i - 1 ].count += this._holes[ i ].count;
			this._holes.splice( i, 1 );

		}

		// the ones at the end are not holes anymore
		const last = this._holes[ this._holes.length - 1 ];

		if ( last !== undefined && last.start + last.count === this.count ) {

			this.count = last.start;
			this._holes.pop();
			this.setDrawRange( 0, this.count );

		}

	}

	// Adds a decal, and returns it: { start, count, born, opacity }, with where its vertices are. Or null if there is no room for it
	add( mesh, position, rotation, dimensions, options = {} ) {

		const local = this.options.local === true || this.options.skin === true;

		if ( local ) {

			if ( this._mesh !== null && this._mesh !== mesh ) throw new Error( 'THREE.DecalBatch: a batch that is local or has bones is of one mesh' );
			this._mesh = mesh;

		}

		const out = cut( mesh, position, rotation, dimensions, null, { ...this.options, ...options, indexed: false, morph: false, local: this.options.local === true, skin: this.options.skin === true, tangents: this._names.includes( 'tangent' ) }, true );

		if ( out.vertices === 0 || out.vertices > this.maxVertices ) return null;

		const start = this._place( out.vertices );

		if ( start === - 1 ) return null;

		for ( const name of this._names ) this.attributes[ name ].array.set( out[ name ].subarray( 0, out.vertices * sizes[ name ] ), start * sizes[ name ] );

		for ( let i = 0; i < out.vertices; i ++ ) this._alpha[ start + i ] = out.color[ i * 4 + 3 ];

		this._changed( start, out.vertices );
		this.setDrawRange( 0, this.count );

		const decal = { start, count: out.vertices, born: options.time !== undefined ? options.time : performance.now() / 1000, opacity: 1 };
		this.decals.push( decal );

		return decal;

	}

	// a decal where a ray hit, from what a Raycaster returns. See DecalGeometry.fromIntersection()
	addFromIntersection( hit, size, options ) {

		const args = hitArguments( hit, size, options );

		return this.add( ...args );

	}

	remove( decal ) {

		const at = this.decals.indexOf( decal );

		if ( at === - 1 ) return;

		this.decals.splice( at, 1 );
		this._erase( decal );
		this._mergeHoles();

	}

	// how much of a decal is there, from 0 to 1, over what it was cut with
	setOpacity( decal, opacity ) {

		if ( decal.opacity === opacity ) return;

		decal.opacity = opacity;

		const color = this.attributes.color.array;

		for ( let i = decal.start; i < decal.start + decal.count; i ++ ) color[ i * 4 + 3 ] = this._alpha[ i ] * opacity;

		this._changed( decal.start, decal.count, [ 'color' ] );

	}

	// the decals that are older than the lifetime go away, fading first. time is in seconds
	update( time = performance.now() / 1000 ) {

		if ( this.lifetime === Infinity ) return;

		for ( const decal of this.decals.slice() ) {

			const left = decal.born + this.lifetime - time;

			if ( left <= 0 ) this.remove( decal );
			else this.setOpacity( decal, this.fadeTime > 0 ? Math.min( 1, left / this.fadeTime ) : 1 );

		}

	}

	clear() {

		this.count = 0;
		this.decals = [];
		this._holes = [];
		this._mesh = null;
		this.setDrawRange( 0, 0 );

		this.boundingBox = null;
		this.boundingSphere = null;

	}

	computeBoundingBox() {

		computeBounds( this, this.count, this.decals );

	}

	computeBoundingSphere() {

		computeBounds( this, this.count, this.decals );

	}

}

// a mesh for a decal that moves with another, by its skeleton or morphs when the decal was made with skin or morph, added to it
function createDecal( mesh, geometry, material ) {

	const skinned = geometry.attributes.skinIndex !== undefined && mesh.isSkinnedMesh === true;
	const decal = skinned ? new SkinnedMesh( geometry, material ) : new Mesh( geometry, material );

	if ( skinned ) decal.bind( mesh.skeleton, mesh.bindMatrix );

	// the same list, so what changes in one changes in the other
	if ( geometry.morphAttributes.position !== undefined && mesh.morphTargetInfluences !== undefined ) {

		decal.morphTargetInfluences = mesh.morphTargetInfluences;
		decal.morphTargetDictionary = mesh.morphTargetDictionary;

	}

	mesh.add( decal );

	return decal;

}

const createSkinnedDecal = createDecal;

export { DecalGeometry, DecalBatch, createDecal, createSkinnedDecal, boxFromIntersection, prepare, prepareAsync };
