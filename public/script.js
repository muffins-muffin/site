// ---------- Icons ----------
const ICON_HEART = (filled) =>
  `<svg viewBox="0 0 24 24" width="16" height="16" fill="${filled ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 1 0-7.8 7.8l1 1L12 21.2l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.8Z"></path></svg>`;
const ICON_CLOSE =
  `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;

// ---------- Product data ----------
// Loaded from /api/products at startup (server-side DB, same data used for order/price validation).
let PRODUCTS = [];
// 배송/교환/반품 공통 안내 (관리자에서 설정). /api/settings에서 불러옵니다.
let SETTINGS = null;

// ---------- State ----------
// 장바구니는 { [cartKey]: { id, qty, optionIndex } } 형태입니다.
// cartKey는 옵션이 없으면 "id", 있으면 "id::optionIndex" 입니다.
let state = {
  category: "all",
  query: "",
  sort: "popular",
  cart: JSON.parse(localStorage.getItem("synap365_cart") || "{}"),
  wishlist: new Set(JSON.parse(localStorage.getItem("synap365_wishlist") || "[]")),
};

// 예전 버전(장바구니 값이 그냥 숫자 수량이었던 시절)과의 호환을 위해 새 형태로 변환합니다.
function normalizeCart() {
  const normalized = {};
  for (const [key, val] of Object.entries(state.cart)) {
    if (typeof val === "number") {
      normalized[key] = { id: Number(key), qty: val, optionIndex: null };
    } else if (val && typeof val === "object" && Number.isFinite(val.qty)) {
      normalized[key] = val;
    }
  }
  state.cart = normalized;
}
normalizeCart();

function cartKey(id, optionIndex) {
  return optionIndex === null || optionIndex === undefined ? `${id}` : `${id}::${optionIndex}`;
}

const formatWon = (n) => n.toLocaleString("ko-KR") + "원";

// ---------- Elements ----------
const productGrid = document.getElementById("productGrid");
const emptyMsg = document.getElementById("emptyMsg");
const productsTitle = document.getElementById("productsTitle");
const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");
const sortSelect = document.getElementById("sortSelect");
const cartBtn = document.getElementById("cartBtn");
const cartCount = document.getElementById("cartCount");
const cartDrawer = document.getElementById("cartDrawer");
const cartItemsEl = document.getElementById("cartItems");
const cartTotalEl = document.getElementById("cartTotal");
const closeCart = document.getElementById("closeCart");
const overlay = document.getElementById("overlay");
const checkoutBtn = document.getElementById("checkoutBtn");
const modalOverlay = document.getElementById("modalOverlay");
const productModal = document.getElementById("productModal");
const toastEl = document.getElementById("toast");
const menuToggle = document.getElementById("menuToggle");
const mainNav = document.getElementById("mainNav");

const categoryNames = {
  all: "전체 상품",
  remotecam: "원격카메라",
  electronics: "전자기기",
  home: "스마트홈",
};

// ---------- Render products ----------
function getFilteredProducts() {
  let list = PRODUCTS.filter((p) => {
    const matchCat = state.category === "all" || p.cat === state.category;
    const matchQuery = (p.displayName || p.name).toLowerCase().includes(state.query.toLowerCase());
    return matchCat && matchQuery;
  });

  switch (state.sort) {
    case "price-asc":
      list.sort((a, b) => a.price - b.price);
      break;
    case "price-desc":
      list.sort((a, b) => b.price - a.price);
      break;
    case "rating":
      list.sort((a, b) => b.rating - a.rating);
      break;
    default:
      list.sort((a, b) => b.reviews - a.reviews);
  }
  return list;
}

function renderProducts() {
  const list = getFilteredProducts();
  productGrid.innerHTML = "";
  emptyMsg.hidden = list.length !== 0;
  productsTitle.textContent = categoryNames[state.category] || "전체 상품";

  list.forEach((p) => {
    const card = document.createElement("div");
    card.className = "product-card";
    card.dataset.id = p.id;

    const discount = p.originalPrice
      ? Math.round((1 - p.price / p.originalPrice) * 100)
      : null;
    const isWished = state.wishlist.has(p.id);

    card.innerHTML = `
      <div class="product-thumb" style="background:${thumbColor(p.cat)}">
        ${p.badge ? `<span class="product-badge">${p.badge}</span>` : ""}
        <button class="product-wish ${isWished ? "active" : ""}" data-wish="${p.id}" aria-label="위시리스트">${ICON_HEART(isWished)}</button>
        ${p.img ? `<img class="product-thumb-img" src="${p.img}" alt="${p.displayName || p.name}">` : `<span>${p.icon}</span>`}
      </div>
      <div class="product-info">
        <span class="product-cat">${p.catLabel}</span>
        <h3 class="product-name">${p.displayName || p.name}</h3>
        <span class="product-rating">⭐ ${p.rating} (${p.reviews})</span>
        <div class="product-price-row">
          <span class="product-price">${formatWon(p.price)}</span>
          ${p.originalPrice ? `<span class="product-price-original">${formatWon(p.originalPrice)}</span><span class="product-discount">${discount}%</span>` : ""}
        </div>
      </div>
      <button class="add-cart-btn" data-add="${p.id}">장바구니 담기</button>
    `;
    productGrid.appendChild(card);
  });
}

function thumbColor(cat) {
  const colors = {
    remotecam: "linear-gradient(135deg,#eef1fb,#e3e8fb)",
    electronics: "linear-gradient(135deg,#e7f0ff,#dbe9ff)",
    home: "linear-gradient(135deg,#eafbef,#dcf6e4)",
  };
  return colors[cat] || "#f7f7fb";
}

// ---------- Cart ----------
function saveCart() {
  localStorage.setItem("synap365_cart", JSON.stringify(state.cart));
}
function saveWishlist() {
  localStorage.setItem("synap365_wishlist", JSON.stringify([...state.wishlist]));
}

function addToCart(id, qty = 1, optionIndex = null) {
  const key = cartKey(id, optionIndex);
  if (state.cart[key]) {
    state.cart[key].qty += qty;
  } else {
    state.cart[key] = { id, qty, optionIndex };
  }
  saveCart();
  renderCart();
  showToast("장바구니에 담았어요 🛒");
}

function updateQty(key, delta) {
  const item = state.cart[key];
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) delete state.cart[key];
  saveCart();
  renderCart();
}

function removeFromCart(key) {
  delete state.cart[key];
  saveCart();
  renderCart();
}

// 옵션이 선택된 경우 기본가에 옵션 추가금액을 더한 실제 판매가를 반환합니다.
function getUnitPrice(product, item) {
  const option = item.optionIndex != null ? (product.options || [])[item.optionIndex] : null;
  return product.price + (option ? option.priceDelta : 0);
}

function renderCart() {
  const keys = Object.keys(state.cart);
  const totalCount = keys.reduce((sum, key) => sum + state.cart[key].qty, 0);
  cartCount.textContent = totalCount;

  if (keys.length === 0) {
    cartItemsEl.innerHTML = `<p class="cart-empty">장바구니가 비어있어요.<br>마음에 드는 상품을 담아보세요!</p>`;
    cartTotalEl.textContent = formatWon(0);
    return;
  }

  let total = 0;
  cartItemsEl.innerHTML = keys
    .map((key) => {
      const item = state.cart[key];
      const p = PRODUCTS.find((x) => x.id === item.id);
      if (!p) return "";
      const option = item.optionIndex != null ? (p.options || [])[item.optionIndex] : null;
      const unitPrice = getUnitPrice(p, item);
      total += unitPrice * item.qty;
      return `
        <div class="cart-item">
          <div class="cart-item-thumb" style="background:${thumbColor(p.cat)}">${p.img ? `<img class="cart-item-thumb-img" src="${p.img}" alt="${p.displayName || p.name}">` : p.icon}</div>
          <div class="cart-item-info">
            <p class="cart-item-name">${p.displayName || p.name}${option ? ` <span class="cart-item-option">(${option.name})</span>` : ""}</p>
            <p class="cart-item-price">${formatWon(unitPrice)}</p>
            <div class="cart-item-controls">
              <button class="qty-btn" data-qty-down="${key}">−</button>
              <span class="qty-value">${item.qty}</span>
              <button class="qty-btn" data-qty-up="${key}">+</button>
              <button class="remove-item" data-remove="${key}">삭제</button>
            </div>
          </div>
        </div>
      `;
    })
    .join("");
  cartTotalEl.textContent = formatWon(total);
}

function toggleCartDrawer(open) {
  cartDrawer.classList.toggle("open", open);
  overlay.classList.toggle("show", open);
}

// ---------- Product modal ----------
function openProductModal(id) {
  const p = PRODUCTS.find((x) => x.id === Number(id));
  if (!p) return;
  const discount = p.originalPrice
    ? Math.round((1 - p.price / p.originalPrice) * 100)
    : null;

  const hasOptions = p.options && p.options.length > 0;
  const optionSelectHtml = hasOptions
    ? `
      <div class="modal-option-row">
        <label for="modalOptionSelect">옵션 선택</label>
        <select id="modalOptionSelect">
          ${p.options
            .map((o, i) => `<option value="${i}">${o.name}${o.priceDelta ? ` (+${formatWon(o.priceDelta)})` : ""}</option>`)
            .join("")}
        </select>
      </div>`
    : "";

  const detailImagesHtml =
    p.detailImages && p.detailImages.length
      ? `<div class="modal-detail-images">${p.detailImages.map((ref) => `<img src="${ref}" alt="상세 이미지" loading="lazy">`).join("")}</div>`
      : "";

  const policyHtml = SETTINGS
    ? `
      <div class="modal-policy">
        <details>
          <summary>배송 안내</summary>
          <pre>${SETTINGS.shippingInfo}</pre>
        </details>
        <details>
          <summary>교환/반품 안내</summary>
          <pre>${SETTINGS.returnExchangeInfo}</pre>
        </details>
      </div>`
    : "";

  productModal.innerHTML = `
    <button class="modal-close" id="modalClose">${ICON_CLOSE}</button>
    <div class="modal-thumb" style="background:${thumbColor(p.cat)}">${p.img ? `<img class="modal-thumb-img" src="${p.img}" alt="${p.displayName || p.name}">` : p.icon}</div>
    <div class="modal-info">
      <span class="product-cat">${p.catLabel}</span>
      <h2>${p.displayName || p.name}</h2>
      <p class="modal-rating">⭐ ${p.rating} · 리뷰 ${p.reviews}개</p>
      <div class="modal-price-row">
        <span class="modal-price">${formatWon(p.price)}</span>
        ${p.originalPrice ? `<span class="product-price-original">${formatWon(p.originalPrice)}</span><span class="product-discount">${discount}%</span>` : ""}
      </div>
      <p class="modal-desc">${p.desc}</p>
      ${optionSelectHtml}
      <div class="modal-actions">
        <button class="btn btn-primary" data-modal-add="${p.id}">장바구니 담기</button>
        <button class="btn btn-ghost" data-wish="${p.id}">${ICON_HEART(state.wishlist.has(p.id))}<span>${state.wishlist.has(p.id) ? "위시완료" : "위시추가"}</span></button>
      </div>
      ${detailImagesHtml}
      ${policyHtml}
    </div>
  `;
  modalOverlay.classList.add("show");
}

function closeProductModal() {
  modalOverlay.classList.remove("show");
}

// ---------- Toast ----------
let toastTimer;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2200);
}

// ---------- Events ----------
document.addEventListener("click", (e) => {
  const addBtn = e.target.closest("[data-add]");
  if (addBtn) {
    const id = Number(addBtn.dataset.add);
    const product = PRODUCTS.find((x) => x.id === id);
    // 옵션이 있는 상품은 카드에서 바로 담지 않고 모달에서 옵션을 고른 뒤 담게 합니다.
    if (product && product.options && product.options.length > 0) {
      openProductModal(id);
    } else {
      addToCart(id);
    }
    return;
  }

  const modalAddBtn = e.target.closest("[data-modal-add]");
  if (modalAddBtn) {
    const id = Number(modalAddBtn.dataset.modalAdd);
    const select = document.getElementById("modalOptionSelect");
    const optionIndex = select ? Number(select.value) : null;
    addToCart(id, 1, optionIndex);
    return;
  }

  const wishBtn = e.target.closest("[data-wish]");
  if (wishBtn) {
    const id = Number(wishBtn.dataset.wish);
    if (state.wishlist.has(id)) {
      state.wishlist.delete(id);
    } else {
      state.wishlist.add(id);
    }
    saveWishlist();
    renderProducts();
    if (modalOverlay.classList.contains("show")) openProductModal(id);
    return;
  }

  const qtyUp = e.target.closest("[data-qty-up]");
  if (qtyUp) { updateQty(qtyUp.dataset.qtyUp, 1); return; }

  const qtyDown = e.target.closest("[data-qty-down]");
  if (qtyDown) { updateQty(qtyDown.dataset.qtyDown, -1); return; }

  const removeBtn = e.target.closest("[data-remove]");
  if (removeBtn) { removeFromCart(removeBtn.dataset.remove); return; }

  const card = e.target.closest(".product-card");
  if (card && !e.target.closest("button")) {
    openProductModal(Number(card.dataset.id));
    return;
  }

  if (e.target.closest("#modalClose") || e.target === modalOverlay) {
    closeProductModal();
  }
});

document.querySelectorAll(".nav-link, .category-card, .hero-buttons [data-category]").forEach((el) => {
  el.addEventListener("click", (e) => {
    const cat = el.dataset.category;
    if (!cat) return;
    e.preventDefault();
    state.category = cat;
    document.querySelectorAll(".nav-link").forEach((n) => n.classList.remove("active"));
    document.querySelector(`.nav-link[data-category="${cat}"]`)?.classList.add("active");
    renderProducts();
    mainNav.classList.remove("mobile-open");
    document.getElementById("products").scrollIntoView({ behavior: "smooth" });
  });
});

searchInput.addEventListener("input", (e) => {
  state.query = e.target.value;
  renderProducts();
});
searchBtn.addEventListener("click", () => searchInput.focus());

sortSelect.addEventListener("change", (e) => {
  state.sort = e.target.value;
  renderProducts();
});

cartBtn.addEventListener("click", () => toggleCartDrawer(true));
closeCart.addEventListener("click", () => toggleCartDrawer(false));
overlay.addEventListener("click", () => {
  toggleCartDrawer(false);
  mainNav.classList.remove("mobile-open");
});

checkoutBtn.addEventListener("click", async () => {
  const keys = Object.keys(state.cart);
  if (keys.length === 0) {
    showToast("장바구니가 비어있어요.");
    return;
  }

  const items = keys.map((key) => {
    const item = state.cart[key];
    return { id: item.id, qty: item.qty, optionIndex: item.optionIndex };
  });

  checkoutBtn.disabled = true;
  checkoutBtn.textContent = "주문 생성 중...";
  try {
    const res = await fetch(`${window.API_BASE || ""}/api/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
    if (!res.ok) throw new Error("order creation failed");
    const order = await res.json();
    sessionStorage.setItem("synap365_pending_order", order.orderId);
    window.location.href = `checkout.html?orderId=${encodeURIComponent(order.orderId)}`;
  } catch (err) {
    console.error(err);
    showToast("주문 생성에 실패했어요. 잠시 후 다시 시도해주세요.");
    checkoutBtn.disabled = false;
    checkoutBtn.textContent = "주문하기";
  }
});

