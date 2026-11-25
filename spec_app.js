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
let IDX = null, S = [], L = [], BYKEY = {}, TBL = {}, OLDT = {}, PROJ = {}, DEMO = false; // L = 최신 판(대표)만
// 보일 이름: { '프로젝트': '보일 이름', '프로젝트/작업공간': '보일 이름' } — 이 브라우저에만
let PNAME = {}; try { PNAME = JSON.parse(ls.get('sf.pname') || '{}') || {}; } catch (e) { PNAME = {}; }
const pName = (p) => (!DEMO && PNAME[p]) || p;
const wName = (p, w) => { if (p && typeof p === 'object') { w = p.workspace; p = p.project; } return (!DEMO && PNAME[p + '/' + w]) || w; };
let scope = ls.get('sf.scope') || '';
const KIND = { name: '화면 이름', col: '컬럼', tbl: '테이블', sql: '쿼리', logic: '로직', svc: '서비스', cmb: '콤보', ov: '요약', memo: '결정 메모', req: '요청 글', rev: '검토', hist: '변경 이력', full: '본문', old: '옛 판에만' };
const KC = { col: 'var(--k-col)', tbl: 'var(--k-tbl)', sql: 'var(--k-sql)', logic: 'var(--k-logic)', svc: 'var(--k-svc)', cmb: 'var(--k-cmb)', old: 'var(--warn)' };
const kindTag = (k) => `<span class="kind" style="--kc:${KC[k] || 'var(--k-etc)'}">${KIND[k]}</span>`;
const MODN = { APPR: '결재', BC: '기준정보', BA: '기준정보', IM: '재고', MM: '구매', PP: '생산', SD: '영업', QM: '품질', FI: '재무', CO: '원가', HR: '인사', AC: '회계' };
// 모듈 배지 색 — 흰 글자와 대비 4.5:1 이상 (밝게 · 어둡게 둘 다)
const MODC = { SD: '#1d4ed8', MM: '#047857', IM: '#b45309', PP: '#be123c', BC: '#475569', APPR: '#6d28d9', QM: '#0e7490', FI: '#4338ca', CO: '#a21caf', HR: '#c2410c' };
function modColor(m) { if (MODC[m]) return MODC[m]; let h = 0; for (const c of m || '') h = (h * 31 + c.charCodeAt(0)) % 360; return `hsl(${h} 60% 34%)`; }
const modTag = (m) => `<span class="mod" style="--mc:${modColor(m)}" title="${esc(MODN[m] || m)}">${esc(m || '?')}</span>`;
const crudHtml = (c) => `<span class="crud">${'CRUD'.split('').map((x) => `<i class="${x} ${c && c.includes(x) ? 'on' : ''}">${x}</i>`).join('')}</span>`;
const tblHtml = (t) => `<span class="tbl" onclick="event.stopPropagation();go('${link('t', t)}')">${esc(t)}</span>`;
const srcChip = (s) => s.source === '수기' ? '<span class="chip src-m" title="도구 밖에서 만든 사양서">수기</span>' : '<span class="chip src-t" title="AX사양서도구로 만든 사양서">도구</span>';
const pidTxt = (s) => (s.programId === '미정' || !s.programId ? 'ID 미정' : s.programId);
/* 판 이름: 1 → 초판 · 2 → 2판 … (0 = 아직 모름 — 새 판 규칙으로 동기화하기 전 색인) */
const revName = (n) => (!n ? '' : +n === 1 ? '초판' : n + '판');
const dateTxt = (s) => [s.confirmedAt || '날짜 없음', revName(s.rev)].filter(Boolean).join(' · ');
const revTag = (s) => (s.rev ? `<span class="chip rev${s.rev > 1 ? ' up' : ''}" title="사양서 판 — 위가 최신">${revName(s.rev)}</span>` : '');
function mergeCrud(a, b) { const set = new Set(((a || '') + (b || '')).replace(/[^CRUD]/g, '').split('')); return 'CRUD'.split('').filter((x) => set.has(x)).join(''); }

function prepare(index) {
  IDX = index; S = index.specs || [];
  S.forEach((s, i) => {
    s.i = i;
    ['columns', 'tables', 'mockups', 'sql', 'outputs', 'prompts', 'reviews', 'files', 'revisions', 'history', 'layout', 'same', 'services', 'combos', 'func', 'tech', 'tests', 'base', 'related', 'olds'].forEach((k) => (s[k] = s[k] || []));
    s.source = s.source || '도구'; s.workspace = s.workspace || ''; s.module = s.module || '?';
    // 판 번호: 새 색인은 rev 를 담는다. 옛 색인의 도구 사양서 version 은 파일 번호(_n)라 판 수가 아니다 → 모름(0)
    if (!s.rev) s.rev = s.source === '수기' ? s.revisions.length || 1 : DEMO ? s.version || 1 : 0;
    s.revisions.forEach((r, k) => { if (!r.no) r.no = s.revisions.length - k; });
  });
  BYKEY = {}; S.forEach((s) => (BYKEY[s.key] = s));
  // 같은 프로그램(프로젝트 · 모듈 · 이름이 같은 사양서 — 다른 폴더의 사본 · 옛 판)은 하나로 묶고 최신 판 하나를 대표로 보인다
  const newer = (a, b) => (b.confirmedAt || '').localeCompare(a.confirmedAt || '') || (b.rev || 0) - (a.rev || 0)
    || (b.parsed ? 1 : 0) - (a.parsed ? 1 : 0) || (b.mtime || 0) - (a.mtime || 0) || b.workspace.localeCompare(a.workspace) || a.key.localeCompare(b.key);
  const G = new Map();
  S.forEach((s) => { const k = s.project + '\u0001' + s.module + '\u0001' + s.name.replace(/\s/g, ''); if (!G.has(k)) G.set(k, []); G.get(k).push(s); });
  G.forEach((list) => {
    const sorted = [...list].sort(newer), rep = sorted[0];
    list.forEach((s) => {
      s.latest = rep.key; s.isLatest = s === rep; s.copies = sorted.filter((o) => o !== s).map((o) => o.key);
      // old = 대표보다 옛 판 · same = 같은 판이 다른 폴더에도 있음(대표가 아닌 사본)
      s.stale = s === rep ? '' : (rep.confirmedAt || '') > (s.confirmedAt || '') || ((rep.confirmedAt || '') === (s.confirmedAt || '') && (rep.rev || 0) > (s.rev || 0)) ? 'old' : 'same';
    });
  });
  L = S.filter((s) => s.isLatest);
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
  PROJ = {}; // 개수는 최신 판만 센다 (옛 판 · 사본만 있는 작업공간도 범위로 고를 수 있게 0 으로 둔다)
  S.forEach((s) => { const p = (PROJ[s.project] = PROJ[s.project] || {}); p[s.workspace] = (p[s.workspace] || 0) + (s.isLatest ? 1 : 0); });
  if (!scopeValid(scope)) scope = '';
  buildRelations();
  rebuild();
}

/* ---------------- 연관 프로그램 ----------------
 * 사양서 글(요약 · 로직 · 컬럼 설명 · 서비스 · 메모 · 연관 프로그램 · 이력 · 요청 글)에 다른 사양서의
 * 화면 이름 · 프로그램ID · 요구ID 가 나오면 연관으로 본다. 그 줄의 말로 어떤 연관인지 가른다.
 * 같은 프로젝트 안에서만 · 대상은 최신 판(대표) · 자기 자신 · 같은 프로그램 사본 · 본 화면 ↔ 팝업은 뺀다(따로 보임). */
