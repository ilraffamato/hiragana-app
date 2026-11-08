#!/usr/bin/env node
/* check-kana.js (WP-02) — controllo dei kana usati in ogni unità del percorso.
 *
 * Cosa fa
 *  1. Legge index.html (PATH, L, WV) con jsdom e calcola quali kana sono noti a ogni punto del percorso (ordine del §6).
 *  2. Controlla i testi giapponesi delle unità G: ogni kana deve essere già studiato (segnala i kana nascosti, per esempio
 *     が in ありがとう) e ogni kanji deve essere previsto dal piano (§10) per quell'unità o per una precedente.
 *  3. Controlla le parole delle lezioni esistenti (WV): ogni carattere deve comparire in una lezione di L.
 *  4. Confronta lezioni e unità K con check-baseline.json: se cambiano, le chiavi di done (i, "i:w", "i:p", "ultima:t") non
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
const NEUTRAL = /[\s\u3000。、，．！？「」『』（）・〜～…\u30fb]/;
const KEYS = new Set(['jp', 'q', 'opts', 'tiles', 'ans', 'w', 'kana', 'text', 'k']);

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
    const data = JSON.parse(w.eval('JSON.stringify({L:L,PATH:PATH,WV:WV})'));
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
    if (EXTRA[ch]) {
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

function signature(app) {
  return {
    lessons: app.L.map(l => l.g + ':' + l.k.map(p => p[0]).join('')),
    units: app.PATH.filter(u => u.kind === 'k').map(u => [u.id, u.from, u.to, u.poi]),
    doneKeys: 'i = Caratteri; "i:w" = Parole; "i:p" = Pronuncia; "ultima:t" = verifica (ultima = indice dell\'ultima lezione dell\'unità)'
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
function checkDone(app, done, out) {
  const ends = new Set(app.PATH.filter(u => u.kind === 'k').map(u => u.to));
  for (const k of done) {
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
    t('G12 ちょっと (っ senza lezione: avviso)', 'G12', 'ちょっと', false, true),
    t('G4 kanji 一 (previsto)', 'G4', '一ひゃく', false),
    t('G4 kanji 日 (previsto in G5)', 'G4', '日', true),
    t('G9 kanji 私 (non nel piano)', 'G9', '私', true),
    t('Italiano misto ignorato', 'G2', 'Che cosa significa わたし?', false)
  ];
  const o = []; checkBaseline(app, signature(app), o); r.push(o.length === 0); console.log((o.length === 0 ? 'ok     ' : 'FALLITO ') + 'riferimento = file attuale');
  const d = []; checkDone(app, [0, '1:w', '2:t', '3:t'], d); r.push(d.length === 1); console.log((d.length === 1 ? 'ok     ' : 'FALLITO ') + 'done: "3:t" rifiutato, gli altri validi');
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
  if (opt.units) {
    const texts = unitTexts(JSON.parse(fs.readFileSync(opt.units, 'utf8')));
    for (const [id, list] of Object.entries(texts)) { const o = []; list.forEach(t => checkText(M, id, t, o)); errors += report(o, `unità ${id} (${list.length} testi)`); }
  }
  return errors ? 1 : 0;
}
if (require.main === module) main().then(c => process.exit(c)).catch(e => { console.error(e); process.exit(2); });
module.exports = { ORDER, KANJI, EXTRA, loadApp, buildModel, checkText, unitTexts, checkLessonWords, signature, checkBaseline, checkDone };
