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
    displayName TEXT NOT NULL DEFAULT '',
    cat TEXT NOT NULL,
    catLabel TEXT NOT NULL,
    img TEXT,
    icon TEXT,
    price INTEGER NOT NULL,
    originalPrice INTEGER,
    rating REAL,
    reviews INTEGER,
    badge TEXT,
    description TEXT NOT NULL,
    options TEXT NOT NULL DEFAULT '[]',
    detailImages TEXT NOT NULL DEFAULT '[]',
    hidden INTEGER NOT NULL DEFAULT 0,
    files TEXT NOT NULL DEFAULT '[]'
  )
`);

// 기존 DB에 없던 컬럼을 뒤늦게 추가할 때를 위한 간단한 마이그레이션.
const existingColumns = new Set(db.prepare("PRAGMA table_info(products)").all().map((col) => col.name));
function addColumnIfMissing(name, ddl) {
  if (existingColumns.has(name)) return;
  db.exec(`ALTER TABLE products ADD COLUMN ${ddl}`);
  console.log(`[마이그레이션] products 테이블에 ${name} 컬럼을 추가했습니다.`);
}
addColumnIfMissing("displayName", "displayName TEXT NOT NULL DEFAULT ''");
if (!existingColumns.has("displayName")) {
  db.prepare("UPDATE products SET displayName = name WHERE displayName = ''").run();
}
addColumnIfMissing("options", "options TEXT NOT NULL DEFAULT '[]'");
addColumnIfMissing("detailImages", "detailImages TEXT NOT NULL DEFAULT '[]'");
addColumnIfMissing("hidden", "hidden INTEGER NOT NULL DEFAULT 0");
addColumnIfMissing("files", "files TEXT NOT NULL DEFAULT '[]'");

// ---------- 사이트 공통 설정 (배송/교환/반품 안내) ----------
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    shippingInfo TEXT NOT NULL DEFAULT '',
    returnExchangeInfo TEXT NOT NULL DEFAULT ''
  )
`);
const DEFAULT_SHIPPING_INFO = `■ 배송 안내
- 배송 방법: 택배 발송
- 배송 지역: 전국 (제주/도서산간 지역은 추가 비용 및 배송 기간이 발생할 수 있습니다)
- 배송비: 무료배송 (일부 상품은 상품 상세 참고)
- 배송 기간: 결제 완료 후 영업일 기준 2~3일 이내 발송 (주문량에 따라 지연될 수 있습니다)`;
const DEFAULT_RETURN_EXCHANGE_INFO = `■ 교환/반품 안내
- 신청 기한: 상품 수령일로부터 7일 이내 (전자상거래 등에서의 소비자보호에 관한 법률에 따름)
- 비용 부담: 단순 변심은 왕복 배송비 고객 부담 / 상품 하자·오배송은 판매자 부담
- 교환/반품 불가: 상품을 사용·훼손했거나 포장을 개봉해 상품 가치가 훼손된 경우, 고객 책임 사유로 상품이 멸실·훼손된 경우, 시간 경과로 재판매가 곤란할 정도로 가치가 감소한 경우
- 환불 안내: 반품 상품 검수 완료 후 영업일 기준 3~5일 이내 결제 수단으로 환불`;
if (!db.prepare("SELECT id FROM settings WHERE id = 1").get()) {
  db.prepare("INSERT INTO settings (id, shippingInfo, returnExchangeInfo) VALUES (1, ?, ?)").run(
    DEFAULT_SHIPPING_INFO,
    DEFAULT_RETURN_EXCHANGE_INFO
  );
}
function getSettings() {
  return db.prepare("SELECT shippingInfo, returnExchangeInfo FROM settings WHERE id = 1").get();
}
function updateSettings({ shippingInfo, returnExchangeInfo }) {
  db.prepare("UPDATE settings SET shippingInfo = ?, returnExchangeInfo = ? WHERE id = 1").run(
    shippingInfo,
    returnExchangeInfo
  );
  return getSettings();
}

