/* Languages: the page is written in German; every other language is a dictionary keyed by the
   German text (lang/xx.json). The texts are swapped in place, and anything the scripts write
   later (deck labels, the selector) is caught by an observer and translated as it appears.
   Keys with {x} {y} {n} {m} are patterns; what they capture is translated in turn. */
(() => {
  const LANGS = { de: 'Deutsch', en: 'English', fr: 'Français', it: 'Italiano', es: 'Español', pt: 'Português' }
  const LOCALE = { de: 'de-CH', en: 'en-GB', fr: 'fr-CH', it: 'it-CH', es: 'es', pt: 'pt' }
  const ATTRS = ['alt', 'aria-label', 'title', 'aria-roledescription']
  const SKIP = new Set(['SCRIPT', 'STYLE', 'svg', 'TEXTAREA', 'CODE'])
  const root = document.documentElement
  let lang = 'de', dict = null, patterns = []

  const pick = () => {
    const q = new URLSearchParams(location.search).get('lang')
    if (q && LANGS[q]) return q
    try { const s = localStorage.getItem('bg-lang'); if (s && LANGS[s]) return s } catch {}
    for (const l of navigator.languages || [navigator.language || '']) {
      const c = String(l).slice(0, 2).toLowerCase()
      if (LANGS[c]) return c
    }
    return 'de'
  }

  const compile = d => Object.keys(d).filter(k => k.includes('{')).map(k => {
    const names = []
    const re = new RegExp('^' + k.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{([xynm])\}/g, (_, n) => {
      names.push(n); return n === 'n' || n === 'm' ? '(\\d+)' : '(.+)'
    }) + '$', 's')
    return { re, names, out: d[k], weight: k.replace(/\{\w\}/g, '').length }
  }).sort((a, b) => b.weight - a.weight)   // the most specific pattern first

  const fill = (s, vars) => vars ? s.replace(/\{(\w)\}/g, (m, n) => n in vars ? vars[n] : m) : s

  // text of one string, German in and German out while no dictionary is loaded; vars go in as given
  const T = (s, vars) => {
    if (s == null) return s
    const src = String(s)
    if (!dict) return fill(src, vars)
    let out = dict[src]
    if (out == null && !vars) {
      for (const p of patterns) {
        const m = src.match(p.re)
        if (m) { const v = {}; p.names.forEach((n, i) => { v[n] = T(m[i + 1]) }); out = fill(p.out, v); break }
      }
      // composite labels („Welle · Gold“, „Rundbogen + Float“): the parts one by one
      if (out == null && /\s[·+]\s/.test(src)) {
        const parts = src.split(/(\s[·+]\s)/)
        if (parts.some((p, i) => i % 2 === 0 && dict[p] != null)) out = parts.map((p, i) => i % 2 ? p : dict[p] ?? p).join('')
      }
    }
    return fill(out ?? src, vars)
  }

  /* what was German before we wrote over it, so a later switch starts from the original */
  const texts = new WeakMap(), attrs = new WeakMap()
  const textOf = node => {
    const raw = node.data, trimmed = raw.trim()
    if (!trimmed || !/[A-Za-zÀ-ž]/.test(trimmed)) return
    let rec = texts.get(node)
    if (!rec || rec.out !== raw) { rec = { de: raw }; texts.set(node, rec) }   // new German text
    const core = rec.de.trim().replace(/\s+/g, ' ')
    const tr = lang === 'de' ? core : T(core)
    const lead = rec.de.match(/^\s*/)[0], tail = rec.de.match(/\s*$/)[0]
    const out = tr === core ? rec.de : lead + tr + tail
    rec.out = out
    if (raw !== out) node.data = out
  }
  const attrOf = (el, name) => {
    const raw = el.getAttribute(name)
    if (!raw || !/[A-Za-zÀ-ž]{2}/.test(raw)) return
    let map = attrs.get(el)
    if (!map) attrs.set(el, map = {})
    let rec = map[name]
    if (!rec || rec.out !== raw) rec = map[name] = { de: raw }
    const out = lang === 'de' ? rec.de : T(rec.de)
    rec.out = out
    if (raw !== out) el.setAttribute(name, out)
  }
  const walk = node => {
    if (node.nodeType === 3) { if (!SKIP.has(node.parentNode?.nodeName)) textOf(node); return }
    if (node.nodeType !== 1 || SKIP.has(node.nodeName) || node.hasAttribute('data-no-i18n')) return
    for (const a of ATTRS) if (node.hasAttribute(a)) attrOf(node, a)
    for (let c = node.firstChild; c; c = c.nextSibling) walk(c)
  }

  let busy = false
  const observer = new MutationObserver(list => {
    if (busy) return
    busy = true
    for (const m of list) {
      if (m.type === 'childList') m.addedNodes.forEach(walk)
      else if (m.type === 'characterData') { if (!SKIP.has(m.target.parentNode?.nodeName)) textOf(m.target) }
      else if (m.type === 'attributes' && ATTRS.includes(m.attributeName)) attrOf(m.target, m.attributeName)
    }
    observer.takeRecords()        // our own writes
    busy = false
  })

  const title = document.title
  const apply = () => {
    busy = true
    root.lang = LOCALE[lang]
    walk(document.body)
    document.title = lang === 'de' ? title : title.replace('Glas für Bad und Küche', T('Glas für Bad und Küche'))
    document.querySelectorAll('[data-lang-pick]').forEach(b => b.setAttribute('aria-current', String(b.dataset.langPick === lang)))
    document.querySelectorAll('.lang-now').forEach(e => { e.textContent = lang.toUpperCase() })
    observer.takeRecords()
    busy = false
    dispatchEvent(new CustomEvent('langchange', { detail: lang }))
  }

  const load = async l => {
    if (l === 'de') return {}
    const base = document.querySelector('script[src$="i18n.js"]')?.src.replace(/i18n\.js.*$/, '') ?? ''
    const r = await fetch(base + `lang/${l}.json`)
    if (!r.ok) throw new Error(r.status)
    return r.json()
  }

  const set = async (l, remember = true) => {
    if (!LANGS[l]) l = 'de'
    let d
    try { d = await load(l) } catch (e) { console.warn('Sprache nicht geladen', l, e); l = 'de'; d = {} }
    lang = l
    dict = l === 'de' ? null : d
    patterns = dict ? compile(dict) : []
    if (remember) try { localStorage.setItem('bg-lang', l) } catch {}
    const url = new URL(location.href)
    if (url.searchParams.has('lang')) { url.searchParams.set('lang', l); history.replaceState(history.state, '', url) }
    if (document.body) apply()
    root.classList.remove('i18n-wait')
  }

  const first = pick()
  // other languages: hide the German for the moment the dictionary takes to arrive
  if (first !== 'de') { root.classList.add('i18n-wait'); setTimeout(() => root.classList.remove('i18n-wait'), 1500) }
  const ready = set(first, false)
  const start = () => {
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS })
    if (lang !== 'de') apply()
    // the switchers further down are parsed after this script; mark the language once they exist
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => apply())
    document.addEventListener('click', e => {
      document.querySelectorAll('details.lang[open]').forEach(d => { if (!d.contains(e.target)) d.removeAttribute('open') })
      const b = e.target.closest('[data-lang-pick]')
      if (!b) return
      e.preventDefault()
      set(b.dataset.langPick)
      b.closest('details')?.removeAttribute('open')
    })
  }
  addEventListener('keydown', e => { if (e.key === 'Escape') document.querySelectorAll('details.lang[open]').forEach(d => { d.removeAttribute('open'); d.querySelector('summary').focus() }) })
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start)

  window.I18N = { T, LANGS, ready, set, get lang() { return lang } }
})()
