// ─────────────────────────────────────────────────────────────
// 사랑의 주사위 — 아이폰 잠금화면 / 홈화면 위젯
// 무료 앱 「Scriptable」 에 붙여 넣어 쓰는 스크립트입니다.
//
// 쓰는 법
//  1) App Store 에서 Scriptable 을 설치합니다. (무료)
//  2) 아래 APP_URL 과 UID 두 줄을 내 것으로 바꿉니다.
//     · APP_URL — Apps Script 에 배포한 웹앱 주소 (…/exec 로 끝납니다)
//     · UID     — 앱의 [위젯] 탭에 적힌 내 기기 번호
//     ※ 앱의 [위젯] 탭에서 [스크립트 복사] 를 누르면 두 줄이 이미 채워진
//        완성본이 복사되니 그것을 붙여 넣는 편이 쉽습니다.
//  3) Scriptable 에서 ＋ → 붙여넣기 → 이름을 「사랑의 주사위」 로 저장합니다.
//  4) 잠금화면을 꾹 눌러 → 사용자화 → 잠금화면 → 위젯 추가 → Scriptable
//  5) 위젯을 눌러 Script = 사랑의 주사위 로 맞춥니다.
//
// 안드로이드에서는 이 파일 대신 앱의 [위젯] 탭 ①번 「배경화면 만들기」 나
// KWGT · Tasker 용 JSON 주소를 쓰세요.
// ─────────────────────────────────────────────────────────────

const APP_URL = "https://script.google.com/macros/s/여기에_내_배포_주소/exec";
const UID = "여기에_내_기기_번호";

let data;
try {
  const req = new Request(APP_URL + "?api=my&u=" + UID);
  req.timeoutInterval = 15;
  data = await req.loadJSON();
} catch (e) {
  // 인터넷이 안 될 때 보여 줄 기본 문구
  data = { text: "먼저 사랑하자", short: "먼저 사랑하자", mine: false };
}

const lock = (config.runsInAccessoryWidget === true);
const w = new ListWidget();
w.url = APP_URL;

if (lock) {
  // 잠금화면 위젯 — 색을 쓸 수 없어 글씨만 보인다
  const t = w.addText(data.short || data.text || "");
  t.font = Font.semiboldSystemFont(13);
  t.minimumScaleFactor = 0.55;
} else {
  // 홈화면 위젯 — 보라·분홍 그러데이션
  const g = new LinearGradient();
  g.colors = [new Color("#7c3aed"), new Color("#db2777")];
  g.locations = [0, 1];
  w.backgroundGradient = g;
  w.setPadding(16, 16, 16, 16);

  const h = w.addText("🎲 오늘의 사랑의 주사위");
  h.font = Font.systemFont(11);
  h.textColor = Color.white();
  h.textOpacity = 0.8;

  w.addSpacer(6);

  const t = w.addText(data.text || "");
  t.font = Font.boldSystemFont(20);
  t.textColor = Color.white();
  t.minimumScaleFactor = 0.5;

  w.addSpacer(4);

  const s = w.addText(data.mine ? "내가 던진 오늘의 면" : "오늘 함께 보는 면");
  s.font = Font.systemFont(10);
  s.textColor = Color.white();
  s.textOpacity = 0.75;
}

if (config.runsInWidget) Script.setWidget(w);
else w.presentMedium();
Script.complete();
