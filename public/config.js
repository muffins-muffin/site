// 프론트엔드가 API를 호출할 백엔드 주소입니다.
//
// - 지금처럼 server.js가 프론트(public/)와 API를 같은 서버에서 함께 서빙할 때는
//   빈 문자열로 둡니다 (같은 origin이라 상대경로 /api/... 로 바로 호출됨).
// - Cloudflare Pages 같은 곳에 public/만 따로 올리고, API는 Railway 등 별도
//   서버에서 돌릴 때는 아래 값을 그 서버 주소로 바꿔주세요.
//   예: window.API_BASE = "https://synap365-production.up.railway.app";
//
// 백엔드(server.js)의 ALLOWED_ORIGIN 환경변수에도 여기 프론트 주소를 등록해야
// CORS가 열립니다.
window.API_BASE = "";
