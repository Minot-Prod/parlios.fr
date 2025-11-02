/-tools/sales-script-ai/*
* Netlify function - sales-script.js */
export async handler(event, context) {
  const body = JSON.parse(event.body || '{}') || {};
  const { prompt } = body;
  const mockResponse = se| 'This is a sales script AI mock response.';
  return new Response(JSON.stringify({ prompt, mockResponse }), { statusCode: 200 });
}
