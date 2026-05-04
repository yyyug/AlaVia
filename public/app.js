const PRICES = {
  placesNearby: 0.005,
  streetViewStatic: 0.007,
  geminiGenerate: 0.0003,
};

const $ = (id) => document.getElementById(id);

const state = {
  roadName: "",
  intersections: [],
  focusedIndex: 0,
  searchAttempted: false,
  lastSearchWarning: "",
  queryCache: new Map(),
  uiLang: "zh-Hant",
  auth: {
    signedIn: false,
    approved: false,
    email: "",
  },
  quickStreet: {
    loaded: false,
    offset: 0,
    maxDistance: 0,
    lat: 0,
    lon: 0,
    heading: 0,
  },
};

const I18N = {
  "zh-Hant": {
    title: "AlaVia 文字地圖導覽",
    lead: "使用方式：先在路段名稱輸入地址或道路名稱，系統會由後端自動定位並搜尋路口。",
    uiLang: "介面語言",
    querySection: "查詢路段",
    countryPref: "國家偏好",
    roadName: "路段名稱",
    roadHint: "請輸入完整地址或道路名稱，建議包含城市/地區，例如：香港南昌街、台北市忠孝東路四段。",
    roadPlaceholder: "請輸入地址或道路名稱",
    sample: "沿路採樣間距（公尺）",
    loadRoad: "搜尋路口",
    useGps: "用目前位置",
    quickNav: "快速街道導覽",
    quickHint: "打開讀屏焦點模式後可直接用上下左右方向鍵進行操作。",
    forward: "往前",
    back: "往後",
    left: "往左",
    right: "往右",
    intersections: "路口清單",
    noIntersectionsBefore: "尚無路口資料，請先搜尋路口。",
    noIntersectionsAfter: "目前查無路口，請調整地址關鍵字或 bbox 範圍後再試。",
    loading: "載入中...",
    loadingDone: "載入完成。",
    nextIntersection: "前往下一條街道",
    prevIntersection: "前往上一條街道",
    leftTurn: "往左轉",
    rightTurn: "往右轉",
    routeOsm: "沿街地點 OSM",
    routeGoogle: "沿街地點 Google Places",
    streetDetail: "街景詳細描述",
    noDataLoaded: "尚未載入路口資料。",
    costStreet: "展開街景詳細描述：{calls} 次，預估 {usd}",
    costRouteOsm: "沿街地點 OSM：{calls} 次，使用 OSM 免費資料",
    costRouteGoogle: "沿街地點 Google Places（約 {calls} 次）：預估 {usd}",
    costTotal: "合計預估（含 Gemini 與 Google Places）{usd}",
    advanceBtn: "往前 {distance} 公尺街景詳細描述",
    advanceSectionLabel: "前 {distance} 公尺",
    intersectionEnded: "該路口已完結",
    meters: "公尺",
    intersectionPrefix: "路口",
    unnamedRoad: "未命名道路",
    unknownRoad: "未知道路",
    unknown: "未知",
    sourceOnRoad: "目標道路",
    sourceNearby: "附近地址",
    sourceNone: "未取得",
    none: "無",
    lastIntersection: "最後一路口",
    intersectionTypeLine: "型態：{type}，門牌來源：{source}，下一方向：{direction}，下一距離：{distance}",
    loadingOsmRoute: "查詢 OSM 沿街資料中...",
    lastNoNextRoute: "此路口為最後一路口，無下一段 OSM 沿街資料。",
    queryLoading: "查詢中...",
    errorPrefix: "錯誤：",
    noNextSegment: "此路口已是最後一個路口，沒有下一段沿街地點。",
    noNextStreet: "此路口已到街尾，沒有可前往的同方向連接街道。",
    noPrevStreet: "此路口已到街頭，沒有可前往的上一條連接街道。",
    noRouteOsm: "此段無 OSM 地點資料。",
    noRouteGoogle: "此段無 Google Places 資料。",
    enterRoadFirst: "請先輸入路段名稱。\n例如：台北市大安區忠孝東路四段",
    geocodeOk: "自動定位：{name}（{country}）",
    geocodeFail: "自動定位失敗（{country}），改用目前 bbox 搜尋（{message}）",
    gpsLocating: "正在取得目前位置...",
    gpsResolved: "GPS 定位：{name}",
    gpsFailed: "GPS 定位失敗：{message}",
    searchDoneSummary: "共 {count} 個路口，估計路段長度 {meters} {unit}。",
    warningPrefix: "提醒：",
    countrySummary: "國家偏好：{country}",
    searchFailed: "搜尋失敗：{message}",
    noLeftTurn: "此路口沒有可左轉查詢的連接街道。",
    noRightTurn: "此路口沒有可右轉查詢的連接街道。",
    guestFreeNotice: "未登入時可使用免費 OSM 查詢；登入並通過審核後可使用付費街景/Gemini。",
    pendingApprovalNotice: "帳號 {email} 待管理員審核；目前仍可使用免費 OSM 查詢。",
    paidLoginRequired: "請先登入後使用付費街景/Gemini 功能。",
    paidApprovalRequired: "帳號待審核中，尚未開放付費街景/Gemini 功能。",
    sideFront: "前方附近",
    sideLeft: "左側",
    sideRight: "右側",
    dirN: "北",
    dirNE: "東北",
    dirE: "東",
    dirSE: "東南",
    dirS: "南",
    dirSW: "西南",
    dirW: "西",
    dirNW: "西北",
    typeCross: "十字或多向路口",
    typeT: "T 型路口",
    typeLink: "雙向連接點",
  },
  en: {
    title: "AlaVia Text Navigation",
    lead: "Enter a road or address. The backend auto-locates and searches intersections for you.",
    uiLang: "Interface Language",
    querySection: "Road Query",
    countryPref: "Country Preference",
    roadName: "Road / Address",
    roadHint: "Enter a full address or road name with city/area for better matching.",
    roadPlaceholder: "Enter road or address",
    sample: "Sampling Interval (meters)",
    loadRoad: "Search Intersections",
    useGps: "Use Current Location",
    quickNav: "Quick Street Navigation",
    quickHint: "With screen-reader focus mode enabled, you can operate directly with the arrow keys: Up, Down, Left, and Right.",
    forward: "Forward",
    back: "Back",
    left: "Left",
    right: "Right",
    intersections: "Intersection List",
    noIntersectionsBefore: "No intersections yet. Search first.",
    noIntersectionsAfter: "No intersections found. Adjust query or bbox.",
    loading: "Loading...",
    loadingDone: "Loaded.",
    nextIntersection: "Go To Next Street",
    prevIntersection: "Go To Previous Street",
    leftTurn: "Turn Left",
    rightTurn: "Turn Right",
    routeOsm: "Route Places OSM",
    routeGoogle: "Route Places Google Places",
    streetDetail: "Street Scene Details",
    noDataLoaded: "No intersection data loaded.",
    costStreet: "Street scene details: {calls} calls, estimated {usd}",
    costRouteOsm: "Route Places OSM: {calls} calls, using free OSM data",
    costRouteGoogle: "Route Places Google Places (~{calls} calls): estimated {usd}",
    costTotal: "Estimated total (Gemini + Google Places): {usd}",
    meters: "m",
    intersectionPrefix: "Intersection",
    unnamedRoad: "Unnamed road",
    unknownRoad: "Unknown road",
    unknown: "Unknown",
    sourceOnRoad: "target road",
    sourceNearby: "nearby address",
    sourceNone: "not available",
    none: "none",
    lastIntersection: "last intersection",
    intersectionTypeLine: "Type: {type}, address source: {source}, next direction: {direction}, next distance: {distance}",
    loadingOsmRoute: "Loading OSM route places...",
    lastNoNextRoute: "This is the last intersection. No next OSM route segment.",
    queryLoading: "Loading...",
    errorPrefix: "Error: ",
    noNextSegment: "This is the last intersection. No next route segment.",
    noNextStreet: "You are at the end of this street. No forward connected street found.",
    noPrevStreet: "You are at the beginning of this street. No previous connected street found.",
    noRouteOsm: "No OSM places on this segment.",
    noRouteGoogle: "No Google Places on this segment.",
    enterRoadFirst: "Please enter a road or address first.\nExample: Zhongxiao East Rd Sec. 4, Taipei",
    geocodeOk: "Auto-located: {name} ({country})",
    geocodeFail: "Auto-locate failed ({country}); using current bbox ({message})",
    gpsLocating: "Getting current location...",
    gpsResolved: "GPS located: {name}",
    gpsFailed: "GPS failed: {message}",
    searchDoneSummary: "Found {count} intersections, estimated route length {meters} {unit}.",
    warningPrefix: "Warning: ",
    countrySummary: "Country Preference: {country}",
    searchFailed: "Search failed: {message}",
    noLeftTurn: "No connected road available for left turn at this intersection.",
    noRightTurn: "No connected road available for right turn at this intersection.",
    guestFreeNotice: "You can use free OSM queries when signed out; paid Street View/Gemini features are available after sign-in and approval.",
    pendingApprovalNotice: "Account {email} is pending admin approval. Free OSM queries are still available.",
    paidLoginRequired: "Sign in first to use paid Street View/Gemini features.",
    paidApprovalRequired: "Your account is pending approval. Paid Street View/Gemini features are not available yet.",
    advanceBtn: "Advance {distance}m Street Scene Details",
    advanceSectionLabel: "{distance}m forward",
    intersectionEnded: "End of segment",
    sideFront: "nearby ahead",
    sideLeft: "left side",
    sideRight: "right side",
    dirN: "North",
    dirNE: "Northeast",
    dirE: "East",
    dirSE: "Southeast",
    dirS: "South",
    dirSW: "Southwest",
    dirW: "West",
    dirNW: "Northwest",
    typeCross: "Cross or multi-way intersection",
    typeT: "T intersection",
    typeLink: "Two-way connection",
  },
  ja: {
    title: "AlaVia テキスト地図ナビ",
    lead: "道路名や住所を入力すると、バックエンドが自動で位置特定して交差点を検索します。",
    uiLang: "表示言語",
    querySection: "道路検索",
    countryPref: "国選択",
    roadName: "道路名/住所",
    roadHint: "都市名を含めた完全な道路名または住所を入力してください。",
    roadPlaceholder: "道路名または住所を入力",
    sample: "サンプリング間隔（m）",
    loadRoad: "交差点を検索",
    useGps: "現在地を使う",
    quickNav: "クイック街路ナビ",
    quickHint: "スクリーンリーダーのフォーカスモードを有効にすると、上下左右の方向キーで直接操作できます。",
    forward: "前へ",
    back: "後ろへ",
    left: "左",
    right: "右",
    intersections: "交差点リスト",
    noIntersectionsBefore: "交差点データはありません。先に検索してください。",
    noIntersectionsAfter: "交差点が見つかりません。検索語または bbox を調整してください。",
    loading: "読み込み中...",
    loadingDone: "読み込み完了。",
    nextIntersection: "次の接続道路へ",
    prevIntersection: "前の接続道路へ",
    leftTurn: "左折",
    rightTurn: "右折",
    routeOsm: "沿道地点 OSM",
    routeGoogle: "沿道地点 Google Places",
    streetDetail: "街景の詳細説明",
    noDataLoaded: "交差点データは未読み込みです。",
    costStreet: "街景の詳細説明: {calls} 回、推定 {usd}",
    costRouteOsm: "沿道地点 OSM: {calls} 回（OSM 無料データ）",
    costRouteGoogle: "沿道地点 Google Places（約 {calls} 回）: 推定 {usd}",
    costTotal: "推定合計（Gemini + Google Places）: {usd}",
    meters: "m",
    intersectionPrefix: "交差点",
    unnamedRoad: "無名道路",
    unknownRoad: "不明道路",
    unknown: "不明",
    sourceOnRoad: "対象道路",
    sourceNearby: "周辺住所",
    sourceNone: "未取得",
    none: "なし",
    lastIntersection: "最終交差点",
    intersectionTypeLine: "種別: {type}、住所ソース: {source}、次方向: {direction}、次距離: {distance}",
    loadingOsmRoute: "OSM沿道地点を照会中...",
    lastNoNextRoute: "この交差点は最終です。次の OSM 区間はありません。",
    queryLoading: "照会中...",
    errorPrefix: "エラー: ",
    noNextSegment: "この交差点は最終です。次の区間はありません。",
    noNextStreet: "この地点は道路の終端です。同方向の接続道路が見つかりません。",
    noPrevStreet: "この地点は道路の始端です。前の接続道路が見つかりません。",
    noRouteOsm: "この区間に OSM 地点がありません。",
    noRouteGoogle: "この区間に Google Places がありません。",
    enterRoadFirst: "道路名を先に入力してください。\n例: 東京都新宿区...",
    geocodeOk: "自動位置特定: {name}（{country}）",
    geocodeFail: "自動位置特定に失敗（{country}）。現在の bbox を使用（{message}）",
    gpsLocating: "現在地を取得中...",
    gpsResolved: "GPS 位置: {name}",
    gpsFailed: "GPS 取得失敗: {message}",
    searchDoneSummary: "交差点 {count} 件、推定延長 {meters} {unit}。",
    warningPrefix: "注意: ",
    countrySummary: "国選択: {country}",
    searchFailed: "検索失敗: {message}",
    noLeftTurn: "この交差点で左折可能な接続道路はありません。",
    noRightTurn: "この交差点で右折可能な接続道路はありません。",
    guestFreeNotice: "未ログインでも無料の OSM 照会は利用できます。ログインして承認されると有料の Street View/Gemini 機能が使えます。",
    pendingApprovalNotice: "アカウント {email} は管理者承認待ちです。無料の OSM 照会は引き続き利用できます。",
    paidLoginRequired: "有料の Street View/Gemini 機能を使うにはログインしてください。",
    paidApprovalRequired: "アカウント承認待ちのため、有料の Street View/Gemini 機能はまだ利用できません。",
    advanceBtn: "前方 {distance}m の街景詳細説明",
    advanceSectionLabel: "前方 {distance}m",
    intersectionEnded: "この区間は終了しました",
    sideFront: "進行方向付近",
    sideLeft: "左側",
    sideRight: "右側",
    dirN: "北",
    dirNE: "北東",
    dirE: "東",
    dirSE: "南東",
    dirS: "南",
    dirSW: "南西",
    dirW: "西",
    dirNW: "北西",
    typeCross: "十字・多方向交差点",
    typeT: "T字交差点",
    typeLink: "双方向接続点",
  },
  ko: {
    title: "AlaVia 텍스트 지도 내비",
    lead: "도로명 또는 주소를 입력하면 백엔드가 자동으로 위치를 찾고 교차로를 검색합니다.",
    uiLang: "인터페이스 언어",
    querySection: "도로 검색",
    countryPref: "국가 선택",
    roadName: "도로명/주소",
    roadHint: "도시/지역을 포함한 전체 도로명 또는 주소를 입력하세요.",
    roadPlaceholder: "도로명 또는 주소 입력",
    sample: "샘플 간격(미터)",
    loadRoad: "교차로 검색",
    useGps: "현재 위치 사용",
    quickNav: "빠른 도로 안내",
    quickHint: "스크린 리더 포커스 모드를 켜면 위, 아래, 왼쪽, 오른쪽 방향키로 바로 조작할 수 있습니다.",
    forward: "앞으로",
    back: "뒤로",
    left: "왼쪽",
    right: "오른쪽",
    intersections: "교차로 목록",
    noIntersectionsBefore: "교차로 데이터가 없습니다. 먼저 검색하세요.",
    noIntersectionsAfter: "교차로를 찾지 못했습니다. 검색어 또는 bbox를 조정하세요.",
    loading: "로딩 중...",
    loadingDone: "로딩 완료.",
    nextIntersection: "다음 연결 도로로",
    prevIntersection: "이전 연결 도로로",
    leftTurn: "좌회전",
    rightTurn: "우회전",
    routeOsm: "연선 장소 OSM",
    routeGoogle: "연선 장소 Google Places",
    streetDetail: "거리 장면 상세",
    noDataLoaded: "교차로 데이터가 아직 없습니다.",
    costStreet: "거리 장면 상세: {calls}회, 예상 {usd}",
    costRouteOsm: "연선 장소 OSM: {calls}회, OSM 무료 데이터 사용",
    costRouteGoogle: "연선 장소 Google Places(약 {calls}회): 예상 {usd}",
    costTotal: "총 예상(Gemini + Google Places): {usd}",
    meters: "m",
    intersectionPrefix: "교차로",
    unnamedRoad: "이름 없는 도로",
    unknownRoad: "알 수 없는 도로",
    unknown: "알 수 없음",
    sourceOnRoad: "대상 도로",
    sourceNearby: "주변 주소",
    sourceNone: "없음",
    none: "없음",
    lastIntersection: "마지막 교차로",
    intersectionTypeLine: "유형: {type}, 주소 출처: {source}, 다음 방향: {direction}, 다음 거리: {distance}",
    loadingOsmRoute: "OSM 연선 장소 조회 중...",
    lastNoNextRoute: "마지막 교차로입니다. 다음 OSM 구간이 없습니다.",
    queryLoading: "조회 중...",
    errorPrefix: "오류: ",
    noNextSegment: "마지막 교차로입니다. 다음 구간이 없습니다.",
    noNextStreet: "이 지점은 도로 끝입니다. 같은 진행 방향의 연결 도로가 없습니다.",
    noPrevStreet: "이 지점은 도로 시작점입니다. 이전 연결 도로가 없습니다.",
    noRouteOsm: "이 구간에 OSM 장소가 없습니다.",
    noRouteGoogle: "이 구간에 Google Places가 없습니다.",
    enterRoadFirst: "먼저 도로명/주소를 입력하세요.\n예: ...",
    geocodeOk: "자동 위치 지정: {name} ({country})",
    geocodeFail: "자동 위치 지정 실패({country}). 현재 bbox 사용 ({message})",
    gpsLocating: "현재 위치를 가져오는 중...",
    gpsResolved: "GPS 위치: {name}",
    gpsFailed: "GPS 실패: {message}",
    searchDoneSummary: "교차로 {count}개, 예상 길이 {meters} {unit}.",
    warningPrefix: "안내: ",
    countrySummary: "국가 선택: {country}",
    searchFailed: "검색 실패: {message}",
    noLeftTurn: "이 교차로에서 좌회전 가능한 연결 도로가 없습니다.",
    noRightTurn: "이 교차로에서 우회전 가능한 연결 도로가 없습니다.",
    guestFreeNotice: "로그아웃 상태에서도 무료 OSM 조회는 사용할 수 있으며, 로그인 후 승인되면 유료 Street View/Gemini 기능을 사용할 수 있습니다.",
    pendingApprovalNotice: "계정 {email} 은(는) 관리자 승인 대기 중입니다. 무료 OSM 조회는 계속 사용할 수 있습니다.",
    paidLoginRequired: "유료 Street View/Gemini 기능을 사용하려면 먼저 로그인하세요.",
    paidApprovalRequired: "계정 승인 대기 중이므로 유료 Street View/Gemini 기능은 아직 사용할 수 없습니다.",
    advanceBtn: "{distance}m 전방 거리 장면 상세",
    advanceSectionLabel: "전방 {distance}m",
    intersectionEnded: "이 구간이 종료되었습니다",
    sideFront: "전방 근처",
    sideLeft: "왼쪽",
    sideRight: "오른쪽",
    dirN: "북",
    dirNE: "북동",
    dirE: "동",
    dirSE: "남동",
    dirS: "남",
    dirSW: "남서",
    dirW: "서",
    dirNW: "북서",
    typeCross: "십자/다방향 교차로",
    typeT: "T자 교차로",
    typeLink: "양방향 연결점",
  },
};

