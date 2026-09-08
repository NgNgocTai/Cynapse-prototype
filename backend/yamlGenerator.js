import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getCatalog } from './catalogStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load template definitions
function getTemplates() {
  const templatesPath = path.join(__dirname, 'templates', 'actionTemplates.json');
  const content = fs.readFileSync(templatesPath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Get raw playbook source for a template (unrendered Jinja2).
 * NOTE: We do NOT render/compile this file. The real Ansible engine on the
 * AWX execution node evaluates the Jinja2 expressions ({{ }}, {% if %}) at
 * job-run time using the extra_vars passed via the launch API. This function
 * exists only to show the BO what the underlying playbook looks like.
 * @param {string} templateId - Template ID (e.g. "RESTART_SERVICE")
 * @returns {string} Raw playbook file content (Jinja2, unrendered)
 */
export function getPlaybookSource(templateId) {
  const templates = getTemplates();
  const template = templates.templates.find(t => t.id === templateId);

  if (!template) {
    throw new Error(`Template not found: ${templateId}`);
  }

  const templatePath = path.join(__dirname, 'templates', 'yaml', template.yamlTemplate);

  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template file not found: ${template.yamlTemplate}`);
  }

  return fs.readFileSync(templatePath, 'utf-8');
}

/**
 * Get all available templates
 * @returns {Array} Array of template definitions
 */
export function getAvailableTemplates() {
  const templates = getTemplates();
  return templates.templates;
}

/**
 * Get a specific template by ID
 * @param {string} templateId - Template ID
 * @returns {object} Template definition
 */
export function getTemplate(templateId) {
  const templates = getTemplates();
  const template = templates.templates.find(t => t.id === templateId);

  if (!template) {
    throw new Error(`Template not found: ${templateId}`);
  }

  return template;
}

/**
 * Validate parameters against template schema.
 * Mutates `params` in place to fill in defaults for missing optional/required
 * fields, matching the previous behavior relied on by callers.
 * @param {string} templateId - Template ID
 * @param {object} params - Parameters to validate
 * @returns {object} { valid: boolean, errors: string[] }
 */
export function validateParameters(templateId, params) {
  const template = getTemplate(templateId);
  const errors = [];

  for (const param of template.parameters) {
    // Apply defaults for missing values (required or optional)
    if (params[param.name] === undefined && param.default !== undefined) {
      params[param.name] = param.default;
    }

    const value = params[param.name];

    // Check required
    if (param.required && (value === undefined || value === null || value === '')) {
      errors.push(`Parameter '${param.name}' is required`);
      continue;
    }

    // Skip validation if value is not provided and not required
    if (value === undefined || value === null || value === '') {
      continue;
    }

    // Type validation
    switch (param.type) {
      case 'number':
        if (typeof value !== 'number' && isNaN(Number(value))) {
          errors.push(`Parameter '${param.name}' must be a number`);
        }
        break;
      case 'boolean':
        if (typeof value !== 'boolean') {
          errors.push(`Parameter '${param.name}' must be a boolean`);
        }
        break;
      case 'string':
      case 'textarea':
        if (typeof value !== 'string') {
          errors.push(`Parameter '${param.name}' must be a string`);
        }
        break;
      case 'select':
        if (param.options) {
          const validValues = param.options.map(opt => opt.value);
          if (!validValues.includes(value)) {
            errors.push(`Parameter '${param.name}' must be one of: ${validValues.join(', ')}`);
          }
        }
        break;
    }

    // Regex validation
    if (param.validation && typeof value === 'string') {
      const regex = new RegExp(param.validation);
      if (!regex.test(value)) {
        errors.push(`Parameter '${param.name}' does not match required format`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Preview the playbook for a template: validates params, then returns the
 * RAW (unrendered) Jinja2 playbook source, plus a note clarifying that the
 * {{ }} values shown are placeholders evaluated by Ansible at real run time,
 * not a pre-filled build.
 * @param {string} templateId - Template ID
 * @param {object} params - Parameters (validated but not injected into YAML)
 * @returns {object} { yaml: string, valid: boolean, errors: string[], note?: string }
 */
export function previewYAML(templateId, params) {
  const validation = validateParameters(templateId, params);

  if (!validation.valid) {
    return {
      yaml: null,
      valid: false,
      errors: validation.errors
    };
  }

  try {
    const yaml = getPlaybookSource(templateId);
    return {
      yaml,
      valid: true,
      errors: [],
      note: 'Đây là playbook gốc (Jinja2). Các giá trị {{ }} sẽ được Ansible nạp tại thời điểm chạy bằng extra-vars.'
    };
  } catch (error) {
    return {
      yaml: null,
      valid: false,
      errors: [error.message]
    };
  }
}

/**
 * Generate a complete, runnable Ansible Playbook YAML for a composed Blueprint.
 * Maps per-action inputs into structured vars and set_fact outputs.
 * 
 * @param {object} blueprint - Blueprint definition object
 * @param {string} [targetHosts] - Target host or group (e.g. "db01" or "db_servers")
 * @param {Array} [stepOverrides] - Optional per-step input overrides
 * @returns {string} Fully rendered Ansible Playbook YAML
 */
export function generateBlueprintPlaybook(blueprint, targetHosts = 'db_servers', stepOverrides = []) {
  const steps = blueprint.spec?.steps || [];
  const bpName = blueprint.metadata?.name || 'custom-blueprint';
  const bpVersion = blueprint.metadata?.version || '1.0.0';

  // For any custom or user-created blueprint (not db-maintenance-pipeline), generate dynamically from catalog actions
  if (bpName !== 'db-maintenance-pipeline') {
    const catalog = getCatalog();
    let playbookYaml = `# ==============================================================================
# Playbook: ${bpName} (v${bpVersion})
# Generated dynamically by SYNAPSE Automation Platform (Composable Task Engine)
# ==============================================================================
---
`;

    const usedStepIds = new Set();
    steps.forEach((step, idx) => {
      const actionId = typeof step === 'string' ? step : step.action;
      const action = catalog.actions.find(a => a.id === actionId);
      const actionName = action ? action.name : actionId;

      // Determine stable stepId (slugified and unique)
      let baseStepId = '';
      if (step.stepId && typeof step.stepId === 'string' && step.stepId.trim()) {
        baseStepId = step.stepId.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
      } else {
        baseStepId = actionId.toLowerCase().replace(/[^a-z0-9_]/g, '_');
      }
      let stepId = baseStepId;
      let counter = 1;
      while (usedStepIds.has(stepId)) {
        stepId = `${baseStepId}_${counter++}`;
      }
      usedStepIds.add(stepId);

      const defaultActionInputs = {};
      if (action && Array.isArray(action.inputs)) {
        action.inputs.forEach(inp => {
          if (inp.default !== undefined) defaultActionInputs[inp.name] = inp.default;
        });
      }
      const override = stepOverrides.find(o => o.stepIndex === idx + 1 || o.action === actionId || o.stepId === stepId);
      const stepInputs = { ...defaultActionInputs, ...(step.inputs || {}), ...((override && override.inputs) || {}) };

      playbookYaml += `
# ==============================================================================
# STEP ${idx + 1}: ${actionName} (${actionId}) [ID: ${stepId}]
# ==============================================================================
- name: "Step ${idx + 1}: ${actionName}"
  hosts: "${targetHosts}"
  gather_facts: ${idx === 0 ? 'yes' : 'no'}
`;

      if (Object.keys(stepInputs).length > 0) {
        playbookYaml += `  vars:\n`;
        for (const [k, v] of Object.entries(stepInputs)) {
          if (typeof v === 'number' || typeof v === 'boolean') {
            playbookYaml += `    ${k}: ${v}\n`;
          } else {
            playbookYaml += `    ${k}: ${JSON.stringify(String(v))}\n`;
          }
        }
      }

      if (action && action.implementation && action.implementation.role) {
        const roleName = action.implementation.role;
        const becomeUser = action.implementation.become_user || '{{ db_os_user | default("postgres") }}';
        playbookYaml += `  become: true\n`;
        playbookYaml += `  become_user: ${JSON.stringify(String(becomeUser))}\n`;
        playbookYaml += `  roles:\n`;
        playbookYaml += `    - role: ${roleName}\n`;
      } else {
        playbookYaml += `  tasks:\n`;

        if (action && Array.isArray(action.task_template) && action.task_template.length > 0) {
          action.task_template.forEach((t, tIdx) => {
            playbookYaml += `    - name: "${idx + 1}.${tIdx + 1} ${t.name || actionName}"\n`;
            if (t.module) {
              playbookYaml += `      ${t.module}:\n`;
              if (t.args) {
                for (const [argK, argV] of Object.entries(t.args)) {
                  if (typeof argV === 'number' || typeof argV === 'boolean') {
                    playbookYaml += `        ${argK}: ${argV}\n`;
                  } else if (Array.isArray(argV)) {
                    playbookYaml += `        ${argK}:\n`;
                    argV.forEach(item => {
                      playbookYaml += `          - ${JSON.stringify(String(item))}\n`;
                    });
                  } else {
                    playbookYaml += `        ${argK}: ${JSON.stringify(String(argV))}\n`;
                  }
                }
              }
            }
            if (t.register) {
              playbookYaml += `      register: ${t.register}\n`;
            }
            if (t.failed_when !== undefined) {
              playbookYaml += `      failed_when: ${t.failed_when}\n`;
            }
          });
        } else {
          playbookYaml += `    - name: "${idx + 1}.1 Execute ${actionName}"\n`;
          playbookYaml += `      ansible.builtin.debug:\n`;
          playbookYaml += `        msg: "Step ${idx + 1}: ${actionName} executed successfully on host {{ inventory_hostname }}"\n`;
        }
      }

      if (action && Array.isArray(action.outputs) && action.outputs.length > 0) {
        if (action.implementation && action.implementation.role) {
          playbookYaml += `  post_tasks:\n`;
        }
        playbookYaml += `    - name: "${idx + 1}.${(action.task_template?.length || 1) + 1} Export Step ${idx + 1} Facts (${stepId})"\n`;
        playbookYaml += `      ansible.builtin.set_fact:\n`;
        
        const registeredVar = action.task_template?.find(t => t.register)?.register;
        const taskModule = action.task_template?.[0]?.module || '';

        action.outputs.forEach(out => {
          const regName = out.register || registeredVar || out.name;
          let rawExpr = '';

          if (out.extract_field) {
            rawExpr = `${regName}.${out.extract_field} | default('')`;
          } else if (taskModule.includes('command') || taskModule.includes('shell')) {
            rawExpr = `${regName}.stdout | default('')`;
          } else if (taskModule.includes('uri')) {
            if (out.name.includes('code') || out.name.includes('status')) {
              rawExpr = `${regName}.status | default(200)`;
            } else {
              rawExpr = `${regName}.json | default(${regName}.content | default(''))`;
            }
          } else if (taskModule.includes('systemd') || taskModule.includes('service')) {
            rawExpr = `${regName}.status.ActiveState | default(${regName}.state | default('active'))`;
          } else if (out.type === 'boolean') {
            rawExpr = `${regName}.rc == 0 if ${regName}.rc is defined else (not ${regName}.failed | default(false))`;
          } else {
            rawExpr = `${regName}.stdout if ${regName}.stdout is defined else (${regName}.msg if ${regName}.msg is defined else ${regName})`;
          }

          // 1. Hierarchical dict: steps.<stepId>.<factName>
          playbookYaml += `        steps: "{{ steps | default({}) | combine({ '${stepId}': { '${out.name}': (${rawExpr}) } }, recursive=True) }}"\n`;
          // 2. Direct flat variables for convenience & stability
          playbookYaml += `        step_${stepId}_${out.name}: "{{ ${rawExpr} }}"\n`;
          playbookYaml += `        ${stepId}_${out.name}: "{{ ${rawExpr} }}"\n`;
          // 3. Backwards compatibility
          playbookYaml += `        output_step${idx + 1}: "{{ output_step${idx + 1} | default({}) | combine({ '${out.name}': (${rawExpr}) }) }}"\n`;
        });
      }
    });

    playbookYaml += `
# ==============================================================================
# PIPELINE EXECUTION SUMMARY
# ==============================================================================
- name: "Pipeline Execution Summary"
  hosts: "${targetHosts}"
  gather_facts: no
  tasks:
    - name: Display Summary Report
      ansible.builtin.debug:
        msg:
          - "========================================================"
          - "         SYNAPSE PIPELINE EXECUTION REPORT              "
          - "========================================================"
          - "Blueprint  : ${bpName} (v${bpVersion})"
          - "Target     : {{ target_hosts }}"
          - "Total Steps: ${steps.length} sequential actions executed"
          - "Status     : COMPLETED"
          - "========================================================"
`;
    return playbookYaml;
  }

  // Specialized multi-play Database Maintenance Pipeline Playbook
  // Find step configs
  const getStepInputs = (idx, actionId) => {
    const override = stepOverrides.find(o => o.stepIndex === idx + 1 || o.action === actionId);
    if (override && override.inputs) return override.inputs;
    const bpStep = steps[idx];
    return (bpStep && bpStep.inputs) ? bpStep.inputs : {};
  };

  const a1 = getStepInputs(0, 'DB_PRECHECK');
  const a2 = getStepInputs(1, 'DB_RESTART_CYCLE');
  const a3 = getStepInputs(2, 'DB_POST_VERIFY');

  const chUrl1 = a1.clickhouse_url || 'http://127.0.0.1:8123/ping';
  const chTimeout1 = a1.clickhouse_timeout || 10;
  const pgSvc1 = a1.postgres_service || 'postgresql@18-main.service';

  const chSvc2 = a2.clickhouse_service || 'clickhouse-server';
  const pgSvc2 = a2.postgres_service || 'postgresql@18-main.service';
  const rbTimeout2 = a2.reboot_timeout || 300;

  const chUrl3 = a3.clickhouse_url || chUrl1;
  const pgSvc3 = a3.postgres_service || pgSvc2;

  return `# ==============================================================================
# Playbook: ${bpName} (v${bpVersion})
# Generated dynamically by SYNAPSE Automation Platform (No AWX Dependency)
# Execution Pattern: Composable Blueprint with Per-Action Input/Output (set_fact)
# ==============================================================================
---

# ==============================================================================
# ACTION 1: Pre-check DB Services
# INPUT:  ch_url, ch_timeout, pg_svc
# OUTPUT: output_action1 (is_ch_ok, is_pg_ok, ch_status_code, pg_state)
# ==============================================================================
- name: "Action 1: Pre-check DB Services"
  hosts: "${targetHosts}"
  gather_facts: yes
  vars:
    ch_url: "{{ action1.clickhouse_url | default('${chUrl1}') }}"
    ch_timeout: "{{ action1.clickhouse_timeout | default(${chTimeout1}) }}"
    pg_svc: "{{ action1.postgres_service | default('${pgSvc1}') }}"
  tasks:
    - name: 1.1 Ping ClickHouse HTTP endpoint
      ansible.builtin.uri:
        url: "{{ ch_url }}"
        timeout: "{{ ch_timeout }}"
      register: ch_health
      failed_when: false

    - name: 1.2 Check PostgreSQL Systemd Service Status
      ansible.builtin.systemd:
        name: "{{ pg_svc }}"
      register: pg_health
      failed_when: false

    - name: 1.3 Export Action 1 OUTPUT to host facts
      ansible.builtin.set_fact:
        output_action1:
          is_ch_ok: "{{ ch_health.status | default(0) == 200 }}"
          is_pg_ok: "{{ pg_health.status.ActiveState | default('') == 'active' }}"
          ch_status_code: "{{ ch_health.status | default(0) }}"
          pg_state: "{{ pg_health.status.ActiveState | default('unknown') }}"

    - name: 1.4 Display Action 1 Output Summary
      ansible.builtin.debug:
        msg: "OUTPUT Action 1 -> ClickHouse OK: {{ output_action1.is_ch_ok }} (HTTP {{ output_action1.ch_status_code }}), Postgres OK: {{ output_action1.is_pg_ok }} ({{ output_action1.pg_state }})"

# ==============================================================================
# ACTION 2: Restart Services Cycle (Stop -> Reboot -> Start)
# INPUT:  ch_svc, pg_svc, rb_timeout
# INPUT FROM ACTION 1: output_action1 (automatically inherited via host facts)
# OUTPUT: output_action2 (restart_timestamp, uptime)
# ==============================================================================
- name: "Action 2: Restart Services"
  hosts: "${targetHosts}"
  become: true
  gather_facts: yes
  vars:
    ch_svc: "{{ action2.clickhouse_service | default('${chSvc2}') }}"
    pg_svc: "{{ action2.postgres_service | default('${pgSvc2}') }}"
    rb_timeout: "{{ action2.reboot_timeout | default(${rbTimeout2}) }}"
  tasks:
    - name: 2.0 Verify Pre-check Input received from Action 1
      ansible.builtin.debug:
        msg: "Action 2 received Action 1 status -> CH: {{ output_action1.is_ch_ok }}, PG: {{ output_action1.is_pg_ok }}"

    - name: 2.1 Stop ClickHouse service
      ansible.builtin.systemd_service:
        name: "{{ ch_svc }}"
        state: stopped

    - name: 2.2 Stop PostgreSQL service
      ansible.builtin.systemd_service:
        name: "{{ pg_svc }}"
        state: stopped

    - name: 2.3 Reboot server
      ansible.builtin.reboot:
        reboot_timeout: "{{ rb_timeout }}"
        connect_timeout: 20
        pre_reboot_delay: 5
        post_reboot_delay: 15
        test_command: uptime

    - name: 2.4 Verify server uptime after reboot
      ansible.builtin.command: uptime
      register: uptime_result
      changed_when: false

    - name: 2.5 Start ClickHouse service
      ansible.builtin.systemd_service:
        name: "{{ ch_svc }}"
        state: started

    - name: 2.6 Start PostgreSQL service
      ansible.builtin.systemd_service:
        name: "{{ pg_svc }}"
        state: started

    - name: 2.7 Export Action 2 OUTPUT to host facts
      ansible.builtin.set_fact:
        output_action2:
          restart_timestamp: "{{ ansible_date_time.iso8601 }}"
          uptime: "{{ uptime_result.stdout }}"

    - name: 2.8 Display Action 2 Output Summary
      ansible.builtin.debug:
        msg: "OUTPUT Action 2 -> Restarted at {{ output_action2.restart_timestamp }}, Uptime: {{ output_action2.uptime }}"

# ==============================================================================
# ACTION 3: Post-Restart Health Verification
# INPUT:  ch_url, pg_svc
# INPUT FROM ACTION 1: output_action1 (pre-check baseline)
# INPUT FROM ACTION 2: output_action2 (reboot confirmation)
# OUTPUT: output_action3 (ch_final, pg_final, verdict)
# ==============================================================================
- name: "Action 3: Verify Post-Restart Health"
  hosts: "${targetHosts}"
  gather_facts: no
  vars:
    ch_url: "{{ action3.clickhouse_url | default('${chUrl3}') }}"
    pg_svc: "{{ action3.postgres_service | default('${pgSvc3}') }}"
  tasks:
    - name: 3.1 Re-check ClickHouse HTTP ping endpoint
      ansible.builtin.uri:
        url: "{{ ch_url }}"
        timeout: 10
      register: verify_ch
      failed_when: false

    - name: 3.2 Re-check PostgreSQL Systemd Service Status
      ansible.builtin.systemd:
        name: "{{ pg_svc }}"
      register: verify_pg

    - name: 3.3 Assert both services have recovered successfully
      ansible.builtin.assert:
        that:
          - verify_ch.status == 200
          - verify_pg.status.ActiveState == 'active'
        fail_msg: "CRITICAL: Database restart cycle failed! One or more services are down."
        success_msg: "SUCCESS: ClickHouse and PostgreSQL are UP and HEALTHY!"

    - name: 3.4 Export Final Action 3 OUTPUT
      ansible.builtin.set_fact:
        output_action3:
          ch_final: "{{ verify_ch.status | default(0) }}"
          pg_final: "{{ verify_pg.status.ActiveState | default('unknown') }}"
          verdict: "{{ 'PASS' if (verify_ch.status == 200 and verify_pg.status.ActiveState == 'active') else 'FAIL' }}"

    - name: 3.5 Comprehensive Pipeline Execution Report
      ansible.builtin.debug:
        msg:
          - "========================================================"
          - "         SYNAPSE BLUEPRINT EXECUTION REPORT            "
          - "========================================================"
          - "Target Host        : {{ target_hosts }}"
          - "--- [Action 1: Pre-check Baseline] ---"
          - "  ClickHouse       : {{ 'HEALTHY' if output_action1.is_ch_ok else 'DOWN' }} (HTTP {{ output_action1.ch_status_code }})"
          - "  PostgreSQL       : {{ 'HEALTHY' if output_action1.is_pg_ok else 'DOWN' }} ({{ output_action1.pg_state }})"
          - "--- [Action 2: Reboot & Service Cycling] ---"
          - "  Restarted At     : {{ output_action2.restart_timestamp }}"
          - "  Server Uptime    : {{ output_action2.uptime }}"
          - "--- [Action 3: Post-Restart Verification] ---"
          - "  ClickHouse Ping  : HTTP {{ output_action3.ch_final }}"
          - "  PostgreSQL State : {{ output_action3.pg_final }}"
          - "  PIPELINE VERDICT : {{ output_action3.verdict }}"
          - "========================================================"
`;
}

