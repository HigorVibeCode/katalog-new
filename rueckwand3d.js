// Live 3D kitchen deck: the splashback combinations as back-painted glass panels behind the
// worktop of a kitchen. The front of the glass is smooth and glossy; behind it lie the structure
// and the relief, painted in one colour or a Verlauf, the relief optionally in an accent colour.
// The LED is not in the glass: it sits under the wall cabinets (or the shelf) and grazes the
// panel from above, so the structure and the relief catch the light. Textures come from
// scripts/rueckwand-textures.py (n-*, s-*, n-r-*, s-r-*, a-*), the combinations from
// scripts/rueckwand-combinations.py.
import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { LED } from './deck3d.js'

export { LED }
const CW = 3600, CH = 1500                                // the textures cover 3600 × 1500 mm, worktop at the bottom
const FLOOR = -900, CEILING = 1500                        // worktop at 0, 900 mm above the floor; 2400 mm room
const LED_Y = 650                                         // the light line under the wall cabinets or the shelf
const GAP = 1500                                          // plain wall between two kitchens
const viewWidth = W => 1200 + 0.8 * W                     // true scale, but a narrow panel is not lost
const smoothstep = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t) }
// a sharp highlight can exceed what the half-float bloom buffers hold and turn the frame black
const capped = m => {
  const before = m.onBeforeCompile
  m.onBeforeCompile = (shader, renderer) => {
    if (before !== THREE.Material.prototype.onBeforeCompile) before.call(m, shader, renderer)
    shader.fragmentShader = shader.fragmentShader.replace('#include <dithering_fragment>', 'gl_FragColor.rgb = min( gl_FragColor.rgb, vec3( 64.0 ) );\n\t#include <dithering_fragment>')
  }
  const key = m.customProgramCacheKey.bind(m)
  m.customProgramCacheKey = () => key() + '-capped'
  return m
}

