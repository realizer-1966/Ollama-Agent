// wikidata_fact: Wikidata에서 한 개체의 속성 하나 (개체 검색 + 한 줄짜리 REST 조회, 둘 다 CORS 지원).
// 속성은 고정 목록이라 Laya가 고르기만 한다. 숫자는 데이터로 돌아오고 Laya가 계산하지 않는다.
// 한국어판: 개체 검색은 language=ko, 라벨도 한국어를 먼저 읽고 없으면 영어로 떨어진다.
import { fmtNumber } from "./calculator.js";
import { getJson } from "../http.js";

export const PROPERTIES = {
  population: { pid: "P1082", label: "인구", number: true },
  capital: { pid: "P36", label: "수도" },
  country: { pid: "P17", label: "속한 나라", name: "나라" },
  head_of_government: { pid: "P6", label: "정부 수반(대통령·총리·시장)" },
  ceo: { pid: "P169", label: "최고경영자(CEO)" },
  founded: { pid: "P571", label: "설립·창립 연도", date: true },
  founder: { pid: "P112", label: "설립자" },
  official_language: { pid: "P37", label: "공용어" },
  currency: { pid: "P38", label: "통화" },
  area: { pid: "P2046", label: "면적", number: true, unit: "km²" },
  height: { pid: "P2048", label: "높이", number: true, unit: "m" },
};

const SEARCH = "https://www.wikidata.org/w/api.php";
const REST = "https://www.wikidata.org/w/rest.php/wikibase/v1/entities/items/";

export function formatValue(prop, raw) {
  if (prop.date) return String(raw).replace(/^\+/, "").slice(0, 4) + "년";
  if (prop.number) return `${fmtNumber(Math.round(+raw * 100) / 100)}${prop.unit ? " " + prop.unit : ""}`;
  return raw;
}

const qual = (st, pid) => st.qualifiers?.find((q) => q.property.id === pid)?.value?.content;
/**
 * The current value(s) of a property, like Wikidata's "truthy" statements: no deprecated ones; preferred rank wins;
 * statements with an end time are dropped when others remain; with a point in time (population), the latest wins.
 */
export function currentStatements(list = []) {
  let s = list.filter((x) => x.rank !== "deprecated" && x.value?.type === "value");
  if (s.some((x) => x.rank === "preferred")) s = s.filter((x) => x.rank === "preferred");
  const open = s.filter((x) => !qual(x, "P582"));
  if (open.length) s = open;
  const dated = s.filter((x) => qual(x, "P585")?.time);
  if (dated.length) { const t = dated.map((x) => qual(x, "P585").time).sort().at(-1); s = dated.filter((x) => qual(x, "P585").time === t); }
  return s;
}

export default {
  id: "wikidata_fact",
  whenToUse: "이름이 있는 것의 인구·수도·CEO·설립자·높이 같은 사실 하나를 찾는다",
  slots: [
    { name: "entity", kinds: ["proper", "place", "person", "org", "topic", "noun"], instruction: "어떤 대상에 대한 사실인가?", none: "이 중에는 대상이 없음" },
    { name: "property", fixed: Object.fromEntries(Object.entries(PROPERTIES).map(([k, v]) => [k, v.label])), instruction: "그 대상의 어떤 사실이 필요한가?" },
  ],
  async run({ entity, property }, ctx = {}) {
    const f = ctx.fetch || fetch;
    const prop = PROPERTIES[property] || PROPERTIES[Object.keys(PROPERTIES).find((k) => PROPERTIES[k].label === property)];
    if (!prop) throw new Error(`알 수 없는 속성 "${property}"`);
    const s = await getJson(f, `${SEARCH}?action=wbsearchentities&search=${encodeURIComponent(entity)}&language=ko&uselang=ko&format=json&limit=1&origin=*`);
    const hit = s.search?.[0];
    if (!hit) return { observation: `Wikidata에 "${entity}"라는 개체가 없습니다.`, answer: `"${entity}" 개체를 찾지 못했습니다.`, data: null, ok: false };
    const sts = currentStatements((await getJson(f, `${REST}${hit.id}/statements?property=${prop.pid}`))[prop.pid]);
    const label = hit.label || entity;
    const name = prop.name || prop.label.split("(")[0];
    if (!sts.length) return { observation: `${label}의 ${name} 정보가 Wikidata에 없습니다.`, answer: `${label}의 ${name}은(는) 기록되어 있지 않습니다.`, data: null, ok: false };
    const vals = [];
    for (const st of sts.slice(0, 3)) {
      const c = st.value.content;
      let v;
      if (st.property.data_type === "wikibase-item") {
        const lk = await getJson(f, `${REST}${c}/labels/ko`).catch(() => null);
        const le = lk || await getJson(f, `${REST}${c}/labels/en`).catch(() => c);
        v = typeof le === "string" ? le : le?.value || c;
      } else if (st.property.data_type === "quantity") v = formatValue(prop, c.amount);
      else if (st.property.data_type === "time") v = formatValue(prop, c.time);
      else v = typeof c === "object" ? c.text ?? JSON.stringify(c) : c;
      if (!vals.includes(v)) vals.push(v);
    }
    const out = `${label}의 ${name}: ${vals.join(", ")} (Wikidata)`;
    return { observation: out, answer: out, data: { id: hit.id, values: vals }, source: `https://www.wikidata.org/wiki/${hit.id}` };
  },
};
