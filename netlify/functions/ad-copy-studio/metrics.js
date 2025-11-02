export default async (request) => {
  try {
    const { product, audience, tone, platform } = await request.json();
    const summary = `Ad pour ${platform} | ${tone}\nProduit: ${product}\nAudience: ${audience}\nHooks: 3 variantes\n- Variante 1: Douleur -> Solution -> Preuve\n- Variante 2: Bénéfice -> Spécificité -> CTA\n- Variante 3: Objection -> Renversement -> CTA`;
    return new Response(summary, { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ error: "Unhandled", detail: String(e) }), { status: 500 });
  }
};
