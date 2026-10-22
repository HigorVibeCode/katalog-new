// The rooms of the 3D decks: surfaces drawn as textures (plaster, stone slabs with veins and
// grout, a polished floor), a light rig of window sun with soft shadows and a ceiling cove, the
// reflections rendered from the room itself, and a contact shadow under a piece. Everything is
// made here, in millimetres, without files.
import * as THREE from 'three'
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js'
import { Reflector } from 'three/addons/objects/Reflector.js'

// ------------------------------------------------------------------ noise
// Tiling value noise on a small lattice: the same seed gives the same surface on every visit.
function lattice(n, seed) {
  let s = seed >>> 0 || 1
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
  const a = new Float32Array(n * n)
  for (let i = 0; i < a.length; i++) a[i] = rnd()
  return a
}
const fade = t => t * t * (3 - 2 * t)
// value noise at (x, y) in lattice cells, tiling every n cells
function value(a, n, x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = fade(x - xi), fy = fade(y - yi)
  const x0 = ((xi % n) + n) % n, y0 = ((yi % n) + n) % n, x1 = (x0 + 1) % n, y1 = (y0 + 1) % n
  const v00 = a[y0 * n + x0], v10 = a[y0 * n + x1], v01 = a[y1 * n + x0], v11 = a[y1 * n + x1]
  return (v00 + (v10 - v00) * fx) * (1 - fy) + (v01 + (v11 - v01) * fx) * fy
}
// fractal noise over the unit square, tiling, in 0..1
export function fbm(size, { octaves = 5, base = 4, seed = 7, gain = 0.5 } = {}) {
  const out = new Float32Array(size * size)
  let amp = 1, total = 0, cells = base
  for (let o = 0; o < octaves; o++) {
    const a = lattice(cells, seed + o * 131)
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) out[y * size + x] += value(a, cells, x / size * cells, y / size * cells) * amp
    total += amp; amp *= gain; cells *= 2
  }
  for (let i = 0; i < out.length; i++) out[i] /= total
  return out
}

// ------------------------------------------------------------------ maps
const texture = (canvas, srgb, repeat) => {
  const t = new THREE.CanvasTexture(canvas)
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  if (repeat) t.repeat.set(repeat[0], repeat[1])
  t.anisotropy = 8
  return t
}
// a normal map from a height field (0..1), strength in texels of slope
function normalMap(height, size, strength) {
  const c = document.createElement('canvas'); c.width = c.height = size
  const g = c.getContext('2d'), img = g.createImageData(size, size), d = img.data
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const l = height[y * size + ((x - 1 + size) % size)], r = height[y * size + (x + 1) % size]
    const u = height[((y - 1 + size) % size) * size + x], dn = height[((y + 1) % size) * size + x]
    const nx = (l - r) * strength, ny = (dn - u) * strength
    const len = Math.hypot(nx, ny, 1)
    const i = (y * size + x) * 4
    d[i] = (nx / len * 0.5 + 0.5) * 255; d[i + 1] = (ny / len * 0.5 + 0.5) * 255; d[i + 2] = (1 / len * 0.5 + 0.5) * 255; d[i + 3] = 255
  }
  g.putImageData(img, 0, 0)
  return c
}
const hex = h => { const c = new THREE.Color(h); return [c.r, c.g, c.b] }
const mix = (a, b, t) => a + (b - a) * t

// Plaster: a fine, even grain with faint trowel clouds. `repeat` in world units per tile is left
// to the caller (set texture.repeat).
export function plaster({ size = 512, color = '#e9e5de', clouds = 0.05, grain = 0.035, seed = 3 } = {}) {
  const soft = fbm(size, { octaves: 3, base: 3, seed }), fine = fbm(size, { octaves: 2, base: 64, seed: seed + 9 })
  const c = document.createElement('canvas'); c.width = c.height = size
  const g = c.getContext('2d'), img = g.createImageData(size, size), d = img.data
  const [r, gg, b] = hex(color)
  const h = new Float32Array(size * size)
  for (let i = 0; i < h.length; i++) {
    const k = 1 + (soft[i] - 0.5) * 2 * clouds + (fine[i] - 0.5) * 2 * grain
    d[i * 4] = Math.min(255, r * k * 255); d[i * 4 + 1] = Math.min(255, gg * k * 255); d[i * 4 + 2] = Math.min(255, b * k * 255); d[i * 4 + 3] = 255
    h[i] = soft[i] * 0.6 + fine[i] * 0.4
  }
  g.putImageData(img, 0, 0)
  return { map: texture(c, true), normalMap: texture(normalMap(h, size, 1.2), false), roughness: 0.9 }
}

