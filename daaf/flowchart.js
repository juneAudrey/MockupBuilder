/* Daaf Wave 흐름도(Flowchart) 렌더러
 * WF 노드의 RESOURCE_WF(JSON 문자열) 안에 있는 service.child.process / connector 를
 * Cytoscape 로 시각화한다. (관계 그래프(graph.js)와는 별개의 캔버스/인스턴스)
 *
 * RESOURCE_WF 구조:
 *   { bundle:[...], service: { ..., child: { process: [...], connector: [...] } } }
 *   - process[].processType (또는 type) : StartProcess/EndProcess/EntityDefinition/
 *     SelectEntityByQuery/SQLQueryExecution/Message/Condition/service/code/iterator 등
 *   - process[].position {x,y} : 워크플로우 디자이너 캔버스 상의 원본 좌표(그대로 배치에 사용 가능)
 *   - connector[].processFrom / processTo : 화살표 연결
 *   - connector[].propertyValue.filter / elseYn : 조건 분기 라벨
 */
window.WaveFlow = (function () {
  let cy = null;
  let onStepTap = null;
  let onServiceJump = null; // (serviceId, serviceUid, compId) => void — 서비스콜 단계에서 다른 WF로 이동 요청
  let onContainerJump = null; // (compId) => void — 반복문/분기 등 내부 흐름이 있는 단계를 더블클릭해 그 내부로 이동
  let stepById = {};     // compId -> 원본 process 정의(상세 표시용). render() 시 모든 깊이를 재귀로 한 번에 채운다.
  let containerHasChildren = {}; // compId -> true (그 스텝이 하위 흐름(child.process)을 가지고 있는지)
  let hasSteps = false;
  // 지금 화면(스코프)에 그려진 노드들의 "원본 디자이너 좌표" 보관소. compId -> {x,y}.
  // Cytoscape의 preset 레이아웃은 positions 옵션을 안 주면 "지금 그 자리"를 그대로 두는
  // 사실상 무동작 레이아웃이라, 계층(breadthfirst) 배치가 노드 좌표를 옮겨버린 뒤에
  // "원본 배치"로 되돌아가려면 이렇게 원본 좌표를 별도로 기억해뒀다가 명시적으로 넘겨줘야 한다.
  // render()/renderScope() 가 화면을 새로 그릴 때마다(스코프가 바뀔 때마다) 다시 채운다.
  let origPositions = {};

  // ---- 미니맵 상태 ----
  let minimapEnabled = true;
  let mmBox = null, mmHead = null, mmCanvas = null, mmCtx = null;
  let mmMapState = null;   // 마지막으로 그린 모델↔캔버스 좌표 변환 정보(클릭 시 역산에 재사용)
  let mmPanning = false;
  const MM_POS_KEY = 'daafwave_flowMinimapPos';

  // 처리 유형별 색상 (범례와 매칭)
  const TYPE_COLOR = {
    StartProcess: '#12a150',
    EndProcess: '#ef4444',
    Condition: '#f59e0b',
    SelectEntityByQuery: '#1f6fd6',
    EntityDefinition: '#1f6fd6',
    SQLQueryExecution: '#0ea5e9',
    service: '#8b5cf6',
    Message: '#e08e0b',
    code: '#334155',
    iterator: '#334155'
  };
  const DEFAULT_COLOR = '#94a3b8';

  function slug(t) { return String(t || 'unknown').replace(/[^a-zA-Z0-9]/g, '').toLowerCase(); }
  function esc(s) { return String(s == null ? '' : s); }
  function truncate(s, n) {
    s = String(s == null ? '' : s).trim().replace(/\s+/g, ' ');
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  function init(container, opts) {
    onStepTap = (opts && opts.onStepTap) || null;
    onServiceJump = (opts && opts.onServiceJump) || null;
    onContainerJump = (opts && opts.onContainerJump) || null;
    cy = cytoscape({
      container,
      wheelSensitivity: 0.2,
      minZoom: 0.1,
      maxZoom: 3,
      textureOnViewport: true,
      hideEdgesOnViewport: true,
      pixelRatio: 1,
      style: [
        { selector: 'node', style: {
            'shape': 'round-rectangle',
            'label': 'data(label)',
            'color': '#0b1220',
            'font-size': 10,
            'font-family': 'Pretendard, "Malgun Gothic", sans-serif',
            'text-valign': 'center', 'text-halign': 'center',
            'text-wrap': 'wrap', 'text-max-width': '150px',
            'width': 'label', 'height': 'label',
            'padding': '10px',
            'background-color': '#ffffff',
            'border-width': 2,
            'border-color': (n) => TYPE_COLOR[n.data('ptype')] || DEFAULT_COLOR,
            'overlay-opacity': 0
        }},
        { selector: 'node[ptype="StartProcess"], node[ptype="EndProcess"]', style: {
            'shape': 'ellipse', 'background-color': (n) => TYPE_COLOR[n.data('ptype')] || DEFAULT_COLOR,
            'color': '#ffffff', 'font-weight': 'bold', 'width': 56, 'height': 56, 'text-max-width': '48px'
        }},
        { selector: 'node[ptype="Condition"]', style: {
            'shape': 'diamond', 'background-color': '#fff8ec', 'text-max-width': '110px',
            'width': 'label', 'height': 'label', 'padding': '18px'
        }},
        // 서비스 호출(다른 WF로 넘어가는) 단계는 점선 테두리 + 옅은 보라 배경으로 "여기서 다른
        // 화면(흐름도)으로 이동할 수 있다"는 것을 시각적으로 구분한다. 더블클릭하면 이동한다
        // (라벨 끝의 "↗"도 같은 의도를 나타냄. labelOf() 에서 붙인다).
        { selector: 'node[ptype="service"]', style: {
            'border-style': 'dashed', 'border-width': 3,
            'background-color': '#f5f1fe'
        }},
        { selector: 'node.flow-selected', style: { 'border-width': 4, 'border-color': '#0b1220' } },
        // 검색 일치/비일치 표시 — 그래프 탭 검색(gv-hit/gv-dim)과 같은 시각 언어를 그대로 쓴다.
        { selector: 'node.gv-hit', style: { 'border-color': '#eab308', 'border-width': 4, 'background-blacken': -0.15 } },
        { selector: 'node.gv-dim', style: { 'opacity': 0.28 } },
        { selector: 'edge.gv-dim', style: { 'opacity': 0.15 } },
        // 반복(iterator)/조건분기 등, 내부에 하위 흐름(child.process)을 가진 노드는 점선 테두리로
        // 표시해서 "더블클릭하면 내부로 들어갈 수 있다"는 걸 서비스콜 단계와 같은 시각 언어로
        // 알려준다(2026-08-19 — 예전엔 이 내부를 같은 캔버스 안에 점선 박스로 함께 그렸는데,
        // 실제 렌더링 크기가 라벨마다 달라 다음 메인 흐름 노드와 자꾸 겹치는 문제가 반복됐다.
        // 그래서 이제는 서비스콜과 완전히 같은 방식으로 — 내부를 별도의 독립된 화면으로 분리하고
        // [◀ 뒤로]로 오갈 수 있게 했다. 그러면 메인 흐름은 항상 곧게 유지되고, 내부는 내부대로
        // 자기 자신만의 시작/종료를 가진 완결된 흐름으로 보여서 따라가기 쉽다).
        { selector: 'node.flow-container', style: {
            'border-style': 'dashed', 'border-width': 3
        }},
        { selector: 'edge', style: {
            'width': 1.6, 'line-color': '#c2ccd8',
            'target-arrow-color': '#c2ccd8', 'target-arrow-shape': 'triangle',
            'curve-style': 'bezier', 'arrow-scale': 0.9,
            'label': 'data(label)', 'font-size': 9, 'color': '#b45309',
            'text-background-color': '#fff', 'text-background-opacity': 1,
            'text-background-padding': 2, 'text-rotation': 'autorotate'
        }},
        { selector: 'edge[isElse="true"]', style: { 'line-style': 'dashed', 'line-color': '#94a3b8', 'target-arrow-color': '#94a3b8' } },
        { selector: 'edge[isCond="true"]', style: { 'line-color': '#f59e0b', 'target-arrow-color': '#f59e0b' } }
      ],
      layout: { name: 'preset' }
    });

    cy.on('tap', 'node', (evt) => {
      cy.nodes().removeClass('flow-selected');
      evt.target.addClass('flow-selected');
      if (onStepTap) onStepTap(evt.target.id());
    });

    // 서비스콜(다른 WF 호출) 단계 더블클릭 → 그 WF 의 흐름도로 이동 요청(app.js 가 실제 이동을 처리).
    cy.on('dbltap', 'node[ptype="service"]', (evt) => {
      if (!onServiceJump) return;
      const d = evt.target.data();
      onServiceJump(d.serviceId || null, d.serviceUid || null, evt.target.id());
    });
    // 서비스콜 단계는 이동 가능하다는 것을 커서로도 알려준다(마우스 오버 시 포인터 커서).
    cy.on('mouseover', 'node[ptype="service"]', () => { container.style.cursor = 'pointer'; });
    cy.on('mouseout', 'node[ptype="service"]', () => { container.style.cursor = 'default'; });

    // 반복(iterator)/분기 등 내부 흐름이 있는 단계 더블클릭 → 그 내부로 화면 전환 요청.
    cy.on('dbltap', 'node[isContainer="true"]', (evt) => {
      if (!onContainerJump) return;
      onContainerJump(evt.target.id());
    });
    cy.on('mouseover', 'node[isContainer="true"]', () => { container.style.cursor = 'pointer'; });
    cy.on('mouseout', 'node[isContainer="true"]', () => { container.style.cursor = 'default'; });

    setupSpacePan(container);
    initMinimap(container);
    return cy;
  }

  /* ---------- 스페이스바 패닝 모드 (그래프 탭과 동일한 동작) ---------- */
  // 스페이스바를 누르고 있는 동안: 노드 선택/드래그를 끄고 화면 이동(패닝) 전용 + 손모양 커서.
  let _spaceOn = false;
  function setupSpacePan(container) {
    const enter = () => {
      if (_spaceOn || !cy) return;
      _spaceOn = true;
      cy.autoungrabify(true);
      cy.boxSelectionEnabled(false);
      cy.userPanningEnabled(true);
      container.classList.add('pan-mode');
    };
    const leave = () => {
      if (!_spaceOn || !cy) return;
      _spaceOn = false;
      cy.autoungrabify(false);
      cy.boxSelectionEnabled(true);
      container.classList.remove('pan-mode', 'pan-active');
    };

    window.addEventListener('keydown', (e) => {
      const t = e.target;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (e.code === 'Space' && !typing) { e.preventDefault(); enter(); }
    });
    window.addEventListener('keyup', (e) => { if (e.code === 'Space') leave(); });
    window.addEventListener('blur', leave);

    container.addEventListener('mousedown', () => { if (_spaceOn) container.classList.add('pan-active'); });
    window.addEventListener('mouseup', () => container.classList.remove('pan-active'));

    setupMiddlePan(container);
  }

  /* ---------- 마우스 휠(가운데) 버튼 패닝 ---------- */
  function setupMiddlePan(container) {
    let panning = false, lastX = 0, lastY = 0;
    container.addEventListener('mousedown', (e) => {
      if (e.button !== 1 || !cy) return;
      e.preventDefault();
      panning = true; lastX = e.clientX; lastY = e.clientY;
      container.classList.add('wheel-pan');
    });
    window.addEventListener('mousemove', (e) => {
      if (!panning || !cy) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      cy.panBy({ x: dx, y: dy });
    });
    const stop = () => { if (panning) { panning = false; container.classList.remove('wheel-pan'); } };
    window.addEventListener('mouseup', (e) => { if (e.button === 1) stop(); });
    window.addEventListener('blur', stop);
    container.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });
  }

  // RESOURCE_WF(JSON 문자열) → { process, connector, serviceId, serviceName }
  function parseResourceWf(rawText) {
    if (!rawText) return null;
    let rwf;
    try { rwf = JSON.parse(rawText); } catch (e) { return null; }
    const svc = rwf && rwf.service;
    const child = svc && svc.child;
    if (!child || !Array.isArray(child.process)) return null;
    return {
      process: child.process,
      connector: Array.isArray(child.connector) ? child.connector : [],
      serviceId: svc.serviceId, serviceName: svc.serviceName
    };
  }

  function typeOf(p) { return p.processType || p.type || 'unknown'; }

  // 캔버스에 표시할 라벨(짧게). 전체 내용은 클릭 시 상세 패널에서 확인.
  function labelOf(p) {
    const t = typeOf(p);
    const pv = p.propertyValue || {};
    switch (t) {
      case 'StartProcess': return '시작';
      case 'EndProcess': return pv.processNm ? ('종료\n(' + truncate(pv.processNm, 14) + ')') : '종료';
      case 'Condition': {
        const cond = (pv.condition && pv.condition.filter) || pv.processNm || '';
        return truncate(cond, 40) || '조건';
      }
      case 'SelectEntityByQuery': return '🔍 조회' + (pv.processNm ? ('\n→ ' + truncate(pv.processNm, 24)) : '');
      case 'SQLQueryExecution': return '🛠 SQL 실행' + (pv.processNm ? ('\n' + truncate(pv.processNm, 24)) : '');
      case 'EntityDefinition': return '📦 ' + truncate(pv.processNm || pv.tableNm || pv.entityNm || t, 24);
      case 'Message': return '💬 ' + truncate(pv.processNm || pv.message || '메시지', 40);
      // 끝의 "↗"는 이 단계가 다른 WF(서비스)를 호출한다는 뜻 — 더블클릭하면 그 WF의 흐름도로 이동한다.
      case 'service': return '⚙ ' + truncate(pv.serviceName || pv.serviceId || '서비스 호출', 28) + ' ↗';
      case 'code': return '📝 코드 실행' + (pv.processNm ? ('\n(' + truncate(pv.processNm, 20) + ')') : '');
      case 'iterator': return '🔁 반복' + (pv.processNm || pv.iteratorVariable ? ('\n' + truncate(pv.processNm || pv.iteratorVariable, 20)) : '');
      default: return truncate(pv.processNm || t, 30);
    }
  }

  function edgeLabel(c) {
    const pv = c.propertyValue || {};
    if (pv.filter) return truncate(pv.filter, 32);
    if (pv.elseYn) return 'else';
    return '';
  }

  // 하위 흐름(child.process)이 있는 모든 스텝을 재귀로 찾아 stepById(상세보기/이동용)와
  // containerHasChildren(내부 흐름 존재 여부)에 채워 넣는다. 캔버스에 그리진 않는다 — 어떤
  // 스코프(최상위 vs 특정 반복문/분기 내부)를 지금 보고 있든 compId로 바로 조회할 수 있게 하는
  // 게 목적이다(2026-08-19: 컨테이너 내부는 이제 같은 캔버스에 함께 그리지 않고 완전히 별도의
  // 화면으로 분리했다 — buildScopeElements/renderScope 참고).
  function walkAll(processArr, depth, seen) {
    if (!Array.isArray(processArr) || depth > 12) return; // 순환/과深 방지 가드
    processArr.forEach((p) => {
      if (!p || !p.compId || seen.has(p.compId)) return;
      seen.add(p.compId);
      stepById[p.compId] = p;
      const child = p.child;
      if (child && Array.isArray(child.process) && child.process.length) {
        containerHasChildren[p.compId] = true;
        walkAll(child.process, depth + 1, seen);
      }
    });
  }

  // 지금 보여줄 한 "화면 분량"(최상위 전체 또는 특정 컨테이너의 내부)의 process/connector 로
  // Cytoscape elements 를 만든다.
  //   wrapStartEnd=true 면 진입점(들)/종료점(들)을 자동으로 찾아 합성 시작·종료 원을 앞뒤에
  //   붙인다 — 반복문/분기 내부는 원래 자기 자신의 시작·종료 노드가 없기 때문에(최상위에만
  //   실제 StartProcess/EndProcess 가 있음), 그 스코프만 봐도 "완결된 하나의 흐름"처럼 보이게
  //   하기 위함이다(사용자 요청: 루프도 자기 시작/종료를 갖는 별도 화면으로).
  function buildScopeElements(processArr, connArr, wrapStartEnd) {
    const els = [];
    processArr = processArr || []; connArr = connArr || [];
    origPositions = {}; // 새 스코프를 그릴 때마다 원본 좌표 보관소를 새로 채운다.
    const idsInScope = new Set(processArr.map((p) => p.compId));
    processArr.forEach((p) => {
      const t = typeOf(p);
      const isContainer = !!containerHasChildren[p.compId];
      let label = labelOf(p);
      if (isContainer) label += '\n(내부 ' + p.child.process.length + '단계)';
      const el = {
        data: { id: p.compId, label: label, ptype: t },
        classes: 'flow-' + slug(t) + (isContainer ? ' flow-container' : '')
      };
      if (isContainer) el.data.isContainer = 'true';
      // 서비스콜 단계: 더블클릭으로 이동할 때 필요한 대상 식별자를 노드 data 에 실어둔다.
      if (t === 'service') {
        const pv = p.propertyValue || {};
        el.data.serviceId = pv.serviceId || null;
        el.data.serviceUid = pv.serviceUid != null ? String(pv.serviceUid) : null;
      }
      // 지금 스코프 안에서는 원본 디자이너 좌표를 그대로 써도 안전하다(더 이상 여러 스코프를
      // 한 캔버스에 함께 그리지 않으므로 부모 오프셋을 누적할 필요가 없다).
      if (p.position && typeof p.position.x === 'number' && typeof p.position.y === 'number') {
        el.position = p.position;
        origPositions[p.compId] = p.position;
      }
      els.push(el);
    });

    const scopedConns = connArr.filter((c) => c.processFrom && c.processTo && idsInScope.has(c.processFrom) && idsInScope.has(c.processTo));
    scopedConns.forEach((c) => {
      const pv = c.propertyValue || {};
      els.push({
        data: {
          id: 'e_' + (c.compId || (c.processFrom + '__' + c.processTo)),
          source: c.processFrom, target: c.processTo,
          label: edgeLabel(c),
          isElse: pv.elseYn ? 'true' : 'false',
          isCond: (!pv.elseYn && pv.filter) ? 'true' : 'false'
        }
      });
    });

    if (wrapStartEnd && processArr.length) {
      const hasIncoming = new Set(scopedConns.map((c) => c.processTo));
      const hasOutgoing = new Set(scopedConns.map((c) => c.processFrom));
      const roots = processArr.filter((p) => !hasIncoming.has(p.compId));
      const leaves = processArr.filter((p) => !hasOutgoing.has(p.compId));
      const xs = processArr.map((p) => p.position && p.position.x).filter((v) => typeof v === 'number');
      const avgX = xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
      const rootYs = roots.map((p) => p.position && p.position.y).filter((v) => typeof v === 'number');
      const leafYs = leaves.map((p) => p.position && p.position.y).filter((v) => typeof v === 'number');
      const minY = rootYs.length ? Math.min.apply(null, rootYs) : 0;
      const maxY = leafYs.length ? Math.max.apply(null, leafYs) : 200;
      const startId = '__synthStart', endId = '__synthEnd';
      const startPos = { x: avgX, y: minY - 150 }, endPos = { x: avgX, y: maxY + 150 };
      els.push({ data: { id: startId, label: '시작', ptype: 'StartProcess' }, position: startPos });
      els.push({ data: { id: endId, label: '종료', ptype: 'EndProcess' }, position: endPos });
      origPositions[startId] = startPos;
      origPositions[endId] = endPos;
      roots.forEach((p) => els.push({ data: { id: 'se_' + startId + '_' + p.compId, source: startId, target: p.compId } }));
      leaves.forEach((p) => els.push({ data: { id: 'se_' + p.compId + '_' + endId, source: p.compId, target: endId } }));
    }
    return els;
  }

  // raw: RESOURCE_WF JSON 문자열. layoutName 생략 시 계층(breadthfirst) 배치로 그린다.
  // 최상위 화면(전체 process/connector, 실제 Start/End 그대로)을 그린다. 동시에 이 WF 전체
  // (모든 깊이의 반복문/분기 내부 포함)를 stepById 에 훑어 담아둬서, 이후 renderScope() 로
  // 언제든 특정 컨테이너 내부로 바로 들어갈 수 있게 한다.
  // 성공적으로 그렸으면 true, 파싱/구조 실패면 false.
  function render(rawText, layoutName) {
    if (!cy) return false;
    cy.elements().remove();
    const steps = parseResourceWf(rawText);
    if (!steps || !steps.process.length) { hasSteps = false; stepById = {}; containerHasChildren = {}; drawMinimap(); return false; }
    hasSteps = true;
    stepById = {}; containerHasChildren = {};
    walkAll(steps.process, 0, new Set());
    cy.add(buildScopeElements(steps.process, steps.connector, false));
    relayout(layoutName || 'breadthfirst');
    drawMinimap();
    return true;
  }

  // compId 가 가리키는 스텝(반복문/분기 등)의 내부(child.process/connector)만 별도의 완결된
  // 화면으로 그린다 — 자기 자신의 시작/종료 원을 자동으로 붙여서, 이 스코프만 봐도 하나의
  // 온전한 흐름처럼 보이게 한다. render() 가 먼저 호출돼 stepById 가 채워져 있어야 한다.
  // 성공(내부 흐름이 실제로 있음) 시 true, 아니면 false.
  function renderScope(compId, layoutName) {
    if (!cy) return false;
    const step = stepById[compId];
    if (!step || !step.child || !Array.isArray(step.child.process) || !step.child.process.length) return false;
    cy.elements().remove();
    cy.add(buildScopeElements(step.child.process, step.child.connector || [], true));
    relayout(layoutName || 'breadthfirst');
    drawMinimap();
    return true;
  }

  function clear() {
    if (cy) cy.elements().remove();
    hasSteps = false; stepById = {}; containerHasChildren = {}; origPositions = {};
    drawMinimap();
  }

  function relayout(name) {
    if (!cy) return;
    // 탭이 숨겨져 있는 동안(display:none) 컨테이너 크기가 0으로 측정될 수 있어,
    // 배치/맞춤 전에 항상 실제 크기를 다시 읽어들인다(흐름도 탭 전환 직후에도 정확히 맞춰지도록).
    cy.resize();
    const lay = name || 'preset';
    if (lay === 'breadthfirst') {
      cy.layout({
        name: 'breadthfirst', directed: true, spacingFactor: 1.5,
        avoidOverlap: true, nodeDimensionsIncludeLabels: true,
        roots: cy.nodes('[ptype="StartProcess"]'),
        padding: 40, fit: true, animate: false
      }).run();
    } else {
      // 'preset' 은 process[].position(디자이너 원본 좌표, 합성 시작/종료는 추정 좌표)을 그대로
      // 써야 한다. Cytoscape 의 preset 레이아웃은 positions 옵션을 안 주면 "지금 노드가 있는
      // 그 자리"를 그대로 두는 사실상 무동작 레이아웃이라, 계층(breadthfirst) 배치를 먼저 본 뒤
      // 이 배치로 되돌아오면 원본 좌표가 아니라 방금 전 계층 배치 결과가 그대로 남아 두 배치가
      // 똑같아 보이는 문제가 있었다. buildScopeElements 가 만들어 둔 origPositions 로 명시적으로
      // 되돌린다.
      cy.layout({
        name: lay, padding: 40, animate: false, fit: true,
        positions: (node) => origPositions[node.id()] || node.position()
      }).run();
    }
    drawMinimap();
  }

  function fit() { if (!cy) return; cy.resize(); cy.fit(undefined, 40); drawMinimap(); }

  function getStep(compId) { return stepById[compId] || null; }
  function hasData() { return hasSteps; }

  // 시작/종료 노드로 이동하여 확대(=selectAndZoom 재사용). 흐름도에 해당 노드가 없으면 false.
  // 시작/종료 노드는 원형(56×56)으로 작아서 기본 확대(=1배)로 딱 맞춰 채우면 너무 크게 확대된
  // 느낌이 들기 때문에, 여기서는 절반 배율(zoomFactor 0.5)로 덜 확대해서 이동한다.
  function goToPtype(ptype) {
    if (!cy) return false;
    const node = cy.nodes('[ptype="' + ptype + '"]').first();
    if (!node || node.empty()) return false;
    return selectAndZoom(node.id(), { zoomFactor: 0.5 });
  }
  function goToStart() { return goToPtype('StartProcess'); }
  function goToEnd() { return goToPtype('EndProcess'); }

  // 지금 화면(현재 스코프)에 그려진 단계들을 라벨/이름/메시지/테이블/서비스ID/조건식/코드 등에서
  // 검색한다. 그래프 탭 검색과 같은 방식 — 일치 노드는 gv-hit(노란 테두리), 나머지는 흐리게
  // (gv-dim) 표시하고, 일치가 있으면 화면을 그쪽으로 맞춘다. 반복문/분기 내부처럼 지금 화면에
  // 없는(다른 스코프의) 단계는 검색 대상에서 빠진다 — 실제로 보이지 않는 결과를 "찾았다"고
  // 하면 혼란스럽기 때문이다.
  // term 이 빈 문자열이면 하이라이트만 지우고 0을 반환한다.
  function search(term) {
    if (!cy) return 0;
    cy.nodes().removeClass('gv-hit gv-dim');
    cy.edges().removeClass('gv-dim');
    const t = String(term == null ? '' : term).trim().toLowerCase();
    if (!t) return 0;
    let hits = 0;
    const hitEles0 = [];
    cy.nodes().forEach((n) => {
      const compId = n.id();
      const step = stepById[compId];
      const pv = (step && step.propertyValue) || {};
      const hay = [
        n.data('label'), compId, pv.processNm, pv.message, pv.messageCode,
        pv.serviceId, pv.serviceName, pv.tableNm, pv.entityVariable, pv.code,
        pv.condition && pv.condition.filter
      ].filter(Boolean).join(' \n ').toLowerCase();
      if (hay.indexOf(t) !== -1) { n.addClass('gv-hit'); hits++; hitEles0.push(n); }
      else n.addClass('gv-dim');
    });
    cy.edges().forEach((e) => {
      if (!e.source().hasClass('gv-hit') || !e.target().hasClass('gv-hit')) e.addClass('gv-dim');
    });
    const hitEles = cy.collection(hitEles0);
    if (hitEles.length === 1) {
      cy.stop();
      cy.animate({ center: { eles: hitEles }, zoom: Math.max(cy.zoom(), 0.9) }, { duration: 250 });
    } else if (hitEles.length > 1) {
      cy.stop();
      cy.animate({ fit: { eles: hitEles, padding: 60 } }, { duration: 250 });
    }
    return hits;
  }

  // 상세 패널의 SQL 문자열(parser.js 가 추출한 텍스트)이 흐름도의 어느 단계(compId)에서 온
  // 것인지 역으로 찾는다. parser.js 와 동일한 후보 필드명을 검사하고, 공백만 정규화해 비교한다
  // (양쪽 모두 JSON 이스케이프가 풀린 동일한 원문 문자열이므로 앞부분만 비교해도 충분히 안전하다).
  const SQL_FIELD_KEYS = ['query', 'sql', 'sqlText', 'queryText', 'selectQuery', 'sqlStatement', 'statement', 'nativeQuery', 'dmlQuery', 'mainQuery'];
  function normSql(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, 200); }
  function findStepByQuery(queryText) {
    const target = normSql(queryText);
    if (!target) return null;
    for (const compId in stepById) {
      const pv = stepById[compId].propertyValue || {};
      for (let i = 0; i < SQL_FIELD_KEYS.length; i++) {
        const v = pv[SQL_FIELD_KEYS[i]];
        if (v && normSql(v) === target) return compId;
      }
    }
    return null;
  }

  // 해당 단계(compId)를 선택 표시하고 화면 중앙으로 줌인한다. onStepTap 콜백도 호출해
  // 우측 상세박스가 일반 노드 클릭과 동일하게 갱신되도록 한다.
  // opts.zoomFactor: 딱 맞춰 채우는(fit) 배율에 곱하는 값(기본 1 = 기존과 동일). 1보다 작으면
  // 덜 확대된 상태로 이동한다(예: 시작/종료처럼 작은 노드에 너무 바짝 확대되는 것을 완화).
  function selectAndZoom(compId, opts) {
    if (!cy) return false;
    const node = cy.getElementById(compId);
    if (!node || node.empty()) return false;
    cy.resize();
    cy.nodes().removeClass('flow-selected');
    node.addClass('flow-selected');
    const padding = 80;
    const zoomFactor = (opts && opts.zoomFactor != null) ? opts.zoomFactor : 1;
    if (zoomFactor === 1) {
      cy.animate({ fit: { eles: node, padding: padding } }, { duration: 300 });
    } else {
      // fit 이 실제로 만들어낼 배율을 재현한다. 시작/종료 노드처럼 아주 작은 노드는 padding 대비
      // 계산상 배율(rawFitZoom)이 maxZoom(3)을 훌쩍 넘기 때문에, 먼저 maxZoom 으로 한 번 클램프해
      // "실제 fit 결과 배율"을 구한 뒤 그 값에 zoomFactor 를 곱해야 진짜로 절반만큼 덜 확대된다
      // (클램프 전 배율에 곱하면 어차피 둘 다 maxZoom 에 다시 눌려서 차이가 사라져버린다).
      const bb = node.boundingBox();
      const w = cy.width(), h = cy.height();
      const rawFitZoom = Math.min((w - padding * 2) / bb.w, (h - padding * 2) / bb.h);
      const actualFitZoom = Math.max(cy.minZoom(), Math.min(cy.maxZoom(), rawFitZoom));
      const targetZoom = Math.max(cy.minZoom(), actualFitZoom * zoomFactor);
      const cx = (bb.x1 + bb.x2) / 2, cyMid = (bb.y1 + bb.y2) / 2;
      const pan = { x: w / 2 - cx * targetZoom, y: h / 2 - cyMid * targetZoom };
      cy.animate({ zoom: targetZoom, pan: pan }, { duration: 300 });
    }
    if (onStepTap) onStepTap(compId);
    return true;
  }

  /* ---------- 미니맵 ----------
   * 전체 흐름도를 작게 그려 지금 보고 있는 부분(뷰포트)이 전체 중 어디인지 보여준다.
   * - 좌상단 기본 배치: 쿼리 상세 팝업(.flow-stepbox, 우측 대부분을 차지)·범례(좌하단)와 겹치지 않음.
   * - 미니맵 안을 클릭/드래그하면 그 지점으로 메인 캔버스가 이동(줌은 유지)한다.
   * - 헤더 바를 드래그하면 미니맵 자체의 위치를 옮길 수 있고, 그 위치는 localStorage 에 저장되어
   *   다음에 흐름도를 열어도 유지된다.
   */
  function initMinimap(flowContainer) {
    const root = flowContainer.parentElement;
    if (!root) return;
    mmBox = root.querySelector('#flowMinimap');
    mmHead = root.querySelector('#flowMinimapHead');
    mmCanvas = root.querySelector('#flowMinimapCanvas');
    if (!mmBox || !mmHead || !mmCanvas) return;
    mmCtx = mmCanvas.getContext('2d');

    restoreMinimapPos(root);
    bindMinimapDrag(root);
    bindMinimapClickPan();

    // pan/zoom/레이아웃 변경 등 화면이 바뀔 때마다 뷰포트 사각형을 다시 그린다.
    cy.on('render', () => drawMinimap());
  }

  // 캔버스의 실제 픽셀 크기를 CSS 표시 크기에 맞춘다(탭이 숨겨진 동안엔 0×0으로 측정되므로,
  // 그릴 때마다 다시 확인해서 흐름도 탭을 처음 열었을 때도 정확한 크기로 그려지게 한다).
  function ensureMinimapCanvasSize() {
    if (!mmCanvas) return false;
    const rect = mmCanvas.getBoundingClientRect();
    const w = Math.round(rect.width), h = Math.round(rect.height);
    if (!w || !h) return false;
    if (mmCanvas.width !== w || mmCanvas.height !== h) { mmCanvas.width = w; mmCanvas.height = h; }
    return true;
  }

  function drawMinimap() {
    if (!mmCtx) return;
    if (!minimapEnabled || !cy || !hasSteps) { if (mmCtx && mmCanvas) mmCtx.clearRect(0, 0, mmCanvas.width, mmCanvas.height); return; }
    if (!ensureMinimapCanvasSize()) return;
    const w = mmCanvas.width, h = mmCanvas.height;
    mmCtx.clearRect(0, 0, w, h);
    const nodes = cy.nodes();
    if (!nodes.length) return;
    const bb = nodes.boundingBox();
    const bw = Math.max(1, bb.w), bh = Math.max(1, bb.h);
    const pad = 8;
    const scale = Math.min((w - pad * 2) / bw, (h - pad * 2) / bh);
    const offX = (w - bw * scale) / 2, offY = (h - bh * scale) / 2;
    const toCanvas = (mx, my) => ({ x: offX + (mx - bb.x1) * scale, y: offY + (my - bb.y1) * scale });
    mmMapState = { bb, scale, offX, offY };

    nodes.forEach(n => {
      const pos = n.position();
      const c = toCanvas(pos.x, pos.y);
      mmCtx.fillStyle = TYPE_COLOR[n.data('ptype')] || DEFAULT_COLOR;
      mmCtx.fillRect(c.x - 2, c.y - 2, 4, 4);
    });

    // 현재 화면에 보이는 영역(뷰포트)을 사각형으로 표시
    const ext = cy.extent();
    const p1 = toCanvas(ext.x1, ext.y1), p2 = toCanvas(ext.x2, ext.y2);
    const rx = Math.min(p1.x, p2.x), ry = Math.min(p1.y, p2.y);
    const rw = Math.abs(p2.x - p1.x), rh = Math.abs(p2.y - p1.y);
    mmCtx.fillStyle = 'rgba(31,111,214,.10)';
    mmCtx.fillRect(rx, ry, rw, rh);
    mmCtx.strokeStyle = '#1f6fd6';
    mmCtx.lineWidth = 1.5;
    mmCtx.strokeRect(rx, ry, rw, rh);
  }

  // 미니맵 클릭/드래그 → 그 지점을 메인 캔버스 중앙으로(줌 배율은 그대로 유지).
  function bindMinimapClickPan() {
    const panToEvent = (evt) => {
      if (!mmMapState || !cy) return;
      const rect = mmCanvas.getBoundingClientRect();
      const cx = evt.clientX - rect.left, cy2 = evt.clientY - rect.top;
      const { bb, scale, offX, offY } = mmMapState;
      const model = { x: bb.x1 + (cx - offX) / scale, y: bb.y1 + (cy2 - offY) / scale };
      const zoom = cy.zoom();
      cy.pan({ x: cy.width() / 2 - model.x * zoom, y: cy.height() / 2 - model.y * zoom });
    };
    mmCanvas.addEventListener('mousedown', (e) => { mmPanning = true; panToEvent(e); });
    window.addEventListener('mousemove', (e) => { if (mmPanning) panToEvent(e); });
    window.addEventListener('mouseup', () => { mmPanning = false; });
  }

  // 미니맵 패널 자체의 위치를 드래그로 옮긴다(헤더 바만 드래그 핸들로 사용).
  function bindMinimapDrag(root) {
    let dragging = false, startX = 0, startY = 0, startLeft = 0, startTop = 0;
    mmHead.addEventListener('mousedown', (e) => {
      dragging = true;
      startX = e.clientX; startY = e.clientY;
      const rect = mmBox.getBoundingClientRect();
      const rootRect = root.getBoundingClientRect();
      startLeft = rect.left - rootRect.left;
      startTop = rect.top - rootRect.top;
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const rootRect = root.getBoundingClientRect();
      let left = startLeft + (e.clientX - startX);
      let top = startTop + (e.clientY - startY);
      const maxLeft = Math.max(0, rootRect.width - mmBox.offsetWidth);
      const maxTop = Math.max(0, rootRect.height - mmBox.offsetHeight);
      left = Math.max(0, Math.min(maxLeft, left));
      top = Math.max(0, Math.min(maxTop, top));
      mmBox.style.left = left + 'px';
      mmBox.style.top = top + 'px';
      mmBox.style.right = 'auto';
    });
    window.addEventListener('mouseup', () => { if (dragging) { dragging = false; saveMinimapPos(); } });
  }
  function saveMinimapPos() {
    if (!mmBox) return;
    try { localStorage.setItem(MM_POS_KEY, JSON.stringify({ left: mmBox.style.left, top: mmBox.style.top })); } catch (e) {}
  }
  function restoreMinimapPos() {
    if (!mmBox) return;
    try {
      const raw = localStorage.getItem(MM_POS_KEY);
      if (!raw) return;
      const pos = JSON.parse(raw);
      if (pos && pos.left) { mmBox.style.left = pos.left; mmBox.style.right = 'auto'; }
      if (pos && pos.top) mmBox.style.top = pos.top;
    } catch (e) {}
  }
  function setMinimapEnabled(on) {
    minimapEnabled = !!on;
    if (mmBox) mmBox.classList.toggle('hidden', !minimapEnabled);
    if (minimapEnabled) drawMinimap();
  }

  return {
    init, render, renderScope, clear, relayout, fit, getStep, hasData, findStepByQuery, selectAndZoom,
    goToStart, goToEnd, setMinimapEnabled, search
  };
})();
