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

export function evaluatePolicy(change, riskScore) {
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
