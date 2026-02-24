import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate } from 'k6/metrics';

const reserveOk = new Counter('reserve_ok');
const confirmOk = new Counter('confirm_ok');
const idempotentOk = new Counter('idempotent_ok');
const crossOrderProtected = new Counter('cross_order_protected');
const duplicatedTicketSignal = new Counter('duplicated_ticket_signal');
const logicalErrors = new Rate('logical_errors');

export const options = {
  scenarios: {
    confirm_idempotency: {
      executor: 'constant-vus',
      vus: Number(__ENV.VUS || '200'),
      duration: __ENV.DURATION || '60s'
    }
  },
  thresholds: {
    http_req_failed: ['rate<0.25'],
    http_req_duration: ['p(95)<1500'],
    logical_errors: ['rate<0.03']
  }
};

function post(path, payload) {
  return {
    method: 'POST',
    url: `${__ENV.API_URL}${path}`,
    body: JSON.stringify(payload),
    params: { headers: { 'Content-Type': 'application/json' } }
  };
}

function safeJson(res) {
  try {
    return res.json();
  } catch {
    return null;
  }
}

function reserveOrder(emailSuffix) {
  const payload = {
    organizerId: __ENV.ORGANIZER_ID,
    eventId: __ENV.EVENT_ID,
    customerEmail: `${emailSuffix}-${__VU}-${__ITER}@mail.com`,
    items: [{ ticketTypeId: __ENV.TICKET_TYPE_ID, quantity: 1 }]
  };

  const res = http.post(`${__ENV.API_URL}/checkout/reserve`, JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json' }
  });

  if (res.status !== 200) return null;
  reserveOk.add(1);
  return safeJson(res);
}

export default function () {
  // 1) Cross-order limpio: dos órdenes NUEVAS (reserved) compiten por la misma paymentReference por primera vez.
  const orderC = reserveOrder('cross-c');
  const orderD = reserveOrder('cross-d');

  if (!orderC?.id || !orderD?.id) {
    logicalErrors.add(1);
    sleep(0.2);
    return;
  }

  const crossRef = `CROSS-${__VU}-${__ITER}`;
  const crossBatch = http.batch([
    post('/checkout/confirm', { orderId: orderC.id, paymentReference: crossRef }),
    post('/checkout/confirm', { orderId: orderD.id, paymentReference: crossRef })
  ]);

  const statuses = [crossBatch[0].status, crossBatch[1].status].sort((a, b) => a - b);
  const strictStatus = statuses[0] === 409 && statuses[1] === 200;

  const crossJsonA = safeJson(crossBatch[0]);
  const crossJsonB = safeJson(crossBatch[1]);
  const conflictPayloadOk = [crossJsonA, crossJsonB].some((x) => x && x.code === 'PAYMENT_REFERENCE_ALREADY_USED');

  if (strictStatus && conflictPayloadOk) {
    crossOrderProtected.add(1);
    confirmOk.add(1);
  } else {
    logicalErrors.add(1);
  }

  // 2) Same-order retry en paralelo (idempotencia) sobre una orden NUEVA distinta de cross-order.
  const orderA = reserveOrder('same-a');
  if (!orderA?.id) {
    logicalErrors.add(1);
    sleep(0.2);
    return;
  }

  const retryRef = `RETRY-${__VU}-${__ITER}`;
  const sameOrderBatch = http.batch([
    post('/checkout/confirm', { orderId: orderA.id, paymentReference: retryRef }),
    post('/checkout/confirm', { orderId: orderA.id, paymentReference: retryRef })
  ]);

  const c1 = sameOrderBatch[0];
  const c2 = sameOrderBatch[1];
  const sameOrderOk = c1.status === 200 && c2.status === 200;
  if (!sameOrderOk) {
    logicalErrors.add(1);
    sleep(0.2);
    return;
  }

  confirmOk.add(2);

  const o1 = safeJson(c1);
  const o2 = safeJson(c2);
  const t1 = Array.isArray(o1?.tickets) ? o1.tickets.length : 0;
  const t2 = Array.isArray(o2?.tickets) ? o2.tickets.length : 0;

  const idem = check(c2, {
    'same-order retry keeps orderId': () => o1?.id === o2?.id,
    'same-order retry keeps ticket count': () => t1 === t2,
    'same-order retry stays paid': () => o2?.status === 'paid'
  });
  if (idem) {
    idempotentOk.add(1);
  } else {
    logicalErrors.add(1);
  }

  if (t2 > t1) {
    duplicatedTicketSignal.add(1);
  }

  sleep(0.2);
}

export function handleSummary(data) {
  const summary = {
    reserve_ok: data.metrics.reserve_ok?.values?.count || 0,
    confirm_ok: data.metrics.confirm_ok?.values?.count || 0,
    idempotent_ok: data.metrics.idempotent_ok?.values?.count || 0,
    cross_order_protected: data.metrics.cross_order_protected?.values?.count || 0,
    duplicated_ticket_signal: data.metrics.duplicated_ticket_signal?.values?.count || 0,
    http_error_rate: data.metrics.http_req_failed?.values?.rate || 0,
    latency_p95_ms: data.metrics.http_req_duration?.values?.['p(95)'] || 0,
    note: 'Validación definitiva en DB: UNIQUE(provider, providerRef) + tickets emitidos == SUM(order_items.quantity) por orden paid.'
  };

  return {
    stdout: JSON.stringify(summary, null, 2),
    'loadtests/confirm-idempotency-summary.json': JSON.stringify(summary, null, 2)
  };
}
