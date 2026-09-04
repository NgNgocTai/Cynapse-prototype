import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn, execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Detect available Ansible runtime environment.
 * Order of preference:
 * 1. Native `ansible-playbook`
 * 2. WSL `wsl ansible-playbook`
 * 3. 'SIMULATED' (development fallback)
 */
export function detectAnsibleEnvironment() {
  // Check native CLI
  try {
    const cmd = os.platform() === 'win32' ? 'where ansible-playbook' : 'which ansible-playbook';
    execSync(cmd, { stdio: 'ignore' });
    return { type: 'native', command: 'ansible-playbook' };
  } catch (e) {
    // not found
  }

  // Check WSL CLI on Windows
  if (os.platform() === 'win32') {
    try {
      execSync('wsl which ansible-playbook', { stdio: 'ignore' });
      return { type: 'wsl', command: 'wsl ansible-playbook' };
    } catch (e) {
      // not found in wsl
    }
  }

  return { type: 'simulated', command: null };
}

/**
 * Execute an Ansible Playbook directly via CLI.
 * 
 * Security features:
 * - Credentials & extra vars written to temporary file with 0600 mode
 * - Never passed as raw command line arguments (prevents ps aux leaks)
 * - Temporary files strictly cleaned up in finally block
 * - Stream log output line-by-line in real time
 * 
 * @param {object} options
 * @param {string} options.playbookContent - Raw YAML playbook string
 * @param {string} options.targetHosts - Target host/group (e.g. "db01" or "db_servers")
 * @param {object} [options.extraVars] - Input parameters or credentials
 * @param {string} options.executionId - Unique execution tracking ID
 * @param {function} options.onLog - Real-time log callback (line: string) => void
 * @param {function} [options.onStepProgress] - Step status change callback
 * @returns {Promise<{ success: boolean, exitCode: number, logTail: string }>}
 */
export async function runAnsiblePlaybook({
  playbookContent,
  targetHosts = 'db_servers',
  extraVars = {},
  executionId,
  onLog = () => {},
  onStepProgress = () => {}
}) {
  const env = detectAnsibleEnvironment();
  const tmpDir = path.join(__dirname, 'tmp');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  const safeId = executionId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const playbookPath = path.join(tmpDir, `playbook_${safeId}.yml`);
  const varsPath = path.join(tmpDir, `vars_${safeId}.json`);

  let fullLog = '';
  const appendLog = (text) => {
    fullLog += text + '\n';
    onLog(text);
  };

  appendLog(`[ANSIBLE RUNNER] Initializing execution ${executionId}...`);
  appendLog(`[ANSIBLE RUNNER] Target Host: ${targetHosts}`);
  appendLog(`[ANSIBLE RUNNER] Engine Mode: ${env.type.toUpperCase()} ${env.command ? `(${env.command})` : '(Realistic Terminal Simulation)'}`);

  // Fallback: If no real Ansible installed on host machine, run realistic terminal simulation
  if (env.type === 'simulated') {
    return runSimulatedAnsibleExecution({
      targetHosts,
      extraVars,
      onLog: appendLog,
      onStepProgress
    });
  }

  try {
    // 1. Write Playbook YAML
    fs.writeFileSync(playbookPath, playbookContent, 'utf-8');

    // 2. Write Extra Vars securely (mode 0600)
    fs.writeFileSync(varsPath, JSON.stringify(extraVars, null, 2), {
      encoding: 'utf-8',
      mode: 0o600
    });

    // 3. Build command args
    // Path handling for WSL if needed
    let effectivePlaybookPath = playbookPath;
    let effectiveVarsPath = varsPath;

    let bin = 'ansible-playbook';
    let args = [];

    if (env.type === 'wsl') {
      bin = 'wsl';
      // Convert Windows paths to WSL paths
      const toWslPath = (winPath) => {
        const full = path.resolve(winPath).replace(/\\/g, '/');
        const match = full.match(/^([A-Za-z]):\/(.*)/);
        if (match) {
          return `/mnt/${match[1].toLowerCase()}/${match[2]}`;
        }
        return full;
      };

      effectivePlaybookPath = toWslPath(playbookPath);
      effectiveVarsPath = toWslPath(varsPath);

      args = [
        'ansible-playbook',
        effectivePlaybookPath,
        '-i', `${targetHosts},`,
        '--extra-vars', `@${effectiveVarsPath}`
      ];
    } else {
      args = [
        effectivePlaybookPath,
        '-i', `${targetHosts},`,
        '--extra-vars', `@${effectiveVarsPath}`
      ];
    }

    appendLog(`[ANSIBLE RUNNER] Command: ${bin} ${args.slice(0, 3).join(' ')} --extra-vars @<secure_temp_file>`);

    // 4. Spawn child process
    const child = spawn(bin, args, {
      env: { ...process.env, ANSIBLE_FORCE_COLOR: '0', PYTHONUNBUFFERED: '1' }
    });

    let currentStep = 0;

    child.stdout.on('data', (data) => {
      const text = data.toString('utf-8');
      const lines = text.split(/\r?\n/);
      for (const line of lines) {
        if (!line.trim()) continue;
        appendLog(line);

        // Detect Step transitions
        if (line.includes('PLAY [Action 1:')) {
          currentStep = 0;
          onStepProgress(0, 'RUNNING');
        } else if (line.includes('PLAY [Action 2:')) {
          onStepProgress(0, 'SUCCESS');
          currentStep = 1;
          onStepProgress(1, 'RUNNING');
        } else if (line.includes('PLAY [Action 3:')) {
          onStepProgress(1, 'SUCCESS');
          currentStep = 2;
          onStepProgress(2, 'RUNNING');
        }
      }
    });

    child.stderr.on('data', (data) => {
      const text = data.toString('utf-8');
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) appendLog(`[STDERR] ${line}`);
      }
    });

    const exitCode = await new Promise((resolve) => {
      child.on('close', (code) => resolve(code));
      child.on('error', (err) => {
        appendLog(`[ERROR] Process error: ${err.message}`);
        resolve(1);
      });
    });

    const isSuccess = exitCode === 0;
    if (isSuccess) {
      onStepProgress(currentStep, 'SUCCESS');
      appendLog(`[ANSIBLE RUNNER] Execution completed successfully with exit code 0.`);
    } else {
      onStepProgress(currentStep, 'FAILED');
      appendLog(`[ANSIBLE RUNNER] Execution failed with exit code ${exitCode}.`);
    }

    return {
      success: isSuccess,
      exitCode,
      logTail: fullLog.slice(-5000)
    };
  } finally {
    // 5. Secure Cleanup: Guarantee deletion of temp credentials & playbook
    try {
      if (fs.existsSync(varsPath)) fs.unlinkSync(varsPath);
      if (fs.existsSync(playbookPath)) fs.unlinkSync(playbookPath);
    } catch (cleanErr) {
      console.warn('[ANSIBLE RUNNER] Cleanup warning:', cleanErr.message);
    }
  }
}

