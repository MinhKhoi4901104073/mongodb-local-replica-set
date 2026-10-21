let currentPrimary = null;
let isElectionRunning = false;
let electionStopwatchTimer = null;
let electionStartTimestamp = null;
let isTrafficActive = false;
const nodeContainers = { mongo1: true, mongo2: true, mongo3: true };

const kpiClusterStatus = document.getElementById('kpiClusterStatus');
const kpiQuorum = document.getElementById('kpiQuorum');
const kpiPrimaryNode = document.getElementById('kpiPrimaryNode');
const kpiElectionTime = document.getElementById('kpiElectionTime');
const kpiElectionStatus = document.getElementById('kpiElectionStatus');
const kpiTrafficCount = document.getElementById('kpiTrafficCount');
const kpiTrafficStatus = document.getElementById('kpiTrafficStatus');
const stopwatchVal = document.getElementById('stopwatchVal');
const stopwatchBox = document.getElementById('stopwatchBox');

const btnKillPrimary = document.getElementById('btnKillPrimary');
const btnRecoverAll = document.getElementById('btnRecoverAll');
const btnToggleTraffic = document.getElementById('btnToggleTraffic');
const trafficBtnLabel = document.getElementById('trafficBtnLabel');
const btnWriteSingle = document.getElementById('btnWriteSingle');
const btnRefresh = document.getElementById('btnRefresh');
const btnClearLog = document.getElementById('btnClearLog');

const txTableBody = document.getElementById('txTableBody');
const txCountBadge = document.getElementById('txCountBadge');
const eventStream = document.getElementById('eventStream');


function logEvent(msg, type = 'info') {
  const time = new Date().toLocaleTimeString();
  const div = document.createElement('div');
  div.className = `event-line ${type}`;
  div.innerHTML = `<span class="event-time">[${time}]</span> <span class="event-msg">${msg}</span>`;
  eventStream.appendChild(div);
  eventStream.scrollTop = eventStream.scrollHeight;
}

async function updateClusterStatus() {
  try {
    const res = await fetch('/api/cluster/status');
    const data = await res.json();
    if (!data.ok) return;

    const { containers, primaryNode, electionBenchmark } = data;

    if (primaryNode && primaryNode !== currentPrimary) {
      if (currentPrimary !== null) {
        logEvent(`Election successful: Node [${primaryNode}] elected as new PRIMARY`, 'success');
      }
      currentPrimary = primaryNode;
    }

    if (primaryNode) {
      kpiPrimaryNode.textContent = primaryNode;
      kpiPrimaryNode.className = 'kpi-value text-green';
    } else {
      kpiPrimaryNode.textContent = 'ELECTING...';
      kpiPrimaryNode.className = 'kpi-value text-amber';
    }

    let runningCount = 0;
    ['mongo1', 'mongo2', 'mongo3'].forEach(node => {
      const c = containers[node];
      const isRunning = c && c.running;
      nodeContainers[node] = isRunning;
      if (isRunning) runningCount++;

      const card = document.getElementById(`card-${node}`);
      const roleBadge = document.getElementById(`role-${node}`);
      const dot = document.getElementById(`dot-${node}`);
      const health = document.getElementById(`health-${node}`);
      const btnToggle = document.getElementById(`btnToggle-${node}`);

      if (!isRunning) {
        card.className = 'node-card glass down';
        roleBadge.className = 'node-role-badge badge-down';
        roleBadge.textContent = 'STOPPED';
        dot.className = 'node-status-dot dot-down';
        health.textContent = 'Status: DOWN';
        btnToggle.textContent = 'Start Node';
        btnToggle.className = 'btn btn-node-action btn-recover btn-sm';
      } else {
        const isPrim = primaryNode === node;
        card.className = isPrim ? 'node-card glass primary' : 'node-card glass secondary';
        roleBadge.className = isPrim ? 'node-role-badge badge-primary' : 'node-role-badge badge-secondary';
        roleBadge.textContent = isPrim ? 'PRIMARY' : 'SECONDARY';
        dot.className = 'node-status-dot dot-online';
        health.textContent = 'Status: HEALTHY';
        btnToggle.textContent = 'Stop Node';
        btnToggle.className = 'btn btn-node-action btn-danger btn-sm';
      }
    });

    if (runningCount === 3) {
      kpiClusterStatus.textContent = '3/3 Nodes Online';
      kpiClusterStatus.className = 'kpi-value text-green';
      kpiQuorum.textContent = 'Quorum: 3/3 (Optimal HA)';
    } else if (runningCount === 2) {
      kpiClusterStatus.textContent = '2/3 Nodes Online';
      kpiClusterStatus.className = 'kpi-value text-amber';
      kpiQuorum.textContent = 'Quorum: 2/3 (Minimal Quorum)';
    } else {
      kpiClusterStatus.textContent = `${runningCount}/3 Nodes Online`;
      kpiClusterStatus.className = 'kpi-value text-red';
      kpiQuorum.textContent = 'Quorum Lost (Read-Only)';
    }

    if (electionBenchmark) {
      if (electionBenchmark.inProgress) {
        if (!isElectionRunning) {
          startElectionStopwatch(electionBenchmark.startTime);
        }
      } else if (electionBenchmark.durationSec) {
        if (isElectionRunning) {
          stopElectionStopwatch(electionBenchmark.durationSec, electionBenchmark.newPrimary);
        }
        kpiElectionTime.textContent = `${electionBenchmark.durationSec}s`;
        kpiElectionStatus.textContent = `New Primary: ${electionBenchmark.newPrimary}`;
      }
    }
  } catch (err) {
    kpiClusterStatus.textContent = 'API Unavailable';
    kpiClusterStatus.className = 'kpi-value text-red';
  }
}

