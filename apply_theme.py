from pathlib import Path
root=Path('/mnt/data/lucide_work/public')
css='''
/* Lucide global theme switch */
#lucide-theme-toggle{position:fixed;top:14px;right:14px;z-index:10050;display:inline-flex;align-items:center;gap:8px;padding:9px 13px;border:1px solid var(--line,rgba(124,58,237,.2));border-radius:999px;background:color-mix(in srgb,var(--surface,#fff) 88%,transparent);color:var(--ink,#17132B);box-shadow:0 8px 24px rgba(45,20,90,.16);backdrop-filter:blur(14px);font:700 12px/1 Inter,system-ui,sans-serif;cursor:pointer;transition:transform .2s ease,box-shadow .2s ease,background .2s ease}
#lucide-theme-toggle:hover{transform:translateY(-1px);box-shadow:0 12px 28px rgba(124,58,237,.22)}
#lucide-theme-toggle svg{width:17px;height:17px;flex:none}
:root[data-theme="dark"]{color-scheme:dark;--bg:#100D1A;--surface:#1B162B;--ink:#F4F0FF;--ink-soft:#B4A9CF;--soft:#B4A9CF;--line:#332849;--lav:#28203D;--cyan:#22D3EE;--violet:#A78BFA;--grad:linear-gradient(135deg,#9333EA,#D946EF)}
:root[data-theme="dark"] body{background-color:var(--bg)!important;color:var(--ink)}
:root[data-theme="dark"] .card,:root[data-theme="dark"] .panel,:root[data-theme="dark"] .metric-card,:root[data-theme="dark"] .stat-card,:root[data-theme="dark"] .section-card{background-color:var(--surface);border-color:var(--line);color:var(--ink)}
:root[data-theme="dark"] input,:root[data-theme="dark"] select,:root[data-theme="dark"] textarea{background:#211A33;color:var(--ink);border-color:var(--line)}
:root[data-theme="dark"] table th,:root[data-theme="dark"] table td{border-color:var(--line)}
:root[data-theme="dark"] .muted,:root[data-theme="dark"] .note,:root[data-theme="dark"] .soft{color:var(--soft)}
:root[data-theme="dark"] nav,:root[data-theme="dark"] .bottom,:root[data-theme="dark"] .lucide-bottom-nav{background:color-mix(in srgb,var(--surface) 90%,transparent);border-color:var(--line)}
:root[data-theme="dark"] .btn,:root[data-theme="dark"] button:not(#lucide-theme-toggle){background-color:#251D39;color:var(--ink);border-color:var(--line)}
:root[data-theme="dark"] .btn.primary,:root[data-theme="dark"] button.primary{background:var(--grad);color:#fff;border-color:transparent}
@media(max-width:700px){#lucide-theme-toggle{top:10px;right:10px;padding:8px 10px}#lucide-theme-toggle .theme-label{display:none}}
@media(prefers-reduced-motion:reduce){#lucide-theme-toggle{transition:none}}
'''
script='''<script>(function(){const KEY='lucide_theme';let saved=null;try{saved=localStorage.getItem(KEY)}catch(e){}const initial=saved||(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.dataset.theme=initial;document.documentElement.style.colorScheme=initial;})();</script>'''
end_script='''<script>(function(){const root=document.documentElement;const key='lucide_theme';function paint(mode){root.dataset.theme=mode;root.style.colorScheme=mode;try{localStorage.setItem(key,mode)}catch(e){}const b=document.getElementById('lucide-theme-toggle');if(b){b.setAttribute('aria-label',mode==='dark'?'Activer le mode clair':'Activer le mode nuit');b.setAttribute('aria-pressed',String(mode==='dark'));b.innerHTML=mode==='dark'?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></svg><span class="theme-label">Mode clair</span>':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z"/></svg><span class="theme-label">Mode nuit</span>'}}document.addEventListener('DOMContentLoaded',function(){let b=document.getElementById('lucide-theme-toggle');if(!b){b=document.createElement('button');b.id='lucide-theme-toggle';b.type='button';b.innerHTML='Mode nuit';b.addEventListener('click',()=>paint(root.dataset.theme==='dark'?'light':'dark'));document.body.appendChild(b)}paint(root.dataset.theme==='dark'?'dark':'light')});})();</script>'''
for p in root.glob('*.html'):
    s=p.read_text()
    if 'id="lucide-theme-toggle"' in s: # idempotence
        continue
    if '</head>' in s: s=s.replace('</head>', '<style>'+css+'</style>'+script+'</head>',1)
    else: continue
    if '</body>' in s: s=s.replace('</body>',end_script+'</body>',1)
    else: s += end_script
    p.write_text(s)
    print('updated',p.name)
