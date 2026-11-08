// Agent page: run goals live (System 1 + System 2 / you), replay recorded runs before any download, inspect every
// decision, re-route stored decisions at other thresholds, what-if replays, session graph, export.
import { $, esc, pct, num, msText, settings, M, onModelsChanged, initModelCard, loadRecorded, loadTasks, loadNlp, loadS2, countTokens, download, bars } from "./common.js";
import { runAgent, split } from "./agent.js";
import { DEFAULTS, METRICS, score } from "./gate.js";
import { TOOL, TOOLS, FINISH } from "./tools/index.js";
import { memoryNotes } from "./tools/notes.js";
import { browserNotes } from "./notesdb.js";
import { renderTrace, renderSession, WHO } from "./graphs.js";
import { compactRun, reroute, stepQuestions, toTurtle } from "./trace.js";
import { evaluate } from "./metrics.js";
import { topOptions, ARG_PREFIX } from "./questions.js";
import { NONE, slotOptions } from "./candidates.js";

const PRESETS = [
  "에펠탑이 있는 도시의 이번 주말 날씨는?",
  "교토가 있는 나라의 인구는?",
  "아이폰을 만드는 회사의 CEO는 누구야?",
  "아이슬란드 인구의 15%는?",
  "2,450의 18%는 얼마야?",
  "5마일을 킬로미터로 바꿔줘",
  "3월 4일부터 3주 후는 무슨 날이야?",
  "마리 퀴리에 대해 알려줘",
  "파리에 있는 그 철탑은 얼마나 높아?",
  "제주도 날씨 알려줘",
  "내 북클럽 모임은 목요일이라고 기억해줘",
  "내 북클럽 모임은 언제야?",
  "치과 관련 메모를 모두 지워줘",
  "프리야에게 늦는다고 메시지 보내줘",
];

const S = {
  runs: [], current: null, running: false, abort: null, recorded: null, tasks: null, evalRecords: null,
  gate: { ...DEFAULTS, ...settings.get("gate", {}) }, sel: null, cy: null, cySession: null, tab: "trace", forcedAt: null,
};
const gateOpts = () => ({ ...S.gate });

// ---- gate controls ----------------------------------------------------------------------------------------------
function initGate() {
  const m = $("metric");
  for (const [k, v] of Object.entries(METRICS)) m.add(new Option(v, k));
  const sync = () => {
    $("tauAction").value = S.gate.tauAction; $("tauArg").value = S.gate.tauArg; $("tauStop").value = S.gate.tauStop; $("tauStopVal").textContent = num(S.gate.tauStop); m.value = S.gate.metric;
    $("useGoalMet").checked = S.gate.useGoalMet; $("useRisk").checked = S.gate.useRisk; $("maxSteps").value = String(S.gate.maxSteps);
    $("tauActionVal").textContent = num(S.gate.tauAction); $("tauArgVal").textContent = num(S.gate.tauArg);
  };
  sync();
  const upd = () => {
    S.gate = { ...S.gate, tauAction: +$("tauAction").value, tauArg: +$("tauArg").value, tauStop: +$("tauStop").value, metric: m.value, useGoalMet: $("useGoalMet").checked, useRisk: $("useRisk").checked, maxSteps: +$("maxSteps").value };
    settings.set("gate", S.gate); sync(); renderAll(false);
  };
  for (const id of ["tauAction", "tauArg", "tauStop"]) $(id).addEventListener("input", upd);
  for (const id of ["metric", "useGoalMet", "useRisk", "maxSteps"]) $(id).addEventListener("change", upd);
  for (const id of ["autoS2", "shadow", "rewrite"]) { $(id).checked = settings.get(id, false); $(id).addEventListener("change", () => settings.set(id, $(id).checked)); }
}

// ---- dialogs: you as the fallback decider, the guard, ask_user ---------------------------------------------------
function dialog(el) { return new Promise((res) => { el.returnValue = ""; el.addEventListener("close", () => res(el.returnValue), { once: true }); el.showModal(); }); }

