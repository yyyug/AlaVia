const PRICES = {
  placesNearby: 0.005,
  streetViewStatic: 0.007,
  llmGenerate: 0.0003,
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
    // Indoor node-based navigation
    navigationMode: "outdoor-linear", // or "indoor-graph"
    currentNode: null,
    nodeHistory: [],
    availableLinks: [],
    indoorCandidates: [],
    selectedCandidateIndex: -1,
    graphCache: new Map(),
  },
  dpExplore: {
    graph: null,
    datasets: [],
    availability: null,
    currentNodeId: null,
    heading: 0,
    history: [],
  },
};

const liveAnnouncementState = {
  text: "",
  at: 0,
};

const I18N = {
  "zh-Hant": {
    title: "AlaVia 文字地圖導覽",
    lead: "使用方式：先在路段名稱輸入地址或道路名稱搜尋路口，系統會列出該道路的各個路口；你可使用沿街地點、街景詳細描述與室內導覽等功能，查看道路與車站周邊的不同資訊。",
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
    indoorNav: "室內導覽",
    dpExplore: "DP 步行空間探索",
    dpSource: "資料來源：ほこナビ DP。資料不是即時資訊，實際環境及設備狀態仍需現場確認。",
    dpNoCoverage: "目前位置附近沒有ほこナビ DP 步行空間網絡資料。",
    dpEntryConfirm: "最近的ほこナビ DP 節點在{direction}約 {meters} 公尺。尚未到達 DP 路網，是否仍要進入虛擬探索模式？",
    dpDatasets: "DP 資料集：{datasets}",
    dpNoLinks: "此 DP 節點沒有可繼續探索的連線。",
    dpBack: "返回上一個 DP 節點",
    dpMoveConfirm: "DP 提示此移動涉及風險或環境轉換：{summary}\n是否繼續？",
    dpCurrent: "目前 DP 節點：樓層 {level}。可選方向如下：",
    dpMoved: "已依 DP 路網移動：{summary}",
    noDataLoaded: "尚未載入路口資料。",
    costStreet: "展開街景詳細描述：{calls} 次，預估 {usd}",
    costRouteOsm: "沿街地點 OSM：{calls} 次，使用 OSM 免費資料",
    costRouteGoogle: "沿街地點 Google Places（約 {calls} 次）：預估 {usd}",
    costTotal: "合計預估（含 LLM 與 Google Places）{usd}",
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
    guestFreeNotice: "一般用戶可使用免費 OSM 查詢；登入並通過審核後可使用付費街景/LLM 功能。",
    pendingApprovalNotice: "帳號 {email} 待管理員審核；目前仍可使用免費 OSM 查詢。",
    paidLoginRequired: "此功能暫未對該帳號開放。",
    paidApprovalRequired: "帳號待審核中，尚未開放付費街景/LLM 功能。",
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
    indoorEnterNearby: "嘗試進入附近室內全景",
    indoorBackPrev: "返回上一個室內點",
    indoorNoEntry: "附近未找到可用室內街景入口",
    indoorNoLinks: "此全景未提供可步行連結，可改選其他室內候選點。",
    indoorSwitched: "已切換至附近室內全景（約 {meters}m）",
    indoorSwitchedCandidate: "已切換至室內候選點 {label}（約 {meters}m）",
    indoorDescribeEnv: "描述室內環境",
    indoorDescribeLoading: "正在產生室內環境描述...",
    indoorDescribeResult: "室內環境描述：{text}",
    indoorMoveBy: "往{direction}移動 {meters}m",
    indoorMoveDone: "已往{direction}移動約 {meters}m",
    indoorMoveUnavailable: "此方向沒有可靠的室內全景連結",
    indoorEntryLowConfidenceManual: "室內入口判斷信心較低，請改以街景圖片與方向按鈕人工判讀。",
    indoorMoveLowConfidenceManual: "室內移動判斷信心較低，請改以街景圖片與方向按鈕人工判讀。",
    indoorMoveResult: "移動結果：{status}。目前 {provider}，候選入口：{candidates}",
    indoorMoveChanged: "已切換至新的 Street View 點",
    indoorMoveSame: "仍在同一 Street View 點",
    indoorProvider: "影像來源：{provider}",
    indoorCandidateMeta: "{label} - {provider}，{distance}m [{direction}]，{links} 個可行方向",
    indoorCandidateCompact: "{label} · {location}",
    indoorCandidateTooltip: "來源：{provider}，{links} 個可行方向",
    indoorCandidateCurrent: "目前點",
    indoorFollowupPlaceholder: "對此圖像追問，例如：哪個方向有出口？",
    indoorFollowupAsk: "追問",
    indoorFollowupLoading: "正在回答追問...",
    indoorLowConfidenceManual: "室內導覽信心較低，請改以街景圖片與方向按鈕人工判讀。",
    indoorNeedManual: "目前無法可靠判斷下一步，請人工判讀。",
  },
  en: {
    title: "AlaVia Text Navigation",
    lead: "How to use: Enter an address or road name to search intersections. The system lists intersections along that road, and you can use Route Places, Street Scene Details, and Indoor Navigation to inspect different types of road and station-area information.",
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
    indoorNav: "Indoor Navigation",
    dpExplore: "DP Walking-Space Exploration",
    dpSource: "Source: Hokonavi DP. This is not live data. Confirm actual conditions and facility status on site.",
    dpNoCoverage: "No Hokonavi DP walking-space data is available near this location.",
    dpEntryConfirm: "The nearest Hokonavi DP node is about {meters} meters {direction}. You have not reached the DP network yet. Enter virtual exploration mode anyway?",
    dpDatasets: "DP datasets: {datasets}",
    dpNoLinks: "This DP node has no available onward links.",
    dpBack: "Return to previous DP node",
    dpMoveConfirm: "DP indicates a risk or environment transition: {summary}\nContinue?",
    dpCurrent: "Current DP node: level {level}. Available directions:",
    dpMoved: "Moved using the DP network: {summary}",
    noDataLoaded: "No intersection data loaded.",
    costStreet: "Street scene details: {calls} calls, estimated {usd}",
    costRouteOsm: "Route Places OSM: {calls} calls, using free OSM data",
    costRouteGoogle: "Route Places Google Places (~{calls} calls): estimated {usd}",
    costTotal: "Estimated total (LLM + Google Places): {usd}",
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
    guestFreeNotice: "You can use free OSM queries when signed out; paid Street View/LLM features are available after sign-in and approval.",
    pendingApprovalNotice: "Account {email} is pending admin approval. Free OSM queries are still available.",
    paidLoginRequired: "Sign in first to use paid Street View/LLM features.",
    paidApprovalRequired: "Your account is pending approval. Paid Street View/LLM features are not available yet.",
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
    indoorEnterNearby: "Try Nearby Indoor Panorama",
    indoorBackPrev: "Back To Previous Indoor Spot",
    indoorNoEntry: "No nearby indoor Street View entry found",
    indoorNoLinks: "No walkable panorama links are available here. Try another indoor candidate.",
    indoorSwitched: "Switched to a nearby indoor panorama (~{meters}m)",
    indoorSwitchedCandidate: "Switched to indoor candidate {label} (~{meters}m)",
    indoorDescribeEnv: "Describe Indoor Surroundings",
    indoorDescribeLoading: "Generating indoor surroundings description...",
    indoorDescribeResult: "Indoor surroundings: {text}",
    indoorMoveBy: "Move {meters}m to {direction}",
    indoorMoveDone: "Moved about {meters}m to {direction}",
    indoorMoveUnavailable: "No reliable indoor panorama link is available in this direction",
    indoorEntryLowConfidenceManual: "Indoor entry confidence is low. Please decide manually using Street View images and direction buttons.",
    indoorMoveLowConfidenceManual: "Indoor move confidence is low. Please decide manually using Street View images and direction buttons.",
    indoorMoveResult: "Move result: {status}. Current provider: {provider}. Candidates: {candidates}",
    indoorMoveChanged: "switched to a new Street View point",
    indoorMoveSame: "still on the same Street View point",
    indoorProvider: "Image provider: {provider}",
    indoorCandidateMeta: "{label} - {provider}, {distance}m [{direction}], {links} walkable directions",
    indoorCandidateCompact: "{label} · {location}",
    indoorCandidateTooltip: "Source: {provider}, {links} walkable directions",
    indoorCandidateCurrent: "current spot",
    indoorFollowupPlaceholder: "Ask about this image, e.g. which direction has an exit?",
    indoorFollowupAsk: "Ask",
    indoorFollowupLoading: "Answering follow-up...",
    indoorLowConfidenceManual: "Indoor navigation confidence is low. Please decide manually using Street View images and direction buttons.",
    indoorNeedManual: "Cannot reliably determine the next indoor step. Please decide manually.",
  },
  ja: {
    title: "AlaVia テキスト地図ナビ",
    lead: "使い方：住所または道路名を入力して交差点を検索します。対象道路の交差点一覧が表示され、沿道地点・街景の詳細説明・室内ナビを使って、道路や駅周辺の情報を多面的に確認できます。",
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
    indoorNav: "室内ナビ",
    noDataLoaded: "交差点データは未読み込みです。",
    costStreet: "街景の詳細説明: {calls} 回、推定 {usd}",
    costRouteOsm: "沿道地点 OSM: {calls} 回（OSM 無料データ）",
    costRouteGoogle: "沿道地点 Google Places（約 {calls} 回）: 推定 {usd}",
    costTotal: "推定合計（LLM + Google Places）: {usd}",
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
    guestFreeNotice: "未ログインでも無料の OSM 照会は利用できます。ログインして承認されると有料の Street View/LLM 機能が使えます。",
    pendingApprovalNotice: "アカウント {email} は管理者承認待ちです。無料の OSM 照会は引き続き利用できます。",
    paidLoginRequired: "有料の Street View/LLM 機能を使うにはログインしてください。",
    paidApprovalRequired: "アカウント承認待ちのため、有料の Street View/LLM 機能はまだ利用できません。",
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
    indoorEnterNearby: "近くの屋内パノラマへ移動",
    indoorBackPrev: "前の屋内ポイントに戻る",
    indoorNoEntry: "近くで利用可能な屋内Street View入口が見つかりません",
    indoorNoLinks: "このパノラマには徒歩リンクがありません。別の屋内候補を試してください。",
    indoorSwitched: "近くの屋内パノラマへ切替（約 {meters}m）",
    indoorSwitchedCandidate: "屋内候補 {label} に切替（約 {meters}m）",
    indoorDescribeEnv: "室内環境を説明",
    indoorDescribeLoading: "室内環境の説明を生成中...",
    indoorDescribeResult: "室内環境: {text}",
    indoorMoveBy: "{direction}へ {meters}m 移動",
    indoorMoveDone: "{direction}へ約 {meters}m 移動しました",
    indoorMoveUnavailable: "この方向には信頼できる屋内パノラマリンクがありません",
    indoorEntryLowConfidenceManual: "屋内入口の判定信頼度が低いため、Street View画像と方向ボタンで手動判断してください。",
    indoorMoveLowConfidenceManual: "屋内移動の判定信頼度が低いため、Street View画像と方向ボタンで手動判断してください。",
    indoorMoveResult: "移動結果: {status}。現在の提供元: {provider}。候補入口: {candidates}",
    indoorMoveChanged: "新しい Street View ポイントへ切替",
    indoorMoveSame: "同じ Street View ポイントのまま",
    indoorProvider: "画像提供元: {provider}",
    indoorCandidateMeta: "{label} - {provider}、{distance}m [{direction}]、移動可能方向 {links} 件",
    indoorCandidateCompact: "{label} · {location}",
    indoorCandidateTooltip: "提供元: {provider}、移動可能方向 {links} 件",
    indoorCandidateCurrent: "現在地",
    indoorFollowupPlaceholder: "この画像について質問（例: 出口はどの方向ですか？）",
    indoorFollowupAsk: "質問",
    indoorFollowupLoading: "追加質問に回答中...",
    indoorLowConfidenceManual: "屋内ナビの信頼度が低いため、Street View画像と方向ボタンで手動判断してください。",
    indoorNeedManual: "次の屋内ステップを信頼して判定できません。手動で判断してください。",
  },
  ko: {
    title: "AlaVia 텍스트 지도 내비",
    lead: "사용 방법: 주소 또는 도로명을 입력해 교차로를 검색합니다. 해당 도로의 교차로 목록이 표시되며, 연선 장소·거리 장면 상세·실내 내비 기능으로 도로와 역 주변 정보를 다양한 관점에서 확인할 수 있습니다.",
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
    indoorNav: "실내 내비",
    noDataLoaded: "교차로 데이터가 아직 없습니다.",
    costStreet: "거리 장면 상세: {calls}회, 예상 {usd}",
    costRouteOsm: "연선 장소 OSM: {calls}회, OSM 무료 데이터 사용",
    costRouteGoogle: "연선 장소 Google Places(약 {calls}회): 예상 {usd}",
    costTotal: "총 예상(LLM + Google Places): {usd}",
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
    guestFreeNotice: "로그아웃 상태에서도 무료 OSM 조회는 사용할 수 있으며, 로그인 후 승인되면 유료 Street View/LLM 기능을 사용할 수 있습니다.",
    pendingApprovalNotice: "계정 {email} 은(는) 관리자 승인 대기 중입니다. 무료 OSM 조회는 계속 사용할 수 있습니다.",
    paidLoginRequired: "유료 Street View/LLM 기능을 사용하려면 먼저 로그인하세요.",
    paidApprovalRequired: "계정 승인 대기 중이므로 유료 Street View/LLM 기능은 아직 사용할 수 없습니다.",
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
    indoorEnterNearby: "근처 실내 파노라마로 이동",
    indoorBackPrev: "이전 실내 지점으로 돌아가기",
    indoorNoEntry: "근처에서 사용 가능한 실내 Street View 진입점을 찾지 못했습니다",
    indoorNoLinks: "이 파노라마에는 도보 링크가 없습니다. 다른 실내 후보를 시도하세요.",
    indoorSwitched: "근처 실내 파노라마로 전환됨 (약 {meters}m)",
    indoorSwitchedCandidate: "실내 후보 {label}(으)로 전환됨 (약 {meters}m)",
    indoorDescribeEnv: "실내 환경 설명",
    indoorDescribeLoading: "실내 환경 설명 생성 중...",
    indoorDescribeResult: "실내 환경: {text}",
    indoorMoveBy: "{direction} 방향으로 {meters}m 이동",
    indoorMoveDone: "{direction} 방향으로 약 {meters}m 이동했습니다",
    indoorMoveUnavailable: "이 방향에는 신뢰할 수 있는 실내 파노라마 링크가 없습니다",
    indoorEntryLowConfidenceManual: "실내 진입 판단 신뢰도가 낮습니다. Street View 이미지와 방향 버튼으로 수동 판단해 주세요.",
    indoorMoveLowConfidenceManual: "실내 이동 판단 신뢰도가 낮습니다. Street View 이미지와 방향 버튼으로 수동 판단해 주세요.",
    indoorMoveResult: "이동 결과: {status}. 현재 제공자: {provider}. 후보 입구: {candidates}",
    indoorMoveChanged: "새 Street View 지점으로 전환됨",
    indoorMoveSame: "같은 Street View 지점에 머무름",
    indoorProvider: "이미지 제공자: {provider}",
    indoorCandidateMeta: "{label} - {provider}, {distance}m [{direction}], 이동 가능 방향 {links}개",
    indoorCandidateCompact: "{label} · {location}",
    indoorCandidateTooltip: "제공자: {provider}, 이동 가능 방향 {links}개",
    indoorCandidateCurrent: "현재 지점",
    indoorFollowupPlaceholder: "이 이미지에 대해 질문하세요. 예: 출구는 어느 방향인가요?",
    indoorFollowupAsk: "질문",
    indoorFollowupLoading: "추가 질문에 답변 중...",
    indoorLowConfidenceManual: "실내 안내 신뢰도가 낮습니다. Street View 이미지와 방향 버튼으로 수동 판단해 주세요.",
    indoorNeedManual: "다음 실내 이동을 신뢰성 있게 판단할 수 없습니다. 수동으로 판단해 주세요.",
  },
};

