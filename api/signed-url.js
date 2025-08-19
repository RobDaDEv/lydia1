// Lydia AI: ElevenLabs signed URL function with detailed logging
export default async function handler(req, res) {
  const t0 = Date.now();
  const rid = Math.random().toString(36).slice(2, 8); // simple request id for logs
  try {
    const DEFAULT_AGENT_ID = "agent_9901k319scqeftdt2x9nb1ht8p6j";
    const { agentId } = req.query || {};
    const finalAgentId = (agentId && String(agentId).trim()) || DEFAULT_AGENT_ID;

    const xiKey = process.env.ELEVENLABS_API_KEY;
    if (!xiKey) {
      console.error(`[signed-url ${rid}] Missing ELEVENLABS_API_KEY`);
      return res.status(500).json({ error: "Server misconfigured: ELEVENLABS_API_KEY not set." });
    }

    const url = `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(finalAgentId)}`;
    const r = await fetch(url, { headers: { "xi-api-key": xiKey } }).catch(err => {
      console.error(`[signed-url ${rid}] fetch error:`, err);
      throw err;
    });

    const bodyText = await r.text();
    let data;
    try { data = JSON.parse(bodyText); } catch { data = null; }

    console.log(`[signed-url ${rid}] status=${r.status} agent=${finalAgentId} took=${Date.now()-t0}ms`);

    if (!r.ok) {
      // Common patterns to help debugging
      let hint = "Unknown error from ElevenLabs.";
      if (r.status === 401) hint = "Unauthorized. Check ELEVENLABS_API_KEY value.";
      if (r.status === 403) hint = "Forbidden. Key lacks Conversational AI permission or workspace mismatch.";
      if (r.status === 404) hint = "Agent not found. Verify the Agent ID.";
      return res.status(r.status).json({ error: data?.error || bodyText || hint, hint, status: r.status });
    }

    const signedUrl = data?.signed_url;
    if (!signedUrl) {
      return res.status(502).json({ error: "No signed_url in ElevenLabs response." });
    }
    return res.status(200).json({ signedUrl, rid });
  } catch (err) {
    console.error(`[signed-url ${rid}] Exception:`, err);
    return res.status(500).json({ error: "Failed to retrieve signed URL." });
  }
}
