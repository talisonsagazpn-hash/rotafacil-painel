-- Rota Fácil: executar no SQL Editor com acesso de administrador.
-- Não exclui fisicamente entregas; versões antigas permanecem auditáveis.
BEGIN;
ALTER TABLE public.historico_entregas_motoboy ADD COLUMN IF NOT EXISTS excluido_em timestamptz;
ALTER TABLE public.historico_entregas_motoboy ADD COLUMN IF NOT EXISTS exclusao_motivo text;
CREATE TABLE IF NOT EXISTS public.rota_auditoria_historico (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 registrado_em timestamptz NOT NULL DEFAULT now(),
 motoboy_id uuid NOT NULL,
 empresa_id uuid NOT NULL,
 local_id text NOT NULL,
 remote_pedido_id text,
 acao text NOT NULL,
 origem text,
 detalhes jsonb
);
ALTER TABLE public.rota_auditoria_historico ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rota_auditoria_historico FROM PUBLIC,anon,authenticated;
CREATE TABLE IF NOT EXISTS public.rota_historico_bloqueios (
 motoboy_id uuid NOT NULL, remote_pedido_id text NOT NULL,
 excluido_em timestamptz NOT NULL DEFAULT now(), motivo text,
 PRIMARY KEY(motoboy_id,remote_pedido_id)
);
-- Impede que o pedido #83, já removido manualmente, reapareça no próximo backup.
INSERT INTO public.rota_historico_bloqueios(motoboy_id,remote_pedido_id,motivo)
SELECT id,'799b0c20-2ea4-43ce-bfdd-2cb690b7c009','Pedido #83 não reconhecido, removido pelo administrador'
FROM public.motoboys WHERE id='01beb5c0-edbf-478d-a556-84e5b4bdceeb'
ON CONFLICT DO NOTHING;
ALTER TABLE public.rota_historico_bloqueios ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rota_historico_bloqueios FROM PUBLIC,anon,authenticated;
-- Marca versões redundantes como inativas, preferindo entrega finalizada e registro recente.
WITH ranked AS (
 SELECT motoboy_id,local_id,
 row_number() OVER (PARTITION BY motoboy_id,dados->>'remotePedidoId'
 ORDER BY CASE WHEN dados->>'delivered'='true' OR dados->>'cancelled'='true' THEN 1 ELSE 0 END DESC,
 atualizado_em DESC,local_id DESC) AS pos
 FROM public.historico_entregas_motoboy
 WHERE nullif(dados->>'remotePedidoId','') IS NOT NULL AND excluido_em IS NULL
)
UPDATE public.historico_entregas_motoboy h
SET excluido_em=now(),exclusao_motivo='Versão redundante: consolidada por remotePedidoId'
FROM ranked r WHERE h.motoboy_id=r.motoboy_id AND h.local_id=r.local_id AND r.pos>1;
CREATE UNIQUE INDEX IF NOT EXISTS rota_historico_pedido_ativo_unico
 ON public.historico_entregas_motoboy(motoboy_id,(dados->>'remotePedidoId'))
 WHERE excluido_em IS NULL AND nullif(dados->>'remotePedidoId','') IS NOT NULL;
