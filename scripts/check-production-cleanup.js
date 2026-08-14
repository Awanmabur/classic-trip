#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
let passed = 0;
function check(label, fn) { try { fn(); passed += 1; console.log(`✓ ${label}`); } catch (e) { console.error(`✗ ${label}: ${e.message}`); process.exitCode = 1; } }
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const seatMap = read('src/models/SeatMapTemplate.js');
const scripts = pkg.scripts || {};
function walk(dir) { return fs.readdirSync(dir,{withFileTypes:true}).flatMap((e)=>{ if(['node_modules','.git'].includes(e.name)) return []; const full=path.join(dir,e.name); return e.isDirectory()?walk(full):[full]; }); }
function emptyDirs(dir) { let out=[]; for(const e of fs.readdirSync(dir,{withFileTypes:true})){ if(['node_modules','.git'].includes(e.name)) continue; const full=path.join(dir,e.name); if(!e.isDirectory()) continue; if(fs.readdirSync(full).length===0) out.push(full); else out=out.concat(emptyDirs(full)); } return out; }
check('release is v1.6.82 and lockfile matches',()=>assert(pkg.version==='1.6.82'&&lock.version===pkg.version&&lock.packages?.['']?.version===pkg.version));
check('SeatMapTemplate removes redundant vehicle field index',()=>assert(!/vehicleId:\s*\{[^}]*index:\s*true/.test(seatMap)));
check('SeatMapTemplate preserves unique partial vehicle index',()=>assert(seatMap.includes("seatMapTemplateSchema.index({ vehicleId: 1 }, { unique: true, partialFilterExpression:")));
check('no model has duplicate field + single-field schema index',()=>{ for(const f of walk(path.join(root,'src/models')).filter(f=>f.endsWith('.js'))){ const b=fs.readFileSync(f,'utf8'); const fields=[...b.matchAll(/^\s*(\w+)\s*:\s*\{[^\n}]*\bindex\s*:\s*true/gm)].map(m=>m[1]); const singles=[...b.matchAll(/\.index\(\s*\{\s*(\w+)\s*:\s*1\s*\}/g)].map(m=>m[1]); assert(!fields.some(n=>singles.includes(n)),path.relative(root,f)); }});
check('historical launch audits are removed',()=>{ const current=`FINAL-LAUNCH-AUDIT-v${pkg.version}.md`; assert(!fs.readdirSync(root).some(n=>/^FINAL-LAUNCH-AUDIT-v/.test(n)&&n!==current)); });
check('only current production audit is present',()=>assert(fs.existsSync(path.join(root,'FINAL-LAUNCH-AUDIT-v1.6.82.md'))));
check('version-numbered regression scripts are removed',()=>assert(!fs.readdirSync(path.join(root,'scripts')).some(n=>/^check-v\d+/.test(n))));
check('version-numbered npm check aliases are removed',()=>assert(!Object.keys(scripts).some(k=>/^check:v\d+/.test(k))));
check('legacy verify alias is removed',()=>assert(!scripts['verify:legacy']));
check('stable production checks exist',()=>{assert(scripts['check:public-performance']);assert(scripts['check:public-layout-content']);assert(scripts['check:runtime-network']);assert(scripts['check:production-cleanup']);});
check('confirmed unused legacy icon is removed',()=>assert(!fs.existsSync(path.join(root,'public/images/classic-trip-icon.svg'))));
check('no zero-byte project files remain',()=>assert(!walk(root).some(f=>fs.statSync(f).size===0)));
check('no empty project directories remain',()=>assert(emptyDirs(root).length===0));
check('no backup/temp/editor residue files remain',()=>assert(!walk(root).some(f=>/(?:~|\.bak|\.old|\.orig|\.rej|\.tmp|\.temp|\.log|\.DS_Store|Thumbs\.db)$/i.test(f))));
check('all declared dependencies are referenced by code',()=>{const source=walk(root).filter(f=>/\.(?:js|ejs)$/.test(f)).map(f=>fs.readFileSync(f,'utf8')).join('\n'); for(const dep of Object.keys(pkg.dependencies||{})){const esc=dep.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');assert(new RegExp(`require\\(\\s*['\"]${esc}['\"]|from\\s+['\"]${esc}['\"]`).test(source),dep);}});
check('service worker cache matches current release',()=>assert(read('public/sw.js').includes(`classic-trip-static-v${pkg.version}`)));
check('release check keeps production vulnerability audit',()=>assert(scripts['release:check']==='npm run verify && npm run audit:production'));
if(!process.exitCode) console.log(`\n${passed}/${passed} production cleanup checks passed.`);