const REGION_CODES = [
  "AD","AE","AF","AG","AI","AL","AM","AO","AQ","AR","AS","AT","AU","AW","AX","AZ","BA","BB","BD","BE","BF","BG","BH","BI","BJ","BL","BM","BN","BO","BQ","BR","BS","BT","BV","BW","BY","BZ","CA","CC","CD","CF","CG","CH","CI","CK","CL","CM","CN","CO","CR","CU","CV","CW","CX","CY","CZ","DE","DJ","DK","DM","DO","DZ","EC","EE","EG","EH","ER","ES","ET","FI","FJ","FK","FM","FO","FR","GA","GB","GD","GE","GF","GG","GH","GI","GL","GM","GN","GP","GQ","GR","GS","GT","GU","GW","GY","HK","HM","HN","HR","HT","HU","ID","IE","IL","IM","IN","IO","IQ","IR","IS","IT","JE","JM","JO","JP","KE","KG","KH","KI","KM","KN","KP","KR","KW","KY","KZ","LA","LB","LC","LI","LK","LR","LS","LT","LU","LV","LY","MA","MC","MD","ME","MF","MG","MH","MK","ML","MM","MN","MO","MP","MQ","MR","MS","MT","MU","MV","MW","MX","MY","MZ","NA","NC","NE","NF","NG","NI","NL","NO","NP","NR","NU","NZ","OM","PA","PE","PF","PG","PH","PK","PL","PM","PN","PR","PS","PT","PW","PY","QA","RE","RO","RS","RU","RW","SA","SB","SC","SD","SE","SG","SH","SI","SJ","SK","SL","SM","SN","SO","SR","SS","ST","SV","SX","SY","SZ","TC","TD","TF","TG","TH","TJ","TK","TL","TM","TN","TO","TR","TT","TV","TW","TZ","UA","UG","UM","US","UY","UZ","VA","VC","VE","VG","VI","VN","VU","WF","WS","YE","YT","ZA","ZM","ZW",
];

function t(key) {
  const dict = I18N[state.uiLang] || I18N["zh-Hant"];
  return dict[key] || I18N.en[key] || I18N["zh-Hant"][key] || key;
}
function bearingToCompass(bearing) {
  bearing = ((bearing % 360) + 360) % 360;
  if (bearing >= 337.5 || bearing < 22.5) return "北";
  if (bearing >= 22.5 && bearing < 67.5) return "東北";
  if (bearing >= 67.5 && bearing < 112.5) return "東";
  if (bearing >= 112.5 && bearing < 157.5) return "東南";
  if (bearing >= 157.5 && bearing < 202.5) return "南";
  if (bearing >= 202.5 && bearing < 247.5) return "西南";
  if (bearing >= 247.5 && bearing < 292.5) return "西";
  if (bearing >= 292.5 && bearing < 337.5) return "西北";
  return "?";
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dPhi = ((lat2 - lat1) * Math.PI) / 180;
  const dLambda = ((lon2 - lon1) * Math.PI) / 180;
  const x = Math.sin(dPhi / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLambda / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function calculateBearing(lat1, lon1, lat2, lon2) {
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dLambda = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(dLambda) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dLambda);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function bearingDeltaAbs(a, b) {
  const diff = (((Number(a) - Number(b)) % 360) + 540) % 360 - 180;
  return Math.abs(diff);
}

function tf(key, vars = {}) {
  const template = t(key);
  return String(template).replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? ""));
}

function announceLive(text) {
  const region = $("srAnnouncements");
  if (!region) return;
  const message = String(text || "").trim();
  if (!message) return;
  const now = Date.now();
  if (message === liveAnnouncementState.text && now - liveAnnouncementState.at < 1500) {
    return;
  }
  liveAnnouncementState.text = message;
  liveAnnouncementState.at = now;
  region.textContent = "";
  setTimeout(() => {
    region.textContent = message;
  }, 20);
}

function isDisabledLlmDescription(text) {
  const normalized = String(text || "").trim();
  return normalized.includes("未啟用 LLM 描述");
}

function sanitizeStreetSummaryText(text) {
  const lines = String(text || "").split("\n");
  const kept = lines.filter((line) => !isDisabledLlmDescription(line));
  return kept.join("\n").trim();
}

function directionLabelFromBearing(bearing) {
  const normalized = ((Number(bearing) % 360) + 360) % 360;
  const idx = Math.round(normalized / 45) % 8;
  const keys = ["dirN", "dirNE", "dirE", "dirSE", "dirS", "dirSW", "dirW", "dirNW"];
  return t(keys[idx]);
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
  refreshQuickIndoorButtonState();
  if ($("quickIndoorBtn")) {
    $("quickIndoorBtn").textContent = t("indoorNav");
  }
  if ($("quickDpBtn")) {
    $("quickDpBtn").textContent = t("dpExplore");
  }
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
  return Math.max(10, Number($("sampleInterval").value || 10));
}

function getCountryCode() {
  const v = String($("countryCode")?.value || "TW").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(v) ? v : "TW";
}

function syncCountryPreferenceByUiLang() {
  const country = $("countryCode");
  if (!country) return;
  if (state.uiLang === "ja") {
    country.value = "JP";
  } else if (state.uiLang === "ko") {
    country.value = "KR";
  }
}

function formatUsd(v) {
  return `$${v.toFixed(3)}`;
}

