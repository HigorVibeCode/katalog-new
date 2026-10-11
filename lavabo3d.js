// Live 3D washbasin deck: the lavabo combinations as real glass washbasins on a wall. Each is one
// 19 mm glass slab with the basin formed 150 mm deep in the same glass. The top is always smooth
// and glossy; the underside carries the surface (Float: smooth, Minimal, Struktur) and the paint,
// one colour or a Verlauf, seen through the glass. LED light in the edge escapes where the
// underside is structured, at the edge and around the basin. Shapes and textures come from
// scripts/lavabo-forms.py (formen.json, e-*, n-*, s-*).
import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { LED } from './deck3d.js'

export { LED }
const T = 19, DEPTH = 150, LIP = 30                       // mm: glass, basin depth, rounded basin rim
const NX = 2100, NY = 1050                                // the underside textures cover 2100 × 1050 mm
const STAGE = 1100, GAP = 420                             // every lavabo shown about 1100 mm wide
const HEIGHT = 850                                        // top of the lavabo above the floor
const BUMP = { Float: 0, Minimal: 1.6, Struktur: 2.4 }
const smoothstep = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t) }
// A sharp sun highlight on the polished glass can exceed what the half-float bloom buffers hold
// (65504) and turn the whole frame black; every material here keeps its output below that.
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
const slug = name => name.toLowerCase().replace(/ /g, '-').replace(/ä/g, 'ae').replace(/ü/g, 'ue').replace(/ö/g, 'oe')

