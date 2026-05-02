const express = require("express");
const axios = require("axios");
const { Log, setToken, expressMiddleware } = require("../logging_middleware");

const app = express();
app.use(express.json());
app.use(expressMiddleware);

const AUTH_URL = "http://20.207.122.201/evaluation-service/auth";
const NOTIFICATIONS_URL = "http://20.207.122.201/evaluation-service/notifications";

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
  Log("backend", "info", "auth", "requesting auth token for notification service");
  const res = await axios.post(AUTH_URL, credentials);
  token = res.data.access_token;
  setToken(token);
  Log("backend", "info", "auth", "token acquired");
  return token;
}

function authHeaders() {
  return { Authorization: `Bearer ${token}` };
}

const TYPE_WEIGHT = {
  Placement: 3,
  Result: 2,
  Event: 1
};

function computeScore(notification) {
  const weight = TYPE_WEIGHT[notification.Type] || 0;
  const recency = new Date(notification.Timestamp).getTime();
  return weight * 1e13 + recency;
}

class MinHeap {
  constructor(k) {
    this.k = k;
    this.heap = [];
  }

  insert(item) {
    if (this.heap.length < this.k) {
      this.heap.push(item);
      this._bubbleUp(this.heap.length - 1);
    } else if (item.score > this.heap[0].score) {
      this.heap[0] = item;
      this._sinkDown(0);
    }
  }

  getTop() {
    return this.heap.sort((a, b) => b.score - a.score);
  }

  _bubbleUp(i) {
    while (i > 0) {
      let parent = Math.floor((i - 1) / 2);
      if (this.heap[parent].score > this.heap[i].score) {
        [this.heap[parent], this.heap[i]] = [this.heap[i], this.heap[parent]];
        i = parent;
      } else break;
    }
  }

  _sinkDown(i) {
    const n = this.heap.length;
    while (true) {
      let smallest = i;
      let left = 2 * i + 1;
      let right = 2 * i + 2;
      if (left < n && this.heap[left].score < this.heap[smallest].score) smallest = left;
      if (right < n && this.heap[right].score < this.heap[smallest].score) smallest = right;
      if (smallest !== i) {
        [this.heap[smallest], this.heap[i]] = [this.heap[i], this.heap[smallest]];
        i = smallest;
      } else break;
    }
  }
}

app.get("/notifications/top", async (req, res) => {
  try {
    const n = parseInt(req.query.n) || 10;
    Log("backend", "info", "handler", `fetching top ${n} priority notifications`);

    const response = await axios.get(NOTIFICATIONS_URL, { headers: authHeaders() });
    const notifications = response.data.notifications;
    Log("backend", "info", "service", `received ${notifications.length} notifications from API`);

    const heap = new MinHeap(n);
    for (const notif of notifications) {
      const score = computeScore(notif);
      heap.insert({ ...notif, score });
    }

    const top = heap.getTop().map(({ score, ...rest }) => rest);
    Log("backend", "info", "handler", `returning top ${top.length} notifications`);
    res.json({ topNotifications: top, count: top.length });
  } catch (err) {
    Log("backend", "error", "handler", `failed to get top notifications: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

async function start() {
  try {
    await getToken();
    app.listen(3001, () => {
      Log("backend", "info", "route", "notification service running on port 3001");
    });
  } catch (err) {
    Log("backend", "fatal", "config", `notification service startup failed: ${err.message}`);
    process.exit(1);
  }
}

start();
