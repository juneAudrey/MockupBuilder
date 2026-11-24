/* spec_app.js — 화면 (검색 · 결과 · 사양서 · 테이블 · 폴더 설정) */
(function () {
'use strict';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const trim = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n) + '…' : s; };
const has = (text, t) => String(text ?? '').toLowerCase().includes(t.toLowerCase());
const ls = { get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };
function hl(text, toks) {
  let h = esc(text);
  if (!toks || !toks.length) return h;
  const re = new RegExp('(' + toks.filter(Boolean).map((t) => reEsc(esc(t))).join('|') + ')', 'gi');
  return h.replace(re, '<mark>$1</mark>');
}
/* 문장 끝 줄바꿈: 마침표(.) 뒤에 글이 이어지면 다음 문장은 새 줄로. 숫자 뒤 마침표(1. · 1.5 · V1.0)는 그대로 */
const SENT_RE = /([^\d\s.])\.(\)?)[ \t]+(?=\S)/g;
// 원문에 있던 줄바꿈도 살린다 (엑셀 칸 안의 Alt+Enter)
const sent = (h) => String(h ?? '').replace(/\r?\n/g, '<br>').replace(SENT_RE, '$1.$2<br>');
const sentTxt = (t) => String(t ?? '').replace(/\r\n/g, '\n').replace(SENT_RE, '$1.$2\n');
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2600); }
window.go = (h) => { if (location.hash === h) render(); else location.hash = h; };
const link = (...segs) => '#/' + segs.map((s) => encodeURIComponent(s)).join('/');

/* ---------------- 상태 ---------------- */
let IDX = null, S = [], BYKEY = {}, TBL = {}, PROJ = {}, DEMO = false;
let scope = ls.get('sf.scope') || '';
const KIND = { name: '화면 이름', col: '컬럼', tbl: '테이블', sql: '쿼리', logic: '로직', svc: '서비스', cmb: '콤보', ov: '요약', memo: '결정 메모', req: '요청 글', rev: '검토', hist: '변경 이력', full: '본문' };
const KC = { col: 'var(--k-col)', tbl: 'var(--k-tbl)', sql: 'var(--k-sql)', logic: 'var(--k-logic)', svc: 'var(--k-svc)', cmb: 'var(--k-cmb)' };
const kindTag = (k) => `<span class="kind" style="--kc:${KC[k] || 'var(--k-etc)'}">${KIND[k]}</span>`;
const MODN = { APPR: '결재', BC: '기준정보', BA: '기준정보', IM: '재고', MM: '구매', PP: '생산', SD: '영업', QM: '품질', FI: '재무', CO: '원가', HR: '인사', AC: '회계' };
const MODC = { SD: '#2563eb', MM: '#059669', IM: '#d97706', PP: '#e11d48', BC: '#475569', APPR: '#7c3aed', QM: '#0891b2', FI: '#4f46e5', CO: '#c026d3', HR: '#ea580c' };
function modColor(m) { if (MODC[m]) return MODC[m]; let h = 0; for (const c of m || '') h = (h * 31 + c.charCodeAt(0)) % 360; return `hsl(${h} 55% 45%)`; }
const modTag = (m) => `<span class="mod" style="--mc:${modColor(m)}" title="${esc(MODN[m] || m)}">${esc(m || '?')}</span>`;
const crudHtml = (c) => `<span class="crud">${'CRUD'.split('').map((x) => `<i class="${x} ${c && c.includes(x) ? 'on' : ''}">${x}</i>`).join('')}</span>`;
const tblHtml = (t) => `<span class="tbl" onclick="event.stopPropagation();go('${link('t', t)}')">${esc(t)}</span>`;
const srcChip = (s) => s.source === '수기' ? '<span class="chip src-m" title="도구 밖에서 만든 사양서">수기</span>' : '<span class="chip src-t" title="AX사양서도구로 만든 사양서">도구</span>';
const pidTxt = (s) => (s.programId === '미정' || !s.programId ? 'ID 미정' : s.programId);
const dateTxt = (s) => s.source === '수기' ? (s.confirmedAt || '날짜 없음') : (s.confirmedAt || '') + (s.version > 1 ? ` · ${s.version}판` : '');
function mergeCrud(a, b) { const set = new Set(((a || '') + (b || '')).replace(/[^CRUD]/g, '').split('')); return 'CRUD'.split('').filter((x) => set.has(x)).join(''); }

function prepare(index) {
  IDX = index; S = index.specs || [];
  S.forEach((s, i) => {
    s.i = i;
    ['columns', 'tables', 'mockups', 'sql', 'outputs', 'prompts', 'reviews', 'files', 'revisions', 'history', 'layout', 'same', 'services', 'combos', 'func', 'tech', 'tests', 'base', 'related'].forEach((k) => (s[k] = s[k] || []));
    s.source = s.source || '도구'; s.workspace = s.workspace || ''; s.module = s.module || '?';
  });
  BYKEY = {}; S.forEach((s) => (BYKEY[s.key] = s));
  // 사양서에 이름이 빠진 테이블은 다른 사양서에 적힌 이름을 빌려 쓴다 (빌린 이름은 nameFrom 에 출처를 남긴다)
  const TN = {}; S.forEach((s) => s.tables.forEach((t) => { if (t.id && t.name && !t.nameFrom && !TN[t.id]) TN[t.id] = { name: t.name, from: s.name }; }));
  S.forEach((s) => s.tables.forEach((t) => { if (t.id && !t.name && TN[t.id]) { t.name = TN[t.id].name; t.nameFrom = TN[t.id].from; } }));
  S.forEach((s) => (s.children = S.filter((o) => o.parent === s.key).map((o) => o.i)));
  // 쿼리에서 쓰는 테이블 (FROM·JOIN=R · INSERT=C · UPDATE·MERGE=U · DELETE=D)
  S.forEach((s) => {
    const m = {};
    s.sql.forEach((f) => {
      const t = (f.text || '').replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const x of t.matchAll(/\b(FROM|JOIN|INTO|UPDATE|MERGE(?:\s+INTO)?|DELETE(?:\s+FROM)?)\s+(?:\[?dbo\]?\.)?\[?([A-Za-z][A-Za-z0-9_]{2,})\]?/gi)) {
        const id = x[2].toUpperCase();
        if (!id.includes('_') || /^(UFN|USP|FN)_/.test(id)) continue;
        const k = x[1].toUpperCase();
        m[id] = (m[id] || '') + (k.startsWith('DELETE') ? 'D' : k === 'INTO' ? 'C' : k === 'UPDATE' || k.startsWith('MERGE') ? 'U' : 'R');
      }
    });
    s.sqlTables = m;
  });
  PROJ = {};
  S.forEach((s) => { const p = (PROJ[s.project] = PROJ[s.project] || {}); p[s.workspace] = (p[s.workspace] || 0) + 1; });
  if (!scopeValid(scope)) scope = '';
  rebuild();
}
function scopeValid(sc) { if (!sc) return true; const [k, v] = [sc[0], sc.slice(2)]; if (k === 'p') return !!PROJ[v]; const [p, w] = v.split('/'); return !!(PROJ[p] && PROJ[p][w]); }
function inScope(s, sc = scope) { if (!sc) return true; const v = sc.slice(2); return sc[0] === 'p' ? s.project === v : s.project + '/' + s.workspace === v; }
function scopeLabel(sc = scope) { return !sc ? '전체 프로젝트' : sc.slice(2).replace('/', ' › '); }
function rebuild() {
  TBL = {};
  const add = (id, name, si, crud) => { const e = TBL[id] || (TBL[id] = { id, name: '', specs: {}, cols: {} }); if (!e.name && name) e.name = name; e.specs[si] = mergeCrud(e.specs[si], crud); return e; };
  S.filter((s) => inScope(s)).forEach((s) => {
    s.tables.forEach((t) => t.id && add(t.id, t.name, s.i, t.crud));
    s.columns.forEach((c) => {
      if (!c.tbl) return;
      const e = add(c.tbl, '', s.i, c.crud || 'R');
      if (c.column && c.column !== '-') (e.cols[c.column] = e.cols[c.column] || []).push({ s: s.i, label: c.label, area: c.area });
    });
    Object.entries(s.sqlTables).forEach(([id, c]) => add(id, '', s.i, c));
  });
}
function setScope(sc) { scope = scope === sc ? scope : sc; ls.set('sf.scope', scope); rebuild(); render(); }
window.setScope = setScope;
function scopeSelect(id) {
  const ps = Object.keys(PROJ).sort();
  if (!ps.length) return '';
  let o = `<option value="">전체 프로젝트 (${S.length})</option>`;
  ps.forEach((p) => {
    const ws = PROJ[p]; const n = Object.values(ws).reduce((a, b) => a + b, 0);
    o += `<option value="p:${esc(p)}">${esc(p)} (${n})</option>`;
    if (Object.keys(ws).length > 1) Object.keys(ws).sort().forEach((w) => (o += `<option value="w:${esc(p + '/' + w)}">　└ ${esc(w)} (${ws[w]})</option>`));
  });
  return `<select class="scope" id="${id}" title="찾을 범위">${o}</select>`;
}
function bindScope(id) { const el = $(id); if (!el) return; el.value = scope; el.onchange = () => setScope(el.value); }

/* ---------------- 검색 ---------------- */
function parseQuery(q) {
  let sc = scope; const toks = [];
  q.trim().split(/\s+/).filter(Boolean).forEach((t) => {
    if (t.startsWith('@') && t.length > 1) {
      const n = t.slice(1).toLowerCase();
      const p = Object.keys(PROJ).find((x) => x.toLowerCase().includes(n));
      if (p) { sc = 'p:' + p; return; }
      for (const pp of Object.keys(PROJ)) { const w = Object.keys(PROJ[pp]).find((x) => x.toLowerCase().includes(n)); if (w) { sc = 'w:' + pp + '/' + w; return; } }
    }
    toks.push(t);
  });
  return { sc, toks };
}
function searchAll(toks, sc) {
  if (!toks.length) return [];
  const out = [];
  S.filter((s) => inScope(s, sc)).forEach((s) => {
    const hits = [], covered = new Set();
    const add = (kind, obj, txt, score) => {
      const m = toks.filter((t) => has(txt, t)); if (!m.length) return;
      m.forEach((t) => covered.add(t.toLowerCase()));
      hits.push({ kind, obj, m: m.map((t) => t.toLowerCase()), score: score * m.length * m.length });
    };
    add('name', null, [s.name, s.programId, s.reqId || '', s.base.join(' ')].join(' '), 10);
    s.columns.forEach((c) => add('col', c, [c.label, c.column, c.tbl, c.desc, c.source].join(' '), toks.some((t) => has(c.column, t) || has(c.tbl, t) || has(c.label, t)) ? 6 : 2));
    s.tables.forEach((t) => add('tbl', t, [t.id, t.name, t.note].join(' '), 5));
    const addFile = (kind, f) => {
      const m = toks.filter((t) => has(f.text, t) || has(f.name, t)); if (!m.length) return;
      m.forEach((t) => covered.add(t.toLowerCase()));
      const line = (f.text || '').split('\n').find((l) => toks.some((t) => has(l, t))) || '';
      hits.push({ kind, obj: { name: f.name, line: line.trim() }, m: m.map((t) => t.toLowerCase()), score: (kind === 'sql' ? 3 : 1.5) * m.length * m.length });
    };
    s.sql.forEach((f) => addFile('sql', f)); s.prompts.forEach((f) => addFile('req', f)); s.reviews.forEach((f) => addFile('rev', f));
    s.services.forEach((v) => add('svc', v, [v.id, v.name, v.note].join(' '), 3));
    s.combos.forEach((v) => add('cmb', v, [v.id, v.usedBy, v.name].join(' '), 3));
    [...s.func, ...s.tech, ...s.layout].forEach((l) => add('logic', l, l, 1.5));
    if (s.overview) add('ov', s.overview, s.overview, 4);
    if (s.memo) s.memo.split('\n').filter((l) => l.trim().startsWith('-')).forEach((l) => add('memo', l, l, 1));
    s.history.forEach((h) => add('hist', h.join(' · '), h.join(' '), 1));
    if (!s.parsed && s.fulltext) s.fulltext.split('\n').forEach((l) => add('full', l, l, 1));
    if (toks.every((t) => covered.has(t.toLowerCase()))) {
      hits.sort((a, b) => b.score - a.score);
      out.push({ s, hits, score: hits.reduce((a, h) => a + h.score, 0) });
    }
  });
  return out.sort((a, b) => b.score - a.score);
}