// Large-format stone slabs: a pale ground with soft veins and a thin grout line; `tiles` slabs
// per texture tile in x and y (the caller sets the repeat so one slab has its true size).
export function stone({ size = 1024, color = '#e6e1d8', vein = '#c9c1b4', tiles = [1, 1], grout = 0.0022, veins = 0.5, seed = 11, polish = 0.3 } = {}) {
  const ground = fbm(size, { octaves: 4, base: 3, seed }), warp = fbm(size, { octaves: 3, base: 2, seed: seed + 5 }), fine = fbm(size, { octaves: 2, base: 48, seed: seed + 17 })
  const c = document.createElement('canvas'); c.width = c.height = size
  const g = c.getContext('2d'), img = g.createImageData(size, size), d = img.data
  const [r0, g0, b0] = hex(color), [r1, g1, b1] = hex(vein)
  const h = new Float32Array(size * size), rough = new Float32Array(size * size)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x
    // veins: a few long diagonal streaks, bent by the noise, thin and soft
    const w = warp[i] * 2 - 1
    const v = 1 - Math.abs(Math.sin(((x * 0.62 + y * 0.38) / size + w * 0.12) * Math.PI * 2.2))
    const vein = (Math.pow(v, 40) * 0.8 + Math.pow(v, 8) * 0.05) * veins * (0.4 + 0.6 * ground[i])
    let k = 1 + (ground[i] - 0.5) * 0.05 + (fine[i] - 0.5) * 0.025
    let rr = mix(r0 * k, r1, vein), gg = mix(g0 * k, g1, vein), bb = mix(b0 * k, b1, vein)
    // grout
    const u = (x / size * tiles[0]) % 1, vv = (y / size * tiles[1]) % 1
    const inGrout = u < grout * tiles[0] || u > 1 - grout * tiles[0] || vv < grout * tiles[1] || vv > 1 - grout * tiles[1]
    if (inGrout) { rr *= 0.8; gg *= 0.8; bb *= 0.8 }
    d[i * 4] = Math.min(255, rr * 255); d[i * 4 + 1] = Math.min(255, gg * 255); d[i * 4 + 2] = Math.min(255, bb * 255); d[i * 4 + 3] = 255
    h[i] = inGrout ? 0 : 0.6 + fine[i] * 0.03 - vein * 0.02
    rough[i] = inGrout ? 0.95 : polish + vein * 0.06 + (fine[i] - 0.5) * 0.05
  }
  g.putImageData(img, 0, 0)
  const rc = document.createElement('canvas'); rc.width = rc.height = size
  const rg = rc.getContext('2d'), rimg = rg.createImageData(size, size)
  for (let i = 0; i < rough.length; i++) { const v = Math.max(0, Math.min(1, rough[i])) * 255; rimg.data[i * 4] = v; rimg.data[i * 4 + 1] = v; rimg.data[i * 4 + 2] = v; rimg.data[i * 4 + 3] = 255 }
  rg.putImageData(rimg, 0, 0)
  return { map: texture(c, true), normalMap: texture(normalMap(h, size, 2), false), roughnessMap: texture(rc, false) }
}