function estimateCosts() {
  const count = state.intersections.length;
  const streetCalls = count * 2;
  const streetUsd = count * 2 * (PRICES.streetViewStatic + PRICES.llmGenerate);

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

// Google Maps JS API initialization for Street View Links
let googleMapsApiKey = null;
let streetViewService = null;

async function initGoogleMapsApi() {
  if (streetViewService) return;
  
  try {
    // Fetch API key from backend
    const keyRes = await postJson("/api/config/maps-key", {});
    if (keyRes.ok && keyRes.apiKey) {
      googleMapsApiKey = keyRes.apiKey;
      
      // Load Google Maps API
      const script = document.getElementById("google-maps-api");
      script.src = `https://maps.googleapis.com/maps/api/js?key=${googleMapsApiKey}&libraries=streetView`;
      
      await new Promise((resolve, reject) => {
        script.addEventListener("load", resolve);
        script.addEventListener("error", reject);
      });
      
      // Initialize Street View Service
      streetViewService = new google.maps.StreetViewService();
    }
  } catch (err) {
    console.error("Failed to initialize Google Maps API:", err);
  }
}

async function fetchStreetViewLinks(panoId) {
  if (!streetViewService) {
    await initGoogleMapsApi();
  }
  
  if (!streetViewService) {
    console.warn("Street View Service not available");
    return [];
  }
  
  return new Promise((resolve) => {
    streetViewService.getPanorama({ pano: panoId }, (result, status) => {
      if (status !== google.maps.StreetViewStatus.OK) {
        console.warn("Failed to fetch Street View panorama:", status);
        resolve([]);
        return;
      }
      
      if (!result || !result.links) {
        resolve([]);
        return;
      }
      
      // Transform links to our format with direction labels
      const links = result.links.map(link => {
        const heading = link.heading || 0;
        const dir = bearingToRelativeDir(heading);
        const desc = link.description || "前往";
        return {
          panoId: link.pano,
          heading: heading,
          description: desc,
          label: `${dir}${desc ? ` ${desc}` : ""}`,
          distanceMeters: null,
          targetImageryType: "unknown",
          exitsIndoor: false,
          requiresConfirmation: true,
        };
      });
      
      resolve(links);
    });
  });
}

async function hydrateIndoorNodeLinks(node) {
  if (!node?.panoId) return node;
  if (Array.isArray(node.links) && node.links.length > 0) return node;
  const links = await fetchStreetViewLinks(node.panoId).catch(() => []);
  node.links = links;
  return node;
}

async function refreshIndoorCandidatesAround(node, radiusMeters = 220) {
  if (!node || !Number.isFinite(Number(node.lat)) || !Number.isFinite(Number(node.lon))) {
    return [];
  }
  const entry = await postJson("/api/streetview/find-indoor-entry", {
    lat: Number(node.lat),
    lon: Number(node.lon),
    radiusMeters,
  });
  const candidates = Array.isArray(entry?.candidates)
    ? entry.candidates.filter((candidate) => candidate?.node?.imageryType === "indoor")
    : [];
  await Promise.all(candidates.map((candidate) => hydrateIndoorNodeLinks(candidate?.node)));
  return candidates;
}

function getIndoorCandidateMetrics(candidate, currentNode) {
  const node = candidate?.node || {};
  const hasCurrent = Number.isFinite(Number(currentNode?.lat)) && Number.isFinite(Number(currentNode?.lon));
  const hasCandidate = Number.isFinite(Number(node.lat)) && Number.isFinite(Number(node.lon));
  const distanceMeters = hasCurrent && hasCandidate
    ? Math.round(haversineMeters(Number(currentNode.lat), Number(currentNode.lon), Number(node.lat), Number(node.lon)))
    : Math.round(Number(candidate?.distanceMeters) || 0);
  const bearing = hasCurrent && hasCandidate
    ? calculateBearing(Number(currentNode.lat), Number(currentNode.lon), Number(node.lat), Number(node.lon))
    : Number(candidate?.bearing);
  return {
    distanceMeters,
    direction: Number.isFinite(bearing) ? bearingToCompass(bearing) : "?",
    isCurrent: Boolean(currentNode?.panoId && node.panoId && currentNode.panoId === node.panoId) || distanceMeters <= 2,
  };
}

function providerLabel(nodeOrData) {
  return String(nodeOrData?.providerHint || nodeOrData?.panorama?.providerHint || "Street View").trim() || "Street View";
}

function attachPanoramaProviderHint(data, node) {
  if (!data || !node?.providerHint) return data;
  data.panorama = data.panorama || {};
  data.panorama.providerHint = node.providerHint;
  return data;
}

function getBestIndoorMoveLink(links, bearing) {
  const usable = Array.isArray(links)
    ? links.filter((link) => link?.panoId && Number.isFinite(Number(link.heading)))
    : [];
  if (!usable.length) return null;
  let best = usable[0];
  let bestDelta = bearingDeltaAbs(bearing, best.heading);
  for (let i = 1; i < usable.length; i += 1) {
    const delta = bearingDeltaAbs(bearing, usable[i].heading);
    if (delta < bestDelta) {
      best = usable[i];
      bestDelta = delta;
    }
  }
  return bestDelta <= 55 ? { link: best, delta: Math.round(bestDelta) } : null;
}

function renderRelativeIndoorControls(facingHeading, links, onMove) {
  const wrap = document.createElement("div");
  wrap.className = "pano-links";
  const copy = {
    "zh-Hant": ["向前", "左轉", "右轉", "回頭"],
    en: ["Forward", "Turn left", "Turn right", "Turn around"],
    ja: ["前へ", "左折", "右折", "後ろへ"],
    ko: ["앞으로", "좌회전", "우회전", "뒤로"],
  }[state.uiLang] || ["向前", "左轉", "右轉", "回頭"];
  const directions = [
    { label: copy[0], offset: 0 },
    { label: copy[1], offset: -90 },
    { label: copy[2], offset: 90 },
    { label: copy[3], offset: 180 },
  ];

  for (const direction of directions) {
    const bearing = ((Number(facingHeading) + direction.offset) % 360 + 360) % 360;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "link-button";
    const bestLink = getBestIndoorMoveLink(links, bearing);
    btn.textContent = bestLink ? `${direction.label}：${formatIndoorLinkSummary(bestLink.link)}` : direction.label;
    btn.addEventListener("click", async () => {
      await onMove(bearing);
    });
    wrap.appendChild(btn);
  }
  return wrap;
}

function indoorImageryTypeLabel(type) {
  const labels = {
    "zh-Hant": { indoor: "仍在室內", outdoor: "將離開室內", unknown: "室內外狀態未確認" },
    en: { indoor: "stays indoors", outdoor: "leaves the indoor area", unknown: "indoor/outdoor status is unconfirmed" },
    ja: { indoor: "屋内のまま", outdoor: "屋外へ移動", unknown: "屋内外の状態は未確認" },
    ko: { indoor: "실내 유지", outdoor: "실외로 이동", unknown: "실내외 상태 미확인" },
  };
  const selected = labels[state.uiLang] || labels["zh-Hant"];
  return selected[String(type || "unknown")] || selected.unknown;
}

function indoorUiCopy() {
  const copies = {
    "zh-Hant": {
      approximately: "約",
      unknownDistance: "距離未知",
      exitWarning: "這一步會離開室內。是否繼續？",
      unknownWarning: "這一步的室內外狀態尚未確認。是否仍要繼續？",
      switchCandidate: "切換候選點",
      indoorCandidateOnly: "此候選點未能確認為室內位置，不能作為室內候選點切換。",
      hazardWarning: "此方向包含需要注意的設施：{hazards}。是否繼續？",
    },
    en: {
      approximately: "about",
      unknownDistance: "distance unknown",
      exitWarning: "This move leaves the indoor area. Continue?",
      unknownWarning: "The indoor/outdoor status of this move is unconfirmed. Continue anyway?",
      switchCandidate: "switch candidate",
      indoorCandidateOnly: "This candidate is not verified as indoor and cannot be used as an indoor candidate.",
      hazardWarning: "This direction includes facilities requiring attention: {hazards}. Continue?",
    },
    ja: {
      approximately: "約",
      unknownDistance: "距離不明",
      exitWarning: "この移動で屋外に出ます。続行しますか？",
      unknownWarning: "この移動先の屋内外状態は未確認です。それでも続行しますか？",
      switchCandidate: "候補地点へ移動",
      indoorCandidateOnly: "この候補地点は屋内と確認できないため、屋内候補として切り替えられません。",
      hazardWarning: "この方向には注意が必要な設備があります：{hazards}。続行しますか？",
    },
    ko: {
      approximately: "약",
      unknownDistance: "거리 미확인",
      exitWarning: "이 이동은 실외로 나갑니다. 계속하시겠습니까?",
      unknownWarning: "이 이동의 실내외 상태가 확인되지 않았습니다. 계속하시겠습니까?",
      switchCandidate: "후보 지점으로 이동",
      indoorCandidateOnly: "이 후보 지점은 실내로 확인되지 않아 실내 후보로 전환할 수 없습니다.",
      hazardWarning: "이 방향에는 주의가 필요한 시설이 있습니다: {hazards}. 계속하시겠습니까?",
    },
  };
  return copies[state.uiLang] || copies["zh-Hant"];
}

function formatIndoorLinkDistance(link) {
  const meters = Number(link?.distanceMeters);
  const copy = indoorUiCopy();
  return Number.isFinite(meters) ? `${copy.approximately} ${Math.max(0, Math.round(meters))}m` : copy.unknownDistance;
}

function formatIndoorLinkSummary(link) {
  const direction = Number.isFinite(Number(link?.heading)) ? bearingToCompass(Number(link.heading)) : "?";
  const description = String(link?.label || link?.description || "前往").trim();
  return `${direction}，${formatIndoorLinkDistance(link)}，${description}，${indoorImageryTypeLabel(link?.targetImageryType)}`;
}

function getIndoorLinkHazards(link) {
  const text = `${link?.label || ""} ${link?.description || ""}`.toLowerCase();
  const hazards = [];
  if (/樓梯|楼梯|階段|stair|계단/.test(text)) hazards.push("樓梯");
  if (/扶梯|電扶梯|エスカレーター|escalator|에스컬레이터/.test(text)) hazards.push("扶手電梯");
  if (/升降機|電梯|エレベーター|elevator|엘리베이터/.test(text)) hazards.push("升降機");
  if (/月台|ホーム|platform|승강장/.test(text)) hazards.push("月台");
  return [...new Set(hazards)];
}

function confirmIndoorTransition(link) {
  const copy = indoorUiCopy();
  const warnings = [];
  if (link?.exitsIndoor) warnings.push(copy.exitWarning);
  else if (link?.requiresConfirmation) warnings.push(copy.unknownWarning);
  const hazards = getIndoorLinkHazards(link);
  if (hazards.length) warnings.push(copy.hazardWarning.replace("{hazards}", hazards.join("、")));
  if (!warnings.length) return true;
  return window.confirm(`${formatIndoorLinkSummary(link)}\n${warnings.join("\n")}`);
}

function confirmIndoorCandidateTransition(currentNode, candidate) {
  const targetNode = candidate?.node || {};
  const targetImageryType = String(targetNode.imageryType || (targetNode.isIndoor ? "indoor" : "unknown"));
  if (targetImageryType !== "indoor") {
    window.alert(indoorUiCopy().indoorCandidateOnly);
    return false;
  }
  return confirmIndoorTransition({
    heading: candidate?.bearing,
    label: targetNode.addressLabel || indoorUiCopy().switchCandidate,
    distanceMeters: candidate?.distanceMeters,
    targetImageryType,
    exitsIndoor: currentNode?.imageryType === "indoor" && targetImageryType === "outdoor",
    requiresConfirmation: currentNode?.imageryType === "indoor" && targetImageryType !== "indoor",
  });
}

function getIndoorLowConfidenceMessage(stage) {
  return stage === "entry" ? t("indoorEntryLowConfidenceManual") : t("indoorMoveLowConfidenceManual");
}

function formatIndoorCandidateButton(candidate, index, currentNode, active) {
  const metrics = getIndoorCandidateMetrics(candidate, currentNode);
  const label = `入口 ${String.fromCharCode(65 + index)}`;
  const location = metrics.isCurrent ? t("indoorCandidateCurrent") : `${metrics.distanceMeters}m [${metrics.direction}]`;
  const prefix = active ? "*" : "";
  return `${prefix}${tf("indoorCandidateCompact", {
    label,
    location,
  })}`;
}

function formatIndoorCandidateTooltip(candidate, index, currentNode) {
  const metrics = getIndoorCandidateMetrics(candidate, currentNode);
  const provider = providerLabel(candidate?.node);
  const linkCount = Array.isArray(candidate?.node?.links) ? candidate.node.links.length : 0;
  const label = `入口 ${String.fromCharCode(65 + index)}`;
  return `${tf("indoorCandidateMeta", {
    label,
    provider,
    distance: metrics.distanceMeters,
    direction: metrics.isCurrent ? t("indoorCandidateCurrent") : metrics.direction,
    links: linkCount,
  })}\n${tf("indoorCandidateTooltip", {
    provider,
    links: linkCount,
  })}`;
}

function summarizeIndoorCandidates(candidates, currentNode) {
  if (!Array.isArray(candidates) || !candidates.length) return t("none");
  return candidates.slice(0, 3).map((candidate, index) => {
    const metrics = getIndoorCandidateMetrics(candidate, currentNode);
    const label = `入口 ${String.fromCharCode(65 + index)}`;
    const place = metrics.isCurrent ? t("indoorCandidateCurrent") : `${metrics.distanceMeters}m ${metrics.direction}`;
    return `${label} ${place}`;
  }).join("；");
}

function buildIndoorMoveResultMessage(direction, meters, previousNode, nextNode, candidates) {
  const changed = previousNode?.panoId && nextNode?.panoId && previousNode.panoId !== nextNode.panoId;
  const status = changed ? t("indoorMoveChanged") : t("indoorMoveSame");
  const previousType = String(previousNode?.imageryType || (previousNode?.isIndoor ? "indoor" : "unknown"));
  const nextType = String(nextNode?.imageryType || (nextNode?.isIndoor ? "indoor" : "unknown"));
  const environmentChange = previousType === nextType
    ? indoorImageryTypeLabel(nextType)
    : `${indoorImageryTypeLabel(previousType)} -> ${indoorImageryTypeLabel(nextType)}`;
  return `${tf("indoorMoveDone", { direction, meters })}\n${tf("indoorMoveResult", {
    status,
    provider: providerLabel(nextNode),
    candidates: summarizeIndoorCandidates(candidates, nextNode),
  })}\n${environmentChange}`;
}

function appendIndoorStatus(container, message) {
  const status = document.createElement("div");
  status.className = "minor indoor-status";
  status.textContent = message;
  container.appendChild(status);
}

function bearingToRelativeDir(bearing) {
  const normalized = ((bearing % 360) + 360) % 360;
  const dirs = ["前方", "右前方", "右方", "右後方", "後方", "左後方", "左方", "左前方"];
  const idx = Math.round(normalized / 45) % 8;
  return dirs[idx];
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

function buildPrimaryIntersectionLabel(addressLabel, roadLabel) {
  const normalizedAddress = String(addressLabel || "").trim();
  const normalizedRoad = String(roadLabel || "").trim();
  if (!normalizedAddress) return normalizedRoad || t("unknownRoad");
  if (!normalizedRoad || normalizedAddress.includes(normalizedRoad)) return normalizedAddress;

  const streetPrefix = normalizedAddress.replace(/\s*\d+.*$/, "").trim();
  if (streetPrefix && normalizedRoad.startsWith(streetPrefix)) {
    const suffix = normalizedRoad.slice(streetPrefix.length).trim();
    return suffix ? `${normalizedAddress} ${suffix}` : normalizedAddress;
  }

  return `${normalizedAddress} ${normalizedRoad}`;
}

function buildIntersectionHeading(row, index) {
  const nameParts = String(row.name || "").split("×").map((part) => part.trim()).filter(Boolean);
  const crossStreet = row.crossStreets?.[0] || nameParts[1] || t("unnamedRoad");
  const primaryRoad = nameParts[0] || state.roadName || t("unknownRoad");
  const primary = buildPrimaryIntersectionLabel(row.addressLabel, primaryRoad);
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

  const streetUsd = 2 * (PRICES.streetViewStatic + PRICES.llmGenerate);
  btn.textContent = `${t("streetDetail")}（${formatUsd(streetUsd)}）`;

  const blocked = getPaidBlockedMessage();
  btn.disabled = Boolean(blocked) || !state.intersections.length;
  btn.title = blocked || "";
}

function refreshQuickIndoorButtonState() {
  const btn = $("quickIndoorBtn");
  if (!btn) return;
  btn.textContent = t("indoorNav");
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
  state.quickStreet.navigationMode = "outdoor-linear";
  state.quickStreet.currentNode = null;
  state.quickStreet.nodeHistory = [];
  state.quickStreet.availableLinks = [];
  state.quickStreet.indoorCandidates = [];
  state.quickStreet.selectedCandidateIndex = -1;

  const panel = $("quickNavStreet");
  if (panel) {
    panel.classList.remove("error");
    panel.textContent = "";
  }
  const indoorPanel = $("quickNavIndoor");
  if (indoorPanel) {
    indoorPanel.classList.remove("error");
    indoorPanel.textContent = "";
  }
  const dpPanel = $("quickNavDp");
  if (dpPanel) {
    dpPanel.classList.remove("error");
    dpPanel.textContent = "";
  }
  state.dpExplore.graph = null;
  state.dpExplore.datasets = [];
  state.dpExplore.availability = null;
  state.dpExplore.currentNodeId = null;
  state.dpExplore.heading = 0;
  state.dpExplore.history = [];
  refreshQuickStreetAdvanceButton();
  refreshQuickIndoorButtonState();
}

function getDpNode(nodeId) {
  return state.dpExplore.graph?.nodes?.find((node) => node.id === nodeId) || null;
}

function getDpOutgoingEdges(nodeId) {
  return (state.dpExplore.graph?.edges || []).filter((edge) => edge.from === nodeId);
}

function dpKindLabel(kind) {
  const labels = {
    moving_walkway: "自動行人道",
    elevator: "升降機",
    escalator: "扶手電梯",
    stairs: "樓梯",
    ramp: "斜道",
    underground_passage: "地下通道",
    footbridge: "行人天橋",
    facility_corridor: "設施內通道",
    pedestrian_path: "步行通道",
  };
  return labels[kind] || String(kind || "步行通道");
}

function dpRelativeDirection(bearing) {
  const heading = Number(state.dpExplore.heading) || 0;
  const delta = (((Number(bearing) - heading) % 360) + 360) % 360;
  return bearingToRelativeDir(delta);
}

function formatDpEdgeSummary(edge) {
  const target = getDpNode(edge.to);
  const parts = [
    `${dpRelativeDirection(edge.bearing)} ${Math.round(Number(edge.distanceMeters) || 0)} 公尺`,
    dpKindLabel(edge.kind),
  ];
  if (edge.level && String(edge.level).includes("->")) parts.push(`樓層 ${edge.level}`);
  if (Number(edge.properties?.brail_tile) === 2) parts.push("設有視障引導磚");
  if ([2, 3].includes(Number(edge.properties?.tfc_s_type))) parts.push("設有音響交通燈");
  if (Number(edge.properties?.roof) === 2) parts.push("有上蓋");
  const fromInOut = Number(getDpNode(edge.from)?.properties?.in_out);
  const toInOut = Number(target?.properties?.in_out);
  if (fromInOut !== toInOut) parts.push("設施邊界轉換");
  if (edge.requiresConfirmation) parts.push("移動前需要確認");
  return `${parts.join("，")}。來源：DP`;
}

function renderDpExploration(panel, movedMessage = "") {
  panel.classList.remove("error");
  panel.innerHTML = "";
  const currentNode = getDpNode(state.dpExplore.currentNodeId);
  if (!currentNode) {
    panel.classList.add("error");
    panel.textContent = t("dpNoCoverage");
    return;
  }

  const title = document.createElement("h4");
  title.textContent = t("dpExplore");
  panel.appendChild(title);
  const source = document.createElement("div");
  source.className = "minor indoor-provider";
  source.textContent = t("dpSource");
  panel.appendChild(source);
  if (state.dpExplore.datasets.length) {
    const datasets = document.createElement("div");
    datasets.className = "minor indoor-provider";
    datasets.textContent = tf("dpDatasets", {
      datasets: state.dpExplore.datasets.map((dataset) => `${dataset.title} (${dataset.updatedAt})`).join("；"),
    });
    panel.appendChild(datasets);
  }
  if (movedMessage) appendIndoorStatus(panel, movedMessage);

  if (state.dpExplore.history.length) {
    const back = document.createElement("button");
    back.type = "button";
    back.className = "advance-btn";
    back.textContent = t("dpBack");
    back.addEventListener("click", () => {
      state.dpExplore.currentNodeId = state.dpExplore.history.pop();
      renderDpExploration(panel);
    });
    panel.appendChild(back);
  }

  const heading = document.createElement("div");
  heading.className = "minor";
  heading.textContent = tf("dpCurrent", { level: currentNode.level ?? "?" });
  panel.appendChild(heading);

  const outgoing = getDpOutgoingEdges(currentNode.id);
  if (!outgoing.length) {
    appendIndoorStatus(panel, t("dpNoLinks"));
    return;
  }
  const links = document.createElement("div");
  links.className = "pano-links";
  for (const edge of outgoing) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "link-button";
    const summary = formatDpEdgeSummary(edge);
    button.textContent = summary;
    button.addEventListener("click", () => {
      if (edge.requiresConfirmation && !window.confirm(tf("dpMoveConfirm", { summary }))) return;
      state.dpExplore.history.push(currentNode.id);
      state.dpExplore.currentNodeId = edge.to;
      state.dpExplore.heading = Number(edge.bearing) || state.dpExplore.heading;
      const moved = tf("dpMoved", { summary });
      announceLive(moved);
      updateQuickNavStatus(moved);
      renderDpExploration(panel, moved);
    });
    links.appendChild(button);
  }
  panel.appendChild(links);
}

async function runQuickDpExploration() {
  const row = state.intersections[state.focusedIndex];
  const panel = $("quickNavDp");
  if (!row || !panel) return;
  panel.classList.remove("error");
  panel.textContent = t("queryLoading");
  try {
    const availability = state.dpExplore.availability || await fetchDpAvailability(row);
    if (!availability?.found) {
      panel.textContent = "";
      refreshQuickDpButtonState();
      return;
    }
    const entryMeters = Number(availability.nearestNode?.distanceMeters);
    if (entryMeters > 30 && !window.confirm(tf("dpEntryConfirm", {
      direction: bearingToRelativeDir(Number(availability.bearing) - (Number(row.bearingToNext) || 0)),
      meters: Math.round(entryMeters),
    }))) {
      panel.textContent = "";
      return;
    }
    const data = await postJson("/api/dp/indoor-graph", {
      lat: row.lat,
      lon: row.lon,
      radiusMeters: 500,
    });
    if (!data?.found || !data?.nearestNode?.id) {
      panel.classList.add("error");
      panel.textContent = data?.error || t("dpNoCoverage");
      announceLive(panel.textContent);
      return;
    }
    state.dpExplore.graph = data.graph;
    state.dpExplore.datasets = Array.isArray(data.datasets) ? data.datasets : [];
    state.dpExplore.currentNodeId = data.nearestNode.id;
    state.dpExplore.heading = Number(row.bearingToNext) || 0;
    state.dpExplore.history = [];
    renderDpExploration(panel);
    announceLive(`${t("dpExplore")}。${t("dpSource")}`);
  } catch (err) {
    panel.classList.add("error");
    panel.textContent = `${t("errorPrefix")}${err.message}`;
  }
}

async function fetchDpAvailability(row) {
  return postJson("/api/dp/availability", {
    lat: row.lat,
    lon: row.lon,
    radiusMeters: 300,
  });
}

async function refreshQuickDpButtonState() {
  const btn = $("quickDpBtn");
  const row = state.intersections[state.focusedIndex];
  if (!btn) return;
  btn.hidden = true;
  state.dpExplore.availability = null;
  if (!row) return;
  try {
    const availability = await fetchDpAvailability(row);
    if (row !== state.intersections[state.focusedIndex]) return;
    state.dpExplore.availability = availability?.found ? availability : null;
    btn.hidden = !availability?.found;
    if (availability?.found) {
      const meters = Math.round(Number(availability.nearestNode?.distanceMeters) || 0);
      btn.title = `ほこナビ DP：最近節點約 ${meters} 公尺`;
    }
  } catch {
    btn.hidden = true;
  }
}

function renderIndoorNavigation(node, parentPanel) {
  const container = document.createElement("div");
  container.className = "indoor-nav-section";
  
  const header = document.createElement("h4");
  header.textContent = `${t("indoorNav")} - ${providerLabel(node)}`;
  container.appendChild(header);

  const provider = document.createElement("div");
  provider.className = "minor indoor-provider";
  provider.textContent = tf("indoorProvider", { provider: providerLabel(node) });
  container.appendChild(provider);

  if (state.quickStreet.nodeHistory.length > 0) {
    const backBtn = document.createElement("button");
    backBtn.type = "button";
    backBtn.className = "advance-btn";
    backBtn.textContent = t("indoorBackPrev");
    backBtn.addEventListener("click", async () => {
      await goBackIndoorNode(parentPanel);
    });
    container.appendChild(backBtn);
  }

  if (Array.isArray(state.quickStreet.indoorCandidates) && state.quickStreet.indoorCandidates.length > 1) {
    container.appendChild(renderIndoorCandidateButtons(parentPanel));
  }

  container.appendChild(renderRelativeIndoorControls(state.quickStreet.heading || 0, state.quickStreet.availableLinks, async (bearing) => {
    await moveQuickIndoorByBearing(bearing, parentPanel);
  }));

  const moveWrap = document.createElement("div");
  moveWrap.className = "pano-links";
  const stepDirections = [
    { bearing: 0, key: "dirN" },
    { bearing: 45, key: "dirNE" },
    { bearing: 90, key: "dirE" },
    { bearing: 135, key: "dirSE" },
    { bearing: 180, key: "dirS" },
    { bearing: 225, key: "dirSW" },
    { bearing: 270, key: "dirW" },
    { bearing: 315, key: "dirNW" },
  ];
  for (const dir of stepDirections) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "link-button";
    const bestLink = getBestIndoorMoveLink(state.quickStreet.availableLinks, dir.bearing);
    if (!bestLink) {
      btn.textContent = tf("indoorMoveBy", { direction: t(dir.key), meters: "?" });
      btn.disabled = true;
      btn.title = t("indoorMoveUnavailable");
      btn.setAttribute("aria-disabled", "true");
    } else {
      btn.textContent = formatIndoorLinkSummary(bestLink.link);
      btn.title = `${bestLink.link.label || bestLink.link.description || ""} (${Math.round(bestLink.link.heading)}°, Δ${bestLink.delta}°)`;
    }
    btn.addEventListener("click", async () => {
      await moveQuickIndoorByBearing(dir.bearing, parentPanel);
    });
    moveWrap.appendChild(btn);
  }
  container.appendChild(moveWrap);

  if (node.links && node.links.length > 0) {
    const linksDiv = document.createElement("div");
    linksDiv.className = "pano-links";
    
    for (const link of node.links) {
      const btn = document.createElement("button");
      btn.className = "link-button";
      // Display formatted label with direction (e.g., "右前方樓梯")
      btn.textContent = formatIndoorLinkSummary(link);
      btn.title = `${link.heading}°`;
      btn.onclick = async () => {
        await navigateToLink(link, parentPanel);
      };
      linksDiv.appendChild(btn);
    }
    container.appendChild(linksDiv);
  }

  // Optional CV analyze button
  const analyzeBtn = document.createElement("button");
  analyzeBtn.className = "analyze-btn";
  analyzeBtn.textContent = "詳細分析 (可選，費用 $0.0003)";
  analyzeBtn.onclick = async () => {
    await analyzeWithLlm(node, parentPanel);
  };
  container.appendChild(analyzeBtn);

  if (!node.links || node.links.length === 0) {
    const noLinkHint = document.createElement("div");
    noLinkHint.className = "minor";
    noLinkHint.textContent = t("indoorNoLinks");
    container.appendChild(noLinkHint);
  }

  return container;
}

