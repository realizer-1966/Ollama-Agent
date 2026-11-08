// 한국어 텍스트 유틸리티: 조사 분리, 불용어, 고유명사 사전, 날짜·수량·산술·문장 추출.
// The upstream page used compromise.js (English-only) for candidate extraction. Korean has no whitespace-free
// morphology problem here — the hard parts are particles (조사) and named entities — so this module replaces
// compromise for Korean with a small, deterministic, auditable rule set. No model is involved, and nothing here
// writes text: it only proposes spans that Laya can pick from (see candidates.js).

// ---- 조사 (particles) ---------------------------------------------------------------------------------------------
// Longest first: "에서는" must win over "에서" and "는".
export const PARTICLES = [
  "에서는", "에서도", "에게서는", "으로부터는", "으로부터", "으로서는", "으로써", "이라고는", "이라고", "이라는",
  "에게는", "한테는", "에서의", "으로의", "까지는", "부터는", "처럼은", "보다는", "에서는", "에게도", "한테도",
  "에서", "에게", "한테", "께서", "으로", "부터", "까지", "처럼", "보다", "마다", "조차", "마저", "밖에",
  "이나", "이랑", "라고", "라는", "이며", "이고", "인", "은", "는", "이", "가", "을", "를", "의", "에",
  "와", "과", "도", "만", "로", "께", "나", "랑",
];
// Particles that mark a location ("파리에서", "리스본의 날씨") and so make the noun before them a place candidate.
export const LOCATIVE = new Set(["에", "에서", "에는", "에서는", "에도", "에서도", "에서의", "으로", "로", "으로의"]);
// Particles that mark a recipient ("프리야에게").
export const DATIVE = new Set(["에게", "한테", "께", "에게는", "한테는", "에게도", "한테도", "에게서는"]);

/** "에펠탑이" -> { base: "에펠탑", particle: "이" }; "파리" -> { base: "파리", particle: "" }. */
export function splitParticle(word) {
  const w = String(word || "").trim();
  if (!w) return { base: "", particle: "" };
  const latin = /[A-Za-z0-9]$/.test(w);
  for (const p of PARTICLES) {
    if (!w.endsWith(p)) continue;
    const base = w.slice(0, -p.length);
    // 한글 어근이 한 글자만 남으면 조사가 아니라 단어의 일부일 가능성이 크다 ("아이", "차이", "회의")
    if (base.length < (latin ? 1 : 2)) continue;
    if (!/[가-힣A-Za-z0-9]$/.test(base)) continue;
    if (STOP.has(base)) return { base, particle: p };
    return { base, particle: p };
  }
  return { base: w, particle: "" };
}

// ---- 불용어 -------------------------------------------------------------------------------------------------------
// Function words, question words and the vocabulary of the questions themselves: never an argument.
export const STOP = new Set(`
뭐 무엇 무슨 어디 어느 언제 누구 누가 얼마 얼마나 어떻게 몇 몇몇 좀 제발 부탁
알려줘 알려 찾아줘 찾아 보여줘 보여 줘 해줘 해 계산해 계산 변환해 변환 기억해 기억 메모해 메모 저장해 저장
삭제해 삭제 지워줘 보내줘 보내 전해줘 전해 말해줘 말해 정리해 정리 비교해 비교 확인해 확인
그리고 그런데 하지만 그러나 또 또한 즉 예를 들어 정도 대한 대해서 대해 위해 통해
이것 그것 저것 여기 거기 저기 이거 그거 저거 우리 저는 제가 나는 내가 너는 당신
오늘 내일 모레 어제 지금 현재 이번 지난 다음 지난주 이번주 다음주 주말
날씨 예보 기온 강수 인구 수도 대통령 면적 설립 창립 대표 언어 통화 높이 정보 내용 결과
나라 국가 도시 지역 사람 회사 단체 것 수 등 및 부분 경우 때 곳
있어 있는 입니다 이다 한다 하는 했다 된다 이며 하고 하지만
`.trim().split(/\s+/));

