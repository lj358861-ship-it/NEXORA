const express=require('express'),path=require('path'),bcrypt=require('bcryptjs'),jwt=require('jsonwebtoken'),{Pool}=require('pg');
const app=express(),PORT=process.env.PORT||3000,SECRET=process.env.JWT_SECRET||'change-me-in-railway';
if(!process.env.DATABASE_URL){console.error('DATABASE_URL manquant : ajoutez PostgreSQL sur Railway.');process.exit(1)}
if(process.env.NODE_ENV==='production'&&!process.env.JWT_SECRET){console.error('JWT_SECRET manquant.');process.exit(1)}
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.PGSSL==='true'?{rejectUnauthorized:false}:false});
const Q=(t,p)=>pool.query(t,p);
const h=fn=>(q,r)=>Promise.resolve(fn(q,r)).catch(e=>{console.error(e);r.status(500).json({error:'Erreur serveur'})});
async function init(){await Q(`
CREATE TABLE IF NOT EXISTS users(
 id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,hash TEXT NOT NULL,country TEXT DEFAULT 'CM',
 balance DOUBLE PRECISION NOT NULL DEFAULT 10000,positions JSONB NOT NULL DEFAULT '[]',verified BOOLEAN NOT NULL DEFAULT false,
 code_hash TEXT,code_exp BIGINT,tries INT NOT NULL DEFAULT 0,code_sent BIGINT,formation JSONB,admin_seen BIGINT NOT NULL DEFAULT 0,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS msgs(id SERIAL PRIMARY KEY,uid TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,from_ TEXT NOT NULL,text TEXT NOT NULL,t BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS msgs_uid ON msgs(uid,t);`)}
app.set('trust proxy',1);app.use(express.json());app.use(express.static(path.join(__dirname,'public'),{extensions:['html']}));
app.get('/health',(q,r)=>r.send('ok'));

// ---- Marché (prix en USD) ----
const CRYPTO=[['bitcoin','BTC','Bitcoin',65000],['ethereum','ETH','Ethereum',3200],['tether','USDT','Tether',1],['binancecoin','BNB','BNB',580],['solana','SOL','Solana',150],['ripple','XRP','XRP',0.55],['usd-coin','USDC','USD Coin',1],['cardano','ADA','Cardano',0.45],['dogecoin','DOGE','Dogecoin',0.15],['avalanche-2','AVAX','Avalanche',35],['tron','TRX','TRON',0.13],['polkadot','DOT','Polkadot',7],['chainlink','LINK','Chainlink',14],['litecoin','LTC','Litecoin',80],['toncoin','TON','Toncoin',6],['shiba-inu','SHIB','Shiba Inu',0.000018],['bitcoin-cash','BCH','Bitcoin Cash',400],['near','NEAR','NEAR Protocol',5],['uniswap','UNI','Uniswap',8],['stellar','XLM','Stellar',0.11],['monero','XMR','Monero',160],['cosmos','ATOM','Cosmos',6],['internet-computer','ICP','Internet Computer',9],['aptos','APT','Aptos',8],['filecoin','FIL','Filecoin',4.5],['arbitrum','ARB','Arbitrum',0.7],['optimism','OP','Optimism',1.8],['vechain','VET','VeChain',0.025],['algorand','ALGO','Algorand',0.13],['the-graph','GRT','The Graph',0.16]];
const STOCKS=[['AAPL','Apple','NASDAQ',225],['MSFT','Microsoft','NASDAQ',420],['NVDA','Nvidia','NASDAQ',120],['AMZN','Amazon','NASDAQ',185],['GOOGL','Alphabet','NASDAQ',170],['TSLA','Tesla','NASDAQ',250],['META','Meta','NASDAQ',560],['JPM','JPMorgan','NYSE',210],['KO','Coca-Cola','NYSE',65],['MC.PA','LVMH','Euronext Paris',680],['TTE.PA','TotalEnergies','Euronext Paris',60],['SAP.DE','SAP','Xetra',200],['SHEL.L','Shell','LSE',28],['7203.T','Toyota','Tokyo',2700],['NFLX','Netflix','NASDAQ',640],['AMD','AMD','NASDAQ',150],['V','Visa','NYSE',270],['WMT','Walmart','NYSE',70],['DIS','Disney','NYSE',95],['NKE','Nike','NYSE',80],['BA','Boeing','NYSE',170],['XOM','ExxonMobil','NYSE',115],['MCD',"McDonald's",'NYSE',290],['BABA','Alibaba','NYSE',85],['AIR.PA','Airbus','Euronext Paris',150],['OR.PA',"L'Oréal",'Euronext Paris',380],['SAN.PA','Sanofi','Euronext Paris',95],['BNP.PA','BNP Paribas','Euronext Paris',62],['SIE.DE','Siemens','Xetra',190],['BMW.DE','BMW','Xetra',85],['HSBA.L','HSBC','LSE',9],['005930.KS','Samsung','Séoul',55]];
const MACHINES=JSON.parse(require('fs').readFileSync(path.join(__dirname,'machines.json')));
let cache={t:0,c:null};
async function crypto_(){
  if(cache.c&&Date.now()-cache.t<60000)return cache.c;
  try{const r=await fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids='+CRYPTO.map(c=>c[0]).join(',')+'&sparkline=true&price_change_percentage=24h');
    if(!r.ok)throw 0;const j=await r.json();
    cache={t:Date.now(),c:CRYPTO.map(c=>{const x=j.find(y=>y.id===c[0]);return x?{id:c[0],sym:c[1],name:c[2],price:x.current_price,vol:x.total_volume||0,chg:x.price_change_percentage_24h||0,spark:(x.sparkline_in_7d?.price||[]).filter((_,i)=>i%4==0)}:fake(c)})};
  }catch(e){cache={t:Date.now()-50000,c:CRYPTO.map(fake)}}
  return cache.c;
}
function walk(p,n){let a=[],v=p*.95;for(let i=0;i<n;i++){v*=1+(Math.random()-.48)*.03;a.push(+v.toFixed(4))}a[n-1]=p;return a}
function fake(c){const p=c[3]*(1+(Math.random()-.5)*.02);return{id:c[0],sym:c[1],name:c[2],price:p,vol:c[3]*(2e5+Math.random()*2e6),chg:(Math.random()-.5)*6,spark:walk(p,42),demo:true}}
function stocks_(){return STOCKS.map(s=>{const p=s[3]*(1+(Math.random()-.5)*.01);return{id:s[0],sym:s[0],name:s[1],ex:s[2],price:p,chg:(Math.random()-.5)*4,spark:walk(p,42),demo:true}})}
app.get('/api/market',async(q,r)=>r.json({crypto:await crypto_(),stocks:stocks_(),machines:MACHINES}));

