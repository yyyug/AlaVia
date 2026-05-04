const CLERK_PUBLISHABLE_KEY = "pk_test_cG9zc2libGUtc2tpbmstNC5jbGVyay5hY2NvdW50cy5kZXYk";
const CLERK_SDK_URLS = [
  "https://cdn.jsdelivr.net/npm/@clerk/clerk-js@4/dist/clerk.browser.js",
  "https://unpkg.com/@clerk/clerk-js@4/dist/clerk.browser.js",
];
let clerkInstance = null;
let sessionRef = null;
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
      if (window.Clerk) return true;
    }

    for (const url of CLERK_SDK_URLS) {
      try {
        await loadScriptTag(url);
        if (window.Clerk) return true;
      } catch {
        // Try next CDN URL.
      }
    }

    return Boolean(window.Clerk);
  })();

  const ok = await clerkScriptLoadPromise;
  if (!ok) clerkScriptLoadPromise = null;
  return ok;
}

async function initClerkClient() {
  await ensureClerkSdkReady();
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
  try { return await sessionRef.getToken(); } catch { return null; }
}

async function apiFetch(path, opts = {}) {
  const token = await getToken();
  const headers = { "content-type": "application/json", ...(opts.headers || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function showMsg(text, isErr = false) {
  const el = document.getElementById("msg");
  el.textContent = text;
  el.className = isErr ? "err" : "ok";
  el.style.display = "";
  setTimeout(() => { el.style.display = "none"; }, 4000);
}

function formatDate(epochMs) {
  return new Date(epochMs).toLocaleString("zh-TW", { dateStyle: "short", timeStyle: "short" });
}

function formatBytes(bytes) {
  const n = Number(bytes || 0);
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = n;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const decimals = value >= 10 ? 1 : 2;
  return `${value.toFixed(decimals)} ${units[unitIndex]}`;
}

async function loadCacheStats() {
  const panel = document.getElementById("cache-summary");
  const top = document.getElementById("cache-summary-top");
  const tbody = document.getElementById("cache-provider-tbody");
  if (!panel || !top || !tbody) return;

  try {
    const data = await apiFetch("/api/admin/cache-stats", { method: "GET" });
    const totals = data.totals || {};
    const limits = data.limits || {};
    const providers = Array.isArray(data.providers) ? data.providers : [];

    const totalBytes = Number(totals.totalBytes || 0);
    const r2FreeBytes = Number(limits.r2StorageGiBFree || 10) * 1024 * 1024 * 1024;
    const usagePct = r2FreeBytes > 0 ? Math.min(999, (totalBytes / r2FreeBytes) * 100) : 0;
    top.textContent =
      `總用量 ${formatBytes(totalBytes)} / R2 免費 ${Number(limits.r2StorageGiBFree || 10)} GiB（${usagePct.toFixed(2)}%）。` +
      ` 目前 cache entries: ${Number(totals.cacheEntryCount || 0)}。`;

    if (providers.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="padding:8px 0;color:#777;">目前沒有 cache entries。</td></tr>`;
    } else {
      tbody.innerHTML = providers.map((item) => {
        const provider = String(item.provider || "unknown");
        const entryCount = Number(item.cacheEntryCount || 0);
        const expiredCount = Number(item.expiredEntryCount || 0);
        const missing = Number(item.missingObjectCount || 0);
        const miB = Number(item.totalMiB || 0).toFixed(3);
        return `<tr>
          <td>${provider}</td>
          <td style="text-align:right;">${entryCount}</td>
          <td style="text-align:right;">${expiredCount}</td>
          <td style="text-align:right;">${missing}</td>
          <td style="text-align:right;">${miB}</td>
        </tr>`;
      }).join("");
    }

    panel.style.display = "";
  } catch (err) {
    panel.style.display = "";
    top.textContent = `快取統計讀取失敗: ${err.message}`;
    tbody.innerHTML = "";
  }
}

async function purgeExpiredCache() {
  await apiFetch("/api/admin/cache-purge-expired", {
    method: "POST",
    body: JSON.stringify({ maxDelete: 500 }),
  });
}

async function loadUsers() {
  const status = document.getElementById("status");
  const table = document.getElementById("user-table");
  const tbody = document.getElementById("user-tbody");
  status.textContent = "載入中... Loading...";
  table.style.display = "none";
  try {
    const data = await apiFetch("/api/admin/users");
    const users = data.users || [];
    const billing = await apiFetch("/api/admin/billing-summary");
    const billingRows = Array.isArray(billing.users) ? billing.users : [];
    const billingMap = new Map(billingRows.map((r) => [r.userId, r]));
    tbody.innerHTML = "";
    if (users.length === 0) {
      status.textContent = "目前沒有使用者。No users yet.";
      return;
    }
    for (const u of users) {
      const b = billingMap.get(u.userId) || { estimatedUsd: 0, actualUsd: 0 };
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${u.email || "(no email)"}</td>
        <td><span class="${u.approved ? "badge-approved" : "badge-pending"}">${u.approved ? "已核准" : "待審核"}</span></td>
        <td>${u.isAdmin ? '<span class="badge-admin">Admin</span>' : "使用者"}</td>
        <td style="font-family:ui-monospace,monospace;">$${Number(b.estimatedUsd || 0).toFixed(4)}</td>
        <td style="font-family:ui-monospace,monospace;">$${Number(b.actualUsd || 0).toFixed(4)}</td>
        <td style="font-size:0.8rem;color:#777;">${formatDate(u.createdAt)}</td>
        <td>
          ${!u.approved
            ? `<button class="action approve" data-uid="${u.userId}" data-approve="true">核准 Approve</button>`
            : `<button class="action reject" data-uid="${u.userId}" data-approve="false">撤銷 Revoke</button>`
          }
        </td>`;
      tbody.appendChild(tr);
    }
    const totalActual = Number(billing?.totals?.actualUsd || 0);
    status.textContent = `共 ${users.length} 名使用者 (${users.filter(u => !u.approved).length} 待審核)，全站實際累計 $${totalActual.toFixed(4)}`;
    table.style.display = "";
    await loadCacheStats();

    tbody.addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-uid]");
      if (!btn) return;
      btn.disabled = true;
      const uid = btn.dataset.uid;
      const approve = btn.dataset.approve === "true";
      try {
        await apiFetch("/api/admin/approve-user", {
          method: "POST",
          body: JSON.stringify({ userId: uid, approve }),
        });
        showMsg(approve ? `已核准使用者` : `已撤銷使用者`);
        await loadUsers();
      } catch (err) {
        showMsg(`操作失敗: ${err.message}`, true);
        btn.disabled = false;
      }
    }, { once: true });
  } catch (err) {
    status.textContent = `錯誤 Error: ${err.message}`;
  }
}

