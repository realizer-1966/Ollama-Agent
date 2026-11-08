// Shared by both pages: DOM helpers, per-browser settings, the model card (System 1 = Ollama CLEF 결정 모델, System 2 = Ollama 생성 모델),
// the candidate extractor's NLP library and recorded results.
// 모델 계층만 원본(브라우저 ONNX + WebLLM)에서 Ollama 원격 모델로 바뀌었다. UI와 나머지 로직은 원본 그대로다.
import { approxTokens } from "./state.js";
import { DEFAULT_S2 } from "./system2.js";

export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const pct = (p, d = 0) => (p == null ? "–" : `${(p * 100).toFixed(d)}%`);
export const num = (x, d = 2) => (x == null || !Number.isFinite(x) ? "–" : x.toFixed(d));
export const msText = (x) => (x == null || !Number.isFinite(x) ? "–" : x >= 1000 ? `${(x / 1000).toFixed(1)} s` : `${Math.round(x)} ms`);
// MessageChannel, not setTimeout: background tabs clamp setTimeout to >= 1 s (see layaAsRagJudge).
export const yieldToBrowser = () => new Promise((r) => { const ch = new MessageChannel(); ch.port1.onmessage = () => r(); ch.port2.postMessage(0); });

export const settings = {
  get(k, d) { try { const v = localStorage.getItem("lagent." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("lagent." + k, JSON.stringify(v)); } catch { /* fine */ } },
};

export const M = { laya: null, info: null, s2: null, s2Loading: false, nlp: null, manifest: null, loading: false, loading1: false, loading2: false, listeners: [], s2Available: true };
export const onModelsChanged = (fn) => M.listeners.push(fn);
const changed = () => { for (const fn of M.listeners) fn(); updatePill(); };

/** Token counter for the state budget: 원격 모델이라 대략 토큰 수(문자/4)로 추정한다. */
export const countTokens = () => approxTokens;

let modelMod = null;
const modelApi = () => (modelMod ||= import("./model.js"));

export async function loadNlp() {
  if (M.nlp) return M.nlp;
  const [{ default: nlp }, { default: dates }] = await Promise.all([import("./vendor/compromise.mjs"), import("./vendor/compromise-dates.mjs")]);
  nlp.plugin(dates);
  return (M.nlp = nlp);
}

function setPill(kind, text) { const p = $("modelPill"); if (!p) return; p.className = "modelpill " + kind; $("modelPillText").textContent = text; }
export function setStatus(msg, warn = false) { const s = $("status"); s.textContent = msg; s.classList.toggle("warn", warn); }
function setProgress(f) { $("progress").hidden = f == null; if (f != null) $("progressBar").style.width = (f * 100).toFixed(1) + "%"; }
export function updatePill() {
  if (M.loading || M.s2Loading || M.loading1 || M.loading2) return setPill("busy", "모델을 준비하는 중…");
  if (M.laya) return setPill("ready", `System 1 준비됨${M.s2 ? " · System 2 준비됨" : ""}`);
  setPill("replay", "서버에 연결되면 자동으로 준비됩니다");
}
function badge(t, ok) { const b = document.createElement("span"); b.className = "badge" + (ok ? " ok" : ""); b.textContent = t; $("badges").appendChild(b); }

export async function initModelCard() {
  updatePill();
  // 자동 연결+자동 로딩: 페이지를 열면 고정된 모델(System 1: clef:cloud, System 2: glm)에 바로 연결한다.
  await connectAndStart();
}

const S1_MODEL = "clef:cloud";

async function connectAndStart() {
  M.loading = true; updatePill();
  const m = await modelApi();
  const base = m.ollamaBase();
  const link = $("modelLink");
  link.href = base === m.DEFAULT_OLLAMA_BASE ? m.MODEL_PAGE : base;
  link.textContent = base === m.DEFAULT_OLLAMA_BASE ? "clef (Ollama 결정 모델) · ollama.com" : base;
  try {
    M.manifest = await m.fetchManifest(base);
  } catch (e) {
    setStatus(`Ollama 서버(${base})에 연결하지 못했습니다: ${e.message}. 서버가 켜져 있는지 확인하고 새로 고침으로 다시 시도하세요.`, true);
    M.loading = false; updatePill(); return;
  }
  setStatus("Ollama 모델에 자동으로 연결하는 중: System 1 = " + S1_MODEL + ", System 2 = " + DEFAULT_S2);
  // System 1·System 2를 자동으로 불러온다 (입력란·버튼 없음).
  await Promise.all([loadS1(), loadS2()]);
  M.loading = false; updatePill(); changed();
}

export async function loadS1() {
  if (M.loading1) return;
  M.loading1 = true;
  try {
    await loadNlp();
    const m = await modelApi();
    const { laya, backend, info } = await m.loadLaya({ model: S1_MODEL, onStatus: setStatus, onProgress: setProgress });
    M.laya = laya; M.info = { backend, ...info };
    setStatus(`System 1 준비됨: ${info.variant} · 연결+워밍업 ${(info.warmMs / 1000).toFixed(1)}초. 모든 결정은 Ollama /v1/systemone(서버 ${m.ollamaBase()})으로 수행됩니다.`);
    badge(`S1: ${info.variant} · Ollama 원격`, true);
  } catch (e) {
    console.error(e); setStatus("System 1 연결 실패: " + (e?.message || e), true); M.laya = null;
  } finally { M.loading1 = false; setProgress(null); changed(); }
}

export async function loadS2() {
  if (M.loading2) return M.s2;
  M.loading2 = true;
  try {
    const { loadSystem2 } = await import("./system2.js");
    M.s2 = await loadSystem2({ model: DEFAULT_S2, onProgress: (f, text) => { setProgress(f); setStatus(`System 2: ${text}`); } });
    setStatus((M.laya ? "System 1 준비됨. " : "") + `System 2 준비됨: ${M.s2.info.label}, ${(M.s2.info.loadMs / 1000).toFixed(1)}초 만에 연결·워밍업.`);
    badge(`S2: ${DEFAULT_S2} · Ollama 원격`, true);
  } catch (e) {
    console.error(e); setStatus("System 2 연결 실패: " + (e?.message || e), true); M.s2 = null;
  } finally { M.loading2 = false; setProgress(null); changed(); }
  return M.s2;
}

export async function loadRecorded() {
  try { const r = await fetch("./recorded.json", { cache: "no-cache" }); if (r.ok) return await r.json(); } catch { /* optional */ }
  return null;
}
export async function loadTasks() { const r = await fetch("./tasks.json", { cache: "no-cache" }); if (!r.ok) throw new Error(`tasks.json: HTTP ${r.status}`); return r.json(); }

export function download(name, text, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Probability bars. */
export function bars(probs, selected, { max = 12, gold = null } = {}) {
  const rows = Object.entries(probs || {}).sort((a, b) => b[1] - a[1]).slice(0, max);
  return `<div class="bars">${rows.map(([k, v]) => `<div class="bar${k === selected ? " sel" : ""}${gold != null && k === gold ? " gold" : ""}"><span class="n" title="${esc(k)}">${esc(k)}</span><span class="tr"><span class="f" style="width:${(v * 100).toFixed(1)}%"></span></span><span class="v">${v.toFixed(2)}</span></div>`).join("")}</div>`;
}
