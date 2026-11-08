// PWA 서비스 워커: 앱 셸(페이지·CSS·JS·아이콘·벤더 라이브러리·과제 데이터)을 캐시해 오프라인에서도
// 페이지가 열립니다. 모델 결과와 도구 데이터(위키백과·Wikidata·Open-Meteo, Ollama API)는 네트워크만
// 사용하는 "네트워크 우선" 전략을 쓴다 — 오프라인이면 그 부분만 안내를 보여준다.
const VERSION = "layaagent-ko-v2";
const APP_SHELL = [
  "./", "./index.html", "./eval.html", "./styles.css", "./manifest.json",
  "./main.js", "./agent.js", "gate.js", "candidates.js", "common.js", "eval.js", "evalrun.js",
  "graphs.js", "gold.js", "http.js", "ko.js", "main.js", "metrics.js", "model.js",
  "notesdb.js", "questions.js", "state.js", "system2.js", "trace.js",
  "./tools/index.js", "./tools/calculator.js", "./tools/datemath.js", "./tools/misc.js",
  "./tools/notes.js", "./tools/units.js", "./tools/weather.js", "./tools/wiki.js", "./tools/wikidata.js",
  "./vendor/compromise.mjs", "./vendor/compromise-dates.mjs", "./vendor/cytoscape.min.js", "./vendor/cytoscape-dagre.min.js",
  "./tasks.json", "./NOTICE.txt",
  "./icons/icon-192.png", "./icons/icon-maskable-192.png", "./icons/icon-384.png",
  "./icons/icon-maskable-384.png", "./icons/icon-512.png", "./icons/icon-maskable-512.png",
].map((p) => p.replace(/^\.\//, "").replace("manifest.json", "manifest.json")).map(p => new Request(new URL(p, self.location.href)));

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // 누락 파일이 있어도 설치가 막히지 않게 하나씩 시도
    await Promise.allSettled(APP_SHELL.map(async (req) => { try { await cache.add(req); } catch { /* fine */ } }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== VERSION) await caches.delete(key);
    await self.clients.claim();
    // 새 버전이 잡히면 열려 있던 페이지를 한 번 새로 고쳐 구버전 UI가 남지 않게 한다.
    const cs = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of cs) { try { await c.navigate(c.url); } catch { /* 사용자가 포커스를 가진 탭은 브라우저가 막을 수 있다 */ } }
  })());
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // 앱 셸: 네트워크 우선(업데이트가 즉시 보임), 네트워크 실패 시에만 캐시로 폴백(오프라인 대비).
  if (url.origin === location.origin) {
    e.respondWith((async () => {
      try {
        const res = await fetch(e.request);
        if (res.ok && e.request.method === "GET") {
          const cache = await caches.open(VERSION);
          try { cache.put(e.request, res.clone()); } catch { /* fine */ }
        }
        return res;
      } catch (err) {
        const cached = await caches.match(e.request, { ignoreSearch: e.request.mode === "navigate" });
        if (cached) return cached;
        if (e.request.mode === "navigate") return (await caches.match("./index.html")) || Response.error();
        return Response.error();
      }
    })());
    return;
  }
  // 외부(모델 API·위키백과 등): 네트워크만, 실패 시 상태 포함 응답으로 에이전트가 오류를 기록하게 한다
  e.respondWith((async () => {
    try { return await fetch(e.request); }
    catch (err) {
      return new Response(JSON.stringify({ error: "오프라인: " + (url.origin + url.pathname) }), {
        status: 503, headers: { "Content-Type": "application/json" },
      });
    }
  })());
});
