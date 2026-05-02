const express = require("express");
const axios = require("axios");
const { Log, setToken, expressMiddleware } = require("../logging_middleware");

const app = express();
app.use(express.json());
app.use(expressMiddleware);

const AUTH_URL = "http://20.207.122.201/evaluation-service/auth";
const DEPOTS_URL = "http://20.207.122.201/evaluation-service/depots";
const VEHICLES_URL = "http://20.207.122.201/evaluation-service/vehicles";

const credentials = {
  email: "pankaj_yadav@srmap.edu.in",
  name: "pankaj yadav",
  rollNo: "ap23110011537",
  accessCode: "QkbpxH",
  clientID: "3b197b6e-208f-4fe0-91b6-956b9a4c5aa0",
  clientSecret: "DTebeTjnkrggywKQ"
};

let token = null;

async function getToken() {
  Log("backend", "info", "auth", "requesting new auth token");
  const res = await axios.post(AUTH_URL, credentials);
  token = res.data.access_token;
  setToken(token);
  Log("backend", "info", "auth", "auth token obtained successfully");
  return token;
}

function authHeaders() {
  return { Authorization: `Bearer ${token}` };
}

function knapsack(items, capacity) {
  const n = items.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(capacity + 1).fill(0));

  for (let i = 1; i <= n; i++) {
    for (let w = 0; w <= capacity; w++) {
      if (items[i - 1].Duration <= w) {
        dp[i][w] = Math.max(
          dp[i - 1][w],
          dp[i - 1][w - items[i - 1].Duration] + items[i - 1].Impact
        );
      } else {
        dp[i][w] = dp[i - 1][w];
      }
    }
  }

  let w = capacity;
  let selected = [];
  for (let i = n; i > 0; i--) {
    if (dp[i][w] !== dp[i - 1][w]) {
      selected.push(items[i - 1]);
      w -= items[i - 1].Duration;
    }
  }

  return { maxImpact: dp[n][capacity], selectedTasks: selected.reverse() };
}

app.get("/schedule", async (req, res) => {
  try {
    Log("backend", "info", "handler", "received request for /schedule");

    const [depotsRes, vehiclesRes] = await Promise.all([
      axios.get(DEPOTS_URL, { headers: authHeaders() }),
      axios.get(VEHICLES_URL, { headers: authHeaders() })
    ]);

    const depots = depotsRes.data.depots;
    const vehicles = vehiclesRes.data.vehicles;

    Log("backend", "info", "service", `fetched ${depots.length} depots and ${vehicles.length} vehicles`);

    const results = depots.map((depot) => {
      Log("backend", "debug", "service", `solving knapsack for depot ${depot.ID} with ${depot.MechanicHours} hours`);
      const solution = knapsack(vehicles, depot.MechanicHours);
      return {
        depotId: depot.ID,
        mechanicHours: depot.MechanicHours,
        maxImpact: solution.maxImpact,
        totalDuration: solution.selectedTasks.reduce((sum, t) => sum + t.Duration, 0),
        tasksSelected: solution.selectedTasks.length,
        tasks: solution.selectedTasks
      };
    });

    Log("backend", "info", "handler", "schedule computed for all depots");
    res.json({ results });
  } catch (err) {
    Log("backend", "error", "handler", `schedule failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

async function start() {
  try {
    await getToken();
    app.listen(3000, () => {
      Log("backend", "info", "route", "vehicle scheduler running on port 3000");
    });
  } catch (err) {
    Log("backend", "fatal", "config", `startup failed: ${err.message}`);
    process.exit(1);
  }
}

start();