// Wood planks: boards of their own tone, a fine grain along them and a bevelled gap between.
// One texture tile holds `boards` boards across its height; the boards run along x.
export function planks({ size = 1024, color = '#8a6a48', boards = 6, gap = 0.012, seed = 41, satin = 0.45, contrast = 0.1 } = {}) {
  const a0 = lattice(64, seed), a1 = lattice(128, seed + 3), a2 = lattice(256, seed + 7), tone = lattice(boards, seed + 11)
  const c = document.createElement('canvas'); c.width = c.height = size
  const g = c.getContext('2d'), img = g.createImageData(size, size), d = img.data
  const [r0, g0, b0] = hex(color)
  const h = new Float32Array(size * size), rough = new Float32Array(size * size)
  for (let y = 0; y < size; y++) {
    const by = y / size * boards, b = Math.floor(by), f = by - b
    const inGap = f < gap || f > 1 - gap
    const t = 0.86 + tone[b] * 0.24, off = tone[(b + 1) % boards] * 37
    for (let x = 0; x < size; x++) {
      const i = y * size + x, u = x / size
      // the grain: stretched along the board, three octaves
      const grain = value(a0, 64, u * 6 + off, by * 48) * 0.5 + value(a1, 128, u * 14 + off, by * 96) * 0.3 + value(a2, 256, u * 40 + off, by * 200) * 0.2
      const k = inGap ? 0.45 : t * (1 - contrast + 2 * contrast * grain)
      d[i * 4] = Math.min(255, r0 * k * 255); d[i * 4 + 1] = Math.min(255, g0 * k * 255); d[i * 4 + 2] = Math.min(255, b0 * k * 255); d[i * 4 + 3] = 255
      h[i] = inGap ? 0 : 0.5 + grain * 0.08
      rough[i] = inGap ? 0.9 : satin + (grain - 0.5) * 0.2
    }
  }
  g.putImageData(img, 0, 0)
  const rc = document.createElement('canvas'); rc.width = rc.height = size
  const rg = rc.getContext('2d'), rimg = rg.createImageData(size, size)
  for (let i = 0; i < rough.length; i++) { const v = Math.max(0, Math.min(1, rough[i])) * 255; rimg.data[i * 4] = v; rimg.data[i * 4 + 1] = v; rimg.data[i * 4 + 2] = v; rimg.data[i * 4 + 3] = 255 }
  rg.putImageData(rimg, 0, 0)
  return { map: texture(c, true), normalMap: texture(normalMap(h, size, 2.5), false), roughnessMap: texture(rc, false) }
}

// a surface material from a map set, with the world size of one texture tile in mm
export function surface(maps, { w, h }, overrides = {}) {
  // the plain surfaces are standard materials: cheaper per pixel than physical ones, which only
  // the clearcoated floor needs
  const m = new (overrides.clearcoat ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial)({ color: '#ffffff', roughness: maps.roughness ?? 1, metalness: 0, ...overrides })
  for (const key of ['map', 'normalMap', 'roughnessMap']) if (maps[key]) { m[key] = maps[key].clone(); m[key].needsUpdate = true }
  m.userData.tile = { w, h }
  return m
}
// a plane of the material, the texture repeated by its true size
// `origin` (mm, the plane's lower-left corner within a larger surface) keeps the pattern
// continuous across the pieces of one wall
export function slab(material, width, height, origin = [0, 0]) {
  const m = material.clone()
  const { w, h } = material.userData.tile
  for (const key of ['map', 'normalMap', 'roughnessMap']) if (m[key]) { m[key] = m[key].clone(); m[key].repeat.set(width / w, height / h); m[key].offset.set(origin[0] / w, origin[1] / h); m[key].needsUpdate = true }
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), m)
  mesh.receiveShadow = true
  return mesh
}

// ------------------------------------------------------------------ light
// The sun through a window: warm, from high on one side, with a soft shadow over the stage.
export function sunlight({ color = '#fff1dc', intensity = 2.4, position = [-3800, 3600, 2600], target = [0, -500, -600], extent = 3200, mapSize = 2048, near = 1000, far = 14000 } = {}) {
  const sun = new THREE.DirectionalLight(color, intensity)
  sun.position.set(...position)
  sun.target.position.set(...target)
  sun.castShadow = true
  sun.shadow.mapSize.set(mapSize, mapSize)
  Object.assign(sun.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent, near, far })
  sun.shadow.radius = 7
  sun.shadow.bias = -0.0004
  sun.shadow.normalBias = 6
  return sun
}
// a lit strip (a cove or a light line) as an area light with the glowing strip itself
let rectReady = false
export function cove({ width, height = 40, color = '#fff4e4', intensity = 6, position, lookAt }) {
  if (!rectReady) { RectAreaLightUniformsLib.init(); rectReady = true }
  const light = new THREE.RectAreaLight(color, intensity, width, height)
  light.position.set(...position)
  light.lookAt(...lookAt)
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ color, toneMapped: false }))
  strip.position.copy(light.position); strip.quaternion.copy(light.quaternion)
  strip.rotateY(Math.PI)                                      // the strip faces where the light goes
  const group = new THREE.Group(); group.add(light, strip)
  group.userData.light = light; group.userData.strip = strip
  return group
}

// The reflections: the room rendered once from inside into a cube, then prefiltered. Pieces that
// should not mirror themselves (the glass) are hidden for the shot.
export function roomEnvironment(renderer, scene, position, hide = []) {
  const target = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType })
  const cam = new THREE.CubeCamera(50, 60000, target)
  cam.position.set(...position)
  const was = hide.map(o => o.visible)
  hide.forEach(o => { o.visible = false })
  const env = scene.environment, bg = scene.background
  scene.environment = null; scene.background = null
  cam.update(renderer, scene)
  scene.environment = env; scene.background = bg
  hide.forEach((o, i) => { o.visible = was[i] })
  const pmrem = new THREE.PMREMGenerator(renderer)
  const out = pmrem.fromCubemap(target.texture).texture
  pmrem.dispose(); target.dispose()
  return out
}

