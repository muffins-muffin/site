const express = require("express");
const session = require("express-session");
const multer = require("multer");
const Database = require("better-sqlite3");
const fs = require("fs");
const crypto = require("crypto");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const ADMIN_DIR = path.join(__dirname, "admin");

// 상품 DB(SQLite)와 업로드 이미지를 저장하는 위치입니다. Render 등에 배포할 때는
// DATA_DIR을 영구 디스크(Persistent Disk) 마운트 경로로 지정해야, 재배포해도
// 관리자에서 등록한 상품/이미지가 사라지지 않습니다. (예: DATA_DIR=/var/data)
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

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

// ---------- 상품 데이터 (SQLite, DATA_DIR에 영구 저장) ----------
const db = new Database(path.join(DATA_DIR, "shop.db"));
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    cat TEXT NOT NULL,
    catLabel TEXT NOT NULL,
    img TEXT,
    icon TEXT,
    price INTEGER NOT NULL,
    originalPrice INTEGER,
    rating REAL,
    reviews INTEGER,
    badge TEXT,
    description TEXT NOT NULL
  )
`);

// 최초 실행이라 DB가 비어있으면(products 테이블 row 0개) public/products.json을
// 초기 카탈로그로 한 번만 시드합니다. 이후에는 DB가 유일한 상품 데이터 원본입니다.
if (db.prepare("SELECT COUNT(*) AS n FROM products").get().n === 0) {
  const seed = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, "products.json"), "utf-8"));
  const insertSeed = db.prepare(`
    INSERT INTO products (id, name, cat, catLabel, img, icon, price, originalPrice, rating, reviews, badge, description)
    VALUES (@id, @name, @cat, @catLabel, @img, @icon, @price, @originalPrice, @rating, @reviews, @badge, @description)
  `);
  const seedAll = db.transaction((rows) => {
    for (const r of rows) {
      insertSeed.run({
        img: null,
        icon: null,
        originalPrice: null,
        rating: null,
        reviews: null,
        badge: null,
        ...r,
        description: r.desc,
      });
    }
  });
  seedAll(seed);
  console.log(`[초기화] 상품 ${seed.length}개를 products.json에서 DB로 불러왔습니다.`);
}

function rowToProduct(row) {
  if (!row) return row;
  const { description, img, icon, ...rest } = row;
  const product = { ...rest, desc: description };
  if (img) product.img = img;
  if (icon) product.icon = icon;
  return product;
}

function getAllProducts() {
  return db.prepare("SELECT * FROM products ORDER BY id").all().map(rowToProduct);
}
function findProduct(id) {
  return rowToProduct(db.prepare("SELECT * FROM products WHERE id = ?").get(Number(id)));
}
function insertProduct(data) {
  const info = db
    .prepare(
      `INSERT INTO products (name, cat, catLabel, img, icon, price, originalPrice, rating, reviews, badge, description)
       VALUES (@name, @cat, @catLabel, @img, @icon, @price, @originalPrice, @rating, @reviews, @badge, @description)`
    )
    .run(data);
  return findProduct(info.lastInsertRowid);
}
function updateProductRow(id, data) {
  db.prepare(
    `UPDATE products SET name=@name, cat=@cat, catLabel=@catLabel, img=@img, icon=@icon,
       price=@price, originalPrice=@originalPrice, rating=@rating, reviews=@reviews, badge=@badge, description=@description
     WHERE id=@id`
  ).run({ id: Number(id), ...data });
  return findProduct(id);
}
function deleteProductRow(id) {
  const product = findProduct(id);
  if (!product) return null;
  db.prepare("DELETE FROM products WHERE id = ?").run(Number(id));
  return product;
}

// 프론트엔드(public/)를 Cloudflare Pages 같은 별도 도메인에 올릴 경우를 위한 CORS 설정.
// /admin/* 은 세션 쿠키를 쓰는 관리자 전용이라 항상 이 서버와 같은 origin에서만 접속하므로
// 대상에서 제외하고, 공개 API(/api/*)에만 적용합니다.
// ALLOWED_ORIGIN 환경변수(콤마로 구분)에 프론트 도메인을 등록하세요. 비워두면 모든 origin을 허용합니다(개발용).
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use("/api", (req, res, next) => {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.length === 0) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
  } else if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

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

// ---------- 상품 이미지 업로드 (로컬 디스크 또는 Cloudflare R2) ----------
// R2_* 환경변수가 모두 채워져 있으면 R2(S3 호환)에 업로드하고, 없으면 로컬 디스크(DATA_DIR/uploads)를 씁니다.
// ⚠️ 프론트(public/)를 Cloudflare Pages 같은 별도 도메인에 올릴 계획이면 R2 설정이 필수입니다 —
// 로컬 디스크 경로는 이 서버와 같은 origin에서만 열리기 때문에, 프론트가 분리되면 이미지가 깨집니다.
const R2_ENABLED = !!(
  process.env.R2_ACCOUNT_ID &&
  process.env.R2_ACCESS_KEY_ID &&
  process.env.R2_SECRET_ACCESS_KEY &&
  process.env.R2_BUCKET &&
  process.env.R2_PUBLIC_URL
);

let s3Client = null;
if (R2_ENABLED) {
  const { S3Client } = require("@aws-sdk/client-s3");
  s3Client = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
  console.log(`[이미지 저장소] Cloudflare R2 사용 중 (버킷: ${process.env.R2_BUCKET})`);
} else {
  console.log("[이미지 저장소] 로컬 디스크 사용 중 (R2_* 환경변수 없음)");
}

const ALLOWED_EXT = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
const upload = multer({
  storage: R2_ENABLED
    ? multer.memoryStorage()
    : multer.diskStorage({
        destination: (req, file, cb) => cb(null, UPLOADS_DIR),
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

// 검증 실패 시, 로컬 디스크에 이미 쓰여진 임시 업로드 파일을 정리합니다 (R2 모드는 메모리에만 있어 필요 없음).
function cleanupUploadedFile(req) {
  if (req.file && req.file.path) fs.unlink(req.file.path, () => {});
}

// 업로드된 파일을 최종 저장소에 반영하고, products.img에 저장할 값을 반환합니다.
async function saveUploadedImage(file) {
  if (!file) return null;
  if (R2_ENABLED) {
    const { PutObjectCommand } = require("@aws-sdk/client-s3");
    const ext = ALLOWED_EXT.includes(path.extname(file.originalname).toLowerCase())
      ? path.extname(file.originalname).toLowerCase()
      : ".png";
    const key = `products/product_${Date.now()}_${crypto.randomBytes(4).toString("hex")}${ext}`;
    await s3Client.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
      })
    );
    return `${process.env.R2_PUBLIC_URL.replace(/\/$/, "")}/${key}`;
  }
  return `uploads/${file.filename}`;
}

// 상품 삭제/교체 시 기존 이미지를 정리합니다.
async function deleteStoredImage(imgRef) {
  if (!imgRef) return;
  if (/^https?:\/\//.test(imgRef)) {
    if (!R2_ENABLED) return; // R2로 저장된 이미지인데 지금은 R2 설정이 없으면 건드리지 않음
    const { DeleteObjectCommand } = require("@aws-sdk/client-s3");
    const key = imgRef.replace(`${process.env.R2_PUBLIC_URL.replace(/\/$/, "")}/`, "");
    try {
      await s3Client.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }));
    } catch (err) {
      console.error("R2 이미지 삭제 실패:", err);
    }
  } else if (imgRef.startsWith("uploads/")) {
    fs.unlink(path.join(DATA_DIR, imgRef), () => {});
  }
}

// ---------- 관리자 상품 API ----------
app.get("/admin/api/products", requireAdminApi, (req, res) => {
  res.json(getAllProducts());
});

app.post("/admin/api/products", requireAdminApi, upload.single("image"), async (req, res) => {
  const body = req.body || {};
  const name = (body.name || "").trim();
  const cat = body.cat;
  const desc = (body.desc || "").trim();
  const price = Number(body.price);
  const icon = (body.icon || "").trim();

  if (!name || !CATEGORY_LABELS[cat] || !desc || !Number.isFinite(price) || price <= 0 || (!req.file && !icon)) {
    cleanupUploadedFile(req);
    return res.status(400).json({ message: "이름·카테고리·설명·가격을 확인하고, 이미지를 업로드하거나 아이콘을 입력해주세요." });
  }

  try {
    const originalPrice = body.originalPrice ? Number(body.originalPrice) : null;
    const img = await saveUploadedImage(req.file);

    const product = insertProduct({
      name,
      cat,
      catLabel: CATEGORY_LABELS[cat],
      price,
      originalPrice: Number.isFinite(originalPrice) && originalPrice > 0 ? originalPrice : null,
      rating: body.rating ? Number(body.rating) : 5.0,
      reviews: body.reviews ? Number(body.reviews) : 0,
      badge: body.badge && body.badge !== "none" ? body.badge : null,
      description: desc,
      img,
      icon: img ? null : icon,
    });

    res.status(201).json(product);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "이미지 업로드 중 오류가 발생했습니다." });
  }
});

app.put("/admin/api/products/:id", requireAdminApi, upload.single("image"), async (req, res) => {
  const existing = findProduct(req.params.id);
  if (!existing) {
    cleanupUploadedFile(req);
    return res.status(404).json({ message: "상품을 찾을 수 없습니다." });
  }

  const body = req.body || {};
  const name = (body.name || "").trim();
  const cat = body.cat;
  const desc = (body.desc || "").trim();
  const price = Number(body.price);
  const icon = (body.icon || "").trim();

  if (!name || !CATEGORY_LABELS[cat] || !desc || !Number.isFinite(price) || price <= 0) {
    cleanupUploadedFile(req);
    return res.status(400).json({ message: "이름·카테고리·설명·가격을 확인해주세요." });
  }

  try {
    const originalPrice = body.originalPrice ? Number(body.originalPrice) : null;

    let img = existing.img || null;
    let finalIcon = existing.icon || null;
    if (req.file) {
      await deleteStoredImage(existing.img);
      img = await saveUploadedImage(req.file);
      finalIcon = null;
    } else if (icon && !existing.img) {
      finalIcon = icon;
    }

    const product = updateProductRow(existing.id, {
      name,
      cat,
      catLabel: CATEGORY_LABELS[cat],
      price,
      originalPrice: Number.isFinite(originalPrice) && originalPrice > 0 ? originalPrice : null,
      rating: body.rating ? Number(body.rating) : existing.rating,
      reviews: body.reviews !== undefined && body.reviews !== "" ? Number(body.reviews) : existing.reviews,
      badge: body.badge && body.badge !== "none" ? body.badge : null,
      description: desc,
      img,
      icon: finalIcon,
    });

    res.json(product);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "이미지 업로드 중 오류가 발생했습니다." });
  }
});

app.delete("/admin/api/products/:id", requireAdminApi, async (req, res) => {
  const removed = deleteProductRow(req.params.id);
  if (!removed) return res.status(404).json({ message: "상품을 찾을 수 없습니다." });
  await deleteStoredImage(removed.img);
  res.json({ ok: true });
});

app.use("/uploads", express.static(UPLOADS_DIR));
app.use(express.static(PUBLIC_DIR));

app.get("/api/config", (req, res) => {
  res.json({ clientKey: TOSS_CLIENT_KEY });
});

// 상품 목록 (프론트엔드가 이 엔드포인트에서 실시간으로 불러옵니다)
app.get("/api/products", (req, res) => {
  res.json(getAllProducts());
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
