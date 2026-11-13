// WP-16: prove di G7 "Particelle" (jsdom). Uso: node test-wp16.js [ripetizioni]
const {JSDOM}=require('jsdom'),fs=require('fs');
const html=fs.readFileSync('index.html','utf8');
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m)}else console.log('ok  ',m)};
function boot(done){
  const d=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x.test/',
    beforeParse(w){w.speechSynthesis={getVoices:()=>[],speak(){},cancel(){},addEventListener(){}};w.SpeechSynthesisUtterance=function(t){this.text=t};w.Element.prototype.scrollIntoView=function(){};
      w.localStorage.setItem('hira-done',JSON.stringify(done||[]));}});
  return d.window}
const K=[],mkDone=(upto)=>{const d=[];for(const k of ['K1','K2','K3','K4','K5','K6','K7']){const u=PATH.find(x=>x.id===k);d.push(u.to+':t')}
  ['G1','G2','G3','G4','G5','G6'].slice(0,upto).forEach(g=>d.push(g+':t'));return d};
var window0=boot([]);
const W0=window0, PATH=W0.eval("PATH"), GU=W0.eval("GU");
const idx=PATH.findIndex(u=>u.id==='G7');
ok(idx===PATH.findIndex(u=>u.id==='K7')+1&&PATH[idx+1].id==='K8','G7 è nella strada dopo K7 e prima di K8');
ok(PATH[idx].poi===17&&PATH[idx].min===90,'G7: poi 17, soglia 90');
ok(GU.G7.lessons.length===4,'4 lezioni');
const cards=GU.G7.lessons.flatMap(l=>l.teach);ok(cards.length===56,'56 schede ('+cards.length+')');
const all=Object.values(GU).flatMap(u=>u.lessons.flatMap(l=>l.teach.map(t=>t.jp)));
ok(new Set(all).size===all.length,'nessuna scheda doppia nel percorso');
ok(GU.G7.lessons.every(l=>l.ex.length===3),'3 mcq scritte a mano per lezione');
// sblocco
{const w=boot([]);ok(w.eval("gUnitLocked("+idx+")"),'G7 bloccata senza progressi');}
{const w=boot(mkDone(5));ok(w.eval("gUnitLocked("+idx+")"),'G7 bloccata senza la verifica di G6');}
{const w=boot(mkDone(6));ok(!w.eval("gUnitLocked("+idx+")"),'G7 aperta con K1-K7 e G1-G6');}
// bot
function bot(w,onDoneBox,maxSteps=900){
  const doc=w.document,ev=s=>w.eval(s);
  for(let n=0;n<maxSteps&&!onDoneBox.r;n++){
    const btn=t=>[...doc.querySelectorAll('button')].filter(b=>!b.closest('[hidden]')&&!b.disabled&&b.textContent.trim().startsWith(t))[0];
    let b=btn('Iniziamo gli esercizi')||btn('Avanti');
    const S=ev('S');
    if(S&&S.kind==='gx'&&S.q&&S.q.length){
      const q=S.q[0];
      if(q.k==='build'){const bank=()=>[...doc.querySelectorAll('.tiles .tile')];
        for(const word of q.ans){const t=bank().find(x=>x.textContent===word);if(!t){onDoneBox.err='tessera mancante '+word;return}t.click()}
        const ck=btn('Controlla');ck.click();btn('Continua').click();continue}
      if(q.k==='dict'||q.k==='dictx'){const inp=doc.querySelector('.dictin');if(inp){inp.value=q.ans;inp.dispatchEvent(new w.Event('input',{bubbles:true}));btn('Controlla').click();btn('Continua').click();continue}}
      const o=[...doc.querySelectorAll('.opt')].find(x=>x.dataset.c==='1');
      if(o){o.click();const c=btn('Continua');if(c)c.click();continue}
    }
    if(b){b.click();continue}
    const c=btn('Continua');if(c){c.click();continue}
    console.log('  bot fermo: kind',S&&S.kind,'q0',S&&S.q&&S.q[0]&&S.q[0].k,'bottoni',[...doc.querySelectorAll('button')].filter(b=>!b.closest('[hidden]')).map(b=>b.textContent.trim().slice(0,12)).join('|'));break}
}
const REP=+process.argv[2]||2;
for(let r=0;r<REP;r++){
  for(let li=0;li<4;li++){
    const w=boot(mkDone(6));const box={};
    w.eval('startGLesson("G7",'+li+',x=>{window.__r=x})');
    const wait=()=>{bot(w,{get r(){return w.__r},err:null});};
    wait();
    ok(w.__r&&w.__r.pass&&w.__r.pct===100,'rep'+(r+1)+' lezione G7-'+(li+1)+' giocata al 100% ('+(w.__r&&w.__r.pct)+')');
  }
  // lezione con errori: sbaglia la prima domanda a scelta, poi tutto giusto
  {const w=boot(mkDone(6));w.eval('startGLesson("G7",0,x=>{window.__r=x})');const doc=w.document;
   const click=t=>[...doc.querySelectorAll('button')].find(b=>!b.closest('[hidden]')&&b.textContent.trim().startsWith(t));
   while(click('Avanti')||click('Iniziamo gli esercizi')){(click('Iniziamo gli esercizi')||click('Avanti')).click()}
   let wrong=0;
   for(let g=0;g<5;g++){const q=w.eval('S.q[0]');if(q&&q.k!=='build'&&q.k!=='dict'){const o=[...doc.querySelectorAll('.opt')].find(x=>x.dataset.c!=='1');if(o){o.click();wrong++;const c=click('Continua');if(c)c.click();break}}}
   bot(w,{get r(){return w.__r}});
   ok(wrong===1&&w.__r&&w.__r.pct<100&&w.__r.pct>=90,'un errore: '+(w.__r&&w.__r.pct)+'% (supera il 90%)');}
  // verifica
  {const w=boot(mkDone(6));w.eval('startGTest("G7",x=>{window.__r=x})');
   const q=w.eval('S.q.map(x=>({k:x.k,src:x.src||""}))');
   const jpOf={};Object.entries(GU).forEach(([id,u])=>u.lessons.forEach(l=>l.teach.forEach(t=>jpOf[t.jp]=id)));
   const unit=q.filter(x=>jpOf[x.src]==='G7').length,rev=q.filter(x=>jpOf[x.src]&&jpOf[x.src]!=='G7').length;
   ok(q.length===25,'verifica: 25 domande ('+q.length+')');
   ok(unit===20&&rev===5,'verifica: 20 su G7 e 5 di ripasso ('+unit+'+'+rev+')');
   ok(q.filter(x=>x.k==='build').length<=3&&q.filter(x=>x.k==='dict').length<=3,'verifica: al più 3 composizioni e 3 dettati');
   const keys=q.map(x=>x.k+'|'+x.src);ok(new Set(keys).size===keys.length,'verifica: nessuna domanda doppia');
   bot(w,{get r(){return w.__r}},1500);
   ok(w.__r&&w.__r.pass&&w.__r.test&&w.__r.pct===100,'verifica giocata al 100%');
  }
}
// strada e cartolina
{const w=boot(mkDone(6).concat(['G7:t']));w.eval('renderRoad&&0');
 const gn=w.document.querySelectorAll('.pn.gn').length;ok(gn>=35,'strada: nodi di lingua (>=35): '+gn);
 w.eval('openPoi('+idx+')');const t=w.document.querySelector('.sh h2');ok(t&&/silenzio/.test(t.textContent),'cartolina G7 aperta: '+(t&&t.textContent));
 const txt=w.document.querySelector('.sh').textContent;ok(/ゆうせんせき/.test(txt),'cartolina con ゆうせんせき');}
{const w=boot(mkDone(6));w.eval('openPoi('+idx+')');ok(/🔒/.test(w.document.querySelector('.sh').textContent),'cartolina bloccata senza la verifica');}
console.log(fails?('\n'+fails+' ERRORI'):'\nTutto ok');process.exit(fails?1:0);
