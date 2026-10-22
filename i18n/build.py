"""Builds the catalogue in Swiss German, French and English.

  python3 i18n/build.py

Sources (edit these, never the generated files):
  i18n/template.html   the page, in English
  i18n/auswahl.json    the selector data, in English ("k" is the German key the 3D scenes use)
  i18n/de.json         English -> Swiss German (de-CH: ss, never ß), one entry per text
  i18n/fr.json         English -> French (fr-CH)

Writes index.html (de), fr.html, en.html and auswahl.de.json, auswahl.fr.json, auswahl.en.json.
Every text of the page must have a translation; a missing one stops the build and is listed.
"""
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
LANGS = {  # code: (output page, html lang, og:locale)
    'de': ('index.html', 'de-CH', 'de_CH'),
    'fr': ('fr.html', 'fr-CH', 'fr_CH'),
    'en': ('en.html', 'en-GB', 'en_GB'),
}
ATTRS = ('alt', 'aria-label', 'title', 'placeholder', 'data-part', 'download', 'data-hint')
META = ('description', 'og:title', 'og:description', 'og:site_name')
WORD = re.compile(r'[A-Za-zÀ-ÿ]')
TOKEN = re.compile(r'<script\b[^>]*>.*?</script>|<style\b[^>]*>.*?</style>|<svg\b.*?</svg>|<[^>]+>|[^<]+', re.S)


def translator(lang, missing):
    if lang == 'en':
        return lambda s: s
    table = json.loads((HERE / f'{lang}.json').read_text(encoding='utf-8'))

    def tr(s):
        if s in table:
            return table[s]
        missing.add(s)
        return s
    return tr


def page(tpl, lang, tr):
    def tag(t):
        if t.startswith('<meta') and re.search(r'(name|property)="(%s)"' % '|'.join(META), t):
            return re.sub(r'content="([^"]*)"', lambda m: f'content="{tr(m.group(1))}"', t)
        return re.sub(r'([a-zA-Z-]+)="([^"]*)"',
                      lambda m: f'{m.group(1)}="{tr(m.group(2))}"' if m.group(1) in ATTRS and WORD.search(m.group(2)) else m.group(0), t)

    out = []
    for m in TOKEN.finditer(tpl):
        t = m.group(0)
        if t.startswith('<script'):
            head, body = re.match(r'(<script[^>]*>)(.*)</script>', t, re.S).groups()
            if 'class="deck-data"' in head:
                combos = json.loads(body)
                for c in combos:
                    c['t'] = {k: tr(v) for k, v in c['t'].items()}
                t = head + json.dumps(combos, ensure_ascii=False) + '</script>'
            elif 'id="i18n"' in head:
                t = head + json.dumps({k: tr(v) for k, v in json.loads(body).items()}, ensure_ascii=False) + '</script>'
            out.append(t)
        elif t.startswith(('<style', '<svg')):
            out.append(t)
        elif t.startswith('<'):
            out.append(tag(t))
        else:
            s = t.strip()
            if s and len(s) > 1 and WORD.search(s):
                out.append(t[:len(t) - len(t.lstrip())] + tr(s) + t[len(t.rstrip()):])
            else:
                out.append(t)
    html = ''.join(out)
    _, html_lang, locale = LANGS[lang]
    html = html.replace('<html lang="en-GB">', f'<html lang="{html_lang}">', 1)
    html = html.replace('content="en_GB"', f'content="{locale}"', 1)
    # the language links: the current one is marked
    html = re.sub(r'(<a [^>]*data-lang="%s")' % lang, r'\1 aria-current="true"', html)
    return html


def selector(data, tr):
    for ch in data['chapters'].values():
        ch['title'] = tr(ch['title'])
        for g in ch.get('groups', []):
            g['name'] = tr(g['name'])
        for st in ch['steps']:
            st['title'], st['lead'] = tr(st['title']), tr(st['lead'])
            for o in st['options']:
                o['name'] = tr(o['name'])
                if o.get('note'):
                    o['note'] = tr(o['note'])
    for ph in data['photos']:
        ph['caption'] = tr(ph['caption'])
    return data


def main():
    tpl = (HERE / 'template.html').read_text(encoding='utf-8')
    failed = False
    for lang, (name, _, _) in LANGS.items():
        missing = set()
        tr = translator(lang, missing)
        html = page(tpl, lang, tr)
        data = selector(json.loads((HERE / 'auswahl.json').read_text(encoding='utf-8')), tr)
        if missing:
            failed = True
            print(f'{lang}: {len(missing)} texts without translation in i18n/{lang}.json:')
            for s in sorted(missing):
                print('  ', json.dumps(s, ensure_ascii=False))
            continue
        (ROOT / name).write_text(html, encoding='utf-8')
        (ROOT / f'auswahl.{lang}.json').write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
        print(f'{lang}: {name}, auswahl.{lang}.json')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
