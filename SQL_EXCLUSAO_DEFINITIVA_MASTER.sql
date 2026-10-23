-- ROTA FACIL | EXCLUSAO DEFINITIVA DE PEDIDO (uso temporario)
-- Executar no SQL Editor do Supabase como administrador.
-- AVISO: exclusao irreversivel. Fazer backup e testar com pedido de TESTE.
-- UID da conta MASTER foi informado pelo usuario.
-- Nao usar a conta normal do motoboy como autorizacao.

CREATE OR REPLACE FUNCTION public.rota_master_pode_excluir()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT (SELECT auth.uid()) = '8a52fafa-744e-4bec-ab8f-d67b3ef73408'::uuid;
$$;
REVOKE ALL ON FUNCTION public.rota_master_pode_excluir() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rota_master_pode_excluir() TO authenticated;

CREATE OR REPLACE FUNCTION public.rota_master_excluir_pedido(
  p_empresa_id uuid, p_pedido_id uuid, p_pin text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_pedido public.pedidos%ROWTYPE;
  v_historicos text[];
  v_rota_ativa boolean;
  v_financeiro int := 0;
  v_unificado int := 0;
  v_historico int := 0;
  v_paradas int := 0;
BEGIN
  IF (SELECT auth.uid()) IS DISTINCT FROM '8a52fafa-744e-4bec-ab8f-d67b3ef73408'::uuid THEN
    RAISE EXCEPTION 'Somente a conta MASTER autorizada pode excluir' USING ERRCODE='42501';
  END IF;
  IF p_pin IS DISTINCT FROM '2756' THEN
    RAISE EXCEPTION 'Codigo MASTER incorreto' USING ERRCODE='42501';
  END IF;
  IF p_empresa_id IS NULL OR p_pedido_id IS NULL THEN
    RAISE EXCEPTION 'Empresa e pedido sao obrigatorios';
  END IF;
  -- Serializa exclusoes concorrentes do mesmo pedido.
  SELECT * INTO v_pedido FROM public.pedidos
   WHERE id=p_pedido_id AND empresa_id=p_empresa_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido nao encontrado nesta empresa'; END IF;

  -- Evita mexer em uma rota ainda operada pelo motoboy.
  SELECT EXISTS (
    SELECT 1 FROM public.rota_paradas rp
    JOIN public.rotas r ON r.id=rp.rota_id AND r.empresa_id=rp.empresa_id
    WHERE rp.pedido_id=p_pedido_id AND rp.empresa_id=p_empresa_id
      AND r.status IN ('enviada','em_andamento')
  ) INTO v_rota_ativa;
  IF v_rota_ativa OR v_pedido.status='em_rota' THEN
    RAISE EXCEPTION 'Pedido em rota ativa: conclua ou cancele a rota antes de excluir';
  END IF;

  -- IDs locais sao a ponte confiavel entre historico e financeiro unificado.
  SELECT COALESCE(array_agg(DISTINCT h.local_id), ARRAY[]::text[])
    INTO v_historicos
    FROM public.historico_entregas_motoboy h
    WHERE h.empresa_id=p_empresa_id
      AND h.dados->>'remotePedidoId'=p_pedido_id::text;

  -- Remove registros de auditoria identificados por UUID ou pelo local_id comprovado.
  DELETE FROM public.rota_auditoria_historico a
    WHERE a.empresa_id=p_empresa_id
      AND (a.remote_pedido_id=p_pedido_id::text
        OR a.local_id=ANY(v_historicos));

  -- Remove marcadores de exclusao anteriores do mesmo pedido (sem tocar nos demais).
  DELETE FROM public.rota_corridas_removidas x
    WHERE x.empresa_id=p_empresa_id
      AND (x.pedido_id=p_pedido_id::text
        OR x.registro_id='financeiro:'||p_pedido_id::text
        OR x.registro_id IN (SELECT 'historico:'||unnest(v_historicos)));

  DELETE FROM public.rota_financeiro_unificado f
    WHERE f.empresa_id=p_empresa_id
      AND (f.pedido_id=p_pedido_id::text
        OR f.registro_id='financeiro:'||p_pedido_id::text
        OR f.registro_id IN (SELECT 'historico:'||unnest(v_historicos)));
  GET DIAGNOSTICS v_unificado=ROW_COUNT;

  DELETE FROM public.historico_entregas_motoboy h
    WHERE h.empresa_id=p_empresa_id
      AND h.dados->>'remotePedidoId'=p_pedido_id::text;
  GET DIAGNOSTICS v_historico=ROW_COUNT;

  DELETE FROM public.financeiro_corridas_motoboy f
    WHERE f.empresa_id=p_empresa_id AND f.pedido_id=p_pedido_id;
  GET DIAGNOSTICS v_financeiro=ROW_COUNT;

  DELETE FROM public.rota_paradas rp
    WHERE rp.empresa_id=p_empresa_id AND rp.pedido_id=p_pedido_id;
  GET DIAGNOSTICS v_paradas=ROW_COUNT;

  -- Se houver outras dependencias FK nao mapeadas, a transacao falha e tudo reverte.
  DELETE FROM public.pedidos p
    WHERE p.empresa_id=p_empresa_id AND p.id=p_pedido_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido nao removido'; END IF;

  RETURN jsonb_build_object('ok',true,'pedido_id',p_pedido_id,
    'financeiro_corridas',v_financeiro,'financeiro_unificado',v_unificado,
    'historicos',v_historico,'paradas',v_paradas);
END;
$$;
REVOKE ALL ON FUNCTION public.rota_master_excluir_pedido(uuid,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rota_master_excluir_pedido(uuid,uuid,text) TO authenticated;

-- Confirmacao de instalacao (nao apaga dados):
SELECT proname FROM pg_proc WHERE pronamespace='public'::regnamespace
  AND proname IN ('rota_master_pode_excluir','rota_master_excluir_pedido');
