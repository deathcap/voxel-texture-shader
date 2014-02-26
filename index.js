var tic = require('tic')();
var createAtlas = require('atlaspack');
var isTransparent = require('opaque').transparent;
var touchup = require('touchup');

module.exports = Texture;

function reconfigure(old) {
  var ret = module.exports(old.opts);
  ret.load(old.names);

  return ret;
}

function Texture(opts) {
  if (!(this instanceof Texture)) return new Texture(opts || {});
  var self = this;
  this.game = opts.game;
  this.opts = opts;
  this.THREE = this.game.THREE;
  this.names = [];
  this.materials = [];
  this.transparents = [];
  this.artPacks = opts.artPacks;
  if (!this.artPacks) throw new Error('voxel-texture-shader requires artPacks option');
  this.loading = 0;
  this.ao = require('voxel-fakeao')(this.game);

  var useFlatColors = opts.materialFlatColor === true;
  delete opts.materialFlatColor;

  this.useFourTap = opts.useFourTap = opts.useFourTap === undefined ? true : opts.useFourTap;

  // create a canvas for the texture atlas
  this.canvas = (typeof document !== 'undefined') ? document.createElement('canvas') : {};
  this.canvas.width = opts.atlasWidth || 2048;
  this.canvas.height = opts.atlasHeight || 2048;
  var ctx = this.canvas.getContext('2d');
  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

  // create core atlas and texture
  this.atlas = createAtlas(this.canvas);
  this.atlas.tilepad = opts.tilepad = opts.tilepad === undefined ? true : opts.tilepad;
  this._atlasuv = false;
  this._atlaskey = false;
  this.texture = new this.THREE.Texture(this.canvas);

  var THREE = this.game.THREE;

  var getMaterialParams = function(transparent) {
    var materialParams = {
      ambient: 0xbbbbbb,
      transparent: transparent,
      side: THREE.DoubleSide,
      lights: [], // force lights refresh to setup uniforms, three.js WebGLRenderer line 4323


    // based on three.js/src/renderers/WebGLShaders.js lambert
		uniforms: THREE.UniformsUtils.merge( [

        THREE.UniformsLib[ "common" ],
        THREE.UniformsLib[ "fog" ],
        THREE.UniformsLib[ "lights" ],
        THREE.UniformsLib[ "shadowmap" ],

        {
          "ambient"  : { type: "c", value: new THREE.Color( 0xffffff ) },
          "emissive" : { type: "c", value: new THREE.Color( 0x000000 ) },
          "wrapRGB"  : { type: "v3", value: new THREE.Vector3( 1, 1, 1 ) },

          // ours
          tileMap: {type: 't', value: null}, // textures not preserved by UniformsUtils.merge(); set below instead
          tileSize: {type: 'f', value: 16.0 / this.canvas.width} // size of tile in UV units (0.0-1.0), square (=== 16.0 / this.canvas.height)
        }
		] ),

		vertexShader: [

			"#define LAMBERT",

			"varying vec3 vLightFront;",

			"#ifdef DOUBLE_SIDED",

				"varying vec3 vLightBack;",

			"#endif",

			THREE.ShaderChunk[ "map_pars_vertex" ],
			THREE.ShaderChunk[ "lightmap_pars_vertex" ],
			THREE.ShaderChunk[ "envmap_pars_vertex" ],
			THREE.ShaderChunk[ "lights_lambert_pars_vertex" ],
			THREE.ShaderChunk[ "color_pars_vertex" ],
			THREE.ShaderChunk[ "morphtarget_pars_vertex" ],
			THREE.ShaderChunk[ "skinning_pars_vertex" ],
			THREE.ShaderChunk[ "shadowmap_pars_vertex" ],

      // added to pass to fragment shader for tile UV coordinate calculation
      'varying vec3 vNormal;',
      'varying vec3 vPosition;',
      'varying vec2 vUv;',
			"void main() {",

				THREE.ShaderChunk[ "map_vertex" ],
				THREE.ShaderChunk[ "lightmap_vertex" ],
				THREE.ShaderChunk[ "color_vertex" ],

				THREE.ShaderChunk[ "morphnormal_vertex" ],
				THREE.ShaderChunk[ "skinbase_vertex" ],
				THREE.ShaderChunk[ "skinnormal_vertex" ],
				THREE.ShaderChunk[ "defaultnormal_vertex" ],

				THREE.ShaderChunk[ "morphtarget_vertex" ],
				THREE.ShaderChunk[ "skinning_vertex" ],
				THREE.ShaderChunk[ "default_vertex" ],

				THREE.ShaderChunk[ "worldpos_vertex" ],
				THREE.ShaderChunk[ "envmap_vertex" ],
				THREE.ShaderChunk[ "lights_lambert_vertex" ],
				THREE.ShaderChunk[ "shadowmap_vertex" ],

        // added
'   vNormal = normal;',
'   vPosition = position;',
'   vUv = uv;',  // passed in from three.js vertexFaceUvs TODO: let shader chunks do it for us (proper #defines)
'   gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
			"}"

		].join("\n"),

		fragmentShader: [

			"uniform float opacity;",

			"varying vec3 vLightFront;",

			"#ifdef DOUBLE_SIDED",

				"varying vec3 vLightBack;",

			"#endif",

			THREE.ShaderChunk[ "color_pars_fragment" ],
			THREE.ShaderChunk[ "map_pars_fragment" ],
			THREE.ShaderChunk[ "lightmap_pars_fragment" ],
			THREE.ShaderChunk[ "envmap_pars_fragment" ],
			THREE.ShaderChunk[ "fog_pars_fragment" ],
			THREE.ShaderChunk[ "shadowmap_pars_fragment" ],
			THREE.ShaderChunk[ "specularmap_pars_fragment" ],

      // added
'uniform sampler2D tileMap;',
'uniform float tileSize;', // Size of a tile in atlas
'',
'varying vec3 vNormal;',
'varying vec3 vPosition;',
'varying vec2 vUv;',

// based on @mikolalysenko's code at:
// http://0fps.wordpress.com/2013/07/09/texture-atlases-wrapping-and-mip-mapping/
// https://github.com/mikolalysenko/ao-shader/blob/master/lib/ao.fsh
// https://github.com/mikolalysenko/ao-shader/blob/master/lib/ao.vsh

'vec4 fourTapSample(vec2 tileOffset, //Tile offset in the atlas ',
'                  vec2 tileUV, //Tile coordinate (as above)',
'                  sampler2D atlas) {', // }
'  //Initialize accumulators',
'  vec4 color = vec4(0.0, 0.0, 0.0, 0.0);',
'  float totalWeight = 0.0;',
'',
'  for(int dx=0; dx<2; ++dx)',
'  for(int dy=0; dy<2; ++dy) {',
'    //Compute coordinate in 2x2 tile patch',
'    vec2 tileCoord = 2.0 * fract(0.5 * (tileUV + vec2(dx,dy)));',
'',
'    //Weight sample based on distance to center',
'    float w = pow(1.0 - max(abs(tileCoord.x-1.0), abs(tileCoord.y-1.0)), 16.0);',
'',
'    //Compute atlas coord',
'    vec2 atlasUV = tileOffset + tileSize * tileCoord;',
'',
'    //Sample and accumulate',
'    color += w * texture2D(atlas, atlasUV);',
'    totalWeight += w;',
'  }',
'',
'  //Return weighted color',
'  return color / totalWeight;',
'}',
'',

			"void main() {",

				//"gl_FragColor = vec4( vec3 ( 1.0 ), opacity );",

				//THREE.ShaderChunk[ "map_fragment" ],
      
        // added
// use world coordinates to repeat [0..1] offsets, within _each_ tile face
'   vec2 tileUV = vec2(dot(vNormal.zxy, vPosition),',
'                      dot(vNormal.yzx, vPosition));',

'',
'    // back and bottom: flip 180',
'    if (vNormal.z < 0.0 || vNormal.y < 0.0) tileUV.t = 1.0 - tileUV.t;',
'',
'    // left: rotate 90 ccw',
'    if (vNormal.x < 0.0) {',
'        float r = tileUV.s;',
'        tileUV.s = tileUV.t;',
'        tileUV.t = 1.0 - r;',
'    }',
'',
'    // right and top: rotate 90 cw',
'    if (vNormal.x > 0.0 || vNormal.y > 0.0) {',
'        float r = tileUV.s;',
'        tileUV.s = tileUV.t;',
'        tileUV.t = r;',
'    }', 
'',
'    // front and back and bottom: flip 180',
'   if (vNormal.z > 0.0 || vNormal.z < 0.0 || vNormal.y < 0.0) tileUV.s = 1.0 - tileUV.s;',
'',
'',

// three.js' UV coordinate is passed as tileOffset, starting point determining the texture
// material type (_not_ interpolated; same for all vertices).
'   vec2 tileOffset = vUv;',

'',
(this.useFourTap // TODO: use glsl conditional compilation?
  ? [
    '     gl_FragColor = fourTapSample(tileOffset, //Tile offset in the atlas ',
    '                  tileUV, //Tile coordinate (as above)',
    '                  tileMap);'].join('\n') 
  : [
    // index tile at offset into texture atlas
    'vec2 texCoord = tileOffset + tileSize * fract(tileUV);',
    'gl_FragColor = texture2D(tileMap, texCoord);'].join('\n')),
'',


				THREE.ShaderChunk[ "alphatest_fragment" ],
				THREE.ShaderChunk[ "specularmap_fragment" ],

				"#ifdef DOUBLE_SIDED",

					"if ( gl_FrontFacing )",
						"gl_FragColor.xyz *= vLightFront;",
					"else",
						"gl_FragColor.xyz *= vLightBack;",

				"#else",

					"gl_FragColor.xyz *= vLightFront;",

				"#endif",

				THREE.ShaderChunk[ "lightmap_fragment" ],
				THREE.ShaderChunk[ "color_fragment" ],
				THREE.ShaderChunk[ "envmap_fragment" ],
				THREE.ShaderChunk[ "shadowmap_fragment" ],

				THREE.ShaderChunk[ "linear_to_gamma_fragment" ],

				THREE.ShaderChunk[ "fog_fragment" ],

      "}"
		].join("\n")
      //depthWrite: false,
      //depthTest: false
	  };

    materialParams.uniforms.tileMap.value = this.texture;

    return materialParams;
  };

  this.materialParams = getMaterialParams.call(this, false);
  this.materialTransparentParams = getMaterialParams.call(this, true);

  this.texture.magFilter = this.THREE.NearestFilter;
  this.texture.minFilter = this.THREE.LinearMipMapLinearFilter;

  if (useFlatColors) {
    // If were using simple colors
    this.material = new this.THREE.MeshBasicMaterial({
      vertexColors: this.THREE.VertexColors
    });
  } else {
    var opaque = new this.THREE.ShaderMaterial(this.materialParams);
    var transparent = new this.THREE.ShaderMaterial(this.materialTransparentParams);
    this.material = new this.THREE.MeshFaceMaterial([
      opaque,
      transparent
    ]);
  }

  // a place for meshes to wait while textures are loading
  this._meshQueue = [];
}

