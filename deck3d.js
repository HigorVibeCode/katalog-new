// Live 3D glass deck: the combinations as real glass panels (1050 x 2100 x 10 mm) in a showroom.
// Kiln-formed glass as in the photos of installed pieces: clear glass whose whole surface carries a
// fine, glossy crinkle; the structure as soft grooves; motifs as smooth, rounded glass ridges. LED
// light in the edge travels inside the glass and escapes where the surface tilts, so the edges,
// the motif and the crinkle light up. The textures come from scripts/glass-textures.py.
import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { capped, kilnGlass, smoothstep } from './glass3d.js'
import { bench, brushed, chrome, contactShadow, cove, mirrorFloor, monstera, niche, palm, parkWhenAway, plaster, roomEnvironment, slab, sunlight, surface, travertine, windowFrame } from './room3d.js'

const GW = 1050, GH = 2100, T = 10                        // mm
const FLOOR = -GH / 2                                     // the glasses stand on the floor
export const LED = [
  { name: 'Automatisch', auto: true },                      // the colour changes by itself, slowly
  { name: 'Violett · Türkis', a: '#b24dff', b: '#18d8f0' },
  { name: 'Türkis', a: '#16d6e0', b: '#16d6e0' },
  { name: 'Warmweiss', a: '#ffbe73', b: '#ffbe73' },
  { name: 'Ohne Licht', a: null, b: null },
]
const slug = name => name.toLowerCase().replace(/ /g, '-').replace(/ä/g, 'ae')

