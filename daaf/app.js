/* Daaf Wave 메인 앱 로직 */
(function () {
  const P = window.WaveParser;
  const S = window.WaveStore;
  const G = window.WaveGraph;
  const F = window.WaveFlow;

  const el = (id) => document.getElementById(id);
  const store = S.makeStore();
  let cfg = null;                 // DB 연결정보
  let demoMode = true;            // 기본은 데모(내장 샘플)
  let offlineActive = false;      // 오프라인 모드
  let activeMode = 'db';          // 현재 스위치 모드: db | offline
  let lastMenuRows = [];
  let selectedMenu = null;
  let rootKey = null;
  // 폴더(메뉴 트리) 찾아보기: 트리 전체를 한 번 조회해 캐시하고, 폴더 선택은 이 캐시를
  // 클라이언트에서 필터링한다(오프라인 모드는 트리 정보가 없어 미지원).
  let menuTreeCache = null;       // 트리 원본 행(L1_NM..L6_NM 포함) 배열
  let menuTreeSig = '';           // 캐시 유효성 판단용 서명(모드+테넌트+회사+제품+언어)
  let folderPaths = [];           // [{ path:[...name], count }] — 검색 가능한 폴더 드롭다운 옵션과 1:1
  let selectedFolderIdx = '';     // 현재 선택된 폴더의 folderPaths 인덱스(문자열). '' = 선택 안 함
  let folderDropdownActiveIdx = -1; // 폴더 드롭다운 키보드 탐색(↑/↓) 중 강조된 항목의 화면상 인덱스
  // 검색 결과 멀티 선택(폴더/프로그램 일괄 다운로드용): lastMenuRows 의 인덱스 집합
  let multiSelected = new Set();
  let flowNodeKey = null;         // 흐름도 탭에 현재 표시 중인 WF 노드 key
  // 흐름도 단계 상세 팝업의 접기/펼치기 상태 — 사용자가 한 번 바꾸면 다른 단계/다른 WF를
  // 선택해도 계속 유지된다(팝업은 더 이상 닫을 수 없고 최소화만 가능하므로 세션 내 전역 상태로 둔다).
  let flowBoxCollapsed = false;
  // 서비스콜 단계를 통해 다른 WF로 이동할 때마다 "어디서 왔는지"(원래 WF key + 그 단계의
  // compId)를 쌓아두는 스택 — [◀ 뒤로] 버튼으로 순서대로 되돌아갈 수 있게 한다. 사용자가
  // 상세 패널의 [🔀 흐름도 보기]로 새 WF를 직접 선택하면(서비스콜 이동이 아니므로) 비운다.
  let flowNavStack = [];
  // 흐름도에서 "지금 어느 화면을 보고 있는지" — null 이면 WF 최상위, 아니면 반복문/분기 등의
  // compId(그 내부를 보고 있다는 뜻). 서비스콜 이동과 마찬가지로 flowNavStack 에 같이 쌓여서
  // [◀ 뒤로] 하나로 두 종류의 이동(다른 WF로 이동 / 같은 WF 안에서 내부로 들어감)을 모두
  // 되짚어 나올 수 있다.
  let currentFlowScope = null;
  let currentFlowRaw = null;   // 지금 열린 WF 의 RESOURCE_WF 원본(스코프를 최상위로 되돌아갈 때 재사용)
  const MAX_DEPTH_DEFAULT = 4;
  // 폴더(메뉴 트리) 조회가 진행 중인 동안에는 "데이터 없음" 안내 문구를 잠깐 보여줬다 바로
  // 숨기는 깜빡임이 생겼다(비동기 조회가 끝나기 전에 먼저 "없음"으로 그렸다가, 끝나면 다시 채움).
  // 조회 중에는 그 안내를 아예 띄우지 않도록 상태를 추적한다.
  let _menuTreeLoading = false;
  // [고급옵션] 테넌트/회사 콤보: 마지막으로 조회한 distinct 목록 캐시 + 어떤 소스 기준으로
  // 가져온 것인지(모드+DB별칭/오프라인 파일)를 함께 저장해, 소스가 바뀌면 다시 가져온다.
  let _tenantCoCdRows = null;    // [{TENANT_ID, CO_CD}, ...]
  let _tenantCoCdSig = '';       // 캐시 유효성 판단용 서명
  let _tenantCoCdLoading = false;

  /* ---------- 초기화 ---------- */
  window.addEventListener('DOMContentLoaded', () => {
    G.init(el('graph'), { onNodeTap: onNodeTap, onNodeDblTap: onNodeDblTap });
    F.init(el('flowchart'), { onStepTap: onFlowStepTap, onServiceJump: jumpToServiceFlow, onContainerJump: jumpToContainerScope });
    bindEvents();
    bindViewer();
    setupPaneResizers();
    refreshProfiles();
    ensureMenuTree();   // 아직 DB에 연결하지 않았으면 내장 샘플로 폴더 목록을 우선 채워둔다
    WaveOffline.init({
      getCfg: () => cfg || getCfg(),
      getProductCd: () => el('productCd').value,
      getLang: () => el('langSel').value,
      onModeChange: (mode) => {   // 오프라인 관리창에서 온/오프 전환 시
        switchMode(mode === 'on' ? 'offline' : 'db');
      },
      onDataChange: () => { if (activeMode === 'offline') applyMode('offline'); refreshTenantCoCdIfOpen(true); },
      setStatus
    });
    applyMode('db');
    setStatus('준비됨 · DB에 연결하거나 오프라인 데이터를 불러오세요.');
    refreshBasket();
    initFontScaleSetting();  // 저장된 화면 배율을 즉시 적용 + 설정 모달 바인딩
    consentGate();   // 최초 실행 시 사용 동의 확인 (미동의 시 종료)
  });

  /* ---------- 설정: 화면 배율 (추후 다른 설정 항목도 이 아래에 추가) ---------- */
  const ZOOM_MIN = 70, ZOOM_MAX = 150, ZOOM_DEFAULT = 100;
  let _zoomSaveTimer = null;

  function clampZoomPct(pct) {
    pct = Math.round(Number(pct) || ZOOM_DEFAULT);
    return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, pct));
  }

  // 배율을 실제로 적용(Electron 네이티브 페이지 줌)하고, 모달의 슬라이더·퍼센트 표시·트랙 채움을
  // 함께 갱신한다. save=true 면 settings.json에도 반영해 다음 실행 시 유지되게 한다(약간의
  // 디바운스를 둬서 슬라이더를 드래그하는 동안 디스크에 과하게 쓰지 않는다).
  function applyZoomPct(pct, save) {
    pct = clampZoomPct(pct);
    if (window.api && window.api.setZoomFactor) {
      try { window.api.setZoomFactor(pct / 100); } catch (e) { /* 무시 */ }
    }
    const range = el('settingsZoomRange');
    const val = el('settingsZoomVal');
    if (range) {
      range.value = String(pct);
      const ratio = ((pct - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN)) * 100;
      range.style.background = 'linear-gradient(90deg,var(--acc) 0%,var(--acc) ' + ratio + '%,#e2e8f0 ' + ratio + '%,#e2e8f0 100%)';
    }
    if (val) val.textContent = pct + '%';
    if (save && window.api && window.api.settingsSet) {
      if (_zoomSaveTimer) clearTimeout(_zoomSaveTimer);
      _zoomSaveTimer = setTimeout(() => {
        window.api.settingsSet({ fontScale: pct / 100 }).catch(() => {});
      }, 250);
    }
  }

  async function initFontScaleSetting() {
    let pct = ZOOM_DEFAULT;
    if (window.api && window.api.settingsGet) {
      try {
        const r = await window.api.settingsGet();
        const s = r && r.ok && r.settings;
        if (s && s.fontScale) pct = clampZoomPct(s.fontScale * 100);
      } catch (e) { /* 무시 */ }
    }
    applyZoomPct(pct, false);     // 저장은 필요 없음 — 이미 저장된 값을 반영만 하는 것

    const btn = el('btnSettings');
    const modal = el('settingsModal');
    const closeBtn = el('settingsClose');
    const range = el('settingsZoomRange');
    const resetBtn = el('settingsZoomReset');
    if (btn && modal) {
      btn.addEventListener('click', () => { modal.style.display = 'flex'; });
    }
    if (closeBtn && modal) {
      closeBtn.addEventListener('click', () => { modal.style.display = 'none'; });
      modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
    }
    if (range) {
      // input: 드래그하는 동안 실시간으로 즉시 반영(요청사항 — "변경된 배율로 즉시 반영된 모습 확인")
      range.addEventListener('input', () => applyZoomPct(range.value, true));
    }
    if (resetBtn) {
      resetBtn.addEventListener('click', () => applyZoomPct(ZOOM_DEFAULT, true));
    }
  }



  // 사용 동의 게이트: 아직 동의하지 않았으면 모달을 띄우고 그 전까지 앱 사용을 막는다.
  // [동의] → 메인에서 동의 저장 + 접속 로그 전송, [동의 안 함] → 앱 종료(로그 전송 없음).
  async function consentGate() {
    if (!window.api || !window.api.consentGet) return; // 웹 미리보기 등 방어
    let agreed = false;
    try {
      const r = await window.api.consentGet();
      agreed = !!(r && r.agreed);
    } catch (_) {}
    if (agreed) return; // 이미 동의함 → 그냥 진행

    const modal = el('consentModal');
    if (!modal) return;
    modal.style.display = 'flex';

    const agreeBtn = el('consentAgree');
    const declineBtn = el('consentDecline');
    if (agreeBtn) agreeBtn.onclick = async () => {
      agreeBtn.disabled = true;
      try { await window.api.consentAgree(); } catch (_) {}
      modal.style.display = 'none';
    };
    if (declineBtn) declineBtn.onclick = async () => {
      try { await window.api.consentDecline(); } catch (_) {}
    };
  }

  function bindEvents() {
    // 모드 스위치
    el('msDb').addEventListener('click', () => switchMode('db'));
    el('msOffline').addEventListener('click', () => switchMode('offline'));
    el('btnLoadErp').addEventListener('click', handleLoadErp);
    el('btnDbConnect').addEventListener('click', connectDb);
    el('btnDbDisconnect').addEventListener('click', disconnectDb);
    el('dbType').addEventListener('change', onDbTypeChange);
    el('btnPwShow').addEventListener('click', togglePw);
    // 저장된 접속정보 콤보에서 선택하는 즉시 불러온다(별도 [불러오기] 버튼 없이 동작).
    el('connProfiles').addEventListener('change', () => { if (el('connProfiles').value) loadProfile(); });
    el('btnConnSave').addEventListener('click', saveProfile);
    el('btnConnDel').addEventListener('click', deleteProfile);
    el('btnGuide').addEventListener('click', () => { el('guideModal').style.display = 'flex'; });
    el('guideClose').addEventListener('click', () => { el('guideModal').style.display = 'none'; });
    el('guideModal').addEventListener('click', (e) => { if (e.target.id === 'guideModal') el('guideModal').style.display = 'none'; });
    // 가이드 모달 탭 전환
    document.querySelectorAll('#guideTabs .gtab').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.gt;
        document.querySelectorAll('#guideTabs .gtab').forEach(b => b.classList.toggle('active', b === btn));
        document.querySelectorAll('#guideModal .gpanel').forEach(p => p.classList.toggle('active', p.dataset.gp === key));
        const body = document.querySelector('#guideModal .guide-body');
        if (body) body.scrollTop = 0;
      });
    });
    el('ceClose').addEventListener('click', hideConnError);
    el('ceDetailBtn').addEventListener('click', () => {
      const d = el('connError').querySelector('.ce-detail');
      d.style.display = d.style.display === 'none' ? 'block' : 'none';
    });
    el('btnSearch').addEventListener('click', doSearch);
    el('btnRun').addEventListener('click', doRun);
    el('btnCancelRun').addEventListener('click', cancelActiveWaveRun);
    el('btnFit').addEventListener('click', () => G.fit());
    el('btnRelayout').addEventListener('click', () => G.relayout(el('layoutSel').value));
    el('layoutSel').addEventListener('change', () => G.relayout(el('layoutSel').value));
    // 그래프 필터: 테이블/순환 표시 (기본 꺼짐)
    // 그래프/테이블 통합 검색 (ID · 이름 · UID)
    el('gvSearch').addEventListener('input', () => applyGraphSearch());
    el('gvSearch').addEventListener('keydown', e => { if (e.key === 'Escape') { el('gvSearch').value = ''; applyGraphSearch(); } });
    el('showTable').addEventListener('change', () => { G.setFilter({ showTable: el('showTable').checked }); applyGraphSearch(); });
    el('showCycle').addEventListener('change', () => G.setFilter({ showCycle: el('showCycle').checked }));
    el('showSubUi').addEventListener('change', () => G.setFilter({ showSubUi: el('showSubUi').checked }));
    // 검색 결과 목록에 체크된 항목이 있으면 "선택 항목 일괄 다운로드"로, 없으면 기존처럼
    // 지금 조회 중인 전체 데이터를 저장한다("선택 다운로드" 버튼은 이 버튼으로 통합됨).
    el('btnSaveAll').addEventListener('click', saveAllOrBatch);
    el('btnSaveBasket').addEventListener('click', () => save('basket'));
    el('btnClearBasket').addEventListener('click', () => { store.clearBasket(); refreshBasket(); G.markBasket(store.basket); });
    el('tabGraph').addEventListener('click', () => switchTab('graph'));
    el('tabTable').addEventListener('click', () => switchTab('table'));
    el('tabFlow').addEventListener('click', () => switchTab('flow'));
    el('tabUi').addEventListener('click', () => switchTab('ui'));
    // [◀ 뒤로]: UI 탭에서 UI/Mo 뱃지를 눌러 다른 화면으로 이동했던 이력을 하나씩 되짚는다
    // (코드·디자인 보기 모달의 [◀ 뒤로]와 완전히 동일한 패턴/코드 구조).
    el('uiTabBack').addEventListener('click', () => {
      const prevKey = _uiTabNavStack.pop();
      if (!prevKey) return;
      const prevNode = store.nodes.get(prevKey) || _syntheticNodeCache.get(prevKey);
      if (!prevNode) {
        const msg = '이전 화면(' + prevKey + ')이 현재 파도타기 결과에 없습니다.';
        setStatus(msg, true);
        showUiTabLinkToast(msg);
        return;
      }
      openUiTabNode(prevNode, { fromNav: true });
    });
    el('btnFlowFit').addEventListener('click', () => F.fit());
    el('btnFlowRelayout').addEventListener('click', () => F.relayout(el('flowLayoutSel').value));
    el('flowLayoutSel').addEventListener('change', () => F.relayout(el('flowLayoutSel').value));
    // 상세 패널 [전체 펼치기/접기]: 정적 마크업이라 한 번만 바인딩
    el('dToggleAll').addEventListener('click', () => {
      const boxes = [...document.querySelectorAll('#detail .d-collapse')];
      if (!boxes.length) return;
      const allOpen = boxes.every(b => b.style.display !== 'none');
      const nextShow = !allOpen;
      boxes.forEach(b => { b.style.display = nextShow ? 'block' : 'none'; });
      document.querySelectorAll('#detail .d-toggle').forEach(btn => { btn.textContent = nextShow ? '숨기기' : '보기'; });
      el('dToggleAll').textContent = nextShow ? '전체 접기' : '전체 펼치기';
    });
    el('mnuId').addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
    el('mnuNm').addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
    ['wUI', 'wWF', 'wRp', 'wMo'].forEach(id => el(id).addEventListener('change', updateSearchMode));
    ['svcId', 'svcUid'].forEach(id => el(id).addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); }));
    bindFolderPicker();
    el('btnFolderRefresh').addEventListener('click', () => ensureMenuTree(true));
    // 검색 결과 전체 선택: 그리드 헤더의 체크박스는 검색 모드가 바뀔 때마다 innerHTML로
    // 다시 그려지므로(updateSearchMode), thead 자체(안 바뀜)에 이벤트 위임으로 바인딩한다.
    el('menuThead').addEventListener('change', (e) => {
      if (e.target && e.target.id === 'menuChkAll') toggleMultiSelectAll(e.target.checked);
    });
    // 고급 옵션(테넌트/회사/언어) 접기/펼치기 — 기본 숨김
    el('btnAdvToggle').addEventListener('click', toggleAdvOptions);
    // 테넌트 변경 시 해당 테넌트에 속한 회사만 회사 콤보에 나오게 다시 구성
    el('tenantId').addEventListener('change', rebuildCoCdOptions);
    // 흐름도: 시작/종료 노드로 이동 + 미니맵 on/off
    el('btnFlowGoStart').addEventListener('click', () => {
      if (!F.goToStart()) setStatus('시작 노드를 찾을 수 없습니다.', true);
    });
    el('btnFlowGoEnd').addEventListener('click', () => {
      if (!F.goToEnd()) setStatus('종료 노드를 찾을 수 없습니다.', true);
    });
    el('flowMinimapToggle').addEventListener('change', (e) => F.setMinimapEnabled(e.target.checked));
    F.setMinimapEnabled(el('flowMinimapToggle').checked);
    // 흐름도 검색: 지금 화면(현재 스코프)의 단계를 이름/메시지/테이블/조건식 등으로 검색.
    el('flowSearch').addEventListener('input', () => applyFlowSearch());
    el('flowSearch').addEventListener('keydown', e => { if (e.key === 'Escape') { el('flowSearch').value = ''; applyFlowSearch(); } });
    // [◀ 뒤로]: 서비스콜로 다른 WF에 왔거나, 반복문/분기 내부로 들어왔던 이동을 하나씩 되짚는다.
    el('btnFlowBack').addEventListener('click', () => {
      const prev = flowNavStack.pop();
      if (!prev) return;
      if (prev.key !== flowNodeKey) {
        // 다른 WF에서 이동해왔던 경우 — 그 WF를 다시 열고(필요하면 그때의 스코프까지) 복원.
        showFlow(prev.key, { keepNav: true, scope: prev.scope || null });
      } else {
        // 같은 WF 안에서의 스코프 전환(반복문/분기 내부 ↔ 상위)만 되돌리면 된다.
        currentFlowScope = prev.scope || null;
        const ok = currentFlowScope
          ? F.renderScope(currentFlowScope, el('flowLayoutSel').value)
          : F.render(currentFlowRaw, el('flowLayoutSel').value);
        updateFlowTitle(ok);
        el('flowSearch').value = ''; F.search('');
      }
      if (prev.compId) setTimeout(() => F.selectAndZoom(prev.compId), 80);
      updateFlowBackButton();
    });
    updateSearchMode();
  }

  // 고급 옵션(테넌트/회사/언어) — 평소엔 '*'/기본값 그대로 쓰는 경우가 많아 기본적으로 숨겨서
  // 화면을 덜 어수선하게 하고, 검색 결과 목록에 더 많은 공간을 준다.
  function toggleAdvOptions() {
    const box = el('advOptions');
    const btn = el('btnAdvToggle');
    const willOpen = box.style.display === 'none';
    box.style.display = willOpen ? 'block' : 'none';
    btn.classList.toggle('open', willOpen);
    if (willOpen) loadTenantCoCdOptions();  // 열 때(지연 로딩) 테넌트/회사 목록을 채운다
  }

  /* ---------- [고급옵션] 테넌트/회사 콤보 ---------- */
  // 현재 소스(DB 접속/오프라인 파일)에서 메뉴의 TENANT_ID/CO_CD 를 distinct 조회해
  // 테넌트 콤보를 채우고, 회사 콤보는 선택된 테넌트에 맞춰 다시 구성한다.
  // '*'(전체)는 항상 맨 앞에 있고 기본 선택값이다.
  async function loadTenantCoCdOptions(force) {
    const sig = activeMode + '|' + (activeMode === 'db' ? (cfg ? (cfg.alias || cfg.server || '') + '/' + (cfg.database || '') : '') :
      (activeMode === 'offline' ? ((WaveOffline.folder && WaveOffline.folder()) || '') : ''));
    if (!force && sig === _tenantCoCdSig && _tenantCoCdRows) { rebuildCoCdOptions(); return; }
    if (_tenantCoCdLoading) return;

    // 데모 모드(또는 DB 미접속/오프라인 파일 미선택)는 조회할 실제 소스가 없으므로 '*'만 남긴다.
    if (activeMode === 'db' && (!cfg || demoMode)) { resetTenantCoCdOptions(); return; }
    if (activeMode === 'offline' && !((WaveOffline.folder && WaveOffline.folder()))) { resetTenantCoCdOptions(); return; }
    if (activeMode !== 'db' && activeMode !== 'offline') { resetTenantCoCdOptions(); return; }

    _tenantCoCdLoading = true;
    try {
      let rows = [];
      if (activeMode === 'db') {
        const r = await window.api.queryTenantCoCds({ cfg });
        rows = (r && r.ok) ? r.rows : [];
      } else if (activeMode === 'offline') {
        const r = await window.api.offlineQueryTenantCoCds({ filePath: WaveOffline.folder() });
        rows = (r && r.ok) ? r.rows : [];
      }
      _tenantCoCdRows = rows || [];
      _tenantCoCdSig = sig;
    } catch (e) {
      _tenantCoCdRows = [];
    } finally {
      _tenantCoCdLoading = false;
    }
    populateTenantSelect();
  }

  // 조회한 rows 기준으로 테넌트 콤보를 채운다('*' + distinct TENANT_ID). '*' 는 항상 맨 앞에
  // 별도로 하나만 넣으므로, 실데이터에 이미 '*' 행이 있어도 목록에서는 제외한다(중복 방지).
  // 가능하면 기존 선택값을 유지.
  function populateTenantSelect() {
    const sel = el('tenantId');
    const prev = sel.value || '*';
    const tenants = [...new Set((_tenantCoCdRows || []).map(r => r.TENANT_ID).filter(v => v != null && v !== '' && v !== '*'))].sort();
    sel.innerHTML = '<option value="*">전체</option>' +
      tenants.map(t => '<option value="' + esc(t) + '">' + esc(t) + '</option>').join('');
    sel.value = tenants.includes(prev) ? prev : '*';
    rebuildCoCdOptions();
  }

  // 선택된 테넌트에 해당하는 회사만 회사 콤보에 채운다('*' + distinct CO_CD, 마찬가지로 실데이터의
  // '*' 는 제외해 중복을 막는다). 테넌트가 '*'(전체)이면 모든 회사를 보여준다.
  // 가능하면 기존 선택값을 유지, 아니면 '*'로.
  function rebuildCoCdOptions() {
    const tSel = el('tenantId'), cSel = el('coCd');
    const tenant = tSel.value || '*';
    const prev = cSel.value || '*';
    const rows = _tenantCoCdRows || [];
    const cos = [...new Set(
      rows.filter(r => tenant === '*' || r.TENANT_ID === tenant).map(r => r.CO_CD).filter(v => v != null && v !== '' && v !== '*')
    )].sort();
    cSel.innerHTML = '<option value="*">전체</option>' +
      cos.map(c => '<option value="' + esc(c) + '">' + esc(c) + '</option>').join('');
    cSel.value = cos.includes(prev) ? prev : '*';
  }

  // 조회 소스가 없을 때(데모/미접속/오프라인 파일 미선택): '*' 만 남긴 기본 상태로.
  function resetTenantCoCdOptions() {
    _tenantCoCdRows = []; _tenantCoCdSig = '';
    el('tenantId').innerHTML = '<option value="*" selected>전체</option>';
    el('coCd').innerHTML = '<option value="*" selected>전체</option>';
  }

  // 검색 모드: 화면계열(UI/Mo/Rp) 하나라도 체크 → 'menu', WF만 → 'wf'
  function searchMode() {
    const screenChecked = el('wUI').checked || el('wMo').checked || el('wRp').checked;
    if (screenChecked) return 'menu';
    if (el('wWF').checked) return 'wf';
    return 'menu';
  }
  function updateSearchMode() {
    const m = searchMode();
    el('searchMenuFields').style.display = m === 'menu' ? 'block' : 'none';
    el('searchWfFields').style.display = m === 'wf' ? 'block' : 'none';
    el('searchModeHint').textContent = m === 'wf'
      ? 'WF 직접 검색 (서비스 ID / UID)'
      : '메뉴(프로그램) 검색';
    el('btnSearch').textContent = m === 'wf' ? '서비스 검색' : '프로그램 검색';
    // 메뉴 리스트 헤더 전환 (이름 계열을 맨 앞에 — 검색 자체가 ID/명 기준이라 이름이 먼저 보이는 게 더 읽기 쉽다)
    const th = document.querySelector('.menu-list thead tr');
    if (th) {
      th.innerHTML = m === 'wf'
        ? '<th class="chk-col"><input id="menuChkAll" type="checkbox" title="전체 선택/해제"></th><th>서비스명</th><th>서비스 ID</th><th>UID</th>'
        : '<th class="chk-col"><input id="menuChkAll" type="checkbox" title="전체 선택/해제"></th><th>메뉴명</th><th>호출PGM_ID</th><th>모듈</th>';
      updateMenuSelectUi();
    }
  }

  const DB_TYPE_DEFAULT_PORT = { mssql: '1433', mysql: '3306', oracle: '1521' };

  function getCfg() {
    const dbType = el('dbType') ? el('dbType').value : 'mssql';
    // Oracle 은 서버 하나 = 서비스명(SID) 하나라 접속 "전"에 서비스명을 알아야 한다.
    // 그래서 Oracle 일 때는 별도의 서비스명 입력칸(dbOraSvc)을 database 값으로 쓰고,
    // 그 외(MSSQL/MySQL)는 기존처럼 접속 후 채워지는 DB 선택 콤보(dbName)를 쓴다.
    const database = (dbType === 'oracle') ? el('dbOraSvc').value.trim() : el('dbName').value;
    return {
      dbType,
      server: el('dbServer').value.trim(),
      port: el('dbPort').value.trim() || DB_TYPE_DEFAULT_PORT[dbType] || '1433',
      database,
      user: el('dbUser').value.trim(),
      password: el('dbPass').value,
      alias: el('connAlias').value.trim(),
      encrypt: el('dbEncrypt').checked
    };
  }

  // DB 종류를 바꾸면 포트 기본값과 입력칸 구성을 그에 맞게 조정한다.
  function onDbTypeChange() {
    const dbType = el('dbType').value;
    const portEl = el('dbPort');
    // 사용자가 손대지 않은 기본값이었을 때만 자동으로 바꿔준다(직접 입력한 값은 존중).
    const prevDefaults = Object.values(DB_TYPE_DEFAULT_PORT);
    if (!portEl.value.trim() || prevDefaults.includes(portEl.value.trim())) {
      portEl.value = DB_TYPE_DEFAULT_PORT[dbType] || '1433';
    }
    el('dbOraSvc').style.display = (dbType === 'oracle') ? '' : 'none';
    el('dbServer').placeholder = (dbType === 'oracle') ? '서버 IP' : '서버 IP\\인스턴스';
  }

  function showConnError(reason, detail) {
    const box = el('connError');
    box.querySelector('.ce-msg').textContent = reason || '연결에 실패했습니다.';
    const d = box.querySelector('.ce-detail');
    d.textContent = detail || '';
    d.style.display = 'none';
    el('ceDetailBtn').style.display = detail ? '' : 'none';
    box.style.display = 'flex';
  }
  function hideConnError() { el('connError').style.display = 'none'; }

  /* ---------- 모드 스위치 (데모 / DB / 오프라인 — 한 번에 하나) ---------- */
  // 사용자가 스위치 버튼을 눌렀을 때
  function switchMode(mode) {
    // 모드가 바뀌면 폴더(메뉴 트리) 캐시는 더 이상 유효하지 않다 — 새 모드에서 다시 불러온다.
    menuTreeCache = null; menuTreeSig = ''; folderPaths = [];
    if (mode === 'offline') {
      // 오프라인 데이터가 없으면 전환 불가 → 관리창 안내
      if (!WaveOffline.hasData || !WaveOffline.hasData()) {
        setStatus('오프라인 데이터가 없습니다. [데이터 관리]에서 먼저 다운로드하세요.', true);
        applyMode(activeMode);        // 스위치 원위치
        WaveOffline.openModal && WaveOffline.openModal();
        return;
      }
      // DB 연결 중이었으면 끊기(둘 중 하나만)
      if (!demoMode) silentDisconnect();
      offlineActive = true; demoMode = true;
      WaveOffline.setActive && WaveOffline.setActive(true);
    } else { // db
      offlineActive = false;
      WaveOffline.setActive && WaveOffline.setActive(false);
      // demoMode 는 실제 접속 성공 시 false 로 바뀜
    }
    applyMode(mode);
    populateFolderSelect();          // 새 모드 기준으로 폴더 드롭다운/안내 문구 초기화
    // 오프라인(로컬 파일)은 네트워크 조회가 없어 즉시 채워둔다. DB 연결은 비용이 있어
    // 사용자가 드롭다운을 열 때(지연 로딩) 또는 명시적 새로고침 때만 가져온다.
    if ((demoMode && !offlineActive) || offlineActive) ensureMenuTree();
    refreshTenantCoCdIfOpen(true);   // 고급옵션이 열려 있으면 새 모드 기준으로 테넌트/회사 콤보도 갱신
  }

  // 고급옵션(테넌트/회사) 패널이 이미 열려 있을 때만 목록을 다시 가져온다(닫혀 있으면 다음에
  // 열 때 loadTenantCoCdOptions 의 지연 로딩이 알아서 처리).
  function refreshTenantCoCdIfOpen(force) {
    const box = el('advOptions');
    if (box && box.style.display !== 'none') loadTenantCoCdOptions(force);
  }

  // 화면 반영: 스위치 하이라이트 + 해당 패널만 표시 + 라이브 상태
  function applyMode(mode) {
    activeMode = mode;
    ['db', 'offline'].forEach(m => {
      const btn = el('ms' + m.charAt(0).toUpperCase() + m.slice(1));
      if (btn) btn.classList.toggle('active', m === mode);
      const panel = el('panel' + m.charAt(0).toUpperCase() + m.slice(1));
      if (panel) panel.style.display = (m === mode) ? 'flex' : 'none';
    });
    // DB 패널: 연결 여부에 따라 입력폼/라이브 표시 전환
    if (mode === 'db') {
      const live = !demoMode && cfg;
      el('connFields').style.display = live ? 'none' : 'flex';
      el('connLive').style.display = live ? 'flex' : 'none';
      if (live) {
        el('connLiveName').textContent = (cfg.alias || cfg.server || 'DB');
      }
    }
    // 오프라인 패널: 폴더/데이터 표시
    if (mode === 'offline') {
      const f = (WaveOffline.folder && WaveOffline.folder()) || '';
      const has = WaveOffline.hasData && WaveOffline.hasData();
      const ol = el('offLive');
      el('offLiveFolder').textContent = f ? f : '파일 미선택';
      if (ol) ol.classList.toggle('has-data', !!has);
    }
  }
  function shortPath(p) {
    if (!p) return '';
    if (p.length <= 34) return p;
    return p.slice(0, 12) + '…' + p.slice(-20);
  }

  /* ---------- DB 접속 → DB 목록 콤보 채우기 ---------- */
  async function connectDb() {
    const base = getCfg();
    if (!base.server || !base.user) {
      showConnError('서버 IP와 계정(ID)을 먼저 입력하세요.');
      setStatus('서버 IP와 계정을 입력하세요.', true);
      return;
    }
    // Oracle 은 서버 하나 = 서비스명(SID) 하나라, MSSQL/MySQL 처럼 "접속 후 DB 목록에서 선택"이 불가능하다.
    // 접속 전에 서비스명(또는 SID)을 반드시 알아야 한다.
    if (base.dbType === 'oracle' && !base.database) {
      showConnError('Oracle 은 서비스명(또는 SID)을 먼저 입력하세요.');
      setStatus('서비스명/SID를 입력하세요.', true);
      return;
    }
    hideConnError();
    progress(true);
    setStatus('접속 중… DB 목록을 불러옵니다.');
    const r = await window.api.listDatabases(base);
    progress(false);
    if (r.ok) {
      demoMode = false;
      offlineActive = false;
      WaveOffline.setActive && WaveOffline.setActive(false);
      const sel = el('dbName');
      sel.innerHTML = '<option value="">— DB 선택 —</option>' +
        r.databases.map(d => '<option value="' + esc(d) + '">' + esc(d) + '</option>').join('');
      sel.disabled = false;
      cfg = getCfg();
      applyMode('db');   // 라이브 표시로 전환
      setStatus(base.dbType === 'oracle'
        ? '접속 성공 · 서비스명 "' + esc(base.database) + '" 확인됨.'
        : '접속 성공 · DB ' + r.databases.length + '개. 사용할 DB를 선택하세요.');
      refreshTenantCoCdIfOpen(true);
      sel.onchange = () => {
        cfg = getCfg(); applyMode('db'); setStatus('DB 선택됨 · ' + (cfg.database || '(미선택)'));
        refreshTenantCoCdIfOpen(true);
      };
    } else {
      showConnError(r.error, r.detail);
      setStatus('연결 실패: ' + r.error, true);
    }
  }

  // 조용히 끊기(상태만 정리, 화면 전환은 호출부에서)
  function silentDisconnect() {
    demoMode = true;
    cfg = null;
    const sel = el('dbName');
    if (sel) { sel.innerHTML = '<option value="">— DB 선택 —</option>'; sel.disabled = true; }
    hideConnError();
  }

  /* ---------- DB 접속 해제 → 연결 폼으로 되돌리기 ---------- */
  function disconnectDb() {
    silentDisconnect();
    switchMode('db');
    setStatus('DB 연결을 해제했습니다.');
  }

  function progress(on) {
    const p = el('progress');
    if (p) p.className = on ? 'progress on' : 'progress';
  }

  /* ---------- 비밀번호 보기 토글 ---------- */
  function togglePw() {
    const inp = el('dbPass'), btn = el('btnPwShow');
    if (inp.type === 'password') { inp.type = 'text'; btn.classList.add('on'); }
    else { inp.type = 'password'; btn.classList.remove('on'); }
  }

  /* ---------- 접속정보 저장/목록 관리 ---------- */
  function profileLabel(p) {
    // 주 디스플레이: 별칭 → 없으면 IP(server)
    return (p.alias && p.alias.trim()) ? p.alias.trim() : (p.server || '(이름없음)');
  }

  async function refreshProfiles(selectName) {
    const r = await window.api.connList();
    const sel = el('connProfiles');
    const list = (r.ok && r.profiles) ? r.profiles : [];
    sel.innerHTML = '<option value="">— 저장된 접속 —</option>' +
      list.map(p => '<option value="' + esc(p.name) + '">' + esc(profileLabel(p)) + '</option>').join('');
    if (selectName) sel.value = selectName;
    return list;
  }

  async function loadProfile() {
    const name = el('connProfiles').value;
    if (!name) { setStatus('불러올 접속정보를 목록에서 선택하세요.', true); return; }
    const r = await window.api.connList();
    const p = (r.profiles || []).find(x => x.name === name);
    if (!p) { setStatus('접속정보를 찾을 수 없습니다.', true); return; }
    const dbType = p.dbType || 'mssql';  // 예전에 저장된 접속정보(dbType 없음) 는 MSSQL 로 간주
    el('dbType').value = dbType;
    onDbTypeChange();
    el('connAlias').value = p.alias || '';
    el('dbServer').value = p.server || '';
    el('dbPort').value = p.port || DB_TYPE_DEFAULT_PORT[dbType] || '1433';
    el('dbUser').value = p.user || '';
    el('dbPass').value = p.password || '';
    el('dbEncrypt').checked = !!p.encrypt;
    if (dbType === 'oracle') {
      el('dbOraSvc').value = p.database || '';
    } else if (p.database) {
      const sel = el('dbName');
      sel.innerHTML = '<option value="' + esc(p.database) + '" selected>' + esc(p.database) + '</option>';
    }
    setStatus('접속정보 "' + profileLabel(p) + '" 불러옴. [접속]을 눌러 연결하세요.');
  }

  async function saveProfile() {
    const server = el('dbServer').value.trim();
    const user = el('dbUser').value.trim();
    if (!server || !user) { setStatus('서버와 계정을 입력한 뒤 저장하세요.', true); return; }
    const dbType = el('dbType').value;
    // 별칭: 입력값 → 없으면 IP(server)
    let alias = el('connAlias').value.trim();
    if (!alias) { alias = server; el('connAlias').value = alias; }
    // 저장 키(name)는 별칭 기반. 동일 별칭이면 덮어씀.
    const profile = {
      name: alias,           // 내부 식별자 = 별칭
      alias,
      dbType,
      server, port: el('dbPort').value.trim() || DB_TYPE_DEFAULT_PORT[dbType] || '1433',
      user, password: el('dbPass').value,
      database: (dbType === 'oracle' ? el('dbOraSvc').value.trim() : el('dbName').value) || '',
      encrypt: el('dbEncrypt').checked
    };
    const r = await window.api.connSave(profile);
    if (r.ok) { await refreshProfiles(profile.name); setStatus('접속정보 "' + alias + '" 저장됨 (비밀번호 포함).'); }
    else setStatus('저장 실패: ' + r.error, true);
  }

  async function deleteProfile() {
    const name = el('connProfiles').value;
    if (!name) { setStatus('삭제할 접속정보를 선택하세요.', true); return; }
    const label = el('connProfiles').selectedOptions[0] ? el('connProfiles').selectedOptions[0].textContent : name;
    if (!window.confirm('"' + label + '" 접속정보를 삭제할까요?')) return;
    const r = await window.api.connDelete(name);
    if (r.ok) { await refreshProfiles(); setStatus('접속정보 "' + label + '" 삭제됨.'); }
    else setStatus('삭제 실패: ' + r.error, true);
  }

  /* ---------- 메뉴 검색 ---------- */
  // DB 연결이 안 되어 있거나(접속 자체를 안 함), 접속은 했는데 사용할 DB를 선택 안 했거나,
  // 오프라인 모드인데 폴더(데이터)가 선택되지 않은 상태에서 검색을 누르면, 예전엔 남아있던
  // demoMode 플래그 때문에 조용히 데모 데이터로 검색돼버려 사용자가 착각하기 쉬웠다.
  // 현재 선택된 모드(activeMode) 기준으로 실제로 조회 가능한 상태인지 먼저 확인한다.
  function ensureDataSourceReady() {
    if (activeMode === 'offline') {
      if (!(offlineActive && WaveOffline.isOnline())) {
        setStatus('오프라인 데이터가 선택되지 않았습니다. 상단 [오프라인] 에서 폴더를 먼저 선택하세요.', true);
        return false;
      }
      return true;
    }
    if (activeMode === 'db') {
      if (demoMode || !cfg) {
        setStatus('DB에 연결되어 있지 않습니다. 상단 [DB 연결] 에서 먼저 접속하세요.', true);
        return false;
      }
      if (!cfg.database) {
        setStatus('접속한 DB에서 사용할 DB를 선택하지 않았습니다. 상단에서 DB를 선택하세요.', true);
        return false;
      }
      return true;
    }
    return true; // 데모 모드는 항상 사용 가능
  }

  async function doSearch() {
    if (!ensureDataSourceReady()) return;
    const mode = searchMode();
    if (mode === 'wf') return doSearchWf();
    return doSearchMenu();
  }

  async function doSearchMenu() {
    const lang = el('langSel').value;
    const mnuId = el('mnuId').value.trim();
    const mnuNm = el('mnuNm').value.trim();
    if (selectedFolderIdx !== '') return doSearchByFolder(selectedFolderIdx, mnuId, mnuNm);

    if (offlineActive && WaveOffline.isOnline()) {
      progress(true);
      setStatus('오프라인 검색 중…');
      const r = await window.api.offlineQueryMenu({
        filePath: WaveOffline.folder(), mnuId, mnuNm, productCd: el('productCd').value,
        tenantId: el('tenantId').value.trim() || '*', coCd: el('coCd').value.trim() || '*'
      });
      progress(false);
      if (!r.ok) { renderMenu([]); setStatus('오프라인 검색 실패: ' + r.error, true); return; }
      lastMenuRows = r.rows;
      renderMenu(lastMenuRows);
      setStatus(lastMenuRows.length ? ('프로그램 ' + lastMenuRows.length + '건 (오프라인)') : '검색 결과가 없습니다.');
      return;
    }

    if (demoMode) {
      lastMenuRows = (window.DEMO_DATA.menu || []).filter(r =>
        (!mnuId || (r.CALLED_PGM_ID || '').toUpperCase().includes(mnuId.toUpperCase())) &&
        (!mnuNm || (r.LEAF_MNU_NM || '').includes(mnuNm)));
      renderMenu(lastMenuRows);
      setStatus('데모: 메뉴 ' + lastMenuRows.length + '건');
      return;
    }

    cfg = getCfg();
    if (!cfg.database) { setStatus('먼저 상단에서 DB를 선택하세요.', true); return; }

    progress(true);
    setStatus('프로그램 검색 중…');
    const r = await window.api.searchMenu({
      cfg, tenantId: el('tenantId').value.trim() || '*', coCd: el('coCd').value.trim() || '*',
      productCd: el('productCd').value, lang, mnuId, mnuNm, mode: 'direct'
    });
    progress(false);
    if (!r.ok) {
      renderMenu([]);
      setStatus('검색 실패: ' + r.error, true);
      console.warn('SQL:', r.sql);
      return;
    }
    lastMenuRows = r.rows;
    renderMenu(lastMenuRows);
    setStatus(lastMenuRows.length ? ('프로그램 ' + lastMenuRows.length + '건') : '검색 결과가 없습니다.');
  }

  /* ---------- 폴더(메뉴 트리) 찾아보기 ---------- */
  // 메뉴 트리 계층 컬럼명(메뉴목록.sql/트리 조회 기준 L1~L6). 마지막으로 값이 있는 레벨이
  // 그 행(실행 가능 프로그램)의 "메뉴명 자신"이므로, 폴더 경로는 그 앞 단계까지만 사용한다.
  const HIER_LEVELS = ['L1_NM', 'L2_NM', 'L3_NM', 'L4_NM', 'L5_NM', 'L6_NM'];
  function rowFolderPath(r) {
    let leafLevel = -1;
    for (let i = HIER_LEVELS.length - 1; i >= 0; i--) { if (r[HIER_LEVELS[i]]) { leafLevel = i; break; } }
    if (leafLevel <= 0) return [];
    const path = [];
    for (let i = 0; i < leafLevel; i++) { if (r[HIER_LEVELS[i]]) path.push(r[HIER_LEVELS[i]]); }
    return path;
  }
  function pathStartsWith(rowPath, folderPath) {
    if (rowPath.length < folderPath.length) return false;
    for (let i = 0; i < folderPath.length; i++) if (rowPath[i] !== folderPath[i]) return false;
    return true;
  }
  // rows(트리 원본 행) → 중복 없는 폴더 경로 목록(각 폴더 아래 실행 가능 프로그램 수 포함), 계층 순 정렬.
  function buildFolderOptions(rows) {
    const map = new Map();
    rows.forEach(r => {
      const full = rowFolderPath(r);
      for (let d = 1; d <= full.length; d++) {
        const p = full.slice(0, d);
        const key = p.join('');
        if (!map.has(key)) map.set(key, { path: p, count: 0 });
      }
    });
    map.forEach(f => {
      f.count = rows.reduce((n, r) => n + (pathStartsWith(rowFolderPath(r), f.path) ? 1 : 0), 0);
    });
    const list = [...map.values()];
    list.sort((a, b) => {
      const n = Math.min(a.path.length, b.path.length);
      for (let i = 0; i < n; i++) { if (a.path[i] !== b.path[i]) return a.path[i] < b.path[i] ? -1 : 1; }
      return a.path.length - b.path.length;
    });
    return list;
  }
  function menuTreeSignature() {
    return [demoMode && !offlineActive ? 'demo' : (offlineActive ? 'off' : 'db'),
      el('tenantId').value.trim() || '*', el('coCd').value.trim() || '*',
      el('productCd').value, el('langSel').value].join('|');
  }
  // 폴더 목록이 새로 갱신됐을 때(트리 재조회) 호출 — 검색 입력창의 현재 선택은 유지하고
  // (선택된 폴더가 새 목록에서도 유효하면 그대로, 없어졌으면 선택 해제), 안내 문구를 갱신한다.
  function populateFolderSelect() {
    if (selectedFolderIdx !== '' && !folderPaths[+selectedFolderIdx]) clearFolderSelection(true);
    else if (selectedFolderIdx !== '') el('mnuFolderSearch').value = folderDisplayLabel(folderPaths[+selectedFolderIdx]);
    const hint = el('folderHint');
    if (_menuTreeLoading) {
      // 조회가 진행 중인 동안은 "데이터 없음" 안내를 띄우지 않는다 — 조회가 끝나기 전에
      // 잠깐 "없음"을 보여줬다가 곧바로 사라지는 깜빡임을 막기 위함.
      hint.style.display = 'none';
    } else if (offlineActive && !folderPaths.length) {
      hint.style.display = 'block';
      hint.textContent = '오프라인 메뉴(폴더 포함) 데이터가 없습니다. [⚙ 데이터 관리]에서 "제품"을 특정 값으로 선택한 뒤 메뉴를 다운로드하세요.';
    } else if (!folderPaths.length) {
      hint.style.display = 'block';
      hint.textContent = '폴더 목록이 비어 있습니다. ↻ 새로고침을 눌러 불러오세요.';
    } else {
      hint.style.display = 'none';
    }
    if (el('folderDropdown').style.display !== 'none') renderFolderDropdown(el('mnuFolderSearch').value);
  }

  /* ---------- 상위 폴더 검색형 콤보(자동완성 드롭다운) ---------- */
  // 폴더가 많아지면 기본 <select> 로는 하나씩 스크롤해서 찾아야 해서 불편하다는 피드백을 반영해,
  // 텍스트를 입력하면 경로 어디든 일치하는 폴더만 걸러서 보여주는 검색형 콤보로 바꿨다.
  function folderDisplayLabel(f) { return '📁 ' + f.path.join(' / ') + ' (' + f.count + ')'; }

  function bindFolderPicker() {
    const inp = el('mnuFolderSearch');
    inp.addEventListener('focus', () => { if (!menuTreeCache) ensureMenuTree(); openFolderDropdown(); renderFolderDropdown(inp.value); });
    inp.addEventListener('click', () => { openFolderDropdown(); });
    inp.addEventListener('input', () => {
      // 사용자가 타이핑을 시작하면 기존 선택은 해제된 것으로 간주(다시 선택할 때까지는 "선택 안 함").
      if (selectedFolderIdx !== '') { selectedFolderIdx = ''; el('btnFolderClear').style.display = 'none'; }
      openFolderDropdown();
      renderFolderDropdown(inp.value);
    });
    inp.addEventListener('keydown', (e) => {
      const dd = el('folderDropdown');
      const items = [...dd.querySelectorAll('.folder-item:not(.folder-item-empty)')];
      if (e.key === 'Escape') { closeFolderDropdown(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); moveFolderActive(items, 1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); moveFolderActive(items, -1); return; }
      if (e.key === 'Enter') {
        e.preventDefault();
        const active = folderDropdownActiveIdx >= 0 ? items[folderDropdownActiveIdx] : null;
        if (active && active.dataset.idx != null) { selectFolderByIdx(+active.dataset.idx); closeFolderDropdown(); }
        else if (active && active.dataset.none != null) { clearFolderSelection(); closeFolderDropdown(); }
        else doSearch();
      }
    });
    el('btnFolderClear').addEventListener('click', (e) => { e.stopPropagation(); clearFolderSelection(); inp.focus(); });
    // 바깥을 클릭하면 드롭다운을 닫는다.
    document.addEventListener('click', (e) => {
      if (!el('folderPicker').contains(e.target)) closeFolderDropdown();
    });
  }
  function moveFolderActive(items, delta) {
    if (!items.length) return;
    folderDropdownActiveIdx = Math.max(0, Math.min(items.length - 1, folderDropdownActiveIdx + delta));
    items.forEach((it, i) => it.classList.toggle('active', i === folderDropdownActiveIdx));
    items[folderDropdownActiveIdx].scrollIntoView({ block: 'nearest' });
  }
  function openFolderDropdown() { el('folderDropdown').style.display = 'block'; }
  function closeFolderDropdown() { el('folderDropdown').style.display = 'none'; folderDropdownActiveIdx = -1; }
  // term(검색어)이 경로의 어느 부분과든 일치하는 폴더만 걸러서 목록으로 그린다.
  function renderFolderDropdown(term) {
    const dd = el('folderDropdown');
    const q = (term || '').trim().toLowerCase();
    // 검색어가 현재 선택된 폴더의 표시 텍스트와 정확히 같으면(방금 선택함) 필터링 없이 전체를 보여준다.
    const isExactSelection = selectedFolderIdx !== '' && folderPaths[+selectedFolderIdx] && folderDisplayLabel(folderPaths[+selectedFolderIdx]) === term;
    const matches = folderPaths
      .map((f, i) => ({ f, i }))
      .filter(({ f }) => !q || isExactSelection || f.path.join(' / ').toLowerCase().includes(q));
    dd.innerHTML = '';
    if (!folderPaths.length) {
      dd.innerHTML = '<div class="folder-item folder-item-empty">폴더 목록이 없습니다. ↻ 새로고침을 눌러보세요.</div>';
      return;
    }
    const noneOpt = document.createElement('div');
    noneOpt.className = 'folder-item folder-item-none';
    noneOpt.dataset.none = '1';
    noneOpt.textContent = '— 폴더 선택 안 함(텍스트로 검색) —';
    noneOpt.addEventListener('mousedown', (e) => { e.preventDefault(); clearFolderSelection(); closeFolderDropdown(); });
    dd.appendChild(noneOpt);
    if (!matches.length) {
      const empty = document.createElement('div');
      empty.className = 'folder-item folder-item-empty';
      empty.textContent = '"' + term + '" 와 일치하는 폴더가 없습니다.';
      dd.appendChild(empty);
      return;
    }
    matches.forEach(({ f, i }) => {
      const item = document.createElement('div');
      item.className = 'folder-item';
      item.dataset.idx = String(i);
      const indent = '　'.repeat(Math.max(0, f.path.length - 1));
      item.innerHTML = '<span class="folder-item-indent">' + indent + '</span>📁 ' +
        esc(f.path[f.path.length - 1]) + ' <span class="folder-item-cnt">(' + f.count + ')</span>';
      item.title = f.path.join(' / ');
      item.addEventListener('mousedown', (e) => { e.preventDefault(); selectFolderByIdx(i); closeFolderDropdown(); });
      dd.appendChild(item);
    });
    folderDropdownActiveIdx = -1;
  }
  function selectFolderByIdx(idx) {
    const f = folderPaths[idx];
    if (!f) return;
    selectedFolderIdx = String(idx);
    el('mnuFolderSearch').value = folderDisplayLabel(f);
    el('btnFolderClear').style.display = '';
  }
  // 초기화 버튼(또는 목록 갱신으로 선택이 무효화됐을 때) — 텍스트 검색 모드로 되돌린다.
  function clearFolderSelection(silent) {
    selectedFolderIdx = '';
    el('mnuFolderSearch').value = '';
    el('btnFolderClear').style.display = 'none';
    if (!silent) el('mnuFolderSearch').focus();
  }
  // 폴더 트리를 한 번 조회해 캐시한다. 오프라인은 로컬에 받아둔 menu.sqlite(L1~L6 포함)에서 읽고,
  // 데모는 메모리 샘플, DB 연결은 실시간 트리 조회를 쓴다.
  async function ensureMenuTree(force) {
    const sig = menuTreeSignature();
    if (!force && menuTreeCache && menuTreeSig === sig) return menuTreeCache;
    let rows = [];
    _menuTreeLoading = true;
    try {
    if (offlineActive) {
      if (!WaveOffline.isOnline()) { menuTreeCache = []; folderPaths = []; _menuTreeLoading = false; populateFolderSelect(); return []; }
      // 오프라인 파일 하나에 여러 제품 메뉴가 함께 저장돼 있을 수 있으므로(DB 접속 모드와 동일하게)
      // 폴더 트리는 항상 "선택된 제품 하나" 기준으로만 구성한다.
      if (!el('productCd').value) { setStatus('폴더 조회는 "제품"을 특정 값으로 선택해야 합니다(전체 불가).', true); _menuTreeLoading = false; return menuTreeCache || []; }
      progress(true);
      setStatus('폴더(메뉴 트리) 불러오는 중… (오프라인)');
      const r = await window.api.offlineQueryMenuTree({
        filePath: WaveOffline.folder(), productCd: el('productCd').value,
        tenantId: el('tenantId').value.trim() || '*', coCd: el('coCd').value.trim() || '*'
      });
      progress(false);
      if (!r.ok) {
        setStatus('오프라인 폴더 트리 조회 실패: ' + r.error, true);
        menuTreeCache = []; folderPaths = []; _menuTreeLoading = false; populateFolderSelect();
        return [];
      }
      rows = r.rows;
    } else if (demoMode) {
      rows = window.DEMO_DATA.menu || [];
    } else {
      cfg = getCfg();
      if (!cfg.database) { setStatus('먼저 상단에서 DB를 선택하세요.', true); _menuTreeLoading = false; return menuTreeCache || []; }
      if (!el('productCd').value) { setStatus('폴더 조회는 "제품"을 특정 값으로 선택해야 합니다(전체 불가).', true); _menuTreeLoading = false; return menuTreeCache || []; }
      progress(true);
      setStatus('폴더(메뉴 트리) 불러오는 중…');
      const r = await window.api.searchMenu({
        cfg, tenantId: el('tenantId').value.trim() || '*', coCd: el('coCd').value.trim() || '*',
        productCd: el('productCd').value, lang: el('langSel').value, mnuId: '', mnuNm: '', mode: 'tree'
      });
      progress(false);
      if (!r.ok) { setStatus('폴더 트리 조회 실패: ' + r.error, true); console.warn('SQL:', r.sql); _menuTreeLoading = false; return menuTreeCache || []; }
      rows = r.rows;
    }
    } finally { _menuTreeLoading = false; }
    menuTreeCache = rows; menuTreeSig = sig;
    folderPaths = buildFolderOptions(rows);
    populateFolderSelect();
    return rows;
  }
  // 선택한 폴더 경로 이하의 모든 프로그램을 캐시에서 필터링(텍스트 필터가 있으면 함께 적용).
  async function doSearchByFolder(folderIdx, mnuId, mnuNm) {
    const rows = await ensureMenuTree();
    const idx = +folderIdx;
    const folder = folderPaths[idx];
    if (!folder) { renderMenu([]); setStatus('폴더 정보를 찾을 수 없습니다. ↻ 새로고침 후 다시 시도하세요.', true); return; }
    lastMenuRows = rows.filter(r => {
      if (!pathStartsWith(rowFolderPath(r), folder.path)) return false;
      if (mnuId && !(r.CALLED_PGM_ID || '').toUpperCase().includes(mnuId.toUpperCase())) return false;
      if (mnuNm && !(r.LEAF_MNU_NM || '').includes(mnuNm)) return false;
      return true;
    });
    renderMenu(lastMenuRows);
    setStatus('폴더 "' + folder.path.join(' / ') + '" · 프로그램 ' + lastMenuRows.length + '건');
  }

  // WF 직접 검색 (서비스 ID / UID)
  async function doSearchWf() {
    const svcId = el('svcId').value.trim();
    const svcUid = el('svcUid').value.trim();

    if (offlineActive && WaveOffline.isOnline()) {
      progress(true);
      setStatus('오프라인 서비스 검색 중…');
      // 오프라인은 정확 조회 위주 → uid 우선, 없으면 id 부분일치는 미지원이므로 안내
      const tenantId = el('tenantId').value.trim() || '*', coCd = el('coCd').value.trim() || '*';
      let rows = [];
      if (svcUid) {
        const r = await window.api.offlineQueryWave({ filePath: WaveOffline.folder(), wave: 'WF', keyType: 'serviceUid', keyValue: svcUid, tenantId, coCd, searchMode: true });
        rows = r.ok ? r.rows : [];
      } else if (svcId) {
        const r = await window.api.offlineQueryWave({ filePath: WaveOffline.folder(), wave: 'WF', keyType: 'service', keyValue: svcId, tenantId, coCd, searchMode: true });
        rows = r.ok ? r.rows : [];
      }
      progress(false);
      lastMenuRows = rows.map(mapWfToMenuRow);
      renderMenu(lastMenuRows);
      setStatus(lastMenuRows.length ? ('서비스 ' + lastMenuRows.length + '건 (오프라인)') : '검색 결과가 없습니다. (오프라인은 정확 일치 조회)');
      return;
    }

    if (demoMode) {
      const rows = (window.DEMO_DATA.wf || []).filter(w =>
        (!svcId || (w.SERVICE_ID || '').toUpperCase().includes(svcId.toUpperCase())) &&
        (!svcUid || String(w.SERVICE_UID).includes(svcUid)));
      lastMenuRows = rows.map(mapWfToMenuRow);
      renderMenu(lastMenuRows);
      setStatus('데모: 서비스 ' + lastMenuRows.length + '건');
      return;
    }

    cfg = getCfg();
    if (!cfg.database) { setStatus('먼저 상단에서 DB를 선택하세요.', true); return; }
    if (!svcId && !svcUid) { setStatus('서비스 ID 또는 UID를 입력하세요.', true); return; }

    progress(true);
    setStatus('서비스 검색 중…');
    const r = await window.api.searchWf({
      cfg, tenantId: el('tenantId').value.trim() || '*', coCd: el('coCd').value.trim() || '*',
      svcId, svcUid
    });
    progress(false);
    if (!r.ok) {
      renderMenu([]);
      setStatus('검색 실패: ' + r.error, true);
      console.warn('SQL:', r.sql);
      return;
    }
    lastMenuRows = r.rows.map(mapWfToMenuRow);
    renderMenu(lastMenuRows);
    setStatus(lastMenuRows.length ? ('서비스 ' + lastMenuRows.length + '건') : '검색 결과가 없습니다.');
  }

  // WF 검색 결과를 공통 리스트 구조로 매핑 (파도타기 루트가 WF 가 되도록 표시)
  function mapWfToMenuRow(w) {
    return {
      _wf: true,
      CALLED_PGM_ID: w.SERVICE_ID,
      SERVICE_UID: w.SERVICE_UID != null ? String(w.SERVICE_UID) : null,
      LEAF_MNU_NM: w.SERVICE_NAME || w.SERVICE_ID,
      MODULE_CD: '',
      TENANT_ID: w.TENANT_ID || '*',
      CO_CD: w.CO_CD || '*'
    };
  }

  function renderMenu(rows) {
    // lastMenuRows 는 항상 이 함수를 통해 그려진 목록과 정확히 같아야 한다(검색결과 개수 표시,
    // 전체선택, 일괄 저장 등이 모두 lastMenuRows 를 기준으로 동작하기 때문) — 호출부에서 실패 시
    // renderMenu([]) 만 부르고 lastMenuRows 갱신을 잊는 경우가 있어 여기서 한 번에 맞춰준다.
    lastMenuRows = rows;
    const tb = el('menuBody');
    tb.innerHTML = '';
    selectedMenu = null;
    multiSelected = new Set();
    el('menuEmpty').style.display = rows.length ? 'none' : 'block';
    rows.forEach((r, i) => {
      const tr = document.createElement('tr');
      const chkTd = '<td class="chk-col"><input type="checkbox" class="menu-row-chk" data-i="' + i + '"></td>';
      // 이름 계열(메뉴명/서비스명)을 맨 앞에 — ID/명으로 검색했으므로 이름이 먼저 보이는 게 더 읽기 쉽다.
      if (r._wf) {
        tr.innerHTML = chkTd +
          '<td>' + esc(r.LEAF_MNU_NM || '') + '</td>' +
          '<td>' + esc(r.CALLED_PGM_ID) + '</td>' +
          '<td>' + esc(r.SERVICE_UID || '') + '</td>';
      } else {
        tr.innerHTML = chkTd +
          '<td>' + esc(r.LEAF_MNU_NM || '') + '</td>' +
          '<td>' + esc(r.CALLED_PGM_ID) + '</td>' +
          '<td>' + esc(r.MODULE_CD || '') + '</td>';
      }
      tr.addEventListener('click', () => {
        [...tb.children].forEach(c => c.classList.remove('sel'));
        tr.classList.add('sel');
        selectedMenu = r;
      });
      // 더블클릭 → 바로 파도타기 실행 + (UI/Mo/Rp 화면이면) 그래프 왼쪽 "UI" 탭에 디자인 바로 표시.
      // 기존처럼 그래프 탭도 그대로 채워지므로(더 깊이 볼 땐 그래프에서 코드·디자인 보기 팝업 사용),
      // 여기서는 "빠른 확인" 경로만 하나 추가하는 것 — doRun() 자체의 동작은 바꾸지 않는다.
      tr.addEventListener('dblclick', async () => {
        [...tb.children].forEach(c => c.classList.remove('sel'));
        tr.classList.add('sel');
        selectedMenu = r;
        await doRun();
      });
      tr.querySelector('.menu-row-chk').addEventListener('click', (e) => {
        e.stopPropagation();
        toggleMultiSelect(i, e.target.checked);
      });
      tb.appendChild(tr);
    });
    if (rows.length) { tb.children[0].click(); }
    updateMenuSelectUi();
  }

  /* ---------- 멀티 선택 + 일괄 다운로드 ---------- */
  function toggleMultiSelect(i, on) {
    if (on) multiSelected.add(i); else multiSelected.delete(i);
    updateMenuSelectUi();
  }
  // 검색 결과 개수 + 선택 개수 표시(단일 지점) — 헤더의 전체선택 체크박스 상태도 여기서 맞춘다.
  // 선택된 항목이 있으면 우측 하단 [일괄 저장(전체)]가 "선택 항목만 다운로드" 모드로 동작한다는
  // 것을 바로 알 수 있도록 안내를 함께 붙인다.
  function updateMenuSelectUi() {
    const n = multiSelected.size;
    const cnt = el('menuCount');
    if (cnt) {
      if (lastMenuRows.length) {
        cnt.style.display = 'block';
        cnt.textContent = '검색 결과 ' + lastMenuRows.length + '건' +
          (n ? (' · ' + n + '개 선택 — [일괄 저장(전체)]가 선택 항목만 저장합니다') : '');
      } else {
        cnt.style.display = 'none';
      }
    }
    const chkAll = el('menuChkAll');
    if (chkAll) chkAll.checked = lastMenuRows.length > 0 && n === lastMenuRows.length;
  }
  function toggleMultiSelectAll(on) {
    const tb = el('menuBody');
    multiSelected = new Set();
    [...tb.querySelectorAll('.menu-row-chk')].forEach(chk => {
      chk.checked = on;
      if (on) multiSelected.add(+chk.getAttribute('data-i'));
    });
    updateMenuSelectUi();
  }

  // 우측 하단 [일괄 저장(전체)] 버튼의 진입점 — 검색 결과 목록에 체크된 항목이 있으면
  // "선택 항목들을 모아 다운로드"로 동작하고, 없으면 기존과 동일하게 지금 조회 중인
  // 전체 데이터를 그대로 저장한다.
  async function saveAllOrBatch() {
    if (multiSelected.size > 0) return runSelectedBatchDownload();
    return save('all');
  }

  // 선택된 여러 프로그램을 하나의 store 에 이어서 파도타기 확장한 뒤, 한 번에 저장(다운로드)한다.
  // (store 는 배치 시작 시 한 번만 비우므로, 여러 프로그램이 공유하는 WF/테이블 등은 중복 없이 하나로 합쳐진다.)
  // 오직 다운로드(저장)만 수행한다 — 그래프/테이블/상세 등 화면 반영은 전혀 건드리지 않는다
  // (사용자 요청: "다운로드 시 딱 다운로드만 하고 아무것도 하지 말아줘"). 그래프 탭 등 다른 화면은
  // 이전 상태 그대로 유지된다.
  async function runSelectedBatchDownload() {
    const idxList = [...multiSelected].sort((a, b) => a - b);
    if (!idxList.length) return;
    const waves = checkedWaves();
    if (!waves.length) { setStatus('Wave 를 최소 1개 선택하세요.', true); return; }
    if (!ensureDataSourceReady()) return;
    const maxDepth = Infinity; // 깊이 제한 없이 전체 파도타기(취소 버튼으로 중단 가능)

    store.clear();
    progress(true);
    const cancelToken = beginWaveRun();
    let okCount = 0;
    try {
      for (let n = 0; n < idxList.length; n++) {
        if (cancelToken.cancelled) break;
        const row = lastMenuRows[idxList[n]];
        if (!row) continue;
        setStatus('일괄 다운로드 중… (' + (n + 1) + '/' + idxList.length + ') ' + (row.CALLED_PGM_ID || ''));
        const key = await expandOneProgram(row, { waves, maxDepth, cancelToken });
        if (key) okCount++;
      }
      progress(false);
      endWaveRun();
      if (okCount > 0) await save('all');
      const c = store.counts();
      const cancelNote = cancelToken.cancelled ? '(취소됨, 지금까지 조회된 내용만 포함) ' : '';
      setStatus('일괄 다운로드 완료 ' + cancelNote + '· 프로그램 ' + okCount + '/' + idxList.length + '건 · UI ' + c.UI + ' / WF ' + c.WF + ' / Rp ' + c.Rp + ' / Mo ' + c.Mo + ' / 테이블 ' + c.TABLE);
    } catch (e) {
      progress(false);
      endWaveRun();
      setStatus('오류: ' + (e && e.message ? e.message : e), true);
    }
  }

  // 파도타기 진행 중 취소 기능: 실행 시작 시 새 취소 토큰을 발급하고 [취소] 버튼을 보여준다.
  // expandOneProgram/expandWaves/expandUiPopups/expandReports 는 각 루프 진입 시 이 토큰을
  // 확인해 cancelled 면 더 이상의 네트워크 조회 없이 즉시 중단한다(지금까지 모은 결과는 유지).
  let _activeCancelToken = null;
  function beginWaveRun() {
    const token = { cancelled: false };
    _activeCancelToken = token;
    const btn = el('btnCancelRun');
    if (btn) btn.style.display = '';
    return token;
  }
  function endWaveRun() {
    _activeCancelToken = null;
    const btn = el('btnCancelRun');
    if (btn) btn.style.display = 'none';
  }
  function cancelActiveWaveRun() {
    if (_activeCancelToken) { _activeCancelToken.cancelled = true; setStatus('취소 요청됨 · 진행 중인 조회를 정리하고 있습니다…'); }
  }

  /* ---------- 실행: 파도타기 ---------- */
  function checkedWaves() {
    const w = [];
    if (el('wUI').checked) w.push('UI');
    if (el('wWF').checked) w.push('WF');
    if (el('wRp').checked) w.push('Rp');
    if (el('wMo').checked) w.push('Mo');
    return w;
  }

  /* ---------- .erp 파일 불러오기 (저장된 결과를 재조회 없이 그대로 복원) ---------- */
  const ERP_TABLE_TO_TYPE = { z_ui_deploy_info: 'UI', z_wf_deploy_info: 'WF', z_mo_deploy_info: 'Mo', z_rp_deploy_info: 'Rp' };

  // .erp 의 data(JSON) 를 store 에 그대로 주입한다. 이미 완성된 그래프이므로
  // DB/오프라인을 다시 조회하지 않고, 저장 시 뽑아낸 nodes/edges 를 되돌려 넣기만 한다.
  // 주의: buildJson()은 저장할 때 노드의 raw(원본 테이블 행)를 record 라는 이름으로 내보낸다.
  // 여기서 다시 raw 로 되돌려 놓지 않으면, raw 에 의존하는 상세 패널·SQL 목록·흐름도(RESOURCE_WF)
  // 등 대부분의 기능이 동작하지 않으므로 반드시 복원해야 한다.
  function loadErpDataIntoStore(data) {
    store.clear();
    _syntheticNodeCache.clear(); // 이전 세션에서 만들어졌던 합성 노드(임베디드 리포트 등)도 함께 비운다.
    (data.nodes || []).forEach(n => {
      const node = Object.assign({}, n);
      if (node.record && !node.raw) node.raw = node.record;
      store.addNode(node);
    });
    (data.edges || []).forEach(e => store.addEdge(e.from, e.to, e.relType));
  }

  // store 에 담긴 프로그램(UI/WF/Mo/Rp) 노드를 좌측 검색 결과 목록(renderMenu) 형식으로 변환.
  // 메뉴명(name)이 있으면 그걸 쓰고, 없으면 프로그램ID를 그대로 이름 자리에 보여준다.
  function erpNodesToMenuRows(data) {
    return (data.nodes || [])
      .filter(n => ['UI', 'WF', 'Mo', 'Rp'].includes(n.type))
      .map(n => {
        const isWf = n.type === 'WF';
        return {
          _wf: isWf,
          CALLED_PGM_ID: n.id,
          SERVICE_UID: isWf ? (n.uid != null ? String(n.uid) : null) : undefined,
          LEAF_MNU_NM: n.name || n.id, // 메뉴명 없으면 프로그램ID로 대체
          MODULE_CD: n.module || '',
          TENANT_ID: (n.record && n.record.TENANT_ID) || '*',
          CO_CD: (n.record && n.record.CO_CD) || '*'
        };
      });
  }

  async function handleLoadErp() {
    let r;
    try { r = await window.api.loadErp(); } catch (e) { setStatus('불러오기 실패: ' + e.message, true); return; }
    if (!r || r.canceled) return;
    if (!r.ok) { setStatus('불러오기 실패: ' + (r.error || '알 수 없는 오류'), true); return; }
    _lastErpPath = r.path || '';

    // 1) 생성 정보 카드 먼저 표시 (확인을 눌러야 목록/그래프에 반영)
    const m = r.meta || {};
    el('erpInfoCreatedAt').textContent = m.createdAt ? new Date(m.createdAt).toLocaleString() : '-';
    el('erpInfoHostname').textContent = m.hostname || '-';
    el('erpInfoOsUser').textContent = m.osUser || '-';
    el('erpInfoExternalIp').textContent = m.externalIp || '-';
    el('erpInfoAppVer').textContent = m.appVer || '-';
    const s = (r.data && r.data.summary) || {};
    el('erpInfoSummary').textContent =
      `포함 항목 · UI ${s.UI || 0} / WF ${s.WF || 0} / Rp ${s.Rp || 0} / Mo ${s.Mo || 0} / 테이블 ${s.TABLE || 0}`;

    const modal = el('erpInfoModal');
    modal.style.display = 'flex';
    el('erpInfoOk').onclick = () => {
      modal.style.display = 'none';
      applyLoadedErp(r.data);
    };
  }

  let _lastErpPath = '';

  // 생성 정보 카드에서 [확인]을 누른 뒤: 좌측 목록에 전체 반영 + 첫 행을 더블클릭한 것처럼 그래프로 표시.
  function applyLoadedErp(data) {
    loadErpDataIntoStore(data);
    // 이전(불러오기 전) 그래프에서 쌓인 흐름도 상태를 들고 오면 안 된다 —
    // flowNavStack 의 key 가 새 store 에 없을 수 있어 [◀ 뒤로] 클릭 시 엉뚱하게 동작할 수 있음.
    flowNavStack = [];
    flowNodeKey = null;
    currentFlowScope = null;
    currentFlowRaw = null;
    updateFlowBackButton();

    const rows = erpNodesToMenuRows(data);
    renderMenu(rows); // renderMenu 는 목록을 그리며 첫 행을 클릭 상태로 만들어 selectedMenu 를 세팅해준다.
    if (!rows.length) { setStatus('불러온 파일에 프로그램 정보가 없습니다.', true); return; }

    // "첫 행 더블클릭"과 동일한 결과: 이미 store 에 전체 그래프가 있으므로 재조회 없이 바로 렌더링.
    const first = rows[0];
    const firstType = guessTypeForRow(first, data); // UI/WF/Mo/Rp 정확한 타입을 노드에서 역조회
    const rootKey = store.nodeKey(firstType, first.CALLED_PGM_ID, first.SERVICE_UID);
    // 그래프 탭이 보이는 상태에서 렌더/배치해야 컨테이너 크기가 정상 측정된다(숨김 탭에서
    // 먼저 그리면 0 크기로 배치되는 문제 방지).
    switchTab('graph');
    G.render(store, rootKey, store.basket);
    G.fit();
    renderTable();
    refreshBasket();
    showDetail(rootKey);
    setStatus('불러오기 완료 · ' + rows.length + '개 프로그램 · ' + _lastErpPath);
  }

  // erpNodesToMenuRows 로 만든 row 는 UI/Mo/Rp 를 구분 못 하므로(모두 화면계열로 뭉뚱그려짐),
  // 실제 노드 타입은 data.nodes 에서 CALLED_PGM_ID(=id) 로 역조회해 정확히 찾는다.
  function guessTypeForRow(row, data) {
    const hit = (data.nodes || []).find(n => n.id === row.CALLED_PGM_ID && n.type !== 'TABLE');
    return hit ? hit.type : 'UI';
  }

  // rootKey 가 UI/Mo/Rp 화면이면 그래프 왼쪽 "UI" 탭에 디자인을 바로 띄운다.
  // doRun()(검색 하단 [▶ 연관 조회 실행] 버튼)과 검색 결과 더블클릭 양쪽에서 동일하게 쓴다.
  function openUiTabForRoot() {
    if (!rootKey) return;
    const rootNode = store.nodes.get(rootKey);
    if (rootNode && (rootNode.type === 'UI' || rootNode.type === 'Mo' || rootNode.type === 'Rp')) {
      openUiTabNode(rootNode, { fromNav: false });
    }
  }

  async function doRun() {
    if (!selectedMenu) { setStatus('먼저 메뉴(프로그램)를 선택하세요.', true); return; }
    const waves = checkedWaves();
    if (!waves.length) { setStatus('Wave 를 최소 1개 선택하세요.', true); return; }
    if (!ensureDataSourceReady()) return;
    const maxDepth = Infinity; // 깊이 제한 없이 전체 파도타기(취소 버튼으로 중단 가능)

    store.clear();
    rootKey = null;
    // 새로 파도타기를 실행하므로 이전 그래프에서 쌓인 흐름도 이동 이력은 더 이상 유효하지 않다.
    flowNavStack = [];
    flowNodeKey = null;
    currentFlowScope = null;
    currentFlowRaw = null;
    updateFlowBackButton();
    // 이전 실행에서 만들어졌던 합성 노드(임베디드 리포트 등)도 이번 store 와는 무관해졌으므로 함께 비운다.
    _syntheticNodeCache.clear();
    progress(true);
    const cancelToken = beginWaveRun();
    setStatus('연관 조회 중… (' + selectedMenu.CALLED_PGM_ID + ')');
    try {
      rootKey = await expandOneProgram(selectedMenu, { waves, maxDepth, cancelToken });
      progress(false);
      endWaveRun();
      // 그래프 탭이 화면에 보이는 상태에서 렌더/배치해야 컨테이너 크기가 정상 측정된다.
      // (숨겨진 탭에서 먼저 그리면 0 크기로 배치돼 다음 번에 다시 그려야만 정상화되는 문제가 있었음)
      switchTab('graph');
      G.render(store, rootKey, store.basket);
      G.fit();
      renderTable();
      refreshBasket();
      showDetail(rootKey);
      // [▶ 연관 조회 실행] 버튼도 검색 결과 더블클릭과 동일하게, 결과가 UI/Mo/Rp 화면이면
      // 그래프 왼쪽 "UI" 탭에 디자인을 바로 띄운다(요청사항: 버튼 클릭이 더블클릭과 다르게
      // 동작해 UI 탭으로 자동으로 안 갔던 문제).
      openUiTabForRoot();
      const c = store.counts();
      const cancelNote = cancelToken.cancelled ? '(취소됨, 지금까지 조회된 내용만 표시) ' : '';
      if (!rootKey) {
        setStatus('연관 데이터가 없습니다. 선택한 Wave 테이블에 해당 프로그램ID가 없을 수 있습니다.', true);
      } else {
        setStatus('완료 ' + cancelNote + '· UI ' + c.UI + ' / WF ' + c.WF + ' / Rp ' + c.Rp + ' / Mo ' + c.Mo + ' / 테이블 ' + c.TABLE);
      }
    } catch (e) {
      progress(false);
      endWaveRun();
      setStatus('오류: ' + (e && e.message ? e.message : e), true);
    }
  }

  // 한 프로그램(menuRow)에 대해 파도타기(연관 확장)를 수행해 store 에 누적한다.
  // store.clear() 는 이 함수 안에서 호출하지 않으므로, 이 함수를 store 를 비우지 않고
  // 여러 번 연속 호출하면(runBatchDownload) 결과가 하나의 그래프로 합쳐진다.
  // 반환값: 이 프로그램의 루트 노드 key(없으면 null).
  async function expandOneProgram(menuRow, opts) {
    const waves = opts.waves, maxDepth = opts.maxDepth;
    const tenantId = (menuRow.TENANT_ID || el('tenantId').value.trim() || '*');
    const coCd = (menuRow.CO_CD || el('coCd').value.trim() || '*');
    const programId = menuRow.CALLED_PGM_ID;

    // 루트: 선택 프로그램을 UI/Mo/Rp 노드로 (체크된 것 우선순위 UI>Mo>Rp)
    const ctx = { cfg, tenantId, coCd, waves, maxDepth, visitedWf: new Set(),
      cancelToken: opts.cancelToken || { cancelled: false } };
    const isWfRoot = !!menuRow._wf;   // WF 직접검색에서 선택된 경우
    let localRoot = null;

    // 0) WF 직접검색 루트: 선택한 서비스 자체를 루트로 (UID 우선)
    if (isWfRoot) {
      let rows = [];
      if (menuRow.SERVICE_UID) rows = await fetchWave('WF', 'serviceUid', menuRow.SERVICE_UID, tenantId, coCd);
      if (!rows.length) rows = await fetchWave('WF', 'service', programId, tenantId, coCd);
      rows.forEach(row => {
        const node = addWfNode(row, 0);
        if (!localRoot) localRoot = node.key;
        node._expanded = true;  // 루트는 확장 완료로 표시
        const parsed = P.parseWf(row);
        parsed.refs.forEach(ref => {
          const child = store.addNode({ type: 'WF', id: ref.id, uid: ref.uid, name: ref.id, depth: 1 });
          store.addEdge(node.key, child.key, 'calls');
          if (!child._expanded) child._queuedDepth = 1;
        });
        linkTables(node, parsed.tables, 0);
        if (waves.includes('Rp')) linkReports(node, parsed.reports, 1, ctx);
      });
    }

    // 1) 화면계열(UI/Mo/Rp) 루트 조회
    if (!isWfRoot) for (const w of ['UI', 'Mo', 'Rp']) {
      if (!waves.includes(w)) continue;
      const rows = await fetchWave(w, 'program', programId, tenantId, coCd);
      rows.forEach(row => {
        const idCol = w === 'Rp' ? 'REPORT_PROGRAM_ID' : 'PROGRAM_ID';
        const nmCol = w === 'Rp' ? 'REPORT_PROGRAM_NM' : 'PROGRAM_NM';
        // 메뉴검색에서 선택한 메뉴명이 있으면 그것을 우선 사용(부가 UI 와 표기 통일)
        const menuNm = (menuRow && (menuRow.CALLED_PGM_ID === row[idCol]) && menuRow.LEAF_MNU_NM) ? menuRow.LEAF_MNU_NM : null;
        const node = store.addNode({ type: w, id: row[idCol], name: menuNm || row[nmCol], module: row.MODULE_CD, depth: 0, raw: row });
        if (menuNm) node.menuNm = menuNm;
        if (!localRoot) localRoot = node.key;
        // 참조 추출
        const parsed = (w === 'Rp') ? P.parseRp(row) : P.parseUi(row);
        linkRefs(node, parsed, ctx, 1);
        if (parsed.tables) linkTables(node, parsed.tables, 1);
      });
    }

    // WF 만 체크되고 화면이 없을 때: programId 를 serviceId 로 간주해 WF 루트 시도
    if (!localRoot && waves.includes('WF')) {
      const rows = await fetchWave('WF', 'service', programId, tenantId, coCd);
      rows.forEach(row => {
        const node = addWfNode(row, 0);
        if (!localRoot) localRoot = node.key;
        const parsed = P.parseWf(row);
        linkRefs(node, parsed, ctx, 1);
        linkTables(node, parsed.tables, 1);
      });
    }

    // 2) 파도타기: UI 팝업 확장 ↔ WF 확장 ↔ 리포트 확장을 번갈아 반복
    // 깊이 제한이 없어졌으므로(전체 파도타기), 더 확장할 게 없을 때(grew=false)까지 계속 돈다.
    // 라운드 수 자체의 상한은 아주 크게(안전장치) 잡아두고, 실제 중단은 [취소] 버튼(cancelToken)으로 한다.
    let rounds = 0;
    while (rounds < 100000) {
      if (ctx.cancelToken.cancelled) break;
      rounds++;
      if (waves.includes('WF')) await expandWaves(ctx);
      if (ctx.cancelToken.cancelled) break;
      let grew = await expandUiPopups(ctx);
      if (ctx.cancelToken.cancelled) break;
      if (waves.includes('Rp')) grew = (await expandReports(ctx)) || grew;
      if (!grew) break;   // 더 확장할 팝업 UI/리포트 가 없으면 종료
    }
    if (!ctx.cancelToken.cancelled) {
      if (waves.includes('WF')) await expandWaves(ctx);  // 마지막 UI 가 부른 WF 마무리
      if (waves.includes('Rp')) await expandReports(ctx);
    }

    return localRoot;
  }

  // 참조 refs 를 WF 노드로 연결(이번 depth 에서 노드만 생성, 확장은 큐)
  // triggers: UI 이벤트 트리거 목록. serviceId/serviceUid 로 매칭해 엣지에 "버튼→이벤트" 라벨을 붙인다.
  function linkRefs(fromNode, parsed, ctx, depth) {
    const triggers = parsed.triggers || [];
    (parsed.refs || []).forEach(ref => {
      if (ref.uid == null && ref.id == null) return;
      const wfKey = store.nodeKey('WF', ref.id, ref.uid);
      const wfNode = store.addNode({ type: 'WF', id: ref.id, uid: ref.uid, name: ref.id, depth });
      store.addEdge(fromNode.key, wfNode.key, 'calls');
      // 이 WF 를 실행하는 트리거(버튼/이벤트) 찾기
      const trig = triggers.find(t => t.event === 'BTN_WORKFLOW' &&
        ((t.serviceUid && ref.uid && String(t.serviceUid) === String(ref.uid)) ||
         (t.serviceId && ref.id && t.serviceId === ref.id)));
      const edge = store.edges.get(fromNode.key + '->' + wfNode.key);
      if (edge && trig) { edge.trigger = { label: trig.label, event: trig.event, serviceName: trig.serviceName }; }
      // 조회 Depth 설정을 넘어서면 큐에 넣지 않고(=영영 조회 안 됨) 별도 표시만 해둔다.
      // 큐에는 넣되 나중에 skip 하면 "조회했는데 없음(_missing)"과 구분이 안 되어
      // 사용자가 "WF 가 비어있다"를 DB 문제로 오해하게 된다.
      if (depth > ctx.maxDepth) { wfNode._depthLimited = true; }
      else if (!wfNode._queuedDepth || depth < wfNode._queuedDepth) wfNode._queuedDepth = depth;
    });
    // UI 노드에 트리거 전체를 저장(정방향 표시용)
    if (triggers.length) fromNode.triggers = triggers;

    // UI → 다른 UI/리포트 (팝업 / jump) 연결 → 함께 파도타기 큐에 등록
    triggers.forEach(t => {
      if (t.event !== 'BTN_OPEN_POPUP' || !t.programId) return;
      if (t.programId === fromNode.id) return; // 자기 자신 제외
      // 팝업 대상이 리포트 명명규칙이면 Rp 노드로 연결(리포트 파도타기)
      if (P.looksLikeReportId(t.programId)) {
        if (ctx.waves.includes('Rp')) {
          const rpNode = store.addNode({ type: 'Rp', id: t.programId, name: t.programId, depth });
          store.addEdge(fromNode.key, rpNode.key, 'opens');
          const e = store.edges.get(fromNode.key + '->' + rpNode.key);
          if (e) e.trigger = { label: t.label, event: 'BTN_OPEN_POPUP' };
          if (depth > ctx.maxDepth) { rpNode._depthLimited = true; }
          else if (!rpNode._expanded && (!rpNode._queuedRpDepth || depth < rpNode._queuedRpDepth))
            rpNode._queuedRpDepth = depth;
        }
        return;
      }
      const uiNode = store.addNode({ type: 'UI', id: t.programId, name: t.programId, depth });
      const eKey = fromNode.key + '->' + uiNode.key;
      store.addEdge(fromNode.key, uiNode.key, 'opens');
      const e = store.edges.get(eKey);
      if (e) e.trigger = { label: t.label, event: 'BTN_OPEN_POPUP' };
      if (depth > ctx.maxDepth) { uiNode._depthLimited = true; }
      else if (!uiNode._expanded && (!uiNode._queuedUiDepth || depth < uiNode._queuedUiDepth))
        uiNode._queuedUiDepth = depth;
    });

    // 리소스 안의 명시적 리포트 참조(reportProgramId 등) → Rp 노드로 연결
    if (ctx.waves.includes('Rp')) linkReports(fromNode, parsed.reports, depth, ctx);
  }

  // 리포트 참조를 Rp 노드로 연결(확장 큐 등록)
  function linkReports(fromNode, reports, depth, ctx) {
    (reports || []).forEach(rp => {
      if (!rp.id && !rp.uid) return;
      const rpNode = store.addNode({ type: 'Rp', id: rp.id || rp.uid, name: rp.id || rp.uid, depth });
      store.addEdge(fromNode.key, rpNode.key, 'opens');
      const e = store.edges.get(fromNode.key + '->' + rpNode.key);
      if (e) e.trigger = { label: '리포트', event: 'OPEN_REPORT' };
      if (depth > ctx.maxDepth) { rpNode._depthLimited = true; }
      else if (!rpNode._expanded && (!rpNode._queuedRpDepth || depth < rpNode._queuedRpDepth))
        rpNode._queuedRpDepth = depth;
    });
  }

  function linkTables(fromNode, tables, depth) {
    (tables || []).forEach(t => {
      const tNode = store.addNode({ type: 'TABLE', id: t, name: t, depth });
      store.addEdge(fromNode.key, tNode.key, 'reads');
    });
  }

  function addWfNode(row, depth) {
    return store.addNode({
      type: 'WF', id: row.SERVICE_ID, uid: row.SERVICE_UID != null ? String(row.SERVICE_UID) : null,
      name: row.SERVICE_NAME || row.SERVICE_ID, depth, raw: row
    });
  }

  // WF 노드들을 확장 (파도타기 + 순환감지)
  // 주의: expandWaves() 는 expandOneProgram() 의 라운드로빈 루프(WF↔UI↔Rp)에서 여러 번 반복
  // 호출된다. UI/리포트 확장이 나중 라운드에서 "더 깊은" depth 의 새 WF 참조를 발견할 수 있으므로,
  // 절대 "depth=1 부터 순서대로, 중간에 빈 depth 를 만나면 끝"이라고 가정하면 안 된다 — 예전 코드는
  // 그렇게 가정해서, depth=1 프론티어가 이미 텅 비어 있으면(즉, 처음 호출에서 이미 다 처리해서)
  // depth=2 이후에 새로 큐잉된 노드가 있어도 전혀 확인하지 않고 곧장 종료해버리는 버그가 있었다.
  // (그 결과 "참조는 있지만 확장을 시도한 적 없음" 상태로 영구히 남아, 실제로는 WF Wave 를
  // 체크하고 실행했는데도 비어 있는 것처럼 보였다.) 이제는 depth 번호에 상관없이 큐잉된 모든
  // WF 노드를 매번 다시 훑어서, 더 이상 새로 큐잉되는 게 없을 때까지 반복한다.
  // uid 없이 SERVICE_ID 문자열만으로 참조된 WF가, 이미 uid로 등록돼 있는 WF와 같은 것인지
  // 찾아준다(유령 노드 방지용 — expandWaves() 순환감지에서 사용).
  function findWfNodeById(id) {
    for (const n of store.nodes.values()) {
      if (n.type === 'WF' && n.id === id) return n;
    }
    return null;
  }

  async function expandWaves(ctx) {
    let frontier = collectPendingWf();
    while (frontier.length) {
      if (ctx.cancelToken && ctx.cancelToken.cancelled) break;
      // 이번 배치의 uid 들을 배치 조회
      const uids = frontier.map(n => n.uid).filter(Boolean);
      let rows = [];
      if (uids.length) rows = await fetchWfByUids(uids, ctx.tenantId, ctx.coCd);
      // id만 있는 경우 개별 조회
      const idOnly = frontier.filter(n => !n.uid && n.id);
      for (const n of idOnly) {
        const r = await fetchWave('WF', 'service', n.id, ctx.tenantId, ctx.coCd);
        rows = rows.concat(r);
      }
      const byUid = {}; const byId = {};
      rows.forEach(r => { if (r.SERVICE_UID != null) byUid[String(r.SERVICE_UID)] = r; if (r.SERVICE_ID) byId[r.SERVICE_ID] = r; });

      frontier.forEach(n => {
        const row = (n.uid && byUid[n.uid]) || (n.id && byId[n.id]);
        const nextDepth = (n.depth || 0) + 1;
        n._expanded = true;
        if (!row) { n._missing = true; return; }
        // 노드 보강
        const node = store.addNode({ type: 'WF', id: row.SERVICE_ID, uid: String(row.SERVICE_UID),
                                     name: row.SERVICE_NAME || row.SERVICE_ID, depth: n.depth, raw: row });
        // 순환감지: 이미 방문한 uid 를 다시 참조하면 cycle 표시
        const parsed = P.parseWf(row);
        parsed.refs.forEach(ref => {
          // uid 없이 SERVICE_ID 문자열로만 자기 자신(또는 이미 알고 있는 다른 WF)을 참조하는
          // 경우가 있다(2026-08-19 확인 — PPBAMUI0014_SELECT/_SAVE가 내부 스텝에서 자기 자신을
          // uid 없이 참조). 이때 store.nodeKey('WF', id, null) 은 'WF:s<id>' 라는 별도 key를
          // 만들어버려서, 이미 'WF:u<uid>'로 등록된 진짜 노드와 다른 "유령 노드"가 하나 더
          // 생기고, 이미 있는 자기순환(cycle) 표시와 별개로 엉뚱한 화살표가 하나 더 그려지는
          // 버그가 있었다. uid가 없으면 먼저 SERVICE_ID로 이미 등록된 WF 노드가 있는지 찾아서
          // 그 노드로 합친다.
          let childKey = store.nodeKey('WF', ref.id, ref.uid);
          let existing = store.nodes.get(childKey);
          if (!existing && !ref.uid) {
            const byId = findWfNodeById(ref.id);
            if (byId) { childKey = byId.key; existing = byId; }
          }
          const isCycle = existing && existing._expanded && childKey !== node.key;
          const child = store.addNode({ key: childKey, type: 'WF', id: ref.id,
                                        uid: (existing && existing.uid != null) ? existing.uid : ref.uid,
                                        name: ref.id, depth: nextDepth });
          if (childKey === node.key || isCycle) {
            child.cycle = true;
            const eKey = node.key + '->' + child.key;
            store.addEdge(node.key, child.key, 'cycle');
            const e = store.edges.get(eKey); if (e) e.cycle = true;
          } else {
            store.addEdge(node.key, child.key, 'calls');
            if (nextDepth > ctx.maxDepth) { child._depthLimited = true; }
            else if (!child._expanded) child._queuedDepth = nextDepth;
          }
        });
        linkTables(node, parsed.tables, n.depth);
        // WF 리소스가 리포트를 참조하면 Rp 노드로 연결
        if (ctx.waves.includes('Rp')) linkReports(node, parsed.reports, nextDepth, ctx);
      });

      frontier = collectPendingWf();
    }
  }

  // depth 번호와 무관하게, 아직 확장하지 않은(= _expanded 되지 않은) 큐잉된 WF 노드를 전부 모은다.
  function collectPendingWf() {
    const out = [];
    store.nodes.forEach(n => {
      if (n.type === 'WF' && !n._expanded && n._queuedDepth != null) out.push(n);
    });
    return out;
  }

  // 팝업/jump 로 열리는 UI 들을 확장(각 UI 의 리소스를 조회해 refs/triggers/tables 연결).
  // 반환: 새로 확장한 UI 노드 수 (0 이면 더 확장할 것이 없음)
  async function expandUiPopups(ctx) {
    const pending = [];
    store.nodes.forEach(n => {
      if ((n.type === 'UI' || n.type === 'Mo') && !n._expanded && n._queuedUiDepth != null) pending.push(n);
    });
    if (!pending.length) return 0;
    for (const n of pending) {
      if (ctx.cancelToken && ctx.cancelToken.cancelled) break;
      n._expanded = true;
      if (n._queuedUiDepth > ctx.maxDepth) { n._depthLimited = true; continue; }
      // 메뉴명 조회: 좌측 메뉴검색과 동일한 방식으로 이 프로그램ID 의 메뉴명을 찾는다.
      // (리소스가 없더라도 메뉴에 등록된 프로그램이면 메뉴명을 노드에 붙인다)
      const menuNm = await lookupMenuName(n.id, ctx);
      if (menuNm) {
        n.menuNm = menuNm;
        if (!n.name || n.name === n.id) n.name = menuNm;
      }
      let rows = [];
      // 팝업/jump 로 "이미 참조를 발견한" 화면이므로, 공용 팝업이 다른 CO_CD 로 등록돼 있어도
      // 파도타기가 끊기지 않도록 CO_CD 제한 없이(relaxed) 조회한다.
      try { rows = await fetchWave(n.type, 'program', n.id, ctx.tenantId, ctx.coCd, true); }
      catch (e) { n._missing = true; continue; }
      if (!rows.length) { n._missing = true; continue; }
      const row = rows[0];
      const idCol = 'PROGRAM_ID';
      const displayName = menuNm || row.PROGRAM_NM || n.name || n.id;
      const node = store.addNode({ type: n.type, id: row[idCol] || n.id, name: displayName,
                                   module: row.MODULE_CD, depth: n.depth, raw: row });
      if (menuNm) node.menuNm = menuNm;
      const parsed = P.parseUi(row);
      // 팝업 UI 가 부르는 WF/UI 를 다음 depth 로 연결
      linkRefs(node, parsed, ctx, (n._queuedUiDepth || 1) + 1);
      if (parsed.tables) linkTables(node, parsed.tables, (n._queuedUiDepth || 1) + 1);
    }
    return pending.length;
  }

  // 리포트(Rp) 노드 확장: z_rp_deploy_info 를 REPORT_PROGRAM_ID 로 조회해 보강하고,
  // 리포트가 다시 부르는 WF/리포트를 연결한다. 반환: 새로 확장한 리포트 수.
  async function expandReports(ctx) {
    const pending = [];
    store.nodes.forEach(n => {
      if (n.type === 'Rp' && !n._expanded && n._queuedRpDepth != null) pending.push(n);
    });
    if (!pending.length) return 0;
    for (const n of pending) {
      if (ctx.cancelToken && ctx.cancelToken.cancelled) break;
      n._expanded = true;
      if (n._queuedRpDepth > ctx.maxDepth) { n._depthLimited = true; continue; }
      let rows = [];
      // 리포트도 팝업 UI 와 동일한 이유(공용 리포트가 다른 CO_CD 로 등록된 경우)로 relaxed 조회.
      try { rows = await fetchWave('Rp', 'program', n.id, ctx.tenantId, ctx.coCd, true); }
      catch (e) { n._missing = true; continue; }
      if (!rows.length) { n._missing = true; continue; }
      const row = rows[0];
      const node = store.addNode({ type: 'Rp', id: row.REPORT_PROGRAM_ID || n.id,
        name: row.REPORT_PROGRAM_NM || n.name || n.id, module: row.MODULE_CD, depth: n.depth, raw: row });
      const parsed = P.parseRp(row);
      // 리포트가 부르는 WF
      linkRefs(node, parsed, ctx, (n._queuedRpDepth || 1) + 1);
      if (parsed.tables) linkTables(node, parsed.tables, (n._queuedRpDepth || 1) + 1);
    }
    return pending.length;
  }

  // 프로그램ID → 메뉴명 조회 (좌측 메뉴검색과 동일 소스). 결과 캐시.
  const _menuNameCache = {};
  async function lookupMenuName(programId, ctx) {
    if (!programId) return null;
    if (programId in _menuNameCache) return _menuNameCache[programId];
    let nm = null;
    try {
      // 이미 검색된 목록에서 먼저 찾기(무료)
      const hit = (lastMenuRows || []).find(r => (r.CALLED_PGM_ID || '') === programId);
      if (hit && hit.LEAF_MNU_NM) nm = hit.LEAF_MNU_NM;
      else {
        // 소스별 메뉴 조회
        let rows = [];
        if (offlineActive && WaveOffline.isOnline()) {
          const r = await window.api.offlineQueryMenu({
            filePath: WaveOffline.folder(), mnuId: programId, mnuNm: '', productCd: el('productCd').value,
            tenantId: (ctx && ctx.tenantId) || '*', coCd: (ctx && ctx.coCd) || '*'
          });
          if (r.ok) rows = r.rows;
        } else if (demoMode) {
          rows = (window.DEMO_DATA.menu || []).filter(r => (r.CALLED_PGM_ID || '') === programId);
        } else if (cfg && cfg.database) {
          const r = await window.api.searchMenu({
            cfg, tenantId: ctx.tenantId || '*', coCd: ctx.coCd || '*',
            productCd: el('productCd').value, lang: el('langSel').value, mnuId: programId, mnuNm: '', mode: 'direct'
          });
          if (r.ok) rows = r.rows;
        }
        const exact = rows.find(r => (r.CALLED_PGM_ID || '') === programId) || rows[0];
        if (exact && exact.LEAF_MNU_NM) nm = exact.LEAF_MNU_NM;
      }
    } catch (e) { /* 조회 실패 시 메뉴명 없음 */ }
    _menuNameCache[programId] = nm;
    return nm;
  }

  /* ---------- 데이터 소스 추상화 (오프라인 / DB / 데모) ---------- */
  async function fetchWave(wave, keyType, keyValue, tenantId, coCd, relaxed) {
    if (offlineActive && WaveOffline.isOnline()) {
      const r = await window.api.offlineQueryWave({ filePath: WaveOffline.folder(), wave, keyType, keyValue, tenantId, coCd, relaxed });
      if (!r.ok) throw new Error(r.error);
      return r.rows;
    }
    if (demoMode) return demoFetchWave(wave, keyType, keyValue);
    const r = await window.api.fetchWave({ cfg, wave, tenantId, coCd, keyType, keyValue, relaxed });
    if (!r.ok) throw new Error(r.error);
    return r.rows;
  }
  async function fetchWfByUids(uids, tenantId, coCd) {
    if (offlineActive && WaveOffline.isOnline()) {
      const r = await window.api.offlineQueryWfByUids({ filePath: WaveOffline.folder(), uids, tenantId });
      if (!r.ok) throw new Error(r.error);
      return r.rows;
    }
    if (demoMode) return demoFetchWfByUids(uids);
    const r = await window.api.fetchWfByUids({ cfg, tenantId, coCd, uids });
    if (!r.ok) throw new Error(r.error);
    return r.rows;
  }

  function demoFetchWave(wave, keyType, keyValue) {
    const d = window.DEMO_DATA;
    if (wave === 'UI') return (d.ui && d.ui.PROGRAM_ID === keyValue) ? [d.ui] : (d.ui ? [d.ui] : []);
    if (wave === 'WF') {
      if (keyType === 'service') return (d.wf || []).filter(w => w.SERVICE_ID === keyValue);
      return (d.wf || []).filter(w => String(w.SERVICE_UID) === String(keyValue));
    }
    return []; // 데모엔 Rp/Mo 없음
  }
  function demoFetchWfByUids(uids) {
    const set = new Set(uids.map(String));
    return (window.DEMO_DATA.wf || []).filter(w => set.has(String(w.SERVICE_UID)));
  }

  /* ---------- 테이블 탭 ---------- */
  // 구분 정렬 우선순위: UI → WF → Rp → Mo → TABLE
  const TYPE_ORDER = { UI: 0, WF: 1, Rp: 2, Mo: 3, TABLE: 4 };

  function renderTable() {
    const tb = el('resultBody');
    tb.innerHTML = '';
    const rows = store.allKeys().map(k => store.nodes.get(k))
      .sort((a, b) => {
        const ta = TYPE_ORDER[a.type] != null ? TYPE_ORDER[a.type] : 9;
        const tb2 = TYPE_ORDER[b.type] != null ? TYPE_ORDER[b.type] : 9;
        if (ta !== tb2) return ta - tb2;                       // 1) 구분 순서
        const ia = (a.id || a.uid || '').toString();
        const ib = (b.id || b.uid || '').toString();
        return ia.localeCompare(ib);                           // 2) 동일 구분이면 ID
      });
    rows.forEach(n => {
      const tr = document.createElement('tr');
      const checked = store.basket.has(n.key) ? 'checked' : '';
      tr.innerHTML =
        '<td><input type="checkbox" data-k="' + esc(n.key) + '" ' + checked + '></td>' +
        '<td><span class="badge b-' + n.type + '">' + n.type + '</span></td>' +
        '<td>' + esc(n.id || n.uid || '') + '</td>' +
        '<td>' + esc(n.name || '') + '</td>' +
        '<td>' + (n.uid || '') + '</td>' +
        '<td>' + (n.depth != null ? n.depth : '') + '</td>' +
        (n.cycle ? '<td class="cyc">순환</td>' : '<td></td>');
      tr.querySelector('input').addEventListener('change', (e) => {
        store.toggleBasket(n.key, e.target.checked); refreshBasket(); G.markBasket(store.basket);
      });
      tr.addEventListener('click', (e) => { if (e.target.tagName !== 'INPUT') showDetail(n.key); });
      // 더블클릭 → 그래프 탭으로 이동 후 해당 노드 선택·포커스
      tr.addEventListener('dblclick', (e) => {
        if (e.target.tagName === 'INPUT') return;
        gotoNodeInGraph(n.key);
      });
      tr._nodeKey = n.key;   // 검색 하이라이트용
      tb.appendChild(tr);
    });
    applyGraphSearch();   // 표를 다시 그리면 현재 검색어를 재적용
  }

  // 그래프/테이블 통합 검색: ID · 이름 · UID 부분일치.
  // 일치 노드를 그래프에서 강조·이동하고, 테이블에서도 강조/흐림 처리한다.
  function applyGraphSearch() {
    const inp = el('gvSearch');
    const term = (inp ? inp.value : '').trim().toLowerCase();
    const cnt = el('gvSearchCnt');
    const tb = el('resultBody');
    if (!term) {
      G.highlight(null);
      if (cnt) cnt.textContent = '';
      if (tb) [...tb.children].forEach(tr => tr.classList.remove('gv-hit', 'gv-dim'));
      return;
    }
    const match = (n) => {
      if (!n) return false;
      return String(n.id || '').toLowerCase().includes(term)
        || String(n.name || '').toLowerCase().includes(term)
        || String(n.uid || '').toLowerCase().includes(term);
    };
    // 일치 노드 key 집합
    const keys = new Set();
    store.nodes.forEach(n => { if (match(n)) keys.add(n.key); });
    // 그래프 강조
    const hits = G.highlight(keys);
    // 테이블 행 강조/흐림
    if (tb) {
      [...tb.children].forEach(tr => {
        const n = store.nodes.get(tr._nodeKey);
        if (match(n)) { tr.classList.add('gv-hit'); tr.classList.remove('gv-dim'); }
        else { tr.classList.remove('gv-hit'); tr.classList.add('gv-dim'); }
      });
    }
    if (cnt) cnt.textContent = keys.size ? (keys.size + '건') : '0건';
  }

  // 흐름도 검색: 지금 화면(현재 스코프)에 그려진 단계만 대상으로 한다(다른 스코프의 단계는
  // 지금 안 보이므로 검색 결과에 넣지 않음 — F.search() 참고).
  function applyFlowSearch() {
    const inp = el('flowSearch');
    const term = (inp ? inp.value : '').trim();
    const cnt = el('flowSearchCnt');
    const hits = F.search(term);
    if (cnt) cnt.textContent = !term ? '' : (hits ? (hits + '건') : '0건');
  }

  // 특정 노드를 그래프에서 선택하고 중앙으로 이동. 필터로 숨겨진 경우 자동으로 표시 토글.
  function gotoNodeInGraph(key) {
    const n = store.nodes.get(key);
    if (!n) {
      // 트리거는 감지했지만(예: 그리드 액션컬럼 팝업) 대상이 현재 파도타기 결과에 없는 경우
      // (프로그램ID 가 실제 화면ID 와 다른 라우팅 별칭일 수도 있음) — 조용히 무시하지 않고 안내한다.
      setStatus('연결된 노드(' + key + ')가 현재 파도타기 결과에 없습니다. 대상 프로그램ID 표기가 실제 화면ID 와 다른 별칭일 수도 있습니다.', true);
      return;
    }
    // 그래프 탭을 먼저 보이는 상태로 만든 뒤 필터/렌더를 적용해야 컨테이너 크기가 정상
    // 측정된다(숨김 탭에서 먼저 배치하면 0 크기로 그려지는 문제 방지).
    switchTab('graph');
    // 숨김 필터 때문에 노드가 그래프에 없으면 해당 필터를 켬
    if (n.type === 'TABLE' && !el('showTable').checked) {
      el('showTable').checked = true; G.setFilter({ showTable: true });
    }
    if (n.cycle && !el('showCycle').checked) {
      el('showCycle').checked = true; G.setFilter({ showCycle: true });
    }
    // 부가 UI 필터로 숨겨졌을 수 있으니, 그래프에 없으면 부가 UI 표시를 켜서 보이게 함
    if (!el('showSubUi').checked && !G.hasNode(key)) {
      el('showSubUi').checked = true; G.setFilter({ showSubUi: true });
    }
    // 상세 패널을 먼저 갱신(여기선 select 만 하고 중앙이동은 안 함)
    showDetail(key);
    // switchTab 의 fit(50ms) 이후에 중앙이동이 마지막으로 실행되도록 더 늦게 지연.
    // 필터 변경으로 재배치가 있었다면 레이아웃이 끝난 뒤 확정된 좌표로 이동한다.
    setTimeout(() => {
      if (!G.selectAndFocus(key)) setStatus('그래프에서 해당 노드를 찾지 못했습니다.', true);
    }, 140);
  }

  /* ---------- 상세 패널 ---------- */
  function onNodeTap(key) { showDetail(key); }
  // 그래프 노드 더블클릭 → 중앙으로 이동(선택 강조)
  function onNodeDblTap(key) { G.selectAndFocus(key); showDetail(key); }

  // WF 뱃지 클릭(디자인 미리보기, 모달·UI 탭 공통) → "그래프에서 그 WF 노드를 더블클릭했을 때"와
  // 완전히 동일하게 그래프에 선택+중앙확대(줌)까지 적용해 둔 뒤, 최종적으로는 흐름도 탭으로 이동해
  // 그 WF의 흐름도를 보여준다. 그래프 탭이 실제로 화면에 보이는 상태에서 좌표를 계산해야 정상적으로
  // 확대/중앙정렬되므로(숨김 탭에서는 컨테이너 크기가 0), 아주 잠깐 그래프 탭을 거쳐간다
  // (gotoNodeInGraph 의 switchTab→setTimeout 패턴과 동일한 이유).
  function focusWfAndShowFlow(navKey) {
    switchTab('graph');
    setTimeout(() => {
      G.selectAndFocus(navKey);
      showDetail(navKey);
      showFlow(navKey);
    }, 140);
  }
  // 노드 타입(UI/WF/Rp/Mo/TABLE)별 색상 — 배지, 접기 섹션 등 상세 패널 대부분의 요소는 이 색으로 통일된다.
  function typeColor(n) { return (G.TYPE_COLOR && G.TYPE_COLOR[n.type]) || '#334155'; }
  function solidBtnStyle(c) { return 'background:' + c + ';border-color:' + c + ';color:#fff;'; }
  function outlineBtnStyle(c) { return 'background:#fff;border-color:' + c + ';color:' + c + ';'; }
  // 하단 고정 액션 버튼 3종은 서로 다른 역할(이동/조회/보관)이라 색을 각각 다르게 구분한다.
  // 흐름도 보기는 노드 타입색(WF=초록 등)을 그대로 쓰고, 코드·디자인 보기는 중립 슬레이트,
  // 바구니는 담기/보관을 뜻하는 앰버 계열로 — 전체 톤은 앱의 기존 팔레트 안에서 유지한다.
  const ACTION_COLOR = { view: '#475569', basket: '#d97706' };

  // 접기/펼치기 섹션 공통 렌더러. 기본은 접힌 상태(display:none)로 시작해
  // 상세 패널을 열었을 때 핵심 정보(이름·타입 등)만 한눈에 보이도록 한다.
  let _secSeq = 0;
  function collapsible(title, count, bodyHtml) {
    _secSeq++;
    const id = 'dsec' + _secSeq;
    const label = title + (count != null ? (' <span class="muted">(' + count + ')</span>') : '');
    return '<div class="d-sec-row"><span>' + label + '</span>'
      + '<button type="button" class="btn ghost xs d-toggle" data-box="' + id + '">보기</button></div>'
      + '<div id="' + id + '" class="d-collapse" style="display:none">' + bodyHtml + '</div>';
  }

  // 상세 패널 안의 모든 접기 섹션이 열려있는지에 따라 [전체 펼치기/접기] 버튼 라벨을 맞춘다.
  function syncToggleAllLabel() {
    const boxes = [...document.querySelectorAll('#detail .d-collapse')];
    const btn = el('dToggleAll');
    if (!boxes.length) { btn.textContent = '전체 펼치기'; return; }
    const allOpen = boxes.every(b => b.style.display !== 'none');
    btn.textContent = allOpen ? '전체 접기' : '전체 펼치기';
  }

  function copyToClipboard(text, btn) {
    navigator.clipboard.writeText(text).then(() => {
      const old = btn.textContent; btn.textContent = '복사됨!';
      setTimeout(() => { btn.textContent = old; }, 1200);
    });
  }

  function showDetail(key) {
    const n = store.nodes.get(key) || _syntheticNodeCache.get(key);
    const box = el('detail');
    const actions = el('detailActions');
    _secSeq = 0;
    if (!n) {
      box.innerHTML = '<div class="muted">노드를 선택하세요.</div>';
      actions.innerHTML = '';
      el('dToggleAll').textContent = '전체 펼치기';
      return;
    }
    const tc = typeColor(n);
    // 한눈에 보이는 핵심 정보(항상 표시): 타입/ID/이름/모듈/DEPTH.
    // 그 외 상세 정보는 아래에서 전부 접기 섹션으로 구성된다.
    let html = '<div class="d-head"><span class="badge b-' + n.type + '">' + n.type + '</span> '
      + '<b>' + esc(n.id || n.uid) + '</b></div>';
    html += kv('이름', n.name);
    if (n.menuNm) html += kv('메뉴명', n.menuNm);
    if (n.uid) html += kv('SERVICE_UID', n.uid);
    if (n.module) html += kv('모듈', n.module);
    html += kv('DEPTH', n.depth);
    if (n.cycle) html += '<div class="warn">⚠ 순환참조 노드</div>';
    if (n._depthLimited) {
      html += '<div class="warn">⚠ 이 ' + esc(n.type) + '는 코드/UI에서 참조(호출)는 되지만, '
        + '현재 검색 시 지정한 조회 Depth(단계 수)를 벗어나 있어 아직 조회하지 않았습니다.'
        + '<br>(SERVICE_ID/PROGRAM_ID: ' + esc(n.id || '-') + (n.uid ? (', SERVICE_UID: ' + esc(n.uid)) : '')
        + ') 검색 화면에서 Depth 값을 늘려 다시 조회하면 내용을 볼 수 있습니다.</div>';
    } else if (n._missing) {
      html += '<div class="warn">⚠ 이 ' + esc(n.type) + '는 코드/UI에서 참조(호출)는 되지만, '
        + '현재 조회한 TENANT_ID/CO_CD 범위의 DB에서는 실제 데이터를 찾지 못했습니다.'
        + '<br>(SERVICE_ID/PROGRAM_ID: ' + esc(n.id || '-') + (n.uid ? (', SERVICE_UID: ' + esc(n.uid)) : '')
        + ') 다른 테넌트에 등록돼 있거나, 삭제/미배포된 서비스일 수 있습니다.</div>';
    } else if (n.type === 'WF' && !n.raw && !n._expanded) {
      // WF 는 UI/Rp 참조(트리거)에서 발견되는 즉시 노드가 만들어지지만, 실제 DB 조회는
      // expandWaves() 안에서만 이뤄지고 이 함수는 검색 시 "WF" Wave 체크박스가 켜져 있을 때만
      // 실행된다. 체크가 안 돼 있으면 이 노드는 영원히 조회 시도조차 안 된 채로 남는데,
      // _missing/_depthLimited 도 안 붙어 그냥 텅 빈 상세만 보여 혼란스러웠다 — 원인을 명시한다.
      html += '<div class="warn">⚠ 이 WF는 코드/UI에서 참조(호출)는 되지만, 아직 조회를 시도하지 않았습니다.'
        + '<br>(SERVICE_ID/PROGRAM_ID: ' + esc(n.id || '-') + (n.uid ? (', SERVICE_UID: ' + esc(n.uid)) : '')
        + ') 검색 화면의 Wave 선택에서 <b>WF</b> 를 체크하고 다시 실행하면 내용을 볼 수 있습니다.</div>';
    }

    // 원본 테이블의 지정 컬럼 표시 (접기): 컬럼이 원본 행에 존재하면 표시(값이 없으면 빈값).
    if (n.raw) {
      const wantCols = [
        'PROGRAM_NM', 'SERVICE_NAME', 'REPORT_PROGRAM_NM', 'REPORT_PROGRAM_DESC',
        'REPORT_FILE_NM', 'REPORT_FILE_DESC', 'DESCRIPTION',
        'DEPLOY_DT', 'DEPLOYER', 'USE_YN', 'PATCH_VERSION'
      ];
      const upMap = {};
      for (const k in n.raw) upMap[k.toUpperCase()] = k;
      const rows = [];
      wantCols.forEach(col => {
        if (Object.prototype.hasOwnProperty.call(upMap, col)) {
          const realKey = upMap[col];
          const v = n.raw[realKey];
          rows.push(kv(col, v != null ? v : ''));
        }
      });
      if (rows.length) html += collapsible('테이블 컬럼', rows.length, rows.join(''));
    }

    // WF: 참조 테이블 / 하위 서비스 (각각 접기)
    if (n.type === 'WF' && n.raw) {
      const parsed = P.parseWf(n.raw);
      if (parsed.tables.length) {
        html += collapsible('참조 테이블', parsed.tables.length,
          '<div class="chips">' + parsed.tables.map(t => '<span class="chip">' + esc(t) + '</span>').join('') + '</div>');
      }
      html += collapsible('하위 서비스', parsed.refs.length,
        '<div class="chips">'
        + (parsed.refs.length ? parsed.refs.map(r => '<span class="chip s">' + esc(r.id || r.uid) + '</span>').join('') : '<span class="muted">없음</span>')
        + '</div>');
    }

    // 이벤트 트리거 표시 (접기)
    // UI/Mo 노드: 이 화면의 버튼/이벤트가 무엇을 실행하는지(정방향)
    if ((n.type === 'UI' || n.type === 'Mo')) {
      let triggers = n.triggers;
      if ((!triggers || !triggers.length) && n.raw) triggers = P.parseUi(n.raw).triggers;
      // UI/WF/Rp/Mo/Table 등 실제 대상과 엮인 이벤트만 남김
      // (BTN_WORKFLOW=WF 실행, BTN_OPEN_POPUP=UI 화면 호출). 대상 없는 순수 스크립트(예: Cancel)는 제외.
      const linked = (triggers || []).filter(t =>
        (t.event === 'BTN_WORKFLOW' && (t.serviceId || t.serviceUid)) ||
        (t.event === 'BTN_OPEN_POPUP' && t.programId));
      if (linked.length) {
        let body = '<div class="trig-list">';
        linked.forEach(t => {
          const btn = t.label ? ('<b>' + esc(t.label) + '</b>') : '<span class="muted">(이름없음)</span>';
          if (t.event === 'BTN_WORKFLOW') {
            const tk = store.nodeKey('WF', t.serviceId, t.serviceUid);
            body += '<div class="trig nav" data-nav="' + esc(tk) + '" title="더블클릭: 그래프에서 이동">'
              + '<span class="ev ev-wf">WF실행</span> ' + btn
              + ' <span class="arw">→</span> ' + esc(t.serviceId || ('uid=' + t.serviceUid))
              + (t.serviceName ? ' <span class="muted">(' + esc(t.serviceName) + ')</span>' : '') + '</div>';
          } else {
            const tk = store.nodeKey('UI', t.programId, null);
            body += '<div class="trig nav" data-nav="' + esc(tk) + '" title="더블클릭: 그래프에서 이동">'
              + '<span class="ev ev-pop">UI호출</span> ' + btn
              + ' <span class="arw">→</span> ' + esc(t.programId) + ' 화면</div>';
          }
        });
        body += '</div>';
        html += collapsible('화면 이벤트', linked.length, body);
      }
    }
    // WF 노드: 어떤 화면의 어떤 버튼이 이 WF 를 실행하는지(역방향) — 엣지의 trigger 정보 활용
    if (n.type === 'WF') {
      const callers = [];
      store.edges.forEach(e => {
        if (e.to === key && e.trigger) {
          const from = store.nodes.get(e.from);
          callers.push({ from, trig: e.trigger });
        }
      });
      if (callers.length) {
        let body = '<div class="trig-list">';
        callers.forEach(c => {
          const screen = c.from ? (c.from.id || c.from.name || c.from.key) : '';
          const btn = c.trig.label ? ('<b>' + esc(c.trig.label) + '</b>') : '<span class="muted">(이름없음)</span>';
          const tk = c.from ? c.from.key : '';
          body += '<div class="trig nav" data-nav="' + esc(tk) + '" title="더블클릭: 호출 화면으로 이동">'
            + '<span class="ev ev-wf">' + esc(screen) + '</span> '
            + btn + ' <span class="arw">→</span> 이 WF 실행</div>';
        });
        body += '</div>';
        html += collapsible('실행 트리거', callers.length, body);
      }
    }

    // 공통코드(MAJOR_CD / MINOR_CD) 표시 (접기)
    if (n.raw && (n.type === 'UI' || n.type === 'Mo' || n.type === 'WF' || n.type === 'Rp')) {
      let codes = { major: [], minor: [] };
      if (n.type === 'WF') codes = P.parseWf(n.raw).codes;
      else if (n.type === 'Rp') codes = P.parseRp(n.raw).codes;
      else codes = P.parseUi(n.raw).codes;
      const codeCount = (codes.major ? codes.major.length : 0) + (codes.minor ? codes.minor.length : 0);
      if (codeCount) {
        let body = '';
        if (codes.major.length)
          body += '<div class="code-row"><span class="code-lbl">MAJOR_CD</span><div class="chips">'
            + codes.major.map(c => '<span class="chip c-maj">' + esc(c) + '</span>').join('') + '</div></div>';
        if (codes.minor.length)
          body += '<div class="code-row"><span class="code-lbl">MINOR_CD</span><div class="chips">'
            + codes.minor.map(c => '<span class="chip c-min">' + esc(c) + '</span>').join('') + '</div></div>';
        html += collapsible('공통코드', codeCount, body);
      }
    }

    // SQL 쿼리 (WF/UI/Rp 공통, 접기) — 복사해서 SSMS/DBeaver 에 붙여 실행 가능
    // WF 는 흐름도가 있으므로 각 쿼리 옆에 [이동] 버튼을 추가해 흐름도의 해당 단계로 바로 갈 수 있게 한다.
    const hasFlow = n.type === 'WF' && n.raw && !!n.raw.RESOURCE_WF;
    let queries = [];
    let sqlBody = '';
    let sqlCount = 0;
    // WF 는 노드(스텝)별로 DB별 쿼리(ANSI/MSSQL/MySQL/Oracle …)를 나눠 담으므로,
    // 흐름도와 동일하게 노드 단위 DB 탭으로 보여준다(공통 query 만 읽던 기존 평면 목록의 누락 해소).
    if (hasFlow) {
      try {
        const wfObj = JSON.parse(n.raw.RESOURCE_WF);
        const procs = (wfObj.service && wfObj.service.child && wfObj.service.child.process) || [];
        const steps = procs.filter(p => sqlVariantsOf(p.propertyValue || {}).some(v => v.has));
        sqlCount = steps.length;
        steps.forEach(p => {
          const pv = p.propertyValue || {};
          const nm = pv.processNm || p.processType || p.compId || '';
          const goto = ' <button type="button" class="btn ghost xs sqlvar-goto" data-comp="' + esc(p.compId) + '">🔀 이동</button>';
          sqlBody += '<div class="sql-item"><div class="sqlvar-node">📍 ' + esc(nm) + '</div>'
            + renderSqlVariants(pv, goto) + '</div>';
        });
      } catch (e) { sqlCount = 0; sqlBody = ''; }
    }
    if (sqlCount === 0) {
      // 비WF(UI/Rp/Mo) 또는 WF 파싱 실패 시: 기존 평면 추출 목록
      if (n.raw) {
        if (n.type === 'WF') queries = P.parseWf(n.raw).queries;
        else if (n.type === 'Rp') queries = P.parseRp(n.raw).queries;
        else if (n.type === 'UI' || n.type === 'Mo') queries = P.parseUi(n.raw).queries;
      }
      if (queries && queries.length) {
        sqlCount = queries.length;
        queries.forEach((q, i) => {
          sqlBody += '<div class="sql-item">'
            + '<div class="sql-head">쿼리 ' + (i + 1)
            + ' <button class="btn ghost xs sql-copy" data-i="' + i + '">복사</button>'
            + (hasFlow ? ' <button class="btn ghost xs sql-goto" data-i="' + i + '">🔀 이동</button>' : '')
            + '</div>'
            + '<pre class="sql-code">' + esc(q) + '</pre></div>';
        });
      }
    }
    if (sqlCount > 0) {
      html += collapsible('SQL 쿼리', sqlCount, sqlBody);
    }

    box.innerHTML = html;

    // 접기 섹션 토글(공통 바인딩)
    box.querySelectorAll('.d-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const bx = document.getElementById(btn.getAttribute('data-box'));
        if (!bx) return;
        const show = bx.style.display === 'none';
        bx.style.display = show ? 'block' : 'none';
        btn.textContent = show ? '숨기기' : '보기';
        syncToggleAllLabel();
      });
    });
    // SQL 복사
    box.querySelectorAll('.sql-copy').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = +btn.getAttribute('data-i');
        if (queries[i] != null) copyToClipboard(queries[i], btn);
      });
    });
    // SQL 이동 → 흐름도 탭에서 해당 쿼리를 가진 단계로 이동·선택·줌
    box.querySelectorAll('.sql-goto').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = +btn.getAttribute('data-i');
        if (queries[i] != null) gotoQueryInFlow(key, queries[i]);
      });
    });
    // DB별 SQL 탭(노드 단위) — 탭 전환/복사 공통 바인딩
    bindSqlVariants(box);
    // 노드 SQL 옆 [이동] → 흐름도의 그 스텝(compId)으로 바로 이동
    box.querySelectorAll('.sqlvar-goto').forEach(btn => {
      btn.addEventListener('click', () => {
        const compId = btn.getAttribute('data-comp');
        if (compId) gotoStepInFlow(key, compId);
      });
    });
    // 화면 이벤트 / 실행 트리거 항목 더블클릭 → 그래프에서 대상 노드로 이동
    box.querySelectorAll('.trig.nav').forEach(item => {
      item.addEventListener('dblclick', () => {
        const navKey = item.getAttribute('data-nav');
        if (navKey) gotoNodeInGraph(navKey);
      });
    });
    syncToggleAllLabel();

    // ---- 하단 고정 액션 버튼(스크롤과 무관하게 항상 보임). 버튼마다 역할이 달라 색을 구분한다. ----
    const inB = store.basket.has(key);
    const hasRes = n.raw && (n.raw.RESOURCE_HTML || n.raw.RESOURCE_JSON || n.raw.RESOURCE_JS ||
      n.raw.RESOURCE_WF || n.raw.REPORT_JSON || n.raw.RESOURCE_DTO);
    let abtns = '';
    if (hasFlow) abtns += '<button id="dFlow" class="btn" style="' + solidBtnStyle(tc) + '">🔀 흐름도 보기</button>';
    if (hasRes) abtns += '<button id="dView" class="btn" style="' + outlineBtnStyle(ACTION_COLOR.view) + '">🖥 코드 · 디자인 보기</button>';
    abtns += '<button id="dAdd" class="btn" style="' + (inB ? outlineBtnStyle(ACTION_COLOR.basket) : solidBtnStyle(ACTION_COLOR.basket)) + '">'
      + (inB ? '바구니에서 빼기' : '＋ 바구니에 담기') + '</button>';
    actions.innerHTML = abtns;
    if (hasFlow) el('dFlow').addEventListener('click', () => showFlow(key));
    if (hasRes) el('dView').addEventListener('click', () => openViewer(n));
    el('dAdd').addEventListener('click', () => {
      store.toggleBasket(key); refreshBasket(); G.markBasket(store.basket); showDetail(key); renderTable();
    });

    // 상세 패널 표시는 그래프에서 선택 강조만(중앙 이동 X) — 이동은 gotoNodeInGraph 가 전담.
    // (중앙 이동을 여기서 또 하면 테이블 더블클릭 이동과 충돌해 엉뚱한 위치로 튐)
    G.select(key);
  }
  function kv(k, v) { return '<div class="kv"><span>' + esc(k) + '</span><b>' + esc(v != null ? v : '') + '</b></div>'; }

  /* ---------- 코드 · 디자인 뷰어 ---------- */
  let _viewerRes = [];   // [{key, label, type:'html'|'json'|'js'|'wf', text}]
  let _viewerRaw = null; // 현재 뷰어 노드의 원본 raw (디자인 JSON 재구성용)
  let _viewerNodeType = null; // 현재 뷰어 노드의 타입(UI/WF/Mo/Rp) — 디자인 렌더 분기에 사용
  let _viewerKey = null; // 현재 뷰어에 열려 있는 노드의 navKey(store.nodes 키) — UI 뱃지 클릭 이동/뒤로가기 추적용
  // 디자인 미리보기에서 UI/Mo 뱃지를 눌러 다른 화면으로 "이동"할 때마다 이전 화면의 navKey 를
  // 여기 쌓는다(흐름도의 flowNavStack 과 동일한 패턴). [◀ 뒤로]를 누르면 하나씩 꺼내 되돌아간다.
  let _viewerUiNavStack = [];
  let _rpLabelCache = {};  // REPORT_PROGRAM_ID -> {header3:'발주번호', ...} 조회 결과 캐시(세션 내 재사용)
  let _rpQueryCache = {};  // REPORT_PROGRAM_ID -> {serviceUid, steps:[...]} "SQL 보기" 탭 조회 캐시
  let _viewerMode = 'code';
  let _viewerDict = { single: {}, col: {} }; // 현재 뷰어 화면의 다국어 라벨 사전(선택 언어)
  let _viewerLinkMap = {}; // 현재 뷰어 화면의 id → WF/UI/Rp 연결정보(RESOURCE_HTML 모드에서 클릭이동 오버레이용)
  let _viewerGridIds = new Set(); // 현재 뷰어 화면의 실제 그리드 id 집합(그리드 placeholder 박스 표시용)
  let _viewerGridButtonMap = {}; // 현재 뷰어 화면의 gridId → 그리드 툴바 버튼 목록(RESOURCE_HTML 모드에서 버튼 오버레이용)
  let _viewerGridColsMap = {}; // 현재 뷰어 화면의 gridId → gridOptions(컬럼 정의, RESOURCE_HTML 모드에서 컬럼 표 오버레이용)
  let _viewerGridColumnPopupMap = {}; // 현재 뷰어 화면의 gridId → {컬럼제목 -> {programId,label}}(컬럼 액션버튼 UI 팝업, RESOURCE_HTML 모드에서 컬럼 표 오버레이용)
  let _viewerInlineReportMap = {}; // 현재 뷰어 화면의 컴포넌트id → 그 컴포넌트에 통째로 박혀 있는 reportJsonData(별도 Rp 배포 레코드 없이 자체 미리보기가 가능한 리포트 컴포넌트용)
  let _viewerInitMap = {}; // 현재 뷰어 화면의 id → 초기값 추적 정보(정적/리터럴/스크립트→WF→테이블 체인)
  let _vwCodeRaw = '';    // "코드" 탭에 지금 표시 중인 원본 텍스트(검색/하이라이트 재계산용)
  let _vwCodeHitIdx = -1; // 코드 검색 결과 중 현재 포커스된(강조색이 다른) 일치 인덱스
  let _vwZoom = 1;        // 리포트 디자인 미리보기 확대/축소 배율(1 = 100%). 새 노드를 열 때 초기화.
  let _vwReportDocHtml = ''; // 지금 iframe.srcdoc 에 들어있는 리포트 문서 원문(PDF/이미지 내보내기용)

  /* ---------- 그래프 왼쪽 "UI" 탭: 프로그램 검색 더블클릭 시 코드·디자인 보기의 "디자인" 모드만
     팝업 없이 바로 보여주는 상시 도킹 뷰. 모달(위 _viewer*)과는 별개의 독립 상태를 쓴다 — 사용자가
     모달로 다른 노드(예: WF 코드)를 열어보는 동안에도 이 탭의 내용이 바뀌지 않아야 하기 때문이다.
     렌더링 로직 자체(daafPreviewCss/realThemeLinksHtml/오버레이 함수들)는 모달과 100% 동일한
     함수를 그대로 재사용해서 "디자인 모드와 사용이 동일"하다는 요구사항을 자연스럽게 만족한다. ---------- */
  let _uiTabKey = null;           // 지금 탭에 표시 중인 노드의 navKey
  let _uiTabRaw = null;           // 지금 탭에 표시 중인 노드의 원본 raw(모달의 _viewerRaw 와 동일 용도) — store 에 없는 합성 노드(예: 임베디드 리포트)도 다룰 수 있도록 store 재조회 대신 직접 추적
  let _uiTabNavStack = [];        // UI/Mo 뱃지로 이동할 때마다 이전 화면의 key 를 쌓는 이력(모달의 _viewerUiNavStack 과 동일 패턴)
  let _uiTabLinkMap = {};
  let _uiTabGridIds = new Set();
  let _uiTabGridButtonMap = {};
  let _uiTabGridColsMap = {};
  let _uiTabGridColumnPopupMap = {};
  let _uiTabInlineReportMap = {}; // 탭 버전 — 위 _viewerInlineReportMap 과 동일한 용도
  let _uiTabInitMap = {};
  let _uiTabDict = { single: {}, col: {} }; // 이 탭 전용 다국어 라벨 사전(모달의 _viewerDict 와 공유하지 않음 — 서로 다른 노드를 동시에 볼 수 있어야 하므로)
  let _uiTabZoom = 1;             // 이 탭의 리포트 미리보기 확대/축소 배율(모달의 _vwZoom 과 별개)
  let _uiTabReportDocHtml = '';   // 이 탭에 지금 표시 중인 리포트 문서 원문(PDF/이미지 내보내기용, 모달의 _vwReportDocHtml 과 별개)
  let _uiTabLinkToastTimer = null;
  // 그리드/화면 어딘가에 박혀 있던 데이터로 그 자리에서 즉석으로 만든 "합성 노드"(예: 별도
  // z_rp_deploy_info 레코드 없이 자기 RESOURCE_JSON 안에 reportJsonData 를 통째로 담은 리포트
  // 컴포넌트 — bindDesignLinks 의 needsInline 분기 참고)를 위한 별도 캐시. 실제 store 에는 절대
  // 넣지 않는다 — store 에 넣으면 UI/WF/Rp 카운트 요약, 그래프 렌더링(둥둥 뜬 가짜 노드), 저장/
  // 내보내기(대응하는 실제 배포 레코드가 없는데 거대한 REPORT_JSON 이 함께 저장됨) 등 파도타기
  // 결과 전체의 정확성이 깨진다. showDetail()이 이 캐시를 store 조회 실패 시 폴백으로 봐서, 상세
  // 패널에는 정상적으로 표시되면서도 "진짜" 파도타기 결과는 오염되지 않게 한다.
  let _syntheticNodeCache = new Map();

  // z_dd_lang 행 목록 → 디자인 치환용 사전. GRID_ID='Single' 은 폼 컨트롤/버튼/라벨,
  // 그 외(UI_TYPE=COLUMN/GRID)는 그리드 컬럼. object_id(=컴포넌트 id/data-lang) 로 매칭한다.
  function buildDdDict(rows) {
    const single = {}, col = {};
    (rows || []).forEach(r => {
      const oid = r.OBJECT_ID, gid = r.GRID_ID, nm = r.DD_NM;
      if (oid == null || nm == null || String(nm).trim() === '') return;
      if (gid === 'Single' || gid == null || gid === '') single[oid] = nm;
      else { col[gid + '::' + oid] = nm; if (single[oid] == null) single[oid] = nm; }
    });
    return { single, col };
  }

  // 현재 데이터 소스(오프라인/온라인/데모)에서 프로그램의 다국어 라벨을 불러온다.
  // 언어는 좌측 상단 [언어] 선택값(langSel). 실패/미지원이면 빈 사전.
  async function loadDdDict(programId) {
    const empty = { single: {}, col: {} };
    if (!programId) return empty;
    const lang = (el('langSel') && el('langSel').value) || 'ko';
    try {
      if (offlineActive) {
        const r = await window.api.offlineQueryDdLang({ filePath: WaveOffline.folder(), programId, lang });
        return (r && r.ok) ? buildDdDict(r.rows) : empty;
      }
      if (!demoMode && cfg) {
        const r = await window.api.fetchDdLang({ cfg: getCfg(), programId, lang });
        return (r && r.ok) ? buildDdDict(r.rows) : empty;
      }
      // demo: 내장 샘플에 사전이 있으면 사용
      if (window.DEMO_DATA && window.DEMO_DATA.ddLang) {
        const rows = window.DEMO_DATA.ddLang.filter(x => x.PROGRAM_ID === programId && x.LANG_CD === lang);
        return buildDdDict(rows);
      }
    } catch (e) { /* 무시하고 원문 라벨 사용 */ }
    return empty;
  }

  // 리포트(Rp)의 실제 헤더 라벨(header1~N)을 조회한다 — REPORT_JSON 자체엔 없고, UI 화면과 완전히
  // 같은 다국어 테이블(z_dd_lang)에 UI_TYPE='REPORT', GRID_ID=리포트 파일명, OBJECT_ID=headerN
  // 으로 들어있다(z_dd_lang 은 이미 오프라인 동기화 대상이라 온라인/오프라인 모두 동작한다).
  // 처음엔 b_report_file(_tenant)→WF 역추적 방식으로 만들었으나, 실제로는 dd_lang 을 그대로
  // 재사용하는 게 정확하고 오프라인에서도 되므로 loadDdDict() 를 그대로 활용한다.
  async function resolveReportHeaderLabels(raw) {
    const reportProgramId = raw && raw.REPORT_PROGRAM_ID;
    if (!reportProgramId) return null;
    try {
      const dict = await loadDdDict(reportProgramId);
      return (dict && dict.single) || null;
    } catch (e) { return null; }
  }

  // 리포트(Rp)의 실제 데이터를 채우는 WF 전체 스텝 목록을 가져온다("SQL 보기" 패널용).
  // 위 resolveReportHeaderLabels() 와 같은 경로(b_report_file(_tenant) → SERVICE_UID)로 WF를
  // 찾지만, 이번엔 라벨 하나만 뽑는 게 아니라 그 WF 안의 모든 스텝(반복문/분기 내부 포함)을
  // 통째로 돌려준다. 온라인 DB 접속과 오프라인(report_link/report_link_tenant 를 [데이터 관리]에서
  // 미리 받아둔 경우) 모두 지원 — fetchWave() 처럼 offlineActive 여부로 두 경로를 나눈다.
  async function resolveReportQuerySteps(raw) {
    // 주의: demoMode 는 "라이브 DB에 붙어있지 않다"는 뜻으로도 쓰여 오프라인 모드에서도 true다
    // (offlineActive=true 일 때 demoMode 도 함께 true — applyMode() 참고). 그래서 여기서 순서가
    // 중요하다 — demoMode 만 보고 먼저 걸러버리면 오프라인 모드가 항상 "데모라서 불가"로 막힌다.
    // 반드시 offlineActive 를 먼저 확인한 뒤, 정말 순수 데모(오프라인도 아닌 경우)만 걸러야 한다.
    if (demoMode && !offlineActive) return null;
    const reportProgramId = raw && raw.REPORT_PROGRAM_ID;
    if (!reportProgramId) return null;
    try {
      const tenantId = el('tenantId').value.trim() || '*', coCd = el('coCd').value.trim() || '*';
      const lang = (el('langSel') && el('langSel').value) || 'ko';
      let row = null;
      if (offlineActive && WaveOffline.isOnline()) {
        const r = await window.api.offlineLookupReportService({ filePath: WaveOffline.folder(), reportProgramId, tenantId, coCd, lang });
        if (!r || !r.ok) return null;
        row = r.row;
      } else {
        if (!cfg) return null;
        const r = await window.api.lookupReportService({ cfg, reportProgramId, tenantId, coCd, lang });
        if (!r || !r.ok) return null;
        row = r.row;
      }
      if (!row || row.SERVICE_UID == null) return null;
      const wfRows = await fetchWave('WF', 'serviceUid', row.SERVICE_UID, tenantId, coCd, true);
      if (!wfRows || !wfRows.length || !wfRows[0].RESOURCE_WF) return null;
      return { serviceUid: row.SERVICE_UID, steps: P.collectAllWfSteps(wfRows[0].RESOURCE_WF) };
    } catch (e) { return null; }
  }


  // 그리드 컬럼/옵션 실시간 조회 — z_grid_columns(_tenant)/z_grid_options(_tenant). RESOURCE_JSON
  // 에 박힌 배포 스냅샷보다 우선한다(관리자가 그리드 커스터마이징으로 재배포 없이 바꾼 값이 여기
  // 반영되므로). loadDdDict()/resolveReportHeaderLabels() 와 완전히 동일한 온라인/오프라인/데모
  // 분기 패턴 — 데모 모드에선 시도하지 않고 조용히 null(=배포 스냅샷 그대로 유지).
  async function fetchLiveGridConfig(programId, gridId) {
    if (!programId || !gridId) return null;
    try {
      const tenantId = el('tenantId').value.trim() || '*', coCd = el('coCd').value.trim() || '*';
      if (offlineActive) {
        const r = await window.api.offlineLookupGridConfig({ filePath: WaveOffline.folder(), programId, gridId, tenantId, coCd });
        if (!r || !r.ok) return null;
        return { columns: r.columns || [], options: r.options || null };
      }
      if (!demoMode && cfg) {
        const r = await window.api.lookupGridConfig({ cfg: getCfg(), programId, gridId, tenantId, coCd });
        if (!r || !r.ok) return null;
        return { columns: r.columns || [], options: r.options || null };
      }
    } catch (e) { /* 무시하고 배포 스냅샷 유지 */ }
    return null;
  }

  // 특정 그리드 하나의 컬럼 표를 z_grid_columns 실시간 값으로 다시 그려서 갈아끼운다. 배포
  // 스냅샷으로 먼저 그려둔 뒤(즉시 표시), 이 조회가 끝나면(비동기) 컬럼이 실제로 있을 때만
  // 업그레이드한다 — 관리자가 그리드 커스터마이징을 아예 안 했으면(테이블에 그 그리드 행이 없으면)
  // 조용히 스냅샷을 그대로 둔다. hostDoc 이 그 사이 다른 화면으로 바뀌었으면(문서 자체가 달라짐)
  // 아무것도 안 한다.
  function upgradeGridColumnsWithLiveData(hostDoc, gridElm, gridId, programId, dict, popupMap) {
    fetchLiveGridConfig(programId, gridId).then((result) => {
      if (!result || !result.columns || !result.columns.length) return;
      if (!gridElm || gridElm.ownerDocument !== hostDoc || !hostDoc.contains(gridElm)) return; // 그 사이 다른 화면으로 이동
      const popupByTitle = (popupMap && (popupMap[gridId] || popupMap.__nogrid__)) || {};
      let html = '';
      try {
        const cols = P.computeGridColumnDefs({ columns: P.mapLiveGridColumns(result.columns) }, (navKey) => store.nodes.get(navKey), popupByTitle, dict);
        html = P.renderGridColumnsTableFromDefs(cols);
      } catch (e) { return; }
      if (!html) return;
      const wrap = hostDoc.createElement('div');
      wrap.innerHTML = html;
      const fresh = wrap.firstChild;
      if (!fresh) return;
      const old = gridElm.querySelector('.dz-grid-cols-wrap');
      if (old) old.replaceWith(fresh); else gridElm.appendChild(fresh);
    }).catch(() => { /* 무시 */ });
  }


  function openViewer(n, opts) {
    const t0 = el('vwLinkToast'); if (t0) t0.style.display = 'none';
    const raw = n.raw || {};
    // 노드 타입별 표시할 리소스 컬럼 구성
    const cand = [];
    const push = (col, label, kind) => { if (raw[col]) cand.push({ col, label, kind, text: String(raw[col]) }); };
    if (n.type === 'UI' || n.type === 'Mo') {
      push('RESOURCE_HTML', 'HTML (화면)', 'html');
      push('RESOURCE_JSON', 'JSON (컴포넌트)', 'json');
      push('RESOURCE_JS', 'JS (이벤트)', 'js');
      push('RESOURCE_DTO', 'DTO', 'json');
      push('LAYOUT_CONTENT', 'Layout', 'json');
    } else if (n.type === 'WF') {
      push('RESOURCE_WF', 'Workflow (JSON)', 'json');
    } else if (n.type === 'Rp') {
      push('REPORT_JSON', 'Report (JSON)', 'json');
    }
    if (!cand.length) {
      setStatus('표시할 리소스가 없습니다.', true);
      // UI/Mo 뱃지로 이동해 온 경우 화면 전환에 실패했으므로, 뷰어 안에서도 바로 보이는 토스트로
      // 알려준다(호출부에서 이미 이동 이력에 쌓아 둔 이전 화면 key 는 아직 그대로 유효하므로
      // _viewerKey/스택을 건드리지 않고 지금 화면을 그대로 유지한다).
      if (opts && opts.fromNav) showViewerLinkToast('표시할 리소스가 없습니다(' + (n.id || n.key) + ').');
      return;
    }
    // 디자인 미리보기의 UI/Mo 뱃지를 클릭해 다른 화면으로 "이동"해 온 경우(opts.fromNav)가 아니라
    // 상세 패널의 [코드·디자인 보기] 버튼 등으로 새로 여는 경우엔 이전 이동 이력을 초기화한다.
    if (!(opts && opts.fromNav)) {
      _viewerUiNavStack = [];
    } else if (opts.cameFrom) {
      // 리소스가 실제로 있어 화면 전환이 확정된 시점에만 이동 이력에 쌓는다([◀ 뒤로]로 되돌아올 대상).
      _viewerUiNavStack.push(opts.cameFrom);
    }
    _viewerKey = n.key || null;
    // 새 노드를 여는 것이므로 이전 노드에서 남은 코드 검색어/포커스는 초기화한다.
    const codeSearchInp = el('vwCodeSearch');
    if (codeSearchInp) codeSearchInp.value = '';
    _vwCodeHitIdx = -1;
    _vwZoom = 1;
    updateZoomLabel();
    _viewerRes = cand;
    _viewerRaw = raw;
    _viewerNodeType = n.type;
    // 다국어 라벨 사전 로드(화면/모바일만). 비동기로 받아오면 디자인 모드를 다시 그린다.
    _viewerDict = { single: {}, col: {} };
    if (n.type === 'UI' || n.type === 'Mo') {
      loadDdDict(n.id).then(d => {
        _viewerDict = d || { single: {}, col: {} };
        if (el('viewerModal').style.display !== 'none' && _viewerMode === 'design') renderViewer();
      });
    }

    // 제목/셀렉트 채우기 — UI/Mo 뱃지를 눌러 이동해 온 경우, 어디서 왔는지 감(感)을 잃지 않도록
    // 제목 앞에 이동 이력 개수(예: "◀2")를 살짝 붙여준다(선택사항이라 없어도 무방한 작은 UX 힌트).
    const navHint = _viewerUiNavStack.length ? ('◀' + _viewerUiNavStack.length + ' · ') : '';
    el('viewerTitle').textContent = navHint + (n.id || n.name || '리소스') + ' — 코드 · 디자인 보기';
    const sel = el('vwResSel');
    sel.innerHTML = cand.map((c, i) => '<option value="' + i + '">' + esc(c.label) + '</option>').join('');
    sel.value = '0';
    // [◀ 뒤로] 버튼은 되돌아갈 이동 이력이 있을 때만 보인다(흐름도의 [◀ 뒤로]와 동일한 패턴).
    const backBtn = el('vwBack');
    if (backBtn) backBtn.style.display = _viewerUiNavStack.length ? '' : 'none';

    // 디자인 미리보기 가능 여부: RESOURCE_JSON(컴포넌트 트리)·HTML·리포트(REPORT_JSON) 가 있으면 활성화
    const canDesign = !!(raw.RESOURCE_JSON || cand.some(c => c.kind === 'html') || (n.type === 'Rp' && raw.REPORT_JSON));
    el('vwDesign').style.display = canDesign ? '' : 'none';
    // 기본값은 "디자인" 보기로 연다(요청사항 — 실제 화면 모양을 먼저 보고 싶을 때가 많음).
    // 디자인 렌더링이 불가능한 리소스(코드만 있는 경우)면 코드 보기로 폴백한다. UI/Mo 뱃지를
    // 눌러 다른 화면으로 "이동"해 온 경우(opts.fromNav)는 지금 보고 있던 모드를 그대로 유지해
    // 탐색 흐름이 끊기지 않게 한다.
    const initMode = (opts && opts.fromNav) ? _viewerMode : (canDesign ? 'design' : 'code');
    _viewerMode = initMode;
    setViewerMode(initMode);
    renderViewer();
    // 사용자가 조절해둔 크기가 있으면 복원(없으면 CSS 기본값)
    const boxEl = el('viewerModal').querySelector('.viewer-box');
    // UI/Mo 뱃지로 "이동"해 온 경우엔 사용자가 맞춰둔 창 위치·크기를 그대로 유지한다(같은 뷰어
    // 창 안에서 화면만 바뀌는 느낌을 주기 위함) — 새로 여는 경우에만 가운데/최대화로 초기화한다.
    if (!(opts && opts.fromNav)) {
      // 이전에 드래그로 옮긴 위치는 초기화 → 다시 가운데로 표시
      boxEl.classList.remove('dragged');
      boxEl.style.left = ''; boxEl.style.top = '';
      // 코드/디자인 보기는 기본값을 최대 크기로 연다(내용이 많아 작은 창에선 보기 불편함).
      boxEl.classList.add('maximized');
      const maxBtn = el('viewerMax');
      if (maxBtn) { maxBtn.textContent = '❐'; maxBtn.title = '이전 크기로'; }
    }
    el('viewerModal').style.display = 'flex';
  }

  function setViewerMode(mode) {
    _viewerMode = mode;
    el('vwCode').classList.toggle('active', mode === 'code');
    el('vwDesign').classList.toggle('active', mode === 'design');
    el('vwCodeView').style.display = mode === 'code' ? '' : 'none';
    // vwDesignView(iframe) 자체가 아니라 그걸 감싼 vwDesignPane(툴바+iframe 세로 컬럼)을 켠다.
    el('vwDesignPane').style.display = mode === 'design' ? 'flex' : 'none';
    // SQL은 더 이상 별도 탭/모드가 아니다 — 흐름도 탭이 상세 패널을 캔버스 옆에 늘 띄워두듯,
    // 리포트(Rp)의 "디자인" 모드에서는 그 데이터를 채우는 WF의 쿼리들을 디자인 미리보기
    // 오른쪽에 고정폭 사이드 패널로 항상 같이 보여준다(탭 전환 없이 한 화면에서 바로 비교).
    const isReportDesign = mode === 'design' && _viewerNodeType === 'Rp' && !!(_viewerRaw && _viewerRaw.REPORT_JSON);
    el('vwSqlView').style.display = (isReportDesign && !_rpqPanelHidden.modal) ? 'block' : 'none';
    // 확대/축소·PDF/이미지 저장 툴바도 리포트 디자인 미리보기 전용(우리가 직접 만든
    // self-contained 문서에서만 의미가 있다 — UI/Mo 는 실제 운영 화면 마크업이라 대상에서 뺀다).
    el('vwDesignToolbar').style.display = isReportDesign ? '' : 'none';
    // "필수입력/유효성 검증 메시지 표시" 토글은 UI/Mo 화면 전용 개념이라, 리포트(Rp) 미리보기에는
    // 해당 요소가 아예 없어 눌러도 아무 효과가 없다 — 리포트일 때는 숨겨서 혼란을 줄인다.
    el('vwValMsgWrap').style.display = (mode === 'design' && _viewerNodeType !== 'Rp') ? '' : 'none';
    // 코드 검색창은 "코드" 탭(순수 텍스트)에서만 의미가 있다 — 디자인(iframe)에는 안 보임.
    el('vwCodeSearchWrap').style.display = mode === 'code' ? '' : 'none';
  }

  /* ---------- 리포트 디자인 미리보기 툴바: 확대/축소 · PDF/이미지로 저장 ----------
   * 표준 PDF 뷰어 툴바(스크롤 가능한 페이지 + 확대/축소 + 다운로드)를 흉내낸다. 확대/축소는
   * 리포트 iframe 문서의 body 에 CSS zoom 을 직접 걸어서 구현한다(transform:scale 과 달리 zoom 은
   * 레이아웃 박스 자체가 커지므로, 스크롤 영역이 확대된 내용에 맞게 저절로 늘어난다).
   * hostKind: 'modal'(기본, 코드·디자인 보기 팝업) | 'tab'(그래프 왼쪽 UI 탭) — 두 호스트가 각자
   * 독립적인 리포트를 동시에 띄워놓을 수 있으므로 배율(zoom)·내보낼 문서(docHtml)도 따로 갖는다. */
  const RP_TOOLBAR_IDS = {
    modal: { iframe: 'vwDesignView', zoomReset: 'vwZoomReset', exportStatus: 'vwExportStatus' },
    tab: { iframe: 'uiTabDesignView', zoomReset: 'uiTabZoomReset', exportStatus: 'uiTabExportStatus' }
  };
  function updateZoomLabel(hostKind) {
    const ids = RP_TOOLBAR_IDS[hostKind] || RP_TOOLBAR_IDS.modal;
    const zoom = hostKind === 'tab' ? _uiTabZoom : _vwZoom;
    const btn = el(ids.zoomReset);
    if (btn) btn.textContent = Math.round(zoom * 100) + '%';
  }
  function applyZoomToIframe(hostKind) {
    const ids = RP_TOOLBAR_IDS[hostKind] || RP_TOOLBAR_IDS.modal;
    const zoom = hostKind === 'tab' ? _uiTabZoom : _vwZoom;
    const iframe = el(ids.iframe);
    let doc = null;
    try { doc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document); } catch (e) { /* 무시 */ }
    if (doc && doc.body) doc.body.style.zoom = String(zoom);
    updateZoomLabel(hostKind);
  }
  function setVwZoom(z, hostKind) {
    const clamped = Math.max(0.4, Math.min(2.5, z));
    if (hostKind === 'tab') _uiTabZoom = clamped; else _vwZoom = clamped;
    applyZoomToIframe(hostKind);
  }
  function showExportStatus(msg, kind, hostKind) {
    const ids = RP_TOOLBAR_IDS[hostKind] || RP_TOOLBAR_IDS.modal;
    const el2 = el(ids.exportStatus);
    if (!el2) return;
    el2.textContent = msg || '';
    el2.className = 'vw-export-status' + (kind ? ' ' + kind : '');
    if (msg) setTimeout(() => { if (el2.textContent === msg) el2.textContent = ''; }, 3500);
  }
  // 저장 파일 기본 이름: 리포트 프로그램명(없으면 ID) — 파일시스템에 쓸 수 없는 문자는 치환.
  function reportExportBaseName(hostKind) {
    const raw = hostKind === 'tab' ? (_uiTabRaw || {}) : (_viewerRaw || {});
    const nm = raw.REPORT_PROGRAM_NM || raw.REPORT_PROGRAM_ID || '리포트';
    return String(nm).replace(/[\\/:*?"<>|]/g, '_');
  }
  async function exportReportAs(kind, hostKind) {
    const docHtml = hostKind === 'tab' ? _uiTabReportDocHtml : _vwReportDocHtml;
    if (!docHtml) { showExportStatus('내보낼 미리보기가 없습니다.', 'err', hostKind); return; }
    if (!window.api || !window.api[kind === 'pdf' ? 'exportReportPdf' : 'exportReportImage']) {
      showExportStatus('이 실행 환경에서는 지원하지 않습니다.', 'err', hostKind);
      return;
    }
    const ext = kind === 'pdf' ? 'pdf' : 'png';
    showExportStatus((kind === 'pdf' ? 'PDF' : '이미지') + ' 생성 중…', null, hostKind);
    try {
      const fn = kind === 'pdf' ? window.api.exportReportPdf : window.api.exportReportImage;
      const res = await fn({ html: docHtml, defaultName: reportExportBaseName(hostKind) + '.' + ext });
      if (!res) { showExportStatus('저장에 실패했습니다.', 'err', hostKind); return; }
      if (res.canceled) { showExportStatus('', null, hostKind); return; }
      if (!res.ok) { showExportStatus('저장 실패: ' + (res.error || '알 수 없는 오류'), 'err', hostKind); return; }
      showExportStatus('저장됨: ' + res.path, 'ok', hostKind);
    } catch (e) {
      showExportStatus('저장 실패: ' + (e && e.message ? e.message : e), 'err', hostKind);
    }
  }

  // 디자인 미리보기의 "필수입력/유효성 검증 오류 메시지" 표시 여부. 실제 운영 화면에서는
  // 사용자가 저장을 시도해 검증에 실패했을 때만 나타나는 문구인데, 정적 미리보기에서는 항상
  // 텍스트로 노출돼 화면이 지저분해 보일 수 있어 기본은 숨김으로 두고 토글로 필요할 때만 본다.
  let _vwShowValMsg = false;
  (function initValMsgToggle() {
    const cb = el('vwShowValMsg');
    if (!cb) return;
    cb.checked = _vwShowValMsg;
    cb.addEventListener('change', () => {
      _vwShowValMsg = cb.checked;
      const iframe = el('vwDesignView');
      let doc = null;
      try { doc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document); } catch (e) { /* 무시 */ }
      const root = doc && doc.querySelector('.daaf-preview');
      if (root) root.classList.toggle('dz-hide-valmsg', !_vwShowValMsg);
    });
  })();

  // RESOURCE_HTML(원본 마크업) 렌더 시: data-lang='KEY' 요소의 텍스트를 사전(single)의 현재 언어 라벨로 치환.
  // data-lang="xxxErrorMessage" 는 라벨/버튼 텍스트가 아니라 유효성 검증 메시지용 JS 훅 id다.
  // 대부분 <input .../> 같은 자기닫힘 태그에 붙어 있어서, 아래 정규식이 "태그 바로 다음 텍스트"를
  // 이 값으로 치환하면 원래 아무 텍스트도 없던 자리에 메시지 전체가 그대로 끼어들어가(레이아웃이
  // form-group 의 flex 행 안에서 입력창을 밀어내거나 사라진 것처럼 보이게 만들고), "검증 메시지 표시"
  // 토글로도 끌 수 없는 상태(순수 텍스트라 .dz-valmsg 클래스를 못 닮)가 된다. 이런 키는 라벨 치환에서
  // 제외하고, 대신 insertValidationMessages() 가 별도로 .dz-valmsg 요소로 만들어 토글 대상이 되게 한다.
  const ERR_MSG_KEY_RE = /ErrorMessage$/i;

  function translateHtmlLabels(html, dict) {
    if (!html || !dict || !dict.single) return html || '';
    // z_dd_lang 라벨에 줄바꿈 의도로 리터럴 "\n"(백슬래시+n 두 글자)이나 실제 개행문자가 그대로
    // 들어있는 경우가 있다(리포트 쪽과 같은 문제 — parser.js 의 nlToBr() 참고). esc() 는 &<>" 만
    // 이스케이프하므로 그대로 두면 한글 윈도우 글꼴에서 "₩n"처럼 지저분하게 노출된다.
    const nlToBr = (s) => String(s == null ? '' : s).replace(/\r\n|\r|\n/g, '<br>').replace(/\\n/g, '<br>');
    // 1) 일반 패턴: <tag data-lang='key' ...>텍스트<  (텍스트가 태그 바로 다음에 오는 경우 — 라벨/버튼 등)
    //    단, 원래 텍스트가 완전히 비어있고 그 다음이 다른 태그를 "여는" 경우(예: 아이콘 전용 버튼
    //    <button data-lang='btnNewBpCd'><i class='fa fa-file'></i></button>)는 건너뛴다.
    //    이런 요소는 실제 DaaF 런타임에서 data-lang 값을 화면에 보이는 텍스트가 아니라 title(툴팁)
    //    로만 쓰는 경우가 흔한데, 여기서 텍스트를 끼워넣으면 아이콘/배지와 겹쳐 보이는 문제가 생긴다.
    let out = html.replace(/(data-lang=['"]([^'"]+)['"][^>]*>)([^<]*)(<\/?)/g, (m, pre, key, txt, next) => {
      if (ERR_MSG_KEY_RE.test(key)) return m;
      if (!txt.trim() && next === '<') return m; // 비어있고 자식 태그가 여는 경우 → 건너뜀
      const t = dict.single[key];
      return (t != null && String(t).trim() !== '') ? (pre + nlToBr(esc(t)) + next) : m;
    });
    // 2) 라디오 항목처럼 data-lang 라벨 안에 <input> 등 다른 태그가 먼저 오고 그 뒤에
    //    보이는 텍스트가 오는 경우: <label data-lang='key' ...><input .../>텍스트</label>
    out = out.replace(/(<label[^>]*data-lang=['"]([^'"]+)['"][^>]*>)([\s\S]*?)(<\/label>)/g, (m, pre, key, mid, post) => {
      if (ERR_MSG_KEY_RE.test(key)) return m;
      const t = dict.single[key];
      if (t == null || String(t).trim() === '') return m;
      const idx = mid.lastIndexOf('>');
      const head = idx === -1 ? '' : mid.slice(0, idx + 1);
      return pre + head + nlToBr(esc(t)) + post;
    });
    return out;
  }

  function renderViewer() {
    const idx = +el('vwResSel').value || 0;
    const res = _viewerRes[idx];
    if (!res) return;
    if (_viewerMode === 'code') {
      // JSON 이면 보기좋게 정렬 시도
      let txt = res.text;
      if (res.kind === 'json') {
        try { txt = JSON.stringify(JSON.parse(res.text), null, 2); } catch (e) { /* 원본 유지 */ }
      }
      _vwCodeRaw = txt;
      _vwCodeHitIdx = -1;
      renderCodeSearchHighlight();
    } else {
      const iframe = el('vwDesignView');
      // 리포트(Rp) 미리보기는 우리가 직접 생성한 self-contained 문서이고, 문서 끝에 실제 렌더된
      // 표 높이를 재서 겹침을 보정하는 작은 스크립트(layoutRpPages, buildReportPreviewHtml 참고)가
      // 붙어있어 allow-scripts 가 필요하다. UI/Mo 미리보기는 실제 운영 RESOURCE_HTML(신뢰할 수 없는
      // 위젯 초기화 스크립트 포함 가능)을 그대로 담을 수 있어, 지금처럼 스크립트 실행을 계속 막아
      // "읽기 전용 미리보기"로 안전하게 유지한다.
      iframe.setAttribute('sandbox', _viewerNodeType === 'Rp' ? 'allow-same-origin allow-scripts' : 'allow-same-origin');
      _designLinksBoundModal = null;   // 새 문서를 그리므로 링크 바인딩 상태 초기화
      _designTabsBoundModal = null;    // 탭 바인딩 상태도 함께 초기화
      _initBadgesBoundModal = null;    // 초기값 배지 바인딩 상태도 함께 초기화
      { const ivBox = el('vwInitBox'); if (ivBox) ivBox.style.display = 'none'; } // 다른 화면 정보가 남아있지 않도록 숨김
      const raw = _viewerRaw || {};
      // 리포트(Rp): REPORT_JSON 좌표/스타일로 재구성한 "레이아웃 추정 미리보기".
      // 실제 ActiveReportsJS 뷰어(CDN)는 라이선스/네트워크 이슈로 제거하고, 이 방식만 사용한다.
      // UI/Mo/WF 경로(테마 CSS 재현)와는 완전히 별개의 self-contained 문서로 그린다.
      if (_viewerNodeType === 'Rp') {
        const reportProgramId = raw.REPORT_PROGRAM_ID;
        const cachedLabels = reportProgramId ? _rpLabelCache[reportProgramId] : null;
        let rpBody = null;
        try { rpBody = raw.REPORT_JSON ? P.buildReportPreviewHtml(raw.REPORT_JSON, cachedLabels) : null; } catch (e) { /* 렌더 불가 */ }
        if (rpBody) {
          // 안내 배너("🧩 레이아웃 추정 미리보기 …")는 요청에 따라 표시하지 않는다 — 본문만 그린다.
          const doc = '<!doctype html><html><head><meta charset="utf-8"><style>' + reportPreviewCss() + '</style></head><body>'
            + rpBody + '</body></html>';
          _vwReportDocHtml = doc;
          iframe.srcdoc = doc;
          // 새 문서가 로드되면(레이블 재조회 후 다시 그려질 때도 포함) 확대/축소 배율을 다시 적용한다
          // — srcdoc 을 새로 넣으면 항상 새 문서라 이전 zoom 스타일이 초기화되기 때문.
          iframe.onload = () => applyZoomToIframe();
        } else {
          _vwReportDocHtml = '';
          iframe.srcdoc = '<body style="font-family:sans-serif;padding:20px;color:#64748b">이 리포트는 레이아웃 미리보기를 지원하지 않습니다(REPORT_JSON 형식을 인식할 수 없음).</body>';
        }
        // 라벨을 아직 못 구했으면(캐시 없음) 백그라운드로 조회해서 나오는 대로 다시 그린다.
        if (reportProgramId && !cachedLabels) {
          resolveReportHeaderLabels(raw).then((labels) => {
            if (labels && Object.keys(labels).length) {
              _rpLabelCache[reportProgramId] = labels;
              // 그 사이에 사용자가 다른 노드/모드로 옮겨가지 않았을 때만 다시 그린다.
              if (_viewerNodeType === 'Rp' && _viewerRaw === raw) renderViewer();
            }
          });
        }
        // SQL 사이드 패널(연결된 WF의 쿼리들)도 디자인 미리보기와 함께 그린다 — 더 이상
        // 별도 탭을 클릭해야 보이는 게 아니라 항상 오른쪽에 나란히 표시된다.
        if (raw.REPORT_JSON) renderReportSqlView();
        return;
      }
      // 디자인: RESOURCE_HTML(실제 운영 마크업) 우선 → 실제 테마 CSS로 그대로 재현,
      // 없을 때만 RESOURCE_JSON 컴포넌트 트리로 근사 재구성(dz-*)한다.
      let bodyHtml = null, mode = '';
      const rj = raw.RESOURCE_JSON;
      // 1) RESOURCE_HTML — 실제 운영 화면과 동일한 마크업이므로 실제 테마 CSS가 그대로 적용된다.
      //    data-lang 요소 텍스트만 현재 선택 언어 라벨로 치환.
      const htmlRes = res.kind === 'html' ? res : _viewerRes.find(c => c.kind === 'html');
      // 초기값 추적 맵(정적/리터럴/스크립트→WF→테이블 체인) — html/json 두 렌더 경로 모두에서 필요하므로
      // 모드가 정해지기 전에 한 번만 계산해 둔다.
      const initMapForNode = (rj && P.computeInitValueMap) ? P.computeInitValueMap(rj) : {};
      if (htmlRes && htmlRes.text) { bodyHtml = translateHtmlLabels(htmlRes.text, _viewerDict); mode = 'html'; }
      // 2) 폴백: RESOURCE_HTML 이 없으면 RESOURCE_JSON 으로 근사 재구성
      if (!bodyHtml && rj) {
        try {
          const built = P.buildDesignHtml(rj, raw.RESOURCE_HTML || '', _viewerDict, (navKey) => store.nodes.get(navKey), initMapForNode, raw.RESOURCE_JS);
          if (built) { bodyHtml = built; mode = 'json'; }
        } catch (e) { /* 렌더 불가 */ }
      }
      // WF/UI/Rp 연결(클릭 이동) 정보 — html 모드에서 오버레이로 적용하기 위해 계산해 둔다.
      // (json 모드는 buildDesignHtml 내부에서 이미 data-navkey 를 직접 마크업에 심어 준다)
      _viewerLinkMap = (mode === 'html' && rj) ? (P.computeLinkMap ? P.computeLinkMap(rj, raw.RESOURCE_JS) : {}) : {};
      // 실제 그리드 컴포넌트(type=grid)의 gridId 집합 — html 모드에서 그리드 placeholder(<div id="..">,
      // 실제 위젯이 JS 로 그리기 전이라 빈 채로 내려옴)를 "그리드처럼 보이게" 박스/헤더를 씌우는 데 쓴다.
      _viewerGridIds = (mode === 'html' && rj && P.collectGridIds) ? P.collectGridIds(rj) : new Set();
      // 그리드 "툴바" 버튼 목록(행추가/취소/복사/삭제 + 품목참조 등 커스텀 버튼) — html 모드에서
      // 그리드 placeholder 박스 안에 실제 화면처럼 버튼 하나하나를 그려 넣는 데 쓴다(json 모드는
      // buildDesignHtml 이 이미 마크업에 직접 그려 준다).
      _viewerGridButtonMap = (mode === 'html' && rj && P.computeGridToolbarButtonList) ? P.computeGridToolbarButtonList(rj) : {};
      // 그리드 컬럼 정의(gridId -> gridOptions) — html 모드에서 그리드 placeholder 박스 안에
      // 실제 화면처럼 컬럼 헤더/뱃지/샘플 행을 그려 넣는 데 쓴다(json 모드는 buildDesignHtml 이
      // 이미 마크업에 직접 그려 준다).
      _viewerGridColsMap = (mode === 'html' && rj && P.collectGridOptionsMap) ? P.collectGridOptionsMap(rj) : {};
      // 그리드 컬럼 액션 버튼(Tracking No 팝업 등)의 UI 팝업 — RESOURCE_JS 가 있어야 찾을 수 있으므로
      // html 모드에서 raw.RESOURCE_JS 를 함께 넘긴다(json 모드는 buildDesignHtml 내부에서 이미 처리).
      _viewerGridColumnPopupMap = (rj && P.computeGridColumnPopups) ? P.computeGridColumnPopups(rj, raw.RESOURCE_JS) : {};
      _viewerInlineReportMap = (rj && P.computeInlineReportMap) ? P.computeInlineReportMap(rj) : {};
      // 초기값 배지: html 모드는 DOM 오버레이로 붙이고(applyInitValueOverlay), json 모드는 buildDesignHtml 이
      // 이미 마크업에 직접 심어 준다. bindInitBadges 는 클릭 핸들러 바인딩용이라 모드에 상관없이 항상 채워둔다.
      _viewerInitMap = rj ? initMapForNode : {};
      if (bodyHtml) {
        // 검증 메시지 토글 기본 상태(_vwShowValMsg=false)를 최초 렌더부터 반영 — 껐다 켤 때 깜빡이지 않게
        const wrapCls = (mode === 'json' ? 'daaf-preview dz-root' : 'daaf-preview') + (_vwShowValMsg ? '' : ' dz-hide-valmsg');
        // 실제 운영 화면과 최대한 동일하게 보이도록, 우리가 근사(近似)한 인라인 CSS(daafPreviewCss, 폴백/안전망 역할로
        // 먼저 적용) 위에 실제 DaaF 런타임 테마 CSS(Bootstrap4 + sirius 테마 + uni 공통 + builder 보정)를
        // 이어서 로드해 실제 색상/폰트/버튼/그리드/탭 등의 룩앤필을 그대로 재현한다.
        // (theme/ 폴더는 앱과 함께 배포되는 실제 css/images/fonts 사본 — index.html 기준 상대경로로 로드됨)
        const doc = '<!doctype html><html><head><meta charset="utf-8"><style>' + daafPreviewCss() + '</style>'
          + realThemeLinksHtml()
          + '</head><body class="sirius">'
          + '<div class="builder-base ' + wrapCls + '">' + bodyHtml + '</div></body></html>';
        iframe.srcdoc = doc;
        // srcdoc 로드 후: (html 모드) WF 연결 오버레이 적용 → 연결(link) 객체에 클릭 핸들러 부착,
        // 필수입력/유효성 검증 오류 메시지 요소 태깅(기본 숨김, 토글로 표시)
        const afterLoad = () => {
          let fdoc = null;
          try { fdoc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document); } catch (e) { /* 무시 */ }
          if (mode === 'html') {
            try { insertValidationMessages(fdoc, _viewerDict); } catch (e) { /* 무시 */ }
          }
          try { applyHtmlLinkOverlay(iframe, _viewerLinkMap, _viewerGridIds, _viewerGridButtonMap, _viewerGridColsMap, _viewerGridColumnPopupMap, _viewerDict.single); } catch (e) { /* 무시 */ }
          // 초기값(IV) 배지: html 모드는 DOM 오버레이로 붙여야 하고, json 모드는 buildDesignHtml 이 이미
          // 마크업에 심어뒀으므로 바인딩만 하면 된다.
          if (mode === 'html') { try { applyInitValueOverlay(iframe, _viewerInitMap); } catch (e) { /* 무시 */ } }
          try { applyValidationMsgOverlay(iframe); } catch (e) { /* 무시 */ }
          try { preventDesignNavigation(iframe); } catch (e) { /* 무시 */ }
          try { bindDesignTabs(iframe); } catch (e) { /* 무시 */ }
          bindDesignLinks(iframe);
          try { bindInitBadges(iframe, _viewerInitMap); } catch (e) { /* 무시 */ }
          // 그리드가 있으면(모드 무관 — json 은 data-grid-id, html 은 _viewerGridIds) 배포
          // 스냅샷 컬럼 표를 z_grid_columns 실시간 값으로 백그라운드에서 업그레이드한다.
          try {
            const programId = raw && raw.PROGRAM_ID;
            if (programId && fdoc) {
              if (mode === 'html') {
                (_viewerGridIds || new Set()).forEach((gid) => {
                  const gridElm = fdoc.getElementById(gid);
                  if (gridElm) upgradeGridColumnsWithLiveData(fdoc, gridElm, gid, programId, _viewerDict.single, _viewerGridColumnPopupMap);
                });
              } else {
                fdoc.querySelectorAll('[data-grid-id]').forEach((gridElm) => {
                  const gid = gridElm.getAttribute('data-grid-id');
                  if (gid) upgradeGridColumnsWithLiveData(fdoc, gridElm, gid, programId, _viewerDict.single, _viewerGridColumnPopupMap);
                });
              }
            }
          } catch (e) { /* 무시 */ }
        };
        iframe.onload = afterLoad;
        // 일부 환경에서 onload 가 늦게/안 걸릴 수 있어 보강
        setTimeout(afterLoad, 120);
      } else {
        iframe.srcdoc = '<body style="font-family:sans-serif;padding:20px;color:#64748b">이 리소스는 디자인 미리보기를 지원하지 않습니다.</body>';
      }
    }
  }

  // "코드" 탭 검색: 그래프/테이블 검색(gv-dim 으로 나머지를 흐리게 처리)과 달리, 코드 보기는
  // 원문 텍스트를 그대로 두고 일치한 단어만 <mark> 로 부각시킨다(나머지 흐림 처리 없음).
  // vwResSel(리소스 선택)이 바뀌거나 뷰어를 새로 열 때 renderViewer() 가 _vwCodeRaw 를 갱신하고
  // 이 함수를 호출해 다시 그린다 — 검색어(el('vwCodeSearch').value)는 그대로 유지된다.
  function renderCodeSearchHighlight() {
    const box = el('vwCodeView');
    if (!box) return;
    const cntEl = el('vwCodeSearchCnt');
    const inp = el('vwCodeSearch');
    const raw = _vwCodeRaw || '';
    const term = inp ? inp.value.trim() : '';
    if (!term) {
      box.textContent = raw;
      if (cntEl) cntEl.textContent = '';
      _vwCodeHitIdx = -1;
      return;
    }
    const lower = raw.toLowerCase();
    const needle = term.toLowerCase();
    let html = '', idx = 0, count = 0;
    while (true) {
      const found = lower.indexOf(needle, idx);
      if (found === -1) { html += esc(raw.slice(idx)); break; }
      html += esc(raw.slice(idx, found));
      html += '<mark class="vw-code-hit" data-hit="' + count + '">' + esc(raw.slice(found, found + needle.length)) + '</mark>';
      count++;
      idx = found + needle.length;
    }
    box.innerHTML = html;
    if (!count) {
      _vwCodeHitIdx = -1;
      if (cntEl) cntEl.textContent = '0건';
      return;
    }
    // 이전에 포커스해둔 인덱스가 여전히 유효하면 유지, 아니면 첫 일치로 — focusCodeHit() 이
    // "n/총 m건" 형태로 카운트 배지까지 함께 갱신한다.
    if (_vwCodeHitIdx < 0 || _vwCodeHitIdx >= count) _vwCodeHitIdx = 0;
    focusCodeHit(_vwCodeHitIdx);
  }

  // 현재 포커스된 일치 항목만 다른 색(vw-code-hit-cur)으로 표시하고 화면 가운데로 스크롤한다.
  function focusCodeHit(i) {
    const box = el('vwCodeView');
    if (!box) return;
    const marks = box.querySelectorAll('mark.vw-code-hit');
    marks.forEach(m => m.classList.remove('vw-code-hit-cur'));
    const cur = marks[i];
    if (cur) {
      cur.classList.add('vw-code-hit-cur');
      cur.scrollIntoView({ block: 'center' });
    }
    const cntEl = el('vwCodeSearchCnt');
    if (cntEl && marks.length) cntEl.textContent = (i + 1) + '/' + marks.length + '건';
  }

  // Enter(다음)/Shift+Enter(이전)로 일치 항목 사이를 순환 이동.
  function stepCodeHit(dir) {
    const box = el('vwCodeView');
    if (!box) return;
    const total = box.querySelectorAll('mark.vw-code-hit').length;
    if (!total) return;
    _vwCodeHitIdx = ((_vwCodeHitIdx < 0 ? 0 : _vwCodeHitIdx) + dir + total) % total;
    focusCodeHit(_vwCodeHitIdx);
  }

  // 리포트(Rp)의 "디자인" 모드 오른쪽에 항상 함께 뜨는 SQL 사이드 패널: REPORT_JSON 자체엔
  // SQL 이 없으므로(레포트가 직접 쿼리를 담지 않고, 실행 시점에 연결된 WF가 데이터를 채워
  // 넣는 구조 — z_dd_lang 라벨과 같은 원리), b_report_file(_tenant) 로 찾은 그 WF 안의 모든
  // 스텝을 훑어서, 쿼리(실제 SQL 또는 추정)를 가진 스텝만 카드로 나열한다. 흐름도 탭의 상세
  // 패널처럼 더 이상 별도 탭이 아니라 디자인 미리보기 옆에 항상 도킹되어 있다.
  // hostKind: 'modal'(기본) | 'tab' — 모달과 UI 탭이 각자 다른 리포트를 동시에 보고 있을 수 있어
  // 조회 결과를 반영할 때 "그 사이 다른 화면으로 옮겨갔는지" 판단 기준도 호스트별로 따로 본다.
  // SQL 패널(모달의 #vwSqlView / UI 탭의 #uiTabSqlView) 전체를 접었다 펼 수 있게 하는 토글.
  // 요청사항: "접기를 누르면 내용만 사라지고 팝업(패널) 자체는 그대로 있어서 뒤의 레포트 화면이
  // 안 넓어진다" — 패널 안쪽 내용만 숨기는 게 아니라 패널 자체(가로 400px 자리)를 통째로
  // 숨겨서 그 공간을 리포트 디자인 미리보기가 그대로 넓게 차지하도록 한다. 그래서 접기/펼치기
  // 버튼은 패널 안이 아니라, Rp 전용 툴바(zoom/PDF 버튼 옆)에 항상 보이는 버튼으로 둔다 —
  // 패널을 완전히 숨긴 뒤에도 다시 켤 방법이 있어야 하기 때문이다.
  let _rpqPanelHidden = { modal: false, tab: false };
  function setSqlPanelHidden(hostKind, hidden) {
    _rpqPanelHidden[hostKind] = hidden;
    const box = el(hostKind === 'tab' ? 'uiTabSqlView' : 'vwSqlView');
    const btn = el(hostKind === 'tab' ? 'uiTabSqlToggle' : 'vwSqlToggle');
    if (box) box.style.display = hidden ? 'none' : 'block';
    if (btn) {
      btn.classList.toggle('active', !hidden);
      btn.title = hidden ? '연결된 WF 쿼리 패널 다시 보기' : '연결된 WF 쿼리 패널 숨기고 리포트를 넓게 보기';
    }
  }

  function renderSqlPanelBody(box, hostKind, bodyHtml) {
    box.innerHTML = '<div class="rpq-panel-head"><b>🔎 연결된 WF 쿼리</b></div>'
      + '<div class="rpq-panel-body">' + bodyHtml + '</div>';
    return box.querySelector('.rpq-panel-body');
  }

  function renderReportSqlView(hostKind) {
    hostKind = hostKind === 'tab' ? 'tab' : 'modal';
    const box = el(hostKind === 'tab' ? 'uiTabSqlView' : 'vwSqlView');
    if (!box) return;
    const raw = hostKind === 'tab' ? (_uiTabRaw || {}) : (_viewerRaw || {});
    const reportProgramId = raw.REPORT_PROGRAM_ID;
    const cached = reportProgramId ? _rpQueryCache[reportProgramId] : null;
    if (cached) { renderReportSqlCards(box, hostKind, cached); return; }
    // demoMode 는 오프라인 모드에서도 true 이므로(resolveReportQuerySteps() 주석 참고),
    // offlineActive 를 먼저 걸러낸 뒤에만 "진짜 데모"로 판단해야 한다.
    if (demoMode && !offlineActive) {
      renderSqlPanelBody(box, hostKind, '<div class="rpq-empty">이 기능은 데모 모드에서는 지원하지 않습니다.</div>');
      return;
    }
    if (!offlineActive && !cfg) {
      renderSqlPanelBody(box, hostKind, '<div class="rpq-empty">DB에 접속하거나 오프라인 데이터를 불러온 뒤 다시 확인하세요.</div>');
      return;
    }
    renderSqlPanelBody(box, hostKind, '<div class="rpq-empty">연결된 WF를 조회하는 중…</div>');
    resolveReportQuerySteps(raw).then((result) => {
      // 그 사이에 사용자가 다른 노드/모드로 옮겨갔으면 조용히 버린다.
      if (hostKind === 'tab') {
        if (_uiTabRaw !== raw) return;
      } else if (_viewerNodeType !== 'Rp' || _viewerRaw !== raw || _viewerMode !== 'design') {
        return;
      }
      if (reportProgramId) _rpQueryCache[reportProgramId] = result;
      renderReportSqlCards(box, hostKind, result);
    });
  }

  function renderReportSqlCards(box, hostKind, result) {
    if (!result || !Array.isArray(result.steps) || !result.steps.length) {
      renderSqlPanelBody(box, hostKind, '<div class="rpq-empty">연결된 WF를 찾지 못했습니다(' + (offlineActive
        ? '오프라인 데이터에 리포트-WF 연결 정보가 없습니다 — [데이터 관리]에서 "리포트-WF 연결(b_report_file)" 테이블을 받아보세요.'
        : 'b_report_file 에 등록되지 않았거나, 해당 서비스가 삭제됐을 수 있습니다.') + ')</div>');
      return;
    }
    const queried = result.steps.filter(stepHasQuery);
    if (!queried.length) {
      renderSqlPanelBody(box, hostKind, '<div class="rpq-empty">연결된 WF(serviceUid=' + esc(result.serviceUid) + ')는 찾았지만, 쿼리를 가진 스텝이 없습니다.</div>');
      return;
    }
    const bodyHtml = '<div class="rp-guess-banner" style="margin-bottom:14px">'
      + '이 리포트의 실제 데이터를 채우는 WF(serviceUid=' + esc(result.serviceUid) + ') 안에서 쿼리를 가진 스텝 '
      + queried.length + '개를 순서대로 보여줍니다. SQL 이 없는 선언적 스텝은 🧩 추정 쿼리로 표시됩니다.</div>'
      + queried.map(renderReportQueryCard).join('');
    const bodyEl = renderSqlPanelBody(box, hostKind, bodyHtml);
    bindSqlVariants(bodyEl || box);
    (bodyEl || box).querySelectorAll('.rpq-guess-copy').forEach((btn) => {
      btn.addEventListener('click', () => {
        const pre = btn.closest('.rpq-card').querySelector('.rpq-guess-pre');
        if (pre) copyToClipboard(pre.textContent, btn);
      });
    });
  }

  // data-lang="xxxErrorMessage" 훅(대부분 <input readonly 없는 자기닫힘 태그 자체)에 다국어 사전의
  // 번역문이 있으면, 그 자리에 텍스트를 직접 끼워넣지 않고(→ translateHtmlLabels 참고) 별도의
  // <span class="dz-valmsg"> 형제 요소로 만들어 붙인다. 이렇게 해야 (1) "검증 메시지 표시" 토글로
  // 확실히 켜고 끌 수 있고(순수 텍스트 삽입은 클래스를 못 달아 토글이 안 먹었음),
  // (2) form-group 의 flex 한 줄 레이아웃 안에서 입력창을 밀어내지 않고 아래 줄로 감싸 보여줄 수 있다.
  function insertValidationMessages(doc, dict) {
    if (!doc || !dict || !dict.single) return;
    let elms;
    try { elms = doc.querySelectorAll('[data-lang]'); } catch (e) { return; }
    elms.forEach(origElm => {
      const key = origElm.getAttribute('data-lang');
      if (!key || !ERR_MSG_KEY_RE.test(key)) return;
      // 라디오/체크박스는 여러 개(input)가 한 필드를 공유하는 그룹이라, 옵션마다 메시지를 끼워 넣으면
      // (좁은 <label> 안에 글자가 세로로 쪼개져 보이는 등) 레이아웃이 깨진다. 필수표시는 그룹 라벨의
      // *(required) 로 이미 보이므로 옵션별 메시지 삽입은 건너뛴다.
      if (origElm.type === 'radio' || origElm.type === 'checkbox') return;
      if (origElm.getAttribute('data-dz-valmsg-done') === '1') return;
      origElm.setAttribute('data-dz-valmsg-done', '1');
      const msg = dict.single[key];
      if (msg == null || String(msg).trim() === '') return;
      // 콤보 등 위젯이 그리는 자리표시자 뒤에 hide 처리된 실제 값 입력창(class='hide')은 자신이
      // 화면에 안 보이므로, 그 옆에 메시지를 붙이면 어떤 필드 얘기인지 알 수 없는 채로 허공에 뜬다.
      // applyHtmlLinkOverlay 와 동일하게, 화면에 보이는 콤보 placeholder/컨테이너 쪽으로 옮겨 붙인다.
      let elm = origElm;
      const isHiddenLike = elm.type === 'hidden' || /(^|\s)(hide|d-none)(\s|$)/.test(elm.className || '');
      if (isHiddenLike) {
        const id = elm.getAttribute('id');
        const redirected = (id && doc.getElementById(id + 'Combo')) || elm.closest('.search-group') || elm.closest('.col');
        // 콤보 placeholder 도 .search-group/.col 도 없는 순수 hidden 필드(예: 폼 상태 플래그)는
        // 화면에 대응하는 자리 자체가 없으므로, 원래 요소 옆에 그냥 끼워넣지 않고 건너뛴다
        // (그렇지 않으면 아무 맥락 없는 "필수 입력 항목입니다" 텍스트가 허공에 떠 보이게 된다).
        if (!redirected) return;
        elm = redirected;
      }
      if (!elm) return;
      const span = doc.createElement('span');
      span.className = 'dz-valmsg';
      span.textContent = msg;
      if (DZ_NO_CHILD_TAGS[elm.tagName]) {
        if (elm.nextSibling) elm.parentNode.insertBefore(span, elm.nextSibling);
        else if (elm.parentNode) elm.parentNode.appendChild(span);
      } else {
        elm.appendChild(span);
      }
    });
  }

  // 필수입력/유효성 검증 오류 메시지로 보이는 요소를 찾아 'dz-valmsg' 클래스를 붙인다.
  // 실제 운영 화면에서는 저장 시도 후 검증에 실패했을 때만 나타나는 문구지만, 정적 미리보기에서는
  // 항상 텍스트로 노출되어(data-required-error 같은 속성값이 그대로 화면에 보이거나, 다국어 사전이
  // XxxErrorMessage 키까지 함께 치환하는 경우 등) 화면이 지저분해진다. 다음 신호로 폭넓게 탐지한다:
  //   1) data-required-error/-greaterthan-error/-lessthan-error/... 등 검증 속성값과 "똑같은 텍스트"를
  //      가진 요소(속성값이 별도 라벨/문구로 그대로 렌더된 경우)
  //   2) data-lang 속성이 '...ErrorMessage' 로 끝나는 요소(다국어 사전이 검증 메시지 키까지 치환한 경우)
  //   3) class 명에 error/invalid-feedback/help-block/validation 이 들어간 요소(테마의 검증 메시지 UI)
  // 실제로 지운 것은 아니며 CSS 클래스만 붙여, 토글로 즉시 표시/숨김이 가능하게 한다.
  function applyValidationMsgOverlay(iframe) {
    let doc = null;
    try { doc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document); }
    catch (e) { return; }
    if (!doc || !doc.body) return;
    const ERR_ATTRS = ['data-required-error', 'data-greaterthan-error', 'data-lessthan-error',
      'data-pattern-error', 'data-min-error', 'data-max-error', 'data-email-error',
      'data-length-error', 'data-regex-error', 'data-required-error-message'];
    const known = new Set();
    ERR_ATTRS.forEach(attr => {
      doc.querySelectorAll('[' + attr + ']').forEach(elm => {
        const v = elm.getAttribute(attr);
        if (v && v.trim()) known.add(v.trim());
      });
    });
    const clsRe = /(^|\s)(error|invalid-feedback|help-block|validation-msg|error-message|error-msg)(\s|$)/i;
    // input/select/textarea 는 실제 값을 입력받는 컨트롤이다. data-lang="xxxErrorMessage" 는 이런
    // 컨트롤에도 흔히 붙어 있는데(검증 실패 시 JS 가 메시지를 보여주기 위한 훅일 뿐), 이 신호만으로
    // "메시지 요소"로 오인해 .dz-valmsg 를 붙이면 토글을 끌 때 컨트롤 자체가 display:none 으로 사라져
    // 버린다(입력창이 통째로 없어지는 버그). 실제 검증 메시지 요소는 항상 span/label/div 같은 표시용
    // 요소이지 입력 컨트롤 자신일 수 없으므로, 이런 폼 컨트롤 태그는 애초에 검사 대상에서 제외한다.
    const FORM_CTRL_TAGS = { INPUT: 1, SELECT: 1, TEXTAREA: 1 };
    doc.querySelectorAll('body *').forEach(elm => {
      if (elm.children.length > 0) return; // 텍스트를 직접 담은 최말단 요소만 검사
      if (FORM_CTRL_TAGS[elm.tagName]) return; // 입력 컨트롤 자신은 절대 메시지 요소로 취급하지 않는다
      let hit = false;
      const dl = elm.getAttribute && elm.getAttribute('data-lang');
      if (dl && /ErrorMessage$/i.test(dl)) hit = true;
      if (!hit && clsRe.test(String(elm.className || ''))) hit = true;
      if (!hit) {
        const txt = (elm.textContent || '').trim();
        if (txt && known.has(txt)) hit = true;
      }
      if (hit) elm.classList.add('dz-valmsg');
    });
  }

  // RESOURCE_HTML(원본 마크업) 모드에서 WF/UI/Rp 연결 배지·클릭이동을 오버레이로 붙인다.
  // linkMap 은 { id: {navKey,label,kind} } — id 는 원본 HTML의 id="..." 속성값과 동일하다.
  // (json 모드는 buildDesignHtml 이 이미 data-navkey 를 마크업에 직접 심어주므로 대상이 아니다)
  // input/select/textarea/img 등은 브라우저가 자식 노드를 절대 렌더링하지 않는 요소라서,
  // 실제 RESOURCE_HTML(진짜 마크업)이 주가 되면서 WF 연결 배지를 이런 요소 "안"에 넣으면
  // DOM 에는 존재해도 화면에는 전혀 보이지 않는다(예전 dz-* 합성 마크업은 대부분 div/span 이라
  // 문제가 드러나지 않았음). 이런 요소는 배지를 자식이 아니라 바로 옆(형제)에 삽입해야 한다.
  const DZ_NO_CHILD_TAGS = { INPUT: 1, SELECT: 1, TEXTAREA: 1, IMG: 1 };

  // WF/UI/Rp 연결 배지의 툴팁 문구를 만든다. link.label(서비스ID 등)만으로는 정보가 부족해서,
  // 이미 파도타기로 store 에 로드되어 있는 노드가 있으면 이름·SERVICE_UID 까지 함께 보여준다.
  // (store 에 아직 없는 대상 — 이 UI에서 처음 참조되는 WF 등 — 은 label만으로 표시된다.)
  function buildLinkTitle(link) {
    const kindLabel = link.kind === 'wf' ? 'WF 연결: ' : link.kind === 'rp' ? '리포트 연결: ' : '팝업 UI 연결: ';
    const idPart = link.label || link.navKey;
    const n = store.nodes.get(link.navKey);
    let extra = '';
    if (n) {
      if (n.name && n.name !== idPart) extra += ' · ' + n.name;
      if (n.uid) extra += ' · UID ' + n.uid;
    }
    // 선언적 serviceId/serviceUid 바인딩이 아니라 버튼 스크립트(usrEventFn) 안에서
    // ajax 로 wf/{uid}/execute 를 직접 호출하는 경우(결의전표등록 저장 버튼 등) — 배지 자체는
    // 동일하게 보이되 툴팁으로 "직접호출"임을 구분해준다.
    if (link.custom) extra += ' · 직접호출(스크립트)';
    return kindLabel + idPart + extra + ' (클릭: 그래프 이동)';
  }

  // 컴포넌트 id 로 오버레이(WF/UI/Rp 배지, IV 배지)를 붙일 실제 DOM 타깃을 찾는다.
  // 1) 그대로 id 로 찾히면 그것(단, 숨겨진 실제 입력창이면 자리표시자/상위 컨테이너로 대체)
  // 2) 못 찾으면 라디오 그룹일 가능성 — 라디오는 개별 옵션(id=autoSpplFlagA 등)마다 다른 id 가 붙고
  //    그룹 전체를 가리키는 컴포넌트id 는 각 input 의 name 속성에만 남아 있어 그 id 로는 못 찾는다.
  //    name=id 인 첫 라디오를 찾아 감싸는 .radio-wrap(없으면 .form-group)을 타깃으로 삼는다.
  // 3) 숨겨진 입력인데 자리표시자(Combo)도, 감싸는 .search-group/.col 도 없으면 — 화면에 보이는
  //    컨트롤이 아예 없다는 뜻(예: 팝업 호출 시 넘어오는 숨은 range 파라미터 hidden input). 이런
  //    경우 예전엔 숨은 input 자체에 배지를 붙여서, 화면 아무 데나(그 input이 실제로 앉은 자리) 뜬금없이
  //    떠다니는 배지가 생겼다 — 매칭되는 눈에 보이는 컨트롤이 없으면 아예 배지를 달지 않는다(null 반환).
  function resolveOverlayTarget(doc, id) {
    let elm = null;
    try { elm = doc.getElementById(id); } catch (e) { /* 무시 */ }
    if (elm && (elm.type === 'hidden' || /(^|\s)(hide|d-none)(\s|$)/.test(elm.className || ''))) {
      elm = doc.getElementById(id + 'Combo') || elm.closest('.search-group') || elm.closest('.col') || null;
    }
    if (!elm) {
      try {
        const radio = doc.querySelector('input[type="radio"][name="' + id + '"]');
        if (radio) elm = radio.closest('.radio-wrap') || radio.closest('.form-group') || radio;
      } catch (e) { /* 무시 */ }
    }
    return elm;
  }

  // WF/UI/Rp 뱃지(applyHtmlLinkOverlay)와 IV 뱃지(applyInitValueOverlay)가 같은 컨트롤에 동시에
  // 붙는 경우(예: 콤보가 WF 조회도 갖고 초기값도 있는 경우)가 흔해서, 두 함수가 각자 따로 뱃지를
  // 붙이면 서로 다른 오버레이가 겹쳐 보인다. 그래서 "이 요소의 뱃지 오버레이 컨테이너"를 하나만
  // 만들고(없으면 새로 만들고, 이미 있으면 그걸 재사용) 두 함수가 여기에 함께 뱃지를 추가하도록
  // 공용 헬퍼로 뺐다. input/select/textarea 처럼 자식을 못 담는 요소는 wrapper span 으로 감싼다.
  // 라벨 오른쪽에 뱃지를 붙일 자리를 찾아서(없으면 만들어서) 반환한다. 요청사항: 그리드를 제외한
  // 모든 컴포넌트는 뱃지를 컨트롤 안이 아니라 "라벨 텍스트 오른쪽"에 붙인다.
  // id: linkMap 의 키(대개 pv.id) — <label for="id">를 우선 찾고, 없으면 가장 가까운
  // .search-group/.form-group 컨테이너 안(또는 형제)의 <label>을 찾는다. 라벨을 정말 못 찾는
  // 드문 경우에만 기존 컨트롤 안쪽 오버레이 방식으로 폴백한다(getOrCreateBadgeOverlay).
  function findAssociatedLabel(doc, elm, id) {
    let label = null;
    if (id) {
      try { label = doc.querySelector('label[for="' + CSS.escape(id) + '"]'); } catch (e) { /* 무시 */ }
    }
    if (!label) {
      const group = elm.closest('.search-group') || elm.closest('.form-group');
      if (group) {
        for (let i = 0; i < group.children.length; i++) {
          if (group.children[i].tagName === 'LABEL') { label = group.children[i]; break; }
        }
        if (!label) {
          const sib = group.previousElementSibling;
          if (sib && sib.tagName === 'LABEL') label = sib;
        }
        if (!label && group.parentElement) {
          const pc = group.parentElement.children;
          for (let i = 0; i < pc.length; i++) {
            if (pc[i].tagName === 'LABEL') { label = pc[i]; break; }
          }
        }
      }
    }
    return label;
  }

  function getOrCreateLabelBadgeSlot(doc, elm, id) {
    if (!elm) return null;
    // 버튼은 예외 — 버튼 자체엔 보통 별도 라벨이 없고, 뱃지를 버튼 안 내용으로 넣는 편이 훨씬
    // 자연스럽다(그리드 툴바 버튼과 동일한 방식).
    if (elm.tagName === 'BUTTON') {
      for (let i = 0; i < elm.children.length; i++) {
        if (elm.children[i].classList && elm.children[i].classList.contains('dz-badge-inline')) return elm.children[i];
      }
      const inline = doc.createElement('span');
      inline.className = 'dz-badge-inline';
      elm.appendChild(inline);
      return inline;
    }
    const label = findAssociatedLabel(doc, elm, id);
    if (!label) return getOrCreateBadgeOverlay(doc, elm); // 라벨을 못 찾은 드문 경우의 안전망
    for (let i = 0; i < label.children.length; i++) {
      if (label.children[i].classList && label.children[i].classList.contains('dz-label-badges')) return label.children[i];
    }
    const slot = doc.createElement('span');
    slot.className = 'dz-label-badges';
    label.appendChild(slot);
    return slot;
  }

  function getOrCreateBadgeOverlay(doc, elm) {
    if (!elm) return null;
    // 버튼은 절대배치 오버레이로 겹치면 특히 아이콘만 있는 작은 팝업 버튼(예: 검색 돋보기 버튼)에서
    // 뱃지가 버튼 밖으로 삐져나와 엉뚱한 자리에 떠 보인다. 그리드 툴바 버튼(renderGridToolbarInto)과
    // 동일하게, 버튼은 뱃지를 절대배치 없이 "버튼 안의 평범한 내용"으로 이어붙인다 — 버튼은 내용에
    // 맞춰 스스로 커지므로 크기와 무관하게 항상 자연스럽게 들어간다.
    if (elm.tagName === 'BUTTON') {
      for (let i = 0; i < elm.children.length; i++) {
        if (elm.children[i].classList && elm.children[i].classList.contains('dz-badge-inline')) return elm.children[i];
      }
      const inline = doc.createElement('span');
      inline.className = 'dz-badge-inline';
      elm.appendChild(inline);
      return inline;
    }
    // 그 외(input/select/textarea, 콤보 wrapper div 등)는 대상 요소 자체의 DOM 을 절대 건드리지
    // 않는다 — 예를 들어 "수주번호"처럼 입력창+버튼+읽기전용 입력창 3개가 한 flex 행에 나란히
    // 있고 각자 width:21% 같은 퍼센트 폭을 쓰는 경우, 그 입력창 하나만 새 wrapper 로 감싸면
    // (이전 방식) 그 퍼센트 폭의 기준이 원래의 flex 행이 아니라 새 wrapper 로 바뀌어버려 전체
    // 레이아웃이 깨진다(돋보기 아이콘이 사라지고 다음 칸이 다음 줄로 밀려나는 등). 대신 이
    // 컨트롤을 담고 있는 안정적인 상위 컨테이너(.form-group 등, 보통 label 아래 한 단만 감싸는
    // div)를 찾아 그 컨테이너에 position:absolute 오버레이를 "추가 형제"로 붙인다 — absolute
    // 요소는 원래 있던 형제들의 레이아웃/크기 계산에 전혀 영향을 주지 않으므로 100% 안전하다.
    const host = elm.closest('.form-group') || elm.closest('.search-group')
      || elm.closest('.input-group-custom') || elm.parentElement || elm;
    host.classList.add('dz-badge-host');
    for (let i = 0; i < host.children.length; i++) {
      const child = host.children[i];
      if (child.classList && child.classList.contains('dz-badge-overlay')) return child;
    }
    const overlay = doc.createElement('span');
    overlay.className = 'dz-badge-overlay';
    host.appendChild(overlay);
    return overlay;
  }

  // 그리드 placeholder 박스(id) 안에 툴바 버튼(행추가/취소/복사/삭제 + 커스텀 버튼)을 실제
  // 화면처럼 하나씩 그려 넣는다. buildDesignHtml(json 모드)의 그리드 렌더링과 동일한 데이터
  // (computeGridToolbarButtonList)를 그대로 써서, html 모드에서도 버튼이 안 보이던 문제를 없앤다.
  function renderGridToolbarInto(doc, elm, gid, buttonListMap) {
    const btns = buttonListMap && buttonListMap[gid];
    if (!btns || !btns.length || elm.querySelector('.dz-grid-toolbar')) return;
    const clsOf = { wf: 'lk-wf', ui: 'lk-ui', rp: 'lk-rp' };
    const badgeOf = { wf: 'WF', ui: 'UI', rp: 'Rp' };
    const bar = doc.createElement('div');
    bar.className = 'dz-grid-toolbar';
    btns.forEach(b => {
      const btn = doc.createElement('button');
      const linked = !!b.kind;
      btn.className = 'dz-btn' + (linked ? ' dz-linked' : '');
      btn.type = 'button';
      if (!linked) btn.disabled = true;
      btn.textContent = b.label || b.id || 'button';
      if (linked) {
        const kindLabel = b.kind === 'wf' ? 'WF 연결: ' : b.kind === 'rp' ? '리포트 연결: ' : 'UI 팝업 연결: ';
        btn.title = kindLabel + (b.wfLabel || b.label) + ' (클릭: 그래프 이동)';
        btn.setAttribute('data-navkey', b.navKey);
        const badge = doc.createElement('span');
        badge.className = 'dz-link-tag ' + (clsOf[b.kind] || 'lk-wf');
        badge.textContent = badgeOf[b.kind] || 'WF';
        btn.appendChild(badge);
      }
      bar.appendChild(btn);
    });
    elm.appendChild(bar);
  }

  // 그리드 placeholder 박스(id) 안에 컬럼 헤더/뱃지/샘플 행 표를 실제 화면처럼 그려 넣는다.
  // buildDesignHtml(json 모드)의 buildGridColumnsTableHtml 과 동일한 함수를 그대로 재사용해
  // html 모드에서도(RESOURCE_HTML 은 실제 Wijmo 위젯을 런타임 JS 로만 그려서 컬럼이 하나도 안
  // 보이던 문제) 컬럼 목록을 볼 수 있게 한다.
  function renderGridColumnsInto(doc, elm, gid, colsMap, popupMap, dict) {
    const go = colsMap && colsMap[gid];
    if (!go || elm.querySelector('.dz-grid-cols-wrap') || !P.buildGridColumnsTableHtml) return;
    const popupByTitle = (popupMap && (popupMap[gid] || popupMap.__nogrid__)) || {};
    let html = '';
    try { html = P.buildGridColumnsTableHtml(go, (navKey) => store.nodes.get(navKey), popupByTitle, dict); } catch (e) { /* 무시 */ }
    if (!html) return;
    const wrap = doc.createElement('div');
    wrap.innerHTML = html;
    elm.appendChild(wrap.firstChild);
  }

  function applyHtmlLinkOverlay(iframe, linkMap, gridIds, buttonListMap, colsMap, popupMap, dict) {
    const hasLinks = linkMap && Object.keys(linkMap).length;
    const hasGrids = gridIds && gridIds.size;
    if (!hasLinks && !hasGrids) return;
    let doc = null;
    try { doc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document); }
    catch (e) { return; }
    if (!doc || !doc.body) return;
    const clsOf = { wf: 'lk-wf', ui: 'lk-ui', rp: 'lk-rp' };
    const badgeOf = { wf: 'WF', ui: 'UI', rp: 'Rp' };
    Object.keys(linkMap || {}).forEach(id => {
      let links = linkMap[id];
      if (!id || !links || !links.length) return;
      const isGridId = !!(gridIds && gridIds.has(id));
      // 요청사항: 그리드 상단(전체) 배지 줄에는 "어느 컬럼에도 매핑되지 않은" WF/UI만 남긴다 —
      // 이미 컬럼 뱃지 행(renderGridColumnsInto)에 표시될 navKey 는 여기서 걸러낸다.
      if (isGridId && colsMap && colsMap[id] && P.computeGridColumnDefs) {
        const popupByTitle = (popupMap && (popupMap[id] || popupMap.__nogrid__)) || {};
        let colDefs = [];
        try { colDefs = P.computeGridColumnDefs(colsMap[id], (navKey) => store.nodes.get(navKey), popupByTitle); } catch (e) { /* 무시 */ }
        const colNavKeys = new Set();
        colDefs.forEach(c => (c.links || []).forEach(l => colNavKeys.add(l.navKey)));
        links = links.filter(l => !colNavKeys.has(l.navKey));
      }
      // 필터링 후 이 요소에 남은 배지가 없더라도, 그리드라면 박스/툴바/컬럼 표는 여전히 그려야
      // 한다 — 아래 두 번째 순회(gridIds.forEach 폴백)가 grid-box 클래스와 컬럼 표를 대신 채워
      // 주므로 여기서는 조용히 건너뛴다.
      if (!links.length) return;
      const elm = resolveOverlayTarget(doc, id);
      // 중복삽입 방지: 배지를 자식/형제 어디에 붙였든 한 번만 처리하도록 data-dz-linked 플래그로 확인한다
      // (기존 elm.querySelector('.dz-link-tag') 방식은 배지를 형제로 붙이는 경우 찾지 못해 중복 삽입됨).
      if (!elm || elm.getAttribute('data-dz-linked') === '1') return;
      elm.setAttribute('data-dz-linked', '1');
      elm.setAttribute('data-comp-id', id);
      // 실제 그리드(Wijmo 등) 위젯은 RESOURCE_HTML 단계에선 텅 빈 placeholder(<div id="...">)로만
      // 내려오고 JS 가 런타임에 행/열을 그려넣는다. 그 상태 그대로 두면 박스도 안 보이고 WF 배지만
      // 허공에 떠 있는 것처럼 보이므로, 실제 그리드로 확인된 id 는 박스(테두리+헤더)를 씌워준다.
      if (isGridId) {
        elm.classList.add('dz-grid-box');
        elm.setAttribute('data-grid-label', '📊 그리드 (' + id + ')');
      }
      elm.classList.add(links.length > 1 ? 'dz-linked-multi' : 'dz-linked');
      // 조회/저장/재계산 등 서로 다른 버튼이 같은 그리드를 각각 다른 WF 로 채우는 경우가 흔해서,
      // 링크가 1개면 컨테이너 자체를 클릭 가능하게 하고(기존 동작 유지), 여러 개면 배지마다
      // 별도 data-navkey 를 달아 각각 클릭 이동할 수 있게 한다.
      if (links.length === 1) {
        const link = links[0];
        const title = buildLinkTitle(link);
        elm.setAttribute('data-navkey', link.navKey);
        elm.setAttribute('title', title);
      }
      // 뱃지를 컨트롤 밖(다음 형제)이나 위젯 내부 아무 데나(마지막 자식) 흘려넣지 않고, 항상 그
      // 컨트롤 박스 "안쪽" 왼쪽 여백에 고정해서 보여준다(json 모드 renderComp 와 동일한 시각 언어,
      // .dz-badge-host/.dz-badge-overlay 클래스 공유, getOrCreateBadgeOverlay 참고).
      // 단, 그리드(isGridId)는 예외 — 그리드 박스는 헤더 표시줄·컬럼 표 등 자체 레이아웃이 이미
      // 있어서(.dz-grid-box .dz-link-tag 로 별도 스타일링) 이 오버레이를 씌우면 가운데에 겹쳐
      // 보인다. 그리드는 기존처럼 흐름 안에 그냥 이어붙인다.
      if (isGridId) {
        links.forEach((link, i) => {
          const title = buildLinkTitle(link);
          const badge = doc.createElement('span');
          badge.className = 'dz-link-tag ' + (clsOf[link.kind] || 'lk-wf') + (link.custom ? ' dz-link-custom' : '');
          badge.textContent = (badgeOf[link.kind] || 'WF') + (link.custom ? '*' : '') + (links.length > 1 ? (i + 1) : '');
          badge.title = title;
          badge.setAttribute('data-navkey', link.navKey);
          badge.setAttribute('data-comp-id', id);
          elm.appendChild(badge);
        });
        renderGridToolbarInto(doc, elm, id, buttonListMap);
        renderGridColumnsInto(doc, elm, id, colsMap, popupMap, dict);
        return;
      }
      let overlayHost = getOrCreateLabelBadgeSlot(doc, elm, id);
      if (!overlayHost) return;
      links.forEach((link, i) => {
        const title = buildLinkTitle(link);
        const badge = doc.createElement('span');
        badge.className = 'dz-link-tag ' + (clsOf[link.kind] || 'lk-wf') + (link.custom ? ' dz-link-custom' : '');
        // 직접호출(스크립트) 배지는 "WF*"처럼 별표를 붙여 선언적 바인딩 배지와 한눈에 구분되게 한다.
        badge.textContent = (badgeOf[link.kind] || 'WF') + (link.custom ? '*' : '') + (links.length > 1 ? (i + 1) : '');
        badge.title = title;
        badge.setAttribute('data-navkey', link.navKey);
        badge.setAttribute('data-comp-id', id);
        overlayHost.appendChild(badge);
      });
    });
    // WF/UI/Rp 연결이 하나도 없는 그리드(예: 조회용으로만 쓰이는 단순 표시 그리드)도
    // 박스만은 보이도록, linkMap 에 없더라도 실제 그리드 id 는 여기서 한 번 더 확인한다.
    if (gridIds && gridIds.size) {
      gridIds.forEach(id => {
        let elm = null;
        try { elm = doc.getElementById(id); } catch (e) { /* 무시 */ }
        if (!elm) return;
        if (!elm.classList.contains('dz-grid-box')) {
          elm.classList.add('dz-grid-box');
          elm.setAttribute('data-grid-label', '📊 그리드 (' + id + ')');
        }
        // 헤더 배지가 없어(위 루프를 안 거쳐) 버튼도 아직 안 그려졌을 수 있는 그리드까지 마저 채운다.
        renderGridToolbarInto(doc, elm, id, buttonListMap);
        renderGridColumnsInto(doc, elm, id, colsMap, popupMap, dict);
      });
    }
  }

  // RESOURCE_HTML(원본 마크업) 모드에서 "초기값(IV)" 배지를 오버레이로 붙인다.
  // linkMap 과 구조가 다르다는 점에 주의: initMap 은 { compId: [ {kind,...}, ... ] } (다중값 배열)이고
  // navKey 없이 data-init-id 만 심어 클릭 시 그래프 이동이 아니라 상세패널을 띄운다(bindInitBadges 참고).
  function applyInitValueOverlay(iframe, initMap) {
    if (!initMap || !Object.keys(initMap).length) return;
    let doc = null;
    try { doc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document); }
    catch (e) { return; }
    if (!doc || !doc.body) return;
    Object.keys(initMap).forEach(id => {
      const info = initMap[id];
      if (!info || !info.length) return;
      const elm = resolveOverlayTarget(doc, id);
      if (!elm || elm.getAttribute('data-dz-init') === '1') return;
      elm.setAttribute('data-dz-init', '1');
      const kind = info[0].kind;
      const cls = kind === 'chain' ? 'dz-init-chain' : kind === 'literal' ? 'dz-init-lit' : 'dz-init-static';
      // WF/UI 뱃지(applyHtmlLinkOverlay)와 같은 슬롯을 공유한다 — 같은 컨트롤에 WF 조회 + 초기값이
      // 동시에 있는 경우, 라벨 오른쪽 한 자리에 뱃지 두 개가 나란히 모여 보이게 하기 위함.
      const overlay = getOrCreateLabelBadgeSlot(doc, elm, id);
      if (!overlay) return;
      const badge = doc.createElement('span');
      badge.className = 'dz-link-tag dz-init-tag ' + cls;
      badge.textContent = 'IV';
      badge.title = '초기값 추적 정보 보기 (클릭)';
      badge.setAttribute('data-init-id', id);
      overlay.appendChild(badge);
    });
  }

  // [초기값 추적] "IV" 배지 상세패널의 "지금 값 조회" 버튼용 — B_CONFIGURATION_V 에서 특정 MAJOR_CD 의
  // 실제 기준값(REFERENCE='Y') 행을 온라인/오프라인 모드 구분 없이 조회한다. resolveReportQuerySteps()
  // 와 동일한 순서 규칙(offlineActive 를 demoMode 보다 먼저 확인)을 따른다.
  async function resolveConfigRefValue(majorCd) {
    if (demoMode && !offlineActive) return { ok: false, reason: 'demo' };
    if (!majorCd) return { ok: false, reason: 'no-major-cd' };
    try {
      const tenantId = el('tenantId').value.trim() || '*', coCd = el('coCd').value.trim() || '*';
      if (offlineActive && WaveOffline.isOnline()) {
        const r = await window.api.offlineQueryConfigRef({ filePath: WaveOffline.folder(), majorCd, tenantId, coCd });
        if (!r || !r.ok) return { ok: false, reason: (r && r.error) || 'offline-query-failed' };
        return { ok: true, row: r.row || null };
      }
      if (!cfg) return { ok: false, reason: 'no-cfg' };
      const r = await window.api.fetchConfigRef({ cfg, majorCd, tenantId, coCd });
      if (!r || !r.ok) return { ok: false, reason: (r && r.error) || 'query-failed' };
      return { ok: true, row: r.row || null };
    } catch (e) { return { ok: false, reason: String(e && e.message ? e.message : e) }; }
  }

  // 디자인 미리보기(iframe) 안의 초기값(IV) 배지에 클릭 핸들러를 건다.
  // WF/UI/Rp 배지(data-navkey, bindDesignLinks)와 달리 그래프로 이동하지 않고,
  // 상세패널(모달은 #vwInitBox, UI 탭은 #uiTabInitBox)에 그 필드의 초기값 추적 체인 전체를 보여준다.
  // hostKind: 'modal'(기본) | 'tab' — 두 호스트가 동시에 서로 다른 화면을 보고 있을 수 있어
  // 중복 바인딩 방지 플래그도 호스트별로 따로 둔다(bindDesignLinks 와 동일한 이유/패턴).
  let _initBadgesBoundModal = null;
  let _initBadgesBoundTab = null;
  function bindInitBadges(iframe, initMap, hostKind) {
    hostKind = hostKind === 'tab' ? 'tab' : 'modal';
    let doc = null;
    try { doc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document); }
    catch (e) { return; }
    if (!doc || !doc.body) return;
    if (hostKind === 'tab') {
      if (_initBadgesBoundTab === doc) return;
      _initBadgesBoundTab = doc;
    } else {
      if (_initBadgesBoundModal === doc) return;
      _initBadgesBoundModal = doc;
    }
    doc.querySelectorAll('[data-init-id]').forEach(elm => {
      elm.style.cursor = 'pointer';
      elm.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        const id = elm.getAttribute('data-init-id');
        if (!id) return;
        // 요청사항: 같은 IV 뱃지를 다시 누르면(이미 그 필드의 정보가 열려 있는 상태) 팝업을 닫는다
        // (토글) — 매번 새로 열리기만 하고 닫을 방법이 없던 문제.
        const box = el(hostKind === 'tab' ? 'uiTabInitBox' : 'vwInitBox');
        const isOpen = box && box.style.display !== 'none' && box.getAttribute('data-current-id') === id;
        if (isOpen) {
          box.style.display = 'none';
          box.removeAttribute('data-current-id');
          return;
        }
        showInitDetail(id, (initMap && initMap[id]) || [], hostKind);
      });
    });
  }

  // 초기값 정보(kind별) 한 건을 사람이 읽을 수 있는 설명 카드로 렌더.
  function renderInitInfoCard(id, info) {
    const kindLabel = info.kind === 'static' ? '정적 기본값'
      : info.kind === 'literal' ? '로드 스크립트 · 리터럴/계산값'
      : info.kind === 'chain' ? '로드 스크립트 → WF 조회 → 테이블'
      : '알 수 없음';
    const kindCls = info.kind === 'static' ? 'iv-static' : info.kind === 'literal' ? 'iv-lit' : 'iv-chain';
    let body = '';
    if (info.kind === 'static') {
      body = '<div class="kv"><span>값</span><b>' + escHtmlLite(info.expr) + '</b></div>';
    } else {
      body += '<div class="kv"><span>실행 위치</span><b>' + escHtmlLite(info.script || '') + '</b></div>';
      body += '<div class="iv-row"><span class="iv-label">대입식</span><code>' + escHtmlLite(info.expr || '') + '</code></div>';
      if (info.kind === 'chain') {
        body += '<div class="kv"><span>헬퍼 함수</span><b>$pageObjects["' + escHtmlLite(info.helperName || '') + '"]</b></div>';
        if (info.wfUid) {
          const navKey = 'WF:u' + info.wfUid;
          const has = !!store.nodes.get(navKey);
          body += '<div class="kv"><span>호출 WF</span><b>UID ' + escHtmlLite(info.wfUid) + '</b> '
            + '<button class="btn ghost xs iv-goto-wf" data-navkey="' + escHtmlLite(navKey) + '"'
            + (has ? '' : ' disabled title="현재 파도타기 결과에 없음"')
            + '>🔀 WF로 이동</button></div>';
        } else {
          body += '<div class="kv"><span>호출 WF</span><span class="mut">감지 못함(스크립트 패턴이 달라 추정 실패)</span></div>';
        }
        // B_CONFIGURATION_V(REFERENCE='Y') 패턴(getRefValue 류 헬퍼로, majorCd 파라미터를 받는 경우)일
        // 때만 "지금 값 조회"가 가능하다 — 다른 헬퍼/테이블 조합은 이 쿼리로 알아낼 수 없어서다.
        // 패널이 열리자마자 자동으로 한 번 조회해서 바로 보여주고(showInitDetail 쪽에서 트리거),
        // 버튼은 "다시 조회"(재조회/새로고침) 용도로 남겨둔다.
        if (info.paramValues && info.paramValues.majorCd) {
          const labelsAttr = info.optionLabels
            ? escHtmlLite(JSON.stringify(info.optionLabels)).replace(/"/g, '&quot;')
            : '';
          body += '<div class="kv"><span>실제 기준값</span>'
            + '<button class="btn ghost xs iv-fetch-now" data-major-cd="' + escHtmlLite(info.paramValues.majorCd) + '"'
            + (labelsAttr ? ' data-option-labels="' + labelsAttr + '"' : '')
            + '>🔄 다시 조회</button></div>'
            + '<div class="iv-live-result mut" style="font-size:11px">🔄 확인 중…</div>';
        }
        if (info.paramText) {
          body += '<div class="iv-row"><span class="iv-label">요청 파라미터(추정)</span><code>' + escHtmlLite(info.paramText) + '</code></div>';
        }
      }
    }
    const canLiveFetch = info.kind === 'chain' && info.paramValues && info.paramValues.majorCd;
    if (info.optionLabels && Object.keys(info.optionLabels).length) {
      const rows = Object.keys(info.optionLabels).map(v =>
        '<span class="iv-opt"><b>' + escHtmlLite(v) + '</b> → ' + escHtmlLite(info.optionLabels[v]) + '</span>').join('');
      // canLiveFetch 인 경우엔 위 "실제 기준값" 칸이 자동으로 실제 코드를 확인해 보여주므로, 여기선
      // 굳이 "정적으로는 알 수 없다"는 중복 안내를 달지 않는다(그게 오히려 "확인할 수 없다"는
      // 인상을 줘서 혼란스러웠다 — 실제로는 위에서 바로 확인된다).
      const note = canLiveFetch ? ''
        : (info.kind === 'chain'
          ? '실제 어떤 코드가 기준값으로 반환되는지는 정적 분석만으로는 알 수 없습니다(헬퍼 함수 패턴이 달라 자동조회 대상이 아님) — 화면에서 직접 확인하거나 온라인 모드로 위 WF/테이블을 조회해 주세요.'
          : '위 코드가 화면에는 아래 라벨로 보입니다.');
      body += '<div class="iv-row"><span class="iv-label">코드 → 화면 표시값</span>' + rows + '</div>'
        + (note ? '<div class="mut" style="font-size:11px;margin-top:2px">' + escHtmlLite(note) + '</div>' : '');
    }
    if (info.staticDefault !== undefined) {
      body += '<div class="kv"><span>비고</span><span class="mut">정적 default="' + escHtmlLite(String(info.staticDefault)) + '" 도 있으나, 위 로드 스크립트가 이후 다시 덮어쓴다.</span></div>';
    }
    return '<div class="iv-card ' + kindCls + '"><div class="iv-card-head">' + escHtmlLite(kindLabel) + '</div>' + body + '</div>';
  }

  function escHtmlLite(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // 초기값 상세패널(#vwInitBox) 표시/갱신. flowStepBox 와 동일하게 "닫기" 없이 접기/펼치기만 지원 —
  // 화면을 옮기며(다른 배지 클릭) 계속 참고할 일이 많아 항상 화면에 남겨둔다.
  let _initBoxCollapsed = false;
  function showInitDetail(compId, infoArr, hostKind) {
    hostKind = hostKind === 'tab' ? 'tab' : 'modal';
    const box = el(hostKind === 'tab' ? 'uiTabInitBox' : 'vwInitBox');
    if (!box) return;
    box.setAttribute('data-current-id', compId); // 같은 뱃지 재클릭 시 닫기(토글) 판단용
    if (!box.hasAttribute('data-positioned')) {
      const pane = el(hostKind === 'tab' ? 'uiTabDesignPane' : 'vwDesignPane');
      const paneW = (pane && pane.clientWidth) || 900;
      const w = box.offsetWidth || 340;
      box.style.left = Math.max(12, paneW - w - 12) + 'px';
      box.style.right = 'auto';
      box.style.top = '12px';
      box.setAttribute('data-positioned', '1');
    }
    const cards = (infoArr && infoArr.length)
      ? infoArr.map(info => renderInitInfoCard(compId, info)).join('')
      : '<div class="mut" style="padding:8px 0">초기값 정보를 찾지 못했습니다.</div>';
    box.innerHTML = '<div class="fsb-head"><b>🎯 초기값 추적 · ' + escHtmlLite(compId) + '</b>'
      + '<button id="ivbMin" class="fsb-min" title="' + (_initBoxCollapsed ? '펼치기' : '접기') + '">'
      + (_initBoxCollapsed ? '▸ 펼치기' : '▾ 접기') + '</button></div>'
      + '<div class="iv-body">' + cards + '</div>';
    box.classList.toggle('collapsed', _initBoxCollapsed);
    box.style.display = 'flex';
    const minBtn = box.querySelector('#ivbMin');
    if (minBtn) minBtn.addEventListener('click', () => {
      _initBoxCollapsed = !_initBoxCollapsed;
      box.classList.toggle('collapsed', _initBoxCollapsed);
      minBtn.textContent = _initBoxCollapsed ? '▸ 펼치기' : '▾ 접기';
      minBtn.title = _initBoxCollapsed ? '펼치기' : '접기';
    });
    const gotoBtn = box.querySelector('.iv-goto-wf');
    if (gotoBtn && !gotoBtn.disabled) {
      gotoBtn.addEventListener('click', () => {
        const navKey = gotoBtn.getAttribute('data-navkey');
        if (!navKey) return;
        // 모달은 닫고 그래프로 이동(기존 동작 유지). 탭은 닫을 대상이 없으니 WF 뱃지 클릭과 동일하게
        // 그래프에 선택+줌 후 흐름도로 이동한다.
        if (hostKind === 'modal') { closeViewer(); gotoNodeInGraph(navKey); }
        else { focusWfAndShowFlow(navKey); }
      });
    }
    box.querySelectorAll('.iv-fetch-now').forEach(btn => {
      btn.addEventListener('click', () => runConfigRefFetch(btn));
      // 패널이 열리자마자 자동으로 한 번 조회한다 — 사용자가 직접 쿼리로 REFERENCE='Y' 값을
      // 확인할 수 있는 정보라면, 도구도 클릭 없이 바로 보여줘야 "정적으로는 알 수 없다"는
      // 안내와 실제로는 알아낼 수 있다는 사실이 모순되게 느껴지지 않는다.
      runConfigRefFetch(btn);
    });
  }

  // "지금 값 조회"/"다시 조회" 버튼 하나에 대해 실제 조회를 실행하고 같은 카드의 .iv-live-result 에
  // 결과를 반영한다. showInitDetail() 이 패널을 열 때 자동으로 한 번 호출하고, 버튼 클릭 시 재사용된다.
  async function runConfigRefFetch(btn) {
    const majorCd = btn.getAttribute('data-major-cd');
    const card = btn.closest('.iv-card');
    const resultElm = card && card.querySelector('.iv-live-result');
    if (!majorCd || !resultElm) return;
    btn.disabled = true;
    const prevText = btn.textContent;
    btn.textContent = '조회 중…';
    let labels = null;
    try { labels = JSON.parse(btn.getAttribute('data-option-labels') || 'null'); } catch (e) { /* 무시 */ }
    const res = await resolveConfigRefValue(majorCd);
    btn.disabled = false;
    btn.textContent = prevText;
    resultElm.classList.remove('mut', 'iv-live-error', 'iv-live-ok');
    if (!res.ok) {
      const msg = res.reason === 'demo' ? 'DB에 연결되어 있지 않아 조회할 수 없습니다(DB 접속 또는 오프라인 파일 필요) — "다시 조회" 버튼으로 재시도할 수 있습니다.'
        : res.reason === 'no-cfg' ? 'DB 접속 정보가 없습니다.'
        : ('조회 실패: ' + res.reason);
      resultElm.textContent = msg;
      resultElm.classList.add('iv-live-error');
      return;
    }
    if (!res.row) {
      resultElm.textContent = 'B_CONFIGURATION_V 에 MAJOR_CD=' + majorCd + " AND REFERENCE='Y' 행이 없습니다"
        + '(오프라인 모드라면 [데이터 관리]에서 "초기값 기준코드" 테이블을 받았는지 먼저 확인해 주세요).';
      resultElm.classList.add('iv-live-error');
      return;
    }
    const code = res.row.MINOR_CD;
    const label = labels && labels[code];
    const scope = (res.row.TENANT_ID && res.row.TENANT_ID !== '*')
      ? ' <span class="mut">· ' + escHtmlLite(res.row.TENANT_ID) + '/' + escHtmlLite(res.row.CO_CD || '') + '</span>' : '';
    resultElm.innerHTML = '✅ 현재 기준값: <b>' + escHtmlLite(code) + (label ? ' (' + escHtmlLite(label) + ')' : '') + '</b>'
      + (res.row.SEQ_NO != null ? ' <span class="mut">· SEQ_NO=' + escHtmlLite(String(res.row.SEQ_NO)) + '</span>' : '')
      + scope;
    resultElm.classList.add('iv-live-ok');
  }

  // 디자인 미리보기(iframe) 안의 연결 객체(data-navkey)에 클릭 핸들러를 건다.
  // hostKind: 'modal'(코드·디자인 보기 팝업, 기본값) | 'tab'(그래프 왼쪽 새 UI 탭에 도킹된 미리보기).
  // 두 호스트 모두 배지 클릭 동작은 동일해야 한다는 요구사항에 따라 분기만 다르게 태운다:
  // - UI/Mo 뱃지: 그 호스트 "자기 자신" 안에서 바로 그 화면의 디자인으로 전환한다
  //   (흐름도 탭에서 서비스콜/내부흐름을 눌러 이동하는 것과 동일한 감각 — [◀ 뒤로]로 되돌아올 수 있음).
  // - WF 뱃지: 그래프에는 해당 WF를 선택 상태로 남겨두고(되돌아왔을 때 바로 보이도록), 흐름도 탭으로
  //   전환해 그 WF의 흐름도를 바로 보여준다. 모달일 때만 모달을 닫는다(탭은 닫을 대상이 없음).
  // - 그 외(Rp 등)는 기존처럼(모달이면 닫고) 메인 그래프에서 그 노드로 이동한다.
  let _designLinksBoundModal = null;   // 중복 바인딩 방지용(현재 doc 기억) — 모달 인스턴스
  let _designLinksBoundTab = null;     // 〃 — UI 탭 인스턴스
  function bindDesignLinks(iframe, hostKind) {
    hostKind = hostKind === 'tab' ? 'tab' : 'modal';
    let doc = null;
    try { doc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document); }
    catch (e) { return; }   // 접근 불가 시 무시
    if (!doc || !doc.body) return;
    if (hostKind === 'tab') {
      if (_designLinksBoundTab === doc) return;
      _designLinksBoundTab = doc;
    } else {
      if (_designLinksBoundModal === doc) return;
      _designLinksBoundModal = doc;
    }
    const nodes = doc.querySelectorAll('[data-navkey]');
    nodes.forEach(elm => {
      elm.style.cursor = 'pointer';
      const go = (e) => {
        e.preventDefault(); e.stopPropagation();
        const navKey = elm.getAttribute('data-navkey');
        if (!navKey) return;
        // 대상 노드가 그래프에 없으면 안내. 모달(특히 최대화 상태)이나 UI 탭 모두 하단 상태표시줄이
        // 잘 안 보일 수 있어, 해당 호스트 안에도 바로 보이는 토스트를 함께 띄운다 — 그래야 "눌렀는데
        // 아무 반응이 없다"고 오해하지 않는다.
        let target = store.nodes.get(navKey);
        // 리포트 컴포넌트가 별도 z_rp_deploy_info 레코드 없이(또는 있어도 REPORT_JSON 이 비어)
        // 자기 RESOURCE_JSON 안에 reportJsonData 를 통째로 담고 있는 경우(예: "결의전표출력"처럼
        // 화면 자체가 리포트 출력 미리보기 역할만 하는 패턴) — store 조회가 실패하거나(노드 없음)
        // 성공해도 REPORT_JSON 이 비어 있으면, 컴포넌트 자신에 박혀 있던 reportJsonData 로 그
        // 자리에서 "가짜 Rp 노드"를 만들어 보여준다.
        const needsInline = !target || (target.type === 'Rp' && !(target.raw && target.raw.REPORT_JSON));
        if (needsInline) {
          const compId = elm.getAttribute('data-comp-id');
          const inlineMap = hostKind === 'tab' ? _uiTabInlineReportMap : _viewerInlineReportMap;
          const inline = compId && inlineMap[compId];
          if (inline) {
            target = {
              type: 'Rp',
              id: inline.reportProgramId,
              name: inline.reportProgramNm,
              key: 'RpInline:' + compId,
              raw: { REPORT_JSON: inline.reportJson, REPORT_PROGRAM_ID: inline.reportProgramId, REPORT_PROGRAM_NM: inline.reportProgramNm }
            };
            // 상세 패널(showDetail)이 이 노드를 찾을 수 있도록 캐시에만 남긴다 — 진짜 store 에는
            // 넣지 않는다(카운트/그래프/내보내기 오염 방지, 위 _syntheticNodeCache 선언부 참고).
            _syntheticNodeCache.set(target.key, target);
          }
        }
        if (!target) {
          const msg = '연결된 노드(' + navKey + ')가 현재 파도타기 결과에 없습니다. 해당 Wave를 체크하고 다시 실행해 보세요.';
          setStatus(msg, true);
          if (hostKind === 'tab') showUiTabLinkToast(msg); else showViewerLinkToast(msg);
          return;
        }
        if (target.type === 'UI' || target.type === 'Mo' || target.type === 'Rp') {
          // 지금 보고 있던 화면의 key 를 넘겨서, 실제 화면 전환이 확정되면(openViewer/openUiTabNode
          // 내부에서) 이동 이력에 쌓이도록 한다 — [◀ 뒤로]로 되돌아올 수 있다. Rp(리포트)도 UI/Mo와
          // 동일하게 그 호스트 안에서 바로 디자인(레이아웃 미리보기)으로 전환한다.
          if (hostKind === 'tab') openUiTabNode(target, { fromNav: true, cameFrom: _uiTabKey });
          else openViewer(target, { fromNav: true, cameFrom: _viewerKey });
          return;
        }
        if (target.type === 'WF') {
          if (hostKind === 'modal') closeViewer();
          focusWfAndShowFlow(navKey);
          return;
        }
        if (hostKind === 'modal') closeViewer();
        gotoNodeInGraph(navKey);
      };
      elm.addEventListener('click', go);
    });
  }

  let _viewerLinkToastTimer = null;
  function showViewerLinkToast(msg) {
    const t = el('vwLinkToast');
    if (!t) return;
    t.textContent = '⚠ ' + msg;
    t.style.display = 'block';
    if (_viewerLinkToastTimer) clearTimeout(_viewerLinkToastTimer);
    _viewerLinkToastTimer = setTimeout(() => { t.style.display = 'none'; }, 3500);
  }

  function showUiTabLinkToast(msg) {
    const t = el('uiTabLinkToast');
    if (!t) return;
    t.textContent = '⚠ ' + msg;
    t.style.display = 'block';
    if (_uiTabLinkToastTimer) clearTimeout(_uiTabLinkToastTimer);
    _uiTabLinkToastTimer = setTimeout(() => { t.style.display = 'none'; }, 3500);
  }

  // 그래프 왼쪽 "UI" 탭 진입점 — 프로그램 검색 더블클릭 직후, 또는 탭 안에서 UI/Mo 뱃지를 눌러
  // 다른 화면으로 "이동"할 때 호출된다. opts.fromNav 가 없으면(첫 진입) 이동 이력을 초기화하고,
  // opts.cameFrom 이 있으면(뱃지 클릭으로 이동) 그 값을 이력에 쌓아 [◀ 뒤로]로 되돌아올 수 있게 한다.
  function openUiTabNode(n, opts) {
    if (!n) return;
    const raw = n.raw || {};
    const hasDesign = !!(raw.RESOURCE_HTML || raw.RESOURCE_JSON || (n.type === 'Rp' && raw.REPORT_JSON));
    if (!hasDesign) {
      setStatus('표시할 디자인 리소스가 없습니다.', true);
      // fromNav 로 들어온 경우에만(=이미 탭에 뭔가 표시되어 있던 상태) 토스트로 알리고 지금 화면은
      // 그대로 둔다 — openViewer 의 동일한 가드와 같은 이유(이동 이력이 꼬이지 않게).
      if (opts && opts.fromNav) showUiTabLinkToast('표시할 디자인 리소스가 없습니다(' + (n.id || n.key) + ').');
      return;
    }
    if (!(opts && opts.fromNav)) {
      _uiTabNavStack = [];
    } else if (opts.cameFrom) {
      _uiTabNavStack.push(opts.cameFrom);
    }
    _uiTabKey = n.key || null;
    _uiTabRaw = raw;
    _uiTabZoom = 1;
    _uiTabDict = { single: {}, col: {} };
    if (n.type === 'UI' || n.type === 'Mo') {
      loadDdDict(n.id).then(d => {
        _uiTabDict = d || { single: {}, col: {} };
        // 그 사이 사용자가 이 탭에서 다른 화면으로 옮겨가지 않았을 때만 다시 그린다.
        if (_uiTabKey === n.key) renderUiTabDesignFor(n);
      });
    }
    const navHint = _uiTabNavStack.length ? ('◀' + _uiTabNavStack.length + ' · ') : '';
    const titleEl = el('uiTabTitle');
    if (titleEl) titleEl.textContent = navHint + (n.id || n.name || '리소스') + ' — 디자인 보기';
    const backBtn = el('uiTabBack');
    if (backBtn) backBtn.style.display = _uiTabNavStack.length ? '' : 'none';
    // 요청사항: UI 탭에서 다른 UI/Rp로 이동(뱃지 클릭)하거나 [◀ 뒤로]로 되돌아갈 때마다, 우측
    // 상세 패널도 "지금 이 탭에 실제로 표시되는" 노드 정보로 함께 바뀌어야 한다 — 탭 안에서
    // 여러 화면을 오가는 동안 상세 패널이 처음 열었던 화면에 멈춰 있지 않도록.
    showDetail(n.key);
    switchTab('ui');
    renderUiTabDesignFor(n);
  }

  // 실제 렌더링 — renderViewer() 의 "디자인" 분기(Rp 레이아웃 미리보기 / html·json 모드 + 각종
  // 오버레이)와 동일한 로직을 그대로 재사용한다. 다른 점은 딱 하나, 결과를 붓는 그릇이 모달의
  // #vwDesignView 가 아니라 탭의 #uiTabDesignView 라는 것뿐이다.
  function renderUiTabDesignFor(n) {
    const iframe = el('uiTabDesignView');
    const emptyEl = el('uiTabEmpty');
    if (!iframe) return;
    _designLinksBoundTab = null;
    _designTabsBoundTab = null;
    _initBadgesBoundTab = null;
    { const ivBox = el('uiTabInitBox'); if (ivBox) ivBox.style.display = 'none'; } // 다른 화면 정보가 남아있지 않도록 숨김
    const raw = (n && n.raw) || {};
    if (emptyEl) emptyEl.style.display = 'none';
    const toolbar = el('uiTabDesignToolbar');
    const sqlBox = el('uiTabSqlView');
    if (n && n.type === 'Rp') {
      iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts');
      if (toolbar) toolbar.style.display = 'flex';
      if (sqlBox) sqlBox.style.display = _rpqPanelHidden.tab ? 'none' : 'block';
      const reportProgramId = raw.REPORT_PROGRAM_ID;
      const cachedLabels = reportProgramId ? _rpLabelCache[reportProgramId] : null;
      let rpBody = null;
      try { rpBody = raw.REPORT_JSON ? P.buildReportPreviewHtml(raw.REPORT_JSON, cachedLabels) : null; } catch (e) { /* 렌더 불가 */ }
      if (rpBody) {
        const doc = '<!doctype html><html><head><meta charset="utf-8"><style>' + reportPreviewCss() + '</style></head><body>' + rpBody + '</body></html>';
        _uiTabReportDocHtml = doc;
        iframe.srcdoc = doc;
        // 새 문서가 로드되면(레이블 재조회 후 다시 그려질 때도 포함) 확대/축소 배율을 다시 적용한다.
        iframe.onload = () => applyZoomToIframe('tab');
      } else {
        _uiTabReportDocHtml = '';
        iframe.srcdoc = '<body style="font-family:sans-serif;padding:20px;color:#64748b">이 리포트는 레이아웃 미리보기를 지원하지 않습니다(REPORT_JSON 형식을 인식할 수 없음).</body>';
      }
      if (reportProgramId && !cachedLabels) {
        resolveReportHeaderLabels(raw).then((labels) => {
          if (labels && Object.keys(labels).length) {
            _rpLabelCache[reportProgramId] = labels;
            if (_uiTabKey === n.key) renderUiTabDesignFor(n);
          }
        });
      }
      if (raw.REPORT_JSON) renderReportSqlView('tab');
      return;
    }
    if (toolbar) toolbar.style.display = 'none';
    if (sqlBox) { sqlBox.style.display = 'none'; sqlBox.innerHTML = ''; }
    iframe.setAttribute('sandbox', 'allow-same-origin');
    let bodyHtml = null, mode = '';
    const rj = raw.RESOURCE_JSON;
    const initMapForNode = (rj && P.computeInitValueMap) ? P.computeInitValueMap(rj) : {};
    if (raw.RESOURCE_HTML) { bodyHtml = translateHtmlLabels(raw.RESOURCE_HTML, _uiTabDict); mode = 'html'; }
    if (!bodyHtml && rj) {
      try {
        const built = P.buildDesignHtml(rj, raw.RESOURCE_HTML || '', _uiTabDict, (navKey) => store.nodes.get(navKey), initMapForNode, raw.RESOURCE_JS);
        if (built) { bodyHtml = built; mode = 'json'; }
      } catch (e) { /* 렌더 불가 */ }
    }
    _uiTabLinkMap = (mode === 'html' && rj) ? (P.computeLinkMap ? P.computeLinkMap(rj, raw.RESOURCE_JS) : {}) : {};
    _uiTabGridIds = (mode === 'html' && rj && P.collectGridIds) ? P.collectGridIds(rj) : new Set();
    _uiTabGridButtonMap = (mode === 'html' && rj && P.computeGridToolbarButtonList) ? P.computeGridToolbarButtonList(rj) : {};
    _uiTabGridColsMap = (mode === 'html' && rj && P.collectGridOptionsMap) ? P.collectGridOptionsMap(rj) : {};
    _uiTabGridColumnPopupMap = (rj && P.computeGridColumnPopups) ? P.computeGridColumnPopups(rj, raw.RESOURCE_JS) : {};
    _uiTabInlineReportMap = (rj && P.computeInlineReportMap) ? P.computeInlineReportMap(rj) : {};
    _uiTabInitMap = rj ? initMapForNode : {};
    if (bodyHtml) {
      // 검증 메시지는 탭에는 토글 UI가 없으므로 항상 숨김 상태로 고정한다(모달의 기본값과 동일).
      const wrapCls = (mode === 'json' ? 'daaf-preview dz-root' : 'daaf-preview') + ' dz-hide-valmsg';
      const doc = '<!doctype html><html><head><meta charset="utf-8"><style>' + daafPreviewCss() + '</style>'
        + realThemeLinksHtml()
        + '</head><body class="sirius">'
        + '<div class="builder-base ' + wrapCls + '">' + bodyHtml + '</div></body></html>';
      iframe.srcdoc = doc;
      const afterLoad = () => {
        let fdoc = null;
        try { fdoc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document); } catch (e) { /* 무시 */ }
        if (mode === 'html') { try { insertValidationMessages(fdoc, _uiTabDict); } catch (e) { /* 무시 */ } }
        try { applyHtmlLinkOverlay(iframe, _uiTabLinkMap, _uiTabGridIds, _uiTabGridButtonMap, _uiTabGridColsMap, _uiTabGridColumnPopupMap, _uiTabDict.single); } catch (e) { /* 무시 */ }
        if (mode === 'html') { try { applyInitValueOverlay(iframe, _uiTabInitMap); } catch (e) { /* 무시 */ } }
        try { applyValidationMsgOverlay(iframe); } catch (e) { /* 무시 */ }
        try { preventDesignNavigation(iframe); } catch (e) { /* 무시 */ }
        try { bindDesignTabs(iframe, 'tab'); } catch (e) { /* 무시 */ }
        bindDesignLinks(iframe, 'tab');
        try { bindInitBadges(iframe, _uiTabInitMap, 'tab'); } catch (e) { /* 무시 */ }
        try {
          const programId = raw && raw.PROGRAM_ID;
          if (programId && fdoc) {
            if (mode === 'html') {
              (_uiTabGridIds || new Set()).forEach((gid) => {
                const gridElm = fdoc.getElementById(gid);
                if (gridElm) upgradeGridColumnsWithLiveData(fdoc, gridElm, gid, programId, _uiTabDict.single, _uiTabGridColumnPopupMap);
              });
            } else {
              fdoc.querySelectorAll('[data-grid-id]').forEach((gridElm) => {
                const gid = gridElm.getAttribute('data-grid-id');
                if (gid) upgradeGridColumnsWithLiveData(fdoc, gridElm, gid, programId, _uiTabDict.single, _uiTabGridColumnPopupMap);
              });
            }
          }
        } catch (e) { /* 무시 */ }
      };
      iframe.onload = afterLoad;
      setTimeout(afterLoad, 120);
    } else {
      iframe.srcdoc = '<body style="font-family:sans-serif;padding:20px;color:#64748b">이 리소스는 디자인 미리보기를 지원하지 않습니다.</body>';
    }
  }

  // srcdoc(iframe) 안의 <a>는 실제 운영 화면 원본 마크업(탭 버튼 등) 그대로라서, href="#"처럼
  // 빈/상대 경로라도 클릭하면 부모 문서(=우리 앱 index.html) URL 기준으로 해석돼 iframe이
  // 앱의 실제 index.html을 그대로 로드해버리는 문제가 있었다(2026-08-18 확인 — 탭 클릭 시
  // 미리보기 자리에 Daaf Wave 본 화면이 통째로 뜨는 버그). data-navkey 배지(<span>)는 우리가
  // 직접 만든 것이라 영향 없지만, 원본 마크업의 <a>/<form>은 미리보기에서 아무 동작도 하면 안
  // 되므로 클릭·제출을 캡처 단계에서 전부 막는다.
  function preventDesignNavigation(iframe) {
    let doc = null;
    try { doc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document); }
    catch (e) { return; }
    if (!doc || doc.__dzNavGuarded) return;
    doc.__dzNavGuarded = true;
    doc.addEventListener('click', (e) => {
      const a = e.target && e.target.closest && e.target.closest('a[href]');
      if (a) e.preventDefault();
    }, true);
    doc.addEventListener('submit', (e) => { e.preventDefault(); }, true);
  }

  // 미리보기(iframe) 안의 실제 운영 화면 탭(사업자정보/일반정보/... 같은 Bootstrap 스타일
  // <a data-toggle='tab' href='#panelId'> + <div class='tab-pane' id=panelId>)을 진짜로 눌러볼 수
  // 있게 만든다. 원래 화면은 Bootstrap의 tab.js 로 이 전환을 처리하는데, 미리보기에는 실제 JS를
  // 싣지 않으므로(테마 CSS만 로드) 우리가 직접 최소 구현을 해 준다. preventDesignNavigation()이
  // <a href> 기본 동작(=페이지 이탈)은 이미 막아주므로, 여기서는 탭 active/show 클래스 전환만
  // 담당한다.
  let _designTabsBoundModal = null;
  let _designTabsBoundTab = null;
  function bindDesignTabs(iframe, hostKind) {
    hostKind = hostKind === 'tab' ? 'tab' : 'modal';
    let doc = null;
    try { doc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document); }
    catch (e) { return; }
    if (!doc || !doc.body) return;
    if (hostKind === 'tab') {
      if (_designTabsBoundTab === doc) return;
      _designTabsBoundTab = doc;
    } else {
      if (_designTabsBoundModal === doc) return;
      _designTabsBoundModal = doc;
    }
    const navLinks = doc.querySelectorAll('a[data-toggle="tab"]');
    navLinks.forEach((a) => {
      a.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        const href = a.getAttribute('href') || '';
        if (href.charAt(0) !== '#') return;
        const target = doc.getElementById(href.slice(1));
        if (!target) return;
        const tabContent = target.parentElement;      // .tab-content
        const li = a.closest('li');
        const navUl = li ? li.parentElement : null;    // ul.nav (탭 버튼 목록)
        // 같은 탭 그룹(ul.nav)의 버튼들과, 같은 탭 콘텐츠(.tab-content)의 패널들만 끄고
        // 지금 클릭한 것만 켠다 — 중첩 탭이 있어도 서로 안 건드리도록 직계 자식만 스캔.
        // (원본 마크업은 active 클래스를 <a>가 아니라 <li>에 둔다 — 그대로 따른다.)
        if (navUl) {
          Array.prototype.forEach.call(navUl.children, (x) => x.classList && x.classList.remove('active'));
        }
        if (tabContent) {
          Array.prototype.forEach.call(tabContent.children, (p) => {
            if (p.classList && p.classList.contains('tab-pane')) p.classList.remove('active', 'show');
          });
        }
        if (li) li.classList.add('active');
        target.classList.add('active', 'show');
      });
    });
  }

  // 실제 DaaF 런타임에서 로딩되는 진짜 css/images/fonts 사본(theme/ 폴더, 앱과 함께 배포됨)을
  // 디자인 미리보기 iframe 에 링크로 걸어준다. index.html 기준 상대경로이므로
  // srcdoc(iframe)에서도 부모 문서(URL) 기준으로 정상 로드된다.
  // 로드 순서: Bootstrap4(그리드/폼 베이스) → sirius 테마(변수/레이아웃/그리드/스킨 등, theme.css 가 나머지를 @import)
  //          → uni 공통(common/style/components) → uni bootstrap 보정 → builder 보정(.builder-base 스코프)
  function realThemeLinksHtml() {
    const files = [
      'theme/vendor/bootstrap.min.css',
      'theme/css/themes/sirius/theme.css',
      'theme/css/uni/common.css',
      'theme/css/uni/style.css',
      'theme/css/uni/components.css',
      'theme/css/uni/bootstrap-custom.css',
      'theme/css/uni/builder.css'
    ];
    return files.map(f => '<link rel="stylesheet" href="' + f + '">').join('');
  }

  // ActiveReportsJS RDLX-JSON "레이아웃 추정 미리보기" 전용 CSS. UI/Mo 쪽 daafPreviewCss() 와는
  // 완전히 별개(테마 CSS 로드 없이 self-contained) — 리포트는 절대좌표 기반이라 접근 방식이 다르다.
  function reportPreviewCss() {
    return [
      '*{box-sizing:border-box}',
      'body{margin:0;background:#e2e8f0;font-family:"Malgun Gothic","맑은 고딕",sans-serif;padding:20px}',
      '.rp-guess-banner{max-width:900px;margin:0 auto 14px;background:#fff3d6;border:1px solid #f3d9a0;color:#8a5a00;',
      '  font-size:12px;padding:8px 12px;border-radius:6px}',
      // overflow:hidden 이면 안의 아이템들이 전부 position:absolute 라 페이지 높이 계산에 안 잡혀
      // (자식이 전부 absolute 인 relative 부모는 자동으로 늘어나지 않음) min-height 를 넘어서는
      // 내용(표의 그룹 헤더/푸터 등)이 그대로 잘려 보이지 않게 되는 문제가 있었다. 페이지 높이는
      // 아래 estimateTableHeightR() 로 최대한 정확히 미리 계산해 min-height 에 반영하지만, 그래도
      // 어긋나는 경우를 대비해 자르지 않고 그대로 보이게 둔다(내용 유실보다 약간 삐져나오는 편이 낫다).
      '.rp-page{background:#fff;margin:0 auto 24px;box-shadow:0 1px 8px rgba(0,0,0,.18);position:relative}',
      '.rp-textbox{overflow:hidden;box-sizing:border-box;white-space:pre-wrap;color:#334155}',
      '.rp-image{overflow:hidden;box-sizing:border-box;display:flex;align-items:center;justify-content:center;',
      '  background:#f1f5f9;color:#94a3b8;font-size:12px;border:1px dashed #cbd5e1;text-align:center}',
      // 실제 이미지(base64/embedded/외부 URL)를 렌더링할 때는 placeholder 박스 스타일(점선 테두리/회색 배경)을 벗긴다.
      '.rp-image.rp-image-real{background:none;border:none}',
      '.rp-table-wrap{box-sizing:border-box}',
      'table.rp-table{border-collapse:collapse;width:100%;table-layout:fixed}',
      // 기본 테두리를 여기서 강제로 넣지 않는다 — 실제 리포트는 셀마다 테두리 유무/색/두께가
      // 제각각이고(예: 제목/공지 줄은 의도적으로 테두리가 없음), 그 정보는 각 셀의 인라인
      // style(styleOfR)로 이미 정확히 반영된다. 여기서 일괄 테두리를 넣으면 테두리 없는 셀까지
      // 전부 박스로 둘러싸여 실제 모양과 달라진다.
      'table.rp-table td,table.rp-table th{box-sizing:border-box;overflow:hidden;word-break:break-all}',
      '.rp-details{background:#fffef2}',
      '.rp-repeat-note td{text-align:center;color:#b45309;font-size:11px;background:#fff8e6;padding:4px;font-style:italic;border:none}'
    ].join('\n');
  }

  // DaaF 화면 미리보기용 CSS. 대상 화면은 Bootstrap 12칸 그리드(row/col-*)를
  // 사용하므로, 실제처럼 가로 배치되도록 그리드 + 폼 스타일을 직접 포함한다.
  // (아래는 실제 테마 css 로드에 실패했을 때를 대비한 안전망 성격의 근사(近似) 스타일 —
  //  실제 theme css 가 나중에 로드되어 동일 우선순위 규칙은 덮어쓴다)
  function daafPreviewCss() {
    return [
      '*{box-sizing:border-box}',
      'body{font-family:"Malgun Gothic","맑은 고딕",sans-serif;font-size:13px;color:#1e293b;margin:0;padding:16px;background:#fff}',
      '.daaf-preview{max-width:100%}',
      // --- Bootstrap 그리드 핵심 ---
      '.row{display:flex;flex-wrap:wrap;margin-right:-8px;margin-left:-8px}',
      '.row>[class^="col"],.row>[class*=" col"]{padding-right:8px;padding-left:8px}',
      '.col{flex:1 0 0%}',
      // search-group: 라벨(위) + 입력(아래) 세로 쌍, col 안에서 가로로 나열됨
      '.search-group{display:flex;flex-direction:column}',
      '.search-tit{display:block;font-weight:600;margin:0 0 3px;font-size:12px;color:#334155}',
      '.search-tit.required:after,label.required:after,.required label:after{content:" *";color:#ef4444}',
      // flex-wrap:wrap 이어야 검증 메시지(.dz-valmsg, width:100%)가 입력창을 밀어내지 않고
      // 아래 줄로 자연스럽게 감싸진다(기본 nowrap 이면 같은 줄에서 입력창을 찌부러뜨림).
      '.form-group{display:flex;flex-wrap:wrap;align-items:center;gap:4px}',
      '.form-group>div{flex:1}',
      '.search-group .form-control,.form-group .form-control{width:100%}',
      '.hide,.d-none{display:none!important}',
      // 12칸 비율 (xl/lg/md/sm 모두 동일 비율로 근사)
      (function () {
        let s = '';
        for (let i = 1; i <= 12; i++) {
          const w = (i / 12 * 100).toFixed(6) + '%';
          s += '.col-' + i + ',.col-xl-' + i + ',.col-lg-' + i + ',.col-md-' + i + ',.col-sm-' + i
            + '{flex:0 0 ' + w + ';max-width:' + w + '}';
        }
        return s;
      })(),
      // --- 폼 컨트롤 ---
      '.form-control,.form-control-sm,input[type=text],input:not([type]),select,textarea{display:block;width:100%;border:1px solid #cbd5e1;border-radius:6px;padding:5px 8px;font-size:12.5px;background:#fff;height:30px}',
      'textarea{height:auto;min-height:54px}',
      'label{display:block;font-weight:600;margin:0 0 3px;font-size:12px;color:#334155}',
      // 라벨 옆 필수표시(*) 빨강
      'label .required,.required-group label:after,label.required:after{color:#ef4444}',
      // 행 간격
      '.builder-form-row,.form-row{margin-bottom:10px}',
      // --- 버튼 ---
      // inline-flex + gap 로 바꿔서, 아이콘 전용 버튼에 WF/UI 연결 배지가 덧붙는 경우
      // 아이콘과 배지가 겹치지 않고 나란히 배치되도록 한다(기존엔 고정 height 만 있어 겹쳐 보였음).
      'button,.btn,.btn-form,.btn-popup,.btn-search,.builder-button{display:inline-flex;align-items:center;gap:4px;border:1px solid #cbd5e1;background:#f1f5f9;border-radius:6px;padding:5px 10px;margin:2px;cursor:pointer;font-size:12px;color:#334155;min-height:30px;white-space:nowrap}',
      '.btn-footer-standard,.btn-search{background:#0f9d58;color:#fff;border-color:#0f9d58}',
      // --- input-group (검색 아이콘 등) ---
      '.input-group-custom,.input-group{display:flex;flex-wrap:wrap;align-items:stretch;gap:4px}',
      '.input-group-custom .form-control,.input-group .form-control{flex:1}',
      // 콤보/자동완성 위젯이 런타임에 그려지는 자리표시자(예: id="xxxCombo", data-target-id 보유).
      // 정적 미리보기에선 내용이 비어있어 높이가 0으로 찌부러지고, 거기 붙는 WF 연결 배지만
      // 덩그러니 남아 다른 요소와 겹쳐 보였다 — 실제 입력창처럼 최소 높이/테두리를 줘서
      // 하나의 박스로 명확히 보이게 한다.
      '[data-target-id]{display:flex;align-items:center;flex:1;min-width:80px;min-height:30px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;padding:0 8px;box-sizing:border-box}',
      // --- 그리드(표) 영역 ---
      'table{border-collapse:collapse;width:100%;margin-top:4px}',
      'td,th{border:1px solid #cbd5e1;padding:5px 8px;font-size:12px}',
      'th,.tit-grid{background:#f8fafc;font-weight:700;text-align:left}',
      // --- 섹션/구분선 ---
      '.border-line{border-top:1px solid #e2e8f0;margin:12px 0}',
      '.page-wrapper{padding:4px}',
      '.content-wrapper{padding:0}',
      '.search-wrap{border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin-bottom:12px;background:#fafcff}',
      // collapse: 미리보기에서는 펼쳐서 표시
      '.collapse{display:block!important}',
      // 라디오/체크
      '.input-radio,input[type=radio],input[type=checkbox]{width:auto;height:auto;display:inline-block;margin-right:4px}',
      // 폰트 아이콘 자리(fa) 숨김 처리(깨진 네모 방지)
      '.fa,.fa-fw{display:inline-block;width:14px;color:#94a3b8}',
      // 값 없는 셀렉트 placeholder 느낌
      'select{color:#334155;background:#fff}',
      // 콤보 placeholder(빈 div[id$=Combo], data-target-id) 를 입력칸처럼 보이게
      '[id$="Combo"],[data-target-id]{display:block;min-height:30px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;position:relative}',
      '[id$="Combo"]:after,[data-target-id]:after{content:"▾";position:absolute;right:8px;top:6px;color:#94a3b8}',
      // ===== 실제 RESOURCE_HTML(html 모드)의 진짜 Bootstrap nav-tabs 보정 =====
      // RESOURCE_HTML 은 실제 운영 마크업을 그대로 쓰므로 이 프리뷰 iframe 전체가 .builder-base
      // 스코프로 감싸져 있는데, realThemeLinksHtml() 로 함께 로드하는 builder.css 가 같은 .nav-link
      // 클래스명을 빌더 자체 UI(아이콘 팔레트 등, 아이콘 위·라벨 아래로 좁게 쌓는 스타일)에도 재사용해
      // 화면의 진짜 서브탭(신청대상/상신내역/미신청 등)까지 그 스타일을 물려받아 버린다 — 탭 폭이
      // 극도로 좁아져 한글 라벨이 음절 단위로 세로 줄바꿈되는 증상(DB 모드에서만 보였던 문제)의 원인.
      // 로드 순서에 기대지 않고 항상 이기도록 !important 로 레이아웃 핵심 속성만 강제한다.
      '.nav-tabs,ul.nav-tabs{display:flex!important;flex-direction:row!important;flex-wrap:wrap!important;list-style:none!important;margin:0!important;padding:0!important}',
      '.nav-tabs>.nav-item,.nav-tabs .nav-item{display:flex!important;flex-direction:row!important;white-space:nowrap!important}',
      '.nav-tabs .nav-link,.nav-tabs a.nav-link{display:flex!important;flex-direction:row!important;align-items:center!important;gap:5px!important;white-space:nowrap!important;width:auto!important;height:auto!important}',
      // 실제 마크업은 <li class="nav-item nav-link ..."><a data-toggle="tab">아이콘 라벨</a></li> 처럼
      // <a> 자체엔 클래스가 없는 경우가 흔하다 — 위 클래스 기반 규칙만으론 <a> 내부(아이콘+라벨)가
      // 여전히 좁게 눌릴 수 있어, .nav-tabs 안의 <a> 는 태그 선택자로 한 번 더 강제한다.
      '.nav-tabs li>a{display:inline-flex!important;flex-direction:row!important;align-items:center!important;gap:5px!important;white-space:nowrap!important}',
      // ===== 하단 버튼부(footer) 스크롤 시 화면 맨 밑에 붙도록 고정 =====
      // 실제 운영 화면은 .page-footer-wrapper{position:absolute; bottom:0}로 하단 고정하는데, 이건
      // .content-wrapper 등 특정 조상이 스크롤 컨테이너로 잡혀 있어야만 제대로 동작한다(실제 앱은
      // :has() 선택자로 그 조상에 자동으로 padding-bottom 도 함께 줘서 내용과 안 겹치게 해 둠).
      // 이 미리보기는 그런 조상 구조를 그대로 재현하지 않아 absolute 의 기준점이 엉뚱한 위치(문서
      // 전체 높이 기준)로 잡혀, 스크롤을 내리면 버튼부가 중간 내용 위에 둥둥 떠 보이는 원인이 됐다.
      // position:sticky 는 별도 조상 설정 없이도 "정상 흐름에 자리를 차지하다가 화면 밖으로 나가려는
      // 순간 바닥에 붙는" 동작이라 내용과 겹칠 일이 없다 — !important 로 로드 순서와 무관하게 강제한다.
      'body.sirius .page-footer-wrapper{position:sticky!important;top:auto!important;left:auto!important;bottom:0!important;margin-top:14px!important;background:#fff!important;border-top:solid 1px #dfdfdf!important;z-index:11!important}',
      // ===== JSON 컴포넌트 트리 기반 디자인(dz-*) =====
      '.dz-root{padding:4px}',
      '.dz-form{padding:8px 0}',
      '.dz-search{border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin-bottom:12px;background:#fafcff}',
      '.dz-row{display:flex;flex-wrap:wrap;gap:14px;margin:6px 0;align-items:flex-end}',
      '.dz-row.dz-border{border-top:1px solid #e8edf3;padding-top:12px;margin-top:4px}',
      '.dz-col{flex:1 1 0;min-width:120px;display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end}',
      '.dz-container{display:flex;flex-wrap:wrap;gap:10px;width:100%}',
      // ===== 서브탭 네비게이션(신청대상/상신내역/미신청 등, JSON tabContainer) =====
      // 클릭 전환은 구현하지 않고(다른 dz-* 섹션과 동일 방침) 모든 탭 내용을 펼쳐서 보여주되,
      // 탭 이름/아이콘 자체는 실제 화면처럼 가로 스트립으로 명확히 보이게 한다. white-space:nowrap +
      // flex-direction:row 를 명시해 좁은 폭에서 한글 라벨이 음절 단위로 세로 줄바꿈되는 것을 막는다
      // (실제 RESOURCE_HTML 모드의 Bootstrap nav-tabs 렌더링에서 실제로 겪은 문제와 동일한 예방 조치).
      '.dz-tabcontainer{width:100%;margin:10px 0}',
      '.dz-tabs{display:flex;flex-direction:row;flex-wrap:wrap;gap:4px;border-bottom:2px solid #e2e8f0;margin-bottom:10px}',
      '.dz-tab{display:flex;flex-direction:row;align-items:center;gap:5px;white-space:nowrap;padding:7px 14px;font-size:12.5px;font-weight:600;color:#64748b;border-bottom:2px solid transparent;margin-bottom:-2px}',
      '.dz-tab .fa{color:inherit;width:auto}',
      '.dz-tab-active{color:#0f9d58;border-bottom-color:#0f9d58}',
      '.dz-tab-panel{margin-bottom:14px;padding:10px;border:1px solid #eef2f7;border-radius:8px;background:#fbfdff}',
      '.dz-tab-panel-head{font-weight:700;font-size:12.5px;color:#334155;margin-bottom:8px;display:flex;align-items:center;gap:5px}',
      '.dz-field{display:flex;flex-direction:column;gap:3px;flex:1 1 auto;min-width:110px}',
      '.dz-field label{font-size:12px;font-weight:600;color:#334155;white-space:nowrap}',
      '.dz-field .req{color:#ef4444;margin-left:2px}',
      '.req{color:#ef4444;margin-left:2px}',
      // ===== 뱃지(WF/UI/IV/숨김)는 라벨 텍스트 오른쪽에 붙인다 =====
      // (요청사항: 컴포넌트 안(컨트롤 박스 안쪽)에 넣은 뱃지가 마음에 안 든다 — 그리드를 제외한
      // 모든 컴포넌트는 라벨 우측으로) — json 모드(renderComp)와 html 모드(applyHtmlLinkOverlay)
      // 양쪽 다 라벨을 찾아 그 안에 이 클래스로 뱃지를 이어붙인다. 라벨을 못 찾는 극히 드문 경우의
      // 안전망으로 .dz-badge-host/.dz-badge-overlay(컨트롤 안쪽 오버레이 방식)는 그대로 남겨둔다.
      '.dz-label-badges{display:inline-flex;align-items:center;gap:3px;margin-left:6px;vertical-align:middle}',
      '.dz-label-badges .dz-link-tag{margin-left:0}',
      '.dz-badge-host{position:relative}',
      '.dz-ctrl{width:100%}',
      '.dz-badge-overlay{position:absolute;top:50%;left:6px;transform:translateY(-50%);display:flex;align-items:center;gap:3px;z-index:3;pointer-events:auto;max-width:calc(100% - 12px);overflow:hidden}',
      '.dz-badge-overlay .dz-link-tag,.dz-badge-overlay .dz-hidden-tag{margin-left:0;flex:0 0 auto}',
      // 버튼 안에 자연스러운 내용으로 이어붙는 뱃지(그리드 툴바 버튼과 동일한 방식) — 절대배치가
      // 아니라 버튼 자체가 내용에 맞춰 커지므로, 아이콘만 있는 작은 팝업 버튼에서도 밖으로 삐져
      // 나오지 않는다.
      '.dz-badge-inline{display:inline-flex;align-items:center;gap:3px;margin-left:6px;vertical-align:middle}',
      '.dz-badge-inline .dz-link-tag{margin-left:0}',
      '.dz-inp{border:1px solid #cbd5e1;border-radius:6px;height:30px;padding:4px 8px;font-size:12.5px;background:#fff;width:100%}',
      '.dz-sel{border:1px solid #cbd5e1;border-radius:6px;height:30px;padding:4px 8px;font-size:12.5px;background:#fff;display:flex;align-items:center;justify-content:space-between;color:#94a3b8;min-width:90px}',
      '.dz-sel i{font-style:normal;color:#94a3b8}',
      '.dz-date{border:1px solid #cbd5e1;border-radius:6px;height:30px;padding:4px 8px;font-size:12.5px;background:#fff;display:flex;align-items:center;justify-content:space-between;color:#94a3b8;min-width:120px}',
      '.dz-date i{font-style:normal}',
      '.dz-radios{display:flex;gap:12px;align-items:center;height:30px}',
      '.dz-radio{font-size:12.5px;color:#334155;font-weight:400;display:flex;align-items:center;gap:3px}',
      '.dz-btn{border:1px solid #cbd5e1;background:#f1f5f9;border-radius:6px;height:30px;padding:4px 14px;font-size:12px;color:#334155;white-space:nowrap;cursor:default;align-self:flex-end}',
      '.dz-heading{font-size:13px;font-weight:700;color:#0f172a;padding:8px 0 4px;border-bottom:2px solid #e8edf3;margin:8px 0 4px;width:100%}',
      '.dz-text{font-size:12.5px;color:#475569;align-self:center}',
      '.dz-grid{border:1px solid #cbd5e1;border-radius:8px;margin:10px 0;min-height:120px;background:#fff}',
      '.dz-grid-head{background:#f8fafc;border-bottom:1px solid #cbd5e1;padding:8px 12px;font-size:12px;font-weight:700;color:#475569;border-radius:8px 8px 0 0}',
      // ===== 그리드 컬럼 표(z_grid_columns/z_grid_options 기반 헤더+뱃지+샘플 행 재현) =====
      // 이 표(및 뱃지)의 실제 스타일은 parser.js buildGridColumnsTableHtml() 안에서 전부 인라인
      // style 로 직접 넣는다(실제 운영 테마 CSS가 나중에 로드되어 동률 클래스 규칙을 덮어쓸 수 있어,
      // 뱃지가 컬럼 경계 밖으로 어긋나 보이는 문제를 원천적으로 피하기 위함). 여기 CSS 클래스는
      // 없고 .dz-grid-cols-wrap 은 app.js 쪽 중복삽입 방지 마커로만 쓰인다.
      // ===== 그리드 툴바(행추가/취소/복사/저장 + 품목참조 등 커스텀 버튼) =====
      '.dz-grid-toolbar{display:flex;flex-wrap:wrap;gap:6px;padding:8px 12px;border-bottom:1px solid #e2e8f0;background:#fff}',
      '.dz-grid-toolbar .dz-btn{height:26px;padding:3px 10px;font-size:11.5px}',
      '.dz-report{border:1px dashed #cbd5e1;border-radius:8px;padding:16px;text-align:center;color:#64748b;font-size:12.5px;margin:10px 0;background:#fafcff}',
      // ===== 추가 컴포넌트 타입(체크박스/텍스트영역/트리/파일/차트 등) =====
      '.dz-checkbox{display:inline-flex;align-items:center;height:30px}',
      '.dz-checkbox input{width:auto;margin:0}',
      '.dz-textarea{border:1px solid #cbd5e1;border-radius:6px;padding:6px 8px;font-size:12.5px;background:#fff;width:100%;resize:none;color:#94a3b8}',
      '.dz-daterange{border:1px solid #cbd5e1;border-radius:6px;height:30px;padding:4px 8px;font-size:12.5px;background:#fff;display:flex;align-items:center;gap:6px;color:#94a3b8;min-width:190px}',
      '.dz-daterange i{font-style:normal}',
      '.dz-daterange .dz-date-ico{margin-left:auto}',
      '.dz-tree{border:1px solid #cbd5e1;border-radius:8px;margin:10px 0;background:#fff;min-height:100px}',
      '.dz-tree-head{background:#f8fafc;border-bottom:1px solid #cbd5e1;padding:8px 12px;font-size:12px;font-weight:700;color:#475569;border-radius:8px 8px 0 0}',
      '.dz-tree-body{padding:8px 12px;font-size:12.5px;color:#64748b}',
      '.dz-tree-row{padding:3px 0}',
      '.dz-tree-row.dz-tree-indent{padding-left:16px}',
      '.dz-hyperlink{font-size:12.5px;color:#2563eb;text-decoration:underline;align-self:center}',
      '.dz-image{border:1px dashed #cbd5e1;border-radius:8px;padding:20px;text-align:center;color:#94a3b8;font-size:12.5px;margin:8px 0;background:#fafcff}',
      '.dz-icon{font-size:13px;align-self:center}',
      '.dz-badge{display:inline-block;font-size:11px;font-weight:700;color:#fff;background:#64748b;border-radius:10px;padding:2px 9px;align-self:center}',
      '.dz-hr{width:100%;border:none;border-top:1px solid #e2e8f0;margin:8px 0}',
      '.dz-vr{display:inline-block;width:1px;align-self:stretch;background:#e2e8f0;margin:0 6px}',
      '.dz-file{border:1px solid #cbd5e1;border-radius:6px;height:30px;padding:4px 8px;font-size:12.5px;background:#fff;display:flex;align-items:center;gap:8px;color:#94a3b8;min-width:160px}',
      '.dz-file-btn{border:1px solid #cbd5e1;background:#f1f5f9;border-radius:5px;font-size:11px;padding:2px 8px;color:#334155;margin-left:auto}',
      '.dz-html{border:1px dashed #cbd5e1;border-radius:8px;padding:10px 14px;color:#94a3b8;font-size:12px;margin:8px 0;background:#fafcff}',
      '.dz-editor{border:1px solid #cbd5e1;border-radius:6px;overflow:hidden;width:100%;background:#fff}',
      '.dz-editor-toolbar{background:#f8fafc;border-bottom:1px solid #e2e8f0;padding:5px 8px;font-size:11px;color:#94a3b8;display:flex;gap:8px}',
      '.dz-editor-body{min-height:70px}',
      '.dz-chart{border:1px dashed #cbd5e1;border-radius:8px;padding:24px;text-align:center;color:#64748b;font-size:12.5px;margin:10px 0;background:#fafcff}',
      '.dz-bnb{font-size:11.5px;color:#94a3b8;padding:4px 0;width:100%}',
      '.dz-tnb{background:#0f172a;color:#fff;font-size:12px;font-weight:600;padding:8px 14px;border-radius:6px;width:100%;margin-bottom:8px}',
      // ===== 숨김 컨트롤 강제표시 =====
      '.dz-hidden{opacity:.55}',
      '.dz-hidden-tag{display:inline-block;font-size:9px;font-weight:700;color:#fff;background:#94a3b8;border-radius:4px;padding:0 5px;margin-left:5px;vertical-align:middle}',
      // ===== 연결(link) 컨트롤: WF/UI/리포트와 엮인 객체 =====
      '.dz-linked{cursor:pointer;outline:1.5px solid transparent;border-radius:6px;transition:.1s}',
      '.dz-linked:hover{outline-color:#2563eb;background:#eff6ff}',
      'button.dz-btn.dz-linked:hover{background:#dbeafe;border-color:#2563eb}',
      '.dz-link-tag{display:inline-block;font-size:9px;font-weight:800;color:#fff;border-radius:4px;padding:0 5px;margin-left:5px;vertical-align:middle;cursor:pointer}',
      '.dz-link-tag.lk-wf{background:#12a150}',
      '.dz-link-tag.lk-ui{background:#1f6fd6}',
      '.dz-link-tag.lk-rp{background:#e08e0b}',
      '.dz-link-tag.dz-link-custom{border:1px dashed #fff}',
      // ===== 초기값(IV) 배지: 정적/리터럴/체인 3종류를 색으로 구분 =====
      // static(정적 default 그대로) < literal(로드 스크립트가 리터럴/계산값 대입) < chain(스크립트→WF→테이블,
      // 사람이 직접 찾기 가장 어려운 케이스)로 갈수록 진한 보라색을 쓴다.
      '.dz-link-tag.dz-init-tag{background:#8b5cf6}',
      '.dz-link-tag.dz-init-static{background:#a78bfa}',
      '.dz-link-tag.dz-init-lit{background:#7c3aed}',
      '.dz-link-tag.dz-init-chain{background:#5b21b6}',
      '.dz-report.dz-linked{border-style:solid;border-color:#e08e0b}',
      '.dz-tree.dz-linked{border-style:solid;border-color:#2563eb}',
      '.dz-chart.dz-linked{border-style:solid;border-color:#e08e0b}',
      // ===== 실제 그리드(Wijmo 등) placeholder 박스 =====
      // RESOURCE_HTML 단계에선 빈 <div id="..">로만 내려오므로(실제 위젯은 런타임 JS가 그림),
      // 실제 그리드로 확인된 요소에 최소한의 박스/헤더를 씌워 "그리드 영역"임을 알아볼 수 있게 한다.
      '.dz-grid-box{display:block;min-height:64px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;position:relative;padding-top:26px;margin:8px 0}',
      '.dz-grid-box:before{content:attr(data-grid-label);position:absolute;top:0;left:0;right:0;background:#f8fafc;border-bottom:1px solid #cbd5e1;border-radius:8px 8px 0 0;padding:5px 10px;font-size:12px;font-weight:700;color:#475569;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dz-grid-box .dz-link-tag{margin:4px 0 0 6px}',
      // ===== 하단 버튼부(footer) =====
      '.dz-footer{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;align-items:center;padding:12px 4px 4px;border-top:2px solid #e2e8f0;position:sticky;bottom:0;background:#fff;margin-top:16px}',
      '.dz-footer .dz-btn{align-self:center;min-width:64px;justify-content:center}',
      '.dz-footer .dz-field{flex:0 0 auto;min-width:0}',
      // ===== 필수입력/유효성 검증 메시지(기본 숨김, 토글로 표시) =====
      // insertValidationMessages/applyValidationMsgOverlay 가 붙여주는 .dz-valmsg 요소를,
      // 상위에 .dz-hide-valmsg 클래스가 있을 때만 숨긴다. width:100% 로 flex 행에서 항상
      // 새 줄로 감싸지게 해 입력창을 밀어내지 않는다(부트스트랩 invalid-feedback과 동일한 방식).
      '.dz-hide-valmsg .dz-valmsg{display:none!important}',
      '.dz-valmsg{display:block;width:100%;flex-basis:100%;margin-top:3px;color:#ef4444;font-size:11px;line-height:1.4}'
    ].join('');
  }

  function closeViewer() {
    el('viewerModal').style.display = 'none'; el('vwDesignView').srcdoc = '';
    const t = el('vwLinkToast'); if (t) t.style.display = 'none';
  }

  function toggleMaximizeViewer() {
    const boxEl = el('viewerModal').querySelector('.viewer-box');
    const on = boxEl.classList.toggle('maximized');
    const btn = el('viewerMax');
    btn.textContent = on ? '❐' : '▢';
    btn.title = on ? '이전 크기로' : '최대화';
    if (on) {
      // 최대화 시엔 드래그 위치 해제(가운데 정렬 복귀)
      boxEl.classList.remove('dragged');
      boxEl.style.left = ''; boxEl.style.top = '';
    } else if (_viewerSize) {
      // 최대화 해제 시 사용자가 조절해둔 크기가 있으면 복원
      boxEl.style.width = _viewerSize.w + 'px';
      boxEl.style.height = _viewerSize.h + 'px';
    }
  }

  let _viewerSize = null;   // 사용자가 드래그로 조절한 크기 기억

  // 좌측(검색)/우측(상세) 패널 너비를 드래그로 조절한다. .grid 는 CSS 변수(--left-w/--right-w)로
  // 컬럼 폭을 잡아두었고(styles.css), 여기서는 그 변수 값만 갱신하면 된다. 다음 실행에도 이어서
  // 쓸 수 있도록 localStorage 에 저장해 두고, 시작 시 복원한다.
  const PANE_W_MIN = 200, PANE_W_MAX = 640;
  const PANE_W_KEY = 'daafWave.paneWidths';
  function setupPaneResizers() {
    const gridEl = document.querySelector('main.grid');
    if (!gridEl) return;
    // 저장된 너비 복원(없으면 CSS 기본값 300px 그대로 사용)
    try {
      const saved = JSON.parse(localStorage.getItem(PANE_W_KEY) || 'null');
      if (saved && saved.left) gridEl.style.setProperty('--left-w', saved.left + 'px');
      if (saved && saved.right) gridEl.style.setProperty('--right-w', saved.right + 'px');
    } catch (e) { /* 무시 */ }

    const persist = () => {
      try {
        const cs = getComputedStyle(gridEl);
        localStorage.setItem(PANE_W_KEY, JSON.stringify({
          left: parseInt(cs.getPropertyValue('--left-w'), 10) || 300,
          right: parseInt(cs.getPropertyValue('--right-w'), 10) || 300
        }));
      } catch (e) { /* 무시 */ }
    };

    // side: 'left'(검색 영역, 드래그하면 왼쪽 폭이 늘어남) | 'right'(상세 영역, 드래그하면
    // 오른쪽으로 갈수록 폭이 줄어듦 — 즉 커서 이동 방향과 폭 변화 방향이 반대).
    const bindResizer = (handleId, cssVar, side) => {
      const handle = el(handleId);
      if (!handle) return;
      let dragging = false, sx = 0, sw = 0;
      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        dragging = true;
        sx = e.clientX;
        sw = parseInt(getComputedStyle(gridEl).getPropertyValue(cssVar), 10) || 300;
        handle.classList.add('dragging');
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'col-resize';
        // 드래그 중 iframe(디자인 미리보기 등)이 마우스 이벤트를 가로채 드래그가 끊기지 않도록.
        document.querySelectorAll('iframe').forEach(f => { f.style.pointerEvents = 'none'; });
      });
      window.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const dx = e.clientX - sx;
        const w = Math.min(PANE_W_MAX, Math.max(PANE_W_MIN, sw + (side === 'left' ? dx : -dx)));
        gridEl.style.setProperty(cssVar, w + 'px');
      });
      window.addEventListener('mouseup', () => {
        if (!dragging) return;
        dragging = false;
        handle.classList.remove('dragging');
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        document.querySelectorAll('iframe').forEach(f => { f.style.pointerEvents = ''; });
        persist();
      });
    };
    bindResizer('leftResizer', '--left-w', 'left');
    bindResizer('rightResizer', '--right-w', 'right');
  }

  function setupViewerResize() {
    const boxEl = el('viewerModal').querySelector('.viewer-box');
    const handle = el('viewerResize');
    let resizing = false, sx = 0, sy = 0, sw = 0, sh = 0;
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault(); e.stopPropagation();
      resizing = true;
      const r = boxEl.getBoundingClientRect();
      sx = e.clientX; sy = e.clientY; sw = r.width; sh = r.height;
      document.body.style.userSelect = 'none';
      // 리사이즈 중 iframe 이 마우스 이벤트를 가로채지 않도록
      const ifr = el('vwDesignView'); if (ifr) ifr.style.pointerEvents = 'none';
    });
    window.addEventListener('mousemove', (e) => {
      if (!resizing) return;
      const w = Math.max(420, sw + (e.clientX - sx));
      const h = Math.max(300, sh + (e.clientY - sy));
      boxEl.style.width = w + 'px';
      boxEl.style.height = h + 'px';
      boxEl.style.maxWidth = 'none';
      _viewerSize = { w, h };
    });
    window.addEventListener('mouseup', () => {
      if (resizing) {
        resizing = false; document.body.style.userSelect = '';
        const ifr = el('vwDesignView'); if (ifr) ifr.style.pointerEvents = '';
      }
    });
  }

  // 제목 표시줄(modal-head)을 드래그해서 창 이동.
  // 모달은 flex 로 가운데 정렬돼 있으므로, 드래그 시작 시 현재 위치를 절대좌표로 고정한 뒤 이동한다.
  function setupViewerDrag() {
    const boxEl = el('viewerModal').querySelector('.viewer-box');
    const head = el('viewerModal').querySelector('.modal-head');
    if (!head) return;
    let dragging = false, sx = 0, sy = 0, startLeft = 0, startTop = 0;
    head.addEventListener('mousedown', (e) => {
      // 버튼/셀렉트/탭 등 조작 요소에서는 드래그 시작 안 함
      if (e.target.closest('button, select, input, .viewer-switch')) return;
      if (e.button !== 0) return;                    // 좌클릭만
      if (boxEl.classList.contains('maximized')) return; // 최대화 상태에선 이동 비활성
      e.preventDefault();
      const r = boxEl.getBoundingClientRect();
      // 현재 위치를 절대좌표로 고정(가운데 정렬 해제)
      boxEl.classList.add('dragged');
      startLeft = r.left; startTop = r.top;
      boxEl.style.left = startLeft + 'px';
      boxEl.style.top = startTop + 'px';
      dragging = true; sx = e.clientX; sy = e.clientY;
      document.body.style.userSelect = 'none';
      const ifr = el('vwDesignView'); if (ifr) ifr.style.pointerEvents = 'none';
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      let nl = startLeft + (e.clientX - sx);
      let nt = startTop + (e.clientY - sy);
      // 화면 밖으로 완전히 벗어나지 않도록 약간의 여유를 두고 클램프
      const w = boxEl.offsetWidth, h = boxEl.offsetHeight;
      const minX = 40 - w, maxX = window.innerWidth - 40;
      const minY = 0, maxY = window.innerHeight - 36;
      nl = Math.max(minX, Math.min(maxX, nl));
      nt = Math.max(minY, Math.min(maxY, nt));
      boxEl.style.left = nl + 'px';
      boxEl.style.top = nt + 'px';
    });
    window.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      document.body.style.userSelect = '';
      const ifr = el('vwDesignView'); if (ifr) ifr.style.pointerEvents = '';
    });
  }

  function bindViewer() {
    el('viewerClose').addEventListener('click', closeViewer);
    el('viewerMax').addEventListener('click', toggleMaximizeViewer);
    // [◀ 뒤로]: 디자인 미리보기에서 UI/Mo 뱃지를 눌러 다른 화면으로 이동했던 이력을 하나씩 되짚는다
    // (흐름도 탭의 [◀ 뒤로]와 동일한 사용자 경험).
    el('vwBack').addEventListener('click', () => {
      const prevKey = _viewerUiNavStack.pop();
      if (!prevKey) return;
      const prevNode = store.nodes.get(prevKey) || _syntheticNodeCache.get(prevKey);
      if (!prevNode) {
        const msg = '이전 화면(' + prevKey + ')이 현재 파도타기 결과에 없습니다.';
        setStatus(msg, true);
        showViewerLinkToast(msg);
        // 되돌아갈 수 없는 이력은 계속 스택에 남겨봐야 다시 눌러도 똑같이 막히므로 그냥 건너뛴다.
        return;
      }
      openViewer(prevNode, { fromNav: true });
    });
    // 제목 표시줄 더블클릭 → 최대화 토글
    const head = el('viewerModal').querySelector('.modal-head');
    if (head) head.addEventListener('dblclick', (e) => {
      if (e.target.closest('button, select')) return;   // 버튼/셀렉트 클릭은 제외
      toggleMaximizeViewer();
    });
    setupViewerResize();
    setupViewerDrag();
    // 뒤쪽(배경) 클릭으로는 닫히지 않도록 함 — 닫기 버튼으로만 닫힘
    el('vwCode').addEventListener('click', () => { setViewerMode('code'); renderViewer(); });
    el('vwDesign').addEventListener('click', () => { setViewerMode('design'); renderViewer(); });
    el('vwResSel').addEventListener('change', renderViewer);
    // 리포트 디자인 미리보기 툴바: 확대/축소, PDF/이미지로 저장.
    el('vwZoomOut').addEventListener('click', () => setVwZoom(_vwZoom - 0.1));
    el('vwZoomIn').addEventListener('click', () => setVwZoom(_vwZoom + 0.1));
    el('vwZoomReset').addEventListener('click', () => setVwZoom(1));
    el('vwExportPdf').addEventListener('click', () => exportReportAs('pdf'));
    el('vwExportImage').addEventListener('click', () => exportReportAs('image'));
    // UI 탭 쪽 리포트 툴바 — 모달과 동일한 함수를 hostKind='tab' 으로만 다르게 호출.
    el('uiTabZoomOut').addEventListener('click', () => setVwZoom(_uiTabZoom - 0.1, 'tab'));
    el('uiTabZoomIn').addEventListener('click', () => setVwZoom(_uiTabZoom + 0.1, 'tab'));
    el('uiTabZoomReset').addEventListener('click', () => setVwZoom(1, 'tab'));
    el('uiTabExportPdf').addEventListener('click', () => exportReportAs('pdf', 'tab'));
    el('uiTabExportImage').addEventListener('click', () => exportReportAs('image', 'tab'));
    el('vwSqlToggle').addEventListener('click', () => setSqlPanelHidden('modal', !_rpqPanelHidden.modal));
    el('uiTabSqlToggle').addEventListener('click', () => setSqlPanelHidden('tab', !_rpqPanelHidden.tab));
    // 코드 보기 검색: 입력할 때마다 다시 하이라이트, Enter/Shift+Enter 로 일치 항목 순환 이동,
    // Esc 로 검색어 지우기(그래프/흐름도 검색과 동일한 조작 패턴).
    el('vwCodeSearch').addEventListener('input', () => { _vwCodeHitIdx = -1; renderCodeSearchHighlight(); });
    el('vwCodeSearch').addEventListener('keydown', e => {
      if (e.key === 'Escape') { el('vwCodeSearch').value = ''; renderCodeSearchHighlight(); }
      else if (e.key === 'Enter') { e.preventDefault(); stepCodeHit(e.shiftKey ? -1 : 1); }
    });
    el('vwCopy').addEventListener('click', () => {
      const idx = +el('vwResSel').value || 0;
      const res = _viewerRes[idx]; if (!res) return;
      let txt = res.text;
      if (res.kind === 'json') { try { txt = JSON.stringify(JSON.parse(res.text), null, 2); } catch (e) {} }
      navigator.clipboard.writeText(txt).then(() => {
        const b = el('vwCopy'); const o = b.textContent; b.textContent = '복사됨!'; setTimeout(() => b.textContent = o, 1200);
      });
    });
  }

  /* ---------- 바구니 ---------- */
  function refreshBasket() {
    const keys = store.basketKeys();
    const c = store.counts(keys);
    el('basketCount').textContent = keys.length;
    el('basketSummary').textContent =
      'UI ' + c.UI + ' · WF ' + c.WF + ' · Rp ' + c.Rp + ' · Mo ' + c.Mo + ' · 테이블 ' + c.TABLE;
    const list = el('basketList'); list.innerHTML = '';
    keys.forEach(k => {
      const n = store.nodes.get(k);
      const div = document.createElement('div');
      div.className = 'bk-item';
      div.innerHTML = '<span class="badge b-' + n.type + '">' + n.type + '</span> '
        + '<span class="bk-id">' + esc(n.id || n.uid) + '</span>'
        + '<button class="bk-x" title="빼기">×</button>';
      div.querySelector('.bk-x').addEventListener('click', () => {
        store.toggleBasket(k, false); refreshBasket(); G.markBasket(store.basket); renderTable();
      });
      list.appendChild(div);
    });
  }

  /* ---------- 저장 ---------- */
  // Windows 파일명 금지문자 및 공백을 언더스코어로 치환 (연속 언더스코어는 하나로 정리)
  function safeFileName(s) {
    return String(s || '')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .trim();
  }

  // 저장 대상 파일명의 대표 이름을 만든다.
  // 우선순위: 선택한 메뉴의 한글 메뉴명 → 없으면 프로그램ID → 그것도 없으면 'export'.
  // 담긴 프로그램(UI/WF/Mo/Rp) 개수가 2개 이상이면 "_외N건"을 붙인다.
  function buildExportBaseName(keys) {
    const progCount = keys.reduce((n, k) => {
      const node = store.nodes.get(k);
      return (node && ['UI', 'WF', 'Mo', 'Rp'].includes(node.type)) ? n + 1 : n;
    }, 0);
    const repName = (selectedMenu && (selectedMenu.LEAF_MNU_NM || selectedMenu.CALLED_PGM_ID))
      || (progCount ? 'export' : 'export');
    let base = safeFileName(repName);
    if (progCount > 1) base += '_외' + (progCount - 1) + '건';
    return base;
  }

  // 저장 전 안내 팝업: "다시 보지 않기" 체크 시 settings.json에 기억해 다음부터 건너뛴다.
  let _erpNoticeHidden = null; // null=아직 모름, true/false=settings에서 읽어온 값

  async function ensureErpNoticeState() {
    if (_erpNoticeHidden !== null) return;
    try {
      const r = await window.api.settingsGet();
      _erpNoticeHidden = !!(r && r.ok && r.settings && r.settings.hideErpSaveNotice);
    } catch (_) { _erpNoticeHidden = false; }
  }

  function showErpSaveNotice() {
    return new Promise((resolve) => {
      const modal = el('erpSaveNoticeModal');
      const chk = el('erpSaveNoticeHide');
      chk.checked = false;
      modal.style.display = 'flex';
      el('erpSaveNoticeOk').onclick = async () => {
        modal.style.display = 'none';
        if (chk.checked) {
          _erpNoticeHidden = true;
          try { await window.api.settingsSet({ hideErpSaveNotice: true }); } catch (_) {}
        }
        resolve();
      };
    });
  }

  async function save(scope) {
    const keys = scope === 'basket' ? store.basketKeys() : store.allKeys();
    if (!keys.length) { setStatus(scope === 'basket' ? '바구니가 비어있습니다.' : '저장할 데이터가 없습니다.', true); return; }

    await ensureErpNoticeState();
    if (!_erpNoticeHidden) await showErpSaveNotice();

    const meta = {
      scope, rootProgram: selectedMenu ? selectedMenu.CALLED_PGM_ID : '',
      tenantId: (selectedMenu && selectedMenu.TENANT_ID) || '*', coCd: (selectedMenu && selectedMenu.CO_CD) || '*'
    };
    const json = S.buildJson(store, keys, meta);
    const stamp = tstamp();
    const base = 'wave_' + buildExportBaseName(keys) + '_' + stamp;

    // 생성 PC 정보(메타)는 메인 프로세스에서 조합해 받는다(외부 IP는 접속 로그 조회 시 캐시된 값 사용).
    let exportMeta = {};
    try { const m = await window.api.exportMeta(); if (m && m.ok) exportMeta = m.meta; } catch (_) {}

    const r = await window.api.saveErp({ defaultName: base + '.erp', json, meta: exportMeta });
    if (r.ok) setStatus('저장 완료 · ' + r.path);
    else if (!r.canceled) setStatus('저장 실패', true);
  }

  /* ---------- 유틸 ---------- */
  function switchTab(t) {
    el('tabGraph').classList.toggle('active', t === 'graph');
    el('tabTable').classList.toggle('active', t === 'table');
    el('tabFlow').classList.toggle('active', t === 'flow');
    el('tabUi').classList.toggle('active', t === 'ui');
    el('paneGraph').style.display = t === 'graph' ? 'flex' : 'none';
    el('paneTable').style.display = t === 'table' ? 'block' : 'none';
    el('paneFlow').style.display = t === 'flow' ? 'flex' : 'none';
    el('paneUi').style.display = t === 'ui' ? 'flex' : 'none';
    // 검색(그래프+테이블 공통)은 흐름도·UI 탭에서는 숨긴다. 그래프 전용 도구(표시 토글/배치/재배치/
    // 전체보기)는 그래프 탭에서만, 흐름도 전용 도구는 흐름도 탭에서만 보인다 — 탭에 안 맞는
    // 버튼(예: 테이블 탭의 재배치·전체보기)이 섞여 있지 않게 한다. UI 탭은 전용 도구가 필요 없다
    // (뒤로가기 버튼은 탭 안쪽 헤더에 자체적으로 있음).
    el('searchTools').style.display = (t === 'flow' || t === 'ui') ? 'none' : 'flex';
    el('graphTools').style.display = t === 'graph' ? 'flex' : 'none';
    el('flowTools').style.display = t === 'flow' ? 'flex' : 'none';
    // 그래프 탭에 들어올 때마다 "전체 보기"로 다시 맞추면(과거 동작), selectAndFocus() 로
    // 특정 노드에 줌·중심을 맞춰둔 뒤 다른 탭을 거쳐 갔다가 그래프 탭으로 돌아왔을 때 그 줌이
    // 매번 초기화돼 버린다(예: UI 탭에서 WF 뱃지 클릭 → 그래프에 줌+선택 → 흐름도로 이동 → 나중에
    // 그래프 탭을 다시 보면 줌이 안 풀려 있어야 하는데 풀려 있음). 탭을 보이는 상태로 만들 때는
    // 컨테이너 크기만 다시 재고(숨겨진 동안 0 크기였을 수 있음), 전체 보기로 다시 맞추는 것은
    // "전체보기" 버튼이나 새 파도타기 실행 직후처럼 명시적으로 원하는 경우에만 하도록 분리했다.
    if (t === 'graph') setTimeout(() => G.resize(), 50);
    if (t === 'flow') setTimeout(() => F.fit(), 50);
  }

  /* ---------- 흐름도 탭: 선택한 WF 노드의 RESOURCE_WF 내부 프로세스 흐름 ---------- */
  // 상세 패널의 [🔀 흐름도 보기] 버튼에서 호출됨.
  // opts.keepNav === true 인 경우에만(서비스콜 이동/뒤로가기) 되돌아가기 스택을 그대로 두고,
  // 그 외(사용자가 새 WF를 직접 선택)에는 이전 이동 이력이 더 이상 의미가 없으므로 비운다.
  function showFlow(key, opts) {
    const n = store.nodes.get(key);
    if (!n || n.type !== 'WF' || !n.raw || !n.raw.RESOURCE_WF) {
      setStatus('흐름도를 표시할 WF 리소스가 없습니다.', true);
      return;
    }
    if (!(opts && opts.keepNav)) flowNavStack = [];
    flowNodeKey = key;
    currentFlowRaw = n.raw.RESOURCE_WF;
    currentFlowScope = null;
    // 흐름도 탭이 보이는 상태에서 그려야 컨테이너 크기가 정상 측정된다(숨김 탭에서 먼저
    // 그리면 0 크기로 배치되는 문제 방지). 탭 전환을 렌더보다 먼저 한다.
    switchTab('flow');
    let ok = F.render(currentFlowRaw, el('flowLayoutSel').value);
    // opts.scope 가 있으면(예: [◀ 뒤로]로 반복문 내부 화면까지 되돌아가는 경우) 최상위를 그린
    // 직후 바로 그 내부 스코프로 한 번 더 전환한다.
    if (ok && opts && opts.scope) {
      const sok = F.renderScope(opts.scope, el('flowLayoutSel').value);
      if (sok) currentFlowScope = opts.scope;
    }
    // 새 WF 흐름도를 열 때마다 상세 팝업은 기본 위치·크기로 초기화한다.
    // (같은 WF 안에서 다른 단계를 클릭할 때만 사용자가 조절한 크기/위치를 유지하면 된다)
    // 단, 접기/펼치기 상태(flowBoxCollapsed)는 사용자가 정한 값을 그대로 유지한다.
    const stepBox = el('flowStepBox');
    stepBox.style.display = 'none';
    stepBox.removeAttribute('data-positioned');
    stepBox.style.left = ''; stepBox.style.top = ''; stepBox.style.right = '';
    stepBox.style.width = ''; stepBox.style.height = '';
    // 새 화면이니 이전 검색어/하이라이트는 지운다(다른 화면 결과가 남아있으면 헷갈림).
    el('flowSearch').value = ''; F.search('');
    el('flowEmpty').style.display = ok ? 'none' : 'block';
    updateFlowTitle(ok);
    if (!ok) setStatus('흐름도 데이터를 해석할 수 없습니다. RESOURCE_WF 형식을 확인하세요.', true);
    updateFlowBackButton();
  }

  // 흐름도 상단 제목: WF 이름 + (반복문/분기 내부를 보고 있으면) 그 내부 스텝 이름을 이어 붙인다.
  function updateFlowTitle(ok) {
    if (!ok) { el('flowTitle').textContent = '이 WF 리소스에서 흐름(process/connector) 구조를 찾지 못했습니다.'; return; }
    const n = store.nodes.get(flowNodeKey);
    let title = '흐름도 · ' + ((n && (n.id || n.uid)) || '') + (n && n.name && n.name !== n.id ? (' — ' + n.name) : '');
    if (currentFlowScope) {
      const step = F.getStep(currentFlowScope);
      const pv = (step && step.propertyValue) || {};
      title += '  ▸  🔁 내부: ' + (pv.processNm || pv.iteratorVariable || currentFlowScope);
    }
    el('flowTitle').textContent = title;
  }

  // [◀ 뒤로] 버튼은 되돌아갈 이동 이력이 있을 때만 보인다.
  function updateFlowBackButton() {
    const btn = el('btnFlowBack');
    if (btn) btn.style.display = flowNavStack.length ? '' : 'none';
  }

  // 상세 패널의 [SQL 쿼리] 목록에서 [🔀 이동] 클릭 → 흐름도 탭으로 전환해 그 쿼리를 가진
  // 단계를 찾아 선택·줌한다. 이미 같은 WF의 흐름도가 열려 있으면 다시 그리지 않고(사용자가
  // 조절한 위치/크기·줌 상태 보존) 탭만 전환한다.
  function gotoQueryInFlow(key, queryText) {
    const already = flowNodeKey === key && F.hasData();
    if (!already) showFlow(key);
    else switchTab('flow');
    // 탭 전환/렌더링 직후 컨테이너 크기가 안정될 시간을 살짝 준다(그래프 탭과 동일한 패턴).
    setTimeout(() => {
      const compId = F.findStepByQuery(queryText);
      if (!compId) { setStatus('흐름도에서 해당 쿼리를 가진 단계를 찾지 못했습니다.', true); return; }
      F.selectAndZoom(compId);
    }, 80);
  }

  // 상세 패널의 노드별 SQL [이동] → 흐름도에서 compId 스텝으로 바로 이동(쿼리 텍스트 매칭 불필요)
  function gotoStepInFlow(key, compId) {
    const already = flowNodeKey === key && F.hasData();
    if (!already) showFlow(key);
    else switchTab('flow');
    setTimeout(() => { if (compId) F.selectAndZoom(compId); }, 80);
  }

  // 흐름도에서 반복문/분기 등 "내부 흐름이 있는" 단계를 더블클릭하거나, 상세박스의
  // [🔁 이 내부 흐름 보기] 버튼을 클릭했을 때 호출됨. 그 단계의 child.process 만 따로 떼어
  // 자기 자신의 시작·종료를 가진 완결된 화면으로 전환한다(서비스콜 이동과 동일하게 flowNavStack
  // 에 쌓여서 [◀ 뒤로] 하나로 되돌아 나올 수 있다).
  function jumpToContainerScope(compId) {
    const step = F.getStep(compId);
    if (!step || !step.child || !Array.isArray(step.child.process) || !step.child.process.length) {
      setStatus('이 단계는 내부 흐름이 없습니다.', true);
      return;
    }
    const ok = F.renderScope(compId, el('flowLayoutSel').value);
    if (!ok) { setStatus('내부 흐름을 표시할 수 없습니다.', true); return; }
    flowNavStack.push({ key: flowNodeKey, compId: compId, scope: currentFlowScope });
    currentFlowScope = compId;
    updateFlowTitle(true);
    updateFlowBackButton();
    // 새 스코프로 들어왔으니 이전 단계의 상세 팝업과 검색어/하이라이트는 지운다(그대로 두면 헷갈림).
    el('flowStepBox').style.display = 'none';
    el('flowSearch').value = ''; F.search('');
  }

  // 흐름도에서 서비스콜(다른 WF 호출) 단계를 더블클릭하거나, 상세박스의 [🔀 이 서비스 흐름도 보기]
  // 버튼을 클릭했을 때 호출됨. 그 서비스가 이번 파도타기 결과(store)에 이미 들어 있으면 그 WF의
  // 흐름도로 곧장 전환하고, 없으면(깊이 제한에 걸렸거나 DB에서 조회되지 않은 경우) 이유를 안내한다.
  // fromCompId: 이동을 시작한 원래 WF에서의 그 서비스콜 단계 compId — [◀ 뒤로]로 정확히
  // 그 위치로 되돌아올 수 있도록 스택에 함께 기록해둔다.
  function jumpToServiceFlow(serviceId, serviceUid, fromCompId) {
    if (!serviceId && !serviceUid) { setStatus('이 단계에는 이동할 서비스 정보(서비스ID/UID)가 없습니다.', true); return; }
    const key = store.nodeKey('WF', serviceId, serviceUid);
    const node = store.nodes.get(key);
    const label = serviceId || ('uid=' + serviceUid);
    if (!node) {
      setStatus('"' + label + '" 는 현재 파도타기 결과에 없습니다 — 조회가 취소되었거나 아직 확장 전일 수 있습니다. 다시 조회해보세요.', true);
      return;
    }
    if (!node.raw || !node.raw.RESOURCE_WF) {
      setStatus('"' + label + '" 서비스는 참조는 있지만 DB에서 실제 데이터를 찾지 못했습니다(재배포로 UID가 바뀌었거나 삭제됐을 수 있습니다).', true);
      return;
    }
    if (flowNodeKey) flowNavStack.push({ key: flowNodeKey, compId: fromCompId || null });
    showFlow(node.key, { keepNav: true });
  }

  // 흐름도의 개별 단계(process 노드) 클릭 → 우측 상세박스에 원본 내용 표시.
  // 상세박스(#flowStepBox)는 매번 새로 만들지 않고 같은 엘리먼트의 innerHTML만 바꾸므로,
  // 사용자가 모서리를 드래그해 조절한 팝업 크기(width/height)는 다른 노드를 선택해도 그대로 유지된다.
  function onFlowStepTap(compId) {
    const step = F.getStep(compId);
    const box = el('flowStepBox');
    if (!step) return; // 팝업은 상시 표시(닫기 없음) — 유효하지 않은 탭은 그냥 무시
    // 최초 표시 시 1회만: right(우측 정렬) 대신 left 로 위치를 고정한다.
    // 네이티브 CSS resize는 항상 "왼쪽 위는 그대로, 너비/높이만 늘어남" 방식으로 동작하는데
    // right로 고정돼 있으면 너비가 늘어날 때 오히려 왼쪽으로 자라 보여(오른쪽 끝은 그대로) 커서를
    // 따라오지 않는 것처럼 느껴진다. left로 한 번 고정해두면 드래그한 방향(오른쪽/아래)으로 자연스럽게 커진다.
    if (!box.hasAttribute('data-positioned')) {
      const cont = el('flowchart');
      const contW = (cont && cont.clientWidth) || 900;
      const w = box.offsetWidth || 340;
      box.style.left = Math.max(12, contW - w - 12) + 'px';
      box.style.right = 'auto';
      box.style.top = '12px';
      box.setAttribute('data-positioned', '1');
    }
    box.innerHTML = renderFlowStepDetail(step);
    box.classList.toggle('collapsed', flowBoxCollapsed);
    box.style.display = 'flex'; // .flow-stepbox 는 세로 flex 컨테이너(SQL 영역이 남는 공간을 채움)
    const minBtn = box.querySelector('#fsbMin');
    if (minBtn) minBtn.addEventListener('click', () => {
      flowBoxCollapsed = !flowBoxCollapsed;
      box.classList.toggle('collapsed', flowBoxCollapsed);
      minBtn.textContent = flowBoxCollapsed ? '▸ 펼치기' : '▾ 접기';
      minBtn.title = flowBoxCollapsed ? '펼치기' : '접기';
    });
    const pv = step.propertyValue || {};
    // DB별 SQL 탭 전환/복사(공통 바인더)
    bindSqlVariants(box);
    const gotoServiceBtn = box.querySelector('#fsbGotoService');
    if (gotoServiceBtn) gotoServiceBtn.addEventListener('click', () => jumpToServiceFlow(pv.serviceId, pv.serviceUid, compId));
    const gotoContainerBtn = box.querySelector('#fsbGotoContainer');
    if (gotoContainerBtn) gotoContainerBtn.addEventListener('click', () => jumpToContainerScope(compId));
    // 추정 쿼리 복사 — 다른 SQL 탭들과 동일하게 copyToClipboard() 재사용, 버튼 텍스트로 성공 표시.
    const guessCopyBtn = box.querySelector('#fsbGuessCopy');
    if (guessCopyBtn) {
      const guessPre = box.querySelector('#fsbGuessPre');
      guessCopyBtn.addEventListener('click', () => { if (guessPre) copyToClipboard(guessPre.textContent, guessCopyBtn); });
    }
  }

  // DaaF 노드는 DB별로 쿼리를 나눠 담는다: query(ANSI 공통) / mssqlQuery / mysqlQuery / oracleQuery ...
  // 공통 query 가 비어 있어도 DB별 쿼리에 내용이 있을 수 있으므로(예: 재귀 CTE),
  // 이름/정보 아래에 DB 종류를 탭처럼 두고, 보유한 쿼리는 눌러서 보고 없는 건 한눈에 보이게 한다.
  function sqlVariantsOf(pv) {
    pv = pv || {};
    const CORE = [
      { key: 'query',       label: 'ANSI' },
      { key: 'mssqlQuery',  label: 'MSSQL' },
      { key: 'mysqlQuery',  label: 'MySQL' },
      { key: 'oracleQuery', label: 'Oracle' }
    ];
    // 추가 DB 변형은 내용이 있을 때만 탭으로 노출
    const EXTRA = [
      { key: 'postgreQuery',  label: 'PostgreSQL' },
      { key: 'postgresQuery', label: 'PostgreSQL' },
      { key: 'tiberoQuery',   label: 'Tibero' },
      { key: 'db2Query',      label: 'DB2' }
    ];
    const val = (k) => { const r = pv[k]; return (r == null ? '' : String(r)).trim(); };
    const list = CORE.map(v => ({ key: v.key, label: v.label, sql: val(v.key), has: val(v.key).length > 0 }));
    EXTRA.forEach(v => { const s = val(v.key); if (s && !list.some(x => x.label === v.label)) list.push({ key: v.key, label: v.label, sql: s, has: true }); });
    return list;
  }

  // 하나의 노드(propertyValue)에 대한 DB별 SQL 탭 그룹을 self-contained 하게 렌더한다.
  // 흐름도 상세팝업과 그래프 상세패널 양쪽에서 재사용되며, 이벤트는 bindSqlVariants(root) 가 건다.
  // extraHeadHtml: sql-head 우측(복사 버튼 옆)에 끼워넣을 추가 버튼 HTML(예: 흐름도 이동).
  function renderSqlVariants(pv, extraHeadHtml) {
    const variants = sqlVariantsOf(pv);
    if (!variants.some(v => v.has)) return '';
    const active = variants.find(v => v.has);   // ANSI 우선, 없으면 첫 보유 변형
    const owned = variants.filter(v => v.has).map(v => v.label).join(', ');
    const tabs = variants.map(v => {
      const cls = 'sqlvar-tab' + (v.has ? '' : ' empty') + (v.key === active.key ? ' active' : '');
      const title = v.has ? (v.label + ' 쿼리 보기') : ('이 노드에는 ' + v.label + ' 쿼리가 없습니다');
      const mark = v.has ? '<span class="sqlvar-dot ok">●</span>' : '<span class="sqlvar-dot no">✕</span>';
      return '<button type="button" class="' + cls + '" data-var="' + v.key + '" data-has="' + (v.has ? '1' : '0') + '"'
        + ' data-label="' + esc(v.label) + '" title="' + esc(title) + '">' + mark + esc(v.label) + '</button>';
    }).join('');
    let html = '<div class="sqlvar-group">';
    html += '<div class="sqlvar-bar" title="보유 쿼리: ' + esc(owned) + '">' + tabs + '</div>';
    html += '<div class="sql-head" style="border-radius:8px 8px 0 0">SQL '
      + '<span class="sqlvar-cur">' + esc(active.label) + '</span>'
      + ' <button type="button" class="btn ghost xs sqlvar-copy">복사</button>'
      + (extraHeadHtml || '') + '</div>';
    html += variants.map(v => {
      const show = (v.key === active.key) ? '' : 'display:none;';
      if (v.has)
        return '<pre class="sql-code sqlvar-pre" data-var="' + v.key + '" style="border-radius:0 0 8px 8px;' + show + '">' + esc(v.sql) + '</pre>';
      return '<pre class="sql-code sqlvar-pre sqlvar-empty" data-var="' + v.key + '" style="border-radius:0 0 8px 8px;' + show + '">'
        + '— 이 노드에는 ' + esc(v.label) + ' 쿼리가 없습니다 —</pre>';
    }).join('');
    html += '</div>';
    return html;
  }

  // sqlvar-group 들의 탭 전환/복사 이벤트를 건다(스코프: root 하위 모든 그룹).
  function bindSqlVariants(root) {
    if (!root) return;
    root.querySelectorAll('.sqlvar-group').forEach(group => {
      const tabs = group.querySelectorAll('.sqlvar-tab');
      const pres = group.querySelectorAll('.sqlvar-pre');
      const cur = group.querySelector('.sqlvar-cur');
      tabs.forEach(tab => tab.addEventListener('click', () => {
        const key = tab.getAttribute('data-var');
        tabs.forEach(t => t.classList.toggle('active', t === tab));
        pres.forEach(pre => { pre.style.display = (pre.getAttribute('data-var') === key) ? '' : 'none'; });
        if (cur) cur.textContent = tab.getAttribute('data-label') || '';
      }));
      const copy = group.querySelector('.sqlvar-copy');
      if (copy) copy.addEventListener('click', () => {
        let visible = null;
        pres.forEach(pre => { if (pre.style.display !== 'none') visible = pre; });
        if (visible && !visible.classList.contains('sqlvar-empty')) copyToClipboard(visible.textContent, copy);
        else { const o = copy.textContent; copy.textContent = '쿼리 없음'; setTimeout(() => copy.textContent = o, 1000); }
      });
    });
  }

  // ---- 선언적 엔티티 스텝(SelectEntity/DeleteEntity/PutEntity/SaveEntity/CrudEntity)의
  // "추정 쿼리" 재구성 ----
  // 이 타입들은 SQL 텍스트를 직접 담지 않고, 참조하는 EntityDefinition 스텝(엔티티 스키마:
  // 테이블명·컬럼명·PK·시스템기본값)과 자신의 filter/orderby(조건)만 선언적으로 갖는다.
  // 실제 실행 시점 SQL은 프레임워크(QueryBuilder)가 이 둘을 조합해 그 자리에서 만든다.
  // 여기서는 같은 재료(스키마+필터)로 "구조상 이렇게 생겼을 것"이라는 추정 SQL을 만들어
  // 보여준다 — 실제 실행 SQL과 글자 하나까지 같다는 보장은 없는 참고용 추정치다.
  const ENTITY_QUERY_KIND = { SelectEntity: 'SELECT', DeleteEntity: 'DELETE', PutEntity: 'CUD', SaveEntity: 'CUD', CrudEntity: 'CUD' };
  const ENTITY_OP_SQL = { EQ: '=', NE: '<>', GT: '>', GTE: '>=', LT: '<', LTE: '<=', LIKE: 'LIKE', IN: 'IN' };

  // 이 스텝이 참조하는 EntityDefinition 스텝(엔티티 스키마)을 찾는다.
  function resolveEntitySchema(pv) {
    const ref = pv.inputEntity && pv.inputEntity.referenceCompId;
    if (!ref || !F || !F.getStep) return null;
    const def = F.getStep(ref);
    if (!def || def.processType !== 'EntityDefinition') return null;
    const dpv = def.propertyValue || {};
    const fields = Array.isArray(dpv.entityFieldList) ? dpv.entityFieldList : [];
    if (!fields.length) return null;
    return { tableNm: dpv.tableNm, fields };
  }

  // fieldId(논리명, 예: usrId) → 실제 컬럼명(예: USR_ID). 스키마를 못 찾으면 camelCase를
  // SNAKE_CASE 로 추정해 대신 쓴다(정확도는 떨어지지만 아예 안 보여주는 것보단 낫다).
  function entityColOf(schema, fieldId) {
    if (schema) { const f = schema.fields.find(x => x.fieldId === fieldId); if (f) return f.columnNm || fieldId; }
    return String(fieldId).replace(/([A-Z])/g, '_$1').toUpperCase();
  }

  function buildEntityQueryGuess(step) {
    const kind = ENTITY_QUERY_KIND[step.processType];
    if (!kind) return '';
    const pv = step.propertyValue || {};
    const schema = resolveEntitySchema(pv);
    const table = (pv.targetTable || (schema && schema.tableNm) || '').trim();
    if (!table) return '';

    const pkCols = schema ? schema.fields.filter(f => f.option && f.option.pkYn === 'Y') : [];
    const filterConds = (Array.isArray(pv.filter) ? pv.filter : [])
      .filter(f => f.if !== false && f.column)
      .map(f => entityColOf(schema, f.column) + ' ' + (ENTITY_OP_SQL[f.operator] || '=') + ' :' + f.column);
    // PK 는 filter 에 없더라도(엔티티 스코프 특성상) 항상 조건에 포함되는 경우가 많아 함께 표시.
    // 바인드 이름은 filter 쪽과 일관되게 fieldId(예: tenantId)를 쓴다.
    const pkConds = pkCols
      .filter(f => !filterConds.some(fc => fc.indexOf(f.columnNm + ' ') === 0))
      .map(f => f.columnNm + ' = :' + f.fieldId);
    const whereConds = pkConds.concat(filterConds);
    const whereSql = whereConds.length ? '\nWHERE ' + whereConds.join('\n  AND ') : '';

    if (kind === 'SELECT') {
      const cols = schema && schema.fields.length ? schema.fields.map(f => f.columnNm).join(', ') : '*';
      const orderConds = (Array.isArray(pv.orderby) ? pv.orderby : [])
        .filter(o => o && (o.column || o.fieldId))
        .map(o => entityColOf(schema, o.column || o.fieldId) + ((o.direction === 'DESC' || o.desc) ? ' DESC' : ''));
      const orderSql = orderConds.length ? '\nORDER BY ' + orderConds.join(', ') : '';
      return 'SELECT ' + cols + '\nFROM ' + table + whereSql + orderSql;
    }
    if (kind === 'DELETE') {
      return 'DELETE FROM ' + table + whereSql;
    }
    // PutEntity/SaveEntity/CrudEntity: 실행 시점에 실제로 INSERT 가 될지 UPDATE 가 될지는
    // 데이터(신규/기존)에 따라 갈리므로, 스키마상 가능한 두 형태를 함께 보여준다.
    if (schema) {
      const insertable = schema.fields.filter(f => !(f.option && f.option.insertableYn === 'N'));
      const insertCols = insertable.map(f => f.columnNm);
      const insertVals = insertable.map(f => (f.option && f.option.insertDefault) ? f.option.insertDefault : ':' + f.fieldId);
      const updatable = schema.fields.filter(f => !(f.option && (f.option.updatableYn === 'N' || f.option.pkYn === 'Y')));
      const updateSets = updatable.map(f => f.columnNm + ' = ' + ((f.option && f.option.updateDefault) ? f.option.updateDefault : ':' + f.fieldId));
      let out = '-- 신규 등록(INSERT)인 경우\nINSERT INTO ' + table + ' (' + insertCols.join(', ') + ')\nVALUES (' + insertVals.join(', ') + ')';
      out += '\n\n-- 기존 수정(UPDATE)인 경우\nUPDATE ' + table + '\nSET ' + updateSets.join(',\n    ') + whereSql;
      return out;
    }
    // 참조 스키마를 못 찾은 경우 테이블명만이라도 알려준다.
    return '-- (참조 엔티티 스키마를 찾지 못해 컬럼 목록은 추정할 수 없습니다)\n-- 대상 테이블: ' + table;
  }

  // 이 스텝이 "쿼리 정보"(실제 SQL 또는 재구성 가능한 추정 쿼리)를 갖고 있는지 판단한다.
  // 리포트의 "SQL 보기" 탭에서 Message/Condition/StartProcess 처럼 쿼리가 아예 없는 스텝은
  // 걸러내고 의미 있는 스텝만 나열하기 위한 필터로 쓴다.
  function stepHasQuery(step) {
    const pv = step.propertyValue || {};
    if (sqlVariantsOf(pv).some(v => v.has)) return true;
    try { return !!buildEntityQueryGuess(step); } catch (e) { return false; }
  }

  // 리포트의 "SQL 보기" 탭 전용: 한 스텝을 카드 하나로 렌더링한다. renderFlowStepDetail() 과
  // 내용은 비슷하지만, 여러 장을 한 화면에 나란히 늘어놓아야 해서 흐름도 전용 요소(접기/펼치기
  // 버튼, 다른 흐름으로 이동 버튼 — 전부 #id 기반이라 여러 장이면 id 충돌남)는 빼고, 클래스
  // 기반으로 복사 버튼을 스코프(.rpq-card 안에서만 찾음)해 충돌 없이 여러 장을 그릴 수 있게 한다.
  function renderReportQueryCard(step) {
    const t = step.processType || step.type || '';
    const pv = step.propertyValue || {};
    let html = '<div class="rpq-card"><div class="fsb-head"><div><span class="badge b-WF">' + esc(t) + '</span></div></div>';
    html += kv('컴포넌트ID', step.compId);
    if (pv.processNm) html += kv('이름', pv.processNm);
    if (pv.tableNm) html += kv('테이블', pv.tableNm);
    const realSql = renderSqlVariants(pv);
    if (realSql) {
      html += realSql;
    } else {
      const guess = buildEntityQueryGuess(step);
      if (guess) {
        html += '<div class="d-sec">추정 쿼리<span class="guess-badge" title="이 스텝은 SQL 텍스트를 직접 담지 않는 선언적 타입(' + esc(t) + ')입니다. 참조된 엔티티 스키마(테이블/컬럼)와 조건을 조합해 재구성한 추정치이며, 실제 실행 SQL과 완전히 같다는 보장은 없습니다.">🧩 추정</span></div>'
          + '<div class="sql-head" style="border-radius:8px 8px 0 0">SQL <span class="sqlvar-cur">추정</span>'
          + ' <button type="button" class="btn ghost xs rpq-guess-copy">복사</button></div>'
          + '<pre class="sql-code rpq-guess-pre" style="border-radius:0 0 8px 8px">' + esc(guess) + '</pre>';
      }
    }
    html += '</div>';
    return html;
  }

  function renderFlowStepDetail(step) {
    const t = step.processType || step.type || '';
    const pv = step.propertyValue || {};
    let html = '<div class="fsb-head"><div><span class="badge b-WF">' + esc(t) + '</span></div>'
      + '<button id="fsbMin" class="fsb-min" title="' + (flowBoxCollapsed ? '펼치기' : '접기') + '">'
      + (flowBoxCollapsed ? '▸ 펼치기' : '▾ 접기') + '</button></div>';
    html += kv('컴포넌트ID', step.compId);
    if (pv.processNm) html += kv('이름', pv.processNm);
    if (pv.tableNm) html += kv('테이블', pv.tableNm);
    if (pv.entityVariable) html += kv('엔티티 변수', pv.entityVariable);
    if (pv.serviceId || pv.serviceName) {
      html += kv('서비스', [pv.serviceName, pv.serviceId].filter(Boolean).join(' · '));
      if (t === 'service') {
        // 다른 버튼들(복사/이동 등)은 목록 안에 끼워넣는 작은 xs 버튼이라 얇아도 괜찮지만,
        // 이 버튼은 다른 WF로 화면 전체를 전환하는 주요 동작이라 일반 버튼과 같은 높이(패딩)로
        // 눈에 띄게 하고, 팝업 폭 전체를 채우는 블록 버튼으로 둔다.
        html += '<button id="fsbGotoService" class="btn ghost" style="display:block;width:100%;margin:6px 0 8px;text-align:center" '
          + 'title="이 스텝은 다른 WF(' + esc(pv.serviceId || ('uid=' + pv.serviceUid)) + ')를 호출합니다 — 그 WF의 흐름도로 이동 (더블클릭해도 이동합니다)">'
          + '🔀 이 서비스 흐름도 보기</button>';
      }
    }
    // 반복문/분기 등 내부에 별도 흐름(child.process)을 가진 스텝 — 더블클릭해도 이동하지만,
    // 상세 패널에서도 바로 들어갈 수 있게 같은 자리에 버튼을 둔다(서비스콜 버튼과 같은 스타일).
    if (step.child && Array.isArray(step.child.process) && step.child.process.length) {
      html += '<button id="fsbGotoContainer" class="btn ghost" style="display:block;width:100%;margin:6px 0 8px;text-align:center" '
        + 'title="이 단계는 내부에 별도 흐름(' + step.child.process.length + '단계)이 있습니다 — 그 내부로 이동해서 봅니다 (더블클릭해도 이동합니다)">'
        + '🔁 이 내부 흐름 보기 (' + step.child.process.length + '단계)</button>';
    }
    if (pv.messageCode) html += kv('메시지코드', pv.messageCode);
    if (pv.message) html += kv('메시지', pv.message);
    if (pv.condition && pv.condition.filter) {
      html += '<div class="d-sec">조건식</div><pre class="sql-code">' + esc(pv.condition.filter) + '</pre>';
    }
    const realSql = renderSqlVariants(pv);
    if (realSql) {
      html += realSql;
    } else {
      const guess = buildEntityQueryGuess(step);
      if (guess) {
        html += '<div class="d-sec">추정 쿼리<span class="guess-badge" title="이 스텝은 SQL 텍스트를 직접 담지 않는 선언적 타입(' + esc(step.processType) + ')입니다. 참조된 엔티티 스키마(테이블/컬럼)와 조건을 조합해 재구성한 추정치이며, 실제 실행 SQL과 완전히 같다는 보장은 없습니다.">🧩 추정</span></div>'
          + '<div class="sql-head" style="border-radius:8px 8px 0 0">SQL <span class="sqlvar-cur">추정</span>'
          + ' <button type="button" class="btn ghost xs" id="fsbGuessCopy">복사</button></div>'
          + '<pre class="sql-code" id="fsbGuessPre" style="border-radius:0 0 8px 8px">' + esc(guess) + '</pre>';
      }
    }
    if (pv.code) html += '<div class="d-sec">코드</div><pre class="sql-code">' + esc(pv.code) + '</pre>';
    return html;
  }
  function setStatus(msg, err) {
    const s = el('status'); s.textContent = msg; s.className = err ? 'status err' : 'status';
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function tstamp() {
    const d = new Date(), p = (x) => String(x).padStart(2, '0');
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }
})();
