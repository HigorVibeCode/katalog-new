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

const GW = 1050, GH = 2100, T = 10                        // mm
export const LED = [
  { name: 'Automatisch', auto: true },                      // the colour changes by itself, slowly
  { name: 'Violett · Türkis', a: '#b24dff', b: '#18d8f0' },
  { name: 'Türkis', a: '#16d6e0', b: '#16d6e0' },
  { name: 'Warmweiss', a: '#ffbe73', b: '#ffbe73' },
  { name: 'Ohne Licht', a: null, b: null },
]
const smoothstep = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t) }
// A sharp highlight on the polished glass can exceed what the half-float bloom buffers hold
// (65504) and turn the whole frame black on some graphics cards; every glass material keeps its
// output below that (as in lavabo3d.js).
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
const slug = name => name.toLowerCase().replace(/ /g, '-').replace(/ä/g, 'ae')

export async function initDeck3D({ deck, combos, base = 'media/glas/', onIndex, reduced = false, start = 0 }) {
  const forms = await (await fetch(`${base}formen.json`)).json()
  const canvas = document.createElement('canvas')
  canvas.className = 'deck-canvas'
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
  if (!renderer.capabilities.isWebGL2) throw new Error('WebGL2 nicht verfügbar')
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  renderer.outputColorSpace = THREE.SRGBColorSpace
  if ('transmissionResolutionScale' in renderer) renderer.transmissionResolutionScale = 0.75

  const scene = new THREE.Scene()
  const envDark = studio(renderer, false)
  scene.environment = envDark
  const room = showroom()
  scene.add(room.mesh)

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
  const build = async panel => {
    panel.loading = true
    const key = panel.combo.maps
    const [normalMap, escape, edges] = await Promise.all([texture(`${base}n-${key}.webp`), texture(`${base}s-${key}.webp`), edgeMap(panel.combo.form)])
    const face = glass(normalMap, escape, edges, panel.combo.float)
    const geo = geometry(panel.combo.form)
    const side = capped(edge.clone()), rimMat = rimMaterial.clone()
    const mesh = new THREE.Mesh(geo, geo.type === 'BoxGeometry' ? [side, side, side, side, face, face] : [face, side])
    const group = new THREE.Group()
    group.add(mesh, new THREE.Mesh(rim(panel.combo.form), rimMat))
    scene.add(group)
    Object.assign(panel, { group, face, side, rimMat, maps: [normalMap, escape], loading: false })
    invalidate()
  }
  const release = panel => {
    if (!panel.group) return
    scene.remove(panel.group)
    panel.face.dispose(); panel.side.dispose(); panel.rimMat.dispose()
    panel.maps.forEach(t => t.dispose())
    Object.assign(panel, { group: null, face: null, side: null, rimMat: null, maps: null })
  }

  // The glass: clear, with the kiln crinkle added to the surface normal, and LED light escaping
  // where the surface tilts (escape map), strongest near the lit edges (edge map).
  // Float glass (isFloat): clear and flat, no kiln texture; the escape map is the sandblasted design,
  // which turns satin, scatters the room light and catches the LED.
  const glass = (normalMap, escape, edges, isFloat = false) => {
    const m = new THREE.MeshPhysicalMaterial({
      color: '#ffffff', metalness: 0, roughness: 0.1, transmission: 1, thickness: 90, ior: 1.5,
      attenuationColor: '#d6eee4', attenuationDistance: 1400, specularIntensity: 1, envMapIntensity: 1,
      normalMap, normalScale: new THREE.Vector2(1.5, 1.5),
    })
    const own = { crinkleMap: { value: crinkle }, crinkleRepeat: { value: new THREE.Vector2(2.02, 4.04) }, crinkleScale: { value: isFloat ? 0 : 1.7 }, floatGlass: { value: isFloat ? 1 : 0 },
      escapeMap: { value: escape }, edgeMap: { value: edges }, shade: { value: 1 },
      ledOn: { value: 0 }, roomGlow: { value: 0.42 }, veil: { value: 0 } }
    m.userData.uniforms = own
    m.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, own, shared)
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
uniform sampler2D crinkleMap; uniform vec2 crinkleRepeat; uniform float crinkleScale;
uniform sampler2D escapeMap; uniform sampler2D edgeMap;
uniform vec3 ledA; uniform vec3 ledB; uniform float ledOn; uniform float shade; uniform float roomGlow;
uniform float floatGlass;
uniform float veil;
float frostAmt = 0.0;
float crinkleSpark = 0.0;
float facing = 0.0;`)
        .replace('#include <dithering_fragment>', `
	// glasses behind the stage: a dark, desaturating veil so they never compete with the front one
	gl_FragColor.rgb = mix( gl_FragColor.rgb, vec3( dot( gl_FragColor.rgb, vec3( 0.299, 0.587, 0.114 ) ) ), veil * 0.85 ) * ( 1.0 - 0.74 * veil );
	#include <dithering_fragment>`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
	frostAmt = floatGlass * texture2D( escapeMap, vNormalMapUv ).r;
	roughnessFactor = mix( roughnessFactor, 0.62, frostAmt );
	diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.93, 0.96, 0.95 ), frostAmt );`)
        .replace('#include <transmission_fragment>', THREE.ShaderChunk.transmission_fragment.replace('material.transmission = transmission;', 'material.transmission = transmission * ( 1.0 - 0.72 * frostAmt );'))
        .replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps.replace('mapN.xy *= normalScale;', `mapN.xy *= normalScale;
	vec3 detN = texture2D( crinkleMap, vNormalMapUv * crinkleRepeat ).xyz * 2.0 - 1.0;
	detN.xy *= crinkleScale;
	crinkleSpark = length( detN.xy );
	vec2 macroXY = mapN.xy;
	mapN = normalize( vec3( mapN.xy + detN.xy, mapN.z * detN.z ) );
	// facets and relief flanks turned towards the window (upper left) are bright, the others dark
	facing = dot( macroXY * 3.2 + detN.xy * 1.1, normalize( vec2( -0.8, 0.55 ) ) );
	diffuseColor.rgb *= 1.0 - roomGlow * clamp( - facing * 1.3, 0.0, 0.65 );`))
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
	{
		float esc = texture2D( escapeMap, vNormalMapUv ).r;
		float lit = texture2D( edgeMap, vNormalMapUv ).r;
		vec3 led = mix( ledA, ledB, vNormalMapUv.x );
		float spark = smoothstep( 0.12, 0.65, crinkleSpark );
		// sandblasted float: the frost scatters the light softly, paler than the LED colour, with a
		// fine satin grain, and fades away from the lit edges instead of glowing flat
		float grain = 0.55 + 0.9 * length( texture2D( crinkleMap, vNormalMapUv * crinkleRepeat * 2.3 ).xy * 2.0 - 1.0 );
		vec3 ledF = mix( led, vec3( 1.0 ), 0.22 * floatGlass );
		float escF = esc * mix( 1.5, 3.0 * grain * ( 0.3 + 0.7 * lit ), floatGlass );
		// clear float glass carries no glow of its own: only the frosted design lights up
		totalEmissiveRadiance += ledF * ledOn * shade * lit * ( 0.03 * ( 1.0 - floatGlass ) + escF + 0.45 * spark * spark );
		// room light scattered by the facets and the relief: the silvery look of the glass by day
		totalEmissiveRadiance += vec3( 0.86, 0.9, 0.88 ) * roomGlow * shade * ( ( 0.03 + 0.08 * spark ) * ( 1.0 - floatGlass ) + 0.8 * clamp( facing, 0.0, 1.0 ) + 0.16 * esc * ( 1.0 - floatGlass ) );
		// sandblasted areas: a soft satin glow, much brighter with the LED
		totalEmissiveRadiance += vec3( 0.86, 0.9, 0.88 ) * frostAmt * shade * ( 0.07 + roomGlow * 0.7 ) * grain;
	}`)
    }
    m.customProgramCacheKey = () => 'kiln-glass-6'
    return capped(m)
  }

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
    room.setLit(false)
    scene.environment = envDark
    scene.environmentIntensity = ledEnabled ? 0.55 : 1.6
    bloom.strength = ledEnabled ? 0.65 : 0.25
    invalidate()
    return LED[led]
  }
  const lightPanel = (panel, front) => {
    const f = ledEnabled ? front : 0
    const u = panel.face.userData.uniforms
    u.ledOn.value = f
    u.roomGlow.value = ledEnabled ? 0.12 * (1 - f) : 0.42 * (0.12 + 0.88 * front)
    panel.side.emissive.copy(ledEnabled ? ledMid : edge.emissive)
    const back = 1 - front
    u.veil.value = back
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
      panel.group.position.set(Math.sign(d) * reach * GW, 0, -ad * 900)
      let turn = -Math.max(-1.4, Math.min(1.4, d)) * 0.7
      if (ad < 0.5) turn += sway * (1 - ad * 2)
      // a bent glass seen straight on looks flat: on stage it turns a little so the bend shows
      if (/^Gebogen/.test(panel.combo.form)) turn -= 0.44 * (1 - smoothstep(0, 1, ad))   // right edge forward
      panel.group.rotation.y = turn
      panel.group.scale.setScalar(1 + 0.2 * (1 - smoothstep(0, 1, ad)))   // the glass on stage is 20 % larger
      // side glasses step back into the shadow
      const shade = 1 - Math.min(ad * 0.72, 0.86)
      lightPanel(panel, 1 - smoothstep(0.12, 0.8, ad))
      panel.face.color.setScalar(shade)
      panel.face.envMapIntensity = (0.35 + shade * 0.65) * (ledEnabled ? 1 : 0.2 + 0.8 * (1 - smoothstep(0.12, 0.7, ad)))
      panel.face.userData.uniforms.shade.value = 0.25 + shade * 0.75
      panel.group.renderOrder = -Math.round(ad * 10)
    })
    const index = Math.round(Math.min(panels.length - 1, Math.max(0, pos)))
    if (index !== shown) { shown = index; onIndex?.(index) }
  }

  // Render only when something changes; a slow sway lets the light play over the front glass.
  let visible = false, frame = 0, dirty = true, last = 0, lastScroll = 0
  addEventListener('scroll', () => { lastScroll = performance.now() }, { passive: true })
  const invalidate = () => { dirty = true; if (!frame && visible) frame = requestAnimationFrame(tick) }
  const tick = now => {
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
      if (visible) frame = animating ? requestAnimationFrame(tick) : setTimeout(() => { frame = requestAnimationFrame(tick) }, 45)
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
    // keep the glass the same size on phones and desktops: frame the height
    camera.fov = 28
    camera.updateProjectionMatrix()
    invalidate()
  }
  new ResizeObserver(resize).observe(deck)
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting
    if (visible) wake()
    else if (frame) { cancelAnimationFrame(frame); clearTimeout(frame); frame = 0 }
  }).observe(deck)

  deck.prepend(canvas)
  deck.classList.add('is-3d')
  resize()
  // wait for the first glasses before showing the canvas
  await Promise.all(panels.slice(Math.max(0, start - 1), start + 2).map(p => build(p)))
  setLight(LED.length - 1)                                    // the page switches the light on
  place(performance.now())
  composer.render()
  canvas.classList.add('is-ready')
  wake()
  return { setLight, light: () => led, random, step: d => goTo(Math.round(aim) + d) }
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

