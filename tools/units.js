// unit_convert: 로컬 환산표. 목표 단위는 고정 목록이라 Laya가 쓰지 않고 고르기만 한다.
import { fmtNumber } from "./calculator.js";

// factor to the base unit of each dimension (m, kg, l, m/s); temperature is handled separately
const UNITS = {
  km: ["length", 1000, ["km", "kilometer", "kilometers", "kilometre", "kilometres", "킬로미터", "킬로"]],
  m: ["length", 1, ["m", "meter", "meters", "metre", "metres", "미터"]],
  cm: ["length", 0.01, ["cm", "centimeter", "centimeters", "centimetre", "centimetres", "센티미터"]],
  mi: ["length", 1609.344, ["mi", "mile", "miles", "마일"]],
  ft: ["length", 0.3048, ["ft", "foot", "feet", "피트"]],
  in: ["length", 0.0254, ["in", "inch", "inches", "인치"]],
  kg: ["mass", 1, ["kg", "kilogram", "kilograms", "kilo", "kilos", "킬로그램", "킬로"]],
  g: ["mass", 0.001, ["g", "gram", "grams", "그램"]],
  lb: ["mass", 0.45359237, ["lb", "lbs", "pound", "pounds", "파운드"]],
  oz: ["mass", 0.028349523125, ["oz", "ounce", "ounces", "온스"]],
  l: ["volume", 1, ["l", "liter", "liters", "litre", "litres", "리터"]],
  ml: ["volume", 0.001, ["ml", "milliliter", "milliliters", "millilitre", "millilitres", "밀리리터"]],
  gal: ["volume", 3.785411784, ["gal", "gallon", "gallons", "갤런"]],
  C: ["temperature", null, ["c", "°c", "celsius", "degrees celsius", "degrees c", "deg c", "섭씨", "도", "℃"]],
  F: ["temperature", null, ["f", "°f", "fahrenheit", "degrees fahrenheit", "degrees f", "deg f", "화씨", "℉"]],
  "km/h": ["speed", 1 / 3.6, ["km/h", "kph", "kmh", "kilometers per hour", "kilometres per hour", "시속 킬로미터"]],
  mph: ["speed", 0.44704, ["mph", "miles per hour", "시속 마일"]],
};
const ALIAS = new Map(Object.entries(UNITS).flatMap(([id, [, , names]]) => names.map((n) => [n, id])));
export const UNIT_WORDS = [...ALIAS.keys()].sort((a, b) => b.length - a.length);

// The options Laya picks the target from (key -> label). Keep it short: every option costs head tokens.
export const TARGET_UNITS = { km: "킬로미터", mi: "마일", m: "미터", ft: "피트", kg: "킬로그램", lb: "파운드", l: "리터", gal: "갤런", C: "섭씨", F: "화씨", "km/h": "시속 킬로미터", mph: "시속 마일" };
export const UNIT_LABEL = { km: "킬로미터", mi: "마일", m: "미터", cm: "센티미터", ft: "피트", in: "인치", kg: "킬로그램", g: "그램", lb: "파운드", oz: "온스", l: "리터", ml: "밀리리터", gal: "갤런", C: "도C", F: "도F", "km/h": "km/h", mph: "mph" };

export function unitId(word) { return ALIAS.get(String(word).trim().toLowerCase().replace(/\.$/, "")) || null; }

/** "5킬로미터" / "72°F" / "3.5 kg" / "20도" -> { value, unit } */
export function parseQuantity(span) {
  const src = String(span).replace(/(\d),(?=\d{3}\b)/g, "$1");
  const m = /(-?\d+(?:\.\d+)?)\s*/.exec(src);
  if (!m) throw new Error(`no quantity in "${span}"`);
  // the longest unit name right after the number ("degrees fahrenheit" before "f")
  const rest = src.slice(m.index + m[0].length).toLowerCase().replace(/^°\s+/, "°");
  const word = UNIT_WORDS.find((w) => rest.startsWith(w) && !/[a-z가-힣]/.test(rest[w.length] || ""));
  if (!word) throw new Error(`unknown unit in "${span}"`);
  return { value: parseFloat(m[1]), unit: ALIAS.get(word) };
}

export function convert(value, from, to) {
  const [df, ff] = UNITS[from], [dt, ft] = UNITS[to];
  if (df !== dt) throw new Error(`cannot convert ${df} to ${dt}`);
  if (df === "temperature") {
    const c = from === "C" ? value : (value - 32) * 5 / 9;
    return to === "C" ? c : c * 9 / 5 + 32;
  }
  return (value * ff) / ft;
}

export default {
  id: "unit_convert",
  whenToUse: "한 단위로 된 양을 다른 단위로 바꾼다",
  slots: [
    { name: "quantity", kinds: ["quantity"], instruction: "어떤 양을 바꿀 것인가?", none: "이 중에는 바꿀 양이 없음" },
    { name: "to_unit", fixed: TARGET_UNITS, instruction: "어떤 단위로 바꿀 것인가?" },
  ],
  async run({ quantity, to_unit }) {
    const q = parseQuantity(quantity);
    const to = UNITS[to_unit] ? to_unit : unitId(to_unit) || Object.keys(TARGET_UNITS).find((k) => TARGET_UNITS[k] === to_unit);
    if (!to) throw new Error(`unknown unit "${to_unit}"`);
    const v = convert(q.value, q.unit, to);
    const out = `${quantity} = ${fmtNumber(+v.toFixed(v < 10 ? 3 : 2))} ${UNIT_LABEL[to] || TARGET_UNITS[to] || to}`;
    return { observation: out, answer: out, data: { value: v, unit: to } };
  },
};
