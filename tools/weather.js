// weather: Open-Meteo 지오코딩 + 일별 예보 (CORS, 키 불필요). 시간 범위는 Laya가 고르는 고정 목록이다.
// 한국어판: 한국어 지명을 그대로 지오코딩하고(Open-Meteo가 한글 지명 일부를 안다), 실패하면 사전의 영문 이름으로
// 다시 시도한다. 출력 문장은 한국어, WMO 코드는 한국어 설명으로 바꾼다.
import { WEEKDAYS, today, weekendStart } from "./datemath.js";
import { placeQueries } from "../ko.js";
import { getJson } from "../http.js";

export const WHEN = { today: "오늘", tomorrow: "내일", weekend: "이번 주말(토·일)", week: "앞으로 며칠" };

// WMO weather interpretation codes (Open-Meteo docs), shortened
const WMO = { 0: "맑음", 1: "대체로 맑음", 2: "구름 조금", 3: "흐림", 45: "안개", 48: "안개", 51: "약한 이슬비", 53: "이슬비", 55: "강한 이슬비",
  56: "어는 이슬비", 57: "어는 이슬비", 61: "약한 비", 63: "비", 65: "강한 비", 66: "어는 비", 67: "어는 비", 71: "약한 눈",
  73: "눈", 75: "많은 눈", 77: "싸락눈", 80: "소나기", 81: "소나기", 82: "강한 소나기", 85: "눈 소나기", 86: "눈 소나기",
  95: "뇌우", 96: "우박을 동반한 뇌우", 99: "우박을 동반한 뇌우" };

/** Indices into a 7-day daily forecast that starts today, for a time window. */
export function dayIndices(when, now) {
  const dow = today(now).getUTCDay();
  if (when === "tomorrow" || when === "내일") return [1];
  if (when === "weekend" || /주말/.test(when)) { const sat = weekendStart(now); return sat < 0 ? [0] : [sat, sat + 1].filter((i) => i < 7); }
  if (when === "week" || /며칠/.test(when)) return [0, 1, 2];
  return [0];
}

export default {
  id: "weather",
  whenToUse: "어느 장소와 시점의 날씨 예보를 가져온다",
  slots: [
    { name: "place", kinds: ["place", "proper"], instruction: "어느 장소의 날씨 예보인가?", none: "이 중에는 맞는 장소가 없음" },
    { name: "when", fixed: WHEN, instruction: "며칠 치 예보를 볼 것인가?" },
  ],
  async run({ place, when = "today" }, ctx = {}) {
    const f = ctx.fetch || fetch;
    // "리스본, 포르투갈": 쉼표 앞이 지명, 뒤가 지역/나라 한정어
    const [name, ...qual] = String(place).split(",").map((x) => x.trim());
    const q = qual.join(" ").toLowerCase();
    let loc = null;
    for (const query of placeQueries(name)) {
      const g = await getJson(f, `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=${qual.length ? 20 : 1}&language=ko&format=json`).catch((e) => { if (String(e.message).startsWith("HTTP 429") || String(e.message).includes("JSON")) throw e; return {}; });
      const hit = (q && g.results?.find((r) => [r.admin1, r.admin2, r.country, r.country_code].some((v) => v && (q.includes(String(v).toLowerCase()) || String(v).toLowerCase().includes(q))))) || g.results?.[0];
      if (hit) { loc = hit; break; }
    }
    if (!loc) return { observation: `"${place}"라는 장소를 찾지 못했습니다.`, answer: `"${place}"를 찾지 못했습니다.`, data: null, ok: false };
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=7`;
    const w = await getJson(f, url);
    const d = w.daily;
    if (!d?.time) throw new Error("Open-Meteo: 일별 예보가 없습니다");
    const days = dayIndices(when, ctx.now).map((i) => {
      const dt = new Date(d.time[i] + "T00:00:00Z");
      return `${d.time[i].slice(5)}(${WEEKDAYS[dt.getUTCDay()][0]}): ${WMO[d.weather_code[i]] ?? "코드 " + d.weather_code[i]}, ${Math.round(d.temperature_2m_min[i])}~${Math.round(d.temperature_2m_max[i])}°C, 강수 확률 ${d.precipitation_probability_max[i] ?? "?"}%`;
    });
    const where = [loc.name, loc.admin1, loc.country].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(", ");
    const out = `${where} ${WHEN[when] || when} 예보: ${days.join("; ")}`;
    return { observation: out, answer: out, data: { place: where }, source: "https://open-meteo.com/" };
  },
};
