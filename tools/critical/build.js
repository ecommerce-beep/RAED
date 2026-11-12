// Builds the home page's inline (critical) CSS from public/app.css + public/ishara.css.
// A rule is kept when it styles something on the first screen of the home page:
//   - it matches the server HTML snapshot (home.html: Raed's markup + the Ishara hero), or
//   - all its classes/ids are ones Salla's web components add (tokens.json).
// The result is written between the critical markers in src/views/pages/index.twig.
// Runs after webpack in `pnpm run production`.
const fs = require('fs');
const path = require('path');
const postcss = require('postcss');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const doc = new JSDOM(fs.readFileSync(path.join(__dirname, 'home.html'), 'utf8')).window.document;
const tokens = JSON.parse(fs.readFileSync(path.join(__dirname, 'tokens.json'), 'utf8'));
const CLS = new Set(tokens.classes);
const IDS = new Set(tokens.ids);

// drop :hover, ::before, :not(...), etc. (keeps the rule when its element exists)
function stripPseudo(sel) {
  let out = '';
  for (let i = 0; i < sel.length; i++) {
    const ch = sel[i];
    if (ch === '\\') { out += ch + (sel[i + 1] || ''); i++; continue; }
    if (ch === '[') { const j = sel.indexOf(']', i); out += sel.slice(i, j + 1); i = j; continue; }
    if (ch !== ':') { out += ch; continue; }
    i++;
    if (sel[i] === ':') i++;
    while (i < sel.length && /[\w-]/.test(sel[i])) i++;
    if (sel[i] === '(') { let d = 0; for (; i < sel.length; i++) { if (sel[i] === '(') d++; else if (sel[i] === ')' && --d === 0) break; } }
    else i--;
  }
  out = out.trim();
  if (!out) return '*';
  return /[>+~]$/.test(out) ? out + ' *' : out;
}

function tokenMatch(sel) {
  const cls = [...sel.matchAll(/\.((?:\\.|[\w-])+)/g)].map(m => m[1].replace(/\\(.)/g, '$1'));
  const ids = [...sel.matchAll(/#((?:\\.|[\w-])+)/g)].map(m => m[1].replace(/\\(.)/g, '$1'));
  if (!cls.length && !ids.length) return false;
  return cls.every(c => CLS.has(c)) && ids.every(i => IDS.has(i));
}

function used(selector) {
  return selector.split(/,(?![^(]*\))/).some(s => {
    const bare = stripPseudo(s.trim());
    try { if (doc.querySelector(bare)) return true; } catch (e) { return true; } // unknown syntax: keep
    return tokenMatch(bare);
  });
}

function critical(css) {
  const root = postcss.parse(css);
  root.walkRules(rule => {
    if (rule.parent.type === 'atrule' && /keyframes$/i.test(rule.parent.name)) return;
    if (!used(rule.selector)) rule.remove();
  });
  // keyframes only when a kept rule uses them; empty @media/@supports go
  const css1 = root.toString();
  root.walkAtRules(/keyframes$/i, at => { if (!new RegExp('\\b' + at.params.trim() + '\\b').test(css1.replace(at.toString(), ''))) at.remove(); });
  let changed = true;
  while (changed) { changed = false; root.walkAtRules(at => { if (at.nodes && !at.nodes.length) { at.remove(); changed = true; } }); }
  root.walkComments(c => c.remove());
  return root.toString().replace(/\s*\n\s*/g, '').replace(/\s*([{};])\s*/g, '$1');
}

const files = ['app.css', 'ishara.css'];
let out = files.map(f => critical(fs.readFileSync(path.join(ROOT, 'public', f), 'utf8'))).join('');
out = out.replace(/\{(?=[{%#])/g, '{ '); // never opens a twig tag
out = out.replace(/<\//g, '<\\/');

const twig = path.join(ROOT, 'src', 'views', 'pages', 'index.twig');
const src = fs.readFileSync(twig, 'utf8');
const re = /(\{# critical:start[^#]*#\})[\s\S]*?(\{# critical:end #\})/;
if (!re.test(src)) throw new Error('critical markers missing in index.twig');
fs.writeFileSync(twig, src.replace(re, (m, a, b) => a + '\n    <style id="ish-critical">' + out + '</style>\n    ' + b));
const kb = n => (n / 1024).toFixed(1) + 'KB';
console.log('critical css:', kb(out.length), 'from', files.map(f => f + ' ' + kb(fs.statSync(path.join(ROOT, 'public', f)).size)).join(' + '));