/* ---------------- 라우팅 ---------------- */
let fSrc = null, fMod = null, fKind = null, selKey = null;
window.addEventListener('hashchange', render);
function route() { const segs = location.hash.replace(/^#\/?/, '').split('/').map((x) => { try { return decodeURIComponent(x); } catch (e) { return x; } }); return segs; }
function render() {
  const [r, a, b] = route();
  const hasData = !!IDX;
  $('tsearch').style.visibility = hasData && r ? 'visible' : 'hidden';
  $('scopeTop').innerHTML = hasData && r && r !== 'settings' ? scopeSelect('scTop') : ''; bindScope('scTop');
  if (r === 'q') { if (!hasData) return renderOnboard(); $('q2').value = a === '*' ? '' : a || ''; return renderResults(a || ''); }
  window.scrollTo(0, 0);
  if (r === 'settings') return renderSettings();
  if (!hasData) return renderOnboard();
  if (r === 's') return renderSpec(a, b || 'sum');
  if (r === 't') return renderTable(a);
  if (r === 'm') { fMod = a; return go(link('q', '') ); }
  renderHome();
}
function bindSearch(inp) {
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && inp.value.trim()) { fSrc = fMod = fKind = null; selKey = null; go(link('q', inp.value.trim())); } });
}
document.addEventListener('keydown', (e) => {
  const tag = document.activeElement.tagName;
  if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA') { e.preventDefault(); const i = $('q1') || $('q2'); i.focus(); i.select(); }
  if (e.key === 'Escape') closeModal();
  if (route()[0] === 'q' && tag !== 'INPUT' && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter')) {
    const items = [...document.querySelectorAll('.ri')]; if (!items.length) return;
    let k = items.findIndex((x) => x.classList.contains('sel'));
    if (e.key === 'Enter') { if (k >= 0) go(link('s', items[k].dataset.key)); return; }
    e.preventDefault(); k = Math.max(0, Math.min(items.length - 1, k + (e.key === 'ArrowDown' ? 1 : -1)));
    selectResult(items[k].dataset.key); items[k].scrollIntoView({ block: 'nearest' });
  }
});
bindSearch($('q2'));

