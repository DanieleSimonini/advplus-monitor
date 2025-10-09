import { createClient } from '@supabase/supabase-js'

function decodeJwt(t: string){const p=t.split('.');if(p.length<2)return;try{const b=p[1].replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(p[1].length/4)*4,'=');return JSON.parse(Buffer.from(b,'base64').toString('utf8'))}catch{return}}
function isExpired(c?:{exp?:number}){if(!c?.exp)return false;return c.exp<Math.floor(Date.now()/1000)}
function cors(res:any){res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','authorization, x-client-info, apikey, content-type');res.setHeader('Access-Control-Max-Age','86400')}
function authHeader(h:any){const r=h?.authorization??h?.Authorization;return Array.isArray(r)?r.find(Boolean):r}
function bearer(h:string){const m=h.match(/^\s*bearer\s+(.+)$/i);return m?.[1]?.trim()}
async function readBody(req:any){if(typeof req.body!=='undefined')return req.body;return await new Promise((ok,ko)=>{const a:Buffer[]=[];req.on('data',(c:Buffer)=>a.push(Buffer.from(c))).on('end',()=>{if(!a.length)return ok(undefined);try{ok(Buffer.concat(a).toString('utf8'))}catch(e){ko(e)}}).on('error',ko)})}
async function parseBody(req:any){const b=await readBody(req);if(!b)return{};if(typeof b==='string'){const t=b.trim();if(!t)return{};try{return JSON.parse(t)}catch{const e:any=new Error('Invalid JSON body');e.status=400;throw e}}if(Buffer.isBuffer(b)){try{return JSON.parse(b.toString('utf8'))}catch{const e:any=new Error('Invalid JSON body');e.status=400;throw e}}if(typeof b==='object')return b as any;const e:any=new Error('Unsupported body format');e.status=400;throw e}

const URL=process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL||''
const ANON=process.env.SUPABASE_ANON_KEY||process.env.VITE_SUPABASE_ANON_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||''
const SRK=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SERVICE_KEY||''

export default async function handler(req:any,res:any){
  cors(res); if(req.method==='OPTIONS')return res.status(204).end()
  try{
    if(!URL||!ANON||!SRK) return res.status(500).json({error:'Missing Supabase env on server'})
    if(req.method!=='POST') return res.status(405).json({error:'Method Not Allowed'})

    const ah=authHeader(req.headers); if(!ah||!/^\s*bearer\s+/i.test(ah)) return res.status(401).json({error:'Missing bearer token'})
    const tok=bearer(ah); if(!tok) return res.status(401).json({error:'Invalid bearer token'})

    const {password}=await parseBody(req); if(!password||password.length<8) return res.status(400).json({error:'Password too short'})

    const c=decodeJwt(tok); if(!c?.sub||typeof c.sub!=='string') return res.status(401).json({error:'Invalid session token'})
    if(isExpired(c)) return res.status(401).json({error:'Session token expired'})

    const admin=createClient(URL, SRK, { auth:{persistSession:false, autoRefreshToken:false} })
    const { data: u, error: uErr } = await admin.auth.admin.getUserById(c.sub)
    if(uErr||!u?.user?.id){const s=typeof (uErr as any)?.status==='number'?(uErr as any).status:401;return res.status(s).json({error:uErr?.message||'User not found'})}

    const { error: upErr } = await admin.auth.admin.updateUserById(u.user.id, {
      password,
      ...(u.user.email_confirmed_at ? {} : { email_confirm: true }),
    })
    if(upErr){const s=typeof (upErr as any).status==='number'?((upErr as any).status??400):400;return res.status(s).json({error:upErr.message})}

    return res.status(200).json({ ok: true })
  }catch(e:any){
    const s=typeof e?.status==='number'?e.status:500
    return res.status(s).json({error:e?.message||String(e)})
  }
}