const REGION_CODES = [
  "AD","AE","AF","AG","AI","AL","AM","AO","AQ","AR","AS","AT","AU","AW","AX","AZ","BA","BB","BD","BE","BF","BG","BH","BI","BJ","BL","BM","BN","BO","BQ","BR","BS","BT","BV","BW","BY","BZ","CA","CC","CD","CF","CG","CH","CI","CK","CL","CM","CN","CO","CR","CU","CV","CW","CX","CY","CZ","DE","DJ","DK","DM","DO","DZ","EC","EE","EG","EH","ER","ES","ET","FI","FJ","FK","FM","FO","FR","GA","GB","GD","GE","GF","GG","GH","GI","GL","GM","GN","GP","GQ","GR","GS","GT","GU","GW","GY","HK","HM","HN","HR","HT","HU","ID","IE","IL","IM","IN","IO","IQ","IR","IS","IT","JE","JM","JO","JP","KE","KG","KH","KI","KM","KN","KP","KR","KW","KY","KZ","LA","LB","LC","LI","LK","LR","LS","LT","LU","LV","LY","MA","MC","MD","ME","MF","MG","MH","MK","ML","MM","MN","MO","MP","MQ","MR","MS","MT","MU","MV","MW","MX","MY","MZ","NA","NC","NE","NF","NG","NI","NL","NO","NP","NR","NU","NZ","OM","PA","PE","PF","PG","PH","PK","PL","PM","PN","PR","PS","PT","PW","PY","QA","RE","RO","RS","RU","RW","SA","SB","SC","SD","SE","SG","SH","SI","SJ","SK","SL","SM","SN","SO","SR","SS","ST","SV","SX","SY","SZ","TC","TD","TF","TG","TH","TJ","TK","TL","TM","TN","TO","TR","TT","TV","TW","TZ","UA","UG","UM","US","UY","UZ","VA","VC","VE","VG","VI","VN","VU","WF","WS","YE","YT","ZA","ZM","ZW",
];