// shot: one lavabo on its own on white with its soft shadow, for the catalogue (LED off, still)
export async function initLavabo3D({ deck, combos, base = 'img/lavabo/', onIndex, reduced = false, start = 0, shot = false }) {
  const forms = await (await fetch(`${base}formen.json`)).json()
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
  if ('transmissionResolutionScale' in renderer) renderer.transmissionResolutionScale = 0.75

  const scene = new THREE.Scene()
  scene.environment = bathroom(renderer)
  const room = wallAndFloor()
  scene.add(room.group)
  if (shot) {
    room.group.visible = false
    renderer.setClearColor('#ffffff', 1)                      // drawn straight to the screen: stays pure white
    const catcher = new THREE.Mesh(new THREE.PlaneGeometry(16000, 5000), new THREE.ShadowMaterial({ opacity: 0.16 }))
    catcher.position.set(0, 300, -1)
    catcher.receiveShadow = true
    scene.add(catcher)
  }
  const sun = new THREE.DirectionalLight('#fff4e8', 2.2)
  sun.position.set(-700, 2200, 1500)
  sun.target.position.set(0, -200, 0)
  sun.castShadow = true
  sun.shadow.mapSize.set(1024, 1024)
  Object.assign(sun.shadow.camera, { left: -1500, right: 1500, top: 1200, bottom: -1200, near: 500, far: 6000 })
  sun.shadow.radius = 6
  sun.shadow.bias = -0.0006
  const sky = new THREE.HemisphereLight('#e6ecea', '#1b1a19', 0.5)
  scene.add(sun, sun.target, sky)

  const camera = new THREE.PerspectiveCamera(30, 1, 50, 30000)
  const target = new THREE.Vector3(0, -70, 310)

  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.45, 0.82)
  composer.addPass(bloom)
  composer.addPass(new OutputPass())

  const loader = new THREE.TextureLoader()
  const cache = new Map()
  const texture = (url, uv1 = false) => {
    if (!cache.has(url)) cache.set(url, new Promise((resolve, reject) => loader.load(url, t => {
      t.colorSpace = THREE.NoColorSpace
      t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
      if (uv1) t.channel = 1
      resolve(t)
    }, undefined, reject)))
    return cache.get(url)
  }
  const black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1)
  black.channel = 1; black.needsUpdate = true

  const ledA = new THREE.Color(), ledB = new THREE.Color(), ledMid = new THREE.Color()
  const shared = { ledA: { value: ledA }, ledB: { value: ledB } }
  let ledEnabled = false

  // the glass top: clear, smooth and glossy, the paint seen through it
  const glassTop = () => capped(new THREE.MeshPhysicalMaterial({
    color: '#ffffff', roughness: 0.03, transmission: 1, thickness: T, ior: 1.5,
    attenuationColor: '#cdebdf', attenuationDistance: 260, specularIntensity: 1, envMapIntensity: 1,
  }))
  const edgeMaterial = new THREE.MeshPhysicalMaterial({
    color: '#86d3b6', roughness: 0.12, transmission: 0.3, thickness: 40, ior: 1.5,
    attenuationColor: '#2f8f6f', attenuationDistance: 25, emissive: '#2e8a68', emissiveIntensity: 0.25,
  })
  const chrome = capped(new THREE.MeshStandardMaterial({ color: '#f1f2f2', metalness: 1, roughness: 0.12 }))
  const rimMaterial = new THREE.MeshBasicMaterial({ color: '#ffffff', vertexColors: true, toneMapped: false, transparent: true, opacity: 0.6 })

  // the paint on the underside: colour (a Verlauf from left to right), the surface as normals,
  // and the LED light escaping where the surface is structured and near the lit edges
  const paint = (combo, normalMap, escape, edges) => {
    const k = BUMP[combo.unterseite] ?? 1
    const m = new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.4, metalness: 0, normalMap, normalScale: new THREE.Vector2(k, k) })
    const own = {
      paintA: { value: new THREE.Color(combo.a) }, paintB: { value: new THREE.Color(combo.b || combo.a) },
      edgeMap: { value: edges }, escapeMap: { value: escape }, ledOn: { value: 0 }, shade: { value: 1 },
    }
    m.userData.uniforms = own
    m.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, own, shared)
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vPlan;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\n\tvPlan = uv;')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec2 vPlan;
uniform vec3 paintA; uniform vec3 paintB; uniform vec3 ledA; uniform vec3 ledB;
uniform sampler2D edgeMap; uniform sampler2D escapeMap; uniform float ledOn; uniform float shade;
vec2 relief = vec2( 0.0 );`)
        .replace('#include <color_fragment>', `#include <color_fragment>
	// seen through 19 mm of glass: a touch of green and depth
	diffuseColor.rgb *= mix( paintA, paintB, smoothstep( 0.12, 0.88, vPlan.x ) ) * vec3( 0.93, 0.98, 0.96 );`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
	relief = mapN.xy;`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
	{
		// the structure catches the light from the window side and falls into shadow on the other
		diffuseColor.rgb *= clamp( 1.0 + 1.6 * dot( relief, normalize( vec2( -0.6, 0.8 ) ) ), 0.55, 1.5 );
		float lit = texture2D( edgeMap, vPlan ).r;
		float esc = texture2D( escapeMap, vNormalMapUv ).r;
		vec3 led = mix( ledA, ledB, vPlan.x );
		totalEmissiveRadiance += led * ledOn * ( lit * ( 0.22 + 3.2 * esc ) + 0.05 );
	}`)
        .replace('#include <dithering_fragment>', `gl_FragColor.rgb *= shade;
	#include <dithering_fragment>`)
    }
    m.customProgramCacheKey = () => 'lavabo-paint-2'
    return capped(m)
  }

  // One lavabo per combination, built when it comes near the front and released when far away.
  const panels = combos.map((combo, i) => {
    const m = forms[combo.model]
    const s = Math.max(0.62, Math.min(1.3, STAGE / m.L))
    return { combo, i, m, s, w: m.L * s, group: null, loading: false }
  })
  const xs = [0]
  for (let i = 1; i < panels.length; i++) xs.push(xs[i - 1] + (panels[i - 1].w + panels[i].w) / 2 + GAP)
  const geometries = new Map()
  const build = async panel => {
    panel.loading = true
    const { combo, m } = panel
    const key = combo.unterseite === 'Float' ? 'minimal' : combo.unterseite.toLowerCase()
    const [normalMap, escape, edges] = await Promise.all([
      texture(`${base}n-${key}.webp`, true),
      combo.unterseite === 'Float' ? black : texture(`${base}s-${key}.webp`, true),
      texture(`${base}e-${slug(combo.model)}.webp`),
    ])
    if (!geometries.has(combo.model)) geometries.set(combo.model, lavabo(m))
    const geo = geometries.get(combo.model)
    const top = glassTop(), under = paint(combo, normalMap, escape, edges), side = capped(edgeMaterial.clone()), rimMat = rimMaterial.clone()
    const group = new THREE.Group()
    const add = (g, mat, shadow = true) => { const mesh = new THREE.Mesh(g, mat); mesh.castShadow = shadow; group.add(mesh); return mesh }
    under.shadowSide = THREE.DoubleSide                       // the painted glass throws a full shadow
    add(geo.top, top, false); add(geo.bowl, top, false)
    add(geo.under, under); add(geo.bowlUnder, under)
    add(geo.side, side)
    add(geo.rim, rimMat, false)
    for (const [x, y] of m.taps) { const tap = mixer(chrome); tap.position.set(x - m.L / 2, 0, y); group.add(tap) }
    for (const c of geo.drains) { const d = drain(chrome); d.position.set(c.x, -DEPTH + 1, c.z); group.add(d) }
    group.scale.setScalar(panel.s)
    const glow = room.glow(panel.w)
    scene.add(group, glow)
    paintRim(geo.rim, m.L)
    Object.assign(panel, { group, glow, top, under, side, rimMat, rim: geo.rim, loading: false })
    invalidate()
  }
  const release = panel => {
    if (!panel.group) return
    scene.remove(panel.group, panel.glow)
    panel.top.dispose(); panel.under.dispose(); panel.side.dispose(); panel.rimMat.dispose(); panel.glow.material.dispose()
    Object.assign(panel, { group: null, glow: null, top: null, under: null, side: null, rimMat: null })
  }

  const paintRim = (geo, L) => {
    const p = geo.attributes.position
    const colors = geo.attributes.color?.array || new Float32Array(p.count * 3)
    const c = new THREE.Color()
    for (let i = 0; i < p.count; i++) {
      if (ledEnabled) c.copy(ledA).lerp(ledB, p.getX(i) / L + 0.5).multiplyScalar(0.8)
      else c.set('#2c5a4c')
      c.toArray(colors, i * 3)
    }
    if (!geo.attributes.color) geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geo.attributes.color.needsUpdate = true
  }
  const repaintRims = () => panels.forEach(p => { if (p.group) paintRim(p.rim, p.m.L) })

  // LED: the same lights as the glass walls, only the lavabo in front is lit
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
    repaintRims()
  }
  const setLight = n => {
    led = (n + LED.length) % LED.length
    const { a, b, auto } = LED[led]
    autoLed = Boolean(auto)
    ledEnabled = Boolean(a) || autoLed
    if (autoLed) updateAuto(performance.now())
    else if (ledEnabled) { ledA.set(a); ledB.set(b); ledMid.copy(ledA).lerp(ledB, 0.5) }
    repaintRims()
    // with the LED on the room light is dimmed, so the light in the glass carries the picture
    sun.intensity = ledEnabled ? 0.55 : 2.2
    sky.intensity = ledEnabled ? 0.16 : 0.5
    scene.environmentIntensity = ledEnabled ? 0.45 : 1
    room.setLit(!ledEnabled)
    bloom.strength = ledEnabled ? 0.6 : 0.2
    bloom.enabled = !shot
    invalidate()
    return LED[led]
  }
  const lightPanel = (panel, front) => {
    const f = ledEnabled ? front : 0
    panel.under.userData.uniforms.ledOn.value = f
    panel.side.emissive.copy(ledEnabled ? ledMid : edgeMaterial.emissive)
    panel.side.emissiveIntensity = ledEnabled ? 0.1 + 2.2 * f : 0.25
    panel.rimMat.color.setScalar(ledEnabled ? 0.08 + 0.92 * f : 0.5 + 0.5 * front)
    panel.rimMat.opacity = ledEnabled ? 0.25 + 0.65 * f : 0.25
    panel.glow.material.color.copy(ledMid).multiplyScalar(0.22 * f)
    panel.glow.visible = f > 0.01
  }

  // Layout: the lavabos side by side along the wall; the deck slides along it.
  let pos = start, aim = start, shown = -1, sway = 0, idleSince = performance.now(), spin = null
  const along = p => {
    const i = Math.max(0, Math.min(panels.length - 1, Math.floor(p))), j = Math.min(panels.length - 1, i + 1)
    return xs[i] + (xs[j] - xs[i]) * (p - i)
  }
  const place = () => {
    const here = along(Math.max(0, Math.min(panels.length - 1, pos)))
    panels.forEach(panel => {
      const d = panel.i - pos, ad = Math.abs(d)
      if (ad < (shot ? 0.5 : 2.6) && !panel.group && !panel.loading) build(panel).catch(() => { panel.loading = false })
      if (ad > 8) release(panel)
      if (!panel.group) return
      const x = xs[panel.i] - here
      panel.group.visible = Math.abs(x) < 4200
      panel.group.position.set(x, 0, 0)
      panel.glow.position.x = x
      const front = 1 - smoothstep(0.12, 0.8, ad)
      const shade = 1 - Math.min(ad * 0.55, 0.7)
      lightPanel(panel, front)
      panel.under.userData.uniforms.shade.value = shade
      panel.top.envMapIntensity = 0.35 + 0.65 * shade
    })
    const index = Math.round(Math.min(panels.length - 1, Math.max(0, pos)))
    if (index !== shown) { shown = index; onIndex?.(index) }
  }
  // camera: from the front and above, so the outline, the basin and the colour all show
  let fitDistance = 3000
  const aimCamera = () => {
    const a = sway, el = THREE.MathUtils.degToRad(36)
    camera.position.set(target.x + Math.sin(a) * Math.cos(el) * fitDistance, target.y + Math.sin(el) * fitDistance, target.z + Math.cos(a) * Math.cos(el) * fitDistance)
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
    sway = swaying ? Math.sin(idle / 1900) * 0.09 * Math.min(1, idle / 1200) : sway * 0.9
    const animating = moving || swaying || dirty || Math.abs(sway) > 0.001
    if (animating || autoLed) {
      if (autoLed) updateAuto(now)
      aimCamera()
      place()
      if (shot) renderer.render(scene, camera); else composer.render()
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
    // frame the lavabo on stage with a little of its neighbours, on phones and desktops alike
    const half = THREE.MathUtils.degToRad(camera.fov / 2)
    const byWidth = 790 / (Math.tan(half) * camera.aspect), byHeight = 560 / Math.tan(half)
    fitDistance = Math.max(byWidth, byHeight)
    if (shot) { const p = panels[start]; fitDistance = Math.max(p.w * 0.54 / (Math.tan(half) * camera.aspect), (p.m.D * p.s * 0.62 + 160) / Math.tan(half)) }
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
  await Promise.all((shot ? [panels[start]] : panels.slice(Math.max(0, start - 1), start + 2)).map(p => build(p)))
  setLight(LED.length - 1)
  aimCamera()
  place()
  if (shot) renderer.render(scene, camera); else composer.render()
  canvas.classList.add('is-ready')
  wake()
  return { setLight, light: () => led, random, step: d => goTo(Math.round(aim) + d), goTo }
}

// ------------------------------------------------------------------ geometry
// Plan (mm): x along the length, y from the wall (0) to the front. World: X = x - L/2, Y up
// (top of the glass at 0), Z = y.

function resample(poly, n) {
  const P = poly.map(([x, y]) => [x, y])
  if (Math.hypot(P[0][0] - P.at(-1)[0], P[0][1] - P.at(-1)[1]) < 0.01) P.pop()
  const len = [0]
  for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; len.push(len[i] + Math.hypot(b[0] - a[0], b[1] - a[1])) }
  const total = len.at(-1), out = []
  let j = 0
  for (let k = 0; k < n; k++) {
    const t = k * total / n
    while (len[j + 1] < t) j++
    const a = P[j], b = P[(j + 1) % P.length], f = (t - len[j]) / Math.max(1e-9, len[j + 1] - len[j])
    out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f])
  }
  return out
}
const area = P => P.reduce((s, p, i) => { const q = P[(i + 1) % P.length]; return s + p[0] * q[1] - q[0] * p[1] }, 0) / 2
const perimeter = P => P.reduce((s, p, i) => { const q = P[(i + 1) % P.length]; return s + Math.hypot(q[0] - p[0], q[1] - p[1]) }, 0)
function soften(P, rounds) {                          // kiln-formed: no sharp corners
  for (let r = 0; r < rounds; r++) P = P.map((p, i) => { const a = P[(i - 1 + P.length) % P.length], b = P[(i + 1) % P.length]; return [0.25 * a[0] + 0.5 * p[0] + 0.25 * b[0], 0.25 * a[1] + 0.5 * p[1] + 0.25 * b[1]] })
  return P
}
function outward(P) {                                 // unit normals pointing out of the polygon
  const sign = area(P) > 0 ? 1 : -1
  return P.map((p, i) => {
    const a = P[(i - 1 + P.length) % P.length], b = P[(i + 1) % P.length]
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1
    return [sign * dy / l, -sign * dx / l]
  })
}

