/**
 * 사랑의 주사위 — 서버 (구글 Apps Script)
 *
 * 하는 일
 *  1) 화면(index.html)을 웹앱으로 내보낸다.
 *  2) 실천 경험담을 스프레드시트에 쌓고, 하트(공감)를 기록한다.
 *  3) 폰 위젯이 읽어 갈 수 있게 JSON 주소(?api=...)를 열어 준다.
 *
 * 개인정보는 받지 않는다. 사람 구분은 기기에서 만든 무작위 uid 하나뿐이고,
 * 표시 이름은 본인이 직접 쓸 때만 저장된다(비우면 '익명').
 */

/* ────────────────────────────── 설정값 ────────────────────────────── */

/** 경험담이 한 줄씩 쌓이는 시트 */
var SHEET_STORY = '경험담';

/** 사람마다 오늘 나온 주사위 면을 담아 두는 시트 (uid 하나 = 한 줄, 계속 덮어쓴다) */
var SHEET_ROLL = '오늘의 주사위';

/** 날짜별로 어느 면이 몇 번 나왔는지 세어 두는 시트 (하루 = 한 줄) */
var SHEET_STAT = '면별 집계';

/**
 * 기록을 남길 스프레드시트 번호.
 * 비워 두면 ─ 시트에 붙여 만든 스크립트면 그 시트에, 따로 만든 스크립트면
 * 「사랑의 주사위 기록」 시트를 처음 한 번 자동으로 만들어 쓴다.
 */
var SPREADSHEET_ID = '';

/** 경험담 한 편의 최대 글자 수 */
var MAX_LEN = 500;

/** 표시 이름의 최대 글자 수 */
var NAME_MAX = 12;

/** 목록을 한 번에 몇 개씩 보낼지 */
var PAGE = 20;

/** 같은 기기에서 글을 다시 올리기까지 기다려야 하는 시간(초) — 도배 막기 */
var COOLDOWN_SEC = 30;

/** 한 기기가 하루에 올릴 수 있는 글 수 */
var DAILY_MAX = 10;

/** 신고가 이만큼 쌓이면 자동으로 숨긴다 */
var REPORT_HIDE = 3;

/** 주사위 6면 — 출처: 포콜라레 4젠 (gen4.co.kr) 원문 그대로 */
var FACES = [
  '모든 이를 사랑하자',
  '먼저 사랑하자',
  '지금 내 곁에 있는 사람을 사랑하자',
  '잘못을 용서해 주자',
  '다른 사람의 말에 귀를 기울이자',
  '서로 사랑하자'
];

/** 짧게 줄인 문구 — 위젯처럼 좁은 곳에서 쓴다 */
var FACES_SHORT = [
  '모든 이를 사랑하자',
  '먼저 사랑하자',
  '곁에 있는 이를 사랑하자',
  '잘못을 용서해 주자',
  '귀를 기울이자',
  '서로 사랑하자'
];

/* 경험담 시트의 열 번호 (A=1) */
var C_ID = 1;      /* 번호 */
var C_TIME = 2;    /* 올린 시각 */
var C_NAME = 3;    /* 표시 이름 */
var C_ANON = 4;    /* 익명 여부 */
var C_FACE = 5;    /* 실천한 주사위 면 (1~6, 0이면 안 고름) */
var C_TEXT = 6;    /* 내용 */
var C_HEART = 7;   /* 하트 수 */
var C_STATE = 8;   /* 보임 / 숨김 */
var C_PW = 9;      /* 지울 때 쓰는 비밀번호 (뭉갠 값만) */
var C_UID = 10;    /* 올린 기기 */
var C_HUID = 11;   /* 하트를 누른 기기 목록 */
var C_REPORT = 12; /* 신고 수 */
var C_RUID = 13;   /* 신고한 기기 목록 — 같은 사람이 여러 번 신고하지 못하게 남겨 둔다 */
var STORY_COLS = 13;

