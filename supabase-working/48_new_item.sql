-- 48 / 교육용 원본 꾸미기 아이템 추가 (기존 아이템·구매 기록 보존)
-- 새 부품 45개 = 기본 무료 3개 + 유료 42개.
-- 주의: 교육용 원본의 가격·등급·레벨 기준을 그대로 사용합니다.
-- 아래 SQL은 get_game_shop() 함수가 참조하는 아이템 테이블을 자동 확인합니다.
-- 식별할 수 없으면 데이터 변경 없이 오류를 내고 멈춥니다.
-- 기존 01~47번 SQL 재실행 금지.

DO $migration$
DECLARE
 v_func text;
 v_table regclass;
 v_name text;
 v_col text;
 v_expected text[] := ARRAY['id','slot','name','price','rarity','min_level','sort'];
 v_cols text[];
BEGIN
 SELECT pg_get_functiondef(p.oid) INTO v_func
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname='get_game_shop'
 ORDER BY p.oid LIMIT 1;
 IF v_func IS NULL THEN
   RAISE EXCEPTION 'get_game_shop 함수가 없음: 실제 운영 DB의 상점 구조 확인 필요';
 END IF;
 -- 신규 전용 카탈로그가 있으면 그곳을 우선 검사하고, 없으면 기존 아이템 카탈로그 검사.
 FOREACH v_name IN ARRAY ARRAY['game_avatar_items','game_avatar_catalog','avatar_items'] LOOP
   v_table := to_regclass('public.' || v_name);
   IF v_table IS NULL THEN CONTINUE; END IF;
   IF position(v_name IN v_func)=0 THEN CONTINUE; END IF;
   SELECT array_agg(a.attname ORDER BY a.attname) INTO v_cols
   FROM pg_attribute a
   WHERE a.attrelid=v_table AND a.attnum>0 AND NOT a.attisdropped
     AND a.attname=ANY(v_expected);
   IF (SELECT count(*) FROM unnest(v_expected) AS col WHERE col=ANY(v_cols))=7 THEN EXIT; END IF;
   v_table:=NULL;
 END LOOP;
 IF v_table IS NULL THEN
   RAISE EXCEPTION '상점에서 사용하는 아이템 테이블을 확인할 수 없음. 이 SQL은 실행하지 말고 현재 get_game_shop 함수/카탈로그 스키마를 점검하세요.';
 END IF;
 EXECUTE format($insert$
   INSERT INTO %s (id,slot,name,price,rarity,min_level,sort)
   VALUES
%s
   ON CONFLICT (id) DO NOTHING
 $insert$,v_table, $items$
     ('acc_cyber_shades','acc','선글라스',130,'rare',1,52),
     ('acc_holo','acc','측정기',100,'rare',1,51),
     ('acc_tesla','acc','번개 막대',90,'rare',1,53),
     ('acc_wings','acc','날개',300,'legend',6,54),
     ('aura_fire','aura','불꽃 오라',300,'legend',5,53),
     ('aura_music','aura','음파 오라',110,'rare',1,54),
     ('aura_none','aura','없음',0,'common',1,0),
     ('aura_orbit','aura','궤도 오라',260,'legend',4,52),
     ('aura_starlight','aura','별빛 오라',140,'rare',1,55),
     ('aura_thunder','aura','번개 오라',150,'rare',1,51),
     ('bg_blackhole','bg','블랙홀',320,'legend',6,51),
     ('bg_bubbles','bg','거품',100,'rare',1,54),
     ('bg_circuit','bg','회로',110,'rare',1,53),
     ('bg_meteor','bg','유성우',130,'rare',1,52),
     ('bg_sunburst','bg','햇살',300,'legend',5,55),
     ('eyes_cyber','eyes','스캐너 눈',110,'rare',1,51),
     ('eyes_fire','eyes','불꽃 눈',100,'rare',1,52),
     ('eyes_galaxy','eyes','오드아이',260,'legend',4,53),
     ('eyes_pulse','eyes','심박 눈',90,'rare',1,54),
     ('eyes_swirl','eyes','소용돌이 눈',75,'rare',1,55),
     ('hair_cloud','hair','솜사탕 머리',110,'rare',1,54),
     ('hair_flame','hair','불꽃 머리',300,'legend',5,51),
     ('hair_neon','hair','브릿지 머리',100,'rare',1,53),
     ('hair_volt','hair','번개 머리',270,'legend',4,55),
     ('hair_zero_g','hair','무중력 머리',90,'rare',1,52),
     ('hat_alchem','hat','고글 모자',110,'rare',1,53),
     ('hat_astro','hat','우주 헬멧',300,'legend',5,51),
     ('hat_none','hat','없음',0,'common',1,0),
     ('hat_wizard','hat','마법사 모자',130,'rare',1,52),
     ('mouth_beam','mouth','무지개 빔',90,'rare',1,53),
     ('mouth_bubble','mouth','풍선껌',80,'rare',1,51),
     ('mouth_fang','mouth','송곳니',75,'rare',1,54),
     ('mouth_meat','mouth','고기',45,'common',1,52),
     ('mouth_whistle','mouth','휘파람',70,'rare',1,55),
     ('outfit_champ','outfit','황금 망토',320,'legend',7,55),
     ('outfit_chem','outfit','실험 앞치마',110,'rare',1,54),
     ('outfit_core','outfit','코어 슈트',300,'legend',6,51),
     ('outfit_gamer','outfit','게이밍 후드',100,'rare',1,53),
     ('outfit_wizard','outfit','마법사 망토',130,'rare',1,52),
     ('pet_atom','pet','원자',130,'rare',1,54),
     ('pet_dragon','pet','드래곤',300,'legend',6,55),
     ('pet_drone','pet','드론',240,'legend',4,51),
     ('pet_none','pet','없음',0,'common',1,0),
     ('pet_slime','pet','슬라임',100,'rare',1,52),
     ('pet_star','pet','별',110,'rare',1,53)
 $items$);
 RAISE NOTICE '아이템 데이터 등록 완료: %', v_table::text;
END;
$migration$;
