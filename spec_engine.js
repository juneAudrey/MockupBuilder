/* spec_engine.js — 사양서 폴더 읽기 · 색인 만들기
 * 모든 일이 이 브라우저 안에서 일어난다. 파일은 어디로도 보내지 않는다.
 *   폴더 접근 : File System Access API (Chrome · Edge)
 *   엑셀 읽기 : SheetJS (window.XLSX)
 *   저장      : IndexedDB (이 PC · 이 브라우저에만)
 * 양식이 바뀌면 spec_adapters.js 만 고친다.
 */
(function () {
  const SF = (window.SF = window.SF || {});
  SF.SCHEMA = 3;

  /* ---------------- IndexedDB (키-값) ---------------- */
  const DBN = 'spec-finder';
  let dbp = null;
  function idb() {
    if (!dbp) dbp = new Promise((ok, no) => {
      const r = indexedDB.open(DBN, 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => ok(r.result);
      r.onerror = () => no(r.error);
    });
    return dbp;
  }
  SF.get = async (k) => {
    try {
      const db = await idb();
      return await new Promise((ok, no) => {
        const q = db.transaction('kv').objectStore('kv').get(k);
        q.onsuccess = () => ok(q.result); q.onerror = () => no(q.error);
      });
    } catch (e) { console.warn('IndexedDB 읽기 실패', e); return undefined; }
  };
  SF.set = async (k, v) => {
    try {
      const db = await idb();
      await new Promise((ok, no) => {
        const t = db.transaction('kv', 'readwrite');
        t.objectStore('kv').put(v, k); t.oncomplete = ok; t.onerror = () => no(t.error);
      });
    } catch (e) { console.warn('IndexedDB 쓰기 실패', e); }
  };
  SF.del = async (k) => {
    try {
      const db = await idb();
      await new Promise((ok) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').delete(k); t.oncomplete = ok; t.onerror = ok; });
    } catch (e) { /* 무시 */ }
  };

  /* ---------------- 연결한 폴더 ---------------- */
  SF.supported = 'showDirectoryPicker' in window;
  SF.roots = [];   // [{id, name, handle, project, absPath}]
  SF.loadRoots = async () => { SF.roots = (await SF.get('roots')) || []; return SF.roots; };
  SF.saveRoots = () => SF.set('roots', SF.roots);
  SF.addRoot = async () => {
    const handle = await window.showDirectoryPicker({ id: 'spec-finder', mode: 'read' });
    for (const r of SF.roots) if (await r.handle.isSameEntry(handle)) return r;
    const r = { id: 'r' + Date.now().toString(36), name: handle.name, handle, project: '', absPath: '' };
    SF.roots.push(r); await SF.saveRoots(); return r;
  };
  SF.removeRoot = async (id) => { SF.roots = SF.roots.filter((r) => r.id !== id); await SF.saveRoots(); };
  SF.perm = async (h, ask) => {
    const o = { mode: 'read' };
    try {
      if ((await h.queryPermission(o)) === 'granted') return true;
      if (ask) return (await h.requestPermission(o)) === 'granted';
    } catch (e) { /* 핸들이 사라졌거나 권한 API 없음 */ }
    return false;
  };

  /* ---------------- 파일 다루기 ---------------- */
  async function listDir(dh) {
    const files = [], dirs = [];
    for await (const [name, h] of dh.entries()) (h.kind === 'directory' ? dirs : files).push({ name, h });
    const by = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    files.sort(by); dirs.sort(by);
    return { files, dirs };
  }
  async function child(dh, name, kind) {
    try { return kind === 'dir' ? await dh.getDirectoryHandle(name) : await dh.getFileHandle(name); } catch (e) { return null; }
  }
  const SKIP_DIR = /^99[.\s]/;
  async function rlist(dh, parts, out) {
    const { files, dirs } = await listDir(dh);
    files.forEach((f) => out.push({ parts: [...parts, f.name], h: f.h }));
    for (const d of dirs) { if (SKIP_DIR.test(d.name)) continue; await rlist(d.h, [...parts, d.name], out); }
    return out;
  }
  function decode(buf) {
    const u = new Uint8Array(buf);
    if (u[0] === 0xff && u[1] === 0xfe) return new TextDecoder('utf-16le').decode(u);
    if (u[0] === 0xfe && u[1] === 0xff) return new TextDecoder('utf-16be').decode(u);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(u); } catch (e) { return new TextDecoder('euc-kr').decode(u); }
  }
  SF.decode = decode;
  function hash(s) { // cyrb53
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(16) + (h1 >>> 0).toString(16);
  }

  /* 파일 위치(ref) = "<폴더id>|<상대 경로>" — 다시 열 때 핸들을 따라간다 */
  SF.fileHandle = async (ref) => {
    const [rid, rel] = ref.split('|');
    const root = SF.roots.find((r) => r.id === rid);
    if (!root) throw new Error('연결이 끊긴 폴더입니다');
    if (!(await SF.perm(root.handle, true))) throw new Error('폴더 읽기 권한이 없습니다');
    const parts = rel.split('/').slice(1); // 맨 앞은 연결한 폴더 이름
    let h = root.handle;
    for (const p of parts.slice(0, -1)) h = await h.getDirectoryHandle(p);
    return h.getFileHandle(parts[parts.length - 1]);
  };
  const urlCache = new Map();
  SF.blobUrl = async (ref, type) => {
    if (urlCache.has(ref)) return urlCache.get(ref);
    const f = await (await SF.fileHandle(ref)).getFile();
    const b = type ? new Blob([await f.arrayBuffer()], { type }) : f;
    const u = URL.createObjectURL(b); urlCache.set(ref, u); return u;
  };
  SF.fullPath = (ref) => {
    const [rid, rel] = ref.split('|');
    const root = SF.roots.find((r) => r.id === rid);
    if (!root) return rel;
    return root.absPath ? root.absPath.replace(/[\\/]+$/, '') + '\\' + rel.split('/').slice(1).join('\\') : rel;
  };

  /* ---------------- 엑셀 → 시트별 행 ---------------- */
  const p2 = (n) => String(n).padStart(2, '0');
  function cv(v) {
    if (v == null) return '';
    if (v instanceof Date) {
      if (isNaN(v)) return '';
      const d = new Date(v.getTime() + 12 * 3600e3); // SheetJS 날짜의 몇 초 어긋남 보정
      return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
    }
    return String(v).trim();
  }
  SF.readBook = (buf) => XLSX.read(buf, { type: 'array', cellDates: true, cellStyles: false, cellHTML: false });
  SF.bookSheets = (wb) => wb.SheetNames.map((n) => {
    const ws = wb.Sheets[n];
    if (!ws || !ws['!ref']) return { title: n, rows: [] };
    const e = XLSX.utils.decode_range(ws['!ref']).e;
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', blankrows: true, range: { s: { r: 0, c: 0 }, e } });
    return { title: n, rows: rows.map((r) => r.map(cv)) };
  });

  /* ---------------- 도구 사양서 (작업공간) ---------------- */
  const LINKED = new Set(['00_common_env', '02_현행자료수집', '03_Policy_Rule작성', '05_공용도구', 'node_modules']);
  const skipName = (n) => n.startsWith('.') || LINKED.has(n) || SKIP_DIR.test(n);

  async function readExcelCached(ctx, ref, fh, fn) {
    const f = await fh.getFile();
    const c = ctx.cacheOld[ref];
    if (c && c.m === f.lastModified && c.s === f.size && c.v === SF.ADAPTER_VERSION) { ctx.cacheNew[ref] = c; return c.body; }
    const sheets = SF.bookSheets(SF.readBook(await f.arrayBuffer()));
    const body = fn(sheets);
    ctx.cacheNew[ref] = { m: f.lastModified, s: f.size, v: SF.ADAPTER_VERSION, body };
    ctx.parsedNow++;
    return body;
  }

  async function toolWorkspace(ctx, dh, rel, info) {
    const project = info.customerProject || info.projectNm || ctx.parentName(rel) || ctx.root.name;
    const ws = rel.split('/').pop() || ctx.root.name;
    const { dirs: mods } = await listDir(dh);
    for (const m of mods) {
      if (skipName(m.name) || m.name.startsWith('_')) continue;
      const { dirs: progs } = await listDir(m.h);
      for (const pd of progs) {
        if (skipName(pd.name)) continue;
        const conf = await child(pd.h, '확정', 'dir');
        if (!conf) continue;
        ctx.progress(`${ws} · ${pd.name}`);
        await toolProgram(ctx, { project, ws, mod: m.name, pd, conf, rel: (rel ? rel + '/' : '') + m.name + '/' + pd.name });
      }
    }
    ctx.wsProject[ctx.parentRel(rel)] = project;
  }

  async function toolProgram(ctx, o) {
    const { project, ws, mod, pd, conf } = o;
    const name = pd.name;
    const m = name.match(/^(_ID미정|[A-Z0-9]+)_(.+)$/);
    const pid = name.startsWith('_ID미정') ? '미정' : m ? m[1] : '';
    const pname = m ? m[2] : name;
    const { files: cf } = await listDir(conf);
    const xs = cf.filter((f) => /_컨설턴트확정\.xlsx$/.test(f.name));
    if (!xs.length) return;
    const x = xs[xs.length - 1];
    const dm = x.name.match(/_excel_(\d{8})_(\d+)_컨설턴트확정/);
    const cdate = dm ? `${dm[1].slice(0, 4)}-${dm[1].slice(4, 6)}-${dm[1].slice(6)}` : '';
    const ver = dm ? +dm[2] : 1;
    const ref = (p) => ctx.root.id + '|' + ctx.relRoot + o.rel + '/' + p;
    const xref = ref('확정/' + x.name);
    // 모델 JSON (초안)
    let model = null;
    const draft = await child(pd.h, '초안', 'dir');
    if (draft) {
      const { files } = await listDir(draft);
      let best = null, bt = -1;
      for (const f of files) {
        if (!/_model\.json$/.test(f.name) || /^(ref_|base_)/.test(f.name) || f.name.includes('_base_')) continue;
        const ff = await f.h.getFile();
        if (ff.lastModified > bt) { bt = ff.lastModified; best = ff; }
      }
      if (best) model = best;
    }
    const tag = `[${project} · ${ws}] ${pname}`;
    let body;
    try {
      if (model) body = SF.adapters.model(JSON.parse(decode(await model.arrayBuffer())));
      else {
        body = await readExcelCached(ctx, xref, x.h, (sh) => {
          const b = SF.adapters.std(sh);
          return b.parsed ? b : SF.adapters.full(sh);
        });
        if (body.parsed) ctx.warn(`${tag}: 모델 JSON 없음 — 확정 엑셀을 표준 양식으로 읽음`);
      }
    } catch (e) {
      ctx.warn(`${tag}: ${e.message || e}`);
      try { body = await readExcelCached(ctx, xref + '#full', x.h, SF.adapters.full); } catch (e2) { body = { adapter: '읽기 실패', parsed: false, columns: [], tables: [] }; }
    }
    if (body.parsed && !(body.columns || []).length) ctx.warn(`${tag}: 화면 컬럼 매핑 0건`);
    if (!body.parsed) ctx.warn(`${tag}: 엑셀 본문만 색인(구조 미해석)`);
    const mock = await child(pd.h, '목업', 'dir');
    const mockups = mock ? (await listDir(mock)).files.filter((f) => /\.html?$/i.test(f.name)).map((f) => ref('목업/' + f.name)) : [];
    let memo = '';
    const mf = await child(pd.h, '_대화메모.md', 'file');
    if (mf) memo = decode(await (await mf.getFile()).arrayBuffer()).slice(0, 6000);
    ctx.specs.push({
      key: `${project}/${ws}/${mod}/${pname}`, source: '도구', project, workspace: ws, module: mod, programId: pid, name: pname,
      confirmedAt: cdate, version: ver, excel: xref, folder: ctx.root.id + '|' + ctx.relRoot + o.rel, mockups, memo, ...body,
    });
  }

  /* ---------------- 수기 사양서 폴더 (도구 밖) ----------------
   * <접두어>_<요구ID>_<명>/ 폴더 묶음. 판(_Rev01 · _V02 · _2)은 한 건으로, 팝업(<요구ID>_<n>_…)은 따로 한 건. */
  const REV_RE = /_(?:(Rev|V|rev)_?(\d*)|(\d))$/;
  const FOLDER_RE = /^[A-Za-z]+_([A-Z]{2}\d{3})_(.+)$/;
  const FILE_RE = /^[A-Za-z]+_([A-Z]{2}\d{3})(?:_(\d))?_(.+)$/;
  const TEXT_EXT = new Set(['.txt', '.md']);
  const MOD_MAP = { BA: 'BC' }; // 요구ID 앞 두 글자 → 모듈
  const GROUPS = [[/SQL/i, 'sql'], [/출력/, 'output'], [/프롬프트/, 'prompt'], [/검토|리뷰/, 'review'], [/구사양서|rev$/i, 'oldspec'], [/기존소스/, 'legacy'], [/AX소스/, 'axsrc']];
  SF.isManualFolderName = (n) => FOLDER_RE.test(n);
  const extOf = (n) => { const i = n.lastIndexOf('.'); return i < 0 ? '' : n.slice(i).toLowerCase(); };
  const stemOf = (n) => { const i = n.lastIndexOf('.'); return i < 0 ? n : n.slice(0, i); };
  const normName = (n) => n.replace(/_S_/g, '(S)').replace(/ /g, '');
  function revOf(stem) {
    const m = stem.match(REV_RE);
    if (!m) return [stem, 0, ''];
    const num = m[2] || m[3] || '0';
    return [stem.slice(0, m.index), /^\d+$/.test(num) ? +num : 0, m[0].replace(/^_/, '')];
  }

  async function manualFolder(ctx, progs, rel, project) {
    const label = rel.split('/').pop() || ctx.root.name;
    const base = ctx.relRoot + (rel ? rel + '/' : '');
    // 1) 모든 파일 목록 + 공통 양식 글 찾기
    const all = [];
    for (const d of progs) { ctx.progress(`${label} · ${d.name} 목록`); all.push({ d, files: await rlist(d.h, [], []) }); }
    const texts = new Map(); const hc = new Map();
    for (const { d, files } of all) for (const f of files) {
      if (!TEXT_EXT.has(extOf(f.parts[f.parts.length - 1]))) continue;
      const t = decode(await (await f.h.getFile()).arrayBuffer());
      const h = hash(t); texts.set(f.h, { t, h }); hc.set(h, (hc.get(h) || 0) + 1);
    }
    const common = new Set([...hc].filter(([, c]) => c >= 3).map(([h]) => h));
    const used = new Set();
    for (const { d, files } of all) {
      ctx.progress(`${label} · ${d.name}`);
      const [, req, fname] = d.name.match(FOLDER_RE);
      const R = (parts) => ctx.root.id + '|' + base + d.name + '/' + parts.join('/');
      const extras = { sql: [], output: [], prompt: [], review: [], oldspec: [], legacy: [], axsrc: [], etc: [] };
      const top = [];
      for (const f of files) {
        const fn = f.parts[f.parts.length - 1];
        if (fn.startsWith('~$')) continue;
        if (f.parts.length === 1) { top.push(f); continue; }
        const g = (GROUPS.find(([rx]) => rx.test(f.parts[0])) || [0, 'etc'])[1];
        const ext = extOf(fn);
        const file = await f.h.getFile();
        const item = { name: fn, path: R(f.parts), dir: f.parts.slice(0, -1).join('/'), ext, size: file.size };
        if (g === 'sql' || (ext === '.sql' && g !== 'legacy')) {
          item.text = (texts.get(f.h)?.t ?? decode(await file.arrayBuffer())).slice(0, 30000);
          extras.sql.push(item);
        } else if ((g === 'prompt' || g === 'review') && TEXT_EXT.has(ext)) {
          const tx = texts.get(f.h);
          if (tx && common.has(tx.h)) continue;
          item.text = (tx ? tx.t : '').slice(0, 20000);
          extras[g].push(item);
        } else extras[g].push(item);
      }
      // 사양서 엑셀 → 판 묶음
      // 이름이 <접두어>_<요구ID>_… 꼴이 아니고 표준 양식으로도 읽히지 않는 엑셀(CI · PL 출력 양식 등)은 사양서가 아니라 자료다
      const fam = new Map();
      for (const f of top) {
        const fn = f.parts[0];
        if (extOf(fn) !== '.xlsx' || fn.startsWith('~$')) continue;
        if (!FILE_RE.test(revOf(stemOf(fn))[0])) {
          let ok = false;
          try { ok = !!(await readExcelCached(ctx, R([fn]), f.h, SF.adapters.std)).parsed; } catch (e) { ok = false; }
          if (!ok) {
            const file = await f.h.getFile();
            extras[/출력|양식/.test(fn) ? 'output' : 'etc'].push({ name: fn, path: R([fn]), dir: '', ext: '.xlsx', size: file.size });
            continue;
          }
        }
        let [b, rv, tag] = revOf(stemOf(fn));
        if (!FILE_RE.test(b)) {
          // 사양서도구가 만든 이름(ID미정_<명>_excel_<yyyymmdd>_<n>_컨설턴트확정) 등 — 이 폴더의 프로그램 그 자체다.
          // 폴더 이름으로 묶어 판(날짜 · 번호)으로 쌓는다. '.확정중' 파일은 같은 판의 확정본보다 뒤로 둔다.
          const st = stemOf(fn), tm = st.match(/_excel_(\d{8})_(\d+)/);
          b = d.name; rv = tm ? +tm[1] * 1000 + +tm[2] - (/\.확정중$/.test(st) ? 0.5 : 0) : 0; tag = tm ? `${tm[1]}_${tm[2]}${/\.확정중$/.test(st) ? ' 확정중' : ''}` : st;
        }
        const ff = await f.h.getFile();
        if (!fam.has(b)) fam.set(b, []);
        fam.get(b).push({ rv, mt: ff.lastModified, tag, f, name: fn });
      }
      const htmls = top.filter((f) => /\.html?$/i.test(f.parts[0]));
      const nk = (s) => normName(revOf(s)[0]);
      let fams = [...fam.entries()].sort((a, b) => {
        const sa = !!(FILE_RE.exec(a[0]) || [])[2], sb = !!(FILE_RE.exec(b[0]) || [])[2];
        return sa !== sb ? (sa ? 1 : -1) : a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
      });
      if (!fams.length && (Object.values(extras).some((a) => a.length) || htmls.length)) fams = [[d.name, []]];
      const famKeys = new Set(fams.map(([b]) => nk(b)));
      const byFam = new Map();
      for (const h of htmls) {
        const k0 = nk(stemOf(h.parts[0])); const k = famKeys.has(k0) ? k0 : '__main__';
        if (!byFam.has(k)) byFam.set(k, []); byFam.get(k).push(h);
      }
      let mainKey = null, mainName = '';
      for (const [b, versions] of fams) {
        versions.sort((a, c) => a.rv - c.rv || a.mt - c.mt);
        const m = FILE_RE.exec(b);
        const sub = m ? m[2] : null;
        const pname = m ? m[3] : fname;
        // 번호 없이 '<본 화면명>_<팝업명>' 으로만 붙은 파일(예: 구매요청등록(S)_구매요청번호(S))도 본 화면의 팝업이다
        const child = !sub && mainKey !== null && !!mainName && normName(pname).startsWith(mainName + '_');
        const cur = versions.length ? versions[versions.length - 1] : null;
        let body = { adapter: '자료만', parsed: false, columns: [], tables: [] };
        if (cur) {
          try { body = await readExcelCached(ctx, R([cur.name]), cur.f.h, SF.adapters.std); }
          catch (e) { ctx.warn(`[${project} · ${label}] ${cur.name}: 읽기 실패 ${e.message || e}`); body = { adapter: '읽기 실패', parsed: false, columns: [], tables: [] }; }
          if (!body.parsed) ctx.warn(`[${project} · ${label}] ${cur.name}: 표준 양식으로 읽지 못함`);
          else if (!body.columns.length) ctx.warn(`[${project} · ${label}] ${pname}: 화면 컬럼 0건`);
        }
        let key = `${project}/${label}/${req}${sub ? '-' + sub : child ? '~' + normName(pname) : ''}`;
        if (used.has(key)) key += '~' + d.name;
        used.add(key);
        const isMain = !sub && !child;
        const own = isMain || !cur; // 엑셀 없이 자료만 있는 폴더(예: <요구ID>_2_…출력 폴더)는 그 자료를 직접 가진다
        const mock = [...(byFam.get(nk(b)) || [])].sort((x, y) => revOf(stemOf(y.parts[0]))[1] - revOf(stemOf(x.parts[0]))[1]);
        if (own && mainKey === null) mock.push(...(byFam.get('__main__') || []));
        if (isMain && mainKey === null) { mainKey = key; mainName = normName(pname); }
        const dates = (body.history || []).map((h) => h[0]).sort();
        ctx.specs.push({
          key, project, workspace: label, source: '수기',
          module: MOD_MAP[req.slice(0, 2)] || req.slice(0, 2), reqId: req + (sub ? '-' + sub : ''), programId: body.programIdText || '미정',
          name: normName(pname), confirmedAt: dates.length ? dates[dates.length - 1] : '', version: versions.length,
          excel: cur ? R([cur.name]) : '',
          revisions: [...versions].reverse().map((v) => ({ label: v.tag || '최초', path: R([v.name]), name: v.name })),
          folder: ctx.root.id + '|' + base + d.name, mockups: mock.map((h) => R(h.parts)),
          parent: isMain ? null : mainKey,
          sql: own ? extras.sql : [], outputs: own ? extras.output : [], prompts: own ? extras.prompt : [], reviews: own ? extras.review : [],
          files: own ? ['oldspec', 'legacy', 'axsrc', 'etc'].flatMap((g) => extras[g].map((f) => ({ ...f, group: g }))) : [],
          memo: '', ...body,
        });
      }
    }
  }

  /* ---------------- 폴더 훑기 ---------------- */
  async function walk(ctx, dh, rel, depth) {
    const info = await child(dh, '_프로젝트정보.json', 'file');
    if (info) {
      let j = {};
      try { j = JSON.parse(decode(await (await info.getFile()).arrayBuffer())); } catch (e) { ctx.warn(`${rel || ctx.root.name}: _프로젝트정보.json 을 읽지 못함`); }
      await toolWorkspace(ctx, dh, rel, j);
      return;
    }
    const { dirs } = await listDir(dh);
    const progs = dirs.filter((d) => FOLDER_RE.test(d.name));
    if (progs.length) { ctx.manual.push({ progs, rel }); return; }
    if (depth >= 4) return;
    for (const d of dirs) {
      if (skipName(d.name) || d.name.startsWith('_')) continue;
      await walk(ctx, d.h, rel ? rel + '/' + d.name : d.name, depth + 1);
    }
  }

  const MATERIALS = ['sql', 'outputs', 'prompts', 'reviews', 'files'];
  function linkSame(specs) {
    const nk = (s) => s.project + '\u0001' + s.name.replace(/ /g, '');
    // 같은 작업공간 안에 내용이 똑같은 사본 폴더(예: …공급처지정등록 · …공급처지정등록(S))는 한 건으로 합치고 사본 폴더는 기록만 남긴다
    const fpSeen = new Map();
    for (let i = 0; i < specs.length; i++) {
      const s = specs[i];
      if (s.source !== '수기' || !s.excel || !s.parsed) continue;
      const fp = JSON.stringify([s.project, s.workspace, s.reqId, s.name, s.columns, s.tables, s.overview, s.func, s.tech, s.history]);
      const first = fpSeen.get(fp);
      if (!first) { fpSeen.set(fp, s); continue; }
      (first.folders = first.folders || []).push({ label: '내용이 같은 사본 폴더', path: s.folder });
      specs.forEach((o) => { if (o.parent === s.key) o.parent = first.key; });
      specs.splice(i--, 1);
    }
    const tool = new Map(specs.filter((s) => s.source === '도구').map((s) => [nk(s), s]));
    const keep = [];
    for (const s of specs) {
      if (s.source === '수기' && s.adapter === '자료만' && tool.has(nk(s))) {
        const t = tool.get(nk(s));
        for (const k of MATERIALS) t[k] = (t[k] || []).concat((s[k] || []).map((x) => ({ ...x, origin: s.workspace })));
        t.mockups = (t.mockups || []).concat(s.mockups || []);
        (t.folders = t.folders || []).push({ label: s.workspace, path: s.folder });
        t.reqId = t.reqId || s.reqId;
        continue;
      }
      if (s.source === '수기' && s.adapter === '자료만' && !MATERIALS.some((k) => (s[k] || []).length) && !(s.mockups || []).length) continue;
      keep.push(s);
    }
    specs.length = 0; specs.push(...keep);
    const main = new Map();
    specs.forEach((s) => { if (s.reqId && !s.parent && !s.name.includes('_출력물')) main.set(s.project + '|' + s.reqId, s.key); });
    specs.forEach((s) => { if (s.name.includes('_출력물') && !s.parent) s.parent = main.get(s.project + '|' + s.reqId) || null; });
    // 다른 폴더에 있는 <요구ID>_<n>_… (예: SD003_2 CI 출력) 은 같은 작업공간의 본 화면(<요구ID>)에 붙인다
    const mainW = new Map(); specs.forEach((s) => { if (s.reqId && !s.parent && !/-\d+$/.test(s.reqId) && !s.name.includes('_출력물')) mainW.set(s.project + '|' + s.workspace + '|' + s.reqId, s.key); });
    specs.forEach((s) => { if (!s.parent && /-\d+$/.test(s.reqId || '')) s.parent = mainW.get(s.project + '|' + s.workspace + '|' + s.reqId.replace(/-\d+$/, '')) || null; });
    const groups = new Map(); specs.forEach((s) => { if (!groups.has(nk(s))) groups.set(nk(s), []); groups.get(nk(s)).push(s.key); });
    const req = new Map(); specs.forEach((s) => { if (s.reqId) req.set(nk(s), s.reqId); });
    specs.forEach((s) => { s.same = groups.get(nk(s)).filter((k) => k !== s.key); if (!s.reqId && req.get(nk(s))) s.reqId = req.get(nk(s)); });
  }

  /* 전체 동기화: 연결한 폴더를 모두 훑어 색인을 새로 만든다. 바뀌지 않은 엑셀은 지난 결과를 다시 쓴다. */
  SF.sync = async (onProgress) => {
    const specs = [], warnings = [];
    const cacheOld = (await SF.get('xcache')) || {};
    const cacheNew = {};
    let parsedNow = 0;
    const skipped = [];
    for (const root of SF.roots) {
      if (!(await SF.perm(root.handle, false))) { skipped.push(root.name); continue; }
      const ctx = {
        root, relRoot: root.name + '/', specs, cacheOld, cacheNew, manual: [], wsProject: {},
        get parsedNow() { return parsedNow; }, set parsedNow(v) { parsedNow = v; },
        warn: (w) => warnings.push(w),
        progress: (msg) => onProgress && onProgress(`${root.name} › ${msg}`, specs.length),
        parentRel: (rel) => rel.split('/').slice(0, -1).join('/'),
        parentName: (rel) => { const p = rel.split('/'); return p.length > 1 ? p[p.length - 2] : (rel ? root.name : ''); },
      };
      try {
        await walk(ctx, root.handle, '', 0);
        for (const m of ctx.manual) {
          const pr = ctx.parentRel(m.rel);
          // 프로젝트 이름: 같은 폴더나 위 폴더에 있는 작업공간의 고객 프로젝트 → 폴더 설정에 적은 이름
          //               → (깊이 2 이상이면) 연결한 폴더 바로 아래 폴더 이름 → 연결한 폴더 이름
          let project = '';
          for (let p = pr; ; p = ctx.parentRel(p)) { if (ctx.wsProject[p] !== undefined) { project = ctx.wsProject[p]; break; } if (!p) break; }
          const segs = m.rel.split('/');
          project = project || root.project || (segs.length >= 2 ? segs[0] : '') || root.name;
          await manualFolder(ctx, m.progs, m.rel, project);
        }
      } catch (e) {
        warnings.push(`${root.name}: 읽다가 멈춤 — ${e.message || e}`);
      }
    }
    linkSame(specs);
    const index = { schema: SF.SCHEMA, builtAt: new Date().toISOString(), specs, warnings, skipped, parsedNow };
    await SF.set('index', index);
    await SF.set('xcache', cacheNew);
    return index;
  };
})();