CREATE OR REPLACE FUNCTION public.rota_historico_auditar()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO public.rota_auditoria_historico(motoboy_id,empresa_id,local_id,remote_pedido_id,acao,origem,detalhes)
 VALUES(NEW.motoboy_id,NEW.empresa_id,NEW.local_id,NEW.dados->>'remotePedidoId',
 CASE WHEN TG_OP='INSERT' THEN 'criado' WHEN OLD.excluido_em IS NULL AND NEW.excluido_em IS NOT NULL THEN 'excluido' WHEN OLD.dados->>'delivered' IS DISTINCT FROM NEW.dados->>'delivered' AND NEW.dados->>'delivered'='true' THEN 'finalizado' WHEN OLD.dados->>'cancelled' IS DISTINCT FROM NEW.dados->>'cancelled' AND NEW.dados->>'cancelled'='true' THEN 'cancelado' ELSE 'atualizado' END,
 coalesce(nullif(current_setting('rota.origem',true),''),'supabase'),
 jsonb_build_object('antes',CASE WHEN TG_OP='INSERT' THEN NULL ELSE OLD.dados END,'depois',NEW.dados));
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_rota_historico_auditar ON public.historico_entregas_motoboy;
CREATE TRIGGER trg_rota_historico_auditar AFTER INSERT OR UPDATE ON public.historico_entregas_motoboy
FOR EACH ROW EXECUTE FUNCTION public.rota_historico_auditar();
-- Mantém o contrato atual do Android, mas impede reinserção de pedidos excluídos.
CREATE OR REPLACE FUNCTION public.rota_backup_entregas(p_dispositivo text,p_registros jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_motoboy uuid;v_empresa uuid;v_item jsonb;v_count int:=0;v_remote text;v_local text;v_data jsonb;
BEGIN
 IF p_dispositivo IS NULL OR length(p_dispositivo)<32 THEN RAISE EXCEPTION 'Dispositivo invalido'; END IF;
 SELECT a.motoboy_id,a.empresa_id INTO v_motoboy,v_empresa
 FROM public.acessos_motoboy a JOIN public.motoboys m ON m.id=a.motoboy_id
 WHERE a.dispositivo_hash=encode(extensions.digest(p_dispositivo,'sha256'),'hex')
 AND a.ativo=true AND m.ativo=true AND m.empresa_id=a.empresa_id;
 IF v_motoboy IS NULL THEN RAISE EXCEPTION 'Acesso nao autorizado'; END IF;
 IF p_registros IS NULL OR jsonb_typeof(p_registros)<>'array' OR jsonb_array_length(p_registros)>20 THEN RAISE EXCEPTION 'Lote invalido (maximo 20)'; END IF;
 PERFORM set_config('rota.origem','android:'||left(encode(extensions.digest(p_dispositivo,'sha256'),'hex'),12),true);
 FOR v_item IN SELECT value FROM jsonb_array_elements(p_registros) LOOP
  v_local=v_item->>'local_id';v_data=v_item->'dados';v_remote=nullif(v_data->>'remotePedidoId','');
  IF jsonb_typeof(v_data)<>'object' OR v_local !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Registro invalido'; END IF;
  IF v_remote IS NOT NULL AND EXISTS(SELECT 1 FROM public.rota_historico_bloqueios WHERE motoboy_id=v_motoboy AND remote_pedido_id=v_remote) THEN CONTINUE; END IF;
  -- Mesmo pedido remoto sempre atualiza a mesma linha ativa, independentemente do local_id.
  IF v_remote IS NOT NULL THEN
   UPDATE public.historico_entregas_motoboy h SET dados=v_data,atualizado_em=now()
   WHERE h.motoboy_id=v_motoboy AND h.excluido_em IS NULL AND h.dados->>'remotePedidoId'=v_remote;
   IF FOUND THEN v_count=v_count+1;CONTINUE;END IF;
  END IF;
  INSERT INTO public.historico_entregas_motoboy(motoboy_id,empresa_id,local_id,dados)
  VALUES(v_motoboy,v_empresa,v_local,v_data)
  ON CONFLICT(motoboy_id,local_id) DO UPDATE SET dados=excluded.dados,atualizado_em=now()
  WHERE public.historico_entregas_motoboy.excluido_em IS NULL;
  v_count=v_count+1;
 END LOOP;
 RETURN jsonb_build_object('recebidos',v_count);
END $$;
REVOKE ALL ON FUNCTION public.rota_backup_entregas(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rota_backup_entregas(text,jsonb) TO anon,authenticated;
COMMIT;
-- Exclusão administrativa FUTURA: não usar DELETE físico. Inserir bloqueio e marcar
-- excluido_em no mesmo pedido/motoboy em uma transação autenticada e auditada.