// tiles: the kitchen before, with a tiled splashback instead of the glass (Vorher)
// view: a fixed close view { x, y, d } instead of the whole kitchen (for the before / after pictures)
export async function initRueckwand3D({ deck, combos, base = 'img/rueckwand/', onIndex, reduced = false, start = 0, tiles = false, view = null }) {
  const canvas = document.createElement('canvas')
  canvas.className = 'deck-canvas'
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
  if (!renderer.capabilities.isWebGL2) throw new Error('WebGL2 nicht verfügbar')
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap

  const scene = new THREE.Scene()
  scene.environment = kitchenEnv(renderer)
  const room = roomShell()
  scene.add(room.group)
  // daylight from a window on the left, in front of the kitchen
  const sun = new THREE.DirectionalLight('#fff4e8', 2.0)
  sun.position.set(-1800, 2600, 3200)
  sun.target.position.set(0, 300, 0)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  Object.assign(sun.shadow.camera, { left: -2600, right: 2600, top: 2200, bottom: -2200, near: 500, far: 9000 })
  sun.shadow.radius = 7
  sun.shadow.bias = -0.0005
  const sky = new THREE.HemisphereLight('#eef0ef', '#2a2a2a', 0.6)
  const fill = new THREE.DirectionalLight('#eef2f5', 0.5)           // the room behind the camera
  fill.position.set(2600, 1400, 3400)
  scene.add(sun, sun.target, sky, fill)

  const camera = new THREE.PerspectiveCamera(30, 1, 50, 40000)
  const target = new THREE.Vector3(0, 300, 300)
  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.45, 0.82)
  composer.addPass(bloom)
  composer.addPass(new OutputPass())

  const loader = new THREE.TextureLoader()
  const cache = new Map()
  const texture = url => {
    if (!cache.has(url)) cache.set(url, new Promise((resolve, reject) => loader.load(url, t => {
      t.colorSpace = THREE.NoColorSpace
      t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
      resolve(t)
    }, undefined, reject)))
    return cache.get(url)
  }
  const flat = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1); flat.needsUpdate = true
  const black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); black.needsUpdate = true

  const ledA = new THREE.Color(), ledB = new THREE.Color(), ledMid = new THREE.Color()
  const shared = { ledA: { value: ledA }, ledB: { value: ledB } }
  let ledEnabled = false

  // The panel: back-painted glass. The paint (with the structure and the relief in it) is the
  // base layer; the smooth glass in front is a clear coat that mirrors the kitchen.
  const panelMaterial = (combo, maps) => {
    const k = combo.s ? (combo.s === 'minimal' ? 1.1 : 1.6) : 0
    const m = new THREE.MeshPhysicalMaterial({
      color: '#ffffff', roughness: 0.62, metalness: 0, specularIntensity: 0.25,
      clearcoat: 1, clearcoatRoughness: 0.025, normalMap: maps.ns, normalScale: new THREE.Vector2(k, k), envMapIntensity: 1,
    })
    const own = {
      paintA: { value: new THREE.Color(combo.a) }, paintB: { value: new THREE.Color(combo.b || combo.a) },
      accent: { value: new THREE.Color(combo.ak || combo.a) }, accentOn: { value: combo.ak ? 1 : 0 },
      reliefMap: { value: maps.nr }, accentMap: { value: maps.am }, escS: { value: maps.ss }, escR: { value: maps.sr },
      reliefScale: { value: combo.r ? 2.2 : 0 }, panelW: { value: combo.w }, ledY: { value: LED_Y }, ledOn: { value: 0 }, shade: { value: 1 },
    }
    m.userData.uniforms = own
    const normalChunk = THREE.ShaderChunk.normal_fragment_maps.replace('mapN.xy *= normalScale;', `mapN.xy *= normalScale * ( 1.0 - 0.9 * acc.g );
	vec3 rN = texture2D( reliefMap, vPlan ).xyz * 2.0 - 1.0;
	mapN.xy += rN.xy * reliefScale;
	relief = mapN.xy;`)
    m.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, own, shared)
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vPlan;\nvarying float vH;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\n\tvPlan = uv;\n\tvH = position.y;')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec2 vPlan; varying float vH;
uniform vec3 paintA; uniform vec3 paintB; uniform vec3 accent; uniform float accentOn;
uniform sampler2D reliefMap; uniform sampler2D accentMap; uniform sampler2D escS; uniform sampler2D escR;
uniform float reliefScale; uniform float panelW; uniform float ledY; uniform float ledOn; uniform float shade;
uniform vec3 ledA; uniform vec3 ledB;
vec2 relief = vec2( 0.0 );
vec4 acc = vec4( 0.0 );
float px = 0.0;
float hash12( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * 0.1031 ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.x + p3.y ) * p3.z ); }
float vnoise( vec2 p ) { vec2 i = floor( p ), f = fract( p ); vec2 u = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( hash12( i ), hash12( i + vec2( 1.0, 0.0 ) ), u.x ), mix( hash12( i + vec2( 0.0, 1.0 ) ), hash12( i + vec2( 1.0, 1.0 ) ), u.x ), u.y ); }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
	px = clamp( ( vPlan.x * ${CW.toFixed(1)} - ( ${(CW / 2).toFixed(1)} - panelW * 0.5 ) ) / panelW, 0.0, 1.0 );
	acc = texture2D( accentMap, vPlan );
	// seen through 6 mm of glass: a faint green
	diffuseColor.rgb *= mix( paintA, paintB, smoothstep( 0.1, 0.9, px ) ) * vec3( 0.95, 0.985, 0.97 );
	diffuseColor.rgb = mix( diffuseColor.rgb, accent * vec3( 0.95, 0.985, 0.97 ), smoothstep( 0.3, 0.75, acc.r ) * accentOn );
	// hand-applied paint is never perfectly even: a faint cloudiness, a little denser at the edges
	float cloud = vnoise( vPlan * vec2( 34.0, 14.0 ) ) * 0.6 + vnoise( vPlan * vec2( 110.0, 46.0 ) ) * 0.4;
	float edge = min( min( px, 1.0 - px ) * panelW, vH ) ;
	diffuseColor.rgb *= ( 0.975 + 0.05 * cloud ) * ( 0.94 + 0.06 * smoothstep( 0.0, 60.0, edge ) );`)
        .replace('#include <normal_fragment_maps>', normalChunk)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
	{
		// the relief and the structure catch the daylight from the upper left
		diffuseColor.rgb *= clamp( 1.0 + 1.5 * dot( relief, normalize( vec2( -0.45, 0.9 ) ) ), 0.55, 1.5 );
		// the LED under the cabinets: a pool of light from the top edge down, grazing the glass
		float below = ledY - vH;
		float fall = below >= 0.0 ? exp( - below / 330.0 ) : exp( below / 70.0 ) * 0.35;
		float esc = texture2D( escS, vPlan ).r * ( 1.0 - 0.9 * acc.g ) + texture2D( escR, vPlan ).r * 1.3;
		vec3 led = mix( ledA, ledB, px );
		totalEmissiveRadiance += led * ledOn * fall * ( 0.05 + 2.6 * esc + 0.9 * diffuseColor.rgb );
	}`)
        .replace('#include <dithering_fragment>', `gl_FragColor.rgb *= shade;
	#include <dithering_fragment>`)
    }
    m.customProgramCacheKey = () => 'rueckwand-panel-2'
    return capped(m)
  }

  // Vorher: glossy white tiles, 100 × 100 mm, grey joints
  const tileMaterial = () => {
    const c = document.createElement('canvas'); c.width = c.height = 256
    const g = c.getContext('2d')
    g.fillStyle = '#9d9a94'; g.fillRect(0, 0, 256, 256)
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
      const v = 232 + Math.floor(Math.random() * 10)
      g.fillStyle = `rgb(${v},${v},${v - 4})`; g.fillRect(x * 128 + 3, y * 128 + 3, 122, 122)
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(CW / 200, CH / 200)
    const m = new THREE.MeshPhysicalMaterial({ map: t, roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.15 })
    m.userData.uniforms = { ledOn: { value: 0 }, shade: { value: 1 } }
    return m
  }

  const fronts = { Weiss: new THREE.MeshStandardMaterial({ color: '#e7e5df', roughness: 0.55 }), Anthrazit: new THREE.MeshStandardMaterial({ color: '#2f3134', roughness: 0.6 }),
    Eiche: wood('#9b7a52'), Salbei: new THREE.MeshStandardMaterial({ color: '#7f8f78', roughness: 0.6 }), Schwarz: new THREE.MeshStandardMaterial({ color: '#141516', roughness: 0.5 }) }
  const tops = { 'Stein dunkel': stone('#1c1d1e', 'rgba(205,205,200,', 'rgba(150,150,145,', 0.32), 'Stein hell': stone('#dad6cd', 'rgba(120,115,108,', 'rgba(255,255,250,', 0.3),
    Eiche: wood('#a8875c', 1 / 900) }
  const alu = capped(new THREE.MeshStandardMaterial({ color: '#c9ccce', metalness: 0.8, roughness: 0.35, envMapIntensity: 1.3 }))
  const carcass = new THREE.MeshStandardMaterial({ color: '#1b1b1b', roughness: 0.9 })
  const steel = capped(new THREE.MeshStandardMaterial({ color: '#e4e6e7', metalness: 0.85, roughness: 0.38, envMapIntensity: 1.6 }))
  const chrome = capped(new THREE.MeshStandardMaterial({ color: '#ffffff', metalness: 1, roughness: 0.08, envMapIntensity: 1.4 }))
  const sinkInside = new THREE.MeshStandardMaterial({ color: '#b9bcbd', metalness: 0.9, roughness: 0.3, side: THREE.BackSide })
  const hobMat = hob()
  const edgeMat = new THREE.MeshPhysicalMaterial({ color: '#9fd6c2', roughness: 0.1, emissive: '#2e6a56', emissiveIntensity: 0.2 })

  // One kitchen per combination, built when it comes near the front and released when far away.
  const panels = combos.map((combo, i) => ({ combo, i, w: combo.w, group: null, loading: false }))
  const xs = [0]
  for (let i = 1; i < panels.length; i++) xs.push(xs[i - 1] + (panels[i - 1].w + panels[i].w) / 2 + GAP)
  const build = async panel => {
    panel.loading = true
    const { combo } = panel
    const W = combo.w, H = combo.h
    const [ns, ss, nr, sr, am] = await Promise.all([
      combo.s ? texture(`${base}n-${combo.s}.webp`) : flat,
      combo.s ? texture(`${base}s-${combo.s}.webp`) : black,
      combo.r ? texture(`${base}n-r-${combo.r}.webp`) : flat,
      combo.r ? texture(`${base}s-r-${combo.r}.webp`) : black,
      combo.r ? texture(`${base}a-${combo.r}.webp`) : black,
    ])
    const mats = []
    const own = mat => { mats.push(mat); return mat }
    const glass = own(tiles ? tileMaterial() : panelMaterial(combo, { ns, ss, nr, sr, am }))
    const group = new THREE.Group()
    const add = (mesh, cast = true, receive = true) => { mesh.castShadow = cast; mesh.receiveShadow = receive; group.add(mesh); return mesh }
    const box = (w, h, d, x, y, z, mat) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); return add(m) }

    // the glass panel, on the wall from the worktop up
    const t = combo.t || 6
    const pg = new THREE.PlaneGeometry(W, H, 1, 1)
    const uv = pg.attributes.uv, pp = pg.attributes.position
    for (let i = 0; i < pp.count; i++) uv.setXY(i, (pp.getX(i) + CW / 2) / CW, (pp.getY(i) + H / 2) / CH)
    pg.translate(0, H / 2, 0)
    const panelMesh = add(new THREE.Mesh(pg, glass), false, true)
    panelMesh.position.z = t
    box(W, H, t - 0.5, 0, H / 2, (t - 0.5) / 2, edgeMat).receiveShadow = false
    // sockets in cut-outs of the glass
    for (const sx of [-W / 2 + 420, W / 2 - 520]) socketPair(group, sx, 230, t, combo.fronten === 'Weiss' || combo.fronten === 'Eiche' ? '#f2f1ec' : '#2a2b2c')

    // base cabinets with worktop, sink and hob
    const sinkX = -W * 0.24, hobX = W * 0.2
    box(W, 760, 560, 0, -40 - 380, 280, carcass)
    box(W, 100, 520, 0, FLOOR + 50, 260, carcass)
    const n = Math.max(2, Math.round(W / 600)), fw = W / n
    const handles = combo.fronten === 'Eiche' || combo.fronten === 'Salbei'
    // handleless fronts sit lower and leave an aluminium grip channel under the worktop
    const drop = handles ? 0 : 32
    if (!handles) {
      box(W, 30, 6, 0, -40 - 17, 548, alu).castShadow = false
      box(W, 3, 26, 0, -40 - 2, 560, alu).castShadow = false
      box(W, 24, 6, 0, -40 - 182 - drop - 12, 548, alu).castShadow = false
    }
    for (let j = 0; j < n; j++) {
      const x = -W / 2 + fw * (j + 0.5)
      box(fw - 3, 176 - drop * 0.5, 19, x, -40 - 3 - drop - (176 - drop * 0.5) / 2, 570, fronts[combo.fronten])
      box(fw - 3, 576 - drop * 0.5 - 24 * !handles, 19, x, -40 - 182 - drop - 24 * !handles - 3 - (576 - drop * 0.5 - 24 * !handles) / 2, 570, fronts[combo.fronten])
      if (handles) {
        const L = Math.min(fw * 0.45, 320)
        for (const hy of [-40 - 3 - 88, -40 - 182 - 3 - 70]) bar(group, x, hy, 580, L, alu)
      }
    }
    const top = new THREE.Shape([[-W / 2, 0], [W / 2, 0], [W / 2, -640], [-W / 2, -640]].map(([x, y]) => new THREE.Vector2(x, y)))
    top.holes.push(new THREE.Path([[sinkX - 250, -150], [sinkX - 250, -550], [sinkX + 250, -550], [sinkX + 250, -150]].map(([x, y]) => new THREE.Vector2(x, y))))
    const topGeo = new THREE.ExtrudeGeometry(top, { depth: 40, bevelEnabled: true, bevelSize: 1.5, bevelThickness: 1.5, bevelSegments: 1 })
    const topMesh = add(new THREE.Mesh(topGeo, tops[combo.platte]))
    topMesh.rotation.x = -Math.PI / 2
    topMesh.position.y = -41.5
    box(500, 190, 400, sinkX, -95, 350, sinkInside).castShadow = false
    for (const [w, d, x, z] of [[530, 15, sinkX, 142], [530, 15, sinkX, 558], [15, 400, sinkX - 258, 350], [15, 400, sinkX + 258, 350]]) box(w, 2, d, x, 1, z, alu).castShadow = false
    const plug = new THREE.Mesh(new THREE.CylinderGeometry(32, 32, 2, 32), alu); plug.position.set(sinkX + 120, -188, 430); group.add(plug)
    const tap = mixer(chrome); tap.position.set(sinkX, 0, 95); group.add(tap)
    box(600, 5, 520, hobX, 2, 330, hobMat).castShadow = false

    // above: wall cabinets (niche) or a shelf and a hood (up to the ceiling)
    const ledStrip = own(new THREE.MeshBasicMaterial({ color: '#3a3c3d', toneMapped: false }))
    if (combo.format === 'hoch') {
      const hoodW = 900
      for (const side of [-1, 1]) {
        const x0 = side < 0 ? -W / 2 : hobX + hoodW / 2 + 60, x1 = side < 0 ? hobX - hoodW / 2 - 60 : W / 2
        if (x1 - x0 < 300) continue
        box(x1 - x0, 32, 260, (x0 + x1) / 2, LED_Y + 16, t + 130, fronts.Eiche)
        box(x1 - x0 - 30, 6, 12, (x0 + x1) / 2, LED_Y - 3, t + 60, ledStrip).castShadow = false
        decor(group, x0, x1, LED_Y + 32, t)
      }
      box(hoodW, 70, 500, hobX, LED_Y + 35, t + 250, steel)
      box(hoodW - 40, 4, 440, hobX, LED_Y - 2, t + 250, ledStrip).castShadow = false
      box(320, CEILING - LED_Y - 70, 300, hobX, (CEILING + LED_Y + 70) / 2, t + 150, steel)
    } else {
      box(W, 720, 330, 0, LED_Y + 360, t + 165, carcass)
      for (let j = 0; j < n; j++) box(fw - 3, 714, 19, -W / 2 + fw * (j + 0.5), LED_Y + 360, t + 340, fronts[combo.fronten])
      box(W - 40, 6, 12, 0, LED_Y - 3, t + 50, ledStrip).castShadow = false
    }
    // soft contact shadows where the glass meets the worktop and the cabinets, and under the plinth
    shade(group, W, 70, 0, 35, t + 0.8, 0, 0.32)
    shade(group, W, 80, 0, 0.8, 40, Math.PI / 2, 0.28)
    const aoTop = combo.format === 'hoch' ? null : shade(group, W, 140, 0, LED_Y - 70, t + 0.8, Math.PI, 0.3)
    shade(group, W + 600, 140, 300, FLOOR + 0.8, 590, Math.PI / 2, 0.35)
    props(group, panel.i, W, t, sinkX, hobX, fronts.Eiche)
    // a tall unit closes the kitchen on the right
    box(600, CEILING - FLOOR - 100, 560, W / 2 + 300, (CEILING + FLOOR) / 2 - 50, 280, carcass)
    box(597, 1870, 19, W / 2 + 300, FLOOR + 100 + 935 + 1.5, 570, fronts[combo.fronten])
    box(597, CEILING - FLOOR - 100 - 1876, 19, W / 2 + 300, FLOOR + 100 + 1870 + (CEILING - FLOOR - 100 - 1870) / 2 + 3, 570, fronts[combo.fronten])
    // the light the LED throws on the worktop
    const glow = room.glow(W)
    group.add(glow)
    scene.add(group)
    Object.assign(panel, { group, glow, aoTop, glass, u: glass.userData.uniforms, ledStrip, mats, loading: false })
    invalidate()
  }
  const release = panel => {
    if (!panel.group) return
    scene.remove(panel.group)
    panel.group.traverse(o => { if (o.geometry) o.geometry.dispose() })
    panel.mats.forEach(mat => mat.dispose()); panel.glow.material.dispose()
    Object.assign(panel, { group: null, glow: null, glass: null, u: null, ledStrip: null, mats: null })
  }

  // LED: the same lights as the glass walls and the lavabos, only the kitchen in front is lit
  let led = 0, autoLed = false
  const AUTO_STOPS = ['#b24dff', '#4d6bff', '#18d8f0', '#2fe0a0', '#ffbe73', '#ff5fa8'].map(c => new THREE.Color(c))
  const AUTO_STEP = 3500
  const autoColor = (t, out) => {
    const n = AUTO_STOPS.length, x = ((t % n) + n) % n, i = Math.floor(x), f = smoothstep(0, 1, x - i)
    return out.copy(AUTO_STOPS[i]).lerp(AUTO_STOPS[(i + 1) % n], f)
  }
  const updateAuto = now => {
    autoColor(now / AUTO_STEP, ledA); autoColor(now / AUTO_STEP + 0.6, ledB)
    ledMid.copy(ledA).lerp(ledB, 0.5)
  }
  const setLight = n => {
    led = (n + LED.length) % LED.length
    const { a, b, auto } = LED[led]
    autoLed = Boolean(auto)
    ledEnabled = Boolean(a) || autoLed
    if (autoLed) updateAuto(performance.now())
    else if (ledEnabled) { ledA.set(a); ledB.set(b); ledMid.copy(ledA).lerp(ledB, 0.5) }
    // evening: the room light dimmed, the LED carries the picture
    sun.intensity = ledEnabled ? 0.35 : 2.0
    sky.intensity = ledEnabled ? 0.14 : 0.6
    scene.environmentIntensity = ledEnabled ? 0.4 : 1
    room.setLit(!ledEnabled)
    bloom.strength = ledEnabled ? 0.55 : 0.18
    invalidate()
    return LED[led]
  }
  const lightPanel = (panel, front) => {
    const f = ledEnabled ? front : 0
    panel.u.ledOn.value = f
    if (f > 0.01) panel.ledStrip.color.copy(ledMid).multiplyScalar(0.6 + 2.4 * f)
    else panel.ledStrip.color.set(ledEnabled ? '#202122' : '#3a3c3d')
    panel.glow.material.color.copy(ledMid).multiplyScalar(0.3 * f)
    if (panel.aoTop) panel.aoTop.material.opacity = 0.3 * (1 - f)          // the LED lights the corner the cabinets shade
    panel.glow.visible = f > 0.01
  }

  // Layout: the kitchens side by side along one wall; the deck slides along it.
  let pos = start, aim = start, shown = -1, sway = 0, idleSince = performance.now(), spin = null
  const along = p => {
    const i = Math.max(0, Math.min(panels.length - 1, Math.floor(p))), j = Math.min(panels.length - 1, i + 1)
    return xs[i] + (xs[j] - xs[i]) * (p - i)
  }
  const place = () => {
    const here = along(Math.max(0, Math.min(panels.length - 1, pos)))
    panels.forEach(panel => {
      const d = panel.i - pos, ad = Math.abs(d)
      if (ad < 2.6 && !panel.group && !panel.loading) build(panel).catch(() => { panel.loading = false })
      if (ad > 8) release(panel)
      if (!panel.group) return
      const x = xs[panel.i] - here
      panel.group.visible = Math.abs(x) < 6000
      panel.group.position.set(x, 0, 0)
      const front = 1 - smoothstep(0.12, 0.8, ad)
      lightPanel(panel, front)
      panel.u.shade.value = 1 - Math.min(ad * 0.5, 0.65)
    })
    const index = Math.round(Math.min(panels.length - 1, Math.max(0, pos)))
    if (index !== shown) { shown = index; onIndex?.(index) }
  }
  // camera: from the front, standing in the kitchen, a little above the worktop
  const fit = p => {
    const i = Math.max(0, Math.min(panels.length - 1, Math.floor(p))), j = Math.min(panels.length - 1, i + 1), f = Math.max(0, Math.min(1, p - i))
    const at = k => {
      const c = panels[k].combo, half = THREE.MathUtils.degToRad(camera.fov / 2)
      const tall = c.format === 'hoch' ? 2300 : 1900
      return Math.max(viewWidth(c.w) / 2 / (Math.tan(half) * camera.aspect), tall / 2 / Math.tan(half))
    }
    return at(i) + (at(j) - at(i)) * smoothstep(0, 1, f)
  }
  const aimCamera = () => {
    if (view) {
      target.set(view.x, view.y, 300)
      camera.position.set(view.x + Math.sin(0.1) * view.d, 680, 300 + Math.cos(0.1) * view.d)
      camera.lookAt(target)
      return
    }
    const d = fit(pos)
    const c = panels[Math.round(Math.max(0, Math.min(panels.length - 1, pos)))].combo
    target.set(0, c.format === 'hoch' ? 380 : 180, 300)
    // standing in the kitchen: the eye about 1.6 m above the floor, whatever the distance
    const a = 0.1 + sway
    camera.position.set(target.x + Math.sin(a) * d, 680, target.z + Math.cos(a) * d)
    camera.lookAt(target)
  }

  let visible = false, frame = 0, dirty = true, last = 0
  const invalidate = () => { dirty = true; if (!frame && visible) frame = requestAnimationFrame(tick) }
  const tick = now => {
    frame = 0
    const dt = Math.min(100, last ? now - last : 16)
    last = now
    const moving = Math.abs(aim - pos) > 0.0005 || drag || spin
    if (spin) {
      const t = Math.min(1, (now - spin.t0) / spin.dur)
      pos = spin.from + (spin.to - spin.from) * (1 - Math.pow(1 - t, 4))
      if (t >= 1) { pos = aim = spin.to; spin = null }
    } else if (!drag) pos += (aim - pos) * (reduced ? 1 : 1 - Math.exp(-dt / 105))
    if (!spin && Math.abs(aim - pos) < 0.0005) pos = aim
    const idle = now - idleSince
    const swaying = !reduced && !moving && idle < 14000
    sway = swaying ? Math.sin(idle / 1900) * 0.07 * Math.min(1, idle / 1200) : sway * 0.9
    const animating = moving || swaying || dirty || Math.abs(sway) > 0.001
    if (animating || autoLed) {
      if (autoLed) updateAuto(now)
      aimCamera()
      place()
      composer.render()
      dirty = false
      if (visible) frame = animating ? requestAnimationFrame(tick) : setTimeout(() => { frame = requestAnimationFrame(tick) }, 45)
    } else last = 0
  }
  const wake = () => { idleSince = performance.now(); invalidate() }
  const goTo = i => {
    spin = null
    aim = Math.max(0, Math.min(panels.length - 1, i))
    wake()
  }
  const random = () => {
    const here = Math.round(aim), n = panels.length
    const options = []
    for (let d = 3; d <= 8; d++) for (const to of [here - d, here + d]) if (to >= 0 && to < n) options.push(to)
    const to = options[Math.floor(Math.random() * options.length)]
    if (reduced) return goTo(to)
    const lo = Math.max(0, Math.min(here, to) - 1), hi = Math.min(n - 1, Math.max(here, to) + 1)
    const pending = panels.slice(lo, hi + 1).filter(p => !p.group).map(p => p.loading ? new Promise(r => { const t = setInterval(() => { if (p.group || !p.loading) { clearInterval(t); r() } }, 50) }) : build(p).catch(() => {}))
    Promise.all(pending).then(() => {
      aim = to
      spin = { from: pos, to, t0: performance.now(), dur: Math.min(2800, 1100 + Math.abs(to - pos) * 70) }
      wake()
    })
    return to
  }

  let drag = null
  deck.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return
    spin = null
    drag = { x: e.clientX, start: pos, lastX: e.clientX, lastT: performance.now(), v: 0, moved: false, id: e.pointerId }
    aim = pos
  })
  deck.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return
    const dx = e.clientX - drag.x
    if (!drag.moved && Math.abs(dx) > 6) { drag.moved = true; deck.setPointerCapture(e.pointerId) }
    if (!drag.moved) return
    const now = performance.now()
    drag.v = (e.clientX - drag.lastX) / Math.max(1, now - drag.lastT)
    drag.lastX = e.clientX; drag.lastT = now
    let next = drag.start - dx / (deck.clientWidth * 0.6)
    if (next < 0) next *= 0.3
    if (next > panels.length - 1) next = panels.length - 1 + (next - panels.length + 1) * 0.3
    pos = aim = next
    wake()
  })
  const end = e => {
    if (!drag || e.pointerId !== drag.id) return
    const moved = drag.moved, v = drag.v
    drag = null
    if (moved) goTo(Math.round(pos + Math.max(-3, Math.min(3, -v * 160 / (deck.clientWidth * 0.6)))))
    else {
      const x = (e.clientX - deck.getBoundingClientRect().left) / deck.clientWidth
      goTo(Math.round(pos) + (x < 0.33 ? -1 : 1))
    }
  }
  deck.addEventListener('pointerup', end)
  deck.addEventListener('pointercancel', e => { if (drag) { drag.moved = true; drag.v = 0; end(e) } })
  deck.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight') { e.preventDefault(); goTo(Math.round(aim) + 1) }
    if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(Math.round(aim) - 1) }
    if (e.key === 'Home') { e.preventDefault(); goTo(0) }
    if (e.key === 'End') { e.preventDefault(); goTo(panels.length - 1) }
  })

  const resize = () => {
    const w = deck.clientWidth, h = deck.clientHeight
    renderer.setSize(w, h, false)
    composer.setPixelRatio(renderer.getPixelRatio())
    composer.setSize(w, h)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    invalidate()
  }
  new ResizeObserver(resize).observe(deck)
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting
    if (visible) wake()
    else if (frame) { cancelAnimationFrame(frame); clearTimeout(frame); frame = 0 }
  }, { rootMargin: '200px' }).observe(deck)

  deck.prepend(canvas)
  deck.classList.add('is-3d')
  resize()
  await Promise.all(panels.slice(Math.max(0, start - 1), start + 2).map(p => build(p)))
  setLight(LED.length - 1)
  aimCamera()
  place()
  composer.render()
  canvas.classList.add('is-ready')
  wake()
  return { setLight, light: () => led, random, step: d => goTo(Math.round(aim) + d), goTo }
}

