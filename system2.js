// System 2: Ollama 서버의 생성 LLM(GLM 등)을 OpenAI 호 /v1/chat/completions로 씁니다. 프롬프트·파싱·계획 로직은
// 원본(WebLLM)과 동일하다. 엔진만 바뀌었다: 브라우저에서 직접 POST하며 WebGPU가 필요 없다.
import { TOOLS, TOOL } from "./tools/index.js";
import { ollamaBase } from "./model.js";

// Check the WebLLM prebuilt list when upgrading web-llm (pinned in package.json); IDs change between releases.
// q4f32 builds, not q4f16: on the Intel iGPU we tested, the f16 builds generated garbage ("setColor setColor ...")
// once decoding was unconstrained, and a JSON grammar only disguised it (every reply became ask_user).
export const S2_MODELS = {}; // 모델 목록은 common.js에서 Ollama /api/tags로 채운다
export const DEFAULT_S2 = "glm-5.3-flash:cloud";

// The shape System 2 must return (checked after parsing; decoding is not grammar-constrained, see above).
export const STEP_SCHEMA = {
  type: "object",
  properties: {
    action: { type: "string", enum: TOOLS.map((t) => t.id) },
    args: { type: "object" },
    reason: { type: "string" },
  },
  required: ["action", "args"],
};

export const SYSTEM_PROMPT = "당신은 도구를 쓰는 비서의 계획자입니다. 다음에 호출할 도구를 하나 고르세요. JSON 객체 하나만 답하세요.";

const toolLine = (t) => {
  const args = t.id === "ask_user" ? ["question"] : t.slots.map((sl) => (sl.fixed ? `${sl.name} (one of: ${Object.keys(sl.fixed).join(", ")})` : sl.name));
  return `- ${t.id}: ${t.whenToUse}.${args.length ? " 인자: " + args.join(", ") : ""}`;
};

/** A plain-text prompt: small models follow this far better than a JSON blob (measured on the dev split). */
export function buildPrompt({ goal, state, s1View, reasons }) {
  const lines = [
    `목표: ${goal}`,
    state.steps_done.length ? "지금까지 한 단계:\n" + state.steps_done.map((l) => "- " + l).join("\n") : "지금까지 한 단계: 없음",
  ];
  if (state.last_observation) lines.push(`직전 단계 결과: ${state.last_observation}`);
  lines.push("", "도구:", ...TOOLS.map(toolLine), "");
  const top = s1View?.top_actions?.length ? s1View.top_actions.map((a) => `${a.action} (${Math.round(a.p * 100)}%)`).join(", ") : "";
  if (top) lines.push(`더 작은 모델(System 1)의 제안: ${top}. 확신하지 못했습니다${reasons?.length ? ` (${reasons.join("; ")})` : ""}.`);
  const cands = Object.entries(s1View?.slot_candidates || {}).filter(([, v]) => v.length);
  if (cands.length) lines.push("본문에서 찾은 표현: " + cands.map(([k, v]) => `${k}: ${v.slice(0, 8).join(" | ")}`).join("; "));
  lines.push(
    state.steps_done.length ? "아직 목표에 답하지 못했으니 이미 한 호출을 반복하지 마세요." : "아직 아무것도 찾아보지 않았습니다.",
    "인자 값이 목표나 직전 결과에 있으면 그대로 옮겨 쓰고, 없을 때만 새로 쓰세요(예: 별명 뒤의 실제 이름).",
    "목표에 무엇을·어디를 말하지 않았을 때만 ask_user를 쓰세요. 계산은 모두 calculator로 하세요.",
    'JSON으로 답하세요: {"action": "<도구 id>", "args": {...}, "reason": "<짧은 이유>"}',
  );
  return lines.join("\n");
}

/** The yes/no stop check System 2 answers before planning (from the second step on). */
export function doneCheckPrompt({ goal, state }) {
  // wording chosen on the dev split: "does it answer the question completely?" made the model say no to everything
  return ["질문: " + goal, "찾은 내용: " + state.last_observation, "", "찾은 내용에 질문의 답이 들어 있습니까? 예 또는 아니오로만 답하세요."].join("\n");
}

