#!/usr/bin/env node
/* check-kana.js (WP-02) — controllo dei kana usati in ogni unità del percorso.
 *
 * Cosa fa
 *  1. Legge index.html (PATH, L, WV) con jsdom e calcola quali kana sono noti a ogni punto del percorso (ordine del §6).
 *  2. Controlla i testi giapponesi delle unità G: ogni kana deve essere già studiato (segnala i kana nascosti, per esempio
 *     が in ありがとう) e ogni kanji deve essere previsto dal piano (§10) per quell'unità o per una precedente.
 *  3. Controlla le parole delle lezioni esistenti (WV): ogni carattere deve comparire in una lezione di L.
 *  4. Controlla le unità di lingua già presenti in index.html (tabella GU, WP-03): schema (id, titoli, lezioni, frasi con jp e it,
 *     ordine di needs), romaji dichiarato contro quello generato da toRo (avviso se diverso) e kana di frasi e note.
 *  5. Confronta lezioni e unità K con check-baseline.json: se cambiano, le chiavi di done (i, "i:w", "i:p", "ultima:t") non
 *     sono più valide per chi ha già dei progressi.
 *
 * Uso (serve jsdom: npm i jsdom)
 *   node check-kana.js                          controlli 3 e 4
 *   node check-kana.js --units g-units.json     in più, il contenuto delle unità G (formato sotto)
 *   node check-kana.js --unit G2 --text "ありがとう" --text "わたし は がくせい です。"
 *   node check-kana.js --done '[0,1,"2:t"]'     verifica che le chiavi di un done siano valide
 *   node check-kana.js --write-baseline         riscrive check-baseline.json (solo se si cambiano le lezioni di proposito)
 *   node check-kana.js --selftest               prove interne
 *   Opzioni: --index percorso/index.html   --baseline percorso/check-baseline.json
 *
 * Formato di --units: un oggetto { "G1": ["こんにちは", ...], ... } oppure un array di unità con lo schema del §8
 * ([{id:"G2", lessons:[{teach:[{jp:"..."}], ex:[{q, opts, tiles, ans, jp}]}]}]). Si leggono i campi jp, q, opts, tiles, ans,
 * w, kana, text, k; si guardano solo i caratteri giapponesi, quindi l'italiano dentro le stringhe non dà problemi.
 *
 * Codice di uscita: 0 = nessun errore (gli avvisi sono ammessi), 1 = almeno un errore.
 */
'use strict';
const fs = require('fs'), path = require('path');

/* Ordine del percorso (§6 del documento di piano) */
const ORDER = ['K1','K2','K3','G1','K4','G2','G3','K5','G4','G5','K6','G6','K7','G7','K8','G8','K9','G9','K10','G10','K11','G11','G12','G13','G14'];
/* Kanji previsti dal piano (§10): si possono usare nell'unità indicata e in quelle dopo */
const KANJI = {
  G4: '一二三四五六七八九十百千万円', G5: '日月火水木金土曜年今何', G6: '人男女子大小中', G7: '行来出入口目耳手足',
  G9: '高安新古長多少白赤青', G10: '前後上下左右外', G11: '食飲見聞読書話買', G13: '駅電車道店国語学校先生友名時分半'
};
/* Segni che nessun capitolo K insegna con una lezione (nell'app stanno nella Tabella e nelle Regole): si ammettono dall'unità
   indicata, ma con un avviso, perché il piano non dice dove insegnarli. */
const EXTRA = { 'っ': 'K5', 'ッ': 'K6', 'ー': 'K6' };
/* Dal WP-13 il piccolo っ si insegna in una lezione di lingua (G4-3, ろっぴゃく): dall'unità indicata nessun avviso, prima è un errore. */
const TAUGHT = { 'っ': 'G4' };
const NEUTRAL = /[\s\u3000。、，．！？「」『』（）・〜～…\u30fb]/;
const KEYS = new Set(['jp', 'q', 'opts', 'tiles', 'ans', 'w', 'kana', 'text', 'k', 'note', 'say']);

const isHira = c => /[\u3041-\u3096\u3099-\u309f]/.test(c);
const isKata = c => /[\u30a1-\u30fa\u30fc-\u30ff]/.test(c);
const isKanji = c => /[\u4e00-\u9fff\u3005]/.test(c);
const isHalf = c => /[\uff66-\uff9f]/.test(c);
const isJp = c => isHira(c) || isKata(c) || isKanji(c) || isHalf(c);