function t(key) {
  const dict = I18N[state.uiLang] || I18N["zh-Hant"];
  return dict[key] || I18N.en[key] || I18N["zh-Hant"][key] || key;
}

function tf(key, vars = {}) {
  const template = t(key);
  return String(template).replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? ""));
}

function getMapLanguage() {
  if (state.uiLang === "en") return "en";
  if (state.uiLang === "ja") return "ja";
  if (state.uiLang === "ko") return "ko";
  return "zh-TW";
}

function setStaticTexts() {
  document.documentElement.lang = state.uiLang;
  $("titleText").textContent = t("title");
  $("leadText").textContent = t("lead");
  $("uiLangLabel").childNodes[0].nodeValue = `${t("uiLang")} `;
  $("querySectionTitle").textContent = t("querySection");
  $("countryLabel").childNodes[0].nodeValue = `${t("countryPref")} `;
  $("roadNameLabel").textContent = t("roadName");
  $("roadNameHint").textContent = t("roadHint");
  $("roadName").placeholder = t("roadPlaceholder");
  $("sampleIntervalLabel").childNodes[0].nodeValue = `${t("sample")} `;
  $("loadRoadBtn").textContent = t("loadRoad");
  $("useGpsBtn").textContent = t("useGps");
  $("quickNavTitle").textContent = t("quickNav");
  $("quickNavHint").textContent = t("quickHint");
  $("navForwardBtn").textContent = t("forward");
  $("navBackBtn").textContent = t("back");
  $("navLeftBtn").textContent = t("left");
  $("navRightBtn").textContent = t("right");
  refreshQuickStreetButtonState();
  refreshQuickStreetAdvanceButton();
  $("intersectionSectionTitle").textContent = t("intersections");
}

function initCountryOptions() {
  const select = $("countryCode");
  if (!select) return;

  const lang = state.uiLang === "zh-Hant" ? "zh-Hant" : state.uiLang;
  const enDisplay = new Intl.DisplayNames(["en"], { type: "region" });
  const localDisplay = new Intl.DisplayNames([lang], { type: "region" });

  const options = REGION_CODES
    .map((code) => {
      const en = enDisplay.of(code) || code;
      const local = localDisplay.of(code) || code;
      const label = state.uiLang === "en" || local === en ? en : `${en} ${local}`;
      return { code, en, label };
    })
    .sort((a, b) => a.en.localeCompare(b.en, "en", { sensitivity: "base" }));

  const oldValue = String(select.value || "TW").toUpperCase();
  select.innerHTML = "";
  for (const item of options) {
    const opt = document.createElement("option");
    opt.value = item.code;
    opt.textContent = item.label;
    if (item.code === oldValue || (!oldValue && item.code === "TW")) {
      opt.selected = true;
    }
    select.appendChild(opt);
  }
}

function getSampleInterval() {
  return Math.max(10, Number($("sampleInterval").value || 30));
}

function getCountryCode() {
  const v = String($("countryCode")?.value || "TW").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(v) ? v : "TW";
}

function formatUsd(v) {
  return `$${v.toFixed(3)}`;
}

function estimateCosts() {
  const count = state.intersections.length;
  const streetCalls = count * 2;
  const streetUsd = count * 2 * (PRICES.streetViewStatic + PRICES.geminiGenerate);

  const interval = getSampleInterval();
  let routeSamples = 0;
  for (let i = 0; i < state.intersections.length - 1; i += 1) {
    const dist = Number(state.intersections[i].distanceToNext || 0);
    routeSamples += Math.max(1, Math.ceil(dist / interval));
  }

  return {
    street: { calls: streetCalls, usd: streetUsd },
    routeOsm: { calls: routeSamples, usd: 0, samples: routeSamples },
    routeGoogle: { calls: routeSamples, usd: routeSamples * PRICES.placesNearby, samples: routeSamples },
  };
}

function renderCosts() {
  if (state.intersections.length === 0) {
    $("costs").innerText = t("noDataLoaded");
    return;
  }

  const c = estimateCosts();
  const totalUsd = c.street.usd + c.routeGoogle.usd;
  $("costs").innerText = [
    tf("costStreet", { calls: c.street.calls, usd: formatUsd(c.street.usd) }),
    tf("costRouteOsm", { calls: c.routeOsm.calls }),
    tf("costRouteGoogle", { calls: c.routeGoogle.calls, usd: formatUsd(c.routeGoogle.usd) }),
    tf("costTotal", { usd: formatUsd(totalUsd) }),
  ].join("\n");
}

const CLERK_PUBLISHABLE_KEY = "pk_test_cG9zc2libGUtc2tpbmstNC5jbGVyay5hY2NvdW50cy5kZXYk";
let clerkSession = null;

async function getClerkToken() {
  if (!clerkSession) return null;
  try {
    return await clerkSession.getToken();
  } catch {
    return null;
  }
}

async function postJson(path, body) {
  const token = await getClerkToken();
  const headers = { "content-type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(path, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error || `Request failed: ${res.status}`);
  }
  return json;
}

function setBusy(btn, busy) {
  btn.disabled = busy;
  if (busy) {
    btn.dataset.label = btn.textContent;
    btn.textContent = t("loading");
  } else {
    btn.textContent = btn.dataset.label || btn.textContent;
  }
}

function toLocalMetersSimple(origin, point) {
  const meanLatRad = ((origin.lat + point.lat) / 2) * Math.PI / 180;
  const metersPerDegLat = 111320;
  const metersPerDegLon = 111320 * Math.cos(meanLatRad);
  return {
    x: (point.lon - origin.lon) * metersPerDegLon,
    y: (point.lat - origin.lat) * metersPerDegLat,
  };
}

function describeRelativeSide(start, end, point) {
  if (!start || !end || !point) return null;
  const routeVec = toLocalMetersSimple(start, end);
  const pointVec = toLocalMetersSimple(start, point);
  const routeLen = Math.hypot(routeVec.x, routeVec.y);
  if (routeLen < 1) return null;

  const cross = routeVec.x * pointVec.y - routeVec.y * pointVec.x;
  const sideMeters = cross / routeLen;
  if (Math.abs(sideMeters) <= 6) return t("sideFront");
  return sideMeters > 0 ? t("sideLeft") : t("sideRight");
}