// ---- 고유명사 사전 -------------------------------------------------------------------------------------------------
// kind: place | person | org. The value is the name to hand to an API when the Korean name itself is not resolvable
// (Open-Meteo's geocoder, for example, only knows some cities by their Latin names).
const RAW = {
  place: {
    "대한민국": "South Korea", "한국": "South Korea", "일본": "Japan", "중국": "China", "미국": "United States",
    "영국": "United Kingdom", "프랑스": "France", "독일": "Germany", "이탈리아": "Italy", "스페인": "Spain",
    "포르투갈": "Portugal", "아이슬란드": "Iceland", "노르웨이": "Norway", "스웨덴": "Sweden", "핀란드": "Finland",
    "덴마크": "Denmark", "네덜란드": "Netherlands", "벨기에": "Belgium", "스위스": "Switzerland", "오스트리아": "Austria",
    "폴란드": "Poland", "체코": "Czechia", "그리스": "Greece", "터키": "Turkey", "튀르키예": "Turkey",
    "러시아": "Russia", "우크라이나": "Ukraine", "캐나다": "Canada", "멕시코": "Mexico", "브라질": "Brazil",
    "아르헨티나": "Argentina", "칠레": "Chile", "페루": "Peru", "호주": "Australia", "오스트레일리아": "Australia",
    "뉴질랜드": "New Zealand", "인도": "India", "베트남": "Vietnam", "태국": "Thailand", "싱가포르": "Singapore",
    "말레이시아": "Malaysia", "인도네시아": "Indonesia", "필리핀": "Philippines", "이집트": "Egypt",
    "남아프리카 공화국": "South Africa", "모로코": "Morocco", "사우디아라비아": "Saudi Arabia", "이스라엘": "Israel",
    "아일랜드": "Ireland", "헝가리": "Hungary", "크로아티아": "Croatia", "쿠바": "Cuba", "콜롬비아": "Colombia",
    "서울": "Seoul", "부산": "Busan", "인천": "Incheon", "대구": "Daegu", "대전": "Daejeon", "광주": "Gwangju",
    "제주": "Jeju", "경주": "Gyeongju", "수원": "Suwon", "춘천": "Chuncheon", "강릉": "Gangneung",
    "도쿄": "Tokyo", "오사카": "Osaka", "교토": "Kyoto", "나고야": "Nagoya", "삿포로": "Sapporo", "후쿠오카": "Fukuoka",
    "베이징": "Beijing", "상하이": "Shanghai", "홍콩": "Hong Kong", "타이베이": "Taipei", "방콕": "Bangkok",
    "하노이": "Hanoi", "마닐라": "Manila", "자카르타": "Jakarta", "뉴델리": "New Delhi", "두바이": "Dubai",
    "이스탄불": "Istanbul", "모스크바": "Moscow", "파리": "Paris", "리옹": "Lyon", "마르세유": "Marseille",
    "런던": "London", "맨체스터": "Manchester", "에든버러": "Edinburgh", "베를린": "Berlin", "뮌헨": "Munich",
    "함부르크": "Hamburg", "프랑크푸르트": "Frankfurt", "암스테르담": "Amsterdam", "브뤼셀": "Brussels",
    "취리히": "Zurich", "제네바": "Geneva", "비엔나": "Vienna", "빈": "Vienna", "프라하": "Prague",
    "부다페스트": "Budapest", "바르샤바": "Warsaw", "로마": "Rome", "밀라노": "Milan", "베네치아": "Venice",
    "피렌체": "Florence", "마드리드": "Madrid", "바르셀로나": "Barcelona", "리스본": "Lisbon", "포르투": "Porto",
    "아테네": "Athens", "오슬로": "Oslo", "스톡홀름": "Stockholm", "헬싱키": "Helsinki", "코펜하겐": "Copenhagen",
    "레이캬비크": "Reykjavik", "더블린": "Dublin", "뉴욕": "New York", "로스앤젤레스": "Los Angeles",
    "샌프란시스코": "San Francisco", "시애틀": "Seattle", "시카고": "Chicago", "보스턴": "Boston",
    "워싱턴": "Washington", "마이애미": "Miami", "라스베이거스": "Las Vegas", "토론토": "Toronto",
    "밴쿠버": "Vancouver", "몬트리올": "Montreal", "멕시코시티": "Mexico City", "상파울루": "Sao Paulo",
    "리우데자네이루": "Rio de Janeiro", "부에노스아이레스": "Buenos Aires", "산티아고": "Santiago",
    "리마": "Lima", "카이로": "Cairo", "케이프타운": "Cape Town", "나이로비": "Nairobi", "시드니": "Sydney",
    "멜버른": "Melbourne", "오클랜드": "Auckland", "에베레스트": "Everest", "후지산": "Mount Fuji",
    "한라산": "Hallasan", "설악산": "Seoraksan", "에펠탑": "Eiffel Tower", "만리장성": "Great Wall of China",
    "자유의 여신상": "Statue of Liberty", "콜로세움": "Colosseum", "타지마할": "Taj Mahal",
    "피사의 사탑": "Leaning Tower of Pisa", "빅벤": "Big Ben", "크렘린": "Kremlin", "경복궁": "Gyeongbokgung",
  },
  person: {
    "마리 퀴리": "Marie Curie", "알베르트 아인슈타인": "Albert Einstein", "아인슈타인": "Albert Einstein",
    "일론 머스크": "Elon Musk", "빌 게이츠": "Bill Gates", "스티브 잡스": "Steve Jobs", "아이작 뉴턴": "Isaac Newton",
    "세종대왕": "Sejong the Great", "이순신": "Yi Sun-sin", "손흥민": "Son Heung-min", "뉴턴": "Isaac Newton",
    "퀴리": "Curie", "머스크": "Musk", "게이츠": "Gates", "잡스": "Jobs", "프리야": "Priya", "사라": "Sarah",
    "민준": "Minjun", "서연": "Seoyeon", "지훈": "Jihoon", "엄마": "Mom", "아빠": "Dad",
  },
  org: {
    "애플": "Apple", "마이크로소프트": "Microsoft", "테슬라": "Tesla", "삼성전자": "Samsung Electronics",
    "구글": "Google", "엔비디아": "NVIDIA", "현대자동차": "Hyundai Motor", "엘지전자": "LG Electronics",
    "네이버": "Naver", "카카오": "Kakao", "토요타": "Toyota", "소니": "Sony", "아마존": "Amazon",
    "스페이스엑스": "SpaceX", "오픈AI": "OpenAI", "방탄소년단": "BTS",
  },
};

