// ============================================================
// Synapse v1.6 — Frontend Application
// Full E2E: Actions → Blueprints → Changes → Execute → Verify
// ============================================================

// Application State
const state = {
    currentView: 'home',
    currentRole: 'operator',
    changes: [],
    blueprints: [],
    actions: [],
    executions: [],
    executionLog: [],
    auditLog: [],
    activeChangeId: null,
    backendUrl: 'http://localhost:4000'
};

// Initialize App
document.addEventListener('DOMContentLoaded', async () => {
    initNavigation();
    initRoleSelector();
    
    // Load data from backend
    await loadInitialData();
    
    renderView('home');
});

// Load initial data from backend
async function loadInitialData() {
    try {
        // Load actions
        const actionsRes = await fetch(`${state.backendUrl}/api/actions`);
        if (actionsRes.ok) {
            state.actions = await actionsRes.json();
        }

        // Load changes
        const changesRes = await fetch(`${state.backendUrl}/api/changes`);
        if (changesRes.ok) {
            state.changes = await changesRes.json();
        }
        
        // Load blueprints (raw catalog format)
        const blueprintsRes = await fetch(`${state.backendUrl}/api/blueprints`);
        if (blueprintsRes.ok) {
            state.blueprints = await blueprintsRes.json();
        }
    } catch (error) {
        console.error('Failed to load initial data:', error);
        // Continue with empty state if backend not available
    }
}

// Navigation
function initNavigation() {
    const navLinks = document.querySelectorAll('.main-nav a');
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const view = link.dataset.view;
            
            // Update active state
            navLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');
            
            // Render view
            renderView(view);
        });
    });
}

// Role Selector
function initRoleSelector() {
    const roleSelect = document.getElementById('roleSelect');
    const currentRole = document.getElementById('currentRole');
    const userBadge = document.querySelector('.user-badge');
    
    roleSelect.addEventListener('change', (e) => {
        const roleMap = {
            'operator': { name: 'Network Operator', badge: 'O' },
            'bo': { name: 'BO Automation Engineer', badge: 'B' },
            'reviewer': { name: 'Automation Reviewer', badge: 'R' },
            'admin': { name: 'Platform Admin', badge: 'A' }
        };
        
        const role = roleMap[e.target.value];
        currentRole.textContent = role.name;
        userBadge.textContent = role.badge;
        state.currentRole = e.target.value;
    });
}

// View Renderer
function renderView(viewName) {
    state.currentView = viewName;
    const mainContent = document.getElementById('mainContent');
    
    const views = {
        home: renderHomeView,
        changes: renderChangesView,
        executions: renderExecutionsView,
        blueprints: renderBlueprintsView,
        actions: renderActionsView,
        audit: renderAuditView
    };
    
    const renderFunction = views[viewName] || renderHomeView;
    mainContent.innerHTML = renderFunction();
    
    // Attach event listeners after rendering
    attachViewEventListeners(viewName);
}

