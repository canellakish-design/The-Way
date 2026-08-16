// zones.test.js — the FTP / zone math, checked against synthetic streams.
// Run: node bridge/zones.test.js   (no framework, exits non-zero on failure)
const Z = require('./zones');

let failed = 0;
const ok = (label, cond, extra = '') => {
  if (!cond) failed++;
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (extra ? '  ' + extra : ''));
};
const ok2 = ok;


// --- normalized power: steady 200W must equal 200 ---
const steady = Array(1800).fill(200);
ok('NP of steady 200W = 200', Z.normalizedPower(steady) === 200, 'got '+Z.normalizedPower(steady));

// NP of a surging ride exceeds its average
const surge = []; for (let i=0;i<1800;i++) surge.push(i%120<60 ? 100 : 300);
const npS = Z.normalizedPower(surge), avgS = surge.reduce((a,b)=>a+b,0)/surge.length;
ok('NP > average on a surging ride', npS > avgS, `NP ${npS} vs avg ${Math.round(avgS)}`);

// --- §2b: a 20-min best at 280W should give FTP 280*0.95 = 266 ---
const ride20 = Array(600).fill(150).concat(Array(1200).fill(280), Array(600).fill(150));
let efforts = Z.effortsFromRide(ride20, Array(2400).fill(160), {activity_id:1, at:new Date().toISOString(), name:'20min test'});
const e20 = efforts.find(e=>e.minutes===20);
ok('20-min effort found', !!e20, JSON.stringify(e20));
ok('20-min correction ×0.95 applied', e20 && e20.estimate === Math.round(280*0.95), 'estimate '+(e20&&e20.estimate));
ok('20-min effort qualifies (steady)', e20 && e20.qualifying === true, 'VI '+(e20&&e20.vi));
ok('avg HR captured from the same window', e20 && e20.avg_hr === 160, 'hr '+(e20&&e20.avg_hr));

// --- 45-min effort: no correction ---
const ride45 = Array(300).fill(120).concat(Array(2700).fill(260), Array(300).fill(120));
const e45 = Z.effortsFromRide(ride45, null, {activity_id:2, at:new Date().toISOString()}).find(e=>e.minutes===45);
ok('45-min effort: no discount', e45 && e45.estimate === 260, 'estimate '+(e45&&e45.estimate));
ok('duration correction interpolates', Z.durationCorrection(30) > 0.95 && Z.durationCorrection(30) < 1.0, Z.durationCorrection(30).toFixed(3));

// --- a ragged interval session should NOT qualify ---
const ragged = []; for (let i=0;i<1800;i++) ragged.push(i%120<60 ? 80 : 400);
const eR = Z.effortsFromRide(ragged, null, {activity_id:3, at:new Date().toISOString()}).find(e=>e.minutes===20);
ok('ragged intervals rejected (VI > 1.2)', eR && eR.qualifying === false, 'VI '+(eR&&eR.vi));

// --- decayed peak: an old effort is worth less than a fresh smaller one ---
const now = new Date();
const ago = d => new Date(now.getTime()-d*864e5).toISOString();
const mix = [
  {minutes:20, estimate:300, qualifying:true, at:ago(80), avg_hr:170},
  {minutes:20, estimate:290, qualifying:true, at:ago(2),  avg_hr:168}
];
const dec = Z.eftpFromEfforts(mix, now.toISOString());
ok('decay applied to the 80-day-old peak', dec.ftp < 300, 'eFTP '+dec.ftp+' decay '+dec.decay);
ok('efforts older than the 90d lookback drop out',
   Z.eftpFromEfforts([{minutes:20,estimate:400,qualifying:true,at:ago(120)}], now.toISOString()) === null);

// --- §4 / §5 zones ---
const pz = Z.powerZones(266);
ok('7 power zones', pz.length===7);
ok('Z4 threshold = 90–105% FTP', pz[3].from===Math.round(266*0.90) && pz[3].to===Math.round(266*1.05), JSON.stringify(pz[3]));
ok('Z7 open-ended', pz[6].to===null && pz[6].from===Math.round(266*1.5));
const hz = Z.hrZones(172);
ok('HR Z4 SubThreshold 95–100% LT', hz[3].from===Math.round(172*0.95) && hz[3].to===172, JSON.stringify(hz[3]));
ok('HR zones anchored to threshold, not max', Z.hrZones(172)[4].from===172);

// --- §2a test-derived ---
const t = Z.ftpFromTest({vt2_power:300, vt2_hr:175, date:new Date().toISOString()});
ok('FTP_test = VT2 × 0.925', t.ftp === Math.round(300*0.925), 'got '+t.ftp);
ok('threshold HR takes no discount', t.threshold_hr === 175);

