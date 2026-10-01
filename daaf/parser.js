/* Daaf Wave 파서
 * RESOURCE_JSON / RESOURCE_JS / RESOURCE_DTO / RESOURCE_WF / REPORT_JSON 텍스트에서
 *  - serviceUid (숫자, 공통 연결키)
 *  - serviceId  (문자 라벨)
 *  - /wf/{uid}/execute 직접호출
 *  - RESOURCE_WF 내 참조 테이블(SQL FROM/JOIN/INTO/UPDATE)
 * 를 추출한다.
 * 브라우저/Node 양쪽에서 로드 가능하도록 UMD 형태.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WaveParser = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  function textOf(row, cols) {
    return cols.map(c => (row && row[c] != null) ? String(row[c]) : '').join('\n');
  }

  // serviceUid + serviceId 쌍 추출 (근접 매칭)
  function extractServiceRefs(text) {
    const refs = {}; // uid -> {uid, id}
    if (!text) return [];

    // 1) "serviceId":"X" ... "serviceUid":N  (JSON 프로퍼티, 순서 무관하게 근접 스캔)
    const idRe = /"serviceId"\s*:\s*"([^"]+)"/g;
    const uidRe = /"serviceUid"\s*:\s*(\d+)/g;

    // 개별 수집
    const ids = [];
    let m;
    while ((m = idRe.exec(text)) !== null) ids.push({ v: m[1], pos: m.index });
    const uids = [];
    while ((m = uidRe.exec(text)) !== null) uids.push({ v: m[1], pos: m.index });

    // uid 기준으로 가장 가까운 id 매칭
    uids.forEach(u => {
      let best = null, bestD = Infinity;
      ids.forEach(i => {
        const d = Math.abs(i.pos - u.pos);
        if (d < bestD) { bestD = d; best = i; }
      });
      // 근접 임계 (같은 컴포넌트 블록 내로 제한)
      const label = (best && bestD < 4000) ? best.v : null;
      addRef(refs, u.v, label);
    });

    // 2) /wf/{uid}/execute  직접호출 (id 없음)
    const execRe = /\/wf\/(\d+)\/execute/g;
    while ((m = execRe.exec(text)) !== null) addRef(refs, m[1], null);

    // 3) serviceId 만 있고 uid 없는 경우도 노드로 (uid=null, id 로 후속 조회)
    ids.forEach(i => {
      const hasUidNear = uids.some(u => Math.abs(u.pos - i.pos) < 400);
      if (!hasUidNear) addRef(refs, null, i.v);
    });

    return Object.keys(refs).map(k => refs[k]);
  }

  function addRef(refs, uid, id) {
    const key = uid != null ? ('u:' + uid) : ('s:' + id);
    if (!refs[key]) refs[key] = { uid: uid != null ? String(uid) : null, id: id || null };
    else if (id && !refs[key].id) refs[key].id = id;
  }

  // UI/Mo 리소스에서 "어떤 버튼/컴포넌트의 어떤 이벤트가 무엇을 실행하는지" 추출
  // DaaF UI 컴포넌트는 eventType 으로 동작을 구분:
  //   BTN_WORKFLOW  → serviceId/serviceUid 워크플로우 실행
  //   BTN_OPEN_POPUP→ programId 팝업 화면 열기
  //   BTN_USR_EVENT → 사용자 스크립트(직접 서비스 호출은 스크립트 내 별도 처리)
  function extractTriggers(text) {
    if (!text) return [];
    const out = [];
    const evRe = /"eventType"\s*:\s*"(BTN_WORKFLOW|BTN_OPEN_POPUP|BTN_USR_EVENT)"/g;
    let m;
    while ((m = evRe.exec(text)) !== null) {
      const ev = m[1];
      // 컴포넌트 블록 근처에서 관련 필드 탐색. beforeSubmit/afterSubmit 등에 긴 인라인 JS가
      // 들어있는 버튼(예: BTN_OPEN_POPUP 팝업 저장 후처리 스크립트)은 그 필드(programId 등)와
      // eventType 사이 거리가 수백 자를 쉽게 넘는다 — 예전엔 앞 400자만 봐서 이런 버튼은
      // programId 를 못 찾고 트리거 자체가 통째로 스킵됐다(파도타기에서 그 팝업 UI 가
      // 아예 빠지는 원인). 앞쪽을 훨씬 넉넉히 보되, 넓힌 창 안에 같은 필드가 여럿 있을 수
      // 있으니(다른 컴포넌트 것까지 걸릴 위험) eventType 에 가장 가까운(=마지막) 매치를 쓴다.
      const win = text.slice(Math.max(0, m.index - 2500), m.index + 400);
      const near = (re) => {
        const gre = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
        let last = null, mm;
        while ((mm = gre.exec(win)) !== null) last = mm;
        return last ? last[1] : null;
      };
      const label = near(/"label"\s*:\s*"([^"]+)"/) || near(/"name"\s*:\s*"([^"]+)"/);
      const trig = { event: ev, label: label || '' };
      if (ev === 'BTN_WORKFLOW') {
        trig.serviceId = near(/"serviceId"\s*:\s*"([^"]+)"/);
        trig.serviceUid = near(/"serviceUid"\s*:\s*(\d+)/);
        trig.serviceName = near(/"serviceName"\s*:\s*"([^"]+)"/);
        if (!trig.serviceId && !trig.serviceUid) continue; // 대상 없으면 스킵
      } else if (ev === 'BTN_OPEN_POPUP') {
        trig.programId = near(/"programId"\s*:\s*"([^"]+)"/);
        if (!trig.programId) continue;
      }
      out.push(trig);
    }
    return out;
  }

  // 공통코드(MAJOR_CD/MINOR_CD) 참조 추출
  // - UI 콤보박스 정의: "majorCd":"SYS001" / "minorCd":"..."
  // - WF/Rp SQL 상수:   MAJOR_CD = 'I0001' / MINOR_CD = 'xxx'
  function extractCodes(text) {
    if (!text) return { major: [], minor: [] };
    const major = new Set(), minor = new Set();
    let m;
    const majJson = /"majorCd"\s*:\s*"([^"]+)"/g;
    while ((m = majJson.exec(text)) !== null) if (m[1]) major.add(m[1]);
    const minJson = /"minorCd"\s*:\s*"([^"]+)"/g;
    while ((m = minJson.exec(text)) !== null) if (m[1] && !/^(코드|명칭|요청자|minorCd|minorNm)/.test(m[1])) minor.add(m[1]);
    const majSql = /\bMAJOR_CD\s*=\s*'([^']+)'/g;
    while ((m = majSql.exec(text)) !== null) major.add(m[1]);
    const minSql = /\bMINOR_CD\s*=\s*'([^']+)'/g;
    while ((m = minSql.exec(text)) !== null) minor.add(m[1]);
    return { major: [...major], minor: [...minor] };
  }

  // 리소스에서 리포트(Rp) 참조 추출.
  // DaaF 화면/워크플로우가 리포트를 여는 방식은 여러 형태라, 흔한 키들을 폭넓게 스캔한다:
  //   "reportProgramId":"XXXRP0001" / "reportId":"..." / "reportPgmId":"..." / "rptProgramId":"..."
  //   "reportUid":123 (숫자)
  //   그리고 프로그램ID 명명규칙상 리포트로 보이는 값(...RP #### 패턴)도 후보로 잡는다.
  function extractReportRefs(text) {
    if (!text) return [];
    const out = {};
    const add = (id, uid) => {
      if (!id && !uid) return;
      const key = id ? ('i:' + id) : ('u:' + uid);
      if (!out[key]) out[key] = { id: id || null, uid: uid != null ? String(uid) : null };
    };
    let m;
    const idRe = /"(?:reportProgramId|reportPgmId|reportId|rptProgramId|rptId|reportProgramID)"\s*:\s*"([^"]+)"/g;
    while ((m = idRe.exec(text)) !== null) if (m[1]) add(m[1], null);
    const uidRe = /"(?:reportUid|reportProgramUid|rptUid)"\s*:\s*(\d+)/g;
    while ((m = uidRe.exec(text)) !== null) add(null, m[1]);
    return Object.keys(out).map(k => out[k]);
  }

  // 프로그램ID 가 리포트 명명규칙( ...RP + 숫자 )으로 보이는지
  function looksLikeReportId(pgmId) {
    return !!pgmId && /RP[A-Z]*\d{2,}$/i.test(pgmId);
  }

  // RESOURCE_WF 안에서 참조 테이블명 추출 (leaf)
  function extractTables(text) {
    if (!text) return [];
    const tables = new Set();

    // 3-1) DaaF 엔티티 노드: "tableNm":"XXX" / "columnNm" 존재
    const tblRe = /"tableNm"\s*:\s*"([^"]+)"/g;
    let m;
    while ((m = tblRe.exec(text)) !== null) { if (m[1]) tables.add(m[1]); }

    // 3-2) 원시 SQL 조각: FROM/JOIN/INTO/UPDATE 뒤 식별자
    //     JSON 이스케이프( \" , \n ) 안에 SQL 이 들어있는 경우 대비해 unescape 후 스캔
    let sql = text.replace(/\\r|\\n/g, ' ').replace(/\\"/g, '"');
    const sqlRe = /\b(?:FROM|JOIN|INTO|UPDATE)\s+([A-Za-z_][A-Za-z0-9_]*)/gi;
    while ((m = sqlRe.exec(sql)) !== null) {
      const t = m[1];
      // 별칭/서브쿼리/함수 제외 대략 필터
      if (t && !/^(SELECT|dual|DUAL)$/i.test(t)) tables.add(t);
    }
    return [...tables];
  }

  // RESOURCE_WF/JSON 안에서 SQL 쿼리 문자열 추출
  // DaaF 워크플로우는 보통 "query","sql","sqlText","queryText","selectQuery" 등의 필드에 SQL 을 담는다.
  function extractQueries(text) {
    if (!text) return [];
    const out = [];
    const seen = new Set();
    // JSON 필드에서 SQL 후보 추출: "key":"...sql..."
    // DaaF Workflow JSON은 공통 "query" 외에, DB 방언별로 "mssqlQuery"/"mysqlQuery"/"oracleQuery"
    // 필드에 SQL을 담는 경우가 매우 흔하다(daaf-ansi-sql-checker 스킬이 다루는 바로 그 필드들).
    // 이 방언별 키가 목록에 없으면 그런 워크플로우는 실제로 쿼리가 있는데도 "쿼리 없음"으로
    // 잘못 보이게 된다 — 실 데이터로 확인해보니 WF의 상당수(약 40%)가 mssqlQuery 를 쓰고 있었음.
    const keyRe = /"(query|mssqlQuery|mysqlQuery|oracleQuery|postgresQuery|sql|sqlText|queryText|selectQuery|sqlStatement|statement|nativeQuery|dmlQuery|mainQuery)"\s*:\s*"((?:[^"\\]|\\.)*)"/gi;
    let m;
    while ((m = keyRe.exec(text)) !== null) {
      let raw = m[2];
      if (!raw) continue;
      // JSON 이스케이프 복원
      let sql = raw
        .replace(/\\r\\n|\\n|\\r/g, '\n')
        .replace(/\\t/g, '  ')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\')
        .trim();
      // SQL 처럼 보이는 것만 (SELECT/INSERT/UPDATE/DELETE/WITH/MERGE 로 시작 또는 포함)
      if (sql.length < 10) continue;
      if (!/\b(SELECT|INSERT|UPDATE|DELETE|WITH|MERGE|EXEC)\b/i.test(sql)) continue;
      const key = sql.replace(/\s+/g, ' ').slice(0, 120);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(sql);
    }
    return out;
  }

  // ---- 초기값(디폴트) 추적 ----
  // 화면 컨트롤(라디오/콤보/입력 등)이 실제 운영에서 처음 뜰 때 어떤 값으로 채워지는지는 3가지 경로 중 하나다.
  //   A) 정적 default: propertyValue.default 에 하드코딩된 값 — 그대로 노출하면 끝(추적 불필요)
  //   B) 리터럴 할당: onLoad(또는 로드시 자동클릭되는 버튼)의 usrEventFn 안에서
  //      Form.val('id', '문자열' | moment()... | variable.globalVariable.xxx) 처럼 직접 대입
  //   C) 스크립트→WF→테이블 체인: 로컬 변수가 $pageObjects[...]() 헬퍼 호출의 결과이고, 그 헬퍼 안에서
  //      '/wf/{uid}/execute' 를 호출하는 경우 — 실제 초기값은 그 WF 가 실행 시점에 테이블에서 읽어오는 값이다
  //      (예: B_CONFIGURATION_V.REFERENCE='Y' 로 마킹된 기준코드).
  // 실행하지 않고 텍스트 패턴으로 정적 분석하는 "추정" 기능이라 100% 정확을 보장하진 않는다.

  // text[openIdx] 가 openCh 라고 가정하고, 짝이 맞는 closeCh 위치까지의 부분 문자열을 반환.
  function sliceBalanced(text, openIdx, openCh, closeCh) {
    if (!text || text[openIdx] !== openCh) return null;
    let depth = 0;
    for (let i = openIdx; i < text.length; i++) {
      const c = text[i];
      if (c === openCh) depth++;
      else if (c === closeCh) { depth--; if (depth === 0) return text.slice(openIdx, i + 1); }
    }
    return null;
  }

  function computeInitValueMap(resourceJson) {
    const map = {};
    let obj;
    try { obj = JSON.parse(resourceJson); } catch (e) { return map; }
    const page = obj && obj.page;
    if (!page) return map;
    const onLoad = (page.propertyValue && page.propertyValue.onLoad) || '';

    // 1) 화면 전체에서 버튼(usrEventFn 보유), default 를 가진 입력 컨트롤, (정적)라디오의 값→라벨
    //    매핑을 한 번에 수집한다. 라디오는 동적 콤보(옵션이 런타임 서비스콜로 채워짐)와 달리
    //    JSON 안에 실제 {value,label} 이 들어있어 코드값을 사람이 읽는 라벨로 바꿔 보여줄 수 있다.
    const buttonScripts = {};  // btnId -> usrEventFn 텍스트
    const compDefaults = {};   // compId -> 정적 default 값
    const compOptionLabels = {}; // compId -> {value: label} (정적 라디오만; 동적 콤보는 채우지 않음)
    (function walk(o) {
      if (!o || typeof o !== 'object') return;
      if (Array.isArray(o)) { o.forEach(walk); return; }
      const pv = o.propertyValue || {};
      if (pv.id && typeof pv.usrEventFn === 'string' && pv.usrEventFn.trim()) buttonScripts[pv.id] = pv.usrEventFn;
      if (pv.id && pv.default !== undefined && pv.default !== null && pv.default !== '') compDefaults[pv.id] = pv.default;
      if (pv.id && Array.isArray(pv.radioItems) && pv.radioItems.some(r => r && r.value != null && r.label != null)) {
        const lbl = {};
        pv.radioItems.forEach(r => { if (r && r.value != null && r.label != null) lbl[r.value] = r.label; });
        compOptionLabels[pv.id] = lbl;
      }
      Object.keys(o).forEach(k => walk(o[k]));
    })(page);

    // 2) onLoad 에서 로드시 자동 클릭되는 버튼 id: page.$("#xxx").click() / page.$("#xxx, #yyy").click()
    const autoClickIds = new Set();
    const clickRe = /page\.\$\(\s*["']([^"']+)["']\s*\)\s*\.click\(\)/g;
    let cm;
    while ((cm = clickRe.exec(onLoad)) !== null) {
      cm[1].split(',').forEach(sel => { const id = sel.trim().replace(/^#/, ''); if (id) autoClickIds.add(id); });
    }

    // 3) "로드 시점에 실행되는 스크립트" = onLoad 본문 + 자동클릭 버튼들의 usrEventFn
    const loadScripts = [{ label: 'onLoad', text: onLoad }];
    autoClickIds.forEach(id => { if (buttonScripts[id]) loadScripts.push({ label: '버튼(' + id + ')', text: buttonScripts[id] }); });

    // 4) $pageObjects["name"] = (args) => { ... } 헬퍼 정의를 onLoad+모든 버튼 스크립트에서 수집
    //    (헬퍼는 보통 onLoad 에 정의되고 다른 버튼 스크립트에서 호출되는 경우가 흔해 전체를 뒤진다)
    const allScriptTexts = [onLoad].concat(Object.keys(buttonScripts).map(k => buttonScripts[k]));
    const helperBodies = {};
    const helperParams = {}; // 헬퍼명 -> 선언된 매개변수명 배열(예: ['majorCd']) — 호출부 리터럴 치환용
    const helperDefRe = /\$pageObjects\[\s*["'](\w+)["']\s*\]\s*=\s*\(([^)]*)\)\s*=>\s*\{/g;
    allScriptTexts.forEach(txt => {
      if (!txt) return;
      helperDefRe.lastIndex = 0;
      let hm;
      while ((hm = helperDefRe.exec(txt)) !== null) {
        const name = hm[1];
        const braceIdx = txt.indexOf('{', hm.index);
        if (braceIdx === -1) continue;
        const body = sliceBalanced(txt, braceIdx, '{', '}');
        if (body && !helperBodies[name]) {
          helperBodies[name] = body;
          helperParams[name] = (hm[2] || '').split(',').map(s => s.trim()).filter(Boolean);
        }
      }
    });

    // 헬퍼 본문에서 WF 직접호출(UID)과 대략적인 요청 파라미터 리터럴을 추정 추출.
    // callArgsText 가 주어지면(호출부에서 넘긴 실제 인자, 예: 'M2104') 헬퍼 내부의 매개변수명(예: majorCd)을
    // 실제 넘어온 값으로 치환해서 보여준다 — 그래야 "majorCd" 가 아니라 "M2104"(어떤 코드그룹인지)가 보인다.
    function analyzeHelper(name, callArgsText) {
      const body = helperBodies[name];
      if (!body) return { helperName: name };
      const wfm = /\/wf\/(\d+)\/execute/.exec(body);
      let paramText = null;
      const pm = /(?:let|var|const)\s+param\s*=\s*(\{)/.exec(body);
      if (pm) {
        const sliced = sliceBalanced(body, pm.index + pm[0].length - 1, '{', '}');
        if (sliced) paramText = sliced.replace(/\s+/g, ' ').trim();
      }
      if (paramText && callArgsText != null) {
        const declaredParams = helperParams[name] || [];
        const callArgs = splitTopLevel(callArgsText).map(s => s.trim());
        declaredParams.forEach((pName, idx) => {
          const argLit = callArgs[idx];
          if (!pName || argLit === undefined) return;
          // ":  paramName" 형태(오브젝트 리터럴의 값 자리)만 치환 — 키 이름(따옴표로 감싸진 'paramName')은 건드리지 않는다.
          const re = new RegExp('(:\\s*)' + pName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g');
          paramText = paramText.replace(re, '$1' + argLit);
        });
      }
      // paramText(치환 완료된 오브젝트 리터럴 문자열)에서 '키':값 쌍을 구조화해 뽑아둔다 — app.js 가
      // 문자열을 다시 파싱하지 않고 info.paramValues.majorCd 처럼 바로 값을 꺼내 실제 DB 조회에 쓸 수 있게.
      let paramValues = null;
      if (paramText) {
        paramValues = {};
        const kvRe = /['"](\w+)['"]\s*:\s*('([^']*)'|"([^"]*)"|[\w.]+)/g;
        let km;
        while ((km = kvRe.exec(paramText)) !== null) {
          let v = km[2];
          if (v.length >= 2 && (v[0] === "'" || v[0] === '"') && v[v.length - 1] === v[0]) v = v.slice(1, -1);
          paramValues[km[1]] = v;
        }
      }
      return { helperName: name, wfUid: wfm ? wfm[1] : null, paramText, paramValues };
    }

    // "a, b(c,d), 'e,f'" 처럼 괄호/따옴표 안의 콤마는 무시하고 최상위 콤마에서만 나눈다(간단한 함수 인자 분리용).
    function splitTopLevel(text) {
      const out = [];
      let depth = 0, cur = '', inStr = null;
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inStr) { cur += c; if (c === inStr && text[i - 1] !== '\\') inStr = null; continue; }
        if (c === '"' || c === "'" || c === '`') { inStr = c; cur += c; continue; }
        if (c === '(' || c === '[' || c === '{') { depth++; cur += c; continue; }
        if (c === ')' || c === ']' || c === '}') { depth--; cur += c; continue; }
        if (c === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
        cur += c;
      }
      if (cur.trim() !== '') out.push(cur);
      return out;
    }

    // 5) 로드시점 스크립트마다 필드 대입(.val('id', 표현식)) 을 찾아 리터럴/체인으로 분류
    loadScripts.forEach(scr => {
      const txt = scr.text || '';
      if (!txt) return;
      const localVarMap = {}; // 로컬변수명 -> {helperName, argsText} (const x = $pageObjects["h"]('M2104') 형태)
      const localRe = /\b(?:const|let|var)\s+(\w+)\s*=\s*\$pageObjects\[\s*["'](\w+)["']\s*\]\(([^)]*)\)/g;
      let lm;
      while ((lm = localRe.exec(txt)) !== null) localVarMap[lm[1]] = { helperName: lm[2], argsText: lm[3] };

      const valRe = /\.val\(\s*['"](\w+)['"]\s*,\s*([^;]+?)\)\s*;/g;
      let vm;
      while ((vm = valRe.exec(txt)) !== null) {
        const fieldId = vm[1];
        const expr = vm[2].trim();
        let info = null;
        const varMatch = /^(\w+)((?:\??\.\w+)*)$/.exec(expr);
        if (varMatch && localVarMap[varMatch[1]]) {
          const ref = localVarMap[varMatch[1]];
          info = Object.assign({ kind: 'chain', expr, propPath: varMatch[2] || '', script: scr.label },
            analyzeHelper(ref.helperName, ref.argsText));
        } else {
          const inlineHelper = /\$pageObjects\[\s*["'](\w+)["']\s*\]\(([^)]*)\)/.exec(expr);
          if (inlineHelper) {
            info = Object.assign({ kind: 'chain', expr, script: scr.label }, analyzeHelper(inlineHelper[1], inlineHelper[2]));
          } else {
            info = { kind: 'literal', expr, script: scr.label };
          }
        }
        const arr = map[fieldId] || (map[fieldId] = []);
        if (!arr.some(x => x.expr === info.expr && x.script === info.script)) arr.push(info);
      }
    });

    // 6) 정적 default: 스크립트가 이미 그 필드를 다루면 "런타임에 재설정됨" 부기 정보로만 덧붙이고,
    //    스크립트가 손대지 않는 필드만 단독 static 항목으로 추가한다.
    Object.keys(compDefaults).forEach(id => {
      const d = compDefaults[id];
      if (map[id] && map[id].length) map[id].forEach(x => { x.staticDefault = d; });
      else map[id] = [{ kind: 'static', expr: JSON.stringify(d) }];
    });

    // 7) 정적 라디오의 값→라벨 매핑을 각 항목에 붙여둔다 — 상세패널에서 "A" 대신 "자동"을 함께 보여주기 위함.
    //    (동적 콤보는 compOptionLabels 에 애초에 안 들어있으므로 여기선 값을 못 붙이고 코드만 노출된다.)
    Object.keys(compOptionLabels).forEach(id => {
      if (map[id]) map[id].forEach(x => { x.optionLabels = compOptionLabels[id]; });
    });

    return map;
  }

  // ---- 디자인 미리보기: RESOURCE_JSON 컴포넌트 트리 → HTML ----
  // 대상 화면의 정확한 배치(form/row/column/component)를 담은 RESOURCE_JSON 을
  // 실제 화면 구조에 가까운 HTML 로 변환한다. 라벨은 formLabel 우선, langMap 보조.
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // RESOURCE_HTML 에서 data-lang → 표시텍스트 매핑 추출 (라벨 다국어)
  // label/button/span 등 어떤 태그든 data-lang 을 가진 요소의 텍스트를 매핑한다.
  function extractLangMap(html) {
    const map = {};
    if (!html) return map;
    // data-lang="key" ...>텍스트</태그>  (label/button/span/a/div 등 공통)
    const re = /data-lang=['"]([^'"]+)['"][^>]*>([^<]+)<\//g;
    let m;
    while ((m = re.exec(html)) !== null) {
      const key = m[1], val = (m[2] || '').trim();
      if (val && !map[key]) map[key] = val;
    }
    return map;
  }

  // 그리드 ↔ WF 연결 맵(그리드 1개에 여러 WF 가 연결될 수 있음, 다중값).
  // DaaF 구조상 그리드의 조회/처리 WF 는 그리드 "시각 노드"(gridOptions 보유)가 아니라
  //  (a) 워크플로우 버튼(BTN_WORKFLOW)의 propertyValue.form[].target = 그리드ID, 또는
  //  (b) 그리드 바인딩 노드 자체(type=grid, target 보유)의 serviceUid/serviceId
  // 에 들어 있다. 같은 그리드를 서로 다른 버튼(조회/재계산/복사 등)이 각자 다른 WF 로 채우는 경우가
  // 흔해서, 첫 번째 발견한 것만 남기지 않고 gridId 별로 배열(중복 navKey 는 제거)로 모은다.
  // navKey/uid/id/label 을 반환해, 디자인 미리보기(배지)뿐 아니라 그래프 구조(그리드 중계 노드)에도 재사용한다.
  // 리소스 JSON 안에서 실제 "그리드" 타입 컴포넌트의 gridId 집합을 수집한다.
  // (form[].target 바인딩은 그리드가 아닌 일반 폼/컨테이너에도 쓰이므로, 그래프에
  //  그리드 중간노드를 만들 때는 실제 그리드 컴포넌트인지 이 집합으로 한번 더 확인한다.)
  function collectGridIds(resourceJson) {
    const ids = new Set();
    let obj;
    try { obj = JSON.parse(resourceJson); } catch (e) { return ids; }
    (function scan(o) {
      if (!o || typeof o !== 'object') return;
      if (Array.isArray(o)) { o.forEach(scan); return; }
      if (o.type === 'grid') {
        const pv = o.propertyValue || {};
        const gid = (pv.gridOptions && pv.gridOptions.gridId) || o.target || null;
        if (gid) ids.add(gid);
      }
      Object.keys(o).forEach(k => scan(o[k]));
    })(obj);
    return ids;
  }

  // gridId -> propertyValue.gridOptions 맵. collectGridIds 와 동일하게 순회하되, id 뿐 아니라
  // 컬럼 정의(go.columns)까지 통째로 보관해서 html 모드(applyHtmlLinkOverlay)에서도 buildDesignHtml
  // 과 동일한 컬럼 표(buildGridColumnsTableHtml)를 그릴 수 있게 한다.
  function collectGridOptionsMap(resourceJson) {
    const map = {};
    let obj;
    try { obj = JSON.parse(resourceJson); } catch (e) { return map; }
    (function scan(o) {
      if (!o || typeof o !== 'object') return;
      if (Array.isArray(o)) { o.forEach(scan); return; }
      if (o.type === 'grid') {
        const pv = o.propertyValue || {};
        const go = pv.gridOptions || null;
        const gid = (go && go.gridId) || o.target || null;
        if (gid && go) map[gid] = go;
      }
      Object.keys(o).forEach(k => scan(o[k]));
    })(obj);
    return map;
  }

  function computeGridServiceMap(resourceJson) {
    const map = {}; // gridId -> [{navKey, uid, id, label}]
    let obj;
    try { obj = JSON.parse(resourceJson); } catch (e) { return map; }
    const add = (gid, svcUid, svcId) => {
      if (!gid || (!svcUid && !svcId)) return;
      const navKey = svcUid ? ('WF:u' + svcUid) : ('WF:s' + svcId);
      const label = svcId || ('uid=' + svcUid);
      const arr = map[gid] || (map[gid] = []);
      if (!arr.some(x => x.navKey === navKey)) arr.push({ navKey, uid: svcUid || null, id: svcId || null, label });
    };
    (function scan(o) {
      if (!o || typeof o !== 'object') return;
      if (Array.isArray(o)) { o.forEach(scan); return; }
      const pv = o.propertyValue || {};
      const svcUid = pv.serviceUid != null ? String(pv.serviceUid)
                   : (o.serviceUid != null ? String(o.serviceUid) : null);
      const svcId = pv.serviceId || o.serviceId || null;
      // (a) WF 서비스를 가진 노드(버튼 등)의 form[] 바인딩 → 각 target 그리드에 연결
      const forms = Array.isArray(pv.form) ? pv.form : (Array.isArray(o.form) ? o.form : null);
      if ((svcUid || svcId) && forms) forms.forEach(f => { if (f && f.target) add(f.target, svcUid, svcId); });
      // (b) 그리드 바인딩 노드가 자체 서비스로 조회하는 경우
      if (o.type === 'grid' && o.target && (svcUid || svcId)) add(o.target, svcUid, svcId);
      Object.keys(o).forEach(k => scan(o[k]));
    })(obj);
    return map;
  }

  // 그리드 "툴바" 버튼(기본 버튼 add/undo/clone/remove + customButton 배열, 예: 품목참조/재고현황)에서
  // WF/UI(팝업) 연결을 추출한다. 그리드 컬럼 액션 버튼(extractGridButtonTriggers, cellTemplate 기반)과
  // 달리 이쪽은 RESOURCE_JS 정규식 매칭이 필요 없다 — 버튼 정의 자체에 eventType 이 선언적으로 박혀
  // 있기 때문(BTN_WORKFLOW→serviceId/serviceUid, BTN_OPEN_POPUP→programId). eventType 이 아예 없는
  // 버튼(행추가/행취소/행복사처럼 그리드 자체 로컬 동작)은 대상에서 제외한다(=배지 없음이 곧
  // "로컬 전용"이라는 신호이므로, 여기서 걸러내지 않으면 모든 버튼에 배지가 붙어 의미가 사라진다).
  // 화면마다 매번 다른 커스텀 버튼이 새로 붙어도(예: 다른 프로그램의 "재고현황", "이력조회" 등)
  // 버튼 이름을 하드코딩하지 않고 이 필드만 보고 자동으로 잡아낸다.
  function extractGridToolbarButtonTriggers(resourceJsonText) {
    const out = [];
    let obj;
    try { obj = JSON.parse(resourceJsonText); } catch (e) { return out; }
    const pushBtn = (btn, gridId) => {
      // useYn:false 는 화면에 실제로 그려지지 않는(비활성/미사용) 버튼이다 — computeGridToolbarButtonList
      // (json 모드 버튼 목록 렌더링)는 이미 이 조건으로 걸러내는데, 여기(html 모드 배지 판정)는 그
      // 필터가 빠져있어 실제로는 존재하지도 않는 버튼에 대한 배지 항목이 만들어지던 게 있었다
      // (id로 DOM 조회 시 못 찾아 화면엔 안 보이지만, 두 경로 판단 기준을 일치시켜 둔다).
      if (!btn || btn.useYn === false || !btn.eventType) return; // eventType 없음 = 로컬 전용, 배지 대상 아님
      const label = btn.name || btn.id || '';
      if (btn.eventType === 'BTN_WORKFLOW' && (btn.serviceId || btn.serviceUid != null)) {
        out.push({
          event: 'BTN_WORKFLOW', gridId, toolbarButton: true, buttonId: btn.id || null, label,
          serviceId: btn.serviceId || null,
          serviceUid: btn.serviceUid != null ? String(btn.serviceUid) : null,
          serviceName: btn.serviceName || null
        });
      } else if (btn.eventType === 'BTN_OPEN_POPUP' && btn.programId) {
        out.push({ event: 'BTN_OPEN_POPUP', gridId, toolbarButton: true, buttonId: btn.id || null, label, programId: btn.programId });
      }
      // BTN_USR_EVENT 등 커스텀 코드형은 여기서는 판단하지 않는다 — 코드 안에서 직접 WF/팝업을
      // 호출하는 경우(예: "전표보기")까지 잡으려면 extractTriggers 의 전체-텍스트 정규식 스캔
      // 결과(그래프 엣지 쪽에서는 이미 잡힘)와 별도로 대조해야 하며, 그리드 배지는 오탐 방지를
      // 위해 선언적 eventType 이 명확한 경우만 다룬다.
    };
    (function scan(o) {
      if (!o || typeof o !== 'object') return;
      if (Array.isArray(o)) { o.forEach(scan); return; }
      if (o.type === 'grid') {
        const pv = o.propertyValue || {};
        const gid = (pv.gridOptions && pv.gridOptions.gridId) || o.target || null;
        const tb = pv.gridOptions && pv.gridOptions.additionalOptions && pv.gridOptions.additionalOptions.toolbarOptions;
        if (gid && tb) {
          if (tb.buttons && typeof tb.buttons === 'object') {
            Object.keys(tb.buttons).forEach(k => pushBtn(tb.buttons[k], gid));
          }
          if (Array.isArray(tb.customButton)) tb.customButton.forEach(b => pushBtn(b, gid));
        }
      }
      Object.keys(o).forEach(k => scan(o[k]));
    })(obj);
    return out;
  }

  // extractGridToolbarButtonTriggers() 결과를 gridId → [{navKey,label,kind}] 맵으로 정리.
  // computeLinkMap(html 모드)·buildDesignHtml(json 모드) 양쪽에서 그대로 재사용한다.
  function computeGridToolbarLinks(resourceJson) {
    const map = {};
    const addLink = (id, link) => {
      if (!id) return;
      const arr = map[id] || (map[id] = []);
      if (!arr.some(x => x.navKey === link.navKey)) arr.push(link);
    };
    extractGridToolbarButtonTriggers(resourceJson).forEach(t => {
      if (t.event === 'BTN_WORKFLOW') {
        const navKey = t.serviceUid ? ('WF:u' + t.serviceUid) : ('WF:s' + t.serviceId);
        addLink(t.gridId, { navKey, label: t.serviceName || t.label || t.serviceId || ('uid=' + t.serviceUid), kind: 'wf' });
      } else if (t.event === 'BTN_OPEN_POPUP' && t.programId) {
        if (looksLikeReportId(t.programId)) addLink(t.gridId, { navKey: 'Rp:' + t.programId, label: t.label || t.programId, kind: 'rp' });
        else addLink(t.gridId, { navKey: 'UI:' + t.programId, label: t.label || t.programId, kind: 'ui' });
      }
    });
    return map;
  }

  // 버튼 정의 객체의 문자열 필드(eventFnc/beforeSubmit/afterSubmit 등, 필드명을 하드코딩하지 않고
  // 값이 문자열인 모든 속성을 훑는다) 안에서 "ajax.postJson('/wf/{uid}/execute...')" 형태로 WF 를
  // 직접 호출하는 코드가 있는지 찾는다. eventType 이 BTN_USR_EVENT(커스텀 코드)라 선언적으로는
  // 로컬 버튼처럼 보이지만 실제로는 WF 를 호출하는 "전표보기" 류 버튼까지 배지로 잡아내기 위함.
  function scanScriptForWfUid(btn) {
    for (const k of Object.keys(btn)) {
      const v = btn[k];
      if (typeof v === 'string' && v.indexOf('/execute') !== -1) {
        const m = /\/wf\/(\d+)\/execute/.exec(v);
        if (m) return m[1];
      }
    }
    return null;
  }

  // 그리드 "툴바"에 실제로 나열되는 버튼 목록(표준 버튼 add/undo/clone/remove + customButton 배열)을
  // 화면에 그릴 순서 그대로 gridId → [{id,label,kind,navKey,wfLabel}] 로 정리한다.
  // buildDesignHtml 이 헤더에 배지 하나만 뭉뚱그려 붙이는 대신, 실제 화면처럼 버튼 하나하나를
  // 그리고 그 중 WF/UI 로 연결된 버튼에만 각자 배지를 붙이는 데 쓴다(로컬 버튼은 배지 없이 표시).
  // 표준 4버튼의 한국어 라벨만 고정 매핑해 둔다 — 이 4개는 화면마다 새로 정의되는 커스텀 버튼이
  // 아니라 그리드 위젯 자체가 항상 제공하는 고정 버튼이라, 매핑해도 "커스텀 버튼 이름 하드코딩
  // 금지" 원칙에 어긋나지 않는다. customButton 은 화면 작성자가 넣은 name 을 그대로 쓴다.
  function computeGridToolbarButtonList(resourceJson) {
    const map = {};
    let obj;
    try { obj = JSON.parse(resourceJson); } catch (e) { return map; }
    const STD_LABEL = { add: '행추가', undo: '취소', clone: '복사', remove: '삭제' };
    const classify = (btn) => {
      if (btn.eventType === 'BTN_WORKFLOW' && (btn.serviceId || btn.serviceUid != null)) {
        const navKey = btn.serviceUid != null ? ('WF:u' + btn.serviceUid) : ('WF:s' + btn.serviceId);
        return { kind: 'wf', navKey, wfLabel: btn.serviceName || btn.serviceId || ('uid=' + btn.serviceUid) };
      }
      if (btn.eventType === 'BTN_OPEN_POPUP' && btn.programId) {
        const kind = looksLikeReportId(btn.programId) ? 'rp' : 'ui';
        const navKey = (kind === 'rp' ? 'Rp:' : 'UI:') + btn.programId;
        return { kind, navKey, wfLabel: btn.name || btn.programId };
      }
      const uid = scanScriptForWfUid(btn);
      if (uid) return { kind: 'wf', navKey: 'WF:u' + uid, wfLabel: 'uid=' + uid + ' (직접호출)' };
      return { kind: null, navKey: null, wfLabel: null };
    };
    const pushBtn = (btn, gid, isStd) => {
      if (!btn || btn.useYn === false) return;
      const { kind, navKey, wfLabel } = classify(btn);
      const label = isStd ? (STD_LABEL[btn.id] || btn.name || btn.id || '') : (btn.name || btn.id || '');
      const arr = map[gid] || (map[gid] = []);
      arr.push({ id: btn.id || null, label, kind, navKey, wfLabel });
    };
    (function scan(o) {
      if (!o || typeof o !== 'object') return;
      if (Array.isArray(o)) { o.forEach(scan); return; }
      if (o.type === 'grid') {
        const pv = o.propertyValue || {};
        const gid = (pv.gridOptions && pv.gridOptions.gridId) || o.target || null;
        const tb = pv.gridOptions && pv.gridOptions.additionalOptions && pv.gridOptions.additionalOptions.toolbarOptions;
        if (gid && tb) {
          const stdBtns = (tb.buttons && typeof tb.buttons === 'object') ? Object.keys(tb.buttons).map(k => tb.buttons[k]) : [];
          stdBtns.sort((a, b) => (a.sortIndex || 0) - (b.sortIndex || 0));
          stdBtns.forEach(b => pushBtn(b, gid, true));
          if (Array.isArray(tb.customButton)) tb.customButton.forEach(b => pushBtn(b, gid, false));
        }
      }
      Object.keys(o).forEach(k => scan(o[k]));
    })(obj);
    return map;
  }

  // WF/UI/Rp 배지 툴팁에 이름·UID 를 덧붙인다(buildDesignHtml 안의 withExtra 와 동일 로직을
  // 모듈 최상위에서도 재사용할 수 있도록 lookupNode 를 인자로 받는 버전으로 분리).
  function buildExtraTitle(lookupNode, navKey, idPart, baseTitle) {
    if (!lookupNode) return baseTitle;
    const n = lookupNode(navKey);
    if (!n) return baseTitle;
    let extra = '';
    if (n.name && n.name !== idPart) extra += ' · ' + n.name;
    if (n.uid) extra += ' · UID ' + n.uid;
    return extra ? baseTitle.replace(' (더블클릭:', extra + ' (더블클릭:') : baseTitle;
  }

  // 그리드 "컬럼 액션 버튼"(Tracking No 팝업, 품목참조 팝업 등)이 여는 UI 팝업을 gridId → 컬럼제목
  // 기준으로 찾아 맵으로 정리한다. extractGridButtonTriggers() 는 이미 cellTemplate 의 data-lang-id
  // 를 RESOURCE_JS 의 클릭 핸들러와 이어 programId 를 찾아주므로, 여기서는 컬럼 제목(title)을
  // 키로 재정리만 한다 — computeGridColumnDefs() 가 컬럼별 UI 뱃지를 붙일 때 title 로 바로 조회한다.
  function computeGridColumnPopups(resourceJson, resourceJsText) {
    const map = {}; // gridId(없으면 '__nogrid__') -> { title -> {programId, label} }
    if (!resourceJsText) return map;
    extractGridButtonTriggers(resourceJson, resourceJsText).forEach(t => {
      if (!t || !t.gridButton || !t.programId) return;
      const gid = t.gridId || '__nogrid__';
      const key = String(t.label || '').trim();
      if (!key) return;
      if (!map[gid]) map[gid] = {};
      if (!map[gid][key]) map[gid][key] = { programId: t.programId, label: t.label };
    });
    return map;
  }

  // 그리드 컬럼(z_grid_columns/z_grid_options 상당) 정의를 실제 화면처럼 렌더링하기 위해 정리한다.
  // pv.gridOptions.columns[] 는 해당 테이블들의 컬럼 구조를 그대로 반영한 배열이므로(별도 DB 조회
  // 불필요), VISIBLE=1(=visible!==false) 컬럼만 SORT_ORDER 순으로 골라 제목/정렬/필수여부/
  // 편집가능여부(EDIT_TYPE)/데이터타입(DATA_TYPE)을 뽑아낸다.
  // 컬럼 자체가 콤보(selectAuto/select)로 WF 조회를 갖는 경우(예: 품목/단위 콤보 컬럼) compLink()의
  // 1번 분기(serviceUid/serviceId)와 동일한 규칙으로 WF 배지를, popupByTitle 로 전달된 그리드 컬럼
  // 액션 버튼(Tracking No 팝업 등)이 있으면 UI/Rp 배지를 함께 붙인다(한 컬럼에 WF+UI 등 여러 개 가능).
  // buildDesignHtml(json 모드)·applyHtmlLinkOverlay(html 모드) 양쪽에서 그대로 재사용한다.
  // dict: z_dd_lang 다국어 사전(ddSingle, 컴포넌트 id → 현재 언어 라벨) — 요청사항: 그리드 컬럼
  // 헤더도 폼 필드 라벨과 동일하게 z_dd/z_dd_lang 기반으로 표시한다. 그리드 컬럼은 JSON 안의
  // "title" 이 실제로는 영문 개발용 이름(예: "Item", "itemBtn")인 경우가 많아, 사전에 값이 있으면
  // 그걸 우선 쓰고 없을 때만 JSON의 title 로 그대로 폴백한다. 사전 키는 컬럼 컴포넌트 자체의
  // compId 를 최우선으로 보고, 없으면 데이터 필드명(data/name)으로도 시도한다.
  // z_grid_columns(_tenant)/z_grid_options(_tenant)에서 실시간으로 가져온 행(SQL 컬럼명, Y/N 문자
  // 플래그)을 RESOURCE_JSON 의 pv.gridOptions.columns[] 와 같은 모양(camelCase)으로 바꿔서,
  // computeGridColumnDefs() 가 배포 스냅샷이든 실시간 값이든 구분 없이 그대로 재사용할 수 있게 한다.
  // ADDITIONAL_OPTIONS(JSON 문자열)엔 serviceId/serviceUid/comboType 처럼 전용 컬럼이 없는 필드가
  // 들어있을 수 있어 먼저 펼쳐두고, 그 위에 확실한 DB 컬럼값으로 덮어써서 최신값이 항상 이기게 한다.
  function ynToBool(v) { return v === 'Y' || v === true || v === '1' || v === 1; }
  function mapLiveGridColumns(rows) {
    return (rows || []).map(r => {
      let addl = null;
      if (r && r.ADDITIONAL_OPTIONS) { try { addl = JSON.parse(r.ADDITIONAL_OPTIONS); } catch (e) { addl = null; } }
      const out = Object.assign({}, addl || {});
      return Object.assign(out, {
        name: r.NAME,
        data: r.DATA || r.NAME,
        title: r.TITLE,
        align: r.ALIGN,
        width: r.WIDTH,
        visible: r.VISIBLE == null ? true : ynToBool(r.VISIBLE),
        sortOrder: r.SORT_ORDER,
        dataType: r.DATA_TYPE,
        editType: r.EDIT_TYPE,
        required: ynToBool(r.REQUIRED),
        cellTemplate: r.CELL_TEMPLATE,
        compId: out.compId || r.NAME
      });
    });
  }

  function computeGridColumnDefs(go, lookupNode, popupByTitle, dict) {
    const cols = (go && Array.isArray(go.columns)) ? go.columns : [];
    return cols
      .filter(c => c && c.visible !== false)
      .slice()
      .sort((a, b) => (parseInt(a && a.sortOrder, 10) || 0) - (parseInt(b && b.sortOrder, 10) || 0))
      .map(c => {
        const links = [];
        const svcUid = c.serviceUid != null ? String(c.serviceUid) : null;
        const svcId = c.serviceId || null;
        if (svcUid || svcId) {
          const navKey = svcUid ? ('WF:u' + svcUid) : ('WF:s' + svcId);
          const idPart = svcId || ('uid=' + svcUid);
          const baseTitle = 'WF 연결(컬럼): ' + (c.serviceName || idPart) + ' (더블클릭: 그래프 이동)';
          links.push({ navKey, cls: 'lk-wf', badge: 'WF', title: buildExtraTitle(lookupNode, navKey, idPart, baseTitle) });
        }
        // 컬럼 액션 버튼(팝업) 매칭은 JSON 원문 title 기준으로 이뤄진다(extractGridButtonTriggers 가
        // cellTemplate 의 data-lang-id ↔ 같은 컬럼 오브젝트의 title 로 이미 짝지어 둔 값) — 그래서
        // 사전 치환은 이 매칭 이후, 화면에 "보여줄" 제목에만 적용한다.
        const rawTitle = c.title || c.name || c.data || '';
        const popup = popupByTitle && popupByTitle[String(rawTitle).trim()];
        if (popup && popup.programId) {
          const isRp = looksLikeReportId(popup.programId);
          const navKey = (isRp ? 'Rp:' : 'UI:') + popup.programId;
          const baseTitle = (isRp ? '리포트 연결(컬럼): ' : 'UI 팝업 연결(컬럼): ') + popup.programId + ' (더블클릭: 그래프 이동)';
          links.push({ navKey, cls: isRp ? 'lk-rp' : 'lk-ui', badge: isRp ? 'Rp' : 'UI', title: buildExtraTitle(lookupNode, navKey, popup.programId, baseTitle) });
        }
        const dictTitle = dict && (dict[c.compId] != null ? dict[c.compId] : (dict[c.data] != null ? dict[c.data] : dict[c.name]));
        const title = (dictTitle != null && String(dictTitle).trim() !== '') ? dictTitle : rawTitle;
        const required = c.required === true || c.required === 'true' || c.required === '1';
        const editable = String(c.editType || '').toUpperCase() === 'E';
        return {
          title,
          name: c.name || c.data || '',
          align: c.align || 'left',
          width: c.width,
          required,
          editable,
          dataType: String(c.dataType || 'text').toLowerCase(),
          links
        };
      });
  }

  // 그리드 컬럼 제목+뱃지 표를 렌더링한다(실제 UI의 컬럼 목록 재현). 요청사항 반영:
  // (1) 뱃지는 컬럼 "제목 위"가 아니라 제목 아래에 별도의 행으로 붙는다 → 제목 행 → 뱃지 행 순서.
  // (2) 실제 입력값을 흉내낸 샘플 데이터 행은 불필요하다는 피드백에 따라 제거 — 제목+뱃지 두 행만 남긴다.
  // 한 컬럼에 뱃지가 여러 개(예: WF + UI)면 그 컬럼의 뱃지 셀 안에 나란히 표시한다.
  //
  // ⚠️ 전부 인라인 style 로만 꾸민다(클래스+<style>블록 방식 지양). 이 표는 실제 운영 화면의
  // 진짜 CSS(Bootstrap + sirius 테마 + uni 공통 CSS, realThemeLinksHtml() 로 우리 인라인 스타일보다
  // "나중에" 로드됨)와 같은 문서에 함께 뜨는데, 동률 우선순위는 나중에 로드된 쪽이 이기므로 클래스
  // 기반 스타일은 의도치 않게 덮어써질 수 있다. 인라인 style 속성은 (거의) 항상 최우선이라 이 문제를
  // 원천적으로 피할 수 있다 — 뱃지가 컬럼 경계를 벗어나거나 테두리가 사라져 "헤더 위에 붕 뜬 것처럼"
  // 보이는 문제의 재발을 막기 위함.
  // cols 는 computeGridColumnDefs() 의 결과를 그대로 받는다(호출부에서 컬럼 뱃지 navKey 집합을
  // 재사용해 그리드 상단 배지를 걸러내야 하는 경우가 있어 계산을 분리해 뒀다 — buildDesignHtml 참고).
  function renderGridColumnsTableFromDefs(cols) {
    if (!cols || !cols.length) return '';
    const CELL_BORDER = '1px solid #cbd5e1';
    const widthOf = (w) => {
      const n = parseInt(w, 10);
      return (w && w !== '*' && !isNaN(n) && n > 0) ? ('width:' + n + 'px;min-width:' + n + 'px;') : 'min-width:70px;';
    };
    const thBase = (w) => 'box-sizing:border-box;border:' + CELL_BORDER + ';white-space:nowrap;' + widthOf(w);
    const badgeColorOf = { 'lk-wf': '#12a150', 'lk-ui': '#1f6fd6', 'lk-rp': '#e08e0b' };
    const titleRow = cols.map(c => {
      // 요청사항: 제목 아래에 실제 바인딩 필드명(name/data, 예: itemCd)을 작게 한 줄 더 보여준다
      // — 제목만 봐서는 실제 데이터 필드를 특정하기 어려운 경우(동명이의 제목 등)를 보완한다.
      const nameLine = (c.name && c.name !== c.title)
        ? '<div style="font-weight:400;font-size:9.5px;color:#94a3b8;margin-top:2px">' + esc(c.name) + '</div>' : '';
      return '<th style="' + thBase(c.width) + 'background:#f1f5f9;color:#334155;font-weight:700;padding:6px 8px;text-align:' + esc(c.align) + '">'
        + esc(c.title) + (c.required ? '<span style="color:#ef4444;margin-left:2px">*</span>' : '') + nameLine + '</th>';
    }).join('');
    const badgeRow = cols.map(c => {
      const badgesHtml = (c.links || []).map(link =>
        '<span class="dz-link-tag ' + link.cls + '" data-navkey="' + esc(link.navKey) + '" title="' + esc(link.title) + '" style="display:inline-block;margin:0;font-size:9px;font-weight:800;color:#fff;background:' + (badgeColorOf[link.cls] || '#12a150') + ';border-radius:4px;padding:0 5px;cursor:pointer">' + esc(link.badge) + '</span>'
      ).join('');
      return '<th style="' + thBase(c.width) + 'padding:0;background:#eef2ff;height:24px">'
        + '<div style="display:flex;align-items:center;justify-content:center;gap:3px;height:24px;width:100%;box-sizing:border-box">' + badgesHtml + '</div></th>';
    }).join('');
    return '<div class="dz-grid-cols-wrap" style="overflow-x:auto;border-top:' + CELL_BORDER + '">'
      + '<table style="border-collapse:collapse;width:100%;min-width:max-content;font-size:11.5px">'
      + '<thead><tr>' + titleRow + '</tr>'
      + '<tr>' + badgeRow + '</tr></thead></table></div>';
  }

  // 외부(app.js html 모드 오버레이 등) 호출용 얇은 래퍼 — go/lookupNode/popupByTitle/dict 로부터
  // 컬럼 정의를 직접 계산해서 렌더링까지 한 번에 해준다.
  function buildGridColumnsTableHtml(go, lookupNode, popupByTitle, dict) {
    return renderGridColumnsTableFromDefs(computeGridColumnDefs(go, lookupNode, popupByTitle, dict));
  }

  function buildDesignHtml(resourceJson, resourceHtml, dict, lookupNode, initMap, resourceJsText) {
    let obj;
    try { obj = JSON.parse(resourceJson); } catch (e) { return null; }
    const page = obj && obj.page;
    if (!page) return null;
    const langMap = extractLangMap(resourceHtml || '');
    const ddSingle = (dict && dict.single) || {};   // z_dd_lang: 컴포넌트 id → 현재 언어 라벨
    // 그리드 배지 대상 병합: (a) 그리드 자체가 서비스로 조회/처리되는 경우(WF, computeGridServiceMap)
    // + (b) 그리드 "툴바" 버튼(품목참조/재고현황처럼 매 화면 다른 커스텀 버튼 포함)의 WF/UI 연결.
    // + (c) 그리드 "컬럼" 자체의 콤보 WF(serviceId/serviceUid)와, resourceJsText 가 주어지면
    // 컬럼 액션 버튼(Tracking No 팝업 등)의 UI 연결까지 buildGridColumnsTableHtml 안에서 함께 반영한다.
    const gridWfMap = computeGridServiceMap(resourceJson); // gridId -> [{navKey,label,...}] (kind는 항상 wf)
    // 그리드 컬럼 액션 버튼(cellTemplate + RESOURCE_JS 클릭 핸들러)이 여는 UI 팝업 — resourceJsText 가
    // 없는 호출부(RESOURCE_JS 미전달)에서는 빈 맵이 되어 기존처럼 WF만 표시된다(하위 호환).
    const gridColumnPopupMap = computeGridColumnPopups(resourceJson, resourceJsText); // gridId -> {title -> {programId,label}}
    // 그리드 "툴바" 버튼(품목참조/재고현황처럼 매 화면 다른 커스텀 버튼 포함) 목록 — 실제 화면처럼
    // 버튼 하나하나를 그리고, WF/UI 로 연결된 버튼에만 개별 배지를 붙이는 데 쓴다.
    const gridButtonListMap = computeGridToolbarButtonList(resourceJson); // gridId -> [{id,label,kind,navKey,wfLabel}]
    const gridBadgeCls = { wf: 'lk-wf', ui: 'lk-ui', rp: 'lk-rp' };
    const gridBadgeText = { wf: 'WF', ui: 'UI', rp: 'Rp' };
    const gridLinksOf = (gid) => {
      const out = [];
      const seen = new Set();
      (gridWfMap[gid] || []).forEach(l => {
        if (seen.has(l.navKey)) return; seen.add(l.navKey);
        out.push({ navKey: l.navKey, label: l.label, kind: 'wf' });
      });
      return out;
    };

    // WF/UI/Rp 연결 배지 툴팁에 이름·UID 를 덧붙인다. lookupNode 가 주어지면(= app.js 가 store 조회
    // 함수를 넘겨준 경우) 이미 파도타기로 로드되어 있는 노드의 이름/uid 를 함께 보여준다.
    const withExtra = (navKey, idPart, baseTitle) => {
      if (!lookupNode) return baseTitle;
      const n = lookupNode(navKey);
      if (!n) return baseTitle;
      let extra = '';
      if (n.name && n.name !== idPart) extra += ' · ' + n.name;
      if (n.uid) extra += ' · UID ' + n.uid;
      return extra ? baseTitle.replace(' (더블클릭:', extra + ' (더블클릭:') : baseTitle;
    };

    const labelOf = (pv) => {
      // 1순위: 다국어 사전(z_dd_lang) — 컴포넌트 id(=OBJECT_ID)로 현재 언어 라벨 치환
      const did = pv.id != null ? ddSingle[pv.id] : null;
      if (did != null && String(did).trim() !== '') return did;
      const raw = pv.formLabel || pv.label || pv.text || '';
      // formLabel 이 코드값이면 langMap 으로 실제 텍스트 치환
      if (raw && langMap[raw]) return langMap[raw];
      if (pv.id && langMap[pv.id]) return langMap[pv.id];
      return raw;
    };
    // 라디오 항목 라벨: 옵션 키(id/value/label)로 사전 치환 시도
    const radioLabel = (item) => {
      for (const k of [item && item.id, item && item.value, item && item.label]) {
        if (k != null && ddSingle[k] != null && String(ddSingle[k]).trim() !== '') return ddSingle[k];
      }
      return item && item.label;
    };

    function renderComp(node) {
      const va = node.viewerAttr || {};
      const pv = node.propertyValue || {};
      const o = va.object || '';
      const label = labelOf(pv);
      const req = pv.isRequired ? '<span class="req">*</span>' : '';
      const w = (pv.style && pv.style.width) ? (';width:' + pv.style.width) : '';
      // 숨김 여부: visible:false 또는 style.display:none 등. 숨겨진 컨트롤도 강제로 표시하되
      // 사용자가 인지할 수 있도록 "숨김" 배지를 붙이고 흐리게 처리한다.
      const isHidden = (pv.visible === false)
        || (pv.style && /display\s*:\s*none/i.test(String(pv.style.display || pv.style || '')))
        || /(^|\s)(hide|d-none)(\s|$)/.test(String(pv.className || ''));
      const hiddenBadge = isHidden ? '<span class="dz-hidden-tag">숨김</span>' : '';
      // 연결 표시(link): 저장WF/팝업UI/리포트 등과 엮인 컨트롤은 클릭 가능한 링크로 렌더
      const link = compLink(node, pv, o);
      const dataAttr = link ? (' data-navkey="' + esc(link.navKey) + '" title="' + esc(link.title) + '"') : '';
      const linkCls = link ? ' dz-linked' : '';
      const linkTag = link ? ('<span class="dz-link-tag ' + link.cls + '">' + esc(link.badge) + '</span>') : '';
      const hiddenCls = isHidden ? ' dz-hidden' : '';

      // 초기값 추적 배지: 이 컴포넌트에 대한 정적/스크립트/체인 초기값 정보가 있으면 "IV" 배지를 붙인다.
      // 클릭하면(app.js 쪽에서 bindInitBadges 로 처리) 상세패널에 전체 체인을 보여준다.
      const initInfo = (initMap && pv.id) ? initMap[pv.id] : null;
      const initKind = initInfo && initInfo.length ? initInfo[0].kind : null;
      const initCls = initKind === 'chain' ? 'dz-init-chain' : initKind === 'literal' ? 'dz-init-lit' : initKind === 'static' ? 'dz-init-static' : '';
      const initTag = initInfo && initInfo.length
        ? ('<span class="dz-link-tag dz-init-tag ' + initCls + '" data-init-id="' + esc(pv.id) + '" title="초기값 추적 정보 보기 (클릭)">IV</span>')
        : '';

      // 뱃지(숨김/연결/초기값)는 컨트롤 박스 안이 아니라 "라벨 텍스트 오른쪽"에 붙인다(요청사항:
      // 컴포넌트 안에 넣은 뱃지가 마음에 안 든다 — 그리드 제외 모든 컴포넌트는 라벨 우측으로).
      const badgesInner = (hiddenBadge || linkTag || initTag) ? (hiddenBadge + linkTag + initTag) : '';
      const badgeSlot = badgesInner ? ('<span class="dz-label-badges">' + badgesInner + '</span>') : '';
      const field = (inner) => '<div class="dz-field' + linkCls + hiddenCls + '"' + dataAttr + '>'
        + (label ? ('<label>' + esc(label) + req + badgeSlot + '</label>')
                 : (badgesInner ? ('<label>' + badgeSlot + '</label>') : ''))
        + '<div class="dz-ctrl">' + inner + '</div>'
        + '</div>';

      switch (o) {
        case 'input':
          return field('<input type="text" class="dz-inp" style="max-width:100%' + w + '" disabled>');
        case 'select':
          return field('<div class="dz-sel" style="' + w.replace(/^;/, '') + '"><span>선택</span><i>▾</i></div>');
        case 'singleDatePicker':
        case 'datePicker':
          return field('<div class="dz-date"><span>YYYY-MM-DD</span><i>📅</i></div>');
        case 'radio': {
          const items = (pv.radioItems || []).map(r =>
            '<label class="dz-radio"><input type="radio" disabled ' + (String(pv.default) === String(r.value) ? 'checked' : '') + '> ' + esc(radioLabel(r)) + '</label>').join('');
          return field('<div class="dz-radios">' + items + '</div>');
        }
        case 'button': {
          // 연결(link)된 버튼은 클릭 이벤트를 받아야 하므로 disabled 를 걸지 않는다.
          // (disabled 버튼은 click 이벤트가 발생하지 않아 그래프 이동이 동작하지 않음)
          const btnDis = link ? '' : ' disabled';
          const btnType = link ? ' type="button"' : '';
          return '<button class="dz-btn' + linkCls + hiddenCls + '"' + dataAttr + btnType + btnDis + '>'
            + esc(label || pv.id || 'button') + hiddenBadge + linkTag + '</button>';
        }
        case 'heading':
          return '<div class="dz-heading' + hiddenCls + '">' + esc(pv.text || label) + hiddenBadge + '</div>';
        case 'text':
          return field('<span class="dz-text">' + esc(pv.default || label) + '</span>');
        case 'activeReport':
          return '<div class="dz-report' + linkCls + hiddenCls + '"' + dataAttr + '>📄 리포트 영역 ('
            + esc(pv.id || '') + ')' + hiddenBadge + linkTag + '</div>';
        case 'checkbox': {
          const checked = (pv.default === true || pv.default === 'Y' || pv.checked === true);
          return field('<label class="dz-checkbox"><input type="checkbox" disabled' + (checked ? ' checked' : '') + '><span></span></label>');
        }
        case 'textarea':
          return field('<textarea class="dz-textarea" disabled rows="' + (parseInt(pv.rows, 10) || 3) + '"></textarea>');
        case 'rangeDatePicker':
          return field('<div class="dz-daterange"><span>YYYY-MM-DD</span><i>~</i><span>YYYY-MM-DD</span><i class="dz-date-ico">📅</i></div>');
        case 'tree':
          return '<div class="dz-tree' + linkCls + hiddenCls + '"' + dataAttr + '>'
            + '<div class="dz-tree-head">🌳 ' + esc(label || '트리 영역') + hiddenBadge + linkTag + '</div>'
            + '<div class="dz-tree-body"><div class="dz-tree-row">▸ Node 1</div>'
            + '<div class="dz-tree-row dz-tree-indent">▸ Node 1-1</div>'
            + '<div class="dz-tree-row">▸ Node 2</div></div></div>';
        case 'hyperlink':
          return field('<a class="dz-hyperlink" href="javascript:void(0)">' + esc(label || pv.text || pv.id || '링크') + '</a>');
        case 'image':
          return '<div class="dz-image' + hiddenCls + '">🖼 ' + esc(label || '이미지') + hiddenBadge + '</div>';
        case 'icon':
          return '<span class="dz-icon" title="' + esc(pv.icon || '') + '">' + (pv.icon ? '🔸' : '🔹') + '</span>';
        case 'badge':
          return '<span class="dz-badge">' + esc(label || pv.text || pv.id || 'Badge') + '</span>';
        case 'horizontalDivider':
          return '<hr class="dz-hr">';
        case 'verticalDivider':
          return '<span class="dz-vr"></span>';
        case 'fileUpload':
          return field('<div class="dz-file"><span>📎 파일 선택</span><button type="button" class="dz-file-btn" disabled>업로드</button></div>');
        case 'fileDownload':
          return field('<div class="dz-file"><span>📥 ' + esc(label || '첨부파일') + '</span></div>');
        case 'html':
          return '<div class="dz-html' + hiddenCls + '">&lt;HTML 영역&gt;' + hiddenBadge + '</div>';
        case 'textEditor':
          return field('<div class="dz-editor"><div class="dz-editor-toolbar"><b>B</b> <i>I</i> <u>U</u></div><div class="dz-editor-body"></div></div>');
        case 'textEx':
          return field('<span class="dz-text">' + esc(pv.default || label) + '</span>');
        case 'amchart3':
        case 'echarts':
          return '<div class="dz-chart' + linkCls + hiddenCls + '"' + dataAttr + '>📈 ' + esc(label || '차트 영역') + hiddenBadge + linkTag + '</div>';
        case 'jsGantt':
          return '<div class="dz-chart dz-gantt' + hiddenCls + '">📅 ' + esc(label || '간트차트 영역') + hiddenBadge + '</div>';
        case 'bnb':
          return '<div class="dz-bnb">Home &gt; … &gt; ' + esc(label || '') + '</div>';
        case 'tnb':
          return '<div class="dz-tnb">' + esc(label || '상단 네비게이션') + '</div>';
        default:
          return field('<span class="dz-text">' + esc(label || pv.id || o) + '</span>');
      }
    }

    // 컴포넌트가 WF/UI(팝업)/리포트와 연결돼 있으면 이동용 링크 정보를 반환.
    // navKey 는 그래프 노드 key 규칙과 동일하게 만든다: WF:u<uid> / WF:s<id> / UI:<id> / Rp:<id>
    //
    // eventType(BTN_OPEN_POPUP/BTN_REPORT_PREVIEW/BTN_WORKFLOW)이 선언돼 있으면 그게 실제로 클릭했을
    // 때 벌어지는 일에 대한 가장 확실한 신호다. 그런데 실무 데이터를 보면 BTN_OPEN_POPUP/
    // BTN_REPORT_PREVIEW 버튼에도 (안 쓰이는 예전 값으로 보이는) serviceId/serviceUid 가 propertyValue에
    // 함께 남아있는 경우가 흔하다(예: "발주서" 출력 버튼, "구매요청참조" 팝업 버튼 모두 이런 leftover
    // 값을 갖고 있었다). serviceId/serviceUid 유무만으로 무조건 WF 배지부터 붙이면 이런 버튼들의
    // 진짜 연결(UI 팝업/리포트)이 가려져 "그래프(파도타기)엔 잡히는데 화면 배지엔 없다"는 불일치가
    // 생긴다 — 그래서 eventType 이 명시적으로 있으면 그 값에 맞는 링크를 먼저 찾고, 못 찾을 때만
    // (또는 eventType 자체가 없을 때만) serviceId/serviceUid → programId → reportProgramId 순으로
    // 폴백한다.
    function findPopupId(pv) {
      const formPgmId = Array.isArray(pv.form) ? (pv.form.find(f => f && f.programId) || {}).programId : null;
      return pv.programId || formPgmId;
    }
    function findReportId(pv) {
      const formRpId = Array.isArray(pv.form) ? (pv.form.find(f => f && f.reportProgramId) || {}).reportProgramId : null;
      return pv.reportProgramId || pv.reportPgmId || pv.reportId || pv.rptProgramId || formRpId;
    }
    function findWfLink(pv) {
      const svcUid = pv.serviceUid != null ? String(pv.serviceUid) : null;
      const svcId = pv.serviceId || null;
      if (!svcUid && !svcId) return null;
      const navKey = svcUid ? ('WF:u' + svcUid) : ('WF:s' + svcId);
      const idPart = svcId || ('uid=' + svcUid);
      const title = withExtra(navKey, idPart, 'WF 연결: ' + idPart + ' (더블클릭: 그래프 이동)');
      return { navKey, cls: 'lk-wf', badge: 'WF', title };
    }
    function compLink(node, pv, o) {
      // 0) eventType 이 명시된 경우: 그 eventType 에 해당하는 링크(팝업/리포트)를 최우선으로 찾는다.
      if (pv.eventType === 'BTN_OPEN_POPUP' || pv.eventType === 'BTN_REPORT_PREVIEW') {
        const pgmId0 = findPopupId(pv);
        const rpId0 = findReportId(pv);
        // BTN_OPEN_POPUP 인데 programId 가 리포트 명명규칙이거나, BTN_REPORT_PREVIEW 인데
        // reportProgramId 가 있으면 → Rp. 그 외 BTN_OPEN_POPUP + programId → UI.
        if (pv.eventType === 'BTN_REPORT_PREVIEW' && rpId0) {
          const navKey = 'Rp:' + rpId0;
          const title = withExtra(navKey, rpId0, '리포트 연결: ' + rpId0 + ' (더블클릭: 그래프 이동)');
          return { navKey, cls: 'lk-rp', badge: 'Rp', title };
        }
        if (pv.eventType === 'BTN_OPEN_POPUP' && pgmId0) {
          if (looksLikeReportId(pgmId0)) {
            const navKey = 'Rp:' + pgmId0;
            const title = withExtra(navKey, pgmId0, '리포트 연결: ' + pgmId0 + ' (더블클릭: 그래프 이동)');
            return { navKey, cls: 'lk-rp', badge: 'Rp', title };
          }
          const navKey = 'UI:' + pgmId0;
          const title = withExtra(navKey, pgmId0, '팝업 UI 연결: ' + pgmId0 + ' (더블클릭: 그래프 이동)');
          return { navKey, cls: 'lk-ui', badge: 'UI', title };
        }
        // eventType 은 있는데 정작 링크 필드를 못 찾은 예외적인 경우 — 아래 일반 폴백으로 넘어간다.
      }
      // 1) 저장/실행 버튼 등: serviceUid/serviceId (BTN_WORKFLOW 계열, 또는 eventType 없는 콤보/그리드)
      const wfLink = findWfLink(pv);
      if (wfLink) return wfLink;
      // 2) 팝업 버튼: programId — 실제로는 대부분 최상위 pv.programId 가 아니라
      //    BTN_OPEN_POPUP 패턴의 pv.form[].programId 에 들어있다(예: btnOpenPop → form:[{programId:"SDSOPUI0001"}]).
      //    최상위 pv.programId 는 드물게만 쓰이므로 폴백으로 남겨둔다.
      const pgmId = findPopupId(pv);
      if (pgmId) {
        if (looksLikeReportId(pgmId)) {
          const navKey = 'Rp:' + pgmId;
          const title = withExtra(navKey, pgmId, '리포트 연결: ' + pgmId + ' (더블클릭: 그래프 이동)');
          return { navKey, cls: 'lk-rp', badge: 'Rp', title };
        }
        const navKey = 'UI:' + pgmId;
        const title = withExtra(navKey, pgmId, '팝업 UI 연결: ' + pgmId + ' (더블클릭: 그래프 이동)');
        return { navKey, cls: 'lk-ui', badge: 'UI', title };
      }
      // 3) 리포트 컴포넌트: reportProgramId 계열(최상위 또는 form[].reportProgramId)
      const rpId = findReportId(pv);
      if (rpId) {
        const navKey = 'Rp:' + rpId;
        const title = withExtra(navKey, rpId, '리포트 연결: ' + rpId + ' (더블클릭: 그래프 이동)');
        return { navKey, cls: 'lk-rp', badge: 'Rp', title };
      }
      // 4) BTN_USR_EVENT 버튼: 선언적 serviceId/serviceUid 바인딩이 없고, usrEventFn(커스텀 JS)
      //    안에서 ajax.postJson(... '/wf/{uid}/execute...' ...) 형태로 WF 를 직접 호출하는 경우
      //    (결의전표등록 저장 버튼 등). computeLinkMap()(RESOURCE_HTML 오버레이 경로)에는 이미
      //    이 감지가 있었지만, RESOURCE_HTML 이 비어 JSON 합성 렌더링(이 함수)을 타는 화면에는
      //    빠져 있어 배지가 전혀 안 붙는 버그가 있었다 — 여기서도 동일하게 잡아준다.
      //    이 함수는 배지 1개만 표시하므로(복수 지원 X) 첫 번째 UID를 대표로 쓰고,
      //    여러 건이면 툴팁에 "외 N건"으로 알려준다.
      if (typeof pv.usrEventFn === 'string' && pv.usrEventFn.indexOf('/execute') !== -1) {
        const wfCallRe = /\/wf\/(\d+)\/execute/g;
        const uids = [];
        const seen = new Set();
        let wm;
        while ((wm = wfCallRe.exec(pv.usrEventFn)) !== null) {
          if (seen.has(wm[1])) continue;
          seen.add(wm[1]); uids.push(wm[1]);
        }
        if (uids.length) {
          const navKey = 'WF:u' + uids[0];
          const idPart = 'uid=' + uids[0];
          const extraCnt = uids.length > 1 ? (' 외 ' + (uids.length - 1) + '건') : '';
          const baseTitle = 'WF 연결: ' + idPart + extraCnt + ' · 직접호출(스크립트) (더블클릭: 그래프 이동)';
          const title = withExtra(navKey, idPart, baseTitle);
          return { navKey, cls: 'lk-wf', badge: 'WF', title };
        }
      }
      return null;
    }

    function renderNode(node) {
      if (!node || typeof node !== 'object') return '';
      const t = node.type;
      const pv = node.propertyValue || {};
      const cls = (pv.className || '');
      const kids = (node.child || []).map(renderNode).join('');

      if (t === 'component') return renderComp(node);
      if (t === 'row') {
        const border = /border-line/.test(cls) ? ' dz-border' : '';
        return '<div class="dz-row' + border + '">' + kids + '</div>';
      }
      if (t === 'column') {
        const wl = pv.widthLaptop ? (' style="flex:0 0 ' + (parseInt(pv.widthLaptop, 10) ? (pv.widthLaptop <= 12 ? (pv.widthLaptop / 12 * 100) + '%' : pv.widthLaptop + 'px') : 'auto') + '"') : '';
        return '<div class="dz-col"' + wl + '>' + kids + '</div>';
      }
      if (t === 'form') {
        const isSearch = /search-wrap/.test(cls);
        return '<div class="dz-form' + (isSearch ? ' dz-search' : '') + '">' + kids + '</div>';
      }
      if (t === 'container' || t === 'block') return '<div class="dz-container">' + kids + '</div>';
      // 탭(신청대상/상신내역/미신청 같은 서브탭 네비게이션): 실제 화면은 Bootstrap nav-tabs(<ul class="nav
      // nav-tabs">)로 마크업되는데, 이 트리 순회는 그 실제 HTML이 아니라 JSON을 그대로 근사 재구성하는
      // 경로라서 이 타입을 처리하지 않으면 tabContainer/tab 노드가 그냥 "래퍼 없는 노드"로 취급되어
      // (아래 기본 분기 return kids) 자식(그리드 등)만 그대로 이어붙고 탭 이름/아이콘 자체가 통째로
      // 사라진다 — 오프라인 모드에서 "탭이 아예 안 보인다"는 증상의 원인. 실제 화면은 탭 1개만 보이고
      // 클릭으로 전환되지만, 정적 미리보기는 클릭 전환을 구현하지 않는 대신(다른 dz-* 섹션들과 동일한
      // 방침) 각 탭의 내용을 전부 펼쳐서 보여주고, 그 위에 탭 이름이 잘 보이도록 가로 스트립 + 섹션
      // 제목을 함께 그린다.
      if (t === 'tabContainer') {
        const tabs = (node.child || []).filter(c => c && c.type === 'tab');
        const tabLabel = (tb) => { const tpv = tb.propertyValue || {}; return labelOf(tpv) || tpv.name || tpv.id || ''; };
        const stripHtml = tabs.length ? ('<div class="dz-tabs">' + tabs.map((tb, i) => {
          const tpv = tb.propertyValue || {};
          const icon = tpv.icon ? ('<i class="fa fa-fw ' + esc(tpv.icon) + '"></i>') : '';
          return '<div class="dz-tab' + (i === 0 ? ' dz-tab-active' : '') + '">' + icon + '<span>' + esc(tabLabel(tb)) + '</span></div>';
        }).join('') + '</div>') : '';
        const panelsHtml = tabs.map((tb) => '<div class="dz-tab-panel"><div class="dz-tab-panel-head">'
          + esc(tabLabel(tb)) + '</div>' + (tb.child || []).map(renderNode).join('') + '</div>').join('');
        return '<div class="dz-tabcontainer">' + stripHtml + panelsHtml + '</div>';
      }
      if (t === 'tab') return kids; // tabContainer 없이 단독으로 순회되는 예외적 경우의 안전망
      if (t === 'grid') {
        const go = pv.gridOptions || {};
        const gid = go.gridId || null;
        const gtitle = go.title || '';
        const headLabel = '📊 ' + (gtitle ? esc(gtitle) : '데이터 그리드 영역')
          + (gid ? (' <span style="font-weight:400;color:#94a3b8">(' + esc(gid) + ')</span>') : '');
        // 컬럼 정의를 먼저 한 번 계산해 둔다 — (i) 컬럼별 제목+뱃지 표 렌더링과 (ii) 그리드 상단
        // 배지 목록에서 "이미 컬럼에 매핑된 배지"를 걸러내는 데 함께 쓴다(요청사항: 상단 줄에는
        // 어느 컬럼에도 안 붙은 WF/UI만 남긴다).
        const columnPopupByTitle = (gid && gridColumnPopupMap[gid]) || gridColumnPopupMap.__nogrid__ || {};
        const colDefs = computeGridColumnDefs(go, lookupNode, columnPopupByTitle, ddSingle);
        const columnNavKeys = new Set();
        colDefs.forEach(c => (c.links || []).forEach(l => columnNavKeys.add(l.navKey)));
        // (a) 그리드 "자체"가 외부(대개 조회 버튼)의 서비스로 채워지는 경우 — 버튼이 아니라 그리드
        // 데이터 소스 바인딩이므로 헤더에 배지로 계속 표시한다(조회 WF 등, 여러 개면 WF1/WF2...).
        // 이미 컬럼 뱃지 행에 나온 navKey 는 중복 표시하지 않는다.
        const headLinks = (gid ? gridLinksOf(gid) : []).filter(l => !columnNavKeys.has(l.navKey));
        const headBadges = headLinks.map((link, i) => {
          const title = withExtra(link.navKey, link.label, '조회 WF 연결: ' + link.label + ' (클릭: 그래프 이동)');
          const tag = headLinks.length > 1 ? ('WF' + (i + 1)) : 'WF';
          return '<span class="dz-link-tag lk-wf dz-grid-wf" data-navkey="' + esc(link.navKey) + '" title="' + esc(title) + '">' + tag + '</span>';
        }).join('');
        // (b) 그리드 "툴바" 버튼(표준 행추가/취소/복사/삭제 + 품목참조/재고현황 같은 커스텀 버튼)을
        // 실제 화면처럼 개별 버튼으로 그리고, 그 중 WF/UI 로 연결된 버튼에만 각자 배지를 붙인다.
        // 버튼 이름은 하드코딩하지 않고 화면 JSON 의 정의(name/eventType)를 그대로 반영한다.
        const toolbarBtns = gid ? (gridButtonListMap[gid] || []) : [];
        const toolbarHtml = toolbarBtns.length ? ('<div class="dz-grid-toolbar">' + toolbarBtns.map(b => {
          const linked = !!b.kind;
          const cls = gridBadgeCls[b.kind] || '';
          const badge = linked ? ('<span class="dz-link-tag ' + cls + '">' + (gridBadgeText[b.kind] || 'WF') + '</span>') : '';
          let dataAttr = '';
          if (linked) {
            const kindLabel = b.kind === 'wf' ? 'WF 연결: ' : b.kind === 'rp' ? '리포트 연결: ' : 'UI 팝업 연결: ';
            const title = withExtra(b.navKey, b.wfLabel || b.label, kindLabel + (b.wfLabel || b.label) + ' (클릭: 그래프 이동)');
            dataAttr = ' data-navkey="' + esc(b.navKey) + '" title="' + esc(title) + '"';
          }
          return '<button class="dz-btn' + (linked ? ' dz-linked' : '') + '"' + dataAttr + (linked ? ' type="button"' : ' disabled') + '>'
            + esc(b.label || b.id || 'button') + badge + '</button>';
        }).join('') + '</div>') : '';
        const linkedCls = (headLinks.length || toolbarBtns.some(b => b.kind)) ? ' dz-linked-multi' : '';
        // 실제 UI(재고이동등록 등)처럼 컬럼 제목+뱃지 표까지 재현 — 컬럼이 하나도 없다면(예:
        // 아직 컬럼 정의가 비어있는 그리드) 빈 문자열이라 기존처럼 헤더+툴바만 보인다.
        const columnsHtml = renderGridColumnsTableFromDefs(colDefs);
        // data-grid-id: 배포 스냅샷으로 일단 그려둔 뒤, z_grid_columns/z_grid_options 실시간 값이
        // 도착하면(app.js 쪽 백그라운드 조회) 이 div 를 찾아 컬럼 표만 갈아끼우기 위한 표식.
        const gridIdAttr = gid ? (' data-grid-id="' + esc(gid) + '"') : '';
        return '<div class="dz-grid' + linkedCls + '"' + gridIdAttr + '><div class="dz-grid-head">' + headLabel + headBadges + '</div>' + toolbarHtml + columnsHtml + '</div>';
      }
      // page 및 기타 래퍼(타입 없는 노드 포함)
      return kids;
    }

    // 본문(page.child) + 하단 버튼부(page.footer) 를 함께 렌더.
    // 대상 화면은 신규/저장/삭제 등 하단 버튼을 page.footer 서브트리에 따로 담는다.
    let out = renderNode(page);
    if (page.footer) {
      const footerHtml = renderNode(page.footer);
      if (footerHtml && footerHtml.trim())
        out += '<div class="dz-footer">' + footerHtml + '</div>';
    }
    return out;
  }

  // 그리드 액션 컬럼 버튼(Tracking No 팝업, 품목 팝업 등) → BTN_OPEN_POPUP 트리거로 변환.
  // 일반 팝업 버튼은 컴포넌트의 propertyValue.form[].programId 로 선언되지만(→ extractTriggers 가 처리),
  // 그리드 컬럼의 액션 버튼(dataType:"button" + cellTemplate)은 정적 HTML 조각과 RESOURCE_JS 의
  // jQuery 클릭 핸들러(`[data-lang-id="..."]` + `calleePgmId = '...'`)로만 구현되어 있어 JSON 구조만
  // 봐서는 대상이 전혀 보이지 않는다. cellTemplate 의 data-lang-id 로 컬럼 제목을 찾고,
  // RESOURCE_JS 안의 같은 data-lang-id 클릭 핸들러에서 팝업 대상 programId 를 찾아 서로 연결한다.
  function extractGridButtonTriggers(resourceJsonText, resourceJsText) {
    const out = [];
    if (!resourceJsonText || !resourceJsText) return out;
    // 1) JSON: cellTemplate 의 data-lang-id ↔ 같은 컬럼(object)의 title.
    //    title~cellTemplate 사이에는 render(JS 코드) 필드가 끼어 그 안에 { } 가 그대로 섞여 있는 경우가
    //    많아 텍스트 근접 매칭(regex)으로는 엉뚱한 옆 컬럼의 title 과 잘못 짝지어질 수 있다.
    //    실제 JSON을 파싱해 "같은 오브젝트 안"이라는 구조적 사실로 안전하게 매칭한다.
    // dataLangId -> { title, gridId } — gridId 는 이 컬럼(cellTemplate)을 담고 있는 가장 가까운
    // 그리드 컴포넌트(type=grid)의 gridOptions.gridId. 그래프에서 이 팝업을 "그리드N" 중간노드
    // 아래로 연결할지 판단하는 데 쓰인다(그리드 컬럼 버튼이 여는 팝업은 그 그리드에 속한 것으로 취급).
    const titleByLangId = {};
    try {
      const obj = JSON.parse(resourceJsonText);
      (function scan(o, curGridId) {
        if (!o || typeof o !== 'object') return;
        if (Array.isArray(o)) { o.forEach(x => scan(x, curGridId)); return; }
        let gridId = curGridId;
        if (o.type === 'grid') {
          const pv = o.propertyValue || {};
          gridId = (pv.gridOptions && pv.gridOptions.gridId) || o.target || curGridId;
        }
        if (typeof o.cellTemplate === 'string') {
          const idm = o.cellTemplate.match(/data-lang-id=['"]([a-zA-Z0-9_]+)['"]/);
          if (idm && o.title != null && !titleByLangId[idm[1]]) titleByLangId[idm[1]] = { title: o.title, gridId };
        }
        Object.keys(o).forEach(k => scan(o[k], gridId));
      })(obj, null);
    } catch (e) { /* JSON 파싱 실패 시 라벨/그리드 정보 없이 진행(대상 프로그램ID 는 JS 쪽에서 그대로 잡힘) */ }
    // 2) RESOURCE_JS: 각 [data-lang-id="X"] 클릭 핸들러 구간에서 팝업 대상(calleePgmId/programId) 탐색
    const marks = [];
    const idRe = /\[data-lang-id=["']([a-zA-Z0-9_]+)["']\]/g;
    let mk;
    while ((mk = idRe.exec(resourceJsText)) !== null) marks.push({ id: mk[1], idx: mk.index });
    marks.forEach((m, i) => {
      const end = i + 1 < marks.length ? marks[i + 1].idx : Math.min(resourceJsText.length, m.idx + 3000);
      const win = resourceJsText.slice(m.idx, end);
      const pm = win.match(/calleePgmId\s*=\s*['"]([^'"]+)['"]/) || win.match(/\bprogramId\s*[:=]\s*['"]([^'"]+)['"]/);
      if (pm && pm[1]) {
        const info = titleByLangId[m.id] || {};
        out.push({ event: 'BTN_OPEN_POPUP', programId: pm[1], label: info.title || m.id, dataLangId: m.id, gridButton: true, gridId: info.gridId || null });
      }
    });
    return out;
  }

  // 컴포넌트 트리(propertyValue)를 직접 순회해 BTN_WORKFLOW/BTN_OPEN_POPUP 트리거를 뽑아낸다.
  // extractTriggers() 는 RESOURCE_JSON 을 평문으로 놓고 "eventType" 매치 지점에서 앞쪽 2500자
  // 창(near())만 훑어 programId/serviceId 를 찾는데, beforeSubmit/afterSubmit 안에 긴 인라인
  // 스크립트가 들어있는 버튼(예: 여러 필드를 매핑하는 저장 후처리 로직)은 그 창을 넘겨버려
  // 트리거 자체가 통째로 스킵된다 — 결과적으로 파도타기(그래프 확장)에서 그 팝업/WF 가 아예
  // 빠지는데, 정작 디자인 미리보기 배지는 computeLinkMap()(JSON 구조를 그대로 타는 방식이라
  // 스크립트 길이에 영향받지 않음)로 만들어지므로 "배지는 있는데 눌러보면 연결 안 됨"이라는
  // 불일치가 생긴다. computeLinkMap() 과 동일한 구조적 순회를 여기서도 적용해 두 경로를
  // 항상 일치시킨다(정규식 스캔은 그대로 남겨 RESOURCE_JS/HTML 등 JSON 트리 밖의 케이스도 계속 잡는다).
  function extractStructuralButtonTriggers(resourceJsonText) {
    const out = [];
    if (!resourceJsonText) return out;
    let obj;
    try { obj = JSON.parse(resourceJsonText); } catch (e) { return out; }
    (function scan(o) {
      if (!o || typeof o !== 'object') return;
      if (Array.isArray(o)) { o.forEach(scan); return; }
      const pv = o.propertyValue || {};
      if (pv.eventType === 'BTN_WORKFLOW') {
        const serviceId = pv.serviceId || null;
        const serviceUid = pv.serviceUid != null ? String(pv.serviceUid) : null;
        if (serviceId || serviceUid) {
          out.push({ event: 'BTN_WORKFLOW', serviceId, serviceUid, serviceName: pv.serviceName || null, label: pv.label || pv.id || '' });
        }
      } else if (pv.eventType === 'BTN_OPEN_POPUP') {
        // programId 는 대부분 pv.form[].programId 안에 들어있다(최상위 pv.programId 는 드묾).
        const formPgmId = Array.isArray(pv.form) ? (pv.form.find(f => f && f.programId) || {}).programId : null;
        const programId = pv.programId || formPgmId;
        if (programId) out.push({ event: 'BTN_OPEN_POPUP', programId, label: pv.label || pv.id || '' });
      }
      Object.keys(o).forEach(k => scan(o[k]));
    })(obj);
    return out;
  }

  // UI/Mo 한 행 → 참조 목록 + 이벤트 트리거
  function parseUi(row) {
    const text = textOf(row, ['RESOURCE_JSON', 'RESOURCE_JS', 'RESOURCE_DTO', 'RESOURCE_HTML']);
    const seen = new Set();
    const triggerKey = (t) => t.event + '|' + (t.event === 'BTN_OPEN_POPUP' ? t.programId : (t.serviceUid ? 'u' + t.serviceUid : 's' + t.serviceId));
    const triggers = [];
    extractTriggers(text)
      .concat(extractGridButtonTriggers(row && row.RESOURCE_JSON, row && row.RESOURCE_JS))
      .concat(extractStructuralButtonTriggers(row && row.RESOURCE_JSON))
      .forEach(t => {
        const k = triggerKey(t);
        if (seen.has(k)) return;
        seen.add(k);
        triggers.push(t);
      });
    return { refs: extractServiceRefs(text), tables: [], queries: extractQueries(text), triggers, codes: extractCodes(text), reports: extractReportRefs(text) };
  }
  // Rp 한 행
  function parseRp(row) {
    const text = textOf(row, ['REPORT_JSON']);
    return { refs: extractServiceRefs(text), tables: extractTables(text), queries: extractQueries(text), triggers: [], codes: extractCodes(text), reports: extractReportRefs(text) };
  }
  // WF 한 행 → 하위 서비스 + 테이블 + 쿼리
  function parseWf(row) {
    const text = textOf(row, ['RESOURCE_WF']);
    return { refs: extractServiceRefs(text), tables: extractTables(text), queries: extractQueries(text), triggers: [], codes: extractCodes(text), reports: extractReportRefs(text) };
  }

  // RESOURCE_WF 텍스트에서 최상위 process 배열(스텝 목록)을 그대로 꺼낸다. 반복문/분기 등
  // 내부에 별도 흐름(child.process)을 가진 스텝까지 재귀적으로 평탄화해서 전부 모아준다 —
  // "이 WF 안의 쿼리를 전부 훑어서 보여주기" 같은 용도(예: 리포트 데이터 공급 WF의 쿼리 목록)에 쓴다.
  function collectAllWfSteps(resourceWfText) {
    let rwf;
    try { rwf = JSON.parse(resourceWfText); } catch (e) { return []; }
    const top = rwf && rwf.service && rwf.service.child && Array.isArray(rwf.service.child.process)
      ? rwf.service.child.process : [];
    const out = [];
    (function walk(arr) {
      (arr || []).forEach((p) => {
        out.push(p);
        if (p.child && Array.isArray(p.child.process)) walk(p.child.process);
      });
    })(top);
    return out;
  }

  // 실제 RESOURCE_HTML(원본 마크업)로 디자인을 그릴 때도 WF/UI/리포트 연결(클릭 이동) 배지를
  // 붙일 수 있도록, JSON 컴포넌트 트리를 스캔해 "id → 연결정보" 평면 맵을 만든다.
  // 여기서 id 는 원본 HTML의 id="..." 속성값과 동일한 값(pv.id, 또는 그리드/트리 target)이므로,
  // 렌더러(app.js) 쪽에서는 doc.getElementById(id) 로 그대로 매칭해 오버레이를 적용하면 된다.
  // id(컴포넌트id 또는 그리드id) → [{navKey,label,kind}, ...] (다중값).
  // 그리드는 여러 버튼이 서로 다른 WF 로 채우는 경우가 흔해 배열로 모으고, 나머지(버튼 등)는
  // 보통 1개뿐이지만 구조를 통일해 두면 렌더러(오버레이) 쪽 처리가 단순해진다.
  // 리포트 컴포넌트(activeReport)가 별도 z_rp_deploy_info 레코드 없이(또는 있어도 REPORT_JSON 이
  // 비어) 자기 자신의 RESOURCE_JSON 안에 reportJsonData 를 통째로 담고 있는 경우가 있다 — 예를 들어
  // "결의전표출력"처럼 화면 자체가 리포트 출력 미리보기 역할만 하는 패턴(reportProgramId 가 그 UI
  // 자신의 PROGRAM_ID 와 같은 값으로, 별도 리포트 배포 레코드를 가리키는 게 아니라 그냥 컴포넌트
  // 자신의 데이터소스 식별용으로만 쓰임). 이런 경우 Rp 뱃지를 눌러도 store 에서 그 navKey 로 찾을
  // 별도 노드가 없거나(또는 있어도 REPORT_JSON 이 비어) "표시할 디자인 리소스가 없습니다"로 막혀버
  // 렸다 — 정작 미리 볼 수 있는 리포트 정의가 바로 그 컴포넌트 안에 있는데도 말이다. 그래서 컴포넌트
  // id 기준으로 이 임베디드 reportJsonData 를 따로 정리해 두고, 클릭 시 store 조회가 실패하면
  // (bindDesignLinks) 여기서 바로 꺼내 쓸 수 있게 한다.
  function computeInlineReportMap(resourceJson) {
    const map = {};
    let obj;
    try { obj = JSON.parse(resourceJson); } catch (e) { return map; }
    (function scan(o) {
      if (!o || typeof o !== 'object') return;
      if (Array.isArray(o)) { o.forEach(scan); return; }
      const pv = o.propertyValue || {};
      if (pv.id && pv.reportJsonData && typeof pv.reportJsonData === 'object') {
        map[pv.id] = {
          reportJson: JSON.stringify(pv.reportJsonData),
          reportProgramId: pv.reportProgramId || pv.reportPgmId || pv.reportId || pv.rptProgramId || pv.id,
          reportProgramNm: pv.reportFileName || pv.id
        };
      }
      Object.keys(o).forEach(k => scan(o[k]));
    })(obj);
    return map;
  }

  function computeLinkMap(resourceJson, resourceJsText) {
    const map = {};
    const addLink = (id, link) => {
      if (!id) return;
      const arr = map[id] || (map[id] = []);
      if (!arr.some(x => x.navKey === link.navKey)) arr.push(link);
    };
    // (b)+(c) 그리드 target ↔ WF: computeGridServiceMap 재사용(중복 스캔 로직 제거).
    // form[].target 바인딩은 그리드가 아닌 화면 전체 폼(form)의 저장/조회 대상으로도 흔히 쓰이는데,
    // 그 경우 target 은 폼 전체 id(예: "SDSOMUI0005Form")라서 배지를 붙여도 화면 어디에도 마땅한
    // 자리가 없어(폼 콘텐츠 맨 끝에 덩그러니 뜨는) 오히려 헷갈린다. 실제 그리드 컴포넌트(type=grid)
    // 로 확인되는 target 에만 배지를 남긴다.
    const realGridIds = collectGridIds(resourceJson);
    const gridMap = computeGridServiceMap(resourceJson);
    Object.keys(gridMap).forEach(gid => {
      if (!realGridIds.has(gid)) return;
      gridMap[gid].forEach(l => addLink(gid, { navKey: l.navKey, label: l.label, kind: 'wf' }));
    });
    // 그리드 컬럼 버튼이 여는 팝업(Tracking No 팝업/품목참조 팝업 등)은 정적 마크업에 버튼 자체가
    // 없어(Wijmo 가 런타임에 그림) 화면 어디에도 표시할 자리가 없다. 그 그리드 자신에게 UI 배지로
    // 붙여, "이 그리드의 컬럼 버튼이 여는 팝업"이 있다는 걸 미리보기에서도 알 수 있게 한다.
    if (resourceJsText) {
      try {
        extractGridButtonTriggers(resourceJson, resourceJsText).forEach(t => {
          if (!t.gridId || !realGridIds.has(t.gridId) || !t.programId) return;
          if (looksLikeReportId(t.programId)) addLink(t.gridId, { navKey: 'Rp:' + t.programId, label: t.label || t.programId, kind: 'rp' });
          else addLink(t.gridId, { navKey: 'UI:' + t.programId, label: t.label || t.programId, kind: 'ui' });
        });
      } catch (e) { /* 무시 */ }
    }
    // 그리드 "툴바" 버튼(품목참조/재고현황처럼 화면마다 새로 추가되는 커스텀 버튼 포함)의 WF/UI 연결.
    // 컬럼 액션 버튼과 달리 RESOURCE_JS 매칭이 필요 없다 — 버튼 정의 자체의 eventType(BTN_WORKFLOW/
    // BTN_OPEN_POPUP)을 그대로 읽는다. eventType 이 없는 기본 버튼(행추가/행취소/행복사 등)은
    // extractGridToolbarButtonTriggers 가 이미 걸러내므로 로컬 전용 버튼에는 배지가 붙지 않는다.
    try {
      const toolbarMap = computeGridToolbarLinks(resourceJson);
      Object.keys(toolbarMap).forEach(gid => {
        if (!realGridIds.has(gid)) return;
        toolbarMap[gid].forEach(l => addLink(gid, l));
      });
    } catch (e) { /* 무시 */ }
    let obj;
    try { obj = JSON.parse(resourceJson); } catch (e) { return map; }
    (function scan(o) {
      if (!o || typeof o !== 'object') return;
      if (Array.isArray(o)) { o.forEach(scan); return; }
      // 아래 규칙들은 실제로 클릭 가능한 개별 컴포넌트(버튼/콤보 등, type:"component")에만
      // 적용한다. 최상위 page 객체 자신도 propertyValue.programId(자기 자신의 화면 ID를 적어두는
      // 메타데이터일 뿐, 다른 화면으로의 링크가 아님)를 갖고 있는데, page 는 type 이 없어(대신
      // compId 만 있음) 예전엔 pv.id 없음 때문에 자연히 걸러졌었다. 그런데 위 compKey 폴백(id 없는
      // 컴포넌트도 compId 로 찾게 한 수정)을 넣으면서 page 도 compId 를 갖고 있어 이 자기참조까지
      // "UI:자기자신" 이라는 가짜 배지로 잡혀버리는 회귀가 생겼다 — type==='component' 로 범위를
      // 좁혀 페이지/행/열/폼 등 레이아웃 래퍼 노드는 애초에 대상에서 제외한다.
      if (o.type === 'component') {
        const pv = o.propertyValue || {};
        // 이 컴포넌트를 실제 RESOURCE_HTML(DOM)에서 찾을 때 쓸 id. propertyValue.id 가 없는 컴포넌트도
        // 실무에서 흔한데(예: 입력창 옆 돋보기 팝업 버튼처럼 id를 따로 안 준 경우), 이런 경우 실제
        // 컴파일된 HTML은 "c" + compId(하이픈→언더스코어) 형태로 id를 자동 생성해 붙인다(예:
        // compId="button-uvrnn59cjsv" → id="cbutton_uvrnn59cjsv"). pv.id 만 보고 판단하면 이런
        // 컴포넌트는 map 에 아예 안 들어가 html 모드(applyHtmlLinkOverlay, DOM id로 조회)에서 절대
        // 배지가 안 붙는다 — json 모드(buildDesignHtml)는 id 없이도 컴포넌트를 직접 순회하며 그리므로
        // 이 문제가 없어, 같은 화면인데 모드에 따라 배지 유무가 갈리는 원인이었다.
        const compKey = pv.id || (o.compId ? ('c' + String(o.compId).replace(/-/g, '_')) : null);
        const svcUid = pv.serviceUid != null ? String(pv.serviceUid) : null;
        const svcId = pv.serviceId || null;
        const navKey = svcUid ? ('WF:u' + svcUid) : (svcId ? ('WF:s' + svcId) : null);
        const label = svcId || (svcUid ? ('uid=' + svcUid) : null);
        // (a) 컴포넌트 자체가 WF 서비스를 가짐 (버튼/콤보 등)
        if (navKey && compKey) addLink(compKey, { navKey, label, kind: 'wf' });
        // (a-2) BTN_USR_EVENT 버튼: 선언적 serviceId/serviceUid 바인딩이 없고, usrEventFn(커스텀 JS)
        //    안에서 ajax.postJson(... '/wf/{uid}/execute...' ...) 형태로 WF 를 직접 호출하는 경우가
        //    실무 화면(결의전표등록 저장 등)에 흔하다. 이 경우 (a) 규칙은 navKey 를 못 만들어 배지가
        //    전혀 안 붙는다 — 그래프(파도타기)에는 extractServiceRefs 가 잡아주지만, 디자인 미리보기
        //    배지는 이 컴포넌트 트리 스캔에서만 만들어지므로 여기서도 별도로 잡아줘야 한다.
        //    custom:true 로 표시해 배지/툴팁에서 "직접호출(스크립트)"임을 구분할 수 있게 한다.
        if (compKey && typeof pv.usrEventFn === 'string' && pv.usrEventFn.indexOf('/execute') !== -1) {
          const wfCallRe = /\/wf\/(\d+)\/execute/g;
          const seenUid = new Set();
          let wm;
          while ((wm = wfCallRe.exec(pv.usrEventFn)) !== null) {
            const uid = wm[1];
            if (seenUid.has(uid)) continue;
            seenUid.add(uid);
            addLink(compKey, { navKey: 'WF:u' + uid, label: 'uid=' + uid, kind: 'wf', custom: true });
          }
        }
        // (d) 팝업 UI 연결 — 대부분 최상위 pv.programId 가 아니라 BTN_OPEN_POPUP 패턴의
        //    pv.form[].programId 에 들어있다(예: btnOpenPop → form:[{programId:"SDSOPUI0001"}]).
        const formPgmId = Array.isArray(pv.form) ? (pv.form.find(f => f && f.programId) || {}).programId : null;
        const pgmId = pv.programId || formPgmId;
        if (compKey && pgmId) {
          if (looksLikeReportId(pgmId)) addLink(compKey, { navKey: 'Rp:' + pgmId, label: pgmId, kind: 'rp' });
          else addLink(compKey, { navKey: 'UI:' + pgmId, label: pgmId, kind: 'ui' });
        }
        // (e) 리포트 컴포넌트 — 대부분 최상위 pv.reportProgramId 가 아니라 BTN_REPORT_PREVIEW 패턴의
        //    pv.form[].reportProgramId 에 들어있다(예: "발주서" 출력 버튼). 이런 버튼은 예전 WF 바인딩이
        //    serviceId/serviceUid 로 함께 남아있어 위 (a)에서 이미 WF 배지가 붙는 경우가 흔한데, 그렇다고
        //    진짜 리포트 연결을 숨기면 안 되므로 WF 배지와 별개로 Rp 배지도 추가한다(그리드 WF1/WF2 처럼
        //    한 컴포넌트에 배지가 여러 개 붙는 것과 동일한 방식).
        const formRpId = Array.isArray(pv.form) ? (pv.form.find(f => f && f.reportProgramId) || {}).reportProgramId : null;
        const rpId = pv.reportProgramId || pv.reportPgmId || pv.reportId || pv.rptProgramId || formRpId;
        if (compKey && rpId) addLink(compKey, { navKey: 'Rp:' + rpId, label: rpId, kind: 'rp' });
      }
      Object.keys(o).forEach(k => scan(o[k]));
    })(obj);
    return map;
  }

  // ---- 리포트 헤더/데이터 공급 WF 안의 실제 라벨(header1~N) 추출 ----
  // 리포트 디자인(REPORT_JSON)에는 실제 값이 없고, b_report_file(_tenant)에 연결된 WF가 실행 시점에
  // headerN 자리를 실제 문자열로 채운다. 이 WF(RESOURCE_WF)를 스캔해서 그 하드코딩된 값을 찾는다.
  // 1) EntityDefinition/설정성 스텝의 JSON 구조: {"fieldId":"header3", ..., "value":"발주번호"}
  // 2) 단순조회형 WF의 SQL 리터럴: 'header3' AS header3 → '발주번호' AS header3
  // 둘 다 "추정"이며, WF 구조가 다르면 못 찾을 수 있다(그런 header는 그냥 {{headerN}} 그대로 남는다).
  function extractHeaderLabels(resourceWfText) {
    const labels = {};
    if (!resourceWfText) return labels;
    const HDR_RE = /^header\d+$/i;
    let rwf;
    try { rwf = JSON.parse(resourceWfText); } catch (e) { rwf = null; }
    if (rwf) {
      (function walk(o) {
        if (!o || typeof o !== 'object') return;
        if (Array.isArray(o)) { o.forEach(walk); return; }
        const key = o.fieldId || o.columnNm || o.name || o.Name;
        if (typeof key === 'string' && HDR_RE.test(key)) {
          const val = o.value != null ? o.value : o.Value;
          if (typeof val === 'string' && val && !val.startsWith('=') && val.toLowerCase() !== key.toLowerCase()) {
            labels[key.toLowerCase()] = val;
          }
        }
        Object.keys(o).forEach((k) => walk(o[k]));
      })(rwf);
    }
    // 보강: SQL 문자열 리터럴 'xxx' AS headerN 패턴(단순조회형 WF 대응) — JSON 파싱 결과에 없는 것만 채운다.
    const sqlRe = /['"]([^'"]*)['"]\s*AS\s*["']?(header\d+)["']?/gi;
    let m;
    while ((m = sqlRe.exec(resourceWfText)) !== null) {
      const lit = m[1], hdr = m[2].toLowerCase();
      if (lit && lit.toLowerCase() !== hdr && !(hdr in labels)) labels[hdr] = lit;
    }
    return labels;
  }

  // ---- ActiveReportsJS(RDLX-JSON) 리포트 "레이아웃 추정 미리보기" ----
  // 실제 ActiveReportsJS Viewer(유료 라이선스)를 쓰지 않고, REPORT_JSON 의 각 요소에 박혀있는
  // 절대좌표(Left/Top/Width/Height, in/pt 단위)와 스타일을 그대로 픽셀로 변환해 재구성한다.
  // 필드 바인딩 식(=Fields!xxx.Value 등)은 실제 값이 없으므로 {{xxx}} 자리표시자로 보여준다.
  // 실제 렌더링 엔진과 100% 동일하다는 보장은 없는 "구조 추정"이다.
  function buildReportPreviewHtml(reportJsonText, labelMap) {
    let rj;
    try { rj = JSON.parse(reportJsonText); } catch (e) { return null; }
    const sections = Array.isArray(rj.ReportSections) ? rj.ReportSections : [];
    if (!sections.length) return null;
    labelMap = labelMap || {};

    const DPI = 96; // 1in = 96px 기준으로 전부 환산
    function toPx(v) {
      if (v == null) return 0;
      if (typeof v === 'number') return v;
      const m = String(v).trim().match(/^(-?[\d.]+)\s*(in|pt|cm|mm|px)?$/i);
      if (!m) return 0;
      const n = parseFloat(m[1]);
      switch ((m[2] || 'in').toLowerCase()) {
        case 'pt': return n * (DPI / 72);
        case 'cm': return n * (DPI / 2.54);
        case 'mm': return n * (DPI / 25.4);
        case 'px': return n;
        default: return n * DPI; // in
      }
    }
    function escR(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
    // z_dd_lang 라벨에 줄바꿈 의도로 리터럴 "\n"(백슬래시+n 두 글자 — 누군가 입력창에 "\n"이라고
    // 직접 타이핑해 둔 것)이나 실제 개행문자가 그대로 들어있는 경우가 있다(좁은 헤더 셀에
    // "공급받는자"를 세로로 쌓으려던 의도로 보임). escR() 은 &<>" 만 이스케이프하고 이런 문자는
    // 그대로 통과시키므로, HTML에 그대로 꽂으면 한글 윈도우 글꼴에서 백슬래시가 ₩로 보여
    // "₩n"처럼 지저분하게 노출된다. escR() 이후에 적용해 실제 줄바꿈(<br>)으로 바꿔준다.
    function nlToBr(s) {
      return String(s == null ? '' : s)
        .replace(/\r\n|\r|\n/g, '<br>')  // 진짜 개행문자
        .replace(/\\n/g, '<br>');         // 리터럴 백슬래시+n 두 글자
    }
    // labelMap(z_dd_lang 조회 결과, buildDdDict()가 OBJECT_ID를 원본 표기 그대로 키로 사용해 만든 사전)
    // 에서 필드 라벨을 찾는다. 실제 운영 DB를 확인해보면(z_dd_lang 샘플 데이터 기준):
    //   - RDLX-JSON 헤더 셀은 "=First(Fields!BP_NM.Value,...)" 처럼 대문자+밑줄(UPPER_SNAKE_CASE)로
    //     DB 컬럼명과 동일하게 바인딩되어 있고, z_dd_lang.OBJECT_ID 도 'BP_NM' 처럼 원본 대문자
    //     그대로 등록돼 있다 — 즉 실제 버그는 "밑줄 유무"가 아니라 "대소문자"였다: 기존 코드가
    //     조회 키를 toLowerCase() 해버려서 labelMap['bp_nm']을 찾았는데 실제 키는 labelMap['BP_NM']
    //     이라 항상 못 찾고 {{HEADER_N}} 자리표시자가 남았다.
    //   - 반면 상세(디테일) 행 필드는 "=Fields!bpNm.Value" 처럼 camelCase로 바인딩된 경우도 있다
    //     (같은 리포트 안에 UPPER_SNAKE_CASE 헤더와 camelCase 디테일이 섞여 있음).
    // 그래서 원본 표기를 최우선으로 시도하고, 이후 대문자/소문자/camelCase↔UPPER_SNAKE_CASE 변환과
    // 밑줄 유무까지 폭넓게 시도해 어느 쪽 DB 표기든 라벨을 찾는다.
    function toUpperSnake(s) {
      return s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
    }
    function toLowerCamel(s) {
      return s.toLowerCase().replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
    }
    function lookupLabel(fieldName) {
      const raw = String(fieldName || '');
      if (!raw) return null;
      const candidates = [
        raw, raw.toUpperCase(), raw.toLowerCase(),
        toUpperSnake(raw), toLowerCamel(raw)
      ];
      for (const c of candidates) {
        if (labelMap[c] != null) return labelMap[c];
      }
      // 밑줄을 제거한 표기까지 마지막으로 시도(예: DB가 header1 처럼 등록된 경우)
      for (const c of candidates) {
        const noUnderscore = c.replace(/_/g, '');
        if (noUnderscore !== c && labelMap[noUnderscore] != null) return labelMap[noUnderscore];
      }
      return null;
    }
    // "=Fields!bpNm.Value" / "=First(Fields!header1.Value,\"DataSet1\")" / "=RowNumber()" 같은
    // 식을 사람이 읽기 쉬운 자리표시자로 단순화한다. 리터럴 텍스트(=로 시작 안 함)는 그대로 둔다.
    function valueOfR(v) {
      if (v == null) return '';
      const s = String(v);
      if (!s.startsWith('=')) return s;
      if (/^=\s*RowNumber\s*\(/.test(s)) return '#';
      let m = s.match(/Sum\(\s*Fields!([A-Za-z0-9_]+)\.Value/);
      if (m) { const lbl = lookupLabel(m[1]); return lbl != null ? lbl : ('{{합계:' + m[1] + '}}'); }
      m = s.match(/Fields!([A-Za-z0-9_]+)\.Value/);
      if (m) { const lbl = lookupLabel(m[1]); return lbl != null ? lbl : ('{{' + m[1] + '}}'); }
      return '{{식}}';
    }
    function styleOfR(st) {
      if (!st) return '';
      const css = [];
      if (st.Color) css.push('color:' + st.Color);
      if (st.BackgroundColor) css.push('background:' + st.BackgroundColor);
      if (st.FontSize) css.push('font-size:' + st.FontSize);
      if (st.FontWeight) css.push('font-weight:' + (st.FontWeight === 'SemiBold' ? '600' : st.FontWeight));
      // font-family 값에 큰따옴표를 쓰면(예: font-family:"Pretendard",sans-serif) 이 문자열
      // 전체가 나중에 HTML style="..." 속성 안에 그대로 들어가면서 그 큰따옴표가 속성을 조기
      // 종료시켜, 뒤따르는 text-align/padding/border 등이 전부 잘려나가는 심각한 버그가 있었다.
      // 홑따옴표를 쓰면 CSS 문법상으로도 유효하고 이 충돌이 없다.
      if (st.FontFamily) css.push("font-family:'" + st.FontFamily + "',sans-serif");
      if (st.TextAlign) css.push('text-align:' + String(st.TextAlign).toLowerCase());
      if (st.VerticalAlign) css.push('vertical-align:' + String(st.VerticalAlign).toLowerCase());
      const pad = [st.PaddingTop, st.PaddingRight, st.PaddingBottom, st.PaddingLeft];
      if (pad.some(p => p)) css.push('padding:' + pad.map(p => p || '0').join(' '));
      const b = st.Border || {};
      if (b.Width) css.push('border:' + b.Width + ' solid ' + (b.Color || '#ccc'));
      ['Top', 'Right', 'Bottom', 'Left'].forEach(side => {
        const bs = st[side + 'Border'];
        if (bs && bs.Width) css.push('border-' + side.toLowerCase() + ':' + bs.Width + ' solid ' + (bs.Color || '#ccc'));
      });
      return css.join(';');
    }
    // 이미지 바이너리(base64) 서명으로 MIME 타입을 추정한다. item.MIMEType 이 없을 때의 보조 수단.
    function sniffImageMime(b64) {
      const head = b64.slice(0, 16);
      if (head.startsWith('iVBORw0KGgo')) return 'image/png';
      if (head.startsWith('/9j/')) return 'image/jpeg';
      if (head.startsWith('R0lGOD')) return 'image/gif';
      if (head.startsWith('Qk0') || head.startsWith('Qk')) return 'image/bmp';
      if (head.startsWith('UklGR')) return 'image/webp';
      if (head.startsWith('PHN2Zy') || head.startsWith('PD94bWwg')) return 'image/svg+xml';
      return null; // 알려진 서명이 아니면 base64 이미지로 단정하지 않는다(오탐 방지)
    }
    // rj(REPORT_JSON) 최상위에 실려있는 임베디드 이미지 사전에서 이름으로 찾는다.
    // ActiveReportsJS RDLX-JSON 은 보통 EmbeddedImages(배열 또는 name 키 객체)에
    // {Name, MIMEType, ImageData(base64)} 형태로 담는다 — 실제 키 표기가 조금씩 달라도
    // 최대한 관용적으로 인식한다.
    function findEmbeddedImage(name) {
      if (!name) return null;
      const dict = rj.EmbeddedImages || rj.EmbeddedImage || rj.Images;
      if (!dict) return null;
      let entry = null;
      if (Array.isArray(dict)) entry = dict.find(x => x && (x.Name === name || x.name === name));
      else if (typeof dict === 'object') entry = dict[name] || Object.values(dict).find(x => x && (x.Name === name || x.name === name));
      if (!entry) return null;
      const data = entry.ImageData || entry.Value || entry.Data || entry.base64;
      if (!data) return null;
      const cleaned = String(data).replace(/\s+/g, '');
      if (/^data:image\//i.test(cleaned)) return cleaned;
      const mime = entry.MIMEType || entry.MimeType || sniffImageMime(cleaned) || 'image/png';
      return 'data:' + mime + ';base64,' + cleaned;
    }
    // 이미지 아이템(item.Value)이 실제로 표시 가능한 이미지 데이터인지 판단해 <img> 에 쓸 src 를 만든다.
    // - 이미 data:image/... 로 시작 → 그대로 사용
    // - Source=External 이고 http(s) URL → 그대로 사용(원격 이미지, 미리보기 환경에 따라 로드 안 될 수 있음)
    // - Value 가 임베디드 이미지 이름을 가리킴 → EmbeddedImages 에서 찾아 data URI 로 변환
    // - Value 자체가 접두사 없는 순수 base64 텍스트(길이·문자셋·서명으로 판별) → data URI 로 변환
    // 위 어디에도 해당 안 되면(예: "=Fields!photo.Value" 같은 식) null → 기존처럼 placeholder(🖼) 표시.
    function resolveImageSrc(item) {
      if (!item) return null;
      const v = item.Value != null ? String(item.Value) : '';
      if (!v) return null;
      if (/^data:image\//i.test(v)) return v;
      if (item.Source === 'External' && /^https?:\/\//i.test(v)) return v;
      const embedded = findEmbeddedImage(v);
      if (embedded) return embedded;
      const cleaned = v.replace(/\s+/g, '');
      // 너무 짧으면(수십 자 이하) 우연히 base64 문자셋/길이 조건만 맞는 일반 텍스트일 위험이 커서
      // 이미지로 보지 않는다 — 다만 아주 작은 아이콘(1x1~16x16 PNG 등)도 실제로 존재하므로
      // 기준을 40자로 낮게 잡고, 대신 알려진 이미지 서명(sniffImageMime) 또는 명시적 MIMEType
      // 힌트가 있을 때만 이미지로 인정한다(아래 mime 판정 부분).
      const looksB64 = cleaned.length >= 40 && /^[A-Za-z0-9+/]+={0,2}$/.test(cleaned) && cleaned.length % 4 === 0;
      if (looksB64) {
        const mime = item.MIMEType || sniffImageMime(cleaned);
        if (mime) return 'data:' + mime + ';base64,' + cleaned;
      }
      return null;
    }
    function renderImageTag(item, maxHeightPx) {
      const src = resolveImageSrc(item);
      if (!src) return null;
      const hStyle = maxHeightPx ? ('max-height:' + maxHeightPx + 'px;') : 'max-height:100%;';
      return '<img src="' + escR(src) + '" alt="' + escR(item.Name || '이미지') + '" style="max-width:100%;' + hStyle + 'object-fit:contain;display:inline-block">';
    }
    // 표 셀(<td>/<th>) 안에 들어갈 내용물(포지셔닝 없이). 이미지 / rectangle·list 같은 중첩
    // 컨테이너(하위 ReportItems 를 절대좌표로 담음) / 일반 텍스트박스를 공용으로 처리한다.
    // (예: 결의전표 헤더의 "회계일자/코스트센터/전표번호" 줄은 실제로는 텍스트박스가 아니라
    //  rectangle 하나가 그 안에 텍스트박스 여러 개를 절대좌표로 담고 있는 "합성 셀"이다 —
    //  이를 처리하지 않으면 그 줄 전체가 빈 칸으로 사라진다.)
    function renderCellContent(it, rowHeightPx) {
      if (!it) return '';
      if (it.Type === 'image') {
        const imgTag = renderImageTag(it, rowHeightPx || toPx(it.Height) || 60);
        return imgTag || '🖼';
      }
      if (Array.isArray(it.ReportItems) && it.ReportItems.length) {
        const h = toPx(it.Height) || rowHeightPx || 24;
        return '<div style="position:relative;min-height:' + h + 'px">' + it.ReportItems.map(x => renderItemR(x)).join('') + '</div>';
      }
      return nlToBr(escR(valueOfR(it.Value)));
    }
    function renderRowsR(rowsHolder, tag) {
      if (!rowsHolder || !Array.isArray(rowsHolder.TableRows)) return '';
      return rowsHolder.TableRows.map((row) => {
        const cells = Array.isArray(row.TableCells) ? row.TableCells : [];
        const rowHeightPx = toPx(row.Height);
        const tds = cells.map((c) => {
          if (!c || !c.Item) return ''; // null 셀은 앞선 셀의 ColSpan/RowSpan 에 흡수된 자리 — 태그 자체를 만들지 않는다.
          const it = c.Item;
          const cs = c.ColSpan && c.ColSpan > 1 ? ' colspan="' + c.ColSpan + '"' : '';
          // RowSpan 을 실제 rowspan 속성으로 내보내지 않으면, 다음 행에서 그 칸이 비어있는 셈이 되어
          // 이후 셀들이 전부 한 칸씩 밀려 보이는(컬럼이 어긋나는) 버그가 난다 — 결의전표가 완전히
          // 깨져 보였던 원인 중 하나.
          const rs = c.RowSpan && c.RowSpan > 1 ? ' rowspan="' + c.RowSpan + '"' : '';
          const st = styleOfR(it.Style);
          const content = renderCellContent(it, rowHeightPx);
          return '<' + tag + cs + rs + (st ? ' style="' + st + '"' : '') + '>' + content + '</' + tag + '>';
        }).join('');
        return '<tr style="height:' + rowHeightPx + 'px">' + tds + '</tr>';
      }).join('');
    }
    function renderTableR(item) {
      const cols = Array.isArray(item.TableColumns) ? item.TableColumns : [];
      const colgroup = '<colgroup>' + cols.map((c) => '<col style="width:' + toPx(c.Width) + 'px">').join('') + '</colgroup>';
      let html = '<table class="rp-table">' + colgroup;
      // ActiveReportsJS RDLX-JSON 표는 고정 Header/Footer 외에, TableGroups[].Header/Footer 에
      // 그룹(예: 전표번호별) 반복 헤더/합계가 따로 실려있는 경우가 흔하다(이 결의전표가 그 예:
      // item.Header 는 아예 없고, "회계일자/코스트센터/…" 헤더 전체와 "관리항목" 바가 전부
      // TableGroups[0].Header 안에 있다). item.Header/Footer 만 보던 예전 코드는 이걸 완전히
      // 놓쳐서 헤더가 통째로 사라졌었다 — 바깥→안쪽 그룹 순서로 모아 한 번씩(정적 미리보기이므로
      // 그룹마다 반복은 하지 않고 맨 위/맨 아래에 한 번만) 보여준다.
      const headerBlocks = [];
      if (item.Header) headerBlocks.push(item.Header);
      (item.TableGroups || []).forEach(g => { if (g && g.Header) headerBlocks.push(g.Header); });
      if (headerBlocks.length) html += '<thead>' + headerBlocks.map(h => renderRowsR(h, 'th')).join('') + '</thead>';
      if (item.Details) {
        html += '<tbody class="rp-details">' + renderRowsR(item.Details, 'td')
          + '<tr class="rp-repeat-note"><td colspan="' + Math.max(cols.length, 1) + '">🔁 실제 데이터 행 수만큼 이 행이 반복됩니다</td></tr></tbody>';
      }
      // 푸터는 안쪽 그룹 합계부터 바깥쪽(테이블 전체) 합계 순서로.
      const footerBlocks = [];
      (item.TableGroups || []).slice().reverse().forEach(g => { if (g && g.Footer) footerBlocks.push(g.Footer); });
      if (item.Footer) footerBlocks.push(item.Footer);
      if (footerBlocks.length) html += '<tfoot>' + footerBlocks.map(f => renderRowsR(f, 'td')).join('') + '</tfoot>';
      html += '</table>';
      return html;
    }
    // topOverridePx: 최상위(섹션 Body 직속) 아이템에서만 layoutTopLevelItems() 가 계산한
    // "밀림 보정" 좌표를 넘겨준다. 중첩 컨테이너(rectangle/list) 안쪽 아이템은 인자 없이
    // 재귀 호출되므로 원래 선언된 item.Top 을 그대로 쓴다(상대 좌표라 보정 대상이 아님).
    // isTopLevel: true 면 data-rp-top/data-declared-top/data-declared-h 를 함께 찍어서, 문서
    // 하단의 런타임 스크립트(layoutRpPages)가 "실제 렌더된 높이"를 재서 한 번 더 정교하게
    // 밀어내릴 수 있게 한다(정적 추정치는 텍스트 줄바꿈까지는 못 맞히므로 — 아래 주석 참고).
    function renderItemR(item, topOverridePx, isTopLevel) {
      if (!item) return '';
      const left = toPx(item.Left), top = (topOverridePx != null ? topOverridePx : toPx(item.Top)), width = toPx(item.Width), height = toPx(item.Height);
      let pos = 'position:absolute;left:' + left + 'px;top:' + top + 'px;width:' + width + 'px;';
      const topAttrs = isTopLevel
        ? ' data-rp-top="1" data-declared-top="' + toPx(item.Top) + '" data-declared-h="' + height + '"'
        : '';
      if (item.Type === 'table') return '<div' + topAttrs + ' style="' + pos + '" class="rp-table-wrap">' + renderTableR(item) + '</div>';
      pos += 'height:' + height + 'px;';
      if (item.Type === 'image') {
        const imgTag = renderImageTag(item, height || null);
        if (imgTag) return '<div' + topAttrs + ' style="' + pos + styleOfR(item.Style) + '" class="rp-image rp-image-real">' + imgTag + '</div>';
        return '<div' + topAttrs + ' style="' + pos + styleOfR(item.Style) + '" class="rp-image">🖼 ' + escR(item.Value || item.Name || '이미지') + '</div>';
      }
      // rectangle/list 등, 자기 값(Value) 없이 하위 ReportItems 를 절대좌표로 담기만 하는 컨테이너.
      // 안쪽 아이템의 Top/Left 는 이 컨테이너 기준 좌표이므로, position:relative 인 내부 래퍼를
      // 하나 더 둬서 그 좌표 기준점을 만들어준다(바깥 div 자체는 부모 기준 position:absolute).
      if (Array.isArray(item.ReportItems) && item.ReportItems.length) {
        return '<div' + topAttrs + ' style="' + pos + styleOfR(item.Style) + '" class="rp-container">'
          + '<div style="position:relative;width:100%;height:100%">' + item.ReportItems.map(it => renderItemR(it)).join('') + '</div>'
          + '</div>';
      }
      // textbox 및 그 외 알 수 없는 타입은 텍스트 박스로 대체 표시
      return '<div' + topAttrs + ' style="' + pos + styleOfR(item.Style) + '" class="rp-textbox">' + nlToBr(escR(valueOfR(item.Value))) + '</div>';
    }
    // 표 하나의 실제 렌더 높이(대략치)를 헤더/디테일/푸터 각 행의 선언된 Height 합으로 추정한다.
    // 아이템의 item.Height(원래 RDLX 가 선언한 "표 자체" 높이)는 우리가 TableGroups 의 Header/Footer
    // 까지 붙여 그리면서 이미 더 커진 실제 표 높이와 다를 수 있어(대개 더 짧게 잡혀 있음) 그대로
    // 못 믿는다 — 이 추정치가 다음의 페이지 높이 계산에 쓰인다.
    function sumRowsHeightR(rowsHolder) {
      if (!rowsHolder || !Array.isArray(rowsHolder.TableRows)) return 0;
      return rowsHolder.TableRows.reduce((sum, r) => sum + (toPx(r.Height) || 0), 0);
    }
    function estimateTableHeightR(item) {
      let h = 0;
      if (item.Header) h += sumRowsHeightR(item.Header);
      (item.TableGroups || []).forEach(g => { if (g && g.Header) h += sumRowsHeightR(g.Header); });
      if (item.Details) h += sumRowsHeightR(item.Details) + 24; // + "🔁 반복" 안내행 대략치
      (item.TableGroups || []).forEach(g => { if (g && g.Footer) h += sumRowsHeightR(g.Footer); });
      if (item.Footer) h += sumRowsHeightR(item.Footer);
      return h;
    }
    // 한 섹션 Body 에 최상위(직속) 아이템이 여러 개 세로로 쌓여 있는 보고서(예: 거래명세서의
    // "공급자 보관용"/"공급받는자 보관용" 두 장을 한 페이지에 위아래로 붙여 찍는 표 2개)에서,
    // 뒤 아이템(예: 아래쪽 표)의 Top 은 RDLX 설계 시점에 "앞 아이템(위쪽 표)이 딱 그 선언된
    // Height(item.Height) 만큼만 차지한다"는 가정으로 고정된 절대좌표다. 그런데 우리는 표를
    // 실제 ActiveReportsJS 처럼 흐름(reflow)시키지 않고 각 아이템을 그대로 position:absolute 로
    // 박아 넣고, 게다가 TableGroups 헤더/"🔁 반복" 안내행까지 덧붙여 그리기 때문에 실제 렌더
    // 높이가 선언된 item.Height 보다 커지기 일쑤다 — 그러면 앞 표의 내용이 자기 영역을 넘어
    // 아래로 흘러내려, 고정 좌표에 그대로 그려지는 뒷 표와 글자 단위로 뒤섞여 겹쳐 보인다
    // (거래명세서 2장이 서로 겹쳐 보이던 버그의 원인). 실제 페이지 레이아웃 엔진처럼, 위쪽
    // 아이템이 선언보다 더 커진 만큼을 누적해 그 아래(선언 Top 이 더 큰) 아이템들을 함께
    // 밀어내려서 겹치지 않게 한다. 다만 "위/아래로 쌓인 밴드"에만 안전하게 적용되도록, 자기보다
    // 원래 더 위(Top 이 작거나 같음)에 있던 아이템은 밀지 않는다(같은 줄에 나란히 놓인 아이템까지
    // 잘못 밀려나 정렬이 깨지는 것을 막기 위함).
    function layoutTopLevelItems(items) {
      const withTop = items.map((it, idx) => ({ it, idx, top: it ? toPx(it.Top) : 0 }));
      const order = withTop.slice().sort((a, b) => (a.top - b.top) || (a.idx - b.idx));
      const adjTop = new Map();
      let shift = 0;
      order.forEach(({ it, top }) => {
        if (!it) return;
        adjTop.set(it, top + shift);
        const declaredH = toPx(it.Height);
        const actualH = it.Type === 'table' ? Math.max(declaredH, estimateTableHeightR(it)) : declaredH;
        const overflow = actualH - declaredH;
        if (overflow > 0) shift += overflow;
      });
      return adjTop;
    }
    const pageWidthFallback = toPx((rj.Page && rj.Page.PageWidth) || '8.5in');
    let out = '';
    sections.forEach((sec) => {
      const body = sec.Body || {};
      const items = Array.isArray(body.ReportItems) ? body.ReportItems : [];
      const adjTop = layoutTopLevelItems(items);
      let secHeight = toPx(body.Height) || 400;
      // Body.Height 는 RDLX 가 선언한 "기본" 높이일 뿐, 실제로는 각 아이템(특히 표: 헤더/그룹헤더/
      // 디테일/그룹푸터/푸터를 전부 이어붙인 실제 표 높이)이 그보다 더 아래까지 내려갈 수 있다.
      // 짧게 잡으면 아래쪽 내용(예: 합계 행)이 페이지 밖으로 잘려나가므로, 각 아이템의 실제 하단
      // (밀림 보정된 top + 높이)을 계산해 필요하면 페이지 높이를 그만큼 늘린다.
      items.forEach(it => {
        if (!it) return;
        const top = adjTop.get(it);
        const h = it.Type === 'table' ? estimateTableHeightR(it) : toPx(it.Height);
        secHeight = Math.max(secHeight, top + h + 20);
      });
      // 섹션 자체의 Width(콘텐츠 캔버스 폭)가 있으면 그걸 쓴다 — 실제 종이 크기(Page.PageWidth)와
      // 다를 수 있다(가로로 넓은 표를 портrait 용지에 축소 출력하는 보고서가 흔함).
      const pageWidth = toPx(sec.Width) || pageWidthFallback;
      out += '<div class="rp-page" style="width:' + pageWidth + 'px;min-height:' + secHeight + 'px">'
        + items.map(it => renderItemR(it, adjTop.get(it), true)).join('') + '</div>';
    });
    // 위 layoutTopLevelItems() 의 밀림 보정은 "선언된 행 높이의 합"만으로 추정한 정적 근사치라,
    // 실제 브라우저가 텍스트를 줄바꿈하면서 행이 더 늘어나는 것까지는 맞히지 못한다(예: 라벨을
    // 못 찾아 "{{HEADER_12}}" 같은 긴 자리표시자가 좁은 칸에서 여러 줄로 접히거나, 실제 한글
    // 라벨이라도 칸보다 길면 줄바꿈된다) — 이런 경우 정적 추정만으로는 부족해 표끼리 여전히
    // 겹쳐 보일 수 있다. 그래서 문서가 실제로 렌더된 뒤 각 최상위 아이템의 진짜 높이
    // (offsetHeight)를 다시 재서 한 번 더 정교하게 밀어내리는 스크립트를 붙인다(레이아웃 엔진의
    // reflow 를 흉내). data-rp-top="1" 이 찍힌 요소만 대상(중첩 컨테이너 내부는 상대좌표라 제외).
    out += '<script>(function(){\n'
      + 'function layoutRpPages(){\n'
      + '  document.querySelectorAll(".rp-page").forEach(function(page){\n'
      + '    var kids = Array.prototype.filter.call(page.children, function(el){\n'
      + '      return el.getAttribute && el.getAttribute("data-rp-top") === "1";\n'
      + '    });\n'
      + '    var withMeta = kids.map(function(el, idx){\n'
      + '      return { el: el, idx: idx, top: parseFloat(el.getAttribute("data-declared-top")) || 0,\n'
      + '        declaredH: parseFloat(el.getAttribute("data-declared-h")) || 0 };\n'
      + '    });\n'
      + '    withMeta.sort(function(a, b){ return (a.top - b.top) || (a.idx - b.idx); });\n'
      + '    var shift = 0, maxBottom = 0;\n'
      + '    withMeta.forEach(function(m){\n'
      + '      var newTop = m.top + shift;\n'
      + '      m.el.style.top = newTop + "px";\n'
      + '      var actualH = m.el.offsetHeight || m.declaredH;\n'
      + '      var bottom = newTop + actualH;\n'
      + '      if (bottom > maxBottom) maxBottom = bottom;\n'
      + '      var overflow = actualH - m.declaredH;\n'
      + '      if (overflow > 0) shift += overflow;\n'
      + '    });\n'
      + '    if (maxBottom + 20 > page.offsetHeight) page.style.minHeight = (maxBottom + 20) + "px";\n'
      + '  });\n'
      + '}\n'
      + 'if (document.readyState === "complete" || document.readyState === "interactive") layoutRpPages();\n'
      + 'else document.addEventListener("DOMContentLoaded", layoutRpPages);\n'
      + 'window.addEventListener("load", layoutRpPages);\n' // 폰트/이미지 로드 후 실제 높이가 또 바뀔 수 있어 한 번 더
      + '})();</script>';
    return out;
  }

  return { extractServiceRefs, extractTables, extractQueries, extractTriggers, extractGridButtonTriggers, extractGridToolbarButtonTriggers, computeGridToolbarLinks, computeGridToolbarButtonList, extractCodes, extractReportRefs, looksLikeReportId, buildDesignHtml, buildReportPreviewHtml, extractHeaderLabels, collectAllWfSteps, extractLangMap, computeLinkMap, computeInlineReportMap, computeInitValueMap, computeGridServiceMap, collectGridIds, collectGridOptionsMap, computeGridColumnDefs, computeGridColumnPopups, mapLiveGridColumns, renderGridColumnsTableFromDefs, buildGridColumnsTableHtml, parseUi, parseRp, parseWf, textOf };
});
