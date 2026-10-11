-- Rota Facil: confirmacao administrativa com verificacao de autorizacao.
-- Nao registra pagamento e nao altera historico financeiro.
CREATE OR REPLACE FUNCTION public.rota_confirmar_entrega_painel(p_rota_id uuid,p_pedido_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_rota public.rotas%ROWTYPE; v_status text; v_restantes integer;
BEGIN
 SELECT * INTO v_rota FROM public.rotas WHERE id=p_rota_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Rota inexistente'; END IF;
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.membros m WHERE m.usuario_id=auth.uid() AND m.empresa_id=v_rota.empresa_id AND m.ativo=true AND m.papel IN ('proprietario','gerente','atendente')) THEN RAISE EXCEPTION 'Sem permissao'; END IF;
 SELECT p.status INTO v_status FROM public.pedidos p JOIN public.rota_paradas rp ON rp.pedido_id=p.id AND rp.rota_id=p_rota_id AND rp.empresa_id=v_rota.empresa_id WHERE p.id=p_pedido_id AND p.empresa_id=v_rota.empresa_id FOR UPDATE OF p;
 IF v_status IS NULL THEN RAISE EXCEPTION 'Pedido nao pertence a rota'; END IF;
 IF v_status='entregue' THEN RETURN jsonb_build_object('ok',true,'ja_concluido',true); END IF;
 IF v_status<>'em_rota' THEN RAISE EXCEPTION 'Pedido nao esta em rota'; END IF;
 UPDATE public.pedidos SET status='entregue',atualizado_em=now() WHERE id=p_pedido_id AND empresa_id=v_rota.empresa_id AND status='em_rota';
 SELECT count(*) INTO v_restantes FROM public.rota_paradas rp JOIN public.pedidos p ON p.id=rp.pedido_id AND p.empresa_id=v_rota.empresa_id WHERE rp.rota_id=p_rota_id AND rp.empresa_id=v_rota.empresa_id AND p.status='em_rota';
 IF v_restantes=0 THEN UPDATE public.rotas SET status='concluida' WHERE id=p_rota_id AND status IN ('enviada','em_andamento'); END IF;
 RETURN jsonb_build_object('ok',true,'restantes',v_restantes);
END $$;
REVOKE ALL ON FUNCTION public.rota_confirmar_entrega_painel(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rota_confirmar_entrega_painel(uuid,uuid) TO authenticated;
