// System 1: Ollama 서버의 CLEF 계열 결정 모델을 타입화된 결정 API(/v1/systemone)로 씁니다.
// 원본(model.js의 Laya ONNX 로더)과 같은 인터페이스를 제공합니다:
//   loadLaya({...}) -> { laya, backend, info }  /  laya.systemOne(state, questions) -> { model, answers, usage, latency_ms }
// 브라우저가 직접 Ollama에 POST합니다(localhost 오리진은 Ollama 기본 CORS 정책으로 허용).
// noul 방향은 로컬 Laya ONNX와 동일(1 = 참)임을 확인했습니다: 답이 있는 관찰 0.99, 없는 관찰 0.02.

export const DEFAULT_OLLAMA_BASE = "http://localhost:11434";
const LEGACY_OLLAMA_BASE = "http://dydtn.tailc2a754.ts.net:11434"; // 이전 기본값: 저장돼 있다면 새 기본값으로 마이그레이션
// 원본의 내보내기 이름 유지(공통 코드와의 호환): "기본 모델위치"는 Ollama 서버 주소를 가리킨다.
export const DEFAULT_MODEL_BASE = DEFAULT_OLLAMA_BASE;
export const MODEL_PAGE = "http://ollama.com/library/clef";
export const MODEL_LABEL = "Ollama CLEF 결정 모델";

export const settings = {
  get base() { return localStorage?.getItem("lagent.ollamaBase") || DEFAULT_OLLAMA_BASE; },
  set base(v) { try { localStorage.setItem("lagent.ollamaBase", v); } catch { /* fine */ } },
};
// 이전 기본값(tailscale 주소)이 저장돼 있으면 새 기본값(localhost)으로 교체한다.
if (typeof localStorage !== "undefined" && localStorage.getItem("lagent.ollamaBase") === LEGACY_OLLAMA_BASE)
  settings.base = DEFAULT_OLLAMA_BASE;
export function setOllamaBase(v) {
  settings.base = (String(v || DEFAULT_OLLAMA_BASE).trim().replace(/\/$/, "") || DEFAULT_OLLAMA_BASE);
}
export function ollamaBase() { return settings.base; }
// 원본 modelBase() 호환: 같은 값을 돌려준다.
export function modelBase() { return settings.base; }

export async function fetchManifest(base = ollamaBase()) {
  const r = await fetch(base + "/api/tags");
  if (!r.ok) throw new Error(`Ollama /api/tags: HTTP ${r.status}`);
  const data = await r.json();
  return { models: (data.models || []).map((m) => ({ name: m.name, capabilities: m.capabilities || [], details: m.details || {} })) };
}

/** cachedParts 호환 스텁: 원격 모델에는 "브라우저 캐시" 개념이 없다(모든 부품 존재로 간주). */
export async function cachedParts(_base, _entry) { return 1; }

/** /api/tags에서 System 1(결정 캘퍼빌리티/decision)과 System 2(생성) 후보를 가린다. */
export function pickS1Models(manifest) {
  const out = manifest.models.filter((m) => m.capabilities.includes("decision")).map((m) => m.name);
  return out.length ? out : manifest.models.filter((m) => /clef/.test(m.name)).map((m) => m.name);
}
export function pickS2Models(manifest) {
  return manifest.models
    .filter((m) => !m.capabilities.includes("decision") || m.capabilities.includes("completion") || m.capabilities.includes("thinking"))
    .filter((m) => !(m.capabilities.length === 1 && m.capabilities[0] === "decision"))
    .map((m) => m.name);
}

const r4 = (x) => (Number.isFinite(x) ? Math.round(x * 1e4) / 1e4 : x);

/** 결정 모델 어댑터: 원격 /v1/systemone 답을 로컬 Laya(laya-core.js)와 같은 모양으로 맞춘다. */
export class LayaRemote {
  constructor(model, base = ollamaBase()) {
    this.model = model; this.base = base; this.label = "CLEF";
    // countTokens()가 M.laya.tok.encode를 쓴다: 대략 토큰 수로 흉내 낸다.
    this.tok = { encode: (t) => ({ ids: new Array(Math.ceil(String(t ?? "").length / 4)) }) };
  }