/* ────────────────────────────── 화면 내보내기 ────────────────────────────── */

/**
 * 주소로 들어왔을 때.
 *  - 그냥 들어오면 → 앱 화면
 *  - ?api=... 가 붙어 있으면 → 위젯이 읽을 JSON
 */
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.api) return apiOut_(p, handleApi_(p));

  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('사랑의 주사위')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/* ────────────────────────────── 위젯용 JSON 주소 ────────────────────────────── */

/**
 * 위젯이 부르는 주소를 처리한다.
 *   ?api=my&u=<내 uid>  → 내가 오늘 굴려서 나온 면
 *   ?api=today          → 오늘 모두가 함께 보는 면 (날짜로 정해진다)
 *   ?api=stat           → 오늘 참여자 수와 면별 분포
 */
function handleApi_(p) {
  var kind = String(p.api || '');
  var day = today_();

  if (kind === 'today') {
    var f = commonFace_(day);
    return { ok: true, date: day, face: f + 1, text: FACES[f], short: FACES_SHORT[f], mine: false };
  }

  if (kind === 'my') {
    var uid = String(p.u || '').slice(0, 40);
    var got = readRoll_(uid, day);
    if (got >= 0) {
      return { ok: true, date: day, face: got + 1, text: FACES[got], short: FACES_SHORT[got], mine: true };
    }
    /* 아직 안 굴렸으면 오늘의 공통 면을 대신 보여 준다 */
    var c = commonFace_(day);
    return { ok: true, date: day, face: c + 1, text: FACES[c], short: FACES_SHORT[c], mine: false };
  }

  if (kind === 'stat') {
    var s = getStat();
    s.ok = true;
    return s;
  }

  return { ok: false, error: '알 수 없는 요청입니다.' };
}

