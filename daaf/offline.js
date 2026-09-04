/* 오프라인 데이터 관리 UI + 상태 (단일 파일 방식) */
window.WaveOffline = (function () {
  const el = (id) => document.getElementById(id);
  const TABLE_LABELS = {
    menu: '메뉴(검색)', ui_deploy: 'UI 화면', wf_deploy: 'WF 워크플로우', rp_deploy: 'Rp 리포트',
    mo_deploy: 'Mo 모바일', dd: '다국어 정의(z_dd)', dd_lang: '다국어 라벨(z_dd_lang)',
    // 리포트 "SQL 보기" 패널을 오프라인에서도 쓰려면 필요 — report_link(b_report_file)는 필수,
    // report_link_tenant(b_report_file_tenant)는 테넌트별 오버라이드가 있을 때만 선택적으로 받으면 된다.
    report_link: '리포트-WF 연결(b_report_file)', report_link_tenant: '리포트-WF 연결 테넌트 오버라이드(b_report_file_tenant, 선택)',
    // "IV"(초기값 추적) 상세패널의 "지금 값 조회" 버튼을 오프라인에서도 쓰려면 필요.
    config_ref: '초기값 기준코드(B_CONFIGURATION_V)',
    // 그리드 컬럼/옵션 실시간 구성 — 관리자가 그리드 커스터마이징으로 배포 없이 바꾼 컬럼 순서/
    // 표시여부/제목/폭 등을 파도타기 미리보기에도 반영하려면 필요. grid_columns/grid_options는
    // 필수(전역 기본), _tenant 는 테넌트별 오버라이드가 있을 때만 선택적으로 받으면 된다.
    grid_columns: '그리드 컬럼 구성(z_grid_columns)', grid_columns_tenant: '그리드 컬럼 테넌트 오버라이드(z_grid_columns_tenant, 선택)',
    grid_options: '그리드 옵션(z_grid_options)', grid_options_tenant: '그리드 옵션 테넌트 오버라이드(z_grid_options_tenant, 선택)'
  };
  const ALL_TABLES = ['menu', 'ui_deploy', 'wf_deploy', 'rp_deploy', 'mo_deploy', 'dd', 'dd_lang', 'report_link', 'report_link_tenant', 'config_ref', 'grid_columns', 'grid_columns_tenant', 'grid_options', 'grid_options_tenant'];

  const state = { filePath: '', manifest: null, active: false, busy: false };
  let getCfg = null, getProductCd = null, getLang = null, onModeChange = null, onDataChange = null, setStatus = null;

  function init(opts) {
    getCfg = opts.getCfg; getProductCd = opts.getProductCd; getLang = opts.getLang;
    onModeChange = opts.onModeChange; onDataChange = opts.onDataChange; setStatus = opts.setStatus;
    bind();
    window.api.onOfflineProgress(handleProgress);
    restoreSavedFile();
  }

  // 재시작 시 마지막 오프라인 파일 경로 복원
  async function restoreSavedFile() {
    try {
      const r = await window.api.settingsGet();
      const saved = r && r.ok && r.settings ? r.settings.offlineFilePath : '';
      if (!saved) return;
      const m = await window.api.offlineManifest(saved);
      state.filePath = saved;
      state.manifest = (m && m.ok) ? m.manifest : null;
      const fld = el('offFile'); if (fld) fld.value = saved;
      renderTables();
      renderFileSize();
      if (onDataChange) onDataChange();
      if (setStatus && hasAnyData()) setStatus('이전 오프라인 파일을 불러왔습니다: ' + saved);
    } catch (e) {}
  }

  function bind() {
    el('btnOffline').addEventListener('click', open);
    el('offClose').addEventListener('click', close);
    el('btnOffPickNew').addEventListener('click', pickNewFile);
    el('btnOffPickExisting').addEventListener('click', pickExistingFile);
    el('btnOffDownload').addEventListener('click', () => runSync(false));
    el('btnOffSync').addEventListener('click', () => runSync(true));
    el('btnOffCancel').addEventListener('click', cancelSync);
    el('btnOffDelSel').addEventListener('click', deleteSelected);
    el('offlineModal').addEventListener('click', (e) => { if (e.target.id === 'offlineModal') close(); });
    // 다운로드용 DB 접속정보 선택 다이얼로그
    el('dlConnX').addEventListener('click', closeConnPicker);
    el('dlConnCancel').addEventListener('click', closeConnPicker);
    el('dlConnTest').addEventListener('click', dlTestConnect);
    el('dlConnOk').addEventListener('click', dlConfirm);
    el('dlConnDb').addEventListener('change', dlUpdateOk);
    // 접속정보를 바꾸면 DB 선택 초기화(다시 접속·조회 필요)
    el('dlConnProfiles').addEventListener('change', () => {
      _dlBase = null;
      const dbSel = el('dlConnDb');
      dbSel.innerHTML = '<option value="">— 접속 후 선택 —</option>';
      dbSel.disabled = true;
      el('dlConnOk').disabled = true;
      dlMsg('');
    });
    el('dlConnModal').addEventListener('click', (e) => { if (e.target.id === 'dlConnModal') closeConnPicker(); });
  }

  function open() { el('offlineModal').style.display = 'flex'; renderTables(); renderFileSize(); }
  function close() { if (!state.busy) el('offlineModal').style.display = 'none'; }

  async function pickNewFile() {
    const r = await window.api.offlinePickNewFile();
    if (!r.ok) return;
    await applyPickedFile(r.filePath, r.manifest);
    msg('파일 위치가 지정되었습니다. [전체 다운로드]로 데이터를 받으세요.', 'ok');
  }

  async function pickExistingFile() {
    const r = await window.api.offlinePickExistingFile();
    if (!r.ok) return;
    await applyPickedFile(r.filePath, r.manifest);
    msg('파일을 열었습니다. 데이터를 다운로드한 뒤 상단 [오프라인] 스위치로 전환하세요.', 'ok');
  }

  async function applyPickedFile(filePath, manifest) {
    state.filePath = filePath; state.manifest = manifest;
    el('offFile').value = filePath;
    window.api.settingsSet({ offlineFilePath: filePath }); // 재시작 시 기억
    renderTables();
    renderFileSize();
    if (onDataChange) onDataChange();
  }

  function hasAnyData() {
    return !!(state.manifest && state.manifest.tables && Object.keys(state.manifest.tables).length);
  }

  function renderTables() {
    const box = el('offTableRows'); box.innerHTML = '';
    const mt = (state.manifest && state.manifest.tables) || {};
    ALL_TABLES.forEach(key => {
      const info = mt[key];
      const div = document.createElement('div');
      div.className = 'off-tr';
      div.innerHTML =
        '<span class="t-name">' + TABLE_LABELS[key] + '</span>' +
        '<span class="' + (info ? '' : 'muted') + '">' + (info ? fmtNum(info.rows) : '—') + '</span>' +
        '<span class="' + (info ? '' : 'muted') + '">' + (info ? fmtDate(info.lastSync) : '없음') + '</span>' +
        '<span><input type="checkbox" data-tk="' + key + '" checked></span>';
      box.appendChild(div);
    });
  }

  // 단일 파일 전체 용량(테이블별이 아니라 파일 하나의 크기)을 안내 영역에 표시.
  function renderFileSize() {
    const box = el('offFileSize'); if (!box) return;
    const bytes = state.manifest ? state.manifest.fileBytes : null;
    if (bytes == null) { box.style.display = 'none'; return; }
    box.style.display = 'block';
    box.textContent = '📦 파일 용량: ' + fmtBytes(bytes);
  }

  function selectedTables() {
    return [...document.querySelectorAll('#offTableRows input[type=checkbox]:checked')].map(c => c.dataset.tk);
  }

  /* ---------- 다운로드 / 증분갱신 ---------- */
  // 안 A: 오프라인 모드에서도 다운로드 가능. 단, 반드시 저장된 접속정보를 선택하고
  // 확인을 거친 뒤(그 접속정보로 DB에 붙어) 다운로드한다.
  async function runSync(incremental) {
    if (state.busy) return;
    if (!state.filePath) { msg('먼저 데이터 파일을 새로 만들거나 여세요.', 'err'); return; }
    const tables = selectedTables();
    if (!tables.length) { msg('다운로드할 테이블을 선택하세요.', 'err'); return; }
    // 메뉴(폴더 포함)는 상단 검색 패널의 "제품" 선택값과 무관하게 항상 등록된 모든 제품을
    // 자동으로 순회하며 동기화하므로(메인 프로세스 ALL_PRODUCT_CODES), 여기서 별도로
    // 제품 선택 여부를 검사할 필요가 없다.
    // 저장된 접속정보 선택 다이얼로그를 띄우고, 확인 시 그 cfg 로 다운로드 실행
    openConnPicker(async (cfg) => { await doSync(incremental, tables, cfg, false); });
  }

  // 실제 다운로드 수행(선택된 cfg 사용). force=true 면 "암호화 전환 확인" 동의 후 재호출된 것.
  async function doSync(incremental, tables, cfg, force) {
    if (!cfg || !cfg.database) { msg('접속정보와 DB가 선택되지 않았습니다.', 'err'); return; }
    setBusy(true);
    showProgress(true);
    setBar(null); // 불확정
    opText((incremental ? '증분 갱신' : '전체 다운로드') + ' 준비 중…');
    msg('');

    const productCd = getProductCd ? getProductCd() : '';
    const lang = getLang ? getLang() : 'ko';
    const r = await window.api.offlineSync({
      cfg, filePath: state.filePath, tables, incremental, force,
      tenantId: '*', coCd: '*', productCd, lang
    });
    setBusy(false);
    showProgress(false);

    if (r.ok) {
      state.manifest = r.manifest;
      renderTables();
      renderFileSize();
      if (onDataChange) onDataChange();
      const doneMsg = force
        ? '암호화된 파일로 새로 만들어 전체 데이터를 받았습니다.'
        : (incremental ? '증분 갱신' : '전체 다운로드') + ' 완료.';
      msg(doneMsg + ' 상단 [오프라인] 스위치로 전환해 사용하세요.', 'ok');
    } else if (r.canceled) {
      state.manifest = r.manifest || state.manifest;
      renderTables();
      renderFileSize();
      if (onDataChange) onDataChange();
      msg('사용자가 작업을 중단했습니다. (받은 데이터까지는 저장됨)', 'err');
    } else {
      msg('실패: ' + (r.error || '알 수 없는 오류') + (r.detail ? ' (' + r.detail + ')' : ''), 'err');
    }
  }

  /* ---------- 다운로드용 DB 접속정보 선택 다이얼로그 ---------- */
  let _dlProfiles = [];     // 저장된 접속정보 목록
  let _dlChosenCfg = null;  // 접속·DB조회로 확정된 cfg
  let _dlOnConfirm = null;  // 확인 시 실행할 콜백
  let _dlBase = null;       // 접속 성공한 접속정보(기본 cfg, database 제외)

  async function openConnPicker(onConfirm) {
    _dlOnConfirm = onConfirm;
    _dlChosenCfg = null;
    dlMsg('');
    const sel = el('dlConnProfiles');
    const dbSel = el('dlConnDb');
    dbSel.innerHTML = '<option value="">— 접속 후 선택 —</option>';
    dbSel.disabled = true;
    el('dlConnOk').disabled = true;
    // 저장된 접속정보 로드
    const r = await window.api.connList();
    _dlProfiles = (r && r.ok && r.profiles) ? r.profiles : [];
    if (!_dlProfiles.length) {
      dlMsg('저장된 접속정보가 없습니다. 먼저 상단 [DB 연결]에서 접속정보를 저장하세요.', 'err');
    }
    sel.innerHTML = '<option value="">— 저장된 접속 —</option>' +
      _dlProfiles.map(p => {
        const label = (p.alias && p.alias.trim()) ? p.alias.trim() : (p.server || '(이름없음)');
        return '<option value="' + escAttr(p.name) + '">' + escHtml(label) + '</option>';
      }).join('');
    el('dlConnModal').style.display = 'flex';
  }

  function closeConnPicker() { el('dlConnModal').style.display = 'none'; _dlOnConfirm = null; }

  function currentDlProfile() {
    const name = el('dlConnProfiles').value;
    return _dlProfiles.find(p => p.name === name) || null;
  }

  // 접속 시도 + DB 목록 조회 → DB 선택 콤보 채움
  async function dlTestConnect() {
    const p = currentDlProfile();
    if (!p) { dlMsg('접속정보를 먼저 선택하세요.', 'err'); return; }
    const base = {
      server: p.server, port: p.port || '1433', database: '',
      user: p.user, password: p.password, alias: p.alias, encrypt: !!p.encrypt
    };
    dlMsg('접속 중… DB 목록을 불러옵니다.', 'busy');
    el('dlConnTest').disabled = true;
    const r = await window.api.listDatabases(base);
    el('dlConnTest').disabled = false;
    const dbSel = el('dlConnDb');
    if (!r.ok) {
      dbSel.innerHTML = '<option value="">— 접속 실패 —</option>';
      dbSel.disabled = true;
      el('dlConnOk').disabled = true;
      dlMsg('접속 실패: ' + (r.error || '알 수 없는 오류'), 'err');
      return;
    }
    dbSel.innerHTML = '<option value="">— DB 선택 —</option>' +
      r.databases.map(d => '<option value="' + escAttr(d) + '">' + escHtml(d) + '</option>').join('');
    dbSel.disabled = false;
    // 프로필에 database 가 저장돼 있으면 기본 선택
    if (p.database && r.databases.includes(p.database)) dbSel.value = p.database;
    _dlBase = base;
    dlUpdateOk();
    dlMsg('접속 성공 · DB ' + r.databases.length + '개. 사용할 DB를 선택하세요.', 'ok');
  }

  function dlUpdateOk() {
    const db = el('dlConnDb').value;
    el('dlConnOk').disabled = !(_dlBase && db);
  }

  function dlConfirm() {
    const db = el('dlConnDb').value;
    if (!_dlBase || !db) { dlMsg('DB를 선택하세요.', 'err'); return; }
    const cfg = Object.assign({}, _dlBase, { database: db });
    const cb = _dlOnConfirm;
    closeConnPicker();
    if (cb) cb(cfg);
  }

  function dlMsg(t, cls) { const m = el('dlConnMsg'); if (m) { m.textContent = t || ''; m.className = 'dlc-msg' + (cls ? ' ' + cls : ''); } }
  function escHtml(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function escAttr(s) { return escHtml(s); }

  async function cancelSync() {
    opText('중단 요청 중…');
    await window.api.offlineCancel();
  }

  function handleProgress(evt) {
    if (!evt) return;
    // 메뉴는 여러 제품(ALL_PRODUCT_CODES)을 자동 순회하며 여러 번 start/progress/done 이 오므로,
    // 어느 제품 처리 중인지 표시해 준다.
    const pcSuffix = (evt.table === 'menu' && evt.productCd) ? ' (' + evt.productCd + ')' : '';
    if (evt.phase === 'start') { opText('[' + labelOf(evt.table) + pcSuffix + '] 조회 시작…'); setBar(null); }
    else if (evt.phase === 'progress') { opText('[' + labelOf(evt.table) + pcSuffix + '] ' + fmtNum(evt.received) + '건 저장 중…'); }
    else if (evt.phase === 'done') { opText('[' + labelOf(evt.table) + pcSuffix + '] 완료 · ' + fmtNum(evt.received || evt.rowCount || 0) + '건'); }
    else if (evt.phase === 'all-done') { setBar(100); opText('모든 테이블 완료'); }
    else if (evt.phase === 'cancelled') { opText('중단됨'); }
    else if (evt.phase === 'error') { opText('오류: ' + (evt.error || '')); }
  }

  /* ---------- 수동 삭제 ---------- */
  async function deleteSelected() {
    if (state.busy) return;
    if (!state.filePath) { msg('파일을 먼저 선택하세요.', 'err'); return; }
    const tables = selectedTables().filter(t => (state.manifest && state.manifest.tables && state.manifest.tables[t]));
    if (!tables.length) { msg('삭제할(다운로드된) 테이블을 선택하세요.', 'err'); return; }
    if (!window.confirm('선택한 오프라인 테이블 ' + tables.length + '개를 삭제할까요?\n(' + tables.map(labelOf).join(', ') + ')\n해당 데이터가 파일에서 제거됩니다.')) return;
    setBusy(true);
    for (const t of tables) {
      await window.api.offlineDelete({ filePath: state.filePath, table: t, keys: null });
    }
    const m = await window.api.offlineManifest(state.filePath);
    state.manifest = m.manifest;
    setBusy(false);
    renderTables();
    renderFileSize();
    if (onDataChange) onDataChange();
    // 데이터가 모두 사라졌는데 오프라인 모드면 데모로 되돌리도록 알림
    if (!hasAnyData() && state.active && onModeChange) onModeChange('off', state.filePath);
    msg('선택한 오프라인 테이블을 삭제했습니다.', 'ok');
  }

  /* ---------- 상태/유틸 ---------- */
  function setBusy(b) {
    state.busy = b;
    el('btnOffCancel').style.display = b ? '' : 'none';
    ['btnOffDownload', 'btnOffSync', 'btnOffDelSel', 'btnOffPickNew', 'btnOffPickExisting', 'offClose'].forEach(id => el(id).disabled = b);
  }
  function showProgress(s) { el('offProgress').style.display = s ? 'block' : 'none'; }
  function setBar(pct) {
    const bar = el('opBar');
    if (pct == null) { bar.classList.add('indet'); bar.style.width = '40%'; }
    else { bar.classList.remove('indet'); bar.style.width = pct + '%'; }
  }
  function opText(t) { el('opText').textContent = t; }
  function msg(t, cls) { const m = el('offMsg'); m.textContent = t || ''; m.className = 'off-msg' + (cls ? ' ' + cls : ''); }
  function labelOf(k) { return TABLE_LABELS[k] || k; }
  function fmtNum(n) { return (n == null) ? '—' : Number(n).toLocaleString(); }
  function fmtBytes(b) {
    if (b == null) return '—';
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
    return (b / 1073741824).toFixed(2) + ' GB';
  }
  function fmtDate(s) { if (!s) return '없음'; try { return new Date(s).toLocaleString('ko-KR'); } catch (e) { return s; } }

  // app.js 에서 조회 라우팅/스위치 연동에 사용
  function isOnline() { return state.active && !!state.filePath; }
  function folder() { return state.filePath; } // app.js 가 이 이름으로 호출하므로 유지(내부적으로 파일 경로 반환)
  function hasData() { return hasAnyData(); }
  function setActive(on) { state.active = !!on; }
  function openModal() { open(); }

  return { init, isOnline, folder, hasData, setActive, openModal };
})();
