// Evaluate page: run the models over the task suite, score against the gold traces, compare routers.
import { $, esc, pct, num, msText, settings, M, onModelsChanged, initModelCard, loadRecorded, loadTasks, loadNlp, countTokens, download, bars, yieldToBrowser } from "./common.js";
import { evalTask, questionsKey } from "./evalrun.js";
import { evaluate, sweep, tuneOnDev, SWEEP } from "./metrics.js";
import { DEFAULTS, METRICS, score } from "./gate.js";
import { ARG_PREFIX } from "./questions.js";
import { TOOL } from "./tools/index.js";

const S = {
  tasks: null, runs: new Map(), cur: null, running: false, stop: false, open: new Set(),
  gate: { ...DEFAULTS, ...settings.get("evalGate", settings.get("gate", {})) },
};

const CAT = { weather: "날씨 (인자가 본문에 있음)", wiki: "백과사전 (인자가 본문에 있음)", fact: "Wikidata 사실", calc: "산술", units: "단위 변환", date: "날짜 계산",
  multihop: "다단계(multi-hop)", memory: "메모리 (저장/검색)", rewrite: "다시 써야 함", ambiguous: "모호함 (되물어야 함)", risky: "무언가를 바꿈" };

function records() {
  const run = S.runs.get(S.cur);
  if (!run) return [];
  const sp = $("scoreSplit").value;
  return run.records.filter((r) => sp === "all" || r.split === sp);
}

// ---- gate controls --------------------------------------------------------------------------------------------------
function initGate() {
  const m = $("metric");
  for (const [k, v] of Object.entries(METRICS)) m.add(new Option(v, k));
  const sync = () => {
    $("tauAction").value = S.gate.tauAction; $("tauArg").value = S.gate.tauArg; $("tauStop").value = S.gate.tauStop; $("tauStopVal").textContent = num(S.gate.tauStop); m.value = S.gate.metric;
    $("useGoalMet").checked = S.gate.useGoalMet; $("useRisk").checked = S.gate.useRisk;
    $("tauActionVal").textContent = num(S.gate.tauAction); $("tauArgVal").textContent = num(S.gate.tauArg);
  };
  S.syncGate = sync; sync();
  const upd = () => { S.gate = { ...S.gate, tauAction: +$("tauAction").value, tauArg: +$("tauArg").value, tauStop: +$("tauStop").value, metric: m.value, useGoalMet: $("useGoalMet").checked, useRisk: $("useRisk").checked }; settings.set("evalGate", S.gate); sync(); render(); };
  for (const id of ["tauAction", "tauArg", "tauStop"]) $(id).addEventListener("input", upd);
  for (const id of ["metric", "useGoalMet", "useRisk"]) $(id).addEventListener("change", upd);
  $("scoreSplit").addEventListener("change", render);
  $("tuneBtn").addEventListener("click", () => {
    const run = S.runs.get(S.cur); if (!run) return;
    const t = tuneOnDev(run.records, S.gate, +$("maxErr").value);
    if (!t) { $("tuneMsg").textContent = "개발 분할의 자동 단계를 그 오류 한도 아래로 유지하는 임계값이 없습니다."; return; }
    S.gate = { ...S.gate, tauAction: Math.min(1, t.tau), tauArg: Math.min(1, t.tau) }; settings.set("evalGate", S.gate); sync();
    $("tuneMsg").innerHTML = `개발 분할: 임계값 <b>${num(t.tau)}</b>에서 System 1이 단계의 <b>${pct(t.point.s1Share)}</b>를 맡고, 자동 단계 오류율은 <b>${pct(1 - t.point.autoAcc)}</b>입니다. 이제 테스트 분할을 보세요.`;
    $("scoreSplit").value = "test"; render();
  });
}

// ---- running ----------------------------------------------------------------------------------------------------------
function subset() {
  const all = S.tasks.tasks, w = $("subset").value;
  if (w === "quick") { const seen = new Set(); return all.filter((t) => !seen.has(t.category) && seen.add(t.category)); }
  return w === "all" ? all : all.filter((t) => t.split === w);
}

