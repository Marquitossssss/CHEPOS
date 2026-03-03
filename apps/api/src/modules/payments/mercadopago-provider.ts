export type MercadoPagoPayment = {
  id: string;
  status: string;
  external_reference?: string | null;
  metadata?: Record<string, unknown>;
};

export async function fetchMercadoPagoPayment(paymentId: string): Promise<MercadoPagoPayment | null> {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token) return null;

  const response = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error(`mercadopago payment fetch failed: ${response.status}`);
  }

  const data = await response.json() as any;
  return {
    id: String(data.id),
    status: String(data.status ?? "unknown"),
    external_reference: data.external_reference ? String(data.external_reference) : null,
    metadata: data.metadata && typeof data.metadata === "object" ? data.metadata : undefined
  };
}