export async function initDeck3D({ deck, combos, base = 'media/glas/', onIndex, reduced = false, start = 0 }) {
  const forms = await (await fetch(`${base}formen.json`)).json()
  const canvas = document.createElement('canvas')
  canvas.className = 'deck-canvas'
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' })   // the composer's target is multisampled; the canvas only takes the finished frame
  // shaders compile without the page waiting on them: no error read-back (it blocks until each program
  // is linked), and the scene is compiled in parallel before its first frame (compileAsync)
  renderer.debug.checkShaderErrors = false
  // the page keeps one scene alive at a time: dispose() gives every listener, observer and the
  // whole WebGL context (all its video memory) back; the deck is built again on the way back
  const life = new AbortController(), signal = life.signal
  const on = (target, type, fn, options = {}) => target.addEventListener(type, fn, { ...options, signal })
  if (!renderer.capabilities.isWebGL2) throw new Error('WebGL2 nicht verfügbar')
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5))     // a Retina screen at 2× costs twice the pixels for little gain
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  renderer.outputColorSpace = THREE.SRGBColorSpace
  // small screens and reduced motion get the lighter picture: a coarser mirror and refraction
  const lite = reduced || Math.min(innerWidth, innerHeight) < 700 || (navigator.deviceMemory && navigator.deviceMemory <= 4)
  if ('transmissionResolutionScale' in renderer) renderer.transmissionResolutionScale = lite ? 0.6 : 0.75
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap

  const scene = new THREE.Scene()
  // the mirror in the floor sees the glasses as cheap ghosts (no refraction), see build
  const ghosts = []
  const room = showroom(renderer, scene, lite, { before: () => ghosts.forEach(g => g(true)), after: () => ghosts.forEach(g => g(false)) })

  const camera = new THREE.PerspectiveCamera(28, 1, 100, 40000)
  camera.position.set(0, -170, 7300)                       // glass in the upper part, the label below
  camera.lookAt(0, -310, 0)

  // LED edges glow and bleed a little light around them, as in the photos.
  // the post-processing chain renders off screen, where the canvas antialias does not reach: 4× MSAA there
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }))
  composer.addPass(new RenderPass(scene, camera))
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.45, 0.82)
  composer.addPass(bloom)
  composer.addPass(new OutputPass())
  deck.__scene = { scene, renderer, render: () => composer.render(), parts: { bloom, ...room.parts } }   // for the test page

  // Polished edge (cloned per glass): light travelling along the glass turns it green.
  const edge = new THREE.MeshPhysicalMaterial({
    color: '#86d3b6', roughness: 0.15, transmission: 0.25, thickness: 60, ior: 1.5,
    attenuationColor: '#2f8f6f', attenuationDistance: 30, emissive: '#2e8a68', emissiveIntensity: 0.3,
  })
  const ledA = new THREE.Color(), ledB = new THREE.Color()
  // The lit edge as one continuous line around the outline (a thin tube in the glass thickness).
  const rimMaterial = new THREE.MeshBasicMaterial({ color: '#ffffff', vertexColors: true, toneMapped: false, transparent: true, opacity: 0.75 })
  const rims = new Map()
  const rim = form => {
    if (!rims.has(form)) { rims.set(form, rimGeometry(form, forms)); paintRim(rims.get(form)) }
    return rims.get(form)
  }
  const shared = { ledA: { value: ledA }, ledB: { value: ledB } }
  let ledEnabled = true
  // the shadow of kiln glass: a fine checker in the depth map, blurred by the soft shadow into
  // a half shadow – the sun passes through the glass, dimmed, not blocked
  const halftone = (() => { const n = 8, d = new Uint8Array(n * n * 4); for (let i = 0; i < n * n; i++) { const v = ((i % n) + Math.floor(i / n)) % 2 ? 255 : 0; d.set([v, v, v, v], i * 4) } const t = new THREE.DataTexture(d, n, n); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(70, 140); t.needsUpdate = true; return t })()
  const glassDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, alphaMap: halftone, alphaTest: 0.5 })

  const loader = new THREE.TextureLoader()
  const texture = url => new Promise((resolve, reject) => loader.load(url, t => {
    t.colorSpace = THREE.NoColorSpace
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
    resolve(t)
  }, undefined, reject))

  // One panel per combination, built when it comes near the front and released when far away.
  const panels = combos.map((combo, i) => ({ combo, i, group: null, face: null, loading: false }))
  const geometries = new Map()
  const geometry = form => {
    if (!geometries.has(form)) {
      geometries.set(form, form === 'Gebogen C' ? bent(planC) : form === 'Gebogen J' ? bent(planJ) : flat(forms[form]))
    }
    return geometries.get(form)
  }
  const crinkle = await texture(`${base}crinkle.webp`)
  crinkle.wrapS = crinkle.wrapT = THREE.RepeatWrapping
  const edgeMaps = new Map()
  const edgeMap = form => {
    if (!edgeMaps.has(form)) edgeMaps.set(form, texture(`${base}e-${slug(form)}.webp`))
    return edgeMaps.get(form)
  }
  // Structure and relief are separate maps (scripts/glass-textures.py --split), shared between
  // the glasses and released when no glass uses them any more.
  const cache = new Map()
  const acquire = url => {
    let e = cache.get(url)
    if (!e) cache.set(url, e = { n: 0, t: texture(url) })
    e.n++
    return e.t
  }
  const drop = url => {
    const e = cache.get(url)
    if (e && --e.n === 0) { cache.delete(url); e.t.then(t => t.dispose()).catch(() => {}) }
  }
  const pixel = rgba => { const t = new THREE.DataTexture(new Uint8Array(rgba), 1, 1); t.needsUpdate = true; return t }
  const flatNormal = pixel([128, 128, 255, 255]), noRelief = pixel([0, 0, 255, 255]), noEscape = pixel([0, 0, 0, 255])
  const STRUCTURES = ['arc-sweep', 'lateral-sweep', 'flow-scape', 'rake-fan', 'abstract', 'minimal', 'linear']
  // a combination's maps: float glass carries only its sandblast design; kiln glass a structure
  // and, if any, a relief
  const mapsOf = combo => {
    if (combo.float) return [null, combo.maps ? `${base}s-${combo.maps}.webp` : null, null, null]   // clear float: no design
    const s = combo.s ?? STRUCTURES.find(k => combo.maps.startsWith(k + '-'))
    const r = combo.r ?? combo.maps.slice(s.length + 1)
    return [`${base}n-s-${s}.webp`, `${base}s-s-${s}.webp`, r === 'ohne' ? null : `${base}n-r-${r}.webp`, r === 'ohne' ? null : `${base}r-${r}.webp`]
  }
  const build = async panel => {
    panel.loading = true
    const urls = mapsOf(panel.combo)
    const [normalMap, escape, reliefNormal, relief, edges] = await Promise.all([...urls.map(u => u && acquire(u)), edgeMap(panel.combo.form)])
    const args = [normalMap ?? flatNormal, escape ?? noEscape, edges, panel.combo.float, reliefNormal ?? flatNormal, relief ?? noRelief, !relief && !panel.combo.float]
    const face = glass(...args)
    // the ghost: the same glass without refraction, for the mirror in the floor
    const ghost = glass(...args)
    Object.assign(ghost, { transmission: 0, transparent: true, opacity: 0.45, depthWrite: false })
    const geo = geometry(panel.combo.form)
    const side = capped(edge.clone()), rimMat = rimMaterial.clone()
    const real = geo.type === 'BoxGeometry' ? [side, side, side, side, face, face] : [face, side]
    const faint = geo.type === 'BoxGeometry' ? [side, side, side, side, ghost, ghost] : [ghost, side]
    const mesh = new THREE.Mesh(geo, real)
    if (!panel.combo.float) { mesh.castShadow = true; mesh.customDepthMaterial = glassDepth }
    const swap = on => { mesh.material = on ? faint : real }
    ghosts.push(swap)
    const group = new THREE.Group()
    group.add(mesh, new THREE.Mesh(rim(panel.combo.form), rimMat))
    const foot = contactShadow(GW * 1.5, 620, 0.5)          // the dark line where the glass meets the floor
    foot.position.set(0, FLOOR + 1, 0)
    group.add(foot)
    scene.add(group)
    Object.assign(panel, { group, face, ghost, swap, side, rimMat, foot, maps: urls.filter(Boolean), loading: false })
    invalidate()
  }
  const release = panel => {
    if (!panel.group) return
    scene.remove(panel.group)
    panel.face.dispose(); panel.ghost.dispose(); panel.side.dispose(); panel.rimMat.dispose()
    ghosts.splice(ghosts.indexOf(panel.swap), 1)
    panel.maps.forEach(drop)
    Object.assign(panel, { group: null, face: null, ghost: null, swap: null, side: null, rimMat: null, maps: null })
  }

  const glass = (...args) => kilnGlass({ crinkle, shared }, ...args)

  // Rim colour along the glass: one colour, or a blend from the left to the right edge.
  const paintRim = geo => {
    const p = geo.attributes.position
    const colors = geo.attributes.color?.array || new Float32Array(p.count * 3)
    const on = ledEnabled, c = new THREE.Color()
    for (let i = 0; i < p.count; i++) {
      if (on) c.copy(ledA).lerp(ledB, p.getX(i) / GW + 0.5).multiplyScalar(0.75)
      else c.set('#2c5a4c')
      c.toArray(colors, i * 3)
    }
    if (!geo.attributes.color) geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geo.attributes.color.needsUpdate = true
  }

  // LED in the edge, switched on only for the glass in front: it lights up as it arrives and the
  // glasses behind stay dark, so nothing competes with it. The room stays dark either way.
  let led = 0, autoLed = false
  const ledMid = new THREE.Color()
  // Automatic: a slow loop through the colours, the far edge a little ahead of the near one so
  // the glass always carries a gradient. It runs on the clock, so changing the glass does not
  // restart it.
  const AUTO_STOPS = ['#b24dff', '#4d6bff', '#18d8f0', '#2fe0a0', '#ffbe73', '#ff5fa8'].map(c => new THREE.Color(c))
  const AUTO_STEP = 3500                                      // ms per colour
  const autoColor = (t, out) => {
    const n = AUTO_STOPS.length, x = ((t % n) + n) % n, i = Math.floor(x), f = smoothstep(0, 1, x - i)
    return out.copy(AUTO_STOPS[i]).lerp(AUTO_STOPS[(i + 1) % n], f)
  }
  const updateAuto = now => {
    autoColor(now / AUTO_STEP, ledA); autoColor(now / AUTO_STEP + 0.6, ledB)
    ledMid.copy(ledA).lerp(ledB, 0.5)
    rims.forEach(paintRim)
  }
  const setLight = n => {
    led = (n + LED.length) % LED.length
    const { a, b, auto } = LED[led]
    autoLed = Boolean(auto)
    ledEnabled = Boolean(a) || autoLed
    if (autoLed) updateAuto(performance.now())
    else if (ledEnabled) { ledA.set(a); ledB.set(b); ledMid.copy(ledA).lerp(ledB, 0.5) }
    rims.forEach(paintRim)
    // with the LED on the room turns to evening: the sun is gone, the cove light stays, the
    // glass carries the picture; by day the sun comes through the shutters
    room.setMode(ledEnabled ? 'evening' : 'day')
    bloom.strength = ledEnabled ? 0.45 : 0.22
    renderer.toneMappingExposure = 1
    invalidate()
    return LED[led]
  }
  const lightPanel = (panel, front) => {
    const f = ledEnabled ? front : 0
    const back = 1 - front
    for (const u of [panel.face.userData.uniforms, panel.ghost.userData.uniforms]) {
      u.ledOn.value = f
      u.roomGlow.value = ledEnabled ? 0.12 * (1 - f) : 0.42
      u.veil.value = ledEnabled ? back : 0              // by day the others stand in the same light, a little behind
      u.dayRelief.value = ledEnabled ? 0 : 0.25 + 0.75 * front
    }
    panel.side.emissive.copy(ledEnabled ? ledMid : edge.emissive)
    panel.side.emissiveIntensity = ledEnabled ? 0.12 + 1.3 * f : 0.25 * (1 - 0.8 * back)
    panel.rimMat.color.setScalar(ledEnabled ? 0.06 + 0.94 * f : 1 - 0.8 * back)
    panel.rimMat.opacity = ledEnabled ? 0.3 + 0.3 * f : 0.45 * (1 - 0.6 * back)   // a quiet, even line
  }

  // Layout: the same coverflow as the image deck, in millimetres.
  let pos = start, aim = start, shown = -1, sway = 0, idleSince = performance.now(), spin = null
  const place = now => {
    panels.forEach(panel => {
      const d = panel.i - pos, ad = Math.abs(d)
      if (ad < 2.6 && !panel.group && !panel.loading) build(panel).catch(() => { panel.loading = false })
      if (ad > 9) release(panel)
      if (!panel.group) return
      panel.group.visible = ad < 3.6
      const reach = ad < 1 ? ad * 0.8 : 0.8 + (ad - 1) * 0.26
      const scale = 1 + 0.2 * (1 - smoothstep(0, 1, ad))        // the glass on stage is 20 % larger
      panel.group.position.set(Math.sign(d) * reach * GW, FLOOR * (scale - 1), -ad * 900)   // its foot stays on the floor
      let turn = -Math.max(-1.4, Math.min(1.4, d)) * 0.7
      if (ad < 0.5) turn += sway * (1 - ad * 2)
      // a bent glass seen straight on looks flat: on stage it turns a little so the bend shows
      if (/^Gebogen/.test(panel.combo.form)) turn -= 0.44 * (1 - smoothstep(0, 1, ad))   // right edge forward
      panel.group.rotation.y = turn
      panel.group.scale.setScalar(scale)
      panel.foot.scale.setScalar(1 / scale)
      panel.foot.material.opacity = 1 - smoothstep(0.3, 1.2, ad)
      // side glasses step back into the shadow
      const shade = 1 - Math.min(ad * (ledEnabled ? 0.72 : 0.06), ledEnabled ? 0.86 : 0.08)
      lightPanel(panel, 1 - smoothstep(0.12, 0.8, ad))
      for (const m of [panel.face, panel.ghost]) {
        m.color.setScalar(shade)
        m.envMapIntensity = (0.35 + shade * 0.65) * (ledEnabled ? 1 : 0.5 + 0.5 * (1 - smoothstep(0.12, 0.7, ad)))
        m.userData.uniforms.shade.value = 0.25 + shade * 0.75
      }
      panel.group.renderOrder = -Math.round(ad * 10)
    })
    const index = Math.round(Math.min(panels.length - 1, Math.max(0, pos)))
    if (index !== shown) { shown = index; onIndex?.(index) }
  }

  // Render only when something changes; a slow sway lets the light play over the front glass.
  let visible = false, frame = 0, dirty = true, last = 0, lastScroll = 0
  on(window, 'scroll', () => { lastScroll = performance.now() }, { passive: true })
  const invalidate = () => { dirty = true; if (!frame && visible) frame = requestAnimationFrame(tick) }
  const tick = now => {
    if (signal.aborted) return
    frame = 0
    // while the page scrolls the glass holds still, so the scroll keeps the whole frame budget
    if (!drag && now - lastScroll < 140) { last = 0; frame = setTimeout(() => { frame = requestAnimationFrame(tick) }, 140); return }
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
    sway = swaying ? Math.sin(idle / 1600) * 0.132 * Math.min(1, idle / 1200) : sway * 0.9
    const animating = moving || swaying || dirty || Math.abs(sway) > 0.001
    if (animating || autoLed) {
      if (autoLed) updateAuto(now)
      scene.updateMatrixWorld()
      place(now)
      scene.updateMatrixWorld()
      composer.render()
      dirty = false
      // the automatic colour alone needs no more than about 20 frames a second
      // the sway alone (nothing moves but the light on the glass) needs no more than 30 frames a second
      if (visible) frame = moving || dirty ? requestAnimationFrame(tick) : setTimeout(() => { frame = requestAnimationFrame(tick) }, animating ? 28 : 45)
    } else last = 0
  }
  const wake = () => { idleSince = performance.now(); invalidate() }

  const goTo = i => {
    spin = null
    aim = Math.max(0, Math.min(panels.length - 1, i))
    wake()
  }
  // Random glass: the deck rolls through the glasses in between and slows down on the chosen one.
  const random = () => {
    // at most 8 glasses away, at least 3 so the roll is visible
    const here = Math.round(aim), n = panels.length
    const options = []
    for (let d = 3; d <= 8; d++) for (const to of [here - d, here + d]) if (to >= 0 && to < n) options.push(to)
    const to = options[Math.floor(Math.random() * options.length)]
    if (reduced) return goTo(to)
    // load every glass on the way first, so the roll never passes an empty slot
    const lo = Math.max(0, Math.min(here, to) - 1), hi = Math.min(n - 1, Math.max(here, to) + 1)
    const pending = panels.slice(lo, hi + 1).filter(p => !p.group).map(p => p.loading ? new Promise(r => { const t = setInterval(() => { if (p.group || !p.loading) { clearInterval(t); r() } }, 50) }) : build(p).catch(() => {}))
    Promise.all(pending).then(() => {
      aim = to
      spin = { from: pos, to, t0: performance.now(), dur: Math.min(2800, 1100 + Math.abs(to - pos) * 70) }
      wake()
    })
    return to
  }

  // Input: drag or flick sideways, tap left or right, arrow keys.
  let drag = null
  on(deck, 'pointerdown', e => {
    if (e.target.closest('button')) return
    spin = null
    drag = { x: e.clientX, start: pos, lastX: e.clientX, lastT: performance.now(), v: 0, moved: false, id: e.pointerId }
    aim = pos
  })
  on(deck, 'pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return
    const dx = e.clientX - drag.x
    if (!drag.moved && Math.abs(dx) > 6) { drag.moved = true; deck.setPointerCapture(e.pointerId) }
    if (!drag.moved) return
    const now = performance.now()
    drag.v = (e.clientX - drag.lastX) / Math.max(1, now - drag.lastT)
    drag.lastX = e.clientX; drag.lastT = now
    const step = deck.clientWidth * 0.5
    let next = drag.start - dx / step
    if (next < 0) next *= 0.3
    if (next > panels.length - 1) next = panels.length - 1 + (next - panels.length + 1) * 0.3
    pos = aim = next
    wake()
  })
  const end = e => {
    if (!drag || e.pointerId !== drag.id) return
    const moved = drag.moved, v = drag.v
    drag = null
    if (moved) {
      const flick = Math.max(-3, Math.min(3, -v * 160 / (deck.clientWidth * 0.5)))
      goTo(Math.round(pos + flick))
    } else {
      const x = (e.clientX - deck.getBoundingClientRect().left) / deck.clientWidth
      goTo(Math.round(pos) + (x < 0.33 ? -1 : 1))
    }
  }
  on(deck, 'pointerup', end)
  on(deck, 'pointercancel', e => { if (drag) { drag.moved = true; drag.v = 0; end(e) } })
  on(deck, 'keydown', e => {
    if (e.key === 'ArrowRight') { e.preventDefault(); goTo(Math.round(aim) + 1) }
    if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(Math.round(aim) - 1) }
    if (e.key === 'Home') { e.preventDefault(); goTo(0) }
    if (e.key === 'End') { e.preventDefault(); goTo(panels.length - 1) }
  })

  let away = null
  const resize = () => {
    if (away?.parked) return
    const w = deck.clientWidth, h = deck.clientHeight
    renderer.setSize(w, h, false)
    composer.setPixelRatio(renderer.getPixelRatio())
    composer.setSize(w, h)
    room.parts.floor.resize(w * renderer.getPixelRatio() / 2, h * renderer.getPixelRatio() / 2)
    camera.aspect = w / h
    // keep the glass the same size on phones and desktops: frame the height
    camera.fov = 28
    camera.updateProjectionMatrix()
    invalidate()
  }
  const sizes = new ResizeObserver(resize)
  sizes.observe(deck)
  signal.addEventListener('abort', () => sizes.disconnect())
  const seen = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting
    if (visible) wake()
    else if (frame) { cancelAnimationFrame(frame); clearTimeout(frame); frame = 0 }
  })
  seen.observe(deck)
  signal.addEventListener('abort', () => seen.disconnect())

  away = parkWhenAway(deck, { signal, renderer, composer, mirror: () => room.parts.floor, resize, draw: () => composer.render() })

  deck.prepend(canvas)
  deck.classList.add('is-3d')
  resize()
  // wait for the first glasses before showing the canvas
  await Promise.all(panels.slice(Math.max(0, start - 1), start + 2).map(p => build(p)))
  setLight(LED.length - 1)                                    // the page switches the light on
  place(performance.now())
  await renderer.compileAsync(scene, camera).catch(() => {})
  composer.render()
  canvas.classList.add('is-ready')
  wake()
  const dispose = () => {
    life.abort()
    visible = false
    cancelAnimationFrame(frame); clearTimeout(frame)
    composer.dispose()
    renderer.dispose()
    renderer.forceContextLoss()
    canvas.remove()
    deck.classList.remove('is-3d')
  }
  return { setLight, light: () => led, random, step: d => goTo(Math.round(aim) + d), dispose }
}