export function lavabo(m) {
  const L = m.L, D = m.D
  const outline = resample(m.outline, Math.min(1400, Math.ceil(perimeter(m.outline) / 6)))
  const basins = m.basins.map(b => soften(resample(b, 192), 4))
  const lips = basins.map(B => { const n = outward(B); return B.map((p, i) => [p[0] + n[i][0] * LIP, p[1] + n[i][1] * LIP]) })
  const uvOf = (x, y) => [x / L, 1 - y / D, x / NX, 1 - y / NY]

  // flat top with the basin openings, and the same at the underside
  const flat = y0 => {
    const tris = THREE.ShapeUtils.triangulateShape(outline.map(p => new THREE.Vector2(...p)), lips.map(l => l.map(p => new THREE.Vector2(...p))))
    const pts = [outline, ...lips].flat()
    const pos = [], uv = [], uv1 = [], idx = []
    pts.forEach(([x, y]) => { pos.push(x - L / 2, y0, y); const u = uvOf(x, y); uv.push(u[0], u[1]); uv1.push(u[2], u[3]) })
    tris.forEach(([a, b, c]) => {
      const [ax, ay] = pts[a], [bx, by] = pts[b], [cx, cy] = pts[c]
      const up = (by - ay) * (cx - ax) - (bx - ax) * (cy - ay) > 0
      idx.push(...(up ? [a, b, c] : [a, c, b]))
    })
    const g = mesh(pos, uv, uv1, idx)
    g.setAttribute('normal', new THREE.Float32BufferAttribute(pts.flatMap(() => [0, 1, 0]), 3))   // flat
    return g
  }

  // the basin: the rim rounds over (radius LIP), the wall drops and turns into a flat floor
  const bowl = () => {
    const pos = [], uv = [], uv1 = [], idx = [], drains = []
    basins.forEach((B, bi) => {
      const n = outward(B), N = B.length
      const c = B.reduce((s, p) => [s[0] + p[0] / N, s[1] + p[1] / N], [0, 0])
      const rings = []
      for (let j = 0; j <= 6; j++) {
        const f = j / 6 * Math.PI / 2, o = LIP * (1 - Math.sin(f)), y = -LIP + LIP * Math.cos(f)
        rings.push(B.map((p, i) => [p[0] + n[i][0] * o, p[1] + n[i][1] * o, y]))
      }
      for (let k = 1; k <= 16; k++) {
        const t = k / 16 * Math.PI / 2, s = 1 - 0.46 * (1 - Math.cos(t)), y = -LIP - (DEPTH - LIP) * Math.sin(t)
        rings.push(B.map(p => [c[0] + (p[0] - c[0]) * s, c[1] + (p[1] - c[1]) * s, y]))
      }
      const first = pos.length / 3
      rings.flat().forEach(([x, z, y]) => { pos.push(x - L / 2, y, z); const u = uvOf(x, z); uv.push(u[0], u[1]); uv1.push(u[2], u[3]) })
      const centre = pos.length / 3
      pos.push(c[0] - L / 2, -DEPTH, c[1]); { const u = uvOf(c[0], c[1]); uv.push(u[0], u[1]); uv1.push(u[2], u[3]) }
      drains.push({ x: c[0] - L / 2, z: c[1] })
      const v = (r, i) => first + r * N + (i % N)
      const P = i => new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2])
      // faces turn up and towards the middle of the basin, where the viewer looks from
      const tri = (a, b, d) => {
        const A = P(a), nrm = P(b).sub(A).cross(P(d).sub(A))
        const want = new THREE.Vector3(c[0] - L / 2 - A.x, 0, c[1] - A.z).normalize().add(new THREE.Vector3(0, 0.6, 0))
        idx.push(...(nrm.dot(want) >= 0 ? [a, b, d] : [a, d, b]))
      }
      for (let r = 0; r < rings.length - 1; r++) for (let i = 0; i < N; i++) { tri(v(r, i), v(r, i + 1), v(r + 1, i)); tri(v(r, i + 1), v(r + 1, i + 1), v(r + 1, i)) }
      const lastRing = rings.length - 1
      for (let i = 0; i < N; i++) tri(v(lastRing, i), v(lastRing, i + 1), centre)
      void bi
    })
    const g = mesh(pos, uv, uv1, idx)
    g.computeVertexNormals()
    return { g, drains }
  }
  // the underside of the basin: the same surface, one glass thickness further out
  const below = g => {
    const u = g.clone(), p = u.attributes.position, n = g.attributes.normal
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) - n.getX(i) * T, z = p.getZ(i) - n.getZ(i) * T
      p.setXYZ(i, x, p.getY(i) - n.getY(i) * T, z)
      const uv = uvOf(x + L / 2, z)
      u.attributes.uv.setXY(i, uv[0], uv[1]); u.attributes.uv1.setXY(i, uv[2], uv[3])
    }
    u.computeVertexNormals()
    return u
  }
  // the polished edge all round
  const side = () => {
    const pos = [], idx = [], nrm = []
    const n = outward(outline), N = outline.length
    outline.forEach(([x, y], i) => { pos.push(x - L / 2, 0, y, x - L / 2, -T, y); nrm.push(n[i][0], 0, n[i][1], n[i][0], 0, n[i][1]) })
    const ccw = area(outline) > 0
    for (let i = 0; i < N; i++) {
      const a = 2 * i, b = 2 * ((i + 1) % N)
      idx.push(...(ccw ? [a, a + 1, b, b, a + 1, b + 1] : [a, b, a + 1, b, b + 1, a + 1]))
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3))
    g.setIndex(idx)
    return g
  }
  const rim = () => {
    const n = outward(outline)
    const pts = outline.map(([x, y], i) => new THREE.Vector3(x - L / 2 + n[i][0] * 1.5, -T / 2, y + n[i][1] * 1.5))
    const path = new THREE.CurvePath()
    pts.forEach((p, i) => path.add(new THREE.LineCurve3(p, pts[(i + 1) % pts.length])))
    return new THREE.TubeGeometry(path, Math.min(2400, Math.ceil(path.getLength() / 5)), 4.5, 6, false)
  }
  const top = flat(0), under = flat(-T)
  under.computeVertexNormals()
  const { g: bowlGeo, drains } = bowl()
  return { top, under, bowl: bowlGeo, bowlUnder: below(bowlGeo), side: side(), rim: rim(), drains }
}

