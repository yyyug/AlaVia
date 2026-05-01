const PRICES = {
  placesNearby: 0.032,
  streetViewStatic: 0.007,
  visionAnnotate: 0.0015,
};

const $ = (id) => document.getElementById(id);

const state = {
  roadName: "",
  intersections: [],
  focusedIndex: 0,
  searchAttempted: false,
  lastSearchWarning: "",
};

const REGION_CODES = [
  "AD","AE","AF","AG","AI","AL","AM","AO","AQ","AR","AS","AT","AU","AW","AX","AZ","BA","BB","BD","BE","BF","BG","BH","BI","BJ","BL","BM","BN","BO","BQ","BR","BS","BT","BV","BW","BY","BZ","CA","CC","CD","CF","CG","CH","CI","CK","CL","CM","CN","CO","CR","CU","CV","CW","CX","CY","CZ","DE","DJ","DK","DM","DO","DZ","EC","EE","EG","EH","ER","ES","ET","FI","FJ","FK","FM","FO","FR","GA","GB","GD","GE","GF","GG","GH","GI","GL","GM","GN","GP","GQ","GR","GS","GT","GU","GW","GY","HK","HM","HN","HR","HT","HU","ID","IE","IL","IM","IN","IO","IQ","IR","IS","IT","JE","JM","JO","JP","KE","KG","KH","KI","KM","KN","KP","KR","KW","KY","KZ","LA","LB","LC","LI","LK","LR","LS","LT","LU","LV","LY","MA","MC","MD","ME","MF","MG","MH","MK","ML","MM","MN","MO","MP","MQ","MR","MS","MT","MU","MV","MW","MX","MY","MZ","NA","NC","NE","NF","NG","NI","NL","NO","NP","NR","NU","NZ","OM","PA","PE","PF","PG","PH","PK","PL","PM","PN","PR","PS","PT","PW","PY","QA","RE","RO","RS","RU","RW","SA","SB","SC","SD","SE","SG","SH","SI","SJ","SK","SL","SM","SN","SO","SR","SS","ST","SV","SX","SY","SZ","TC","TD","TF","TG","TH","TJ","TK","TL","TM","TN","TO","TR","TT","TV","TW","TZ","UA","UG","UM","US","UY","UZ","VA","VC","VE","VG","VI","VN","VU","WF","WS","YE","YT","ZA","ZM","ZW",
];

function initCountryOptions() {
  const select = $("countryCode");
  if (!select) {
    return;
  }

  const enDisplay = new Intl.DisplayNames(["en"], { type: "region" });
  const zhDisplay = new Intl.DisplayNames(["zh-Hant"], { type: "region" });

  const options = REGION_CODES
    .map((code) => {
      const en = enDisplay.of(code) || code;
      const zh = zhDisplay.of(code) || code;
      const label = en === zh ? en : `${en} ${zh}`;
      return { code, en, label };
    })
    .sort((a, b) => a.en.localeCompare(b.en, "en", { sensitivity: "base" }));

  select.innerHTML = "";
  for (const item of options) {
    const opt = document.createElement("option");
    opt.value = item.code;
    opt.textContent = item.label;
    if (item.code === "TW") {
      opt.selected = true;
    }
    select.appendChild(opt);
  }
}

function getBBox() {
  return {
    south: Number($("bboxSouth").value),
    west: Number($("bboxWest").value),
    north: Number($("bboxNorth").value),
    east: Number($("bboxEast").value),
  };
}

function getSampleInterval() {
  return Math.max(10, Number($("sampleInterval").value || 50));
}

function getCountryCode() {
  const v = String($("countryCode")?.value || "TW").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(v) ? v : "TW";
}

function getTtsLang() {
  return String($("ttsLang")?.value || "zh-TW").trim() || "zh-TW";
}

function expandBBox(bbox, factor = 2) {
  const centerLat = (Number(bbox.south) + Number(bbox.north)) / 2;
  const centerLon = (Number(bbox.west) + Number(bbox.east)) / 2;
  const halfLat = (Math.abs(Number(bbox.north) - Number(bbox.south)) / 2) * factor;
  const halfLon = (Math.abs(Number(bbox.east) - Number(bbox.west)) / 2) * factor;
  return {
    south: centerLat - halfLat,
    west: centerLon - halfLon,
    north: centerLat + halfLat,
    east: centerLon + halfLon,
  };
}

