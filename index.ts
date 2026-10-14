import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const respond=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
serve(async(req)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method!=='POST')return respond({error:'Método inválido'},405);
 try{
  const supabaseUrl=Deno.env.get('SUPABASE_URL');const anon=Deno.env.get('SUPABASE_ANON_KEY');
  const authorization=req.headers.get('Authorization')||'';
  if(!authorization.startsWith('Bearer ')||!supabaseUrl||!anon)return respond({error:'Autenticação necessária'},401);
  const userRes=await fetch(supabaseUrl+'/auth/v1/user',{headers:{Authorization:authorization,apikey:anon}});
  if(!userRes.ok)return respond({error:'Sessão inválida'},401);
  const key=Deno.env.get('OPENAI_API_KEY');if(!key)return respond({error:'Configure OPENAI_API_KEY nos segredos do Supabase.'},503);
  const {image}=await req.json();
  if(typeof image!=='string'||!/^data:image\/(jpeg|jpg|png|webp);base64,/.test(image)||image.length>13_000_000)return respond({error:'Imagem inválida ou grande demais'},400);
  const schema={type:'object',additionalProperties:false,properties:{platform:{type:'string',enum:['ifood','99food','outro']},kind:{type:'string'},number:{type:'string'},created:{type:'string'},client:{type:'string'},fullAddress:{type:'string'},complement:{type:'string'},reference:{type:'string'},locator:{type:'string'},forecast:{type:'string'},total:{type:'string'},payment:{type:'string',enum:['pago','cobrar','indefinido']},products:{type:'array',items:{type:'string'}},transcription:{type:'string'}},required:['platform','kind','number','created','client','fullAddress','complement','reference','locator','forecast','total','payment','products','transcription']};
  const instructions=`Extraia dados desta foto de etiqueta de entrega brasileira. NÃO invente nada: campo ilegível = string vazia. A imagem pode estar girada. Regras: entrega parceira/entrega da loja/Olo NÃO é iFood; classifique como outro e kind 'Entrega da loja (Olo)'. iFood e 99Food somente quando claramente identificados. Pedido entre asteriscos como **** #1 **** significa número 1; ou PEDIDO #2493 significa 2493. Não confunda código adicional (D3449, I-1065) nem código de coleta com pedido/localizador. Localizador somente para iFood ou 99Food e apenas se explicitamente indicado como 'Localizador'. Para Olo, locator vazio. Valor total final do pedido, nunca subtotal nem taxa de motoboy. Pagamento pago quando diz já pago online/não cobrar; cobrar se indicado cobrar na entrega. Formate total em decimal brasileiro sem R$. Cliente sem prefixo Nome:. Endereço completo com rua, número, bairro e cidade, se visíveis. Produtos com quantidades, complementos e observações. Devolva JSON estruturado e transcrição do que está visível. Sem inferências.`;
  const api=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({model:'gpt-4o-mini',store:false,input:[{role:'user',content:[{type:'input_text',text:instructions},{type:'input_image',image_url:image,detail:'high'}]}],text:{format:{type:'json_schema',name:'etiqueta',strict:true,schema}},max_output_tokens:1400})});
  const payload=await api.json();if(!api.ok)return respond({error:'Erro da API de IA: '+(payload.error?.message||api.status)},502);
  const content=(payload.output||[]).flatMap((x:any)=>x.content||[]).find((x:any)=>x.type==='output_text')?.text;
  if(!content)return respond({error:'A IA não retornou dados estruturados.'},502);
  const result=JSON.parse(content);const transcription=result.transcription;delete result.transcription;
  return respond({result,transcription});
 }catch(e){return respond({error:String(e instanceof Error?e.message:e)},500)}
});
