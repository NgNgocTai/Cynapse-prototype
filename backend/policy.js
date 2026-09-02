import { getCatalog } from './catalogStore.js';

export function calculateRisk(change) {
  const catalog = getCatalog();
  
  // Tìm blueprint liên quan (giả sử objective map tới blueprint name)
  const blueprint = catalog.blueprints.find(b => 
    change.objective.includes(b.metadata.name.toUpperCase().replace(/-/g, '_'))
  );
  
  if (!blueprint) {
    return { riskScore: 50, reason: 'Unknown objective, default medium risk' };
  }
  
  // Lấy action đầu tiên trong blueprint
  const actionId = blueprint.spec.steps[0].action;
  const action = catalog.actions.find(a => a.id === actionId);
  
  if (!action) {
    return { riskScore: 50, reason: 'Unknown action' };
  }
  
  // Map riskDefault text sang số
  const riskMap = {
    'LOW': 25,
    'MEDIUM': 50,
    'HIGH': 75,
    'CRITICAL': 95
  };
  
  const riskScore = riskMap[action.riskDefault] || 50;
  
  return { 
    riskScore, 
    reason: `Action ${action.id} has default risk: ${action.riskDefault}` 
  };
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
