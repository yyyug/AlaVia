const CLERK_PUBLISHABLE_KEY = "pk_test_cG9zc2libGUtc2tpbmstNC5jbGVyay5hY2NvdW50cy5kZXYk";
let clerkInstance = null;
let sessionRef = null;

async function initClerkClient() {
  const clerkRef = window.Clerk;
  if (!clerkRef) throw new Error("Clerk not loaded");

  if (typeof clerkRef === "function") {
    const clerk = new clerkRef(CLERK_PUBLISHABLE_KEY);
    await clerk.load();
    window.Clerk = clerk;
    sessionRef = clerk.session || null;
    return clerk;
  }

  if (typeof clerkRef === "object" && typeof clerkRef.load === "function") {
    await clerkRef.load({ publishableKey: CLERK_PUBLISHABLE_KEY });
    sessionRef = clerkRef.session || null;
    return clerkRef;
  }

  throw new Error("Unsupported Clerk SDK shape");
}

async function getToken() {
  if (!sessionRef) return null;
  try {
    return await sessionRef.getToken();
  } catch {
    return null;
  }
}

async function apiFetch(path, opts = {}) {
  const token = await getToken();
  const headers = { "content-type": "application/json", ...(opts.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function formatRemaining(seconds) {
  const sec = Number(seconds || 0);
  if (sec <= 0) return "已過期";
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  if (days > 0) return `${days} 天 ${hours} 小時`;
  const mins = Math.floor((sec % 3600) / 60);
  return `${hours} 小時 ${mins} 分鐘`;
}

function formatEpoch(epochSec) {
  return new Date(Number(epochSec || 0) * 1000).toLocaleString("zh-TW", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

async function loadStreetCacheIndex() {
  const status = document.getElementById("status");
  const table = document.getElementById("street-table");
  const tbody = document.getElementById("street-tbody");
  status.textContent = "載入中...";
  table.style.display = "none";

  try {
    const data = await apiFetch("/api/admin/cache-streets", { method: "GET" });
    const entries = Array.isArray(data.entries) ? data.entries : [];
    const rawCount = Number(data.rawCount || entries.length);

    if (entries.length === 0) {
      status.textContent = "目前沒有街道路段 cache 資料。";
      tbody.innerHTML = "";
      return;
    }

    tbody.innerHTML = entries.map((item) => {
      const roadName = String(item.roadName || "(unknown road)");
      const country = String(item.countryOrRegion || "未設定");
      const mergedCount = Math.max(1, Number(item.mergedCount || 1));
      const expiresIn = Number(item.expiresInSeconds || 0);
      const remaining = formatRemaining(expiresIn);
      const expiresAt = formatEpoch(item.expiresAt);
      const statusClass = expiresIn > 30 * 86400 ? "ok" : (expiresIn > 0 ? "warn" : "bad");
      const statusText = expiresIn > 30 * 86400 ? "Fresh" : (expiresIn > 0 ? "接近過期" : "Expired");
      return `<tr>
        <td>${roadName}</td>
        <td>${country}</td>
        <td class="mono">${mergedCount}</td>
        <td class="mono">${remaining}</td>
        <td class="mono">${expiresAt}</td>
        <td class="${statusClass}">${statusText}</td>
      </tr>`;
    }).join("");

    status.textContent = `共 ${entries.length} 條街道路段 cache（原始 ${rawCount} 筆）。`;
    table.style.display = "";
  } catch (err) {
    status.textContent = `讀取失敗: ${err.message}`;
    table.style.display = "none";
  }
}

async function updateUI(user) {
  const signInBtn = document.getElementById("sign-in-btn");
  const signOutBtn = document.getElementById("sign-out-btn");
  const status = document.getElementById("status");

  if (!user) {
    signInBtn.style.display = "";
    signOutBtn.style.display = "none";
    status.textContent = "請先登入管理員帳號。";
    return;
  }

  signInBtn.style.display = "none";
  signOutBtn.style.display = "";

  try {
    const me = await apiFetch("/api/me", { method: "GET" });
    if (!me.isAdmin) {
      status.textContent = "此帳號沒有管理員權限。";
      return;
    }
    await loadStreetCacheIndex();
  } catch (err) {
    status.textContent = `驗證失敗: ${err.message}`;
  }
}

async function init() {
  try {
    clerkInstance = await initClerkClient();
  } catch (err) {
    document.getElementById("status").textContent = `Clerk init failed: ${err.message || err}`;
    return;
  }

  clerkInstance.addListener?.(({ session, user }) => {
    sessionRef = session || null;
    void updateUI(user || null);
  });

  document.getElementById("sign-in-btn")?.addEventListener("click", async () => {
    if (typeof window.Clerk?.redirectToSignIn === "function") {
      await window.Clerk.redirectToSignIn({ returnBackUrl: window.location.href });
      return;
    }
    window.Clerk?.openSignIn?.();
  });

  document.getElementById("sign-out-btn")?.addEventListener("click", () => void clerkInstance.signOut());
  document.getElementById("refresh-btn")?.addEventListener("click", () => void loadStreetCacheIndex());

  await updateUI(clerkInstance.user || null);
}

void init();
