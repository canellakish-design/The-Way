"use strict";
/* THE WAY — the coach (#coach). Ask anything about training and food; the coach reads the whole site
   and the current research before it answers (bridge/coach.js). A question runs for a minute or more,
   so the page shows what the coach is reading while it works, then the call it makes (spoken), the
   written answer and its sources. Loads after app.js and uses its globals: V, view, bridge, esc, speak. */
(function(){
  const J = { "Content-Type": "application/json" };
  const alive = () => location.hash.split("?")[0] === "#coach";
  // a light reading of the coach's written answer: paragraphs, bold, bullet lines and links
  const md = t => esc(String(t || "")).split(/\n{2,}/).map(p => {
    const lines = p.split("\n");
    const html = lines.map(l => l.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>').replace(/(^|[\s(])(https?:\/\/[^\s)<]+)/g, '$1<a href="$2" target="_blank" rel="noopener">link</a>'));
    return lines.every(l => /^\s*[-•]\s/.test(l)) ? `<ul class="ch-ul">${html.map(l => `<li>${l.replace(/^\s*[-•]\s/, "")}</li>`).join("")}</ul>` : `<p>${html.join("<br>")}</p>`;
  }).join("");
  const split = t => { const m = /^\s*SAY:\s*([\s\S]*?)(?:\n\s*\n|$)/.exec(t || ""); return m ? { say: m[1].trim(), answer: t.slice(m.index + m[0].length).trim() } : { say: "", answer: t || "" }; };
  const turnHTML = (q, say, answer, sources, when) => `<div class="ch-turn">
      <div class="ch-q"><span class="hu-lab">You${when ? " · " + esc(when) : ""}</span><div>${esc(q)}</div></div>
      <div class="ch-a">${say ? `<div class="ch-say">${esc(say)}</div>` : ""}<div class="ch-body">${md(answer)}</div>
        ${sources && sources.length ? `<details class="why"><summary>sources · ${sources.length}</summary><ul class="ch-src">${sources.map(s => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title || s.url)}</a></li>`).join("")}</ul></details>` : ""}</div></div>`;
  const clock = iso => { const d = new Date(iso); if (isNaN(d)) return ""; let h = d.getHours(); const ap = h < 12 ? "a" : "p"; h = h % 12 || 12; return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${h}:${String(d.getMinutes()).padStart(2, "0")}${ap}`; };

  V.coach = async function(){
    view.innerHTML = `<div class="fd-ttl"><h2 class="fd-h">Coach</h2><span class="hu-chip hu-dim">reads the whole site · current research</span></div>
      <div class="ch-ask">
        <label for="chText" class="hu-lab">Ask your coach</label>
        <textarea id="chText" rows="3" placeholder="How is my week going? Why did my legs feel flat today? Should Thursday be hard or easy? Is my protein right for a 55-year-old in a deficit?"></textarea>
        <div class="ch-row"><button class="primary" id="chGo">Ask</button><span class="small" id="chHint">Takes a minute or two: it reads your data and the research first. It can also schedule, move and log your training and log food. Tap the keyboard's microphone to talk.</span></div>
        <div class="ch-chips">${["How is my week going?", "What should I eat before Thursday's VO2 session?", "Why is sleep breaking my chain, and what would fix it?", "Am I losing weight without losing power?", "I rode 45 minutes on Zwift at noon: log it", "Put a Zone 1, 90 min ride on Saturday at 9a"].map(q => `<button class="linkish ch-chip" data-q="${esc(q)}">${esc(q)}</button>`).join("")}</div>
      </div>
      <div id="chLive"></div>
      <div id="chThread"><div class="small">loading the conversation…</div></div>
      <details class="why" id="chNoteFold"><summary>the coach's notebook</summary><div id="chNotes" class="small">loading…</div></details>`;
    const box = document.getElementById("chText"), go = document.getElementById("chGo"), live = document.getElementById("chLive");
    view.querySelectorAll(".ch-chip").forEach(b => b.onclick = () => { box.value = b.dataset.q; box.focus(); });

    const drawThread = async () => {
      let th = null; try { th = await bridge("/coach/thread"); } catch {}
      const el = document.getElementById("chThread"); if (!el || !alive()) return;
      const turns = (th && th.turns) || [], pairs = [];
      for (let i = 0; i < turns.length; i++) if (turns[i].role === "user" && turns[i + 1] && turns[i + 1].role === "assistant") { pairs.push([turns[i], turns[i + 1]]); i++; }
      el.innerHTML = pairs.length ? pairs.reverse().map(([q, a]) => { const s = split(a.text); return turnHTML(q.text, s.say, s.answer, null, clock(q.at)); }).join("") : `<div class="small">Nothing asked yet.</div>`;
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
          live.innerHTML = turnHTML(job.text, job.say, job.answer, job.sources, "just now");
          if (job.say && typeof speak === "function") speak(job.say);
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
