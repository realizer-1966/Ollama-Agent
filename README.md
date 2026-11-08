# Ollama Agent

**브라우저에서 도는 AI 에이전트의 Ollama 원격 모델 버전.** [layaAgent 한국어판](https://github.com/realizer-1966/layaAgent-ko)(원본: [vishalmysore/layaAgent](https://github.com/vishalmysore/layaAgent), Apache-2.0)의 UI와 에이전트 로직을 그대로 두고, 모델 계층만 Ollama 서버의 원격 모델로 교체한 프로젝트입니다.

## 모델 구성

| 역할 | 모델 | Ollama 엔드포인트 |
|---|---|---|
| System 1 · 타입화된 결정 | `clef:cloud` (결정 전용) | `POST /v1/systemone` |
| System 2 · 생성 LLM | `glm-5.3-flash:cloud` | `POST /v1/chat/completions` (OpenAI 호환) |

- 서버: `http://localhost:11434` (고정·하드코딩, 바꾸려면 `js` 파일 안의 주소 상수를 수정)
- **선택도·버튼도 없음**: 페이지를 열면 곧바로 두 모델에 자동으로 연결·워밍업하고 준비 배지가 뜹니다.
- CLEF는 `decision` 캘퍼빌리티 전용이라 `/api/chat`이 아니라 Ollama의 `/v1/systemone` 결정 API를 씁니다. 확률·confidence를 반환하므로 로컬 Laya ONNX와 같은 게이트 로직이 그대로 동작합니다(`noul` 방향 1=참, 로컬과 동일 확인).

## 동작 방식 (원본 설계 그대로)

```
목표 ─► 상태(목표·완료 단계·마지막 관찰, 토큰 예산)
     ─► System 1 결정 패스: next_action(12개 도구 선택) · goal_met · risky
     ─► 후보 추출기(모델 아님): ko.js 규칙(조사 분리·사전·날짜·수량·산술) + compromise
     ─► System 1 인자 패스: 슬롯마다 선택 질문(후보 표현 + NONE)
     ─► 게이트: AUTO(그대로 실행) / HOLD(System 2가 JSON 단계 결정, 없으면 사용자)
     ─► 가드: 메모 저장·삭제, 메시지 전송은 누가 골랐든 항상 사용자 승인
     ─► 도구 ─► 관찰 ─► 다음 단계 (FINISH는 도구 결과로 답 조립, 옵션으로 System 2 재작성)
```

- CLEF는 절대 글을 쓰지 않습니다: 선택지는 도구 등록부·추출기·고정 목록이 만들고, Laya는 고르기만 합니다.
- 도구는 브라우저에서 한국어 위키백과·Wikidata·Open-Meteo를 직접 호출하고, 계산·단위·날짜는 로컬 파서, 메모는 IndexedDB, 메시지 전송은 시뮬레이션입니다.
- 추적 그래프(Cytoscape), 게이트 슬라이더 재라우팅, 가정 실행, 세션 그래프, JSON/Turtle 내보내기, 평가 페이지(eval.html)는 원본 그대로입니다.

## 이 버전에서 바뀐 것

| 영역 | 원본(layaAgent-ko) | 이 버전 |
|---|---|---|
| System 1 | mmBERT 322M을 브라우저 ONNX로 로딩(가중치 다운로드·캐시·WASM/WebGPU) | 원격 `clef:cloud` — 내려받기 없음, 호출당 ~0.5초 |
| System 2 | WebLLM(브라우저 내 WebGPU 워커) | 원격 `glm-5.3-flash:cloud` — WebGPU 불필요 |
| 모델 카드 | 빌드/백엔드 선택, 매니페스트 다운로드 진행률 | 입력란·드롭다운·버튼 전부 제거, 자동 연결만 |
| 웹앱 | 정적 사이트(GitHub Pages) | **PWA**(manifest·서비스 워커·아이콘) — `serve.py` 로컬 서빙, 홈 화면 설치 가능 |

## 실행

```bash
python serve.py          # http://localhost:8000 (COOP/COEP 헤더)
python serve.py 8091     # 포트 지정
```

- Ollama가 `localhost:11434`에서 실행 중이어야 하고, 두 모델(`clef:cloud`, `glm-5.3-flash:cloud`)이 pull된 상태여야 합니다.
- 같은 기기의 브라우저라면 CORS 설정 없이 동작합니다(Ollama는 localhost 오리진을 기본 허용). 다른 기기의 브라우저에서 접속하려면 Ollama 쪽에 `OLLAMA_ORIGINS="*"` 설정이 필요합니다.
- 브라우저에서 "앱 설치"를 누르면 홈 화면 아이콘이 생깁니다(PWA).

## 원본 대비 유지한 것 / 라이선스

- 원본의 에이전트 루프(agent.js), 게이트(gate.js), 후보 추출기(ko.js·candidates.js), 도구(tools/), 추적·평가·메트릭스, `tasks.json`(68개 한국어 과제)은 한 글자도 바꾸지 않았습니다. 바꾼 파일은 `model.js`(System 1 원격 어댑터), `system2.js`(엔진만 Ollama로), `common.js`(모델 카드 자동 로딩), 두 `*.html` 모델 카드와 제목, `serve.py`, PWA 자산입니다.
- 라이선스: Apache-2.0 (원본과 동일). 자세한 출처·모델 고지는 `NOTICE.md`를 보세요.
- 원본 README(`README-ko.md`)와 설계 글(`article-ko.md`)도 이 저장소에 그대로 남아 있습니다.