// ------------------------------------------------------------------ geometry

function flat(outline) {
  const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x - GW / 2, y - GH / 2)))
  const geo = new THREE.ExtrudeGeometry(shape, { depth: T - 2, bevelEnabled: true, bevelThickness: 1, bevelSize: 1.2, bevelSegments: 2, curveSegments: 4 })
  geo.translate(0, 0, -(T - 2) / 2)
  const p = geo.attributes.position, uv = geo.attributes.uv
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / GW + 0.5, p.getY(i) / GH + 0.5)
  return geo
}

function bent(plan) {
  const geo = new THREE.BoxGeometry(GW, GH, T, 96, 1, 1)
  const p = geo.attributes.position
  for (let i = 0; i < p.count; i++) {
    const s = p.getX(i) + GW / 2, z = p.getZ(i)
    const { x, zc, nx, nz } = plan(s)
    p.setXYZ(i, x - GW / 2 + nx * z, p.getY(i), zc + nz * z)
  }
  geo.computeVertexNormals()
  return geo
}
function planC(s) {                       // one arc, radius 900 mm
  const R = 900, a = (s - GW / 2) / R
  return { x: GW / 2 + R * Math.sin(a), zc: -R * (1 - Math.cos(a)) + 120, nx: -Math.sin(a), nz: Math.cos(a) }
}
function planJ(s) {                       // straight run, then a tight bend of radius 260 mm
  const L = 690, R = 260
  if (s <= L) return { x: s, zc: 0, nx: 0, nz: 1 }
  const a = (s - L) / R
  return { x: L + R * Math.sin(a), zc: -R * (1 - Math.cos(a)), nx: -Math.sin(a), nz: Math.cos(a) }
}

