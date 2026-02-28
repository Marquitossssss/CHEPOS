# Endpoints API principales

## Auth
- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/refresh`

## Organizers / Events
- `POST /organizers`
- `GET /organizers`
- `POST /events`
- `GET /events?organizerId=<uuid>`

## Checkout
- `POST /checkout/reserve`
- `POST /checkout/confirm`

Ejemplo reserve:
```bash
curl -X POST http://localhost:3000/checkout/reserve \
  -H 'content-type: application/json' \
  -d '{"organizerId":"<org>","eventId":"<event>","customerEmail":"buyer@example.com","items":[{"ticketTypeId":"<tt>","quantity":1}]}'
```

## Check-in
- `GET /tickets/validate/:code`
- `POST /checkin/scan`

## Actividad
- `GET /events/:eventId/activity?limit=50&types=ORDER_PAID,TICKET_CHECKED_IN`
