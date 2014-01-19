# voxel-texture-shader

Shaders for texturing voxels in voxel.js

Based on [voxel-texture](https://github.com/shama/voxel-texture) by @shama, mostly compatible but
several differences:

* Supports greedy meshing, tiling the voxel textures appropriately 
(using techniques by @mikolalysenko in [Texture atlases, wrapping and mip mapping](http://0fps.wordpress.com/2013/07/09/texture-atlases-wrapping-and-mip-mapping/))
* Supports optional four-tap sampling to fix texture seams (also based on @mikolalysenko's work)
* Loads textures using [artpacks](https://github.com/deathcap/artpacks) (instead of individual files in `texturePath`)

Experimental toggling between voxel-texture-shader and voxel-texture: [https://github.com/deathcap/voxel-debug](https://github.com/deathcap/voxel-debug)

## example

```js
// create a material engine
var textureEngine = require('voxel-texture-shader')({
  // a copy of your voxel.js game
  game: game,

  // artpacks instance
  artPacks: artPacks
});

// load textures and it returns textures just loaded
textureEngine.load(['grass', 'dirt', 'grass_dirt'], function(textures) {
  // create a new mesh
  var cube = new game.THREE.Mesh(
    new game.THREE.CubeGeometry(game.cubeSize, game.cubeSize, game.cubeSize),
    // use the texture engine atlas material
    textureEngine.material
  );
  // paint the cube with grass on top, dirt on bottom and grass_dirt on sides
  textureEngine.paint(cube, ['grass', 'dirt', 'grass_dirt']);
});
```

## api

### `require('voxel-texture-shader')(options)`
Returns a new texture engine instance. Must pass a copy of your voxel.js
`game`. `options` defaults to:

```js
{
  artPacks: artPacks,
  materialParams: { ambient: 0xbbbbbb },
  materialType: THREE.MeshLambertMaterial,
  applyTextureParams: function(map) {
    map.magFilter = this.THREE.NearestFilter;
    map.minFilter = this.THREE.LinearMipMapLinearFilter;
  }
}
```

### `textureEngine.load(textures, callback)`
Loads textures onto the atlas by expanding the texture names:

```js
textureEngine.load('grass', function(textures) {
  // textures = [grass, grass, grass, grass, grass, grass]
});
```

```js
textureEngine.load(['grass', 'dirt', 'grass_dirt'], function(textures) {
  // textures = [grass_dirt, grass_dirt, grass, dirt, grass_dirt, grass_dirt]
});
```

```js
textureEngine.load([
  'obsidian',
  ['back', 'front', 'top', 'bottom', 'left', 'right'],
  'brick'
], function(textures) {
  /*
  textures = [
    obsidian, obsidian, obsidian, obsidian, obsidian, obsidian,
    back, front, top, bottom, left, right,
    brick, brick, brick, brick, brick, brick
  ]
  */
});
```

### `textureEngine.find(name)`
Finds the type of block by texture name:

```js
// Find and change the center block to grass
game.setBlock([0, 0, 0], textureEngine.find('grass'));
```

Although this is built into the voxel engine so you could just do:

```js
game.setBlock([0, 0, 0], 'grass');
```

### `textureEngine.paint(mesh, textures)`
Modifies the UV mapping of given `mesh` to the `textures` names supplied:

```js
// create a custom mesh and load all materials
var mesh = new game.THREE.Mesh(
  new game.THREE.Geometry(),
  textureEngine.material
);

// paint the geometry
textureEngine.paint(mesh, ['grass', 'dirt', 'grass_dirt']);
```

Or if you have the `face.color` set on the faces of your geometry (such as how
voxel-mesh does it) then omit the `textures` argument. It will select the
texture based on color from all the previously loaded textures:

```js
textureEngine.paint(voxelMesh);
```

### `textureEngine.sprite(name, w, h, callback)`
Create textures from a sprite map. If you have a single image with a bunch of
textures do:

```js
// load terrain.png, it is 512x512
// each texture is 32x32
textureEngine.sprite('terrain', 32, function(textures) {
  // each texture will be named: terrain_x_y
});
```

The width and height default to `16x16`.

### `textureEngine.animate(mesh, textures, delay)`
Create an animated material. A material that after each delay will paint the
mesh by iterating through `textures`. Must run `textureEngine.tick()` to
actually animate.

```js
var mesh = new game.THREE.Mesh(
  new game.THREE.Geometry(),
  new game.THREE.MeshFaceMaterial()
);
mesh.material = textureEngine.animate(mesh, ['one', 'two', 'three'], 1000);
```

### `textureEngine.tick(delta)`
Run the animations for any animated materials.

```js
game.on('tick', function(dt) {
  textureEngine.tick(dt);
});
```

## license
Copyright (c) 2013 Kyle Robinson Young  
Licensed under the MIT license.
