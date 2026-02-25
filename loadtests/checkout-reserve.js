import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  scenarios: {
    buyers_500: { executor: 'constant-vus', vus: 500, duration: '30s' },
    buyers_1000: { executor: 'constant-vus', vus: 1000, duration: '30s', startTime: '35s' },
    buyers_5000: { executor: 'constant-vus', vus: 5000, duration: '30s', startTime: '70s' }
  }
};

export default function () {
  const payload = JSON.stringify({
    organizerId: __ENV.ORGANIZER_ID,
    eventId: __ENV.EVENT_ID,
    customerEmail: `load-${__VU}-${__ITER}@mail.com`,
    items: [{ ticketTypeId: __ENV.TICKET_TYPE_ID, quantity: 1 }]
  });

  const res = http.post(`${__ENV.API_URL}/checkout/reserve`, payload, { headers: { 'Content-Type': 'application/json' } });
  check(res, { 'status 200': (r) => r.status === 200 });
  sleep(1);
}