/** JSON 으로 내보낸다. callback= 을 주면 JSONP 로 감싼다(위젯 도구용). */
function apiOut_(p, obj) {
  var body = JSON.stringify(obj);
  var cb = String(p.callback || '').replace(/[^A-Za-z0-9_$.]/g, '');
  if (cb) {
    return ContentService.createTextOutput(cb + '(' + body + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(body)
    .setMimeType(ContentService.MimeType.JSON);
}

/* ────────────────────────────── 주사위 ────────────────────────────── */

/**
 * 오늘 굴린 결과를 저장한다. 위젯이 같은 문구를 보여 주려면 서버가 알아야 한다.
 * 같은 날 다시 굴리면 그 사람의 기록만 새 면으로 바뀐다(참여자 수는 그대로).
 */
function saveMyRoll(uid, face) {
  uid = String(uid || '').slice(0, 40);
  face = Math.max(0, Math.min(5, Number(face) || 0));
  if (!uid) return { ok: false, error: '기기 번호가 없습니다.' };

  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (err) { return { ok: false, error: '잠시 뒤 다시 시도해 주세요.' }; }

  try {
    var book = getBook_();
    var sh = ensureRollSheet_(book);
    var day = today_();
    var row = findRowIn_(sh, 1, uid);

    var prevFace = -1;
    var isNew = true;
    if (row) {
      var old = sh.getRange(row, 1, 1, 4).getValues()[0];
      if (String(old[1]) === day) { prevFace = Number(old[2]) - 1; isNew = false; }
      sh.getRange(row, 2, 1, 3).setValues([[day, face + 1, (Number(old[3]) || 0) + 1]]);
    } else {
      sh.appendRow([uid, day, face + 1, 1]);
    }

    bumpStat_(book, day, face, prevFace, isNew);
    return { ok: true, stat: getStat() };
  } finally {
    try { lock.releaseLock(); } catch (err2) {}
  }
}

/** 그 사람이 오늘 굴린 면을 읽는다. 없으면 -1 */
function readRoll_(uid, day) {
  if (!uid) return -1;
  var sh = ensureRollSheet_(getBook_());
  var row = findRowIn_(sh, 1, uid);
  if (!row) return -1;
  var v = sh.getRange(row, 2, 1, 2).getValues()[0];
  if (String(v[0]) !== day) return -1;
  return Math.max(0, Math.min(5, Number(v[1]) - 1));
}

/** 화면이 처음 열릴 때 부른다 — 내 오늘 면 + 오늘 통계 + 위젯용 주소를 한 번에 준다 */
function getToday(uid) {
  var day = today_();
  var mine = readRoll_(String(uid || '').slice(0, 40), day);
  return {
    ok: true,
    date: day,
    myFace: mine,                 /* -1 이면 아직 안 굴렸다 */
    commonFace: commonFace_(day), /* 오늘 모두가 함께 보는 면 */
    stat: getStat(),
    url: appUrl_()                /* 위젯 안내에 넣을 이 앱의 주소 */
  };
}

/** 배포된 웹앱 주소. 아직 배포 전이면 빈 글자를 준다. */
function appUrl_() {
  try {
    return ScriptApp.getService().getUrl() || '';
  } catch (err) {
    return '';
  }
}

/** 오늘 몇 명이 굴렸고 어느 면이 몇 번 나왔는지 */
function getStat() {
  var sh = ensureStatSheet_(getBook_());
  var day = today_();
  var row = findRowIn_(sh, 1, day);
  if (!row) return { date: day, people: 0, dist: [0, 0, 0, 0, 0, 0] };
  var v = sh.getRange(row, 2, 1, 7).getValues()[0];
  return {
    date: day,
    people: Number(v[0]) || 0,
    dist: [1, 2, 3, 4, 5, 6].map(function (i) { return Number(v[i]) || 0; })
  };
}

/** 날짜별 집계를 고친다 */
function bumpStat_(book, day, face, prevFace, isNew) {
  var sh = ensureStatSheet_(book);
  var row = findRowIn_(sh, 1, day);
  if (!row) {
    sh.appendRow([day, 0, 0, 0, 0, 0, 0, 0]);
    row = sh.getLastRow();
  }
  var v = sh.getRange(row, 2, 1, 7).getValues()[0].map(function (x) { return Number(x) || 0; });
  if (isNew) v[0] = v[0] + 1;
  if (prevFace >= 0) v[prevFace + 1] = Math.max(0, v[prevFace + 1] - 1);
  v[face + 1] = v[face + 1] + 1;
  sh.getRange(row, 2, 1, 7).setValues([v]);
}

/**
 * 날짜만 가지고 정해지는 「오늘의 공통 면」.
 * 같은 날이면 세계 어디서 열어도 같은 면이 나온다. 아직 안 굴린 사람의 위젯에 쓴다.
 */
function commonFace_(day) {
  var n = 0;
  for (var i = 0; i < day.length; i++) n = (n * 31 + day.charCodeAt(i)) % 100003;
  return n % 6;
}

/* ────────────────────────────── 경험담 ────────────────────────────── */

/**
 * 경험담 목록을 준다.
 *  opt.face  1~6 이면 그 면만, 0 이면 전체
 *  opt.sort  'heart' 면 공감 많은 순, 아니면 최신순
 *  opt.start 몇 번째부터 (더 보기)
 *  opt.uid   내가 하트를 눌렀는지, 내 글인지 표시하려고 쓴다
 */
function getFeed(opt) {
  opt = opt || {};
  var uid = String(opt.uid || '').slice(0, 40);
  var face = Number(opt.face) || 0;
  var sort = (opt.sort === 'heart') ? 'heart' : 'new';
  var start = Math.max(0, Number(opt.start) || 0);

  var sh = ensureStorySheet_(getBook_());
  var last = sh.getLastRow();
  if (last < 2) return { ok: true, rows: [], total: 0, more: false };

  var data = sh.getRange(2, 1, last - 1, STORY_COLS).getValues();
  var list = [];
  for (var i = 0; i < data.length; i++) {
    var r = data[i];
    if (String(r[C_STATE - 1]) === '숨김') continue;
    var f = Number(r[C_FACE - 1]) || 0;
    if (face && f !== face) continue;
    var hu = String(r[C_HUID - 1] || '');
    list.push({
      id: Number(r[C_ID - 1]) || 0,
      when: fmtWhen_(r[C_TIME - 1]),
      name: String(r[C_ANON - 1]) === 'Y' ? '익명' : String(r[C_NAME - 1] || '익명'),
      anon: String(r[C_ANON - 1]) === 'Y',
      face: f,
      text: String(r[C_TEXT - 1] || ''),
      hearts: Number(r[C_HEART - 1]) || 0,
      liked: uid ? (hu.indexOf('|' + uid + '|') >= 0) : false,
      mine: uid ? (String(r[C_UID - 1]) === uid) : false
    });
  }

  if (sort === 'heart') {
    list.sort(function (a, b) { return (b.hearts - a.hearts) || (b.id - a.id); });
  } else {
    list.sort(function (a, b) { return b.id - a.id; });
  }

  var page = list.slice(start, start + PAGE);
  return { ok: true, rows: page, total: list.length, more: start + PAGE < list.length };
}

/**
 * 경험담을 올린다.
 * payload = { uid, name, anon, face, text, pw }
 */
function addStory(payload) {
  payload = payload || {};
  var uid = String(payload.uid || '').slice(0, 40);
  if (!uid) return { ok: false, error: '기기 번호가 없습니다. 새로고침 후 다시 해 주세요.' };
  if (!isOpen_()) return { ok: false, error: '지금은 나눔을 받지 않습니다.' };

  var text = clean_(payload.text, MAX_LEN);
  if (text.length < 5) return { ok: false, error: '내용을 5글자 이상 적어 주세요.' };
  if (hasBadWord_(text)) return { ok: false, error: '고운 말로 적어 주세요.' };

  var anon = payload.anon ? 'Y' : 'N';
  var name = clean_(payload.name, NAME_MAX);
  if (anon === 'N' && !name) return { ok: false, error: '이름을 적거나 익명을 선택해 주세요.' };
  if (anon === 'N' && hasBadWord_(name)) return { ok: false, error: '고운 말로 적어 주세요.' };

  var face = Math.max(0, Math.min(6, Number(payload.face) || 0));
  var pw = String(payload.pw || '').replace(/\D/g, '');
  if (pw.length !== 4) return { ok: false, error: '지울 때 쓸 숫자 4자리를 정해 주세요.' };

  /* 도배 막기 — 같은 기기가 너무 자주 올리지 못하게 */
  var cache = CacheService.getScriptCache();
  if (cache.get('cool_' + uid)) {
    return { ok: false, error: COOLDOWN_SEC + '초에 한 편씩 올릴 수 있어요. 잠시만요.' };
  }

  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (err) { return { ok: false, error: '잠시 뒤 다시 시도해 주세요.' }; }

  try {
    var book = getBook_();
    var sh = ensureStorySheet_(book);

    /*
     * 하루 상한은 시트를 직접 세어서 지킨다.
     * CacheService 는 아무리 길게 잡아도 6시간이면 사라져서, 캐시로 세면
     * 하루에 여러 번 0 으로 되돌아가 상한이 사실상 없는 것이 된다.
     */
    if (countTodayBy_(sh, uid) >= DAILY_MAX) {
      return { ok: false, error: '오늘은 ' + DAILY_MAX + '편까지 올릴 수 있어요.' };
    }

    var id = nextId_(sh);
    sh.appendRow([
      id, new Date(), name, anon, face, text, 0, '보임', hash_(pw), uid, '|', 0, '|'
    ]);
    cache.put('cool_' + uid, '1', COOLDOWN_SEC);

    return {
      ok: true,
      row: {
        id: id, when: fmtWhen_(new Date()),
        name: anon === 'Y' ? '익명' : name, anon: anon === 'Y',
        face: face, text: text, hearts: 0, liked: false, mine: true
      }
    };
  } finally {
    try { lock.releaseLock(); } catch (err2) {}
  }
}

/** 하트를 누르거나 뗀다. 기기 하나당 글 하나에 한 번. */
function toggleHeart(id, uid) {
  id = Number(id) || 0;
  uid = String(uid || '').slice(0, 40);
  if (!id || !uid) return { ok: false, error: '잘못된 요청입니다.' };

  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (err) { return { ok: false, error: '잠시 뒤 다시 시도해 주세요.' }; }

  try {
    var sh = ensureStorySheet_(getBook_());
    var row = findRowIn_(sh, C_ID, id);
    if (!row) return { ok: false, error: '글을 찾을 수 없습니다.' };

    var cur = sh.getRange(row, C_HEART, 1, 5).getValues()[0]; /* 하트수, 상태, 비번, uid, 누른목록 */
    var hearts = Number(cur[0]) || 0;
    var listStr = String(cur[4] || '|');
    if (listStr.charAt(0) !== '|') listStr = '|' + listStr;

    var key = '|' + uid + '|';
    var liked;
    if (listStr.indexOf(key) >= 0) {
      listStr = listStr.replace(key, '|');
      hearts = Math.max(0, hearts - 1);
      liked = false;
    } else {
      /* 셀 한 칸의 글자 수 한계를 넘지 않도록 지킨다 */
      if (listStr.length < 40000) listStr = listStr + uid + '|';
      hearts = hearts + 1;
      liked = true;
    }

    sh.getRange(row, C_HEART).setValue(hearts);
    sh.getRange(row, C_HUID).setValue(listStr);
    return { ok: true, id: id, hearts: hearts, liked: liked };
  } finally {
    try { lock.releaseLock(); } catch (err2) {}
  }
}

/** 내가 쓴 글을 지운다. 올릴 때 정한 숫자 4자리가 맞아야 한다. */
function deleteStory(id, uid, pw) {
  id = Number(id) || 0;
  uid = String(uid || '').slice(0, 40);
  pw = String(pw || '').replace(/\D/g, '');

  /*
   * 줄을 지우면 아래 줄들이 한 칸씩 올라온다. 잠그지 않으면 거의 동시에 들어온
   * 다른 요청이 이미 찾아 둔 「옛 줄 번호」로 엉뚱한 사람의 글을 지울 수 있다.
   */
  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (err) { return { ok: false, error: '잠시 뒤 다시 시도해 주세요.' }; }

  try {
    var sh = ensureStorySheet_(getBook_());
    var row = findRowIn_(sh, C_ID, id);
    if (!row) return { ok: false, error: '글을 찾을 수 없습니다.' };

    var v = sh.getRange(row, C_PW, 1, 2).getValues()[0];
    if (String(v[0]) !== hash_(pw)) return { ok: false, error: '비밀번호가 다릅니다.' };
    if (String(v[1]) !== uid) return { ok: false, error: '이 기기에서 올린 글이 아닙니다.' };

    sh.deleteRow(row);
    return { ok: true, id: id };
  } finally {
    try { lock.releaseLock(); } catch (err2) {}
  }
}

/**
 * 보기 불편한 글을 신고한다. 서로 다른 사람 REPORT_HIDE 명이 신고하면 자동으로 숨겨진다.
 * 누가 신고했는지를 시트에 남겨 둔다 — 캐시로만 막으면 캐시가 사라진 뒤
 * 한 사람이 시간을 두고 여러 번 눌러 남의 글을 혼자 숨길 수 있다.
 */
function reportStory(id, uid) {
  id = Number(id) || 0;
  uid = String(uid || '').slice(0, 40);
  if (!id || !uid) return { ok: false, error: '잘못된 요청입니다.' };

  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (err) { return { ok: false, error: '잠시 뒤 다시 시도해 주세요.' }; }

  try {
    var sh = ensureStorySheet_(getBook_());
    var row = findRowIn_(sh, C_ID, id);
    if (!row) return { ok: false, error: '글을 찾을 수 없습니다.' };

    var cur = sh.getRange(row, C_REPORT, 1, 2).getValues()[0];
    var n = Number(cur[0]) || 0;
    var listStr = String(cur[1] || '|');
    if (listStr.charAt(0) !== '|') listStr = '|' + listStr;

    /* 이미 신고한 기기면 숫자를 올리지 않는다 */
    if (listStr.indexOf('|' + uid + '|') >= 0) {
      return { ok: true, already: true, hidden: String(sh.getRange(row, C_STATE).getValue()) === '숨김' };
    }

    n = n + 1;
    if (listStr.length < 40000) listStr = listStr + uid + '|';
    sh.getRange(row, C_REPORT, 1, 2).setValues([[n, listStr]]);
    if (n >= REPORT_HIDE) sh.getRange(row, C_STATE).setValue('숨김');
    return { ok: true, hidden: n >= REPORT_HIDE };
  } finally {
    try { lock.releaseLock(); } catch (err2) {}
  }
}

/* ────────────────────────────── 시트 만들기·찾기 ────────────────────────────── */

/** 기록할 스프레드시트를 가져온다. 없으면 처음 한 번 새로 만든다. */
function getBook_() {
  var props = PropertiesService.getScriptProperties();
  var id = SPREADSHEET_ID || props.getProperty('BOOK_ID');
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch (err) { /* 지워졌으면 새로 만든다 */ }
  }
  var active = null;
  try { active = SpreadsheetApp.getActiveSpreadsheet(); } catch (err2) {}
  if (active) return active;

  var made = SpreadsheetApp.create('사랑의 주사위 기록');
  props.setProperty('BOOK_ID', made.getId());
  return made;
}

function ensureStorySheet_(book) {
  return ensureOne_(book, SHEET_STORY, [
    '번호', '올린 시각', '표시 이름', '익명', '주사위 면', '내용',
    '하트 수', '상태', '비밀번호(뭉갠 값)', '올린 기기', '하트 누른 기기', '신고 수', '신고한 기기'
  ], [70, 140, 110, 60, 90, 480, 80, 70, 140, 120, 200, 70, 200]);
}

function ensureRollSheet_(book) {
  return ensureOne_(book, SHEET_ROLL,
    ['기기 번호', '날짜', '오늘 나온 면', '누적 굴린 횟수'], [220, 110, 120, 130]);
}

function ensureStatSheet_(book) {
  return ensureOne_(book, SHEET_STAT,
    ['날짜', '참여자 수', '①모든 이를', '②먼저', '③곁에 있는 이를', '④용서', '⑤귀 기울이자', '⑥서로'],
    [110, 100, 110, 90, 130, 80, 120, 90]);
}

/** 시트가 없으면 만들고, 머리글이 없거나 달라졌을 때만 꾸민다 */
function ensureOne_(book, name, head, widths) {
  var sh = book.getSheetByName(name);
  if (!sh) sh = book.insertSheet(name);
  var first = sh.getRange(1, 1).getValue();
  if (!first || String(first) !== head[0]) {
    sh.getRange(1, 1, 1, head.length).setValues([head]);
    var hd = sh.getRange(1, 1, 1, head.length);
    hd.setFontWeight('bold').setBackground('#f3e8ff').setFontSize(11)
      .setVerticalAlignment('middle').setHorizontalAlignment('center');
    sh.setRowHeight(1, 34);
    sh.setFrozenRows(1);
    if (widths) for (var i = 0; i < widths.length; i++) sh.setColumnWidth(i + 1, widths[i]);
  }
  return sh;
}

/** 어떤 열에서 값이 같은 줄 번호를 찾는다. 없으면 0 */
function findRowIn_(sheet, col, value) {
  var last = sheet.getLastRow();
  if (last < 2) return 0;
  var vals = sheet.getRange(2, col, last - 1, 1).getValues();
  var want = String(value);
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0]) === want) return i + 2;
  }
  return 0;
}

