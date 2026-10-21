const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');
const { exec } = require('child_process');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const MONGO_URI = 'mongodb://admin:AdminPass123@localhost:27017,localhost:27018,localhost:27019/admin?replicaSet=rs0&retryWrites=true&w=majority&directConnection=false&serverSelectionTimeoutMS=5000';

let mongoClient = null;
let trafficActive = false;
let trafficInterval = null;
let trafficLogs = [];
let totalWrites = 0;
let failedWrites = 0;
let electionBenchmark = {
  inProgress: false,
  killedNode: null,
  startTime: null,
  durationSec: null,
  newPrimary: null
};

function runExec(cmd) {
  return new Promise((resolve) => {
    exec(cmd, { timeout: 15000 }, (error, stdout, stderr) => {
      resolve({ error, stdout: stdout ? stdout.trim() : '', stderr: stderr ? stderr.trim() : '' });
    });
  });
}

async function getDbClient() {
  if (mongoClient && mongoClient.topology && mongoClient.topology.isConnected()) {
    return mongoClient;
  }
  try {
    mongoClient = new MongoClient(MONGO_URI, {
      maxPoolSize: 10,
      minPoolSize: 2,
      connectTimeoutMS: 5000
    });
    await mongoClient.connect();
    return mongoClient;
  } catch (err) {
    return null;
  }
}

async function getContainerStates() {
  const nodes = ['mongo1', 'mongo2', 'mongo3'];
  const results = {};
  for (const node of nodes) {
    const { stdout } = await runExec(`docker inspect ${node} --format "{{.State.Status}}|{{.State.Running}}|{{.State.StartedAt}}"`);
    if (stdout && stdout.includes('|')) {
      const [status, running, startedAt] = stdout.split('|');
      results[node] = {
        name: node,
        status: status || 'down',
        running: running === 'true',
        startedAt: startedAt || null
      };
    } else {
      results[node] = {
        name: node,
        status: 'down',
        running: false,
        startedAt: null
      };
    }
  }
  return results;
}

app.get('/api/cluster/status', async (req, res) => {
  const containers = await getContainerStates();
  let replicaStatus = null;
  let primaryNode = null;
  let clientConnected = false;

  try {
    const client = await getDbClient();
    if (client) {
      const adminDb = client.db('admin');
      replicaStatus = await adminDb.command({ replSetGetStatus: 1 });
      clientConnected = true;

      if (replicaStatus && replicaStatus.members) {
        const p = replicaStatus.members.find(m => m.stateStr === 'PRIMARY');
        if (p) primaryNode = p.name.split(':')[0];
      }
    }
  } catch (err) {
    clientConnected = false;
  }

  if (!replicaStatus) {
    for (const node of ['mongo1', 'mongo2', 'mongo3']) {
      if (containers[node] && containers[node].running) {
        const { stdout } = await runExec(
          `docker exec ${node} mongosh -u admin -p AdminPass123 --authenticationDatabase admin --quiet --eval "JSON.stringify(rs.status())"`
        );
        try {
          replicaStatus = JSON.parse(stdout);
          if (replicaStatus && replicaStatus.members) {
            const p = replicaStatus.members.find(m => m.stateStr === 'PRIMARY');
            if (p) primaryNode = p.name.split(':')[0];
            break;
          }
        } catch (e) {}
      }
    }
  }

  if (electionBenchmark.inProgress && primaryNode && primaryNode !== electionBenchmark.killedNode) {
    electionBenchmark.inProgress = false;
    electionBenchmark.newPrimary = primaryNode;
    electionBenchmark.durationSec = ((Date.now() - electionBenchmark.startTime) / 1000).toFixed(2);
  }

  res.json({
    ok: true,
    containers,
    primaryNode,
    clientConnected,
    electionBenchmark,
    replicaSet: replicaStatus ? {
      set: replicaStatus.set,
      date: replicaStatus.date,
      myState: replicaStatus.myState,
      members: (replicaStatus.members || []).map(m => ({
        id: m._id,
        name: m.name,
        stateStr: m.stateStr,
        health: m.health,
        uptime: m.uptime,
        optimeDate: m.optimeDate,
        syncSourceHost: m.syncSourceHost || null
      }))
    } : null
  });
});

