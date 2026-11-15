/* races.js — the race calendar (Harry, 14 Nov 2026: "Let's build a race calendar section to this site").
   One page, #races:
     the season clock   the A race the season is built around, how far out it is, and the phase that puts him in
     next up            the next race on the calendar, with its countdown and the link to enter
     the season         every race ahead, month by month; a tap opens one to change it, mark it or take it off
     add a race         name and date are enough; the kind is read from the name when he leaves it
     results            races behind him, with the place he took
     where to find them the calendars worth checking for this part of the country (bridge/races.js SOURCES)
   The coach knows what is on it and can add one when asked ("add the Greenbelt crit on May 6 as a B race"). */
(function(){
  const J = { "Content-Type": "application/json" };
  const MON = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const dOf = k => new Date(k + "T12:00:00");
  const dayWord = k => dOf(k).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const out = r => r.days_out === 0 ? "today" : r.days_out === 1 ? "tomorrow" : r.days_out < 15 ? `${r.days_out} days` : `${Math.round(r.weeks_out)} weeks`;
  const PRI = { A: ["A race", "hu-go"], B: ["B race", "hu-hold"], C: ["C race", "hu-dim"] };
  const chip = (t, cls) => `<span class="hu-chip ${cls || "hu-dim"}">${esc(t)}</span>`;
  const facts = r => [r.location, r.distance_mi ? `${r.distance_mi} mi` : "", r.climb_ft ? `${Number(r.climb_ft).toLocaleString()} ft up` : "", r.minutes ? `about ${r.minutes} min` : "", r.category].filter(Boolean).map(esc).join(" · ");
  const clock12 = t => { const m = /^(\d\d):(\d\d)/.exec(t || ""); if (!m) return t || ""; let h = +m[1]; const ap = h < 12 ? "a" : "p"; h = h % 12 || 12; return `${h}:${m[2]}${ap}`; };
  const msgOf = e => String(e && e.message || e).replace(/^bridge \d+ — /, "");

  // the form, for a new race or one being changed
  const form = (r, kinds, statuses) => { const v = r || {}, id = v.id || "new";
    return `<div class="rc-form" data-form="${id}">
      <label>Race</label><input data-f="name" value="${attr(v.name || "")}" placeholder="Poolesville Road Race">
      <div class="row2"><span><label>Date</label><input data-f="date" type="date" value="${attr(v.date || "")}"></span>
        <span><label>How much it matters</label><select data-f="priority">${["A","B","C"].map(p => `<option value="${p}"${(v.priority || "B") === p ? " selected" : ""}>${p === "A" ? "A: the season builds to it" : p === "B" ? "B: raced properly" : "C: training with a number"}</option>`).join("")}</select></span></div>
      <div class="row2"><span><label>Kind</label><select data-f="kind"><option value="">from the name</option>${kinds.map(k => `<option${v.kind === k ? " selected" : ""}>${esc(k)}</option>`).join("")}</select></span>
        <span><label>Where</label><input data-f="location" value="${attr(v.location || "")}" placeholder="Poolesville, MD"></span></div>
      <div class="row2"><span><label>Miles</label><input data-f="distance_mi" type="number" step="0.1" inputmode="decimal" value="${v.distance_mi != null ? attr(v.distance_mi) : ""}"></span>
        <span><label>Feet of climbing</label><input data-f="climb_ft" type="number" step="10" inputmode="numeric" value="${v.climb_ft != null ? attr(v.climb_ft) : ""}"></span></div>
      <div class="row2"><span><label>Your category</label><input data-f="category" value="${attr(v.category || "")}" placeholder="Masters 45+"></span>
        <span><label>Status</label><select data-f="status">${statuses.map(s => `<option${(v.status || "planned") === s ? " selected" : ""}>${s}</option>`).join("")}</select></span></div>
      <label>Link to enter</label><input data-f="url" type="url" inputmode="url" value="${attr(v.url || "")}" placeholder="https://www.bikereg.com/…">
      <label>Notes</label><textarea data-f="notes" rows="2" placeholder="The course, who is going, what you want from it">${esc(v.notes || "")}</textarea>
      ${r && r.past ? `<div class="row2"><span><label>Place</label><input data-f="place" type="number" inputmode="numeric" value="${v.result && v.result.place != null ? attr(v.result.place) : ""}"></span>
        <span><label>Of how many</label><input data-f="field" type="number" inputmode="numeric" value="${v.result && v.result.field != null ? attr(v.result.field) : ""}"></span></div>
        <label>How it went</label><textarea data-f="rnotes" rows="2">${esc(v.result && v.result.notes || "")}</textarea>` : ""}
      <div class="rc-acts"><button class="primary" data-save="${id}">${r ? "Save" : "Add to the calendar"}</button>${r ? `<button data-del="${id}" class="rc-del">Take it off</button>` : ""}<span class="small" data-msg="${id}"></span></div>
    </div>`; };
  const readForm = (el, past) => { const g = f => { const x = el.querySelector(`[data-f="${f}"]`); return x ? x.value.trim() : ""; };
    const b = { name: g("name"), date: g("date"), priority: g("priority"), location: g("location"), category: g("category"), status: g("status"), url: g("url"), notes: g("notes"),
      distance_mi: g("distance_mi") === "" ? null : +g("distance_mi"), climb_ft: g("climb_ft") === "" ? null : +g("climb_ft") };
    if (g("kind")) b.kind = g("kind");
    if (past) b.result = (g("place") || g("rnotes")) ? { place: g("place") ? +g("place") : null, field: g("field") ? +g("field") : null, notes: g("rnotes") } : null;
    return b; };

  const row = (r, d) => `<details class="rc-row${r.status === "skipped" ? " skipped" : ""}" data-race="${r.id}">
      <summary><span class="rc-when"><b>${esc(dayWord(r.date))}</b><i>${r.past ? esc(String(dOf(r.date).getFullYear())) : esc(out(r))}</i></span>
        <span class="rc-what"><b>${esc(r.name)}</b><i>${chip(PRI[r.priority][0], PRI[r.priority][1])}${chip(r.kind)}${r.status === "registered" ? chip("entered", "hu-go") : r.status === "idea" ? chip("idea") : r.status === "skipped" ? chip("skipped", "hu-stop") : ""}${r.crowded ? chip("close to another", "hu-hold") : ""}${r.result && r.result.place ? chip(`${r.result.place}${r.result.field ? " of " + r.result.field : ""}`, "hu-go") : ""}</i>
          ${facts(r) ? `<span class="small">${facts(r)}</span>` : ""}</span></summary>
      ${r.notes ? `<div class="small rc-notes">${esc(r.notes)}</div>` : ""}${r.result && r.result.notes ? `<div class="small rc-notes">${esc(r.result.notes)}</div>` : ""}
      ${r.url ? `<a class="btn primary rc-enter" href="${attr(r.url)}" target="_blank" rel="noopener">${r.past ? "The race's page" : r.status === "registered" ? "Your entry" : "Enter"}</a>` : ""}
      ${form(r, d.kinds, d.statuses)}</details>`;

  V.races = async function(){
    view.innerHTML = `<div id="racePage" class="ln-page"><div class="ln-ttl"><h2 class="ln-h">Races</h2></div><div class="card"><div class="small">loading…</div></div></div>`;
    const el = document.getElementById("racePage");
    let wasNear = false, nearKind = "";
    const draw = async (keepOpen) => {
      let d; try { d = await bridge("/races"); } catch (e) { el.innerHTML = `<div class="ln-ttl"><h2 class="ln-h">Races</h2></div><div class="card"><div class="small">The race calendar could not be read: ${esc(msgOf(e))}</div></div>`; return; }
      const c = d.clock, n = d.next, byMonth = {};
      for (const r of d.upcoming) (byMonth[r.date.slice(0, 7)] = byMonth[r.date.slice(0, 7)] || []).push(r);
      el.innerHTML = `<div class="ln-ttl"><h2 class="ln-h">Races</h2>${chip(c.phase, c.name ? "hu-go" : "hu-dim")}</div>
        <div class="hu-fields rc-clock">
          <div class="hu-field big"><span class="k">${c.name ? "The season builds to" : "The season"}</span><span class="n ${c.name ? "" : "hu-dim"}">${c.name ? esc(c.name) : "No A race set"}</span><span class="u">${c.name ? `${esc(dayWord(c.date))} · ${c.weeks_out} weeks out` : "base until one is set"}</span></div>
        </div>
        <div class="small rc-word">${esc(c.word.charAt(0).toUpperCase() + c.word.slice(1))}.</div>
        ${n ? `<div class="card rc-next"><span class="eyebrow">Next up</span>
            <div class="rc-nexthead"><div><h3>${esc(n.name)}</h3><div class="small">${esc(dayWord(n.date))}${facts(n) ? " · " + facts(n) : ""}</div><div class="rc-chips">${chip(PRI[n.priority][0], PRI[n.priority][1])}${chip(n.kind)}${n.status === "registered" ? chip("entered", "hu-go") : ""}</div></div>
              <div class="rc-count"><b>${n.days_out}</b><i>${n.days_out === 1 ? "day" : "days"}</i></div></div>
            ${n.url ? `<a class="btn primary" href="${attr(n.url)}" target="_blank" rel="noopener">${n.status === "registered" ? "Your entry" : "Enter"}</a>` : ""}</div>` : ""}
        <span class="eyebrow rc-eye">The season</span>
        ${d.upcoming.length ? Object.keys(byMonth).sort().map(m => `<div class="rc-month">${MON[+m.slice(5) - 1]} ${m.slice(0, 4)}</div>${byMonth[m].map(r => row(r, d)).join("")}`).join("")
          : `<div class="card"><div class="small">Nothing on the calendar yet. Pick from the races near you below, add one by hand, or tell the coach: "add the Poolesville Road Race on April 24 as my A race".</div></div>`}
        <details class="ln-fold rc-near" id="rcNear"${d.upcoming.length ? "" : " open"}><summary>Find races near you</summary><div id="rcFound"><div class="small">Open to read what is open for entry within about three hours of home.</div></div></details>
        <details class="ln-fold rc-add"><summary>Add a race by hand</summary>${form(null, d.kinds, d.statuses)}</details>
        ${d.past.length ? `<span class="eyebrow rc-eye">Behind you</span>${d.past.map(r => row(r, d)).join("")}` : ""}
        <details class="why rc-find"><summary>where to find races</summary><div class="small" id="rcSources">${sourcesHTML(d.sources)}</div></details>`;
      // what is open for entry near him (BikeReg, through the bridge): read when the fold is opened, by kind
      const near = document.getElementById("rcNear"); if (wasNear) near.open = true;
      const loadNear = async kind => { const box = document.getElementById("rcFound"); if (!box) return; nearKind = kind || "";
        box.innerHTML = `<div class="small">reading the race listings…</div>`;
        let f; try { f = await bridge("/races/find" + (kind ? "?kind=" + encodeURIComponent(kind) : "")); } catch (e) { box.innerHTML = `<div class="small">The listings could not be read: ${esc(msgOf(e))}</div>`; return; }
        const kinds = Object.keys(f.counts || {}), hrs = h => h == null ? "" : h < 1 ? `${Math.round(h * 60)} min` : `${h} h`;
        box.innerHTML = `<div class="rc-kinds"><button data-kind="" class="${kind ? "" : "on"}">all</button>${kinds.map(k => `<button data-kind="${attr(k)}" class="${kind === k ? "on" : ""}">${esc(k)} · ${f.counts[k]}</button>`).join("")}</div>
          ${f.note ? `<div class="small">${esc(f.note)}</div>` : ""}
          ${f.events.length ? f.events.slice(0, 60).map(e => `<div class="rc-found">
              <div class="rc-fhead"><span class="rc-when"><b>${esc(dayWord(e.date))}</b><i>${esc(String(dOf(e.date).getFullYear()))}</i></span>
                <span class="rc-what"><b>${esc(e.name)}</b><span class="small">${esc(e.where)}${e.miles != null ? ` · ${e.miles} mi, about ${hrs(e.drive_h)} drive` : ""}</span>
                  <i>${chip(e.kind)}${e.masters.length ? e.masters.slice(0, 2).map(m => chip(m.name + (m.start ? " · " + clock12(m.start) : ""), "hu-go")).join("") : chip("no masters field listed")}${e.reg_close && e.reg_close >= d.today ? chip("entry closes " + dayWord(e.reg_close), "hu-hold") : ""}</i></span></div>
              <div class="rc-facts"><a class="btn" href="${attr(e.url)}" target="_blank" rel="noopener">Open on BikeReg</a>${e.on_calendar ? `<span class="small">on your calendar</span>` : `<button class="primary" data-take="${attr(e.id)}">Add to my calendar</button>`}<span class="small" data-tmsg="${attr(e.id)}"></span></div></div>`).join("")
            : `<div class="small">Nothing listed${kind ? " for " + esc(kind) : ""} within reach right now.</div>`}
          <div class="small rc-fromnote">From BikeReg, read ${esc(new Date(f.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))}. Drive times are a rough guide from the distance. Road races for next season appear as promoters open entry, mostly from January.</div>`;
        box.querySelectorAll("[data-kind]").forEach(b => b.onclick = () => loadNear(b.dataset.kind));
        box.querySelectorAll("[data-take]").forEach(b => b.onclick = async () => { const e = f.events.find(x => x.id === b.dataset.take), m = box.querySelector(`[data-tmsg="${b.dataset.take}"]`); if (!e) return;
          b.disabled = true; m.textContent = "adding…";
          const first = e.masters[0];
          try { await bridge("/races", { method: "POST", headers: J, body: JSON.stringify({ name: e.name.replace(/\s+--\s+Event #\d+.*$/i, ""), date: e.date, kind: e.kind, priority: "C", status: "idea", location: e.where, url: e.url,
              category: first ? first.name : "", notes: [first && first.start ? `Your field starts ${clock12(first.start)}` : "", first && first.fee ? `entry $${first.fee}` : "", e.reg_close ? `entry closes ${dayWord(e.reg_close)}` : "", e.miles != null ? `about ${hrs(e.drive_h)} drive` : ""].filter(Boolean).join("; ") }) });
            wasNear = true; await draw(); }
          catch (err) { m.textContent = msgOf(err); b.disabled = false; } });
      };
      near.addEventListener("toggle", () => { wasNear = near.open; if (near.open && !near.dataset.loaded) { near.dataset.loaded = "1"; loadNear(nearKind); } });
      if (near.open) { near.dataset.loaded = "1"; loadNear(nearKind); }
      if (keepOpen) { const o = el.querySelector(`[data-race="${keepOpen}"]`); if (o) o.open = true; }
      // save (new or changed), take off
      el.querySelectorAll("[data-save]").forEach(b => b.onclick = async () => {
        const id = b.dataset.save, f = el.querySelector(`[data-form="${id}"]`), m = el.querySelector(`[data-msg="${id}"]`), race = d.upcoming.concat(d.past).find(x => x.id === id);
        const body = readForm(f, race && race.past);
        if (!body.name) { m.textContent = "It needs a name."; return; } if (!body.date) { m.textContent = "It needs its date."; return; }
        m.textContent = "saving…"; b.disabled = true;
        try { if (id === "new") await bridge("/races", { method: "POST", headers: J, body: JSON.stringify(body) }); else await bridge("/races/" + encodeURIComponent(id), { method: "PUT", headers: J, body: JSON.stringify(body) }); await draw(); }
        catch (e) { m.textContent = msgOf(e); b.disabled = false; } });
      el.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
        const id = b.dataset.del, m = el.querySelector(`[data-msg="${id}"]`);
        if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "Tap again to take it off"; return; }
        m.textContent = "removing…"; try { await bridge("/races/" + encodeURIComponent(id), { method: "DELETE" }); await draw(); } catch (e) { m.textContent = msgOf(e); } });
    };
    await draw();
  };
  // the calendars worth checking, as the bridge lists them (each: name, url, what it is good for)
  function sourcesHTML(list){
    if (!list || !list.length) return "Ask the coach to research races for a month and a kind of racing; he can add the ones you pick.";
    return list.map(s => `<div class="rc-src"><a href="${attr(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a><span>${esc(s.what)}</span></div>`).join("");
  }
  // a line for other pages (the Day, the Calendar): the next race and how far out it is; nothing when there is none
  window.raceLine = async function(){
    try { const d = await bridge("/races"); const n = d && d.next; if (!n) return "";
      return `<a class="raceline" href="#races"><span class="hu-chip ${PRI[n.priority][1]}">${esc(n.priority)}</span><b>${esc(n.name)}</b><i>${n.days_out === 0 ? "today" : n.days_out === 1 ? "tomorrow" : "in " + esc(out(n))}</i></a>`; }
    catch (e) { return ""; }
  };
})();