/**
 * 다음 글 번호.
 * 시트에 남은 번호의 최댓값을 쓰면, 마지막 글을 지운 직후 올라온 새 글이
 * 같은 번호를 물려받아 「지운 글에 누른 하트가 엉뚱한 새 글에 붙는」 일이 생긴다.
 * 그래서 지우든 말든 늘 커지기만 하는 카운터를 따로 둔다.
 */
function nextId_(sh) {
  var props = PropertiesService.getScriptProperties();
  var last = Number(props.getProperty('LAST_ID') || 0);

  if (!last) {
    /* 처음 한 번만 — 이미 쌓여 있는 글이 있으면 그 뒤부터 이어 간다 */
    var lastRow = sh.getLastRow();
    if (lastRow >= 2) {
      var vals = sh.getRange(2, C_ID, lastRow - 1, 1).getValues();
      for (var i = 0; i < vals.length; i++) {
        var n = Number(vals[i][0]) || 0;
        if (n > last) last = n;
      }
    }
  }

  var next = last + 1;
  props.setProperty('LAST_ID', String(next));
  return next;
}

/** 그 기기가 오늘 올린 글이 몇 편인지 시트에서 직접 센다 */
function countTodayBy_(sh, uid) {
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var vals = sh.getRange(2, C_TIME, last - 1, C_UID - C_TIME + 1).getValues();
  var day = today_();
  var n = 0;
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][C_UID - C_TIME]) !== uid) continue;
    var d = vals[i][0];
    if (!(d instanceof Date)) d = new Date(d);
    if (isNaN(d.getTime())) continue;
    if (Utilities.formatDate(d, 'Asia/Seoul', 'yyyy-MM-dd') === day) n++;
  }
  return n;
}

