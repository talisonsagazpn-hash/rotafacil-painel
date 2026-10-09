import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY} from './config.js';
const sb=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true}});
const $=id=>document.getElementById(id);const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let state={user:null,empresa:null,lojas:[],motoboys:[],pedidos:[],rotas:[],paradas:[],localizacoes:[],page:'inicio',selected:new Set(),map:null,markers:[],routeLines:[],focusDriver:null,autoFit:true};
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
 if(!start.interval)start.interval=setInterval(()=>{if(state.user&&state.empresa)fetchAll()},5000);
}
function showAccessError(message){
 state.empresa=null;
 $('login').classList.remove('hidden');$('app').classList.add('hidden');
 $('loginError').textContent=message;
 console.warn('[Rota Fácil] Acesso ao painel:',message);
}
function options(rows){return rows.map(x=>`<option value="${esc(x.id)}">${esc(x.nome)}</option>`).join('')}
function table(rows,withAction=false){if(!rows.length)return '<div class="empty">Nenhum pedido encontrado.</div>';return `<table><thead><tr><th>Pedido</th><th>Cliente</th><th>Endereço</th><th>Status</th><th>Data</th>${withAction?'<th>Ação</th>':''}</tr></thead><tbody>${rows.map(p=>`<tr><td>#${esc(p.numero||p.id.slice(0,6))}</td><td>${esc(p.cliente_nome)}</td><td>${esc(p.endereco)}</td><td>${badge(p.status)}</td><td>${fmt(p.criado_em)}</td>${withAction?`<td>${p.status==='pendente'?`<button class="secondary" data-cancel="${esc(p.id)}">Cancelar</button>`:'—'}</td>`:''}</tr>`).join('')}</tbody></table>`}
function driverLoc(m){return state.localizacoes.find(l=>l.motoboy_id===m.id)}
function validLoc(loc){return !!loc&&Number.isFinite(Number(loc.latitude))&&Number.isFinite(Number(loc.longitude))&&Math.abs(Number(loc.latitude))<=90&&Math.abs(Number(loc.longitude))<=180}
function gpsAge(loc){const age=Date.now()-new Date(loc?.atualizado_em).getTime();return Number.isFinite(age)?Math.max(0,Math.floor(age/1000)):Infinity}
function gpsAgeLabel(loc){const seconds=gpsAge(loc);if(!Number.isFinite(seconds))return 'sem registro';return seconds<60?`${seconds} segundos`:`${Math.floor(seconds/60)} min ${seconds%60} s`}
function driverLive(loc){return validLoc(loc)&&loc.compartilhando===true&&gpsAge(loc)<45}
function driverUnstable(loc){return validLoc(loc)&&loc.compartilhando===true&&gpsAge(loc)>=45&&gpsAge(loc)<90}
function driverStatus(loc){return driverLive(loc)?'Online':driverUnstable(loc)?'Sinal instável':validLoc(loc)?'Offline · última posição':'Sem sinal'}
function activeDriverRoutes(m){return state.rotas.filter(r=>r.motoboy_id===m.id&&['enviada','em_andamento'].includes(r.status))}
function bikeIcon(live){return L.divIcon({className:'bike-pin-container',html:`<div class="bike-pin ${live?'bike-pin-online':'bike-pin-offline'}" aria-label="Motoboy ${live?'online':'offline'}">🏍️</div>`,iconSize:[38,38],iconAnchor:[19,19],popupAnchor:[0,-18]})}
function focusDriver(id){state.focusDriver=id;state.autoFit=true;page('mapa')}
function render(){const today=new Date().toLocaleDateString('sv-SE');const todayOrders=state.pedidos.filter(p=>new Date(p.criado_em).toLocaleDateString('sv-SE')===today);$('statOrders').textContent=todayOrders.length;$('statRoad').textContent=state.pedidos.filter(p=>p.status==='em_rota').length;$('statDone').textContent=todayOrders.filter(p=>p.status==='entregue').length;$('statPending').textContent=state.pedidos.filter(p=>p.status==='pendente').length;$('statDrivers').textContent=state.motoboys.filter(m=>m.ativo).length;$('recentOrders').innerHTML=table(state.pedidos.slice(0,7));$('recentRoutes').innerHTML=state.rotas.slice(0,5).map(r=>`<div class="route-item"><div><b>Rota #${r.id.slice(0,6)}</b><small>${fmt(r.criada_em)} · ${state.paradas.filter(p=>p.rota_id===r.id).length} pedidos</small></div>${badge(r.status)}</div>`).join('')||'<div class="empty">Nenhuma rota cadastrada</div>';$('recentDrivers').innerHTML=state.motoboys.map(m=>`<div class="driver-item">🏍️ ${esc(m.nome)} <small>${m.ativo?'Ativo':'Inativo'}</small></div>`).join('')||'<div class="empty">Nenhum motoboy</div>';
const term=$('orderSearch').value.toLowerCase(),filter=$('orderFilter').value;const filtered=state.pedidos.filter(p=>(!filter||p.status===filter)&&[p.cliente_nome,p.numero,p.endereco].some(v=>String(v||'').toLowerCase().includes(term)));$('ordersTable').innerHTML=table(filtered,true);$('routeStore').innerHTML=options(state.lojas);$('orderStore').innerHTML=options(state.lojas);$('routeDriver').innerHTML=options(state.motoboys.filter(m=>m.ativo));const store=$('routeStore').dataset.selected||state.lojas[0]?.id;if(store)$('routeStore').value=store;
const available=state.pedidos.filter(p=>p.status==='pendente'&&p.loja_id===$('routeStore').value);state.selected=new Set([...state.selected].filter(id=>available.some(p=>p.id===id)));$('routeCandidates').innerHTML=available.map(p=>`<label class="candidate"><input type="checkbox" data-pick="${esc(p.id)}" ${state.selected.has(p.id)?'checked':''}><div><b>#${esc(p.numero||p.id.slice(0,6))} — ${esc(p.cliente_nome)}</b><small>${esc(p.endereco)}</small></div></label>`).join('')||'<div class="empty">Não há pedidos pendentes nesta loja.</div>';$('selectedCount').textContent=`${state.selected.size} pedido(s) selecionado(s)`;$('routesList').innerHTML=state.rotas.map(r=>{const d=state.motoboys.find(m=>m.id===r.motoboy_id);return `<div class="route-item"><div><b>Rota #${r.id.slice(0,8)}</b><small>🏍️ ${esc(d?.nome||'Sem motoboy')} · ${state.paradas.filter(p=>p.rota_id===r.id).length} pedidos · ${fmt(r.criada_em)}</small></div>${badge(r.status)}</div>`}).join('')||'<div class="empty">Nenhuma rota enviada.</div>';
$('driverActions').classList.toggle('hidden',state.papel!=='proprietario');
$('driversList').innerHTML=state.motoboys.map(m=>{const loc=driverLoc(m),live=driverLive(loc),routes=activeDriverRoutes(m);return `<div class="panel driver-card"><div class="driver-card-head"><span class="driver-moto" aria-hidden="true">🏍️</span><div><h2>${esc(m.nome)}</h2><span class="driver-presence ${live?'is-online':'is-offline'}"><span class="presence-dot"></span>${driverStatus(loc)}</span></div></div><p class="muted">${validLoc(loc)?`Último GPS: há ${gpsAgeLabel(loc)} · ${fmt(loc.atualizado_em)}`:'Ainda não enviou localização'}</p><p>${routes.length} rota(s) aberta(s)</p><div class="driver-buttons"><button type="button" class="primary" data-driver-focus="${esc(m.id)}" ${validLoc(loc)?'':'disabled'}>📍 Ver no mapa</button>${state.papel==='proprietario'?`<button type="button" class="secondary" data-driver-code="${esc(m.id)}">Gerar novo código</button>`:''}</div></div>`}).join('')||'<div class="empty">Nenhum motoboy cadastrado.</div>' ;renderMap()}
function renderMap(){
 if(state.page!=='mapa')return;
 if(typeof window.L==='undefined'){
  $('map').innerHTML='<div class="map-notice">Não foi possível carregar o mapa. Verifique a internet ou o bloqueio da biblioteca Leaflet.</div>';
  $('mapDrivers').innerHTML='<div class="empty">Biblioteca do mapa indisponível.</div>';return;
 }
 if(!state.map){
  state.map=L.map('map').setView([-19.9167,-43.9345],12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap contributors'}).addTo(state.map);
  state.map.on('dragstart',()=>{state.autoFit=false});state.map.on('zoomstart',()=>{if(!state.programmaticFit)state.autoFit=false});
 }
 state.markers.forEach(x=>x.remove());state.markers=[];
 state.routeLines.forEach(x=>x.remove());state.routeLines=[];
 const focus=state.focusDriver;
 const selected=focus?state.motoboys.filter(m=>m.id===focus):state.motoboys;
 const bounds=[];
 $('mapFocusBanner').classList.toggle('hidden',!focus);
 if(focus){const m=state.motoboys.find(m=>m.id===focus);$('mapFocusName').textContent=m?`Acompanhando: ${m.nome}`:'Motoboy não encontrado'}
 $('mapDrivers').innerHTML=selected.map(m=>{
  const loc=driverLoc(m),valid=validLoc(loc),live=driverLive(loc),routes=activeDriverRoutes(m);
  const label=driverStatus(loc);
  if(valid){
   const marker=L.marker([Number(loc.latitude),Number(loc.longitude)],{icon:bikeIcon(live)}).addTo(state.map)
    .bindPopup(`<b>🏍️ ${esc(m.nome)}</b><br>${esc(label)}<br>Último GPS: há ${gpsAgeLabel(loc)} · ${fmt(loc.atualizado_em)}<br>${routes.length} rota(s) aberta(s)`);
   state.markers.push(marker);bounds.push([Number(loc.latitude),Number(loc.longitude)]);
  }
  let routeHtml='';
  for(const r of routes){
   const stops=state.paradas.filter(p=>p.rota_id===r.id).sort((a,b)=>Number(a.ordem)-Number(b.ordem));
   const points=stops.map(st=>state.pedidos.find(p=>p.id===st.pedido_id)).filter(p=>p&&Number.isFinite(Number(p.latitude))&&Number.isFinite(Number(p.longitude))&&p.latitude!=null&&p.longitude!=null&&Math.abs(Number(p.latitude))<=90&&Math.abs(Number(p.longitude))<=180).map(p=>[Number(p.latitude),Number(p.longitude)]);
   if(points.length){
    const coords=valid?[[Number(loc.latitude),Number(loc.longitude)],...points]:points;
    const line=L.polyline(coords,{color:'#1685e8',weight:4,opacity:.85,dashArray:'9 7'}).addTo(state.map);
    state.routeLines.push(line);bounds.push(...points);
    points.forEach((pt,i)=>{const marker=L.circleMarker(pt,{radius:10,color:'#fff',weight:2,fillColor:'#1685e8',fillOpacity:1}).addTo(state.map).bindTooltip(`Parada ${i+1}`);state.routeLines.push(marker)});
    routeHtml+=`<small>Rota #${esc(r.id.slice(0,8))}: ${points.length} parada(s) no mapa · linha indicativa, não navegação viária</small>`;
   }else routeHtml+=`<small>Rota #${esc(r.id.slice(0,8))}: sem coordenadas das paradas</small>`;
  }
  return `<div class="map-driver"><strong>🏍️ ${esc(m.nome)}</strong><span class="driver-presence ${live?'is-online':'is-offline'}"><span class="presence-dot"></span>${esc(label)}</span><small>${valid?'Último GPS: há '+gpsAgeLabel(loc)+' · '+fmt(loc.atualizado_em):'Sem localização registrada'}</small>${routeHtml}</div>`;
 }).join('')||'<div class="empty">Nenhum motoboy para mostrar.</div>';
 if(bounds.length&&state.autoFit){state.programmaticFit=true;state.map.fitBounds(bounds,{maxZoom:focus?16:15,padding:[40,40]});state.programmaticFit=false}
 setTimeout(()=>state.map?.invalidateSize(),100);
}

function page(name){if(name==='mapa'&&state.page!=='mapa')state.autoFit=true;state.page=name;document.querySelectorAll('.page').forEach(e=>e.classList.toggle('hidden',e.id!==`page-${name}`));document.querySelectorAll('.nav[data-page]').forEach(e=>e.classList.toggle('active',e.dataset.page===name));const titles={inicio:['Visão geral','Acompanhe as entregas da sua loja'],pedidos:['Pedidos','Cadastre e organize entregas'],rotas:['Rotas','Envie pedidos para o motoboy'],motoboys:['Motoboys','Equipe de entregadores'],mapa:['Mapa em tempo real','Acompanhe a posição dos entregadores']};$('pageTitle').textContent=titles[name][0];$('pageSubtitle').textContent=titles[name][1];render()}
async function saveOrder(ev){ev.preventDefault();const payload={empresa_id:state.empresa.id,loja_id:$('orderStore').value,numero:$('orderNumber').value.trim()||null,plataforma:$('orderPlatform').value,cliente_nome:$('orderClient').value.trim(),endereco:$('orderAddress').value.trim(),complemento:$('orderComplement').value.trim()||null,referencia:$('orderReference').value.trim()||null,localizador:$('orderLocator').value.trim()||null,latitude:$('orderLat').value?Number($('orderLat').value):null,longitude:$('orderLng').value?Number($('orderLng').value):null};const {error}=await sb.from('pedidos').insert(payload);if(error)return toast(errorText(error),true);$('orderDialog').close();$('orderForm').reset();toast('Pedido cadastrado com sucesso!');await fetchAll()}
async function sendRoute(){const ids=[...state.selected],driver=$('routeDriver').value,store=$('routeStore').value;if(!driver||!store||!ids.length)return toast('Selecione a loja, o motoboy e pelo menos um pedido.',true);const button=$('sendRoute');button.disabled=true;let created=null;try{const {data,error}=await sb.from('rotas').insert({empresa_id:state.empresa.id,loja_id:store,motoboy_id:driver,status:'enviada',enviada_em:new Date().toISOString()}).select('id').single();if(error)throw error;created=data.id;const stops=ids.map((id,i)=>({empresa_id:state.empresa.id,rota_id:created,pedido_id:id,ordem:i+1}));const inserted=await sb.from('rota_paradas').insert(stops);if(inserted.error)throw inserted.error;const updated=await sb.from('pedidos').update({status:'em_rota',atualizado_em:new Date().toISOString()}).in('id',ids).eq('empresa_id',state.empresa.id).eq('status','pendente').select('id');if(updated.error)throw updated.error;if(updated.data.length!==ids.length)throw new Error('Nem todos os pedidos puderam ser atualizados. Verifique a rota antes de reenviar.');state.selected.clear();toast('Rota registrada na nuvem! O envio ao celular depende da integração Android.');await fetchAll()}catch(e){toast(`Erro ao enviar rota: ${errorText(e)}${created?' (rota criada parcialmente; confira antes de tentar novamente)':''}`,true);await fetchAll()}finally{button.disabled=false}}

// A geração ocorre exclusivamente em função SQL autorizada, nunca no navegador.
function showDriverCode(code){$('driverCode').textContent=code;$('driverCodeResult').classList.remove('hidden')}
$('driverForm').addEventListener('submit',async ev=>{
 ev.preventDefault();const nome=$('driverName').value.trim();if(nome.length<2)return toast('Informe o nome completo do motoboy.',true);
 const btn=$('driverForm').querySelector('button');btn.disabled=true;
 try{const {data,error}=await sb.rpc('rota_cadastrar_motoboy',{p_empresa:state.empresa.id,p_nome:nome});if(error)throw error;
 $('driverForm').reset();showDriverCode(data.codigo);toast('Motoboy cadastrado no Supabase. Guarde o código.');await fetchAll();
 }catch(e){toast('Cadastro não concluído: '+errorText(e),true)}finally{btn.disabled=false}
});
$('driversList').addEventListener('click',async ev=>{
 const id=ev.target.closest('[data-driver-code]')?.dataset.driverCode;if(!id)return;
 const motoboy=state.motoboys.find(m=>m.id===id);if(!motoboy||!confirm(`Gerar novo código para ${motoboy.nome}? O código anterior será invalidado.`))return;
 const btn=ev.target.closest('button');btn.disabled=true;
 try{const {data,error}=await sb.rpc('rota_gerar_codigo_motoboy',{p_empresa:state.empresa.id,p_motoboy:id});if(error)throw error;showDriverCode(data.codigo);toast('Novo código gerado.');}
 catch(e){toast('Não foi possível gerar o código: '+errorText(e),true)}finally{btn.disabled=false}
});
$('copyDriverCode').onclick=async()=>{try{await navigator.clipboard.writeText($('driverCode').textContent);toast('Código copiado.')}catch(e){toast('Selecione e copie o código manualmente.',true)}};

$('loginForm').addEventListener('submit',async e=>{e.preventDefault();$('loginError').textContent='';const {error}=await sb.auth.signInWithPassword({email:$('email').value,password:$('password').value});if(error){$('loginError').textContent=error.message;return}try{await start()}catch(err){$('loginError').textContent='Erro ao abrir painel: '+errorText(err)}});$('logout').onclick=async()=>{await sb.auth.signOut();state.user=null;state.empresa=null;location.reload()};$('nav').addEventListener('click',e=>{const b=e.target.closest('[data-page]');if(b)page(b.dataset.page)});document.addEventListener('click',e=>{const b=e.target.closest('[data-go]');if(b)page(b.dataset.go)});$('refresh').onclick=fetchAll;$('driversList').addEventListener('click',e=>{const b=e.target.closest('[data-driver-focus]');if(b)focusDriver(b.dataset.driverFocus)});$('showAllDrivers').onclick=()=>{state.focusDriver=null;state.autoFit=true;renderMap()};$('newOrder').onclick=$('quickOrder').onclick=()=>$('orderDialog').showModal();$('closeDialog').onclick=()=>$('orderDialog').close();$('orderForm').onsubmit=saveOrder;$('orderSearch').oninput=render;$('orderFilter').onchange=render;$('routeStore').onchange=e=>{e.target.dataset.selected=e.target.value;state.selected.clear();render()};$('routeCandidates').onchange=e=>{const id=e.target.dataset.pick;if(!id)return;e.target.checked?state.selected.add(id):state.selected.delete(id);$('selectedCount').textContent=`${state.selected.size} pedido(s) selecionado(s)`};$('sendRoute').onclick=sendRoute;$('ordersTable').onclick=async e=>{const id=e.target.closest('[data-cancel]')?.dataset.cancel;if(!id||!confirm('Cancelar este pedido?'))return;const {error}=await sb.from('pedidos').update({status:'cancelado',atualizado_em:new Date().toISOString()}).eq('id',id).eq('status','pendente');if(error)toast(errorText(error),true);else{toast('Pedido cancelado.');await fetchAll()}};// Recuperação de senha do Supabase (link enviado por e-mail).
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