function buildIntersectionHeading(row, index) {
  const nameParts = String(row.name || "").split("×").map((part) => part.trim()).filter(Boolean);
  const crossStreet = row.crossStreets?.[0] || nameParts[1] || t("unnamedRoad");
  const primary = row.addressLabel || nameParts[0] || state.roadName || t("unknownRoad");
  return `${t("intersectionPrefix")} ${index + 1}: ${primary} × ${crossStreet}`;
}

function buildIntersectionDesc(row) {
  const direction = row.bearingToNext == null
    ? localizeDirectionLabel(row.directionToNext)
    : directionFromBearing(row.bearingToNext);
  return tf("intersectionTypeLine", {
    type: localizeIntersectionType(row.type),
    source: row.addressSource === "on-road" ? t("sourceOnRoad") : row.addressSource === "nearby" ? t("sourceNearby") : t("sourceNone"),
    direction,
    distance: row.distanceToNext ? `${Math.round(row.distanceToNext)} ${t("meters")}` : t("lastIntersection"),
  });
}

function directionFromBearing(bearing) {
  const dirs = ["dirN", "dirNE", "dirE", "dirSE", "dirS", "dirSW", "dirW", "dirNW"];
  const idx = Math.round((((Number(bearing) % 360) + 360) % 360) / 45) % 8;
  return t(dirs[idx]);
}

function localizeDirectionLabel(raw) {
  const map = {
    "北": "dirN",
    "東北": "dirNE",
    "東": "dirE",
    "東南": "dirSE",
    "南": "dirS",
    "西南": "dirSW",
    "西": "dirW",
    "西北": "dirNW",
  };
  const key = map[String(raw || "").trim()];
  return key ? t(key) : (raw || t("none"));
}

function localizeIntersectionType(rawType) {
  const map = {
    "十字或多向路口": "typeCross",
    "T 型路口": "typeT",
    "雙向連接點": "typeLink",
  };
  const key = map[String(rawType || "").trim()];
  return key ? t(key) : (rawType || t("unknown"));
}

function renderRouteList(container, titleText, places, start, end, isGoogle = false) {
  container.innerHTML = "";
  const section = document.createElement("div");
  section.className = "route-section";

  const title = document.createElement("div");
  title.className = "route-section-title";
  title.textContent = `${titleText}（${places.length}）`;
  section.appendChild(title);

  const lines = [];
  if (places.length > 0) {
    for (const p of places) {
      const side = describeRelativeSide(start, end, { lat: p.lat, lon: p.lon });
      const line = formatUnifiedRoutePlaceSummary(p, side, isGoogle);
      const item = document.createElement("div");
      item.className = "route-place-item";
      item.textContent = line;
      section.appendChild(item);
      lines.push(line);
    }
  } else {
    const empty = document.createElement("div");
    empty.className = "minor";
    empty.textContent = isGoogle ? t("noRouteGoogle") : t("noRouteOsm");
    section.appendChild(empty);
    lines.push(empty.textContent);
  }

  container.appendChild(section);
  return lines.join("\n");
}

function formatUnifiedRoutePlaceSummary(place, side, isGoogle = false) {
  const parts = [`${Math.round(place.sortMeters)}m：${place.title}`];
  const kind = isGoogle ? place.typeLabel : place.kindLabel;
  if (kind && kind !== place.title) {
    parts.push(kind);
  }
  if (place.addressLabel && place.addressLabel !== place.title) {
    parts.push(place.addressLabel);
  }
  if (side) {
    parts.push(side);
  }
  return `${parts.join("，")}。`;
}

function updateQuickNavStatus(text) {
  $("quickNavStatus").textContent = text;
}

function canUsePaidFeatures() {
  return Boolean(state.auth.signedIn && state.auth.approved);
}

function getPaidBlockedMessage() {
  if (!state.auth.signedIn) {
    return t("paidLoginRequired");
  }
  if (!state.auth.approved) {
    return t("paidApprovalRequired");
  }
  return "";
}

function refreshQuickStreetButtonState() {
  const btn = $("quickStreetBtn");
  if (!btn) return;

  const streetUsd = 2 * (PRICES.streetViewStatic + PRICES.geminiGenerate);
  btn.textContent = `${t("streetDetail")}（${formatUsd(streetUsd)}）`;

  const blocked = getPaidBlockedMessage();
  btn.disabled = Boolean(blocked) || !state.intersections.length;
  btn.title = blocked || "";
}

function angleDistance(a, b) {
  const delta = Math.abs((((a - b) % 360) + 540) % 360 - 180);
  return delta;
}