// ------------------------------------------------------------------ kitchen parts

// a kitchen mixer: a round body and a high arched spout over the sink, a lever on the side
function mixer(material) {
  const g = new THREE.Group()
  const add = mesh => { mesh.castShadow = true; g.add(mesh); return mesh }
  const body = [[0, 0], [30, 0], [30, 4], [26, 10], [24, 20], [23, 120], [0, 120]]
  add(new THREE.Mesh(new THREE.LatheGeometry(body.map(([r, y]) => new THREE.Vector2(r, y)), 40), material))
  const spout = new THREE.CubicBezierCurve3(new THREE.Vector3(0, 115, 0), new THREE.Vector3(0, 420, 0),
    new THREE.Vector3(0, 430, 230), new THREE.Vector3(0, 300, 240))
  add(new THREE.Mesh(new THREE.TubeGeometry(spout, 64, 13, 20, false), material))
  const aerator = add(new THREE.Mesh(new THREE.CylinderGeometry(15, 15, 18, 24), material))
  aerator.position.set(0, 293, 240)
  const lever = add(new THREE.Mesh(new THREE.CapsuleGeometry(6, 70, 6, 14), material))
  lever.rotation.z = 1.35
  lever.position.set(48, 90, 0)
  return g
}

// a bar handle on two small posts
function bar(group, x, y, z, L, material) {
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, L, 16), material)
  rod.rotation.z = Math.PI / 2
  rod.position.set(x, y, z + 28)
  rod.castShadow = true
  group.add(rod)
  for (const dx of [-L / 2 + 14, L / 2 - 14]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, 28, 12), material)
    post.rotation.x = Math.PI / 2
    post.position.set(x + dx, y, z + 14)
    group.add(post)
  }
}