function rimGeometry(form, forms) {
  const path = new THREE.CurvePath()
  const add = pts => { for (let i = 0; i < pts.length - 1; i++) path.add(new THREE.LineCurve3(pts[i], pts[i + 1])) }
  if (form === 'Gebogen C' || form === 'Gebogen J') {
    const plan = form === 'Gebogen C' ? planC : planJ
    const line = y => Array.from({ length: 49 }, (_, i) => { const p = plan(i / 48 * GW); return new THREE.Vector3(p.x - GW / 2, y, p.zc) })
    const top = line(GH / 2), bottom = line(-GH / 2).reverse()
    add([...top, ...bottom, top[0]])
  } else {
    const pts = forms[form].map(([x, y]) => new THREE.Vector3(x - GW / 2, y - GH / 2, 0))
    add([...pts, pts[0]])
  }
  // thick enough to stay a continuous line on screen (a thinner tube breaks up into dashes); the
  // tube samples the outline evenly along its length, so it needs a sample every few millimetres
  // or it cuts across the corners
  return new THREE.TubeGeometry(path, Math.min(2400, Math.ceil(path.getLength() / 5)), 6.5, 6, false)
}

// ------------------------------------------------------------------ light and room

// The showroom: a bathroom – a back wall of vein-cut travertine with a lit niche, a honed
// travertine floor that mirrors the room, a window on the left with a palm outside whose fronds
// throw their dappled shadow across the wall and the floor, a cove of light along the ceiling, a
// rain shower, a teak bench with a towel, a monstera. By day the sun lights the room; with the
// LED on it is evening, the cove and the niche alone stay lit. The reflections are the room.
function showroom(renderer, scene, lite, hooks) {
  const group = new THREE.Group()
  const CEIL = 2350, BACK = -2600, SIDE = 3600, FRONT = 9200          // the camera stands inside, at 7300
  const wallStone = surface(travertine({ color: '#e9e0d0', dark: '#bca98c', seed: 61, polish: 0.42 }), { w: 2400, h: 2400 }, { envMapIntensity: 0.7 })
  const floorStone = surface(travertine({ color: '#d6cab6', dark: '#a69378', seed: 77, polish: 0.16, pits: 0.5 }), { w: 2200, h: 2200 })
  const wallPlaster = surface(plaster({ color: '#efece6', seed: 5 }), { w: 2000, h: 2000 })
  const ceilPlaster = surface(plaster({ color: '#f5f3ee', clouds: 0.03, seed: 8 }), { w: 2000, h: 2000 })

  // the back wall in pieces around the niche, the pattern running on across them
  const NX = -1500, NY = 1150, NW = 640, NH = 340
  const backPiece = (x0, x1, y0, y1) => { const m = slab(wallStone, x1 - x0, y1 - y0, [x0 + SIDE, y0 - FLOOR]); m.position.set((x0 + x1) / 2, (y0 + y1) / 2, BACK); group.add(m) }
  backPiece(-SIDE, NX - NW / 2, FLOOR, CEIL); backPiece(NX + NW / 2, SIDE, FLOOR, CEIL)
  backPiece(NX - NW / 2, NX + NW / 2, FLOOR, NY - NH / 2); backPiece(NX - NW / 2, NX + NW / 2, NY + NH / 2, CEIL)
  const nook = niche({ w: NW, h: NH, depth: 120, material: wallStone, lit: 3 })
  nook.position.set(NX, NY, BACK)
  group.add(nook)
  const floor = mirrorFloor(floorStone, 2 * SIDE, FRONT - BACK, { strength: 0.6, ...hooks }); floor.rotation.x = -Math.PI / 2; floor.position.set(0, FLOOR, (FRONT + BACK) / 2)
  const ceiling = slab(ceilPlaster, 2 * SIDE, FRONT - BACK); ceiling.rotation.x = Math.PI / 2; ceiling.position.set(0, CEIL, (FRONT + BACK) / 2)
  const right = slab(wallPlaster, FRONT - BACK, CEIL - FLOOR); right.rotation.y = -Math.PI / 2; right.position.set(SIDE, (CEIL + FLOOR) / 2, (FRONT + BACK) / 2)
  const front = slab(wallPlaster, 2 * SIDE, CEIL - FLOOR); front.rotation.y = Math.PI; front.position.set(0, (CEIL + FLOOR) / 2, FRONT)   // behind the camera: what the chrome and the glass mirror
  group.add(floor, ceiling, right, front)
  // the left wall with the window opening: the wall in four pieces around it
  const WX0 = BACK + 700, WX1 = BACK + 2300, WY0 = -300, WY1 = 1900                     // window in z and y
  const piece = (z0, z1, y0, y1) => { const m = slab(wallPlaster, z1 - z0, y1 - y0); m.rotation.y = Math.PI / 2; m.position.set(-SIDE, (y0 + y1) / 2, (z0 + z1) / 2); return m }
  group.add(piece(BACK, WX0, FLOOR, CEIL), piece(WX1, FRONT, FLOOR, CEIL), piece(WX0, WX1, FLOOR, WY0), piece(WX0, WX1, WY1, CEIL))
  // the window and, outside, the sky and the palm: seen through the window, mirrored in the
  // glass, and between the sun and the window, so its fronds dapple the room
  const win = windowFrame({ w: WX1 - WX0, h: WY1 - WY0 })
  win.rotation.y = Math.PI / 2; win.position.set(-SIDE, (WY0 + WY1) / 2, (WX0 + WX1) / 2)
  group.add(win)
  const sky = win.userData.sky
  const tree = palm({ width: 5600, seed: 5 })
  tree.rotation.y = Math.PI / 2; tree.position.set(-SIDE - 1400, 700, -300)
  group.add(tree)
  // the bench with its towel, the plant
  const seat = bench({ width: 900 }); seat.position.set(2050, FLOOR, BACK + 520); seat.rotation.y = -0.08; group.add(seat)
  const plant = monstera({ height: 1150, seed: 4 }); plant.position.set(-2050, FLOOR, BACK + 900); group.add(plant)

  // the rain shower on the back wall, the drain in the floor
  const metal = chrome()
  const fitting = (geo, x, y, z, rx = 0, rz = 0) => { const m = new THREE.Mesh(geo, metal); m.position.set(x, y, z); m.rotation.set(rx, 0, rz); m.castShadow = true; group.add(m); return m }
  fitting(new THREE.CylinderGeometry(11, 11, 420, 24), 1500, 1830, BACK + 210, Math.PI / 2)      // the arm
  fitting(new THREE.CylinderGeometry(130, 130, 10, 48), 1500, 1830, BACK + 420)                  // the rain head
  fitting(new THREE.CylinderGeometry(60, 60, 12, 32), 1500, 1830, BACK + 6, Math.PI / 2)        // its rosette
  fitting(new THREE.CylinderGeometry(70, 70, 12, 32), 1500, 150, BACK + 6, Math.PI / 2)         // the mixer plate
  fitting(new THREE.CylinderGeometry(20, 22, 90, 24), 1500, 150, BACK + 50, Math.PI / 2)        // its lever body
  fitting(new THREE.CylinderGeometry(6, 6, 110, 16), 1500, 100, BACK + 95, 0.35)
  const drain = new THREE.Mesh(new THREE.BoxGeometry(700, 2, 60), brushed()); drain.position.set(1500, FLOOR + 1.5, BACK + 160); group.add(drain)
  const slot = new THREE.Mesh(new THREE.BoxGeometry(660, 2, 14), new THREE.MeshStandardMaterial({ color: '#1a1917', roughness: 0.8 })); slot.position.set(1500, FLOOR + 2.6, BACK + 160); group.add(slot)

  // the light: the sun through the shutters, the sky, the cove along the back wall
  const sun = sunlight({ color: '#fff7ee', position: [-6500, 3600, 2200], target: [1200, FLOOR, -1800], extent: 4200, far: 18000, mapSize: lite ? 1024 : 2048 })
  sun.shadow.radius = 5
  const sky2 = new THREE.HemisphereLight('#eef3f8', '#a89c90', 0.7)
  const strip = cove({ width: 2 * SIDE - 200, height: 50, color: '#fff2dc', intensity: 5, position: [0, CEIL - 40, BACK + 110], lookAt: [0, FLOOR, BACK - 700] })
  const lip = new THREE.Mesh(new THREE.BoxGeometry(2 * SIDE, 90, 140), ceilPlaster); lip.position.set(0, CEIL - 45, BACK + 200); lip.castShadow = true
  group.add(sun, sun.target, sky2, strip, lip)
  scene.add(group)

  // the reflections of the room, by day and in the evening, taken from the middle of the stage
  const envs = {}
  const take = mode => {
    if (!envs[mode]) { apply(mode); envs[mode] = roomEnvironment(renderer, scene, [0, 300, 600], scene.children.filter(o => o !== group)) }
    return envs[mode]
  }
  const apply = mode => {
    const day = mode === 'day'
    sun.intensity = day ? 1.9 : 0
    sky2.intensity = day ? 0.8 : 0.7
    sky2.color.set(day ? '#eef3f8' : '#8a7a68'); sky2.groundColor.set(day ? '#b5aa9e' : '#2a241f')
    strip.userData.light.intensity = day ? 4 : 18
    strip.userData.strip.material.color.set(day ? '#fff6e8' : '#ffd9a8').multiplyScalar(day ? 3 : 2.5); strip.userData.light.color.set(day ? '#fff2dc' : '#ffd9a8')
    sky.material.color.set(day ? '#ffffff' : '#3a4a68').multiplyScalar(day ? 5 : 1.2)
    tree.material.color.set(day ? '#3d6d3a' : '#101a14')
    nook.userData.light.userData.light.intensity = day ? 3 : 7
    scene.environmentIntensity = day ? 1 : 0.75
  }
  const setMode = mode => { const env = take(mode); apply(mode); scene.environment = env }
  return { group, setMode, parts: { floor, sun, rect: [strip] } }
}

