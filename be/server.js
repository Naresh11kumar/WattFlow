console.log("STARTING SERVER...");

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const app = express();

app.use(cors());
app.use(express.json());

// ✅ Connect to MongoDB
mongoose.connect("mongodb://127.0.0.1:27017/wattflow")
  .then(() => console.log("MongoDB Connected ✅"))
  .catch(err => console.log(err));

// ✅ Schema
const SimulationSchema = new mongoose.Schema({
  solar: Number,
  demand: Number,
  saved: Number,
  timestamp: Date,
});

// ✅ Model
const Simulation = mongoose.model("Simulation", SimulationSchema);

// ✅ Routes
app.get("/", (req, res) => {
  res.send("Backend is running 🚀");
});

// 🔥 Save to MongoDB
app.post("/simulate", async (req, res) => {
  const data = req.body;

  const result = new Simulation({
    solar: data.solar,
    demand: data.demand,
    saved: Math.random() * 30,
    timestamp: new Date(),
  });

  await result.save();

  console.log("Saved to DB:", result); // 👈 PASTE HERE

  res.json(result);
});
// 🔥 Get from MongoDB
app.get("/history", async (req, res) => {
  const data = await Simulation.find().sort({ timestamp: -1 });

  console.log("History data:", data); // 👈 PASTE HERE

  res.json(data);
});
// ✅ Start server
app.listen(5174, () => {
  console.log("Server running on http://localhost:5174");
});
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const UserSchema = new mongoose.Schema({
  email: String,
  password: String,
});

const User = mongoose.model("User", UserSchema);
app.post("/signup", async (req, res) => {
  const { email, password } = req.body;

  const hashedPassword = await bcrypt.hash(password, 10);

  const user = new User({
    email,
    password: hashedPassword,
  });

  await user.save();

  res.json({ message: "User created ✅" });
});
app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email });

  if (!user) {
    return res.status(400).json({ message: "User not found ❌" });
  }

  const isMatch = await bcrypt.compare(password, user.password);

  if (!isMatch) {
    return res.status(400).json({ message: "Wrong password ❌" });
  }

  const token = jwt.sign({ id: user._id }, "secretkey");

  res.json({ message: "Login success ✅", token });
});