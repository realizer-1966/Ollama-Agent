# layaAgent 한국어판

**브라우저 탭 안에서만 도는 AI 에이전트.** 322M 다국어 타입화 결정 인코더(Laya, *System 1*)가 일상적인 결정을 내리고, Laya가 확신하지 못할 때만 브라우저 속 작은 LLM(WebLLM, *System 2*)이 나서며, 무언가를 바꾸는 단계(메모 저장·삭제, 메시지 전송)는 항상 사용자의 승인을 받습니다. 모든 단계는 클릭해서 들여다볼 수 있는 그래프로 그려집니다.

서버도, API 키도 없습니다. 도구는 브라우저에서 한국어 위키백과·Wikidata·Open-Meteo를 직접 호출하고, 그 밖의 정보는 페이지를 떠나지 않으며 메시지는 실제로 전송되지 않습니다.

- 원본: [vishalmysore/layaAgent](https://github.com/vishalmysore/layaAgent) (Apache-2.0)
- 한국어판: https://realizer-1966.github.io/layaAgent-ko/
- 계열 프로젝트: layaForWeb(모델) → layaForWorkflows(그래프로 결정) → layaAsRagJudge(판정으로 결정) → **layaAgent(에이전트로 결정)**

## 한국어판에서 바뀐 것

| 영역 | 원본 (영어) | 한국어판 |
|---|---|---|
| System 1 모델 | `VishalMysore/layaForWebTrained` (ModernBERT, 421M, 영어) | `convaiinnovations/laya-multilingual` (mmBERT, 322M, 100+ 언어) — GitHub Pages 미러에서 스트리밍 |
| 특수 토큰 | `[CLS]`/`[SEP]`/`[MASK]`/`[PAD]` 하드코딩 | 토크나이저에서 읽어 `<bos>`/`<eos>`/`<mask>`/`<pad>`도 지원 (`laya-core.js`) |
| 질문·선택지 | 영어 지시문 + 영어 라벨 | 한국어 지시문 + 한국어 라벨 (도구 설명, 슬롯 질문, 게이트 이유, 답변 템플릿 전부) |
| 후보 추출 | compromise.js (영어 전용) | `web/ko.js` — 조사 분리, 고유명사 사전, 날짜·수량·산술·인용문 정규식. 라틴 문자 본문은 여전히 compromise 사용 |
| 백과사전 | en.wikipedia.org | ko.wikipedia.org |
| Wikidata | `language=en` 검색·라벨 | `language=ko` 검색, 한국어 라벨 우선(없으면 영어) |
| 날씨 | 영어 지명 | 한국어 지명 지오코딩 + 사전의 영문 이름 폴백, 한국어 예보 문장·WMO 코드 |
| 날짜·단위·계산 | 영어 표현 | `2026년 3월 4일`, `3주 후`, `5마일`, `20도`, `2,450의 18%`, `곱하기/나누기/더하기/빼기` |
| 과제 세트 | 107개 영어 과제(합성) | **68개 한국어 과제(개발 23 / 테스트 45, 147단계)** — 같은 11개 분류, 실제 도구로 출력 녹음 |
| 화면 | 영어 UI | 한국어 UI (에이전트·평가 페이지, 다이얼로그, 그래프 범례) |

## 구조 (한 단계)

```
목표 ──► 상태 { goal, steps_done, last_observation }              (필드마다 고정 토큰 예산)
     ──► System 1 결정 패스     next_action(12개 도구 중 선택) · goal_met(예/아니오)
                               risky(목표 단위로 한 번만 질문)
     ──► 후보 추출기            ko.js 규칙 + 정규식: 장소·사람·기관·명사·날짜·기간·수량·산술·저장/전송 문구
     ──► System 1 인자 패스     슬롯마다 선택 질문: 후보 표현 + NONE, 또는 고정 목록
     ──► 게이트                 AUTO: System 1의 단계를 그대로 실행
                               HOLD: System 2가 결정(JSON 단계), System 2가 없으면 사용자가 결정
     ──► 가드                   무언가를 바꾸는 도구는 누가 골랐든 먼저 승인 요청
     ──► 도구 ──► 관찰 ──► 다음 단계      FINISH는 도구 결과로 답을 조립(템플릿)
```

**Laya는 절대 쓰지 않습니다.** 선택지는 다른 무언가(도구 등록부, 추출기, 고정 목록)가 만들고, Laya는 하나를 고르고 확률을 보고합니다. 인자는 "고르기로 하는 추출"입니다: Laya는 "일본"이라고 쓸 수 없지만, 관찰 결과에서 찾은 표현 중에서 "일본"을 고를 수는 있습니다. 맞는 값이 본문에 없으면 NONE을 골라야 하고, 그러면 그 단계는 System 2(또는 사용자)에게 넘어갑니다.

### 게이트

다음 중 하나라도 참이면 단계가 **보류**됩니다(모두 슬라이더로 조절, 슬라이더를 움직이면 저장된 결정을 모델 호출 없이 다시 라우팅).

| 규칙 | 이유 |
|---|---|
| p(고른 도구) < τ_action (0.65) | 어느 도구인지 확신하지 못함 |
| 어떤 인자든 p < τ_arg (0.65), 또는 인자가 NONE | 확신이 없거나, 값이 본문에 없음 |
| p(목표 달성) < τ_stop (0.7)인 FINISH | 다단계 목표에서 멈춤 신호가 약함 |
| 직전 단계와 같은 도구 | Laya는 마지막 도구를 반복하는 경향이 있음(동일 호출은 별도로 차단) |
| 목표가 위험하게 읽히는데(p ≥ 0.2) 고른 도구가 읽기 전용 | fail-closed: "메모 지워줘"가 조용히 검색이 되면 안 됨 |
| 단계 예산 도달 | 무한 루프 방지 |

### 가드

`note_save`, `note_delete`, `send_message`는 부작용 도구로 선언되어 있어, Laya·System 2·사용자 누가 골랐든 항상 확인을 요청합니다.

## 도구

| 도구 | 인자 (고르는 방법) | 백엔드 |
|---|---|---|
| `wiki_lookup` | topic (후보 표현) | 한국어 위키백과 제목 검색 + 문서 요약 |
| `wikidata_fact` | entity (후보 표현), property (11개 고정 목록: 인구·수도·속한 나라·정부 수반·CEO·설립 연도·설립자·공용어·통화·면적·높이) | Wikidata 개체 검색(ko) + REST statements |
| `weather` | place (후보 표현), when (오늘/내일/이번 주말/앞으로 며칠) | Open-Meteo 지오코딩 + 예보 |
| `calculator` | expression (산술 표현) | 로컬 재귀 하강 파서, `eval` 없음 |
| `unit_convert` | quantity (후보 표현), to_unit (고정 목록) | 로컬 환산표 |
| `date_math` | date (표현 또는 오늘/내일), offset (기간 표현) | 로컬 |
| `note_save` ⚠ | text ("…라고 기억해"의 인용문) | IndexedDB |
| `note_search` | query (후보 표현) | 저장된 메모에 대한 어휘 검색(조사 제거) |
| `note_delete` ⚠ | query (후보 표현 또는 "모든 메모") | IndexedDB |
| `send_message` ⚠ | to (사람), text (인용문) | **시뮬레이션**: 실제로 보내지 않음 |
| `ask_user` | question (System 2가 쓰거나 템플릿) | 다이얼로그 |
| `FINISH` | – | 도구 결과로 답 조립 |

⚠ = 부작용: 항상 사용자 확인.

## 한국어 과제 세트

`web/tasks.json`(생성물)과 `scripts/tasks-ko.mjs`(정답 트레이스 정의), `scripts/build_tasks_ko.mjs`(도구 실행·녹음·검사).

- 68개 합성 목표: 개발 23 / 테스트 45, 147개 정답 단계, 11개 분류
  (날씨, 백과사전, Wikidata 사실, 산술, 단위 변환, 날짜 계산, 다단계, 메모리, 다시 써야 함, 모호함, 무언가를 바꿈)
- 도구 출력은 세트를 만들 때 **실제 도구로 한 번 실행해 녹음**했습니다. 그래서 나중에 위키백과·Wikidata·날씨가 바뀌어도 점수가 흔들리지 않습니다.
- 빌드 스크립트는 두 가지를 검사합니다: (1) 모든 정답 단계가 실제 도구로 성공하는가, (2) 정답 인자가 후보 추출기의 선택지에 실제로 나오는가(추출기 재현율). 현재 0건 실패.

```bash
node scripts/build_tasks_ko.mjs   # 네트워크 필요, 약 2분
```

## 로컬 실행

```bash
npm ci
npm test
node scripts/prepare_site.mjs
python serve.py            # http://localhost:8000 (COOP/COEP 헤더)
```

`serve.py`가 COOP/COEP 헤더를 보내 ONNX Runtime이 WASM 스레드를 쓸 수 있게 합니다. GitHub Pages에서는 `coi.js`가 서비스 워커로 같은 헤더를 붙입니다. `?threads=N`으로 WASM 스레드 수를 바꿀 수 있습니다.

## 평가 페이지

`eval.html`은 정답 단계마다 정답 히스토리를 문맥으로 주고 Laya(그리고 선택적으로 System 2)의 답을 기록합니다. 게이트 슬라이더를 움직이면 저장된 답에서 즉시 다시 채점합니다. "개발 분할에서 조정"은 자동 단계 오류 한도 아래에서 System 1 비중이 가장 큰 임계값을 고르고, 결과는 테스트 분할에서 읽습니다.

**녹음(`recorded.json`)은 모델을 불러온 브라우저에서만 만들 수 있습니다.** 이 저장소에는 아직 한국어판 녹음이 들어 있지 않습니다(아래 "측정 상태" 참고). 녹음이 없으면 평가 페이지는 비어 있고, 에이전트 페이지의 예시 목표는 재생 대신 "System 1을 불러오세요"라고 안내합니다.

녹음 절차(원본 README와 동일, Playwright + WebGPU 크롬):

```bash
python serve.py 5193
python scripts/drive.py eval --variant q8e8 --backend wasm --out .cache/eval.json
python scripts/drive.py presets --variant q8e8 --backend wasm --out .cache/presets.json
python scripts/drive.py merge --eval .cache/eval.json --presets .cache/presets.json
```

## 측정 상태 (정직한 기록)

- **영어 원본의 수치**(테스트 71과제·158단계, 노트북 Intel Iris Xe + WebGPU): Laya 단독 과제 성공 32%, 게이트 τ=0.65에서 자동 단계 32%·오류 9.8%, Laya+사용자 94%, Laya+System 2 21%, System 2 단독 10%. 이 수치는 **원본 저장소의 영어 체크포인트·영어 과제**에서 나온 것입니다.
- **한국어판은 아직 모델 수치를 재지 못했습니다.** 준비는 끝났지만(다국어 체크포인트 연결, 68과제 147단계, 추출기 재현율 100%), 이 기기의 도구 브라우저가 세션 중 멈춰 브라우저 내 추론 녹음을 마치지 못했습니다. Node에서 onnxruntime-web을 돌리는 우회로도 시도했지만 iSH의 V8 WebAssembly가 `Illegal instruction`으로 죽습니다.
- 따라서 이 저장소의 한국어 README에는 **한국어 성능 표가 없습니다.** 평가 페이지에서 직접 측정해 주세요(모델 338MB는 첫 방문에 내려받고 이후 캐시됩니다). 추측값을 표에 넣지 않는 것이 이 프로젝트의 규칙입니다.

## 알려진 한계

- 한국어 후보 추출은 **모델이 아니라 규칙**입니다(조사 분리 + 고유명사 사전 + 정규식). 과제 세트의 문법에 맞춰 설계·검증했고, 사전에 없는 고유명사나 복잡한 대용어는 놓칩니다. 영어 본문(라틴 문자 비중 60% 초과)은 compromise.js로 처리합니다.
- 지명은 한국어 지오코딩이 실패하면 사전(약 130개)의 영문 이름으로 재시도합니다. 사전에 없는 지명은 날씨 도구가 실패할 수 있습니다.
- Wikidata는 짧은 시간에 몰아치면 HTTP 429를 돌려줍니다. `web/http.js`가 User-Agent를 붙이고 지수 백오프로 재시도합니다.
- 한국어 위키백과 요약은 문서마다 문장 구조가 달라, 다단계 과제의 다음 인자가 관찰 결과에 항상 명확히 나오지는 않습니다(과제 세트는 실제 관찰로 검증함).
- System 2(WebLLM)는 WebGPU가 필요합니다. iPhone 사파리에서는 동작하지만, WebGPU가 없으면 보류 단계는 사용자에게 갑니다.
- 원본의 설계 문서 `layaAgent.md`와 `spec.md`, `docs/article.md`는 영어 원문 그대로 둡니다(번역 요약은 `docs/article-ko.md`).

## 라이선스

Apache-2.0. 모델·데이터 출처와 서드파티 코드는 `NOTICE.md`를 보세요.