function mesh(pos, uv, uv1, idx) {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setAttribute('uv1', new THREE.Float32BufferAttribute(uv1, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

// a slim single-lever mixer, standing on the glass
function mixer(material) {
  const g = new THREE.Group()
  const part = (geo, x, y, z, rx = 0) => { const m = new THREE.Mesh(geo, material); m.position.set(x, y, z); m.rotation.x = rx; m.castShadow = true; g.add(m) }
  part(new THREE.CylinderGeometry(26, 27, 8, 32), 0, 4, 0)
  part(new THREE.CylinderGeometry(19, 21, 190, 32), 0, 100, 0)
  part(new THREE.CylinderGeometry(11, 11, 150, 24), 0, 178, 72, Math.PI / 2)
  part(new THREE.CylinderGeometry(12, 12, 4, 24), 0, 176, 146)
  part(new THREE.BoxGeometry(12, 10, 70), 0, 198, -26)
  return g
}
function drain(material) {
  const g = new THREE.Group()
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(34, 34, 3, 40), material)
  const hole = new THREE.Mesh(new THREE.CylinderGeometry(26, 26, 3.4, 40), new THREE.MeshStandardMaterial({ color: '#2a2c2c', metalness: 0.6, roughness: 0.4 }))
  g.add(ring, hole)
  return g
}

// ------------------------------------------------------------------ light and room

// Reflections in the glossy top: a soft ceiling, a window on the left and the light above the
// mirror, which the glass mirrors as a calm band.
function bathroom(renderer) {
  const env = new THREE.Scene()
  const k = 0.07
  const room = new THREE.Mesh(new THREE.BoxGeometry(40, 30, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(k, k * 1.01, k * 0.98), side: THREE.BackSide }))
  room.position.y = 6
  env.add(room)
  const box = (w, h, x, y, z, v) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(v, v * 0.99, v * 0.95), side: THREE.DoubleSide }))
    m.position.set(x, y, z); m.lookAt(0, 0, 0); env.add(m)
  }
  box(14, 1.1, 0, 7, -10, 3)          // light above the mirror
  box(16, 12, 0, 19, 0, 0.9)          // ceiling
  box(9, 12, -18, 5, 4, 1.6)          // window on the left
  box(5, 12, 18, 4, -4, 0.5)
  const pmrem = new THREE.PMREMGenerator(renderer)
  const texture = pmrem.fromScene(env, 0.02).texture
  pmrem.dispose()
  return texture
}

