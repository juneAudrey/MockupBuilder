/* spec_demo.js — "예시로 둘러보기" 용 가상 데이터. 실제 고객 사양서가 아니다. */
(function () {
  const SF = (window.SF = window.SF || {});
  const col = (area, label, tbl, column, display, desc, change) => ({ area, label, column, table: tbl ? tbl + ' (R)' : '', tbl, crud: 'R', display, desc, change: change || '', required: '', default: '', source: '' });
  SF.demoIndex = () => ({
    schema: SF.SCHEMA, builtAt: new Date().toISOString(), warnings: ['[예시] 실제 폴더를 연결하면 읽기 경고가 여기에 나옵니다'],
    specs: [
      {
        key: '예시상사/설계/SD/수주현황조회(S)', source: '도구', project: '예시상사', workspace: '설계', module: 'SD', programId: 'SDSOQUI9001', name: '수주현황조회(S)',
        confirmedAt: '2026-11-13', version: 2, adapter: '모델JSON v1', parsed: true, base: ['SDSOQUI0009'],
        overview: '수주 헤더 · 품목을 한 그리드로 보여 주고 납기 변경일 · 고객 발주번호를 함께 조회한다.',
        programType: '조회(Query)', screenDesc: '조회조건 4칸 격자 · 그리드 1개 (헤더+품목 평평하게)',
        columns: [
          col('조회조건', '수주일', 'S_SO_HDR', 'SO_DT', '기간', '기본값 이번 달 1일 ~ 오늘'),
          col('조회조건', '고객', 'S_SO_HDR', 'SOLD_TO_PARTY', '팝업', '고객 팝업'),
          col('그리드', '수주번호', 'S_SO_HDR', 'SO_NO', '텍스트', '누르면 수주등록 화면으로 이동'),
          col('그리드', '품목', 'S_SO_DTL', 'ITEM_CD', '텍스트', ''),
          col('그리드', '수주수량', 'S_SO_DTL', 'SO_QTY', '숫자', '소수 3자리'),
          col('그리드', '납기일', 'S_SO_DTL', 'DLVY_DT', '날짜', ''),
          col('그리드', '납기변경일', 'S_SO_DTL', 'CHG_DLVY_DT', '날짜', '납기를 바꾼 마지막 날짜. 없으면 빈칸', '추가'),
          col('그리드', '고객발주번호', 'S_SO_HDR', 'CUST_PO_NO', '텍스트', '고객이 준 PO 번호', '추가'),
          col('그리드', '출하요청수량', 'S_DN_DTL', 'GI_REMAIN_QTY', '숫자', '출고예정량 = 요청 - 출고', '추가'),
        ],
        tables: [{ id: 'S_SO_HDR', name: '수주 헤더', crud: 'R', note: '수주번호 · 고객 · 수주일' }, { id: 'S_SO_DTL', name: '수주 품목', crud: 'R', note: '품목 · 수량 · 납기' }, { id: 'S_DN_DTL', name: '출하 품목', crud: 'R', note: '출고예정량 계산' }],
        services: [{ id: 'SDSOQUI9001_Q01', name: '수주현황 조회', use: '화면', note: 'S_SO_HDR S_SO_DTL S_DN_DTL 조인' }],
        func: ['1. 조회', '   · 수주일 기간 필수, 고객은 선택', '2. 수주번호 누르면 수주등록(S) 열기'],
        tech: ['1-1. 납기변경일 = S_SO_DTL.CHG_DLVY_DT (값이 없으면 빈칸)', '1-2. 출하요청수량 = SUM(S_DN_DTL.GI_REMAIN_QTY) GROUP BY SO_NO, SO_SEQ'],
        tests: [['수주일 이번 달 · 고객 비움', '조회', '이번 달 수주 전체가 나온다'], ['납기를 바꾼 수주', '조회', '납기변경일이 채워진다']],
        history: [['2026-11-10', '최초 작성'], ['2026-11-13', '출하요청수량 추가 · 확정']],
        memo: '## 결정\n- 납기변경일은 마지막 변경일만 보여 준다\n- 출하요청수량은 출고예정량 기준', mockups: [],
      },
      {
        key: '예시상사/설계/MM/발주납기변동현황(S)', source: '도구', project: '예시상사', workspace: '설계', module: 'MM', programId: '미정', name: '발주납기변동현황(S)',
        confirmedAt: '2026-11-20', version: 1, adapter: '모델JSON v1', parsed: true, base: [],
        overview: '발주 품목의 납기 변경 이력을 기간으로 조회한다.',
        columns: [
          col('조회조건', '발주일', 'M_PUR_ORD_HDR', 'PO_DT', '기간', ''),
          col('그리드', '발주번호', 'M_PUR_ORD_HDR', 'PO_NO', '텍스트', ''),
          col('그리드', '변경 전 납기', 'M_PUR_ORD_DTL', 'DLVY_DT', '날짜', ''),
          col('그리드', '변경 후 납기', 'M_PUR_ORD_DTL', 'CHG_DLVY_DT', '날짜', '변경 이력 테이블의 마지막 값'),
        ],
        tables: [{ id: 'M_PUR_ORD_HDR', name: '발주 헤더', crud: 'R', note: '' }, { id: 'M_PUR_ORD_DTL', name: '발주 품목', crud: 'R', note: '' }],
        services: [], func: ['1. 기간 조회'], tech: [], tests: [], history: [['2026-11-20', '확정']], memo: '', mockups: [],
        sql: [{ name: '01_조회.sql', dir: 'SQL', path: '', size: 420, text: 'SELECT A.PO_NO, B.ITEM_CD, B.DLVY_DT, B.CHG_DLVY_DT\nFROM M_PUR_ORD_HDR A\nINNER JOIN M_PUR_ORD_DTL B ON A.PO_NO = B.PO_NO\nWHERE A.PO_DT BETWEEN @FR_DT AND @TO_DT' }],
      },
      {
        key: '예시상사/사양서/IM001', source: '수기', project: '예시상사', workspace: '사양서', module: 'IM', reqId: 'IM001', programId: '미정', name: '출고요청등록(S)',
        confirmedAt: '2026-10-02', version: 3, adapter: '표준엑셀 v1', parsed: true, base: ['IMRQMUI0001'],
        overview: '생산 · 프로젝트 출고 요청을 등록하고 BOM 참조로 품목을 불러온다.',
        revisions: [{ label: 'V03', name: 'IM001_출고요청등록_V03.xlsx', path: '' }, { label: 'V02', name: 'IM001_출고요청등록_V02.xlsx', path: '' }, { label: '최초', name: 'IM001_출고요청등록.xlsx', path: '' }],
        columns: [
          col('헤더', '요청번호', 'I_MATERIAL_ISSUE_REQ_HDR', 'REQ_NO', '텍스트', '자동 채번'),
          col('품목', '품목', 'I_MATERIAL_ISSUE_REQ_DTL', 'ITEM_CD', '팝업', 'BOM 참조 팝업으로 여러 개 불러오기'),
          col('품목', '요청수량', 'I_MATERIAL_ISSUE_REQ_DTL', 'REQ_QTY', '숫자', '현재고보다 크면 경고'),
          col('품목', '현재고', 'I_ONHAND_STOCK', 'GOOD_ON_HAND_QTY', '숫자', '창고별 현재고'),
        ],
        tables: [{ id: 'I_MATERIAL_ISSUE_REQ_HDR', name: '출고요청 헤더', crud: 'CRUD', note: '' }, { id: 'I_MATERIAL_ISSUE_REQ_DTL', name: '출고요청 품목', crud: 'CRUD', note: '' }, { id: 'I_ONHAND_STOCK', name: '현재고', crud: 'R', note: '' }],
        services: [], func: ['1. 저장 · 확정', '2. 확정 뒤에는 수정 불가'], tech: ['1-1. 요청수량 > 현재고 이면 메시지'], tests: [],
        history: [['2026-09-01', '최초'], ['2026-10-02', 'V03 · 현재고 컬럼 추가']], memo: '', mockups: [],
        sql: [{ name: 'SAVE.sql', dir: '41. SQL', path: '', size: 300, text: 'INSERT INTO I_MATERIAL_ISSUE_REQ_DTL (REQ_NO, REQ_SEQ, ITEM_CD, REQ_QTY)\nVALUES (@REQ_NO, @REQ_SEQ, @ITEM_CD, @REQ_QTY)\n\nUPDATE I_MATERIAL_ISSUE_REQ_HDR SET STATUS = \'C\' WHERE REQ_NO = @REQ_NO' }],
        outputs: [], prompts: [], reviews: [], files: [],
      },
      {
        key: '예시상사/사양서/IM001-1', source: '수기', project: '예시상사', workspace: '사양서', module: 'IM', reqId: 'IM001-1', programId: '미정', name: '출고요청등록(S)_BOM참조팝업',
        parent: '예시상사/사양서/IM001', confirmedAt: '2026-09-15', version: 1, adapter: '표준엑셀 v1', parsed: true, base: [],
        overview: '모품목의 BOM 을 펼쳐 출고요청 품목으로 넘긴다.',
        columns: [col('그리드', '자품목', 'B_BOM_DETAIL', 'CHILD_ITEM_CD', '텍스트', ''), col('그리드', '소요량', 'B_BOM_DETAIL', 'CHILD_ITEM_QTY', '숫자', '모품목 수량 × 소요량')],
        tables: [{ id: 'B_BOM_DETAIL', name: 'BOM 품목', crud: 'R', note: '' }], services: [], func: [], tech: [], tests: [], history: [], memo: '', mockups: [],
      },
    ],
  });
})();