function loadApp(indexPath) {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM(fs.readFileSync(indexPath, 'utf8'), { runScripts: 'dangerously', url: 'https://localhost/', pretendToBeVisual: true,
    beforeParse(w) { w.Element.prototype.scrollIntoView = () => {}; } });
  return new Promise(res => setTimeout(() => {
    const w = dom.window;
    const data = JSON.parse(w.eval('JSON.stringify({L:L,PATH:PATH,POIn:POI.length,WV:WV,GU:(typeof GU!=="undefined"?GU:{}),roGen:Object.fromEntries(Object.values(typeof GU!=="undefined"?GU:{}).flatMap(u=>u.lessons.flatMap(l=>[...l.teach.map(t=>t.jp),...(l.ex||[]).filter(e=>e.type==="dict").map(e=>e.jp)].map(j=>[j,toRo(j)]))))})'));
    w.close(); res(data);
  }, 300));
}

function buildModel(app) {
  const intro = {}, first = {}, title = {};
  for (const u of app.PATH) {
    if (u.kind !== 'k') continue;
    const s = new Set();
    for (let i = u.from; i <= u.to; i++) for (const p of app.L[i].k) for (const ch of p[0]) s.add(ch);
    intro[u.id] = s; title[u.id] = u.t;
    for (const ch of s) if (!(ch in first)) first[ch] = u.id;
  }
  const kanjiUnit = {};
  for (const [id, str] of Object.entries(KANJI)) for (const ch of str) kanjiUnit[ch] = id;
  return { intro, first, title, kanjiUnit };
}
const before = id => ORDER.slice(0, ORDER.indexOf(id));        // unità precedenti
const upto = id => ORDER.slice(0, ORDER.indexOf(id) + 1);      // fino all'unità compresa
const kanjiGroup = id => id === 'G12' ? 'G11' : id;

function checkText(M, unit, text, out) {
  if (!ORDER.includes(unit)) { out.push({ level: 'error', unit, text, msg: 'unità sconosciuta: ' + unit }); return; }
  const prev = before(unit), seen = new Set();
  for (const ch of text) {
    if (!isJp(ch) || NEUTRAL.test(ch) || seen.has(ch)) continue;
    seen.add(ch);
    const k = M.first[ch];
    if (TAUGHT[ch] && ORDER.includes(TAUGHT[ch])) {
      if (ORDER.indexOf(unit) < ORDER.indexOf(TAUGHT[ch])) out.push({ level: 'error', unit, text, ch, msg: `「${ch}」 in «${text}» (${unit}): si insegna in ${TAUGHT[ch]}, non prima` });
    } else if (EXTRA[ch]) {
      if (!ORDER.includes(EXTRA[ch]) || ORDER.indexOf(EXTRA[ch]) >= ORDER.indexOf(unit))
        out.push({ level: 'error', unit, text, ch, msg: `「${ch}」 in «${text}» (${unit}): si ammette solo dopo ${EXTRA[ch]}` });
      else out.push({ level: 'warn', unit, text, ch, msg: `「${ch}」 in «${text}» (${unit}): nessuna lezione di K lo insegna (solo Tabella e Regole); il piano deve dire dove` });
    } else if (isKanji(ch)) {
      const ku = M.kanjiUnit[ch];
      if (!ku) out.push({ level: 'error', unit, text, ch, msg: `kanji 「${ch}」 in «${text}» (${unit}): non è nel piano (§10)` });
      else if (ORDER.indexOf(kanjiGroup(ku)) > ORDER.indexOf(unit)) out.push({ level: 'error', unit, text, ch, msg: `kanji 「${ch}」 in «${text}» (${unit}): il piano lo introduce in ${ku}` });
    } else if (isHalf(ch)) {
      out.push({ level: 'error', unit, text, ch, msg: `「${ch}」 in «${text}» (${unit}): katakana a mezza larghezza, non ammesso` });
    } else if (!k) {
      out.push({ level: 'error', unit, text, ch, msg: `「${ch}」 in «${text}» (${unit}): non è in nessuna lezione dei capitoli K` });
    } else if (!prev.includes(k)) {
      out.push({ level: 'error', unit, text, ch, msg: `「${ch}」 in «${text}» (${unit}): non ancora studiato, si introduce in ${k} (${M.title[k]})` });
    }
  }
}

