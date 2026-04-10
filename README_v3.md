# ⚡ WattFlow v3 — Multi-Resource Virtual Energy Storage System

Full-stack hackathon application: React + FastAPI + SQLite

---

## 🗂 Project Structure

```
wattflow/
├── backend/
│   ├── main.py            ← FastAPI app + SQLite (all logic)
│   └── requirements.txt
└── frontend/
    └── src/
        └── App.jsx        ← Complete React app (single file)
```

---

## 🚀 Quick Start

### Backend
```bash
cd backend
python -m venv venv && source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
# Docs: http://localhost:8000/docs
```

### Frontend
```bash
npx create-react-app frontend
cd frontend
npm install recharts
# Copy App.jsx → src/App.js (replace contents)
npm start
# App: http://localhost:3000
```

---

## 🔌 Resources Simulated

| Source  | Type          | Profile                         | LCOE ₹/kWh |
|---------|---------------|---------------------------------|-------------|
| Solar   | Variable      | Gaussian peak ~12:00-13:00      | 2.8         |
| Wind    | Variable      | Pre-dawn/nocturnal stronger     | 3.2         |
| Hydro   | Baseload      | Near-flat, season-adjusted      | 4.5         |
| Biogas  | Dispatchable  | Optimizer ramps up/down freely  | 5.8         |
| Grid    | Fallback      | Time-of-use tariff ₹7–22/kWh   | Tariff      |

---

## 🤖 Optimization Strategies

| Strategy  | Logic                              |
|-----------|------------------------------------|
| Balanced  | Cost + carbon + peak (default)     |
| Green     | Maximise renewable % only          |
| Economic  | Minimise ₹ cost only               |

---

## 📊 API Endpoints

| Method | Path                              | Description                        |
|--------|-----------------------------------|------------------------------------|
| GET    | `/`                               | Health check                       |
| POST   | `/api/simulate?season=&weather=`  | Generate + save simulation         |
| POST   | `/api/optimize/{id}?strategy=`    | Run optimizer, save result         |
| GET    | `/api/simulation/{id}`            | Fetch full simulation + result     |
| GET    | `/api/simulations`                | List history                       |
| DELETE | `/api/simulation/{id}`            | Delete simulation                  |
| GET    | `/api/stats`                      | Aggregated lifetime stats          |
| GET    | `/api/lcoe`                       | LCOE data for all sources          |

---

## 🗄 Database Schema (SQLite — wattflow.db)

```
simulations         id, created_at, label, season, weather_profile,
                    total_solar, total_wind, total_hydro, total_biogas,
                    total_demand, total_renew, grid_draw, renewable_pct,
                    avg_tariff, total_cost_raw, lcoe_blended

hourly_readings     simulation_id, hour, solar, wind, hydro, biogas,
                    demand, tariff, carbon_intensity, grid_import, total_renew

optimization_results simulation_id, strategy, shifted_kwh, peak_reduction,
                     money_saved, money_pct, carbon_saved, carbon_pct,
                     renewable_pct, grid_stress_score, lcoe_before, lcoe_after,
                     schedule_json

optimized_hourly    result_id, hour, solar, wind, hydro, biogas, opt_biogas,
                    opt_demand, grid_import, surplus, source_mix_json

appliance_schedules result_id, app_id, app_name, app_icon, original_hour,
                    optimized_hour, power_kw, duration_h, energy_kwh,
                    saving_inr, saving_co2, primary_source
```

---

## 🎤 Demo Flow (Hackathon Pitch)

1. **Season/Weather selector** — show how monsoon vs summer changes solar
2. **Sources tab** — 4 different generation profiles, all stacked
3. **Run Optimizer** — pick "Green" strategy for max renewable impact
4. **Optimization tab** — before/after + 9-metric results grid
5. **Appliances tab** — show each appliance shifted to cheapest/greenest hour
6. **LCOE tab** — compare ₹2.8 solar vs ₹18 diesel
7. **Virtual Storage tab** — explain "no battery needed" with 5-source diagram

> **Key message:** "WattFlow is a virtual power plant — it coordinates 4 clean sources
> + smart scheduling to deliver the same outcome as a large battery farm, at near-zero
> hardware cost."
