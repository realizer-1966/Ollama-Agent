// date_math: "3월 4일부터 3주 후", "2026년 12월 25일 10일 전", "오늘부터 90일 후". Local, deterministic
// (the reference "today" comes from ctx.now, so recorded runs replay the same).
// 한국어판: 한국어 날짜("2026년 3월 4일", "3월 4일", "오늘", "내일")와 기간("3주 후", "10일 전")을 읽는다.

const WEEKDAYS_KO = ["일", "월", "화", "수", "목", "금", "토"];
export const WEEKDAYS = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];

const utc = (y, m, d) => new Date(Date.UTC(y, m, d));
export const today = (now) => { const n = now ? new Date(now) : new Date(); return utc(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()); };

const shift = (t, days) => utc(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + days);
/** 이번 주 토요일까지 남은 일수 (오늘이 토요일이면 0, 일요일이면 -1) */
export function weekendStart(now) {
  const dow = today(now).getUTCDay();
  return dow === 6 ? 0 : dow === 0 ? -1 : 6 - dow;
}

/** "2026년 3월 4일", "3월 4일", "2026-12-25", "오늘", "내일", "이번 주말" -> Date (UTC midnight). */
export function parseDate(span, now) {
  const s = String(span).trim().replace(/[?.!,]+$/, "");
  const t = today(now);
  if (!s || /^(?:today|now|오늘|지금)$/i.test(s)) return t;
  if (/^(?:tomorrow|내일)$/i.test(s)) return shift(t, 1);
  if (/^(?:yesterday|어제)$/i.test(s)) return shift(t, -1);
  if (/^(?:모레)$/.test(s)) return shift(t, 2);
  if (/이번\s*주말|다음\s*주말/.test(s)) {
    const sat = weekendStart(now);
    const base = sat < 0 ? 0 : sat;
    return shift(t, /다음/.test(s) ? base + 7 : base);
  }
  if (/이번\s*주|다음\s*주/.test(s)) return shift(t, /다음/.test(s) ? 7 : 0);
  if (/이번\s*달|다음\s*달/.test(s)) return utc(t.getUTCFullYear(), t.getUTCMonth() + (/다음/.test(s) ? 1 : 0), 1);
  let m;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) return utc(+m[1], +m[2] - 1, +m[3]);
  if ((m = /^(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일$/.exec(s))) return utc(+m[1], +m[2] - 1, +m[3]);
  if ((m = /^(\d{1,2})\s*월\s*(\d{1,2})\s*일$/.exec(s))) return utc(t.getUTCFullYear(), +m[1] - 1, +m[2]);
  throw new Error(`날짜를 읽을 수 없습니다: "${span}"`);
}

/** "3주 후" / "10일 전" / "2개월 뒤" / "3 weeks after" -> { n, unit, sign } */
export function parseOffset(span) {
  const s = String(span).toLowerCase();
  const m = /(\d+)\s*(일|주|개월|달|년|day|week|month|year)s?/.exec(s);
  if (!m) throw new Error(`기간을 읽을 수 없습니다: "${span}"`);
  const unit = m[2];
  const u = unit === "일" ? "day" : unit === "주" ? "week" : unit === "개월" || unit === "달" ? "month" : unit === "년" ? "year" : unit;
  const before = /(?:전|앞|이전|남기|빼기)|\b(?:before|earlier|ago|prior)\b/.test(s);
  return { n: +m[1], unit: u, sign: before ? -1 : 1 };
}

export function addOffset(date, { n, unit, sign }) {
  const d = new Date(date.getTime());
  const k = n * sign;
  if (unit === "day") d.setUTCDate(d.getUTCDate() + k);
  else if (unit === "week") d.setUTCDate(d.getUTCDate() + 7 * k);
  else if (unit === "month") d.setUTCMonth(d.getUTCMonth() + k);
  else d.setUTCFullYear(d.getUTCFullYear() + k);
  return d;
}

export const fmtDate = (d) => `${d.getUTCFullYear()}년 ${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 (${WEEKDAYS_KO[d.getUTCDay()]})`;

const UNIT_KO = { day: "일", week: "주", month: "개월", year: "년" };

export default {
  id: "date_math",
  whenToUse: "날짜에 일·주·개월을 더하거나 빼서 날짜를 계산한다",
  slots: [
    { name: "date", kinds: ["date"], extra: ["오늘", "내일"], instruction: "어느 날짜가 기준인가?", none: "이 중에는 기준 날짜가 없음" },
    { name: "offset", kinds: ["duration"], instruction: "얼마의 기간을 더하거나 빼야 하는가?", none: "이 중에는 기간이 없음" },
  ],
  async run({ date, offset }, ctx = {}) {
    const d0 = parseDate(date, ctx.now), off = parseOffset(offset);
    const d = addOffset(d0, off);
    const out = `${fmtDate(d0)}에서 ${off.n}${UNIT_KO[off.unit] || off.unit} ${off.sign < 0 ? "전" : "후"}는 ${fmtDate(d)}입니다`;
    return { observation: out, answer: out, data: { date: d.toISOString().slice(0, 10) } };
  },
};