menuToggle.addEventListener("click", () => {
  mainNav.classList.toggle("mobile-open");
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeProductModal();
});

document.querySelector(".logo").addEventListener("click", () => {
  window.scrollTo({ top: 0, behavior: "smooth" });
});

// ---------- Hero slider ----------
const heroTrack = document.getElementById("heroTrack");
const heroDotsEl = document.getElementById("heroDots");
const heroPrevBtn = document.getElementById("heroPrev");
const heroNextBtn = document.getElementById("heroNext");
const heroSlider = document.getElementById("heroSlider");
const heroSlideCount = heroTrack ? heroTrack.children.length : 0;
let heroIndex = 0;
let heroTimer = null;

function renderHeroDots() {
  heroDotsEl.innerHTML = "";
  for (let i = 0; i < heroSlideCount; i++) {
    const dot = document.createElement("button");
    dot.className = "hero-dot" + (i === heroIndex ? " active" : "");
    dot.setAttribute("aria-label", `${i + 1}번째 배너`);
    dot.addEventListener("click", () => goToHeroSlide(i));
    heroDotsEl.appendChild(dot);
  }
}

function goToHeroSlide(i) {
  heroIndex = (i + heroSlideCount) % heroSlideCount;
  heroTrack.style.transform = `translateX(-${heroIndex * 100}%)`;
  [...heroDotsEl.children].forEach((dot, idx) => dot.classList.toggle("active", idx === heroIndex));
}

