/* 수집 바구니 + 저장(JSON/CSV) 로직 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WaveStore = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  // node: { key, type:'UI'|'WF'|'Rp'|'Mo'|'TABLE', id, uid, name, module, depth, raw }
  // edge: { from, to, relType }
  function makeStore() {
    const nodes = new Map();   // key -> node
    const edges = new Map();   // "from->to" -> edge
    const basket = new Set();  // 담긴 node key

    function nodeKey(type, id, uid) {
      if (type === 'WF') return 'WF:' + (uid != null ? ('u' + uid) : ('s' + id));
      if (type === 'TABLE') return 'TABLE:' + id;
      return type + ':' + id;
    }
    function addNode(n) {
      const key = n.key || nodeKey(n.type, n.id, n.uid);
      n.key = key;
      if (!nodes.has(key)) nodes.set(key, n);
      else {
        const ex = nodes.get(key);
        // 보강
        if (n.name && (!ex.name || ex.name === ex.id || n.menuNm)) ex.name = n.name;
        if (ex.uid == null && n.uid != null) ex.uid = n.uid;
        if (!ex.raw && n.raw) ex.raw = n.raw;
        if (!ex.triggers && n.triggers) ex.triggers = n.triggers;
        if (!ex.menuNm && n.menuNm) ex.menuNm = n.menuNm;
        if (!ex.module && n.module) ex.module = n.module;
        if (n.depth != null && (ex.depth == null || n.depth < ex.depth)) ex.depth = n.depth;
      }
      return nodes.get(key);
    }
    function addEdge(from, to, relType) {
      const k = from + '->' + to;
      if (!edges.has(k)) edges.set(k, { from, to, relType: relType || 'ref' });
      return edges.get(k);
    }
    function toggleBasket(key, on) {
      if (on === undefined) on = !basket.has(key);
      if (on) basket.add(key); else basket.delete(key);
      return basket.has(key);
    }
    function clear() { nodes.clear(); edges.clear(); basket.clear(); }
    function clearBasket() { basket.clear(); }

    function counts(keysOpt) {
      const keys = keysOpt || [...nodes.keys()];
      const c = { UI: 0, WF: 0, Rp: 0, Mo: 0, TABLE: 0 };
      keys.forEach(k => { const n = nodes.get(k); if (n && c[n.type] != null) c[n.type]++; });
      return c;
    }

    return {
      nodes, edges, basket, nodeKey, addNode, addEdge, toggleBasket, clear, clearBasket, counts,
      allKeys: () => [...nodes.keys()],
      basketKeys: () => [...basket]
    };
  }

  /* ---------- 저장 포맷 ---------- */

  function csvEscape(v) {
    if (v == null) return '';
    const s = String(v).replace(/\r?\n/g, ' ');
    return /[",]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  // 각 Wave 타입의 원본 테이블명 + 전체 컬럼 순서 (wave.xlsx 스키마 기준)
  var TABLE_COLUMNS = {
    UI: ['TENANT_ID','CO_CD','PROGRAM_ID','PROGRAM_NM','DESCRIPTION','MODULE_CD','RESOURCE_JSON','RESOURCE_JS','RESOURCE_HTML','REQUEST_DT','REQUESTER','DEPLOY_DT','DEPLOYER','DEPLOY_STATUS','DEPLOY_ERROR_LOG','USE_YN','RESOURCE_DTO','PROGRAM_TYPE','PARENT_PROGRAM_ID','DATA_MODEL_ID','INSRT_USER_ID','INSRT_DT','UPDT_USER_ID','UPDT_DT','PGM_ID','SP_NM','IP_ADDR','CLIENT_ID','PRODUCT_CD','patch_version','RESOURCE_CSS'],
    WF: ['TENANT_ID','CO_CD','SERVICE_UID','SERVICE_ID','SERVICE_TYPE','SERVICE_NAME','DESCRIPTION','RESOURCE_WF','REQUEST_DT','REQUESTER','DEPLOY_DT','DEPLOYER','DEPLOY_STATUS','DEPLOY_ERROR_LOG','USE_YN','INSRT_USER_ID','INSRT_DT','UPDT_USER_ID','UPDT_DT','PGM_ID','SP_NM','IP_ADDR','CLIENT_ID','PRODUCT_CD','patch_version'],
    Mo: ['TENANT_ID','CO_CD','APP_MST_ID','PROGRAM_ID','PROGRAM_NM','DESCRIPTION','RESOURCE_JSON','RESOURCE_JS','RESOURCE_HTML','REQUEST_DT','REQUESTER','DEPLOY_DT','DEPLOYER','DEPLOY_STATUS','DEPLOY_ERROR_LOG','USE_YN','RESOURCE_DTO','PROGRAM_TYPE','PARENT_PROGRAM_ID','DATA_MODEL_ID','APP_LAYOUT_ID','TMPL_TYPE','LAYOUT_PRESET_ID','LAYOUT_TYPE','LAYOUT_CONTENT','INSRT_USER_ID','INSRT_DT','UPDT_USER_ID','UPDT_DT','PGM_ID','SP_NM','IP_ADDR','CLIENT_ID','PRODUCT_CD','patch_version'],
    Rp: ['REPORT_PROGRAM_UID','TENANT_ID','CO_CD','REPORT_PROGRAM_ID','REPORT_PROGRAM_NM','REPORT_PROGRAM_DESC','REPORT_FILE_UID','REPORT_FILE_NM','REPORT_FILE_DESC','REPORT_JSON','MODULE_CD','REQUEST_DT','REQUESTER','DEPLOY_DT','DEPLOYER','DEPLOY_STATUS','DEPLOY_ERROR_LOG','USE_YN','REPORT_TYPE','PATCH_VERSION','INSRT_USER_ID','INSRT_DT','UPDT_USER_ID','UPDT_DT','PGM_ID','SP_NM','IP_ADDR','CLIENT_ID']
  };
  var TABLE_NAME = { UI: 'z_ui_deploy_info', WF: 'z_wf_deploy_info', Mo: 'z_mo_deploy_info', Rp: 'z_rp_deploy_info' };

  // 선택된 node key 집합 → JSON(nodes+edges) 문자열
  // 각 노드에 원본 행 전체(raw)를 record 로 포함 → 4개 테이블의 모든 컬럼 데이터 보존
  function buildJson(store, keys, meta) {
    const set = new Set(keys);
    const outNodes = keys.map(k => {
      const n = store.nodes.get(k);
      const o = {
        key: n.key, type: n.type, id: n.id, uid: n.uid, name: n.name || '',
        module: n.module || '', depth: n.depth != null ? n.depth : null
      };
      // 조회 상태 플래그도 함께 보존한다. 저장 안 하면 .erp를 다시 불러왔을 때
      // "아직 조회를 시도하지 않았습니다" 같은 부정확한 안내로 보일 수 있다.
      if (n._expanded) o._expanded = true;
      if (n._missing) o._missing = true;
      if (n._depthLimited) o._depthLimited = true;
      if (n.cycle) o.cycle = true;
      // 원본 테이블 레코드(모든 컬럼). raw 가 있으면 전체 컬럼을 그대로 보존.
      if (n.raw) {
        o.table = TABLE_NAME[n.type] || null;
        o.record = n.raw;
      }
      return o;
    });
    const outEdges = [...store.edges.values()].filter(e => set.has(e.from) && set.has(e.to));
    // 테이블별로도 원본 레코드를 모아 제공(분석/재적재 편의)
    const records = { z_ui_deploy_info: [], z_wf_deploy_info: [], z_mo_deploy_info: [], z_rp_deploy_info: [] };
    keys.forEach(k => {
      const n = store.nodes.get(k);
      if (n && n.raw && TABLE_NAME[n.type]) records[TABLE_NAME[n.type]].push(n.raw);
    });
    return JSON.stringify({
      meta: Object.assign({ generatedAt: new Date().toISOString(), tool: 'Daaf Wave' }, meta || {}),
      summary: store.counts(keys),
      nodes: outNodes,
      edges: outEdges,
      records: records
    }, null, 2);
  }

  // 타입별 CSV (원본 테이블 전체 컬럼을 헤더/값으로) → { 'z_ui_deploy_info.csv': '...', ... }
  function buildCsvByType(store, keys) {
    const byType = { UI: [], WF: [], Rp: [], Mo: [], TABLE: [] };
    keys.forEach(k => { const n = store.nodes.get(k); if (n && byType[n.type]) byType[n.type].push(n); });
    const files = {};

    ['UI', 'WF', 'Mo', 'Rp'].forEach(t => {
      if (!byType[t].length) return;
      const cols = TABLE_COLUMNS[t];
      const lines = [cols.join(',')];
      byType[t].forEach(n => {
        const raw = n.raw || {};
        // raw 가 없을 때를 대비한 최소 폴백 매핑
        if (!n.raw) {
          if (t === 'WF') { raw.SERVICE_UID = n.uid; raw.SERVICE_ID = n.id; raw.SERVICE_NAME = n.name; }
          else if (t === 'Rp') { raw.REPORT_PROGRAM_ID = n.id; raw.REPORT_PROGRAM_NM = n.name; raw.MODULE_CD = n.module; }
          else { raw.PROGRAM_ID = n.id; raw.PROGRAM_NM = n.name; raw.MODULE_CD = n.module; }
        }
        lines.push(cols.map(c => csvEscape(raw[c])).join(','));
      });
      files[TABLE_NAME[t] + '.csv'] = '\uFEFF' + lines.join('\r\n');  // BOM (엑셀 한글)
    });

    // 참조 테이블(TABLE) 목록은 별도 CSV
    if (byType.TABLE.length) {
      const lines = ['TABLE_NM,DEPTH'];
      byType.TABLE.forEach(n => lines.push([n.id, n.depth].map(csvEscape).join(',')));
      files['referenced_tables.csv'] = '\uFEFF' + lines.join('\r\n');
    }

    // 관계(edge) CSV
    const set = new Set(keys);
    const edgeLines = ['FROM,TO,REL_TYPE'];
    [...store.edges.values()].filter(e => set.has(e.from) && set.has(e.to))
      .forEach(e => edgeLines.push([e.from, e.to, e.relType].map(csvEscape).join(',')));
    if (edgeLines.length > 1) files['edges.csv'] = '\uFEFF' + edgeLines.join('\r\n');
    return files;
  }

  return { makeStore, buildJson, buildCsvByType };
});
