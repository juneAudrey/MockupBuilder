/* spec_adapters.js — 사양서 양식 읽기
 * 셀 좌표가 아니라 "시트 이름 앞 번호"와 "머리글 글자"로 찾는다. 칸이 밀리거나 이름이 조금 바뀌어도 읽힌다.
 * 양식이 바뀌면 이 파일만 고치고 ADAPTER_VERSION 을 올린다(올리면 다음 동기화 때 엑셀을 모두 다시 읽는다).
 *
 *   model(json)  : AX사양서도구 모델 JSON — 구조 전부
 *   std(sheets)  : 표준 엑셀 프로그램사양서 (0.변경이력 · 1.개요 · 2.화면LO · 3.기능사양 · 4.기술사양 · 5.테이블 레이아웃 · 6.단위테스트 · 7.수정사항)
 *   full(sheets) : 위 둘 다 안 될 때 — 본문 글만
 */
(function () {
  const SF = (window.SF = window.SF || {});
  SF.ADAPTER_VERSION = 4; // 2: 도구 양식 2.1/2.2 레이아웃 시트 · 'Table 명' · 서비스/콤보 표 · 3: 관련 정보 글의 컬럼 이름을 테이블로 잡지 않음 · '사용 테이블' 글머리표 · 레이아웃 시트 테이블 이름 · 4: SheetJS 0.20.3 으로 바꿈(같은 엑셀도 새 라이브러리로 다시 읽는다)

  const TABLE_RE = /\b([A-Za-z][A-Za-z0-9]{0,5}_[A-Za-z0-9_]{2,})\b/;
  const TABLE_RE_G = /\b([A-Za-z][A-Za-z0-9]{0,5}_[A-Za-z0-9_]{2,})\b/g;
  const TABLE_UP_G = /\b([A-Z][A-Z0-9]{0,5}_[A-Z0-9_]{2,})\b/g;
  const PGM_RE_G = /\b([A-Z]{4,}[A-Z]*\d{4}[A-Z0-9_]*)\b/g;

  /* 화면LO 머리글 별칭 — 양식이 바뀌면 여기에 이름을 더한다 */
  const HEAD = {
    label: ['한글명', '항목명', '칼럼', '항목(한글)', '항목', '라벨'],
    column: ['영문컬럼ID', '컬럼ID', '컬럼', 'Column'],
    field: ['필드ID'],
    table: ['저장/조회 테이블', '저장 테이블', '테이블', 'Table'],
    related: ['관련 정보', '관련정보'],
    display: ['표시타입', '표시', 'Type'],
    desc: ['기본값·설명(관련정보)', '설명', '기본값', '비고'],
    required: ['입력필수', '필수'],
    readonly: ['Read Only', '읽기'],
  };

  const nonempty = (r) => r.filter((v) => v);
  const sheet = (sheets, num) => sheets.find((s) => new RegExp('^\\s*' + num + '[.\\s]').test(s.title));
  function mapHeader(r, spec) {
    const idx = {};
    for (const [key, names] of Object.entries(spec)) {
      r.forEach((v, j) => { if (v && !(key in idx) && names.some((n) => n.toLowerCase() === v.toLowerCase())) idx[key] = j; });
      if (!(key in idx)) {
        const used = new Set(Object.values(idx));
        const j = r.findIndex((v, j2) => v && !used.has(j2) && names.some((n) => v.toLowerCase().includes(n.toLowerCase())));
        if (j >= 0) idx[key] = j;
      }
    }
    return idx;
  }
  function splitTbl(cell) {
    if (!cell) return [null, ''];
    const m = cell.match(TABLE_RE);
    if (!m) return [null, ''];
    const t = m[1].toUpperCase();
    let crud = '';
    const p = cell.match(/\(([^)]*)\)/);
    if (p) {
      const inner = p[1];
      if (/^[CRUD/ ,]+$/.test(inner)) crud = inner.replace(/[^CRUD]/g, '');
      else if (inner.includes('조회')) crud = 'R';
      else if (inner.includes('저장')) crud = 'CU';
    }
    return [t, crud];
  }
  const textLines = (rows, start) => rows.slice(start).map(nonempty).filter((ne) => ne.length).map((ne) => (ne.length > 1 ? ne.join(' | ') : ne[0]));
  const at = (r, i) => (i != null && i < r.length ? r[i] : '');

  /* ---------- 표준 엑셀 ---------- */
  function std(sheets) {
    const body = { adapter: '표준엑셀 v1', parsed: true, columns: [], tables: [], combos: [], services: [], func: [], tech: [], tests: [], history: [], layout: [], base: [], related: [] };

    // 1.개요 — 왼쪽 이름 · 오른쪽 값
    const ov = {};
    const s1 = sheet(sheets, '1');
    if (s1) for (const r of s1.rows) {
      const ne = nonempty(r);
      if (ne.length >= 2) ov[ne[0]] = ne[1];
      else if (ne.length === 1 && !(ne[0] in ov)) ov[ne[0]] = '';
    }
    const get = (...keys) => { for (const k in ov) if (ov[k] && keys.some((kk) => k.includes(kk))) return ov[k]; return ''; };
    body.overview = get('프로그램 개요', '개요');
    body.programType = get('프로그램 유형');
    body.moduleText = get('모듈');
    body.programIdText = get('프로그램ID');
    body.programName = get('프로그램명');
    const reuse = get('재사용 PGM-ID', '재사용');
    body.base = [...new Set(reuse.match(PGM_RE_G) || [])].sort();
    body.devStyle = reuse && reuse !== '-' ? '재사용 · ' + reuse : '';
    const extra = Object.entries(ov).filter(([k, v]) => v && ['UI 유형', 'BL 유형', '기타 특성'].some((x) => k.includes(x))).map(([k, v]) => `${k}: ${v}`);

    // 0.변경이력 · 7.수정사항
    for (const num of ['0', '7']) {
      const s = sheet(sheets, num);
      if (!s) continue;
      for (const r of s.rows.slice(3)) {
        const ne = nonempty(r);
        const dates = ne.filter((v) => /^\d{4}[.\-]\d\d[.\-]\d\d/.test(v));
        if (dates.length && ne.length >= 3) {
          const rest = ne.slice(1).filter((v) => !dates.includes(v));
          body.history.push([dates[0].replace(/\./g, '-').slice(0, 10), rest.join(' · ')]);
        }
      }
    }

    // 2.화면LO (+ 2.1.Selection Layout · 2.2.Display Layout …) — 화면설명 + 머리글 아래 표
    //   수기 양식: "■ 화면 설명" · "[영역]" · 머리글 한글명/항목명 + 컬럼
    //   도구 양식: "2. [조회조건파트] 영역" · 머리글 칼럼 · 영문컬럼ID · 저장 테이블 · 관련 정보
    const s2s = sheets.filter((s) => /^\s*2[.\s]/.test(s.title));
    const desc = [];
    for (const s2 of s2s) {
      let inDesc = false, area = '화면', hdr = null, skip = false;
      for (const r of s2.rows) {
        const ne = nonempty(r);
        if (!ne.length) continue;
        const first = ne[0];
        if (first.startsWith('■')) { inDesc = first.includes('설명'); continue; }
        if (inDesc && ne.length === 1) { desc.push(first); continue; }
        if (first === '화면설명' && ne.length === 2 && !desc.includes(ne[1])) { desc.push(ne[1]); continue; }
        if (ne.length === 1 && first.startsWith('[')) { area = first.replace(/^[\[\s]+|[\]\s]+$/g, '').split(']')[0].trim(); hdr = null; skip = false; continue; }
        const am = ne.length === 1 && first.match(/^\d+\.\s*\[([^\]]+)\](.*)$/);
        if (am) { area = am[1].replace(/파트$/, '').trim(); skip = /버튼/.test(am[2]); hdr = null; continue; }
        if (HEAD.label.slice(0, 3).some((n) => r.includes(n)) && r.some((v) => v.includes('컬럼') || v === '설명')) { hdr = mapHeader(r, HEAD); continue; }
        if (hdr && 'label' in hdr && ne.length >= 2 && !skip) {
          const g = (k) => at(r, hdr[k]);
          if (!g('label') || g('label') === '-') continue;
          let tcell = g('table'), [t, crud] = splitTbl(tcell), weak = false;
          // 테이블 칸이 비었거나 '저장안함' 이면 관련 정보 칸에서 찾는다 — 다만 그 칸은 글이라 컬럼 이름(ITEM_CD 등)도 섞여 있다.
          // 'TABLE.COLUMN' 꼴이거나 'B_ · S_ · M_ …' 처럼 한 글자 접두어면 테이블로 믿고, 아니면 4.기술사양 표에 있을 때만 쓴다(아래에서 확인).
          if (!t && g('related')) {
            const rel = g('related'); const [t2, c2] = splitTbl(rel);
            if (t2) { t = t2; crud = c2; tcell = tcell || rel; weak = !(/^[A-Z]_/.test(t2) || new RegExp('\\b' + t2 + '\\s*\\.\\s*[A-Za-z]', 'i').test(rel)); }
          }
          const col = g('column') === '-' ? '' : g('column');
          body.columns.push({ area, label: g('label'), column: col, table: tcell, tbl: t, crud, display: g('display'), desc: g('desc'), required: g('required'), default: '', change: '', source: g('field') || '', _weak: weak });
        }
      }
    }
    body.screenDesc = [...desc, ...extra].join('\n');

    // 3.기능사양 — 글
    const s3 = sheet(sheets, '3');
    if (s3) body.func = textLines(s3.rows, 5);

    // 4.기술사양 — 테이블 표 · 콤보 표 · 나머지 글
    const s4 = sheet(sheets, '4');
    if (s4) {
      let mode = null, hdr = null;
      for (const r of s4.rows.slice(5)) {
        const ne = nonempty(r);
        if (!ne.length) continue;
        const joined = ne.join(' ');
        // 도구 양식: 서비스 표 (serviceUid | 서비스ID | 이름 | 쓰임 | 비고) · 콤보 표 (ID | 쓰는 칸 | 이름 | serviceUid)
        if (r.includes('serviceUid') && r.includes('서비스ID')) { mode = 'svc2'; hdr = mapHeader(r, { uid: ['serviceUid'], id: ['서비스ID'], name: ['이름'], use: ['쓰임'], note: ['비고'] }); continue; }
        if (r.includes('serviceUid') && r.includes('쓰는 칸')) { mode = 'cmb2'; hdr = mapHeader(r, { id: ['ID'], usedBy: ['쓰는 칸'], name: ['이름'], uid: ['serviceUid'] }); continue; }
        if ((mode === 'svc2' || mode === 'cmb2') && hdr && ne.length >= 3 && !/^\d+\.\s/.test(ne[0])) {
          const g = (k) => at(r, hdr[k]);
          const uid = g('uid') && g('uid') !== '-' && g('uid') !== '신규' ? ` (serviceUid ${g('uid')})` : '';
          if (mode === 'svc2') body.services.push({ id: g('id'), name: g('name'), use: g('use'), note: g('note') + uid });
          else body.combos.push({ id: g('id'), usedBy: g('usedBy'), name: g('name') + uid });
          continue;
        }
        if (r.some((v) => ['Table ID', 'TABLE ID', '테이블ID'].includes(v)) || (r.some((v) => /^(Table|테이블)\s*명$/i.test(v)) && joined.includes('CRUD'))) {
          const pick = {
            name: r.find((v) => /^(Table|테이블)\s*명/i.test(v)),
            id: r.find((v) => ['TABLE ID', '테이블ID'].includes(v.toUpperCase())),
            crud: r.includes('CRUD') ? 'CRUD' : null,
            note: r.find((v) => v === '비고' || v === '설명'),
          };
          mode = 'tbl'; hdr = {};
          for (const [k, v] of Object.entries(pick)) if (v) hdr[k] = r.indexOf(v);
          continue;
        }
        if (joined.includes('Service UID') && ne.length >= 3 && r.some((v) => v.startsWith('항목'))) {
          mode = 'cmb'; hdr = mapHeader(r, { label: ['항목(한글)', '항목'], column: ['영문컬럼ID'], uid: ['Service UID'], note: ['비고'] });
          continue;
        }
        if (/^\d+-\d+\./.test(ne[0]) || (ne.length === 1 && /^\d+\.\s/.test(ne[0]))) { mode = /^\d+-\d+\.\s*(사용\s*)?테이블/.test(ne[0]) ? 'tblText' : null; body.tech.push(ne[0]); continue; }
        // 수기 양식: "4-1. 사용 테이블" 아래 글머리표 줄 — "· ORD_DTL_INSP_KO410 (메인, alias A) — 설명"
        if (mode === 'tblText') {
          const ls = ne.join('\n').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
          const hits = ls.map((x) => x.match(/^[·•\-*]\s*([A-Za-z][A-Za-z0-9]{0,5}_[A-Za-z0-9_]{2,})\b\s*(.*)$/)).filter(Boolean);
          if (hits.length) {
            const seen = new Set(body.tables.map((t) => t.id));
            for (const m of hits) { const id = m[1].toUpperCase(); if (!seen.has(id)) { body.tables.push({ id, name: '', crud: '', note: m[2].replace(/^[—\-:\s]+/, '') }); seen.add(id); } }
            body.tech.push(ne.length > 1 ? ne.join(' | ') : ne[0]);
            continue;
          }
          mode = null;
        }
        if (mode === 'tbl' && 'id' in hdr) {
          const ids = (at(r, hdr.id).match(TABLE_RE_G) || []).map((x) => x.toUpperCase());
          if (!ids.length) mode = null;
          else {
            const crud = 'crud' in hdr ? at(r, hdr.crud).toUpperCase().replace(/[^CRUD]/g, '') : '';
            for (const t of ids) body.tables.push({ id: t, name: 'name' in hdr ? at(r, hdr.name) : '', crud, note: at(r, hdr.note) });
            continue;
          }
        }
        if (mode === 'cmb' && hdr) {
          const g = (k) => at(r, hdr[k]);
          if (g('uid')) { body.combos.push({ id: 'Service UID ' + g('uid'), usedBy: `${g('label')} (${g('column')})`, name: g('note') }); continue; }
          mode = null;
        }
        body.tech.push(ne.length > 1 ? ne.join(' | ') : ne[0]);
      }
    }

    // 5.테이블 레이아웃
    const s5 = sheet(sheets, '5');
    if (s5) body.layout = textLines(s5.rows, 1);

    // 6.단위테스트
    const s6 = sheet(sheets, '6');
    if (s6) {
      let hdr = null;
      for (const r of s6.rows) {
        const ne = nonempty(r);
        if (!ne.length) continue;
        if (r.includes('순번') && r.some((v) => v.includes('테스트'))) { hdr = mapHeader(r, { step: ['테스트 절차', '절차'], data: ['테스트 데이터', '데이터'], exp: ['예상결과', '예상'] }); continue; }
        if (ne[0].startsWith('■') && hdr) break;
        if (hdr) { const g = (k) => at(r, hdr[k]); if (g('step')) body.tests.push([g('step'), g('data'), g('exp')]); }
      }
    }

    // 관련 정보 글에서만 찾은 '테이블' 은 4.기술사양 표에 있을 때만 믿는다 (ITEM_CD · PO_SEQ_NO 같은 컬럼 이름 걸러 내기)
    const known = new Set(body.tables.map((t) => t.id));
    for (const c of body.columns) { if (c._weak && !known.has(c.tbl)) { c.tbl = null; c.crud = ''; } delete c._weak; }
    // 5.테이블 레이아웃 "Table : ORD_DTL_INSP_KO410 (수리상세내역, PK: …)" → 빈 테이블 이름 채우기
    const lname = {};
    for (const l of body.layout || []) { const m = String(l).match(/^\s*Table\s*(?:ID)?\s*[:：]\s*([A-Za-z][A-Za-z0-9]{0,5}_[A-Za-z0-9_]{2,})\s*(?:\(\s*([^,()]+?)\s*[,)])?/i); if (m && m[2]) lname[m[1].toUpperCase()] = m[2]; }
    body.tables.forEach((t) => { if (!t.name && lname[t.id]) t.name = lname[t.id]; });
    // 표에 없는 테이블도 화면LO 에서 찾아 넣기
    for (const c of body.columns) if (c.tbl && !known.has(c.tbl)) { body.tables.push({ id: c.tbl, name: lname[c.tbl] || '', crud: c.crud, note: '화면LO 에서 찾음' }); known.add(c.tbl); }
    if (!body.columns.length && !body.tables.length) body.parsed = false;
    return body;
  }

  /* ---------- 본문 글만 ---------- */
  function full(sheets) {
    const parts = []; let overview = '';
    for (const s of sheets) for (const r of s.rows) {
      const v = nonempty(r);
      if (!v.length) continue;
      parts.push(v.join(' '));
      if (!overview && s.title.startsWith('1') && v[0].includes('개요') && v.length > 1) overview = v[1];
    }
    const text = parts.join('\n');
    const tables = [...new Set(text.match(TABLE_UP_G) || [])].sort();
    return { adapter: '엑셀(본문만)', parsed: false, overview, fulltext: text.slice(0, 40000),
      tables: tables.map((t) => ({ id: t, name: '', crud: '', note: '본문에서 이름만 찾음' })),
      columns: [], services: [], combos: [], func: [], tech: [], tests: [], base: [], related: [] };
  }

  /* ---------- 도구 모델 JSON ---------- */
  function splitTable(t) {
    if (!t) return [null, null];
    const m = String(t).match(/^\s*([A-Za-z0-9_]+)\s*(?:\(([CRUD/ ,]+)\))?/);
    if (!m || !/^[A-Z][A-Z0-9]{0,5}_[A-Z0-9_]{2,}$/.test(m[1])) return [null, null];
    return [m[1], (m[2] || '').replace(/ /g, '')];
  }
  function model(j) {
    const meta = j.meta || {};
    const K = ['label', 'column', 'table', 'display', 'required', 'default', 'desc', 'change', 'source'];
    const pick = (o, area) => { const c = { area }; K.forEach((k) => (c[k] = o[k] ?? '')); return c; };
    const cols = [];
    ((j.search || {}).fields || []).forEach((f) => cols.push(pick(f, '조회조건')));
    (j.sections || []).forEach((s) => {
      const g = s.grid || {};
      (g.columns || []).forEach((c) => cols.push(pick(c, s.title || g.title || '그리드')));
      (s.fields || []).forEach((c) => cols.push(pick(c, s.title || '입력')));
    });
    cols.forEach((c) => { const [t, crud] = splitTable(c.table); c.tbl = t; c.crud = crud; });
    const extra = meta.extraLines || [];
    return {
      adapter: '모델JSON v1', parsed: true,
      overview: meta.overview || '', programType: meta.programType || '', base: meta.basePrograms || [], menu: meta.menu || '',
      screenDesc: meta.screenDesc || '',
      related: extra.filter((l) => l.startsWith('연관 프로그램')),
      devStyle: extra.find((l) => l.startsWith('개발 방식')) || '',
      columns: cols,
      tables: (j.tables || []).map((t) => ({ id: t.id, name: t.name || '', crud: t.crud || '', note: t.note || '' })),
      newTables: j.newTables || [],
      services: (j.services || []).map((s) => ({ id: s.serviceId || '', name: s.name || '', use: s.use || '', note: s.note || '' })),
      combos: (j.combos || []).map((c) => ({ id: c.id || '', usedBy: c.usedBy || '', name: c.name || '' })),
      func: j.funcLines || [], tech: j.techLines || [], tests: j.testCases || [],
      history: (meta.historyRows || []).filter((r) => r.length >= 2).map((r) => [String(r[0]).replace(/\./g, '-'), r[1]]),
    };
  }

  SF.adapters = { std, full, model };
})();
