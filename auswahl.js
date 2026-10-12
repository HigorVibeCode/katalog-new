// „Ihr Glas gestalten“: the selector of each chapter. A page rises over the catalogue and walks
// through the steps of the chapter (auswahl.json, from scripts/auswahl-data.py); at the end it
// shows the chosen glass in 3D, the real photos that match it, and sends the selection by e-mail.
// The rules live in the data: a step with "when" is shown only when the choices so far match it.

const IMG = 'media/'
const LIGHT_ORDER = ['auto', 'violett-tuerkis', 'tuerkis', 'warmweiss', 'ohne']   // as the decks' light button
const NUMBERS = { trennwand: '01', lavabo: '02', rueckwand: '03' }

let data = null, ui = null, state = null, opts = {}, preview = null, sprites = {}

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue
    if (k === 'class') e.className = v
    else if (k === 'html') e.innerHTML = v
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v)
    else e.setAttribute(k, v === true ? '' : v)
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid)
  return e
}

// ------------------------------------------------------------------ rules

const chapterOf = () => data.chapters[state.chapter]
const option = (stepId, id) => chapterOf().steps.find(s => s.id === stepId)?.options.find(o => o.id === id)
// a value the rules can ask for: a choice, or the group of the chosen lavabo model
const valueOf = key => key === 'group' ? option('modell', state.sel.modell)?.group : state.sel[key]
const matches = (want, have) => want.some(w => w.startsWith('!') ? have !== undefined && have !== w.slice(1) : have === w)
const visible = step => !step.when || Object.entries(step.when).every(([k, want]) => matches(want, valueOf(k)))
const steps = () => chapterOf().steps.filter(visible)

// drop choices that no longer fit; optional steps start on their first option
function settle() {
  for (let pass = 0; pass < 3; pass++) {
    for (const step of chapterOf().steps) {
      if (!visible(step)) delete state.sel[step.id]
      else if (state.sel[step.id] && !step.options.some(o => o.id === state.sel[step.id])) delete state.sel[step.id]
      else if (step.optional && !state.sel[step.id]) state.sel[step.id] = step.options[0].id
    }
  }
}
const complete = () => steps().every(s => state.sel[s.id])

// ------------------------------------------------------------------ pictures

function countSprites() {
  for (const ch of Object.values(data.chapters)) for (const st of ch.steps) for (const o of st.options) {
    if (o.sprite) sprites[o.sprite[0]] = Math.max(sprites[o.sprite[0]] ?? 0, o.sprite[1] + 1)
  }
}
const FORMAT_ICONS = {
  nische: 'M4 20h56v12H4z', hoch: 'M18 4h28v40H18z', welle: 'M4 20c10-8 18 4 28-2s18-6 28 2v16H4z',
  bogen: 'M4 26h30V14a14 14 0 0 1 26 0v22H4z', schwung: 'M10 6h22c6 0 6 10 14 16s14 6 14 6v12H10z',
}
function picture(stepId, o) {
  if (o.svg) return el('i', { class: 'aw-pic aw-pic--svg', html: o.svg })
  if (o.sprite) {
    const [name, i] = o.sprite, rows = Math.ceil(sprites[name] / 8)
    const x = (i % 8) / 7 * 100, y = rows > 1 ? Math.floor(i / 8) / (rows - 1) * 100 : 0
    return el('i', { class: 'aw-pic aw-pic--img', style: `background-image:url(${IMG}auswahl-${name}.webp);background-size:800% auto;background-position:${x}% ${y}%` })
  }
  if (o.swatch) return el('i', { class: 'aw-pic aw-pic--swatch', style: `background:${o.swatch}` })
  if (stepId === 'format' && FORMAT_ICONS[o.id]) {
    return el('i', { class: 'aw-pic aw-pic--svg', html: `<svg viewBox="0 0 64 48"><path d="${FORMAT_ICONS[o.id]}" fill="rgba(200,235,225,.12)" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>` })
  }
  return null
}

// ------------------------------------------------------------------ building the page

