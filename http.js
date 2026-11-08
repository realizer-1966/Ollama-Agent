// 작은 HTTP 도우미: User-Agent를 붙이고 429/5xx에서 물러났다 다시 시도한다.
// Wikimedia API는 User-Agent 없는 요청이나 몰아치는 요청에 HTML 오류 페이지를 돌려준다 (JSON 파싱이 깨진다).
const UA = "layaAgent-ko/0.1 (browser demo; https://github.com/realizer-1966/layaAgent-ko)";

export async function getJson(f, url, init = {}, tries = 6) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    let r;
    try {
      r = await f(url, { ...init, headers: { "User-Agent": UA, Accept: "application/json", ...(init.headers || {}) } });
    } catch (e) { last = e; await new Promise((res) => setTimeout(res, 800 * (i + 1))); continue; }
    if (r.ok) {
      const text = await r.text();
      try { return JSON.parse(text); } catch { throw new Error(`JSON이 아닌 응답: ${text.replace(/\s+/g, " ").slice(0, 60)}`); }
    }
    last = new Error(`HTTP ${r.status}`);
    if (r.status !== 429 && r.status !== 503 && r.status < 500) throw last;
    await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
  }
  throw last || new Error("요청 실패");
}

export async function getText(f, url, init = {}, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const r = await f(url, { ...init, headers: { "User-Agent": UA, ...(init.headers || {}) } });
    if (r.ok) return r;
    if (r.status !== 429 && r.status < 500) throw new Error(`HTTP ${r.status}`);
    await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
  }
  throw new Error("HTTP 429 (요청이 너무 많음)");
}