  async systemOne(_state, questions, { base = this.base } = {}) {
    const ids = Object.keys(questions);
    const body = { model: this.model, state: _state, questions };
    const t0 = performance.now();
    const res = await fetch(base + "/v1/systemone", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Ollama /v1/systemone: HTTP ${res.status}`);
    const ms = performance.now() - t0;

    const answers = {};
    for (const qid of ids) {
      const q = questions[qid], a = (data.answers || {})[qid];
      if (!a) throw new Error(`System 1이 질문 "${qid}"에 답하지 않았습니다`);
      if (q.type === "choice") {
        const probs = {};
        for (const k of Object.keys(q.criteria || {})) probs[k] = r4(a.probabilities?.[k] ?? 0);
        const choice = a.choice != null && probs[a.choice] != null ? a.choice : a.choice;
        answers[qid] = { type: "choice", choice, probabilities: probs, confidence: r4(a.confidence ?? 1) };
      } else if (q.type === "noul") {
        const n = r4(Math.min(Math.max(a.noul ?? 0, 0), 1));
        answers[qid] = {
          type: "noul", noul: n,
          probabilities: { false: r4(1 - n), true: n },
          confidence: r4(Math.max(n, 1 - n)),
          legend: q.criteria ? Object.fromEntries(Object.entries(q.criteria).map(([k, v], i) => [i === 0 ? "false" : "true", v])) : undefined,
        };
      } else { // score: 원격은 score+legend, 로컬 모양으로 평균을 score로 돌려준다
        answers[qid] = { type: "score", score: r4(a.score ?? 0), legend: a.legend, probabilities: a.probabilities, confidence: r4(a.confidence ?? 1) };
      }
    }
    return {
      model: data.model || this.model, answers,
      usage: { input_tokens: data.usage?.input_tokens ?? 0, output_tokens: data.usage?.output_tokens ?? 0 },
      latency_ms: ms,
    };
  }
}

/**
 * 원본과 같은 자리의 로더. 원격 모델이므로 내려받기/세션 생성이 없다: 연결 확인 + 워밍업만 한다.
 * @returns { laya: LayaRemote, backend: "ollama", info }
 */
export async function loadLaya(opts = {}) {
  const base = opts.base || ollamaBase();
  const model = opts.model || "clef:cloud";
  const status = opts.onStatus || (() => {}), progress = opts.onProgress || (() => {});
  status("Ollama 서버에 연결하는 중…"); progress(0.4);

  // 결정 모델(/api/chat)이 아닌 결정 전용 모델인지 /api/tags로 확인
  const t0 = performance.now();
  let tags = null;
  try { tags = await fetchManifest(base); } catch (e) { throw new Error(`Ollama 서버에 연결할 수 없습니다: ${base} (${e.message})`); }
  const m = tags.models.find((x) => x.name === model);
  if (!m) throw new Error(`"${model} 모델이 서버에 없습니다. 모델 목록에서 고르세요.`);
  if (!m.capabilities.includes("decision")) {
    status(`경고: ${model}은(는) 결정 모델이 아니라 /v1/systemone이 실패할 수 있습니다.`, true);
  }
  progress(0.8);

  status("System 1 워밍업 중…");
  const laya = new LayaRemote(model, base);
  // 원본처럼 한 번에 한 추론만: 호출을 직렬화한다.
  const run = laya.systemOne.bind(laya);
  let queue = Promise.resolve();
  laya.systemOne = (state, questions) => { const p = queue.then(() => run(state, questions)); queue = p.catch(() => {}); return p; };
  const w0 = performance.now();
  await laya.systemOne("워밍업", { w: { type: "noul", instructions: "워밍업 호출입니다" } });
  const warmMs = performance.now() - w0;

  const connectMs = performance.now() - t0;
  progress(null);
  return {
    laya, backend: "ollama",
    info: {
      variant: model, label: m.details?.remote_host ? `${model} (${m.details.remote_host})` : model,
      source: base, model, threads: 0,
      downloadMs: connectMs, initMs: 0, warmMs, fromCache: 0, parts: 1,
      maxLen: "원격(무제한)", headMaxLen: "원격",
    },
  };
}
