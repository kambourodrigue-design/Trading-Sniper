import re
from pathlib import Path
root = Path('public')

ICONS = {
 'home': '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/>',
 'fn':   '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>',
 'tarifs':'<path d="M3 12V4h8l9 9-8 8-9-9Z"/><circle cx="7.5" cy="8.5" r="1.2"/>',
 'dash': '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
 'admin':'<path d="M12 3 4 6v6c0 4.5 3.2 7.7 8 9 4.8-1.3 8-4.5 8-9V6l-8-3Z"/><path d="m9 12 2 2 4-4"/>',
}
ITEMS = [('/', 'Accueil', 'home'), ('/scanner.html', 'Fonctions', 'fn'),
         ('/subscription.html', 'Tarifs', 'tarifs'), ('/dashboard.html', 'Dashboard', 'dash'),
         ('/admin.html', 'Admin', 'admin')]
ACTIVE = {'index.html': 0, 'subscription.html': 2, 'dashboard.html': 3, 'admin.html': 4}  # le reste = Fonctions (1)

def nav_html(i):
    out = [f'<div class="lx-nav" role="navigation" aria-label="Navigation principale" style="--i:{i}">', '<i class="lx-pill" aria-hidden="true"></i>']
    for k, (href, label, ic) in enumerate(ITEMS):
        cur = ' aria-current="page"' if k == i else ''
        out.append(f'<a class="lx-item" href="{href}"{cur}><svg viewBox="0 0 24 24" aria-hidden="true">{ICONS[ic]}</svg><span>{label}</span></a>')
    out.append("</div>")
    return '\n'.join(out)

old_div = re.compile(r'<div class="lucide-bottom-nav lucide-pill-nav".*?</div>', re.S)
old_styles = [
  re.compile(r'<style id="lucide-bottom-nav-reference">.*?</style>', re.S),
  re.compile(r'<style id="lucide-pill-navigation-refinement">.*?</style>', re.S),
  re.compile(r'<style>\.lucide-bottom-nav\{background:transparent!important\}</style>'),
]
for p in sorted(root.glob('*.html')):
    s = p.read_text()
    if 'class="lx-nav"' in s:
        print('déjà fait', p.name); continue
    i = ACTIVE.get(p.name, 1)
    n = len(old_div.findall(s))
    assert n == 1, (p.name, n)
    s = old_div.sub(lambda m: nav_html(i), s, count=1)
    for r in old_styles:
        s = r.sub('', s)
    s = s.replace('</head>', '<link rel="stylesheet" href="/lx-nav.css"></head>', 1)
    s = s.replace('</body>', '<script src="/lx-nav.js" defer></script></body>', 1)
    p.write_text(s)
    print('ok', p.name, 'actif =', ITEMS[i][1])
