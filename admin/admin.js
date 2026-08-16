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

const CATEGORY_LABELS = { remotecam: "원격카메라", electronics: "전자기기", home: "스마트홈" };

let products = [];
let editingId = null; // null = create mode

function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  setTimeout(() => toastEl.classList.remove("show"), 2200);
}

function formatWon(n) {
  return Number(n || 0).toLocaleString("ko-KR") + "원";
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
        ? `<img src="/${p.img}" alt="${p.name}">`
        : p.icon || "🛍️";
      return `
        <tr data-id="${p.id}">
          <td><div class="table-thumb">${thumb}</div></td>
          <td>
            <div class="product-name">${escapeHtml(p.name)}</div>
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

function resetForm() {
  editingId = null;
  form.reset();
  formTitle.textContent = "새 상품 등록";
  submitBtn.textContent = "상품 등록";
  cancelEditBtn.hidden = true;
  formError.textContent = "";
  imgPreview.hidden = true;
  imgPreview.src = "";
}

function startEdit(product) {
  editingId = product.id;
  formTitle.textContent = `상품 수정 (#${product.id})`;
  submitBtn.textContent = "수정 저장";
  cancelEditBtn.hidden = false;
  formError.textContent = "";

  form.name.value = product.name || "";
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
    imgPreview.src = "/" + product.img;
    imgPreview.hidden = false;
  } else {
    imgPreview.hidden = true;
  }

  window.scrollTo({ top: 0, behavior: "smooth" });
}

cancelEditBtn.addEventListener("click", resetForm);

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  formError.textContent = "";
  submitBtn.disabled = true;

  const formData = new FormData(form);
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
    resetForm();
    await loadProducts();
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

logoutBtn.addEventListener("click", async () => {
  await fetch("/admin/api/logout", { method: "POST" });
  window.location.href = "/admin/login.html";
});

loadProducts();