async function runSuite() {
  if (!M.laya) { $("runCount").textContent = M.loading || M.loading1 ? "모델을 자동으로 준비하는 중입니다…" : "먼저 System 1(서버)에 연결되어야 합니다."; return; }
  if (S.running) return;
  const withS2 = $("withS2").checked && !!M.s2;
  S.running = true; S.stop = false; $("runBtn").disabled = true; $("stopBtn").disabled = false;
  await loadNlp();
  const tasks = subset();
  const key = `browser · ${M.info.variant}/${M.info.backend}${withS2 ? " + " + M.s2.model.replace(/-q4f.*$/, "") : ""} · ${$("subset").value} · ${new Date().toLocaleTimeString()}`;
  const run = { key, source: "browser", meta: { s1: M.info.variant, backend: M.info.backend, s2: withS2 ? M.s2.model : null, questions: questionsKey(S.tasks.tasks), at: new Date().toISOString(), subset: $("subset").value }, records: [] };
  S.runs.set(key, run); S.cur = key; fillRunSel();
  const total = tasks.reduce((a, t) => a + t.steps.length, 0);
  let n = 0;
  const t0 = performance.now();
  try {
    for (const task of tasks) {
      if (S.stop) break;
      const recs = await evalTask(task, { laya: M.laya, nlp: M.nlp, s2: withS2 ? M.s2 : null, countTokens: countTokens(), onStep: async () => { n++; $("runBar").style.width = `${(100 * n) / total}%`; $("runCount").textContent = `${n} / ${total}단계 · ${msText(performance.now() - t0)}`; await yieldToBrowser(); } });
      run.records.push(...recs);
      render();
    }
  } catch (e) { console.error(e); $("runCount").textContent = "오류: " + (e?.message || e); }
  finally { S.running = false; $("runBtn").disabled = false; $("stopBtn").disabled = true; render(); }
}

function fillRunSel() {
  const sel = $("runSel");
  sel.innerHTML = [...S.runs.values()].map((r) => `<option value="${esc(r.key)}">${esc(r.source === "recorded" ? "녹음 · " : "")}${esc(r.key)} (${r.records.length} steps)</option>`).join("");
  sel.value = S.cur || "";
}

