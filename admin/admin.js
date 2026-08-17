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

const detailImagesSection = document.getElementById("detailImagesSection");
const detailImageGrid = document.getElementById("detailImageGrid");
const detailImageInput = document.getElementById("detailImageInput");
const uploadDetailImagesBtn = document.getElementById("uploadDetailImagesBtn");
const detailImageError = document.getElementById("detailImageError");

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
      return `
        <tr data-id="${p.id}">
          <td><div class="table-thumb">${thumb}</div></td>
          <td>
            <div class="product-name">${escapeHtml(p.name)}</div>
            ${displayLine}
            ${optionLine}
            <div class="product-name-sub">#${p.id}</div>
          </td>
          <td>${CATEGORY_LABELS[p.cat] || p.cat}</td>
          <td>${formatWon(p.price)}${p.originalPrice ? `<br><span class="product-name-sub" style="text-decoration:line-through">${formatWon(p.originalPrice)}</span>` : ""}</td>
          <td>${p.badge ? `<span class="badge-chip">${p.badge}</span>` : "-"}</td>
          <td>⭐ ${p.rating ?? "-"} (${p.reviews ?? 0})</td>
          <td>
            <div class="row-actions">
              <button class="btn btn-ghost btn-small" data-action="edit">수정</button>
              <button class="btn btn-danger btn-small" data-action="delete">삭제</button>
            </div>
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

uploadDetailImagesBtn.addEventListener("click", async () => {
  if (!editingId) return;
  detailImageError.textContent = "";
  const files = detailImageInput.files;
  if (!files || files.length === 0) {
    detailImageError.textContent = "업로드할 이미지를 선택해주세요.";
    return;
  }
  const fd = new FormData();
  for (const file of files) fd.append("images", file);

  uploadDetailImagesBtn.disabled = true;
  uploadDetailImagesBtn.textContent = "업로드 중...";
  try {
    const res = await api(`/admin/api/products/${editingId}/detail-images`, { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) {
      detailImageError.textContent = data.message || "업로드에 실패했습니다.";
      return;
    }
    renderDetailImages(data.detailImages);
    detailImageInput.value = "";
    const idx = products.findIndex((p) => p.id === editingId);
    if (idx !== -1) products[idx] = data;
    showToast("상세 이미지를 추가했습니다.");
  } catch (err) {
    if (err.message !== "unauthorized") detailImageError.textContent = "서버에 연결할 수 없습니다.";
  } finally {
    uploadDetailImagesBtn.disabled = false;
    uploadDetailImagesBtn.textContent = "이미지 업로드";
  }
});

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
  detailImagesSection.hidden = true;
  renderDetailImages([]);
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
  form.originalPrice.value = product.originalPrice ?? "";
  form.badge.value = product.badge || "none";
  form.rating.value = product.rating ?? "";
  form.reviews.value = product.reviews ?? "";
  form.icon.value = product.icon || "";
  form.image.value = "";

  if (product.img) {
    imgPreview.src = imgSrc(product.img);
    imgPreview.hidden = false;
  } else {
    imgPreview.hidden = true;
  }

  renderOptionRows(product.options || []);
  detailImagesSection.hidden = false;
  renderDetailImages(product.detailImages || []);

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
    const wasEditing = !!editingId;
    showToast(wasEditing ? "상품을 수정했습니다." : "상품을 등록했습니다.");
    await loadProducts();
    if (!wasEditing) {
      // 방금 등록한 상품을 바로 수정 모드로 열어서 상세 이미지를 이어서 추가할 수 있게 합니다.
      startEdit(data);
    } else {
      resetForm();
    }
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
    if (!confirm(`"${product.name}" 상품을 삭제할까요? 이 작업은 되돌릴 수 없습니다.`)) return;
    try {
      const res = await api(`/admin/api/products/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) return showToast(data.message || "삭제에 실패했습니다.");
      showToast("상품을 삭제했습니다.");
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