async function humanDecide({ reasons, s1View: view, proposal, candidates }) {
  const dlg = $("decideDlg"), sel = $("decAction");
  $("decideWhy").innerHTML = (reasons || []).map((r) => `<li>${esc(r)}</li>`).join("") || "<li>System 2를 사용할 수 없습니다</li>";
  const top = view.top_actions.map((a) => a.action);
  const order = [...top, ...TOOLS.map((t) => t.id).filter((id) => !top.includes(id))];
  sel.innerHTML = order.map((id) => { const p = view.top_actions.find((a) => a.action === id)?.p; return `<option value="${id}">${esc(id)}${p != null ? ` (Laya p ${p.toFixed(2)})` : ""} · ${esc(TOOL[id].whenToUse)}</option>`; }).join("");
  sel.value = proposal?.action || top[0];
  const cands = candidates || [];
  const drawArgs = () => {
    const t = TOOL[sel.value];
    $("decArgs").innerHTML = t.slots.map((s) => {
      const pre = sel.value === proposal?.action && proposal.args?.[s.name] && proposal.args[s.name] !== NONE ? proposal.args[s.name] : "";
      if (s.fixed) return `<div class="field"><label>${esc(s.instruction)}</label><select data-slot="${s.name}">${Object.entries(s.fixed).map(([k, l]) => `<option value="${esc(k)}"${k === pre ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></div>`;
      const opts = Object.keys(slotOptions(s, cands)).filter((k) => k !== NONE);
      return `<div class="field"><label>${esc(s.instruction)}</label><input type="text" data-slot="${s.name}" list="dl_${s.name}" value="${esc(pre)}" required><datalist id="dl_${s.name}">${opts.map((o) => `<option value="${esc(o)}">`).join("")}</datalist></div>`;
    }).join("") + (t.id === "ask_user" ? `<div class="field"><label>물어볼 질문</label><input type="text" data-slot="question" value="조금 더 자세히 말씀해 주시겠어요?"></div>` : "");
  };
  sel.onchange = drawArgs; drawArgs();
  const v = await dialog(dlg);
  if (v !== "ok") return null;
  const args = {};
  for (const el of $("decArgs").querySelectorAll("[data-slot]")) args[el.dataset.slot] = el.value.trim();
  return { action: sel.value, args };
}

async function humanConfirm({ action, args, reason, decidedBy }) {
  $("confirmTxt").innerHTML = `<b>${esc(action)}</b>(${esc(Object.values(args || {}).join(", "))})<br><span class="hint">이 도구는 ${esc(reason.replace(/^\S+\s/, ""))}.</span>`;
  $("confirmWho").textContent = `${WHO[decidedBy] || decidedBy} 결정. 무언가를 바꾸는 도구는 항상 먼저 허락을 구합니다.`;
  return (await dialog($("confirmDlg"))) === "yes";
}

async function askUser(q) {
  $("askQ").textContent = q; $("askA").value = "";
  return (await dialog($("askDlg"))) === "ok" ? $("askA").value.trim() || null : null;
}

// ---- running -------------------------------------------------------------------------------------------------------
function s2Wrapper() {
  const lazy = $("autoS2").checked; // 원격 모델이라 WebGPU 게이트가 필요 없다
  if (!M.s2 && !lazy) return null;
  return {
    ready: () => !!M.s2 || lazy,
    async decide(p) { if (!M.s2) await loadS2(); if (!M.s2) throw new Error("System 2 did not load"); return M.s2.decide(p); },
    async rewrite(g, t, st) { if (!M.s2) throw new Error("no System 2"); return M.s2.rewrite(g, t, st); },
  };
}

function liveDeps(extra = {}) {
  return {
    laya: M.laya, nlp: M.nlp, countTokens: countTokens(), s2: s2Wrapper(),
    toolCtx: { notes: browserNotes, askUser },
    human: { decide: humanDecide, confirm: humanConfirm },
    ...extra,
  };
}

async function run({ goal, prefix, force, forcedAt } = {}) {
  goal = (goal ?? $("goal").value).trim();
  if (!goal || S.running) return;
  if (!M.laya) {
    const rec = S.recorded?.traces?.[goal];
    if (rec) return playback(rec);
    $("runHint").textContent = M.loading || M.loading1 ? "모델을 자동으로 준비하는 중입니다. 잠시 후 다시 눌러주세요." : "System 1(서버)에 연결되지 않았습니다. Ollama가 http://localhost:11434에서 실행 중인지 확인하고 새로 고침하세요.";
    return;
  }
  S.running = true; S.abort = new AbortController(); setBusy(true);
  S.forcedAt = forcedAt ?? null;
  const current = { goal, steps: [], outcome: null, source: "live", live: true };
  S.current = current; S.runs.push(current); resetInspector(); renderAll(true);
  $("runHint").textContent = force ? `가정 실행: ${forcedAt + 1}단계부터 ${force.action}(으)로 다시 실행합니다…` : "실행 중…";
  try {
    await loadNlp();
    const res = await runAgent(goal, liveDeps(), {
      ...gateOpts(), shadowRate: $("shadow").checked ? 0.1 : 0, rewrite: $("rewrite").checked, prefix, force, signal: S.abort.signal,
      onStep: (rec, steps) => { current.steps = steps.slice(); renderAll(true); },
    });
    Object.assign(current, res, { source: force ? "what-if" : "live" });
    $("runHint").textContent = `${msText(res.totalMs)} 만에 끝났습니다.`;
  } catch (e) {
    console.error(e); current.outcome = { kind: "error", text: String(e?.message || e) };
    $("runHint").textContent = "오류: " + (e?.message || e);
  } finally { S.running = false; setBusy(false); renderAll(true); refreshNotes(); }
}

async function playback(rec) {
  S.running = true; setBusy(true);
  const current = { ...rec, steps: [], outcome: null, source: "recorded" };
  S.current = current; S.runs.push(current); resetInspector(); renderAll(true); S.forcedAt = null;
  $("runHint").textContent = "같은 모델로 녹음한 실행을 재생합니다 (System 1을 불러오면 직접 실행할 수 있습니다).";
  for (const s of rec.steps) {
    if (!S.running) break;
    current.steps.push(s); renderAll(true);
    await new Promise((r) => setTimeout(r, 450));
  }
  current.outcome = rec.outcome; current.totalMs = rec.totalMs;
  S.running = false; setBusy(false); renderAll(true);
}

function resetInspector() {
  S.sel = null;
  $("inspector").innerHTML = `<p class="hint">노드를 클릭하세요: Laya가 답한 타입화된 질문, 선택지마다의 확률, 게이트의 이유, 보류된 단계라면 System 2의 프롬프트와 응답이 보입니다. 점선 마름모는 Laya가 고려한 다음 행동이며, 클릭하면 그 지점부터 다시 실행합니다.</p>`;
}

function setBusy(b) { $("runBtn").disabled = b; $("stopBtn").disabled = !b; }

async function whatIf(stepIndex, action) {
  if (!M.laya) { $("runHint").textContent = "가정 실행에는 System 1이 필요합니다. 아직 서버에 연결되지 않았습니다."; return; }
  if (S.running) return;
  const base = S.current;
  const prefix = base.steps.slice(0, stepIndex).map((s) => ({ ...s }));
  await run({ goal: base.goal, prefix, force: { action }, forcedAt: stepIndex });
}

// ---- rendering ------------------------------------------------------------------------------------------------------
function renderAll(traceChanged) {
  renderBanner(); renderEvalSummary();
  if (!S.current) return;
  renderAnswer(); renderSteps();
  if (S.tab === "trace") renderTraceGraph();
  if (S.tab === "session") renderSessionGraph();
  if (S.tab === "export") renderExport();
  if (S.sel != null) renderInspector(S.sel.kind, S.sel.step, S.sel.data);
}

function renderBanner() {
  const runs = S.runs.filter((r) => r.steps.length);
  const sp = split(runs);
  const med = (a) => { const v = [...a].sort((x, y) => x - y); return v.length ? v[Math.floor((v.length - 1) / 2)] : null; };
  const rows = [
    ["S1", "System 1", "c-s1", sp.S1, med(sp.ms.S1)],
    ["S2", "System 2", "c-s2", sp.S2, med(sp.ms.S2)],
    ["human", "사용자", "c-human", sp.human, null],
    ["guard", "승인 요청", "c-block", sp.blocked, null],
  ];
  $("splitRows").innerHTML = rows.map(([k, label, c, n, ms]) => {
    const f = sp.total ? n / sp.total : 0;
    return `<div class="srow"><span class="who"><i class="${c}"></i>${label}</span><span class="tr"><span class="f ${c}" style="width:${(f * 100).toFixed(1)}%"></span></span><span class="v">${sp.total ? pct(f) : "–"}</span><span class="ms">${k === "S1" || k === "S2" ? (ms != null ? `중앙값 ${msText(ms)}` : "") : `${n}단계`}</span></div>`;
  }).join("");
  const rec = runs.filter((r) => r.source === "recorded").length;
  $("bannerScope").textContent = runs.length ? `· 이 탭에서 ${runs.length}회 실행, ${sp.total}단계${rec ? ` (녹음 ${rec}회)` : ""}` : "· 아직 실행 없음";
  const rr = S.current ? reroute(S.current, gateOpts()).filter(Boolean) : [];
  const back = M.info ? `${M.info.backend === "webgpu" ? "WebGPU" : M.info.backend === "wasm" ? "WASM" : "Ollama 원격"} · ${M.info.variant}` : "recorded";
  $("bannerFoot").innerHTML = [
    `System 1 지연 시간 측정 환경: ${esc(back)}`,
    sp.shadowN ? `그림자 검사: 자동 단계 ${sp.shadowN}개 중 <b>${sp.shadowAgree}</b>개에서 System 2 동의` : `그림자 검사: <b>꺼짐</b> 또는 아직 없음`,
    rr.length ? `현재 게이트에서 이 실행: 자동 <b>${rr.filter((x) => x === "AUTO").length}</b>단계, 보류 <b>${rr.filter((x) => x === "HOLD").length}</b>단계` : "",
  ].filter(Boolean).map((t) => `<span>${t}</span>`).join("");
}

function renderEvalSummary() {
  const recs = S.evalRecords;
  if (!recs?.length) return;
  const test = recs.filter((r) => r.split === "test");
  const e = evaluate(test, gateOpts());
  const succ = e.routers.hybrid || e.routers.human;
  $("evalSummary").innerHTML = `<div class="row">
    <div><div class="l">System 1이 처리</div><div class="big">${pct(e.split.S1)}</div></div>
    <div><div class="l">자동 단계 오류율</div><div class="big">${pct(e.autoError)}</div></div>
    <div><div class="l">과제 성공률, ${e.hasS2 ? "S1 + S2" : "S1 + 사용자"}</div><div class="big">${pct(succ.rate)}</div></div>
    <div><div class="l">과제 성공률, S1 단독</div><div class="big">${pct(e.routers.s1.rate)}</div></div>
  </div><p class="hint">테스트 과제 ${e.n.tasks}개, ${e.n.steps}단계, ${esc(S.evalMeta || "")}. ${e.hasS2 ? "" : "이 녹음에는 System 2 응답이 없어 보류 단계는 사용자가 결정한 것으로(정답으로) 계산합니다. "}분담률은 오류율과 함께 볼 때만 의미가 있습니다.</p>`;
}

function renderAnswer() {
  const o = S.current.outcome;
  $("answerCard").hidden = !o;
  if (!o) return;
  const label = { answered: "답", refused: "가드가 멈춤", stopped: "멈춤", budget: "단계 예산 도달", error: "오류" }[o.kind] || o.kind;
  $("answer").innerHTML = `<div class="answerbox ${esc(o.kind)}"><div class="k">${label}${o.rewrittenBy ? " · System 2가 작성" : o.kind === "answered" ? " · 도구 결과에서 조립(템플릿)" : ""}${S.current.source === "recorded" ? " · 녹음된 실행" : ""}</div>
    <div class="t">${esc(o.text || "")}</div>
    ${o.templated ? `<div class="src">템플릿 답: ${esc(o.templated)}</div>` : ""}
    ${o.sources?.length ? `<div class="src">출처: ${o.sources.map((s) => `<a href="${esc(s)}" target="_blank" rel="noopener">${esc(s.replace(/^https?:\/\//, ""))}</a>`).join(" · ")}</div>` : ""}</div>`;
}

function renderSteps() {
  const rr = reroute(S.current, gateOpts());
  $("stepList").innerHTML = S.current.steps.map((s, i) => `<li class="${esc(s.decidedBy)}${S.sel?.step === s.index ? " sel" : ""}" data-step="${s.index}">
    <div class="h"><b>#${s.index + 1}</b><span class="chip ${esc(s.decidedBy)}">${esc(WHO[s.decidedBy] || s.decidedBy)}</span>${s.route ? `<span class="chip ${s.route}">${s.route}</span>` : ""}${rr[i] && rr[i] !== s.route ? `<span class="chip ${rr[i]}">현재 게이트: ${rr[i]}</span>` : ""}${s.guard ? `<span class="chip guard">${s.guard.allowed ? "허용함" : "거부함"}</span>` : ""}${s.replayed ? `<span class="chip">재생</span>` : ""}${s.s1?.layaMs ? `<span class="hint">S1 ${msText(s.s1.layaMs)}</span>` : ""}${s.s2?.ms ? `<span class="hint">S2 ${msText(s.s2.ms)}</span>` : ""}</div>
    <div class="call">${esc(s.action || "(멈춤)")}(${esc(Object.values(s.args || {}).join(", "))})</div>
    ${s.reasons?.length ? `<ul class="reasons">${s.reasons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}
    ${s.observation ? `<div class="obs">${esc(s.observation)}</div>` : ""}</li>`).join("");
}

function renderTraceGraph() {
  $("traceEmpty").hidden = !!S.current;
  S.cy?.destroy(); S.cy = null;
  if (!S.current) return;
  S.cy = renderTrace($("traceCanvas"), S.current, { reroute: reroute(S.current, gateOpts()), forcedAt: S.forcedAt }, (kind, step, data) => {
    if (kind === "alt") { if (confirm(`${step + 1}단계부터 ${data.alt}(으)로 다시 실행할까요? (그 지점부터 System 1을 다시 돌립니다)`)) whatIf(step, data.alt); return; }
    S.sel = { kind, step, data }; renderInspector(kind, step, data); renderSteps();
  });
}

function renderSessionGraph() {
  const runs = S.runs.filter((r) => r.steps.length);
  $("sessionEmpty").hidden = !!runs.length;
  if (!runs.length) return;
  S.cySession?.destroy();
  S.cySession = renderSession($("sessionCanvas"), runs);
}

function renderExport() {
  const c = compactRun(S.current);
  $("expPreview").textContent = toTurtle(c).slice(0, 4000);
}

const kv = (pairs) => `<div class="kv">${pairs.filter(([, v]) => v != null && v !== "").map(([k, v]) => `<span>${esc(k)}</span><span>${v}</span>`).join("")}</div>`;

function renderInspector(kind, stepIndex) {
  const el = $("inspector");
  if (kind === "goal") { el.innerHTML = `<h3>목표</h3><p>${esc(S.current.goal)}</p>`; return; }
  if (kind === "answer" || kind === "end") { el.innerHTML = `<h3>결과</h3><p>${esc(S.current.outcome?.text || "")}</p>`; return; }
  const s = S.current.steps.find((x) => x.index === stepIndex);
  if (!s) return;
  const a = s.s1?.answers || {};
  const rr = reroute(S.current, gateOpts())[S.current.steps.indexOf(s)];
  const parts = [`<h3>${s.index + 1}단계: ${esc(s.action || "멈춤")}</h3>`];
  parts.push(kv([
    ["결정", esc(WHO[s.decidedBy] || s.decidedBy)], ["라우트", `${esc(s.route || "")}${rr && rr !== s.route ? ` (현재 게이트: <b>${rr}</b>)` : ""}`],
    ["System 1", s.s1?.layaMs ? `모델 ${msText(s.s1.layaMs)}` : ""], ["호출", `<code>${esc(s.action)}(${esc(JSON.stringify(s.args || {}))})</code>`],
  ]));
  if (s.reasons?.length) parts.push(`<div class="sec"><b>보류된 이유</b><ul class="reasons">${s.reasons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul></div>`);
  if (a.next_action) {
    parts.push(`<div class="sec"><b>System 1 · 다음 행동</b> <span class="hint">점수 ${num(score(a.next_action, S.gate.metric))} (${esc(METRICS[S.gate.metric])}), 엔트로피 신뢰도 ${num(a.next_action.confidence, 3)}${a.next_action.forced ? " · 가정 실행으로 강제" : ""}</span>${bars(a.next_action.probabilities, a.next_action.choice)}</div>`);
    parts.push(`<div class="sec">${kv([["p(목표 달성)", num(a.goal_met?.noul, 3)], ["p(위험)", num(a.risky?.noul, 3)]])}</div>`);
    for (const [k, ans] of Object.entries(a).filter(([k]) => k.startsWith(ARG_PREFIX))) {
      parts.push(`<div class="sec"><b>System 1 · ${esc(k.slice(ARG_PREFIX.length))}</b> <span class="hint">점수 ${num(score(ans, S.gate.metric))}</span>${bars(ans.probabilities, ans.choice)}</div>`);
    }
    if (!s.replayed) {
      const alts = topOptions(a.next_action, 4).filter((o) => o.key !== s.action);
      parts.push(`<div class="sec"><b>가정 실행</b><div class="alts">${alts.map((o) => `<button data-whatif="${esc(o.key)}">${esc(o.key)} · ${o.p.toFixed(2)}</button>`).join("")}</div><p class="hint">그 행동으로 이 단계부터 에이전트를 다시 실행합니다${M.laya ? "" : " (서버에 연결되면 가능)"}.</p></div>`);
    }
  }
  if (s.s2) {
    parts.push(`<div class="sec"><b>System 2</b> ${kv([["reply", `<code>${esc(s.s2.action)}(${esc(JSON.stringify(s.s2.args || {}))})</code>`], ["이유", esc(s.s2.reason)], ["시간", msText(s.s2.ms)], ["S1과 일치", s.s2.agreedWithS1 ? "예" : "아니오"], ["문제", esc(s.s2.error || s.s2.parseError || "")]])}
      <details><summary>System 2에 보낸 프롬프트</summary><pre style="white-space:pre-wrap">${esc(prettyJson(s.s2.prompt))}</pre></details>
      <details><summary>원본 JSON 응답</summary><pre style="white-space:pre-wrap">${esc(s.s2.raw || "")}</pre></details></div>`);
  }
  if (s.shadow) parts.push(`<div class="sec"><b>그림자 검사</b> ${kv([["System 2라면", `<code>${esc(s.shadow.action)}(${esc(JSON.stringify(s.shadow.args || {}))})</code>`], ["일치", s.shadow.agreed ? "예" : "아니오"]])}</div>`);
  if (s.guard) parts.push(`<div class="sec"><b>가드</b> ${kv([["이유", esc(s.guard.reason)], ["내 선택", s.guard.allowed ? "허용" : "거부"], ["Laya p(위험)", num(s.guard.layaRisky, 3)]])}</div>`);
  if (s.tool) parts.push(`<div class="sec"><b>도구</b> ${kv([["시간", msText(s.tool.ms)], ["성공", s.tool.ok ? "예" : "아니오"], ["오류", esc(s.tool.error || "")]])}</div>`);
  if (s.observation) parts.push(`<div class="sec"><b>관찰 결과</b><p>${esc(s.observation)}</p></div>`);
  if (s.candidates?.length) parts.push(`<div class="sec"><b>후보 표현</b> <span class="hint">(ko.js 규칙 + 정규식, 모델 없음)</span><div class="chips" style="margin-top:4px">${s.candidates.map((c) => `<span class="chip" title="${esc(c.kind)} · ${esc(c.from === "goal" ? "목표" : "관찰")}">${esc(c.span)}</span>`).join("")}</div></div>`);
  if (s.state) parts.push(`<details><summary>Laya가 읽은 상태</summary><pre style="white-space:pre-wrap">${esc(JSON.stringify(s.state, null, 1))}</pre></details><details><summary>타입화된 질문</summary><pre style="white-space:pre-wrap">${esc(JSON.stringify(stepQuestions(s), null, 1))}</pre></details>`);
  el.innerHTML = parts.join("");
  el.querySelectorAll("[data-whatif]").forEach((b) => b.addEventListener("click", () => whatIf(s.index, b.dataset.whatif)));
}
const prettyJson = (t) => { try { return JSON.stringify(JSON.parse(t), null, 1); } catch { return t || ""; } };

// ---- notes ------------------------------------------------------------------------------------------------------------
async function refreshNotes() {
  const all = await browserNotes.all();
  $("noteCount").textContent = `· ${all.length}개 저장됨`;
  $("notesList").innerHTML = all.map((n) => `<li>${esc(n.text)}</li>`).join("") || `<li class="hint">아직 메모가 없습니다.</li>`;
}

// ---- recording hooks (used once to produce recorded.json; see README) -------------------------------------------------
globalThis.__la = {
  S, M,
  /** Run every preset non-interactively: gold decisions stand in for you, the guard is auto-allowed, notes are seeded. */
  async recordPresets({ onlyGoal = null } = {}) {
    await loadNlp();
    const out = {};
    for (const goal of PRESETS.filter((g) => !onlyGoal || g === onlyGoal)) {
      const task = S.tasks.tasks.find((t) => t.goal === goal);
      const gold = task?.steps || [];
      const deps = liveDeps({
        toolCtx: { notes: memoryNotes(S.tasks.seedNotes), askUser: async () => gold.find((g) => g.action === "ask_user")?.observation.match(/"(.*)"/)?.[1] || `I mean: ${goal}`, now: undefined },
        human: {
          decide: async ({ state }) => { const g = gold[state.steps_done.length]; return g ? { action: g.action, args: Object.fromEntries(Object.entries(g.args).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])) } : null; },
          confirm: async () => true,
        },
      });
      const res = await runAgent(goal, deps, { ...gateOpts(), shadowRate: 0 });
      res.recordedWith = { s1: M.info?.variant, backend: M.info?.backend, s2: M.s2?.model || null, humanStandIn: "gold trace for held steps; confirmations allowed; ask_user answered from the gold trace or by restating the goal" };
      out[goal] = { ...compactRun(res), recordedWith: res.recordedWith };
      console.log("recorded", goal, res.outcome);
    }
    return out;
  },
};

// ---- init -------------------------------------------------------------------------------------------------------------
async function init() {
  initGate();
  document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => {
    S.tab = b.dataset.tab;
    document.querySelectorAll(".tabs button").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    document.querySelectorAll("[data-panel]").forEach((p) => { p.hidden = p.dataset.panel !== S.tab; });
    renderAll(true);
  }));
  $("runBtn").addEventListener("click", () => run());
  $("stopBtn").addEventListener("click", () => { S.abort?.abort(); S.running = false; });
  $("fitBtn").addEventListener("click", () => S.cy?.fit(undefined, 18));
  $("goal").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) run(); });
  $("expJson").addEventListener("click", () => S.current && download("layaagent-run.json", JSON.stringify(compactRun(S.current), null, 1)));
  $("expTtl").addEventListener("click", () => S.current && download("layaagent-run.ttl", toTurtle(compactRun(S.current)), "text/turtle"));
  $("expAll").addEventListener("click", () => download("layaagent-session.json", JSON.stringify(S.runs.filter((r) => r.steps.length).map(compactRun), null, 1)));
  $("seedNotes").addEventListener("click", async () => { for (const t of S.tasks?.seedNotes || []) await browserNotes.add(t); refreshNotes(); });
  $("clearNotes").addEventListener("click", async () => { if (confirm("이 브라우저에 저장된 메모를 모두 지울까요?")) { await browserNotes.clear(); refreshNotes(); } });
  onModelsChanged(() => { renderPresets(); renderBanner(); });
  initModelCard();
  refreshNotes();
  const [rec, tasks] = await Promise.all([loadRecorded(), loadTasks().catch(() => null)]);
  S.recorded = rec; S.tasks = tasks;
  const ev = rec?.eval;
  if (ev?.records?.length) { S.evalRecords = ev.records; S.evalMeta = `Laya ${ev.meta?.s1 || "?"} · ${ev.meta?.backend || "?"}${ev.meta?.s2 ? ` + ${ev.meta.s2}` : ""}로 녹음`; }
  renderPresets(); renderAll(false);
  const first = PRESETS[0];
  $("goal").value = first;
}

function renderPresets() {
  const rec = S.recorded?.traces || {};
  $("presetHint").textContent = M.laya ? "(직접 실행)" : "(▶ = 녹음된 실행 재생)";
  $("presets").innerHTML = PRESETS.map((g) => `<button data-goal="${esc(g)}" title="${esc(g)}">${!M.laya && rec[g] ? "▶ " : ""}${esc(g.length > 44 ? g.slice(0, 43) + "…" : g)}</button>`).join("");
  $("presets").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { $("goal").value = b.dataset.goal; $("presets").querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b)); run({ goal: b.dataset.goal }); }));
}

init();