/* ---------------- 처음 (폴더 연결 전) ---------------- */
function renderOnboard() {
  const sup = SF.supported;
  $('app').innerHTML = `<div class="onb">
    <span class="pill">🔒 내 PC 안에서만 · 설치 없음</span>
    <h1>그 컬럼, <em>어느 사양서</em>였더라?</h1>
    <p class="lead">내 PC의 사양서 폴더를 연결하면 엑셀 사양서 · 목업 · 쿼리를 읽어 <b>테이블 · 컬럼 · 로직</b>으로 바로 찾아 줍니다.</p>
    <div class="acts">
      ${sup ? `<button class="btn pri big" id="addRoot"><svg viewBox="0 0 24 24"><path d="M3 7h6l2 2h10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 12v5M9.5 14.5h5"/></svg>사양서 폴더 연결</button>` : ''}
      <button class="btn big" id="demoBtn">예시로 둘러보기</button>
    </div>
    ${sup ? '' : `<div class="privacy" style="background:var(--warn-soft)"><svg viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01"/><circle cx="12" cy="12" r="9"/></svg><div><b>이 브라우저는 폴더 연결을 지원하지 않습니다.</b><br>Chrome 또는 Edge(PC)에서 열어 주세요. 예시 둘러보기는 어디서나 됩니다.</div></div>`}
    <div class="steps">
      <div class="card step"><div class="n">1</div><b>폴더 연결</b><span>프로젝트 폴더(예: <code>01. 프로젝트</code>)를 고르면 그 아래 작업공간과 사양서 폴더를 모두 찾습니다. 사람마다 위치가 달라도 됩니다.</span></div>
      <div class="card step"><div class="n">2</div><b>자동 색인</b><span>도구로 만든 확정본 · 모델, 도구 밖 엑셀(판 묶음 · 팝업), 목업, SQL, 출력물을 읽습니다. 바뀐 파일만 다시 읽습니다.</span></div>
      <div class="card step"><div class="n">3</div><b>바로 찾기</b><span>테이블 이름 · 컬럼 · 화면 라벨 · 로직에 나온 말 무엇이든. 결과 오른쪽에 걸린 곳만 모아 보여 줍니다.</span></div>
    </div>
    <div class="privacy"><svg viewBox="0 0 24 24"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/></svg>
      <div><b>사양서 파일은 이 PC 밖으로 나가지 않습니다.</b> 이 사이트는 화면(프로그램)만 내려받고, 폴더는 브라우저가 직접 읽습니다. 만든 색인도 이 브라우저(IndexedDB)에만 저장되어 다른 사람은 볼 수 없습니다.</div></div>
  </div>`;
  if ($('addRoot')) $('addRoot').onclick = addRootFlow;
  $('demoBtn').onclick = () => { DEMO = true; prepare(SF.demoIndex()); showBanner(); go('#/'); };
}

/* ---------------- 홈 ---------------- */
function renderHome() {
  const SC = S.filter((s) => inScope(s));
  const mods = {}; SC.forEach((s) => (mods[s.module] = (mods[s.module] || 0) + 1));
  const recent = [...SC].filter((s) => s.confirmedAt).sort((a, b) => b.confirmedAt.localeCompare(a.confirmedAt)).slice(0, 8);
  const tops = Object.values(TBL).map((t) => ({ id: t.id, name: t.name, n: Object.keys(t.specs).length })).sort((a, b) => b.n - a.n).slice(0, 9);
  const max = tops[0]?.n || 1;
  const nCols = SC.reduce((a, s) => a + s.columns.length, 0), nSql = SC.reduce((a, s) => a + s.sql.length, 0), nMock = SC.reduce((a, s) => a + s.mockups.length, 0);
  const colEx = (() => { for (const t of tops) { const c = Object.keys(TBL[t.id].cols).find((c) => c.length > 6); if (c) return c; } return ''; })();
  const sugg = [tops[0] && ['테이블', tops[0].id], colEx && ['컬럼', colEx], SC[0] && ['화면', SC[0].name.replace(/\(S\)$/, '')], ['로직', '확정']].filter(Boolean);
  $('app').innerHTML = `
  <section class="hero">
    <h1>무엇을 찾을까요?</h1>
    <p>테이블 · 컬럼 · 화면 라벨 · 프로그램ID · 로직에 나온 말 — 여러 단어는 모두 들어간 사양서만 찾습니다. <span class="muted">@프로젝트 로 범위 지정</span></p>
    <div class="bigsearch"><div class="box"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
      <input id="q1" placeholder="예) S_SO_DTL 납기" autocomplete="off" spellcheck="false" autofocus></div>${scopeSelect('scHome')}</div>
    <div class="sugg"><span class="lab">이렇게 찾아 보세요</span>${sugg.map(([k, v]) => `<button data-q="${esc(v)}"><b>${k}</b>${esc(v)}</button>`).join('')}</div>
  </section>
  <div class="stats">
    <div class="card stat"><div class="v">${SC.length}<small>건</small></div><div class="l">사양서 · ${esc(scopeLabel())}</div></div>
    <div class="card stat"><div class="v">${Object.keys(TBL).length}</div><div class="l">테이블</div></div>
    <div class="card stat"><div class="v">${nCols.toLocaleString()}</div><div class="l">화면 컬럼 매핑</div></div>
    <div class="card stat"><div class="v">${nSql}</div><div class="l">쿼리 파일</div></div>
    <div class="card stat"><div class="v">${nMock}</div><div class="l">목업</div></div>
  </div>
  <div class="card"><div class="ch">모듈별 <span class="muted">눌러서 그 모듈만 보기</span></div><div class="cb"><div class="mods">
    ${Object.entries(mods).sort((a, b) => b[1] - a[1]).map(([m, n]) => `<div class="modt" style="--mc:${modColor(m)}" data-m="${esc(m)}">${modTag(m)}<div><b>${esc(MODN[m] || m)}</b><span>${n}건</span></div></div>`).join('')}
  </div></div></div>
  <div class="grid2">
    <div class="card"><div class="ch">최근 확정 · 개정</div><div class="cb"><ul class="list">
      ${recent.map((s) => `<li>${modTag(s.module)}<a onclick="go('${link('s', s.key)}')">${esc(s.name)}</a>${s.source === '수기' ? '<span class="chip src-m">수기</span>' : ''}<span class="r">${esc(s.confirmedAt)}</span></li>`).join('') || '<li class="muted">없음</li>'}
    </ul></div></div>
    <div class="card"><div class="ch">많이 쓴 테이블 <span class="muted">사양서 수</span></div><div class="cb">
      ${tops.map((t) => `<div class="bar"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${tblHtml(t.id)} <span class="muted small">${esc(t.name)}</span></span><div class="track"><div class="fill" style="width:${(t.n / max) * 100}%"></div></div><span class="n">${t.n}</span></div>`).join('')}
    </div></div>
  </div>`;
  bindSearch($('q1')); bindScope('scHome');
  document.querySelectorAll('.sugg button').forEach((b) => (b.onclick = () => go(link('q', b.dataset.q))));
  document.querySelectorAll('.modt').forEach((d) => (d.onclick = () => { fMod = d.dataset.m; fSrc = fKind = null; go(link('q', '*')); }));
}

/* ---------------- 결과 ---------------- */
let LAST = null, REF = [], refQ = null;
function renderResults(q) {
  if (q !== refQ) { REF = []; refQ = q; }
  const { sc, toks: qt } = parseQuery(q);
  const all = q.trim() === '*' || (!qt.length && fMod);
  let res = all ? S.filter((s) => inScope(s, sc)).map((s) => ({ s, hits: [], score: 0 })).sort((a, b) => a.s.name.localeCompare(b.s.name)) : searchAll(qt, sc);
  // 검색 내 검색: 좁히기 말마다 그 말이 걸린 사양서만 남기고, 걸린 곳을 앞에 붙인다
  if (REF.length) {
    const sub = new Map(searchAll(REF, sc).map((r) => [r.s.key, r]));
    res = res.filter((r) => sub.has(r.s.key)).map((r) => { const x = sub.get(r.s.key); return { s: r.s, hits: [...x.hits, ...r.hits], score: r.score + x.score }; });
  }
  const toks = [...qt, ...REF];
  const cnt = (f) => { const m = {}; res.forEach((r) => f(r).forEach((k) => (m[k] = (m[k] || 0) + 1))); return m; };
  const cSrc = cnt((r) => [r.s.source]), cMod = cnt((r) => [r.s.module]), cKind = cnt((r) => [...new Set(r.hits.map((h) => h.kind))].filter((k) => k !== 'name'));
  const shown = res.filter((r) => (!fSrc || r.s.source === fSrc) && (!fMod || r.s.module === fMod) && (!fKind || r.hits.some((h) => h.kind === fKind)));
  LAST = { toks, shown };
  if (!shown.find((r) => r.s.key === selKey)) selKey = shown[0]?.s.key || null;
  const outside = sc && !all && !REF.length ? searchAll(qt, '').length - res.length : 0;
  const x13 = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  const title = all ? (fMod ? `${esc(MODN[fMod] || fMod)} 모듈` : '전체 사양서') : `<q>${esc(qt.join(' '))}</q>`;
  const grp = (label, cur, counts, set, names) => {
    const keys = Object.keys(counts); if (keys.length < 2 && !cur) return '';
    return `<div class="g"><span>${label}</span><button class="${!cur ? 'on' : ''}" data-f="${set}" data-v="">전체</button>${keys.sort((a, b) => counts[b] - counts[a]).map((k) => `<button class="${cur === k ? 'on' : ''}" data-f="${set}" data-v="${esc(k)}">${esc(names ? names(k) : k)} <em>${counts[k]}</em></button>`).join('')}</div>`;
  };
  $('app').innerHTML = `
    <div class="rhead"><h2 class="crumbq">${title}${REF.map((t) => `<span class="gt">›</span><q>${esc(t)}</q>`).join('')}</h2>
      <span class="cnt">사양서 <b>${shown.length}</b>건${shown.length !== res.length ? ` / ${res.length}` : ''} · ${esc(scopeLabel(sc))}</span>
      ${sc ? `<a class="small" onclick="setScope('');">범위 풀기</a>` : ''}${outside > 0 ? `<span class="small muted">범위 밖에 ${outside}건 더</span>` : ''}</div>
    <div class="refine"><span class="lab"><svg viewBox="0 0 24 24"><path d="M3 5h18l-7 8v6l-4-2v-4z"/></svg>결과 안에서</span>
      ${REF.map((t, i) => `<span class="rchip">${esc(t)}<button data-ri="${i}" title="이 조건 빼기">${x13}</button></span>`).join('')}
      <input id="rq" placeholder="${REF.length ? '더 좁힐 말 + Enter' : '이 결과에서 다시 찾기 — 예) 그리드 · 수량 · 테이블명 + Enter'}" autocomplete="off" spellcheck="false">
      ${REF.length ? '<button class="clr" id="rclr">모두 풀기</button>' : ''}</div>
    ${all ? '' : answerCard(qt)}
    <div class="filters">${grp('출처', fSrc, cSrc, 'src')}${grp('모듈', fMod, cMod, 'mod', (k) => k)}${grp('걸린 곳', fKind, cKind, 'kind', (k) => KIND[k])}</div>
    ${shown.length ? `<div class="split"><div class="rlist" id="rlist">${shown.map((r) => resultItem(r, toks)).join('')}</div><div class="card pv" id="pv"></div></div>`
      : `<div class="card empty">찾은 사양서가 없습니다.<br><span class="small">단어를 줄이거나, 컬럼 대신 화면 라벨(예: 납기)로 찾아 보세요.</span></div>`}`;
  document.querySelectorAll('.filters button').forEach((b) => (b.onclick = () => {
    const v = b.dataset.v || null; if (b.dataset.f === 'src') fSrc = v; else if (b.dataset.f === 'mod') fMod = v; else fKind = v; renderResults(q);
  }));
  const again = (focus) => { renderResults(q); if (focus) $('rq').focus(); };
  $('rq').onkeydown = (e) => {
    const v = e.target.value.trim();
    if (e.key === 'Enter' && v) { v.split(/\s+/).forEach((t) => { if (!REF.some((x) => x.toLowerCase() === t.toLowerCase())) REF.push(t); }); again(true); }
    else if (e.key === 'Backspace' && !e.target.value && REF.length) { REF.pop(); again(true); }
    else if (e.key === 'Escape') { e.target.value = ''; e.target.blur(); }
  };
  document.querySelectorAll('[data-ri]').forEach((b) => (b.onclick = () => { REF.splice(+b.dataset.ri, 1); again(true); }));
  if ($('rclr')) $('rclr').onclick = () => { REF = []; again(true); };
  document.querySelectorAll('.ri').forEach((el) => {
    el.onclick = () => selectResult(el.dataset.key);
    el.ondblclick = () => go(link('s', el.dataset.key));
  });
  if (selKey) selectResult(selKey);
}
function bestHit(r) { return r.hits.find((h) => h.kind !== 'name' && (!fKind || h.kind === fKind)); }
function resultItem(r, toks) {
  const s = r.s, h = bestHit(r);
  const kinds = {}; r.hits.forEach((x) => { if (x.kind !== 'name') kinds[x.kind] = (kinds[x.kind] || 0) + 1; });
  return `<div class="ri ${s.key === selKey ? 'sel' : ''}" data-key="${esc(s.key)}">
    <div class="l1">${modTag(s.module)}<span class="nm" title="${esc(s.name)}">${hl(s.name, toks)}</span><span class="sd ${s.source === '수기' ? 'm' : ''}" title="${s.source} 사양서"></span><span class="dt">${esc(dateTxt(s))}</span></div>
    <div class="ans">${h ? `${kindTag(h.kind)}<span class="txt">${oneLine(h, toks)}</span>` : `<span class="txt">${hl(trim(s.overview || '', 120), toks) || '<span class="muted">요약 없음</span>'}</span>`}</div>
    ${Object.keys(kinds).length ? `<div class="l3">${Object.entries(kinds).map(([k, n]) => `<span>${KIND[k]} <b>${n}</b></span>`).join('')}</div>` : ''}
  </div>`;
}
function oneLine(h, toks) {
  const o = h.obj;
  if (h.kind === 'col') return `<span class="map"><span class="lb">${hl(o.label || '-', toks)}</span><span class="ar">←</span>${colOf(o) ? `${o.tbl ? `<span>${hl(o.tbl, toks)}</span>.` : ''}<code>${hl(colOf(o), toks)}</code>` : `${o.tbl ? `<span>${hl(o.tbl, toks)}</span> ` : ''}<span class="muted">${esc(trim(noColTxt(o), 40))}</span>`}</span>`;
  if (h.kind === 'tbl') return `<code>${hl(o.id, toks)}</code> ${hl(o.name, toks)}`;
  if (h.kind === 'sql' || h.kind === 'req' || h.kind === 'rev') return `<code>${hl(o.name, toks)}</code> <span class="muted">${hl(trim(o.line, 90), toks)}</span>`;
  if (h.kind === 'svc' || h.kind === 'cmb') return `<code>${hl(o.id, toks)}</code> ${hl(o.name || o.usedBy, toks)}`;
  return hl(trim(snippet(String(o), toks), 140), toks);
}
function snippet(t, toks) { const lo = t.toLowerCase(); const i = Math.min(...toks.map((x) => { const k = lo.indexOf(x.toLowerCase()); return k < 0 ? 1e9 : k; })); return i > 40 && i < 1e9 ? '…' + t.slice(i - 30) : t; }
window.selectResult = function (key) {
  selKey = key;
  document.querySelectorAll('.ri').forEach((x) => x.classList.toggle('sel', x.dataset.key === key));
  const r = LAST && LAST.shown.find((x) => x.s.key === key); if (!r || !$('pv')) return;
  $('pv').innerHTML = preview(r, LAST.toks); $('pv').scrollTop = 0;
  if ($('pvmap')) drawMapInto($('pvmap'), r.s, LAST.toks, { limit: 12 });
  hydrate($('pv'));
};
/* ---------------- 화면 ↔ DB 컬럼 매핑 ---------------- */
const TPAL = ['#2563eb', '#0d9488', '#d97706', '#db2777', '#7c3aed', '#16a34a', '#dc2626', '#0891b2', '#ca8a04', '#4f46e5', '#c026d3', '#64748b'];
function tblColors(s) { const m = {}; let k = 0; [...s.columns.map((c) => c.tbl), ...s.tables.map((t) => t.id)].forEach((id) => { if (id && !(id in m)) m[id] = TPAL[k++ % TPAL.length]; }); return m; }
const colHit = (c, toks) => toks.length > 0 && toks.some((t) => has([c.label, c.column, c.tbl, c.desc].join(' '), t));
const colOf = (c) => (c.column && c.column !== '-' ? c.column : '');
/* DB 컬럼이 적히지 않은 줄 — '—' 대신 어떤 칸인지 말로 보인다 */
function noColTxt(c) {
  const t = String(c.table || '').trim(), cond = /조회\s*조건/.test(c.area || '');
  if (c.tbl) return cond ? '조회 조건' : '컬럼 안 적힘';
  if (cond) return '조회 조건 · 저장 안 함';
  if (/저장\s*안\s*함/.test(t)) return '저장 안 함';
  if (/버튼/.test(c.area || '') && (!t || t === '-')) return '버튼';
  return t && t !== '-' ? t : 'DB 컬럼 없음';
}
function mapRow(c, toks, tc, wide) {
  const ch = c.change === '추가' ? '<span class="chip add">추가</span>' : c.change === '변경' ? '<span class="chip chg">변경</span>' : '';
  const col = colOf(c), nc = col ? '' : noColTxt(c);
  const db = c.tbl
    ? `<span class="mt" style="--tc:${tc[c.tbl]}" onclick="event.stopPropagation();go('${link('t', c.tbl)}')" title="${esc((TBL[c.tbl] && TBL[c.tbl].name) || c.tbl)} — 누르면 테이블 보기">${hl(c.tbl, toks)}</span>${col ? `<span class="mc" title="${esc(col)}">${hl(col, toks)}</span>` : `<span class="mc none" title="사양서에 이 칸의 DB 컬럼이 적혀 있지 않습니다">${esc(nc)}</span>`}`
    : col ? `<span class="mc solo">${hl(col, toks)}</span>` : `<span class="mnone" title="${esc(c.table && c.table !== '-' ? c.table : '사양서에 이 칸의 DB 컬럼이 적혀 있지 않습니다')}">${esc(trim(nc, 40))}</span>`;
  const req = c.required && !['불가', '선택', 'N', ''].includes(c.required) ? ` · <b>${esc(c.required)}</b>` : '';
  return `<div class="mrow ${colHit(c, toks) ? 'hit' : ''}"${wide ? '' : ` title="${esc(sentTxt(c.desc || ''))}"`}><span class="ml" title="${esc(c.label)}">${hl(c.label || '-', toks)}${ch}</span><span class="ma">→</span><span class="mdb">${db}</span>`
    + (wide ? `<span class="mdisp">${esc(c.display || '')}${req}</span><span class="mdesc">${sent(hl(c.desc || '', toks))}${c.default ? `<div class="muted">기본값 ${esc(c.default)}</div>` : ''}</span>` : `<span class="mdisp">${esc(c.display || '')}</span>`) + '</div>';
}
/* o = { wide, by:'area'|'table', tf:테이블 거르기, text:글자 거르기, area, limit } — 그리고 다시 그리기용 redraw(o) */
function mapView(s, toks, o, redraw) {
  const tc = tblColors(s), f = (o.text || '').toLowerCase();
  const cnt = {}; s.columns.forEach((c) => { if (c.tbl) cnt[c.tbl] = (cnt[c.tbl] || 0) + 1; });
  let cols = s.columns.filter((c) => (!o.tf || c.tbl === o.tf) && (!o.area || o.area === '전체' || c.area === o.area) && (!f || [c.label, c.column, c.tbl, c.desc].join(' ').toLowerCase().includes(f)));
  const total = cols.length;
  let cut = false;
  if (o.limit && cols.length > o.limit) { // 접힌 상태: 걸린 줄은 모두, 모자라면 앞에서부터 채운다 (순서는 화면 순서 그대로)
    const keep = new Set(cols.filter((c) => colHit(c, toks)));
    for (const c of cols) { if (keep.size >= o.limit) break; keep.add(c); }
    cols = cols.filter((c) => keep.has(c)); cut = true;
  }
  const groups = new Map();
  cols.forEach((c) => { const g = o.by === 'table' ? (c.tbl || '테이블 없음') : (c.area || '기타'); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(c); });
  const head = o.wide ? `<div class="mrow mhd"><span>화면 라벨</span><span></span><span>테이블 · 컬럼</span><span>표시</span><span>어떤 값 · 규칙</span></div>` : '';
  const legend = Object.keys(cnt).length > 1 || o.tf ? `<div class="tleg">${Object.keys(tc).filter((t) => cnt[t]).map((t) => `<button class="${o.tf === t ? 'on' : o.tf ? 'off' : ''}" style="--tc:${tc[t]}" data-tf="${esc(t)}" title="${esc((TBL[t] && TBL[t].name) || '')} — 누르면 이 테이블 컬럼만"><i></i><code>${esc(t)}</code>${TBL[t] && TBL[t].name ? `<span>${esc(trim(TBL[t].name, 14))}</span>` : ''}<em>${cnt[t]}</em></button>`).join('')}</div>` : '';
  const html = `<div class="mapv ${o.wide ? 'wide' : ''}">${legend}
    ${[...groups].map(([g, list]) => `<div class="mgrp"><div class="mgh">${o.by === 'table' && tc[g] ? `<span class="mt" style="--tc:${tc[g]};border-radius:6px;font-family:var(--mono)" onclick="go('${link('t', g)}')">${esc(g)}</span> <span style="font-weight:600;color:var(--ink2)">${esc((TBL[g] && TBL[g].name) || '')}</span>` : esc(g)} <em>${list.length}</em></div>${head}${list.map((c) => mapRow(c, toks, tc, o.wide)).join('')}</div>`).join('') || '<div class="empty small">맞는 컬럼이 없습니다.</div>'}
    ${cut ? `<div class="mfoot"><button data-more>전체 ${total}개 보기</button></div>` : ''}</div>`;
  return { html, bind: (root) => {
    root.querySelectorAll('[data-tf]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); o.tf = o.tf === b.dataset.tf ? null : b.dataset.tf; redraw(o); }));
    const m = root.querySelector('[data-more]'); if (m) m.onclick = (e) => { e.stopPropagation(); o.limit = 0; redraw(o); };
  } };
}
function drawMapInto(el, s, toks, o) { const v = mapView(s, toks, o, (o2) => drawMapInto(el, s, toks, o2)); el.innerHTML = v.html; v.bind(el); }

const ORDER = ['col', 'tbl', 'sql', 'logic', 'svc', 'cmb', 'ov', 'memo', 'req', 'rev', 'hist', 'full'];
function preview(r, toks) {
  const s = r.s;
  const groups = {}; r.hits.forEach((h) => { if (h.kind !== 'name' && (!fKind || h.kind === fKind) && !(h.kind === 'col' && s.columns.length)) (groups[h.kind] = groups[h.kind] || []).push(h); });
  const seen = new Set();
  const body = ORDER.filter((k) => groups[k]).map((k) => {
    const list = groups[k].filter((h) => { const id = k + JSON.stringify(h.obj).slice(0, 200); if (seen.has(id)) return false; seen.add(id); return true; });
    const tab = { col: 'col', tbl: 'col', sql: 'sql', logic: 'logic', svc: 'flow', cmb: 'logic', memo: 'memo', req: 'mat', rev: 'mat', hist: 'mat' }[k] || 'sum';
    return `<div class="hg"><div class="hgh">${kindTag(k)}<span class="n">${list.length}곳</span></div>
      ${list.slice(0, 6).map((h) => `<div class="hrow">${pvRow(h, toks)}</div>`).join('')}
      ${list.length > 6 ? `<a class="more" onclick="go('${link('s', s.key, tab)}')">${list.length - 6}곳 더 →</a>` : ''}</div>`;
  }).join('');
  return `<div class="ph"><h3>${modTag(s.module)}${hl(s.name, toks)}</h3>
    <div class="chips"><span class="chip id">${esc(pidTxt(s))}</span>${s.reqId ? `<span class="chip id">${esc(s.reqId)}</span>` : ''}${srcChip(s)}${s.base.map((b) => `<span class="chip id" title="기준 화면">기준 ${esc(b)}</span>`).join('')}<span class="chip">${esc(s.workspace)}</span>${s.parsed ? '' : '<span class="chip warn">구조 미해석</span>'}</div>
    ${s.overview ? `<div class="ov">${sent(hl(s.overview, toks))}</div>` : ''}
    <div class="acts"><button class="btn pri" onclick="go('${link('s', s.key)}')">사양서 열기</button>${s.excel && !DEMO ? `<button class="btn" onclick="openExcel('${esc(s.key)}')">엑셀 미리보기</button>` : ''}</div>
  </div><div class="pb">
    ${s.columns.length ? `<div class="pvsec">화면 ↔ DB 매핑 <span class="n">컬럼 ${s.columns.length} · 테이블 ${Object.keys(tblColors(s)).length}${r.hits.some((h) => h.kind === 'col') ? ` · <mark>검색어 걸린 줄</mark>` : ''}</span><a onclick="go('${link('s', s.key, 'col')}')">크게 보기 →</a></div><div id="pvmap"></div>` : ''}
    ${body ? `${s.columns.length ? '<div class="pvsec">그 밖에 걸린 곳</div>' : ''}${body}` : s.columns.length ? '' : `<div class="empty small">이름이 걸렸습니다.</div>`}
    ${s.mockups[0] ? `<div class="pvsec">목업</div><div class="mini-mock" style="margin-top:0" onclick="openMock('${esc(s.mockups[0])}')"><iframe data-ref="${esc(s.mockups[0])}" tabindex="-1"></iframe></div>` : ''}</div>`;
}
function pvRow(h, toks) {
  const o = h.obj;
  if (h.kind === 'col') return `<div><span class="map"><span class="lb">${hl(o.label || '-', toks)}</span><span class="ar">←</span>${o.tbl ? tblHtml(o.tbl) : ''}${colOf(o) ? `<code>${hl(colOf(o), toks)}</code>` : ` <span class="muted">${esc(trim(noColTxt(o), 40))}</span>`}</span>
    ${o.display ? `<span class="chip" style="height:20px;margin-left:6px">${esc(o.display)}</span>` : ''}${o.change === '추가' ? '<span class="chip add" style="height:20px;margin-left:4px">추가</span>' : o.change === '변경' ? '<span class="chip chg" style="height:20px;margin-left:4px">변경</span>' : ''}
    <span class="muted small" style="margin-left:6px">${esc(o.area || '')}</span></div>${o.desc ? `<div class="d">${sent(hl(trim(o.desc, 220), toks))}</div>` : ''}`;
  if (h.kind === 'tbl') return `<div>${tblHtml(o.id)} ${esc(o.name)} ${crudHtml(o.crud)}</div>${o.note ? `<div class="d">${sent(hl(trim(o.note, 200), toks))}</div>` : ''}`;
  if (h.kind === 'sql' || h.kind === 'req' || h.kind === 'rev') return `<div><code>${hl(o.name, toks)}</code></div><pre>${hl(trim(o.line, 220), toks)}</pre>`;
  if (h.kind === 'svc') return `<div><code>${hl(o.id, toks)}</code> ${hl(o.name, toks)}</div>${o.note ? `<div class="d">${sent(hl(trim(o.note, 200), toks))}</div>` : ''}`;
  if (h.kind === 'cmb') return `<div><code>${hl(o.id, toks)}</code> · ${hl(o.usedBy, toks)}</div>${o.name ? `<div class="d">${hl(trim(o.name, 200), toks)}</div>` : ''}`;
  return `<div>${hl(trim(snippet(String(o), toks), 260), toks)}</div>`;
}
/* 정답 카드: 검색어가 테이블 이름이나 컬럼 이름과 똑같으면 맨 위에 바로 보여 준다 */
function answerCard(toks) {
  for (const t of toks) {
    const T = t.toUpperCase();
    if (TBL[T]) {
      const e = TBL[T]; const sp = Object.entries(e.specs).map(([i, c]) => ({ s: S[i], c }));
      const w = sp.filter((x) => /[CUD]/.test(x.c)).length;
      return `<div class="answer"><div class="ai"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 10v10"/></svg></div><div style="flex:1;min-width:0">
        <h3>${tblHtml(T)} <span class="muted" style="font-weight:500;font-size:14px">${esc(e.name)}</span></h3>
        <div class="sub">사양서 <b>${sp.length}</b>곳에서 씀 · 저장 ${w} · 조회 ${sp.length - w} · 화면에 나온 컬럼 ${Object.keys(e.cols).length}개 <a onclick="go('${link('t', T)}')">테이블 전체 보기 →</a></div>
        <div class="uses">${sp.slice(0, 14).map((x) => `<span class="use" onclick="go('${link('s', x.s.key)}')">${modTag(x.s.module)}${esc(x.s.name)}${crudHtml(x.c)}</span>`).join('')}${sp.length > 14 ? `<span class="muted small">외 ${sp.length - 14}</span>` : ''}</div></div></div>`;
    }
    const tbls = Object.values(TBL).filter((e) => e.cols[T]);
    if (tbls.length) {
      const all = tbls.flatMap((e) => e.cols[T].map((u) => ({ ...u, t: e.id })));
      const bySpec = new Map(); all.forEach((u) => { const k = u.s + '|' + u.t; if (!bySpec.has(k)) bySpec.set(k, { ...u, ls: [] }); bySpec.get(k).ls.push(u.label); });
      const uses = [...bySpec.values()].map((u) => ({ ...u, label: labelsTxt(u.ls) }));
      const labels = [...new Set(uses.map((u) => u.label))];
      return `<div class="answer"><div class="ai"><svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h10M4 18h7"/></svg></div><div style="flex:1;min-width:0">
        <h3><code style="color:var(--k-col)">${esc(T)}</code> ${tbls.map((e) => tblHtml(e.id)).join(' ')}</h3>
        <div class="sub">화면 <b>${new Set(uses.map((u) => u.s)).size}</b>곳에 나옴 · 화면 라벨: ${labels.slice(0, 6).map((l) => `<b>${esc(l)}</b>`).join(', ')}</div>
        <div class="uses">${uses.slice(0, 14).map((u) => `<span class="use" onclick="go('${link('s', S[u.s].key, 'col')}')">${modTag(S[u.s].module)}${esc(S[u.s].name)} <span class="lb">· ${esc(u.label)}</span></span>`).join('')}</div></div></div>`;
    }
  }
  return '';
}

/* ---------------- 사양서 ---------------- */
function renderSpec(key, tab) {
  const s = BYKEY[key]; if (!s) return renderHome();
  const nMat = s.prompts.length + s.reviews.length + s.outputs.length + s.files.length + s.revisions.length + s.history.length;
  const tabs = [['sum', '요약'], ['col', '테이블 · 컬럼', s.columns.length || s.tables.length], ['logic', '로직', s.func.length + s.tech.length],
    ...(s.sql.length ? [['sql', '쿼리', s.sql.length]] : []), ['flow', '흐름', s.services.length || null],
    ...(s.memo ? [['memo', '결정 메모']] : []), ['test', '테스트', s.tests.length], ...(nMat ? [['mat', '자료', nMat]] : []), ['deep', '심층']];
  const par = s.parent && BYKEY[s.parent], kids = s.children.map((k) => S[k]), same = s.same.map((k) => BYKEY[k]).filter(Boolean);
  $('app').innerHTML = `
  <div class="crumb"><a onclick="go('#/')">홈</a>›<a onclick="setScope('p:${esc(s.project)}')">${esc(s.project)}</a><span>(${esc(s.workspace)})</span>›<a onclick="fMod='${esc(s.module)}';fSrc=fKind=null;go('${link('q', '*')}')">${esc(MODN[s.module] || s.module)}</a>›<span>${esc(s.name)}</span></div>
  <div class="card dhero" style="--mc:${modColor(s.module)}">
    <h1>${modTag(s.module)}${esc(s.name)}</h1>
    <div class="chips"><span class="chip id">${esc(pidTxt(s))}</span>${s.reqId ? `<span class="chip id" title="요구ID">${esc(s.reqId)}</span>` : ''}${srcChip(s)}
      ${s.base.map((b) => `<span class="chip id" title="기준 화면">기준 ${esc(b)}</span>`).join('')}
      ${s.parsed ? `<span class="chip ok" title="읽은 방식">${esc(s.adapter)}</span>` : s.adapter === '자료만' ? '<span class="chip">엑셀 없음 · 자료만</span>' : '<span class="chip warn">구조 미해석 · 본문만</span>'}
      ${s.programType ? `<span class="chip">${esc(s.programType.split('(')[0])}</span>` : ''}</div>
    <div class="ov">${sent(esc(s.overview || '요약이 없습니다 (1.개요를 읽지 못함).'))}</div>
    <div class="acts">${s.excel && !DEMO ? `<button class="btn" onclick="openExcel('${esc(s.key)}')"><svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8l8 8M16 8l-8 8"/></svg>엑셀 미리보기</button>` : ''}
      ${s.folder && !DEMO ? `<button class="btn" onclick="copyPath('${esc(s.folder)}')" title="탐색기 주소창에 붙여 넣으세요"><svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>폴더 경로 복사</button>` : ''}</div>
    <div class="kpis">
      <div class="kpi"><div class="v">${esc(s.confirmedAt || '—')}</div><div class="l">${s.source === '수기' ? '최종 이력' : '확정'}${s.version > 1 ? ` · ${s.source === '수기' ? s.revisions.length + '개 판' : s.version + '번째 판'}` : ''}</div></div>
      <div class="kpi"><div class="v">${s.tables.length}</div><div class="l">테이블</div></div>
      <div class="kpi"><div class="v">${s.columns.length}</div><div class="l">화면 컬럼</div></div>
      ${s.sql.length ? `<div class="kpi"><div class="v">${s.sql.length}</div><div class="l">쿼리</div></div>` : ''}
      <div class="kpi"><div class="v">${s.mockups.length}</div><div class="l">목업</div></div>
      <div class="kpi"><div class="v">${s.tests.length}</div><div class="l">테스트</div></div>
    </div>
  </div>
  <div class="dlay">
    <div class="card"><div style="padding:14px 14px 0"><div class="tabs">${tabs.map(([k, l, n]) => `<button class="tab ${tab === k ? 'on' : ''}" onclick="go('${link('s', s.key, k)}')">${l}${n ? `<span class="n">${n}</span>` : ''}</button>`).join('')}</div></div>
      <div class="tbody" id="tb" style="padding-top:4px"></div></div>
    <div class="side">
      <div class="card"><div class="ch">목업 <span class="muted">${s.mockups.length}개</span></div><div class="cb">
        ${s.mockups.length ? s.mockups.map((m, k) => `<div class="thumb" style="${k ? 'margin-top:8px;height:110px' : ''}" onclick="openMock('${esc(m)}')"><iframe data-ref="${esc(m)}" tabindex="-1"></iframe><span class="cap">${esc(fileName(m))}</span></div>`).join('') : '<div class="muted small">목업 없음</div>'}</div></div>
      ${par || kids.length || same.length ? `<div class="card"><div class="ch">같은 프로그램 · 팝업</div><div class="cb"><ul class="list">
        ${par ? `<li><span class="muted small">본 화면</span><a onclick="go('${link('s', par.key)}')">${esc(par.name)}</a></li>` : ''}
        ${kids.map((k) => `<li><span class="muted small">${k.name.includes('_출력물') || (!k.excel && (k.outputs || []).length) ? '출력물' : '팝업'}</span><a onclick="go('${link('s', k.key)}')">${esc(k.name.replace(s.name + '_', ''))}</a></li>`).join('')}
        ${same.map((o) => `<li><span class="muted small">${o.source} 사양서</span><a onclick="go('${link('s', o.key)}')">${esc(o.name)}</a><span class="r">${esc(o.workspace)}</span></li>`).join('')}</ul></div></div>` : ''}
      <div class="card"><div class="ch">흐름 <a class="r small" onclick="go('${link('s', s.key, 'flow')}')">크게</a></div><div class="cb flowsvg">${flowSvg(s, true)}</div></div>
      ${s.related.length ? `<div class="card"><div class="ch">연관 프로그램</div><div class="cb"><ul class="list">${s.related.map((r) => `<li style="display:block">${linkify(r.replace('연관 프로그램: ', ''))}</li>`).join('')}</ul></div></div>` : ''}
    </div>
  </div>`;
  ({ sum: tabSum, col: tabCol, logic: tabLogic, sql: tabSql, flow: tabFlow, memo: tabMemo, test: tabTest, mat: tabMat, deep: tabDeep }[tab] || tabSum)(s);
  hydrate($('app'));
}
const fileName = (ref) => String(ref).split('/').pop();
function linkify(txt) { let h = esc(txt); S.forEach((o) => { if (o.name.length > 3 && h.includes(esc(o.name))) h = h.split(esc(o.name)).join(`<a onclick="go('${link('s', o.key)}')">${esc(o.name)}</a>`); }); return h; }
function linesHtml(arr) {
  // 한 줄 안의 여러 문장은 줄을 나누고, 이어지는 줄은 원래 들여쓰기 + 머리 번호만큼 띄운다
  arr = arr.flatMap((l) => { const m = /^(\s*)((?:\d+(?:-\d+)*\.?|[·\-•※])\s+)?/.exec(l); const pad = m[1] + ' '.repeat((m[2] || '').length); return sentTxt(l).split('\n').map((x, i) => (i ? pad + x : x)); });
  return arr.map((l) => { const t = esc(l); if (/^\d+\.\s/.test(l)) return `<span class="h1">${t}</span>`; if (/^\s{3,}·/.test(l)) return `<span class="sub">${t}</span>`; return t; }).join('\n')
    .replace(/(\b[A-Z][A-Z0-9]{0,5}_[A-Z0-9_]{2,}\b)/g, (m) => (TBL[m] ? tblHtml(m) : `<code>${m}</code>`));
}
/* 쓰는 테이블 카드: 테이블마다 색 · 이름 · CRUD · 쓰임(문장마다 줄바꿈) · 이 화면에서 쓰는 컬럼(라벨 → 컬럼) */
function tableCards(s) {
  if (!s.tables.length) return `<div class="muted">${s.parsed ? '사양서의 4.기술사양 테이블 표가 비어 있습니다 (사양서에 테이블 정보가 없음).' : '없음'}</div>`;
  const tc = tblColors(s);
  return `<div class="tcards">${s.tables.map((t) => {
    // 같은 컬럼을 쓰는 칸은 한 칩으로 묶는다 (1~12월 수량 | DN_BASE_QTY)
    const grp = new Map();
    s.columns.filter((c) => c.tbl === t.id).forEach((c) => { const k = colOf(c) || '§' + c.label; if (!grp.has(k)) grp.set(k, { ...c, ls: [], descs: [] }); const g = grp.get(k); g.ls.push(c.label); if (c.desc) g.descs.push(c.label + ': ' + trim(c.desc, 80)); });
    const cols = [...grp.values()].map((g) => ({ ...g, label: labelsTxt(g.ls), desc: g.ls.length > 1 ? g.descs.slice(0, 4).join('\n') : g.desc }));
    const nSpec = TBL[t.id] ? Object.keys(TBL[t.id].specs).length : 0;
    const MAX = 24;
    return `<div class="tcard" style="--tc:${tc[t.id] || 'var(--line2)'}">
      <div class="tch"><span class="mt" onclick="go('${link('t', t.id)}')" title="누르면 테이블 보기">${esc(t.id)}</span><b>${esc(t.name || (TBL[t.id] && TBL[t.id].name) || '')}</b>${t.nameFrom ? `<span class="muted small" title="이 사양서에는 테이블 이름이 없어 「${esc(t.nameFrom)}」 사양서에 적힌 이름을 보여 줍니다">· 다른 사양서 이름</span>` : ''}${crudHtml(t.crud)}
        ${nSpec > 1 ? `<a class="r" onclick="go('${link('t', t.id)}')">사양서 ${nSpec}곳에서 씀 →</a>` : ''}</div>
      ${t.note ? `<div class="tcn">${sent(esc(t.note))}</div>` : ''}
      ${cols.length ? `<div class="tcc">${cols.slice(0, MAX).map((c) => `<span class="cc" title="${esc(c.area || '')}${c.desc ? ' — ' + esc(sentTxt(trim(c.desc, 160))) : ''}"><span>${esc(c.label || '-')}</span>${colOf(c) ? `<code>${esc(colOf(c))}</code>` : `<code class="none">${esc(noColTxt(c))}</code>`}</span>`).join('')}
        ${cols.length > MAX ? `<a class="more" onclick="colKey='${esc(s.key)}';colTf='${esc(t.id)}';colBy='table';go('${link('s', s.key, 'col')}')">+${cols.length - MAX} 더 보기</a>` : ''}</div>` : ''}
    </div>`;
  }).join('')}</div>`;
}
function tabSum(s) {
  const added = s.columns.filter((c) => c.change === '추가'), changed = s.columns.filter((c) => c.change === '변경');
  $('tb').innerHTML = `
    ${s.screenDesc ? `<div class="sec">화면 구성</div><div class="lines">${esc(s.screenDesc)}</div>` : ''}
    ${s.devStyle ? `<div class="sec">개발 방식</div><div>${esc(s.devStyle.replace('개발 방식: ', ''))}</div>` : ''}
    <div class="sec">쓰는 테이블 ${s.tables.length}</div>
    ${tableCards(s)}
    ${added.length || changed.length ? `<div class="sec">표준 대비 바꾼 것 — 추가 ${added.length} · 변경 ${changed.length}</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px">${added.map((c) => `<span class="chip add">+ ${esc(c.label)}</span>`).join('')}${changed.map((c) => `<span class="chip chg">~ ${esc(c.label)}</span>`).join('')}</div>` : ''}
    ${!s.parsed && s.fulltext ? `<div class="sec">본문 (엑셀에서 읽은 글)</div><div class="lines" style="max-height:440px;overflow:auto;font-size:12px">${esc(trim(s.fulltext, 8000))}</div>` : ''}`;
}
let colFilter = '', colArea = '전체', colBy = 'area', colTf = null, colKey = null;
function tabCol(s) {
  if (colKey !== s.key) { colKey = s.key; colArea = '전체'; colTf = null; colFilter = ''; }
  const areas = ['전체', ...new Set(s.columns.map((c) => c.area))];
  if (!areas.includes(colArea)) colArea = '전체';
  // 검색 결과에서 왔으면 그 검색어가 걸린 줄을 칠해 둔다
  const fromSearch = LAST && LAST.shown.some((x) => x.s.key === s.key) ? LAST.toks : [];
  $('tb').innerHTML = s.columns.length ? `<div class="filterline"><input id="cf" placeholder="이 사양서 안에서 거르기 (라벨 · 컬럼 · 설명)" value="${esc(colFilter)}">
      <span class="seg" title="묶는 기준"><button class="${colBy === 'area' ? 'on' : ''}" data-by="area">화면 자리별</button><button class="${colBy === 'table' ? 'on' : ''}" data-by="table">테이블별</button></span>
      ${areas.length > 2 ? `<span class="seg">${areas.map((a) => `<button class="${a === colArea ? 'on' : ''}" data-a="${esc(a)}">${esc(a)}</button>`).join('')}</span>` : ''}</div>
    ${fromSearch.length ? `<div class="muted small" style="margin:-4px 0 10px"><mark>노란 줄</mark> = 검색어 ${fromSearch.map((t) => `<b>${esc(t)}</b>`).join(' · ')} 가 걸린 컬럼</div>` : ''}
    <div id="colmap"></div>`
    : `<div class="empty">화면 컬럼을 읽지 못했습니다.</div><div class="sec">쓰는 테이블</div><div style="display:flex;gap:6px;flex-wrap:wrap">${s.tables.map((t) => tblHtml(t.id)).join('')}</div>`;
  if (!s.columns.length) return;
  const sync = (o) => { colTf = o.tf; };
  const redraw = () => { const o = { wide: true, by: colBy, tf: colTf, text: colFilter, area: colArea }; const v = mapView(s, [...fromSearch, ...(colFilter ? [colFilter] : [])], o, (o2) => { sync(o2); redraw(); }); $('colmap').innerHTML = v.html; v.bind($('colmap')); };
  $('cf').oninput = (e) => { colFilter = e.target.value; redraw(); };
  document.querySelectorAll('.seg button[data-a]').forEach((b) => (b.onclick = () => { colArea = b.dataset.a; tabCol(s); }));
  document.querySelectorAll('.seg button[data-by]').forEach((b) => (b.onclick = () => { colBy = b.dataset.by; tabCol(s); }));
  redraw();
}
function tabLogic(s) {
  $('tb').innerHTML = `<div class="sec">기능 · 업무 흐름</div><div class="lines">${linesHtml(s.func) || '<span class="muted">없음</span>'}</div>
    <div class="sec">기술 · 체크 로직</div><div class="lines">${linesHtml(s.tech) || '<span class="muted">없음</span>'}</div>
    ${s.combos.length ? `<div class="sec">콤보 · 값 출처</div><table class="t"><tr><th>콤보 서비스</th><th>쓰는 곳</th><th>설명</th></tr>${s.combos.map((c) => `<tr><td><code>${esc(c.id)}</code></td><td>${esc(c.usedBy)}</td><td class="desc">${sent(esc(c.name))}</td></tr>`).join('')}</table>` : ''}`;
}
let sqlPick = 0, sqlFind = '';
function sqlHtml(text, find) {
  let h = esc(text);
  h = h.replace(/(--[^\n]*)/g, '<span class="c">$1</span>');
  h = h.replace(/\b(SELECT|FROM|WHERE|AND|OR|INNER|LEFT|RIGHT|OUTER|JOIN|ON|GROUP BY|ORDER BY|HAVING|INSERT|INTO|VALUES|UPDATE|SET|DELETE|MERGE|UNION|ALL|CASE|WHEN|THEN|ELSE|END|AS|IN|IS|NOT|NULL|EXISTS|WITH|DISTINCT|TOP)\b/g, '<span class="k">$1</span>');
  h = h.replace(/\b([A-Z][A-Z0-9]{0,6}_[A-Z0-9_]{2,})\b/g, (m) => (TBL[m] ? `<span class="tbl" onclick="go('${link('t', m)}')">${m}</span>` : m));
  if (find) h = h.replace(new RegExp('(' + reEsc(esc(find)) + ')(?![^<]*>)', 'gi'), '<mark>$1</mark>');
  return h;
}
function tabSql(s) {
  if (!s.sql.length) { $('tb').innerHTML = '<div class="empty">이 사양서 폴더에는 쿼리 파일이 없습니다.</div>'; return; }
  if (sqlPick >= s.sql.length) sqlPick = 0;
  const groups = {}; s.sql.forEach((f, k) => (groups[f.dir || '.'] = groups[f.dir || '.'] || []).push(k));
  const used = Object.entries(s.sqlTables).sort();
  const draw = () => {
    const f = s.sql[sqlPick];
    $('sqlv').innerHTML = `<div class="sqlhead"><code>${esc(f.dir)}/${esc(f.name)}</code><span class="muted">${(f.size / 1024).toFixed(1)}KB${f.size > 30000 ? ' · 앞부분만' : ''}</span>
      <a style="margin-left:auto" onclick="navigator.clipboard.writeText(document.querySelector('pre.code').innerText);toastMsg('쿼리를 복사했습니다')">복사</a></div><pre class="code">${sqlHtml(f.text || '(빈 파일)', sqlFind)}</pre>`;
    document.querySelectorAll('.sqllist li[data-k]').forEach((li) => li.classList.toggle('on', +li.dataset.k === sqlPick));
  };
  $('tb').innerHTML = `${used.length ? `<div class="sec">쿼리에서 쓰는 테이블 ${used.length}</div><div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px">${used.map(([t, c]) => `<span>${tblHtml(t)}${crudHtml(mergeCrud('', c))}</span>`).join('')}</div>` : ''}
    <div class="filterline"><input id="sf" placeholder="쿼리 안에서 찾기 (컬럼 · 조건)" value="${esc(sqlFind)}"></div>
    <div class="sqlwrap"><ul class="sqllist">${Object.entries(groups).map(([d, ks]) => `<li class="grp">${esc(d)}</li>` + ks.map((k) => {
      const n = sqlFind ? (s.sql[k].text || '').toLowerCase().split(sqlFind.toLowerCase()).length - 1 : 0;
      return `<li data-k="${k}" title="${esc(s.sql[k].name)}">${esc(s.sql[k].name.replace(/\.sql$/i, ''))}${n ? `<em>${n}</em>` : ''}</li>`; }).join('')).join('')}</ul><div id="sqlv"></div></div>`;
  document.querySelectorAll('.sqllist li[data-k]').forEach((li) => (li.onclick = () => { sqlPick = +li.dataset.k; draw(); }));
  $('sf').oninput = (e) => {
    sqlFind = e.target.value;
    if (sqlFind && !has(s.sql[sqlPick].text, sqlFind)) { const k = s.sql.findIndex((f) => has(f.text, sqlFind)); if (k >= 0) sqlPick = k; }
    tabSql(s); const i = $('sf'); i.focus(); i.setSelectionRange(i.value.length, i.value.length);
  };
  draw();
}
window.toastMsg = toast;
function flowSvg(s, mini) {
  const svcs = s.services.filter((v) => v.use !== '기준').slice(0, mini ? 4 : 8);
  const tbs = s.tables.slice(0, mini ? 5 : 10);
  if (!svcs.length && !tbs.length) return '<div class="muted small">흐름 정보 없음</div>';
  const W = mini ? 300 : 900, rowH = mini ? 30 : 42, bw = mini ? 88 : 250, bh = mini ? 22 : 32;
  const n = Math.max(svcs.length, tbs.length, 1), H = n * rowH + 20;
  const x1 = 6, x2 = (W - bw) / 2, x3 = W - bw - 6;
  const box = (x, y, cls, t, sub) => `<g class="n ${cls}"><rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="6"/><text x="${x + 8}" y="${y + (sub && !mini ? 14 : bh / 2 + 4)}"${mini ? ' style="font-size:10.5px"' : ''}>${esc(trim(t, mini ? 10 : 34))}</text><title>${esc(t)}</title>${sub && !mini ? `<text class="sm" x="${x + 8}" y="${y + 27}">${esc(trim(sub, 40))}</text>` : ''}</g>`;
  const uiY = H / 2 - bh / 2;
  let g = box(x1, uiY, 'ui', mini ? '화면' : '화면 · ' + s.name, mini ? '' : '조회조건 · 버튼');
  const mid = svcs.length ? svcs : [{ name: '조회 · 저장', id: '' }];
  mid.forEach((v, k) => { const y = 10 + k * rowH; g += `<path d="M${x1 + bw},${uiY + bh / 2} C${x2 - 20},${uiY + bh / 2} ${x1 + bw + 20},${y + bh / 2} ${x2},${y + bh / 2}"/>` + box(x2, y, 'svc', v.name || v.id, v.id); });
  tbs.forEach((t, k) => { const y = 10 + k * rowH; mid.forEach((v, j) => { const sy = 10 + j * rowH; if (j === 0 || (v.note || '').includes(t.id)) g += `<path d="M${x2 + bw},${sy + bh / 2} C${x3 - 20},${sy + bh / 2} ${x2 + bw + 20},${y + bh / 2} ${x3},${y + bh / 2}"/>`; }); g += box(x3, y, 'tb', t.id, (t.crud ? t.crud + ' · ' : '') + t.name); });
  return `<svg viewBox="0 0 ${W} ${H}">${g}</svg>`;
}
function tabFlow(s) {
  $('tb').innerHTML = `<div class="muted small" style="margin-bottom:10px">사양서의 서비스와 테이블로 그린 흐름입니다.</div><div class="flowsvg">${flowSvg(s, false)}</div>
    ${s.services.length ? `<div class="sec">서비스</div><table class="t"><tr><th>서비스</th><th>이름</th><th>쓰임</th><th>설명</th></tr>${s.services.map((v) => `<tr><td><code>${esc(v.id)}</code></td><td>${esc(v.name)}</td><td style="white-space:nowrap">${esc(v.use)}</td><td class="desc">${sent(esc(v.note))}</td></tr>`).join('')}</table>` : ''}`;
}
function mdLite(md) {
  return md.split('\n').map((l) => { const t = esc(l);
    if (l.startsWith('### ')) return `<h3>${t.slice(4)}</h3>`; if (l.startsWith('## ')) return `<h2>${t.slice(3)}</h2>`;
    if (l.startsWith('# ') || l.startsWith('>')) return '';
    if (/^\s*- /.test(l)) return `<div style="padding-left:${l.match(/^\s*/)[0].length * 8 + 8}px">• ${t.replace(/^\s*- /, '')}</div>`;
    return t ? `<p>${t}</p>` : ''; }).join('').replace(/`([^`]+)`/g, '<code>$1</code>');
}
function tabMemo(s) { $('tb').innerHTML = s.memo ? `<div class="memo">${mdLite(s.memo)}</div>` : '<div class="empty">대화 메모 없음</div>'; }
function tabTest(s) {
  const row = (t) => (Array.isArray(t) ? t : [t.step || t.case || t.name || '', t.input || t.data || '', t.expected || t.exp || t.result || '']);
  $('tb').innerHTML = `<table class="t"><tr><th style="width:28%">상황 · 절차</th><th style="width:22%">입력</th><th>기대 결과</th></tr>${s.tests.map((t) => { const r = row(t); return `<tr><td>${sent(esc(r[0]))}</td><td>${sent(esc(r[1]))}</td><td class="desc">${sent(esc(r[2]))}</td></tr>`; }).join('') || '<tr><td colspan=3 class="muted">없음</td></tr>'}</table>`;
}
function tabMat(s) {
  const img = (f) => /\.(png|jpe?g|gif|webp)$/i.test(f.name);
  const fileLi = (f) => `<li><a onclick="openFile('${esc(f.path)}')">${esc(f.name)}</a><span class="r">${esc(f.dir || '')} · ${Math.max(1, Math.round(f.size / 1024))}KB</span></li>`;
  const txt = (t, arr) => (arr.length ? `<div class="sec">${t} ${arr.length}</div>${arr.map((f) => `<details class="txt"><summary><b>${esc(f.name)}</b> <span class="muted small">${esc(f.dir)}</span></summary><div class="lines">${esc(f.text || '')}</div></details>`).join('')}` : '');
  const GN = { oldspec: '구사양서 · 옛 판', legacy: '기존 소스', axsrc: 'AX 소스', etc: '기타' };
  const fg = {}; s.files.forEach((f) => (fg[f.group] = fg[f.group] || []).push(f));
  $('tb').innerHTML = `
    ${s.revisions.length ? `<div class="sec">사양서 판 ${s.revisions.length} · 위가 최신</div><ul class="list">${s.revisions.map((r, k) => `<li><a onclick="openExcelRef('${esc(r.path)}')">${esc(r.name)}</a><span class="r">${k ? '' : '현재 · '}${esc(r.label)}</span></li>`).join('')}</ul>` : ''}
    ${s.history.length ? `<div class="sec">변경 이력 ${s.history.length}</div><table class="t">${s.history.map((h) => `<tr><td style="width:110px;white-space:nowrap">${esc(h[0])}</td><td class="desc">${esc(h.slice(1).join(' · '))}</td></tr>`).join('')}</table>` : ''}
    ${s.outputs.length ? `<div class="sec">출력물 ${s.outputs.length}</div><div class="outs">${s.outputs.filter(img).map((f) => `<div class="thumb" style="height:150px" onclick="openImg('${esc(f.path)}')"><img data-ref="${esc(f.path)}" alt=""><span class="cap">${esc(f.name)}</span></div>`).join('')}</div><ul class="list">${s.outputs.filter((f) => !img(f)).map(fileLi).join('')}</ul>` : ''}
    ${txt('요청 글 (프롬프트)', s.prompts)}${txt('검토 · 리뷰', s.reviews)}
    ${Object.entries(fg).map(([g, a]) => `<div class="sec">${GN[g] || g} ${a.length}</div><ul class="list">${a.slice(0, 60).map(fileLi).join('')}${a.length > 60 ? `<li class="muted">… ${a.length - 60}개 더</li>` : ''}</ul>`).join('')}
    ${(s.folders || []).length ? `<div class="sec">자료를 가져온 폴더</div><ul class="list">${s.folders.map((f) => `<li>${esc(f.label)}<span class="r">${esc(f.path.split('|')[1] || '')}</span></li>`).join('')}</ul>` : ''}`;
  hydrate($('tb'));
}
function tabDeep(s) {
  const byT = {}; s.columns.forEach((c) => { if (c.tbl && c.column && c.column !== '-') (byT[c.tbl] = byT[c.tbl] || new Map()).set(c.column, c); });
  const sqlish = [...s.tech, ...s.func].filter((l) => /JOIN|WHERE|=|LIKE|SUM|GROUP|ORDER|INSERT|UPDATE|DELETE/i.test(l) && /[A-Z_]{4,}/.test(l));
  $('tb').innerHTML = `
    <div class="sec">테이블별로 이 사양서가 쓰는 컬럼</div>
    ${Object.entries(byT).map(([t, m]) => `<div style="margin-bottom:14px"><div style="margin-bottom:6px">${tblHtml(t)} <span class="muted">${esc(TBL[t]?.name || '')}</span> ${crudHtml(TBL[t]?.specs[s.i])}</div>
      <table class="t"><tr><th style="width:220px">컬럼</th><th style="width:180px">화면 라벨</th><th>자리</th></tr>${[...m.values()].map((c) => `<tr><td><code>${esc(c.column)}</code></td><td>${esc(c.label)}</td><td class="muted">${esc(c.area)}</td></tr>`).join('')}</table></div>`).join('') || '<div class="muted">컬럼 매핑 없음</div>'}
    <div class="sec">사양서에 적힌 조회 · 저장 규칙</div><div class="lines">${linesHtml(sqlish.slice(0, 40)) || '<span class="muted">없음</span>'}</div>
    ${s.layout.length ? `<div class="sec">테이블 레이아웃 (5.테이블 레이아웃)</div><div class="lines" style="font-size:12.5px">${linesHtml(s.layout.slice(0, 200))}</div>` : ''}
    ${s.sql.length ? `<div class="sec">실제 쿼리</div><a onclick="go('${link('s', s.key, 'sql')}')">쿼리 ${s.sql.length}개 보기 →</a>` : ''}`;
}

/* 한 화면이 같은 컬럼을 여러 칸에 쓰면 라벨을 모두 보인다 — 숫자만 다른 라벨은 묶는다 (1월 수량 … 12월 수량 → 1~12월 수량) */
function labelsTxt(labels) {
  const g = new Map();
  [...new Set(labels)].forEach((l) => { const m = /^(\D*?)(\d+)(.*)$/.exec(l || ''); const k = m ? m[1] + '#' + m[3] : l; if (!g.has(k)) g.set(k, { m, ls: [] }); g.get(k).ls.push(l); });
  return [...g.values()].map(({ m, ls }) => {
    if (ls.length < 3 || !m) return ls.join(', ');
    const ns = ls.map((l) => +/^\D*?(\d+)/.exec(l)[1]).sort((a, b) => a - b);
    const run = ns.every((n, i) => !i || n === ns[i - 1] + 1);
    return m[1] + (run ? `${ns[0]}~${ns[ns.length - 1]}` : ns.join('·')) + m[3];
  }).join(', ');
}
/* ---------------- 테이블 ---------------- */
function renderTable(id) {
  const t = TBL[id];
  if (!t) { $('app').innerHTML = `<div class="card empty">${esc(id)} 를 쓰는 사양서가 ${esc(scopeLabel())} 안에 없습니다.</div>`; return; }
  const sp = Object.entries(t.specs).map(([i, c]) => ({ s: S[i], c })).sort((a, b) => a.s.module.localeCompare(b.s.module) || a.s.name.localeCompare(b.s.name));
  const cols = Object.keys(t.cols).sort();
  const writers = sp.filter((x) => /[CUD]/.test(x.c)), readers = sp.filter((x) => !/[CUD]/.test(x.c));
  const li = (x) => `<li>${modTag(x.s.module)}<a onclick="go('${link('s', x.s.key, 'col')}')">${esc(x.s.name)}</a>${x.s.source === '수기' ? '<span class="chip src-m">수기</span>' : ''}<span class="r">${crudHtml(x.c)}</span></li>`;
  $('app').innerHTML = `
  <div class="crumb"><a onclick="go('#/')">홈</a>›<span>테이블</span>›<span>${esc(scopeLabel())}</span></div>
  <div class="card dhero" style="--mc:var(--k-tbl)"><h1><span class="mono">${esc(t.id)}</span> <span class="muted" style="font-size:16px;font-weight:500">${esc(t.name)}</span></h1>
    <div class="kpis"><div class="kpi"><div class="v">${sp.length}</div><div class="l">사양서</div></div><div class="kpi"><div class="v">${writers.length}</div><div class="l">저장하는 화면</div></div><div class="kpi"><div class="v">${readers.length}</div><div class="l">읽기만</div></div><div class="kpi"><div class="v">${cols.length}</div><div class="l">화면에 나온 컬럼</div></div></div></div>
  <div class="grid2"><div class="card"><div class="ch">값을 저장하는 화면 <span class="muted">C · U · D</span></div><div class="cb"><ul class="list">${writers.map(li).join('') || '<li class="muted">사양서 중에는 없음 — 표준 화면이 저장</li>'}</ul></div></div>
    <div class="card"><div class="ch">값을 보여 주는 화면 <span class="muted">R</span></div><div class="cb"><ul class="list">${readers.map(li).join('') || '<li class="muted">없음</li>'}</ul></div></div></div>
  <div class="card" style="margin-top:14px"><div class="ch">컬럼 × 화면 <span class="muted">칸 = 그 화면의 라벨 · 컬럼을 누르면 검색</span></div><div class="cb">
    ${cols.length ? `<div class="mx"><table><thead><tr><th class="c0">컬럼</th>${sp.map((x) => `<th><a onclick="go('${link('s', x.s.key, 'col')}')">${esc(x.s.name)}</a><div class="muted small" style="font-weight:400">${esc(x.s.module)} ${crudHtml(x.c)}</div></th>`).join('')}</tr></thead>
    <tbody>${cols.map((c) => `<tr><td class="c0"><a onclick="go('${link('q', c)}')">${esc(c)}</a></td>${sp.map((x) => { const us = t.cols[c].filter((z) => z.s === x.s.i); return us.length ? `<td class="on" title="${esc(us.map((u) => u.area + ' · ' + u.label).join('\n'))}">${esc(labelsTxt(us.map((u) => u.label)))}${us.length > 1 ? ` <span class="muted small">(${us.length}칸)</span>` : ''}</td>` : '<td></td>'; }).join('')}</tr>`).join('')}</tbody></table></div>`
    : '<div class="muted">화면 컬럼에 직접 매핑된 컬럼이 없습니다 (조인 · 조건 · 쿼리에만 쓰임).</div>'}</div></div>`;
}

/* ---------------- 폴더 · 설정 ---------------- */
async function renderSettings() {
  const rows = [];
  for (const r of SF.roots) rows.push({ r, ok: await SF.perm(r.handle, false) });
  const cnt = {}; S.forEach((s) => { const rid = (s.folder || '').split('|')[0]; cnt[rid] = (cnt[rid] || 0) + 1; });
  $('app').innerHTML = `
  <div class="crumb"><a onclick="go('#/')">홈</a>›<span>폴더 · 설정</span></div>
  <div class="card dhero"><h1>연결한 사양서 폴더</h1>
    <div class="ov">폴더는 이 브라우저만 읽습니다. 다른 사람 PC에서는 그 사람이 자기 폴더를 따로 연결합니다. 위치가 사람마다 달라도 됩니다 — 폴더 안 모양(작업공간 · 사양서 폴더)으로 찾습니다.</div>
    <div class="acts">${SF.supported ? '<button class="btn pri" id="addRoot">+ 폴더 연결</button>' : ''}<button class="btn" id="syncNow">지금 동기화</button></div></div>
  <div style="display:flex;flex-direction:column;gap:10px;margin-top:14px">
    ${rows.map(({ r, ok }) => `<div class="card root"><div class="fi"><svg viewBox="0 0 24 24"><path d="M3 7h6l2 2h10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg></div>
      <div><div class="nm">${esc(r.name)} <span class="chip ${ok ? 'ok' : 'warn'}">${ok ? '읽기 허용됨' : '다시 허용 필요'}</span> <span class="muted small">사양서 ${cnt[r.id] || 0}건</span></div>
        <div class="fields"><label>프로젝트 이름 (작업공간 정보가 없는 폴더에 씀)<input data-id="${r.id}" data-k="project" value="${esc(r.project)}" placeholder="예) 고객사 이름"></label>
          <label>이 폴더의 PC 경로 (선택 · 경로 복사용)<input data-id="${r.id}" data-k="absPath" value="${esc(r.absPath)}" placeholder="예) D:\\프로젝트"></label></div></div>
      <div style="display:flex;gap:6px">${ok ? '' : `<button class="btn" data-grant="${r.id}">허용</button>`}<button class="btn ghost" data-rm="${r.id}">연결 끊기</button></div></div>`).join('') || '<div class="card empty">연결한 폴더가 없습니다.</div>'}
  </div>
  ${IDX ? `<div class="card" style="margin-top:14px"><div class="ch">읽기 품질 리포트 <span class="muted">${(IDX.warnings || []).length}건 · 마지막 동기화 ${esc(fmtTime(IDX.builtAt))}</span></div><div class="cb"><ul class="list">${(IDX.warnings || []).map((w) => `<li>${esc(w)}</li>`).join('') || '<li class="muted">문제 없음</li>'}</ul></div></div>` : ''}
  <div class="card" style="margin-top:14px"><div class="ch">이 브라우저의 색인 지우기</div><div class="cb"><span class="muted small">만든 색인과 폴더 연결을 모두 지웁니다. 사양서 파일은 건드리지 않습니다.</span> <button class="btn ghost" id="wipe" style="margin-left:8px">모두 지우기</button></div></div>`;
  if ($('addRoot')) $('addRoot').onclick = addRootFlow;
  $('syncNow').onclick = () => runSync(true);
  document.querySelectorAll('.root input').forEach((i) => (i.onchange = async () => { const r = SF.roots.find((x) => x.id === i.dataset.id); r[i.dataset.k] = i.value.trim(); await SF.saveRoots(); toast('저장했습니다 — 프로젝트 이름은 다음 동기화부터 반영됩니다'); }));
  document.querySelectorAll('[data-grant]').forEach((b) => (b.onclick = async () => { const r = SF.roots.find((x) => x.id === b.dataset.grant); if (await SF.perm(r.handle, true)) { showBanner(); renderSettings(); } }));
  document.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = async () => { if (!confirm('이 폴더 연결을 끊을까요? (파일은 그대로입니다)')) return; await SF.removeRoot(b.dataset.rm); renderSettings(); }));
  $('wipe').onclick = async () => { if (!confirm('이 브라우저의 색인과 폴더 연결을 모두 지울까요?')) return; await SF.del('index'); await SF.del('xcache'); SF.roots = []; await SF.saveRoots(); IDX = null; S = []; PROJ = {}; TBL = {}; updateSyncBtn(); go('#/'); };
}
const fmtTime = (iso) => { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? iso : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

/* ---------------- 동기화 ---------------- */
let syncing = false;
async function addRootFlow() {
  try { await SF.addRoot(); } catch (e) { if (e.name !== 'AbortError') toast('폴더를 열지 못했습니다: ' + e.message); return; }
  DEMO = false; await runSync(true);
}
async function runSync(ask) {
  if (syncing || !SF.roots.length) { if (!SF.roots.length) toast('먼저 사양서 폴더를 연결하세요'); return; }
  if (ask) for (const r of SF.roots) await SF.perm(r.handle, true);
  syncing = true; DEMO = false; updateSyncBtn('읽는 중…');
  const bar = document.createElement('div'); bar.className = 'progress'; bar.style.width = '5%'; document.body.appendChild(bar);
  let ticks = 0;
  try {
    const idx = await SF.sync((msg, n) => { ticks++; bar.style.width = Math.min(92, 5 + ticks * 0.6) + '%'; $('syncTxt').textContent = `읽는 중 · ${n}건`; $('syncBtn').title = msg; });
    prepare(idx); showBanner();
    toast(`사양서 ${idx.specs.length}건 색인 완료${idx.parsedNow ? ` · 엑셀 ${idx.parsedNow}개 새로 읽음` : ' · 바뀐 엑셀 없음'}`);
    const [r] = route(); if (r !== 'q') render(); else render();
  } catch (e) { console.error(e); toast('동기화 실패: ' + (e.message || e)); }
  finally { syncing = false; bar.style.width = '100%'; setTimeout(() => bar.remove(), 400); updateSyncBtn(); }
}
function updateSyncBtn(txt) {
  const b = $('syncBtn');
  b.classList.toggle('busy', !!txt); b.classList.toggle('off', !IDX || DEMO);
  $('syncTxt').textContent = txt || (DEMO ? '예시 데이터' : IDX ? `${S.length}건 · ${fmtTime(IDX.builtAt).slice(5)}` : '폴더 연결');
  b.title = IDX && !DEMO ? `마지막 동기화 ${fmtTime(IDX.builtAt)} — 누르면 다시 읽습니다` : '';
}
$('syncBtn').onclick = () => (SF.roots.length ? runSync(true) : SF.supported ? addRootFlow() : toast('Chrome 또는 Edge 에서 폴더를 연결할 수 있습니다'));
async function showBanner() {
  updateSyncBtn();
  const need = [];
  for (const r of SF.roots) if (!(await SF.perm(r.handle, false))) need.push(r);
  $('banner').innerHTML = DEMO ? `<div class="bn" style="background:var(--brand-soft);color:var(--brand-ink)">예시 데이터로 보는 중입니다. 내 사양서를 보려면 폴더를 연결하세요.<button class="btn pri" onclick="document.getElementById('syncBtn').click()">폴더 연결</button></div>`
    : need.length ? `<div class="bn">브라우저를 다시 열어 폴더 읽기 허용이 풀렸습니다. 검색은 되지만 목업 · 엑셀 미리보기와 새 사양서 반영을 하려면 허용해 주세요.<button class="btn" id="regrant">폴더 다시 허용</button></div>` : '';
  if ($('regrant')) $('regrant').onclick = () => runSync(true);
}

/* ---------------- 미리보기 (목업 · 그림 · 엑셀) ---------------- */
async function hydrate(root) {
  if (DEMO) { root.querySelectorAll('[data-ref]').forEach((el) => { const p = el.closest('.thumb,.mini-mock'); if (p) p.innerHTML = '<div class="ph">예시 — 미리보기 없음</div>'; }); return; }
  for (const el of root.querySelectorAll('iframe[data-ref],img[data-ref]')) {
    try { el.src = await SF.blobUrl(el.dataset.ref, el.tagName === 'IFRAME' ? 'text/html;charset=utf-8' : undefined); }
    catch (e) { const p = el.closest('.thumb,.mini-mock'); if (p) { el.remove(); p.insertAdjacentHTML('afterbegin', '<div class="ph">폴더 허용이 필요합니다</div>'); } }
  }
}
function openModal(title, html, tools) { $('mTitle').textContent = title; $('mBody').innerHTML = html; $('mTools').innerHTML = tools || ''; $('modal').classList.add('on'); }
function closeModal() { $('modal').classList.remove('on'); $('mBody').innerHTML = ''; }
window.closeModal = closeModal;
window.openMock = async (ref) => { if (DEMO) return; try { const u = await SF.blobUrl(ref, 'text/html;charset=utf-8'); openModal(fileName(ref), `<iframe src="${u}"></iframe>`); } catch (e) { toast(e.message); } };
window.openImg = async (ref) => { try { const u = await SF.blobUrl(ref); openModal(fileName(ref), `<img src="${u}">`); } catch (e) { toast(e.message); } };
window.openFile = async (ref) => {
  const n = fileName(ref).toLowerCase();
  if (/\.(png|jpe?g|gif|webp)$/.test(n)) return openImg(ref);
  if (/\.xlsx$/.test(n)) return openExcelRef(ref);
  if (/\.html?$/.test(n)) return openMock(ref);
  try {
    const f = await (await SF.fileHandle(ref)).getFile();
    if (/\.pdf$/.test(n)) { const u = await SF.blobUrl(ref, 'application/pdf'); return openModal(fileName(ref), `<iframe src="${u}"></iframe>`); }
    if (f.size < 2e6 && /\.(sql|txt|md|json|xml|cs|js|vb|asp|aspx|config|csv|log)$/.test(n)) return openModal(fileName(ref), `<pre class="code" style="border-radius:0;max-height:none;min-height:100%">${esc(SF.decode(await f.arrayBuffer()))}</pre>`);
    copyPath(ref);
  } catch (e) { toast(e.message); }
};
window.openExcel = (key) => { const s = BYKEY[key]; if (s && s.excel) openExcelRef(s.excel); };
window.openExcelRef = async (ref) => {
  try {
    openModal(fileName(ref), '<div class="empty">엑셀을 읽는 중…</div>');
    const f = await (await SF.fileHandle(ref)).getFile();
    const wb = SF.readBook(await f.arrayBuffer());
    const show = (n) => {
      $('mBody').innerHTML = `<div class="xltabs">${wb.SheetNames.map((x) => `<button class="${x === n ? 'on' : ''}" data-n="${esc(x)}">${esc(x)}</button>`).join('')}</div><div class="xl">${XLSX.utils.sheet_to_html(wb.Sheets[n], { header: '', footer: '' })}</div>`;
      $('mBody').querySelectorAll('.xltabs button').forEach((b) => (b.onclick = () => show(b.dataset.n)));
    };
    $('mTools').innerHTML = `<button class="btn" id="dlx">파일 받기</button><button class="btn" onclick="copyPath('${esc(ref)}')">경로 복사</button>`;
    $('dlx').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name; a.click(); };
    show(wb.SheetNames.find((n) => /^\s*2[.\s]/.test(n)) || wb.SheetNames[0]);
  } catch (e) { closeModal(); toast(e.message || String(e)); }
};
window.copyPath = (ref) => {
  const p = SF.fullPath(ref);
  try { navigator.clipboard.writeText(p); } catch (e) {}
  const root = SF.roots.find((r) => r.id === String(ref).split('|')[0]);
  toast(root && root.absPath ? '경로를 복사했습니다 — 탐색기 주소창에 붙여 넣으세요' : '폴더 안 경로를 복사했습니다 (폴더 설정에 PC 경로를 적으면 전체 경로가 복사됩니다)');
};