/* ────────────────────────────── 잔심부름 ────────────────────────────── */

/** 오늘 날짜를 한국 시간으로 'yyyy-MM-dd' 꼴로 */
function today_() {
  return Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
}

/** 시각을 「7월 31일 15:20」 꼴로 */
function fmtWhen_(v) {
  var d = (v instanceof Date) ? v : new Date(v);
  if (isNaN(d.getTime())) return '';
  return Utilities.formatDate(d, 'Asia/Seoul', 'M월 d일 HH:mm');
}

/** 앞뒤 공백을 없애고 너무 긴 글은 자른다 */
function clean_(v, max) {
  var s = String(v == null ? '' : v).replace(/\r\n/g, '\n').trim();
  return s.length > max ? s.slice(0, max) : s;
}

/** 비밀번호를 되돌릴 수 없게 뭉갠다 (원문은 절대 저장하지 않는다) */
function hash_(pw) {
  var raw = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, getSalt_() + '::' + pw, Utilities.Charset.UTF_8);
  return Utilities.base64Encode(raw);
}

/** 이 스크립트만의 소금값. 처음 한 번 무작위로 만들어 두고 계속 쓴다 */
function getSalt_() {
  var props = PropertiesService.getScriptProperties();
  var s = props.getProperty('SALT');
  if (!s) {
    s = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('SALT', s);
  }
  return s;
}

