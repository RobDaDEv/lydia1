export const config = { runtime: "edge" };

export default async function handler(req) {
  try {
    const { searchParams } = new URL(req.url);
    const DEFAULT_AGENT_ID = "agent_9901k319scqeftdt2x9nb1ht8p6j";
    const agentId = searchParams.get("agentId") || DEFAULT_AGENT_ID;

    const xiKey = process.env.ELEVENLABS_API_KEY;
    if (!xiKey) {
      return new Response(JSON.stringify({ error: "Missing ELEVENLABS_API_KEY on server" }), { status: 500, headers: { "content-type": "application/json" } });
    }

    const r = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`,
      { headers: { "xi-api-key": xiKey } }
    );

    if (!r.ok) {
      const text = await r.text();
      return new Response(JSON.stringify({ error: text }), { status: r.status, headers: { "content-type": "application/json" } });
    }
    const data = await r.json();
    return new Response(JSON.stringify({ signedUrl: data.signed_url }), { status: 200, headers: { "content-type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to retrieve signed URL" }), { status: 500, headers: { "content-type": "application/json" } });
  }
}
