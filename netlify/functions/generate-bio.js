export default async (request)=>{
  try{
    if(request.method==="GET"){
      return new Response(JSON.stringify({ ok:true, health:"generate-bio-ready" }), { status:200, headers:{ "Content-Type":"application/json" }});
    }
    if(request.method!=="POST"){
      return new Response(JSON.stringify({ error:"POST only" }), { status:405, headers:{ "Content-Type":"application/json" }});
    }

    const { prompt="", tone="Professionnel" } = await request.json();
    if(!String(prompt||"").trim()){
      return new Response(JSON.stringify({ error:"Missing prompt" }), { status:400, headers:{ "Content-Type":"application/json" }});
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if(!apiKey){
      return new Response(JSON.stringify({ error:"Missing OPENAI_API_KEY" }), { status:500, headers:{ "Content-Type":"application/json" }});
    }

    const sys = [
      "Tu es un rédacteur de bios concises et percutantes en français.",
      "2 à 4 phrases max. Axe résultats, crédibilité, clarté.",
      "Adapte le ton à: " + tone
    ].join("\n");

    const resp = await fetch("https://api.openai.com/v1/chat/completions",{
      method:"POST",
      headers:{ "Authorization":`Bearer ${apiKey}`, "Content-Type":"application/json" },
      body: JSON.stringify({
        model:"gpt-4o-mini",
        messages:[
          { role:"system", content: sys },
          { role:"user", content: "Génère une bio à partir de cette description: " + String(prompt) }
        ],
        temperature:0.7,
        max_tokens:220
      })
    });

    if(!resp.ok){
      const t = await resp.text();
      return new Response(JSON.stringify({ error:"Upstream OpenAI error", detail:t }), { status:502, headers:{ "Content-Type":"application/json" }});
    }

    const data = await resp.json();
    const out  = data?.choices?.[0]?.message?.content?.trim() || "";
    return new Response(JSON.stringify({ ok:true, bio:out, meta:{ model:"gpt-4o-mini", len:out.length, tone } }), {
      status:200, headers:{ "Content-Type":"application/json" }
    });
  }catch(e){
    return new Response(JSON.stringify({ error:"Unhandled", detail:String(e) }), { status:500, headers:{ "Content-Type":"application/json" }});
  }
};
