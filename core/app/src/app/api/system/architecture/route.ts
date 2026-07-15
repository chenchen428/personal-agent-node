import delivery from "../../../../../../../registry/delivery.json";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return Response.json({ ok: true, architecture: delivery }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