/** 아주 거친 욕설 거르기 — 완벽하지 않으니 신고·관리자 숨김과 함께 쓴다 */
function hasBadWord_(s) {
  var t = String(s).replace(/\s/g, '');
  var bad = ['시발', '씨발', '병신', '지랄', '개새', '좆', '썅', '니미', 'ㅅㅂ', 'ㅄ', 'ㅂㅅ'];
  for (var i = 0; i < bad.length; i++) if (t.indexOf(bad[i]) >= 0) return true;
  return false;
}

/** 지금 나눔을 받는 중인지 */
function isOpen_() {
  return PropertiesService.getScriptProperties().getProperty('CLOSED') !== 'Y';
}

/* ────────────────────────────── 관리자 메뉴 (스프레드시트 위쪽) ────────────────────────────── */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('💜 사랑의 주사위')
    .addItem('시트 준비하기', 'setupSheets')
    .addSeparator()
    .addItem('오늘 현황 보기', 'showToday')
    .addItem('신고된 글 보기', 'showReported')
    .addItem('고른 줄 숨기기 / 다시 보이기', 'toggleHide')
    .addSeparator()
    .addItem('나눔 받기 켜기', 'turnOn')
    .addItem('나눔 받기 끄기', 'turnOff')
    .addToUi();
}