function findFocusedRoadIndex(intersections, focusPoint, preferredBearing) {
  if (!Array.isArray(intersections) || intersections.length === 0) {
    return 0;
  }

  const hasPreferredBearing = Number.isFinite(preferredBearing);

  let bestIndex = 0;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let i = 0; i < intersections.length; i += 1) {
    const row = intersections[i];
    const dx = row.lat - focusPoint.lat;
    const dy = row.lon - focusPoint.lon;
    const distanceScore = Math.hypot(dx, dy) * 100000;
    const bearingScore = !hasPreferredBearing || row.bearingToNext == null
      ? 0
      : angleDistance(row.bearingToNext, preferredBearing);
    const score = distanceScore * 4 + bearingScore;
    if (score < bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  return bestIndex;
}

async function updateQuickNavOsm(index) {
  const current = state.intersections[index];
  const next = state.intersections[index + 1];
  const panel = $("quickNavOsm");
  if (!current || !next) {
    panel.textContent = t("lastNoNextRoute");
    return;
  }

  const key = `quick-osm:${state.roadName}:${current.id}:${next.id}`;
  try {
    let data = state.queryCache.get(key);
    if (!data) {
      data = await postJson("/api/osm/route-places", {
        roadName: state.roadName,
        start: { lat: current.lat, lon: current.lon },
        end: { lat: next.lat, lon: next.lon },
      });
      state.queryCache.set(key, data);
    }
    const line = renderRouteList(panel, t("routeOsm"), Array.isArray(data.places) ? data.places : [], { lat: current.lat, lon: current.lon }, { lat: next.lat, lon: next.lon }, false);
    updateQuickNavStatus(`${buildIntersectionHeading(current, index)}\n${line}`);
  } catch (err) {
    panel.classList.add("error");
    panel.textContent = `${t("errorPrefix")}${err.message}`;
  }
}

function getRouteOsmCacheKeyByIndex(index) {
  const current = state.intersections[index];
  const next = state.intersections[index + 1] || null;
  if (!current || !next) {
    return null;
  }
  return {
    key: `route-osm:${state.roadName}:${current.id}:${next.id}`,
    current,
    next,
  };
}

async function warmupAdjacentOsmRoutePlaces(centerIndex, radius = 2) {
  const tasks = [];
  const startIdx = Math.max(0, centerIndex - radius);
  const endIdx = Math.min(state.intersections.length - 2, centerIndex + radius);

  for (let idx = startIdx; idx <= endIdx; idx += 1) {
    const entry = getRouteOsmCacheKeyByIndex(idx);
    if (!entry || state.queryCache.has(entry.key)) {
      continue;
    }
    tasks.push((async () => {
      try {
        const data = await postJson("/api/osm/route-places", {
          roadName: state.roadName,
          start: { lat: entry.current.lat, lon: entry.current.lon },
          end: { lat: entry.next.lat, lon: entry.next.lon },
        });
        state.queryCache.set(entry.key, data);
      } catch {
        // Best-effort background warmup.
      }
    })());
  }

  if (!tasks.length) {
    return;
  }

  await Promise.allSettled(tasks);
}

function refreshQuickStreetAdvanceButton() {
  const btn = $("quickStreetAdvanceBtn");
  if (!btn) return;

  const interval = getSampleInterval();
  if (!canUsePaidFeatures()) {
    btn.disabled = true;
    btn.textContent = tf("advanceBtn", { distance: interval });
    btn.title = getPaidBlockedMessage();
    return;
  }
  btn.title = "";

  if (!state.quickStreet.loaded) {
    btn.disabled = true;
    btn.textContent = tf("advanceBtn", { distance: interval });
    return;
  }

  if (state.quickStreet.maxDistance <= 0 || state.quickStreet.offset + interval > state.quickStreet.maxDistance) {
    btn.disabled = true;
    btn.textContent = t("intersectionEnded");
    return;
  }

  btn.disabled = false;
  btn.textContent = tf("advanceBtn", { distance: interval });
}

function resetQuickStreetPanel() {
  state.quickStreet.loaded = false;
  state.quickStreet.offset = 0;
  state.quickStreet.maxDistance = 0;
  state.quickStreet.lat = 0;
  state.quickStreet.lon = 0;
  state.quickStreet.heading = 0;

  const panel = $("quickNavStreet");
  if (panel) {
    panel.classList.remove("error");
    panel.textContent = "";
  }
  refreshQuickStreetAdvanceButton();
}

async function runQuickStreetDetail() {
  const row = state.intersections[state.focusedIndex];
  const panel = $("quickNavStreet");
  if (!row || !panel) return;

  const blocked = getPaidBlockedMessage();
  if (blocked) {
    panel.classList.add("error");
    panel.textContent = blocked;
    return;
  }

  panel.classList.remove("error");
  panel.textContent = t("queryLoading");

  const heading = row.bearingToNext ?? 0;
  const key = `quick-street:${state.roadName}:${row.id}:${heading}:${state.uiLang}`;

  try {
    let data = state.queryCache.get(key);
    if (!data) {
      data = await postJson("/api/paid/streetview", {
        userConfirmedPaidCall: true,
        lat: row.lat,
        lon: row.lon,
        heading,
        fov: 90,
        pitch: 0,
        language: getMapLanguage(),
      });
      state.queryCache.set(key, data);
    }

    panel.textContent = extractStreetBlocks(data.text);
    state.quickStreet.loaded = true;
    state.quickStreet.offset = 0;
    state.quickStreet.maxDistance = Number(row.distanceToNext) || 0;
    state.quickStreet.lat = row.lat;
    state.quickStreet.lon = row.lon;
    state.quickStreet.heading = heading;
    refreshQuickStreetAdvanceButton();
  } catch (err) {
    panel.classList.add("error");
    panel.textContent = `${t("errorPrefix")}${err.message}`;
    state.quickStreet.loaded = false;
    state.quickStreet.offset = 0;
    state.quickStreet.maxDistance = 0;
    state.quickStreet.lat = 0;
    state.quickStreet.lon = 0;
    state.quickStreet.heading = 0;
    refreshQuickStreetAdvanceButton();
  }
}

async function runQuickStreetAdvance() {
  const blocked = getPaidBlockedMessage();
  if (blocked) {
    const panel = $("quickNavStreet");
    if (panel) {
      panel.classList.add("error");
      panel.textContent = blocked;
    }
    return;
  }

  if (!state.quickStreet.loaded) return;
  const panel = $("quickNavStreet");
  if (!panel) return;

  const interval = getSampleInterval();
  const nextOffset = state.quickStreet.offset + interval;
  if (nextOffset > state.quickStreet.maxDistance) {
    refreshQuickStreetAdvanceButton();
    return;
  }

  const nextPoint = destinationPoint(
    state.quickStreet.lat,
    state.quickStreet.lon,
    state.quickStreet.heading,
    nextOffset,
  );
  const key = `quick-street-adv:${state.roadName}:${state.focusedIndex}:${nextOffset}:${state.uiLang}`;

  const advanceBtn = $("quickStreetAdvanceBtn");
  if (advanceBtn) advanceBtn.disabled = true;

  try {
    let data = state.queryCache.get(key);
    if (!data) {
      data = await postJson("/api/paid/streetview", {
        userConfirmedPaidCall: true,
        lat: nextPoint.lat,
        lon: nextPoint.lon,
        heading: state.quickStreet.heading,
        fov: 90,
        pitch: 0,
        language: getMapLanguage(),
      });
      state.queryCache.set(key, data);
    }

    const section = [
      tf("advanceSectionLabel", { distance: nextOffset }),
      extractStreetBlocks(data.text),
    ].join("\n");
    panel.textContent = panel.textContent ? `${panel.textContent}\n\n${section}` : section;

    state.quickStreet.offset = nextOffset;
    refreshQuickStreetAdvanceButton();
  } catch (err) {
    panel.classList.add("error");
    panel.textContent = `${panel.textContent}\n${t("errorPrefix")}${err.message}`.trim();
    refreshQuickStreetAdvanceButton();
  }
}

function focusIntersection(index, scrollIntoView = true, focusCard = true) {
  if (!state.intersections.length) return;
  const nextIndex = Math.max(0, Math.min(state.intersections.length - 1, index));
  state.focusedIndex = nextIndex;

  const card = document.getElementById(`intersection-${nextIndex}`);
  if (card) {
    if (focusCard) {
      card.focus();
    }
    if (scrollIntoView) {
      card.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  updateQuickNavStatus(buildIntersectionHeading(state.intersections[nextIndex], nextIndex));
  resetQuickStreetPanel();
  void updateQuickNavOsm(nextIndex);
  void warmupAdjacentOsmRoutePlaces(nextIndex, 2);
}

async function loadRoadByName(roadName, options = {}) {
  const btn = $("loadRoadBtn");
  setBusy(btn, true);
  try {
    if (!roadName) {
      throw new Error(t("enterRoadFirst"));
    }

    const countryCode = getCountryCode();
    let geocodeNotice = "";
    let resolvedRoadName = roadName;
    let geocodeFocusPoint = null;

    try {
      const geo = await postJson("/api/geocode/autobbox", { query: roadName, countryCode });
      const lat = Number(geo.lat);
      const lon = Number(geo.lon);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        geocodeFocusPoint = { lat, lon };
      }
      if (String(geo.roadName || "").trim()) {
        resolvedRoadName = String(geo.roadName).trim();
      }
      geocodeNotice = tf("geocodeOk", { name: geo.displayName || roadName, country: countryCode });
    } catch (geoErr) {
      geocodeNotice = tf("geocodeFail", { country: countryCode, message: geoErr.message });
    }

    const data = await postJson("/api/overpass/segment", { roadName: resolvedRoadName, countryCode });
    state.searchAttempted = true;
    state.roadName = data.roadName || roadName;
    state.intersections = data.intersections || [];
    state.queryCache.clear();
    resetQuickStreetPanel();
    state.focusedIndex = 0;
    state.lastSearchWarning = data.warning || "";

    const summary = [
      `${data.roadName} ${t("loadingDone")}`,
      tf("searchDoneSummary", { count: data.intersections.length, meters: Math.round(data.totalLengthMeters || 0), unit: t("meters") }),
    ];

    if (options.extraNotice) summary.push(options.extraNotice);
    if (data.warning) summary.push(`${t("warningPrefix")}${data.warning}`);
    if (geocodeNotice) summary.push(geocodeNotice);
    summary.push(tf("countrySummary", { country: countryCode }));

    $("roadSummary").classList.remove("error");
    $("roadSummary").classList.toggle("warning", Boolean(data.warning));
    $("roadSummary").textContent = summary.join("\n");

    renderIntersections();
    void warmupIntersectionAddresses(8);
    if (state.intersections.length > 0) {
      const focusPoint = options.focusPoint || geocodeFocusPoint;
      const focusIndex = focusPoint
        ? findFocusedRoadIndex(state.intersections, focusPoint, options.preferredBearing)
        : 0;
      focusIntersection(focusIndex, true, options.focusCard !== false);
    }
  } catch (err) {
    $("roadSummary").classList.remove("warning");
    $("roadSummary").classList.add("error");
    $("roadSummary").textContent = `${t("errorPrefix")}${err.message}`;
    state.searchAttempted = true;
    state.lastSearchWarning = tf("searchFailed", { message: err.message });
    state.intersections = [];
    renderIntersections();
  } finally {
    setBusy(btn, false);
  }
}

function destinationPoint(lat, lon, bearingDeg, distMeters) {
  const R = 6371000;
  const δ = distMeters / R;
  const θ = (bearingDeg * Math.PI) / 180;
  const φ1 = (lat * Math.PI) / 180;
  const λ1 = (lon * Math.PI) / 180;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return { lat: (φ2 * 180) / Math.PI, lon: (λ2 * 180) / Math.PI };
}

function extractStreetBlocks(text) {
  const idx = String(text || "").indexOf("\n\n");
  return idx >= 0 ? text.slice(idx + 2).trim() : String(text || "").trim();
}

function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation unavailable"));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 5000,
    });
  });
}

async function loadRoadFromCurrentLocation() {
  const btn = $("useGpsBtn");
  setBusy(btn, true);
  $("roadSummary").classList.remove("error", "warning");
  $("roadSummary").textContent = t("gpsLocating");
  try {
    const position = await getCurrentPosition();
    const lat = Number(position.coords.latitude);
    const lon = Number(position.coords.longitude);
    const heading = Number(position.coords.heading);
    const reverse = await postJson("/api/geocode/reverse-road", { lat, lon });
    const resolvedRoadName = String(reverse.roadName || "").trim();
    if (!resolvedRoadName) {
      throw new Error("No road name found for current location");
    }

    $("roadName").value = reverse.displayName || resolvedRoadName;
    await loadRoadByName(resolvedRoadName, {
      focusPoint: { lat, lon },
      preferredBearing: Number.isFinite(heading) ? heading : undefined,
      focusCard: false,
      extraNotice: tf("gpsResolved", { name: reverse.displayName || resolvedRoadName }),
    });
  } catch (err) {
    $("roadSummary").classList.remove("warning");
    $("roadSummary").classList.add("error");
    $("roadSummary").textContent = tf("gpsFailed", { message: err.message || String(err) });
  } finally {
    setBusy(btn, false);
  }
}

function normalizeBearing(value) {
  return ((Number(value) % 360) + 360) % 360;
}

