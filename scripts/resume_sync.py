#!/usr/bin/env python3
"""Rebuild assets/resume-doc.html from the resume's Google Doc.

Wide screens show the Google Doc itself on the Resume tab. Its page layout
(a fixed-width page with tables for columns) doesn't fit a phone, so phones
show this file instead: the doc's text rebuilt as the site's own panels, one
rock per section. The "Sync resume" GitHub Action runs this script on a
schedule and commits the file when the doc has changed.

The doc must stay shared as "Anyone with the link can view".

    python3 scripts/resume_sync.py                     # fetch the doc
    python3 scripts/resume_sync.py --input export.html # use a saved HTML export

Standard library only, so the Action needs no setup.
"""
import argparse
import html
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser

DOC_ID = '1ZrEFIjkGrEvXuVBZgUAULk_GZvu164WiZnew_2Qw-pI'
EXPORT_URL = 'https://docs.google.com/document/d/' + DOC_ID + '/export?format=html'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'resume-doc.html')

BULLETS = '•●◦▪■▸►‣·'
VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'}
EMAIL = r'[\w.+-]+@[\w-]+(?:\.[\w-]+)+'
PHONE = r'\+\d[\d ]{6,}\d'
URL = r'https?://[^\s<>"\]]+[^\s<>"\].,;:!?)]'
AUTOLINK = re.compile('(%s)|(%s)|(%s)' % (URL, EMAIL, PHONE))


# ---- HTML to a small tree ---------------------------------------------------

class Node:
    def __init__(self, tag, attrs, parent):
        self.tag, self.attrs, self.parent, self.children = tag, attrs, parent, []

    def elements(self, *tags):
        return [c for c in self.children if isinstance(c, Node) and (not tags or c.tag in tags)]


