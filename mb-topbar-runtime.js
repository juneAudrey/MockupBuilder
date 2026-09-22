(function(){
  // ============================================================================
  // Mockup Builder 상단 바(Alt+O/Alt+P/Alt+S) 런타임 - 외부 파일로 분리된 버전.
  // 이 스크립트가 성공적으로 로드된 경우에만 상단 바가 나타난다. 로드 자체가 안 되면(오프라인,
  // 서버 문제 등) 이 안의 코드는 아예 실행되지 않으므로 - 목업 자체(탭/체크박스/콤보박스 등
  // 상호작용)에는 전혀 영향이 없고, 상단 바 관련 버튼 세 개만 조용히 안 보일 뿐이다.
  // ============================================================================
  if(document.getElementById('mbTopbar')) return; // 이미 만들어져 있으면(중복 실행 등) 다시 안 만든다
  var topbarHtml =
    '<div class="mb-topbar" id="mbTopbar" data-ai-ignore="true" aria-hidden="true">'+
      '<div class="mb-badge toggle on" id="mbBadgeO" onclick="window.mbToggleDiffHide()">'+
        '<span class="ic">👁</span><span class="kbd">Alt+O</span>'+
        '<span class="mb-badge-tip">변경상태 표시 켜짐 · 클릭하면 숨김</span>'+
      '</div>'+
      '<div class="mb-badge accent" id="mbBadgeP" onclick="window.mbOpenCapture()">'+
        '<span class="ic">📷</span><span class="kbd">Alt+P</span>'+
        '<span class="mb-badge-tip">화면 캡처</span>'+
      '</div>'+
      '<div class="mb-badge spec" id="mbBadgeS" onclick="window.mbOpenSpecExport()">'+
        '<span class="ic">📊</span><span class="kbd">Alt+S</span>'+
        '<span class="mb-badge-tip">사양서 매핑 템플릿 내보내기(.xlsx)</span>'+
      '</div>'+
    '</div>';
  var overlayHtml =
    '<div class="mb-cap-overlay" id="mbCapOverlay" hidden>'+
      '<div class="mb-cap-popup">'+
        '<div class="mb-cap-head">'+
          '<span class="ic">🖼️</span>'+
          '<span class="t">화면 캡처</span>'+
          '<span class="kbd">Alt + P</span>'+
          '<span class="x" onclick="mbCloseCapture()">✕</span>'+
        '</div>'+
        '<div class="mb-cap-body">'+
          '<div class="mb-cap-sec"><span class="t">그리드 컬럼 전체 표시</span></div>'+
          '<div class="mb-cap-cards" id="mbGridModeCards">'+
            '<div class="mb-cap-card on" id="mbCardNone" onclick="mbSelectGridMode(\'none\')">'+
              '<span class="chk">✓</span><div class="mb-diagram-plain"><span></span></div><div class="ct">기본</div>'+
            '</div>'+
            '<div class="mb-cap-card" id="mbCardFit" onclick="mbSelectGridMode(\'fit\')">'+
              '<span class="chk">✓</span><div class="mb-diagram"><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span></div><div class="ct">화면 유지</div>'+
            '</div>'+
            '<div class="mb-cap-card" id="mbCardExpand" onclick="mbSelectGridMode(\'expand\')">'+
              '<span class="chk">✓</span><div class="mb-diagram-row"><div class="boxed"><span></span><span></span><span></span></div><div class="spill"><span></span><span></span><span></span></div></div><div class="ct">캔버스 확장</div>'+
            '</div>'+
            '<div class="mb-cap-card" id="mbCardWrap" onclick="mbSelectGridMode(\'wrap\')">'+
              '<span class="chk">✓</span><div class="mb-diagram-stack"><div class="row"><span></span><span></span><span></span><span></span></div><div class="row extra"><span></span><span></span><span></span></div><div class="row extra"><span></span><span></span></div></div><div class="ct">컬럼 줄바꿈</div>'+
            '</div>'+
          '</div>'+
          '<div class="mb-cap-btns">'+
            '<div class="mb-cap-btn primary" onclick="mbCapture(\'save\')"><span class="ic">💾</span>이미지 파일로 저장</div>'+
            '<div class="mb-cap-btn ghost" onclick="mbCapture(\'clipboard\')"><span class="ic">📋</span>클립보드에 복사</div>'+
          '</div>'+
        '</div>'+
        '<div class="mb-cap-foot">Esc 로 닫기 · 다시 열기: Alt + P</div>'+
      '</div>'+
    '</div>';
  document.body.insertAdjacentHTML('afterbegin', overlayHtml);
  document.body.insertAdjacentHTML('afterbegin', topbarHtml);
  // 상단 바 높이만큼의 여백도 이 스크립트가 실제로 성공했을 때만 준다 - 로드 자체가 실패하면
  // 이 줄이 아예 실행이 안 되므로 빈 여백만 남는 일도 없다.
  document.body.style.paddingTop='66px';

  var overlay=document.getElementById('mbCapOverlay');
  if(!overlay)return;
  var canvas=document.querySelector('.mockup');
  var cardNone=document.getElementById('mbCardNone');
  var cardFit=document.getElementById('mbCardFit');
  var cardExpand=document.getElementById('mbCardExpand');
  var cardWrap=document.getElementById('mbCardWrap');
  var gridMode='none'; // 'none'=기본, 'fit'=화면 유지, 'expand'=캔버스 확장, 'wrap'=컬럼 줄바꿈

  // Grids whose column area is actually being clipped right now - grids that already show every
  // column get left alone entirely, per spec ("이미 한 화면에 들어오면 옵션은 의미가 없다").
  function overflowingGrids(){
    return Array.prototype.slice.call(canvas.querySelectorAll('.ax-grid')).map(function(g){
      var body=g.querySelector('.gbody');
      if(!body)return null;
      return {grid:g, body:body, over: body.scrollWidth-body.clientWidth>2};
    }).filter(function(x){return x&&x.over;});
  }

  window.mbSelectGridMode=function(mode){
    gridMode=mode;
    cardNone.classList.toggle('on',mode==='none');
    cardFit.classList.toggle('on',mode==='fit');
    cardExpand.classList.toggle('on',mode==='expand');
    cardWrap.classList.toggle('on',mode==='wrap');
  };
  window.mbOpenCapture=function(){ overlay.hidden=false; };
  window.mbCloseCapture=function(){ overlay.hidden=true; };
  document.addEventListener('keydown',function(e){
    if(e.altKey&&(e.key==='p'||e.key==='P')){
      e.preventDefault();
      if(overlay.hidden) window.mbOpenCapture(); else window.mbCloseCapture();
    } else if(e.key==='Escape'&&!overlay.hidden){
      window.mbCloseCapture();
    }
  });
  // Alt+O: 변경상태(기본/추가/변경/삭제/이동) 테두리·라벨 표시를 켰다 껐다 토글. 기본은 표시(ON).
  // 상단 고정 바의 뱃지를 눌러도 같은 동작을 하도록 토글 로직을 함수로 분리해 공유한다.
  window.mbToggleDiffHide=function(){
    var hidden=document.body.classList.toggle('mb-diffhide');
    var badge=document.getElementById('mbBadgeO');
    if(badge){
      badge.classList.toggle('on',!hidden);
      badge.querySelector('.mb-badge-tip').textContent = hidden ? '변경상태 표시 꺼짐 · 클릭하면 표시' : '변경상태 표시 켜짐 · 클릭하면 숨김';
    }
  };
  document.addEventListener('keydown',function(e){
    if(e.altKey&&(e.key==='o'||e.key==='O')){
      e.preventDefault();
      window.mbToggleDiffHide();
    } else if(e.altKey&&(e.key==='s'||e.key==='S')){
      e.preventDefault();
      window.mbOpenSpecExport();
    }
  });

  // 화면 유지: shrink every overflowing grid's own scrollable body just enough (via CSS zoom,
  // which - unlike transform:scale - reflows the box itself, so no blank space is left behind)
  // that its full content width fits inside its current on-screen width. Returns an undo fn.
  function applyFitMode(){
    var reverts=overflowingGrids().map(function(x){
      var prevZoom=x.body.style.zoom;
      var ratio=x.body.clientWidth/x.body.scrollWidth;
      x.body.style.zoom=ratio;
      return function(){ x.body.style.zoom=prevZoom; };
    });
    return function(){ reverts.forEach(function(fn){fn();}); };
  }
  // 캔버스 확장: leave the canvas and every other component exactly where they are - just stop
  // an overflowing grid from clipping its own content, so the extra columns (already laid out
  // at full width by the .xscroll CSS - see colTrack()/gridColsStyle in exportComp) simply
  // render past the grid's (and the canvas's) right edge instead of being scrolled out of view.
  // Returns an undo fn that restores each grid's clipping afterward.
  function applyExpandMode(){
    var reverts=overflowingGrids().map(function(x){
      var prevGridOverflow=x.grid.style.overflow;
      var prevBodyOverflow=x.body.style.overflow;
      x.grid.style.overflow='visible';
      x.body.style.overflow='visible';
      return function(){
        x.grid.style.overflow=prevGridOverflow;
        x.body.style.overflow=prevBodyOverflow;
      };
    });
    return function(){ reverts.forEach(function(fn){fn();}); };
  }
  // How much room "캔버스 확장"/"컬럼 줄바꿈" actually need, measured WITHOUT touching any CSS
  // first: a grid's header/row cells (.gh/.gr) are already laid out at their full natural width
  // by the .xscroll CSS (width:max-content) regardless of whether the parent is currently
  // clipping them, so their real on-page position/size can be read straight off
  // getBoundingClientRect() at any time. "컬럼 줄바꿈" builds its stacked column groups out of the
  // very same .ax-grid/.gh/.gr classes (see applyColumnWrapMode below), so this one selector
  // picks up both modes' extra content with no extra cases needed.
  function measureExpandRect(){
    var r=canvas.getBoundingClientRect();
    var left=r.left, top=r.top, right=r.right, bottom=r.bottom;
    Array.prototype.forEach.call(canvas.querySelectorAll('.ax-grid .gh, .ax-grid .gr'),function(el){
      var er=el.getBoundingClientRect();
      if(er.right>right) right=er.right;
      if(er.bottom>bottom) bottom=er.bottom;
    });
    return {left:left, top:top, right:right, bottom:bottom, width:right-left, height:bottom-top};
  }
  // "컬럼 줄바꿈" doesn't spill anything sideways - the original grid keeps its normal
  // overflow-x:auto scrolling untouched (only its extra ROWS get hidden), so its own header/row
  // cells are still laid out at their full un-scrolled width (.xscroll's width:max-content) far
  // past what's actually on screen. Reusing measureExpandRect()'s ".ax-grid .gh, .ax-grid .gr"
  // scan here would pick those up as if they were real visible content and demand a much wider
  // capture than the canvas actually is (a wide blank margin on the right, exactly the width the
  // original grid's hidden-but-still-in-the-DOM columns would have needed). The only new content
  // that's actually meant to be visible is each grid's .mb-colwrap-stack box (already built no
  // wider than the space already on screen), so only that needs to extend the measured rect.
  function measureWrapRect(){
    var r=canvas.getBoundingClientRect();
    var left=r.left, top=r.top, right=r.right, bottom=r.bottom;
    Array.prototype.forEach.call(canvas.querySelectorAll('.mb-colwrap-stack'),function(el){
      var er=el.getBoundingClientRect();
      if(er.right>right) right=er.right;
      if(er.bottom>bottom) bottom=er.bottom;
    });
    return {left:left, top:top, right:right, bottom:bottom, width:right-left, height:bottom-top};
  }
  // 화면 안에 담기 - REMOVED (September 2026). This used to zoom the whole page out with CSS zoom
  // so that whatever extra content "캔버스 확장"/"컬럼 줄바꿈" revealed would fit inside the
  // browser's own visible window before the shot was taken - a workaround that only existed
  // because the old getDisplayMedia-based capture could only ever grab whatever was actually
  // painted inside the real on-screen browser window. Now that rasterize() renders straight off
  // the DOM via html2canvas instead of a screen/tab video frame, that limitation is gone entirely
  // - html2canvas can capture a region far larger than the window without ever needing to shrink
  // it on screen first, which is strictly better for quality too (shrinking-to-fit before an
  // already-lossless render was pure resolution thrown away for no reason once it's no longer
  // required). "화면 유지" (applyFitMode above) is unrelated to this and unaffected - it
  // deliberately shrinks a grid's own on-screen size as a real design choice, not a capture
  // workaround, so that one still visually zooms as before.
  //
  // 캔버스 확장: leave the canvas and every other component exactly where they are - just stop
  // an overflowing grid from clipping its own content, so the extra columns (already laid out
  // at full width by the .xscroll CSS - see colTrack()/gridColsStyle in exportComp) simply
  // render past the grid's (and the canvas's) right edge instead of being scrolled out of view.
  function applyExpandModeFitted(){
    return applyExpandMode();
  }
  // 컬럼 줄바꿈: split an overflowing grid's columns into groups that each fit the width already
  // on screen, and stack the groups the person can't currently see as extra mini-grids below the
  // original - so every column ends up visible in one shot without shrinking anything or spilling
  // sideways. Every section - the already-visible part AND every newly-stacked group below it -
  // is trimmed down to just its first row: the point of this mode is to show every COLUMN in one
  // shot, not every row, so repeating all N rows under every column group would only make the
  // capture much taller without adding anything a single reference row doesn't already show.
  // Merged group headers ("컬럼 그룹") and per-column 변경상태 tags both add extra header-ONLY
  // markup - a centered group-title span spanning several columns, or a small colored tag span -
  // above the column's real name label, by forcing the header onto a 2-row CSS Grid (see the
  // "hasTopRow" branch in exportComp's grid case). That means gh.children no longer lines up
  // 1:1 with the row cells below it (rows[0].children), which the old, simpler version of this
  // function required and silently gave up on otherwise - exactly why "컬럼 줄바꿈" appeared to
  // do nothing at all on any grid using either feature. Every column still has exactly one
  // "label" span carrying its actual name (grid-row:2 when there's a group/tag row above it, or
  // grid-row:1/span 2 when there isn't) - group-title spans and tag spans both sit at grid-row:1
  // ALONE, so filtering for "starts at row 2, or spans both rows" reliably recovers exactly one
  // span per column (in the same left-to-right order as the row cells) regardless of how many
  // extra decoration spans are mixed in among gh's children.
  //
  // Each label's OWN row1 "partner" (a 변경상태 tag, or a merged-group banner) - when it has one -
  // is simply the row1-only element that sits immediately before it in the DOM: exportComp always
  // pushes a column's tag/banner (if any) right before that column's own name span, and only for
  // the one column that actually owns it (a banner shared by several grouped columns is pushed
  // only once, before the FIRST of them). Cloning that real element (instead of resynthesizing
  // one from scratch) is what keeps the stacked groups' 변경상태 coloring/text pixel-identical to
  // the original AND keeps the existing Alt+O CSS (body.mb-diffhide ... display:none) working on
  // them for free, since the clone still carries the exact same classes.
  function headerLabelSpans(gh, rowCellCount){
    var kids=Array.prototype.slice.call(gh.children);
    if(kids.length===rowCellCount) return {spans:kids, partners:null, topRow:false}; // plain header - old fast path
    function isRow1Only(el){
      var cs=getComputedStyle(el);
      return cs.gridRowStart==='1' && !/span/.test(cs.gridRowEnd);
    }
    var spans=[], partners=[];
    for(var i=0;i<kids.length;i++){
      var cs=getComputedStyle(kids[i]);
      var rs=cs.gridRowStart, re=cs.gridRowEnd;
      // Chromium reports an unresolved "grid-row-end: span 2" back as the literal string
      // "span 2" (not a resolved line number like "3"), so the row-count math this used to do
      // (parseInt(re)-parseInt(rs)) always came out NaN and silently failed every single column -
      // checking for the word "span" directly is what actually detects "starts at row 1 but
      // covers both rows" here.
      var isLabel = rs==='2' || (rs==='1' && /span/.test(re));
      if(!isLabel) continue;
      spans.push(kids[i]);
      var prev=kids[i-1];
      partners.push(prev && isRow1Only(prev) ? prev : null);
    }
    return spans.length===rowCellCount ? {spans:spans, partners:partners, topRow:true} : null;
  }
  function applyColumnWrapMode(){
    var reverts=overflowingGrids().map(function(x){
      var grid=x.grid, gbody=x.body;
      var item=grid.closest('.mockup-item');
      var gh=gbody.querySelector('.gh');
      var rows=Array.prototype.slice.call(gbody.querySelectorAll('.gr'));
      if(!item||!gh||!rows.length) return function(){};
      // 그리드 합계 행(.gr-total)은 데이터 행이 아니라 항상 맨 마지막 .gr로 붙는 별도 행이므로,
      // 여기서 미리 rows 배열에서 꺼내 따로 챙겨둔다 - 그러면 이 함수의 나머지 로직(rows[0]=기준
      // 행, rows.slice(1)=숨길 행들 등)은 합계 행의 존재를 몰라도 예전 그대로 동작하고, 합계 행은
      // "숨길 행" 목록에 아예 안 들어가 항상 화면에 남는다(끄지 않으니 되돌릴 필요도 없다).
      var totalRowEl = rows.length && rows[rows.length-1].classList.contains('gr-total') ? rows.pop() : null;
      if(!rows.length) return function(){};
      var rowCells=Array.prototype.slice.call(rows[0].children);
      if(!rowCells.length) return function(){};
      // Grouping/width decisions are read off the ROW cells, not the header - rows[0].children
      // is always exactly one cell per column (extra Row Order/CheckBox columns included) no
      // matter what the header looks like, so it's the one place both the plain-header and the
      // grouped/tagged-header grids agree on shape. headerLabelSpans() is used further below only
      // to recover each column's actual header TEXT for the stacked groups; if it can't (an
      // unrecognized header shape), the stacked groups just get blank header cells instead of
      // failing the whole capture.
      var headerSpans=headerLabelSpans(gh, rowCells.length);
      var availW=gbody.clientWidth;
      // Group 0 (left untouched below) has to be EXACTLY the columns the original, unmodified
      // grid is already showing - not a separate width sum recomputed from scratch, which can
      // land a pixel or two off from the real clip boundary (borders, sub-pixel widths) and
      // either double up or drop the boundary column. Reading each row cell's own actual right
      // edge against the body's real clip edge is what the browser itself already decided (the
      // header and row cells are always sized from the same column widths - see colTrack()/
      // cellW() in exportComp - so reading this off the row is equally accurate for the header).
      var gbodyRight=gbody.getBoundingClientRect().right;
      var already=[];
      rowCells.forEach(function(cell,idx){
        if(cell.getBoundingClientRect().right<=gbodyRight+1) already.push(idx);
      });
      if(!already.length) already.push(0);
      var groups=[already];
      var cur=[], curW=0;
      for(var idx=already[already.length-1]+1; idx<rowCells.length; idx++){
        var w=rowCells[idx].getBoundingClientRect().width;
        if(cur.length && curW+w>availW){ groups.push(cur); cur=[]; curW=0; }
        cur.push(idx); curW+=w;
      }
      if(cur.length) groups.push(cur);
      if(groups.length<=1) return function(){};

      var notAlready=[];
      rowCells.forEach(function(cell,idx){ if(already.indexOf(idx)===-1) notAlready.push(idx); });

      var extraRows=rows.slice(1);
      var prevDisplay=extraRows.map(function(r){ return r.style.display; });
      extraRows.forEach(function(r){ r.style.display='none'; });

      // The grid's box (.ax-grid, height:100%) fills its .mockup-item at the item's ORIGINAL
      // designed height (tall enough for every row) - just hiding the extra rows above leaves
      // that full height in place as dead blank space below row 1, with the stacked groups then
      // starting even further down after all of it. Shrink the item itself to exactly header +
      // 1 row for the duration of the capture (reverted below) so row 1 sits flush above the
      // stacked groups, matching the "행 1개를 제외하고 아래로 붙여서" spec with no gap.
      //
      // compactH has to be measured from the ITEM's own top, not the header's (gh's) top - a
      // grid with its built-in toolbar on (showToolbar - the 행추가/행취소/... button row) has
      // real content ABOVE .gh, inside the same .mockup-item, that a gh-relative measurement
      // silently drops from the height this sets. That shortfall doesn't show up as a gap (it's
      // ABOVE the header, already accounted for by the browser's own layout) - instead the item
      // box comes out exactly that much too SHORT overall, cutting into the header's own bottom
      // edge (the stacked box below starts right where this shortened item ends, painting over
      // whatever of the header still extended past that point) - which is what made a status-
      // tagged column's name (sitting in the header's lower/row-2 half) disappear behind the
      // stacked box while untagged columns (whose name is vertically centered across the full
      // header height) mostly still cleared it.
      var prevItemHeight=item.style.height;
      // 합계 행이 있으면(위에서 rows 밖으로 빼뒀지만 화면엔 그대로 남아 첫 행 바로 아래 보이는
      // 중이다) 그 아래쪽 끝까지가 "줄이지 않고 보존할" 실제 높이다 - 여기서 rows[0] 기준으로만
      // 재면 합계 행 자리가 이 압축 높이 밖으로 밀려나 버려, 바로 아래에 새로 쌓이는 컬럼 그룹
      // 박스가 합계 행과 겹쳐 그려진다.
      var bottomEl = totalRowEl || rows[0];
      var compactH=Math.ceil(bottomEl.getBoundingClientRect().bottom-item.getBoundingClientRect().top)+2;
      item.style.height=compactH+'px';

      // One seamless box for every hidden group - not a separate bordered .ax-grid clone per
      // group with gaps between them (that read as several small stray widgets rather than one
      // grid). A single outer border/background wraps all the extra header/row bands, so it
      // reads as the same grid simply continuing below itself. Keeping the "ax-grid" class on
      // that single outer box (rather than styling it by hand) matters, not just for looks: every
      // .gh/.gr rule - including the ".gbody.xscroll .gh,.gr{display:flex;width:max-content}"
      // override that actually lays the cloned header/row cells out in a row instead of the
      // default CSS-grid one-cell-per-implicit-row - is itself scoped under ".ax-grid", so
      // without that ancestor class the cloned cells silently lose their layout entirely (each
      // one stacking on its own line). The inline style below only overrides the couple of
      // properties that need to differ from a normal grid box (absolute position/width, and
      // auto height so it hugs its own stacked content instead of stretching to the item's
      // height like a normal .ax-grid does at height:100%).
      var stack=document.createElement('div');
      stack.className='ax-grid mb-colwrap-stack';
      stack.style.cssText='position:absolute;left:0;top:'+item.offsetHeight+'px;width:'+availW+'px;height:auto;';
      var nb=document.createElement('div');
      nb.className='gbody xscroll';
      nb.style.cssText='display:flex;flex-direction:column;flex:none;';
      for(var gi=1; gi<groups.length; gi++){
        (function(idxs){
          var nh=document.createElement('div');
          nh.className='gh';
          if(headerSpans && headerSpans.topRow){
            // A grouped/tagged grid's header is a real 2-row CSS Grid (see the "hasTopRow"
            // branch in exportComp) - reproducing that same 2-row grid here, instead of the
            // plain single-row flex strip below, is what lets each column's real 변경상태
            // tag/border sit above its name intact rather than the tag's own border (which is
            // deliberately missing its top edge - it's meant to butt up against the row below
            // it) getting cloned on its own with nothing above it, which is what read as
            // "잘려" (cut off): a dashed box with no top edge just looks broken in isolation.
            nh.style.cssText='display:grid;grid-template-rows:repeat(2,auto);grid-template-columns:'+
              idxs.map(function(ci){ return Math.round(rowCells[ci].getBoundingClientRect().width)+'px'; }).join(' ')+';';
            idxs.forEach(function(ci,p){
              var label=headerSpans.spans[ci].cloneNode(true);
              var partner=headerSpans.partners[ci];
              if(partner){
                var tag=partner.cloneNode(true);
                tag.style.gridColumn=String(p+1);
                tag.style.gridRow='1';
                nh.appendChild(tag);
                label.style.gridColumn=String(p+1);
                label.style.gridRow='2';
              } else {
                label.style.gridColumn=String(p+1);
                label.style.gridRow='1/span 2';
              }
              nh.appendChild(label);
            });
          } else {
            idxs.forEach(function(ci){
              // The plain-header case's own label span never carries an explicit width (it
              // relies on the ORIGINAL grid's CSS Grid/flex track for that), so cloning it as-is
              // into this stacked box (a plain flex row) would size it to its text instead of
              // the real column width - setting it explicitly from the row cell it lines up
              // with (which always does carry its own width - see cellW() in exportComp) keeps
              // the stacked header aligned with the stacked row under it either way.
              var w=Math.round(rowCells[ci].getBoundingClientRect().width);
              var span=headerSpans ? headerSpans.spans[ci].cloneNode(true) : document.createElement('span');
              span.style.width=w+'px';
              span.style.flex='none';
              nh.appendChild(span);
            });
          }
          nb.appendChild(nh);
          // Only the first row - see the comment above applyColumnWrapMode() for why every
          // group (not just the original, already-visible one) is trimmed to a single row.
          var nr=document.createElement('div');
          nr.className=rows[0].className;
          idxs.forEach(function(ci){ if(rowCells[ci]) nr.appendChild(rowCells[ci].cloneNode(true)); });
          nb.appendChild(nr);
          // 합계 표시가 켜져 있으면 새로 쌓는 컬럼 그룹마다도 자기 몫의 합계 칸을 그대로 복제해
          // 붙인다 - 원본 합계 행(totalRowEl)의 자식 순서가 rowCells와 완전히 같은 순서(유틸리티
          // 컬럼 다음 데이터 컬럼 순)라서, idxs로 똑같이 골라 복제하면 그 그룹 컬럼들 밑에 정확히
          // 맞는 합계 칸(0 또는 빈칸)이 온다. 원래 합계 행 맨 앞 칸의 "합계" 글자는 유틸리티 컬럼
          // 자리(항상 group 0에만 있음)에 있으므로 여기 idxs(데이터 컬럼만)에는 애초에 안 걸린다.
          if(totalRowEl){
            var nrTotal=document.createElement('div');
            nrTotal.className=totalRowEl.className;
            idxs.forEach(function(ci){ if(totalRowEl.children[ci]) nrTotal.appendChild(totalRowEl.children[ci].cloneNode(true)); });
            nb.appendChild(nrTotal);
          }
        })(groups[gi]);
      }
      stack.appendChild(nb);
      item.appendChild(stack);

      // Only now - after every column past the fit boundary already has its own full, unclipped
      // copy cloned into the stack above - do we touch row 1's ORIGINAL cells: hiding them (and
      // their header cell/tag) here first would have cloned them into the stack already hidden
      // (cloneNode(true) copies inline style too), leaving the stacked groups blank. Row 1 keeps
      // showing only whichever leading columns the browser itself decided fit ("already");
      // anything past that boundary either painted as a partially-clipped sliver (its right edge
      // fell past gbodyRight) or forced the native overflow-x scrollbar to appear so it COULD be
      // scrolled to - neither belongs in a static capture once every such column already has its
      // full copy below. Hide it here (row cell + header cell/tag) and turn off the scrollbar for
      // the capture, reverting both afterward.
      var prevGbodyOverflowX=gbody.style.overflowX;
      gbody.style.overflowX='hidden';

      var hiddenRowCells=notAlready.map(function(idx){ return rowCells[idx]; });
      var prevRowCellDisplay=hiddenRowCells.map(function(el){ return el.style.display; });
      hiddenRowCells.forEach(function(el){ el.style.display='none'; });

      // headerSpans.partners[idx] is only ever non-null for the one column immediately following a
      // row1-only group/tag banner in the DOM (see headerLabelSpans) - i.e. it's already effectively
      // per-column, not shared across a group's other columns - so hiding it exactly when that one
      // column is in notAlready can't accidentally blank out a banner that still-visible sibling
      // columns need.
      var hiddenHeaderEls=[];
      if(headerSpans){
        notAlready.forEach(function(idx){
          var label=headerSpans.spans[idx];
          if(label && hiddenHeaderEls.indexOf(label)===-1) hiddenHeaderEls.push(label);
          var partner=headerSpans.topRow ? headerSpans.partners[idx] : null;
          if(partner && hiddenHeaderEls.indexOf(partner)===-1) hiddenHeaderEls.push(partner);
        });
      }
      var prevHeaderDisplay=hiddenHeaderEls.map(function(el){ return el.style.display; });
      hiddenHeaderEls.forEach(function(el){ el.style.display='none'; });

      return function(){
        stack.remove();
        extraRows.forEach(function(r,i){ r.style.display=prevDisplay[i]; });
        item.style.height=prevItemHeight;
        hiddenHeaderEls.forEach(function(el,i){ el.style.display=prevHeaderDisplay[i]; });
        hiddenRowCells.forEach(function(el,i){ el.style.display=prevRowCellDisplay[i]; });
        gbody.style.overflowX=prevGbodyOverflowX;
      };
    });
    return function(){ reverts.forEach(function(fn){ fn(); }); };
  }
  function applyColumnWrapModeFitted(){
    return applyColumnWrapMode();
  }
  // The capture area itself: normally just the canvas's own rect, but while a grid is spilling
  // past it ("캔버스 확장") or has extra column groups stacked below it ("컬럼 줄바꿈") the shot
  // needs to extend far enough right/down to include that too (measured AFTER any zoom-to-fit
  // above has already reflowed the page), or it'd get cropped away right back out again. Each
  // mode measures only the content it actually adds - see measureWrapRect() for why "컬럼
  // 줄바꿈" can't reuse "캔버스 확장"'s measurement.
  function captureRect(){
    if(gridMode==='expand') return measureExpandRect();
    if(gridMode==='wrap') return measureWrapRect();
    var r=canvas.getBoundingClientRect();
    return {left:r.left, top:r.top, width:r.width, height:r.height};
  }
  function nextFrame(){ return new Promise(function(res){ requestAnimationFrame(function(){requestAnimationFrame(res);}); }); }

  // Rasterizing the mockup into a PNG (September 2026 rewrite): this used to go through
  // getDisplayMedia - the browser's own tab-capture API - specifically to avoid bundling a
  // library, since the classic library-free trick ("clone the DOM into an SVG <foreignObject>,
  // draw THAT onto a canvas") doesn't work: Chrome/Edge unconditionally mark a canvas tainted
  // after drawImage()-ing a foreignObject SVG, so toBlob()/toDataURL() on it always throws. But
  // getDisplayMedia turned out to have a real, unfixable quality problem of its own: it's the
  // same pipeline used for live screen-sharing on a video call, so every captured frame gets run
  // through a video encoder whose quality heuristics favor motion smoothness over per-frame
  // sharpness - no combination of resolution hints, contentHint, or frame-rate constraints got it
  // back to native-screenshot quality (measured directly: still ~2.5x blurrier by a sharpness
  // metric even after every tuning knob available). So this now uses html2canvas (bundled inline
  // above as HTML2CANVAS_LIB - a real, actively-maintained DOM-to-canvas renderer, not the naive
  // foreignObject trick) instead: it walks the live DOM/CSSOM and draws each element with plain
  // Canvas 2D calls, so there's no video/encoding pipeline in the way at all - genuinely lossless,
  // and also no "pick this tab to share" permission prompt every time.
  var toastEl=null, toastTimer=null;
  function showMbToast(msg){
    if(!toastEl){
      toastEl=document.createElement('div');
      toastEl.className='mb-toast';
      toastEl.innerHTML='<span class="ic">✓</span><span class="msg"></span>';
      document.body.appendChild(toastEl);
    }
    toastEl.querySelector('.msg').textContent=msg;
    // Restart the fade-in even if a previous toast is still showing/fading, so a quick second
    // capture doesn't get stuck on the first toast's fade-out.
    toastEl.classList.remove('show');
    void toastEl.offsetWidth; // force reflow so the removed class actually takes effect first
    toastEl.classList.add('show');
    if(toastTimer) clearTimeout(toastTimer);
    toastTimer=setTimeout(function(){ toastEl.classList.remove('show'); }, 1800);
  }

  // 캡처 중 클릭 차단막: 팝업을 숨기는 순간부터 저장/복사가 끝나 팝업이 다시 닫히기 직전까지 화면
  // 전체를 덮어 아무 것도 클릭되지 않게 한다. 이게 없으면 그 사이 사용자가 다른 곳을 클릭했을 때
  // (또는 방금 뜬 "파일 저장" 브라우저 대화상자/알림이 포커스를 가져갔을 때) 문서 포커스가
  // 빠져나가, 뒤이어 실행되는 navigator.clipboard.write()가 "Document is not focused" 오류로
  // 실패하는 경우가 있었다 - 아래 writeClipboardWithRetry()의 재시도와 함께 이중으로 막는다.
  var busyEl=null;
  function showCapBusy(){
    if(!busyEl){
      busyEl=document.createElement('div');
      busyEl.className='mb-cap-busy';
      busyEl.innerHTML='<div class="mb-cap-busy-badge"><span class="mb-cap-busy-dots"><span></span><span></span><span></span></span><span>캡처 중...</span></div>';
      document.body.appendChild(busyEl);
    }
    busyEl.hidden=false;
  }
  function hideCapBusy(){
    if(busyEl) busyEl.hidden=true;
  }

  // navigator.clipboard.write()는 문서가 포커스를 갖고 있어야만 성공한다 - 캡처 중 차단막으로
  // 대부분의 경우를 막아도, 방금 전 "이미지 파일로 저장"에서 뜬 브라우저 자체의 다운로드
  // 알림/대화상자처럼 사용자 클릭 없이도 포커스가 옮겨가는 경우까지는 막을 수 없다. 그런 경우를
  // 대비해 실패하면 window.focus()로 포커스를 되찾아온 뒤 한 번 더 시도한다.
  async function writeClipboardWithRetry(blob){
    try{
      await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);
    }catch(err){
      var msg=(err&&err.message)||'';
      if(!/focus/i.test(msg)) throw err;
      window.focus();
      await new Promise(function(res){ setTimeout(res,80); });
      await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);
    }
  }


  // html2canvas도 ExcelJS처럼 이 파일 자체에 통째로 담지 않고, 화면 캡처(Alt+P)를 실제로 누른
  // 시점에만 CDN에서 불러온다 - 이미 불러왔으면 다시 받지 않는다.
  let mbH2CPromise=null;
  function mbLoadHtml2Canvas(){
    if(window.html2canvas) return Promise.resolve(window.html2canvas);
    if(mbH2CPromise) return mbH2CPromise;
    mbH2CPromise=new Promise(function(resolve,reject){
      let done=false;
      function finish(fn,arg){ if(done) return; done=true; fn(arg); }
      const s=document.createElement('script');
      s.src='https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
      s.onload=function(){ window.html2canvas ? finish(resolve,window.html2canvas) : finish(reject,new Error('html2canvas 로드 실패')); };
      s.onerror=function(){ finish(reject,new Error('인터넷 연결을 확인해 주세요 - 캡처 라이브러리를 CDN에서 불러오지 못했습니다.')); };
      document.head.appendChild(s);
      setTimeout(function(){ finish(reject,new Error('캡처 라이브러리를 불러오는 데 시간이 너무 오래 걸립니다. 인터넷 연결을 확인해 주세요.')); },15000);
    }).catch(function(err){ mbH2CPromise=null; throw err; });
    return mbH2CPromise;
  }
  async function rasterize(rect){
    await mbLoadHtml2Canvas();
    // html2canvas's x/y crop options are relative to the top-left of the full rendered DOCUMENT,
    // not the current viewport - rect (built from getBoundingClientRect() calls throughout this
    // file) is viewport-relative, so the page's own current scroll offset has to be added back in
    // to get true document-absolute coordinates.
    var docX=(window.scrollX||window.pageXOffset||0), docY=(window.scrollY||window.pageYOffset||0);
    // scrollX/scrollY:0 below is required alongside that, not optional - html2canvas ALSO does its
    // own automatic scroll compensation by default (defaulting to the page's current scrollX/
    // scrollY, same values as docX/docY above), shifting its internal clone to line up with
    // whatever's currently scrolled into view. Left at its default, that compensation runs on top
    // of the docX/docY already added into x/y here, silently double-counting the scroll offset
    // whenever the page actually has one - every column past wherever that double-shift landed
    // then reads as un-rendered (background falls back to whatever's behind the transparent
    // capture instead of the real DOM content), which is what showed up as a wrong/split
    // background past a certain point. Forcing scrollX/scrollY to 0 here tells html2canvas to lay
    // its clone out as if the page were scrolled to the very top-left, matching the plain
    // document-absolute x/y already being passed, so there is exactly one scroll adjustment
    // (ours), not two.
    //
    // Because html2canvas renders straight from the DOM instead of a screen/tab video frame, it
    // isn't limited to whatever's currently painted inside the visible browser window the way
    // getDisplayMedia was - it can capture a region taller/wider than the window with no loss of
    // quality, which is what let the old "zoom the whole page out until it fits the window first"
    // step (zoomToFitThenRevert, used by 캔버스 확장/컬럼 줄바꿈) be removed entirely rather than
    // ported over - that step only ever existed to work around getDisplayMedia's limitation.
    var scale=Math.max(1, window.devicePixelRatio||1);
    // html2canvas also defaults windowWidth/windowHeight (the size of the layout viewport it lays
    // its internal clone out at before painting/cropping) to the CURRENT browser window's
    // clientWidth/clientHeight. When the requested capture rect is wider or taller than that - which
    // is exactly the normal case for 캔버스 확장/컬럼 줄바꿈, since the whole point of those modes is
    // to capture content that doesn't fit in the visible window - anything past that default
    // viewport edge falls outside the area html2canvas actually lays out and paints, and comes back
    // as untouched (fully transparent, since backgroundColor is null) canvas instead of real
    // content. That's what was showing up as a wrong/miscolored background past a certain point,
    // separate from (and still present after) the scrollX/scrollY double-counting fix above.
    // Explicitly sizing windowWidth/windowHeight to cover the full requested crop extent (plus
    // whatever's already scrolled past) makes html2canvas lay out that whole area instead.
    var neededW=Math.round(rect.left+docX+rect.width);
    var neededH=Math.round(rect.top+docY+rect.height);
    var winW=Math.max(document.documentElement.clientWidth||0, document.documentElement.scrollWidth||0, neededW);
    var winH=Math.max(document.documentElement.clientHeight||0, document.documentElement.scrollHeight||0, neededH);
    var srcCanvas=await window.html2canvas(document.body, {
      x: Math.round(rect.left+docX),
      y: Math.round(rect.top+docY),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      scrollX: 0,
      scrollY: 0,
      windowWidth: winW,
      windowHeight: winH,
      scale: scale,
      backgroundColor: null,
      useCORS: true,
      logging: false,
      // The click-blocking overlay shown while a capture is in progress (.mb-cap-busy, see
      // showCapBusy() in mbCapture) is deliberately still visible/in the DOM during this exact
      // call - unlike the popup/topbar, which are hidden via visibility/hidden before rasterize()
      // runs. It's position:fixed to the real viewport's bottom edge, which can fall inside the
      // crop rect (especially for 캔버스 확장/컬럼 줄바꿈, whose crop extends past the visible
      // window), so it needs an explicit ignore rather than relying on hidden-element exclusion.
      ignoreElements: function(el){ return !!(el && el.classList && el.classList.contains('mb-cap-busy')); }
    });
    return await new Promise(function(res){ srcCanvas.toBlob(res,'image/png'); });
  }

  window.mbCapture=async function(mode){
    var revert=function(){};
    // Hide our own popup before anything else - it's part of this tab's rendered pixels just
    // like everything else, so the capture would otherwise include it sitting on top of the
    // mockup it's supposed to be a clean shot of. The top bar (Alt+O/Alt+P badges) sits outside
    // (above) the .mockup rect that captureRect() crops to, so it's already excluded from the
    // final image either way - hiding it here too is just an extra safety net.
    overlay.hidden=true;
    showCapBusy();
    var topbar=document.getElementById('mbTopbar');
    var topbarPrevVis=topbar?topbar.style.visibility:'';
    if(topbar) topbar.style.visibility='hidden';
    // Pin .mockup's own margin to 0 for the duration of the capture. It normally sits centered
    // via margin:0 auto, which means its left offset depends on how wide the surrounding page is
    // - fine for the real window, but rasterize() below has html2canvas lay its internal clone out
    // at a WIDER virtual window than the real one whenever the capture needs to reach content past
    // the real window's edge (see the windowWidth/windowHeight comment in rasterize()). That wider
    // clone re-centers .mockup further right than where it actually sits in the real page, so the
    // canvas's real position (captureRect() below, measured from the real, un-widened page) no
    // longer lines up with where html2canvas actually painted it - the crop ends up straddling the
    // canvas edge, showing a strip of the surrounding page's gray background instead of canvas
    // content on one side. Forcing margin to a fixed 0 removes that width-dependence entirely, so
    // .mockup sits at the exact same spot whether it's measured against the real window or laid
    // out inside html2canvas's wider clone - no shift, no gray strip, regardless of mode.
    var canvasPrevMargin=canvas.style.margin;
    canvas.style.margin='0';
    if(gridMode!=='none' && overflowingGrids().length){
      revert = gridMode==='expand' ? applyExpandModeFitted() : (gridMode==='wrap' ? applyColumnWrapModeFitted() : applyFitMode());
    }
    await nextFrame();
    document.body.classList.add('mb-capturing');
    try{
      var blob=await rasterize(captureRect());
      if(mode==='save'){
        var a=document.createElement('a');
        a.href=URL.createObjectURL(blob);
        a.download=(document.title||'mockup')+'_capture.png';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function(){URL.revokeObjectURL(a.href);},30000);
        showMbToast('이미지가 저장되었습니다');
      } else if(navigator.clipboard && window.ClipboardItem){
        await writeClipboardWithRetry(blob);
        showMbToast('클립보드에 복사되었습니다');
      } else {
        alert('이 브라우저에서는 이미지 클립보드 복사를 지원하지 않아, 대신 파일로 저장합니다.');
        var a2=document.createElement('a');
        a2.href=URL.createObjectURL(blob);
        a2.download=(document.title||'mockup')+'_capture.png';
        document.body.appendChild(a2); a2.click(); a2.remove();
        showMbToast('이미지가 저장되었습니다');
      }
    }catch(err){
      alert('캡처에 실패했습니다: '+(err&&err.message?err.message:err));
    } finally {
      document.body.classList.remove('mb-capturing');
      revert();
      canvas.style.margin=canvasPrevMargin;
      if(topbar) topbar.style.visibility=topbarPrevVis;
      hideCapBusy();
      window.mbCloseCapture();
    }
  };

    /* ==================================================================================
     Alt+S: 사양서 매핑 템플릿(.xlsx) 내보내기.
     화면에 이미 있는 정보(라벨/타입/필수/읽기전용/그리드 컬럼/버튼)만 기계적으로 뽑아 UNIERP AX
     프로그램 사양서와 같은 7개 시트(0.변경이력~6.단위테스트) 구조로 정리한다. 업무 로직(뭘 누르면
     뭐가 되는지)·저장 테이블·SQL처럼 화면 구조만으로는 알 수 없는 항목은 채우지 않고 공란으로
     남긴다 - AI 추정이나 "확인 필요" 문구 없이, 화면 자체의 구조 데이터만으로 가능한 것만 담는다는
     원칙. "목업" 같은 이 편집 도구 내부 용어도 사양서 문면에는 쓰지 않고 "화면"으로 표현한다.
     데이터 출처: 이 파일 맨 아래에 이미 항상 내장되어 있는 __mb_src__ JSON 블록(mbBuildSaveData()
     결과 = comps 배열 전체)을 그대로 재사용한다 - 별도로 뭘 더 심을 필요가 없다. (주의: 이 주석에
     실제 태그 문자열 "<script...id=__mb_src__>"을 그대로 적으면 안 된다 - 「불러오기」 기능이 그
     정확한 문자열을 파일에서 찾아 진짜 데이터 블록으로 착각해버려서, 내보낸 파일을 다시 불러올 때
     이 주석이 먼저 걸려 실패하게 된다.)
  ==================================================================================== */
  // 표시타입 어휘는 사양서 표준 사전(Text/Textarea/Number General/Checkbox/Day picker/
  // Date time/File Upload/Combobox/옵션버튼(Radio)/버튼)에 맞춘다. search/popup(팝업·검색형
  // 입력)은 사전에 없는 종류라 표시타입 자체는 Text로 적고, 팝업/검색형이라는 사실은 표시타입
  // 칸이 아니라 비고(note) 칸에 문장으로 남�다(사양서 표준 규칙과 동일).
  const MB_SPEC_TYPE_MAP={
    text:'Text', input:'Text', search:'Text', popup:'Text',
    textarea:'Textarea', number:'Number General',
    radio:'옵션버튼(Radio)', combo:'Combobox',
    date:'Day picker', daterange:'Day picker(기간)', datetime:'Date time',
    check:'Checkbox', checkbox:'Checkbox', file:'File Upload', button:'버튼'
  };
  function mbSpecTypeLabel(t){ return MB_SPEC_TYPE_MAP[t]||'Text'; }
  function mbSpecIsPopupType(t){ return t==='search' || t==='popup'; }
  const MB_LABELED_INPUT_TYPES=['input','combo','date','daterange','check','radio','popup','search','textarea','number','file'];

  // comps 배열을 훑어 조회조건(searchbar)/싱글 섹션(section 컴포넌트 기준으로 묶음)/그리드/버튼
  // 넷으로 나눠 뽑는다. 순서는 화면에 놓인 순서(comps 배열 순서)를 그대로 따른다. 각 행에는
  // 표시타입뿐 아니라, 화면 구조만으로 알 수 있는 비고(note)도 함께 채운다(팝업/검색형, 옵션값,
  // 중복 라벨 등) - 그 이상의 업무 로직은 담지 않는다.
  function mbSpecNoteFor(rawType, options){
    const notes=[];
    if(mbSpecIsPopupType(rawType)) notes.push('팝업/검색형');
    if((rawType==='combo') && options && String(options).trim()){
      notes.push('화면 옵션값(예시): '+String(options).split(',').map(function(s){return s.trim();}).filter(Boolean).join(', '));
    }
    if(rawType==='radio' && options && String(options).trim()){
      notes.push('옵션 : '+String(options).split(',').map(function(s){return s.trim();}).filter(Boolean).join(', '));
    }
    return notes.join(' / ');
  }

  function mbBuildSpecSections(){
    const src=JSON.parse(document.getElementById('__mb_src__').textContent);
    const comps=src.comps||[];
    const title=(comps.find(c=>c.type==='title')||{}).text||document.title||'';

    const searchbars=[];
    comps.filter(c=>c.type==='searchbar').forEach(sb=>{
      const rows=(sb.fields||[]).filter(f=>(f.label||'').trim()).map(f=>({
        label:f.label.trim(), type:mbSpecTypeLabel(f.type||'text'),
        required:!!f.required, readonly:!!f.readonly,
        note:mbSpecNoteFor(f.type||'text', f.options)
      }));
      if(rows.length){
        // 조회조건 표에는 화면 자체에 내장된 표준 [조회] 버튼도 한 행으로 함께 남긴다(별도
        // 컴포넌트가 아니라 조회조건 영역에 딸린 버튼이라는 사실을 비고에 적는다).
        rows.push({label:'[조회]', type:'버튼', required:false, readonly:false,
          note:'조회조건 영역의 표준 조회 버튼(별도 항목이 아닌 조회 영역 내장 버튼)'});
        searchbars.push({rows});
      }
    });

    // 싱글(섹션): section 컴포넌트를 만날 때마다 새 묶음을 시작한다. 첫 section 이전에 나오는
    // 라벨 있는 컴포넌트는 "단일 입력항목"이라는 이름 없는 기본 묶음에 담는다.
    const sections=[]; let cur={title:'단일 입력항목', rows:[]};
    comps.forEach(c=>{
      if(c.type==='section'){
        if(cur.rows.length) sections.push(cur);
        cur={title:(c.text||'').trim()||'단일 입력항목', rows:[]};
      } else if(MB_LABELED_INPUT_TYPES.includes(c.type) && c.showLabel){
        const label=(c.labelText||'').trim();
        if(!label) return;
        cur.rows.push({
          label, type:mbSpecTypeLabel(c.type), required:!!c.required, readonly:!!c.readonly,
          note:mbSpecNoteFor(c.type, c.options)
        });
      }
    });
    if(cur.rows.length) sections.push(cur);

    const grids=[];
    comps.filter(c=>c.type==='grid').forEach(g=>{
      const labels=(g.text||'').split(',').map(s=>s.trim());
      const colTypes=g.colTypes||[], colReq=g.colRequired||[], colRo=g.colReadonly||[],
            colOpts=g.colOptions||[];
      const seen={};
      const rows=[];
      labels.forEach((label,i)=>{
        if(!label) return;
        const rawType=colTypes[i]||'input';
        const notes=[mbSpecNoteFor(rawType, colOpts[i])];
        if(seen[label]) notes.push('동일 라벨의 컬럼이 화면에 여러 개 있음(화면 그대로 표기)');
        seen[label]=true;
        rows.push({
          label, type:mbSpecTypeLabel(rawType),
          required:!!colReq[i], readonly:!!colRo[i],
          note:notes.filter(Boolean).join(' / ')
        });
      });
      if(rows.length){
        grids.push({
          title:(g.gtitle||'').trim()||'그리드', rows,
          noAddDel: (g.stdAdd===false && g.stdDelete===false)
        });
      }
    });

    const buttons=comps.filter(c=>c.type==='button' && (c.text||'').trim()).map(c=>c.text.trim());

    return {title, searchbars, sections, grids, buttons};
  }

  // 화면 구성 요약(①②③...) - 화면 구조만으로 기계적으로 만들 수 있는 상한선까지의 "화면 설명".
  // 실제 업무 로직(클릭 시 동작)은 화면 어디에도 없는 정보라 담지 못한다는 걸 알고 쓰는 함수.
  function mbSpecDescText(spec){
    const groups=[];
    if(spec.searchbars.length) groups.push('[조회조건]');
    spec.sections.forEach(s=>groups.push('['+s.title+']'));
    spec.grids.forEach(g=>groups.push('['+g.title+'] 그리드'));

    const lines=['① 화면 구성'];
    lines.push('　'+(groups.length? groups.join(' → ')+' 순으로 배치되어 있다.' : '화면에 라벨이 있는 입력 항목이 없다.'));
    if(spec.buttons.length) lines.push('　▷ 하단 버튼 : '+spec.buttons.join('·'));

    const gridNotes=spec.grids.filter(g=>g.noAddDel).map(g=>'['+g.title+'] 그리드는 행추가·행삭제 버튼이 없다.');
    if(gridNotes.length){
      lines.push('② 그리드 특성');
      gridNotes.forEach(n=>lines.push('　'+n));
    }
    lines.push('※ 위 내용은 화면 구성(레이아웃·컴포넌트 배치)만으로 파악한 사실이며, 실제 조회/저장 시의 업무 로직·검증 규칙은 이 사양서에 포함되어 있지 않습니다.');
    return lines.join('\n');
  }

  // 1.개요의 "프로그램 유형" - 버튼 라벨만 보고 기계적으로 판정한다(등록/조회/리포트 중 하나).
  // 그 이상의 근거가 필요한 판단(왜 그런지, 세부 동작이 뭔지)은 여기 담지 않는다.
  function mbSpecProgramType(spec){
    const btnText=spec.buttons.join(' ');
    if(/출력|인쇄|Export|다운로드/i.test(btnText)) return '리포트(조회/출력)';
    if(/저장|등록|수정|확정|삭제/.test(btnText)) return '등록';
    return '조회';
  }

  // 1.개요의 "기타 특성" - 화면 구성 순서 + 그리드 행추가/삭제 여부만 문장으로 옮긴다.
  function mbSpecEtcFeature(spec){
    const groups=[];
    if(spec.searchbars.length) groups.push('[조회조건]');
    spec.sections.forEach(s=>groups.push('['+s.title+']'));
    spec.grids.forEach(g=>groups.push('['+g.title+'] 그리드'));
    let text = groups.length ? (groups.join(' + ')+' 구조.') : '';
    const gridNotes=spec.grids.filter(g=>g.noAddDel).map(g=>'['+g.title+'] 그리드는 행추가/행삭제 없음.');
    if(gridNotes.length) text += (text?'\n':'') + gridNotes.join(' ');
    return text;
  }

  const MB_SPEC_CHECKLIST=[
    '· 메시지 : 누락/유형/사양서 일치 여부',
    '· 컨트롤 : 보안필드·GUI Status, 상태별 활성/비활성',
    '· 커서 복귀 : 저장/조회 후 커서·포커스 위치',
    '· 화면세팅 : Default값·자동세팅 로직 확인',
    '· 타이틀/오타/잘림 확인',
    '· 리포트 : 해당없음',
    '· 조회 0건 메시지 확인',
    '· 컨텐츠 검토 : Test Case·주요 로직 단위테스트 기술 여부'
  ];

  // ExcelJS는 라이브러리 용량이 커서(1MB+) html2canvas처럼 파일 안에 통째로 내장하지 않고,
  // 이 버튼을 실제로 누른 시점에만 CDN에서 불러온다 - 인터넷 연결이 필요한 유일한 기능이라는 뜻.
  // 이미 불러왔으면 다시 받지 않는다.
  let mbExcelJSPromise=null;
  function mbLoadExcelJS(){
    if(window.ExcelJS) return Promise.resolve(window.ExcelJS);
    if(mbExcelJSPromise) return mbExcelJSPromise;
    mbExcelJSPromise=new Promise(function(resolve,reject){
      let done=false;
      function finish(fn,arg){ if(done) return; done=true; fn(arg); }
      const s=document.createElement('script');
      s.src='https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
      s.onload=function(){ window.ExcelJS ? finish(resolve,window.ExcelJS) : finish(reject,new Error('ExcelJS 로드 실패')); };
      s.onerror=function(){ finish(reject,new Error('인터넷 연결을 확인해 주세요 - 엑셀 생성 라이브러리를 CDN에서 불러오지 못했습니다.')); };
      document.head.appendChild(s);
      // 네트워크가 아예 응답 없이 멈춰버리는 드문 경우까지 대비해, onload/onerror 둘 다 영영 안
      // 와도 15초 뒤엔 반드시 실패로 끝내서 버튼이 무한정 멈춰있는 일이 없게 한다.
      setTimeout(function(){ finish(reject,new Error('엑셀 생성 라이브러리를 불러오는 데 시간이 너무 오래 걸립니다. 인터넷 연결을 확인해 주세요.')); },15000);
    // 실패하면 캐시를 비워서, 다음에 다시 누를 때(예: 인터넷이 그새 복구됐을 때) 새로 시도하게 한다 -
    // 안 비우면 한 번 실패한 뒤로는 영원히 같은 실패만 즉시 돌려주게 된다.
    }).catch(function(err){ mbExcelJSPromise=null; throw err; });
    return mbExcelJSPromise;
  }

  // Alt+P 캡처와 같은 원리(rasterize+captureRect)로 화면만 깨끗하게 한 장 찍는다 - 다만 결과를
  // 저장/복사창으로 보내지 않고 Blob 그대로 돌려준다. 그리드가 넘치면 Alt+P와 똑같이 맞춰 찍는다.
  async function mbCaptureBlobForSpec(){
    const topbar=document.getElementById('mbTopbar');
    const topbarPrevVis=topbar?topbar.style.visibility:'';
    if(topbar) topbar.style.visibility='hidden';
    const canvasPrevMargin=canvas.style.margin;
    canvas.style.margin='0';
    let revert=function(){};
    if(gridMode!=='none' && overflowingGrids().length){
      revert = gridMode==='expand' ? applyExpandModeFitted() : (gridMode==='wrap' ? applyColumnWrapModeFitted() : applyFitMode());
    }
    await nextFrame();
    document.body.classList.add('mb-capturing');
    try{
      return await rasterize(captureRect());
    } finally {
      document.body.classList.remove('mb-capturing');
      revert();
      canvas.style.margin=canvasPrevMargin;
      if(topbar) topbar.style.visibility=topbarPrevVis;
    }
  }

  function mbBlobToArrayBuffer(blob){
    return new Promise(function(resolve,reject){
      const r=new FileReader();
      r.onload=function(){ resolve(r.result); };
      r.onerror=reject;
      r.readAsArrayBuffer(blob);
    });
  }

  // 로컬 저장(saveBlob, app.js)과 똑같은 방식 - 이 파일은 app.js와 별도 파일이라 그 함수를
  // 직접 가져다 쓸 수 없으므로, 같은 동작을 여기 그대로 옮겨왔다. 지원하는 브라우저에서는
  // "다른 이름으로 저장" 대화상자가 떠서 저장 위치·파일명을 직접 고를 수 있고, 취소하면
  // false를 돌려준다(다운로드 없이 조용히 끝난다). 대화상자 자체를 지원 안 하는 브라우저에서는
  // 지금까지처럼 기본 다운로드 폴더로 바로 받는다.
  async function mbSaveBlobWithPicker(blob,filename,desc,mime,ext){
    if(window.showSaveFilePicker){
      try{
        const handle=await window.showSaveFilePicker({
          suggestedName:filename,
          types:[{description:desc,accept:{[mime]:[ext]}}]
        });
        const ws=await handle.createWritable();
        await ws.write(blob);
        await ws.close();
        return handle.name||filename;
      }catch(err){
        if(err&&err.name==='AbortError') return false;
        // 그 외 실패(예: file:// 로 연 경우)는 기본 다운로드로 넘어간다.
      }
    }
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob); a.download=filename; a.click();
    setTimeout(function(){URL.revokeObjectURL(a.href);},1000);
    return filename;
  }

  // ── 시트 공통 스타일/헬퍼 (레퍼런스 사양서 실측값 그대로) ──────────────────────────
  // 레퍼런스 사양서(생성 스크립트의 thin())와 동일하게, 표 셀은 4면 모두 얇은 테두리(기본 검정색)를
  // 두른다 - 위쪽 선 하나만 긋는 방식이 아니다. 이걸 top만으로 잘못 두면 세로 경계선이 전혀 없어
  // "표에 테두리가 다 없다"처럼 보인다.
  const MB_XL_THIN={style:'thin'};
  const MB_XL_BORDER_ALL={top:MB_XL_THIN,bottom:MB_XL_THIN,left:MB_XL_THIN,right:MB_XL_THIN};
  const MB_XL_FILL_TITLE={type:'pattern',pattern:'solid',fgColor:{argb:'FF203864'}};
  const MB_XL_FILL_LABEL={type:'pattern',pattern:'solid',fgColor:{argb:'FFF2F2F2'}};
  const MB_XL_FILL_BANNER={type:'pattern',pattern:'solid',fgColor:{argb:'FF4472C4'}};
  const MB_XL_FILL_COLHEAD={type:'pattern',pattern:'solid',fgColor:{argb:'FFD9E1F2'}};

  function mbXlDisplayWidth(s){
    let w=0;
    for(const ch of String(s)){ w += ch.charCodeAt(0)>0x2E80 ? 1.9 : 1.0; }
    return w;
  }
  function mbXlWrappedLineCount(text, totalColWidth){
    let lines=0;
    String(text).split('\n').forEach(function(line){
      lines += Math.max(1, Math.ceil(mbXlDisplayWidth(line)/totalColWidth));
    });
    return lines;
  }
  function mbXlMergeRow(ws, ncol, r, text, opts){
    opts=opts||{};
    ws.mergeCells(r,1,r,ncol);
    const c=ws.getCell(r,1);
    if(text!==null) c.value=text;
    c.font={bold:!!opts.bold, size:opts.size||9, color:opts.color?{argb:opts.color}:undefined};
    c.alignment={horizontal:opts.align||'left', vertical:opts.valign||'middle', wrapText:true};
    if(opts.fill){ for(let col=1;col<=ncol;col++) ws.getCell(r,col).fill=opts.fill; }
    if(opts.border){ for(let col=1;col<=ncol;col++) ws.getCell(r,col).border=opts.border; }
    return c;
  }
  function mbXlSheetTitle(ws, ncol, r, text){
    mbXlMergeRow(ws, ncol, r, text, {bold:true,size:14,fill:MB_XL_FILL_TITLE,align:'center',color:'FFFFFFFF'});
    ws.getRow(r).height=26;
    return r+1;
  }
  function mbXlSectionBanner(ws, ncol, r, text){
    mbXlMergeRow(ws, ncol, r, text, {bold:true,size:11,fill:MB_XL_FILL_BANNER,color:'FFFFFFFF'});
    ws.getRow(r).height=20;
    return r+1;
  }
  function mbXlParaBlock(ws, ncol, r, text){
    const c=mbXlMergeRow(ws, ncol, r, text, {align:'left',valign:'top'});
    const totalW=ws.columns.reduce(function(a,col){return a+(col.width||10);},0);
    ws.getRow(r).height=Math.max(18, Math.round(15*mbXlWrappedLineCount(text,totalW)));
    return r+1;
  }
  // 1.개요(4열, 라벨 1칸)·2~4번 시트 헤더(8열, 라벨 2칸) 양쪽에서 함께 쓰는 항목-값 행.
  function mbXlKVRow(ws, ncol, labelSpan, r, label, value, opts){
    opts=opts||{};
    ws.mergeCells(r,1,r,labelSpan);
    const lc=ws.getCell(r,1);
    lc.value=label; lc.font={bold:true,size:9}; lc.alignment={vertical:'middle'};
    lc.fill=opts.fill; lc.border=MB_XL_BORDER_ALL;
    for(let col=2;col<=labelSpan;col++){ const cc=ws.getCell(r,col); cc.fill=opts.fill; cc.border=MB_XL_BORDER_ALL; }
    ws.mergeCells(r,labelSpan+1,r,ncol);
    const vc=ws.getCell(r,labelSpan+1);
    vc.value=value; vc.font={size:9}; vc.alignment={vertical:'middle'};
    vc.border=MB_XL_BORDER_ALL;
    for(let col=labelSpan+2;col<=ncol;col++) ws.getCell(r,col).border=MB_XL_BORDER_ALL;
    ws.getRow(r).height=18;
    return r+1;
  }
  function mbXlDataTable(ws, ncol, r, headers, rows){
    headers.forEach(function(h,i){
      const c=ws.getCell(r,i+1);
      c.value=h; c.font={bold:true,color:{argb:'FF1F3864'}}; c.fill=MB_XL_FILL_COLHEAD; c.border=MB_XL_BORDER_ALL;
      c.alignment={horizontal:'center'};
    });
    ws.getRow(r).height=26; r++;
    rows.forEach(function(row){
      row.forEach(function(v,i){
        if(i>=headers.length) return;
        const c=ws.getCell(r,i+1);
        if(v!==null && v!==undefined && v!=='') c.value=v;
        c.border=MB_XL_BORDER_ALL; c.alignment={horizontal:i===0?'left':'center', wrapText:i===0};
      });
      ws.getRow(r).height=18;
      r++;
    });
    return r;
  }
  function mbXlHeaderKV(ws, ncol, r, pairs){
    pairs.forEach(function(p){ r=mbXlKVRow(ws, ncol, 2, r, p[0], p[1], {fill:MB_XL_FILL_LABEL}); });
    return r;
  }

  const MB_SPEC_FIELD_HEADERS=['한글명','영문컬럼ID','저장/조회 테이블','표시타입','기본값·설명(관련정보)','입력필수','Read Only','Display'];
  function mbSpecFieldTable(ws, r, sectionTitle, rows){
    r=mbXlSectionBanner(ws, 8, r, sectionTitle);
    const vals=rows.map(function(row){
      return [row.label, '', '', row.type, row.note||'', row.required?'Y(필수)':'N(선택)', row.readonly?'Y':'N', 'Y'];
    });
    return mbXlDataTable(ws, 8, r, MB_SPEC_FIELD_HEADERS, vals);
  }

  window.mbOpenSpecExport=async function(){
    const badge=document.getElementById('mbBadgeS');
    const badgeOrigHtml=badge?badge.innerHTML:'';
    if(badge){ badge.style.pointerEvents='none'; badge.style.opacity='.6'; }
    showCapBusy();
    try{
      const spec=mbBuildSpecSections();
      const shotBlob=await mbCaptureBlobForSpec();
      const shotBuf=await mbBlobToArrayBuffer(shotBlob);
      // 화면 비율을 알아야 삽입할 이미지의 세로 크기(그리고 그만큼 늘려야 할 행 높이)를 정할 수
      // 있으므로, Blob을 임시 <img>에 한 번 그려 원본 픽셀 크기를 읽는다. onload가 어떤 이유로든
      // (깨진 이미지 등) 안 오면 절대 무한정 멈춰있지 않도록 onerror와 타임아웃 둘 다 안전장치로
      // 걸어, 무슨 일이 있어도 8초 안에는 반드시(기본값으로라도) 다음 단계로 넘어가게 한다.
      const shotDims=await new Promise(function(resolve){
        let done=false;
        function finish(v){ if(done) return; done=true; resolve(v); }
        const img=new Image();
        img.onload=function(){ finish({w:img.naturalWidth||1200, h:img.naturalHeight||800}); };
        img.onerror=function(){ finish({w:1200,h:800}); };
        img.src=URL.createObjectURL(shotBlob);
        setTimeout(function(){ finish({w:1200,h:800}); }, 8000);
      });

      const ExcelJS=await mbLoadExcelJS();
      const wb=new ExcelJS.Workbook();
      const todayStr=new Date().toISOString().slice(0,10).replace(/-/g,'.');
      const todayIso=new Date().toISOString().slice(0,10);
      const programType=mbSpecProgramType(spec);
      const etcFeature=mbSpecEtcFeature(spec);
      const descText=mbSpecDescText(spec);

      // 화면LO의 [조회조건 Selection]/[섹션]/[그리드] 표에 쓸 필드 그룹을 한 번만 모아 여러
      // 시트(2.화면LO의 표, 4.기술사양의 Display 컬럼 매핑)에서 재사용한다.
      const fieldGroups=[];
      spec.searchbars.forEach(function(sb){ fieldGroups.push({title:'[조회조건 Selection]  (저장 없음)', rows:sb.rows}); });
      spec.sections.forEach(function(s){ fieldGroups.push({title:'['+s.title+']', rows:s.rows}); });
      spec.grids.forEach(function(g){ fieldGroups.push({title:'['+g.title+'] 그리드', rows:g.rows, isGrid:true}); });

      // ── 0.변경이력 ──────────────────────────────────────────────────────────────
      {
        const ws=wb.addWorksheet('0.변경이력');
        [5,14,70,20,12].forEach(function(w,i){ ws.getColumn(i+1).width=w; });
        let r=1;
        r=mbXlSheetTitle(ws,5,r,'0. 변경이력  (Change History)');
        ['No','변경 일자','변경 내용','담당자','요청자'].forEach(function(h,i){
          const c=ws.getCell(r,i+1);
          c.value=h; c.font={bold:true,color:{argb:'FF1F3864'}}; c.fill=MB_XL_FILL_COLHEAD; c.border=MB_XL_BORDER_ALL;
          c.alignment={horizontal:'center'};
        });
        ws.getRow(r).height=26; r++;
        [1, todayStr, '최초 작성', '', ''].forEach(function(v,i){
          const c=ws.getCell(r,i+1); c.value=v; c.border=MB_XL_BORDER_ALL; c.alignment={horizontal:'left'};
        });
      }

      // ── 1.개요 ──────────────────────────────────────────────────────────────────
      {
        const ws=wb.addWorksheet('1.개요');
        [26,45,25,25].forEach(function(w,i){ ws.getColumn(i+1).width=w; });
        let r=1;
        r=mbXlSheetTitle(ws,4,r,'1. 개요  (Overview)');
        const pairs=[
          ['프로젝트 명',''], ['모듈 / 서브모듈',' / '], ['프로그램ID',''], ['프로세스ID','-'],
          ['프로그램명', spec.title], ['프로그램 개요',''], ['요청자 / 요청일',' / '],
          ['예상 개발기간 / 완료희망일',''], ['개발자 / 개발완료일',' / '],
          ['우선순위(A/B/C)',''], ['난이도(H/M/L)',''], ['프로그램 유형', programType],
          ['재사용 PGM-ID','-'], ['수행빈도',''], ['기타 특성', etcFeature]
        ];
        pairs.forEach(function(p){ r=mbXlKVRow(ws,4,1,r,p[0],p[1],{fill:MB_XL_FILL_LABEL}); });
      }

      // ── 2.화면LO ────────────────────────────────────────────────────────────────
      {
        const ws=wb.addWorksheet('2.화면LO');
        [16,18,22,22,40,12,16,12].forEach(function(w,i){ ws.getColumn(i+1).width=w; });
        let r=1;
        r=mbXlSheetTitle(ws,8,r,'2. 화면 LAYOUT  (Screen Layout)');
        r=mbXlHeaderKV(ws,8,r,[
          ['모듈 / 서브모듈',' / '],
          ['프로그램ID / 프로그램명',' / '+spec.title],
          ['작성자 / 작성일',' / '+todayIso]
        ]);
        r=mbXlSectionBanner(ws,8,r,'■ 화면설명');
        r=mbXlParaBlock(ws,8,r,descText);

        r=mbXlSectionBanner(ws,8,r,'■ 화면 Mock-up');
        const targetImgW=900;
        const scale=targetImgW/shotDims.w;
        const imgW=targetImgW, imgH=Math.round(shotDims.h*scale);
        const imgId=wb.addImage({buffer:shotBuf, extension:'png'});
        ws.addImage(imgId,{tl:{col:0,row:r-1}, ext:{width:imgW,height:imgH}});
        ws.getRow(r).height=Math.round(imgH*0.75)+10;
        r++;

        fieldGroups.forEach(function(g){ r=mbSpecFieldTable(ws, r, g.title, g.rows); });
        if(spec.buttons.length && !spec.searchbars.length){
          // 조회조건이 없는 화면은 표준 [조회] 버튼이 자동으로 붙지 않으므로, 버튼 목록을
          // 별도 [버튼] 표로 한 번 더 남긴다(조회조건이 있으면 그 표에 이미 [조회]가 포함됨).
          r=mbSpecFieldTable(ws, r, '[버튼]', spec.buttons.map(function(b){
            return {label:b, type:'버튼', required:false, readonly:false, note:''};
          }));
        }
      }

      // ── 3.기능사양 ──────────────────────────────────────────────────────────────
      {
        const ws=wb.addWorksheet('3.기능사양');
        [22,16,16,16,16,16,16,16].forEach(function(w,i){ ws.getColumn(i+1).width=w; });
        let r=1;
        r=mbXlSheetTitle(ws,8,r,'3. 기능사양  (Functional Specification / 사용자 매뉴얼)');
        r=mbXlHeaderKV(ws,8,r,[
          ['모듈 / 서브모듈',' / '],
          ['프로그램ID / 프로그램명',' / '+spec.title],
          ['작성자 / 작성일',' / '+todayIso],
          ['프로그램 목적','']
        ]);
        r=mbXlParaBlock(ws,8,r,"※ 본 시트는 사용자(현업) 관점의 기능 설명입니다. 사용 테이블·컬럼ID·SQL 등 기술 내용은 '4.기술사양' 시트를 참조하십시오. (XL-R08)");
      }

      // ── 4.기술사양 ──────────────────────────────────────────────────────────────
      {
        const ws=wb.addWorksheet('4.기술사양');
        [16,18,22,28,16,30].forEach(function(w,i){ ws.getColumn(i+1).width=w; });
        let r=1;
        r=mbXlSheetTitle(ws,6,r,'4. 기술사양  (Technical Specification)');
        r=mbXlHeaderKV(ws,6,r,[
          ['모듈 / 서브모듈',' / '],
          ['프로그램ID / 프로그램명',' / '+spec.title],
          ['작성자 / 작성일',' / '+todayIso]
        ]);
        const gridRows=[];
        spec.grids.forEach(function(g){ gridRows.push.apply(gridRows, g.rows); });
        if(gridRows.length){
          r=mbXlSectionBanner(ws,6,r,'4-1. Display 컬럼 매핑');
          const headers=['한글명','영문컬럼ID','원천 테이블(별칭)','SQL 표현식/산출','표시타입','비고'];
          const vals=gridRows.map(function(row){ return [row.label, '', '', '', row.type, row.note||'']; });
          r=mbXlDataTable(ws,6,r,headers,vals);
        }
      }

      // ── 5.테이블 레이아웃 ──────────────────────────────────────────────────────
      {
        const ws=wb.addWorksheet('5.테이블 레이아웃');
        [16,18,14,10,8,8,12,30].forEach(function(w,i){ ws.getColumn(i+1).width=w; });
        let r=1;
        r=mbXlSheetTitle(ws,8,r,'5. 테이블 레이아웃  (Table Layout)');
        r=mbXlParaBlock(ws,8,r,'저장/조회 대상 테이블·컬럼 정보는 화면 구성에 나타나지 않는다.');
      }

      // ── 6.단위테스트 ────────────────────────────────────────────────────────────
      {
        const ws=wb.addWorksheet('6.단위테스트');
        [8,26,20,20,10,20,14,20].forEach(function(w,i){ ws.getColumn(i+1).width=w; });
        let r=1;
        r=mbXlSheetTitle(ws,8,r,'6. 단위테스트  (Unit Test)');
        r=mbXlSectionBanner(ws,8,r,'■ 테스트 케이스');
        r=mbXlDataTable(ws,8,r,['순번','테스트 절차','테스트 데이터','예상결과','결과','오류내역','조치예정일','조치내역'],[]);
        r=mbXlSectionBanner(ws,8,r,'■ 공통 체크리스트');
        MB_SPEC_CHECKLIST.forEach(function(line){ r=mbXlParaBlock(ws,8,r,line); });
      }

      const buf=await wb.xlsx.writeBuffer();
      const blob=new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
      const suggestedName='사양서_'+(spec.title||'mockup').replace(/[\/:*?"<>|]/g,'_')+'.xlsx';
      const saved=await mbSaveBlobWithPicker(blob,suggestedName,'Excel 파일','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','.xlsx');
      if(saved) showMbToast('사양서 매핑 템플릿(.xlsx)이 저장되었습니다');
    }catch(err){
      alert('사양서 템플릿을 만들지 못했습니다.\n\n'+(err&&err.message?err.message:err));
    } finally {
      hideCapBusy();
      if(badge){ badge.style.pointerEvents=''; badge.style.opacity=''; badge.innerHTML=badgeOrigHtml; }
    }
  };

})();