function normalizeRoadTitle(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function chooseContinuationTurn(index, direction) {
  const row = state.intersections[index];
  if (!row) return null;

  const allCandidates = [row.leftTurn, row.rightTurn].filter((it) => it && it.roadName && Number.isFinite(it.bearing));
  if (!allCandidates.length) return null;

  const currentRoad = normalizeRoadTitle(state.roadName);
  const candidates = allCandidates.filter((it) => normalizeRoadTitle(it.roadName) !== currentRoad);
  const usable = candidates.length ? candidates : allCandidates;

  const currentBearing = Number.isFinite(row.bearingToNext)
    ? Number(row.bearingToNext)
    : (index > 0 && Number.isFinite(state.intersections[index - 1]?.bearingToNext)
        ? Number(state.intersections[index - 1].bearingToNext)
        : Number.NaN);

  if (!Number.isFinite(currentBearing)) {
    return usable[0] || null;
  }

  const targetBearing = direction === "backward"
    ? normalizeBearing(currentBearing + 180)
    : normalizeBearing(currentBearing);

  let best = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const candidate of usable) {
    const delta = angleDistance(Number(candidate.bearing), targetBearing);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = candidate;
    }
  }
  return best;
}

async function jumpToConnectedStreet(index, direction, options = {}) {
  const row = state.intersections[index];
  if (!row) return;

  const turnCandidate = chooseContinuationTurn(index, direction);
  if (!turnCandidate) {
    updateQuickNavStatus(direction === "forward" ? t("noNextStreet") : t("noPrevStreet"));
    return;
  }

  const turnDirection = Number.isFinite(turnCandidate.bearing)
    ? directionFromBearing(turnCandidate.bearing)
    : localizeDirectionLabel(turnCandidate.direction);

  updateQuickNavStatus(
    `${buildIntersectionHeading(row, index)}\n${direction === "forward" ? t("nextIntersection") : t("prevIntersection")}：${turnCandidate.roadName} (${turnDirection})`,
  );

  await loadRoadByName(turnCandidate.roadName, {
    focusPoint: { lat: row.lat, lon: row.lon },
    preferredBearing: turnCandidate.bearing,
    focusCard: options.focusCard !== false,
  });
}

async function turnAtIntersection(row, index, side, options = {}) {
  const turnCandidate = side === "left" ? row?.leftTurn : row?.rightTurn;
  if (!row || !turnCandidate) {
    updateQuickNavStatus(side === "left" ? t("noLeftTurn") : t("noRightTurn"));
    return;
  }

  const turnDirection = Number.isFinite(turnCandidate.bearing)
    ? directionFromBearing(turnCandidate.bearing)
    : localizeDirectionLabel(turnCandidate.direction);
  updateQuickNavStatus(`${buildIntersectionHeading(row, index)}\n${side === "left" ? t("leftTurn") : t("rightTurn")}：${turnCandidate.roadName} (${turnDirection})`);

  await loadRoadByName(turnCandidate.roadName, {
    focusPoint: { lat: row.lat, lon: row.lon },
    preferredBearing: turnCandidate.bearing,
    focusCard: options.focusCard !== false,
  });
}

function createCard(row, index, total) {
  const card = document.createElement("section");
  card.className = "intersection-card";
  card.id = `intersection-${index}`;
  card.tabIndex = -1;

  const heading = document.createElement("h3");
  heading.textContent = buildIntersectionHeading(row, index);
  card.appendChild(heading);

  const desc = document.createElement("p");
  desc.className = "minor";
  desc.textContent = buildIntersectionDesc(row);
  card.appendChild(desc);

  const actions = document.createElement("div");
  actions.className = "actions-row";

  const leftBtn = document.createElement("button");
  leftBtn.textContent = t("leftTurn");
  const rightBtn = document.createElement("button");
  rightBtn.textContent = t("rightTurn");
  const prevBtn = document.createElement("button");
  prevBtn.textContent = t("prevIntersection");
  const nextBtn = document.createElement("button");
  nextBtn.textContent = t("nextIntersection");

  if (index === 0) {
    actions.appendChild(prevBtn);
  }
  if (row.leftTurn) {
    actions.appendChild(leftBtn);
  }
  if (index === total - 1) {
    actions.appendChild(nextBtn);
  }
  if (row.rightTurn) {
    actions.appendChild(rightBtn);
  }
  card.appendChild(actions);

  const interval = getSampleInterval();
  const sampleCount = row.distanceToNext ? Math.max(1, Math.ceil(row.distanceToNext / interval)) : 0;
  const streetUsd = 2 * (PRICES.streetViewStatic + PRICES.geminiGenerate);
  const googleRouteUsd = sampleCount * PRICES.placesNearby;

  const routeOsmDetails = document.createElement("details");
  routeOsmDetails.className = "query-details";
  const routeOsmSummary = document.createElement("summary");
  routeOsmSummary.className = "query-summary";
  routeOsmSummary.textContent = t("routeOsm");
  routeOsmDetails.appendChild(routeOsmSummary);
  const routeOsmResult = document.createElement("div");
  routeOsmResult.className = "result";
  routeOsmDetails.appendChild(routeOsmResult);
  card.appendChild(routeOsmDetails);

  const routeGoogleDetails = document.createElement("details");
  routeGoogleDetails.className = "query-details";
  const routeGoogleSummary = document.createElement("summary");
  routeGoogleSummary.className = "query-summary paid-summary";
  routeGoogleSummary.textContent = `${t("routeGoogle")}（約 ${sampleCount} 次，${formatUsd(googleRouteUsd)}）`;
  routeGoogleDetails.appendChild(routeGoogleSummary);
  const routeGoogleResult = document.createElement("div");
  routeGoogleResult.className = "result";
  routeGoogleDetails.appendChild(routeGoogleResult);
  card.appendChild(routeGoogleDetails);

  const streetDetails = document.createElement("details");
  streetDetails.className = "query-details";
  const streetSummary = document.createElement("summary");
  streetSummary.className = "query-summary paid-summary";
  streetSummary.textContent = `${t("streetDetail")}（${formatUsd(streetUsd)}）`;
  streetDetails.appendChild(streetSummary);
  const streetResult = document.createElement("div");
  streetResult.className = "result";
  streetDetails.appendChild(streetResult);
  card.appendChild(streetDetails);

  let streetLoading = false;
  let routeOsmLoading = false;
  let routeGoogleLoading = false;

  const next = state.intersections[index + 1] || null;
  const routeOsmCacheKey = next
    ? `route-osm:${state.roadName}:${row.id}:${next.id}`
    : `route-osm:${state.roadName}:${row.id}:last`;
  const routeGoogleCacheKey = `route-google:${state.roadName}:${row.id}:${next?.id || "last"}:${state.uiLang}`;
  const streetCacheKey = `street:${state.roadName}:${row.id}:${row.bearingToNext ?? 0}:${state.uiLang}`;

  async function runStreetQuery() {
    if (streetLoading || !streetDetails.open) return;
    const blocked = getPaidBlockedMessage();
    if (blocked) {
      streetResult.classList.add("error");
      streetResult.textContent = blocked;
      return;
    }
    streetLoading = true;
    streetResult.classList.remove("error");
    streetResult.textContent = t("queryLoading");
    try {
      let data = state.queryCache.get(streetCacheKey);
      if (!data) {
        data = await postJson("/api/paid/streetview", {
          userConfirmedPaidCall: true,
          lat: row.lat,
          lon: row.lon,
          heading: row.bearingToNext ?? 0,
          fov: 90,
          pitch: 0,
          language: getMapLanguage(),
        });
        state.queryCache.set(streetCacheKey, data);
      }

      streetResult.innerHTML = "";
      const initSection = document.createElement("div");
      initSection.className = "street-section";
      const initBlocks = extractStreetBlocks(data.text);
      initSection.textContent = initBlocks;
      streetResult.appendChild(initSection);

      const distToNext = Number(row.distanceToNext) || 0;
      let advanceOffset = 0;

      const advanceBtn = document.createElement("button");
      advanceBtn.className = "advance-btn";
      streetResult.appendChild(advanceBtn);

      function refreshAdvanceBtn() {
        const iv = getSampleInterval();
        if (distToNext > 0 && advanceOffset + iv > distToNext) {
          advanceBtn.disabled = true;
          advanceBtn.textContent = t("intersectionEnded");
        } else {
          advanceBtn.disabled = false;
          advanceBtn.textContent = tf("advanceBtn", { distance: iv });
        }
      }

      if (distToNext <= 0) {
        advanceBtn.disabled = true;
        advanceBtn.textContent = t("intersectionEnded");
      } else {
        refreshAdvanceBtn();
      }

      advanceBtn.addEventListener("click", async () => {
        const iv = getSampleInterval();
        advanceOffset += iv;
        advanceBtn.disabled = true;
        const newPos = destinationPoint(row.lat, row.lon, row.bearingToNext ?? 0, advanceOffset);
        const advCacheKey = `street-adv:${state.roadName}:${row.id}:${advanceOffset}:${state.uiLang}`;
        try {
          let advData = state.queryCache.get(advCacheKey);
          if (!advData) {
            advData = await postJson("/api/paid/streetview", {
              userConfirmedPaidCall: true,
              lat: newPos.lat,
              lon: newPos.lon,
              heading: row.bearingToNext ?? 0,
              fov: 90,
              pitch: 0,
              language: getMapLanguage(),
            });
            state.queryCache.set(advCacheKey, advData);
          }
          const advSection = document.createElement("div");
          advSection.className = "street-section";
          const advLabel = document.createElement("div");
          advLabel.className = "street-advance-label";
          advLabel.textContent = tf("advanceSectionLabel", { distance: advanceOffset });
          advSection.appendChild(advLabel);
          const advContent = document.createElement("div");
          advContent.textContent = extractStreetBlocks(advData.text);
          advSection.appendChild(advContent);
          streetResult.insertBefore(advSection, advanceBtn);
          advSection.scrollIntoView({ behavior: "smooth", block: "nearest" });
          refreshAdvanceBtn();
        } catch (err) {
          advanceOffset -= iv;
          const errDiv = document.createElement("div");
          errDiv.className = "error";
          errDiv.textContent = `${t("errorPrefix")}${err.message}`;
          streetResult.insertBefore(errDiv, advanceBtn);
          refreshAdvanceBtn();
        }
      });

      state.focusedIndex = index;
    } catch (err) {
      streetResult.classList.add("error");
      streetResult.textContent = `${t("errorPrefix")}${err.message}`;
    } finally {
      streetLoading = false;
    }
  }

  async function runRouteOsmQuery() {
    if (routeOsmLoading || !routeOsmDetails.open) return;
    routeOsmLoading = true;
    routeOsmResult.classList.remove("error");
    routeOsmResult.textContent = t("queryLoading");
    try {
      if (!next) {
        routeOsmResult.textContent = t("noNextSegment");
        return;
      }
      let data = state.queryCache.get(routeOsmCacheKey);
      if (!data) {
        data = await postJson("/api/osm/route-places", {
          roadName: state.roadName,
          start: { lat: row.lat, lon: row.lon },
          end: { lat: next.lat, lon: next.lon },
        });
        state.queryCache.set(routeOsmCacheKey, data);
      }
      renderRouteList(routeOsmResult, t("routeOsm"), Array.isArray(data.places) ? data.places : [], { lat: row.lat, lon: row.lon }, { lat: next.lat, lon: next.lon }, false);
      state.focusedIndex = index;
      await updateQuickNavOsm(index);
    } catch (err) {
      routeOsmResult.classList.add("error");
      routeOsmResult.textContent = `${t("errorPrefix")}${err.message}`;
    } finally {
      routeOsmLoading = false;
    }
  }

  async function runRouteGoogleQuery() {
    if (routeGoogleLoading || !routeGoogleDetails.open) return;
    const blocked = getPaidBlockedMessage();
    if (blocked) {
      routeGoogleResult.classList.add("error");
      routeGoogleResult.textContent = blocked;
      return;
    }
    routeGoogleLoading = true;
    routeGoogleResult.classList.remove("error");
    routeGoogleResult.textContent = t("queryLoading");
    try {
      if (!next) {
        routeGoogleResult.textContent = t("noNextSegment");
        return;
      }
      let data = state.queryCache.get(routeGoogleCacheKey);
      if (!data) {
        data = await postJson("/api/google/route-places", {
          userConfirmedPaidCall: true,
          roadName: state.roadName,
          start: { lat: row.lat, lon: row.lon },
          end: { lat: next.lat, lon: next.lon },
          language: getMapLanguage(),
        });
        state.queryCache.set(routeGoogleCacheKey, data);
      }
      renderRouteList(routeGoogleResult, t("routeGoogle"), Array.isArray(data.places) ? data.places : [], { lat: row.lat, lon: row.lon }, { lat: next.lat, lon: next.lon }, true);
      state.focusedIndex = index;
    } catch (err) {
      routeGoogleResult.classList.add("error");
      routeGoogleResult.textContent = `${t("errorPrefix")}${err.message}`;
    } finally {
      routeGoogleLoading = false;
    }
  }

  prevBtn.addEventListener("click", () => {
    void jumpToConnectedStreet(index, "backward");
  });

  nextBtn.addEventListener("click", () => {
    void jumpToConnectedStreet(index, "forward");
  });

  if (row.leftTurn) {
    leftBtn.addEventListener("click", () => void turnAtIntersection(row, index, "left"));
  }
  if (row.rightTurn) {
    rightBtn.addEventListener("click", () => void turnAtIntersection(row, index, "right"));
  }

  streetDetails.addEventListener("toggle", () => {
    if (streetDetails.open) void runStreetQuery();
  });
  routeOsmDetails.addEventListener("toggle", () => {
    if (routeOsmDetails.open) void runRouteOsmQuery();
  });
  routeGoogleDetails.addEventListener("toggle", () => {
    if (routeGoogleDetails.open) void runRouteGoogleQuery();
  });

  return card;
}