// ---- rendering ---------------------------------------------------------------------------------------------------------
function render() {
  const recs = records();
  if (!recs.length) { $("kpis").innerHTML = `<p class="hint">아직 채점할 단계가 없습니다.</p>`; for (const id of ["baselines", "parts", "cats", "steps"]) $(id).innerHTML = ""; $("curve").innerHTML = ""; return; }
  const e = evaluate(recs, S.gate);
  const tile = (l, v, sub = "") => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}${sub ? ` <small>${sub}</small>` : ""}</div></div>`;
  const succ = e.routers.hybrid || e.routers.human;
  $("kpis").innerHTML = [
    tile("System 1이 단독 처리한 단계", pct(e.split.S1), `${e.split.autoN}/${e.n.steps}`),
    tile("System 1 자동 단계 오류율", pct(e.autoError)),
    tile(`과제 성공률, ${e.hasS2 ? "S1 + S2" : "S1 + 사용자"}`, pct(succ.rate), `/ ${succ.n}개`),
    tile("과제 성공률, S1 단독(게이트 없음)", pct(e.routers.s1.rate)),
    e.hasS2 ? tile("과제 성공률, S2 단독", pct(e.routers.s2.rate)) : tile("S1이 틀렸던 보류 단계 비율", pct(e.escalationPrecision)),
    tile("System 1 지연 p50 / p95", `${msText(e.latency.s1.p50)}`, `/ ${msText(e.latency.s1.p95)}`),
  ].join("");
  const run = S.runs.get(S.cur);
  $("kpiNote").innerHTML = `과제 ${e.n.tasks}개, ${e.n.steps}단계 (${esc($("scoreSplit").value)} 분할). Laya ${esc(run.meta?.s1 || "?")} · ${esc(run.meta?.backend || "?")}${run.meta?.s2 ? `, System 2 ${esc(run.meta.s2)}` : ", 이 실행에는 System 2 응답이 없음"}. 게이트: ${esc(METRICS[S.gate.metric])} ≥ ${num(S.gate.tauAction)} (행동) / ${num(S.gate.tauArg)} (인자).`;

  const R = [
    ["System 1 단독, 게이트 없음", e.routers.s1, "0", e.calls.s1Ms],
    ["혼합: S1 + System 2", e.routers.hybrid, `${e.calls.hybridS2} (${pct(e.split.escalated)})`, e.hasS2 ? e.calls.hybridMs : null],
    ["혼합: S1 + 사용자", e.routers.human, `${e.calls.hybridS2}단계를 사용자가`, null],
    ["System 2 단독, 모든 단계", e.routers.s2, `${e.calls.s2Only} (100%)`, e.calls.s2Ms],
  ];
  $("baselines").innerHTML = `<tr><th>라우터</th><th class="r">과제 성공률</th><th class="r">System 2 호출</th><th class="r">과제당 중앙 시간</th></tr>` +
    R.map(([n, r, calls, ms]) => `<tr><td>${n}</td><td class="r">${r ? pct(r.rate) : "<span class=hint>S2 실행 필요</span>"}</td><td class="r">${r ? calls : "–"}</td><td class="r">${ms != null ? msText(ms) : "–"}</td></tr>`).join("");

  $("parts").innerHTML = `<tr><th>구성 요소</th><th class="r">값</th></tr>` + [
    ["행동 정확도 (Laya가 고른 도구)", pct(e.actionAcc)],
    ["goal_met 정지를 포함한 행동 정확도", pct(e.actionAccWithGoalMet)],
    ["인자 정확도 (정답 도구의 모든 슬롯)", pct(e.argAcc)],
    ["· 후보 선택 슬롯 (extraction by choice)", pct(e.spanArgAcc)],
    ["· 고정 목록 슬롯", pct(e.fixedArgAcc)],
    ["추출기 재현율 (정답 표현이 선택지에 있음)", pct(e.extractorRecall)],
    ["표현이 없을 때 NONE을 고른 비율", pct(e.noneRecall)],
    ["goal_met AUROC", num(e.goalMet.auroc)],
    ["goal_met 재현율 / 오경보 (0.5 기준)", `${pct(e.goalMet.recall)} / ${pct(e.goalMet.falseAlarm)}`],
    ["위험 플래그 AUROC (무언가를 바꾸는 과제)", num(e.risk.auroc)],
    ["위험 플래그 재현율 / 오경보 (컷오프 기준)", `${pct(e.risk.recall)} / ${pct(e.risk.falseAlarm)}`],
    ["보류 단계 중 S1이 실제로 틀린 비율", pct(e.escalationPrecision)],
    ...(e.hasS2 ? [["System 2 단계 정확도 (전체)", pct(e.s2StepAcc)], ["System 2 정확도 (보류 단계)", pct(e.s2OnHoldAcc)], ["System 2 지연 p50 / p95", `${msText(e.latency.s2.p50)} / ${msText(e.latency.s2.p95)}`]] : []),
  ].map(([k, v]) => `<tr><td>${k}</td><td class="r">${v}</td></tr>`).join("");

  $("cats").innerHTML = `<tr><th>분류</th><th class="r">과제</th><th class="r">S1 비중</th><th class="r">자동 오류</th><th class="r">행동 정확도</th><th class="r">성공률</th><th class="r">S1 단독</th></tr>` +
    e.byCategory.map((c) => `<tr><td>${esc(CAT[c.name] || c.name)}</td><td class="r">${c.tasks}</td><td class="r">${pct(c.s1Share)}</td><td class="r">${pct(c.autoError)}</td><td class="r">${pct(c.actionAcc)}</td><td class="r">${pct(c.success)}</td><td class="r">${pct(c.s1Success)}</td></tr>`).join("");

  renderCurve(recs);
  renderSteps(e);
}

function renderCurve(recs) {
  const pts = sweep(recs, S.gate);
  const W = 460, H = 260, L = 44, B = 34, T = 10, Rr = 12;
  const x = (v) => L + (W - L - Rr) * v, y = (v) => T + (H - T - B) * (1 - v);
  const cur = pts.reduce((b, p) => (Math.abs(p.tau - S.gate.tauAction) < Math.abs(b.tau - S.gate.tauAction) ? p : b), pts[0]);
  const line = (key) => pts.filter((p) => p[key] != null && p.s1Share != null).map((p, i) => `${i ? "L" : "M"}${x(p.s1Share).toFixed(1)},${y(p[key]).toFixed(1)}`).join(" ");
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  $("curve").innerHTML = `<svg class="curve" viewBox="0 0 ${W} ${H}" role="img" aria-label="담당 범위 대 정확도">
    ${ticks.map((t) => `<line x1="${L}" x2="${W - Rr}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line)"/><text x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${t * 100}%</text><text x="${x(t)}" y="${H - B + 16}" text-anchor="middle">${t * 100}%</text>`).join("")}
    <text x="${(L + W) / 2}" y="${H - 4}" text-anchor="middle">System 1이 단독 처리한 단계 비율</text>
    <path d="${line("autoAcc")}" fill="none" stroke="var(--s1)" stroke-width="2"/>
    <path d="${line("success")}" fill="none" stroke="var(--auto)" stroke-width="2" stroke-dasharray="5 4"/>
    ${pts.filter((p) => p.autoAcc != null).map((p) => `<circle class="pt" cx="${x(p.s1Share)}" cy="${y(p.autoAcc)}" r="${p === cur ? 6 : 4}" fill="${p === cur ? "var(--s1)" : "var(--card)"}" stroke="var(--s1)" stroke-width="2" data-tau="${p.tau}"><title>임계값 ${num(p.tau)}: S1 비중 ${pct(p.s1Share)}, 자동 정확도 ${pct(p.autoAcc)}, 과제 성공률 ${pct(p.success)}</title></circle>`).join("")}
  </svg><div class="legendrow" style="display:flex;gap:14px;font-size:12px;color:var(--ink2)"><span><i style="display:inline-block;width:14px;height:2px;background:var(--s1);vertical-align:3px"></i> System 1 자동 단계 정확도</span><span><i style="display:inline-block;width:14px;border-top:2px dashed var(--auto);vertical-align:3px"></i> 과제 성공률 (${esc(S.runs.get(S.cur)?.meta?.s2 ? "S1 + S2" : "S1 + 사용자")})</span></div>`;
  $("curve").querySelectorAll(".pt").forEach((c) => c.addEventListener("click", () => { const t = Math.min(1, +c.dataset.tau); S.gate = { ...S.gate, tauAction: t, tauArg: t }; settings.set("evalGate", S.gate); S.syncGate(); render(); }));
}

function renderSteps(e) {
  const fc = $("fCat").value, fr = $("fRoute").value, fo = $("fOk").value;
  const rows = e.steps.filter(({ r, d }) => (!fc || r.category === fc) && (!fr || d.route === fr) && (!fo || (fo === "bad" ? !d.s1Ok : !d.s1Ok && d.route === "AUTO")));
  const fmt = (x) => `${esc(x.action)}(${esc(Object.values(x.args || {}).map((v) => (Array.isArray(v) ? v[0] : v)).join(", "))})`;
  $("steps").innerHTML = `<tr><th>과제</th><th>#</th><th>정답</th><th>System 1</th><th class="r">점수</th><th>라우트</th><th>S1</th>${e.hasS2 ? "<th>S2</th>" : ""}</tr>` + rows.map(({ r, d }) => {
    const id = `${r.task}:${r.step}`;
    const open = S.open.has(id);
    const main = `<tr class="claimrow" data-id="${id}"><td title="${esc(r.goal)}">${esc(r.task)} · ${esc(r.goal.length > 48 ? r.goal.slice(0, 47) + "…" : r.goal)}</td><td>${r.step + 1}</td><td><code>${fmt(r.gold)}</code></td><td><code>${fmt(d.s1Decision)}</code></td><td class="r">${num(d.actionScore)}</td><td><span class="chip ${d.route}">${d.route}</span></td><td><span class="chip ${d.s1Ok ? "ok" : "bad"}">${d.s1Ok ? "맞음" : "틀림"}</span></td>${e.hasS2 ? `<td>${r.s2 ? `<span class="chip ${d.s2Ok ? "ok" : "bad"}" title="${esc(r.s2.action)}(${esc(JSON.stringify(r.s2.args))})">${d.s2Ok ? "맞음" : "틀림"}</span>` : ""}</td>` : ""}</tr>`;
    if (!open) return main;
    const a = r.s1.answers;
    const argBlocks = Object.entries(r.s1.gold.answers || {}).map(([k, ans]) => `<div><b>${esc(k.slice(ARG_PREFIX.length))}</b> <span class="hint">정답 선택지: ${esc(r.s1.gold.options?.[k.slice(ARG_PREFIX.length)] ?? "?")}</span>${bars(ans.probabilities, ans.choice, { gold: r.s1.gold.options?.[k.slice(ARG_PREFIX.length)] })}</div>`).join("");
    return main + `<tr class="detailrow"><td colspan="${e.hasS2 ? 8 : 7}"><div class="two"><div><b>next_action</b> <span class="hint">p(goal met) ${num(a.goal_met?.noul, 3)} · p(risky) ${num(a.risky?.noul, 3)} · ${msText(r.s1.ms)}</span>${bars(a.next_action.probabilities, a.next_action.choice, { gold: r.gold.action })}</div><div>${argBlocks || '<span class="hint">인자 없음</span>'}</div></div>${d.reasons.length ? `<ul class="reasons">${d.reasons.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}${r.s2 ? `<p class="hint">System 2: <code>${esc(r.s2.action)}(${esc(JSON.stringify(r.s2.args))})</code> · ${esc(r.s2.reason || "")} · ${msText(r.s2.ms)}${r.s2.parseError ? " · " + esc(r.s2.parseError) : ""}</p>` : ""}</td></tr>`;
  }).join("");
  $("steps").querySelectorAll(".claimrow").forEach((tr) => tr.addEventListener("click", () => { const id = tr.dataset.id; if (S.open.has(id)) S.open.delete(id); else S.open.add(id); renderSteps(e); }));
}

// ---- recording hook ---------------------------------------------------------------------------------------------------
globalThis.__la = { S, M, current: () => S.runs.get(S.cur), runSuite };

async function init() {
  initGate();
  $("runBtn").addEventListener("click", runSuite);
  $("stopBtn").addEventListener("click", () => { S.stop = true; });
  $("runSel").addEventListener("change", () => { S.cur = $("runSel").value; render(); });
  $("dlRun").addEventListener("click", () => { const r = S.runs.get(S.cur); if (r) download("layaagent-eval.json", JSON.stringify(r, null, 1)); });
  for (const id of ["fCat", "fRoute", "fOk"]) $(id).addEventListener("change", render);
  onModelsChanged(() => { $("withS2").disabled = !M.s2; if (M.s2) $("withS2").checked = true; });
  $("withS2").disabled = true;
  initModelCard();
  const [tasks, rec] = await Promise.all([loadTasks(), loadRecorded()]);
  S.tasks = tasks;
  const n = (s) => tasks.tasks.filter((t) => t.split === s).length;
  $("suiteInfo").textContent = `합성 목표 ${tasks.tasks.length}개 (개발 ${n("dev")} / 테스트 ${n("test")}), 정답 단계 ${tasks.tasks.reduce((a, t) => a + t.steps.length, 0)}개, 분류 ${Object.keys(CAT).length}개. 도구 출력 녹음일 ${tasks.recordedAt.slice(0, 10)}.`;
  for (const [k, v] of Object.entries(CAT)) $("fCat").add(new Option(v, k));
  const qk = questionsKey(tasks.tasks);
  if (rec?.eval?.records?.length) {
    const stale = rec.eval.meta?.questions && rec.eval.meta.questions !== qk;
    const key = `Laya ${rec.eval.meta?.s1 || "?"}/${rec.eval.meta?.backend || "?"}${rec.eval.meta?.s2 ? " + " + rec.eval.meta.s2.replace(/-q4f.*$/, "") : ""}${stale ? " (질문이 바뀐 뒤 녹음됨)" : ""}`;
    S.runs.set(key, { key, source: "recorded", meta: rec.eval.meta, records: rec.eval.records });
    S.cur = key;
  }
  fillRunSel(); render();
}
init();