function renderIndoorCandidateButtons(parentPanel) {
  const wrap = document.createElement("div");
  wrap.className = "pano-links";
  for (let i = 0; i < state.quickStreet.indoorCandidates.length; i += 1) {
    const c = state.quickStreet.indoorCandidates[i];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "link-button";
    btn.textContent = formatIndoorCandidateButton(c, i, state.quickStreet.currentNode, i === state.quickStreet.selectedCandidateIndex);
    btn.title = formatIndoorCandidateTooltip(c, i, state.quickStreet.currentNode);
    btn.addEventListener("click", async () => {
      await switchIndoorCandidate(i, parentPanel);
    });
    wrap.appendChild(btn);
  }
  return wrap;
}

async function goBackIndoorNode(parentPanel) {
  if (!state.quickStreet.nodeHistory.length) return;
  const prevNode = state.quickStreet.nodeHistory.pop();
  if (!prevNode || !prevNode.panoId) return;

  const streetData = await postJson("/api/paid/streetview", {
    userConfirmedPaidCall: true,
    panoId: prevNode.panoId,
    lat: Number(prevNode.lat) || state.quickStreet.lat,
    lon: Number(prevNode.lon) || state.quickStreet.lon,
    heading: state.quickStreet.heading,
    fov: 90,
    pitch: 0,
    language: getMapLanguage(),
    useLlm: false,
  });

  state.quickStreet.currentNode = prevNode;
  state.quickStreet.availableLinks = prevNode.links || [];
  state.quickStreet.indoorCandidates = await refreshIndoorCandidatesAround(prevNode);
  state.quickStreet.selectedCandidateIndex = state.quickStreet.indoorCandidates.findIndex((c) => c?.node?.panoId === prevNode.panoId);

  parentPanel.classList.remove("error");
  parentPanel.innerHTML = "";
  parentPanel.appendChild(createStreetResultSection(attachPanoramaProviderHint(streetData, prevNode)));
  parentPanel.appendChild(renderIndoorNavigation(prevNode, parentPanel));
}

