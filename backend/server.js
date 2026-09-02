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
  generateYAML,
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
    
    // Get template metadata
    const template = getTemplate(templateId);
    
    // Generate YAML
    const yaml = generateYAML(templateId, params);
    
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
        awxJobTemplateId: 10, // Hardcode tạm ID 10 để chạy mock AWX mượt mà
        playbook: yaml
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
      `Action ${action.id} created from template ${templateId}`);
    
    res.status(201).json({
      action: result.action,
      yaml: yaml,
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
  
  // Improved blueprint resolution logic
  // 1. Tìm action match với objective
  const action = catalog.actions.find(a => 
    change.objective === a.id || 
    change.objective.includes(a.id) ||
    a.id.includes(change.objective)
  );
  
  if (!action) {
    return res.status(400).json({ 
      error: `No action found matching objective: ${change.objective}. Available actions: ${catalog.actions.map(a => a.id).join(', ')}` 
    });
  }
  
  // 2. Tìm blueprint sử dụng action đó
  const blueprint = catalog.blueprints.find(b => 
    b.spec.steps.some(step => step.action === action.id)
  );
  
  if (!blueprint) {
    return res.status(400).json({ 
      error: `No blueprint found using action: ${action.id}` 
    });
  }
  
  if (action.implementation.awxJobTemplateId === 0) {
    return res.status(400).json({ 
      error: 'Action not configured with AWX Job Template ID. Please update catalog.json' 
    });
  }
  
  const planId = `PLAN-${String(planCounter++).padStart(3, '0')}`;
  const plan = {
    planId,
    changeId: id,
    blueprint: `${blueprint.metadata.name}@${blueprint.metadata.version}`,
    steps: blueprint.spec.steps.map(step => {
      const stepAction = catalog.actions.find(a => a.id === step.action);
      return {
        action: step.action,
        provider: stepAction ? stepAction.implementation.provider : 'unknown',
        awxJobTemplateId: stepAction ? stepAction.implementation.awxJobTemplateId : 0
      };
    })
  };
  
  state.plans.set(planId, plan);
  writeAudit('ExecutionPlan', planId, 'system', 'resolved', 'success', 
    `For change ${id}, using blueprint ${blueprint.metadata.name}, action ${action.id}`);
  
  res.json(plan);
});

// ===========================
// EXECUTIONS (existing, unchanged)
// ===========================

// POST /api/plans/:id/execute - Execute plan (launch AWX job)
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
  
  try {
    // Launch AWX job
    const step = plan.steps[0]; // For v1, only 1 step
    const awxJobId = await launchJob(step.awxJobTemplateId, {
      target_group: change.target
    });
    
    const execution = {
      executionId,
      planId: id,
      changeId: plan.changeId,
      awxJobId,
      status: 'pending',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      logTail: ''
    };
    
    state.executions.set(executionId, execution);
    
    // Update change state
    change.state = 'Executing';
    state.changes.set(plan.changeId, change);
    
    writeAudit('Execution', executionId, 'system', 'launched', 'success', 
      `AWX Job ID: ${awxJobId}`);
    
    res.json(execution);
    
  } catch (error) {
    writeAudit('Execution', executionId, 'system', 'launch_failed', 'failed', error.message);
    
    return res.status(500).json({ 
      error: error.message === 'AWX unreachable' ? 'AWX unreachable' : 'Failed to launch job'
    });
  }
});

// GET /api/executions/:id/status - Get execution status
app.get('/api/executions/:id/status', async (req, res) => {
  const { id } = req.params;
  const execution = state.executions.get(id);
  
  if (!execution) {
    return res.status(404).json({ error: 'Execution not found' });
  }
  
  try {
    const awxStatus = await getJobStatus(execution.awxJobId);
    
    // Update execution status
    execution.status = awxStatus.status;
    
    // If job finished, update change state
    if (awxStatus.finished) {
      execution.finishedAt = new Date().toISOString();
      
      const change = state.changes.get(execution.changeId);
      
      if (awxStatus.status === 'successful') {
        change.state = 'Verified';
        writeAudit('Execution', id, 'system', 'completed', 'success', 
          `AWX Job ${execution.awxJobId} successful`);
      } else if (awxStatus.failed) {
        change.state = 'Failed';
        writeAudit('Execution', id, 'system', 'completed', 'failed', 
          `AWX Job ${execution.awxJobId} failed`);
        
        // Trigger compensation
        writeAudit('Compensation', execution.changeId, 'system', 'NOTIFY_ONCALL', 'success',
          'Compensation triggered due to execution failure');
      }
      
      state.changes.set(execution.changeId, change);
    }
    
    state.executions.set(id, execution);
    
    res.json(execution);
    
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch AWX status' });
  }
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