// a darkening that fades out: the contact shadow in a corner
function gradientTexture() {
  const c = document.createElement('canvas'); c.width = 4; c.height = 128
  const g = c.getContext('2d')
  const lin = g.createLinearGradient(0, 128, 0, 0)
  lin.addColorStop(0, 'rgba(0,0,0,1)'); lin.addColorStop(0.35, 'rgba(0,0,0,.35)'); lin.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = lin; g.fillRect(0, 0, 4, 128)
  return new THREE.CanvasTexture(c)
}
let shadowMap = null
// the plane is darkest along its lower edge; rx turns it: 0 upright (dark at the bottom), PI upright
// (dark at the top), PI / 2 lying flat (dark towards the wall)
function shade(group, w, h, x, y, z, rx, opacity) {
  shadowMap ??= gradientTexture()
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ alphaMap: shadowMap, color: '#000000', transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }))
  m.rotation.x = rx
  m.position.set(x, y, z)
  m.renderOrder = 2
  group.add(m)
  return m
}

// a few everyday things, different in each kitchen, kept to the ends so the glass stays free
function props(group, i, W, t, sinkX, hobX, woodMat) {
  const kind = i % 4
  const add = (mesh, x, y, z) => { mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh); return mesh }
  if (kind === 0 || kind === 2) {                                          // a chopping board leaning on the glass
    const r = 34, bw = 290, bh = 410
    const outline = new THREE.Shape()
    outline.moveTo(-bw / 2 + r, -bh / 2); outline.lineTo(bw / 2 - r, -bh / 2); outline.quadraticCurveTo(bw / 2, -bh / 2, bw / 2, -bh / 2 + r)
    outline.lineTo(bw / 2, bh / 2 - r); outline.quadraticCurveTo(bw / 2, bh / 2, bw / 2 - r, bh / 2); outline.lineTo(-bw / 2 + r, bh / 2)
    outline.quadraticCurveTo(-bw / 2, bh / 2, -bw / 2, bh / 2 - r); outline.lineTo(-bw / 2, -bh / 2 + r); outline.quadraticCurveTo(-bw / 2, -bh / 2, -bw / 2 + r, -bh / 2)
    const hole = new THREE.Path(); hole.absarc(0, bh / 2 - 48, 17, 0, Math.PI * 2, true); outline.holes.push(hole)
    const geo = new THREE.ExtrudeGeometry(outline, { depth: 16, bevelEnabled: true, bevelSize: 3, bevelThickness: 3, bevelSegments: 3, curveSegments: 16 })
    geo.scale(1, 1, 1); geo.translate(0, 0, -8)
    const tex = woodMat.map.clone(); tex.repeat.set(1 / 300, 1 / 300); tex.needsUpdate = true
    const board = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }))
    board.rotation.x = -0.12
    add(board, -W / 2 + 205, 206, t + 40)
  }
  if (kind === 0 || kind === 1) {                                          // herbs in a pot
    const pot = add(new THREE.Mesh(new THREE.CylinderGeometry(62, 50, 110, 28), new THREE.MeshStandardMaterial({ color: '#b5674a', roughness: 0.8 })), W / 2 - 170, 55, 260)
    const leafMat = new THREE.MeshStandardMaterial({ color: '#4f7a3f', roughness: 0.7 })
    for (let k = 0; k < 9; k++) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(30 + (k % 3) * 8, 14, 10), leafMat)
      b.scale.set(1, 0.8, 1)
      add(b, W / 2 - 170 + Math.cos(k * 2.4) * 34, 130 + (k % 4) * 18, 260 + Math.sin(k * 2.4) * 34)
    }
    void pot
  }
  if (kind === 1 || kind === 3) {                                          // a bottle of oil between sink and hob
    const x = (sinkX + 250 + hobX - 300) / 2
    add(new THREE.Mesh(new THREE.CylinderGeometry(32, 32, 230, 24), new THREE.MeshPhysicalMaterial({ color: '#c9b04a', roughness: 0.1, transparent: true, opacity: 0.75, clearcoat: 1 })), x, 115, 120)
    add(new THREE.Mesh(new THREE.CylinderGeometry(12, 16, 60, 16), new THREE.MeshStandardMaterial({ color: '#2b2b2b', roughness: 0.4 })), x, 260, 120)
  }
  if (kind === 3) {                                                        // a pair of glasses jars at the right end
    const jar = new THREE.MeshPhysicalMaterial({ color: '#e8efec', roughness: 0.05, transparent: true, opacity: 0.35, clearcoat: 1 })
    add(new THREE.Mesh(new THREE.CylinderGeometry(55, 55, 170, 28), jar), W / 2 - 200, 85, 200)
    add(new THREE.Mesh(new THREE.CylinderGeometry(45, 45, 120, 28), jar), W / 2 - 320, 60, 230)
  }
}

