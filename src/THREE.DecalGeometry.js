import {
	BufferAttribute,
	BufferGeometry,
	Euler,
	Matrix3,
	Matrix4,
	Quaternion,
	Sphere,
	Vector3
} from 'three';

const _one = new Vector3( 1, 1, 1 );
const _v = new Vector3();
const _n = new Vector3();
const _euler = new Euler();
const _quaternion = new Quaternion();
const _boxMatrix = new Matrix4();
const _boxInverse = new Matrix4();
const _meshMatrix = new Matrix4();
const _toBox = new Matrix4();
const _fromBox = new Matrix4();
const _normalMatrix = new Matrix3();
const _sphere = new Sphere();

// a vertex is 6 numbers: its position in the box, and its normal. A triangle clipped by 6 planes has 9 at most
const STRIDE = 6;
let _polygon = new Float64Array( 12 * STRIDE );
let _clipped = new Float64Array( 12 * STRIDE );

// the positions of the mesh in the box, kept between decals
let _positions = new Float32Array( 0 );

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

// The part of a mesh that is inside a box, to draw something over it.
// position, rotation and dimensions are the ones of the box, in the world. The decal looks along the z of the box:
// its x and y are the ones of the texture, and its z how deep it goes
class DecalGeometry extends BufferGeometry {

	constructor( mesh, position, rotation, dimensions, check, options ) {

		super();

		this.type = 'DecalGeometry';

		// how many vertices there is room for
		this._capacity = 0;

		if ( mesh !== undefined ) this.update( mesh, position, rotation, dimensions, check, options );

	}

