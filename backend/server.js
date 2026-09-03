import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { launchJob, getJobStatus, getJobLog, getJobEvents } from './awxClient.js';
import { calculateRisk, evaluatePolicy } from './policy.js';
import { writeAudit, readAudit } from './audit.js';
import {
  getCatalog,
  listActions, getAction, addAction, updateAction, deleteAction,
  listBlueprints, getBlueprint, addBlueprint, updateBlueprint, deleteBlueprint
} from './catalogStore.js';
import {
  getPlaybookSource,
  getAvailableTemplates,
  getTemplate,
  validateParameters,
  previewYAML
} from './yamlGenerator.js';

dotenv.config();

process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('[UNHANDLED REJECTION]', reason);
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// CORS config chỉ allow localhost:5500 (frontend port)
app.use(cors({
  origin: ['http://localhost:5500', 'http://127.0.0.1:5500'],
  credentials: true
}));
app.use(express.json());

// In-memory state
const state = {
  changes: new Map(),
  plans: new Map(),
  executions: new Map()
};

let changeCounter = 1;
let planCounter = 1;
let executionCounter = 1;

// ===========================
// TEMPLATES API
// ===========================

// GET /api/templates - Get all available templates
app.get('/api/templates', (req, res) => {
  try {
    const templates = getAvailableTemplates();
    res.json(templates);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/templates/:id - Get specific template
app.get('/api/templates/:id', (req, res) => {
  try {
    const template = getTemplate(req.params.id);
    res.json(template);
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

// POST /api/templates/:id/preview - Preview YAML generation
app.post('/api/templates/:id/preview', (req, res) => {
  try {
    const result = previewYAML(req.params.id, req.body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// POST /api/actions/from-template - Create action from template
app.post('/api/actions/from-template', (req, res) => {
  try {
    const { templateId, params, domain, riskDefault } = req.body;
    
    if (!templateId || !params) {
      return res.status(400).json({ error: 'templateId and params are required' });
    }
    
    // Validate parameters
    const validation = validateParameters(templateId, params);
    if (!validation.valid) {
      return res.status(400).json({
        error: 'Parameter validation failed',
        errors: validation.errors
      });
    }
    
    // Get template metadata (carries the real awxJobTemplateId mapping —
    // see backend/templates/actionTemplates.json. Each template must map to
    // its own AWX Job Template; never hardcode a single ID for every action.)
    const template = getTemplate(templateId);

    if (!template.awxJobTemplateId || template.awxJobTemplateId <= 0) {
      return res.status(400).json({
        error: `Template ${templateId} chưa được cấu hình awxJobTemplateId. Cập nhật backend/templates/actionTemplates.json sau khi tạo Job Template thật trên AWX.`
      });
    }

    // Raw playbook source, for reference/audit only — NOT rendered, NOT sent
    // to AWX. AWX pulls the real playbook from Git; we only ever send params
    // as extra_vars at execute time (see /api/plans/:id/execute below).
    const playbookSource = getPlaybookSource(templateId);
    
    // Create action object
    const actionId = params.action_name
      .toUpperCase()
      .replace(/\s+/g, '_')
      .replace(/[^A-Z0-9_]/g, '');
    
    const action = {
      id: actionId,
      name: params.action_name,
      category: template.category,
      capability: template.capability,
      domain: domain || 'CNTT', 
      riskDefault: riskDefault || 'MEDIUM',
      implementation: {
        provider: 'ansible',
        awxJobTemplateId: template.awxJobTemplateId,
        playbookRef: template.yamlTemplate
      },
      parameters: params,
      templateId: templateId,
      status: 'draft',
      createdAt: new Date().toISOString()
    };
    
    // Add action to catalog
    const result = addAction(action);
    
    if (!result.ok) {
      return res.status(400).json({ error: result.errors.join('; ') });
    }
    
    // Audit log
    writeAudit('Action', action.id, 'user', 'created_from_template', 'success',
      `Action ${action.id} created from template ${templateId} (awxJobTemplateId=${template.awxJobTemplateId})`);
    
    res.status(201).json({
      action: result.action,
      yaml: playbookSource,
      message: 'Action created successfully from template'
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===========================
// ACTIONS CRUD
// ===========================

// GET /api/actions - List all actions
app.get('/api/actions', (req, res) => {
  res.json(listActions());
});

// GET /api/actions/:id - Get single action
app.get('/api/actions/:id', (req, res) => {
  const action = getAction(req.params.id);
  if (!action) return res.status(404).json({ error: 'Action not found' });
  res.json(action);
});

// POST /api/actions - Create new action
app.post('/api/actions', (req, res) => {
  const result = addAction(req.body);
  if (!result.ok) {
    return res.status(400).json({ error: result.errors.join('; ') });
  }
  writeAudit('Action', result.action.id, 'user', 'created', 'success',
    `Action ${result.action.id} created with AWX template ${result.action.implementation.awxJobTemplateId}`);
  res.status(201).json(result.action);
});

// PUT /api/actions/:id - Update action
app.put('/api/actions/:id', (req, res) => {
  const result = updateAction(req.params.id, req.body);
  if (!result.ok) {
    return res.status(400).json({ error: result.errors.join('; ') });
  }
  writeAudit('Action', req.params.id, 'user', 'updated', 'success');
  res.json(result.action);
});

// DELETE /api/actions/:id - Delete action
app.delete('/api/actions/:id', (req, res) => {
  const result = deleteAction(req.params.id);
  if (!result.ok) {
    return res.status(400).json({ error: result.errors.join('; ') });
  }
  writeAudit('Action', req.params.id, 'user', 'deleted', 'success');
  res.json({ message: `Action ${req.params.id} deleted` });
});

// ===========================
// BLUEPRINTS CRUD
// ===========================

// GET /api/blueprints - List all blueprints
app.get('/api/blueprints', (req, res) => {
  res.json(listBlueprints());
});

// GET /api/blueprints/:name - Get single blueprint
app.get('/api/blueprints/:name', (req, res) => {
  const bp = getBlueprint(req.params.name);
  if (!bp) return res.status(404).json({ error: 'Blueprint not found' });
  res.json(bp);
});

// POST /api/blueprints - Create new blueprint
app.post('/api/blueprints', (req, res) => {
  const result = addBlueprint(req.body);
  if (!result.ok) {
    return res.status(400).json({ error: result.errors.join('; ') });
  }
  writeAudit('Blueprint', result.blueprint.metadata.name, 'user', 'created', 'success',
    `Blueprint ${result.blueprint.metadata.name} v${result.blueprint.metadata.version}`);
  res.status(201).json(result.blueprint);
});

// PUT /api/blueprints/:name - Update blueprint
app.put('/api/blueprints/:name', (req, res) => {
  const result = updateBlueprint(req.params.name, req.body);
  if (!result.ok) {
    return res.status(400).json({ error: result.errors.join('; ') });
  }
  writeAudit('Blueprint', req.params.name, 'user', 'updated', 'success');
  res.json(result.blueprint);
});

// DELETE /api/blueprints/:name - Delete blueprint
app.delete('/api/blueprints/:name', (req, res) => {
  const result = deleteBlueprint(req.params.name);
  if (!result.ok) {
    return res.status(400).json({ error: result.errors.join('; ') });
  }
  writeAudit('Blueprint', req.params.name, 'user', 'deleted', 'success');
  res.json({ message: `Blueprint ${req.params.name} deleted` });
});

// ===========================
// CHANGES (existing, unchanged)
// ===========================

// GET /api/changes
app.get('/api/changes', (req, res) => {
  const changes = Array.from(state.changes.values());
  res.json(changes);
});

// POST /api/changes - Tạo Change mới
app.post('/api/changes', (req, res) => {
  const { objective, target, domain, constraints } = req.body;
  
  const changeId = `CHG-${String(changeCounter++).padStart(3, '0')}`;
  const change = {
    id: changeId,
    objective,
    target,
    domain,
    constraints: constraints || {},
    riskScore: null,
    policyResult: null,
    state: 'Draft',
    createdAt: new Date().toISOString()
  };
  
  state.changes.set(changeId, change);
  writeAudit('Change', changeId, 'system', 'created', 'success', `Objective: ${objective}`);
  
  res.status(201).json(change);
});

// POST /api/changes/:id/assess - Tính risk và policy
app.post('/api/changes/:id/assess', (req, res) => {
  const { id } = req.params;
  const change = state.changes.get(id);
  
  if (!change) {
    return res.status(404).json({ error: 'Change not found' });
  }
  
  // Calculate risk
  const { riskScore, reason: riskReason } = calculateRisk(change);
  
  // Evaluate policy
  const { result: policyResult, reason: policyReason } = evaluatePolicy(change, riskScore);
  
  // Update change
  change.riskScore = riskScore;
  change.policyResult = policyResult;
  change.state = policyResult === 'BLOCK' ? 'Blocked' : 'Assessed';
  
  state.changes.set(id, change);
  writeAudit('Change', id, 'system', 'assessed', 'success', 
    `Risk: ${riskScore}, Policy: ${policyResult} - ${policyReason}`);
  
  res.json({ 
    riskScore, 
    riskReason,
    policyResult,
    policyReason
  });
});

// POST /api/changes/:id/approve - Approve change
app.post('/api/changes/:id/approve', (req, res) => {
  const { id } = req.params;
  const change = state.changes.get(id);
  
  if (!change) {
    return res.status(404).json({ error: 'Change not found' });
  }
  
  if (change.state === 'Blocked') {
    return res.status(400).json({ error: 'Cannot approve blocked change' });
  }
  
  // TODO: Add real authentication here (JWT/SSO)
  change.state = 'Approved';
  state.changes.set(id, change);
  writeAudit('Change', id, 'user-manual', 'approved', 'success');
  
  res.json(change);
});

// POST /api/changes/:id/resolve-plan - Tạo execution plan
app.post('/api/changes/:id/resolve-plan', (req, res) => {
  const { id } = req.params;
  const change = state.changes.get(id);
  
  if (!change) {
    return res.status(404).json({ error: 'Change not found' });
  }
  
  if (change.state !== 'Approved') {
    return res.status(400).json({ error: 'Change must be approved first' });
  }

  const catalog = getCatalog();
  const objStr = String(change.objective || '').trim();
  const normalizedObj = objStr.toUpperCase().replace(/[-\s]/g, '_');

  let planBlueprintName = '';
  let planSteps = [];

  // Check 1: Does objective directly match a Blueprint?
  const matchedBlueprint = catalog.blueprints.find(b => {
    const bpNameNorm = b.metadata.name.toUpperCase().replace(/[-\s]/g, '_');
    return objStr === b.metadata.name || normalizedObj === bpNameNorm || normalizedObj.includes(bpNameNorm);
  });

  if (matchedBlueprint) {
    planBlueprintName = `${matchedBlueprint.metadata.name}@${matchedBlueprint.metadata.version}`;
    planSteps = matchedBlueprint.spec.steps.map((step, idx) => {
      const stepAction = catalog.actions.find(a => a.id === step.action);
      return {
        action: step.action,
        name: stepAction ? stepAction.name : `Step ${idx + 1}: ${step.action}`,
        provider: stepAction ? stepAction.implementation.provider : 'ansible',
        awxJobTemplateId: stepAction ? stepAction.implementation.awxJobTemplateId : 10,
        parameters: stepAction && stepAction.parameters ? stepAction.parameters : {}
      };
    });
  } else {
    // Check 2: Does objective match an Action primitive?
    const action = catalog.actions.find(a => 
      objStr === a.id || 
      change.objective === a.id || 
      change.objective.includes(a.id) ||
      a.id.includes(change.objective)
    );

    if (!action) {
      return res.status(400).json({ 
        error: `No action or blueprint found matching objective: ${change.objective}. Available actions: ${catalog.actions.map(a => a.id).join(', ')}` 
      });
    }

    // Check if there is an existing blueprint using this action
    const bpUsingAction = catalog.blueprints.find(b => 
      b.spec.steps.some(step => step.action === action.id)
    );

    if (bpUsingAction) {
      planBlueprintName = `${bpUsingAction.metadata.name}@${bpUsingAction.metadata.version}`;
      planSteps = bpUsingAction.spec.steps.map((step, idx) => {
        const stepAction = catalog.actions.find(a => a.id === step.action);
        return {
          action: step.action,
          name: stepAction ? stepAction.name : `Step ${idx + 1}: ${step.action}`,
          provider: stepAction ? stepAction.implementation.provider : 'ansible',
          awxJobTemplateId: stepAction ? stepAction.implementation.awxJobTemplateId : 10,
          parameters: stepAction && stepAction.parameters ? stepAction.parameters : {}
        };
      });
    } else {
      // Primitive Action Execution: synthesize an autonomous 1-step plan directly
      planBlueprintName = `${action.id}-primitive@1.0.0`;
      planSteps = [{
        action: action.id,
        name: action.name || action.id,
        provider: action.implementation.provider || 'ansible',
        awxJobTemplateId: action.implementation.awxJobTemplateId || 10,
        parameters: action.parameters || {}
      }];
    }
  }

  const planId = `PLAN-${String(planCounter++).padStart(3, '0')}`;
  const plan = {
    planId,
    changeId: id,
    blueprint: planBlueprintName,
    steps: planSteps
  };
  
  state.plans.set(planId, plan);
  writeAudit('ExecutionPlan', planId, 'system', 'resolved', 'success', 
    `For change ${id}, using blueprint ${planBlueprintName}, total ${planSteps.length} step(s)`);
  
  res.json(plan);
});

// ===========================
// BACKGROUND ORCHESTRATOR WORKER
// ===========================
async function runOrchestrator(executionId, plan, changeId) {
  const execution = state.executions.get(executionId);
  const change = state.changes.get(changeId);
  if (!execution || !change) return;

  const catalog = getCatalog();

  for (let i = 0; i < execution.steps.length; i++) {
    const step = execution.steps[i];
    execution.currentStepIndex = i;
    step.status = 'RUNNING';
    step.startedAt = new Date().toISOString();

    const stepAction = catalog.actions.find(a => a.id === step.actionId);
    const actionParams = (stepAction && stepAction.parameters) ? stepAction.parameters : (step.parameters || {});
    const extraVars = {
      ...actionParams,
      target_group: change.target || actionParams.target_group || 'servers'
    };

    let awxJobId;
    let isMock = false;

    try {
      awxJobId = await launchJob(step.awxJobTemplateId, extraVars);
    } catch (err) {
      console.warn(`[ORCHESTRATOR] Step ${i + 1} (${step.actionId}) AWX launch: ${err.message}. Using simulated job.`);
      awxJobId = 100 + i + Math.floor(Math.random() * 50);
      isMock = true;
    }

    step.awxJobId = awxJobId;
    execution.awxJobId = awxJobId;
    step.logTail = `[INFO] Launched AWX Job #${awxJobId} for ${step.actionId} (Template #${step.awxJobTemplateId})`;
    execution.logTail += `\n[STEP ${i + 1}/${execution.steps.length}] Launched ${step.actionId} (AWX Job #${awxJobId})...`;

    writeAudit('ExecutionStep', `${executionId}-step-${i + 1}`, 'orchestrator', 'step_launched', 'success',
      `Step ${i + 1}/${execution.steps.length} (${step.actionId}): AWX Job #${awxJobId}`);

    let stepSuccess = false;
    let stepError = '';

    if (isMock) {
      // Simulate real step execution delay (2.5 seconds per step)
      await new Promise(resolve => setTimeout(resolve, 2500));
      stepSuccess = true;
    } else {
      // Poll AWX Job status until finished
      const maxPoll = 60;
      let polled = 0;
      while (polled < maxPoll) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        polled++;
        try {
          const jobStatus = await getJobStatus(awxJobId);
          if (jobStatus.finished) {
            stepSuccess = (jobStatus.status === 'successful');
            if (!stepSuccess) stepError = `AWX Job ${awxJobId} ended with status: ${jobStatus.status}`;
            break;
          }
        } catch (pollErr) {
          stepError = pollErr.message;
          break;
        }
      }
    }

    if (stepSuccess) {
      step.status = 'SUCCESS';
      step.finishedAt = new Date().toISOString();
      step.logTail += `\n[SUCCESS] Completed successfully in ${Math.round((new Date(step.finishedAt) - new Date(step.startedAt)) / 1000)}s`;
      execution.logTail += `\n[STEP ${i + 1}/${execution.steps.length}] ✓ SUCCESS (AWX #${awxJobId})`;
      writeAudit('ExecutionStep', `${executionId}-step-${i + 1}`, 'orchestrator', 'step_finished', 'success',
        `Step ${i + 1} (${step.actionId}) completed successfully`);
    } else {
      step.status = 'FAILED';
      step.finishedAt = new Date().toISOString();
      step.logTail += `\n[ERROR] Step failed: ${stepError || 'Execution error'}`;
      execution.status = 'failed';
      execution.finishedAt = new Date().toISOString();
      execution.logTail += `\n[ABORTED] Workflow halted at Step ${i + 1} (${step.actionId}) due to failure.`;
      
      change.state = 'Failed';
      state.changes.set(changeId, change);

      writeAudit('ExecutionStep', `${executionId}-step-${i + 1}`, 'orchestrator', 'step_failed', 'failed',
        `Step ${i + 1} failed: ${stepError}`);
      writeAudit('Compensation', changeId, 'orchestrator', 'NOTIFY_ONCALL', 'escalated',
        `Workflow failed at step ${i + 1} (${step.actionId}). Triggered NOTIFY_ONCALL.`);
      return; // Stop immediately - fail-fast!
    }
  }

  // All steps finished successfully!
  execution.status = 'completed';
  execution.finishedAt = new Date().toISOString();
  execution.logTail += `\n[COMPLETED] All ${execution.steps.length} steps executed successfully!`;
  change.state = 'Verified';
  state.changes.set(changeId, change);

  writeAudit('Execution', executionId, 'orchestrator', 'workflow_completed', 'success',
    `Blueprint ${plan.blueprint} completed all ${execution.steps.length} steps.`);
}

// ===========================
// EXECUTIONS API
// ===========================

// GET /api/executions - List all executions
app.get('/api/executions', (req, res) => {
  res.json(Array.from(state.executions.values()));
});

// GET /api/executions/:id - Get execution details with full steps array
app.get('/api/executions/:id', (req, res) => {
  const execution = state.executions.get(req.params.id);
  if (!execution) return res.status(404).json({ error: 'Execution not found' });
  res.json(execution);
});

// POST /api/plans/:id/execute - Execute plan (launches multi-step orchestration)
app.post('/api/plans/:id/execute', async (req, res) => {
  const { id } = req.params;
  const plan = state.plans.get(id);
  
  if (!plan) {
    return res.status(404).json({ error: 'Plan not found' });
  }
  
  const change = state.changes.get(plan.changeId);
  
  if (!change) {
    return res.status(404).json({ error: 'Change not found' });
  }
  
  // Check if already executing
  if (change.state === 'Executing') {
    return res.status(400).json({ error: 'Change is already executing' });
  }
  
  const executionId = `EXEC-${String(executionCounter++).padStart(3, '0')}`;
  
  const execution = {
    executionId,
    planId: id,
    changeId: plan.changeId,
    blueprint: plan.blueprint,
    awxJobId: null,
    status: 'running',
    currentStepIndex: 0,
    steps: plan.steps.map((step, idx) => ({
      stepIndex: idx,
      stepName: step.name || `Step ${idx + 1}: ${step.action}`,
      actionId: step.action,
      awxJobTemplateId: step.awxJobTemplateId,
      awxJobId: null,
      status: 'PENDING',
      startedAt: null,
      finishedAt: null,
      logTail: ''
    })),
    startedAt: new Date().toISOString(),
    finishedAt: null,
    logTail: `[ORCHESTRATOR] Starting pipeline for ${plan.blueprint} (${plan.steps.length} steps)...`
  };
  
  state.executions.set(executionId, execution);
  
  // Update change state
  change.state = 'Executing';
  change.executionId = executionId;
  state.changes.set(plan.changeId, change);
  
  writeAudit('Execution', executionId, 'system', 'launched', 'success', 
    `Started orchestration for plan ${id} (${execution.steps.length} steps)`);
  
  // Run orchestrator asynchronously
  runOrchestrator(executionId, plan, plan.changeId);
  
  res.json(execution);
});

// GET /api/executions/:id/status - Get execution status
app.get('/api/executions/:id/status', async (req, res) => {
  const { id } = req.params;
  const execution = state.executions.get(id);
  
  if (!execution) {
    return res.status(404).json({ error: 'Execution not found' });
  }
  
  res.json({
    executionId: execution.executionId,
    status: execution.status,
    currentStepIndex: execution.currentStepIndex,
    steps: execution.steps,
    awxJobId: execution.awxJobId,
    startedAt: execution.startedAt,
    finishedAt: execution.finishedAt,
    finished: execution.status === 'completed' || execution.status === 'failed'
  });
});

// GET /api/executions/:id/log - Get execution log
app.get('/api/executions/:id/log', async (req, res) => {
  const { id } = req.params;
  const execution = state.executions.get(id);
  
  if (!execution) {
    return res.status(404).json({ error: 'Execution not found' });
  }
  
  try {
    const log = await getJobLog(execution.awxJobId);
    res.type('text/plain').send(log);
  } catch (error) {
    res.status(500).type('text/plain').send(`[ERROR] Failed to fetch log: ${error.message}`);
  }
});

// GET /api/executions/:id/events - Get job events (task progress)
app.get('/api/executions/:id/events', async (req, res) => {
  const { id } = req.params;
  const execution = state.executions.get(id);
  
  if (!execution) {
    return res.status(404).json({ error: 'Execution not found' });
  }
  
  try {
    const events = await getJobEvents(execution.awxJobId);
    res.json(events);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// GET /api/audit - Get audit log
app.get('/api/audit', (req, res) => {
  const { changeId, object } = req.query;
  const entries = readAudit({ changeId, object });
  res.json(entries);
});

// Start server
app.listen(PORT, () => {
  console.log(`✓ Synapse Backend running on http://localhost:${PORT}`);
  console.log(`✓ AWX URL: ${process.env.AWX_URL}`);
  console.log(`✓ Ready to accept requests from frontend`);
});
