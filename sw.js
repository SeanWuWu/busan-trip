/* 釜山行程手冊 Service Worker
   ------------------------------------------------------------
   之前這段是用 Blob URL 註冊的，瀏覽器一律拒絕
   （TypeError: The URL protocol of the script ('blob:…') is not supported），
   所以離線完全沒有生效。Service Worker 的腳本必須是同源的真實檔案，
   因此獨立成這一支。

   快取策略分兩種：
   - 頁面本身：先走網路（拿得到就順手更新快取），失敗才回快取。
     這樣有網路時永遠是最新版，沒網路時至少開得起來。
   - 地圖圖磚：先看快取，沒有才走網路並存起來。
     圖磚不會變，而且是離線時最有感的一塊——看過的區域還能繼續看。

   天氣、匯率、Firebase 一律不快取：這些資料過期就沒有意義，
   讓它自然失敗，由 App 顯示既有的資料或提示。
*/
const C = "busan-guide-v2";
const TILES = "busan-tiles-v1";
const TILE_MAX = 400;   /* 圖磚上限，避免無限長大吃掉手機空間 */

self.addEventListener("install", e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(C).then(c => c.addAll(["./", "./index.html"])).catch(() => {})
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== C && k !== TILES).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* 圖磚快取滿了就從最舊的開始丟 */
function trimTiles() {
  caches.open(TILES).then(c => c.keys().then(ks => {
    if (ks.length <= TILE_MAX) return;
    return Promise.all(ks.slice(0, ks.length - TILE_MAX).map(k => c.delete(k)));
  })).catch(() => {});
}

self.addEventListener("fetch", e => {
  const r = e.request;
  if (r.method !== "GET") return;

  let url;
  try { url = new URL(r.url); } catch (err) { return; }

  /* 地圖圖磚：cache first，離線時看過的區域還在 */
  if (/(^|\.)tile\.openstreetmap\.org$/.test(url.hostname)) {
    e.respondWith(
      caches.open(TILES).then(c => c.match(r).then(hit => {
        if (hit) return hit;
        return fetch(r).then(res => {
          if (res && (res.ok || res.type === "opaque")) {
            c.put(r, res.clone()).then(trimTiles).catch(() => {});
          }
          return res;
        });
      })).catch(() => fetch(r))
    );
    return;
  }

  /* 其他跨網域（天氣、匯率、Firebase、字型）一律走網路，不攔截 */
  if (url.origin !== location.origin) return;

  /* 自己這頁：network first，離線回快取 */
  if (r.mode === "navigate" || /\.(html|js|css)$/.test(url.pathname) || url.pathname.endsWith("/")) {
    e.respondWith(
      fetch(r).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(C).then(c => c.put(r, copy)).catch(() => {});
        }
        return res;
      }).catch(() =>
        caches.match(r).then(m => m || caches.match("./index.html")).then(m => m || Response.error())
      )
    );
  }
});
