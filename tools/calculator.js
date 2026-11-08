// calculator: 안전한 산술 계산 (eval 없음). Laya는 숫자에 약하므로 모든 계산은 여기로 온다.
// 후보 추출기가 찾는 표현: "2,450의 18%", "(3 + 4) * 12", "15 곱하기 7", "2의 10제곱".

const WORDS = [
  [/\bdivided by\b/gi, "/"], [/\bmultiplied by\b/gi, "*"], [/\btimes\b/gi, "*"], [/\bplus\b/gi, "+"], [/\bminus\b/gi, "-"],
  [/\bto the power of\b/gi, "^"], [/[×x](?=\s*[\d(])/g, "*"], [/÷/g, "/"],
  // 한국어
  [/나누기|나눈|나누면/g, "/"], [/곱하기|곱한|곱하면/g, "*"], [/더하기|더한|플러스/g, "+"], [/빼기|뺀|마이너스/g, "-"],
];

/** Turn a natural span into a plain expression: "2,450의 18%" -> "(2450)*(18/100)". */
export function normalizeExpression(src) {
  let s = String(src ?? "").trim().replace(/[?=]+$/, "");
  s = s.replace(/(\d),(?=\d{3}\b)/g, "$1");
  for (const [re, to] of WORDS) s = s.replace(re, to);
  s = s.replace(/(\d+(?:\.\d+)?)\s*의\s*(\d+(?:\.\d+)?)\s*%/g, "($1)*($2/100)");
  s = s.replace(/(\d+(?:\.\d+)?)\s*%\s*of\s*/gi, "($1/100)*");
  s = s.replace(/(\d+(?:\.\d+)?)\s*%\s*of?\s*/g, "($1/100)*");
  s = s.replace(/(\d+(?:\.\d+)?)\s*%/g, "($1/100)");
  s = s.replace(/(\d+(?:\.\d+)?)\s*의\s*(\d+)\s*제곱/g, "($1^$2)");
  return s.replace(/\s+/g, " ").trim();
}

/** Recursive-descent evaluator for + - * / ^ and parentheses. Throws on anything else. */
export function evaluateExpression(src) {
  const s = normalizeExpression(src);
  let i = 0;
  const peek = () => { while (s[i] === " ") i++; return s[i]; };
  const num = () => {
    peek();
    const m = /^\d+(?:\.\d+)?|^\.\d+/.exec(s.slice(i));
    if (!m) throw new Error(`expected a number at "${s.slice(i) || "end"}"`);
    i += m[0].length; return parseFloat(m[0]);
  };
  const atom = () => {
    const c = peek();
    if (c === "(") { i++; const v = expr(); if (peek() !== ")") throw new Error("missing )"); i++; return v; }
    if (c === "-") { i++; return -atom(); }
    if (c === "+") { i++; return atom(); }
    return num();
  };
  const power = () => { const b = atom(); if (peek() === "^") { i++; return Math.pow(b, power()); } return b; };
  const term = () => {
    let v = power();
    for (let c = peek(); c === "*" || c === "/"; c = peek()) { i++; const r = power(); v = c === "*" ? v * r : v / r; }
    return v;
  };
  const expr = () => {
    let v = term();
    for (let c = peek(); c === "+" || c === "-"; c = peek()) { i++; const r = term(); v = c === "+" ? v + r : v - r; }
    return v;
  };
  if (!s) throw new Error("empty expression");
  const v = expr();
  if (peek() !== undefined) throw new Error(`unexpected "${s.slice(i)}"`);
  if (!Number.isFinite(v)) throw new Error("result is not a finite number");
  return v;
}

export const fmtNumber = (v) => Number.isInteger(v)
  ? v.toLocaleString("ko-KR")
  : (+v.toPrecision(10)).toLocaleString("ko-KR", { maximumFractionDigits: 6 });

export default {
  id: "calculator",
  whenToUse: "목표에 주어진 숫자로 산술·퍼센트 계산을 한다",
  slots: [{ name: "expression", kinds: ["expression"], instruction: "어떤 계산식을 계산해야 하는가?", none: "이 중에는 필요한 계산이 없음" }],
  async run({ expression }) {
    const v = evaluateExpression(expression);
    const out = fmtNumber(v);
    return { observation: `${expression} = ${out}`, answer: `${expression} = ${out}`, data: { value: v } };
  },
};
