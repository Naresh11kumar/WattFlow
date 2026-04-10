/**
 * WattFlow v3 – Multi-Resource Virtual Energy Storage System
 * Resources: Solar · Wind · Hydro · Biogas · Grid Import
 * Tabs: Dashboard · Sources · Optimization · Appliances · LCOE · History
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ComposedChart, ReferenceLine,
} from "recharts";
import Login from "./Login.jsx";
// ─── CONFIG ──────────────────────────────────────────────────────────────────
const API_URL = "http://localhost:5000";
const COLORS = {
  solar:  "#f0c030",
  wind:   "#60a5fa",
  hydro:  "#34d399",
  biogas: "#a78bfa",
  grid:   "#f87171",
  demand: "#fb923c",
  opt:    "#4ade80",
  bg:     "#0d1117",
  card:   "#161b22",
  border: "#21262d",
  muted:  "#6e7681",
  text:   "#e6edf3",
};

const SEASONS   = ["summer","winter","monsoon","spring"];
const WEATHERS  = ["clear","partly_cloudy","overcast"];
const STRATEGIES = [
  { id:"balanced", label:"⚖ Balanced",  desc:"Cost + carbon + peak" },
  { id:"green",    label:"🌿 Green",    desc:"Max renewable %" },
  { id:"economic", label:"💰 Economic", desc:"Min ₹ cost only" },
];

const TARIFF = [7,7,7,7,7,7, 9,12,14,14,12,10, 9,9,9,11,13,16, 20,22,20,15,11,8];
const CARBON  = [0.88,0.88,0.88,0.88,0.88,0.84,0.79,0.73,0.58,0.48,0.37,0.27,
                 0.22,0.22,0.28,0.38,0.53,0.68,0.83,0.90,0.90,0.90,0.89,0.88];
const LCOE_DATA = [
  {source:"Solar PV", lcoe:2.8,  color:"#f0c030", carbon:0.04},
  {source:"Wind",     lcoe:3.2,  color:"#60a5fa", carbon:0.011},
  {source:"Hydro",    lcoe:4.5,  color:"#34d399", carbon:0.024},
  {source:"Biogas",   lcoe:5.8,  color:"#a78bfa", carbon:0.23},
  {source:"Coal Grid",lcoe:8.5,  color:"#f87171", carbon:0.82},
  {source:"Diesel",   lcoe:18.0, color:"#fb923c", carbon:0.70},
];

// ─── LOCAL FALLBACK SIMULATION ───────────────────────────────────────────────
const rnd = (a, b) => Math.random() * (b - a) + a;
function localSim(season="summer", weather="clear") {
  const AMP = {summer:5.8,monsoon:3.2,winter:4.1,spring:5.0};
  const WAMP= {summer:1.2,monsoon:2.8,winter:1.8,spring:1.5};
  const HAMP= {summer:0.75,monsoon:1.4,winter:0.6,spring:0.9};
  const CF  = {clear:1.0,partly_cloudy:rnd(0.55,0.8),overcast:rnd(0.15,0.4)};
  const EVE = {summer:20,monsoon:19,winter:18,spring:19};

  return Array.from({length:24},(_,h)=>{
    const solar  = h<6||h>19 ? 0 : Math.max(0, parseFloat(((AMP[season]||5.8)*Math.exp(-((h-12)**2)/(2*10.24))*(CF[weather]||1)+rnd(-0.05,0.05)).toFixed(3)));
    const wind   = Math.max(0, parseFloat(((WAMP[season]||1.2)+0.9*Math.cos((h-3)*Math.PI/12)+rnd(-0.3,0.35)).toFixed(3)));
    const hydro  = Math.max(0.1, parseFloat(((HAMP[season]||0.75)+0.12*Math.sin(h*Math.PI/12)+rnd(-0.04,0.04)).toFixed(3)));
    const biogas = Math.max(0.1, parseFloat(((6<=h&&h<=18?0.45:0.35)+rnd(-0.04,0.06)).toFixed(3)));
    const eveH   = EVE[season]||19;
    const demand = Math.max(0.5, parseFloat((0.85+2.1*Math.exp(-((h-7)**2)/4)+3.6*Math.exp(-((h-eveH)**2)/5)+(season==="summer"&&h>=12&&h<=22?0.4:0)+rnd(0,0.12)).toFixed(3)));
    const totalR = solar+wind+hydro+biogas;
    return {hour:h,label:`${String(h).padStart(2,"0")}:00`,solar,wind,hydro,biogas,demand,tariff:TARIFF[h],carbon_intensity:CARBON[h],total_renew:totalR,grid_import:Math.max(0,parseFloat((demand-totalR).toFixed(3)))};
  });
}

function localOptimize(readings, strategy="balanced") {
  const totalR = readings.map(r=>r.solar+r.wind+r.hydro+r.biogas);
  const opt = readings.map(r=>({...r,opt_demand:r.demand,opt_biogas:r.biogas}));

  // Appliance scheduling
  const APPS=[
    {id:"ac",name:"HVAC / AC",icon:"❄️",power:2.1,duration:6,priority:1,preferred:[9,10,11,12,13,14,15,16]},
    {id:"ev",name:"EV Charging",icon:"🚗",power:1.4,duration:4,priority:2,preferred:[9,10,11,12,13,14,15]},
    {id:"wh",name:"Water Heater",icon:"🚿",power:0.9,duration:2,priority:2,preferred:[9,10,11,12,13,14]},
    {id:"wm",name:"Washing Machine",icon:"🫧",power:0.8,duration:2,priority:3,preferred:[10,11,12,13,14]},
    {id:"dw",name:"Dishwasher",icon:"🍽️",power:0.6,duration:2,priority:3,preferred:[11,12,13,14,15]},
    {id:"pp",name:"Pool Pump",icon:"💧",power:0.5,duration:3,priority:4,preferred:[10,11,12,13,14,15]},
  ];

  const schedule={}, app_details=[];
  [...APPS].sort((a,b)=>a.priority-b.priority).forEach(app=>{
    let best=app.preferred[0], bestScore=-Infinity;
    app.preferred.forEach(h=>{
      const renew=Array.from({length:app.duration},(_,i)=>totalR[Math.min(h+i,23)]).reduce((a,v)=>a+v,0);
      const tariffP=Array.from({length:app.duration},(_,i)=>TARIFF[Math.min(h+i,23)]).reduce((a,v)=>a+v,0);
      const score=strategy==="green"?renew*3:strategy==="economic"?-tariffP*2:renew*2-tariffP*0.5;
      if(score>bestScore){bestScore=score;best=h;}
    });
    const orig=app.preferred[app.preferred.length-1];
    schedule[app.id]=best;
    const energy=app.power*app.duration;
    const origCost=Array.from({length:app.duration},(_,i)=>TARIFF[Math.min(orig+i,23)]).reduce((a,v)=>a+v,0)*app.power;
    const newCost =Array.from({length:app.duration},(_,i)=>TARIFF[Math.min(best+i,23)]).reduce((a,v)=>a+v,0)*app.power;
    const r=readings[best]; const sources={solar:r.solar,wind:r.wind,hydro:r.hydro,biogas:r.biogas};
    app_details.push({app_id:app.id,app_name:app.name,app_icon:app.icon,original_hour:orig,optimized_hour:best,power_kw:app.power,duration_h:app.duration,energy_kwh:parseFloat(energy.toFixed(2)),saving_inr:parseFloat((origCost-newCost).toFixed(1)),primary_source:Object.entries(sources).sort((a,b)=>b[1]-a[1])[0][0]});
  });

  // Demand shifting
  let pool=0;
  [17,18,19,20,21,22].forEach(h=>{const row=opt[h];const red=Math.min(Math.max(0,row.demand-totalR[h])*0.45,0.65);row.opt_demand=parseFloat((row.demand-red).toFixed(3));pool+=red;});
  const rich=[...Array(24).keys()].sort((a,b)=>totalR[b]-totalR[a]).slice(0,6);
  rich.forEach(h=>{opt[h].opt_demand=parseFloat((opt[h].opt_demand+pool/6).toFixed(3));});

  // Biogas dispatch
  opt.forEach(row=>{
    const h=row.hour;const renew=row.solar+row.wind+row.hydro;
    row.opt_biogas=parseFloat((renew<1.0?row.biogas*1.4:renew>3.5?row.biogas*0.5:row.biogas).toFixed(3));
    const supply=row.solar+row.wind+row.hydro+row.opt_biogas;
    row.grid_import=parseFloat(Math.max(0,row.opt_demand-supply).toFixed(3));
    row.surplus=parseFloat(Math.max(0,supply-row.opt_demand).toFixed(3));
    const load=row.opt_demand||1;
    row.source_mix={solar:Math.round(Math.min(row.solar,load)/load*100),wind:Math.round(Math.min(row.wind,load)/load*100),hydro:Math.round(Math.min(row.hydro,load)/load*100),biogas:Math.round(Math.min(row.opt_biogas,load)/load*100),grid:Math.round(row.grid_import/load*100)};
  });

  const origCost=readings.reduce((s,r)=>s+Math.max(0,r.demand-(r.solar+r.wind+r.hydro+r.biogas))*TARIFF[r.hour],0);
  const optCost =opt.reduce((s,r)=>s+Math.max(0,r.opt_demand-(r.solar+r.wind+r.hydro+r.opt_biogas))*TARIFF[r.hour],0);
  const origCO2 =readings.reduce((s,r)=>s+Math.max(0,r.demand-(r.solar+r.wind+r.hydro+r.biogas))*CARBON[r.hour],0);
  const optCO2  =opt.reduce((s,r)=>s+Math.max(0,r.opt_demand-(r.solar+r.wind+r.hydro+r.opt_biogas))*CARBON[r.hour],0);
  const shifted=parseFloat(readings.reduce((a,r,i)=>a+Math.max(0,r.demand-opt[i].opt_demand),0).toFixed(2));
  const origPeak=Math.max(...readings.map(r=>r.demand));
  const optPeak=Math.max(...opt.map(r=>r.opt_demand));
  const totalOptD=opt.reduce((s,r)=>s+r.opt_demand,0);
  const renewUsed=opt.reduce((s,r)=>s+Math.min(r.opt_demand,r.solar+r.wind+r.hydro+r.opt_biogas),0);
  const totalGrid=opt.reduce((s,r)=>s+r.grid_import,0);

  return {
    strategy,
    optimized_data:opt.map(d=>({...d,label:`${String(d.hour).padStart(2,"0")}:00`,optDemand:d.opt_demand,optBiogas:d.opt_biogas})),
    schedule, appliance_details:app_details,
    shifted_kwh:shifted,
    peak_reduction:parseFloat(((1-optPeak/origPeak)*100).toFixed(1)),
    money_saved:parseFloat((origCost-optCost).toFixed(0)),
    money_pct:parseFloat(((1-optCost/origCost)*100).toFixed(1)),
    carbon_saved:parseFloat((origCO2-optCO2).toFixed(2)),
    carbon_pct:parseFloat(((1-optCO2/origCO2)*100).toFixed(1)),
    renewable_pct:parseFloat((renewUsed/totalOptD*100).toFixed(1)),
    grid_stress_score:parseFloat(((1-totalGrid/totalOptD)*100).toFixed(1)),
    lcoe_before:8.2, lcoe_after:3.9,
  };
}

// ─── API CLIENT ───────────────────────────────────────────────────────────────
async function apiFetch(path, opts={}) {
  const res = await fetch(`${API}${path}`,{headers:{"Content-Type":"application/json"},...opts});
  if(!res.ok){const e=await res.json().catch(()=>({}));throw new Error(e.detail||`HTTP ${res.status}`);}
  return res.json();
}

// ─── UI ATOMS ─────────────────────────────────────────────────────────────────
const Tip = ({active,payload,label}) => {
  if(!active||!payload?.length) return null;
  return (
    <div style={{background:COLORS.bg,border:`1px solid ${COLORS.border}`,borderRadius:10,padding:"10px 14px",fontSize:12}}>
      <p style={{color:COLORS.muted,marginBottom:6,fontWeight:600}}>{label}</p>
      {payload.map((p,i)=>(
        <p key={i} style={{color:p.color,margin:"2px 0"}}>{p.name}: <strong>{typeof p.value==="number"?p.value.toFixed(2):p.value}</strong></p>
      ))}
    </div>
  );
};

function Card({children,style={},glow}){
  return (
    <div style={{background:COLORS.card,border:`1px solid ${COLORS.border}`,borderRadius:16,padding:22,...(glow?{boxShadow:`0 0 20px ${glow}22`}:{}), ...style}}>
      {children}
    </div>
  );
}

function MetricCard({icon,label,value,unit,color,sub,delta}){
  return (
    <div style={{background:`linear-gradient(135deg,${COLORS.card} 0%,${COLORS.bg} 100%)`,border:`1px solid ${color}33`,borderRadius:16,padding:"18px 20px",flex:1,minWidth:140,position:"relative",overflow:"hidden"}}>
      <div style={{position:"absolute",top:-16,right:-16,width:70,height:70,borderRadius:"50%",background:`${color}18`,filter:"blur(18px)"}}/>
      <div style={{fontSize:20,marginBottom:6}}>{icon}</div>
      <div style={{fontSize:10,color:COLORS.muted,letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:3}}>{label}</div>
      <div style={{fontSize:24,fontWeight:700,color,fontFamily:"monospace",lineHeight:1}}>
        {value}<span style={{fontSize:12,marginLeft:3,color:COLORS.muted}}>{unit}</span>
      </div>
      {sub   && <div style={{fontSize:10,color:COLORS.muted,marginTop:3}}>{sub}</div>}
      {delta && <div style={{fontSize:11,color:"#4ade80",marginTop:3}}>▲ {delta}</div>}
    </div>
  );
}

function Hdr({title,badge}){
  return (
    <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
      <h3 style={{margin:0,fontSize:14,fontWeight:600,color:COLORS.text}}>{title}</h3>
      {badge&&<span style={{background:"#21262d",border:`1px solid ${COLORS.border}`,borderRadius:20,padding:"2px 9px",fontSize:10,color:COLORS.muted}}>{badge}</span>}
    </div>
  );
}

function TabBtn({id,label,active,onClick}){
  return (
    <button onClick={()=>onClick(id)} style={{
      background:active?"linear-gradient(135deg,#21262d,#30363d)":"transparent",
      border:active?"1px solid #30363d":"1px solid transparent",
      borderRadius:9,padding:"7px 16px",fontSize:12,
      color:active?COLORS.text:COLORS.muted,cursor:"pointer",
      fontWeight:active?600:400,transition:"all 0.2s",whiteSpace:"nowrap",
    }}>{label}</button>
  );
}

function SourceDot({color,label}){
  return <span style={{display:"flex",alignItems:"center",gap:5,fontSize:11,color:COLORS.muted}}>
    <span style={{width:10,height:10,borderRadius:2,background:color,flexShrink:0}}/>
    {label}
  </span>;
}

// ─── MAIN APP ──────────────────────────────────────────────────────────────────
export default function WattFlow() {

  const [optimizedData, setOptimizedData] = useState(null);
  const [shiftedEnergy, setShiftedEnergy] = useState(0);
  const runOptimization = async () => {
  const res = await fetch("http://127.0.0.1:8000/simulate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      solar: 120,
      demand: 200,
    }),
  });

  const data = await res.json();
  console.log(data);
};
<button onClick={runOptimization}>
  Run AI Optimization
</button>
  // your existing states + UI below
  const [online,   setOnline]    = useState(false);
  const [sim,      setSim]       = useState(null);      // raw simulation
  const [opt,      setOpt]       = useState(null);      // optimization result
  const [history,  setHistory]   = useState([]);
  const [stats,    setStats]     = useState(null);
  const [lcoeData, setLcoeData]  = useState(LCOE_DATA);
  const [tab,      setTab]       = useState("dashboard");
  const [running,  setRunning]   = useState(false);
  const [progress, setProgress]  = useState(0);
  const [error,    setError]     = useState(null);
  const [strategy, setStrategy]  = useState("balanced");
  const [season,   setSeason]    = useState("summer");
  const [weather,  setWeather]   = useState("clear");
  const [showHistory, setShowHist] = useState(false);

  // ── Boot ──────────────────────────────────────────────────────────────────
  useEffect(()=>{
    apiFetch("/").then(()=>{setOnline(true);loadHistory();loadStats();loadLcoe();}).catch(()=>setOnline(false));
  },[]);

  useEffect(()=>{ newSim(); },[online]);

  const loadHistory = async()=>{ try{setHistory(await apiFetch("/api/simulations"));}catch(_){} };
  const loadStats   = async()=>{ try{setStats(await apiFetch("/api/stats"));}catch(_){} };
  const loadLcoe    = async()=>{ try{const d=await apiFetch("/api/lcoe");setLcoeData(d.sources);}catch(_){} };

  // ── New simulation ─────────────────────────────────────────────────────────
  const newSim = useCallback(async()=>{
    setError(null); setOpt(null); setProgress(0);
    try{
      if(online){
        const data=await apiFetch(`/api/simulate?season=${season}&weather=${weather}`,{method:"POST"});
        setSim({id:data.id,label:data.label,season:data.season,weather:data.weather,
                readings:data.readings,...data.totals,...data.metrics});
        await loadHistory();
      } else {
        const readings=localSim(season,weather);
        const ts=parseFloat(readings.reduce((s,r)=>s+r.solar,0).toFixed(2));
        const tw=parseFloat(readings.reduce((s,r)=>s+r.wind,0).toFixed(2));
        const th=parseFloat(readings.reduce((s,r)=>s+r.hydro,0).toFixed(2));
        const tb=parseFloat(readings.reduce((s,r)=>s+r.biogas,0).toFixed(2));
        const td=parseFloat(readings.reduce((s,r)=>s+r.demand,0).toFixed(2));
        const tr=ts+tw+th+tb;
        setSim({id:null,label:`Local ${season}/${weather}`,season,weather,readings,
                solar:ts,wind:tw,hydro:th,biogas:tb,demand:td,renewable:tr,
                grid_draw:parseFloat(Math.max(0,td-tr).toFixed(2)),
                renewable_pct:parseFloat((Math.min(tr,td)/td*100).toFixed(1)),
                raw_cost:parseFloat(readings.reduce((s,r)=>s+Math.max(0,r.demand-r.total_renew)*r.tariff,0).toFixed(0)),
                lcoe_blended:3.9});
      }
    }catch(e){setError(e.message);}
  },[online,season,weather]);

  // ── Optimize ──────────────────────────────────────────────────────────────
  const runOpt = useCallback(async()=>{
    if(running||!sim) return;
    setRunning(true); setProgress(0); setOpt(null); setError(null);
    let p=0; const tick=setInterval(()=>{ p=Math.min(p+rnd(5,18),90); setProgress(p); },110);
    try{
      let result;
      if(online&&sim.id){
        result=await apiFetch(`/api/optimize/${sim.id}?strategy=${strategy}`,{method:"POST"});
        await loadHistory(); await loadStats();
      } else {
        await new Promise(r=>setTimeout(r,800));
        result=localOptimize(sim.readings,strategy);
      }
      clearInterval(tick); setProgress(100);
      setOpt(result); setTab("optimization");
    }catch(e){ clearInterval(tick); setError(e.message); }
    finally{ setRunning(false); }
  },[running,sim,online,strategy]);

  // ── Load history entry ────────────────────────────────────────────────────
  const loadHistoryEntry = async(id)=>{
    try{
      const data=await apiFetch(`/api/simulation/${id}`);
      setSim({id:data.id,label:data.label,season:data.season,weather:data.weather_profile,
              readings:data.readings,
              solar:data.total_solar,wind:data.total_wind,hydro:data.total_hydro,biogas:data.total_biogas,
              demand:data.total_demand,renewable:data.total_renew,grid_draw:data.grid_draw,
              renewable_pct:data.renewable_pct,raw_cost:data.total_cost_raw,lcoe_blended:data.lcoe_blended});
      if(data.optimization){
        const o=data.optimization;
        setOpt({...o,optimized_data:o.optimized_data?.map(d=>({...d,optDemand:d.opt_demand,optBiogas:d.opt_biogas})),
                appliance_details:o.appliance_details||[]});
      } else setOpt(null);
      setShowHist(false); setTab("dashboard");
    }catch(e){setError(e.message);}
  };

  const delHistoryEntry = async(id)=>{
    try{
      await apiFetch(`/api/simulation/${id}`,{method:"DELETE"});
      await loadHistory();
      if(sim?.id===id) newSim();
    }catch(e){setError(e.message);}
  };

  // ── Derived chart data ────────────────────────────────────────────────────
  const raw = sim?.readings || [];
  const optData = opt?.optimized_data || [];

  const stackedRaw = raw.map(r=>({
    ...r,
    totalRenew:parseFloat((r.solar+r.wind+r.hydro+r.biogas).toFixed(3)),
  }));

  const compData = raw.map((r,i)=>({
    ...r,
    optDemand: optData[i]?.optDemand??null,
    optBiogas: optData[i]?.optBiogas??null,
    surplus:   optData[i]?.surplus??null,
    gridImport:optData[i]?.grid_import??null,
  }));

  const radarData = sim ? [
    {metric:"Renewable %",  before:sim.renewable_pct,          after:opt?.renewable_pct??null},
    {metric:"Peak Control", before:30,                          after:opt?.peak_reduction??null},
    {metric:"Cost Eff.",    before:20,                          after:opt?.money_pct??null},
    {metric:"CO₂ Avoid.",   before:15,                          after:opt?.carbon_pct??null},
    {metric:"Grid Stress",  before:100-sim.renewable_pct,       after:opt?.grid_stress_score??null},
  ] : [];

  if(!sim) return <div style={{background:COLORS.bg,minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",color:COLORS.text}}>⚡ Initialising WattFlow...</div>;

  return (
    <div style={{minHeight:"100vh",background:COLORS.bg,fontFamily:"'Inter','SF Pro Display',sans-serif",color:COLORS.text,paddingBottom:60}}>

      {/* ─── HEADER ─────────────────────────────────────────────────────── */}
      <div style={{background:"linear-gradient(180deg,#161b22 0%,transparent 100%)",borderBottom:`1px solid ${COLORS.border}`,padding:"14px 28px",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:100,backdropFilter:"blur(12px)"}}>

        {/* Logo + status */}
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{width:34,height:34,borderRadius:10,background:"linear-gradient(135deg,#f0c030,#f97316)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,boxShadow:"0 0 14px #f0c03044"}}>⚡</div>
          <div>
            <div style={{fontSize:16,fontWeight:700,letterSpacing:"-0.02em"}}>WattFlow <span style={{fontSize:11,color:COLORS.muted,fontWeight:400}}>v3</span></div>
            <div style={{fontSize:10,color:COLORS.muted,marginTop:-1}}>Multi-Resource Virtual Energy Storage</div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:5,background:online?"#22c55e18":"#f8711118",border:`1px solid ${online?"#22c55e44":"#f8711144"}`,borderRadius:20,padding:"3px 10px",fontSize:10,color:online?"#4ade80":"#f87171"}}>
            <span style={{fontSize:8}}>●</span>{online?"Backend Live":"Local Mode"}
          </div>
          {sim.id&&<span style={{fontSize:10,color:COLORS.muted}}>Sim #{sim.id} · {sim.season} · {sim.weather}</span>}
        </div>

        {/* Controls */}
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          <select value={season} onChange={e=>{setSeason(e.target.value);}} style={{background:"#21262d",border:`1px solid ${COLORS.border}`,borderRadius:8,padding:"6px 10px",color:COLORS.text,fontSize:12,cursor:"pointer"}}>
            {SEASONS.map(s=><option key={s} value={s}>{s.charAt(0).toUpperCase()+s.slice(1)}</option>)}
          </select>
          <select value={weather} onChange={e=>{setWeather(e.target.value);}} style={{background:"#21262d",border:`1px solid ${COLORS.border}`,borderRadius:8,padding:"6px 10px",color:COLORS.text,fontSize:12,cursor:"pointer"}}>
            {WEATHERS.map(w=><option key={w} value={w}>{w.replace("_"," ")}</option>)}
          </select>
          <select value={strategy} onChange={e=>setStrategy(e.target.value)} style={{background:"#21262d",border:`1px solid ${COLORS.border}`,borderRadius:8,padding:"6px 10px",color:COLORS.text,fontSize:12,cursor:"pointer"}}>
            {STRATEGIES.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}
          </select>

          <button onClick={()=>setShowHist(!showHistory)} style={{background:showHistory?"#21262d":"transparent",border:`1px solid ${COLORS.border}`,borderRadius:8,padding:"7px 12px",color:COLORS.muted,fontSize:12,cursor:"pointer"}}>
            📋{history.length>0?` (${history.length})`:""}
          </button>
          <button onClick={runOpt} disabled={running} style={{background:running?"#1a3a2a":"linear-gradient(135deg,#22c55e,#16a34a)",border:"none",borderRadius:9,padding:"8px 18px",color:"#fff",fontWeight:600,fontSize:12,cursor:running?"not-allowed":"pointer",display:"flex",alignItems:"center",gap:7,boxShadow:running?"none":"0 0 18px #22c55e33",transition:"all 0.3s"}}>
            {running?<><span style={{animation:"spin 1s linear infinite",display:"inline-block"}}>◌</span>{Math.round(progress)}%</>:<>{opt?"✓ Re-run":"▶ Optimize"}</>}
          </button>
          <button onClick={newSim} style={{background:"transparent",border:`1px solid ${COLORS.border}`,borderRadius:9,padding:"8px 14px",color:COLORS.muted,fontSize:12,cursor:"pointer"}}>⟳ New</button>
        </div>
      </div>

      <div style={{padding:"22px 28px 0"}}>

        {/* Error */}
        {error&&<div style={{background:"#f8711120",border:"1px solid #f8711140",borderRadius:10,padding:"9px 14px",marginBottom:16,fontSize:12,color:"#fca5a5",display:"flex",justifyContent:"space-between"}}>
          <span>⚠ {error}</span><button onClick={()=>setError(null)} style={{background:"none",border:"none",color:"#f87171",cursor:"pointer"}}>✕</button>
        </div>}

        {/* Progress */}
        {running&&<div style={{height:2,background:COLORS.border,borderRadius:2,marginBottom:20,overflow:"hidden"}}>
          <div style={{height:"100%",background:"linear-gradient(90deg,#22c55e,#4ade80)",width:`${progress}%`,transition:"width 0.1s",boxShadow:"0 0 6px #22c55e"}}/>
        </div>}

        {/* History panel */}
        {showHistory&&<Card style={{marginBottom:20}}>
          <Hdr title="Simulation History" badge={`${history.length} saved`}/>
          {history.length===0?<div style={{color:COLORS.muted,fontSize:12,textAlign:"center",padding:"16px 0"}}>No simulations yet</div>:
          <div style={{display:"flex",flexDirection:"column",gap:8,maxHeight:240,overflowY:"auto"}}>
            {history.map(h=>(
              <div key={h.id} style={{background:COLORS.bg,border:`1px solid ${COLORS.border}`,borderRadius:10,padding:"10px 14px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <span style={{fontSize:12,fontWeight:600}}>#{h.id} {h.label}</span>
                  <div style={{fontSize:10,color:COLORS.muted,marginTop:2}}>
                    ☀{h.total_solar} ·🌬{h.total_wind} ·💧{h.total_hydro} ·🌿{h.total_biogas} kWh
                    {h.shifted_kwh!=null&&<span style={{color:"#4ade80"}}> · ✓{h.shifted_kwh}kWh shifted</span>}
                  </div>
                </div>
                <div style={{display:"flex",gap:6}}>
                  <button onClick={()=>loadHistoryEntry(h.id)} style={{background:"#21262d",border:`1px solid ${COLORS.border}`,borderRadius:6,padding:"3px 9px",fontSize:10,color:COLORS.muted,cursor:"pointer"}}>Load</button>
                  <button onClick={()=>delHistoryEntry(h.id)} style={{background:"#f8711118",border:"1px solid #f8711144",borderRadius:6,padding:"3px 9px",fontSize:10,color:"#f87171",cursor:"pointer"}}>✕</button>
                </div>
              </div>
            ))}
          </div>}
        </Card>}

        {/* Global stats bar */}
        {online&&stats&&<div style={{display:"flex",gap:10,marginBottom:20,flexWrap:"wrap"}}>
          {[
            {icon:"📊",label:"Simulations",value:stats.total_simulations,color:"#a78bfa"},
            {icon:"⚡",label:"kWh Shifted",value:`${stats.total_shifted_kwh}`,color:COLORS.opt},
            {icon:"🌿",label:"CO₂ Saved",value:`${stats.total_carbon_saved}kg`,color:"#34d399"},
            {icon:"💰",label:"₹ Saved",value:`₹${stats.total_money_saved}`,color:"#fbbf24"},
            {icon:"☀",label:"Avg Renew%",value:`${stats.avg_renewable_pct}%`,color:COLORS.solar},
            {icon:"📉",label:"Avg Peak↓",value:`${stats.avg_peak_reduction}%`,color:COLORS.wind},
          ].map(s=>(
            <div key={s.label} style={{background:COLORS.card,border:`1px solid ${s.color}22`,borderRadius:12,padding:"8px 14px",flex:1,minWidth:100}}>
              <div style={{fontSize:14}}>{s.icon}</div>
              <div style={{fontSize:10,color:COLORS.muted}}>{s.label}</div>
              <div style={{fontSize:16,fontWeight:700,color:s.color,fontFamily:"monospace"}}>{s.value}</div>
            </div>
          ))}
        </div>}

        {/* Metric cards */}
        <div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:22}}>
          <MetricCard icon="☀️" label="Solar"   value={sim.solar}    unit="kWh" color={COLORS.solar}  sub="Photovoltaic"/>
          <MetricCard icon="🌬️" label="Wind"    value={sim.wind}     unit="kWh" color={COLORS.wind}   sub="Turbines"/>
          <MetricCard icon="💧" label="Hydro"   value={sim.hydro}    unit="kWh" color={COLORS.hydro}  sub="Run-of-river"/>
          <MetricCard icon="🌿" label="Biogas"  value={sim.biogas}   unit="kWh" color={COLORS.biogas} sub="Dispatchable"/>
          <MetricCard icon="🏠" label="Demand"  value={sim.demand}   unit="kWh" color={COLORS.demand} sub={`Grid draw: ${sim.grid_draw} kWh`}/>
          <MetricCard icon="♻" label="Renew %" value={`${sim.renewable_pct}%`} unit="" color={COLORS.opt} sub="Before optimization"/>
          {opt&&<MetricCard icon="💚" label="Shifted"  value={opt.shifted_kwh}  unit="kWh" color="#4ade80"  sub="Virtual storage" delta={`${opt.money_pct}% cost saved`}/>}
          {opt&&<MetricCard icon="🌱" label="CO₂ ↓"   value={`${opt.carbon_pct}%`} unit="" color="#34d399" sub={`${opt.carbon_saved} kg avoided`}/>}
        </div>

        {/* Tabs */}
        <div style={{display:"flex",gap:3,marginBottom:20,background:COLORS.card,borderRadius:12,padding:4,width:"fit-content",border:`1px solid ${COLORS.border}`,overflowX:"auto"}}>
          {[
            {id:"dashboard",    label:"📊 Dashboard"},
            {id:"sources",      label:"⚡ Sources"},
            {id:"optimization", label:"🤖 Optimization"},
            {id:"appliances",   label:"🔌 Appliances"},
            {id:"lcoe",         label:"💰 LCOE"},
            {id:"storage",      label:"🔋 Virtual Storage"},
          ].map(t=><TabBtn key={t.id} {...t} active={tab===t.id} onClick={setTab}/>)}
        </div>

        {/* ═══════════════════════════════════════════════════════════════
            TAB: DASHBOARD
        ═══════════════════════════════════════════════════════════════ */}
        {tab==="dashboard"&&(
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:18}}>

            {/* Stacked renewable supply */}
            <Card style={{gridColumn:"1/-1"}}>
              <Hdr title="All Renewable Sources vs Demand" badge="24h stacked"/>
              <div style={{display:"flex",gap:16,marginBottom:12,flexWrap:"wrap"}}>
                {["solar","wind","hydro","biogas"].map(s=><SourceDot key={s} color={COLORS[s]} label={s.charAt(0).toUpperCase()+s.slice(1)}/>)}
                <SourceDot color={COLORS.demand} label="Demand"/>
              </div>
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={stackedRaw} margin={{top:5,right:10,left:-20,bottom:0}}>
                  <defs>
                    {["solar","wind","hydro","biogas"].map(k=>(
                      <linearGradient key={k} id={`g_${k}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={COLORS[k]} stopOpacity={0.6}/>
                        <stop offset="95%" stopColor={COLORS[k]} stopOpacity={0.1}/>
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border}/>
                  <XAxis dataKey="label" tick={{fill:COLORS.muted,fontSize:9}} interval={2}/>
                  <YAxis tick={{fill:COLORS.muted,fontSize:9}}/>
                  <Tooltip content={<Tip/>}/>
                  <Area type="monotone" dataKey="solar"  name="Solar"  stackId="1" stroke={COLORS.solar}  fill={`url(#g_solar)`}  dot={false}/>
                  <Area type="monotone" dataKey="wind"   name="Wind"   stackId="1" stroke={COLORS.wind}   fill={`url(#g_wind)`}   dot={false}/>
                  <Area type="monotone" dataKey="hydro"  name="Hydro"  stackId="1" stroke={COLORS.hydro}  fill={`url(#g_hydro)`}  dot={false}/>
                  <Area type="monotone" dataKey="biogas" name="Biogas" stackId="1" stroke={COLORS.biogas} fill={`url(#g_biogas)`} dot={false}/>
                  <Line type="monotone" dataKey="demand" name="Demand" stroke={COLORS.demand} strokeWidth={2.5} dot={false}/>
                </ComposedChart>
              </ResponsiveContainer>
            </Card>

            {/* Tariff + Carbon intensity */}
            <Card>
              <Hdr title="Grid Tariff (₹/kWh)" badge="Time-of-use pricing"/>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={raw} margin={{top:5,right:10,left:-20,bottom:0}}>
                  <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border}/>
                  <XAxis dataKey="label" tick={{fill:COLORS.muted,fontSize:9}} interval={3}/>
                  <YAxis tick={{fill:COLORS.muted,fontSize:9}}/>
                  <Tooltip content={<Tip/>}/>
                  <Bar dataKey="tariff" name="Tariff ₹" fill="#fbbf24" opacity={0.8} radius={[2,2,0,0]}/>
                </BarChart>
              </ResponsiveContainer>
            </Card>

            <Card>
              <Hdr title="Grid Carbon Intensity" badge="kg CO₂/kWh"/>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={raw} margin={{top:5,right:10,left:-20,bottom:0}}>
                  <defs>
                    <linearGradient id="carbonGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f87171" stopOpacity={0.4}/>
                      <stop offset="95%" stopColor="#f87171" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border}/>
                  <XAxis dataKey="label" tick={{fill:COLORS.muted,fontSize:9}} interval={3}/>
                  <YAxis tick={{fill:COLORS.muted,fontSize:9}}/>
                  <Tooltip content={<Tip/>}/>
                  <Area type="monotone" dataKey="carbon_intensity" name="CO₂ kg/kWh" stroke="#f87171" strokeWidth={2} fill="url(#carbonGrad)" dot={false}/>
                </AreaChart>
              </ResponsiveContainer>
            </Card>

            {/* Radar */}
            {opt&&<Card style={{gridColumn:"1/-1"}}>
              <Hdr title="Performance Radar" badge="Before vs After"/>
              <ResponsiveContainer width="100%" height={300}>
                <RadarChart data={radarData}>
                  <PolarGrid stroke={COLORS.border}/>
                  <PolarAngleAxis dataKey="metric" tick={{fill:COLORS.muted,fontSize:11}}/>
                  <PolarRadiusAxis angle={30} tick={{fill:COLORS.muted,fontSize:9}}/>
                  <Radar name="Before" dataKey="before" stroke={COLORS.demand} fill={COLORS.demand} fillOpacity={0.25}/>
                  <Radar name="After"  dataKey="after"  stroke={COLORS.opt}    fill={COLORS.opt}    fillOpacity={0.35}/>
                  <Legend wrapperStyle={{fontSize:12}}/>
                </RadarChart>
              </ResponsiveContainer>
            </Card>}

          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════
            TAB: SOURCES
        ═══════════════════════════════════════════════════════════════ */}
        {tab==="sources"&&(
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:18}}>
            {[
              {key:"solar",  label:"☀️ Solar PV",     color:COLORS.solar,  desc:`Peak at midday. Season: ${sim.season}. Weather: ${sim.weather}. LCOE: ₹2.8/kWh`},
              {key:"wind",   label:"🌬️ Wind Power",   color:COLORS.wind,   desc:"Strongest pre-dawn & late night. Monsoon peaks highest. LCOE: ₹3.2/kWh"},
              {key:"hydro",  label:"💧 Hydro (RoR)",  color:COLORS.hydro,  desc:"Near-baseload. Monsoon season boosts output ~85%. LCOE: ₹4.5/kWh"},
              {key:"biogas", label:"🌿 Biogas",        color:COLORS.biogas, desc:"Fully dispatchable. Optimizer ramps up/down by demand. LCOE: ₹5.8/kWh"},
            ].map(({key,label,color,desc})=>(
              <Card key={key} glow={color}>
                <Hdr title={label}/>
                <ResponsiveContainer width="100%" height={180}>
                  <AreaChart data={raw} margin={{top:5,right:10,left:-20,bottom:0}}>
                    <defs>
                      <linearGradient id={`src_${key}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={color} stopOpacity={0.35}/>
                        <stop offset="95%" stopColor={color} stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border}/>
                    <XAxis dataKey="label" tick={{fill:COLORS.muted,fontSize:9}} interval={3}/>
                    <YAxis tick={{fill:COLORS.muted,fontSize:9}}/>
                    <Tooltip content={<Tip/>}/>
                    <Area type="monotone" dataKey={key} name={label} stroke={color} strokeWidth={2} fill={`url(#src_${key})`} dot={false}/>
                  </AreaChart>
                </ResponsiveContainer>
                <div style={{fontSize:11,color:COLORS.muted,marginTop:10,lineHeight:1.6}}>{desc}</div>
              </Card>
            ))}

            <Card style={{gridColumn:"1/-1"}}>
              <Hdr title="Grid Import (fallback)" badge="kWh drawn from grid"/>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={raw} margin={{top:5,right:10,left:-20,bottom:0}}>
                  <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border}/>
                  <XAxis dataKey="label" tick={{fill:COLORS.muted,fontSize:9}} interval={2}/>
                  <YAxis tick={{fill:COLORS.muted,fontSize:9}}/>
                  <Tooltip content={<Tip/>}/>
                  <Bar dataKey="grid_import" name="Grid Import kWh" fill={COLORS.grid} opacity={0.8} radius={[2,2,0,0]}/>
                </BarChart>
              </ResponsiveContainer>
              <div style={{marginTop:12,padding:"10px 14px",background:"#f8711320",border:"1px solid #f8711140",borderRadius:10,fontSize:12,color:"#fca5a5"}}>
                ⚠ Total grid draw today: <strong>{sim.grid_draw} kWh</strong>. The optimizer aims to eliminate or shift this to cheaper off-peak hours.
              </div>
            </Card>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════
            TAB: OPTIMIZATION
        ═══════════════════════════════════════════════════════════════ */}
        {tab==="optimization"&&(
          <div style={{display:"grid",gap:18}}>
            {!opt?(
              <Card style={{textAlign:"center",padding:60}}>
                <div style={{fontSize:44,marginBottom:14}}>🤖</div>
                <div style={{fontSize:17,color:COLORS.text,marginBottom:8}}>No optimization run yet</div>
                <div style={{fontSize:13,color:COLORS.muted,marginBottom:22}}>Select a strategy and click Run Optimize</div>
                <div style={{display:"flex",gap:12,justifyContent:"center",marginBottom:24,flexWrap:"wrap"}}>
                  {STRATEGIES.map(s=>(
                    <button key={s.id} onClick={()=>setStrategy(s.id)} style={{background:strategy===s.id?"#21262d":"transparent",border:`1px solid ${strategy===s.id?"#30363d":COLORS.border}`,borderRadius:10,padding:"10px 18px",color:strategy===s.id?COLORS.text:COLORS.muted,cursor:"pointer",fontSize:13}}>
                      <div style={{fontWeight:600}}>{s.label}</div>
                      <div style={{fontSize:10,marginTop:2}}>{s.desc}</div>
                    </button>
                  ))}
                </div>
                <button onClick={runOpt} style={{background:"linear-gradient(135deg,#22c55e,#16a34a)",border:"none",borderRadius:10,padding:"12px 28px",color:"#fff",fontWeight:600,fontSize:14,cursor:"pointer",boxShadow:"0 0 18px #22c55e33"}}>▶ Run AI Optimizer</button>
              </Card>
            ):(
              <>
                {/* Before / After side by side */}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:18}}>
                  <Card style={{border:`1px solid ${COLORS.grid}22`}}>
                    <Hdr title="Before Optimization" badge="Original load"/>
                    <ResponsiveContainer width="100%" height={220}>
                      <AreaChart data={raw} margin={{top:5,right:10,left:-20,bottom:0}}>
                        <defs>
                          <linearGradient id="bo_s" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={COLORS.solar} stopOpacity={0.3}/><stop offset="95%" stopColor={COLORS.solar} stopOpacity={0}/></linearGradient>
                          <linearGradient id="bo_d" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={COLORS.demand} stopOpacity={0.3}/><stop offset="95%" stopColor={COLORS.demand} stopOpacity={0}/></linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border}/>
                        <XAxis dataKey="label" tick={{fill:COLORS.muted,fontSize:9}} interval={3}/>
                        <YAxis tick={{fill:COLORS.muted,fontSize:9}}/>
                        <Tooltip content={<Tip/>}/>
                        <Area type="monotone" dataKey="total_renew" name="All Renewables" stroke={COLORS.solar} strokeWidth={2} fill="url(#bo_s)" dot={false}/>
                        <Area type="monotone" dataKey="demand" name="Demand" stroke={COLORS.demand} strokeWidth={2} fill="url(#bo_d)" dot={false}/>
                      </AreaChart>
                    </ResponsiveContainer>
                  </Card>

                  <Card style={{border:`1px solid ${COLORS.opt}22`}}>
                    <Hdr title={`After Optimization · ${opt.strategy}`} badge="Shifted load"/>
                    <ResponsiveContainer width="100%" height={220}>
                      <AreaChart data={opt.optimized_data} margin={{top:5,right:10,left:-20,bottom:0}}>
                        <defs>
                          <linearGradient id="ao_s" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={COLORS.solar} stopOpacity={0.3}/><stop offset="95%" stopColor={COLORS.solar} stopOpacity={0}/></linearGradient>
                          <linearGradient id="ao_d" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={COLORS.opt} stopOpacity={0.3}/><stop offset="95%" stopColor={COLORS.opt} stopOpacity={0}/></linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border}/>
                        <XAxis dataKey="label" tick={{fill:COLORS.muted,fontSize:9}} interval={3}/>
                        <YAxis tick={{fill:COLORS.muted,fontSize:9}}/>
                        <Tooltip content={<Tip/>}/>
                        <Area type="monotone" dataKey="total_renew" name="All Renewables" stroke={COLORS.solar} strokeWidth={2} fill="url(#ao_s)" dot={false}/>
                        <Area type="monotone" dataKey="optDemand" name="Optimized Demand" stroke={COLORS.opt} strokeWidth={2.5} fill="url(#ao_d)" dot={false}/>
                      </AreaChart>
                    </ResponsiveContainer>
                  </Card>
                </div>

                {/* Full comparison */}
                <Card>
                  <Hdr title="Full Comparison — All Sources + Before/After Demand" badge="24h"/>
                  <ResponsiveContainer width="100%" height={300}>
                    <ComposedChart data={compData} margin={{top:5,right:10,left:-20,bottom:0}}>
                      <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border}/>
                      <XAxis dataKey="label" tick={{fill:COLORS.muted,fontSize:9}} interval={2}/>
                      <YAxis tick={{fill:COLORS.muted,fontSize:9}}/>
                      <Tooltip content={<Tip/>}/>
                      <Legend wrapperStyle={{fontSize:11}}/>
                      <Line type="monotone" dataKey="solar"     name="☀ Solar"    stroke={COLORS.solar}  strokeWidth={1.5} dot={false} opacity={0.7}/>
                      <Line type="monotone" dataKey="wind"      name="🌬 Wind"    stroke={COLORS.wind}   strokeWidth={1.5} dot={false} opacity={0.7}/>
                      <Line type="monotone" dataKey="hydro"     name="💧 Hydro"   stroke={COLORS.hydro}  strokeWidth={1.5} dot={false} opacity={0.7}/>
                      <Line type="monotone" dataKey="demand"    name="⚡ Original" stroke={COLORS.demand} strokeWidth={2}   strokeDasharray="6 3" dot={false}/>
                      <Line type="monotone" dataKey="optDemand" name="✓ Optimized" stroke={COLORS.opt}   strokeWidth={2.5} dot={false}/>
                    </ComposedChart>
                  </ResponsiveContainer>
                </Card>

                {/* Metrics grid */}
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:12}}>
                  {[
                    {l:"Shifted",v:`${opt.shifted_kwh} kWh`,c:"#4ade80"},
                    {l:"Peak ↓",  v:`${opt.peak_reduction}%`,c:"#a78bfa"},
                    {l:"Cost ↓",  v:`₹${opt.money_saved}`,c:"#fbbf24"},
                    {l:"Cost %",  v:`${opt.money_pct}%`,c:"#fbbf24"},
                    {l:"CO₂ ↓",  v:`${opt.carbon_saved}kg`,c:"#34d399"},
                    {l:"CO₂ %",  v:`${opt.carbon_pct}%`,c:"#34d399"},
                    {l:"Renew %", v:`${opt.renewable_pct}%`,c:COLORS.solar},
                    {l:"Grid OK", v:`${opt.grid_stress_score}%`,c:COLORS.wind},
                    {l:"LCOE ↓",  v:`₹${opt.lcoe_before}→₹${opt.lcoe_after}`,c:COLORS.hydro},
                  ].map(s=>(
                    <div key={s.l} style={{background:COLORS.bg,border:`1px solid ${s.c}33`,borderRadius:12,padding:"12px 14px",textAlign:"center"}}>
                      <div style={{fontSize:18,fontWeight:700,color:s.c,fontFamily:"monospace"}}>{s.v}</div>
                      <div style={{fontSize:10,color:COLORS.muted,marginTop:2}}>{s.l}</div>
                    </div>
                  ))}
                </div>

                <div style={{padding:"14px 18px",background:"#22c55e18",border:"1px solid #22c55e44",borderRadius:12,fontSize:13,color:"#86efac",lineHeight:1.7}}>
                  🤖 <strong>Strategy: {opt.strategy}</strong> — Shifted {opt.shifted_kwh} kWh from peak hours to renewable-rich windows. Biogas was dispatched dynamically — ramped up when solar/wind were low, throttled when renewables were abundant. {online&&sim.id&&<span style={{color:"#4ade80"}}>✓ Saved to DB</span>}
                </div>
              </>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════
            TAB: APPLIANCES
        ═══════════════════════════════════════════════════════════════ */}
        {tab==="appliances"&&(
          <div style={{display:"grid",gap:18}}>
            {!opt?(
              <Card style={{textAlign:"center",padding:50}}>
                <div style={{fontSize:36,marginBottom:12}}>🔌</div>
                <div style={{color:COLORS.muted,fontSize:13,marginBottom:18}}>Run the optimizer to see the appliance schedule</div>
                <button onClick={runOpt} style={{background:"linear-gradient(135deg,#22c55e,#16a34a)",border:"none",borderRadius:10,padding:"10px 22px",color:"#fff",fontWeight:600,fontSize:13,cursor:"pointer"}}>▶ Run AI Optimizer</button>
              </Card>
            ):(
              <>
                <Card>
                  <Hdr title="Appliance Scheduling Result" badge={`Strategy: ${opt.strategy}`}/>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(210px,1fr))",gap:12}}>
                    {(opt.appliance_details||[]).map((app)=>(
                      <div key={app.app_id} style={{background:COLORS.bg,border:`1px solid ${COLORS.border}`,borderRadius:12,padding:"14px 16px"}}>
                        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                          <span style={{fontSize:22}}>{app.app_icon}</span>
                          <div>
                            <div style={{fontSize:12,fontWeight:600}}>{app.app_name}</div>
                            <div style={{fontSize:10,color:COLORS.muted}}>{app.power_kw}kW · {app.duration_h}h · {app.energy_kwh}kWh</div>
                          </div>
                        </div>
                        <div style={{display:"flex",justifyContent:"space-between",fontSize:11,marginBottom:6}}>
                          <span style={{color:COLORS.grid}}>Was: {String(app.original_hour).padStart(2,"0")}:00</span>
                          <span style={{color:COLORS.opt}}>Now: {String(app.optimized_hour).padStart(2,"0")}:00</span>
                        </div>
                        <div style={{height:4,background:COLORS.border,borderRadius:2,marginBottom:6}}>
                          <div style={{height:"100%",borderRadius:2,background:`linear-gradient(90deg,${COLORS.grid},${COLORS.opt})`}}/>
                        </div>
                        <div style={{display:"flex",justifyContent:"space-between",fontSize:10}}>
                          <span style={{color:"#fbbf24"}}>Saves ₹{app.saving_inr}</span>
                          <span style={{color:COLORS[app.primary_source]||"#8b949e"}}>⚡ {app.primary_source}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>

                {/* Appliance savings bar chart */}
                <Card>
                  <Hdr title="Savings by Appliance" badge="₹ saved per unit"/>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={opt.appliance_details||[]} margin={{top:5,right:10,left:-20,bottom:30}}>
                      <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border}/>
                      <XAxis dataKey="app_name" tick={{fill:COLORS.muted,fontSize:9}} angle={-25} textAnchor="end"/>
                      <YAxis tick={{fill:COLORS.muted,fontSize:9}}/>
                      <Tooltip content={<Tip/>}/>
                      <Bar dataKey="saving_inr" name="Saving ₹" fill="#fbbf24" opacity={0.85} radius={[3,3,0,0]}/>
                    </BarChart>
                  </ResponsiveContainer>
                </Card>
              </>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════
            TAB: LCOE
        ═══════════════════════════════════════════════════════════════ */}
        {tab==="lcoe"&&(
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:18}}>

            <Card style={{gridColumn:"1/-1"}}>
              <Hdr title="Levelized Cost of Energy (LCOE) Comparison" badge="₹/kWh"/>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={lcoeData} margin={{top:5,right:10,left:-10,bottom:0}}>
                  <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border}/>
                  <XAxis dataKey="source" tick={{fill:COLORS.muted,fontSize:11}}/>
                  <YAxis tick={{fill:COLORS.muted,fontSize:10}} label={{value:"₹/kWh",angle:-90,position:"insideLeft",fill:COLORS.muted,fontSize:10}}/>
                  <Tooltip content={<Tip/>}/>
                  <Bar dataKey="lcoe" name="LCOE ₹/kWh" radius={[4,4,0,0]}>
                    {lcoeData.map((entry,i)=>(
                      <rect key={i} fill={entry.color}/>
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Card>

            <Card>
              <Hdr title="Carbon Intensity by Source" badge="kg CO₂/kWh"/>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={lcoeData} margin={{top:5,right:10,left:-10,bottom:0}}>
                  <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border}/>
                  <XAxis dataKey="source" tick={{fill:COLORS.muted,fontSize:9}} angle={-20} textAnchor="end" height={45}/>
                  <YAxis tick={{fill:COLORS.muted,fontSize:9}}/>
                  <Tooltip content={<Tip/>}/>
                  <Bar dataKey="carbon" name="CO₂ kg/kWh" fill="#f87171" opacity={0.8} radius={[3,3,0,0]}/>
                </BarChart>
              </ResponsiveContainer>
            </Card>

            <Card>
              <Hdr title="LCOE Source Cards"/>
              <div style={{display:"grid",gap:10}}>
                {lcoeData.map(s=>(
                  <div key={s.source} style={{background:COLORS.bg,border:`1px solid ${s.color}33`,borderRadius:10,padding:"12px 14px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div>
                      <div style={{fontSize:13,fontWeight:600,color:s.color}}>{s.source}</div>
                      <div style={{fontSize:10,color:COLORS.muted}}>Carbon: {s.carbon} kg CO₂/kWh</div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontSize:22,fontWeight:700,color:s.color,fontFamily:"monospace"}}>₹{s.lcoe}</div>
                      <div style={{fontSize:10,color:COLORS.muted}}>per kWh</div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            {/* Blended LCOE */}
            <Card>
              <Hdr title="Blended LCOE This Simulation"/>
              <div style={{display:"flex",flexDirection:"column",gap:14,marginTop:8}}>
                {[
                  {label:"Unoptimized (grid-heavy)",value:`₹${sim.raw_cost?(sim.raw_cost/Math.max(1,sim.grid_draw)).toFixed(1):8.5}`,color:COLORS.grid},
                  {label:"WattFlow blended LCOE",   value:`₹${sim.lcoe_blended||3.9}`,color:COLORS.opt},
                  {label:"After optimization",      value:opt?`₹${opt.lcoe_after}`:"—",color:"#4ade80"},
                ].map(r=>(
                  <div key={r.label} style={{background:COLORS.bg,border:`1px solid ${r.color}33`,borderRadius:10,padding:"12px 16px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <span style={{fontSize:12,color:COLORS.muted}}>{r.label}</span>
                    <span style={{fontSize:20,fontWeight:700,color:r.color,fontFamily:"monospace"}}>{r.value}/kWh</span>
                  </div>
                ))}
              </div>
              <div style={{marginTop:16,padding:"10px 14px",background:"#4ade8018",border:"1px solid #4ade8044",borderRadius:10,fontSize:12,color:"#86efac"}}>
                💡 WattFlow's multi-source mix reduces your effective cost per kWh significantly below grid-only pricing.
              </div>
            </Card>

          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════
            TAB: VIRTUAL STORAGE
        ═══════════════════════════════════════════════════════════════ */}
        {tab==="storage"&&(
          <div style={{display:"grid",gap:18}}>

            <Card style={{background:"linear-gradient(135deg,#0f2a1f 0%,#0d1117 100%)",border:"1px solid #22c55e33"}}>
              <div style={{display:"flex",gap:20,alignItems:"flex-start"}}>
                <div style={{width:52,height:52,borderRadius:14,background:"linear-gradient(135deg,#22c55e,#16a34a)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:26,flexShrink:0,boxShadow:"0 0 20px #22c55e44"}}>🔋</div>
                <div>
                  <h2 style={{margin:"0 0 8px",fontSize:18,fontWeight:700}}>Virtual Energy Storage — Multi-Resource Edition</h2>
                  <p style={{margin:0,fontSize:13,color:"#86efac",lineHeight:1.8}}>
                    Physical batteries store <em>electrons</em>. WattFlow stores <em>time</em>. By coordinating solar, wind, hydro, and biogas dispatch alongside intelligent demand shifting, the system eliminates the need for a battery entirely. Each source plays a different role: solar + wind provide bulk energy, hydro smooths variability, biogas acts as a dispatchable backup — and demand scheduling is the virtual battery that ties it all together.
                  </p>
                </div>
              </div>
            </Card>

            {/* Source roles */}
            <Card>
              <Hdr title="How Each Resource Contributes to Virtual Storage"/>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:14}}>
                {[
                  {icon:"☀️",name:"Solar PV",color:COLORS.solar,role:"Bulk daytime generation",storage:"Absorbed by shifted loads: EV, AC, water heater"},
                  {icon:"🌬️",name:"Wind",    color:COLORS.wind, role:"Nocturnal & seasonal fill",storage:"Covers gaps when solar unavailable"},
                  {icon:"💧",name:"Hydro",   color:COLORS.hydro,role:"Baseload stabiliser",storage:"Near-flat supply prevents deep deficits"},
                  {icon:"🌿",name:"Biogas",  color:COLORS.biogas,role:"Dispatchable peaker",storage:"Ramps on/off like a virtual gas turbine"},
                  {icon:"⏰",name:"Demand Shifting",color:COLORS.opt,role:"The virtual battery",storage:"Moves load to match any surplus — zero hardware"},
                ].map(r=>(
                  <div key={r.name} style={{background:COLORS.bg,border:`1px solid ${r.color}33`,borderRadius:12,padding:"16px"}}>
                    <div style={{fontSize:26,marginBottom:8}}>{r.icon}</div>
                    <div style={{fontSize:13,fontWeight:600,color:r.color,marginBottom:4}}>{r.name}</div>
                    <div style={{fontSize:11,color:COLORS.muted,lineHeight:1.6}}><strong>Role:</strong> {r.role}</div>
                    <div style={{fontSize:11,color:COLORS.muted,lineHeight:1.6}}><strong>Storage effect:</strong> {r.storage}</div>
                  </div>
                ))}
              </div>
            </Card>

            {/* Surplus/Deficit chart */}
            {opt&&<Card>
              <Hdr title="Hourly Surplus & Deficit After Optimization" badge="Surplus = virtual charge"/>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={compData} margin={{top:5,right:10,left:-20,bottom:0}}>
                  <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border}/>
                  <XAxis dataKey="label" tick={{fill:COLORS.muted,fontSize:9}} interval={2}/>
                  <YAxis tick={{fill:COLORS.muted,fontSize:9}}/>
                  <Tooltip content={<Tip/>}/>
                  <Legend wrapperStyle={{fontSize:11}}/>
                  <Bar dataKey="surplus"    name="☀ Surplus (virtual stored)" fill={COLORS.solar}  opacity={0.85} radius={[3,3,0,0]}/>
                  <Bar dataKey="gridImport" name="⚡ Grid Import (fallback)"  fill={COLORS.grid}  opacity={0.7}  radius={[3,3,0,0]}/>
                </BarChart>
              </ResponsiveContainer>
              <div style={{marginTop:14,padding:"12px 14px",background:"#4ade8018",border:"1px solid #4ade8044",borderRadius:10,fontSize:13,color:"#86efac"}}>
                🔋 <strong>Result:</strong> {opt.shifted_kwh} kWh shifted = equivalent to a {opt.shifted_kwh} kWh battery, but achieved through software scheduling across 5 resource types. Renewable fraction reached <strong>{opt.renewable_pct}%</strong>.
              </div>
            </Card>}

            {!opt&&<Card style={{textAlign:"center",padding:40}}>
              <div style={{fontSize:32,marginBottom:10}}>⚡</div>
              <div style={{color:COLORS.muted,fontSize:13,marginBottom:16}}>Run the optimizer to see virtual storage breakdown</div>
              <button onClick={runOpt} style={{background:"linear-gradient(135deg,#22c55e,#16a34a)",border:"none",borderRadius:10,padding:"10px 22px",color:"#fff",fontWeight:600,fontSize:13,cursor:"pointer"}}>▶ Run AI Optimizer</button>
            </Card>}

          </div>
        )}

      </div>

      {/* Footer */}
      <div style={{marginTop:40,padding:"16px 28px",borderTop:`1px solid ${COLORS.border}`,display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:11,color:COLORS.muted,flexWrap:"wrap",gap:8}}>
        <span>⚡ WattFlow v3 — Multi-Resource Virtual Energy Storage</span>
        <span style={{color:online?"#4ade80":COLORS.muted}}>{online?"🟢 FastAPI + SQLite backend":"⚪ Local mode"}</span>
        <span style={{color:"#4ade80"}}>🌿 Solar · Wind · Hydro · Biogas · Smart Dispatch</span>
      </div>

      <style>{`
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        *{box-sizing:border-box;}
        select{appearance:none;}
        ::-webkit-scrollbar{width:5px;height:5px;}
        ::-webkit-scrollbar-track{background:#0d1117;}
        ::-webkit-scrollbar-thumb{background:#30363d;border-radius:3px;}
      `}</style>
    </div>
  );
}
function App() {
  return (
    <div>
      <Login />
    </div>
  );
}
