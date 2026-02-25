import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate } from 'k6/metrics';

const reserveOk = new Counter('reserve_ok');
const reserveFail = new Counter('reserve_fail');
const overQuotaSignals = new Counter('over_quota_signals');
const logicalErrors = new Rate('logical_errors');

const QUOTA = Number(__ENV.QUOTA || '0');

export const options = {
  scenarios: {
    hot_event_1000_vus: {
      executor: 'constant-vus',
      vus: 1000,
      duration: __ENV.DURATION || '60s'
    }
  },
  thresholds: {
    http_req_failed: ['rate<0.20'],
    http_req_duration: ['p(95)<1200'],
    logical_errors: ['rate<0.02']
  }
};

export default function () {
  const payload = JSON.stringify({
    organizerId: __ENV.ORGANIZER_ID,
    eventId: __ENV.EVENT_ID,
    customerEmail: `hot-${__VU}-${__ITER}@mail.com`,
    items: [{ ticketTypeId: __ENV.TICKET_TYPE_ID, quantity: 1 }]
  });

  const res = http.post(`${__ENV.API_URL}/checkout/reserve`, payload, {
    headers: { 'Content-Type': 'application/json' }
  });

  const ok = check(res, {
    'status expected': (r) => r.status === 200 || r.status === 400,
    'json body parseable': (r) => !!r.body
  });

  if (!ok) {
    logicalErrors.add(1);
  }

  if (res.status === 200) {
    reserveOk.add(1);
  } else {
    reserveFail.add(1);
    const body = res.body || '';
    if (body.includes('Sin stock')) {
      overQuotaSignals.add(1);
    }
  }

  sleep(0.2);
}

export function handleSummary(data) {
  const okCount = data.metrics.reserve_ok?.values?.count || 0;
  const failCount = data.metrics.reserve_fail?.values?.count || 0;
  const p95 = data.metrics.http_req_duration?.values?.['p(95)'] || 0;
  const errRate = data.metrics.http_req_failed?.values?.rate || 0;

  const oversellSuspected = QUOTA > 0 ? okCount > QUOTA : false;

  const summary = {
    quota: QUOTA,
    reserved_ok: okCount,
    reserve_fail: failCount,
    http_error_rate: errRate,
    latency_p95_ms: p95,
    oversell_suspected: oversellSuspected,
    oversell_signal_only: true,
    source_of_truth: 'Ejecutar loadtests/verify-no-oversell.sql contra Postgres para validar no sobreventa real.'
  };

  return {
    stdout: JSON.stringify(summary, null, 2),
    'loadtests/hot-event-summary.json': JSON.stringify(summary, null, 2)
  };
}