// ============================================================
// HOME VIEW — Dashboard with real metrics
// ============================================================
function renderHomeView() {
    const totalChanges = state.changes.length;
    const highRisk = state.changes.filter(c => c.riskScore >= 60).length;
    const running = state.changes.filter(c => c.state === 'Executing').length;
    const verified = state.changes.filter(c => c.state === 'Verified').length;

    return `
        <div class="view-header">
            <h2 class="card-title">Home</h2>
            <p style="color: #9ca3af; margin: 0.5rem 0 2rem 0;">Synapse — Network Automation Platform</p>
        </div>
        
        <div style="display: flex; gap: 1rem; margin-bottom: 2rem; flex-wrap: wrap;">
            <button class="btn btn-primary" onclick="renderView('actions')">→ Actions</button>
            <button class="btn btn-primary" onclick="renderView('blueprints')">→ Blueprints</button>
            <button class="btn btn-primary" onclick="openNewChangeModal()">+ New Change</button>
        </div>
        
        <div class="metrics-grid">
            <div class="metric-card">
                <div class="metric-label">Actions in Catalog</div>
                <div class="metric-value">${state.actions.length}</div>
                <div class="metric-subtitle">available</div>
            </div>
            <div class="metric-card">
                <div class="metric-label">Blueprints</div>
                <div class="metric-value">${state.blueprints.length}</div>
                <div class="metric-subtitle">${state.blueprints.filter(b => b.spec.status === 'PUBLISHED').length} published</div>
            </div>
            <div class="metric-card">
                <div class="metric-label">Changes</div>
                <div class="metric-value">${totalChanges}</div>
                <div class="metric-subtitle">${running} running${highRisk > 0 ? `, ${highRisk} high risk` : ''}</div>
            </div>
            <div class="metric-card">
                <div class="metric-label">Verified</div>
                <div class="metric-value" style="color: #6ee7b7;">${verified}</div>
                <div class="metric-subtitle">successful</div>
            </div>
        </div>
        
        <div class="card">
            <div class="card-header">
                <h3 class="card-title">Recent Changes</h3>
                <a href="#" style="color: #60a5fa; text-decoration: none; font-size: 0.875rem;" onclick="event.preventDefault(); renderView('changes')">View all →</a>
            </div>
            ${state.changes.length > 0 ? `
                <table class="table">
                    <thead>
                        <tr>
                            <th>Change</th>
                            <th>Objective</th>
                            <th>State</th>
                            <th>Risk</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${state.changes.slice(-5).reverse().map(change => `
                            <tr>
                                <td><a href="#" onclick="event.preventDefault(); viewChangeDetail('${change.id}')">${change.id}</a></td>
                                <td>${change.objective}</td>
                                <td><span class="badge badge-${getStateColor(change.state)}">${change.state}</span></td>
                                <td>${change.riskScore ? `<span class="risk-score risk-${getRiskLevel(change.riskScore)}" style="width: 35px; height: 35px; font-size: 0.75rem;">${change.riskScore}</span>` : '—'}</td>
                                <td>
                                    <button class="btn btn-secondary" style="padding: 0.25rem 0.75rem; font-size: 0.75rem;" onclick="viewChangeDetail('${change.id}')">View</button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            ` : `
                <div style="text-align: center; padding: 2rem; color: #9ca3af;">
                    No changes yet. Start by creating Actions and Blueprints in the Studio.
                </div>
            `}
        </div>

        <div class="card">
            <h3 class="card-title" style="margin-bottom: 1.5rem;">End-to-End Flow</h3>
            <div class="flow-diagram">
                <div class="flow-step" onclick="renderView('actions')" style="cursor:pointer;">1. Create Action<br><small style="color: #9ca3af;">+ AWX Template ID</small></div>
                <div class="flow-arrow">→</div>
                <div class="flow-step" onclick="renderView('blueprints')" style="cursor:pointer;">2. Create Blueprint<br><small style="color: #9ca3af;">select Actions</small></div>
                <div class="flow-arrow">→</div>
                <div class="flow-step" onclick="renderView('changes')" style="cursor:pointer;">3. New Change<br><small style="color: #9ca3af;">pick objective</small></div>
                <div class="flow-arrow">→</div>
                <div class="flow-step">4. Assess<br><small style="color: #9ca3af;">risk + policy</small></div>
                <div class="flow-arrow">→</div>
                <div class="flow-step">5. Approve<br><small style="color: #9ca3af;">manual</small></div>
                <div class="flow-arrow">→</div>
                <div class="flow-step">6. Execute<br><small style="color: #9ca3af;">AWX job</small></div>
                <div class="flow-arrow">→</div>
                <div class="flow-step">7. Verify<br><small style="color: #9ca3af;">result</small></div>
            </div>
        </div>
    `;
}

// ============================================================
// ACTIONS VIEW — Dynamic CRUD
// ============================================================
function renderActionsView() {
    return `
        <div class="view-header">
            <h2 class="card-title">Action Catalog</h2>
            <div style="display: flex; gap: 1rem;">
                <button class="btn btn-primary" onclick="openActionBuilderModal()" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
                    <span style="font-size: 1.2rem; margin-right: 0.5rem;">🔄</span>
                    Create from Template
                </button>
                <button class="btn btn-secondary" onclick="openNewActionModal()">+ Manual Entry</button>
            </div>
        </div>
        
        <div class="metrics-grid" style="margin-top: 2rem;">
            <div class="metric-card">
                <div class="metric-label">Total Actions</div>
                <div class="metric-value">${state.actions.length}</div>
            </div>
            <div class="metric-card">
                <div class="metric-label">From Templates</div>
                <div class="metric-value" style="color: #a78bfa;">${state.actions.filter(a => a.templateId).length}</div>
                <div class="metric-subtitle">auto-generated</div>
            </div>
            <div class="metric-card">
                <div class="metric-label">Domains</div>
                <div class="metric-value">${[...new Set(state.actions.map(a => a.domain))].length}</div>
                <div class="metric-subtitle">${[...new Set(state.actions.map(a => a.domain))].join(', ') || '—'}</div>
            </div>
            <div class="metric-card">
                <div class="metric-label">High Risk</div>
                <div class="metric-value" style="color: #fca5a5;">${state.actions.filter(a => a.riskDefault === 'HIGH' || a.riskDefault === 'CRITICAL').length}</div>
            </div>
        </div>
        
        <div class="card">
            <table class="table">
                <thead>
                    <tr>
                        <th>Action ID</th>
                        <th>Name</th>
                        <th>Domain</th>
                        <th>Capability</th>
                        <th>Provider</th>
                        <th>AWX Template</th>
                        <th>Risk</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${state.actions.length > 0 ? state.actions.map(action => `
                        <tr>
                            <td>
                                <code style="color: #60a5fa;">${action.id}</code>
                                ${action.templateId ? `<span class="badge badge-info" style="margin-left: 0.5rem; font-size: 0.65rem; background: #8b5cf6;">from template</span>` : ''}
                            </td>
                            <td>${action.name}</td>
                            <td><span class="badge badge-info">${action.domain}</span></td>
                            <td>${action.capability}</td>
                            <td>${action.implementation.provider}</td>
                            <td><code>#${action.implementation.awxJobTemplateId}</code></td>
                            <td><span class="badge badge-${action.riskDefault === 'HIGH' || action.riskDefault === 'CRITICAL' ? 'danger' : action.riskDefault === 'MEDIUM' ? 'warning' : 'success'}">${action.riskDefault}</span></td>
                            <td>
                                <button class="btn btn-secondary" style="padding: 0.25rem 0.75rem; font-size: 0.75rem;" onclick="openEditActionModal('${action.id}')">Edit</button>
                                <button class="btn btn-secondary" style="padding: 0.25rem 0.75rem; font-size: 0.75rem; color: #fca5a5;" onclick="confirmDeleteAction('${action.id}')">Delete</button>
                            </td>
                        </tr>
                    `).join('') : `
                        <tr>
                            <td colspan="8" style="text-align: center; color: #9ca3af; padding: 2rem;">
                                No actions yet. Click "Create from Template" to get started quickly!
                            </td>
                        </tr>
                    `}
                </tbody>
            </table>
        </div>
    `;
}

// ============================================================
// BLUEPRINTS VIEW — Dynamic CRUD
// ============================================================
function renderBlueprintsView() {
    const published = state.blueprints.filter(b => b.spec.status === 'PUBLISHED').length;
    const draft = state.blueprints.filter(b => b.spec.status === 'DRAFT').length;
    const inReview = state.blueprints.filter(b => b.spec.status === 'IN_REVIEW').length;

    return `
        <div class="view-header">
            <h2 class="card-title">Blueprints</h2>
            <button class="btn btn-primary" onclick="openNewBlueprintModal()">+ New Blueprint</button>
        </div>
        
        <div class="metrics-grid" style="margin-top: 2rem;">
            <div class="metric-card">
                <div class="metric-label">Total Blueprints</div>
                <div class="metric-value">${state.blueprints.length}</div>
            </div>
            <div class="metric-card">
                <div class="metric-label">Published</div>
                <div class="metric-value" style="color: #6ee7b7;">${published}</div>
            </div>
            <div class="metric-card">
                <div class="metric-label">Draft</div>
                <div class="metric-value" style="color: #fcd34d;">${draft}</div>
            </div>
            ${inReview > 0 ? `
            <div class="metric-card">
                <div class="metric-label">In Review</div>
                <div class="metric-value" style="color: #60a5fa;">${inReview}</div>
            </div>
            ` : ''}
        </div>
        
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 1.5rem;">
            ${state.blueprints.length > 0 ? state.blueprints.map(bp => `
                <div class="card" style="cursor: pointer; transition: all 0.2s; border-left: 3px solid ${bp.spec.status === 'PUBLISHED' ? '#6ee7b7' : bp.spec.status === 'DRAFT' ? '#fcd34d' : '#60a5fa'};" onclick="openEditBlueprintModal('${bp.metadata.name}')">
                    <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 1rem;">
                        <div>
                            <h3 style="font-size: 1.125rem; font-weight: 600; margin-bottom: 0.5rem;">${bp.metadata.name}</h3>
                            <div style="font-size: 0.875rem; color: #9ca3af;">v${bp.metadata.version}</div>
                        </div>
                        <span class="badge badge-${bp.spec.status === 'PUBLISHED' ? 'success' : bp.spec.status === 'DRAFT' ? 'warning' : 'info'}">${bp.spec.status}</span>
                    </div>
                    <div style="font-size: 0.875rem; color: #9ca3af; margin-bottom: 0.75rem;">Owner: ${bp.spec.owner}</div>
                    <div style="font-size: 0.875rem; color: #9ca3af; margin-bottom: 0.75rem;">Domain: ${bp.spec.domain}</div>
                    <div style="font-size: 0.8rem;">
                        <strong>Steps:</strong>
                        ${bp.spec.steps.map(s => `<code style="color: #60a5fa; margin-left: 0.25rem;">${s.action}</code>`).join(' → ')}
                    </div>
                </div>
            `).join('') : `
                <div class="card" style="text-align: center; color: #9ca3af; padding: 3rem;">
                    No blueprints yet. Create Actions first, then build Blueprints from them.
                </div>
            `}
        </div>
    `;
}

// ============================================================
// CHANGES VIEW — with inline action buttons
// ============================================================
function renderChangesView() {
    return `
        <div class="view-header">
            <h2 class="card-title">Changes</h2>
            <button class="btn btn-primary" onclick="openNewChangeModal()">+ New Change</button>
        </div>
        
        <div class="card" style="margin-top: 2rem;">
            <table class="table">
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>Objective</th>
                        <th>Target</th>
                        <th>Domain</th>
                        <th>State</th>
                        <th>Risk</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${state.changes.length > 0 ? state.changes.map(change => `
                        <tr>
                            <td><a href="#" onclick="event.preventDefault(); viewChangeDetail('${change.id}')">${change.id}</a></td>
                            <td><code>${change.objective}</code></td>
                            <td>${change.target}</td>
                            <td><span class="badge badge-info">${change.domain}</span></td>
                            <td><span class="badge badge-${getStateColor(change.state)}">${change.state}</span></td>
                            <td>${change.riskScore ? `<span class="risk-score risk-${getRiskLevel(change.riskScore)}" style="width: 35px; height: 35px; font-size: 0.75rem;">${change.riskScore}</span>` : '—'}</td>
                            <td style="display: flex; gap: 0.5rem; align-items: center;">
                                ${change.state === 'Draft' ? `<button class="btn btn-primary" style="padding: 0.25rem 0.75rem; font-size: 0.75rem;" onclick="assessChange('${change.id}')">Assess</button>` : ''}
                                ${change.state === 'Assessed' && change.policyResult === 'APPROVAL' ? `<button class="btn btn-success" style="padding: 0.25rem 0.75rem; font-size: 0.75rem;" onclick="approveChange('${change.id}')">✓ Approve</button>` : ''}
                                ${change.state === 'Assessed' && change.policyResult === 'AUTO_APPROVE' ? `<button class="btn btn-success" style="padding: 0.25rem 0.75rem; font-size: 0.75rem;" onclick="approveChange('${change.id}')">✓ Approve</button>` : ''}
                                ${change.state === 'Approved' ? `<button class="btn btn-success" style="padding: 0.25rem 0.75rem; font-size: 0.75rem;" onclick="executeChange('${change.id}')">▶ Execute</button>` : ''}
                                ${change.state === 'Executing' ? `<button class="btn btn-primary" style="padding: 0.25rem 0.75rem; font-size: 0.75rem;" onclick="executeChange('${change.id}')">📡 Monitor</button>` : ''}
                                ${change.state === 'Verified' ? `<span class="badge badge-success">✓ Done</span>` : ''}
                                ${change.state === 'Failed' ? `<span class="badge badge-danger">✗ Failed</span>` : ''}
                                ${change.state === 'Blocked' ? `<span class="badge badge-danger">🚫 Blocked</span>` : ''}
                                <button class="btn btn-secondary" style="padding: 0.25rem 0.5rem; font-size: 0.7rem;" onclick="viewChangeDetail('${change.id}')">···</button>
                            </td>
                        </tr>
                    `).join('') : `
                        <tr>
                            <td colspan="7" style="text-align: center; color: #9ca3af; padding: 2rem;">
                                No changes yet. Click "+ New Change" to start.
                            </td>
                        </tr>
                    `}
                </tbody>
            </table>
        </div>
    `;
}

// ============================================================
// EXECUTIONS VIEW — with stepper + activeChangeId
// ============================================================
function renderExecutionsView() {
    const changeId = state.activeChangeId || (state.changes.length > 0 ? state.changes[state.changes.length - 1].id : null);
    
    if (!changeId) {
        return `<div class="card"><p style="text-align: center; color: #9ca3af; padding: 2rem;">No changes available. Create a change first.</p></div>`;
    }
    
    const change = state.changes.find(c => c.id === changeId);
    
    if (!change) {
        return `<div class="card"><p style="text-align: center; color: #9ca3af; padding: 2rem;">Change ${changeId} not found</p></div>`;
    }
    
    const canExecute = change.state === 'Approved';
    const isBlocked = change.state === 'Blocked';
    const needsApproval = change.state === 'Assessed' && (change.policyResult === 'APPROVAL' || change.policyResult === 'AUTO_APPROVE');
    
    return `
        <div class="view-header">
            <h2 class="card-title">Execution — ${change.id}</h2>
            <div style="display: flex; gap: 1rem;">
                ${needsApproval ? `<button class="btn btn-primary" onclick="approveChange('${change.id}')">✓ Approve</button>` : ''}
                ${canExecute ? `<button class="btn btn-success" onclick="runExecution('${change.id}')">▶ Run Execution</button>` : ''}
                ${isBlocked ? `<button class="btn btn-danger" disabled>✗ Blocked</button>` : ''}
                ${change.state === 'Executing' ? `<span class="badge badge-info pulse" style="padding: 0.5rem 1rem;">⟳ Running...</span>` : ''}
                <button class="btn btn-secondary" onclick="renderView('changes')">← Back to Changes</button>
            </div>
        </div>
        
        <!-- Stepper -->
        ${renderStepper(change.state)}
        
        <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 1.5rem; margin-top: 1.5rem;">
            <div>
                <div class="card">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
                        <h3 class="card-title">Change Details</h3>
                        <span class="badge badge-${getStateColor(change.state)}">${change.state}</span>
                    </div>
                    <div style="font-size: 0.875rem; display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
                        <div><span style="color: #9ca3af;">Objective:</span> <code>${change.objective}</code></div>
                        <div><span style="color: #9ca3af;">Target:</span> ${change.target}</div>
                        <div><span style="color: #9ca3af;">Domain:</span> <span class="badge badge-info">${change.domain}</span></div>
                        <div><span style="color: #9ca3af;">Risk:</span> ${change.riskScore ? `<span class="risk-score risk-${getRiskLevel(change.riskScore)}" style="width: 30px; height: 30px; font-size: 0.7rem;">${change.riskScore}</span>` : '—'}</div>
                        ${change.policyResult ? `<div><span style="color: #9ca3af;">Policy:</span> ${change.policyResult}</div>` : ''}
                        ${isBlocked ? `<div style="color: #fca5a5; grid-column: 1/-1;"><strong>⚠ Blocked:</strong> High risk — requires maintenance window</div>` : ''}
                    </div>
                </div>
                
                <div class="card">
                    <h3 class="card-title" style="margin-bottom: 1rem;">Runtime Log</h3>
                    <div class="code-block" id="executionLog" style="min-height: 300px; max-height: 500px; overflow-y: auto; color: #6ee7b7;">
${state.executionLog.length > 0 ? state.executionLog.join('\n') : '[INFO] Ready to execute. Approve the change and click "Run Execution" to start...'}
                    </div>
                </div>
            </div>
            
            <div>
                <div class="card">
                    <h3 class="card-title" style="margin-bottom: 1rem;">Automation Details</h3>
                    ${(() => {
                        const action = state.actions.find(a => a.id === change.objective);
                        if (!action) return `<div style="color: #9ca3af;">Action not found for objective: ${change.objective}</div>`;
                        return `
                            <div style="margin-bottom: 0.75rem;">
                                <div style="color: #9ca3af; font-size: 0.875rem;">Action</div>
                                <div style="margin-top: 0.25rem; font-family: monospace; font-size: 0.875rem; color: #60a5fa;">${action.id}</div>
                            </div>
                            <div style="margin-bottom: 0.75rem;">
                                <div style="color: #9ca3af; font-size: 0.875rem;">Provider</div>
                                <div style="margin-top: 0.25rem;">${action.implementation.provider} via AWX</div>
                            </div>
                            <div style="margin-bottom: 0.75rem;">
                                <div style="color: #9ca3af; font-size: 0.875rem;">AWX Job Template</div>
                                <div style="margin-top: 0.25rem;">#${action.implementation.awxJobTemplateId}</div>
                            </div>
                            <div style="margin-bottom: 0.75rem;">
                                <div style="color: #9ca3af; font-size: 0.875rem;">Estimated Duration</div>
                                <div style="margin-top: 0.25rem;">${Math.round(action.implementation.estimatedDurationSec / 60)} minutes</div>
                            </div>
                            <div>
                                <div style="color: #9ca3af; font-size: 0.875rem;">Risk Default</div>
                                <div style="margin-top: 0.25rem;"><span class="badge badge-${action.riskDefault === 'HIGH' || action.riskDefault === 'CRITICAL' ? 'danger' : action.riskDefault === 'MEDIUM' ? 'warning' : 'success'}">${action.riskDefault}</span></div>
                            </div>
                        `;
                    })()}
                </div>
            </div>
        </div>
    `;
}

// ============================================================
// STEPPER — Change lifecycle visualization
// ============================================================
function renderStepper(currentState) {
    const steps = [
        { key: 'Draft', label: 'Created', icon: '📝' },
        { key: 'Assessed', label: 'Assessed', icon: '🔍' },
        { key: 'Approved', label: 'Approved', icon: '✓' },
        { key: 'Executing', label: 'Executing', icon: '⚡' },
        { key: 'Verified', label: 'Verified', icon: '✅' }
    ];
    
    const stateOrder = { 'Draft': 0, 'Assessed': 1, 'Blocked': 1, 'Approved': 2, 'Executing': 3, 'Verified': 4, 'Failed': 4 };
    const currentIndex = stateOrder[currentState] ?? 0;
    const isFailed = currentState === 'Failed';
    const isBlocked = currentState === 'Blocked';
    
    return `
        <div class="stepper" style="margin-top: 1.5rem;">
            ${steps.map((step, i) => {
                let cls = 'stepper-step';
                if (i < currentIndex) cls += ' completed';
                else if (i === currentIndex) cls += (isFailed ? ' failed' : isBlocked ? ' blocked' : ' active');
                
                return `
                    <div class="${cls}">
                        <div class="stepper-icon">${i < currentIndex ? '✓' : (i === currentIndex && isFailed) ? '✗' : (i === currentIndex && isBlocked) ? '🚫' : step.icon}</div>
                        <div class="stepper-label">${step.label}${i === currentIndex && isFailed ? ' (Failed)' : ''}${i === currentIndex && isBlocked ? ' (Blocked)' : ''}</div>
                    </div>
                    ${i < steps.length - 1 ? `<div class="stepper-line ${i < currentIndex ? 'completed' : ''}"></div>` : ''}
                `;
            }).join('')}
        </div>
    `;
}

// ============================================================
// AUDIT VIEW — Timeline from /api/audit
// ============================================================
function renderAuditView() {
    return `
        <div class="view-header">
            <h2 class="card-title">Audit Trail</h2>
            <button class="btn btn-secondary" onclick="loadAuditLog()">↻ Refresh</button>
        </div>
        
        <div class="card" style="margin-top: 2rem;">
            <div id="auditContent">
                <div style="text-align: center; color: #9ca3af; padding: 2rem;">Loading audit log...</div>
            </div>
        </div>
    `;
}

async function loadAuditLog() {
    try {
        const res = await fetch(`${state.backendUrl}/api/audit`);
        if (!res.ok) throw new Error('Failed to load audit');
        state.auditLog = await res.json();
        renderAuditTable();
    } catch (error) {
        document.getElementById('auditContent').innerHTML = `<div style="color: #fca5a5; padding: 1rem;">Failed to load audit log: ${error.message}</div>`;
    }
}

function renderAuditTable() {
    const container = document.getElementById('auditContent');
    if (!container) return;
    
    if (state.auditLog.length === 0) {
        container.innerHTML = '<div style="text-align: center; color: #9ca3af; padding: 2rem;">No audit entries yet. Create and execute a change to see events here.</div>';
        return;
    }
    
    container.innerHTML = `
        <table class="table">
            <thead>
                <tr>
                    <th>Time</th>
                    <th>Object</th>
                    <th>ID</th>
                    <th>Action</th>
                    <th>Actor</th>
                    <th>Result</th>
                    <th>Detail</th>
                </tr>
            </thead>
            <tbody>
                ${state.auditLog.slice().reverse().map(entry => `
                    <tr>
                        <td style="white-space: nowrap; font-size: 0.8rem; color: #9ca3af;">${new Date(entry.timestamp).toLocaleString()}</td>
                        <td><span class="badge badge-info">${entry.object || '—'}</span></td>
                        <td><code style="color: #60a5fa;">${entry.objectId || '—'}</code></td>
                        <td>${entry.action || '—'}</td>
                        <td>${entry.actor || '—'}</td>
                        <td><span class="badge badge-${entry.result === 'success' ? 'success' : 'danger'}">${entry.result || '—'}</span></td>
                        <td style="font-size: 0.8rem; color: #9ca3af; max-width: 300px; overflow: hidden; text-overflow: ellipsis;">${entry.detail || '—'}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

// ============================================================
// MODAL — New Action
// ============================================================
function openNewActionModal() {
    const modal = `
        <div class="modal-overlay" onclick="closeModal(event)">
            <div class="modal" onclick="event.stopPropagation()" style="max-width: 600px;">
                <div class="modal-header">
                    <h2 class="modal-title">New Action</h2>
                    <button class="modal-close" onclick="closeModal()">&times;</button>
                </div>
                <div class="modal-body">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                        <div>
                            <label class="form-label">Action ID *</label>
                            <input type="text" id="actionId" class="form-input" placeholder="e.g., SERVICE_HEALTH_CHECK">
                            <div style="font-size: 0.7rem; color: #6b7280; margin-top: 0.25rem;">UPPER_SNAKE_CASE</div>
                        </div>
                        <div>
                            <label class="form-label">Display Name *</label>
                            <input type="text" id="actionName" class="form-input" placeholder="e.g., Service Health Check">
                        </div>
                    </div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-top: 1rem;">
                        <div>
                            <label class="form-label">Domain *</label>
                            <select id="actionDomain" class="form-input">
                                <option value="CNTT">CNTT</option>
                                <option value="IP">IP / Backbone</option>
                                <option value="5G">5G Core</option>
                                <option value="Transport">Transport</option>
                            </select>
                        </div>
                        <div>
                            <label class="form-label">Capability *</label>
                            <input type="text" id="actionCapability" class="form-input" placeholder="e.g., HEALTH_CHECK">
                        </div>
                    </div>
                    
                    <div style="margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid #374151;">
                        <h4 style="font-size: 0.875rem; color: #9ca3af; margin-bottom: 1rem;">AWX Integration</h4>
                        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1rem;">
                            <div>
                                <label class="form-label">Provider</label>
                                <select id="actionProvider" class="form-input">
                                    <option value="ansible">Ansible</option>
                                    <option value="netconf">NETCONF</option>
                                    <option value="nephio">Nephio</option>
                                    <option value="opentofu">OpenTofu</option>
                                </select>
                            </div>
                            <div>
                                <label class="form-label">Job Template ID *</label>
                                <input type="number" id="actionTemplateId" class="form-input" placeholder="e.g., 10" min="1">
                            </div>
                            <div>
                                <label class="form-label">Est. Duration (s)</label>
                                <input type="number" id="actionDuration" class="form-input" placeholder="300" value="300" min="1">
                            </div>
                        </div>
                    </div>
                    
                    <div style="margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid #374151;">
                        <h4 style="font-size: 0.875rem; color: #9ca3af; margin-bottom: 1rem;">Risk & Compensation</h4>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                            <div>
                                <label class="form-label">Default Risk</label>
                                <select id="actionRisk" class="form-input">
                                    <option value="LOW">LOW</option>
                                    <option value="MEDIUM" selected>MEDIUM</option>
                                    <option value="HIGH">HIGH</option>
                                    <option value="CRITICAL">CRITICAL</option>
                                </select>
                            </div>
                            <div>
                                <label class="form-label">Compensation</label>
                                <select id="actionCompensation" class="form-input">
                                    <option value="NOTIFY_ONCALL">NOTIFY_ONCALL (escalate)</option>
                                </select>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
                    <button class="btn btn-primary" onclick="createAction()">Create Action</button>
                </div>
            </div>
        </div>
    `;
    document.getElementById('modalContainer').innerHTML = modal;
}

function openEditActionModal(actionId) {
    const action = state.actions.find(a => a.id === actionId);
    if (!action) return;

    const modal = `
        <div class="modal-overlay" onclick="closeModal(event)">
            <div class="modal" onclick="event.stopPropagation()" style="max-width: 600px;">
                <div class="modal-header">
                    <h2 class="modal-title">Edit Action: ${action.id}</h2>
                    <button class="modal-close" onclick="closeModal()">&times;</button>
                </div>
                <div class="modal-body">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                        <div>
                            <label class="form-label">Action ID</label>
                            <input type="text" id="actionId" class="form-input" value="${action.id}" disabled style="opacity: 0.5;">
                        </div>
                        <div>
                            <label class="form-label">Display Name *</label>
                            <input type="text" id="actionName" class="form-input" value="${action.name}">
                        </div>
                    </div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-top: 1rem;">
                        <div>
                            <label class="form-label">Domain *</label>
                            <select id="actionDomain" class="form-input">
                                ${['CNTT', 'IP', '5G', 'Transport'].map(d => `<option value="${d}" ${action.domain === d ? 'selected' : ''}>${d}</option>`).join('')}
                            </select>
                        </div>
                        <div>
                            <label class="form-label">Capability *</label>
                            <input type="text" id="actionCapability" class="form-input" value="${action.capability}">
                        </div>
                    </div>
                    
                    <div style="margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid #374151;">
                        <h4 style="font-size: 0.875rem; color: #9ca3af; margin-bottom: 1rem;">AWX Integration</h4>
                        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1rem;">
                            <div>
                                <label class="form-label">Provider</label>
                                <select id="actionProvider" class="form-input">
                                    ${['ansible', 'netconf', 'nephio', 'opentofu'].map(p => `<option value="${p}" ${action.implementation.provider === p ? 'selected' : ''}>${p}</option>`).join('')}
                                </select>
                            </div>
                            <div>
                                <label class="form-label">Job Template ID *</label>
                                <input type="number" id="actionTemplateId" class="form-input" value="${action.implementation.awxJobTemplateId}" min="1">
                            </div>
                            <div>
                                <label class="form-label">Est. Duration (s)</label>
                                <input type="number" id="actionDuration" class="form-input" value="${action.implementation.estimatedDurationSec}" min="1">
                            </div>
                        </div>
                    </div>
                    
                    <div style="margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid #374151;">
                        <h4 style="font-size: 0.875rem; color: #9ca3af; margin-bottom: 1rem;">Risk & Compensation</h4>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                            <div>
                                <label class="form-label">Default Risk</label>
                                <select id="actionRisk" class="form-input">
                                    ${['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map(r => `<option value="${r}" ${action.riskDefault === r ? 'selected' : ''}>${r}</option>`).join('')}
                                </select>
                            </div>
                            <div>
                                <label class="form-label">Compensation</label>
                                <select id="actionCompensation" class="form-input">
                                    <option value="NOTIFY_ONCALL">NOTIFY_ONCALL (escalate)</option>
                                </select>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" style="color: #fca5a5;" onclick="confirmDeleteAction('${action.id}')">Delete</button>
                    <div style="flex: 1;"></div>
                    <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
                    <button class="btn btn-primary" onclick="saveAction('${action.id}')">Save Changes</button>
                </div>
            </div>
        </div>
    `;
    document.getElementById('modalContainer').innerHTML = modal;
}

async function createAction() {
    const payload = getActionFormData();
    if (!payload) return;

    try {
        const res = await fetch(`${state.backendUrl}/api/actions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            const err = await res.json();
            alert('Error: ' + err.error);
            return;
        }

        const action = await res.json();
        state.actions.push(action);
        closeModal();
        renderView('actions');
    } catch (error) {
        alert('Failed to create action: ' + error.message);
    }
}

async function saveAction(actionId) {
    const payload = getActionFormData();
    if (!payload) return;

    try {
        const res = await fetch(`${state.backendUrl}/api/actions/${actionId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            const err = await res.json();
            alert('Error: ' + err.error);
            return;
        }

        const action = await res.json();
        const idx = state.actions.findIndex(a => a.id === actionId);
        if (idx >= 0) state.actions[idx] = action;
        closeModal();
        renderView('actions');
    } catch (error) {
        alert('Failed to update action: ' + error.message);
    }
}

async function confirmDeleteAction(actionId) {
    if (!confirm(`Delete action "${actionId}"? This cannot be undone.`)) return;

    try {
        const res = await fetch(`${state.backendUrl}/api/actions/${actionId}`, {
            method: 'DELETE'
        });

        if (!res.ok) {
            const err = await res.json();
            alert('Error: ' + err.error);
            return;
        }

        state.actions = state.actions.filter(a => a.id !== actionId);
        closeModal();
        renderView('actions');
    } catch (error) {
        alert('Failed to delete action: ' + error.message);
    }
}

function getActionFormData() {
    const id = document.getElementById('actionId').value.trim();
    const name = document.getElementById('actionName').value.trim();
    const domain = document.getElementById('actionDomain').value;
    const capability = document.getElementById('actionCapability').value.trim();
    const provider = document.getElementById('actionProvider').value;
    const templateId = parseInt(document.getElementById('actionTemplateId').value);
    const duration = parseInt(document.getElementById('actionDuration').value) || 300;
    const risk = document.getElementById('actionRisk').value;

    if (!id || !name || !capability || !templateId) {
        alert('Please fill in all required fields (marked with *)');
        return null;
    }

    return {
        id, name, domain, capability,
        implementation: {
            provider,
            awxJobTemplateId: templateId,
            estimatedDurationSec: duration
        },
        riskDefault: risk,
        verification: { type: 'embedded', note: 'Playbook self-verifies' },
        compensation: { type: 'escalate', action: 'NOTIFY_ONCALL' }
    };
}

// ============================================================
// MODAL — New/Edit Blueprint
// ============================================================
function openNewBlueprintModal() {
    if (state.actions.length === 0) {
        alert('No actions in catalog. Create an Action first before building a Blueprint.');
        return;
    }

    const modal = `
        <div class="modal-overlay" onclick="closeModal(event)">
            <div class="modal" onclick="event.stopPropagation()" style="max-width: 550px;">
                <div class="modal-header">
                    <h2 class="modal-title">New Blueprint</h2>
                    <button class="modal-close" onclick="closeModal()">&times;</button>
                </div>
                <div class="modal-body">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                        <div>
                            <label class="form-label">Blueprint Name *</label>
                            <input type="text" id="bpName" class="form-input" placeholder="e.g., service-health-check">
                            <div style="font-size: 0.7rem; color: #6b7280; margin-top: 0.25rem;">kebab-case</div>
                        </div>
                        <div>
                            <label class="form-label">Version *</label>
                            <input type="text" id="bpVersion" class="form-input" value="1.0">
                        </div>
                    </div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-top: 1rem;">
                        <div>
                            <label class="form-label">Owner *</label>
                            <input type="text" id="bpOwner" class="form-input" placeholder="e.g., CNTT-BO">
                        </div>
                        <div>
                            <label class="form-label">Domain *</label>
                            <select id="bpDomain" class="form-input">
                                <option value="CNTT">CNTT</option>
                                <option value="IP">IP / Backbone</option>
                                <option value="5G">5G Core</option>
                                <option value="Transport">Transport</option>
                            </select>
                        </div>
                    </div>
                    
                    <div style="margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid #374151;">
                        <h4 style="font-size: 0.875rem; color: #9ca3af; margin-bottom: 1rem;">Steps (select Actions)</h4>
                        <div id="bpStepsContainer" style="max-height: 200px; overflow-y: auto;">
                            ${state.actions.map(a => `
                                <label style="display: flex; align-items: center; gap: 0.75rem; padding: 0.5rem; background: #1f2937; border-radius: 0.375rem; margin-bottom: 0.5rem; cursor: pointer;">
                                    <input type="checkbox" class="bp-step-checkbox" value="${a.id}" style="width: auto;">
                                    <div>
                                        <div style="font-weight: 600;">${a.id}</div>
                                        <div style="font-size: 0.75rem; color: #9ca3af;">${a.name} · ${a.domain} · Risk: ${a.riskDefault}</div>
                                    </div>
                                </label>
                            `).join('')}
                        </div>
                    </div>
                    
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid #374151;">
                        <div>
                            <label class="form-label">On Failure</label>
                            <select id="bpCompensation" class="form-input">
                                <option value="NOTIFY_ONCALL">NOTIFY_ONCALL</option>
                            </select>
                        </div>
                        <div>
                            <label class="form-label">Status</label>
                            <select id="bpStatus" class="form-input">
                                <option value="DRAFT">DRAFT</option>
                                <option value="IN_REVIEW">IN_REVIEW</option>
                                <option value="PUBLISHED" selected>PUBLISHED</option>
                            </select>
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
                    <button class="btn btn-primary" onclick="createBlueprint()">Create Blueprint</button>
                </div>
            </div>
        </div>
    `;
    document.getElementById('modalContainer').innerHTML = modal;
}

function openEditBlueprintModal(bpName) {
    const bp = state.blueprints.find(b => b.metadata.name === bpName);
    if (!bp) return;

    const stepActionIds = bp.spec.steps.map(s => s.action);

    const modal = `
        <div class="modal-overlay" onclick="closeModal(event)">
            <div class="modal" onclick="event.stopPropagation()" style="max-width: 550px;">
                <div class="modal-header">
                    <h2 class="modal-title">Edit Blueprint: ${bpName}</h2>
                    <button class="modal-close" onclick="closeModal()">&times;</button>
                </div>
                <div class="modal-body">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                        <div>
                            <label class="form-label">Blueprint Name</label>
                            <input type="text" id="bpName" class="form-input" value="${bpName}" disabled style="opacity: 0.5;">
                        </div>
                        <div>
                            <label class="form-label">Version *</label>
                            <input type="text" id="bpVersion" class="form-input" value="${bp.metadata.version}">
                        </div>
                    </div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-top: 1rem;">
                        <div>
                            <label class="form-label">Owner *</label>
                            <input type="text" id="bpOwner" class="form-input" value="${bp.spec.owner}">
                        </div>
                        <div>
                            <label class="form-label">Domain *</label>
                            <select id="bpDomain" class="form-input">
                                ${['CNTT', 'IP', '5G', 'Transport'].map(d => `<option value="${d}" ${bp.spec.domain === d ? 'selected' : ''}>${d}</option>`).join('')}
                            </select>
                        </div>
                    </div>
                    
                    <div style="margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid #374151;">
                        <h4 style="font-size: 0.875rem; color: #9ca3af; margin-bottom: 1rem;">Steps (select Actions)</h4>
                        <div id="bpStepsContainer" style="max-height: 200px; overflow-y: auto;">
                            ${state.actions.map(a => `
                                <label style="display: flex; align-items: center; gap: 0.75rem; padding: 0.5rem; background: #1f2937; border-radius: 0.375rem; margin-bottom: 0.5rem; cursor: pointer;">
                                    <input type="checkbox" class="bp-step-checkbox" value="${a.id}" ${stepActionIds.includes(a.id) ? 'checked' : ''} style="width: auto;">
                                    <div>
                                        <div style="font-weight: 600;">${a.id}</div>
                                        <div style="font-size: 0.75rem; color: #9ca3af;">${a.name} · ${a.domain} · Risk: ${a.riskDefault}</div>
                                    </div>
                                </label>
                            `).join('')}
                        </div>
                    </div>
                    
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid #374151;">
                        <div>
                            <label class="form-label">On Failure</label>
                            <select id="bpCompensation" class="form-input">
                                <option value="NOTIFY_ONCALL">NOTIFY_ONCALL</option>
                            </select>
                        </div>
                        <div>
                            <label class="form-label">Status</label>
                            <select id="bpStatus" class="form-input">
                                ${['DRAFT', 'IN_REVIEW', 'PUBLISHED'].map(s => `<option value="${s}" ${bp.spec.status === s ? 'selected' : ''}>${s}</option>`).join('')}
                            </select>
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" style="color: #fca5a5;" onclick="confirmDeleteBlueprint('${bpName}')">Delete</button>
                    <div style="flex: 1;"></div>
                    <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
                    <button class="btn btn-primary" onclick="saveBlueprint('${bpName}')">Save Changes</button>
                </div>
            </div>
        </div>
    `;
    document.getElementById('modalContainer').innerHTML = modal;
}

async function createBlueprint() {
    const payload = getBlueprintFormData();
    if (!payload) return;

    try {
        const res = await fetch(`${state.backendUrl}/api/blueprints`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            const err = await res.json();
            alert('Error: ' + err.error);
            return;
        }

        const bp = await res.json();
        state.blueprints.push(bp);
        closeModal();
        renderView('blueprints');
    } catch (error) {
        alert('Failed to create blueprint: ' + error.message);
    }
}

async function saveBlueprint(bpName) {
    const payload = getBlueprintFormData();
    if (!payload) return;

    try {
        const res = await fetch(`${state.backendUrl}/api/blueprints/${bpName}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            const err = await res.json();
            alert('Error: ' + err.error);
            return;
        }

        const bp = await res.json();
        const idx = state.blueprints.findIndex(b => b.metadata.name === bpName);
        if (idx >= 0) state.blueprints[idx] = bp;
        closeModal();
        renderView('blueprints');
    } catch (error) {
        alert('Failed to update blueprint: ' + error.message);
    }
}

async function confirmDeleteBlueprint(bpName) {
    if (!confirm(`Delete blueprint "${bpName}"? This cannot be undone.`)) return;

    try {
        const res = await fetch(`${state.backendUrl}/api/blueprints/${bpName}`, {
            method: 'DELETE'
        });

        if (!res.ok) {
            const err = await res.json();
            alert('Error: ' + err.error);
            return;
        }

        state.blueprints = state.blueprints.filter(b => b.metadata.name !== bpName);
        closeModal();
        renderView('blueprints');
    } catch (error) {
        alert('Failed to delete blueprint: ' + error.message);
    }
}

function getBlueprintFormData() {
    const name = document.getElementById('bpName').value.trim();
    const version = document.getElementById('bpVersion').value.trim();
    const owner = document.getElementById('bpOwner').value.trim();
    const domain = document.getElementById('bpDomain').value;
    const compensation = document.getElementById('bpCompensation').value;
    const status = document.getElementById('bpStatus').value;
    
    const steps = Array.from(document.querySelectorAll('.bp-step-checkbox:checked')).map(cb => cb.value);

    if (!name || !version || !owner) {
        alert('Please fill in all required fields (marked with *)');
        return null;
    }

    if (steps.length === 0) {
        alert('Please select at least one Action for the blueprint steps.');
        return null;
    }

    return {
        name, version, owner, domain, steps,
        compensationOnFailure: compensation,
        status
    };
}

// ============================================================
// MODAL — New Change (with dropdown objective)
// ============================================================
function openNewChangeModal() {
    if (state.actions.length === 0) {
        alert('No actions in catalog. Create an Action first.');
        return;
    }

    const modal = `
        <div class="modal-overlay" onclick="closeModal(event)">
            <div class="modal" onclick="event.stopPropagation()">
                <div class="modal-header">
                    <h2 class="modal-title">New Change Request</h2>
                    <button class="modal-close" onclick="closeModal()">&times;</button>
                </div>
                <div class="modal-body">
                    <div style="margin-bottom: 1rem;">
                        <label class="form-label">Objective (Action) *</label>
                        <select id="objectiveInput" class="form-input">
                            ${state.actions.map(a => `<option value="${a.id}">${a.name} (${a.id})</option>`).join('')}
                        </select>
                    </div>
                    <div style="margin-bottom: 1rem;">
                        <label class="form-label">Target Hosts *</label>
                        <input type="text" id="targetInput" class="form-input" placeholder="e.g., db_servers" value="db_servers">
                    </div>
                    <div style="margin-bottom: 1rem;">
                        <label class="form-label">Domain</label>
                        <select id="domainInput" class="form-input">
                            <option value="CNTT">CNTT</option>
                            <option value="IP">IP / Backbone</option>
                            <option value="5G">5G Core</option>
                            <option value="Transport">Transport</option>
                        </select>
                    </div>
                    <div style="margin-bottom: 1rem;">
                        <label style="display: flex; align-items: center; gap: 0.5rem; color: #d1d5db;">
                            <input type="checkbox" id="maintenanceWindowInput" style="width: auto;">
                            <span>Maintenance Window</span>
                        </label>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
                    <button class="btn btn-primary" onclick="createChange()">Create Change</button>
                </div>
            </div>
        </div>
    `;
    document.getElementById('modalContainer').innerHTML = modal;
}

// ============================================================
// SHARED — Helpers, Modals, Event Handlers
// ============================================================

function closeModal(event) {
    if (!event || event.target.classList.contains('modal-overlay')) {
        document.getElementById('modalContainer').innerHTML = '';
    }
}

function getStateColor(state) {
    const colors = {
        'Draft': 'info',
        'Assessed': 'warning',
        'Blocked': 'danger',
        'Approved': 'success',
        'Executing': 'info',
        'Verified': 'success',
        'Failed': 'danger'
    };
    return colors[state] || 'info';
}

function getRiskLevel(risk) {
    if (risk < 30) return 'low';
    if (risk < 60) return 'medium';
    return 'high';
}

function attachViewEventListeners(viewName) {
    if (viewName === 'audit') {
        loadAuditLog();
    }
}

function switchRole(role) {
    const roleSelect = document.getElementById('roleSelect');
    roleSelect.value = role;
    roleSelect.dispatchEvent(new Event('change'));
}

// ============================================================
// CHANGE OPERATIONS — Assess, Approve, Execute
// ============================================================

async function assessChange(changeId) {
    try {
        const res = await fetch(`${state.backendUrl}/api/changes/${changeId}/assess`, {
            method: 'POST'
        });
        
        if (res.ok) {
            const result = await res.json();
            const change = state.changes.find(c => c.id === changeId);
            if (change) {
                change.riskScore = result.riskScore;
                change.policyResult = result.policyResult;
                change.state = result.policyResult === 'BLOCK' ? 'Blocked' : 'Assessed';
            }
            renderView(state.currentView);
        }
    } catch (error) {
        console.error('Assess error:', error);
    }
}

async function approveChange(changeId) {
    try {
        const res = await fetch(`${state.backendUrl}/api/changes/${changeId}/approve`, {
            method: 'POST'
        });
        
        if (res.ok) {
            const change = state.changes.find(c => c.id === changeId);
            if (change) {
                change.state = 'Approved';
            }
            renderView(state.currentView);
        }
    } catch (error) {
        console.error('Approve error:', error);
        alert('Failed to approve change');
    }
}

function executeChange(changeId) {
    state.activeChangeId = changeId;
    state.executionLog = [];
    renderView('executions');
}

async function createChange() {
    const objective = document.getElementById('objectiveInput').value;
    const target = document.getElementById('targetInput').value;
    const domain = document.getElementById('domainInput').value;
    const maintenanceWindow = document.getElementById('maintenanceWindowInput').checked;

    if (!objective || !target) {
        alert('Please fill in all required fields');
        return;
    }

    try {
        const res = await fetch(`${state.backendUrl}/api/changes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                objective, 
                target, 
                domain,
                constraints: { maintenanceWindow }
            })
        });
        
        if (!res.ok) {
            alert('Failed to create change');
            return;
        }

        const change = await res.json();
        state.changes.push(change);
        closeModal();
        renderView('changes');
        
        // Auto-assess the new change
        assessChange(change.id);
    } catch (error) {
        console.error('Create change error:', error);
        alert('Failed to create change: ' + error.message);
    }
}

function viewChangeDetail(changeId) {
    const change = state.changes.find(c => c.id === changeId);
    if (!change) return;
    
    const action = state.actions.find(a => a.id === change.objective);

    const modal = `
        <div class="modal-overlay" onclick="closeModal(event)">
            <div class="modal" onclick="event.stopPropagation()">
                <div class="modal-header">
                    <h2 class="modal-title">Change ${change.id}</h2>
                    <button class="modal-close" onclick="closeModal()">&times;</button>
                </div>
                <div class="modal-body">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.5rem;">
                        <div>
                            <div style="color: #9ca3af; font-size: 0.875rem;">Objective</div>
                            <div style="font-weight: 600; margin-top: 0.25rem;"><code>${change.objective}</code></div>
                        </div>
                        <div>
                            <div style="color: #9ca3af; font-size: 0.875rem;">State</div>
                            <div style="margin-top: 0.25rem;"><span class="badge badge-${getStateColor(change.state)}">${change.state}</span></div>
                        </div>
                        <div>
                            <div style="color: #9ca3af; font-size: 0.875rem;">Target</div>
                            <div style="margin-top: 0.25rem;">${change.target}</div>
                        </div>
                        <div>
                            <div style="color: #9ca3af; font-size: 0.875rem;">Domain</div>
                            <div style="margin-top: 0.25rem;"><span class="badge badge-info">${change.domain}</span></div>
                        </div>
                        ${change.riskScore ? `
                        <div>
                            <div style="color: #9ca3af; font-size: 0.875rem;">Risk Score</div>
                            <div style="margin-top: 0.25rem;"><span class="risk-score risk-${getRiskLevel(change.riskScore)}" style="width: 35px; height: 35px; font-size: 0.75rem;">${change.riskScore}</span></div>
                        </div>
                        ` : ''}
                        ${change.policyResult ? `
                        <div>
                            <div style="color: #9ca3af; font-size: 0.875rem;">Policy</div>
                            <div style="margin-top: 0.25rem;">${change.policyResult}</div>
                        </div>
                        ` : ''}
                    </div>
                    ${action ? `
                    <div style="background: #0a0e1a; padding: 1rem; border-radius: 0.375rem;">
                        <h4 style="font-size: 0.875rem; color: #9ca3af; margin-bottom: 0.75rem;">Linked Action</h4>
                        <div style="font-size: 0.875rem;">
                            <div><strong>${action.name}</strong> (${action.id})</div>
                            <div style="color: #9ca3af; margin-top: 0.25rem;">${action.implementation.provider} · AWX #${action.implementation.awxJobTemplateId} · ~${Math.round(action.implementation.estimatedDurationSec / 60)} min</div>
                        </div>
                    </div>
                    ` : ''}
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="closeModal()">Close</button>
                    ${change.state === 'Assessed' && change.policyResult === 'APPROVAL' ? `<button class="btn btn-primary" onclick="closeModal(); approveChange('${change.id}')">✓ Approve</button>` : ''}
                    ${change.state === 'Approved' ? `<button class="btn btn-primary" onclick="closeModal(); executeChange('${change.id}')">▶ Execute</button>` : ''}
                    ${change.state === 'Executing' || change.state === 'Verified' || change.state === 'Failed' ? `<button class="btn btn-primary" onclick="closeModal(); executeChange('${change.id}')">View Execution</button>` : ''}
                </div>
            </div>
        </div>
    `;
    document.getElementById('modalContainer').innerHTML = modal;
}

// ============================================================
// EXECUTION — AWX Job Launch + Poll
// ============================================================

async function runExecution(changeId) {
    state.executionLog = ['[INFO] Requesting plan resolve...'];
    updateExecutionLog();

    try {
        // Step 1: Resolve Plan
        const planRes = await fetch(`${state.backendUrl}/api/changes/${changeId}/resolve-plan`, { 
            method: 'POST' 
        });
        
        if (!planRes.ok) {
            const error = await planRes.json();
            state.executionLog.push(`[ERROR] Failed to resolve plan: ${error.error}`);
            updateExecutionLog();
            return;
        }
        
        const plan = await planRes.json();
        state.executionLog.push(`[INFO] Plan resolved: ${plan.planId}`);
        state.executionLog.push(`[INFO] Blueprint: ${plan.blueprint}`);
        updateExecutionLog();

        // Step 2: Execute Plan (launch AWX job)
        const execRes = await fetch(`${state.backendUrl}/api/plans/${plan.planId}/execute`, { 
            method: 'POST' 
        });
        
        if (!execRes.ok) {
            const error = await execRes.json();
            state.executionLog.push(`[ERROR] Failed to execute: ${error.error}`);
            updateExecutionLog();
            return;
        }
        
        const execution = await execRes.json();
        state.executionLog.push(`[INFO] AWX job launched: ${execution.awxJobId}`);
        state.executionLog.push(`[INFO] Execution ID: ${execution.executionId}`);
        state.executionLog.push(`[INFO] Polling status every 7 seconds...`);
        state.executionLog.push('');
        updateExecutionLog();

        // Step 3: Poll status
        const maxPolls = 100;
        let pollCount = 0;
        
        const pollInterval = setInterval(async () => {
            pollCount++;
            
            if (pollCount > maxPolls) {
                clearInterval(pollInterval);
                state.executionLog.push('[WARNING] Execution taking longer than expected (12 minutes)');
                updateExecutionLog();
                return;
            }
            
            try {
                const statusRes = await fetch(`${state.backendUrl}/api/executions/${execution.executionId}/status`);
                
                if (!statusRes.ok) {
                    state.executionLog.push(`[ERROR] Failed to fetch status`);
                    updateExecutionLog();
                    return;
                }
                
                const status = await statusRes.json();

                if (status.status === 'successful' || status.status === 'failed' || status.status === 'error') {
                    clearInterval(pollInterval);
                    
                    // Update local change state
                    const change = state.changes.find(c => c.id === changeId);
                    if (change) {
                        change.state = status.status === 'successful' ? 'Verified' : 'Failed';
                    }
                    
                    // Fetch full log
                    const logRes = await fetch(`${state.backendUrl}/api/executions/${execution.executionId}/log`);
                    const log = await logRes.text();
                    
                    state.executionLog.push('');
                    state.executionLog.push('========== AWX JOB LOG ==========');
                    state.executionLog.push(log);
                    state.executionLog.push('=================================');
                    state.executionLog.push('');
                    
                    if (status.status === 'successful') {
                        state.executionLog.push('[SUCCESS] ========================================');
                        state.executionLog.push('[SUCCESS] Execution completed successfully!');
                        state.executionLog.push('[SUCCESS] All services verified and running');
                        state.executionLog.push('[SUCCESS] ========================================');
                    } else {
                        state.executionLog.push('[FAILED] ========================================');
                        state.executionLog.push('[FAILED] Execution failed — check log above');
                        state.executionLog.push('[FAILED] Compensation NOTIFY_ONCALL triggered');
                        state.executionLog.push('[FAILED] ========================================');
                    }
                    
                    updateExecutionLog();
                } else {
                    // Still running
                    state.executionLog.push(`[INFO] [${new Date().toLocaleTimeString()}] Job status: ${status.status}... (poll ${pollCount}/${maxPolls})`);
                    updateExecutionLog();
                }
            } catch (error) {
                console.error('Poll error:', error);
            }
        }, 7000);
        
    } catch (error) {
        console.error('Execution error:', error);
        state.executionLog.push(`[ERROR] ${error.message}`);
        updateExecutionLog();
    }
}

function updateExecutionLog() {
    const logElement = document.getElementById('executionLog');
    if (logElement) {
        logElement.textContent = state.executionLog.join('\n');
        logElement.scrollTop = logElement.scrollHeight;
    }
}

// ===========================
// ACTION BUILDER FROM TEMPLATE
// ===========================

async function openActionBuilderModal() {
    try {
        // Load templates from backend
        const response = await fetch(`${state.backendUrl}/api/templates`);
        if (!response.ok) {
            throw new Error('Failed to load templates');
        }
        const templates = await response.json();
        
        const modalHtml = `
            <div class="modal-overlay" onclick="closeModal(event)">
            <div class="modal" style="max-width: 900px;" onclick="event.stopPropagation()">
                <div class="modal-header">
                    <h2 class="modal-title">Create Action from Template</h2>
                    <button class="modal-close" onclick="closeModal()">&times;</button>
                </div>
                <div class="modal-body">
                    <!-- Step 1: Template Selector -->
                    <div id="templateSelectorStep">
                        <h3 style="margin-bottom: 1rem;">Select Template</h3>
                        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 1rem;">
                            ${templates.map(tpl => `
                                <div class="template-card" onclick="selectTemplate('${tpl.id}')" style="cursor: pointer; padding: 1.5rem; background: #1f2937; border: 2px solid #374151; border-radius: 0.5rem; transition: all 0.2s;">
                                    <div style="font-size: 2rem; margin-bottom: 0.5rem;">${tpl.icon}</div>
                                    <h4 style="margin-bottom: 0.5rem; color: #f9fafb;">${tpl.name}</h4>
                                    <div style="font-size: 0.75rem; color: #9ca3af; margin-bottom: 0.5rem;">${tpl.category}</div>
                                    <div style="font-size: 0.875rem; color: #d1d5db; line-height: 1.4;">${tpl.description}</div>
                                    <div style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid #374151; font-size: 0.75rem; color: #9ca3af;">
                                        <div>⏱ ${tpl.estimatedDuration}</div>
                                        <div style="margin-top: 0.25rem;">🔧 ${tpl.implementation.join(', ')}</div>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                    
                    <!-- Step 2: Parameter Form (hidden initially) -->
                    <div id="parameterFormStep" style="display: none;">
                        <button onclick="backToTemplateSelector()" style="margin-bottom: 1rem; padding: 0.5rem 1rem; background: #374151; border: none; color: white; border-radius: 0.375rem; cursor: pointer;">← Back to Templates</button>
                        <h3 style="margin-bottom: 1rem;">Configure Action</h3>
                        <div id="selectedTemplateInfo" style="padding: 1rem; background: #1f2937; border-radius: 0.5rem; margin-bottom: 1.5rem;"></div>
                        <form id="actionBuilderForm" onsubmit="event.preventDefault(); previewActionYAML();">
                            <!-- Action Metadata (Domain & Risk) -->
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.5rem; padding-bottom: 1.5rem; border-bottom: 1px solid #374151;">
                                <div class="form-group">
                                    <label class="form-label" style="display: block; margin-bottom: 0.5rem; color: #9ca3af; font-size: 0.875rem;">Domain *</label>
                                    <select id="actionDomain" class="form-input" style="width: 100%;" required>
                                        <option value="CNTT">CNTT</option>
                                        <option value="IP">IP</option>
                                        <option value="5G">5G</option>
                                        <option value="Transport">Transport</option>
                                    </select>
                                </div>
                                <div class="form-group">
                                    <label class="form-label" style="display: block; margin-bottom: 0.5rem; color: #9ca3af; font-size: 0.875rem;">Risk Default *</label>
                                    <select id="actionRisk" class="form-input" style="width: 100%;" required>
                                        <option value="LOW">LOW</option>
                                        <option value="MEDIUM" selected>MEDIUM</option>
                                        <option value="HIGH">HIGH</option>
                                        <option value="CRITICAL">CRITICAL</option>
                                    </select>
                                </div>
                            </div>
                            
                            <!-- Dynamic Template Parameters -->
                            <h4 style="margin-bottom: 1rem; color: #f3f4f6;">Template Parameters</h4>
                            <div id="dynamicParamsContainer"></div>
                            
                            <div style="display: flex; gap: 1rem; margin-top: 1.5rem;">
                                <button type="button" onclick="previewActionYAML()" class="btn btn-secondary">Preview YAML</button>
                                <button type="submit" class="btn btn-primary">Create Action</button>
                            </div>
                        </form>
                    </div>
                    
                    <!-- Step 3: YAML Preview (hidden initially) -->
                    <div id="yamlPreviewStep" style="display: none;">
                        <button onclick="backToParameterForm()" style="margin-bottom: 1rem; padding: 0.5rem 1rem; background: #374151; border: none; color: white; border-radius: 0.375rem; cursor: pointer;">← Back to Edit</button>
                        <h3 style="margin-bottom: 1rem;">YAML Preview</h3>
                        <div style="background: #1f2937; padding: 1rem; border-radius: 0.5rem; margin-bottom: 1rem;">
                            <div style="color: #9ca3af; font-size: 0.875rem; margin-bottom: 0.5rem;">Generated Ansible Playbook:</div>
                            <pre id="yamlPreviewCode" class="code-block" style="max-height: 400px; overflow-y: auto; margin: 0;"></pre>
                        </div>
                        <div style="display: flex; gap: 1rem;">
                            <button onclick="backToParameterForm()" class="btn btn-secondary">← Edit Parameters</button>
                            <button onclick="createActionFromTemplate()" class="btn btn-primary">✓ Confirm & Create Action</button>
                        </div>
                    </div>
                </div>
            </div>
            </div>
        `;
        
        document.getElementById('modalContainer').innerHTML = modalHtml;
        
        // Add hover effects to template cards
        setTimeout(() => {
            document.querySelectorAll('.template-card').forEach(card => {
                card.addEventListener('mouseenter', function() {
                    this.style.borderColor = '#60a5fa';
                    this.style.transform = 'translateY(-4px)';
                    this.style.boxShadow = '0 10px 20px rgba(0,0,0,0.3)';
                });
                card.addEventListener('mouseleave', function() {
                    this.style.borderColor = '#374151';
                    this.style.transform = 'translateY(0)';
                    this.style.boxShadow = 'none';
                });
            });
        }, 100);
        
    } catch (error) {
        alert('Failed to load templates: ' + error.message);
    }
}

let selectedTemplateData = null;

async function selectTemplate(templateId) {
    try {
        // Load template details
        const response = await fetch(`${state.backendUrl}/api/templates/${templateId}`);
        if (!response.ok) {
            throw new Error('Failed to load template details');
        }
        selectedTemplateData = await response.json();
        
        // Hide template selector, show parameter form
        document.getElementById('templateSelectorStep').style.display = 'none';
        document.getElementById('parameterFormStep').style.display = 'block';
        
        // Show template info
        document.getElementById('selectedTemplateInfo').innerHTML = `
            <div style="display: flex; align-items: center; gap: 1rem;">
                <div style="font-size: 2.5rem;">${selectedTemplateData.icon}</div>
                <div>
                    <h4 style="margin-bottom: 0.25rem; color: #f9fafb;">${selectedTemplateData.name}</h4>
                    <div style="font-size: 0.875rem; color: #9ca3af;">${selectedTemplateData.description}</div>
                </div>
            </div>
        `;
        
        // Generate dynamic form fields
        const paramsHtml = selectedTemplateData.parameters.map(param => {
            return generateFormField(param);
        }).join('');
        
        document.getElementById('dynamicParamsContainer').innerHTML = paramsHtml;
        
    } catch (error) {
        alert('Failed to load template: ' + error.message);
    }
}

function generateFormField(param) {
    const required = param.required ? '*' : '';
    const description = param.description ? `<div style="font-size: 0.75rem; color: #9ca3af; margin-top: 0.25rem;">${param.description}</div>` : '';
    
    let inputHtml = '';
    
    switch (param.type) {
        case 'string':
            inputHtml = `<input type="text" id="param_${param.name}" name="${param.name}" placeholder="${param.placeholder || ''}" ${param.required ? 'required' : ''} style="width: 100%; padding: 0.5rem; background: #374151; border: 1px solid #4b5563; color: white; border-radius: 0.375rem;">`;
            break;
        case 'number':
            inputHtml = `<input type="number" id="param_${param.name}" name="${param.name}" placeholder="${param.placeholder || ''}" value="${param.default !== undefined ? param.default : ''}" ${param.required ? 'required' : ''} style="width: 100%; padding: 0.5rem; background: #374151; border: 1px solid #4b5563; color: white; border-radius: 0.375rem;">`;
            break;
        case 'boolean':
            const checked = param.default ? 'checked' : '';
            inputHtml = `
                <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
                    <input type="checkbox" id="param_${param.name}" name="${param.name}" ${checked} style="width: 20px; height: 20px;">
                    <span style="color: #d1d5db;">Enable</span>
                </label>
            `;
            break;
        case 'textarea':
            inputHtml = `<textarea id="param_${param.name}" name="${param.name}" placeholder="${param.placeholder || ''}" ${param.required ? 'required' : ''} rows="4" style="width: 100%; padding: 0.5rem; background: #374151; border: 1px solid #4b5563; color: white; border-radius: 0.375rem; font-family: monospace;"></textarea>`;
            break;
        case 'select':
            const options = param.options.map(opt => 
                `<option value="${opt.value}" ${param.default === opt.value ? 'selected' : ''}>${opt.label}</option>`
            ).join('');
            inputHtml = `<select id="param_${param.name}" name="${param.name}" ${param.required ? 'required' : ''} style="width: 100%; padding: 0.5rem; background: #374151; border: 1px solid #4b5563; color: white; border-radius: 0.375rem;">${options}</select>`;
            break;
        default:
            inputHtml = `<input type="text" id="param_${param.name}" name="${param.name}" placeholder="${param.placeholder || ''}" ${param.required ? 'required' : ''} style="width: 100%; padding: 0.5rem; background: #374151; border: 1px solid #4b5563; color: white; border-radius: 0.375rem;">`;
    }
    
    return `
        <div style="margin-bottom: 1.5rem;">
            <label style="display: block; margin-bottom: 0.5rem; color: #f9fafb; font-weight: 500;">
                ${param.label} ${required ? '<span style="color: #ef4444;">*</span>' : ''}
            </label>
            ${inputHtml}
            ${description}
        </div>
    `;
}

function getFormParameters() {
    const params = {};
    
    selectedTemplateData.parameters.forEach(param => {
        const element = document.getElementById(`param_${param.name}`);
        
        if (param.type === 'boolean') {
            params[param.name] = element.checked;
        } else if (param.type === 'number') {
            const value = element.value;
            params[param.name] = value ? Number(value) : undefined;
        } else {
            const value = element.value.trim();
            params[param.name] = value || undefined;
        }
    });
    
    return params;
}

async function previewActionYAML() {
    try {
        const params = getFormParameters();
        
        // Call preview API
        const response = await fetch(`${state.backendUrl}/api/templates/${selectedTemplateData.id}/preview`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params)
        });
        
        const result = await response.json();
        
        if (!result.valid) {
            alert('Validation errors:\n' + result.errors.join('\n'));
            return;
        }
        
        // Show YAML preview
        document.getElementById('parameterFormStep').style.display = 'none';
        document.getElementById('yamlPreviewStep').style.display = 'block';
        document.getElementById('yamlPreviewCode').textContent = result.yaml;
        
    } catch (error) {
        alert('Failed to preview YAML: ' + error.message);
    }
}

async function createActionFromTemplate() {
    try {
        const params = getFormParameters();
        
        // Get metadata values
        const domain = document.getElementById('actionDomain')?.value || 'CNTT';
        const riskDefault = document.getElementById('actionRisk')?.value || 'MEDIUM';
        
        // Call create action API
        const response = await fetch(`${state.backendUrl}/api/actions/from-template`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                templateId: selectedTemplateData.id,
                params: params,
                domain: domain,
                riskDefault: riskDefault
            })
        });
        
        const result = await response.json();
        
        if (!response.ok) {
            alert('Error: ' + (result.error || 'Failed to create action'));
            return;
        }
        
        alert(`Action "${result.action.id}" created successfully!`);
        
        // Reload actions
        await loadActionsFromBackend();
        
        // Close modal and refresh view
        closeModal();
        renderView('actions');
        
    } catch (error) {
        alert('Failed to create action: ' + error.message);
    }
}

function backToTemplateSelector() {
    document.getElementById('parameterFormStep').style.display = 'none';
    document.getElementById('templateSelectorStep').style.display = 'block';
    selectedTemplateData = null;
}

function backToParameterForm() {
    document.getElementById('yamlPreviewStep').style.display = 'none';
    document.getElementById('parameterFormStep').style.display = 'block';
}

async function loadActionsFromBackend() {
    try {
        const response = await fetch(`${state.backendUrl}/api/actions`);
        if (response.ok) {
            state.actions = await response.json();
        }
    } catch (error) {
        console.error('Failed to load actions:', error);
    }
}
