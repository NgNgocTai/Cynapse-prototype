import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_FILE = path.join(__dirname, 'catalog.json');

// === Core read/write ===

export function getCatalog() {
  const content = fs.readFileSync(CATALOG_FILE, 'utf-8');
  return JSON.parse(content);
}

export function saveCatalog(catalog) {
  const tmpFile = `${CATALOG_FILE}.tmp.${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  fs.writeFileSync(tmpFile, JSON.stringify(catalog, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmpFile, CATALOG_FILE);
}

// === Validation helpers ===

const ACTION_ID_PATTERN = /^[A-Z][A-Z0-9_]+$/;
const BLUEPRINT_NAME_PATTERN = /^[a-z][a-z0-9-]+$/;
const VALID_DOMAINS = ['CNTT', 'IP', '5G', 'Transport'];
const VALID_PROVIDERS = ['ansible', 'netconf', 'nephio', 'opentofu'];
const VALID_RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const VALID_STATUSES = ['DRAFT', 'IN_REVIEW', 'PUBLISHED'];

function validateAction(action, catalog, isUpdate = false) {
  const errors = [];

  if (!action.id || !ACTION_ID_PATTERN.test(action.id)) {
    errors.push('id must match UPPER_SNAKE_CASE (e.g. MY_ACTION_NAME)');
  }

  if (!isUpdate) {
    const exists = catalog.actions.find(a => a.id === action.id);
    if (exists) {
      if (exists.status === 'PUBLISHED') {
        errors.push(`Action "${action.id}" already exists and is PUBLISHED. Overwrite forbidden.`);
      } else if (!action.overwrite) {
        errors.push(`Action "${action.id}" already exists as DRAFT. Set overwrite=true to replace.`);
      }
    }
  }

  if (!action.name || action.name.trim().length === 0) {
    errors.push('name is required');
  }

  if (!VALID_DOMAINS.includes(action.domain)) {
    errors.push(`domain must be one of: ${VALID_DOMAINS.join(', ')}`);
  }

  if (!action.capability || action.capability.trim().length === 0) {
    errors.push('capability is required');
  }

  const provider = (action.implementation && action.implementation.provider) || action.provider || 'ansible';
  if (!VALID_PROVIDERS.includes(provider)) {
    errors.push(`provider must be one of: ${VALID_PROVIDERS.join(', ')}`);
  }

  if (action.implementation && action.implementation.awxJobTemplateId !== undefined && action.implementation.awxJobTemplateId !== null) {
    if (typeof action.implementation.awxJobTemplateId !== 'number' || action.implementation.awxJobTemplateId <= 0) {
      errors.push('implementation.awxJobTemplateId must be a positive number if provided');
    }
  }

  const risk = action.riskDefault || 'LOW';
  if (!VALID_RISK_LEVELS.includes(risk)) {
    errors.push(`riskDefault must be one of: ${VALID_RISK_LEVELS.join(', ')}`);
  }

  return errors;
}

function validateBlueprint(bp, catalog, isUpdate = false) {
  const errors = [];

  if (!bp.name || !BLUEPRINT_NAME_PATTERN.test(bp.name)) {
    errors.push('name must be kebab-case (e.g. my-blueprint-name)');
  }

  if (!isUpdate) {
    const exists = catalog.blueprints.find(b => b.metadata.name === bp.name);
    if (exists) errors.push(`Blueprint "${bp.name}" already exists`);
  }

  if (!bp.version || bp.version.trim().length === 0) {
    errors.push('version is required');
  }

  if (!bp.owner || bp.owner.trim().length === 0) {
    errors.push('owner is required');
  }

  if (!VALID_DOMAINS.includes(bp.domain)) {
    errors.push(`domain must be one of: ${VALID_DOMAINS.join(', ')}`);
  }

  if (!bp.steps || !Array.isArray(bp.steps) || bp.steps.length === 0) {
    errors.push('steps must be a non-empty array of actions');
  } else {
    for (const stepItem of bp.steps) {
      const actionId = typeof stepItem === 'string' ? stepItem : stepItem.action;
      const actionExists = catalog.actions.find(a => a.id === actionId);
      if (!actionExists) {
        errors.push(`Action "${actionId}" not found in catalog`);
      }
    }
  }

  if (bp.status && !VALID_STATUSES.includes(bp.status)) {
    errors.push(`status must be one of: ${VALID_STATUSES.join(', ')}`);
  }

  return errors;
}

// === Action CRUD ===

export function listActions() {
  return getCatalog().actions;
}

export function getAction(id) {
  const catalog = getCatalog();
  return catalog.actions.find(a => a.id === id) || null;
}

export function addAction(actionInput) {
  const catalog = getCatalog();
  const errors = validateAction(actionInput, catalog);
  if (errors.length > 0) return { ok: false, errors };
  const impl = actionInput.implementation || {};
  const action = {
    id: actionInput.id,
    name: actionInput.name,
    domain: actionInput.domain,
    capability: actionInput.capability,
    description: actionInput.description || '',
    inputs: actionInput.inputs || [],
    outputs: actionInput.outputs || [],
    task_template: actionInput.task_template || null,
    implementation: {
      provider: impl.provider || 'ansible',
      awxJobTemplateId: impl.awxJobTemplateId || null,
      estimatedDurationSec: impl.estimatedDurationSec || 60,
      ...(impl.playbookRef ? { playbookRef: impl.playbookRef } : {}),
      ...(impl.role ? { role: impl.role, become_user: impl.become_user } : {})
    },
    verification: actionInput.verification || {
      type: 'embedded',
      note: 'Playbook self-verifies'
    },
    compensation: actionInput.compensation || {
      type: 'escalate',
      action: 'NOTIFY_ONCALL'
    },
    riskDefault: actionInput.riskDefault || 'LOW',
    status: actionInput.status || 'DRAFT',
    ...(actionInput.parameters ? { parameters: actionInput.parameters } : {}),
    ...(actionInput.templateId ? { templateId: actionInput.templateId } : {})
  };

  const existingIdx = catalog.actions.findIndex(a => a.id === action.id);
  if (existingIdx !== -1) {
    catalog.actions[existingIdx] = action;
  } else {
    catalog.actions.push(action);
  }
  saveCatalog(catalog);
  return { ok: true, action };
}

export function updateAction(id, actionInput) {
  const catalog = getCatalog();
  const index = catalog.actions.findIndex(a => a.id === id);
  if (index === -1) return { ok: false, errors: [`Action "${id}" not found`] };

  // Validate with isUpdate=true (skip uniqueness check for same ID)
  const errors = validateAction({ ...actionInput, id }, catalog, true);
  if (errors.length > 0) return { ok: false, errors };

  const current = catalog.actions[index];
  const impl = actionInput.implementation || current.implementation || {};

  const action = {
    ...current,
    name: actionInput.name || current.name,
    domain: actionInput.domain || current.domain,
    capability: actionInput.capability || current.capability,
    description: actionInput.description !== undefined ? actionInput.description : current.description,
    inputs: actionInput.inputs || current.inputs || [],
    outputs: actionInput.outputs || current.outputs || [],
    task_template: actionInput.task_template !== undefined ? actionInput.task_template : current.task_template,
    implementation: {
      provider: impl.provider || 'ansible',
      awxJobTemplateId: impl.awxJobTemplateId,
      estimatedDurationSec: impl.estimatedDurationSec || 60,
      ...(impl.playbookRef ? { playbookRef: impl.playbookRef } : {}),
      ...(impl.role ? { role: impl.role, become_user: impl.become_user } : {})
    },
    verification: actionInput.verification || current.verification,
    compensation: actionInput.compensation || current.compensation,
    riskDefault: actionInput.riskDefault || current.riskDefault,
    status: actionInput.status || current.status || 'DRAFT',
    parameters: actionInput.parameters || current.parameters,
    templateId: actionInput.templateId || current.templateId
  };

  catalog.actions[index] = action;
  saveCatalog(catalog);
  return { ok: true, action };
}

export function publishAction(id, actor = 'operator') {
  const catalog = getCatalog();
  const action = catalog.actions.find(a => a.id === id);
  if (!action) return { ok: false, error: `Action "${id}" not found in catalog` };
  action.status = 'PUBLISHED';
  action.publishedAt = new Date().toISOString();
  action.publishedBy = actor;
  saveCatalog(catalog);
  return { ok: true, action };
}

export function deleteAction(id) {
  const catalog = getCatalog();
  const index = catalog.actions.findIndex(a => a.id === id);
  if (index === -1) return { ok: false, errors: [`Action "${id}" not found`] };

  // Check referential integrity: any blueprint using this action?
  const referencingBlueprints = catalog.blueprints.filter(b =>
    b.spec.steps.some(step => step.action === id)
  );

  if (referencingBlueprints.length > 0) {
    const names = referencingBlueprints.map(b => b.metadata.name).join(', ');
    return {
      ok: false,
      errors: [`Cannot delete: action "${id}" is referenced by blueprint(s): ${names}`]
    };
  }

  catalog.actions.splice(index, 1);
  saveCatalog(catalog);
  return { ok: true };
}

// === Blueprint CRUD ===

export function listBlueprints() {
  return getCatalog().blueprints;
}

export function getBlueprint(name) {
  const catalog = getCatalog();
  return catalog.blueprints.find(b => b.metadata.name === name) || null;
}

export function addBlueprint(bpInput) {
  const catalog = getCatalog();
  const errors = validateBlueprint(bpInput, catalog);
  if (errors.length > 0) return { ok: false, errors };

  const blueprint = {
    kind: 'AutomationBlueprint',
    metadata: {
      name: bpInput.name,
      version: bpInput.version
    },
    spec: {
      owner: bpInput.owner,
      domain: bpInput.domain,
      description: bpInput.description || '',
      steps: bpInput.steps.map((item, idx) => {
        if (typeof item === 'string') {
          return { stepIndex: idx + 1, action: item, inputs: {} };
        }
        return {
          stepIndex: idx + 1,
          action: item.action,
          inputs: item.inputs || {}
        };
      }),
      compensation: {
        onFailure: bpInput.compensationOnFailure || 'NOTIFY_ONCALL'
      },
      status: bpInput.status || 'DRAFT'
    }
  };

  catalog.blueprints.push(blueprint);
  saveCatalog(catalog);
  return { ok: true, blueprint };
}

export function updateBlueprint(name, bpInput) {
  const catalog = getCatalog();
  const index = catalog.blueprints.findIndex(b => b.metadata.name === name);
  if (index === -1) return { ok: false, errors: [`Blueprint "${name}" not found`] };

  const errors = validateBlueprint({ ...bpInput, name }, catalog, true);
  if (errors.length > 0) return { ok: false, errors };

  const blueprint = {
    kind: 'AutomationBlueprint',
    metadata: {
      name,
      version: bpInput.version || catalog.blueprints[index].metadata.version
    },
    spec: {
      owner: bpInput.owner,
      domain: bpInput.domain,
      description: bpInput.description || catalog.blueprints[index].spec.description || '',
      steps: bpInput.steps.map((item, idx) => {
        if (typeof item === 'string') {
          return { stepIndex: idx + 1, action: item, inputs: {} };
        }
        return {
          stepIndex: idx + 1,
          action: item.action,
          inputs: item.inputs || {}
        };
      }),
      compensation: {
        onFailure: bpInput.compensationOnFailure || 'NOTIFY_ONCALL'
      },
      status: bpInput.status || catalog.blueprints[index].spec.status
    }
  };

  catalog.blueprints[index] = blueprint;
  saveCatalog(catalog);
  return { ok: true, blueprint };
}

export function deleteBlueprint(name) {
  const catalog = getCatalog();
  const index = catalog.blueprints.findIndex(b => b.metadata.name === name);
  if (index === -1) return { ok: false, errors: [`Blueprint "${name}" not found`] };

  catalog.blueprints.splice(index, 1);
  saveCatalog(catalog);
  return { ok: true };
}