function formatUsd(v) {
  return `$${v.toFixed(3)}`;
}

function estimateCosts() {
  const count = state.intersections.length;
  const places = { calls: count, usd: count * PRICES.placesNearby };

  const streetCalls = count * 6;
  const streetUsd = count * 3 * (PRICES.streetViewStatic + PRICES.visionAnnotate);

  const interval = getSampleInterval();
  let routeSamples = 0;
  for (let i = 0; i < state.intersections.length - 1; i += 1) {
    const dist = Number(state.intersections[i].distanceToNext || 0);
    routeSamples += Math.max(1, Math.ceil(dist / interval));
  }
  const routeCalls = routeSamples * 2;
  const routeUsd = routeSamples * (PRICES.streetViewStatic + PRICES.visionAnnotate);

  return {
    places,
    street: { calls: streetCalls, usd: streetUsd },
    route: { calls: routeCalls, usd: routeUsd, samples: routeSamples, interval },
  };
}

function renderCosts() {
  if (state.intersections.length === 0) {
    $("costs").innerText = "尚未載入路口資料。";
    return;
  }

  const c = estimateCosts();
  const totalUsd = c.places.usd + c.street.usd + c.route.usd;
  $("costs").innerText = [
    `查詢周邊地標：${c.places.calls} 次，預估 ${formatUsd(c.places.usd)}`,
    `展開街景詳細描述：${c.street.calls} 次，預估 ${formatUsd(c.street.usd)}`,
    `沿路景物（每 ${c.route.interval}m）：${c.route.calls} 次（採樣 ${c.route.samples} 點），預估 ${formatUsd(c.route.usd)}`,
    `總計預估（全部路口都查一次）：${formatUsd(totalUsd)}`,
  ].join("\n");
}

async function postJson(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
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
    btn.textContent = "載入中...";
  } else {
    btn.textContent = btn.dataset.label || btn.textContent;
  }
}

function escapeHtml(s) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

let spokenText = "";

function renderReadingText(text, activeStart = -1, activeLength = 0) {
  const container = $("readingText");
  if (!text) {
    container.textContent = "";
    return;
  }

  if (activeStart < 0) {
    container.textContent = text;
    return;
  }

  const a = text.slice(0, activeStart);
  const b = text.slice(activeStart, activeStart + Math.max(1, activeLength));
  const c = text.slice(activeStart + Math.max(1, activeLength));
  container.innerHTML = `${escapeHtml(a)}<span class="active">${escapeHtml(b)}</span>${escapeHtml(c)}`;
}

function readText(text) {
  spokenText = text;
  renderReadingText(spokenText);

  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = getTtsLang();

  utter.onboundary = (event) => {
    renderReadingText(spokenText, event.charIndex, event.charLength || 1);
  };
  utter.onend = () => {
    renderReadingText(spokenText);
  };

  speechSynthesis.cancel();
  speechSynthesis.speak(utter);
}

function intersectionSummary(i) {
  const row = state.intersections[i];
  if (!row) {
    return "目前沒有焦點路口。";
  }

  return [
    `路口 ${i + 1}：${row.name}`,
    `路口型態：${row.type || "未知"}`,
    row.crossStreets?.length ? `相交道路：${row.crossStreets.join("、")}` : "相交道路：未知",
    row.distanceToNext ? `往${row.directionToNext}約 ${Math.round(row.distanceToNext)} 公尺到下一路口` : "此路口為最後一個路口",
  ].join("\n");
}

function setBBoxInputs(bbox) {
  $("bboxSouth").value = Number(bbox.south).toFixed(6);
  $("bboxWest").value = Number(bbox.west).toFixed(6);
  $("bboxNorth").value = Number(bbox.north).toFixed(6);
  $("bboxEast").value = Number(bbox.east).toFixed(6);
}