Texture.prototype.reconfigure = function() {
  return reconfigure(this);
};

Texture.prototype.load = function(names, done) {
  if (!names || names.length === 0) return;
  this.names = this.names.concat(names); // save for reconfiguration

  var self = this;
  if (!Array.isArray(names)) names = [names];
  done = done || function() {};
  this.loading++;

  var materialSlice = names.map(self._expandName);
  self.materials = self.materials.concat(materialSlice);

  // load onto the texture atlas
  var load = Object.create(null);
  materialSlice.forEach(function(mats) {
    mats.forEach(function(mat) {
      if (mat.slice(0, 1) === '#') return;
      // todo: check if texture already exists
      load[mat] = true;
    });
  });
  if (Object.keys(load).length > 0) {
    each(Object.keys(load), self.pack.bind(self), function() {
      self._afterLoading();
      done(materialSlice);
    });
  } else {
    self._afterLoading();
  }
};

Texture.prototype.getTransparentVoxelTypes = function() {
  var transparentMap = {};

  for (var i = 0; i < this.materials.length; i += 1) {
    var blockIndex = i + 1;
    var materialSlice = this.materials[i];

    var anyTransparent = false;
    for (var j = 0; j < materialSlice.length; j += 1) {
      anyTransparent |= this.transparents.indexOf(materialSlice[j]) !== -1;
    }

    if (anyTransparent)
      transparentMap[blockIndex] = true;
  }

  return transparentMap;
};