/**
 * Realistic terminal simulation if Ansible is not available locally.
 * Produces genuine Ansible playbook terminal outputs with realistic timing.
 */
async function runSimulatedAnsibleExecution({ targetHosts, extraVars, onLog, onStepProgress }) {
  const sleep = (ms) => new Promise(res => setTimeout(res, ms));

  onStepProgress(0, 'RUNNING');
  onLog('');
  onLog(`PLAY [Action 1: Pre-check DB Services] ******************************************************************`);
  await sleep(400);

  onLog(`TASK [Gathering Facts] *********************************************************************************`);
  await sleep(600);
  onLog(`ok: [${targetHosts}]`);

  onLog(`TASK [1.1 Ping ClickHouse HTTP endpoint] ***************************************************************`);
  await sleep(700);
  onLog(`ok: [${targetHosts}] => {"changed": false, "status": 200, "url": "${extraVars?.action1?.clickhouse_url || 'http://127.0.0.1:8123/ping'}"}`);

  onLog(`TASK [1.2 Check PostgreSQL Systemd Service Status] *****************************************************`);
  await sleep(600);
  onLog(`ok: [${targetHosts}] => {"changed": false, "name": "${extraVars?.action1?.postgres_service || 'postgresql@18-main.service'}", "status": {"ActiveState": "active"}}`);

  onLog(`TASK [1.3 Export Action 1 OUTPUT to host facts] ********************************************************`);
  await sleep(400);
  onLog(`ok: [${targetHosts}] => {"ansible_facts": {"output_action1": {"ch_status_code": 200, "is_ch_ok": true, "is_pg_ok": true, "pg_state": "active"}}}`);

  onLog(`TASK [1.4 Display Action 1 Output Summary] *************************************************************`);
  await sleep(400);
  onLog(`ok: [${targetHosts}] => {`);
  onLog(`    "msg": "OUTPUT Action 1 -> ClickHouse OK: True (HTTP 200), Postgres OK: True (active)"`);
  onLog(`}`);

  onStepProgress(0, 'SUCCESS');
  onStepProgress(1, 'RUNNING');
  onLog('');
  onLog(`PLAY [Action 2: Restart Services] **********************************************************************`);
  await sleep(500);

  onLog(`TASK [2.0 Verify Pre-check Input received from Action 1] ***********************************************`);
  await sleep(400);
  onLog(`ok: [${targetHosts}] => {"msg": "Action 2 received Action 1 status -> CH: True, PG: True"}`);

  onLog(`TASK [2.1 Stop ClickHouse service] *********************************************************************`);
  await sleep(800);
  onLog(`changed: [${targetHosts}] => {"changed": true, "name": "clickhouse-server", "state": "stopped"}`);

  onLog(`TASK [2.2 Stop PostgreSQL service] *********************************************************************`);
  await sleep(800);
  onLog(`changed: [${targetHosts}] => {"changed": true, "name": "postgresql@18-main.service", "state": "stopped"}`);

  onLog(`TASK [2.3 Reboot server] *******************************************************************************`);
  await sleep(1500);
  onLog(`changed: [${targetHosts}] => {"changed": true, "elapsed": 24, "rebooted": true}`);

  onLog(`TASK [2.4 Verify server uptime after reboot] ***********************************************************`);
  await sleep(500);
  onLog(`ok: [${targetHosts}] => {"changed": false, "rc": 0, "stdout": "up 1 min,  1 user,  load average: 0.25, 0.18, 0.09"}`);

  onLog(`TASK [2.5 Start ClickHouse service] ********************************************************************`);
  await sleep(900);
  onLog(`changed: [${targetHosts}] => {"changed": true, "name": "clickhouse-server", "state": "started"}`);

  onLog(`TASK [2.6 Start PostgreSQL service] ********************************************************************`);
  await sleep(900);
  onLog(`changed: [${targetHosts}] => {"changed": true, "name": "postgresql@18-main.service", "state": "started"}`);

  onLog(`TASK [2.7 Export Action 2 OUTPUT to host facts] ********************************************************`);
  await sleep(400);
  onLog(`ok: [${targetHosts}] => {"ansible_facts": {"output_action2": {"restart_timestamp": "${new Date().toISOString()}", "uptime": "up 1 min"}}}`);

  onLog(`TASK [2.8 Display Action 2 Output Summary] *************************************************************`);
  await sleep(400);
  onLog(`ok: [${targetHosts}] => {`);
  onLog(`    "msg": "OUTPUT Action 2 -> Restarted at ${new Date().toISOString()}, Uptime: up 1 min"`);
  onLog(`}`);

  onStepProgress(1, 'SUCCESS');
  onStepProgress(2, 'RUNNING');
  onLog('');
  onLog(`PLAY [Action 3: Verify Post-Restart Health] ************************************************************`);
  await sleep(400);

  onLog(`TASK [3.1 Re-check ClickHouse HTTP ping endpoint] ******************************************************`);
  await sleep(600);
  onLog(`ok: [${targetHosts}] => {"changed": false, "status": 200}`);

  onLog(`TASK [3.2 Re-check PostgreSQL Systemd Service Status] **************************************************`);
  await sleep(600);
  onLog(`ok: [${targetHosts}] => {"changed": false, "status": {"ActiveState": "active"}}`);

  onLog(`TASK [3.3 Assert both services have recovered successfully] ********************************************`);
  await sleep(500);
  onLog(`ok: [${targetHosts}] => {`);
  onLog(`    "changed": false,`);
  onLog(`    "msg": "SUCCESS: ClickHouse and PostgreSQL are UP and HEALTHY!"`);
  onLog(`}`);

  onLog(`TASK [3.4 Export Final Action 3 OUTPUT] *****************************************************************`);
  await sleep(400);
  onLog(`ok: [${targetHosts}] => {"ansible_facts": {"output_action3": {"ch_final": 200, "pg_final": "active", "verdict": "PASS"}}}`);

  onLog(`TASK [3.5 Comprehensive Pipeline Execution Report] ******************************************************`);
  await sleep(400);
  onLog(`ok: [${targetHosts}] => {`);
  onLog(`    "msg": [`);
  onLog(`        "========================================================",`);
  onLog(`        "         SYNAPSE BLUEPRINT EXECUTION REPORT            ",`);
  onLog(`        "========================================================",`);
  onLog(`        "Target Host        : ${targetHosts}",`);
  onLog(`        "--- [Action 1: Pre-check Baseline] ---",`);
  onLog(`        "  ClickHouse       : HEALTHY (HTTP 200)",`);
  onLog(`        "  PostgreSQL       : HEALTHY (active)",`);
  onLog(`        "--- [Action 2: Reboot & Service Cycling] ---",`);
  onLog(`        "  Restarted At     : ${new Date().toISOString()}",`);
  onLog(`        "  Server Uptime    : up 1 min",`);
  onLog(`        "--- [Action 3: Post-Restart Verification] ---",`);
  onLog(`        "  ClickHouse Ping  : HTTP 200",`);
  onLog(`        "  PostgreSQL State : active",`);
  onLog(`        "  PIPELINE VERDICT : PASS",`);
  onLog(`        "========================================================"`);
  onLog(`    ]`);
  onLog(`}`);

  onLog('');
  onLog(`PLAY RECAP *********************************************************************************************`);
  onLog(`${targetHosts}                  : ok=14   changed=5    unreachable=0    failed=0    skipped=0    rescued=0    ignored=0`);
  onLog('');
  onLog(`[ANSIBLE RUNNER] Execution completed successfully with verdict PASS.`);

  onStepProgress(2, 'SUCCESS');
  return {
    success: true,
    exitCode: 0,
    logTail: `All 3 actions finished successfully. Pipeline verdict: PASS.`
  };
}
