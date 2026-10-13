import http from 'node:http';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:3,ssl:{rejectUnauthorized:true,ca:readFileSync(process.env.PG_CA_CERT_PATH,'utf8')}});
const release='source-v2';
const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>代码发布验收应用</title><style>body{font:18px system-ui;max-width:760px;margin:60px auto;padding:20px;background:#f7f8f4;color:#193f36}input,button{font:inherit;padding:12px}button{background:#204c40;color:white;border:0;border-radius:8px}li{margin:15px 0}</style><h1>代码发布验收应用 · 第二版</h1><p>本页来自独立 GitHub 仓库的真实代码。添加的验收记录在更新和恢复版本后保留。</p><form><input required maxlength="120" placeholder="输入一条验收记录"><button>添加记录</button></form><ul></ul><small>source-v2：新增记录数量和关键词筛选</small><script>async function load(){const r=await fetch('/api/checks');const d=await r.json();document.querySelector('ul').replaceChildren(...d.records.map(x=>{const li=document.createElement('li');li.textContent=x.title;return li}))}document.querySelector('form').onsubmit=async e=>{e.preventDefault();const input=document.querySelector('input');const r=await fetch('/api/checks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:input.value})});if(r.ok){input.value='';await load()}};load()</script></html>`;
http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://app');
 if(url.pathname==='/readyz'){await pool.query('SELECT 1');return json(res,200,{status:'ready'});}
 if(url.pathname==='/api/release')return json(res,200,{release,commitSha:process.env.SOURCE_COMMIT_SHA});
 if(url.pathname==='/api/checks'&&req.method==='GET'){const keyword=(url.searchParams.get('keyword')||'').slice(0,100);const {rows}=await pool.query('SELECT id,title,created_at FROM publishing_checks WHERE title ILIKE $1 ORDER BY created_at DESC LIMIT 100',['%'+keyword+'%']);return json(res,200,{release,count:rows.length,keyword,records:rows});}
 if(url.pathname==='/api/checks'&&req.method==='POST'){let text='';for await(const chunk of req){text+=chunk;if(text.length>2048)return json(res,413,{error:'too_large'});}const body=JSON.parse(text);if(typeof body.title!=='string'||!body.title.trim()||body.title.length>120)return json(res,400,{error:'invalid_title'});const {rows}=await pool.query('INSERT INTO publishing_checks(id,title) VALUES($1,$2) RETURNING id,title',[randomUUID(),body.title.trim()]);return json(res,201,rows[0]);}
 if(url.pathname==='/'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(html);}
 json(res,404,{error:'not_found'});
}catch{json(res,503,{error:'temporarily_unavailable'});}}).listen(Number(process.env.PORT||3000),'0.0.0.0');