// Reflections. Lit room: white walls, a large window on the left and a ceiling light, so the
// crinkle facets mirror many brightnesses and the glass reads silvery. Dark room (LED on): only
// faint softboxes at the sides. Never a light source straight in front of the glass.
function studio(renderer, lit) {
  const env = new THREE.Scene()
  const k = lit ? 0.62 : 0.06
  const room = new THREE.Mesh(new THREE.BoxGeometry(40, 30, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(k, k * 1.01, k * 0.98), side: THREE.BackSide }))
  room.position.y = 6
  env.add(room)
  const box = (w, h, x, y, z, v) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(v, v, v * 0.97), side: THREE.DoubleSide }))
    m.position.set(x, y, z); m.lookAt(0, 4, 0); env.add(m)
  }
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(k * 0.45, k * 0.44, k * 0.42) }))
  floor.rotation.x = -Math.PI / 2; floor.position.y = -8.9; env.add(floor)
  if (lit) {
    box(10, 12, -19, 6, 3, 6)          // window on the left
    box(16, 3, 0, 20.5, 0, 3.5)        // ceiling light
    box(4, 14, 18, 5, -6, 2)           // reflection of a pale wall on the right
    box(8, 3, -6, -4, 15, 0.25)        // a darker object in front: gives the facets contrast
  } else {
    box(5, 16, -16, 5, -2, 3)
    box(5, 16, 16, 5, -3, 2.4)
    box(18, 2.5, 0, 19, -2, 1.6)
  }
  const pmrem = new THREE.PMREMGenerator(renderer)
  const texture = pmrem.fromScene(env, 0.02).texture
  pmrem.dispose()
  return texture
}