export const GAZETTEER = new Map();
for (const [kind, entries] of Object.entries(RAW)) for (const [ko, en] of Object.entries(entries)) GAZETTEER.set(ko, { kind, en });
// 사전에 있는 긴 이름("마리 퀴리")을 먼저 찾기 위해 길이 내림차순
export const GAZ_NAMES = [...GAZETTEER.keys()].sort((a, b) => b.length - a.length);

export const kindOf = (word) => GAZETTEER.get(String(word))?.kind || null;

/** Open-Meteo용 이름 후보: 한국어 이름 → 사전의 영문 이름. 첫 번째로 결과가 나오는 것을 쓴다. */
export function placeQueries(name) {
  const n = String(name || "").trim();
  const en = GAZETTEER.get(n)?.en;
  return [...new Set([n, en].filter(Boolean))];
}

// ---- 날짜 · 기간 · 수량 · 산술 · 문장 -----------------------------------------------------------------------------
const NUM = String.raw`\d[\d,]*(?:\.\d+)?`;
export const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"];

// "2026년 3월 4일", "3월 4일", "2026-03-04", "오늘", "내일", "이번 주말", "다음 주"
export function calendarDates(text) {
  const s = String(text);
  const out = [];
  const re = new RegExp(String.raw`\d{4}\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일|\d{1,2}\s*월\s*\d{1,2}\s*일|\d{4}-\d{2}-\d{2}|오늘|내일|모레|이번\s*주말|다음\s*주말|이번\s*주|다음\s*주|이번\s*달|다음\s*달`, "g");
  for (const m of s.matchAll(re)) out.push(m[0].trim());
  return out;
}

// "3주 후", "10일 전", "2개월 뒤", "3년 전"
export function durations(text) {
  const re = /(\d+)\s*(일|주|개월|달|년)\s*(후|뒤|이후|뒤에|전|앞|이전)?/g;
  return [...String(text).matchAll(re)].map((m) => m[0].trim()).filter((x) => /\d/.test(x));
}