Texture.prototype.pack = function(name, done) {
  var self = this;
  function pack(img) {
    var node = self.atlas.pack(img);
    if (node === false) {
      self.atlas = self.atlas.expand(img);
      self.atlas.tilepad = true;
    }
    done();
  }
  if (typeof name === 'string') {
    self.artPacks.getTextureImage(name, function(img) {
      if (isTransparent(img)) {
        self.transparents.push(name);
      }
      // repeat 2x2 for mipmap padding 4-tap trick
      // TODO: replace with atlaspack padding, but changed to 2x2: https://github.com/deathcap/atlaspack/tree/tilepadamount
      var img2 = new Image();
      img2.id = name;
      img2.src = touchup.repeat(img, 2, 2);
      img2.onload = function() {
        pack(img2);
      }
    }, function(err, img) {
      console.error('Couldn\'t load URL [' + img.src + ']');
      done();
    });
  } else {
    pack(name);
  }
  return self;
};

Texture.prototype.find = function(name) {
  var self = this;
  var type = 0;
  self.materials.forEach(function(mats, i) {
    mats.forEach(function(mat) {
      if (mat === name) {
        type = i + 1;
        return false;
      }
    });
    if (type !== 0) return false;
  });
  return type;
};

Texture.prototype._expandName = function(name) {
  if (name === null) return Array(6);
  if (name.top) return [name.back, name.front, name.top, name.bottom, name.left, name.right];
  if (!Array.isArray(name)) name = [name];
  // load the 0 texture to all
  if (name.length === 1) name = [name[0],name[0],name[0],name[0],name[0],name[0]];
  // 0 is top/bottom, 1 is sides
  if (name.length === 2) name = [name[1],name[1],name[0],name[0],name[1],name[1]];
  // 0 is top, 1 is bottom, 2 is sides
  if (name.length === 3) name = [name[2],name[2],name[0],name[1],name[2],name[2]];
  // 0 is top, 1 is bottom, 2 is front/back, 3 is left/right
  if (name.length === 4) name = [name[2],name[2],name[0],name[1],name[3],name[3]];
  return name;
};