async function updateAdminUI(user) {
  const emailEl = document.getElementById("admin-email");
  const signInBtn = document.getElementById("sign-in-btn");
  const signOutBtn = document.getElementById("sign-out-btn");
  const notAdmin = document.getElementById("not-admin");
  const adminPanel = document.getElementById("admin-panel");

  if (!user) {
    emailEl.textContent = "";
    signInBtn.style.display = "";
    signOutBtn.style.display = "none";
    notAdmin.style.display = "none";
    adminPanel.style.display = "none";
    return;
  }

  signInBtn.style.display = "none";
  signOutBtn.style.display = "";
  emailEl.textContent = user.primaryEmailAddress?.emailAddress || user.id;

  // Check admin status via /api/me
  try {
    const data = await apiFetch("/api/me");
    if (!data.isAdmin) {
      notAdmin.style.display = "";
      adminPanel.style.display = "none";
    } else {
      notAdmin.style.display = "none";
      adminPanel.style.display = "";
      await loadUsers();
    }
  } catch {
    notAdmin.style.display = "";
    adminPanel.style.display = "none";
  }
}

async function init() {
  try {
    clerkInstance = await initClerkClient();
  } catch (err) {
    document.getElementById("status").textContent = `Clerk not loaded: ${err.message || err}`;
    return;
  }

  clerkInstance.addListener?.(({ session, user }) => {
    sessionRef = session || null;
    void updateAdminUI(user || null);
  });

  document.getElementById("sign-in-btn").addEventListener("click", async () => {
    if (typeof window.Clerk?.redirectToSignIn === "function") {
      await window.Clerk.redirectToSignIn({ returnBackUrl: window.location.href });
      return;
    }
    if (typeof window.Clerk?.openSignIn === "function") {
      window.Clerk.openSignIn();
      return;
    }
    clerkInstance = await initClerkClient();
    if (typeof window.Clerk?.redirectToSignIn === "function") {
      await window.Clerk.redirectToSignIn({ returnBackUrl: window.location.href });
    } else {
      window.Clerk?.openSignIn?.();
    }
  });
  document.getElementById("sign-out-btn").addEventListener("click", () => void clerkInstance.signOut());
  document.getElementById("refresh-btn").addEventListener("click", () => void loadUsers());
  document.getElementById("refresh-cache-btn")?.addEventListener("click", () => void loadCacheStats());
  document.getElementById("purge-expired-cache-btn")?.addEventListener("click", async () => {
    const btn = document.getElementById("purge-expired-cache-btn");
    if (btn) btn.disabled = true;
    try {
      await purgeExpiredCache();
      showMsg("已清理過期快取。Purged expired cache.");
      await loadCacheStats();
    } catch (err) {
      showMsg(`清理失敗: ${err.message}`, true);
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  await updateAdminUI(clerkInstance.user || null);
}

void init();