// 최초 실행이라 DB가 비어있으면(products 테이블 row 0개) public/products.json을
// 초기 카탈로그로 한 번만 시드합니다. 이후에는 DB가 유일한 상품 데이터 원본입니다.
if (db.prepare("SELECT COUNT(*) AS n FROM products").get().n === 0) {
  const seed = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, "products.json"), "utf-8"));
  const insertSeed = db.prepare(`
    INSERT INTO products (id, name, displayName, cat, catLabel, img, icon, price, originalPrice, rating, reviews, badge, description, options, detailImages, hidden)
    VALUES (@id, @name, @displayName, @cat, @catLabel, @img, @icon, @price, @originalPrice, @rating, @reviews, @badge, @description, @options, @detailImages, 0)
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
        displayName: r.name,
        description: r.desc,
        options: "[]",
        detailImages: "[]",
      });
    }
  });
  seedAll(seed);
  console.log(`[초기화] 상품 ${seed.length}개를 products.json에서 DB로 불러왔습니다.`);
}

function rowToProduct(row) {
  if (!row) return row;
  const { description, img, icon, options, detailImages, hidden, files, ...rest } = row;
  const product = { ...rest, desc: description, hidden: !!hidden };
  if (img) product.img = img;
  if (icon) product.icon = icon;
  try {
    product.options = JSON.parse(options || "[]");
  } catch {
    product.options = [];
  }
  try {
    product.detailImages = JSON.parse(detailImages || "[]");
  } catch {
    product.detailImages = [];
  }
  try {
    product.files = JSON.parse(files || "[]");
  } catch {
    product.files = [];
  }
  return product;
}

// includeHidden=false(기본값)면 판매중지(숨김) 상품은 제외합니다 — 고객용 목록에서 사용.
// 관리자 목록은 includeHidden=true로 호출해 판매중지 상품도 함께 보여줍니다.
function getAllProducts(includeHidden = false) {
  const sql = includeHidden
    ? "SELECT * FROM products ORDER BY id"
    : "SELECT * FROM products WHERE hidden = 0 ORDER BY id";
  return db.prepare(sql).all().map(rowToProduct);
}
function findProduct(id) {
  return rowToProduct(db.prepare("SELECT * FROM products WHERE id = ?").get(Number(id)));
}
function insertProduct(data) {
  const info = db
    .prepare(
      `INSERT INTO products (name, displayName, cat, catLabel, img, icon, price, originalPrice, rating, reviews, badge, description, options, detailImages)
       VALUES (@name, @displayName, @cat, @catLabel, @img, @icon, @price, @originalPrice, @rating, @reviews, @badge, @description, @options, @detailImages)`
    )
    .run({ options: "[]", detailImages: "[]", ...data, options: JSON.stringify(data.options || []) });
  return findProduct(info.lastInsertRowid);
}
function updateProductRow(id, data) {
  const existing = findProduct(id);
  const options = JSON.stringify(data.options !== undefined ? data.options : existing.options);
  db.prepare(
    `UPDATE products SET name=@name, displayName=@displayName, cat=@cat, catLabel=@catLabel, img=@img, icon=@icon,
       price=@price, originalPrice=@originalPrice, rating=@rating, reviews=@reviews, badge=@badge, description=@description,
       options=@options
     WHERE id=@id`
  ).run({ id: Number(id), ...data, options });
  return findProduct(id);
}
function updateProductDetailImages(id, detailImages) {
  db.prepare("UPDATE products SET detailImages = ? WHERE id = ?").run(JSON.stringify(detailImages), Number(id));
  return findProduct(id);
}
function updateProductFiles(id, files) {
  db.prepare("UPDATE products SET files = ? WHERE id = ?").run(JSON.stringify(files), Number(id));
  return findProduct(id);
}
// 판매중지(숨김)/다시 판매. 데이터는 그대로 보관되고 고객 화면에서만 빠집니다.
function setProductHidden(id, hidden) {
  const product = findProduct(id);
  if (!product) return null;
  db.prepare("UPDATE products SET hidden = ? WHERE id = ?").run(hidden ? 1 : 0, Number(id));
  return findProduct(id);
}
// 완전 삭제 (되돌릴 수 없음) — 판매중지 상태의 상품에서만 사용합니다.
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

// 검증 실패 시, 로컬 디스크에 이미 쓰여진 임시 업로드 파일들을 정리합니다 (R2 모드는 메모리에만 있어 필요 없음).
// productUpload.fields(...)를 쓰면 req.files는 { image: [...], detailImages: [...], files: [...] } 형태입니다.
function cleanupUploadedFiles(req) {
  const grouped = req.files || {};
  Object.values(grouped)
    .flat()
    .forEach((f) => {
      if (f.path) fs.unlink(f.path, () => {});
    });
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

// 상품 삭제/교체 시 기존 이미지·첨부파일을 정리합니다. (이미지/첨부파일 공용)
async function deleteStoredObject(ref) {
  if (!ref) return;
  if (/^https?:\/\//.test(ref)) {
    if (!R2_ENABLED) return; // R2로 저장된 객체인데 지금은 R2 설정이 없으면 건드리지 않음
    const { DeleteObjectCommand } = require("@aws-sdk/client-s3");
    const key = ref.replace(`${process.env.R2_PUBLIC_URL.replace(/\/$/, "")}/`, "");
    try {
      await s3Client.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }));
    } catch (err) {
      console.error("R2 객체 삭제 실패:", err);
    }
  } else {
    // 로컬 디스크에 저장된 상대경로(uploads/..., files/...)만 지웁니다.
    fs.unlink(path.join(DATA_DIR, ref), () => {});
  }
}

// ---------- 상품 첨부파일 업로드 (설명서·스펙시트 등, 이미지가 아닌 일반 파일) ----------
const FILES_DIR = path.join(DATA_DIR, "files");
fs.mkdirSync(FILES_DIR, { recursive: true });
const ALLOWED_FILE_EXT = [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".hwp", ".zip", ".txt", ".csv", ".png", ".jpg", ".jpeg"];

// multer(busboy)가 한글 등 비-ASCII 파일명을 종종 latin1로 잘못 디코딩해서 넘겨줍니다
// (모든 글자가 0xFF 이하인 경우에만 해당) — 원래 UTF-8 바이트로 다시 해석해 복구합니다.
function fixMulterFilename(name) {
  if (!name || [...name].some((ch) => ch.codePointAt(0) > 0xff)) return name;
  try {
    const fixed = Buffer.from(name, "latin1").toString("utf8");
    return fixed.includes("�") ? name : fixed;
  } catch {
    return name;
  }
}

// 한글 파일명도 안전하게 다운로드되도록 Content-Disposition 값을 만듭니다.
function contentDispositionValue(filename) {
  const asciiFallback = filename.replace(/[^\x20-\x7E]/g, "_");
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

// 업로드된 첨부파일을 최종 저장소에 반영하고, products.files[].ref에 저장할 값을 반환합니다.
// (이미지와 달리 다운로드 시 원본 파일명이 그대로 뜨도록 R2에는 Content-Disposition을 함께 저장합니다.)
async function saveUploadedFile(file) {
  if (!file) return null;
  if (R2_ENABLED) {
    const { PutObjectCommand } = require("@aws-sdk/client-s3");
    const ext = path.extname(file.originalname).toLowerCase();
    const key = `files/file_${Date.now()}_${crypto.randomBytes(4).toString("hex")}${ALLOWED_FILE_EXT.includes(ext) ? ext : ""}`;
    await s3Client.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
        ContentDisposition: contentDispositionValue(fixMulterFilename(file.originalname)),
      })
    );
    return `${process.env.R2_PUBLIC_URL.replace(/\/$/, "")}/${key}`;
  }
  return `files/${file.filename}`;
}

// 상품 등록/수정 폼 하나에서 대표 이미지(image) + 상세설명 이미지(detailImages) + 첨부파일(files)을
// 한 번에 받습니다. 필드별로 저장 위치/허용 형식이 다르므로 file.fieldname으로 분기합니다.
const productUpload = multer({
  storage: R2_ENABLED
    ? multer.memoryStorage()
    : multer.diskStorage({
        destination: (req, file, cb) => cb(null, file.fieldname === "files" ? FILES_DIR : UPLOADS_DIR),
        filename: (req, file, cb) => {
          if (file.fieldname === "files") {
            const ext = path.extname(file.originalname).toLowerCase();
            cb(null, `file_${Date.now()}_${crypto.randomBytes(4).toString("hex")}${ALLOWED_FILE_EXT.includes(ext) ? ext : ""}`);
          } else {
            const ext = ALLOWED_EXT.includes(path.extname(file.originalname).toLowerCase())
              ? path.extname(file.originalname).toLowerCase()
              : ".png";
            cb(null, `product_${Date.now()}_${crypto.randomBytes(4).toString("hex")}${ext}`);
          }
        },
      }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === "files") {
      const ext = path.extname(file.originalname).toLowerCase();
      if (ALLOWED_FILE_EXT.includes(ext)) return cb(null, true);
      return cb(new Error("첨부파일 형식을 확인해주세요. (pdf, doc, xls, ppt, hwp, zip, txt, csv, 이미지)"));
    }
    if (/^image\//.test(file.mimetype)) return cb(null, true);
    cb(new Error("이미지 파일만 업로드할 수 있습니다."));
  },
});
const productUploadFields = productUpload.fields([
  { name: "image", maxCount: 1 },
  { name: "detailImages", maxCount: 10 },
  { name: "files", maxCount: 10 },
]);

// 상품 옵션(옵션명 + 추가금액) JSON 문자열을 검증합니다. 폼에서 [{ "name": "블랙", "priceDelta": 0 }, ...] 형태로 보냅니다.
function parseOptions(raw) {
  if (!raw) return [];
  let arr;
  try {
    arr = JSON.parse(raw);
  } catch {
    throw new Error("옵션 형식이 올바르지 않습니다.");
  }
  if (!Array.isArray(arr)) throw new Error("옵션 형식이 올바르지 않습니다.");
  return arr
    .map((o) => ({ name: String((o && o.name) || "").trim(), priceDelta: Number(o && o.priceDelta) || 0 }))
    .filter((o) => o.name);
}

// ---------- 관리자 상품 API ----------
app.get("/admin/api/products", requireAdminApi, (req, res) => {
  res.json(getAllProducts(true)); // 판매중지 상품도 함께 보여줍니다.
});

// 상세설명 이미지·첨부파일로 새로 올라온 파일들을 저장하고, 상품에 이어붙입니다.
// (등록 시점에도, 수정 시점에도 같은 방식으로 "추가"됩니다 — 기존 항목은 그대로 유지)
async function appendUploadedExtras(product, files) {
  const detailImageFiles = (files && files.detailImages) || [];
  const fileAttachments = (files && files.files) || [];

  let result = product;
  if (detailImageFiles.length) {
    const refs = [];
    for (const f of detailImageFiles) refs.push(await saveUploadedImage(f));
    result = updateProductDetailImages(result.id, [...(result.detailImages || []), ...refs]);
  }
  if (fileAttachments.length) {
    const newFiles = [];
    for (const f of fileAttachments) newFiles.push({ name: fixMulterFilename(f.originalname), ref: await saveUploadedFile(f) });
    result = updateProductFiles(result.id, [...(result.files || []), ...newFiles]);
  }
  return result;
}

app.post("/admin/api/products", requireAdminApi, productUploadFields, async (req, res) => {
  const body = req.body || {};
  const name = (body.name || "").trim();
  const displayName = (body.displayName || "").trim();
  const cat = body.cat;
  const desc = (body.desc || "").trim();
  const price = Number(body.price);
  const icon = (body.icon || "").trim();
  const imageFile = req.files && req.files.image && req.files.image[0];

  if (!name || !CATEGORY_LABELS[cat] || !Number.isFinite(price) || price <= 0 || (!imageFile && !icon)) {
    cleanupUploadedFiles(req);
    return res.status(400).json({ message: "이름·카테고리·가격을 확인하고, 이미지를 업로드하거나 아이콘을 입력해주세요." });
  }

  let options;
  try {
    options = parseOptions(body.options);
  } catch (err) {
    cleanupUploadedFiles(req);
    return res.status(400).json({ message: err.message });
  }

  try {
    const originalPrice = body.originalPrice ? Number(body.originalPrice) : null;
    const img = await saveUploadedImage(imageFile);

    let product = insertProduct({
      name,
      displayName: displayName || name,
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
      options,
    });

    product = await appendUploadedExtras(product, req.files);

    res.status(201).json(product);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "이미지 업로드 중 오류가 발생했습니다." });
  }
});

app.put("/admin/api/products/:id", requireAdminApi, productUploadFields, async (req, res) => {
  const existing = findProduct(req.params.id);
  if (!existing) {
    cleanupUploadedFiles(req);
    return res.status(404).json({ message: "상품을 찾을 수 없습니다." });
  }

  const body = req.body || {};
  const name = (body.name || "").trim();
  const displayName = (body.displayName || "").trim();
  const cat = body.cat;
  const desc = (body.desc || "").trim();
  const price = Number(body.price);
  const icon = (body.icon || "").trim();
  const imageFile = req.files && req.files.image && req.files.image[0];

  if (!name || !CATEGORY_LABELS[cat] || !Number.isFinite(price) || price <= 0) {
    cleanupUploadedFiles(req);
    return res.status(400).json({ message: "이름·카테고리·가격을 확인해주세요." });
  }

  let options = existing.options;
  if (body.options !== undefined) {
    try {
      options = parseOptions(body.options);
    } catch (err) {
      cleanupUploadedFiles(req);
      return res.status(400).json({ message: err.message });
    }
  }

  try {
    // 정가(originalPrice)는 관리자 폼에서 뺐습니다 — 요청에 필드가 아예 없으면(대부분의 경우)
    // 기존 값을 그대로 둡니다. 혹시 명시적으로 보내면(예: API 직접 호출) 그 값을 반영합니다.
    let originalPrice = existing.originalPrice;
    if (body.originalPrice !== undefined) {
      const parsed = body.originalPrice ? Number(body.originalPrice) : null;
      originalPrice = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }

    let img = existing.img || null;
    let finalIcon = existing.icon || null;
    if (imageFile) {
      await deleteStoredObject(existing.img);
      img = await saveUploadedImage(imageFile);
      finalIcon = null;
    } else if (icon && !existing.img) {
      finalIcon = icon;
    }

    let product = updateProductRow(existing.id, {
      name,
      displayName: displayName || name,
      cat,
      catLabel: CATEGORY_LABELS[cat],
      price,
      originalPrice,
      rating: body.rating ? Number(body.rating) : existing.rating,
      reviews: body.reviews !== undefined && body.reviews !== "" ? Number(body.reviews) : existing.reviews,
      badge: body.badge && body.badge !== "none" ? body.badge : null,
      description: desc,
      img,
      icon: finalIcon,
      options,
    });

    product = await appendUploadedExtras(product, req.files);

    res.json(product);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "이미지 업로드 중 오류가 발생했습니다." });
  }
});

// "삭제" = 판매중지. 고객 화면(/api/products)에서만 빠지고, 데이터/이미지는 그대로 보관됩니다.
// 관리자 목록에서 언제든 "다시 판매"로 복구하거나, "영구 삭제"로 완전히 지울 수 있습니다.
app.delete("/admin/api/products/:id", requireAdminApi, (req, res) => {
  const product = setProductHidden(req.params.id, true);
  if (!product) return res.status(404).json({ message: "상품을 찾을 수 없습니다." });
  res.json(product);
});

app.post("/admin/api/products/:id/restore", requireAdminApi, (req, res) => {
  const product = setProductHidden(req.params.id, false);
  if (!product) return res.status(404).json({ message: "상품을 찾을 수 없습니다." });
  res.json(product);
});

// 진짜 삭제 (되돌릴 수 없음) — 이미지 파일까지 함께 지웁니다.
app.delete("/admin/api/products/:id/permanent", requireAdminApi, async (req, res) => {
  const removed = deleteProductRow(req.params.id);
  if (!removed) return res.status(404).json({ message: "상품을 찾을 수 없습니다." });
  await deleteStoredObject(removed.img);
  await Promise.all((removed.detailImages || []).map((ref) => deleteStoredObject(ref)));
  await Promise.all((removed.files || []).map((f) => deleteStoredObject(f.ref)));
  res.json({ ok: true });
});

// 상세설명 이미지(순서대로 나열되는 상세페이지 이미지) 삭제
// (추가는 상품 등록/수정 폼(POST·PUT /admin/api/products[/:id])에서 detailImages 필드로 함께 처리합니다)
app.delete("/admin/api/products/:id/detail-images", requireAdminApi, async (req, res) => {
  const existing = findProduct(req.params.id);
  if (!existing) return res.status(404).json({ message: "상품을 찾을 수 없습니다." });

  const target = req.body && req.body.image;
  if (!target || !(existing.detailImages || []).includes(target)) {
    return res.status(400).json({ message: "삭제할 이미지를 찾을 수 없습니다." });
  }

  await deleteStoredObject(target);
  const product = updateProductDetailImages(
    existing.id,
    existing.detailImages.filter((ref) => ref !== target)
  );
  res.json(product);
});

// 첨부파일(설명서, 스펙시트 등) 삭제
// (추가는 상품 등록/수정 폼(POST·PUT /admin/api/products[/:id])에서 files 필드로 함께 처리합니다)
app.delete("/admin/api/products/:id/files", requireAdminApi, async (req, res) => {
  const existing = findProduct(req.params.id);
  if (!existing) return res.status(404).json({ message: "상품을 찾을 수 없습니다." });

  const target = req.body && req.body.ref;
  const match = (existing.files || []).find((f) => f.ref === target);
  if (!target || !match) {
    return res.status(400).json({ message: "삭제할 파일을 찾을 수 없습니다." });
  }

  await deleteStoredObject(target);
  const product = updateProductFiles(
    existing.id,
    existing.files.filter((f) => f.ref !== target)
  );
  res.json(product);
});

// 첨부파일 다운로드 (원본 파일명으로 내려받도록 처리). 로그인 없이도 접근 가능해야 하는 공개 다운로드 링크입니다.
app.get("/product-files/:id/:index", (req, res) => {
  const product = findProduct(req.params.id);
  const file = product && (product.files || [])[Number(req.params.index)];
  if (!file) return res.status(404).send("파일을 찾을 수 없습니다.");

  if (/^https?:\/\//.test(file.ref)) {
    return res.redirect(file.ref);
  }
  res.download(path.join(DATA_DIR, file.ref), file.name, (err) => {
    if (err && !res.headersSent) res.status(404).send("파일을 찾을 수 없습니다.");
  });
});

// ---------- 사이트 공통 설정 (배송/교환/반품 안내) ----------
app.get("/admin/api/settings", requireAdminApi, (req, res) => {
  res.json(getSettings());
});
app.put("/admin/api/settings", requireAdminApi, (req, res) => {
  const shippingInfo = String((req.body && req.body.shippingInfo) || "");
  const returnExchangeInfo = String((req.body && req.body.returnExchangeInfo) || "");
  res.json(updateSettings({ shippingInfo, returnExchangeInfo }));
});
app.get("/api/settings", (req, res) => {
  res.json(getSettings());
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
    if (!product || product.hidden || !Number.isInteger(qty) || qty <= 0) {
      return res.status(400).json({ message: "유효하지 않은 상품이 포함되어 있습니다." });
    }

    // 옵션 가격은 서버에 저장된 상품 옵션 목록 기준으로만 계산합니다 (클라이언트가 보낸 금액은 신뢰하지 않음).
    let optionLabel = "";
    let priceDelta = 0;
    if (item.optionIndex !== undefined && item.optionIndex !== null && item.optionIndex !== "") {
      const option = (product.options || [])[Number(item.optionIndex)];
      if (!option) {
        return res.status(400).json({ message: "유효하지 않은 옵션이 포함되어 있습니다." });
      }
      optionLabel = option.name;
      priceDelta = option.priceDelta;
    }

    amount += (product.price + priceDelta) * qty;
    const displayName = product.displayName || product.name;
    names.push(optionLabel ? `${displayName} (${optionLabel})` : displayName);
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