Texture.prototype._afterLoading = function() {
  var self = this;
  function alldone() {
    self.loading--;
    self._atlasuv = self.atlas.uv(self.canvas.width, self.canvas.height);
    self._atlaskey = Object.create(null);
    self.atlas.index().forEach(function(key) {
      self._atlaskey[key.name] = key;
    });
    self.texture.needsUpdate = true;
    self.material.needsUpdate = true;
    //window.open(self.canvas.toDataURL());
    if (self._meshQueue.length > 0) {
      self._meshQueue.forEach(function(queue, i) {
        self.paint.apply(queue.self, queue.args);
        delete self._meshQueue[i];
      });
    }
  }
  self._powerof2(function() {
    setTimeout(alldone, 100);
  });
};

// Ensure the texture stays at a power of 2 for mipmaps
// this is cheating :D
Texture.prototype._powerof2 = function(done) {
  var w = this.canvas.width;
  var h = this.canvas.height;
  function pow2(x) {
    x--;
    x |= x >> 1;
    x |= x >> 2;
    x |= x >> 4;
    x |= x >> 8;
    x |= x >> 16;
    x++;
    return x;
  }
  if (h > w) w = h;
  var old = this.canvas.getContext('2d').getImageData(0, 0, this.canvas.width, this.canvas.height);
  this.canvas.width = this.canvas.height = pow2(w);
  this.canvas.getContext('2d').putImageData(old, 0, 0);
  done();
};

