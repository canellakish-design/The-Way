"use strict";
/* THE WAY — the coach (#coach). Ask anything about training and food; the coach reads the whole site
   and the current research before it answers (bridge/coach.js). A question runs for a minute or more,
   so the page shows what the coach is reading while it works, then the call it makes (spoken), the
   written answer and its sources. Loads after app.js and uses its globals: V, view, bridge, esc, speak.
   14 Nov 2026 ("combine all of these coach features"; the face always at the top): one Coach page for all of it.
     the face (face.js)       at the top, with "Where am I?" and what it is saying under it
     one box                  Ask: the quick conversation (voice.js: answers out loud in a sentence, can log or
                              change things); Hold to talk; Research it: the deep answer with sources (below)
     the conversation         the quick back and forth, newest at the bottom
     researched answers       the long answers with their sources, as before
   The round button anywhere in the app comes here on a tap and talks on a hold. */
(function(){
  const J = { "Content-Type": "application/json" };
  const alive = () => location.hash.split("?")[0] === "#coach";
  // a light reading of the coach's written answer: paragraphs, bold, bullet lines and links
  const md = t => esc(String(t || "")).split(/\n{2,}/).map(p => {
    const lines = p.split("\n");
    const html = lines.map(l => l.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>').replace(/(^|[\s(])(https?:\/\/[^\s)<]+)/g, '$1<a href="$2" target="_blank" rel="noopener">link</a>'));
    return lines.every(l => /^\s*[-•]\s/.test(l)) ? `<ul class="ch-ul">${html.map(l => `<li>${l.replace(/^\s*[-•]\s/, "")}</li>`).join("")}</ul>` : `<p>${html.join("<br>")}</p>`;
  }).join("");
  const split = t => { const m = /^\s*\**SAY:\**\s*([\s\S]*?)(?:\n\s*\n|$)/.exec(t || ""); return m ? { say: m[1].trim().replace(/\*\*/g, ""), answer: t.slice(m.index + m[0].length).trim() } : { say: "", answer: t || "" }; };
  // one exchange, folded: the question on one line; open, the coach's spoken call, and the write-up and
  // sources behind "more". Only the newest is open; the rest are a list of questions.
  const turnHTML = (q, say, answer, sources, when, open) => `<details class="ch-turn"${open ? " open" : ""}>
      <summary><span class="ch-qt">${esc(q)}</span>${when ? `<span class="ch-when">${esc(when)}</span>` : ""}</summary>
      ${say ? `<div class="ch-say">${esc(say)}</div>` : ""}
      ${answer || (sources && sources.length) ? `<details class="ch-more"${say ? "" : " open"}><summary>more</summary><div class="ch-body">${md(answer)}</div>
        ${sources && sources.length ? `<ul class="ch-src">${sources.map(s => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title || s.url)}</a></li>`).join("")}</ul>` : ""}</details>` : ""}
    </details>`;
  const clock = iso => { const d = new Date(iso); if (isNaN(d)) return ""; let h = d.getHours(); const ap = h < 12 ? "a" : "p"; h = h % 12 || 12; return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${h}:${String(d.getMinutes()).padStart(2, "0")}${ap}`; };

  V.coach = async function(){
    const SR = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    view.innerHTML = `<div class="fd-ttl ch-top"><h2 class="fd-h">Coach</h2><span class="vlinks">${SR ? `<button class="linkish" id="p_vHey">Hey Coach: off</button>` : ""}<button class="linkish" id="p_vNew">new conversation</button></span></div>
      <div class="chface" id="chFace"></div>
      <div class="vthread ch-conv" id="p_vThread"></div>
      <div class="vheard" id="p_vHeard"></div>
      <div class="ch-ask">
        <textarea id="chText" rows="2" aria-label="Ask your coach" placeholder="Ask anything, or tell it what you did"></textarea>
        <div class="ch-row"><button class="primary" id="chGo">Ask</button>${SR ? `<button class="vhold" id="p_vHold">Hold to talk</button>` : ""}<button id="chDeep" title="A longer answer: the coach reads the whole site and the research first (a minute or more)">Research it</button></div>
        <div class="small" id="p_vStatus"></div>
      </div>
      <div id="chLive"></div>
      <h3 class="ch-h3">Researched answers</h3>
      <div id="chThread"></div>
      <details class="why" id="chNoteFold"><summary>the coach's notebook</summary><div id="chNotes" class="small">loading…</div></details>`;
    const box = document.getElementById("chText"), go = document.getElementById("chDeep"), quick = document.getElementById("chGo"), live = document.getElementById("chLive");
    if (window.Face && Face.mount) Face.mount(document.getElementById("chFace"));
    if (window.voiceBits && voiceBits.mount) voiceBits.mount();
    // Ask: the quick conversation, spoken (voice.js); Enter sends it, Shift+Enter is a new line
    const askQuick = () => { const t = box.value.trim(); if (!t) { box.focus(); return; } if (window.primeSound) primeSound(); if (window.voiceBits) voiceBits.send(t); box.value = ""; };
    quick.onclick = askQuick;
    box.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); askQuick(); } });

    const drawThread = async () => {
      let th = null; try { th = await bridge("/coach/thread"); } catch {}
      const el = document.getElementById("chThread"); if (!el || !alive()) return;
      const turns = (th && th.turns) || [], pairs = [];
      for (let i = 0; i < turns.length; i++) if (turns[i].role === "user" && turns[i + 1] && turns[i + 1].role === "assistant") { pairs.push([turns[i], turns[i + 1]]); i++; }
      el.innerHTML = pairs.length ? pairs.reverse().map(([q, a], i) => { const s = split(a.text); return turnHTML(q.text, s.say, s.answer, null, clock(q.at), i === 0 && !live.innerHTML); }).join("") : "";
    };
    const drawNotes = async () => {
      let nb = null; try { nb = await bridge("/coach/notebook"); } catch {}
      const el = document.getElementById("chNotes"); if (!el) return;
      const n = (nb && nb.notes) || [];
      el.innerHTML = n.length ? `<ul class="ch-ul">${n.slice().reverse().map(x => `<li><b>${esc(x.kind)}</b> · ${esc(x.date)} · ${esc(x.note)}</li>`).join("")}</ul>` : "Empty so far: the coach writes here when you decide something together or it spots a pattern.";
    };

    const ask = async () => {
      const text = box.value.trim(); if (!text) { box.focus(); return; }
      go.disabled = true; if (window.primeSound) primeSound();
      live.innerHTML = `<div class="ch-work"><div class="ch-q"><span class="hu-lab">You</span><div>${esc(text)}</div></div><div class="ch-steps"><div class="small">starting…</div></div></div>`;
      let id = null;
      try { id = (await bridge("/coach/ask", { method: "POST", headers: J, body: JSON.stringify({ text }) })).id; }
      catch (e) { live.innerHTML = `<div class="small">Couldn't ask: ${esc(String(e.message).replace(/^bridge \d+ — /, ""))}</div>`; go.disabled = false; return; }
      box.value = "";
      const t0 = Date.now();
      const poll = async () => {
        if (!alive()) return;
        let job = null; try { job = await bridge("/coach/job/" + id); } catch {}
        const st = live.querySelector(".ch-steps");
        if (job && st) st.innerHTML = (job.steps || []).slice(-8).map(s => `<div class="ch-step">${esc(s)}</div>`).join("") + (job.status === "running" || job.status === "queued" ? `<div class="ch-step ch-now">thinking · ${Math.round((Date.now() - t0) / 1000)} s</div>` : "");
        if (job && job.status === "done"){
          live.innerHTML = turnHTML(job.text, job.say, job.answer, job.sources, "just now", true);
          drawThread();   // the earlier ones fold away under it
          if (job.say && typeof speak === "function") speak(job.say);
          if (job.say && window.Face && Face.caption) Face.caption(job.say);
          go.disabled = false; drawNotes(); return;
        }
        if (job && job.status === "error"){ live.innerHTML += `<div class="small hu-stop">The coach hit an error: ${esc(job.error || "")}. Ask again.</div>`; go.disabled = false; return; }
        if (Date.now() - t0 > 15.5 * 60 * 1000 || (job && job.status === "running" && job.started && Date.now() - new Date(job.started).getTime() > 15.5 * 60 * 1000)){ live.innerHTML += `<div class="small">No answer after sixteen minutes. Ask again.</div>`; go.disabled = false; return; }
        setTimeout(poll, 2500);
      };
      setTimeout(poll, 1500);
    };
    go.onclick = ask;
    drawThread(); drawNotes();
  };

  if (location.hash.replace(/^#/, "").split("?")[0] === "coach") nav();
})();