// --- §2d reconciliation ---
let r = Z.reconcile({test:{ftp:278, threshold_hr:175, at:ago(10)}, eftp:{ftp:258, from:{minutes:20}, avg_hr:170}, ventilatory:{ok:true, ftp:256}});
ok('fresh test wins', r.ftp===278 && /dedicated test/.test(r.source), r.source);
ok('retest prompt when both continuous signals agree and diverge >5%',
   r.notes.some(n=>/consider retesting/i.test(n)), JSON.stringify(r.notes));
r = Z.reconcile({test:{ftp:278, threshold_hr:175, at:ago(200)}, eftp:{ftp:266, from:{minutes:20}, avg_hr:170}});
ok('stale test steps aside for eFTP', r.ftp===266 && /eFTP/.test(r.source), r.source);
ok('stale test explained in notes', r.notes.some(n=>/beyond the 60-day/.test(n)));
ok('threshold HR from eFTP is labelled as a stand-in', /not a measured VT2/.test(r.threshold_hr_source||''));
r = Z.reconcile({override:{ftp:300, threshold_hr:178}, eftp:{ftp:266, from:{minutes:20}}});
ok('manual override wins everything', r.ftp===300 && r.confidence==='pinned');
r = Z.reconcile({});
ok('no signals -> null FTP, honest note', r.ftp===null && r.confidence==='none');

// --- §2c ventilatory ---
// VE rises gently to 220W, then steeply (VT2-ish inflection)
const segs = [];
for (let p=120; p<=300; p+=20){
  const ve = p<=220 ? 30 + (p-120)*0.20 : 50 + (p-220)*0.85;
  segs.push({power:p, ve, at:new Date().toISOString()});
  segs.push({power:p+5, ve:ve+1, at:new Date().toISOString()});
}
const vt = Z.ventilatoryBreakpoints(segs, 266);
ok('single-inflection fixture reports VT1 only, no invented VT2', !vt.ok && /no second inflection/.test(vt.reason||''), JSON.stringify({vt1:vt.vt1_power, reason:vt.reason}));
const low = Z.ventilatoryBreakpoints(segs.filter(s=>s.power<200), 266);
ok('§2c.7 refuses VT2 without data above 85% FTP', !low.ok && /insufficient range/.test(low.reason||''), low.reason);
ok('too few segments -> refuses', !Z.ventilatoryBreakpoints(segs.slice(0,3), 266).ok);

// confound flagging
const wellness = [];
for (let i=0;i<30;i++) wellness.push({date:new Date(now.getTime()-i*864e5).toISOString().slice(0,10), hrv:70, rhr:48});
wellness[0] = {date:new Date().toISOString().slice(0,10), hrv:30, rhr:60};
const flagged = Z.flagConfounded([{power:200, ve:60, at:new Date().toISOString()}], wellness);
ok('low-HRV day flagged as confounded', flagged[0].confounded===true);

// --- steady segment extraction: trims the breathing lag ---
const w = Array(600).fill(200), v = Array(600).fill(0).map((_,i)=> i<75 ? 30 : 60);
const ss = Z.steadySegments(w, v, {at:new Date().toISOString()});
ok('segment extracted with lag trimmed', ss.length===1 && ss[0].ve===60, JSON.stringify(ss));

// --- resampling gaps ---
const rs = Z.resample1Hz([0,1,2,50,51], [100,100,100,200,200]);
ok('stopped time counted as zero, not held', rs.length===52 && rs[10]===0 && rs[50]===200, 'len '+rs.length);


