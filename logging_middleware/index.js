const axios = require("axios");

const LOG_URL = "http://20.207.122.201/evaluation-service/logs";

let authToken = null;

function setToken(token) {
  authToken = token;
}

async function Log(stack, level, pkg, message) {
  if (!authToken) {
    process.stderr.write(`[log-skip] ${level}: ${message}\n`);
    return;
  }

  try {
    const res = await axios.post(
      LOG_URL,
      { stack, level, package: pkg, message },
      { headers: { Authorization: `Bearer ${authToken}` } }
    );
    return res.data;
  } catch (err) {
    const status = err.response ? err.response.status : "unknown";
    process.stderr.write(`log failed [${status}]: ${message}\n`);
  }
}

function expressMiddleware(req, res, next) {
  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;
    const lvl = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
    Log("backend", lvl, "middleware", `${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`);
  });

  next();
}

module.exports = { Log, setToken, expressMiddleware };