class TreeBuilder(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = self.cur = Node('#root', {}, None)
        self.css = []

    def handle_starttag(self, tag, attrs):
        node = Node(tag, {k: v or '' for k, v in attrs}, self.cur)
        self.cur.children.append(node)
        if tag not in VOID:
            self.cur = node

    def handle_startendtag(self, tag, attrs):
        self.cur.children.append(Node(tag, {k: v or '' for k, v in attrs}, self.cur))

    def handle_endtag(self, tag):
        n = self.cur
        while n is not self.root and n.tag != tag:
            n = n.parent
        if n is not self.root:
            self.cur = n.parent

    def handle_data(self, data):
        if self.cur.tag == 'style':
            self.css.append(data)
        elif self.cur.tag not in ('script', 'title', 'head'):
            self.cur.children.append(data)


def parse_decls(text):
    out = {}
    for part in (text or '').split(';'):
        if ':' in part:
            k, v = part.split(':', 1)
            out[k.strip().lower()] = v.strip()
    return out


def parse_css(text):
    """Map class name to declarations, for the `.cN{...}` rules Docs exports."""
    rules = {}
    text = re.sub(r'@import[^;]*;', '', text)
    for sel, body in re.findall(r'([^{}]+)\{([^{}]*)\}', text):
        for s in sel.split(','):
            m = re.fullmatch(r'\s*\.([\w-]+)\s*', s)
            if m:
                rules.setdefault(m.group(1), {}).update(parse_decls(body))
    return rules


# ---- Text runs ----------------------------------------------------------------
# A "line" is a list of (char, fmt, size) where fmt = (bold, italic, href).

def font_size(value):
    m = re.match(r'([\d.]+)(pt|px)', value or '')
    if not m:
        return None
    return float(m.group(1)) * (0.75 if m.group(2) == 'px' else 1)


def clean_href(href):
    if not href:
        return None
    u = urllib.parse.urlsplit(href)
    if u.netloc in ('www.google.com', 'google.com') and u.path == '/url':
        q = urllib.parse.parse_qs(u.query).get('q')
        if not q:
            return None
        href = q[0]
        u = urllib.parse.urlsplit(href)
    return href if u.scheme.lower() in ('http', 'https', 'mailto', 'tel') else None


class Doc:
    def __init__(self, source):
        tb = TreeBuilder()
        tb.feed(source)
        tb.close()
        self.root = tb.root
        self.rules = parse_css(''.join(tb.css))

    def style(self, node):
        st = {}
        for c in node.attrs.get('class', '').split():
            st.update(self.rules.get(c, {}))
        st.update(parse_decls(node.attrs.get('style')))
        return st

    def chars(self, node, ctx=None, out=None):
        """Text of an element as styled characters; <br> becomes '\\n'."""
        if out is None:
            out = []
        if ctx is None:
            ctx = {'bold': False, 'italic': False, 'href': None, 'size': None}
        st = self.style(node)
        ctx = dict(ctx)
        w = st.get('font-weight')
        if w:
            ctx['bold'] = w == 'bold' or (w.isdigit() and int(w) >= 600)
        if st.get('font-style'):
            ctx['italic'] = st['font-style'] == 'italic'
        ctx['size'] = font_size(st.get('font-size')) or ctx['size']
        if node.tag == 'a':
            ctx['href'] = clean_href(node.attrs.get('href'))
        for ch in node.children:
            if isinstance(ch, str):
                fmt = (ctx['bold'], ctx['italic'], ctx['href'])
                out.extend((c, fmt, ctx['size']) for c in ch)
            elif ch.tag == 'br':
                out.append(('\n', (False, False, None), None))
            elif ch.tag not in ('img', 'style', 'script', 'svg'):
                self.chars(ch, ctx, out)
        return out


def normalize(chars):
    """Collapse whitespace (the doc lines things up with runs of spaces)."""
    out = []
    for c, fmt, size in chars:
        if c == '\n':
            while out and out[-1][0] == ' ':
                out.pop()
            out.append((c, fmt, size))
            continue
        if c.isspace() or c in '​﻿':
            if c in '​﻿' or not out or out[-1][0] in ' \n':
                continue
            c = ' '
        out.append((c, fmt, size))
    while out and out[-1][0] == ' ':
        out.pop()
    return out


def text(line):
    return ''.join(c for c, _, _ in line)


def strip(line):
    i, j = 0, len(line)
    while i < j and line[i][0].isspace():
        i += 1
    while j > i and line[j - 1][0].isspace():
        j -= 1
    return line[i:j]


def split_at(line, positions, width=1):
    parts, start = [], 0
    for p in positions:
        parts.append(line[start:p])
        start = p + width
    parts.append(line[start:])
    return [s for s in (strip(p) for p in parts) if s]


# ---- Blocks -------------------------------------------------------------------

def list_level(node):
    m = re.search(r'lst-kix_\w+-(\d+)', node.attrs.get('class', ''))
    return int(m.group(1)) if m else 0


def blocks(doc, node, out):
    """Flatten the body into ('p'|'h1'..'h6'|'title'|'li'|'row', line(s))."""
    for ch in node.children:
        if isinstance(ch, str):
            continue
        t = ch.tag
        if t == 'p' or re.fullmatch(r'h[1-6]', t):
            cls = ch.attrs.get('class', '').split()
            kind = 'title' if 'title' in cls else t
            out.append((kind, normalize(doc.chars(ch))))
        elif t in ('ul', 'ol'):
            for li in ch.elements('li'):
                out.append(('li', normalize(doc.chars(li))))
        elif t == 'table':
            for tr in rows(ch):
                cells = tr.elements('td', 'th')
                # A cell holding a list or several paragraphs is page layout
                # (columns); read its content in order. Otherwise the row is
                # an entry heading such as "AI Engineer | NCS | 2025 - Present".
                layout = any(len([b for b in blocks(doc, td, []) if text(b[1]).strip()]) > 1 or
                             td.elements('ul', 'ol') for td in cells)
                if layout:
                    for td in cells:
                        blocks(doc, td, out)
                else:
                    out.append(('row', [normalize(doc.chars(td)) for td in cells]))
        elif t not in ('img', 'hr', 'style', 'script', 'head'):
            blocks(doc, ch, out)
    return out


def rows(table):
    for ch in table.elements():
        if ch.tag == 'tr':
            yield ch
        elif ch.tag in ('tbody', 'thead', 'tfoot'):
            yield from rows(ch)


# ---- Structure ------------------------------------------------------------------

def is_bullet_at(t, i):
    return t[i] in BULLETS and (i == 0 or t[i - 1] == ' ')


def pipe_items(line):
    t = text(line)
    pos = [i for i, c in enumerate(t) if c == '|']
    items = split_at(line, pos)
    if len(items) >= 3 and all(len(text(i)) <= 40 for i in items):
        return items
    return None


def structure(blist):
    """Group blocks into sections: [{'title', 'items'}]; items are
    ('name', str) ('para', line) ('bullet', line) ('pipes', [line])
    ('entry', line, [line])."""
    sections = [{'title': None, 'items': []}]

    def add(item):
        sections[-1]['items'].append(item)

    def section(title):
        sections.append({'title': title, 'items': []})

    def line_items(line, size_hint):
        line = strip(line)
        t = text(line)
        if not t:
            return
        m = re.search(r'_{4,}', t)
        if m:
            # "Experience ______" draws a heading with a rule.
            before = strip(line[:m.start()])
            if before:
                section(text(before))
            line_items(line[m.end():], size_hint)
            return
        if t[0] in BULLETS:
            pos = [i for i in range(len(t)) if is_bullet_at(t, i)]
            for part in split_at(line, pos):
                pipes = pipe_items(part)
                add(('pipes', pipes) if pipes else ('bullet', part))
            return
        sizes = [s for c, _, s in line if s and not c.isspace()]
        if (sections[-1]['title'] is None and len(sections) == 1 and sizes and min(sizes) >= 14
                and len(t) <= 60 and not any(i[0] == 'name' for i in sections[0]['items'])):
            add(('name', t))
            return
        pipes = pipe_items(line)
        add(('pipes', pipes) if pipes else ('para', line))

    for kind, data in blist:
        if kind == 'row':
            cells = [strip(c) for c in data]
            cells = [c for c in cells if text(c)]
            if cells:
                add(('entry', cells[0], cells[1:]))
        elif kind == 'title':
            t = text(strip(data))
            if t:
                add(('name', t))
        elif kind in ('h1', 'h2'):
            t = text(strip(data)).rstrip('_ ')
            if t:
                section(t)
        elif kind.startswith('h'):
            if text(strip(data)):
                add(('entry', strip(data), []))
        elif kind == 'li':
            line = strip(data)
            if text(line):
                pipes = pipe_items(line)
                add(('pipes', pipes) if pipes else ('bullet', line))
        else:
            parts = [[]]
            for c in data:
                if c[0] == '\n':
                    parts.append([])
                else:
                    parts[-1].append(c)
            for p in parts:
                line_items(p, None)
    return sections


# ---- Output ---------------------------------------------------------------------

def esc(s):
    return html.escape(s, quote=False)


def link(href, inner):
    attrs = ' target="_blank" rel="noopener"' if href.lower().startswith('http') else ''
    return '<a href="%s"%s>%s</a>' % (html.escape(href, quote=True), attrs, inner)


def autolink(s):
    out, last = [], 0
    for m in AUTOLINK.finditer(s):
        out.append(esc(s[last:m.start()]))
        url, email, phone = m.groups()
        href = url or ('mailto:' + email if email else 'tel:' + phone.replace(' ', ''))
        out.append(link(href, esc(m.group(0))))
        last = m.end()
    out.append(esc(s[last:]))
    return ''.join(out)


def inline(line, bold=True):
    groups = []
    for c, fmt, _ in line:
        if not bold:
            fmt = (False,) + fmt[1:]
        if groups and groups[-1][1] == fmt:
            groups[-1][0].append(c)
        else:
            groups.append(([c], fmt))
    out = []
    for cs, (b, i, href) in groups:
        s = ''.join(cs)
        h = esc(s) if href else autolink(s)
        if i:
            h = '<em>' + h + '</em>'
        if b:
            h = '<strong>' + h + '</strong>'
        out.append(link(href, h) if href else h)
    return ''.join(out)


def nowrap(line):
    return [('\u00a0' if c == ' ' else c, fmt, size) for c, fmt, size in line]


def render(sections):
    parts = ['<!-- Built from the resume\'s Google Doc by scripts/resume_sync.py. Edit the doc, not this file. -->']
    for n, sec in enumerate(sections):
        items = sec['items']
        if sec['title'] is None and not items:
            continue
        intro = sec['title'] is None and n == 0
        body = []
        if intro:
            body.append('<div class="rock rz-intro">')
        else:
            body.append('<article class="rock rz-section">')
            body.append('  <h2>%s</h2>' % esc(sec['title']))
        in_entry = in_list = False
        for item in items:
            kind = item[0]
            if in_list and kind != 'bullet':
                body.append('  </ul>' if not in_entry else '    </ul>')
                in_list = False
            if kind == 'entry':
                if in_entry:
                    body.append('  </div>')
                body.append('  <div class="rz-entry">')
                # Keep short parts such as "2025 - Present" on one line.
                meta = ' · '.join(inline(nowrap(c) if len(text(c)) <= 20 else c, bold=False) for c in item[2])
                head = inline(item[1], bold=False)
                if meta:
                    head += ' <span class="rz-meta">%s</span>' % meta
                body.append('    <h3 class="rz-head">%s</h3>' % head)
                in_entry = True
                continue
            pad = '    ' if in_entry else '  '
            if kind == 'name':
                body.append(pad + '<p class="rz-name">%s</p>' % esc(item[1]))
            elif kind == 'para':
                body.append(pad + '<p>%s</p>' % inline(item[1]))
            elif kind == 'pipes':
                cls = 'links rz-contact' if intro else 'chips'
                body.append(pad + '<ul class="%s">%s</ul>' % (cls, ''.join('<li>%s</li>' % inline(i) for i in item[1])))
            elif kind == 'bullet':
                if not in_list:
                    body.append(pad + '<ul>')
                    in_list = True
                body.append(pad + '  <li>%s</li>' % inline(item[1]))
        if in_list:
            body.append('    </ul>' if in_entry else '  </ul>')
        if in_entry:
            body.append('  </div>')
        body.append('</div>' if intro else '</article>')
        parts.append('\n'.join(body))
    return '\n'.join(parts) + '\n'


def build(source):
    doc = Doc(source)
    body = next((n for n in walk(doc.root) if n.tag == 'body'), doc.root)
    sections = structure(blocks(doc, body, []))
    words = sum(len(text(i[1]).split()) for s in sections for i in s['items'] if i[0] in ('para', 'bullet'))
    if len(sections) < 2 or words < 30:
        raise ValueError('the doc export has no recognisable resume content')
    return render(sections)


def walk(node):
    for ch in node.elements():
        yield ch
        yield from walk(ch)


def fetch():
    req = urllib.request.Request(EXPORT_URL, headers={'User-Agent': 'Mozilla/5.0 (resume sync for zafirmaricar.github.io)'})
    with urllib.request.urlopen(req, timeout=30) as r:
        if 'accounts.google.com' in r.geturl():
            raise ValueError('Google asked for a sign-in: the doc is no longer shared as "Anyone with the link"')
        return r.read().decode('utf-8')


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--input', help='a saved HTML export of the doc instead of fetching it')
    ap.add_argument('--out', default=OUT)
    args = ap.parse_args()
    if args.input:
        with open(args.input, encoding='utf-8') as f:
            source = f.read()
    else:
        try:
            source = fetch()
        except (urllib.error.URLError, ValueError) as e:
            sys.exit('resume_sync: could not fetch the doc (%s); leaving %s as it is' % (e, args.out))
    try:
        result = build(source)
    except ValueError as e:
        sys.exit('resume_sync: %s; leaving %s as it is' % (e, args.out))
    with open(args.out, 'w', encoding='utf-8', newline='\n') as f:
        f.write(result)


if __name__ == '__main__':
    main()