app.post('/api/cluster/stop-node', async (req, res) => {
  const { node } = req.body;
  if (!['mongo1', 'mongo2', 'mongo3'].includes(node)) {
    return res.status(400).json({ error: 'Invalid node name' });
  }

  electionBenchmark = {
    inProgress: true,
    killedNode: node,
    startTime: Date.now(),
    durationSec: null,
    newPrimary: null
  };

  const { error, stdout, stderr } = await runExec(`docker stop ${node}`);
  res.json({
    ok: !error,
    node,
    action: 'stop',
    output: stdout || stderr,
    benchmarkStarted: true
  });
});

app.post('/api/cluster/start-node', async (req, res) => {
  const { node } = req.body;
  if (!['mongo1', 'mongo2', 'mongo3'].includes(node)) {
    return res.status(400).json({ error: 'Invalid node name' });
  }

  const { error, stdout, stderr } = await runExec(`docker start ${node}`);
  res.json({
    ok: !error,
    node,
    action: 'start',
    output: stdout || stderr
  });
});

function writeSingleTransaction() {
  return new Promise(async (resolve) => {
    const startMs = Date.now();
    try {
      const client = await getDbClient();
      if (!client) throw new Error('Connecting to cluster');

      const db = client.db('demoDB');
      const orderId = 'ORD-' + Math.floor(100000 + Math.random() * 900000);
      const amount = (Math.random() * 150 + 10).toFixed(2);
      const services = ['Block Storage Volume', 'Snapshot Storage', 'Virtual Network Subnet', 'Replica Member'];
      const service = services[Math.floor(Math.random() * services.length)];

      const doc = {
        orderId,
        service,
        amount: parseFloat(amount),
        currency: 'USD',
        createdAt: new Date(),
        clientHost: 'ClusterClient',
        status: 'SUCCESS'
      };

      await db.collection('live_transactions').insertOne(doc, { writeConcern: { w: 'majority', wtimeout: 5000 } });
      const latency = Date.now() - startMs;
      totalWrites++;

      const logItem = {
        id: orderId,
        service,
        amount: '$' + amount,
        latencyMs: latency,
        time: new Date().toLocaleTimeString(),
        status: 'COMMITTED (w:majority)',
        ok: true
      };

      trafficLogs.unshift(logItem);
      if (trafficLogs.length > 50) trafficLogs.pop();
      resolve(logItem);
    } catch (err) {
      failedWrites++;
      const latency = Date.now() - startMs;
      const logItem = {
        id: 'RETRYING',
        service: 'Failover Buffer',
        amount: '--',
        latencyMs: latency,
        time: new Date().toLocaleTimeString(),
        status: 'DRIVER RETRYING (' + (err.message.substring(0, 30) || 'Election') + ')',
        ok: false
      };
      trafficLogs.unshift(logItem);
      if (trafficLogs.length > 50) trafficLogs.pop();
      resolve(logItem);
    }
  });
}

app.post('/api/traffic/start', (req, res) => {
  if (!trafficActive) {
    trafficActive = true;
    trafficInterval = setInterval(writeSingleTransaction, 1500);
  }
  res.json({ ok: true, active: trafficActive });
});

app.post('/api/traffic/stop', (req, res) => {
  if (trafficActive) {
    trafficActive = false;
    clearInterval(trafficInterval);
    trafficInterval = null;
  }
  res.json({ ok: true, active: trafficActive });
});

app.post('/api/traffic/single', async (req, res) => {
  const result = await writeSingleTransaction();
  res.json({ ok: true, transaction: result });
});

app.get('/api/traffic/stats', async (req, res) => {
  let dbCount = 0;
  try {
    const client = await getDbClient();
    if (client) {
      dbCount = await client.db('demoDB').collection('live_transactions').countDocuments();
    }
  } catch (e) {}

  res.json({
    active: trafficActive,
    totalWrites,
    failedWrites,
    dbCount,
    logs: trafficLogs
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`[INFO] Server listening on http://localhost:${PORT}`);
});
