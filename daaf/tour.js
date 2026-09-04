/* ============================================================
   Daaf Wave — 온보딩 투어 (스포트라이트 방식)
   - 첫 실행 시 자동 실행 (localStorage 'daaf_tour_done' 없을 때)
   - [다시 보지 않기] 체크 시 이후 자동 실행 안 함
   - 상단 [🧭 가이드] 버튼으로 언제든 다시 실행
   ============================================================ */
(function () {
  const KEY = 'daaf_tour_done';
  const $ = (id) => document.getElementById(id);

  // 투어 단계 — 큼지막한 기능 구분 중심, 핵심만 간결히
  const STEPS = [
    {
      sel: null, emoji: '🌊', kicker: '환영합니다',
      title: 'Daaf Wave 둘러보기',
      desc: '배포정보의 <b>연관관계</b>를 검색 → 파도타기 → 그래프·흐름도 확인 → 저장까지. <b>60초</b>면 핵심을 익힐 수 있어요.'
    },
    {
      sel: '#modeSwitch', emoji: '🗄', kicker: '1단계 · 모드',
      title: '먼저 동작 모드를 선택',
      desc: '<b>DB 연결</b>은 실데이터(MSSQL·MySQL·Oracle)를 바로 조회, <b>오프라인</b>은 미리 내려받은 로컬 데이터로 조회합니다.'
    },
    {
      sel: '.pane.search', emoji: '🔍', kicker: '2단계 · 검색',
      title: '프로그램을 검색해요',
      desc: '프로그램 ID·메뉴명·<b>상위 폴더</b>로 찾습니다. 결과 행을 <b>더블클릭</b>하면 바로 파도타기가 실행되고, 좌측 <b>UI 탭</b>에 그 화면 디자인이 함께 뜹니다.'
    },
    {
      sel: '.run-box', emoji: '🌊', kicker: '3단계 · 파도타기',
      title: '연관 조회 실행',
      desc: '볼 범위(<b>UI·WF·Rp·Mo</b>)를 고르고 <b>[▶ 연관 조회 실행]</b>. 깊이 제한 없이 연결된 서비스가 파도처럼 번져 펼쳐집니다.'
    },
    {
      sel: '#tabUi', emoji: '🖥', kicker: '4단계 · UI 탭',
      title: '디자인을 바로 확인',
      desc: '팝업 없이 화면 디자인을 바로 봅니다. 라벨 옆 <b>WF·UI·Rp</b> 뱃지를 눌러 연결된 화면·흐름도로 바로 이동할 수 있어요.'
    },
    {
      sel: '.pane.view', emoji: '📊', kicker: '5단계 · 확인',
      title: '그래프·테이블·흐름도',
      desc: '탭을 전환해 관계를 살펴봐요. <b>흐름도</b>에서는 WF 내부 로직(SQL·조건분기·서비스콜)까지 순서도로 볼 수 있어요.'
    },
    {
      sel: '.detail-pane', emoji: '🔎', kicker: '6단계 · 상세',
      title: '노드를 클릭하면 상세',
      desc: '참조 테이블·하위 서비스·<b>버튼→이벤트 트리거</b>·<b>공통코드</b>를 확인. 여기서 <b>[🔀 흐름도 보기]</b>로 진입합니다.'
    },
    {
      sel: '.basket', emoji: '💾', kicker: '7단계 · 저장',
      title: '담아서 저장',
      desc: '필요한 항목을 바구니에 담아 <b>부분 저장</b>, 또는 <b>[일괄 저장(전체)]</b>으로 JSON/CSV를 한 번에 내려받아요.'
    },
    {
      sel: '#btnGuide', emoji: '🎉', kicker: '준비 완료',
      title: '이제 시작해 보세요!',
      desc: '더 자세한 설명이 필요하면 언제든 <b>[❓ 사용법]</b>을, 이 투어를 다시 보려면 <b>[🧭 가이드]</b>를 누르세요.'
    }
  ];

  let idx = 0;
  let onResize = null;

  function tourEl() { return $('tour'); }

  function positionFor(step) {
    const spot = $('tourSpot');
    const pop = $('tourPop');
    const pad = 8;
    const vw = window.innerWidth, vh = window.innerHeight;

    if (!step.sel) {
      // 센터 모달 (타겟 없음)
      spot.style.opacity = '0';
      pop.classList.add('center');
      pop.style.left = '50%';
      pop.style.top = '50%';
      pop.style.transform = 'translate(-50%,-50%)';
      return;
    }
    const target = document.querySelector(step.sel);
    if (!target) { // 타겟이 없으면 센터로 폴백
      step.sel = null; return positionFor(step);
    }
    const r = target.getBoundingClientRect();

    // 스포트라이트 박스
    spot.style.opacity = '1';
    spot.style.left = (r.left - pad) + 'px';
    spot.style.top = (r.top - pad) + 'px';
    spot.style.width = (r.width + pad * 2) + 'px';
    spot.style.height = (r.height + pad * 2) + 'px';

    // 팝업 위치: 타겟 주변 빈 공간에 배치
    pop.classList.remove('center');
    pop.style.transform = 'none';
    const pw = 340, ph = pop.offsetHeight || 210;
    let left, top;

    const spaceRight = vw - r.right, spaceLeft = r.left,
          spaceBottom = vh - r.bottom, spaceTop = r.top;

    if (spaceRight >= pw + 20) {            // 오른쪽
      left = r.right + 16; top = clamp(r.top, 12, vh - ph - 12);
    } else if (spaceLeft >= pw + 20) {      // 왼쪽
      left = r.left - pw - 16; top = clamp(r.top, 12, vh - ph - 12);
    } else if (spaceBottom >= ph + 20) {    // 아래
      top = r.bottom + 16; left = clamp(r.left, 12, vw - pw - 12);
    } else {                                // 위
      top = r.top - ph - 16; left = clamp(r.left, 12, vw - pw - 12);
    }
    left = clamp(left, 12, vw - pw - 12);
    top = clamp(top, 12, vh - ph - 12);
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';

    // 화면 밖이면 스크롤해서 보이게
    if (r.top < 0 || r.bottom > vh) {
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function render() {
    const s = STEPS[idx];
    $('tourEmoji').textContent = s.emoji;
    $('tourKicker').textContent = s.kicker;
    $('tourTitle').textContent = s.title;
    $('tourDesc').innerHTML = s.desc;

    // 점 인디케이터
    const dots = $('tourDots');
    dots.innerHTML = '';
    STEPS.forEach((_, i) => {
      const d = document.createElement('span');
      d.className = 'tour-dot' + (i === idx ? ' on' : '');
      d.addEventListener('click', () => { idx = i; render(); });
      dots.appendChild(d);
    });

    $('tourPrev').style.visibility = idx === 0 ? 'hidden' : 'visible';
    $('tourNext').textContent = idx === STEPS.length - 1 ? '시작하기 🚀' : '다음 →';

    // 다음 프레임에 위치 계산(팝업 높이 확정 후)
    requestAnimationFrame(() => positionFor(s));
  }

  function open(reset) {
    idx = 0;
    tourEl().style.display = 'block';
    $('tourNever').checked = false;
    // 팝업 등장 애니메이션 리셋
    const pop = $('tourPop');
    pop.classList.remove('pop-in'); void pop.offsetWidth; pop.classList.add('pop-in');
    render();
    onResize = () => positionFor(STEPS[idx]);
    window.addEventListener('resize', onResize);
  }

  function close() {
    tourEl().style.display = 'none';
    if ($('tourNever').checked) { try { localStorage.setItem(KEY, '1'); } catch (e) {} }
    if (onResize) { window.removeEventListener('resize', onResize); onResize = null; }
  }

  function next() { if (idx < STEPS.length - 1) { idx++; render(); } else { close(); } }
  function prev() { if (idx > 0) { idx--; render(); } }

  function wire() {
    $('tourNext').addEventListener('click', next);
    $('tourPrev').addEventListener('click', prev);
    $('tourX').addEventListener('click', close);
    $('tourBackdrop').addEventListener('click', close);
    const btn = $('btnTour');
    if (btn) btn.addEventListener('click', () => open(true));

    // 키보드: → 다음, ← 이전, Esc 닫기
    document.addEventListener('keydown', (e) => {
      if (tourEl().style.display === 'none') return;
      if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });

    // 첫 실행 자동 투어
    let done = false;
    try { done = !!localStorage.getItem(KEY); } catch (e) {}
    if (!done) setTimeout(() => open(false), 650);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else { wire(); }
})();