Texture.prototype.paint = function(mesh, materials) {
  var self = this;

  // if were loading put into queue
  if (self.loading > 0) {
    self._meshQueue.push({self: self, args: arguments});
    return false;
  }

  var isVoxelMesh = (materials) ? false : true;
  if (!isVoxelMesh) materials = self._expandName(materials);

  mesh.geometry.faces.forEach(function(face, i) {
    if (mesh.geometry.faceVertexUvs[0].length < 1) return;

    if (isVoxelMesh) {
      var index = Math.floor(face.color.b*255 + face.color.g*255*255 + face.color.r*255*255*255);
      materials = self.materials[index - 1];
      if (!materials) materials = self.materials[0];
    }

    // BACK, FRONT, TOP, BOTTOM, LEFT, RIGHT
    var name = materials[0] || '';
    if      (face.normal.z === 1)  name = materials[1] || '';
    else if (face.normal.y === 1)  name = materials[2] || '';
    else if (face.normal.y === -1) name = materials[3] || '';
    else if (face.normal.x === -1) name = materials[4] || '';
    else if (face.normal.x === 1)  name = materials[5] || '';

    // if just a simple color
    if (name.slice(0, 1) === '#') {
      self.ao(face, name);
      return;
    }

    var atlasuv = self._atlasuv[name];
    if (!atlasuv) return;

    // If a transparent texture use transparent material
    face.materialIndex = (self.transparents.indexOf(name) !== -1) ? 1 : 0;

    // 0 -- 1
    // |    |
    // 3 -- 2
    // faces on these meshes are flipped vertically, so we map in reverse
    if (isVoxelMesh) {
      atlasuv = uvinvert(atlasuv);
    } else {
      atlasuv = uvrot(atlasuv, -90);
    }

    // range of UV coordinates for this texture (see above diagram)
    var topUV = atlasuv[0], rightUV = atlasuv[1], bottomUV = atlasuv[2], leftUV = atlasuv[3];

    // pass texture start in UV coordinates
    for (var j = 0; j < mesh.geometry.faceVertexUvs[0][i].length; j++) {
      //mesh.geometry.faceVertexUvs[0][i][j].set(atlasuv[j][0], 1 - atlasuv[j][1]);
      mesh.geometry.faceVertexUvs[0][i][j].set(topUV[0], 1.0 - topUV[1]); // set all to top (fixed tileSize)
    }
  });

  mesh.geometry.uvsNeedUpdate = true;
};

Texture.prototype.sprite = function(name, w, h, cb) {
  var self = this;
  if (typeof w === 'function') { cb = w; w = null; }
  if (typeof h === 'function') { cb = h; h = null; }
  w = w || 16; h = h || w;
  self.loading++;
  self.artPacks.getTextureImage(name, function(img) {
    var canvases = [];
    for (var x = 0; x < img.width; x += w) {
      for (var y = 0; y < img.height; y += h) {
        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.name = name + '_' + x + '_' + y;
        canvas.getContext('2d').drawImage(img, x, y, w, h, 0, 0, w, h);
        canvases.push(canvas);
      }
    }
    var textures = [];
    each(canvases, function(canvas, next) {
      var tex = new Image();
      tex.name = canvas.name;
      tex.src = canvas.toDataURL();
      tex.onload = function() {
        self.pack(tex, next);
      };
      tex.onerror = next;
      textures.push([
        tex.name, tex.name, tex.name,
        tex.name, tex.name, tex.name
      ]);
    }, function() {
      self._afterLoading();
      delete canvases;
      self.materials = self.materials.concat(textures);
      cb(textures);
    });
  }, function(err, img) {
    cb();
  });
  return self;
};

Texture.prototype.animate = function(mesh, names, delay) {
  var self = this;
  delay = delay || 1000;
  if (!Array.isArray(names) || names.length < 2) return false;
  var i = 0;
  var mat = new this.THREE.ShaderMaterial(this.materialParams);
  mat.map = this.texture;
  mat.transparent = true;
  mat.needsUpdate = true;
  tic.interval(function() {
    self.paint(mesh, names[i % names.length]);
    i++;
  }, delay);
  return mat;
};

Texture.prototype.tick = function(dt) {
  tic.tick(dt);
};

function uvrot(coords, deg) {
  if (deg === 0) return coords;
  var c = [];
  var i = (4 - Math.ceil(deg / 90)) % 4;
  for (var j = 0; j < 4; j++) {
    c.push(coords[i]);
    if (i === 3) i = 0; else i++;
  }
  return c;
}

function uvinvert(coords) {
  var c = coords.slice(0);
  return [c[3], c[2], c[1], c[0]];
}

function each(arr, it, done) {
  var count = 0;
  arr.forEach(function(a) {
    it(a, function() {
      count++;
      if (count >= arr.length) done();
    });
  });
}


