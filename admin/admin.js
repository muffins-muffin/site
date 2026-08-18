const form = document.getElementById("productForm");
const formTitle = document.getElementById("formTitle");
const submitBtn = document.getElementById("submitBtn");
const cancelEditBtn = document.getElementById("cancelEditBtn");
const formError = document.getElementById("formError");
const imgPreview = document.getElementById("imgPreview");
const tableBody = document.getElementById("productTableBody");
const productCount = document.getElementById("productCount");
const emptyMsg = document.getElementById("emptyMsg");
const toastEl = document.getElementById("toast");
const logoutBtn = document.getElementById("logoutBtn");

const optionRows = document.getElementById("optionRows");
const addOptionBtn = document.getElementById("addOptionBtn");

const detailImageGrid = document.getElementById("detailImageGrid");
const fileList = document.getElementById("fileList");

const settingsForm = document.getElementById("settingsForm");
const settingsSubmitBtn = document.getElementById("settingsSubmitBtn");
const settingsError = document.getElementById("settingsError");

const CATEGORY_LABELS = { remotecam: "원격카메라", electronics: "전자기기", home: "스마트홈" };

let products = [];
let editingId = null; // null = create mode
let currentDetailImages = [];

function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  setTimeout(() => toastEl.classList.remove("show"), 2200);
}

function formatWon(n) {
  return Number(n || 0).toLocaleString("ko-KR") + "원";
}

// 로컬 디스크 저장 이미지는 "uploads/xxx.png" 같은 상대경로,
// R2에 저장된 이미지는 이미 완전한 URL이므로 그대로 사용합니다.
function imgSrc(imgPath) {
  return /^https?:\/\//.test(imgPath) ? imgPath : "/" + imgPath;
}

async function api(url, options = {}) {
  const res = await fetch(url, { credentials: "same-origin", ...options });
  if (res.status === 401) {
    window.location.href = "/admin/login.html";
    throw new Error("unauthorized");
  }
  return res;
}

async function loadProducts() {
  const res = await api("/admin/api/products");
  products = await res.json();
  renderTable();
}