async function switchIndoorCandidate(index, parentPanel) {
  const candidate = state.quickStreet.indoorCandidates[index];
  if (!candidate || !candidate.node || !candidate.node.panoId) return;
  if (!confirmIndoorCandidateTransition(state.quickStreet.currentNode, candidate)) return;
  await hydrateIndoorNodeLinks(candidate.node);

  const currentNode = state.quickStreet.currentNode;
  if (currentNode?.panoId && currentNode.panoId !== candidate.node.panoId) {
    state.quickStreet.nodeHistory.push(currentNode);
  }

  state.quickStreet.selectedCandidateIndex = index;
  const streetData = await postJson("/api/paid/streetview", {
    userConfirmedPaidCall: true,
    panoId: candidate.node.panoId,
    lat: Number(candidate.node.lat) || state.quickStreet.lat,
    lon: Number(candidate.node.lon) || state.quickStreet.lon,
    heading: state.quickStreet.heading,
    fov: 90,
    pitch: 0,
    language: getMapLanguage(),
    useLlm: false,
  });

  state.quickStreet.currentNode = candidate.node;
  state.quickStreet.availableLinks = candidate.node.links || [];

  parentPanel.classList.remove("error");
  parentPanel.innerHTML = "";
  parentPanel.appendChild(createStreetResultSection(attachPanoramaProviderHint(streetData, candidate.node)));

  const hint = document.createElement("div");
  hint.className = "minor";
  const switchedMessage = tf("indoorSwitchedCandidate", {
    label: String.fromCharCode(65 + index),
    meters: Math.round(Number(candidate.distanceMeters) || 0),
  });
  hint.textContent = switchedMessage;
  parentPanel.appendChild(hint);
  announceLive(switchedMessage);
  updateQuickNavStatus(switchedMessage);
  parentPanel.appendChild(renderIndoorNavigation(candidate.node, parentPanel));
}

async function moveQuickIndoorByBearing(bearing, parentPanel) {
  const currentNode = state.quickStreet.currentNode;
  if (!currentNode?.panoId || !Number.isFinite(currentNode.lat) || !Number.isFinite(currentNode.lon)) return;

  const decisionResp = await postJson("/api/streetview/indoor-step", {
    currentPanoId: currentNode.panoId,
    currentLat: Number(currentNode.lat),
    currentLon: Number(currentNode.lon),
    targetBearing: Number(bearing),
    stepMeters: 5,
    links: Array.isArray(state.quickStreet.availableLinks) ? state.quickStreet.availableLinks : [],
  });
  const decision = decisionResp?.decision || {};

  if (decision?.fallbackToManual) {
    const fallbackMessage = getIndoorLowConfidenceMessage("move");
    announceLive(fallbackMessage);
    updateQuickNavStatus(fallbackMessage);
    return;
  }

  if (decision?.mode === "link" && !confirmIndoorTransition(decision.selectedLink)) {
    return;
  }

  let streetData = null;
  let nextNode = null;
  if (decision?.mode === "link" && decision?.selectedLink?.panoId) {
    const resolved = await postJson("/api/streetview/resolve-pano", {
      userConfirmedPaidCall: true,
      panoId: decision.selectedLink.panoId,
      lat: Number(currentNode.lat),
      lon: Number(currentNode.lon),
    });
    const resolvedNode = resolved?.node || {};
    streetData = await postJson("/api/paid/streetview", {
      userConfirmedPaidCall: true,
      panoId: resolvedNode.panoId,
      lat: Number(resolvedNode.lat) || Number(currentNode.lat),
      lon: Number(resolvedNode.lon) || Number(currentNode.lon),
      heading: state.quickStreet.heading || 0,
      fov: 90,
      pitch: 0,
      language: getMapLanguage(),
      useLlm: false,
    });
    attachPanoramaProviderHint(streetData, resolvedNode);
    const links = Array.isArray(resolvedNode.links) && resolvedNode.links.length
      ? resolvedNode.links
      : await fetchStreetViewLinks(resolvedNode.panoId).catch(() => []);
    nextNode = {
      panoId: resolvedNode.panoId,
      lat: Number(resolvedNode.lat) || Number(currentNode.lat),
      lon: Number(resolvedNode.lon) || Number(currentNode.lon),
      isIndoor: Boolean(resolvedNode.isIndoor),
      links,
      providerHint: resolvedNode.providerHint || currentNode.providerHint || null,
    };
  } else if (decision?.mode === "offset" && Number.isFinite(Number(decision?.target?.lat)) && Number.isFinite(Number(decision?.target?.lon))) {
    const targetLat = Number(decision.target.lat);
    const targetLon = Number(decision.target.lon);
    streetData = await postJson("/api/paid/streetview", {
      userConfirmedPaidCall: true,
      lat: targetLat,
      lon: targetLon,
      heading: state.quickStreet.heading || 0,
      fov: 90,
      pitch: 0,
      language: getMapLanguage(),
      useLlm: false,
    });
    const pano = streetData?.panorama || {};
    if (!pano.panoId) {
      throw new Error(streetData?.text || t("indoorNeedManual"));
    }
    const links = await fetchStreetViewLinks(pano.panoId).catch(() => []);
    nextNode = {
      panoId: pano.panoId,
      lat: Number.isFinite(Number(pano.lat)) ? Number(pano.lat) : targetLat,
      lon: Number.isFinite(Number(pano.lon)) ? Number(pano.lon) : targetLon,
      isIndoor: Boolean(streetData?.indoorLikely),
      links,
      providerHint: pano.providerHint || currentNode.providerHint || null,
    };
  } else {
    throw new Error(t("indoorNeedManual"));
  }

  if (!streetData || !nextNode?.panoId) {
    throw new Error(t("indoorNeedManual"));
  }

  state.quickStreet.nodeHistory.push(currentNode);
  state.quickStreet.heading = bearing;
  state.quickStreet.currentNode = nextNode;
  state.quickStreet.availableLinks = nextNode.links || [];
  state.quickStreet.indoorCandidates = await refreshIndoorCandidatesAround(nextNode);
  state.quickStreet.selectedCandidateIndex = state.quickStreet.indoorCandidates.findIndex((c) => c?.node?.panoId === nextNode.panoId);

  parentPanel.classList.remove("error");
  parentPanel.innerHTML = "";
  parentPanel.appendChild(createStreetResultSection(attachPanoramaProviderHint(streetData, nextNode)));
  const movedMeters = Number(decision?.selectedLink?.distanceMeters);
  const message = buildIndoorMoveResultMessage(
    directionLabelFromBearing(bearing),
    Number.isFinite(movedMeters) ? Math.round(movedMeters) : "?",
    currentNode,
    nextNode,
    state.quickStreet.indoorCandidates,
  );
  appendIndoorStatus(parentPanel, message);
  parentPanel.appendChild(renderIndoorNavigation(nextNode, parentPanel));
  announceLive(message);
  updateQuickNavStatus(message);
}