// a stone worktop: speckled, with a few soft veins
function stone(base, speck, vein, roughness) {
  const c = document.createElement('canvas'); c.width = c.height = 1024
  const g = c.getContext('2d')
  g.fillStyle = base; g.fillRect(0, 0, 1024, 1024)
  let seed = 7
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  for (let i = 0; i < 26000; i++) {
    const a = rnd() * 0.22
    g.fillStyle = speck + a + ')'
    const r = rnd() * 1.6 + 0.3
    g.fillRect(rnd() * 1024, rnd() * 1024, r, r)
  }
  g.filter = 'blur(1.5px)'
  for (let k = 0; k < 7; k++) {
    g.strokeStyle = vein + (0.08 + rnd() * 0.12) + ')'
    g.lineWidth = 1 + rnd() * 3
    g.beginPath()
    let x = rnd() * 1024, y = rnd() * 1024
    g.moveTo(x, y)
    for (let s = 0; s < 14; s++) { x += 40 + rnd() * 70; y += (rnd() - 0.4) * 90; g.lineTo(x, y) }
    g.stroke()
  }
  g.filter = 'none'
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(1 / 1300, 1 / 1300)
  return new THREE.MeshPhysicalMaterial({ map: t, roughness, clearcoat: 0.6, clearcoatRoughness: 0.18 })
}