function renderIntersections() {
  const container = $("intersections");
  container.innerHTML = "";

  if (!state.intersections.length) {
    container.textContent = !state.searchAttempted ? t("noIntersectionsBefore") : (state.lastSearchWarning || t("noIntersectionsAfter"));
    $("quickNavOsm").textContent = "";
    refreshQuickStreetButtonState();
    refreshQuickStreetAdvanceButton();
    return;
  }

  state.intersections.forEach((row, index) => {
    container.appendChild(createCard(row, index, state.intersections.length));
  });

  renderCosts();
  refreshQuickStreetButtonState();
  refreshQuickStreetAdvanceButton();
}

async function warmupIntersectionAddresses(maxItems = 8) {
  const points = state.intersections
    .map((row, idx) => ({ idx, id: row.id, lat: row.lat, lon: row.lon, hasAddress: Boolean(row.addressLabel) }))
    .filter((row) => !row.hasAddress)
    .slice(0, Math.max(1, Math.min(20, maxItems)))
    .map(({ idx, id, lat, lon }) => ({ idx, id, lat, lon }));

  if (!points.length) return;

  try {
    const data = await postJson("/api/intersections/address-batch", {
      roadName: state.roadName,
      maxItems,
      points,
    });

    const rows = Array.isArray(data.rows) ? data.rows : [];
    for (const item of rows) {
      const idx = Number(item.idx);
      if (!Number.isFinite(idx) || idx < 0 || idx >= state.intersections.length) continue;
      state.intersections[idx].addressLabel = item.addressLabel || null;
      state.intersections[idx].addressSource = item.addressSource || null;
      const card = document.getElementById(`intersection-${idx}`);
      if (!card) continue;
      const h3 = card.querySelector("h3");
      const p = card.querySelector("p.minor");
      if (h3) h3.textContent = buildIntersectionHeading(state.intersections[idx], idx);
      if (p) p.textContent = buildIntersectionDesc(state.intersections[idx]);
    }
  } catch {
    // Best effort warmup.
  }
}

$("loadRoadBtn").addEventListener("click", () => {
  const roadName = $("roadName").value.trim();
  void loadRoadByName(roadName);
});

$("useGpsBtn").addEventListener("click", () => {
  void loadRoadFromCurrentLocation();
});

$("roadName").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    const roadName = $("roadName").value.trim();
    void loadRoadByName(roadName);
  }
});

$("uiLang").addEventListener("change", () => {
  state.uiLang = String($("uiLang").value || "zh-Hant");
  setStaticTexts();
  initCountryOptions();
  renderIntersections();
  if (state.intersections.length > 0) {
    focusIntersection(state.focusedIndex, false, false);
  }
});

$("sampleInterval").addEventListener("change", () => {
  renderCosts();
  refreshQuickStreetAdvanceButton();
});

$("navForwardBtn").addEventListener("click", () => {
  if (!state.intersections.length) return;
  if (state.focusedIndex >= state.intersections.length - 1) {
    void jumpToConnectedStreet(state.focusedIndex, "forward", { focusCard: false });
    return;
  }
  focusIntersection(state.focusedIndex + 1, true, false);
});

$("navBackBtn").addEventListener("click", () => {
  if (!state.intersections.length) return;
  if (state.focusedIndex <= 0) {
    void jumpToConnectedStreet(state.focusedIndex, "backward", { focusCard: false });
    return;
  }
  focusIntersection(state.focusedIndex - 1, true, false);
});

$("navLeftBtn").addEventListener("click", () => {
  const row = state.intersections[state.focusedIndex];
  if (!row) return;
  void turnAtIntersection(row, state.focusedIndex, "left", { focusCard: false });
});

$("navRightBtn").addEventListener("click", () => {
  const row = state.intersections[state.focusedIndex];
  if (!row) return;
  void turnAtIntersection(row, state.focusedIndex, "right", { focusCard: false });
});

$("quickStreetBtn").addEventListener("click", () => {
  void runQuickStreetDetail();
});

$("quickStreetAdvanceBtn").addEventListener("click", () => {
  void runQuickStreetAdvance();
});

$("quickNav").addEventListener("keydown", (event) => {
  const key = event.key;
  if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(key)) return;
  event.preventDefault();
  if (key === "ArrowUp") $("navForwardBtn").click();
  if (key === "ArrowDown") $("navBackBtn").click();
  if (key === "ArrowLeft") $("navLeftBtn").click();
  if (key === "ArrowRight") $("navRightBtn").click();
});

state.uiLang = String($("uiLang").value || "zh-Hant");
setStaticTexts();
initCountryOptions();
renderIntersections();
refreshQuickStreetButtonState();
refreshQuickStreetAdvanceButton();

// ── Debug helper ────────────────────────────────────────────────────────
function dbg(_msg) {
  // Debug panel/logging disabled in production UI.
}

const CLERK_SDK_URLS = [
  "https://cdn.jsdelivr.net/npm/@clerk/clerk-js@4/dist/clerk.browser.js",
  "https://unpkg.com/@clerk/clerk-js@4/dist/clerk.browser.js",
];

let clerkScriptLoadPromise = null;