function collect(node, out, inKey) {
  if (typeof node === 'string') { if (inKey) out.push(node); return; }
  if (Array.isArray(node)) { node.forEach(x => collect(x, out, inKey)); return; }
  if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) collect(v, out, inKey || KEYS.has(k));
}
function unitTexts(data) {
  const res = {};
  if (Array.isArray(data)) data.forEach(u => { const t = []; collect(u, t, false); (res[u.id] = res[u.id] || []).push(...t); });
  else for (const [id, v] of Object.entries(data)) { const t = []; if (Array.isArray(v) && v.every(x => typeof x === 'string')) t.push(...v); else collect(v, t, false); res[id] = t; }
  return res;
}

function checkLessonWords(app, M, out) {
  const chLesson = {};
  app.L.forEach((l, i) => l.k.forEach(p => { for (const ch of p[0]) if (!(ch in chLesson)) chLesson[ch] = i; }));
  let n = 0, lo = 99, hi = -1;
  for (const w of app.WV) {
    const word = w[0]; n++;
    let mx = -1;
    for (const ch of word) {
      if (NEUTRAL.test(ch) || !isJp(ch)) continue;
      if (EXTRA[ch]) continue;                       // l'app ammette っ ッ ー nelle parole
      if (!(ch in chLesson)) { out.push({ level: 'error', msg: `parola «${word}»: 「${ch}」 non è in nessuna lezione` }); mx = 99; break; }
      mx = Math.max(mx, chLesson[ch]);
    }
    if (mx >= 0 && mx < 99) { lo = Math.min(lo, mx); hi = Math.max(hi, mx); }
    const scripts = new Set([...word].filter(c => isHira(c) || isKata(c)).map(c => isHira(c) ? 'h' : 'k'));
    if (scripts.size > 1) out.push({ level: 'warn', msg: `parola «${word}»: mescola hiragana e katakana` });
  }
  return { n, lo, hi };
}

