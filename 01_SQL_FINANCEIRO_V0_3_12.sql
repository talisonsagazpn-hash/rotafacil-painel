-- ROTA FACIL - FINANCEIRO POR MOTOBOY (NOVAS CORRIDAS)
-- Execute antes de publicar o painel V0.3.12.
-- Nao altera registros anteriores. Valor padrao por corrida: R$ 10,00.
-- Dinheiro do cliente NAO entra neste livro financeiro.
BEGIN;
CREATE TABLE IF NOT EXISTS public.financeiro_corridas_motoboy (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 empresa_id uuid NOT NULL REFERENCES public.empresas(id),
 motoboy_id uuid NOT NULL REFERENCES public.motoboys(id),
 pedido_id uuid NOT NULL REFERENCES public.pedidos(id),
 rota_id uuid NOT NULL REFERENCES public.rotas(id),
 resultado text NOT NULL CHECK(resultado IN ('entregue','cancelado_pago')),
 valor numeric(12,2) NOT NULL DEFAULT 10 CHECK(valor >= 0),
 registrado_em timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT financeiro_corrida_unica UNIQUE (pedido_id)
);
CREATE INDEX IF NOT EXISTS financeiro_corridas_empresa_data ON public.financeiro_corridas_motoboy(empresa_id,registrado_em DESC);
CREATE INDEX IF NOT EXISTS financeiro_corridas_motoboy_data ON public.financeiro_corridas_motoboy(motoboy_id,registrado_em DESC);
ALTER TABLE public.financeiro_corridas_motoboy ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS financeiro_corridas_leitura_empresa ON public.financeiro_corridas_motoboy;
CREATE POLICY financeiro_corridas_leitura_empresa ON public.financeiro_corridas_motoboy FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.membros m WHERE m.empresa_id=financeiro_corridas_motoboy.empresa_id AND m.usuario_id=auth.uid() AND m.ativo=true AND m.papel IN ('proprietario','gerente','atendente')));
-- Escrita somente por gatilho no servidor; nao liberar INSERT direto pelo navegador.
CREATE OR REPLACE FUNCTION public.rf_financeiro_registrar_entrega() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_rota record;
BEGIN
 IF NEW.status='entregue' AND OLD.status IS DISTINCT FROM 'entregue' THEN
   SELECT r.id,r.motoboy_id INTO v_rota
   FROM public.rota_paradas rp JOIN public.rotas r ON r.id=rp.rota_id AND r.empresa_id=rp.empresa_id
   WHERE rp.pedido_id=NEW.id AND rp.empresa_id=NEW.empresa_id AND r.motoboy_id IS NOT NULL
   ORDER BY r.criada_em DESC LIMIT 1;
   IF v_rota.id IS NOT NULL THEN
     INSERT INTO public.financeiro_corridas_motoboy(empresa_id,motoboy_id,pedido_id,rota_id,resultado,valor)
     VALUES(NEW.empresa_id,v_rota.motoboy_id,NEW.id,v_rota.id,'entregue',10)
     ON CONFLICT (pedido_id) DO NOTHING;
   END IF;
 END IF;
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS rf_financeiro_apos_status ON public.pedidos;
CREATE TRIGGER rf_financeiro_apos_status AFTER UPDATE OF status ON public.pedidos
FOR EACH ROW EXECUTE FUNCTION public.rf_financeiro_registrar_entrega();
COMMIT;
-- Nota: cancelamentos remunerados e corridas locais do Android precisam de integracao especifica.
-- Nao use pagamento_valor (total do cliente) como taxa do motoboy.
