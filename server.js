const express = require("express");
const session = require("express-session");
const multer = require("multer");
const fs = require("fs");
const crypto = require("crypto");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const ADMIN_DIR = path.join(__dirname, "admin");
const PRODUCTS_PATH = path.join(PUBLIC_DIR, "products.json");
const PRODUCT_IMAGE_DIR = path.join(PUBLIC_DIR, "assets", "products");
fs.mkdirSync(PRODUCT_IMAGE_DIR, { recursive: true });

// Toss Payments 개발자센터 문서(docs.tosspayments.com)의 공개 테스트용 키입니다.
// 실제 서비스로 전환할 때는 개발자센터에서 발급받은 본인 계정의 키로 교체하고,
// TOSS_CLIENT_KEY / TOSS_SECRET_KEY 환경변수로 주입하세요.
const TOSS_CLIENT_KEY = process.env.TOSS_CLIENT_KEY || "test_gck_docs_Ovk5rk1EwkEbP0W43n07xlzm";
const TOSS_SECRET_KEY = process.env.TOSS_SECRET_KEY || "test_gsk_docs_OaPz8L5KdmQXkzRz3y47BMw6";

// 관리자 로그인 비밀번호입니다. 데모 기본값이니 실제 서비스로 전환할 때는 반드시
// ADMIN_PASSWORD 환경변수로 강력한 비밀번호를 지정하세요.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin1234";
if (!process.env.ADMIN_PASSWORD) {
  console.warn("[경고] ADMIN_PASSWORD 환경변수가 설정되지 않아 데모 기본 비밀번호(admin1234)를 사용합니다. 실제 배포 전 반드시 환경변수로 교체하세요.");
}
// 세션 서명용 비밀키입니다. 지정하지 않으면 서버 재시작 시마다 랜덤 값으로 생성되어
// 재시작 후 기존 로그인 세션이 끊깁니다. 실제 배포에서는 SESSION_SECRET 환경변수를 지정하세요.
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");

const CATEGORY_LABELS = {
  remotecam: "원격카메라",
  electronics: "전자기기",
  home: "스마트홈",
};

// 주문 저장소 (데모용 인메모리 저장소 - 서버 재시작 시 초기화됨)
const orders = new Map();

// ---------- 상품 데이터 (products.json 파일과 동기화되는 메모리 캐시) ----------
function loadProducts() {
  return JSON.parse(fs.readFileSync(PRODUCTS_PATH, "utf-8"));
}
function saveProducts() {
  fs.writeFileSync(PRODUCTS_PATH, JSON.stringify(PRODUCTS, null, 2) + "\n", "utf-8");
}
let PRODUCTS = loadProducts();

function findProduct(id) {
  return PRODUCTS.find((p) => p.id === Number(id));
}

app.set("trust proxy", 1);
app.use(express.json());
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 8 * 60 * 60 * 1000, // 8시간
    },
  })
);

// ---------- 관리자 인증 ----------
function requireAdminApi(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  res.status(401).json({ message: "로그인이 필요합니다." });
}
function requireAdminPage(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  res.redirect("/admin/login.html");
}