const normRo = r => String(r).toLowerCase().replace(/[\s.,!?'’-]/g, '');
function checkSchema(app, out, gu) {
  gu = gu || app.GU || {};
  const err = m => out.push({ level: 'error', msg: m }), warn = m => out.push({ level: 'warn', msg: m });
  const str = (v, w) => typeof v === 'string' && v.trim() !== '' || (err(w + ': manca o è vuoto'), false);
  for (const [key, u] of Object.entries(gu)) {
    if (u.id !== key) err(`GU.${key}: id «${u.id}» diverso dalla chiave`);
    if (!/^G\d+$/.test(key) || !ORDER.includes(key)) { err(`GU.${key}: non è un'unità G del piano`); continue; }
    str(u.t, key + '.t');
    if (!Array.isArray(u.needs) || !u.needs.length) err(`${key}.needs: serve un elenco di unità K`);
    else u.needs.forEach(n => { if (!/^K\d+$/.test(n) || !ORDER.includes(n)) err(`${key}.needs: «${n}» non è un'unità K`); else if (ORDER.indexOf(n) > ORDER.indexOf(key)) err(`${key}.needs: ${n} viene dopo ${key} nel §6`); });
    if (u.test !== undefined) {
      const t = u.test || {};
      if (!Number.isInteger(t.n) || t.n < 10 || t.n > 40) err(`${key}.test.n: numero di domande della verifica tra 10 e 40 (il piano dice 25)`);
      else if (t.review !== undefined && (!Number.isInteger(t.review) || t.review < 0 || t.review > t.n)) err(`${key}.test.review: tra 0 e n (il piano dice 5)`);
    }
    if (!Array.isArray(u.lessons) || !u.lessons.length) { err(`${key}.lessons: serve almeno una lezione`); continue; }
    { const uniq = new Set(u.lessons.flatMap(l => (l.teach || []).map(t => t.jp))).size, n = (u.test && u.test.n) || 25;
      if (uniq < 12) warn(`${key}: ${uniq} frasi diverse; la verifica da ${n} domande le ripete (il piano ne prevede 50-60 per unità)`); }
    u.lessons.forEach((l, li) => {
      const at = `${key} lezione ${li + 1}`;
      if (l.id !== `${key}-${li + 1}`) err(`${at}: id «${l.id}», atteso «${key}-${li + 1}»`);
      str(l.t, at + '.t');
      if (!Array.isArray(l.teach) || !l.teach.length) { err(`${at}.teach: serve almeno una frase`); return; }
      if (l.ex !== undefined && !Array.isArray(l.ex)) err(`${at}.ex: deve essere un elenco`);
      else (l.ex || []).forEach((e, ei) => {
        const w = `${at}, esercizio ${ei + 1}`;
        if (!['mcq', 'build', 'dict'].includes(e.type)) { err(`${w}: tipo «${e.type}» sconosciuto (mcq, build, dict)`); return; }
        if (e.type === 'mcq') {
          str(e.q, w + '.q');
          if (!Array.isArray(e.opts) || e.opts.length < 2 || e.opts.some(o => typeof o !== 'string' || !o.trim())) err(`${w}.opts: servono almeno 2 opzioni di testo`);
          else {
            if (new Set(e.opts).size !== e.opts.length) err(`${w}.opts: opzioni uguali tra loro`);
            if (!Number.isInteger(e.a) || e.a < 0 || e.a >= e.opts.length) err(`${w}.a: indice della risposta giusta non valido`);
          }
        }
        if (e.type === 'dict') {
          str(e.jp, w + '.jp');
          if (typeof e.ans !== 'string' || !/^[a-z][a-z' -]*$/.test(e.ans.trim())) err(`${w}.ans: serve il romaji in lettere minuscole senza accenti (per esempio “arigatou”)`);
          else {
            const gen = app.roGen && app.roGen[e.jp];
            if (gen !== undefined && normRo(gen) !== normRo(e.ans)) warn(`${w}: romaji «${e.ans}» diverso da quello generato da toRo «${gen}»`);
          }
          ['it', 'say'].forEach(f => { if (e[f] !== undefined && typeof e[f] !== 'string') err(`${w}.${f}: deve essere testo`); });
        }
        if (e.type === 'build') {
          str(e.it, w + '.it');
          const okArr = a => Array.isArray(a) && a.length && a.every(t => typeof t === 'string' && t.trim() && !/\s/.test(t));
          if (!okArr(e.tiles) || e.tiles.length < 2) err(`${w}.tiles: servono almeno 2 tessere di testo, senza spazi`);
          if (!okArr(e.ans)) err(`${w}.ans: serve l'elenco delle parole in ordine, senza spazi dentro le parole`);
          if (okArr(e.tiles) && okArr(e.ans)) {
            const pool = [...e.tiles]; let miss = null;
            for (const t of e.ans) { const i = pool.indexOf(t); if (i < 0) { miss = t; break; } pool.splice(i, 1); }
            if (miss) err(`${w}: la parola «${miss}» di ans non è tra le tessere`);
            if (e.tiles.length === e.ans.length) warn(`${w}: nessuna tessera in più (conviene 1 o 2)`);
          }
          if (e.p !== undefined && typeof e.p !== 'string') err(`${w}.p: deve essere testo`);
        }
      });
      l.teach.forEach((t, ti) => {
        const w = `${at}, frase ${ti + 1}`;
        if (str(t.jp, w + '.jp') && /[\uff01-\uff5e]/.test(t.jp.replace(/[！？（）～]/g, ''))) warn(`${w}: caratteri a larghezza piena nel testo «${t.jp}»`);
        str(t.it, w + '.it');
        ['ro', 'note', 'say'].forEach(f => { if (t[f] !== undefined && typeof t[f] !== 'string') err(`${w}.${f}: deve essere testo`); });
        if (typeof t.jp === 'string' && /^[^\s]+(\s[^\s]+)*$/.test(t.jp) === false) warn(`${w}: spazi doppi o ai bordi in «${t.jp}»`);
        if (t.ro) {
          if (/[A-Z\u0100-\u017f]/.test(t.ro)) warn(`${w}: romaji «${t.ro}» con maiuscole o macron (il piano usa ou/oo)`);
          const gen = app.roGen && app.roGen[t.jp];
          if (gen !== undefined && normRo(gen) !== normRo(t.ro)) warn(`${w}: romaji «${t.ro}» diverso da quello generato da toRo «${gen}»`);
        }
      });
    });
  }
}

function signature(app) {
  return {
    lessons: app.L.map(l => l.g + ':' + l.k.map(p => p[0]).join('')),
    units: app.PATH.filter(u => u.kind === 'k').map(u => [u.id, u.from, u.to, u.poi]),
    doneKeys: 'i = Caratteri; "i:w" = Parole; "i:p" = Pronuncia; "ultima:t" = verifica (ultima = indice dell\'ultima lezione dell\'unità); G: "G1-1" = lezione, "G1:t" = verifica'
  };
}
function checkBaseline(app, base, out) {
  const cur = signature(app);
  if (cur.lessons.length < base.lessons.length) out.push({ level: 'error', msg: `lezioni: ${cur.lessons.length}, nel riferimento ${base.lessons.length}: ne mancano` });
  base.lessons.forEach((s, i) => { if (cur.lessons[i] !== s) out.push({ level: 'error', msg: `lezione ${i} cambiata: «${cur.lessons[i]}» al posto di «${s}»: gli indici di done non valgono più` }); });
  if (cur.lessons.length > base.lessons.length) out.push({ level: 'warn', msg: `ci sono ${cur.lessons.length - base.lessons.length} lezioni in più del riferimento: se sono volute, aggiornare con --write-baseline` });
  base.units.forEach((u, i) => { const c = cur.units[i]; if (!c || JSON.stringify(c) !== JSON.stringify(u)) out.push({ level: 'error', msg: `unità ${u[0]} cambiata: ${JSON.stringify(c)} al posto di ${JSON.stringify(u)}: cambia la chiave "ultima:t"` }); });
  if (cur.units.length > base.units.length) out.push({ level: 'warn', msg: `ci sono ${cur.units.length - base.units.length} unità K in più del riferimento` });
}
/* WP-08: coerenza del percorso: ordine del §6, needs, soglia, cartoline */
function checkPath(app, out) {
  const ids = app.PATH.map(u => u.id), pos = id => ORDER.indexOf(id);
  for (let i = 1; i < ids.length; i++) if (pos(ids[i]) < 0 || pos(ids[i - 1]) < 0 || pos(ids[i]) < pos(ids[i - 1])) out.push({ level: 'error', msg: `PATH: ${ids[i]} è fuori ordine rispetto al §6 (dopo ${ids[i - 1]})` });
  { const seenJp = {}; Object.values(app.GU || {}).forEach(u => u.lessons.forEach(l => (l.teach || []).forEach(x => {
      if (seenJp[x.jp]) out.push({ level: 'error', msg: `scheda duplicata «${x.jp}» in ${l.id} e ${seenJp[x.jp]}: il ripasso usa il testo giapponese come chiave` }); else seenJp[x.jp] = l.id; }))); }
  const pois = new Set();
  app.PATH.forEach((u, i) => {
    if (pois.has(u.poi)) out.push({ level: 'error', msg: `PATH: la cartolina ${u.poi} è usata da più di un'unità (${u.id})` }); pois.add(u.poi);
    if (app.POIn !== undefined && !(u.poi >= 0 && u.poi < app.POIn)) out.push({ level: 'error', msg: `PATH: ${u.id} usa la cartolina ${u.poi}, che non esiste (ce ne sono ${app.POIn})` });
    if (!(u.min >= 1 && u.min <= 100)) out.push({ level: 'error', msg: `PATH: ${u.id} senza soglia min valida` });
    if (u.kind === 'k' && u.min !== 100) out.push({ level: 'error', msg: `PATH: ${u.id} è un'unità di kana, la soglia deve restare 100` });
    if (u.kind === 'g') {
      if (!app.GU || !app.GU[u.id]) out.push({ level: 'error', msg: `PATH: ${u.id} non ha la tabella GU` });
      else if (!app.GU[u.id].lessons.length) out.push({ level: 'warn', msg: `${u.id}: nessuna lezione, nella strada non compare` });
      (u.needs || []).forEach(n => { const j = ids.indexOf(n); if (j < 0 || j >= i) out.push({ level: 'error', msg: `PATH: ${u.id} richiede ${n}, che non lo precede` }); });
    }
  });
  if (app.GU) Object.keys(app.GU).forEach(id => { if (!ids.includes(id)) out.push({ level: 'warn', msg: `GU.${id} non è ancora in PATH: non compare nella strada` }); });
}
function checkDone(app, done, out) {
  const ends = new Set(app.PATH.filter(u => u.kind === 'k').map(u => u.to));
  for (const k of done) {
    const g = /^(G\d+)(?:-(\d+)|:(t))$/.exec(String(k));
    if (g) {
      const u = app.PATH.find(x => x.id === g[1]), gu = app.GU && app.GU[g[1]];
      if (!u || u.kind !== 'g' || !gu) out.push({ level: 'error', msg: `chiave ${JSON.stringify(k)}: l'unità ${g[1]} non esiste nel percorso` });
      else if (g[2] && (+g[2] < 1 || +g[2] > gu.lessons.length)) out.push({ level: 'error', msg: `chiave ${JSON.stringify(k)}: ${g[1]} ha ${gu.lessons.length} lezioni` });
      continue;
    }
    const m = /^(\d+)(?::([wpt]))?$/.exec(String(k));
    if (!m) { out.push({ level: 'error', msg: `chiave non valida: ${JSON.stringify(k)}` }); continue; }
    const i = +m[1];
    if (i >= app.L.length) out.push({ level: 'error', msg: `chiave ${JSON.stringify(k)}: la lezione ${i} non esiste` });
    else if (m[2] === 't' && !ends.has(i)) out.push({ level: 'error', msg: `chiave ${JSON.stringify(k)}: la lezione ${i} non è l'ultima di un'unità` });
  }
}

function report(out, title) {
  const e = out.filter(x => x.level === 'error'), w = out.filter(x => x.level === 'warn');
  console.log(`${title}: ${e.length ? e.length + ' errori' : 'nessun errore'}${w.length ? ', ' + w.length + ' avvisi' : ''}`);
  e.forEach(x => console.log('  ERRORE ' + x.msg)); w.forEach(x => console.log('  avviso ' + x.msg));
  return e.length;
}

async function selftest(app, M) {
  const t = (name, unit, text, expectErr, expectWarn) => {
    const o = []; checkText(M, unit, text, o);
    const e = o.some(x => x.level === 'error'), w = o.some(x => x.level === 'warn');
    const ok = e === expectErr && w === !!expectWarn; console.log((ok ? 'ok     ' : 'FALLITO ') + name); return ok;
  };
  const r = [
    t('G1 ありがとう (が non ancora noto)', 'G1', 'ありがとう', true),
    t('G1 こんにちは (solo kana base)', 'G1', 'こんにちは', false),
    t('G2 ありがとう (dopo K4)', 'G2', 'ありがとう', false),
    t('G2 かいしゃいん (ゃ è in K5)', 'G2', 'かいしゃいん', true),
    t('G4 ひゃく (dopo K5)', 'G4', 'ひゃく', false),
    t('G5 レストラン (katakana non ancora noti)', 'G5', 'レストラン', true),
    t('G6 レストラン (servono K7 e K8)', 'G6', 'レストラン', true),
    t('G11 レストラン (dopo K11)', 'G11', 'レストラン', false),
    t('G12 ちょっと (っ insegnato in G4: nessun avviso)', 'G12', 'ちょっと', false, false),
    t('G3 いっぷん (っ prima di G4: errore)', 'G3', 'いっぷん', true),
    t('G11 こーひー (ー senza lezione: avviso)', 'G11', 'こーひー', false, true),
    t('G4 kanji 一 (previsto)', 'G4', '一ひゃく', false),
    t('G4 kanji 日 (previsto in G5)', 'G4', '日', true),
    t('G9 kanji 私 (non nel piano)', 'G9', '私', true),
    t('Italiano misto ignorato', 'G2', 'Che cosa significa わたし?', false)
  ];
  { const o = []; checkSchema(app, o); const ok1 = !o.some(x => x.level === 'error'); r.push(ok1); console.log((ok1 ? 'ok     ' : 'FALLITO ') + 'schema GU di index.html valido');
    const bad = (name, mut, lvl) => { const g = JSON.parse(JSON.stringify(app.GU)); mut(g); const q = []; checkSchema(app, q, g); const ok2 = q.some(x => x.level === lvl); r.push(ok2); console.log((ok2 ? 'ok     ' : 'FALLITO ') + 'schema: ' + name); };
    bad('frase senza traduzione', g => { delete g.G1.lessons[0].teach[0].it; }, 'error');
    bad('id di lezione sbagliato', g => { g.G1.lessons[1].id = 'G1-5'; }, 'error');
    bad('needs dopo l\'unità', g => { g.G1.needs = ['K4']; }, 'error');
    bad('lezione senza frasi', g => { g.G1.lessons[0].teach = []; }, 'error');
    bad('mcq con risposta fuori elenco', g => { g.G1.lessons[0].ex[0].a = 9; }, 'error');
    bad('mcq con opzioni uguali', g => { g.G1.lessons[0].ex[0].opts[1] = g.G1.lessons[0].ex[0].opts[0]; }, 'error');
    bad('test.n troppo piccolo', g => { g.G1.test.n = 3; }, 'error');
    bad('test.review più grande di n', g => { g.G1.test.review = 99; }, 'error');
    bad('dict: romaji con maiuscole', g => { g.G2.lessons[0].ex.push({ type: 'dict', jp: 'ありがとう', ans: 'Arigatou', it: 'Grazie' }); }, 'error');
    bad('dict: romaji diverso da toRo', g => { g.G2.lessons[0].ex.push({ type: 'dict', jp: 'ありがとう', ans: 'arigato', it: 'Grazie' }); }, 'warn');
    bad('dict: manca jp', g => { g.G2.lessons[0].ex.push({ type: 'dict', ans: 'arigatou' }); }, 'error');
    bad('build: parola di ans non tra le tessere', g => { g.G2.lessons[0].ex.push({ type: 'build', it: 'x', tiles: ['わたし', 'は', 'です'], ans: ['ほん', 'は'], p: '。' }); }, 'error');
    bad('build: tessere senza spazi', g => { g.G2.lessons[0].ex.push({ type: 'build', it: 'x', tiles: ['わたし は', 'です', 'も'], ans: ['わたし', 'です'], p: '。' }); }, 'error');
    bad('build: nessuna tessera in più', g => { g.G2.lessons[0].ex.push({ type: 'build', it: 'x', tiles: ['わたし', 'です'], ans: ['わたし', 'です'], p: '。' }); }, 'warn');
    bad('tipo di esercizio sconosciuto', g => { g.G1.lessons[0].ex[0].type = 'xyz'; }, 'error');
    bad('romaji diverso da toRo', g => { g.G1.lessons[1].teach[0].ro = 'nyaa'; }, 'warn');
    bad('romaji con macron', g => { g.G1.lessons[0].teach[1].ro = 'ohayō'; }, 'warn'); }
  const o = []; checkBaseline(app, signature(app), o); r.push(o.length === 0); console.log((o.length === 0 ? 'ok     ' : 'FALLITO ') + 'riferimento = file attuale');
  const d = []; checkDone(app, [0, '1:w', '2:t', '3:t'], d); r.push(d.length === 1); console.log((d.length === 1 ? 'ok     ' : 'FALLITO ') + 'done: "3:t" rifiutato, gli altri validi');
  { const o = []; checkPath(app, o); const ok3 = !o.some(x => x.level === 'error'); r.push(ok3); console.log((ok3 ? 'ok     ' : 'FALLITO ') + 'percorso di index.html coerente');
    const badP = (name, mut) => { const a2 = JSON.parse(JSON.stringify(app)); mut(a2); const q = []; checkPath(a2, q); const ok4 = q.some(x => x.level === 'error'); r.push(ok4); console.log((ok4 ? 'ok     ' : 'FALLITO ') + 'percorso: ' + name + ' rifiutato'); };
    badP('G1 dopo K4', a => { const i = a.PATH.findIndex(u => u.id === 'G1'), j = a.PATH.findIndex(u => u.id === 'K4'); [a.PATH[i], a.PATH[j]] = [a.PATH[j], a.PATH[i]]; });
    badP('cartolina doppia', a => { a.PATH.find(u => u.id === 'G1').poi = 0; });
    badP('cartolina inesistente', a => { a.PATH.find(u => u.id === 'G2').poi = 99; });
    badP('G con soglia mancante', a => { delete a.PATH.find(u => u.id === 'G2').min; });
    badP('K con soglia diversa da 100', a => { a.PATH.find(u => u.id === 'K2').min = 90; });
    badP('scheda duplicata tra unità', a => { a.GU.G2.lessons[0].teach.push({ jp: a.GU.G1.lessons[0].teach[0].jp, ro: 'x', it: 'x' }); });
    badP('needs che non precede', a => { a.PATH.find(u => u.id === 'G1').needs = ['K4']; }); }
  { const d2 = []; checkDone(app, ['G1-1', 'G1-2', 'G1:t', 'G2-1', 'G2:t'], d2); const ok5 = d2.length === 0; r.push(ok5); console.log((ok5 ? 'ok     ' : 'FALLITO ') + 'done: chiavi G valide accettate');
    [['G1-9', 'lezione inesistente'], ['G9:t', 'unità inesistente'], ['G1-0', 'lezione 0'], ['K1:t', 'prefisso sbagliato']].forEach(([k, n]) => { const d3 = []; checkDone(app, [k], d3); const ok6 = d3.length === 1; r.push(ok6); console.log((ok6 ? 'ok     ' : 'FALLITO ') + 'done: ' + k + ' rifiutato (' + n + ')'); }); }
  return r.every(Boolean);
}

async function main() {
  const a = process.argv.slice(2), opt = { text: [] };
  for (let i = 0; i < a.length; i++) {
    const k = a[i];
    if (k === '--text') opt.text.push(a[++i]); else if (['--index', '--baseline', '--units', '--unit', '--done'].includes(k)) opt[k.slice(2)] = a[++i]; else opt[k.slice(2)] = true;
  }
  const dir = __dirname, indexPath = opt.index || path.join(dir, 'index.html'), basePath = opt.baseline || path.join(dir, 'check-baseline.json');
  const app = await loadApp(indexPath), M = buildModel(app);
  let errors = 0;
  if (opt['write-baseline']) { fs.writeFileSync(basePath, JSON.stringify(signature(app), null, 1) + '\n'); console.log('scritto ' + basePath); return 0; }
  if (opt.selftest) return (await selftest(app, M)) ? 0 : 1;
  if (opt.text.length) {
    if (!opt.unit) { console.log('serve --unit (per esempio G2)'); return 1; }
    const o = []; opt.text.forEach(t => checkText(M, opt.unit, t, o)); return report(o, 'testi in ' + opt.unit) ? 1 : 0;
  }
  if (opt.done) { const o = []; checkDone(app, JSON.parse(opt.done), o); return report(o, 'chiavi di done') ? 1 : 0; }
  { const o = [], s = checkLessonWords(app, M, o);
    errors += report(o, `parole delle lezioni (${s.n} parole, sbloccate tra la lezione ${s.lo} e la ${s.hi})`); }
  if (fs.existsSync(basePath)) { const o = []; checkBaseline(app, JSON.parse(fs.readFileSync(basePath, 'utf8')), o); errors += report(o, 'lezioni e unità rispetto al riferimento'); }
  else console.log('nessun riferimento (' + basePath + '): crearlo con --write-baseline');
  { const o = []; checkPath(app, o); errors += report(o, 'percorso (ordine, needs, soglie, cartoline)'); }
  if (app.GU && Object.keys(app.GU).length) {
    const o = []; checkSchema(app, o);
    const texts = unitTexts(app.GU);
    for (const [id, list] of Object.entries(texts)) if (ORDER.includes(id)) list.forEach(t => checkText(M, id, t, o));
    errors += report(o, `unità di lingua in index.html (${Object.keys(app.GU).join(', ')}): schema, romaji, kana`);
  }
  if (opt.units) {
    const texts = unitTexts(JSON.parse(fs.readFileSync(opt.units, 'utf8')));
    for (const [id, list] of Object.entries(texts)) { const o = []; list.forEach(t => checkText(M, id, t, o)); errors += report(o, `unità ${id} (${list.length} testi)`); }
  }
  return errors ? 1 : 0;
}
if (require.main === module) main().then(c => process.exit(c)).catch(e => { console.error(e); process.exit(2); });
module.exports = { checkPath, ORDER, KANJI, EXTRA, loadApp, buildModel, checkText, unitTexts, checkLessonWords, checkSchema, signature, checkBaseline, checkDone };