SF._app = { load: (idx) => { DEMO = false; prepare(idx); showBanner(); render(); } }; // 시험용

/* ---------------- 시작 ---------------- */
$('themeBtn').onclick = () => {
  const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const nx = cur === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = nx; ls.set('sf.theme', nx);
};
/* 보기 설정 — 글자 크기(--fz)와 화면 배율(--zoom). 이 브라우저에 기억한다 */
const VIEW = { fz: { min: 0.85, max: 1.5, step: 0.05, def: 1, lab: '글자 크기', sub: '글자만 키움 · 배치 그대로' }, zoom: { min: 0.7, max: 1.6, step: 0.1, def: 1, lab: '화면 배율', sub: '여백 · 도형까지 함께' } };
function viewGet(k) { const v = parseFloat(ls.get('sf.' + k)); return isNaN(v) ? VIEW[k].def : v; }
function viewSet(k, v) {
  const o = VIEW[k]; v = Math.round(Math.min(o.max, Math.max(o.min, v)) * 100) / 100;
  document.documentElement.style.setProperty('--' + k, v); ls.set('sf.' + k, v); drawView();
}
function drawView() {
  $('dpop').innerHTML = Object.entries(VIEW).map(([k, o]) => `<div class="r"><b>${o.lab}<small>${o.sub}</small></b>
    <span class="st"><button data-k="${k}" data-d="-1" title="작게">−</button><span>${Math.round(viewGet(k) * 100)}%</span><button data-k="${k}" data-d="1" title="크게">+</button></span></div>`).join('')
    + `<div class="ft"><span>이 브라우저에 기억합니다</span><a id="viewReset">기본값</a></div>`;
  $('dpop').querySelectorAll('.st button').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); const k = b.dataset.k; viewSet(k, viewGet(k) + VIEW[k].step * +b.dataset.d); }));
  $('viewReset').onclick = (e) => { e.stopPropagation(); viewSet('fz', 1); viewSet('zoom', 1); };
}
$('viewBtn').onclick = (e) => { e.stopPropagation(); drawView(); $('dpop').classList.toggle('on'); };
$('dpop').onclick = (e) => e.stopPropagation();
document.addEventListener('click', () => $('dpop').classList.remove('on'));
(async function boot() {
  await SF.loadRoots();
  const idx = await SF.get('index');
  if (idx && idx.schema === SF.SCHEMA && SF.roots.length) prepare(idx);
  await showBanner();
  render();
  // 열 때마다 조용히 다시 읽기 (허용이 살아 있을 때만 · 바뀐 엑셀만 새로 읽음)
  if (SF.roots.length) {
    let all = true; for (const r of SF.roots) if (!(await SF.perm(r.handle, false))) all = false;
    if (all) runSync(false);
  }
})();
})();
