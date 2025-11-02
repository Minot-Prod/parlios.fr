const $=(q)=>document.querySelector(q);
function setStatus(m){const el=$("#status"); if(el) el.textContent=m||"";}

async function callAPI(prompt,tone){
  const res = await fetch("/.netlify/functions/generate-bio",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ prompt, tone })
  });
  const json = await res.json();
  if(!res.ok || json.error){ throw new Error(json.error || `HTTP ${res.status}`); }
  return json;
}

document.addEventListener("DOMContentLoaded", ()=>{
  $("#go").addEventListener("click", async ()=>{
    const btn=$("#go"), out=$("#result");
    const prompt=$("#prompt").value.trim(), tone=$("#tone").value.trim();
    if(!prompt || prompt.length<8){ setStatus("👉 Ajoute une description (8–10 mots)."); return; }
    try{
      btn.disabled=true; setStatus("⏳ Génération…"); out.textContent="";
      const { bio } = await callAPI(prompt, tone);
      out.textContent = bio?.trim() || "(vide)";
      setStatus("✅ Fini");
    }catch(e){
      console.error(e); setStatus("❌ " + (e?.message || "Erreur inconnue"));
    }finally{
      btn.disabled=false;
    }
  });
});

// Optionnel: PAYMENT_LINK injecté côté Netlify si tu veux un CTA payant
const PAYMENT_LINK = (typeof window!=="undefined" && window.PAYMENT_LINK) || "";
if(PAYMENT_LINK){
  const cta=document.getElementById("cta");
  cta.href=PAYMENT_LINK; cta.textContent="⭐ Débloquer le pack Pro";
}else{
  document.querySelector(".cta-row").style.display="none";
}
