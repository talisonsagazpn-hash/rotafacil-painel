import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY} from './config.js';
const sb=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true}});
const $=id=>document.getElementById(id);const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let state={user:null,empresa:null,lojas:[],motoboys:[],pedidos:[],rotas:[],paradas:[],localizacoes:[],page:'inicio',selected:new Set(),map:null,markers:[]};
const statusName={pendente:'Pendente',em_rota:'Em rota',entregue:'Entregue',cancelado:'Cancelado',rascunho:'Rascunho',enviada:'Enviada',em_andamento:'Em andamento',concluida:'Concluída',cancelada:'Cancelada'};
const badge=s=>`<span class="status ${esc(s)}">${esc(statusName[s]||s)}</span>`;
const fmt=d=>d?new Date(d).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';
function toast(t,bad=false){const el=$('toast');el.textContent=t;el.style.display='block';el.style.borderColor=bad?'#b34c52':'#2b7c4d';clearTimeout(toast.t);toast.t=setTimeout(()=>el.style.display='none',5000)}
function errorText(e){return e?.message||String(e)}
async function fetchAll(){if(!state.empresa)return;const eid=state.empresa.id;const queries=await Promise.all([
 sb.from('lojas').select('*').eq('empresa_id',eid).order('criada_em'),sb.from('motoboys').select('*').eq('empresa_id',eid).order('criado_em'),sb.from('pedidos').select('*').eq('empresa_id',eid).order('criado_em',{ascending:false}).limit(500),sb.from('rotas').select('*').eq('empresa_id',eid).order('criada_em',{ascending:false}).limit(150),sb.from('rota_paradas').select('*').eq('empresa_id',eid).limit(1000),sb.from('localizacoes_motoboy').select('*').eq('empresa_id',eid)]);
 const names=['lojas','motoboys','pedidos','rotas','paradas','localizacoes'];let err=[];queries.forEach((r,i)=>{if(r.error)err.push(`${names[i]}: ${r.error.message}`);else state[names[i]]=r.data||[]});$('connection').textContent=err.length?'● Erro de conexão':'● Conectado';if(err.length)toast(err.join(' | '),true);render()}