function loadScriptTag(url) {
  return new Promise((resolve, reject) => {
    const tag = document.createElement("script");
    tag.src = url;
    tag.crossOrigin = "anonymous";
    tag.setAttribute("data-clerk-publishable-key", CLERK_PUBLISHABLE_KEY);
    tag.async = true;
    tag.onload = () => resolve();
    tag.onerror = () => reject(new Error(`script load failed: ${url}`));
    document.head.appendChild(tag);
  });
}

async function ensureClerkSdkReady() {
  if (window.Clerk) return true;
  if (clerkScriptLoadPromise) return clerkScriptLoadPromise;

  clerkScriptLoadPromise = (async () => {
    const existing = document.querySelector('script[src*="clerk"]');
    if (existing) {
      await new Promise((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve();
        };
        existing.addEventListener("load", finish, { once: true });
        existing.addEventListener("error", finish, { once: true });
        setTimeout(finish, 1200);
      });
      if (window.Clerk) {
        dbg("Clerk SDK became available from existing script");
        return true;
      }
    }

    for (const url of CLERK_SDK_URLS) {
      try {
        dbg("loading Clerk SDK from: " + url);
        await loadScriptTag(url);
        if (window.Clerk) {
          dbg("Clerk SDK loaded OK from: " + url);
          return true;
        }
      } catch (e) {
        dbg("Clerk SDK load failed from: " + url + " msg=" + (e?.message || String(e)));
      }
    }

    return Boolean(window.Clerk);
  })();

  const ok = await clerkScriptLoadPromise;
  if (!ok) clerkScriptLoadPromise = null;
  return ok;
}

// ── Clerk auth initialization ─────────────────────────────────────────────
async function initClerk() {
  const sdkReady = await ensureClerkSdkReady();
  dbg("initClerk: sdkReady=" + sdkReady);
  const clerkRef = window.Clerk;
  dbg("initClerk: typeof=" + typeof clerkRef + " hasOpenSignIn=" + (typeof clerkRef?.openSignIn));
  if (!clerkRef) {
    dbg("no Clerk global → updateAuthState");
    void updateAuthState();
    return;
  }
  try {
    let clerk = null;
    if (typeof clerkRef === "function") {
      dbg("initClerk: constructor mode");
      clerk = new clerkRef(CLERK_PUBLISHABLE_KEY);
      await clerk.load();
      window.Clerk = clerk;
    } else if (typeof clerkRef === "object" && typeof clerkRef.load === "function") {
      dbg("initClerk: singleton mode");
      await clerkRef.load({ publishableKey: CLERK_PUBLISHABLE_KEY });
      clerk = clerkRef;
    }

    if (!clerk) {
      dbg("initClerk: unsupported Clerk shape");
      void updateAuthState();
      return;
    }

    dbg("clerk.load() OK user=" + (clerk.user?.id || "none"));
    clerkSession = clerk.session || null;

    clerk.addListener?.(({ session }) => {
      clerkSession = session || null;
      void updateAuthState();
    });

    void updateAuthState();
  } catch (e) {
    dbg("Clerk init ERROR: " + (e?.message || String(e)));
    console.warn("Clerk init failed:", e);
    void updateAuthState();
  }
}

async function updateAuthState() {
  const authBar = document.getElementById("auth-bar");
  const mainContent = document.getElementById("main-content");
  const pendingMsg = document.getElementById("pending-msg");
  const myBilling = document.getElementById("my-billing");
  if (!authBar || !mainContent || !pendingMsg) return;

  mainContent.style.display = "";

  if (!window.Clerk?.user) {
    state.auth.signedIn = false;
    state.auth.approved = false;
    state.auth.email = "";
    pendingMsg.style.display = "";
    pendingMsg.textContent = t("guestFreeNotice");
    if (myBilling) myBilling.style.display = "none";
    authBar.innerHTML = `<button id="signInBtn" style="padding:8px 18px;font-size:1rem;cursor:pointer;">登入 Sign In</button>`;
    document.getElementById("signInBtn")?.addEventListener("click", async () => {
      dbg("CLICK: typeof Clerk=" + typeof window.Clerk + " openSignIn=" + (typeof window.Clerk?.openSignIn));
      if (typeof window.Clerk?.redirectToSignIn === "function") {
        dbg("calling redirectToSignIn()");
        try {
          await window.Clerk.redirectToSignIn({
            returnBackUrl: window.location.href,
          });
        } catch (e) {
          dbg("redirectToSignIn ERROR: " + e?.message);
        }
      } else if (typeof window.Clerk?.openSignIn === "function") {
        dbg("calling openSignIn()");
        try { window.Clerk.openSignIn(); } catch(e) { dbg("openSignIn ERROR: " + e?.message); }
      } else {
        dbg("Clerk not ready, calling initClerk()");
        await initClerk();
        dbg("after initClerk: redirectToSignIn=" + (typeof window.Clerk?.redirectToSignIn) + " openSignIn=" + (typeof window.Clerk?.openSignIn));
        try {
          if (typeof window.Clerk?.redirectToSignIn === "function") {
            await window.Clerk.redirectToSignIn({ returnBackUrl: window.location.href });
          } else {
            window.Clerk?.openSignIn?.();
          }
        } catch(e) {
          dbg("signIn fallback ERROR: " + e?.message);
        }
      }
    });
    renderIntersections();
    refreshQuickStreetButtonState();
    refreshQuickStreetAdvanceButton();
    return;
  }

  // Signed in — check approval
  try {
    const token = await getClerkToken();
    const res = await fetch("/api/me", {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const data = await res.json().catch(() => ({}));
    const email = data.email || window.Clerk.user?.primaryEmailAddress?.emailAddress || "";
    state.auth.signedIn = true;
    state.auth.approved = data.approved === true;
    state.auth.email = email;

    authBar.innerHTML = `<span style="font-size:0.9rem;">${email}</span>&nbsp;<button id="signOutBtn" style="padding:4px 12px;cursor:pointer;">登出 Sign Out</button>`;
    document.getElementById("signOutBtn")?.addEventListener("click", () => {
      void window.Clerk.signOut();
    });

    if (data.approved) {
      pendingMsg.style.display = "none";
      if (myBilling) {
        try {
          const billRes = await fetch("/api/billing/summary", {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          const billData = await billRes.json().catch(() => ({}));
          if (billRes.ok && billData?.totals) {
            const totals = billData.totals || {};
            const byProvider = Array.isArray(billData.byProvider) ? billData.byProvider : [];
            myBilling.style.display = "";
            myBilling.innerHTML = `
              <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                <button id="billingDetailBtn" style="padding:4px 10px;cursor:pointer;">顯示費用明細</button>
              </div>
              <div id="billingDetailPanel" style="display:none;margin-top:8px;border-top:1px solid #e2e8f0;padding-top:8px;"></div>
            `;
            const detailBtn = document.getElementById("billingDetailBtn");
            const detailPanel = document.getElementById("billingDetailPanel");
            if (detailPanel) {
              const summaryHtml = `<div style="margin-bottom:8px;">我的實際累計費用：$${Number(totals.actualUsd || 0).toFixed(4)}（事件 ${Number(totals.events || 0)}）</div>`;
              if (byProvider.length === 0) {
                detailPanel.innerHTML = `${summaryHtml}<div>目前沒有可顯示的費用明細。</div>`;
              } else {
                const rows = byProvider
                  .map((p) => {
                    const provider = String(p.provider || "unknown");
                    const events = Number(p.events || 0);
                    const actualUsd = Number(p.actual || 0).toFixed(4);
                    return `<tr><td style="padding:4px 0;">${provider}</td><td style="padding:4px 0;text-align:right;">${events}</td><td style="padding:4px 0;text-align:right;">$${actualUsd}</td></tr>`;
                  })
                  .join("");
                detailPanel.innerHTML = `
                  ${summaryHtml}
                  <table style="width:100%;font-size:0.88rem;border-collapse:collapse;">
                    <thead>
                      <tr><th style="text-align:left;padding:4px 0;">服務</th><th style="text-align:right;padding:4px 0;">事件</th><th style="text-align:right;padding:4px 0;">實際費用</th></tr>
                    </thead>
                    <tbody>${rows}</tbody>
                  </table>
                `;
              }
            }
            detailBtn?.addEventListener("click", () => {
              if (!detailPanel) return;
              const open = detailPanel.style.display !== "none";
              detailPanel.style.display = open ? "none" : "";
              detailBtn.textContent = open ? "顯示費用明細" : "隱藏費用明細";
            });
          } else {
            myBilling.style.display = "none";
          }
        } catch {
          myBilling.style.display = "none";
        }
      }
    } else {
      pendingMsg.style.display = "";
      if (myBilling) myBilling.style.display = "none";
      pendingMsg.textContent = tf("pendingApprovalNotice", { email });
    }

    renderIntersections();
    refreshQuickStreetButtonState();
    refreshQuickStreetAdvanceButton();
  } catch {
    state.auth.signedIn = false;
    state.auth.approved = false;
    state.auth.email = "";
    mainContent.style.display = "";
    pendingMsg.style.display = "";
    pendingMsg.textContent = t("guestFreeNotice");
    renderIntersections();
    refreshQuickStreetButtonState();
    refreshQuickStreetAdvanceButton();
  }
}

(function startClerkInit() {
  dbg("startClerkInit: typeof Clerk=" + typeof window.Clerk);
  void updateAuthState();
  void initClerk();
})();
