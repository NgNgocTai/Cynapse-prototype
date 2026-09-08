import { getCatalog } from './catalogStore.js';

export function calculateRisk(change) {
  if (!change || !change.objective) {
    return { riskScore: 50, reason: 'No objective specified, default medium risk' };
  }

  const catalog = getCatalog();
  const objStr = String(change.objective);
  const normalizedObj = objStr.toUpperCase().replace(/[-\s]/g, '_');

  const riskMap = {
    'LOW': 25,
    'MEDIUM': 50,
    'HIGH': 75,
    'CRITICAL': 95
  };

  // 1. Check if objective matches a Blueprint
  const blueprint = catalog.blueprints.find(b => {
    const bpNameNorm = b.metadata.name.toUpperCase().replace(/[-\s]/g, '_');
    return objStr === b.metadata.name || normalizedObj === bpNameNorm || normalizedObj.includes(bpNameNorm);
  });

  if (blueprint && blueprint.spec && blueprint.spec.steps && blueprint.spec.steps.length > 0) {
    let maxRiskScore = 25;
    let highestRiskAction = '';

    for (const step of blueprint.spec.steps) {
      const act = catalog.actions.find(a => a.id === step.action);
      const score = act ? (riskMap[act.riskDefault] || 50) : 50;
      if (score > maxRiskScore) {
        maxRiskScore = score;
        highestRiskAction = act ? `${act.id} (${act.riskDefault})` : step.action;
      }
    }

    return {
      riskScore: maxRiskScore,
      reason: `Blueprint ${blueprint.metadata.name} has ${blueprint.spec.steps.length} steps. Peak risk from ${highestRiskAction || 'steps'}`
    };
  }

  // 2. Check if objective matches a single Action primitive
  const action = catalog.actions.find(a => 
    objStr === a.id || 
    normalizedObj === a.id.toUpperCase().replace(/[-\s]/g, '_') ||
    a.id.includes(normalizedObj)
  );

  if (action) {
    const riskScore = riskMap[action.riskDefault] || 50;
    return {
      riskScore,
      reason: `Action primitive ${action.id} default risk: ${action.riskDefault}`
    };
  }

  return { riskScore: 50, reason: 'Unknown objective, default medium risk' };
}

export function validateDAGIntegrity(change) {
  const catalog = getCatalog();
  const objStr = String(change.objective || '');
  const normalizedObj = objStr.toUpperCase().replace(/[-\s]/g, '_');

  const blueprint = catalog.blueprints.find(b => {
    const bpNameNorm = b.metadata.name.toUpperCase().replace(/[-\s]/g, '_');
    return objStr === b.metadata.name || normalizedObj === bpNameNorm || normalizedObj.includes(bpNameNorm);
  });

  if (!blueprint || !blueprint.spec || !blueprint.spec.steps) {
    return { valid: true, errors: [] };
  }

  const steps = blueprint.spec.steps;
  const overrides = change.stepOverrides || [];
  const errors = [];
  const knownSteps = [];

  steps.forEach((step, idx) => {
    const actionId = typeof step === 'string' ? step : step.action;
    const action = catalog.actions.find(a => a.id === actionId);
    const stepId = step.stepId || (actionId ? actionId.toLowerCase().replace(/[^a-z0-9_]/g, '_') : `step_${idx + 1}`);

    const override = overrides.find(o => o.stepIndex === idx + 1 || o.action === actionId || o.stepId === stepId);
    const stepInputs = { ...(step.inputs || {}), ...((override && override.inputs) || {}) };

    for (const [, val] of Object.entries(stepInputs)) {
      if (typeof val === 'string') {
        const matches = [...val.matchAll(/\{\{\s*steps\.([a-zA-Z0-9_\-]+)\.([a-zA-Z0-9_\-]+)\s*\}\}/g)];
        for (const match of matches) {
          const referencedStepId = match[1];
          const referencedFact = match[2];

          const foundPrevStep = knownSteps.find(s => s.stepId === referencedStepId);
          if (!foundPrevStep) {
            errors.push(`Step ${idx + 1} (${stepId}) tham chiếu Step không tồn tại hoặc ở phía sau: 'steps.${referencedStepId}.${referencedFact}'`);
          } else {
            const hasFact = (foundPrevStep.outputs || []).some(o => o.name === referencedFact);
            if (!hasFact) {
              const avail = (foundPrevStep.outputs || []).map(o => o.name).join(', ') || 'none';
              errors.push(`Step ${idx + 1} (${stepId}) tham chiếu fact '${referencedFact}' không tồn tại trong Step '${referencedStepId}'. Các fact có sẵn: [${avail}]`);
            }
          }
        }
      }
    }

    knownSteps.push({
      stepIndex: idx + 1,
      stepId,
      actionId,
      outputs: action?.outputs || []
    });
  });

  return {
    valid: errors.length === 0,
    errors
  };
}

export function evaluatePolicy(change, riskScore) {
  // Rule 0: DAG Integrity Check - BLOCK nếu gãy tham chiếu biến (Dangling Reference)
  const dagCheck = validateDAGIntegrity(change);
  if (!dagCheck.valid) {
    return {
      result: 'BLOCK',
      reason: `DAG Integrity Violation: ${dagCheck.errors.join(' | ')}`
    };
  }

  // Rule 1: BLOCK nếu không có maintenance window cho action HIGH risk - kiểm tra TRƯỚC
  if (riskScore >= 60 && !change.constraints.maintenanceWindow) {
    return { 
      result: 'BLOCK', 
      reason: 'High risk operation requires maintenance window' 
    };
  }
  
  // Rule 2: HIGH risk còn lại (đã có maintenance window) thì cần APPROVAL
  if (riskScore >= 60) {
    return { 
      result: 'APPROVAL', 
      reason: 'Risk score >= 60 requires approval' 
    };
  }
  
  // Rule 3: AUTO cho risk thấp
  if (riskScore < 30) {
    return { 
      result: 'AUTO', 
      reason: 'Low risk, auto-approved' 
    };
  }
  
  // Default: APPROVAL cho medium risk
  return { 
    result: 'APPROVAL', 
    reason: 'Medium risk requires approval' 
  };
}