function build() {
  ui = {}
  ui.root = el('div', { class: 'aw', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'aw-title', hidden: true })
  ui.where = el('span', { class: 'aw-where' })
  ui.count = el('span', { class: 'aw-count' })
  ui.close = el('button', { class: 'aw-close', type: 'button', 'aria-label': 'Schliessen', onclick: () => close() }, '×')
  ui.bar = el('div', { class: 'aw-bar', 'aria-hidden': 'true' })
  ui.body = el('div', { class: 'aw-body' })
  ui.chips = el('div', { class: 'aw-chips', 'aria-label': 'Ihre Auswahl' })
  ui.back = el('button', { class: 'aw-back', type: 'button', onclick: () => go(state.at - 1) }, '← Zurück')
  ui.next = el('button', { class: 'aw-next', type: 'button', onclick: () => go(state.at + 1) }, 'Weiter →')
  ui.send = el('a', { class: 'aw-next aw-send', hidden: true }, 'Diese Auswahl anfragen')
  ui.root.append(
    el('div', { class: 'aw-sheet' },
      el('header', { class: 'aw-head' }, el('div', {}, ui.where, ui.count), ui.close),
      ui.bar,
      ui.body,
      el('footer', { class: 'aw-foot' }, ui.chips, el('div', { class: 'aw-nav' }, ui.back, ui.next, ui.send))))
  document.body.append(ui.root)
  ui.root.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); close() } })
  addEventListener('popstate', () => { if (!ui.root.hidden) close(true) })
}

function render() {
  settle()
  const list = steps(), last = state.at >= list.length
  const ch = chapterOf()
  ui.where.textContent = `${NUMBERS[state.chapter]} ${ch.title} · Ihr Glas gestalten`
  ui.count.textContent = last ? 'Ihre Auswahl' : `Schritt ${state.at + 1} von ${list.length}`
  ui.bar.replaceChildren(...list.map((s, i) => el('i', { class: i < state.at ? 'done' : i === state.at ? 'now' : '' })), el('i', { class: last ? 'now' : '' }))
  ui.chips.replaceChildren(...list.filter(s => state.sel[s.id]).map(s => {
    const i = list.indexOf(s)
    return el('button', { type: 'button', class: i === state.at ? 'is-here' : '', onclick: () => go(i), 'aria-label': `${s.title} ändern: ${option(s.id, state.sel[s.id]).name}` },
      el('small', {}, s.title), option(s.id, state.sel[s.id]).name)
  }))
  ui.back.hidden = state.at === 0
  ui.chips.hidden = last                                   // the result lists the choices itself
  ui.send.hidden = !last
  if (last) { ui.next.hidden = true; ui.send.href = mailto(); return renderResult() }
  ui.next.hidden = false
  const step = list[state.at]
  ui.next.disabled = !state.sel[step.id]
  ui.next.textContent = state.at === list.length - 1 ? 'Ihre Auswahl ansehen →' : 'Weiter →'
  renderStep(step)
}

function renderStep(step) {
  const grid = el('div', { class: `aw-grid aw-grid--${step.id}`, role: 'radiogroup', 'aria-labelledby': 'aw-title' })
  let filter = null
  const groups = chapterOf().groups
  const fill = () => grid.replaceChildren(...step.options.filter(o => !filter || o.group === filter).map(o => {
    const on = state.sel[step.id] === o.id
    return el('button', { type: 'button', role: 'radio', 'aria-checked': String(on), class: 'aw-opt' + (on ? ' is-on' : '') + (picture(step.id, o) ? '' : ' aw-opt--text'),
      onclick: () => pick(step, o) },
      picture(step.id, o), el('b', {}, o.name), o.note && el('small', {}, o.note))
  }))
  fill()
  // the 50 lavabo models: a filter by kind
  const tabs = step.id === 'modell' && groups ? el('div', { class: 'aw-tabs', role: 'group', 'aria-label': 'Art' },
    ...[{ id: null, name: 'Alle' }, ...groups].map(g => el('button', { type: 'button', 'aria-pressed': String(g.id === filter), onclick: e => {
      filter = g.id; e.currentTarget.parentElement.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === e.currentTarget))); fill()
    } }, g.name))) : null
  ui.body.replaceChildren(el('div', { class: 'aw-step' },
    el('h2', { id: 'aw-title', tabindex: '-1' }, step.title),
    el('p', { class: 'aw-lead' }, step.lead + (step.optional ? ' Optional.' : '')),
    tabs, grid))
  focusTitle()
}