// The room behind the glasses: a plain plaster wall and floor, lit softly from the left like a
// window. No spots or light strips behind the glass. With the LED on the room light is dimmed.
function showroom() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 644
  const g = c.getContext('2d')
  const W = c.width, H = c.height
  const floorY = (0.5 + (GH / 2) / 4400) * H
  let grad = g.createLinearGradient(0, 0, W, 0)
  grad.addColorStop(0, '#d9d6cf'); grad.addColorStop(0.55, '#b9b6af'); grad.addColorStop(1, '#8f8c86')
  g.fillStyle = grad; g.fillRect(0, 0, W, floorY)
  grad = g.createLinearGradient(0, 0, 0, floorY)
  grad.addColorStop(0, 'rgba(0,0,0,.22)'); grad.addColorStop(0.5, 'rgba(0,0,0,0)'); grad.addColorStop(1, 'rgba(0,0,0,.12)')
  g.fillStyle = grad; g.fillRect(0, 0, W, floorY)
  const img = g.getImageData(0, 0, W, Math.ceil(floorY))                       // fine plaster mottling
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 7
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n
  }
  g.putImageData(img, 0, 0)
  grad = g.createLinearGradient(0, floorY, 0, H)
  grad.addColorStop(0, '#5e5b56'); grad.addColorStop(1, '#2a2826')
  g.fillStyle = grad; g.fillRect(0, floorY, W, H - floorY)
  g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(0, floorY - 2, W, 3)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  const material = new THREE.MeshBasicMaterial({ map: t, toneMapped: true })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(7000, 4400), material)
  mesh.position.set(0, 0, -2600)
  return { mesh, setLit: lit => material.color.setScalar(lit ? 0.9 : 0.07) }
}
