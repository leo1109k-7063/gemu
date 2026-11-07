
-- 47 / 공용 무르기 도구
-- 체스 · 고누 · 오목 솔리테어
-- 5개 20코인, 사용 1회당 1개

CREATE TABLE IF NOT EXISTS public.game_undo_inventory (
  profile_id uuid PRIMARY KEY
    REFERENCES public.game_profiles(id) ON DELETE CASCADE,
  quantity integer NOT NULL DEFAULT 0
    CHECK (quantity >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.game_undo_usage (
  request_id uuid PRIMARY KEY,
  profile_id uuid NOT NULL
    REFERENCES public.game_profiles(id) ON DELETE CASCADE,
  game text NOT NULL
    CHECK (game IN ('chess','gonu','omok')),
  used_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.game_undo_inventory
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.game_undo_usage
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.game_undo_inventory
  FROM anon, authenticated;

REVOKE ALL ON public.game_undo_usage
  FROM anon, authenticated;

-- 계정의 공용 무르기 수량 조회
CREATE OR REPLACE FUNCTION public.get_undo_tools(
  p_profile_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quantity integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.game_profiles
    WHERE id = p_profile_id
  ) THEN
    RAISE EXCEPTION 'PROFILE_NOT_FOUND';
  END IF;

  SELECT quantity INTO v_quantity
  FROM public.game_undo_inventory
  WHERE profile_id = p_profile_id;

  RETURN jsonb_build_object(
    'ok', true,
    'quantity', COALESCE(v_quantity, 0)
  );
END;
$$;

-- 20코인 결제 후 무르기 도구 5개 지급
CREATE OR REPLACE FUNCTION public.buy_undo_tools(
  p_profile_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_coins integer;
  v_quantity integer;
BEGIN
  SELECT coins INTO v_coins
  FROM public.game_profiles
  WHERE id = p_profile_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROFILE_NOT_FOUND';
  END IF;

  IF v_coins < 20 THEN
    RAISE EXCEPTION 'NO_COINS';
  END IF;

  UPDATE public.game_profiles
  SET coins = coins - 20,
      updated_at = now()
  WHERE id = p_profile_id
  RETURNING coins INTO v_coins;

  INSERT INTO public.game_undo_inventory (
    profile_id, quantity
  )
  VALUES (p_profile_id, 5)
  ON CONFLICT (profile_id)
  DO UPDATE SET
    quantity = game_undo_inventory.quantity + 5,
    updated_at = now()
  RETURNING quantity INTO v_quantity;

  INSERT INTO public.coin_transactions (
    profile_id, amount, reason
  )
  VALUES (
    p_profile_id,
    -20,
    '공용 무르기 도구 5개 구매'
  );

  RETURN jsonb_build_object(
    'ok', true,
    'coins', v_coins,
    'quantity', v_quantity
  );
END;
$$;

-- 무르기 1회 사용 시 1개 차감
CREATE OR REPLACE FUNCTION public.use_undo_tool(
  p_profile_id uuid,
  p_game text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quantity integer;
BEGIN
  IF p_game NOT IN ('chess','gonu','omok')
     OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_REQUEST';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.game_undo_usage
    WHERE request_id = p_request_id
  ) THEN
    RAISE EXCEPTION 'ALREADY_USED';
  END IF;

  UPDATE public.game_undo_inventory
  SET quantity = quantity - 1,
      updated_at = now()
  WHERE profile_id = p_profile_id
    AND quantity > 0
  RETURNING quantity INTO v_quantity;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NO_UNDO_TOOLS';
  END IF;

  INSERT INTO public.game_undo_usage (
    request_id, profile_id, game
  )
  VALUES (p_request_id, p_profile_id, p_game);

  RETURN jsonb_build_object(
    'ok', true,
    'quantity', v_quantity
  );
END;
$$;

REVOKE ALL ON FUNCTION
  public.get_undo_tools(uuid)
  FROM public, anon;

REVOKE ALL ON FUNCTION
  public.buy_undo_tools(uuid)
  FROM public, anon;

REVOKE ALL ON FUNCTION
  public.use_undo_tool(uuid,text,uuid)
  FROM public, anon;

GRANT EXECUTE ON FUNCTION
  public.get_undo_tools(uuid)
  TO anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.buy_undo_tools(uuid)
  TO anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.use_undo_tool(uuid,text,uuid)
  TO anon, authenticated;
