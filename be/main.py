from fastapi import FastAPI
from pydantic import BaseModel
import random
from datetime import datetime
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# ✅ STEP 1: CREATE APP FIRST
app = FastAPI()

# ✅ STEP 2: ADD MIDDLEWARE AFTER APP
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ✅ STEP 3: API ROUTE
@app.post("/simulate")
def simulate(data: dict):
    solar = data.get("solar", 0)
    demand = data.get("demand", 0)

    saved = min(solar, demand) * 0.2

    return {
        "saved": saved,
        "optimized": [
            {"hour": i, "value": demand - saved if 18 <= i <= 22 else demand}
            for i in range(24)
        ]
    }

app = FastAPI()

history = []

class EnergyData(BaseModel):
    solar: float
    demand: float

@app.get("/")
def home():
    return {"message": "FastAPI running 🚀"}

@app.post("/simulate")
def simulate(data: EnergyData):
    result = {
        "solar": data.solar,
        "demand": data.demand,
        "saved": random.uniform(10, 30),
        "timestamp": datetime.now()
    }

    history.append(result)

    return result

@app.get("/history")
def get_history():
    return history