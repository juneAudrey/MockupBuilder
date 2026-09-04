/* Cytoscape 그래프 래퍼 */
window.WaveGraph = (function () {
  let cy = null;
  let onNodeTap = null;
  let onNodeDblTap = null;

  const TYPE_COLOR = {
    UI: '#1f6fd6',   // 파랑
    Mo: '#8b5cf6',   // 보라
    WF: '#12a150',   // 초록
    Rp: '#e08e0b',   // 주황
    TABLE: '#6b7280' // 회색
  };

  function init(container, opts) {
    onNodeTap = (opts && opts.onNodeTap) || null;
    onNodeDblTap = (opts && opts.onNodeDblTap) || null;
    cy = cytoscape({
      container,
      wheelSensitivity: 0.2,
      minZoom: 0.15,
      maxZoom: 3,
      textureOnViewport: true,   // 이동/줌 중 텍스처 사용 → 렌더 부하 감소
      hideEdgesOnViewport: true, // 이동 중 엣지 숨김 → 부드럽게
      pixelRatio: 1,             // 고DPI에서 과도한 렌더 방지
      style: [
        { selector: 'node', style: {
            'background-color': (n) => TYPE_COLOR[n.data('type')] || '#6b7280',
            'label': 'data(label)',
            'color': '#0b1220',
            'font-size': 10,
            'font-family': 'Pretendard, "Malgun Gothic", sans-serif',
            'text-valign': 'bottom', 'text-halign': 'center', 'text-margin-y': 5,
            'text-wrap': 'wrap', 'text-max-width': 90,
            'text-background-color': '#ffffff', 'text-background-opacity': 0.82,
            'text-background-padding': 2, 'text-background-shape': 'round-rectangle',
            'width': 34, 'height': 34,
            'border-width': 2, 'border-color': '#ffffff',
            'overlay-opacity': 0
        }},
        { selector: 'node[type="TABLE"]', style: { 'shape': 'round-rectangle', 'width': 40, 'height': 24 } },
        { selector: 'node[root="1"]', style: {
            'width': 46, 'height': 46, 'border-width': 3, 'border-color': '#0b1220', 'font-weight': 'bold' } },
        { selector: 'node.in-basket', style: { 'border-color': '#ef4444', 'border-width': 3 } },
        { selector: 'node.cycle', style: { 'border-color': '#ef4444', 'border-style': 'dashed' } },
        { selector: 'node:selected', style: { 'border-color': '#f59e0b', 'border-width': 4 } },
        { selector: 'node.gv-hit', style: { 'border-color': '#eab308', 'border-width': 4,
            'background-blacken': -0.15 } },
        { selector: 'node.gv-dim', style: { 'opacity': 0.28 } },
        { selector: 'edge.gv-dim', style: { 'opacity': 0.15 } },
        { selector: 'edge', style: {
            'width': 1.4, 'line-color': '#c2ccd8',
            'target-arrow-color': '#c2ccd8', 'target-arrow-shape': 'triangle',
            'curve-style': 'bezier', 'arrow-scale': 0.9,
            'label': 'data(trigLabel)', 'font-size': 9, 'color': '#16a34a',
            'text-background-color': '#fff', 'text-background-opacity': 1,
            'text-background-padding': 2, 'text-rotation': 'autorotate' } },
        { selector: 'edge.cycle', style: { 'line-color': '#ef4444', 'line-style': 'dashed', 'target-arrow-color': '#ef4444' } },
        { selector: 'edge.opens', style: { 'line-color': '#1f6fd6', 'line-style': 'dashed', 'target-arrow-color': '#1f6fd6', 'width': 1.8, 'color': '#1f6fd6' } }
      ],
      layout: { name: 'concentric', minNodeSpacing: 40 }
    });

    let _lastTapId = null, _lastTapT = 0;
    cy.on('tap', 'node', (evt) => {
      const id = evt.target.id();
      const now = Date.now();
      if (onNodeTap) onNodeTap(id, evt.target.data());
      // 수동 더블탭 감지(같은 노드 350ms 내 재탭)
      if (id === _lastTapId && (now - _lastTapT) < 350) {
        if (onNodeDblTap) onNodeDblTap(id, evt.target.data());
        _lastTapId = null; _lastTapT = 0;
      } else {
        _lastTapId = id; _lastTapT = now;
      }
    });

    setupSpacePan(container);
    return cy;
  }

  /* ---------- 스페이스바 패닝 모드 ---------- */
  // 스페이스바를 누르고 있는 동안: 노드 선택/드래그를 끄고 화면 이동(패닝) 전용 + 손모양 커서.
  // 스페이스바를 놓으면 기본 상태(노드 선택/드래그 가능)로 복귀.
  let _spaceOn = false;
  function setupSpacePan(container) {
    const enter = () => {
      if (_spaceOn || !cy) return;
      _spaceOn = true;
      cy.autoungrabify(true);   // 노드 드래그 방지 → 빈 곳 드래그가 패닝이 됨
      cy.boxSelectionEnabled(false);
      cy.userPanningEnabled(true);
      container.classList.add('pan-mode');   // 커서: grab
    };
    const leave = () => {
      if (!_spaceOn || !cy) return;
      _spaceOn = false;
      cy.autoungrabify(false);  // 노드 드래그 복원
      cy.boxSelectionEnabled(true);
      container.classList.remove('pan-mode', 'pan-active');
    };

    window.addEventListener('keydown', (e) => {
      // 입력창에 포커스가 있으면 스페이스는 타이핑용 → 패닝 무시
      const t = e.target;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (e.code === 'Space' && !typing) {
        e.preventDefault();   // 페이지 스크롤 방지
        enter();
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') leave();
    });
    // 창 포커스 잃으면 안전하게 해제
    window.addEventListener('blur', leave);

    // 패닝 중 드래그하면 grabbing 커서
    container.addEventListener('mousedown', () => { if (_spaceOn) container.classList.add('pan-active'); });
    window.addEventListener('mouseup', () => container.classList.remove('pan-active'));

    setupMiddlePan(container);
  }

  /* ---------- 마우스 휠(가운데) 버튼 패닝 ---------- */
  // 휠 버튼을 누른 채 드래그하면 화면을 이동. 누르고 있는 동안 커서를 grabbing 으로 변경.
  function setupMiddlePan(container) {
    let panning = false, lastX = 0, lastY = 0;
    container.addEventListener('mousedown', (e) => {
      if (e.button !== 1 || !cy) return;   // 1 = 가운데(휠) 버튼
      e.preventDefault();                  // 미들클릭 자동스크롤 방지
      panning = true; lastX = e.clientX; lastY = e.clientY;
      container.classList.add('wheel-pan'); // 커서 grabbing (스페이스 패닝과 동일 느낌)
    });
    window.addEventListener('mousemove', (e) => {
      if (!panning || !cy) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      cy.panBy({ x: dx, y: dy });
    });
    const stop = () => { if (panning) { panning = false; container.classList.remove('wheel-pan'); } };
    window.addEventListener('mouseup', (e) => { if (e.button === 1) stop(); });
    window.addEventListener('blur', stop);   // 창 포커스 잃으면 해제
    // 미들버튼 클릭 시 브라우저 기본 자동스크롤 아이콘 방지
    container.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });
  }

  // 필터 상태 (기본: 테이블/순환 숨김)
  let _lastStore = null, _lastRoot = null, _lastBasket = null;
  let _filter = { showTable: false, showCycle: true, showSubUi: true };

  function setFilter(f) {
    _filter = Object.assign(_filter, f || {});
    if (_lastStore) render(_lastStore, _lastRoot, _lastBasket);
  }

  // store 의 nodes/edges 로 그래프 재구성
  function render(store, rootKey, basketSet) {
    if (!cy) return;
    _lastStore = store; _lastRoot = rootKey; _lastBasket = basketSet;
    const els = [];

    // 부가 UI 숨김 계산: 메인(root)이 opens 엣지로 여는 다른 UI + 그 UI 에서만 도달하는 하위 노드
    const hiddenSub = new Set();
    if (!_filter.showSubUi && rootKey) {
      // 1) opens 엣지의 대상 UI 들이 "부가 UI 서브트리의 시작점"
      const subRoots = [];
      store.edges.forEach(e => {
        if (e.relType === 'opens') {
          const tgt = store.nodes.get(e.to);
          if (tgt && (tgt.type === 'UI' || tgt.type === 'Mo') && e.to !== rootKey) subRoots.push(e.to);
        }
      });
      // 2) 메인에서 opens 를 거치지 않고 도달 가능한 노드 집합(=메인 파도) 계산
      const mainReach = new Set([rootKey]);
      const stack = [rootKey];
      while (stack.length) {
        const cur = stack.pop();
        store.edges.forEach(e => {
          if (e.from !== cur) return;
          if (e.relType === 'opens') return;           // 팝업 경로는 메인 파도에서 제외
          if (!mainReach.has(e.to)) { mainReach.add(e.to); stack.push(e.to); }
        });
      }
      // 3) 각 부가 UI 서브트리에서 도달하는 노드 중, 메인 파도에 없는 것만 숨김
      subRoots.forEach(sr => {
        const seen = new Set([sr]);
        const st = [sr];
        while (st.length) {
          const cur = st.pop();
          if (!mainReach.has(cur)) hiddenSub.add(cur);
          store.edges.forEach(e => {
            if (e.from !== cur) return;
            if (!seen.has(e.to)) { seen.add(e.to); st.push(e.to); }
          });
        }
        if (!mainReach.has(sr)) hiddenSub.add(sr);
      });
    }

    // 필터: 표시할 노드 key 집합
    const visible = new Set();
    store.nodes.forEach(n => {
      if (n.type === 'TABLE' && !_filter.showTable) return;
      if (n.cycle && !_filter.showCycle) return;
      if (hiddenSub.has(n.key)) return;
      visible.add(n.key);
    });
    store.nodes.forEach(n => {
      if (!visible.has(n.key)) return;
      els.push({ data: {
        id: n.key, label: (n.name ? (n.name) : (n.id || n.uid)),
        type: n.type, root: n.key === rootKey ? '1' : '0'
      }, classes: (n.cycle ? 'cycle ' : '') + (basketSet && basketSet.has(n.key) ? 'in-basket' : '') });
    });
    store.edges.forEach(e => {
      if (!visible.has(e.from) || !visible.has(e.to)) return;
      if (e.cycle && !_filter.showCycle) return;
      const cls = e.cycle ? 'cycle' : (e.relType === 'opens' ? 'opens' : '');
      els.push({ data: { id: e.from + '__' + e.to, source: e.from, target: e.to,
                 trigLabel: e.trigger && e.trigger.label ? e.trigger.label : '' },
                 classes: cls });
    });
    cy.elements().remove();
    cy.add(els);
    const sel = document.getElementById('layoutSel');
    relayout(sel ? sel.value : 'cose');
  }

  function relayout(name) {
    if (!cy) return;
    // 그래프 탭이 숨겨져 있는 동안(display:none) 컨테이너 크기가 0으로 측정될 수 있어,
    // 배치 전에 항상 실제 크기를 다시 읽어들인다(탭 전환 직후에도 정확히 배치되도록).
    cy.resize();
    const nodeCount = cy.nodes().length;
    const lay = name || 'breadthfirst';
    // animate:false → 배치 애니메이션이 계속 도는 것을 막아 입력 버벅거림 제거
    let opts = { name: lay, padding: 40, animate: false, fit: true };

    if (lay === 'breadthfirst') {
      opts = Object.assign(opts, {
        directed: true, roots: cy.nodes('[root="1"]'),
        spacingFactor: nodeCount > 25 ? 2.2 : 1.7,
        avoidOverlap: true, nodeDimensionsIncludeLabels: true,
        circle: false, grid: false
      });
    } else if (lay === 'concentric') {
      opts = Object.assign(opts, {
        concentric: (n) => (n.data('root') === '1' ? 100 : (n.data('type') === 'TABLE' ? 1 : 10)),
        levelWidth: () => 1, minNodeSpacing: 70,
        avoidOverlap: true, nodeDimensionsIncludeLabels: true
      });
    } else if (lay === 'cose') {
      // 반복 횟수를 줄이고 애니메이션을 꺼서 CPU 점유·버벅거림 방지
      opts = Object.assign(opts, {
        idealEdgeLength: 140, nodeRepulsion: 12000, gravity: 0.3,
        numIter: nodeCount > 60 ? 300 : 500,
        nodeDimensionsIncludeLabels: true, randomize: false,
        animate: false
      });
    } else if (lay === 'circle') {
      opts = Object.assign(opts, { spacingFactor: 1.6, avoidOverlap: true, nodeDimensionsIncludeLabels: true });
    } else if (lay === 'grid') {
      opts = Object.assign(opts, { avoidOverlap: true, nodeDimensionsIncludeLabels: true, spacingFactor: 1.3 });
    }
    const layout = cy.layout(opts);
    layout.run();
  }

  function markBasket(basketSet) {
    if (!cy) return;
    cy.nodes().forEach(n => {
      if (basketSet.has(n.id())) n.addClass('in-basket'); else n.removeClass('in-basket');
    });
  }

  // 선택 강조만(중앙 이동 없음) — 상세 패널 표시 시 사용
  function select(key) {
    if (!cy) return;
    const n = cy.getElementById(key);
    if (!n || n.empty()) return;
    cy.nodes().unselect();
    n.select();
  }

  function focus(key) {
    if (!cy) return;
    const n = cy.getElementById(key);
    if (n && !n.empty()) { cy.nodes().unselect(); n.select(); cy.center(n); }
  }

  // 특정 노드를 선택하고 부드럽게 중앙으로 이동(더블클릭 → 그래프 이동용)
  // 레이아웃/렌더가 끝난 뒤 실제 위치로 이동하도록 stop() 후 애니메이트한다.
  function selectAndFocus(key) {
    if (!cy) return false;
    const n = cy.getElementById(key);
    if (!n || n.empty()) return false;
    cy.nodes().unselect();
    n.select();
    // 진행 중인 애니메이션을 멈추고(엉뚱한 좌표로 튀는 것 방지) 현재 확정된 위치로 이동
    cy.stop();
    cy.animate({ center: { eles: n }, zoom: Math.max(cy.zoom(), 1.5) }, { duration: 300 });
    return true;
  }

  function hasNode(key) { return cy ? !cy.getElementById(key).empty() : false; }

  // 검색어로 그래프 노드 강조. matchKeys: 일치 노드 key 집합(null 이면 강조 해제).
  // 일치 노드는 gv-hit, 나머지는 흐리게(gv-dim). 일치 노드가 1개면 중앙으로 이동.
  function highlight(matchKeys) {
    if (!cy) return 0;
    cy.nodes().removeClass('gv-hit gv-dim');
    cy.edges().removeClass('gv-dim');
    if (!matchKeys || !matchKeys.size) return 0;
    let hits = 0;
    cy.nodes().forEach(n => {
      if (matchKeys.has(n.id())) { n.addClass('gv-hit'); hits++; }
      else n.addClass('gv-dim');
    });
    cy.edges().forEach(e => {
      if (!matchKeys.has(e.source().id()) || !matchKeys.has(e.target().id())) e.addClass('gv-dim');
    });
    // 화면에 실제로 보이는 일치 노드들로 뷰 이동
    const hitEles = cy.nodes('.gv-hit');
    if (hitEles.length === 1) {
      cy.stop();
      cy.animate({ center: { eles: hitEles }, zoom: Math.max(cy.zoom(), 0.9) }, { duration: 250 });
    } else if (hitEles.length > 1) {
      cy.stop();
      cy.animate({ fit: { eles: hitEles, padding: 60 } }, { duration: 250 });
    }
    return hits;
  }

  function fit() { if (!cy) return; cy.resize(); cy.fit(undefined, 40); }
  // 탭을 다시 보이게 할 때 컨테이너 크기만 다시 재는 용도(숨겨진 동안 0 크기였을 수 있음) —
  // fit() 과 달리 전체 보기로 다시 맞추지 않아, 직전에 selectAndFocus() 로 맞춰둔 줌/중심을
  // 그대로 보존한다.
  function resize() { if (!cy) return; cy.resize(); }

  return { init, render, relayout, markBasket, focus, select, selectAndFocus, highlight, hasNode, setFilter, fit, resize, TYPE_COLOR };
})();