/* ---- ventilatory curve: shape, noise, refusal ---- */
{

const at = new Date().toISOString();

// Two-inflection curve: VT1 at 180W, VT2 at 250W (what a real VE curve looks like)
const ve = p => p<=180 ? 30+(p-100)*0.15 : p<=250 ? 42+(p-180)*0.35 : 66.5+(p-250)*1.1;
const segs = [];
for (let p=100; p<=310; p+=10) segs.push({power:p, ve:ve(p), at});
let r = Z.ventilatoryBreakpoints(segs, 266);
ok('two inflections found', r.ok, JSON.stringify({vt1:r.vt1_power, vt2:r.vt2_power, ftp:r.ftp}));
ok('VT1 near 180W', r.ok && Math.abs(r.vt1_power-180)<=20, 'vt1 '+r.vt1_power);
ok('VT2 near 250W', r.ok && Math.abs(r.vt2_power-250)<=20, 'vt2 '+r.vt2_power);
ok('FTP = VT2 × 0.925', r.ok && r.ftp===Math.round(r.vt2_power*0.925), 'ftp '+r.ftp);

// noisy version (±8% VE noise, deterministic)
const noisy = [];
let seed=1; const rnd=()=>{seed=(seed*1103515245+12345)%2147483648; return seed/2147483648;};
for (let p=100; p<=310; p+=5) noisy.push({power:p, ve:ve(p)*(0.92+0.16*rnd()), at});
r = Z.ventilatoryBreakpoints(noisy, 266);
ok('survives ±8% noise', r.ok && Math.abs(r.vt2_power-250)<=30, JSON.stringify({vt1:r.vt1_power, vt2:r.vt2_power, ok:r.ok, reason:r.reason}));

// single inflection: should report VT1 only, not invent a VT2
const single = [];
for (let p=120; p<=310; p+=10) single.push({power:p, ve: p<=220 ? 30+(p-120)*0.20 : 50+(p-220)*0.85, at});
r = Z.ventilatoryBreakpoints(single, 266);
ok('single inflection -> VT1 only, no invented VT2', !r.ok && /no second inflection/.test(r.reason||''), JSON.stringify({vt1:r.vt1_power, reason:r.reason}));

// a purely linear curve has no breakpoint at all
const linear = [];
for (let p=120; p<=310; p+=10) linear.push({power:p, ve:30+(p-120)*0.4, at});
r = Z.ventilatoryBreakpoints(linear, 266);
ok('linear VE -> no breakpoint claimed', !r.ok, r.reason);

// §2d retest prompt, with data that actually diverges >5%
let rec = Z.reconcile({test:{ftp:278, threshold_hr:175, at:new Date(Date.now()-10*864e5).toISOString()},
  eftp:{ftp:258, from:{minutes:20}, avg_hr:170}, ventilatory:{ok:true, ftp:256}});
ok('retest prompt at >5% divergence', rec.notes.some(n=>/consider retesting/i.test(n)), JSON.stringify(rec.notes));
ok('test still wins the displayed number', rec.ftp===278);
rec = Z.reconcile({test:{ftp:278, threshold_hr:175, at:new Date(Date.now()-10*864e5).toISOString()},
  eftp:{ftp:266, from:{minutes:20}, avg_hr:170}, ventilatory:{ok:true, ftp:264}});
ok('no prompt when divergence is under 5%', !rec.notes.some(n=>/consider retesting/i.test(n)), JSON.stringify(rec.notes));



}

/* ---- noise sweep: it must never be confidently wrong ---- */
{

const at = new Date().toISOString();
const ve = p => p<=180 ? 30+(p-100)*0.15 : p<=250 ? 42+(p-180)*0.35 : 66.5+(p-250)*1.1;
const mk = (seed, noise, step=5) => {
  let s = seed; const rnd=()=>{s=(s*1103515245+12345)%2147483648; return s/2147483648;};
  const out=[]; for(let p=100;p<=310;p+=step) out.push({power:p, ve:ve(p)*(1-noise+2*noise*rnd()), at});
  return out;
};
for (const noise of [0, 0.04, 0.08, 0.12]) {
  let hits=0, refused=0, wrong=0; const seen=[];
  for (let seed=1; seed<=25; seed++) {
    const r = Z.ventilatoryBreakpoints(mk(seed, noise), 266);
    if (!r.ok) { refused++; continue; }
    seen.push(r.vt2_power);
    if (Math.abs(r.vt2_power-250) <= 30) hits++; else wrong++;
  }
  ok(`noise ±${(noise*100).toFixed(0)}%: never confidently wrong (refusing is fine)`, wrong === 0,
    `found ${hits}/25 · refused ${refused} · wrong ${wrong}` + (wrong ? '  bad: '+seen.filter(v=>Math.abs(v-250)>30).join(',') : ''));
}
// clean curve still exact
const c = Z.ventilatoryBreakpoints(mk(1,0,10), 266);
ok('clean curve resolves VT1 and VT2', c.ok && c.vt1_power < c.vt2_power, JSON.stringify({vt1:c.vt1_power, vt2:c.vt2_power, ftp:c.ftp}));
// single inflection and linear must still refuse
const single=[]; for(let p=120;p<=310;p+=10) single.push({power:p, ve:p<=220?30+(p-120)*0.2:50+(p-220)*0.85, at});
const s1 = Z.ventilatoryBreakpoints(single,266);
ok('single inflection refused, VT1 reported', !s1.ok, 'vt1='+s1.vt1_power);
const lin=[]; for(let p=120;p<=310;p+=10) lin.push({power:p, ve:30+(p-120)*0.4, at});
const l1 = Z.ventilatoryBreakpoints(lin,266);
ok('linear VE refused', !l1.ok, l1.reason);



}

console.log(failed ? `\n${failed} FAILED` : '\nall passing');
process.exit(failed ? 1 : 0);
