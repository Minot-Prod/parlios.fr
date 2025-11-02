export default async (request) => {
  try {
    const data = await request.json();
    return new Response(`OK — ${JSON.stringify(data)}`, { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ error: "Unhandled", detail: String(e) }), { status: 500 });
  }
};
