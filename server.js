const express = require("express");
const crypto = require("crypto");
const path = require("path");
const PRODUCTS = require("./public/products.json");

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");

// Toss Payments 개발자센터 문서(docs.tosspayments.com)의 공개 테스트용 키입니다.
// 실제 서비스로 전환할 때는 개발자센터에서 발급받은 본인 계정의 키로 교체하고,
// TOSS_CLIENT_KEY / TOSS_SECRET_KEY 환경변수로 주입하세요.
const TOSS_CLIENT_KEY = process.env.TOSS_CLIENT_KEY || "test_gck_docs_Ovk5rk1EwkEbP0W43n07xlzm";
const TOSS_SECRET_KEY = process.env.TOSS_SECRET_KEY || "test_gsk_docs_OaPz8L5KdmQXkzRz3y47BMw6";

// 주문 저장소 (데모용 인메모리 저장소 - 서버 재시작 시 초기화됨)
const orders = new Map();

app.use(express.json());
app.use(express.static(PUBLIC_DIR));

function findProduct(id) {
  return PRODUCTS.find((p) => p.id === Number(id));
}

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

app.listen(PORT, () => {
  console.log(`SYNAP365 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
});
