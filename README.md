THREE.DecalGeometry.js
=========================

This object creates a decal geometry, intersecting a box against a mesh: the part of the mesh that is inside the box, with the texture coordinates to draw something over it. Based on this article [How to project decals](http://blog.wolfire.com/2009/06/how-to-project-decals/). It intersects a box against an arbitrary geometry and clips vertex coordinates and normals.

[![npm](https://img.shields.io/npm/v/three.decal-geometry.svg)](https://www.npmjs.com/package/three.decal-geometry)

Demos
-----

- **[Decal Splatter](https://spite.github.io/THREE.DecalGeometry/demo/splatter.html)**: click a head to shoot paint at it. All the splats are one geometry, drawn at once, with a limit and a lifetime. They take one of four shapes from one texture, and go over the head and what it stands on
- **[The box and what it cuts](https://spite.github.io/THREE.DecalGeometry/demo/intersection.html)**: every option, live. Move, turn and scale the box by hand, on a mesh that turns, one that morphs and one with bones, and stamp decals that stay on the mesh, and bend and morph with it

![Image](https://raw.githubusercontent.com/spite/THREE.DecalGeometry/master/demo/assets/snapshot.jpg)

2026 update
-----

**Disclaimer:** this library is from 2014, and three.js has had it ever since: its decals example was added in r69 (2014) with this code, and `DecalGeometry` is in the addons, at `three/addons/geometries/DecalGeometry.js`. Use that one unless you need what this one adds

It gives the same decals as the one of three.js: the tests compare them. What this version has that that one doesn't:

- `check`, to choose which sides of the box clip the mesh
- `maxAngle`, to leave out the triangles that look away from the decal, or that are too much on their side to it. It's what stops a decal from showing up on the other side of what it's put on, and from stretching along the surfaces that it only grazes
- `fade`, for edges that fade away where the decal goes deep into the mesh and where the surface turns away from it
- `local`, to get the decal in the coordinates of the mesh, so it can be added to the mesh and follow it when it moves
- `skin` and `morph`, for decals that bend with a mesh that has bones, and change with one that has morphs
- `offset`, `tangents`, `color` and `indexed`
- `uvRect`, for a decal that shows a part of a texture, to have many kinds in one
- one decal over several meshes: it takes a list of them, or a group
- `fromIntersection()`, to put a decal where a ray hits
- `update()`, to make a decal again in the same geometry, without creating another one
- `DecalBatch`, to have many decals in one geometry and draw them all at once. Decals can be removed from it, it can have a limit, and they can go away with time
- meshes that are moved by their bones or their morphs are cut as they are at that moment, and so are the instances of an `InstancedMesh`
- it's faster. It looks only at the triangles that are near the box, with a grid that it makes of each geometry the first time. In one test, on a mesh of 160000 triangles, a decal took 2 ms once the grid was made, and about 100 ms with the one of three.js. The first five decals, grid included, took 15 ms each, and the grid can be made ahead of time in a worker. A box that is away from the mesh takes no time

The library has been rewritten for current three.js, so code written for the 2014 version needs changes. What changed:

- it's an ES module that exports `DecalGeometry`, and it needs three.js as `three`
- it's a `BufferGeometry`, and it takes meshes with one. `THREE.Geometry`, that it was made of and for, is gone from three.js
- the mesh can be anywhere: its position, rotation and scale in the world are used, and the ones of its parents. Only its own matrix was
- the normals of the decal are the ones of the mesh in the world. They were not rotated with the mesh
- most of the mesh is discarded before doing any work, and the decal has no triangles without area
- `rotation` can be a `THREE.Euler`
- a mesh that can't be used, or a box without size, is an error that says so
- the demos run on current three.js, and the head is a glTF

How to use
----------

Use npm to install it, alongside three.js

```
npm i three three.decal-geometry
```

and import it in your code

```js
import * as THREE from 'three';
import { DecalGeometry } from 'three.decal-geometry';
```

It's a single ES module, [src/THREE.DecalGeometry.js](src/THREE.DecalGeometry.js), so it also works without a bundler as long as an import map resolves `three` (see [demo/splatter.html](demo/splatter.html)). It needs three.js r152 or later, and it has TypeScript types.

Instantiate a geometry passing:

```js
const decalGeometry = new DecalGeometry(
    meshToIntersect, // a THREE.Mesh, a list of them, or an object that has them
    position, // THREE.Vector3 in world coordinates
    rotation, // THREE.Euler specifying the orientation of the decal
    dimensions, // THREE.Vector3 specifying the size of the decal box
    options // optional, see below
);
```

and create a mesh using that geometry, as usual:

```js
const mesh = new THREE.Mesh( decalGeometry, decalMaterial );
scene.add( mesh );
```

The geometry is in world coordinates, so add the decal to the scene, not to the mesh. To have it follow a mesh that moves, see `local` below.

The decal material can be any material, just make sure to have these attributes enabled:

```js
const decalMaterial = new THREE.MeshNormalMaterial( {
    transparent: true,
    depthTest: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
} );
```

The box
-------

The decal is what is inside of a box. `position` is its centre, `dimensions` its size and `rotation` how it's turned. The texture is drawn along the x and the y of the box, from one side to the other, and z is how deep the decal goes into the mesh and out of it.

The z of the box should look out of the surface.

Where a ray hits
----------------

`DecalGeometry.fromIntersection()` makes the decal from what a `THREE.Raycaster` returns: at the point that was hit, looking out of the surface there.

```js
const hit = raycaster.intersectObject( mesh )[ 0 ];

const geometry = DecalGeometry.fromIntersection( hit, 10, { angle: Math.random() * 2 * Math.PI } );
```

The second parameter is the size of the box, as a number or a `THREE.Vector3`. The third has the options of any decal, and two more: `angle` turns the texture, in radians, and `target` is what to cut when it's more than the mesh that was hit, like the group it's in. The instance that was hit is the one that is cut, with a `THREE.InstancedMesh`.

`boxFromIntersection( hit, size, angle )` gives the box without making the decal, as `{ mesh, position, rotation, dimensions, instanceId }`.

Several meshes
--------------

A decal can go over more than one mesh. Pass a list of them, or any object, and everything that is visible under it is cut. The decals that are there are left out, so they can be in the same group.

```js
const geometry = new DecalGeometry( [ wall, floor ], position, rotation, dimensions );
const other = new DecalGeometry( scene, position, rotation, dimensions );
```

A decal of several meshes is in the world: `local`, `skin` and `morph` are for decals of one mesh.

Options
-------

The fifth parameter is an object with any of these. For the code of 2014 it can also be `check`, as a `THREE.Vector3`, with the options after it.

`check` says which pairs of sides of the box clip the mesh, as a `THREE.Vector3` with 1 or 0 for each one. With `new THREE.Vector3( 1, 1, 0 )` the decal is not clipped along z, and goes through the whole mesh.

`maxAngle` is how far a triangle can be from facing the decal, in degrees, to be part of it. It's 180 by default, which takes all of them. With 90 the ones that look away are left out, and with less than that, also the ones that are on their side to it:

```js
const geometry = new DecalGeometry( mesh, position, rotation, dimensions, { maxAngle: 60 } );
```

`local` gives the decal in the coordinates of the mesh, not of the world. The box is still placed in the world, but the result is added to the mesh, and moves, turns and scales with it:

```js
const geometry = new DecalGeometry( mesh, position, rotation, dimensions, { local: true } );

mesh.add( new THREE.Mesh( geometry, decalMaterial ) );
```

`instanceId` is which one to cut, when the mesh is a `THREE.InstancedMesh`.

`fade` makes the edges of the decal fade away, where it would end in a cut: near the ends of the depth of the box, and where the surface turns away from the decal. It's in the alpha of the colors of the vertices, so the material needs `vertexColors` and `transparent`:

```js
const geometry = new DecalGeometry( mesh, position, rotation, dimensions, { fade: true } );
const material = new THREE.MeshStandardMaterial( { map, transparent: true, vertexColors: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 } );
```
It can be an object to say how: `{ angle, depth }`. `angle` is from how many degrees away from facing the decal it starts to fade, 45 by default, and it's gone at `maxAngle`, or at 90. `depth` is the part of the depth of the box that fades at each end, .3 by default.

`color` is the color of the vertices of the decal, to tint it without another material. It goes with `vertexColors` in the material too.

`offset` moves the decal away from the surface, along its normals, by that distance in the world. It's another way of avoiding z-fighting, with or without `polygonOffset`.

`tangents` adds tangents to the decal, along the x of the box. With them, a normal map on the decal follows its texture on any surface.

`indexed` makes the triangles of the decal share the vertices that the ones of the mesh share. It's less than a third of the vertices on a smooth mesh. The vertices that the clipping makes are not shared, and neither is anything on a mesh that has no normals.

`uvRect` is the part of the texture that the decal shows, as `[ u0, v0, u1, v1 ]`. With several pictures in one texture, each decal can have a different one, and all of them the same material:

```js
const geometry = new DecalGeometry( mesh, position, rotation, dimensions, { uvRect: [ 0, .5, .5, 1 ] } );
```

`grid: false` makes it look at every triangle of the mesh, without the grid. The grid is made the first time that a geometry of 1000 triangles or more is cut, and again if its positions or its index change. To not wait for it on the first decal, make it before: `prepare( mesh )` does it at once, and `prepareAsync( mesh )` in a worker, without stopping the page, and returns a promise. Both take what a decal takes, or a geometry.

```js
import { prepareAsync } from 'three.decal-geometry';

await prepareAsync( scene );
```

A mesh that is moved by its bones or by its morphs is cut where it is at that moment.

Decals with bones and morphs
----------------------------

A decal on a `THREE.SkinnedMesh` can have its bones, and bend as the mesh does. `skin` gives the geometry what it needs, and `createDecal()` makes a mesh with it that has the skeleton of the other, and adds it to it:

```js
import { DecalGeometry, createDecal } from 'three.decal-geometry';

const geometry = new DecalGeometry( skinnedMesh, position, rotation, dimensions, { skin: true } );
const decal = createDecal( skinnedMesh, geometry, decalMaterial );
```

The box is placed on the mesh as it is posed. The vertices of the decal that are vertices of the mesh stay on it exactly. The ones that the clipping makes are very close: bones don't keep a straight edge straight, so give the decal a `polygonOffset` or an `offset`. Each vertex has the 4 bones that move it most.

`morph` does the same for a mesh with morph targets: the decal gets them, and `createDecal()` gives its mesh the influences of the other, the same list, so it changes when the other does. Both options can go together.

```js
const geometry = new DecalGeometry( face, position, rotation, dimensions, { morph: true } );
const decal = createDecal( face, geometry, decalMaterial );
```

`createSkinnedDecal()` is the name it had, and still works.

Many decals at once
-------------------

A mesh for each decal is a draw call for each decal. `DecalBatch` is a geometry that keeps them all, to draw them at once with one mesh and one material. Each decal can have its color:

```js
import { DecalBatch } from 'three.decal-geometry';

const batch = new DecalBatch();
scene.add( new THREE.Mesh( batch, new THREE.MeshStandardMaterial( { map, transparent: true, vertexColors: true } ) ) );

batch.add( mesh, position, rotation, dimensions, { color: 0xff0000, fade: true } );
```

`add()` takes what the constructor of `DecalGeometry` does, and returns the decal: `{ start, count, born, opacity }`, with where its vertices are in the geometry. It returns `null` if the box cut nothing. `addFromIntersection()` takes what `DecalGeometry.fromIntersection()` does. `batch.decals` is the list of them, the oldest first, and `batch.count` where the vertices end.

```js
const decal = batch.addFromIntersection( hit, 10, { color: 0x00ff00 } );

batch.setOpacity( decal, .5 );
batch.remove( decal );
batch.clear();
```

`remove()` takes a decal out, and its place is used by the ones that come after. `setOpacity()` fades one, from 0 to 1, over the fade it was cut with. `clear()` removes them all. Only the part of the geometry that changed is sent to the graphics card.

The options given to `new DecalBatch()` are the ones of every decal, unless `add()` gets others. These can only go there:

- `capacity`: the number of vertices to make room for at first, 1024 by default. It grows as needed
- `maxVertices`: the most vertices that it can have. When it's full, the oldest decals are removed to make room for the new ones
- `lifetime`: the seconds that a decal lasts, and `fadeTime`, the ones that it takes to fade away at the end, 1 by default. They go away when `batch.update()` is called, so call it on every frame. It takes the time in seconds, or uses the clock
- `tangents`
- `local` or `skin`: all the decals are of one mesh, in its coordinates or with its bones. Add the mesh of the batch to that mesh, or make it with `createDecal()`

```js
const batch = new DecalBatch( { maxVertices: 30000, lifetime: 20, fadeTime: 2 } );

function render() {

    batch.update();
    renderer.render( scene, camera );

}
```

The decals of a batch are not indexed, and don't have morphs.

Updating a decal
----------------

`update()` takes what the constructor does, and makes the decal again in the same geometry. Its buffers are only made again when the new decal doesn't fit in them, so it's the way to have a decal that moves:

```js
const geometry = new DecalGeometry();
const decal = new THREE.Mesh( geometry, decalMaterial );
scene.add( decal );

function render() {

    geometry.update( mesh, position, rotation, dimensions );
    renderer.render( scene, camera );

}
```

Tests
-----

[test/index.html](test/index.html) runs in the browser, from a server at the root of the repository. It checks the decals against known shapes, and against the ones of the `DecalGeometry` of three.js.

License
-------

MIT licensed

Copyright (C) 2014 Jaume Sanchez Elias https://twitter.com/thespite
Lee Perry Smith's head model and textures by [Infinite Realities](https://ir-ltd.net/)

https://www.clicktorelease.com
