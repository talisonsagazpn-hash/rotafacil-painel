// Supabase Edge Function. Deploy with JWT verification disabled because the app uses a publishable key.
// The device token is verified server-side against the active access record.
import { createClient } from 'npm:@supabase/supabase-js@2';
Deno.serve(async (req) => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const body = await req.json();
    const token = String(body.dispositivo ?? '');
    const app = String(body.aplicativo ?? '');
    const canal = String(body.canal ?? '');
    if (token.length < 32 || token.length > 200 || !['master','funcionario'].includes(app) || !['teste','producao'].includes(canal)) return json({ error: 'Parâmetros inválidos' }, 400);
    const bytes = new TextEncoder().encode(token);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hash = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2,'0')).join('');
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const { data: access, error: accessError } = await admin.from('acessos_motoboy').select('motoboy_id,empresa_id,ativo').eq('dispositivo_hash',hash).eq('ativo',true).limit(1).maybeSingle();
    if (accessError || !access) return json({ error: 'Aparelho não autorizado' }, 403);
    const { data: motoboy } = await admin.from('motoboys').select('id').eq('id',access.motoboy_id).eq('empresa_id',access.empresa_id).eq('ativo',true).maybeSingle();
    if (!motoboy) return json({ error: 'Motoboy inativo' }, 403);
    const { data: versions, error: versionsError } = await admin.from('app_atualizacoes')
      .select('versao,version_code,notas,arquivo_path,publicada_em,obrigatoria')
      .eq('aplicativo',app).eq('canal',canal).order('version_code',{ascending:false}).limit(1);
    if (versionsError) throw versionsError;
    const v = versions?.[0];
    if (!v) return json({ version_code: 0, versao: '', notas: '', download_url: '' });
    const { data: signed, error: signError } = await admin.storage.from('rota-facil-apks').createSignedUrl(v.arquivo_path, 600);
    if (signError || !signed?.signedUrl) throw signError ?? new Error('Falha ao assinar APK');
    return json({ version_code: v.version_code, versao: v.versao, notas: v.notas, obrigatoria: v.obrigatoria, download_url: signed.signedUrl });
  } catch (e) { return json({ error: 'Erro ao consultar atualização', detail: String(e).slice(0,120) }, 500); }
});
