# ADR-0000 — Product Reality

- **Status:** Proposed
- **Owner:** Marcos
- **Date:** YYYY-MM-DD

## Context
Articket es un sistema de ticketing para eventos con ventas y check-in.

## Target Operating Envelope (numbers or it’s fiction)
- Max event capacity (tickets): _____
- Peak concurrent buyers (during drop): _____
- Peak RPS on API: _____ (buy flow / check-in / webhooks)
- Check-in throughput target: _____ scans/min por puerta
- Network at venue (choose): Good / Degraded / Unreliable / Offline
- SLA expectation (availability): _____ (e.g., 99.9% monthly)
- RTO / RPO (recovery objectives): RTO ___ / RPO ___
- Latency targets:
  - purchase p95: ___ ms
  - check-in p95: ___ ms

## Business Model
- Pricing model: per ticket / per event / subscription / hybrid
- Who is customer: organizer / venue / promoter
- Support model during events: 24/7? on-call? none?

## Payments
- Provider(s): MercadoPago / ____
- Payment confirmation: webhook / polling / both
- Refund policy baseline: auto / manual / conditional
- Chargeback expectations: low / medium / high

## Compliance & Data
- PII stored: name/email/DNI/etc
- Data retention policy: _____
- Audit requirements: _____
- Legal constraints (Argentina): facturación? IVA? (nota)

## Check-in stance
- Mode: Online-only (default) | Offline/degraded supported
- If offline supported: describe threat model and conflict resolution strategy.

## Failure Modes (mandatory)
For each, define expected behavior + operator action:
- Payment provider outage
- Webhook duplication
- Webhook missing
- Redis outage
- Postgres outage (read-only?)
- Partial network at venue
- Worker backlog/lag during ticket issuance

## Decision
This ADR defines the baseline operating reality for calibrating all technical ADRs.

## Consequences
List technical implications (e.g., need for RLS, outbox, offline mode complexity).
