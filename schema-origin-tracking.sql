-- ============================================================
-- 목업 원본-파생 관계 추적을 위한 스키마 변경
-- (mockups 테이블에 origin_id 컬럼 추가)
-- ============================================================
-- 전제: mockups.id 의 실제 타입에 맞춰 아래 uuid 를 bigint 등으로 바꿔서 실행하세요.
--       (Supabase 기본 템플릿이면 대개 uuid 입니다)

-- 1) 파생 출처(항상 "최상위 원본"의 id) 컬럼 추가
--    - NULL  = 원본이거나, 파생 관계를 알 수 없는 파일(예전 데이터, 로컬 불러오기로 만든 파일 등)
--    - not null = 그 값이 가리키는 mockups.id가 이 파일의 최상위 원본
ALTER TABLE mockups
  ADD COLUMN IF NOT EXISTS origin_id uuid REFERENCES mockups(id) ON DELETE SET NULL;

-- 2) 자기 자신을 원본으로 가리키는 잘못된 값 방지
ALTER TABLE mockups
  ADD CONSTRAINT chk_mockups_origin_not_self CHECK (origin_id IS NULL OR origin_id <> id);

-- 3) "이 원본에서 파생된 파일 목록/개수" 조회 성능을 위한 인덱스
CREATE INDEX IF NOT EXISTS idx_mockups_origin_id
  ON mockups (origin_id)
  WHERE origin_id IS NOT NULL;

-- ============================================================
-- 원본별 파생 개수를 바로 조회할 수 있는 뷰
-- 공유목록의 "리비전 N개" 배지가 실제로 이 뷰를 조회해서 숫자를 채운다(app.js의
-- mbCloudAttachRevisionCounts). 이 뷰가 없어도 앱 자체는 에러 없이 동작하지만
-- (조회 실패는 조용히 무시됨), 배지 숫자는 뜨지 않는다 - 배지 기능을 쓰려면 필수.
-- 예) SELECT m.*, COALESCE(d.derivative_count,0) AS derivative_count
--     FROM mockups m LEFT JOIN mockup_derivative_counts d ON d.origin_id = m.id
--     WHERE m.origin_id IS NULL   -- 원본만
-- ============================================================
CREATE OR REPLACE VIEW mockup_derivative_counts AS
SELECT origin_id, COUNT(*)::int AS derivative_count
FROM mockups
WHERE origin_id IS NOT NULL
GROUP BY origin_id;

-- ============================================================
-- (선택) DB 차원의 안전장치: origin_id가 항상 "최상위 원본"만 가리키도록
-- 한 번 더 평탄화한다. 클라이언트(app.js)가 이미 평탄화해서 보내지만,
-- 다른 경로(관리자 도구, 마이그레이션 스크립트 등)로 값이 들어올 경우를
-- 대비한 방어 코드입니다. 없어도 앱 자체 동작에는 지장 없습니다.
-- ============================================================
CREATE OR REPLACE FUNCTION mockups_flatten_origin()
RETURNS trigger AS $$
DECLARE
  grandparent uuid;
BEGIN
  IF NEW.origin_id IS NOT NULL THEN
    SELECT origin_id INTO grandparent FROM mockups WHERE id = NEW.origin_id;
    IF grandparent IS NOT NULL THEN
      NEW.origin_id := grandparent; -- 참조한 파일 자체가 파생본이면, 그 파일의 원본으로 대체
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_mockups_flatten_origin ON mockups;
CREATE TRIGGER trg_mockups_flatten_origin
BEFORE INSERT OR UPDATE OF origin_id ON mockups
FOR EACH ROW EXECUTE FUNCTION mockups_flatten_origin();

-- ============================================================
-- 되돌리기(필요한 경우)
-- ============================================================
-- DROP TRIGGER IF EXISTS trg_mockups_flatten_origin ON mockups;
-- DROP FUNCTION IF EXISTS mockups_flatten_origin();
-- DROP VIEW IF EXISTS mockup_derivative_counts;
-- ALTER TABLE mockups DROP CONSTRAINT IF EXISTS chk_mockups_origin_not_self;
-- DROP INDEX IF EXISTS idx_mockups_origin_id;
-- ALTER TABLE mockups DROP COLUMN IF EXISTS origin_id;