	// Makes the decal again, in the same geometry. The options can go in the place of check, with check as one of them:
	// - check: the sides of the box that clip the mesh, a Vector3 of 1 or 0 for each pair
	// - maxAngle: how far from facing the decal a triangle can be, in degrees
	// - local: the decal in the coordinates of the mesh, to add it to the mesh and have it follow it
	// - instanceId: which one, of an InstancedMesh
	update( mesh, position = new Vector3(), rotation = new Euler(), dimensions = _one, check = null, options = {} ) {

		if ( check !== null && check.isVector3 !== true ) {

			options = check;
			check = null;

		}

		check = check || options.check || _one;

		if ( ! mesh || mesh.isMesh !== true || ! mesh.geometry || ! mesh.geometry.attributes.position ) throw new TypeError( 'THREE.DecalGeometry: it needs a Mesh that has a geometry with positions' );
		if ( ! ( dimensions.x > 0 && dimensions.y > 0 && dimensions.z > 0 ) ) throw new RangeError( 'THREE.DecalGeometry: the dimensions of the box have to be bigger than zero' );

		const maxAngle = options.maxAngle !== undefined ? options.maxAngle : 180;
		const minFacing = Math.cos( Math.min( Math.max( maxAngle, 0 ), 180 ) * Math.PI / 180 );
		const culling = maxAngle < 180;

		if ( rotation.isEuler ) _euler.copy( rotation ); else _euler.set( rotation.x, rotation.y, rotation.z );

		_boxMatrix.compose( position, _quaternion.setFromEuler( _euler ), _one );
		_boxInverse.copy( _boxMatrix ).invert();

		mesh.updateWorldMatrix( true, false );
		_meshMatrix.copy( mesh.matrixWorld );

		if ( mesh.isInstancedMesh && options.instanceId !== undefined ) {

			mesh.getMatrixAt( options.instanceId, _toBox );
			_meshMatrix.multiply( _toBox );

		}

		_toBox.multiplyMatrices( _boxInverse, _meshMatrix );

		// out of the box: to the world, or back to the mesh
		if ( options.local ) _fromBox.copy( _meshMatrix ).invert().multiply( _boxMatrix ); else _fromBox.copy( _boxMatrix );

		const geometry = mesh.geometry;
		const positions = geometry.attributes.position;
		const normals = geometry.attributes.normal;
		const index = geometry.index;

		// a mesh that is moved by its bones or its morphs is cut as it is now
		const deformed = mesh.isSkinnedMesh === true || ( Array.isArray( mesh.morphTargetInfluences ) && mesh.morphTargetInfluences.some( v => v !== 0 ) );

		const hx = dimensions.x / 2, hy = dimensions.y / 2, hz = dimensions.z / 2;
		const half = [ hx, hy, hz ];
		const cx = !! check.x, cy = !! check.y, cz = !! check.z;

		const out = { positions: [], normals: [], uvs: [] };

		// nothing to do if the whole mesh is away from the box
		let near = true;

		if ( ! deformed ) {

			if ( geometry.boundingSphere === null ) geometry.computeBoundingSphere();

			_sphere.copy( geometry.boundingSphere ).applyMatrix4( _toBox );
			const c = _sphere.center, r = _sphere.radius;

			near = ! ( ( cx && Math.abs( c.x ) > hx + r ) || ( cy && Math.abs( c.y ) > hy + r ) || ( cz && Math.abs( c.z ) > hz + r ) );

		}

		if ( near ) {

			// every vertex goes to the box once, not once for each triangle that has it
			const vertexCount = positions.count;

			if ( _positions.length < vertexCount * 3 ) _positions = new Float32Array( vertexCount * 3 );

			const p = _positions;

			for ( let i = 0; i < vertexCount; i ++ ) {

				if ( deformed ) mesh.getVertexPosition( i, _v ); else _v.fromBufferAttribute( positions, i );

				_v.applyMatrix4( _toBox );

				p[ i * 3 ] = _v.x;
				p[ i * 3 + 1 ] = _v.y;
				p[ i * 3 + 2 ] = _v.z;

			}

			// the normals go to the world, unless the decal stays with the mesh
			if ( options.local ) _normalMatrix.identity(); else _normalMatrix.getNormalMatrix( _meshMatrix );

			const total = index ? index.count : vertexCount;
			const start = Math.max( 0, geometry.drawRange.start );
			const end = Math.min( total, start + geometry.drawRange.count );
			const indices = index ? index.array : null;
			const useNormals = normals !== undefined && ! deformed;

			for ( let i = start; i + 2 < end; i += 3 ) {

				const a = indices ? indices[ i ] : i;
				const b = indices ? indices[ i + 1 ] : i + 1;
				const c = indices ? indices[ i + 2 ] : i + 2;

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

				// the ones that look away from the decal, or are on their side to it
				if ( culling && fz < minFacing * Math.sqrt( fx * fx + fy * fy + fz * fz ) ) continue;

				const ids = [ a, b, c ];

				for ( let k = 0; k < 3; k ++ ) {

					const id = ids[ k ];

					_polygon[ k * STRIDE ] = p[ id * 3 ];
					_polygon[ k * STRIDE + 1 ] = p[ id * 3 + 1 ];
					_polygon[ k * STRIDE + 2 ] = p[ id * 3 + 2 ];

					// without normals to use, the one of the triangle
					if ( useNormals ) _n.fromBufferAttribute( normals, id ).applyMatrix3( _normalMatrix ); else _n.set( fx, fy, fz ).transformDirection( _fromBox );

					_polygon[ k * STRIDE + 3 ] = _n.x;
					_polygon[ k * STRIDE + 4 ] = _n.y;
					_polygon[ k * STRIDE + 5 ] = _n.z;

				}

				let count = 3;
				let from = _polygon, to = _clipped;

				for ( let axis = 0; axis < 3 && count >= 3; axis ++ ) {

					if ( ! ( axis === 0 ? cx : axis === 1 ? cy : cz ) ) continue;

					for ( const sign of [ 1, - 1 ] ) {

						count = clip( from, count, to, axis, sign, half[ axis ] );
						[ from, to ] = [ to, from ];

					}

				}

				// what is left of the triangle, as a fan
				for ( let k = 1; k + 1 < count; k ++ ) {

					for ( const j of [ 0, k, k + 1 ] ) {

						const o = j * STRIDE;

						out.uvs.push( .5 + from[ o ] / dimensions.x, .5 + from[ o + 1 ] / dimensions.y );

						_v.set( from[ o ], from[ o + 1 ], from[ o + 2 ] ).applyMatrix4( _fromBox );
						out.positions.push( _v.x, _v.y, _v.z );

						_n.set( from[ o + 3 ], from[ o + 4 ], from[ o + 5 ] ).normalize();
						out.normals.push( _n.x, _n.y, _n.z );

					}

				}

			}

		}

		this._write( out );

		return this;

	}

	// the attributes are made again only when the decal doesn't fit in the ones there are
	_write( out ) {

		const count = out.positions.length / 3;

		if ( count > this._capacity || this.attributes.position === undefined ) {

			this.dispose();

			this._capacity = Math.max( count, Math.ceil( this._capacity * 1.5 ) );

			this.setAttribute( 'position', new BufferAttribute( new Float32Array( this._capacity * 3 ), 3 ) );
			this.setAttribute( 'normal', new BufferAttribute( new Float32Array( this._capacity * 3 ), 3 ) );
			this.setAttribute( 'uv', new BufferAttribute( new Float32Array( this._capacity * 2 ), 2 ) );

		}

		for ( const [ name, values ] of [ [ 'position', out.positions ], [ 'normal', out.normals ], [ 'uv', out.uvs ] ] ) {

			const attribute = this.attributes[ name ];

			attribute.array.set( values );
			attribute.needsUpdate = true;

		}

		// the room that is not used is left at the first vertex, so the bounds are the ones of the decal
		const array = this.attributes.position.array;

		for ( let i = count * 3; i < array.length; i ++ ) array[ i ] = count > 0 ? array[ i % 3 ] : 0;

		this.setDrawRange( 0, count );

		this.boundingBox = null;
		this.boundingSphere = null;

	}

}

export { DecalGeometry };