// "5킬로미터", "20도", "3.5kg", "72°F"
const UNITS_KO = ["킬로미터", "킬로그램", "밀리리터", "킬로", "마일", "미터", "피트", "인치", "파운드", "그램", "리터", "갤런", "섭씨", "화씨", "도", "km", "kg", "cm", "ml", "mph", "km/h", "°C", "°F", "°c", "°f"];
const UNIT_RE = [...UNITS_KO].sort((a, b) => b.length - a.length).map((u) => u.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")).join("|");
export function quantities(text) {
  const re = new RegExp(String.raw`-?${NUM}\s*(?:${UNIT_RE})(?:\s*(?:C|F|c|f)\b)?`, "g");
  return [...String(text).matchAll(re)].map((m) => m[0].trim());
}

// "2,450의 18%", "18%", "3 + 4", "3 곱하기 4", "2의 10제곱"
export function arithmetic(text) {
  const s = String(text);
  const out = [];
  for (const m of s.matchAll(new RegExp(String.raw`${NUM}\s*의\s*${NUM}\s*%`, "g"))) out.push(m[0]);
  for (const m of s.matchAll(new RegExp(String.raw`${NUM}\s*의\s*${NUM}\s*제곱`, "g"))) out.push(m[0]);
  for (const m of s.matchAll(new RegExp(String.raw`${NUM}\s*%\s*(?:of\s*)?`, "g"))) out.push(m[0].trim());
  const op = String.raw`(?:[-+*/^×÷]|곱하기|나누기|더하기|빼기|의\s*\d+\s*제곱)`;
  const expr = new RegExp(String.raw`[(]*\s*${NUM}\s*[)]*(?:\s*${op}\s*[(]*\s*${NUM}\s*[)]*)+`, "g");
  for (const m of s.matchAll(expr)) out.push(m[0].trim());
  return [...new Set(out.map((x) => x.replace(/[?.]+$/, "").trim()))];
}

// "…라고 기억해", "메모해: …", "…다고 전해" — 인용문만 남기고 서술 동사·수신자 표현은 뗀다.
export function clauses(text) {
  const s = String(text).trim();
  const out = [];
  const verbs = "(?:기억해|기억해줘|메모해|메모해줘|저장해|저장해줘|적어줘|적어 놓아|남겨|전해|전해줘|말해|말해줘|알려줘|보내|보내줘|메시지)";
  const pats = [
    new RegExp(`(.+?)이?라고\\s*${verbs}`),
    new RegExp(`(.+?다)고\\s*${verbs}`),
    /(?:기억|메모|저장|적어|남겨)(?:해|해줘|해줘요|하자|할래)?\s*[:：]\s*(.+?)$/,
  ];
  for (const p of pats) {
    const m = p.exec(s);
    if (!m || !m[1]) continue;
    const v = m[1]
      .replace(/^\s*[가-힣A-Za-z0-9]+(?:에게|한테|께)\s+/, "")
      .replace(/^(?:그|저|좀)\s+/, "")
      .trim();
    if (!v || v.length < 2) continue;
    if (!out.includes(v)) out.push(v);
  }
  return out;
}

/** 메시지를 받을 사람: "프리야에게", "사라한테", "엄마께" */
export function recipients(text) {
  const out = [];
  for (const tok of String(text).split(/\s+/)) {
    const { base, particle } = splitParticle(tok.replace(/[,.!?]/g, ""));
    if (base && DATIVE.has(particle)) out.push(base);
  }
  return out;
}

/**
 * 한 문장에서 명사 후보를 뽑는다. 각 후보: { span, kind, particle }.
 * kind: place | person | org | proper | noun (사전에 없으면 noun/proper).
 * 조사가 붙은 형태("파리에서")는 조사를 떼고, 처소 조사면 place 후보도 함께 낸다.
 */
export function nounSpans(text, from = "goal") {
  const src = String(text || "");
  const out = [];
  const seen = new Set();
  const push = (span, kind, particle) => {
    const s = String(span).trim();
    if (!s || s.length > 40 || STOP.has(s)) return;
    const key = kind + "|" + s.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ span: s, kind, from, particle: particle || "" });
  };
  const toks = src.split(/\s+/).map((t) => t.replace(/^["'(\[]+|[)"'\].,!?~…:;]+$/g, "")).filter(Boolean);
  // 사전에 있는 여러 단어 이름("마리 퀴리")을 먼저 합쳐서 찾는다
  for (let i = 0; i < toks.length; i++) {
    for (const name of GAZ_NAMES) {
      const words = name.split(" ");
      if (words.length < 2) continue;
      if (toks.slice(i, i + words.length).join(" ").startsWith(name)) {
        const g = GAZETTEER.get(name);
        push(name, g.kind, "");
      }
    }
  }
  for (const tok of toks) {
    const { base, particle } = splitParticle(tok);
    if (!base || STOP.has(base) || /^\d/.test(base)) continue;
    const g = GAZETTEER.get(base);
    if (g) {
      push(base, g.kind, particle);
      if (g.kind === "place") push(base, "place", particle);
    } else if (/^[A-Za-z]/.test(base)) {
      push(base, "proper", particle);
    } else {
      push(base, "noun", particle);
    }
    if (LOCATIVE.has(particle) && !g) push(base, "place", particle);
    if (DATIVE.has(particle)) push(base, "person", particle);
  }
  return out;
}

// ---- 메모 검색용 단어 -----------------------------------------------------------------------------------------------
const NOTE_STOP = new Set("그리고 그런데 하지만 저는 제가 나는 내가 너는 당신 좀 이것 그것 저것 오늘 내일 어제 에서 에게 으로 하고 있는 입니다 이다 한다 메모 기억 저장 삭제 알려줘 해줘".split(/\s+/));
export function koWords(s) {
  const out = [];
  for (const tok of String(s || "").toLowerCase().split(/[\s,.!?"'()[\]{}:;]+/)) {
    if (!tok) continue;
    const { base } = splitParticle(tok);
    const w = (base || tok).trim();
    if (w.length < 1 || NOTE_STOP.has(w) || /^\d+$/.test(w)) continue;
    out.push(w);
  }
  return [...new Set(out)];
}
