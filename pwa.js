/* 2027 LMS PWA 부트스트랩: hoistory/pwa.js를 이 레포에 맞게 옮겼다.
   hoistory의 서비스워커(/hoistory/sw.js)는 스코프가 /hoistory/라 여기를 덮지 못하므로
   이 레포의 sw.js를 따로 등록한다. 경로는 상대경로라 /lms2027/ 아래 어디서든 맞다. */
(function () {
  var head = document.head || document.getElementsByTagName('head')[0];

  function add(sel, el) { if (!document.querySelector(sel)) head.appendChild(el); }
  function mkLink(rel, href) { var l = document.createElement('link'); l.rel = rel; l.href = href; return l; }
  function mkMeta(name, content) { var m = document.createElement('meta'); m.name = name; m.content = content; return m; }

  add('meta[name="apple-mobile-web-app-capable"]',          mkMeta('apple-mobile-web-app-capable', 'yes'));
  add('meta[name="apple-mobile-web-app-status-bar-style"]', mkMeta('apple-mobile-web-app-status-bar-style', 'default'));
  add('link[rel="apple-touch-icon"]',                       mkLink('apple-touch-icon', 'main.png'));

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    });
  }
})();