// a double socket in a cut-out of the glass
function socketPair(group, x, y, t, color) {
  const frame = new THREE.MeshStandardMaterial({ color, roughness: 0.4 })
  const hole = new THREE.MeshStandardMaterial({ color: '#555', roughness: 0.6 })
  const f = new THREE.Mesh(new THREE.BoxGeometry(160, 82, 10), frame)
  f.position.set(x, y, t + 3)
  f.castShadow = true
  group.add(f)
  for (const dx of [-38, 38]) {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(24, 24, 4, 28), hole)
    s.rotation.x = Math.PI / 2
    s.position.set(x + dx, y, t + 7)
    group.add(s)
  }
}

// a few things on an open shelf
function decor(group, x0, x1, y, t) {
  const mats = [new THREE.MeshStandardMaterial({ color: '#e9e6df', roughness: 0.4 }), new THREE.MeshStandardMaterial({ color: '#6f7a72', roughness: 0.5 })]
  const n = Math.floor((x1 - x0) / 420)
  for (let i = 0; i < n; i++) {
    const r = 55 + (i % 3) * 18, h = 110 + (i % 2) * 90
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.9, h, 28), mats[i % 2])
    m.position.set(x0 + 240 + i * 420, y + h / 2, t + 130)
    m.castShadow = true
    group.add(m)
  }
}

