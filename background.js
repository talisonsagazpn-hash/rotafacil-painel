const MAX=400;const get=k=>chrome.storage.local.get(k);const set=o=>chrome.storage.local.set(o);
chrome.runtime.onMessage.addListener((m,s,reply)=>{(async()=>{if(m.type==='CAPTURE'){
const x=await get(['queue','history','enabled']);if(x.enabled===false)return {ok:false,error:'Captura pausada'};
const queue=x.queue||[], history=x.history||[];if(queue.some(q=>q.id===m.item.id)||history.some(h=>h.id===m.item.id))return {ok:true,duplicate:true};
queue.push({...m.item,createdAt:new Date().toISOString()});await set({queue:queue.slice(-MAX),lastCapture:new Date().toISOString()});return {ok:true};}
if(m.type==='GET_QUEUE')return {ok:true,queue:(await get('queue')).queue||[]};
if(m.type==='ACK'){const x=await get(['queue','history']);const item=(x.queue||[]).find(q=>q.id===m.id);if(!item)return {ok:false};await set({queue:(x.queue||[]).filter(q=>q.id!==m.id),history:[...(x.history||[]),{id:item.id,createdAt:item.createdAt,doneAt:new Date().toISOString(),status:m.status||'importado'}].slice(-MAX)});return {ok:true};}
if(m.type==='STATUS')return await get(['queue','history','enabled','lastCapture','lastScan']);
if(m.type==='SCAN'){const tabs=await chrome.tabs.query({url:'https://web.whatsapp.com/*'});for(const t of tabs){try{await chrome.tabs.sendMessage(t.id,{type:'SCAN'})}catch{}}return {ok:true,tabs:tabs.length};}
return {ok:false};})().then(reply).catch(e=>reply({ok:false,error:e.message}));return true;});