// A soft dark pool under a piece standing on the floor: contact shadow, where no shadow map reaches.
export function contactShadow(w, d, opacity = 0.35) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128
  const g = c.getContext('2d')
  const grad = g.createRadialGradient(128, 64, 0, 128, 64, 64)
  grad.addColorStop(0, `rgba(0,0,0,${opacity})`); grad.addColorStop(0.45, `rgba(0,0,0,${opacity * 0.55})`); grad.addColorStop(1, 'rgba(0,0,0,0)')
  g.save(); g.scale(1, 1); g.fillStyle = grad; g.fillRect(0, 0, 256, 128); g.restore()
  const m = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, toneMapped: false })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), m)
  mesh.rotation.x = -Math.PI / 2
  mesh.renderOrder = 1
  return mesh
}

// chrome and brushed metal for fittings
export const chrome = () => new THREE.MeshPhysicalMaterial({ color: '#ffffff', metalness: 1, roughness: 0.08, envMapIntensity: 1.3 })
export const brushed = () => new THREE.MeshPhysicalMaterial({ color: '#d9d9d6', metalness: 1, roughness: 0.35, envMapIntensity: 1 })

// A polished floor that mirrors the room: a planar reflection rendered each frame (Reflector),
// taken up by the floor's own stone material – sharp where the stone is polished, dull where it
// is rough, strongest at grazing angles, as on a real stone floor.
// `before`/`after` run around the mirror's render: the deck swaps the costly glass for a cheap
// ghost of it there, so the room is not refracted twice.
export function mirrorFloor(material, width, depth, { resolution = 1024, strength = 1, before = null, after = null } = {}) {
  const geometry = new THREE.PlaneGeometry(width, depth)
  const reflector = new Reflector(geometry, { textureWidth: resolution, textureHeight: resolution, clipBias: 0.5, multisample: 0 })
  const textureMatrix = reflector.material.uniforms.textureMatrix.value
  const rt = reflector.getRenderTarget()
  rt.texture.generateMipmaps = true
  rt.texture.minFilter = THREE.LinearMipmapLinearFilter
  const m = material.clone()
  const { w, h } = material.userData.tile
  for (const key of ['map', 'normalMap', 'roughnessMap']) if (m[key]) { m[key] = m[key].clone(); m[key].repeat.set(width / w, depth / h); m[key].needsUpdate = true }
  const own = { tMirror: { value: rt.texture }, textureMatrix: { value: textureMatrix }, mirrorStrength: { value: strength } }
  m.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, own)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform mat4 textureMatrix; varying vec4 vMirror;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n\tvMirror = textureMatrix * vec4( position, 1.0 );')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tMirror; uniform float mirrorStrength; varying vec4 vMirror;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
	{
		vec2 muv = vMirror.xy / vMirror.w;
		float blur = clamp( roughnessFactor * 9.0, 0.0, 6.0 );
		vec3 mirrored = textureLod( tMirror, muv, blur ).rgb;
		vec3 n = normalize( normal );
		float cosT = clamp( dot( n, normalize( vViewPosition ) ), 0.0, 1.0 );
		float fresnel = 0.04 + 0.96 * pow( 1.0 - cosT, 5.0 );
		totalEmissiveRadiance += mirrored * fresnel * ( 1.0 - roughnessFactor ) * mirrorStrength;
	}`)
  }
  m.customProgramCacheKey = () => 'mirror-floor-1'
  m.envMapIntensity = 0.25
  reflector.material.dispose()
  reflector.material = m
  reflector.receiveShadow = true
  reflector.resize = (w, h) => rt.setSize(Math.max(64, Math.round(w)), Math.max(64, Math.round(h)))   // half the canvas is plenty for a blurred mirror
  // the mirror is rendered only for the picture itself: not while a cube map of the room is taken
  // (the nested render would lose the cube face) nor for the depth and normal passes
  const render = reflector.onBeforeRender
  reflector.onBeforeRender = (renderer, scene, camera, ...rest) => {
    if (scene.overrideMaterial || renderer.getRenderTarget()?.isWebGLCubeRenderTarget) return
    before?.()
    render.call(reflector, renderer, scene, camera, ...rest)
    after?.()
  }
  return reflector
}

// ------------------------------------------------------------------ travertine
// Travertine: a warm stone of fine horizontal strata, with small elongated pits along some of
// them; honed, not polished. The slab size in mm is the caller's (surface(..., { w, h })).
export function travertine({ size = 1024, color = '#e5dac7', dark = '#bfa98b', seed = 61, polish = 0.4, pits = 1, bands = 1 } = {}) {
  const a0 = lattice(4, seed), a1 = lattice(8, seed + 3), a2 = lattice(16, seed + 7), a3 = lattice(64, seed + 9)
  const pit = lattice(24, seed + 11), fine = lattice(256, seed + 13)
  const c = document.createElement('canvas'); c.width = c.height = size
  const g = c.getContext('2d'), img = g.createImageData(size, size), d = img.data
  const [r0, g0, b0] = hex(color), [r1, g1, b1] = hex(dark)
  const h = new Float32Array(size * size), rough = new Float32Array(size * size)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x, u = x / size, v = y / size
    // the strata: noise stretched eight to one along x (each lattice tiles over its own cells)
    const strata = value(a0, 4, u * 4, v * 32) * 0.45 + value(a1, 8, u * 8, v * 64) * 0.3 + value(a2, 16, u * 16, v * 128) * 0.15 + value(a3, 64, u * 64, v * 128) * 0.1
    // thin, faint seams between the strata: horizontal bands, gently bent by the noise
    const line = Math.pow(1 - Math.abs(Math.sin((v * 9 + (strata - 0.5) * 0.3) * Math.PI)), 18) * 0.24 * bands
    const tone = (strata - 0.5) * 0.08 * bands
    // the pits: a few elongated holes where the coarse noise peaks, gathered along some strata
    const p = value(pit, 24, u * 24, v * 96)
    const along = Math.max(0, (strata - 0.52) / 0.2)
    const hole = pits * Math.max(0, (p - 0.9 + 0.05 * along) / 0.07)
    const grain = (value(fine, 256, u * 256, v * 256) - 0.5) * 0.04
    let k = 1 + tone + grain
    const dk = Math.min(1, line + Math.min(1, hole) * 0.55)
    const rr = mix(r0 * k, r1, dk), gg = mix(g0 * k, g1, dk), bb = mix(b0 * k, b1, dk)
    d[i * 4] = Math.min(255, rr * 255); d[i * 4 + 1] = Math.min(255, gg * 255); d[i * 4 + 2] = Math.min(255, bb * 255); d[i * 4 + 3] = 255
    h[i] = 0.6 + tone * 0.15 - line * 0.03 - Math.min(1, hole) * 0.12 + grain * 0.3
    rough[i] = polish + line * 0.1 + Math.min(1, hole) * 0.5 + grain
  }
  g.putImageData(img, 0, 0)
  const rc = document.createElement('canvas'); rc.width = rc.height = size
  const rg = rc.getContext('2d'), rimg = rg.createImageData(size, size)
  for (let i = 0; i < rough.length; i++) { const v = Math.max(0, Math.min(1, rough[i])) * 255; rimg.data[i * 4] = v; rimg.data[i * 4 + 1] = v; rimg.data[i * 4 + 2] = v; rimg.data[i * 4 + 3] = 255 }
  rg.putImageData(rimg, 0, 0)
  return { map: texture(c, true), normalMap: texture(normalMap(h, size, 2.5), false), roughnessMap: texture(rc, false) }
}

// ------------------------------------------------------------------ outside: a palm
// A palm crown drawn on a transparent canvas: fronds radiating from the top of a trunk, each a
// drooping rib with leaflets. Seen through a window it is the palm outside; between the sun and
// the window it throws the dappled shadow of its fronds into the room.
function palmCanvas(size = 1024, seed = 5) {
  const c = document.createElement('canvas'); c.width = c.height = size
  const g = c.getContext('2d')
  let s = seed >>> 0 || 1
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
  g.fillStyle = '#2f5a2c'
  const cx = size * 0.5, cy = size * 0.3
  // the trunk, slightly curved
  g.strokeStyle = '#4a3a2a'; g.lineWidth = size * 0.028; g.lineCap = 'round'
  g.beginPath(); g.moveTo(cx + size * 0.06, size); g.quadraticCurveTo(cx + size * 0.04, size * 0.6, cx, cy); g.stroke()
  const fronds = 11
  for (let f = 0; f < fronds; f++) {
    const a = -Math.PI * 0.95 + (f / (fronds - 1)) * Math.PI * 1.9 + (rnd() - 0.5) * 0.25
    const L = size * (0.3 + rnd() * 0.14)
    const droop = 0.35 + rnd() * 0.3
    // the rib: from the crown outward, bending down
    const pts = []
    for (let t = 0; t <= 1; t += 0.04) {
      const x = cx + Math.cos(a) * L * t, y = cy + Math.sin(a) * L * t + droop * L * t * t
      pts.push([x, y])
    }
    g.strokeStyle = '#2f5a2c'; g.lineWidth = size * 0.006
    g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.stroke()
    // the leaflets, both sides, shorter towards the tip, hanging a little
    for (let i = 2; i < pts.length - 1; i++) {
      const [x, y] = pts[i], [x2, y2] = pts[i + 1]
      const dir = Math.atan2(y2 - y, x2 - x), t = i / pts.length
      const len = size * 0.075 * (1 - t * 0.6) * (0.8 + rnd() * 0.4)
      for (const side of [-1, 1]) {
        const ang = dir + side * (0.9 + rnd() * 0.25) + 0.25           // swept back and hanging
        g.beginPath(); g.moveTo(x, y)
        g.lineTo(x + Math.cos(ang) * len * 0.5 + Math.cos(dir) * len * 0.12, y + Math.sin(ang) * len * 0.5 + Math.sin(dir) * len * 0.12)
        g.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len + len * 0.25)
        g.lineTo(x + Math.cos(dir) * size * 0.012, y + Math.sin(dir) * size * 0.012)
        g.closePath(); g.fill()
      }
    }
  }
  return c
}
// the palm as a plane: `width` mm across; it faces +z (rotate it to face the window)
export function palm({ width = 5000, seed = 5, color = '#3d6d3a' } = {}) {
  const t = new THREE.CanvasTexture(palmCanvas(1024, seed))
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  const m = new THREE.MeshBasicMaterial({ map: t, color, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, toneMapped: false })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, width), m)
  mesh.castShadow = true
  mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: t, alphaTest: 0.5, side: THREE.DoubleSide })
  return mesh
}

// ------------------------------------------------------------------ props
const cloth = (color = '#f3f0ea') => new THREE.MeshStandardMaterial({ color, roughness: 1 })
const teak = () => new THREE.MeshStandardMaterial({ color: '#9a7046', roughness: 0.6 })
const shadowed = o => { o.traverse(x => { if (x.isMesh) { x.castShadow = true; x.receiveShadow = true } }); return o }

// A monstera in a pot: a few large lobed leaves on stems, leaning out
export function monstera({ height = 1100, leaves = 7, seed = 3, pot = '#d9cfc0' } = {}) {
  let s = seed >>> 0 || 1
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
  const g = new THREE.Group()
  const potMesh = new THREE.Mesh(new THREE.CylinderGeometry(190, 150, 380, 32), new THREE.MeshStandardMaterial({ color: pot, roughness: 0.75 }))
  potMesh.position.y = 190
  const soil = new THREE.Mesh(new THREE.CylinderGeometry(180, 180, 10, 32), new THREE.MeshStandardMaterial({ color: '#3a2d22', roughness: 1 }))
  soil.position.y = 376
  g.add(potMesh, soil)
  const leafMat = new THREE.MeshStandardMaterial({ color: '#3b6a37', roughness: 0.55, side: THREE.DoubleSide })
  const stemMat = new THREE.MeshStandardMaterial({ color: '#4d7a44', roughness: 0.7 })
  // the leaf outline: a broad heart with deep lobes down both sides
  const shape = new THREE.Shape()
  const N = 72
  for (let i = 0; i <= N; i++) {
    const a = i / N * Math.PI * 2 - Math.PI / 2
    const lobes = 1 - 0.38 * Math.pow(Math.abs(Math.sin(a * 2.5 + 0.4)), 7) * (Math.cos(a) > -0.3 ? 1 : 0.2)
    const heart = 0.62 + 0.38 * Math.abs(Math.cos(a / 2 + Math.PI / 4))
    const r = 170 * lobes * heart
    const x = Math.cos(a) * r * 0.8, y = Math.sin(a) * r + 90
    i ? shape.lineTo(x, y) : shape.moveTo(x, y)
  }
  const leafGeo = new THREE.ShapeGeometry(shape, 6)
  for (let i = 0; i < leaves; i++) {
    const yaw = i / leaves * Math.PI * 2 + rnd() * 0.5, tilt = 0.5 + rnd() * 0.5, len = height * (0.55 + rnd() * 0.45) - 380
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(7, 9, len, 8), stemMat)
    stem.position.set(0, 380 + len / 2, 0)
    const pivot = new THREE.Group(); pivot.position.y = 380
    pivot.rotation.set(tilt, yaw, 0, 'YXZ')
    stem.position.set(0, len / 2, 0)
    const leaf = new THREE.Mesh(leafGeo, leafMat)
    leaf.position.set(0, len, 0)
    leaf.rotation.set(-Math.PI / 2 + 0.9 + rnd() * 0.3, 0, 0)
    leaf.scale.setScalar(0.8 + rnd() * 0.5)
    pivot.add(stem, leaf)
    g.add(pivot)
  }
  return shadowed(g)
}

// A teak bench of slats on two trestles, with a folded towel on it
export function bench({ width = 900, depth = 380, height = 440, towel = true } = {}) {
  const g = new THREE.Group(), wood = teak()
  const slats = 5, gap = 14, sw = (depth - gap * (slats - 1)) / slats
  for (let i = 0; i < slats; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(width, 32, sw), wood)
    m.position.set(0, height - 16, -depth / 2 + sw / 2 + i * (sw + gap))
    g.add(m)
  }
  for (const x of [-width / 2 + 80, width / 2 - 80]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(40, height - 32, depth - 40), wood)
    leg.position.set(x, (height - 32) / 2, 0)
    g.add(leg)
  }
  if (towel) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(300, 80, 220), cloth())
    t.position.set(width * 0.15, height + 40, 0)
    t.rotation.y = 0.12
    g.add(t)
  }
  return shadowed(g)
}

// A hand towel hanging over a rail on the wall (the rail along x, the towel hanging down)
export function towelRail({ width = 400, color = '#f3f0ea', rail } = {}) {
  const g = new THREE.Group()
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, width + 60, 16), rail || chrome())
  bar.rotation.z = Math.PI / 2
  g.add(bar)
  for (const x of [-width / 2 - 10, width / 2 + 10]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 60, 12), rail || chrome()); p.rotation.x = Math.PI / 2; p.position.set(x, 0, -30); g.add(p) }
  const t = new THREE.Mesh(new THREE.BoxGeometry(width * 0.7, 420, 26), cloth(color))
  t.position.set(0, -205, 4)
  g.add(t)
  return shadowed(g)
}

// A niche in a wall: a recessed box lit by a strip at its top, a couple of bottles inside. The
// caller leaves the opening in the wall (w × h at x, y) and places the group at the wall plane,
// facing +z into the room.
export function niche({ w = 600, h = 320, depth = 110, material, strip = '#fff2dc', lit = 4 } = {}) {
  const g = new THREE.Group()
  const inner = material.clone()
  const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, depth), inner)
  inner.side = THREE.BackSide
  box.position.z = -depth / 2
  box.receiveShadow = true
  const light = cove({ width: w - 40, height: 16, color: strip, intensity: lit, position: [0, h / 2 - 12, -depth * 0.5], lookAt: [0, -h, -depth * 0.5] })
  const bottle = (x, r, hh, color) => {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(r, r, hh, 20), new THREE.MeshPhysicalMaterial({ color, roughness: 0.25, transmission: 0.3, thickness: 20 }))
    b.position.set(x, -h / 2 + hh / 2, -depth * 0.55)
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.45, r * 0.45, 28, 16), new THREE.MeshStandardMaterial({ color: '#1e1e1e', roughness: 0.5 }))
    cap.position.set(x, -h / 2 + hh + 14, -depth * 0.55)
    g.add(b, cap)
  }
  bottle(-w * 0.22, 34, 190, '#dfe6d9'); bottle(w * 0.02, 30, 160, '#c9d6c0'); bottle(w * 0.26, 36, 210, '#eee9dc')
  g.add(box, light)
  g.userData.light = light
  return shadowed(g)
}

// A round backlit mirror: a dark glossy disc that mirrors the room, a ring of light behind it
export function mirrorDisc({ radius = 450, glow = '#fff0d8', lit = 3 } = {}) {
  const g = new THREE.Group()
  const disc = new THREE.Mesh(new THREE.CircleGeometry(radius, 64), new THREE.MeshPhysicalMaterial({ color: '#c9ccd0', metalness: 1, roughness: 0.04, envMapIntensity: 1.2 }))
  // the mirror shows the room only: its own light, a few cm in front of it, would otherwise sit in
  // its centre as a pin-point far brighter than the frame can hold, which the bloom turns into a
  // flickering square
  disc.material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n\treflectedLight.directDiffuse = vec3( 0.0 );\n\treflectedLight.directSpecular = vec3( 0.0 );')
  }
  disc.material.customProgramCacheKey = () => 'mirror-disc'
  disc.position.z = 30
  const back = new THREE.Mesh(new THREE.CylinderGeometry(radius - 30, radius - 30, 26, 64), new THREE.MeshStandardMaterial({ color: '#2a2a2a', roughness: 0.8 }))
  back.rotation.x = Math.PI / 2; back.position.z = 16
  const halo = new THREE.Mesh(new THREE.RingGeometry(radius - 10, radius + 46, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color(glow).multiplyScalar(1.15), transparent: true, opacity: 0.75, toneMapped: false, blending: THREE.AdditiveBlending, depthWrite: false }))
  halo.position.z = 2
  const light = new THREE.PointLight(glow, lit * 2e5, 2600, 2)
  light.position.z = 60
  g.add(disc, back, halo, light)
  g.userData.light = light; g.userData.halo = halo
  return g
}

// A pendant lamp: a slim cord, a cylinder shade, warm light inside
export function pendant({ drop = 900, radius = 110, height = 220, shade = '#1f1f1f', glow = '#ffd9a8', lit = 1 } = {}) {
  const g = new THREE.Group()
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, drop, 8), new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.6 }))
  cord.position.y = -drop / 2
  const shadeMesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 32, 1, true), new THREE.MeshStandardMaterial({ color: shade, roughness: 0.5, metalness: 0.3, side: THREE.DoubleSide }))
  shadeMesh.position.y = -drop - height / 2
  const bulb = new THREE.Mesh(new THREE.CircleGeometry(radius - 4, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(glow).multiplyScalar(3), toneMapped: false }))
  bulb.rotation.x = Math.PI / 2; bulb.position.y = -drop - height + 6
  const light = new THREE.PointLight(glow, lit * 1.6e5, 2800, 2)
  light.position.y = -drop - height - 30
  g.add(cord, shadeMesh, bulb, light)
  shadeMesh.castShadow = true
  g.userData.light = light; g.userData.bulb = bulb
  return g
}

// A window in a wall: the frame, a slim mullion cross, the bright sky plane behind it. Placed on
// the wall plane, facing +z into the room; `w × h` is the opening.
export function windowFrame({ w = 1600, h = 2200, frame = '#f2efe8', sky = 5 } = {}) {
  const g = new THREE.Group()
  const mat = new THREE.MeshStandardMaterial({ color: frame, roughness: 0.55 })
  const bar = (bw, bh, bd, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), mat); m.position.set(x, y, z); m.castShadow = true; g.add(m) }
  bar(w + 120, 60, 70, 0, h / 2 + 30, 0); bar(w + 120, 60, 70, 0, -h / 2 - 30, 0)
  bar(60, h, 70, -w / 2 - 30, 0, 0); bar(60, h, 70, w / 2 + 30, 0, 0)
  bar(w, 24, 30, 0, h * 0.18, 0); bar(24, h, 30, 0, 0, 0)
  const skyMesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(sky, sky, sky * 1.02), toneMapped: false }))
  skyMesh.position.z = -120
  g.add(skyMesh)
  g.userData.sky = skyMesh
  return g
}

// A deck far from the screen gives its frame buffers back: the canvas and the post-processing
// targets shrink to a pixel (textures, shadow map and environment stay), and grow again, with one
// frame drawn, before the deck scrolls back into view. Four WebGL scenes on one page otherwise hold
// hundreds of megabytes of video memory, and the browser runs short of it for painting the page –
// gallery photos stayed blank until the mouse passed over them.
export function parkWhenAway(deck, { signal, renderer, composer, mirror = () => null, resize, draw, margin = '700px 0px' }) {
  const state = { parked: false }
  const io = new IntersectionObserver(([entry]) => {
    if (entry.isIntersecting && state.parked) {
      state.parked = false
      resize()
      draw()
    } else if (!entry.isIntersecting && !state.parked) {
      state.parked = true
      renderer.setSize(2, 2, false)
      composer.setSize(2, 2)
      mirror()?.resize(1, 1)
    }
  }, { rootMargin: margin })
  io.observe(deck)
  signal?.addEventListener('abort', () => io.disconnect())
  return state
}
