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
  const tmp = CATALOG_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(catalog, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, CATALOG_FILE);
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
    if (exists) errors.push(`Action "${action.id}" already exists`);
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

  if (!action.implementation || !action.implementation.provider) {
    errors.push('implementation.provider is required');
  } else if (!VALID_PROVIDERS.includes(action.implementation.provider)) {
    errors.push(`provider must be one of: ${VALID_PROVIDERS.join(', ')}`);
  }

  if (!action.implementation || !action.implementation.awxJobTemplateId || action.implementation.awxJobTemplateId <= 0) {
    errors.push('implementation.awxJobTemplateId must be > 0');
  }

  if (!VALID_RISK_LEVELS.includes(action.riskDefault)) {
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
    errors.push('steps must be a non-empty array of action IDs');
  } else {
    for (const actionId of bp.steps) {
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

  const action = {
    id: actionInput.id,
    name: actionInput.name,
    domain: actionInput.domain,
    capability: actionInput.capability,
    inputs: actionInput.inputs || [
      { name: 'target_group', type: 'string', default: 'servers', required: true }
    ],
    implementation: {
      provider: actionInput.implementation.provider,
      awxJobTemplateId: actionInput.implementation.awxJobTemplateId,
      estimatedDurationSec: actionInput.implementation.estimatedDurationSec || 300
    },
    verification: actionInput.verification || {
      type: 'embedded',
      note: 'Playbook self-verifies'
    },
    compensation: actionInput.compensation || {
      type: 'escalate',
      action: 'NOTIFY_ONCALL'
    },
    riskDefault: actionInput.riskDefault
  };

  catalog.actions.push(action);
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

  const action = {
    ...catalog.actions[index],
    name: actionInput.name,
    domain: actionInput.domain,
    capability: actionInput.capability,
    inputs: actionInput.inputs || catalog.actions[index].inputs,
    implementation: {
      provider: actionInput.implementation.provider,
      awxJobTemplateId: actionInput.implementation.awxJobTemplateId,
      estimatedDurationSec: actionInput.implementation.estimatedDurationSec || 300
    },
    verification: actionInput.verification || catalog.actions[index].verification,
    compensation: actionInput.compensation || catalog.actions[index].compensation,
    riskDefault: actionInput.riskDefault
  };

  catalog.actions[index] = action;
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
      steps: bpInput.steps.map(actionId => ({ action: actionId })),
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
      steps: bpInput.steps.map(actionId => ({ action: actionId })),
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
