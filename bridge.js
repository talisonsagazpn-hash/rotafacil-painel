(()=>{'use strict';const ORIGIN=location.origin;let awaiting=new Map();
window.addEventListener('message',async e=>{if(e.source!==window||e.origin!==ORIGIN||e.data?.channel!=='ROTA_FACIL_PANEL')return;
if(e.data.type==='GET_QUEUE'){const r=await chrome.runtime.sendMessage({type:'GET_QUEUE'});window.postMessage({channel:'ROTA_FACIL_EXTENSION',type:'QUEUE',items:r.queue||[]},ORIGIN)}
if(e.data.type==='ACK'&&typeof e.data.id==='string')await chrome.runtime.sendMessage({type:'ACK',id:e.data.id,status:e.data.status});});
window.postMessage({channel:'ROTA_FACIL_EXTENSION',type:'READY'},ORIGIN);
})();