async function navigateToLink(link, parentPanel) {
  try {
    if (!confirmIndoorTransition(link)) return;
    parentPanel.textContent = "載入中...";
    
    const nextNode = await postJson("/api/streetview/resolve-pano", {
      userConfirmedPaidCall: true,
      panoId: link.panoId,
    });

    if (!nextNode.ok) {
      parentPanel.classList.add("error");
      parentPanel.textContent = `錯誤: ${nextNode.error}`;
      return;
    }

    // Fetch links for the new panorama
    try {
      const links = Array.isArray(nextNode.node.links) && nextNode.node.links.length
        ? nextNode.node.links
        : await fetchStreetViewLinks(nextNode.node.panoId);
      if (links.length > 0 && (!nextNode.node.links || nextNode.node.links.length === 0)) {
        nextNode.node.links = links;
      }
    } catch (err) {
      console.warn("Failed to fetch links for next node:", err);
    }

    if (state.quickStreet.currentNode?.panoId) {
      state.quickStreet.nodeHistory.push(state.quickStreet.currentNode);
    }
    state.quickStreet.currentNode = nextNode.node;
    state.quickStreet.heading = Number(link.heading) || state.quickStreet.heading;
    state.quickStreet.availableLinks = nextNode.node.links || [];
    state.quickStreet.indoorCandidates = await refreshIndoorCandidatesAround(nextNode.node);
    state.quickStreet.selectedCandidateIndex = state.quickStreet.indoorCandidates.findIndex((c) => c?.node?.panoId === nextNode.node.panoId);
    
    // Re-render
    parentPanel.classList.remove("error");
    parentPanel.innerHTML = "";
    
    const streetSection = createStreetResultSection({
      ok: true,
      provider: "streetview",
      hasStreetView: true,
      indoorLikely: nextNode.node.isIndoor,
      panorama: {
        panoId: nextNode.node.panoId,
        description: "室內街景",
        links: nextNode.node.links,
        providerHint: nextNode.node.providerHint || null,
      },
    });
    parentPanel.appendChild(streetSection);
    
    if (nextNode.node.isIndoor || (nextNode.node.links && nextNode.node.links.length > 0)) {
      parentPanel.appendChild(renderIndoorNavigation(nextNode.node, parentPanel));
    }
  } catch (err) {
    parentPanel.classList.add("error");
    parentPanel.textContent = `${t("errorPrefix")}${err.message}`;
  }
}

async function analyzeWithLlm(node, parentPanel) {
  try {
    if (!node.links || node.links.length === 0) {
      alert("此節點無可分析的方向");
      return;
    }

    const link = node.links[0];
    const result = await postJson("/api/streetview/analyze-link", {
      userConfirmedPaidCall: true,
      panoId: node.panoId,
      heading: link.heading,
      description: link.description,
      fov: 90,
      pitch: 0,
      language: getMapLanguage(),
    });

    if (!result.ok) {
      alert(`分析失敗: ${result.error}`);
      return;
    }

    alert(`分析結果: ${result.label}\n描述: ${result.cvAnalysis}`);
  } catch (err) {
    alert(`${t("errorPrefix")}${err.message}`);
  }
}

async function tryFindIndoorEntry(row, heading, panel) {
  panel.classList.remove("error");
  panel.textContent = t("queryLoading");

  const key = `quick-indoor-entry:${row.id}:${state.uiLang}`;
  let entry = state.queryCache.get(key);
  if (!entry) {
    entry = await postJson("/api/streetview/find-indoor-entry", {
      lat: row.lat,
      lon: row.lon,
      radiusMeters: 220,
    });
    state.queryCache.set(key, entry);
  }

  if (!entry.ok || !entry.found || !entry.node?.panoId) {
    panel.classList.add("error");
    panel.textContent = entry.error || t("indoorNoEntry");
    return;
  }

  if (entry.node.imageryType !== "indoor") {
    panel.classList.add("error");
    panel.textContent = t("indoorNoEntry");
    return;
  }
  const candidates = Array.isArray(entry.candidates)
    ? entry.candidates.filter((candidate) => candidate?.node?.imageryType === "indoor")
    : [];
  await hydrateIndoorNodeLinks(entry.node);
  await Promise.all(candidates.map((candidate) => hydrateIndoorNodeLinks(candidate?.node)));

  const streetData = await postJson("/api/paid/streetview", {
    userConfirmedPaidCall: true,
    panoId: entry.node.panoId,
    lat: Number(entry.node.lat) || row.lat,
    lon: Number(entry.node.lon) || row.lon,
    heading,
    fov: 90,
    pitch: 0,
    language: getMapLanguage(),
    useLlm: false,
  });

  panel.innerHTML = "";
  panel.appendChild(createStreetResultSection(attachPanoramaProviderHint(streetData, entry.node)));

  const hint = document.createElement("div");
  hint.className = "minor";
  const switchedMessage = tf("indoorSwitched", { meters: Math.round(Number(entry.distanceMeters) || 0) });
  hint.textContent = switchedMessage;
  panel.appendChild(hint);
  announceLive(switchedMessage);
  updateQuickNavStatus(switchedMessage);

  if (entry?.fallbackToManual) {
    const fallbackMessage = getIndoorLowConfidenceMessage("entry");
    const fallbackHint = document.createElement("div");
    fallbackHint.className = "minor";
    fallbackHint.textContent = fallbackMessage;
    panel.appendChild(fallbackHint);
    announceLive(fallbackMessage);
    updateQuickNavStatus(fallbackMessage);
  }

  state.quickStreet.navigationMode = "indoor-graph";
  state.quickStreet.currentNode = entry.node;
  state.quickStreet.availableLinks = entry.node.links || [];
  state.quickStreet.nodeHistory = [];
  state.quickStreet.indoorCandidates = candidates;
  state.quickStreet.selectedCandidateIndex = candidates.findIndex((c) => c?.node?.panoId === entry.node.panoId);

  const advBtn = $("quickStreetAdvanceBtn");
  if (advBtn) advBtn.style.display = "none";

  panel.appendChild(renderIndoorNavigation(entry.node, panel));
}

async function runQuickIndoorNavigation() {
  const row = state.intersections[state.focusedIndex];
  const panel = $("quickNavIndoor");
  if (!row || !panel) return;

  const blocked = getPaidBlockedMessage();
  if (blocked) {
    panel.classList.add("error");
    panel.textContent = blocked;
    return;
  }

  const heading = row.bearingToNext ?? 0;
  try {
    await tryFindIndoorEntry(row, heading, panel);
  } catch (err) {
    panel.classList.add("error");
    panel.textContent = `${t("errorPrefix")}${err.message}`;
  }
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

    // Fetch Street View Links if available
    if (data.ok && data.panorama?.panoId && data.indoorLikely) {
      try {
        const resolved = await postJson("/api/streetview/resolve-pano", {
          panoId: data.panorama.panoId,
          lat: data.panorama.lat,
          lon: data.panorama.lon,
        });
        const links = Array.isArray(resolved?.node?.links) && resolved.node.links.length
          ? resolved.node.links
          : await fetchStreetViewLinks(data.panorama.panoId);
        if (links.length > 0 && data.panorama) {
          data.panorama.links = links;
          data.panorama.imageryType = resolved?.node?.imageryType || data.panorama.imageryType || "unknown";
        }
      } catch (err) {
        console.warn("Failed to fetch links:", err);
        // Continue without links
      }
    }

    panel.innerHTML = "";
    panel.appendChild(createStreetResultSection(data));
    
    // If indoor with links, set up navigation mode
    if (data?.indoorLikely && data?.panorama?.links && data.panorama.links.length > 0) {
      state.quickStreet.navigationMode = "indoor-graph";
      state.quickStreet.currentNode = {
        panoId: data.panorama.panoId,
        lat: data.panorama.lat,
        lon: data.panorama.lon,
        isIndoor: true,
        imageryType: data.panorama.imageryType || "indoor",
        links: data.panorama.links,
        providerHint: data.panorama.providerHint || null
      };
      state.quickStreet.availableLinks = data.panorama.links;
      state.quickStreet.nodeHistory = [];
      
      // Show indoor navigation UI
      panel.appendChild(renderIndoorNavigation(state.quickStreet.currentNode, panel));
    } else {
      state.quickStreet.navigationMode = "outdoor-linear";
      state.quickStreet.currentNode = null;
      state.quickStreet.availableLinks = [];
      state.quickStreet.nodeHistory = [];
    }
    
    state.quickStreet.indoorCandidates = [];
    state.quickStreet.selectedCandidateIndex = -1;

    const advBtn = $("quickStreetAdvanceBtn");
    if (advBtn) {
      advBtn.style.display = state.quickStreet.navigationMode === "outdoor-linear" ? "block" : "none";
    }
    
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
    state.quickStreet.navigationMode = "outdoor-linear";
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

    const section = createStreetResultSection(data, tf("advanceSectionLabel", { distance: nextOffset }));
    panel.appendChild(section);

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
  void refreshQuickDpButtonState();
}

function setBusy(btn, busy) {
  if (!btn) return;
  if (busy) {
    btn.disabled = true;
    btn.dataset.originalText = btn.textContent;
    btn.textContent = t("loading");
  } else {
    btn.disabled = false;
    if (btn.dataset.originalText !== undefined) {
      btn.textContent = btn.dataset.originalText;
      delete btn.dataset.originalText;
    }
  }
}