const RTYPES = [
  ['재사용', /재사용|재활용|공통\s*(?:으로)?\s*(?:사용|활용)|그대로\s*(?:사용|씀|쓴)/],
  ['기준', /기준\s*화면|기반|복사|본떠|베이스|기준으로/],
  ['참조', /참조/],
  ['참고', /참고|같은\s*방식|[와과]\s*같|같음|동일|처럼/],
  ['호출', /호출|팝업|열기|열어|열림|열린|엽니다|연다|띄우|띄움|이동|링크|누르면|클릭|더블/],
  ['연계', /연동|연계|전달|넘겨|넘김|넘어|가져와|가져온|받아\s*온|이어/],
];
const RORDER = ['재사용', '기준', '참조', '참고', '호출', '연계', '같은 기준 화면', '연관', '언급'];
const RCOL = { 재사용: 'var(--ok)', 기준: 'var(--brand)', 참조: 'var(--k-svc)', 참고: 'var(--k-cmb)', 호출: 'var(--k-col)', 연계: 'var(--k-tbl)', '같은 기준 화면': 'var(--k-logic)', 연관: 'var(--k-sql)', 언급: 'var(--k-etc)' };
const relTag = (t) => `<span class="rt" style="--rc:${RCOL[t] || 'var(--k-etc)'}">${esc(t)}</span>`;
const WORDCH = /[0-9A-Za-z_가-힣]/;
const PARTICLE = /^(?:에서|에게|에는|에도|에|의|을|를|과|와|으로|로|은|는|이|가|도|만|화면|팝업|프로그램|사양서)/;
function relSources(s) {
  const out = [];
  const put = (loc, t) => { t = String(t ?? '').trim(); if (t) out.push([loc, t.length > 700 ? t.slice(0, 700) : t]); };
  put('요약', s.overview); put('화면 구성', s.screenDesc);
  s.func.forEach((l) => put('기능 로직', l)); s.tech.forEach((l) => put('기술 로직', l));
  s.columns.forEach((c) => put('화면 컬럼', [c.label, c.desc, c.source].filter(Boolean).join(' — ')));
  s.services.forEach((v) => put('서비스', [v.id, v.name, v.note].filter(Boolean).join(' '))); s.combos.forEach((v) => put('콤보', [v.usedBy, v.name].filter(Boolean).join(' ')));
  s.tables.forEach((t) => put('테이블 쓰임', t.note));
  (s.memo || '').split('\n').forEach((l) => put('결정 메모', l));
  s.related.forEach((l) => put('연관 프로그램', l));
  s.history.forEach((h) => put('변경 이력', [].concat(h).join(' · ')));
  s.prompts.forEach((f) => (f.text || '').split('\n').forEach((l) => put('요청 글', l)));
  return out;
}
function buildRelations() {
  S.forEach((s) => { s.relOut = []; s.relIn = []; });
  const byProj = {}; L.forEach((s) => (byProj[s.project] = byProj[s.project] || []).push(s));
  Object.entries(byProj).forEach(([p, targets]) => {
    // 찾을 말 → 대상 사양서들. 말 종류: n = 이름 그대로(…(S) 포함) · b = (S) 뗀 이름 · i = 프로그램ID · 요구ID
    const terms = new Map();
    const addT = (w, kind, t) => { if (!w) return; if (!terms.has(w)) terms.set(w, { kind, ts: new Set() }); terms.get(w).ts.add(t); };
    targets.forEach((t) => {
      if (t.name.length >= 4) addT(t.name, 'n', t);
      const bare = t.name.replace(/\s*\(S\)$/, '');
      if (bare !== t.name && bare.length >= 4) addT(bare, 'b', t);
      if (t.programId && t.programId !== '미정' && /^[A-Z][A-Z0-9]{5,}$/.test(t.programId)) addT(t.programId, 'i', t);
      const rq = /^[A-Z]{2}\d{3}$/.test(t.reqId || '') ? t.reqId : '';
      if (rq) addT(rq, 'i', t);
    });
    if (!terms.size) return;
    const re = new RegExp([...terms.keys()].sort((a, b) => b.length - a.length).map(reEsc).join('|'), 'g');
    const progOf = (x) => (x && BYKEY[x] ? BYKEY[x].latest : null);
    S.filter((s) => s.project === p).forEach((s) => {
      const me = s.latest, par = progOf(s.parent);
      const kids = new Set(S.filter((o) => o.parent && BYKEY[o.parent] && BYKEY[o.parent].latest === me).map((o) => o.latest));
      const found = new Map(); // 대상 key → { types:Set, ev:[] }
      const hit = (t, type, loc, line, term) => {
        if (t.key === me || t.key === par || kids.has(t.key)) return;
        if (!found.has(t.key)) found.set(t.key, { key: t.key, types: new Set(), ev: [] });
        const f = found.get(t.key); f.types.add(type);
        if (f.ev.length < 12 && !f.ev.some((e) => e.line === line)) f.ev.push({ loc, line, term, type });
      };
      relSources(s).forEach(([loc, line]) => {
        for (const m of line.matchAll(re)) {
          const w = m[0], tm = terms.get(w), i = m.index, prev = line[i - 1] || '', next = line.slice(i + w.length);
          if (prev && WORDCH.test(prev)) continue; // 앞 글자가 붙어 있으면 다른 말의 일부
          if (tm.kind === 'i' && next && /^[0-9A-Za-z]/.test(next)) continue;
          if (tm.kind === 'b' && next && WORDCH.test(next[0]) && !PARTICLE.test(next)) continue;
          // (S) 를 뗀 이름이 '표준 …' 이나 '이름(다른 ID)' 꼴이면 표준 화면을 말한 것 — 사이트 사양서가 아니다
          if (tm.kind === 'b' && (/^\s*\((?!S\))/.test(next) || /표준\s*['"‘“\[(]?\s*$/.test(line.slice(Math.max(0, i - 8), i)))) continue;
          // 연관 종류는 그 이름이 나온 문장(앞뒤 한 문장 · 길면 앞 40자 ~ 뒤 50자)의 말로 가른다
          const a = Math.max(line.lastIndexOf('. ', i), line.lastIndexOf('\n', i), line.lastIndexOf(' — ', i), i - 40);
          const z0 = [line.indexOf('. ', i + w.length), line.indexOf('\n', i + w.length), line.indexOf(' — ', i + w.length)].filter((x) => x >= 0);
          const z = Math.min(z0.length ? Math.min(...z0) : line.length, i + w.length + 50);
          const around = line.slice(Math.max(0, a), z).replace(w, ' ');
          const type = (RTYPES.find(([, rx]) => rx.test(around)) || [loc === '연관 프로그램' ? '연관' : '언급'])[0];
          // 이름이 같은 사양서가 여러 모듈에 있으면 같은 모듈 쪽으로 본다
          const ts = [...tm.ts], same = ts.filter((t) => t.module === s.module);
          (same.length ? same : ts).forEach((t) => hit(t, type, loc, line, w));
        }
      });
      // 기준 화면 ID 가 다른 사양서의 프로그램ID 이면 '기준'
      s.base.forEach((b) => targets.forEach((t) => { if (t.programId === b) hit(t, '기준', '기준 화면', '기준 화면 ' + b, b); }));
      s.relOut = [...found.values()].map((f) => ({ key: f.key, types: [...f.types], ev: f.ev }));
    });
    // 들어오는 연관: 최신 판이 말한 것만 (옛 판 · 사본이 말한 것은 빼서 겹치지 않게)
    targets.forEach((s) => s.relOut.forEach((r) => { const t = BYKEY[r.key]; if (t) t.relIn.push({ key: s.key, types: r.types, ev: r.ev }); }));
    // 같은 기준 화면을 쓰는 사양서
    const byBase = {}; targets.forEach((s) => s.base.forEach((b) => (byBase[b] = byBase[b] || []).push(s)));
    targets.forEach((s) => { s.sameBase = []; s.base.forEach((b) => byBase[b].forEach((o) => { if (o !== s && !s.sameBase.some((x) => x.key === o.key)) s.sameBase.push({ key: o.key, base: b }); })); });
  });
  S.forEach((s) => { if (!s.sameBase) s.sameBase = []; });
}
/* 한 사양서의 연관 목록: 대상마다 { t, types, out:[근거], in:[근거], base } — 옛 판 · 사본은 대표의 들어오는 연관을 함께 본다 */
function relList(s) {
  const rep = BYKEY[s.latest] || s, m = new Map();
  const get = (k) => { if (!m.has(k)) m.set(k, { t: BYKEY[k], types: new Set(), out: [], in: [], base: '' }); return m.get(k); };
  s.relOut.forEach((r) => { const e = get(r.key); r.types.forEach((x) => e.types.add(x)); e.out.push(...r.ev); });
  rep.relIn.forEach((r) => { if (r.key === s.key) return; const e = get(r.key); r.types.forEach((x) => e.types.add(x)); e.in.push(...r.ev); });
  (rep.sameBase || []).forEach((r) => { if (r.key === s.key) return; const e = get(r.key); e.types.add('같은 기준 화면'); e.base = r.base; });
  const rank = (e) => Math.min(...[...e.types].map((x) => RORDER.indexOf(x)));
  return [...m.values()].filter((e) => e.t).map((e) => ({ ...e, types: RORDER.filter((x) => e.types.has(x)) }))
    .sort((a, b) => rank(a) - rank(b) || (b.out.length + b.in.length) - (a.out.length + a.in.length) || a.t.name.localeCompare(b.t.name));
}
function scopeValid(sc) { if (!sc) return true; const [k, v] = [sc[0], sc.slice(2)]; if (k === 'p') return !!PROJ[v]; const [p, w] = v.split('/'); return !!(PROJ[p] && PROJ[p][w]); }
function inScope(s, sc = scope) { if (!sc) return true; const v = sc.slice(2); return sc[0] === 'p' ? s.project === v : s.project + '/' + s.workspace === v; }
function scopeLabel(sc = scope) {
  if (!sc) return '전체 프로젝트';
  const v = sc.slice(2); if (sc[0] === 'p') return pName(v);
  const i = v.indexOf('/'); return pName(v.slice(0, i)) + ' › ' + wName(v.slice(0, i), v.slice(i + 1));
}
function rebuild() {
  // 테이블 색인은 최신 판만 센다. 옛 판 · 사본에만 나오는 테이블은 OLDT 에 따로 둔다
  TBL = {}; OLDT = {};
  const add = (id, name, si, crud) => { const e = TBL[id] || (TBL[id] = { id, name: '', specs: {}, cols: {} }); if (!e.name && name) e.name = name; e.specs[si] = mergeCrud(e.specs[si], crud); return e; };
  // OLDT[id] = [{ i: 사양서, no: 옛 판 번호(0 = 최신이 아닌 다른 폴더 사본) }]
  S.filter((s) => inScope(s)).forEach((s) => {
    if (!s.isLatest) new Set([...s.tables.map((t) => t.id), ...s.columns.map((c) => c.tbl), ...Object.keys(s.sqlTables)].filter(Boolean)).forEach((id) => (OLDT[id] = OLDT[id] || []).push({ i: s.i, no: 0 }));
    else s.olds.forEach((o) => new Set((o.lines || []).filter((x) => x[0] === 'tbl').map((x) => x[1].split(/\s/)[0].toUpperCase())).forEach((id) => (OLDT[id] = OLDT[id] || []).push({ i: s.i, no: o.no })));
  });
  L.filter((s) => inScope(s)).forEach((s) => {
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
  let o = `<option value="">전체 프로젝트 (${L.length})</option>`;
  ps.forEach((p) => {
    const ws = PROJ[p]; const n = Object.values(ws).reduce((a, b) => a + b, 0);
    o += `<option value="p:${esc(p)}">${esc(pName(p))} (${n})</option>`;
    if (Object.keys(ws).length > 1) Object.keys(ws).sort().forEach((w) => (o += `<option value="w:${esc(p + '/' + w)}">　└ ${esc(wName(p, w))} (${ws[w]})</option>`));
  });
  if (!DEMO) o += `<option value="__edit">✎ 이름 바꾸기…</option>`;
  return `<select class="scope" id="${id}" title="찾을 범위">${o}</select>`;
}
function bindScope(id) {
  const el = $(id); if (!el) return; el.value = scope;
  el.onchange = () => { if (el.value === '__edit') { el.value = scope; openNames(); return; } setScope(el.value); };
}

/* 콤보 · 화면에 보일 프로젝트 · 작업공간 이름 — 이 브라우저에만 저장 · 폴더 · 색인은 그대로(원래 이름으로 묶고 찾음) */
function openNames() {
  const ps = Object.keys(PROJ).sort();
  if (!ps.length) { toast('먼저 사양서 폴더를 연결하세요'); return; }
  const row = (k, orig, cur, sub) => `<div class="nmrow${sub ? ' sub' : ''}"><span class="orig" title="원래 이름 (폴더 · 작업공간 정보)">${sub ? '└ ' : ''}${esc(orig)}</span><input data-nk="${esc(k)}" value="${esc(PNAME[k] || '')}" placeholder="${esc(orig)}" maxlength="60"></div>`;
  let h = `<div class="muted small" style="margin-bottom:10px">콤보와 화면에 보일 이름만 바꿉니다. 비우면 원래 이름으로 돌아갑니다. 이 브라우저에만 저장되고 폴더 · 사양서 · 색인은 그대로입니다.</div><div class="nmlist">`;
  ps.forEach((p) => {
    h += row(p, p, PNAME[p], false);
    Object.keys(PROJ[p]).sort().forEach((w) => (h += row(p + '/' + w, w, PNAME[p + '/' + w], true)));
  });
  h += `</div><div class="acts" style="margin-top:14px"><button class="btn pri" id="nmSave">저장</button><button class="btn ghost" id="nmReset">모두 원래 이름으로</button><button class="btn ghost" onclick="closeModal()">취소</button></div>`;
  openModal('프로젝트 · 작업공간 이름 바꾸기', h); $('modal').classList.add('sm');
  $('nmSave').onclick = () => {
    const nx = {};
    document.querySelectorAll('#mBody [data-nk]').forEach((i) => { const v = i.value.trim(); if (v && v !== i.placeholder) nx[i.dataset.nk] = v; });
    PNAME = nx; ls.set('sf.pname', JSON.stringify(PNAME)); closeModal(); render(); toast('이름을 저장했습니다');
  };
  $('nmReset').onclick = () => document.querySelectorAll('#mBody [data-nk]').forEach((i) => (i.value = ''));
}
window.openNames = openNames;

/* ---------------- 검색 ---------------- */
/* 검색어 문법 (조합 검색)
 *   띄어쓰기 · 쉼표   = 모두 포함 (그리고)      S_SO_HDR S_SO_DTL
 *   |  · OR · 또는     = 둘 중 하나라도 포함      S_SO_HDR | S_SO_DTL
 *   -말 · !말          = 이 말이 있는 사양서 제외  S_SO_HDR -S_SO_DTL
 *   "두 단어"          = 띄어쓰기까지 붙은 말
 * 결과: { groups: [[또는로 묶인 말…], …](그룹끼리 그리고), not: [제외할 말…] } */
const OR_WORD = /^(\||or|또는)$/i, AND_WORD = /^(and|그리고|&)$/i;
function parseTerms(str) {
  const groups = [], not = []; let join = false;
  const push = (t, neg) => {
    t = t.trim(); if (!t) return;
    if (neg) { if (!not.some((x) => x.toLowerCase() === t.toLowerCase())) not.push(t); join = false; return; }
    if (join && groups.length) { const g = groups[groups.length - 1]; if (!g.some((x) => x.toLowerCase() === t.toLowerCase())) g.push(t); }
    else groups.push([t]);
    join = false;
  };
  const re = /(-|!)?"([^"]*)"|(\S+)/g; let m;
  while ((m = re.exec(String(str || '')))) {
    if (m[2] !== undefined) { push(m[2], !!m[1]); continue; }
    let w = m[3];
    if (OR_WORD.test(w)) { if (groups.length) join = true; continue; }
    if (AND_WORD.test(w)) { join = false; continue; }
    // 쉼표는 '그리고', 낱말 안의 | 는 '또는'
    w.split(',').forEach((piece, pi) => {
      if (pi > 0) join = false;
      if (!piece || piece === '-' || piece === '!') return;
      const neg = /^[-!]./.test(piece); if (neg) piece = piece.slice(1);
      const alts = piece.split('|');
      alts.forEach((a, ai) => {
        if (ai > 0) { if (groups.length) join = true; }
        if (a) push(a, neg); else if (ai === alts.length - 1 && ai > 0 && groups.length) join = true; // 'A|' 다음 말과 또는
      });
    });
  }
  return { groups, not };
}
const termsPos = (qx) => qx.groups.flat();
const termsEmpty = (qx) => !qx.groups.length && !qx.not.length;
function parseQuery(q) {
  let sc = scope; const rest = [];
  (String(q).match(/-?"[^"]*"|\S+/g) || []).forEach((t) => {
    if (t.startsWith('@') && t.length > 1) {
      const n = t.slice(1).toLowerCase();
      const hit = (orig, shown) => orig.toLowerCase().includes(n) || shown.toLowerCase().includes(n);
      const p = Object.keys(PROJ).find((x) => hit(x, pName(x)));
      if (p) { sc = 'p:' + p; return; }
      for (const pp of Object.keys(PROJ)) { const w = Object.keys(PROJ[pp]).find((x) => hit(x, wName(pp, x))); if (w) { sc = 'w:' + pp + '/' + w; return; } }
    }
    rest.push(t);
  });
  const qx = parseTerms(rest.join(' '));
  return { sc, qx, toks: termsPos(qx) };
}
/* 검색어 풀이를 칩으로: 포함 · 또는 · 제외 */
function termsHtml(qx, o = {}) {
  const chip = (t, cls) => `<span class="qt ${cls}">${esc(t)}</span>`;
  const parts = qx.groups.map((g) => g.length > 1
    ? `<span class="qor">${g.map((t) => chip(t, 'inc')).join('<span class="qop">또는</span>')}</span>`
    : chip(g[0], 'inc'));
  let h = parts.join(o.compact ? ' ' : '<span class="qop and">그리고</span>');
  if (qx.not.length) h += `${parts.length ? '<span class="qsep"></span>' : ''}<span class="qop not">제외</span>${qx.not.map((t) => chip(t, 'exc')).join('')}`;
  return h;
}
/* 사양서 한 건의 지금 판 전체 글 (제외 검사용 · 소문자) */
function specText(s) {
  if (s._xt) return s._xt;
  const p = [s.name, s.programId, s.reqId, s.base.join(' '), s.overview, s.memo];
  s.columns.forEach((c) => p.push(c.label, c.column, c.tbl, c.desc, c.source));
  s.tables.forEach((t) => p.push(t.id, t.name, t.note));
  [...s.sql, ...s.prompts, ...s.reviews].forEach((f) => p.push(f.name, f.text));
  s.services.forEach((v) => p.push(v.id, v.name, v.note));
  s.combos.forEach((v) => p.push(v.id, v.usedBy, v.name));
  p.push(...s.func, ...s.tech, ...s.layout);
  s.history.forEach((h) => p.push(h.join(' ')));
  if (!s.parsed && s.fulltext) p.push(s.fulltext);
  return (s._xt = p.filter(Boolean).join('\n').toLowerCase());
}
const excluded = (s, not) => not.length > 0 && not.some((t) => specText(s).includes(t.toLowerCase()));
function searchAll(qx, sc) {
  if (Array.isArray(qx)) qx = { groups: qx.map((t) => [t]), not: [] };
  // 제외만 있으면: 범위 안 최신 판 중 그 말이 없는 사양서 모두
  if (!qx.groups.length) return qx.not.length ? L.filter((s) => inScope(s, sc) && !excluded(s, qx.not)).map((s) => ({ s, hits: [], score: 0, rank: 0, others: [] })).sort((a, b) => a.s.name.localeCompare(b.s.name)) : [];
  const toks = termsPos(qx);
  const ok = (cov) => qx.groups.every((g) => g.some((t) => cov.has(t.toLowerCase())));
  const out = [];
  S.filter((s) => inScope(s, sc) && !excluded(s, qx.not)).forEach((s) => {
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
    if (ok(covered)) {
      hits.sort((a, b) => b.score - a.score);
      out.push({ s, hits, score: hits.reduce((a, h) => a + h.score, 0) });
      return;
    }
    // 지금 판에 없는 말이 옛 판에 있으면: 가장 최근 옛 판부터 보고 '옛 판에만 있음' 으로 낸다
    for (const o of [...s.olds].sort((a, b) => b.no - a.no)) {
      const oc = new Set(covered), oh = [];
      (o.lines || []).forEach(([k, t]) => {
        const m = toks.filter((x) => has(t, x)); if (!m.length) return;
        m.forEach((x) => oc.add(x.toLowerCase()));
        if (m.some((x) => !covered.has(x.toLowerCase()))) oh.push({ kind: 'old', obj: { sub: k, line: t, rev: o }, m: m.map((x) => x.toLowerCase()), score: m.length * m.length });
      });
      if (ok(oc)) {
        hits.sort((a, b) => b.score - a.score);
        const all = [...oh, ...hits];
        // 옛 판에만 있는 말 = 지금 판으로는 못 채운 그룹에서 옛 판이 채운 말
        const onlyOld = qx.groups.filter((g) => !g.some((t) => covered.has(t.toLowerCase()))).flatMap((g) => g.filter((t) => oc.has(t.toLowerCase())));
        out.push({ s, hits: all, score: all.reduce((a, h) => a + h.score, 0) * 0.5, oldRev: o, onlyOld });
        break;
      }
    }
  });
  // 같은 프로그램은 한 줄만: 최신 판 > 최신이 아닌 사본 > 최신 판의 옛 판 > 사본의 옛 판 순으로 고른다
  const best = new Map();
  out.forEach((r) => {
    r.rank = (r.oldRev ? 2 : 0) + (r.s.isLatest ? 0 : r.s.stale === 'same' ? 0.5 : 1);
    const b = best.get(r.s.latest);
    if (!b || r.rank < b.rank || (r.rank === b.rank && r.score > b.score)) best.set(r.s.latest, r);
  });
  const res = [...best.values()];
  res.forEach((r) => (r.others = out.filter((x) => x !== r && x.s.latest === r.s.latest).map((x) => x.s.key)));
  // 지금 판에서 찾은 것을 먼저, 옛 판에만 있는 것은 뒤에 (각각 점수 순)
  return res.sort((a, b) => (a.rank >= 2) - (b.rank >= 2) || b.score - a.score);
}

/* ---------------- 라우팅 ---------------- */
let fSrc = null, fMod = null, fKind = null, selKey = null;
/* 뒤로 · 앞으로: 브라우저 기록 칸마다 번호(history.state.sfi)를 붙여 지금 위치(NAVI) · 처음(NAVB) · 끝(NAVM)을 안다.
 * 새 주소로 가면 그 뒤 기록은 브라우저가 지우므로 끝 = 지금. 새로 고침해도 sessionStorage 로 이어 간다. */
const ss = { get: (k) => { try { return sessionStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch (e) {} } };
const stIdx = () => (history.state && typeof history.state.sfi === 'number' ? history.state.sfi : null);
let NAVI = stIdx(), NAVB, NAVM;
if (NAVI === null) { NAVI = 0; try { history.replaceState({ ...(history.state || {}), sfi: 0 }, ''); } catch (e) {} NAVB = 0; NAVM = 0; }
else { NAVB = Math.min(+ss.get('sf.navb') || 0, NAVI); NAVM = Math.max(+ss.get('sf.navm') || 0, NAVI); }
function track() {
  const i = stIdx();
  if (i === null) { NAVI = NAVI + 1; NAVM = NAVI; try { history.replaceState({ ...(history.state || {}), sfi: NAVI }, ''); } catch (e) {} }
  else { NAVI = i; if (i < NAVB) NAVB = i; if (i > NAVM) NAVM = i; }
  ss.set('sf.navb', NAVB); ss.set('sf.navm', NAVM);
}
const canBack = () => NAVI > NAVB, canFwd = () => NAVI < NAVM;
function updateBack() {
  const home = !location.hash || location.hash === '#/' || location.hash === '#';
  $('backBtn').hidden = home && !canBack();
  updateFab();
}
function goBack() { if (canBack()) history.back(); else go('#/'); }
function goFwd() { if (canFwd()) history.forward(); }
$('backBtn').onclick = goBack;
window.addEventListener('hashchange', () => { track(); render(); });
ss.set('sf.navb', NAVB); ss.set('sf.navm', NAVM);

/* 오른쪽 아래 세로 버튼: 처음 · 뒤로 · 앞으로(뒤로 간 뒤에만) · 맨 위 · 맨 아래 */
const FAB_ICON = {
  home: '<path d="M4 11l8-7 8 7"/><path d="M6 9.5V20h12V9.5"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  fwd: '<path d="M9 6l6 6-6 6"/>',
  top: '<path d="M6 5h12"/><path d="M12 19V9"/><path d="M7 13l5-5 5 5"/>',
  bot: '<path d="M6 19h12"/><path d="M12 5v10"/><path d="M7 11l5 5 5-5"/>',
};
(() => {
  const f = document.createElement('nav'); f.className = 'fab'; f.id = 'fab'; f.setAttribute('aria-label', '화면 이동');
  const B = (k, t) => `<button type="button" data-f="${k}" title="${t}" aria-label="${t}"><svg viewBox="0 0 24 24">${FAB_ICON[k]}</svg></button>`;
  f.innerHTML = B('home', '처음 화면') + B('back', '뒤로 (Alt + ←)') + B('fwd', '앞으로 (Alt + →)') + B('top', '맨 위로') + B('bot', '맨 아래로');
  document.body.appendChild(f);
  const scroller = () => document.scrollingElement || document.documentElement;
  f.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const k = b.dataset.f;
    if (k === 'home') go('#/');
    else if (k === 'back') goBack();
    else if (k === 'fwd') goFwd();
    else if (k === 'top' || k === 'bot') {
      const smooth = !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
      const el = scroller(), y0 = el.scrollTop, to = () => (k === 'top' ? 0 : el.scrollHeight);
      window.scrollTo({ top: to(), behavior: smooth ? 'smooth' : 'auto' });
      // 부드러운 스크롤이 시작도 못 했으면(배율 · 백그라운드 등) 바로 이동
      if (smooth) setTimeout(() => { if (Math.abs(el.scrollTop - y0) < 1) window.scrollTo({ top: to(), behavior: 'auto' }); }, 700);
    }
    [150, 600, 1200].forEach((t) => setTimeout(updateFab, t)); // 스크롤 이벤트가 늦거나 빠져도 상태를 맞춤
  });
  window.addEventListener('scroll', updateFab, { passive: true });
  window.addEventListener('scrollend', updateFab);
  window.addEventListener('resize', updateFab);
  new ResizeObserver(updateFab).observe(document.body);
})();
function updateFab() {
  const f = $('fab'); if (!f) return;
  const el = document.scrollingElement || document.documentElement;
  const max = el.scrollHeight - el.clientHeight, y = el.scrollTop;
  const home = !location.hash || location.hash === '#/' || location.hash === '#';
  // 자리가 흔들리지 않게 — 앞으로만 생기고 없어지고, 나머지는 쓸 수 없을 때 흐리게
  const q = (k) => f.querySelector(`[data-f="${k}"]`);
  q('home').disabled = home;
  q('back').disabled = !canBack();
  q('fwd').hidden = !canFwd();
  q('top').disabled = !(max > 4 && y > 4);
  q('bot').disabled = !(max > 4 && y < max - 4);
}
function route() { const segs = location.hash.replace(/^#\/?/, '').split('/').map((x) => { try { return decodeURIComponent(x); } catch (e) { return x; } }); return segs; }
function render() {
  const [r, a, b] = route();
  const hasData = !!IDX;
  updateBack();
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
/* 검색창 아래 한 줄: 비어 있으면 조합 방법(누르면 넣어 줌) · 입력하면 '이렇게 찾습니다' 풀이 */
const QOPS = [
  { k: '모두 포함', ex: 'A B', ins: ' ', tip: '띄어쓰기(또는 쉼표)로 이으면 모두 들어간 사양서만' },
  { k: '또는', ex: 'A | B', ins: ' | ', tip: '| 또는 OR 로 이으면 둘 중 하나라도 들어간 사양서' },
  { k: '제외', ex: '-A', ins: ' -', tip: '말 앞에 - 를 붙이면 그 말이 있는 사양서는 뺌' },
  { k: '붙은 말', ex: '"A B"', ins: ' ""', tip: '따옴표로 묶으면 띄어쓰기까지 그대로 찾음' },
];
function bindQHelp(inp, box) {
  if (!inp || !box) return;
  const draw = () => {
    const v = inp.value.trim();
    const { qx } = v ? parseQuery(v) : { qx: { groups: [], not: [] } };
    const empty = !v || termsEmpty(qx);
    const ops = `<span class="qops">${empty ? '<span class="lab">조합 검색</span>' : ''}${QOPS.map((o, i) => `<button type="button" data-op="${i}" title="${esc(o.tip)} — 누르면 검색창에 넣습니다"><code>${esc(o.ex)}</code>${esc(o.k)}</button>`).join('')}</span>`;
    box.innerHTML = (empty ? '' : `<span class="qinterp"><span class="lab">이렇게 찾습니다</span><span class="qline">${termsHtml(qx)}</span></span>`) + ops;
    box.classList.toggle('typed', !empty);
    // 한 줄: 왼쪽 = 예시(비었을 때) 또는 풀이(입력 중) · 오른쪽 = 조합 버튼
    const sg = $('sugg'); if (sg) sg.hidden = !empty;
    box.querySelectorAll('[data-op]').forEach((b) => (b.onmousedown = (e) => {
      e.preventDefault();
      const o = QOPS[+b.dataset.op]; const cur = inp.value.replace(/\s+$/, '');
      // 비어 있을 때 '모두 포함' · '또는' 은 앞말이 없으니 넣지 않고 창만 고른다
      if (cur || !/^\s*\|?\s*$/.test(o.ins)) inp.value = cur ? cur + o.ins : o.ins.trimStart();
      let pos = inp.value.length; if (o.ins.endsWith('""')) pos -= 1;
      inp.focus(); inp.setSelectionRange(pos, pos); draw();
    }));
  };
  inp.addEventListener('input', draw); draw();
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
  const SC = L.filter((s) => inScope(s)), hidden = S.filter((s) => !s.isLatest && inScope(s)).length;
  const mods = {}; SC.forEach((s) => (mods[s.module] = (mods[s.module] || 0) + 1));
  const nTool = SC.filter((s) => s.source !== '수기').length;
  const recent = [...SC].filter((s) => s.confirmedAt).sort((a, b) => b.confirmedAt.localeCompare(a.confirmedAt) || (b.rev || 0) - (a.rev || 0)).slice(0, 8);
  const tops = Object.values(TBL).map((t) => ({ id: t.id, name: t.name, n: Object.keys(t.specs).length })).sort((a, b) => b.n - a.n).slice(0, 9);
  const max = tops[0]?.n || 1;
  const nCols = SC.reduce((a, s) => a + s.columns.length, 0), nSql = SC.reduce((a, s) => a + s.sql.length, 0), nMock = SC.reduce((a, s) => a + s.mockups.length, 0);
  const colEx = (() => { for (const t of tops) { const c = Object.keys(TBL[t.id].cols).find((c) => c.length > 6); if (c) return c; } return ''; })();
  const sugg = [tops[0] && ['테이블', tops[0].id], colEx && ['컬럼', colEx], SC[0] && ['화면', SC[0].name.replace(/\(S\)$/, '')], ['로직', '확정']].filter(Boolean);
  $('app').innerHTML = `
  <section class="hero">
    <h1>무엇을 찾을까요?</h1>
    <p>테이블 · 컬럼 · 화면 라벨 · 프로그램ID · 로직에 나온 말로 찾습니다. 여러 말을 포함 · 또는 · 제외로 조합할 수 있습니다. <span class="muted">@프로젝트 로 범위 지정</span></p>
    <div class="bigsearch"><div class="box"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
      <input id="q1" placeholder="예) S_SO_HDR S_SO_DTL  ·  S_SO_HDR | S_SO_DTL  ·  S_SO_HDR -S_SO_DTL" autocomplete="off" spellcheck="false" autofocus></div>${scopeSelect('scHome')}</div>
    <div class="qrow"><div class="sugg" id="sugg"><span class="lab">이렇게 찾아 보세요</span>${sugg.map(([k, v]) => `<button data-q="${esc(v)}"><b>${k}</b>${esc(v)}</button>`).join('')}</div>
      <div class="qhelp" id="qhelp"></div></div>
  </section>
  <div class="stats">
    <div class="card stat"><div class="v">${SC.length}<small>건</small></div><div class="l">사양서 · ${esc(scopeLabel())}<br><span title="도구 = AX사양서도구로 확정 · 수기 = 도구 밖에서 만든 사양서">도구 ${nTool} · 수기 ${SC.length - nTool}</span>${hidden ? `<br><span title="같은 프로그램의 옛 판 · 다른 폴더 사본은 최신 판 하나로 묶어 셉니다">옛 판 · 사본 ${hidden}건 묶음</span>` : ''}</div></div>
    <div class="card stat"><div class="v">${Object.keys(TBL).length}</div><div class="l">테이블</div></div>
    <div class="card stat"><div class="v">${nCols.toLocaleString()}</div><div class="l">화면 컬럼 매핑</div></div>
    <div class="card stat"><div class="v">${nSql}</div><div class="l">쿼리 파일</div></div>
    <div class="card stat"><div class="v">${nMock}</div><div class="l">목업</div></div>
  </div>
  <div class="card"><div class="ch">모듈별 <span class="muted">눌러서 그 모듈만 보기</span></div><div class="cb"><div class="mods">
    ${Object.entries(mods).sort((a, b) => b[1] - a[1]).map(([m, n]) => `<div class="modt" style="--mc:${modColor(m)}" data-m="${esc(m)}">${modTag(m)}<div><b>${esc(MODN[m] || m)}</b><span>${n}건</span></div></div>`).join('')}
  </div></div></div>
  <div class="grid2">
    <div class="card"><div class="ch">최근 확정 · 개정 <span class="muted">최신 판 기준</span></div><div class="cb"><ul class="list">
      ${recent.map((s) => `<li>${modTag(s.module)}<a onclick="go('${link('s', s.key)}')">${esc(s.name)}</a>${s.source === '수기' ? '<span class="chip src-m">수기</span>' : ''}<span class="r">${revTag(s)}<span>${esc(s.confirmedAt)}</span></span></li>`).join('') || '<li class="muted">없음</li>'}
    </ul></div></div>
    <div class="card"><div class="ch">많이 쓴 테이블 <span class="muted">사양서 수</span></div><div class="cb">
      ${tops.map((t) => `<div class="bar"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${tblHtml(t.id)} <span class="muted small">${esc(t.name)}</span></span><div class="track"><div class="fill" style="width:${(t.n / max) * 100}%"></div></div><span class="n">${t.n}</span></div>`).join('')}
    </div></div>
  </div>`;
  bindSearch($('q1')); bindScope('scHome'); bindQHelp($('q1'), $('qhelp'));
  document.querySelectorAll('.sugg button').forEach((b) => (b.onclick = () => go(link('q', b.dataset.q))));
  document.querySelectorAll('.modt').forEach((d) => (d.onclick = () => { fMod = d.dataset.m; fSrc = fKind = null; go(link('q', '*')); }));
}

/* ---------------- 결과 ---------------- */
let LAST = null, REF = [], refQ = null;
function renderResults(q) {
  if (q !== refQ) { REF = []; refQ = q; }
  const { sc, qx, toks: qt } = parseQuery(q);
  const all = q.trim() === '*' || (termsEmpty(qx) && fMod);
  let res = all ? L.filter((s) => inScope(s, sc)).map((s) => ({ s, hits: [], score: 0 })).sort((a, b) => a.s.name.localeCompare(b.s.name)) : searchAll(qx, sc);
  // 검색 내 검색: 좁히기 말(포함 · 또는 · 제외 문법 그대로)이 걸린 사양서(같은 프로그램 단위)만 남기고, 걸린 곳을 앞에 붙인다
  const rx = parseTerms(REF.join(' '));
  if (REF.length) {
    const sub = new Map(searchAll(rx, sc).map((r) => [r.s.latest, r]));
    res = res.filter((r) => sub.has(r.s.latest)).map((r) => { const x = sub.get(r.s.latest); return { ...r, hits: [...(x.s === r.s ? x.hits : []), ...r.hits], score: r.score + x.score }; });
  }
  const toks = [...qt, ...termsPos(rx)];
  const cnt = (f) => { const m = {}; res.forEach((r) => f(r).forEach((k) => (m[k] = (m[k] || 0) + 1))); return m; };
  const cSrc = cnt((r) => [r.s.source]), cMod = cnt((r) => [r.s.module]), cKind = cnt((r) => [...new Set(r.hits.map((h) => h.kind))].filter((k) => k !== 'name'));
  const shown = res.filter((r) => (!fSrc || r.s.source === fSrc) && (!fMod || r.s.module === fMod) && (!fKind || r.hits.some((h) => h.kind === fKind)));
  LAST = { toks, shown };
  if (!shown.find((r) => r.s.key === selKey)) selKey = shown[0]?.s.key || null;
  const outside = sc && !all && !REF.length ? searchAll(qx, '').length - res.length : 0;
  const x13 = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  const title = all ? (fMod ? `${esc(MODN[fMod] || fMod)} 모듈` : '전체 사양서') : `<span class="qline">${termsHtml(qx)}</span>`;
  const grp = (label, cur, counts, set, names) => {
    const keys = Object.keys(counts); if (keys.length < 2 && !cur) return '';
    return `<div class="g"><span>${label}</span><button class="${!cur ? 'on' : ''}" data-f="${set}" data-v="">전체</button>${keys.sort((a, b) => counts[b] - counts[a]).map((k) => `<button class="${cur === k ? 'on' : ''}" data-f="${set}" data-v="${esc(k)}">${esc(names ? names(k) : k)} <em>${counts[k]}</em></button>`).join('')}</div>`;
  };
  $('app').innerHTML = `
    <div class="rhead"><h2 class="crumbq">${title}${REF.length ? `<span class="gt">›</span><span class="qline">${termsHtml(rx)}</span>` : ''}</h2>
      <span class="cnt">사양서 <b>${shown.length}</b>건${shown.length !== res.length ? ` / ${res.length}` : ''} · ${esc(scopeLabel(sc))}</span>
      ${sc ? `<a class="small" onclick="setScope('');">범위 풀기</a>` : ''}${outside > 0 ? `<span class="small muted">범위 밖에 ${outside}건 더</span>` : ''}</div>
    <div class="refine"><span class="lab"><svg viewBox="0 0 24 24"><path d="M3 5h18l-7 8v6l-4-2v-4z"/></svg>결과 안에서</span>
      ${REF.map((t, i) => `<span class="rchip${/^[-!]./.test(t) ? ' exc' : ''}" title="${/^[-!]./.test(t) ? '이 말이 있는 사양서 제외' : t.includes('|') ? '둘 중 하나라도 포함' : '포함'}">${/^[-!]./.test(t) ? `<small>제외</small>${esc(t.slice(1))}` : esc(t.replace(/\|/g, ' 또는 '))}<button data-ri="${i}" title="이 조건 빼기">${x13}</button></span>`).join('')}
      <input id="rq" placeholder="${REF.length ? '더 좁힐 말 + Enter' : '이 결과에서 다시 찾기 — 예) 그리드 · -수량(제외) · A|B(또는) + Enter'}" autocomplete="off" spellcheck="false">
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
    if (e.key === 'Enter' && v) {
      // 좁히기 말도 같은 문법: 그룹마다 칩 하나 (또는 = A|B · 제외 = -A)
      const px = parseTerms(v);
      [...px.groups.map((g) => g.map((t) => (/\s/.test(t) ? `"${t}"` : t)).join('|')), ...px.not.map((t) => '-' + (/\s/.test(t) ? `"${t}"` : t))]
        .forEach((t) => { if (!REF.some((x) => x.toLowerCase() === t.toLowerCase())) REF.push(t); });
      again(true);
    }
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
    ${staleBadges(s, r)}
    <div class="ans">${h ? `${kindTag(h.kind)}<span class="txt">${oneLine(h, toks)}</span>` : `<span class="txt">${hl(trim(s.overview || '', 120), toks) || '<span class="muted">요약 없음</span>'}</span>`}</div>
    ${Object.keys(kinds).length ? `<div class="l3">${Object.entries(kinds).map(([k, n]) => `<span>${KIND[k]} <b>${n}</b></span>`).join('')}</div>` : ''}
  </div>`;
}
/* 최신 판이 아님 · 옛 판에만 있음 표시 (결과 줄) */
function staleBadges(s, r) {
  const b = [];
  if (r && r.oldRev) b.push(`<span class="chip stale" title="검색어가 지금 판에는 없고 옛 판에만 있습니다">옛 판(${esc(revName(r.oldRev.no))})에만 있음</span>`);
  if (!s.isLatest) b.push(s.stale === 'old' ? '<span class="chip stale" title="같은 프로그램의 더 새 판이 있습니다">최신 판 아님</span>' : '<span class="chip" title="같은 날짜 · 같은 판의 같은 프로그램 사양서가 다른 폴더에도 있어 그쪽을 대표로 보입니다">같은 판 · 다른 폴더</span>');
  if (!b.length) return '';
  const L1 = BYKEY[s.latest];
  return `<div class="l2s">${b.join('')}${!s.isLatest && L1 ? `<a class="small" onclick="event.stopPropagation();go('${link('s', L1.key)}')">최신 판으로 →</a>` : ''}${r && r.oldRev && s.isLatest ? `<a class="small" onclick="event.stopPropagation();go('${link('s', s.key)}')">최신 판 열기 →</a>` : ''}</div>`;
}
/* 최신 판이 아님 · 옛 판에만 있음 안내 (미리보기 · 사양서 화면 위) */
function staleNote(s, r) {
  const L1 = BYKEY[s.latest]; let h = '';
  if (r && r.oldRev) {
    const o = r.oldRev;
    h += `<div class="stalebox"><svg viewBox="0 0 24 24"><path d="M12 8v5l3 2"/><circle cx="12" cy="12" r="9"/></svg><div>
      <b>${r.onlyOld.map((t) => `<mark>${esc(t)}</mark>`).join(' ')} — 옛 판에만 있습니다.</b>
      <div class="small">찾은 곳: ${esc(revName(o.no))}${o.label ? ' · ' + esc(o.label) : ''} <code>${esc(o.name)}</code> · 지금 판(${esc(revName(s.rev) || '최신')})에는 없음 — 바뀌었거나 빠진 내용입니다.</div>
      <div class="acts">${s.isLatest ? `<button class="btn pri" onclick="go('${link('s', s.key)}')">최신 판 열기 →</button>` : ''}${!DEMO && o.path ? `<button class="btn" onclick="openExcelRef('${esc(o.path)}')">옛 판 엑셀 보기</button>` : ''}</div></div></div>`;
  }
  if (!s.isLatest && L1) {
    h += `<div class="stalebox"><svg viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01"/><circle cx="12" cy="12" r="9"/></svg><div>
      <b>${s.stale === 'old' ? '이 사양서는 최신 판이 아닙니다.' : '같은 날짜 · 같은 판의 같은 프로그램 사양서가 다른 폴더에도 있습니다.'}</b>
      <div class="small">지금 보는 것: ${esc(wName(s))} · ${esc(dateTxt(s))} → ${s.stale === 'old' ? '최신' : '대표'}: <b>${esc(L1.name)}</b> · ${esc(wName(L1))} · ${esc(dateTxt(L1))}</div>
      <div class="acts"><button class="btn pri" onclick="go('${link('s', L1.key)}')">${s.stale === 'old' ? '최신 판으로 →' : '대표 사양서로 →'}</button></div></div></div>`;
  }
  return h;
}
function oneLine(h, toks) {
  const o = h.obj;
  if (h.kind === 'old') return `<span class="muted">${esc(revName(o.rev.no))} · ${esc(KIND[o.sub] || '')}</span> ${hl(trim(snippet(o.line, toks), 120), toks)}`;
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

const ORDER = ['old', 'col', 'tbl', 'sql', 'logic', 'svc', 'cmb', 'ov', 'memo', 'req', 'rev', 'hist', 'full'];
function preview(r, toks) {
  const s = r.s;
  const groups = {}; r.hits.forEach((h) => { if (h.kind !== 'name' && (!fKind || h.kind === fKind) && !(h.kind === 'col' && s.columns.length)) (groups[h.kind] = groups[h.kind] || []).push(h); });
  const seen = new Set();
  const body = ORDER.filter((k) => groups[k]).map((k) => {
    const list = groups[k].filter((h) => { const id = k + JSON.stringify(h.obj).slice(0, 200); if (seen.has(id)) return false; seen.add(id); return true; });
    const tab = { col: 'col', tbl: 'col', sql: 'sql', logic: 'logic', svc: 'flow', cmb: 'logic', memo: 'memo', req: 'mat', rev: 'mat', hist: 'mat', old: 'mat' }[k] || 'sum';
    return `<div class="hg"><div class="hgh">${kindTag(k)}<span class="n">${list.length}곳</span></div>
      ${list.slice(0, 6).map((h) => `<div class="hrow">${pvRow(h, toks)}</div>`).join('')}
      ${list.length > 6 ? `<a class="more" onclick="go('${link('s', s.key, tab)}')">${list.length - 6}곳 더 →</a>` : ''}</div>`;
  }).join('');
  const nRel = relList(s).length;
  return `<div class="ph">${staleNote(s, r)}<h3>${modTag(s.module)}${hl(s.name, toks)}</h3>
    <div class="chips"><span class="chip id">${esc(pidTxt(s))}</span>${s.reqId ? `<span class="chip id">${esc(s.reqId)}</span>` : ''}${srcChip(s)}${revTag(s)}${s.base.map((b) => `<span class="chip id" title="기준 화면">기준 ${esc(b)}</span>`).join('')}<span class="chip">${esc(wName(s))}</span>${s.parsed ? '' : '<span class="chip warn">구조 미해석</span>'}</div>
    ${s.overview ? `<div class="ov">${sent(hl(s.overview, toks))}</div>` : ''}
    <div class="acts"><button class="btn pri" onclick="go('${link('s', s.key)}')">사양서 열기</button>${s.excel && !DEMO ? `<button class="btn" onclick="openExcel('${esc(s.key)}')">엑셀 미리보기</button>` : ''}${nRel ? `<button class="btn" onclick="go('${link('s', s.key, 'rel')}')">연관 프로그램 ${nRel}</button>` : ''}</div>
    ${r.others && r.others.length ? `<div class="muted small" style="margin-top:8px">같은 프로그램의 ${r.others.map((k) => { const o = BYKEY[k]; return o ? `<a onclick="go('${link('s', k)}')">${esc(wName(o))} · ${esc(dateTxt(o))}</a>` : ''; }).join(', ')} 에서도 찾았습니다 (최신 기준으로 하나만 보임)</div>` : ''}
  </div><div class="pb">
    ${s.columns.length ? `<div class="pvsec">화면 ↔ DB 매핑 <span class="n">컬럼 ${s.columns.length} · 테이블 ${Object.keys(tblColors(s)).length}${r.hits.some((h) => h.kind === 'col') ? ` · <mark>검색어 걸린 줄</mark>` : ''}</span><a onclick="go('${link('s', s.key, 'col')}')">크게 보기 →</a></div><div id="pvmap"></div>` : ''}
    ${body ? `${s.columns.length ? '<div class="pvsec">그 밖에 걸린 곳</div>' : ''}${body}` : s.columns.length ? '' : `<div class="empty small">이름이 걸렸습니다.</div>`}
    ${s.mockups[0] ? `<div class="pvsec">목업</div><div class="mini-mock" style="margin-top:0" onclick="openMock('${esc(s.mockups[0])}')"><iframe data-ref="${esc(s.mockups[0])}" tabindex="-1"></iframe></div>` : ''}</div>`;
}
function pvRow(h, toks) {
  const o = h.obj;
  if (h.kind === 'old') return `<div><span class="chip stale" style="height:20px">${esc(revName(o.rev.no))}</span> <span class="muted small">${esc(KIND[o.sub] || '')}${o.rev.label ? ' · ' + esc(o.rev.label) : ''}</span></div><div class="d">${hl(trim(snippet(o.line, toks), 260), toks)}</div>`;
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
  const rels = relList(s);
  const nMat = s.prompts.length + s.reviews.length + s.outputs.length + s.files.length + s.revisions.length + s.history.length;
  const tabs = [['sum', '요약'], ['col', '테이블 · 컬럼', s.columns.length || s.tables.length], ['logic', '로직', s.func.length + s.tech.length],
    ...(s.sql.length ? [['sql', '쿼리', s.sql.length]] : []), ['flow', '흐름', s.services.length || null],
    ...(s.memo ? [['memo', '결정 메모']] : []), ['test', '테스트', s.tests.length], ['rel', '연관', rels.length], ...(nMat ? [['mat', '자료', nMat]] : []), ['deep', '심층']];
  const par = s.parent && BYKEY[s.parent], kids = s.children.map((k) => S[k]);
  // 같은 프로그램의 다른 판 · 사본 / 이름만 같은 다른 모듈 사양서
  const copies = s.copies.map((k) => BYKEY[k]).filter(Boolean);
  const same = s.same.map((k) => BYKEY[k]).filter((o) => o && !s.copies.includes(o.key) && o.latest !== s.latest);
  $('app').innerHTML = `
  <div class="crumb"><a onclick="go('#/')">홈</a>›<a onclick="setScope('p:${esc(s.project)}')">${esc(pName(s.project))}</a><span>(${esc(wName(s))})</span>›<a onclick="fMod='${esc(s.module)}';fSrc=fKind=null;go('${link('q', '*')}')">${esc(MODN[s.module] || s.module)}</a>›<span>${esc(s.name)}</span></div>
  ${staleNote(s, null)}
  <div class="card dhero" style="--mc:${modColor(s.module)}">
    <h1>${modTag(s.module)}${esc(s.name)}</h1>
    <div class="chips"><span class="chip id">${esc(pidTxt(s))}</span>${s.reqId ? `<span class="chip id" title="요구ID">${esc(s.reqId)}</span>` : ''}${srcChip(s)}${revTag(s)}${!s.isLatest ? `<span class="chip stale">${s.stale === 'old' ? '최신 판 아님' : '같은 판 · 다른 폴더'}</span>` : ''}
      ${s.base.map((b) => `<span class="chip id" title="기준 화면">기준 ${esc(b)}</span>`).join('')}
      ${s.parsed ? `<span class="chip ok" title="읽은 방식">${esc(s.adapter)}</span>` : s.adapter === '자료만' ? '<span class="chip">엑셀 없음 · 자료만</span>' : '<span class="chip warn">구조 미해석 · 본문만</span>'}
      ${s.programType ? `<span class="chip">${esc(s.programType.split('(')[0])}</span>` : ''}</div>
    <div class="ov">${sent(esc(s.overview || '요약이 없습니다 (1.개요를 읽지 못함).'))}</div>
    <div class="acts">${s.excel && !DEMO ? `<button class="btn" onclick="openExcel('${esc(s.key)}')"><svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8l8 8M16 8l-8 8"/></svg>엑셀 미리보기</button>` : ''}
      ${s.folder && !DEMO ? `<button class="btn" onclick="copyPath('${esc(s.folder)}')" title="탐색기 주소창에 붙여 넣으세요"><svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>폴더 경로 복사</button>` : ''}</div>
    <div class="kpis">
      <div class="kpi"><div class="v">${esc(s.confirmedAt || '—')}</div><div class="l">${s.source === '수기' ? '최종 이력' : '확정'}${s.rev ? ` · ${revName(s.rev)}` : ''}${s.revisions.length > 1 ? ` <a onclick="go('${link('s', s.key, 'mat')}')">(판 ${s.revisions.length}개)</a>` : ''}</div></div>
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
      ${copies.length ? `<div class="card"><div class="ch">같은 프로그램의 판 · 사본 <span class="muted">${copies.length + 1}곳</span></div><div class="cb"><ul class="list">
        ${[s, ...copies].sort((a, b) => (b.isLatest ? 1 : 0) - (a.isLatest ? 1 : 0) || (b.confirmedAt || '').localeCompare(a.confirmedAt || '')).map((o) => `<li><span class="chip ${o.isLatest ? 'ok' : o.stale === 'old' ? 'stale' : ''}" style="height:20px">${o.isLatest ? '최신' : o.stale === 'old' ? '옛 판' : '사본'}</span>${o === s ? `<b>${esc(wName(o))}</b><span class="muted small">지금 보는 것</span>` : `<a onclick="go('${link('s', o.key)}')">${esc(wName(o))}</a>`}<span class="r">${esc(dateTxt(o))}</span></li>`).join('')}</ul></div></div>` : ''}
      ${par || kids.length || same.length ? `<div class="card"><div class="ch">본 화면 · 팝업${same.length ? ' · 이름이 같은 사양서' : ''}</div><div class="cb"><ul class="list">
        ${par ? `<li><span class="muted small">본 화면</span><a onclick="go('${link('s', par.key)}')">${esc(par.name)}</a></li>` : ''}
        ${kids.map((k) => `<li><span class="muted small">${k.name.includes('_출력물') || (!k.excel && (k.outputs || []).length) ? '출력물' : '팝업'}</span><a onclick="go('${link('s', k.key)}')">${esc(k.name.replace(s.name + '_', ''))}</a></li>`).join('')}
        ${same.map((o) => `<li><span class="muted small" title="이름만 같고 모듈이 다른 사양서 — 다른 프로그램입니다">${esc(o.module)} 모듈</span><a onclick="go('${link('s', o.key)}')">${esc(o.name)}</a><span class="r">${esc(wName(o))}</span></li>`).join('')}</ul></div></div>` : ''}
      ${rels.length || s.related.length ? `<div class="card"><div class="ch">연관 프로그램 <span class="muted">${rels.length}</span>${rels.length ? `<a class="r small" onclick="go('${link('s', s.key, 'rel')}')">전체 보기</a>` : ''}</div><div class="cb"><ul class="list">
        ${rels.slice(0, 7).map((e) => `<li>${modTag(e.t.module)}<a onclick="go('${link('s', e.t.key)}')" title="${esc(e.t.name)}">${esc(e.t.name)}</a><span class="r">${e.types.slice(0, 2).map(relTag).join('')}</span></li>`).join('')}
        ${rels.length > 7 ? `<li><a onclick="go('${link('s', s.key, 'rel')}')">${rels.length - 7}개 더 →</a></li>` : ''}
        ${!rels.length ? s.related.map((r) => `<li style="display:block">${linkify(r.replace('연관 프로그램: ', ''))}</li>`).join('') : ''}</ul></div></div>` : ''}
      <div class="card"><div class="ch">흐름 <a class="r small" onclick="go('${link('s', s.key, 'flow')}')">크게</a></div><div class="cb flowsvg">${flowSvg(s, true)}</div></div>
    </div>
  </div>`;
  ({ sum: tabSum, col: tabCol, logic: tabLogic, sql: tabSql, flow: tabFlow, memo: tabMemo, test: tabTest, rel: tabRel, mat: tabMat, deep: tabDeep }[tab] || tabSum)(s, rels);
  hydrate($('app'));
}
const fileName = (ref) => String(ref).split('/').pop();
function linkify(txt) { let h = esc(txt); L.forEach((o) => { if (o.name.length > 3 && h.includes(esc(o.name))) h = h.split(esc(o.name)).join(`<a onclick="go('${link('s', o.key)}')">${esc(o.name)}</a>`); }); return h; }
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
/* 연관 탭: 이 사양서가 말한 프로그램(→) · 이 사양서를 말한 프로그램(←) · 같은 기준 화면 */
let relType = '';
function tabRel(s, rels) {
  rels = rels || relList(s);
  const cnt = {}; rels.forEach((e) => e.types.forEach((t) => (cnt[t] = (cnt[t] || 0) + 1)));
  if (relType && !cnt[relType]) relType = '';
  const shown = rels.filter((e) => !relType || e.types.includes(relType));
  const evHtml = (ev, dir, t) => {
    const k = ev.term ? ev.line.indexOf(ev.term) : -1;
    const line = k > 60 ? '…' + ev.line.slice(k - 40) : ev.line;
    return `<div class="ev"><span class="dir ${dir}" title="${dir === 'out' ? '이 사양서에 적힌 글' : '「' + esc(t.name) + '」 사양서에 적힌 글'}">${dir === 'out' ? '→' : '←'}</span><span class="loc">${esc(ev.loc)}</span>${relTag(ev.type)}<span class="tx">${hl(trim(line, 220), ev.term ? [ev.term] : [])}</span></div>`;
  };
  $('tb').innerHTML = `
    <div class="muted small" style="margin-bottom:10px">사양서 글(요약 · 로직 · 컬럼 설명 · 서비스 · 메모 · 연관 프로그램 · 이력 · 요청 글)에 나온 다른 화면 이름 · 프로그램ID · 요구ID 로 찾았습니다. 종류는 그 줄의 말(재사용 · 기준 · 참조 · 참고 · 호출 · 연계)로 가릅니다. 같은 프로젝트 · 최신 판 기준.</div>
    ${rels.length ? `<div class="seg relseg"><button class="${relType ? '' : 'on'}" data-rt="">전체 <em>${rels.length}</em></button>${RORDER.filter((t) => cnt[t]).map((t) => `<button class="${relType === t ? 'on' : ''}" data-rt="${esc(t)}">${esc(t)} <em>${cnt[t]}</em></button>`).join('')}</div>` : ''}
    ${shown.length ? `<div class="rels">${shown.map((e) => {
      const ev = [...e.out.map((x) => ['out', x]), ...e.in.map((x) => ['in', x])];
      return `<div class="relrow"><div class="rh">${modTag(e.t.module)}<a onclick="go('${link('s', e.t.key)}')">${esc(e.t.name)}</a><span class="muted small">${esc(pidTxt(e.t))} · ${esc(dateTxt(e.t))}</span>
          <span class="rts">${e.types.map(relTag).join('')}</span>
          <span class="dirs">${e.out.length ? `<span title="이 사양서가 저 프로그램을 말함">→ 말함 ${e.out.length}</span>` : ''}${e.in.length ? `<span title="저 프로그램 사양서가 이 사양서를 말함">← 말해짐 ${e.in.length}</span>` : ''}${e.base ? `<span title="둘 다 같은 표준 화면을 기준으로 함">기준 ${esc(e.base)}</span>` : ''}</span></div>
        ${e.t.overview ? `<div class="rov">${esc(trim(e.t.overview, 160))}</div>` : ''}
        ${ev.slice(0, 3).map(([d, x]) => evHtml(x, d, e.t)).join('')}
        ${ev.length > 3 ? `<details class="evmore"><summary>근거 ${ev.length - 3}줄 더</summary>${ev.slice(3).map(([d, x]) => evHtml(x, d, e.t)).join('')}</details>` : ''}</div>`;
    }).join('')}</div>` : '<div class="empty">사양서 글에서 다른 프로그램을 말한 곳을 찾지 못했습니다.</div>'}
    ${s.related.length ? `<div class="sec">사양서에 적힌 연관 프로그램 (원문)</div><ul class="list">${s.related.map((r) => `<li style="display:block">${linkify(r.replace('연관 프로그램: ', ''))}</li>`).join('')}</ul>` : ''}`;
  document.querySelectorAll('[data-rt]').forEach((b) => (b.onclick = () => { relType = b.dataset.rt; tabRel(s, rels); }));
}
function tabMat(s) {
  const img = (f) => /\.(png|jpe?g|gif|webp)$/i.test(f.name);
  const fileLi = (f) => `<li><a onclick="openFile('${esc(f.path)}')">${esc(f.name)}</a><span class="r">${esc(f.dir || '')} · ${Math.max(1, Math.round(f.size / 1024))}KB</span></li>`;
  const txt = (t, arr) => (arr.length ? `<div class="sec">${t} ${arr.length}</div>${arr.map((f) => `<details class="txt"><summary><b>${esc(f.name)}</b> <span class="muted small">${esc(f.dir)}</span></summary><div class="lines">${esc(f.text || '')}</div></details>`).join('')}` : '');
  const GN = { oldspec: '구사양서 · 옛 판', legacy: '기존 소스', axsrc: 'AX 소스', etc: '기타' };
  const fg = {}; s.files.forEach((f) => (fg[f.group] = fg[f.group] || []).push(f));
  $('tb').innerHTML = `
    ${s.revisions.length ? `<div class="sec">사양서 판 ${s.revisions.length} · 위가 최신</div><ul class="list">${s.revisions.map((r, k) => `<li><span class="chip ${k ? '' : 'ok'}" style="height:20px">${k ? esc(revName(r.no)) : '현재 · ' + esc(revName(r.no))}</span>${DEMO || !r.path ? esc(r.name) : `<a onclick="openExcelRef('${esc(r.path)}')">${esc(r.name)}</a>`}<span class="r">${esc(r.label || '')}</span></li>`).join('')}</ul>
      ${s.olds.length ? '<div class="muted small" style="margin-top:6px">옛 판 내용도 검색합니다 — 검색어가 옛 판에만 있으면 결과에 「옛 판에만 있음」 으로 나옵니다.</div>' : ''}` : ''}
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
  // 옛 판 · 다른 폴더 사본에만 나오는 테이블
  // (그 프로그램의 최신 판이 이 테이블을 쓰면 빼고, 빠진 것만 보인다)
  const olds = (OLDT[id] || []).filter((x, k, a) => a.findIndex((y) => y.i === x.i && y.no === x.no) === k)
    .filter((x) => { const L1 = BYKEY[S[x.i].latest]; return !(t && L1 && t.specs[L1.i] !== undefined); });
  const oldCard = olds.length ? `<div class="card" style="margin-top:14px"><div class="ch">옛 판 · 사본에만 나옴 <span class="muted">최신 판에는 이 테이블이 없음</span></div><div class="cb"><ul class="list">${olds.map((x) => { const o = S[x.i], L1 = BYKEY[o.latest]; return `<li>${modTag(o.module)}<a onclick="go('${link('s', o.key)}')">${esc(o.name)}</a><span class="chip stale" style="height:20px">${x.no ? esc(revName(x.no)) + '에만' : o.stale === 'old' ? '최신 판 아님' : '다른 폴더 사본'}</span><span class="muted small">${esc(wName(o))}</span>${L1 && L1 !== o ? `<span class="r"><a onclick="go('${link('s', L1.key)}')">최신 판으로 →</a></span>` : ''}</li>`; }).join('')}</ul></div></div>` : '';
  if (!t) { $('app').innerHTML = `<div class="card empty">${esc(id)} 를 쓰는 최신 판 사양서가 ${esc(scopeLabel())} 안에 없습니다.</div>${oldCard}`; return; }
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
    : '<div class="muted">화면 컬럼에 직접 매핑된 컬럼이 없습니다 (조인 · 조건 · 쿼리에만 쓰임).</div>'}</div></div>${oldCard}`;
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
  ${Object.keys(PROJ).length && !DEMO ? `<div class="card" style="margin-top:14px"><div class="ch">콤보에 보일 프로젝트 이름 <span class="muted">${Object.keys(PNAME).length ? `바꾼 이름 ${Object.keys(PNAME).length}개` : '원래 이름'}</span></div><div class="cb"><span class="muted small">프로젝트 · 작업공간이 콤보와 화면에 보일 이름을 바꿉니다. 이 브라우저에만 저장되고 다시 동기화해도 그대로입니다.</span> <button class="btn" style="margin-left:8px" onclick="openNames()">이름 바꾸기</button></div></div>` : ''}
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
    : need.length ? `<div class="bn">브라우저를 다시 열어 폴더 읽기 허용이 풀렸습니다. 검색은 되지만 목업 · 엑셀 미리보기와 새 사양서 반영을 하려면 허용해 주세요.<button class="btn" id="regrant">폴더 다시 허용</button></div>`
    : IDX && !syncing && (IDX.revs || 0) < SF.INDEX_REVS ? `<div class="bn">새 기능(판 표시 · 옛 판 검색)을 쓰려면 동기화를 한 번 해 주세요. 옛 판 엑셀을 처음 읽습니다.<button class="btn" id="regrant">지금 동기화</button></div>` : '';
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
/* ---------------- 패치 노트 ----------------
 * 새 판을 올릴 때 맨 위에 한 줄 추가한다. 위쪽 버전 표시는 맨 위 항목(PATCH[0].v)으로 바뀐다. */
const PATCH = [
  { v: '20261125.005', at: '2026-11-25 15:08', sum: '오른쪽 아래 이동 버튼 · 배지 범례 · 도구/수기 건수',
    items: ['오른쪽 아래 세로 버튼 — 처음 화면 · 뒤로 · 앞으로(뒤로 간 뒤에만) · 맨 위로 · 맨 아래로 (쓸 수 없을 때는 흐리게)', '상단 ? 버튼 — 화면에 나오는 배지를 실제 모양 그대로 한 줄 풀이(출처 · 모듈 · 판 · 걸린 곳 · 연관 · 테이블 · 동기화)', '처음 화면 사양서 수 밑에 도구 · 수기 건수'] },
  { v: '20261125.004', at: '2026-11-25 11:20', sum: '조합 검색(포함 · 또는 · 제외 · 붙은 말) · 검색창 넓힘',
    items: ['A B(또는 쉼표) = 모두 포함 · A | B(OR · 또는) = 둘 중 하나 · -A = 제외 · "A B" = 붙은 말 — 섞어 쓸 수 있음', '검색창 아래에 조합 버튼(누르면 넣어 줌)과 입력 중 \'이렇게 찾습니다\' 풀이 칩', '결과 제목 · 결과 안에서 다시 찾기도 같은 문법과 칩으로 보임', '검색창과 프로젝트 콤보가 한 줄을 꽉 채움'] },
  { v: '20261125.003', at: '2026-11-25 10:36', sum: '프로젝트 · 작업공간 이름을 콤보에 보일 이름으로 바꿀 수 있게 함',
    items: ['프로젝트 콤보 맨 아래 \'✎ 이름 바꾸기…\' · 폴더 · 설정의 \'이름 바꾸기\' 로 엶', '바꾼 이름은 콤보 · 범위 표시 · 사양서 경로 · @검색에 쓰임 (이 브라우저에만 저장 · 동기화해도 유지)', '버전 표시를 누르면 패치 노트(이 화면)가 열림'] },
  { v: '20261125.002', at: '2026-11-25 10:18', sum: '상단 버전 표시 모양 정리',
    items: ['\'사양서 찾기 (ver.…)\' 한 칸 띄움 · 버전 글자를 2/3 크기로'] },
  { v: '20261125.001', at: '2026-11-25 09:32', sum: '리비전(판) 관리 · 연관 프로그램 · 뒤로 가기 추가',
    items: ['같은 프로그램은 최신 판 하나로 묶어 보이고, 옛 판에만 있는 내용은 \'옛 판에만 있음\' 표시와 최신 판으로 가는 버튼', '최근 확정 · 개정과 사양서 화면에 초판 · 2판 · 3판 표시', '사양서마다 연관 탭 — 재사용 · 기준 · 참조 · 참고 · 호출 · 연계 관계와 근거 문장', '뒤로 가기 버튼(Alt + ←)', '프로젝트 콤보를 검색창 크기에 맞춤 · 밝게 모드 모듈 네모 글자 잘 보이게', '상단에 버전 표시'] },
  { v: '첫 공개', at: '2026-11-24 11:50', sum: '사양서 폴더를 연결해 테이블 · 컬럼 · 화면 · 로직 · 쿼리를 찾는 도구 첫 공개',
    items: ['여러 폴더 연결 · 동기화 (파일은 브라우저 밖으로 나가지 않음)', '통합 검색 · 결과 안에서 다시 찾기 · @프로젝트 범위', '테이블 화면(컬럼 × 화면 매핑) · 엑셀 미리보기', '글자 크기 · 화면 배율 · 밝게/어둡게 · 데모 모드'] },
];
function openPatch() {
  const rows = PATCH.map((p, i) => `<tr><td class="v">${/^\d/.test(p.v) ? 'ver.' : ''}${esc(p.v)}${i === 0 ? '<span class="now">현재</span>' : ''}</td><td class="d">${esc(p.at)}</td><td class="s"><b>${esc(p.sum)}</b>${p.items.length ? `<ul>${p.items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</td></tr>`).join('');
  openModal('패치 노트', `<div class="pn"><div class="pnh">Spec Finder · 사양서 찾기 — 판마다 바뀐 기능 (최근 순)</div><table><thead><tr><th>버전</th><th>일시</th><th>요약</th></tr></thead><tbody>${rows}</tbody></table></div>`);
}
window.openPatch = openPatch;

/* 배지 범례 — 화면에 나오는 배지를 실제 모양 그대로 보이고 한 줄로 풀이 */
function openLegend() {
  const C = (cls, t, st) => `<span class="chip ${cls}"${st ? ` style="${st}"` : ''}>${esc(t)}</span>`;
  const KD = { name: '검색어가 화면(프로그램) 이름에 있음', col: '화면 컬럼 라벨 · 테이블 컬럼에 있음', tbl: '쓰는 테이블 이름에 있음', sql: '쿼리 · SQL 파일에 있음', logic: '처리 로직 · 동작 설명에 있음', svc: '서비스 · API 이름에 있음', cmb: '콤보 · 코드 정의에 있음', ov: '개요 · 요약에 있음', memo: '결정 메모(_대화메모.md)에 있음', req: '요청 글(컨설턴트 요청 원문)에 있음', rev: '검토 기록에 있음', hist: '변경 이력 시트에 있음', full: '위 구역이 아닌 엑셀 본문 어딘가에 있음', old: '지금 판에는 없고 옛 판에만 있음' };
  const RD = { 재사용: '저 화면 · 기능을 그대로 다시 씀', 기준: '저 화면을 기준(기반)으로 만듦', 참조: '저 화면 · 자료를 참조함', 참고: '저 화면과 같은 방식 · 동일하게 처리', 호출: '저 화면을 팝업 · 이동 · 클릭으로 엶', 연계: '저 화면과 값을 주고받음(전달 · 가져옴)', '같은 기준 화면': '둘 다 같은 표준 화면을 기준으로 함', 연관: '「연관 프로그램」 칸에 적혀 있음', 언급: '글에 이름만 나옴(종류를 가를 말이 없음)' };
  const row = (b, d) => `<div class="lgr"><div class="lgb">${b}</div><div class="lgd">${d}</div></div>`;
  const grp = (t, rows, note) => `<section class="lgg"><h4>${t}</h4>${note ? `<div class="lgn">${note}</div>` : ''}${rows.join('')}</section>`;
  const mods = Object.keys(MODC);
  const html = `<div class="pn lg"><div class="pnh">화면에 나오는 배지 · 표시가 무엇을 뜻하는지 한 줄로 풀었습니다. 배지 위에 마우스를 올려도 설명이 나옵니다.</div><div class="lgcols">
  ${grp('출처 — 누가 만든 사양서인가', [
    row(srcChip({ source: '도구' }), 'AX사양서도구로 만들어 확정한 사양서 — 연결 폴더에 <code>_프로젝트정보.json</code> 이 있고 <code>확정/…_컨설턴트확정.xlsx</code> 를 읽음'),
    row(srcChip({ source: '수기' }), '도구 밖에서 사람이 직접 만든 사양서 — 폴더 이름이 <code>모듈_ID_이름</code> 꼴(예 SD_SD001_판매계획등록)'),
    row('<span class="lgdot"></span><span class="lgdot m"></span>', '검색 결과 이름 옆 점 — 파랑 = 도구 · 주황 = 수기'),
  ])}
  ${grp('모듈', [
    row(mods.map((m) => modTag(m)).join(''), mods.map((m) => `${m} ${MODN[m] || ''}`).join(' · ')),
    row(modTag('XX'), '위에 없는 모듈은 이름으로 색을 정함 · <code>?</code> = 모듈을 알 수 없음'),
  ], '색 네모를 누르면(처음 화면 모듈별) 그 모듈만 봅니다.')}
  ${grp('판(리비전)', [
    row(revTag({ rev: 1 }), '처음 확정한 판'),
    row(revTag({ rev: 2 }), '다시 확정한 판 — 숫자가 클수록 새 판'),
    row(C('stale', '최신 판 아님'), '같은 프로그램의 더 새 판이 있음 → 최신 판으로 가는 버튼이 함께 나옴'),
    row(C('', '같은 판 · 다른 폴더'), '날짜 · 판이 같은 사본이 다른 폴더에도 있어 한쪽을 대표로 보임'),
    row(C('stale', '옛 판(초판)에만 있음'), '검색어가 지금 판에는 없고 옛 판에만 있음(지워졌거나 바뀐 내용)'),
  ], '같은 프로그램은 최신 판 하나로 묶어 셉니다.')}
  ${grp('사양서 머리', [
    row(C('id', 'SDSOQUI0023') + C('id', 'ID 미정'), '프로그램ID · 아직 ID 를 받지 않은 신규 화면은 ID 미정'),
    row(C('id', 'SD001'), '요구ID(요구사항 번호) — 있을 때만'),
    row(C('ok', '모델JSON v1') + C('ok', '표준엑셀 v1'), '구조를 읽은 방식 — 도구 모델 JSON 또는 표준 엑셀 양식을 알아보고 구역별로 색인함'),
    row(C('warn', '구조 미해석 · 본문만'), '양식을 알아보지 못해 글만 색인함 — 걸린 곳이 「본문」으로만 나옴'),
    row(C('', '엑셀 없음 · 자료만'), '엑셀 사양서 없이 목업 · 쿼리 · 메모 같은 자료만 있음'),
  ])}
  ${grp('걸린 곳 — 검색어가 사양서 어디에 나왔나', Object.keys(KIND).map((k) => row(kindTag(k), KD[k])))}
  ${grp('연관 종류 — 다른 프로그램과의 관계', [
    ...RORDER.map((t) => row(relTag(t), RD[t])),
    row('<span class="lgdir">→</span><span class="lgdir">←</span>', '→ 이 사양서가 저 프로그램을 말함 · ← 저 프로그램 사양서가 이 사양서를 말함'),
  ], '사양서 글에 다른 화면 이름 · 프로그램ID · 요구ID 가 나오면 그 문장의 말로 종류를 가릅니다(같은 프로젝트 · 최신 판).')}
  ${grp('테이블 · 컬럼', [
    row(`<span class="tbl">S_SO_HDR</span>`, '테이블 이름 — 누르면 그 테이블을 쓰는 사양서 · 컬럼 매핑'),
    row(crudHtml('CR'), '그 화면이 테이블에 하는 일 — C 등록 · R 조회 · U 수정 · D 삭제(진한 글자만 함)'),
    row(C('add', '추가'), '이 사양서에서 새로 넣은 컬럼 · 항목'),
    row(C('chg', '변경'), '기준 화면에서 바꾼 컬럼 · 항목'),
  ])}
  ${grp('폴더 · 동기화', [
    row(C('ok', '읽기 허용됨'), '연결한 폴더를 지금 읽을 수 있음'),
    row(C('warn', '다시 허용 필요'), '브라우저가 폴더 권한을 잊음 — 눌러서 다시 허용(파일은 그대로)'),
    row('<span class="sync lgsync"><span class="dot"></span>127건 · 11-25 09:18</span>', '상단 동기화 — 사양서 수 · 마지막으로 다시 읽은 때. 새로 확정한 사양서는 눌러서 동기화해야 나옴'),
  ])}
  </div></div>`;
  openModal('배지 범례', html);
}
window.openLegend = openLegend;
(() => {
  const b = $('verBtn'); if (!b) return;
  b.textContent = '(ver.' + PATCH[0].v + ')';
  const open = (e) => { e.preventDefault(); e.stopPropagation(); openPatch(); };
  b.addEventListener('click', open);
  b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') open(e); });
})();

function openModal(title, html, tools) { $('modal').classList.remove('sm'); $('mTitle').textContent = title; $('mBody').innerHTML = html; $('mTools').innerHTML = tools || ''; $('modal').classList.add('on'); }
function closeModal() { $('modal').classList.remove('on', 'sm'); $('mBody').innerHTML = ''; }
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
  track();
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
