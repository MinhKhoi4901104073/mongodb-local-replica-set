const rsConfig = {
  _id: "rs0",
  members: [
    { _id: 0, host: "mongo1:27017", priority: 2 },
    { _id: 1, host: "mongo2:27017", priority: 1 },
    { _id: 2, host: "mongo3:27017", priority: 1 }
  ]
};

try {
  const res = rs.initiate(rsConfig);
  if (res.ok !== 1) {
    printjson(res);
  }
} catch (e) {
  const msg = e.message || String(e);
  if (!msg.toLowerCase().includes("already") && e.codeName !== "AlreadyInitialized") {
    print("Initiation error: " + msg);
    quit(1);
  }
}

let primaryElected = false;
for (let i = 0; i < 30; i++) {
  sleep(2000);
  try {
    const status = rs.status();
    if (!status.members) continue;
    const p = status.members.find(m => m.stateStr === "PRIMARY");
    if (p) {
      primaryElected = true;
      print("Primary elected: " + p.name);
      break;
    }
  } catch (e) {}
}

if (!primaryElected) {
  print("Warning: Election timed out. Check rs.status() manually.");
}

try {
  const current = rs.status();
  current.members.forEach(m => {
    print(m.name + " -> " + m.stateStr);
  });
} catch (e) {}