async function loadRoadByName(roadName, options = {}) {
  const btn = $("loadRoadBtn");
  try {
    setBusy(btn, true);
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

    const segmentPayload = { roadName: resolvedRoadName, countryCode };
    if (geocodeFocusPoint) {
      segmentPayload.focusLat = geocodeFocusPoint.lat;
      segmentPayload.focusLon = geocodeFocusPoint.lon;
    }
    const data = await postJson("/api/overpass/segment", segmentPayload);
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
  const raw = String(text || "");
  const idx = raw.indexOf("\n\n");
  const body = idx >= 0 ? raw.slice(idx + 2).trim() : raw.trim();
  return sanitizeStreetSummaryText(body);
}

function getStreetScenes(data) {
  if (!data || !Array.isArray(data.scenes)) return [];
  return data.scenes
    .map((scene) => ({
      label: String(scene?.label || ""),
      heading: Number(scene?.heading || 0),
      description: String(scene?.description || "").trim(),
      imageUrl: String(scene?.imageUrl || "").trim(),
    }))
    .filter((scene) => scene.label && scene.imageUrl);
}

function createStreetResultSection(data, titleText = "") {
  const section = document.createElement("div");
  section.className = "street-section";

  if (titleText) {
    const label = document.createElement("div");
    label.className = "street-advance-label";
    label.textContent = titleText;
    section.appendChild(label);
  }

  if (!data || data.hasStreetView === false) {
    const empty = document.createElement("div");
    empty.textContent = extractStreetBlocks(data?.text || "");
    section.appendChild(empty);
    return section;
  }

  const intro = document.createElement("div");
  intro.className = "street-summary";
  intro.textContent = extractStreetBlocks(data?.text || "");
  section.appendChild(intro);

  if (data?.panorama?.providerHint) {
    const provider = document.createElement("div");
    provider.className = "minor indoor-provider";
    provider.textContent = tf("indoorProvider", { provider: providerLabel(data) });
    section.appendChild(provider);
  }

  const scenes = getStreetScenes(data);
  if (!scenes.length) {
    return section;
  }

  const viewer = document.createElement("div");
  viewer.className = "street-pano-viewer";

  const img = document.createElement("img");
  img.className = "street-pano-image";
  img.alt = "Street View panorama scene";
  img.loading = "lazy";

  const caption = document.createElement("div");
  caption.className = "street-pano-caption";

  const sceneButtons = document.createElement("div");
  sceneButtons.className = "street-scene-buttons";

  const llmSummary = document.createElement("div");
  llmSummary.className = "street-pano-caption";

  const followupBox = document.createElement("div");
  followupBox.className = "indoor-followup";
  followupBox.hidden = true;

  const followupInput = document.createElement("textarea");
  followupInput.className = "indoor-followup-input";
  followupInput.rows = 3;
  followupInput.placeholder = t("indoorFollowupPlaceholder");
  followupBox.appendChild(followupInput);

  const followupActions = document.createElement("div");
  followupActions.className = "indoor-followup-actions";
  const followupBtn = document.createElement("button");
  followupBtn.type = "button";
  followupBtn.className = "street-scene-btn paid";
  followupBtn.textContent = t("indoorFollowupAsk");
  followupActions.appendChild(followupBtn);
  followupBox.appendChild(followupActions);

  const followupResult = document.createElement("div");
  followupResult.className = "street-pano-caption";
  followupBox.appendChild(followupResult);

  let activeIndex = 0;
  let panoramaStripBase64 = "";
  let panoramaDescription = "";
  const applyScene = () => {
    const scene = scenes[activeIndex];
    img.src = scene.imageUrl;
    const headingLabel = `${scene.label} (${Math.round(scene.heading)}°)`;
    caption.textContent = isDisabledLlmDescription(scene.description) || !scene.description
      ? headingLabel
      : `${headingLabel}: ${scene.description}`;
    for (let i = 0; i < sceneButtons.children.length; i += 1) {
      const btn = sceneButtons.children[i];
      if (btn instanceof HTMLButtonElement) {
        btn.classList.toggle("active", i === activeIndex);
      }
    }
  };

  scenes.forEach((scene, idx) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "street-scene-btn";
    btn.textContent = `${scene.label} (${Math.round(scene.heading)}°)`;
    btn.addEventListener("click", () => {
      activeIndex = idx;
      applyScene();
    });
    sceneButtons.appendChild(btn);
  });

  const describeBtn = document.createElement("button");
  describeBtn.type = "button";
  describeBtn.className = "street-scene-btn paid";
  describeBtn.textContent = t("indoorDescribeEnv");
  describeBtn.addEventListener("click", async () => {
    const blocked = getPaidBlockedMessage();
    if (blocked) {
      llmSummary.textContent = blocked;
      announceLive(blocked);
      return;
    }
    describeBtn.disabled = true;
    llmSummary.textContent = t("indoorDescribeLoading");
    announceLive(t("indoorDescribeLoading"));
    try {
      panoramaStripBase64 = panoramaStripBase64 || await composePanoramaStripBase64(scenes);
      const result = await postJson("/api/paid/streetview/panorama-describe", {
        userConfirmedPaidCall: true,
        language: getMapLanguage(),
        imageBase64: panoramaStripBase64,
      });
      panoramaDescription = String(result.description || "").trim();
      const resultText = tf("indoorDescribeResult", { text: panoramaDescription });
      llmSummary.textContent = resultText;
      followupBox.hidden = false;
      announceLive(resultText);
    } catch (err) {
      const msg = `${t("errorPrefix")}${err.message}`;
      llmSummary.textContent = msg;
      announceLive(msg);
    } finally {
      describeBtn.disabled = false;
    }
  });
  sceneButtons.appendChild(describeBtn);

  followupBtn.addEventListener("click", async () => {
    const question = followupInput.value.trim();
    if (!question) return;
    const blocked = getPaidBlockedMessage();
    if (blocked) {
      followupResult.textContent = blocked;
      announceLive(blocked);
      return;
    }
    followupBtn.disabled = true;
    followupResult.textContent = t("indoorFollowupLoading");
    announceLive(t("indoorFollowupLoading"));
    try {
      panoramaStripBase64 = panoramaStripBase64 || await composePanoramaStripBase64(scenes);
      const result = await postJson("/api/paid/streetview/panorama-describe", {
        userConfirmedPaidCall: true,
        language: getMapLanguage(),
        imageBase64: panoramaStripBase64,
        question,
        context: panoramaDescription,
      });
      const answer = String(result.description || "").trim();
      followupResult.textContent = answer;
      announceLive(answer);
    } catch (err) {
      const msg = `${t("errorPrefix")}${err.message}`;
      followupResult.textContent = msg;
      announceLive(msg);
    } finally {
      followupBtn.disabled = false;
    }
  });

  viewer.appendChild(img);
  viewer.appendChild(sceneButtons);
  viewer.appendChild(caption);
  viewer.appendChild(llmSummary);
  viewer.appendChild(followupBox);
  section.appendChild(viewer);

  if (data?.indoorLikely) {
    const indoorHint = document.createElement("div");
    indoorHint.className = "minor";
    indoorHint.textContent = "Indoor panorama likely";
    section.appendChild(indoorHint);
  }

  applyScene();
  return section;
}

function loadImageForCompose(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load panorama image"));
    img.src = url;
  });
}