async function start(){
 if(recoveryMode)return;
 const {data:authData,error:authError}=await sb.auth.getUser();
 const user=authData?.user;
 if(authError||!user){
  state.user=null;state.empresa=null;
  $('login').classList.remove('hidden');$('app').classList.add('hidden');
  if(authError)$('loginError').textContent='Erro de autenticação: '+errorText(authError);
  return;
 }
 state.user=user;
 // Consultas separadas: um erro de relacionamento não pode parecer ausência de cadastro.
 const membership=await sb.from('membros').select('empresa_id,papel,ativo')
   .eq('usuario_id',user.id).eq('ativo',true)
   .in('papel',['proprietario','gerente','atendente']).limit(1);
 if(membership.error){
  showAccessError('Erro ao consultar seu vínculo com a empresa: '+errorText(membership.error));
  return;
 }
 if(!membership.data?.length){
  showAccessError('Não foi encontrado vínculo ativo com permissão de acesso para esta conta. Confirme que entrou com o mesmo e-mail cadastrado na Empresa Piloto.');
  return;
 }
 const member=membership.data[0];
 const company=await sb.from('empresas').select('id,nome').eq('id',member.empresa_id).maybeSingle();
 if(company.error){
  showAccessError('Seu vínculo foi encontrado, mas não foi possível consultar a empresa: '+errorText(company.error));
  return;
 }
 if(!company.data){
  showAccessError('Seu vínculo foi encontrado, mas a empresa não está visível para sua conta. Verifique as políticas de leitura da tabela empresas.');
  return;
 }
 state.empresa=company.data;state.papel=member.papel;
 $('loginError').textContent='';
 $('companyName').textContent=state.empresa.nome;
 $('userName').textContent=user.email||'Administrador';
 $('login').classList.add('hidden');$('app').classList.remove('hidden');
 await fetchAll();
 if(!start.interval)start.interval=setInterval(()=>{if(state.user&&state.empresa)fetchAll()},10000);
}
function showAccessError(message){
 state.empresa=null;
 $('login').classList.remove('hidden');$('app').classList.add('hidden');
 $('loginError').textContent=message;
 console.warn('[Rota Fácil] Acesso ao painel:',message);
}
function options(rows){return rows.map(x=>`<option value="${esc(x.id)}">${esc(x.nome)}</option>`).join('')}
function table(rows,withAction=false){if(!rows.length)return '<div class="empty">Nenhum pedido encontrado.</div>';return `<table><thead><tr><th>Pedido</th><th>Cliente</th><th>Endereço</th><th>Status</th><th>Data</th>${withAction?'<th>Ação</th>':''}</tr></thead><tbody>${rows.map(p=>`<tr><td>#${esc(p.numero||p.id.slice(0,6))}</td><td>${esc(p.cliente_nome)}</td><td>${esc(p.endereco)}</td><td>${badge(p.status)}</td><td>${fmt(p.criado_em)}</td>${withAction?`<td>${p.status==='pendente'?`<button class="secondary" data-cancel="${esc(p.id)}">Cancelar</button>`:'—'}</td>`:''}</tr>`).join('')}</tbody></table>`}
function render(){const today=new Date().toLocaleDateString('sv-SE');const todayOrders=state.pedidos.filter(p=>new Date(p.criado_em).toLocaleDateString('sv-SE')===today);$('statOrders').textContent=todayOrders.length;$('statRoad').textContent=state.pedidos.filter(p=>p.status==='em_rota').length;$('statDone').textContent=todayOrders.filter(p=>p.status==='entregue').length;$('statPending').textContent=state.pedidos.filter(p=>p.status==='pendente').length;$('statDrivers').textContent=state.motoboys.filter(m=>m.ativo).length;$('recentOrders').innerHTML=table(state.pedidos.slice(0,7));$('recentRoutes').innerHTML=state.rotas.slice(0,5).map(r=>`<div class="route-item"><div><b>Rota #${r.id.slice(0,6)}</b><small>${fmt(r.criada_em)} · ${state.paradas.filter(p=>p.rota_id===r.id).length} pedidos</small></div>${badge(r.status)}</div>`).join('')||'<div class="empty">Nenhuma rota cadastrada</div>';$('recentDrivers').innerHTML=state.motoboys.map(m=>`<div class="driver-item">🏍️ ${esc(m.nome)} <small>${m.ativo?'Ativo':'Inativo'}</small></div>`).join('')||'<div class="empty">Nenhum motoboy</div>';
const term=$('orderSearch').value.toLowerCase(),filter=$('orderFilter').value;const filtered=state.pedidos.filter(p=>(!filter||p.status===filter)&&[p.cliente_nome,p.numero,p.endereco].some(v=>String(v||'').toLowerCase().includes(term)));$('ordersTable').innerHTML=table(filtered,true);$('routeStore').innerHTML=options(state.lojas);$('orderStore').innerHTML=options(state.lojas);$('routeDriver').innerHTML=options(state.motoboys.filter(m=>m.ativo));const store=$('routeStore').dataset.selected||state.lojas[0]?.id;if(store)$('routeStore').value=store;
const available=state.pedidos.filter(p=>p.status==='pendente'&&p.loja_id===$('routeStore').value);state.selected=new Set([...state.selected].filter(id=>available.some(p=>p.id===id)));$('routeCandidates').innerHTML=available.map(p=>`<label class="candidate"><input type="checkbox" data-pick="${esc(p.id)}" ${state.selected.has(p.id)?'checked':''}><div><b>#${esc(p.numero||p.id.slice(0,6))} — ${esc(p.cliente_nome)}</b><small>${esc(p.endereco)}</small></div></label>`).join('')||'<div class="empty">Não há pedidos pendentes nesta loja.</div>';$('selectedCount').textContent=`${state.selected.size} pedido(s) selecionado(s)`;$('routesList').innerHTML=state.rotas.map(r=>{const d=state.motoboys.find(m=>m.id===r.motoboy_id);return `<div class="route-item"><div><b>Rota #${r.id.slice(0,8)}</b><small>🏍️ ${esc(d?.nome||'Sem motoboy')} · ${state.paradas.filter(p=>p.rota_id===r.id).length} pedidos · ${fmt(r.criada_em)}</small></div>${badge(r.status)}</div>`}).join('')||'<div class="empty">Nenhuma rota enviada.</div>';
$('driversList').innerHTML=state.motoboys.map(m=>`<div class="panel"><h2>🏍️ ${esc(m.nome)}</h2><p class="muted">${m.ativo?'Cadastro ativo':'Inativo'}</p><p>${state.rotas.filter(r=>r.motoboy_id===m.id&&['enviada','em_andamento'].includes(r.status)).length} rota(s) aberta(s)</p></div>`).join('')||'<div class="empty">Nenhum motoboy cadastrado.</div>';renderMap()}
function renderMap(){if(state.page!=='mapa')return;if(!state.map){state.map=L.map('map').setView([-19.9167,-43.9345],12);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap contributors'}).addTo(state.map)}state.markers.forEach(m=>m.remove());state.markers=[];const bounds=[];$('mapDrivers').innerHTML=state.motoboys.map(m=>{const loc=state.localizacoes.find(l=>l.motoboy_id===m.id);if(loc&&loc.compartilhando){const fresh=Date.now()-new Date(loc.atualizado_em).getTime()<120000;const marker=L.marker([loc.latitude,loc.longitude]).addTo(state.map).bindPopup(`<b>${esc(m.nome)}</b><br>${fresh?'Localização recente':'Localização antiga'}<br>${fmt(loc.atualizado_em)}`);state.markers.push(marker);bounds.push([loc.latitude,loc.longitude]);return `<div class="map-driver"><strong>🏍️ ${esc(m.nome)}</strong><small>${fresh?'🟢 Sinal recente':'⚠️ Sinal antigo'} · ${fmt(loc.atualizado_em)}</small></div>`}return `<div class="map-driver"><strong>🏍️ ${esc(m.nome)}</strong><small>Sem localização compartilhada</small></div>`}).join('')||'<div class="empty">Nenhum motoboy</div>';if(bounds.length)state.map.fitBounds(bounds,{maxZoom:15,padding:[40,40]});setTimeout(()=>state.map.invalidateSize(),80)}
function page(name){state.page=name;document.querySelectorAll('.page').forEach(e=>e.classList.toggle('hidden',e.id!==`page-${name}`));document.querySelectorAll('.nav[data-page]').forEach(e=>e.classList.toggle('active',e.dataset.page===name));const titles={inicio:['Visão geral','Acompanhe as entregas da sua loja'],pedidos:['Pedidos','Cadastre e organize entregas'],rotas:['Rotas','Envie pedidos para o motoboy'],motoboys:['Motoboys','Equipe de entregadores'],mapa:['Mapa em tempo real','Acompanhe a posição dos entregadores']};$('pageTitle').textContent=titles[name][0];$('pageSubtitle').textContent=titles[name][1];render()}
async function saveOrder(ev){ev.preventDefault();const payload={empresa_id:state.empresa.id,loja_id:$('orderStore').value,numero:$('orderNumber').value.trim()||null,plataforma:$('orderPlatform').value,cliente_nome:$('orderClient').value.trim(),endereco:$('orderAddress').value.trim(),complemento:$('orderComplement').value.trim()||null,referencia:$('orderReference').value.trim()||null,localizador:$('orderLocator').value.trim()||null,latitude:$('orderLat').value?Number($('orderLat').value):null,longitude:$('orderLng').value?Number($('orderLng').value):null};const {error}=await sb.from('pedidos').insert(payload);if(error)return toast(errorText(error),true);$('orderDialog').close();$('orderForm').reset();toast('Pedido cadastrado com sucesso!');await fetchAll()}
async function sendRoute(){const ids=[...state.selected],driver=$('routeDriver').value,store=$('routeStore').value;if(!driver||!store||!ids.length)return toast('Selecione a loja, o motoboy e pelo menos um pedido.',true);const button=$('sendRoute');button.disabled=true;let created=null;try{const {data,error}=await sb.from('rotas').insert({empresa_id:state.empresa.id,loja_id:store,motoboy_id:driver,status:'enviada',enviada_em:new Date().toISOString()}).select('id').single();if(error)throw error;created=data.id;const stops=ids.map((id,i)=>({empresa_id:state.empresa.id,rota_id:created,pedido_id:id,ordem:i+1}));const inserted=await sb.from('rota_paradas').insert(stops);if(inserted.error)throw inserted.error;const updated=await sb.from('pedidos').update({status:'em_rota',atualizado_em:new Date().toISOString()}).in('id',ids).eq('empresa_id',state.empresa.id).eq('status','pendente').select('id');if(updated.error)throw updated.error;if(updated.data.length!==ids.length)throw new Error('Nem todos os pedidos puderam ser atualizados. Verifique a rota antes de reenviar.');state.selected.clear();toast('Rota registrada na nuvem! O envio ao celular depende da integração Android.');await fetchAll()}catch(e){toast(`Erro ao enviar rota: ${errorText(e)}${created?' (rota criada parcialmente; confira antes de tentar novamente)':''}`,true);await fetchAll()}finally{button.disabled=false}}
$('loginForm').addEventListener('submit',async e=>{e.preventDefault();$('loginError').textContent='';const {error}=await sb.auth.signInWithPassword({email:$('email').value,password:$('password').value});if(error){$('loginError').textContent=error.message;return}try{await start()}catch(err){$('loginError').textContent='Erro ao abrir painel: '+errorText(err)}});$('logout').onclick=async()=>{await sb.auth.signOut();state.user=null;state.empresa=null;location.reload()};$('nav').addEventListener('click',e=>{const b=e.target.closest('[data-page]');if(b)page(b.dataset.page)});document.addEventListener('click',e=>{const b=e.target.closest('[data-go]');if(b)page(b.dataset.go)});$('refresh').onclick=fetchAll;$('newOrder').onclick=$('quickOrder').onclick=()=>$('orderDialog').showModal();$('closeDialog').onclick=()=>$('orderDialog').close();$('orderForm').onsubmit=saveOrder;$('orderSearch').oninput=render;$('orderFilter').onchange=render;$('routeStore').onchange=e=>{e.target.dataset.selected=e.target.value;state.selected.clear();render()};$('routeCandidates').onchange=e=>{const id=e.target.dataset.pick;if(!id)return;e.target.checked?state.selected.add(id):state.selected.delete(id);$('selectedCount').textContent=`${state.selected.size} pedido(s) selecionado(s)`};$('sendRoute').onclick=sendRoute;$('ordersTable').onclick=async e=>{const id=e.target.closest('[data-cancel]')?.dataset.cancel;if(!id||!confirm('Cancelar este pedido?'))return;const {error}=await sb.from('pedidos').update({status:'cancelado',atualizado_em:new Date().toISOString()}).eq('id',id).eq('status','pendente');if(error)toast(errorText(error),true);else{toast('Pedido cancelado.');await fetchAll()}};// Recuperação de senha do Supabase (link enviado por e-mail).
let recoveryMode = false;
function showRecovery(){
  recoveryMode=true;
  $('login').classList.add('hidden');
  $('app').classList.add('hidden');
  $('resetScreen').classList.remove('hidden');
}
$('forgotPassword').addEventListener('click',async()=>{
  const email=$('email').value.trim();
  if(!email){$('loginError').textContent='Digite seu e-mail no campo acima e clique novamente em Esqueci minha senha.';return}
  $('loginError').textContent='Enviando link de recuperação...';
  const redirectTo=new URL('index.html',window.location.href).href;
  const {error}=await sb.auth.resetPasswordForEmail(email,{redirectTo});
  $('loginError').textContent=error?error.message:'Se o e-mail estiver cadastrado, você receberá um link para criar outra senha.';
});
$('resetForm').addEventListener('submit',async ev=>{
  ev.preventDefault();
  const pass=$('newPassword').value;
  if(pass!==$('confirmPassword').value){$('resetError').textContent='As senhas não são iguais.';return}
  $('resetError').textContent='Salvando...';
  const {error}=await sb.auth.updateUser({password:pass});
  if(error){$('resetError').textContent=error.message;return}
  $('resetError').textContent='Senha atualizada! Redirecionando para o painel...';
  recoveryMode=false;
  history.replaceState(null,'',location.pathname);
  $('resetScreen').classList.add('hidden');
  await start();
});
sb.auth.onAuthStateChange((event)=>{
  if(event==='PASSWORD_RECOVERY')showRecovery();
});
// Aguarda o Supabase processar os tokens da URL antes de exibir o login.
const recoveryLink=/[?#&](type=recovery|token_hash=|access_token=|code=)/.test(location.href);
if(recoveryLink){
  showRecovery();
  // PKCE e links inválidos podem não gerar sessão; exibir instrução em vez de aceitar senha sem sessão.
  sb.auth.getSession().then(({data:{session},error})=>{
    if(error||!session){
      $('resetError').textContent='Link inválido ou expirado. Volte à tela de login e solicite um novo e-mail.';
      $('resetForm').querySelector('button[type=submit]').disabled=true;
    }
  });
}else{start().catch(e=>toast(errorText(e),true));}

