// Agent memory: note_save / note_search / note_delete over ctx.notes (IndexedDB in the page, a Map in tests and in
// the evaluation, where each task seeds its own notes). Search is lexical (content-word overlap), so no second model.
// 한국어판: 조사를 떼고 내용어만 비교한다 (ko.js의 koWords).
import { koWords } from "../ko.js";

export const words = (s) => {
  const ko = koWords(s);
  if (ko.length) return ko;
  return String(s || "").toLowerCase().replace(/'s\b/g, "").match(/[a-z0-9]+/g)?.map((w) => w.replace(/(?<=\w{3})s$/, "")) || [];
};

export function scoreNote(query, text) {
  const q = new Set(words(query)), t = new Set(words(text));
  if (!q.size) return 0;
  let hit = 0; for (const w of q) if (t.has(w)) hit++;
  return hit / q.size;
}

export function searchNotes(notes, query, k = 3) {
  return notes.map((n) => ({ ...n, score: scoreNote(query, n.text) })).filter((n) => n.score > 0).sort((a, b) => b.score - a.score || b.at - a.at).slice(0, k);
}

/** In-memory note store; the page swaps in an IndexedDB-backed one with the same interface. */
export function memoryNotes(seed = []) {
  let id = 0;
  const m = new Map(seed.map((t) => { const n = typeof t === "string" ? { text: t } : t; const note = { id: ++id, at: id, ...n }; return [note.id, note]; }));
  return {
    async all() { return [...m.values()]; },
    async add(text) { const n = { id: ++id, text, at: Date.now() }; m.set(n.id, n); return n; },
    async remove(ids) { ids.forEach((i) => m.delete(i)); },
  };
}

export const noteSave = {
  id: "note_save",
  whenToUse: "사용자가 나중에 기억해 달라고 한 내용을 메모로 저장한다",
  sideEffect: "이 브라우저에 메모를 저장합니다",
  slots: [{ name: "text", kinds: ["clause"], instruction: "정확히 무엇을 메모로 저장해야 하는가?", none: "이 중에는 저장할 내용이 없음" }],
  async run({ text }, ctx) {
    await ctx.notes.add(text);
    return { observation: `메모를 저장했습니다: "${text}"`, answer: `저장했습니다: "${text}"`, data: { text } };
  },
};

export const noteSearch = {
  id: "note_search",
  whenToUse: "예전에 사용자가 말한 내용을 저장된 메모에서 찾는다",
  slots: [{ name: "query", kinds: ["noun", "topic", "proper", "person"], instruction: "저장된 메모에서 무엇을 찾아야 하는가?", none: "이 중에는 찾을 것이 없음" }],
  async run({ query }, ctx) {
    const hits = searchNotes(await ctx.notes.all(), query);
    if (!hits.length) return { observation: `"${query}"에 대해 저장된 메모가 없습니다.`, answer: `"${query}"에 대한 메모가 없습니다.`, data: { hits: [] }, ok: false };
    const out = `"${query}" 관련 메모: ${hits.map((h) => `"${h.text}"`).join("; ")}`;
    return { observation: out, answer: `메모에서 찾았습니다: ${hits.map((h) => `"${h.text}"`).join("; ")}`, data: { hits: hits.map((h) => h.text) } };
  },
};

export const noteDelete = {
  id: "note_delete",
  whenToUse: "사용자가 더 이상 원하지 않는 저장된 메모를 지운다",
  sideEffect: "저장된 메모를 영구히 삭제합니다",
  slots: [{ name: "query", kinds: ["noun", "topic", "proper", "person"], extra: ["모든 메모"], instruction: "어떤 메모를 지워야 하는가?", none: "이 중에는 지울 메모를 가리키는 것이 없음" }],
  async run({ query }, ctx) {
    const all = await ctx.notes.all();
    const gone = /^(?:all( notes)?|모든 메모|전부|전체)$/i.test(query.trim()) ? all : searchNotes(all, query, 50);
    await ctx.notes.remove(gone.map((n) => n.id));
    const out = gone.length ? `메모 ${gone.length}개를 지웠습니다: ${gone.map((n) => `"${n.text}"`).join("; ")}` : `"${query}"에 맞는 메모가 없어 아무것도 지우지 않았습니다.`;
    return { observation: out, answer: out, data: { deleted: gone.length } };
  },
};