function hob() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 444
  const g = c.getContext('2d')
  g.fillStyle = '#0c0c0d'; g.fillRect(0, 0, 512, 444)
  g.strokeStyle = 'rgba(160,160,160,.35)'; g.lineWidth = 2
  for (const [x, y, r] of [[140, 120, 80], [380, 120, 62], [140, 330, 62], [380, 320, 88]]) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke() }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace
  return new THREE.MeshPhysicalMaterial({ map: t, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.03 })
}

function wood(color, repeat = 0) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 512
  const g = c.getContext('2d')
  g.fillStyle = color; g.fillRect(0, 0, 512, 512)
  for (let i = 0; i < 140; i++) {
    const y = Math.random() * 512, a = 0.04 + Math.random() * 0.1
    g.strokeStyle = Math.random() < 0.5 ? `rgba(60,38,20,${a})` : `rgba(210,175,130,${a})`
    g.lineWidth = 0.6 + Math.random() * 2.4
    g.beginPath(); g.moveTo(0, y)
    for (let x = 0; x <= 512; x += 32) g.lineTo(x, y + Math.sin(x / 70 + i) * 3 + (Math.random() - 0.5) * 1.5)
    g.stroke()
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  if (repeat) t.repeat.set(repeat, repeat)
  return new THREE.MeshStandardMaterial({ map: t, roughness: 0.55 })
}

