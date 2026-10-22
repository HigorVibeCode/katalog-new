// Kiln-formed glass shared by the 3D scenes (deck3d.js, panel3d.js): the glass material with its
// crinkle, structure, relief and LED light escaping where the surface tilts, the cap that keeps
// bright highlights inside the bloom buffers, and the reflections of the room.
import * as THREE from 'three'

export const smoothstep = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t) }
// A sharp highlight on the polished glass can exceed what the half-float bloom buffers hold
// (65504) and turn the whole frame black on some graphics cards; every glass material keeps its
// output below that (as in lavabo3d.js).
export const capped = m => {
  const before = m.onBeforeCompile
  m.onBeforeCompile = (shader, renderer) => {
    if (before !== THREE.Material.prototype.onBeforeCompile) before.call(m, shader, renderer)
    shader.fragmentShader = shader.fragmentShader.replace('#include <dithering_fragment>', 'gl_FragColor.rgb = min( gl_FragColor.rgb, vec3( 64.0 ) );\n\t#include <dithering_fragment>')
  }
  const key = m.customProgramCacheKey.bind(m)
  m.customProgramCacheKey = () => key() + '-capped'
  return m
}

// The glass: clear, with the kiln crinkle added to the surface normal, and LED light escaping
// where the surface tilts (escape map), strongest near the lit edges (edge map).
// Float glass (isFloat): clear and flat, no kiln texture; the escape map is the sandblasted design,
// which turns satin, scatters the room light and catches the LED.
export function kilnGlass({ crinkle, shared }, normalMap, escape, edges, isFloat = false, reliefNormal, relief, bare = false) {
  const m = new THREE.MeshPhysicalMaterial({
    color: '#ffffff', metalness: 0, roughness: 0.1, transmission: 1, thickness: 90, ior: 1.5,
    attenuationColor: '#d6eee4', attenuationDistance: 1400, specularIntensity: 1, envMapIntensity: 1,
    normalMap, normalScale: new THREE.Vector2(1.5, 1.5),
  })
  const own = { crinkleMap: { value: crinkle }, crinkleRepeat: { value: new THREE.Vector2(2.02, 4.04) }, crinkleScale: { value: isFloat ? 0 : 1.7 }, floatGlass: { value: isFloat ? 1 : 0 },
    escapeMap: { value: escape }, edgeMap: { value: edges }, shade: { value: 1 },
    ledOn: { value: 0 }, roomGlow: { value: 0.42 }, veil: { value: 0 }, dayRelief: { value: 0 },
    reliefNormal: { value: reliefNormal }, reliefMap: { value: relief }, structGain: { value: bare ? 1.25 : 1 } }
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
uniform float dayRelief;
uniform sampler2D reliefNormal; uniform sampler2D reliefMap; uniform float structGain;
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
      .replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps.replace('vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;', `vec3 mapN;
	{
		vec3 sN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
		vec3 rN = texture2D( reliefNormal, vNormalMapUv ).xyz * 2.0 - 1.0;
		float keep = texture2D( reliefMap, vNormalMapUv ).b;
		vec2 g = sN.xy / max( sN.z, 0.2 ) * structGain * mix( 0.12, 1.0, keep ) + rN.xy / max( rN.z, 0.2 );
		mapN = normalize( vec3( g, 1.0 ) );
	}`).replace('mapN.xy *= normalScale;', `mapN.xy *= normalScale;
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
		vec4 rel4 = texture2D( reliefMap, vNormalMapUv );
		float esc = clamp( texture2D( escapeMap, vNormalMapUv ).r * mix( 0.12, 1.0, rel4.b ) * ( 1.0 - floatGlass ) + texture2D( escapeMap, vNormalMapUv ).r * floatGlass + rel4.r, 0.0, 1.0 );
		float lit = texture2D( edgeMap, vNormalMapUv ).r;
		vec3 led = mix( mix( ledA, ledB, vNormalMapUv.x ), vec3( 1.0 ), 0.3 );   // paler than the LED itself, as the light spreads through the glass
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
		// LED off: the relief (G of the escape map) carries a soft satin sheen of its own, so the
		// drawing reads a shade lighter than the structure around it
		float rel = rel4.g * ( 1.0 - floatGlass );
		totalEmissiveRadiance += vec3( 0.86, 0.9, 0.88 ) * dayRelief * shade * rel * ( 0.045 + 0.11 * clamp( facing + 0.5, 0.0, 1.0 ) );
	}`)
  }
  m.customProgramCacheKey = () => 'kiln-glass-9'
  return capped(m)
}

// Reflections. Lit room: white walls, a large window on the left and a ceiling light, so the
// crinkle facets mirror many brightnesses and the glass reads silvery. Dark room (LED on): only
// faint softboxes at the sides. Never a light source straight in front of the glass.
export function studio(renderer, lit) {
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