/** Parse and tidy a JSON reply: map labels of fixed slots back to keys, drop args the tool does not take. */
export function parseReply(text) {
  // the first balanced {...} in the reply (models sometimes add text or a code fence around it)
  const src = String(text);
  const start = src.indexOf("{");
  let depth = 0, end = -1, inStr = false;
  for (let i = start; start >= 0 && i < src.length; i++) {
    const c = src[i];
    if (inStr) { if (c === "\\") i++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true; else if (c === "{") depth++; else if (c === "}" && --depth === 0) { end = i; break; }
  }
  if (start < 0 || end < 0) throw new Error("System 2가 JSON을 돌려주지 않았습니다");
  const j = JSON.parse(src.slice(start, end + 1));
  if (!TOOL[j.action]) throw new Error(`System 2가 알 수 없는 행동을 골랐습니다: "${j.action}"`);
  const tool = TOOL[j.action];
  const args = {};
  if (tool) {
    for (const s of tool.slots) {
      let v = j.args?.[s.name];
      if (v == null) continue;
      v = String(v).trim();
      if (s.fixed && !(v in s.fixed)) { const hit = Object.entries(s.fixed).find(([k, l]) => l.toLowerCase() === v.toLowerCase() || k.toLowerCase() === v.toLowerCase()); if (hit) v = hit[0]; }
      args[s.name] = v;
    }
    if (j.action === "ask_user" && j.args?.question) args.question = String(j.args.question);
  }
  return { action: j.action, args, reason: j.reason || "" };
}

export function hasWebGPU() { return true; } // 원격 모델이라 WebGPU가 필요 없다(공통 코드의 게이트 스텁)

/** Ollama의 OpenAI 호환 /v1/chat/completions를 원본 engine.chat.completions.create 도형으로 싼 것. */
export function makeOllamaChatEngine(model, base) {
  return {
    async chat_completions_create({ temperature = 0, max_tokens, messages }) {
      const t0 = performance.now && typeof performance !== "undefined" ? performance.now() : Date.now();
      const res = await fetch(base + "/v1/chat/completions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages, temperature, max_tokens, stream: false }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Ollama /v1/chat/completions: HTTP ${res.status}`);
      const ms = (performance.now && typeof performance !== "undefined" ? performance.now() : Date.now()) - t0;
      return {
        choices: data.choices || [{ message: { content: "" } }],
        ms,
        usage: data.usage && { prompt_tokens: data.usage.prompt_tokens, completion_tokens: data.usage.completion_tokens },
      };
    },
  };
}

/**
 * Ollama 생성 모델을 System 2로 쓴다. Returns { decide, rewrite, ready, model, info, unload }.
 * @param opts { model, base, onProgress(fraction|null, text) }
 */
export async function loadSystem2({ model = DEFAULT_S2, base = ollamaBase(), onProgress = () => {} } = {}) {
  onProgress(0.3, "Ollama 서버 확인 중…");
  const t0 = performance.now();
  const engine = makeOllamaChatEngine(model, base);
  try { const tags = await (await fetch(base + "/api/tags")).json();
    if (!tags.models?.some((m) => m.name === model)) throw new Error(`${model} 모델이 서버에 없습니다`);
  } catch (e) { throw new Error(`Ollama 서버에 연결할 수 없습니다: ${base} (${e.message})`); }
  onProgress(0.7, `${model} 워밍업 중…`);
  try { await engine.chat_completions_create({ temperature: 0, max_tokens: 8, messages: [{ role: "user", content: "OK" }] }); } catch { /* 워밍업 실패해도 첫 호출에서 다시 시도된다 */ }
  const loadMs = performance.now() - t0;
  onProgress(null, "");
  let busy = Promise.resolve();
  const serial = (fn) => { const p = busy.then(fn); busy = p.catch(() => {}); return p; };

  async function decide(payload) {
    return serial(async () => {
      const t = performance.now();
      // 1) after the first step, a one-word check: is the goal already answered? (a planning prompt alone keeps
      //    repeating the last tool; a separate yes/no question stops far more reliably)
      if (payload.state.last_observation) {
        const check = doneCheckPrompt(payload);
        const r = await engine.chat_completions_create({ temperature: 0, max_tokens: 2048, messages: [{ role: "user", content: check }] });
        const yes = /^(?:\W*(?:yes|예|네))/i.test(r.choices?.[0]?.message?.content || "");
        if (yes) return { action: "FINISH", args: {}, reason: "직전 결과가 목표에 답함", raw: r.choices[0].message.content, prompt: check, ms: performance.now() - t };
      }
      // 2) otherwise plan the next tool call
      const prompt = buildPrompt(payload);
      const reply = await engine.chat_completions_create({
        temperature: 0, max_tokens: 2048,
        messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: prompt }],
      });
      const raw = reply.choices?.[0]?.message?.content || "";
      const ms = performance.now() - t;
      let parsed;
      try { parsed = parseReply(raw); } catch (e) { return { action: null, args: {}, reason: "", raw, prompt, ms, parseError: String(e.message) }; }
      return { ...parsed, raw, prompt, ms, usage: reply.usage };
    });
  }

  async function rewrite(goal, templated, steps) {
    return serial(async () => {
      const t = performance.now();
      const facts = steps.filter((s) => s.result?.answer).map((s) => s.result.answer);
      const reply = await engine.chat_completions_create({
        temperature: 0, max_tokens: 2048,
        messages: [
          { role: "system", content: "주어진 사실만 사용해 사용자의 질문에 한 짧은 문단으로 답하세요. 사실을 추가하지 말고 숫자는 그대로 쓰세요." },
          { role: "user", content: JSON.stringify({ question: goal, facts, draft_answer: templated }) },
        ],
      });
      return { text: (reply.choices?.[0]?.message?.content || templated).trim(), ms: performance.now() - t };
    });
  }

  return {
    decide, rewrite, model, engine, ready: () => true,
    info: { model, label: model, loadMs },
    async unload() { /* 원격 모델: 내릴 것 없다 */ },
  };
}