// ------------------------------------------------------------------ light and room

// Reflections in the glass: the window on the left, the ceiling light, the room behind the camera
function kitchenEnv(renderer) {
  const env = new THREE.Scene()
  const k = 0.08
  const room = new THREE.Mesh(new THREE.BoxGeometry(40, 30, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(k, k * 0.99, k * 0.96), side: THREE.BackSide }))
  room.position.y = 6
  env.add(room)
  const box = (w, h, x, y, z, v) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(v, v * 0.99, v * 0.95), side: THREE.DoubleSide }))
    m.position.set(x, y, z); m.lookAt(0, 0, 0); env.add(m)
  }
  box(14, 1.2, 0, 19, 4, 1.4)          // ceiling light
  box(10, 11, -18, 5, 8, 1.7)          // window on the left
  box(6, 9, 6, 3, 19, 0.35)            // the room behind the camera
  const pmrem = new THREE.PMREMGenerator(renderer)
  const texture = pmrem.fromScene(env, 0.02).texture
  pmrem.dispose()
  return texture
}

// the wall, the floor and the ceiling of the kitchen
function roomShell() {
  const group = new THREE.Group()
  const c = document.createElement('canvas'); c.width = 1024; c.height = 512
  const g = c.getContext('2d')
  g.fillStyle = '#c3c4c4'; g.fillRect(0, 0, 1024, 512)
  const img = g.getImageData(0, 0, 1024, 512)
  for (let i = 0; i < img.data.length; i += 4) { const n = (Math.random() - 0.5) * 8; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n }
  g.putImageData(img, 0, 0)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(10, 3)
  const wallMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 })
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(30000, CEILING - FLOOR), wallMat)
  wall.position.set(0, (CEILING + FLOOR) / 2, -1)
  wall.receiveShadow = true
  const floorMat = new THREE.MeshStandardMaterial({ color: '#5f6061', roughness: 0.75 })
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(30000, 24000), floorMat)
  floor.rotation.x = -Math.PI / 2
  floor.position.set(0, FLOOR, 12000)
  floor.receiveShadow = true
  const ceilMat = new THREE.MeshStandardMaterial({ color: '#d9d6d0', roughness: 0.95, emissive: '#3a3936' })
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(30000, 24000), ceilMat)
  ceiling.rotation.x = Math.PI / 2
  ceiling.position.set(0, CEILING, 12000)
  group.add(wall, floor, ceiling)

  const gc = document.createElement('canvas'); gc.width = 256; gc.height = 128
  const gg = gc.getContext('2d')
  const lin = gg.createLinearGradient(0, 0, 0, 128)
  lin.addColorStop(0, 'rgba(255,255,255,1)'); lin.addColorStop(0.45, 'rgba(255,255,255,.3)'); lin.addColorStop(1, 'rgba(255,255,255,0)')
  gg.fillStyle = lin; gg.fillRect(0, 0, 256, 128)
  const fade = gg.createLinearGradient(0, 0, 256, 0)
  fade.addColorStop(0, 'rgba(0,0,0,1)'); fade.addColorStop(0.08, 'rgba(0,0,0,0)'); fade.addColorStop(0.92, 'rgba(0,0,0,0)'); fade.addColorStop(1, 'rgba(0,0,0,1)')
  gg.globalCompositeOperation = 'destination-out'; gg.fillStyle = fade; gg.fillRect(0, 0, 256, 128)
  const glowTex = new THREE.CanvasTexture(gc)
  return {
    group,
    setLit: lit => { wallMat.color.setScalar(lit ? 0.75 : 0.22); floorMat.color.set(lit ? '#5f6061' : '#28292a'); ceilMat.emissiveIntensity = lit ? 1 : 0.15; ceilMat.color.setScalar(lit ? 1 : 0.3) },
    // the light pool on the worktop, from the wall forward
    glow: w => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, 560), new THREE.MeshBasicMaterial({ map: glowTex, color: '#000000', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }))
      m.rotation.x = -Math.PI / 2
      m.position.set(0, 1.5, 290)
      return m
    },
  }
}