function pick(step, o) {
  state.sel[step.id] = o.id
  settle()
  render()
  clearTimeout(state.timer)
  state.timer = setTimeout(() => { if (steps()[state.at]?.id === step.id) go(state.at + 1) }, opts.reduced ? 0 : 320)
}

function go(i) {
  const list = steps()
  // never past a step without a choice
  const firstOpen = list.findIndex(s => !state.sel[s.id])
  const max = firstOpen < 0 ? list.length : firstOpen
  state.at = Math.max(0, Math.min(i, max))
  ui.body.scrollTop = 0
  render()
}

function focusTitle() { requestAnimationFrame(() => ui.body.querySelector('h2')?.focus({ preventScroll: true })) }

// ------------------------------------------------------------------ result

const pairs = () => steps().map(s => [s.title, option(s.id, state.sel[s.id]).name])

function photos() {
  return data.photos.filter(p => p.chapter === state.chapter && Object.entries(p.tags).every(([k, v]) => matches([v], valueOf(k))))
    .sort((a, b) => Object.keys(b.tags).length - Object.keys(a.tags).length)
}

function mailto() {
  const ch = chapterOf(), list = pairs()
  const subject = `Anfrage – ${ch.title}: ${list.slice(0, 3).map(p => p[1]).join(', ')}`
  const body = `Guten Tag\n\nIch interessiere mich für diese Auswahl (${ch.title}):\n\n${list.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\nBitte kontaktieren Sie mich für eine persönliche Beratung.\n\nName:\nTelefon:\nOrt:\nMasse (falls bekannt):\n\nFreundliche Grüsse`
  return `mailto:${opts.mail || ''}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

function renderResult() {
  const ch = chapterOf(), found = photos()
  const stage = el('div', { class: `aw-stage aw-stage--${state.chapter}` })
  const pics = found.length
    ? el('ul', { class: 'aw-photos' }, ...found.map((p, i) => el('li', {},
        el('button', { type: 'button', 'aria-label': `Foto vergrössern: ${p.caption}`, onclick: () => opts.lightbox?.(found.map(f => ({ src: IMG + f.src, cap: f.caption })), i) },
          el('img', { src: IMG + p.src, alt: p.caption, loading: 'lazy' })),
        el('span', {}, p.caption, el('small', {}, p.origin === 'projekt' ? 'Realisiertes Projekt' : 'Referenz in Floatglas')))))
    : el('p', { class: 'aw-empty' }, 'Für genau diese Auswahl zeigen wir noch kein Foto. Gerne zeigen wir Ihnen die Möglichkeiten in einer persönlichen Beratung, mit Mustern in unserer Ausstellung.')
  ui.body.replaceChildren(el('div', { class: 'aw-result' },
    el('h2', { id: 'aw-title', tabindex: '-1' }, 'Ihre Auswahl'),
    el('p', { class: 'aw-lead' }, `${ch.title} – so könnte Ihr Glas aussehen. Visualisierung; jedes Stück ist ein Unikat.`),
    stage,
    el('dl', { class: 'aw-list' }, ...pairs().map(([k, v], i) => el('div', {}, el('dt', {}, k), el('dd', {}, el('button', { type: 'button', onclick: () => go(i) }, v))))),
    el('h3', {}, found.length ? `Echte Fotos zu Ihrer Auswahl · ${found.length}` : 'Echte Fotos'),
    pics,
    el('div', { class: 'aw-actions' },
      el('button', { type: 'button', class: 'aw-again', onclick: () => { state.sel = {}; go(0) } }, 'Neu beginnen')),
    el('p', { class: 'aw-note' }, 'Ihr E-Mail-Programm öffnet sich mit Ihrer Auswahl. Alle Angaben werden mit der Offerte verbindlich bestätigt.')))
  focusTitle()
  show3D(stage)
}

// the chosen glass in the chapter's own 3D scene (the same as the deck)
function combo() {
  const s = state.sel, o = id => option(id, s[id])
  if (state.chapter === 'trennwand') {
    return { form: o('form').name, float: s.glas !== 'struktur', maps: s.glas === 'sand' ? `float-${s.motiv}` : null,
      s: s.struktur, r: s.relief || 'ohne', name: pairs().map(p => p[1]).join(' + ') }
  }
  if (state.chapter === 'lavabo') {
    const f = o('farbe'), c = { model: o('modell').name, unterseite: o('unterseite').name, farbe: f.name, a: f.a, b: f.b }
    if (o('modell').group === 'aufsatz') {
      c.schale = s.schale === 'klar' ? { farbe: 'Klar' } : s.schale === 'satiniert' ? { farbe: 'Satiniert', a: '#e3ece9' } : { farbe: f.name, a: f.a, b: f.b, unterseite: o('unterseite').name }
    }
    return c
  }
  const f = o('farbe'), ak = s.akzent && s.akzent !== 'ohne' ? o('akzent') : null
  return { ...o('format').scene, format: s.format, struktur: o('struktur').name, relief: o('relief').name, farbe: f.name, a: f.a, b: f.b,
    s: s.struktur === 'float' ? null : s.struktur, r: s.relief === 'ohne' ? null : s.relief, akzent: ak?.name, ak: ak?.a, name: '' }
}

async function show3D(stage) {
  disposePreview()
  const loaders = {
    trennwand: async a => (await import('./deck3d.js')).initDeck3D(a),
    lavabo: async a => (await import('./lavabo3d.js')).initLavabo3D(a),
    rueckwand: async a => (await import('./rueckwand3d.js')).initRueckwand3D(a),
  }
  const token = (state.token = (state.token || 0) + 1)
  stage.classList.add('is-loading')
  try {
    const live = await loaders[state.chapter]({ deck: stage, combos: [combo()], onIndex: () => {}, reduced: opts.reduced, start: 0 })
    if (token !== state.token || !stage.isConnected) return stage.querySelector('canvas') && loseContext(stage.querySelector('canvas'))
    live.setLight(LIGHT_ORDER.indexOf(state.sel.licht ?? 'ohne'))
    preview = stage.querySelector('canvas')
  } catch (error) {
    console.warn('3D nicht verfügbar', error)
    stage.hidden = true
  } finally {
    stage.classList.remove('is-loading')
  }
}
const loseContext = canvas => { try { (canvas.getContext('webgl2') || canvas.getContext('webgl'))?.getExtension('WEBGL_lose_context')?.loseContext() } catch {} }
function disposePreview() { if (preview) { loseContext(preview); preview.remove(); preview = null } }

// ------------------------------------------------------------------ open / close

export async function open(chapter, options = {}) {
  opts = options
  if (!data) {
    data = await (await fetch('auswahl.json')).json()
    countSprites()
  }
  if (!ui) build()
  const keep = state?.chapter === chapter
  state = { chapter, sel: keep ? state.sel : { ...(options.preset || {}) }, at: 0 }
  if (options.preset) state.sel = { ...options.preset }
  settle()
  if (options.preset) state.at = steps().length          // a preset from the deck opens on the result
  ui.root.hidden = false
  document.documentElement.classList.add('aw-open')
  requestAnimationFrame(() => ui.root.classList.add('is-open'))
  if (!history.state?.aw) history.pushState({ aw: true }, '')
  render()
}

export function close(fromHistory = false) {
  if (!ui || ui.root.hidden) return
  disposePreview()
  ui.root.classList.remove('is-open')
  document.documentElement.classList.remove('aw-open')
  const done = () => { ui.root.hidden = true; opts.returnFocus?.focus({ preventScroll: true }) }
  if (opts.reduced) done(); else setTimeout(done, 420)
  if (!fromHistory && history.state?.aw) history.back()
}
