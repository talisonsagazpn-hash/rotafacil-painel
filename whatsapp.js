(()=>{'use strict';let busy=false;
const eligible=t=>{const s=t.replace(/\s+/g,' ');return /(?:\d+º\s*Pedido\s*\(#?|Pedido\s*:\s*#?\d+)/i.test(t)&&/(?:Nome\s*:|Rua\s*:|Bairro\s*:|Localizador\s*:)/i.test(t)&&s.length>=45;};
async function hash(t){const bytes=new TextEncoder().encode(t);const h=await crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(h),b=>b.toString(16).padStart(2,'0')).join('');}
async function scan(){if(busy)return;busy=true;try{
// Apenas mensagens de saída disponíveis no DOM. Não percorre nem abre conversas privadas.
const nodes=[...document.querySelectorAll('.message-out')];for(const node of nodes){const textNode=node.querySelector('.copyable-text')||node;const text=(textNode.innerText||'').trim();if(!eligible(text))continue;
const meta=node.querySelector('[data-id]')?.getAttribute('data-id')||node.getAttribute('data-id')||'';
const id=await hash(location.hostname+'|'+meta+'|'+text);await chrome.runtime.sendMessage({type:'CAPTURE',item:{id,text,source:'whatsapp-web',capturedAt:new Date().toISOString()}});
}await chrome.storage.local.set({lastScan:new Date().toISOString()});}catch(e){console.warn('[Rota Fácil captura]',e)}finally{busy=false;}}
let timer;new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(scan,900)}).observe(document.documentElement,{childList:true,subtree:true});
chrome.runtime.onMessage.addListener(m=>{if(m.type==='SCAN')scan()});scan();setInterval(scan,12000);
})();