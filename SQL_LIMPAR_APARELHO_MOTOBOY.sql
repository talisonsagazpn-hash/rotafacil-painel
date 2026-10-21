-- Execute UMA VEZ no SQL Editor do Supabase antes de publicar o painel.
-- Revoga exclusivamente o vínculo do dispositivo do motoboy selecionado.
-- Não altera cadastro, senha, entregas, rotas ou financeiro.
CREATE OR REPLACE FUNCTION public.rota_limpar_aparelho_motoboy(
 p_empresa uuid,
 p_motoboy uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE v_qtd integer;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS (
   SELECT 1 FROM public.membros m
   WHERE m.usuario_id = auth.uid()
     AND m.empresa_id = p_empresa
     AND m.ativo = true
     AND m.papel = 'proprietario'
 ) THEN
   RAISE EXCEPTION 'Somente o proprietario pode limpar aparelhos';
 END IF;
 IF NOT EXISTS (
   SELECT 1 FROM public.motoboys m
   WHERE m.id = p_motoboy AND m.empresa_id = p_empresa
 ) THEN
   RAISE EXCEPTION 'Motoboy nao pertence a empresa';
 END IF;
 UPDATE public.acessos_motoboy a
 SET dispositivo_hash = encode(
   extensions.digest('desvinculado:' || gen_random_uuid()::text, 'sha256'),
   'hex'
 )
 WHERE a.motoboy_id = p_motoboy AND a.empresa_id = p_empresa;
 GET DIAGNOSTICS v_qtd = ROW_COUNT;
 IF v_qtd = 0 THEN
   RAISE EXCEPTION 'Nenhum acesso encontrado para o motoboy';
 END IF;
 UPDATE public.solicitacoes_acesso_motoboy s
 SET status = 'cancelado', atualizado_em = now()
 WHERE s.motoboy_id = p_motoboy
   AND s.empresa_id = p_empresa
   AND s.status = 'pendente';
 RETURN jsonb_build_object('ok',true,'motoboy_id',p_motoboy);
END;
$$;
REVOKE ALL ON FUNCTION public.rota_limpar_aparelho_motoboy(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rota_limpar_aparelho_motoboy(uuid,uuid) TO authenticated;
