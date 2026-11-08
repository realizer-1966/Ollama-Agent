// wiki_lookup: 한국어 위키백과 문서 검색 + 요약 (둘 다 CORS 헤더를 보내고 키가 필요 없다).
// 첫 문단을 돌려주며, 여기서 다단계(multi-hop) 사실의 대부분이 나온다 ("교토는 일본 간사이 지방에 있는 도시이다").

import { getJson, getText } from "../http.js";

const API = "https://ko.wikipedia.org";

export function firstSentences(text, n = 3) {
  // 문장 부호 뒤 공백에서 자른다. "1.6 km"나 "U.S."는 그대로 두기 위해 뒤에 대문자/한글이 올 때만 자른다.
  return String(text || "").replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+(?=[A-Z0-9("“가-힣])/).slice(0, n).join(" ").trim();
}

export default {
  id: "wiki_lookup",
  whenToUse: "사람·장소·사물·사건에 대한 백과사전 문서를 읽는다",
  slots: [{ name: "topic", kinds: ["proper", "place", "person", "org", "topic", "noun"], instruction: "어떤 주제를 백과사전에서 찾을 것인가?", none: "이 중에는 찾을 주제가 없음" }],
  async run({ topic }, ctx = {}) {
    const f = ctx.fetch || fetch;
    const s = await getJson(f, `${API}/w/rest.php/v1/search/title?q=${encodeURIComponent(topic)}&limit=1`);
    const hit = s.pages?.[0];
    if (!hit) return { observation: `"${topic}"에 대한 백과사전 문서를 찾지 못했습니다.`, answer: `"${topic}" 문서를 찾지 못했습니다.`, data: null, ok: false };
    const r = await getText(f, `${API}/api/rest_v1/page/summary/${encodeURIComponent(hit.key)}?redirect=true`);
    const j = await r.json();
    const lead = firstSentences(j.extract, 3);
    return {
      observation: `${j.title}${j.description ? ` (${j.description})` : ""}: ${lead}`,
      answer: `${j.title}: ${firstSentences(j.extract, 2)}`,
      data: { title: j.title, description: j.description || "", url: j.content_urls?.desktop?.page || `${API}/wiki/${hit.key}` },
      source: j.content_urls?.desktop?.page || `${API}/wiki/${hit.key}`,
    };
  },
};