// The wall the lavabos hang on and the floor, plaster lit softly from the left. Each lavabo
// throws a coloured glow onto the wall below it when its LED is on.
function wallAndFloor() {
  const group = new THREE.Group()
  const c = document.createElement('canvas'); c.width = 1024; c.height = 512
  const g = c.getContext('2d')
  g.fillStyle = '#b9b5ad'; g.fillRect(0, 0, 1024, 512)
  const img = g.getImageData(0, 0, 1024, 512)
  for (let i = 0; i < img.data.length; i += 4) { const n = (Math.random() - 0.5) * 9; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n }
  g.putImageData(img, 0, 0)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(6, 3)
  const wallMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, color: '#ffffff' })
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(16000, 5000), wallMat)
  wall.position.set(0, 300, -1)
  wall.receiveShadow = true
  const floorMat = new THREE.MeshStandardMaterial({ color: '#5b5752', roughness: 0.8 })
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(16000, 6000), floorMat)
  floor.rotation.x = -Math.PI / 2
  floor.position.set(0, -HEIGHT, 3000)
  floor.receiveShadow = true
  group.add(wall, floor)

  const gc = document.createElement('canvas'); gc.width = gc.height = 128
  const gg = gc.getContext('2d')
  const rad = gg.createRadialGradient(64, 40, 4, 64, 40, 64)
  rad.addColorStop(0, 'rgba(255,255,255,1)'); rad.addColorStop(0.5, 'rgba(255,255,255,.35)'); rad.addColorStop(1, 'rgba(255,255,255,0)')
  gg.fillStyle = rad; gg.fillRect(0, 0, 128, 128)
  const glowTex = new THREE.CanvasTexture(gc)
  return {
    group,
    setLit: lit => { wallMat.color.setScalar(lit ? 0.62 : 0.22); floorMat.color.set(lit ? '#5b5752' : '#2a2826') },
    glow: w => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.15, 520), new THREE.MeshBasicMaterial({ map: glowTex, color: '#000000', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }))
      m.position.set(0, -170, 0)
      return m
    },
  }
}