function startHeroAutoplay() {
  clearInterval(heroTimer);
  heroTimer = setInterval(() => goToHeroSlide(heroIndex + 1), 5000);
}

if (heroTrack && heroSlideCount > 0) {
  renderHeroDots();
  goToHeroSlide(0);
  startHeroAutoplay();

  heroNextBtn.addEventListener("click", () => { goToHeroSlide(heroIndex + 1); startHeroAutoplay(); });
  heroPrevBtn.addEventListener("click", () => { goToHeroSlide(heroIndex - 1); startHeroAutoplay(); });
  heroSlider.addEventListener("mouseenter", () => clearInterval(heroTimer));
  heroSlider.addEventListener("mouseleave", startHeroAutoplay);

  let touchStartX = null;
  heroSlider.addEventListener("touchstart", (e) => { touchStartX = e.touches[0].clientX; }, { passive: true });
  heroSlider.addEventListener("touchend", (e) => {
    if (touchStartX === null) return;
    const delta = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(delta) > 40) goToHeroSlide(heroIndex + (delta < 0 ? 1 : -1));
    touchStartX = null;
    startHeroAutoplay();
  }, { passive: true });
}

// ---------- Init ----------
renderCart();
fetch(`${window.API_BASE || ""}/api/products`)
  .then((res) => res.json())
  .then((data) => {
    PRODUCTS = data;
    renderProducts();
    renderCart();
  })
  .catch((err) => {
    console.error("상품 데이터를 불러오지 못했습니다.", err);
    emptyMsg.hidden = false;
    emptyMsg.textContent = "상품 정보를 불러오지 못했어요. 서버가 실행 중인지 확인해주세요.";
  });

fetch(`${window.API_BASE || ""}/api/settings`)
  .then((res) => res.json())
  .then((data) => {
    SETTINGS = data;
  })
  .catch((err) => console.error("배송/교환/반품 안내를 불러오지 못했습니다.", err));
