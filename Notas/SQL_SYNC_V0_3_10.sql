-- Executar somente depois de revisar em ambiente de testes.
-- Nao altera dados historicos nem cria lancamentos financeiros.
CREATE OR REPLACE FUNCTION public.rota_registrar_resultado_motoboy(
 p_dispositivo text, p_pedido_id uuid, p_rota_id uuid,
 p_status text, p_finalizado_em timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_motoboy uuid; v_empresa uuid; v_status text; v_restantes integer;
BEGIN
 IF p_dispositivo IS NULL OR length(p_dispositivo)<16 THEN RAISE EXCEPTION 'Dispositivo invalido'; END IF;
 IF p_status NOT IN ('entregue','cancelado') THEN RAISE EXCEPTION 'Resultado invalido'; END IF;
 SELECT a.motoboy_id,a.empresa_id INTO v_motoboy,v_empresa FROM public.acessos_motoboy a
 JOIN public.motoboys m ON m.id=a.motoboy_id AND m.empresa_id=a.empresa_id AND m.ativo=true
 WHERE a.dispositivo_hash=encode(extensions.digest(p_dispositivo,'sha256'),'hex') AND a.ativo=true LIMIT 1;
 IF v_motoboy IS NULL THEN RAISE EXCEPTION 'Dispositivo nao autorizado'; END IF;
 PERFORM 1 FROM public.rotas r WHERE r.id=p_rota_id AND r.empresa_id=v_empresa AND r.motoboy_id=v_motoboy FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Rota nao autorizada'; END IF;
 SELECT p.status INTO v_status FROM public.pedidos p JOIN public.rota_paradas rp
 ON rp.pedido_id=p.id AND rp.rota_id=p_rota_id AND rp.empresa_id=v_empresa
 WHERE p.id=p_pedido_id AND p.empresa_id=v_empresa FOR UPDATE OF p;
 IF v_status IS NULL THEN RAISE EXCEPTION 'Pedido fora da rota'; END IF;
 IF v_status=p_status THEN RETURN jsonb_build_object('ok',true,'ja_registrado',true); END IF;
 IF v_status<>'em_rota' THEN RAISE EXCEPTION 'Pedido ja possui outro resultado'; END IF;
 UPDATE public.pedidos SET status=p_status,atualizado_em=now() WHERE id=p_pedido_id AND empresa_id=v_empresa;
 SELECT count(*) INTO v_restantes FROM public.rota_paradas rp JOIN public.pedidos p ON p.id=rp.pedido_id AND p.empresa_id=v_empresa
 WHERE rp.rota_id=p_rota_id AND rp.empresa_id=v_empresa AND p.status='em_rota';
 IF v_restantes=0 THEN UPDATE public.rotas SET status='concluida' WHERE id=p_rota_id AND empresa_id=v_empresa AND status IN ('enviada','em_andamento');
 ELSE UPDATE public.rotas SET status='em_andamento' WHERE id=p_rota_id AND empresa_id=v_empresa AND status='enviada'; END IF;
 RETURN jsonb_build_object('ok',true,'restantes',v_restantes,'status',p_status);
END $$;

-- Mantem o nome da RPC do painel e adiciona cancelamento remunerado.
CREATE OR REPLACE FUNCTION public.rota_gerenciar_pedido(p_rota_id uuid,p_pedido_id uuid,p_acao text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_rota public.rotas%ROWTYPE; v_status text; v_restantes integer;
BEGIN
 IF p_acao NOT IN ('release','cancel','cancel_paid') THEN RAISE EXCEPTION 'Acao invalida'; END IF;
 SELECT * INTO v_rota FROM public.rotas WHERE id=p_rota_id FOR UPDATE;
 IF NOT FOUND OR v_rota.status NOT IN ('enviada','em_andamento') THEN RAISE EXCEPTION 'Rota nao esta ativa'; END IF;
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.membros m WHERE m.usuario_id=auth.uid() AND m.empresa_id=v_rota.empresa_id AND m.ativo=true AND m.papel IN ('proprietario','gerente','atendente')) THEN RAISE EXCEPTION 'Sem permissao'; END IF;
 SELECT p.status INTO v_status FROM public.pedidos p JOIN public.rota_paradas rp ON rp.pedido_id=p.id AND rp.rota_id=p_rota_id AND rp.empresa_id=v_rota.empresa_id WHERE p.id=p_pedido_id AND p.empresa_id=v_rota.empresa_id FOR UPDATE OF p;
 IF v_status IS NULL THEN RAISE EXCEPTION 'Pedido fora da rota'; END IF;
 IF v_status=CASE WHEN p_acao='release' THEN 'pendente' ELSE 'cancelado' END THEN RETURN jsonb_build_object('ok',true,'ja_registrado',true); END IF;
 IF v_status<>'em_rota' THEN RAISE EXCEPTION 'Pedido nao esta em rota'; END IF;
 UPDATE public.pedidos SET status=CASE WHEN p_acao='release' THEN 'pendente' ELSE 'cancelado' END,atualizado_em=now() WHERE id=p_pedido_id AND empresa_id=v_rota.empresa_id;
 SELECT count(*) INTO v_restantes FROM public.rota_paradas rp JOIN public.pedidos p ON p.id=rp.pedido_id AND p.empresa_id=v_rota.empresa_id WHERE rp.rota_id=p_rota_id AND rp.empresa_id=v_rota.empresa_id AND p.status='em_rota';
 IF v_restantes=0 THEN UPDATE public.rotas SET status='concluida' WHERE id=p_rota_id AND empresa_id=v_rota.empresa_id AND status IN ('enviada','em_andamento'); END IF;
 RETURN jsonb_build_object('ok',true,'acao',p_acao,'restantes',v_restantes);
END $$;

-- Consulta autorizada para espelhar resultados do painel no aplicativo.
CREATE OR REPLACE FUNCTION public.rota_status_pedidos_motoboy(p_dispositivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_motoboy uuid;v_empresa uuid;
BEGIN
 IF p_dispositivo IS NULL OR length(p_dispositivo)<16 THEN RAISE EXCEPTION 'Dispositivo invalido'; END IF;
 SELECT a.motoboy_id,a.empresa_id INTO v_motoboy,v_empresa FROM public.acessos_motoboy a JOIN public.motoboys m ON m.id=a.motoboy_id AND m.empresa_id=a.empresa_id AND m.ativo=true WHERE a.dispositivo_hash=encode(extensions.digest(p_dispositivo,'sha256'),'hex') AND a.ativo=true LIMIT 1;
 IF v_motoboy IS NULL THEN RAISE EXCEPTION 'Dispositivo nao autorizado'; END IF;
 RETURN jsonb_build_object('pedidos',COALESCE((SELECT jsonb_agg(jsonb_build_object('pedido_id',p.id,'status',p.status)) FROM public.pedidos p JOIN public.rota_paradas rp ON rp.pedido_id=p.id AND rp.empresa_id=v_empresa JOIN public.rotas r ON r.id=rp.rota_id AND r.empresa_id=v_empresa WHERE r.motoboy_id=v_motoboy AND p.empresa_id=v_empresa AND p.status IN ('entregue','cancelado','pendente')),'[]'::jsonb));
END $$;