// ---- Comptes ----
const auth=h(async(q,r,n)=>{let c;try{c=jwt.verify((q.headers.authorization||'').slice(7),SECRET)}catch(e){return r.status(401).json({error:'Connexion requise'})}
  const{rows}=await Q('SELECT * FROM users WHERE id=$1',[c.id]);if(!rows[0])return r.status(401).json({error:'Connexion requise'});q.c=c;q.u=rows[0];n()});
const ADMIN=(process.env.ADMIN_EMAIL||'').toLowerCase(),EUR=1/0.92;
const pub=u=>({id:u.id,name:u.name,email:u.email,country:u.country,balance:u.balance,positions:u.positions,formation:u.formation||null});
const adm=(q,r,n)=>(ADMIN&&q.u.email===ADMIN&&q.c.adm===true)?n():r.status(403).json({error:'Admin uniquement'});
const byEmail=async e=>(await Q('SELECT * FROM users WHERE email=$1',[String(e||'').toLowerCase()])).rows[0];
async function mail(to,name,code){
  if(!process.env.BREVO_API_KEY){console.log('[DEV] code pour',to,':',code);return}
  const r=await fetch('https://api.brevo.com/v3/smtp/email',{method:'POST',headers:{'api-key':process.env.BREVO_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({sender:{name:process.env.BREVO_SENDER_NAME||'Nexora',email:process.env.BREVO_SENDER_EMAIL},to:[{email:to,name}],subject:'Votre code de vérification : '+code,htmlContent:`<div style="font-family:Arial;max-width:420px;margin:auto"><h2>Bienvenue ${name.replace(/</g,'')}</h2><p>Votre code de vérification :</p><p style="font-size:32px;letter-spacing:6px;font-weight:bold">${code}</p><p>Il expire dans 10 minutes. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.</p></div>`})});
  if(!r.ok){console.error('Brevo',r.status,await r.text().catch(()=>''));throw new Error('Envoi email impossible')}}
const newCode=()=>{const c=String(require('crypto').randomInt(100000,1000000));return{c,hash:bcrypt.hashSync(c,8),exp:Date.now()+600000,sent:Date.now()}};
app.post('/api/register',h(async(q,r)=>{const{name,email,password,country}=q.body||{};
  if(!name||!/^\S+@\S+\.\S+$/.test(email||'')||(password||'').length<6)return r.status(400).json({error:'Nom, email valide et mot de passe (6+ caractères) requis'});
  const em=email.toLowerCase();const old=await byEmail(em);
  if(old&&old.verified)return r.status(409).json({error:'Cet email existe déjà'});
  const k=newCode();try{await mail(em,name,k.c)}catch(e){return r.status(502).json({error:"Impossible d'envoyer l'email de vérification. Réessayez."})}
  if(old)await Q('UPDATE users SET name=$1,hash=$2,country=$3,code_hash=$4,code_exp=$5,code_sent=$6,tries=0 WHERE id=$7',[name,bcrypt.hashSync(password,10),country||'CM',k.hash,k.exp,k.sent,old.id]);
  else await Q('INSERT INTO users(id,name,email,hash,country,code_hash,code_exp,code_sent) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[Date.now().toString(36)+Math.random().toString(36).slice(2,6),name,em,bcrypt.hashSync(password,10),country||'CM',k.hash,k.exp,k.sent]);
  r.json({verify:true,email:em})}));
app.post('/api/verify',h(async(q,r)=>{const u=await byEmail(q.body.email);
  if(!u||u.verified||!u.code_hash)return r.status(400).json({error:'Code invalide'});
  if(Date.now()>+u.code_exp||u.tries>=5)return r.status(400).json({error:'Code expiré ou trop d\'essais. Demandez un nouveau code.'});
  if(!bcrypt.compareSync(String(q.body.code||''),u.code_hash)){await Q('UPDATE users SET tries=tries+1 WHERE id=$1',[u.id]);return r.status(400).json({error:'Code incorrect'})}
  const{rows}=await Q('UPDATE users SET verified=true,code_hash=NULL WHERE id=$1 RETURNING *',[u.id]);
  r.json({token:jwt.sign({id:u.id},SECRET,{expiresIn:'7d'}),user:pub(rows[0])})}));
app.post('/api/resend',h(async(q,r)=>{const u=await byEmail(q.body.email);
  if(u&&!u.verified&&Date.now()-(+u.code_sent||0)>60000){const k=newCode();try{await mail(u.email,u.name,k.c)}catch(e){return r.status(502).json({error:'Envoi impossible'})}
    await Q('UPDATE users SET code_hash=$1,code_exp=$2,code_sent=$3,tries=0 WHERE id=$4',[k.hash,k.exp,k.sent,u.id])}
  r.json({ok:1})}));
app.post('/api/login',h(async(q,r)=>{const u=await byEmail(q.body.email);
  if(!u||!bcrypt.compareSync(q.body.password||'',u.hash))return r.status(401).json({error:'Email ou mot de passe incorrect'});
  if(!u.verified)return r.status(403).json({error:'Email non vérifié',needVerify:true,email:u.email});
  r.json({token:jwt.sign({id:u.id},SECRET,{expiresIn:'7d'}),user:pub(u)})}));
app.get('/api/me',auth,(q,r)=>r.json(pub(q.u)));
// Investissement simulé (solde démo en USD) — aucun vrai paiement
app.post('/api/invest',auth,h(async(q,r)=>{const{kind,id,name,amount,price}=q.body||{},a=+amount;
  if(!(a>0))return r.status(400).json({error:'Montant invalide ou solde insuffisant'});
  const pos={kind,id,name,amount:a,price,date:new Date().toISOString()};
  const{rows}=await Q('UPDATE users SET balance=balance-$1,positions=positions||jsonb_build_array($2::jsonb) WHERE id=$3 AND balance>=$1 RETURNING *',[a,JSON.stringify(pos),q.u.id]);
  if(!rows[0])return r.status(400).json({error:'Montant invalide ou solde insuffisant'});r.json(pub(rows[0]))}));
app.post('/api/sell',auth,h(async(q,r)=>{const i=+q.body.index,c=await pool.connect();
  try{await c.query('BEGIN');const{rows}=await c.query('SELECT * FROM users WHERE id=$1 FOR UPDATE',[q.u.id]);const p=rows[0].positions[i];
    if(!p){await c.query('ROLLBACK');return r.status(400).json({error:'Position introuvable'})}
    const x=await c.query('UPDATE users SET balance=balance+$1,positions=positions-$2::int WHERE id=$3 RETURNING *',[p.amount,i,q.u.id]);
    await c.query('COMMIT');r.json(pub(x.rows[0]))}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e}finally{c.release()}}));
// ---- Accès admin séparé (/admin) : email + mot de passe + PIN, 5 essais max ----
const fails={};
app.post('/api/admin/login',h(async(q,r)=>{const f=fails[q.ip]||{n:0,t:0};if(f.n>=5&&Date.now()-f.t<900000)return r.status(429).json({error:'Trop d\'essais. Réessayez dans 15 minutes.'});
  const u=await byEmail(q.body.email),PIN=process.env.ADMIN_PIN;
  const ok=ADMIN&&u&&u.email===ADMIN&&u.verified&&bcrypt.compareSync(q.body.password||'',u.hash)&&PIN&&q.body.pin===PIN;
  if(!ok){f.n++;f.t=Date.now();fails[q.ip]=f;return r.status(401).json({error:'Identifiants incorrects'})}
  delete fails[q.ip];r.json({token:jwt.sign({id:u.id,adm:true},SECRET,{expiresIn:'12h'})})}));
// ---- Messagerie client <-> admin ----
const thread=async id=>(await Q('SELECT uid,from_ AS "from",text,t::float8 AS t FROM msgs WHERE uid=$1 ORDER BY id',[id])).rows;
const post=async(uid,from,text)=>{if(!text||String(text).length>1000)return;await Q('INSERT INTO msgs(uid,from_,text,t) VALUES($1,$2,$3,$4)',[uid,from,String(text),Date.now()])};
app.get('/api/chat',auth,h(async(q,r)=>r.json(await thread(q.u.id))));
app.post('/api/chat',auth,h(async(q,r)=>{await post(q.u.id,'user',q.body.text);r.json(await thread(q.u.id))}));
app.get('/api/admin/threads',auth,adm,h(async(q,r)=>{const{rows}=await Q(`SELECT u.id,u.name,u.email,u.country,u.formation,
  (SELECT row_to_json(m) FROM (SELECT uid,from_ AS "from",text,t::float8 AS t FROM msgs WHERE uid=u.id ORDER BY id DESC LIMIT 1) m) AS last,
  (SELECT count(*)::int FROM msgs WHERE uid=u.id AND from_='user' AND t>u.admin_seen) AS unread
  FROM users u WHERE u.email<>$1 AND u.verified ORDER BY (SELECT max(t) FROM msgs WHERE uid=u.id) DESC NULLS LAST`,[ADMIN]);
  r.json(rows.map(x=>({...x,formation:x.formation||null})))}));
app.get('/api/admin/chat/:id',auth,adm,h(async(q,r)=>{await Q('UPDATE users SET admin_seen=$1 WHERE id=$2',[Date.now(),q.params.id]);r.json(await thread(q.params.id))}));
app.post('/api/admin/chat/:id',auth,adm,h(async(q,r)=>{await post(q.params.id,'admin',q.body.text);r.json(await thread(q.params.id))}));
app.post('/api/admin/credit/:id',auth,adm,h(async(q,r)=>{const a=+q.body.usd;if(!a)return r.status(400).json({error:'Invalide'});
  const{rows}=await Q('UPDATE users SET balance=balance+$1 WHERE id=$2 RETURNING id',[a,q.params.id]);if(!rows[0])return r.status(400).json({error:'Invalide'});
  await post(rows[0].id,'admin','Votre compte a été crédité de '+a.toFixed(2)+' $.');r.json({ok:1})}));
app.post('/api/order',auth,h(async(q,r)=>{const{name,sym,amount,cur}=q.body||{},a=+amount;if(!(a>0))return r.status(400).json({error:'Montant invalide'});
  await post(q.u.id,'user',`Demande d'achat : actions ${String(name).slice(0,40)} (${String(sym).slice(0,14)}) pour environ ${a.toLocaleString('fr-FR')} ${String(cur).slice(0,4)}. Merci de me confirmer le prix et le mode de paiement.`);r.json(await thread(q.u.id))}));
// ---- Formation : 500 € ; bonus de 200 € crédité à la fin ----
app.post('/api/formation',auth,h(async(q,r)=>{let u=q.u;
  if(!u.formation){u=(await Q(`UPDATE users SET formation='{"status":"attente_paiement"}' WHERE id=$1 RETURNING *`,[u.id])).rows[0];await post(u.id,'user','Bonjour, je souhaite m\'inscrire à la formation (500 €). Comment puis-je payer ?')}
  r.json(pub(u))}));
app.post('/api/admin/formation/:id',auth,adm,h(async(q,r)=>{const u=(await Q('SELECT * FROM users WHERE id=$1',[q.params.id])).rows[0];if(!u||!u.formation)return r.status(400).json({error:'Aucune inscription'});
  const st=q.body.status,cur=u.formation.status;
  if(st==='payee'&&cur==='attente_paiement'){await Q(`UPDATE users SET formation='{"status":"payee"}' WHERE id=$1`,[u.id]);await post(u.id,'admin','Paiement de 500 € reçu. Votre formation est active.')}
  else if(st==='terminee'&&cur==='payee'){await Q(`UPDATE users SET formation='{"status":"terminee"}',balance=balance+$1 WHERE id=$2`,[200*EUR,u.id]);await post(u.id,'admin','Formation terminée : bonus de 200 € crédité sur votre solde.')}
  else return r.status(400).json({error:'Étape invalide'});r.json({ok:1})}));
init().then(()=>app.listen(PORT,()=>console.log('Nexora sur le port '+PORT))).catch(e=>{console.error('Init DB échouée',e);process.exit(1)});