function renderTable() {
  productCount.textContent = products.length;
  emptyMsg.hidden = products.length > 0;
  tableBody.innerHTML = products
    .slice()
    .sort((a, b) => b.id - a.id)
    .map((p) => {
      const thumb = p.img
        ? `<img src="${imgSrc(p.img)}" alt="${p.name}">`
        : p.icon || "🛍️";
      const displayName = p.displayName || p.name;
      const displayLine =
        displayName !== p.name ? `<div class="product-name-sub">노출: ${escapeHtml(displayName)}</div>` : "";
      const optionLine = p.options && p.options.length ? `<div class="product-name-sub">옵션 ${p.options.length}개</div>` : "";
      const contentLine =
        p.detailImages && p.detailImages.length
          ? `<div class="product-name-sub">상세이미지 ${p.detailImages.length}장</div>`
          : "";
      const filesBadge =
        p.files && p.files.length ? `<span class="badge-chip badge-files">📎 ${p.files.length}</span>` : "-";
      const statusBadge = p.hidden
        ? `<span class="badge-chip badge-hidden">판매중지</span>`
        : `<span class="badge-chip badge-active">판매중</span>`;
      const actions = p.hidden
        ? `
          <button class="btn btn-ghost btn-small" data-action="edit">수정</button>
          <button class="btn btn-ghost btn-small" data-action="restore">다시 판매</button>
          <button class="btn btn-danger btn-small" data-action="delete-permanent">영구 삭제</button>`
        : `
          <button class="btn btn-ghost btn-small" data-action="edit">수정</button>
          <button class="btn btn-danger btn-small" data-action="delete">판매중지</button>`;
      return `
        <tr data-id="${p.id}">
          <td><div class="table-thumb">${thumb}</div></td>
          <td>
            <div class="product-name">${escapeHtml(p.name)}</div>
            ${displayLine}
            ${optionLine}
            ${contentLine}
            <div class="product-name-sub">#${p.id}</div>
          </td>
          <td>${CATEGORY_LABELS[p.cat] || p.cat}</td>
          <td>${formatWon(p.price)}${p.originalPrice ? `<br><span class="product-name-sub" style="text-decoration:line-through">${formatWon(p.originalPrice)}</span>` : ""}</td>
          <td>${p.badge ? `<span class="badge-chip">${p.badge}</span>` : "-"}</td>
          <td>${filesBadge}</td>
          <td>${statusBadge}</td>
          <td>
            <div class="row-actions">${actions}</div>
          </td>
        </tr>`;
    })
    .join("");
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- 상품 옵션 (옵션명 + 추가금액) ----------
function addOptionRow(name = "", priceDelta = 0) {
  const row = document.createElement("div");
  row.className = "option-row";
  row.innerHTML = `
    <input type="text" class="opt-name" placeholder="예: 화이트" maxlength="40" value="${escapeHtml(name)}">
    <input type="number" class="opt-price" placeholder="추가금액(원)" step="100" value="${priceDelta || 0}">
    <button type="button" class="btn btn-ghost btn-small" data-remove-option>삭제</button>
  `;
  optionRows.appendChild(row);
}
function renderOptionRows(options) {
  optionRows.innerHTML = "";
  (options || []).forEach((o) => addOptionRow(o.name, o.priceDelta));
}
function collectOptions() {
  return Array.from(optionRows.querySelectorAll(".option-row"))
    .map((row) => ({
      name: row.querySelector(".opt-name").value.trim(),
      priceDelta: Number(row.querySelector(".opt-price").value) || 0,
    }))
    .filter((o) => o.name);
}
addOptionBtn.addEventListener("click", () => addOptionRow());
optionRows.addEventListener("click", (e) => {
  if (e.target.closest("[data-remove-option]")) {
    e.target.closest(".option-row").remove();
  }
});

// ---------- 상세설명 이미지 ----------
function renderDetailImages(images) {
  currentDetailImages = images || [];
  detailImageGrid.innerHTML = currentDetailImages
    .map(
      (ref) => `
      <div class="detail-image-item" data-ref="${escapeHtml(ref)}">
        <img src="${imgSrc(ref)}" alt="상세 이미지">
        <button type="button" data-remove-detail-image aria-label="삭제">✕</button>
      </div>`
    )
    .join("");
}

detailImageGrid.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-remove-detail-image]");
  if (!btn || !editingId) return;
  const ref = btn.closest(".detail-image-item").dataset.ref;
  try {
    const res = await api(`/admin/api/products/${editingId}/detail-images`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: ref }),
    });
    const data = await res.json();
    if (!res.ok) return showToast(data.message || "삭제에 실패했습니다.");
    renderDetailImages(data.detailImages);
    const idx = products.findIndex((p) => p.id === editingId);
    if (idx !== -1) products[idx] = data;
  } catch (err) {
    // unauthorized already redirects
  }
});

// ---------- 첨부파일 (설명서·스펙시트 등) ----------
function renderFiles(files) {
  fileList.innerHTML = (files || [])
    .map(
      (f) => `
      <li data-ref="${escapeHtml(f.ref)}">
        <a href="/product-files/${editingId}/${(files || []).indexOf(f)}" target="_blank" rel="noopener">📎 ${escapeHtml(f.name)}</a>
        <button type="button" data-remove-file aria-label="삭제">삭제</button>
      </li>`
    )
    .join("");
}

fileList.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-remove-file]");
  if (!btn || !editingId) return;
  const ref = btn.closest("li").dataset.ref;
  try {
    const res = await api(`/admin/api/products/${editingId}/files`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref }),
    });
    const data = await res.json();
    if (!res.ok) return showToast(data.message || "삭제에 실패했습니다.");
    renderFiles(data.files);
    const idx = products.findIndex((p) => p.id === editingId);
    if (idx !== -1) products[idx] = data;
  } catch (err) {
    // unauthorized already redirects
  }
});

// ---------- 상품 등록/수정 폼 ----------
function resetForm() {
  editingId = null;
  form.reset();
  formTitle.textContent = "새 상품 등록";
  submitBtn.textContent = "상품 등록";
  cancelEditBtn.hidden = true;
  formError.textContent = "";
  imgPreview.hidden = true;
  imgPreview.src = "";
  renderOptionRows([]);
  renderDetailImages([]);
  renderFiles([]);
}