function createCard(row, index, total) {
  const card = document.createElement("section");
  card.className = "intersection-card";
  card.id = `intersection-${index}`;
  card.tabIndex = -1;

  const heading = document.createElement("h3");
  heading.textContent = `路口 ${index + 1}/${total}：${row.name}`;
  card.appendChild(heading);

  const desc = document.createElement("p");
  desc.className = "minor";
  desc.textContent = `型態：${row.type || "未知"}，下一方向：${row.directionToNext || "無"}`;
  card.appendChild(desc);

  const actions = document.createElement("div");
  actions.className = "actions";

  const placesBtn = document.createElement("button");
  placesBtn.className = "paid";
  placesBtn.textContent = `查詢周邊地標（1 次，${formatUsd(PRICES.placesNearby)}）`;

  const streetBtn = document.createElement("button");
  streetBtn.className = "paid";
  const streetUsd = 3 * (PRICES.streetViewStatic + PRICES.visionAnnotate);
  streetBtn.textContent = `展開街景詳細描述（6 次，${formatUsd(streetUsd)}）`;

  const routeBtn = document.createElement("button");
  routeBtn.className = "paid";
  const interval = getSampleInterval();
  const sampleCount = row.distanceToNext ? Math.max(1, Math.ceil(row.distanceToNext / interval)) : 0;
  const routeUsd = sampleCount * (PRICES.streetViewStatic + PRICES.visionAnnotate);
  routeBtn.textContent = `顯示此段沿路景物（${interval}m，${sampleCount * 2} 次，${formatUsd(routeUsd)}）`;

  const nextBtn = document.createElement("button");
  nextBtn.textContent = "前往下一路口";
  nextBtn.disabled = index >= total - 1;

  actions.appendChild(placesBtn);
  actions.appendChild(streetBtn);
  actions.appendChild(routeBtn);
  actions.appendChild(nextBtn);
  card.appendChild(actions);

  const placesResult = document.createElement("div");
  placesResult.className = "result";
  card.appendChild(placesResult);

  const streetDetails = document.createElement("details");
  const streetSummary = document.createElement("summary");
  streetSummary.textContent = "街景詳細描述（預設收合）";
  streetDetails.appendChild(streetSummary);
  const streetResult = document.createElement("div");
  streetResult.className = "result";
  streetDetails.appendChild(streetResult);
  card.appendChild(streetDetails);

  const routeDetails = document.createElement("details");
  const routeSummary = document.createElement("summary");
  routeSummary.textContent = `沿路景物（每 ${interval}m，預設收合）`;
  routeDetails.appendChild(routeSummary);
  const routeResult = document.createElement("div");
  routeResult.className = "result";
  routeDetails.appendChild(routeResult);
  card.appendChild(routeDetails);

  placesBtn.addEventListener("click", async (e) => {
    setBusy(e.currentTarget, true);
    try {
      const data = await postJson("/api/paid/places", {
        userConfirmedPaidCall: true,
        intersections: [{ lat: row.lat, lon: row.lon, name: row.name }],
        radius: 50,
      });
      placesResult.classList.remove("error");
      placesResult.textContent = data.text;
      state.focusedIndex = index;
      readText(data.text);
    } catch (err) {
      placesResult.classList.add("error");
      placesResult.textContent = `錯誤：${err.message}`;
    } finally {
      setBusy(e.currentTarget, false);
    }
  });

  streetBtn.addEventListener("click", async (e) => {
    setBusy(e.currentTarget, true);
    try {
      const data = await postJson("/api/paid/streetview", {
        userConfirmedPaidCall: true,
        lat: row.lat,
        lon: row.lon,
        heading: row.bearingToNext ?? 0,
        fov: 90,
        pitch: 0,
      });
      streetDetails.open = true;
      streetResult.classList.remove("error");
      streetResult.textContent = data.text;
      state.focusedIndex = index;
      readText(data.text);
    } catch (err) {
      streetResult.classList.add("error");
      streetResult.textContent = `錯誤：${err.message}`;
    } finally {
      setBusy(e.currentTarget, false);
    }
  });

  routeBtn.addEventListener("click", async (e) => {
    setBusy(e.currentTarget, true);
    try {
      const next = state.intersections[index + 1];
      if (!next) {
        routeDetails.open = true;
        routeResult.textContent = "此路口已是最後一個路口，沒有下一段沿路景物。";
        return;
      }

      const data = await postJson("/api/paid/route-scenery", {
        userConfirmedPaidCall: true,
        start: { lat: row.lat, lon: row.lon },
        end: { lat: next.lat, lon: next.lon },
        intervalMeters: getSampleInterval(),
        heading: row.bearingToNext ?? 0,
      });

      routeDetails.open = true;
      routeResult.classList.remove("error");
      routeResult.textContent = data.text;
      state.focusedIndex = index;
      readText(data.text);
    } catch (err) {
      routeResult.classList.add("error");
      routeResult.textContent = `錯誤：${err.message}`;
    } finally {
      setBusy(e.currentTarget, false);
    }
  });

  nextBtn.addEventListener("click", () => {
    const nextIndex = index + 1;
    const nextCard = document.getElementById(`intersection-${nextIndex}`);
    if (!nextCard) {
      return;
    }
    state.focusedIndex = nextIndex;
    nextCard.focus();
    readText(intersectionSummary(nextIndex));
  });

  return card;
}