/** 시트 3장을 한 번에 만든다 */
function setupSheets() {
  var book = getBook_();
  ensureStorySheet_(book);
  ensureRollSheet_(book);
  ensureStatSheet_(book);
  SpreadsheetApp.getUi().alert('시트를 준비했습니다.\n\n· ' + SHEET_STORY + '\n· ' + SHEET_ROLL + '\n· ' + SHEET_STAT);
}

function showToday() {
  var s = getStat();
  var lines = ['날짜 : ' + s.date, '오늘 주사위를 던진 사람 : ' + s.people + '명', ''];
  for (var i = 0; i < 6; i++) lines.push('· ' + FACES[i] + ' — ' + s.dist[i] + '명');
  var sh = ensureStorySheet_(getBook_());
  lines.push('', '쌓인 경험담 : ' + Math.max(0, sh.getLastRow() - 1) + '편');
  SpreadsheetApp.getUi().alert(lines.join('\n'));
}

function showReported() {
  var sh = ensureStorySheet_(getBook_());
  var last = sh.getLastRow();
  if (last < 2) { SpreadsheetApp.getUi().alert('아직 글이 없습니다.'); return; }
  var data = sh.getRange(2, 1, last - 1, STORY_COLS).getValues();
  var out = [];
  for (var i = 0; i < data.length; i++) {
    var n = Number(data[i][C_REPORT - 1]) || 0;
    if (n > 0) {
      out.push((i + 2) + '줄 · 신고 ' + n + '회 · [' + data[i][C_STATE - 1] + '] ' +
        String(data[i][C_TEXT - 1]).slice(0, 40));
    }
  }
  SpreadsheetApp.getUi().alert(out.length ? ('신고된 글\n\n' + out.join('\n')) : '신고된 글이 없습니다.');
}

/** 시트에서 줄을 고른 뒤 누르면 보임 ↔ 숨김을 바꾼다 */
function toggleHide() {
  var sh = SpreadsheetApp.getActiveSheet();
  var ui = SpreadsheetApp.getUi();
  if (sh.getName() !== SHEET_STORY) { ui.alert('「' + SHEET_STORY + '」 시트에서 숨길 줄을 고른 뒤 눌러 주세요.'); return; }
  var row = sh.getActiveRange().getRow();
  if (row < 2) { ui.alert('숨길 글의 줄을 골라 주세요.'); return; }
  var cell = sh.getRange(row, C_STATE);
  var now = String(cell.getValue()) === '숨김' ? '보임' : '숨김';
  cell.setValue(now);
  ui.alert(row + '줄을 「' + now + '」 으로 바꿨습니다.');
}

function turnOn() {
  PropertiesService.getScriptProperties().deleteProperty('CLOSED');
  SpreadsheetApp.getUi().alert('이제 경험담을 받습니다.');
}

function turnOff() {
  PropertiesService.getScriptProperties().setProperty('CLOSED', 'Y');
  SpreadsheetApp.getUi().alert('경험담 받기를 멈췄습니다. (읽기는 그대로 됩니다)');
}