app.post("/admin/api/login", (req, res) => {
  const password = req.body && req.body.password;
  if (typeof password === "string" && password === ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    return res.json({ ok: true });
  }
  res.status(401).json({ message: "비밀번호가 올바르지 않습니다." });
});
app.post("/admin/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});
app.get("/admin/api/session", (req, res) => {
  res.json({ isAdmin: !!(req.session && req.session.isAdmin) });
});

app.get("/admin/login.html", (req, res) => res.sendFile(path.join(ADMIN_DIR, "login.html")));
app.get("/admin", (req, res) => res.redirect(req.session && req.session.isAdmin ? "/admin/dashboard.html" : "/admin/login.html"));
app.get("/admin/dashboard.html", requireAdminPage, (req, res) => res.sendFile(path.join(ADMIN_DIR, "dashboard.html")));
app.get("/admin/admin.css", requireAdminPage, (req, res) => res.sendFile(path.join(ADMIN_DIR, "admin.css")));
app.get("/admin/admin.js", requireAdminPage, (req, res) => res.sendFile(path.join(ADMIN_DIR, "admin.js")));

// ---------- 상품 이미지 업로드 ----------
const ALLOWED_EXT = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, PRODUCT_IMAGE_DIR),
    filename: (req, file, cb) => {
      const ext = ALLOWED_EXT.includes(path.extname(file.originalname).toLowerCase())
        ? path.extname(file.originalname).toLowerCase()
        : ".png";
      cb(null, `product_${Date.now()}_${crypto.randomBytes(4).toString("hex")}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\//.test(file.mimetype)) return cb(null, true);
    cb(new Error("이미지 파일만 업로드할 수 있습니다."));
  },
});

function deleteManagedImage(imgPath) {
  if (imgPath && imgPath.startsWith("assets/products/")) {
    fs.unlink(path.join(PUBLIC_DIR, imgPath), () => {});
  }
}

// ---------- 관리자 상품 API ----------
app.get("/admin/api/products", requireAdminApi, (req, res) => {
  res.json(PRODUCTS);
});

app.post("/admin/api/products", requireAdminApi, upload.single("image"), (req, res) => {
  const body = req.body || {};
  const name = (body.name || "").trim();
  const cat = body.cat;
  const desc = (body.desc || "").trim();
  const price = Number(body.price);
  const icon = (body.icon || "").trim();

  if (!name || !CATEGORY_LABELS[cat] || !desc || !Number.isFinite(price) || price <= 0 || (!req.file && !icon)) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(400).json({ message: "이름·카테고리·설명·가격을 확인하고, 이미지를 업로드하거나 아이콘을 입력해주세요." });
  }

  const originalPrice = body.originalPrice ? Number(body.originalPrice) : null;
  const nextId = PRODUCTS.reduce((max, p) => Math.max(max, p.id), 0) + 1;

  const product = {
    id: nextId,
    name,
    cat,
    catLabel: CATEGORY_LABELS[cat],
    price,
    originalPrice: Number.isFinite(originalPrice) && originalPrice > 0 ? originalPrice : null,
    rating: body.rating ? Number(body.rating) : 5.0,
    reviews: body.reviews ? Number(body.reviews) : 0,
    badge: body.badge && body.badge !== "none" ? body.badge : null,
    desc,
  };
  if (req.file) product.img = `assets/products/${req.file.filename}`;
  else product.icon = icon;

  PRODUCTS.push(product);
  saveProducts();
  res.status(201).json(product);
});

app.put("/admin/api/products/:id", requireAdminApi, upload.single("image"), (req, res) => {
  const product = findProduct(req.params.id);
  if (!product) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(404).json({ message: "상품을 찾을 수 없습니다." });
  }

  const body = req.body || {};
  const name = (body.name || "").trim();
  const cat = body.cat;
  const desc = (body.desc || "").trim();
  const price = Number(body.price);
  const icon = (body.icon || "").trim();

  if (!name || !CATEGORY_LABELS[cat] || !desc || !Number.isFinite(price) || price <= 0) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(400).json({ message: "이름·카테고리·설명·가격을 확인해주세요." });
  }

  const originalPrice = body.originalPrice ? Number(body.originalPrice) : null;
  product.name = name;
  product.cat = cat;
  product.catLabel = CATEGORY_LABELS[cat];
  product.desc = desc;
  product.price = price;
  product.originalPrice = Number.isFinite(originalPrice) && originalPrice > 0 ? originalPrice : null;
  if (body.rating) product.rating = Number(body.rating);
  if (body.reviews !== undefined && body.reviews !== "") product.reviews = Number(body.reviews);
  product.badge = body.badge && body.badge !== "none" ? body.badge : null;

  if (req.file) {
    deleteManagedImage(product.img);
    product.img = `assets/products/${req.file.filename}`;
    delete product.icon;
  } else if (icon && !product.img) {
    product.icon = icon;
  }

  saveProducts();
  res.json(product);
});

app.delete("/admin/api/products/:id", requireAdminApi, (req, res) => {
  const idx = PRODUCTS.findIndex((p) => p.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ message: "상품을 찾을 수 없습니다." });
  const [removed] = PRODUCTS.splice(idx, 1);
  deleteManagedImage(removed.img);
  saveProducts();
  res.json({ ok: true });
});

app.use(express.static(PUBLIC_DIR));

app.get("/api/config", (req, res) => {
  res.json({ clientKey: TOSS_CLIENT_KEY });
});

app.post("/api/orders", (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (items.length === 0) {
    return res.status(400).json({ message: "장바구니가 비어있습니다." });
  }

  let amount = 0;
  const names = [];
  for (const item of items) {
    const product = findProduct(item.id);
    const qty = Number(item.qty);
    if (!product || !Number.isInteger(qty) || qty <= 0) {
      return res.status(400).json({ message: "유효하지 않은 상품이 포함되어 있습니다." });
    }
    amount += product.price * qty;
    names.push(product.name);
  }

  const orderId = "order_" + crypto.randomBytes(16).toString("base64url");
  const orderName = names.length > 1 ? `${names[0]} 외 ${names.length - 1}건` : names[0];

  orders.set(orderId, { amount, orderName, items, status: "pending", createdAt: Date.now() });

  res.json({ orderId, amount, orderName });
});

app.get("/api/orders/:orderId", (req, res) => {
  const order = orders.get(req.params.orderId);
  if (!order) return res.status(404).json({ message: "주문을 찾을 수 없습니다." });
  res.json({ orderId: req.params.orderId, amount: order.amount, orderName: order.orderName, status: order.status });
});

app.post("/api/payments/confirm", async (req, res) => {
  const { paymentKey, orderId, amount } = req.body;
  const order = orders.get(orderId);

  if (!order) {
    return res.status(400).json({ message: "존재하지 않는 주문입니다." });
  }
  if (order.status === "paid") {
    return res.status(400).json({ message: "이미 처리된 주문입니다." });
  }
  // 결제 과정에서 금액이 조작되지 않았는지 서버에 저장해둔 금액과 대조합니다.
  if (Number(amount) !== order.amount) {
    return res.status(400).json({ message: "결제 금액이 주문 금액과 일치하지 않습니다." });
  }

  const encryptedSecretKey = "Basic " + Buffer.from(TOSS_SECRET_KEY + ":").toString("base64");

  try {
    const tossRes = await fetch("https://api.tosspayments.com/v1/payments/confirm", {
      method: "POST",
      headers: {
        Authorization: encryptedSecretKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ paymentKey, orderId, amount: Number(amount) }),
    });
    const data = await tossRes.json();

    if (!tossRes.ok) {
      return res.status(tossRes.status).json(data);
    }

    order.status = "paid";
    order.paymentKey = paymentKey;
    order.approvedAt = data.approvedAt;
    order.method = data.method;

    res.json({
      orderId,
      orderName: order.orderName,
      amount: order.amount,
      method: data.method,
      approvedAt: data.approvedAt,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "결제 승인 처리 중 오류가 발생했습니다." });
  }
});

// 업로드 용량 초과 등 multer 에러를 JSON 메시지로 응답 (라우트 정의보다 뒤에 있어야 동작합니다)
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ message: "이미지 업로드 오류: " + err.message });
  }
  if (err) {
    console.error(err);
    return res.status(400).json({ message: err.message || "요청 처리 중 오류가 발생했습니다." });
  }
  next();
});

app.listen(PORT, () => {
  console.log(`SYNAP365 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
});
