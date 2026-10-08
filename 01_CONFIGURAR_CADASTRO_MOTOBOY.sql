-- ROTA FÁCIL V0.2.3 - executar UMA VEZ no SQL Editor como administrador.
-- A loja usa o painel para todos os cadastros seguintes.
-- A criação de senha e vínculo do aparelho ainda não está implementada.
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.ativacoes_motoboy (
 motoboy_id uuid primary key references public.motoboys(id) on delete cascade,
 empresa_id uuid not null references public.empresas(id),
 codigo_hash text not null,
 expira_em timestamptz not null,
 usado_em timestamptz,
 criado_em timestamptz not null default now()
);
revoke all on public.ativacoes_motoboy from public, anon, authenticated;
alter table public.ativacoes_motoboy enable row level security;
-- Sem políticas: a tabela não pode ser lida diretamente pelo navegador.

create or replace function public.rota_gerar_codigo_motoboy(p_empresa uuid, p_motoboy uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_codigo text;
begin
 if auth.uid() is null or not exists (
  select 1 from public.membros m where m.empresa_id=p_empresa and m.usuario_id=auth.uid()
   and m.ativo=true and m.papel='proprietario'
 ) then raise exception 'Sem permissão para administrar motoboys'; end if;
 if not exists (select 1 from public.motoboys m where m.id=p_motoboy and m.empresa_id=p_empresa and m.ativo=true)
 then raise exception 'Motoboy não encontrado ou inativo'; end if;
 v_codigo:=upper(encode(extensions.gen_random_bytes(9),'hex'));
 insert into public.ativacoes_motoboy(motoboy_id,empresa_id,codigo_hash,expira_em,usado_em,criado_em)
 values(p_motoboy,p_empresa,encode(extensions.digest(v_codigo,'sha256'),'hex'),now()+interval '24 hours',null,now())
 on conflict(motoboy_id) do update set codigo_hash=excluded.codigo_hash,expira_em=excluded.expira_em,
 usado_em=null,criado_em=now();
 return jsonb_build_object('codigo',v_codigo,'motoboy_id',p_motoboy);
end $$;

create or replace function public.rota_cadastrar_motoboy(p_empresa uuid,p_nome text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_result jsonb;
begin
 if auth.uid() is null or not exists (
  select 1 from public.membros m where m.empresa_id=p_empresa and m.usuario_id=auth.uid()
   and m.ativo=true and m.papel='proprietario'
 ) then raise exception 'Sem permissão para cadastrar motoboys'; end if;
 if length(btrim(coalesce(p_nome,'')))<2 or length(btrim(p_nome))>100 then
 raise exception 'Nome inválido'; end if;
 insert into public.motoboys(empresa_id,nome,ativo)
 values(p_empresa,btrim(p_nome),true) returning id into v_id;
 v_result:=public.rota_gerar_codigo_motoboy(p_empresa,v_id);
 return v_result;
end $$;

revoke all on function public.rota_cadastrar_motoboy(uuid,text) from public,anon;
revoke all on function public.rota_gerar_codigo_motoboy(uuid,uuid) from public,anon;
grant execute on function public.rota_cadastrar_motoboy(uuid,text) to authenticated;
grant execute on function public.rota_gerar_codigo_motoboy(uuid,uuid) to authenticated;