async function composePanoramaStripBase64(scenes) {
  const useScenes = scenes.slice(0, 4);
  if (!useScenes.length) {
    throw new Error("No panorama scenes available");
  }
  const images = await Promise.all(useScenes.map((scene) => loadImageForCompose(scene.imageUrl)));
  const baseWidth = Number(images[0].naturalWidth || images[0].width || 640);
  const baseHeight = Number(images[0].naturalHeight || images[0].height || 480);
  const canvas = document.createElement("canvas");
  canvas.width = baseWidth * images.length;
  canvas.height = baseHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas context unavailable");
  }
  for (let i = 0; i < images.length; i += 1) {
    ctx.drawImage(images[i], i * baseWidth, 0, baseWidth, baseHeight);
  }
  const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
  const idx = dataUrl.indexOf(",");
  return idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
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
  try {
    setBusy(btn, true);
  } catch {}
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
  const streetUsd = 2 * (PRICES.streetViewStatic + PRICES.llmGenerate);
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

  const indoorDetails = document.createElement("details");
  indoorDetails.className = "query-details";
  const indoorSummary = document.createElement("summary");
  indoorSummary.className = "query-summary paid-summary";
  indoorSummary.textContent = t("indoorNav");
  indoorDetails.appendChild(indoorSummary);
  const indoorResult = document.createElement("div");
  indoorResult.className = "result";
  indoorDetails.appendChild(indoorResult);
  card.appendChild(indoorDetails);

  let streetLoading = false;
  let routeOsmLoading = false;
  let routeGoogleLoading = false;
  let indoorLoading = false;

  let indoorNode = null;
  let indoorHistory = [];
  let indoorCandidates = [];
  let selectedIndoorCandidate = -1;
  let indoorHeading = row.bearingToNext ?? 0;

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
      const initSection = createStreetResultSection(data);
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
          const advSection = createStreetResultSection(advData, tf("advanceSectionLabel", { distance: advanceOffset }));
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

  function renderCardIndoorControls() {
    const controls = document.createElement("div");
    controls.className = "pano-links";

    if (indoorNode?.panoId) {
      const provider = document.createElement("div");
      provider.className = "minor indoor-provider";
      provider.textContent = tf("indoorProvider", { provider: providerLabel(indoorNode) });
      controls.appendChild(provider);
    }

    if (indoorHistory.length > 0) {
      const backBtn = document.createElement("button");
      backBtn.type = "button";
      backBtn.className = "link-button";
      backBtn.textContent = t("indoorBackPrev");
      backBtn.addEventListener("click", async () => {
        if (!indoorHistory.length) return;
        const prev = indoorHistory.pop();
        if (!prev?.panoId) return;
        const prevData = await postJson("/api/paid/streetview", {
          userConfirmedPaidCall: true,
          panoId: prev.panoId,
          lat: Number(prev.lat) || row.lat,
          lon: Number(prev.lon) || row.lon,
          heading: row.bearingToNext ?? 0,
          fov: 90,
          pitch: 0,
          language: getMapLanguage(),
          useLlm: false,
        });
        indoorNode = prev;
        indoorCandidates = await refreshIndoorCandidatesAround(indoorNode);
        selectedIndoorCandidate = indoorCandidates.findIndex((c) => c?.node?.panoId === indoorNode.panoId);
        indoorResult.innerHTML = "";
        indoorResult.appendChild(createStreetResultSection(attachPanoramaProviderHint(prevData, indoorNode)));
        indoorResult.appendChild(renderCardIndoorControls());
        const msg = t("indoorBackPrev");
        announceLive(msg);
        updateQuickNavStatus(msg);
      });
      controls.appendChild(backBtn);
    }

    if (indoorCandidates.length > 1) {
      for (let i = 0; i < indoorCandidates.length; i += 1) {
        const c = indoorCandidates[i];
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "link-button";
        btn.textContent = formatIndoorCandidateButton(c, i, indoorNode, i === selectedIndoorCandidate);
        btn.title = formatIndoorCandidateTooltip(c, i, indoorNode);
        btn.addEventListener("click", async () => {
          if (!c?.node?.panoId) return;
          if (!confirmIndoorCandidateTransition(indoorNode, c)) return;
          await hydrateIndoorNodeLinks(c.node);
          if (indoorNode?.panoId && indoorNode.panoId !== c.node.panoId) {
            indoorHistory.push(indoorNode);
          }
          const switched = await postJson("/api/paid/streetview", {
            userConfirmedPaidCall: true,
            panoId: c.node.panoId,
            lat: Number(c.node.lat) || row.lat,
            lon: Number(c.node.lon) || row.lon,
            heading: row.bearingToNext ?? 0,
            fov: 90,
            pitch: 0,
            language: getMapLanguage(),
            useLlm: false,
          });
          indoorNode = c.node;
          selectedIndoorCandidate = i;
          indoorResult.innerHTML = "";
          indoorResult.appendChild(createStreetResultSection(attachPanoramaProviderHint(switched, indoorNode)));
          const hint = document.createElement("div");
          hint.className = "minor";
          const switchedMessage = tf("indoorSwitchedCandidate", {
            label: String.fromCharCode(65 + i),
            meters: Math.round(Number(c.distanceMeters) || 0),
          });
          hint.textContent = switchedMessage;
          indoorResult.appendChild(hint);
          indoorResult.appendChild(renderCardIndoorControls());
          announceLive(switchedMessage);
          updateQuickNavStatus(switchedMessage);
        });
        controls.appendChild(btn);
      }
    }

    const absoluteButtons = [];
    const stepDirections = [
      { bearing: 0, key: "dirN" },
      { bearing: 45, key: "dirNE" },
      { bearing: 90, key: "dirE" },
      { bearing: 135, key: "dirSE" },
      { bearing: 180, key: "dirS" },
      { bearing: 225, key: "dirSW" },
      { bearing: 270, key: "dirW" },
      { bearing: 315, key: "dirNW" },
    ];
    for (const dir of stepDirections) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "link-button";
      const bestLink = getBestIndoorMoveLink(indoorNode?.links, dir.bearing);
      if (!bestLink) {
        btn.textContent = tf("indoorMoveBy", { direction: t(dir.key), meters: "?" });
        btn.disabled = true;
        btn.title = t("indoorMoveUnavailable");
        btn.setAttribute("aria-disabled", "true");
      } else {
        btn.textContent = formatIndoorLinkSummary(bestLink.link);
        btn.title = `${bestLink.link.label || bestLink.link.description || ""} (${Math.round(bestLink.link.heading)}°, Δ${bestLink.delta}°)`;
      }
      btn.addEventListener("click", async () => {
        if (!indoorNode?.panoId || !Number.isFinite(Number(indoorNode?.lat)) || !Number.isFinite(Number(indoorNode?.lon))) return;
        const decisionResp = await postJson("/api/streetview/indoor-step", {
          currentPanoId: indoorNode.panoId,
          currentLat: Number(indoorNode.lat),
          currentLon: Number(indoorNode.lon),
          targetBearing: Number(dir.bearing),
          stepMeters: 5,
          links: Array.isArray(indoorNode.links) ? indoorNode.links : [],
        });
        const decision = decisionResp?.decision || {};
        if (decision?.fallbackToManual) {
          const fallbackMessage = getIndoorLowConfidenceMessage("move");
          announceLive(fallbackMessage);
          updateQuickNavStatus(fallbackMessage);
          return;
        }
        if (decision?.mode === "link" && !confirmIndoorTransition(decision.selectedLink)) {
          return;
        }

        let movedData = null;
        let movedPano = null;
        let resolvedNode = null;
        const previousIndoorNode = indoorNode;
        if (decision?.mode === "link" && decision?.selectedLink?.panoId) {
          const resolved = await postJson("/api/streetview/resolve-pano", {
            userConfirmedPaidCall: true,
            panoId: decision.selectedLink.panoId,
            lat: Number(indoorNode.lat),
            lon: Number(indoorNode.lon),
          });
          resolvedNode = resolved?.node || {};
          movedData = await postJson("/api/paid/streetview", {
            userConfirmedPaidCall: true,
            panoId: resolvedNode.panoId,
            lat: Number(resolvedNode.lat) || Number(indoorNode.lat),
            lon: Number(resolvedNode.lon) || Number(indoorNode.lon),
            heading: row.bearingToNext ?? 0,
            fov: 90,
            pitch: 0,
            language: getMapLanguage(),
            useLlm: false,
          });
          attachPanoramaProviderHint(movedData, resolvedNode);
          movedPano = movedData?.panorama || {};
        } else if (decision?.mode === "offset" && Number.isFinite(Number(decision?.target?.lat)) && Number.isFinite(Number(decision?.target?.lon))) {
          movedData = await postJson("/api/paid/streetview", {
            userConfirmedPaidCall: true,
            lat: Number(decision.target.lat),
            lon: Number(decision.target.lon),
            heading: row.bearingToNext ?? 0,
            fov: 90,
            pitch: 0,
            language: getMapLanguage(),
            useLlm: false,
          });
          movedPano = movedData?.panorama || {};
        }

        if (!movedPano?.panoId) {
          throw new Error(t("indoorNeedManual"));
        }

        const links = Array.isArray(resolvedNode?.links) && resolvedNode.links.length
          ? resolvedNode.links
          : await fetchStreetViewLinks(movedPano.panoId).catch(() => []);
        if (indoorNode?.panoId) {
          indoorHistory.push(indoorNode);
        }
        indoorHeading = dir.bearing;
        indoorNode = {
          panoId: movedPano.panoId,
          lat: Number.isFinite(Number(movedPano.lat)) ? Number(movedPano.lat) : Number(indoorNode.lat),
          lon: Number.isFinite(Number(movedPano.lon)) ? Number(movedPano.lon) : Number(indoorNode.lon),
          isIndoor: Boolean(movedData?.indoorLikely),
          imageryType: resolvedNode?.imageryType || movedPano.imageryType || (movedData?.indoorLikely ? "indoor" : "unknown"),
          links,
          providerHint: movedPano.providerHint || indoorNode?.providerHint || null,
        };
        indoorCandidates = await refreshIndoorCandidatesAround(indoorNode);
        selectedIndoorCandidate = indoorCandidates.findIndex((c) => c?.node?.panoId === indoorNode.panoId);
        indoorResult.innerHTML = "";
        indoorResult.appendChild(createStreetResultSection(attachPanoramaProviderHint(movedData, indoorNode)));
        const movedMeters = Number(decision?.selectedLink?.distanceMeters);
        const movedMsg = buildIndoorMoveResultMessage(
          t(dir.key),
          Number.isFinite(movedMeters) ? Math.round(movedMeters) : "?",
          previousIndoorNode,
          indoorNode,
          indoorCandidates,
        );
        appendIndoorStatus(indoorResult, movedMsg);
        indoorResult.appendChild(renderCardIndoorControls());
        announceLive(movedMsg);
        updateQuickNavStatus(movedMsg);
      });
      controls.appendChild(btn);
      absoluteButtons.push({ bearing: dir.bearing, button: btn });
    }

    const relativeControls = renderRelativeIndoorControls(indoorHeading, indoorNode?.links || [], async (bearing) => {
      const closest = [...absoluteButtons].sort((a, b) =>
        bearingDeltaAbs(bearing, a.bearing) - bearingDeltaAbs(bearing, b.bearing))[0];
      closest?.button.click();
    });
    if (absoluteButtons.length) {
      controls.insertBefore(relativeControls, absoluteButtons[0].button);
    } else {
      controls.appendChild(relativeControls);
    }

    return controls;
  }

  async function runIndoorQuery() {
    if (indoorLoading || !indoorDetails.open) return;
    const blocked = getPaidBlockedMessage();
    if (blocked) {
      indoorResult.classList.add("error");
      indoorResult.textContent = blocked;
      return;
    }
    indoorLoading = true;
    indoorResult.classList.remove("error");
    indoorResult.textContent = t("queryLoading");
    try {
      const indoorCacheKey = `indoor:${state.roadName}:${row.id}:${state.uiLang}`;
      let entry = state.queryCache.get(indoorCacheKey);
      if (!entry) {
        entry = await postJson("/api/streetview/find-indoor-entry", {
          lat: row.lat,
          lon: row.lon,
          radiusMeters: 220,
        });
        state.queryCache.set(indoorCacheKey, entry);
      }

      if (!entry.ok || !entry.found || !entry.node?.panoId) {
        throw new Error(entry.error || t("indoorNoEntry"));
      }

      const targetData = await postJson("/api/paid/streetview", {
        userConfirmedPaidCall: true,
        panoId: entry.node.panoId,
        lat: Number(entry.node.lat) || row.lat,
        lon: Number(entry.node.lon) || row.lon,
        heading: row.bearingToNext ?? 0,
        fov: 90,
        pitch: 0,
        language: getMapLanguage(),
        useLlm: false,
      });

      indoorNode = entry.node;
      indoorHistory = [];
      if (entry.node.imageryType !== "indoor") {
        throw new Error(t("indoorNoEntry"));
      }
      indoorCandidates = Array.isArray(entry.candidates)
        ? entry.candidates.filter((candidate) => candidate?.node?.imageryType === "indoor")
        : [];
      await hydrateIndoorNodeLinks(indoorNode);
      await Promise.all(indoorCandidates.map((candidate) => hydrateIndoorNodeLinks(candidate?.node)));
      selectedIndoorCandidate = indoorCandidates.findIndex((c) => c?.node?.panoId === entry.node.panoId);

      indoorResult.innerHTML = "";
      indoorResult.appendChild(createStreetResultSection(attachPanoramaProviderHint(targetData, indoorNode)));
      const hint = document.createElement("div");
      hint.className = "minor";
      hint.textContent = tf("indoorSwitched", { meters: Math.round(Number(entry.distanceMeters) || 0) });
      indoorResult.appendChild(hint);
      if (entry?.fallbackToManual) {
        const fallbackHint = document.createElement("div");
        fallbackHint.className = "minor";
        fallbackHint.textContent = getIndoorLowConfidenceMessage("entry");
        indoorResult.appendChild(fallbackHint);
        announceLive(getIndoorLowConfidenceMessage("entry"));
        updateQuickNavStatus(getIndoorLowConfidenceMessage("entry"));
      }
      indoorResult.appendChild(renderCardIndoorControls());
    } catch (err) {
      indoorResult.classList.add("error");
      indoorResult.textContent = `${t("errorPrefix")}${err.message}`;
    } finally {
      indoorLoading = false;
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
  indoorDetails.addEventListener("toggle", () => {
    if (indoorDetails.open) void runIndoorQuery();
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
    let msg;
    if (!state.searchAttempted) {
      msg = t("noIntersectionsBefore");
    } else if (state.lastSearchWarning) {
      msg = state.lastSearchWarning;
    } else {
      msg = t("noIntersectionsAfter");
    }
    const p = document.createElement("p");
    p.className = "search-notice";
    p.textContent = msg;
    container.appendChild(p);
    $("quickNavOsm").textContent = "";
    $("quickNavStreet").textContent = "";
    if ($("quickNavIndoor")) {
      $("quickNavIndoor").textContent = "";
    }
    refreshQuickStreetButtonState();
    refreshQuickStreetAdvanceButton();
    refreshQuickIndoorButtonState();
    return;
  }

  state.intersections.forEach((row, index) => {
    container.appendChild(createCard(row, index, state.intersections.length));
  });

  renderCosts();
  refreshQuickStreetButtonState();
  refreshQuickStreetAdvanceButton();
  refreshQuickIndoorButtonState();
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
  syncCountryPreferenceByUiLang();
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

$("quickIndoorBtn").addEventListener("click", () => {
  void runQuickIndoorNavigation();
});

$("quickDpBtn").addEventListener("click", () => {
  void runQuickDpExploration();
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
syncCountryPreferenceByUiLang();
renderIntersections();
refreshQuickStreetButtonState();
refreshQuickStreetAdvanceButton();
refreshQuickIndoorButtonState();

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