function renderIntersections() {
  const container = $("intersections");
  container.innerHTML = "";

  if (!state.intersections.length) {
    if (!state.searchAttempted) {
      container.textContent = "尚無路口資料，請先搜尋路口。";
    } else {
      container.textContent = state.lastSearchWarning || "目前查無路口，請調整地址關鍵字或 bbox 範圍後再試。";
    }
    return;
  }

  state.intersections.forEach((row, index) => {
    const card = createCard(row, index, state.intersections.length);
    container.appendChild(card);
  });

  renderCosts();
}

async function loadRoad() {
  const btn = $("loadRoadBtn");
  setBusy(btn, true);
  try {
    const roadName = $("roadName").value.trim();
    if (!roadName) {
      throw new Error("請先在「路段名稱」輸入地址或道路名稱。\n例如：台北市大安區忠孝東路四段");
    }
    let bbox = getBBox();
    const countryCode = getCountryCode();
    let geocodeNotice = "";

    try {
      const geo = await postJson("/api/geocode/autobbox", {
        query: roadName,
        countryCode,
      });
      if (geo?.bbox) {
        bbox = geo.bbox;
        geocodeNotice = `自動定位：${geo.displayName || roadName}（${countryCode}）`;
      }
    } catch (geoErr) {
      geocodeNotice = `自動定位失敗（${countryCode}），改用目前 bbox 搜尋（${geoErr.message}）`;
    }

    bbox = expandBBox(bbox, 2);
    setBBoxInputs(bbox);
    geocodeNotice = geocodeNotice ? `${geocodeNotice}；搜尋前 bbox 已放大 2x` : "搜尋前 bbox 已放大 2x";

    const data = await postJson("/api/overpass/segment", {
      roadName,
      bbox,
    });

    state.searchAttempted = true;
    state.roadName = roadName;
    state.intersections = data.intersections || [];
    state.focusedIndex = 0;
    state.lastSearchWarning = data.warning || "";

    const summary = [
      `${data.roadName} 抓取完成。`,
      `共 ${data.intersections.length} 個路口，估計路段長度 ${Math.round(data.totalLengthMeters || 0)} 公尺。`,
    ];

    if (data.warning) {
      summary.push(`提醒：${data.warning}`);
    }
    if (geocodeNotice) {
      summary.push(geocodeNotice);
    }
    summary.push(`國家偏好：${countryCode}`);
    if (data.diagnostics?.endpoint) {
      summary.push(`Overpass 端點：${data.diagnostics.endpoint}`);
    }
    if (typeof data.diagnostics?.matchedWays === "number" && typeof data.diagnostics?.allHighwayWays === "number") {
      summary.push(`道路比對：${data.diagnostics.matchedWays}/${data.diagnostics.allHighwayWays} 條`);
    }

    $("roadSummary").classList.remove("error");
    $("roadSummary").classList.toggle("warning", Boolean(data.warning));
    $("roadSummary").textContent = summary.join("\n");

    renderIntersections();
    if (state.intersections.length > 0) {
      readText(intersectionSummary(0));
    }
  } catch (err) {
    $("roadSummary").classList.remove("warning");
    $("roadSummary").classList.add("error");
    $("roadSummary").textContent = `錯誤：${err.message}`;
    state.searchAttempted = true;
    state.lastSearchWarning = `搜尋失敗：${err.message}`;
    state.intersections = [];
    renderIntersections();
  } finally {
    setBusy(btn, false);
  }
}

$("loadRoadBtn").addEventListener("click", loadRoad);
$("roadName").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    loadRoad();
  }
});
$("estimateBtn").addEventListener("click", () => {
  renderIntersections();
});

$("readBtn").addEventListener("click", () => {
  readText(intersectionSummary(state.focusedIndex));
});

$("stopBtn").addEventListener("click", () => {
  speechSynthesis.cancel();
  renderReadingText(spokenText);
});

renderIntersections();
initCountryOptions();