function startElectionStopwatch(serverStartTime) {
  isElectionRunning = true;
  electionStartTimestamp = serverStartTime || Date.now();
  stopwatchBox.style.borderColor = '#ef4444';
  logEvent('Primary offline detected. Monitoring election progress...', 'warn');

  if (electionStopwatchTimer) clearInterval(electionStopwatchTimer);
  electionStopwatchTimer = setInterval(() => {
    const elapsed = ((Date.now() - electionStartTimestamp) / 1000).toFixed(2);
    stopwatchVal.textContent = `${elapsed}s`;
    kpiElectionTime.textContent = `${elapsed}s`;
    kpiElectionStatus.textContent = 'Consensus vote in progress';
  }, 50);
}

function stopElectionStopwatch(durationSec, newPrimary) {
  isElectionRunning = false;
  clearInterval(electionStopwatchTimer);
  stopwatchVal.textContent = `${durationSec}s`;
  stopwatchBox.style.borderColor = '#10b981';
  logEvent(`Election settled in ${durationSec}s. New primary: [${newPrimary}]`, 'success');
}

async function toggleNode(node) {
  const isRunning = nodeContainers[node];
  const action = isRunning ? 'stop' : 'start';
  const url = isRunning ? '/api/cluster/stop-node' : '/api/cluster/start-node';

  logEvent(`Executing container ${action} on [${node}]...`, 'info');
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ node })
    });
    const data = await res.json();
    if (data.ok) {
      logEvent(`Container [${node}] ${action} completed.`, isRunning ? 'warn' : 'success');
      updateClusterStatus();
    }
  } catch (e) {
    logEvent(`Error modifying node state: ${e.message}`, 'error');
  }
}

btnKillPrimary.addEventListener('click', async () => {
  if (!currentPrimary) {
    alert('No active Primary node detected');
    return;
  }
  const prim = currentPrimary;
  logEvent(`Simulating sudden failure of Primary [${prim}]...`, 'warn');
  startElectionStopwatch(Date.now());
  await toggleNode(prim);
});

btnRecoverAll.addEventListener('click', async () => {
  logEvent('Initiating cluster node recovery...', 'info');
  for (const node of ['mongo1', 'mongo2', 'mongo3']) {
    if (!nodeContainers[node]) {
      await fetch('/api/cluster/start-node', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ node })
      });
      logEvent(`Container [${node}] started. Awaiting oplog catch-up...`, 'success');
    }
  }
  setTimeout(updateClusterStatus, 2000);
});

async function updateTrafficStats() {
  try {
    const res = await fetch('/api/traffic/stats');
    const data = await res.json();
    const { active, totalWrites, dbCount, logs } = data;

    isTrafficActive = active;
    if (active) {
      btnToggleTraffic.className = 'btn btn-traffic active';
      trafficBtnLabel.textContent = 'Pause Workload';
      kpiTrafficStatus.textContent = 'Active (~1.5s/tx)';
    } else {
      btnToggleTraffic.className = 'btn btn-traffic';
      trafficBtnLabel.textContent = 'Start Workload';
      kpiTrafficStatus.textContent = 'writeConcern: majority';
    }

    kpiTrafficCount.textContent = totalWrites;
    txCountBadge.textContent = `${dbCount || totalWrites} records`;

    if (logs && logs.length > 0) {
      txTableBody.innerHTML = logs.map(tx => {
        const statusClass = tx.ok ? 'tx-status-ok' : 'tx-status-retry';
        return `
          <tr>
            <td style="font-family: var(--font-mono); font-weight: 600;">${tx.id}</td>
            <td>${tx.service}</td>
            <td style="font-family: var(--font-mono); font-weight: 600;">${tx.amount}</td>
            <td><span class="badge" style="background: rgba(255,255,255,0.05); font-family: var(--font-mono);">${tx.latencyMs}ms</span></td>
            <td class="${statusClass}">${tx.status}</td>
            <td style="color: var(--text-dim);">${tx.time}</td>
          </tr>
        `;
      }).join('');
    }
  } catch (e) {}
}

btnToggleTraffic.addEventListener('click', async () => {
  const url = isTrafficActive ? '/api/traffic/stop' : '/api/traffic/start';
  await fetch(url, { method: 'POST' });
  logEvent(isTrafficActive ? 'Workload generator paused.' : 'Workload generator started.', 'info');
  updateTrafficStats();
});

btnWriteSingle.addEventListener('click', async () => {
  btnWriteSingle.disabled = true;
  btnWriteSingle.textContent = 'Writing...';
  try {
    const res = await fetch('/api/traffic/single', { method: 'POST' });
    const data = await res.json();
    if (data.ok) {
      logEvent(`Transaction [${data.transaction.id}] committed (${data.transaction.latencyMs}ms)`, 'success');
      updateTrafficStats();
    }
  } catch (e) {
    logEvent(`Write failed: ${e.message}`, 'error');
  } finally {
    btnWriteSingle.disabled = false;
    btnWriteSingle.textContent = '+1 Write';
  }
});

btnClearLog.addEventListener('click', () => {
  eventStream.innerHTML = '';
});

btnRefresh.addEventListener('click', () => {
  updateClusterStatus();
  updateTrafficStats();
  logEvent('Manual cluster refresh triggered.', 'info');
});

updateClusterStatus();
updateTrafficStats();
setInterval(updateClusterStatus, 1500);
setInterval(updateTrafficStats, 1500);