function startEdit(product) {
  editingId = product.id;
  formTitle.textContent = `상품 수정 (#${product.id})`;
  submitBtn.textContent = "수정 저장";
  cancelEditBtn.hidden = false;
  formError.textContent = "";

  form.name.value = product.name || "";
  form.displayName.value = product.displayName && product.displayName !== product.name ? product.displayName : "";
  form.cat.value = product.cat || "remotecam";
  form.desc.value = product.desc || "";
  form.price.value = product.price ?? "";
  form.badge.value = product.badge || "none";
  form.image.value = "";

  if (product.img) {
    imgPreview.src = imgSrc(product.img);
    imgPreview.hidden = false;
  } else {
    imgPreview.hidden = true;
  }

  renderOptionRows(product.options || []);
  renderDetailImages(product.detailImages || []);
  renderFiles(product.files || []);

  window.scrollTo({ top: 0, behavior: "smooth" });
}

cancelEditBtn.addEventListener("click", resetForm);

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  formError.textContent = "";
  submitBtn.disabled = true;

  const formData = new FormData(form);
  formData.set("options", JSON.stringify(collectOptions()));
  const url = editingId ? `/admin/api/products/${editingId}` : "/admin/api/products";
  const method = editingId ? "PUT" : "POST";

  try {
    const res = await api(url, { method, body: formData });
    const data = await res.json();
    if (!res.ok) {
      formError.textContent = data.message || "처리 중 오류가 발생했습니다.";
      return;
    }
    showToast(editingId ? "상품을 수정했습니다." : "상품을 등록했습니다.");
    await loadProducts();
    resetForm();
  } catch (err) {
    if (err.message !== "unauthorized") formError.textContent = "서버에 연결할 수 없습니다.";
  } finally {
    submitBtn.disabled = false;
  }
});

tableBody.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const row = btn.closest("tr");
  const id = Number(row.dataset.id);
  const product = products.find((p) => p.id === id);
  if (!product) return;

  if (btn.dataset.action === "edit") {
    startEdit(product);
  } else if (btn.dataset.action === "delete") {
    if (!confirm(`"${product.name}" 상품을 판매중지할까요? 사이트에서만 숨겨지고, 관리자 목록에서 언제든 다시 판매할 수 있습니다.`)) return;
    try {
      const res = await api(`/admin/api/products/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) return showToast(data.message || "처리에 실패했습니다.");
      showToast("상품을 판매중지했습니다.");
      if (editingId === id) resetForm();
      await loadProducts();
    } catch (err) {
      // unauthorized already redirects
    }
  } else if (btn.dataset.action === "restore") {
    try {
      const res = await api(`/admin/api/products/${id}/restore`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) return showToast(data.message || "처리에 실패했습니다.");
      showToast("다시 판매를 시작했습니다.");
      await loadProducts();
    } catch (err) {
      // unauthorized already redirects
    }
  } else if (btn.dataset.action === "delete-permanent") {
    if (!confirm(`"${product.name}" 상품을 영구 삭제할까요?\n이미지까지 완전히 삭제되며 되돌릴 수 없습니다.`)) return;
    try {
      const res = await api(`/admin/api/products/${id}/permanent`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) return showToast(data.message || "삭제에 실패했습니다.");
      showToast("상품을 영구 삭제했습니다.");
      if (editingId === id) resetForm();
      await loadProducts();
    } catch (err) {
      // unauthorized already redirects
    }
  }
});

// ---------- 배송/교환/반품 안내 ----------
async function loadSettings() {
  try {
    const res = await api("/admin/api/settings");
    const data = await res.json();
    settingsForm.shippingInfo.value = data.shippingInfo || "";
    settingsForm.returnExchangeInfo.value = data.returnExchangeInfo || "";
  } catch (err) {
    // unauthorized already redirects
  }
}

settingsForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  settingsError.textContent = "";
  settingsSubmitBtn.disabled = true;
  try {
    const res = await api("/admin/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shippingInfo: settingsForm.shippingInfo.value,
        returnExchangeInfo: settingsForm.returnExchangeInfo.value,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      settingsError.textContent = data.message || "저장에 실패했습니다.";
      return;
    }
    showToast("배송/교환/반품 안내를 저장했습니다.");
  } catch (err) {
    if (err.message !== "unauthorized") settingsError.textContent = "서버에 연결할 수 없습니다.";
  } finally {
    settingsSubmitBtn.disabled = false;
  }
});

logoutBtn.addEventListener("click", async () => {
  await fetch("/admin/api/logout", { method: "POST" });
  window.location.href = "/admin/login.html";
});

loadProducts();
loadSettings();
