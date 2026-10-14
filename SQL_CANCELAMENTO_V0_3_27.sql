-- ROTA FÁCIL V0.3.27: CANCELAMENTO SEM EXCLUIR HISTÓRICO
-- Execute no SQL Editor do Supabase, antes de publicar o painel.
-- Não apaga pedidos, paradas, rotas nem cria lançamentos financeiros.
CREATE OR REPLACE FUNCTION public.rota_cancelar_pedidos_loja(
 p_empresa_id uuid, p_loja_id uuid, p_pedido_ids uuid[]
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_count integer; v_cancelados integer; v_rota_id uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS (
  SELECT 1 FROM public.membros m
  WHERE m.usuario_id=auth.uid() AND m.empresa_id=p_empresa_id
    AND m.ativo=true AND m.papel IN ('proprietario','gerente','atendente')
 ) THEN RAISE EXCEPTION 'Sem permissao para cancelar pedidos'; END IF;
 IF p_pedido_ids IS NULL OR cardinality(p_pedido_ids) NOT BETWEEN 1 AND 100 THEN
  RAISE EXCEPTION 'Selecione entre 1 e 100 pedidos'; END IF;
 SELECT count(DISTINCT x) INTO v_count FROM unnest(p_pedido_ids) AS x;
 IF v_count<>cardinality(p_pedido_ids) THEN RAISE EXCEPTION 'IDs duplicados'; END IF;
 -- Bloqueia alterações concorrentes enquanto verifica o estado.
 PERFORM 1 FROM public.pedidos p WHERE p.id=ANY(p_pedido_ids) FOR UPDATE;
 SELECT count(*) INTO v_count FROM public.pedidos p
 WHERE p.id=ANY(p_pedido_ids) AND p.empresa_id=p_empresa_id
   AND p.loja_id=p_loja_id AND p.status='pendente';
 IF v_count<>cardinality(p_pedido_ids) THEN
  RAISE EXCEPTION 'Pedido nao encontrado, ja processado ou nao pertence a loja. Atualize o painel';
 END IF;
 -- Cancelamento administrativo de pedidos pendentes, inclusive com vínculo histórico.
 UPDATE public.pedidos p SET status='cancelado', atualizado_em=now()
 WHERE p.id=ANY(p_pedido_ids) AND p.empresa_id=p_empresa_id
   AND p.loja_id=p_loja_id AND p.status='pendente';
 GET DIAGNOSTICS v_cancelados=ROW_COUNT;
 IF v_cancelados<>cardinality(p_pedido_ids) THEN RAISE EXCEPTION 'Cancelamento incompleto'; END IF;
 -- Apenas encerra rotas ativas quando não houver mais pedidos em rota.
 FOR v_rota_id IN
  SELECT DISTINCT rp.rota_id FROM public.rota_paradas rp
  WHERE rp.pedido_id=ANY(p_pedido_ids) AND rp.empresa_id=p_empresa_id
 LOOP
  UPDATE public.rotas r SET status='concluida'
  WHERE r.id=v_rota_id AND r.empresa_id=p_empresa_id
    AND r.status IN ('enviada','em_andamento')
    AND NOT EXISTS (
      SELECT 1 FROM public.rota_paradas rp
      JOIN public.pedidos p ON p.id=rp.pedido_id AND p.empresa_id=p_empresa_id
      WHERE rp.rota_id=r.id AND rp.empresa_id=p_empresa_id AND p.status='em_rota'
    );
 END LOOP;
 RETURN jsonb_build_object('cancelados',v_cancelados);
END $$;
REVOKE ALL ON FUNCTION public.rota_cancelar_pedidos_loja(uuid,uuid,uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rota_cancelar_pedidos_loja(uuid,uuid,uuid[]) TO authenticated;
