/* ===== Microsoft Clarity ===== */
    (function(c,l,a,r,i,t,y){
        c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
        t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
        y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
    })(window, document, "clarity", "script", "xssh91r5t1");

/* ===== Mockup Builder - 메인 로직 (에디터/클라우드/내보내기 등) ===== */
let comps=[]; let sel=null; let uid=1;
let selIds=new Set(); // multi-selection
function setSelection(ids){ selIds=new Set(ids); sel = selIds.size===1 ? [...selIds][0] : (selIds.size===0?null:sel); if(selIds.size!==1) sel = (selIds.size===0? null : ([...selIds].includes(sel)?sel:[...selIds][selIds.size-1])); }
function selectSingle(id){ selIds=new Set(id==null?[]:[id]); sel=id; }
function toggleSel(id){ if(selIds.has(id)){ selIds.delete(id); } else { selIds.add(id); } sel = selIds.size? [...selIds][selIds.size-1] : null; }
function isSel(id){ return selIds.has(id); }

// ---- Multi-select alignment (수평/수직/스마트 정렬) ----
// 정렬 대상: 선택된 것 중 기준과 같은 parent를 공유하는 컴포넌트들만 (좌표계가 동일해야 안전)
// 기준(anchor)은 항상 선택된 것 중 좌측 상단(x+y 최소)에 위치한 컴포넌트로 고정.
function alignTargets(){
  const items=comps.filter(c=>selIds.has(c.id));
  if(items.length<2) return null;
  const anchor=items.slice().sort((a,b)=>((a.x||0)+(a.y||0))-((b.x||0)+(b.y||0))||(a.x||0)-(b.x||0)||(a.y||0)-(b.y||0))[0];
  const pkey=anchor.parent||null;
  const targets=items.filter(c=>(c.parent||null)===pkey);
  return {anchor, targets};
}
const ALIGN_GAP=12; // 같은 그룹 내 컴포넌트 최소 간격(px)
// 교차축에서 서로 겹치는 컴포넌트끼리 하나의 그룹(행/열)으로 묶는다.
//  axis='x'(수평정렬): 교차축=Y. Y구간이 겹치는 것끼리 같은 "행".
//  axis='y'(수직정렬): 교차축=X. X구간이 겹치는 것끼리 같은 "열".
//  겹침은 연결(transitive)로 확장한다: A-B 겹치고 B-C 겹치면 A,B,C 한 그룹.
function groupByCrossOverlap(axis, targets){
  const CS = axis==='x' ? 'y':'x';   // 교차축 시작좌표
  const CD = axis==='x' ? 'h':'w';   // 교차축 길이
  // 같은 행/열 판정: 교차축 구간이 겹치거나, 두 컴포넌트의 교차축 중심이 충분히 가까우면 한 그룹.
  // (팻모드처럼 컴포넌트 높이가 얇으면 완전 겹침이 안 나므로 중심 근접도 함께 본다)
  const items=targets.map(c=>({
    c,
    s:(c[CS]||0),
    e:(c[CS]||0)+(c[CD]||0),
    center:(c[CS]||0)+(c[CD]||0)/2,
    size:(c[CD]||0)
  }));
  items.sort((a,b)=>a.center-b.center);
  const groups=[]; let cur=[items[0]];
  let curEnd=items[0].e;                 // 그룹의 교차축 최대 끝
  let curCenter=items[0].center;         // 그룹의 대표 중심(마지막 요소 기준)
  let curSize=items[0].size;
  for(let i=1;i<items.length;i++){
    const it=items[i];
    const overlap = it.s < curEnd;                         // 구간이 실제로 겹침
    // 중심 근접: 두 컴포넌트 중 작은 쪽 크기의 60% 이내면 같은 줄로 간주(얇은 컴포넌트 대응)
    const tol = Math.max(8, Math.min(curSize, it.size) * 0.6);
    const nearCenter = Math.abs(it.center - curCenter) <= tol;
    if(overlap || nearCenter){
      cur.push(it);
      curEnd=Math.max(curEnd, it.e);
      curCenter=it.center; curSize=it.size;                // 체인 방식: 직전 요소와 비교
    }else{
      groups.push(cur); cur=[it];
      curEnd=it.e; curCenter=it.center; curSize=it.size;
    }
  }
  groups.push(cur);
  return groups.map(g=>g.map(o=>o.c));
}
// 실제로 가까운 위치에 있는 것끼리 하나의 "밴드"(열 또는 행)로 묶어 [regionStart, regionEnd] 구간에 분배한다.
//  groups: 이미 근접도로 클러스터링된 실제 열(또는 행) 목록 (행 개수가 서로 다른 불규칙한 그리드에서도
//   "몇 번째 칸인가"가 아니라 "실제 좌표가 어디인가"로 묶이므로 열/행이 잘못 병합되지 않는다)
//  regionStart~regionEnd 구간을 벗어나지 않는 선에서 남는 여유는 밴드 사이에 균등 배분한다.
//  반환: Map(id -> 새 정렬축 시작좌표)
function distributeBands(axis, groups, regionStart, regionEnd){
  const S = axis==='x' ? 'x':'y';
  const D = axis==='x' ? 'w':'h';
  const pos=new Map();
  // 그룹을 자신의 평균 위치 기준 오름차순 정렬(좌→우 / 위→아래)
  const withAvg=groups.map(g=>({g, avg: g.reduce((s,c)=>s+(c[S]||0),0)/g.length}));
  withAvg.sort((a,b)=>a.avg-b.avg);
  const sorted=withAvg.map(o=>o.g);
  const m=sorted.length;
  if(m===0) return pos;
  if(m===1){ sorted[0].forEach(c=>{ pos.set(c.id, regionStart); }); return pos; }
  // 밴드 크기 = 그 그룹(열/행) 안의 컴포넌트 중 최대 크기(폭/높이)
  const bandSize=sorted.map(g=>Math.max(...g.map(c=>c[D]||0)));
  // 밴드 시작좌표 누적 계산(최소 간격 ALIGN_GAP 보장)
  const bandStart=[regionStart];
  for(let i=1;i<m;i++) bandStart.push(bandStart[i-1]+bandSize[i-1]+ALIGN_GAP);
  // 남는 여유 공간이 있으면 밴드 사이 간격에 균등 배분(요청 영역을 최대한 채우도록)
  const contentEnd=bandStart[m-1]+bandSize[m-1];
  if(contentEnd<regionEnd){
    const extraPerGap=(regionEnd-contentEnd)/(m-1);
    for(let i=1;i<m;i++) bandStart[i]+=extraPerGap*i;
  }
  sorted.forEach((g,i)=>{ g.forEach(c=>{ pos.set(c.id, Math.round(bandStart[i])); }); });
  return pos;
}
// 정렬 좌표계의 크기. 최상위=캔버스, 컨테이너 내부=부모 컴포넌트 크기.
function alignFrameSize(anchor){
  if(anchor.parent){
    const p=comps.find(c=>c.id===anchor.parent);
    if(p) return {w:p.w||canvas.offsetWidth, h:p.h||canvas.offsetHeight};
  }
  return {w:canvas.offsetWidth, h:canvas.offsetHeight};
}
// 선택되지 않은 형제 컴포넌트 목록(같은 parent 공유, 정렬 영역 침범 방지용)
function alignSiblingBlockers(anchor){
  const pkey=anchor.parent||null;
  return comps.filter(c=>!selIds.has(c.id) && (c.parent||null)===pkey);
}
function alignHorizontal(track){
  const info=alignTargets(); if(!info) return;
  const {anchor,targets}=info; if(targets.length<2) return;
  const regionStart=anchor.x||0;      // 기준(좌상단)의 좌측 X
  // 정렬 영역: 캔버스 전체가 아니라 "선택된 컴포넌트들의 바운딩 박스" 우측 끝까지만 사용
  let regionEnd=Math.max(...targets.map(c=>(c.x||0)+(c.w||0)));
  // 선택 안 된 형제 컴포넌트가 선택영역의 Y범위와 겹치고 정렬영역 안쪽에 있으면, 그 앞에서 멈추도록 clamp
  const selMinY=Math.min(...targets.map(c=>c.y||0));
  const selMaxY=Math.max(...targets.map(c=>(c.y||0)+(c.h||0)));
  alignSiblingBlockers(anchor).forEach(o=>{
    const os=o.y||0, oe=os+(o.h||0), ox=o.x||0;
    const overlaps = os < selMaxY && oe > selMinY;
    if(overlaps && ox >= regionStart){ regionEnd=Math.min(regionEnd, ox-ALIGN_GAP); }
  });
  if(regionEnd<regionStart) regionEnd=regionStart;
  if(track!==false) pushHistory();
  // 실제 "열"(X 위치가 가까운 것끼리)로 클러스터링 → 모든 열이 같은 [기준X, 선택영역 우측끝] 구간을 공유
  // (행 안에서의 순서(인덱스)로 열을 추정하면, 행마다 컴포넌트 개수/순서가 다른 불규칙한 그리드에서
  //  서로 다른 열이 잘못 합쳐질 수 있으므로, X 근접도로 실제 열을 먼저 찾는다.)
  const cols=groupByCrossOverlap('y', targets);
  const pos=distributeBands('x', cols, regionStart, regionEnd);
  targets.forEach(c=>{ if(c.id!==anchor.id && pos.has(c.id)) c.x=pos.get(c.id); });
  render(); scheduleAutosave();
}
function alignVertical(track){
  const info=alignTargets(); if(!info) return;
  const {anchor,targets}=info; if(targets.length<2) return;
  const regionStart=anchor.y||0;      // 기준(좌상단)의 상단 Y
  // 정렬 영역: 캔버스 전체가 아니라 "선택된 컴포넌트들의 바운딩 박스" 하단 끝까지만 사용
  let regionEnd=Math.max(...targets.map(c=>(c.y||0)+(c.h||0)));
  // 선택 안 된 형제 컴포넌트가 선택영역의 X범위와 겹치고 정렬영역 안쪽에 있으면, 그 앞에서 멈추도록 clamp
  const selMinX=Math.min(...targets.map(c=>c.x||0));
  const selMaxX=Math.max(...targets.map(c=>(c.x||0)+(c.w||0)));
  alignSiblingBlockers(anchor).forEach(o=>{
    const os=o.x||0, oe=os+(o.w||0), oy=o.y||0;
    const overlaps = os < selMaxX && oe > selMinX;
    if(overlaps && oy >= regionStart){ regionEnd=Math.min(regionEnd, oy-ALIGN_GAP); }
  });
  if(regionEnd<regionStart) regionEnd=regionStart;
  if(track!==false) pushHistory();
  // 실제 "행"(Y 위치가 가까운 것끼리)로 클러스터링 → 모든 행이 같은 [기준Y, 선택영역 하단끝] 구간을 공유
  // (열 안에서의 순서(인덱스)로 행을 추정하면, 열마다 컴포넌트 개수/순서가 다른 불규칙한 그리드에서
  //  서로 다른 행이 잘못 합쳐질 수 있으므로, Y 근접도로 실제 행을 먼저 찾는다.)
  const rows=groupByCrossOverlap('x', targets);
  const pos=distributeBands('y', rows, regionStart, regionEnd);
  targets.forEach(c=>{ if(c.id!==anchor.id && pos.has(c.id)) c.y=pos.get(c.id); });
  render(); scheduleAutosave();
}
function alignSmart(){
  // 수평 정렬 후 수직 정렬을 차례로 실행 (히스토리 1회만)
  pushHistory();
  alignHorizontal(false);
  alignVertical(false);
}

// ---- 간격 슬라이더: 멀티 선택 컴포넌트의 간격을 균일하게 크게/작게 조절 ----
// 기준(좌상단) 고정. 수평 슬라이더=가로 간격(열 사이 간격), 수직 슬라이더=세로 간격(행 사이 간격).
// 드래그 시작 시 밴드(실제 열/행) 구조를 스냅샷으로 고정하고, 드래그 중에는 pitch만 바꿔 좌표를 계산한다.
let gapSnap={x:null, y:null};   // axis별 스냅샷
// axis='x'(가로 간격)면 실제 "열"(X 근접 클러스터)을, axis='y'(세로 간격)면 실제 "행"(Y 근접 클러스터)을 구한다.
// "몇 번째 칸인가"가 아니라 "실제 좌표가 가까운가"로 묶어야, 칸 크기가 서로 다를 때도 열/행이 흐트러지지 않는다.
function gapBands(axis, targets){
  const groups = axis==='x' ? groupByCrossOverlap('y', targets) : groupByCrossOverlap('x', targets);
  const S = axis==='x' ? 'x' : 'y';
  const D = axis==='x' ? 'w' : 'h';
  const withAvg=groups.map(g=>({
    items:g,
    avg: g.reduce((s,c)=>s+(c[S]||0),0)/g.length,
    size: Math.max(...g.map(c=>c[D]||0)),  // 밴드 크기 = 그 열/행 안 최대 폭/높이
  }));
  withAvg.sort((a,b)=>a.avg-b.avg);
  return withAvg;
}
// 스냅샷 생성: 실제 열/행 밴드별로 [소속 컴포넌트 id 목록, 밴드 크기]를 저장.
// 컴포넌트 크기(w/h)는 절대 변경하지 않는다. 위치(간격)만 조절한다.
function buildGapSnapshot(axis){
  const info=alignTargets(); if(!info) return null;
  const {anchor,targets}=info; if(targets.length<2) return null;
  const S = axis==='x' ? 'x':'y';
  const anchorStart = anchor[S]||0;   // 기준(좌상단)의 시작 좌표
  const bands=gapBands(axis, targets);
  const anchorBandIdx=bands.findIndex(b=>b.items.some(c=>c.id===anchor.id));
  return {
    axis, S, anchorStart,
    anchorBandIdx: anchorBandIdx>=0 ? anchorBandIdx : 0,
    bands: bands.map(b=>({size:b.size, ids:b.items.map(c=>c.id)})),
  };
}
// 스냅샷 + pitch로 좌표 적용. pitch = 밴드(열/행)의 시작선 사이 간격.
// 기준이 속한 밴드는 항상 자기 원위치(anchorStart)에 고정되고, 나머지 밴드가 pitch 간격으로 배치된다.
// 밴드 크기(그 열/행 안의 최대 폭/높이)보다 pitch가 좁아 겹칠 경우에만 최소 간격을 보정한다.
// 모든 밴드가 동일한 계산을 공유하므로, 특정 칸이 크더라도 다른 열/행이 함께 밀려 격자가 흐트러지지 않는다.
function applyGapFromSnap(snap, pitch){
  if(!snap) return;
  const {S, bands, anchorStart, anchorBandIdx}=snap;
  const n=bands.length; if(n===0) return;
  const bandStart=new Array(n);
  bandStart[anchorBandIdx]=anchorStart;
  for(let i=anchorBandIdx+1;i<n;i++){
    const desired=bandStart[i-1]+pitch;
    const minAllowed=bandStart[i-1]+bands[i-1].size+ALIGN_GAP;
    bandStart[i]=Math.max(desired, minAllowed);
  }
  for(let i=anchorBandIdx-1;i>=0;i--){
    const desired=bandStart[i+1]-pitch;
    const maxAllowed=bandStart[i+1]-bands[i].size-ALIGN_GAP;
    bandStart[i]=Math.min(desired, maxAllowed);
  }
  bandStart.forEach((s,i)=>{
    bands[i].ids.forEach(id=>{ const c=comps.find(x=>x.id===id); if(c) c[S]=Math.round(s); });
  });
}
// 슬라이더 조작 시작(mousedown/touchstart): 히스토리 1회 + 스냅샷 생성.
function gapSliderStart(axis){
  pushHistory();
  gapSnap[axis]=buildGapSnapshot(axis);
}
// 슬라이더 입력(oninput): 스냅샷 기준으로 즉시 반영. 스냅샷이 없으면(직접 값변경 등) 새로 생성.
let gapRaf=null;
function onGapSlider(axis, value){
  if(!gapSnap[axis]) gapSnap[axis]=buildGapSnapshot(axis);
  applyGapFromSnap(gapSnap[axis], +value);
  // 숫자 입력칸 동기화(슬라이더 DOM은 유지되므로 값만 갱신)
  const num=document.getElementById(axis==='x'?'gapHInput':'gapVInput');
  if(num) num.value=value;
  // 캔버스만 갱신(renderProps 금지 → 슬라이더 DOM 유지). rAF로 프레임당 1회로 병합.
  if(gapRaf) cancelAnimationFrame(gapRaf);
  gapRaf=requestAnimationFrame(()=>{ drawCanvas(); gapRaf=null; });
}
// 숫자 입력칸에 직접 px 값 입력(키보드): 한 번에 적용.
function onGapNumber(axis, value){
  let v=parseInt(value,10); if(isNaN(v)) return;
  if(v<0) v=0;
  const range=document.getElementById(axis==='x'?'gapHRange':'gapVRange');
  if(range){
    if(v>+range.max) range.max=v;  // 입력값이 슬라이더 최대보다 크면 최대를 늘림
    range.value=v;
  }
  const num=document.getElementById(axis==='x'?'gapHInput':'gapVInput');
  if(num) num.value=v;
  pushHistory();
  gapSnap[axis]=buildGapSnapshot(axis);
  applyGapFromSnap(gapSnap[axis], v);
  gapSnap[axis]=null;
  drawCanvas(); scheduleAutosave();
}
// 슬라이더 조작 종료(change/mouseup): 저장 + 스냅샷 해제.
function gapSliderEnd(axis){
  gapSnap[axis]=null;
  if(gapRaf){ cancelAnimationFrame(gapRaf); gapRaf=null; }
  drawCanvas();
  scheduleAutosave();
}
// 현재 선택 기준으로 슬라이더 최대값 계산: 마지막 밴드가 캔버스를 살짝만 넘도록.
function gapSliderMax(axis){
  const info=alignTargets(); if(!info) return 200;
  const {anchor,targets}=info; if(targets.length<2) return 200;
  const S = axis==='x' ? 'x':'y';
  const {w:frameW, h:frameH}=alignFrameSize(anchor);
  const frameEnd = axis==='x' ? frameW : frameH;
  const bands=gapBands(axis, targets);
  if(bands.length<2) return 200;
  const anchorStart=anchor[S]||0;
  const lastSize=bands[bands.length-1].size;
  const m=bands.length;
  // 마지막 밴드가 frameEnd에 닿는 pitch: anchorStart + pitch*(m-1) + lastSize = frameEnd
  const pitchFit=(frameEnd - anchorStart - lastSize)/(m-1);
  // 캔버스를 살짝 넘어가도 되도록 15% 여유. 하한 60 보장.
  return Math.max(60, Math.round(pitchFit*1.15));
}
// 현재 선택된 컴포넌트들의 실제 "밴드(열/행) 시작선 간 거리(피치)" 대표값. 슬라이더 기본값으로 사용.
function currentGap(axis){
  const info=alignTargets(); if(!info) return ALIGN_GAP;
  const {targets}=info; if(targets.length<2) return ALIGN_GAP;
  const bands=gapBands(axis, targets);
  if(bands.length<2) return ALIGN_GAP;
  const S = axis==='x' ? 'x':'y';
  const starts=bands.map(b=>Math.min(...b.items.map(c=>c[S]||0)));
  const pitches=[];
  for(let i=1;i<starts.length;i++) pitches.push(starts[i]-starts[i-1]);
  pitches.sort((a,b)=>a-b);
  const mid=Math.round(pitches[Math.floor(pitches.length/2)]);
  return Math.max(0, mid);
}


// ---- Copy / Paste ----
let clipboard=[]; let pasteSeq=0;
function copySelection(){
  if(!selIds.size)return;
  const ids=collectWithChildren([...selIds]);
  clipboard=comps.filter(c=>ids.includes(c.id)).map(c=>JSON.parse(JSON.stringify(c)));
  pasteSeq=0;
}
// ---- 브라우저 간 복사/붙여넣기 (OS 클립보드 연동) ----
// 동일/타 브라우저(창·탭·프로필 구분 없이) 사이에 컴포넌트를 복사·붙여넣기 하기 위해,
// 로컬 clipboard 배열에 담는 것과 별개로 OS 클립보드에도 식별 마커를 포함한 JSON 문자열로
// 기록한다. 붙여넣기 시에는 OS 클립보드를 먼저 읽어 마커가 있으면 그 내용을 쓰고,
// 읽기 실패(권한 거부·비-JSON·비-목업빌더 텍스트 등)하면 기존 로컬 clipboard 로 대체 동작한다.
const MB_CLIP_MARKER='__mockupBuilderClipboard__';
let clipboardTextSeen=null; // 직전에 OS 클립보드에 기록/인식한 텍스트(중복 붙여넣기 시 오프셋 리셋 방지용)
// Ctrl+C 전용 진입점. 로컬 복사는 항상 성공하므로(선택이 있는 한) 하단 토스트를 띄운다.
// OS 클립보드 기록은 실패해도(구형 브라우저·권한 거부 등) 로컬 복사/붙여넣기 자체는 그대로 동작한다.
function copySelectionToSystem(){
  if(!selIds.size)return;
  copySelection();
  if(!clipboard.length)return;
  const payload=JSON.stringify({[MB_CLIP_MARKER]:1, comps:clipboard});
  if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(payload).then(()=>{ clipboardTextSeen=payload; }).catch(()=>{});
  }
  if(typeof mbToast==='function') mbToast('복사됨');
}
// Ctrl+V 전용 진입점. OS 클립보드를 먼저 시도하고, 실패/불일치 시 로컬 clipboard 로 대체한다.
// 붙여넣기에는(스펙에 따라) 별도 토스트를 띄우지 않는다.
async function pasteFromClipboard(){
  if(navigator.clipboard&&navigator.clipboard.readText){
    try{
      const text=await navigator.clipboard.readText();
      if(text&&text!==clipboardTextSeen){
        const data=JSON.parse(text);
        if(data&&data[MB_CLIP_MARKER]&&Array.isArray(data.comps)&&data.comps.length){
          clipboard=data.comps.map(c=>JSON.parse(JSON.stringify(c)));
          pasteSeq=0;
          clipboardTextSeen=text;
        }
      }
    }catch(err){ /* 권한 거부, JSON 아님, 마커 없음 등은 무시하고 로컬 clipboard 로 대체 */ }
  }
  pasteClipboard();
}
function pasteClipboard(){
  if(!clipboard.length)return;
  pushHistory();
  pasteSeq++;
  const off=pasteSeq*20;

  // Determine the current "paste target" Tab context from the current single selection, if any:
  // - a Tab container selected -> paste into its currently active page
  // - a component that lives inside a Tab selected -> paste into that same Tab/page
  // - anything else (or no clear single selection) -> paste as top-level, same as before
  let targetParent=null, targetTabIdx=0;
  if(selIds.size===1){
    const curSel=comps.find(x=>x.id===sel);
    if(curSel){
      if(curSel.type==='tabs'){ targetParent=curSel.id; targetTabIdx=curSel.active||0; }
      else if(curSel.parent){ targetParent=curSel.parent; targetTabIdx=curSel.tabIdx||0; }
    }
  }

  const clipIds=new Set(clipboard.map(c=>c.id));
  const idMap={};
  const created=[]; // {nc, wasRoot, origParent}
  clipboard.forEach(c=>{
    const nc=JSON.parse(JSON.stringify(c));
    const oldId=nc.id;
    nc.id=uid++;
    idMap[oldId]=nc.id;
    comps.push(nc);
    created.push({nc, wasRoot:!(c.parent&&clipIds.has(c.parent)), origParent:c.parent});
  });
  created.forEach(({nc,wasRoot,origParent})=>{
    if(!wasRoot){
      // a nested child copied together with its own container: stays attached to the newly duplicated container
      nc.parent=idMap[origParent];
      return; // relative x/y unchanged, it moves with its new parent automatically
    }
    // this item is a "root" of the copied selection: decide where it lands
    if(targetParent&&nc.type!=='tabs'){
      nc.parent=targetParent; nc.tabIdx=targetTabIdx;
    } else {
      delete nc.parent; delete nc.tabIdx;
    }
    nc.x=(nc.x||0)+off; nc.y=(nc.y||0)+off;
  });
  const newIds=created.map(o=>o.nc.id);
  selIds=new Set(newIds);
  sel = newIds.length?newIds[newIds.length-1]:null;
  render();
}

// ---- Undo / Redo history ----
let undoStack=[]; let redoStack=[]; const HIST_MAX=60;
function snapshot(){return JSON.parse(JSON.stringify({comps,uid,originId:mbCloud.originId||null}));}
function pushHistory(){
  undoStack.push(snapshot());
  if(undoStack.length>HIST_MAX)undoStack.shift();
  redoStack=[];
  updateHistBtns();
}
function undo(){
  if(!undoStack.length)return;
  redoStack.push(snapshot());
  const s=undoStack.pop();
  comps=s.comps; uid=s.uid; mbCloud.originId=s.originId||null; selectSingle(null);
  render(); updateHistBtns();
}
function redo(){
  if(!redoStack.length)return;
  undoStack.push(snapshot());
  const s=redoStack.pop();
  comps=s.comps; uid=s.uid; mbCloud.originId=s.originId||null; selectSingle(null);
  render(); updateHistBtns();
}
// Undo/redo are keyboard-only (Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z); the toolbar buttons were
// removed, so there is no button state to sync. Kept as a no-op safe hook: it is called from
// several places (undo, redo, pushHistory, load paths) and tolerates the buttons being absent,
// so re-adding a button later only needs the markup back.
function updateHistBtns(){
  const u=document.getElementById('undoBtn'), r=document.getElementById('redoBtn');
  if(u)u.disabled=!undoStack.length;
  if(r)r.disabled=!redoStack.length;
}

const TAB_HEADER_H=40; // px height of the tab header row, used for content-area layout & hit-testing
const SPLIT_DIVIDER=8; // px thickness of a split-container's draggable divider bar
// Computes the two pane rectangles (local coords, relative to the split container's own x/y)
// and the divider's rectangle, from the container's current w/h/dir/pos.
function splitPaneRects(c){
  const dir=c.dir==='v'?'v':'h';
  const pos=Math.min(0.85,Math.max(0.15,c.pos!=null?c.pos:0.5));
  if(dir==='h'){
    const w1=Math.max(10,Math.round(c.w*pos-SPLIT_DIVIDER/2));
    const w2=Math.max(10,c.w-w1-SPLIT_DIVIDER);
    return {dir,
      pane0:{x:0,y:0,w:w1,h:c.h},
      pane1:{x:w1+SPLIT_DIVIDER,y:0,w:w2,h:c.h},
      divider:{x:w1,y:0,w:SPLIT_DIVIDER,h:c.h}};
  }
  const h1=Math.max(10,Math.round(c.h*pos-SPLIT_DIVIDER/2));
  const h2=Math.max(10,c.h-h1-SPLIT_DIVIDER);
  return {dir,
    pane0:{x:0,y:0,w:c.w,h:h1},
    pane1:{x:0,y:h1+SPLIT_DIVIDER,w:c.w,h:h2},
    divider:{x:0,y:h1,w:c.w,h:SPLIT_DIVIDER}};
}
// Resolves a component's absolute canvas-space position by walking up its parent chain,
// so hit-testing/placement still works correctly for nested containers (split-in-split,
// split-in-tab, etc), not just one level of nesting.
function absPos(comp){
  if(!comp.parent) return {x:comp.x,y:comp.y};
  const p=comps.find(x=>x.id===comp.parent);
  if(!p) return {x:comp.x,y:comp.y};
  const pAbs=absPos(p);
  if(p.type==='split'){
    const r=splitPaneRects(p);
    const off=(comp.pane||0)===0?r.pane0:r.pane1;
    return {x:pAbs.x+off.x+comp.x, y:pAbs.y+off.y+comp.y};
  }
  if(p.type==='tabs'){
    return {x:pAbs.x+comp.x, y:pAbs.y+comp.y+TAB_HEADER_H};
  }
  // panel(그룹박스) 등 헤더가 없는 단순 컨테이너: 자식 좌표는 부모 좌상단 기준 그대로.
  return {x:pAbs.x+comp.x, y:pAbs.y+comp.y};
}
// A nested component is only "live" (clickable/hit-testable) if every Tab ancestor
// has it on its currently active page; otherwise it's sitting on a hidden tab page.
function isVisible(comp){
  let cur=comp;
  while(cur&&cur.parent){
    const p=comps.find(x=>x.id===cur.parent);
    if(!p) break;
    if(p.type==='tabs'&&(cur.tabIdx||0)!==(p.active||0)) return false;
    cur=p;
  }
  return true;
}
// True if `comp` is nested anywhere underneath the component with id `ancestorId`
// (used to stop a split container from being dropped inside its own descendant).
function isDescendantOf(comp,ancestorId){
  let cur=comp;
  while(cur&&cur.parent){
    if(cur.parent===ancestorId) return true;
    cur=comps.find(x=>x.id===cur.parent);
  }
  return false;
}
const defaults={
  title:{w:260,h:34,text:"화면 제목",required:false,readonly:false},
  section:{w:1060,h:28,text:"섹션",required:false,readonly:false},
  panel:{w:300,h:150,text:"",required:false,readonly:false},
  tabs:{w:700,h:300,text:"탭1,탭2,탭3",required:false,readonly:false,active:0},
  label:{w:90,h:26,text:"라벨",required:false,readonly:false,style:"none"},
  input:{w:180,h:52,text:"",required:false,readonly:false,showLabel:true,labelText:"항목명",labelPos:"top"},
  combo:{w:180,h:52,text:"선택",required:false,readonly:false,options:"옵션1,옵션2,옵션3",showLabel:true,labelText:"항목명",labelPos:"top"},
  date:{w:150,h:52,text:"",required:false,readonly:false,showLabel:true,labelText:"항목명",labelPos:"top"},
  daterange:{w:220,h:52,text:"2026-07-01 ~ 2026-07-15",required:false,readonly:false,showLabel:true,labelText:"항목명",labelPos:"top"},
  check:{w:120,h:48,text:"체크박스",required:false,readonly:false,showLabel:true,labelText:"항목명",labelPos:"top"},
  radio:{w:260,h:48,text:"라디오",required:false,readonly:false,options:"옵션1,옵션2,옵션3",selected:0,showLabel:true,labelText:"항목명",labelPos:"top"},
  // 팻모드 전용 팝업 컴포넌트: 라벨+텍스트박스(코드)+아이콘+텍스트박스(명칭).
  // 명칭 텍스트박스는 항상 읽기전용이며 별도 속성이 없다 - required/readonly/text는 코드 텍스트박스 것.
  popup:{w:420,h:23,text:"",required:false,readonly:false,showLabel:true,labelText:"항목명",labelPos:"left",style:"code_name"},
  button:{w:80,h:32,text:"버튼",required:false,readonly:false,ghost:false},
  grid:{w:700,h:190,text:"컬럼1,컬럼2,컬럼3,컬럼4",required:false,readonly:false,rows:3,
    gtitle:"그리드 제목",showToolbar:true,pagination:false,colSizeMode:'auto',
    stdAdd:true,stdCancel:true,stdCopy:true,stdDelete:true,
    userBtns:[]},
  chart:{w:440,h:260,text:"25,45,30,60,40,55",required:false,readonly:false,
    ctitle:"차트 제목",chartType:"bar",color:"green",showArrow:true},
  tree:{w:300,h:280,required:false,readonly:false,
    text:"아이템1\n  아이템1-1\n  아이템1-2\n    아이템1-2-1\n    아이템1-2-2\n  아이템1-3\n아이템2\n  아이템2-1\n  아이템2-2",
    selectedLine:0,showLines:true},
  searchbar:{w:1060,h:84,text:"",required:false,readonly:false,
    collapsed:false,
    fields:[
      {label:"조건1",type:"text",required:false},
      {label:"조건2",type:"text",required:false}
    ]},
  split:{w:700,h:400,text:"",required:false,readonly:false,dir:"h",pos:0.5}
};
function todayStr(){
  const d=new Date();
  const p=n=>String(n).padStart(2,'0');
  return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());
}

function snap(v){
  if(!document.getElementById('snapChk').checked) return v;
  const s=parseInt(document.getElementById('snapSize').value)||10;
  return Math.round(v/s)*s;
}

// ---- Drag from toolbox (and click-to-place mode) ----
let clickPlaceMode=false;
let armedType=null;
// Ghost preview for dragging a new component out of the toolbox.
// dropGhostType is the component being dragged; its icon/label come from the tool element.
let dropGhostType=null, dropGhostLabel='', dropGhostIcon='';
function dropGhostEl(){ return document.getElementById('dropGhost'); }
// Fat Mode에서는 도구상자 "입력 컴포넌트" 그룹(라벨·텍스트박스·콤보·날짜·기간·
// 체크박스·라디오)의 기본 생성 높이를 23으로 고정한다. 라벨을 제외한 나머지는 폭도 1.3배로 넓힌다.
// Thin Mode는 defaults의 원래 크기 그대로 반환한다.
// 드래그 중 보여주는 고스트 미리보기와 실제 배치(placeNewComponent) 양쪽에서 함께 쓴다.
const FAT_RESIZE_TYPES=['label','input','combo','date','daterange','check','radio'];
const FAT_HEIGHT=23;
function defaultSizeFor(type){
  const d=defaults[type]||{w:180,h:52};
  if(FAT_RESIZE_TYPES.includes(type) && document.body.classList.contains('skin-classic')){
    const w = type==='label' ? d.w : Math.round(d.w*1.3);
    return {w,h:FAT_HEIGHT};
  }
  return {w:d.w,h:d.h};
}
function hideDropGhost(){ dropGhostType=null; lastGhostSnap=null; const g=dropGhostEl(); if(g)g.classList.remove('on'); try{ clearGuides(); }catch(_){} }
// Position+size the ghost so the component is centered under the cursor (same
// feel as dragging an existing component), snapping like the real placement will.
// The ghost is a sibling of #canvas (which is CSS-scaled by `zoom`), so we scale
// its coordinates by `zoom` to line up with the visible, zoomed canvas.
function moveDropGhost(clientX,clientY){
  if(!dropGhostType)return;
  const g=dropGhostEl(); if(!g)return;
  const r=canvas.getBoundingClientRect();
  const d=defaultSizeFor(dropGhostType);
  const cxCanvas=(clientX-r.left)/zoom, cyCanvas=(clientY-r.top)/zoom;
  // 컴포넌트의 좌상단이 커서 위치가 되도록 배치(가운데 정렬 아님).
  let x=Math.max(0,snap(cxCanvas)), y=Math.max(0,snap(cyCanvas));
  // 스마트 가이드가 켜져 있으면, 기존 컴포넌트/캔버스 기준선에 스냅하고 가이드라인 표시.
  // 단, 컨테이너(탭/스플릿/패널) 위에 놓는 경우는 부모 상대좌표라 캔버스 절대 가이드가 맞지 않으므로 제외.
  const smartOn=(()=>{ const e=document.getElementById('smartChk'); return e?e.checked:false; })();
  const overContainer = hitTestTabContainer(cxCanvas,cyCanvas) || hitTestSplitContainer(cxCanvas,cyCanvas) || hitTestPanelContainer(cxCanvas,cyCanvas);
  if(smartOn && !overContainer){
    try{
      const gRes=computeGuides({id:null, w:d.w, h:d.h}, x, y);
      x=Math.max(0,gRes.x); y=Math.max(0,gRes.y);
      drawGuides(gRes.lines);
      lastGhostSnap={x, y}; // drop 시 이 스냅 위치를 그대로 사용
    }catch(_){ lastGhostSnap=null; clearGuides(); }
  }else{
    lastGhostSnap=null;
    try{ clearGuides(); }catch(_){}
  }
  g.style.left=(x*zoom)+'px';
  g.style.top=(y*zoom)+'px';
  g.style.width=(d.w*zoom)+'px';
  g.style.height=(d.h*zoom)+'px';
  g.classList.add('on');
}
let lastGhostSnap=null; // 마지막 ghost 스냅 좌표(가이드 적용 결과)
document.querySelectorAll('.tool').forEach(t=>{
  t.addEventListener('dragstart',e=>{
    e.dataTransfer.setData('type',t.dataset.type);
    e.dataTransfer.effectAllowed='copy';
    dropGhostType=t.dataset.type;
    const ic=t.querySelector('.ic'); dropGhostIcon=ic?ic.textContent:'';
    // textContent includes the icon glyph; drop it so the label isn't doubled.
    dropGhostLabel=t.textContent.replace(dropGhostIcon,'').trim();
    const g=dropGhostEl();
    if(g) g.innerHTML=`<span class="dg-ic">${dropGhostIcon}</span><span>${dropGhostLabel}</span>`;
    // Hide the browser's default drag image so only our ghost shows.
    try{ const img=new Image(); img.src='data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=='; e.dataTransfer.setDragImage(img,0,0); }catch(_){}
  });
  t.addEventListener('dragend',hideDropGhost);
  t.addEventListener('click',()=>{
    if(!clickPlaceMode)return;
    armedType = (armedType===t.dataset.type) ? null : t.dataset.type; // clicking the same tool again disarms it
    updateArmedUI();
  });
});
// Toolbox group collapse/expand (default expanded; state is UI-only, not persisted).
function toggleToolGroup(h3){
  h3.parentElement.classList.toggle('collapsed');
}
function onClickPlaceToggle(){
  clickPlaceMode=document.getElementById('clickPlaceChk').checked;
  document.getElementById('toolbox').classList.toggle('click-place-on',clickPlaceMode);
  if(!clickPlaceMode){ armedType=null; }
  updateArmedUI();
}
function updateArmedUI(){
  document.querySelectorAll('.tool').forEach(t=>t.classList.toggle('armed',t.dataset.type===armedType));
  canvas.classList.toggle('click-place-armed',!!armedType);
}
// Places a new top-level (or Tab-nested, if dropped/clicked inside a Tab's content area) component of `type`
// at canvas-local coordinates (x,y). Shared by both drag-and-drop and click-to-place.
// (x,y) is always the component's top-left corner - matching where the drag ghost/cursor
// was shown - so it lands exactly under the cursor; hit-testing still uses the raw cursor point.
function placeNewComponent(type,x,y,centered,snapPos){
  pushHistory();
  const d=JSON.parse(JSON.stringify(defaults[type]));
  const fatMode=document.body.classList.contains('skin-classic');
  // Fat Mode에서는 라벨 있는 컴포넌트의 기본 라벨 위치가 위쪽 대신 왼쪽이다.
  // Thin Mode(기존)는 그대로 top을 유지한다.
  if(d.labelPos && fatMode) d.labelPos='left';
  // 기본 생성 크기 보정(가로 1.3배·세로 2/3배)은 defaultSizeFor()가 모드를 보고 처리한다.
  const sz=defaultSizeFor(type);
  d.w=sz.w; d.h=sz.h;
  if(type==='date'){ d.text=todayStr(); d.dateSpec='chip:today'; }
  // px,py = where the component's top-left should go (always the cursor/ghost position itself)
  const px = x;
  const py = y;
  const tabTarget=hitTestTabContainer(x,y);
  const splitTarget=!tabTarget ? hitTestSplitContainer(x,y) : null;
  const panelTarget=(!tabTarget&&!splitTarget) ? hitTestPanelContainer(x,y) : null;
  if(tabTarget && type!=='tabs'){ // don't allow nesting a tab inside another tab
    const nx=snap(px-tabTarget.cx), ny=snap(py-tabTarget.cy);
    comps.push({id:uid++,type,x:Math.max(0,nx),y:Math.max(0,ny),parent:tabTarget.c.id,tabIdx:tabTarget.c.active||0,...d});
  } else if(splitTarget){
    const paneRect=splitTarget.pane===0?splitTarget.rects.pane0:splitTarget.rects.pane1;
    const newId=uid++;
    // Fill only makes sense as the automatic default for a nested split container itself
    // (so it tiles the parent pane); any other component defaults to None - placed at its
    // normal size near the drop point - so it stays free to drag, resize, and drag back out.
    const dock = type==='split' ? 'fill' : 'none';
    let nx=0, ny=0, nw=paneRect.w, nh=paneRect.h;
    if(dock==='none'){
      nx=Math.max(0,snap(px-splitTarget.cx)); ny=Math.max(0,snap(py-splitTarget.cy));
      nw=d.w; nh=d.h;
    }
    comps.push({id:newId,type,...d,x:nx,y:ny,w:nw,h:nh,parent:splitTarget.c.id,pane:splitTarget.pane,dock});
    if(type==='split'){
      // that pane may already have content - move it into the new nested split's first
      // pane instead of letting it silently overlap the new split
      comps.forEach(k=>{
        if(k.id!==newId&&k.parent===splitTarget.c.id&&(k.pane||0)===splitTarget.pane){
          k.parent=newId; k.pane=0; if(!k.dock)k.dock='fill';
        }
      });
    }
  } else if(panelTarget){
    // 패널/그룹박스 안에 놓으면 탭·스플릿과 마찬가지로 그 패널의 자식이 된다(상대좌표 저장).
    const nx=snap(px-panelTarget.cx), ny=snap(py-panelTarget.cy);
    comps.push({id:uid++,type,x:Math.max(0,nx),y:Math.max(0,ny),parent:panelTarget.c.id,...d});
  } else {
    // 스마트 가이드로 스냅된 좌표가 있으면 그대로 사용, 없으면 격자 snap.
    const fx = snapPos ? Math.max(0, Math.round(snapPos.x)) : Math.max(0,snap(px));
    const fy = snapPos ? Math.max(0, Math.round(snapPos.y)) : Math.max(0,snap(py));
    comps.push({id:uid++,type,x:fx,y:fy,...d});
  }
  selectSingle(comps[comps.length-1].id);
  render();
}
const canvas=document.getElementById('canvas');
canvas.addEventListener('dragover',e=>{
  e.preventDefault();
  if(e.dataTransfer) e.dataTransfer.dropEffect='copy';
  if(dropGhostType) moveDropGhost(e.clientX,e.clientY);
});
// Hide the ghost when the cursor leaves the canvas area (but not on inner-element flicker).
canvas.addEventListener('dragleave',e=>{
  if(!dropGhostType)return;
  const r=canvas.getBoundingClientRect();
  if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom) hideDropGhost();
});
canvas.addEventListener('drop',e=>{
  e.preventDefault();
  const snapPos=lastGhostSnap; // hideDropGhost가 초기화하기 전에 보관
  hideDropGhost();
  const type=e.dataTransfer.getData('type');
  if(!type) return;
  const r=canvas.getBoundingClientRect();
  if(snapPos){
    // 스마트 가이드로 스냅된 좌상단 좌표에 그대로 배치(컨테이너 히트테스트는 커서 위치 기준)
    placeNewComponent(type, (e.clientX-r.left)/zoom, (e.clientY-r.top)/zoom, false, snapPos);
  }else{
    placeNewComponent(type, (e.clientX-r.left)/zoom, (e.clientY-r.top)/zoom); // 좌상단이 커서 위치
  }
});
// Intercepts mousedown in the CAPTURE phase (before it reaches its target) whenever a tool is armed,
// so a click anywhere inside the canvas - including on a Tab header, inside a Tab's content area, or
// on top of an existing component - places the new component instead of triggering that element's own
// behavior (tab switching, drag-move, resize, etc). stopPropagation here prevents those nested handlers
// (which are wired on 'mousedown'/'onmousedown') from ever running.
canvas.addEventListener('mousedown',e=>{
  if(!armedType)return;
  e.stopPropagation();
  e.preventDefault();
  const r=canvas.getBoundingClientRect();
  placeNewComponent(armedType, (e.clientX-r.left)/zoom, (e.clientY-r.top)/zoom);
},true);
// hit test against the content area of any top-level 'tabs' component (topmost/last match wins)
function hitTestTabContainer(px,py){
  let found=null;
  comps.forEach(c=>{
    if(c.parent||c.type!=='tabs')return;
    const cx=c.x, cy=c.y+TAB_HEADER_H, cw=c.w, ch=c.h-TAB_HEADER_H;
    if(px>=cx&&px<=cx+cw&&py>=cy&&py<=cy+ch){ found={c,cx,cy}; }
  });
  return found;
}
// hit test against either pane of any 'split' component, including ones nested inside
// another split's pane or a tab's content area (topmost/last match wins - a deeper-nested
// split is later in `comps` than its ancestor, so it naturally takes priority)
function hitTestSplitContainer(px,py){
  let found=null;
  comps.forEach(c=>{
    if(c.type!=='split'||!isVisible(c))return;
    const abs=absPos(c);
    const r=splitPaneRects(c);
    const p0={x:abs.x+r.pane0.x,y:abs.y+r.pane0.y,w:r.pane0.w,h:r.pane0.h};
    const p1={x:abs.x+r.pane1.x,y:abs.y+r.pane1.y,w:r.pane1.w,h:r.pane1.h};
    if(px>=p0.x&&px<=p0.x+p0.w&&py>=p0.y&&py<=p0.y+p0.h){ found={c,cx:p0.x,cy:p0.y,pane:0,rects:r}; }
    else if(px>=p1.x&&px<=p1.x+p1.w&&py>=p1.y&&py<=p1.y+p1.h){ found={c,cx:p1.x,cy:p1.y,pane:1,rects:r}; }
  });
  return found;
}

// hit test against the content area of any 'panel' component, including ones nested inside
// another panel/split/tab (topmost/last match wins - a deeper-nested panel is later in
// `comps` than its ancestor, so it naturally takes priority). Mirrors hitTestSplitContainer.
function hitTestPanelContainer(px,py){
  let found=null;
  comps.forEach(c=>{
    if(c.type!=='panel'||!isVisible(c))return;
    const abs=absPos(c);
    if(px>=abs.x&&px<=abs.x+c.w&&py>=abs.y&&py<=abs.y+c.h){ found={c,cx:abs.x,cy:abs.y}; }
  });
  return found;
}

// ---- Render ----
// ---- Autosave (browser storage only) ----
// Keeps a snapshot in localStorage so an accidental close/refresh doesn't lose work.
// Saves shortly after the last edit, and again on a timer while editing continues.
const AUTOSAVE_KEY='mb_autosave';
const AUTOSAVE_IDLE=3000;   // save 3s after edits stop
const AUTOSAVE_PERIOD=60000; // and at least once a minute
let autosaveTimer=null, lastAutosave=0, autosaveReady=false;
// 모바일/태블릿에서는 자동 저장·이어하기(복구) 기능을 끈다.
// checkAutosave 는 모바일 모듈(applyMode)보다 먼저 실행되므로 body 클래스에만
// 의존할 수 없어 detectMode 와 동일한 판별 로직을 여기서도 사용한다.
function mbDeviceIsMobileOrTablet(){
  var b=document.body;
  if(b.classList.contains('mb-mobile')||b.classList.contains('mb-tablet')) return true;
  if(b.classList.contains('mb-pc')) return false;
  try{
    if(window.__mbForce) return window.__mbForce!=='pc';
    var q=(location.search.match(/[?&]mbmode=(mobile|tablet|pc)/)||[])[1];
    if(q) return q!=='pc';
    var w=window.innerWidth,h=window.innerHeight,shortSide=Math.min(w,h),longSide=Math.max(w,h);
    var coarse=!!(window.matchMedia&&window.matchMedia('(pointer:coarse)').matches);
    var ua=(navigator.userAgent||'');
    var phoneUA=/Android.*Mobile|iPhone|iPod/i.test(ua);
    var tabletUA=/iPad|Android(?!.*Mobile)|Tablet|PlayBook|Silk/i.test(ua);
    if((coarse&&shortSide<600)||phoneUA) return true;
    if((coarse&&shortSide<=1024&&longSide<=1400)||(tabletUA&&!phoneUA)) return true;
  }catch(e){}
  return false;
}
function autosaveSnapshot(){
  return JSON.stringify({
    v:1, comps, uid,
    cw:document.getElementById('cw').value,
    ch:document.getElementById('ch').value,
    originId:mbCloud.originId||null, // 공유파일에서 이어 작업 중이던 원본 추적값도 함께 저장
    savedAt:Date.now()
  });
}
function doAutosave(){
  if(!autosaveReady)return;
  if(mbDeviceIsMobileOrTablet())return; // 모바일/태블릿은 자동 저장 안 함
  try{
    localStorage.setItem(AUTOSAVE_KEY,autosaveSnapshot());
    lastAutosave=Date.now();
    showAutosaveMark();
  }catch(e){ /* storage full or blocked - ignore */ }
}
function scheduleAutosave(){
  if(!autosaveReady)return;
  if(mbDeviceIsMobileOrTablet())return; // 모바일/태블릿은 자동 저장 안 함
  clearTimeout(autosaveTimer);
  // periodic guarantee: if it's been a while, save right away
  if(Date.now()-lastAutosave>AUTOSAVE_PERIOD){ doAutosave(); return; }
  autosaveTimer=setTimeout(doAutosave,AUTOSAVE_IDLE);
}
function showAutosaveMark(){
  const el=document.getElementById('autosaveMark');
  if(!el)return;
  const t=new Date();
  const hh=String(t.getHours()).padStart(2,'0'), mm=String(t.getMinutes()).padStart(2,'0');
  el.textContent='자동저장됨 '+hh+':'+mm;
  el.classList.add('on');
  clearTimeout(showAutosaveMark._t);
  showAutosaveMark._t=setTimeout(()=>{
    el.classList.remove('on');
    // clear after the fade so the empty span collapses and buttons stay tight
    setTimeout(()=>{ if(!el.classList.contains('on')) el.textContent=''; },350);
  },2500);
}
// Offers to restore the previous session if a snapshot exists.
function checkAutosave(){
  // 모바일/태블릿에서는 이어하기(복구) 안내를 띄우지 않고 자동 저장도 하지 않는다.
  if(mbDeviceIsMobileOrTablet()){ autosaveReady=false; return; }
  let raw=null;
  try{ raw=localStorage.getItem(AUTOSAVE_KEY); }catch(e){}
  autosaveReady=true;
  if(!raw)return;
  let d;
  try{ d=JSON.parse(raw); }catch(e){ return; }
  if(!d||!Array.isArray(d.comps)||!d.comps.length)return;
  const when=d.savedAt?new Date(d.savedAt):null;
  const ago=when?(function(){
    const m=Math.round((Date.now()-d.savedAt)/60000);
    if(m<1)return '방금 전';
    if(m<60)return m+'분 전';
    const h=Math.round(m/60);
    return h<24?h+'시간 전':Math.round(h/24)+'일 전';
  })():'';
  document.getElementById('restoreInfo').textContent=
    (ago?ago+' ':'')+'작업하던 내용('+d.comps.length+'개 컴포넌트)이 남아 있습니다.';
  document.getElementById('restoreBg').classList.add('on');
  window.__autosaveData=d;
}
function restoreAutosave(){
  const d=window.__autosaveData;
  if(d){
    pushHistory();
    comps=d.comps;
    uid=Math.max(0,...comps.map(c=>c.id||0))+1;
    if(d.cw){document.getElementById('cw').value=d.cw;setCW();}
    if(d.ch){document.getElementById('ch').value=d.ch;setCH();}
    mbCloud.originId=d.originId||null; // 브라우저가 꺼지기 전 이어 작업 중이던 원본 추적값 복원
    selectSingle(null);
    render();
  }
  closeRestore();
}
function discardAutosave(){
  try{ localStorage.removeItem(AUTOSAVE_KEY); }catch(e){}
  closeRestore();
}
function closeRestore(){
  document.getElementById('restoreBg').classList.remove('on');
  if(maybeShowPatch._pending){ maybeShowPatch._pending=false; maybeShowPatch(); }
}

function render(){
  drawCanvas();
  renderProps();
}
function drawCanvas(){
  scheduleAutosave();
  // Every full canvas rebuild below recreates each component's DOM from scratch, which would
  // reset any scrollable grid's horizontal scroll (.gbody.scrollLeft) back to 0 - regardless of
  // *why* the rebuild happened: a column-resize/reorder drag, or just as easily an ordinary
  // property panel edit (alignment, type, date settings, required/readonly, etc. all call
  // render()/drawCanvas() too). Rather than special-case every call site that might disturb a
  // scrolled grid, save every grid's current scroll position once here before tearing down the
  // DOM, and restore it after rebuilding - so no future change anywhere can reintroduce this bug.
  const gridScrolls=new Map();
  canvas.querySelectorAll('.cmp[data-cid] .gbody').forEach(gb=>{
    if(gb.scrollLeft){
      const wrap=gb.closest('.cmp');
      if(wrap)gridScrolls.set(wrap.dataset.cid,gb.scrollLeft);
    }
  });
  canvas.innerHTML='';
  const single = selIds.size===1;
  comps.filter(c=>!c.parent).forEach(c=>renderComp(c,canvas,single));
  if(gridScrolls.size){
    gridScrolls.forEach((sl,cid)=>{
      const gb=canvas.querySelector('.cmp[data-cid="'+cid+'"] .gbody');
      if(gb)gb.scrollLeft=sl;
    });
  }
}
function renderComp(c,container,single,locked){
  const on = isSel(c.id);
  const el=document.createElement('div');
  el.className='cmp'+(on?' selected':'')+(locked?' locked':'');
  el.dataset.cid=c.id;  // lets column-drag/resize handlers on a grid's inner HTML find their way back to this wrapper without holding a stale DOM reference across re-renders
  el.style.left=c.x+'px'; el.style.top=c.y+'px';
  el.style.width=c.w+'px'; el.style.height=c.h+'px';
  // Z order follows the component's position in `comps` (that is what zorder() reorders).
  // Containers stay on a lower band so their children always paint above them. The selection
  // is NOT lifted here: doing so would hide the effect of 맨 뒤 while the item is still selected.
  // The whole canvas band is kept well under the overlay z-indexes (guidelines 900,
  // modals 1000) so patch/restore popups and smart guides always draw on top.
  const isContainer=(c.type==='panel'||c.type==='tabs'||c.type==='split');
  const ord=Math.min(comps.findIndex(x=>x.id===c.id),299);
  el.style.zIndex=isContainer?(1+ord):(310+ord);
  el.innerHTML=inner(c);
  if(locked){
    // Split-pane children are always auto-fit to their pane, so dragging/resizing is disabled;
    // clicking still selects the component so its properties (and delete) remain reachable.
    el.addEventListener('mousedown',ev=>{
      // Same guard as startMove(): a mousedown that lands on the grid's own horizontal
      // scrollbar track must not select+render() here, or drawCanvas() would tear down
      // and rebuild this very element mid-drag and cancel the native scrollbar grab
      // before it can move - "좌우 스크롤 사용" would then look like it does nothing
      // for any grid docked into a split pane, since (unlike a free-floating grid,
      // which goes through startMove() and already has this guard) this is the only
      // mousedown handler a fill-docked grid gets.
      const gbody = ev.target.closest && ev.target.closest('.ax-grid .gbody.xscroll');
      if(gbody){
        const gb=gbody.getBoundingClientRect();
        const offY=(ev.clientY - gb.top)/(zoom||1);
        if(offY > gbody.clientHeight && gbody.scrollWidth>gbody.clientWidth) return;
      }
      ev.stopPropagation();
      if(!isSel(c.id)){ selectSingle(c.id); render(); }
    });
    // The normal ".cmp.selected" outline is drawn just OUTSIDE the box and gets clipped away
    // by the pane's own overflow (the child is sized to exactly fill the pane) - so a fill-docked
    // child could be selected with no visible sign of it. Add a topmost overlay INSIDE the box
    // instead (appended last, after the rendered content, so it always paints above it) whose
    // inset box-shadow can never be clipped since it never extends past the box it's drawn in.
    const selFrame=document.createElement('div');
    selFrame.className='sel-frame';
    el.appendChild(selFrame);
  } else if(c.type==='tabs'||c.type==='split'){
    // Tabs/Split containers no longer move on a plain drag anywhere in their body - that area
    // needs to be free for rubber-band selecting the components inside instead (see
    // attachContainerBoxSelect below). Moving/selecting the container itself is done through
    // its small "⧉" tag handle (tabs-tag / split-tag), same as Split already worked.
  } else {
    el.addEventListener('mousedown',ev=>startMove(ev,c));
  }
  if(single && on && !locked){
    ['se','e','s'].forEach(dir=>{
      const h=document.createElement('div');h.className='handle '+dir;
      h.addEventListener('mousedown',ev=>startResize(ev,c,dir));
      el.appendChild(h);
    });
  }
  container.appendChild(el);
  if(c.type==='tabs'){
    const body=document.createElement('div');
    body.className='tabs-body-wrap tabs-body-hint';
    body.style.cssText='position:absolute;left:0;top:'+TAB_HEADER_H+'px;right:0;bottom:0;overflow-y:auto;overflow-x:hidden;';
    el.appendChild(body);
    const active=c.active||0;
    comps.filter(k=>k.parent===c.id&&(k.tabIdx||0)===active).forEach(k=>renderComp(k,body,single));
    // Rubber-band select the components on the current tab page when dragging the empty background.
    attachContainerBoxSelect(body,c,null,()=>comps.filter(k=>k.parent===c.id&&(k.tabIdx||0)===(c.active||0)));
    // Small always-on-top tag/handle: lets the Tabs container be selected AND dragged to move,
    // mirroring the Split container's "⧉" tag (see renderSplitChildren) - necessary now that
    // the header background and body no longer forward plain clicks up to the container.
    const selfFillLocked = c.parent && c.dock==='fill'; // true when c itself is a dock:'fill' pane child
    const moveOrSelect = selfFillLocked
      ? (ev)=>{ ev.stopPropagation(); if(!isSel(c.id)){ selectSingle(c.id); render(); } }
      : (ev)=>startMove(ev,c);
    // Dragging the header's empty strip (beside/between the tab buttons) also moves the container,
    // just like grabbing any other component's body - the tab buttons themselves already
    // stopPropagation on their own mousedown (see the 'tabs' case in inner()), so this only ever
    // fires on the header background, never hijacking a tab-switch click.
    const head=el.querySelector(':scope > .ax-tabs-wrap > .ax-tabs-head');
    if(head) head.addEventListener('mousedown',moveOrSelect);
    const tag=document.createElement('div');
    tag.className='split-tag tabs-tag';
    tag.textContent='⧉';
    if(selfFillLocked){
      tag.title='탭 컨테이너 선택 (Fill 배치라 이동은 안 됩니다 - Dock을 None으로 바꾸면 이동 가능)';
    } else {
      tag.title='드래그: 탭 컨테이너 이동 · 클릭: 선택';
    }
    tag.addEventListener('mousedown',moveOrSelect);
    el.appendChild(tag);
  }
  if(c.type==='split'){
    renderSplitChildren(c,el,single);
  }
  if(c.type==='panel'){
    const body=document.createElement('div');
    body.className='panel-body-wrap panel-body-hint';
    body.style.cssText='position:absolute;left:0;top:0;right:0;bottom:0;overflow-y:auto;overflow-x:hidden;';
    el.appendChild(body);
    comps.filter(k=>k.parent===c.id).forEach(k=>renderComp(k,body,single));
  }
}
// Builds the two panes + draggable divider inside a split container. Each pane's children
// are either left free to move/resize/drag out on their own (dock:'none', the default) or
// auto-fit to exactly fill the pane (dock:'fill' - e.g. so a grid auto-resizes when the divider moves).
function renderSplitChildren(c,el,single){
  const r=splitPaneRects(c);
  const p0=document.createElement('div');
  p0.className='split-pane split-pane-hint';
  p0.style.cssText=`left:${r.pane0.x}px;top:${r.pane0.y}px;width:${r.pane0.w}px;height:${r.pane0.h}px;overflow-y:auto;overflow-x:hidden;`;
  const p1=document.createElement('div');
  p1.className='split-pane split-pane-hint';
  p1.style.cssText=`left:${r.pane1.x}px;top:${r.pane1.y}px;width:${r.pane1.w}px;height:${r.pane1.h}px;overflow-y:auto;overflow-x:hidden;`;
  const dv=document.createElement('div');
  dv.className='split-divider '+(r.dir==='h'?'split-divider-h':'split-divider-v');
  dv.style.cssText=`left:${r.divider.x}px;top:${r.divider.y}px;width:${r.divider.w}px;height:${r.divider.h}px;`;
  dv.title='드래그: 크기 조절 · 클릭: 컨테이너 선택';
  dv.addEventListener('mousedown',ev=>startSplitDrag(ev,c));
  el.appendChild(p0); el.appendChild(p1); el.appendChild(dv);
  comps.filter(k=>k.parent===c.id&&(k.pane||0)===0).forEach(k=>renderSplitChild(k,p0,r.pane0,single));
  comps.filter(k=>k.parent===c.id&&(k.pane||0)===1).forEach(k=>renderSplitChild(k,p1,r.pane1,single));
  // Rubber-band select each pane's own components when dragging its empty background.
  attachContainerBoxSelect(p0,c,0,()=>comps.filter(k=>k.parent===c.id&&(k.pane||0)===0));
  attachContainerBoxSelect(p1,c,1,()=>comps.filter(k=>k.parent===c.id&&(k.pane||0)===1));
  // A small always-on-top tag/handle: lets the split container be selected AND dragged to move,
  // even when its panes are completely covered by dock:fill children (which would otherwise
  // intercept every click before it reaches the container's own move handler).
  const selfFillLocked = c.parent && c.dock==='fill'; // true when c itself is a dock:'fill' pane child
  const tag=document.createElement('div');
  tag.className='split-tag';
  tag.textContent='⧉';
  if(selfFillLocked){
    tag.title='스플릿 컨테이너 선택 (Fill 배치라 이동은 안 됩니다 - Dock을 None으로 바꾸면 이동 가능)';
    tag.addEventListener('mousedown',ev=>{ ev.stopPropagation(); if(!isSel(c.id)){ selectSingle(c.id); render(); } });
  } else {
    tag.title='드래그: 컨테이너 이동 · 클릭: 선택';
    tag.addEventListener('mousedown',ev=>startMove(ev,c));
  }
  el.appendChild(tag);
}
function renderSplitChild(k,paneEl,rect,single){
  const fill=k.dock==='fill';
  if(fill) fitSplitChild(k,rect);
  renderComp(k,paneEl,single,fill);
}
// Forces a dock:'fill' split-pane child to exactly fill its pane; called every render so
// resizing the divider (or the split container itself) keeps the child's size in sync automatically.
function fitSplitChild(k,rect){
  k.x=0; k.y=0; k.w=rect.w; k.h=rect.h;
}

// Parses indented text into tree nodes. Indentation (2 spaces or a tab per level)
// determines depth; a node "has children" when the next line is deeper.
function parseTree(text){
  const lines=String(text||'').split('\n').filter(l=>l.trim().length);
  const nodes=lines.map((l,i)=>{
    const ind=l.match(/^[\t ]*/)[0].replace(/\t/g,'  ').length;
    return {i,depth:ind>>1,label:l.trim(),hasChildren:false};
  });
  nodes.forEach((n,i)=>{ const nx=nodes[i+1]; if(nx&&nx.depth>n.depth) n.hasChildren=true; });
  return nodes;
}

const LABELED_TYPES=['input','combo','date','daterange','check','radio','popup'];
function labelWrap(c,html){
  if(!LABELED_TYPES.includes(c.type))return html;
  if(c.showLabel!==true)return html;
  const pos=c.labelPos||'top';
  const req=c.required?'<span class="req">*</span>':'';
  const lbl=`<div class="fl-label">${esc(c.labelText||'')}${req}</div>`;
  return `<div class="fl-wrap fl-${pos}">${lbl}<div class="fl-body">${html}</div></div>`;
}
function inner(c,mode){
  return labelWrap(c, innerRaw(c,mode));
}
// Renders a single grid cell body for a per-column control type (텍스트박스/콤보박스/날짜/체크박스).
function todayISO(){
  const d=new Date();
  const p=n=>String(n).padStart(2,'0');
  return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());
}
function gridCellCtrl(ctype,opts,exp,dateVal,dateBlank,dateSpec){
  switch(ctype){
    case 'combo':{
      const list=opts.length?opts:['선택','옵션1','옵션2','옵션3'];
      if(exp){
        const optHtml=list.map(o=>`<div class="combo-opt" data-val="${escAttr(o)}" onmousedown="event.stopPropagation();selectComboExport(this)">${esc(o)}</div>`).join('');
        return `<div class="ax-combo interactive" onclick="toggleComboExport(this)"><span class="combo-val">선택</span><div class="combo-drop">${optHtml}</div></div>`;
      }
      return `<div class="ax-combo"><span>선택</span></div>`;
    }
    case 'date':{
      const dv=dateBlank?'':(qdResolvedText(dateVal,dateSpec)||todayISO());
      if(exp){
        const relAttr=(!dateBlank&&dateSpec)?` data-relspec="${escAttr(dateSpec)}"`:'';
        const blankAttr=dateBlank?' data-blank="1"':'';
        return `<div class="ax-date-x"><input type="date" class="ax-date-el"${dv?` value="${escAttr(dv)}"`:''}${relAttr}${blankAttr}></div>`;
      }
      return `<div class="ax-date"><span>${esc(dv)}</span></div>`;
    }
    case 'check':
      if(exp) return `<div class="gcell-check interactive" onclick="toggleCheckExport(this)"><span class="box"></span></div>`;
      return `<div class="gcell-check"><span class="box"></span></div>`;
    case 'file':
      return `<div class="gcell-file" title="첨부파일"><svg class="gcell-file-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 16 12 12 8 16"></polyline><line x1="12" y1="12" x2="12" y2="21"></line><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"></path></svg></div>`;
    case 'search':
      if(exp) return `<div class="gcell-search"><input type="text" class="gcell-search-input"><span class="sctl-search-ic"></span></div>`;
      return `<div class="gcell-search"><span class="sctl-search-ic"></span></div>`;
    default:
      if(exp) return `<input type="text" class="gcell-input">`;
      return '&nbsp;';
  }
}
// 자동 컬럼 폭 계산용 1회성 캔버스 컨텍스트 - 실제 DOM에 붙이지 않고도 그리드 헤더와 같은
// 폰트로 텍스트 폭을 정확히 잴 수 있어, 렌더링마다 가볍게 재사용한다.
let __gcMeasureCtx=null;
function autoColWidth(text,required){
  if(!__gcMeasureCtx) __gcMeasureCtx=document.createElement('canvas').getContext('2d');
  __gcMeasureCtx.font='700 11px "Malgun Gothic","맑은 고딕",-apple-system,sans-serif'; // .ax-grid .gh span 과 동일한 폰트
  const textW=__gcMeasureCtx.measureText(text||'').width;
  const PAD=18;                    // 헤더 셀 좌우 padding(8px*2)+테두리 여유(2px) - 글자가 경계에 딱 붙어 잘려 보이지 않도록
  const REQ_EXTRA=required?12:0;   // 필수(*) 표시가 앞에 붙는 만큼의 여유
  return Math.max(28, Math.ceil(textW)+PAD+REQ_EXTRA);
}
function innerRaw(c,mode){
  mode=mode||'design';
  const exp=mode==='export';
  const req=(c.required&&!(LABELED_TYPES.includes(c.type)&&c.showLabel===true))?'<span class="req">*</span>':'';
  switch(c.type){
    case 'title':return `<div class="ax-title">${esc(c.text)}${req}</div>`;
    case 'section':return `<div class="ax-section">${esc(c.text)}${req}</div>`;
    case 'panel':return `<div class="ax-panel-c"></div>`;
    case 'split':return `<div class="ax-split-c"></div>`;
    case 'tabs':{
      // ilItems는 이름을 지우는 중이라 빈 문자열이어도 칸을 그대로 유지한다(그래야 편집 중에
      // 탭이 사라지지 않는다). 실제 화면에서만 빈 탭이 안 보이지 않도록 자리표시자를 넣어준다.
      const names=ilItems(c,'text');
      const active=c.active||0;
      const items=names.map((n,i)=>`<div class="axtab-item${i===active?' on':''}" data-tabbtn-group="${c.id}" data-tabidx="${i}" onmousedown="event.stopPropagation();setActiveTab(${c.id},${i})">${esc(n)||'&nbsp;&nbsp;&nbsp;'}</div>`).join('');
      return `<div class="ax-tabs-wrap"><div class="ax-tabs-head">${items}</div></div>`;
    }
    case 'label':{
      const fatSkin=document.body.classList.contains('skin-classic');
      const lblIc = !fatSkin ? '' : c.style==='ref' ? '<span class="ax-label-ic ax-label-ic-ref"></span>'
        : c.style==='jump' ? '<span class="ax-label-ic ax-label-ic-jump"></span>' : '';
      return `<div class="ax-label">${lblIc}${esc(c.text)}${req}</div>`;
    }
    case 'input':
      if(exp) return `<div class="ax-input-x${c.readonly?' ro':''}${c.required?' required':''}"><input type="text" class="ax-input-el" value="${escAttr(c.text)}"${c.readonly?' readonly':''}>${req}</div>`;
      return `<div class="ax-input ${c.readonly?'readonly':''}${c.required?' required':''}">${esc(c.text)}${req}</div>`;
    case 'popup':{
      // 라벨+텍스트박스(코드)+아이콘+텍스트박스(명칭). 명칭 칸은 항상 읽기전용이고 값도 비워둔다
      // (실제 조회 결과가 여기 채워진다는 것을 보여주는 자리표시일 뿐, 별도 속성은 없음).
      // 스타일이 "코드"면 명칭 칸을 아예 뺀다(코드/명 이 기본값).
      const codeBox = exp
        ? `<div class="ax-input-x${c.readonly?' ro':''}${c.required?' required':''}"><input type="text" class="ax-input-el" value="${escAttr(c.text)}"${c.readonly?' readonly':''}></div>`
        : `<div class="ax-input${c.readonly?' readonly':''}${c.required?' required':''}">${esc(c.text)}</div>`;
      const nameBox = c.style==='code' ? '' : '<div class="ax-popup-name"></div>';
      return `<div class="ax-popup">${codeBox}<div class="ax-popup-ic">≡</div>${nameBox}${req}</div>`;
    }
    case 'combo':{
      const copts=(c.options||'').split(',').map(s=>s.trim()).filter(Boolean);
      if(exp&&!c.readonly&&copts.length){
        const optHtml=copts.map(o=>`<div class="combo-opt" data-val="${escAttr(o)}" onmousedown="event.stopPropagation();selectComboExport(this)">${esc(o)}</div>`).join('');
        return `<div class="ax-combo interactive${c.required?' required':''}" onclick="toggleComboExport(this)"><span class="combo-val">${esc(c.text)}</span>${req}<div class="combo-drop">${optHtml}</div></div>`;
      }
      if(exp) return `<div class="ax-combo interactive${c.readonly?' ro':''}${c.required?' required':''}" ${c.readonly?'':'onclick="this.classList.toggle(\'open\')"'}><span>${esc(c.text)}</span>${req}</div>`;
      return `<div class="ax-combo${c.readonly?' readonly':''}${c.required?' required':''}"><span>${esc(c.text)}</span>${req}</div>`;
    }
    case 'date':{
      // spec이 있으면(빠른 날짜 팝업에서 오늘/어제 등으로 고른 값이면) 고정 문자열이 아니라 "지금"
      // 기준으로 다시 계산한 값을 쓴다. spec이 없으면(빈값, 또는 예전 고정값) 저장된 텍스트 그대로.
      const resolved=qdResolvedText(c.text,c.dateSpec);
      if(exp){
        const valid=/^\d{4}-\d{2}-\d{2}$/.test(resolved||'');
        const relAttr=c.dateSpec?` data-relspec="${escAttr(c.dateSpec)}"`:'';
        const blankAttr=c.blank?' data-blank="1"':'';
        return `<div class="ax-date-x${c.readonly?' ro':''}${c.required?' required':''}"><input type="date" class="ax-date-el" value="${valid?resolved:''}"${relAttr}${blankAttr}${c.readonly?' disabled':''}>${req}</div>`;
      }
      return `<div class="ax-date${c.readonly?' readonly':''}${c.required?' required':''}"><span>${esc(resolved)}</span>${req}</div>`;
    }
    case 'daterange':{
      // 날짜1=required/readonly, 날짜2=required2/readonly2 (개별 처리)
      const ro1=!!c.readonly, ro2=!!c.readonly2, rq1=!!c.required, rq2=!!c.required2;
      const drParts=(c.text||'').split('~').map(s=>s.trim());
      const r1=qdResolvedText(drParts[0],c.startSpec), r2=qdResolvedText(drParts[1],c.endSpec);
      const drV1=c.startBlank?'':(/^\d{4}-\d{2}-\d{2}$/.test(r1||'')?r1:''),
            drV2=c.endBlank?'':(/^\d{4}-\d{2}-\d{2}$/.test(r2||'')?r2:'');
      if(exp){
        const rel1=c.startSpec?` data-relspec="${escAttr(c.startSpec)}"`:'', rel2=c.endSpec?` data-relspec="${escAttr(c.endSpec)}"`:'';
        const blank1=c.startBlank?' data-blank="1"':'', blank2=c.endBlank?' data-blank="1"':'';
        return `<div class="ax-daterange-x"><input type="date" class="ax-date-el${ro1?' ro':''}${rq1?' is-req':''}" value="${drV1}"${rel1}${blank1}${ro1?' disabled':''}><span class="dr-sep">~</span><input type="date" class="ax-date-el${ro2?' ro':''}${rq2?' is-req':''}" value="${drV2}"${rel2}${blank2}${ro2?' disabled':''}>${req}</div>`;
      }
      if(document.body.classList.contains('skin-classic')){
        // 팻모드는 편집 화면에서도 실제처럼 날짜 두 칸+물결(~)로 보여준다(씬모드는 기존 한 칸 표현 유지).
        return `<div class="ax-daterange"><span class="ax-date-part${ro1?' ro':''}${rq1?' is-req':''}">${esc(drV1)}</span><span class="dr-sep">~</span><span class="ax-date-part${ro2?' ro':''}${rq2?' is-req':''}">${esc(drV2)}</span>${req}</div>`;
      }
      return `<div class="ax-date${c.readonly?' readonly':''}${c.required?' required':''}"><span>${esc(drV1)} ~ ${esc(drV2)}</span>${req}</div>`;
    }
    case 'check':
      if(exp) return `<div class="ax-check interactive" onclick="toggleCheckExport(this)"><span class="box"></span>${esc(c.text)}${req}</div>`;
      return `<div class="ax-check"><span class="box"></span>${esc(c.text)}${req}</div>`;
    case 'radio':{
      const ropts=(c.options||'').split(',').map(s=>s.trim()).filter(Boolean);
      if(!ropts.length){
        // legacy single-radio fallback (no options configured)
        if(exp) return `<div class="ax-radio interactive on" onclick="toggleRadioExport(this)"><span class="dot"></span>${esc(c.text)}</div>`;
        return `<div class="ax-radio"><span class="dot"></span>${esc(c.text)}</div>`;
      }
      const rsel=c.selected||0;
      if(exp){
        const items=ropts.map((o,i)=>`<span class="opt interactive${i===rsel?' on':''}" data-group="${c.id}" onclick="selectRadioGroupExport(this)"><span class="dot"></span>${esc(o)}</span>`).join('');
        return `<div class="ax-radio-group">${items}</div>`;
      }
      const items=ropts.map((o,i)=>`<span class="opt${i===rsel?' on':''}"><span class="dot"></span>${esc(o)}</span>`).join('');
      return `<div class="ax-radio-group">${items}</div>`;
    }
    case 'button':return `<div class="ax-btn ${c.ghost?'ghost':''}">${esc(c.text)}</div>`;
    case 'grid':{
      const cols=c.text.split(',');
      const gridFatSkin=document.body.classList.contains('skin-classic');
      // Row Order(순번)/CheckBox 좌측 유틸리티 컬럼 - 씬모드 전용. 저장된 값이 없는 경우(레거시
      // 목업 포함)에도 기본값은 켜짐으로 취급한다 - 사람이 명시적으로 꺼야(===false)만 사라진다.
      const rowOrderOn=!gridFatSkin&&c.rowOrderCol!==false;
      const checkboxOn=!gridFatSkin&&c.checkboxCol!==false;
      const extraDefs=[];
      if(rowOrderOn)extraDefs.push({kind:'roworder',w:48});
      if(checkboxOn)extraDefs.push({kind:'checkbox',w:40});
      const ROWORDER_ICON_GEAR=`<svg viewBox="0 0 24 24" title="설정"><g fill="currentColor"><circle cx="12" cy="12" r="6.4"/><circle cx="19.2" cy="12" r="2.6"/><circle cx="15.6" cy="18.24" r="2.6"/><circle cx="8.4" cy="18.24" r="2.6"/><circle cx="4.8" cy="12" r="2.6"/><circle cx="8.4" cy="5.76" r="2.6"/><circle cx="15.6" cy="5.76" r="2.6"/></g><circle cx="12" cy="12" r="3" fill="var(--ax-grid-head)"/></svg>`;
      const ROWORDER_ICON_FILTER=`<svg viewBox="0 0 24 24" title="필터"><path fill="currentColor" d="M4,4 L20,4 L13,14 L13,19 L11,19 L11,14 Z"/></svg>`;
      const ROWORDER_ICON_PIN=`<svg viewBox="0 0 24 24" title="고정"><g fill="currentColor" transform="rotate(45 12 12)"><path d="M16,12V4h1V2H7v2h1v8l-2,2v2h5.2v6h1.6v-6H18v-2L16,12z"/></g></svg>`;
      const extraInnerHTML=d=>d.kind==='roworder'
        ? `<div class="grh-icons">${ROWORDER_ICON_GEAR}${ROWORDER_ICON_FILTER}${ROWORDER_ICON_PIN}</div>`
        : `<div class="gcell-check"><span class="box"></span></div>`;
      // If columns can't all fit at their minimum width, suggest switching to 스크롤 mode
      // automatically - but only in response to a genuinely new structural change (column added/
      // removed, grid resized). If the person already explicitly picked a mode themselves,
      // _sizeModeManual is set and this is skipped so their choice isn't instantly overridden on
      // the next render. Only "date" columns have a real, unshrinkable native-widget minimum
      // width (combo/check/input are all custom-styled and shrink fine) - so plain-text grids
      // (e.g. every built-in template) never trigger this, and it only kicks in once a column is
      // actually set to date and would clip.
      if(mode==='design'&&gridSizeMode(c)==='default'&&!c._sizeModeManual){
        const hasDateCol=cols.some((x,ci)=>((c.colTypes&&c.colTypes[ci])||'input')==='date');
        if(hasDateCol){
          const floorW=Math.max(60,+c.colMinW||120);
          if(cols.length*floorW>c.w) c.colSizeMode='scroll';
        }
      }
      let toolbar='';
      if(c.showToolbar!==false){
        let btns='';
        if(c.stdAdd)btns+=`<span class="gbtn"><span class="gic">➕</span>행추가</span>`;
        if(c.stdCancel)btns+=`<span class="gbtn"><span class="gic">⊗</span>행취소</span>`;
        if(c.stdCopy)btns+=`<span class="gbtn"><span class="gic">⧉</span>행복사</span>`;
        if(c.stdDelete)btns+=`<span class="gbtn"><span class="gic">🗑</span>행삭제</span>`;
        (c.userBtns||[]).forEach(b=>{
          const label=typeof b==='string'?b:b.label;
          const disabled=(typeof b==='object'&&b.disabled)?' disabled':'';
          btns+=`<span class="gbtn user${disabled}"><span class="gic">➕</span>${esc(label)}</span>`;
        });
        toolbar=`<div class="gtoolbar"><span class="gtitle">${esc(c.gtitle||'')}</span><span class="gspacer"></span><div class="gbtn-row">${btns}</div></div>`;
      }
      // 헤더 텍스트 정렬 / 필수 / 읽기전용 - 컬럼별로 하나씩. autoColWidth() 계산에 필수(*) 여유가
      // 필요하므로 폭 관련 값들보다 먼저 계산해둔다.
      const colAligns=(c.colAligns||[]).slice(0,cols.length);
      while(colAligns.length<cols.length)colAligns.push('left');
      const colRequired=(c.colRequired||[]).slice(0,cols.length);
      while(colRequired.length<cols.length)colRequired.push(false);
      const colReadonly=(c.colReadonly||[]).slice(0,cols.length);
      while(colReadonly.length<cols.length)colReadonly.push(false);
      // 읽기전용·필수가 둘 다 켜진 컬럼은 읽기전용(회색)을 우선한다 - 데이터 행(바디 셀)에만
      // 적용한다. 헤더는 색이 바뀌지 않고, 필수일 때 빨간 * 표시만 붙는다.
      const colColorCls=ci=>colReadonly[ci]?'col-readonly':(colRequired[ci]?'col-required':'');
      const colReqMark=ci=>colRequired[ci]?'<span class="col-req-mark">*</span>':'';
      // 컬럼 폭 방식 3가지: 고정(균등분할, 스크롤 없음)·수동(고정폭+가로 스크롤, 컬럼 폭 슬라이더
      // 사용 가능)·자동(글자가 안 잘리는 최소 크기로 딱 맞추고, 넘칠 때만 가로 스크롤). 레거시
      // 목업에는 colSizeMode가 없으니 gridSizeMode()가 예전 xscroll 값으로 대신 판단한다.
      const sizeMode=gridSizeMode(c);
      const xs=sizeMode!=='default';   // scroll·auto 모두 가로 스크롤이 가능한 flex 레이아웃을 쓴다
      const colW=Math.max(60,+c.colMinW||120);   // 스크롤 모드에서 슬라이더로 지정한 전체 컬럼 공통 폭
      // 컬럼별 "기본" 폭(사용자가 드래그로 개별 조절하지 않았을 때의 값): 자동 모드는 그 컬럼
      // 글자 길이에 맞춘 값, 스크롤 모드는 슬라이더 값(colW)을 모든 컬럼에 동일 적용.
      const colBaseW=ci=>sizeMode==='auto'?autoColWidth(cols[ci].trim(),colRequired[ci]):colW;
      // Per-column width overrides set by dragging a column's right border directly on the
      // canvas (see startColResize/colresize drag mode). A column with no override falls back
      // to colBaseW(ci) above. In 자동 mode, updGridColLabel() clears a column's override the
      // moment its name changes, so a manual drag only "sticks" until the next rename.
      const colWidths=(c.colWidths||[]).slice(0,cols.length);
      const isDesign=mode==='design';
      const cellW=ci=>{
        const w=colWidths[ci];
        return (xs||w)?` style="width:${w||colBaseW(ci)}px"`:'';
      };
      const resizeHandle=ci=>isDesign?`<div class="col-resize-handle" onmousedown="event.stopPropagation();startColResize(event,${c.id},${ci})" title="드래그하여 폭 조절"></div>`:'';
      // 컬럼 순서를 드래그로 바꾸는 기능도 디자인 캔버스 전용. data-ci로 어느 컬럼인지 표시해두면
      // 드래그 중 mousemove 핸들러가 마우스 아래 컬럼을 다시 찾을 때 (재렌더링을 거치지 않고도)
      // 그 값만으로 바로 식별할 수 있다. resizeHandle과 달리 셀 전체가 손잡이이므로, 폭 조절
      // 손잡이 위에서 누르면 그쪽 mousedown이 먼저 stopPropagation 해서 순서 변경은 걸리지 않는다.
      const colDragAttrs=ci=>{
        const cls=reorderCls(ci).trim();
        const clsAttr=cls?` class="${cls}"`:'';
        const dragAttr=isDesign?` data-ci="${ci}" onmousedown="event.stopPropagation();startColReorder(event,${c.id},${ci})"`:'';
        return clsAttr+dragAttr;
      };
      // 컬럼 드래그 중일 때만(같은 그리드 인스턴스를 드래그하는 동안) 시각 표시 클래스를 붙인다.
      // drag는 전역 변수라 재렌더링 때마다 여기서 최신 상태를 그대로 읽을 수 있다 - 이 값 자체를
      // 바꾸는 곳은 mousemove의 updateColReorderHover() 뿐이고, 렌더링은 그 결과만 읽어 표시한다.
      const reorderCls=ci=>{
        if(!isDesign||!drag||drag.mode!=='colreorder'||drag.c!==c)return '';
        let cls=[];
        if(drag.ci===ci)cls.push('gcol-dragging');
        if(drag.committed&&drag.hoverCi===ci)cls.push(drag.hoverSide==='after'?'gcol-drop-after':'gcol-drop-before');
        return cls.length?` ${cls.join(' ')}`:'';
      };
      const extraTrack=extraDefs.map(d=>d.w+'px').join(' ');
      // One data-column's CSS Grid track: a dragged-to width always wins as a fixed px track;
      // otherwise scroll/auto modes fix every column at colBaseW(ci), while default mode divides
      // remaining space evenly (minmax(0,1fr)) exactly as before this feature existed.
      const colTrack=ci=>colWidths[ci]?`${colWidths[ci]}px`:(xs?`${colBaseW(ci)}px`:'minmax(0,1fr)');
      const dataTracks=()=>cols.map((_,ci)=>colTrack(ci)).join(' ');
      // Non-scroll mode: an explicit grid-template-columns (same string on header and every row)
      // guarantees identical column widths everywhere - unlike independent flex rows, which could
      // drift apart by a pixel or two between the header and body rows. minmax(0,1fr) means a true
      // even split with no floor: in 기본 mode, columns always divide evenly and the grid never
      // scrolls, even if that squeezes a column very narrow (unless individually resized - see
      // colTrack above). Row Order/CheckBox columns get a fixed px track prepended so they stay
      // narrow no matter how many data columns exist; since they're also placed first in the DOM,
      // grid auto-placement drops them straight into those leading tracks with no per-cell column
      // index needed.
      const gridColsStyle=xs?'':` style="grid-template-columns:${extraTrack?extraTrack+' ':''}${dataTracks()}"`;
      // Merged header groups: c.colGroups[ci] holds an optional group label per column, set
      // from the property panel. Consecutive columns sharing the same non-empty label merge
      // into one centered cell spanning them on header row 1 (like 기준정보/재고정보 in the
      // reference mock); each of those columns still shows its own name on row 2 below. A
      // column with no group label gets a single cell spanning both rows, so the header stays
      // a uniform height whether or not any given column belongs to a group. When no column
      // has a group at all, the header renders exactly as before (single row) - zero visual
      // change for every grid that isn't using this feature.
      const colGroups=(c.colGroups||[]).slice(0,cols.length);
      while(colGroups.length<cols.length)colGroups.push('');
      const hasGroups=colGroups.some(g=>g&&g.trim());
      const ALIGN_JUSTIFY={left:'flex-start',center:'center',right:'flex-end'};
      let h;
      if(hasGroups){
        // CSS Grid natively supports the 2D (row+column) span placement this needs, so the
        // header is forced onto display:grid here even in xscroll mode (which normally lays
        // the header out with flexbox) - an inline style wins over the .xscroll CSS rule.
        // Row Order/CheckBox columns (if on) occupy the leading `off` tracks, so every data
        // column's explicit grid-column index is shifted right by `off`.
        const off=extraDefs.length;
        const colTrackStyle=(extraTrack?extraTrack+' ':'')+dataTracks();
        const headParts=[];
        extraDefs.forEach((d,ei)=>{
          headParts.push(`<span style="grid-column:${ei+1};grid-row:1/span 2;">${extraInnerHTML(d)}</span>`);
        });
        for(let ci=0;ci<cols.length;ci++){
          const g=(colGroups[ci]||'').trim();
          const mark=colReqMark(ci);
          const align=colAligns[ci]||'left';
          if(g){
            if(ci===0||(colGroups[ci-1]||'').trim()!==g){
              let span=1;
              while(ci+span<cols.length&&(colGroups[ci+span]||'').trim()===g)span++;
              headParts.push(`<span style="grid-column:${ci+1+off}/span ${span};grid-row:1;text-align:center;border-bottom:1px solid var(--ax-border);">${esc(g)}</span>`);
            }
            headParts.push(`<span${colDragAttrs(ci)} style="grid-column:${ci+1+off};grid-row:2;text-align:${align};position:relative;">${mark}${esc(cols[ci].trim())}${resizeHandle(ci)}</span>`);
          }else{
            headParts.push(`<span${colDragAttrs(ci)} style="grid-column:${ci+1+off};grid-row:1/span 2;display:flex;align-items:center;justify-content:${ALIGN_JUSTIFY[align]||'flex-start'};position:relative;">${mark}${esc(cols[ci].trim())}${resizeHandle(ci)}</span>`);
          }
        }
        h=`<div class="gh" style="display:grid;grid-template-columns:${colTrackStyle};grid-template-rows:repeat(2,auto);">${headParts.join('')}</div>`;
      }else{
        // No explicit grid-column indices here - the grid auto-places cells in DOM order, so
        // the extra Row Order/CheckBox header cells just need to come first to land in the
        // leading fixed-width tracks that gridColsStyle already reserved for them.
        const extraHeadHtml=extraDefs.map(d=>{
          const wStyle=xs?` style="width:${d.w}px"`:'';
          return `<span${wStyle}>${extraInnerHTML(d)}</span>`;
        }).join('');
        h='<div class="gh"'+gridColsStyle+'>'+extraHeadHtml+cols.map((x,ci)=>{
          const align=colAligns[ci]||'left';
          const w=colWidths[ci];
          const wStyle=(xs||w)?`width:${w||colBaseW(ci)}px;`:'';
          return `<span${colDragAttrs(ci)} style="${wStyle}text-align:${align};position:relative;">${colReqMark(ci)}${esc(x.trim())}${resizeHandle(ci)}</span>`;
        }).join('')+'</div>';
      }
      for(let i=0;i<(c.rows||3);i++){
        // Row Order shows 1..표시 행 수 top to bottom; CheckBox reuses the same check-cell markup
        // (and click handler, in export mode) as a regular "체크박스" type data column.
        const extraCellsHtml=extraDefs.map(d=>{
          const wStyle=xs?` style="width:${d.w}px"`:'';
          if(d.kind==='roworder') return `<span${wStyle}><div class="gcell-roworder-num">${i+1}</div></span>`;
          const chkCls='gcell-check'+(exp?' interactive':'');
          const chkClick=exp?' onclick="toggleCheckExport(this)"':'';
          return `<span${wStyle}><div class="${chkCls}"${chkClick}><span class="box"></span></div></span>`;
        }).join('');
        const cells=cols.map((x,ci)=>{
          const ctype=(c.colTypes&&c.colTypes[ci])||'input';
          const copts=((c.colOptions&&c.colOptions[ci])||'').split(',').map(s=>s.trim()).filter(Boolean);
          const content=gridCellCtrl(ctype,copts,exp,(c.colDateVals&&c.colDateVals[ci])||'',!!(c.colDateBlank&&c.colDateBlank[ci]),(c.colDateSpec&&c.colDateSpec[ci])||'');
          const editCls=ctype==='input'&&exp?'gcell-edit':'';
          const colorCls=colColorCls(ci);
          const clsAttr=[editCls,colorCls].filter(Boolean).join(' ');
          const cls=clsAttr?` class="${clsAttr}"`:'';
          return `<span${cellW(ci)}${cls}>${content}</span>`;
        }).join('');
        h+='<div class="gr'+(exp?' hoverable':'')+'"'+gridColsStyle+'>'+extraCellsHtml+cells+'</div>';
      }
      let pagination='';
      if(c.pagination&&!gridFatSkin){
        const rowsCount=c.rows||3;
        pagination=`<div class="gpagination">
          <div class="gp-nav">
            <span class="gp-btn gp-arrow">«</span>
            <span class="gp-btn gp-arrow">‹</span>
            <span class="gp-btn on">1</span>
            <span class="gp-btn gp-arrow">›</span>
            <span class="gp-btn gp-arrow">»</span>
          </div>
          <div class="gp-right">
            <span class="gp-item">Show rows: <span class="gp-select">${rowsCount}</span></span>
            <span class="gp-item">Go to: <span class="gp-input">1</span> page</span>
            <span class="gp-item">전체 <b>${rowsCount}</b>건</span>
          </div>
        </div>`;
      }
      return `<div class="ax-grid">${toolbar}<div class="gbody${xs?' xscroll':''}">${h}</div>${pagination}</div>`;
    }
    case 'chart':{
      const arrow=c.showArrow!==false?`<span class="arw">›</span>`:'';
      return `<div class="ax-chart"><div class="ctitle">${esc(c.ctitle||'')} ${arrow}</div><div class="cbody">${chartSVG(c)}</div></div>`;
    }
    case 'tree':{
      const nodes=parseTree(c.text||'');
      const selLine=c.selectedLine||0;
      const IND=18, PAD=10;
      const rows=nodes.map(n=>{
        const toggle=n.hasChildren
          ? `<span class="tw-tog"${exp?` onclick="toggleTreeExport(this)"`:''}>−</span>`
          : `<span class="tw-tog leaf">–</span>`;
        // dashed guides for each ancestor level
        let guides='';
        for(let g=0;g<n.depth;g++) guides+=`<span class="tw-guide" style="left:${PAD+g*IND+7}px"></span>`;
        const onCls=n.i===selLine?' on':'';
        const click=exp?` onclick="selectTreeExport(this)"`:'';
        return `<div class="tw-row${onCls}" data-depth="${n.depth}" style="padding-left:${PAD+n.depth*IND}px"${click}>${guides}${toggle}<span class="tw-lbl">${esc(n.label)}</span></div>`;
      }).join('');
      return `<div class="ax-tree${c.showLines===false?' nolines':''}">${rows}</div>`;
    }
    case 'searchbar':{
      const cells=sbLayoutCells(c.fields||[]);
      let sfIdx=0;
      const fields=cells.map(cell=>{
        if(cell.kind==='halfpair'){
          const fiA=sfIdx++, fiB=sfIdx++;
          return `<div class="sfield-halfslot" style="grid-column:span 1;">${sfHalfBox(cell.a,fiA,exp,c.id)}${sfHalfBox(cell.b,fiB,exp,c.id)}</div>`;
        }
        if(cell.kind==='halfsolo'){
          const fi=sfIdx++;
          return `<div class="sfield-halfslot" style="grid-column:span 1;">${sfHalfBox(cell.f,fi,exp,c.id)}<div class="sfield-half sfield-half-blank"></div></div>`;
        }
        const f=cell.f, fi=sfIdx++;
        if(f.type==='empty'){
          return `<div class="sfield sfield-empty" style="grid-column:span ${cell.units};"></div>`;
        }
        return `<div class="sfield${f.type==='radio'?' radio':''}" style="grid-column:span ${cell.units};">${sfFieldInner(f,fi,exp,c.id)}</div>`;
      }).join('');
      const fullInner=`<div class="sfields">${fields}</div><div class="sactions"><span class="ssearch"><span class="sctl-search-ic"></span>조회</span></div>`;
      if(!exp){
        if(c.collapsed) return `<div class="ax-search collapsed"><span class="scollapsed-msg">🔍 조회조건이 접혀 있습니다 (헤더의 「조회조건 펼치기」로 표시)</span></div>`;
        return `<div class="ax-search">${fullInner}</div>`;
      }
      // export mode: embed both states, toggle button switches between them
      return `<div class="ax-search-toggle-wrap">
        <div class="ax-search"${c.collapsed?' style="display:none;"':''}>${fullInner}</div>
        <div class="ax-search collapsed"${c.collapsed?'':' style="display:none;"'} onclick="toggleSearchbarExport(this)"><span class="scollapsed-msg">🔍 조회조건이 접혀 있습니다 (클릭하면 펼쳐집니다)</span></div>
      </div>`;
    }
  }
  return '';
}
function esc(s){return (s||'').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function escAttr(s){return (s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
// ---- Searchbar ½-column (half-span) layout helpers ----
// Walks the field list once and groups it into render "cells": normal fields keep
// their own 1~4 column span, while two consecutive span===0.5 fields are paired into
// a single 1-column cell that's split 50/50, and a lone (unpaired) span===0.5 field
// becomes its own 1-column cell with only the left half filled (right half stays blank
// so a later field can't slide into that space).
function sbLayoutCells(fields){
  const arr=fields||[], cells=[];
  for(let i=0;i<arr.length;i++){
    const f=arr[i];
    if(f.span===0.5){
      const next=arr[i+1];
      if(next&&next.span===0.5){ cells.push({kind:'halfpair',a:f,b:next}); i++; }
      else cells.push({kind:'halfsolo',f});
    } else {
      cells.push({kind:'field',f,units:Math.min(4,Math.max(1,f.span||1))});
    }
  }
  return cells;
}
// Builds the label+control markup for one field (shared by full-width and half-width rendering).
function sfFieldInner(f,fi,exp,cid){
  const freq=f.required?'<span class="req">*</span>':'';
  let ctl;
  if(f.type==='combo'){
    const fopts=(f.options||'전체,선택1,선택2').split(',').map(s=>s.trim()).filter(Boolean);
    if(exp&&fopts.length){
      const optHtml=fopts.map(o=>`<div class="combo-opt" data-val="${escAttr(o)}" onmousedown="event.stopPropagation();selectComboExport(this)">${esc(o)}</div>`).join('');
      ctl=`<div class="sctl combo interactive" onclick="toggleComboExport(this)"><span class="combo-val">선택</span><div class="combo-drop">${optHtml}</div></div>`;
    } else {
      ctl=`<div class="sctl combo${exp?' interactive':''}"${exp?' onclick="this.classList.toggle(\'open\')"':''}>선택</div>`;
    }
  }
  else if(f.type==='date'){
    // 값이 비어 있으면(신규/구버전 목업) 오늘 날짜를 기본값으로 보여준다. 단, "빈값"으로 명시적으로
    // 지정된 경우엔 오늘 날짜로 채우지 않고 정말 빈 채로 둔다. spec이 있으면(오늘/어제 등 빠른
    // 날짜 팝업에서 고른 값이면) 고정 문자열이 아니라 "지금" 기준으로 다시 계산한 값을 쓴다.
    const val=f.blank?'':(qdResolvedText(f.text,f.dateSpec)||todayStr());
    const relAttr=(!f.blank&&f.dateSpec)?` data-relspec="${escAttr(f.dateSpec)}"`:'';
    const blankAttr=f.blank?' data-blank="1"':'';
    ctl= exp?`<div class="sctl date-x"><input type="date" class="sctl-date-el"${val?` value="${escAttr(val)}"`:''}${relAttr}${blankAttr}></div>`:`<div class="sctl date">${esc(val)}</div>`;
  }
  else if(f.type==='daterange'){
    const raw=(f.text||'').trim()||(todayStr()+'~'+todayStr());
    const parts=raw.split('~').map(s=>s.trim());
    const v1=f.startBlank?'':(qdResolvedText(parts[0],f.startSpec)||todayStr()), v2=f.endBlank?'':(qdResolvedText(parts[1],f.endSpec)||todayStr());
    const rel1=(!f.startBlank&&f.startSpec)?` data-relspec="${escAttr(f.startSpec)}"`:'', rel2=(!f.endBlank&&f.endSpec)?` data-relspec="${escAttr(f.endSpec)}"`:'';
    const blank1=f.startBlank?' data-blank="1"':'', blank2=f.endBlank?' data-blank="1"':'';
    ctl= exp?`<div class="sctl daterange-x"><input type="date" class="sctl-date-el"${v1?` value="${escAttr(v1)}"`:''}${rel1}${blank1}><span class="dr-sep">~</span><input type="date" class="sctl-date-el"${v2?` value="${escAttr(v2)}"`:''}${rel2}${blank2}></div>`:`<div class="sctl daterange">${esc(v1)} ~ ${esc(v2)}</div>`;
  }
  else if(f.type==='search')ctl= exp?`<div class="sctl search-x"><input type="text" class="sctl-text-el" placeholder="검색어 입력"><span class="sctl-search-ic"></span></div>`:'<div class="sctl search"><span class="sctl-search-ic"></span></div>';
  else if(f.type==='radio'){
    const opts=(f.options||'전체,확정,미확정').split(',').map((o,i)=>{
      const onCls=i===0?' on':'';
      const interCls=exp?' interactive':'';
      const attrs=exp?` data-group="sf-${cid}-${fi}" onclick="selectRadioGroupExport(this)"`:'';
      return `<span class="opt${onCls}${interCls}"${attrs}><span class="dot"></span>${esc(o.trim())}</span>`;
    }).join('');
    ctl=`<div class="sradio">${opts}</div>`;
  }
  else ctl= exp?`<div class="sctl text-x"><input type="text" class="sctl-text-el"></div>`:'<div class="sctl text"></div>';
  if(f.readonly){
    // grey out the control and, in exports, stop it from being editable
    ctl=ctl.replace(/^(<div class="[^"]*)/,'$1 ro');
    if(exp){
      ctl=ctl.replace(/<input /g,'<input readonly disabled ')
             .replace(/ onclick="[^"]*"/g,'')
             .replace(/ onmousedown="[^"]*"/g,'');
    }
  }
  return `<span class="slabel">${esc(f.label||'')}${freq}</span>${ctl}`;
}
// Renders one half (50%-width) box inside a .sfield-halfslot: a real field's label+control,
// or (for the empty field type) just a blank half-height placeholder.
function sfHalfBox(f,fi,exp,cid){
  if(f.type==='empty') return '<div class="sfield sfield-half sfield-empty"></div>';
  return `<div class="sfield sfield-half${f.type==='radio'?' radio':''}">${sfFieldInner(f,fi,exp,cid)}</div>`;
}
// palette for charts
const CHART_PAL={
  green:['#a8d5ba','#8bc4a0','#b9dfc9'],
  blue:['#aed4f2','#c5e0f7','#8fc0e8'],
  mixed:['#a8d5ba','#aed4f2','#f5d99b','#c9b8e8','#f2b8b8'],
  yellow:['#f5d99b','#f8e4b5','#efc978']
};
function chartSVG(c){
  const vals=(c.text||'').split(',').map(s=>parseFloat(s.trim())).filter(v=>!isNaN(v));
  const pal=CHART_PAL[c.color]||CHART_PAL.green;
  if(!vals.length)return '<div style="color:#bbb;font-size:12px;">데이터 없음</div>';
  const type=c.chartType||'bar';
  if(type==='donut')return donutSVG(vals,pal);
  if(type==='line')return lineSVG(vals,pal,false);
  if(type==='area')return lineSVG(vals,pal,true);
  return barSVG(vals,pal); // bar
}
function niceMax(v){return v<=0?10:Math.ceil(v/10)*10;}
function barSVG(vals,pal){
  const W=400,H=180,pad=24,bw=(W-pad*2)/vals.length*0.6, gap=(W-pad*2)/vals.length;
  const max=niceMax(Math.max(...vals,0)), min=Math.min(...vals,0), range=max-min||1;
  const y0=H-pad-((0-min)/range)*(H-pad*2);
  let bars='';
  vals.forEach((v,i)=>{
    const x=pad+gap*i+(gap-bw)/2;
    const yv=H-pad-((v-min)/range)*(H-pad*2);
    const top=Math.min(yv,y0), hh=Math.abs(yv-y0);
    bars+=`<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1,hh).toFixed(1)}" rx="2" fill="${pal[i%pal.length]}"/>`;
    bars+=`<text x="${(x+bw/2).toFixed(1)}" y="${(top-4).toFixed(1)}" font-size="10" fill="#666" text-anchor="middle">${v}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
    <line x1="${pad}" y1="${y0.toFixed(1)}" x2="${W-pad}" y2="${y0.toFixed(1)}" stroke="#333" stroke-width="1"/>
    ${bars}</svg>`;
}
function lineSVG(vals,pal,fill){
  const W=400,H=180,pad=24;
  const max=niceMax(Math.max(...vals,0)), min=Math.min(...vals,0), range=max-min||1;
  const step=(W-pad*2)/(vals.length-1||1);
  const pts=vals.map((v,i)=>[pad+step*i, H-pad-((v-min)/range)*(H-pad*2)]);
  const line=pts.map((p,i)=>(i?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' ');
  const col=pal[0];
  let area='';
  if(fill){
    const y0=H-pad-((0-min)/range)*(H-pad*2);
    area=`<path d="${line} L${pts[pts.length-1][0].toFixed(1)} ${y0.toFixed(1)} L${pts[0][0].toFixed(1)} ${y0.toFixed(1)} Z" fill="${col}" opacity="0.35"/>`;
  }
  const dots=pts.map(p=>`<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3" fill="${col}"/>`).join('');
  const zeroY=H-pad-((0-min)/range)*(H-pad*2);
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
    <line x1="${pad}" y1="${zeroY.toFixed(1)}" x2="${W-pad}" y2="${zeroY.toFixed(1)}" stroke="#e5e7eb" stroke-width="1"/>
    ${area}<path d="${line}" fill="none" stroke="${col}" stroke-width="2.5" stroke-linejoin="round"/>${dots}</svg>`;
}
function donutSVG(vals,pal){
  const total=vals.reduce((a,b)=>a+Math.abs(b),0)||1;
  const cx=90,cy=90,r=62,rw=26;
  let ang=-Math.PI/2, arcs='';
  vals.forEach((v,i)=>{
    const frac=Math.abs(v)/total, a2=ang+frac*Math.PI*2;
    const large=frac>0.5?1:0;
    const x1=cx+r*Math.cos(ang), y1=cy+r*Math.sin(ang);
    const x2=cx+r*Math.cos(a2), y2=cy+r*Math.sin(a2);
    if(frac>0.0001)
      arcs+=`<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} A${r} ${r} 0 ${large} 1 ${x2.toFixed(1)} ${y2.toFixed(1)}" fill="none" stroke="${pal[i%pal.length]}" stroke-width="${rw}"/>`;
    ang=a2;
  });
  // legend
  let lg='';
  vals.forEach((v,i)=>{
    const pct=Math.round(Math.abs(v)/total*100);
    lg+=`<div class="lg"><span class="sw" style="background:${pal[i%pal.length]}"></span>항목${i+1} ${v} (${pct}%)</div>`;
  });
  return `<div style="display:flex;align-items:center;width:100%;height:100%;">
    <svg viewBox="0 0 180 180" preserveAspectRatio="xMidYMid meet" style="flex:none;width:150px;height:150px;">
      ${arcs}
      <text x="90" y="95" font-size="18" font-weight="800" fill="#2c3e50" text-anchor="middle">${total}</text>
    </svg>
    <div class="legend">${lg}</div>
  </div>`;
}

// ---- Move / Resize ----
let drag=null;
function startMove(e,c){
  if(e.target.classList.contains('handle'))return;
  // Let the grid's own horizontal scrollbar work on the canvas: if the mousedown
  // landed on the scrollbar track of a scrollable grid body (below its client area),
  // don't start a component move - let the browser handle the native scrollbar drag.
  const gbody = e.target.closest && e.target.closest('.ax-grid .gbody.xscroll');
  if(gbody){
    const gb=gbody.getBoundingClientRect();
    // scrollbar sits in the strip between clientHeight and the full offset height.
    // gb is in scaled screen px; clientHeight is unscaled layout px, so divide by zoom.
    const offY=(e.clientY - gb.top)/(zoom||1);
    const overScrollbar = offY > gbody.clientHeight;
    if(overScrollbar && gbody.scrollWidth>gbody.clientWidth){
      // Don't start a move and don't re-render (re-rendering would destroy this
      // element mid-drag and cancel the native scrollbar grab). Just let it scroll.
      return;
    }
  }
  e.stopPropagation();
  const ctrl = e.ctrlKey||e.metaKey;
  if(ctrl){
    // Don't decide yet: a plain ctrl+click (no drag) toggles selection,
    // while a ctrl+drag duplicates the selection and moves the copy.
    const wasSelected = isSel(c.id);
    const groupIds = wasSelected ? [...selIds] : [c.id];
    drag={mode:'ctrlpending',c,sx:e.clientX,sy:e.clientY,wasSelected,groupIds,committed:false,pre:snapshot()};
    return;
  }
  // if clicking a component not in current selection, select just it
  if(!isSel(c.id)) selectSingle(c.id);
  render();
  // capture originals for all selected (group move)
  const group = comps.filter(x=>isSel(x.id)).map(x=>({c:x, ox:x.x, oy:x.y}));
  drag={mode:'move',c,sx:e.clientX,sy:e.clientY,ox:c.x,oy:c.y,committed:false,pre:snapshot(),group};
}
function startResize(e,c,dir){
  e.stopPropagation();selectSingle(c.id);render();
  drag={mode:'resize',dir,c,sx:e.clientX,sy:e.clientY,ow:c.w,oh:c.h,committed:false,pre:snapshot()};
}
// Dragging a grid column's own right border (the small handle rendered inside its header cell -
// see resizeHandle() in innerRaw's 'grid' case) resizes just that one column, independent of the
// property panel's global "컬럼 폭" slider. The handle's onmousedown calls this with the grid's
// component id and the column index rather than closing over live objects, since the grid's
// markup is built as an HTML string and inserted via innerHTML.
function startColResize(e,compId,ci){
  const c=comps.find(x=>x.id===compId); if(!c)return;
  // Measure the column's current on-screen width (its header cell, the handle's parent) BEFORE
  // selecting/rendering below - render() tears down and rebuilds the whole canvas, which would
  // detach this element from the document and make getBoundingClientRect() report zeros.
  const cell=e.target.closest('span');
  const rect=cell?cell.getBoundingClientRect():null;
  const ow=rect?rect.width/(zoom||1):Math.max(60,+c.colMinW||120);
  if(!isSel(c.id)){ selectSingle(c.id); render(); }
  drag={mode:'colresize',c,ci,sx:e.clientX,sy:e.clientY,ow,committed:false,pre:snapshot()};
}
// 그리드 헤더 셀 자체를 드래그해 컬럼 순서를 바꾼다 (Row Order/CheckBox 유틸리티 컬럼은 data-ci가
// 없어 애초에 손잡이 대상이 아니므로 항상 맨 왼쪽에 고정된다). resizeHandle과 달리 이 드래그는
// 매 mousemove마다 실제로 컬럼을 옮기지 않고 "어디에 놓일지"만 drag.hoverCi/hoverSide에 기록해
// innerRaw()가 그 값을 읽어 점선 표시(class)만 그려주다가, mouseup에서 한 번에 실제로 옮긴다.
function startColReorder(e,compId,ci){
  const c=comps.find(x=>x.id===compId); if(!c)return;
  if(!isSel(c.id)){ selectSingle(c.id); render(); }
  drag={mode:'colreorder',c,ci,sx:e.clientX,sy:e.clientY,committed:false,pre:snapshot(),hoverCi:ci,hoverSide:'before'};
  startColReorderAutoScroll(c.id);
}
// 현재 마우스 x좌표 아래에 있는 컬럼과, 그 컬럼의 왼쪽/오른쪽 중 어느 쪽에 놓일지를 계산해
// drag에 기록한다. 매번 DOM에서 다시 찾는 이유는, 이 함수를 호출하는 mousemove 핸들러 끝에서
// drawCanvas()가 매 프레임 캔버스를 통째로 다시 그리기 때문에(다른 drag 모드들도 동일) 이전
// 프레임에서 잡아둔 엘리먼트 참조가 다음 프레임엔 이미 못 쓰게 되어 있다.
function updateColReorderHover(clientX){
  const gh=document.querySelector('.cmp[data-cid="'+drag.c.id+'"] .gh');
  if(!gh)return;
  const spans=Array.from(gh.querySelectorAll('[data-ci]'));
  if(!spans.length)return;
  for(const el of spans){
    const r=el.getBoundingClientRect();
    const ci=parseInt(el.dataset.ci,10);
    if(clientX<=r.left){ drag.hoverCi=ci; drag.hoverSide='before'; return; }
    if(clientX<r.right){ drag.hoverCi=ci; drag.hoverSide=clientX<(r.left+r.right)/2?'before':'after'; return; }
  }
  // 마지막 컬럼보다 더 오른쪽 - 맨 끝에 놓는다.
  const last=spans[spans.length-1];
  drag.hoverCi=parseInt(last.dataset.ci,10); drag.hoverSide='after';
}
// 좌우 스크롤이 있는 그리드에서 컬럼을 드래그해 화면 밖(왼쪽/오른쪽 끝)으로 가져가면, 마우스가
// 가장자리 근처에 머무는 동안 계속 스크롤되어야 원하는 위치까지 옮길 수 있다. mousemove가 멈춰도
// (가장자리에서 정지) 계속 스크롤되도록 별도 타이머를 둔다 - #props 세로 스크롤과 같은 패턴.
// gbody를 직접 들고 있지 않고 매 tick마다 다시 찾는 이유도 위 updateColReorderHover와 동일하다.
let colReorderScrollX=null, colReorderScrollTimer=null, colReorderCompId=null;
function startColReorderAutoScroll(compId){
  colReorderCompId=compId;
  if(colReorderScrollTimer)return;
  colReorderScrollTimer=setInterval(()=>{
    if(colReorderScrollX==null||colReorderCompId==null)return;
    const wrap=document.querySelector('.cmp[data-cid="'+colReorderCompId+'"] .gbody');
    if(!wrap||wrap.scrollWidth<=wrap.clientWidth)return;
    const rect=wrap.getBoundingClientRect();
    const margin=40, maxSpeed=18;
    let dx=0;
    if(colReorderScrollX<rect.left+margin) dx=-maxSpeed*(1-Math.max(0,colReorderScrollX-rect.left)/margin);
    else if(colReorderScrollX>rect.right-margin) dx=maxSpeed*(1-Math.max(0,rect.right-colReorderScrollX)/margin);
    if(dx) wrap.scrollLeft+=dx;
  },30);
}
function stopColReorderAutoScroll(){
  if(colReorderScrollTimer){clearInterval(colReorderScrollTimer);colReorderScrollTimer=null;}
  colReorderScrollX=null; colReorderCompId=null;
}
// Dragging a split container's divider bar: adjusts c.pos (0.15-0.85) live as the mouse moves.
function startSplitDrag(e,c){
  e.stopPropagation(); e.preventDefault();
  drag={mode:'split',c,sx:e.clientX,sy:e.clientY,opos:c.pos!=null?c.pos:0.5,committed:false,pre:snapshot()};
}
document.addEventListener('mousemove',e=>{
  if(!drag)return;
  const dx=(e.clientX-drag.sx)/zoom, dy=(e.clientY-drag.sy)/zoom;

  if(drag.mode==='ctrlpending'){
    if(Math.abs(dx)<=3&&Math.abs(dy)<=3) return; // not enough movement yet; might still be a plain click
    // threshold crossed: duplicate the selected group (including any Tab children) and switch into a normal group move
    const fullIds=collectWithChildren(drag.groupIds);
    const idMap={};
    const dupGroup=[];
    fullIds.forEach(id=>{
      const orig=comps.find(x=>x.id===id);
      if(!orig)return;
      const nc=JSON.parse(JSON.stringify(orig));
      nc.id=uid++;
      comps.push(nc);
      idMap[id]=nc;
      dupGroup.push({c:nc, ox:orig.x, oy:orig.y});
    });
    dupGroup.forEach(g=>{ if(g.c.parent&&idMap[g.c.parent]) g.c.parent=idMap[g.c.parent].id; });
    if(!dupGroup.length){drag=null;return;}
    const clickedDup = idMap[drag.c.id] || dupGroup[0].c;
    selIds=new Set(dupGroup.map(g=>g.c.id));
    sel = clickedDup.id;
    undoStack.push(drag.pre);
    if(undoStack.length>HIST_MAX)undoStack.shift();
    redoStack=[]; updateHistBtns();
    drag={mode:'move',c:clickedDup,sx:drag.sx,sy:drag.sy,ox:clickedDup.x,oy:clickedDup.y,committed:true,pre:drag.pre,group:dupGroup};
    canvas.classList.add('reparent-drag');
    renderProps();
    // fall through below using the same dx/dy to apply the first move increment
  }

  // Remember the cursor's live canvas-space position so a reparent decision (which pane/tab a
  // dropped component lands in) can be based on where the mouse actually is, not the dragged
  // component's center - otherwise grabbing a large component by a corner near a container edge
  // can drop it into the wrong pane even though the cursor is clearly over the intended one.
  const canvasRect=canvas.getBoundingClientRect();
  drag.curX=(e.clientX-canvasRect.left)/zoom;
  drag.curY=(e.clientY-canvasRect.top)/zoom;

  if(!drag.committed&&(Math.abs(dx)>1||Math.abs(dy)>1)){
    undoStack.push(drag.pre);
    if(undoStack.length>HIST_MAX)undoStack.shift();
    redoStack=[]; updateHistBtns();
    drag.committed=true;
    if(drag.mode==='move') canvas.classList.add('reparent-drag');
  }
  let pendingGuides=null;
  if(drag.mode==='move'){
    const group = drag.group||[];
    if(group.length>1){
      // group move: apply same delta to all, grid-snap the delta
      // (skip comps whose parent container is also in this group - they move automatically since their x/y are relative to the parent)
      const groupIdSet=new Set(group.map(g=>g.c.id));
      let sdx=dx, sdy=dy;
      if(document.getElementById('snapChk').checked){const s=parseInt(document.getElementById('snapSize').value)||10;sdx=Math.round(sdx/s)*s;sdy=Math.round(sdy/s)*s;}
      group.forEach(g=>{
        if(g.c.parent&&groupIdSet.has(g.c.parent))return;
        const gnx=g.ox+sdx, gny=g.oy+sdy;
        g.c.x=g.c.parent?gnx:Math.max(0,gnx);
        g.c.y=g.c.parent?gny:Math.max(0,gny);
      });
    } else {
      let nx=drag.ox+dx, ny=drag.oy+dy;
      if(!drag.c.parent){ nx=Math.max(0,nx); ny=Math.max(0,ny); }
      const smart=document.getElementById('smartChk').checked&&!drag.c.parent; // guides are canvas-relative; skip for nested Tab children
      let snappedX=false, snappedY=false;
      if(smart){
        const g=computeGuides(drag.c,nx,ny);
        snappedX=g.x!==nx; snappedY=g.y!==ny;
        nx=g.x; ny=g.y; pendingGuides=g.lines;
      }
      // grid snap only on axes not caught by a smart guide
      drag.c.x=snappedX?Math.round(nx):snap(nx);
      drag.c.y=snappedY?Math.round(ny):snap(ny);
    }
  }
  else if(drag.mode==='resize'){
    if(drag.dir!=='s')drag.c.w=snap(Math.max(30,drag.ow+dx));
    if(drag.dir!=='e')drag.c.h=snap(Math.max(20,drag.oh+dy));
    if(drag.c.type==='grid'&&drag.dir!=='s') drag.c._sizeModeManual=false;
  }
  else if(drag.mode==='colresize'){
    const w=Math.round(Math.max(40,drag.ow+dx));
    if(!Array.isArray(drag.c.colWidths))drag.c.colWidths=[];
    drag.c.colWidths[drag.ci]=w;
  }
  else if(drag.mode==='colreorder'){
    colReorderScrollX=e.clientX;
    updateColReorderHover(e.clientX);
  }
  else if(drag.mode==='split'){
    const dim = drag.c.dir==='v' ? drag.c.h : drag.c.w;
    const delta = drag.c.dir==='v' ? dy : dx;
    let pos = drag.opos + delta/dim;
    drag.c.pos = Math.min(0.85,Math.max(0.15,pos));
  }
  // drawCanvas() itself now preserves every grid's horizontal scroll across the rebuild (see the
  // comment there), so this can just be a plain call regardless of drag mode.
  drawCanvas();
  if(pendingGuides)drawGuides(pendingGuides);
  syncPropFields(drag.c);
});
document.addEventListener('mouseup',()=>{
  if(drag){
    if(drag.mode==='ctrlpending'){
      // ctrl was held but the mouse never moved beyond the threshold: treat as a plain ctrl+click
      toggleSel(drag.c.id);
      drag=null;render();
      return;
    }
    if(drag.mode==='move'&&drag.committed) finalizeReparentDrag(drag);
    if(drag.mode==='split'&&!drag.committed){
      // divider was clicked but never actually dragged: select the split container itself
      selectSingle(drag.c.id);
    }
    if(drag.mode==='colreorder'){
      stopColReorderAutoScroll();
      // Not moved at all (plain click) -> nothing to reorder, startColReorder() already selected
      // the grid on mousedown. Otherwise commit the drop position recorded by the last
      // updateColReorderHover() call: "놓일 컬럼 + before/after" converts to a single final index
      // exactly the way gcDrop's drag-and-drop in the property panel already does.
      if(drag.committed&&drag.hoverCi!=null){
        const i=drag.hoverSide==='after'?drag.hoverCi+1:drag.hoverCi;
        const insertAt=drag.ci<i?i-1:i;
        moveGridColumn(drag.c,drag.ci,insertAt);
      }
    }
    // render() -> drawCanvas() also preserves scroll here, same as above.
    drag=null;clearGuides();canvas.classList.remove('reparent-drag');render();
  }
});
// After a real (non-resize) move ends, check whether each moved top-level comp was dropped onto a Tab's
// content area (reparent into it) or a Tab child was dragged out of its container (promote back to top-level).
function finalizeReparentDrag(d){
  const items = (d.group&&d.group.length) ? d.group.map(g=>g.c) : [d.c];
  const movingIds = new Set(items.map(x=>x.id));
  // Which tab/pane/panel the drop lands in is decided ONCE, from the actual cursor position -
  // not from each dragged component's own center - so grabbing a large component by a
  // corner still drops it wherever the mouse visually is.
  const hitX = d.curX!=null ? d.curX : (d.c.x+d.c.w/2);
  const hitY = d.curY!=null ? d.curY : (d.c.y+d.c.h/2);
  const tabTarget=hitTestTabContainer(hitX,hitY);
  const splitTargetShared=!tabTarget ? hitTestSplitContainer(hitX,hitY) : null;
  const panelTargetShared=(!tabTarget&&!splitTargetShared) ? hitTestPanelContainer(hitX,hitY) : null;
  items.forEach(comp=>{
    if(!comp || comp.type==='tabs') return; // tab containers themselves are never nested
    if(comp.parent && movingIds.has(comp.parent)) return; // moves together with its own container automatically
    // comp's current absolute position (before reparenting) - reuses the same parent-chain
    // math as absPos() so panel/tabs/split parents are all handled consistently.
    const {x:absX,y:absY}=absPos(comp);
    let splitTarget=splitTargetShared;
    let panelTarget=panelTargetShared;
    // don't allow a split/panel container to be dropped inside itself or one of its own descendants
    if(splitTarget&&comp.type==='split'&&(splitTarget.c.id===comp.id||isDescendantOf(splitTarget.c,comp.id))) splitTarget=null;
    if(panelTarget&&comp.type==='panel'&&(panelTarget.c.id===comp.id||isDescendantOf(panelTarget.c,comp.id))) panelTarget=null;
    if(tabTarget){
      comp.parent=tabTarget.c.id;
      comp.tabIdx=tabTarget.c.active||0;
      delete comp.pane; delete comp.dock;
      comp.x=Math.max(0,snap(absX-tabTarget.cx));
      comp.y=Math.max(0,snap(absY-tabTarget.cy));
    } else if(splitTarget){
      const paneRect=splitTarget.pane===0?splitTarget.rects.pane0:splitTarget.rects.pane1;
      const oldParent=splitTarget.c.id, oldPane=splitTarget.pane;
      comp.parent=oldParent;
      comp.pane=oldPane;
      if(!comp.dock) comp.dock = comp.type==='split' ? 'fill' : 'none';
      delete comp.tabIdx;
      if(comp.dock==='fill'){
        comp.x=0; comp.y=0; comp.w=paneRect.w; comp.h=paneRect.h;
      } else {
        // None: keep its own size, just re-anchor its position relative to the new pane's origin
        comp.x=Math.max(0,snap(absX-splitTarget.cx));
        comp.y=Math.max(0,snap(absY-splitTarget.cy));
      }
      if(comp.type==='split'){
        // that pane may already have content - move it into the newly-nested split's
        // first pane instead of letting it silently overlap
        comps.forEach(k=>{
          if(k.id!==comp.id&&!movingIds.has(k.id)&&k.parent===oldParent&&(k.pane||0)===oldPane){
            k.parent=comp.id; k.pane=0; if(!k.dock)k.dock='fill';
          }
        });
      }
    } else if(panelTarget){
      // 패널/그룹박스 위에 놓으면 탭·스플릿처럼 그 패널의 자식이 된다(상대좌표로 재계산).
      comp.parent=panelTarget.c.id;
      delete comp.tabIdx; delete comp.pane; delete comp.dock;
      comp.x=Math.max(0,snap(absX-panelTarget.cx));
      comp.y=Math.max(0,snap(absY-panelTarget.cy));
    } else if(comp.parent){
      // dropped outside every container's content area: promote back to a top-level component
      comp.x=Math.max(0,snap(absX));
      comp.y=Math.max(0,snap(absY));
      delete comp.parent;
      delete comp.tabIdx;
      delete comp.pane;
      delete comp.dock;
    }
  });
}

// ---- Rubber-band (drag box) selection ----
let boxSel=null;
canvas.addEventListener('mousedown',e=>{
  if(e.target!==canvas)return; // only when clicking empty canvas
  const r=canvas.getBoundingClientRect();
  const ctrl=e.ctrlKey||e.metaKey;
  boxSel={sx:(e.clientX-r.left)/zoom, sy:(e.clientY-r.top)/zoom, ctrl, base:ctrl?new Set(selIds):new Set(), moved:false};
  if(!ctrl){ selectSingle(null); render(); }
});
document.addEventListener('mousemove',e=>{
  if(!boxSel)return;
  const r=canvas.getBoundingClientRect();
  const cx=(e.clientX-r.left)/zoom, cy=(e.clientY-r.top)/zoom;
  const x=Math.min(cx,boxSel.sx), y=Math.min(cy,boxSel.sy), w=Math.abs(cx-boxSel.sx), h=Math.abs(cy-boxSel.sy);
  if(w>2||h>2)boxSel.moved=true;
  // compute intersecting comps (union with ctrl base)
  const hit=new Set(boxSel.base);
  comps.forEach(c=>{
    if(c.parent)return; // nested Tab children use relative coords; select them by clicking directly instead
    const inter = !(c.x > x+w || c.x+c.w < x || c.y > y+h || c.y+c.h < y);
    if(inter) hit.add(c.id);
  });
  setSelection(hit);
  drawCanvas();
  // draw selection box on top (drawCanvas cleared canvas)
  const box=document.createElement('div');
  box.id='selbox';
  box.style.left=x+'px';box.style.top=y+'px';box.style.width=w+'px';box.style.height=h+'px';
  canvas.appendChild(box);
});
document.addEventListener('mouseup',()=>{
  if(boxSel){
    const box=document.getElementById('selbox'); if(box)box.remove();
    boxSel=null;
    renderProps();
  }
});

// ---- Rubber-band selection inside a Tab page / Split pane's content area ----
// Mirrors the top-level canvas rubber-band above, but scoped to one container's own children
// (a Tab's current page, or one Split pane), in that container's local content coordinates.
// Needed because Tabs/Split no longer forward a plain body drag up to their own move handler
// (see renderComp/renderSplitChildren) - that drag should rubber-band-select the components
// inside instead, exactly like dragging on the empty canvas does at the top level.
let localBoxSel=null;
// contentEl: the .tabs-body-wrap or .split-pane div itself (its background, not a child, must
// be the actual mousedown target). c: the tabs/split component. pane: 0/1 for split, null for tabs.
// getMembers(): returns the live list of comps currently shown in that content area.
function attachContainerBoxSelect(contentEl,c,pane,getMembers){
  contentEl.addEventListener('mousedown',e=>{
    if(e.target!==contentEl)return; // only when dragging the empty content background itself
    e.stopPropagation();
    const ctrl=e.ctrlKey||e.metaKey;
    const r=contentEl.getBoundingClientRect();
    localBoxSel={
      compId:c.id, pane, getMembers,
      sx:(e.clientX-r.left)/zoom+(contentEl.scrollLeft||0),
      sy:(e.clientY-r.top)/zoom+(contentEl.scrollTop||0),
      ctrl, base:ctrl?new Set(selIds):new Set(), moved:false
    };
    if(!ctrl){ selectSingle(null); render(); }
  });
}
// The content <div> is torn down and rebuilt by every drawCanvas() call (including the ones this
// very drag triggers on each mousemove), so it can never be held onto directly across the drag -
// it's re-located each time via the stable data-cid its wrapper always carries.
function findContainerContentEl(compId,pane){
  const wrap=canvas.querySelector('.cmp[data-cid="'+compId+'"]');
  if(!wrap)return null;
  const c=comps.find(x=>x.id===compId);
  if(!c)return null;
  if(c.type==='tabs') return wrap.querySelector(':scope > .tabs-body-wrap');
  if(c.type==='split'){
    const panes=wrap.querySelectorAll(':scope > .split-pane');
    return panes[pane||0]||null;
  }
  return null;
}
document.addEventListener('mousemove',e=>{
  if(!localBoxSel)return;
  const el=findContainerContentEl(localBoxSel.compId,localBoxSel.pane);
  if(!el)return; // container got deleted, or its tab page is no longer the active one
  const r=el.getBoundingClientRect();
  const cx=(e.clientX-r.left)/zoom+(el.scrollLeft||0), cy=(e.clientY-r.top)/zoom+(el.scrollTop||0);
  const x=Math.min(cx,localBoxSel.sx), y=Math.min(cy,localBoxSel.sy);
  const w=Math.abs(cx-localBoxSel.sx), h=Math.abs(cy-localBoxSel.sy);
  if(w>2||h>2)localBoxSel.moved=true;
  const hit=new Set(localBoxSel.base);
  localBoxSel.getMembers().forEach(k=>{
    const inter = !(k.x > x+w || k.x+k.w < x || k.y > y+h || k.y+k.h < y);
    if(inter) hit.add(k.id);
  });
  setSelection(hit);
  drawCanvas();
  // re-locate again post-rebuild (drawCanvas just replaced it) to append the box in the right place
  const el2=findContainerContentEl(localBoxSel.compId,localBoxSel.pane);
  if(el2){
    const box=document.createElement('div');
    box.id='selbox';
    box.style.left=x+'px';box.style.top=y+'px';box.style.width=w+'px';box.style.height=h+'px';
    el2.appendChild(box);
  }
});
document.addEventListener('mouseup',()=>{
  if(localBoxSel){
    const box=document.getElementById('selbox'); if(box)box.remove();
    localBoxSel=null;
    renderProps();
  }
});

// ---- Smart guides (PowerPoint-style) ----
const SNAP_TOL=6; // px snapping threshold
function computeGuides(moving,x,y){
  const w=moving.w, h=moving.h;
  const cw=canvas.offsetWidth, ch=canvas.offsetHeight;
  // moving edges (candidate)
  const mV={left:x, cx:x+w/2, right:x+w};      // vertical lines (x positions)
  const mH={top:y, cy:y+h/2, bottom:y+h};      // horizontal lines (y positions)
  // build target edge sets from other comps + canvas
  const vTargets=[], hTargets=[];
  comps.forEach(c=>{
    if(c.id===moving.id)return;
    vTargets.push({pos:c.x,span:[c.y,c.y+c.h]},{pos:c.x+c.w/2,span:[c.y,c.y+c.h]},{pos:c.x+c.w,span:[c.y,c.y+c.h]});
    hTargets.push({pos:c.y,span:[c.x,c.x+c.w]},{pos:c.y+c.h/2,span:[c.x,c.x+c.w]},{pos:c.y+c.h,span:[c.x,c.x+c.w]});
  });
  // canvas center + edges
  vTargets.push({pos:cw/2,span:[0,ch]},{pos:0,span:[0,ch]},{pos:cw,span:[0,ch]});
  hTargets.push({pos:ch/2,span:[0,cw]},{pos:0,span:[0,cw]},{pos:ch,span:[0,cw]});

  let bestVX=null,bestVLine=null,bestVDelta=SNAP_TOL+1;
  Object.entries(mV).forEach(([k,val])=>{
    vTargets.forEach(t=>{
      const d=Math.abs(val-t.pos);
      if(d<bestVDelta){bestVDelta=d;bestVX={key:k,shift:t.pos-val};bestVLine={pos:t.pos,span:t.span,my:[y,y+h]};}
    });
  });
  let bestHY=null,bestHLine=null,bestHDelta=SNAP_TOL+1;
  Object.entries(mH).forEach(([k,val])=>{
    hTargets.forEach(t=>{
      const d=Math.abs(val-t.pos);
      if(d<bestHDelta){bestHDelta=d;bestHY={key:k,shift:t.pos-val};bestHLine={pos:t.pos,span:t.span,mx:[x,x+w]};}
    });
  });

  const lines=[];
  if(bestVX){x+=bestVX.shift;
    const s0=Math.min(bestVLine.span[0],y),s1=Math.max(bestVLine.span[1],y+h);
    lines.push({dir:'v',pos:bestVLine.pos,a:s0,b:s1});
  }
  if(bestHY){y+=bestHY.shift;
    const s0=Math.min(bestHLine.span[0],x),s1=Math.max(bestHLine.span[1],x+w);
    lines.push({dir:'h',pos:bestHLine.pos,a:s0,b:s1});
  }
  return {x,y,lines};
}
function drawGuides(lines){
  clearGuides();
  lines.forEach(l=>{
    const el=document.createElement('div');
    if(l.dir==='v'){el.className='guideline v';el.style.left=l.pos+'px';el.style.top=l.a+'px';el.style.height=(l.b-l.a)+'px';el.style.bottom='auto';}
    else{el.className='guideline h';el.style.top=l.pos+'px';el.style.left=l.a+'px';el.style.width=(l.b-l.a)+'px';el.style.right='auto';}
    canvas.appendChild(el);
  });
}
function clearGuides(){canvas.querySelectorAll('.guideline,.gl-dist').forEach(e=>e.remove());}
// +/- 단축키 처리: 선택된 컴포넌트 유형에 맞는 추가/삭제 함수로 위임한다.
// 삭제(-)는 항상 "맨 뒤" 항목을 지운다. 처리했으면 true 를 반환한다.
function itemShortcut(action){
  const c=comps.find(x=>x.id===sel);if(!c)return false;
  if(c.type==='grid'){
    if(action==='add'){ addGridCol(); return true; }
    const n=gridColsArr(c).length; if(n>0){ delGridCol(n-1); } return true;
  }
  if(c.type==='searchbar'){
    if(action==='add'){ addSearchField(); return true; }
    const n=(c.fields||[]).length; if(n>0){ delSearchField(n-1); } return true;
  }
  if(c.type==='tabs'){
    if(action==='add'){ ilAdd('text','탭'); return true; }
    const n=ilItems(c,'text').length; if(n>0){ ilDel('text',n-1); } return true;
  }
  if(c.type==='combo'||c.type==='radio'){
    if(action==='add'){ ilAdd('options','옵션'); return true; }
    const n=ilItems(c,'options').length; if(n>0){ ilDel('options',n-1); } return true;
  }
  return false;
}
document.addEventListener('keydown',e=>{
  const typing=['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName);
  const mod=e.ctrlKey||e.metaKey;
  if(mod&&(e.key==='z'||e.key==='Z')&&!e.shiftKey){e.preventDefault();undo();return;}
  if(mod&&((e.key==='y'||e.key==='Y')||((e.key==='z'||e.key==='Z')&&e.shiftKey))){e.preventDefault();redo();return;}
  if(mod&&(e.key==='c'||e.key==='C')&&!typing){e.preventDefault();copySelectionToSystem();return;}
  if(mod&&(e.key==='v'||e.key==='V')&&!typing){e.preventDefault();pasteFromClipboard();return;}
  if((e.key==='Delete'||e.key==='Backspace')&&sel!==null&&!typing){
    e.preventDefault();
    delSel();
  }
  // +/- 단축키: 선택한 컴포넌트에서 항목(탭/조회조건/옵션/컬럼)을 하나 추가(+)하거나
  // 맨 뒤에서 하나 삭제(-)한다. 입력 중이거나 단일 선택이 아니면 무시한다.
  if(!typing && sel!==null && selIds.size===1){
    const plus = e.key==='+' || e.key==='=' || e.code==='NumpadAdd';
    const minus = e.key==='-' || e.key==='_' || e.code==='NumpadSubtract';
    if(plus||minus){
      if(itemShortcut(plus?'add':'del')){ e.preventDefault(); return; }
    }
  }
  if(e.key==='Escape'){
    // 열려 있는 팝업을 닫는다. 여러 개가 겹쳐 있을 수 있으므로 위에 뜬 것부터 순서대로
    // 하나씩만 닫고 빠져나간다. 마지막으로 배치 대기 중인 컴포넌트를 해제한다.
    // 입력 중(typing)에는 팝업을 닫지 않는다. 이미지 변환 창은 닫을 때 붙여넣은 JSON과
    // 이미지를 비우기 때문에, 입력칸에서 무심코 Esc 를 눌러 내용을 날리는 일을 막는다.
    const modal = id => { const el=document.getElementById(id); return el&&el.classList.contains('on') ? el : null; };
    // 둘러보기는 다른 모달보다 위에 그려지므로 가장 먼저 처리한다.
    const tour=document.getElementById('tourOverlay');
    if(tour && tour.style.display==='block'){ closeTour(); return; }
    if(!typing){
      if(modal('patchBg')){ closePatch(); return; }
      if(modal('guideBg')){ closeGuide(); return; }
      if(modal('tmplBg')){ closeTemplates(); return; }
      if(modal('convBg')){ closeConvert(); return; }
      if(modal('skinBg')){ closeSkinPicker(); return; }
      if(modal('cloudBg')){ closeCloud(); return; }
      if(modal('signupBg')){ closeSignup(); return; }
      if(modal('loginBg')){ closeLogin(); return; }
    }
    // 자동 저장 복구 안내는 Esc 로 닫지 않는다. 무심코 눌러 닫으면 직전 작업을
    // 되살릴 기회가 사라지므로, 「이어서 작업」/「새로 시작」을 직접 고르게 둔다.
    if(armedType){ armedType=null; updateArmedUI(); }
  }
});

// ---- Properties panel ----
// "입력 컴포넌트" 그룹(툴박스의 입력 컴포넌트 섹션과 동일한 타입 집합).
// 정렬/간격 기능은 이 타입들로만 구성된 다중 선택에서만 노출한다.
const INPUT_COMPONENT_TYPES=['label','input','combo','date','daterange','check','radio','popup'];
function isInputComponent(c){ return INPUT_COMPONENT_TYPES.includes(c.type); }
// Builds the small "?" badge whose tooltip replaces the old always-visible hint paragraphs.
function qh(text){
  return `<span class="qhelp" tabindex="0">?<span class="qtip">${text}</span></span>`;
}
function renderProps(){
  const p=document.getElementById('props');
  if(selIds.size>1){
    const selComps=comps.filter(c=>selIds.has(c.id));
    const allInput=selComps.every(isInputComponent);
    let alignSection='';
    if(allInput){
      // 정렬 대상(같은 parent 공유) 확정. 기준은 항상 좌측 상단 컴포넌트.
      const info=alignTargets();
      const crossParent=info && info.targets.length<selComps.length;
      // 슬라이더 기본값=현재 실제 간격, 최대값=캔버스 기준. 현재값이 max보다 크면 max를 늘려 표시.
      const gapMaxH0=gapSliderMax('x'), gapMaxV0=gapSliderMax('y');
      const curGapH=currentGap('x'), curGapV=currentGap('y');
      const gapMaxH=Math.max(gapMaxH0, curGapH);
      const gapMaxV=Math.max(gapMaxV0, curGapV);
      alignSection=`
      <div class="hint" style="margin:2px 0 8px;">정렬 기준은 항상 선택된 컴포넌트 중 <b>좌측 상단</b>에 위치한 컴포넌트입니다.</div>
      <div class="lp-grid" style="grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px;">
        <button class="lp-btn" onclick="alignHorizontal()">↔ 수평 정렬</button>
        <button class="lp-btn" onclick="alignVertical()">↕ 수직 정렬</button>
      </div>
      <button class="lp-btn" style="width:100%;margin-bottom:12px;" onclick="alignSmart()">✦ 스마트 정렬 (수평 → 수직)</button>

      <div class="gap-adjust">
        <div class="gap-row">
          <label>↔ 가로 위치 간격
            <input type="number" id="gapHInput" class="gap-num" value="${curGapH}" min="0" max="${gapMaxH}" step="1"
              onchange="onGapNumber('x', this.value)" onkeydown="if(event.key==='Enter'){onGapNumber('x',this.value);this.blur();}"><span class="gap-unit">px</span>
          </label>
          <input type="range" id="gapHRange" min="0" max="${gapMaxH}" value="${curGapH}" step="1"
            onmousedown="gapSliderStart('x')" ontouchstart="gapSliderStart('x')"
            oninput="onGapSlider('x', this.value)"
            onchange="gapSliderEnd('x')" onmouseup="gapSliderEnd('x')" ontouchend="gapSliderEnd('x')">
        </div>
        <div class="gap-row">
          <label>↕ 세로 위치 간격
            <input type="number" id="gapVInput" class="gap-num" value="${curGapV}" min="0" max="${gapMaxV}" step="1"
              onchange="onGapNumber('y', this.value)" onkeydown="if(event.key==='Enter'){onGapNumber('y',this.value);this.blur();}"><span class="gap-unit">px</span>
          </label>
          <input type="range" id="gapVRange" min="0" max="${gapMaxV}" value="${curGapV}" step="1"
            onmousedown="gapSliderStart('y')" ontouchstart="gapSliderStart('y')"
            oninput="onGapSlider('y', this.value)"
            onchange="gapSliderEnd('y')" onmouseup="gapSliderEnd('y')" ontouchend="gapSliderEnd('y')">
        </div>
        <div class="hint" style="margin-top:4px;">기준(좌측 상단) 컴포넌트를 고정한 채, 각 컴포넌트의 <b>좌측(시작 위치)</b>이 균일한 간격으로 줄을 서도록 조절됩니다. 컴포넌트 크기는 바뀌지 않습니다.</div>
      </div>
      ${crossParent?`<div class="hint" style="margin-bottom:10px;color:#c47a00;">※ 서로 다른 컨테이너에 걸친 컴포넌트는 정렬 대상에서 제외됩니다. 같은 영역의 ${info.targets.length}개만 정렬됩니다.</div>`:''}
      `;
    }else{
      alignSection=`<div class="hint" style="margin:2px 0 12px;color:#8a94a0;">정렬·간격 조절 기능은 <b>입력 컴포넌트</b>(라벨/텍스트박스/콤보박스/날짜/기간/체크박스/라디오/팝업)만 선택했을 때 사용할 수 있습니다.</div>`;
    }
    p.innerHTML=`<h3>${selIds.size}개 선택됨</h3>
      <div class="hint" style="margin-bottom:10px;">여러 컴포넌트가 선택되었습니다. 드래그로 함께 이동하거나 Del 키로 모두 삭제할 수 있습니다.<br>Ctrl(⌘)+클릭으로 선택에서 빼거나 추가, Ctrl(⌘)+드래그로 복사 이동할 수 있습니다.</div>
      ${alignSection}
      <button class="del-btn" onclick="delSel()">선택한 ${selIds.size}개 삭제 (Del)</button>`;
    return;
  }
  const c=comps.find(x=>x.id===sel);
  if(!c){p.innerHTML='<div class="empty-props">컴포넌트를 선택하면<br>여기에 속성이 표시됩니다.<br><br>왼쪽 도구상자에서 캔버스로<br>끌어다 놓으세요.<br><br>여러 개 선택: 빈 곳에서 드래그<br>또는 Ctrl(⌘)+클릭<br><br>복사: Ctrl(⌘)+드래그 또는<br>Ctrl(⌘)+C / Ctrl(⌘)+V<div style="margin-top:22px;padding-top:16px;border-top:1px solid #e2e8f0;text-align:left;font-size:12px;line-height:1.7;color:#64748b;"><b style="color:#334155;">사용 안내</b><br>본 프로그램은 <b style="color:#185fa5;">인가된 업무 목적</b>으로만 사용할 수 있습니다.<br><br><span style="color:#94a2ae;">다음 행위를 금지합니다</span><br>· 목적 외 사용<br>· 데이터의 외부 유출 및 무단 배포<br><br>원활한 운영과 보안을 위해 <b style="color:#334155;">접속 정보(IP, 사용자명 등)가 기록</b>될 수 있으며, 사용에 따른 <b style="color:#334155;">모든 책임은 사용자 본인</b>에게 있습니다.</div></div>';return;}
  const fatMode=document.body.classList.contains('skin-classic');
  const names={title:'화면 제목',section:'섹션 헤더',panel:'패널',tabs:'탭(Tab)',split:'스플릿 컨테이너',label:'라벨',input:'텍스트박스',combo:'콤보박스',date:'날짜선택',daterange:'기간',check:'체크박스',radio:'라디오',button:'버튼',grid:'그리드',chart:'차트',tree:'트리',searchbar:'조회조건 패널',popup:'팝업'};
  let html=`<h3>${names[c.type]} 속성</h3>`;
  if(c.type!=='panel'&&c.type!=='split'){
    if(c.type==='tree'){
      html+=`<div class="prop"><label>트리 항목${qh('한 줄에 하나씩 입력합니다. 앞에 <b>공백 2칸</b>을 넣을 때마다 한 단계씩 하위 항목이 됩니다.<br><br>하위가 있는 항목에는 자동으로 −/+ 접기 버튼이 표시됩니다.')}</label>
        <textarea class="tree-ta" rows="9" oninput="upd('text',this.value)" spellcheck="false">${esc(c.text||'')}</textarea></div>`;

    } else if(c.type!=='grid'&&c.type!=='tabs'){
      if(c.type==='daterange'&&fatMode){
        const parts=(c.text||'').split('~').map(s=>s.trim());
        const tip=qh('두 날짜를 각각 입력합니다. "YYYY-MM-DD" 형식 권장(내보내기 결과물에서 실제 날짜 입력칸 두 개로 표시됩니다).');
        const drStyle=(rq,ro)=> ro?'readonly':(rq?'required':'none');
        const drStyleRadios=(idx,rq,ro)=>{
          const cur=drStyle(rq,ro);
          const opts=[['none','없음'],['required','필수'],['readonly','읽기전용']];
          return `<div class="prop"><label>날짜${idx+1} 스타일</label><div class="lp-grid">`+
            opts.map(([v,t])=>`<button class="lp-btn${cur===v?' on':''}" onclick="updDrStyle(${idx},'${v}')">${t}</button>`).join('')+
            `</div></div>`;
        };
        html+=`<div class="prop"><label>날짜1${tip}</label><input value="${(parts[0]||'').replace(/"/g,'&quot;')}" oninput="updDateRangePart(0,this.value)"></div>`;
        html+=drStyleRadios(0,c.required,c.readonly);
        html+=`<div class="prop"><label>날짜2</label><input value="${(parts[1]||'').replace(/"/g,'&quot;')}" oninput="updDateRangePart(1,this.value)"></div>`;
        html+=drStyleRadios(1,c.required2,c.readonly2);
      } else if(c.type==='date' || c.type==='daterange'){
        // 날짜·기간 컴포넌트는 더 이상 텍스트를 직접 입력하지 않는다 - 값은 아래 달력 아이콘의
        // 빠른 날짜 팝업으로만 정하고, 이 입력칸은 그 결과를 보여주는 읽기전용 표시로만 쓴다.
        const isDr=c.type==='daterange';
        let val;
        if(isDr){
          const drp=(c.text||'').split('~').map(s=>s.trim());
          const dv1=c.startBlank?'(빈값)':(qdResolvedText(drp[0],c.startSpec)||todayStr()), dv2=c.endBlank?'(빈값)':(qdResolvedText(drp[1],c.endSpec)||todayStr());
          val=dv1+' ~ '+dv2;
        }else{
          val=c.blank?'(빈값)':(qdResolvedText(c.text,c.dateSpec)||todayStr());
        }
        const lbl=isDr?'표시 텍스트':'텍스트';
        const tip=isDr?qh('"YYYY-MM-DD ~ YYYY-MM-DD" 형식으로 저장됩니다. 내보내기 결과물에서 <b>시작일·종료일 두 개의 실제 날짜 입력</b>으로 표시됩니다.'):'';
        html+=`<div class="prop"><label>${lbl}${tip}</label><input value="${escAttr(val)}" disabled title="아래 달력 아이콘으로 값을 선택하세요"></div>`;
        if(isDr){
          html+=`<div class="qd-open-row">
            <button class="qd-open-btn" onclick="openQuickDateComp(this,${c.id},'start')">📅 시작일</button>
            <button class="qd-open-btn" onclick="openQuickDateComp(this,${c.id},'end')">📅 종료일</button>
          </div>`;
        }else{
          html+=`<button class="qd-open-btn" onclick="openQuickDateComp(this,${c.id},'single')">📅 날짜 선택</button>`;
        }
      } else {
        const lbl=(c.type==='daterange'?'표시 텍스트':'텍스트');
        const tip=c.type==='daterange'?qh('"YYYY-MM-DD ~ YYYY-MM-DD" 형식으로 입력하면 내보내기 결과물에서 <b>시작일·종료일 두 개의 실제 날짜 입력</b>으로 표시됩니다.'):'';
        html+=`<div class="prop"><label>${lbl}${tip}</label><input value="${(c.text||'').replace(/"/g,'&quot;')}" oninput="upd('text',this.value)"></div>`;
      }
    }
  }
  {
    const dockParent = c.parent ? comps.find(x=>x.id===c.parent) : null;
    if(dockParent && dockParent.type==='split'){
      const dock=c.dock==='fill'?'fill':'none';
      html+=`<div class="prop"><label>배치 방식 (Dock)${qh('<b>Fill</b>로 두면 컴포넌트가 영역 크기에 자동으로 맞춰지고(경계선을 옮기면 같이 조절됨), 직접 이동·크기조절은 할 수 없습니다.<br><br><b>None</b>은 영역 안에서 자유롭게 배치합니다.')}</label><select onchange="upd('dock',this.value)">
        <option value="none"${dock==='none'?' selected':''}>None · 자유 배치·크기조절 (기본값)</option>
        <option value="fill"${dock==='fill'?' selected':''}>Fill · 영역에 꽉 채우기</option>
      </select></div>`;
    }
  }
  const posHtml=`<div class="prop-row">
    <div class="prop"><label>X</label><input type="number" data-prop="x" value="${c.x}" oninput="upd('x',+this.value)"></div>
    <div class="prop"><label>Y</label><input type="number" data-prop="y" value="${c.y}" oninput="upd('y',+this.value)"></div>
  </div>
  <div class="prop-row">
    <div class="prop"><label>너비</label><input type="number" data-prop="w" value="${c.w}" oninput="upd('w',+this.value)"></div>
    <div class="prop"><label>높이</label><input type="number" data-prop="h" value="${c.h}" oninput="upd('h',+this.value)"></div>
  </div>`;
  if(['label','input','combo','date','daterange','section','check','popup'].includes(c.type)&&!(c.type==='daterange'&&fatMode))
    html+=`<div class="prop"><label class="cbx"><input type="checkbox" ${c.required?'checked':''} onchange="upd('required',this.checked)"> 필수 항목 (*)</label></div>`;
  if(c.type==='label'&&fatMode){
    const lblStyle=(c.style==='ref'||c.style==='jump')?c.style:'none';
    html+=`<div class="grp"><div class="grp-h">스타일${qh('라벨 왼쪽에 작은 아이콘을 붙입니다. <b>Ref</b>는 참조 정보, <b>Jump</b>는 다른 화면으로 이동함을 나타낼 때 씁니다.')}</div>
      <div class="prop"><label class="cbx"><input type="radio" name="lblStyle${c.id}" ${lblStyle==='none'?'checked':''} onchange="upd('style','none')"> 없음</label></div>
      <div class="prop"><label class="cbx"><input type="radio" name="lblStyle${c.id}" ${lblStyle==='ref'?'checked':''} onchange="upd('style','ref')"> Ref</label></div>
      <div class="prop"><label class="cbx"><input type="radio" name="lblStyle${c.id}" ${lblStyle==='jump'?'checked':''} onchange="upd('style','jump')"> Jump</label></div>
    </div>`;
  }
  if(LABELED_TYPES.includes(c.type)){
    const show=c.showLabel===true;
    const pos=c.labelPos||'top';
    html+=`<div class="grp"><div class="grp-h">라벨</div>
      <div class="prop"><label class="cbx"><input type="checkbox" ${show?'checked':''} onchange="upd('showLabel',this.checked)"> 라벨 표시</label></div>`;
    if(show){
      html+=`<div class="prop"><label>라벨 내용</label><input value="${(c.labelText||'').replace(/"/g,'&quot;')}" oninput="upd('labelText',this.value)" placeholder="예: 결제기간"></div>`;
      html+=`<div class="prop"><label>라벨 위치</label><div class="lp-grid">
        ${['top','left','right','bottom'].map(p=>`<button class="lp-btn${pos===p?' on':''}" onclick="upd('labelPos','${p}')">${({top:'위',left:'왼쪽',right:'오른쪽',bottom:'아래'})[p]}</button>`).join('')}
      </div></div>`;
    }
    html+=`</div>`;
  }
  if(['input','combo','date','daterange','popup'].includes(c.type)&&!(c.type==='daterange'&&fatMode))
    html+=`<div class="prop"><label class="cbx"><input type="checkbox" ${c.readonly?'checked':''} onchange="upd('readonly',this.checked)"> 읽기전용${c.type==='popup'?qh('첫 번째(코드) 텍스트박스에만 적용됩니다. 명칭 표시칸은 항상 읽기전용입니다.'):''}</label></div>`;
  if(c.type==='popup'){
    const popStyle=c.style==='code'?'code':'code_name';
    html+=`<div class="grp"><div class="grp-h">스타일${qh('<b>코드/명</b>은 코드 입력칸 옆에 명칭 표시칸까지 함께 둡니다(기본값). <b>코드</b>를 고르면 명칭 표시칸 없이 코드 입력칸만 남습니다.')}</div>
      <div class="prop"><label class="cbx"><input type="radio" name="popStyle${c.id}" ${popStyle==='code_name'?'checked':''} onchange="upd('style','code_name')"> 코드/명</label></div>
      <div class="prop"><label class="cbx"><input type="radio" name="popStyle${c.id}" ${popStyle==='code'?'checked':''} onchange="upd('style','code')"> 코드</label></div>
    </div>`;
  }
  if(c.type==='button')
    html+=`<div class="prop"><label class="cbx"><input type="checkbox" ${c.ghost?'checked':''} onchange="upd('ghost',this.checked)"> 아웃라인 스타일</label></div>`;
  if(c.type==='combo'){
    html+=itemListEditor(c,'options','옵션',qh('＋ 옵션 추가 버튼으로 항목을 추가하고, 각 칸에 옵션명을 입력합니다. 드래그로 순서를 바꾸거나 ×로 삭제할 수 있습니다.<br><br>내보내기 결과물에서 클릭 시 실제 목록이 펼쳐지고 항목을 선택할 수 있습니다.'),'옵션');
  }
  if(c.type==='radio'){
    const ropts=(c.options||'').split(',').map(s=>s.trim()).filter(Boolean);
    html+=itemListEditor(c,'options','옵션',qh('＋ 옵션 추가 버튼으로 항목을 추가하고, 각 칸에 옵션명을 입력합니다. 드래그로 순서를 바꾸거나 ×로 삭제할 수 있습니다.<br><br>내보내기 결과물에서 클릭하면 그룹 내에서 하나만 선택되도록 동작합니다.<br><br>비워두면 이전처럼 단일 라디오로 표시됩니다.'),'옵션');
    if(ropts.length){
      const rsel=c.selected||0;
      const ropts_html=ropts.map((n,i)=>`<option value="${i}"${i===rsel?' selected':''}>${esc(n)||'(이름없음)'}</option>`).join('');
      html+=`<div class="prop"><label>기본 선택</label><select onchange="upd('selected',+this.value)">${ropts_html}</select></div>`;
    }
  }
  if(c.type==='grid'){
    html+=`<div class="prop"><label>표시 행 수</label><input type="number" value="${c.rows||3}" min="0" max="20" oninput="upd('rows',+this.value)"></div>`;
    if(!fatMode){
      html+=`<div class="prop"><label>그리드 제목</label><input value="${(c.gtitle||'').replace(/"/g,'&quot;')}" oninput="upd('gtitle',this.value)"></div>`;
    }
    html+=`<div class="grp"><div class="grp-h">컬럼 폭 방식${qh('<b>자동</b>: 각 컬럼 폭이 글자가 잘리지 않는 가장 작은 크기로 자동 조절되고, 컬럼명을 바꾸면 실시간으로 다시 맞춰집니다. 전체 폭이 넘칠 때만 가로 스크롤이 나타납니다.<br><br><b>수동</b>: 모든 컬럼이 아래 슬라이더로 지정한 폭으로 고정되고, 전체 폭이 그리드보다 넓어지면 가로 스크롤바가 나타납니다.<br><br><b>고정</b>: 컬럼 폭이 그리드 너비에 맞춰 균등하게 나눠집니다(스크롤 없음).<br><br>세 방식 모두 그리드에서 컬럼 경계선을 직접 드래그해 폭을 자유롭게 바꿀 수 있습니다.')}</div>
      <div class="prop"><label class="cbx"><input type="radio" name="colSizeMode${c.id}" ${gridSizeMode(c)==='auto'?'checked':''} onchange="updGridSizeMode('auto')"> 자동</label></div>
      <div class="prop"><label class="cbx"><input type="radio" name="colSizeMode${c.id}" ${gridSizeMode(c)==='scroll'?'checked':''} onchange="updGridSizeMode('scroll')"> 수동</label></div>
      <div class="prop"><label class="cbx"><input type="radio" name="colSizeMode${c.id}" ${gridSizeMode(c)==='default'?'checked':''} onchange="updGridSizeMode('default')"> 고정</label></div>
    </div>`;
    if(gridSizeMode(c)==='scroll'){
      html+=`<div class="prop"><label>컬럼 폭 (${Math.max(60,+c.colMinW||120)}px)</label>
        <input type="range" min="60" max="300" step="10" value="${Math.max(60,+c.colMinW||120)}" oninput="updGridColMinW(+this.value)"></div>`;
    }
    if(!fatMode){
      html+=`<div class="prop"><label class="cbx"><input type="checkbox" ${c.pagination?'checked':''} onchange="upd('pagination',this.checked)"> Pagination 사용${qh('그리드 하단에 페이지 이동 UI(페이지 번호·Show rows·Go to·전체 건수)를 표시합니다.<br><br>목업이므로 실제 페이지 이동은 되지 않고 항상 1페이지만 표시되며, 건수는 <b>표시 행 수</b> 값을 그대로 보여줍니다.<br><br>씬모드 전용 기능으로, 팻모드에서는 이 옵션과 하단 UI가 표시되지 않습니다.')}</label></div>`;
      html+=`<div class="prop"><label class="cbx"><input type="checkbox" ${c.rowOrderCol!==false?'checked':''} onchange="upd('rowOrderCol',this.checked)"> Row Order 사용${qh('그리드 맨 왼쪽에 순번 컬럼을 추가합니다.<br><br>헤더에는 설정·필터·고정 아이콘이 표시되고, 데이터 행에는 <b>표시 행 수</b> 만큼 1부터 차례대로 번호가 매겨집니다.<br><br>씬모드 전용 기능으로, 팻모드에서는 표시되지 않습니다.')}</label></div>`;
      html+=`<div class="prop"><label class="cbx"><input type="checkbox" ${c.checkboxCol!==false?'checked':''} onchange="upd('checkboxCol',this.checked)"> CheckBox 사용${qh('그리드 왼쪽(Row Order 다음)에 행 선택용 체크박스 컬럼을 추가합니다.<br><br>헤더와 <b>표시 행 수</b> 만큼의 각 데이터 행에 체크박스가 표시됩니다.<br><br>씬모드 전용 기능으로, 팻모드에서는 표시되지 않습니다.')}</label></div>`;
    }
    const gcols=(c.text||'').split(',').map(s=>s.trim());
    const groupCollapsed=gcolGroupCollapsed.has(String(c.id));
    html+=`<div class="grp"><div class="grp-h gcol-grp-h">
      <span>컬럼 (${gcols.length})${qh('조회조건 필드처럼 드래그로 순서를 바꾸거나, ×로 삭제할 수 있습니다.<br><br>유형을 텍스트박스·콤보박스·날짜·체크박스·첨부파일·검색 중 하나로 지정하면 내보내기 결과물에서 해당 컴포넌트처럼 동작합니다 (콤보는 클릭 시 목록 펼침, 체크박스는 클릭 시 체크, 첨부파일은 업로드 아이콘 표시, 검색은 조회조건의 검색 필드처럼 입력칸 우측에 돋보기 표시).<br><br>정렬 아이콘(≡)으로 헤더 텍스트의 좌/가운데/우 정렬을 고를 수 있고, <b>*</b>(필수)를 켜면 헤더 라벨 앞에 빨간 *가 붙고 데이터 행이 크림색으로, <b>🔒</b>(읽기전용)을 켜면 데이터 행이 회색으로 표시됩니다 (헤더 색은 바뀌지 않습니다).<br><br>각 컬럼의 <b>상위헤더</b> 칸에 같은 이름을 연속으로 입력하면 그 컬럼들이 헤더에서 하나로 병합되어 표시됩니다 (예: 기준정보 아래 품목·품목명).')}</span>
      <button class="gcol-grp-toggle" title="컬럼 목록 펼치기/접기" onclick="toggleGcolGroup('${c.id}')">${groupCollapsed?'펼치기 ▸':'접기 ▾'}</button>
    </div>`;
    if(!groupCollapsed){
      html+=`<div class="sfield-list">`;
      gcols.forEach((colName,gi)=>{
        const ctype=(c.colTypes&&c.colTypes[gi])||'input';
        const calign=(c.colAligns&&c.colAligns[gi])||'left';
        const creq=!!(c.colRequired&&c.colRequired[gi]);
        const cro=!!(c.colReadonly&&c.colReadonly[gi]);
        html+=`<div class="sfield-row" draggable="true"
          ondragstart="gcDragStart(event,${gi})" ondragover="gcDragOver(event)"
          ondragleave="gcDragLeave(event)" ondrop="gcDrop(event,${gi})" ondragend="gcDragEnd(event)">
          <div class="sf-row1">
            <span class="sf-handle" title="드래그해서 순서 변경">⠿</span>
            <input type="number" class="sf-pos" title="순서 번호 (직접 입력하면 그 위치로 이동)" min="1" max="${gcols.length}" value="${gi+1}" onchange="gcMoveTo(${gi},this.value)">
            <input class="sf-label" value="${colName.replace(/"/g,'&quot;')}" oninput="updGridColLabel(${gi},this.value)" placeholder="컬럼명">
            <select class="sf-type gcol-type" onchange="updGridColType(${gi},this.value)">
              <option value="input"${ctype==='input'?' selected':''}>텍스트박스</option>
              <option value="combo"${ctype==='combo'?' selected':''}>콤보박스</option>
              <option value="date"${ctype==='date'?' selected':''}>날짜</option>
              <option value="check"${ctype==='check'?' selected':''}>체크박스</option>
              <option value="file"${ctype==='file'?' selected':''}>첨부파일</option>
              <option value="search"${ctype==='search'?' selected':''}>검색</option>
            </select>
            ${ctype==='date'?`<button class="sf-datebtn" title="컬럼 기본값 날짜 선택 (현재: ${(c.colDateBlank&&c.colDateBlank[gi])?'빈값':escAttr(qdResolvedText((c.colDateVals&&c.colDateVals[gi])||'',(c.colDateSpec&&c.colDateSpec[gi])||'')||todayStr())})" onclick="openQuickDateGridCol(this,${gi})">📅</button>`:''}
            <button class="ubtn-del" title="삭제" onclick="delGridCol(${gi})">×</button>
          </div>`;
        {
          const cgroup=(c.colGroups&&c.colGroups[gi])||'';
          html+=`<div class="sf-row2">
            <input class="grp-input" value="${cgroup.replace(/"/g,'&quot;')}" oninput="updGridColGroup(${gi},this.value)" placeholder="상위헤더(그룹명)">
            <div class="align-seg" title="헤더 텍스트 정렬">
              <button type="button" class="align-btn${calign==='left'?' on':''}" title="왼쪽 정렬" onclick="updGridColAlign(${gi},'left')"><span class="align-ic l"><i></i><i></i><i></i></span></button>
              <button type="button" class="align-btn${calign==='center'?' on':''}" title="가운데 정렬" onclick="updGridColAlign(${gi},'center')"><span class="align-ic c"><i></i><i></i><i></i></span></button>
              <button type="button" class="align-btn${calign==='right'?' on':''}" title="오른쪽 정렬" onclick="updGridColAlign(${gi},'right')"><span class="align-ic r"><i></i><i></i><i></i></span></button>
            </div>
            <button class="sf-req${creq?' on':''}" title="필수 (헤더에 * 표시 + 데이터 행을 크림색으로)" onclick="updGridColRequired(${gi},${!creq})">*</button>
            <button class="sf-ro${cro?' on':''}" title="읽기전용 (데이터 행을 회색으로 표시)" onclick="updGridColReadonly(${gi},${!cro})">🔒</button>
          </div>`;
        }
        if(ctype==='combo'){
          const copts=(c.colOptions&&c.colOptions[gi])||'';
          html+=`<div class="sfield-opts"><input value="${copts.replace(/"/g,'&quot;')}" oninput="updGridColOptions(${gi},this.value)" placeholder="옵션 (쉼표 구분) 예: 옵션1,옵션2"></div>`;
        }
        html+=`</div>`;
      });
      html+=`</div><button class="ubtn-add" onclick="addGridCol()">＋ 컬럼 추가</button>`;
    }
    html+=`</div>`;
    if(!fatMode){
      html+=`<div class="grp"><div class="grp-h">그리드 툴바</div>`;
      html+=`<div class="prop"><label class="cbx"><input type="checkbox" ${c.showToolbar!==false?'checked':''} onchange="upd('showToolbar',this.checked)"> 툴바 표시</label></div>`;
      html+=`<div class="prop"><label style="margin-bottom:5px;">기본 버튼</label>
        <label class="cbx" style="margin-bottom:3px;"><input type="checkbox" ${c.stdAdd?'checked':''} onchange="upd('stdAdd',this.checked)"> 행추가</label>
        <label class="cbx" style="margin-bottom:3px;"><input type="checkbox" ${c.stdCancel?'checked':''} onchange="upd('stdCancel',this.checked)"> 행취소</label>
        <label class="cbx" style="margin-bottom:3px;"><input type="checkbox" ${c.stdCopy?'checked':''} onchange="upd('stdCopy',this.checked)"> 행복사</label>
        <label class="cbx"><input type="checkbox" ${c.stdDelete?'checked':''} onchange="upd('stdDelete',this.checked)"> 행삭제</label></div>`;
      // user buttons editor
      html+=`<div class="prop"><label>사용자 버튼</label><div class="ubtn-list">`;
      (c.userBtns||[]).forEach((b,i)=>{
        const label=typeof b==='string'?b:b.label;
        const disabled=(typeof b==='object'&&b.disabled)||false;
        html+=`<div class="ubtn-row">
          <input value="${(label||'').replace(/"/g,'&quot;')}" oninput="updUserBtn(${i},'label',this.value)" placeholder="버튼명">
          <button class="ubtn-tgl${disabled?' on':''}" title="비활성 표시" onclick="updUserBtn(${i},'disabled',${!disabled})">비활성</button>
          <button class="ubtn-del" title="삭제" onclick="delUserBtn(${i})">×</button>
        </div>`;
      });
      html+=`</div><button class="ubtn-add" onclick="addUserBtn()">＋ 사용자 버튼 추가</button></div>`;
      html+=`</div>`;
    }
  }
  if(c.type==='tree'){
    const tnodes=parseTree(c.text||'');
    const sel0=c.selectedLine||0;
    const opts=tnodes.map(n=>`<option value="${n.i}"${n.i===sel0?' selected':''}>${esc('  '.repeat(n.depth)+n.label)}</option>`).join('');
    html+=`<div class="prop"><label>선택된 항목 (강조 표시)</label><select onchange="upd('selectedLine',+this.value)">${opts||'<option>(항목 없음)</option>'}</select></div>`;
    html+=`<div class="prop"><label class="cbx"><input type="checkbox" ${c.showLines!==false?'checked':''} onchange="upd('showLines',this.checked)"> 계층 연결선 표시</label></div>`;
  }
  if(c.type==='chart'){
    html+=`<div class="prop"><label>차트 제목</label><input value="${(c.ctitle||'').replace(/"/g,'&quot;')}" oninput="upd('ctitle',this.value)"></div>`;
    html+=`<div class="prop"><label>차트 종류</label><select onchange="upd('chartType',this.value)">
      <option value="bar"${c.chartType==='bar'?' selected':''}>막대형</option>
      <option value="line"${c.chartType==='line'?' selected':''}>꺾은선형</option>
      <option value="area"${c.chartType==='area'?' selected':''}>영역형</option>
      <option value="donut"${c.chartType==='donut'?' selected':''}>도넛형</option>
    </select></div>`;
    html+=`<div class="prop"><label>색상 팔레트</label><select onchange="upd('color',this.value)">
      <option value="green"${c.color==='green'?' selected':''}>그린</option>
      <option value="blue"${c.color==='blue'?' selected':''}>블루</option>
      <option value="yellow"${c.color==='yellow'?' selected':''}>옐로우</option>
      <option value="mixed"${c.color==='mixed'?' selected':''}>혼합(도넛용)</option>
    </select></div>`;
    html+=`<div class="prop"><label>데이터 값 (쉼표 구분)</label><input value="${(c.text||'').replace(/"/g,'&quot;')}" oninput="upd('text',this.value)" placeholder="예: 25,45,30,60"></div>`;
    html+=`<div class="prop"><label class="cbx"><input type="checkbox" ${c.showArrow!==false?'checked':''} onchange="upd('showArrow',this.checked)"> 제목 화살표(›) 표시</label></div>`;
  }
  if(c.type==='split'){
    const pos=Math.round((c.pos!=null?c.pos:0.5)*100);
    html+=`<div class="prop"><label>분할 방향</label><select onchange="upd('dir',this.value)">
      <option value="h"${(c.dir||'h')==='h'?' selected':''}>좌우 분할</option>
      <option value="v"${c.dir==='v'?' selected':''}>상하 분할</option>
    </select></div>`;
    html+=`<div class="prop"><label>분할 위치 (${pos}%)${qh('캔버스에서 두 영역 사이의 <b>경계선을 마우스로 끌어도</b> 크기를 조절할 수 있습니다.<br><br>각 영역에 그리드 등을 끌어놓으면 영역 크기에 맞춰 자동으로 채워지고, 경계선을 옮기면 그 크기도 함께 조절됩니다.')}</label>
      <input type="range" min="15" max="85" value="${pos}" oninput="upd('pos',this.value/100)"></div>`;

  }
  if(c.type==='searchbar'){
    html+=`<div class="prop"><label class="cbx"><input type="checkbox" ${c.collapsed?'checked':''} onchange="upd('collapsed',this.checked)"> 접힘 상태(≫) 표시</label></div>`;
    html+=`<div class="grp"><div class="grp-h">조회 조건 필드${qh('타입을 <b>빈값</b>으로 지정하면 라벨·입력칸 없이 해당 칸을 <b>비워둔 채</b> 그대로 자리만 차지합니다.<br><br>여러 칸짜리 레이아웃에서 특정 칸만 건너뛰고 싶을 때 사용하세요.<br><br>가로 폭을 <b>½칸</b>으로 지정하면, 바로 다음(또는 바로 앞) 필드도 ½칸일 때 두 필드가 한 칸을 <b>반반씩 나눠서</b> 표시됩니다(요청조직/구매조직처럼). 옆에 ½칸이 붙어있지 않으면 그 필드 혼자 한 칸의 <b>절반만</b> 채우고 나머지 절반은 비워둡니다.<br><br>타입이 <b>날짜</b>·<b>기간</b>이면 라벨 옆에 📅 아이콘이 나타나며, 클릭하면 뜨는 팝업에서 화면에 보여줄 날짜를 고를 수 있습니다(오늘/어제 등 원클릭 또는 연·월·일 조합). 비워두면 기본값(오늘 날짜)이 표시됩니다.')}</div><div class="sfield-list">`;
    (c.fields||[]).forEach((f,i)=>{
      html+=`<div class="sfield-row" draggable="true"
        ondragstart="sfDragStart(event,${i})" ondragover="sfDragOver(event)"
        ondragleave="sfDragLeave(event)" ondrop="sfDrop(event,${i})" ondragend="sfDragEnd(event)">
        <div class="sf-row1">
          <span class="sf-handle" title="드래그해서 순서 변경">⠿</span>
          <input type="number" class="sf-pos" title="순서 번호 (직접 입력하면 그 위치로 이동)" min="1" max="${(c.fields||[]).length}" value="${i+1}" onchange="sfMoveTo(${i},this.value)">
          <input class="sf-label" value="${(f.label||'').replace(/"/g,'&quot;')}" oninput="updSearchField(${i},'label',this.value)" placeholder="라벨"${f.type==='empty'?' disabled style="opacity:.5;"':''}>
          ${f.type==='date'?`<button class="sf-datebtn" title="빠른 날짜 선택 (현재: ${f.blank?'빈값':sfDateCurrent(f,'single')})" onclick="openQuickDate(this,${i},'single')">📅</button>`:''}
          ${f.type==='daterange'?`<button class="sf-datebtn" title="시작일 빠른 선택 (현재: ${f.startBlank?'빈값':sfDateCurrent(f,'start')})" onclick="openQuickDate(this,${i},'start')">📅</button><span class="sf-tilde">~</span><button class="sf-datebtn" title="종료일 빠른 선택 (현재: ${f.endBlank?'빈값':sfDateCurrent(f,'end')})" onclick="openQuickDate(this,${i},'end')">📅</button>`:''}
          <button class="ubtn-del" title="삭제" onclick="delSearchField(${i})">×</button>
        </div>
        <div class="sf-row2">
          <select class="sf-type" onchange="updSearchField(${i},'type',this.value)">
            <option value="text"${f.type==='text'?' selected':''}>텍스트</option>
            <option value="combo"${f.type==='combo'?' selected':''}>콤보</option>
            <option value="date"${f.type==='date'?' selected':''}>날짜</option>
            <option value="daterange"${f.type==='daterange'?' selected':''}>기간</option>
            <option value="search"${f.type==='search'?' selected':''}>검색</option>
            <option value="radio"${f.type==='radio'?' selected':''}>라디오</option>
            <option value="empty"${f.type==='empty'?' selected':''}>빈값</option>
          </select>
          <select class="sf-span" title="가로 폭 (전체 4칸 중 몇 칸을 차지할지). ½칸은 바로 옆에 다른 ½칸이 붙으면 한 칸을 반씩 나눠 쓰고, 혼자면 한 칸의 절반만 채웁니다." onchange="updSearchField(${i},'span',+this.value)">
            <option value="0.5"${f.span===0.5?' selected':''}>½칸</option>
            <option value="1"${(f.span||1)===1?' selected':''}>1칸</option>
            <option value="2"${f.span===2?' selected':''}>2칸</option>
            <option value="3"${f.span===3?' selected':''}>3칸</option>
            <option value="4"${f.span===4?' selected':''}>4칸(전체)</option>
          </select>
          ${f.type==='empty'?'':`<button class="sf-req${f.required?' on':''}" title="필수" onclick="updSearchField(${i},'required',${!f.required})">*</button>
          <button class="sf-ro${f.readonly?' on':''}" title="읽기전용 (회색 표시)" onclick="updSearchField(${i},'readonly',${!f.readonly})">🔒</button>`}
        </div>
      </div>`;
      if(f.type==='radio'||f.type==='combo'){
        const optDefault=f.type==='combo'?'전체,선택1,선택2':'전체,확정,미확정';
        html+=`<div class="sfield-opts"><input value="${(f.options||optDefault).replace(/"/g,'&quot;')}" oninput="updSearchField(${i},'options',this.value)" placeholder="옵션 (쉼표 구분)"></div>`;
      }
    });
    html+=`</div><button class="ubtn-add" onclick="addSearchField()">＋ 조건 필드 추가</button></div>`;
  }
  if(c.type==='tabs'){
    html+=itemListEditor(c,'text','탭',qh('＋ 탭 추가 버튼으로 탭(페이지)을 추가하고, 각 칸에 탭 이름을 입력합니다. 드래그로 순서를 바꾸거나 ×로 삭제할 수 있습니다.'),'탭');
    const tnames=ilItems(c,'text');
    const tactive=c.active||0;
    const topts=tnames.map((n,i)=>`<option value="${i}"${i===tactive?' selected':''}>${esc(n)||'(이름없음)'}</option>`).join('');
    html+=`<div class="prop"><label>편집할 탭(페이지)${qh('도구상자의 컴포넌트를 캔버스로 끌어와 <b>탭 헤더 아래 콘텐츠 영역</b>(점선 표시)에 놓으면 여기서 선택한 탭 페이지에 배치됩니다.<br><br>캔버스에서 탭 헤더를 직접 클릭해도 편집할 탭을 전환할 수 있습니다.')}</label><select onchange="upd('active',+this.value)">${topts||'<option>(탭 없음)</option>'}</select></div>`;

  }
  html+=`<div class="prop"><label>정렬 (Z순서)</label><div class="zi-row"><button onclick="zorder('front')">맨 앞</button><button onclick="zorder('back')">맨 뒤</button></div></div>`;
  html+=`<button class="del-btn" onclick="delSel()">삭제 (Del)</button>`;
  html+=`<div class="grp possize-grp${posSizeExpanded?'':' collapsed'}" style="margin-top:12px;"><div class="grp-h gcol-grp-h">
      <span>위치 · 크기</span>
      <button class="gcol-grp-toggle" title="위치·크기 보기/숨기기" onclick="togglePosSize()">${posSizeExpanded?'숨기기 ▾':'보기 ▸'}</button>
    </div>${posSizeExpanded?posHtml:''}</div>`;
  html+=`<div class="hint">Tip: 컴포넌트를 드래그해 이동, 모서리 핸들로 크기 조절. Del 키로 삭제.</div>`;
  p.innerHTML=html;
}
// ---- Generic item-list editor (탭 이름 / 콤보·라디오 옵션) ----
// tabs/combo/radio 는 항목을 콤마 문자열 하나(c.text 또는 c.options)로 저장한다.
// 렌더링·내보내기는 그대로 두고, 속성 패널만 그리드 컬럼/조회조건 필드처럼
// "＋ 추가" 버튼 + 개별 입력칸 + 드래그 정렬 + × 삭제 방식으로 바꾼다.
function ilItems(c,prop){
  const raw=c[prop]||'';
  // 빈 문자열(''.split(',')==['']))이면 항목 0개, 그 외에는 각 칸을 그대로 유지한다.
  // 예전에는 .filter(Boolean)으로 빈 이름 칸을 통째로 걸러냈는데, 그러면 탭/옵션 이름을
  // 전부 지운 순간(빈 문자열이 되는 순간) 그 칸이 배열에서 사라지면서 캔버스의 탭이 즉시
  // 없어지고, 이후 칸들의 인덱스(tabIdx 등)까지 밀려버렸다. 이름이 비어 있어도 칸 자체는
  // 그대로 유지해야 사용자가 다시 입력을 마칠 때까지 탭이 사라지지 않는다.
  if(raw==='') return [];
  return raw.split(',').map(s=>s.trim());
}
function itemListEditor(c,prop,itemLabel,tip,ph){
  const items=ilItems(c,prop);
  let h=`<div class="grp"><div class="grp-h">
    <span>${itemLabel} (${items.length})${tip||''}</span></div>`;
  h+=`<div class="sfield-list">`;
  items.forEach((name,i)=>{
    h+=`<div class="sfield-row" draggable="true"
      ondragstart="ilDragStart(event,${i})" ondragover="ilDragOver(event)"
      ondragleave="ilDragLeave(event)" ondrop="ilDrop(event,'${prop}',${i})" ondragend="ilDragEnd(event)">
      <div class="sf-row1">
        <span class="sf-handle" title="드래그해서 순서 변경">⠿</span>
        <input class="sf-label" value="${name.replace(/"/g,'&quot;')}" oninput="ilUpd('${prop}',${i},this.value)" placeholder="${ph||itemLabel}명">
        <button class="ubtn-del" title="삭제" onclick="ilDel('${prop}',${i})">×</button>
      </div>
    </div>`;
  });
  h+=`</div><button class="ubtn-add" onclick="ilAdd('${prop}','${ph||itemLabel}')">＋ ${itemLabel} 추가</button></div>`;
  return h;
}
// tabs 는 active, radio 는 selected 인덱스를 항목 수 범위 안으로 보정한다.
function ilClampIdx(c){
  const nText=ilItems(c,'text').length;
  const nOpts=ilItems(c,'options').length;
  if(c.type==='tabs'&&c.active!=null) c.active=Math.max(0,Math.min(c.active,Math.max(0,nText-1)));
  if(c.type==='radio'&&c.selected!=null) c.selected=Math.max(0,Math.min(c.selected,Math.max(0,nOpts-1)));
}
function ilAdd(prop,ph){
  const c=comps.find(x=>x.id===sel);if(!c)return;
  pushHistory();
  const items=ilItems(c,prop);
  items.push((ph||'항목')+(items.length+1));
  c[prop]=items.join(',');
  ilClampIdx(c);
  render();
}
function ilUpd(prop,i,v){
  const c=comps.find(x=>x.id===sel);if(!c)return;
  const items=ilItems(c,prop);if(i<0||i>=items.length)return;
  items[i]=v;
  c[prop]=items.join(',');
  drawCanvas();
}
function ilDel(prop,i){
  const c=comps.find(x=>x.id===sel);if(!c)return;
  const items=ilItems(c,prop);if(i<0||i>=items.length)return;
  pushHistory();
  // 탭을 삭제하면 그 탭 페이지(tabIdx===i)에 들어있던 자식 컴포넌트들도 함께 삭제하고,
  // 뒤쪽 탭(tabIdx>i)에 있던 자식들은 인덱스를 한 칸씩 당겨 원래 탭에 그대로 남게 한다.
  // comps 전체가 pushHistory 로 스냅샷되므로 Ctrl+Z 한 번이면 탭과 자식 전부 복구된다.
  if(c.type==='tabs'){
    const removeIds=collectWithChildren(
      comps.filter(k=>k.parent===c.id&&(k.tabIdx||0)===i).map(k=>k.id)
    );
    const removeSet=new Set(removeIds);
    comps=comps.filter(k=>!removeSet.has(k.id));
    comps.forEach(k=>{ if(k.parent===c.id&&(k.tabIdx||0)>i) k.tabIdx=(k.tabIdx||0)-1; });
    if(selIds.size){ const kept=[...selIds].filter(id=>!removeSet.has(id)); selIds=new Set(kept); if(!selIds.has(sel)) sel=c.id, selIds.add(c.id); }
  }
  items.splice(i,1);
  c[prop]=items.join(',');
  ilClampIdx(c);
  render();
}
let ilDragIdx=null;
function ilDragStart(e,i){
  ilDragIdx=i;
  e.dataTransfer.effectAllowed='move';
  e.dataTransfer.setData('text/plain',String(i));
  e.currentTarget.classList.add('dragging');
}
function ilDragOver(e){ e.preventDefault(); e.dataTransfer.dropEffect='move'; e.currentTarget.classList.add('drag-over'); }
function ilDragLeave(e){ e.currentTarget.classList.remove('drag-over'); }
function ilDrop(e,prop,i){
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  const c=comps.find(x=>x.id===sel);if(!c)return;
  const from=ilDragIdx; ilDragIdx=null;
  if(from===null||from===i)return;
  pushHistory();
  const items=ilItems(c,prop);
  const [item]=items.splice(from,1);
  const insertAt=from<i?i-1:i;
  items.splice(insertAt,0,item);
  c[prop]=items.join(',');
  // 탭 순서를 바꾸면 각 탭의 자식 컴포넌트(tabIdx)도 함께 따라가야 한다.
  // 이전 인덱스 → 새 인덱스 매핑을 만들어 자식들의 tabIdx 를 재배치한다.
  if(c.type==='tabs'){
    // 이전 인덱스 → 새 인덱스 매핑 재현 (items 는 이미 이동 반영된 상태이므로 length=원본 개수)
    const N=items.length;
    const src=[];for(let k=0;k<N;k++)src.push(k);
    const moved=src.splice(from,1)[0];
    src.splice(insertAt,0,moved);
    // src[newIdx] = oldIdx  →  oldIdx 를 newIdx 로 매핑
    const remap={};src.forEach((oldIdx,newIdx)=>{remap[oldIdx]=newIdx;});
    comps.forEach(k=>{ if(k.parent===c.id){ const o=k.tabIdx||0; if(remap[o]!=null) k.tabIdx=remap[o]; } });
    if(c.active!=null&&remap[c.active]!=null) c.active=remap[c.active];
  }
  render();
}
function ilDragEnd(e){
  e.currentTarget.classList.remove('dragging');
  document.querySelectorAll('.sfield-row.drag-over').forEach(el=>el.classList.remove('drag-over'));
  ilDragIdx=null;
}
const STACKED_EXTRA=22; // label line height added when the label sits above/below
const LABEL_SIDE_W=76;  // width reserved for a label placed to the left/right
function upd(k,v){
  const c=comps.find(x=>x.id===sel);if(!c)return;
  if(k==='labelPos'&&LABELED_TYPES.includes(c.type)&&c.showLabel===true){
    const wasStacked=(c.labelPos||'top')==='top'||(c.labelPos||'top')==='bottom';
    const willStack=(v==='top'||v==='bottom');
    if(wasStacked&&!willStack){ c.h=Math.max(26,c.h-STACKED_EXTRA); c.w=c.w+LABEL_SIDE_W; }
    else if(!wasStacked&&willStack){ c.h=c.h+STACKED_EXTRA; c.w=Math.max(80,c.w-LABEL_SIDE_W); }
  }
  if(k==='showLabel'&&LABELED_TYPES.includes(c.type)){
    const stacked=(c.labelPos||'top')==='top'||(c.labelPos||'top')==='bottom';
    if(stacked){ c.h = v ? c.h+STACKED_EXTRA : Math.max(26,c.h-STACKED_EXTRA); }
  }
  c[k]=v;
  if(k==='w'&&c.type==='grid'){ c._sizeModeManual=false; } // resizing is a fresh chance to re-suggest
  if(k==='collapsed'&&c.type==='searchbar'){
    // collapsed shows only a one-line notice; expanding restores the fitted height
    c.h = v ? 44 : searchbarHeight(c);
  }
  if(k==='style'&&c.type==='popup'){
    // 명칭칸(.ax-popup-name)이 빠지는 만큼만 정확히 줄이기 위해, 아직 이전 렌더링이 남아있는
    // 실제 DOM에서 명칭칸의 화면 폭을 재서 뺀다(라벨 유무·위치에 따라 비율 계산이 달라지는 문제를 피함).
    const GAP=4;
    if(v==='code'){
      if(c._popupFullW==null) c._popupFullW=c.w;
      const nameEl=document.querySelector('.cmp.selected .ax-popup-name');
      if(nameEl && nameEl.offsetWidth>0){
        // 캔버스는 CSS transform:scale()로 확대/축소되므로 offsetWidth는 이미 확대 이전(캔버스 단위) 값이다.
        c.w=Math.max(60, Math.round(c._popupFullW - nameEl.offsetWidth - GAP));
      } else {
        // 측정 실패 시 대략적인 비율로 대체(코드칸1 : 아이콘22px : 명칭칸1.6, gap 4px)
        const availFlex=Math.max(0,c._popupFullW-22-GAP*2);
        c.w=Math.max(60,Math.round(availFlex*(1/2.6)+GAP+22));
      }
    } else if(v==='code_name'){
      if(c._popupFullW!=null){ c.w=c._popupFullW; delete c._popupFullW; }
    }
  }
  if(k==='showLabel'||k==='labelPos'||k==='collapsed'||k==='xscroll'||k==='style'){render();}else{drawCanvas();}
}
// 팻모드 기간(daterange) 속성 패널의 "날짜1"/"날짜2" 입력칸 - 두 값을 합쳐서 기존 text
// 형식("YYYY-MM-DD ~ YYYY-MM-DD")으로 저장한다. idx는 0(날짜1) 또는 1(날짜2).
function updDateRangePart(idx,v){
  const c=comps.find(x=>x.id===sel); if(!c)return;
  const parts=(c.text||'').split('~').map(s=>s.trim());
  parts[idx]=v;
  upd('text',(parts[0]||'')+' ~ '+(parts[1]||''));
}
// 팻모드 기간(daterange) 날짜1/날짜2 스타일(없음·필수·읽기전용). idx 0=날짜1, 1=날짜2.
// 필수와 읽기전용은 상호배타이며 기본값은 "없음"이다.
function updDrStyle(idx,style){
  const c=comps.find(x=>x.id===sel); if(!c)return;
  const rq=idx===0?'required':'required2';
  const ro=idx===0?'readonly':'readonly2';
  pushHistory();
  c[rq]=(style==='required');
  c[ro]=(style==='readonly');
  render();
}
function setActiveTab(id,idx){
  const c=comps.find(x=>x.id===id);
  if(!c)return;
  c.active=idx;
  const selComp=comps.find(x=>x.id===sel);
  if(selComp&&selComp.parent===id&&(selComp.tabIdx||0)!==idx) selectSingle(id);
  render();
}

// ---- Grid user-button editors ----
function normUserBtns(c){
  c.userBtns=(c.userBtns||[]).map(b=>typeof b==='string'?{label:b,disabled:false}:b);
  return c.userBtns;
}
function addUserBtn(){
  const c=comps.find(x=>x.id===sel);if(!c)return;
  pushHistory();
  normUserBtns(c).push({label:'새 버튼',disabled:false});
  render();
}
function updUserBtn(i,k,v){
  const c=comps.find(x=>x.id===sel);if(!c)return;
  const arr=normUserBtns(c);if(!arr[i])return;
  arr[i][k]=v;
  if(k==='disabled')render(); else drawCanvas();
}
function delUserBtn(i){
  const c=comps.find(x=>x.id===sel);if(!c)return;
  pushHistory();
  normUserBtns(c).splice(i,1);
  render();
}

// ---- Grid column editors (mirrors the searchbar field editor's UX) ----
// Tracks which grids have their whole "컬럼" list collapsed (key: compId as string).
let gcolGroupCollapsed=new Set();
function toggleGcolGroup(cid){
  if(gcolGroupCollapsed.has(cid))gcolGroupCollapsed.delete(cid); else gcolGroupCollapsed.add(cid);
  renderProps();
  if(window.mbSyncProps)try{window.mbSyncProps();}catch(e){}
}
// 위치·크기(X/Y/너비/높이) 그룹은 기본 숨김. "보기"를 누르면 펼친다.
let posSizeExpanded=false;
function togglePosSize(){
  posSizeExpanded=!posSizeExpanded;
  renderProps();
  if(window.mbSyncProps)try{window.mbSyncProps();}catch(e){}
}
function gridColsArr(c){
  return (c.text||'').split(',').map(s=>s.trim());
}
// 그리드 컬럼 폭 방식(고정/수동/자동)의 실제 적용값. colSizeMode가 아직 없는 그리드는(레거시
// 목업 포함) 예전 xscroll 값이 있으면 그걸 따르고(수동), 그마저 없으면 새 기본값인 자동으로 본다.
function gridSizeMode(c){ return c.colSizeMode || (c.xscroll ? 'scroll' : 'auto'); }
// Keeps colTypes/colOptions the SAME length as the column list at all times. This matters because
// a sparse array (shorter than cols) makes Array.splice's insert index silently clamp to the array's
// current length when reordering, which can drop a type/option onto the wrong (unrelated) column.
function normGridColArrays(c){
  const n=gridColsArr(c).length;
  if(!Array.isArray(c.colTypes))c.colTypes=[];
  while(c.colTypes.length<n)c.colTypes.push('input');
  if(c.colTypes.length>n)c.colTypes.length=n;
  if(!Array.isArray(c.colOptions))c.colOptions=[];
  while(c.colOptions.length<n)c.colOptions.push('');
  if(c.colOptions.length>n)c.colOptions.length=n;
  if(!Array.isArray(c.colGroups))c.colGroups=[];
  while(c.colGroups.length<n)c.colGroups.push('');
  if(c.colGroups.length>n)c.colGroups.length=n;
  if(!Array.isArray(c.colAligns))c.colAligns=[];
  while(c.colAligns.length<n)c.colAligns.push('left');
  if(c.colAligns.length>n)c.colAligns.length=n;
  if(!Array.isArray(c.colRequired))c.colRequired=[];
  while(c.colRequired.length<n)c.colRequired.push(false);
  if(c.colRequired.length>n)c.colRequired.length=n;
  if(!Array.isArray(c.colReadonly))c.colReadonly=[];
  while(c.colReadonly.length<n)c.colReadonly.push(false);
  if(c.colReadonly.length>n)c.colReadonly.length=n;
  if(!Array.isArray(c.colDateVals))c.colDateVals=[];
  while(c.colDateVals.length<n)c.colDateVals.push('');
  if(c.colDateVals.length>n)c.colDateVals.length=n;
  if(!Array.isArray(c.colDateBlank))c.colDateBlank=[];
  while(c.colDateBlank.length<n)c.colDateBlank.push(false);
  if(c.colDateBlank.length>n)c.colDateBlank.length=n;
  if(!Array.isArray(c.colDateSpec))c.colDateSpec=[];
  while(c.colDateSpec.length<n)c.colDateSpec.push('');
  if(c.colDateSpec.length>n)c.colDateSpec.length=n;
  // 컬럼별 수동 폭(드래그로 조절한 값) - 다른 컬럼별 배열과 같은 길이로 맞춰야 컬럼 추가/삭제/
  // 순서변경 시 엉뚱한 컬럼의 폭이 섞이지 않는다. 기본값은 "덮어쓰기 없음"을 뜻하는 undefined.
  if(!Array.isArray(c.colWidths))c.colWidths=[];
  while(c.colWidths.length<n)c.colWidths.push(undefined);
  if(c.colWidths.length>n)c.colWidths.length=n;
}
function addGridCol(){
  const c=comps.find(x=>x.id===sel);if(!c)return;
  pushHistory();
  normGridColArrays(c);
  const cols=gridColsArr(c);
  cols.push('컬럼'+(cols.length+1));
  c.text=cols.join(',');
  c.colTypes.push('input');
  c.colOptions.push('');
  c.colGroups.push('');
  c.colAligns.push('left');
  c.colRequired.push(false);
  c.colReadonly.push(false);
  c.colDateVals.push('');
  c.colDateBlank.push(false);
  c.colDateSpec.push('');
  c.colWidths.push(undefined);
  render();
}
function updGridColLabel(i,v){
  const c=comps.find(x=>x.id===sel);if(!c)return;
  const cols=gridColsArr(c);if(i<0||i>=cols.length)return;
  cols[i]=v;
  c.text=cols.join(',');
  // 자동 폭 모드에서는 컬럼명이 바뀌면 드래그로 조절해둔 그 컬럼의 폭은 더 이상 의미가 없으므로
  // 지워서, 새 이름 길이에 맞춰 실시간으로 다시 자동 계산되도록 한다.
  const sizeMode=gridSizeMode(c);
  if(sizeMode==='auto'&&Array.isArray(c.colWidths)) c.colWidths[i]=undefined;
  drawCanvas();
}
// 그리드 컬럼 폭 방식(고정/수동/자동) 라디오 버튼 핸들러. 사람이 명시적으로 고른 값이므로
// _sizeModeManual을 켜서, 컬럼이 안 맞아 자동으로 스크롤 모드를 제안하는 로직이 이 선택을
// 다시 덮어쓰지 않게 한다. 드래그로 개별 조절해둔 컬럼 폭(colWidths)은 방식이 바뀌면 의미가
// 없어지므로 - 예를 들어 자동으로 바꿨는데 예전에 수동으로 넓혀둔 컬럼만 그 폭 그대로 남으면
// "자동으로 맞췄다"는 말과 안 맞다 - 전부 지워서 모든 컬럼이 새 방식 기준으로 다시 계산되게 한다.
function updGridSizeMode(mode){
  const c=comps.find(x=>x.id===sel);if(!c)return;
  c.colSizeMode=mode;
  c._sizeModeManual=true;
  c.colWidths=[];
  render();
}
// 스크롤 모드의 "컬럼 폭" 슬라이더 - 개별 드래그로 조절해둔 컬럼 폭(colWidths)이 있어도
// 슬라이더를 움직이면 전부 무시하고 모든 컬럼에 새 값을 균일하게 다시 적용한다.
function updGridColMinW(v){
  const c=comps.find(x=>x.id===sel);if(!c)return;
  c.colMinW=v;
  c.colWidths=[];
  drawCanvas();
}
function delGridCol(i){
  const c=comps.find(x=>x.id===sel);if(!c)return;
  const cols=gridColsArr(c);if(i<0||i>=cols.length)return;
  pushHistory();
  normGridColArrays(c);
  cols.splice(i,1);
  c.text=cols.join(',');
  c.colTypes.splice(i,1);
  c.colOptions.splice(i,1);
  c.colGroups.splice(i,1);
  c.colAligns.splice(i,1);
  c.colRequired.splice(i,1);
  c.colReadonly.splice(i,1);
  c.colDateVals.splice(i,1);
  c.colDateBlank.splice(i,1);
  c.colDateSpec.splice(i,1);
  c.colWidths.splice(i,1);
  render();
}
function updGridColType(i,v){
  const c=comps.find(x=>x.id===sel);if(!c)return;
  normGridColArrays(c);
  if(i>=c.colTypes.length)return;
  c.colTypes[i]=v;
  // 새로 "날짜" 타입이 됐는데 아직 기본값이 없으면 오늘 날짜로 채운다(다시 열 때마다 재계산되도록
  // "오늘" spec도 같이 붙여둔다).
  if(v==='date' && !(c.colDateVals[i]||'').trim()){
    c.colDateVals[i]=todayStr();
    c.colDateSpec[i]='chip:today';
  }
  render();
}
function updGridColOptions(i,v){
  const c=comps.find(x=>x.id===sel);if(!c)return;
  normGridColArrays(c);
  if(i>=c.colOptions.length)return;
  c.colOptions[i]=v;
  drawCanvas();
}
// Sets/clears the merged-header group label for column i. Consecutive columns that share the
// exact same (trimmed) label render as one spanning cell above their individual names - see
// the 'grid' case in innerRaw(). An empty label removes the column from any group.
function updGridColGroup(i,v){
  const c=comps.find(x=>x.id===sel);if(!c)return;
  normGridColArrays(c);
  if(i>=c.colGroups.length)return;
  c.colGroups[i]=v;
  drawCanvas();
}
// 헤더 텍스트 정렬(left/center/right). 어느 아이콘이 눌려있는지 즉시 반영해야 하므로
// (다른 토글 버튼들처럼) 속성 패널을 다시 그린다.
function updGridColAlign(i,v){
  const c=comps.find(x=>x.id===sel);if(!c)return;
  normGridColArrays(c);
  if(i>=c.colAligns.length)return;
  c.colAligns[i]=v;
  render();
}
// 필수 - 헤더 라벨 앞에 빨간 "*"를 붙이고(헤더 색은 그대로), 데이터 행 배경을 크림색으로 표시한다.
function updGridColRequired(i,v){
  const c=comps.find(x=>x.id===sel);if(!c)return;
  normGridColArrays(c);
  if(i>=c.colRequired.length)return;
  c.colRequired[i]=v;
  render();
}
// 읽기전용 - 헤더 색은 그대로 두고, 데이터 행 배경을 회색으로 표시하며 데이터 셀 입력을 잠근다.
function updGridColReadonly(i,v){
  const c=comps.find(x=>x.id===sel);if(!c)return;
  normGridColArrays(c);
  if(i>=c.colReadonly.length)return;
  c.colReadonly[i]=v;
  render();
}
// Drag-and-drop reorder: drag a column row's handle and drop it on another row.
let gcDragIdx=null;
function gcDragStart(e,i){
  gcDragIdx=i;
  e.dataTransfer.effectAllowed='move';
  e.dataTransfer.setData('text/plain',String(i));
  e.currentTarget.classList.add('dragging');
  startDragAutoScroll();
}
function gcDragOver(e){
  e.preventDefault();
  e.dataTransfer.dropEffect='move';
  e.currentTarget.classList.add('drag-over');
  updateDragScrollY(e);
}
function gcDragLeave(e){
  e.currentTarget.classList.remove('drag-over');
}
// 컬럼 순서 변경의 실제 배열 이동 로직 - 컬럼 텍스트와 그에 딸린 모든 배열(타입/옵션/그룹/정렬/
// 필수/읽기전용/개별폭)을 같은 인덱스로 함께 옮긴다. gcDrop(드래그앤드롭)·gcMoveTo(순서번호 직접
// 입력)·startColReorder(그리드 헤더 자체 드래그) 세 진입점이 모두 이 함수 하나를 공유한다.
// to는 이동 후 최종 위치(0-based)를 그대로 받는다 - 호출부에서 이미 from<to 시프트를 보정해서 넘긴다.
function moveGridColumn(c,from,to){
  normGridColArrays(c);
  const len=gridColsArr(c).length;
  to=Math.max(0,Math.min(len-1,to));
  if(to===from||from<0||from>=len)return false;
  const cols=gridColsArr(c);
  const move=arr=>{const [x]=arr.splice(from,1);arr.splice(to,0,x);};
  move(cols);c.text=cols.join(',');
  move(c.colTypes);move(c.colOptions);move(c.colGroups);move(c.colAligns);move(c.colRequired);move(c.colReadonly);move(c.colWidths);
  return true;
}
function gcDrop(e,i){
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  const c=comps.find(x=>x.id===sel);if(!c)return;
  const from=gcDragIdx; gcDragIdx=null;
  if(from===null||from===i)return;
  pushHistory();
  const insertAt=from<i?i-1:i;
  moveGridColumn(c,from,insertAt);
  render();
}
function gcDragEnd(e){
  e.currentTarget.classList.remove('dragging');
  document.querySelectorAll('.sfield-row.drag-over').forEach(el=>el.classList.remove('drag-over'));
  gcDragIdx=null;
  stopDragAutoScroll();
}
// 순서 번호 직접 입력: N을 입력하면 그 자리로 이동하고 나머지는 한 칸씩 밀린다(1부터 시작).
function gcMoveTo(i,valStr){
  const c=comps.find(x=>x.id===sel);if(!c)return;
  normGridColArrays(c);
  const len=gridColsArr(c).length;
  const v=parseInt(valStr,10);
  if(!Number.isFinite(v)){render();return;}
  const to=Math.max(1,Math.min(len,v))-1;
  if(to===i){render();return;}
  pushHistory();
  moveGridColumn(c,i,to);
  render();
}

// ---- Search-bar field editors ----
// Height of a searchbar is driven by how many rows of fields it needs (4 per row).
// Keeps the panel from clipping a new row, and from leaving a gap when rows shrink.
const SB_COLS=4, SB_ROW_H=52, SB_ROW_GAP=12, SB_PAD=28, SB_MIN_H=84;
// Simulates the CSS grid's row-wrapping (grid-auto-flow: row) so the auto-height estimate
// stays accurate even when some fields span 2-4 of the 4 columns at once.
function searchbarRowCount(fields){
  let col=0, rows=1;
  sbLayoutCells(fields).forEach(cell=>{
    const span=cell.kind==='field'?cell.units:1; // halfpair/halfsolo always occupy exactly 1 column
    if(col+span>SB_COLS){ rows++; col=0; }
    col+=span;
  });
  return rows;
}
function searchbarHeight(c){
  const rows=Math.max(1,searchbarRowCount(c.fields||[]));
  return Math.max(SB_MIN_H, SB_PAD + rows*SB_ROW_H + (rows-1)*SB_ROW_GAP);
}
function fitSearchbar(c){
  if(!c||c.type!=='searchbar'||c.collapsed)return;
  c.h=searchbarHeight(c);
}
function addSearchField(){
  const c=comps.find(x=>x.id===sel);if(!c)return;
  pushHistory();
  if(!c.fields)c.fields=[];
  c.fields.push({label:'조건',type:'text',required:false});
  fitSearchbar(c);
  render();
}
function updSearchField(i,k,v){
  const c=comps.find(x=>x.id===sel);if(!c||!c.fields||!c.fields[i])return;
  c.fields[i][k]=v;
  // 타입을 날짜·기간으로 바꿨는데 아직 값이 없으면(신규 필드 등) 기본값을 오늘 날짜로 채운다(다시
  // 열 때마다 재계산되도록 "오늘" spec도 같이 붙여둔다).
  if(k==='type' && (v==='date'||v==='daterange') && !(c.fields[i].text||'').trim()){
    c.fields[i].text = v==='daterange' ? (todayStr()+'~'+todayStr()) : todayStr();
    if(v==='daterange'){ c.fields[i].startSpec='chip:today'; c.fields[i].endSpec='chip:today'; }
    else c.fields[i].dateSpec='chip:today';
  }
  if(k==='span'){ fitSearchbar(c); render(); return; }
  if(k==='required'||k==='type'||k==='readonly')render(); else drawCanvas();
}
// ---- 조회조건 날짜·기간 필드: 빠른 날짜 선택 팝업(qdPopup) ----
// 아이콘(📅)을 누르면 해당 아이콘 바로 아래에 뜨는 고정(fixed) 위치 팝업으로, 즐겨찾는 값(오늘/어제/
// 이번달1일/올해1월1일)을 원클릭으로 쓰거나, "직접 조합하기"에서 연도·월·일 축을 조합해 상대 날짜를
// 만들 수 있다. qd는 팝업이 열려 있는 동안의 임시 상태(어떤 필드의 어느 값을 고르는 중인지)를 담는다.
let qd=null; // {kind:'field'|'component'|'gridcol', compId, fi, part:'single'|'start'|'end', current, chip, year, month, day, expanded, anchorRect}
function qdToday(){ const d=new Date(); d.setHours(0,0,0,0); return d; }
function qdFmt(d){ const p=n=>String(n).padStart(2,'0'); return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()); }
// spec 문자열(즐겨찾기 칩 이름, 또는 "직접 조합하기" 연/월/일 축 조합)을 "지금 이 순간의 오늘"을
// 기준으로 다시 계산해 "YYYY-MM-DD" 문자열로 돌려준다. spec이 없거나 알아볼 수 없으면 null.
// 내보내기 결과물(저장되는 mockup html)의 인터랙션 스크립트 안에도 이와 똑같은 로직이 그대로
// 복제돼 있다(buildExportHTML 안의 resolveSpec) - 그래야 그 파일을 나중에 다른 날 열어도 "어제"가
// 그 날짜 기준 어제로 다시 계산되어 표시된다. 두 로직은 항상 같이 맞춰야 한다.
function qdResolveSpec(spec){
  if(!spec) return null;
  if(spec.indexOf('chip:')===0){
    const mode=spec.slice(5);
    if(['today','yesterday','thisMonth1','thisYear0101'].indexOf(mode)===-1) return null;
    return qdFmt(qdComputeChip(mode));
  }
  if(spec.indexOf('axis:')===0){
    const nums=spec.slice(5).split(',').map(Number);
    if(nums.length!==3 || nums.some(isNaN)) return null;
    const d=qdToday();
    d.setFullYear(d.getFullYear()+nums[0]);
    d.setMonth(d.getMonth()+nums[1]);
    d.setDate(d.getDate()+nums[2]);
    return qdFmt(d);
  }
  return null;
}
// 저장된 원문 텍스트와 spec을 함께 받아, spec이 유효하면 "오늘" 기준으로 새로 계산한 값을 우선 쓰고,
// 없으면(빈값 spec, 또는 예전에 만들어져 spec 없이 고정 문자열만 있는 값) 저장된 텍스트를 그대로 쓴다.
function qdResolvedText(text,spec){
  return qdResolveSpec(spec) || (text||'').trim();
}
// 필드에 이미 저장돼 있는 값(단일 날짜, 또는 기간의 시작/종료 한쪽)을 문자열로 돌려준다. spec이 있으면
// 오늘 기준으로 다시 계산하고, 없으면(비어있거나 옛 고정값) 저장된 텍스트 또는 오늘을 쓴다.
function sfDateCurrent(f,part){
  if(part==='single') return qdResolvedText(f.text,f.dateSpec)||todayStr();
  const parts=(f.text||'').split('~').map(s=>s.trim());
  return part==='start' ? (qdResolvedText(parts[0],f.startSpec)||todayStr()) : (qdResolvedText(parts[1],f.endSpec)||todayStr());
}
// 해당 part가 지금 "빈값"으로 저장돼 있는지(사용자가 명시적으로 비워둔 상태인지) 읽는다.
function sfDateBlank(obj,part){
  if(part==='single') return !!obj.blank;
  return part==='start' ? !!obj.startBlank : !!obj.endBlank;
}
function qdComputeAxis(){
  const d=qdToday();
  d.setFullYear(d.getFullYear()+qd.year);
  d.setMonth(d.getMonth()+qd.month);
  d.setDate(d.getDate()+qd.day);
  return d;
}
function qdComputeChip(mode){
  const t=qdToday();
  if(mode==='yesterday'){ const d=new Date(t); d.setDate(d.getDate()-1); return d; }
  if(mode==='thisMonth1') return new Date(t.getFullYear(), t.getMonth(), 1);
  if(mode==='thisYear0101') return new Date(t.getFullYear(), 0, 1);
  return t; // 'today'
}
// 저장된 값이 즐겨찾기 칩(오늘/어제/이번달1일/올해1월1일) 중 하나와 정확히 같으면 그 칩 이름을 돌려준다.
// 팝업을 다시 열었을 때 "지금 뭐가 선택돼 있는지" 칩이 초록색으로 바로 보이게 하기 위함.
function qdMatchChip(dateStr){
  const cands=['today','yesterday','thisMonth1','thisYear0101'];
  for(const mode of cands){ if(qdFmt(qdComputeChip(mode))===dateStr) return mode; }
  return null;
}
// 칩과 일치하지 않는 값이라면, "직접 조합하기" 축(연도×월×일)의 모든 조합을 대입해봐서 정확히 같은
// 값을 만드는 조합을 찾는다. 찾으면 팝업을 다시 열었을 때 그 조합 그대로 펼쳐서 보여줄 수 있다.
function qdMatchAxis(dateStr){
  for(const year of [-1,0,1]){
    for(const month of [-1,0,1]){
      for(const day of [-7,-1,0,1]){
        const d=qdToday();
        d.setFullYear(d.getFullYear()+year);
        d.setMonth(d.getMonth()+month);
        d.setDate(d.getDate()+day);
        if(qdFmt(d)===dateStr) return {year,month,day};
      }
    }
  }
  return null;
}
function qdPreviewDate(){
  if(!qd) return qdToday();
  if(qd.chip) return qdComputeChip(qd.chip);
  if(qd.expanded) return qdComputeAxis();
  // 칩·축 중 아무것도 선택/일치하지 않았다면(예: 가져오기 등으로 들어온 값) 필드에 이미 저장된 값을 그대로 보여준다.
  const d=new Date((qd.current||todayStr())+'T00:00:00');
  return isNaN(d.getTime()) ? qdToday() : d;
}
// 하단 미리보기 칸에 실제로 표시할 문구. "빈값" 토글이 켜져 있으면 날짜 대신 그 사실을 보여준다.
function qdPreviewLabel(){
  if(qd && qd.blank) return '빈값 (선택 안 함)';
  return qdFmt(qdPreviewDate());
}
// qd 상태를 한 곳에서 조립한다. kind로 어떤 대상(조회조건 필드/단일 컴포넌트/그리드 컬럼)인지 구분하고,
// fi는 kind에 따라 필드 인덱스 또는 그리드 컬럼 인덱스로 재사용한다(단일 컴포넌트는 null).
function qdBuildState(kind,compId,fi,part,current,blankFlag){
  const chipMatch=qdMatchChip(current);
  const axisMatch=chipMatch?null:qdMatchAxis(current);
  return {kind, compId, fi, part, current, chip:chipMatch,
    year:axisMatch?axisMatch.year:0, month:axisMatch?axisMatch.month:0, day:axisMatch?axisMatch.day:0,
    expanded:!!axisMatch, blank:!!blankFlag};
}
// 조회조건 패널의 날짜·기간 필드용 (기존).
function openQuickDate(btn,fi,part){
  const c=comps.find(x=>x.id===sel); if(!c||!c.fields||!c.fields[fi])return;
  const f=c.fields[fi];
  const current=sfDateCurrent(f,part);
  qd=qdBuildState('field', c.id, fi, part, current, sfDateBlank(f,part));
  renderQuickDate(btn);
}
// 캔버스에 단독으로 놓인 날짜·기간 입력 컴포넌트용 - 속성 패널의 값(텍스트)이 읽기전용으로 바뀌고
// 이 팝업으로만 값을 바꿀 수 있다.
function openQuickDateComp(btn,compId,part){
  const c=comps.find(x=>x.id===compId); if(!c)return;
  const current=sfDateCurrent(c,part);
  qd=qdBuildState('component', compId, null, part, current, sfDateBlank(c,part));
  renderQuickDate(btn);
}
// 그리드 컬럼이 "날짜" 타입일 때, 디자인 화면/내보내기에 보일 기본 날짜 값을 정하는 팝업.
function openQuickDateGridCol(btn,ci){
  const c=comps.find(x=>x.id===sel); if(!c)return;
  normGridColArrays(c);
  const current=qdResolvedText(c.colDateVals[ci], c.colDateSpec[ci])||todayStr();
  qd=qdBuildState('gridcol', c.id, ci, 'single', current, !!(c.colDateBlank&&c.colDateBlank[ci]));
  renderQuickDate(btn);
}
function qdOutsideClick(e){
  const el=document.getElementById('qdPopup');
  if(el && !el.contains(e.target) && e.target.closest('.sf-datebtn')===null) closeQuickDate();
}
function closeQuickDate(){
  const el=document.getElementById('qdPopup');
  if(el) el.remove();
  qd=null;
  document.removeEventListener('mousedown', qdOutsideClick, true);
}
function qdSelectChip(mode){
  if(!qd)return;
  qd.chip=mode; qd.expanded=false; qd.blank=false;
  renderQuickDate();
}
function qdSelectAxis(axis,val){
  if(!qd)return;
  qd[axis]=val; qd.expanded=true; qd.chip=null; qd.blank=false;
  renderQuickDate();
}
function qdToggleExpand(){
  if(!qd)return;
  qd.expanded=!qd.expanded;
  renderQuickDate();
}
// "빈값" 칩: 오늘/어제 등과 동일하게 원클릭으로 고르는 선택지 중 하나. 고르면 날짜를 아예 선택하지
// 않고 비워두는 상태가 되어 미리보기가 "빈값"으로 바뀌고, 이후 다른 칩·축을 고르면 그쪽으로 다시 바뀐다.
function qdSelectBlank(){
  if(!qd)return;
  qd.blank=true; qd.chip=null; qd.expanded=false;
  renderQuickDate();
}
// part가 'single'이면 val을 그대로, 'start'/'end'면 기존 텍스트를 '~'로 나눠 해당 절반만 바꿔 합친다.
function qdMergeText(existingText,part,val){
  if(part==='single') return val;
  const parts=(existingText||'').split('~').map(s=>s.trim());
  let v1=parts[0]||todayStr(), v2=parts[1]||todayStr();
  if(part==='start')v1=val; else v2=val;
  return v1+'~'+v2;
}
// part에 맞는 blank 플래그(blank / startBlank / endBlank)를 obj에 기록한다. obj는 조회조건 필드
// 객체(f)이거나 단독 컴포넌트 객체(c) - 둘 다 같은 방식으로 쓴다.
function qdSetBlankFlag(obj,part,isBlank){
  if(part==='single') obj.blank=isBlank;
  else if(part==='start') obj.startBlank=isBlank;
  else obj.endBlank=isBlank;
}
// part에 맞는 spec 필드명(dateSpec / startSpec / endSpec)을 obj에 기록한다. spec이 없으면(빈값을
// 골랐거나, 즐겨찾기 칩·직접조합 축 어느 것과도 안 맞는 임의의 값이면) 아예 필드를 지워서 예전처럼
// 고정 문자열(text)만 쓰는 값으로 남긴다.
function qdSetSpecFlag(obj,part,spec){
  const key = part==='single' ? 'dateSpec' : (part==='start' ? 'startSpec' : 'endSpec');
  if(spec) obj[key]=spec; else delete obj[key];
}
// 지금 qd 상태가 즐겨찾기 칩이나 "직접 조합하기" 축과 정확히 일치하면 그 selection을 나중에 다시
// 계산할 수 있는 spec 문자열로 인코딩해 돌려준다. 빈값이거나(qd.blank) 어느 쪽과도 안 맞는 임의의
// 값이면 null - 이 경우 예전처럼 그 순간에 계산된 고정 날짜 문자열로만 저장된다.
function qdCurrentSpec(){
  if(!qd || qd.blank) return null;
  if(qd.chip) return 'chip:'+qd.chip;
  if(qd.expanded) return 'axis:'+qd.year+','+qd.month+','+qd.day;
  return null;
}
function qdApply(){
  if(!qd)return;
  const isBlank=!!qd.blank;
  const val=isBlank?'':qdFmt(qdPreviewDate());
  const spec=qdCurrentSpec();
  pushHistory();
  if(qd.kind==='component'){
    const c=comps.find(x=>x.id===qd.compId); if(!c){closeQuickDate();return;}
    c.text=qdMergeText(c.text, qd.part, val);
    qdSetBlankFlag(c, qd.part, isBlank);
    qdSetSpecFlag(c, qd.part, spec);
  }else if(qd.kind==='gridcol'){
    const c=comps.find(x=>x.id===qd.compId); if(!c){closeQuickDate();return;}
    normGridColArrays(c);
    c.colDateVals[qd.fi]=val;
    c.colDateBlank[qd.fi]=isBlank;
    c.colDateSpec[qd.fi]=spec||'';
  }else{
    const c=comps.find(x=>x.id===qd.compId); if(!c||!c.fields||!c.fields[qd.fi]){closeQuickDate();return;}
    const f=c.fields[qd.fi];
    f.text=qdMergeText(f.text, qd.part, val);
    qdSetBlankFlag(f, qd.part, isBlank);
    qdSetSpecFlag(f, qd.part, spec);
  }
  closeQuickDate();
  render();
}
function renderQuickDate(anchorBtn){
  if(!qd)return;
  let el=document.getElementById('qdPopup');
  if(!el){
    el=document.createElement('div');
    el.id='qdPopup';
    el.className='qd-popup';
    document.body.appendChild(el);
    document.addEventListener('mousedown', qdOutsideClick, true);
  }
  const title = qd.kind==='gridcol'
    ? '컬럼 기본값 날짜 선택'
    : (qd.part==='end' ? '종료일 빠른 선택' : (qd.part==='start' ? '시작일 빠른 선택' : '날짜 빠른 선택'));
  const chip=(mode,label)=>`<button class="qd-chip${(!qd.expanded&&!qd.blank&&qd.chip===mode)?' sel':''}" onclick="qdSelectChip('${mode}')">${label}</button>`;
  const seg=(axis,val,label)=>`<button class="${(qd.expanded&&!qd.blank&&qd[axis]===val)?'sel':''}" onclick="qdSelectAxis('${axis}',${val})">${label}</button>`;
  el.innerHTML=`
    <div class="qd-title"><span>${title}</span><span class="qd-close" onclick="closeQuickDate()">×</span></div>
    <div class="qd-chips">
      ${chip('today','오늘')}${chip('yesterday','어제')}${chip('thisMonth1','이번달1일')}${chip('thisYear0101','올해1월1일')}
      <button class="qd-chip qd-chip-blank${qd.blank?' sel':''}" onclick="qdSelectBlank()">빈값</button>
    </div>
    <div class="qd-expand-toggle" onclick="qdToggleExpand()">${qd.expanded?'간단히 ▴':'직접 조합하기 ▾'}</div>
    ${qd.expanded?`
    <div class="qd-axis"><div class="qd-axis-label">연도</div><div class="qd-seg">${seg('year',-1,'작년')}${seg('year',0,'올해')}${seg('year',1,'내년')}</div></div>
    <div class="qd-axis"><div class="qd-axis-label">월</div><div class="qd-seg">${seg('month',-1,'전달')}${seg('month',0,'이번달')}${seg('month',1,'다음달')}</div></div>
    <div class="qd-axis"><div class="qd-axis-label">일</div><div class="qd-seg">${seg('day',-7,'-7일')}${seg('day',-1,'어제')}${seg('day',0,'오늘')}${seg('day',1,'내일')}</div></div>
    `:''}
    <div class="qd-actions"><span class="qd-preview">${qdPreviewLabel()}</span><button class="qd-btn" onclick="qdApply()">적용</button></div>
  `;
  if(anchorBtn) qd.anchorRect=anchorBtn.getBoundingClientRect();
  qdPosition(el);
}
// 팝업을 아이콘 바로 아래(기본)에 붙이되, 화면 오른쪽/아래 가장자리에 가까우면 왼쪽/위쪽으로 뒤집어
// 잘리지 않게 한다.
function qdPosition(el){
  if(!qd || !qd.anchorRect)return;
  const r=qd.anchorRect;
  const vw=window.innerWidth, vh=window.innerHeight;
  const pw=el.offsetWidth||236, ph=el.offsetHeight||300;
  let left=r.left, top=r.bottom+6;
  if(left+pw>vw-8) left=Math.max(8, vw-8-pw);
  if(top+ph>vh-8) top=Math.max(8, r.top-ph-6);
  el.style.left=left+'px';
  el.style.top=top+'px';
}
function delSearchField(i){
  const c=comps.find(x=>x.id===sel);if(!c||!c.fields)return;
  pushHistory();
  c.fields.splice(i,1);
  fitSearchbar(c);
  render();
}
// Drag-and-drop reorder: drag a field row's handle and drop it on another row.
let sfDragIdx=null;
function sfDragStart(e,i){
  sfDragIdx=i;
  e.dataTransfer.effectAllowed='move';
  e.dataTransfer.setData('text/plain',String(i));
  e.currentTarget.classList.add('dragging');
  startDragAutoScroll();
}
function sfDragOver(e){
  e.preventDefault();
  e.dataTransfer.dropEffect='move';
  e.currentTarget.classList.add('drag-over');
  updateDragScrollY(e);
}
function sfDragLeave(e){
  e.currentTarget.classList.remove('drag-over');
}
function sfDrop(e,i){
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  const c=comps.find(x=>x.id===sel);if(!c||!c.fields)return;
  const from=sfDragIdx; sfDragIdx=null;
  if(from===null||from===i)return;
  pushHistory();
  const [item]=c.fields.splice(from,1);
  const insertAt=from<i?i-1:i;
  c.fields.splice(insertAt,0,item);
  fitSearchbar(c);
  render();
}
function sfDragEnd(e){
  e.currentTarget.classList.remove('dragging');
  document.querySelectorAll('.sfield-row.drag-over').forEach(el=>el.classList.remove('drag-over'));
  sfDragIdx=null;
  stopDragAutoScroll();
}
// 순서 번호 직접 입력: N을 입력하면 그 자리로 이동하고 나머지는 한 칸씩 밀린다(1부터 시작).
function sfMoveTo(i,valStr){
  const c=comps.find(x=>x.id===sel);if(!c||!c.fields)return;
  const len=c.fields.length;
  const v=parseInt(valStr,10);
  if(!Number.isFinite(v)){render();return;}
  const to=Math.max(1,Math.min(len,v))-1;
  if(to===i){render();return;}
  pushHistory();
  const [item]=c.fields.splice(i,1);
  c.fields.splice(to,0,item);
  fitSearchbar(c);
  render();
}

// ---- 컬럼/필드 순서 변경: 드래그 중 자동 스크롤 ----
// 리스트가 속성 패널(#props) 안에서 세로 스크롤될 때, 드래그로 원하는 위치까지 끌고 가기 어려운
// 문제를 보완한다. dragover가 멈춰도(마우스가 가장자리에 정지) 계속 스크롤되도록 setInterval로
// 별도 타이머를 둔다.
let dragScrollY=null, dragScrollTimer=null;
function startDragAutoScroll(){
  if(dragScrollTimer)return;
  dragScrollTimer=setInterval(()=>{
    if(dragScrollY==null)return;
    const scroller=document.getElementById('props');
    if(!scroller)return;
    const rect=scroller.getBoundingClientRect();
    const margin=48, maxSpeed=16;
    let dy=0;
    if(dragScrollY<rect.top+margin) dy=-maxSpeed*(1-Math.max(0,dragScrollY-rect.top)/margin);
    else if(dragScrollY>rect.bottom-margin) dy=maxSpeed*(1-Math.max(0,rect.bottom-dragScrollY)/margin);
    if(dy)scroller.scrollTop+=dy;
  },30);
}
function stopDragAutoScroll(){
  if(dragScrollTimer){clearInterval(dragScrollTimer);dragScrollTimer=null;}
  dragScrollY=null;
}
function updateDragScrollY(e){dragScrollY=e.clientY;}

// property-edit history: snapshot on focus, commit on blur if changed
let propEditSnap=null;
document.getElementById('props').addEventListener('focusin',e=>{
  if(e.target.matches('input,textarea,select'))propEditSnap=snapshot();
});
document.getElementById('props').addEventListener('focusout',e=>{
  if(!propEditSnap)return;
  if(JSON.stringify(propEditSnap.comps)!==JSON.stringify(comps)){
    undoStack.push(propEditSnap);
    if(undoStack.length>HIST_MAX)undoStack.shift();
    redoStack=[]; updateHistBtns();
  }
  propEditSnap=null;
});
function syncPropFields(c){
  ['x','y','w','h'].forEach(k=>{
    const inp=document.querySelector('#props input[data-prop="'+k+'"]');
    if(inp&&document.activeElement!==inp)inp.value=c[k];
  });
}
function delSel(){
  if(!selIds.size)return;
  pushHistory();
  const toDelete=collectWithChildren([...selIds]);
  comps=comps.filter(x=>!toDelete.includes(x.id));
  selectSingle(null);render();
}
// expands a list of ids to also include all descendant children of any Tab containers in the list
function collectWithChildren(ids){
  const set=new Set(ids);
  let changed=true;
  while(changed){
    changed=false;
    comps.forEach(c=>{
      if(c.parent&&set.has(c.parent)&&!set.has(c.id)){ set.add(c.id); changed=true; }
    });
  }
  return [...set];
}
function zorder(d){const i=comps.findIndex(x=>x.id===sel);if(i<0)return;pushHistory();const[c]=comps.splice(i,1);d==='front'?comps.push(c):comps.unshift(c);render();}

// ---- Canvas controls ----
function toggleGrid(){canvas.classList.toggle('nogrid',!document.getElementById('gridChk').checked);}
function setCW(){const v=Math.max(400,parseInt(document.getElementById('cw').value)||1100);document.getElementById('cw').value=v;canvas.style.width=v+'px';applyZoom();}
function setCH(){const v=Math.max(300,parseInt(document.getElementById('ch').value)||700);document.getElementById('ch').value=v;canvas.style.height=v+'px';applyZoom();}

// ---- Canvas zoom ----
// The canvas is CSS-scaled. Mouse math must divide by `zoom` so that dragging
// stays aligned with the cursor at any zoom level.
let zoom=1;
const ZOOM_STEPS=[0.5,0.75,0.9,1,1.25,1.5,2];
function applyZoom(){
  const holder=document.querySelector('.canvas-holder');
  canvas.style.transform = zoom===1?'':'scale('+zoom+')';
  canvas.style.transformOrigin='top left';
  // keep the surrounding layout aware of the scaled footprint
  if(holder){
    const bw=parseInt(canvas.style.width)||canvas.offsetWidth||0;
    const bh=parseInt(canvas.style.height)||canvas.offsetHeight||0;
    holder.style.width = (zoom===1||!bw)?'':(bw*zoom)+'px';
    holder.style.height= (zoom===1||!bh)?'':(bh*zoom)+'px';
  }
  const sel=document.getElementById('zoomSel');
  if(sel){
    const match=[...sel.options].find(o=>Math.abs(+o.value-zoom)<0.001);
    if(match){ sel.value=match.value; }
    else {
      // show a custom value (e.g. from Ctrl+wheel) without losing the preset list
      let custom=sel.querySelector('option[data-custom]');
      if(!custom){ custom=document.createElement('option'); custom.setAttribute('data-custom','1'); sel.appendChild(custom); }
      custom.value=zoom; custom.textContent=Math.round(zoom*100)+'%'; sel.value=zoom;
    }
  }
}
function setZoom(z){
  zoom=Math.min(2,Math.max(0.25,z||1));
  applyZoom();
}
// Ctrl/⌘ + wheel zooms the canvas, like most design tools.
document.addEventListener('wheel',e=>{
  if(!(e.ctrlKey||e.metaKey))return;
  const holder=document.querySelector('.canvas-holder');
  if(!holder||!holder.contains(e.target))return;
  e.preventDefault();
  setZoom(zoom*(e.deltaY<0?1.1:1/1.1));
},{passive:false});
// A grid on the canvas only scrolls horizontally. Let a plain vertical wheel over a
// scrollable grid body scroll it left/right, so it's reachable with any mouse (no
// shift key or horizontal wheel needed). Shift+wheel and native horizontal wheels
// already produce deltaX and are respected too.
document.addEventListener('wheel',e=>{
  if(e.ctrlKey||e.metaKey)return; // that's a zoom gesture, handled above
  const gbody=e.target.closest && e.target.closest('.ax-grid .gbody.xscroll');
  if(!gbody)return;
  if(gbody.scrollWidth<=gbody.clientWidth)return; // nothing to scroll
  const delta = Math.abs(e.deltaX)>Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  if(!delta)return;
  const before=gbody.scrollLeft;
  gbody.scrollLeft += delta;
  // Only swallow the page/canvas scroll when we actually moved the grid, so that a
  // grid already at its edge doesn't trap the wheel.
  if(gbody.scrollLeft!==before) e.preventDefault();
},{passive:false});
function zoomStep(dir){
  const cur=zoom;
  if(dir>0){ const nx=ZOOM_STEPS.find(s=>s>cur+0.001); setZoom(nx||2); }
  else { const prev=[...ZOOM_STEPS].reverse().find(s=>s<cur-0.001); setZoom(prev||0.5); }
}

// ---- Canvas resize by dragging corner ----
(function(){
  const handle=document.getElementById('canvasResize');
  const holder=handle.parentElement;
  let cdrag=null;
  handle.addEventListener('mousedown',e=>{
    e.preventDefault();e.stopPropagation();
    cdrag={sx:e.clientX,sy:e.clientY,ow:canvas.offsetWidth,oh:canvas.offsetHeight};
    holder.classList.add('resizing');
  });
  document.addEventListener('mousemove',e=>{
    if(!cdrag)return;
    let w=cdrag.ow+(e.clientX-cdrag.sx)/zoom, h=cdrag.oh+(e.clientY-cdrag.sy)/zoom;
    if(document.getElementById('snapChk').checked){const s=parseInt(document.getElementById('snapSize').value)||10;w=Math.round(w/s)*s;h=Math.round(h/s)*s;}
    w=Math.max(400,w); h=Math.max(300,h);
    canvas.style.width=w+'px'; canvas.style.height=h+'px';
    applyZoom();
    document.getElementById('cw').value=w;
    document.getElementById('ch').value=h;
  });
  document.addEventListener('mouseup',()=>{if(cdrag){cdrag=null;holder.classList.remove('resizing');}});
})();

// ---- Property panel width resize by dragging the splitter ----
(function(){
  const split=document.getElementById('propsSplit');
  if(!split)return;
  const app=document.querySelector('.app');
  const MINW=180, MAXW=560, DEFW=324;
  const LS_KEY='mb_props_w';
  function setW(w){
    w=Math.max(MINW,Math.min(MAXW,Math.round(w)));
    app.style.setProperty('--props-w',w+'px');
    return w;
  }
  // 저장해둔 폭 복원
  try{ const s=parseInt(localStorage.getItem(LS_KEY)); if(s&&s>=MINW&&s<=MAXW) app.style.setProperty('--props-w',s+'px'); }catch(e){}
  let pdrag=null;
  split.addEventListener('mousedown',e=>{
    e.preventDefault();e.stopPropagation();
    const props=document.getElementById('props');
    pdrag={sx:e.clientX,ow:props.offsetWidth};
    split.classList.add('dragging');
    document.body.classList.add('props-resizing');
  });
  document.addEventListener('mousemove',e=>{
    if(!pdrag)return;
    // 패널은 오른쪽 고정 - 왼쪽으로 끌면(마우스 X 감소) 넓어진다.
    setW(pdrag.ow + (pdrag.sx - e.clientX));
  });
  document.addEventListener('mouseup',()=>{
    if(!pdrag)return;
    pdrag=null;
    split.classList.remove('dragging');
    document.body.classList.remove('props-resizing');
    try{ const cur=parseInt(getComputedStyle(app).getPropertyValue('--props-w')); if(cur) localStorage.setItem(LS_KEY,cur); }catch(e){}
  });
  // 더블클릭 시 기본 폭으로 초기화
  split.addEventListener('dblclick',()=>{
    setW(DEFW);
    try{ localStorage.setItem(LS_KEY,DEFW); }catch(e){}
  });
})();
// Keeps the canvas' actual width/height values untouched (e.g. stays 1100x700) and instead
// scales the ZOOM down so a fresh blank canvas fits the visible area without a scrollbar.
// Never zooms in past 100%. Runs at initial page load and on 전체 지우기 - not on window resize
// or other actions, so a zoom level the person picked manually isn't overridden mid-work.
function fitZoomToViewport(){
  const scrollEl=document.querySelector('.canvas-scroll');
  if(!scrollEl)return;
  const PAD=44; // canvas-scroll's 20px padding each side + a few px safety margin
  const availW=scrollEl.clientWidth-PAD;
  const availH=scrollEl.clientHeight-PAD;
  if(availW<=0||availH<=0)return;
  const cwv=parseInt(document.getElementById('cw').value)||1100;
  const chv=parseInt(document.getElementById('ch').value)||700;
  let fit=Math.min(availW/cwv, availH/chv, 1);
  // Round DOWN to the nearest 1% - rounding to the nearest (as before) could round UP past the
  // exact fit value and overflow by a fraction of a percent, just enough to show a faint scrollbar.
  fit=Math.max(0.25, Math.floor(fit*100)/100);
  setZoom(fit);
}
// 캔버스를 초기 상태(빈 화면·기본 크기·기본 설정)로 되돌린다. 전체지우기와, 로고 클릭에 의한
// 모드 전환 시 재사용된다.
function resetCanvasToDefault(){
  comps=defaultScreen();
  selectSingle(null);
  clearOriginTracking(); // 전체 초기화이므로 공유파일 파생 추적 값도 함께 지운다
  // reset canvas size to the built-in default
  document.getElementById('cw').value=1100; setCW();
  document.getElementById('ch').value=700; setCH();
  fitZoomToViewport();
  // reset view/snap settings to their defaults
  document.getElementById('snapChk').checked=true;
  document.getElementById('snapSize').value=10;
  document.getElementById('gridChk').checked=true;
  document.getElementById('smartChk').checked=true;
  toggleGrid();
  // clear undo/redo history since this is a full reset
  undoStack=[]; redoStack=[]; updateHistBtns();
  render();
}
function clearCanvas(){
  if(!comps.length)return;
  if(confirm('모든 컴포넌트와 캔버스 크기·설정을 초기 상태로 되돌릴까요?')){
    resetCanvasToDefault();
  }
}

// ---- Save / Load JSON ----
// Builds a yyyyMMdd_HHmm stamp from local time, appended to default file names
// so repeated saves don't overwrite each other.
function fileStamp(){
  const d=new Date(), p=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}
// The screen's own 화면 제목 component, used for both the exported page title and file names.
// Top-level titles win over ones nested inside tabs/splits (whose x/y are relative to their
// container, so they aren't comparable); within a group the topmost, then leftmost, is used.
function screenTitle(){
  const pick=list=>{
    const s=list.filter(c=>c.type==='title'&&(c.text||'').trim())
                .sort((a,b)=>(a.y-b.y)||(a.x-b.x));
    return s.length?s[0].text.trim():null;
  };
  return pick(comps.filter(c=>!c.parent)) || pick(comps) || '';
}
// Makes a title safe for a file name: strips characters Windows/macOS reject (\\ / : * ? " < > |),
// collapses whitespace to underscores, and trims trailing dots/spaces that Windows silently drops.
function safeName(s,fallback){
  let n=(s||'').replace(/[\\/:*?"<>|]/g,'_')   // illegal on Windows
                .replace(/[\x00-\x1f]/g,'')     // control chars
                .replace(/\s+/g,'_')            // spaces -> underscore
                .replace(/_+/g,'_')             // collapse repeats
                .replace(/^[_.]+|[_. ]+$/g,''); // no leading/trailing dots or underscores
  if(n.length>60) n=n.slice(0,60).replace(/_+$/,'');
  return n||fallback;
}
// Saves a blob. Where supported (Chrome/Edge over http/https) this opens a
// "Save as" dialog so the user picks the folder and file name; otherwise it falls
// back to a normal download. The picker is unavailable on file:// pages.
async function saveBlob(blob,filename,desc,mime,ext){
  if(window.showSaveFilePicker){
    try{
      const handle=await window.showSaveFilePicker({
        suggestedName:filename,
        types:[{description:desc,accept:{[mime]:[ext]}}]
      });
      const ws=await handle.createWritable();
      await ws.write(blob);
      await ws.close();
      return true;
    }catch(err){
      if(err&&err.name==='AbortError')return false; // user cancelled
      // Any other failure (e.g. blocked on file://) falls through to download.
    }
  }
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob); a.download=filename; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  return true;
}
// Clears the autosave snapshot. Called once work has been written to a real file,
// so reopening the tool starts clean instead of offering to restore.
function clearAutosave(){
  clearTimeout(autosaveTimer);
  try{ localStorage.removeItem(AUTOSAVE_KEY); }catch(e){}
  lastAutosave=Date.now();
  const el=document.getElementById('autosaveMark');
  if(el){ el.classList.remove('on'); el.textContent=''; }
}
function loadJSON(){document.getElementById('fileIn').click();}
function doLoad(e){
  const f=e.target.files[0];if(!f)return;
  const r=new FileReader();
  r.onload=()=>{
    // 실패 원인별로 다른 안내를 준다. 대부분은 "Mockup Builder로 만든 파일이 아님"이지만,
    // 프로그램 본체를 잘못 고른 경우와 파일이 손상된 경우는 대처가 달라 따로 알려준다.
    const isHtml=/\.html?$/i.test(f.name);
    try{
      let raw=r.result;
      if(isHtml){
        // 프로그램 본체(mockup_builder.html)를 실수로 고르는 경우가 흔하다. 본체 소스에는
        // 데이터 블록을 찾는 정규식 자체가 문자열로 들어 있어 아래 match 가 엉뚱하게 성공해
        // "데이터 손상"으로 오인될 수 있으므로, 데이터 블록을 찾기 전에 먼저 걸러낸다.
        if(/id="toolbox"/.test(raw) && /class="canvas-wrap"|id="canvas"/.test(raw)){
          throw new Error('이 파일은 Mockup Builder 프로그램 본체입니다.\n\n불러오기에는 「저장」으로 만든 화면 파일을 선택해 주세요.');
        }
        const m=raw.match(/<script type="application\/json" id="__mb_src__">([\s\S]*?)<\/script>/);
        if(!m){
          throw new Error('Mockup Builder로 저장한 파일이 아닙니다.\n\n「저장」 버튼으로 만든 HTML 파일만 불러올 수 있습니다.\n(구버전의 「HTML 내보내기」로 만든 파일에는 편집 데이터가 없어 열 수 없습니다)');
        }
        raw=m[1];
      }
      let d;
      try{ d=JSON.parse(raw); }
      catch(pe){
        // HTML 안에서 데이터 블록은 찾았는데 깨진 경우 = 저장 후 편집기로 건드린 파일일 가능성.
        if(isHtml) throw new Error('편집 데이터가 손상되어 읽을 수 없습니다.\n\n파일이 완전히 저장되지 않았거나, 저장 후 내용이 수정된 것 같습니다.');
        throw new Error('Mockup Builder로 저장한 파일이 아닙니다.\n\n「저장」 버튼으로 만든 HTML 파일을 선택해 주세요.');
      }
      if(!d||!Array.isArray(d.comps)){
        throw new Error('Mockup Builder로 저장한 파일이 아닙니다.\n\n화면 구성 정보를 찾을 수 없습니다.');
      }
      pushHistory();
      // 불러온 파일 자체에 원본 추적값(원본에서 파생된 화면을 로컬 저장할 때 함께 담아둔
      // originId)이 있으면 그대로 이어받고, 없으면(그런 흔적이 아예 없던 파일이거나 옛날
      // 파일) 지금 이어오던 추적을 끊는다 - 로컬을 한 번 거쳐도 클라우드 저장까지 자연스럽게
      // 이어지게 하기 위함.
      mbCloud.originId=d.originId||null;
      // 파일에 저장된 모드(skin) 정보로 팻/씬모드를 자동으로 맞춘다. 확인창이나 전체초기화 없이
      // 화면 톤만 바꾼다 - 지금 막 불러온 comps가 그 톤 기준으로 만들어졌기 때문.
      // skin 정보가 없는 구버전 파일은 항상 씬모드로 연다.
      setAppSkin(d.skin==='fat');
      comps=d.comps;
      uid=Math.max(0,...comps.map(c=>c.id))+1;
      if(d.cw){document.getElementById('cw').value=d.cw;setCW();}
      if(d.ch){document.getElementById('ch').value=d.ch;setCH();}
      selectSingle(null);render();
    }catch(err){alert(err.message);}
  };
  r.onerror=()=>{ alert('파일을 읽지 못했습니다.\n\n파일이 열려 있거나 접근 권한이 없는지 확인해 주세요.'); };
  r.readAsText(f);e.target.value='';
}

// ---- Export HTML ----
function exportHTML(){
  const t=screenTitle();
  const out=buildExportHTML();
  const b=new Blob([out],{type:'text/html'});
  saveBlob(b,`${safeName(t,'mockup_export')}_${fileStamp()}.html`,'HTML 파일','text/html','.html')
    .then(saved=>{ if(saved) clearAutosave(); });
}
// Opens the same interactive HTML the export produces in a new browser tab,
// so every component behaves exactly as it will in the saved file (tabs switch,
// combos open, checkboxes/radios toggle, tree collapses, split dividers drag).
function previewHTML(){
  const out=buildExportHTML();
  const b=new Blob([out],{type:'text/html'});
  const url=URL.createObjectURL(b);
  const w=window.open(url,'_blank');
  if(!w){
    // Popup blocked - fall back to a same-tab navigation via a temporary link.
    const a=document.createElement('a');
    a.href=url; a.target='_blank'; a.rel='noopener';
    document.body.appendChild(a); a.click(); a.remove();
  }
  // Release the object URL after the new tab has had time to load it.
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}
// index.html/style.css/app.js 세 파일로 나뉘기 전에는 style.css의 내용이 index.html 안에 <style> 태그로 그대로 들어있어서, document.querySelector('style').innerHTML로 앱 자신의 CSS를 그대로 읽어와 내보내기(저장)/미리보기 HTML에 그대로 복사해 넣을 수 있었다.
// 파일을 분리한 뒤로는 CSS가 <link rel="stylesheet" href="style.css">로 외부 파일에서 로드되는데, file://로 열었을 때는 브라우저가 (1) 그 외부 스타일시트의 cssRules를 보안상 못 읽게 막고(cross-origin 취급), (2) fetch/XHR로 옆에 있는 style.css를 직접 읽어오는 것도 막는다(file:// 특유의 제약). 그래서 이 두 방법 다 못 쓴다.
// 그 대신 style.css 전체 내용을 미리 base64로 인코딩해 아래 상수로 고정해두고, 내보내기/미리보기를 만들 때마다 이 상수를 그대로 디코딩해서 쓴다 - file:///http(s) 어떤 환경에서 열어도 항상 똑같이 동작한다.
// *** 주의: style.css 내용을 고치면 이 상수도 반드시 다시 생성해서 갱신해야 한다 (그렇지 않으면 내보내기/미리보기에는 예전 CSS가 실린다). ***
const MB_APP_CSS_B64='LyogPT09PT0gTW9ja3VwIEJ1aWxkZXIgLSDquLDrs7gg7Iqk7YOA7J28ID09PT09ICovCiAgOnJvb3R7CiAgICAtLWF4LWdyZWVuOiMxZTllNmE7IC0tYXgtZ3JlZW4tZGFyazojMTc4MDU1OyAtLWF4LWdyZWVuLWxpZ2h0OiNlOGY1ZWY7CiAgICAtLWF4LW5hdnk6IzJjM2U1MDsgLS1heC1ncmF5OiM2YjcyODA7IC0tYXgtYm9yZGVyOiNkOWRlZTM7CiAgICAtLWF4LWJnOiNmNGY2Zjg7IC0tYXgtZ3JpZC1oZWFkOiNmMGYyZjQ7IC0tYXgtZ3JpZC1oZWFkLWZnOiM0YjU1NjM7IC0tYXgtcmVxOiNlNTQ4NGQ7CiAgICAtLWF4LXBhbmVsOiNmZmZmZmY7IC0tc2VsOiMyNjgwZWI7CiAgICAtLWF4LXJlYWRvbmx5LWJnOiNmNmY3Zjg7IC0tYXgtcmVxdWlyZWQtYmc6I2ZmZmZmZjsKICAgIC0tYXgtY2FudmFzLWJnOiNmZmZmZmY7IC0tYXgtbGFiZWwtZmc6IzM3NDE1MTsKICAgIC0tYXgtZ3JpZC1saW5lOiNmM2Y1Zjc7CiAgICAvKiDqt7jrpqzrk5wg7Lus65+8L+yhsO2ajOyhsOqxtCDtlYTrk5zsnZggIu2VhOyImCLCtyLsnb3quLDsoITsmqkiIO2RnOyLnOyXkCDqs7XthrXsnLzroZwg7JOw64qUIOuwsOqyveyDiS4KICAgICAgIO2VhOyImOuKlCDsnYDsnYDtlZwg7YGs66a87IOJKFJHQiAyNTUsMjUwLDIzNyksIOydveq4sOyghOyaqeydgCDtmozsg4nsobDroZwg7Ya17J287ZWc64ukLiAqLwogICAgLS1heC1yZXEtZmlsbDogcmdiKDI1NSwyNTAsMjM3KTsKICAgIC8qIOyhsO2ajOyhsOqxtCDtjKjrhJDsnZgg7J296riw7KCE7JqpIOyDiSguYXgtc2VhcmNoIC5zY3RsLnJvKeqzvCDsoJXtmZXtnogg64+Z7J287ZWcIOqwkiAtIOq3uOumrOuTnCDsnb3quLDsoITsmqkg7ZaJ64+ECiAgICAgICDsnbQg7IOJ7J2EIOq3uOuMgOuhnCDsk7Tri6QuICovCiAgICAtLWF4LXJvLWZpbGw6I2Y2ZjdmODsKICAgIC8qIOyDgeuLqOuwlCh0b3BiYXIp64qUIC0tYXgtbmF2eeyZgCDrs4TqsJwg67OA7IiY66W8IOyTtOuLpDogLS1heC1uYXZ564qUIOyEueyFmCDtl6TrjZTCt+q3uOumrOuTnCDsoJzrqqkg65OxCiAgICAgICDtmZTrqbQg6rOz6rOz7J2YIO2FjeyKpO2KuCDsg4nsnLzroZzrj4Qg7JOw7J2066+A66GcLCDsg4Hri6jrsJTrp4wg67CU6r6466Ck66m0IOyghOyaqSDrs4DsiJjqsIAg7ZWE7JqU7ZWY64ukLgogICAgICAg7JSs66qo65Oc64qUIOuhnOqzoMK367KE7Yq86rO8IOqwmeydgCDqs4Tsl7TsnZgg7KeE7ZWcIOq3uOumsCwg7Yy766qo65Oc64qUIOq4sOyhtCDrhKTsnbTruYQg6re464yA66GcLiAqLwogICAgLyog7LKo67aAIOydtOuvuOyngOyymOufvCDsp4TtlZwg6re466awIOuwlO2DleyXkCDrjIDqsIHshKAg7IK86rCB7ZiVIOq0ke2DneydtCDqsrnsuZjripQg7Yyo7YS0LgogICAgICAg7Jes65+sIOqyueydmCBsaW5lYXItZ3JhZGllbnTroZwg67Cd7J2AL+yWtOuRkOyatCDsgrzqsIHrqbTsnYQg7ZGc7ZiE7ZWc64ukLiAqLwogICAgLS10b3BiYXItYmc6CiAgICAgIGxpbmVhci1ncmFkaWVudCgxMjJkZWcsIHJnYmEoMjU1LDI1NSwyNTUsLjEwKSAwJSwgcmdiYSgyNTUsMjU1LDI1NSwwKSAzMCUpLAogICAgICBsaW5lYXItZ3JhZGllbnQoNThkZWcsIHJnYmEoMjU1LDI1NSwyNTUsLjA3KSAwJSwgcmdiYSgyNTUsMjU1LDI1NSwwKSA0NiUpLAogICAgICBsaW5lYXItZ3JhZGllbnQoMzAwZGVnLCByZ2JhKDAsMCwwLC4yMCkgMCUsIHJnYmEoMCwwLDAsMCkgNDAlKSwKICAgICAgbGluZWFyLWdyYWRpZW50KDk2ZGVnLCAjMTJhMTc4IDAlLCAjMGY5NjcwIDUyJSwgIzE0YTY3YyAxMDAlKTsKICAgIC0tdG9wYmFyLWdob3N0LWJvcmRlcjojMmY2YjUzOyAtLXRvcGJhci1naG9zdC1ob3ZlcjojMWM3MzUwOwogICAgLS1hdXRvc2F2ZS1mZzojOGVlOWMzOwogIH0KICAvKiDsg4Hri6gg66Gc6rOg66W8IOuIhOultOuptCBib2R57JeQIOydtCDtgbTrnpjsiqTqsIAg7Yag6riA65CY7Ja0IOuRkCDrsojsp7gg7Yak7JWk66ek64SIKEZhdCBNb2RlKeuhnAogICAgIOyghO2ZmOuQnOuLpC4g7IOJ7IOB7J2AIOychCDrs4DsiJjrpbwg7J6s7KCV7J2Y7ZWY64qUIOqyg+unjOycvOuhnCDsu7Ttj6zrhIztirgg7KCE67CY7JeQIOuwmOyYgeuQmOqzoCwKICAgICDrqqjshJzrpqwg6rCB7KeQwrfqt7jrpqzrk5wg7Zek642UIOyDiSDrsJjsoIQg65OxIOuzgOyImOuhnCDtkZztmITrkJjsp4Ag7JWK64qUIOuUlO2FjOydvOydgCDslYTrnpjsl5DshJwg67OE64+EIOyymOumrO2VnOuLpC4gKi8KICBib2R5LnNraW4tY2xhc3NpY3sKICAgIC0tYXgtZ3JlZW46IzJmNmZiMDsgLS1heC1ncmVlbi1kYXJrOiMyNDU2OGM7IC0tYXgtZ3JlZW4tbGlnaHQ6I2U1ZWRmODsKICAgIC0tYXgtbmF2eTojMWMzZjY2OyAtLWF4LWJvcmRlcjojYjdjM2NmOwogICAgLS1heC1iZzojZTllZWY0OyAtLWF4LWdyaWQtaGVhZDojMWMzZjY2OyAtLWF4LWdyaWQtaGVhZC1mZzojZmZmZmZmOwogICAgLS1heC1yZWFkb25seS1iZzojZGRlOGY3OyAtLWF4LXJlcXVpcmVkLWJnOiNmZGVhY2I7CiAgICAtLWF4LWNhbnZhcy1iZzojZWVmMmY4OyAtLWF4LWxhYmVsLWZnOiMxYTFhMWE7CiAgICAtLWF4LWdyaWQtbGluZTojZDdlMGVjOwogICAgLyog7Yy766qo65Oc64qUIOqwmeydgCDsgrzqsIHrqbQg7Yyo7YS07J2EIO2MjOuegCDqs4Tsl7TroZzrp4wg67CU6r6864ukLiAqLwogICAgLS10b3BiYXItYmc6CiAgICAgIGxpbmVhci1ncmFkaWVudCgxMjJkZWcsIHJnYmEoMjU1LDI1NSwyNTUsLjEwKSAwJSwgcmdiYSgyNTUsMjU1LDI1NSwwKSAzMCUpLAogICAgICBsaW5lYXItZ3JhZGllbnQoNThkZWcsIHJnYmEoMjU1LDI1NSwyNTUsLjA3KSAwJSwgcmdiYSgyNTUsMjU1LDI1NSwwKSA0NiUpLAogICAgICBsaW5lYXItZ3JhZGllbnQoMzAwZGVnLCByZ2JhKDAsMCwwLC4yMikgMCUsIHJnYmEoMCwwLDAsMCkgNDAlKSwKICAgICAgbGluZWFyLWdyYWRpZW50KDk2ZGVnLCAjMmI2ZmIwIDAlLCAjMjQ1ZjljIDUyJSwgIzJlNzdiYiAxMDAlKTsKICAgIC0tdG9wYmFyLWdob3N0LWJvcmRlcjojNGE1YzZlOyAtLXRvcGJhci1naG9zdC1ob3ZlcjojM2E0YzVlOwogICAgLS1hdXRvc2F2ZS1mZzojN2ZkOGIwOwogIH0KICAqe2JveC1zaXppbmc6Ym9yZGVyLWJveDttYXJnaW46MDtwYWRkaW5nOjA7fQogIGJvZHl7Zm9udC1mYW1pbHk6Ik1hbGd1biBHb3RoaWMiLCLrp5HsnYAg6rOg65SVIiwtYXBwbGUtc3lzdGVtLHNhbnMtc2VyaWY7Zm9udC1zaXplOjEzcHg7Y29sb3I6IzMzMztiYWNrZ3JvdW5kOnZhcigtLWF4LWJnKTtoZWlnaHQ6MTAwdmg7b3ZlcmZsb3c6aGlkZGVuO30KICAuYXBwey0tcHJvcHMtdzozMjRweDtkaXNwbGF5OmdyaWQ7Z3JpZC10ZW1wbGF0ZS1jb2x1bW5zOjE4MHB4IDFmciA2cHggdmFyKC0tcHJvcHMtdyk7Z3JpZC10ZW1wbGF0ZS1yb3dzOjQ0cHggMWZyO2hlaWdodDoxMDB2aDt9CiAgLmFwcD4udG9vbGJveHtncmlkLWNvbHVtbjoxO2dyaWQtcm93OjI7fQogIC5hcHA+LmNhbnZhcy13cmFwe2dyaWQtY29sdW1uOjI7Z3JpZC1yb3c6Mjt9CiAgLmFwcD4jcHJvcHNTcGxpdHtncmlkLWNvbHVtbjozO2dyaWQtcm93OjI7fQogIC5hcHA+LnByb3Bze2dyaWQtY29sdW1uOjQ7Z3JpZC1yb3c6Mjt9CiAgLyog7LqU67KE7Iqk7JmAIOyGjeyEsSDtjKjrhJAg7IKs7J20IOyijOyasCDtgazquLDsobDsoIgg7Iqk7ZSM66as7YSwICovCiAgI3Byb3BzU3BsaXR7YmFja2dyb3VuZDp0cmFuc3BhcmVudDtjdXJzb3I6Y29sLXJlc2l6ZTtwb3NpdGlvbjpyZWxhdGl2ZTt6LWluZGV4OjYwO30KICAjcHJvcHNTcGxpdDo6YmVmb3Jle2NvbnRlbnQ6IiI7cG9zaXRpb246YWJzb2x1dGU7dG9wOjA7Ym90dG9tOjA7bGVmdDoycHg7d2lkdGg6MXB4O2JhY2tncm91bmQ6dmFyKC0tYXgtYm9yZGVyKTt9CiAgI3Byb3BzU3BsaXQ6OmFmdGVye2NvbnRlbnQ6IiI7cG9zaXRpb246YWJzb2x1dGU7dG9wOjUwJTtsZWZ0OjFweDt3aWR0aDozcHg7aGVpZ2h0OjM0cHg7dHJhbnNmb3JtOnRyYW5zbGF0ZVkoLTUwJSk7Ym9yZGVyLXJhZGl1czoycHg7YmFja2dyb3VuZDojY2ZkNmRkO30KICAjcHJvcHNTcGxpdDpob3Zlcjo6YWZ0ZXIsI3Byb3BzU3BsaXQuZHJhZ2dpbmc6OmFmdGVye2JhY2tncm91bmQ6dmFyKC0tYXgtZ3JlZW4pO30KICAjcHJvcHNTcGxpdDpob3Zlcjo6YmVmb3JlLCNwcm9wc1NwbGl0LmRyYWdnaW5nOjpiZWZvcmV7YmFja2dyb3VuZDp2YXIoLS1heC1ncmVlbik7fQogIGJvZHkucHJvcHMtcmVzaXppbmd7Y3Vyc29yOmNvbC1yZXNpemU7dXNlci1zZWxlY3Q6bm9uZTt9CiAgYm9keS5wcm9wcy1yZXNpemluZyBpZnJhbWV7cG9pbnRlci1ldmVudHM6bm9uZTt9CgogIC8qIFRvcCBiYXIgKi8KICAudG9wYmFye2dyaWQtY29sdW1uOjEvNTtncmlkLXJvdzoxO2JhY2tncm91bmQtY29sb3I6IzBmOTY3MDtiYWNrZ3JvdW5kLWltYWdlOnZhcigtLXRvcGJhci1iZyk7Y29sb3I6I2ZmZjtkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO3BhZGRpbmc6MCAxNnB4IDAgMDtnYXA6MTJweDt9CiAgYm9keS5za2luLWNsYXNzaWMgLnRvcGJhcntiYWNrZ3JvdW5kLWNvbG9yOiMyNDVmOWM7fQogIC50b3BiYXIgLmJyYW5ke2ZsZXg6MCAwIDE4MHB4O30KICAvKiBCdXR0b25zIGFyZSBncm91cGVkIGJ5IHB1cnBvc2U6IHRoZSB0b3BiYXIncyBvd24gMTJweCBnYXAgc2VwYXJhdGVzIHRoZSB0d28gc2V0cywgYW5kIGEKICAgICB3aWRlciBsZWZ0IG1hcmdpbiBvbiB0aGUgdHJhaWxpbmcgZ3JvdXAgcHVzaGVzIHRoZSBzZXRzIGZ1cnRoZXIgYXBhcnQsIHdoaWxlIGJ1dHRvbnMKICAgICBpbnNpZGUgYSBzZXQgc2l0IGNsb3NlIHRvZ2V0aGVyIGF0IDZweC4gKi8KICAudG9wYmFyIC5idG4tZ3JvdXB7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6NnB4O30KICAudG9wYmFyIC5idG4tZ3JvdXAgKyAuYnRuLWdyb3Vwe21hcmdpbi1sZWZ0OjE2cHg7fQogIC50b3BiYXIgaDF7Zm9udC1zaXplOjE1cHg7Zm9udC13ZWlnaHQ6NzAwO30KICAudG9wYmFyIC5zcHtmbGV4OjE7fQogIC50b3BiYXIgYnV0dG9ue2JhY2tncm91bmQ6dmFyKC0tYXgtZ3JlZW4pO2NvbG9yOiNmZmY7Ym9yZGVyOm5vbmU7cGFkZGluZzo3cHggMTRweDtib3JkZXItcmFkaXVzOjRweDtmb250LXNpemU6MTJweDtjdXJzb3I6cG9pbnRlcjtmb250LXdlaWdodDo2MDA7fQogIC50b3BiYXIgYnV0dG9uOmhvdmVye2JhY2tncm91bmQ6dmFyKC0tYXgtZ3JlZW4tZGFyayk7fQogIC50b3BiYXIgYnV0dG9uLmdob3N0e2JhY2tncm91bmQ6dHJhbnNwYXJlbnQ7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS10b3BiYXItZ2hvc3QtYm9yZGVyKTt9CiAgLnRvcGJhciBidXR0b24uZ2hvc3Q6aG92ZXJ7YmFja2dyb3VuZDp2YXIoLS10b3BiYXItZ2hvc3QtaG92ZXIpO30KICAvKiBBY2NlbnQgYnV0dG9ucy4gVGhlc2UgY29sb3VycyBsaXZlIGhlcmUgcmF0aGVyIHRoYW4gaW4gaW5saW5lIHN0eWxlIGF0dHJpYnV0ZXM6IGFuIGlubGluZQogICAgIGJhY2tncm91bmQgd2lucyBvdmVyIGFueSBzdHlsZXNoZWV0IHJ1bGUsIHNvIDpob3ZlciBjb3VsZCBuZXZlciByZXBhaW50IGl0LiAqLwogIC50b3BiYXIgYnV0dG9uLmJ0bi10ZWFse2JhY2tncm91bmQ6IzA4OTFiMjt9CiAgLnRvcGJhciBidXR0b24uYnRuLXRlYWw6aG92ZXJ7YmFja2dyb3VuZDojMGU3NDkwO30KICAudG9wYmFyIGJ1dHRvbi5idG4tdmlvbGV0e2JhY2tncm91bmQ6IzdjNWNmZjt9CiAgLnRvcGJhciBidXR0b24uYnRuLXZpb2xldDpob3ZlcntiYWNrZ3JvdW5kOiM2NTQ0ZTA7fQoKICAvKiA9PT09PT09PT09PT09PT09PSDqs4TsoJUo66Gc6re47J24L+2ajOybkOqwgOyehSkgwrcg7YG065287Jqw65OcIOyggOyepS/sl7TquLAgPT09PT09PT09PT09PT09PT0gKi8KICAuYWNjdC1hcmVhe2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjhweDtmbGV4OjAgMCBhdXRvO30KICAuYWNjdC1hcmVhIC5naG9zdHtwYWRkaW5nOjdweCAxMnB4O30KICAuYWNjdC1hcmVhIC5zaWdudXAtYnRue2JhY2tncm91bmQ6I2ZmZjtjb2xvcjp2YXIoLS1heC1ncmVlbi1kYXJrKTtmb250LXdlaWdodDo3MDA7fQogIC5hY2N0LWFyZWEgLnNpZ251cC1idG46aG92ZXJ7YmFja2dyb3VuZDojZWVmN2YyO30KICAuYWNjdC1hdmF0YXItd3JhcHtwb3NpdGlvbjpyZWxhdGl2ZTt9CiAgLmFjY3QtYXZhdGFye3dpZHRoOjMwcHg7aGVpZ2h0OjMwcHg7Ym9yZGVyLXJhZGl1czo1MCU7YmFja2dyb3VuZDojZmZmO2NvbG9yOnZhcigtLWF4LWdyZWVuLWRhcmspO2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcjtmb250LXdlaWdodDo3MDA7Zm9udC1zaXplOjEzcHg7Y3Vyc29yOnBvaW50ZXI7fQogIC5hY2N0LW1lbnV7ZGlzcGxheTpub25lO3Bvc2l0aW9uOmFic29sdXRlO3RvcDpjYWxjKDEwMCUgKyA4cHgpO3JpZ2h0OjA7bWluLXdpZHRoOjE4MHB4O2JhY2tncm91bmQ6I2ZmZjtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWF4LWJvcmRlcik7Ym9yZGVyLXJhZGl1czo4cHg7Ym94LXNoYWRvdzowIDhweCAyNHB4IHJnYmEoMCwwLDAsLjE4KTt6LWluZGV4OjUwMDtvdmVyZmxvdzpoaWRkZW47Zm9udC1zaXplOjEzcHg7fQogIC5hY2N0LW1lbnUub257ZGlzcGxheTpibG9jazt9CiAgLmFjY3QtbWVudSAud2hve3BhZGRpbmc6MTBweCAxNHB4O2ZvbnQtd2VpZ2h0OjYwMDtjb2xvcjojMmMzZTUwO2JvcmRlci1ib3R0b206MXB4IHNvbGlkICNlZWU7fQogIC5hY2N0LW1lbnUgZGl2Lml0ZW17cGFkZGluZzoxMHB4IDE0cHg7Y29sb3I6IzJjM2U1MDtjdXJzb3I6cG9pbnRlcjt9CiAgLmFjY3QtbWVudSBkaXYuaXRlbTpob3ZlcntiYWNrZ3JvdW5kOnZhcigtLWF4LWdyZWVuLWxpZ2h0KTt9CiAgLmFjY3QtbWVudSBkaXYubG9nb3V0e2NvbG9yOiNjMDM5MmI7fQogIC8qIO2ajOybkOqwgOyehS/roZzqt7jsnbgg66qo64usIOqzteyaqSAqLwogIC5hY2N0LWxhYmVse2Rpc3BsYXk6YmxvY2s7Zm9udC1zaXplOjEzcHg7Zm9udC13ZWlnaHQ6NjAwO2NvbG9yOiMyYzNlNTA7bWFyZ2luLWJvdHRvbTo3cHg7fQogIC5hY2N0LWlucHV0e3dpZHRoOjEwMCU7cGFkZGluZzoxMnB4IDE0cHg7Ym9yZGVyOjEuNXB4IHNvbGlkIHZhcigtLWF4LWJvcmRlcik7Ym9yZGVyLXJhZGl1czo4cHg7Zm9udC1zaXplOjE1cHg7Zm9udC1mYW1pbHk6aW5oZXJpdDtib3gtc2l6aW5nOmJvcmRlci1ib3g7fQogIC5hY2N0LWlucHV0OmZvY3Vze291dGxpbmU6bm9uZTtib3JkZXItY29sb3I6dmFyKC0tYXgtZ3JlZW4pO30KICAuYWNjdC1wcmltYXJ5LWJ0bnt3aWR0aDoxMDAlO3BhZGRpbmc6MTNweDtiYWNrZ3JvdW5kOnZhcigtLWF4LWdyZWVuKTtjb2xvcjojZmZmO2JvcmRlcjpub25lO2JvcmRlci1yYWRpdXM6OHB4O2ZvbnQtc2l6ZToxNXB4O2ZvbnQtd2VpZ2h0OjcwMDtjdXJzb3I6cG9pbnRlcjt9CiAgLmFjY3QtcHJpbWFyeS1idG46aG92ZXJ7YmFja2dyb3VuZDp2YXIoLS1heC1ncmVlbi1kYXJrKTt9CiAgLmFjY3QtcHJpbWFyeS1idG46ZGlzYWJsZWR7b3BhY2l0eTouNjtjdXJzb3I6ZGVmYXVsdDt9CiAgLmFjY3QtbGlua3tjb2xvcjp2YXIoLS1heC1ncmVlbi1kYXJrKTtmb250LXdlaWdodDo2MDA7Y3Vyc29yOnBvaW50ZXI7fQogIC5hY2N0LWVycntiYWNrZ3JvdW5kOiNmZGVjZWM7Ym9yZGVyOjFweCBzb2xpZCAjZjVjMmM0O2NvbG9yOiNhODMyMzI7Zm9udC1zaXplOjEyLjVweDtwYWRkaW5nOjlweCAxMnB4O2JvcmRlci1yYWRpdXM6NnB4O21hcmdpbi1ib3R0b206MTZweDt9CiAgLyog7ZS865Oc67CxIOuqqOuLrCAqLwogIC5mYi10b29sYmFye2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjJweDtwYWRkaW5nOjZweCA4cHg7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1heC1ib3JkZXIpO2JvcmRlci1ib3R0b206bm9uZTtib3JkZXItcmFkaXVzOjhweCA4cHggMCAwO2JhY2tncm91bmQ6I2Y5ZmFmYjt9CiAgLmZiLXRvb2xiYXIgYnV0dG9ue2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcjt3aWR0aDoyNnB4O2hlaWdodDoyNnB4O2JvcmRlcjpub25lO2JhY2tncm91bmQ6dHJhbnNwYXJlbnQ7Ym9yZGVyLXJhZGl1czo1cHg7Y3Vyc29yOnBvaW50ZXI7Y29sb3I6IzRiNTU2Mztmb250LXNpemU6MTNweDtmb250LWZhbWlseTppbmhlcml0O30KICAuZmItdG9vbGJhciBidXR0b246aG92ZXJ7YmFja2dyb3VuZDojZWVmMWY0O30KICAuZmItc2Vwe3dpZHRoOjFweDtoZWlnaHQ6MTZweDtiYWNrZ3JvdW5kOiNlNWU5ZWQ7bWFyZ2luOjAgNHB4O2ZsZXgtc2hyaW5rOjA7fQogIC5mYi1lZGl0b3J7bWluLWhlaWdodDoyNDBweDttYXgtaGVpZ2h0OjUyMHB4O292ZXJmbG93LXk6YXV0bztib3JkZXI6MXB4IHNvbGlkIHZhcigtLWF4LWJvcmRlcik7Ym9yZGVyLXJhZGl1czowIDAgOHB4IDhweDtwYWRkaW5nOjEycHggMTRweDtmb250LXNpemU6MTMuNXB4O2NvbG9yOiMyYzNlNTA7bGluZS1oZWlnaHQ6MS42O30KICAuZmItZWRpdG9yOmZvY3Vze291dGxpbmU6bm9uZTtib3JkZXItY29sb3I6dmFyKC0tYXgtZ3JlZW4pO30KICAuZmItZWRpdG9yOmVtcHR5OjpiZWZvcmV7Y29udGVudDphdHRyKGRhdGEtcGxhY2Vob2xkZXIpO2NvbG9yOiNiMGI4YzE7fQogIC8qIO2BtOudvOyasOuTnCDsoIDsnqUv7Je06riwIOuqqOuLrCAqLwogICNjbG91ZEJnIC5tb2RhbHtvdmVyZmxvdzp2aXNpYmxlO30KICAjY2xvdWRCb2R5e2Rpc3BsYXk6ZmxleDtmbGV4LWRpcmVjdGlvbjpjb2x1bW47ZmxleDoxO292ZXJmbG93OmhpZGRlbjttaW4taGVpZ2h0OjA7fQogIC5jbC1yZXNpemUtaGFuZGxle3Bvc2l0aW9uOmFic29sdXRlO3JpZ2h0OjJweDtib3R0b206MnB4O3dpZHRoOjE2cHg7aGVpZ2h0OjE2cHg7Y3Vyc29yOm53c2UtcmVzaXplO3otaW5kZXg6MTA7CiAgICBiYWNrZ3JvdW5kOmxpbmVhci1ncmFkaWVudCgxMzVkZWcsdHJhbnNwYXJlbnQgNDUlLHZhcigtLWF4LWdyZWVuKSA0NSUsdmFyKC0tYXgtZ3JlZW4pIDU1JSx0cmFuc3BhcmVudCA1NSUsdHJhbnNwYXJlbnQgNzAlLHZhcigtLWF4LWdyZWVuKSA3MCUsdmFyKC0tYXgtZ3JlZW4pIDgwJSx0cmFuc3BhcmVudCA4MCUpOwogICAgYm9yZGVyLXJhZGl1czowIDAgOHB4IDA7fQogIC5jbC1yZXNpemUtaGFuZGxlOmhvdmVye2ZpbHRlcjpicmlnaHRuZXNzKC44NSk7fQogIC5jbC10YWJze2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjZweDtwYWRkaW5nOjE0cHggMThweDtib3JkZXItYm90dG9tOjFweCBzb2xpZCAjZTVlOWVkO2JhY2tncm91bmQ6I2ZhZmJmYztmbGV4LXNocmluazowO30KICAuY2wtdGFicy1ncm91cHtkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDo4cHg7fQogIC5jbC10YWJ7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6NnB4O3BhZGRpbmc6N3B4IDE2cHg7Zm9udC1zaXplOjEzLjVweDtmb250LXdlaWdodDo2MDA7Y29sb3I6IzNmNGE1NjtjdXJzb3I6cG9pbnRlcjtib3JkZXItcmFkaXVzOjhweDtib3JkZXI6MS41cHggc29saWQgI2M3Y2RkMztiYWNrZ3JvdW5kOiNmZmY7fQogIC5jbC10YWIgc3Zne29wYWNpdHk6Ljg7fQogIC5jbC10YWI6aG92ZXJ7YmFja2dyb3VuZDojZjNmNmY1O2JvcmRlci1jb2xvcjojOWFhNWIxO30KICAuY2wtdGFiLm9ue2NvbG9yOiNmZmY7YmFja2dyb3VuZDp2YXIoLS1heC1ncmVlbik7Ym9yZGVyLWNvbG9yOnZhcigtLWF4LWdyZWVuKTtmb250LXdlaWdodDo3MDA7Ym94LXNoYWRvdzowIDFweCAzcHggcmdiYSgwLDAsMCwuMTIpO30KICAuY2wtdGFiLm9uIHN2Z3tvcGFjaXR5OjE7fQogIC5jbC10YWIub246aG92ZXJ7YmFja2dyb3VuZDp2YXIoLS1heC1ncmVlbi1kYXJrKTtib3JkZXItY29sb3I6dmFyKC0tYXgtZ3JlZW4tZGFyayk7fQogIC5jbC10b29sYmFye2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjhweDtwYWRkaW5nOjEycHggMThweDtib3JkZXItYm90dG9tOjFweCBzb2xpZCAjZTVlOWVkO2ZsZXgtd3JhcDp3cmFwO2ZsZXgtc2hyaW5rOjA7fQogIC5jbC1jcnVtYntmb250LXNpemU6MTNweDtjb2xvcjojM2E0NTUyO30KICAuY2wtY3J1bWIgLnNlZ3tjdXJzb3I6cG9pbnRlcjt9CiAgLmNsLWNydW1iIC5zZWc6aG92ZXJ7dGV4dC1kZWNvcmF0aW9uOnVuZGVybGluZTt9CiAgLmNsLWNydW1iIC5zZXB7Y29sb3I6I2MzY2FkMTttYXJnaW46MCA0cHg7fQogIC5jbC1jcnVtYiAuY3Vye2NvbG9yOnZhcigtLWF4LWdyZWVuLWRhcmspO2ZvbnQtd2VpZ2h0OjcwMDt9CiAgLmNsLW5ld2ZvbGRlci1idG57ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6NXB4O3BhZGRpbmc6N3B4IDEycHg7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1heC1ib3JkZXIpO2JhY2tncm91bmQ6I2ZmZjtib3JkZXItcmFkaXVzOjZweDtmb250LXNpemU6MTIuNXB4O2N1cnNvcjpwb2ludGVyO2NvbG9yOiMzYTQ1NTI7d2hpdGUtc3BhY2U6bm93cmFwO30KICAuY2wtc2VhcmNoLWJveHtkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDo4cHg7cGFkZGluZzo2cHggMTBweDtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWF4LWJvcmRlcik7Ym9yZGVyLXJhZGl1czo2cHg7d2lkdGg6MjIwcHg7fQogIC5jbC1zZWFyY2gtYm94IGlucHV0e2JvcmRlcjpub25lO291dGxpbmU6bm9uZTtmb250LXNpemU6MTIuNXB4O2ZvbnQtZmFtaWx5OmluaGVyaXQ7ZmxleDoxO21pbi13aWR0aDowO2NvbG9yOiMyYzNlNTA7fQogIC5jbC1zdWJmb2xkZXItY2hre2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjZweDtmb250LXNpemU6MTIuNXB4O2NvbG9yOiMzYTQ1NTI7Y3Vyc29yOnBvaW50ZXI7d2hpdGUtc3BhY2U6bm93cmFwO30KICAuY2wtc3ViZm9sZGVyLWNoayBpbnB1dHthY2NlbnQtY29sb3I6dmFyKC0tYXgtZ3JlZW4pO3dpZHRoOjE0cHg7aGVpZ2h0OjE0cHg7fQogIC5jbC1ib2R5e2Rpc3BsYXk6ZmxleDtmbGV4OjE7b3ZlcmZsb3c6aGlkZGVuO21pbi1oZWlnaHQ6MDt9CiAgLmNsLXJlc3VsdHMtd3JhcHtkaXNwbGF5OmZsZXg7ZmxleC1kaXJlY3Rpb246Y29sdW1uO2ZsZXg6MTtvdmVyZmxvdzpoaWRkZW47bWluLWhlaWdodDowO30KICAuY2wtdHJlZXt3aWR0aDoyMDBweDtib3JkZXItcmlnaHQ6bm9uZTtvdmVyZmxvdy15OmF1dG87cGFkZGluZzoxMHB4IDZweDtmbGV4LXNocmluazowO30KICAuY2wtdHJlZS1zZXB7aGVpZ2h0OjFweDtiYWNrZ3JvdW5kOiNlNWU5ZWQ7bWFyZ2luOjhweCA0cHg7fQogIC5jbC1zcGxpdHt3aWR0aDo2cHg7ZmxleC1zaHJpbms6MDtjdXJzb3I6Y29sLXJlc2l6ZTtwb3NpdGlvbjpyZWxhdGl2ZTtiYWNrZ3JvdW5kOiNlNWU5ZWQ7fQogIC5jbC1zcGxpdDo6YWZ0ZXJ7Y29udGVudDonJztwb3NpdGlvbjphYnNvbHV0ZTt0b3A6MDtib3R0b206MDtsZWZ0OjJweDt3aWR0aDoycHg7YmFja2dyb3VuZDp0cmFuc3BhcmVudDt9CiAgLmNsLXNwbGl0OmhvdmVyOjphZnRlciwuY2wtc3BsaXQuZHJhZ2dpbmc6OmFmdGVye2JhY2tncm91bmQ6dmFyKC0tYXgtZ3JlZW4pO30KICAuY2wtdHJlZS1pdGVte2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjVweDtwYWRkaW5nOjdweCA4cHg7Ym9yZGVyLXJhZGl1czo2cHg7Y3Vyc29yOnBvaW50ZXI7Zm9udC1zaXplOjEzcHg7Y29sb3I6IzNhNDU1Mjt9CiAgLmNsLXRyZWUtaXRlbTpob3ZlcntiYWNrZ3JvdW5kOiNmMmY1ZjM7fQogIC5jbC10cmVlLWl0ZW0ub257YmFja2dyb3VuZDp2YXIoLS1heC1ncmVlbi1saWdodCk7Y29sb3I6dmFyKC0tYXgtZ3JlZW4tZGFyayk7Zm9udC13ZWlnaHQ6NjAwO30KICAuY2wtcmVuYW1lLWJ0bntmbGV4LXNocmluazowO2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcjt3aWR0aDoxOHB4O2hlaWdodDoxOHB4O2JvcmRlci1yYWRpdXM6NHB4O2NvbG9yOiM5Y2EzYWY7b3BhY2l0eTowO2N1cnNvcjpwb2ludGVyO30KICAuY2wtdHJlZS1pdGVtOmhvdmVyIC5jbC1yZW5hbWUtYnRuLC5jbC1yb3c6aG92ZXIgLmNsLXJlbmFtZS1idG57b3BhY2l0eToxO30KICAuY2wtcmVuYW1lLWJ0bjpob3ZlcntiYWNrZ3JvdW5kOiNlNWU5ZWQ7Y29sb3I6IzNhNDU1Mjt9CiAgLmNsLXJvdy1hY3Rpb25ze2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmZsZXgtZW5kO2dhcDo0cHg7fQogIC5jbC1jb3VudHtmbGV4LXNocmluazowO2ZvbnQtc2l6ZToxMXB4O2NvbG9yOiM5Y2EzYWY7bWFyZ2luLWxlZnQ6MnB4O30KICAuY2wtbmFtZS10ZXh0e2ZsZXg6MTttaW4td2lkdGg6MDtvdmVyZmxvdzpoaWRkZW47dGV4dC1vdmVyZmxvdzplbGxpcHNpczt3aGl0ZS1zcGFjZTpub3dyYXA7fQogIC5jbC10cmVlLWl0ZW0ub24gLmNsLWNvdW50e2NvbG9yOnZhcigtLWF4LWdyZWVuLWRhcmspO30KICAuY2wtdHJlZS1pdGVtLmNsLWRyb3AtdGFyZ2V0LC5jbC1yb3cuY2wtZHJvcC10YXJnZXR7YmFja2dyb3VuZDp2YXIoLS1heC1ncmVlbi1saWdodCkhaW1wb3J0YW50O291dGxpbmU6MS41cHggZGFzaGVkIHZhcigtLWF4LWdyZWVuKTtvdXRsaW5lLW9mZnNldDotMS41cHg7fQogIC5jbC10cmVlLWl0ZW0gLmNoZXZ7d2lkdGg6OXB4O2hlaWdodDo5cHg7ZmxleC1zaHJpbms6MDtkaXNwbGF5OmlubGluZS1mbGV4O2N1cnNvcjpwb2ludGVyO30KICAuY2wtbGlzdHtmbGV4OjE7b3ZlcmZsb3cteTphdXRvO3BhZGRpbmc6MTBweCA4cHg7fQogIC5jbC1saXN0LWhlYWR7ZGlzcGxheTpncmlkO3BhZGRpbmc6NnB4IDE0cHg7Zm9udC1zaXplOjExcHg7Y29sb3I6IzljYTNhZjtmb250LXdlaWdodDo2MDA7fQogIC5jbC1yb3d7ZGlzcGxheTpncmlkO2FsaWduLWl0ZW1zOmNlbnRlcjtwYWRkaW5nOjlweCAxNHB4O2JvcmRlci1yYWRpdXM6NnB4O2N1cnNvcjpwb2ludGVyO30KICAuY2wtcm93OmhvdmVye2JhY2tncm91bmQ6I2Y3ZjlmODt9CiAgLmNsLXJvdy5zZWx7YmFja2dyb3VuZDojZjBmN2ZmO30KICAuY2wtcm93LW5hbWV7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6OXB4O2ZvbnQtc2l6ZToxMy41cHg7Y29sb3I6IzJjM2U1MDtvdmVyZmxvdzpoaWRkZW47dGV4dC1vdmVyZmxvdzplbGxpcHNpczt3aGl0ZS1zcGFjZTpub3dyYXA7fQogIC5jbC1kaW17Zm9udC1zaXplOjEycHg7Y29sb3I6IzhhOTdhMzt9CiAgLmNsLXRvZ2dsZXtwb3NpdGlvbjpyZWxhdGl2ZTtkaXNwbGF5OmlubGluZS1ibG9jazt3aWR0aDozNHB4O2hlaWdodDoxOXB4O2N1cnNvcjpwb2ludGVyO2ZsZXgtc2hyaW5rOjA7fQogIC5jbC10b2dnbGUgaW5wdXR7b3BhY2l0eTowO3dpZHRoOjA7aGVpZ2h0OjA7fQogIC5jbC10b2dnbGUgLnRya3twb3NpdGlvbjphYnNvbHV0ZTtpbnNldDowO2JhY2tncm91bmQ6dmFyKC0tYXgtYm9yZGVyKTtib3JkZXItcmFkaXVzOjE5cHg7dHJhbnNpdGlvbjouMTVzO30KICAuY2wtdG9nZ2xlIC5kb3R7cG9zaXRpb246YWJzb2x1dGU7dG9wOjIuNXB4O2xlZnQ6Mi41cHg7d2lkdGg6MTRweDtoZWlnaHQ6MTRweDtiYWNrZ3JvdW5kOiNmZmY7Ym9yZGVyLXJhZGl1czo1MCU7dHJhbnNpdGlvbjouMTVzO30KICAuY2wtdG9nZ2xlIGlucHV0OmNoZWNrZWQgKyAudHJre2JhY2tncm91bmQ6dmFyKC0tYXgtZ3JlZW4pO30KICAuY2wtdG9nZ2xlIGlucHV0OmNoZWNrZWQgfiAuZG90e2xlZnQ6MTdweDt9CiAgLmNsLWZvb3RlcntkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDoxMHB4O3BhZGRpbmc6MTRweCAyMHB4O2JvcmRlci10b3A6MXB4IHNvbGlkICNlNWU5ZWQ7ZmxleC1zaHJpbms6MDt9CiAgLmNsLWZvb3RlciBpbnB1dFt0eXBlPXRleHRde2ZsZXg6MTtwYWRkaW5nOjlweCAxMnB4O2JvcmRlcjoxLjVweCBzb2xpZCB2YXIoLS1heC1ib3JkZXIpO2JvcmRlci1yYWRpdXM6NnB4O2ZvbnQtc2l6ZToxM3B4O2ZvbnQtZmFtaWx5OmluaGVyaXQ7fQogIC5jbC1jYW5jZWwtYnRue3BhZGRpbmc6OXB4IDE4cHg7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1heC1ib3JkZXIpO2JhY2tncm91bmQ6I2ZmZjtib3JkZXItcmFkaXVzOjZweDtmb250LXNpemU6MTNweDtjdXJzb3I6cG9pbnRlcjtjb2xvcjojNTU1O3doaXRlLXNwYWNlOm5vd3JhcDt9CiAgLmNsLXByaW1hcnktYnRue3BhZGRpbmc6OXB4IDIwcHg7Ym9yZGVyOm5vbmU7YmFja2dyb3VuZDp2YXIoLS1heC1ncmVlbik7Y29sb3I6I2ZmZjtib3JkZXItcmFkaXVzOjZweDtmb250LXNpemU6MTNweDtmb250LXdlaWdodDo3MDA7Y3Vyc29yOnBvaW50ZXI7d2hpdGUtc3BhY2U6bm93cmFwO30KICAuY2wtcHJpbWFyeS1idG46ZGlzYWJsZWR7b3BhY2l0eTouNTU7Y3Vyc29yOmRlZmF1bHQ7fQogIC5jbC10YWdib3h7ZmxleDoxO2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7ZmxleC13cmFwOndyYXA7Z2FwOjZweDtwYWRkaW5nOjZweCAxMHB4O2JvcmRlcjoxLjVweCBzb2xpZCB2YXIoLS1heC1ib3JkZXIpO2JvcmRlci1yYWRpdXM6NnB4O30KICAuY2wtdGFnY2hpcHtkaXNwbGF5OmlubGluZS1mbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6NXB4O2ZvbnQtc2l6ZToxMnB4O3BhZGRpbmc6NHB4IDlweDtib3JkZXItcmFkaXVzOjk5OXB4O2JhY2tncm91bmQ6dmFyKC0tYXgtZ3JlZW4tbGlnaHQpO2NvbG9yOnZhcigtLWF4LWdyZWVuLWRhcmspO2ZvbnQtd2VpZ2h0OjYwMDt9CiAgLmNsLXRhZ2NoaXAgc3BhbntjdXJzb3I6cG9pbnRlcjtjb2xvcjojOGZiZmE4O30KICAuY2wtdGFnYm94IGlucHV0e2JvcmRlcjpub25lO291dGxpbmU6bm9uZTtmb250LXNpemU6MTIuNXB4O2ZvbnQtZmFtaWx5OmluaGVyaXQ7ZmxleDoxO21pbi13aWR0aDoxMDBweDt9CiAgLmNsLWZpbHRlcmNoaXB7Zm9udC1zaXplOjExLjVweDtwYWRkaW5nOjVweCAxMXB4O2JvcmRlci1yYWRpdXM6OTk5cHg7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1heC1ib3JkZXIpO2NvbG9yOiMzYTQ1NTI7Y3Vyc29yOnBvaW50ZXI7ZmxleC1zaHJpbms6MDt9CiAgLmNsLWZpbHRlcmNoaXAub257YmFja2dyb3VuZDp2YXIoLS1heC1ncmVlbik7Ym9yZGVyLWNvbG9yOnZhcigtLWF4LWdyZWVuKTtjb2xvcjojZmZmO30KICAuY2wtdGFnYmFyLXdyYXB7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmZsZXgtc3RhcnQ7Z2FwOjhweDtwYWRkaW5nOjEwcHggMThweDtmbGV4LXNocmluazowO30KICAuY2wtdGFnYmFye2Rpc3BsYXk6ZmxleDtmbGV4LXdyYXA6d3JhcDtnYXA6NnB4O2ZsZXg6MTttaW4td2lkdGg6MDtvdmVyZmxvdzpoaWRkZW47fQogIC5jbC10YWdiYXItdG9nZ2xle2ZsZXgtc2hyaW5rOjA7Zm9udC1zaXplOjExLjVweDtmb250LXdlaWdodDo2MDA7Y29sb3I6dmFyKC0tYXgtZ3JlZW4tZGFyayk7YmFja2dyb3VuZDojZjZmYWY4O2JvcmRlcjoxcHggc29saWQgI2Q5ZWNlMztib3JkZXItcmFkaXVzOjk5OXB4O3BhZGRpbmc6NXB4IDEwcHg7Y3Vyc29yOnBvaW50ZXI7d2hpdGUtc3BhY2U6bm93cmFwO30KICAuY2wtdGFnYmFyLXRvZ2dsZTpob3ZlcntiYWNrZ3JvdW5kOiNlZWY2ZjE7fQogIC5jbC12aWV3dG9nZ2xle2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1heC1ib3JkZXIpO2JvcmRlci1yYWRpdXM6NnB4O292ZXJmbG93OmhpZGRlbjtmbGV4LXNocmluazowO30KICAuY2wtdmlld3RvZ2dsZSBzcGFue2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcjt3aWR0aDozMHB4O2hlaWdodDozMHB4O2NvbG9yOiM4YTk3YTM7Y3Vyc29yOnBvaW50ZXI7fQogIC5jbC12aWV3dG9nZ2xlIHNwYW46aG92ZXJ7YmFja2dyb3VuZDojZjNmNmY1O30KICAuY2wtdmlld3RvZ2dsZSBzcGFuLm9ue2JhY2tncm91bmQ6dmFyKC0tYXgtZ3JlZW4tbGlnaHQpO2NvbG9yOnZhcigtLWF4LWdyZWVuLWRhcmspO30KICAuY2wtdmlld3RvZ2dsZSBzcGFuK3NwYW57Ym9yZGVyLWxlZnQ6MXB4IHNvbGlkIHZhcigtLWF4LWJvcmRlcik7fQogIC5jbC10YWdwaWxse2ZvbnQtc2l6ZToxMC41cHg7cGFkZGluZzoycHggN3B4O2JvcmRlci1yYWRpdXM6OTk5cHg7YmFja2dyb3VuZDp2YXIoLS1heC1ncmVlbi1saWdodCk7Y29sb3I6dmFyKC0tYXgtZ3JlZW4tZGFyayk7Zm9udC13ZWlnaHQ6NjAwO30KICAuY2wtdGh1bWItc217d2lkdGg6NDBweDtoZWlnaHQ6MjZweDtib3JkZXItcmFkaXVzOjRweDtvdmVyZmxvdzpoaWRkZW47YmFja2dyb3VuZDojZjRmNmY4O2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcjtmbGV4LXNocmluazowO30KICAuY2wtY2FyZHN7ZGlzcGxheTpncmlkO2dyaWQtdGVtcGxhdGUtY29sdW1uczpyZXBlYXQoYXV0by1maWxsLDE1MHB4KTtncmlkLWF1dG8tcm93czptaW4tY29udGVudDtnYXA6MTJweDtwYWRkaW5nOjE0cHggMThweDtmbGV4OjE7b3ZlcmZsb3cteTphdXRvO21pbi1oZWlnaHQ6MDthbGlnbi1jb250ZW50OnN0YXJ0O30KICAuY2wtY2FyZHtib3JkZXI6MXB4IHNvbGlkICNlNWU5ZWQ7Ym9yZGVyLXJhZGl1czoxMHB4O292ZXJmbG93OmhpZGRlbjtjdXJzb3I6cG9pbnRlcjtiYWNrZ3JvdW5kOiNmZmY7fQogIC5jbC1jYXJkLnNlbHtib3JkZXItY29sb3I6dmFyKC0tYXgtZ3JlZW4pO2JveC1zaGFkb3c6MCAwIDAgMnB4IHZhcigtLWF4LWdyZWVuLWxpZ2h0KTt9CiAgLmNsLWNhcmQtdGh1bWJ7aGVpZ2h0OjU4cHg7YmFja2dyb3VuZDpsaW5lYXItZ3JhZGllbnQoMTM1ZGVnLCNmNGY2ZjgsI2VlZjFmNCk7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyO2JvcmRlci1ib3R0b206MXB4IHNvbGlkICNlNWU5ZWQ7fQogIC5jbC1jYXJkLWJvZHl7cGFkZGluZzoxMHB4IDEycHg7fQogIC5jbC1jYXJkLXRpdGxle2ZvbnQtc2l6ZToxM3B4O2ZvbnQtd2VpZ2h0OjYwMDtjb2xvcjojMmMzZTUwO21hcmdpbi1ib3R0b206NXB4O3doaXRlLXNwYWNlOm5vd3JhcDtvdmVyZmxvdzpoaWRkZW47dGV4dC1vdmVyZmxvdzplbGxpcHNpczt9CiAgLmNsLWVtcHR5e3BhZGRpbmc6NjBweCAyMHB4O3RleHQtYWxpZ246Y2VudGVyO2NvbG9yOiM5Y2EzYWY7Zm9udC1zaXplOjEzcHg7fQogIC5jbC1zaGFyZWQtbG9hZG1vcmV7cGFkZGluZzoxNHB4IDIwcHg7dGV4dC1hbGlnbjpjZW50ZXI7Y29sb3I6IzljYTNhZjtmb250LXNpemU6MTJweDt9CiAgLyog6rO17Jyg7YyM7J28IC0g66qp66Gd7Jy866GcIOuztOq4sCjtg5Dsg4nquLAg7Iqk7YOA7J28IOyijOyasCDrtoTtlaApICovCiAgLmNsLXNoYXJlZC1zcGxpdC1ib2R5e2Rpc3BsYXk6ZmxleDtmbGV4OjE7b3ZlcmZsb3c6aGlkZGVuO21pbi1oZWlnaHQ6MDt9CiAgLmNsLXNoYXJlZC1saXN0LXBhbmV7b3ZlcmZsb3cteTphdXRvO3BhZGRpbmc6MTBweCA4cHg7ZmxleC1zaHJpbms6MDt9CiAgLmNsLWV4cGxvcmVyLXJvd3tkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDoxMHB4O3BhZGRpbmc6OHB4IDEwcHg7Ym9yZGVyLXJhZGl1czo2cHg7Y3Vyc29yOnBvaW50ZXI7fQogIC5jbC1leHBsb3Jlci1yb3c6aG92ZXJ7YmFja2dyb3VuZDojZjdmOWY4O30KICAuY2wtZXhwbG9yZXItcm93LnNlbHtiYWNrZ3JvdW5kOiNmMGY3ZmY7fQogIC5jbC1leHBsb3Jlci1tZXRhe2ZsZXg6MTttaW4td2lkdGg6MDtkaXNwbGF5OmZsZXg7ZmxleC1kaXJlY3Rpb246Y29sdW1uO2dhcDoycHg7fQogIC5jbC1leHBsb3Jlci1tZXRhIC5jbC1zdWJ7Zm9udC1zaXplOjExcHg7Y29sb3I6IzljYTNhZjtvdmVyZmxvdzpoaWRkZW47dGV4dC1vdmVyZmxvdzplbGxpcHNpczt3aGl0ZS1zcGFjZTpub3dyYXA7fQogIC5jbC1zaGFyZWQtcHJldmlldy1wYW5le2ZsZXg6MTtvdmVyZmxvdzpoaWRkZW47ZGlzcGxheTpmbGV4O2ZsZXgtZGlyZWN0aW9uOmNvbHVtbjthbGlnbi1pdGVtczpjZW50ZXI7cGFkZGluZzoyMHB4O2JhY2tncm91bmQ6I2ZhZmJmYztnYXA6MTJweDttaW4td2lkdGg6MDt9CiAgLmNsLXNoYXJlZC1wcmV2aWV3LWZyYW1lLW91dGVye3Bvc2l0aW9uOnJlbGF0aXZlO2ZsZXg6MTt3aWR0aDoxMDAlO21pbi1oZWlnaHQ6MDtkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2p1c3RpZnktY29udGVudDpjZW50ZXI7b3ZlcmZsb3c6aGlkZGVuO30KICAuY2wtc2hhcmVkLXpvb20tY3Rse3Bvc2l0aW9uOmFic29sdXRlO3JpZ2h0OjEwcHg7Ym90dG9tOjEwcHg7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6MnB4O2JhY2tncm91bmQ6I2ZmZjtib3JkZXI6MXB4IHNvbGlkICNlNWU5ZWQ7Ym9yZGVyLXJhZGl1czo3cHg7Ym94LXNoYWRvdzowIDJweCA4cHggcmdiYSgwLDAsMCwuMTIpO3BhZGRpbmc6M3B4O3otaW5kZXg6NTt9CiAgLmNsLXNoYXJlZC16b29tLWN0bCBidXR0b257d2lkdGg6MjRweDtoZWlnaHQ6MjRweDtib3JkZXI6bm9uZTtiYWNrZ3JvdW5kOnRyYW5zcGFyZW50O2JvcmRlci1yYWRpdXM6NXB4O2N1cnNvcjpwb2ludGVyO2NvbG9yOiM0YjU1NjM7Zm9udC1zaXplOjE1cHg7Zm9udC13ZWlnaHQ6NzAwO2ZvbnQtZmFtaWx5OmluaGVyaXQ7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyO30KICAuY2wtc2hhcmVkLXpvb20tY3RsIGJ1dHRvbjpob3ZlcntiYWNrZ3JvdW5kOiNlZWYxZjQ7fQogIC5jbC1zaGFyZWQtem9vbS1wY3R7Zm9udC1zaXplOjExcHg7Y29sb3I6IzZiNzI4MDtwYWRkaW5nOjAgNnB4O2N1cnNvcjpwb2ludGVyO3VzZXItc2VsZWN0Om5vbmU7bWluLXdpZHRoOjM2cHg7dGV4dC1hbGlnbjpjZW50ZXI7fQogIC5jbC1zaGFyZWQtem9vbS1wY3Q6aG92ZXJ7Y29sb3I6dmFyKC0tYXgtZ3JlZW4tZGFyayk7fQogIC5jbC1zaGFyZWQtcHJldmlldy1mcmFtZS1vdXRlciBpZnJhbWV7Ym9yZGVyOjFweCBzb2xpZCAjZTVlOWVkO2JvcmRlci1yYWRpdXM6NnB4O2JveC1zaGFkb3c6MCAycHggMTBweCByZ2JhKDAsMCwwLC4wNik7YmFja2dyb3VuZDojZmZmO3RyYW5zZm9ybS1vcmlnaW46Y2VudGVyIGNlbnRlcjt9CiAgLmNsLXNoYXJlZC1wcmV2aWV3LWxvYWRpbmd7Y29sb3I6IzljYTNhZjtmb250LXNpemU6MTNweDt9CiAgLmNsLXNoYXJlZC1wcmV2aWV3LWVtcHR5e2NvbG9yOiM5Y2EzYWY7Zm9udC1zaXplOjEzcHg7dGV4dC1hbGlnbjpjZW50ZXI7cGFkZGluZzo2MHB4IDIwcHg7fQogIC5jbC1zdGFyLWJ0bntkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2p1c3RpZnktY29udGVudDpjZW50ZXI7Y3Vyc29yOnBvaW50ZXI7ZmxleC1zaHJpbms6MDt9CiAgLmNsLWV4cGxvcmVyLXJpZ2h0e2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjZweDtmbGV4LXNocmluazowO30KICAuY2wtb3Blbi1jb3VudHtkaXNwbGF5OmlubGluZS1mbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6M3B4O2ZvbnQtc2l6ZToxMXB4O2NvbG9yOiM4YTk3YTM7ZmxleC1zaHJpbms6MDt9CgogIC8qIFRvb2xib3ggKi8KICAudG9vbGJveHtiYWNrZ3JvdW5kOiNmZmY7Ym9yZGVyLXJpZ2h0OjFweCBzb2xpZCB2YXIoLS1heC1ib3JkZXIpO292ZXJmbG93LXk6YXV0bztwYWRkaW5nOjEwcHg7fQogIC50b29sYm94IGgze2ZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLWF4LWdyYXkpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNXB4O21hcmdpbjoxMnB4IDAgNnB4O3BhZGRpbmctYm90dG9tOjRweDtib3JkZXItYm90dG9tOjFweCBzb2xpZCAjZWVlO30KICAudG9vbGJveCBoMzpmaXJzdC1jaGlsZHttYXJnaW4tdG9wOjA7fQogIC50Z3JwLWh7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtqdXN0aWZ5LWNvbnRlbnQ6c3BhY2UtYmV0d2VlbjtjdXJzb3I6cG9pbnRlcjt1c2VyLXNlbGVjdDpub25lO30KICAudGdycC1pY3tmb250LXNpemU6OXB4O2NvbG9yOnZhcigtLWF4LWdyYXkpO3RyYW5zaXRpb246dHJhbnNmb3JtIC4xNXM7ZmxleDpub25lO30KICAudGdycC5jb2xsYXBzZWQgLnRncnAtYm9keXtkaXNwbGF5Om5vbmU7fQogIC50Z3JwLmNvbGxhcHNlZCAudGdycC1pY3t0cmFuc2Zvcm06cm90YXRlKC05MGRlZyk7fQogIC5jbGljay1wbGFjZS10b2dnbGV7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6NnB4O2ZvbnQtc2l6ZToxMnB4O2NvbG9yOnZhcigtLWF4LW5hdnkpO3BhZGRpbmctYm90dG9tOjEwcHg7bWFyZ2luLWJvdHRvbTo2cHg7Ym9yZGVyLWJvdHRvbToxcHggc29saWQgI2VlZTtjdXJzb3I6cG9pbnRlcjt9CiAgLnRvb2xib3gtY3JlZGl0e21hcmdpbi10b3A6MTZweDtwYWRkaW5nLXRvcDoxMHB4O2JvcmRlci10b3A6MXB4IHNvbGlkICNlZWU7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC1zaXplOjEwcHg7Y29sb3I6I2MzYzljZTt1c2VyLXNlbGVjdDpub25lO30KICAvKiDquLDquLAg66qo65OcKFBDL+2DnOu4lOumvy/rqqjrsJTsnbwpIOqwleygnOyghO2ZmCDrsoTtirw6IOyEoChib3JkZXItdG9wKSDslYTrnpgsIGJ5IEp1bmUg7YWN7Iqk7Yq4IOychCDtlZwg7ZaJICovCiAgLm1vZGUtc3dpdGNoe2Rpc3BsYXk6ZmxleDtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyO2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6OHB4O21hcmdpbjo5cHggMCA3cHg7fQogIC5tb2RlLXN3aXRjaCAubXNie3Bvc2l0aW9uOnJlbGF0aXZlO3dpZHRoOjMwcHg7aGVpZ2h0OjMwcHg7cGFkZGluZzowO2Rpc3BsYXk6aW5saW5lLWZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2p1c3RpZnktY29udGVudDpjZW50ZXI7CiAgICBiYWNrZ3JvdW5kOiNmZmY7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1heC1ib3JkZXIpO2JvcmRlci1yYWRpdXM6N3B4O2N1cnNvcjpwb2ludGVyO2NvbG9yOnZhcigtLWF4LWdyYXkpOwogICAgdHJhbnNpdGlvbjpib3JkZXItY29sb3IgLjE1cyxiYWNrZ3JvdW5kIC4xNXMsY29sb3IgLjE1cyxib3gtc2hhZG93IC4xNXM7fQogIC5tb2RlLXN3aXRjaCAubXNiIHN2Z3t3aWR0aDoxOHB4O2hlaWdodDoxOHB4O2Rpc3BsYXk6YmxvY2s7fQogIC5tb2RlLXN3aXRjaCAubXNiOmhvdmVye2JvcmRlci1jb2xvcjp2YXIoLS1heC1ncmVlbik7Y29sb3I6dmFyKC0tYXgtZ3JlZW4pO2JhY2tncm91bmQ6dmFyKC0tYXgtZ3JlZW4tbGlnaHQpO30KICAvKiDtmITsnqwg66qo65OcOiDssYTsm4zsp4Qo7Zmc7ISxKSDsg4Htg5zroZwg7Yag6riAIO2RnOyLnCAqLwogIC5tb2RlLXN3aXRjaCAubXNiLm9ue2JhY2tncm91bmQ6dmFyKC0tYXgtZ3JlZW4pO2JvcmRlci1jb2xvcjp2YXIoLS1heC1ncmVlbik7Y29sb3I6I2ZmZjtib3gtc2hhZG93OjAgMnB4IDZweCByZ2JhKDMwLDE1OCwxMDYsLjM1KTtjdXJzb3I6ZGVmYXVsdDt9CiAgLm1vZGUtc3dpdGNoIC5tc2Iub246aG92ZXJ7YmFja2dyb3VuZDp2YXIoLS1heC1ncmVlbik7Y29sb3I6I2ZmZjt9CiAgLyog66eI7Jqw7IqkIOyYpOuyhCDsi5zsl5Drp4wg64KY7YOA64KY64qUIOudvOuyqCDtiLTtjIEgKi8KICAubW9kZS1zd2l0Y2ggLm1zYiAubXNiLXRpcHtwb3NpdGlvbjphYnNvbHV0ZTtib3R0b206Y2FsYygxMDAlICsgNnB4KTtsZWZ0OjUwJTt0cmFuc2Zvcm06dHJhbnNsYXRlWCgtNTAlKTsKICAgIGJhY2tncm91bmQ6dmFyKC0tYXgtbmF2eSk7Y29sb3I6I2ZmZjtmb250LXNpemU6MTFweDtmb250LXdlaWdodDo2MDA7bGluZS1oZWlnaHQ6MTt3aGl0ZS1zcGFjZTpub3dyYXA7CiAgICBwYWRkaW5nOjVweCA4cHg7Ym9yZGVyLXJhZGl1czo1cHg7b3BhY2l0eTowO3Zpc2liaWxpdHk6aGlkZGVuO3BvaW50ZXItZXZlbnRzOm5vbmU7dHJhbnNpdGlvbjpvcGFjaXR5IC4xMnM7ei1pbmRleDo1MDt9CiAgLm1vZGUtc3dpdGNoIC5tc2IgLm1zYi10aXA6OmFmdGVye2NvbnRlbnQ6IiI7cG9zaXRpb246YWJzb2x1dGU7dG9wOjEwMCU7bGVmdDo1MCU7dHJhbnNmb3JtOnRyYW5zbGF0ZVgoLTUwJSk7CiAgICBib3JkZXI6NHB4IHNvbGlkIHRyYW5zcGFyZW50O2JvcmRlci10b3AtY29sb3I6dmFyKC0tYXgtbmF2eSk7fQogIC5tb2RlLXN3aXRjaCAubXNiOmhvdmVyIC5tc2ItdGlwe29wYWNpdHk6MTt2aXNpYmlsaXR5OnZpc2libGU7fQogIC50bXBsLWdyaWR7ZGlzcGxheTpncmlkO2dyaWQtdGVtcGxhdGUtY29sdW1uczpyZXBlYXQoMywxZnIpO2dhcDoxMHB4O21hcmdpbi10b3A6MTRweDt9CiAgLnRtcGwtY2FyZHtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWF4LWJvcmRlcik7Ym9yZGVyLXJhZGl1czo4cHg7cGFkZGluZzoxMnB4O2N1cnNvcjpwb2ludGVyO3RyYW5zaXRpb246LjEycztiYWNrZ3JvdW5kOiNmYWZiZmM7fQogIC50bXBsLWNhcmQ6aG92ZXJ7Ym9yZGVyLWNvbG9yOnZhcigtLWF4LWdyZWVuKTtiYWNrZ3JvdW5kOnZhcigtLWF4LWdyZWVuLWxpZ2h0KTt9CiAgLnRtcGwtY2FyZCAudGl7Zm9udC1zaXplOjEzcHg7Zm9udC13ZWlnaHQ6NzAwO2NvbG9yOnZhcigtLWF4LW5hdnkpO21hcmdpbi1ib3R0b206NHB4O30KICAudG1wbC1jYXJkIC50ZHtmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS1heC1ncmF5KTtsaW5lLWhlaWdodDoxLjQ7fQogIC50bXBsLWNhcmQgLnR3e2Rpc3BsYXk6aW5saW5lLWJsb2NrO21hcmdpbi10b3A6NnB4O2ZvbnQtc2l6ZToxMHB4O2NvbG9yOiNiODg2MGI7YmFja2dyb3VuZDojZmZmN2UwO2JvcmRlcjoxcHggc29saWQgI2YwZGNhMDtib3JkZXItcmFkaXVzOjRweDtwYWRkaW5nOjFweCA2cHg7fQogIC8qIOyDgeuLqCDroZzqs6Ag7YG066atIOyLnCDrnKjripQgVGhpbi9GYXQg66qo65OcIOyEoO2DnSDtjJ3sl4UgKi8KICAuc2tpbi1waWNrLWdyaWR7ZGlzcGxheTpncmlkO2dyaWQtdGVtcGxhdGUtY29sdW1uczoxZnIgMWZyO2dhcDoxNnB4O21hcmdpbi10b3A6NHB4O30KICAuc2tpbi1waWNrLWNhcmR7cG9zaXRpb246cmVsYXRpdmU7Ym9yZGVyOjJweCBzb2xpZCB2YXIoLS1heC1ib3JkZXIpO2JvcmRlci1yYWRpdXM6MTBweDtwYWRkaW5nOjE0cHg7Y3Vyc29yOnBvaW50ZXI7CiAgICB0ZXh0LWFsaWduOmNlbnRlcjt0cmFuc2l0aW9uOi4xMnM7YmFja2dyb3VuZDojZmFmYmZjO30KICAuc2tpbi1waWNrLWNhcmQ6aG92ZXJ7Ym9yZGVyLWNvbG9yOnZhcigtLXNlbCk7dHJhbnNmb3JtOnRyYW5zbGF0ZVkoLTFweCk7Ym94LXNoYWRvdzowIDRweCAxMnB4IHJnYmEoMCwwLDAsLjA4KTt9CiAgLnNraW4tcGljay1jYXJkLm9ue2JvcmRlci1jb2xvcjp2YXIoLS1zZWwpO2JhY2tncm91bmQ6I2VlZjVmZjt9CiAgLnNraW4tcGljay1jYXJkLm9uIC5za2luLXBpY2stdGFne2Rpc3BsYXk6aW5saW5lLWJsb2NrO30KICAuc2tpbi1waWNrLXN3YXRjaHt3aWR0aDoxMDAlO2FzcGVjdC1yYXRpbzo0LzM7Ym9yZGVyOjFweCBzb2xpZCAjZDlkZWUzO2JvcmRlci1yYWRpdXM6NnB4O292ZXJmbG93OmhpZGRlbjttYXJnaW4tYm90dG9tOjEwcHg7Ym94LXNoYWRvdzppbnNldCAwIDAgMCAxcHggcmdiYSgwLDAsMCwuMDIpO30KICAuc3B3LWhlYWR7aGVpZ2h0OjIyJTt9CiAgLnNwdy1ib2R5e3BhZGRpbmc6MTAlO2Rpc3BsYXk6ZmxleDtmbGV4LWRpcmVjdGlvbjpjb2x1bW47Z2FwOjEwJTtoZWlnaHQ6NzglO2JveC1zaXppbmc6Ym9yZGVyLWJveDt9CiAgLnNwdy1sYWJlbHt3aWR0aDo0MCU7aGVpZ2h0OjEyJTtib3JkZXItcmFkaXVzOjJweDt9CiAgLnNwdy1maWVsZHt3aWR0aDoxMDAlO2hlaWdodDoyMiU7Ym9yZGVyOjFweCBzb2xpZDtib3JkZXItcmFkaXVzOjNweDt9CiAgLnNwdy1idG57d2lkdGg6MzIlO2hlaWdodDoxNiU7Ym9yZGVyLXJhZGl1czozcHg7YWxpZ24tc2VsZjpmbGV4LWVuZDt9CiAgLnNraW4tcGljay1uYW1le2ZvbnQtc2l6ZToxNHB4O2ZvbnQtd2VpZ2h0OjgwMDtjb2xvcjp2YXIoLS1heC1uYXZ5KTt9CiAgLnNraW4tcGljay10YWd7ZGlzcGxheTpub25lO21hcmdpbi10b3A6N3B4O2ZvbnQtc2l6ZToxMHB4O2ZvbnQtd2VpZ2h0OjcwMDtjb2xvcjojMWY2ZmQ2O2JhY2tncm91bmQ6I2UzZjBmZjtib3JkZXI6MXB4IHNvbGlkICNiZmRjZmI7Ym9yZGVyLXJhZGl1czoxMHB4O3BhZGRpbmc6MnB4IDlweDt9CiAgLnRvb2x7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6OHB4O3BhZGRpbmc6NnB4IDlweDtiYWNrZ3JvdW5kOiNmYWZiZmM7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1heC1ib3JkZXIpO2JvcmRlci1yYWRpdXM6NXB4O21hcmdpbi1ib3R0b206NXB4O2ZvbnQtc2l6ZToxMnB4O3RyYW5zaXRpb246LjEyczsKICAgIGN1cnNvcjp1cmwoImRhdGE6aW1hZ2Uvc3ZnK3htbDt1dGY4LDxzdmcgeG1sbnM9J2h0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnJyB3aWR0aD0nMjYnIGhlaWdodD0nMjYnIHZpZXdCb3g9JzAgMCAyNiAyNic+PGcgdHJhbnNmb3JtPSd0cmFuc2xhdGUoMywyKSc+PHBhdGggZD0nTTIgMSBMMiAxNSBMNS42IDExLjcgTDguMiAxNy42IEwxMSAxNi4zIEw4LjQgMTAuNiBMMTMgMTAuMyBaJyBmaWxsPSclMjNmZmZmZmYnIHN0cm9rZT0nJTIzMTExMTExJyBzdHJva2Utd2lkdGg9JzEuNicgc3Ryb2tlLWxpbmVqb2luPSdyb3VuZCcvPjwvZz48L3N2Zz4iKSA1IDMsIGdyYWI7fQogIC50b29sOmhvdmVye2JvcmRlci1jb2xvcjp2YXIoLS1heC1ncmVlbik7YmFja2dyb3VuZDp2YXIoLS1heC1ncmVlbi1saWdodCk7fQogIC50b29sOmFjdGl2ZXtjdXJzb3I6dXJsKCJkYXRhOmltYWdlL3N2Zyt4bWw7dXRmOCw8c3ZnIHhtbG5zPSdodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2Zycgd2lkdGg9JzI2JyBoZWlnaHQ9JzI2JyB2aWV3Qm94PScwIDAgMjYgMjYnPjxnIHRyYW5zZm9ybT0ndHJhbnNsYXRlKDMsMiknPjxwYXRoIGQ9J00yIDEgTDIgMTUgTDUuNiAxMS43IEw4LjIgMTcuNiBMMTEgMTYuMyBMOC40IDEwLjYgTDEzIDEwLjMgWicgZmlsbD0nJTIzMWU5ZTZhJyBzdHJva2U9JyUyM2ZmZmZmZicgc3Ryb2tlLXdpZHRoPScxLjYnIHN0cm9rZS1saW5lam9pbj0ncm91bmQnLz48L2c+PC9zdmc+IikgNSAzLCBncmFiYmluZzt9CiAgLnRvb2wgLmlje3dpZHRoOjE2cHg7dGV4dC1hbGlnbjpjZW50ZXI7Y29sb3I6dmFyKC0tYXgtZ3JlZW4pO2ZvbnQtd2VpZ2h0OjcwMDt9CiAgLnRvb2xib3guY2xpY2stcGxhY2Utb24gLnRvb2x7Y3Vyc29yOnVybCgiZGF0YTppbWFnZS9zdmcreG1sO3V0ZjgsPHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHdpZHRoPScyNicgaGVpZ2h0PScyNicgdmlld0JveD0nMCAwIDI2IDI2Jz48ZyB0cmFuc2Zvcm09J3RyYW5zbGF0ZSgzLDIpJz48cGF0aCBkPSdNMiAxIEwyIDE1IEw1LjYgMTEuNyBMOC4yIDE3LjYgTDExIDE2LjMgTDguNCAxMC42IEwxMyAxMC4zIFonIGZpbGw9JyUyM2ZmZmZmZicgc3Ryb2tlPSclMjMxMTExMTEnIHN0cm9rZS13aWR0aD0nMS42JyBzdHJva2UtbGluZWpvaW49J3JvdW5kJy8+PC9nPjwvc3ZnPiIpIDUgMywgcG9pbnRlcjt9CiAgLnRvb2wuYXJtZWR7Ym9yZGVyLWNvbG9yOnZhcigtLWF4LWdyZWVuKTtiYWNrZ3JvdW5kOnZhcigtLWF4LWdyZWVuLWRhcmspO2NvbG9yOiNmZmY7fQogIC50b29sLmFybWVkIC5pY3tjb2xvcjojZmZmO30KICAvKiBGYXQgTW9kZeyXkOyEnOuKlCDrj4Tqtazsg4HsnpDsl5DshJwg7KGw7ZqM7KGw6rG0IO2MqOuEkCDtla3rqqnsnYQg7Iio6ri064ukLiBUaGluIE1vZGXripQg6re464yA66GcIOuFuOy2nC4gKi8KICBib2R5LnNraW4tY2xhc3NpYyAudG9vbGJveCAudG9vbFtkYXRhLXR5cGU9InNlYXJjaGJhciJde2Rpc3BsYXk6bm9uZTt9CiAgLyog7Yyd7JeF7J2AIO2Mu+uqqOuTnCDsoITsmqkg7Lu07Y+s64SM7Yq46528IOyUrOuqqOuTnCDrj4Tqtazsg4HsnpDsl5DshJzripQg7Iio6ri064ukLiAqLwogIGJvZHk6bm90KC5za2luLWNsYXNzaWMpIC50b29sYm94IC50b29sW2RhdGEtdHlwZT0icG9wdXAiXXtkaXNwbGF5Om5vbmU7fQogIC8qIOyDgeuLqOuwlOydmCDthZztlIzrpr8g67KE7Yq87J2AIOyUrOuqqOuTnMK37Yy766qo65OcIOuqqOuRkOyXkOyEnCDsiKjquLTri6QuICovCiAgI3RlbXBsYXRlQnRue2Rpc3BsYXk6bm9uZTt9CiAgLnRvb2xib3guY2xpY2stcGxhY2Utb24gLnRvb2wuYXJtZWR7Y3Vyc29yOnVybCgiZGF0YTppbWFnZS9zdmcreG1sO3V0ZjgsPHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHdpZHRoPScyNicgaGVpZ2h0PScyNicgdmlld0JveD0nMCAwIDI2IDI2Jz48ZyB0cmFuc2Zvcm09J3RyYW5zbGF0ZSgzLDIpJz48cGF0aCBkPSdNMiAxIEwyIDE1IEw1LjYgMTEuNyBMOC4yIDE3LjYgTDExIDE2LjMgTDguNCAxMC42IEwxMyAxMC4zIFonIGZpbGw9JyUyM2ZmZTY4MCcgc3Ryb2tlPSclMjMxMTExMTEnIHN0cm9rZS13aWR0aD0nMS44JyBzdHJva2UtbGluZWpvaW49J3JvdW5kJy8+PC9nPjwvc3ZnPiIpIDUgMywgcG9pbnRlcjt9CiAgI2NhbnZhcy5jbGljay1wbGFjZS1hcm1lZHtjdXJzb3I6Y3Jvc3NoYWlyO30KCiAgLyogQ2FudmFzICovCiAgLmNhbnZhcy13cmFwe2Rpc3BsYXk6ZmxleDtmbGV4LWRpcmVjdGlvbjpjb2x1bW47cG9zaXRpb246cmVsYXRpdmU7b3ZlcmZsb3c6aGlkZGVuO3BhZGRpbmc6MDt9CiAgLnRvb2xiYXIye2Rpc3BsYXk6ZmxleDtnYXA6NnB4O2FsaWduLWl0ZW1zOmNlbnRlcjtmbGV4LXdyYXA6d3JhcDtmbGV4Om5vbmU7YmFja2dyb3VuZDojZmZmO3BhZGRpbmc6MTJweCAyMHB4O2JvcmRlci1ib3R0b206MXB4IHNvbGlkIHZhcigtLWF4LWJvcmRlcik7Ym94LXNoYWRvdzowIDJweCA0cHggcmdiYSgwLDAsMCwuMDQpO30KICAuY2FudmFzLXNjcm9sbHtmbGV4OjE7bWluLWhlaWdodDowO292ZXJmbG93OmF1dG87cGFkZGluZzoyMHB4O30KICAudG9vbGJhcjIgbGFiZWx7Zm9udC1zaXplOjEycHg7Y29sb3I6dmFyKC0tYXgtZ3JheSk7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6NHB4O30KICAudG9vbGJhcjIgc2VsZWN0LC50b29sYmFyMiBpbnB1dFt0eXBlPW51bWJlcl17cGFkZGluZzo0cHggNnB4O2JvcmRlcjoxcHggc29saWQgdmFyKC0tYXgtYm9yZGVyKTtib3JkZXItcmFkaXVzOjRweDtmb250LXNpemU6MTJweDt9CiAgLnRvb2xiYXIyIC5jaGt7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6NHB4O30KICAjY2FudmFze3Bvc2l0aW9uOnJlbGF0aXZlO2JhY2tncm91bmQ6dmFyKC0tYXgtY2FudmFzLWJnKTtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWF4LWJvcmRlcik7Ym9yZGVyLXJhZGl1czo2cHg7Ym94LXNoYWRvdzowIDFweCA0cHggcmdiYSgwLDAsMCwuMDYpO3dpZHRoOjExMDBweDtoZWlnaHQ6NzAwcHg7CiAgICBiYWNrZ3JvdW5kLWltYWdlOmxpbmVhci1ncmFkaWVudCh2YXIoLS1heC1ncmlkLWxpbmUpIDFweCx0cmFuc3BhcmVudCAxcHgpLGxpbmVhci1ncmFkaWVudCg5MGRlZyx2YXIoLS1heC1ncmlkLWxpbmUpIDFweCx0cmFuc3BhcmVudCAxcHgpO2JhY2tncm91bmQtc2l6ZToxMHB4IDEwcHg7fQogICNjYW52YXMubm9ncmlke2JhY2tncm91bmQtaW1hZ2U6bm9uZTt9CiAgLmNhbnZhcy1ob2xkZXJ7cG9zaXRpb246cmVsYXRpdmU7ei1pbmRleDoxO2Rpc3BsYXk6aW5saW5lLWJsb2NrO30KICAudGItc2Vwe3dpZHRoOjFweDtoZWlnaHQ6MTZweDtiYWNrZ3JvdW5kOnZhcigtLWF4LWJvcmRlcik7ZGlzcGxheTppbmxpbmUtYmxvY2s7bWFyZ2luOjAgMnB4O30KICAuem9vbS1ib3h7ZGlzcGxheTppbmxpbmUtZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjNweDt9CiAgLnpvb20tYnRue3dpZHRoOjI0cHg7aGVpZ2h0OjI0cHg7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1heC1ib3JkZXIpO2JhY2tncm91bmQ6I2ZmZjtib3JkZXItcmFkaXVzOjRweDtjdXJzb3I6cG9pbnRlcjtmb250LXNpemU6MTNweDtmb250LXdlaWdodDo3MDA7Y29sb3I6IzQ0NDtsaW5lLWhlaWdodDoxO2Rpc3BsYXk6aW5saW5lLWZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2p1c3RpZnktY29udGVudDpjZW50ZXI7cGFkZGluZzowO30KICAuem9vbS1idG4ud2lkZXt3aWR0aDphdXRvO3BhZGRpbmc6MCA3cHg7Zm9udC1zaXplOjExcHg7Zm9udC13ZWlnaHQ6NjAwO30KICAuem9vbS1idG46aG92ZXJ7Ym9yZGVyLWNvbG9yOnZhcigtLWF4LWdyZWVuKTtjb2xvcjp2YXIoLS1heC1ncmVlbi1kYXJrKTt9CiAgLnpvb20tc2Vse2hlaWdodDoyNHB4O2JvcmRlcjoxcHggc29saWQgdmFyKC0tYXgtYm9yZGVyKTtib3JkZXItcmFkaXVzOjRweDtiYWNrZ3JvdW5kOiNmZmY7Zm9udC1zaXplOjExcHg7cGFkZGluZzowIDJweDtjdXJzb3I6cG9pbnRlcjt9CiAgLmd1aWRlLWJ0bntiYWNrZ3JvdW5kOiNmZmYhaW1wb3J0YW50O2JvcmRlcjpub25lO2ZvbnQtc2l6ZToxNHB4O2N1cnNvcjpwb2ludGVyO3BhZGRpbmc6MCFpbXBvcnRhbnQ7bGluZS1oZWlnaHQ6MTttYXJnaW4tbGVmdDoycHg7Ym9yZGVyLXJhZGl1czo2cHg7d2lkdGg6MzBweDtoZWlnaHQ6MjJweDtkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2p1c3RpZnktY29udGVudDpjZW50ZXI7Ym94LXNoYWRvdzowIDFweCAzcHggcmdiYSgwLDAsMCwuMjUpO29wYWNpdHk6MTt9CiAgLmd1aWRlLWJ0bjpob3Zlcnt0cmFuc2Zvcm06c2NhbGUoMS4wNik7Ym94LXNoYWRvdzowIDJweCA1cHggcmdiYSgwLDAsMCwuMyk7fQogIC51cGQtYnRue2Rpc3BsYXk6bm9uZTtiYWNrZ3JvdW5kOiNlODU5MGMhaW1wb3J0YW50O2NvbG9yOiNmZmY7Ym9yZGVyOm5vbmU7Ym9yZGVyLXJhZGl1czo2cHg7Zm9udC1zaXplOjEycHg7Zm9udC13ZWlnaHQ6NzAwO2N1cnNvcjpwb2ludGVyO3BhZGRpbmc6NXB4IDEwcHghaW1wb3J0YW50O2xpbmUtaGVpZ2h0OjE7bWFyZ2luLWxlZnQ6NnB4O2JveC1zaGFkb3c6MCAwIDAgMCByZ2JhKDIzMiw4OSwxMiwuNik7YW5pbWF0aW9uOnVwZFB1bHNlIDEuOHMgaW5maW5pdGU7fQogIC51cGQtYnRuOmhvdmVye2JhY2tncm91bmQ6I2Q5NDgwZiFpbXBvcnRhbnQ7fQogIEBrZXlmcmFtZXMgdXBkUHVsc2V7MCV7Ym94LXNoYWRvdzowIDAgMCAwIHJnYmEoMjMyLDg5LDEyLC41NSk7fTcwJXtib3gtc2hhZG93OjAgMCAwIDhweCByZ2JhKDIzMiw4OSwxMiwwKTt9MTAwJXtib3gtc2hhZG93OjAgMCAwIDAgcmdiYSgyMzIsODksMTIsMCk7fX0KICAuYXV0b3NhdmUtbWFya3tmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS1hdXRvc2F2ZS1mZyk7b3BhY2l0eTowO3RyYW5zaXRpb246b3BhY2l0eSAuM3M7d2hpdGUtc3BhY2U6bm93cmFwO2FsaWduLXNlbGY6Y2VudGVyO30KICAuYXV0b3NhdmUtbWFyay5vbntvcGFjaXR5OjE7fQogIC8qIGNvbGxhcHNlIGVudGlyZWx5IHdoaWxlIGVtcHR5IHNvIGl0IGRvZXNuJ3QgYWRkIGdhcHMgYmV0d2VlbiBidXR0b25zICovCiAgLmF1dG9zYXZlLW1hcms6ZW1wdHl7ZGlzcGxheTpub25lO30KICAvKiBwYXRjaCBub3RlcyAqLwogIC5wdC12ZXJ7Zm9udC1zaXplOjEycHg7Y29sb3I6dmFyKC0tYXgtZ3JlZW4tZGFyayk7Zm9udC13ZWlnaHQ6NzAwO2JhY2tncm91bmQ6dmFyKC0tYXgtZ3JlZW4tbGlnaHQpO2Rpc3BsYXk6aW5saW5lLWJsb2NrO3BhZGRpbmc6NHB4IDEwcHg7Ym9yZGVyLXJhZGl1czoyMHB4O21hcmdpbi1ib3R0b206MTRweDt9CiAgLyogb25lIGJsb2NrIHBlciBwYXN0IHJlbGVhc2UgaW4gdGhlIGhpc3RvcnkgdGFiICovCiAgLnB0LXJlbHtwYWRkaW5nLWJvdHRvbTo2cHg7bWFyZ2luLWJvdHRvbToxNnB4O2JvcmRlci1ib3R0b206MnB4IHNvbGlkICNlZWYxZjQ7fQogIC5wdC1yZWw6bGFzdC1jaGlsZHtib3JkZXItYm90dG9tOm5vbmU7bWFyZ2luLWJvdHRvbTowO30KICAucHQtcmVsIC5wdC12ZXJ7YmFja2dyb3VuZDojZWVmMWY0O2NvbG9yOiM1YjZiN2M7fQogIC8qIGhpc3RvcnkgY2FuIGdyb3cgbG9uZyAtIGtlZXAgdGhlIGRpYWxvZyBhIHNlbnNpYmxlIGhlaWdodCAqLwogICNwYXRjaEJvZHl7bWF4LWhlaWdodDo1MnZoO292ZXJmbG93LXk6YXV0bzt9CiAgLnB0LXZlciBzcGFue2NvbG9yOiM4YTk0OWM7Zm9udC13ZWlnaHQ6NTAwO21hcmdpbi1sZWZ0OjZweDt9CiAgLyogRGF0ZS1ncm91cGVkIGxheW91dDogb25lIGRhdGUgaGVhZGVyLCB0aGVuIGVhY2ggYnVpbGQgKC5OTk4pIGFzIGEgc3ViLXNlY3Rpb24uICovCiAgLnB0LWRheXttYXJnaW4tYm90dG9tOjE4cHg7fQogIC5wdC1kYXk6bGFzdC1jaGlsZHttYXJnaW4tYm90dG9tOjA7fQogIC5wdC1kYXktaGR7Zm9udC1zaXplOjEzcHg7Zm9udC13ZWlnaHQ6ODAwO2NvbG9yOnZhcigtLWF4LW5hdnkpO2JhY2tncm91bmQ6dmFyKC0tYXgtZ3JlZW4tbGlnaHQpOwogICAgZGlzcGxheTppbmxpbmUtYmxvY2s7cGFkZGluZzo1cHggMTJweDtib3JkZXItcmFkaXVzOjIwcHg7bWFyZ2luLWJvdHRvbToxMnB4O30KICAucHQtYnVpbGR7cGFkZGluZy1sZWZ0OjEycHg7Ym9yZGVyLWxlZnQ6M3B4IHNvbGlkICNlMmU4ZWU7bWFyZ2luOjAgMCAxNHB4IDJweDt9CiAgLnB0LWJ1aWxkOmxhc3QtY2hpbGR7bWFyZ2luLWJvdHRvbTowO30KICAucHQtYnVpbGQtaGR7Zm9udC1zaXplOjExLjVweDtmb250LXdlaWdodDo3MDA7Y29sb3I6dmFyKC0tYXgtZ3JlZW4tZGFyayk7CiAgICBiYWNrZ3JvdW5kOiNlZWY2ZjE7ZGlzcGxheTppbmxpbmUtYmxvY2s7cGFkZGluZzoycHggOXB4O2JvcmRlci1yYWRpdXM6MTJweDttYXJnaW4tYm90dG9tOjlweDt9CiAgLnB0LWRheS5oaXN0b3J5IC5wdC1kYXktaGR7YmFja2dyb3VuZDojZWVmMWY0O2NvbG9yOiM1YjZiN2M7fQogIC5wdC1kYXkuaGlzdG9yeSAucHQtYnVpbGQtaGR7YmFja2dyb3VuZDojZWVmMWY0O2NvbG9yOiM2Yjc0ODA7fQogIC5wdC1pdGVte21hcmdpbi1ib3R0b206MTNweDtwYWRkaW5nLWJvdHRvbToxMnB4O2JvcmRlci1ib3R0b206MXB4IHNvbGlkICNmMmY0ZjY7fQogIC5wdC1pdGVtOmxhc3QtY2hpbGR7Ym9yZGVyLWJvdHRvbTpub25lO21hcmdpbi1ib3R0b206MDt9CiAgLnB0LXR7Zm9udC1zaXplOjEzLjVweDtmb250LXdlaWdodDo3MDA7Y29sb3I6dmFyKC0tYXgtbmF2eSk7bWFyZ2luLWJvdHRvbTo0cHg7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6N3B4O30KICAucHQtYmFkZ2V7Zm9udC1zaXplOjEwcHg7Zm9udC13ZWlnaHQ6NzAwO3BhZGRpbmc6MnB4IDZweDtib3JkZXItcmFkaXVzOjNweDtsZXR0ZXItc3BhY2luZzouM3B4O30KICAucHQtYmFkZ2UubmV3e2JhY2tncm91bmQ6I2U2ZjRlZDtjb2xvcjp2YXIoLS1heC1ncmVlbi1kYXJrKTt9CiAgLnB0LWl0ZW0gcHttYXJnaW46MDtmb250LXNpemU6MTIuNXB4O2NvbG9yOiM1YTY1NzA7bGluZS1oZWlnaHQ6MS42NTt9CiAgLnB0LWZvb3R7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtqdXN0aWZ5LWNvbnRlbnQ6c3BhY2UtYmV0d2Vlbjt9CiAgLnB0LWhpZGV7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6NnB4O2ZvbnQtc2l6ZToxMnB4O2NvbG9yOiM2Yjc0ODA7Y3Vyc29yOnBvaW50ZXI7dXNlci1zZWxlY3Q6bm9uZTt9CiAgLnB0LWhpZGUgaW5wdXR7Y3Vyc29yOnBvaW50ZXI7fQogIC8qIHVzZXIgZ3VpZGUgKi8KICAuZ2QtdGFiYm9keXtoZWlnaHQ6NTYwcHg7b3ZlcmZsb3cteTphdXRvO3BhZGRpbmctcmlnaHQ6NHB4O30KICAuZ2QtaW50cm97YmFja2dyb3VuZDp2YXIoLS1heC1ncmVlbi1saWdodCk7Ym9yZGVyLWxlZnQ6M3B4IHNvbGlkIHZhcigtLWF4LWdyZWVuKTtwYWRkaW5nOjExcHggMTNweDtib3JkZXItcmFkaXVzOjVweDtmb250LXNpemU6MTNweDtjb2xvcjojMWYzZDMxO21hcmdpbi1ib3R0b206MTZweDtsaW5lLWhlaWdodDoxLjY7fQogIC5nZC1zdGVwe2Rpc3BsYXk6ZmxleDtnYXA6MTFweDttYXJnaW4tYm90dG9tOjEzcHg7fQogIC5nZC1ue3dpZHRoOjI0cHg7aGVpZ2h0OjI0cHg7ZmxleDpub25lO2JvcmRlci1yYWRpdXM6NTAlO2JhY2tncm91bmQ6dmFyKC0tYXgtZ3JlZW4pO2NvbG9yOiNmZmY7Zm9udC1zaXplOjEycHg7Zm9udC13ZWlnaHQ6NzAwO2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcjttYXJnaW4tdG9wOjFweDt9CiAgLmdkLWMgaDR7bWFyZ2luOjJweCAwIDVweDtmb250LXNpemU6MTRweDtjb2xvcjp2YXIoLS1heC1uYXZ5KTt9CiAgLmdkLWMgcHttYXJnaW46MCAwIDRweDtmb250LXNpemU6MTIuNXB4O2NvbG9yOiM0YjU1NjM7bGluZS1oZWlnaHQ6MS42NTt9CiAgLmdkLXRpcHtiYWNrZ3JvdW5kOiNmN2Y5ZmE7Ym9yZGVyLXJhZGl1czo0cHg7cGFkZGluZzo2cHggOXB4O2NvbG9yOiM1YTY1NzAhaW1wb3J0YW50O30KICAuZ2QtaHtmb250LXNpemU6MTNweDtjb2xvcjp2YXIoLS1heC1uYXZ5KTttYXJnaW46MjBweCAwIDlweDtwYWRkaW5nLWJvdHRvbTo2cHg7Ym9yZGVyLWJvdHRvbToxcHggc29saWQgdmFyKC0tYXgtYm9yZGVyKTt9CiAgLmdkLXRibHt3aWR0aDoxMDAlO2JvcmRlci1jb2xsYXBzZTpjb2xsYXBzZTtmb250LXNpemU6MTIuNXB4O30KICAuZ2QtdGJsIHRke3BhZGRpbmc6N3B4IDhweDtib3JkZXItYm90dG9tOjFweCBzb2xpZCAjZjBmMmY0O2NvbG9yOiM0YjU1NjM7bGluZS1oZWlnaHQ6MS41NTt9CiAgLmdkLXRibCB0ZC5re3dpZHRoOjExMHB4O2NvbG9yOnZhcigtLWF4LW5hdnkpO2ZvbnQtd2VpZ2h0OjYwMDtiYWNrZ3JvdW5kOiNmYWZiZmM7fQogIC5nZC1jYXJkc3tkaXNwbGF5OmdyaWQ7Z3JpZC10ZW1wbGF0ZS1jb2x1bW5zOjFmciAxZnI7Z2FwOjEwcHg7fQogIC5nZC1jYXJke2JvcmRlcjoxcHggc29saWQgdmFyKC0tYXgtYm9yZGVyKTtib3JkZXItcmFkaXVzOjdweDtwYWRkaW5nOjExcHggMTNweDtiYWNrZ3JvdW5kOiNmYWZiZmM7fQogIC5nZC1jYXJkLXR7Zm9udC1zaXplOjEzcHg7Zm9udC13ZWlnaHQ6NzAwO2NvbG9yOnZhcigtLWF4LW5hdnkpO21hcmdpbi1ib3R0b206NXB4O30KICAuZ2QtY2FyZCBwe21hcmdpbjowO2ZvbnQtc2l6ZToxMnB4O2NvbG9yOiM1YTY1NzA7bGluZS1oZWlnaHQ6MS42O30KICAuZ2QtZmFxIHB7bWFyZ2luOjAgMCAxMHB4O2ZvbnQtc2l6ZToxMi41cHg7Y29sb3I6IzRiNTU2MztsaW5lLWhlaWdodDoxLjc7fQogICNjYW52YXNSZXNpemV7cG9zaXRpb246YWJzb2x1dGU7cmlnaHQ6LTNweDtib3R0b206LTNweDt3aWR0aDoxOHB4O2hlaWdodDoxOHB4O2N1cnNvcjpud3NlLXJlc2l6ZTt6LWluZGV4OjcwMDsKICAgIGJhY2tncm91bmQ6bGluZWFyLWdyYWRpZW50KDEzNWRlZyx0cmFuc3BhcmVudCA0NSUsdmFyKC0tYXgtZ3JlZW4pIDQ1JSx2YXIoLS1heC1ncmVlbikgNTUlLHRyYW5zcGFyZW50IDU1JSx0cmFuc3BhcmVudCA3MCUsdmFyKC0tYXgtZ3JlZW4pIDcwJSx2YXIoLS1heC1ncmVlbikgODAlLHRyYW5zcGFyZW50IDgwJSk7CiAgICBib3JkZXItcmFkaXVzOjAgMCA1cHggMDt9CiAgI2NhbnZhc1Jlc2l6ZTpob3ZlcntmaWx0ZXI6YnJpZ2h0bmVzcyguODUpO30KICAuY2FudmFzLWhvbGRlci5yZXNpemluZyAjY2FudmFze291dGxpbmU6MnB4IGRhc2hlZCB2YXIoLS1heC1ncmVlbik7b3V0bGluZS1vZmZzZXQ6MXB4O30KICAuZ3VpZGVsaW5le3Bvc2l0aW9uOmFic29sdXRlO2JhY2tncm91bmQ6I2ZmM2I3Zjt6LWluZGV4OjkwMDtwb2ludGVyLWV2ZW50czpub25lO30KICAuZ3VpZGVsaW5lLnZ7d2lkdGg6MXB4O3RvcDowO2JvdHRvbTowO2JveC1zaGFkb3c6MCAwIDAgLjVweCByZ2JhKDI1NSw1OSwxMjcsLjMpO30KICAuZ3VpZGVsaW5lLmh7aGVpZ2h0OjFweDtsZWZ0OjA7cmlnaHQ6MDtib3gtc2hhZG93OjAgMCAwIC41cHggcmdiYSgyNTUsNTksMTI3LC4zKTt9CiAgI3NlbGJveHtwb3NpdGlvbjphYnNvbHV0ZTtib3JkZXI6MXB4IHNvbGlkIHZhcigtLXNlbCk7YmFja2dyb3VuZDpyZ2JhKDM4LDEyOCwyMzUsLjEyKTt6LWluZGV4OjcxMDtwb2ludGVyLWV2ZW50czpub25lO2Rpc3BsYXk6bm9uZTt9CiAgLmdsLWRpc3R7cG9zaXRpb246YWJzb2x1dGU7YmFja2dyb3VuZDojZmYzYjdmO2NvbG9yOiNmZmY7Zm9udC1zaXplOjEwcHg7cGFkZGluZzoxcHggNHB4O2JvcmRlci1yYWRpdXM6M3B4O3otaW5kZXg6OTAxO3BvaW50ZXItZXZlbnRzOm5vbmU7d2hpdGUtc3BhY2U6bm93cmFwO30KICAvKiBHaG9zdCBwcmV2aWV3IHNob3duIHdoaWxlIGRyYWdnaW5nIGEgbmV3IGNvbXBvbmVudCBmcm9tIHRoZSB0b29sYm94ICovCiAgI2Ryb3BHaG9zdHtwb3NpdGlvbjphYnNvbHV0ZTt6LWluZGV4OjkwNTtwb2ludGVyLWV2ZW50czpub25lO2Rpc3BsYXk6bm9uZTtib3gtc2l6aW5nOmJvcmRlci1ib3g7CiAgICBib3JkZXI6MS41cHggZGFzaGVkIHZhcigtLWF4LWdyZWVuKTtib3JkZXItcmFkaXVzOjVweDtiYWNrZ3JvdW5kOnJnYmEoMzAsMTU4LDEwNiwuMTApOwogICAgYWxpZ24taXRlbXM6Y2VudGVyO2p1c3RpZnktY29udGVudDpjZW50ZXI7Z2FwOjZweDsKICAgIGZvbnQtc2l6ZToxMnB4O2ZvbnQtd2VpZ2h0OjYwMDtjb2xvcjp2YXIoLS1heC1ncmVlbi1kYXJrKTtvdmVyZmxvdzpoaWRkZW47cGFkZGluZzowIDhweDt9CiAgI2Ryb3BHaG9zdC5vbntkaXNwbGF5OmZsZXg7fQogICNkcm9wR2hvc3QgLmRnLWlje2ZvbnQtd2VpZ2h0OjcwMDt9CgogIC8qIENvbXBvbmVudCBiYXNlICovCiAgLmNtcHtwb3NpdGlvbjphYnNvbHV0ZTtjdXJzb3I6bW92ZTt1c2VyLXNlbGVjdDpub25lO30KICAuY21wLnNlbGVjdGVke291dGxpbmU6MnB4IHNvbGlkIHZhcigtLXNlbCk7b3V0bGluZS1vZmZzZXQ6MXB4O30KICAuY21wIC5oYW5kbGV7cG9zaXRpb246YWJzb2x1dGU7d2lkdGg6OXB4O2hlaWdodDo5cHg7YmFja2dyb3VuZDojZmZmO2JvcmRlcjoxLjVweCBzb2xpZCB2YXIoLS1zZWwpO2JvcmRlci1yYWRpdXM6MnB4O2Rpc3BsYXk6bm9uZTt6LWluZGV4OjYwO30KICAuY21wLnNlbGVjdGVkIC5oYW5kbGV7ZGlzcGxheTpibG9jazt9CiAgLyogRmlsbC1kb2NrZWQgc3BsaXQtcGFuZSBjaGlsZHJlbiAoLmxvY2tlZCkgc2l0IGZsdXNoIGFnYWluc3QgdGhlaXIgcGFuZSdzIGVkZ2VzLCBzbyB0aGUKICAgICBvdXRsaW5lIGFib3ZlIHdvdWxkIGJlIGNsaXBwZWQgYXdheSBieSB0aGUgcGFuZSdzIG92ZXJmbG93LiBVc2UgYW4gaW5zZXQgb3ZlcmxheSBkcmF3bgogICAgIGFzIHRoZSBMQVNUIGNoaWxkIGluc3RlYWQgLSBzZWUgcmVuZGVyQ29tcCgpJ3MgLnNlbC1mcmFtZSAtIHdoaWNoIHBhaW50cyBvbiB0b3Agb2YgdGhlCiAgICAgY29tcG9uZW50J3Mgb3duIGNvbnRlbnQgYW5kIG5ldmVyIG5lZWRzIHRvIGV4dGVuZCBwYXN0IHRoZSBib3ggaXQncyBpbi4gKi8KICAuY21wLmxvY2tlZC5zZWxlY3RlZHtvdXRsaW5lOm5vbmU7fQogIC5jbXAgLnNlbC1mcmFtZXtwb3NpdGlvbjphYnNvbHV0ZTtpbnNldDowO3BvaW50ZXItZXZlbnRzOm5vbmU7Ym94LXNoYWRvdzppbnNldCAwIDAgMCAycHggdmFyKC0tc2VsKTtkaXNwbGF5Om5vbmU7fQogIC5jbXAubG9ja2VkLnNlbGVjdGVkIC5zZWwtZnJhbWV7ZGlzcGxheTpibG9jazt9CiAgLmhhbmRsZS5zZXtyaWdodDotNXB4O2JvdHRvbTotNXB4O2N1cnNvcjpzZS1yZXNpemU7fQogIC5oYW5kbGUuZXtyaWdodDotNXB4O3RvcDo1MCU7dHJhbnNmb3JtOnRyYW5zbGF0ZVkoLTUwJSk7Y3Vyc29yOmUtcmVzaXplO30KICAuaGFuZGxlLnN7Ym90dG9tOi01cHg7bGVmdDo1MCU7dHJhbnNmb3JtOnRyYW5zbGF0ZVgoLTUwJSk7Y3Vyc29yOnMtcmVzaXplO30KCiAgLyogQ29tcG9uZW50IGxvb2tzICovCiAgLmF4LWxhYmVse2ZvbnQtc2l6ZToxMnB4O2NvbG9yOnZhcigtLWF4LWxhYmVsLWZnKTtkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2hlaWdodDoxMDAlO30KICAvKiDrnbzrsqgg7Iqk7YOA7J28KFJlZi9KdW1wKTog652867KoIOyZvOyqveyXkCDrtpnripQg7J6R7J2AIOyVhOydtOy9mC4g7Iqk7YOA7J28PeyXhuydjCDsnbTrqbQg67aZ7KeAIOyViuuKlOuLpC4gKi8KICAuYXgtbGFiZWwtaWN7ZGlzcGxheTppbmxpbmUtYmxvY2s7ZmxleDpub25lO3dpZHRoOjE0cHg7aGVpZ2h0OjE0cHg7bWFyZ2luLXJpZ2h0OjRweDtiYWNrZ3JvdW5kLXNpemU6Y29udGFpbjtiYWNrZ3JvdW5kLXJlcGVhdDpuby1yZXBlYXQ7YmFja2dyb3VuZC1wb3NpdGlvbjpjZW50ZXI7fQogIC5heC1sYWJlbC1pYy1yZWZ7YmFja2dyb3VuZC1pbWFnZTp1cmwoZGF0YTppbWFnZS9wbmc7YmFzZTY0LGlWQk9SdzBLR2dvQUFBQU5TVWhFVWdBQUFCa0FBQUFhQ0FZQUFBQkNmZmZOQUFBQUFYTlNSMElBcnM0YzZRQUFBQVJuUVUxQkFBQ3hqd3Y4WVFVQUFBQUpjRWhaY3dBQURzTUFBQTdEQWNkdnFHUUFBQUhXU1VSQlZFaEw3Wk5QU0pOaEhNYy96eXIvaGZLV1F4Zk1ZZVFJVWZLUUI0TWRZaEdCUkdLRy9SRkZRYnlFQjhNTVNRajBJSVJJUmtYVW9WdUhGWUtYcUlzZDZ1SkJVQTlhUWZZbXM5akU0YmJXblBWdUhvSjN2ZzhvejBRdjV1ZjA4SHQrWHo0L25vZWZpTVNNRkx1TVRTN3NCdnVTalBpUEpZYVJSUGNIMFAxQitXcFRSQ1o3OG4xeGlhYnVZWmJEVVFCT3VJN2hlOUJOWGs2MjNHcEJXVEw3ZFlHV25vZkU0cXVXZW5HaHhwdG5mZVRsNWxqcUcxRjZybFFxUmY5am55bW9PMWROK3hVdmxlNFNBc3NyRER4NUpVY3NLRW4wSDBHbVAra0FWSlE1R2V5NmpydlV3ZXVSTG9RUXZQMDRoWkZNeWpFVEpjbjhRc0E4OTdSZjR1cXRFZTRNdmVURDVCeGxMZ2VyaVFUZi9Pa2VHU1ZKUExGbW5yL29QN25ncVNJNzZ4Q25UcFlTanY0R0lCcUxiMGhZVVpJVUhNNEZ3R1lUSEhjV2NhMzJERE5qOS9rOHYwZ3dGQWJBcmhWSXFUUktra3EzQzREK3prYUs3UnJlMWdFOFRmZG91L3NVZ0tKQ0RhZkRMcVhTS0VtT2F2blVuNi9CSHdqUmZQc1JrVjl4bGtJUkRPUGZaN2ZWZXhGQ1RxVlJrZ0QwZGpUd2ZtS1dsV2pNckFraDhKd3VwL1d5MTlJcm83eU1BR3QvL3ZKaWRKem52bmNjMGZLNWVhT1dpMmVyT1hoZzYxa3prbXlYclVmWUlmWWxHYkYzSk92K0ZwVC8vRnk2QmdBQUFBQkpSVTVFcmtKZ2dnPT0pO30KICAuYXgtbGFiZWwtaWMtanVtcHtiYWNrZ3JvdW5kLWltYWdlOnVybChkYXRhOmltYWdlL3BuZztiYXNlNjQsaVZCT1J3MEtHZ29BQUFBTlNVaEVVZ0FBQUJjQUFBQVRDQVlBQUFCN3U1YTJBQUFBQVhOU1IwSUFyczRjNlFBQUFBUm5RVTFCQUFDeGp3djhZUVVBQUFBSmNFaFpjd0FBRHNNQUFBN0RBY2R2cUdRQUFBRzJTVVJCVkRoUHRaTmRTRk5oSEllZnJiTVdVbU13b1VpVUdDMWtRMFNqRVFZU2RLRjIwWlVJM2toSUY0R0ZBeSs2RXlVUkJoT0VMaElqeGk3S1FFZ3FGRCs2VVJIblJZT3dEekJFRFJsUm1xS2t5ZmFlMTR2bThaeGp3am5SZnZEQy8vUGhmWCtjNDlqNkpTUjVrdE5jK0ovS0s5eGh4eFlwSmV1YjJ3d01UNVBKWkFsZHVzRDFLMEhjSjEzbVViQUxmekk0enVPQk1YWi83Mm0xa3ZPRlBJKzE0Zk9lTWN4aXg1YlV4MFY2RTI4MGNGVmxLUUJmMDJ2YzdlZ2pLNFJwd3dZOEZuK0ZxaDQrOG1uWFBUeW5Dd0Q0c0xEQzNQc3Z1dWsvc216TDBOc2tRcWhhWGw5VFJmcjdUMjdjYmdlZ29lNGFuZmNiZFJzMjRNZHBaUElkYmRFNDRiSUFpV2lyb1dmSkZpa2xPN3Q3aGdPZ1NzbE02ak1BVHVkUmxHSXUvRTFaSWFpOTAybW9UVDNyWm5CMGhwY1RTUUQ4SmVjTWZhemUzS1VvQkFQRi9Oalkwczc4d2pJZGoxNW9NemVyS3d3N1dJVURSSnB1NFhZZi9pd05rWmdXWHkwUGNEbDBVY3NQWkJsZTZpK2k1MEV6eWduamlyLzRMUDBQV3d5MUE5bitXbGEvclpINnRJUlFCVDZ2aDNCWmdGTzZGK2xsRzI1SGxtMzVGK1VWZnF3dHIyZlhjNUhEMU5IbHVWQ1NRK2hIcFdRZmY2NmtGbGV0TnUwQUFBQUFTVVZPUks1Q1lJST0pO30KICBib2R5LnNraW4tY2xhc3NpYyAuYXgtbGFiZWx7Ym9yZGVyLWJvdHRvbToxcHggc29saWQgdmFyKC0tYXgtYm9yZGVyKTtwYWRkaW5nLWJvdHRvbToycHg7fQogIC5heC1sYWJlbCAucmVxe2NvbG9yOnZhcigtLWF4LXJlcSk7bWFyZ2luLWxlZnQ6MnB4O30KICAucmVxe2NvbG9yOnZhcigtLWF4LXJlcSk7bWFyZ2luLWxlZnQ6MnB4O2ZvbnQtd2VpZ2h0OjcwMDt9CiAgLyogRmF0IE1vZGXsl5DshJzripQg652867Ko7JeQIOu2meuKlCDruajqsIQg7ZWE7IiYKCopIO2RnOyLnOulvCDsk7Dsp4Ag7JWK64qU64ukLiBUaGluIE1vZGXripQg6re464yA66GcLiAqLwogIGJvZHkuc2tpbi1jbGFzc2ljIC5yZXF7ZGlzcGxheTpub25lO30KICAuYXgtaW5wdXR7d2lkdGg6MTAwJTtoZWlnaHQ6MTAwJTtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWF4LWJvcmRlcik7Ym9yZGVyLXJhZGl1czo0cHg7YmFja2dyb3VuZDojZmZmO3BhZGRpbmc6MCA4cHg7Zm9udC1zaXplOjEycHg7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtjb2xvcjojMTExO30KICAuYXgtaW5wdXQucmVhZG9ubHl7YmFja2dyb3VuZDp2YXIoLS1heC1yZWFkb25seS1iZyk7Y29sb3I6IzU1NTt9CiAgLmF4LWlucHV0LnJlcXVpcmVkLC5heC1jb21iby5yZXF1aXJlZCwuYXgtZGF0ZS5yZXF1aXJlZHtiYWNrZ3JvdW5kOnZhcigtLWF4LXJlcXVpcmVkLWJnKTt9CiAgLyog7Yyd7JeFOiDrnbzrsqgr7YWN7Iqk7Yq467CV7IqkKOy9lOuTnCkr7JWE7J207L2YK+2FjeyKpO2KuOuwleyKpCjrqoXsua0sIO2VreyDgSDsnb3quLDsoITsmqkpICovCiAgLmF4LXBvcHVwe3dpZHRoOjEwMCU7aGVpZ2h0OjEwMCU7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6NHB4O30KICAuYXgtcG9wdXA+LmF4LWlucHV0LC5heC1wb3B1cD4uYXgtaW5wdXQteHtmbGV4OjEgMSAwO3dpZHRoOmF1dG87bWluLXdpZHRoOjA7fQogIC5heC1wb3B1cC1pY3tmbGV4Om5vbmU7d2lkdGg6MjJweDtoZWlnaHQ6MjJweDtib3gtc2l6aW5nOmJvcmRlci1ib3g7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1heC1ib3JkZXIpO2JvcmRlci1yYWRpdXM6MnB4OwogICAgYmFja2dyb3VuZDp2YXIoLS1heC1ncmVlbi1saWdodCk7Y29sb3I6dmFyKC0tYXgtZ3JlZW4pO2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcjtmb250LXNpemU6MTFweDtsaW5lLWhlaWdodDoxO30KICAuYXgtcG9wdXAtbmFtZXtmbGV4OjEuNiAxIDA7aGVpZ2h0OjEwMCU7bWluLXdpZHRoOjA7Ym94LXNpemluZzpib3JkZXItYm94O2JvcmRlcjoxcHggc29saWQgdmFyKC0tYXgtYm9yZGVyKTtib3JkZXItcmFkaXVzOjJweDtiYWNrZ3JvdW5kOnZhcigtLWF4LXJlYWRvbmx5LWJnKTt9CiAgLmF4LWNvbWJve3dpZHRoOjEwMCU7aGVpZ2h0OjEwMCU7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1heC1ib3JkZXIpO2JvcmRlci1yYWRpdXM6NHB4O2JhY2tncm91bmQ6I2ZmZjtwYWRkaW5nOjAgOHB4O2ZvbnQtc2l6ZToxMnB4O2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OnNwYWNlLWJldHdlZW47Y29sb3I6IzExMTt9CiAgLmF4LWNvbWJvLnJlYWRvbmx5e2JhY2tncm91bmQ6dmFyKC0tYXgtcmVhZG9ubHktYmcpO2NvbG9yOiM1NTU7fQogIC5heC1jb21ibzo6YWZ0ZXJ7Y29udGVudDoi4pa+Ijtjb2xvcjp2YXIoLS1heC1ncmF5KTtmb250LXNpemU6MTFweDt9CiAgLmF4LWJ0bnt3aWR0aDoxMDAlO2hlaWdodDoxMDAlO2JvcmRlci1yYWRpdXM6NHB4O2ZvbnQtc2l6ZToxMnB4O2ZvbnQtd2VpZ2h0OjYwMDtkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2p1c3RpZnktY29udGVudDpjZW50ZXI7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1heC1ncmVlbik7YmFja2dyb3VuZDp2YXIoLS1heC1ncmVlbik7Y29sb3I6I2ZmZjt9CiAgLmF4LWJ0bi5naG9zdHtiYWNrZ3JvdW5kOiNmZmY7Y29sb3I6dmFyKC0tYXgtZ3JlZW4pO30KICAuYXgtY2hlY2t7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6NXB4O2ZvbnQtc2l6ZToxMnB4O2hlaWdodDoxMDAlO30KICAuYXgtY2hlY2sgLmJveHt3aWR0aDoxNHB4O2hlaWdodDoxNHB4O2JvcmRlcjoxLjVweCBzb2xpZCB2YXIoLS1heC1ib3JkZXIpO2JvcmRlci1yYWRpdXM6M3B4O30KICAuYXgtZGF0ZXt3aWR0aDoxMDAlO2hlaWdodDoxMDAlO2JvcmRlcjoxcHggc29saWQgdmFyKC0tYXgtYm9yZGVyKTtib3JkZXItcmFkaXVzOjRweDtiYWNrZ3JvdW5kOiNmZmY7cGFkZGluZzowIDhweDtmb250LXNpemU6MTJweDtkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2p1c3RpZnktY29udGVudDpzcGFjZS1iZXR3ZWVuO2NvbG9yOiMxMTE7fQogIC5heC1kYXRlLnJlYWRvbmx5e2JhY2tncm91bmQ6dmFyKC0tYXgtcmVhZG9ubHktYmcpO2NvbG9yOiM1NTU7fQogIC5heC1kYXRlOjphZnRlcntjb250ZW50OiLwn5OFIjtmb250LXNpemU6MTFweDt9CiAgLyog7Yy766qo65OcIOyghOyaqTog6riw6rCEKGRhdGVyYW5nZSkg7Y647KeRIO2ZlOuptOuPhCDrgrTrs7TrgrTquLDsspjrn7wg64Kg7KecIOuRkCDsubgr66y86rKwKH4p66GcIOuztOyXrOykgOuLpC4KICAgICAuYXgtZGF0ZSDtlZjrgpjroZwg7ZWp7LOQIOuztOyXrOyjvOuNmCDquLDsobQo7JSs66qo65OcKSDtkZztmITqs7wg64us66asLCDsi6TsoJwg7IKs7JqpIO2ZlOuptOqzvCDrmJHqsJnsnYAg66qo7JaR7J20IOuQnOuLpC4gKi8KICAuYXgtZGF0ZXJhbmdle3dpZHRoOjEwMCU7aGVpZ2h0OjEwMCU7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6NXB4O30KICAuYXgtZGF0ZXJhbmdlIC5heC1kYXRlLXBhcnR7ZmxleDoxO21pbi13aWR0aDowO2hlaWdodDoxMDAlO2JvcmRlcjoxcHggc29saWQgdmFyKC0tYXgtYm9yZGVyKTtib3JkZXItcmFkaXVzOjRweDtiYWNrZ3JvdW5kOiNmZmY7cGFkZGluZzowIDhweDtmb250LXNpemU6MTJweDtkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2p1c3RpZnktY29udGVudDpzcGFjZS1iZXR3ZWVuO2NvbG9yOiMxMTE7fQogIC5heC1kYXRlcmFuZ2UucmVhZG9ubHkgLmF4LWRhdGUtcGFydHtiYWNrZ3JvdW5kOnZhcigtLWF4LXJlYWRvbmx5LWJnKTtjb2xvcjojNTU1O30KICAuYXgtZGF0ZXJhbmdlLnJlcXVpcmVkIC5heC1kYXRlLXBhcnR7YmFja2dyb3VuZDp2YXIoLS1heC1yZXF1aXJlZC1iZyk7fQogIC8qIOuCoOynnDEv64Kg7KecMiDqsJzrs4Qg7ZWE7IiYwrfsnb3quLDsoITsmqkgKi8KICAuYXgtZGF0ZXJhbmdlIC5heC1kYXRlLXBhcnQucm97YmFja2dyb3VuZDp2YXIoLS1heC1yZWFkb25seS1iZyk7Y29sb3I6IzU1NTt9CiAgLmF4LWRhdGVyYW5nZSAuYXgtZGF0ZS1wYXJ0LmlzLXJlcXtiYWNrZ3JvdW5kOnZhcigtLWF4LXJlcXVpcmVkLWJnKTt9CiAgLmF4LWRhdGVyYW5nZSAuYXgtZGF0ZS1wYXJ0OjphZnRlcntjb250ZW50OiLwn5OFIjtmb250LXNpemU6MTFweDt9CiAgLmF4LXNlY3Rpb257d2lkdGg6MTAwJTtoZWlnaHQ6MTAwJTtkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDo2cHg7Zm9udC1zaXplOjEzcHg7Zm9udC13ZWlnaHQ6NzAwO2NvbG9yOnZhcigtLWF4LW5hdnkpO2JvcmRlci1ib3R0b206MXB4IHNvbGlkIHZhcigtLWF4LWJvcmRlcik7cGFkZGluZy1ib3R0b206NHB4O30KICAuYXgtc2VjdGlvbjo6YmVmb3Jle2NvbnRlbnQ6IuKMgyI7dHJhbnNmb3JtOnJvdGF0ZSgxODBkZWcpO2NvbG9yOnZhcigtLWF4LWdyZWVuKTtmb250LXdlaWdodDo3MDA7fQogIC5heC1wYW5lbC1je3dpZHRoOjEwMCU7aGVpZ2h0OjEwMCU7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1heC1ib3JkZXIpO2JvcmRlci1yYWRpdXM6NXB4O2JhY2tncm91bmQ6cmdiYSgyNTAsMjUxLDI1MiwuNSk7fQogIC5heC1zcGxpdC1je3dpZHRoOjEwMCU7aGVpZ2h0OjEwMCU7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1heC1ib3JkZXIpO2JvcmRlci1yYWRpdXM6NXB4O2JhY2tncm91bmQ6cmdiYSgyNTAsMjUxLDI1MiwuMzUpO30KICAuc3BsaXQtcGFuZXtwb3NpdGlvbjphYnNvbHV0ZTt9CiAgLnNwbGl0LXBhbmUtaGludHtvdXRsaW5lOjFweCBkYXNoZWQgcmdiYSgzOCwxMjgsMjM1LC4yKTtvdXRsaW5lLW9mZnNldDotMXB4O30KICAuc3BsaXQtZGl2aWRlcntwb3NpdGlvbjphYnNvbHV0ZTtiYWNrZ3JvdW5kOiNlMmU2ZWE7ei1pbmRleDo1O30KICAuc3BsaXQtZGl2aWRlcjpob3ZlcntiYWNrZ3JvdW5kOnZhcigtLWF4LWdyZWVuKTt9CiAgLnNwbGl0LWRpdmlkZXItaHtjdXJzb3I6Y29sLXJlc2l6ZTt9CiAgLnNwbGl0LWRpdmlkZXItdntjdXJzb3I6cm93LXJlc2l6ZTt9CiAgLyogei1pbmRleDogbXVzdCBiZWF0IGFueSBwYW5lIGNoaWxkJ3Mgb3duIHotaW5kZXggKHVwIHRvIDMxMCsyOTk9NjA5LCBzZWUgcmVuZGVyQ29tcCkgc28gdGhlCiAgICAgdGFnIC0gdGhlIG9ubHkgd2F5IHRvIGdyYWIvbW92ZSBhIHNwbGl0IGNvbnRhaW5lciBvbmNlIGl0cyBwYW5lcyBhcmUgZnVsbHkgY292ZXJlZCBieQogICAgIGRvY2s6J2ZpbGwnIGNoaWxkcmVuIC0gaXMgbmV2ZXIgaGlkZGVuIHVuZGVybmVhdGggb25lLiBTdGlsbCB3ZWxsIHVuZGVyIHRoZSBvdmVybGF5CiAgICAgei1pbmRleGVzIChndWlkZWxpbmVzIDkwMCwgbW9kYWxzIDEwMDApLiAqLwogIC5zcGxpdC10YWd7cG9zaXRpb246YWJzb2x1dGU7bGVmdDoycHg7dG9wOjJweDt3aWR0aDoxNnB4O2hlaWdodDoxNnB4O2xpbmUtaGVpZ2h0OjE0cHg7dGV4dC1hbGlnbjpjZW50ZXI7CiAgICBmb250LXNpemU6MTBweDtiYWNrZ3JvdW5kOiNmZmY7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1heC1ib3JkZXIpO2JvcmRlci1yYWRpdXM6M3B4O2NvbG9yOnZhcigtLWF4LWdyZWVuLWRhcmspOwogICAgY3Vyc29yOnBvaW50ZXI7ei1pbmRleDo2NTA7dXNlci1zZWxlY3Q6bm9uZTt9CiAgLnNwbGl0LXRhZzpob3Zlcntib3JkZXItY29sb3I6dmFyKC0tYXgtZ3JlZW4pO2JhY2tncm91bmQ6dmFyKC0tYXgtZ3JlZW4tbGlnaHQpO30KICAuY21wLmxvY2tlZHtjdXJzb3I6ZGVmYXVsdDt9CiAgLmF4LWdyaWR7d2lkdGg6MTAwJTtoZWlnaHQ6MTAwJTtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWF4LWJvcmRlcik7Ym9yZGVyLXJhZGl1czo0cHg7b3ZlcmZsb3c6aGlkZGVuO2JhY2tncm91bmQ6I2ZmZjtkaXNwbGF5OmZsZXg7ZmxleC1kaXJlY3Rpb246Y29sdW1uO30KICAuYXgtZ3JpZCAuZ3Rvb2xiYXJ7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6NXB4O3BhZGRpbmc6NnB4IDhweDtib3JkZXItYm90dG9tOjFweCBzb2xpZCB2YXIoLS1heC1ib3JkZXIpO2JhY2tncm91bmQ6I2ZmZjtmbGV4LXdyYXA6bm93cmFwO21pbi1oZWlnaHQ6NDFweDtib3gtc2l6aW5nOmJvcmRlci1ib3g7fQogIGJvZHkuc2tpbi1jbGFzc2ljIC5heC1ncmlkIC5ndG9vbGJhcntkaXNwbGF5Om5vbmU7fQogIC5heC1ncmlkIC5ndG9vbGJhciAuZ3RpdGxle2ZvbnQtc2l6ZToxM3B4O2ZvbnQtd2VpZ2h0OjcwMDtjb2xvcjp2YXIoLS1heC1uYXZ5KTtkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDo0cHg7ZmxleDpub25lO3doaXRlLXNwYWNlOm5vd3JhcDt9CiAgLmF4LWdyaWQgLmd0b29sYmFyIC5ndGl0bGU6OmJlZm9yZXtjb250ZW50OiLijIMiO3RyYW5zZm9ybTpyb3RhdGUoMTgwZGVnKTtjb2xvcjp2YXIoLS1heC1ncmVlbik7Zm9udC13ZWlnaHQ6NzAwO30KICAuYXgtZ3JpZCAuZ3Rvb2xiYXIgLmdzcGFjZXJ7ZmxleDoxO21pbi13aWR0aDo4cHg7fQogIC5heC1ncmlkIC5ndG9vbGJhciAuZ2J0bi1yb3d7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6NXB4O2ZsZXg6bm9uZTttYXgtd2lkdGg6MTAwJTtvdmVyZmxvdy14OmF1dG87c2Nyb2xsYmFyLXdpZHRoOnRoaW47fQogIC5nYnRue2Rpc3BsYXk6aW5saW5lLWZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDo2cHg7Zm9udC1zaXplOjExcHg7Zm9udC13ZWlnaHQ6NjAwO2NvbG9yOiNmZmY7YmFja2dyb3VuZDp2YXIoLS1heC1ncmVlbik7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1heC1ncmVlbik7Ym9yZGVyLXJhZGl1czo1cHg7cGFkZGluZzo1cHggMTBweCA1cHggNnB4O3doaXRlLXNwYWNlOm5vd3JhcDt9CiAgLmdidG4gLmdpY3tmb250LXNpemU6MTBweDt3aWR0aDoxNnB4O2hlaWdodDoxNnB4O2Rpc3BsYXk6aW5saW5lLWZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2p1c3RpZnktY29udGVudDpjZW50ZXI7YmFja2dyb3VuZDpyZ2JhKDI1NSwyNTUsMjU1LC4yMik7Ym9yZGVyLXJhZGl1czo0cHg7ZmxleDpub25lO30KICAuZ2J0bi5kaXNhYmxlZHtjb2xvcjojZmZmO2JhY2tncm91bmQ6I2M3Y2NkMTtib3JkZXItY29sb3I6I2M3Y2NkMTt9CiAgLmdidG4uZGlzYWJsZWQgLmdpY3tiYWNrZ3JvdW5kOnJnYmEoMjU1LDI1NSwyNTUsLjMpO30KICAuZ2J0bi51c2Vye2JhY2tncm91bmQ6dmFyKC0tYXgtZ3JlZW4pO2JvcmRlci1jb2xvcjp2YXIoLS1heC1ncmVlbik7fQogIC5heC1ncmlkIC5nYm9keXtmbGV4OjE7b3ZlcmZsb3cteDphdXRvO292ZXJmbG93LXk6aGlkZGVuO2Rpc3BsYXk6ZmxleDtmbGV4LWRpcmVjdGlvbjpjb2x1bW47c2Nyb2xsYmFyLXdpZHRoOnRoaW47fQogIC8qIEhvcml6b250YWwgc2Nyb2xsIG1vZGU6IHRoZSBib2R5IHNjcm9sbHMgc2lkZXdheXMgYW5kIGhlYWRlci9yb3dzIGJlY29tZSBhIHNpbmdsZQogICAgIG1pbi13aWR0aCB0cmFjayBzbyBjb2x1bW5zIGtlZXAgYSByZWFkYWJsZSBtaW5pbXVtIGluc3RlYWQgb2YgYmVpbmcgc3F1ZWV6ZWQuICovCiAgLmF4LWdyaWQgLmdib2R5LnhzY3JvbGx7b3ZlcmZsb3cteDphdXRvO292ZXJmbG93LXk6aGlkZGVuO3Njcm9sbGJhci13aWR0aDp0aGluO30KICAuYXgtZ3JpZCAuZ2JvZHkueHNjcm9sbCAuZ2gsLmF4LWdyaWQgLmdib2R5LnhzY3JvbGwgLmdye2Rpc3BsYXk6ZmxleDt3aWR0aDptYXgtY29udGVudDttaW4td2lkdGg6MTAwJTt9CiAgLmF4LWdyaWQgLmdib2R5LnhzY3JvbGwgLmdoIHNwYW4sLmF4LWdyaWQgLmdib2R5LnhzY3JvbGwgLmdyIHNwYW57ZmxleDowIDAgYXV0bztib3gtc2l6aW5nOmJvcmRlci1ib3g7fQogIC5heC1ncmlkIC5nYm9keS54c2Nyb2xsOjotd2Via2l0LXNjcm9sbGJhcntoZWlnaHQ6OXB4O30KICAuYXgtZ3JpZCAuZ2JvZHkueHNjcm9sbDo6LXdlYmtpdC1zY3JvbGxiYXItdGh1bWJ7YmFja2dyb3VuZDojYzNjYmQzO2JvcmRlci1yYWRpdXM6NXB4O30KICAuYXgtZ3JpZCAuZ2JvZHkueHNjcm9sbDo6LXdlYmtpdC1zY3JvbGxiYXItdGh1bWI6aG92ZXJ7YmFja2dyb3VuZDojYTliM2JkO30KICAuYXgtZ3JpZCAuZ2JvZHkueHNjcm9sbDo6LXdlYmtpdC1zY3JvbGxiYXItdHJhY2t7YmFja2dyb3VuZDojZjJmNGY2O30KICAvKiBFcXVhbC13aWR0aCBtb2RlOiBDU1MgR3JpZCAobm90IGZsZXhib3gpIHNvIHRoZSBoZWFkZXIgYW5kIGV2ZXJ5IHJvdyBzaGFyZSB0aGUgZXhhY3QKICAgICBzYW1lIGNvbHVtbiB0cmFja3MgLSBncmlkLXRlbXBsYXRlLWNvbHVtbnMgaXMgc2V0IGlubGluZSBwZXItaW5zdGFuY2UgKHNlZSBncmlkQ29sc1N0eWxlCiAgICAgaW4gdGhlIHJlbmRlcmVyKSBzbyBpdCBjYW4ndCBkcmlmdCBiZXR3ZWVuIHJvd3MgdGhlIHdheSBpbmRlcGVuZGVudCBmbGV4IHJvd3Mgc29tZXRpbWVzIGRpZC4gKi8KICAuYXgtZ3JpZCAuZ2h7ZGlzcGxheTpncmlkO2JvcmRlci1ib3R0b206MXB4IHNvbGlkIHZhcigtLWF4LWJvcmRlcik7fQogIC5heC1ncmlkIC5naCBzcGFue2JhY2tncm91bmQ6dmFyKC0tYXgtZ3JpZC1oZWFkKTttaW4td2lkdGg6MDtwYWRkaW5nOjZweCA4cHg7Zm9udC1zaXplOjExcHg7Zm9udC13ZWlnaHQ6NzAwO2NvbG9yOnZhcigtLWF4LWdyaWQtaGVhZC1mZyk7Ym9yZGVyLXJpZ2h0OjFweCBzb2xpZCB2YXIoLS1heC1ib3JkZXIpO3doaXRlLXNwYWNlOm5vd3JhcDtvdmVyZmxvdzpoaWRkZW47dGV4dC1vdmVyZmxvdzplbGxpcHNpczt9CiAgLyog7Lus65+8IOqwnOuzhCDtj60g7KGw7KCIOiDtl6TrjZQg7IWAIOyasOy4oSDqsIDsnqXsnpDrpqzrpbwg65Oc656Y6re47ZWY66m0IOq3uCDsu6zrn7zrp4wg7Y+t7J20IOuwlOuAkOuLpCAo7JSs66qo65OcIOy6lOuyhOyKpCDsoITsmqksCiAgICAg64K067O064K4IO2ZlOuptOyXkOuKlCDrgpjtg4Drgpjsp4Ag7JWK7J2MKS4g7Y+J7IaM7JeUIO2IrOuqhe2VmOqzoCwg66eI7Jqw7Iqk66W8IOyYrOumrOuptCDtjIzrnoAg65287J247Jy866GcIO2RnOyLnOuQnOuLpC4gKi8KICAuYXgtZ3JpZCAuZ2ggLmNvbC1yZXNpemUtaGFuZGxle3Bvc2l0aW9uOmFic29sdXRlO3RvcDowO3JpZ2h0OjA7Ym90dG9tOjA7d2lkdGg6OHB4O2N1cnNvcjpjb2wtcmVzaXplO3otaW5kZXg6NTt9CiAgLmF4LWdyaWQgLmdoIC5jb2wtcmVzaXplLWhhbmRsZTo6YWZ0ZXJ7Y29udGVudDonJztwb3NpdGlvbjphYnNvbHV0ZTt0b3A6MDtib3R0b206MDtyaWdodDowO3dpZHRoOjJweDtiYWNrZ3JvdW5kOnRyYW5zcGFyZW50O30KICAuYXgtZ3JpZCAuZ2ggLmNvbC1yZXNpemUtaGFuZGxlOmhvdmVyOjphZnRlcntiYWNrZ3JvdW5kOnZhcigtLWF4LWdyZWVuKTt9CiAgLyog7Lus65+8IOyInOyEnCDrk5zrnpjqt7go65SU7J6Q7J24IOy6lOuyhOyKpCDsoITsmqkpOiBbZGF0YS1jaV3qsIAg67aZ7J2AIO2XpOuNlCDshYDsnbQg7IaQ7J6h7J20LiDrk5zrnpjqt7gg7KSR7J24IOy7rOufvOydgAogICAgIOuwmO2IrOuqhe2VmOqyjCwg64aT7J2EIOychOy5mOuKlCDsoowv7JqwIOqyveqzhOyXkCDstIjroZ0g7IS466Gc7ISg7Jy866GcIO2RnOyLnO2VnOuLpCjsnqzroIzrjZTrp4Eg7JeG7J20IG1vdXNlbW92ZeyXkOyEnAogICAgIO2BtOuemOyKpOunjCDthqDquIDtlZjrr4DroZwg66ekIO2UhOugiOyehCDqt7jrpqzrk5wg7KCE7LK066W8IOuLpOyLnCDqt7jrpqzsp4Ag7JWK64qU64ukKS4gKi8KICAuYXgtZ3JpZCAuZ2ggc3BhbltkYXRhLWNpXXtjdXJzb3I6Z3JhYjt9CiAgLmF4LWdyaWQgLmdoIHNwYW5bZGF0YS1jaV0uZ2NvbC1kcmFnZ2luZ3tvcGFjaXR5Oi4zNTt9CiAgLmF4LWdyaWQgLmdoIHNwYW5bZGF0YS1jaV0uZ2NvbC1kcm9wLWJlZm9yZTo6YmVmb3Jle2NvbnRlbnQ6Jyc7cG9zaXRpb246YWJzb2x1dGU7bGVmdDotMnB4O3RvcDowO2JvdHRvbTowO3dpZHRoOjNweDtiYWNrZ3JvdW5kOnZhcigtLWF4LWdyZWVuKTt6LWluZGV4OjY7fQogIC5heC1ncmlkIC5naCBzcGFuW2RhdGEtY2ldLmdjb2wtZHJvcC1hZnRlcjo6YWZ0ZXJ7Y29udGVudDonJztwb3NpdGlvbjphYnNvbHV0ZTtyaWdodDotMnB4O3RvcDowO2JvdHRvbTowO3dpZHRoOjNweDtiYWNrZ3JvdW5kOnZhcigtLWF4LWdyZWVuKTt6LWluZGV4OjY7fQogIC5heC1ncmlkIC5ncntkaXNwbGF5OmdyaWQ7Ym9yZGVyLWJvdHRvbToxcHggc29saWQgI2VlZjBmMjt9CiAgLmF4LWdyaWQgLmdyIHNwYW57bWluLXdpZHRoOjA7cGFkZGluZzo2cHggOHB4O2ZvbnQtc2l6ZToxMXB4O2NvbG9yOiM2YjcyODA7Ym9yZGVyLXJpZ2h0OjFweCBzb2xpZCAjZjBmMmY0O292ZXJmbG93OmhpZGRlbjt9CiAgLmF4LWdyaWQgLmdyIHNwYW46aGFzKC5heC1jb21ibyl7b3ZlcmZsb3c6dmlzaWJsZTt9CiAgLmF4LWdyaWQgLmdyIHNwYW4uZ2NlbGwtZWRpdHtwYWRkaW5nOjA7fQogIC5heC1ncmlkIC5nciAuZ2NlbGwtaW5wdXR7d2lkdGg6MTAwJTtoZWlnaHQ6MTAwJTtib3gtc2l6aW5nOmJvcmRlci1ib3g7Ym9yZGVyOjA7YmFja2dyb3VuZDp0cmFuc3BhcmVudDtwYWRkaW5nOjZweCA4cHg7Zm9udC1zaXplOjExcHg7Zm9udC1mYW1pbHk6aW5oZXJpdDtjb2xvcjojMWYyOTM3O291dGxpbmU6bm9uZTttaW4td2lkdGg6MDt9CiAgLmF4LWdyaWQgLmdyIC5nY2VsbC1pbnB1dDpmb2N1c3tiYWNrZ3JvdW5kOiNlZWY2ZjE7Ym94LXNoYWRvdzppbnNldCAwIDAgMCAxcHggdmFyKC0tYXgtZ3JlZW4pO30KICAuYXgtZ3JpZCAuZ3IgLmdjZWxsLWNoZWNre3dpZHRoOjEwMCU7aGVpZ2h0OjEwMCU7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyO2JveC1zaXppbmc6Ym9yZGVyLWJveDt9CiAgLmF4LWdyaWQgLmdyIC5nY2VsbC1jaGVjayAuYm94e3dpZHRoOjE0cHg7aGVpZ2h0OjE0cHg7ZmxleDpub25lO2JvcmRlcjoxLjVweCBzb2xpZCB2YXIoLS1heC1ib3JkZXIpO2JvcmRlci1yYWRpdXM6M3B4O2JveC1zaXppbmc6Ym9yZGVyLWJveDt9CiAgLmF4LWdyaWQgLmdyIC5nY2VsbC1jaGVjay5pbnRlcmFjdGl2ZXtjdXJzb3I6cG9pbnRlcjt9CiAgLmF4LWdyaWQgLmdyIC5nY2VsbC1jaGVjay5pbnRlcmFjdGl2ZSAuYm94Lm9ue2JhY2tncm91bmQ6dmFyKC0tYXgtZ3JlZW4pO2JvcmRlci1jb2xvcjp2YXIoLS1heC1ncmVlbik7cG9zaXRpb246cmVsYXRpdmU7fQogIC5heC1ncmlkIC5nciAuZ2NlbGwtY2hlY2suaW50ZXJhY3RpdmUgLmJveC5vbjo6YWZ0ZXJ7Y29udGVudDoi4pyTIjtwb3NpdGlvbjphYnNvbHV0ZTtpbnNldDowO2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcjtjb2xvcjojZmZmO2ZvbnQtc2l6ZTo5cHg7bGluZS1oZWlnaHQ6MTt9CiAgLmF4LWdyaWQgLmdyIC5nY2VsbC1maWxle3dpZHRoOjEwMCU7aGVpZ2h0OjEwMCU7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyO2JveC1zaXppbmc6Ym9yZGVyLWJveDt9CiAgLmF4LWdyaWQgLmdyIC5nY2VsbC1maWxlLWlje3dpZHRoOjE4cHg7aGVpZ2h0OjE4cHg7ZmxleDpub25lO2NvbG9yOiM5YWExYTk7fQogIC8qIOq3uOumrOuTnCDsoozsuKEg7Jyg7Yu466as7YuwIOy7rOufvDogUm93IE9yZGVyKOyInOuyiCkgLyBDaGVja0JveCAtIOyUrOuqqOuTnCDsoITsmqkgKi8KICAuYXgtZ3JpZCAuZ2ggLmdyaC1pY29uc3t3aWR0aDoxMDAlO2hlaWdodDoxMDAlO2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcjtnYXA6NXB4O2xpbmUtaGVpZ2h0OjA7fQogIC5heC1ncmlkIC5naCAuZ3JoLWljb25zIHN2Z3t3aWR0aDoxM3B4O2hlaWdodDoxM3B4O2ZsZXg6bm9uZTtjb2xvcjojNmI3MjgwO2Rpc3BsYXk6YmxvY2s7fQogIC5heC1ncmlkIC5nciAuZ2NlbGwtcm93b3JkZXItbnVte3dpZHRoOjEwMCU7aGVpZ2h0OjEwMCU7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyO2NvbG9yOnZhcigtLWF4LW5hdnkpO2ZvbnQtd2VpZ2h0OjYwMDt9CiAgLyog7LK07YGs67CV7IqkIOy7rOufvCDtl6TrjZQgLSDquLDsobQgLmdjZWxsLWNoZWNrLy5ib3gg6rec7LmZ7J2AIOuNsOydtO2EsCDtlokoLmdyKSDsoITsmqnsnbTrnbwsIO2XpOuNlCguZ2gp7JeQ64+ECiAgICAg64+Z7J287ZWcIO2BrOq4sMK37KSR7JWZ7KCV66Cs7J2EIOuzhOuPhOuhnCDsoIHsmqntlbTslbwg7LK07YGs67CV7Iqk6rCAIOuztOyduOuLpC4gKi8KICAuYXgtZ3JpZCAuZ2ggLmdjZWxsLWNoZWNre3dpZHRoOjEwMCU7aGVpZ2h0OjEwMCU7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyO2JveC1zaXppbmc6Ym9yZGVyLWJveDt9CiAgLmF4LWdyaWQgLmdoIC5nY2VsbC1jaGVjayAuYm94e3dpZHRoOjE0cHg7aGVpZ2h0OjE0cHg7ZmxleDpub25lO2JvcmRlcjoxLjVweCBzb2xpZCB2YXIoLS1heC1ib3JkZXIpO2JvcmRlci1yYWRpdXM6M3B4O2JveC1zaXppbmc6Ym9yZGVyLWJveDt9CiAgLyog6re466as65OcIOy7rOufvCDsnKDtmJUgIuqygOyDiSI6IOyhsO2ajOyhsOqxtCDtjKjrhJDsnZgg6rKA7IOJIO2VhOuTnOyZgCDrj5nsnbztlZjqsowg64+L67O06riw66W8IOyasOy4oeyXkCDrsLDsuZggKi8KICAuYXgtZ3JpZCAuZ3IgLmdjZWxsLXNlYXJjaHt3aWR0aDoxMDAlO2hlaWdodDoxMDAlO2JveC1zaXppbmc6Ym9yZGVyLWJveDtkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2p1c3RpZnktY29udGVudDpmbGV4LWVuZDtnYXA6NnB4O3BhZGRpbmc6MCA4cHg7fQogIC5heC1ncmlkIC5nciAuZ2NlbGwtc2VhcmNoLWlucHV0e2ZsZXg6MTttaW4td2lkdGg6MDtib3JkZXI6MDtiYWNrZ3JvdW5kOnRyYW5zcGFyZW50O3BhZGRpbmc6MDtmb250LXNpemU6MTFweDtmb250LWZhbWlseTppbmhlcml0O2NvbG9yOiMxZjI5Mzc7b3V0bGluZTpub25lO30KICAuYXgtZ3JpZCAuZ3IgLmdjZWxsLXNlYXJjaC1pbnB1dDpmb2N1c3tiYWNrZ3JvdW5kOiNlZWY2ZjE7Ym94LXNoYWRvdzppbnNldCAwIDAgMCAxcHggdmFyKC0tYXgtZ3JlZW4pO30KICAvKiDsu6zrn7wg64uo7JyEICLtlYTsiJgiLyLsnb3quLDsoITsmqkiIO2RnOyLnDog7Zek642U64qUIOyDieydtCDqt7jrjIDroZzsnbTqs6AsIOuNsOydtO2EsCDtloko67CU65SUIOyFgCnrp4wg67Cw6rK97IOJ7J20CiAgICAg67CU64CQ64ukLiDtl6TrjZTsl5DripQg67mo6rCEICog7ZGc7Iuc66eMIOu2meuKlOuLpC4g65GYIOuLpCDsvJzsoLgg7J6I7Jy866m0IOydveq4sOyghOyaqSjtmozsg4kp7J20IOyasOyEoO2VnOuLpCAtCiAgICAg66CM642U66eBIOyqveyXkOyEnCDtgbTrnpjsiqTrpbwg67Cw7YOA7KCB7Jy866GcIOu2gOyXrC4gKi8KICAuYXgtZ3JpZCAuZ2ggc3BhbiAuY29sLXJlcS1tYXJre2NvbG9yOnZhcigtLWF4LXJlcSk7bWFyZ2luLXJpZ2h0OjJweDtmb250LXdlaWdodDo3MDA7CiAgICAvKiAuYXgtZ3JpZCAuZ2ggc3BhbiDqt5zsuZnsnYAg7J6Q7IaQIOyEoO2DneyekOudvCDsnbQg7JWI7JeQIOykkeyyqeuQnCBzcGFu7JeQ64+EIOuwsOqyvS/tjKjrlKkv7YWM65GQ66as6rCACiAgICAgICDqt7jrjIDroZwg7IOB7IaN65CY7Ja0ICIqIuunjCDrs4Trj4Qg7IOB7J6Q7LKY65+8IOuztOydtOuKlCDrrLjsoJzqsIAg7J6I7JeI64ukIC0g7Jes6riw7IScIOybkOuemCDshYAg7Iqk7YOA7J287J2ECiAgICAgICDrqqjrkZAg7KeA7JuMIOyInOyImO2VnCDsnbjrnbzsnbgg7ZGc7Iuc66GcIOuQmOuPjOumsOuLpC4gKi8KICAgIGRpc3BsYXk6aW5saW5lO2JhY2tncm91bmQ6bm9uZTtwYWRkaW5nOjA7Ym9yZGVyLXJpZ2h0OjA7d2hpdGUtc3BhY2U6bm93cmFwO292ZXJmbG93OnZpc2libGU7dGV4dC1vdmVyZmxvdzpjbGlwO30KICAvKiBGYXQgTW9kZeyXkOyEnOuKlCDri6Trpbgg7Lu07Y+s64SM7Yq47J2YIO2VhOyImCgqKSDtkZzsi5zsmYAg66eI7LCs6rCA7KeA66GcIOq3uOumrOuTnCDtl6TrjZTsnZggKiDrj4Qg7JOw7KeAIOyViuuKlOuLpAogICAgIChsaW5lIH4yNzUg7J2YIGJvZHkuc2tpbi1jbGFzc2ljIC5yZXF7ZGlzcGxheTpub25lfSDqs7wg64+Z7J287ZWcIOq3nOy5mSkuIFRoaW4gTW9kZeuKlCDqt7jrjIDroZwuICovCiAgYm9keS5za2luLWNsYXNzaWMgLmF4LWdyaWQgLmdoIHNwYW4gLmNvbC1yZXEtbWFya3tkaXNwbGF5Om5vbmU7fQogIC5heC1ncmlkIC5nciBzcGFuLmNvbC1yZXF1aXJlZHtiYWNrZ3JvdW5kOnZhcigtLWF4LXJlcS1maWxsKTt9CiAgLmF4LWdyaWQgLmdyIHNwYW4uY29sLXJlYWRvbmx5e2JhY2tncm91bmQ6dmFyKC0tYXgtcm8tZmlsbCk7Y29sb3I6IzlhYTRhZDt9CiAgLmF4LWdyaWQgLmdyIHNwYW4uY29sLXJlYWRvbmx5IC5nY2VsbC1pbnB1dHtiYWNrZ3JvdW5kOnRyYW5zcGFyZW50O2NvbG9yOiM5YWE0YWQ7cG9pbnRlci1ldmVudHM6bm9uZTt9CiAgLmF4LWdyaWQgLmdyIHNwYW4uY29sLXJlYWRvbmx5IC5nY2VsbC1jaGVja3twb2ludGVyLWV2ZW50czpub25lO29wYWNpdHk6LjY1O30KICAuYXgtZ3JpZCAuZ3Igc3Bhbi5jb2wtcmVhZG9ubHkgLmF4LWNvbWJve3BvaW50ZXItZXZlbnRzOm5vbmU7b3BhY2l0eTouNzt9CiAgLmF4LWdyaWQgLmdyIHNwYW4uY29sLXJlYWRvbmx5IC5nY2VsbC1zZWFyY2gtaW5wdXR7YmFja2dyb3VuZDp0cmFuc3BhcmVudDtjb2xvcjojOWFhNGFkO3BvaW50ZXItZXZlbnRzOm5vbmU7fQogIC5heC1ncmlkIC5nciBzcGFuLmNvbC1yZWFkb25seSAuZ2NlbGwtc2VhcmNoIC5zY3RsLXNlYXJjaC1pY3tvcGFjaXR5Oi40NTt9CiAgLmF4LWdyaWQgLmdwYWdpbmF0aW9ue3Bvc2l0aW9uOnJlbGF0aXZlO2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmZsZXgtZW5kO2dhcDoxMHB4O3BhZGRpbmc6OHB4IDEwcHg7Ym9yZGVyLXRvcDoxcHggc29saWQgdmFyKC0tYXgtYm9yZGVyKTtiYWNrZ3JvdW5kOiNmZmY7ZmxleDpub25lO2ZsZXgtd3JhcDp3cmFwO2ZvbnQtc2l6ZToxMXB4O2NvbG9yOiM0YjU1NjM7bWluLWhlaWdodDoyNHB4O30KICAuYXgtZ3JpZCAuZ3BhZ2luYXRpb24gLmdwLW5hdntwb3NpdGlvbjphYnNvbHV0ZTtsZWZ0OjUwJTt0b3A6NTAlO3RyYW5zZm9ybTp0cmFuc2xhdGUoLTUwJSwtNTAlKTtkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDo0cHg7ZmxleDpub25lO30KICAuYXgtZ3JpZCAuZ3BhZ2luYXRpb24gLmdwLWJ0bntkaXNwbGF5OmlubGluZS1mbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyO21pbi13aWR0aDoyNHB4O2hlaWdodDoyNHB4O3BhZGRpbmc6MCA2cHg7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1heC1ib3JkZXIpO2JvcmRlci1yYWRpdXM6NHB4O2JhY2tncm91bmQ6I2ZmZjtjb2xvcjojNmI3MjgwO2ZvbnQtc2l6ZToxMXB4O2JveC1zaXppbmc6Ym9yZGVyLWJveDt9CiAgLmF4LWdyaWQgLmdwYWdpbmF0aW9uIC5ncC1idG4ub257YmFja2dyb3VuZDp2YXIoLS1heC1ncmVlbik7Ym9yZGVyLWNvbG9yOnZhcigtLWF4LWdyZWVuKTtjb2xvcjojZmZmO2ZvbnQtd2VpZ2h0OjcwMDt9CiAgLmF4LWdyaWQgLmdwYWdpbmF0aW9uIC5ncC1idG4uZ3AtYXJyb3d7Y29sb3I6IzlhYTFhOTt9CiAgLmF4LWdyaWQgLmdwYWdpbmF0aW9uIC5ncC1yaWdodHtkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDoxNHB4O2ZsZXgtd3JhcDp3cmFwO30KICAuYXgtZ3JpZCAuZ3BhZ2luYXRpb24gLmdwLWl0ZW17ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6NHB4O3doaXRlLXNwYWNlOm5vd3JhcDt9CiAgLmF4LWdyaWQgLmdwYWdpbmF0aW9uIC5ncC1zZWxlY3QsLmF4LWdyaWQgLmdwYWdpbmF0aW9uIC5ncC1pbnB1dHtkaXNwbGF5OmlubGluZS1mbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyO2hlaWdodDoyMnB4O3BhZGRpbmc6MCA4cHg7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1heC1ib3JkZXIpO2JvcmRlci1yYWRpdXM6NHB4O2JhY2tncm91bmQ6I2ZmZjtjb2xvcjojMzc0MTUxO2ZvbnQtc2l6ZToxMXB4O2JveC1zaXppbmc6Ym9yZGVyLWJveDttaW4td2lkdGg6MjBweDt9CiAgLmF4LXRpdGxle3dpZHRoOjEwMCU7aGVpZ2h0OjEwMCU7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtmb250LXNpemU6MThweDtmb250LXdlaWdodDo4MDA7Y29sb3I6dmFyKC0tYXgtbmF2eSk7Z2FwOjhweDt9CiAgYm9keS5za2luLWNsYXNzaWMgLmF4LXRpdGxle2NvbG9yOiNjMTYxMGE7fQogIC8qIGxhYmVsICsgZmllbGQgc2V0ICovCiAgLmZsLXdyYXB7d2lkdGg6MTAwJTtoZWlnaHQ6MTAwJTtkaXNwbGF5OmZsZXg7Z2FwOjVweDttaW4td2lkdGg6MDt9CiAgLmZsLXdyYXAgLmZsLWxhYmVse2ZvbnQtc2l6ZToxMnB4O2NvbG9yOnZhcigtLWF4LWxhYmVsLWZnKTtmb250LXdlaWdodDo1MDA7d2hpdGUtc3BhY2U6bm93cmFwO2xpbmUtaGVpZ2h0OjEuMzt9CiAgYm9keS5za2luLWNsYXNzaWMgLmZsLXdyYXAgLmZsLWxhYmVse2JvcmRlci1ib3R0b206MXB4IHNvbGlkIHZhcigtLWF4LWJvcmRlcik7cGFkZGluZy1ib3R0b206MnB4O30KICAuZmwtd3JhcCAuZmwtYm9keXttaW4td2lkdGg6MDttaW4taGVpZ2h0OjA7ZmxleDoxO2Rpc3BsYXk6ZmxleDt9CiAgLmZsLXdyYXAgLmZsLWJvZHk+Knt3aWR0aDoxMDAlO30KICAuZmwtdG9we2ZsZXgtZGlyZWN0aW9uOmNvbHVtbjt9CiAgLmZsLWJvdHRvbXtmbGV4LWRpcmVjdGlvbjpjb2x1bW4tcmV2ZXJzZTt9CiAgLyogc2lkZSBsYXlvdXRzOiBsYWJlbCBrZWVwcyBpdHMgd2lkdGgsIGZpZWxkIGZpbGxzIHJlbWFpbmluZyB3aWR0aCBBTkQgZnVsbCBoZWlnaHQgKi8KICAuZmwtbGVmdHtmbGV4LWRpcmVjdGlvbjpyb3c7YWxpZ24taXRlbXM6c3RyZXRjaDtnYXA6OHB4O30KICAuZmwtcmlnaHR7ZmxleC1kaXJlY3Rpb246cm93LXJldmVyc2U7YWxpZ24taXRlbXM6c3RyZXRjaDtnYXA6OHB4O30KICAuZmwtbGVmdD4uZmwtbGFiZWwsLmZsLXJpZ2h0Pi5mbC1sYWJlbHtmbGV4Om5vbmU7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjttaW4td2lkdGg6NjRweDt9CiAgLmZsLWxlZnQ+LmZsLWJvZHksLmZsLXJpZ2h0Pi5mbC1ib2R5e2hlaWdodDoxMDAlO2FsaWduLWl0ZW1zOmNlbnRlcjt9CiAgLmZsLWxlZnQ+LmZsLWJvZHk+KiwuZmwtcmlnaHQ+LmZsLWJvZHk+KntoZWlnaHQ6MTAwJTt9CiAgLmxwLWdyaWR7ZGlzcGxheTpncmlkO2dyaWQtdGVtcGxhdGUtY29sdW1uczpyZXBlYXQoNCwxZnIpO2dhcDo0cHg7fQogIC5scC1idG57cGFkZGluZzo2cHggMnB4O2ZvbnQtc2l6ZToxMXB4O2JvcmRlcjoxcHggc29saWQgdmFyKC0tYXgtYm9yZGVyKTtiYWNrZ3JvdW5kOiNmYWZiZmM7Ym9yZGVyLXJhZGl1czo0cHg7Y3Vyc29yOnBvaW50ZXI7Y29sb3I6IzU1NTt9CiAgLmxwLWJ0bjpob3Zlcntib3JkZXItY29sb3I6dmFyKC0tYXgtZ3JlZW4pO30KICAubHAtYnRuLm9ue2JhY2tncm91bmQ6dmFyKC0tYXgtZ3JlZW4pO2JvcmRlci1jb2xvcjp2YXIoLS1heC1ncmVlbik7Y29sb3I6I2ZmZjtmb250LXdlaWdodDo2MDA7fQogIC8qIHRyZWUgKi8KICAuYXgtdHJlZXt3aWR0aDoxMDAlO2hlaWdodDoxMDAlO2JvcmRlcjoxcHggc29saWQgdmFyKC0tYXgtYm9yZGVyKTtib3JkZXItcmFkaXVzOjZweDtiYWNrZ3JvdW5kOiNmZmY7b3ZlcmZsb3c6YXV0bztwYWRkaW5nOjhweCAwO2ZvbnQtc2l6ZToxM3B4O30KICAuYXgtdHJlZSAudHctcm93e2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjZweDtoZWlnaHQ6MjhweDtwYWRkaW5nLXJpZ2h0OjEwcHg7cG9zaXRpb246cmVsYXRpdmU7d2hpdGUtc3BhY2U6bm93cmFwO2NvbG9yOiMzNzQxNTE7fQogIC5heC10cmVlIC50dy1yb3cgLnR3LXRvZ3t3aWR0aDoxNHB4O2ZsZXg6bm9uZTt0ZXh0LWFsaWduOmNlbnRlcjtjb2xvcjp2YXIoLS1heC1ncmVlbik7Zm9udC13ZWlnaHQ6NzAwO2ZvbnQtc2l6ZToxM3B4O2xpbmUtaGVpZ2h0OjE7dXNlci1zZWxlY3Q6bm9uZTt9CiAgLmF4LXRyZWUgLnR3LXJvdyAudHctdG9nLmxlYWZ7Y29sb3I6I2MzY2FkMTtmb250LXdlaWdodDo0MDA7fQogIC5heC10cmVlIC50dy1yb3cgLnR3LWxibHtvdmVyZmxvdzpoaWRkZW47dGV4dC1vdmVyZmxvdzplbGxpcHNpczt9CiAgLmF4LXRyZWUgLnR3LXJvdy5vbntiYWNrZ3JvdW5kOnZhcigtLWF4LWdyZWVuLWxpZ2h0KTtjb2xvcjp2YXIoLS1heC1ncmVlbi1kYXJrKTtmb250LXdlaWdodDo2MDA7fQogIC5heC10cmVlIC50dy1ndWlkZXtwb3NpdGlvbjphYnNvbHV0ZTt0b3A6MDtib3R0b206MDt3aWR0aDowO2JvcmRlci1sZWZ0OjFweCBkYXNoZWQgI2Q2ZGNlMjt9CiAgLmF4LXRyZWUubm9saW5lcyAudHctZ3VpZGV7ZGlzcGxheTpub25lO30KICAudHJlZS10YXt3aWR0aDoxMDAlO3BhZGRpbmc6NnB4IDhweDtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWF4LWJvcmRlcik7Ym9yZGVyLXJhZGl1czo0cHg7Zm9udC1zaXplOjEycHg7Zm9udC1mYW1pbHk6aW5oZXJpdDtsaW5lLWhlaWdodDoxLjY7cmVzaXplOnZlcnRpY2FsO3doaXRlLXNwYWNlOnByZTtvdmVyZmxvdy14OmF1dG87fQogIC5heC1jaGFydHt3aWR0aDoxMDAlO2hlaWdodDoxMDAlO2JvcmRlcjoxcHggc29saWQgI2VlZjBmMjtib3JkZXItcmFkaXVzOjEwcHg7YmFja2dyb3VuZDojZmZmO2JveC1zaGFkb3c6MCAxcHggNHB4IHJnYmEoMCwwLDAsLjA1KTtwYWRkaW5nOjEycHggMTRweDtkaXNwbGF5OmZsZXg7ZmxleC1kaXJlY3Rpb246Y29sdW1uO292ZXJmbG93OmhpZGRlbjt9CiAgLmF4LWNoYXJ0IC5jdGl0bGV7Zm9udC1zaXplOjE0cHg7Zm9udC13ZWlnaHQ6ODAwO2NvbG9yOnZhcigtLWF4LW5hdnkpO2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjZweDttYXJnaW4tYm90dG9tOjhweDt9CiAgLmF4LWNoYXJ0IC5jdGl0bGUgLmFyd3tjb2xvcjojOWFhNGFkO2ZvbnQtd2VpZ2h0OjYwMDt9CiAgLmF4LWNoYXJ0IC5jYm9keXtmbGV4OjE7bWluLWhlaWdodDowO2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcjt9CiAgLmF4LWNoYXJ0IHN2Z3t3aWR0aDoxMDAlO2hlaWdodDoxMDAlO2Rpc3BsYXk6YmxvY2s7fQogIC5heC1jaGFydCAubGVnZW5ke2ZvbnQtc2l6ZToxMXB4O2NvbG9yOiM1NTU7ZGlzcGxheTpmbGV4O2ZsZXgtZGlyZWN0aW9uOmNvbHVtbjtnYXA6NHB4O2p1c3RpZnktY29udGVudDpjZW50ZXI7cGFkZGluZy1sZWZ0OjEwcHg7fQogIC5heC1jaGFydCAubGVnZW5kIC5sZ3tkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDo1cHg7d2hpdGUtc3BhY2U6bm93cmFwO30KICAuYXgtY2hhcnQgLmxlZ2VuZCAuc3d7d2lkdGg6MTFweDtoZWlnaHQ6MTFweDtib3JkZXItcmFkaXVzOjNweDtmbGV4Om5vbmU7fQogIC5heC1zZWFyY2h7d2lkdGg6MTAwJTtoZWlnaHQ6MTAwJTtiYWNrZ3JvdW5kOiNmZmY7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1heC1ib3JkZXIpO2JvcmRlci1yYWRpdXM6OHB4O3BhZGRpbmc6MTRweCAxNnB4O2Rpc3BsYXk6ZmxleDtnYXA6MTRweDtvdmVyZmxvdzpoaWRkZW47Ym94LXNoYWRvdzowIDFweCAzcHggcmdiYSgwLDAsMCwuMDQpO30KICAuYXgtc2VhcmNoIC5zZmllbGRze2ZsZXg6MTtkaXNwbGF5OmdyaWQ7Z3JpZC10ZW1wbGF0ZS1jb2x1bW5zOnJlcGVhdCg0LDFmcik7Z2FwOjEycHggMjBweDthbGlnbi1jb250ZW50OnN0YXJ0O21pbi13aWR0aDowO30KICAuYXgtc2VhcmNoIC5zZmllbGR7ZGlzcGxheTpmbGV4O2ZsZXgtZGlyZWN0aW9uOmNvbHVtbjtnYXA6NXB4O21pbi13aWR0aDowO30KICAuYXgtc2VhcmNoIC5zZmllbGQucmFkaW97anVzdGlmeS1jb250ZW50OmZsZXgtc3RhcnQ7fQogIC8qIMK97Lm4KGhhbGYtY29sdW1uKTog65GQIOqwnOqwgCDsl7Dri6zslYQg7J6I7Jy866m0IO2VnCDsubjsnYQg67CY67CY7JSpIOuCmOuIoCDsk7Dqs6Ao7JqU7LKt7KGw7KeBL+q1rOunpOyhsOyngeyymOufvCksCiAgICAg7Zi87J6Q66m0IO2VnCDsubjsnZgg7KCI67CY66eMIOyxhOyasOqzoCDrgpjrqLjsp4Ag7KCI67CY7J2AIOu5hOybjOuRlOuLpCjri6TsnYwg7ZWE65Oc6rCAIOq3uCDsnpDrpqzroZwg67CA66Ck7Jik7KeAIOyViuqyjCkuICovCiAgLmF4LXNlYXJjaCAuc2ZpZWxkLWhhbGZzbG90e2Rpc3BsYXk6ZmxleDtnYXA6MTBweDttaW4td2lkdGg6MDt9CiAgLmF4LXNlYXJjaCAuc2ZpZWxkLWhhbGZzbG90IC5zZmllbGQtaGFsZntmbGV4OjEgMSAwO21pbi13aWR0aDowO30KICAuYXgtc2VhcmNoIC5zZmllbGQtaGFsZnNsb3QgLnNmaWVsZC1oYWxmLWJsYW5re2ZsZXg6MSAxIDA7bWluLXdpZHRoOjA7fQogIC5heC1zZWFyY2ggLnNmaWVsZCAuc2xhYmVse2ZvbnQtc2l6ZToxMnB4O2NvbG9yOnZhcigtLWF4LWxhYmVsLWZnKTtmb250LXdlaWdodDo1MDA7d2hpdGUtc3BhY2U6bm93cmFwOwogICAgbWluLWhlaWdodDoxNXB4O2xpbmUtaGVpZ2h0OjE1cHg7fQogIC8qIGtlZXAgYW4gZW1wdHkgbGFiZWwgb2NjdXB5aW5nIGl0cyBsaW5lIHNvIGZpZWxkcyB3aXRoIGFuZCB3aXRob3V0IGEgbGFiZWwgYWxpZ24gKi8KICAuYXgtc2VhcmNoIC5zZmllbGQgLnNsYWJlbDplbXB0eTo6YmVmb3Jle2NvbnRlbnQ6IlwwMGEwIjt9CiAgLmF4LXNlYXJjaCAuc2ZpZWxkIC5zbGFiZWwgLnJlcXtjb2xvcjp2YXIoLS1heC1yZXEpO21hcmdpbi1sZWZ0OjJweDt9CiAgLyogRmF0IE1vZGXsl5DshJzripQg7KGw7ZqM7KGw6rG0IOudvOuyqOuPhCDsnITsqr0g64yA7IugIOyZvOyqveyXkCDrhpPsnbjri6QuIFRoaW4gTW9kZeuKlCDqt7jrjIDroZwg7JyE7Kq9LiAqLwogIGJvZHkuc2tpbi1jbGFzc2ljIC5heC1zZWFyY2ggLnNmaWVsZHtmbGV4LWRpcmVjdGlvbjpyb3c7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDo4cHg7fQogIGJvZHkuc2tpbi1jbGFzc2ljIC5heC1zZWFyY2ggLnNmaWVsZCAuc2xhYmVse2ZsZXg6bm9uZTttaW4td2lkdGg6NjRweDttaW4taGVpZ2h0OjA7bGluZS1oZWlnaHQ6MS4zO3doaXRlLXNwYWNlOm5vd3JhcDt9CiAgLmF4LXNlYXJjaCAuc2N0bHtoZWlnaHQ6MzJweDtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWF4LWJvcmRlcik7Ym9yZGVyLXJhZGl1czo0cHg7YmFja2dyb3VuZDojZmZmO3BhZGRpbmc6MCA4cHg7Zm9udC1zaXplOjEycHg7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtjb2xvcjojOGI5NWExO3dpZHRoOjEwMCU7fQogIC8qIHJlYWQtb25seSBzZWFyY2ggY29uZGl0aW9uOiBncmV5ZWQgb3V0IGFuZCBub24taW50ZXJhY3RpdmUgKi8KICAuYXgtc2VhcmNoIC5zY3RsLnJvLC5heC1zZWFyY2ggLnNjdGwucm8udGV4dHtiYWNrZ3JvdW5kOiNmNmY3Zjg7Y29sb3I6IzlhYTRhZDtjdXJzb3I6ZGVmYXVsdDt9CiAgLmF4LXNlYXJjaCAuc2N0bC5ybyBpbnB1dHtiYWNrZ3JvdW5kOnRyYW5zcGFyZW50O2NvbG9yOiM5YWE0YWQ7Y3Vyc29yOmRlZmF1bHQ7cG9pbnRlci1ldmVudHM6bm9uZTt9CiAgLmF4LXNlYXJjaCAuc2N0bC5ybzo6YWZ0ZXJ7b3BhY2l0eTouNDU7fQogIC5heC1zZWFyY2ggLnNyYWRpby5yb3tvcGFjaXR5Oi41NTtjdXJzb3I6ZGVmYXVsdDtwb2ludGVyLWV2ZW50czpub25lO30KICAuYXgtc2VhcmNoIC5zY3RsLmNvbWJvLC5heC1zZWFyY2ggLnNjdGwuZGF0ZSwuYXgtc2VhcmNoIC5zY3RsLmRhdGVyYW5nZXtqdXN0aWZ5LWNvbnRlbnQ6c3BhY2UtYmV0d2Vlbjt9CiAgLmF4LXNlYXJjaCAuc2N0bC5jb21ibzo6YWZ0ZXJ7Y29udGVudDoi4pa+Ijtjb2xvcjp2YXIoLS1heC1ncmF5KTtmb250LXNpemU6MTFweDt9CiAgLmF4LXNlYXJjaCAuc2N0bC5kYXRlOjphZnRlciwuYXgtc2VhcmNoIC5zY3RsLmRhdGVyYW5nZTo6YWZ0ZXJ7Y29udGVudDoi8J+ThSI7Zm9udC1zaXplOjEycHg7fQogIC5heC1zZWFyY2ggLnNjdGwuc2VhcmNoe2p1c3RpZnktY29udGVudDpmbGV4LWVuZDtnYXA6OHB4O30KICAuc2N0bC1zZWFyY2gtaWN7d2lkdGg6MTRweDtoZWlnaHQ6MTRweDtmbGV4Om5vbmU7YmFja2dyb3VuZC1jb2xvcjojNmI3MjgwOwogICAgLXdlYmtpdC1tYXNrOm5vLXJlcGVhdCBjZW50ZXIvY29udGFpbiB1cmwoImRhdGE6aW1hZ2Uvc3ZnK3htbCwlM0NzdmcgeG1sbnM9J2h0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnJyB2aWV3Qm94PScwIDAgMjQgMjQnIGZpbGw9J25vbmUnIHN0cm9rZT0nJTIzMDAwJyBzdHJva2Utd2lkdGg9JzIuMicgc3Ryb2tlLWxpbmVjYXA9J3JvdW5kJyBzdHJva2UtbGluZWpvaW49J3JvdW5kJyUzRSUzQ2NpcmNsZSBjeD0nMTEnIGN5PScxMScgcj0nNycvJTNFJTNDbGluZSB4MT0nMjEnIHkxPScyMScgeDI9JzE2LjY1JyB5Mj0nMTYuNjUnLyUzRSUzQy9zdmclM0UiKTsKICAgIG1hc2s6bm8tcmVwZWF0IGNlbnRlci9jb250YWluIHVybCgiZGF0YTppbWFnZS9zdmcreG1sLCUzQ3N2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAyNCAyNCcgZmlsbD0nbm9uZScgc3Ryb2tlPSclMjMwMDAnIHN0cm9rZS13aWR0aD0nMi4yJyBzdHJva2UtbGluZWNhcD0ncm91bmQnIHN0cm9rZS1saW5lam9pbj0ncm91bmQnJTNFJTNDY2lyY2xlIGN4PScxMScgY3k9JzExJyByPSc3Jy8lM0UlM0NsaW5lIHgxPScyMScgeTE9JzIxJyB4Mj0nMTYuNjUnIHkyPScxNi42NScvJTNFJTNDL3N2ZyUzRSIpO30KICAuYXgtc2VhcmNoIC5zY3RsLnJvIC5zY3RsLXNlYXJjaC1pY3tvcGFjaXR5Oi40NTt9CiAgLmF4LXNlYXJjaCAuc3NlYXJjaCAuc2N0bC1zZWFyY2gtaWN7YmFja2dyb3VuZC1jb2xvcjojZmZmO30KICAuYXgtc2VhcmNoIC5zY3RsLnRleHR7Y29sb3I6IzExMTt9CiAgLmF4LXNlYXJjaCAuc3JhZGlve2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjE0cHg7aGVpZ2h0OjMycHg7fQogIC5heC1zZWFyY2ggLnNyYWRpbyAub3B0e2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjVweDtmb250LXNpemU6MTJweDtjb2xvcjojMzc0MTUxO30KICAuYXgtc2VhcmNoIC5zcmFkaW8gLm9wdCAuZG90e3dpZHRoOjE0cHg7aGVpZ2h0OjE0cHg7Ym9yZGVyOjEuNXB4IHNvbGlkIHZhcigtLWF4LWdyZWVuKTtib3JkZXItcmFkaXVzOjUwJTtwb3NpdGlvbjpyZWxhdGl2ZTtmbGV4Om5vbmU7fQogIC5heC1zZWFyY2ggLnNyYWRpbyAub3B0IC5kb3Q6OmFmdGVye2NvbnRlbnQ6IiI7cG9zaXRpb246YWJzb2x1dGU7aW5zZXQ6M3B4O2JhY2tncm91bmQ6dmFyKC0tYXgtZ3JlZW4pO2JvcmRlci1yYWRpdXM6NTAlO2Rpc3BsYXk6bm9uZTt9CiAgLmF4LXNlYXJjaCAuc3JhZGlvIC5vcHQub24gLmRvdDo6YWZ0ZXJ7ZGlzcGxheTpibG9jazt9CiAgLmF4LXNlYXJjaCAuc2FjdGlvbnN7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmZsZXgtc3RhcnQ7Z2FwOjZweDtmbGV4Om5vbmU7cGFkZGluZy10b3A6MjBweDt9CiAgLmF4LXNlYXJjaCAuc2V4cGFuZHt3aWR0aDozMnB4O2hlaWdodDozMnB4O2JvcmRlcjoxcHggc29saWQgdmFyKC0tYXgtZ3JlZW4pO2JvcmRlci1yYWRpdXM6NHB4O2JhY2tncm91bmQ6I2VhZjZmMDtjb2xvcjp2YXIoLS1heC1ncmVlbik7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyO2ZvbnQtc2l6ZToxNnB4O2ZvbnQtd2VpZ2h0OjcwMDtsaW5lLWhlaWdodDoxO30KICAuYXgtc2VhcmNoIC5zc2VhcmNoe2hlaWdodDozMnB4O2JvcmRlci1yYWRpdXM6NHB4O2JhY2tncm91bmQ6dmFyKC0tYXgtZ3JlZW4pO2NvbG9yOiNmZmY7Zm9udC1zaXplOjEzcHg7Zm9udC13ZWlnaHQ6NjAwO2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjVweDtwYWRkaW5nOjAgMThweDt9CiAgLmF4LXNlYXJjaC5jb2xsYXBzZWR7YWxpZ24taXRlbXM6Y2VudGVyO2p1c3RpZnktY29udGVudDpjZW50ZXI7Y29sb3I6IzlhYTRhZDtmb250LXNpemU6MTJweDtwYWRkaW5nOjhweDttaW4taGVpZ2h0OjA7fQogIC5heC1zZWFyY2guY29sbGFwc2VkIC5zZmllbGRzLC5heC1zZWFyY2guY29sbGFwc2VkIC5zYWN0aW9uc3tkaXNwbGF5Om5vbmU7fQogIC5heC1zZWFyY2ggLnNjb2xsYXBzZWQtbXNne2Rpc3BsYXk6bm9uZTt9CiAgLmF4LXNlYXJjaC5jb2xsYXBzZWQgLnNjb2xsYXBzZWQtbXNne2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjZweDt9CgogIC8qIFRhYiBjb21wb25lbnQgKi8KICAuYXgtdGFicy13cmFwe3dpZHRoOjEwMCU7aGVpZ2h0OjEwMCU7cG9zaXRpb246cmVsYXRpdmU7fQogIC5heC10YWJzLXdyYXAgLmF4LXRhYnMtaGVhZHtwb3NpdGlvbjphYnNvbHV0ZTtsZWZ0OjA7dG9wOjA7cmlnaHQ6MDtoZWlnaHQ6NDBweDtkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6ZmxleC1lbmQ7Z2FwOjIycHg7Ym9yZGVyLWJvdHRvbToxcHggc29saWQgdmFyKC0tYXgtYm9yZGVyKTtwYWRkaW5nOjAgMnB4O30KICAuYXgtdGFicy13cmFwIC5heHRhYi1pdGVte3BhZGRpbmc6MCAycHggMTBweDtmb250LXNpemU6MTNweDtjb2xvcjp2YXIoLS1heC1ncmF5KTtjdXJzb3I6cG9pbnRlcjtib3JkZXItYm90dG9tOjJweCBzb2xpZCB0cmFuc3BhcmVudDt3aGl0ZS1zcGFjZTpub3dyYXA7dXNlci1zZWxlY3Q6bm9uZTt9CiAgLmF4LXRhYnMtd3JhcCAuYXh0YWItaXRlbS5vbntjb2xvcjp2YXIoLS1heC1ncmVlbi1kYXJrKTtmb250LXdlaWdodDo3MDA7Ym9yZGVyLWJvdHRvbS1jb2xvcjp2YXIoLS1heC1ncmVlbik7fQogIC5heC10YWJzLXdyYXAgLmF4dGFiLWl0ZW06aG92ZXJ7Y29sb3I6dmFyKC0tYXgtZ3JlZW4tZGFyayk7fQogIC50YWJzLWJvZHktaGludHtvdXRsaW5lOjFweCBkYXNoZWQgcmdiYSgzOCwxMjgsMjM1LC4yMik7b3V0bGluZS1vZmZzZXQ6LTFweDt9CiAgLnBhbmVsLWJvZHktaGludHtvdXRsaW5lOjFweCBkYXNoZWQgcmdiYSgzOCwxMjgsMjM1LC4yMik7b3V0bGluZS1vZmZzZXQ6LTFweDt9CiAgLyogIWltcG9ydGFudCBpcyByZXF1aXJlZCBoZXJlOiB0aGUgcGFuZS9ib2R5IGVsZW1lbnRzIHNldCBvdmVyZmxvdyB2aWEgaW5saW5lIHN0eWxlCiAgICAgKHNvIGl0IGNhbid0IGJlIG92ZXJyaWRkZW4gYnkgYSBwbGFpbiBjbGFzcyBydWxlKSwgYnV0IHdoaWxlIGEgY29tcG9uZW50IGlzIGJlaW5nCiAgICAgZHJhZ2dlZCBvdXQgd2UgbmVlZCBpdCB0byBzdGF5IGZ1bGx5IHZpc2libGUgaW5zdGVhZCBvZiBnZXR0aW5nIGNsaXBwZWQgYXQgdGhlIGVkZ2UuICovCiAgI2NhbnZhcy5yZXBhcmVudC1kcmFnIC50YWJzLWJvZHktd3JhcHtvdmVyZmxvdzp2aXNpYmxlIWltcG9ydGFudDt9CiAgI2NhbnZhcy5yZXBhcmVudC1kcmFnIC5zcGxpdC1wYW5le292ZXJmbG93OnZpc2libGUhaW1wb3J0YW50O30KICAuYXgtcmFkaW97ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6NnB4O2ZvbnQtc2l6ZToxMnB4O2hlaWdodDoxMDAlO30KICAuYXgtcmFkaW8gLmRvdHt3aWR0aDoxNHB4O2hlaWdodDoxNHB4O2JvcmRlcjoxLjVweCBzb2xpZCB2YXIoLS1heC1ncmVlbik7Ym9yZGVyLXJhZGl1czo1MCU7cG9zaXRpb246cmVsYXRpdmU7fQogIC5heC1yYWRpbyAuZG90OjphZnRlcntjb250ZW50OiIiO3Bvc2l0aW9uOmFic29sdXRlO2luc2V0OjNweDtiYWNrZ3JvdW5kOnZhcigtLWF4LWdyZWVuKTtib3JkZXItcmFkaXVzOjUwJTt9CgogIC8qIFByb3BlcnRpZXMgKi8KICAucHJvcHN7YmFja2dyb3VuZDojZmZmO2JvcmRlci1sZWZ0OjFweCBzb2xpZCB2YXIoLS1heC1ib3JkZXIpO292ZXJmbG93LXk6YXV0bztwYWRkaW5nOjEycHg7fQogIC5wcm9wcyBoM3tmb250LXNpemU6MTJweDtjb2xvcjp2YXIoLS1heC1uYXZ5KTttYXJnaW4tYm90dG9tOjEwcHg7cGFkZGluZy1ib3R0b206NnB4O2JvcmRlci1ib3R0b206MnB4IHNvbGlkIHZhcigtLWF4LWdyZWVuKTtmb250LXdlaWdodDo3MDA7fQogIC5wcm9we21hcmdpbi1ib3R0b206OXB4O30KICAucHJvcCBsYWJlbHtkaXNwbGF5OmJsb2NrO2ZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLWF4LWdyYXkpO21hcmdpbi1ib3R0b206M3B4O30KICAucHJvcCBpbnB1dCwucHJvcCBzZWxlY3QsLnByb3AgdGV4dGFyZWF7d2lkdGg6MTAwJTtwYWRkaW5nOjVweCA3cHg7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1heC1ib3JkZXIpO2JvcmRlci1yYWRpdXM6NHB4O2ZvbnQtc2l6ZToxMnB4O2ZvbnQtZmFtaWx5OmluaGVyaXQ7fQogIC5wcm9wLXJvd3tkaXNwbGF5OmZsZXg7Z2FwOjZweDt9CiAgLnByb3Atcm93IC5wcm9we2ZsZXg6MTt9CiAgLnByb3AgLmNieHtkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDo2cHg7Zm9udC1zaXplOjEycHg7fQogIC5wcm9wIC5jYnggaW5wdXR7d2lkdGg6YXV0bzt9CiAgLmVtcHR5LXByb3Bze2NvbG9yOiM5Y2EzYWY7Zm9udC1zaXplOjEycHg7dGV4dC1hbGlnbjpjZW50ZXI7cGFkZGluZzozMHB4IDEwcHg7bGluZS1oZWlnaHQ6MS42O30KICAuZGVsLWJ0bnt3aWR0aDoxMDAlO2JhY2tncm91bmQ6I2ZkZWNlYztjb2xvcjp2YXIoLS1heC1yZXEpO2JvcmRlcjoxcHggc29saWQgI2Y1YzJjNDtwYWRkaW5nOjdweDtib3JkZXItcmFkaXVzOjRweDtjdXJzb3I6cG9pbnRlcjtmb250LXNpemU6MTJweDttYXJnaW4tdG9wOjhweDtmb250LXdlaWdodDo2MDA7fQogIC5kZWwtYnRuOmhvdmVye2JhY2tncm91bmQ6I2ZiZGNkYzt9CiAgLmdhcC1hZGp1c3R7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1heC1ib3JkZXIpO2JvcmRlci1yYWRpdXM6NnB4O3BhZGRpbmc6MTBweDttYXJnaW4tYm90dG9tOjEycHg7YmFja2dyb3VuZDojZmFmYmZjO30KICAuZ2FwLXJvd3ttYXJnaW4tYm90dG9tOjhweDt9CiAgLmdhcC1yb3c6bGFzdC1vZi10eXBle21hcmdpbi1ib3R0b206MDt9CiAgLmdhcC1yb3cgbGFiZWx7ZGlzcGxheTpibG9jaztmb250LXNpemU6MTJweDtjb2xvcjojNTU1O21hcmdpbi1ib3R0b206NHB4O2ZvbnQtd2VpZ2h0OjYwMDt9CiAgLmdhcC1yb3cgLmdhcC12YWx7Zm9udC13ZWlnaHQ6NDAwO2NvbG9yOnZhcigtLWF4LWdyZWVuKTttYXJnaW4tbGVmdDo0cHg7fQogIC5nYXAtcm93IC5nYXAtbnVte3dpZHRoOjU2cHg7cGFkZGluZzoycHggNHB4O2ZvbnQtc2l6ZToxMnB4O2JvcmRlcjoxcHggc29saWQgdmFyKC0tYXgtYm9yZGVyKTtib3JkZXItcmFkaXVzOjNweDtjb2xvcjp2YXIoLS1heC1ncmVlbik7Zm9udC13ZWlnaHQ6NjAwO3RleHQtYWxpZ246cmlnaHQ7bWFyZ2luLWxlZnQ6NHB4O30KICAuZ2FwLXJvdyAuZ2FwLW51bTpmb2N1c3tvdXRsaW5lOm5vbmU7Ym9yZGVyLWNvbG9yOnZhcigtLWF4LWdyZWVuKTt9CiAgLmdhcC1yb3cgLmdhcC11bml0e2ZvbnQtc2l6ZToxMXB4O2NvbG9yOiM5Y2EzYWY7bWFyZ2luLWxlZnQ6MnB4O2ZvbnQtd2VpZ2h0OjQwMDt9CiAgLmdhcC1yb3cgaW5wdXRbdHlwZT1yYW5nZV17d2lkdGg6MTAwJTthY2NlbnQtY29sb3I6dmFyKC0tYXgtZ3JlZW4pO2N1cnNvcjpwb2ludGVyO30KICAuaGludHtmb250LXNpemU6MTFweDtjb2xvcjojOWNhM2FmO21hcmdpbi10b3A6NHB4O2xpbmUtaGVpZ2h0OjEuNTt9CiAgLyogU21hbGwgIj8iIGJhZGdlIHRoYXQgcmV2ZWFscyBpdHMgZXhwbGFuYXRpb24gYXMgYSBob3ZlciB0b29sdGlwLCBzbyBsb25nCiAgICAgZGVzY3JpcHRpb25zIG5vIGxvbmdlciB0YWtlIHVwIHBlcm1hbmVudCBzcGFjZSBpbiB0aGUgcHJvcGVydHkgcGFuZWwuICovCiAgLyogVGhlIC5wcm9wIHJvdyBpcyB0aGUgcG9zaXRpb25pbmcgY29udGV4dCBzbyB0aGUgdG9vbHRpcCBjYW4gc3BhbiB0aGUgZnVsbCBwYW5lbAogICAgIHdpZHRoIHJlZ2FyZGxlc3Mgb2Ygd2hlcmUgdGhlIGJhZGdlIHNpdHMsIGluc3RlYWQgb2Ygb3ZlcmZsb3dpbmcgcGFzdCB0aGUgbGVmdCBlZGdlLiAqLwogIC5wcm9we3Bvc2l0aW9uOnJlbGF0aXZlO30KICAucWhlbHB7ZGlzcGxheTppbmxpbmUtZmxleDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcjt3aWR0aDoxNHB4O2hlaWdodDoxNHB4O2JvcmRlci1yYWRpdXM6NTAlOwogICAgYmFja2dyb3VuZDojYzNjYmQzO2NvbG9yOiNmZmY7Zm9udC1zaXplOjEwcHg7Zm9udC13ZWlnaHQ6NzAwO2xpbmUtaGVpZ2h0OjE7Y3Vyc29yOmhlbHA7cG9zaXRpb246c3RhdGljOwogICAgbWFyZ2luLWxlZnQ6NXB4O3ZlcnRpY2FsLWFsaWduOm1pZGRsZTtmbGV4Om5vbmU7dXNlci1zZWxlY3Q6bm9uZTt9CiAgLnFoZWxwOmhvdmVye2JhY2tncm91bmQ6dmFyKC0tYXgtZ3JlZW4pO30KICAucHJvcCAuY2J4IC5xaGVscHttYXJnaW4tbGVmdDowO30gICAvKiBmbGV4IGxhYmVsIGFscmVhZHkgc3VwcGxpZXMgdGhlIGdhcCAqLwogIC5xaGVscCAucXRpcHtkaXNwbGF5Om5vbmU7cG9zaXRpb246YWJzb2x1dGU7bGVmdDowO3JpZ2h0OjA7dG9wOjEwMCU7d2lkdGg6YXV0bztiYWNrZ3JvdW5kOiMyZjM5NDQ7Y29sb3I6I2YxZjRmNzsKICAgIGZvbnQtc2l6ZToxMXB4O2ZvbnQtd2VpZ2h0OjQwMDtsaW5lLWhlaWdodDoxLjU1O3RleHQtYWxpZ246bGVmdDtwYWRkaW5nOjhweCAxMHB4O2JvcmRlci1yYWRpdXM6NnB4OwogICAgYm94LXNoYWRvdzowIDRweCAxNHB4IHJnYmEoMCwwLDAsLjIyKTt6LWluZGV4OjkwMDt3aGl0ZS1zcGFjZTpub3JtYWw7Y3Vyc29yOmRlZmF1bHQ7Ym94LXNpemluZzpib3JkZXItYm94O21hcmdpbi10b3A6M3B4O30KICAucWhlbHAgLnF0aXAgYntjb2xvcjojOGZlM2I4O2ZvbnQtd2VpZ2h0OjcwMDt9CiAgLnFoZWxwOmhvdmVyIC5xdGlwe2Rpc3BsYXk6YmxvY2s7fQogIC56aS1yb3d7ZGlzcGxheTpmbGV4O2dhcDo0cHg7bWFyZ2luLXRvcDo0cHg7fQogIC56aS1yb3cgYnV0dG9ue2ZsZXg6MTtwYWRkaW5nOjRweDtmb250LXNpemU6MTFweDtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWF4LWJvcmRlcik7YmFja2dyb3VuZDojZmFmYmZjO2JvcmRlci1yYWRpdXM6NHB4O2N1cnNvcjpwb2ludGVyO30KICAuemktcm93IGJ1dHRvbjpob3ZlcntiYWNrZ3JvdW5kOiNlZWYyZjU7fQogIC5ncnB7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1heC1ib3JkZXIpO2JvcmRlci1yYWRpdXM6NnB4O3BhZGRpbmc6OXB4O21hcmdpbi1ib3R0b206OXB4O2JhY2tncm91bmQ6I2ZhZmJmYzt9CiAgLmdycC1oe2ZvbnQtc2l6ZToxMXB4O2ZvbnQtd2VpZ2h0OjcwMDtjb2xvcjp2YXIoLS1heC1ncmVlbi1kYXJrKTttYXJnaW4tYm90dG9tOjdweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjNweDt9CiAgLyog7KCR7Z6MIOychOy5mMK37YGs6riwIOq3uOujueydgCDslofsnYAg67CU7LKY65+8IOuztOydtOuPhOuhnSDrsJXsiqQg7Jes67CxL+uwsOqyveydhCDspITsnbjri6QgKi8KICAucG9zc2l6ZS1ncnAuY29sbGFwc2Vke3BhZGRpbmc6M3B4IDZweDtiYWNrZ3JvdW5kOnRyYW5zcGFyZW50O30KICAucG9zc2l6ZS1ncnAuY29sbGFwc2VkIC5ncnAtaHttYXJnaW4tYm90dG9tOjA7fQogIC51YnRuLWxpc3R7ZGlzcGxheTpmbGV4O2ZsZXgtZGlyZWN0aW9uOmNvbHVtbjtnYXA6NXB4O21hcmdpbi1ib3R0b206NnB4O30KICAudWJ0bi1yb3d7ZGlzcGxheTpmbGV4O2dhcDo0cHg7YWxpZ24taXRlbXM6Y2VudGVyO30KICAudWJ0bi1yb3cgaW5wdXR7ZmxleDoxO3BhZGRpbmc6NHB4IDZweDtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWF4LWJvcmRlcik7Ym9yZGVyLXJhZGl1czo0cHg7Zm9udC1zaXplOjEycHg7fQogIC51YnRuLXRnbHtmb250LXNpemU6MTBweDtwYWRkaW5nOjRweCA2cHg7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1heC1ib3JkZXIpO2JhY2tncm91bmQ6I2ZmZjtib3JkZXItcmFkaXVzOjRweDtjdXJzb3I6cG9pbnRlcjtjb2xvcjojODg4O3doaXRlLXNwYWNlOm5vd3JhcDt9CiAgLnVidG4tdGdsLm9ue2JhY2tncm91bmQ6I2Y1ZjZmNztjb2xvcjp2YXIoLS1heC1yZXEpO2JvcmRlci1jb2xvcjojZTVjMmM0O2ZvbnQtd2VpZ2h0OjYwMDt9CiAgLnVidG4tZGVse3dpZHRoOjI0cHg7cGFkZGluZzo0cHg7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1heC1ib3JkZXIpO2JhY2tncm91bmQ6I2ZmZjtib3JkZXItcmFkaXVzOjRweDtjdXJzb3I6cG9pbnRlcjtjb2xvcjp2YXIoLS1heC1yZXEpO2ZvbnQtc2l6ZToxNHB4O2xpbmUtaGVpZ2h0OjE7fQogIC51YnRuLWRlbDpob3ZlcntiYWNrZ3JvdW5kOiNmZGVjZWM7fQogIC51YnRuLWFkZHt3aWR0aDoxMDAlO3BhZGRpbmc6NnB4O2JvcmRlcjoxcHggZGFzaGVkIHZhcigtLWF4LWdyZWVuKTtiYWNrZ3JvdW5kOnZhcigtLWF4LWdyZWVuLWxpZ2h0KTtjb2xvcjp2YXIoLS1heC1ncmVlbi1kYXJrKTtib3JkZXItcmFkaXVzOjRweDtjdXJzb3I6cG9pbnRlcjtmb250LXNpemU6MTJweDtmb250LXdlaWdodDo2MDA7fQogIC51YnRuLWFkZDpob3ZlcntiYWNrZ3JvdW5kOiNkY2YwZTY7fQogIC5zZmllbGQtbGlzdHtkaXNwbGF5OmZsZXg7ZmxleC1kaXJlY3Rpb246Y29sdW1uO2dhcDo1cHg7bWFyZ2luLWJvdHRvbTo2cHg7fQogIC5zZmllbGQtcm93e2Rpc3BsYXk6ZmxleDtmbGV4LWRpcmVjdGlvbjpjb2x1bW47Z2FwOjVweDtwYWRkaW5nLWJvdHRvbTo4cHg7bWFyZ2luLWJvdHRvbTo4cHg7Ym9yZGVyLWJvdHRvbToxcHggc29saWQgI2VlZTt9CiAgLnNmaWVsZC1yb3c6bGFzdC1vZi10eXBle2JvcmRlci1ib3R0b206bm9uZTttYXJnaW4tYm90dG9tOjA7cGFkZGluZy1ib3R0b206MDt9CiAgLnNmaWVsZC1yb3cgLnNmLXJvdzEsLnNmaWVsZC1yb3cgLnNmLXJvdzJ7ZGlzcGxheTpmbGV4O2dhcDo0cHg7YWxpZ24taXRlbXM6Y2VudGVyO30KICAuc2ZpZWxkLXJvdyAuc2YtbGFiZWx7ZmxleDoxO21pbi13aWR0aDowO3BhZGRpbmc6NHB4IDZweDtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWF4LWJvcmRlcik7Ym9yZGVyLXJhZGl1czo0cHg7Zm9udC1zaXplOjEycHg7fQogIC5zZmllbGQtcm93IC5zZi12YWx1ZXtmbGV4OjEgMSAwO21pbi13aWR0aDowO3BhZGRpbmc6NHB4IDZweDtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWF4LWJvcmRlcik7Ym9yZGVyLXJhZGl1czo0cHg7Zm9udC1zaXplOjExcHg7Y29sb3I6IzMzMzt9CiAgLnNmaWVsZC1yb3cgLnNmLXR5cGV7cGFkZGluZzo0cHggNHB4O2JvcmRlcjoxcHggc29saWQgdmFyKC0tYXgtYm9yZGVyKTtib3JkZXItcmFkaXVzOjRweDtmb250LXNpemU6MTFweDtiYWNrZ3JvdW5kOiNmZmY7fQogIC5zZmllbGQtcm93IC5zZi1zcGFue3BhZGRpbmc6NHB4IDJweDtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWF4LWJvcmRlcik7Ym9yZGVyLXJhZGl1czo0cHg7Zm9udC1zaXplOjExcHg7YmFja2dyb3VuZDojZmZmO3dpZHRoOjU2cHg7ZmxleDpub25lO30KICAuc2ZpZWxkLXJvdyAuc2YtcmVxe3dpZHRoOjI0cHg7cGFkZGluZzo0cHg7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1heC1ib3JkZXIpO2JhY2tncm91bmQ6I2ZmZjtib3JkZXItcmFkaXVzOjRweDtjdXJzb3I6cG9pbnRlcjtjb2xvcjojYWFhO2ZvbnQtd2VpZ2h0OjcwMDtmb250LXNpemU6MTNweDt9CiAgLnNmaWVsZC1yb3cgLnNmLXJlcS5vbntiYWNrZ3JvdW5kOiNmZGVjZWM7Y29sb3I6dmFyKC0tYXgtcmVxKTtib3JkZXItY29sb3I6I2U1YzJjNDt9CiAgLnNmaWVsZC1yb3cgLnNmLXJve3dpZHRoOjI2cHg7cGFkZGluZzo0cHggMnB4O2JvcmRlcjoxcHggc29saWQgdmFyKC0tYXgtYm9yZGVyKTtiYWNrZ3JvdW5kOiNmZmY7Ym9yZGVyLXJhZGl1czo0cHg7Y3Vyc29yOnBvaW50ZXI7Zm9udC1zaXplOjExcHg7ZmlsdGVyOmdyYXlzY2FsZSgxKTtvcGFjaXR5Oi40NTt9CiAgLnNmaWVsZC1yb3cgLnNmLXJvLm9ue2JhY2tncm91bmQ6I2VlZjFmNDtib3JkZXItY29sb3I6I2I5YzJjYjtmaWx0ZXI6bm9uZTtvcGFjaXR5OjE7fQogIC8qIOyhsO2ajOyhsOqxtCDtlYTrk5zsnZgg64Kg7KecL+q4sOqwhCDqsJI6IOyYiOyghOyXlCBZWVlZLU1NLUREIO2FjeyKpO2KuOy5uOydtOyXiOycvOuCmCwg7JWE7J207L2Y7J2EIOuIjOufrCDruaDrpbgg64Kg7KecIO2MneyXhSgjcWRQb3B1cCnsnYQKICAgICDsl6zripQg67Cp7Iud7Jy866GcIOuwlOuAjOyXiOuLpC4g67KE7Yq87J2AIO2VhOyImCgqKcK37J296riw7KCE7JqpKPCflJIpwrfsgq3soJwow5cpIOyVhOydtOy9mOqzvCDqsJnsnYAg7KSEKHJvdzEp7JeQIOuCmOuegO2eiCDrhpPsnbjri6QuICovCiAgLnNmaWVsZC1yb3cgLnNmLWRhdGVidG57d2lkdGg6MjJweDtoZWlnaHQ6MjRweDtmbGV4Om5vbmU7cGFkZGluZzowO2JvcmRlcjoxcHggc29saWQgdmFyKC0tYXgtYm9yZGVyKTtiYWNrZ3JvdW5kOiNmZmY7Ym9yZGVyLXJhZGl1czo0cHg7Y3Vyc29yOnBvaW50ZXI7Zm9udC1zaXplOjEycHg7Y29sb3I6dmFyKC0tYXgtZ3JlZW4tZGFyayk7fQogIC5zZmllbGQtcm93IC5zZi1kYXRlYnRuOmhvdmVye2JvcmRlci1jb2xvcjp2YXIoLS1heC1ncmVlbik7YmFja2dyb3VuZDp2YXIoLS1heC1ncmVlbi1saWdodCk7fQogIC5zZmllbGQtcm93IC5zZi1kYXRlYnRuLm9ue2JhY2tncm91bmQ6dmFyKC0tYXgtZ3JlZW4tbGlnaHQpO2JvcmRlci1jb2xvcjp2YXIoLS1heC1ncmVlbik7fQogIC8qIOy6lOuyhOyKpOyXkCDri6jrj4XsnLzroZwg64aT7J24IOuCoOynnMK36riw6rCEIOy7tO2PrOuEjO2KuDog7IaN7ISxIO2MqOuEkOydmCDqsJIg7J6F66Cl7Lm47J2AIOydveq4sOyghOyaqSjtmozsg4kp7Jy866GcIOuRkOqzoCwKICAgICDqt7gg7JWE656Y7JeQIOyLpOygnCDqsJLsnYQg7KCV7ZWY64qUIOuyhO2KvChxZC1vcGVuLWJ0binsnYQg67Cw7LmY7ZWc64ukLiAqLwogIC5wcm9wIGlucHV0OmRpc2FibGVke2JhY2tncm91bmQ6I2Y2ZjdmODtjb2xvcjojNmI3MjgwO2N1cnNvcjpub3QtYWxsb3dlZDt9CiAgLnFkLW9wZW4tYnRue3dpZHRoOjEwMCU7cGFkZGluZzo3cHggMTBweDttYXJnaW4tdG9wOjZweDtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWF4LWJvcmRlcik7YmFja2dyb3VuZDp2YXIoLS1heC1ncmVlbi1saWdodCk7Y29sb3I6dmFyKC0tYXgtZ3JlZW4tZGFyayk7Ym9yZGVyLXJhZGl1czo1cHg7Y3Vyc29yOnBvaW50ZXI7Zm9udC1zaXplOjEycHg7Zm9udC13ZWlnaHQ6NjAwO30KICAucWQtb3Blbi1idG46aG92ZXJ7YmFja2dyb3VuZDojZGNmMGU2O2JvcmRlci1jb2xvcjp2YXIoLS1heC1ncmVlbik7fQogIC5xZC1vcGVuLXJvd3tkaXNwbGF5OmZsZXg7Z2FwOjZweDttYXJnaW4tdG9wOjZweDt9CiAgLnFkLW9wZW4tcm93IC5xZC1vcGVuLWJ0bnttYXJnaW4tdG9wOjA7ZmxleDoxO30KICAuc2ZpZWxkLXJvdyAuc2YtdGlsZGV7Y29sb3I6I2FhYTtmb250LXNpemU6MTFweDtmbGV4Om5vbmU7cGFkZGluZzowIDFweDt9CiAgLnNmaWVsZC1vcHRze21hcmdpbjotMnB4IDAgM3B4IDA7cGFkZGluZy1sZWZ0OjJweDt9CiAgLyog67mg66W4IOuCoOynnCDshKDtg50g7Yyd7JeFKHFkUG9wdXApOiDslYTsnbTsvZjsnYQg7YG066at7ZWcIOychOy5mCDquLDspIDsnLzroZwg65yo64qUIOqzoOyglShmaXhlZCkg7JyE7LmYIO2MneyXhS4KICAgICDtmZTrqbQg6rCA7J6l7J6Q66as7JeQ7ISc64qUIG9wZW5RdWlja0RhdGUvcWRQb3NpdGlvbigp7J20IOyijOyasMK37IOB7ZWY66GcIOuSpOynkeyWtCDsnpjrpqzsp4Ag7JWK6rKMIO2VnOuLpC4gKi8KICAucWQtcG9wdXB7cG9zaXRpb246Zml4ZWQ7ei1pbmRleDo5OTk5O2JhY2tncm91bmQ6I2ZmZjtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWF4LWJvcmRlcik7Ym9yZGVyLXJhZGl1czo4cHg7Ym94LXNoYWRvdzowIDhweCAyNHB4IHJnYmEoMjAsMzAsNDAsLjE4KTtwYWRkaW5nOjEwcHg7d2lkdGg6MjM2cHg7Zm9udC1mYW1pbHk6aW5oZXJpdDt9CiAgLnFkLXRpdGxle2ZvbnQtc2l6ZToxMXB4O2ZvbnQtd2VpZ2h0OjcwMDtjb2xvcjp2YXIoLS1heC1uYXZ5KTttYXJnaW4tYm90dG9tOjhweDtkaXNwbGF5OmZsZXg7anVzdGlmeS1jb250ZW50OnNwYWNlLWJldHdlZW47YWxpZ24taXRlbXM6Y2VudGVyO30KICAucWQtdGl0bGUgLnFkLWNsb3Nle2N1cnNvcjpwb2ludGVyO2NvbG9yOiNhYWE7Zm9udC1zaXplOjE0cHg7bGluZS1oZWlnaHQ6MTt9CiAgLnFkLWNoaXBze2Rpc3BsYXk6Z3JpZDtncmlkLXRlbXBsYXRlLWNvbHVtbnM6cmVwZWF0KDQsMWZyKTtnYXA6NXB4O30KICAucWQtY2hpcHtwYWRkaW5nOjZweCAzcHg7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1heC1ib3JkZXIpO2JhY2tncm91bmQ6I2ZmZjtib3JkZXItcmFkaXVzOjVweDtmb250LXNpemU6MTFweDtjb2xvcjojMzMzO2N1cnNvcjpwb2ludGVyO3RleHQtYWxpZ246Y2VudGVyO30KICAucWQtY2hpcDpob3Zlcntib3JkZXItY29sb3I6dmFyKC0tYXgtZ3JlZW4pO30KICAucWQtY2hpcC5zZWx7YmFja2dyb3VuZDp2YXIoLS1heC1ncmVlbi1saWdodCk7Ym9yZGVyLWNvbG9yOnZhcigtLWF4LWdyZWVuKTtjb2xvcjp2YXIoLS1heC1ncmVlbi1kYXJrKTtmb250LXdlaWdodDo3MDA7fQogIC5xZC1jaGlwLWJsYW5re2dyaWQtY29sdW1uOjEgLyAtMTt9CiAgLnFkLWV4cGFuZC10b2dnbGV7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tYXgtZ3JlZW4tZGFyayk7Zm9udC13ZWlnaHQ6NzAwO21hcmdpbjo5cHggMCA3cHg7Y3Vyc29yOnBvaW50ZXI7dXNlci1zZWxlY3Q6bm9uZTt9CiAgLnFkLWF4aXN7bWFyZ2luLWJvdHRvbTo5cHg7fQogIC5xZC1heGlzOmxhc3Qtb2YtdHlwZXttYXJnaW4tYm90dG9tOjA7fQogIC5xZC1heGlzLWxhYmVse2ZvbnQtc2l6ZToxMHB4O2ZvbnQtd2VpZ2h0OjcwMDtjb2xvcjojOWFhM2FkO21hcmdpbi1ib3R0b206NHB4O30KICAucWQtc2Vne2Rpc3BsYXk6ZmxleDtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWF4LWJvcmRlcik7Ym9yZGVyLXJhZGl1czo2cHg7b3ZlcmZsb3c6aGlkZGVuO30KICAucWQtc2VnIGJ1dHRvbntmbGV4OjE7cGFkZGluZzo2cHggMnB4O2JvcmRlcjpub25lO2JhY2tncm91bmQ6I2ZmZjtmb250LXNpemU6MTFweDtjdXJzb3I6cG9pbnRlcjtjb2xvcjojNDQ0O2JvcmRlci1yaWdodDoxcHggc29saWQgdmFyKC0tYXgtYm9yZGVyKTt9CiAgLnFkLXNlZyBidXR0b246bGFzdC1jaGlsZHtib3JkZXItcmlnaHQ6bm9uZTt9CiAgLnFkLXNlZyBidXR0b24uc2Vse2JhY2tncm91bmQ6dmFyKC0tYXgtZ3JlZW4pO2NvbG9yOiNmZmY7Zm9udC13ZWlnaHQ6NzAwO30KICAucWQtYWN0aW9uc3tkaXNwbGF5OmZsZXg7anVzdGlmeS1jb250ZW50OnNwYWNlLWJldHdlZW47YWxpZ24taXRlbXM6Y2VudGVyO2dhcDo2cHg7bWFyZ2luLXRvcDoxMHB4O3BhZGRpbmctdG9wOjhweDtib3JkZXItdG9wOjFweCBzb2xpZCAjZjBmMGYwO30KICAucWQtcHJldmlld3tmbGV4OjE7bWluLXdpZHRoOjA7Zm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tYXgtbmF2eSk7Zm9udC13ZWlnaHQ6NzAwO2JhY2tncm91bmQ6I2Y0ZjZmODtib3JkZXItcmFkaXVzOjRweDtwYWRkaW5nOjRweCA4cHg7b3ZlcmZsb3c6aGlkZGVuO3RleHQtb3ZlcmZsb3c6ZWxsaXBzaXM7d2hpdGUtc3BhY2U6bm93cmFwO30KICAucWQtYnRue3BhZGRpbmc6NXB4IDEycHg7Ym9yZGVyLXJhZGl1czo0cHg7Zm9udC1zaXplOjExcHg7Zm9udC13ZWlnaHQ6NjAwO2N1cnNvcjpwb2ludGVyO2JvcmRlcjoxcHggc29saWQgdmFyKC0tYXgtYm9yZGVyKTtiYWNrZ3JvdW5kOnZhcigtLWF4LWdyZWVuKTtib3JkZXItY29sb3I6dmFyKC0tYXgtZ3JlZW4pO2NvbG9yOiNmZmY7fQogIC5zZi1oYW5kbGV7Y3Vyc29yOmdyYWI7Zm9udC1zaXplOjE0cHg7Y29sb3I6IzlhYTNhZDtwYWRkaW5nOjAgM3B4O3VzZXItc2VsZWN0Om5vbmU7bGluZS1oZWlnaHQ6MTtmbGV4Om5vbmU7fQogIC5zZi1oYW5kbGU6YWN0aXZle2N1cnNvcjpncmFiYmluZzt9CiAgLnNmLXBvc3t3aWR0aDozNHB4O2ZsZXg6bm9uZTtwYWRkaW5nOjRweCAycHg7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1heC1ib3JkZXIpO2JvcmRlci1yYWRpdXM6NHB4O2ZvbnQtc2l6ZToxMXB4O3RleHQtYWxpZ246Y2VudGVyO2JhY2tncm91bmQ6I2ZmZjt9CiAgLnNmLXBvczpmb2N1c3tib3JkZXItY29sb3I6dmFyKC0tYXgtZ3JlZW4pO291dGxpbmU6bm9uZTt9CiAgLnNmLXBvczo6LXdlYmtpdC1vdXRlci1zcGluLWJ1dHRvbiwuc2YtcG9zOjotd2Via2l0LWlubmVyLXNwaW4tYnV0dG9uey13ZWJraXQtYXBwZWFyYW5jZTpub25lO21hcmdpbjowO30KICAuc2YtcG9zey1tb3otYXBwZWFyYW5jZTp0ZXh0ZmllbGQ7fQogIC5zZi1tb3Zle3dpZHRoOjIwcHg7cGFkZGluZzozcHggMDtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWF4LWJvcmRlcik7YmFja2dyb3VuZDojZmZmO2JvcmRlci1yYWRpdXM6NHB4O2N1cnNvcjpwb2ludGVyO2ZvbnQtc2l6ZTo5cHg7bGluZS1oZWlnaHQ6MTtjb2xvcjojNTU2O2ZsZXg6bm9uZTt9CiAgLnNmLW1vdmU6aG92ZXI6bm90KDpkaXNhYmxlZCl7YmFja2dyb3VuZDojZWVmMmY1O30KICAuc2YtbW92ZTpkaXNhYmxlZHtvcGFjaXR5Oi4zO2N1cnNvcjpkZWZhdWx0O30KICAuZ2NvbC10eXBle2ZsZXg6bm9uZTt3aWR0aDo4NHB4O30KICAuZ2NvbC1ncnAtaHtkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2p1c3RpZnktY29udGVudDpzcGFjZS1iZXR3ZWVuO2dhcDo2cHg7fQogIC5nY29sLWdycC10b2dnbGV7ZmxleDpub25lO3BhZGRpbmc6NHB4IDhweDtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWF4LWJvcmRlcik7YmFja2dyb3VuZDojZmZmO2JvcmRlci1yYWRpdXM6NHB4O2N1cnNvcjpwb2ludGVyO2ZvbnQtc2l6ZToxMHB4O2NvbG9yOiM1NTY7d2hpdGUtc3BhY2U6bm93cmFwO3RleHQtdHJhbnNmb3JtOm5vbmU7bGV0dGVyLXNwYWNpbmc6bm9ybWFsO2ZvbnQtd2VpZ2h0OjYwMDt9CiAgLmdjb2wtZ3JwLXRvZ2dsZTpob3ZlcntiYWNrZ3JvdW5kOiNlZWYyZjU7fQogIC5zZmllbGQtcm93e3RyYW5zaXRpb246b3BhY2l0eSAuMTJzO2JvcmRlci10b3A6MnB4IHNvbGlkIHRyYW5zcGFyZW50O30KICAuc2ZpZWxkLXJvdy5kcmFnZ2luZ3tvcGFjaXR5Oi4zNTt9CiAgLnNmaWVsZC1yb3cuZHJhZy1vdmVye2JvcmRlci10b3AtY29sb3I6dmFyKC0tYXgtZ3JlZW4pO30KICAuc2ZpZWxkLW9wdHMgaW5wdXR7d2lkdGg6MTAwJTtwYWRkaW5nOjRweCA2cHg7Ym9yZGVyOjFweCBkYXNoZWQgdmFyKC0tYXgtYm9yZGVyKTtib3JkZXItcmFkaXVzOjRweDtmb250LXNpemU6MTFweDtiYWNrZ3JvdW5kOiNmYWZiZmM7fQogIC8qIOq3uOumrOuTnCDsu6zrn7wg7ZaJ7J2YIOyDgeychO2XpOuNlCDsnoXroKUoMu2WiSkgLSBzZmllbGQtb3B0cyBpbnB1dOqzvCDrj5nsnbztlZwg7Yak7J207KeA66eMLCDqsJnsnYAg7ZaJ7JeQ7IScCiAgICAg7ZWE7IiYL+ydveq4sOyghOyaqSDrsoTtirzqs7wg64KY656A7Z6IIOuGk+ydtOuPhOuhnSBmbGV4IOyVhOydtO2FnOycvOuhnCDsk7Tri6QuICovCiAgLnNmaWVsZC1yb3cgLmdycC1pbnB1dHtmbGV4OjE7bWluLXdpZHRoOjA7cGFkZGluZzo0cHggNnB4O2JvcmRlcjoxcHggZGFzaGVkIHZhcigtLWF4LWJvcmRlcik7Ym9yZGVyLXJhZGl1czo0cHg7Zm9udC1zaXplOjExcHg7YmFja2dyb3VuZDojZmFmYmZjO2ZvbnQtZmFtaWx5OmluaGVyaXQ7Y29sb3I6IzMzMzt9CiAgLyog6re466as65OcIOy7rOufvOydmCAi7Zek642UIO2FjeyKpO2KuCDsoJXroKwiIOy7qO2KuOuhpCAtIOyZvOyqvS/qsIDsmrTrjbAv7Jik66W47Kq9IDPrsoTtirwg7IS46re466i87Yq4ICovCiAgLmFsaWduLXNlZ3tkaXNwbGF5OmZsZXg7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1heC1ib3JkZXIpO2JvcmRlci1yYWRpdXM6NHB4O292ZXJmbG93OmhpZGRlbjtmbGV4Om5vbmU7fQogIC5hbGlnbi1idG57d2lkdGg6MjBweDtoZWlnaHQ6MjRweDtwYWRkaW5nOjA7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyO2JhY2tncm91bmQ6I2ZmZjtib3JkZXI6MDtib3JkZXItcmlnaHQ6MXB4IHNvbGlkIHZhcigtLWF4LWJvcmRlcik7Y3Vyc29yOnBvaW50ZXI7fQogIC5hbGlnbi1idG46bGFzdC1jaGlsZHtib3JkZXItcmlnaHQ6MDt9CiAgLmFsaWduLWJ0bjpob3ZlcntiYWNrZ3JvdW5kOiNmM2Y2Zjk7fQogIC5hbGlnbi1idG4ub257YmFja2dyb3VuZDojZThmMGZiO30KICAuYWxpZ24taWN7d2lkdGg6MTJweDtoZWlnaHQ6MTBweDtkaXNwbGF5OmZsZXg7ZmxleC1kaXJlY3Rpb246Y29sdW1uO2p1c3RpZnktY29udGVudDpzcGFjZS1iZXR3ZWVuO3BvaW50ZXItZXZlbnRzOm5vbmU7fQogIC5hbGlnbi1pYyBpe2Rpc3BsYXk6YmxvY2s7aGVpZ2h0OjJweDtib3JkZXItcmFkaXVzOjFweDtiYWNrZ3JvdW5kOiM2YjcyODA7fQogIC5hbGlnbi1idG4ub24gLmFsaWduLWljIGl7YmFja2dyb3VuZDp2YXIoLS1zZWwpO30KICAuYWxpZ24taWMubCBpOm50aC1jaGlsZCgxKXt3aWR0aDoxMDAlO30gLmFsaWduLWljLmwgaTpudGgtY2hpbGQoMil7d2lkdGg6NzAlO30gLmFsaWduLWljLmwgaTpudGgtY2hpbGQoMyl7d2lkdGg6ODUlO30KICAuYWxpZ24taWMuY3thbGlnbi1pdGVtczpjZW50ZXI7fQogIC5hbGlnbi1pYy5jIGk6bnRoLWNoaWxkKDEpe3dpZHRoOjEwMCU7fSAuYWxpZ24taWMuYyBpOm50aC1jaGlsZCgyKXt3aWR0aDo2NSU7fSAuYWxpZ24taWMuYyBpOm50aC1jaGlsZCgzKXt3aWR0aDo4MCU7fQogIC5hbGlnbi1pYy5ye2FsaWduLWl0ZW1zOmZsZXgtZW5kO30KICAuYWxpZ24taWMuciBpOm50aC1jaGlsZCgxKXt3aWR0aDoxMDAlO30gLmFsaWduLWljLnIgaTpudGgtY2hpbGQoMil7d2lkdGg6NzAlO30gLmFsaWduLWljLnIgaTpudGgtY2hpbGQoMyl7d2lkdGg6ODUlO30KCiAgLyogQ29udmVydCBtb2RhbCAqLwogIC5tb2RhbC1iZ3twb3NpdGlvbjpmaXhlZDtpbnNldDowO2JhY2tncm91bmQ6cmdiYSgyMCwyOCwzOCwuNTUpO3otaW5kZXg6MTAwMDtkaXNwbGF5Om5vbmU7YWxpZ24taXRlbXM6Y2VudGVyO2p1c3RpZnktY29udGVudDpjZW50ZXI7fQogIC5tb2RhbC1iZy5vbntkaXNwbGF5OmZsZXg7fQogIC5tb2RhbHtiYWNrZ3JvdW5kOiNmZmY7Ym9yZGVyLXJhZGl1czoxMHB4O3dpZHRoOjYyMHB4O21heC13aWR0aDo5NHZ3O21heC1oZWlnaHQ6OTB2aDtvdmVyZmxvdy15OmF1dG87Ym94LXNoYWRvdzowIDEycHggNDBweCByZ2JhKDAsMCwwLC4zKTt9CiAgLm1vZGFsLWh7YmFja2dyb3VuZDp2YXIoLS1heC1uYXZ5KTtjb2xvcjojZmZmO3BhZGRpbmc6MTRweCAxOHB4O2JvcmRlci1yYWRpdXM6MTBweCAxMHB4IDAgMDtkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2p1c3RpZnktY29udGVudDpzcGFjZS1iZXR3ZWVuO30KICAubW9kYWwtaCBoMntmb250LXNpemU6MTVweDtmb250LXdlaWdodDo3MDA7fQogIC5tb2RhbC1oIC54e2N1cnNvcjpwb2ludGVyO2ZvbnQtc2l6ZToyMHB4O2xpbmUtaGVpZ2h0OjE7b3BhY2l0eTouODt9CiAgLm1vZGFsLWggLng6aG92ZXJ7b3BhY2l0eToxO30KICAubW9kYWwtYntwYWRkaW5nOjE4cHg7fQoKICAvKiBJbnRlcmFjdGl2ZSBvbmJvYXJkaW5nIHRvdXIgKi8KICAudG91ci1vdmVybGF5e3Bvc2l0aW9uOmZpeGVkO2luc2V0OjA7ei1pbmRleDoyMDAwO3BvaW50ZXItZXZlbnRzOm5vbmU7fQogIC50b3VyLXNwb3R7cG9zaXRpb246Zml4ZWQ7Ym9yZGVyLXJhZGl1czo4cHg7Ym94LXNoYWRvdzowIDAgMCA5OTk5cHggcmdiYSgxNSwyMywzMiwuNik7dHJhbnNpdGlvbjp0b3AgLjI1cyBlYXNlLGxlZnQgLjI1cyBlYXNlLHdpZHRoIC4yNXMgZWFzZSxoZWlnaHQgLjI1cyBlYXNlO3BvaW50ZXItZXZlbnRzOm5vbmU7fQogIC50b3VyLXNwb3Qubm9uZXtib3gtc2hhZG93Om5vbmU7YmFja2dyb3VuZDpyZ2JhKDE1LDIzLDMyLC42KTtpbnNldDowO3RvcDowIWltcG9ydGFudDtsZWZ0OjAhaW1wb3J0YW50O3dpZHRoOjEwMCUhaW1wb3J0YW50O2hlaWdodDoxMDAlIWltcG9ydGFudDtib3JkZXItcmFkaXVzOjA7fQogIC50b3VyLWNhcmR7cG9zaXRpb246Zml4ZWQ7d2lkdGg6MzAwcHg7bWF4LXdpZHRoOjkydnc7YmFja2dyb3VuZDojZmZmO2JvcmRlci1yYWRpdXM6MTRweDsKICAgIGJveC1zaGFkb3c6MCAyMHB4IDUwcHggcmdiYSgxNSwyMywzMiwuMjgpLDAgMnB4IDhweCByZ2JhKDE1LDIzLDMyLC4wOCk7CiAgICBwb2ludGVyLWV2ZW50czphdXRvO3RyYW5zaXRpb246dG9wIC4yNXMgZWFzZSxsZWZ0IC4yNXMgZWFzZSx3aWR0aCAuMnMgZWFzZTtvdmVyZmxvdzpoaWRkZW47fQogIC50b3VyLWNhcmQtaHtkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6ZmxleC1zdGFydDtnYXA6MTBweDtqdXN0aWZ5LWNvbnRlbnQ6c3BhY2UtYmV0d2VlbjtwYWRkaW5nOjE4cHggMThweCAycHg7fQogIC50b3VyLWNhcmQtaCAudG91ci1kb3R7ZmxleDpub25lO3dpZHRoOjhweDtoZWlnaHQ6OHB4O2JvcmRlci1yYWRpdXM6NTAlO2JhY2tncm91bmQ6dmFyKC0tYXgtZ3JlZW4pO21hcmdpbi10b3A6N3B4O2JveC1zaGFkb3c6MCAwIDAgM3B4IHZhcigtLWF4LWdyZWVuLWxpZ2h0KTt9CiAgLnRvdXItY2FyZC1oIGg0e2ZsZXg6MTtmb250LXNpemU6MTZweDtmb250LXdlaWdodDo4MDA7Y29sb3I6dmFyKC0tYXgtbmF2eSk7bGluZS1oZWlnaHQ6MS4zNTt3b3JkLWJyZWFrOmtlZXAtYWxsO292ZXJmbG93LXdyYXA6YnJlYWstd29yZDtsZXR0ZXItc3BhY2luZzotLjFweDt9CiAgLnRvdXItY2FyZC1oIC54e2N1cnNvcjpwb2ludGVyO2ZvbnQtc2l6ZToyMHB4O2xpbmUtaGVpZ2h0OjE7Y29sb3I6I2I3YmVjNjtmbGV4Om5vbmU7cGFkZGluZzoycHg7Ym9yZGVyLXJhZGl1czo2cHg7dHJhbnNpdGlvbjouMTJzO30KICAudG91ci1jYXJkLWggLng6aG92ZXJ7Y29sb3I6IzU1NjtiYWNrZ3JvdW5kOiNmMmY0ZjY7fQogIC50b3VyLWNhcmQtYntwYWRkaW5nOjhweCAxOHB4IDRweDtmb250LXNpemU6MTNweDtsaW5lLWhlaWdodDoxLjc1O2NvbG9yOiM0YjU1NjM7d29yZC1icmVhazprZWVwLWFsbDtvdmVyZmxvdy13cmFwOmJyZWFrLXdvcmQ7fQogIC50b3VyLWNhcmQtYiBie2NvbG9yOiMxNzgwNTU7Zm9udC13ZWlnaHQ6NzAwO30KICAudG91ci1jYXJkLWZ7cGFkZGluZzoxNHB4IDE4cHggMThweDt9CiAgLnRvdXItcHJvZ3Jlc3N7aGVpZ2h0OjNweDtib3JkZXItcmFkaXVzOjNweDtiYWNrZ3JvdW5kOiNlZWYxZjQ7b3ZlcmZsb3c6aGlkZGVuO21hcmdpbi1ib3R0b206MTJweDt9CiAgLnRvdXItcHJvZ3Jlc3MtZmlsbHtoZWlnaHQ6MTAwJTtiYWNrZ3JvdW5kOmxpbmVhci1ncmFkaWVudCg5MGRlZyx2YXIoLS1heC1ncmVlbiksdmFyKC0tYXgtZ3JlZW4tZGFyaykpO2JvcmRlci1yYWRpdXM6M3B4O3RyYW5zaXRpb246d2lkdGggLjI1cyBlYXNlO30KICAudG91ci1mLXJvd3tkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2p1c3RpZnktY29udGVudDpzcGFjZS1iZXR3ZWVuO2dhcDoxMHB4O30KICAudG91ci1zdGVwLW57Zm9udC1zaXplOjExLjVweDtjb2xvcjojOWFhM2FkO2ZvbnQtd2VpZ2h0OjcwMDtsZXR0ZXItc3BhY2luZzouMnB4O2ZsZXg6bm9uZTt9CiAgLnRvdXItZi1yaWdodHtkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDo2cHg7fQogIC50b3VyLXNraXB7Zm9udC1zaXplOjEycHg7Y29sb3I6IzlhYTNhZDt0ZXh0LWRlY29yYXRpb246bm9uZTttYXJnaW4tcmlnaHQ6NHB4O3doaXRlLXNwYWNlOm5vd3JhcDt9CiAgLnRvdXItc2tpcDpob3Zlcntjb2xvcjojNTU2O3RleHQtZGVjb3JhdGlvbjp1bmRlcmxpbmU7fQogIC50b3VyLWJ0bntwYWRkaW5nOjdweCAxNXB4O2JvcmRlci1yYWRpdXM6MjBweDtmb250LXNpemU6MTIuNXB4O2ZvbnQtd2VpZ2h0OjcwMDtjdXJzb3I6cG9pbnRlcjtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWF4LWJvcmRlcik7dHJhbnNpdGlvbjouMTJzO30KICAudG91ci1idG4uZ2hvc3R7YmFja2dyb3VuZDojZmZmO2NvbG9yOiM1NTY7fQogIC50b3VyLWJ0bi5naG9zdDpob3ZlcntiYWNrZ3JvdW5kOiNmMmY0ZjY7fQogIC50b3VyLWJ0bi5wcmltYXJ5e2JhY2tncm91bmQ6dmFyKC0tYXgtZ3JlZW4pO2JvcmRlci1jb2xvcjp2YXIoLS1heC1ncmVlbik7Y29sb3I6I2ZmZjtib3gtc2hhZG93OjAgMnB4IDZweCByZ2JhKDMwLDE1OCwxMDYsLjM1KTt9CiAgLnRvdXItYnRuLnByaW1hcnk6aG92ZXJ7YmFja2dyb3VuZDp2YXIoLS1heC1ncmVlbi1kYXJrKTtib3JkZXItY29sb3I6dmFyKC0tYXgtZ3JlZW4tZGFyayk7fQogIC50b3VyLWJ0bjpkaXNhYmxlZHtvcGFjaXR5Oi40O2N1cnNvcjpkZWZhdWx0O2JveC1zaGFkb3c6bm9uZTt9CiAgLnRvdXItY2FyZC1mIC5wdC1oaWRle2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjZweDtmb250LXNpemU6MTJweDtjb2xvcjojOGE5NGEwO21hcmdpbi1ib3R0b206MTJweDtjdXJzb3I6cG9pbnRlcjt9CiAgLnRhYnN7ZGlzcGxheTpmbGV4O2dhcDowO2JvcmRlci1ib3R0b206MnB4IHNvbGlkICNlZWU7bWFyZ2luLWJvdHRvbToxNHB4O30KICAudGFie3BhZGRpbmc6OXB4IDE2cHg7Y3Vyc29yOnBvaW50ZXI7Zm9udC1zaXplOjEzcHg7Y29sb3I6dmFyKC0tYXgtZ3JheSk7Ym9yZGVyLWJvdHRvbToycHggc29saWQgdHJhbnNwYXJlbnQ7bWFyZ2luLWJvdHRvbTotMnB4O2ZvbnQtd2VpZ2h0OjYwMDt9CiAgLnRhYi5vbntjb2xvcjp2YXIoLS1heC1ncmVlbik7Ym9yZGVyLWJvdHRvbS1jb2xvcjp2YXIoLS1heC1ncmVlbik7fQogIC5ndWlkZXtiYWNrZ3JvdW5kOiNmMGY3ZmY7Ym9yZGVyOjFweCBzb2xpZCAjY2ZlNGZiO2JvcmRlci1yYWRpdXM6NnB4O3BhZGRpbmc6MTJweCAxNHB4O2ZvbnQtc2l6ZToxMnB4O2xpbmUtaGVpZ2h0OjEuNztjb2xvcjojMzM0OyBtYXJnaW4tYm90dG9tOjE0cHg7fQogIC5ndWlkZS10b2dnbGUtYnRue3dpZHRoOjEwMCU7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6OHB4O2JhY2tncm91bmQ6I2YwZjdmZjtib3JkZXI6MXB4IHNvbGlkICNjZmU0ZmI7Ym9yZGVyLXJhZGl1czo2cHg7cGFkZGluZzoxMHB4IDE0cHg7Zm9udC1zaXplOjEyLjVweDtmb250LXdlaWdodDo3MDA7Y29sb3I6IzFmNGE3NTtjdXJzb3I6cG9pbnRlcjttYXJnaW4tYm90dG9tOjA7dHJhbnNpdGlvbjpiYWNrZ3JvdW5kIC4xMnM7fQogIC5ndWlkZS10b2dnbGUtYnRuOmhvdmVye2JhY2tncm91bmQ6I2UzZjBmZDt9CiAgLmd1aWRlLXRvZ2dsZS1pY3tmb250LXNpemU6MTFweDtjb2xvcjojMWU3OGQ2O3RyYW5zaXRpb246dHJhbnNmb3JtIC4xNXM7ZmxleDpub25lO30KICAuZ3VpZGUtdG9nZ2xlLWJ0biArIC5ndWlkZXttYXJnaW4tdG9wOjA7Ym9yZGVyLXRvcDpub25lO2JvcmRlci1yYWRpdXM6MCAwIDZweCA2cHg7fQogIC5ndWlkZS5wdXJwbGV7YmFja2dyb3VuZDojZjVmMmZmO2JvcmRlci1jb2xvcjojZGVkNGZmO30KICAuZ3VpZGUgYntjb2xvcjp2YXIoLS1heC1uYXZ5KTt9CiAgLmd1aWRlIG9se21hcmdpbjo2cHggMCAwIDE4cHg7fQogIC5ndWlkZSAud2Fybntjb2xvcjojYjQ1MzA5O2ZvbnQtc2l6ZToxMXB4O21hcmdpbi10b3A6NnB4O2Rpc3BsYXk6YmxvY2s7fQogIC5ndWlkZSAudGlwbGluZXtkaXNwbGF5OmJsb2NrO21hcmdpbi10b3A6OHB4O3BhZGRpbmc6N3B4IDlweDtiYWNrZ3JvdW5kOiNmZmY7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1heC1ib3JkZXIpO2JvcmRlci1yYWRpdXM6NXB4O2ZvbnQtc2l6ZToxMS41cHg7Y29sb3I6IzRiNTU2MztsaW5lLWhlaWdodDoxLjY7fQogIC5maWVsZHttYXJnaW4tYm90dG9tOjEycHg7fQogIC5maWVsZCBsYWJlbHtkaXNwbGF5OmJsb2NrO2ZvbnQtc2l6ZToxMnB4O2NvbG9yOnZhcigtLWF4LW5hdnkpO2ZvbnQtd2VpZ2h0OjYwMDttYXJnaW4tYm90dG9tOjVweDt9CiAgLmZpZWxkIGlucHV0W3R5cGU9dGV4dF0sLmZpZWxkIGlucHV0W3R5cGU9cGFzc3dvcmRde3dpZHRoOjEwMCU7cGFkZGluZzo4cHggMTBweDtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWF4LWJvcmRlcik7Ym9yZGVyLXJhZGl1czo1cHg7Zm9udC1zaXplOjEycHg7fQogIC5maWVsZCB0ZXh0YXJlYXt3aWR0aDoxMDAlO3BhZGRpbmc6OHB4IDEwcHg7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1heC1ib3JkZXIpO2JvcmRlci1yYWRpdXM6NXB4O2ZvbnQtc2l6ZToxMnB4O2ZvbnQtZmFtaWx5OmluaGVyaXQ7fQogIC5idG4tZ2hvc3Qtc217YmFja2dyb3VuZDojZWVmMWY0O2NvbG9yOnZhcigtLWF4LW5hdnkpO2JvcmRlcjoxcHggc29saWQgdmFyKC0tYXgtYm9yZGVyKTtwYWRkaW5nOjZweCAxMnB4O2JvcmRlci1yYWRpdXM6NXB4O2ZvbnQtc2l6ZToxMnB4O2ZvbnQtd2VpZ2h0OjYwMDtjdXJzb3I6cG9pbnRlcjttYXJnaW4tdG9wOjZweDt9CiAgLmJ0bi1naG9zdC1zbTpob3ZlcntiYWNrZ3JvdW5kOiNlMmU2ZWE7fQogIC5idG4tY2xhdWRlLXNte2JhY2tncm91bmQ6I2Q5Nzc1Nztjb2xvcjojZmZmO2JvcmRlcjoxcHggc29saWQgI2M4NjU0NDtwYWRkaW5nOjZweCAxMnB4O2JvcmRlci1yYWRpdXM6NXB4O2ZvbnQtc2l6ZToxMnB4O2ZvbnQtd2VpZ2h0OjYwMDtjdXJzb3I6cG9pbnRlcjttYXJnaW4tdG9wOjZweDttYXJnaW4tcmlnaHQ6NnB4O30KICAuYnRuLWNsYXVkZS1zbTpob3ZlcntiYWNrZ3JvdW5kOiNjODY1NDQ7fQogIC5kcm9wLXpvbmV7Ym9yZGVyOjJweCBkYXNoZWQgdmFyKC0tYXgtYm9yZGVyKTtib3JkZXItcmFkaXVzOjhweDtwYWRkaW5nOjI2cHg7dGV4dC1hbGlnbjpjZW50ZXI7Y29sb3I6dmFyKC0tYXgtZ3JheSk7Y3Vyc29yOnBvaW50ZXI7dHJhbnNpdGlvbjouMTVzO2JhY2tncm91bmQ6I2ZhZmJmYzt9CiAgLmRyb3Atem9uZTpob3ZlciwuZHJvcC16b25lLmhvdmVye2JvcmRlci1jb2xvcjp2YXIoLS1heC1ncmVlbik7YmFja2dyb3VuZDp2YXIoLS1heC1ncmVlbi1saWdodCk7Y29sb3I6dmFyKC0tYXgtZ3JlZW4tZGFyayk7fQogIC5kcm9wLXpvbmUgLmJpZ3tmb250LXNpemU6MjhweDttYXJnaW4tYm90dG9tOjZweDt9CiAgLnByZXZpZXd7bWFyZ2luLXRvcDoxMnB4O3RleHQtYWxpZ246Y2VudGVyO30KICAucHJldmlldyBpbWd7bWF4LXdpZHRoOjEwMCU7bWF4LWhlaWdodDoyMjBweDtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWF4LWJvcmRlcik7Ym9yZGVyLXJhZGl1czo2cHg7fQogIC5tb2RhbC1me2Rpc3BsYXk6ZmxleDtnYXA6OHB4O2p1c3RpZnktY29udGVudDpmbGV4LWVuZDtwYWRkaW5nOjE0cHggMThweDtib3JkZXItdG9wOjFweCBzb2xpZCAjZWVlO30KICAubW9kYWwtZiBidXR0b257cGFkZGluZzo4cHggMThweDtib3JkZXItcmFkaXVzOjVweDtmb250LXNpemU6MTNweDtjdXJzb3I6cG9pbnRlcjtmb250LXdlaWdodDo2MDA7Ym9yZGVyOm5vbmU7fQogIC5idG4tcHJpbWFyeXtiYWNrZ3JvdW5kOnZhcigtLWF4LWdyZWVuKTtjb2xvcjojZmZmO30KICAuYnRuLXByaW1hcnk6aG92ZXJ7YmFja2dyb3VuZDp2YXIoLS1heC1ncmVlbi1kYXJrKTt9CiAgLmJ0bi1wcmltYXJ5OmRpc2FibGVke2JhY2tncm91bmQ6I2E4YzliOTtjdXJzb3I6bm90LWFsbG93ZWQ7fQogIC5idG4tY2FuY2Vse2JhY2tncm91bmQ6I2VlZjFmNDtjb2xvcjojNTU1O30KICAuc3RhdHVze2ZvbnQtc2l6ZToxMnB4O2NvbG9yOnZhcigtLWF4LWdyZWVuLWRhcmspO21hcmdpbi10b3A6MTBweDt0ZXh0LWFsaWduOmNlbnRlcjttaW4taGVpZ2h0OjE4cHg7fQogIC5zdGF0dXMuZXJye2NvbG9yOnZhcigtLWF4LXJlcSk7fQogIC5zcGlubmVye2Rpc3BsYXk6aW5saW5lLWJsb2NrO3dpZHRoOjE0cHg7aGVpZ2h0OjE0cHg7Ym9yZGVyOjJweCBzb2xpZCAjY2ZlNGQ5O2JvcmRlci10b3AtY29sb3I6dmFyKC0tYXgtZ3JlZW4pO2JvcmRlci1yYWRpdXM6NTAlO2FuaW1hdGlvbjpzcGluIC43cyBsaW5lYXIgaW5maW5pdGU7dmVydGljYWwtYWxpZ246LTJweDttYXJnaW4tcmlnaHQ6NnB4O30KICBAa2V5ZnJhbWVzIHNwaW57dG97dHJhbnNmb3JtOnJvdGF0ZSgzNjBkZWcpO319CgogIC8qIC0tLS0gQ29udmVydCBtb2RhbDogYmVnaW5uZXItZnJpZW5kbHkgc3RlcCBVSSAtLS0tICovCiAgLmN2LWludHJve2JhY2tncm91bmQ6dmFyKC0tYXgtZ3JlZW4tbGlnaHQpO2JvcmRlcjoxcHggc29saWQgI2JmZTNkMjtib3JkZXItcmFkaXVzOjhweDtwYWRkaW5nOjEzcHggMTVweDttYXJnaW4tYm90dG9tOjE2cHg7Zm9udC1zaXplOjEyLjVweDtsaW5lLWhlaWdodDoxLjc7Y29sb3I6IzJmNTM0Njt9CiAgLmN2LWludHJvIGJ7Y29sb3I6dmFyKC0tYXgtZ3JlZW4tZGFyayk7fQogIC5jdi1pbnRybyAuY3YtZnJlZXtkaXNwbGF5OmlubGluZS1ibG9jaztiYWNrZ3JvdW5kOnZhcigtLWF4LWdyZWVuKTtjb2xvcjojZmZmO2ZvbnQtc2l6ZToxMXB4O2ZvbnQtd2VpZ2h0OjcwMDtwYWRkaW5nOjJweCA4cHg7Ym9yZGVyLXJhZGl1czoyMHB4O21hcmdpbi1sZWZ0OjRweDt2ZXJ0aWNhbC1hbGlnbjoxcHg7fQogIC5jdi1zdGVwc3tkaXNwbGF5OmZsZXg7ZmxleC1kaXJlY3Rpb246Y29sdW1uO2dhcDoxMHB4O21hcmdpbi1ib3R0b206MTZweDt9CiAgLmN2LXN0ZXB7cG9zaXRpb246cmVsYXRpdmU7ZGlzcGxheTpmbGV4O2dhcDoxMnB4O2FsaWduLWl0ZW1zOmZsZXgtc3RhcnQ7YmFja2dyb3VuZDojZmZmO2JvcmRlcjoxcHggc29saWQgdmFyKC0tYXgtYm9yZGVyKTtib3JkZXItcmFkaXVzOjlweDtwYWRkaW5nOjEzcHggMTVweCAxNHB4O3RyYW5zaXRpb246Ym9yZGVyLWNvbG9yIC4xNXMsYm94LXNoYWRvdyAuMTVzO30KICAuY3Ytc3RlcC5vbntib3JkZXItY29sb3I6dmFyKC0tYXgtZ3JlZW4pO2JveC1zaGFkb3c6MCAwIDAgMnB4IHJnYmEoMzAsMTU4LDEwNiwuMTMpO30KICAuY3Ytc3RlcC5kb25le2JvcmRlci1jb2xvcjojYmZlM2QyO2JhY2tncm91bmQ6I2ZiZmVmYzt9CiAgLmN2LXN0ZXAtbnVte2ZsZXg6bm9uZTt3aWR0aDoyNnB4O2hlaWdodDoyNnB4O2JvcmRlci1yYWRpdXM6NTAlO2JhY2tncm91bmQ6dmFyKC0tYXgtbmF2eSk7Y29sb3I6I2ZmZjtmb250LXNpemU6MTNweDtmb250LXdlaWdodDo3MDA7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyO21hcmdpbi10b3A6MXB4O3RyYW5zaXRpb246YmFja2dyb3VuZCAuMTVzO30KICAuY3Ytc3RlcC5vbiAuY3Ytc3RlcC1udW17YmFja2dyb3VuZDp2YXIoLS1heC1ncmVlbik7fQogIC5jdi1zdGVwLmRvbmUgLmN2LXN0ZXAtbnVte2JhY2tncm91bmQ6dmFyKC0tYXgtZ3JlZW4pO30KICAuY3Ytc3RlcC1ib2R5e2ZsZXg6MTttaW4td2lkdGg6MDt9CiAgLmN2LXN0ZXAtdGl0bGV7Zm9udC1zaXplOjEzcHg7Zm9udC13ZWlnaHQ6NzAwO2NvbG9yOnZhcigtLWF4LW5hdnkpO21hcmdpbi1ib3R0b206MnB4O2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjZweDtmbGV4LXdyYXA6d3JhcDt9CiAgLmN2LXN0ZXAtZGVzY3tmb250LXNpemU6MTEuNXB4O2NvbG9yOnZhcigtLWF4LWdyYXkpO2xpbmUtaGVpZ2h0OjEuNjt9CiAgLmN2LXN0ZXAtYWN0aW9uc3ttYXJnaW4tdG9wOjlweDtkaXNwbGF5OmZsZXg7Z2FwOjdweDtmbGV4LXdyYXA6d3JhcDt9CiAgLmN2LWJ0bi1wcmltYXJ5e2JhY2tncm91bmQ6dmFyKC0tYXgtZ3JlZW4pO2NvbG9yOiNmZmY7Ym9yZGVyOm5vbmU7cGFkZGluZzo4cHggMTVweDtib3JkZXItcmFkaXVzOjZweDtmb250LXNpemU6MTIuNXB4O2ZvbnQtd2VpZ2h0OjcwMDtjdXJzb3I6cG9pbnRlcjtkaXNwbGF5OmlubGluZS1mbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6NnB4O3RyYW5zaXRpb246YmFja2dyb3VuZCAuMTJzO30KICAuY3YtYnRuLXByaW1hcnk6aG92ZXJ7YmFja2dyb3VuZDp2YXIoLS1heC1ncmVlbi1kYXJrKTt9CiAgLmN2LWJ0bi1jbGF1ZGV7YmFja2dyb3VuZDojZDk3NzU3O2NvbG9yOiNmZmY7Ym9yZGVyOm5vbmU7cGFkZGluZzo4cHggMTVweDtib3JkZXItcmFkaXVzOjZweDtmb250LXNpemU6MTIuNXB4O2ZvbnQtd2VpZ2h0OjcwMDtjdXJzb3I6cG9pbnRlcjtkaXNwbGF5OmlubGluZS1mbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6NnB4O3RyYW5zaXRpb246YmFja2dyb3VuZCAuMTJzO30KICAuY3YtYnRuLWNsYXVkZTpob3ZlcntiYWNrZ3JvdW5kOiNjODY1NDQ7fQogIC5jdi1idG4tc29mdHtiYWNrZ3JvdW5kOiNlZWYxZjQ7Y29sb3I6dmFyKC0tYXgtbmF2eSk7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1heC1ib3JkZXIpO3BhZGRpbmc6OHB4IDEzcHg7Ym9yZGVyLXJhZGl1czo2cHg7Zm9udC1zaXplOjEyLjVweDtmb250LXdlaWdodDo2MDA7Y3Vyc29yOnBvaW50ZXI7ZGlzcGxheTppbmxpbmUtZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjVweDt0cmFuc2l0aW9uOmJhY2tncm91bmQgLjEyczt9CiAgLmN2LWJ0bi1zb2Z0OmhvdmVye2JhY2tncm91bmQ6I2UyZTZlYTt9CiAgLmN2LWJ0bi1jb3B5e2JhY2tncm91bmQ6dmFyKC0tYXgtZ3JlZW4pO2NvbG9yOiNmZmY7Ym9yZGVyOm5vbmU7cGFkZGluZzo4cHggMTVweDtib3JkZXItcmFkaXVzOjZweDtmb250LXNpemU6MTIuNXB4O2ZvbnQtd2VpZ2h0OjcwMDtjdXJzb3I6cG9pbnRlcjtkaXNwbGF5OmlubGluZS1mbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6NnB4O3RyYW5zaXRpb246YmFja2dyb3VuZCAuMTJzLGJveC1zaGFkb3cgLjEycztib3gtc2hhZG93OjAgMCAwIDNweCByZ2JhKDMwLDE1OCwxMDYsLjE2KTt9CiAgLmN2LWJ0bi1jb3B5OmhvdmVye2JhY2tncm91bmQ6dmFyKC0tYXgtZ3JlZW4tZGFyayk7Ym94LXNoYWRvdzowIDAgMCAzcHggcmdiYSgzMCwxNTgsMTA2LC4yNCk7fQogIC5jdi1idG4tYmFkZ2V7YmFja2dyb3VuZDpyZ2JhKDI1NSwyNTUsMjU1LC4yOCk7cGFkZGluZzoxcHggNnB4O2JvcmRlci1yYWRpdXM6OTk5cHg7Zm9udC1zaXplOjkuNXB4O2ZvbnQtd2VpZ2h0OjgwMDtsZXR0ZXItc3BhY2luZzouMnB4O30KICAuY3YtY29weS10aXB7bWFyZ2luLXRvcDo4cHg7cGFkZGluZzo3cHggMTFweDtiYWNrZ3JvdW5kOnZhcigtLWF4LWdyZWVuLWxpZ2h0KTtib3JkZXI6MXB4IHNvbGlkICNjOWU2ZDg7Ym9yZGVyLXJhZGl1czo3cHg7Zm9udC1zaXplOjExLjVweDtjb2xvcjp2YXIoLS1heC1ncmVlbi1kYXJrKTtsaW5lLWhlaWdodDoxLjY7fQogIC5jdi1wYXN0ZXt3aWR0aDoxMDAlO3BhZGRpbmc6MTBweCAxMnB4O2JvcmRlcjoxLjVweCBzb2xpZCB2YXIoLS1heC1ib3JkZXIpO2JvcmRlci1yYWRpdXM6N3B4O2ZvbnQtc2l6ZToxMnB4O2ZvbnQtZmFtaWx5OnVpLW1vbm9zcGFjZSxTRk1vbm8tUmVndWxhcixNZW5sbyxtb25vc3BhY2U7bGluZS1oZWlnaHQ6MS41O3Jlc2l6ZTp2ZXJ0aWNhbDt0cmFuc2l0aW9uOmJvcmRlci1jb2xvciAuMTVzLGJveC1zaGFkb3cgLjE1czt9CiAgLmN2LXBhc3RlOmZvY3Vze291dGxpbmU6bm9uZTtib3JkZXItY29sb3I6dmFyKC0tYXgtZ3JlZW4pO2JveC1zaGFkb3c6MCAwIDAgMnB4IHJnYmEoMzAsMTU4LDEwNiwuMTIpO30KICAuY3YtcGFzdGUuZmlsbGVke2JvcmRlci1jb2xvcjp2YXIoLS1heC1ncmVlbik7YmFja2dyb3VuZDojZmJmZWZjO30KICAuY3Ytb3B0cm93e21hcmdpbi10b3A6MTBweDtmb250LXNpemU6MTEuNXB4O30KICAuY3Ytb3B0cm93IGxhYmVse2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjdweDtjdXJzb3I6cG9pbnRlcjtjb2xvcjojNGI1NTYzO2xpbmUtaGVpZ2h0OjEuNTtmb250LXdlaWdodDo0MDA7fQogIC5jdi1kZXRhaWx7bWFyZ2luLXRvcDo4cHg7Zm9udC1zaXplOjExLjVweDt9CiAgLmN2LWRldGFpbCBzdW1tYXJ5e2N1cnNvcjpwb2ludGVyO2NvbG9yOnZhcigtLWF4LWdyZWVuLWRhcmspO2ZvbnQtd2VpZ2h0OjYwMDtsaXN0LXN0eWxlOm5vbmU7ZGlzcGxheTppbmxpbmUtZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjVweDt1c2VyLXNlbGVjdDpub25lO30KICAuY3YtZGV0YWlsIHN1bW1hcnk6Oi13ZWJraXQtZGV0YWlscy1tYXJrZXJ7ZGlzcGxheTpub25lO30KICAuY3YtZGV0YWlsIHN1bW1hcnk6OmJlZm9yZXtjb250ZW50OifilrgnO2ZvbnQtc2l6ZToxMHB4O3RyYW5zaXRpb246dHJhbnNmb3JtIC4xNXM7fQogIC5jdi1kZXRhaWxbb3Blbl0gc3VtbWFyeTo6YmVmb3Jle3RyYW5zZm9ybTpyb3RhdGUoOTBkZWcpO30KICAuY3YtZGV0YWlsLWJvZHl7bWFyZ2luLXRvcDo4cHg7cGFkZGluZzoxMXB4IDEzcHg7YmFja2dyb3VuZDojZjdmOWZiO2JvcmRlcjoxcHggc29saWQgdmFyKC0tYXgtYm9yZGVyKTtib3JkZXItcmFkaXVzOjdweDtjb2xvcjojNGI1NTYzO2xpbmUtaGVpZ2h0OjEuNzt9CiAgLmN2LWRldGFpbC1ib2R5IC5jdi1wcm9tcHR7bWFyZ2luLXRvcDo4cHg7d2lkdGg6MTAwJTtwYWRkaW5nOjhweCAxMHB4O2JvcmRlcjoxcHggc29saWQgdmFyKC0tYXgtYm9yZGVyKTtib3JkZXItcmFkaXVzOjVweDtmb250LXNpemU6MTFweDtmb250LWZhbWlseTp1aS1tb25vc3BhY2UsbW9ub3NwYWNlO2JhY2tncm91bmQ6I2ZmZjtjb2xvcjojNTU1O30KICAuY3YtdGlwe2Rpc3BsYXk6ZmxleDtnYXA6N3B4O21hcmdpbi10b3A6MTJweDtwYWRkaW5nOjlweCAxMnB4O2JhY2tncm91bmQ6I2ZmZmRmNTtib3JkZXI6MXB4IHNvbGlkICNmMGU2Yzg7Ym9yZGVyLXJhZGl1czo3cHg7Zm9udC1zaXplOjExLjVweDtjb2xvcjojN2E2YTNhO2xpbmUtaGVpZ2h0OjEuNjt9CiAgLmN2LXN0YXR1cy1ib3h7bWFyZ2luLXRvcDo0cHg7cGFkZGluZzoxMXB4IDEzcHg7Ym9yZGVyLXJhZGl1czo3cHg7Zm9udC1zaXplOjEycHg7bGluZS1oZWlnaHQ6MS42O3RleHQtYWxpZ246bGVmdDtkaXNwbGF5Om5vbmU7fQogIC5jdi1zdGF0dXMtYm94LnNob3d7ZGlzcGxheTpibG9jazt9CiAgLmN2LXN0YXR1cy1ib3gub2t7YmFja2dyb3VuZDp2YXIoLS1heC1ncmVlbi1saWdodCk7Ym9yZGVyOjFweCBzb2xpZCAjYmZlM2QyO2NvbG9yOnZhcigtLWF4LWdyZWVuLWRhcmspO30KICAuY3Ytc3RhdHVzLWJveC5lcnJ7YmFja2dyb3VuZDojZmRmMGYwO2JvcmRlcjoxcHggc29saWQgI2YzYzljYjtjb2xvcjojYTMzODNjO30KICAuY3Ytc3RhdHVzLWJveC5pbmZve2JhY2tncm91bmQ6I2YwZjdmZjtib3JkZXI6MXB4IHNvbGlkICNjZmU0ZmI7Y29sb3I6IzFmNGE3NTt9CiAgLmN2LXN0YXR1cy1ib3ggYntmb250LXdlaWdodDo3MDA7fQogIC5jdi1zdGF0dXMtYm94IC5jdi1maXh7bWFyZ2luLXRvcDo1cHg7Zm9udC1zaXplOjExLjVweDtvcGFjaXR5Oi45Mjt9CgogIC8qIC0tLS0gRXhwb3J0LW1vZGUgaW50ZXJhY3RpdmUgY29tcG9uZW50IHN0YXRlcyAob25seSB1c2VkIGJ5IGV4cG9ydGVkIEhUTUwgbWFya3VwKSAtLS0tICovCiAgLmF4LWlucHV0LXgsLmF4LWRhdGUteHt3aWR0aDoxMDAlO2hlaWdodDoxMDAlO2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjNweDt9CiAgLmF4LWlucHV0LWVsLC5heC1kYXRlLWVse2ZsZXg6MTttaW4td2lkdGg6MDtoZWlnaHQ6MTAwJTtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWF4LWJvcmRlcik7Ym9yZGVyLXJhZGl1czo0cHg7YmFja2dyb3VuZDojZmZmO3BhZGRpbmc6MCA4cHg7Zm9udC1zaXplOjEycHg7Y29sb3I6IzExMTtvdXRsaW5lOm5vbmU7Zm9udC1mYW1pbHk6aW5oZXJpdDt0cmFuc2l0aW9uOmJvcmRlci1jb2xvciAuMTJzLGJveC1zaGFkb3cgLjEyczt9CiAgLmF4LWlucHV0LWVsOmhvdmVyLC5heC1kYXRlLWVsOmhvdmVye2JvcmRlci1jb2xvcjojOWZiOGNlO30KICAuYXgtaW5wdXQtZWw6Zm9jdXMsLmF4LWRhdGUtZWw6Zm9jdXN7Ym9yZGVyLWNvbG9yOnZhcigtLWF4LWdyZWVuKTtib3gtc2hhZG93OjAgMCAwIDJweCByZ2JhKDMwLDE1OCwxMDYsLjEyKTt9CiAgLmF4LWlucHV0LXgucm8gLmF4LWlucHV0LWVsLC5heC1kYXRlLXgucm8gLmF4LWRhdGUtZWx7YmFja2dyb3VuZDp2YXIoLS1heC1yZWFkb25seS1iZyk7Y29sb3I6IzU1NTtjdXJzb3I6bm90LWFsbG93ZWQ7fQogIC5heC1pbnB1dC14LnJlcXVpcmVkIC5heC1pbnB1dC1lbCwuYXgtZGF0ZS14LnJlcXVpcmVkIC5heC1kYXRlLWVse2JhY2tncm91bmQ6dmFyKC0tYXgtcmVxdWlyZWQtYmcpO30KICAuYXgtZGF0ZXJhbmdlLXh7d2lkdGg6MTAwJTtoZWlnaHQ6MTAwJTtkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDo1cHg7fQogIC5heC1kYXRlcmFuZ2UteCAuYXgtZGF0ZS1lbHtmbGV4OjE7bWluLXdpZHRoOjA7fQogIC5kci1zZXB7Y29sb3I6dmFyKC0tYXgtZ3JheSk7Zm9udC1zaXplOjEycHg7ZmxleDpub25lO30KICAuYXgtZGF0ZXJhbmdlLXgucm8gLmF4LWRhdGUtZWx7YmFja2dyb3VuZDp2YXIoLS1heC1yZWFkb25seS1iZyk7Y29sb3I6IzU1NTtjdXJzb3I6bm90LWFsbG93ZWQ7fQogIC5heC1kYXRlcmFuZ2UteC5yZXF1aXJlZCAuYXgtZGF0ZS1lbHtiYWNrZ3JvdW5kOnZhcigtLWF4LXJlcXVpcmVkLWJnKTt9CiAgLyog64Kg7KecMS/rgqDsp5wyIOqwnOuzhCDtlYTsiJjCt+ydveq4sOyghOyaqSAqLwogIC5heC1kYXRlcmFuZ2UteCAuYXgtZGF0ZS1lbC5yb3tiYWNrZ3JvdW5kOnZhcigtLWF4LXJlYWRvbmx5LWJnKTtjb2xvcjojNTU1O2N1cnNvcjpub3QtYWxsb3dlZDt9CiAgLmF4LWRhdGVyYW5nZS14IC5heC1kYXRlLWVsLmlzLXJlcXtiYWNrZ3JvdW5kOnZhcigtLWF4LXJlcXVpcmVkLWJnKTt9CiAgLmF4LWNvbWJvLmludGVyYWN0aXZlLC5zY3RsLmNvbWJvLmludGVyYWN0aXZle2N1cnNvcjpwb2ludGVyO3RyYW5zaXRpb246Ym9yZGVyLWNvbG9yIC4xMnM7fQogIC5heC1jb21iby5pbnRlcmFjdGl2ZTpob3Zlciwuc2N0bC5jb21iby5pbnRlcmFjdGl2ZTpob3Zlcntib3JkZXItY29sb3I6IzlmYjhjZTt9CiAgLmF4LWNvbWJvLmludGVyYWN0aXZlLm9wZW4sLnNjdGwuY29tYm8uaW50ZXJhY3RpdmUub3Blbntib3JkZXItY29sb3I6dmFyKC0tYXgtZ3JlZW4pO30KICAuYXgtY29tYm86OmFmdGVye3RyYW5zaXRpb246dHJhbnNmb3JtIC4xNXM7fQogIC5heC1jb21iby5pbnRlcmFjdGl2ZS5vcGVuOjphZnRlcnt0cmFuc2Zvcm06cm90YXRlKDE4MGRlZyk7fQogIC5heC1jb21iby5yb3tjdXJzb3I6ZGVmYXVsdDtiYWNrZ3JvdW5kOnZhcigtLWF4LXJlYWRvbmx5LWJnKTtjb2xvcjojNTU1O30KICAuYXgtY2hlY2suaW50ZXJhY3RpdmUsLmF4LXJhZGlvLmludGVyYWN0aXZle2N1cnNvcjpwb2ludGVyO30KICAuYXgtY2hlY2suaW50ZXJhY3RpdmUgLmJveHt0cmFuc2l0aW9uOmJhY2tncm91bmQgLjEycyxib3JkZXItY29sb3IgLjEyczt9CiAgLmF4LWNoZWNrLmludGVyYWN0aXZlOmhvdmVyIC5ib3h7Ym9yZGVyLWNvbG9yOnZhcigtLWF4LWdyZWVuKTt9CiAgLmF4LWNoZWNrLmludGVyYWN0aXZlIC5ib3gub257YmFja2dyb3VuZDp2YXIoLS1heC1ncmVlbik7Ym9yZGVyLWNvbG9yOnZhcigtLWF4LWdyZWVuKTtwb3NpdGlvbjpyZWxhdGl2ZTt9CiAgLmF4LWNoZWNrLmludGVyYWN0aXZlIC5ib3gub246OmFmdGVye2NvbnRlbnQ6IuKckyI7cG9zaXRpb246YWJzb2x1dGU7aW5zZXQ6MDtkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2p1c3RpZnktY29udGVudDpjZW50ZXI7Y29sb3I6I2ZmZjtmb250LXNpemU6MTBweDtsaW5lLWhlaWdodDoxO30KICAuYXgtcmFkaW8uaW50ZXJhY3RpdmUgLmRvdHt0cmFuc2l0aW9uOmJvcmRlci1jb2xvciAuMTJzO30KICAuYXgtcmFkaW8uaW50ZXJhY3RpdmU6aG92ZXIgLmRvdHtib3JkZXItY29sb3I6dmFyKC0tYXgtZ3JlZW4tZGFyayk7fQogIC5heC1yYWRpby5pbnRlcmFjdGl2ZSAuZG90OjphZnRlcntkaXNwbGF5Om5vbmU7fQogIC5heC1yYWRpby5pbnRlcmFjdGl2ZS5vbiAuZG90OjphZnRlcntkaXNwbGF5OmJsb2NrO30KICAuc3JhZGlvIC5vcHQuaW50ZXJhY3RpdmV7Y3Vyc29yOnBvaW50ZXI7fQogIC5zcmFkaW8gLm9wdC5pbnRlcmFjdGl2ZTpob3ZlciAuZG90e2JvcmRlci1jb2xvcjp2YXIoLS1heC1ncmVlbi1kYXJrKTt9CiAgLmF4LWJ0bntjdXJzb3I6cG9pbnRlcjt0cmFuc2l0aW9uOmJhY2tncm91bmQgLjEycyx0cmFuc2Zvcm0gLjA1cyxib3gtc2hhZG93IC4xMnM7fQogIC5heC1idG46aG92ZXJ7YmFja2dyb3VuZDp2YXIoLS1heC1ncmVlbi1kYXJrKTt9CiAgLmF4LWJ0bi5naG9zdDpob3ZlcntiYWNrZ3JvdW5kOnZhcigtLWF4LWdyZWVuLWxpZ2h0KTt9CiAgLmF4LWJ0bjphY3RpdmV7dHJhbnNmb3JtOnNjYWxlKC45Nyk7fQogIC5nYnRue2N1cnNvcjpwb2ludGVyO3RyYW5zaXRpb246YmFja2dyb3VuZCAuMTJzLGJvcmRlci1jb2xvciAuMTJzO30KICAuZ2J0bjpub3QoLmRpc2FibGVkKTpob3ZlcntiYWNrZ3JvdW5kOnZhcigtLWF4LWdyZWVuLWRhcmspO2JvcmRlci1jb2xvcjp2YXIoLS1heC1ncmVlbi1kYXJrKTt9CiAgLmF4LWdyaWQgLmdyLmhvdmVyYWJsZXt0cmFuc2l0aW9uOmJhY2tncm91bmQgLjFzO30KICAuYXgtZ3JpZCAuZ3IuaG92ZXJhYmxlOmhvdmVye2JhY2tncm91bmQ6I2YzZjlmNjt9CiAgLmF4LXNlYXJjaC10b2dnbGUtd3JhcHt3aWR0aDoxMDAlO2hlaWdodDoxMDAlO3Bvc2l0aW9uOnJlbGF0aXZlO30KICAuYXgtc2VhcmNoLXRvZ2dsZS13cmFwIC5heC1zZWFyY2h7d2lkdGg6MTAwJTtoZWlnaHQ6MTAwJTt9CiAgLyogbGV0IGEgY29tYm8gZHJvcGRvd24gZXNjYXBlIHRoZSBwYW5lbCBpbnN0ZWFkIG9mIGJlaW5nIGNsaXBwZWQgYnkgb3ZlcmZsb3c6aGlkZGVuICovCiAgLmF4LXNlYXJjaHtvdmVyZmxvdzp2aXNpYmxlO30KICAuYXgtc2VhcmNoIC5zZmllbGRze292ZXJmbG93OnZpc2libGU7fQogIC5heC1zZWFyY2ggLnNjdGwuY29tYm8uaW50ZXJhY3RpdmV7cG9zaXRpb246cmVsYXRpdmU7fQogIC5heC1zZWFyY2ggLnNjdGwuY29tYm8uaW50ZXJhY3RpdmUub3Blbnt6LWluZGV4OjYwMDt9CiAgLmF4LXNlYXJjaC5jb2xsYXBzZWR7Y3Vyc29yOnBvaW50ZXI7fQogIC5heC1zZWFyY2ggLnNleHBhbmR7Y3Vyc29yOnBvaW50ZXI7dHJhbnNpdGlvbjpiYWNrZ3JvdW5kIC4xMnM7fQogIC5heC1zZWFyY2ggLnNleHBhbmQ6aG92ZXJ7YmFja2dyb3VuZDp2YXIoLS1heC1ncmVlbi1saWdodCk7fQogIC5zY3RsLmRhdGUteCwuc2N0bC50ZXh0LXh7cGFkZGluZzowO30KICAuc2N0bC1kYXRlLWVsLC5zY3RsLXRleHQtZWx7d2lkdGg6MTAwJTtoZWlnaHQ6MTAwJTtib3JkZXI6bm9uZTtvdXRsaW5lOm5vbmU7YmFja2dyb3VuZDp0cmFuc3BhcmVudDtmb250LXNpemU6MTJweDtjb2xvcjojMTExO3BhZGRpbmc6MCA4cHg7Zm9udC1mYW1pbHk6aW5oZXJpdDt9CiAgLmF4LXNlYXJjaCAuc2N0bC5kYXRlcmFuZ2UteHtwYWRkaW5nOjAgOHB4O2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjVweDt9CiAgLmF4LXNlYXJjaCAuc2N0bC5kYXRlcmFuZ2UteCAuc2N0bC1kYXRlLWVse3BhZGRpbmc6MDtmbGV4OjE7bWluLXdpZHRoOjA7fQogIC5heC1zZWFyY2ggLnNjdGwuc2VhcmNoLXh7cGFkZGluZzowIDhweDtkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDo4cHg7fQogIC5heC1zZWFyY2ggLnNjdGwuc2VhcmNoLXggLnNjdGwtdGV4dC1lbHtmbGV4OjE7bWluLXdpZHRoOjA7cGFkZGluZzowO30KICAuYXgtcmFkaW8tZ3JvdXB7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6MTRweDtoZWlnaHQ6MTAwJTtmbGV4LXdyYXA6d3JhcDt9CiAgLmF4LXJhZGlvLWdyb3VwIC5vcHR7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6NXB4O2ZvbnQtc2l6ZToxMnB4O2NvbG9yOiMzNzQxNTE7fQogIC5heC1yYWRpby1ncm91cCAub3B0IC5kb3R7d2lkdGg6MTRweDtoZWlnaHQ6MTRweDtib3JkZXI6MS41cHggc29saWQgdmFyKC0tYXgtZ3JlZW4pO2JvcmRlci1yYWRpdXM6NTAlO3Bvc2l0aW9uOnJlbGF0aXZlO2ZsZXg6bm9uZTt9CiAgLmF4LXJhZGlvLWdyb3VwIC5vcHQgLmRvdDo6YWZ0ZXJ7Y29udGVudDoiIjtwb3NpdGlvbjphYnNvbHV0ZTtpbnNldDozcHg7YmFja2dyb3VuZDp2YXIoLS1heC1ncmVlbik7Ym9yZGVyLXJhZGl1czo1MCU7ZGlzcGxheTpub25lO30KICAuYXgtcmFkaW8tZ3JvdXAgLm9wdC5vbiAuZG90OjphZnRlcntkaXNwbGF5OmJsb2NrO30KICAuYXgtcmFkaW8tZ3JvdXAgLm9wdC5pbnRlcmFjdGl2ZXtjdXJzb3I6cG9pbnRlcjt9CiAgLmF4LXJhZGlvLWdyb3VwIC5vcHQuaW50ZXJhY3RpdmU6aG92ZXIgLmRvdHtib3JkZXItY29sb3I6dmFyKC0tYXgtZ3JlZW4tZGFyayk7fQogIC5heC1jb21iby5pbnRlcmFjdGl2ZSwuc2N0bC5jb21iby5pbnRlcmFjdGl2ZXtwb3NpdGlvbjpyZWxhdGl2ZTt9CiAgLmNvbWJvLWRyb3B7cG9zaXRpb246YWJzb2x1dGU7bGVmdDowO3RvcDpjYWxjKDEwMCUgKyAzcHgpO21pbi13aWR0aDoxMDAlO21heC1oZWlnaHQ6MTgwcHg7b3ZlcmZsb3cteTphdXRvO2JhY2tncm91bmQ6I2ZmZjtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWF4LWJvcmRlcik7Ym9yZGVyLXJhZGl1czo2cHg7Ym94LXNoYWRvdzowIDRweCAxNHB4IHJnYmEoMCwwLDAsLjEyKTt6LWluZGV4OjUwMDtkaXNwbGF5Om5vbmU7fQogIC5heC1jb21iby5pbnRlcmFjdGl2ZS5vcGVuIC5jb21iby1kcm9wLC5zY3RsLmNvbWJvLmludGVyYWN0aXZlLm9wZW4gLmNvbWJvLWRyb3B7ZGlzcGxheTpibG9jazt9CiAgLm1vY2t1cC1pdGVtOmhhcyguYXgtY29tYm8uaW50ZXJhY3RpdmUub3BlbiksLm1vY2t1cC1pdGVtOmhhcyguc2N0bC5jb21iby5pbnRlcmFjdGl2ZS5vcGVuKXt6LWluZGV4Ojk5OTk5IWltcG9ydGFudDt9CiAgLmNvbWJvLW9wdHtwYWRkaW5nOjdweCAxMHB4O2ZvbnQtc2l6ZToxMnB4O2NvbG9yOiMzMzM7Y3Vyc29yOnBvaW50ZXI7d2hpdGUtc3BhY2U6bm93cmFwO30KICAuY29tYm8tb3B0OmhvdmVye2JhY2tncm91bmQ6dmFyKC0tYXgtZ3JlZW4tbGlnaHQpO30KICAKICAuYnJhbmQtYm94e2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcjtnYXA6NXB4O2JhY2tncm91bmQ6I2ZmZjtib3JkZXI6MXB4IHNvbGlkIHJnYmEoMjU1LDI1NSwyNTUsLjY1KTsKICAgIGJvcmRlci1yYWRpdXM6N3B4O3BhZGRpbmc6M3B4IDlweDtib3gtc2hhZG93OjAgMXB4IDNweCByZ2JhKDAsMCwwLC4yNSk7CiAgICB3aWR0aDoxODBweDtib3gtc2l6aW5nOmJvcmRlci1ib3g7fQogIC5icmFuZC1te3Bvc2l0aW9uOnJlbGF0aXZlO2Rpc3BsYXk6aW5saW5lLWJsb2NrO2hlaWdodDoyOHB4O2xpbmUtaGVpZ2h0OjA7CiAgICAtd2Via2l0LW1hc2stc2l6ZTpjb250YWluO21hc2stc2l6ZTpjb250YWluOy13ZWJraXQtbWFzay1yZXBlYXQ6bm8tcmVwZWF0O21hc2stcmVwZWF0Om5vLXJlcGVhdDsKICAgIC13ZWJraXQtbWFzay1wb3NpdGlvbjpjZW50ZXI7bWFzay1wb3NpdGlvbjpjZW50ZXI7fQogIC5icmFuZC1tIGltZ3toZWlnaHQ6MjhweDt3aWR0aDphdXRvO2Rpc3BsYXk6YmxvY2s7fQogIC5icmFuZC13b3Jke2hlaWdodDoyOHB4O3dpZHRoOmF1dG87ZGlzcGxheTpibG9jazt9CiAgLmJyYW5kLXNoaW5le3Bvc2l0aW9uOmFic29sdXRlO3RvcDowO2xlZnQ6LTQ1JTt3aWR0aDoyOCU7aGVpZ2h0OjEwMCU7cG9pbnRlci1ldmVudHM6bm9uZTsKICAgIGJhY2tncm91bmQ6bGluZWFyLWdyYWRpZW50KDEwMGRlZyxyZ2JhKDI1NSwyNTUsMjU1LDApIDAlLHJnYmEoMjU1LDI1NSwyNTUsLjU1KSAyNSUscmdiYSgyNTUsMjU1LDI1NSwuOTgpIDUwJSxyZ2JhKDI1NSwyNTUsMjU1LC41NSkgNzUlLHJnYmEoMjU1LDI1NSwyNTUsMCkgMTAwJSk7CiAgICBtaXgtYmxlbmQtbW9kZTpvdmVybGF5O2ZpbHRlcjpibHVyKC41cHgpOwogICAgYW5pbWF0aW9uOmJyYW5kU2hpbmUgMi42cyBlYXNlLWluLW91dCBpbmZpbml0ZTt9CiAgQGtleWZyYW1lcyBicmFuZFNoaW5lezAle2xlZnQ6LTQ1JTt9NjAle2xlZnQ6MTI1JTt9MTAwJXtsZWZ0OjEyNSU7fX0KICBAbWVkaWEgKHByZWZlcnMtcmVkdWNlZC1tb3Rpb246cmVkdWNlKXsuYnJhbmQtc2hpbmV7YW5pbWF0aW9uOm5vbmU7b3BhY2l0eTowO319CgogIC8qIC0tLS0gRmF0IE1vZGUg7KCE7JqpIOuUlO2FjOydvDog7IOJ7IOB7J2AIOychCDrs4DsiJgg7J6s7KCV7J2Y66GcIOydtOuvuCDrsJjsmIHrkJjqs6AsCiAgICAg7Jes6riw7ISc64qUIOuzgOyImOunjOycvOuhnOuKlCDtkZztmIQg7JWIIOuQmOuKlCDrqqjshJzrpqwg6rCB7KeQ6rO8IOuhnOqzoCDsg4nsobAg7KCE7ZmY66eMIOyymOumrO2VnOuLpC4gLS0tLSAqLwogIGgxLmJyYW5ke2N1cnNvcjpwb2ludGVyO30KICAubWItYnJhbmR7Y3Vyc29yOnBvaW50ZXI7fQogIGJvZHkuc2tpbi1jbGFzc2ljICNjYW52YXMsCiAgYm9keS5za2luLWNsYXNzaWMgLmF4LWlucHV0LAogIGJvZHkuc2tpbi1jbGFzc2ljIC5heC1pbnB1dC14LAogIGJvZHkuc2tpbi1jbGFzc2ljIC5heC1pbnB1dC1lbCwKICBib2R5LnNraW4tY2xhc3NpYyAuYXgtY29tYm8sCiAgYm9keS5za2luLWNsYXNzaWMgLmF4LWRhdGUsCiAgYm9keS5za2luLWNsYXNzaWMgLmF4LWRhdGUteCwKICBib2R5LnNraW4tY2xhc3NpYyAuYXgtZGF0ZS1lbCwKICBib2R5LnNraW4tY2xhc3NpYyAuYXgtZGF0ZXJhbmdlLXgsCiAgYm9keS5za2luLWNsYXNzaWMgLmF4LWRhdGVyYW5nZSAuYXgtZGF0ZS1wYXJ0LAogIGJvZHkuc2tpbi1jbGFzc2ljIC5heC1idG4sCiAgYm9keS5za2luLWNsYXNzaWMgLmF4LWdyaWQsCiAgYm9keS5za2luLWNsYXNzaWMgLmF4LXRyZWUsCiAgYm9keS5za2luLWNsYXNzaWMgLmF4LXBhbmVsLWMsCiAgYm9keS5za2luLWNsYXNzaWMgLmF4LXNwbGl0LWMsCiAgYm9keS5za2luLWNsYXNzaWMgLmF4LWNoYXJ0LAogIGJvZHkuc2tpbi1jbGFzc2ljIC5heC1zZWFyY2gsCiAgYm9keS5za2luLWNsYXNzaWMgLmF4LXNlYXJjaCAuc2N0bCwKICBib2R5LnNraW4tY2xhc3NpYyAuYXgtc2VhcmNoIC5zZXhwYW5kLAogIGJvZHkuc2tpbi1jbGFzc2ljIC5heC1zZWFyY2ggLnNzZWFyY2gsCiAgYm9keS5za2luLWNsYXNzaWMgLmNvbWJvLWRyb3AsCiAgYm9keS5za2luLWNsYXNzaWMgLmdidG4sCiAgYm9keS5za2luLWNsYXNzaWMgLnRvb2wsCiAgYm9keS5za2luLWNsYXNzaWMgLnRtcGwtY2FyZCwKICBib2R5LnNraW4tY2xhc3NpYyAudG9wYmFyIGJ1dHRvbiwKICBib2R5LnNraW4tY2xhc3NpYyAubW9kZS1zd2l0Y2ggLm1zYiwKICBib2R5LnNraW4tY2xhc3NpYyAubHAtYnRuLAogIGJvZHkuc2tpbi1jbGFzc2ljIC5zcGxpdC10YWcsCiAgYm9keS5za2luLWNsYXNzaWMgLmF4LWNoZWNrIC5ib3gsCiAgYm9keS5za2luLWNsYXNzaWMgLmF4LWdyaWQgLmdyIC5nY2VsbC1jaGVjayAuYm94CiAge2JvcmRlci1yYWRpdXM6MnB4O30KICAvKiDroZzqs6AgTSDsnbTrr7jsp4DripQg7JuQ67O47J20IOq3uOumsCDthqQgUE5H6528LCBjbGFzc2ljIOyKpO2CqOyXkOyEnOuKlCDtlYTthLDroZwg67iU66OoIOqzhOyXtOuhnCDsg4nsobDrp4wg7KCE7ZmY7ZWc64ukLiAqLwogIGJvZHkuc2tpbi1jbGFzc2ljIC5icmFuZC1tIGltZywKICBib2R5LnNraW4tY2xhc3NpYyAjbWJUb3AgLm1iLWJyYW5kLW1hcmsgaW1newogICAgZmlsdGVyOmdyYXlzY2FsZSgxKSBzZXBpYSgxKSBodWUtcm90YXRlKDE4MGRlZykgc2F0dXJhdGUoNCkgYnJpZ2h0bmVzcyguOTIpOwogIH0KCi8qID09PT09IOuqqOuwlOydvCBBZGFwdGl2ZSBVSSBMYXllciB2MiA9PT09PSAqLwo6cm9vdHsKICAtLW1iLXN1cmZhY2U6I2ZmZmZmZjsKICAtLW1iLWluazojMWYyYjM4OwogIC0tbWItaW5rLXNvZnQ6IzViNmI3YTsKICAtLW1iLWxpbmU6I2U0ZTllZTsKICAtLW1iLWFjY2VudDojMWU5ZTZhOwogIC0tbWItYWNjZW50LWluazojMGY3YTRmOwogIC0tbWItYWNjZW50LXNvZnQ6I2U3ZjVlZTsKICAtLW1iLW5hdnk6IzIyMzAzZjsKICAtLW1iLWRhbmdlcjojZDY0NTQ1OwogIC0tbWItc2hhZG93OjAgOHB4IDMwcHggcmdiYSgyMCwzMyw0OCwuMTYpOwogIC0tbWItc2hhZG93LXNtOjAgMnB4IDEwcHggcmdiYSgyMCwzMyw0OCwuMTApOwogIC0tbWItcmFkaXVzOjE2cHg7CiAgLS1tYi10YXA6NDRweDsKfQovKiDquLDrs7g6IOuqqOuToCDrqqjrsJTsnbwgVUkg7JqU7IaMIOyIqOq5gChQQyDrrLTqsJzsnoUpICovCi5tYnh7ZGlzcGxheTpub25lO30KCi8qID09PT09PT09PT09PT09PT09PT09PSDqs7XthrUobW9iaWxlK3RhYmxldCkgPT09PT09PT09PT09PT09PT09PT09ICovCmJvZHkubWItbW9iaWxlLCBib2R5Lm1iLXRhYmxldHtvdmVyZmxvdzpoaWRkZW47b3ZlcnNjcm9sbC1iZWhhdmlvcjpub25lO30KYm9keS5tYi1tb2JpbGUgLm1ieCwgYm9keS5tYi10YWJsZXQgLm1ieHtkaXNwbGF5OmZsZXg7fQoKLyogUEMg7IOB64uo67CUL+yijOyasCDtjKjrhJAg6rCQ7LaU6rOgIOy6lOuyhOyKpOulvCDsoITssrTroZwgKi8KYm9keS5tYi1tb2JpbGUgLnRvcGJhciwgYm9keS5tYi10YWJsZXQgLnRvcGJhcntkaXNwbGF5Om5vbmU7fQpib2R5Lm1iLW1vYmlsZSAuYXBwLCBib2R5Lm1iLXRhYmxldCAuYXBwewogIGRpc3BsYXk6YmxvY2s7aGVpZ2h0OjEwMHZoO2hlaWdodDoxMDBkdmg7cGFkZGluZzowOwp9CmJvZHkubWItbW9iaWxlIC50b29sYm94LCBib2R5Lm1iLXRhYmxldCAudG9vbGJveHtwb3NpdGlvbjpmaXhlZDtsZWZ0Oi05OTk5cHg7dG9wOjA7d2lkdGg6MTgwcHg7fQpib2R5Lm1iLW1vYmlsZSAucHJvcHMsICAgYm9keS5tYi10YWJsZXQgLnByb3Bze3Bvc2l0aW9uOmZpeGVkO2xlZnQ6LTk5OTlweDt0b3A6MDt3aWR0aDoyODBweDt9CmJvZHkubWItbW9iaWxlICNwcm9wc1NwbGl0LCBib2R5Lm1iLXRhYmxldCAjcHJvcHNTcGxpdHtkaXNwbGF5Om5vbmU7fQpib2R5Lm1iLW1vYmlsZSAucHJvcHMubWItaW4tc2hlZXQsIGJvZHkubWItdGFibGV0IC5wcm9wcy5tYi1pbi1zaGVldHsKICBwb3NpdGlvbjpzdGF0aWMhaW1wb3J0YW50O2xlZnQ6YXV0byFpbXBvcnRhbnQ7dG9wOmF1dG8haW1wb3J0YW50OwogIHdpZHRoOjEwMCUhaW1wb3J0YW50O2hlaWdodDphdXRvIWltcG9ydGFudDtvdmVyZmxvdzp2aXNpYmxlIWltcG9ydGFudDtkaXNwbGF5OmJsb2NrIWltcG9ydGFudDsKfQpib2R5Lm1iLW1vYmlsZSAuY2FudmFzLXdyYXAsIGJvZHkubWItdGFibGV0IC5jYW52YXMtd3JhcHsKICBwb3NpdGlvbjpmaXhlZDtpbnNldDowO2Rpc3BsYXk6YmxvY2s7cGFkZGluZzowO2JhY2tncm91bmQ6I2VlZjFmNDsKfQpib2R5Lm1iLW1vYmlsZSAudG9vbGJhcjIsIGJvZHkubWItdGFibGV0IC50b29sYmFyMntkaXNwbGF5Om5vbmU7fSAgIC8qIOuztOq4sOyEpOygleydgCDimpkg7Iuc7Yq466GcIOydtOuPmSAqLwpib2R5Lm1iLW1vYmlsZSAuY2FudmFzLXNjcm9sbCwgYm9keS5tYi10YWJsZXQgLmNhbnZhcy1zY3JvbGx7CiAgcG9zaXRpb246YWJzb2x1dGU7bGVmdDowO3JpZ2h0OjA7dG9wOjUycHg7Ym90dG9tOjA7cGFkZGluZzoyNnB4Oy13ZWJraXQtb3ZlcmZsb3ctc2Nyb2xsaW5nOnRvdWNoOwp9Ci8qIOuvuOumrOuztOq4sCDrqqjrk5zsl5DshJzripQg7IOB64uo67CU6rCAIOyCrOudvOyngOuvgOuhnCDsupTrsoTsiqTqsIAg7JyE6rmM7KeAIOyCrOyaqSAqLwpib2R5Lm1iLW1vYmlsZS5tYi1wcmV2aWV3IC5jYW52YXMtc2Nyb2xsLCBib2R5Lm1iLXRhYmxldC5tYi1wcmV2aWV3IC5jYW52YXMtc2Nyb2xse3RvcDowO30KCi8qIOy6lOuyhOyKpCDtjrjsp5Eg7KSRIO2FjeyKpO2KuCDshKDtg50v7L2c7JWE7JuDIOywqOuLqCAqLwpib2R5Lm1iLW1vYmlsZSAjY2FudmFzLCBib2R5Lm1iLXRhYmxldCAjY2FudmFzLApib2R5Lm1iLW1vYmlsZSAjY2FudmFzICosIGJvZHkubWItdGFibGV0ICNjYW52YXMgKnsKICAtd2Via2l0LXVzZXItc2VsZWN0Om5vbmU7dXNlci1zZWxlY3Q6bm9uZTstd2Via2l0LXRvdWNoLWNhbGxvdXQ6bm9uZTsKfQpib2R5Lm1iLW1vYmlsZSAuY2FudmFzLXNjcm9sbCwgYm9keS5tYi10YWJsZXQgLmNhbnZhcy1zY3JvbGx7dG91Y2gtYWN0aW9uOnBhbi14IHBhbi15O30KCi8qIC0tLS0tLS0tLS0g7IOB64uoIOuvuOuLiCDslbHrsJQgKOuwmO2IrOuqhSwg7LqU67KE7IqkIOychOyXkCDrlqAg7J6I7J2MKSAtLS0tLS0tLS0tICovCiNtYlRvcHsKICBwb3NpdGlvbjpmaXhlZDt0b3A6MDtsZWZ0OjA7cmlnaHQ6MDtoZWlnaHQ6NTJweDt6LWluZGV4OjE0MDA7CiAgYWxpZ24taXRlbXM6Y2VudGVyO2dhcDo4cHg7cGFkZGluZzowIDEwcHg7CiAgYmFja2dyb3VuZDpsaW5lYXItZ3JhZGllbnQoMTgwZGVnLCByZ2JhKDM0LDQ4LDYzLC45NiksIHJnYmEoMzQsNDgsNjMsLjg2KSk7CiAgYmFja2Ryb3AtZmlsdGVyOmJsdXIoNnB4KTtjb2xvcjojZmZmOwp9CiNtYlRvcCAubWItYnJhbmR7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6OXB4O2ZvbnQtc2l6ZToxNXB4O2ZvbnQtd2VpZ2h0OjgwMDtsZXR0ZXItc3BhY2luZzouMnB4O3doaXRlLXNwYWNlOm5vd3JhcDt9Ci8qIOuwsOyngDogUEMg66Gc6rOgIHBpbGwg6rO8IOuPmeydvO2VmOqyjCDtnbAg67Cw6rK9ICsgTSDsnbTrr7jsp4Ao7JuQ67O4IOyDiSkgKi8KI21iVG9wIC5tYi1icmFuZCAubWItYnJhbmQtbWFya3sKICBkaXNwbGF5OmlubGluZS1mbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtqdXN0aWZ5LWNvbnRlbnQ6ZmxleC1zdGFydDsKICB3aWR0aDozMnB4O2hlaWdodDozMnB4O2JvcmRlci1yYWRpdXM6OXB4O2ZsZXg6bm9uZTsKICBiYWNrZ3JvdW5kOiNmZmY7Ym9yZGVyOjFweCBzb2xpZCByZ2JhKDI1NSwyNTUsMjU1LC42NSk7CiAgYm94LXNoYWRvdzowIDJweCA2cHggcmdiYSgwLDAsMCwuMjgpOwogIG92ZXJmbG93OmhpZGRlbjtib3gtc2l6aW5nOmJvcmRlci1ib3g7Cn0KLyog7IaM7IqkIOydtOuvuOyngOuKlCAiTW9ja3VwIEJ1aWxkZXIiIOybjOuTnOuniO2BrCgyNjJ4NDgpIOKGkiDrsLDsp4DqsIAg7KKM7LihIE0g67aA67aE66eMIOuztOyXrOyjvOuPhOuhnSDtgbTrpr0gKi8KI21iVG9wIC5tYi1icmFuZCAubWItYnJhbmQtbWFyayBpbWd7CiAgaGVpZ2h0OjI0cHg7ICAgICAgICAgICAgICAvKiDsm5Drs7jsnZggNTAlIOy2leyGjCAqLwogIHdpZHRoOjEzMXB4OyAgICAgICAgICAgICAvKiAyNjIqMC41ID0g7JuM65Oc66eI7YGsIOyghOyytCDtj60gKi8KICBtYXgtd2lkdGg6bm9uZTtkaXNwbGF5OmJsb2NrO29iamVjdC1maXQ6ZmlsbDsKICBtYXJnaW4tbGVmdDowOyAgICAgICAgICAgLyog7Jm87Kq9IOygleugrCDihpIgTSDsnbQg67Cw7KeA7JeQIOqxuOumvCAqLwp9CiNtYlRvcCAubWItYnJhbmQgLm1iLWJyYW5kLW1hcmsubWItbWFyay1mYWxsYmFja3tjb2xvcjp2YXIoLS1tYi1hY2NlbnQpO2ZvbnQtc2l6ZToxNnB4O2ZvbnQtd2VpZ2h0OjkwMDtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyO3BhZGRpbmc6MDt9Ci8qIO2FjeyKpO2KuDogUEMg7YakKO2dsOyDiSnsl5Ag66ee7LakICovCiNtYlRvcCAubWItYnJhbmQgLm1iLWJyYW5kLXR4dHsKICBwb3NpdGlvbjpyZWxhdGl2ZTtkaXNwbGF5OmlubGluZS1ibG9jaztvdmVyZmxvdzpoaWRkZW47CiAgZm9udC1zaXplOjE3cHg7Zm9udC13ZWlnaHQ6ODAwO2NvbG9yOiNmZmY7bGluZS1oZWlnaHQ6MTsKfQojbWJUb3AgLm1iLWJyYW5kIC5tYi1icmFuZC1hY2NlbnR7Y29sb3I6IzJlY2M4Zjtmb250LXdlaWdodDo4MDA7fQovKiDrqqjrk5wg67Cw7KeAIChtb2JpbGUpLyh0YWJsZXQpOiDtg4DsnbTti4Drs7Tri6Qg7IK07KedIOyekeqyjCwg7Z2w7IOJICovCiNtYlRvcCAubWItYnJhbmQgLm1iLWJyYW5kLW1vZGV7CiAgZGlzcGxheTppbmxpbmUtZmxleDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcjsKICBjb2xvcjojY2ZkNmRkO21hcmdpbi1sZWZ0OjdweDthbGlnbi1zZWxmOmNlbnRlcjtmbGV4Om5vbmU7Cn0KI21iVG9wIC5tYi1icmFuZCAubWItYnJhbmQtbW9kZSBzdmd7d2lkdGg6MThweDtoZWlnaHQ6MThweDtkaXNwbGF5OmJsb2NrO30KI21iVG9wIC5tYi1icmFuZCAubWItYnJhbmQtbW9kZTplbXB0eXtkaXNwbGF5Om5vbmU7fQojbWJUb3AgLm1iLWJyYW5kIC5tYi1icmFuZC1zaGluZXsKICBwb3NpdGlvbjphYnNvbHV0ZTt0b3A6MDtsZWZ0Oi02MCU7d2lkdGg6NDAlO2hlaWdodDoxMDAlO3BvaW50ZXItZXZlbnRzOm5vbmU7CiAgYmFja2dyb3VuZDpsaW5lYXItZ3JhZGllbnQoMTAwZGVnLCB0cmFuc3BhcmVudCwgcmdiYSgyNTUsMjU1LDI1NSwuNyksIHRyYW5zcGFyZW50KTsKICB0cmFuc2Zvcm06c2tld1goLTE4ZGVnKTsKICBhbmltYXRpb246bWJCcmFuZFNoaW5lIDVzIGVhc2UtaW4tb3V0IGluZmluaXRlOwp9CkBrZXlmcmFtZXMgbWJCcmFuZFNoaW5lezAle2xlZnQ6LTYwJTt9NDUle2xlZnQ6MTUwJTt9MTAwJXtsZWZ0OjE1MCU7fX0KQG1lZGlhIChwcmVmZXJzLXJlZHVjZWQtbW90aW9uOnJlZHVjZSl7I21iVG9wIC5tYi1icmFuZCAubWItYnJhbmQtc2hpbmV7YW5pbWF0aW9uOm5vbmU7b3BhY2l0eTowO319CiNtYlRvcCAubWItc3B7ZmxleDoxO30KLm1iLWljb25idG57CiAgZmxleDpub25lO3dpZHRoOjM4cHg7aGVpZ2h0OjM4cHg7Ym9yZGVyOm5vbmU7Ym9yZGVyLXJhZGl1czoxMXB4O2N1cnNvcjpwb2ludGVyOwogIGRpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcjtmb250LXNpemU6MThweDsKICBiYWNrZ3JvdW5kOnJnYmEoMjU1LDI1NSwyNTUsLjE0KTtjb2xvcjojZmZmO3RyYW5zaXRpb246YmFja2dyb3VuZCAuMTJzOwp9Ci5tYi1pY29uYnRuOmFjdGl2ZXtiYWNrZ3JvdW5kOnJnYmEoMjU1LDI1NSwyNTUsLjI4KTt9Ci5tYi1pY29uYnRuLm9ue2JhY2tncm91bmQ6dmFyKC0tbWItYWNjZW50KTt9Ci5tYi1pY29uYnRuW2Rpc2FibGVkXXtvcGFjaXR5Oi4zNTtwb2ludGVyLWV2ZW50czpub25lO30KI21iVG9wIC5tYi1pY29uYnRue3dpZHRoOjM2cHg7aGVpZ2h0OjM2cHg7Zm9udC1zaXplOjE3cHg7fQoKLyogLS0tLS0tLS0tLSDsoozsuKEg7IS466GcIOuPhOq1rCDroIjsnbwgKOqwgOuhnCDrqqjrk5wg7KCE7JqpKSAtLS0tLS0tLS0tICovCiNtYlJhaWx7CiAgcG9zaXRpb246Zml4ZWQ7bGVmdDoxMHB4O3RvcDo2NHB4O2JvdHRvbTo2NHB4O3dpZHRoOjYwcHg7ei1pbmRleDoxMzgwOwogIGZsZXgtZGlyZWN0aW9uOmNvbHVtbjthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjZweDtwYWRkaW5nOjhweCA2cHg7CiAgYmFja2dyb3VuZDp2YXIoLS1tYi1zdXJmYWNlKTtib3JkZXI6MXB4IHNvbGlkIHZhcigtLW1iLWxpbmUpOwogIGJvcmRlci1yYWRpdXM6MThweDtib3gtc2hhZG93OnZhcigtLW1iLXNoYWRvdyk7b3ZlcmZsb3cteTphdXRvO292ZXJmbG93LXg6aGlkZGVuOwp9CiNtYlJhaWw6Oi13ZWJraXQtc2Nyb2xsYmFye2Rpc3BsYXk6bm9uZTt9Ci5tYi1yYWlsLWJ0bnsKICBmbGV4Om5vbmU7d2lkdGg6NDhweDtoZWlnaHQ6NDhweDtib3JkZXI6bm9uZTtib3JkZXItcmFkaXVzOjEycHg7Y3Vyc29yOnBvaW50ZXI7CiAgZGlzcGxheTpmbGV4O2ZsZXgtZGlyZWN0aW9uOmNvbHVtbjthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcjtnYXA6MnB4OwogIGJhY2tncm91bmQ6I2YzZjZmODtjb2xvcjp2YXIoLS1tYi1pbmspO2ZvbnQtc2l6ZTo5cHg7Zm9udC13ZWlnaHQ6NjAwOwp9Ci5tYi1yYWlsLWJ0biAuaWN7Zm9udC1zaXplOjE5cHg7bGluZS1oZWlnaHQ6MTt9Ci5tYi1yYWlsLWJ0bjphY3RpdmV7YmFja2dyb3VuZDp2YXIoLS1tYi1hY2NlbnQtc29mdCk7fQoubWItcmFpbC1idG4ubW9yZXtiYWNrZ3JvdW5kOnZhcigtLW1iLW5hdnkpO2NvbG9yOiNmZmY7fQovKiDshLjroZwg66qo65Oc7JeQ7ISgIOugiOydvCDsiKjquYAgKi8KYm9keS5tYi1wb3J0cmFpdCAjbWJSYWlse2Rpc3BsYXk6bm9uZTt9CgovKiAtLS0tLS0tLS0tIO2VmOuLqCDsu7Ttj6zrhIztirgg66CI7J28ICjshLjroZwg66qo65OcIOyghOyaqSwgQ2FudmEg7Iqk7YOA7J28KSAtLS0tLS0tLS0tICovCiNtYkRvY2t7CiAgcG9zaXRpb246Zml4ZWQ7bGVmdDowO3JpZ2h0OjA7Ym90dG9tOjA7ei1pbmRleDoxMzgwOwogIGZsZXgtZGlyZWN0aW9uOmNvbHVtbjtwYWRkaW5nOjhweCAwIG1heCgxMHB4LCBlbnYoc2FmZS1hcmVhLWluc2V0LWJvdHRvbSkpOwogIGJhY2tncm91bmQ6bGluZWFyLWdyYWRpZW50KDE4MGRlZywgcmdiYSgyNTUsMjU1LDI1NSwuNzIpLCB2YXIoLS1tYi1zdXJmYWNlKSAzNCUpOwogIGJvcmRlci10b3A6MXB4IHNvbGlkIHZhcigtLW1iLWxpbmUpO2JveC1zaGFkb3c6MCAtNnB4IDI0cHggcmdiYSgyMCwzMyw0OCwuMTApOwp9CiNtYkRvY2tTY3JvbGx7CiAgZGlzcGxheTpmbGV4O2dhcDo4cHg7b3ZlcmZsb3cteDphdXRvO292ZXJmbG93LXk6aGlkZGVuOwogIHBhZGRpbmc6MnB4IDEycHggNHB4O3Njcm9sbC1zbmFwLXR5cGU6eCBwcm94aW1pdHk7Cn0KI21iRG9ja1Njcm9sbDo6LXdlYmtpdC1zY3JvbGxiYXJ7ZGlzcGxheTpub25lO30KLm1iLWNoaXB7CiAgZmxleDpub25lO3Njcm9sbC1zbmFwLWFsaWduOnN0YXJ0OwogIG1pbi13aWR0aDo2NnB4O2hlaWdodDo2MnB4O2JvcmRlcjoxcHggc29saWQgdmFyKC0tbWItbGluZSk7Ym9yZGVyLXJhZGl1czoxNHB4OwogIGJhY2tncm91bmQ6dmFyKC0tbWItc3VyZmFjZSk7Y3Vyc29yOnBvaW50ZXI7CiAgZGlzcGxheTpmbGV4O2ZsZXgtZGlyZWN0aW9uOmNvbHVtbjthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcjtnYXA6NHB4OwogIGZvbnQtc2l6ZToxMXB4O2ZvbnQtd2VpZ2h0OjYwMDtjb2xvcjp2YXIoLS1tYi1pbmspOwp9Ci5tYi1jaGlwIC5pY3tmb250LXNpemU6MjFweDtsaW5lLWhlaWdodDoxO2NvbG9yOnZhcigtLW1iLWFjY2VudC1pbmspO30KLm1iLWNoaXA6YWN0aXZle2JvcmRlci1jb2xvcjp2YXIoLS1tYi1hY2NlbnQpO2JhY2tncm91bmQ6dmFyKC0tbWItYWNjZW50LXNvZnQpO3RyYW5zZm9ybTpzY2FsZSguOTYpO30KLm1iLWNoaXAuYWxse2JhY2tncm91bmQ6dmFyKC0tbWItbmF2eSk7Ym9yZGVyLWNvbG9yOnZhcigtLW1iLW5hdnkpO2NvbG9yOiNmZmY7fQoubWItY2hpcC5hbGwgLmlje2NvbG9yOiNmZmY7fQovKiDqsIDroZwg66qo65Oc7JeQ7ISgIO2VmOuLqCDrj4Ttgawg7Iio6rmAICovCmJvZHkubWItbGFuZHNjYXBlICNtYkRvY2t7ZGlzcGxheTpub25lO30KCi8qIC0tLS0tLS0tLS0g7ISg7YOdIOyLnCDrnKjripQg7ZSM66Gc7YyFIOyVoeyFmOuwlCAoRmlnbWEg7Luo7YWN7Iqk7Yq4IO2ItOuwlCkgLS0tLS0tLS0tLSAqLwojbWJDdHh7CiAgcG9zaXRpb246Zml4ZWQ7ei1pbmRleDoxMzkwO2xlZnQ6NTAlO3RyYW5zZm9ybTp0cmFuc2xhdGVYKC01MCUpOwogIGFsaWduLWl0ZW1zOmNlbnRlcjtnYXA6MnB4O3BhZGRpbmc6NXB4OwogIGJhY2tncm91bmQ6dmFyKC0tbWItbmF2eSk7Ym9yZGVyLXJhZGl1czoxNXB4O2JveC1zaGFkb3c6dmFyKC0tbWItc2hhZG93KTsKfQpib2R5Lm1iLXBvcnRyYWl0ICNtYkN0eHtib3R0b206OTZweDt9Ci8qIOqwgOuhnDog7ZWY64uoIOykkeyVmeyXkCDrnYTsm4wg7IaN7ISxIO2MqOuEkCjsmrDsuKEp6rO8IOqyuey5mOyngCDslYrqsowgKi8KYm9keS5tYi1sYW5kc2NhcGUgI21iQ3R4e3RvcDphdXRvO2JvdHRvbToxNHB4O2xlZnQ6NTAlO3JpZ2h0OmF1dG87dHJhbnNmb3JtOnRyYW5zbGF0ZVgoLTUwJSk7fQovKiDsgqzsnbTrk5wg7Yyo64SQ7J20IOyXtOumrOuptCDsupTrsoTsiqQg7JiB7JetKOyijOy4oSnsnZgg7KSR7JWZ7Jy866GcIOydtOuPmSAqLwpib2R5Lm1iLWxhbmRzY2FwZS5tYi1zaWRlLW9wZW4gI21iQ3R4e2xlZnQ6Y2FsYygoMTAwJSAtIDMwMHB4KS8yKTt9CiNtYkN0eC5oaWRkZW57ZGlzcGxheTpub25lO30KLm1iLWN0eC1idG57CiAgYm9yZGVyOm5vbmU7YmFja2dyb3VuZDp0cmFuc3BhcmVudDtjb2xvcjojZmZmO2N1cnNvcjpwb2ludGVyOwogIG1pbi13aWR0aDo0NHB4O2hlaWdodDo0NHB4O2JvcmRlci1yYWRpdXM6MTFweDsKICBkaXNwbGF5OmZsZXg7ZmxleC1kaXJlY3Rpb246Y29sdW1uO2FsaWduLWl0ZW1zOmNlbnRlcjtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyO2dhcDoxcHg7CiAgZm9udC1zaXplOjEwcHg7Zm9udC13ZWlnaHQ6NjAwOwp9Ci5tYi1jdHgtYnRuIC5pY3tmb250LXNpemU6MTdweDtsaW5lLWhlaWdodDoxO30KLm1iLWN0eC1idG46YWN0aXZle2JhY2tncm91bmQ6cmdiYSgyNTUsMjU1LDI1NSwuMTYpO30KLm1iLWN0eC1idG4uZGFuZ2VyIC5pY3tjb2xvcjojZmY5YTlhO30KLm1iLWN0eC1zZXB7d2lkdGg6MXB4O2hlaWdodDoyNnB4O2JhY2tncm91bmQ6cmdiYSgyNTUsMjU1LDI1NSwuMTYpO21hcmdpbjowIDJweDt9CgovKiAtLS0tLS0tLS0tIOyasOy4oSDsu6jtirjroaQg7Iqk7YOdICjstpTqsIDCt+uvuOumrOuztOq4sMK37KSMwrfrp57stqQpIC0tLS0tLS0tLS0KICAg7ZWY64KY7J2YIOyEuOuhnCDsiqTtg53snLzroZwg66y27Ja0IOqyuey5mOyngCDslYrqsowg67Cw7LmYLiDshLjroZwv6rCA66GcIOqzte2GtS4gKi8KI21iVG9vbHN7CiAgcG9zaXRpb246Zml4ZWQ7ei1pbmRleDoxMzg1O2ZsZXgtZGlyZWN0aW9uOmNvbHVtbjtnYXA6MTBweDthbGlnbi1pdGVtczpjZW50ZXI7CiAgdHJhbnNpdGlvbjpyaWdodCAuMjJzIGVhc2U7Cn0KYm9keS5tYi1wb3J0cmFpdCAjbWJUb29sc3tyaWdodDoxMnB4O2JvdHRvbToxNTBweDt9ICAgLyog64+E7YGsIOychCAqLwpib2R5Lm1iLWxhbmRzY2FwZSAjbWJUb29sc3tyaWdodDoxMnB4O2JvdHRvbToxNHB4O30KLyog6rCA66Gc7JeQ7IScIOyGjeyEsSDtjKjrhJDsnbQg7Je066as66m0IOyasOy4oSDsu6jtirjroaTsnYQg7Yyo64SQIO2PrSgzMDBweCnrp4ztgbwg7Jm87Kq97Jy866GcIOuwgOyWtCDqsrnsuagg67Cp7KeAICovCmJvZHkubWItbGFuZHNjYXBlLm1iLXNpZGUtb3BlbiAjbWJUb29sc3tyaWdodDozMTJweDt9Ci5tYi1mYWJ7CiAgd2lkdGg6NTJweDtoZWlnaHQ6NTJweDtib3JkZXI6bm9uZTtib3JkZXItcmFkaXVzOjE2cHg7Y3Vyc29yOnBvaW50ZXI7CiAgZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyO2ZvbnQtc2l6ZToyNHB4OwogIGJhY2tncm91bmQ6dmFyKC0tbWItYWNjZW50KTtjb2xvcjojZmZmO2JveC1zaGFkb3c6MCA2cHggMTZweCByZ2JhKDMwLDE1OCwxMDYsLjQyKTsKfQoubWItZmFiOmFjdGl2ZXt0cmFuc2Zvcm06c2NhbGUoLjk0KTt9Ci5tYi1mYWIubWluaXt3aWR0aDo0NHB4O2hlaWdodDo0NHB4O2ZvbnQtc2l6ZToxOHB4O2JhY2tncm91bmQ6dmFyKC0tbWItc3VyZmFjZSk7Y29sb3I6dmFyKC0tbWItaW5rKTtib3gtc2hhZG93OnZhcigtLW1iLXNoYWRvdy1zbSk7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1tYi1saW5lKTt9Ci5tYi1mYWIubWluaTphY3RpdmV7YmFja2dyb3VuZDojZjFmNGY2O30KLyog7IaQIOuPhOq1rChQYW4pIO2ZnOyEsSDsg4Htg5wgKi8KI21iUGFuQnRuLm1iLW9ue2JhY2tncm91bmQ6dmFyKC0tbWItYWNjZW50KTtjb2xvcjojZmZmO2JvcmRlci1jb2xvcjp2YXIoLS1tYi1hY2NlbnQpO2JveC1zaGFkb3c6MCA0cHggMTJweCByZ2JhKDMwLDE1OCwxMDYsLjQ1KTt9CmJvZHkubWItcGFuIC5jYW52YXMtc2Nyb2xse2N1cnNvcjpncmFiO30KYm9keS5tYi1wYW4ubWItcGFubmluZyAuY2FudmFzLXNjcm9sbHtjdXJzb3I6Z3JhYmJpbmc7fQovKiDsnbTrj5kg66qo65OcOiDrj4Tqtazsg4HsnpAo7KKM7LihIOugiOydvCDCtyDtlZjri6gg64+FKSDsiKjquYAg4oaSIOy6lOuyhOyKpOyXkCDsp5HspJEuCiAgICjsupTrsoTsiqQg7JyE7LmYL+ykjOydgCDqt7jrjIDroZwg7Jyg7KeA7ZWY6riwIOychO2VtCBsZWZ0IOyYpO2UhOyFi+ydgCDqsbTrk5zrpqzsp4Ag7JWK7J2MKSAqLwpib2R5Lm1iLXBhbiAjbWJSYWlsLApib2R5Lm1iLXBhbiAjbWJEb2Nre2Rpc3BsYXk6bm9uZSFpbXBvcnRhbnQ7fQovKiDshpAg64+E6rWsIOy8nOynkCDslYjrgrQg67Cw64SIICovCiNtYlBhbkhpbnR7CiAgcG9zaXRpb246Zml4ZWQ7bGVmdDo1MCU7dHJhbnNmb3JtOnRyYW5zbGF0ZVgoLTUwJSk7ei1pbmRleDoxMzk2OwogIGRpc3BsYXk6bm9uZTthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjdweDsKICBiYWNrZ3JvdW5kOnJnYmEoMzQsNDgsNjMsLjk0KTtjb2xvcjojZmZmO3BhZGRpbmc6OHB4IDE0cHg7Ym9yZGVyLXJhZGl1czoyMHB4OwogIGZvbnQtc2l6ZToxMi41cHg7Zm9udC13ZWlnaHQ6NjAwO2JveC1zaGFkb3c6MCA2cHggMThweCByZ2JhKDAsMCwwLC4yOCk7d2hpdGUtc3BhY2U6bm93cmFwOwogIHBvaW50ZXItZXZlbnRzOm5vbmU7Cn0KLyog7J2064+ZIOuqqOuTnCDslYjrgrQ6IO2VmOuLqOyXkCDtkZzsi5wuIOydtOuPmSDrqqjrk5zsl5DshJzripQg7Luo7YWN7Iqk7Yq4IOuwlOqwgCDsiKjqsqjsp4Drr4DroZwg6rK57LmY7KeAIOyViuydjCAqLwpib2R5Lm1iLXBvcnRyYWl0ICNtYlBhbkhpbnR7Ym90dG9tOjE1MHB4O3RvcDphdXRvO30KYm9keS5tYi1sYW5kc2NhcGUgI21iUGFuSGludHtib3R0b206MTRweDt0b3A6YXV0bzt9CmJvZHkubWItcGFuICNtYlBhbkhpbnR7ZGlzcGxheTpmbGV4O30KYm9keS5tYi1wcmV2aWV3ICNtYlBhbkhpbnR7ZGlzcGxheTpub25lIWltcG9ydGFudDt9Ci5tYi16b29tLWJhZGdlewogIG1pbi13aWR0aDo0NnB4O2hlaWdodDozMnB4O2JvcmRlci1yYWRpdXM6MTBweDtib3JkZXI6MXB4IHNvbGlkIHZhcigtLW1iLWxpbmUpOwogIGJhY2tncm91bmQ6dmFyKC0tbWItc3VyZmFjZSk7Y29sb3I6dmFyKC0tbWItaW5rKTtmb250LXNpemU6MTJweDtmb250LXdlaWdodDo3MDA7CiAgZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyO2N1cnNvcjpwb2ludGVyO2JveC1zaGFkb3c6dmFyKC0tbWItc2hhZG93LXNtKTsKfQovKiDtgbAgKyDstpTqsIAg67KE7Yq87J2AIOyKpO2DnSgjbWJUb29scykg66eoIOychOyXkCDsnITsuZggKi8KI21iQWRkRmFie2ZsZXg6bm9uZTt9CgovKiAtLS0tLS0tLS0tIOuwsOy5mCDrjIDquLAg7JWI64K0KO2Dre2VtOyEnCDrhpPquLApIC0tLS0tLS0tLS0gKi8KI21iQXJtewogIHBvc2l0aW9uOmZpeGVkO2xlZnQ6MTJweDtyaWdodDoxMnB4O3otaW5kZXg6MTM5NTthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjEwcHg7CiAgYmFja2dyb3VuZDp2YXIoLS1tYi1hY2NlbnQpO2NvbG9yOiNmZmY7cGFkZGluZzoxMXB4IDE0cHg7Ym9yZGVyLXJhZGl1czoxNHB4OwogIGJveC1zaGFkb3c6MCA4cHggMjJweCByZ2JhKDMwLDE1OCwxMDYsLjQpO2ZvbnQtc2l6ZToxMy41cHg7Zm9udC13ZWlnaHQ6NzAwOwp9CmJvZHkubWItcG9ydHJhaXQgI21iQXJte3RvcDo2MHB4O30KYm9keS5tYi1sYW5kc2NhcGUgI21iQXJte3RvcDo2MHB4O2xlZnQ6ODBweDtyaWdodDoxMnB4O30KI21iQXJtICNtYkFybVR4dHtmbGV4OjE7bGluZS1oZWlnaHQ6MS4zNTt9CiNtYkFybSBidXR0b257ZmxleDpub25lO2JhY2tncm91bmQ6cmdiYSgyNTUsMjU1LDI1NSwuMjIpO2NvbG9yOiNmZmY7Ym9yZGVyOm5vbmU7Ym9yZGVyLXJhZGl1czo5cHg7cGFkZGluZzo4cHggMTJweDtmb250LXNpemU6MTIuNXB4O2ZvbnQtd2VpZ2h0OjcwMDtjdXJzb3I6cG9pbnRlcjt9CmJvZHkubWItYXJtaW5nICNjYW52YXN7Y3Vyc29yOmNyb3NzaGFpcjt9CgovKiBQQyDrqqjri6wo67O16rWsL+2FnO2UjOumvy/rgrTrs7TrgrTquLAv6rCA7J2065OcIOuTsSnsnbQg66qo67CU7J28IO2BrOuhrCDsnITsl5Ag7Jik64+E66GdICovCmJvZHkubWItbW9iaWxlIC5tb2RhbC1iZywgYm9keS5tYi10YWJsZXQgLm1vZGFsLWJneyB6LWluZGV4OjIyMDAhaW1wb3J0YW50OyB9CgovKiDsnbjslbEgY29uZmlybSDri6TsnbTslrzroZzqt7ggKHdpbmRvdy5jb25maXJtIOustOyLnO2VmOuKlCDsnbjslbEg67iM65287Jqw7KCAIOuMgOydkSkgKi8KI21iQ29uZmlybUJne2Rpc3BsYXk6bm9uZTtwb3NpdGlvbjpmaXhlZDtpbnNldDowO3otaW5kZXg6MjMwMDtiYWNrZ3JvdW5kOnJnYmEoMTYsMjQsMzMsLjUpO2FsaWduLWl0ZW1zOmNlbnRlcjtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyO3BhZGRpbmc6MjhweDt9CiNtYkNvbmZpcm1CZy5zaG93e2Rpc3BsYXk6ZmxleDt9CiNtYkNvbmZpcm1DYXJke2JhY2tncm91bmQ6dmFyKC0tbWItc3VyZmFjZSk7Ym9yZGVyLXJhZGl1czoxOHB4O3BhZGRpbmc6MjJweCAyMHB4O21heC13aWR0aDozNDBweDt3aWR0aDoxMDAlO2JveC1zaGFkb3c6dmFyKC0tbWItc2hhZG93KTt9CiNtYkNvbmZpcm1DYXJkIGgze2ZvbnQtc2l6ZToxN3B4O2ZvbnQtd2VpZ2h0OjgwMDtjb2xvcjp2YXIoLS1tYi1pbmspO21hcmdpbi1ib3R0b206OHB4O30KI21iQ29uZmlybUNhcmQgcHtmb250LXNpemU6MTRweDtjb2xvcjp2YXIoLS1tYi1pbmstc29mdCk7bGluZS1oZWlnaHQ6MS42O21hcmdpbi1ib3R0b206MThweDt9CiNtYkNvbmZpcm1DYXJkIC5tYmMtYnRuc3tkaXNwbGF5OmZsZXg7Z2FwOjEwcHg7fQojbWJDb25maXJtQ2FyZCAubWJjLWJ0bnMgYnV0dG9ue2ZsZXg6MTtwYWRkaW5nOjEzcHg7Ym9yZGVyLXJhZGl1czoxMnB4O2ZvbnQtc2l6ZToxNXB4O2ZvbnQtd2VpZ2h0OjcwMDtjdXJzb3I6cG9pbnRlcjtib3JkZXI6bm9uZTt9CiNtYkNvbmZpcm1DYXJkIC5tYmMtY2FuY2Vse2JhY2tncm91bmQ6I2YxZjRmNjtjb2xvcjp2YXIoLS1tYi1pbmspO30KI21iQ29uZmlybUNhcmQgLm1iYy1va3tiYWNrZ3JvdW5kOnZhcigtLW1iLWRhbmdlcik7Y29sb3I6I2ZmZjt9Ci8qIOuqqOuLrOydtCDsl7TroKQg7J6I7Jy866m0KD1kaXNwbGF5OmZsZXgpIOuwlO2FgOyLnO2KuC/rj4TtgazqsIAg67Cp7ZW07ZWY7KeAIOyViuuPhOuhnSDsgrTsp50g64Ku7Lak7J2AIOu2iO2VhOyalDoKICAgbW9kYWwgei1pbmRleCAyMjAwID4gc2hlZXQgMTUwMCDsnbTrr4DroZwg7J6Q64+Z7Jy866GcIOychOyXkCDtkZzsi5zrkKggKi8KI21iU2hlZXRCZ3tkaXNwbGF5Om5vbmU7cG9zaXRpb246Zml4ZWQ7aW5zZXQ6MDt6LWluZGV4OjE1MDA7YmFja2dyb3VuZDpyZ2JhKDE2LDI0LDMzLC40NCk7YWxpZ24taXRlbXM6ZmxleC1lbmQ7fQojbWJTaGVldEJnLnNob3d7ZGlzcGxheTpmbGV4O30KI21iU2hlZXR7CiAgd2lkdGg6MTAwJTttYXgtaGVpZ2h0Ojgydmg7YmFja2dyb3VuZDp2YXIoLS1tYi1zdXJmYWNlKTtib3JkZXItcmFkaXVzOjIycHggMjJweCAwIDA7CiAgZGlzcGxheTpmbGV4O2ZsZXgtZGlyZWN0aW9uOmNvbHVtbjtib3gtc2hhZG93OjAgLTEwcHggMzRweCByZ2JhKDAsMCwwLC4yNik7CiAgdHJhbnNmb3JtOnRyYW5zbGF0ZVkoMTAwJSk7dHJhbnNpdGlvbjp0cmFuc2Zvcm0gLjI0cyBjdWJpYy1iZXppZXIoLjIyLDEsLjM2LDEpOwp9CiNtYlNoZWV0Qmcuc2hvdyAjbWJTaGVldHt0cmFuc2Zvcm06dHJhbnNsYXRlWSgwKTt9Ci5tYi1ncmFie3dpZHRoOjQycHg7aGVpZ2h0OjVweDtib3JkZXItcmFkaXVzOjNweDtiYWNrZ3JvdW5kOiNkM2RhZTA7bWFyZ2luOjlweCBhdXRvIDJweDtmbGV4Om5vbmU7fQoubWItc2hlZXQtaGVhZHtkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2p1c3RpZnktY29udGVudDpzcGFjZS1iZXR3ZWVuO3BhZGRpbmc6NnB4IDE4cHggMTBweDtib3JkZXItYm90dG9tOjFweCBzb2xpZCB2YXIoLS1tYi1saW5lKTtmbGV4Om5vbmU7fQoubWItc2hlZXQtaGVhZCBoM3tmb250LXNpemU6MTZweDtmb250LXdlaWdodDo4MDA7Y29sb3I6dmFyKC0tbWItaW5rKTt9Ci5tYi1zaGVldC14e2JvcmRlcjpub25lO2JhY2tncm91bmQ6I2YxZjRmNjtib3JkZXItcmFkaXVzOjUwJTt3aWR0aDozMnB4O2hlaWdodDozMnB4O2ZvbnQtc2l6ZToxNnB4O2NvbG9yOiM1YTY1NzA7Y3Vyc29yOnBvaW50ZXI7fQoubWItc2hlZXQtYm9keXtwYWRkaW5nOjE0cHggMTZweCAyNnB4O292ZXJmbG93LXk6YXV0bzstd2Via2l0LW92ZXJmbG93LXNjcm9sbGluZzp0b3VjaDt9CgovKiDsoITssrQg7Lu07Y+s64SM7Yq4IOq3uOumrOuTnCAqLwoubWItY2F0e21hcmdpbi1ib3R0b206MTZweDt9Ci5tYi1jYXQgaDR7Zm9udC1zaXplOjEycHg7Y29sb3I6dmFyKC0tbWItaW5rLXNvZnQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNnB4O21hcmdpbjowIDAgMTBweCAycHg7Zm9udC13ZWlnaHQ6NzAwO30KLm1iLWNvbXAtZ3JpZHtkaXNwbGF5OmdyaWQ7Z3JpZC10ZW1wbGF0ZS1jb2x1bW5zOnJlcGVhdChhdXRvLWZpbGwsbWlubWF4KDg0cHgsMWZyKSk7Z2FwOjEwcHg7fQoubWItY29tcHsKICBib3JkZXI6MXB4IHNvbGlkIHZhcigtLW1iLWxpbmUpO2JvcmRlci1yYWRpdXM6MTRweDtiYWNrZ3JvdW5kOiNmYWZiZmM7CiAgcGFkZGluZzoxNHB4IDZweDt0ZXh0LWFsaWduOmNlbnRlcjtjdXJzb3I6cG9pbnRlcjtmb250LXNpemU6MTJweDtmb250LXdlaWdodDo2MDA7Y29sb3I6dmFyKC0tbWItaW5rKTsKICBkaXNwbGF5OmZsZXg7ZmxleC1kaXJlY3Rpb246Y29sdW1uO2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6N3B4Owp9Ci5tYi1jb21wOmFjdGl2ZXtib3JkZXItY29sb3I6dmFyKC0tbWItYWNjZW50KTtiYWNrZ3JvdW5kOnZhcigtLW1iLWFjY2VudC1zb2Z0KTt9Ci5tYi1jb21wIC5pY3tmb250LXNpemU6MjNweDtjb2xvcjp2YXIoLS1tYi1hY2NlbnQtaW5rKTtsaW5lLWhlaWdodDoxO30KCi8qIOyGjeyEsSDtmLjsiqTtirggKi8KI21iUHJvcEhvc3R7bWluLWhlaWdodDo0MHB4O30KI21iUHJvcEhvc3QgLmVtcHR5LXByb3Bze2NvbG9yOiM5NGEyYWU7dGV4dC1hbGlnbjpjZW50ZXI7cGFkZGluZzoyNnB4IDA7bGluZS1oZWlnaHQ6MS43O30KI21iUHJvcEhvc3QgLnByb3csI21iUHJvcEhvc3QgLnByb3B7bWFyZ2luLWJvdHRvbToxMnB4O30KI21iUHJvcEhvc3QgaW5wdXQsI21iUHJvcEhvc3Qgc2VsZWN0LCNtYlByb3BIb3N0IHRleHRhcmVhe2ZvbnQtc2l6ZToxNXB4O30KCi8qIO2BsCDslaHshZgg67KE7Yq8KOuplOuJtC/si6Ttlokg7Iuc7Yq4KSAqLwoubWItYmlnLWJ0bnsKICBkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDoxM3B4O3dpZHRoOjEwMCU7CiAgcGFkZGluZzoxNXB4IDE2cHg7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1tYi1saW5lKTtib3JkZXItcmFkaXVzOjEzcHg7YmFja2dyb3VuZDp2YXIoLS1tYi1zdXJmYWNlKTsKICBmb250LXNpemU6MTVweDtmb250LXdlaWdodDo3MDA7Y29sb3I6dmFyKC0tbWItaW5rKTtjdXJzb3I6cG9pbnRlcjttYXJnaW4tYm90dG9tOjEwcHg7dGV4dC1hbGlnbjpsZWZ0Owp9Ci5tYi1iaWctYnRuOmFjdGl2ZXtiYWNrZ3JvdW5kOiNmM2Y2Zjg7fQoubWItYmlnLWJ0biAuaWN7Zm9udC1zaXplOjIxcHg7ZmxleDpub25lO30KLm1iLWJpZy1idG4ucHJpbWFyeXtiYWNrZ3JvdW5kOnZhcigtLW1iLWFjY2VudCk7Ym9yZGVyLWNvbG9yOnZhcigtLW1iLWFjY2VudCk7Y29sb3I6I2ZmZjt9Ci8qIO2ZlOuptCDrqqjrk5wg7KCE7ZmYICjrqZTribQg7Iuc7Yq4IOyViCk6IDPqsJwg7IS46re466i87Yq4IO2VnCDtlokgKi8KLm1iLW1vZGUtc2Vne2Rpc3BsYXk6ZmxleDtnYXA6OHB4O21hcmdpbi1ib3R0b206MTBweDt9Ci5tYi1tb2RlLXNlZyAuc2Vne2ZsZXg6MTtkaXNwbGF5OmZsZXg7ZmxleC1kaXJlY3Rpb246Y29sdW1uO2FsaWduLWl0ZW1zOmNlbnRlcjtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyO2dhcDo1cHg7CiAgcGFkZGluZzoxMnB4IDRweDtib3JkZXI6MXB4IHNvbGlkIHZhcigtLW1iLWxpbmUpO2JvcmRlci1yYWRpdXM6MTNweDtiYWNrZ3JvdW5kOnZhcigtLW1iLXN1cmZhY2UpOwogIGZvbnQtc2l6ZToxMnB4O2ZvbnQtd2VpZ2h0OjcwMDtjb2xvcjp2YXIoLS1tYi1pbmspO2N1cnNvcjpwb2ludGVyO30KLm1iLW1vZGUtc2VnIC5zZWcgc3Zne3dpZHRoOjI0cHg7aGVpZ2h0OjI0cHg7ZGlzcGxheTpibG9jazt9Ci5tYi1tb2RlLXNlZyAuc2VnOmFjdGl2ZXtiYWNrZ3JvdW5kOiNmM2Y2Zjg7fQoubWItbW9kZS1zZWcgLnNlZy5vbntiYWNrZ3JvdW5kOnZhcigtLW1iLWFjY2VudCk7Ym9yZGVyLWNvbG9yOnZhcigtLW1iLWFjY2VudCk7Y29sb3I6I2ZmZjt9Ci5tYi1zaGVldC1sYWJlbHtmb250LXNpemU6MTJweDtmb250LXdlaWdodDo3MDA7Y29sb3I6dmFyKC0tbWItaW5rLXNvZnQsIzhhOTQ5Yyk7bWFyZ2luOjJweCAycHggOHB4O30KLm1iLW1lbnUtdmVye21hcmdpbi10b3A6MTRweDtwYWRkaW5nLXRvcDoxMnB4O2JvcmRlci10b3A6MXB4IHNvbGlkIHZhcigtLW1iLWxpbmUpO3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtc2l6ZToxMnB4O2NvbG9yOiNhYWIyYmE7dXNlci1zZWxlY3Q6bm9uZTt9CgovKiDroIjsnbTslrQg7Yq466asICovCi5tYi1sYXllcntkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDo5cHg7cGFkZGluZzoxMXB4IDEwcHg7Ym9yZGVyLXJhZGl1czoxMHB4O2JvcmRlcjoxcHggc29saWQgdHJhbnNwYXJlbnQ7Y3Vyc29yOnBvaW50ZXI7Zm9udC1zaXplOjEzLjVweDtjb2xvcjp2YXIoLS1tYi1pbmspO30KLm1iLWxheWVyOmFjdGl2ZXtiYWNrZ3JvdW5kOiNmM2Y2Zjg7fQoubWItbGF5ZXIub257YmFja2dyb3VuZDp2YXIoLS1tYi1hY2NlbnQtc29mdCk7Ym9yZGVyLWNvbG9yOnZhcigtLW1iLWFjY2VudCk7Y29sb3I6dmFyKC0tbWItYWNjZW50LWluayk7Zm9udC13ZWlnaHQ6NzAwO30KLm1iLWxheWVyIC5sdHtmb250LXNpemU6MTZweDtmbGV4Om5vbmU7Y29sb3I6dmFyKC0tbWItYWNjZW50LWluayk7fQoubWItbGF5ZXIgLmx4e21hcmdpbi1sZWZ0OmF1dG87Y29sb3I6dmFyKC0tbWItZGFuZ2VyKTtmb250LXNpemU6MTVweDtwYWRkaW5nOjJweCA4cHg7fQoubWItbGF5ZXItZW1wdHl7Y29sb3I6Izk0YTJhZTt0ZXh0LWFsaWduOmNlbnRlcjtwYWRkaW5nOjI2cHggMDt9CgovKiDrs7TquLDshKTsoJUo4pqZKSDsi5ztirgg7ZWt66qpICovCi5tYi1vcHQtcm93e2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OnNwYWNlLWJldHdlZW47cGFkZGluZzoxMnB4IDJweDtib3JkZXItYm90dG9tOjFweCBzb2xpZCB2YXIoLS1tYi1saW5lKTt9Ci5tYi1vcHQtcm93Omxhc3QtY2hpbGR7Ym9yZGVyLWJvdHRvbTpub25lO30KLm1iLW9wdC1yb3cgLmxibHtmb250LXNpemU6MTRweDtmb250LXdlaWdodDo2MDA7Y29sb3I6dmFyKC0tbWItaW5rKTt9Ci5tYi1vcHQtcm93IC5jdGx7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6OHB4O30KLm1iLXN0ZXBwZXJ7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6NnB4O30KLm1iLXN0ZXBwZXIgYnV0dG9ue3dpZHRoOjM2cHg7aGVpZ2h0OjM2cHg7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1tYi1saW5lKTtib3JkZXItcmFkaXVzOjlweDtiYWNrZ3JvdW5kOiNmNGY2Zjg7Zm9udC1zaXplOjE4cHg7Zm9udC13ZWlnaHQ6NzAwO2NvbG9yOnZhcigtLW1iLWluayk7Y3Vyc29yOnBvaW50ZXI7fQoubWItc3RlcHBlciBidXR0b246YWN0aXZle2JhY2tncm91bmQ6dmFyKC0tbWItYWNjZW50LXNvZnQpO30KLm1iLXN0ZXBwZXIgaW5wdXR7d2lkdGg6NjZweDtoZWlnaHQ6MzZweDtib3JkZXI6MXB4IHNvbGlkIHZhcigtLW1iLWxpbmUpO2JvcmRlci1yYWRpdXM6OXB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtc2l6ZToxNXB4O2ZvbnQtd2VpZ2h0OjYwMDt9Ci8qIO2GoOq4gCDsiqTsnITsuZggKi8KLm1iLXN3aXRjaHtwb3NpdGlvbjpyZWxhdGl2ZTt3aWR0aDo0OHB4O2hlaWdodDoyOHB4O2ZsZXg6bm9uZTt9Ci5tYi1zd2l0Y2ggaW5wdXR7b3BhY2l0eTowO3dpZHRoOjA7aGVpZ2h0OjA7cG9zaXRpb246YWJzb2x1dGU7fQoubWItc3dpdGNoIC50cmFja3twb3NpdGlvbjphYnNvbHV0ZTtpbnNldDowO2JhY2tncm91bmQ6I2NmZDZkYztib3JkZXItcmFkaXVzOjIwcHg7dHJhbnNpdGlvbjouMTZzO30KLm1iLXN3aXRjaCAudHJhY2s6OmFmdGVye2NvbnRlbnQ6IiI7cG9zaXRpb246YWJzb2x1dGU7bGVmdDozcHg7dG9wOjNweDt3aWR0aDoyMnB4O2hlaWdodDoyMnB4O2JhY2tncm91bmQ6I2ZmZjtib3JkZXItcmFkaXVzOjUwJTt0cmFuc2l0aW9uOi4xNnM7Ym94LXNoYWRvdzowIDFweCAzcHggcmdiYSgwLDAsMCwuMjUpO30KLm1iLXN3aXRjaCBpbnB1dDpjaGVja2VkICsgLnRyYWNre2JhY2tncm91bmQ6dmFyKC0tbWItYWNjZW50KTt9Ci5tYi1zd2l0Y2ggaW5wdXQ6Y2hlY2tlZCArIC50cmFjazo6YWZ0ZXJ7dHJhbnNmb3JtOnRyYW5zbGF0ZVgoMjBweCk7fQoKLyogLS0tLS0tLS0tLSDsmrDsuKEg7IaN7ISxIO2MqOuEkCAo6rCA66GcIOuqqOuTnCDsoITsmqkpIC0tLS0tLS0tLS0gKi8KI21iU2lkZVBhbmVsewogIHBvc2l0aW9uOmZpeGVkO3JpZ2h0OjA7dG9wOjUycHg7Ym90dG9tOjA7d2lkdGg6MzAwcHg7ei1pbmRleDoxMzcwOwogIGZsZXgtZGlyZWN0aW9uOmNvbHVtbjtiYWNrZ3JvdW5kOnZhcigtLW1iLXN1cmZhY2UpO2JvcmRlci1sZWZ0OjFweCBzb2xpZCB2YXIoLS1tYi1saW5lKTsKICBib3gtc2hhZG93Oi02cHggMCAyMHB4IHJnYmEoMjAsMzMsNDgsLjA4KTt0cmFuc2Zvcm06dHJhbnNsYXRlWCgxMDAlKTt0cmFuc2l0aW9uOnRyYW5zZm9ybSAuMjJzIGVhc2U7Cn0KI21iU2lkZVBhbmVsLm9wZW57dHJhbnNmb3JtOnRyYW5zbGF0ZVgoMCk7fQoubWItc2lkZS1oZWFke2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OnNwYWNlLWJldHdlZW47cGFkZGluZzoxMnB4IDE2cHg7Ym9yZGVyLWJvdHRvbToxcHggc29saWQgdmFyKC0tbWItbGluZSk7ZmxleDpub25lO30KLm1iLXNpZGUtaGVhZCBoM3tmb250LXNpemU6MTVweDtmb250LXdlaWdodDo4MDA7Y29sb3I6dmFyKC0tbWItaW5rKTt9Ci5tYi1zaWRlLWJvZHl7cGFkZGluZzoxNHB4IDE2cHggMjRweDtvdmVyZmxvdy15OmF1dG87ZmxleDoxOy13ZWJraXQtb3ZlcmZsb3ctc2Nyb2xsaW5nOnRvdWNoO30KYm9keS5tYi1wb3J0cmFpdCAjbWJTaWRlUGFuZWx7ZGlzcGxheTpub25lO30KLyog6rCA66Gc7JeQ7IScIO2MqOuEkCDsl7TrpqzrqbQg7LqU67KE7IqkIOyasOy4oSDsl6zrsLEg7ZmV67O0ICovCmJvZHkubWItbGFuZHNjYXBlLm1iLXNpZGUtb3BlbiAuY2FudmFzLXNjcm9sbHtyaWdodDozMDBweDt9Ci8qIOqwgOuhnDog7KKM7LihIOugiOydvOydtCDsupTrsoTsiqTrpbwg67CA7Ja064K064+E66GdKOqyuey5qCDrsKnsp4ApIOy6lOuyhOyKpCDsi5zsnpHsoJDsnYQg66CI7J28IO2PreunjO2BvCDtmZXrs7QuCiAgIFBDIOuPhCDtj63snbQg64ST7Jy866m0IG1iLWxhbmRzY2FwZSDqsIAg67aZ7Jy866+A66GcIOuwmOuTnOyLnCBtYi1tb2JpbGUvbWItdGFibGV0IOuhnCDtlZzsoJXtlZzri6QuICovCmJvZHkubWItbW9iaWxlLm1iLWxhbmRzY2FwZSAuY2FudmFzLXNjcm9sbCwKYm9keS5tYi10YWJsZXQubWItbGFuZHNjYXBlIC5jYW52YXMtc2Nyb2xse2xlZnQ6ODJweDt9CmJvZHkubWItbW9iaWxlLm1iLWxhbmRzY2FwZS5tYi1wcmV2aWV3IC5jYW52YXMtc2Nyb2xsLApib2R5Lm1iLXRhYmxldC5tYi1sYW5kc2NhcGUubWItcHJldmlldyAuY2FudmFzLXNjcm9sbHtsZWZ0OjA7fQoKLyogLS0tLS0tLS0tLSDrr7jri4jrp7UgLS0tLS0tLS0tLSAqLwojbWJNaW5pTWFwewogIHBvc2l0aW9uOmZpeGVkO3otaW5kZXg6MTM4NDtiYWNrZ3JvdW5kOnJnYmEoMjU1LDI1NSwyNTUsLjk3KTtib3JkZXI6MXB4IHNvbGlkIHZhcigtLW1iLWxpbmUpOwogIGJvcmRlci1yYWRpdXM6MTBweDtib3gtc2hhZG93OnZhcigtLW1iLXNoYWRvdyk7b3ZlcmZsb3c6aGlkZGVuO3BhZGRpbmc6MDsKICAtd2Via2l0LXVzZXItc2VsZWN0Om5vbmU7dXNlci1zZWxlY3Q6bm9uZTt0b3VjaC1hY3Rpb246bm9uZTsKfQpib2R5Lm1iLXBvcnRyYWl0ICNtYk1pbmlNYXB7bGVmdDoxMnB4O2JvdHRvbToxNzBweDt0b3A6YXV0bztyaWdodDphdXRvO30gICAvKiDshLjroZw6IOyijO2VmOuLqCjrj4Ttgawg7JyEKSAqLwpib2R5Lm1iLWxhbmRzY2FwZSAjbWJNaW5pTWFwe3JpZ2h0Ojc2cHg7dG9wOjYycHg7bGVmdDphdXRvO2JvdHRvbTphdXRvO30gICAvKiDqsIDroZw6IOyasOyDgeuLqCjsmrDsuKEg7Luo7Yq466GkIOyZvOyqvSkgKi8KLyog6rCA66Gc7JeQ7IScIOyGjeyEsSDtjKjrhJDsnbQg7Je066as66m0IOuvuOuLiOunteuPhCDtjKjrhJAg7Y+t66eM7YG8IOyZvOyqveycvOuhnCAo7IKs7Jqp7J6Q6rCAIOyngeygkSDsmK7quLQg6rK97Jqw64qUIOygnOyZuCkgKi8KYm9keS5tYi1sYW5kc2NhcGUubWItc2lkZS1vcGVuICNtYk1pbmlNYXA6bm90KC5tYi1tb3ZlZCl7cmlnaHQ6MzEycHg7fQovKiBQQyDrqqjrk5wo66qo67CU7J28L+2DnOu4lOumvyDtgbTrnpjsiqTqsIAg7JeG7J2EIOuVjCk6IOy6lOuyhOyKpCDsmrDsg4Hri6go7IaN7ISxIO2MqOuEkCDsmbzsqr0p7JeQIO2RnOyLnC4KICAg6riw67O47J2AIOyIqOq5gOydtOqzoCBib2R5Lm1iLXBjLW1pbmkg6rCAIOyeiOydhCDrlYzrp4wg67O07J2464ukLiAqLwpib2R5Om5vdCgubWItbW9iaWxlKTpub3QoLm1iLXRhYmxldCkgI21iTWluaU1hcHtkaXNwbGF5Om5vbmU7cmlnaHQ6MjUycHg7dG9wOjExMnB4O2xlZnQ6YXV0bztib3R0b206YXV0bzt9CmJvZHk6bm90KC5tYi1tb2JpbGUpOm5vdCgubWItdGFibGV0KS5tYi1wYy1taW5pICNtYk1pbmlNYXB7ZGlzcGxheTpibG9jazt9CmJvZHk6bm90KC5tYi1tb2JpbGUpOm5vdCgubWItdGFibGV0KS5tYi1wYy1taW5pICNtYk1pbmlNYXAubWItbW92ZWR7ZGlzcGxheTpibG9jazt9Ci8qIOyCrOyaqeyekOqwgCDrk5zrnpjqt7jroZwg7Jiu6riw66m0IOyduOudvOyduCDsiqTtg4DsnbzsnbQg7Jqw7ISgICovCiNtYk1pbmlNYXAubWItbW92ZWR7bGVmdDphdXRvO3JpZ2h0OmF1dG87dG9wOmF1dG87Ym90dG9tOmF1dG87fQojbWJNaW5pQ2FudmFze2Rpc3BsYXk6YmxvY2s7fQojbWJNaW5pVmlld3twb3NpdGlvbjphYnNvbHV0ZTtib3JkZXI6MnB4IHNvbGlkIHZhcigtLW1iLWRhbmdlcik7YmFja2dyb3VuZDpyZ2JhKDIxNCw2OSw2OSwuMTIpO2JvcmRlci1yYWRpdXM6MnB4O3BvaW50ZXItZXZlbnRzOm5vbmU7fQojbWJNaW5pVG9nZ2xle3Bvc2l0aW9uOmFic29sdXRlO3JpZ2h0OjJweDt0b3A6MnB4O3dpZHRoOjIwcHg7aGVpZ2h0OjIwcHg7Ym9yZGVyOm5vbmU7YmFja2dyb3VuZDpyZ2JhKDM0LDQ4LDYzLC43Mik7Y29sb3I6I2ZmZjtib3JkZXItcmFkaXVzOjVweDtmb250LXNpemU6MTFweDtjdXJzb3I6cG9pbnRlcjtsaW5lLWhlaWdodDoxO3BhZGRpbmc6MDt6LWluZGV4OjI7fQojbWJNaW5pTW92ZXtwb3NpdGlvbjphYnNvbHV0ZTtsZWZ0OjJweDt0b3A6MnB4O3dpZHRoOjIycHg7aGVpZ2h0OjIwcHg7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyO2JhY2tncm91bmQ6cmdiYSgzNCw0OCw2MywuNzIpO2NvbG9yOiNmZmY7Ym9yZGVyLXJhZGl1czo1cHg7Zm9udC1zaXplOjEzcHg7Y3Vyc29yOm1vdmU7bGluZS1oZWlnaHQ6MTt6LWluZGV4OjI7bGV0dGVyLXNwYWNpbmc6LTFweDt9CiNtYk1pbmlNYXAubWluaS1jb2xsYXBzZWQgI21iTWluaU1vdmV7ZGlzcGxheTpub25lO30KI21iTWluaU1hcC5taW5pLWNvbGxhcHNlZHt3aWR0aDozNnB4IWltcG9ydGFudDtoZWlnaHQ6MzZweCFpbXBvcnRhbnQ7YmFja2dyb3VuZDpyZ2JhKDM0LDQ4LDYzLC44NSk7fQojbWJNaW5pTWFwLm1pbmktY29sbGFwc2VkICNtYk1pbmlDYW52YXMsI21iTWluaU1hcC5taW5pLWNvbGxhcHNlZCAjbWJNaW5pVmlld3tkaXNwbGF5Om5vbmU7fQojbWJNaW5pTWFwLm1pbmktY29sbGFwc2VkICNtYk1pbmlUb2dnbGV7cmlnaHQ6N3B4O3RvcDo3cHg7YmFja2dyb3VuZDp0cmFuc3BhcmVudDtmb250LXNpemU6MTRweDt9CgovKiAtLS0tLS0tLS0tIFByZXZpZXcgLS0tLS0tLS0tLSAqLwpib2R5Lm1iLXByZXZpZXcgI21iVG9wLGJvZHkubWItcHJldmlldyAjbWJEb2NrLGJvZHkubWItcHJldmlldyAjbWJSYWlsLGJvZHkubWItcHJldmlldyAjbWJDdHgsCmJvZHkubWItcHJldmlldyAjbWJUb29scyxib2R5Lm1iLXByZXZpZXcgI21iQWRkRmFiLGJvZHkubWItcHJldmlldyAjbWJNaW5pTWFwLGJvZHkubWItcHJldmlldyAjbWJTaWRlUGFuZWx7ZGlzcGxheTpub25lIWltcG9ydGFudDt9CmJvZHkubWItcHJldmlldyAuY2FudmFzLXNjcm9sbHtwYWRkaW5nOjA7cmlnaHQ6MDt9CmJvZHkubWItcHJldmlldyAjY2FudmFze2JvcmRlcjpub25lO2JveC1zaGFkb3c6bm9uZTtiYWNrZ3JvdW5kLWltYWdlOm5vbmU7fQpib2R5Lm1iLXByZXZpZXcgLmNtcC5zZWxlY3RlZHtvdXRsaW5lOm5vbmUhaW1wb3J0YW50O2JveC1zaGFkb3c6bm9uZSFpbXBvcnRhbnQ7fQpib2R5Lm1iLXByZXZpZXcgLmNtcCAuaGFuZGxlLGJvZHkubWItcHJldmlldyAuY21wIC50YWJ0YWcsYm9keS5tYi1wcmV2aWV3IC5ndWlkZWxpbmUsYm9keS5tYi1wcmV2aWV3IC5nbC1kaXN0e2Rpc3BsYXk6bm9uZSFpbXBvcnRhbnQ7fQojbWJQcmV2aWV3RXhpdHsKICBwb3NpdGlvbjpmaXhlZDtyaWdodDoxNnB4O2JvdHRvbToxNnB4O3otaW5kZXg6MjAwMDtkaXNwbGF5Om5vbmU7CiAgYmFja2dyb3VuZDp2YXIoLS1tYi1uYXZ5KTtjb2xvcjojZmZmO2JvcmRlcjpub25lO2JvcmRlci1yYWRpdXM6MjRweDtwYWRkaW5nOjEzcHggMjBweDsKICBmb250LXNpemU6MTRweDtmb250LXdlaWdodDo3MDA7Y3Vyc29yOnBvaW50ZXI7Ym94LXNoYWRvdzp2YXIoLS1tYi1zaGFkb3cpO2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6N3B4Owp9CmJvZHkubWItcHJldmlldyAjbWJQcmV2aWV3RXhpdHtkaXNwbGF5OmlubGluZS1mbGV4O30KLyogSW50ZXJhY3RpdmUgcHJldmlldyBpZnJhbWU6IG9uIG1vYmlsZS90YWJsZXQsIOuvuOumrOuztOq4sCBsb2FkcyB0aGUgcmVhbCBleHBvcnQgSFRNTAogICAod2l0aCB3b3JraW5nIGNvbXBvbmVudCBldmVudHMpIGludG8gdGhpcyBmcmFtZSBpbnN0ZWFkIG9mIHNob3dpbmcgdGhlIHN0YXRpYwogICBkZXNpZ24gY2FudmFzLiBJdCBmaWxscyB0aGUgdmlld3BvcnQ7IHRoZSBkZXNpZ24gY2FudmFzIGlzIGhpZGRlbiBiZWhpbmQgaXQuICovCiNtYlByZXZpZXdGcmFtZXtwb3NpdGlvbjpmaXhlZDtpbnNldDowO3dpZHRoOjEwMCU7aGVpZ2h0OjEwMCU7Ym9yZGVyOm5vbmU7YmFja2dyb3VuZDojZjRmNmY4O3otaW5kZXg6MTkwMDtkaXNwbGF5Om5vbmU7fQpib2R5Lm1iLXByZXZpZXcubWItcHJldmlldy1saXZlICNtYlByZXZpZXdGcmFtZXtkaXNwbGF5OmJsb2NrO30KYm9keS5tYi1wcmV2aWV3Lm1iLXByZXZpZXctbGl2ZSAuY2FudmFzLXNjcm9sbHtkaXNwbGF5Om5vbmUhaW1wb3J0YW50O30KCi8qIC0tLS0tLS0tLS0gVG9hc3QgLS0tLS0tLS0tLSAqLwojbWJUb2FzdHsKICBwb3NpdGlvbjpmaXhlZDtsZWZ0OjUwJTt0cmFuc2Zvcm06dHJhbnNsYXRlWCgtNTAlKTt6LWluZGV4OjIxMDA7ZGlzcGxheTpub25lOwogIGJhY2tncm91bmQ6dmFyKC0tbWItbmF2eSk7Y29sb3I6I2ZmZjtwYWRkaW5nOjExcHggMThweDtib3JkZXItcmFkaXVzOjIycHg7Zm9udC1zaXplOjEzLjVweDtmb250LXdlaWdodDo2MDA7CiAgYm94LXNoYWRvdzp2YXIoLS1tYi1zaGFkb3cpO21heC13aWR0aDo4MnZ3O3RleHQtYWxpZ246Y2VudGVyOwp9CmJvZHkubWItcG9ydHJhaXQgI21iVG9hc3R7Ym90dG9tOjE3MnB4O30KYm9keS5tYi1sYW5kc2NhcGUgI21iVG9hc3R7Ym90dG9tOjIwcHg7fQoKLyog7YGwIOyGkOqwgOudveyaqTog7ISg7YOdIOy7tO2PrOuEjO2KuCDtlbjrk6Qg7ZmV64yAICovCmJvZHkubWItbW9iaWxlIC5jbXAuc2VsZWN0ZWQgLmhhbmRsZSxib2R5Lm1iLXRhYmxldCAuY21wLnNlbGVjdGVkIC5oYW5kbGV7d2lkdGg6MjBweDtoZWlnaHQ6MjBweDtib3JkZXItd2lkdGg6MnB4O2JvcmRlci1yYWRpdXM6NHB4O30KYm9keS5tYi1tb2JpbGUgLmNtcC5zZWxlY3RlZCAuaGFuZGxlLnNlLGJvZHkubWItdGFibGV0IC5jbXAuc2VsZWN0ZWQgLmhhbmRsZS5zZXtyaWdodDotMTBweDtib3R0b206LTEwcHg7fQpib2R5Lm1iLW1vYmlsZSAuY21wLnNlbGVjdGVkIC5oYW5kbGUuZSxib2R5Lm1iLXRhYmxldCAuY21wLnNlbGVjdGVkIC5oYW5kbGUuZXtyaWdodDotMTBweDt9CmJvZHkubWItbW9iaWxlIC5jbXAuc2VsZWN0ZWQgLmhhbmRsZS5zLGJvZHkubWItdGFibGV0IC5jbXAuc2VsZWN0ZWQgLmhhbmRsZS5ze2JvdHRvbTotMTBweDt9CgovKiDssqsg7KeE7J6FIOy9lOy5mOuniO2BrCAqLwojbWJDb2FjaHsKICBwb3NpdGlvbjpmaXhlZDtpbnNldDowO3otaW5kZXg6MTYwMDtkaXNwbGF5Om5vbmU7YWxpZ24taXRlbXM6Y2VudGVyO2p1c3RpZnktY29udGVudDpjZW50ZXI7CiAgYmFja2dyb3VuZDpyZ2JhKDE2LDI0LDMzLC42Mik7cGFkZGluZzoyOHB4Owp9CiNtYkNvYWNoLnNob3d7ZGlzcGxheTpmbGV4O30KLm1iLWNvYWNoLWNhcmR7YmFja2dyb3VuZDp2YXIoLS1tYi1zdXJmYWNlKTtib3JkZXItcmFkaXVzOjE4cHg7cGFkZGluZzoyMnB4IDIwcHg7bWF4LXdpZHRoOjM0MHB4O2JveC1zaGFkb3c6dmFyKC0tbWItc2hhZG93KTt9Ci5tYi1jb2FjaC1jYXJkIGgze2ZvbnQtc2l6ZToxOHB4O2ZvbnQtd2VpZ2h0OjgwMDtjb2xvcjp2YXIoLS1tYi1pbmspO21hcmdpbi1ib3R0b206NnB4O30KLm1iLWNvYWNoLWNhcmQgcHtmb250LXNpemU6MTRweDtjb2xvcjp2YXIoLS1tYi1pbmstc29mdCk7bGluZS1oZWlnaHQ6MS42O21hcmdpbi1ib3R0b206MTRweDt9Ci5tYi1jb2FjaC1jYXJkIC5zdGVwe2Rpc3BsYXk6ZmxleDtnYXA6MTBweDthbGlnbi1pdGVtczpmbGV4LXN0YXJ0O21hcmdpbi1ib3R0b206MTBweDtmb250LXNpemU6MTMuNXB4O2NvbG9yOnZhcigtLW1iLWluayk7fQoubWItY29hY2gtY2FyZCAuc3RlcCAubntmbGV4Om5vbmU7d2lkdGg6MjRweDtoZWlnaHQ6MjRweDtib3JkZXItcmFkaXVzOjUwJTtiYWNrZ3JvdW5kOnZhcigtLW1iLWFjY2VudC1zb2Z0KTtjb2xvcjp2YXIoLS1tYi1hY2NlbnQtaW5rKTtmb250LXdlaWdodDo4MDA7Zm9udC1zaXplOjEycHg7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyO30KLm1iLWNvYWNoLWNhcmQgYnV0dG9ue3dpZHRoOjEwMCU7bWFyZ2luLXRvcDo4cHg7cGFkZGluZzoxM3B4O2JvcmRlcjpub25lO2JvcmRlci1yYWRpdXM6MTJweDtiYWNrZ3JvdW5kOnZhcigtLW1iLWFjY2VudCk7Y29sb3I6I2ZmZjtmb250LXNpemU6MTVweDtmb250LXdlaWdodDo3MDA7Y3Vyc29yOnBvaW50ZXI7fQo=';
function mbGetAppCSS(){
  try{ return decodeURIComponent(escape(atob(MB_APP_CSS_B64))); }
  catch(e){
    // 혹시 모를 폴백: 인라인 <style> 태그가 있는 환경(예전 단일 파일 버전)이라면 그걸 그대로 쓴다.
    const styleEl=document.querySelector('style');
    return styleEl?styleEl.innerHTML:'';
  }
}
// Builds the full standalone interactive HTML document (shared by 저장 and 미리보기).
function buildExportHTML(){
  const cw=document.getElementById('cw').value;
  const ch=document.getElementById('ch').value;
  let body='';
  comps.filter(c=>!c.parent).forEach(c=>{ body+=exportComp(c)+'\n'; });
  const css=mbGetAppCSS();
  const interactionScript=`
<script>
function setActiveTab(id, idx){
  document.querySelectorAll('[data-tabpage-group="'+id+'"]').forEach(function(el){
    el.style.display = (String(el.getAttribute('data-tabidx'))===String(idx)) ? 'block' : 'none';
  });
  document.querySelectorAll('[data-tabbtn-group="'+id+'"]').forEach(function(el){
    el.classList.toggle('on', String(el.getAttribute('data-tabidx'))===String(idx));
  });
}
function toggleCheckExport(el){
  var box=el.querySelector('.box');
  if(box) box.classList.toggle('on');
}
// Tree: collapse/expand a node by hiding all following rows deeper than it.
function toggleTreeExport(el){
  if(event&&event.stopPropagation)event.stopPropagation();
  var row=el.closest('.tw-row');
  if(!row)return;
  var depth=parseInt(row.getAttribute('data-depth')||'0',10);
  var collapsed=row.classList.toggle('collapsed');
  el.textContent=collapsed?'+':'−';
  var n=row.nextElementSibling;
  while(n&&parseInt(n.getAttribute('data-depth')||'0',10)>depth){
    if(collapsed){ n.style.display='none'; }
    else {
      // only reveal rows that are not hidden by another collapsed ancestor
      var d=parseInt(n.getAttribute('data-depth')||'0',10);
      var hidden=false, p=n.previousElementSibling;
      while(p){
        var pd=parseInt(p.getAttribute('data-depth')||'0',10);
        if(pd<d){ if(p.classList.contains('collapsed')){hidden=true;break;} d=pd; }
        p=p.previousElementSibling;
      }
      if(!hidden) n.style.display='';
    }
    n=n.nextElementSibling;
  }
}
function selectTreeExport(el){
  var tree=el.closest('.ax-tree');
  if(tree) tree.querySelectorAll('.tw-row.on').forEach(function(r){r.classList.remove('on');});
  el.classList.add('on');
}
function toggleRadioExport(el){
  el.classList.toggle('on');
}
function toggleSearchbarExport(el){
  var wrap=el.closest('.ax-search-toggle-wrap');
  if(!wrap)return;
  var full=wrap.querySelector('.ax-search:not(.collapsed)');
  var coll=wrap.querySelector('.ax-search.collapsed');
  if(!full||!coll)return;
  var showingFull = full.style.display!=='none';
  full.style.display = showingFull?'none':'';
  coll.style.display = showingFull?'':'none';
}
// Combo dropdowns are portalled to <body> with position:fixed so they're never clipped by an
// ancestor's overflow:hidden (e.g. a grid's row container) - only reparented once, then just
// repositioned/shown or hidden on each toggle.
function positionComboDrop(el,drop){
  var rect=el.getBoundingClientRect();
  drop.style.position='fixed';
  drop.style.left=rect.left+'px';
  drop.style.top=(rect.bottom+3)+'px';
  drop.style.width=rect.width+'px';
  drop.style.minWidth=rect.width+'px';
  drop.style.zIndex=999999;
}
function closeComboExport(el){
  el.classList.remove('open');
  var drop=el._dropEl;
  if(drop) drop.style.display='none';
}
function toggleComboExport(el){
  var wasOpen=el.classList.contains('open');
  document.querySelectorAll('.ax-combo.open, .sctl.combo.open').forEach(function(o){ if(o!==el) closeComboExport(o); });
  if(wasOpen){ closeComboExport(el); return; }
  var drop=el.querySelector(':scope > .combo-drop');
  if(drop && !el._dropEl){
    document.body.appendChild(drop);
    el._dropEl=drop;
    drop._ownerCombo=el;
  }
  el.classList.add('open');
  if(el._dropEl){
    positionComboDrop(el,el._dropEl);
    el._dropEl.style.display='block';
  }
}
function selectComboExport(optEl){
  var drop=optEl.closest('.combo-drop');
  var wrap=drop&&drop._ownerCombo ? drop._ownerCombo : optEl.closest('.ax-combo, .sctl.combo');
  if(!wrap)return;
  var val=wrap.querySelector('.combo-val');
  if(val) val.textContent=optEl.getAttribute('data-val');
  closeComboExport(wrap);
}
document.addEventListener('click',function(e){
  if(!e.target.closest('.ax-combo.interactive, .sctl.combo.interactive, .combo-drop')){
    document.querySelectorAll('.ax-combo.open, .sctl.combo.open').forEach(function(o){ closeComboExport(o); });
  }
});
window.addEventListener('scroll',function(){
  document.querySelectorAll('.ax-combo.open, .sctl.combo.open').forEach(function(o){ if(o._dropEl) positionComboDrop(o,o._dropEl); });
},true);
window.addEventListener('resize',function(){
  document.querySelectorAll('.ax-combo.open, .sctl.combo.open').forEach(function(o){ if(o._dropEl) positionComboDrop(o,o._dropEl); });
});
function selectRadioGroupExport(el){
  var group=el.getAttribute('data-group');
  document.querySelectorAll('.ax-radio-group .opt[data-group="'+group+'"], .sradio .opt[data-group="'+group+'"]').forEach(function(o){ o.classList.remove('on'); });
  el.classList.add('on');
}
// Split container: dragging the divider live-resizes both panes and stretches whatever's
// inside them (e.g. a grid) to exactly fill the new pane size. A fill child can itself be a
// nested split container - in that case its own pane0/divider/pane1 (baked in at export time
// with fixed px values) must be recomputed too, all the way down, or nested Fill grids would
// stop tracking the divider as soon as there's more than one level of split-in-split.
function layoutSplitExport(wrap){
  var divider=wrap.querySelector(':scope > .split-divider');
  if(!divider) return; // wrap isn't itself a split container - nothing more to lay out here
  var id=divider.getAttribute('data-split-id');
  var dir=divider.getAttribute('data-split-dir');
  var pos=parseFloat(divider.getAttribute('data-split-pos'));
  if(isNaN(pos)) pos=0.5;
  pos=Math.max(0.15,Math.min(0.85,pos));
  var pane0=wrap.querySelector(':scope > [data-split-pane="'+id+'-0"]');
  var pane1=wrap.querySelector(':scope > [data-split-pane="'+id+'-1"]');
  var DIV=8;
  var total=dir==='h'?wrap.offsetWidth:wrap.offsetHeight;
  var w1=Math.max(10,Math.round(total*pos-DIV/2)), w2=Math.max(10,total-w1-DIV);
  if(dir==='h'){
    pane0.style.width=w1+'px';
    divider.style.left=w1+'px';
    pane1.style.left=(w1+DIV)+'px'; pane1.style.width=w2+'px';
  } else {
    pane0.style.height=w1+'px';
    divider.style.top=w1+'px';
    pane1.style.top=(w1+DIV)+'px'; pane1.style.height=w2+'px';
  }
  resizeChildrenExport(pane0); resizeChildrenExport(pane1);
}
function resizeChildrenExport(pane){
  Array.prototype.forEach.call(pane.children,function(ch){
    if(ch.getAttribute('data-dock')==='none') return; // freely placed - leave it alone
    ch.style.width=pane.offsetWidth+'px';
    ch.style.height=pane.offsetHeight+'px';
    layoutSplitExport(ch); // if ch is itself a nested split container, relay out its insides too
  });
}
function startSplitDragExport(e){
  e.preventDefault();
  var divider=e.currentTarget;
  var wrap=divider.parentElement;
  function move(ev){
    var dir=divider.getAttribute('data-split-dir');
    var rect=wrap.getBoundingClientRect();
    var total=dir==='h'?wrap.offsetWidth:wrap.offsetHeight;
    var raw = dir==='h' ? (ev.clientX-rect.left) : (ev.clientY-rect.top);
    var pos=Math.max(0.15,Math.min(0.85, raw/total));
    divider.setAttribute('data-split-pos',pos);
    layoutSplitExport(wrap);
  }
  function up(){ document.removeEventListener('mousemove',move); document.removeEventListener('mouseup',up); }
  document.addEventListener('mousemove',move);
  document.addEventListener('mouseup',up);
}
(function(){
  // 이 목업 html을 여는 "그 순간"의 실제 오늘 날짜를 기준으로 날짜 입력칸을 채운다.
  // - data-relspec이 있는 칸(빠른 날짜 팝업에서 오늘/어제/이번달1일/올해1월1일이나 "직접 조합하기"
  //   축으로 고른 값)은 저장 당시에 계산해 둔 고정 값을 무시하고, 지금 이 순간을 기준으로 다시
  //   계산한다 - 그래야 오늘 "어제"를 고르고 저장한 파일을 내일 열면 그 날짜 기준 "어제"로 보인다.
  // - data-blank가 있는 칸(빈값으로 명시적으로 비워둔 값)은 절대 건드리지 않는다.
  // - 둘 다 없는, 값이 비어 있는 칸(옛 버전 목업 등)만 예전처럼 오늘 날짜로 채운다.
  function pad(n){return String(n).padStart(2,'0');}
  function fmt(dt){return dt.getFullYear()+'-'+pad(dt.getMonth()+1)+'-'+pad(dt.getDate());}
  function today(){ var t=new Date(); t.setHours(0,0,0,0); return t; }
  function resolveSpec(spec){
    if(!spec) return null;
    if(spec.indexOf('chip:')===0){
      var mode=spec.slice(5), t=today();
      if(mode==='yesterday'){ var y=new Date(t); y.setDate(y.getDate()-1); return fmt(y); }
      if(mode==='thisMonth1') return fmt(new Date(t.getFullYear(), t.getMonth(), 1));
      if(mode==='thisYear0101') return fmt(new Date(t.getFullYear(), 0, 1));
      if(mode==='today') return fmt(t);
      return null;
    }
    if(spec.indexOf('axis:')===0){
      var nums=spec.slice(5).split(',').map(Number);
      if(nums.length!==3||nums.some(isNaN)) return null;
      var dt=today();
      dt.setFullYear(dt.getFullYear()+nums[0]);
      dt.setMonth(dt.getMonth()+nums[1]);
      dt.setDate(dt.getDate()+nums[2]);
      return fmt(dt);
    }
    return null;
  }
  var todayStr=fmt(today());
  document.querySelectorAll('.sctl-date-el, .ax-date-el').forEach(function(el){
    var spec=el.getAttribute('data-relspec');
    if(spec){ var v=resolveSpec(spec); if(v) el.value=v; return; }
    if(el.hasAttribute('data-blank')) return;
    if(!el.value) el.value=todayStr;
  });
})();
<\/script>`;
  const t=screenTitle();
  const docTitle = t ? `${t} 목업` : '목업';
  // 공유파일에서 파생된 화면이면(mbCloud.originId), 저장 파일에도 같은 자리에 흔적을 남긴다 -
  // Author/Version처럼 view-source로만 보이는 주석 한 줄. 파생본이 아니면 이 줄 자체가 없다.
  const originLine = mbCloud.originId ? `\n  Origin: ${mbCloud.originId}` : '';
  const out=`<!DOCTYPE html>
<!--
  Generated by Mockup Builder
  Author: Kim Joon-Goo (June)
  Version: ${getLocalVer()||''}${originLine}
-->
<html lang="ko"><head><meta charset="UTF-8"><title>${escAttr(docTitle)}</title>
<meta name="author" content="Kim Joon-Goo">
<meta name="generator" content="Mockup Builder ${getLocalVer()||''}">
<style>
body{font-family:"Malgun Gothic","맑은 고딕",sans-serif;background:#f4f6f8;margin:0;padding:20px;}
.mockup{position:relative;width:${cw}px;height:${ch}px;background:var(--ax-canvas-bg,#fff);border:1px solid #d9dee3;border-radius:6px;box-shadow:0 1px 4px rgba(0,0,0,.06);margin:0 auto;}
${css}
/* Force normal page scrolling in the exported mockup: the block above copies the builder app's
   own stylesheet verbatim (for component styling), which includes an app-shell rule that pins
   body to the viewport height with overflow hidden. That rule must not leak into this standalone
   page, so it is explicitly overridden here, last in the cascade, with !important. */
html,body{height:auto !important;min-height:100%;overflow:visible !important;}
</style></head>
<body${document.body.classList.contains('skin-classic')?' class="skin-classic"':''}><div class="mockup">
${body}</div>${interactionScript}
<script type="application/json" id="__mb_src__">${
  // mbBuildSaveData()를 그대로 재사용 - 클라우드 저장과 완전히 같은 모양의 데이터를 담으므로,
  // originId가 있으면 여기(JSON)에도 자동으로 함께 실린다(위 주석과 별개로 구조화된 형태로 한 번 더).
  JSON.stringify(mbBuildSaveData()).replace(/<\//g,'<\\u002f')
}<\/script>
</body></html>`;
  return out;
}
// Recursively builds the export markup for a component, embedding Tab pages (with working click-to-switch) as nested divs.
function exportComp(c){
  // Z order mirrors the builder: it follows the component's index in `comps`, which is what
  // the 맨 앞/맨 뒤 buttons reorder. A searchbar is lifted within its own band so its dropdown
  // still opens over later siblings without overriding an explicit send-to-back.
  const ord = comps.findIndex(x=>x.id===c.id);
  const zi = `z-index:${(c.type==='searchbar'?100000:1000)+ord};`;
  const dockAttr = c.parent ? ` data-dock="${c.dock==='fill'?'fill':'none'}"` : '';
  let html=`<div class="mockup-item" style="position:absolute;left:${c.x}px;top:${c.y}px;width:${c.w}px;height:${c.h}px;${zi}"${dockAttr}>${inner(c,'export')}`;
  if(c.type==='tabs'){
    const names=ilItems(c,'text');
    const active=c.active||0;
    names.forEach((n,i)=>{
      const kidsHtml=comps.filter(k=>k.parent===c.id&&(k.tabIdx||0)===i).map(k=>exportComp(k)).join('');
      html+=`<div data-tabpage-group="${c.id}" data-tabidx="${i}" style="position:absolute;left:0;top:${TAB_HEADER_H}px;right:0;bottom:0;overflow-y:auto;overflow-x:hidden;${i===active?'':'display:none;'}">${kidsHtml}</div>`;
    });
  }
  if(c.type==='split'){
    const r=splitPaneRects(c);
    const kids0=comps.filter(k=>k.parent===c.id&&(k.pane||0)===0).map(k=>exportComp(k)).join('');
    const kids1=comps.filter(k=>k.parent===c.id&&(k.pane||0)===1).map(k=>exportComp(k)).join('');
    const dirCls=r.dir==='h'?'split-divider-h':'split-divider-v';
    const crossH=r.dir==='h', p0Size=crossH?`width:${r.pane0.w}px;height:100%;`:`width:100%;height:${r.pane0.h}px;`;
    const p1Size=crossH?`width:${r.pane1.w}px;height:100%;`:`width:100%;height:${r.pane1.h}px;`;
    const dvSize=crossH?`width:${r.divider.w}px;height:100%;`:`width:100%;height:${r.divider.h}px;`;
    html+=`<div class="split-pane" data-split-pane="${c.id}-0" style="position:absolute;left:${r.pane0.x}px;top:${r.pane0.y}px;${p0Size}overflow:hidden;">${kids0}</div>`;
    const cpos=Math.min(0.85,Math.max(0.15,c.pos!=null?c.pos:0.5));
    html+=`<div class="split-divider ${dirCls}" data-split-dir="${r.dir}" data-split-id="${c.id}" data-split-pos="${cpos}" style="position:absolute;left:${r.divider.x}px;top:${r.divider.y}px;${dvSize}" onmousedown="startSplitDragExport(event)"></div>`;
    html+=`<div class="split-pane" data-split-pane="${c.id}-1" style="position:absolute;left:${r.pane1.x}px;top:${r.pane1.y}px;${p1Size}overflow:hidden;">${kids1}</div>`;
  }
  if(c.type==='panel'){
    const kids=comps.filter(k=>k.parent===c.id).map(k=>exportComp(k)).join('');
    html+=`<div class="panel-body-wrap" data-panel-body="${c.id}" style="position:absolute;left:0;top:0;right:0;bottom:0;overflow-y:auto;overflow-x:hidden;">${kids}</div>`;
  }
  html+='</div>';
  return html;
}

// ================= IMAGE CONVERSION =================
function openConvert(){
  document.getElementById('convBg').classList.add('on');
  const promptTa=document.getElementById('jsonPrompt');
  promptTa.value='불러오는 중…';
  loadCopyPrompt().then(text=>{ promptTa.value=text; });
  cvSetStep(1);
  clearStatus();
  const ta=document.getElementById('jsonIn');
  ta.classList.remove('filled');
}
function closeConvert(){document.getElementById('convBg').classList.remove('on');resetConv();}
function resetConv(){
  clearStatus();
  const ta=document.getElementById('jsonIn');
  ta.value='';ta.classList.remove('filled');
  document.getElementById('jsonClearChk').checked=true;
  document.querySelectorAll('#paneJSON .cv-detail').forEach(d=>d.removeAttribute('open'));
  cvSetStep(1);
}
// Highlight the current step (1..3), mark earlier ones done.
function cvSetStep(n){
  for(let i=1;i<=3;i++){
    const el=document.getElementById('cvStep'+i);
    if(!el)continue;
    el.classList.toggle('on',i===n);
    el.classList.toggle('done',i<n);
  }
}
// New status box (info/ok/err), with an optional "how to fix" line.
function setStatus(msg,kind,fix){
  const s=document.getElementById('convStatus');
  s.className='cv-status-box show '+(kind||'info');
  s.innerHTML=msg+(fix?`<div class="cv-fix">${fix}</div>`:'');
}
function clearStatus(){const s=document.getElementById('convStatus');s.className='cv-status-box';s.innerHTML='';}

function runConvert(){ runJSON(); }

// ---- JSON paste (free path, no API key / no direct API call) ----
// [씬모드] Claude 「열기」(URL 파라미터)용 — Korean 인코딩 팽창(~3.8배) 때문에 URL 길이 제한에
// 걸리므로 반드시 짧게 유지한다. 더 상세한 지시가 필요하면 아래 JSON_PROMPT_THIN_COPY를 늘릴 것.
const JSON_PROMPT_THIN_URL=`이 화면 캡처를 분석해 UI 컴포넌트 JSON 배열만 출력(설명·코드블록 금지).
형식:{"type","x","y","w","h","text"}·좌표=가로1100px정수·text=보이는값(없으면"")
type:title section label(독립텍스트) input combo date daterange(text="YYYY-MM-DD ~ YYYY-MM-DD") check radio button grid(text=컬럼헤더,쉼표) chart tree searchbar tabs

[제외요소] 우측상단"조회조건 접기/펼치기"버튼은고정UI라출력안함(searchbar fields에도미포함).

[라벨]
input/combo/date/daterange/check/radio는항목명을label로빼지말고본체에포함:showLabel:true,labelText,labelPos:top|left|right|bottom,required=별표(*)면true.
x,y=라벨포함좌상단,h=라벨+입력칸(top/bottom≈52,좌우≈30).라벨없으면showLabel:false(체크박스는text에문구).radio=options쉼표+selected(0부터).combo=펼쳐진목록만options.회색(비활성)=readonly:true.
⚠한라벨아래칸2개(예통화/환율+숫자)는분리:왼쪽만라벨,오른쪽showLabel:false·같은y.
예(칸2개):{"type":"combo","x":20,"y":100,"w":70,"h":52,"text":"KR","showLabel":true,"labelText":"통화/환율","labelPos":"top","required":true},{"type":"input","x":96,"y":122,"w":110,"h":30,"text":"1","showLabel":false,"readonly":true}

[chart]
카드제목("○○현황›")아래원형/막대/선/영역그래프=chart1개:{"type":"chart","x","y","w","h","ctitle":"제목(›제외)","chartType":"donut|bar|line|area","color":"green|blue|yellow|mixed","text":"값1,값2..","showArrow":제목옆›있으면true}
donut=중앙합계원형,bar=세로막대,line=점선,area=선아래채움.text=보이는순서(도넛은범례순,나머지좌→우)로값만나열(항목명·범례문구는제외,필요시옆에label로보완).color=가장가까운계열1개(여러색섞이면mixed),값도좌→우순1배열로근사(구분·x축생략).
예:{"type":"chart","x":20,"y":90,"w":560,"h":260,"ctitle":"직급별 인원현황","chartType":"donut","color":"mixed","text":"1,5,5,60,22,59,59","showArrow":true}

[대시보드]
브레드크럼+우측버튼아래카드나열화면:title=페이지명,우측버튼=button,카드당chart/grid1개,카드실좌표(x,y·동일줄=동일y)유지,테두리/그림자재현안함,카드제목의›=showArrow.

[tree]
계단식들여쓰기목록(좌측메뉴·조직도)=tree1개.text에줄바꿈(\\n)나열,하위는공백2칸씩.
예:{"type":"tree","x":20,"y":80,"w":280,"h":300,"text":"본사\\n  경영지원부문\\n    재경팀\\n  영업부문"}

[tabs]
겉모양이"잔액|원장"같은버튼형세그먼트여도눌러서화면전체가바뀌면button아닌tabs로:{"type":"tabs","_tempId":1,"x","y","w","h","text":"탭명1,탭명2","active":선택탭번호(0부터)}.탭안나머지컴포넌트엔"parent":1(해당tabs의_tempId),"tabIdx":소속탭번호(0부터)추가,좌표는탭콘텐츠영역기준상대(tabs자체좌표는절대).
[다중캡처-탭별화면] 이미지여러장이고각장이다른탭내용이면(예1번째=잔액탭,2번째=원장탭)tabs는1개만만들고각이미지컴포넌트에해당tabIdx를붙여1개JSON으로합침(title·조회조건등반복공통요소는1회만).

[searchbar]
라벨+입력필드가로나열+줄끝조회버튼=searchbar1개(조건1개도,button미생성,접기아이콘은[제외요소]참고):{"type":"searchbar","x","y","w","h","collapsed":접힘true,"fields":[{"label","type","required"}]}
fields=보이는순서,type=text|combo|date|daterange|search(돋보기)|radio(options:"전체,확정,미확정"),required=별표면true,라벨없는칸도label:"",회색칸=readonly:true.
예:{"label":"발주번호","type":"search","required":true},{"label":"","type":"text","readonly":true}

[grid]
행추가/취소/복사/삭제버튼+"○○내역(0)건"제목=grid에포함(별도button/label금지):{"type":"grid","x","y","w","h","text":"컬럼1,컬럼2","gtitle":"요청내역","showToolbar":true,"stdAdd":true,"stdCancel":true,"stdCopy":true,"stdDelete":true}
그외버튼="userBtns":[{"label":"품목참조"}].필수컬럼="*품목코드".하단신규/저장/삭제만button.
[다중캡처병합] 가로스크롤로여러장찍힌동일그리드는컬럼을좌→우로이어붙여grid1개(중복컬럼명은뒤것버림1회,text는병합전체순서로나열).gtitle·title·searchbar등다른컴포넌트도반복확인돼도화면기준1회만출력.
[병합헤더] 헤더가2줄이고위줄한칸이아래여러컬럼을가로질러덮으면(예"기준정보"가"품목"·"품목명"위에걸침)"colGroups":배열을text와같은개수·순서로추가:병합된컬럼은같은그룹명반복,미병합컬럼은"".헤더1줄이면colGroups생략.
예:{"type":"grid","x":20,"y":100,"w":1060,"h":220,"text":"품목,품목명,출고창고,출고방법","colGroups":["기준정보","기준정보","재고정보","재고정보"],"gtitle":"목록","showToolbar":true,"stdAdd":true,"stdCancel":true,"stdCopy":true,"stdDelete":true}

[레이아웃]
원본픽셀그대로베끼지말고폭1060기준재배치:순서title→(tabs)→searchbar→입력/카드(chart·grid)→하단버튼,x:20여백통일,같은줄y맞춤,입력한줄4~6개균등(라벨포함h52,컨트롤30),구획제목=section그아래입력배치,폭넘으면다음줄(겹치지않게),3D테두리/아이콘/색배경등장식재현안함.
[간격] title/tabs바로아래(8~16px)에다음요소를붙인다-브레드크럼·아이콘·"조회조건 접기"버튼처럼[제외요소]로뺀공간은원본y값그대로베끼지말고좁혀없앤다.searchbar h는조건수·줄바꿈에따라커질수있음(대략줄당52px,줄수=ceil(필드수/4~6))-예상보다커지면그아래모든컴포넌트(tabs·section·chart·grid·button등)y를늘어난만큼반드시내려절대겹치지않게함.

[구형화면]
촘촘한입력칸+회색3D테두리+작은폰트인옛화면:경로(A>B>C(S)(코드))는마지막이름만title,흩어진조회항목은위치무관모아searchbar1개(좌상→우하순,돋보기/목록아이콘=search,~로이은두날짜=daterange,코드칸+옆회색이름칸=search1개·값은라벨만),표=grid1개(컬럼원본순서,rows대략,버튼없어도showToolbar+stdAdd/Cancel/Copy/Delete추가,제목없으면gtitle지어줌),우측상단단독버튼(회계전표등)=button,하단에저장/확정추가.
[{"type":"title","x":20,"y":16,"w":220,"h":34,"text":"기타출고등록"},
{"type":"button","x":960,"y":18,"w":110,"h":32,"text":"회계전표","ghost":true},
{"type":"searchbar","x":20,"y":62,"w":1060,"h":110,"collapsed":false,"fields":[{"label":"공장","type":"search","required":true},{"label":"출고일","type":"daterange","required":true},{"label":"창고","type":"search"},{"label":"품목계정","type":"combo"}]},
{"type":"grid","x":20,"y":186,"w":1060,"h":300,"text":"출고번호","gtitle":"출고내역","showToolbar":true,"stdAdd":true,"stdCancel":true,"stdCopy":true,"stdDelete":true,"userBtns":[{"label":"품목참조"}],"rows":8}]`;

// [씬모드] 「질문만 복사」(클립보드) 전용 프롬프트 — 클립보드 복사는 URL 길이 제한이 없으므로
// 여기에 더 상세하고 긴 지시문을 자유롭게 추가해도 된다. 「Claude에 보내는 질문 미리 보기」에도
// 이 프롬프트가 표시된다. ⚠️ 위 JSON_PROMPT_THIN_URL과 완전히 별개의 텍스트이므로,
// 이 블록만 수정하면 되고 「Claude 열기」(URL)쪽에는 전혀 영향을 주지 않는다.
const JSON_PROMPT_THIN_COPY=`이 화면 캡처를 분석해 UI 컴포넌트 JSON 배열만 출력(설명·코드블록 금지).
형식:{"type","x","y","w","h","text"}·좌표=가로1100px정수·text=보이는값(없으면"")
type:title section label(독립텍스트) input combo date daterange(text="YYYY-MM-DD ~ YYYY-MM-DD") check radio button grid(text=컬럼헤더,쉼표) chart tree searchbar tabs

[제외요소] 우측상단"조회조건 접기/펼치기"버튼은고정UI라출력안함(searchbar fields에도미포함).

[라벨]
input/combo/date/daterange/check/radio는항목명을label로빼지말고본체에포함:showLabel:true,labelText,labelPos:top|left|right|bottom,required=별표(*)면true.
x,y=라벨포함좌상단,h=라벨+입력칸(top/bottom≈52,좌우≈30).라벨없으면showLabel:false(체크박스는text에문구).radio=options쉼표+selected(0부터).combo=펼쳐진목록만options.회색(비활성)=readonly:true.
⚠한라벨아래칸2개(예통화/환율+숫자)는분리:왼쪽만라벨,오른쪽showLabel:false·같은y.
예(칸2개):{"type":"combo","x":20,"y":100,"w":70,"h":52,"text":"KR","showLabel":true,"labelText":"통화/환율","labelPos":"top","required":true},{"type":"input","x":96,"y":122,"w":110,"h":30,"text":"1","showLabel":false,"readonly":true}

[chart]
카드제목("○○현황›")아래원형/막대/선/영역그래프=chart1개:{"type":"chart","x","y","w","h","ctitle":"제목(›제외)","chartType":"donut|bar|line|area","color":"green|blue|yellow|mixed","text":"값1,값2..","showArrow":제목옆›있으면true}
donut=중앙합계원형,bar=세로막대,line=점선,area=선아래채움.text=보이는순서(도넛은범례순,나머지좌→우)로값만나열(항목명·범례문구는제외,필요시옆에label로보완).color=가장가까운계열1개(여러색섞이면mixed),값도좌→우순1배열로근사(구분·x축생략).
예:{"type":"chart","x":20,"y":90,"w":560,"h":260,"ctitle":"직급별 인원현황","chartType":"donut","color":"mixed","text":"1,5,5,60,22,59,59","showArrow":true}

[대시보드]
브레드크럼+우측버튼아래카드나열화면:title=페이지명,우측버튼=button,카드당chart/grid1개,카드실좌표(x,y·동일줄=동일y)유지,테두리/그림자재현안함,카드제목의›=showArrow.

[tree]
계단식들여쓰기목록(좌측메뉴·조직도)=tree1개.text에줄바꿈(\\n)나열,하위는공백2칸씩.
예:{"type":"tree","x":20,"y":80,"w":280,"h":300,"text":"본사\\n  경영지원부문\\n    재경팀\\n  영업부문"}

[tabs]
겉모양이"잔액|원장"같은버튼형세그먼트여도눌러서화면전체가바뀌면button아닌tabs로:{"type":"tabs","_tempId":1,"x","y","w","h","text":"탭명1,탭명2","active":선택탭번호(0부터)}.탭안나머지컴포넌트엔"parent":1(해당tabs의_tempId),"tabIdx":소속탭번호(0부터)추가,좌표는탭콘텐츠영역기준상대(tabs자체좌표는절대).
[다중캡처-탭별화면] 이미지여러장이고각장이다른탭내용이면(예1번째=잔액탭,2번째=원장탭)tabs는1개만만들고각이미지컴포넌트에해당tabIdx를붙여1개JSON으로합침(title·조회조건등반복공통요소는1회만).

[searchbar]
라벨+입력필드가로나열+줄끝조회버튼=searchbar1개(조건1개도,button미생성,접기아이콘은[제외요소]참고):{"type":"searchbar","x","y","w","h","collapsed":접힘true,"fields":[{"label","type","required"}]}
fields=보이는순서,type=text|combo|date|daterange|search(돋보기)|radio(options:"전체,확정,미확정")|empty(빈칸,자리만차지),required=별표면true,라벨없는칸도label:"",회색칸=readonly:true.
span=칸너비(기본1,생략가능):1|2|3|4(전체)|0.5(½칸).
[½칸] 조회조건한칸안에입력컨트롤이2개나란히붙어있으면(라벨이"요청조직 / 구매조직"처럼합쳐서한번만보이거나,"공장""창고"처럼각각보여도)한칸을합쳐쓰지말고그2개를연속된fields2개로쪼개고둘다"span":0.5로지정(순서는왼쪽→오른쪽).라벨이하나로합쳐져있으면"/"나공백기준으로쪼개각field의label에하나씩나눠담고,컨트롤마다라벨이따로있으면그대로각자label사용.한칸에컨트롤이1개뿐이면span은생략(또는1)하고0.5를단독으로쓰지않는다.
예(한칸에2개-요청조직/구매조직,공장/창고):{"label":"요청조직","type":"combo","span":0.5},{"label":"구매조직","type":"combo","span":0.5}
예:{"label":"발주번호","type":"search","required":true},{"label":"","type":"text","readonly":true}

[grid]
"○○내역"·"○○정보(0)건"처럼제목이보이는표=grid1개(제목텍스트는gtitle).⚠제목이보이면버튼유무와무관하게반드시"showToolbar":true로설정할것-false로하면제목까지함께사라져원본과달라짐.행추가/취소/복사/삭제버튼이보이면해당std*를true로,버튼이하나도안보이면std*전부false·userBtns생략(그래도showToolbar는true유지,별도button/label금지).
예(버튼있음):{"type":"grid","x","y","w","h","text":"컬럼1,컬럼2","gtitle":"요청내역","showToolbar":true,"stdAdd":true,"stdCancel":true,"stdCopy":true,"stdDelete":true}
예(제목만있고버튼없음):{"type":"grid","x","y","w","h","text":"제조오더번호,공정,품목,품목명","gtitle":"제조오더정보","showToolbar":true,"stdAdd":false,"stdCancel":false,"stdCopy":false,"stdDelete":false}
그외버튼="userBtns":[{"label":"품목참조"}].하단신규/저장/삭제만button.
[필수컬럼] 헤더텍스트옆에빨간색*가붙은컬럼이있으면(예"품목코드","요청수량"처럼헤더에빨간*표시)해당컬럼명(text)에는*를넣지말고"colRequired":배열을text와같은개수·순서로추가:빨간*가있던컬럼만true,나머지는false.전부false면colGroups처럼생략가능.
예:{"type":"grid","x":20,"y":100,"w":1060,"h":220,"text":"품목코드,요청수량,단위,필요일","colRequired":[true,true,true,false],"gtitle":"요청내역","showToolbar":true,"stdAdd":true,"stdCancel":true,"stdCopy":true,"stdDelete":true}
[Row Order/CheckBox] ⚠모든grid마다"rowOrderCol"·"checkboxCol"두값을예외없이반드시명시(하나라도생략금지-생략시기본값true로나와원본과달라짐).둘은서로독립적으로판단(RowOrder가true라고checkbox도true인건아님).
1)그리드맨왼쪽컬럼헤더가톱니바퀴·깔때기(필터)·압정3아이콘조합(텍스트없음)이고데이터행이1부터표시행수까지자동순번이면"rowOrderCol":true,그아이콘조합자체가안보이면"rowOrderCol":false.
2)1)의아이콘컬럼바로오른쪽칸(아이콘컬럼이없으면맨왼쪽칸)을확인:그칸이헤더·데이터행전부빈체크박스뿐이면"checkboxCol":true.그자리에체크박스없이바로"제조오더번호"같은실제컬럼헤더텍스트가시작되면(즉아이콘컬럼바로다음이곧바로첫데이터컬럼이면)"checkboxCol":false.
이두컬럼(있는경우)은컬럼목록(text·colRequired·colAligns등)에절대넣지말것-그리드기본기능으로자동생성됨.업무데이터인"순번"처럼헤더에텍스트가있는일반컬럼은이규칙과무관하므로그대로text에포함.
예(RowOrder+CheckBox있음):{"type":"grid","x":20,"y":100,"w":1060,"h":220,"text":"발주번호,순번,공급처","rowOrderCol":true,"checkboxCol":true,"gtitle":"발주내역","showToolbar":true,"stdAdd":true,"stdCancel":true,"stdCopy":true,"stdDelete":true}
예(RowOrder만있고바로다음칸이체크박스없이제조오더번호로시작:CheckBox없음):{"type":"grid","x":20,"y":100,"w":1060,"h":160,"text":"제조오더번호,공정,품목,품목명","rowOrderCol":true,"checkboxCol":false,"gtitle":"제조오더정보","showToolbar":true,"stdAdd":false,"stdCancel":false,"stdCopy":false,"stdDelete":false}
예(둘다없음):{"type":"grid","x":20,"y":100,"w":1060,"h":220,"text":"품목,품목명,수량","rowOrderCol":false,"checkboxCol":false,"gtitle":"목록","showToolbar":true,"stdAdd":true,"stdCancel":true,"stdCopy":true,"stdDelete":true}
[컬럼정렬] 헤더글자가컬럼마다좌측/가운데/우측중다르게배치되어보이면그대로"colAligns":배열을text와같은개수·순서로추가:각값은헤더텍스트정렬과동일하게"left"|"center"|"right"중하나(병합헤더그룹아래하위컬럼도각자헤더정렬대로개별지정).전컬럼이left면colAligns생략가능.
예:{"type":"grid","x":20,"y":100,"w":1060,"h":220,"text":"잔여년차,근태일자,신청기간(To),성명","colAligns":["center","center","center","center"],"colRequired":[false,true,false,true],"gtitle":"휴가/근태 신청상세","showToolbar":true,"stdAdd":true,"stdCancel":true,"stdCopy":true,"stdDelete":true}
[다중캡처병합] 가로스크롤로여러장찍힌동일그리드는컬럼을좌→우로이어붙여grid1개(중복컬럼명은뒤것버림1회,text는병합전체순서로나열).gtitle·title·searchbar등다른컴포넌트도반복확인돼도화면기준1회만출력.
[병합헤더] 헤더가2줄이고위줄한칸이아래여러컬럼을가로질러덮으면(예"기준정보"가"품목"·"품목명"위에걸침)"colGroups":배열을text와같은개수·순서로추가:병합된컬럼은같은그룹명반복,미병합컬럼은"".헤더1줄이면colGroups생략.
예:{"type":"grid","x":20,"y":100,"w":1060,"h":220,"text":"품목,품목명,출고창고,출고방법","colGroups":["기준정보","기준정보","재고정보","재고정보"],"gtitle":"목록","showToolbar":true,"stdAdd":true,"stdCancel":true,"stdCopy":true,"stdDelete":true}

[레이아웃]
원본픽셀그대로베끼지말고폭1060기준재배치:순서title→(tabs)→searchbar→입력/카드(chart·grid)→하단버튼,x:20여백통일,같은줄y맞춤,입력한줄4~6개균등(라벨포함h52,컨트롤30),구획제목=section그아래입력배치,폭넘으면다음줄(겹치지않게),3D테두리/아이콘/색배경등장식재현안함.
[간격] title/tabs바로아래(8~16px)에다음요소를붙인다-브레드크럼·아이콘·"조회조건 접기"버튼처럼[제외요소]로뺀공간은원본y값그대로베끼지말고좁혀없앤다.
searchbar h는반드시직접계산해서지킬것(대충어림잡지말것):한줄에담긴필드의span합(생략시1,½칸2개가붙어있으면그2개를합쳐1로계산)이4를넘는순간다음줄로넘어감→rows=이렇게나온총줄수,h=28+rows*52+(rows-1)*12(최소84).계산된h가원본이미지에서본높이보다커지더라도반드시그값을그대로사용.
searchbar바로아래에오는모든컴포넌트(tabs·section·chart·grid·button등)는y를반드시"searchbar의y+계산한h+18"로시작해서배치할것-원본이미지의y값을베끼면겹치므로절대금지,grid가searchbar와겹치는것은잘못된결과임.

[구형화면]
촘촘한입력칸+회색3D테두리+작은폰트인옛화면:경로(A>B>C(S)(코드))는마지막이름만title,흩어진조회항목은위치무관모아searchbar1개(좌상→우하순,돋보기/목록아이콘=search,~로이은두날짜=daterange,코드칸+옆회색이름칸=search1개·값은라벨만),표=grid1개(컬럼원본순서,rows대략,버튼없어도showToolbar+stdAdd/Cancel/Copy/Delete추가,제목없으면gtitle지어줌),우측상단단독버튼(회계전표등)=button,하단에저장/확정추가.
[{"type":"title","x":20,"y":16,"w":220,"h":34,"text":"기타출고등록"},
{"type":"button","x":960,"y":18,"w":110,"h":32,"text":"회계전표","ghost":true},
{"type":"searchbar","x":20,"y":62,"w":1060,"h":110,"collapsed":false,"fields":[{"label":"공장","type":"search","required":true},{"label":"출고일","type":"daterange","required":true},{"label":"창고","type":"search"},{"label":"품목계정","type":"combo"}]},
{"type":"grid","x":20,"y":186,"w":1060,"h":300,"text":"출고번호,출고일,수불유형,창고,품목명","gtitle":"출고내역","showToolbar":true,"stdAdd":true,"stdCancel":true,"stdCopy":true,"stdDelete":true,"userBtns":[{"label":"품목참조"}],"rows":8},
{"type":"button","x":880,"y":505,"w":90,"h":34,"text":"저장","ghost":true},
{"type":"button","x":980,"y":505,"w":90,"h":34,"text":"확정"}]`;

// Fat Mode 전용 변환 프롬프트: 조회조건은 searchbar 대신 panel(그룹박스)+
// 자식 컴포넌트(부모/자식)로 구성하고, 라벨 기본 위치는 left, 크기는 Fat Mode 기본 크기(가로 1.3배·
// 세로 2/3배 보정된 값, 예: input/combo/date 234x35)를 기준으로 안내한다.
// [팻모드] Claude 「열기」(URL 파라미터)용 — 마찬가지로 URL 길이 제한 때문에 짧게 유지한다.
const JSON_PROMPT_FAT_URL=`이 화면 캡처를 분석해 UI 컴포넌트 JSON 배열만 출력(설명·코드블록 금지).
형식:{"type","x","y","w","h","text"}·좌표=가로1100px정수·text=보이는값(없으면"")
type:title section panel tabs label input combo date daterange(text="YYYY-MM-DD ~ YYYY-MM-DD") check radio popup button grid(text=컬럼헤더,쉼표) chart tree

[필수규칙]
-labelPos기본left(세로쌓임만top/bottom)
-조회조건:searchbar금지,panel+input/combo/date자식(labelPos left).조회버튼·돋보기검색버튼·우측상단"조회조건 접기/펼치기"버튼모두출력안함
-코드+명칭=popup1개(w380~460,코드만style:"code",w200~300)
-별표안보임,진한배경=required:true
-그리드행툴바(행추가등)button생성안함([grid]참고)
-구형화면:경로마지막만title,조회칸모아panel1개
예:{"type":"panel","_tempId":1,"x":20,"y":50,"w":1060,"h":90},{"type":"combo","parent":1,"x":30,"y":10,"w":300,"h":23,"text":"동아","showLabel":true,"labelText":"공장","labelPos":"left"}

[입력형]
input/combo/date/daterange/check/radio는label대신본체:showLabel:true,labelText,labelPos"left",required(색배경true).
h=라벨+칸(left/right≈23,top/bottom≈52),w보통234(popup420안팎).없으면showLabel:false.radio=options쉼표+selected(0부터).combo=목록만options.색배경=readonly:true.
⚠코드+숫자분리값만같은y2칸(왼쪽라벨,오른쪽showLabel:false),그외한줄1개씩.
예:{"type":"combo","x":20,"y":100,"w":70,"h":23,"text":"KR","showLabel":true,"labelText":"환율","labelPos":"left","required":true},{"type":"input","x":96,"y":100,"w":110,"h":23,"text":"1","showLabel":false,"readonly":true}

[chart] 카드그래프=chart1:{"type":"chart","x","y","w","h","ctitle":"제목","chartType":"donut|bar|line|area","color":"green|blue|yellow|mixed","text":"값1,값2..","showArrow":true}.text=순서값만,donut=중앙합계.

[대시보드/Ref] 카드나열:title=페이지명,버튼=button,카드당chart/grid1,실좌표유지,›=showArrow.독립label:우상"~참조"=ref,우하"~조회"=jump.

[tabs/panel] 강조탭2개=tabs(text=이름쉼표,active=번호0부터).겉모양이버튼(예"잔액|원장")이어도눌러서화면전체바뀌면button아닌tabs로처리.가로소구역=panel.컨테이너"_tempId",자식"parent"=값(tabs자식엔"tabIdx"도),좌표는컨테이너기준상대.
[다중캡처-탭별화면] 이미지여러장=각각다른탭내용(예1번째잔액탭,2번째원장탭)이면tabs는1개만,각이미지컴포넌트에해당tabIdx붙여1개JSON으로합침(title·조회조건등공통요소는1회만).

[tree] 계단목록=tree1,text줄바꿈(\\n)+하위공백2칸.예:{"type":"tree","x":20,"y":80,"w":280,"h":300,"text":"본사\\n  경영지원부문"}

[grid]
컬럼이핵심:{"type":"grid","x","y","w","h","text":"컬럼1,컬럼2","rows":8}.필수="*컬럼명".
-행추가·행취소·행복사·행삭제·저장(그리드CRUD툴바)는고정UI라button/attribute모두생성안함.button은무관한독립버튼만(예:확정,품목참조,폼하단저장)
-다장캡처동일그리드는컬럼좌→우이어붙여grid1개(중복명뒤것버림1회),다른컴포넌트도1회만.
-헤더2줄+위칸이여러컬럼걸침(병합헤더,예:"기준정보"가"품목"·"품목명"위)="colGroups":배열을text와동일개수·순서로추가(병합컬럼은동일그룹명반복,미병합컬럼은"").헤더1줄이면colGroups생략.
예:{"type":"grid","x":20,"y":100,"w":1060,"h":220,"text":"품목,품목명,출고창고,출고방법","colGroups":["기준정보","기준정보","재고정보","재고정보"],"rows":8}

[레이아웃]
폭1060재배치:
1.순서:title→(tabs)→panel→입력→카드→버튼
2.좌우2단:컬럼당1줄1필드순서유지(라벨동행금지,예외:[입력형])
3.panel류가로나열만한줄2~4개
4.x20여백,구획=section,넘으면줄바꿈
5.장식생략(색상·별표자동적용)
6.title/tabs바로아래(8~16px)에다음요소(panel등)를붙인다-브레드크럼·아이콘·"조회조건 접기"버튼처럼[필수규칙]로뺀공간은원본y값그대로베끼지말고좁혀없앤다.조회조건panel은항목수·줄바꿈에따라h가커질수있음(예상보다커지면그아래모든컴포넌트-tabs·section·chart·grid·button등-y를늘어난만큼반드시내려절대겹치지않게함)`;

// [팻모드] 「질문만 복사」(클립보드) 전용 프롬프트 — URL 길이 제한이 없으므로 자유롭게 확장 가능.
// 「Claude에 보내는 질문 미리 보기」에도 이 프롬프트가 표시된다. ⚠️ 위 JSON_PROMPT_FAT_URL과
// 완전히 별개의 텍스트이므로, 이 블록만 수정하면 되고 「Claude 열기」(URL)쪽에는 전혀 영향을 주지 않는다.
const JSON_PROMPT_FAT_COPY=`이 화면 캡처를 분석해 UI 컴포넌트 JSON 배열만 출력(설명·코드블록 금지).
형식:{"type","x","y","w","h","text"}·좌표=가로1100px정수·text=보이는값(없으면"")
type:title section panel tabs label input combo date daterange(text="YYYY-MM-DD ~ YYYY-MM-DD") check radio popup button grid(text=컬럼헤더,쉼표) chart tree

[필수규칙]
-labelPos기본left(세로쌓임만top/bottom)
-조회조건:searchbar금지,panel+input/combo/date자식(labelPos left).조회버튼·돋보기검색버튼·우측상단"조회조건 접기/펼치기"버튼모두출력안함
-코드+명칭=popup1개(w380~460,코드만style:"code",w200~300)
-별표안보임,진한배경=required:true
-그리드행툴바(행추가등)button생성안함([grid]참고)
-구형화면:경로마지막만title,조회칸모아panel1개
예:{"type":"panel","_tempId":1,"x":20,"y":50,"w":1060,"h":90},{"type":"combo","parent":1,"x":30,"y":10,"w":300,"h":23,"text":"동아","showLabel":true,"labelText":"공장","labelPos":"left"}

[입력형]
input/combo/date/daterange/check/radio는label대신본체:showLabel:true,labelText,labelPos"left",required(색배경true).
h=라벨+칸(left/right≈23,top/bottom≈52),w보통234(popup420안팎).없으면showLabel:false.radio=options쉼표+selected(0부터).combo=목록만options.색배경=readonly:true.
⚠코드+숫자분리값만같은y2칸(왼쪽라벨,오른쪽showLabel:false),그외한줄1개씩.
예:{"type":"combo","x":20,"y":100,"w":70,"h":23,"text":"KR","showLabel":true,"labelText":"환율","labelPos":"left","required":true},{"type":"input","x":96,"y":100,"w":110,"h":23,"text":"1","showLabel":false,"readonly":true}

[chart] 카드그래프=chart1:{"type":"chart","x","y","w","h","ctitle":"제목","chartType":"donut|bar|line|area","color":"green|blue|yellow|mixed","text":"값1,값2..","showArrow":true}.text=순서값만,donut=중앙합계.

[대시보드/Ref] 카드나열:title=페이지명,버튼=button,카드당chart/grid1,실좌표유지,›=showArrow.독립label:우상"~참조"=ref,우하"~조회"=jump.

[tabs/panel] 강조탭2개=tabs(text=이름쉼표,active=번호0부터).겉모양이버튼(예"잔액|원장")이어도눌러서화면전체바뀌면button아닌tabs로처리.가로소구역=panel.컨테이너"_tempId",자식"parent"=값(tabs자식엔"tabIdx"도),좌표는컨테이너기준상대.
[다중캡처-탭별화면] 이미지여러장=각각다른탭내용(예1번째잔액탭,2번째원장탭)이면tabs는1개만,각이미지컴포넌트에해당tabIdx붙여1개JSON으로합침(title·조회조건등공통요소는1회만).

[tree] 계단목록=tree1,text줄바꿈(\\n)+하위공백2칸.예:{"type":"tree","x":20,"y":80,"w":280,"h":300,"text":"본사\\n  경영지원부문"}

[grid]
컬럼이핵심:{"type":"grid","x","y","w","h","text":"컬럼1,컬럼2","rows":8}.필수="*컬럼명".
-행추가·행취소·행복사·행삭제·저장(그리드CRUD툴바)는고정UI라button/attribute모두생성안함.button은무관한독립버튼만(예:확정,품목참조,폼하단저장)
-다장캡처동일그리드는컬럼좌→우이어붙여grid1개(중복명뒤것버림1회),다른컴포넌트도1회만.
-헤더2줄+위칸이여러컬럼걸침(병합헤더,예:"기준정보"가"품목"·"품목명"위)="colGroups":배열을text와동일개수·순서로추가(병합컬럼은동일그룹명반복,미병합컬럼은"").헤더1줄이면colGroups생략.
예:{"type":"grid","x":20,"y":100,"w":1060,"h":220,"text":"품목,품목명,출고창고,출고방법","colGroups":["기준정보","기준정보","재고정보","재고정보"],"rows":8}

[레이아웃]
폭1060재배치:
1.순서:title→(tabs)→panel→입력→카드→버튼
2.좌우2단:컬럼당1줄1필드순서유지(라벨동행금지,예외:[입력형])
3.panel류가로나열만한줄2~4개
4.x20여백,구획=section,넘으면줄바꿈
5.장식생략(색상·별표자동적용)
6.title/tabs바로아래(8~16px)에다음요소(panel등)를붙인다-브레드크럼·아이콘·"조회조건 접기"버튼처럼[필수규칙]로뺀공간은원본y값그대로베끼지말고좁혀없앤다.조회조건panel은항목수·줄바꿈에따라h가커질수있음(예상보다커지면그아래모든컴포넌트-tabs·section·chart·grid·button등-y를늘어난만큼반드시내려절대겹치지않게함)`;

// 지금 켜져 있는 스킨(Thin/Fat)에 맞는 변환 프롬프트를 돌려준다.
// kind='url' → Claude 열기(새 창 URL 파라미터, 인코딩 팽창 때문에 짧아야 함) - 항상 이 JS
//              파일 안의 JSON_PROMPT_*_URL을 그대로 쓴다. 아래 외부 파일 분리 대상이 아니다.
// kind='copy' → 질문만 복사 / 미리 보기(클립보드, 길이 제한 없음 — 더 상세하게 작성 가능)
function currentJsonPrompt(kind){
  const fat=document.body.classList.contains('skin-classic');
  if(kind==='copy') return fat?JSON_PROMPT_FAT_COPY:JSON_PROMPT_THIN_COPY;
  return fat?JSON_PROMPT_FAT_URL:JSON_PROMPT_THIN_URL;
}
// ---- 「질문만 복사」 프롬프트를 외부 텍스트 파일에서 읽어오기 ----
// 씬모드/팻모드 프롬프트를 각각 이 두 파일에 그대로 옮겨 두었다. 프롬프트 문구를 고칠 땐
// 이 JS를 건드릴 필요 없이 아래 두 파일만 메모장 등으로 열어 텍스트를 고치고 저장하면,
// 다음에 「이미지 변환」창을 열거나 「질문만 복사」를 누르는 순간 바로 반영된다(캐시 방지를
// 위해 매번 새로 읽어온다). 「Claude 열기」(URL) 프롬프트는 이 대상이 아니며 계속
// JSON_PROMPT_*_URL(이 파일 안)로만 관리한다 - 그쪽은 URL 인코딩 길이 제한 때문에 원래도
// 손댈 일이 적어, 파일 분리보다 한곳에 고정해 두는 편이 더 안전하다.
// 파일을 못 찾거나(예: index.html을 더블클릭해 file://로 직접 열었을 때는 브라우저가
// 로컬 파일 fetch를 막는다) 읽기에 실패하면, 아래 내장 JSON_PROMPT_*_COPY 문구로
// 조용히 대체한다 - 기능이 끊기지 않도록 하는 안전장치일 뿐, 정상적으로 웹서버(GitHub
// Pages 등)로 열었을 때는 쓰이지 않는다.
const PROMPT_FILE_THIN_COPY='image-convert-thin.txt';
const PROMPT_FILE_FAT_COPY='image-convert-fat.txt';
async function loadCopyPrompt(){
  const fat=document.body.classList.contains('skin-classic');
  const file=fat?PROMPT_FILE_FAT_COPY:PROMPT_FILE_THIN_COPY;
  try{
    // no-store + 캐시버스터: 파일을 방금 고쳤어도 브라우저/디스크 캐시된 옛 내용이
    // 아니라 항상 지금 저장된 내용을 읽도록 한다.
    const res=await fetch(file+'?v='+Date.now(),{cache:'no-store'});
    if(!res.ok) throw new Error('http '+res.status);
    const text=await res.text();
    if(!text||!text.trim()) throw new Error('empty file');
    return text;
  }catch(e){
    return fat?JSON_PROMPT_FAT_COPY:JSON_PROMPT_THIN_COPY;
  }
}
// When the user pastes/types the answer, advance to step 3 and give a filled cue.
(function(){
  const ta=document.getElementById('jsonIn');
  if(!ta)return;
  const onFill=()=>{
    const has=ta.value.trim().length>0;
    ta.classList.toggle('filled',has);
    if(has)cvSetStep(3);
    if(has)clearStatus();
  };
  ta.addEventListener('input',onFill);
  ta.addEventListener('paste',()=>setTimeout(onFill,0));
})();
function copyPrompt(){
  loadCopyPrompt().then(text=>{
    navigator.clipboard&&navigator.clipboard.writeText(text).then(
      ()=>{cvSetStep(2);setStatus('📋 질문을 복사했어요. Claude 채팅창에 붙여넣고, <b>화면 캡처 이미지도 함께 첨부</b>해서 보내세요.','ok');},
      ()=>setStatus('복사가 안 됐어요.','err','위 미리 보기 칸의 글자를 직접 드래그해서 복사해 주세요.')
    );
  });
}
// Opens claude.ai in a new tab with the prompt already filled in.
// ⚠️ 「Claude 열기」는 요청대로 건드리지 않음: 항상 JS에 내장된 JSON_PROMPT_*_URL을 그대로 쓴다.
function openInClaude(){
  const prompt=currentJsonPrompt('url');
  const url='https://claude.ai/new?q='+encodeURIComponent(prompt);
  window.open(url,'_blank','noopener');
  cvSetStep(2);
  setStatus('🤖 Claude를 새 창에 열었어요. 그 화면에 <b>만들고 싶은 화면 캡처 이미지를 첨부</b>하고 전송하세요.','ok','새 창이 안 열렸다면 팝업 차단을 해제하거나, 왼쪽 「질문만 복사」로 직접 붙여넣어 주세요.');
}
// 이미지 변환으로 만든 컴포넌트 기준으로 캔버스 폭/높이를 정확히 맞춘다(필요하면 늘리고,
// 여유가 많이 남으면 줄인다). 배치 직후 comps 전체(기존+새로 추가된 것)의 최대 범위로 계산하므로
// "기존 화면에 이어서 추가"로 쓸 때도 내용이 잘리지 않는다.
function fitCanvasToComponents(padRight,padBottom){
  padRight = padRight!=null ? padRight : 20;
  padBottom = padBottom!=null ? padBottom : 20;
  if(!comps.length) return;
  let maxX=0, maxY=0;
  comps.forEach(c=>{
    const abs=absPos(c);
    maxX=Math.max(maxX, abs.x+(c.w||0));
    maxY=Math.max(maxY, abs.y+(c.h||0));
  });
  const cwEl=document.getElementById('cw'), chEl=document.getElementById('ch');
  const needW=Math.ceil(maxX+padRight), needH=Math.ceil(maxY+padBottom);
  cwEl.value=needW; setCW();
  chEl.value=needH; setCH();
}
function runJSON(){
  const raw=document.getElementById('jsonIn').value.trim();
  if(!raw){
    setStatus('아직 붙여넣은 내용이 없어요.','err','3번 칸에 Claude가 준 답을 붙여넣은 뒤 다시 눌러 주세요.');
    return;
  }
  try{
    let txt=raw.replace(/```json/gi,'').replace(/```/g,'').trim();
    const m=txt.match(/\[[\s\S]*\]/);
    if(m)txt=m[0];
    else throw new Error('NO_BRACKET');
    let items;
    try{ items=JSON.parse(txt); }
    catch(e){ throw new Error('PARSE'); }
    if(!Array.isArray(items))throw new Error('NOT_ARRAY');
    if(!items.length)throw new Error('EMPTY');
    const clearFirst=document.getElementById('jsonClearChk').checked;
    placeItems(items,1,clearFirst);
    fitCanvasToComponents();
    fitZoomToViewport();
    cvSetStep(3);
    setStatus(`✅ 완성! <b>${items.length}개</b>의 컴포넌트를 화면에 그렸어요.${clearFirst?' (기존 내용은 지웠어요)':' (기존 화면에 이어서 추가했어요)'}`,'ok');
    setTimeout(closeConvert,900);
  }catch(err){
    let fix;
    switch(err.message){
      case 'NO_BRACKET':
        fix='Claude 답에서 <b>[</b> 로 시작해 <b>]</b> 로 끝나는 부분을 찾지 못했어요. 그 부분 전체를 다시 복사해 붙여넣어 주세요.';break;
      case 'PARSE':
        fix='붙여넣은 코드 중간이 잘렸거나 일부만 복사된 것 같아요. Claude 답의 <b>[</b> 부터 <b>]</b> 까지를 빠짐없이 복사했는지 확인해 주세요.';break;
      case 'NOT_ARRAY':
        fix='형식이 조금 달라요. Claude에게 "다시 [ ] 형태의 목록으로만 답해 줘"라고 요청한 뒤 그 답을 붙여넣어 보세요.';break;
      case 'EMPTY':
        fix='내용이 비어 있어요. Claude가 화면을 인식하도록 캡처 이미지를 다시 첨부해 보세요.';break;
      default:
        fix='Claude 답 전체를 다시 복사해 붙여넣어 주세요.';
    }
    setStatus('붙여넣은 내용을 화면으로 바꾸지 못했어요.','err',fix);
  }
}

// ---- Seed sample ----
function defaultScreen(){
  const items=[
    {id:uid++,type:'title',x:20,y:16,w:200,h:34,text:'프로그램 제목',required:false,readonly:false}
  ];
  const fat=document.body.classList.contains('skin-classic');
  if(fat){
    // Fat Mode 기본화면: 조회조건 컴포넌트 대신, 패널(그룹박스) 안에
    // 텍스트박스 2개(조회1/조회2)를 부모/자식 관계로 넣어 구성한다.
    const panelId=uid++;
    items.push({id:panelId,type:'panel',x:20,y:50,w:1060,h:40,text:'',required:false,readonly:false});
    items.push({id:uid++,type:'input',parent:panelId,x:30,y:10,w:300,h:23,text:'',required:false,readonly:false,
      showLabel:true,labelText:'조회1',labelPos:'left'});
    items.push({id:uid++,type:'input',parent:panelId,x:560,y:10,w:300,h:23,text:'',required:false,readonly:false,
      showLabel:true,labelText:'조회2',labelPos:'left'});
  } else {
    // Thin Mode(기존)는 조회조건 패널 컴포넌트에 조건1/조건2 필드 그대로.
    items.push({id:uid++,type:'searchbar',x:20,y:64,w:1060,h:84,text:'',required:false,readonly:false,collapsed:false,
      fields:[
        {label:'조건1',type:'text',required:false},
        {label:'조건2',type:'text',required:false}
      ]});
  }
  return items;
}
function seed(){
  comps=defaultScreen();
  render();
}

// Places an array of imported/template JSON items onto the canvas.
// scale: multiply all coordinates (1 = as-is). clearFirst: wipe canvas first.
function placeItems(items,scale,clearFirst){
  pushHistory();
  if(clearFirst){ comps=[]; clearOriginTracking(); } // 기존 내용을 지우는 선택이므로 파생 추적 값도 함께 지운다
  const known=['title','section','panel','tabs','label','input','combo','date','daterange','check','radio','button','grid','chart','tree','searchbar','popup'];
  const fieldTypes=['text','combo','date','daterange','search','radio','empty'];
  // Properties (beyond type/x/y/w/h/text/required) that a JSON item may set directly; copied through as-is.
  const passthroughKeys=['gtitle','userBtns','stdAdd','stdCancel','stdCopy','stdDelete','rows','showToolbar',
    'options','readonly','ghost','active','collapsed','ctitle','chartType','color','showArrow','selected','selectedLine','showLines','colGroups',
    'colAligns','colRequired','colReadonly','rowOrderCol','checkboxCol',
    'showLabel','labelText','labelPos','required','checked','style'];
  const idMap={}; // _tempId (author-assigned, only needed for Tab parent/child references) -> real comp id
  const built=[];
  items.forEach(it=>{
    let type=(it.type||'input').toLowerCase();
    if(!known.includes(type))type='input';
    let text=(it.text||'');
    let required=false;
    if(type!=='grid'&&type!=='tabs'&&text.includes('|req')){required=true;text=text.replace('|req','').trim();}
    const base=JSON.parse(JSON.stringify(defaults[type]));
    // Templates and imported JSON supply their own separate label components,
    // so the built-in label set stays off unless the item explicitly asks for it.
    if(LABELED_TYPES.includes(type)) base.showLabel=false;
    const extra={};
    passthroughKeys.forEach(k=>{ if(it[k]!==undefined) extra[k]=it[k]; });
    if(it.required===true) required=true;
    if(type==='searchbar'){
      if(Array.isArray(it.fields)&&it.fields.length){
        extra.fields=it.fields.map(f=>{
          const ft=fieldTypes.includes((f.type||'').toLowerCase())?f.type.toLowerCase():'text';
          const field={label:f.label||'',type:ft,required:!!f.required};
          if(f.readonly) field.readonly=true;
          if(f.options) field.options=String(f.options);
          if((ft==='date'||ft==='daterange')&&f.text) field.text=String(f.text);
          if(f.span) field.span=(parseFloat(f.span)===0.5)?0.5:Math.min(4,Math.max(1,parseInt(f.span)||1));
          return field;
        });
      }
      if(typeof it.collapsed==='boolean') extra.collapsed=it.collapsed;
    }
    const newId=uid++;
    if(it._tempId!==undefined) idMap[it._tempId]=newId;
    const comp={...base,id:newId,type,
      x:Math.round((it.x||0)*scale),y:Math.round((it.y||0)*scale),
      w:Math.max(30,Math.round((it.w||base.w)*scale)),h:Math.max(20,Math.round((it.h||base.h)*scale)),
      text:text||base.text,required,...extra};
    // size a searchbar to its field count instead of trusting the supplied height
    if(type==='searchbar'&&!comp.collapsed) comp.h=searchbarHeight(comp);
    built.push({it,comp});
  });
  built.forEach(({it,comp})=>{
    if(it.parent!==undefined&&idMap[it.parent]!==undefined){
      comp.parent=idMap[it.parent];
      if(it.tabIdx!==undefined) comp.tabIdx=it.tabIdx;
    }
    comps.push(comp);
  });
  autoFitContainers(built.map(b=>b.comp));
  selectSingle(null);render();
}
// 패널·탭 안에 자식이 많아 내부 스크롤이 생기지 않도록, 이번에 새로 들어온 컨테이너(panel/tabs)의
// 크기를 자식들이 전부 들어가는 크기로 자동으로 키운다(줄이지는 않음 - 원본 지정값이 이미 더 크면 유지).
// 안쪽 컨테이너(패널 속 패널 등)부터 먼저 맞춰야 바깥 컨테이너 계산이 정확하므로, 중첩 깊이가 깊은
// 것부터 처리한다.
function containerNestDepth(c){
  let d=0, cur=c;
  while(cur.parent){
    const p=comps.find(x=>x.id===cur.parent);
    if(!p) break;
    d++; cur=p;
  }
  return d;
}
function autoFitContainers(newComps){
  const PAD=16;
  const containers=newComps.filter(c=>c.type==='panel'||c.type==='tabs');
  containers.sort((a,b)=>containerNestDepth(b)-containerNestDepth(a));
  containers.forEach(cont=>{
    const kids=comps.filter(k=>k.parent===cont.id);
    if(!kids.length) return;
    let maxX=0, maxY=0;
    kids.forEach(k=>{ maxX=Math.max(maxX,k.x+k.w); maxY=Math.max(maxY,k.y+k.h); });
    const neededW=maxX+PAD;
    const neededH=(cont.type==='tabs'?maxY+TAB_HEADER_H:maxY)+PAD;
    const oldW=cont.w, oldH=cont.h;
    const parentKey=cont.parent||null;
    // 컨테이너가 커진 만큼, 같은 레벨(형제)이면서 아래쪽/오른쪽에 있던 컴포넌트를 그만큼 밀어내서
    // 겹치지 않게 한다(형제가 아니거나 컨테이너 위·왼쪽에 있던 것은 그대로 둔다).
    if(neededH>oldH){
      const deltaH=neededH-oldH, bottomBefore=cont.y+oldH;
      cont.h=neededH;
      comps.forEach(s=>{
        if(s.id===cont.id) return;
        if((s.parent||null)!==parentKey) return;
        if(s.y>=bottomBefore-1) s.y+=deltaH;
      });
    }
    if(neededW>oldW){
      const deltaW=neededW-oldW, rightBefore=cont.x+oldW;
      cont.w=neededW;
      comps.forEach(s=>{
        if(s.id===cont.id) return;
        if((s.parent||null)!==parentKey) return;
        if(s.x>=rightBefore-1) s.x+=deltaW;
      });
    }
  });
}
// =====================================================================
// Template system: compact per-screen specs + a generic layout engine
// that expands them into placeItems()-style JSON, so we reuse all of
// placeItems' existing default-merging / searchbar-fields / grid-toolbar
// / Tab-parent-child logic instead of duplicating it here.
// =====================================================================
function layoutForm(spec){
  const items=[];
  const CW=spec.canvasW||1450;
  const usableW=CW-40;
  let y=16;
  items.push({type:'title',x:20,y,w:420,h:34,text:spec.title});
  y+=52;

  if(spec.search&&spec.search.length){
    // height grows with the number of condition rows, and everything below shifts down
    const sbH=searchbarHeight({fields:spec.search});
    items.push({type:'searchbar',x:20,y,w:usableW,h:sbH,collapsed:false,fields:spec.search});
    y+=sbH+18;
  }

  const COLS=spec.cols||6;
  const COLGAP=20;
  const COLW=Math.floor((usableW-(COLS-1)*COLGAP)/COLS);
  const LABEL_H=18,CTRL_H=30,FIELD_VGAP=4,ROW_GAP=16;
  const FIELD_H=LABEL_H+FIELD_VGAP+CTRL_H; // label + control as one component
  (spec.sections||[]).forEach(sec=>{
    items.push({type:'section',x:20,y,w:usableW,h:22,text:sec.title});
    y+=30;
    let col=0,rowY=y,rowH=0;
    sec.fields.forEach(f=>{
      const span=f.span||1;
      if(col+span>COLS){ y=rowY+rowH+ROW_GAP; col=0; rowY=y; rowH=0; }
      const x=20+col*(COLW+COLGAP);
      const w=COLW*span+(span-1)*COLGAP;
      const hasLabel=!!(f.label&&String(f.label).trim());
      if(f.type==='check'){
        // checkbox keeps its caption inline (no stacked label needed)
        items.push({type:'check',x,y:rowY+LABEL_H+FIELD_VGAP,w,h:CTRL_H,text:f.label+(f.required?'|req':''),showLabel:false});
      } else if(f.sub||f.suffix){
        // One label shared by a main control plus an optional second control
        // (e.g. 통화/환율 = combo + rate box) and/or a static suffix such as "%" or "Day".
        const GAP=8, SUFW=f.suffix?26:0;
        const inner=w-(f.suffix?GAP+SUFW:0);
        const mainW=f.sub?Math.round((inner-GAP)*(f.mainRatio||0.45)):inner;
        const subW=f.sub?(inner-GAP-mainW):0;
        const main={type:f.type,x,y:rowY,w:mainW,h:hasLabel?FIELD_H:CTRL_H,
          text:(f.type==='radio')?'':(f.value||''),
          showLabel:hasLabel,labelText:hasLabel?f.label:'',labelPos:'top',
          required:!!f.required};
        if(!hasLabel) main.y=rowY+LABEL_H+FIELD_VGAP;
        if(f.type==='radio') main.options=f.options||'';
        if(f.options&&f.type==='combo') main.options=f.options;
        if(f.readonly) main.readonly=true;
        items.push(main);
        if(f.sub){
          const sub={type:f.sub.type||'input',x:x+mainW+GAP,y:rowY+LABEL_H+FIELD_VGAP,w:subW,h:CTRL_H,
            text:f.sub.value||'',showLabel:false,labelText:''};
          if(f.sub.options) sub.options=f.sub.options;
          if(f.sub.readonly) sub.readonly=true;
          items.push(sub);
        }
        if(f.suffix)
          items.push({type:'label',x:x+mainW+(f.sub?GAP+subW:0)+GAP,y:rowY+LABEL_H+FIELD_VGAP+6,w:SUFW,h:18,text:f.suffix,showLabel:false});
      } else {
        const ctrl={type:f.type,x,y:rowY,w,
          h:hasLabel?FIELD_H:CTRL_H,
          text:(f.type==='radio')?'':(f.value||''),
          showLabel:hasLabel,labelText:hasLabel?f.label:'',labelPos:'top',
          required:!!f.required};
        if(!hasLabel) ctrl.y=rowY+LABEL_H+FIELD_VGAP;
        if(f.type==='radio') ctrl.options=f.options||'';
        if(f.options&&f.type==='combo') ctrl.options=f.options;
        if(f.readonly) ctrl.readonly=true;
        items.push(ctrl);
      }
      rowH=Math.max(rowH,FIELD_H);
      col+=span;
    });
    y=rowY+rowH+26;
  });

  if(spec.tabs){
    const tabH=spec.tabs.h||300;
    const tabId='__tabs1';
    items.push({_tempId:tabId,type:'tabs',x:20,y,w:usableW,h:tabH,text:spec.tabs.names.join(','),active:0});
    (spec.tabs.pages||[]).forEach((page,pi)=>{
      (page.grids||[]).forEach((g,gi)=>{
        const gh=g.h||220;
        items.push({parent:tabId,tabIdx:pi,type:'grid',x:16,y:16+gi*(gh+16),w:usableW-32,h:gh,
          text:g.cols.join(','),gtitle:g.title||'',rows:g.rows||3,
          stdAdd:!!g.stdAdd,stdCancel:!!g.stdCancel,stdCopy:!!g.stdCopy,stdDelete:!!g.stdDelete,
          userBtns:g.userBtns||[]});
      });
    });
    y+=tabH+18;
  }

  (spec.grids||[]).forEach(g=>{
    if(g.label){ items.push({type:'label',x:20,y,w:400,h:20,text:g.label}); y+=26; }
    const gh=g.h||200;
    items.push({type:'grid',x:20,y,w:usableW,h:gh,text:g.cols.join(','),gtitle:g.title||'',rows:g.rows||3,
      stdAdd:!!g.stdAdd,stdCancel:!!g.stdCancel,stdCopy:!!g.stdCopy,stdDelete:!!g.stdDelete,
      userBtns:g.userBtns||[]});
    y+=gh+18;
  });

  if(spec.buttons&&spec.buttons.length){
    const bw=112,bh=36,bgap=10;
    const totalW=spec.buttons.length*bw+(spec.buttons.length-1)*bgap;
    let bx=20+usableW-totalW;
    spec.buttons.forEach(b=>{ items.push({type:'button',x:bx,y,w:bw,h:bh,text:b}); bx+=bw+bgap; });
    y+=bh+20;
  }

  return {items,canvasH:Math.max(400,y+20),canvasW:CW};
}

const TEMPLATES={
  reg:{
    '수주등록':{
      title:'수주등록',
      search:[{label:'수주번호',type:'search',required:true}],
      sections:[
        {title:'일반정보',fields:[
          {label:'수주형태',type:'combo',required:true},{label:'주문처',type:'combo',required:true},
          {label:'납품처',type:'input',required:true},{label:'수주일',type:'date',required:true},
          {label:'영업그룹',type:'combo',required:true},{label:'고객주문번호',type:'input'},
          {label:'비고',type:'input',span:3},{label:'수주번호',type:'input',readonly:true},{label:'메일전송여부',type:'combo'}
        ]},
        {title:'금액정보',fields:[
          {label:'통화/환율',type:'combo',required:true,options:'KRW,USD,EUR,JPY',value:'KRW',
            mainRatio:0.38,sub:{type:'input',value:'1',readonly:true}},
          {label:'부가세유형',type:'combo',required:true,
            mainRatio:0.62,suffix:'%',sub:{type:'input',readonly:true}},
          {label:'부가세포함여부',type:'radio',options:'별도,포함'},{label:'공급가액',type:'input',readonly:true},
          {label:'부가세액',type:'input',readonly:true},{label:'수주금액',type:'input',readonly:true}
        ]},
        {title:'결제정보',fields:[
          {label:'판매유형',type:'combo',required:true},{label:'결제방법',type:'combo',required:true},
          {label:'결제기간',type:'input',suffix:'Day'},{label:'입금유형',type:'combo'},
          {label:'운송방법',type:'combo'},{label:'가격조건',type:'combo'}
        ]}
      ],
      grids:[{title:'수주내역',cols:['*품목','품목명','*Tracking 번호','프로젝트','*수주량','*단위','단가','공급가액','부가세액','수주금액'],
        stdAdd:true,stdCancel:true,stdCopy:true,stdDelete:true,userBtns:['품목참조','재고현황','반품시 출고참조']}],
      buttons:['신규','수주복사','저장']
    },
    '발주등록':{
      title:'발주등록',
      search:[{label:'발주번호',type:'search',required:true}],
      sections:[
        {title:'일반정보',fields:[
          {label:'발주형태',type:'combo',required:true},{label:'공급처',type:'combo',required:true},
          {label:'발주일',type:'date',required:true},{label:'구매그룹',type:'combo',required:true},
          {label:'공급처 영업담당',type:'input'},{label:'메일전송여부',type:'combo'},
          {label:'비고',type:'input',span:2},{label:'발주번호',type:'input',readonly:true}
        ]},
        {title:'금액정보',fields:[
          {label:'통화/환율',type:'combo',required:true,options:'KRW,USD,EUR,JPY',value:'KRW',
            mainRatio:0.38,sub:{type:'input',value:'1',readonly:true}},
          {label:'부가세유형',type:'combo',
            mainRatio:0.68,sub:{type:'input',value:'0',readonly:true}},
          {label:'부가세포함여부',type:'radio',options:'별도,포함'},{label:'공급가액',type:'input',readonly:true},
          {label:'부가세액',type:'input',readonly:true},{label:'발주금액',type:'input',readonly:true}
        ]},
        {title:'결제정보',fields:[
          {label:'결제방법',type:'combo',required:true},{label:'지급유형',type:'combo'},
          {label:'결제기간',type:'input',suffix:'일'},{label:'가격조건',type:'combo'},{label:'대금결제참조',type:'input'}
        ]}
      ],
      grids:[{title:'발주내역',cols:['*품목코드','품목명','*발주수량','*단위','단가','공급가액','부가세액','발주금액','단가구분','납기일','Tracking No.','프로젝트'],
        stdAdd:true,stdCancel:true,stdCopy:true,stdDelete:true,userBtns:['품목참조']}],
      buttons:['신규','발주복사','구매요청참조','저장']
    },
    '출고등록':{
      title:'출고등록',
      search:[{label:'납품처',type:'combo',required:true},{label:'출고일',type:'date',required:true},
        {label:'영업그룹',type:'combo',required:true},{label:'출고형태',type:'combo',required:true},
        {label:'비고',type:'text'},{label:'출고번호',type:'text'}],
      grids:[{title:'출고내역정보',cols:['수주번호','순번','품목','품목명','규격','수주량','잔량','*예정출고량','단위','*창고','출고예정일','납기'],
        stdAdd:false,stdCancel:true,stdCopy:false,stdDelete:true,userBtns:['재고현황']}],
      buttons:['신규','출고예정검색']
    },
    '매출세금계산서등록':{
      title:'매출세금계산서등록',
      search:[{label:'매출번호',type:'search',required:true}],
      sections:[
        {title:'일반정보',fields:[
          {label:'주문처',type:'combo',required:true},{label:'발행처',type:'combo',required:true},
          {label:'수금처',type:'combo',required:true},{label:'영업그룹',type:'combo',required:true},
          {label:'매출등록일',type:'date',required:true},{label:'수금그룹',type:'combo',required:true},
          {label:'비고',type:'input',span:2},{label:'세금신고사업장',type:'combo',required:true},
          {label:'매출형태',type:'combo',required:true},{label:'매출번호',type:'input',readonly:true},
          {label:'세금계산서',type:'check'}
        ]},
        {title:'금액정보',fields:[
          {label:'통화/환율',type:'combo'},{label:'공급가액',type:'input',readonly:true},
          {label:'부가세액',type:'input',readonly:true},{label:'매출 총금액',type:'input',readonly:true},
          {label:'선수금액',type:'input',readonly:true},{label:'부가세유형',type:'combo',required:true},
          {label:'부가세율(%)',type:'input',readonly:true},{label:'부가세포함여부',type:'radio',options:'별도,포함'},
          {label:'부가세적용방법',type:'radio',options:'개별,통합'}
        ]},
        {title:'결제정보',fields:[
          {label:'결제방법',type:'combo',required:true},{label:'결제조건',type:'combo'},
          {label:'결제기간(일)',type:'input'},{label:'수금만기일',type:'date'},
          {label:'입금유형',type:'combo'},{label:'대금결제참조',type:'input'}
        ]}
      ],
      tabs:{names:['매출내역','선수금내역'],h:340,pages:[
        {grids:[{title:'매출내역',cols:['*품목코드','품목명','규격','*수량','단위','*단가','매출금액','부가세액','금액','*부가세유형','*포함여부'],
          h:280,stdAdd:true,stdCancel:true,stdCopy:false,stdDelete:true,userBtns:[]}]},
        {grids:[{title:'선수금내역',cols:['*수금유형','*수금금액','수금금액(자국)','환율','계좌번호','은행','어음번호','선수금번호','비고'],
          h:280,stdAdd:true,stdCancel:true,stdCopy:true,stdDelete:true,userBtns:[]}]}
      ]},
      buttons:['신규','매출예정검색','저장']
    },
    '생산실적등록':{
      title:'생산실적등록',
      search:[{label:'공장',type:'combo',required:true},{label:'착수예정일',type:'daterange',required:true},
        {label:'작업장',type:'combo'},{label:'작업',type:'radio',options:'실적등록,실적삭제'}],
      grids:[
        {title:'제조오더정보',cols:['제조오더번호','공정','착수예정일','완료예정일','품목','품목명','Tracking 번호','프로젝트 코드','오더량','단위','생산량','잔량'],
          stdAdd:false,stdCancel:false,stdCopy:false,stdDelete:false,userBtns:[]},
        {title:'생산실적',cols:['*실적일','*실적구분','*생산량','단위','불량원인','*Lot번호','*Lot 순번','입고수불번호','출고수불번호'],
          stdAdd:true,stdCancel:true,stdCopy:false,stdDelete:false,userBtns:['입고전표보기','출고전표보기','저장','부품Simulation']}
      ]
    },
    '검사결과등록':{
      title:'검사결과등록',
      search:[{label:'공장',type:'combo',required:true},{label:'검사의뢰일',type:'daterange'},
        {label:'검사분류',type:'combo'},{label:'검사항태',type:'combo'}],
      grids:[
        {title:'검사의뢰 목록',cols:['의뢰번호','분류','재고구분','품목','품목명','규격','단위','LOT번호','거래처','로트수량','검사수량','잔여수량','의뢰일'],
          stdAdd:false,stdCancel:false,stdCopy:false,stdDelete:false,userBtns:['검사등록','확정','확정취소']},
        {title:'검사결과 입력',cols:['의뢰번호','분류','재고구분','품목','결과번호','확정','*검사원','*검사일','*검사수량','불량수','불량률','양품수','판정','부적합코드','불량유형'],
          stdAdd:false,stdCancel:true,stdCopy:true,stdDelete:true,userBtns:['저장']}
      ]
    },
    '제조오더등록':{
      title:'제조오더등록',
      search:[{label:'공장',type:'combo',required:true},{label:'착수예정일',type:'daterange',required:true},
        {label:'품목',type:'combo'},{label:'확정여부',type:'radio',options:'확정예정,확정'},
        {label:'제조오더번호',type:'search'},{label:'작업지시구분',type:'combo'},{label:'MRP실행번호',type:'search'}],
      grids:[
        {title:'품목오더정보',cols:['제조오더번호','*품목','품목명','Tracking 번호','프로젝트','*착수예정일','*완료예정일','*오더량','*단위','*BOM 번호','*라우팅','*재작업','시작공정','*창고','비고'],
          stdAdd:true,stdCancel:true,stdCopy:true,stdDelete:true,userBtns:['품목참조','저장']},
        {title:'공정오더정보',cols:['공정','작업장명','공정작업','MileStone','착수예정일','완료예정일'],
          stdAdd:false,stdCancel:false,stdCopy:false,stdDelete:false,userBtns:[]},
        {title:'부품소요량정보',cols:['*공정','*자품목','품목명','Tracking No.','*필요량','단위','*필요일','*창고','출고창고'],
          stdAdd:true,stdCancel:true,stdCopy:true,stdDelete:true,userBtns:['품목참조','저장']}
      ],
      buttons:['확정']
    }
  },
  inq:{
    '수주현황조회':{
      title:'수주현황조회',
      search:[{label:'수주일',type:'daterange'},{label:'납기일',type:'date'},{label:'주문처',type:'combo'},{label:'품목',type:'combo'}],
      grids:[{title:'수주정보',cols:['수주번호','순번','수주일','납기일','주문처','품목','품목명','Tracking No','프로젝트','수주량','단위','출고'],
        stdAdd:false,stdCancel:false,stdCopy:false,stdDelete:false,userBtns:[]}]
    },
    '발주현황조회':{
      title:'발주현황조회',
      search:[{label:'발주일',type:'daterange'},{label:'공급처',type:'combo'},{label:'품목',type:'combo'},{label:'공장',type:'combo'}],
      grids:[{title:'발주현황',cols:['발주번호','순번','공급처','품목코드','품목명','발주수량','단위','입출고수량','매입수량','B/L수량','통관수량','공급가액','부가세액','발주총금액'],
        stdAdd:false,stdCancel:false,stdCopy:false,stdDelete:false,userBtns:[]}]
    },
    '출고현황':{
      title:'출고현황',
      search:[{label:'출고일',type:'daterange'},{label:'납품처',type:'combo'},{label:'창고',type:'combo'},{label:'품목',type:'combo'},
        {label:'출고형태',type:'combo'},{label:'영업그룹',type:'combo'},{label:'출고번호',type:'search'},{label:'공장',type:'combo'}],
      grids:[{title:'출고현황',cols:['출고번호','품목','품목명','Tracking 번호','프로젝트','출고요청량','출고량','단위','재고단위수량','통관량','매출량'],
        stdAdd:false,stdCancel:false,stdCopy:false,stdDelete:false,userBtns:[]}]
    },
    '매출내역현황조회':{
      title:'매출내역현황조회',
      search:[{label:'매출채권일',type:'daterange'},{label:'주문처',type:'combo'},{label:'품목',type:'combo'},{label:'매출채권형태',type:'combo'},
        {label:'사업장',type:'combo'},{label:'영업그룹',type:'combo'},{label:'매출채권번호',type:'search'},
        {label:'확정여부',type:'radio',options:'전체,확정,미확정'},{label:'수주번호',type:'search'},{label:'매출채권요약',type:'text'}],
      grids:[{title:'매출현황',cols:['매출번호','순번','주문처','품목','품목명','매출일','수금만기일','매출수량','단위','매출총금액','부가세액','공급가액'],
        stdAdd:false,stdCancel:false,stdCopy:false,stdDelete:false,userBtns:[]}]
    },
    '생산실적현황':{
      title:'생산실적현황',
      search:[{label:'실적일',type:'daterange'},{label:'공장',type:'combo'},{label:'품목',type:'combo'},
        {label:'제조오더번호',type:'search'},{label:'작업장',type:'combo'}],
      grids:[{title:'생산실적정보',cols:['품목','품목명','Tracking No','프로젝트 코드','LOT No','실적일','작업장','생산량','양품','불량','입고수불번호'],
        stdAdd:false,stdCancel:false,stdCopy:false,stdDelete:false,userBtns:[]}]
    },
    '검사결과조회':{
      title:'검사결과조회',
      search:[{label:'공장',type:'combo',required:true},{label:'검사의뢰일',type:'daterange'},{label:'검사분류',type:'combo'},
        {label:'검사항태',type:'combo'},{label:'품목',type:'combo'},{label:'의뢰번호',type:'search'}],
      grids:[
        {title:'검사의뢰 목록',cols:['의뢰번호','분류','재고구분','품목','품목명','규격','단위','LOT번호','거래처','로트수량','검사수량','잔여수량','의뢰일'],
          stdAdd:false,stdCancel:false,stdCopy:false,stdDelete:false,userBtns:[]},
        {title:'검사결과 입력',cols:['의뢰번호','분류','재고구분','품목','결과번호','확정','검사원','검사일','검사수량','불량수','불량률','양품수','판정','부적합코드','불량유형'],
          stdAdd:false,stdCancel:true,stdCopy:true,stdDelete:true,userBtns:[]}
      ]
    },
    '제조오더현황':{
      title:'제조오더현황',
      search:[{label:'공장',type:'combo',required:true},{label:'착수예정일',type:'daterange',required:true},
        {label:'오더상태',type:'combo'},{label:'제조오더번호',type:'search'},
        {label:'품목',type:'combo'},{label:'잔량',type:'radio',required:true,options:'전체,있음,없음'}],
      grids:[{title:'제조오더정보',cols:['제조오더번호','품목','품목명','Tracking 번호','프로젝트 코드','착수예정일','완료예정일','오더량','생산량','양품','불량'],
        stdAdd:false,stdCancel:false,stdCopy:false,stdDelete:false,userBtns:[]}]
    }
  }
};

let tmplTab='reg';
// ---- Patch notes (shown once per version unless dismissed) ----
// ---- Patch notes ----
// Newest first. Add a new entry at the top on each release and bump PATCH_VER;
// older ones stay available as history tabs.
const PATCH_NOTES=[
  {ver:'20260910.001', date:'2026년 9월 10일', items:[
    {t:'로그인 · 회원가입', d:'이메일 계정으로 <b>로그인·회원가입</b>이 가능해졌습니다.<br><br>로그인하면 목업을 <b>클라우드에 저장</b>할 수 있고, 같은 브라우저에서는 다음에 열 때도 <b>자동으로 로그인</b>됩니다.'},
    {t:'클라우드 관리 (폴더 · 즐겨찾기 · 검색)', d:'저장한 목업을 <b>폴더</b>로 나눠 정리하고, 자주 쓰는 파일은 <b>즐겨찾기</b>로 따로 모아볼 수 있습니다.<br><br>제목·태그로 <b>검색·정렬</b>할 수 있고, <b>목록형·그리드형</b> 두 가지 보기 방식을 지원합니다.'},
    {t:'공유하기', d:'저장한 목업을 <b>공개로 전환</b>하면 「공유파일」 탭에서 다른 사람도 볼 수 있습니다.<br><br>제목·태그·작성자로 찾아볼 수 있고, 공유 목록이 많아져도 <b>스크롤하면 100개씩 자동으로 이어서</b> 불러옵니다.'},
    {t:'Feedback', d:'우측 상단 계정 메뉴의 <b>💬 Feedback</b>에서 건의사항·버그를 바로 남길 수 있습니다.<br><br>메일이나 메신저 없이 <b>앱 안에서 바로 전달</b>됩니다.'}
  ]},
  {ver:'20260909.001', date:'2026년 9월 9일', items:[
    {t:'그리드 컬럼 폭 방식: 자동 · 수동 · 고정', d:'① <b>자동</b>: 글자 안 잘리는 최소 크기로 실시간 조절.<br>② <b>수동</b>: 슬라이더 값 전체 컬럼 동일 적용.<br>③ <b>고정</b>: 그리드 너비 균등 분할.<br>④ 기본값 자동.'},
    {t:'컬럼 폭 개별 드래그 조절', d:'① 방식 무관, 헤더 경계선 드래그로 해당 컬럼만 폭 조절.'},
    {t:'컬럼 드래그앤드롭 순서 변경', d:'① 헤더 컬럼명 드래그로 순서 변경.<br>② Row Order·CheckBox 이동 불가(항상 맨 왼쪽).<br>③ 가로 스크롤 그리드는 화면 끝 이동 시 자동 스크롤.'}
  ]},
  {ver:'20260908.006', date:'2026년 9월 8일', items:[
    {t:'그리드 컬럼 드래그 관련 마무리 수정', d:'컬럼을 드래그해 자동 스크롤로 화면 밖까지 옮긴 뒤 실제로 <b>놓는(drop) 순간</b>에도 스크롤이 맨 왼쪽으로 튕기던 문제를 마저 고쳤습니다(직전 버전은 드래그 도중에만 고쳐져 있었습니다).<br><br>또한 컬럼 폭을 드래그로 직접 조절해둔 뒤 <b>컬럼 폭 방식(자동/수동/고정)</b>을 바꾸면, 그 컬럼만 예전 폭이 남아있던 문제를 고쳤습니다. 이제 방식을 바꾸면 모든 컬럼이 - 직접 조절했던 컬럼도 포함해서 - 새 방식 기준으로 다시 균일하게 맞춰집니다.'}
  ]},
  {ver:'20260908.005', date:'2026년 9월 8일', items:[
    {t:'그리드 컬럼 드래그 중 가로 스크롤이 튕기던 문제 수정', d:'컬럼을 드래그해 좌우 스크롤이 있는 그리드의 화면 밖으로 가져가면 자동으로 스크롤되는데, 그 상태에서 마우스를 다시 반대쪽(놓으려는 위치)으로 옮기면 스크롤이 갑자기 맨 처음 위치로 되돌아가던 문제를 고쳤습니다. 이제 자동 스크롤된 위치가 그대로 유지된 채로 원하는 곳에 놓을 수 있습니다.'}
  ]},
  {ver:'20260908.004', date:'2026년 9월 8일', items:[
    {t:'그리드 컬럼, 헤더를 드래그해서 순서 변경', d:'그리드 헤더의 컬럼 이름 부분을 마우스로 눌러 좌우로 끌면, 속성 패널을 거치지 않고 그 자리에서 바로 컬럼 순서를 바꿀 수 있습니다. 놓일 위치는 초록색 세로선으로 표시됩니다.<br><br>맨 왼쪽의 <b>Row Order·CheckBox</b> 유틸리티 컬럼은 항상 고정이라 드래그 대상이 아니며, 다른 컬럼도 그 앞으로는 옮길 수 없습니다.<br><br><b>수동</b>·<b>자동</b> 모드처럼 가로 스크롤이 있는 그리드에서는, 컬럼을 화면 왼쪽/오른쪽 끝 가장자리로 가져가 잠시 멈추면 그리드가 자동으로 스크롤되어 화면 밖의 위치에도 놓을 수 있습니다.'}
  ]},
  {ver:'20260908.003', date:'2026년 9월 8일', items:[
    {t:'그리드 컬럼 폭 방식: 기본 · 스크롤 · 자동', d:'그리드 속성의 <b>「좌우 스크롤 사용」</b> 체크박스가 라디오 버튼 3가지로 바뀌었습니다.<br><br>① <b>기본</b>(기존 체크 해제와 동일) - 그리드 너비에 맞춰 컬럼 폭이 균등 분할됩니다.<br>② <b>스크롤</b>(기존 체크와 동일) - 「컬럼 폭」 슬라이더로 모든 컬럼을 같은 폭으로 고정하고, 넘치면 가로 스크롤이 나타납니다.<br>③ <b>자동</b>(신규) - 각 컬럼 폭이 글자가 잘리지 않는 가장 작은 크기로 자동 조절되고, 컬럼명을 바꾸면 실시간으로 다시 맞춰집니다. 전체 폭이 넘칠 때만 가로 스크롤이 나타나고, 다시 짧아지면 스크롤이 사라집니다. 이 모드에서는 「컬럼 폭」 슬라이더가 숨겨집니다.<br><br>세 방식 모두 그리드 헤더에서 컬럼 경계선을 직접 드래그해 폭을 자유롭게 바꿀 수 있는 것은 공통입니다. 다만 <b>자동</b> 모드에서 드래그로 조절한 컬럼은 이름을 바꾸는 순간 다시 자동 계산되고, <b>스크롤</b> 모드에서 슬라이더를 움직이면 개별 드래그 조절값이 모두 초기화되고 새 값으로 통일됩니다. 기본값은 <b>기본</b>입니다.'}
  ]},
  {ver:'20260908.002', date:'2026년 9월 8일', items:[
    {t:'그리드 컬럼 폭, 헤더에서 직접 드래그로 조절', d:'그리드 헤더의 각 컬럼 <b>우측 경계선에 마우스를 올리면 초록색 조절선</b>이 나타납니다. 이 선을 좌우로 드래그하면 속성 패널을 거치지 않고 그 컬럼만 원하는 폭으로 즉시 바꿀 수 있습니다.<br><br>병합 헤더(상위헤더로 묶인 컬럼)에서도 각 컬럼을 개별적으로 조절할 수 있고, <b>좌우 스크롤 사용</b>이 꺼진 그리드는 조절한 컬럼만 고정폭이 되고 나머지 컬럼이 남은 공간을 나눠 채웁니다. 켜진 그리드는 컬럼 폭 슬라이더가 정한 값을 컬럼별로 각각 덮어씁니다.'}
  ]},
  {ver:'20260908.001', date:'2026년 9월 8일', items:[
    {t:'다른 브라우저(창·탭)로도 컴포넌트 복사/붙여넣기 가능', d:'① <b>Ctrl+C</b>로 복사하면 브라우저 내부 복사본과 함께 <b>OS 클립보드</b>에도 함께 기록됩니다.<br>② 그 덕분에 같은 브라우저의 다른 탭·창은 물론, <b>다른 브라우저</b>에서 열어둔 목업빌더에도 <b>Ctrl+V</b>로 그대로 붙여넣을 수 있습니다.<br>③ 복사에 성공하면 화면 하단에 <b>"복사됨"</b> 알림이 뜨고, 붙여넣기는 지금까지처럼 알림 없이 조용히 처리됩니다.<br>④ 클립보드 접근이 막혀 있거나 목업빌더가 아닌 다른 텍스트가 복사되어 있는 경우엔, 자동으로 기존 방식(브라우저 내부 복사본)으로 대체되어 항상 붙여넣기가 됩니다.'}
  ]},
  {ver:'20260901.007', date:'2026년 9월 1일', items:[
    {t:'빠른 날짜 팝업에 "빈값" 토글 추가', d:'적용 버튼 왼쪽에 <b>빈값</b> 토글을 추가했습니다. 켜고 적용하면 날짜를 아예 선택하지 않고 비워둔 상태로 저장되며(즐겨찾기 칩·연월일 조합은 비활성화됨), 조회조건 필드·단독 날짜/기간 컴포넌트·그리드 날짜 컬럼 모두 동일하게 동작합니다. 팝업을 다시 열면 빈값이었는지도 토글이 켜진 채로 그대로 복원됩니다. 기간(날짜1)만 비우고 나머지(날짜2)는 값을 유지하는 것도 각각 독립적으로 가능합니다.'}
  ]},
  {ver:'20260901.006', date:'2026년 9월 1일', items:[
    {t:'입력 컴포넌트(날짜·기간)에도 빠른 날짜 팝업 적용', d:'캔버스에 단독으로 놓는 <b>날짜·기간</b> 입력 컴포넌트도 조회조건 필드와 동일한 달력 아이콘·빠른 날짜 팝업을 쓰도록 바꿨습니다. 속성 패널의 텍스트 입력칸은 <b>선택된 값을 보여주는 읽기전용 표시</b>로 바뀌었고, 그 아래에 배치된 📅 버튼(기간은 시작일·종료일 버튼 2개)을 눌러야 값을 바꿀 수 있습니다.'},
    {t:'그리드 컬럼(날짜 타입)에도 기본값 날짜 팝업 추가', d:'그리드 컬럼을 <b>날짜</b> 타입으로 지정하면 삭제(×) 버튼 왼쪽에 📅 아이콘이 나타나며, 클릭하면 같은 빠른 날짜 팝업으로 그 컬럼의 디자인 화면·내보내기 기본값을 정할 수 있습니다. 값을 정하지 않은 날짜 컬럼은 이전처럼 오늘 날짜가 기본으로 채워집니다.'}
  ]},
  {ver:'20260901.005', date:'2026년 9월 1일', items:[
    {t:'빠른 날짜 팝업 "현재 값" 문구 제거, 대신 토글 자체를 이전 선택 상태로 복원', d:'팝업 상단에 텍스트로 표시하던 <b>현재 값</b> 줄을 없앴습니다. 대신 즐겨찾기 칩과 일치하지 않는 값(예: 연도·월·일 조합으로 만든 날짜)도 저장된 값을 역산해서, 다시 열면 <b>연도·월·일 토글이 그때 고른 상태 그대로</b> 펼쳐져서 초록색으로 표시됩니다.'}
  ]},
  {ver:'20260901.004', date:'2026년 9월 1일', items:[
    {t:'빠른 날짜 팝업, 다시 열면 이전에 고른 값을 보여주도록 수정', d:'날짜·기간 아이콘을 눌렀을 때 항상 "오늘"부터 다시 시작하던 문제를 고쳤습니다. 이제 팝업을 다시 열면 상단에 <b>현재 값</b>이 그대로 표시되고, 그 값이 즐겨찾기 칩(오늘/어제/이번달1일/올해1월1일)과 같으면 해당 칩이 초록색으로 선택 표시됩니다. 아이콘에 마우스를 올렸을 때도 툴팁으로 현재 값을 바로 확인할 수 있습니다.'}
  ]},
  {ver:'20260901.003', date:'2026년 9월 1일', items:[
    {t:'조회조건 조건명 입력칸, 날짜·기간 타입도 폭 꽉 차게 수정', d:'날짜·기간 타입일 때 조건명(라벨) 입력칸이 예전 텍스트 입력칸 자리에 맞춰 46px로 좁게 고정되어 있던 걸 없앴습니다. 이제 다른 타입과 똑같이 남는 공간을 모두 채우고, 날짜 아이콘·삭제(×) 버튼은 오른쪽에 고정폭으로 붙어 줄 전체가 꽉 차게 보입니다.'}
  ]},
  {ver:'20260901.002', date:'2026년 9월 1일', items:[
    {t:'조회조건 필수·읽기전용 버튼 위치 원복', d:'날짜 아이콘 도입 과정에서 1번째 줄로 옮겼던 <b>필수(*)·읽기전용(🔒)</b> 버튼을 기존과 동일하게 <b>2번째 줄 우측</b>(타입·칸수 선택 옆)으로 되돌렸습니다. 1번째 줄에는 순서·라벨·날짜 아이콘·삭제(×)만 남습니다.'}
  ]},
  {ver:'20260901.001', date:'2026년 9월 1일', items:[
    {t:'조회조건 날짜·기간 필드, 빠른 날짜 선택 팝업으로 개편', d:'속성 패널에서 <b>YYYY-MM-DD 텍스트 직접입력</b>을 없애고, 📅 아이콘을 눌러 뜨는 <b>빠른 날짜 선택 팝업</b>으로 바꿨습니다. 팝업 상단엔 자주 쓰는 <b>오늘·어제·이번달1일·올해1월1일</b>을 원클릭 칩으로 두고, <b>「직접 조합하기」</b>를 펼치면 연도(작년/올해/내년)·월(전달/이번달/다음달)·일(-7일/어제/오늘/내일) 축을 조합해 원하는 상대 날짜를 만들 수 있습니다. 팝업은 클릭한 아이콘 바로 아래에 붙고, 화면 가장자리에 가까우면 자동으로 위·왼쪽으로 뒤집혀 잘리지 않습니다. <b>기간</b> 타입은 시작일·종료일 아이콘이 각각 있어 따로 선택합니다. 필수(*)·읽기전용(🔒)·삭제(×) 아이콘도 이 줄로 모아 첫 줄만 봐도 한눈에 파악되게 했습니다.'},
    {t:'조회조건 날짜·기간 기본값, 오늘 날짜로 통일', d:'조회조건 필드 타입을 <b>날짜·기간</b>으로 바꾸거나 값을 비워두면, 예전의 예시 텍스트(YYYY-MM-DD, 2026-07-01~2026-07-15) 대신 <b>오늘 날짜</b>가 기본으로 표시됩니다. 목업빌더 캔버스와 내보내기(저장) 결과물 HTML 양쪽 모두 동일하게 적용되며, 팝업에서 고른 날짜도 캔버스·내보내기 결과물에 바로 반영됩니다.'}
  ]},
  {ver:'20260831.010', date:'2026년 8월 31일', items:[
    {t:'컬럼 순서 키보드 단축키 제거, 순서 번호칸 화살표 숨김', d:'조회조건 필드·그리드 컬럼의 <b>Ctrl+↑/↓ 키보드 이동 기능</b>을 제거했습니다(드래그와 순서 번호 입력은 그대로 사용 가능). 순서 번호 입력칸의 브라우저 기본 <b>위/아래 스핀 화살표</b>도 숨겨, 자리를 덜 차지하고 칸이 좁아 보이지 않도록 했습니다.'}
  ]},
  {ver:'20260831.009', date:'2026년 8월 31일', items:[
    {t:'컬럼 순서 키보드 단축키 수정, 헤더 정렬 컨트롤 위치 변경', d:'드래그 손잡이(⠿)를 클릭해도 <b>Ctrl+↑/↓</b> 단축키가 반응하지 않던 문제를 고쳤습니다 - 행이 드래그 가능한 상태라 클릭이 드래그 시작으로 인식돼 선택 자체가 되지 않던 게 원인으로, 이제 누르는 즉시(mousedown) 확실하게 선택되고 드래그도 그대로 됩니다. 그리드 컬럼의 <b>헤더 정렬</b> 버튼은 첫 줄에서 <b>「상위헤더(그룹명)」 입력칸 오른쪽</b>(둘째 줄, 필수·읽기전용 버튼 앞)으로 옮겨 첫 줄이 더 간결해졌습니다.'}
  ]},
  {ver:'20260831.008', date:'2026년 8월 31일', items:[
    {t:'조회조건·그리드 컬럼 순서 변경 - 번호 입력·자동 스크롤·단축키 추가', d:'조회조건 필드와 그리드 컬럼 목록에 <b>순서 번호 입력칸</b>이 새로 생겨, 숫자를 바꾸면 그 위치로 바로 이동하고 나머지는 한 칸씩 자동으로 밀립니다. 드래그로 옮길 때도 목록 <b>위/아래 가장자리에 가까이 가면 자동으로 스크롤</b>되어, 컬럼이 많아 스크롤이 생겨도 원하는 위치까지 쉽게 끌 수 있습니다. 또한 드래그 손잡이(⠿)를 클릭해 행을 선택한 뒤 <b>Ctrl+↑/↓</b>로 한 칸씩 이동하는 단축키도 추가했습니다.'}
  ]},
  {ver:'20260831.007', date:'2026년 8월 31일', items:[
    {t:'Claude 답 붙여넣기, Row Order·CheckBox 값 누락 수정', d:'프롬프트는 「rowOrderCol」·「checkboxCol」을 올바르게 채워 줬는데도, <b>「Claude의 답 붙여넣기」로 화면을 그릴 때 이 두 값이 무시되던 문제</b>를 고쳤습니다. 붙여넣기 처리 시 허용 속성 목록에 두 값이 빠져 있던 게 원인으로, 이제 붙여넣은 JSON의 「rowOrderCol:false」·「checkboxCol:false」가 그대로 반영됩니다.'}
  ]},
  {ver:'20260831.006', date:'2026년 8월 31일', items:[
    {t:'이미지 변환 「질문만 복사」 프롬프트, CheckBox 인식 규칙 강화 (씬모드)', d:'Row Order 아이콘은 있지만 CheckBox가 없는 그리드에서 「checkboxCol」이 여전히 누락되던 문제를 고쳤습니다. <b>「모든 grid마다 rowOrderCol·checkboxCol을 예외 없이 명시」</b>하도록 강제하고, <b>「아이콘 컬럼 바로 오른쪽 칸을 확인해 체크박스가 없으면 곧바로 다음 데이터 컬럼 헤더가 시작된다」</b>는 판단 기준을 단계별로 구체화했습니다. <b>「Claude 열기」(URL)</b> 프롬프트는 이번에도 그대로 유지했습니다.'}
  ]},
  {ver:'20260831.005', date:'2026년 8월 31일', items:[
    {t:'이미지 변환 「질문만 복사」 프롬프트, 버튼 없는 그리드 툴바·CheckBox 인식 보강 (씬모드)', d:'그리드에 <b>제목만 있고 행추가 등 버튼이 하나도 없는 경우</b> 「showToolbar」를 false로 잘못 채워 제목까지 사라지던 문제를 고쳤습니다-이제 버튼이 없어도 제목이 보이면 <b>showToolbar는 true로 유지</b>하고 버튼만 false로 채웁니다. 또한 <b>Row Order는 있지만 CheckBox는 없는</b> 그리드 예시를 추가해 두 옵션을 혼합으로 인식하는 경우도 정확히 채워지도록 보강했습니다. <b>「Claude 열기」(URL)</b> 프롬프트는 이번에도 그대로 유지했습니다.'}
  ]},
  {ver:'20260831.004', date:'2026년 8월 31일', items:[
    {t:'이미지 변환 「질문만 복사」 프롬프트, Row Order·CheckBox 인식 추가 (씬모드)', d:'씬모드 이미지→JSON 변환의 <b>「질문만 복사」</b> 프롬프트에 그리드 왼쪽의 <b>Row Order(설정·필터·고정 아이콘) 컬럼</b>과 <b>CheckBox 컬럼</b>을 인식하는 규칙을 추가했습니다. 캡처 화면에 두 컬럼이 있으면 <b>「rowOrderCol」·「checkboxCol」</b>을 true로, 없으면 false로 채워 원본과 동일한 모습으로 변환됩니다. <b>「Claude 열기」(URL)</b> 프롬프트는 이번에도 그대로 유지했습니다.'}
  ]},
  {ver:'20260831.003', date:'2026년 8월 31일', items:[
    {t:'그리드 Row Order 번호 색상 조정', d:'Row Order 컬럼의 순번 색상이 참조 화면보다 지나치게 밝은 파란색이었던 것을, 화면 제목 등에 쓰이는 <b>진한 네이비 색상</b>으로 바꿔 실제 화면과 동일한 톤이 되도록 했습니다.'}
  ]},
  {ver:'20260831.002', date:'2026년 8월 31일', items:[
    {t:'그리드 Row Order 아이콘·CheckBox 헤더 표시 수정', d:'Row Order 헤더의 설정·필터·고정 아이콘이 일부 환경에서 깨져 보이던 문제를 아이콘 폰트 대신 <b>SVG 아이콘</b>으로 바꿔 고쳤습니다. CheckBox 컬럼의 <b>헤더에 체크박스가 보이지 않던</b> 문제도 함께 고쳤고, Row Order 사용 시 헤더 높이가 두꺼워지던 문제도 해결해 다른 컬럼과 동일한 높이를 유지합니다.'}
  ]},
  {ver:'20260831.001', date:'2026년 8월 31일', items:[
    {t:'그리드 Row Order·CheckBox 컬럼 지원', d:'그리드 속성창의 <b>「Pagination 사용」</b> 아래에 <b>「Row Order 사용」·「CheckBox 사용」</b> 옵션이 새로 생겼습니다(기본값 <b>켜짐</b>). 켜면 그리드 맨 왼쪽에 순번 컬럼(헤더는 설정·필터·고정 아이콘, 데이터 행에는 <b>표시 행 수</b> 만큼 1부터 번호)과 선택용 체크박스 컬럼이 추가됩니다. <b>씬모드 전용</b> 기능으로, 팻모드에서는 이 옵션과 두 컬럼이 표시되지 않습니다.'}
  ]},
  {ver:'20260830.007', date:'2026년 8월 30일', items:[
    {t:'조회조건 필드 삭제버튼, 첫 줄 우측 끝으로 위치 통일', d:'날짜·기간 필드만 삭제(×) 버튼이 2번째 줄에 있어 다른 필드와 위치가 달랐던 것을 다시 첫 줄 맨 오른쪽으로 옮겨 모든 타입이 같은 위치를 쓰도록 통일했습니다.'}
  ]},
  {ver:'20260830.006', date:'2026년 8월 30일', items:[
    {t:'조회조건 날짜·기간 값 입력칸, 다시 2줄 레이아웃으로', d:'날짜·기간 필드가 콤보/라디오처럼 3줄이 되는게 어색해서, 값 입력칸을 다시 라벨 옆 1번째 줄로 되돌렸습니다. 대신 그 줄의 삭제(×) 버튼을 2번째 줄로 옮기고 라벨 칸을 좁혀 값 입력칸이 넓어지도록 해서, 2줄을 유지하면서도 값이 잘리지 않게 했습니다.'}
  ]},
  {ver:'20260830.005', date:'2026년 8월 30일', items:[
    {t:'조회조건 기간 값 입력칸 잘림 재수정', d:'라벨 옆 칸을 좁히는 방식으로는 여전히 잘려서, 콤보/라디오의 옵션 입력칸처럼 <b>라벨 아래 별도 줄</b>에 전체 폭으로 표시되도록 구조를 바꿨습니다. 이제 "YYYY-MM-DD ~ YYYY-MM-DD"가 잘리지 않고 다 보입니다.'}
  ]},
  {ver:'20260830.004', date:'2026년 8월 30일', items:[
    {t:'조회조건 기간 값 입력칸 잘림 수정', d:'조회조건 필드가 <b>기간</b>일 때 속성 패널의 날짜 값 입력칸(YYYY-MM-DD ~ YYYY-MM-DD)이 라벨 입력칸에 밀려 잘려 보이던 문제를 고쳤습니다. 라벨 입력칸 폭을 줄이고 값 입력칸 폭을 넓혀 전체 텍스트가 보이도록 했습니다.'}
  ]},
  {ver:'20260830.003', date:'2026년 8월 30일', items:[
    {t:'조회조건 날짜·기간 필드, 화면에 표시할 값을 직접 입력 (씬모드)', d:'조회조건 필드 타입이 <b>날짜</b>·<b>기간</b>일 때 라벨 옆에 값 입력칸이 나타나 화면에 보여줄 날짜(기간은 <b>YYYY-MM-DD ~ YYYY-MM-DD</b> 형식)를 직접 지정할 수 있습니다. 비워두면 기존처럼 기본값이 표시됩니다.'}
  ]},
  {ver:'20260830.002', date:'2026년 8월 30일', items:[
    {t:'이미지 변환 「질문만 복사」 프롬프트, ½칸 인식 추가 (씬모드)', d:'씬모드 이미지→JSON 변환의 <b>「질문만 복사」</b> 프롬프트에 조회조건 한 칸 안에 컨트롤 2개가 나란히 붙은 경우(요청조직/구매조직, 공장/창고 등)를 인식해 <b>½칸(span:0.5)</b> 필드 2개로 쪼개 출력하는 규칙을 추가했습니다. 라벨이 하나로 합쳐져 보이면 "/"·공백 기준으로 나눠 각 필드에 담습니다. <b>「Claude 열기」(URL)</b> 프롬프트는 URL 길이 제한 때문에 그대로 유지했습니다.'}
  ]},
  {ver:'20260830.001', date:'2026년 8월 30일', items:[
    {t:'조회조건 필드 가로 폭에 「½칸」 추가 (씬모드)', d:'조회조건(searchbar) 필드의 가로 폭 목록에 <b>½칸</b>이 추가되었습니다. ½칸 필드가 <b>바로 옆에 다른 ½칸 필드와 붙어 있으면</b> 한 칸을 반반씩 나눠 써서 요청조직/구매조직, 공장/창고처럼 한 줄에 나란히 표시되고, <b>붙어 있는 ½칸이 없으면</b> 그 필드 혼자 한 칸의 절반만 채우고 나머지 절반은 빈 채로 남아 뒤 필드가 그 자리로 밀려오지 않습니다.'}
  ]},
  {ver:'20260828.002', date:'2026년 8월 28일', items:[
    {t:'그리드 컬럼 유형에 「검색」 추가', d:'그리드를 선택하면 속성창의 <b>「컬럼」</b> 목록에서 각 컬럼 유형을 <b>첨부파일</b> 아래 <b>검색</b>으로도 지정할 수 있습니다. 지정한 컬럼은 <b>조회조건 패널의 검색 필드</b>와 동일한 돋보기 아이콘이 입력칸 우측에 표시되며, 읽기전용으로 설정하면 아이콘도 함께 흐리게 표시됩니다. 씬모드·팻모드 공통 기능입니다.'}
  ]},
  {ver:'20260826.001', date:'2026년 8월 26일', items:[
    {t:'그리드 컬럼 헤더 텍스트 정렬 기능 추가', d:'그리드를 선택하면 속성창의 <b>「컬럼」</b> 목록 각 행에 정렬 아이콘(왼쪽·가운데·오른쪽)이 새로 생겨, 컬럼별로 헤더 텍스트 정렬을 지정할 수 있습니다.'},
    {t:'그리드 컬럼 필수 기능 추가', d:'각 컬럼의 <b>*</b> 버튼을 켜면 헤더 라벨 앞에 빨간 <b>*</b>가 표시되고, 해당 컬럼의 데이터 행 전체가 옅은 크림색 배경으로 표시됩니다. 조회조건 패널의 필수 표시와 같은 방식입니다.'},
    {t:'그리드 컬럼 읽기전용 기능 추가', d:'각 컬럼의 <b>🔒</b> 버튼을 켜면 해당 컬럼의 데이터 행 전체가 회색 배경으로 바뀌고 입력이 잠깁니다. 색상은 <b>조회조건 패널의 읽기전용</b>과 동일하게 통일했습니다. 필수·읽기전용을 동시에 켜면 읽기전용이 우선 적용됩니다.'},
    {t:'속성 패널 기본 폭 확대', d:'컬럼별 정렬·필수·읽기전용 컨트롤이 늘어난 만큼 속성 패널 기본 폭을 <b>324px</b>로 넓혀 더 여유 있게 표시되도록 했습니다 (드래그로 조절 가능한 범위는 기존과 동일).'}
  ]},
  {ver:'20260825.003', date:'2026년 8월 25일', items:[
    {t:'「질문만 복사」 프롬프트, 「Claude 열기」와 완전히 독립된 텍스트로 분리', d:'씬모드·팻모드 각각의 <b>「질문만 복사」</b> 프롬프트를 <b>「Claude 열기」(URL)</b> 프롬프트와 별개의 문장으로 만들었습니다. 이제 「질문만 복사」쪽 내용을 아무리 길게 늘려도 「Claude 열기」의 URL 길이에는 <b>전혀 영향을 주지 않습니다.</b>'}
  ]},
  {ver:'20260825.002', date:'2026년 8월 25일', items:[
    {t:'이미지 변환 프롬프트, 「Claude 열기」·「질문만 복사」 분리 (씬모드)', d:'지금까지 하나로 쓰던 변환 프롬프트를 <b>「Claude 열기」(URL 전달)</b>용과 <b>「질문만 복사」</b>(클립보드)용으로 분리했습니다. URL 전달은 한글 인코딩 팽창으로 길이 제한에 걸리기 쉬워 계속 짧게 유지하고, <b>「질문만 복사」</b>는 길이 제한이 없어 앞으로 더 상세한 지시문으로 확장할 수 있습니다. <b>「Claude에 보내는 질문 미리 보기」</b>에는 항상 「질문만 복사」쪽 프롬프트가 표시됩니다.'},
    {t:'「질문만 복사」 버튼 강조 및 안내 문구 추가', d:'「질문만 복사」 버튼을 <b>초록색 강조 스타일</b>과 <b>「권장」</b> 배지로 눈에 더 잘 띄게 바꿨습니다. 버튼과 질문 미리 보기 사이에는 <b>직접 붙여넣으면 더 상세한 요청이 가능해 결과 품질이 좋아진다</b>는 짧은 안내 문구를 추가했습니다.'}
  ]},
  {ver:'20260825.001', date:'2026년 8월 25일', items:[
    {t:'조회조건 필드 타입에 「빈값」 추가 (씬모드)', d:'조회조건(searchbar) 컴포넌트의 필드 타입 목록에 <b>기간·검색·라디오</b> 다음으로 <b>「빈값」</b>이 추가되었습니다. 필드 타입을 빈값으로 지정하면 라벨과 입력칸 없이 <b>해당 칸이 비워진 채로</b> 자리만 차지해, 여러 칸짜리 레이아웃에서 <b>특정 칸만 건너뛰고</b> 싶을 때 사용할 수 있습니다. 씬모드 전용 기능입니다.'}
  ]},
  {ver:'20260819.001', date:'2026년 8월 19일', items:[
    {t:'이미지 변환(씬모드) 프롬프트 길이 추가 축소', d:'변환 품질은 그대로 유지하면서 <b>씬모드</b> 프롬프트에서 다른 예시와 뜻이 겹치던 라벨 예시 1개를 정리하고, 구형화면 예시의 부가 설명을 간결하게 다듬어 글자 수를 더 줄였습니다. Claude에 붙여넣는 텍스트가 짧아져 전송·응답이 더 가벼워집니다.'}
  ]},
  {ver:'20260818.002', date:'2026년 8월 18일', items:[
    {t:'그리드 Pagination 위치 조정 및 씬모드 전용화', d:'Pagination의 <b>«  ‹  1  ›  »</b> 페이지 버튼이 그리드 하단 <b>정가운데</b>에 오도록 위치를 조정했습니다(Show rows·Go to·전체 건수는 그대로 오른쪽에 표시). 또한 Pagination 기능은 <b>씬모드 전용</b>으로 바뀌어, <b>팻모드</b>에서는 속성창의 「Pagination 사용」 옵션 자체와 하단 UI가 모두 표시되지 않습니다.'}
  ]},
  {ver:'20260818.001', date:'2026년 8월 18일', items:[
    {t:'그리드 Pagination(페이지네이션) 지원', d:'그리드를 선택하면 속성창의 <b>「좌우 스크롤 사용」</b> 체크박스 아래에 <b>「Pagination 사용」</b> 옵션이 새로 생겼습니다. 켜면 그리드 하단에 <b>페이지 번호·Show rows·Go to·전체 건수</b>로 구성된 페이지 이동 UI가 표시됩니다. 목업이므로 실제 페이지 이동은 되지 않고 항상 1페이지만 보이며, 건수는 <b>표시 행 수</b> 값을 그대로 보여줍니다. 기본값은 <b>꺼짐</b>이라 기존에 저장해둔 목업에는 영향이 없습니다.'}
  ]},
  {ver:'20260814.001', date:'2026년 8월 14일', items:[
    {t:'이미지 변환 팝업 높이 축소 (스크롤 제거)', d:'이미지 변환 팝업이 길어서 생기던 세로 스크롤을 줄였습니다. <b>2번 단계</b>의 그리드 여러 장 캡처 안내는 <b>「그리드 컬럼이 많을 때」 접기</b>로 넣어 필요할 때만 펼쳐 보도록 했고, 하단의 라벨 관련 안내 박스는 삭제했습니다. 이제 대부분의 화면에서 <b>하단 버튼까지 스크롤 없이</b> 한눈에 보입니다.'},
    {t:'사용 동의 안내 문구 추가', d:'우측 <b>속성 안내 패널</b>(컴포넌트를 선택하지 않았을 때 보이는 영역) 하단에 <b>「사용 안내」</b> 문구를 추가했습니다. 본 프로그램은 <b>인가된 업무 목적</b>으로만 사용할 수 있으며, <b>목적 외 사용·데이터의 외부 유출 및 무단 배포</b>를 금지합니다. 원활한 운영과 보안을 위해 <b>접속 정보(IP, 사용자명 등)가 기록</b>될 수 있고, 사용에 따른 <b>모든 책임은 사용자 본인</b>에게 있음을 안내합니다.'}
  ]},
  {ver:'20260811.001', date:'2026년 8월 11일', items:[
    {t:'이미지 변환, 탭(세그먼트 버튼) 화면 지원', d:'화면 캡처에 <b>"잔액|원장"처럼 나란히 붙은 탭</b>이 있으면(겉모양이 버튼이어도) 이제 이를 인식해 <b>tabs 컴포넌트</b>로 변환합니다. 캡처 이미지를 <b>탭 개수만큼 여러 장</b> 첨부하면(예: 잔액탭 캡처 1장 + 원장탭 캡처 1장) 하나의 tabs 안에 각 탭 내용이 알맞게 나뉘어 배치됩니다. <b>씬모드·팻모드 둘 다</b> 지원합니다.'},
    {t:'이미지 변환, 조회조건 겹침 방지', d:'조회조건(검색 필드) 개수가 많아 실제 높이가 커지는 화면을 변환할 때, 이제 그 아래에 있는 탭·차트·그리드·버튼 등 <b>모든 컴포넌트를 늘어난 높이만큼 함께 내려 배치</b>해 겹치지 않도록 했습니다.'},
    {t:'이미지 변환, 상단 여백 자동 보정', d:'타이틀·탭 바로 아래에 조회조건이 <b>붙어서</b> 나오도록 배치 규칙을 보강했습니다. 원본 화면에서 브레드크럼·아이콘·"조회조건 접기" 버튼 등이 차지하던 자리를 더 이상 빈 공간으로 남기지 않아, 탭과 조회조건 사이에 불필요하게 넓은 간격이 생기던 문제를 없앴습니다.'},
    {t:'이미지 변환, 우측상단 접기 버튼 제외', d:'화면 우측상단의 <b>"조회조건 접기/펼치기"</b> 버튼은 고정 UI이므로 변환 결과에 더 이상 포함되지 않습니다.'},
    {t:'탭 이름 전체 삭제 시 탭이 사라지던 문제 수정', d:'탭 컴포넌트에서 이름을 전부 지우고 새로 입력하려 하면 그 탭 자체가 사라지던 문제를 고쳤습니다. 이름 칸이 비어 있어도 <b>탭 자리는 그대로 유지</b>되어, 안에 배치해둔 컴포넌트도 잃지 않습니다.'},
    {t:'이미지 변환 프롬프트 길이 재최적화', d:'변환 품질은 그대로 유지하면서 씬모드·팻모드 프롬프트 문장을 더 간결하게 다듬어 글자 수를 추가로 줄였습니다.'}
  ]},
  {ver:'20260810.002', date:'2026년 8월 10일', items:[
    {t:'속성 패널 좌우 폭 조절', d:'컴포넌트를 선택하면 나오는 <b>오른쪽 속성 편집 패널</b>과 캔버스 사이에 <b>드래그 스플리터</b>가 생겼습니다. 경계선을 좌우로 끌면 속성 패널 폭을 <b>180~560px</b> 사이에서 원하는 대로 넓히거나 좁힐 수 있고, 조절한 폭은 <b>자동 저장</b>되어 다음에 열 때도 유지됩니다. 스플리터를 <b>더블클릭</b>하면 기본 폭(240px)으로 돌아갑니다. (PC 모드 전용, 태블릿·모바일 모드에서는 표시되지 않습니다.)'},
    {t:'필수+읽기전용 동시 지정 처리', d:'한 컴포넌트에 <b>필수 항목</b>과 <b>읽기전용</b>을 함께 켤 수 있게 되었습니다. <b>씬모드</b>에서는 둘을 같이 켜면 <b>필수(*) 표시와 읽기전용(회색·수정 불가)</b>이 함께 적용되고, <b>팻모드</b>에서는 <b>읽기전용만</b> 적용됩니다. 텍스트박스·콤보박스·날짜·팝업·기간 컴포넌트에 동일하게 반영되며, 저장(내보내기) 결과물에도 그대로 적용됩니다.'}
  ]},
  {ver:'20260807.001', date:'2026년 8월 7일', items:[
    {t:'그리드 헤더 병합(그룹 헤더) 지원', d:'그리드를 선택하면 속성창의 <b>「컬럼」</b> 목록에서 각 컬럼마다 <b>상위헤더(그룹명)</b> 칸이 새로 생겼습니다. 연속된 컬럼에 같은 그룹명을 입력하면 헤더 위쪽에 그 이름이 하나로 병합되어 표시되고, 아래 줄에는 각 컬럼명이 그대로 남습니다. 그룹을 지정하지 않은 컬럼은 예전처럼 헤더 전체 높이를 그대로 차지해, 그룹·비그룹 컬럼이 섞여도 높이가 항상 맞습니다. <b>좌우 스크롤 그리드</b>와 <b>저장(내보내기) 결과물</b>에도 동일하게 반영됩니다.'},
    {t:'이미지 변환도 병합 헤더 인식', d:'화면 캡처에 기준정보·재고정보처럼 <b>2줄로 병합된 헤더</b>가 있는 그리드가 있으면, 이를 인식해 컬럼별 그룹 정보까지 함께 뽑아내도록 변환 프롬프트를 보강했습니다. Claude의 답을 붙여넣으면 캡처된 병합 헤더 구조가 그대로 재현됩니다. <b>씬모드·팻모드 둘 다</b> 적용했습니다.'}
  ]},
  {ver:'20260806.002', date:'2026년 8월 6일', items:[
    {t:'이미지 변환에 차트 지원 추가', d:'화면 캡처를 JSON으로 변환할 때(Claude 열기/프롬프트 복사) <b>도넛·막대·꺾은선·영역 차트</b>가 있는 화면도 <b>chart 컴포넌트</b>로 인식해 변환하도록 프롬프트를 보강했습니다. 카드형 대시보드(브레드크럼+카드 여러 개가 나란한 화면)도 카드 위치를 유지한 채 chart/grid로 매핑합니다. <b>씬모드·팻모드 둘 다</b> 반영했습니다.'},
    {t:'이미지 변환 프롬프트 길이 축소', d:'같은 변환 품질을 유지하면서 씬모드·팻모드 프롬프트의 문장을 더 간결하게 다듬어 전체 글자 수를 줄였습니다. Claude에 붙여넣는 텍스트가 짧아져 전송·응답이 더 가벼워집니다.'}
  ]},
  {ver:'20260806.001', date:'2026년 8월 6일', items:[
    {t:'그리드 컬럼 유형에 첨부파일 추가', d:'그리드를 선택하면 속성창의 <b>「컬럼」</b> 목록에서 각 컬럼 유형을 텍스트박스·콤보박스·날짜·체크박스 외에 <b>첨부파일</b>로도 지정할 수 있습니다. 지정한 컬럼의 각 행에는 <b>회색 구름 모양의 업로드 아이콘</b>이 표시되며, 클릭 동작 없는 <b>읽기전용</b> 표시로 동작합니다.'}
  ]},
  {ver:'20260805.001', date:'2026년 8월 5일', items:[
    {t:'그리드 여러 장 캡처 자동 병합', d:'이미지 변환 시 <b>컬럼이 많아 가로 스크롤이 생기는 그리드</b>를 <b>여러 장으로 나눠 캡처</b>해 첨부하면, 이제 <b>하나의 그리드로 자동으로 이어 붙여</b> 줍니다. 캡처할 때 <b>컬럼을 최소 1개씩 겹쳐서</b> 찍으면, 겹친 컬럼은 알아서 한 번만 남기고 순서대로 병합합니다. <b>Thin·Fat 두 모드</b> 모두 지원합니다.'},
    {t:'이미지 변환 창 안내 보강', d:'변환 2단계 안내에 <b>컬럼이 많은 그리드를 겹쳐가며 나눠 찍는 방법</b>을 설명하는 안내를 추가했습니다.'},
    {t:'이미지 변환 창 스크롤 제거', d:'「Claude의 답 붙여넣기」 칸의 기본 높이를 줄여, <b>Claude 열기·질문 복사</b>를 눌러도 이미지 변환 창에 <b>불필요한 스크롤이 생기지 않도록</b> 했습니다. 붙여넣기 칸은 필요할 때 아래 모서리를 끌어 늘릴 수 있습니다.'}
  ]},
  {ver:'20260731.001', date:'2026년 7월 31일', items:[
    {t:'멀티 선택 정렬 영역 제한', d:'여러 컴포넌트를 선택해 <b>수평·수직 정렬</b>을 실행하면, 이제 정렬 범위가 캔버스 전체가 아니라 <b>선택한 컴포넌트들이 차지하던 영역까지만</b> 적용됩니다. 선택하지 않은 다른 컴포넌트가 같은 줄·같은 칸에 있으면 그 앞에서 멈춰서 침범하지 않습니다.'},
    {t:'정렬·간격 조절 격자 정합성 수정', d:'행·열에 크기가 다른 컴포넌트가 섞여 있을 때, <b>수평/수직 정렬</b>과 <b>가로·세로 간격 슬라이더</b>를 쓰면 특정 칸만 밀려서 표(격자)가 흐트러지던 문제를 고쳤습니다. 이제 실제 좌표가 가까운 컴포넌트끼리 같은 열·행으로 인식해, 칸 크기가 제각각이어도 열은 열끼리·행은 행끼리 항상 나란히 맞춰집니다.'},
    {t:'정렬 기능, 입력 컴포넌트만 지원', d:'멀티 선택 시 <b>수평·수직·스마트 정렬</b>과 <b>간격 슬라이더</b>는 선택한 컴포넌트가 모두 <b>입력 컴포넌트</b>(라벨·텍스트박스·콤보박스·날짜·기간·체크박스·라디오·팝업)일 때만 표시됩니다. 그리드·차트·트리·버튼·패널 등 다른 종류가 하나라도 섞여 선택되면 정렬 관련 UI는 숨겨지고 안내 문구가 대신 표시됩니다.'}
  ]},
  {ver:'20260729.001', date:'2026년 7월 29일', items:[
    {t:'스플릿 컨테이너 중첩 시 Fill 버그 수정', d:'스플릿 컨테이너 안에 또 다른 스플릿 컨테이너를 넣어 화면을 4분할 이상으로 나눈 경우, <b>저장·미리보기 화면에서 바깥쪽 구분선을 옮기면</b> 안쪽 스플릿의 그리드가 따라오지 않던 문제를 고쳤습니다. 이제 몇 겹으로 중첩하든 구분선을 옮기면 <b>안쪽 Fill 컴포넌트까지 전부 크기가 같이 조절</b>됩니다.'},
    {t:'모드 전환 아이콘 추가', d:'상단 타이틀과 사용자 가이드 사이에 <b>모드 전환 아이콘</b>이 새로 생겼습니다. 타이틀을 누르는 것과 동일하게, 누르면 Thin Mode ↔ Fat Mode 선택 팝업이 뜹니다.'},
    {t:'상단 아이콘 톤앤매너 통일', d:'모드 전환·사용자 가이드·화면 둘러보기 아이콘 3개를 <b>같은 크기의 흰색 라운드 박스</b>로 통일해, 초록(Thin)·남색(Fat) 상단바 어디서든 잘 보이도록 했습니다.'},
    {t:'사용자 가이드·둘러보기 아이콘 교체', d:'이모지 대신 <b>펼쳐진 책</b>(사용자 가이드), <b>지도 핀</b>(화면 둘러보기) 모양의 심플한 아이콘으로 바꿔, 작게 표시돼도 의미가 잘 읽히도록 했습니다.'}
  ]},
  {ver:'20260728.001', date:'2026년 7월 28일', items:[
    {t:'Fat Mode 추가', d:'상단 왼쪽 <b>타이틀(로고)</b>을 누르면 <b>Thin Mode</b>와 <b>Fat Mode</b> 중 고르는 팝업이 뜹니다. 좌/우 미리보기 카드를 눌러 바로 전환할 수 있고, 전환하면 캔버스가 초기화되니 먼저 저장해두세요. 파일에 저장한 모드 정보를 <b>불러오기 때도 그대로 기억</b>합니다(옛날 파일은 Thin Mode로 열립니다).'},
    {t:'Fat Mode 전용 스타일', d:'라벨이 입력칸 왼쪽에 붙고 아래 밑줄이 생기며, 캔버스·상단바 색감이 바뀝니다. 조회조건 패널 대신 <b>패널(그룹박스)+개별 입력</b> 조합을 쓰고, 그리드 상단 툴바와 필수(*) 표시는 화면에 나타나지 않습니다.'},
    {t:'팝업 컴포넌트', d:'Fat Mode 도구상자에 새로 추가된 컴포넌트입니다. <b>라벨+텍스트박스(코드)+아이콘+텍스트박스(명칭)</b> 구조로, 코드값을 입력하면 옆에 명칭이 표시되는 조회 필드를 한 번에 만듭니다.'},
    {t:'패널에 컴포넌트 넣기', d:'패널(그룹박스) 위에 다른 컴포넌트를 놓으면 <b>자식으로 연결</b>되어, 탭·스플릿처럼 패널을 옮기면 안의 컴포넌트도 함께 움직이고, 삭제·복사도 같이 됩니다.'},
    {t:'이미지 변환도 모드별로', d:'이미지 변환 기능이 지금 켜져 있는 모드(Thin/Fat)에 맞는 프롬프트를 자동으로 씁니다. 변환 결과를 캔버스에 배치한 뒤에는 <b>컴포넌트 범위에 맞춰 캔버스 크기가 자동으로 늘어나거나 줄어듭니다</b>.'},
    {t:'투어·가이드 개편', d:'화면 둘러보기 3번째 단계에 <b>모드 전환 안내</b>가 추가됐고, 사용자 가이드에도 Fat Mode 설명이 반영됐습니다. 둘러보기 카드는 <b>단어가 중간에 끊기지 않도록</b> 고치고, 내용 길이에 맞춰 <b>폭이 자동으로 조절</b>되며 진행률 바가 추가됐습니다.'},
    {t:'모바일·태블릿도 동일하게', d:'팝업 컴포넌트·조회조건 숨김·템플릿 버튼 숨김 등 Fat Mode 관련 변경이 모바일·태블릿 화면에도 PC와 동일하게 반영됩니다.'}
  ]},
  {ver:'20260727.005', date:'2026년 7월 27일', items:[
    {t:'패치 내역 날짜별 묶음', d:'업데이트 안내를 <b>날짜별로 묶어서</b> 보여줍니다. 같은 날 여러 번 배포된 빌드(예: 20260727 의 001~004)가 <b>하나의 날짜 아래</b> 모여 나오고, 그 안에서 <b>ver.001·002·003…</b> 영역은 각각 구분되어 표시됩니다.'}
  ]},
  {ver:'20260727.004', date:'2026년 7월 27일', items:[
    {t:'편집 중 그리드 좌우 스크롤', d:'컬럼이 많아 가로 스크롤이 생긴 그리드를, <b>편집(캔버스) 상태에서도 직접 스크롤</b>할 수 있습니다. 그리드 위에서 <b>마우스 휠</b>을 굴리면 좌우로 스크롤되고, 그리드 하단의 <b>가로 스크롤바를 드래그</b>해도 컴포넌트가 움직이지 않고 스크롤만 됩니다. 가려져 있던 오른쪽 컬럼을 확인하며 편집하기 편해졌습니다.'}
  ]},
  {ver:'20260727.003', date:'2026년 7월 27일', items:[
    {t:'모바일·태블릿 미리보기 이벤트 동작', d:'모바일·태블릿의 <b>▶ 미리보기</b>가 이제 데스크톱 미리보기·저장 파일과 <b>동일하게 컴포넌트 이벤트가 실제로 동작</b>합니다. 예전에는 편집 화면을 그대로 보여줘서 콤보박스·탭·체크박스 등이 눌리지 않았는데, 이제 저장본과 같은 인터랙티브 화면을 전체 화면으로 띄웁니다.'}
  ]},
  {ver:'20260727.002', date:'2026년 7월 27일', items:[
    {t:'미리보기 버튼 추가', d:'상단 <b>저장</b> 버튼 오른쪽에 <b>👁 미리보기</b> 버튼이 생겼습니다. 누르면 저장 파일과 <b>똑같이 이벤트가 동작하는 화면</b>이 새 탭에서 열립니다. 콤보박스 펼치기, 탭 전환, 체크박스·라디오 선택, 트리 접기/펼치기, 스플릿 구분선 드래그가 모두 실제처럼 동작해, 저장하지 않고도 완성된 모습을 확인할 수 있습니다.'},
    {t:'도구 드래그 미리보기', d:'도구상자에서 컴포넌트를 끌어올 때, 캔버스 위에 <b>실제 크기의 미리보기</b>가 커서를 따라다닙니다. 놓으면 미리보기가 있던 <b>커서 위치를 중심으로</b> 컴포넌트가 생성됩니다.'}
  ]},
  {ver:'20260727.001', date:'2026년 7월 27일', items:[
    {t:'이미지 변환 화면 새 단장', d:'화면 캡처를 컴포넌트로 바꾸는 기능을 <b>처음 쓰는 사람도 따라 하기 쉽게</b> 다시 만들었습니다. <b>① Claude 열기 → ② 캡처 이미지 붙이고 전송 → ③ 답을 붙여넣기</b>의 <b>3단계 카드</b>로 흐름이 한눈에 보이고, 진행 중인 단계가 초록색으로 강조됩니다. 어려운 용어(JSON 등)는 <b>「코드」·「Claude의 답」</b>처럼 쉬운 말로 바꿨습니다.'},
    {t:'친절한 실패 안내', d:'붙여넣기가 잘못되면 원인에 따라 <b>무엇을 어떻게 고치면 되는지</b> 안내합니다. 예를 들어 답이 잘려 붙었을 때 「[ 부터 ] 까지 빠짐없이 복사했는지 확인해 주세요」처럼 다음 행동을 알려줍니다. 성공하면 <b>배치된 컴포넌트 개수</b>를 함께 보여줍니다.'},
    {t:'변환 오류 수정', d:'정상적인 코드를 붙여넣어도 <b>「화면으로 바꾸지 못했어요」</b> 오류가 나던 문제를 해결했습니다. 이제 붙여넣은 내용이 캔버스에 정상적으로 배치됩니다.'}
  ]},
  {ver:'20260726.006', date:'2026년 7월 26일', items:[
    {t:'방향키로 이동', d:'컴포넌트를 선택한 뒤 <b>방향키(↑↓←→)</b>를 누르면 <b>격자 한 칸씩</b> 이동합니다. 이동 거리는 우측 상단 <b>스냅 크기</b> 값을 따릅니다. 여러 개를 선택하면 함께 움직이고, 탭 안의 컴포넌트도 같이 이동합니다.'},
    {t:'항목 추가 단축키 (+ / −)', d:'<b>탭·조회조건·콤보박스·라디오·그리드</b>를 선택한 상태에서 <b>+</b> 키로 항목(탭·조건·옵션·컬럼)을 하나 추가하고, <b>−</b> 키로 맨 뒤 항목을 하나 삭제할 수 있습니다.'},
    {t:'항목 추가 버튼 방식', d:'<b>탭·콤보박스·라디오</b>의 항목을 조회조건·그리드처럼 <b>「＋ 추가」 버튼</b>으로 하나씩 추가하고, 각 칸에서 이름을 편집하거나 ⠿ 핸들로 순서를 바꿀 수 있습니다.'},
    {t:'모바일 속성 버튼 토글', d:'모바일·태블릿 하단의 <b>속성</b> 버튼을 다시 누르면 열린 속성창이 <b>닫기(✕)</b>를 누른 것처럼 닫힙니다.'},
    {t:'PC 미니맵', d:'PC 화면에도 <b>미니맵</b>이 추가되었습니다. 상단 툴바 줌 오른쪽의 <b>「미니맵」 체크박스</b>로 켜고 끌 수 있으며(기본은 꺼짐), 켜면 캔버스 우상단에 표시됩니다. 미니맵 본문을 <b>클릭·드래그</b>하면 해당 위치로 화면이 이동하고, ⠿ 손잡이로 미니맵 위치를 옮기거나 ◱ 버튼으로 접을 수 있습니다.'}
  ]},
  {ver:'20260726.005', date:'2026년 7월 26일', items:[
    {t:'화면 모드 강제 전환', d:'PC·태블릿·모바일 화면을 <b>직접 골라 전환</b>할 수 있습니다. <b>PC 모드</b>에서는 좌측 하단(버전 표기 위)에 아이콘 3개가, <b>모바일·태블릿 모드</b>에서는 상단 <b>☰ 메뉴</b> 맨 아래 「화면 모드」에서 전환합니다. 현재 모드는 아이콘이 <b>초록색으로 채워져</b> 표시되고, 마우스를 올리면 이름이 나타납니다. 자동 감지 결과와 다르게 강제로 특정 화면을 확인하고 싶을 때 사용합니다.'}
  ]},
  {ver:'20260726.004', date:'2026년 7월 26일', items:[
    {t:'모바일·태블릿 지원', d:'모바일과 태블릿에서도 사용할 수 있도록 전용 화면과 조작 방식을 추가했습니다. 자세한 내용은 <b>Mobile</b> 탭을 참고하세요.'}
  ]},
  {ver:'20260726.003', date:'2026년 7월 26일', items:[
    {t:'저장·불러오기 일원화', d:'「JSON 저장」과 「HTML 내보내기」로 나뉘어 있던 저장 방식을 <b>「저장」 하나로 합쳤습니다</b>. 저장한 HTML 안에 편집 데이터가 함께 담겨 있어서, <b>「불러오기」로 다시 열면 그대로 이어서 편집</b>할 수 있습니다.<br><br>보고용 파일과 편집용 파일을 따로 챙길 필요가 없어졌습니다. 완성한 화면을 그대로 공유하고, 나중에 같은 파일을 열어 수정하면 됩니다.'},
    {t:'업데이트 저장 위치 선택', d:'업데이트 버튼을 누르면 곧바로 다운로드 폴더로 받아지던 것을, <b>「저장」처럼 폴더를 고를 수 있게</b> 바꿨습니다. 파일명은 <b>mockup_builder.html</b>로 유지되어 쓰던 파일에 그대로 덮어쓸 수 있습니다.<br><br>배포처를 GitHub으로 옮기면서 가능해졌습니다. (자동 다운로드가 막힌 환경에서는 예전처럼 다운로드 페이지가 열립니다)'},
    {t:'빌드 번호 도입', d:'버전 표기가 <b>ver.20260726.001</b>처럼 <b>날짜 + 빌드번호</b> 형태로 바뀌었습니다. 같은 날 여러 번 배포해도 어느 것이 최신인지 구분됩니다. 좌측 하단 표기와 이 패치 내역에 동일하게 적용됩니다.'},
    {t:'Esc로 창 닫기', d:'<b>패치 내역·사용자 가이드·템플릿·이미지 변환·둘러보기</b> 창을 <b>Esc</b> 키로 닫을 수 있습니다. 창이 겹쳐 있으면 위에 뜬 것부터 하나씩 닫힙니다.<br><br>단, 이미지 변환 창의 입력칸에 <b>타이핑 중일 때는 닫히지 않습니다</b>. 붙여넣은 JSON이 지워지는 것을 막기 위해서입니다.'},
    {t:'상단바 버튼 그룹화', d:'상단바 버튼을 성격별로 묶었습니다. <b>템플릿·이미지 변환</b>이 한 세트, <b>전체 지우기·불러오기·저장</b>이 한 세트로 사이를 띄워 배치했습니다. 자주 쓰는 버튼을 눈으로 찾기 쉬워집니다.'},
    {t:'상단바 정리', d:'<b>「↶ 취소」·「↷ 재실행」 버튼을 없앴습니다</b>. 기능은 그대로라 <b>Ctrl+Z</b>(취소), <b>Ctrl+Y</b> 또는 <b>Ctrl+Shift+Z</b>(재실행)로 계속 사용할 수 있습니다.'}
  ]},
  {ver:'20260725', date:'2026년 7월 25일', items:[
    {t:'그리드 컬럼별 입력 유형', d:'그리드의 각 컬럼을 도구상자 컴포넌트처럼 <b>텍스트박스·콤보박스·날짜·체크박스</b> 중 하나로 지정할 수 있습니다. 내보내기 결과물에서 컬럼 유형대로 실제 동작합니다 (콤보는 클릭 시 목록 펼침, 체크박스는 클릭 시 체크). 콤보 옵션을 따로 안 정하면 <b>선택·옵션1·옵션2·옵션3</b>이 기본으로 들어가고, 날짜 컬럼은 <b>오늘 날짜</b>가 기본값으로 채워집니다.'},
    {t:'그리드 컬럼 편집 UI', d:'그리드 컬럼 목록이 조회조건 필드처럼 바뀌었습니다. <b>⠿ 핸들로 드래그해서 순서 변경</b>, 컬럼명·유형·삭제(×)가 <b>한 줄</b>에 표시되고, "컬럼" 그룹 전체를 한 번에 <b>접고 펼칠</b> 수 있습니다.'},
    {t:'인터랙티브 둘러보기', d:'상단바 <b>🧭</b> 버튼을 누르면 실제 화면 위에 스포트라이트를 비추며 도구상자·캔버스·속성 패널·템플릿·내보내기 등 <b>13단계</b>로 안내하는 둘러보기가 시작됩니다. 처음 여는 사용자에게 자동으로 뜨고, "다시 보지 않기"를 체크하지 않으면 다음에 열 때 또 안내합니다.'},
    {t:'도구상자 그룹 접기/펼치기', d:'레이아웃·입력 컴포넌트·액션·데이터 그룹마다 이름 옆 <b>▾ 아이콘</b>을 눌러 접고 펼칠 수 있습니다. 기본은 펼친 상태입니다.'},
    {t:'이미지 변환 안내 접기', d:'"JSON 붙여넣기(무료)" 탭 상단의 사용법 안내가 <b>접기/펼치기</b> 방식으로 바뀌어, 기본은 접힌 상태로 화면을 덜 차지합니다.'}
  ]},
  {ver:'20260724', date:'2026년 7월 24일', items:[
    {t:'파일명 자동 생성', d:'저장 파일명이 <b>화면 제목_날짜_시각</b>으로 자동 지정됩니다. (예: <b>수주등록_20260723_2138.html</b>) 저장할 때마다 이름이 달라져 이전 파일을 덮어쓰지 않습니다. 파일명에 쓸 수 없는 문자는 자동으로 <b>_</b>로 바뀌고, 화면 제목이 없으면 기본 이름이 사용됩니다.'},
    {t:'내보내기 문서 제목', d:'내보낸 HTML을 브라우저에서 열면 탭에 <b>「화면 제목 목업」</b>이 표시됩니다. 여러 목업을 동시에 띄워 두어도 탭만 보고 구분할 수 있습니다.'},
    {t:'속성 도움말 툴팁', d:'속성창의 긴 설명문이 사라지고, 각 기능 이름 옆에 <b>? 아이콘</b>이 생겼습니다. 마우스를 올리면 설명이 툴팁으로 나타납니다. 설명이 자리를 차지하지 않아 속성창이 한결 깔끔해졌습니다.'},
    {t:'그리드 좌우 스크롤', d:'그리드 속성창에 <b>좌우 스크롤 사용</b> 옵션이 생겼습니다. 켜면 컬럼마다 지정한 폭을 유지한 채 <b>가로 스크롤바</b>가 나타나, 컬럼이 많아도 글자가 짓눌리지 않습니다. 컬럼 폭은 60~300px로 조절할 수 있고, 끄면 기존처럼 그리드 폭에 맞춰 균등 분할됩니다. 내보낸 HTML에서도 그대로 동작합니다.'},
    {t:'버전 체크 · 업데이트', d:'제목 옆 <b>📖</b> 오른쪽에 <b>⬇ 업데이트</b> 버튼이 생겼습니다. 새 버전이 배포되어 있을 때만 나타나며, 누르면 최신 파일을 바로 내려받을 수 있습니다. 최신 버전을 쓰고 있다면 버튼은 표시되지 않습니다.'}
  ]},
  {ver:'20260722', date:'2026년 7월 22일', items:[
    {t:'스플릿 컨테이너', d:'도구상자에 <b>스플릿 컨테이너</b>가 추가되었습니다. 화면을 좌우 또는 상하로 나누고 경계선을 드래그해 크기를 조절할 수 있으며, 스플릿 안에 스플릿을 중첩해 3분할 이상의 레이아웃도 만들 수 있습니다.'},
    {t:'Dock: Fill / None', d:'스플릿 영역에 넣은 컴포넌트는 기본적으로 <b>자유롭게 배치·크기조절(None)</b>되고, 속성창에서 <b>Fill</b>로 바꾸면 영역에 꽉 차서 경계선과 함께 자동 리사이즈됩니다.'},
    {t:'조회조건 필드 순서 변경', d:'조회조건 속성창에서 각 필드를 <b>드래그하거나 ▲▼ 버튼</b>으로 순서를 바꿀 수 있습니다.'}
  ]},
  {ver:'20260721', date:'2026년 7월 21일', items:[
    {t:'조회조건 높이 자동 조절', d:'조건을 추가하거나 지우면 <b>조회조건 박스 높이가 자동으로 맞춰집니다</b>. 조건이 4개를 넘어 줄이 늘어나도 가려지지 않고, 줄이 줄면 남는 여백 없이 정리됩니다. 템플릿에도 동일하게 적용됩니다.'},
    {t:'브라우저 탭 아이콘', d:'브라우저 탭과 즐겨찾기에 <b>전용 아이콘</b>이 표시됩니다. 여러 탭을 띄워 두어도 한눈에 찾을 수 있습니다.'},
    {t:'내보내기 결과물 드롭다운', d:'내보낸 화면에서 <b>조회조건의 콤보를 누르면 목록이 펼쳐집니다</b>. 항목을 고르면 값이 반영됩니다.'}
  ]},
  {ver:'20260720', date:'2026년 7월 20일', items:[
    {t:'화면 캡처 변환 품질 향상', d:'이미지에서 화면을 옮길 때 <b>원본 위치를 그대로 베끼지 않고 정돈된 레이아웃으로 재배치</b>합니다. 왼쪽 여백과 줄 간격을 맞추고, 한 줄에 4~6개씩 고르게 놓으며, 구획 제목은 섹션으로 만듭니다.'},
    {t:'옛 시스템 화면 변환', d:'입력칸이 촘촘한 <b>구형 화면도 인식</b>합니다. 맨 위 경로에서 화면 이름만 뽑고, 흩어진 조회 항목을 조회조건 하나로 모으며, 코드칸과 이름칸이 짝지어진 항목은 검색 필드 하나로 합칩니다. 표에는 행 조작 버튼을 자동으로 붙입니다.'},
    {t:'패치 내역 히스토리', d:'업데이트 안내가 <b>New Release / Release History</b> 두 탭으로 나뉘었습니다. 지난 버전 내역도 언제든 다시 볼 수 있습니다.'}
  ]},
  {ver:'20260719', date:'2026년 7월 19일', items:[
    {t:'자동 저장', d:'작업 중인 내용이 <b>수정 3초 뒤와 1분마다</b> 브라우저에 자동 저장됩니다. 실수로 창을 닫아도 다시 열면 <b>이어서 작업</b>할 수 있습니다. 저장을 하면 자동 저장 기록은 정리됩니다.'},
    {t:'저장 위치 선택', d:'저장 시 <b>폴더와 파일 이름을 지정</b>할 수 있습니다. (Chrome·Edge에서 http/https로 열었을 때)'},
    {t:'조회조건 읽기전용', d:'조회조건 필드마다 <b>🔒 버튼</b>이 생겼습니다. 켜면 회색으로 표시되고 내보내기 결과물에서 입력이 막힙니다.'},
    {t:'Claude로 열기', d:'이미지 변환 화면에서 <b>🤖 Claude로 열기</b>를 누르면 프롬프트가 입력된 상태로 Claude가 새 창에 열립니다.'}
  ]},
  {ver:'20260718', date:'2026년 7월 18일', items:[
    {t:'캔버스 확대·축소', d:'상단 「캔버스 높이」 오른쪽에 <b>확대/축소</b>가 생겼습니다. 50~200% 선택 또는 <b>Ctrl+마우스휠</b>로도 됩니다. 보기만 커질 뿐 실제 크기는 바뀌지 않습니다.'},
    {t:'사용자 가이드', d:'제목 옆 <b>📖</b> 버튼을 누르면 사용법을 한눈에 볼 수 있습니다.'},
    {t:'트리 컴포넌트', d:'도구상자 「데이터」에 <b>트리</b>가 추가됐습니다. 조직도처럼 계층 구조를 표현하고, 접기/펼치기도 됩니다.'},
    {t:'라벨이 붙은 입력 컴포넌트', d:'텍스트박스·콤보박스·날짜·기간·체크박스·라디오를 놓으면 <b>라벨이 함께</b> 만들어집니다. 속성창에서 라벨 내용과 위치(위·왼쪽·오른쪽·아래)를 바꾸거나 숨길 수 있습니다.'}
  ]},
  {ver:'20260715', date:'2026년 7월 15일', items:[
    {t:'탭(Tab) 컴포넌트', d:'탭 안에 다른 컴포넌트를 넣을 수 있고, 내보내기 결과물에서 탭을 클릭하면 실제로 화면이 전환됩니다.'},
    {t:'템플릿 14종', d:'수주등록·수주현황조회 등 자주 쓰는 화면을 클릭 한 번으로 불러옵니다.'},
    {t:'클릭으로 배치', d:'도구상자 위쪽 토글을 켜면 도구를 클릭한 뒤 캔버스를 클릭해 연속으로 배치할 수 있습니다.'},
    {t:'복사 기능', d:'<b>Ctrl+드래그</b>로 복사 이동, <b>Ctrl+C / Ctrl+V</b>로 복사·붙여넣기가 됩니다. 여러 개 선택도 지원합니다.'},
    {t:'내보내기 결과물 실동작', d:'내보낸 HTML에서 콤보·날짜·체크박스·라디오·조회조건이 실제로 동작합니다.'},
    {t:'기간(daterange) 컴포넌트', d:'시작일과 종료일을 함께 입력하는 컴포넌트가 추가됐습니다.'}
  ]}
];
// 모바일·태블릿 전용 신규 기능 내역 (개선·수정 제외, 신규 위주)
const MOBILE_PATCH_NOTES=[
  {ver:'20260726.004', date:'2026년 7월 26일', items:[
    {t:'모바일·태블릿 전용 화면', d:'화면 크기와 방향(세로·가로)에 맞춰 편집 UI가 자동으로 바뀝니다. 상단 앱바, 컴포넌트 추가 버튼, 우측 컨트롤, 미니맵 등 터치에 맞는 레이아웃으로 재구성됩니다.'},
    {t:'터치 직접 조작', d:'컴포넌트를 손가락으로 <b>탭해 선택</b>하고, <b>드래그로 이동</b>, 모서리를 잡아 <b>크기 조절</b>할 수 있습니다. 두 손가락 <b>핀치로 확대·축소</b>도 지원합니다.'},
    {t:'컴포넌트 추가 시트', d:'우측 하단 <b>＋</b> 버튼(세로 모드는 하단 도구 독)으로 컴포넌트를 종류별로 골라 캔버스에 추가할 수 있습니다.'},
    {t:'선택 컨텍스트 바', d:'컴포넌트를 선택하면 <b>속성·복제·앞으로·뒤로·삭제</b> 버튼이 하단에 나타나, 자주 쓰는 동작을 바로 실행할 수 있습니다.'},
    {t:'속성 편집 (시트·패널)', d:'컨텍스트 바의 <b>속성</b>을 누르면 세로 모드는 하단 시트, 가로 모드는 우측 패널로 속성을 편집할 수 있습니다.'},
    {t:'미니맵 네비게이터', d:'전체 화면 축소도를 보여주는 미니맵으로 현재 보는 영역을 확인하고, 드래그해서 원하는 위치로 이동할 수 있습니다. ⠿ 핸들로 미니맵 위치도 옮길 수 있습니다.'},
    {t:'이동 도구(✥)', d:'우측 컨트롤의 <b>이동 도구</b>를 켜면 컴포넌트 위에서도 드래그가 <b>화면 이동</b>만 되어, 꽉 찬 화면도 편하게 둘러볼 수 있습니다. 켜는 동안 선택·도구상자·속성창이 숨겨져 캔버스에 집중됩니다.'},
    {t:'미리보기·화면 맞춤·줌', d:'우측 컨트롤에서 <b>미리보기(▶)</b>, <b>화면 맞춤(⤢)</b>, <b>줌 배지</b>(탭하면 화면 맞춤)를 바로 사용할 수 있습니다.'}
  ]}
];
const PATCH_VER=PATCH_NOTES[0].ver;
let patchTab=0;
function patchItemsHTML(items){
  // 패치 항목은 신규 기능(NEW)만 싣는다. 배지 종류가 하나뿐이라 분기 없이 고정한다.
  return items.map(it=>`<div class="pt-item">
      <div class="pt-t"><span class="pt-badge new">NEW</span> ${it.t}</div>
      <p>${it.d}</p>
    </div>`).join('');
}
// The date portion of a version string ("20260727.004" -> "20260727"); groups builds by day.
function patchDateKey(ver){ return String(ver||'').split('.')[0]; }
// The build portion (".004" -> "004"); labels a sub-section inside a day group.
function patchBuildNo(ver){ const p=String(ver||'').split('.'); return p.length>1?p[1]:''; }
// Groups a newest-first list of notes into day buckets, preserving order.
// Returns [{key, date, builds:[note,...]}, ...], newest day first, builds newest first.
function groupPatchesByDate(notes){
  const out=[]; const idx={};
  notes.forEach(n=>{
    const key=patchDateKey(n.ver);
    if(idx[key]===undefined){ idx[key]=out.length; out.push({key,date:n.date,builds:[]}); }
    out[idx[key]].builds.push(n);
  });
  return out;
}
// Renders one day group: a single date header, then each build as its own labeled block.
function renderPatchDay(group,history){
  const builds=group.builds.map(n=>
    `<div class="pt-build"><div class="pt-build-hd">ver.${n.ver}</div>${patchItemsHTML(n.items)}</div>`
  ).join('');
  return `<div class="pt-day${history?' history':''}">
    <div class="pt-day-hd">${group.date}</div>
    ${builds}
  </div>`;
}
function renderPatch(){
  const tabs=document.getElementById('patchTabs');
  const body=document.getElementById('patchBody');
  if(!tabs||!body)return;
  tabs.innerHTML=
    `<div class="tab${patchTab===0?' on':''}" onclick="switchPatchTab(0)">New Release</div>`+
    `<div class="tab${patchTab===1?' on':''}" onclick="switchPatchTab(1)">Release History</div>`+
    `<div class="tab${patchTab===2?' on':''}" onclick="switchPatchTab(2)">Mobile</div>`;
  if(patchTab===0){
    // 최신 날짜의 모든 빌드(예: 20260727 의 001~004)를 한 그룹으로 묶어 보여준다.
    const groups=groupPatchesByDate(PATCH_NOTES);
    body.innerHTML = groups.length ? renderPatchDay(groups[0],false) : '';
  } else if(patchTab===2){
    // 모바일·태블릿 전용 신규 기능
    const groups=groupPatchesByDate(MOBILE_PATCH_NOTES);
    body.innerHTML = groups.length
      ? groups.map(g=>renderPatchDay(g,true)).join('')
      : '<p style="font-size:12.5px;color:#8a949c;margin:6px 0;">모바일 전용 내역이 없습니다.</p>';
  } else {
    // 지난 업데이트: 최신 날짜 그룹을 뺀 나머지를 날짜별로 묶어 최신순으로.
    const groups=groupPatchesByDate(PATCH_NOTES).slice(1);
    body.innerHTML = groups.length
      ? groups.map(g=>renderPatchDay(g,true)).join('')
      : '<p style="font-size:12.5px;color:#8a949c;margin:6px 0;">지난 업데이트 내역이 없습니다.</p>';
  }
  body.scrollTop=0;
}
function switchPatchTab(i){ patchTab=i; renderPatch(); }
const PATCH_KEY='mb_patch_seen';
function closePatch(){
  const chk=document.getElementById('patchHideChk');
  if(chk&&chk.checked){
    // Remembered in this browser only; the file itself is unchanged.
    try{ localStorage.setItem(PATCH_KEY,PATCH_VER); }catch(e){}
  }
  document.getElementById('patchBg').classList.remove('on');
}
function openPatch(){ patchTab=0; renderPatch(); document.getElementById('patchBg').classList.add('on'); }
function maybeShowPatch(){
  // Don't stack on top of the restore dialog; show it after that one closes.
  const r=document.getElementById('restoreBg');
  if(r&&r.classList.contains('on')){ maybeShowPatch._pending=true; return; }
  let seen=null;
  try{ seen=localStorage.getItem(PATCH_KEY); }catch(e){}
  if(seen!==PATCH_VER) openPatch();
}
function openGuide(){ document.getElementById('guideBg').classList.add('on'); switchGuideTab('start'); }function closeGuide(){ document.getElementById('guideBg').classList.remove('on'); }
function switchGuideTab(t){
  ['start','know','fast','faq'].forEach(k=>{
    document.getElementById('gdTab'+k[0].toUpperCase()+k.slice(1)).classList.toggle('on',k===t);
    document.getElementById('gdPane'+k[0].toUpperCase()+k.slice(1)).style.display=(k===t)?'block':'none';
  });
}

// ---- Interactive onboarding tour (spotlights real UI areas, one at a time) ----
const TOUR_STEPS=[
  {sel:null, title:'Mockup Builder에 오신 것을 환영합니다 👋',
    desc:'업무 화면 목업을 빠르게 그리는 도구입니다.<br><br><b>왼쪽 도구상자</b>에서 끌어다 놓고 → <b>오른쪽 속성 패널</b>에서 내용을 고치고 → <b>내보내기</b>, 이 흐름만 알면 됩니다.<br><br>핵심 영역을 하나씩 짧게 안내해드릴게요.'},
  {sel:'#guideBtn', title:'사용자 가이드',
    desc:'📖 버튼을 누르면 <b>시작하기·알아두면 좋은 것·시간을 아끼는 방법·자주 묻는 것</b> 탭으로 정리된 사용법 안내가 열립니다. 이 둘러보기를 다시 보고 싶을 때도 그 안의 링크로 시작할 수 있어요.'},
  {sel:'.brand', title:'화면 모드 전환 (Thin ↔ Fat Mode)',
    desc:'상단 왼쪽 <b>타이틀(로고)</b>을 누르면 <b>Thin Mode</b>와 <b>Fat Mode</b> 중 고르는 팝업이 뜹니다.<br><br>Fat Mode는 라벨이 왼쪽에 붙고, 조회조건 대신 <b>패널+팝업</b> 조합을 쓰며, 그리드 툴바·필수(*) 표시가 화면에 나타나지 않는 등 옛날 화면 느낌으로 바뀝니다.<br><br>⚠ 모드를 바꾸면 캔버스가 초기화되니, 작업 중이라면 먼저 저장해두세요.'},
  {sel:'.toolbox .tgrp:nth-of-type(1)', title:'레이아웃',
    desc:'화면 제목·섹션 헤더·패널·탭·스플릿·조회조건 패널 등 <b>화면의 큰 뼈대</b>를 만드는 컴포넌트입니다. 캔버스로 끌어다 놓으세요.'},
  {sel:'.toolbox .tgrp:nth-of-type(2)', title:'입력 컴포넌트',
    desc:'라벨·텍스트박스·콤보박스·날짜·기간·체크박스·라디오처럼 <b>데이터를 입력받는 항목</b>입니다. Fat Mode에서는 <b>팝업</b> 컴포넌트도 여기 추가됩니다.'},
  {sel:'.toolbox .tgrp:nth-of-type(3)', title:'액션',
    desc:'버튼처럼 <b>클릭해서 동작을 실행</b>하는 컴포넌트입니다.'},
  {sel:'.toolbox .tgrp:nth-of-type(4)', title:'데이터',
    desc:'그리드·차트·트리처럼 <b>여러 건의 데이터를 표 형태로 보여주는</b> 컴포넌트입니다. 그리드는 컬럼마다 텍스트박스·콤보·날짜·체크박스 유형도 지정할 수 있어요.'},
  {sel:'.canvas-wrap', title:'캔버스',
    desc:'도구상자의 컴포넌트를 <b>끌어다 놓는 작업 공간</b>입니다. 클릭하면 선택되고, 드래그로 위치·크기를 조절할 수 있습니다. 패널·탭·스플릿 위에 놓으면 그 안의 <b>자식 컴포넌트</b>로 들어가 함께 움직입니다.'},
  {sel:'#props', title:'속성 패널',
    desc:'컴포넌트를 선택하면 여기서 <b>텍스트·크기·옵션 등 세부 속성</b>을 편집합니다. 그리드를 선택하면 컬럼 목록도 여기서 관리해요.'},
  {sel:'#convertBtn', title:'이미지 변환',
    desc:'기존 화면을 <b>캡처한 이미지</b>를 올리면 컴포넌트로 자동 변환해줍니다. API 키 없이 쓸 수 있는 <b>JSON 붙여넣기(무료)</b> 방식과, AI가 직접 분석하는 방식을 지원합니다. 지금 켜져 있는 모드(Thin/Fat)에 맞춰 변환 방식도 자동으로 달라집니다.'},
  {sel:'#clearBtn', title:'전체 지우기',
    desc:'캔버스의 <b>모든 컴포넌트를 한 번에 삭제</b>합니다. 새 화면을 처음부터 그릴 때 사용하세요.'},
  {sel:'#jsonLoadBtn', title:'불러오기',
    desc:'저장해둔 <b>HTML 파일을 불러와서</b> 이전 작업을 이어갑니다. 예전에 만든 JSON 파일도 그대로 열 수 있어요. 파일에 저장된 모드(Thin/Fat) 정보가 있으면 그 모드로 자동 전환되고, 없는 옛날 파일은 Thin Mode로 열립니다.'},
  {sel:'#exportBtn', title:'저장',
    desc:'완성한 화면을 <b>실제로 동작하는 HTML 파일</b>로 저장합니다. 콤보박스 클릭, 체크박스 토글, 탭 전환 등이 실제로 동작하는 미리보기가 만들어져요.<br><br>이 HTML에는 편집 데이터가 함께 담겨 있어서, <b>불러오기로 다시 열면 이어서 작업</b>할 수 있습니다.<br><br>이제 시작해볼까요? 🎉'}
];
let tourIdx=0;
function startTour(){
  tourIdx=0;
  const chk=document.getElementById('tourHideChk');
  if(chk) chk.checked=false;
  document.getElementById('tourOverlay').style.display='block';
  showTourStep(0);
}
function closeTour(){
  const chk=document.getElementById('tourHideChk');
  if(chk&&chk.checked){
    // Remembered in this browser only; the file itself is unchanged (same convention as the patch-notes modal).
    try{ localStorage.setItem('mb_tour_seen','1'); }catch(e){}
  }
  document.getElementById('tourOverlay').style.display='none';
}
function showTourStep(i){
  tourIdx=i;
  const step=TOUR_STEPS[i];
  document.getElementById('tourTitle').textContent=step.title;
  document.getElementById('tourDesc').innerHTML=step.desc;
  document.getElementById('tourStepN').textContent=(i+1)+' / '+TOUR_STEPS.length;
  document.getElementById('tourPrevBtn').disabled=(i===0);
  document.getElementById('tourNextBtn').textContent=(i===TOUR_STEPS.length-1)?'완료':'다음';
  const fill=document.getElementById('tourProgFill');
  if(fill) fill.style.width=Math.round(((i+1)/TOUR_STEPS.length)*100)+'%';
  positionTourStep(step);
}
function tourNext(){
  if(tourIdx>=TOUR_STEPS.length-1){ closeTour(); return; }
  showTourStep(tourIdx+1);
}
function tourPrev(){
  if(tourIdx<=0)return;
  showTourStep(tourIdx-1);
}
// 내용 길이에 맞춰 카드 폭을 3단계(300/360/420px)로 조정한다 - 짧은 설명은 아담하게,
// 긴 설명은 넉넉하게 넓혀서 단어가 어중간하게 잘리는 걸 줄인다.
function pickTourCardWidth(step){
  const plain=(step.title||'').length + (step.desc||'').replace(/<[^>]+>/g,'').length;
  if(plain<70) return 300;
  if(plain<190) return 360;
  return 420;
}
function positionTourStep(step){
  const spot=document.getElementById('tourSpot');
  const card=document.getElementById('tourCard');
  const target = step.sel ? document.querySelector(step.sel) : null;
  const cw=pickTourCardWidth(step);
  card.style.width=cw+'px';
  if(!target){
    spot.classList.add('none');
    const ch=card.offsetHeight||240;
    card.style.left=Math.max(10,(window.innerWidth-cw)/2)+'px';
    card.style.top=Math.max(10,(window.innerHeight-ch)/2)+'px';
    return;
  }
  spot.classList.remove('none');
  const r=target.getBoundingClientRect();
  const pad=6;
  spot.style.top=(r.top-pad)+'px';
  spot.style.left=(r.left-pad)+'px';
  spot.style.width=(r.width+pad*2)+'px';
  spot.style.height=(r.height+pad*2)+'px';
  const ch=card.offsetHeight||240;
  const spaceRight=window.innerWidth-r.right, spaceBelow=window.innerHeight-r.bottom;
  let top,left;
  if(spaceRight>cw+30){ left=r.right+16; top=Math.min(window.innerHeight-ch-10,Math.max(10,r.top)); }
  else if(spaceBelow>ch+30){ left=Math.min(window.innerWidth-cw-10,Math.max(10,r.left)); top=r.bottom+16; }
  else { left=Math.max(10,r.left-cw-16); top=Math.min(window.innerHeight-ch-10,Math.max(10,r.top)); }
  card.style.left=left+'px';
  card.style.top=top+'px';
}
window.addEventListener('resize',()=>{ if(document.getElementById('tourOverlay').style.display==='block') positionTourStep(TOUR_STEPS[tourIdx]); });
// Auto-start once for first-time users; the 🧭 topbar button (or guide modal link) replays it anytime after.
(function(){
  try{
    if(!localStorage.getItem('mb_tour_seen')){
      window.addEventListener('load',()=>{ setTimeout(startTour,600); });
    }
  }catch(e){}
})();
function openTemplates(){ document.getElementById('tmplBg').classList.add('on'); renderTmplGrid(); }
function closeTemplates(){ document.getElementById('tmplBg').classList.remove('on'); }
function switchTmplTab(t){
  tmplTab=t;
  document.getElementById('tmplTabReg').classList.toggle('on',t==='reg');
  document.getElementById('tmplTabInq').classList.toggle('on',t==='inq');
  renderTmplGrid();
}
function renderTmplGrid(){
  const wrap=document.getElementById('tmplGrid');
  const group=TEMPLATES[tmplTab];
  wrap.innerHTML=Object.keys(group).map(name=>{
    const def=group[name];
    const warn=def._estimated?'<div class="tw">⚠ 참고 이미지 없이 추정 구성</div>':'';
    const gridCount=(def.grids?def.grids.length:0)+(def.tabs?def.tabs.pages.reduce((a,p)=>a+(p.grids?p.grids.length:0),0):0);
    return `<div class="tmpl-card" onclick="loadTemplate('${tmplTab}','${name}')">
      <div class="ti">${esc(name)}</div>
      <div class="td">그리드 ${gridCount}개${def.search?' · 조회조건 포함':''}${def.tabs?' · 탭 포함':''}</div>
      ${warn}
    </div>`;
  }).join('');
}
function loadTemplate(cat,name){
  const def=TEMPLATES[cat][name];
  if(!def)return;
  const built=layoutForm(def);
  document.getElementById('cw').value=built.canvasW; setCW();
  document.getElementById('ch').value=built.canvasH; setCH();
  placeItems(built.items,1,true);
  fitZoomToViewport();
  closeTemplates();
}

// ================= 상단 로고 클릭: Thin Mode ↔ Fat Mode 전환 =================
// 기존 모드 = Thin Mode, 새로 추가된 모드 = Fat Mode.
// 지금은 색상/모서리 등 톤앤매너만 바뀐다. 어떤 기능을 더 바꿀지는 추후 별도로 정한다.
// 확인창·전체초기화 없이 스킨(Thin/Fat) 상태만 바꾼다. 모드 선택 팝업(pickAppSkin)과
// 파일 불러오기(doLoad, 저장된 모드를 그대로 반영)가 공통으로 쓴다.
function setAppSkin(fat){
  document.body.classList.toggle('skin-classic', !!fat);
  try{ localStorage.setItem('mb_skin', fat?'classic':'modern'); }catch(e){}
  // 모바일/태블릿에서 스킨을 바꾸면 도크·레일의 컴포넌트 목록(조회조건↔팝업)도 다시 그려야
  // 데스크톱 도구상자와 일치한다. (없으면 조용히 무시)
  try{ if(window.mbRefreshForSkin) window.mbRefreshForSkin(); }catch(e){}
  // 모드가 바뀔 때마다(로고로 직접 전환하든, 파일 불러오기로 그 파일의 저장된 모드에 맞춰
  // 자동 전환되든) 접속 로그를 한 번 더 남겨서, 언제 어떤 모드로 사용했는지 로그만으로 알 수
  // 있게 한다. 페이지를 막 열었을 때의 최초 모드 복원(applySavedSkin)은 이 함수를 거치지
  // 않으므로 최초 접속 로그와 중복되지 않는다.
  try{ if(window.mbLogAccess) window.mbLogAccess(); }catch(e){}
}
// 로고를 누르면 alert 대신 이미지(스와치) 2개짜리 팝업을 띄워 Thin/Fat 중 고르게 한다.
function openSkinPicker(){
  const isFat=document.body.classList.contains('skin-classic');
  document.getElementById('skinPickThin').classList.toggle('on', !isFat);
  document.getElementById('skinPickFat').classList.toggle('on', isFat);
  document.getElementById('skinBg').classList.add('on');
}
function closeSkinPicker(){ document.getElementById('skinBg').classList.remove('on'); }
// 카드를 클릭해 모드를 고른다. 이미 그 모드면 그냥 닫고, 다르면 전환 후 전체지우기와 동일하게 초기화한다.
function pickAppSkin(toFat){
  const isFat=document.body.classList.contains('skin-classic');
  closeSkinPicker();
  if(toFat===isFat)return;
  setAppSkin(toFat);
  resetCanvasToDefault();
}
function applySavedSkin(){
  var v=null; try{ v=localStorage.getItem('mb_skin'); }catch(e){}
  if(v==='classic') document.body.classList.add('skin-classic');
}

setCW(); setCH();   // sync inline size with the toolbar inputs so zoom math has a base
fitZoomToViewport();
applySavedSkin();  // 이전에 로고로 전환해둔 톤앤매너가 있으면 복원 (seed()가 모드를 보고 기본 화면을 구성하므로 먼저 실행)
seed();
checkAutosave();  // offer to restore a previous session (also arms autosave)
maybeShowPatch();

/* ============================================================
   버전 체크 / 업데이트 배포
   새 버전 배포 시 (1) 버전 Gist 의 verchk.txt 를 새 버전(YYYYMMDD.NNN)으로 고치고,
   (2) 파일 Gist 의 mockup_builder.html 을 새 파일로 갈아끼웁니다.
   둘은 서로 다른 Gist 이며, 검색 노출을 막기 위해 secret 으로 두었습니다.
   secret Gist 도 api.github.com 으로 인증 없이 읽히므로 아래 코드는 그대로 동작합니다.
   ============================================================ */
// 내려받을 파일도 Gist 에 둔다. Google Drive 는 Access-Control-Allow-Origin 헤더를 주지
// 않아 fetch 로 읽을 수 없고(브라우저가 CORS 로 차단), 그래서 예전에는 window.open 으로
// 브라우저에 넘길 수밖에 없었다 — 그 경우 저장 위치를 고르지 못하고 다운로드 폴더로 직행한다.
// GitHub 은 raw 응답에 Access-Control-Allow-Origin: * 를 주므로 fetch 가 되고,
// 받아온 내용을 「저장」과 똑같이 saveBlob 에 넘겨 위치를 고를 수 있다.
// 버전 파일(verchk.txt)과 프로그램 파일은 서로 다른 Gist 에 있으므로 ID 를 따로 둔다.
const FILE_GIST_ID     = 'cedf492408332adf2b1d103afb40aa49';   // mockup_builder.html 이 있는 Gist (secret)
const UPDATE_FILE      = 'mockup_builder.html';   // Gist 안의 프로그램 파일 이름
// 광고 차단기가 GitHub 요청을 막는 경우가 있어, fetch 가 실패하면
// 아래 주소를 브라우저로 열어 사용자가 직접 받도록 폴백한다.
const UPDATE_PAGE_URL  = 'https://gist.github.com/' + FILE_GIST_ID;
// 버전 정보는 GitHub Gist 에서 읽는다. GitHub 는 Access-Control-Allow-Origin: *
// 를 주기 때문에 file:// 로 연 페이지에서도 fetch 가 막히지 않는다.
// 새 버전 배포 시 이 Gist 의 verchk.txt 내용(YYYYMMDD.NNN 한 줄)만 고치면 된다.
const GIST_ID          = '624b8724f8933d89f84622aa9d3fe3f1';   // verchk.txt 가 있는 Gist (secret)
const VER_FILE         = 'verchk.txt';
const REMOTE_VER       = '20260910.001';   // Gist 를 못 읽을 때 쓰는 예비 버전 (로컬과 같게 두면 조용히 넘어감)
let _remoteVer = REMOTE_VER;

// 버전 문자열 비교. "20260726.001" 처럼 날짜.빌드번호 형태를 다룬다.
// 문자열 부등호(>)로 비교하면 "20260726.9" > "20260726.10" 이 참이 되어버리므로,
// 마디별로 끊어 숫자로 비교한다. 빌드번호가 없는 옛 형식("20260725")은 .0 으로 취급해
// 같은 날짜의 .001 보다 낮게 판정된다. remote 가 더 새 버전이면 true.
function verNewer(remote, local){
  const p = v => String(v).split('.').map(n=>parseInt(n,10)||0);
  const a = p(remote), b = p(local);
  for(let i=0; i<Math.max(a.length,b.length); i++){
    const x=a[i]||0, y=b[i]||0;
    if(x!==y) return x>y;
  }
  return false;   // 완전히 같음
}

// 좌측 하단 "by June (ver.YYYYMMDD.NNN)" 에서 로컬 버전 추출.
// 빌드번호는 선택적이라 옛 형식(ver.20260725)도 그대로 읽힌다.
function getLocalVer(){
  const el = document.getElementById('verMark');
  const m = el && el.textContent.match(/ver\.\s*(\d{8}(?:\.\d+)?)/);
  return m ? m[1] : null;
}

function showUpdBtn(remote, local){
  const b = document.getElementById('updBtn');
  if(!b) return;
  _remoteVer = remote;
  b.style.display = 'inline-block';
  b.textContent = '\u2b07 \uc5c5\ub370\uc774\ud2b8';
  b.title = '\uc0c8 \ubc84\uc804 ver.' + remote + ' \ub2e4\uc6b4\ub85c\ub4dc (\ud604\uc7ac ver.' + local + ')';
  // 앞선 시도에서 버전 확인이 막혀 "확인만" 상태였을 수 있다. 이번엔 버전을 알아냈으므로
  // 그 표시를 지워 정상 다운로드 경로를 타게 한다. (지우지 않으면 한 번 실패한 세션에서는
  // 이후 성공해도 계속 페이지만 열린다.)
  delete b.dataset.folderOnly;
}

// Gist 의 verchk.txt 내용(YYYYMMDD.NNN 한 줄)을 읽어온다.
// raw URL(gist.githubusercontent.com)은 CDN 캐시가 오래 남아 수정 직후에도 옛 값을
// 돌려주는 일이 잦다. API 는 캐시를 타지 않아 수정 즉시 반영되므로 이것만 쓴다.
async function fetchRemoteVer(){
  try{
    const r = await fetch(`https://api.github.com/gists/${GIST_ID}?t=${Date.now()}`, {cache:'no-store'});
    if(!r.ok) return null;
    const j = await r.json();
    const files = j.files || {};
    // 지정한 파일명을 먼저 찾고, 이름이 바뀐 경우에 대비해 없으면 첫 파일에서 읽는다.
    const f = files[VER_FILE] || Object.values(files)[0];
    // 빌드번호(.NNN)는 선택적 — 옛 형식(YYYYMMDD)도 그대로 읽힌다.
    const m = f && f.content && f.content.match(/\d{8}(?:\.\d+)?/);
    return m ? m[0] : null;
  }catch(e){ return null; }   // 네트워크 차단 시 예비 버전으로 폴백
}

async function checkVersion(){
  // 로컬에서 HTML 파일을 직접 열었을 때(file://)만 업데이트 체크를 한다.
  // http/https 등 웹서버로 접속한 경우(예: mockupbuilder.pages.dev)에는
  // 항상 서버가 최신본을 제공하므로 업데이트 버튼을 띄우지 않는다.
  if(location.protocol !== 'file:'){
    const bb = document.getElementById('updBtn');
    if(bb) bb.style.display = 'none';
    return;
  }
  const local = getLocalVer();
  if(!local) return;
  const b = document.getElementById('updBtn');
  // 1차: 코드에 박힌 예비 버전 (Gist 를 못 읽어도 최소한의 안내는 되도록)
  if(verNewer(REMOTE_VER, local)) showUpdBtn(REMOTE_VER, local);
  // 2차: Gist 의 verchk.txt (읽히면 이 값이 최종 판단 기준)
  const v = await fetchRemoteVer();
  if(v){
    if(verNewer(v, local)) showUpdBtn(v, local);
    else if(b) b.style.display = 'none';   // 예비값이 틀렸던 경우 되돌린다
    return;
  }
  // 3차: 버전 확인이 막힌 경우. 조용히 숨기면 새 버전이 나왔는지 알 방법이 없으므로
  // 폴더를 여는 확인 버튼을 대신 보여준다.
  if(b && b.style.display !== 'inline-block'){
    b.style.display = 'inline-block';
    b.textContent = '\u2b07 \ubc84\uc804 \ud655\uc778';
    b.title = '버전 자동 확인이 차단된 환경입니다. 누르면 다운로드 페이지가 열립니다 (현재 ver.' + local + ')';
    b.dataset.folderOnly = '1';
  }
}

// 업데이트 파일을 받아 「저장」과 같은 방식으로 위치를 골라 저장한다.
// Gist API 로 파일 내용을 직접 읽는다. raw 주소는 CDN 캐시가 오래 남고 광고 차단기에
// 걸리는 일도 있어, 버전 확인과 같은 경로(api.github.com)를 쓴다.
async function downloadUpdate(){
  const b = document.getElementById('updBtn');
  const label = b ? b.textContent : '';
  // 버전을 확인하지 못한 상태에서는 곧바로 받게 하지 않고 페이지를 열어 직접 고르게 한다.
  if(b && b.dataset.folderOnly === '1'){ window.open(UPDATE_PAGE_URL, '_blank'); return; }
  if(b){ b.disabled = true; b.textContent = '\u2b07 \ubc1b\ub294 \uc911...'; }
  try{
    const r = await fetch(`https://api.github.com/gists/${FILE_GIST_ID}?t=${Date.now()}`, {cache:'no-store'});
    if(!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    const files = j.files || {};
    const f = files[UPDATE_FILE];
    if(!f) throw new Error('파일을 찾을 수 없습니다');
    // 1MB 가 넘으면 Gist API 가 content 를 잘라 보내고 truncated 를 세운다.
    // 그때는 raw_url 로 전체를 받아온다(GitHub 은 CORS 를 허용하므로 fetch 가능).
    let text = f.content;
    if(f.truncated || !text){
      const r2 = await fetch(f.raw_url, {cache:'no-store'});
      if(!r2.ok) throw new Error('raw HTTP ' + r2.status);
      text = await r2.text();
    }
    const blob = new Blob([text], {type:'text/html'});
    // 파일명에는 버전을 붙이지 않는다. 기존 파일을 그대로 덮어써서 쓰는 사용 방식이라,
    // 버전이 붙으면 mockup_builder(1).html 처럼 사본이 쌓이고 어느 것이 최신인지 헷갈린다.
    // 현재 버전은 파일 안(좌측 하단 ver 표기)에 이미 들어 있다.
    await saveBlob(blob, UPDATE_FILE, 'HTML 파일', 'text/html', '.html');
  }catch(e){
    // 네트워크 차단·광고 차단기 등으로 실패하면 Gist 페이지를 열어 직접 받게 한다.
    alert('자동 다운로드에 실패했습니다. 열리는 페이지에서 직접 받아주세요.\n(' + e.message + ')');
    window.open(UPDATE_PAGE_URL, '_blank');
  }finally{
    if(b){ b.disabled = false; b.textContent = label; }
  }
}

// ============================================================================
// ☁ 계정(회원가입/로그인/로그아웃) + 클라우드 저장/열기 + 공유
// ----------------------------------------------------------------------------
// 처음엔 Supabase Auth(GoTrue)로 만들었으나, 이 프로그램은 사내에서 가볍게 쓰는 용도라 그정도
// 보안 장치가 과했고(이메일 형식 검증에 계속 걸리기도 했다) 아이디/비밀번호만 다루는 아주 단순한
// 방식으로 바꿨다. mb_users 테이블에 아이디·비밀번호(해시)를 직접 저장하고, 로그인 성공 여부만
// 클라이언트가 판단해 세션(로그인한 사람의 id/username)을 localStorage에 둔다.
// 주의: 이 방식은 실제 서버 인증(예: auth.uid())이 없으므로, "본인만 수정 가능" 같은 규칙은 DB가
// 강제하는 게 아니라 앱 화면 수준의 약속일 뿐이다 - 가벼운 사내용으로 쓰기로 하고 선택한 트레이드오프.
// 비밀번호는 최소한 평문으로 저장/전송하지 않도록 SHA-256으로 해시하고, mb_users 테이블 자체는
// RLS로 직접 조회를 막아(해시값이 통째로 노출되지 않도록) 로그인/중복확인은 DB 함수(RPC)로만 하게 했다.
// ============================================================================
const MB_SUPABASE_URL = 'https://jflfqxrfdjdtsxzqwpkf.supabase.co';
const MB_SUPABASE_KEY = 'sb_publishable_rwEALrEkpDBQa6pJy7ovlw_MJ9LXE6z'; // 접속로그와 같은 publishable 키
const MB_AUTH_KEY = 'mb_auth_session';

function mbGetSession(){ try{ return JSON.parse(localStorage.getItem(MB_AUTH_KEY)||'null'); }catch(e){ return null; } }
function mbSetSession(s){ try{ if(s) localStorage.setItem(MB_AUTH_KEY, JSON.stringify(s)); else localStorage.removeItem(MB_AUTH_KEY); }catch(e){} }
function mbCurrentUsername(){ const s=mbGetSession(); return s?s.username:null; }

// PostgREST(테이블/함수) 얇은 래퍼 - 실제 로그인 토큰이 없으므로 매 요청 항상 anon publishable
// 키만 사용한다. 무엇을 허용할지는 전부 각 테이블의 RLS 정책(아래 SQL)이 결정한다.
async function mbRestFetch(path,opts){
  const res=await fetch(`${MB_SUPABASE_URL}/rest/v1${path}`, Object.assign({},opts,{
    headers:Object.assign({'apikey':MB_SUPABASE_KEY,'Authorization':`Bearer ${MB_SUPABASE_KEY}`,'Content-Type':'application/json','Prefer':(opts&&opts.prefer)||'return=representation'}, (opts&&opts.headers)||{})
  }));
  if(res.status===204) return null;
  const json=await res.json().catch(()=>null);
  if(!res.ok){ throw new Error((json&&(json.message||json.error))||`요청 실패(${res.status})`); }
  return json;
}
// 비밀번호를 평문으로 저장/전송하지 않기 위한 최소한의 조치(SHA-256, 솔트 없음 - 가벼운 용도 기준).
// crypto.subtle은 https 또는 file:// 같은 "보안 컨텍스트"에서만 쓸 수 있다(대부분의 브라우저에서
// 로컬 파일도 여기 해당한다).
async function mbHashPassword(pw){
  const bytes=new TextEncoder().encode(String(pw||''));
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function mbCheckUsernameTaken(username){
  try{
    const rows=await mbRestFetch('/rpc/mb_username_exists',{method:'POST',body:JSON.stringify({p_username:username})});
    return rows===true || (Array.isArray(rows)&&rows[0]===true);
  }catch(e){ return false; } // 조회 자체가 실패해도 가입을 막지 않는다 - 최종적으로는 DB의 unique 제약이 막아준다
}
async function mbLogAuthEvent(eventType,userId,username){
  try{ await mbRestFetch('/auth_logs',{method:'POST',body:JSON.stringify({event_type:eventType,user_id:userId||null,username:username||null}),prefer:'return=minimal'}); }
  catch(e){ /* 로그 실패가 로그인/가입 자체를 막으면 안 된다 */ }
}
async function mbSignup(username,password,note){
  const password_hash=await mbHashPassword(password);
  // mb_users는 비밀번호 해시 보호를 위해 일부러 SELECT 정책을 만들지 않았다. INSERT 후 그 행을
  // 되돌려 받으려면(RETURNING) Postgres가 SELECT 권한까지 확인하는데, 그 권한이 없어서 "new row
  // violates row-level security policy"가 난다 - INSERT 자체가 아니라 이 RETURNING 때문. 아이디를
  // DB가 생성해서 돌려주게 하는 대신 브라우저에서 미리 만들어 그대로 넣으면(Prefer: return=minimal
  // 로 되돌려받지 않음) 이 문제를 완전히 피할 수 있다.
  const id=crypto.randomUUID();
  try{ await mbRestFetch('/mb_users',{method:'POST',body:JSON.stringify({id,username,password_hash,note:note||null}),prefer:'return=minimal'}); }
  catch(e){ throw new Error(/duplicate|unique/i.test(e.message)?'이미 사용 중인 아이디입니다.':e.message); }
  const session={id,username};
  mbSetSession(session);
  await mbLogAuthEvent('signup',session.id,username);
  return session;
}
async function mbLogin(username,password){
  const password_hash=await mbHashPassword(password);
  let rows;
  try{ rows=await mbRestFetch('/rpc/mb_login',{method:'POST',body:JSON.stringify({p_username:username,p_password_hash:password_hash})}); }
  catch(e){ rows=null; }
  const row=rows&&rows[0];
  if(!row){ await mbLogAuthEvent('login_failed',null,username); throw new Error('아이디 또는 비밀번호가 올바르지 않습니다.'); }
  const session={id:row.id,username:row.username};
  mbSetSession(session);
  await mbLogAuthEvent('login',session.id,session.username);
  return session;
}
async function mbLogout(){
  const s=mbGetSession();
  if(s) await mbLogAuthEvent('logout',s.id,s.username);
  mbSetSession(null);
  mbUpdateAccountUI();
}

// ---- 피드백 ----
function openFeedback(){
  const ed=document.getElementById('feedbackEditor');
  if(ed) ed.innerHTML='';
  document.getElementById('feedbackBg').classList.add('on');
  setTimeout(()=>{ const el=document.getElementById('feedbackEditor'); if(el) el.focus(); },0);
}
function closeFeedback(){ document.getElementById('feedbackBg').classList.remove('on'); }
// 아주 가벼운 서식 도구모음 - 별도 라이브러리 없이 브라우저 기본 execCommand로 굵게/기울임/
// 밑줄/목록/링크만 지원한다(이 앱은 외부 의존성 없는 단일 HTML 파일이라는 설계 원칙 때문에
// 리치텍스트 에디터 라이브러리를 새로 들여오지 않는다).
function mbFbCmd(cmd){
  const ed=document.getElementById('feedbackEditor'); if(!ed) return;
  ed.focus();
  if(cmd==='createLink'){
    const url=prompt('연결할 주소를 입력하세요.','https://');
    if(!url) return;
    document.execCommand('createLink',false,url);
    return;
  }
  document.execCommand(cmd,false,null);
}
async function submitFeedback(){
  const ed=document.getElementById('feedbackEditor'); if(!ed) return;
  const html=(ed.innerHTML||'').trim();
  const text=(ed.textContent||'').trim();
  if(!text){ alert('의견을 입력해 주세요.'); return; }
  const s=mbGetSession();
  const btn=document.getElementById('feedbackSendBtn');
  const orig=btn.textContent; btn.disabled=true; btn.textContent='보내는 중...';
  try{
    await mbRestFetch('/mb_feedback',{method:'POST',body:JSON.stringify({
      owner_id:s?s.id:null, username:s?mbCurrentUsername():null, content:html
    }),prefer:'return=minimal'});
    closeFeedback();
  }catch(e){ alert('의견을 보내지 못했습니다.\n\n'+e.message); }
  finally{ btn.disabled=false; btn.textContent=orig; }
}

// ---- 회원가입/로그인 모달 ----
function openSignup(){ document.getElementById('signupErr').style.display='none'; document.getElementById('signupId').value=''; document.getElementById('signupPw').value=''; document.getElementById('signupNote').value=''; document.getElementById('signupBg').classList.add('on'); }
function closeSignup(){ document.getElementById('signupBg').classList.remove('on'); }
// 아이디/비밀번호 저장(로그인 편의용) - localStorage에 그대로 저장한다. 비밀번호까지 평문으로
// 남기는 거라 개인 기기에서만 켜두시라고 안내할 만하지만, 사내에서 가볍게 쓰는 용도로 요청받은
// 기능이라 그대로 구현한다. 체크 해제하면 즉시 지운다.
const MB_SAVED_ID_KEY='mb_saved_username', MB_SAVED_PW_KEY='mb_saved_password', MB_AUTO_LOGIN_KEY='mb_auto_login';
function mbSaveLoginPrefs(id,pw,saveId,savePw,autoLogin){
  try{ if(saveId) localStorage.setItem(MB_SAVED_ID_KEY,id); else localStorage.removeItem(MB_SAVED_ID_KEY); }catch(e){}
  try{ if(savePw) localStorage.setItem(MB_SAVED_PW_KEY,pw); else localStorage.removeItem(MB_SAVED_PW_KEY); }catch(e){}
  // 자동로그인은 아이디·비밀번호가 둘 다 저장돼 있을 때만 의미가 있다 - 화면에서도 그 경우에만
  // 체크박스를 활성화해두지만(mbUpdateAutoLoginAvailability), 저장하는 쪽에서도 한 번 더 확인한다.
  try{ if(autoLogin&&saveId&&savePw) localStorage.setItem(MB_AUTO_LOGIN_KEY,'1'); else localStorage.removeItem(MB_AUTO_LOGIN_KEY); }catch(e){}
}
function mbLoadLoginPrefs(){
  let username=null,password=null,autoLogin=false;
  try{ username=localStorage.getItem(MB_SAVED_ID_KEY); }catch(e){}
  try{ password=localStorage.getItem(MB_SAVED_PW_KEY); }catch(e){}
  try{ autoLogin=localStorage.getItem(MB_AUTO_LOGIN_KEY)==='1'; }catch(e){}
  return {username,password,autoLogin};
}
// 자동로그인 체크박스는 아이디 저장·비밀번호 저장이 둘 다 켜져 있을 때만 쓸 수 있다. 둘 중 하나라도
// 꺼지면(체크 해제 시 즉시) 자동로그인도 강제로 꺼서, "저장 안 된 값으로 자동로그인 켜짐" 같은
// 앞뒤 안 맞는 상태가 안 생기게 한다.
function mbUpdateAutoLoginAvailability(){
  const saveId=document.getElementById('loginSaveId').checked;
  const savePw=document.getElementById('loginSavePw').checked;
  const enabled=saveId&&savePw;
  const auto=document.getElementById('loginAutoLogin');
  auto.disabled=!enabled;
  if(!enabled) auto.checked=false;
  document.getElementById('loginAutoLoginLabel').style.opacity=enabled?'1':'.45';
}
function openLogin(){
  document.getElementById('loginErr').style.display='none';
  const saved=mbLoadLoginPrefs();
  document.getElementById('loginId').value=saved.username||'';
  document.getElementById('loginPw').value=saved.password||'';
  document.getElementById('loginSaveId').checked=!!saved.username;
  document.getElementById('loginSavePw').checked=!!saved.password;
  mbUpdateAutoLoginAvailability();
  document.getElementById('loginAutoLogin').checked=saved.autoLogin&&!!saved.username&&!!saved.password;
  document.getElementById('loginBg').classList.add('on');
}
function closeLogin(){ document.getElementById('loginBg').classList.remove('on'); }
async function submitSignup(){
  const id=document.getElementById('signupId').value.trim();
  const pw=document.getElementById('signupPw').value;
  const note=document.getElementById('signupNote').value.trim();
  const errEl=document.getElementById('signupErr');
  errEl.style.display='none';
  if(!id||!pw){ errEl.textContent='아이디와 비밀번호를 입력해 주세요.'; errEl.style.display='block'; return; }
  const btn=document.getElementById('signupSubmitBtn'); btn.disabled=true; btn.textContent='확인 중...';
  try{
    if(await mbCheckUsernameTaken(id)){
      errEl.textContent='이미 사용 중인 아이디입니다.'; errEl.style.display='block';
      btn.disabled=false; btn.textContent='가입하기'; return;
    }
    btn.textContent='가입 중...';
    await mbSignup(id,pw,note);
    closeSignup(); mbUpdateAccountUI();
  }catch(e){ errEl.textContent=e.message; errEl.style.display='block'; }
  finally{ btn.disabled=false; btn.textContent='가입하기'; }
}
async function submitLogin(){
  const id=document.getElementById('loginId').value.trim();
  const pw=document.getElementById('loginPw').value;
  const saveId=document.getElementById('loginSaveId').checked;
  const savePw=document.getElementById('loginSavePw').checked;
  const autoLogin=document.getElementById('loginAutoLogin').checked;
  const errEl=document.getElementById('loginErr');
  errEl.style.display='none';
  if(!id||!pw){ errEl.textContent='아이디와 비밀번호를 입력해 주세요.'; errEl.style.display='block'; return; }
  mbSaveLoginPrefs(id,pw,saveId,savePw,autoLogin);
  const btn=document.getElementById('loginSubmitBtn'); btn.disabled=true; btn.textContent='로그인 중...';
  try{
    await mbLogin(id,pw);
    closeLogin(); mbUpdateAccountUI();
  }catch(e){ errEl.textContent=e.message; errEl.style.display='block'; }
  finally{ btn.disabled=false; btn.textContent='로그인'; }
}

// ---- 상단바 계정 영역 ----
function mbUpdateAccountUI(){
  const area=document.getElementById('acctArea'); if(!area) return;
  const s=mbGetSession();
  if(!s){
    area.innerHTML=`<button class="ghost" onclick="openLogin()">로그인</button><button class="signup-btn" onclick="openSignup()">회원가입</button>`;
    return;
  }
  const uname=mbCurrentUsername()||'사용자';
  area.innerHTML=`
    <div class="acct-avatar-wrap">
      <div class="acct-avatar" title="${esc(uname)}" onclick="toggleAcctMenu(event)">${esc(uname[0]||'?').toUpperCase()}</div>
      <div class="acct-menu" id="acctMenu">
        <div class="who">${esc(uname)} 님</div>
        <div class="item" onclick="closeAcctMenu();openCloudSave();">☁ 클라우드 저장</div>
        <div class="item" onclick="closeAcctMenu();openCloudOpen();">📂 클라우드 열기</div>
        <div class="item logout" onclick="closeAcctMenu();mbLogout();">🚪 로그아웃</div>
        <div class="item" style="border-top:1px solid #eee;" onclick="closeAcctMenu();openFeedback();">💬 Feedback</div>
      </div>
    </div>`;
}
function toggleAcctMenu(e){ e.stopPropagation(); const m=document.getElementById('acctMenu'); if(m) m.classList.toggle('on'); }
function closeAcctMenu(){ const m=document.getElementById('acctMenu'); if(m) m.classList.remove('on'); }
document.addEventListener('click',()=>{ closeAcctMenu(); });

// ---- 아이콘 조각 (목록/트리에서 반복 사용) ----
const CL_FOLDER_ICON='<svg width="17" height="14" viewBox="0 0 24 20" fill="#f0b429" style="flex-shrink:0"><path d="M2 4a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4z"/></svg>';
const CL_FILE_ICON='<svg width="15" height="17" viewBox="0 0 24 28" fill="none" stroke="#5b8bd6" stroke-width="1.6" style="flex-shrink:0"><path d="M5 2h10l6 6v18H5z"/><path d="M15 2v6h6"/></svg>';
// 씬/팻 모드를 파일 아이콘 색으로 구분한다(씬=초록, 팻=파랑) - 텍스트 배지 대신 아이콘 하나로
// 표시해서 목록이 덜 복잡해 보이게 한다.
function clFileIconByMode(mode){
  const color=mode==='Fat'?'#2f6fb0':'#1e9e6a';
  return `<svg width="15" height="17" viewBox="0 0 24 28" fill="none" stroke="${color}" stroke-width="1.8" style="flex-shrink:0" title="${mode==='Fat'?'팻모드':'씬모드'}"><path d="M5 2h10l6 6v18H5z"/><path d="M15 2v6h6"/></svg>`;
}
const CL_CHEV_RIGHT='<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="6 9 12 15 18 9" transform="rotate(-90 12 12)"/></svg>';
const CL_CHEV_DOWN='<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="6 9 12 15 18 9"/></svg>';
const CL_PENCIL_ICON='<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
const CL_TRASH_ICON='<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>';
function clFolderIconSm(on){ return on ? CL_FOLDER_ICON.replace('#f0b429','var(--ax-green-dark)') : CL_FOLDER_ICON; }
// 즐겨찾기 별 아이콘 - 채워짐(노란색)/빈 상태 두 가지. 트리의 "즐겨찾기" 폴더 아이콘과 파일
// 행의 별 토글 버튼에서 공용으로 쓴다.
function clStarIcon(filled){
  return filled
    ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="#f5b301" stroke="#f5b301" stroke-width="1.4" style="flex-shrink:0"><polygon points="12 2.5 15.1 8.9 22.2 9.9 17.1 14.9 18.3 22 12 18.6 5.7 22 6.9 14.9 1.8 9.9 8.9 8.9"/></svg>'
    : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#c3cad1" stroke-width="1.6" style="flex-shrink:0"><polygon points="12 2.5 15.1 8.9 22.2 9.9 17.1 14.9 18.3 22 12 18.6 5.7 22 6.9 14.9 1.8 9.9 8.9 8.9"/></svg>';
}
// 공유파일이 "복제해서 열기"(더블클릭 포함)된 횟수 - 작은 복제 아이콘 + 숫자만 표시한다(별도
// 텍스트 라벨 없이 아이콘으로만 의미를 전달).
function clOpenIcon(){
  return '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="2" style="flex-shrink:0"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
}
function clToggleHTML(on,onclick){
  return `<label class="cl-toggle" onclick="event.stopPropagation()"><input type="checkbox" ${on?'checked':''} onchange="${onclick}"><span class="trk"></span><span class="dot"></span></label>`;
}
function mbFmtDate(s){ if(!s) return '-'; const d=new Date(s); const p=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; }

// ---- 상태 ----
const mbCloud={ mode:'save', tab:'mine', folderId:null, folders:[], items:[], selectedId:null,
  searchQuery:'', includeSub:false, expanded:new Set(), tags:[], isPublic:true, filename:'', renamingFolderId:null, renamingItemId:null, fileCounts:{}, favCount:0, mineSort:'name',
  treeWidth:(()=>{ try{ const v=parseInt(localStorage.getItem('mb_cloud_tree_w'),10); return (v>=120&&v<=400)?v:200; }catch(e){ return 200; } })(),
  sharedQuery:'', sharedSort:'recent', sharedTag:'전체', sharedItems:[], sharedTags:['전체'], sharedSelectedId:null,
  sharedLineage:'originals', // '전체'가 아니라 '원본만'을 기본값으로 - 공유가 쌓일수록 목록이 리비전으로 뒤덮이지 않게 한다
  sharedOriginFilter:null, sharedOriginFilterTitle:'', // 특정 원본의 리비전만 보는 중이면 그 원본 id/제목
  sharedCounts:null, // {originals, revisions, all} - 지금 검색어/태그 조건 기준으로 각각 몇 개인지
  sharedOffset:0, sharedHasMore:true, sharedLoadingMore:false,
  sharedView:(()=>{ try{ return localStorage.getItem('mb_cloud_shared_view')||'grid'; }catch(e){ return 'grid'; } })(),
  sharedListWidth:(()=>{ try{ const v=parseInt(localStorage.getItem('mb_cloud_shared_list_w'),10); return (v>=200&&v<=560)?v:300; }catch(e){ return 300; } })(),
  tagbarExpanded:false,
  // 지금 편집 중인 캔버스가 「공유파일」에서 열어온 파생본이면, 그 최상위 원본 mockups.id를
  // 여기 담아둔다(눈에는 안 보이는 내부 추적용 값). null이면 파생 관계 없음(=원본이거나
  // 완전히 새로 시작한 화면). 저장할 때 이 값을 함께 보내 서버의 origin_id 컬럼에 기록하고,
  // 전체지우기·불러오기·이미지변환 전체지우기·모드전환처럼 캔버스가 통째로 새로 시작되는
  // 시점에는 clearOriginTracking()으로 함께 지운다(아래 참고).
  originId:null };
// 캔버스가 "새로 시작"되는 모든 지점(전체 지우기/불러오기/이미지 변환 전체 지우기 체크/모드 전환)에서
// 공통으로 호출해 파생 추적 값을 지운다 - 원본-파생 관계는 "공유파일을 열어서 그대로 이어 작업"할
// 때만 의미가 있고, 캔버스 내용이 다른 것으로 통째로 바뀌는 순간부터는 더 이상 그 출처와 무관해진다.
function clearOriginTracking(){ mbCloud.originId=null; }

function mbCurrentMode(){ return document.body.classList.contains('skin-classic')?'Fat':'Thin'; }
function mbBuildSaveData(){
  const cw=document.getElementById('cw').value, ch=document.getElementById('ch').value;
  const data={v:1, comps, cw, ch, skin:document.body.classList.contains('skin-classic')?'fat':'thin'};
  // 파생 출처를 저장 파일 자체에도 "눈에 안 보이는" 내부 태그로 함께 담아 둔다 - DB의 origin_id
  // 컬럼과 별개로, 이 데이터 블록만 어딘가로 옮겨지거나 내려받아져도 출처 정보가 함께 따라간다.
  // 편집 화면에는 어디에도 표시되지 않고, 오직 이 JSON 안에만 존재한다.
  if(mbCloud.originId) data.originId=mbCloud.originId;
  return data;
}
// "공유파일" 카드의 미리보기 이미지 - 실제 화면을 그대로 캡처하려면 별도 라이브러리(html2canvas
// 등)나 서버 렌더링이 필요해서, 이 앱의 "단일 HTML, 외부 의존성 없음" 원칙에 맞게 여전히 SVG로
// 직접 그리지만, 예전의 "타입별 색깔 사각형" 와이어프레임보다 실제 화면에 훨씬 가깝게 그린다:
// 입력창은 흰 배경+테두리 박스로, 그리드는 헤더행+컬럼 구분선+데이터 행 줄무늬가 있는 표로,
// 버튼은 초록/테두리 버튼으로, 그리고 각 컴포넌트의 실제 텍스트(c.text 등)를 칸 폭에 맞게
// 잘라서 넣는다. panel/tabs/split 안에 중첩된 컴포넌트도 (지금 켜진 탭 기준으로) 실제 절대
// 좌표를 계산해 같이 그려서, 그룹으로 묶인 필드들도 빠짐없이 보이게 했다.
const MB_THUMB_COLORS={grid:'#5b8bd6',button:'#1e9e6a',title:'#2c3e50',section:'#8a97a3',panel:'#c3cad1',
  input:'#a9c4e8',combo:'#a9c4e8',date:'#a9c4e8',daterange:'#a9c4e8',check:'#f0b429',radio:'#f0b429',
  label:'#9ca3af',chart:'#8e44ad',tree:'#c0392b',tabs:'#7c5cff',split:'#d9dee3',searchbar:'#0891b2',popup:'#7c5cff'};
function mbThumbEsc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
// 실제 글자 폭을 재서(autoColWidth()가 그리드 헤더 폭을 잴 때 쓰는 것과 같은 캔버스 측정 방식)
// 칸 폭에 안 맞으면 말줄임(…)으로 잘라준다 - 대충 글자 수로 어림하는 것보다 훨씬 정확하다.
function mbThumbFit(text,maxW,fontPx,weight){
  text=String(text==null?'':text).trim();
  if(!text||maxW<=1) return '';
  if(!__gcMeasureCtx) __gcMeasureCtx=document.createElement('canvas').getContext('2d');
  __gcMeasureCtx.font=`${weight||400} ${fontPx}px "Malgun Gothic","맑은 고딕",-apple-system,sans-serif`;
  if(__gcMeasureCtx.measureText(text).width<=maxW) return text;
  let lo=0,hi=text.length;
  while(lo<hi){
    const mid=(lo+hi+1)>>1;
    if(__gcMeasureCtx.measureText(text.slice(0,mid)+'…').width<=maxW) lo=mid; else hi=mid-1;
  }
  return lo>0?text.slice(0,lo)+'…':'';
}
function mbBuildThumbnailSVG(){
  const cw=parseInt(document.getElementById('cw').value,10)||1100;
  const ch=parseInt(document.getElementById('ch').value,10)||700;
  const W=320,H=200; // 예전(240x140)보다 캔버스를 키워서 텍스트가 조금이라도 더 잘 보이게 한다
  const scale=Math.min(W/cw,H/ch);
  const offX=(W-cw*scale)/2, offY=(H-ch*scale)/2;
  // 지금 켜진 스킨(씬/팻)의 실제 CSS 색상 변수를 그대로 읽어써서, 어떤 스킨으로 저장했든
  // 미리보기 색감이 실제 화면과 맞게 한다.
  const csv=getComputedStyle(document.body);
  const cvar=(name,fb)=>{ const v=(csv.getPropertyValue(name)||'').trim(); return v||fb; };
  const C={green:cvar('--ax-green','#1e9e6a'), navy:cvar('--ax-navy','#2c3e50'), border:cvar('--ax-border','#d9dee3'),
    gridHead:cvar('--ax-grid-head','#f0f2f4'), gridHeadFg:cvar('--ax-grid-head-fg','#4b5563'),
    gray:cvar('--ax-gray','#6b7280'), labelFg:cvar('--ax-label-fg','#374151'),
    reqBg:cvar('--ax-required-bg','#fffdf4'), roBg:cvar('--ax-readonly-bg','#f6f7f8')};
  const FF='font-family="Malgun Gothic, 맑은 고딕, -apple-system, sans-serif"';
  let body='';
  // isVisible()은 panel/split/tabs 안에 중첩된 컴포넌트까지 포함해서(탭은 지금 활성화된 탭만),
  // absPos()는 그 중첩 컴포넌트의 캔버스 기준 절대좌표를 계산해준다 - 둘 다 편집기 자체가 이미
  // 쓰고 있는 함수라 여기서도 그대로 재사용한다.
  comps.filter(isVisible).forEach(c=>{
    const ap=absPos(c);
    const x=offX+ap.x*scale, y=offY+ap.y*scale, w=Math.max(1,c.w*scale), h=Math.max(1,c.h*scale);
    body+=mbThumbDrawComp(c,x,y,w,h,C,FF);
  });
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet"><rect width="${W}" height="${H}" fill="#ffffff"/><rect x="0.5" y="0.5" width="${W-1}" height="${H-1}" fill="none" stroke="${C.border}"/>${body}</svg>`;
}
function mbThumbDrawComp(c,x,y,w,h,C,FF){
  const e=mbThumbEsc;
  const fs=Math.max(3,Math.min(8,h*0.5));
  switch(c.type){
    case 'title':
      return `<text x="${x.toFixed(1)}" y="${(y+h*0.72).toFixed(1)}" font-size="${(fs+1).toFixed(1)}" font-weight="700" fill="${C.navy}" ${FF}>${e(mbThumbFit(c.text,w,fs+1,700))}</text>`;
    case 'section':
      return `<text x="${x.toFixed(1)}" y="${(y+h*0.68).toFixed(1)}" font-size="${fs.toFixed(1)}" font-weight="700" fill="${C.navy}" ${FF}>${e(mbThumbFit(c.text,w,fs,700))}</text>`
        +`<line x1="${x.toFixed(1)}" y1="${(y+h).toFixed(1)}" x2="${(x+w).toFixed(1)}" y2="${(y+h).toFixed(1)}" stroke="${C.border}" stroke-width="0.6"/>`;
    case 'label':
      return `<text x="${x.toFixed(1)}" y="${(y+h*0.7).toFixed(1)}" font-size="${fs.toFixed(1)}" fill="${C.labelFg}" ${FF}>${e(mbThumbFit(c.text,w,fs,400))}</text>`;
    case 'panel': case 'split':
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="none" stroke="${C.border}" stroke-width="0.6" rx="1"/>`;
    case 'tabs':{
      const names=ilItems(c,'text'); if(!names.length) return '';
      const tabH=Math.min(h,h*0.4)||fs+2, tabW=Math.min(w/names.length,w*0.4);
      const active=c.active||0;
      let out='', tx=x;
      names.forEach((n,i)=>{
        const on=i===active;
        out+=`<text x="${(tx+2).toFixed(1)}" y="${(y+tabH*0.72).toFixed(1)}" font-size="${Math.max(3,fs-0.5).toFixed(1)}" fill="${on?C.green:C.gray}" font-weight="${on?700:400}" ${FF}>${e(mbThumbFit(n,tabW-3,fs,on?700:400))}</text>`;
        if(on) out+=`<line x1="${tx.toFixed(1)}" y1="${(y+tabH).toFixed(1)}" x2="${(tx+tabW-4).toFixed(1)}" y2="${(y+tabH).toFixed(1)}" stroke="${C.green}" stroke-width="1"/>`;
        tx+=tabW;
      });
      out+=`<line x1="${x.toFixed(1)}" y1="${(y+tabH).toFixed(1)}" x2="${(x+w).toFixed(1)}" y2="${(y+tabH).toFixed(1)}" stroke="${C.border}" stroke-width="0.5"/>`;
      return out;
    }
    case 'button':{
      const ghost=!!c.ghost;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(3,h*0.2).toFixed(1)}" fill="${ghost?'#fff':C.green}" stroke="${C.green}" stroke-width="0.6"/>`
        +`<text x="${(x+w/2).toFixed(1)}" y="${(y+h*0.66).toFixed(1)}" font-size="${fs.toFixed(1)}" font-weight="700" fill="${ghost?C.green:'#fff'}" text-anchor="middle" ${FF}>${e(mbThumbFit(c.text,w-2,fs,700))}</text>`;
    }
    case 'check':{
      const box=Math.max(2,Math.min(h*0.6,w*0.25,6));
      return `<rect x="${x.toFixed(1)}" y="${(y+(h-box)/2).toFixed(1)}" width="${box.toFixed(1)}" height="${box.toFixed(1)}" rx="1" fill="#fff" stroke="${C.border}" stroke-width="0.6"/>`
        +`<text x="${(x+box+3).toFixed(1)}" y="${(y+h*0.68).toFixed(1)}" font-size="${fs.toFixed(1)}" fill="${C.labelFg}" ${FF}>${e(mbThumbFit(c.text,w-box-4,fs,400))}</text>`;
    }
    case 'radio':{
      const r=Math.max(1,Math.min(h*0.3,w*0.12,3));
      const opts=(c.options||'').split(',').map(s=>s.trim()).filter(Boolean);
      const label=opts.length?opts[0]:c.text;
      return `<circle cx="${(x+r+1).toFixed(1)}" cy="${(y+h/2).toFixed(1)}" r="${r.toFixed(1)}" fill="#fff" stroke="${C.border}" stroke-width="0.6"/>`
        +`<text x="${(x+r*2+4).toFixed(1)}" y="${(y+h*0.68).toFixed(1)}" font-size="${fs.toFixed(1)}" fill="${C.labelFg}" ${FF}>${e(mbThumbFit(label,w-r*2-6,fs,400))}</text>`;
    }
    case 'input': case 'date': case 'daterange': case 'popup':{
      const bg=c.readonly?C.roBg:(c.required?C.reqBg:'#fff');
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(2,h*0.15).toFixed(1)}" fill="${bg}" stroke="${C.border}" stroke-width="0.6"/>`
        +`<text x="${(x+3).toFixed(1)}" y="${(y+h*0.66).toFixed(1)}" font-size="${fs.toFixed(1)}" fill="#333" ${FF}>${e(mbThumbFit(c.text,w-6,fs,400))}</text>`;
    }
    case 'combo':{
      const bg=c.readonly?C.roBg:(c.required?C.reqBg:'#fff');
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(2,h*0.15).toFixed(1)}" fill="${bg}" stroke="${C.border}" stroke-width="0.6"/>`
        +`<text x="${(x+3).toFixed(1)}" y="${(y+h*0.66).toFixed(1)}" font-size="${fs.toFixed(1)}" fill="#333" ${FF}>${e(mbThumbFit(c.text,w-12,fs,400))}</text>`
        +`<text x="${(x+w-7).toFixed(1)}" y="${(y+h*0.66).toFixed(1)}" font-size="${fs.toFixed(1)}" fill="${C.gray}" ${FF}>▾</text>`;
    }
    case 'searchbar':
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(3,h*0.2).toFixed(1)}" fill="#fff" stroke="${C.border}" stroke-width="0.6"/>`
        +`<circle cx="${(x+w-9).toFixed(1)}" cy="${(y+h/2-1).toFixed(1)}" r="2" fill="none" stroke="${C.gray}" stroke-width="0.6"/>`;
    case 'tree':{
      let out=`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="#fff" stroke="${C.border}" stroke-width="0.6"/>`;
      const step=fs+2, rows=Math.max(1,Math.min(5,Math.floor(h/step)));
      for(let i=0;i<rows;i++){
        const ry=y+3+i*step, indent=3+(i%3)*4;
        out+=`<line x1="${(x+indent).toFixed(1)}" y1="${ry.toFixed(1)}" x2="${Math.min(x+w-3,x+indent+w*0.4).toFixed(1)}" y2="${ry.toFixed(1)}" stroke="${MB_THUMB_COLORS.tree}" stroke-width="0.8" stroke-opacity=".45"/>`;
      }
      return out;
    }
    case 'chart':{
      let out=`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="#fbfbfc" stroke="${C.border}" stroke-width="0.6"/>`;
      const n=4, bw=Math.max(1,w/(n*2.4));
      for(let i=0;i<n;i++){
        const bh=h*0.18+(h*0.55)*((i%3)+1)/3;
        const bx=x+w*0.1+i*bw*2;
        out+=`<rect x="${bx.toFixed(1)}" y="${(y+h-bh-2).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" fill="${MB_THUMB_COLORS.chart}" fill-opacity=".55"/>`;
      }
      return out;
    }
    case 'grid':
      return mbThumbDrawGrid(c,x,y,w,h,C,FF);
    default:{
      const color=MB_THUMB_COLORS[c.type]||'#9ca3af';
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${color}" fill-opacity=".18" stroke="${color}" stroke-width="0.6" rx="1"/>`;
    }
  }
}
// 그리드는 ERP 화면에서 가장 눈에 띄는 요소라 별도 함수로 - 헤더행(색 채우기+컬럼 구분선+가능하면
// 헤더 글자)과 그 아래 데이터 행 몇 줄(옅은 줄무늬)을 그려서 "표"라는 걸 한눈에 알아보게 한다.
function mbThumbDrawGrid(c,x,y,w,h,C,FF){
  const e=mbThumbEsc;
  const cols=gridColsArr(c);
  const headH=Math.max(3,Math.min(h*0.28,7));
  let out=`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="1" fill="#fff" stroke="${C.border}" stroke-width="0.6"/>`;
  out+=`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${headH.toFixed(1)}" fill="${C.gridHead}"/>`;
  const n=Math.max(1,Math.min(cols.length||4,10));
  const colW=w/n;
  const fs=Math.max(2.6,Math.min(5,headH*0.8));
  for(let i=0;i<n;i++){
    const cx=x+i*colW;
    if(i>0) out+=`<line x1="${cx.toFixed(1)}" y1="${y.toFixed(1)}" x2="${cx.toFixed(1)}" y2="${(y+h).toFixed(1)}" stroke="${C.border}" stroke-width="0.4"/>`;
    if(cols[i]&&colW>fs*1.8) out+=`<text x="${(cx+2).toFixed(1)}" y="${(y+headH*0.78).toFixed(1)}" font-size="${fs.toFixed(1)}" font-weight="700" fill="${C.gridHeadFg}" ${FF}>${e(mbThumbFit(cols[i],colW-3,fs,700))}</text>`;
  }
  const rowH=Math.max(3,Math.min(8,(h-headH)/4));
  let ry=y+headH, ri=0;
  while(ry<y+h-0.5){
    const rh=Math.min(rowH,y+h-ry);
    if(ri%2===1) out+=`<rect x="${x.toFixed(1)}" y="${ry.toFixed(1)}" width="${w.toFixed(1)}" height="${rh.toFixed(1)}" fill="#f7f8f9"/>`;
    out+=`<line x1="${x.toFixed(1)}" y1="${(ry+rh).toFixed(1)}" x2="${(x+w).toFixed(1)}" y2="${(ry+rh).toFixed(1)}" stroke="#eef0f2" stroke-width="0.4"/>`;
    ry+=rh; ri++;
  }
  return out;
}
function openCloudSave(){
  if(!mbGetSession()){ openLogin(); return; }
  Object.assign(mbCloud,{mode:'save',tab:'mine',folderId:null,selectedId:null,searchQuery:'',includeSub:false,
    tags:[],isPublic:true,filename:screenTitle()||'제목 없음'});
  document.getElementById('cloudTitle').textContent='☁ 클라우드에 저장';
  document.getElementById('cloudBg').classList.add('on');
  mbCloudApplySavedModalSize();
  const tasks=[mbCloudLoadFolders(),mbCloudLoadItems(),mbCloudLoadFileCounts()];
  // 지금 화면이 공유파일에서 이어온 리비전이면(mbCloud.originId), 저장 팝업 하단 태그 입력칸을
  // 원본의 태그로 미리 채워 둔다 - 그대로 저장해도 되고, 자유롭게 더하거나 지우고 저장해도 된다.
  // (아래 목록에서 기존 파일을 골라 덮어쓰기를 선택하면, 그 파일 자신의 태그가 대신 채워진다 -
  // 명시적으로 고른 파일이 우선이다.)
  if(mbCloud.originId) tasks.push(mbCloudPrefillOriginTags());
  Promise.all(tasks).then(mbCloudRender);
}
async function mbCloudPrefillOriginTags(){
  try{
    const rows=await mbRestFetch(`/mockups?id=eq.${mbCloud.originId}&select=tags`);
    const tags=rows&&rows[0]&&Array.isArray(rows[0].tags)?rows[0].tags:[];
    mbCloud.tags=[...tags];
  }catch(e){ /* 실패해도 태그 없이 저장을 진행할 수 있어야 하므로 조용히 무시 */ }
}
function openCloudOpen(){
  if(!mbGetSession()){ openLogin(); return; }
  Object.assign(mbCloud,{mode:'open',tab:'mine',folderId:null,selectedId:null,searchQuery:'',includeSub:false});
  document.getElementById('cloudTitle').textContent='☁ 클라우드에서 열기';
  document.getElementById('cloudBg').classList.add('on');
  mbCloudApplySavedModalSize();
  Promise.all([mbCloudLoadFolders(),mbCloudLoadItems(),mbCloudLoadFileCounts()]).then(mbCloudRender);
}
function closeCloud(){ document.getElementById('cloudBg').classList.remove('on'); }
// 클라우드 저장/열기 팝업 크기 조절 - 우측 하단 손잡이를 드래그(캔버스 크기 조절과 같은 방식).
// 탭(내 파일/공유파일)을 바꿔도 이 팝업 자체 크기는 안 바뀌게, 각 탭 내용은 flex:1로 남은 공간을
// 채우도록 만들었다(고정 픽셀 높이 대신) - 그래서 탭이 달라도 팝업 크기는 항상 동일하게 유지된다.
function mbCloudApplySavedModalSize(){
  const modal=document.getElementById('cloudModal'); if(!modal) return;
  try{
    const w=localStorage.getItem('mb_cloud_modal_w'), h=localStorage.getItem('mb_cloud_modal_h');
    if(w) modal.style.width=w;
    if(h) modal.style.height=h;
  }catch(e){}
}
let mbCloudResizeDrag=null;
function mbCloudResizeStart(e){
  e.preventDefault();
  const modal=document.getElementById('cloudModal'); if(!modal) return;
  const rect=modal.getBoundingClientRect();
  mbCloudResizeDrag={startX:e.clientX,startY:e.clientY,startW:rect.width,startH:rect.height};
  document.addEventListener('mousemove',mbCloudResizeMove);
  document.addEventListener('mouseup',mbCloudResizeEnd);
}
function mbCloudResizeMove(e){
  if(!mbCloudResizeDrag) return;
  const modal=document.getElementById('cloudModal'); if(!modal) return;
  const w=Math.max(640,Math.min(window.innerWidth*0.97,mbCloudResizeDrag.startW+(e.clientX-mbCloudResizeDrag.startX)));
  const h=Math.max(420,Math.min(window.innerHeight*0.92,mbCloudResizeDrag.startH+(e.clientY-mbCloudResizeDrag.startY)));
  modal.style.width=w+'px';
  modal.style.height=h+'px';
  if(document.getElementById('cloudTagbar')) mbCloudInitTagBar(); // 팝업 폭이 바뀌면 한 줄에 들어가는 칩 수, 즉 2줄을 넘는지 여부도 같이 바뀔 수 있다
  mbCloudFitSharedPreview(); // 팝업 크기가 바뀌면 공유파일 미리보기 iframe의 배율도 다시 맞춘다
}
function mbCloudResizeEnd(){
  mbCloudResizeDrag=null;
  document.removeEventListener('mousemove',mbCloudResizeMove);
  document.removeEventListener('mouseup',mbCloudResizeEnd);
  const modal=document.getElementById('cloudModal'); if(!modal) return;
  try{ localStorage.setItem('mb_cloud_modal_w',modal.style.width); localStorage.setItem('mb_cloud_modal_h',modal.style.height); }catch(e){}
}

function mbFolderChildren(parentId){ return mbCloud.folders.filter(f=>(f.parent_id||null)===(parentId||null)); }
function mbFolderPathTo(id){ const path=[]; let cur=id; while(cur){ const f=mbCloud.folders.find(x=>x.id===cur); if(!f)break; path.unshift(f); cur=f.parent_id; } return path; }
function mbFolderDescendantIds(id){ const out=[]; const stack=[id]; while(stack.length){ const cur=stack.pop(); mbFolderChildren(cur).forEach(f=>{ out.push(f.id); stack.push(f.id); }); } return out; }

async function mbCloudLoadFolders(){
  const s=mbGetSession(); if(!s){ mbCloud.folders=[]; return; }
  try{ mbCloud.folders=await mbRestFetch(`/mockup_folders?owner_id=eq.${s.id}&select=id,parent_id,name&order=name.asc`)||[]; }
  catch(e){ mbCloud.folders=[]; }
}
// 폴더트리에 폴더별 파일 개수를 보여주기 위해, 파일 본문(jsonb) 없이 folder_id만 가볍게 전부
// 가져와서 클라이언트에서 센다. 직접 들어있는 파일 개수만 세고(하위 폴더 것까지 합산하지는 않음) -
// 탐색기에서 흔히 보는 방식과 같다.
async function mbCloudLoadFileCounts(){
  const s=mbGetSession(); if(!s){ mbCloud.fileCounts={}; mbCloud.favCount=0; return; }
  try{
    // 지금 켜진 모드(씬/팻)와 다른 모드로 저장된 파일은 애초에 열 수도 없으니 개수에도 안 잡히게,
    // 목록(mbCloudLoadItems)과 똑같이 mode=eq.<현재모드> 로 걸러서 센다.
    const rows=await mbRestFetch(`/mockups?owner_id=eq.${s.id}&mode=eq.${mbCurrentMode()}&select=folder_id,is_favorite`)||[];
    const counts={}; let fav=0;
    rows.forEach(r=>{ const k=r.folder_id||'__root__'; counts[k]=(counts[k]||0)+1; if(r.is_favorite) fav++; });
    mbCloud.fileCounts=counts; mbCloud.favCount=fav;
  }catch(e){ mbCloud.fileCounts={}; mbCloud.favCount=0; }
}
// '__fav__'는 실제 폴더가 아니라 즐겨찾기만 모아 보여주는 가상 폴더 id다(폴더트리에서
// "전체 파일"과 같은 레벨의 별도 항목으로 표시됨) - mbCloud.folderId에 이 값이 들어오면
// 폴더 구분 없이 is_favorite=true인 파일만 모아서 보여준다.
const MB_FAV_FOLDER='__fav__';
async function mbCloudLoadItems(){
  const s=mbGetSession(); if(!s){ mbCloud.items=[]; return; }
  // 씬모드에서 저장한 파일과 팻모드에서 저장한 파일은 구조가 달라 서로 호환되지 않으므로,
  // "내 파일" 목록도 지금 켜진 모드에 해당하는 것만 보여준다(공유파일 탭과 같은 기준).
  let q=`/mockups?owner_id=eq.${s.id}&mode=eq.${mbCurrentMode()}&select=id,title,tags,is_public,mode,created_at,updated_at,folder_id,is_favorite&order=updated_at.desc`;
  if(mbCloud.folderId===MB_FAV_FOLDER){
    q+='&is_favorite=eq.true';
  }else if(mbCloud.searchQuery && mbCloud.includeSub){
    if(mbCloud.folderId!=null){
      const ids=[mbCloud.folderId,...mbFolderDescendantIds(mbCloud.folderId)];
      q+=`&folder_id=in.(${ids.join(',')})`;
    } // 전체 파일에서 하위 폴더 포함 검색이면 폴더 제한 없이 전체 대상
  }else{
    q += mbCloud.folderId==null ? '&folder_id=is.null' : `&folder_id=eq.${mbCloud.folderId}`;
  }
  if(mbCloud.searchQuery) q+=`&title=ilike.*${encodeURIComponent(mbCloud.searchQuery)}*`;
  try{ mbCloud.items=await mbRestFetch(q)||[]; }catch(e){ mbCloud.items=[]; }
}
// 공유파일이 많아지면 한 번에 다 불러오는 건 느리고 낭비이므로, 100개씩 끊어서 불러온다
// (처음 열 때 100개, 스크롤을 끝까지 내리면 다음 100개... 이런 식으로 이어붙인다).
// 검색어/정렬/태그 필터처럼 "완전히 새로 불러와야 하는" 조건은 mbCloudLoadShared()가 처음부터
// 다시 받아오고, 스크롤로 이어받는 쪽은 mbCloudLoadSharedMore()가 담당한다 - 둘 다 같은 쿼리
// 조건(검색어/정렬/태그)을 써야 하므로 mbCloudSharedBaseQuery()로 공통화해둔다.
const MB_SHARED_PAGE_SIZE=100;
function mbCloudSharedOrderClause(){
  // "작성자순"은 mockups 테이블에 없는 값(username)으로 정렬해야 해서 서버 쿼리로는 못 하고,
  // 아래에서 사용자 이름을 붙인 뒤 클라이언트에서 다시 정렬한다 - 여기서는 그냥 기본 순서로 받아온다.
  const orderMap={ recent:'created_at.desc', oldest:'created_at.asc', title:'title.asc', author:'created_at.desc' };
  return orderMap[mbCloud.sharedSort] || orderMap.recent;
}
// 검색어/태그 조건만 떼어낸 것 - 목록 조회와 원본/전체/리비전 개수 집계가 항상 같은 조건을
// 쓰도록(검색하면 "검색된 결과 안에서의" 개수가 나오도록) 하나로 합쳐 둔다.
function mbCloudSharedFilterClause(){
  let q=`is_public=eq.true&mode=eq.${mbCurrentMode()}`;
  if(mbCloud.sharedQuery) q+=`&title=ilike.*${encodeURIComponent(mbCloud.sharedQuery)}*`;
  if(mbCloud.sharedTag && mbCloud.sharedTag!=='전체') q+=`&tags=cs.{${encodeURIComponent(mbCloud.sharedTag)}}`;
  return q;
}
function mbCloudSharedBaseQuery(){
  let q=`/mockups?${mbCloudSharedFilterClause()}&select=id,title,tags,created_at,owner_id,thumbnail,open_count,origin_id`;
  q += '&order=' + mbCloudSharedOrderClause();
  // 특정 원본의 리비전만 콕 집어 보는 중이면(배지 클릭), 원본만/전체/리비전만 칩은 무시하고
  // 그 원본 id를 정확히 참조하는 것들만 가져온다 - 제목 검색이 아니라 실제 origin_id로 걸기
  // 때문에 이름이 같은 다른 원본과 섞일 일이 없다.
  if(mbCloud.sharedOriginFilter) q+=`&origin_id=eq.${mbCloud.sharedOriginFilter}`;
  else if(mbCloud.sharedLineage==='originals') q+='&origin_id=is.null';
  else if(mbCloud.sharedLineage==='revisions') q+='&origin_id=not.is.null';
  return q;
}
// 실제 데이터는 안 받고 PostgREST의 Content-Range 헤더만으로 "몇 개인지"를 가볍게 물어본다
// (HEAD + Prefer: count=exact). 목록을 통째로 내려받지 않아도 되니 개수가 아무리 많아도 가볍다.
async function mbRestCount(path){
  try{
    const res=await fetch(`${MB_SUPABASE_URL}/rest/v1${path}`,{
      method:'HEAD',
      headers:{'apikey':MB_SUPABASE_KEY,'Authorization':`Bearer ${MB_SUPABASE_KEY}`,'Prefer':'count=exact'}
    });
    const range=res.headers.get('content-range'); // 예: "0-9/23" 또는 총 0개면 "*/0"
    if(!range) return 0;
    const total=range.split('/')[1];
    return total==='*'?0:(parseInt(total,10)||0);
  }catch(e){ return 0; }
}
// 원본만/전체/리비전만 칩에 붙는 "총 N개" 숫자 - 지금 검색어/태그 조건은 그대로 유지한 채
// (즉 검색을 하면 그 검색 결과 범위 안에서의 개수로) 원본/리비전 개수만 따로 센 뒤 더해서 전체를
// 계산한다. 드릴다운(특정 원본의 리비전만 보는 중) 모드에서는 세그먼트 바 자체가 안 뜨므로 호출하지 않는다.
async function mbCloudLoadSharedLineageCounts(){
  const base=mbCloudSharedFilterClause();
  try{
    const [originals,revisions]=await Promise.all([
      mbRestCount(`/mockups?${base}&origin_id=is.null`),
      mbRestCount(`/mockups?${base}&origin_id=not.is.null`)
    ]);
    mbCloud.sharedCounts={originals,revisions,all:originals+revisions};
  }catch(e){ mbCloud.sharedCounts=null; }
}
async function mbCloudLoadShared(){
  mbCloud.sharedOffset=0; mbCloud.sharedHasMore=true;
  const q=mbCloudSharedBaseQuery()+`&limit=${MB_SHARED_PAGE_SIZE}&offset=0`;
  // 특정 원본의 리비전만 보는 드릴다운 중에는 세그먼트 바 자체가 안 뜨니 개수를 새로 셀 필요 없다.
  const countsTask=mbCloud.sharedOriginFilter?Promise.resolve():mbCloudLoadSharedLineageCounts();
  try{
    const rows=await mbRestFetch(q)||[];
    mbCloud.sharedItems=rows;
    mbCloud.sharedHasMore=rows.length===MB_SHARED_PAGE_SIZE;
    mbCloud.sharedOffset=rows.length;
    await mbCloudAttachUsernames(mbCloud.sharedItems);
    await mbCloudAttachRevisionCounts(mbCloud.sharedItems);
    if(mbCloud.sharedSort==='author'){
      mbCloud.sharedItems.sort((a,b)=>(a.username||'').localeCompare(b.username||'','ko'));
    }
    await mbCloudLoadSharedTags();
  }catch(e){ mbCloud.sharedItems=[]; mbCloud.sharedHasMore=false; mbCloud.sharedTags=['전체']; }
  await countsTask;
}
// 지금 화면에 보이는 원본들(origin_id가 없는 항목)에 한해서만, "여기서 파생된 리비전이 몇 개인지"를
// mockup_derivative_counts 뷰에서 한 번에 물어와 각 항목에 derivative_count로 붙여준다. 목록 전체를
// 매번 다시 스캔하지 않고 지금 페이지에 보이는 원본 id만 물어보므로, 목록이 아무리 커져도 이 조회
// 자체는 가볍다.
async function mbCloudAttachRevisionCounts(items){
  const originIds=items.filter(it=>!it.origin_id).map(it=>it.id);
  if(!originIds.length) return;
  try{
    const rows=await mbRestFetch(`/mockup_derivative_counts?origin_id=in.(${originIds.join(',')})`)||[];
    const countMap={}; rows.forEach(r=>{ countMap[r.origin_id]=r.derivative_count; });
    items.forEach(it=>{ if(!it.origin_id) it.derivative_count=countMap[it.id]||0; });
  }catch(e){ /* 실패해도 배지만 안 뜰 뿐, 목록 자체는 정상 표시 */ }
}
function mbCloudSharedLineageClick(v){ mbCloud.sharedLineage=v; mbCloud.sharedOriginFilter=null; mbCloud.sharedOriginFilterTitle=''; mbCloudLoadShared().then(mbCloudRenderAndFillShared); }
// 원본 카드의 리비전 개수 배지를 눌렀을 때: 그 원본의 리비전들만 콕 집어 보여주는 "돋보기" 모드로
// 들어간다. 검색창/태그 필터는 그대로 두고(다시 눌러 빠져나오면 원래 보던 조건 그대로 이어지도록),
// 위쪽에 "◀ 뒤로 · '제목'의 리비전" 알림줄만 추가로 얹는다.
function mbCloudShowRevisionsOf(originId){
  // 제목 문자열을 onclick 안에 직접 끼워 넣으면(따옴표 등 특수문자가 있는 제목일 때 깨질 수
  // 있어) id만 넘기고, 이미 불러와 둔 목록에서 제목을 안전하게 찾아 쓴다.
  const it=mbCloud.sharedItems.find(x=>x.id===originId);
  mbCloud.sharedOriginFilter=originId;
  mbCloud.sharedOriginFilterTitle=it?it.title:'';
  mbCloudLoadShared().then(mbCloudRenderAndFillShared);
}
function mbCloudClearOriginFilter(){
  mbCloud.sharedOriginFilter=null; mbCloud.sharedOriginFilterTitle='';
  mbCloudLoadShared().then(mbCloudRenderAndFillShared);
}
// 태그 필터 칩 목록은 "지금까지 불러온 항목"이 아니라(그럼 아직 안 불러온 뒤쪽 페이지에만 있는
// 태그는 필터로 고를 수조차 없게 된다) 검색 조건에 맞는 전체 데이터에서 따로, 가볍게(태그만)
// 조회해서 채운다. 지금 선택된 태그 자체는 이 쿼리에 걸지 않아, 다른 태그로 바꿔 누를 수 있게 둔다.
async function mbCloudLoadSharedTags(){
  try{
    let q=`/mockups?is_public=eq.true&mode=eq.${mbCurrentMode()}&select=tags`;
    if(mbCloud.sharedQuery) q+=`&title=ilike.*${encodeURIComponent(mbCloud.sharedQuery)}*`;
    const rows=await mbRestFetch(q)||[];
    const tagSet=new Set(); rows.forEach(r=>(r.tags||[]).forEach(t=>tagSet.add(t)));
    mbCloud.sharedTags=['전체',...Array.from(tagSet).sort((a,b)=>a.localeCompare(b,'ko'))];
  }catch(e){ mbCloud.sharedTags=['전체']; }
}
// 스크롤을 끝까지 내렸을 때(또는 처음 페이지만으로 화면이 다 안 채워질 때) 다음 100개를 이어붙인다.
async function mbCloudLoadSharedMore(){
  if(mbCloud.sharedLoadingMore || !mbCloud.sharedHasMore) return;
  mbCloud.sharedLoadingMore=true;
  mbCloudRenderKeepScroll(); // "더 불러오는 중..." 표시
  try{
    const q=mbCloudSharedBaseQuery()+`&limit=${MB_SHARED_PAGE_SIZE}&offset=${mbCloud.sharedOffset}`;
    const rows=await mbRestFetch(q)||[];
    mbCloud.sharedHasMore=rows.length===MB_SHARED_PAGE_SIZE;
    mbCloud.sharedOffset+=rows.length;
    if(rows.length){
      await mbCloudAttachUsernames(rows);
      mbCloud.sharedItems=mbCloud.sharedItems.concat(rows);
      if(mbCloud.sharedSort==='author'){
        // author순은 서버가 아니라 여기서 정렬하는 값이라, 새로 이어붙인 뒤 전체를 다시 정렬해야
        // 새 항목들이 알파벳 순서상 맞는 자리에 끼워진다.
        mbCloud.sharedItems.sort((a,b)=>(a.username||'').localeCompare(b.username||'','ko'));
      }
    }
  }catch(e){ /* 실패하면 그냥 두고, 다음에 다시 스크롤하거나 화면을 채우려 할 때 재시도된다 */ }
  finally{
    mbCloud.sharedLoadingMore=false;
    mbCloudRenderKeepScroll();
    mbCloudCheckSharedFillViewport();
  }
}
// 100개를 받아와도 팝업이 아주 크거나 화면이 넓으면 스크롤이 아예 생기지 않을 수 있어서(그러면
// "스크롤을 내리면 더 불러오기"가 발동할 기회 자체가 없다), 매번 다시 그린 뒤 목록 영역이
// 아직 다 안 채워졌고(스크롤이 없고) 더 불러올 게 남아있으면 곧바로 한 번 더 불러온다.
function mbCloudCheckSharedFillViewport(){
  if(mbCloud.tab!=='shared'||!mbCloud.sharedHasMore||mbCloud.sharedLoadingMore) return;
  const list=document.querySelector('#cloudBody .cl-cards')||document.querySelector('#cloudBody .cl-shared-list-pane');
  if(!list) return;
  if(list.scrollHeight<=list.clientHeight+4) mbCloudLoadSharedMore();
}
// 목록/카드 영역(스크롤 컨테이너)이 바뀔 때마다 리스너를 다시 붙일 필요 없이, scroll 이벤트는
// 버블링되지 않으니 document에 캡처 단계로 한 번만 걸어두고 target을 직접 검사한다.
function mbCloudSharedScrollCheck(e){
  const el=e.target;
  if(!el||!el.classList) return;
  if(!(el.classList.contains('cl-cards')||el.classList.contains('cl-shared-list-pane'))) return;
  if(mbCloud.tab!=='shared'||!mbCloud.sharedHasMore||mbCloud.sharedLoadingMore) return;
  if(el.scrollTop+el.clientHeight>=el.scrollHeight-300) mbCloudLoadSharedMore();
}
document.addEventListener('scroll', mbCloudSharedScrollCheck, true);
// PostgREST의 외래키 embed(mb_users(username))는 mockups.owner_id의 FK가 정확히 mb_users(id)를
// 가리켜야만 동작하는데, 설정이 어긋나 있으면 에러 없이 조용히 실패해서 계속 "알 수 없음"만
// 나온다. 그 설정에 기대지 않고 RPC로 직접 아이디를 조회해 합치는 방식으로 바꿔 더 안정적으로
// 만들었다 - mb_users 테이블 자체는 비밀번호 해시 보호를 위해 SELECT를 막아뒀으므로, 이
// RPC(SECURITY DEFINER 함수)로만 username을 안전하게 꺼내올 수 있다.
async function mbCloudAttachUsernames(items){
  const ids=[...new Set(items.map(it=>it.owner_id).filter(Boolean))];
  if(!ids.length) return;
  try{
    const rows=await mbRestFetch('/rpc/mb_get_usernames',{method:'POST',body:JSON.stringify({p_ids:ids})})||[];
    const map={}; rows.forEach(r=>{ map[r.id]=r.username; });
    items.forEach(it=>{ it.username=map[it.owner_id]||null; });
  }catch(e){ /* 실패해도 카드 자체는 보여준다 - 작성자만 '알 수 없음'으로 남는다 */ }
}

function mbCloudRender(){
  const body=document.getElementById('cloudBody');
  // 저장할 때는 "공유파일"이 의미가 없다(내 폴더에 저장하는 것뿐, 남의 공개 목업을 볼 이유가
  // 없음) - 저장 모드에서는 탭 자체를 아예 숨긴다. openCloudSave()가 tab을 항상 'mine'으로
  // 고정해두므로 여기서 별도 처리 없이 그냥 탭 줄만 생략하면 된다.
  let tabs='';
  if(mbCloud.mode==='open'){
    const folderTabIcon='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
    const sharedTabIcon='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="10.6" x2="15.4" y2="6.4"/><line x1="8.6" y1="13.4" x2="15.4" y2="17.6"/></svg>';
    tabs=`<div class="cl-tabs"><div class="cl-tabs-group">
      <div class="cl-tab ${mbCloud.tab==='mine'?'on':''}" onclick="mbCloudSwitchTab('mine')">${folderTabIcon}내 파일</div>
      <div class="cl-tab ${mbCloud.tab==='shared'?'on':''}" onclick="mbCloudSwitchTab('shared')">${sharedTabIcon}공유파일</div>
    </div></div>`;
  }
  body.innerHTML = tabs + (mbCloud.tab==='mine' ? mbCloudRenderMine() : mbCloudRenderShared());
  if(mbCloud.tab==='shared'){ mbCloudInitTagBar(); mbCloudRenderSharedPreviewFrame(); }
}
// mbCloudRender()는 body.innerHTML을 통째로 새로 만들기 때문에, 스크롤을 내려서 보고 있던
// 목록/트리 요소도 매번 새 엘리먼트로 바뀌면서 스크롤 위치가 0으로 초기화된다. 폴더 이동처럼
// 목록 내용 자체가 완전히 바뀌는 경우라면 맨 위로 가는 게 자연스럽지만, 그냥 파일 하나를
// 클릭해서 선택하거나(같은 목록 안에서) 별표를 토글하는 것처럼 "지금 보던 목록은 그대로인데
// 다시 그려지기만 하는" 경우에는 보던 위치가 그대로 유지돼야 한다. 그런 호출 지점에서는
// mbCloudRender() 대신 이 함수를 써서, 다시 그리기 전후로 스크롤 위치를 그대로 옮겨준다.
function mbCloudRenderKeepScroll(){
  const selectors=['.cl-list','.cl-cards','.cl-shared-list-pane','.cl-tree'];
  const positions=selectors.map(sel=>{
    const el=document.querySelector('#cloudBody '+sel);
    return el?el.scrollTop:null;
  });
  mbCloudRender();
  selectors.forEach((sel,i)=>{
    if(positions[i]==null) return;
    const el=document.querySelector('#cloudBody '+sel);
    if(el) el.scrollTop=positions[i];
  });
}
// 공유파일 목록을 (다시) 불러온 직후에 쓰는 렌더 - 그리고 나서 목록 영역이 스크롤이 생길
// 만큼 채워졌는지 확인해서, 안 채워졌으면(화면이 넓거나 항목이 적어서) 곧바로 다음 페이지를
// 이어서 불러온다.
function mbCloudRenderAndFillShared(){
  mbCloudRender();
  mbCloudCheckSharedFillViewport();
}
function mbCloudSwitchTab(tab){
  mbCloud.tab=tab;
  if(tab==='shared') mbCloudLoadShared().then(mbCloudRenderAndFillShared);
  else mbCloudRender();
}

// ---- 내 파일 탭 ----
function mbCloudTreeChildren(parentId,depth){
  let html='';
  mbFolderChildren(parentId).forEach(f=>{
    const kids=mbFolderChildren(f.id); const open=mbCloud.expanded.has(f.id); const on=mbCloud.folderId===f.id;
    const count=mbCloud.fileCounts[f.id]||0;
    if(mbCloud.renamingFolderId===f.id){
      html+=`<div class="cl-tree-item ${on?'on':''}" style="padding-left:${8+depth*16}px">
        <span class="chev" onclick="event.stopPropagation();mbCloudToggleExpand('${f.id}')">${kids.length?(open?CL_CHEV_DOWN:CL_CHEV_RIGHT):''}</span>
        ${clFolderIconSm(on)}
        <input id="cloudRenameInput" type="text" value="${esc(f.name)}" onclick="event.stopPropagation()"
          onkeydown="mbCloudRenameKeydown(event,'${f.id}')" onblur="mbCloudCommitRename('${f.id}',this.value)"
          style="flex:1;min-width:0;padding:2px 5px;border:1.5px solid var(--ax-green);border-radius:4px;font-size:13px;font-family:inherit;">
      </div>`;
    }else{
      html+=`<div class="cl-tree-item ${on?'on':''}" draggable="true"
          ondragstart="mbDragStart(event,'folder','${f.id}')"
          ondragover="mbDragOverFolder(event)" ondragleave="mbDragLeaveFolder(event)" ondrop="mbDropOnFolder(event,'${f.id}')"
          style="padding-left:${8+depth*16}px">
        <span class="chev" onclick="event.stopPropagation();mbCloudToggleExpand('${f.id}')">${kids.length?(open?CL_CHEV_DOWN:CL_CHEV_RIGHT):''}</span>
        <span onclick="mbCloudNavigateFolder('${f.id}')" style="display:flex;align-items:center;gap:5px;flex:1;min-width:0;">${clFolderIconSm(on)}<span class="cl-name-text">${esc(f.name)}</span><span class="cl-count">${count}</span></span>
        <span class="cl-rename-btn" title="이름 바꾸기" onclick="event.stopPropagation();mbCloudStartRenameFolder('${f.id}')">${CL_PENCIL_ICON}</span>
        <span class="cl-rename-btn" title="폴더 삭제" onclick="event.stopPropagation();mbCloudDeleteFolder('${f.id}')">${CL_TRASH_ICON}</span>
      </div>`;
    }
    if(kids.length && open) html+=mbCloudTreeChildren(f.id,depth+1);
  });
  return html;
}
function mbCloudStartRenameFolder(id){
  mbCloud.renamingFolderId=id;
  mbCloud.expanded.add(id); // 이름을 바꾸는 폴더로 가는 경로가 접혀 있어 안 보이는 일이 없게
  let p=mbCloud.folders.find(x=>x.id===id); p=p?p.parent_id:null;
  while(p){ mbCloud.expanded.add(p); const f=mbCloud.folders.find(x=>x.id===p); p=f?f.parent_id:null; }
  mbCloudRender();
  setTimeout(()=>{ const el=document.getElementById('cloudRenameInput'); if(el){ el.focus(); el.select(); } },0);
}
function mbCloudRenameKeydown(e,id){
  if(e.key==='Enter'){ e.preventDefault(); e.target.blur(); }
  else if(e.key==='Escape'){ e.preventDefault(); e.target.onblur=null; mbCloud.renamingFolderId=null; mbCloudRender(); }
}
async function mbCloudCommitRename(id,newName){
  if(mbCloud.renamingFolderId!==id) return; // Escape로 이미 취소된 경우 blur에서 다시 저장하지 않도록
  const name=(newName||'').trim();
  const f=mbCloud.folders.find(x=>x.id===id);
  mbCloud.renamingFolderId=null;
  if(!name||(f&&f.name===name)){ mbCloudRender(); return; }
  try{
    await mbRestFetch(`/mockup_folders?id=eq.${id}`,{method:'PATCH',body:JSON.stringify({name}),prefer:'return=minimal'});
    if(f) f.name=name;
  }catch(e){ alert('폴더 이름을 바꾸지 못했습니다.\n\n'+e.message); }
  mbCloudRender();
}
// 폴더를 지우면(DB의 on delete cascade/set null 규칙에 따라) 하위 폴더도 함께 지워지고, 그 안에
// 있던 파일들은 전체 파일(최상위, folder_id=null)로 이동한다 - 삭제 하나로 파일까지 사라지진 않는다.
// 폴더를 지우면 그 안의 파일도 함께 지운다(하위 폴더에 있는 파일까지 전부). DB의
// mockups.folder_id는 on delete set null이라 폴더만 지우면 파일이 최상위로 옮겨가며 살아남는데,
// 그건 "파일도 삭제"라는 이번 요청과 다르므로 폴더를 지우기 전에 그 안의 파일들부터 명시적으로
// 지운다. 되돌릴 수 없는 동작이라 확인창 문구도 그에 맞게 분명히 경고한다.
async function mbCloudDeleteFolder(id){
  const f=mbCloud.folders.find(x=>x.id===id); if(!f) return;
  const hasKids=mbFolderChildren(id).length>0;
  const msg=(hasKids?'이 폴더와 하위 폴더를 모두 삭제할까요?':'이 폴더를 삭제할까요?')+'\n\n안에 있던 파일도 함께 삭제됩니다. 되돌릴 수 없습니다.';
  if(!confirm(msg)) return;
  try{
    const affected=[id,...mbFolderDescendantIds(id)];
    await mbRestFetch(`/mockups?folder_id=in.(${affected.join(',')})`,{method:'DELETE',prefer:'return=minimal'});
    await mbRestFetch(`/mockup_folders?id=eq.${id}`,{method:'DELETE',prefer:'return=minimal'});
    const needNavigateAway=affected.includes(mbCloud.folderId);
    await mbCloudLoadFolders();
    await mbCloudLoadFileCounts();
    if(needNavigateAway) mbCloud.folderId=f.parent_id;
    await mbCloudLoadItems();
    mbCloudRender();
  }catch(e){ alert('폴더를 삭제하지 못했습니다.\n\n'+e.message); }
}
function mbCloudTreeHTML(){
  const rootOn=mbCloud.folderId===null;
  const favOn=mbCloud.folderId===MB_FAV_FOLDER;
  const total=Object.values(mbCloud.fileCounts).reduce((a,b)=>a+b,0);
  // 즐겨찾기는 실제 폴더 트리(전체 파일과 그 하위 폴더들)를 다 보여준 다음, 구분선 아래 맨
  // 마지막에 고정으로 배치한다 - 폴더 개수와 무관하게 항상 트리의 제일 아래에 있다.
  return `<div class="cl-tree-item ${rootOn?'on':''}" ondragover="mbDragOverFolder(event)" ondragleave="mbDragLeaveFolder(event)" ondrop="mbDropOnFolder(event,null)" onclick="mbCloudNavigateFolder(null)" style="padding-left:8px">
    <span class="chev"></span>${clFolderIconSm(rootOn)}전체 파일<span class="cl-count">${total}</span>
  </div>`
  + mbCloudTreeChildren(null,1)
  + `<div class="cl-tree-sep"></div>
  <div class="cl-tree-item ${favOn?'on':''}" onclick="mbCloudNavigateFavorites()" style="padding-left:8px">
    <span class="chev"></span>${clStarIcon(true)}즐겨찾기<span class="cl-count">${mbCloud.favCount||0}</span>
  </div>`;
}
function mbCloudToggleExpand(id){ if(mbCloud.expanded.has(id)) mbCloud.expanded.delete(id); else mbCloud.expanded.add(id); mbCloudRender(); }
function mbCloudNavigateFolder(id){ mbCloud.folderId=id; mbCloud.selectedId=null; mbCloud.searchQuery=''; mbCloud.includeSub=false;
  let p=id; while(p){ mbCloud.expanded.add(p); const f=mbCloud.folders.find(x=>x.id===p); p=f?f.parent_id:null; }
  mbCloudLoadItems().then(mbCloudRender);
}
// "전체 파일"과 같은 레벨의 즐겨찾기 가상 폴더로 이동 - 실제 폴더가 아니므로 트리 경로(expanded)를
// 건드릴 필요가 없다.
function mbCloudNavigateFavorites(){
  mbCloud.folderId=MB_FAV_FOLDER; mbCloud.selectedId=null; mbCloud.searchQuery=''; mbCloud.includeSub=false;
  mbCloudLoadItems().then(mbCloudRender);
}
let mbMineSearchDebounce=null;
function mbCloudSearchInput(v){
  mbCloud.searchQuery=v;
  // 매 글자마다 곧바로 서버에 물어보고 다시 그리는 대신, 입력이 잠깐 멈췄을 때 한 번만 조회한다.
  clearTimeout(mbMineSearchDebounce);
  mbMineSearchDebounce=setTimeout(()=>{
    mbCloudLoadItems().then(()=>{
      // 결과(트리+목록+하단 바)만 다시 그린다 - 검색창이 있는 toolbar는 손대지 않아야 타이핑
      // 중인 입력칸(그리고 한글 조합 중인 IME 상태)이 유지된다.
      const wrap=document.getElementById('cloudMineResultsWrap');
      if(wrap) wrap.innerHTML=mbCloudRenderMineResults();
    });
  },250);
}
function mbCloudToggleSub(v){ mbCloud.includeSub=v; mbCloudLoadItems().then(mbCloudRender); }
// 정렬 기준 변경 - 이미 불러온 목록을 다시 정렬만 하면 되므로 재조회 없이 다시 그리기만 한다.
function mbCloudMineSort(v){ mbCloud.mineSort=v; mbCloudRender(); }
// ---- 드래그로 폴더/파일 옮기기 (탐색기처럼) ----
let mbDragPayload=null;
function mbDragStart(e,type,id){
  mbDragPayload={type,id};
  e.dataTransfer.effectAllowed='move';
  try{ e.dataTransfer.setData('text/plain',type+':'+id); }catch(err){} // 일부 브라우저는 setData가 없으면 드래그 자체를 막는다
}
function mbDragOverFolder(e){ e.preventDefault(); e.currentTarget.classList.add('cl-drop-target'); }
function mbDragLeaveFolder(e){ e.currentTarget.classList.remove('cl-drop-target'); }
async function mbDropOnFolder(e,targetFolderId){
  e.preventDefault();
  e.currentTarget.classList.remove('cl-drop-target');
  const payload=mbDragPayload; mbDragPayload=null;
  if(!payload) return;
  if(payload.type==='folder'){
    if(payload.id===targetFolderId) return;
    const descendants=mbFolderDescendantIds(payload.id);
    if(targetFolderId!=null && (targetFolderId===payload.id||descendants.includes(targetFolderId))){
      alert('폴더를 자기 자신이나 그 하위 폴더 안으로는 옮길 수 없습니다.'); return;
    }
    const f=mbCloud.folders.find(x=>x.id===payload.id); if(f&&f.parent_id===targetFolderId) return; // 제자리
    try{
      await mbRestFetch(`/mockup_folders?id=eq.${payload.id}`,{method:'PATCH',body:JSON.stringify({parent_id:targetFolderId}),prefer:'return=minimal'});
      if(f) f.parent_id=targetFolderId;
      mbCloudRender();
    }catch(err){ alert('폴더를 옮기지 못했습니다.\n\n'+err.message); }
  }else if(payload.type==='file'){
    const it=mbCloud.items.find(x=>x.id===payload.id);
    if(it&&(it.folder_id||null)===(targetFolderId||null)) return; // 제자리
    try{
      await mbRestFetch(`/mockups?id=eq.${payload.id}`,{method:'PATCH',body:JSON.stringify({folder_id:targetFolderId}),prefer:'return=minimal'});
      await mbCloudLoadItems(); await mbCloudLoadFileCounts(); mbCloudRender();
    }catch(err){ alert('파일을 옮기지 못했습니다.\n\n'+err.message); }
  }
}
function mbCloudStartRenameItem(id){
  mbCloud.renamingItemId=id;
  mbCloudRender();
  setTimeout(()=>{ const el=document.getElementById('cloudItemRenameInput'); if(el){ el.focus(); el.select(); } },0);
}
function mbCloudItemRenameKeydown(e,id){
  if(e.key==='Enter'){ e.preventDefault(); e.target.blur(); }
  else if(e.key==='Escape'){ e.preventDefault(); e.target.onblur=null; mbCloud.renamingItemId=null; mbCloudRender(); }
}
async function mbCloudCommitItemRename(id,newTitle){
  if(mbCloud.renamingItemId!==id) return; // Escape로 이미 취소된 경우 blur에서 다시 저장하지 않도록
  const title=(newTitle||'').trim();
  const it=mbCloud.items.find(x=>x.id===id);
  mbCloud.renamingItemId=null;
  if(!title||(it&&it.title===title)){ mbCloudRender(); return; }
  try{
    await mbRestFetch(`/mockups?id=eq.${id}`,{method:'PATCH',body:JSON.stringify({title,updated_at:new Date().toISOString()}),prefer:'return=minimal'});
    if(it) it.title=title;
    if(mbCloud.mode==='save'&&mbCloud.selectedId===id) mbCloud.filename=title; // 저장 화면에서 그 파일을 고른 상태였다면 파일 이름 칸도 맞춰준다
  }catch(e){ alert('파일 이름을 바꾸지 못했습니다.\n\n'+e.message); }
  mbCloudRender();
}
async function mbCloudDeleteItem(id){
  if(!confirm('이 파일을 삭제할까요? 되돌릴 수 없습니다.')) return;
  try{
    await mbRestFetch(`/mockups?id=eq.${id}`,{method:'DELETE',prefer:'return=minimal'});
    if(mbCloud.selectedId===id) mbCloud.selectedId=null;
    await mbCloudLoadItems(); await mbCloudLoadFileCounts(); mbCloudRender();
  }catch(e){ alert('파일을 삭제하지 못했습니다.\n\n'+e.message); }
}
// 폴더트리 폭 조절 - 캔버스와 속성 패널 사이의 splitter와 같은 패턴(드래그 중 mousemove/mouseup은
// document에 붙여서, 마우스가 splitter 바깥으로 나가도 끊기지 않게 한다). 마지막 폭은
// localStorage에 저장해 다음에 클라우드 창을 열 때도 유지된다.
let mbCloudSplitDrag=null;
function mbCloudSplitStart(e){
  e.preventDefault();
  const treeEl=document.querySelector('#cloudBody .cl-tree'); if(!treeEl) return;
  mbCloudSplitDrag={startX:e.clientX,startW:treeEl.getBoundingClientRect().width};
  e.currentTarget.classList.add('dragging');
  document.addEventListener('mousemove',mbCloudSplitMove);
  document.addEventListener('mouseup',mbCloudSplitEnd);
}
function mbCloudSplitMove(e){
  if(!mbCloudSplitDrag) return;
  const w=Math.max(120,Math.min(400,mbCloudSplitDrag.startW+(e.clientX-mbCloudSplitDrag.startX)));
  mbCloud.treeWidth=w;
  const treeEl=document.querySelector('#cloudBody .cl-tree');
  if(treeEl) treeEl.style.width=w+'px';
}
function mbCloudSplitEnd(){
  mbCloudSplitDrag=null;
  document.querySelectorAll('#cloudBody .cl-split.dragging').forEach(el=>el.classList.remove('dragging'));
  document.removeEventListener('mousemove',mbCloudSplitMove);
  document.removeEventListener('mouseup',mbCloudSplitEnd);
  try{ localStorage.setItem('mb_cloud_tree_w',String(mbCloud.treeWidth)); }catch(e){}
}
// 공유파일 - 목록으로 보기의 좌(파일 목록)/우(미리보기) 스플리터. 위 mbCloudSplitStart 계열과
// 같은 패턴이지만 대상 엘리먼트(.cl-shared-list-pane)와 상태값(sharedListWidth)이 다르다.
let mbCloudSharedSplitDrag=null;
function mbCloudSharedSplitStart(e){
  e.preventDefault();
  const paneEl=document.querySelector('#cloudBody .cl-shared-list-pane'); if(!paneEl) return;
  mbCloudSharedSplitDrag={startX:e.clientX,startW:paneEl.getBoundingClientRect().width};
  e.currentTarget.classList.add('dragging');
  document.addEventListener('mousemove',mbCloudSharedSplitMove);
  document.addEventListener('mouseup',mbCloudSharedSplitEnd);
}
function mbCloudSharedSplitMove(e){
  if(!mbCloudSharedSplitDrag) return;
  const w=Math.max(200,Math.min(560,mbCloudSharedSplitDrag.startW+(e.clientX-mbCloudSharedSplitDrag.startX)));
  mbCloud.sharedListWidth=w;
  const paneEl=document.querySelector('#cloudBody .cl-shared-list-pane');
  if(paneEl) paneEl.style.width=w+'px';
  mbCloudFitSharedPreview(); // 좌우 폭이 바뀌면 우측 미리보기 공간도 바뀌니 배율을 다시 맞춘다
}
function mbCloudSharedSplitEnd(){
  mbCloudSharedSplitDrag=null;
  document.querySelectorAll('#cloudBody .cl-split.dragging').forEach(el=>el.classList.remove('dragging'));
  document.removeEventListener('mousemove',mbCloudSharedSplitMove);
  document.removeEventListener('mouseup',mbCloudSharedSplitEnd);
  try{ localStorage.setItem('mb_cloud_shared_list_w',String(mbCloud.sharedListWidth)); }catch(e){}
}
async function mbCloudNewFolder(){
  const s=mbGetSession(); if(!s) return;
  const existing=mbFolderChildren(mbCloud.folderId).map(f=>f.name);
  let name='새 폴더', n=2; while(existing.includes(name)){ name=`새 폴더 ${n++}`; }
  try{
    const [row]=await mbRestFetch('/mockup_folders',{method:'POST',body:JSON.stringify({owner_id:s.id,parent_id:mbCloud.folderId,name})});
    await mbCloudLoadFolders();
    // mbCloudNavigateFolder()를 그대로 쓰지 않는 이유: 그 함수는 목록을 비동기로 다시 불러온 뒤에야
    // render()를 호출하는데, 그 render가 뒤늦게 끝나면 지금 막 열려는 이름 편집 입력칸을 덮어써
    // 버린다(타이핑 중이던 이름이 날아가거나 포커스가 풀림). 목록 로딩까지 다 끝난 뒤에 편집을
    // 시작하도록 순서를 명시적으로 맞춘다.
    mbCloud.folderId=row.id; mbCloud.selectedId=null; mbCloud.searchQuery=''; mbCloud.includeSub=false;
    let p=row.id; while(p){ mbCloud.expanded.add(p); const f=mbCloud.folders.find(x=>x.id===p); p=f?f.parent_id:null; }
    await mbCloudLoadItems();
    mbCloudStartRenameFolder(row.id); // 탐색기처럼, 새로 만든 폴더는 바로 이름을 고칠 수 있게 편집 상태로 시작
  }catch(e){ alert('폴더를 만들지 못했습니다.\n\n'+e.message); }
}
function mbCloudSelectItem(id){
  // dblclick과 draggable="true"를 같은 요소에 같이 쓰면 브라우저에 따라 두 번째 클릭의 dblclick
  // 이벤트가 씹히는 경우가 있어(드래그 시작 판정과 겹쳐서), 네이티브 dblclick에 기대지 않고 직접
  // 두 클릭 사이 시간을 재서 더블클릭을 판정한다 - 폴더 목록의 mbCloudFolderRowClick도 동일.
  const now=Date.now();
  const isDouble=mbCloud._lastClickId===id && (now-(mbCloud._lastClickTime||0))<400;
  mbCloud._lastClickId=id; mbCloud._lastClickTime=now;
  mbCloud.selectedId=id;
  if(mbCloud.mode==='save'){
    const it=mbCloud.items.find(x=>x.id===id);
    if(it){ mbCloud.filename=it.title; mbCloud.tags=(it.tags||[]).slice(); mbCloud.isPublic=it.is_public; }
  }
  mbCloudRenderKeepScroll();
  if(isDouble) mbCloudActivateItem(id);
}
function mbCloudFolderRowClick(id){
  const now=Date.now();
  const isDouble=mbCloud._lastClickId===id && (now-(mbCloud._lastClickTime||0))<400;
  mbCloud._lastClickId=id; mbCloud._lastClickTime=now;
  if(isDouble) mbCloudNavigateFolder(id);
}
// 더블클릭으로 파일을 "활성화"할 때 - 열기 모드는 그 파일을 바로 열고, 저장 모드는 그 파일에
// 바로 덮어쓰기 저장한다(mbCloudDoSave가 이름 중복 확인을 통해 이미 덮어쓰기 확인창을 띄워준다).
// 예전에는 저장 모드에서 mbCloudSelectItem(id)를 다시 불렀는데, 그 함수 안의 더블클릭 판정이
// 매번 "방금 클릭"으로 인식되어 자기 자신을 무한히 재귀 호출해 화면이 멈추는 버그가 있었다.
function mbCloudActivateItem(id){ mbCloud.selectedId=id; if(mbCloud.mode==='open') mbCloudDoOpen(); else mbCloudDoSave(); }
async function mbCloudToggleShare(id,checkboxEl){
  const on=checkboxEl.checked;
  try{ await mbRestFetch(`/mockups?id=eq.${id}`,{method:'PATCH',body:JSON.stringify({is_public:on}),prefer:'return=minimal'}); const it=mbCloud.items.find(x=>x.id===id); if(it) it.is_public=on; }
  catch(e){ checkboxEl.checked=!on; alert('공유 설정을 바꾸지 못했습니다.\n\n'+e.message); }
}
// 파일 행의 별 토글 - 눌러서 켜면(즐겨찾기 추가) 노란 별로, 다시 누르면(해제) 빈 별로 바뀐다.
// 즐겨찾기 보기 중에 해제하면 그 파일은 더 이상 이 목록에 나오면 안 되므로 목록을 다시 불러온다.
async function mbCloudToggleFavorite(id){
  const it=mbCloud.items.find(x=>x.id===id); if(!it) return;
  const newVal=!it.is_favorite;
  try{
    await mbRestFetch(`/mockups?id=eq.${id}`,{method:'PATCH',body:JSON.stringify({is_favorite:newVal}),prefer:'return=minimal'});
    it.is_favorite=newVal;
    mbCloud.favCount=Math.max(0,(mbCloud.favCount||0)+(newVal?1:-1));
    if(mbCloud.folderId===MB_FAV_FOLDER && !newVal){ await mbCloudLoadItems(); }
    mbCloudRenderKeepScroll();
  }catch(e){ alert('즐겨찾기 설정을 바꾸지 못했습니다.\n\n'+e.message); }
}
function mbCloudRenderMine(){
  const inFav=mbCloud.folderId===MB_FAV_FOLDER;
  const path=inFav?[]:mbFolderPathTo(mbCloud.folderId);
  const crumb=inFav
    ? `<span class="seg" onclick="mbCloudNavigateFolder(null)">전체 파일</span><span class="sep">/</span><span class="cur">${clStarIcon(true)}즐겨찾기</span>`
    : `<span class="seg" onclick="mbCloudNavigateFolder(null)">전체 파일</span>`+
      path.map((f,i)=>`<span class="sep">/</span><span class="${i===path.length-1?'cur':'seg'}" onclick="mbCloudNavigateFolder('${f.id}')">${esc(f.name)}</span>`).join('');
  const toolbar=`<div class="cl-toolbar">
    <div class="cl-crumb">${crumb}</div><span style="flex:1"></span>
    ${inFav?'':`<button class="cl-newfolder-btn" onclick="mbCloudNewFolder()">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      새 폴더
    </button>`}
    <div class="cl-search-box">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="2.3"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.6" y2="16.6"/></svg>
      <input type="text" id="cloudSearchInput" placeholder="${inFav?'즐겨찾기에서 검색':'이 폴더에서 검색'}" value="${esc(mbCloud.searchQuery)}" oninput="mbCloudSearchInput(this.value)">
    </div>
    <select class="cl-sortselect" onchange="mbCloudMineSort(this.value)" title="정렬 기준">
      <option value="name" ${mbCloud.mineSort==='name'?'selected':''}>파일명순</option>
      <option value="updated" ${mbCloud.mineSort==='updated'?'selected':''}>수정일시순</option>
      <option value="created" ${mbCloud.mineSort==='created'?'selected':''}>생성일시순</option>
    </select>
    ${inFav?'':`<label class="cl-subfolder-chk"><input type="checkbox" ${mbCloud.includeSub?'checked':''} onchange="mbCloudToggleSub(this.checked)">하위 폴더 포함</label>`}
  </div>`;
  return toolbar+`<div id="cloudMineResultsWrap" class="cl-results-wrap">${mbCloudRenderMineResults()}</div>`;
}
// 검색어를 입력할 때마다 이 부분(트리+목록+하단 바)만 다시 그린다 - 검색창이 있는 toolbar는
// 그대로 둬야 타이핑 중인 입력칸(그리고 한글 조합 중인 IME 상태)이 유지된다. toolbar까지 같이
// 다시 그리면 입력칸 자체가 새 엘리먼트로 바뀌어서 포커스가 날아가거나, 심하면 한글 조합이
// 끊겨서 글자가 깨져 보인다.
function mbCloudRenderMineResults(){
  const inFav=mbCloud.folderId===MB_FAV_FOLDER;
  // 즐겨찾기 보기는 여러 폴더에 흩어진 파일을 한데 모아 보여주는 것이라 검색 결과와 마찬가지로
  // 하위 폴더 목록은 숨기고, 각 파일이 실제로 어느 폴더에 있는지(위치)를 같이 보여준다.
  const searching=!!mbCloud.searchQuery||inFav;
  const cols='minmax(90px,1fr) 130px 130px 90px 40px 50px';
  const heads=searching?['이름','위치','수정일시','공유','','']:['이름','수정일시','생성일시','공유','',''];
  let rows='';
  // 폴더는 이름 정보만 불러와 두었으므로(생성/수정일시 없음) 항상 이름순으로 보여주고,
  // 파일은 상단 정렬 드롭다운(기본: 파일명순)에 따라 정렬한다.
  const folderList=mbFolderChildren(mbCloud.folderId).slice().sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  const itemList=mbCloud.items.slice().sort((a,b)=>{
    if(mbCloud.mineSort==='updated') return new Date(b.updated_at)-new Date(a.updated_at);
    if(mbCloud.mineSort==='created') return new Date(b.created_at)-new Date(a.created_at);
    return (a.title||'').localeCompare(b.title||'');
  });
  if(!searching) folderList.forEach(f=>{
    const count=mbCloud.fileCounts[f.id]||0;
    rows+=`<div class="cl-row" draggable="true"
        ondragstart="mbDragStart(event,'folder','${f.id}')"
        ondragover="mbDragOverFolder(event)" ondragleave="mbDragLeaveFolder(event)" ondrop="mbDropOnFolder(event,'${f.id}')"
        style="grid-template-columns:${cols}" onclick="mbCloudFolderRowClick('${f.id}')">
      <div class="cl-row-name">${CL_FOLDER_ICON}<span class="cl-name-text">${esc(f.name)}</span><span class="cl-count">${count}</span></div><div class="cl-dim">-</div><div class="cl-dim"></div><div></div><div></div>
      <div class="cl-row-actions"><span class="cl-rename-btn" title="폴더 삭제" onclick="event.stopPropagation();mbCloudDeleteFolder('${f.id}')">${CL_TRASH_ICON}</span></div>
    </div>`;
  });
  itemList.forEach(it=>{
    const sel=mbCloud.selectedId===it.id;
    const c2=searching?`<div class="cl-dim">${esc(mbFolderPathTo(it.folder_id).map(f=>f.name).join(' / ')||'전체 파일')}</div>`:`<div class="cl-dim">${mbFmtDate(it.updated_at)}</div>`;
    const c3=searching?`<div class="cl-dim">${mbFmtDate(it.updated_at)}</div>`:`<div class="cl-dim">${mbFmtDate(it.created_at)}</div>`;
    const fileIcon=clFileIconByMode(it.mode);
    const nameCell=mbCloud.renamingItemId===it.id
      ? `<div class="cl-row-name">${fileIcon}<input id="cloudItemRenameInput" type="text" value="${esc(it.title)}" onclick="event.stopPropagation()"
           onkeydown="mbCloudItemRenameKeydown(event,'${it.id}')" onblur="mbCloudCommitItemRename('${it.id}',this.value)"
           style="flex:1;min-width:0;padding:2px 6px;border:1.5px solid var(--ax-green);border-radius:4px;font-size:13.5px;font-family:inherit;"></div>`
      : `<div class="cl-row-name">${fileIcon}<span class="cl-name-text">${esc(it.title)}</span></div>`;
    rows+=`<div class="cl-row ${sel?'sel':''}" draggable="true" ondragstart="mbDragStart(event,'file','${it.id}')"
        style="grid-template-columns:${cols}" onclick="mbCloudSelectItem('${it.id}')">
      ${nameCell}${c2}${c3}
      <div onclick="event.stopPropagation()">${clToggleHTML(it.is_public,`mbCloudToggleShare('${it.id}',this)`)}</div>
      <div class="cl-star-btn" title="${it.is_favorite?'즐겨찾기 해제':'즐겨찾기 추가'}" onclick="event.stopPropagation();mbCloudToggleFavorite('${it.id}')">${clStarIcon(!!it.is_favorite)}</div>
      <div class="cl-row-actions">
        <span class="cl-rename-btn" title="이름 바꾸기" onclick="event.stopPropagation();mbCloudStartRenameItem('${it.id}')">${CL_PENCIL_ICON}</span>
        <span class="cl-rename-btn" title="파일 삭제" onclick="event.stopPropagation();mbCloudDeleteItem('${it.id}')">${CL_TRASH_ICON}</span>
      </div>
    </div>`;
  });
  if(!rows) rows=`<div class="cl-empty">${inFav?'즐겨찾기한 파일이 없습니다.':(searching?'검색 결과가 없습니다.':'이 폴더는 비어 있습니다.')}</div>`;
  const listArea=`<div class="cl-body"><div class="cl-tree" style="width:${mbCloud.treeWidth}px">${mbCloudTreeHTML()}</div><div class="cl-split" onmousedown="mbCloudSplitStart(event)"></div><div class="cl-list">
    <div class="cl-list-head" style="grid-template-columns:${cols}">${heads.map(h=>`<div>${h}</div>`).join('')}</div>${rows}
  </div></div>`;
  return listArea+(mbCloud.mode==='save'?mbCloudSaveFooter():mbCloudOpenFooter());
}
function mbCloudSaveFooter(){
  const tagchips=mbCloud.tags.map((t,i)=>`<span class="cl-tagchip">${esc(t)}<span onclick="mbCloudRemoveTag(${i})">×</span></span>`).join('');
  return `<div class="cl-footer" style="flex-direction:column;align-items:stretch;gap:12px;">
    <div style="display:flex;align-items:center;gap:12px;">
      <div title="다른 사용자가 검색하고 열람·복제할 수 있습니다" style="display:flex;align-items:center;gap:7px;padding:6px 10px;border:1px solid #d9ece3;background:#f6faf8;border-radius:6px;flex-shrink:0;">
        ${clToggleHTML(mbCloud.isPublic,'mbCloudTogglePublic(this)')}<span style="font-size:12.5px;color:#2c3e50;font-weight:600;">공개</span>
      </div>
      <span style="font-size:13px;color:#2c3e50;font-weight:600;white-space:nowrap;">파일 이름</span>
      <input type="text" id="cloudFilenameInput" value="${esc(mbCloud.filename)}" oninput="mbCloud.filename=this.value">
      <button class="cl-cancel-btn" onclick="closeCloud()">취소</button>
      <button class="cl-primary-btn" onclick="mbCloudDoSave()">저장</button>
    </div>
    <div style="display:flex;align-items:center;gap:12px;">
      <span style="font-size:13px;color:#2c3e50;font-weight:600;white-space:nowrap;">태그 <span style="font-weight:400;color:#9ca3af;">(선택)</span></span>
      <div class="cl-tagbox">${tagchips}<input type="text" id="cloudTagInput" placeholder="입력 후 Enter" onkeydown="mbCloudTagKeydown(event)"></div>
    </div>
  </div>`;
}
function mbCloudOpenFooter(){
  const it=mbCloud.items.find(x=>x.id===mbCloud.selectedId);
  return `<div class="cl-footer">
    <span style="font-size:12.5px;color:#6b7280;flex:1;">${it?`선택함: <b style="color:#2c3e50;">${esc(it.title)}</b>`:'파일을 선택하세요.'}</span>
    <button class="cl-cancel-btn" onclick="closeCloud()">취소</button>
    <button class="cl-primary-btn" ${it?'':'disabled'} onclick="mbCloudDoOpen()">열기</button>
  </div>`;
}
function mbCloudTogglePublic(el){ mbCloud.isPublic=el.checked; }
function mbCloudTagKeydown(e){
  if(e.key==='Enter'){
    e.preventDefault();
    const v=e.target.value.trim();
    if(v && !mbCloud.tags.includes(v)){
      mbCloud.tags.push(v);
      mbCloudRender(); // 태그 칩 목록을 다시 그리려고 footer 전체를 새로 그리는데, 그러면 지금
      // 포커스돼 있던 입력칸도 새 엘리먼트로 바뀌면서 포커스가 풀린다 - 연속 입력이 안 되던 원인.
      // 방금 새로 그려진 입력칸을 다시 포커스해서 바로 다음 태그를 이어 입력할 수 있게 한다.
      const el=document.getElementById('cloudTagInput');
      if(el) el.focus();
    }
    else e.target.value='';
  }
}
function mbCloudRemoveTag(i){ mbCloud.tags.splice(i,1); mbCloudRender(); }
async function mbCloudDoSave(){
  const s=mbGetSession(); if(!s){ openLogin(); return; }
  const title=(mbCloud.filename||'').trim();
  if(!title){ alert('파일 이름을 입력해 주세요.'); return; }
  // 같은 폴더 안에 같은 이름의 파일이 이미 있으면(목록에서 그 파일을 직접 선택해서 저장하는
  // 경우도 포함) 새로 만들지 않고 그 파일에 덮어쓰는 것으로 처리한다 - 항상 이름으로 판단하므로
  // 선택 여부와 관계없이 같은 확인 메시지·동작을 탄다. (검색 중이었을 수도 있는 mbCloud.items
  // 목록 대신, 저장 시점에 서버에서 다시 정확히 확인한다)
  let targetId=null;
  try{
    const folderQ=mbCloud.folderId==null?'&folder_id=is.null':`&folder_id=eq.${mbCloud.folderId}`;
    const dupRows=await mbRestFetch(`/mockups?owner_id=eq.${s.id}&mode=eq.${mbCurrentMode()}${folderQ}&title=eq.${encodeURIComponent(title)}&select=id`)||[];
    if(dupRows.length) targetId=dupRows[0].id;
  }catch(e){ targetId=mbCloud.selectedId; /* 중복 확인 자체가 실패하면, 선택된 파일이 있는 경우에는 그 파일을 대상으로 저장을 계속 진행한다 */ }
  if(targetId){
    if(!confirm(`'${title}' 이름의 파일이 이미 있습니다. 덮어쓰시겠습니까?`)) return;
  }
  const payload={ owner_id:s.id, folder_id:mbCloud.folderId, title, tags:mbCloud.tags, is_public:mbCloud.isPublic,
    mode:mbCurrentMode(), data:mbBuildSaveData(), thumbnail:mbBuildThumbnailSVG(), updated_at:new Date().toISOString(),
    origin_id:mbCloud.originId||null };
  try{
    if(targetId){
      await mbRestFetch(`/mockups?id=eq.${targetId}`,{method:'PATCH',body:JSON.stringify(payload),prefer:'return=minimal'});
    }else{
      await mbRestFetch('/mockups',{method:'POST',body:JSON.stringify(payload),prefer:'return=minimal'});
    }
    closeCloud();
  }catch(e){ alert('클라우드에 저장하지 못했습니다.\n\n'+e.message); }
}
async function mbCloudDoOpen(){
  if(!mbCloud.selectedId) return;
  try{
    const rows=await mbRestFetch(`/mockups?id=eq.${mbCloud.selectedId}&select=data,title,origin_id`);
    const row=rows&&rows[0]; if(!row) throw new Error('파일을 찾을 수 없습니다.');
    // mbCloudApplyData()가 render()를 호출하고, 그 안에서 자동저장이 (조건에 따라) 그 자리에서
    // 바로 실행될 수도 있다 - 그 스냅샷에도 원본 추적값이 함께 실리도록 반드시 먼저 세팅한다.
    // 내 파일을 다시 여는 것은 "새로 파생시키는" 게 아니라 이어서 작업하는 것이므로, 이미
    // 그 파일에 기록돼 있던 원본 추적 값을 그대로 이어받는다(원본 자체면 null 그대로 유지).
    mbCloud.originId=row.origin_id||null;
    mbCloudApplyData(row.data);
    closeCloud();
  }catch(e){ alert('열지 못했습니다.\n\n'+e.message); }
}
function mbCloudApplyData(d){
  if(!d||!Array.isArray(d.comps)) throw new Error('화면 구성 정보를 찾을 수 없습니다.');
  pushHistory();
  setAppSkin(d.skin==='fat');
  comps=d.comps;
  uid=Math.max(0,...comps.map(c=>c.id))+1;
  if(d.cw){ document.getElementById('cw').value=d.cw; setCW(); }
  if(d.ch){ document.getElementById('ch').value=d.ch; setCH(); }
  selectSingle(null); render();
}

// ---- 공유됨 탭 (다른 사용자의 공개 목업 검색·조회) ----
// 씬모드/팻모드는 서로 컴포넌트 구성이 달라 호환되지 않으므로, 지금 켜져 있는 모드와 같은
// 목업만 보여준다(mbCurrentMode()로 서버 쪽에서부터 걸러서 요청한다 - mbCloudLoadShared 참고).
function mbCloudSharedSetView(v){ mbCloud.sharedView=v; try{ localStorage.setItem('mb_cloud_shared_view',v); }catch(e){} mbCloudRender(); }
function mbCloudRenderLineageBar(){
  return mbCloud.sharedOriginFilter
    ? `<div class="cl-lineagebar cl-lineage-crumb">
        <span class="cl-lineage-back" onclick="mbCloudClearOriginFilter()">◀ 뒤로</span>
        <span class="cl-lineage-crumb-text">'${esc(mbCloud.sharedOriginFilterTitle)}'의 리비전</span>
      </div>`
    : `<div class="cl-lineagebar">
        <div class="cl-lineage-seg">
          <span class="${mbCloud.sharedLineage==='originals'?'on':''}" onclick="mbCloudSharedLineageClick('originals')"><i class="cl-lineage-ic cl-lineage-ic-origin"></i>원본만${mbCloud.sharedCounts?` (${mbCloud.sharedCounts.originals})`:''}</span>
          <span class="${mbCloud.sharedLineage==='all'?'on':''}" onclick="mbCloudSharedLineageClick('all')">전체${mbCloud.sharedCounts?` (${mbCloud.sharedCounts.all})`:''}</span>
          <span class="${mbCloud.sharedLineage==='revisions'?'on':''}" onclick="mbCloudSharedLineageClick('revisions')"><i class="cl-lineage-ic cl-lineage-ic-rev"></i>리비전만${mbCloud.sharedCounts?` (${mbCloud.sharedCounts.revisions})`:''}</span>
        </div>
      </div>`;
}
function mbCloudRenderShared(){
  const gridIcon='<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>';
  const listIcon='<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>';
  const toolbar=`<div class="cl-toolbar">
    <div class="cl-search-box" style="flex:1;max-width:none;">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="2.3"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.6" y2="16.6"/></svg>
      <input type="text" id="cloudSharedSearchInput" placeholder="공유된 목업 검색 (제목, 태그, 작성자)" value="${esc(mbCloud.sharedQuery)}" oninput="mbCloudSharedSearch(this.value)">
    </div>
    <select class="cl-sortselect" onchange="mbCloudSharedSort(this.value)">
      <option value="recent" ${mbCloud.sharedSort==='recent'?'selected':''}>최신순</option>
      <option value="oldest" ${mbCloud.sharedSort==='oldest'?'selected':''}>오래된순</option>
      <option value="title" ${mbCloud.sharedSort==='title'?'selected':''}>이름순</option>
      <option value="author" ${mbCloud.sharedSort==='author'?'selected':''}>작성자순</option>
    </select>
    <div class="cl-viewtoggle">
      <span class="${mbCloud.sharedView==='grid'?'on':''}" title="카드로 보기" onclick="mbCloudSharedSetView('grid')">${gridIcon}</span>
      <span class="${mbCloud.sharedView==='list'?'on':''}" title="목록으로 보기" onclick="mbCloudSharedSetView('list')">${listIcon}</span>
    </div>
  </div>
  <div id="cloudSharedLineageBar">${mbCloudRenderLineageBar()}</div>
  <div class="cl-tagbar-wrap">
    <div class="cl-tagbar" id="cloudTagbar">
      ${mbCloud.sharedTags.map(t=>`<span class="cl-filterchip ${mbCloud.sharedTag===t?'on':''}" onclick="mbCloudSharedTagClick('${esc(t)}')">${esc(t)}</span>`).join('')}
    </div>
    <button type="button" class="cl-tagbar-toggle" id="cloudTagbarToggle" style="display:none" onclick="mbCloudTagbarToggle()"></button>
  </div>`;
  return toolbar+`<div id="cloudSharedResultsWrap" class="cl-results-wrap">${mbCloudRenderSharedResults()}</div>`;
}
// 검색어를 입력할 때마다 이 부분(목록+하단 바)만 다시 그린다 - 위 toolbar(검색창 포함)는 그대로
// 둬야 입력 중인 텍스트 필드가 매 글자마다 새로 만들어지지 않는다. 입력칸을 통째로 다시 그리면
// 한글 조합(IME) 도중 엘리먼트가 바뀌면서 글자가 깨지거나(예: "검색"이 "ㄱㅓㅁㅏㅅ"처럼 조합이
// 끊겨 나오는 문제) 포커스가 날아가는 문제가 생긴다.
function mbCloudRenderSharedResults(){
  const emptyMsg=`<div class="cl-empty" style="grid-column:1/-1;">${mbCurrentMode()==='Fat'?'Fat':'Thin'} 모드로 공유된 목업이 아직 없습니다.</div>`;
  // 원본 카드에만 붙는 작은 리비전 개수 배지 - 0개(또는 리비전 자체인 항목)면 아무것도 안 그린다.
  // 평소엔 원본만 조용히 보이다가, 이 숫자를 눌렀을 때만(클릭 시 "리비전만" 필터 + 검색어를 그
  // 원본 제목으로 맞춰서) 그 원본의 리비전들만 따로 걸러 보여준다 - 옵셔널한 조회.
  const revisionBadge=(it)=> (!it.origin_id && it.derivative_count>0)
    ? `<span class="cl-rev-badge" title="이 원본에서 파생된 리비전 ${it.derivative_count}개" onclick="event.stopPropagation();mbCloudShowRevisionsOf('${it.id}')">${it.derivative_count}</span>`
    : '';
  let listArea;
  if(mbCloud.sharedView==='list'){
    // 목록으로 보기는 탐색기처럼 좌(파일 목록)/우(선택한 파일의 미리보기)로 나눈다 - 카드뷰와
    // 달리 한 번에 하나씩 자세히 훑어보기 좋은 배치. 좌우 폭은 .cl-split 드래그로 조절되고
    // localStorage에 저장돼 다음에 열 때도 유지된다.
    let rows='';
    mbCloud.sharedItems.forEach(it=>{
      const sel=mbCloud.sharedSelectedId===it.id;
      const author=it.username||'알 수 없음';
      const tag=(it.tags&&it.tags[0])||'';
      const thumbHtml=it.thumbnail
        ? `<img src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(it.thumbnail)}" style="width:100%;height:100%;object-fit:cover;" alt="">`
        : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#c3cad1" stroke-width="1.8"><rect x="3" y="4" width="18" height="14" rx="1.5"/><path d="M3 15l4.5-4.5L11 14l4-4 6 6"/></svg>`;
      rows+=`<div class="cl-explorer-row ${sel?'sel':''}" onclick="mbCloudSharedSelect('${it.id}')" ondblclick="mbCloudSharedOpen('${it.id}')">
        <div class="cl-thumb-sm">${thumbHtml}</div>
        <div class="cl-explorer-meta">
          <div class="cl-explorer-title-row"><span class="cl-name-text">${esc(it.title)}</span>${revisionBadge(it)}</div>
          <span class="cl-sub">${esc(author)} · ${mbFmtDate(it.created_at)}</span>
        </div>
        <div class="cl-explorer-right">
          ${tag?`<span class="cl-tagpill">${esc(tag)}</span>`:''}
          <span class="cl-open-count" title="복제해서 열기 횟수">${clOpenIcon()}${it.open_count||0}</span>
        </div>
      </div>`;
    });
    const loadMoreRow=mbCloud.sharedLoadingMore?`<div class="cl-shared-loadmore">더 불러오는 중...</div>`:'';
    const listPane=`<div class="cl-shared-list-pane" style="width:${mbCloud.sharedListWidth}px">${rows||emptyMsg}${rows?loadMoreRow:''}</div>`;
    const selIt=mbCloud.sharedItems.find(x=>x.id===mbCloud.sharedSelectedId);
    let previewInner;
    if(selIt){
      const author=selIt.username||'알 수 없음';
      const tag=(selIt.tags&&selIt.tags[0])||'';
      // 정적 썸네일(저장 시점의 SVG 스냅샷) 대신, 선택한 순간 실제 데이터(comps)를 받아와
      // 진짜 화면 그대로(같은 컴포넌트 렌더링 결과)를 iframe으로 그린다 - mbCloudRenderSharedPreviewFrame()가
      // 이 컨테이너를 찾아서 채운다. 여기서는 자리와 "불러오는 중" 상태만 마련해둔다.
      previewInner=`<div class="cl-shared-preview-frame-outer" id="cloudSharedPreviewFrameOuter"><div class="cl-shared-preview-loading">불러오는 중...</div></div>
        <div class="cl-shared-preview-meta">
          <span class="cl-shared-preview-meta-title">${esc(selIt.title)}</span>
          <span class="cl-shared-preview-meta-sep">·</span>
          <span>${esc(author)}</span>
          <span class="cl-shared-preview-meta-sep">·</span>
          <span>${mbFmtDate(selIt.created_at)}</span>
          ${tag?`<span class="cl-shared-preview-meta-sep">·</span><span class="cl-tagpill">${esc(tag)}</span>`:''}
        </div>`;
    }else{
      previewInner=`<div class="cl-shared-preview-frame-outer"><div class="cl-shared-preview-empty">파일을 선택하면 미리보기가 여기에 표시됩니다.</div></div>`;
    }
    listArea=`<div class="cl-shared-split-body">${listPane}<div class="cl-split" onmousedown="mbCloudSharedSplitStart(event)"></div><div class="cl-shared-preview-pane">${previewInner}</div></div>`;
  }else{
    let cards='';
    mbCloud.sharedItems.forEach(it=>{
      const sel=mbCloud.sharedSelectedId===it.id;
      const author=it.username||'알 수 없음';
      const tag=(it.tags&&it.tags[0])||'';
      // 썸네일은 <img src="data:image/svg+xml..."> 로 렌더링한다 - DOM에 SVG를 직접 삽입하면 그
      // 안의 <script>나 이벤트 속성이 실행될 수 있는데, "공유"는 다른 사용자의 데이터를 그대로
      // 보여주는 자리라 안전하게 "이미지"로만 다루는 편이 맞다(이미지로 불러온 SVG는 스크립트가
      // 실행되지 않는다).
      const thumbHtml=it.thumbnail
        ? `<img src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(it.thumbnail)}" style="width:100%;height:100%;object-fit:contain;" alt="">`
        : `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#c3cad1" stroke-width="1.6"><rect x="3" y="4" width="18" height="14" rx="1.5"/><path d="M3 15l4.5-4.5L11 14l4-4 6 6"/></svg>`;
      cards+=`<div class="cl-card ${sel?'sel':''}" onclick="mbCloudSharedSelect('${it.id}')" ondblclick="mbCloudSharedOpen('${it.id}')">
        <div class="cl-card-thumb">${thumbHtml}</div>
        <div class="cl-card-body">
          <div class="cl-card-title">${esc(it.title)}${revisionBadge(it)}</div>
          <div style="font-size:11.5px;color:#6b7280;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(author)}</div>
          <div style="font-size:11.5px;color:#6b7280;margin-bottom:6px;">${mbFmtDate(it.created_at)}</div>
          <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
            <span>${tag?`<span class="cl-tagpill">${esc(tag)}</span>`:''}</span>
            <span class="cl-open-count" title="복제해서 열기 횟수">${clOpenIcon()}${it.open_count||0}</span>
          </div>
        </div>
      </div>`;
    });
    const loadMoreCard=mbCloud.sharedLoadingMore?`<div class="cl-shared-loadmore" style="grid-column:1/-1;">더 불러오는 중...</div>`:'';
    listArea=`<div class="cl-cards">${cards||emptyMsg}${cards?loadMoreCard:''}</div>`;
  }
  const it=mbCloud.sharedItems.find(x=>x.id===mbCloud.sharedSelectedId);
  const footer=`<div class="cl-footer">
    <span style="font-size:12px;color:#8a97a3;flex:1;">${it?`선택함: <b style="color:#2c3e50;">${esc(it.title)}</b> — 더블클릭하면 내 캔버스에 복제해서 엽니다.`:'클릭하면 선택, 더블클릭하면 바로 엽니다.'}</span>
    <button class="cl-cancel-btn" onclick="closeCloud()">취소</button>
    <button class="cl-primary-btn" ${it?'':'disabled'} onclick="mbCloudSharedOpen(mbCloud.sharedSelectedId)">복제해서 열기</button>
  </div>`;
  return listArea+footer;
}
// 태그 필터 줄 - 칩이 많아도 무한정 늘어나지 않도록 기본은 "최대 2줄"로 접어두고, 그보다
// 많을 때만 "더보기" 버튼을 보여준다. 눌러서 펼치면 전부 wrap돼서 보이고, "접기"로 다시
// 2줄로 되돌릴 수 있다. 높이는 칩 하나의 실제 렌더 높이를 재서 정한다(CSS로 미리 못박아두면
// 폰트 크기 변화 등에 안 맞을 수 있어서).
function mbCloudInitTagBar(){
  const bar=document.getElementById('cloudTagbar');
  const toggle=document.getElementById('cloudTagbarToggle');
  if(!bar||!toggle) return;
  const chip=bar.querySelector('.cl-filterchip');
  if(!chip){ toggle.style.display='none'; bar.style.maxHeight='none'; return; }
  const collapsedH=chip.offsetHeight*2+6; // 2줄 + 줄 사이 gap(6px)
  bar.style.maxHeight='none'; // 실제 전체 높이를 재려면 먼저 높이 제한을 풀어야 한다
  const fullH=bar.scrollHeight;
  const needsToggle=fullH>collapsedH+1;
  toggle.style.display=needsToggle?'inline-block':'none';
  if(!needsToggle){ mbCloud.tagbarExpanded=false; return; }
  bar.style.maxHeight=mbCloud.tagbarExpanded?'none':collapsedH+'px';
  toggle.textContent=mbCloud.tagbarExpanded?'접기 ▴':'더보기 ▾';
}
function mbCloudTagbarToggle(){
  mbCloud.tagbarExpanded=!mbCloud.tagbarExpanded;
  mbCloudInitTagBar();
}
let mbSharedSearchDebounce=null;
function mbCloudSharedSearch(v){
  mbCloud.sharedQuery=v;
  // 매 글자마다 곧바로 서버에 물어보고 다시 그리는 대신, 입력이 잠깐 멈췄을 때 한 번만 조회한다
  // (요청이 겹치는 것도 줄이고, 아래에서 검색창 자체는 건드리지 않으니 어차피 꼭 필요하진 않지만
  // 서버 부하를 줄이는 차원에서 유지).
  clearTimeout(mbSharedSearchDebounce);
  mbSharedSearchDebounce=setTimeout(()=>{
    mbCloudLoadShared().then(()=>{
      // 검색 결과(목록+하단 바)와 원본/전체/리비전 개수만 다시 그린다 - 검색창이 있는 toolbar
      // 전체를 새로 그리면 타이핑 중인 입력칸(그리고 한글 조합 중인 IME 상태)이 끊기므로,
      // 그 안의 개수 숫자 부분만 targeted하게 갈아 끼운다.
      const wrap=document.getElementById('cloudSharedResultsWrap');
      if(wrap) wrap.innerHTML=mbCloudRenderSharedResults();
      const lineageEl=document.getElementById('cloudSharedLineageBar');
      if(lineageEl) lineageEl.innerHTML=mbCloudRenderLineageBar();
      mbCloudCheckSharedFillViewport();
    });
  },250);
}
function mbCloudSharedSort(v){ mbCloud.sharedSort=v; mbCloudLoadShared().then(mbCloudRenderAndFillShared); }
function mbCloudSharedTagClick(t){ mbCloud.sharedTag=t; mbCloudLoadShared().then(mbCloudRenderAndFillShared); }
function mbCloudSharedSelect(id){ mbCloud.sharedSelectedId=id; mbCloudRenderKeepScroll(); }
async function mbCloudSharedOpen(id){
  if(!id) return;
  try{
    const rows=await mbRestFetch(`/mockups?id=eq.${id}&select=data,title,origin_id`);
    const row=rows&&rows[0]; if(!row) throw new Error('파일을 찾을 수 없습니다.');
    // 이 화면은 이제부터 row(id)에서 파생된 파일이 된다. 단, row 자신이 이미 다른 원본의 파생본이면
    // (row.origin_id가 있으면) 그 "최상위 원본"을 그대로 물려받는다 - 파생의 파생이 늘어나도 항상
    // 맨 위 원본 하나만 가리키게 해서(체인이 아니라 평평한 구조), 나중에 "이 원본에서 몇 개나
    // 파생됐는지" 셀 때 중간 단계 없이 한 번에 집계할 수 있게 한다.
    // mbCloudApplyData()의 render()가 자동저장을 그 자리에서 바로 실행시킬 수도 있으므로,
    // 그 스냅샷에도 반영되도록 데이터를 적용하기 전에 먼저 세팅한다.
    mbCloud.originId=row.origin_id||id;
    mbCloudApplyData(row.data);
    closeCloud();
    // "복제해서 열기"(버튼 클릭이든 더블클릭이든)에 성공한 뒤에만 횟수를 올린다 - 핵심 동작(열기)은
    // 이미 끝났으니, 횟수 갱신이 실패해도 사용자에게 에러를 보여주지 않고 조용히 넘어간다.
    mbCloudBumpOpenCount(id);
  }catch(e){ alert('열지 못했습니다.\n\n'+e.message); }
}
function mbCloudBumpOpenCount(id){
  const it=mbCloud.sharedItems.find(x=>x.id===id);
  if(it) it.open_count=(it.open_count||0)+1; // 화면에 이미 그려둔 값이 있다면 즉시 반영
  mbRestFetch('/rpc/mb_increment_open_count',{method:'POST',body:JSON.stringify({p_id:id})}).catch(()=>{});
}
// 목록으로 보기 우측의 "진짜" 미리보기 - 저장 시점의 정적 썸네일(SVG 스냅샷)이 아니라, 그
// 파일의 실제 comps 데이터를 그 화면을 그릴 때 쓰는 것과 완전히 같은 함수(buildExportHTML,
// HTML로 저장/미리보기 기능이 이미 쓰고 있는 바로 그 함수)로 그대로 그려서 iframe에 넣는다.
// 지금 편집 중인 캔버스(comps/cw/ch/스킨)를 아주 잠깐 다른 파일의 데이터로 바꿔치기해서 문자열을
// 만든 다음 곧바로 원래대로 되돌리는 방식이라, 화면을 다시 그리는 사이 텀이 없어(동기적으로
// 끝남) 실제 편집 중인 캔버스에는 아무 영향도 남기지 않는다.
function mbCloudBuildPreviewHTML(data){
  const cwEl=document.getElementById('cw'), chEl=document.getElementById('ch');
  const origComps=comps, origCw=cwEl.value, origCh=chEl.value;
  const origFat=document.body.classList.contains('skin-classic');
  try{
    comps=data.comps||[];
    cwEl.value=data.cw; chEl.value=data.ch;
    document.body.classList.toggle('skin-classic', data.skin==='fat');
    const full=buildExportHTML();
    // buildExportHTML()이 만드는 문서는 "다운로드해서 여는 파일" 용이라 페이지 여백/그림자/가운데
    // 정렬이 들어가 있고, 내용이 캔버스 크기보다 넘치면 스크롤되게 열려 있다(원본에 있는
    // html,body{overflow:visible!important} 규칙) - 미리보기 iframe에서는 스크롤 대신 확대/축소
    // 버튼으로 배율만 조절하게 할 것이므로, </head> 바로 앞에 그 여백을 걷어내고 스크롤 자체를
    // 막는 스타일을 하나 더 끼워 넣는다(마지막에 위치해 !important끼리는 뒤에 오는 규칙이 이겨서,
    // 원본 내용은 그대로 둔 채 이 부분만 안전하게 덮어쓴다).
    const override='<style>html,body{overflow:hidden!important;}body{background:#fff!important;margin:0!important;padding:0!important;}.mockup{margin:0!important;border:none!important;box-shadow:none!important;}</style></head>';
    return full.replace('</head>', override);
  } finally {
    comps=origComps; cwEl.value=origCw; chEl.value=origCh;
    document.body.classList.toggle('skin-classic', origFat);
  }
}
// 선택된 공유 목업의 data를 (처음 한 번만) 받아와 위 함수로 진짜 미리보기를 그려 iframe에
// 채운다. 같은 파일이 이미 그려져 있으면(스플리터/팝업 크기만 바뀐 경우) 다시 그리지 않고
// 스케일만 다시 맞춘다 - 매번 iframe을 새로 만들면 깜빡이고 느리다.
let mbSharedPreviewToken=0;
// null이면 "맞춤"(가진 공간에 꽉 차게 자동 배율) 상태, 숫자면 사용자가 확대/축소 버튼으로 직접
// 정한 배율(1=100%) - 새 파일을 선택하면 항상 맞춤부터 다시 시작한다.
let mbSharedPreviewZoom=null;
let mbSharedPreviewFitScale=1;
async function mbCloudRenderSharedPreviewFrame(){
  const outer=document.getElementById('cloudSharedPreviewFrameOuter');
  if(!outer) return; // 카드뷰이거나(이 컨테이너 자체가 없음) 선택된 파일이 없으면 할 일 없음
  const it=mbCloud.sharedItems.find(x=>x.id===mbCloud.sharedSelectedId);
  if(!it) return;
  const existingFrame=outer.querySelector('iframe');
  if(existingFrame && existingFrame.dataset.itemId===it.id){ mbCloudFitSharedPreview(); return; }
  mbSharedPreviewZoom=null; // 다른 파일을 새로 그릴 때는 확대/축소 상태를 초기화하고 맞춤으로 시작
  const myToken=++mbSharedPreviewToken;
  if(!it._previewData){
    outer.innerHTML='<div class="cl-shared-preview-loading">미리보기를 불러오는 중...</div>';
    try{
      const rows=await mbRestFetch(`/mockups?id=eq.${it.id}&select=data`)||[];
      if(myToken!==mbSharedPreviewToken) return; // 그 사이 다른 파일을 선택했으면 이 결과는 버린다
      it._previewData=(rows[0]&&rows[0].data)||null;
    }catch(e){
      if(myToken!==mbSharedPreviewToken) return;
      outer.innerHTML='<div class="cl-shared-preview-empty">미리보기를 불러오지 못했습니다.</div>';
      return;
    }
  }
  if(myToken!==mbSharedPreviewToken) return;
  if(!it._previewData){ outer.innerHTML='<div class="cl-shared-preview-empty">미리보기가 없습니다.</div>'; return; }
  let html;
  try{ html=mbCloudBuildPreviewHTML(it._previewData); }
  catch(e){ outer.innerHTML='<div class="cl-shared-preview-empty">미리보기를 그리지 못했습니다.</div>'; return; }
  const cw=parseFloat(it._previewData.cw)||1100, ch=parseFloat(it._previewData.ch)||700;
  // 이 작은 미리보기는 "실제로 조작해보는 화면"이 아니라 이미지 보듯 훑어보는 용도라, iframe
  // 자체는 pointer-events:none으로 완전히 죽여서 콤보박스가 열리거나 입력칸에 커서가 생기거나
  // 텍스트가 선택되는 일이 아예 없게 한다. 대신 그 위(정확히는 부모인 scale-wrap)에서
  // mousedown을 받아 드래그한 만큼 바깥 스크롤 영역을 이동시켜, 사진 뷰어처럼 손으로 잡고
  // 이 작은 미리보기는 "실제로 조작해보는 화면"이 아니라 이미지 보듯 훑어보는 용도라, iframe
  // 자체는 pointer-events:none으로 완전히 죽여서 콤보박스가 열리거나 입력칸에 커서가 생기거나
  // 텍스트가 선택되는 일이 아예 없게 한다. 대신 그 위(정확히는 부모인 scale-wrap)에서
  // mousedown을 받아 드래그한 만큼 스크롤 영역을 이동시켜, 사진 뷰어처럼 손으로 잡고 끄는
  // 느낌을 낸다. 확대/축소 버튼(cl-shared-zoom-ctl)은 스크롤되는 영역(cl-shared-preview-scroll)
  // 바깥의 outer에 직접 두어서, 아무리 확대해서 드래그로 이리저리 움직여도 화면에 늘 같은
  // 자리에 고정돼 보인다(스크롤 안쪽에 있으면 콘텐츠와 같이 밀려버린다).
  outer.innerHTML=`<div class="cl-shared-preview-scroll" id="cloudSharedPreviewScroll">
      <div class="cl-shared-preview-scale-wrap" onmousedown="mbCloudPreviewDragStart(event)">
        <iframe id="cloudSharedPreviewFrame" data-item-id="${it.id}" data-cw="${cw}" data-ch="${ch}" sandbox="allow-scripts" scrolling="no" style="width:${cw}px;height:${ch}px;pointer-events:none;"></iframe>
      </div>
    </div>
    <div class="cl-shared-zoom-ctl">
      <button type="button" onclick="mbCloudSharedZoomStep(-1)" title="축소">－</button>
      <span class="cl-shared-zoom-pct" id="cloudSharedZoomPct" title="클릭하면 맞춤으로" onclick="mbCloudSharedZoomReset()">100%</span>
      <button type="button" onclick="mbCloudSharedZoomStep(1)" title="확대">＋</button>
    </div>`;
  const frame=document.getElementById('cloudSharedPreviewFrame');
  frame.srcdoc=html;
  mbCloudFitSharedPreview();
}
// 미리보기를 사진처럼 손으로 잡고 끄는 드래그 - 실제로는 스크롤 영역(cl-shared-preview-scroll)의
// scrollLeft/Top을 마우스가 움직인 만큼 반대로 옮기는 것뿐이라, 확대해서 스크롤할 내용이
// 있을 때만 의미가 있고 화면에 다 들어와 있으면(스크롤 자체가 없으면) 그냥 아무 일도 안 난다.
function mbCloudPreviewDragStart(e){
  const scroller=document.getElementById('cloudSharedPreviewScroll');
  if(!scroller) return;
  e.preventDefault(); // 드래그 중 텍스트/이미지 선택 커서가 뜨는 것 방지
  const startX=e.clientX, startY=e.clientY;
  const startLeft=scroller.scrollLeft, startTop=scroller.scrollTop;
  const wrap=e.currentTarget;
  wrap.classList.add('dragging');
  function onMove(ev){
    scroller.scrollLeft=startLeft-(ev.clientX-startX);
    scroller.scrollTop=startTop-(ev.clientY-startY);
  }
  function onUp(){
    wrap.classList.remove('dragging');
    document.removeEventListener('mousemove',onMove);
    document.removeEventListener('mouseup',onUp);
  }
  document.addEventListener('mousemove',onMove);
  document.addEventListener('mouseup',onUp);
}
// 스플리터를 끌거나 팝업 크기를 조절할 때마다 불리는, 가벼운 재조정 전용 함수 - iframe을 다시
// 만들지 않고 CSS transform:scale()만 다시 계산한다. 확대/축소 버튼으로 배율을 직접 정해둔
// 상태(맞춤이 아닌 상태)라면 그 배율을 그대로 유지하고(공간이 좁아지면 그만큼 잘려 보일 뿐,
// 스크롤은 생기지 않는다), "맞춤" 상태일 때만 남은 공간에 꽉 차도록 다시 계산한다.
function mbCloudFitSharedPreview(){
  const outer=document.getElementById('cloudSharedPreviewFrameOuter');
  const scroller=document.getElementById('cloudSharedPreviewScroll');
  const frame=scroller&&scroller.querySelector('iframe');
  const wrap=scroller&&scroller.querySelector('.cl-shared-preview-scale-wrap');
  if(!outer||!scroller||!frame||!wrap) return;
  const cw=parseFloat(frame.dataset.cw), ch=parseFloat(frame.dataset.ch);
  if(!cw||!ch) return;
  // 사용 가능한 공간은 확대/축소 버튼이 얹혀 있는 outer가 아니라, 실제로 스크롤되는 안쪽
  // scroller의 크기를 기준으로 잰다(같은 크기지만, 의미상 이쪽이 맞다).
  const availW=scroller.clientWidth-16, availH=scroller.clientHeight-16;
  if(availW<=0||availH<=0) return;
  mbSharedPreviewFitScale=Math.max(0.02, Math.min(availW/cw, availH/ch));
  const scale=(mbSharedPreviewZoom==null)?mbSharedPreviewFitScale:mbSharedPreviewZoom;
  frame.style.transform=`scale(${scale})`;
  // scale-wrap의 실제 박스 크기(width/height)를 확대된 픽셀 크기로 맞춰준다 - transform은 보이는
  // 크기만 바꿀 뿐 레이아웃 상 차지하는 공간은 그대로라서, 이렇게 실제 크기를 같이 키워줘야
  // scroller(overflow:auto)가 "지금 이 안에 다 안 들어가네" 하고 스크롤바를 내어준다. 맞춤 배율
  // 이하로는(availW/availH 안에 딱 맞거나 더 작게) 절대 커지지 않으므로 이 상태에선 스크롤이
  // 아예 생기지 않는다.
  wrap.style.width=(cw*scale)+'px';
  wrap.style.height=(ch*scale)+'px';
  const pctEl=document.getElementById('cloudSharedZoomPct');
  if(pctEl) pctEl.textContent=Math.round(scale*100)+'%';
}
// 확대/축소 버튼 - 지금 실제로 보이는 배율(맞춤 상태면 맞춤 배율, 아니면 사용자가 정한 배율)을
// 기준으로 한 단계씩 20%p 씩 키우거나 줄인다. 이후로는 "맞춤"이 아니라 사용자가 정한 배율을
// 그대로 유지한다(공간을 늘리거나 줄여도 바뀌지 않음) - "맞춤으로" 글자를 눌러야 다시 자동으로
// 돌아간다.
function mbCloudSharedZoomStep(dir){
  const base=(mbSharedPreviewZoom==null)?mbSharedPreviewFitScale:mbSharedPreviewZoom;
  let next=base+(dir>0?0.2:-0.2);
  next=Math.max(0.05, Math.min(4, next));
  mbSharedPreviewZoom=next;
  mbCloudFitSharedPreview();
}
function mbCloudSharedZoomReset(){
  mbSharedPreviewZoom=null;
  mbCloudFitSharedPreview();
}

checkVersion();
// 접속 시 로그인 상태 반영. 이미 로그인 세션이 남아있으면 그대로 쓰고, 없으면 "자동로그인"이
// 켜진 채로 저장된 아이디/비밀번호가 있는지 확인해서 조용히 한 번 로그인을 시도한다(실패해도
// 그냥 로그아웃 상태로 시작할 뿐, 화면에 에러를 띄우지는 않는다 - 저장된 비밀번호가 바뀐 뒤
// 방치된 경우 등을 사용자가 접속하자마자 에러로 마주치지 않게 하기 위함).
(async function(){
  if(!mbGetSession()){
    const saved=mbLoadLoginPrefs();
    if(saved.autoLogin&&saved.username&&saved.password){
      try{ await mbLogin(saved.username,saved.password); }catch(e){ /* 조용히 무시 - 필요하면 사용자가 직접 로그인 */ }
    }
  }
  mbUpdateAccountUI();
})();


/* ===== 모바일 Adaptive UI Layer v2 ===== */
(function(){
  'use strict';

  /* ---------- 컴포넌트 카탈로그 ---------- */
  var CATS=[
    {name:'레이아웃', items:[['title','🅣','제목'],['section','▬','섹션'],['panel','▢','패널'],['tabs','▤','탭'],['split','⊟','분할'],['searchbar','🔍','조회조건']]},
    {name:'입력', items:[['label','🄰','라벨'],['input','▭','입력'],['combo','▾','콤보'],['date','📅','날짜'],['daterange','📆','기간'],['check','☑','체크'],['radio','◉','라디오'],['popup','≡','팝업']]},
    {name:'액션', items:[['button','⬛','버튼']]},
    {name:'데이터', items:[['grid','▦','그리드'],['chart','📊','차트'],['tree','🌳','트리']]}
  ];
  var LABELS={},ICONS={};
  CATS.forEach(function(c){c.items.forEach(function(it){LABELS[it[0]]=it[2];ICONS[it[0]]=it[1];});});
  // 자주 쓰는 순서(도크·레일에 노출)
  var QUICK=['input','combo','button','grid','searchbar','date','check','label','title'];
  var recent=[];
  function pushRecent(t){ recent=[t].concat(recent.filter(function(x){return x!==t;})).slice(0,8); }
  // 팻모드에서는 조회조건(searchbar) 대신 팝업을 쓴다(데스크톱 도구상자와 동일한 규칙).
  // 도크/레일/전체 시트 어디서든 이 함수로 걸러서 두 모드의 컴포넌트 목록이 데스크톱과 일치하게 한다.
  function mbTypeVisible(t){
    var fat=document.body.classList.contains('skin-classic');
    if(t==='searchbar') return !fat;
    if(t==='popup') return fat;
    return true;
  }

  /* ---------- 기기 감지 ---------- */
  function isTouch(){ return ('ontouchstart' in window)||navigator.maxTouchPoints>0; }
  function detectMode(){
    if(window.__mbForce) return window.__mbForce;
    var q=(location.search.match(/[?&]mbmode=(mobile|tablet|pc)/)||[])[1]; if(q) return q;
    var w=window.innerWidth,h=window.innerHeight,shortSide=Math.min(w,h),longSide=Math.max(w,h);
    var coarse=false; try{ coarse=!!(window.matchMedia&&window.matchMedia('(pointer:coarse)').matches);}catch(e){}
    var ua=(navigator.userAgent||'');
    var phoneUA=/Android.*Mobile|iPhone|iPod/i.test(ua);
    var tabletUA=/iPad|Android(?!.*Mobile)|Tablet|PlayBook|Silk/i.test(ua);
    if((coarse&&shortSide<600)||phoneUA) return 'mobile';
    if((coarse&&shortSide<=1024&&longSide<=1400)||(tabletUA&&!phoneUA)) return 'tablet';
    return 'pc';
  }
  var curMode=null,curOri=null;
  function applyMode(force){
    var mode=detectMode();
    var portrait=window.innerHeight>=window.innerWidth;
    var oriChanged = (curOri!=null) && (portrait!==(curOri==='portrait'));
    if(mode===curMode && portrait===(curOri==='portrait') && !force) return;
    curMode=mode; curOri=portrait?'portrait':'landscape';
    var b=document.body;
    b.classList.remove('mb-mobile','mb-tablet','mb-portrait','mb-landscape');
    if(mode==='mobile') b.classList.add('mb-mobile');
    else if(mode==='tablet') b.classList.add('mb-tablet');
    b.classList.add(portrait?'mb-portrait':'mb-landscape');
    if(typeof updateBrandMode==='function') updateBrandMode();
    syncModeSwitch(mode);
    if(mode!=='pc'){
      // 방향이 바뀌면 미니맵을 기본 위치로 되돌려(이전 방향의 인라인 좌표가 화면 밖으로 나가는 것 방지)
      if(oriChanged||force) resetMiniMapPos();
      buildDock(); buildRail(); renderCtx(); syncHistBtns();
      setTimeout(function(){ mbFit(); clampMiniMap(); updateMiniMap(true); updateZoomBadge(); },60);
    } else {
      // PC 로 전환되면 자동 저장을 다시 켠다(모바일/태블릿에서 꺼졌던 경우 대비)
      try{ if(typeof autosaveReady!=='undefined') autosaveReady=true; }catch(e){}
    }
  }
  // 현재 모드에 맞춰 좌측 하단 전환 버튼의 활성(토글) 표시를 갱신한다
  function syncModeSwitch(mode){
    var ids={pc:'msbPc',tablet:'msbTablet',mobile:'msbMobile'};
    for(var k in ids){
      var el=document.getElementById(ids[k]);
      if(el) el.classList.toggle('on', k===mode);
    }
  }
  // 좌측 하단 아이콘으로 PC/태블릿/모바일을 강제 전환한다
  window.setDeviceMode=function(mode){
    if(mode!=='pc'&&mode!=='tablet'&&mode!=='mobile') return;
    if(window.__mbForce===mode) return;  // 이미 그 모드면 무시
    window.__mbForce=mode;
    try{ if(typeof mbCloseSheet==='function') mbCloseSheet(); }catch(e){}
    applyMode(true);
    // PC 로 돌아갈 때는 모바일 전용 클래스가 applyMode 안에서 제거되어 원래 화면으로 복귀한다
  };

  // 미니맵을 기본 위치(방향별 CSS)로 되돌린다
  function resetMiniMapPos(){
    var map=document.getElementById('mbMiniMap'); if(!map) return;
    map.classList.remove('mb-moved');
    map.style.left=''; map.style.right=''; map.style.top=''; map.style.bottom='';
  }
  // 미니맵이 화면 밖으로 나갔으면 안으로 끌어들인다(드래그 후 회전 대비)
  function clampMiniMap(){
    var map=document.getElementById('mbMiniMap'); if(!map) return;
    if(!map.classList.contains('mb-moved')) return; // 기본 위치면 CSS 가 처리
    var vw=window.innerWidth, vh=window.innerHeight;
    var w=map.offsetWidth||120, h=map.offsetHeight||80;
    var r=map.getBoundingClientRect();
    var x=r.left, y=r.top, changed=false;
    if(x+w>vw-6){ x=vw-w-6; changed=true; }
    if(x<6){ x=6; changed=true; }
    if(y+h>vh-6){ y=vh-h-6; changed=true; }
    if(y<56){ y=56; changed=true; }
    if(changed){ map.style.left=x+'px'; map.style.top=y+'px'; map.style.right='auto'; map.style.bottom='auto'; }
  }
  window.mbResetMiniMap=resetMiniMapPos;

  /* ---------- 유틸 ---------- */
  window.mbFit=function(){ try{ fitZoomToViewport(); updateZoomBadge(); updateMiniMap(true);}catch(e){} };
  // 손 도구(Pan): 켜면 컴포넌트 위에서도 드래그가 캔버스 이동(스크롤)만 되도록.
  window.mbPan=false;
  window.mbTogglePan=function(){
    window.mbPan=!window.mbPan;
    document.body.classList.toggle('mb-pan', window.mbPan);
    var b=document.getElementById('mbPanBtn'); if(b) b.classList.toggle('mb-on', window.mbPan);
    if(window.mbPan){
      // 이동 모드 진입: 선택 해제 + 컨텍스트 바 숨김 + 열린 속성창 닫기
      // (줌/스크롤 위치는 그대로 유지 — mbFit 리셋 호출 안 함)
      try{ unmountProps(); }catch(e){}
      try{ document.getElementById('mbSheetBg').classList.remove('show'); sheetOpen=false; }catch(e){}
      try{
        document.getElementById('mbSidePanel').classList.remove('open');
        document.body.classList.remove('mb-side-open');
      }catch(e){}
      try{ selectSingle(null); render(); }catch(e){}
      try{ renderCtx(); }catch(e){}
    }
    // 안내는 상단 배너(#mbPanHint)로만 표시 → 토스트 중복 제거
  };
  var toastT=null;
  window.mbToast=function(msg){ var el=document.getElementById('mbToast'); el.textContent=msg; el.style.display='block'; clearTimeout(toastT); toastT=setTimeout(function(){el.style.display='none';},1500); };
  function currentZoom(){ var s=document.getElementById('zoomSel'); return s?parseFloat(s.value)||1:1; }
  function esc(s){ return (s||'').toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  window.mbEsc=esc;

  /* ---------- 좌표 변환 ---------- */
  function clientToCanvas(cx,cy){
    var cv=document.getElementById('canvas'), z=currentZoom()||1, r=cv.getBoundingClientRect();
    return {x:Math.max(0,Math.round((cx-r.left)/z)), y:Math.max(0,Math.round((cy-r.top)/z))};
  }
  function scrollSelIntoView(){
    var sc=document.querySelector('.canvas-scroll'); if(!sc||sel==null) return;
    var c=comps.find(function(x){return x.id===sel;}); if(!c||c.parent) return;
    var z=currentZoom()||1, pad=40;
    var cx=c.x*z,cy=c.y*z,cw=(c.w||100)*z,ch=(c.h||40)*z;
    if(cx<sc.scrollLeft+pad) sc.scrollLeft=Math.max(0,cx-pad);
    else if(cx+cw>sc.scrollLeft+sc.clientWidth-pad) sc.scrollLeft=cx+cw-sc.clientWidth+pad;
    if(cy<sc.scrollTop+pad) sc.scrollTop=Math.max(0,cy-pad);
    else if(cy+ch>sc.scrollTop+sc.clientHeight-pad) sc.scrollTop=cy+ch-sc.clientHeight+pad;
  }

  /* ---------- 도크(세로) / 레일(가로) 빌드 ---------- */
  function buildDock(){
    var d=document.getElementById('mbDockScroll'); if(!d) return;
    var order=(recent.length?recent.slice(0,3):[]).concat(QUICK).filter(function(v,i,a){return a.indexOf(v)===i;}).filter(mbTypeVisible);
    var h='';
    order.forEach(function(t){ h+='<button class="mb-chip" onclick="mbPick(\''+t+'\')"><span class="ic">'+ICONS[t]+'</span>'+LABELS[t]+'</button>'; });
    h+='<button class="mb-chip all" onclick="mbOpenSheet(\'all\')"><span class="ic">⋯</span>전체</button>';
    d.innerHTML=h;
  }
  function buildRail(){
    var r=document.getElementById('mbRail'); if(!r) return;
    var order=(recent.length?recent.slice(0,2):[]).concat(QUICK).filter(function(v,i,a){return a.indexOf(v)===i;}).filter(mbTypeVisible).slice(0,9);
    var h='';
    order.forEach(function(t){ h+='<button class="mb-rail-btn" onclick="mbPick(\''+t+'\')"><span class="ic">'+ICONS[t]+'</span>'+LABELS[t]+'</button>'; });
    h+='<button class="mb-rail-btn more" onclick="mbOpenSheet(\'all\')"><span class="ic">⋯</span>전체</button>';
    r.innerHTML=h;
  }

  /* ---------- 컴포넌트 선택 → 탭해서 배치 ---------- */
  var armedType=null;
  window.mbPick=function(type){
    armedType=type; pushRecent(type);
    mbCloseSheet();
    document.body.classList.add('mb-arming');
    var arm=document.getElementById('mbArm');
    document.getElementById('mbArmTxt').textContent='📍 캔버스를 탭하면 「'+LABELS[type]+'」 생성';
    arm.style.display='flex';
    mbToast('놓을 위치를 탭하세요');
  };
  window.mbCancelPlace=function(){ armedType=null; document.body.classList.remove('mb-arming'); document.getElementById('mbArm').style.display='none'; };
  function placeArmed(cx,cy){
    if(!armedType) return false;
    var p=clientToCanvas(cx,cy), t=armedType;
    var d=(typeof defaultSizeFor==='function')?defaultSizeFor(t):((typeof defaults!=='undefined'&&defaults[t])?defaults[t]:{w:120,h:40});
    armedType=null; document.body.classList.remove('mb-arming'); document.getElementById('mbArm').style.display='none';
    try{
      placeNewComponent(t, Math.max(0,p.x-Math.round((d.w||120)/2)), Math.max(0,p.y-Math.round((d.h||40)/2)));
      scrollSelIntoView(); renderCtx(); updateMiniMap(true);
      mbToast(LABELS[t]+' 추가됨');
    }catch(e){ mbToast('생성 실패'); }
    return true;
  }

  /* ---------- 컨텍스트 액션바 ---------- */
  function renderCtx(){
    var ctx=document.getElementById('mbCtx'); if(!ctx) return;
    var has=(typeof sel!=='undefined'&&sel!=null);
    var multi=(typeof selIds!=='undefined'&&selIds.size>1);
    if(!has && !multi){ ctx.classList.add('hidden'); mbSyncSide(); return; }
    ctx.classList.remove('hidden');
    var btns=[
      ['속성','⚙',"mbOpenProps()"],
      ['복제','⧉',"mbDo('dup')"],
      ['앞으로','⤒',"mbDo('front')"],
      ['뒤로','⤓',"mbDo('back')"],
      ['삭제','🗑',"mbDo('del')",'danger']
    ];
    var h='';
    btns.forEach(function(b,i){
      if(i===1||i===4) h+='<div class="mb-ctx-sep"></div>';
      h+='<button class="mb-ctx-btn'+(b[3]?' '+b[3]:'')+'" onclick="'+b[2]+'"><span class="ic">'+b[1]+'</span>'+b[0]+'</button>';
    });
    ctx.innerHTML=h;
    mbSyncSide();
  }

  /* ---------- 편집 액션 ---------- */
  window.mbDo=function(act){
    try{
      if(act==='undo'){ undo(); }
      else if(act==='redo'){ redo(); }
      else if(act==='del'){ if(sel!=null||selIds.size){ delSel(); mbToast('삭제됨'); } }
      else if(act==='dup'){
        if(sel==null && !selIds.size) return;
        copySelection(); pasteClipboard(); mbToast('복제됨');
      }
      else if(act==='front'){ mbZOrder(1); }
      else if(act==='back'){ mbZOrder(-1); }
    }catch(e){}
    renderCtx(); syncHistBtns(); updateMiniMap(true);
  };
  function mbZOrder(dir){
    if(sel==null) return;
    var i=comps.findIndex(function(c){return c.id===sel;}); if(i<0) return;
    try{ pushHistory(); }catch(e){}
    var c=comps.splice(i,1)[0];
    if(dir>0) comps.push(c); else comps.unshift(c);
    render();
  }
  function syncHistBtns(){
    var u=document.getElementById('mbUndoBtn'), r=document.getElementById('mbRedoBtn');
    try{
      if(u) u.disabled = (typeof undoStack!=='undefined')? !undoStack.length : false;
      if(r) r.disabled = (typeof redoStack!=='undefined')? !redoStack.length : false;
    }catch(e){}
  }

  /* ---------- 줌 ---------- */
  function updateZoomBadge(){ var b=document.getElementById('mbZoomBadge'); if(b) b.textContent=Math.round((currentZoom()||1)*100)+'%'; }
  window.mbCycleZoom=function(){
    var z=currentZoom()||1;
    var next = z>=0.99 ? 'fit' : (z<0.5? 1 : 1);
    if(next==='fit'){ mbFit(); } else { try{ setZoom(1); }catch(e){} }
    updateZoomBadge(); updateMiniMap(true);
    mbToast('줌 '+Math.round((currentZoom()||1)*100)+'%');
  };

  /* ---------- Bottom Sheet ---------- */
  var sheetOpen=false, sheetKind=null;
  window.mbOpenSheet=function(kind){
    var body=document.getElementById('mbSheetBody'), title=document.getElementById('mbSheetTitle');
    if(kind==='all'){ title.textContent='컴포넌트 추가'; body.innerHTML=allCompsHTML(); }
    else if(kind==='props'){ title.textContent='속성'; mountProps(body); }
    else if(kind==='layers'){ title.textContent='레이어'; body.innerHTML=layersHTML(); }
    else if(kind==='opts'){ title.textContent='보기 설정'; body.innerHTML=optsHTML(); syncOptsUI(); }
    else if(kind==='menu'){ title.textContent='메뉴'; body.innerHTML=menuHTML(); }
    document.getElementById('mbSheetBg').classList.add('show'); sheetOpen=true; sheetKind=kind;
  };
  window.mbCloseSheet=function(){ unmountProps(); document.getElementById('mbSheetBg').classList.remove('show'); sheetOpen=false; sheetKind=null; };
  window.mbSheetBgTap=function(e){ if(e.target&&e.target.id==='mbSheetBg') mbCloseSheet(); };

  function allCompsHTML(){
    var h='';
    var recentVisible=recent.filter(mbTypeVisible);
    if(recentVisible.length){
      h+='<div class="mb-cat"><h4>최근</h4><div class="mb-comp-grid">';
      recentVisible.forEach(function(t){ h+=compBtn(t); }); h+='</div></div>';
    }
    CATS.forEach(function(c){
      var items=c.items.filter(function(it){ return mbTypeVisible(it[0]); });
      if(!items.length) return;
      h+='<div class="mb-cat"><h4>'+c.name+'</h4><div class="mb-comp-grid">';
      items.forEach(function(it){ h+=compBtn(it[0]); }); h+='</div></div>';
    });
    return h;
  }
  function compBtn(t){ return '<button class="mb-comp" onclick="mbPick(\''+t+'\')"><span class="ic">'+ICONS[t]+'</span>'+LABELS[t]+'</button>'; }

  /* ---------- 속성(세로=시트, 가로=사이드패널) ---------- */
  var propOrigParent=null,propPlaceholder=null;
  var propRefreshTimer=null, propLastHTML='';
  // 속성 패널을 "복사" 방식으로 표시(노드 이동 X → 인앱 브라우저 렌더 이슈 회피).
  // renderProps 가 #props(화면 밖)에 그린 HTML 을 host 로 복사한다. 인라인 핸들러(upd 등)는
  // 전역 함수를 호출하므로 복사해도 그대로 동작한다.
  function mountProps(hostContainer){
    // 혹시 과거 방식(노드 이동)이 남아 있으면 원복
    var moved=document.getElementById('props');
    if(moved && moved.classList.contains('mb-in-sheet')){ try{ legacyUnmount(); }catch(e){} }
    hostContainer.innerHTML='<div id="mbPropHost"></div>';
    var host=document.getElementById('mbPropHost');
    propLastHTML=''; // 새 호스트는 반드시 첫 복사에서 채워지도록 캐시를 비운다
    copyPropsInto(host);
    // 열려 있는 동안 값 변경(재렌더)을 반영: 짧은 주기로 HTML 변화 시에만 복사
    clearInterval(propRefreshTimer);
    propRefreshTimer=setInterval(function(){
      var hostNow=document.getElementById('mbPropHost'); if(!hostNow){ clearInterval(propRefreshTimer); return; }
      copyPropsInto(hostNow);
    }, 350);
  }
  function copyPropsInto(host){
    if(!host) return;
    var props=document.getElementById('props');
    try{ renderProps(); }catch(e){}
    var htmlNow=props?props.innerHTML:'';
    // 호스트가 이미 같은 내용으로 채워져 있을 때만 스킵한다.
    // (아직 비어 있으면 캐시 값과 무관하게 반드시 채운다 → 빈 창 방지)
    if(host.__filled && htmlNow===propLastHTML) return;
    // 단, 편집 중 포커스가 host 안 '텍스트 입력칸'에 있을 때만 덮어쓰지 않는다(입력 방해 방지).
    // 버튼/셀렉트(보기·숨기기 토글 등)에 포커스가 있는 경우는 즉시 반영해야 하므로 예외로 둔다.
    var ae=document.activeElement;
    var editing = ae && host.contains(ae) &&
      (ae.tagName==='TEXTAREA' || (ae.tagName==='INPUT' && ae.type!=='button' && ae.type!=='checkbox' && ae.type!=='radio' && ae.type!=='range'));
    if(host.__filled && editing) return;
    propLastHTML=htmlNow;
    host.innerHTML = htmlNow || '<div class="empty-props" style="color:#94a2ae;text-align:center;padding:24px 0;">컴포넌트를 선택하면<br>여기에 속성이 표시됩니다.</div>';
    host.__filled=true;
  }
  function unmountProps(){
    clearInterval(propRefreshTimer); propRefreshTimer=null; propLastHTML='';
    legacyUnmount();
  }
  // 과거 노드-이동 방식 잔재 정리(안전)
  function legacyUnmount(){
    var props=document.getElementById('props');
    if(props&&propPlaceholder&&propOrigParent){
      propOrigParent.insertBefore(props,propPlaceholder);
      propPlaceholder.remove(); propPlaceholder=null;
      props.classList.remove('mb-in-sheet'); props.removeAttribute('style');
    }
  }
  // 속성 열기/닫기 토글: 세로=시트 / 가로=사이드패널.
  // 세로 모드에서는 사이드패널이 CSS로 숨겨지므로(display:none) 반드시 시트를 쓴다.
  // mb-landscape 가 명시적으로 있고 mb-portrait 가 아닐 때만 사이드패널을 사용한다.
  window.mbOpenProps=function(){
    var b=document.body;
    var useSide = b.classList.contains('mb-landscape') && !b.classList.contains('mb-portrait');
    if(useSide){
      var panel=document.getElementById('mbSidePanel');
      if(panel && panel.classList.contains('open')){ mbCloseSide(); }
      else { mbOpenSide(); }
    } else {
      if(sheetOpen && sheetKind==='props'){ mbCloseSheet(); }
      else { mbOpenSheet('props'); }
    }
  };
  window.mbOpenSide=function(){
    var panel=document.getElementById('mbSidePanel'), body=document.getElementById('mbSideBody');
    document.body.classList.add('mb-side-open'); panel.classList.add('open');
    mountProps(body);
    setTimeout(function(){ mbFit(); },240);
  };
  window.mbCloseSide=function(){
    unmountProps();
    document.getElementById('mbSidePanel').classList.remove('open');
    document.body.classList.remove('mb-side-open');
    setTimeout(function(){ mbFit(); },240);
  };
  // 선택 변화 시 열려있는 사이드패널 갱신
  function mbSyncSide(){
    var panel=document.getElementById('mbSidePanel');
    if(panel && panel.classList.contains('open')){
      var host=document.getElementById('mbPropHost');
      if(host){ copyPropsInto(host); }
      else { mountProps(document.getElementById('mbSideBody')); }
    }
  }
  // 속성 패널 토글(보기/숨기기 등)이 renderProps 만 호출해도 모바일/태블릿 호스트를 즉시 갱신
  window.mbSyncProps=function(){
    var host=document.getElementById('mbPropHost');
    if(host){ propLastHTML=''; copyPropsInto(host); }
  };

  /* ---------- 레이어 ---------- */
  function layersHTML(){
    if(typeof comps==='undefined'||!comps.length) return '<div class="mb-layer-empty">아직 컴포넌트가 없습니다.<br>아래에서 추가하세요.</div>';
    var roots=comps.filter(function(c){return !c.parent;}), h='';
    roots.slice().reverse().forEach(function(c){ h+=layerRow(c,0); h+=childLayers(c.id,1); });
    return h;
  }
  function childLayers(pid,depth){
    var kids=comps.filter(function(c){return c.parent===pid;}), h='';
    kids.forEach(function(c){ h+=layerRow(c,depth); h+=childLayers(c.id,depth+1); });
    return h;
  }
  function layerName(c){
    var t=LABELS[c.type]||c.type;
    var txt=(c.text||c.labelText||c.gtitle||c.ctitle||'').toString().split('\n')[0].slice(0,16);
    return t+(txt?' · '+txt:'');
  }
  function layerRow(c,depth){
    var on=(typeof isSel==='function'&&isSel(c.id));
    return '<div class="mb-layer'+(on?' on':'')+'" style="margin-left:'+(depth*16)+'px" onclick="mbSelectLayer('+c.id+')">'+
      '<span class="lt">'+(ICONS[c.type]||'▫')+'</span><span>'+esc(layerName(c))+'</span>'+
      '<span class="lx" onclick="event.stopPropagation();mbDeleteLayer('+c.id+')">🗑</span></div>';
  }
  window.mbSelectLayer=function(id){ try{ selectSingle(id); render(); }catch(e){} renderCtx(); if(sheetOpen) mbOpenSheet('layers'); };
  window.mbDeleteLayer=function(id){ try{ selectSingle(id); delSel(); }catch(e){} renderCtx(); mbOpenSheet('layers'); updateMiniMap(true); };

  /* ---------- 보기설정 ---------- */
  function optsHTML(){
    return ''+
    '<div class="mb-opt-row"><span class="lbl">그리드 스냅</span><div class="ctl">'+
      '<label class="mb-switch"><input type="checkbox" id="mbOptSnap" onchange="mbOptToggle(\'snapChk\',this.checked)"><span class="track"></span></label></div></div>'+
    '<div class="mb-opt-row"><span class="lbl">스냅 크기</span><div class="ctl mb-stepper">'+
      '<button onclick="mbOptSnapSize(-5)">－</button><input type="number" id="mbOptSnapSize" onchange="mbOptSnapSizeSet(this.value)"><button onclick="mbOptSnapSize(5)">＋</button><span style="font-size:12px;color:var(--mb-ink-soft)">px</span></div></div>'+
    '<div class="mb-opt-row"><span class="lbl">격자 표시</span><div class="ctl">'+
      '<label class="mb-switch"><input type="checkbox" id="mbOptGrid" onchange="mbOptToggle(\'gridChk\',this.checked)"><span class="track"></span></label></div></div>'+
    '<div class="mb-opt-row"><span class="lbl">스마트 가이드</span><div class="ctl">'+
      '<label class="mb-switch"><input type="checkbox" id="mbOptSmart" onchange="mbOptToggle(\'smartChk\',this.checked)"><span class="track"></span></label></div></div>'+
    '<div class="mb-opt-row"><span class="lbl">캔버스 폭</span><div class="ctl mb-stepper">'+
      '<button onclick="mbBumpCanvas(\'w\',-50)">－</button><input type="number" id="mbCwInput" onchange="mbApplyCwCh(\'w\')"><button onclick="mbBumpCanvas(\'w\',50)">＋</button></div></div>'+
    '<div class="mb-opt-row"><span class="lbl">캔버스 높이</span><div class="ctl mb-stepper">'+
      '<button onclick="mbBumpCanvas(\'h\',-50)">－</button><input type="number" id="mbChInput" onchange="mbApplyCwCh(\'h\')"><button onclick="mbBumpCanvas(\'h\',50)">＋</button></div></div>';
  }
  function chk(id){ var e=document.getElementById(id); return e?e.checked:false; }
  function syncOptsUI(){
    var m={mbOptSnap:'snapChk',mbOptGrid:'gridChk',mbOptSmart:'smartChk'};
    Object.keys(m).forEach(function(k){ var e=document.getElementById(k); if(e) e.checked=chk(m[k]); });
    var ss=document.getElementById('mbOptSnapSize'); var real=document.getElementById('snapSize'); if(ss&&real) ss.value=real.value;
    mbSyncCanvasInputs();
  }
  window.mbOptToggle=function(realId,val){ var e=document.getElementById(realId); if(e && e.checked!==val){ e.checked=val; if(typeof e.onchange==='function') e.onchange(); else e.dispatchEvent(new Event('change')); } updateMiniMap(true); };
  window.mbOptSnapSize=function(delta){ var real=document.getElementById('snapSize'); if(!real) return; real.value=Math.max(1,(parseInt(real.value,10)||10)+delta); if(real.onchange) real.onchange(); var m=document.getElementById('mbOptSnapSize'); if(m) m.value=real.value; };
  window.mbOptSnapSizeSet=function(v){ var real=document.getElementById('snapSize'); if(!real) return; real.value=Math.max(1,parseInt(v,10)||10); if(real.onchange) real.onchange(); };

  window.mbBumpCanvas=function(which,delta){
    var id=which==='w'?'cw':'ch', el=document.getElementById(id); if(!el) return;
    var v=(parseInt(el.value,10)||(which==='w'?1100:700))+delta; v=Math.max(which==='w'?400:300,v);
    el.value=v; try{ which==='w'?setCW():setCH(); }catch(e){} mbSyncCanvasInputs(); updateMiniMap(true);
  };
  window.mbApplyCwCh=function(which){
    var srcId=which==='w'?'mbCwInput':'mbChInput', dstId=which==='w'?'cw':'ch';
    var src=document.getElementById(srcId), dst=document.getElementById(dstId); if(!src||!dst) return;
    var v=parseInt(src.value,10); if(isNaN(v)) v=(which==='w'?1100:700); v=Math.max(which==='w'?400:300,v);
    dst.value=v; try{ which==='w'?setCW():setCH(); }catch(e){} mbSyncCanvasInputs(); updateMiniMap(true);
  };
  function mbSyncCanvasInputs(){
    var cw=document.getElementById('cw'),ch=document.getElementById('ch');
    var mcw=document.getElementById('mbCwInput'),mch=document.getElementById('mbChInput');
    if(cw&&mcw) mcw.value=parseInt(cw.value,10)||1100;
    if(ch&&mch) mch.value=parseInt(ch.value,10)||700;
  }

  /* ---------- 메뉴 ---------- */
  function menuHTML(){
    var cur = document.body.classList.contains('mb-mobile') ? 'mobile'
            : document.body.classList.contains('mb-tablet') ? 'tablet' : 'pc';
    var seg = ''+
      '<div class="mb-sheet-label" style="margin-top:14px;">화면 모드</div>'+
      '<div class="mb-mode-seg">'+
        '<button class="seg'+(cur==='pc'?' on':'')+'" onclick="setDeviceMode(\'pc\')">'+
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="4" width="19" height="12.5" rx="1.6"/><path d="M8.5 20.5h7M12 16.5v4"/></svg>PC</button>'+
        '<button class="seg'+(cur==='tablet'?' on':'')+'" onclick="setDeviceMode(\'tablet\')">'+
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2.5" width="14" height="19" rx="2"/><circle cx="12" cy="18.3" r="0.9" fill="currentColor" stroke="none"/></svg>태블릿</button>'+
        '<button class="seg'+(cur==='mobile'?' on':'')+'" onclick="setDeviceMode(\'mobile\')">'+
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="2.5" width="10" height="19" rx="2.2"/><circle cx="12" cy="18.5" r="0.85" fill="currentColor" stroke="none"/></svg>모바일</button>'+
      '</div>';
    // 버전 표기: PC 좌측 하단의 "by June (ver...)" 값을 그대로 가져와 메뉴 맨 아래에 표시
    var verEl=document.getElementById('verText');
    var verTxt=verEl?verEl.textContent:'';
    var verHtml=verTxt?('<div class="mb-menu-ver">'+verTxt+'</div>'):'';
    // 데스크톱 상단바와 마찬가지로 템플릿 메뉴 항목은 씬모드·팻모드 모두에서 뺀다.
    var templateHtml='';
    return ''+
    '<button class="mb-big-btn" onclick="mbNavItem(\'layers\')"><span class="ic">🗂️</span>레이어</button>'+
    '<button class="mb-big-btn primary" onclick="mbEnterPreview()"><span class="ic">▶️</span>미리보기</button>'+
    '<button class="mb-big-btn" onclick="mbSafe(exportHTML)"><span class="ic">💾</span>HTML로 저장</button>'+
    '<button class="mb-big-btn" onclick="mbSafe(loadJSON)"><span class="ic">📂</span>불러오기</button>'+
    templateHtml+
    '<button class="mb-big-btn" onclick="mbClearCanvas()"><span class="ic">🧹</span>전체 지우기</button>'+
    '<button class="mb-big-btn" onclick="mbSafe(openGuide)"><span class="ic">📖</span>사용 가이드</button>'+
    seg+verHtml;
  }
  window.mbNavItem=function(k){ mbOpenSheet(k); };
  window.mbSafe=function(fn){ try{ mbCloseSheet(); if(typeof fn==='function') fn(); }catch(e){ mbToast('작업 실패'); } };

  // 모바일 안전 confirm (일부 인앱 브라우저는 window.confirm 을 무시함) + 전체 지우기
  window.mbClearCanvas=function(){
    mbCloseSheet();
    if(typeof comps==='undefined' || !comps.length){ mbToast('지울 내용이 없습니다'); return; }
    mbConfirm('전체 지우기', '모든 컴포넌트와 캔버스 설정을 처음 상태로 되돌릴까요? 되돌릴 수 없습니다.', '지우기', function(){
      try{
        comps=defaultScreen();
        selectSingle(null);
        try{ clearOriginTracking(); }catch(e){} // 전체 초기화이므로 공유파일 파생 추적 값도 함께 지운다
        var cw=document.getElementById('cw'), ch=document.getElementById('ch');
        if(cw){ cw.value=1100; setCW(); } if(ch){ ch.value=700; setCH(); }
        var s=document.getElementById('snapChk'); if(s) s.checked=true;
        var ss=document.getElementById('snapSize'); if(ss) ss.value=10;
        var g=document.getElementById('gridChk'); if(g) g.checked=true;
        var sm=document.getElementById('smartChk'); if(sm) sm.checked=true;
        try{ toggleGrid(); }catch(e){}
        try{ undoStack=[]; redoStack=[]; updateHistBtns(); }catch(e){}
        render();
        mbFit(); renderCtx(); updateMiniMap(true);
        mbToast('처음 상태로 되돌렸습니다');
      }catch(e){ mbToast('작업 실패'); }
    });
  };
  // 인앱 confirm 다이얼로그(자체 UI)
  function mbConfirm(title, msg, okLabel, onOk){
    var bg=document.getElementById('mbConfirmBg');
    if(!bg){
      bg=document.createElement('div'); bg.id='mbConfirmBg';
      bg.innerHTML='<div id="mbConfirmCard"><h3 id="mbcTitle"></h3><p id="mbcMsg"></p>'+
        '<div class="mbc-btns"><button class="mbc-cancel" id="mbcCancel">취소</button>'+
        '<button class="mbc-ok" id="mbcOk"></button></div></div>';
      document.body.appendChild(bg);
    }
    document.getElementById('mbcTitle').textContent=title;
    document.getElementById('mbcMsg').textContent=msg;
    var okBtn=document.getElementById('mbcOk'); okBtn.textContent=okLabel||'확인';
    bg.classList.add('show');
    function close(){ bg.classList.remove('show'); okBtn.onclick=null; document.getElementById('mbcCancel').onclick=null; bg.onclick=null; }
    okBtn.onclick=function(){ close(); if(onOk) onOk(); };
    document.getElementById('mbcCancel').onclick=close;
    bg.onclick=function(e){ if(e.target===bg) close(); };
  }
  window.mbConfirm=mbConfirm;

  /* ---------- Preview ---------- */
  // Mobile/tablet preview shows the SAME interactive HTML as 저장/데스크톱 미리보기,
  // loaded into a full-screen iframe, so component events (combo, tab, check, radio,
  // tree, split) actually work — not the static design-mode canvas.
  window.mbEnterPreview=function(){
    mbCloseSheet();
    try{ selectSingle(null); render(); }catch(e){}
    document.body.classList.add('mb-preview');
    let ok=false;
    try{
      const frame=document.getElementById('mbPreviewFrame');
      if(frame && typeof buildExportHTML==='function'){
        const html=buildExportHTML();
        // Center the mockup in the frame and allow pinch/scroll on touch.
        const doc=frame.contentWindow.document;
        doc.open(); doc.write(html); doc.close();
        try{ doc.documentElement.style.height='100%'; }catch(_){}
        document.body.classList.add('mb-preview-live');
        ok=true;
      }
    }catch(e){ ok=false; }
    // Fallback to the old static in-place preview if the iframe couldn't be built.
    if(!ok){ document.body.classList.remove('mb-preview-live'); renderCtx(); setTimeout(mbFit,60); }
  };
  window.mbExitPreview=function(){
    document.body.classList.remove('mb-preview');
    if(document.body.classList.contains('mb-preview-live')){
      document.body.classList.remove('mb-preview-live');
      try{ const frame=document.getElementById('mbPreviewFrame'); if(frame){ const d=frame.contentWindow.document; d.open(); d.write(''); d.close(); } }catch(e){}
    }
    setTimeout(mbFit,60);
  };

  /* ============================================================
     통합 터치 컨트롤러 — 직접 조작(합성 이벤트 미사용)
     ============================================================ */
  function findCmpEl(c){
    if(!c) return null;
    var cv=document.getElementById('canvas'), els=cv.querySelectorAll(':scope > .cmp'), match=null;
    els.forEach(function(el){ if(parseInt(el.style.left,10)===c.x&&parseInt(el.style.top,10)===c.y) match=el; });
    return match;
  }
  function hitTopComp(cx,cy){
    if(typeof comps==='undefined') return null;
    var roots=comps.filter(function(c){return !c.parent;});
    for(var i=roots.length-1;i>=0;i--){ var c=roots[i]; if(cx>=c.x&&cx<=c.x+c.w&&cy>=c.y&&cy<=c.y+c.h) return c; }
    return null;
  }
  function hitHandleScreen(c,sxp,syp){
    if(!c) return null;
    var z=currentZoom()||1, box={x:c.x*z,y:c.y*z,w:c.w*z,h:c.h*z}, R=16;
    if(box.w<3*R && box.h<3*R) return null;
    var iL=box.x+box.w*0.3,iR=box.x+box.w*0.7,iT=box.y+box.h*0.3,iB=box.y+box.h*0.7;
    if(sxp>iL&&sxp<iR&&syp>iT&&syp<iB) return null;
    var pts={se:{x:box.x+box.w,y:box.y+box.h},e:{x:box.x+box.w,y:box.y+box.h/2},s:{x:box.x+box.w/2,y:box.y+box.h}};
    var best=null,bd=R;
    for(var k in pts){ var d=Math.hypot(sxp-pts[k].x,syp-pts[k].y); if(d<=bd){bd=d;best=k;} }
    return best;
  }
  function setupTouch(){
    var sc=document.querySelector('.canvas-scroll'), cv=document.getElementById('canvas');
    if(!sc||sc.__mbTouch) return; sc.__mbTouch=true;
    // 이동 모드에서는 컴포넌트의 mousedown/click(합성 마우스 이벤트 포함)이
    // 선택/이동을 유발하지 못하도록 캡처 단계에서 가로챈다.
    if(cv && !cv.__mbPanGuard){
      cv.__mbPanGuard=true;
      ['mousedown','click'].forEach(function(evt){
        cv.addEventListener(evt,function(e){
          if(window.mbPan){ e.stopPropagation(); if(evt==='mousedown') e.preventDefault(); }
        },true);
      });
    }
    var mode=null,target=null,targetEl=null,rdir=null;
    var sx=0,sy=0,ox=0,oy=0,ow=0,oh=0,moved=false,committed=false;
    var startDist=0,startZoom=1,lpTimer=null,lastTap=0;
    function dist(t){var dx=t[0].clientX-t[1].clientX,dy=t[0].clientY-t[1].clientY;return Math.hypot(dx,dy);}
    function isPrev(){return document.body.classList.contains('mb-preview');}
    function commit(){ if(!committed){ try{pushHistory();}catch(e){} committed=true; } }

    sc.addEventListener('touchstart',function(e){
      if(isPrev()) return;
      if(e.touches.length===2){ clearTimeout(lpTimer); mode='pinch'; startDist=dist(e.touches); startZoom=currentZoom(); e.preventDefault(); return; }
      if(e.touches.length!==1) return;
      var t=e.touches[0]; sx=t.clientX; sy=t.clientY; moved=false; committed=false;
      // 손 도구가 켜져 있으면 어디를 눌러도 화면 이동(스크롤)만.
      if(window.mbPan){ mode='scroll'; document.body.classList.add('mb-panning'); return; }
      if(armedType){ placeArmed(t.clientX,t.clientY); e.preventDefault(); mode=null; return; }
      var p=clientToCanvas(t.clientX,t.clientY), cr=cv.getBoundingClientRect(), sxp=t.clientX-cr.left, syp=t.clientY-cr.top;
      var selComp=(sel!=null)?comps.find(function(c){return c.id===sel;}):null;
      if(selComp&&!selComp.parent){
        var hh=hitHandleScreen(selComp,sxp,syp);
        if(hh){ mode='resize'; target=selComp; rdir=hh; ox=selComp.x; oy=selComp.y; ow=selComp.w; oh=selComp.h; targetEl=findCmpEl(selComp); e.preventDefault(); return; }
      }
      var c=hitTopComp(p.x,p.y);
      if(c){
        target=c; mode='move'; ox=c.x; oy=c.y;
        if(!isSel(c.id)){ selectSingle(c.id); render(); renderCtx(); }
        targetEl=findCmpEl(c);
        // 길게 눌러 속성창 자동 표시하던 동작 제거 → 속성은 컨텍스트 바의 '속성' 버튼으로만 연다.
        clearTimeout(lpTimer);
        e.preventDefault(); return;
      }
      mode='scroll';
    },{passive:false});

    sc.addEventListener('touchmove',function(e){
      if(isPrev()) return;
      if(mode==='pinch'&&e.touches.length===2){
        e.preventDefault(); var d=dist(e.touches);
        if(startDist>0){ var z=Math.min(2,Math.max(0.25,startZoom*(d/startDist))); try{setZoom(Math.round(z*100)/100);}catch(err){} updateZoomBadge(); updateMiniMap(); }
        return;
      }
      if(e.touches.length!==1) return;
      var t=e.touches[0], ddx=t.clientX-sx, ddy=t.clientY-sy;
      if(!moved&&(Math.abs(ddx)>4||Math.abs(ddy)>4)){ moved=true; clearTimeout(lpTimer); }
      if(mode==='move'&&target){
        e.preventDefault(); if(!moved) return; commit();
        var z=currentZoom()||1;
        target.x=Math.max(0,snap(ox+ddx/z)); target.y=Math.max(0,snap(oy+ddy/z));
        if(targetEl){ targetEl.style.left=target.x+'px'; targetEl.style.top=target.y+'px'; } else { render(); targetEl=findCmpEl(target); }
        if(chk('smartChk')){ try{ clearGuides(); drawGuides(computeGuides(target,target.x,target.y)); }catch(err){} }
      } else if(mode==='resize'&&target){
        e.preventDefault(); if(!moved) return; commit();
        var z2=currentZoom()||1, nw=ow, nh=oh;
        if(rdir==='se'||rdir==='e') nw=Math.max(20,snap(ow+ddx/z2));
        if(rdir==='se'||rdir==='s') nh=Math.max(20,snap(oh+ddy/z2));
        target.w=nw; target.h=nh;
        if(targetEl){ targetEl.style.width=target.w+'px'; targetEl.style.height=target.h+'px'; } else { render(); targetEl=findCmpEl(target); }
      }
    },{passive:false});

    function endTouch(e){
      if(isPrev()) return;
      clearTimeout(lpTimer);
      if(mode==='pinch'){ if(!e.touches||e.touches.length<2) mode=null; updateZoomBadge(); return; }
      if(mode==='move'||mode==='resize'){
        try{ clearGuides(); }catch(err){}
        if(moved){ render(); }
        try{ updateMiniMap(true); renderCtx(); }catch(err){}
        mode=null; target=null; targetEl=null; rdir=null; return;
      }
      if(mode==='scroll'){
        if(!moved){
          if(!window.mbPan){
            try{ selectSingle(null); render(); }catch(err){} renderCtx();
          }
          var now=Date.now();
          if(now-lastTap<300){ var z=currentZoom(); if(z>=0.99){mbFit();}else{try{setZoom(1);}catch(e2){}} updateZoomBadge(); lastTap=0; } else lastTap=now;
        }
      }
      document.body.classList.remove('mb-panning');
      mode=null; target=null; targetEl=null; rdir=null;
    }
    sc.addEventListener('touchend',endTouch,{passive:false});
    sc.addEventListener('touchcancel',function(){ clearTimeout(lpTimer); document.body.classList.remove('mb-panning'); mode=null; target=null; targetEl=null; rdir=null; },{passive:true});
  }

  /* ---------- 캔버스 코너 리사이즈 터치 ---------- */
  function setupCanvasResizeTouch(){
    var handle=document.getElementById('canvasResize'); if(!handle||handle.__mbCR) return; handle.__mbCR=true;
    var cd=null;
    handle.addEventListener('touchstart',function(e){
      if(e.touches.length!==1) return; e.preventDefault(); e.stopPropagation();
      var t=e.touches[0]; cd={sx:t.clientX,sy:t.clientY,ow:canvas.offsetWidth,oh:canvas.offsetHeight};
    },{passive:false});
    handle.addEventListener('touchmove',function(e){
      if(!cd||e.touches.length!==1) return; e.preventDefault(); e.stopPropagation();
      var t=e.touches[0], z=currentZoom()||1, w=cd.ow+(t.clientX-cd.sx)/z, h=cd.oh+(t.clientY-cd.sy)/z;
      if(chk('snapChk')){ var s=parseInt(document.getElementById('snapSize').value)||10; w=Math.round(w/s)*s; h=Math.round(h/s)*s; }
      w=Math.max(400,w); h=Math.max(300,h);
      canvas.style.width=w+'px'; canvas.style.height=h+'px'; try{applyZoom();}catch(err){}
      var cwEl=document.getElementById('cw'),chEl=document.getElementById('ch');
      if(cwEl) cwEl.value=Math.round(w); if(chEl) chEl.value=Math.round(h);
      mbSyncCanvasInputs(); updateMiniMap();
    },{passive:false});
    function end(){ cd=null; }
    handle.addEventListener('touchend',end,{passive:false});
    handle.addEventListener('touchcancel',end,{passive:true});
  }

  /* ---------- 미니맵 ---------- */
  var miniState={sig:'',maxW:120,maxH:88,scale:1};
  function miniEls(){ return {map:document.getElementById('mbMiniMap'),cvs:document.getElementById('mbMiniCanvas'),view:document.getElementById('mbMiniView')}; }
  function canvasLogicalSize(){ var w=parseInt(canvas.style.width,10)||canvas.offsetWidth||1100, h=parseInt(canvas.style.height,10)||canvas.offsetHeight||700; return {w:w,h:h}; }
  function updateMiniMap(force){
    var e=miniEls(); if(!e.map||!e.cvs) return;
    var isPC = !document.body.classList.contains('mb-mobile') && !document.body.classList.contains('mb-tablet');
    // PC 에서는 미니맵 체크가 켜져 있을 때만(그리고 미리보기 아닐 때만) 갱신
    if(isPC && !document.body.classList.contains('mb-pc-mini')) return;
    if(document.body.classList.contains('mb-preview')) return;
    if(e.map.classList.contains('mini-collapsed')) return;
    var sc=document.querySelector('.canvas-scroll'); if(!sc) return;
    var probe=e.cvs.getContext&&e.cvs.getContext('2d'); if(!probe) return;
    var cs=canvasLogicalSize(), z=(typeof zoom!=='undefined'?zoom:1)||1;
    var scale=Math.min(miniState.maxW/cs.w,miniState.maxH/cs.h);
    var mw=Math.max(40,Math.round(cs.w*scale)), mh=Math.max(30,Math.round(cs.h*scale));
    var vx=sc.scrollLeft/z,vy=sc.scrollTop/z,vw=sc.clientWidth/z,vh=sc.clientHeight/z;
    var sig=[cs.w,cs.h,z,Math.round(vx),Math.round(vy),Math.round(vw),Math.round(vh),comps.length,comps.map(function(c){return c.id+':'+c.x+','+c.y+','+c.w+','+c.h+','+c.type+(isSel(c.id)?'*':'');}).join('|')].join(';');
    if(!force&&sig===miniState.sig) return;
    miniState.sig=sig; miniState.scale=scale;
    e.map.style.width=mw+'px'; e.map.style.height=mh+'px';
    var dpr=window.devicePixelRatio||1;
    e.cvs.width=Math.round(mw*dpr); e.cvs.height=Math.round(mh*dpr); e.cvs.style.width=mw+'px'; e.cvs.style.height=mh+'px';
    var ctx=probe; ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,mw,mh);
    ctx.fillStyle='#fff'; ctx.fillRect(0,0,mw,mh);
    var pal={title:'#22303f',section:'#8a949c',panel:'#cfd6dc',tabs:'#b9c3cc',split:'#b9c3cc',searchbar:'#dfe8f0',label:'#c9cfd5',input:'#e3f0ea',combo:'#e3f0ea',date:'#e3f0ea',daterange:'#e3f0ea',check:'#e3f0ea',radio:'#e3f0ea',button:'#1e9e6a',grid:'#eef3f7',chart:'#e7eef6',tree:'#eef3f7'};
    comps.forEach(function(c){ if(c.parent) return; var x=c.x*scale,y=c.y*scale,w=Math.max(1,c.w*scale),h=Math.max(1,c.h*scale);
      ctx.fillStyle=pal[c.type]||'#dde3e8'; ctx.fillRect(x,y,w,h);
      ctx.strokeStyle='rgba(0,0,0,.08)'; ctx.lineWidth=0.5; ctx.strokeRect(x+0.25,y+0.25,w-0.5,h-0.5);
      if(isSel(c.id)){ ctx.strokeStyle='#2680eb'; ctx.lineWidth=1.2; ctx.strokeRect(x,y,w,h); }
    });
    ctx.strokeStyle='#d9dee3'; ctx.lineWidth=1; ctx.strokeRect(0.5,0.5,mw-1,mh-1);
    var rx=Math.max(0,vx*scale),ry=Math.max(0,vy*scale),rw=Math.min(mw-rx,vw*scale),rh=Math.min(mh-ry,vh*scale);
    if(vw>=cs.w){rx=0;rw=mw;} if(vh>=cs.h){ry=0;rh=mh;}
    e.view.style.left=rx+'px'; e.view.style.top=ry+'px'; e.view.style.width=Math.max(6,rw)+'px'; e.view.style.height=Math.max(6,rh)+'px';
  }
  function miniScrollTo(cx,cy){
    var e=miniEls(), sc=document.querySelector('.canvas-scroll'); if(!e.map||!sc) return;
    var r=e.cvs.getBoundingClientRect(), scale=miniState.scale||1, z=(typeof zoom!=='undefined'?zoom:1)||1;
    var mx=cx-r.left,my=cy-r.top, cxL=mx/scale,cyL=my/scale, vw=sc.clientWidth/z,vh=sc.clientHeight/z;
    sc.scrollLeft=Math.max(0,(cxL-vw/2)*z); sc.scrollTop=Math.max(0,(cyL-vh/2)*z); updateMiniMap(true);
  }
  window.mbToggleMiniMap=function(ev){ if(ev) ev.stopPropagation(); var map=document.getElementById('mbMiniMap'); if(!map) return; var col=map.classList.toggle('mini-collapsed'); var b=document.getElementById('mbMiniToggle'); if(b) b.textContent=col?'▣':'◱'; if(!col) updateMiniMap(true); };
  window.mbUpdateMiniMap=function(){ updateMiniMap(true); };
  // PC 상단 툴바의 「미니맵」 체크박스: 켜면 미니맵 표시, 끄면 숨김
  window.togglePcMiniMap=function(){
    var chk=document.getElementById('miniChk');
    var on=chk?chk.checked:true;
    document.body.classList.toggle('mb-pc-mini', on);
    if(on){
      // 켜질 때 접힘 상태였다면 펼친 상태로 되돌리고 갱신
      var map=document.getElementById('mbMiniMap');
      if(map){ map.classList.remove('mb-moved'); }
      updateMiniMap(true);
    }
  };
  function setupMiniMap(){
    var e=miniEls(); if(!e.map||e.map.__mbMini) return; e.map.__mbMini=true;
    var sc=document.querySelector('.canvas-scroll'); if(sc) sc.addEventListener('scroll',function(){ updateMiniMap(); },{passive:true});
    var moveH=document.getElementById('mbMiniMove');

    // (A) 손잡이로 미니맵 위치 이동
    var moving=false, moDX=0, moDY=0;
    function moStart(cx,cy){
      var r=e.map.getBoundingClientRect(); moving=true; moDX=cx-r.left; moDY=cy-r.top;
      e.map.classList.add('mb-moved');
    }
    function moMove(cx,cy){
      if(!moving) return;
      var vw=window.innerWidth, vh=window.innerHeight, w=e.map.offsetWidth, h=e.map.offsetHeight;
      var x=Math.min(Math.max(6,cx-moDX), vw-w-6), y=Math.min(Math.max(56,cy-moDY), vh-h-6);
      e.map.style.left=x+'px'; e.map.style.top=y+'px'; e.map.style.right='auto'; e.map.style.bottom='auto';
    }
    function moEnd(){ moving=false; }
    if(moveH){
      moveH.addEventListener('touchstart',function(ev){ if(ev.touches.length!==1) return; ev.preventDefault(); ev.stopPropagation(); moStart(ev.touches[0].clientX,ev.touches[0].clientY); },{passive:false});
      moveH.addEventListener('touchmove',function(ev){ if(!moving||ev.touches.length!==1) return; ev.preventDefault(); ev.stopPropagation(); moMove(ev.touches[0].clientX,ev.touches[0].clientY); },{passive:false});
      moveH.addEventListener('touchend',function(ev){ ev.stopPropagation(); moEnd(); },{passive:true});
      moveH.addEventListener('mousedown',function(ev){ ev.preventDefault(); ev.stopPropagation(); moStart(ev.clientX,ev.clientY); var mm=function(m){ moMove(m.clientX,m.clientY); }; var mu=function(){ moEnd(); document.removeEventListener('mousemove',mm); document.removeEventListener('mouseup',mu); }; document.addEventListener('mousemove',mm); document.addEventListener('mouseup',mu); });
    }

    // (B) 지도 본문 드래그/탭 = 뷰포트 이동(스크롤)
    var navDrag=false;
    e.map.addEventListener('touchstart',function(ev){
      if(ev.target&&(ev.target.id==='mbMiniToggle'||ev.target.id==='mbMiniMove')) return;
      if(e.map.classList.contains('mini-collapsed')) return;
      if(ev.touches.length!==1) return; navDrag=true; ev.preventDefault(); ev.stopPropagation();
      miniScrollTo(ev.touches[0].clientX,ev.touches[0].clientY);
    },{passive:false});
    e.map.addEventListener('touchmove',function(ev){ if(!navDrag||ev.touches.length!==1) return; ev.preventDefault(); ev.stopPropagation(); miniScrollTo(ev.touches[0].clientX,ev.touches[0].clientY); },{passive:false});
    e.map.addEventListener('touchend',function(){ navDrag=false; },{passive:true});

    // (B-PC) 마우스로 지도 본문을 클릭/드래그하면 뷰포트 이동(스크롤) — PC 지원
    var mNav=false;
    e.map.addEventListener('mousedown',function(ev){
      if(ev.target&&(ev.target.id==='mbMiniToggle'||ev.target.id==='mbMiniMove')) return;
      if(e.map.classList.contains('mini-collapsed')) return;
      ev.preventDefault(); ev.stopPropagation(); mNav=true;
      miniScrollTo(ev.clientX,ev.clientY);
      var mm=function(m){ if(mNav){ miniScrollTo(m.clientX,m.clientY); } };
      var mu=function(){ mNav=false; document.removeEventListener('mousemove',mm); document.removeEventListener('mouseup',mu); };
      document.addEventListener('mousemove',mm); document.addEventListener('mouseup',mu);
    });

    setInterval(function(){ updateMiniMap(); },300);
    updateMiniMap(true);
  }

  /* ---------- 코치마크 ---------- */
  function maybeCoach(){ if(localStorage.getItem('mb_coach_v2')==='1') return; document.getElementById('mbCoach').classList.add('show'); }
  window.mbCloseCoach=function(){ document.getElementById('mbCoach').classList.remove('show'); localStorage.setItem('mb_coach_v2','1'); };

  /* ---------- render() 후킹: 선택/컨텍스트/미니맵 동기화 ---------- */
  // 모바일 상단바 타이틀: 배지 안에 기존 PC의 M 로고 이미지를 넣고, 글자색은 PC 톤(흰색)에 맞춘다.
  function setupBrandLogo(){
    var brand=document.getElementById('mbBrand'); if(!brand || brand.__logo) return;
    // PC 로고의 이미지(.brand-m img)를 그대로 가져와 배지에 넣는다(원본 색상 유지)
    var pcImg=document.querySelector('.topbar .brand .brand-box .brand-m img');
    brand.innerHTML='<span class="mb-brand-mark"></span>'
      +'<span class="mb-brand-txt">Mockup<span class="mb-brand-accent"> Builder</span><span class="mb-brand-shine"></span></span>'
      +'<span class="mb-brand-mode" id="mbBrandMode"></span>';
    var markEl=brand.querySelector('.mb-brand-mark');
    if(pcImg && pcImg.getAttribute('src')){
      var img=document.createElement('img');
      img.src=pcImg.getAttribute('src');
      img.alt='M';
      markEl.appendChild(img);
    } else {
      markEl.textContent='M'; markEl.classList.add('mb-mark-fallback');
    }
    brand.setAttribute('aria-label','Mockup Builder');
    brand.__logo=true;
    updateBrandMode();
  }
  // 현재 모드(mobile/tablet)를 브랜드 옆에 아이콘으로 표시
  function updateBrandMode(){
    var el=document.getElementById('mbBrandMode'); if(!el) return;
    var b=document.body;
    var tabletSvg='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2.5" width="14" height="19" rx="2"/><circle cx="12" cy="18.3" r="0.9" fill="currentColor" stroke="none"/></svg>';
    var mobileSvg='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="2.5" width="10" height="19" rx="2.2"/><circle cx="12" cy="18.5" r="0.85" fill="currentColor" stroke="none"/></svg>';
    if(b.classList.contains('mb-tablet')){ el.innerHTML=tabletSvg; el.setAttribute('aria-label','태블릿'); el.style.display='inline-flex'; }
    else if(b.classList.contains('mb-mobile')){ el.innerHTML=mobileSvg; el.setAttribute('aria-label','모바일'); el.style.display='inline-flex'; }
    else { el.innerHTML=''; el.removeAttribute('aria-label'); el.style.display='none'; }
  }
  window.__mbUpdateBrandMode=updateBrandMode;

  function hookRender(){
    if(window.__mbRenderHooked) return; window.__mbRenderHooked=true;
    var _r=window.render;
    window.render=function(){ var out=_r.apply(this,arguments); try{ if(curMode&&curMode!=='pc'){ renderCtx(); syncHistBtns(); } else { updateMiniMap(); } }catch(e){} return out; };
  }

  // 모바일/태블릿에서는 투어(화면 둘러보기)를 비활성화한다.
  // 투어는 PC 요소(도구상자·속성패널 등)에 스포트라이트를 비추므로 모바일에서 오작동한다.
  function hookTour(){
    if(window.__mbTourHooked) return; window.__mbTourHooked=true;
    var _start=window.startTour;
    window.startTour=function(){
      if(document.body.classList.contains('mb-mobile')||document.body.classList.contains('mb-tablet')){
        // 혹시 자동 시작으로 떠 있으면 닫고, 다시 뜨지 않도록 seen 표시
        try{ var ov=document.getElementById('tourOverlay'); if(ov) ov.style.display='none'; }catch(e){}
        try{ localStorage.setItem('mb_tour_seen','1'); }catch(e){}
        return;
      }
      return _start&&_start.apply(this,arguments);
    };
    // 자동 시작(load 후 600ms)이 이미 예약돼 있어도, 모바일이면 오버레이를 즉시 닫는다.
    if(document.body.classList.contains('mb-mobile')||document.body.classList.contains('mb-tablet')){
      try{ localStorage.setItem('mb_tour_seen','1'); }catch(e){}
      var kill=function(){ var ov=document.getElementById('tourOverlay'); if(ov) ov.style.display='none'; };
      kill(); setTimeout(kill,650); setTimeout(kill,1200);
    }
  }

  /* ---------- init ---------- */
  function init(){
    hookRender();
    applyMode();
    hookTour();
    setupBrandLogo();
    setupTouch(); setupCanvasResizeTouch(); setupMiniMap();
    // PC 미니맵: 기본 켜짐(체크박스 상태 반영). 모바일/태블릿은 자체 위치를 쓰므로 이 클래스와 무관.
    try{ if(typeof togglePcMiniMap==='function') togglePcMiniMap(); }catch(e){}
    updateZoomBadge();
    if(curMode&&curMode!=='pc') maybeCoach();
    var rt=null;
    window.addEventListener('resize',function(){ clearTimeout(rt); rt=setTimeout(function(){ applyMode(); },200); });
    window.addEventListener('orientationchange',function(){ setTimeout(function(){ applyMode(true); },260); });
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init); else init();

  window.mbForceMode=function(m){ window.__mbForce=m||null; applyMode(true); };
  window.mbAutoMode=function(){ window.__mbForce=null; applyMode(true); };
  // 스킨(Thin↔Fat) 전환 시 모바일/태블릿의 도크·레일(컴포넌트 목록: 조회조건↔팝업)과
  // 브랜드 모드 표시를 다시 그린다. PC 모드에서는 할 일이 없다.
  window.mbRefreshForSkin=function(){
    try{ if(curMode&&curMode!=='pc'){ buildDock(); buildRail(); } }catch(e){}
    try{ if(typeof updateBrandMode==='function') updateBrandMode(); }catch(e){}
  };
})();

/* ===== 부트스트랩 / 접속 로그 ===== */
(function(){
  'use strict';
  /*
   * mockup-accesslog.js (인라인) - Mockup Builder 페이지 접속 시 Supabase에 접속 로그를 기록한다.
   * daaf-wave(src/main/accesslog.js)의 access_log INSERT 로직을 브라우저 환경으로 이식한 버전.
   * - 이 페이지는 Electron/Node가 아닌 순수 브라우저 스크립트라서 PC 호스트명(os.hostname())이나
   *   Windows 로그인 계정(os.userInfo())은 얻을 수 없다. 대신 hostname 자리에는 페이지가
   *   서비스되는 도메인(location.hostname, 파일을 직접 열었으면 'local-file')을 넣고,
   *   os_user 자리에는 사람을 특정하는 대신 기기/환경 정보(브라우저 종류·언어·시간대·해상도)를
   *   한 줄로 묶어서 넣는다(getDeviceEnvInfo).
   * - 외부(공인) IP·지역(도시,국가코드)은 ipapi.co(실패 시 ipify로 IP만 폴백)로, 앱 버전은 좌측 하단
   *   verText의 "ver.YYYYMMDD.NNN" 문자열을 그대로 사용.
   * - Supabase REST(mockup_access_log 테이블)로 INSERT 한다. RLS로 INSERT만 허용된 publishable 키 사용.
   * - mode 컬럼(테이블 맨 마지막 컬럼)에는 접속 시점의 씬모드/팻모드를 'Thin'/'Fat' 문자열로 넣는다.
   * - 전송에 실패해도(사내망 차단 등) 페이지 동작에는 영향을 주지 않으며,
   *   실패 시 브라우저에는 파일 시스템이 없으므로 localStorage에 최근 50건까지 백업 기록한다.
   */
  const SUPABASE_URL = 'https://jflfqxrfdjdtsxzqwpkf.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_rwEALrEkpDBQa6pJy7ovlw_MJ9LXE6z';

  // 현재 시각을 한국시간(KST, UTC+9) 오프셋이 명시된 ISO 문자열로 만든다.
  // 예: 2026-08-27T09:12:34.567+09:00 (accesslog.js의 nowKstIso와 동일한 로직)
  function nowKstIso(){
    const d = new Date();
    const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
    const pad = (n) => String(n).padStart(2, '0');
    const y = kst.getUTCFullYear(), mo = pad(kst.getUTCMonth() + 1), da = pad(kst.getUTCDate());
    const h = pad(kst.getUTCHours()), mi = pad(kst.getUTCMinutes()), s = pad(kst.getUTCSeconds());
    const ms = String(kst.getUTCMilliseconds()).padStart(3, '0');
    return `${y}-${mo}-${da}T${h}:${mi}:${s}.${ms}+09:00`;
  }

  // "플랫폼" 자리는 OS 종류가 아니라 브라우저 종류(Chrome/Edge/Firefox/Safari 등)를 넣는다.
  // Chromium 계열은 navigator.userAgentData.brands 가 있으면 그걸 우선 쓰고, 없으면
  // navigator.userAgent 문자열을 순서대로 검사한다(Edge가 Chrome 문자열도 포함하므로 먼저 체크).
  function detectBrowserName(){
    try{
      if (navigator.userAgentData && Array.isArray(navigator.userAgentData.brands)) {
        const brands = navigator.userAgentData.brands.map(b => b.brand);
        if (brands.includes('Microsoft Edge')) return 'Edge';
        if (brands.includes('Opera')) return 'Opera';
        if (brands.includes('Google Chrome')) return 'Chrome';
      }
      const ua = navigator.userAgent || '';
      if (/Edg\//.test(ua)) return 'Edge';
      if (/OPR\//.test(ua) || /Opera/.test(ua)) return 'Opera';
      if (/Chrome\//.test(ua)) return 'Chrome';
      if (/Firefox\//.test(ua)) return 'Firefox';
      if (/Safari\//.test(ua)) return 'Safari';
      return 'unknown';
    }catch(_){
      return 'unknown';
    }
  }

  // os_user 자리에는 Windows 로그인 계정을 알 수 없는 대신, 기기/환경 정보(브라우저 종류·언어·시간대·해상도)를
  // 한 줄로 묶어서 넣는다. 사람을 특정하진 못하지만 어떤 환경에서 접속했는지 파악하는 데는 쓸모 있다.
  function getDeviceEnvInfo(){
    try{
      const platform = detectBrowserName();
      const language = navigator.language || 'unknown';
      let timezone = 'unknown';
      try{ timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown'; }catch(_){}
      const resolution = (screen && screen.width && screen.height) ? `${screen.width}x${screen.height}` : 'unknown';
      return `${platform} | ${language} | ${timezone} | ${resolution}`;
    }catch(_){
      return null;
    }
  }

  // 좌측 하단 표기("by June (ver.20260826.001)")에서 "ver.YYYYMMDD.NNN"만 뽑아 앱 버전으로 사용.
  function readAppVersion(){
    try{
      const el = document.getElementById('verText');
      const m = ((el && el.textContent) || '').match(/ver\.\d{8}\.\d{3}/);
      if (m) return m[0];
    }catch(_){}
    return 'unknown';
  }

  // 씬모드/팻모드 - 팻모드는 <body>에 'skin-classic' 클래스가 붙는 것으로 판단한다(그리드 등
  // 여러 컴포넌트가 렌더링 시점에 document.body.classList.contains('skin-classic')로 이미 같은
  // 방식으로 구분하고 있어 그와 일치시킨다).
  function readSkinMode(){
    try{
      return document.body.classList.contains('skin-classic') ? 'Fat' : 'Thin';
    }catch(_){
      return 'unknown';
    }
  }

  function fetchWithTimeout(url, opts, ms){
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    return fetch(url, Object.assign({}, opts, { signal: ctrl.signal })).finally(() => clearTimeout(timer));
  }

  // 외부 IP + 지역(도시, 국가코드)을 한 번에 가져온다. ipapi.co가 막히면(사내망 차단·레이트리밋 등)
  // IP만이라도 얻을 수 있게 ipify로 폴백한다(이때 location은 null).
  async function fetchIpAndLocation(){
    try{
      const r = await fetchWithTimeout('https://ipapi.co/json/', {}, 5000);
      const j = await r.json();
      if (j && j.ip && !j.error) {
        const city = j.city || null;
        const countryCode = j.country_code || j.country || null;
        const loc = (city && countryCode) ? `${city}, ${countryCode}` : (countryCode || null);
        return { ip: j.ip, location: loc };
      }
    }catch(_){}
    try{
      const r = await fetchWithTimeout('https://api.ipify.org?format=json', {}, 5000);
      const j = await r.json();
      return { ip: (j && j.ip) ? j.ip : null, location: null };
    }catch(_){
      return { ip: null, location: null };
    }
  }

  // 전송 실패 시 로컬 백업 기록. 브라우저에는 access.log 같은 파일이 없으므로 localStorage를 사용,
  // 최근 50건까지만 보관해 무한정 쌓이지 않게 한다.
  function writeLocalFallback(row, reason){
    try{
      const KEY = 'mockup_access_log_fallback';
      const list = JSON.parse(localStorage.getItem(KEY) || '[]');
      list.push(Object.assign({}, row, { _failed: reason, _at: new Date().toISOString() }));
      while (list.length > 50) list.shift();
      localStorage.setItem(KEY, JSON.stringify(list));
    }catch(_){}
  }

  async function logMockupAccess(){
    const geo = await fetchIpAndLocation();
    const row = {
      created_at: nowKstIso(), // 명시하지 않으면 테이블의 default now()가 UTC로 채움
      external_ip: geo.ip,
      hostname: location.hostname || 'local-file',
      os_user: getDeviceEnvInfo(),
      app_ver: readAppVersion(),
      location: geo.location, // "도시, 국가코드" 형태. 조회 실패 시 null
      mode: readSkinMode() // 'Thin' 또는 'Fat' - 접속 시점의 씬모드/팻모드
    };

    // 키가 아직 채워지지 않았으면 전송하지 않음(로컬에만 남김)
    if (SUPABASE_KEY.includes('여기에')) {
      writeLocalFallback(row, 'key-not-configured');
      return;
    }

    try{
      const res = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/mockup_access_log`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify(row)
      }, 8000);
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        writeLocalFallback(row, `http-${res.status}:${text.slice(0, 200)}`);
      }
    }catch(e){
      writeLocalFallback(row, String(e && e.message ? e.message : e));
    }
  }

  function init(){ logMockupAccess(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  // 모드(씬/팻)가 바뀔 때도 같은 로그를 한 번 더 남긴다 - setAppSkin()이 로고 클릭이든 파일
  // 불러오기든 모드가 바뀌는 유일한 통로라서, 거기서 이 함수를 호출하면 "언제 어떤 모드였는지"의
  // 타임라인이 접속 로그만으로 만들어진다. 최초 접속 로그(위 init)와 완전히 같은 형태의 행이라
  // mode 컬럼만 보고 그 시점의 모드를 그대로 읽을 수 있다.
  window.mbLogAccess = logMockupAccess;
})();
