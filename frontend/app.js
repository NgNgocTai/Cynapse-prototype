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
    credentials: [],
    inventory: { hosts: [], groups: [] },
    executions: [],
    executionLog: [],
    auditLog: [],
    activeChangeId: null,
    composerSteps: [],
    currentExecution: null,
    moduleSchemas: [],
    newActionDraft: null,
    backendUrl: 'http://localhost:4000'
};

// Initialize App
async function initApp() {
    initNavigation();
    initRoleSelector();
    
    // Immediately highlight correct navigation tab matching URL hash before awaiting network
    const initialHash = window.location.hash.replace(/^#\/?/, '');
    const initialView = initialHash || sessionStorage.getItem('synapse_current_view') || 'home';
    const navLinks = document.querySelectorAll('.main-nav a');
    navLinks.forEach(l => {
        if (l.dataset.view === initialView) {
            l.classList.add('active');
        } else {
            l.classList.remove('active');
        }
    });

    // Load data from backend
    await loadInitialData();
    
    // Listen to hash changes for browser back/forward buttons
    window.addEventListener('hashchange', () => {
        const hash = window.location.hash.replace(/^#\/?/, '');
        if (hash && hash !== state.currentView) {
            renderView(hash);
        }
    });

    // Restore view from URL hash or sessionStorage, defaulting to 'home'
    const hash = window.location.hash.replace(/^#\/?/, '');
    const savedView = hash || sessionStorage.getItem('synapse_current_view') || 'home';
    const savedChangeId = sessionStorage.getItem('synapse_active_change_id');
    if (savedChangeId && state.changes.some(c => c.id === savedChangeId)) {
        state.activeChangeId = savedChangeId;
    }
    
    const validViews = ['home', 'changes', 'executions', 'blueprints', 'actions', 'credentials', 'audit'];
    renderView(validViews.includes(savedView) ? savedView : 'home');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}

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

        // Load credentials (AWX Architecture)
        try {
            const credsRes = await fetch(`${state.backendUrl}/api/credentials`);
            if (credsRes.ok) {
                state.credentials = await credsRes.json();
            }
        } catch (credErr) {
            console.warn('Could not load credentials:', credErr);
        }

        // Load inventory (AWX Hybrid Target Management)
        try {
            const invRes = await fetch(`${state.backendUrl}/api/inventory`);
            if (invRes.ok) {
                state.inventory = await invRes.json();
            }
        } catch (invErr) {
            console.warn('Could not load inventory:', invErr);
        }

        // Load module schemas for Task Definition Builder
        try {
            const schemasRes = await fetch(`${state.backendUrl}/api/module-schemas`);
            if (schemasRes.ok) {
                state.moduleSchemas = await schemasRes.json();
            }
        } catch (err) {
            console.warn('Could not load module schemas:', err);
        }

        // Load executions
        const executionsRes = await fetch(`${state.backendUrl}/api/executions`);
        if (executionsRes.ok) {
            state.executions = await executionsRes.json();
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
    const validViews = ['home', 'changes', 'executions', 'blueprints', 'actions', 'credentials', 'inventory', 'audit'];
    if (!validViews.includes(viewName)) {
        viewName = 'home';
    }

    state.currentView = viewName;
    sessionStorage.setItem('synapse_current_view', viewName);
    if (state.activeChangeId) {
        sessionStorage.setItem('synapse_active_change_id', state.activeChangeId);
    }
    
    if (window.location.hash !== `#${viewName}`) {
        history.replaceState(null, '', `#${viewName}`);
    }

    // Sync sidebar navigation active state
    const navLinks = document.querySelectorAll('.main-nav a');
    navLinks.forEach(l => {
        if (l.dataset.view === viewName) {
            l.classList.add('active');
        } else {
            l.classList.remove('active');
        }
    });

    const mainContent = document.getElementById('mainContent');
    
    const views = {
        home: renderHomeView,
        changes: renderChangesView,
        executions: renderExecutionsView,
        blueprints: renderBlueprintsView,
        actions: renderActionsView,
        credentials: renderCredentialsView,
        inventory: renderInventoryView,
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
// ACTIONS VIEW — Dynamic CRUD (Composable Action Primitives)
// ============================================================
function renderActionsView() {
    return `
        <div class="view-header">
            <div>
                <h2 class="card-title" style="margin: 0;">Action Catalog</h2>
                <div style="font-size: 0.85rem; color: #9ca3af; margin-top: 0.25rem;">Atomic automation building blocks with input/output contracts & real Ansible task definitions</div>
            </div>
            <div style="display: flex; gap: 1rem;">
                <button class="btn btn-primary" onclick="openNewActionModal()" style="background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);">
                    <span style="font-size: 1.1rem; margin-right: 0.4rem;">⚡</span>
                    + Create Action Primitive
                </button>
            </div>
        </div>
        
        <div class="metrics-grid" style="margin-top: 2rem;">
            <div class="metric-card">
                <div class="metric-label">Total Actions</div>
                <div class="metric-value">${state.actions.length}</div>
            </div>
            <div class="metric-card">
                <div class="metric-label">With Task Definition</div>
                <div class="metric-value" style="color: #6ee7b7;">${state.actions.filter(a => a.task_template && a.task_template.length > 0).length}</div>
                <div class="metric-subtitle">runnable tasks</div>
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
                        <th>Ansible Module / Logic</th>
                        <th>Risk</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${state.actions.length > 0 ? state.actions.map(action => {
                        const moduleName = action.task_template && action.task_template[0] && action.task_template[0].module 
                            ? action.task_template[0].module.replace('ansible.builtin.', '')
                            : (action.implementation?.provider || 'ansible');
                        return `
                        <tr>
                            <td>
                                <code style="color: #60a5fa; font-weight: 600;">${action.id}</code>
                            </td>
                            <td>
                                <div style="font-weight: 500;">${action.name}</div>
                                ${action.description ? `<div style="font-size: 0.75rem; color: #9ca3af;">${action.description}</div>` : ''}
                            </td>
                            <td><span class="badge badge-info">${action.domain}</span></td>
                            <td><span style="font-size: 0.8rem; color: #d1d5db; font-family: monospace;">${action.capability}</span></td>
                            <td><span style="color: #9ca3af; font-size: 0.8rem;">${action.implementation?.provider || 'ansible'}</span></td>
                            <td>
                                <span class="badge" style="background: #1e293b; color: #38bdf8; border: 1px solid #0284c7; font-family: monospace; font-size: 0.72rem;">
                                    ${moduleName}
                                </span>
                            </td>
                            <td><span class="badge badge-${action.riskDefault === 'HIGH' || action.riskDefault === 'CRITICAL' ? 'danger' : action.riskDefault === 'MEDIUM' ? 'warning' : 'success'}">${action.riskDefault}</span></td>
                            <td>
                                <div style="display: flex; gap: 0.4rem;">
                                    <button class="btn btn-secondary" style="padding: 0.25rem 0.65rem; font-size: 0.75rem;" onclick="openEditActionModal('${action.id}')">Edit</button>
                                    <button class="btn btn-secondary" style="padding: 0.25rem 0.65rem; font-size: 0.75rem; color: #fca5a5;" onclick="confirmDeleteAction('${action.id}')">Delete</button>
                                </div>
                            </td>
                        </tr>
                        `;
                    }).join('') : `
                        <tr>
                            <td colspan="8" style="text-align: center; color: #9ca3af; padding: 2.5rem;">
                                No actions in catalog. Click "+ Create Action Primitive" to define your first action!
                            </td>
                        </tr>
                    `}
                </tbody>
            </table>
        </div>
    `;
}

// ============================================================
// BLUEPRINTS VIEW — Dynamic CRUD (Skeleton & Clone-to-Change)
// ============================================================
function renderBlueprintsView() {
    const published = state.blueprints.filter(b => b.spec.status === 'PUBLISHED').length;
    const draft = state.blueprints.filter(b => b.spec.status === 'DRAFT').length;
    const inReview = state.blueprints.filter(b => b.spec.status === 'IN_REVIEW').length;

    return `
        <div class="view-header">
            <div>
                <h2 class="card-title" style="margin: 0;">Blueprints (Workflows)</h2>
                <div style="font-size: 0.85rem; color: #9ca3af; margin-top: 0.25rem;">Fixed pipeline skeletons wrapping atomic Actions · Reusable templates ready to clone into Change requests</div>
            </div>
            <button class="btn btn-primary" onclick="openNewBlueprintModal()" style="background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);">
                <span style="font-size: 1.1rem; margin-right: 0.4rem;">🧩</span>
                + Create Blueprint
            </button>
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
        
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 1.5rem;">
            ${state.blueprints.length > 0 ? state.blueprints.map(bp => {
                const stepsCount = (bp.spec && bp.spec.steps) ? bp.spec.steps.length : 0;
                return `
                <div class="card" style="transition: all 0.2s; border-left: 3px solid ${bp.spec.status === 'PUBLISHED' ? '#6ee7b7' : bp.spec.status === 'DRAFT' ? '#fcd34d' : '#60a5fa'}; display: flex; flex-direction: column; justify-content: space-between;">
                    <div>
                        <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 0.75rem;">
                            <div>
                                <h3 style="font-size: 1.15rem; font-weight: 600; margin-bottom: 0.25rem; color: #f9fafb; cursor: pointer;" onclick="openBlueprintDetailModal('${bp.metadata.name}')">
                                    ${bp.metadata.name}
                                </h3>
                                <div style="font-size: 0.8rem; color: #9ca3af;">v${bp.metadata.version} · ${bp.spec.domain} · Owner: ${bp.spec.owner}</div>
                            </div>
                            <span class="badge badge-${bp.spec.status === 'PUBLISHED' ? 'success' : bp.spec.status === 'DRAFT' ? 'warning' : 'info'}">${bp.spec.status}</span>
                        </div>
                        <div style="font-size: 0.85rem; color: #d1d5db; margin-bottom: 0.75rem; line-height: 1.4;">${bp.spec.description || 'Composable Ansible Orchestration Blueprint Skeleton'}</div>
                        <div style="font-size: 0.8rem; margin-bottom: 1rem; background: #111827; padding: 0.5rem 0.75rem; border-radius: 0.375rem; border: 1px solid #1f2937;">
                            <strong style="color: #9ca3af; display: block; margin-bottom: 0.3rem;">Sequential Skeleton Pipeline (${stepsCount} actions):</strong>
                            <div style="display: flex; flex-wrap: wrap; gap: 0.35rem; align-items: center;">
                                ${(bp.spec.steps || []).map((s, idx) => {
                                    const aId = typeof s === 'string' ? s : s.action;
                                    return `<span style="font-family: monospace; font-size: 0.72rem; color: #60a5fa; background: #1e293b; padding: 0.15rem 0.4rem; border-radius: 0.25rem; border: 1px solid #334155;">${idx + 1}. ${aId}</span>`;
                                }).join(' <span style="color: #6b7280; font-size: 0.7rem;">➜</span> ')}
                            </div>
                        </div>
                    </div>
                    <div style="display: flex; gap: 0.4rem; justify-content: space-between; border-top: 1px solid #374151; padding-top: 0.75rem; align-items: center; margin-top: 0.5rem;">
                        <div style="display: flex; gap: 0.35rem;">
                            <button class="btn btn-secondary" style="font-size: 0.75rem; padding: 0.3rem 0.55rem;" onclick="openBlueprintDetailModal('${bp.metadata.name}')">
                                👁 Skeleton
                            </button>
                            <button class="btn btn-secondary" style="font-size: 0.75rem; padding: 0.3rem 0.55rem;" onclick="openYamlPreviewModal('${bp.metadata.name}')">
                                📄 YAML
                            </button>
                            <button class="btn btn-secondary" style="font-size: 0.75rem; padding: 0.3rem 0.55rem;" onclick="openEditBlueprintModal('${bp.metadata.name}')">
                                ⚙ Edit
                            </button>
                        </div>
                        <button class="btn btn-primary" style="font-size: 0.75rem; padding: 0.35rem 0.75rem; background: linear-gradient(135deg, #10b981 0%, #059669 100%); font-weight: 600;" onclick="openNewChangeModal('${bp.metadata.name}')">
                            🚀 Clone to Change
                        </button>
                    </div>
                </div>
                `;
            }).join('') : `
                <div class="card" style="text-align: center; color: #9ca3af; padding: 3rem;">
                    No blueprints yet. Assemble Action primitives into a Blueprint wrapper!
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
                                ${change.state === 'Approved' ? `<button class="btn btn-success" style="padding: 0.25rem 0.75rem; font-size: 0.75rem; font-weight: 600;" onclick="executeChange('${change.id}', true)">▶ Execute</button>` : ''}
                                ${change.state === 'Executing' ? `<button class="btn btn-primary" style="padding: 0.25rem 0.75rem; font-size: 0.75rem;" onclick="executeChange('${change.id}', false)">📡 Monitor</button>` : ''}
                                ${change.state === 'Verified' ? `<button class="btn btn-secondary" style="padding: 0.25rem 0.65rem; font-size: 0.75rem;" onclick="executeChange('${change.id}', false)" title="View execution log and results">👁 View Run</button>` : ''}
                                ${change.state === 'Failed' ? `<button class="btn btn-secondary" style="padding: 0.25rem 0.65rem; font-size: 0.75rem; color: #f87171;" onclick="executeChange('${change.id}', false)" title="View execution failure log">👁 View Run</button>` : ''}
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
    
    const execution = state.currentExecution || state.executions.find(e => e.changeId === change.id);
    if (execution && (!state.executionLog || state.executionLog.length === 0) && execution.logTail) {
        state.executionLog = execution.logTail.split('\n');
    }

    return `
        <div class="view-header" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
            <div style="display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;">
                <h2 class="card-title" style="margin: 0;">Execution — ${change.id}</h2>
                ${state.changes.length > 1 ? `
                    <select id="changeExecutionSelector" style="background: #1f2937; color: #f3f4f6; border: 1px solid #374151; border-radius: 0.375rem; padding: 0.35rem 0.65rem; font-size: 0.85rem; cursor: pointer;" onchange="switchExecutionChange(this.value)">
                        ${state.changes.map(c => `
                            <option value="${c.id}" ${c.id === change.id ? 'selected' : ''}>
                                ${c.id} [${c.state}] — ${c.objective}
                            </option>
                        `).join('')}
                    </select>
                ` : ''}
            </div>
            <div class="execution-actions" style="display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap;">
                ${needsApproval ? `<button class="btn btn-primary" onclick="approveChange('${change.id}')">✓ Approve</button>` : ''}
                ${canExecute ? `<button class="btn btn-success" onclick="runExecution('${change.id}')">▶ Run Execution</button>` : ''}
                ${(change.state === 'Verified' || change.state === 'Failed') ? `
                    <span class="badge badge-${change.state === 'Verified' ? 'success' : 'danger'}" style="padding: 0.4rem 0.8rem; font-size: 0.85rem;">
                        ${change.state === 'Verified' ? '✓ Completed & Verified' : '✕ Execution Failed'}
                    </span>
                    <button class="btn btn-secondary" onclick="runExecution('${change.id}')" style="border: 1px solid #4b5563;" title="Re-run this orchestration workflow">
                        ↻ Re-run Pipeline
                    </button>
                ` : ''}
                ${isBlocked ? `<button class="btn btn-danger" disabled>✗ Blocked</button>` : ''}
                ${change.state === 'Executing' ? `<span class="badge badge-info pulse" style="padding: 0.5rem 1rem;">⟳ Running...</span>` : ''}
                <button class="btn btn-secondary" onclick="renderView('changes')">← Back to Changes</button>
            </div>
        </div>
        
        <!-- Stepper -->
        ${renderStepper(change.state)}
        
        <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 1.5rem; margin-top: 1.5rem;">
            <div>
                <div class="card" style="margin-bottom: 1.5rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
                        <h3 class="card-title">Change Details</h3>
                        <span id="changeDetailsStateBadge" class="badge badge-${getStateColor(change.state)}">${change.state}</span>
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

                <!-- Orchestration Pipeline Steps -->
                ${renderPipelineStepsTracker(change)}
                
                <div class="card">
                    <h3 class="card-title" style="margin-bottom: 1rem;">Runtime Execution Log</h3>
                    <div class="code-block" id="executionLog" style="min-height: 250px; max-height: 450px; overflow-y: auto; color: #6ee7b7; font-family: monospace;">
${state.executionLog.length > 0 ? state.executionLog.join('\n') : '[INFO] Ready to execute. Approve the change and click "Run Execution" to start orchestration...'}
                    </div>
                </div>
            </div>
            
            <div>
                <div class="card">
                    <h3 class="card-title" style="margin-bottom: 1rem;">Automation Details</h3>
                    ${(() => {
                        const blueprint = state.blueprints.find(b => b.metadata.name === change.objective);
                        if (blueprint) {
                            return `
                                <div style="margin-bottom: 0.75rem;">
                                    <div style="color: #9ca3af; font-size: 0.875rem;">Type</div>
                                    <div style="margin-top: 0.25rem;"><span class="badge badge-info">Composition (Blueprint)</span></div>
                                </div>
                                <div style="margin-bottom: 0.75rem;">
                                    <div style="color: #9ca3af; font-size: 0.875rem;">Blueprint Name</div>
                                    <div style="margin-top: 0.25rem; font-family: monospace; font-size: 0.875rem; color: #60a5fa;">${blueprint.metadata.name}</div>
                                </div>
                                <div style="margin-bottom: 0.75rem;">
                                    <div style="color: #9ca3af; font-size: 0.875rem;">Workflow Pipeline</div>
                                    <div style="margin-top: 0.25rem; font-weight: 700; color: #34d399;">${blueprint.spec.steps.length} Steps Sequence</div>
                                </div>
                                <div style="margin-bottom: 0.75rem;">
                                    <div style="color: #9ca3af; font-size: 0.875rem;">Domain</div>
                                    <div style="margin-top: 0.25rem;">${blueprint.spec.domain}</div>
                                </div>
                                <div>
                                    <div style="color: #9ca3af; font-size: 0.875rem;">On Failure Policy</div>
                                    <div style="margin-top: 0.25rem;"><span class="badge badge-warning">${blueprint.spec.compensation?.onFailure || 'NOTIFY_ONCALL'}</span></div>
                                </div>
                            `;
                        }

                        const action = state.actions.find(a => a.id === change.objective);
                        if (!action) return `<div style="color: #9ca3af;">Objective: ${change.objective}</div>`;
                        return `
                            <div style="margin-bottom: 0.75rem;">
                                <div style="color: #9ca3af; font-size: 0.875rem;">Type</div>
                                <div style="margin-top: 0.25rem;"><span class="badge badge-success">Primitive (Action)</span></div>
                            </div>
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
// PIPELINE STEPS TRACKER — Live Step Execution Tracker
// ============================================================
function renderPipelineStepsTracker(change) {
    const execution = state.currentExecution || state.executions.find(e => e.changeId === change.id);
    const blueprint = state.blueprints.find(b => b.metadata.name === change.objective);
    
    let steps = [];
    if (execution && execution.steps && execution.steps.length > 0) {
        steps = execution.steps;
    } else if (blueprint && blueprint.spec && blueprint.spec.steps) {
        steps = blueprint.spec.steps.map((s, idx) => ({
            stepIndex: idx,
            stepName: `Step ${idx + 1}: ${s.action}`,
            actionId: s.action,
            status: 'PENDING',
            awxJobId: null
        }));
    } else {
        const action = state.actions.find(a => a.id === change.objective);
        steps = [{
            stepIndex: 0,
            stepName: action ? action.name : change.objective,
            actionId: change.objective,
            status: execution ? (execution.status === 'completed' ? 'SUCCESS' : execution.status === 'failed' ? 'FAILED' : 'RUNNING') : 'PENDING',
            awxJobId: execution?.awxJobId || null
        }];
    }

    return `
        <div class="card steps-pipeline-card">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                <h3 class="card-title" style="margin: 0; display: flex; align-items: center; gap: 0.5rem; font-size: 1.05rem;">
                    <span>⚡</span> Orchestration Pipeline Steps
                </h3>
                <span class="badge badge-info" style="font-size: 0.75rem;">${steps.length} step(s)</span>
            </div>
            <div id="pipelineStepsList">
                ${steps.map((st, idx) => {
                    const action = state.actions.find(a => a.id === st.actionId);
                    const actName = action ? action.name : st.actionId;
                    const statusClass = st.status || 'PENDING';
                    const statusIcon = statusClass === 'SUCCESS' ? '✓' : statusClass === 'RUNNING' ? '⟳' : statusClass === 'FAILED' ? '✕' : '○';
                    const badgeClass = statusClass === 'SUCCESS' ? 'success' : statusClass === 'RUNNING' ? 'info pulse-glow' : statusClass === 'FAILED' ? 'danger' : 'secondary';
                    
                    return `
                        <div class="step-tracker-item status-${statusClass}" id="step-item-${idx}">
                            <div style="display: flex; align-items: center; gap: 0.75rem;">
                                <span class="composer-step-number" style="background: ${statusClass === 'SUCCESS' ? '#10b981' : statusClass === 'RUNNING' ? '#3b82f6' : statusClass === 'FAILED' ? '#ef4444' : '#4b5563'};">
                                    ${statusIcon}
                                </span>
                                <div>
                                    <div style="font-weight: 600; color: #f9fafb; font-size: 0.88rem;">
                                        Step ${idx + 1}: ${actName}
                                    </div>
                                    <div style="font-size: 0.72rem; color: #9ca3af; font-family: monospace;">
                                        ${st.actionId}
                                    </div>
                                </div>
                            </div>
                            <div style="display: flex; align-items: center; gap: 0.75rem;">
                                <span class="awx-badge" style="border-color: #3b82f6; color: #93c5fd;" title="Ansible Playbook Play">
                                    📜 Action ${idx + 1}
                                </span>
                                <span class="badge badge-${badgeClass}" style="min-width: 80px; text-align: center; font-size: 0.75rem;">
                                    ${statusClass}
                                </span>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;
}

function updatePipelineStepsDOM(execution) {
    if (!execution || !execution.steps) return;
    const container = document.getElementById('pipelineStepsList');
    if (!container) return;

    container.innerHTML = execution.steps.map((st, idx) => {
        const action = state.actions.find(a => a.id === st.actionId);
        const actName = action ? action.name : st.actionId;
        const statusClass = st.status || 'PENDING';
        const statusIcon = statusClass === 'SUCCESS' ? '✓' : statusClass === 'RUNNING' ? '⟳' : statusClass === 'FAILED' ? '✕' : '○';
        const badgeClass = statusClass === 'SUCCESS' ? 'success' : statusClass === 'RUNNING' ? 'info pulse-glow' : statusClass === 'FAILED' ? 'danger' : 'secondary';
        
        return `
            <div class="step-tracker-item status-${statusClass}" id="step-item-${idx}">
                <div style="display: flex; align-items: center; gap: 0.75rem;">
                    <span class="composer-step-number" style="background: ${statusClass === 'SUCCESS' ? '#10b981' : statusClass === 'RUNNING' ? '#3b82f6' : statusClass === 'FAILED' ? '#ef4444' : '#4b5563'};">
                        ${statusIcon}
                    </span>
                    <div>
                        <div style="font-weight: 600; color: #f9fafb; font-size: 0.88rem;">
                            Step ${idx + 1}: ${actName}
                        </div>
                        <div style="font-size: 0.72rem; color: #9ca3af; font-family: monospace;">
                            ${st.actionId}
                        </div>
                    </div>
                </div>
                <div style="display: flex; align-items: center; gap: 0.75rem;">
                    ${st.awxJobId ? `
                        <span class="awx-badge" title="AWX Execution Job ID">
                            🚀 AWX #${st.awxJobId}
                        </span>
                    ` : ''}
                    <span class="badge badge-${badgeClass}" style="min-width: 80px; text-align: center; font-size: 0.75rem;">
                        ${st.status}
                    </span>
                </div>
            </div>
        `;
    }).join('');
}

// ===========================
// STEPPER — Change lifecycle visualization
// ===========================
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
// CREDENTIALS VIEW — Red Hat AWX Architecture Vault
// ============================================================
function renderCredentialsView() {
    const machineCount = state.credentials.filter(c => c.type === 'machine').length;
    const networkCount = state.credentials.filter(c => c.type === 'network').length;

    return `
        <div class="view-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
            <div>
                <h2 class="card-title" style="margin: 0; font-size: 1.5rem; display: flex; align-items: center; gap: 0.5rem;">
                    <span>🔐</span> Credentials Vault
                </h2>
                <div style="font-size: 0.85rem; color: #9ca3af; margin-top: 0.25rem;">
                    AWX-style secret management for Machine SSH keys, network device passwords & privilege escalation.
                </div>
            </div>
            <button class="btn btn-primary" onclick="openCredentialModal()">+ New Credential</button>
        </div>

        <div class="card">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; border-bottom: 1px solid #1f2937; padding-bottom: 0.75rem;">
                <div style="font-size: 0.85rem; color: #94a3b8; display: flex; gap: 1.25rem; align-items: center;">
                    <span>Total: <strong style="color: #60a5fa;">${state.credentials.length}</strong> managed</span>
                    <span>🖥️ Machine (Linux): <strong style="color: #38bdf8;">${machineCount}</strong></span>
                    <span>🌐 Network (CLI/API): <strong style="color: #34d399;">${networkCount}</strong></span>
                </div>
                <button class="btn btn-secondary" style="padding: 0.25rem 0.65rem; font-size: 0.75rem;" onclick="loadCredentialsData(true)">↻ Refresh</button>
            </div>

            <table class="table">
                <thead>
                    <tr>
                        <th>Name / ID</th>
                        <th>Type</th>
                        <th>Target User</th>
                        <th>Authentication</th>
                        <th>Privilege Escalation</th>
                        <th>Secret Status</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${state.credentials.length > 0 ? state.credentials.map(c => `
                        <tr>
                            <td>
                                <div style="font-weight: 600; color: #f3f4f6;">${escapeHtml(c.name)}</div>
                                <div style="font-size: 0.72rem; color: #6b7280; font-family: monospace;">${escapeHtml(c.id)}</div>
                                ${c.description ? `<div style="font-size: 0.7rem; color: #9ca3af; margin-top: 0.15rem;">${escapeHtml(c.description)}</div>` : ''}
                            </td>
                            <td>
                                ${c.type === 'machine' 
                                    ? `<span class="badge-machine">🖥️ Machine</span>` 
                                    : `<span class="badge-network">🌐 Network</span>`}
                            </td>
                            <td>
                                <code style="color: #93c5fd; background: rgba(59,130,246,0.1); padding: 0.15rem 0.4rem; border-radius: 0.25rem; font-size: 0.8rem;">${escapeHtml(c.username)}</code>
                            </td>
                            <td>
                                ${c.type === 'machine' ? (
                                    c.authType === 'ssh_key' 
                                        ? `<span class="key-path-badge" title="WSL Native Key Path">🔑 ${escapeHtml(c.sshKeyPath || '~/.ssh/id_rsa')}</span>`
                                        : `<span class="auth-method-tag">🔒 Password</span>`
                                ) : `<span class="auth-method-tag">🔒 Device Password</span>`}
                            </td>
                            <td>
                                ${c.type === 'machine' 
                                    ? `<span style="font-size: 0.78rem; color: ${c.hasBecomePassword ? '#34d399' : '#9ca3af'};">${escapeHtml(c.becomeMethod || 'sudo')} (${c.hasBecomePassword ? 'Password Set ✓' : 'NOPASSWD'})</span>`
                                    : `<span style="font-size: 0.78rem; color: ${c.hasEnablePassword ? '#34d399' : '#9ca3af'};">Enable Secret (${c.hasEnablePassword ? 'Configured ✓' : 'None'})</span>`}
                            </td>
                            <td>
                                ${c.hasPassword || c.hasSshKey 
                                    ? `<span class="secret-mask">••••••••</span>` 
                                    : `<span style="color: #f87171; font-size: 0.75rem;">No secret</span>`}
                            </td>
                            <td style="white-space: nowrap;">
                                <button class="btn btn-secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; margin-right: 0.35rem;" onclick="openCredentialModal('${c.id}')" title="Edit Credential">✏️ Edit</button>
                                <button class="btn btn-secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; color: #f87171;" onclick="deleteCredentialConfirm('${c.id}')" title="Delete Credential">🗑️</button>
                            </td>
                        </tr>
                    `).join('') : `
                        <tr>
                            <td colspan="7" style="text-align: center; color: #9ca3af; padding: 2.5rem;">
                                <div style="font-size: 1.5rem; margin-bottom: 0.5rem;">🔐</div>
                                <div style="font-weight: 500; color: #e4e4e7;">No credentials configured yet</div>
                                <div style="font-size: 0.8rem; color: #6b7280; margin-top: 0.25rem;">Click "+ New Credential" to configure machine SSH keys or network secrets.</div>
                            </td>
                        </tr>
                    `}
                </tbody>
            </table>
        </div>
    `;
}

async function loadCredentialsData(forceRender = false) {
    try {
        const res = await fetch(`${state.backendUrl}/api/credentials`);
        if (res.ok) {
            state.credentials = await res.json();
            if (forceRender && state.currentView === 'credentials') {
                renderView('credentials');
            }
        }
    } catch (err) {
        console.error('Error reloading credentials:', err);
    }
}

function renderCredDynamicFields(type, authType, cred = null) {
    if (type === 'machine') {
        return `
            <div style="margin-bottom: 1rem;">
                <label class="form-label">Authentication Method</label>
                <div style="display: flex; gap: 1.5rem; margin-top: 0.35rem;">
                    <label style="display: flex; align-items: center; gap: 0.4rem; cursor: pointer; color: #e4e4e7;">
                        <input type="radio" name="credAuthType" value="ssh_key" ${authType === 'ssh_key' ? 'checked' : ''} onchange="onCredAuthTypeSelect(this.value)">
                        <span>🔑 SSH Private Key (File Path)</span>
                    </label>
                    <label style="display: flex; align-items: center; gap: 0.4rem; cursor: pointer; color: #e4e4e7;">
                        <input type="radio" name="credAuthType" value="password" ${authType === 'password' ? 'checked' : ''} onchange="onCredAuthTypeSelect(this.value)">
                        <span>🔒 SSH Password</span>
                    </label>
                </div>
            </div>

            ${authType === 'ssh_key' ? `
                <div style="margin-bottom: 1rem;">
                    <label class="form-label">SSH Key Path (in Linux / WSL) *</label>
                    <input type="text" id="credSshKeyPathInput" class="form-input" placeholder="~/.ssh/id_rsa or /home/user/.ssh/id_rsa" value="${cred ? escapeHtml(cred.sshKeyPath || '~/.ssh/id_rsa') : '~/.ssh/id_rsa'}">
                    <div style="font-size: 0.72rem; color: #9ca3af; margin-top: 0.2rem;">Native Linux path in WSL — avoids NTFS permissions issues.</div>
                </div>
                <div style="margin-bottom: 1rem;">
                    <label class="form-label">Or Paste Private Key (Optional PEM)</label>
                    <textarea id="credSshKeyDataInput" class="form-input" rows="3" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----"></textarea>
                    <div style="font-size: 0.72rem; color: #9ca3af; margin-top: 0.2rem;">${cred && cred.hasSshKey ? '✓ SSH Key already saved. Leave blank to keep existing.' : 'If provided, written to secure 0600 temp file and deleted on finish.'}</div>
                </div>
            ` : `
                <div style="margin-bottom: 1rem;">
                    <label class="form-label">SSH Password *</label>
                    <input type="password" id="credPasswordInput" class="form-input" placeholder="${cred && cred.hasPassword ? 'Leave blank to keep existing password' : 'Enter SSH password'}">
                </div>
            `}

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
                <div>
                    <label class="form-label">Privilege Escalation Method</label>
                    <select id="credBecomeMethodInput" class="form-input">
                        <option value="sudo" ${cred && cred.becomeMethod === 'sudo' ? 'selected' : ''}>sudo</option>
                        <option value="su" ${cred && cred.becomeMethod === 'su' ? 'selected' : ''}>su</option>
                    </select>
                </div>
                <div>
                    <label class="form-label">Privilege Password (sudo)</label>
                    <input type="password" id="credBecomePasswordInput" class="form-input" placeholder="${cred && cred.hasBecomePassword ? 'Leave blank to keep existing' : 'Optional sudo password'}">
                </div>
            </div>
        `;
    } else {
        // Network Device
        return `
            <div style="margin-bottom: 1rem;">
                <label class="form-label">Device SSH / Console Password *</label>
                <input type="password" id="credPasswordInput" class="form-input" placeholder="${cred && cred.hasPassword ? 'Leave blank to keep existing password' : 'Enter device password'}">
                <div style="font-size: 0.72rem; color: #9ca3af; margin-top: 0.2rem;">Used for Cisco IOS-XE, Huawei VRP, or Juniper Junos network_cli connection.</div>
            </div>

            <div style="margin-bottom: 1rem;">
                <label class="form-label">Enable Secret / Privilege Password</label>
                <input type="password" id="credEnablePasswordInput" class="form-input" placeholder="${cred && cred.hasEnablePassword ? 'Leave blank to keep existing' : 'Optional enable secret'}">
                <div style="font-size: 0.72rem; color: #9ca3af; margin-top: 0.2rem;">Passed to Ansible become_method: enable for privileged mode (#).</div>
            </div>
        `;
    }
}

function onCredTypeSelect(newType) {
    const container = document.getElementById('credDynamicFields');
    if (container) {
        container.innerHTML = renderCredDynamicFields(newType, 'ssh_key', null);
    }
}

function onCredAuthTypeSelect(newAuthType) {
    const type = document.getElementById('credTypeInput')?.value || 'machine';
    const container = document.getElementById('credDynamicFields');
    if (container) {
        container.innerHTML = renderCredDynamicFields(type, newAuthType, null);
    }
}

function openCredentialModal(credId = null) {
    const cred = credId ? state.credentials.find(c => c.id === credId) : null;
    const isEdit = Boolean(cred);
    const initialType = cred ? cred.type : 'machine';
    const initialAuthType = cred ? (cred.authType || 'ssh_key') : 'ssh_key';

    const modal = `
        <div class="modal-overlay" onclick="closeModal(event)">
            <div class="modal" onclick="event.stopPropagation()" style="max-width: 620px; width: 95%;">
                <div class="modal-header">
                    <div style="display: flex; align-items: center; gap: 0.5rem;">
                        <span style="font-size: 1.35rem;">🔐</span>
                        <div>
                            <h2 class="modal-title" style="margin: 0;">${isEdit ? 'Edit Credential' : 'New Credential'}</h2>
                            <div style="font-size: 0.78rem; color: #9ca3af;">Red Hat AWX-compatible credential vault</div>
                        </div>
                    </div>
                    <button class="modal-close" onclick="closeModal()">&times;</button>
                </div>
                <div class="modal-body">
                    ${isEdit ? `
                        <div style="background: rgba(59, 130, 246, 0.08); border: 1px solid rgba(59, 130, 246, 0.25); border-radius: 0.375rem; padding: 0.65rem 0.85rem; margin-bottom: 1rem; font-size: 0.78rem; color: #93c5fd;">
                            ℹ️ <strong>Rule 6 (AWX Security):</strong> Leave password or secret fields empty to keep existing saved credentials.
                        </div>
                    ` : ''}

                    <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 1rem; margin-bottom: 1rem;">
                        <div>
                            <label class="form-label">Credential Name *</label>
                            <input type="text" id="credNameInput" class="form-input" placeholder="e.g. DB01 Server SSH or Cisco Core Switch" value="${cred ? escapeHtml(cred.name) : ''}">
                        </div>
                        <div>
                            <label class="form-label">Type *</label>
                            <select id="credTypeInput" class="form-input" onchange="onCredTypeSelect(this.value)" ${isEdit ? 'disabled' : ''}>
                                <option value="machine" ${initialType === 'machine' ? 'selected' : ''}>🖥️ Machine (SSH)</option>
                                <option value="network" ${initialType === 'network' ? 'selected' : ''}>🌐 Network (CLI/API)</option>
                            </select>
                        </div>
                    </div>

                    <div style="margin-bottom: 1rem;">
                        <label class="form-label">Description</label>
                        <input type="text" id="credDescInput" class="form-input" placeholder="Notes on usage or target hosts" value="${cred ? escapeHtml(cred.description || '') : ''}">
                    </div>

                    <div style="margin-bottom: 1rem;">
                        <label class="form-label">Username *</label>
                        <input type="text" id="credUsernameInput" class="form-input" placeholder="e.g. tai, root, developer, admin" value="${cred ? escapeHtml(cred.username) : ''}">
                        <div style="font-size: 0.72rem; color: #9ca3af; margin-top: 0.2rem;">SSH or Device Administrative User</div>
                    </div>

                    <!-- Dynamic Fields Container -->
                    <div id="credDynamicFields">
                        ${renderCredDynamicFields(initialType, initialAuthType, cred)}
                    </div>
                </div>
                <div class="modal-footer" style="display: flex; justify-content: flex-end; gap: 0.5rem;">
                    <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
                    <button class="btn btn-primary" onclick="submitCredentialModal('${credId || ''}')">${isEdit ? 'Save Changes' : 'Create Credential'}</button>
                </div>
            </div>
        </div>
    `;
    document.getElementById('modalContainer').innerHTML = modal;
}

async function submitCredentialModal(credId = '') {
    const isEdit = Boolean(credId);
    const name = document.getElementById('credNameInput')?.value?.trim();
    const type = document.getElementById('credTypeInput')?.value || 'machine';
    const description = document.getElementById('credDescInput')?.value?.trim() || '';
    const username = document.getElementById('credUsernameInput')?.value?.trim();

    if (!name || !username) {
        alert('Please fill in Credential Name and Username.');
        return;
    }

    const payload = {
        name,
        type,
        description,
        username
    };

    if (type === 'machine') {
        const authTypeRadio = document.querySelector('input[name="credAuthType"]:checked');
        const authType = authTypeRadio ? authTypeRadio.value : 'ssh_key';
        payload.authType = authType;

        if (authType === 'ssh_key') {
            payload.sshKeyPath = document.getElementById('credSshKeyPathInput')?.value?.trim() || '~/.ssh/id_rsa';
            const sshKeyData = document.getElementById('credSshKeyDataInput')?.value?.trim();
            if (sshKeyData) payload.sshKeyData = sshKeyData;
        } else {
            const password = document.getElementById('credPasswordInput')?.value;
            if (password) payload.password = password;
        }

        payload.becomeMethod = document.getElementById('credBecomeMethodInput')?.value || 'sudo';
        const becomePass = document.getElementById('credBecomePasswordInput')?.value;
        if (becomePass) payload.becomePassword = becomePass;
    } else {
        // Network
        const password = document.getElementById('credPasswordInput')?.value;
        if (password) payload.password = password;
        const enablePassword = document.getElementById('credEnablePasswordInput')?.value;
        if (enablePassword) payload.enablePassword = enablePassword;
    }

    try {
        const url = isEdit ? `${state.backendUrl}/api/credentials/${credId}` : `${state.backendUrl}/api/credentials`;
        const method = isEdit ? 'PUT' : 'POST';

        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            alert('Failed to save credential: ' + (errData.error || errData.errors?.join('; ') || res.statusText));
            return;
        }

        const savedCred = await res.json();
        if (isEdit) {
            const idx = state.credentials.findIndex(c => c.id === credId);
            if (idx !== -1) state.credentials[idx] = savedCred;
        } else {
            state.credentials.push(savedCred);
        }

        closeModal();
        renderView('credentials');
    } catch (err) {
        console.error('Save credential error:', err);
        alert('Error saving credential: ' + err.message);
    }
}

async function deleteCredentialConfirm(credId) {
    const cred = state.credentials.find(c => c.id === credId);
    const name = cred ? cred.name : credId;
    if (!confirm(`Are you sure you want to delete credential "${name}"?`)) {
        return;
    }

    try {
        const res = await fetch(`${state.backendUrl}/api/credentials/${credId}`, {
            method: 'DELETE'
        });
        if (!res.ok) {
            alert('Failed to delete credential');
            return;
        }
        state.credentials = state.credentials.filter(c => c.id !== credId);
        renderView('credentials');
    } catch (err) {
        console.error('Delete credential error:', err);
        alert('Error deleting credential: ' + err.message);
    }
}

// ============================================================
// INVENTORY VIEW — Hosts, Groups & Connectivity Management
// ============================================================
function renderInventoryView() {
    const hosts = state.inventory?.hosts || [];
    const groups = state.inventory?.groups || [];
    const prodCount = hosts.filter(h => h.environment === 'production').length;
    const stagingCount = hosts.filter(h => h.environment === 'staging').length;

    return `
        <div class="view-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
            <div>
                <h2 class="card-title" style="margin: 0; font-size: 1.5rem; display: flex; align-items: center; gap: 0.5rem;">
                    <span>🌐</span> Infrastructure Inventory
                </h2>
                <div style="font-size: 0.85rem; color: #9ca3af; margin-top: 0.25rem;">
                    Manage Enterprise Hosts, HA Clusters & Dynamic Ad-hoc Target resolution with Zero-Trust network guardrails.
                </div>
            </div>
            <div style="display: flex; gap: 0.75rem;">
                <button class="btn btn-secondary" onclick="openGroupModal()">+ New Group</button>
                <button class="btn btn-primary" onclick="openHostModal()">+ New Host</button>
            </div>
        </div>

        <div class="card">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; border-bottom: 1px solid #1f2937; padding-bottom: 0.75rem;">
                <div style="font-size: 0.85rem; color: #94a3b8; display: flex; gap: 1.25rem; align-items: center; flex-wrap: wrap;">
                    <span>Total Nodes: <strong style="color: #60a5fa;">${hosts.length}</strong></span>
                    <span>Cluster Groups: <strong style="color: #38bdf8;">${groups.length}</strong></span>
                    <span>🔴 Production: <strong style="color: #f87171;">${prodCount}</strong></span>
                    <span>🟡 Staging/Lab: <strong style="color: #fcd34d;">${stagingCount}</strong></span>
                </div>
                <button class="btn btn-secondary" style="padding: 0.25rem 0.65rem; font-size: 0.75rem;" onclick="loadInventoryData(true)">↻ Refresh</button>
            </div>

            <h3 style="font-size: 1rem; color: #f3f4f6; margin-bottom: 0.75rem; display: flex; align-items: center; gap: 0.4rem;">
                <span>🖥️</span> Managed Inventory Hosts
            </h3>

            <table class="table">
                <thead>
                    <tr>
                        <th>Host Name</th>
                        <th>Connection Target</th>
                        <th>Platform / OS</th>
                        <th>Environment</th>
                        <th>Cluster Groups</th>
                        <th>Default Credential</th>
                        <th>Connectivity</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${hosts.length > 0 ? hosts.map(h => {
                        const defaultCred = state.credentials.find(c => c.id === h.defaultCredentialId);
                        return `
                        <tr>
                            <td>
                                <div style="font-weight: 600; color: #f3f4f6; font-size: 0.9rem;">${escapeHtml(h.name)}</div>
                                ${h.description ? `<div style="font-size: 0.72rem; color: #9ca3af; margin-top: 0.15rem;">${escapeHtml(h.description)}</div>` : ''}
                            </td>
                            <td>
                                <code style="color: #93c5fd; background: rgba(59,130,246,0.1); padding: 0.2rem 0.45rem; border-radius: 0.25rem; font-size: 0.8rem; font-family: 'Fira Code', monospace;">
                                    ${escapeHtml(h.ansible_host)}:${h.ansible_port || 22}
                                </code>
                            </td>
                            <td>
                                <span style="font-size: 0.8rem; color: #cbd5e1;">${escapeHtml(h.os || 'Linux')}</span>
                            </td>
                            <td>
                                ${h.environment === 'production' 
                                    ? `<span class="badge-prod">Production</span>` 
                                    : `<span class="badge-staging">Staging</span>`}
                            </td>
                            <td>
                                <div style="display: flex; gap: 0.3rem; flex-wrap: wrap;">
                                    ${(h.groups || []).map(g => `<span class="badge-group">${escapeHtml(g)}</span>`).join('')}
                                </div>
                            </td>
                            <td>
                                ${defaultCred 
                                    ? `<span class="badge-machine" title="Bound Credential">🔐 ${escapeHtml(defaultCred.name)}</span>` 
                                    : `<span style="color: #6b7280; font-size: 0.75rem;">None</span>`}
                            </td>
                            <td>
                                <div style="display: flex; align-items: center; gap: 0.4rem;">
                                    <button class="btn btn-secondary" id="pingBtn_${escapeHtml(h.name)}" style="padding: 0.2rem 0.5rem; font-size: 0.72rem;" onclick="testHostConnectivity('${escapeHtml(h.name)}', 'pingBtn_${escapeHtml(h.name)}', 'pingRes_${escapeHtml(h.name)}')">
                                        ⚡ Ping
                                    </button>
                                    <span id="pingRes_${escapeHtml(h.name)}"></span>
                                </div>
                            </td>
                            <td>
                                <div style="display: flex; gap: 0.35rem;">
                                    <button class="btn btn-secondary" style="padding: 0.2rem 0.5rem; font-size: 0.72rem;" onclick="openHostModal('${escapeHtml(h.name)}')">Edit</button>
                                    <button class="btn btn-danger" style="padding: 0.2rem 0.5rem; font-size: 0.72rem;" onclick="deleteHostConfirm('${escapeHtml(h.name)}')">Delete</button>
                                </div>
                            </td>
                        </tr>
                        `;
                    }).join('') : `
                        <tr>
                            <td colspan="8" style="text-align: center; color: #9ca3af; padding: 2rem;">
                                No inventory hosts defined yet. Click "+ New Host" to add your first server.
                            </td>
                        </tr>
                    `}
                </tbody>
            </table>

            <!-- Groups Section -->
            <div style="margin-top: 2rem; border-top: 1px solid #1f2937; padding-top: 1.25rem;">
                <h3 style="font-size: 1rem; color: #f3f4f6; margin-bottom: 0.75rem; display: flex; align-items: center; gap: 0.4rem;">
                    <span>👥</span> Cluster & Inventory Groups
                </h3>
                <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 1rem;">
                    ${groups.length > 0 ? groups.map(g => `
                        <div class="cred-card">
                            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem;">
                                <div>
                                    <div style="font-weight: 600; color: #f3f4f6; font-size: 0.95rem;">${escapeHtml(g.name)}</div>
                                    <div style="font-size: 0.72rem; color: #9ca3af; margin-top: 0.15rem;">${escapeHtml(g.description || 'No description')}</div>
                                </div>
                                <span class="badge badge-info" style="font-size: 0.68rem;">${escapeHtml(g.domain || 'CNTT')}</span>
                            </div>
                            <div style="font-size: 0.75rem; color: #94a3b8; margin-bottom: 0.4rem;">
                                Members: <strong style="color: #60a5fa;">${(g.members || []).length}</strong> node(s)
                            </div>
                            <div style="display: flex; gap: 0.35rem; flex-wrap: wrap;">
                                ${(g.members || []).map(m => `
                                    <span class="badge-host">🖥️ ${escapeHtml(m)}</span>
                                `).join('')}
                            </div>
                        </div>
                    `).join('') : `
                        <div style="color: #9ca3af; font-size: 0.85rem;">No groups created.</div>
                    `}
                </div>
            </div>
        </div>
    `;
}

async function loadInventoryData(silent = false) {
    try {
        const res = await fetch(`${state.backendUrl}/api/inventory`);
        if (!res.ok) throw new Error('Failed to fetch inventory');
        state.inventory = await res.json();
        if (state.currentView === 'inventory') {
            renderView('inventory');
        }
        if (silent) {
            console.log('Inventory refreshed:', state.inventory);
        }
    } catch (err) {
        console.error('Error refreshing inventory:', err);
        if (!silent) alert('Failed to refresh inventory: ' + err.message);
    }
}

async function testHostConnectivity(target, btnId, resultId) {
    const btn = document.getElementById(btnId);
    const resultSpan = document.getElementById(resultId);
    if (!resultSpan) return;

    if (btn) {
        btn.disabled = true;
        btn.innerText = 'Testing...';
    }
    resultSpan.innerHTML = `<span style="font-size: 0.72rem; color: #9ca3af;">⏳ Connecting...</span>`;

    try {
        const res = await fetch(`${state.backendUrl}/api/inventory/ping`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ target })
        });
        const data = await res.json();

        if (res.ok && data.reachable) {
            resultSpan.innerHTML = `<span class="ping-badge-success" title="Resolved ${data.resolvedHost}:${data.port}">● ${data.latencyMs}ms</span>`;
        } else {
            const reason = data.error || 'Connection failed';
            resultSpan.innerHTML = `<span class="ping-badge-fail" title="${escapeHtml(reason)}">● Down</span>`;
        }
    } catch (err) {
        resultSpan.innerHTML = `<span class="ping-badge-fail" title="${escapeHtml(err.message)}">● Err</span>`;
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerText = '⚡ Ping';
        }
    }
}

function openHostModal(hostName = null) {
    const host = hostName ? (state.inventory?.hosts || []).find(h => h.name === hostName) : null;
    const isEdit = !!host;

    const modal = `
        <div class="modal-overlay" onclick="closeModal(event)">
            <div class="modal" onclick="event.stopPropagation()" style="max-width: 600px; width: 95%;">
                <div class="modal-header">
                    <div style="display: flex; align-items: center; gap: 0.5rem;">
                        <span style="font-size: 1.4rem;">🖥️</span>
                        <div>
                            <h2 class="modal-title" style="margin: 0;">${isEdit ? `Edit Host "${escapeHtml(host.name)}"` : 'Add Inventory Host'}</h2>
                            <div style="font-size: 0.8rem; color: #9ca3af;">Register physical, virtual, or container node target</div>
                        </div>
                    </div>
                    <button class="modal-close" onclick="closeModal()">&times;</button>
                </div>
                <div class="modal-body">
                    <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 1rem; margin-bottom: 1rem;">
                        <div>
                            <label class="form-label">Host Identifier (Name) *</label>
                            <input type="text" id="hostNameInput" class="form-input" placeholder="e.g. db01, cisco-core-r01" value="${escapeHtml(host?.name || '')}" ${isEdit ? 'readonly style="background: #1e293b;"' : ''}>
                        </div>
                        <div>
                            <label class="form-label">SSH / CLI Port *</label>
                            <input type="number" id="hostPortInput" class="form-input" placeholder="22" value="${host?.ansible_port || 22}">
                        </div>
                    </div>

                    <div style="margin-bottom: 1rem;">
                        <label class="form-label">Connection Target (IP Address or FQDN) *</label>
                        <input type="text" id="hostAddressInput" class="form-input" placeholder="e.g. 192.168.10.15 or db01.internal" value="${escapeHtml(host?.ansible_host || '')}">
                        <div style="font-size: 0.72rem; color: #9ca3af; margin-top: 0.2rem;">Zero-Trust check applies: RFC1918 private subnets or registered domains only.</div>
                    </div>

                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
                        <div>
                            <label class="form-label">Platform / OS</label>
                            <select id="hostOsInput" class="form-input">
                                <option value="Linux Ubuntu" ${(host?.os || '').includes('Ubuntu') ? 'selected' : ''}>Linux Ubuntu</option>
                                <option value="Linux RHEL / CentOS" ${(host?.os || '').includes('RHEL') ? 'selected' : ''}>Linux RHEL / Rocky</option>
                                <option value="Cisco IOS-XE" ${(host?.os || '').includes('Cisco') ? 'selected' : ''}>Cisco IOS-XE</option>
                                <option value="Huawei VRP" ${(host?.os || '').includes('Huawei') ? 'selected' : ''}>Huawei VRP</option>
                            </select>
                        </div>
                        <div>
                            <label class="form-label">Environment</label>
                            <select id="hostEnvInput" class="form-input">
                                <option value="production" ${host?.environment === 'production' ? 'selected' : ''}>Production (Strict Audit & +10 Risk)</option>
                                <option value="staging" ${host?.environment === 'staging' ? 'selected' : ''}>Staging / Lab</option>
                            </select>
                        </div>
                    </div>

                    <div style="margin-bottom: 1rem;">
                        <label class="form-label">Default Execution Credential (Vault)</label>
                        <select id="hostCredInput" class="form-input">
                            <option value="">-- None / Select at Execution Time --</option>
                            ${state.credentials.map(c => `
                                <option value="${c.id}" ${host?.defaultCredentialId === c.id ? 'selected' : ''}>
                                    [${c.type.toUpperCase()}] ${escapeHtml(c.name)} (${c.username})
                                </option>
                            `).join('')}
                        </select>
                        <div style="font-size: 0.72rem; color: #9ca3af; margin-top: 0.2rem;">Auto-selects this credential in New Change dialog when targeting this host.</div>
                    </div>

                    <div style="margin-bottom: 1rem;">
                        <label class="form-label">Groups (Comma-separated or check below)</label>
                        <input type="text" id="hostGroupsInput" class="form-input" placeholder="e.g. db_servers, patroni_cluster" value="${(host?.groups || ['all']).join(', ')}">
                    </div>

                    <div style="margin-bottom: 1rem;">
                        <label class="form-label">Description</label>
                        <input type="text" id="hostDescInput" class="form-input" placeholder="Primary database node with Patroni HA" value="${escapeHtml(host?.description || '')}">
                    </div>
                </div>
                <div class="modal-footer" style="display: flex; justify-content: flex-end; gap: 0.75rem;">
                    <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
                    <button class="btn btn-primary" onclick="saveHostFromModal()">${isEdit ? 'Save Changes' : 'Register Host'}</button>
                </div>
            </div>
        </div>
    `;
    document.getElementById('modalContainer').innerHTML = modal;
}

async function saveHostFromModal() {
    const name = document.getElementById('hostNameInput').value.trim();
    const ansible_host = document.getElementById('hostAddressInput').value.trim();
    const ansible_port = parseInt(document.getElementById('hostPortInput').value, 10) || 22;
    const os = document.getElementById('hostOsInput').value;
    const environment = document.getElementById('hostEnvInput').value;
    const defaultCredentialId = document.getElementById('hostCredInput').value || null;
    const groupsRaw = document.getElementById('hostGroupsInput').value;
    const description = document.getElementById('hostDescInput').value.trim();

    if (!name || !ansible_host) {
        alert('Host Identifier and Connection Address are required');
        return;
    }

    const groups = groupsRaw.split(',').map(s => s.trim()).filter(Boolean);
    if (!groups.includes('all')) groups.push('all');

    try {
        const res = await fetch(`${state.backendUrl}/api/inventory/hosts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name,
                ansible_host,
                ansible_port,
                os,
                environment,
                defaultCredentialId,
                groups,
                description
            })
        });

        const data = await res.json();
        if (!res.ok) {
            alert('Failed to save host: ' + (data.error || 'Server error'));
            return;
        }

        closeModal();
        await loadInventoryData(true);
        renderView('inventory');
    } catch (err) {
        alert('Error saving host: ' + err.message);
    }
}

async function deleteHostConfirm(hostName) {
    if (!confirm(`Are you sure you want to remove host "${hostName}" from the inventory?`)) {
        return;
    }

    try {
        const res = await fetch(`${state.backendUrl}/api/inventory/hosts/${hostName}`, {
            method: 'DELETE'
        });
        if (!res.ok) {
            alert('Failed to delete host');
            return;
        }
        await loadInventoryData(true);
        renderView('inventory');
    } catch (err) {
        alert('Error deleting host: ' + err.message);
    }
}

function openGroupModal(groupName = null) {
    const group = groupName ? (state.inventory?.groups || []).find(g => g.name === groupName) : null;
    const isEdit = !!group;
    const allHosts = state.inventory?.hosts || [];

    const modal = `
        <div class="modal-overlay" onclick="closeModal(event)">
            <div class="modal" onclick="event.stopPropagation()" style="max-width: 540px; width: 95%;">
                <div class="modal-header">
                    <div style="display: flex; align-items: center; gap: 0.5rem;">
                        <span style="font-size: 1.4rem;">👥</span>
                        <div>
                            <h2 class="modal-title" style="margin: 0;">${isEdit ? `Edit Group "${escapeHtml(group.name)}"` : 'Create Cluster Group'}</h2>
                            <div style="font-size: 0.8rem; color: #9ca3af;">Group multiple servers for multi-host playbook execution</div>
                        </div>
                    </div>
                    <button class="modal-close" onclick="closeModal()">&times;</button>
                </div>
                <div class="modal-body">
                    <div style="margin-bottom: 1rem;">
                        <label class="form-label">Group Name *</label>
                        <input type="text" id="groupNameInput" class="form-input" placeholder="e.g. patroni_cluster, core_routers" value="${escapeHtml(group?.name || '')}" ${isEdit ? 'readonly style="background: #1e293b;"' : ''}>
                    </div>
                    <div style="margin-bottom: 1rem;">
                        <label class="form-label">Domain</label>
                        <select id="groupDomainInput" class="form-input">
                            <option value="CNTT" ${group?.domain === 'CNTT' ? 'selected' : ''}>CNTT</option>
                            <option value="IP" ${group?.domain === 'IP' ? 'selected' : ''}>IP / Backbone</option>
                            <option value="5G" ${group?.domain === '5G' ? 'selected' : ''}>5G Core</option>
                        </select>
                    </div>
                    <div style="margin-bottom: 1rem;">
                        <label class="form-label">Description</label>
                        <input type="text" id="groupDescInput" class="form-input" placeholder="High Availability Database Cluster" value="${escapeHtml(group?.description || '')}">
                    </div>
                    <div style="margin-bottom: 1rem;">
                        <label class="form-label">Select Group Members</label>
                        <div style="max-height: 180px; overflow-y: auto; background: #111827; border: 1px solid #1f2937; border-radius: 0.375rem; padding: 0.75rem;">
                            ${allHosts.map(h => {
                                const checked = (group?.members || []).includes(h.name);
                                return `
                                    <label style="display: flex; align-items: center; gap: 0.5rem; padding: 0.3rem 0; color: #d1d5db; font-size: 0.85rem; cursor: pointer;">
                                        <input type="checkbox" name="groupMemberCheckbox" value="${escapeHtml(h.name)}" ${checked ? 'checked' : ''} style="width: auto;">
                                        <span><strong>${escapeHtml(h.name)}</strong> (${escapeHtml(h.ansible_host)})</span>
                                    </label>
                                `;
                            }).join('')}
                        </div>
                    </div>
                </div>
                <div class="modal-footer" style="display: flex; justify-content: flex-end; gap: 0.75rem;">
                    <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
                    <button class="btn btn-primary" onclick="saveGroupFromModal()">${isEdit ? 'Save Changes' : 'Create Group'}</button>
                </div>
            </div>
        </div>
    `;
    document.getElementById('modalContainer').innerHTML = modal;
}

async function saveGroupFromModal() {
    const name = document.getElementById('groupNameInput').value.trim();
    const domain = document.getElementById('groupDomainInput').value;
    const description = document.getElementById('groupDescInput').value.trim();
    const checkboxes = document.querySelectorAll('input[name="groupMemberCheckbox"]:checked');
    const members = Array.from(checkboxes).map(cb => cb.value);

    if (!name) {
        alert('Group Name is required');
        return;
    }

    try {
        const res = await fetch(`${state.backendUrl}/api/inventory/groups`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, domain, description, members })
        });
        const data = await res.json();
        if (!res.ok) {
            alert('Failed to save group: ' + (data.error || 'Server error'));
            return;
        }

        closeModal();
        await loadInventoryData(true);
        renderView('inventory');
    } catch (err) {
        alert('Error saving group: ' + err.message);
    }
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
// MODAL — 3-TAB ACTION PRIMITIVE CREATOR & TASK DEFINITION BUILDER
// ============================================================

function openNewActionModal() {
    // Default draft state
    state.newActionDraft = {
        currentTab: 'metadata',
        id: '',
        name: '',
        domain: 'CNTT',
        capability: 'SERVICE_RESTART',
        description: '',
        riskDefault: 'LOW',
        inputs: [
            { name: 'service_name', label: 'Service Name', type: 'string', default: 'nginx.service', required: true, validation: '^[a-zA-Z0-9@._-]+$' }
        ],
        outputs: [
            { name: 'service_status', type: 'string', description: 'Systemd active state' }
        ],
        selectedModule: 'ansible.builtin.systemd',
        moduleParams: {
            name: '{{ service_name }}',
            state: 'restarted',
            enabled: 'yes'
        },
        taskRegister: 'service_status'
    };

    renderActionCreatorModal();
}

function renderActionCreatorModal() {
    const draft = state.newActionDraft;
    const schemas = state.moduleSchemas || [];
    const currentSchema = schemas.find(s => s.module === draft.selectedModule) || schemas[0];

    const modal = `
        <div class="modal-overlay" onclick="closeModal(event)">
            <div class="modal" onclick="event.stopPropagation()" style="max-width: 820px; width: 95%;">
                <div class="modal-header">
                    <div style="display: flex; align-items: center; gap: 0.6rem;">
                        <span style="font-size: 1.5rem;">⚡</span>
                        <div>
                            <h2 class="modal-title" style="margin: 0; font-size: 1.25rem;">Create Action Primitive</h2>
                            <div style="font-size: 0.8rem; color: #9ca3af;">Define an atomic automation block: Metadata → Inputs/Outputs Contract → Ansible Task Logic</div>
                        </div>
                    </div>
                    <button class="modal-close" onclick="closeModal()">&times;</button>
                </div>
                
                <div class="modal-body" style="max-height: 75vh; overflow-y: auto;">
                    <!-- 3-Tab Header -->
                    <div class="action-tabs-nav">
                        <button type="button" class="action-tab-btn ${draft.currentTab === 'metadata' ? 'active' : ''}" onclick="switchActionCreatorTab('metadata')">
                            1. Metadata
                        </button>
                        <button type="button" class="action-tab-btn ${draft.currentTab === 'inputs_outputs' ? 'active' : ''}" onclick="switchActionCreatorTab('inputs_outputs')">
                            2. Inputs & Outputs Contract
                            <span class="action-tab-badge">${draft.inputs.length} in / ${draft.outputs.length} out</span>
                        </button>
                        <button type="button" class="action-tab-btn ${draft.currentTab === 'task_builder' ? 'active' : ''}" onclick="switchActionCreatorTab('task_builder')">
                            3. Task Definition Builder 🆕
                            <span class="action-tab-badge" style="background: #059669; color: white;">YAML</span>
                        </button>
                    </div>

                    <!-- TAB 1: METADATA -->
                    <div id="tabContent_metadata" style="display: ${draft.currentTab === 'metadata' ? 'block' : 'none'};">
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.25rem;">
                            <div>
                                <label class="form-label">Action ID * <span style="font-size: 0.72rem; color: #9ca3af;">(UPPER_SNAKE_CASE)</span></label>
                                <input type="text" id="actionIdInput" class="form-input" value="${draft.id}" placeholder="e.g., NGINX_RESTART" oninput="this.value = this.value.toUpperCase(); state.newActionDraft.id = this.value;">
                                <div style="font-size: 0.72rem; color: #9ca3af; margin-top: 0.25rem;">Unique action identifier within catalog</div>
                            </div>
                            <div>
                                <label class="form-label">Display Name *</label>
                                <input type="text" id="actionNameInput" class="form-input" value="${draft.name}" placeholder="e.g., Restart Nginx Web Service" oninput="state.newActionDraft.name = this.value;">
                            </div>
                        </div>

                        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1rem; margin-bottom: 1.25rem;">
                            <div>
                                <label class="form-label">Domain *</label>
                                <select id="actionDomainInput" class="form-input" onchange="state.newActionDraft.domain = this.value;">
                                    ${['CNTT', 'IP', '5G', 'Transport'].map(d => `<option value="${d}" ${draft.domain === d ? 'selected' : ''}>${d}</option>`).join('')}
                                </select>
                            </div>
                            <div>
                                <label class="form-label">Capability *</label>
                                <select id="actionCapabilityInput" class="form-input" onchange="state.newActionDraft.capability = this.value;">
                                    ${['SERVICE_RESTART', 'HEALTH_CHECK', 'POST_VERIFY', 'FILE_CONFIG', 'CLI_COMMAND', 'CUSTOM'].map(c => `<option value="${c}" ${draft.capability === c ? 'selected' : ''}>${c}</option>`).join('')}
                                </select>
                            </div>
                            <div>
                                <label class="form-label">Default Risk *</label>
                                <select id="actionRiskInput" class="form-input" onchange="state.newActionDraft.riskDefault = this.value;">
                                    ${['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map(r => `<option value="${r}" ${draft.riskDefault === r ? 'selected' : ''}>${r}</option>`).join('')}
                                </select>
                            </div>
                        </div>

                        <div style="margin-bottom: 1.25rem;">
                            <label class="form-label">Description</label>
                            <textarea id="actionDescInput" class="form-input" rows="2" placeholder="Describe the purpose of this atomic primitive..." oninput="state.newActionDraft.description = this.value;">${draft.description}</textarea>
                        </div>

                        <div style="display: flex; justify-content: flex-end; margin-top: 1.5rem;">
                            <button type="button" class="btn btn-primary" onclick="switchActionCreatorTab('inputs_outputs')">
                                Next: Inputs & Outputs Contract ➔
                            </button>
                        </div>
                    </div>

                    <!-- TAB 2: INPUTS & OUTPUTS BUILDER -->
                    <div id="tabContent_inputs_outputs" style="display: ${draft.currentTab === 'inputs_outputs' ? 'block' : 'none'};">
                        <!-- Inputs Section -->
                        <div style="margin-bottom: 2rem;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
                                <div>
                                    <h3 style="font-size: 0.95rem; color: #f3f4f6; margin: 0;">1. Input Parameters (Đầu Vào Cần Cung Cấp)</h3>
                                    <div style="font-size: 0.75rem; color: #9ca3af;">Các biến đầu vào operator có thể tùy chỉnh khi clone sang Change</div>
                                </div>
                                <button type="button" class="btn btn-secondary" style="font-size: 0.75rem; padding: 0.3rem 0.6rem;" onclick="addDraftInput()">
                                    + Add Input Parameter
                                </button>
                            </div>

                            <div id="draftInputsContainer">
                                ${draft.inputs.map((inp, idx) => `
                                    <div class="param-builder-row">
                                        <div style="flex: 1.2;">
                                            <input type="text" class="form-input" placeholder="var_name" value="${inp.name}" style="font-family: monospace; font-size: 0.8rem;" oninput="state.newActionDraft.inputs[${idx}].name = this.value; updateActionTaskYamlPreview();">
                                        </div>
                                        <div style="flex: 1.5;">
                                            <input type="text" class="form-input" placeholder="Display Label" value="${inp.label}" style="font-size: 0.8rem;" oninput="state.newActionDraft.inputs[${idx}].label = this.value;">
                                        </div>
                                        <div style="flex: 1;">
                                            <select class="form-input" style="font-size: 0.8rem;" onchange="state.newActionDraft.inputs[${idx}].type = this.value;">
                                                <option value="string" ${inp.type === 'string' ? 'selected' : ''}>string</option>
                                                <option value="number" ${inp.type === 'number' ? 'selected' : ''}>number</option>
                                                <option value="boolean" ${inp.type === 'boolean' ? 'selected' : ''}>boolean</option>
                                            </select>
                                        </div>
                                        <div style="flex: 1.5;">
                                            <input type="text" class="form-input" placeholder="Default Value" value="${inp.default !== undefined ? inp.default : ''}" style="font-size: 0.8rem;" oninput="state.newActionDraft.inputs[${idx}].default = this.value;">
                                        </div>
                                        <div style="display: flex; align-items: center; gap: 0.25rem;">
                                            <label style="font-size: 0.75rem; color: #9ca3af; display: flex; align-items: center; gap: 0.2rem;">
                                                <input type="checkbox" ${inp.required ? 'checked' : ''} onchange="state.newActionDraft.inputs[${idx}].required = this.checked;">
                                                Req
                                            </label>
                                            <button type="button" class="btn btn-secondary" style="color: #fca5a5; padding: 0.2rem 0.5rem; font-size: 0.75rem;" onclick="removeDraftInput(${idx})">✕</button>
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>

                        <!-- Outputs Section -->
                        <div style="margin-bottom: 1.5rem; border-top: 1px solid #374151; padding-top: 1.25rem;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
                                <div>
                                    <h3 style="font-size: 0.95rem; color: #f3f4f6; margin: 0;">2. Exposed Facts / Outputs (Kết Quả Xuất Ra)</h3>
                                    <div style="font-size: 0.75rem; color: #9ca3af;">Các facts được export vào Ansible runtime facts để các bước sau tái sử dụng</div>
                                </div>
                                <button type="button" class="btn btn-secondary" style="font-size: 0.75rem; padding: 0.3rem 0.6rem;" onclick="addDraftOutput()">
                                    + Add Output Fact
                                </button>
                            </div>

                            <div id="draftOutputsContainer">
                                ${draft.outputs.map((out, idx) => `
                                    <div class="param-builder-row">
                                        <div style="flex: 1.5;">
                                            <input type="text" class="form-input" placeholder="fact_name" value="${out.name}" style="font-family: monospace; font-size: 0.8rem; color: #34d399;" oninput="state.newActionDraft.outputs[${idx}].name = this.value; updateActionTaskYamlPreview();">
                                        </div>
                                        <div style="flex: 1;">
                                            <select class="form-input" style="font-size: 0.8rem;" onchange="state.newActionDraft.outputs[${idx}].type = this.value;">
                                                <option value="string" ${out.type === 'string' ? 'selected' : ''}>string</option>
                                                <option value="boolean" ${out.type === 'boolean' ? 'selected' : ''}>boolean</option>
                                                <option value="number" ${out.type === 'number' ? 'selected' : ''}>number</option>
                                            </select>
                                        </div>
                                        <div style="flex: 2;">
                                            <input type="text" class="form-input" placeholder="Description of exported fact" value="${out.description || ''}" style="font-size: 0.8rem;" oninput="state.newActionDraft.outputs[${idx}].description = this.value;">
                                        </div>
                                        <button type="button" class="btn btn-secondary" style="color: #fca5a5; padding: 0.2rem 0.5rem; font-size: 0.75rem;" onclick="removeDraftOutput(${idx})">✕</button>
                                    </div>
                                `).join('')}
                            </div>
                        </div>

                        <div style="display: flex; justify-content: space-between; margin-top: 1.5rem;">
                            <button type="button" class="btn btn-secondary" onclick="switchActionCreatorTab('metadata')">← Back to Metadata</button>
                            <button type="button" class="btn btn-primary" onclick="switchActionCreatorTab('task_builder')">
                                Next: Task Definition Builder ➔
                            </button>
                        </div>
                    </div>

                    <!-- TAB 3: TASK DEFINITION BUILDER -->
                    <div id="tabContent_task_builder" style="display: ${draft.currentTab === 'task_builder' ? 'block' : 'none'};">
                        <div style="background: #1e293b; border: 1px solid #334155; border-radius: 0.5rem; padding: 0.75rem 1rem; margin-bottom: 1.25rem; font-size: 0.82rem; color: #93c5fd;">
                            💡 <strong>Ansible Task Generator:</strong> Chọn Module Ansible và điền tham số. Sử dụng nút <strong>{{ Bind Input }}</strong> để liên kết tham số của module với Input đã khai báo ở Tab 2. Task sinh ra là mã Ansible thật 100% không cần viết tay!
                        </div>

                        <!-- Step 1: Select Module -->
                        <div style="margin-bottom: 1.25rem;">
                            <label class="form-label" style="font-size: 0.85rem;">Step 1: Select Ansible Module</label>
                            <select id="selectedModuleSelect" class="form-input" style="font-family: monospace; font-size: 0.875rem;" onchange="onActionModuleSelected(this.value)">
                                ${schemas.map(s => `
                                    <option value="${s.module}" ${s.module === draft.selectedModule ? 'selected' : ''}>
                                        ${s.module} (${s.displayName})
                                    </option>
                                `).join('')}
                            </select>
                        </div>

                        <!-- Module Warning if High Risk -->
                        ${currentSchema && currentSchema.warning ? `
                            <div style="background: rgba(239, 68, 68, 0.1); border: 1px solid #ef4444; border-radius: 0.5rem; padding: 0.75rem 1rem; margin-bottom: 1.25rem; font-size: 0.82rem; color: #fca5a5;">
                                ⚠️ ${currentSchema.warning}
                            </div>
                        ` : ''}

                        <!-- Step 2: Dynamic Form Fields based on Module Schema -->
                        <div style="background: #111827; border: 1px solid #374151; border-radius: 0.5rem; padding: 1rem; margin-bottom: 1.25rem;">
                            <h4 style="font-size: 0.875rem; color: #f3f4f6; margin-bottom: 1rem; display: flex; justify-content: space-between;">
                                <span>Step 2: Module Parameters (${currentSchema ? currentSchema.displayName : 'Custom'})</span>
                                <span style="font-family: monospace; font-size: 0.75rem; color: #60a5fa;">${draft.selectedModule}</span>
                            </h4>

                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                                ${(currentSchema?.fields || []).map(f => {
                                    const val = draft.moduleParams[f.name] !== undefined ? draft.moduleParams[f.name] : (f.default || '');
                                    const availableInputs = draft.inputs.map(i => i.name);
                                    return `
                                        <div>
                                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.35rem;">
                                                <label class="form-label" style="margin: 0; font-size: 0.8rem;">
                                                    ${f.label || f.name} ${f.required ? '<span style="color:#ef4444;">*</span>' : ''}
                                                </label>
                                                ${availableInputs.length > 0 ? `
                                                    <select class="bind-var-btn" title="Bind variable from Tab 2 inputs" onchange="bindInputToModuleField('${f.name}', this.value); this.value='';">
                                                        <option value="">{{ Bind Input }}</option>
                                                        ${availableInputs.map(inpName => `<option value="{{ ${inpName} }}">{{ ${inpName} }}</option>`).join('')}
                                                    </select>
                                                ` : ''}
                                            </div>
                                            ${f.type === 'choice' ? `
                                                <select class="form-input" id="mod_field_${f.name}" onchange="onActionModuleFieldChanged('${f.name}', this.value)">
                                                    ${(f.choices || []).map(c => `<option value="${c}" ${val === c ? 'selected' : ''}>${c}</option>`).join('')}
                                                </select>
                                            ` : `
                                                <input type="${f.type === 'number' ? 'number' : 'text'}" class="form-input" id="mod_field_${f.name}" value="${val}" placeholder="${f.placeholder || ''}" oninput="onActionModuleFieldChanged('${f.name}', this.value)">
                                            `}
                                            ${f.description ? `<div style="font-size: 0.7rem; color: #9ca3af; margin-top: 0.2rem;">${f.description}</div>` : ''}
                                        </div>
                                    `;
                                }).join('')}
                            </div>
                        </div>

                        <!-- Step 3: Register Output -->
                        <div style="margin-bottom: 1.25rem;">
                            <label class="form-label" style="font-size: 0.85rem;">Step 3: Register Result Fact (Output Binding)</label>
                            <div style="display: flex; gap: 0.5rem;">
                                <input type="text" class="form-input" id="taskRegisterInput" placeholder="e.g., service_res or output_fact" value="${draft.taskRegister || ''}" style="font-family: monospace; font-size: 0.85rem;" oninput="state.newActionDraft.taskRegister = this.value; updateActionTaskYamlPreview();">
                                ${draft.outputs.length > 0 ? `
                                    <select class="form-input" style="width: auto; font-size: 0.8rem;" onchange="document.getElementById('taskRegisterInput').value = this.value; state.newActionDraft.taskRegister = this.value; updateActionTaskYamlPreview();">
                                        <option value="">Bind Output...</option>
                                        ${draft.outputs.map(o => `<option value="${o.name}">${o.name}</option>`).join('')}
                                    </select>
                                ` : ''}
                            </div>
                        </div>

                        <!-- Step 4: Live Task YAML Preview -->
                        <div style="margin-bottom: 1.5rem;">
                            <label class="form-label" style="font-size: 0.85rem; display: flex; justify-content: space-between;">
                                <span>Step 4: Live Generated Task YAML (Syntax Verified)</span>
                                <span class="badge badge-success" style="font-size: 0.65rem;">Valid Ansible</span>
                            </label>
                            <pre id="actionTaskYamlPreview" class="code-block" style="background: #0d1117; color: #58a6ff; font-family: monospace; font-size: 0.82rem; padding: 1rem; border-radius: 0.375rem; border: 1px solid #30363d; max-height: 240px; overflow-y: auto; margin: 0;"></pre>
                        </div>

                        <div style="display: flex; justify-content: space-between; margin-top: 1.5rem;">
                            <button type="button" class="btn btn-secondary" onclick="switchActionCreatorTab('inputs_outputs')">← Back to Inputs</button>
                            <button type="button" class="btn btn-primary" onclick="saveNewActionFromDraft()" style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); font-weight: 600;">
                                ✓ Save Action Primitive
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    document.getElementById('modalContainer').innerHTML = modal;
    if (draft.currentTab === 'task_builder') {
        updateActionTaskYamlPreview();
    }
}

function switchActionCreatorTab(tab) {
    if (state.newActionDraft) {
        state.newActionDraft.currentTab = tab;
        renderActionCreatorModal();
    }
}

function addDraftInput() {
    if (!state.newActionDraft) return;
    const count = state.newActionDraft.inputs.length + 1;
    state.newActionDraft.inputs.push({
        name: `param_${count}`,
        label: `Parameter ${count}`,
        type: 'string',
        default: '',
        required: true,
        validation: ''
    });
    renderActionCreatorModal();
}

function removeDraftInput(idx) {
    if (!state.newActionDraft) return;
    state.newActionDraft.inputs.splice(idx, 1);
    renderActionCreatorModal();
}

function addDraftOutput() {
    if (!state.newActionDraft) return;
    const count = state.newActionDraft.outputs.length + 1;
    state.newActionDraft.outputs.push({
        name: `result_${count}`,
        type: 'string',
        description: `Exported result from step`
    });
    renderActionCreatorModal();
}

function removeDraftOutput(idx) {
    if (!state.newActionDraft) return;
    state.newActionDraft.outputs.splice(idx, 1);
    renderActionCreatorModal();
}

function onActionModuleSelected(moduleName) {
    if (!state.newActionDraft) return;
    state.newActionDraft.selectedModule = moduleName;
    const schemas = state.moduleSchemas || [];
    const schema = schemas.find(s => s.module === moduleName);
    state.newActionDraft.moduleParams = {};
    if (schema && schema.fields) {
        schema.fields.forEach(f => {
            if (f.default !== undefined) {
                state.newActionDraft.moduleParams[f.name] = f.default;
            }
        });
    }
    renderActionCreatorModal();
}

function onActionModuleFieldChanged(fieldName, val) {
    if (!state.newActionDraft) return;
    state.newActionDraft.moduleParams[fieldName] = val;
    updateActionTaskYamlPreview();
}

function bindInputToModuleField(fieldName, inputVar) {
    if (!state.newActionDraft || !inputVar) return;
    state.newActionDraft.moduleParams[fieldName] = inputVar;
    const inputEl = document.getElementById(`mod_field_${fieldName}`);
    if (inputEl) inputEl.value = inputVar;
    updateActionTaskYamlPreview();
}

function updateActionTaskYamlPreview() {
    const el = document.getElementById('actionTaskYamlPreview');
    if (!el || !state.newActionDraft) return;

    const draft = state.newActionDraft;
    const actionName = draft.name || draft.id || 'Custom Action';
    const taskName = `${actionName}`;
    const moduleName = draft.selectedModule || 'ansible.builtin.debug';
    const params = draft.moduleParams || {};
    const register = draft.taskRegister || '';

    let yaml = `- name: "${taskName}"\n  ${moduleName}:\n`;
    for (const [k, v] of Object.entries(params)) {
        if (v !== '' && v !== null && v !== undefined) {
            yaml += `    ${k}: ${typeof v === 'number' || typeof v === 'boolean' ? v : `"${v}"`}\n`;
        }
    }
    if (register) {
        yaml += `  register: ${register}\n`;
    }

    el.innerText = yaml;
}

async function saveNewActionFromDraft() {
    const draft = state.newActionDraft;
    if (!draft) return;

    const id = (draft.id || '').trim();
    const name = (draft.name || '').trim();
    const domain = draft.domain || 'CNTT';
    const capability = draft.capability || 'SERVICE_RESTART';
    const risk = draft.riskDefault || 'LOW';

    if (!id) {
        alert('Action ID is required (UPPER_SNAKE_CASE)');
        switchActionCreatorTab('metadata');
        return;
    }

    if (!/^[A-Z][A-Z0-9_]+$/.test(id)) {
        alert('Action ID must be in UPPER_SNAKE_CASE (e.g. NGINX_RESTART)');
        switchActionCreatorTab('metadata');
        return;
    }

    if (!name) {
        alert('Action Name is required');
        switchActionCreatorTab('metadata');
        return;
    }

    // Build the runnable task template object
    const taskObj = {
        name: name,
        module: draft.selectedModule || 'ansible.builtin.debug',
        args: { ...draft.moduleParams }
    };
    if (draft.taskRegister) {
        taskObj.register = draft.taskRegister;
    }

    const payload = {
        id,
        name,
        domain,
        capability,
        description: draft.description || '',
        inputs: draft.inputs || [],
        outputs: draft.outputs || [],
        task_template: [ taskObj ],
        implementation: {
            provider: 'ansible',
            estimatedDurationSec: 60
        },
        verification: {
            type: 'embedded',
            note: 'Playbook self-verifies via Ansible module'
        },
        compensation: {
            type: 'escalate',
            action: 'NOTIFY_ONCALL'
        },
        riskDefault: risk
    };

    try {
        const res = await fetch(`${state.backendUrl}/api/actions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            const err = await res.json();
            alert('Error creating action: ' + (err.error || res.statusText));
            return;
        }

        const createdAction = await res.json();
        state.actions.push(createdAction);
        closeModal();
        renderView('actions');
        alert(`Action "${createdAction.id}" created successfully with runnable Ansible task!`);
    } catch (e) {
        alert('Failed to create action: ' + e.message);
    }
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
// MODAL — Blueprint Composer (Visual Workflow Builder)
// ============================================================
function openNewBlueprintModal() {
    if (state.actions.length === 0) {
        alert('No actions in catalog. Create an Action first before building a Blueprint.');
        return;
    }

    state.composerSteps = [];

    const modal = `
        <div class="modal-overlay" onclick="closeModal(event)">
            <div class="modal" onclick="event.stopPropagation()" style="max-width: 980px; width: 95%;">
                <div class="modal-header">
                    <div style="display: flex; align-items: center; gap: 0.5rem;">
                        <span style="font-size: 1.5rem;">🧩</span>
                        <div>
                            <h2 class="modal-title" style="margin: 0;">Blueprint Composer</h2>
                            <div style="font-size: 0.8rem; color: #9ca3af;">Assemble atomic Action primitives into a multi-step orchestration workflow</div>
                        </div>
                    </div>
                    <button class="modal-close" onclick="closeModal()">&times;</button>
                </div>
                <div class="modal-body">
                    <!-- Metadata Row -->
                    <div style="display: grid; grid-template-columns: 2fr 1fr 1.5fr 1fr; gap: 1rem; padding-bottom: 1rem; border-bottom: 1px solid #374151;">
                        <div>
                            <label class="form-label">Blueprint Name *</label>
                            <input type="text" id="bpName" class="form-input" placeholder="e.g., db-maintenance-cycle" style="font-family: monospace;">
                            <div style="font-size: 0.7rem; color: #9ca3af; margin-top: 0.25rem;">kebab-case (lowercase, hyphens)</div>
                        </div>
                        <div>
                            <label class="form-label">Version *</label>
                            <input type="text" id="bpVersion" class="form-input" value="1.0.0">
                        </div>
                        <div>
                            <label class="form-label">Owner *</label>
                            <input type="text" id="bpOwner" class="form-input" placeholder="e.g., DevOps-Admin" value="DevOps-Admin">
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

                    <!-- 2-Column Composer Layout -->
                    <div class="composer-container">
                        <!-- Left: Available Primitives -->
                        <div class="composer-col">
                            <div class="composer-col-header">
                                <span style="font-weight: 600; font-size: 0.9rem; color: #f3f4f6;">1. Select Action Primitives</span>
                                <span class="badge badge-info" style="font-size: 0.7rem;">${state.actions.length} available</span>
                            </div>
                            <input type="text" id="actionSearchInput" class="form-input" placeholder="🔍 Search actions..." style="margin-bottom: 0.75rem; font-size: 0.85rem;" oninput="filterComposerActions(this.value)">
                            <div id="composerActionsList" class="composer-list">
                                ${state.actions.map(a => `
                                    <div class="composer-action-card">
                                        <div style="flex: 1; padding-right: 0.5rem;">
                                            <div style="font-weight: 600; color: #f3f4f6; font-size: 0.85rem;">${a.name}</div>
                                            <div style="font-size: 0.7rem; color: #9ca3af; font-family: monospace;">${a.id}</div>
                                            <div style="display: flex; gap: 0.4rem; margin-top: 0.25rem;">
                                                <span class="badge badge-info" style="font-size: 0.65rem;">${a.domain}</span>
                                                <span class="badge badge-${a.riskDefault === 'HIGH' || a.riskDefault === 'CRITICAL' ? 'danger' : 'warning'}" style="font-size: 0.65rem;">${a.riskDefault}</span>
                                            </div>
                                        </div>
                                        <button type="button" class="btn btn-primary" style="padding: 0.35rem 0.65rem; font-size: 0.75rem; white-space: nowrap;" onclick="addComposerStep('${a.id}')">
                                            + Add Step
                                        </button>
                                    </div>
                                `).join('')}
                            </div>
                        </div>

                        <!-- Right: Execution Sequence Pipeline -->
                        <div class="composer-col">
                            <div class="composer-col-header">
                                <span style="font-weight: 600; font-size: 0.9rem; color: #f3f4f6;">2. Orchestration Pipeline Sequence</span>
                                <span class="badge badge-success" style="font-size: 0.75rem;"><span id="composerStepCount">0</span> steps</span>
                            </div>
                            <div id="composerStepsContainer" class="composer-list">
                                <div style="text-align: center; color: #9ca3af; padding: 3rem 1rem; border: 2px dashed #374151; border-radius: 0.5rem;">
                                    <div style="font-size: 2rem; margin-bottom: 0.5rem;">🧩</div>
                                    <div style="font-weight: 600; color: #d1d5db;">Workflow is empty</div>
                                    <div style="font-size: 0.8rem; margin-top: 0.25rem;">Click <strong>+ Add Step</strong> on any Action to the left</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Policies Row -->
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-top: 1rem; padding-top: 1rem; border-top: 1px solid #374151;">
                        <div>
                            <label class="form-label">Compensation on Failure</label>
                            <select id="bpCompensation" class="form-input">
                                <option value="NOTIFY_ONCALL">NOTIFY_ONCALL (Escalate to On-call)</option>
                                <option value="ROLLBACK">ROLLBACK (Execute compensating actions)</option>
                            </select>
                        </div>
                        <div>
                            <label class="form-label">Lifecycle Status</label>
                            <select id="bpStatus" class="form-input">
                                <option value="PUBLISHED" selected>PUBLISHED (Ready for execution)</option>
                                <option value="DRAFT">DRAFT (Draft mode)</option>
                                <option value="IN_REVIEW">IN_REVIEW (Pending review)</option>
                            </select>
                        </div>
                    </div>
                </div>
                <div class="modal-footer" style="display: flex; justify-content: space-between; align-items: center;">
                    <button type="button" class="btn btn-secondary" onclick="openYamlPreviewModal()" style="display: inline-flex; align-items: center; gap: 0.35rem;">
                        <span>📄</span> Preview Ansible YAML
                    </button>
                    <div style="display: flex; gap: 0.5rem;">
                        <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
                        <button class="btn btn-primary" onclick="createBlueprint()" style="background: linear-gradient(135deg, #3b82f6 0%, #10b981 100%);">
                            ✓ Save & Publish Blueprint
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
    document.getElementById('modalContainer').innerHTML = modal;
}

// ============================================================
// MODAL — Blueprint Skeleton Viewer (Timeline + Clone-to-Change)
// ============================================================
async function openBlueprintDetailModal(bpName) {
    let bp = state.blueprints.find(b => b.metadata.name === bpName);
    if (!bp || !bp.spec || !bp.spec.steps) {
        try {
            const res = await fetch(`${state.backendUrl}/api/blueprints/${bpName}`);
            if (res.ok) bp = await res.json();
        } catch (err) {
            console.error('Error fetching blueprint details:', err);
        }
    }
    if (!bp) {
        alert('Blueprint not found');
        return;
    }

    if (state.actions.length === 0) {
        try {
            const actRes = await fetch(`${state.backendUrl}/api/actions`);
            if (actRes.ok) state.actions = await actRes.json();
        } catch (e) {}
    }

    const steps = bp.spec.steps || [];

    const modal = `
        <div class="modal-overlay" onclick="closeModal(event)">
            <div class="modal" onclick="event.stopPropagation()" style="max-width: 860px; width: 95%;">
                <div class="modal-header">
                    <div style="display: flex; align-items: center; gap: 0.65rem;">
                        <span style="font-size: 1.6rem;">🧩</span>
                        <div>
                            <div style="display: flex; align-items: center; gap: 0.6rem;">
                                <h2 class="modal-title" style="margin: 0; font-size: 1.25rem;">${bp.metadata.name}</h2>
                                <span class="badge badge-info" style="font-size: 0.72rem;">v${bp.metadata.version}</span>
                                <span class="badge badge-${bp.spec.status === 'PUBLISHED' ? 'success' : bp.spec.status === 'DRAFT' ? 'warning' : 'info'}" style="font-size: 0.72rem;">${bp.spec.status}</span>
                            </div>
                            <div style="font-size: 0.8rem; color: #9ca3af; margin-top: 0.2rem;">
                                Domain: <strong style="color: #cbd5e1;">${bp.spec.domain}</strong> · Owner: <strong style="color: #cbd5e1;">${bp.spec.owner}</strong>
                            </div>
                        </div>
                    </div>
                    <button class="modal-close" onclick="closeModal()">&times;</button>
                </div>

                <div class="modal-body" style="max-height: 72vh; overflow-y: auto; padding-right: 0.5rem;">
                    <!-- Blueprint Skeleton Concept Banner -->
                    <div style="background: rgba(59, 130, 246, 0.08); border: 1px solid rgba(59, 130, 246, 0.25); border-radius: 0.5rem; padding: 0.85rem 1rem; margin-bottom: 1.25rem; display: flex; align-items: flex-start; gap: 0.75rem;">
                        <span style="font-size: 1.3rem;">ℹ️</span>
                        <div style="font-size: 0.82rem; color: #cbd5e1; line-height: 1.45;">
                            <strong>Bản thiết kế khung (Blueprint Skeleton):</strong> Đây là khung xương quy trình đóng gói chuỗi các Action Primitive nguyên tử, <strong>không lưu cứng tham số máy chủ hay mật khẩu runtime</strong>. Nhấn <strong>🚀 Clone & Tạo Change</strong> để sinh ra bản Change thực thi và tùy biến cấu hình cho từng máy chủ mục tiêu.
                        </div>
                    </div>

                    ${bp.spec.description ? `
                        <div style="font-size: 0.875rem; color: #d1d5db; margin-bottom: 1.25rem; line-height: 1.5; background: #111827; padding: 0.75rem 1rem; border-radius: 0.375rem; border: 1px solid #1f2937;">
                            ${bp.spec.description}
                        </div>
                    ` : ''}

                    <div style="font-weight: 600; font-size: 0.92rem; color: #f3f4f6; margin-bottom: 0.75rem; display: flex; justify-content: space-between; align-items: center;">
                        <span>Sequential Skeleton Pipeline (${steps.length} Actions):</span>
                        <span style="font-size: 0.75rem; color: #9ca3af; font-weight: normal;">Ordered Execution flow</span>
                    </div>

                    <!-- Steps List -->
                    <div style="display: flex; flex-direction: column; gap: 1rem;">
                        ${steps.map((stepItem, idx) => {
                            const actionId = typeof stepItem === 'string' ? stepItem : stepItem.action;
                            const stepInputs = (stepItem && stepItem.inputs) ? stepItem.inputs : {};
                            const action = state.actions.find(a => a.id === actionId);
                            const actName = action ? action.name : actionId;
                            const capability = action ? action.capability : 'CUSTOM';
                            const moduleName = action?.task_template?.[0]?.module 
                                ? action.task_template[0].module.replace('ansible.builtin.', '')
                                : (action?.implementation?.provider || 'ansible');
                            const inputsList = action?.inputs || [];
                            const outputsList = action?.outputs || [];

                            const stepId = (stepItem && stepItem.stepId) 
                                ? stepItem.stepId 
                                : (actionId ? actionId.toLowerCase().replace(/[^a-z0-9_]/g, '_') : `step_${idx + 1}`);

                            // Dynamic Data flow description text
                            let dataFlowHint = '';
                            if (outputsList.length > 0) {
                                dataFlowHint = `Bước này xuất <strong>${outputsList.length} Fact(s)</strong>: [${outputsList.map(o => `<code style="color:#38bdf8; font-family: monospace;">${o.name}</code>`).join(', ')}] phục vụ Data Piping cho các bước sau.`;
                            } else {
                                dataFlowHint = `Thực thi tác vụ ${capability} và lưu audit log kết quả thực thi (PASS/FAIL).`;
                            }

                            return `
                                <div style="background: #111827; border: 1px solid #374151; border-radius: 0.5rem; padding: 1rem; transition: border-color 0.2s;">
                                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.6rem;">
                                        <div style="display: flex; align-items: center; gap: 0.6rem;">
                                            <span class="composer-step-number" style="background: #3b82f6; width: 26px; height: 26px; font-size: 0.8rem;">${idx + 1}</span>
                                            <div>
                                                <div style="display: flex; align-items: center; gap: 0.45rem;">
                                                    <span style="font-weight: 600; color: #f9fafb; font-size: 0.95rem;">${actName}</span>
                                                    <span class="badge" style="background: #1e293b; color: #38bdf8; font-family: monospace; font-size: 0.68rem; border: 1px solid #334155;">ID: ${stepId}</span>
                                                </div>
                                                <div style="font-family: monospace; font-size: 0.75rem; color: #60a5fa;">
                                                    ${actionId}
                                                </div>
                                            </div>
                                        </div>
                                        <div style="display: flex; gap: 0.4rem; align-items: center;">
                                            <span class="badge" style="background: #1e293b; color: #38bdf8; border: 1px solid #0284c7; font-family: monospace; font-size: 0.72rem;">
                                                module: ${moduleName}
                                            </span>
                                            <span class="badge badge-info" style="font-size: 0.7rem;">${capability}</span>
                                        </div>
                                    </div>

                                    <!-- Data Flow Hint -->
                                    <div style="font-size: 0.75rem; color: #94a3b8; background: #1e293b; padding: 0.4rem 0.65rem; border-radius: 0.25rem; margin-bottom: 0.75rem; border-left: 2px solid #38bdf8;">
                                        <strong>Luồng dữ liệu:</strong> ${dataFlowHint}
                                        ${idx > 0 ? `<div style="margin-top: 0.25rem; font-size: 0.7rem; color: #64748b;">🔗 Có thể liên kết nhận Fact từ các bước trước qua nút <strong>🔗 Dùng Fact</strong> khi tạo Change.</div>` : ''}
                                    </div>

                                    <div style="display: grid; grid-template-columns: 1.2fr 1fr; gap: 0.85rem; font-size: 0.8rem;">
                                        <!-- Inputs -->
                                        <div style="background: #0f172a; padding: 0.6rem 0.75rem; border-radius: 0.375rem; border: 1px solid #1e293b;">
                                            <strong style="color: #9ca3af; display: block; margin-bottom: 0.35rem; font-size: 0.75rem;">
                                                📥 Khung tham số yêu cầu (Inputs Schema):
                                            </strong>
                                            ${inputsList.length > 0 ? inputsList.map(inp => `
                                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.25rem; padding-bottom: 0.25rem; border-bottom: 1px dashed #1e293b;">
                                                    <span style="color: #cbd5e1; font-family: monospace;">${inp.name}</span>
                                                    <span style="color: #94a3b8; font-size: 0.72rem;">${inp.type}${inp.required ? ' <span style="color:#f87171;">*</span>' : ''}</span>
                                                </div>
                                            `).join('') : `<span style="color: #6b7280; font-style: italic;">Không yêu cầu tham số đầu vào</span>`}
                                            <div style="font-size: 0.68rem; color: #64748b; margin-top: 0.35rem; font-style: italic;">
                                                * Giá trị cụ thể sẽ do Operator điền khi bấm "Clone & Tạo Change"
                                            </div>
                                        </div>

                                        <!-- Outputs -->
                                        <div style="background: #0f172a; padding: 0.6rem 0.75rem; border-radius: 0.375rem; border: 1px solid #1e293b;">
                                            <strong style="color: #9ca3af; display: block; margin-bottom: 0.35rem; font-size: 0.75rem;">
                                                📤 Facts đầu ra (Outputs):
                                            </strong>
                                            ${outputsList.length > 0 ? outputsList.map(out => `
                                                <div style="margin-bottom: 0.25rem;">
                                                    <span style="color: #34d399; font-family: monospace; font-size: 0.75rem;">${out.name}</span>
                                                    <span style="color: #6b7280; font-size: 0.7rem;">(${out.type})</span>
                                                    ${out.description ? `<div style="color: #94a3b8; font-size: 0.7rem;">${out.description}</div>` : ''}
                                                </div>
                                            `).join('') : `<span style="color: #6b7280; font-style: italic;">Không xuất facts</span>`}
                                        </div>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>

                <div class="modal-footer" style="display: flex; justify-content: space-between; align-items: center; margin-top: 1rem; padding-top: 1rem; border-top: 1px solid #374151;">
                    <div style="display: flex; gap: 0.5rem;">
                        <button type="button" class="btn btn-secondary" onclick="openYamlPreviewModal('${bp.metadata.name}')" style="display: inline-flex; align-items: center; gap: 0.35rem;">
                            <span>📄</span> View Ansible Playbook YAML
                        </button>
                        <button type="button" class="btn btn-secondary" onclick="openEditBlueprintModal('${bp.metadata.name}')">
                            ⚙ Edit Skeleton
                        </button>
                    </div>
                    <div style="display: flex; gap: 0.5rem; align-items: center;">
                        <button class="btn btn-secondary" onclick="closeModal()">Close</button>
                        <button class="btn btn-primary" style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); font-weight: 600; padding: 0.5rem 1.1rem; display: inline-flex; align-items: center; gap: 0.4rem;" onclick="closeModal(); openNewChangeModal('${bp.metadata.name}');">
                            <span>🚀</span> Clone & Tạo Change
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    document.getElementById('modalContainer').innerHTML = modal;
}

// ============================================================
// MODAL — Blueprint Composer / Editor
// ============================================================
async function openEditBlueprintModal(bpName) {
    let bp = state.blueprints.find(b => b.metadata.name === bpName);
    if (!bp || !bp.spec || !bp.spec.steps) {
        try {
            const res = await fetch(`${state.backendUrl}/api/blueprints/${bpName}`);
            if (res.ok) bp = await res.json();
        } catch (err) {
            console.error('Error fetching blueprint for editing:', err);
        }
    }
    if (!bp) {
        alert('Blueprint not found');
        return;
    }

    if (state.actions.length === 0) {
        try {
            const actRes = await fetch(`${state.backendUrl}/api/actions`);
            if (actRes.ok) state.actions = await actRes.json();
        } catch (e) {}
    }

    state.composerSteps = (bp.spec.steps || []).map((s, idx) => ({
        stepIndex: idx + 1,
        action: typeof s === 'string' ? s : s.action,
        inputs: (s && s.inputs) ? { ...s.inputs } : {}
    }));

    const modal = `
        <div class="modal-overlay" onclick="closeModal(event)">
            <div class="modal" onclick="event.stopPropagation()" style="max-width: 980px; width: 95%;">
                <div class="modal-header">
                    <div style="display: flex; align-items: center; gap: 0.5rem;">
                        <span style="font-size: 1.5rem;">⚙️</span>
                        <div>
                            <h2 class="modal-title" style="margin: 0;">Edit Blueprint Skeleton: ${bpName}</h2>
                            <div style="font-size: 0.8rem; color: #9ca3af;">Configure sequential action pipeline, individual inputs & execution parameters</div>
                        </div>
                    </div>
                    <button class="modal-close" onclick="closeModal()">&times;</button>
                </div>
                <div class="modal-body">
                    <!-- Metadata Row -->
                    <div style="display: grid; grid-template-columns: 2fr 1fr 1.5fr 1fr; gap: 1rem; padding-bottom: 1rem; border-bottom: 1px solid #374151;">
                        <div>
                            <label class="form-label">Blueprint Name</label>
                            <input type="text" id="bpName" class="form-input" value="${bpName}" disabled style="opacity: 0.6; font-family: monospace;">
                        </div>
                        <div>
                            <label class="form-label">Version *</label>
                            <input type="text" id="bpVersion" class="form-input" value="${bp.metadata.version}">
                        </div>
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
                    
                    <div style="margin-top: 0.75rem; margin-bottom: 1rem;">
                        <label class="form-label">Description</label>
                        <input type="text" id="bpDescription" class="form-input" value="${bp.spec.description || ''}" placeholder="Mô tả quy trình...">
                    </div>

                    <!-- 2-Column Composer Layout -->
                    <div class="composer-container">
                        <div class="composer-col">
                            <div class="composer-col-header">
                                <span style="font-weight: 600; font-size: 0.9rem; color: #f3f4f6;">Available Action Primitives</span>
                                <span class="badge badge-info" style="font-size: 0.7rem;">${state.actions.length}</span>
                            </div>
                            <input type="text" id="actionSearchInput" class="form-input" placeholder="🔍 Search actions..." style="margin-bottom: 0.75rem; font-size: 0.85rem;" oninput="filterComposerActions(this.value)">
                            <div id="composerActionsList" class="composer-list">
                                ${state.actions.map(a => `
                                    <div class="composer-action-card">
                                        <div style="flex: 1; padding-right: 0.5rem;">
                                            <div style="font-weight: 600; color: #f3f4f6; font-size: 0.85rem;">${a.name}</div>
                                            <div style="font-size: 0.7rem; color: #9ca3af; font-family: monospace;">${a.id}</div>
                                            <div style="display: flex; gap: 0.4rem; margin-top: 0.25rem;">
                                                <span class="badge badge-info" style="font-size: 0.65rem;">${a.domain}</span>
                                                <span class="badge badge-${a.riskDefault === 'HIGH' || a.riskDefault === 'CRITICAL' ? 'danger' : 'warning'}" style="font-size: 0.65rem;">${a.riskDefault}</span>
                                            </div>
                                        </div>
                                        <button type="button" class="btn btn-primary" style="padding: 0.35rem 0.65rem; font-size: 0.75rem; white-space: nowrap;" onclick="addComposerStep('${a.id}')">
                                            + Add Step
                                        </button>
                                    </div>
                                `).join('')}
                            </div>
                        </div>

                        <div class="composer-col">
                            <div class="composer-col-header">
                                <span style="font-weight: 600; font-size: 0.9rem; color: #f3f4f6;">Orchestration Pipeline Sequence</span>
                                <span class="badge badge-success" style="font-size: 0.75rem;"><span id="composerStepCount">${state.composerSteps.length}</span> steps</span>
                            </div>
                            <div id="composerStepsContainer" class="composer-list"></div>
                        </div>
                    </div>

                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-top: 1rem; padding-top: 1rem; border-top: 1px solid #374151;">
                        <div>
                            <label class="form-label">On Failure</label>
                            <select id="bpCompensation" class="form-input">
                                <option value="NOTIFY_ONCALL">NOTIFY_ONCALL</option>
                                <option value="ROLLBACK">ROLLBACK</option>
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
                <div class="modal-footer" style="display: flex; justify-content: space-between; align-items: center;">
                    <div style="display: flex; gap: 0.5rem;">
                        <button class="btn btn-secondary" style="color: #fca5a5;" onclick="confirmDeleteBlueprint('${bpName}')">Delete</button>
                        <button type="button" class="btn btn-secondary" onclick="openYamlPreviewModal('${bpName}')" style="display: inline-flex; align-items: center; gap: 0.35rem;">
                            <span>📄</span> Preview Ansible YAML
                        </button>
                    </div>
                    <div style="display: flex; gap: 0.5rem;">
                        <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
                        <button class="btn btn-primary" onclick="saveBlueprint('${bpName}')">Save Changes</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    document.getElementById('modalContainer').innerHTML = modal;
    renderComposerStepsList();
}

// Composer helper functions
function addComposerStep(actionId) {
    const act = state.actions.find(a => a.id === actionId);
    const baseSlug = (actionId || 'step').toLowerCase().replace(/[^a-z0-9_]/g, '_');
    let stepId = baseSlug;
    let counter = 1;
    while (state.composerSteps.some(s => s.stepId === stepId)) {
        stepId = `${baseSlug}_${counter++}`;
    }
    state.composerSteps.push({
        stepIndex: state.composerSteps.length + 1,
        stepId: stepId,
        action: actionId
    });
    renderComposerStepsList();
}

function removeComposerStep(index) {
    const stepToDelete = state.composerSteps[index];
    if (stepToDelete) {
        const deletedStepId = stepToDelete.stepId || (typeof stepToDelete.action === 'string' ? stepToDelete.action.toLowerCase().replace(/[^a-z0-9_]/g, '_') : '');
        const dependentSteps = [];
        state.composerSteps.forEach((s, sIdx) => {
            if (sIdx === index) return;
            const inputs = s.inputs || {};
            for (const [, v] of Object.entries(inputs)) {
                if (typeof v === 'string' && v.includes(`steps.${deletedStepId}.`)) {
                    dependentSteps.push(`Step ${sIdx + 1}`);
                }
            }
        });
        if (dependentSteps.length > 0) {
            if (!confirm(`⚠️ CẢNH BÁO PHỤ THUỘC (Dangling Reference):\nCác bước [${dependentSteps.join(', ')}] đang sử dụng Output Fact của bước này!\nXóa bước này sẽ làm gãy tham chiếu dữ liệu.\n\nBạn có chắc chắn muốn xóa không?`)) {
                return;
            }
        }
    }
    state.composerSteps.splice(index, 1);
    renderComposerStepsList();
}

function moveComposerStep(index, delta) {
    const newIndex = index + delta;
    if (newIndex < 0 || newIndex >= state.composerSteps.length) return;
    const temp = state.composerSteps[index];
    state.composerSteps[index] = state.composerSteps[newIndex];
    state.composerSteps[newIndex] = temp;
    renderComposerStepsList();
}

function renderComposerStepsList() {
    const container = document.getElementById('composerStepsContainer');
    const countEl = document.getElementById('composerStepCount');
    if (countEl) countEl.innerText = state.composerSteps.length;
    if (!container) return;

    if (state.composerSteps.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; color: #9ca3af; padding: 3rem 1rem; border: 2px dashed #374151; border-radius: 0.5rem;">
                <div style="font-size: 2rem; margin-bottom: 0.5rem;">🧩</div>
                <div style="font-weight: 600; color: #d1d5db;">Workflow is empty</div>
                <div style="font-size: 0.8rem; margin-top: 0.25rem;">Click <strong>+ Add Step</strong> on any Action to the left</div>
            </div>
        `;
        return;
    }

    container.innerHTML = state.composerSteps.map((stepObj, idx) => {
        const actionId = typeof stepObj === 'string' ? stepObj : stepObj.action;
        const action = state.actions.find(a => a.id === actionId);
        const name = action ? action.name : actionId;
        const domain = action ? action.domain : 'CNTT';
        const moduleName = action?.task_template?.[0]?.module 
            ? action.task_template[0].module.replace('ansible.builtin.', '')
            : (action?.implementation?.provider || 'ansible');
        const inputsList = (action?.inputs || []).map(i => i.name);
        const outputsList = (action?.outputs || []).map(o => o.name);

        return `
            <div class="composer-step-item" style="border-left: 3px solid #3b82f6;">
                <div style="display: flex; align-items: flex-start; gap: 0.75rem; flex: 1;">
                    <span class="composer-step-number" style="margin-top: 0.2rem;">${idx + 1}</span>
                    <div style="flex: 1;">
                        <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                            <div style="font-weight: 600; color: #f9fafb; font-size: 0.875rem;">${name}</div>
                            <span class="badge badge-info" style="font-size: 0.65rem;">${domain}</span>
                            <span class="badge" style="background: #1e293b; color: #38bdf8; border: 1px solid #0284c7; font-family: monospace; font-size: 0.68rem;">
                                ${moduleName}
                            </span>
                        </div>
                        <div style="font-size: 0.75rem; color: #60a5fa; font-family: monospace; margin-top: 0.15rem;">${actionId}</div>
                        <div style="display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.35rem; font-size: 0.72rem;">
                            <span style="color: #9ca3af;">📥 Cần tham số: ${inputsList.length > 0 ? inputsList.map(inp => `<code style="color: #cbd5e1; background: #111827; padding: 0.1rem 0.3rem; border-radius: 0.2rem;">${inp}</code>`).join(' ') : '<em style="color:#6b7280;">Không</em>'}</span>
                            <span style="color: #9ca3af;">📤 Xuất facts: ${outputsList.length > 0 ? outputsList.map(out => `<code style="color: #34d399; background: #111827; padding: 0.1rem 0.3rem; border-radius: 0.2rem;">${out}</code>`).join(' ') : '<em style="color:#6b7280;">Không</em>'}</span>
                        </div>
                    </div>
                </div>
                <div style="display: flex; align-items: center; gap: 0.4rem;">
                    <div class="composer-controls">
                        <button type="button" class="composer-btn-ctrl" title="Di chuyển lên" onclick="moveComposerStep(${idx}, -1)" ${idx === 0 ? 'disabled style="opacity:0.3;"' : ''}>▲</button>
                        <button type="button" class="composer-btn-ctrl" title="Di chuyển xuống" onclick="moveComposerStep(${idx}, 1)" ${idx === state.composerSteps.length - 1 ? 'disabled style="opacity:0.3;"' : ''}>▼</button>
                        <button type="button" class="composer-btn-ctrl danger" title="Xóa bước khỏi Skeleton" onclick="removeComposerStep(${idx})">✕</button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// ============================================================
// MODAL: Configure Step Parameters (Per-Action Configuration with Anti-typo Validation)
// ============================================================
function openConfigureStepModal(stepIndex) {
    const step = state.composerSteps[stepIndex];
    if (!step) return;

    const actionId = typeof step === 'string' ? step : step.action;
    const action = state.actions.find(a => a.id === actionId);
    if (!action) {
        alert('Action definition not found');
        return;
    }

    const currentInputs = (step && step.inputs) ? { ...step.inputs } : {};
    // Ensure all defined inputs have a value
    (action.inputs || []).forEach(inp => {
        if (currentInputs[inp.name] === undefined && inp.default !== undefined) {
            currentInputs[inp.name] = inp.default;
        }
    });

    const subModal = `
        <div class="modal-overlay" id="configureStepModalOverlay" style="z-index: 1100;">
            <div class="modal" onclick="event.stopPropagation()" style="max-width: 600px; width: 90%;">
                <div class="modal-header">
                    <div style="display: flex; align-items: center; gap: 0.5rem;">
                        <span style="font-size: 1.3rem;">⚙️</span>
                        <div>
                            <h3 class="modal-title" style="margin: 0; font-size: 1.1rem;">Step ${stepIndex + 1}: ${action.name}</h3>
                            <div style="font-size: 0.75rem; color: #9ca3af;">Configure inputs & operational variables for this action</div>
                        </div>
                    </div>
                    <button class="modal-close" onclick="closeConfigureStepModal()">&times;</button>
                </div>
                <div class="modal-body" style="max-height: 60vh; overflow-y: auto;">
                    ${(action.inputs && action.inputs.length > 0) ? action.inputs.map(inp => {
                        const val = currentInputs[inp.name] !== undefined ? currentInputs[inp.name] : (inp.default || '');
                        return `
                            <div style="margin-bottom: 1.25rem;">
                                <label class="form-label" style="display: flex; justify-content: space-between;">
                                    <span>${inp.label || inp.name} ${inp.required ? '<span style="color:#ef4444;">*</span>' : ''}</span>
                                    <span style="font-size: 0.7rem; color: #9ca3af; font-family: monospace;">{{ ${inp.name} }}</span>
                                </label>
                                <input 
                                    type="${inp.type === 'number' ? 'number' : 'text'}" 
                                    id="cfg_input_${inp.name}" 
                                    class="form-input" 
                                    value="${val}" 
                                    placeholder="${inp.placeholder || ''}"
                                    data-validation="${inp.validation || ''}"
                                    data-required="${inp.required ? 'true' : 'false'}"
                                    oninput="validateAntiTypoInput(this)"
                                >
                                ${inp.description ? `<div style="font-size: 0.75rem; color: #9ca3af; margin-top: 0.3rem;">${inp.description}</div>` : ''}
                                <div id="cfg_err_${inp.name}" class="validation-error-text" style="display: none;"></div>
                            </div>
                        `;
                    }).join('') : `
                        <div style="text-align: center; color: #9ca3af; padding: 2rem;">
                            No configurable input parameters defined for this action.
                        </div>
                    `}
                </div>
                <div class="modal-footer" style="display: flex; justify-content: flex-end; gap: 0.5rem;">
                    <button class="btn btn-secondary" onclick="closeConfigureStepModal()">Cancel</button>
                    <button class="btn btn-primary" onclick="saveConfigureStepInputs(${stepIndex})">✓ Apply Inputs</button>
                </div>
            </div>
        </div>
    `;

    const div = document.createElement('div');
    div.id = 'configureStepModalWrapper';
    div.innerHTML = subModal;
    document.body.appendChild(div);
}

function closeConfigureStepModal() {
    const el = document.getElementById('configureStepModalWrapper');
    if (el) el.remove();
}

function validateAntiTypoInput(inputEl, stepIdx) {
    const val = inputEl.value.trim();
    const pattern = inputEl.dataset.validation;
    const isRequired = inputEl.dataset.required === 'true';
    const errEl = document.getElementById(inputEl.id.replace('cfg_input_', 'cfg_err_').replace('chg_cfg_', 'cfg_err_'));

    let errorMsg = '';
    
    // Strict Anti-Typo Validator for Dynamic Fact Expressions {{ steps.<stepId>.<factName> }}
    const dynamicMatch = val.match(/^\{\{\s*steps\.([a-zA-Z0-9_\-]+)\.([a-zA-Z0-9_\-]+)\s*\}\}$/);
    if (dynamicMatch) {
        const [, targetStepId, targetFactName] = dynamicMatch;
        let isValidFact = false;
        let stepFound = false;
        let availableFacts = [];

        if (stepIdx !== undefined && state.changeStepOverrides && state.changeStepOverrides.length > 0) {
            for (let pIdx = 0; pIdx < stepIdx; pIdx++) {
                const prevStep = state.changeStepOverrides[pIdx];
                if (!prevStep) continue;
                const prevAction = state.actions.find(a => a.id === prevStep.action);
                const sSlug = prevStep.stepId || (prevAction?.id.toLowerCase().replace(/[^a-z0-9_]/g, '_'));
                if (sSlug === targetStepId) {
                    stepFound = true;
                    availableFacts = (prevAction?.outputs || []).map(o => o.name);
                    if (availableFacts.includes(targetFactName)) {
                        isValidFact = true;
                    }
                    break;
                }
            }
            if (!stepFound) {
                errorMsg = `Step '${targetStepId}' không tồn tại trong các bước trước!`;
            } else if (!isValidFact) {
                errorMsg = `Fact '${targetFactName}' không tồn tại trong Step '${targetStepId}'! (Có sẵn: ${availableFacts.join(', ') || 'none'})`;
            }
        }
    } else if (val.startsWith('{{') && val.endsWith('}}')) {
        // Any other jinja expression with typo in syntax
        if (!/^\{\{\s*[\w\.\-_\[\]\'\"]+\s*\}\}$/.test(val)) {
            errorMsg = 'Sai cú pháp Jinja2 (ví dụ đúng: {{ steps.step_id.fact_name }})';
        }
    } else if (isRequired && !val) {
        errorMsg = 'This parameter cannot be empty';
    } else if (pattern && val) {
        const regex = new RegExp(pattern);
        if (!regex.test(val)) {
            if (pattern.includes('https?')) {
                errorMsg = 'Invalid URL format (must start with http:// or https://)';
            } else if (pattern.includes('^[a-zA-Z0-9@._-]+$')) {
                errorMsg = 'Invalid service name format (only letters, numbers, @, ., _, - allowed)';
            } else if (pattern.includes('^[1-9]')) {
                errorMsg = 'Must be a positive integer';
            } else {
                errorMsg = 'Value does not match required format';
            }
        }
    }

    if (errorMsg) {
        inputEl.classList.add('input-invalid');
        if (errEl) {
            errEl.innerText = '⚠ ' + errorMsg;
            errEl.style.display = 'block';
        }
        return false;
    } else {
        inputEl.classList.remove('input-invalid');
        if (errEl) errEl.style.display = 'none';
        return true;
    }
}

function saveConfigureStepInputs(stepIndex) {
    const step = state.composerSteps[stepIndex];
    if (!step) return;

    const actionId = typeof step === 'string' ? step : step.action;
    const action = state.actions.find(a => a.id === actionId);
    if (!action) return;

    const newInputs = {};
    let hasError = false;

    (action.inputs || []).forEach(inp => {
        const inputEl = document.getElementById(`cfg_input_${inp.name}`);
        if (inputEl) {
            const isValid = validateAntiTypoInput(inputEl);
            if (!isValid) hasError = true;
            newInputs[inp.name] = inp.type === 'number' ? Number(inputEl.value) : inputEl.value.trim();
        }
    });

    if (hasError) {
        alert('Please resolve input validation errors before applying.');
        return;
    }

    if (typeof state.composerSteps[stepIndex] === 'string') {
        state.composerSteps[stepIndex] = {
            stepIndex: stepIndex + 1,
            action: actionId,
            inputs: newInputs
        };
    } else {
        state.composerSteps[stepIndex].inputs = newInputs;
    }

    closeConfigureStepModal();
    renderComposerStepsList();
}

// ============================================================
// MODAL: YAML Playbook Preview & Export
// ============================================================
async function openYamlPreviewModal(bpName = null) {
    let yamlContent = '';
    let title = bpName ? `Playbook Preview: ${bpName}` : 'Generated Playbook Preview';

    try {
        if (bpName) {
            const res = await fetch(`${state.backendUrl}/api/blueprints/${bpName}/yaml`);
            if (res.ok) {
                const data = await res.json();
                yamlContent = data.yaml;
            } else {
                yamlContent = `# Error fetching YAML from backend: ${res.statusText}`;
            }
        } else {
            // Build local representation for current composer state
            const bpPayload = getBlueprintFormData();
            if (!bpPayload) return;
            // Generate YAML preview locally or via API
            const res = await fetch(`${state.backendUrl}/api/blueprints/${bpPayload.name}/yaml`);
            if (res.ok) {
                const data = await res.json();
                yamlContent = data.yaml;
            } else {
                // Synthesize representation
                yamlContent = `# ========================================================\n# Dynamic Playbook: ${bpPayload.name}\n# Generated from ${bpPayload.steps.length} composed actions\n# ========================================================\n---\n`;
                bpPayload.steps.forEach((s, idx) => {
                    yamlContent += `\n# Action ${idx + 1}: ${s.action}\n- name: "Action ${idx + 1}: ${s.action}"\n  hosts: db_servers\n  vars:\n`;
                    Object.entries(s.inputs || {}).forEach(([k, v]) => {
                        yamlContent += `    ${k}: "${v}"\n`;
                    });
                });
            }
        }
    } catch (e) {
        yamlContent = `# Failed to generate YAML preview: ${e.message}`;
    }

    const modal = `
        <div class="modal-overlay" onclick="closeModal(event)">
            <div class="modal" onclick="event.stopPropagation()" style="max-width: 900px; width: 95%;">
                <div class="modal-header">
                    <div style="display: flex; align-items: center; gap: 0.5rem;">
                        <span style="font-size: 1.4rem;">📄</span>
                        <div>
                            <h2 class="modal-title" style="margin: 0;">${title}</h2>
                            <div style="font-size: 0.8rem; color: #9ca3af;">Ansible Playbook generated with per-action data flow (set_fact)</div>
                        </div>
                    </div>
                    <button class="modal-close" onclick="closeModal()">&times;</button>
                </div>
                <div class="modal-body" style="padding-top: 0.5rem;">
                    <div class="yaml-toolbar">
                        <span style="font-size: 0.75rem; color: #9ca3af; font-family: monospace;">ansible-playbook format (.yml)</span>
                        <div style="display: flex; gap: 0.5rem;">
                            <button class="btn btn-secondary" style="padding: 0.25rem 0.6rem; font-size: 0.75rem;" onclick="copyYamlToClipboard()">
                                📋 Copy Playbook
                            </button>
                            <button class="btn btn-secondary" style="padding: 0.25rem 0.6rem; font-size: 0.75rem;" onclick="downloadYamlFile('${bpName || 'db_maintenance'}')">
                                💾 Download .yml
                            </button>
                        </div>
                    </div>
                    <pre class="yaml-preview-modal" id="yamlContentPre">${escapeHtml(yamlContent)}</pre>
                </div>
                <div class="modal-footer" style="display: flex; justify-content: flex-end;">
                    <button class="btn btn-secondary" onclick="closeModal()">Close</button>
                </div>
            </div>
        </div>
    `;

    document.getElementById('modalContainer').innerHTML = modal;
}

function copyYamlToClipboard() {
    const el = document.getElementById('yamlContentPre');
    if (!el) return;
    navigator.clipboard.writeText(el.innerText).then(() => {
        alert('Playbook YAML copied to clipboard!');
    }).catch(err => {
        alert('Copy failed: ' + err.message);
    });
}

function downloadYamlFile(filename = 'playbook') {
    const el = document.getElementById('yamlContentPre');
    if (!el) return;
    const blob = new Blob([el.innerText], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.yml`;
    a.click();
    URL.revokeObjectURL(url);
}

function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function filterComposerActions(searchTerm = '') {
    const container = document.getElementById('composerActionsList');
    if (!container) return;
    const term = searchTerm.toLowerCase().trim();
    const filtered = state.actions.filter(a => 
        a.name.toLowerCase().includes(term) || 
        a.id.toLowerCase().includes(term) || 
        (a.capability && a.capability.toLowerCase().includes(term))
    );
    container.innerHTML = filtered.map(a => `
        <div class="composer-action-card">
            <div style="flex: 1; padding-right: 0.5rem;">
                <div style="font-weight: 600; color: #f3f4f6; font-size: 0.85rem;">${a.name}</div>
                <div style="font-size: 0.7rem; color: #9ca3af; font-family: monospace;">${a.id}</div>
                <div style="display: flex; gap: 0.4rem; margin-top: 0.25rem;">
                    <span class="badge badge-info" style="font-size: 0.65rem;">${a.domain}</span>
                    <span class="badge badge-${a.riskDefault === 'HIGH' || a.riskDefault === 'CRITICAL' ? 'danger' : 'warning'}" style="font-size: 0.65rem;">${a.riskDefault}</span>
                </div>
            </div>
            <button type="button" class="btn btn-primary" style="padding: 0.35rem 0.65rem; font-size: 0.75rem; white-space: nowrap;" onclick="addComposerStep('${a.id}')">
                + Add Step
            </button>
        </div>
    `).join('');
}

function getBlueprintFormData(currentName = null) {
    const nameInput = document.getElementById('bpName');
    const name = (currentName || (nameInput ? nameInput.value : '')).trim();
    const version = (document.getElementById('bpVersion')?.value || '1.0.0').trim();
    const owner = (document.getElementById('bpOwner')?.value || 'DevOps-Admin').trim();
    const domain = document.getElementById('bpDomain')?.value || 'CNTT';
    const description = (document.getElementById('bpDescription')?.value || '').trim();
    const compensationOnFailure = document.getElementById('bpCompensation')?.value || 'NOTIFY_ONCALL';
    const status = document.getElementById('bpStatus')?.value || 'PUBLISHED';

    if (!name || !version || !owner) {
        alert('Please fill in Blueprint name, version, and owner');
        return null;
    }

    if (!state.composerSteps || state.composerSteps.length === 0) {
        alert('Blueprint must contain at least 1 Action step. Click "+ Add Step" to add actions.');
        return null;
    }

    return {
        name,
        version,
        owner,
        domain,
        description,
        steps: state.composerSteps.map((s, idx) => ({
            stepIndex: idx + 1,
            action: typeof s === 'string' ? s : s.action
        })),
        compensationOnFailure,
        status
    };
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
            alert('Error creating blueprint: ' + (err.error || (err.errors ? err.errors.join('; ') : res.statusText)));
            return;
        }

        const bp = await res.json();
        state.blueprints.push(bp);
        closeModal();
        renderView('blueprints');
        alert(`Blueprint "${bp.metadata.name}" created successfully!`);
    } catch (error) {
        alert('Failed to create blueprint: ' + error.message);
    }
}

async function saveBlueprint(bpName) {
    const payload = getBlueprintFormData(bpName);
    if (!payload) return;

    try {
        const res = await fetch(`${state.backendUrl}/api/blueprints/${bpName}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            const err = await res.json();
            alert('Error updating blueprint: ' + (err.error || (err.errors ? err.errors.join('; ') : res.statusText)));
            return;
        }

        const updated = await res.json();
        const idx = state.blueprints.findIndex(b => b.metadata.name === bpName);
        if (idx >= 0) {
            state.blueprints[idx] = updated;
        } else {
            state.blueprints.push(updated);
        }
        closeModal();
        renderView('blueprints');
        alert(`Blueprint "${bpName}" updated successfully!`);
    } catch (e) {
        alert('Failed to update blueprint: ' + e.message);
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
            alert('Error deleting blueprint: ' + (err.error || res.statusText));
            return;
        }

        state.blueprints = state.blueprints.filter(b => b.metadata.name !== bpName);
        closeModal();
        renderView('blueprints');
        alert(`Blueprint "${bpName}" deleted successfully.`);
    } catch (error) {
        alert('Failed to delete blueprint: ' + error.message);
    }
}

// ============================================================
// MODAL — New Change (Clone-to-Change with Per-Action Parameter Overrides)
// ============================================================
function openNewChangeModal(selectedObjective = null) {
    if (state.actions.length === 0) {
        alert('No actions in catalog. Create an Action first.');
        return;
    }

    // Default objective: prioritize selectedObjective, then first blueprint, then first action
    const defaultObj = selectedObjective || (state.blueprints.length > 0 ? state.blueprints[0].metadata.name : (state.actions[0]?.id || ''));
    initChangeStepOverrides(defaultObj);

    const isClonedFromBp = state.blueprints.some(b => b.metadata.name === defaultObj);

    const modal = `
        <div class="modal-overlay" onclick="closeModal(event)">
            <div class="modal" onclick="event.stopPropagation()" style="max-width: 680px; width: 95%;">
                <div class="modal-header">
                    <div style="display: flex; align-items: center; gap: 0.5rem;">
                        <span style="font-size: 1.4rem;">🚀</span>
                        <div>
                            <h2 class="modal-title" style="margin: 0;">${isClonedFromBp ? `Clone Blueprint & Create Change` : `New Change Request`}</h2>
                            <div style="font-size: 0.8rem; color: #9ca3af;">Configure operational parameters, target hosts & credentials for execution</div>
                        </div>
                    </div>
                    <button class="modal-close" onclick="closeModal()">&times;</button>
                </div>
                <div class="modal-body">
                    ${isClonedFromBp ? `
                        <div style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 0.5rem; padding: 0.75rem 1rem; margin-bottom: 1rem; display: flex; align-items: center; gap: 0.65rem;">
                            <span style="font-size: 1.25rem;">📋</span>
                            <div style="font-size: 0.8rem; color: #6ee7b7; line-height: 1.4;">
                                <strong>Cloned from Skeleton:</strong> Khung quy trình <code>${defaultObj}</code> đã được nạp sẵn. Hãy kiểm tra các tham số từng bước bên dưới và tùy biến giá trị cho lần chạy này.
                            </div>
                        </div>
                    ` : ''}

                    <div style="margin-bottom: 1rem;">
                        <label class="form-label">Objective (Automation Unit) *</label>
                        <select id="objectiveInput" class="form-input" onchange="onChangeObjectiveSelected(this.value)">
                            ${state.blueprints.length > 0 ? `
                                <optgroup label="📋 Blueprints (Multi-step Workflows)">
                                    ${state.blueprints.map(b => `<option value="${b.metadata.name}" ${b.metadata.name === defaultObj ? 'selected' : ''}>[Blueprint] ${b.metadata.name} (${(b.spec.steps || []).length} actions)</option>`).join('')}
                                </optgroup>
                            ` : ''}
                            <optgroup label="⚡ Action Primitives (Single Step)">
                                ${state.actions.map(a => `<option value="${a.id}" ${a.id === defaultObj ? 'selected' : ''}>[Action] ${a.name} (${a.id})</option>`).join('')}
                            </optgroup>
                        </select>
                        <div style="font-size: 0.75rem; color: #9ca3af; margin-top: 0.25rem;">Select a composed Blueprint workflow or single Action primitive</div>
                    </div>

                    <!-- Step Overrides Preview Container -->
                    <div id="changeStepsPreviewContainer" style="margin-bottom: 1.25rem;">
                        ${renderChangeStepsOverrideList()}
                    </div>

                    <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 1rem; margin-bottom: 0.5rem;">
                        <div>
                            <label class="form-label">Target Hosts / Clusters / Ad-hoc *</label>
                            <input type="text" id="targetInput" class="form-input" list="inventoryTargetsList" placeholder="e.g. db01, patroni_cluster, or 192.168.1.50:2222" value="db01" oninput="onTargetInputChange(this.value)">
                            <datalist id="inventoryTargetsList">
                                <optgroup label="Cluster Groups">
                                    ${(state.inventory?.groups || []).map(g => `<option value="${escapeHtml(g.name)}">[Cluster] ${escapeHtml(g.name)} (${(g.members || []).length} nodes)</option>`).join('')}
                                </optgroup>
                                <optgroup label="Managed Inventory Hosts">
                                    ${(state.inventory?.hosts || []).map(h => `<option value="${escapeHtml(h.name)}">[Host] ${escapeHtml(h.name)} (${escapeHtml(h.ansible_host)}:${h.ansible_port || 22})</option>`).join('')}
                                </optgroup>
                            </datalist>
                            <div id="targetHintContainer">
                                <div class="target-hint-box target-hint-registered">
                                    <span>✅</span>
                                    <span>Registered Host: <strong>db01</strong> (anhvhn.duckdns.org:2222) • Default credential auto-selected</span>
                                </div>
                            </div>
                        </div>
                        <div>
                            <label class="form-label">Domain</label>
                            <select id="domainInput" class="form-input">
                                <option value="CNTT">CNTT</option>
                                <option value="IP">IP / Backbone</option>
                                <option value="5G">5G Core</option>
                                <option value="Transport">Transport</option>
                            </select>
                        </div>
                    </div>

                    <div style="margin-bottom: 1rem;">
                        <label class="form-label">Execution Credential (AWX Vault)</label>
                        <select id="credentialInput" class="form-input">
                            <option value="">-- None / Default Environment SSH Key --</option>
                            ${state.credentials.map(c => `
                                <option value="${c.id}" ${c.id === 'cred-db01' ? 'selected' : ''}>
                                    [${c.type.toUpperCase()}] ${escapeHtml(c.name)} (${c.username}${c.authType === 'ssh_key' ? ' • Key: ' + (c.sshKeyPath || '~/.ssh/id_rsa') : ' • Password'})
                                </option>
                            `).join('')}
                        </select>
                        <div style="font-size: 0.72rem; color: #9ca3af; margin-top: 0.2rem;">
                            Managed credentials injected dynamically at runtime via secure <code>0600</code> vars file and masked with <code>no_log: true</code>.
                        </div>
                    </div>

                    <div style="margin-bottom: 1rem;">
                        <label style="display: flex; align-items: center; gap: 0.5rem; color: #d1d5db;">
                            <input type="checkbox" id="maintenanceWindowInput" style="width: auto;">
                            <span>Maintenance Window Approved</span>
                        </label>
                    </div>
                </div>
                <div class="modal-footer" style="display: flex; justify-content: flex-end; gap: 0.5rem;">
                    <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
                    <button class="btn btn-primary" onclick="createChange()">Create Change & Assess Risk</button>
                </div>
            </div>
        </div>
    `;
    document.getElementById('modalContainer').innerHTML = modal;
}

function initChangeStepOverrides(objectiveName) {
    state.changeStepOverrides = [];
    const bp = state.blueprints.find(b => b.metadata.name === objectiveName);
    if (bp && bp.spec && bp.spec.steps) {
        const usedSlugs = new Set();
        state.changeStepOverrides = bp.spec.steps.map((s, idx) => {
            const actId = typeof s === 'string' ? s : s.action;
            const act = state.actions.find(a => a.id === actId);
            const defaultInputs = {};
            if (act && act.inputs) {
                act.inputs.forEach(inp => {
                    if (inp.default !== undefined) defaultInputs[inp.name] = inp.default;
                });
            }

            let baseStepId = '';
            if (s.stepId && typeof s.stepId === 'string' && s.stepId.trim()) {
                baseStepId = s.stepId.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
            } else {
                baseStepId = actId.toLowerCase().replace(/[^a-z0-9_]/g, '_');
            }
            let stepId = baseStepId;
            let counter = 1;
            while (usedSlugs.has(stepId)) {
                stepId = `${baseStepId}_${counter++}`;
            }
            usedSlugs.add(stepId);

            return {
                stepIndex: idx + 1,
                stepId: stepId,
                action: actId,
                inputs: { ...defaultInputs, ...(s.inputs || {}) }
            };
        });
    }
}

function onChangeObjectiveSelected(val) {
    initChangeStepOverrides(val);
    const container = document.getElementById('changeStepsPreviewContainer');
    if (container) {
        container.innerHTML = renderChangeStepsOverrideList();
    }
}

function renderChangeStepsOverrideList() {
    if (!state.changeStepOverrides || state.changeStepOverrides.length === 0) return '';

    return `
        <div style="background: #111827; border: 1px solid #374151; border-radius: 0.5rem; padding: 0.85rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                <span style="font-size: 0.82rem; font-weight: 600; color: #f3f4f6;">Action Sequence & Input Parameters:</span>
                <span class="badge badge-info" style="font-size: 0.7rem;">${state.changeStepOverrides.length} actions</span>
            </div>
            <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                ${state.changeStepOverrides.map((s, idx) => {
                    const act = state.actions.find(a => a.id === s.action);
                    const actName = act ? act.name : s.action;
                    const inputs = s.inputs || {};
                    const tagsHtml = Object.entries(inputs).map(([k, v]) => {
                        if (typeof v === 'string') {
                            const m = v.match(/^\{\{\s*steps\.([a-zA-Z0-9_\-]+)\.([a-zA-Z0-9_\-]+)\s*\}\}$/);
                            if (m) {
                                return `<span class="step-input-tag" style="background: rgba(56, 189, 248, 0.15); border: 1px solid #0284c7; color: #38bdf8;"><strong>${k}:</strong> 🔗 ${m[1]} ➔ ${m[2]}</span>`;
                            }
                        }
                        return `<span class="step-input-tag"><strong>${k}:</strong> ${v}</span>`;
                    }).join('');

                    return `
                        <div style="display: flex; justify-content: space-between; align-items: center; background: #1f2937; padding: 0.5rem 0.75rem; border-radius: 0.375rem; border: 1px solid #374151;">
                            <div style="flex: 1;">
                                <div style="display: flex; align-items: center; gap: 0.4rem;">
                                    <span style="font-size: 0.82rem; font-weight: 600; color: #f9fafb;">${idx + 1}. ${actName}</span>
                                    <span class="badge" style="background: #1e293b; color: #38bdf8; font-size: 0.65rem; font-family: monospace; border: 1px solid #334155;">ID: ${s.stepId}</span>
                                </div>
                                <div style="font-size: 0.7rem; color: #9ca3af; font-family: monospace;">${s.action}</div>
                                ${tagsHtml ? `<div class="step-inputs-summary">${tagsHtml}</div>` : ''}
                            </div>
                            <button type="button" class="composer-step-cfg-btn" style="padding: 0.2rem 0.5rem; font-size: 0.72rem;" onclick="openConfigureChangeStepModal(${idx})">
                                ⚙ Override
                            </button>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;
}

function openConfigureChangeStepModal(stepIdx) {
    const step = state.changeStepOverrides[stepIdx];
    if (!step) return;

    const action = state.actions.find(a => a.id === step.action);
    if (!action) return;

    const currentInputs = { ...(step.inputs || {}) };
    (action.inputs || []).forEach(inp => {
        if (currentInputs[inp.name] === undefined && inp.default !== undefined) {
            currentInputs[inp.name] = inp.default;
        }
    });

    // Collect available facts from all preceding steps (Step 1 to Step stepIdx)
    const availableFactsByStep = [];
    for (let pIdx = 0; pIdx < stepIdx; pIdx++) {
        const prevStep = state.changeStepOverrides[pIdx];
        if (!prevStep) continue;
        const prevAction = state.actions.find(a => a.id === prevStep.action);
        if (!prevAction || !prevAction.outputs || prevAction.outputs.length === 0) continue;

        const stepSlug = prevStep.stepId || (prevAction.id.toLowerCase().replace(/[^a-z0-9_]/g, '_'));
        availableFactsByStep.push({
            stepIdx: pIdx,
            stepNum: pIdx + 1,
            stepId: stepSlug,
            actionName: prevAction.name,
            actionId: prevAction.id,
            outputs: prevAction.outputs
        });
    }

    const subModal = `
        <div class="modal-overlay" id="changeStepOverrideOverlay" style="z-index: 1200;" onclick="handleOverlayClick(event)">
            <div class="modal" onclick="event.stopPropagation()" style="max-width: 600px; width: 90%;">
                <div class="modal-header">
                    <div>
                        <div style="display: flex; align-items: center; gap: 0.5rem;">
                            <h3 class="modal-title" style="margin: 0; font-size: 1.05rem;">Override Parameters: Action ${stepIdx + 1}</h3>
                            <span class="badge" style="background: #1e293b; color: #38bdf8; font-size: 0.7rem; font-family: monospace; border: 1px solid #334155;">ID: ${step.stepId}</span>
                        </div>
                        <div style="font-size: 0.75rem; color: #9ca3af;">${action.name} (${step.action})</div>
                    </div>
                    <button class="modal-close" onclick="closeConfigureChangeStepModal()">&times;</button>
                </div>
                <div class="modal-body" style="max-height: 58vh; overflow-y: auto;">
                    ${availableFactsByStep.length > 0 ? `
                        <div style="background: rgba(56, 189, 248, 0.08); border: 1px solid rgba(56, 189, 248, 0.25); border-radius: 0.375rem; padding: 0.5rem 0.75rem; margin-bottom: 1rem; font-size: 0.75rem; color: #bae6fd; display: flex; align-items: center; gap: 0.4rem;">
                            <span>💡</span>
                            <span>Có <strong>${availableFactsByStep.reduce((acc, s) => acc + s.outputs.length, 0)} Output Facts</strong> từ các bước trước. Bấm nút <strong>🔗 Dùng Fact</strong> để liên kết!</span>
                        </div>
                    ` : ''}

                    ${(action.inputs || []).map(inp => {
                        const rawVal = currentInputs[inp.name] !== undefined ? currentInputs[inp.name] : (inp.default || '');
                        const factMatch = typeof rawVal === 'string' ? rawVal.match(/^\{\{\s*steps\.([a-zA-Z0-9_\-]+)\.([a-zA-Z0-9_\-]+)\s*\}\}$/) : null;
                        const isBound = !!factMatch;
                        const boundStepId = factMatch ? factMatch[1] : '';
                        const boundFactName = factMatch ? factMatch[2] : '';

                        return `
                            <div style="margin-bottom: 1rem;">
                                <label class="form-label" style="display: flex; justify-content: space-between;">
                                    <span>${inp.label || inp.name}</span>
                                    <span style="font-size: 0.7rem; color: #9ca3af; font-family: monospace;">{{ ${inp.name} }}</span>
                                </label>

                                <!-- Tag Pill Mode (Hiển thị khi đã liên kết Fact) -->
                                <div id="fact_tag_box_${inp.name}" style="display: ${isBound ? 'flex' : 'none'}; align-items: center; justify-content: space-between; background: rgba(56, 189, 248, 0.1); border: 1px solid #0284c7; border-radius: 0.375rem; padding: 0.5rem 0.75rem;">
                                    <div style="display: flex; align-items: center; gap: 0.5rem;">
                                        <span style="font-size: 0.95rem;">🔗</span>
                                        <div>
                                            <div style="font-size: 0.8rem; font-weight: 600; color: #38bdf8;">
                                                <span id="fact_tag_step_${inp.name}">${boundStepId}</span> ➔ <span id="fact_tag_name_${inp.name}" style="color: #f3f4f6;">${boundFactName}</span>
                                            </div>
                                            <div style="font-size: 0.68rem; color: #94a3b8;">Nhận giá trị tự động từ kết quả của bước trước</div>
                                        </div>
                                    </div>
                                    <button type="button" onclick="unbindFact('${inp.name}', '${inp.default !== undefined ? inp.default : ''}')" style="background: rgba(239, 68, 68, 0.15); border: 1px solid #ef4444; color: #fca5a5; font-size: 0.75rem; padding: 0.25rem 0.6rem; border-radius: 0.25rem; cursor: pointer; display: flex; align-items: center; gap: 0.25rem;" title="Hủy liên kết và quay lại nhập tay">
                                        ✕ Hủy liên kết
                                    </button>
                                </div>

                                <!-- Text Input Mode (Hiển thị khi nhập tay bình thường) -->
                                <div id="fact_input_box_${inp.name}" class="input-fact-wrapper" style="display: ${isBound ? 'none' : 'flex'};">
                                    <input 
                                        type="${inp.type === 'number' ? 'number' : 'text'}" 
                                        id="chg_cfg_${inp.name}" 
                                        class="form-input" 
                                        value="${isBound ? (inp.default !== undefined ? inp.default : '') : rawVal}" 
                                        placeholder="${inp.placeholder || ''}"
                                        data-validation="${inp.validation || ''}"
                                        data-input-type="${inp.type || 'string'}"
                                        data-bound-expr="${isBound ? rawVal : ''}"
                                        oninput="validateAntiTypoInput(this, ${stepIdx})"
                                    >
                                    ${availableFactsByStep.length > 0 ? `
                                        <button type="button" class="fact-picker-toggle" onclick="toggleFactDropdown('${inp.name}')" title="Chọn Output từ bước trước">
                                            🔗 Dùng Fact
                                        </button>
                                        <div id="fact_dropdown_${inp.name}" class="fact-picker-dropdown" style="display: none;">
                                            <div class="fact-dropdown-header">
                                                <span>⚡ Chọn Output từ bước trước</span>
                                                <span style="font-size: 0.65rem; color: #38bdf8;">1-Click Binding</span>
                                            </div>
                                            ${availableFactsByStep.map(s => `
                                                <div class="fact-step-group">
                                                    <div class="fact-step-group-title">
                                                        <span>Step ${s.stepNum}: ${s.actionName}</span>
                                                        <span class="step-slug">(${s.stepId})</span>
                                                    </div>
                                                    ${s.outputs.map(out => `
                                                        <div class="fact-option-item" onclick="selectFactTag('${inp.name}', '${s.stepId}', '${out.name}')">
                                                            <div class="fact-option-header">
                                                                <span class="fact-option-name">${out.name}</span>
                                                                <span class="fact-option-type">${out.type || 'string'}</span>
                                                            </div>
                                                            ${out.description ? `<div class="fact-option-desc">${out.description}</div>` : ''}
                                                            <div class="fact-option-expr" style="color: #38bdf8; background: rgba(56, 189, 248, 0.1);">🔗 Gán vào [${inp.label || inp.name}]</div>
                                                        </div>
                                                    `).join('')}
                                                </div>
                                            `).join('')}
                                        </div>
                                    ` : ''}
                                </div>
                                ${inp.description ? `<div style="font-size: 0.72rem; color: #9ca3af; margin-top: 0.25rem;">${inp.description}</div>` : ''}
                                <div id="cfg_err_${inp.name}" class="validation-error-text" style="display: none;"></div>
                            </div>
                        `;
                    }).join('')}
                </div>
                <div class="modal-footer" style="display: flex; justify-content: flex-end; gap: 0.5rem;">
                    <button class="btn btn-secondary" onclick="closeConfigureChangeStepModal()">Cancel</button>
                    <button class="btn btn-primary" onclick="saveConfigureChangeStepInputs(${stepIdx})">✓ Save Override</button>
                </div>
            </div>
        </div>
    `;

    const div = document.createElement('div');
    div.id = 'changeStepOverrideWrapper';
    div.innerHTML = subModal;
    document.body.appendChild(div);
}

function selectFactTag(inpName, stepId, factName) {
    const inputEl = document.getElementById(`chg_cfg_${inpName}`);
    if (inputEl) {
        inputEl.dataset.boundExpr = `{{ steps.${stepId}.${factName} }}`;
        inputEl.classList.remove('input-invalid');
    }
    const errEl = document.getElementById(`cfg_err_${inpName}`);
    if (errEl) errEl.style.display = 'none';

    const tagBox = document.getElementById(`fact_tag_box_${inpName}`);
    const inputBox = document.getElementById(`fact_input_box_${inpName}`);
    const tagStep = document.getElementById(`fact_tag_step_${inpName}`);
    const tagName = document.getElementById(`fact_tag_name_${inpName}`);
    if (tagStep) tagStep.innerText = stepId;
    if (tagName) tagName.innerText = factName;
    if (tagBox && inputBox) {
        tagBox.style.display = 'flex';
        inputBox.style.display = 'none';
    }
    const dropdown = document.getElementById(`fact_dropdown_${inpName}`);
    if (dropdown) dropdown.style.display = 'none';
}

function unbindFact(inpName, defaultVal) {
    const inputEl = document.getElementById(`chg_cfg_${inpName}`);
    if (inputEl) {
        inputEl.dataset.boundExpr = '';
        if (defaultVal !== undefined && defaultVal !== '') {
            inputEl.value = defaultVal;
        }
    }
    const tagBox = document.getElementById(`fact_tag_box_${inpName}`);
    const inputBox = document.getElementById(`fact_input_box_${inpName}`);
    if (tagBox && inputBox) {
        tagBox.style.display = 'none';
        inputBox.style.display = 'flex';
    }
}

function toggleFactDropdown(inpName) {
    const dropdown = document.getElementById(`fact_dropdown_${inpName}`);
    if (!dropdown) return;
    const isVisible = dropdown.style.display === 'block';
    document.querySelectorAll('.fact-picker-dropdown').forEach(d => d.style.display = 'none');
    dropdown.style.display = isVisible ? 'none' : 'block';
}

function handleOverlayClick(event) {
    if (!event.target.closest('.fact-picker-toggle') && !event.target.closest('.fact-picker-dropdown')) {
        document.querySelectorAll('.fact-picker-dropdown').forEach(d => d.style.display = 'none');
    }
}

function closeConfigureChangeStepModal() {
    const el = document.getElementById('changeStepOverrideWrapper');
    if (el) el.remove();
}

function saveConfigureChangeStepInputs(stepIdx) {
    const step = state.changeStepOverrides[stepIdx];
    if (!step) return;

    const action = state.actions.find(a => a.id === step.action);
    if (!action) return;

    const newInputs = {};
    (action.inputs || []).forEach(inp => {
        const inputEl = document.getElementById(`chg_cfg_${inp.name}`);
        if (inputEl) {
            // Check if bound via tag
            const boundExpr = inputEl.dataset.boundExpr;
            if (boundExpr && boundExpr.startsWith('{{') && boundExpr.endsWith('}}')) {
                newInputs[inp.name] = boundExpr;
            } else {
                const rawVal = inputEl.value.trim();
                if (inp.type === 'number') {
                    newInputs[inp.name] = rawVal === '' ? (inp.default || 0) : Number(rawVal);
                } else {
                    newInputs[inp.name] = rawVal;
                }
            }
        }
    });

    state.changeStepOverrides[stepIdx].inputs = newInputs;
    closeConfigureChangeStepModal();
    const container = document.getElementById('changeStepsPreviewContainer');
    if (container) {
        container.innerHTML = renderChangeStepsOverrideList();
    }
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

async function executeChange(changeId, autoRun = false) {
    state.activeChangeId = changeId;
    sessionStorage.setItem('synapse_active_change_id', changeId);
    const change = state.changes.find(c => c.id === changeId);
    
    let exec = state.executions.find(e => e.changeId === changeId);
    if (!exec && change && change.executionId) {
        try {
            const res = await fetch(`${state.backendUrl}/api/executions/${change.executionId}`);
            if (res.ok) {
                exec = await res.json();
                state.executions.push(exec);
            }
        } catch (e) {
            console.error('Error fetching execution:', e);
        }
    }
    
    state.currentExecution = exec || null;
    if (exec && exec.logTail) {
        state.executionLog = exec.logTail.split('\n');
    } else if (!autoRun) {
        state.executionLog = [];
    }
    renderView('executions');

    // Auto-run if requested and change is in Approved state
    if (autoRun && change && change.state === 'Approved') {
        runExecution(changeId);
    }
}

function switchExecutionChange(changeId) {
    executeChange(changeId, false);
}

function onTargetInputChange(targetVal) {
    const hintContainer = document.getElementById('targetHintContainer');
    const credInput = document.getElementById('credentialInput');
    if (!hintContainer) return;

    if (!targetVal || !targetVal.trim()) {
        hintContainer.innerHTML = '';
        return;
    }

    const trimmed = targetVal.trim();
    const hosts = state.inventory?.hosts || [];
    const groups = state.inventory?.groups || [];

    // 1. Check if registered host
    const matchedHost = hosts.find(h => h.name.toLowerCase() === trimmed.toLowerCase() || h.ansible_host.toLowerCase() === trimmed.toLowerCase());
    if (matchedHost) {
        hintContainer.innerHTML = `
            <div class="target-hint-box target-hint-registered">
                <span>✅</span>
                <span>Registered Host: <strong>${escapeHtml(matchedHost.name)}</strong> (${escapeHtml(matchedHost.ansible_host)}:${matchedHost.ansible_port || 22}) • Env: <em>${matchedHost.environment}</em></span>
            </div>
        `;
        if (matchedHost.defaultCredentialId && credInput) {
            credInput.value = matchedHost.defaultCredentialId;
        }
        return;
    }

    // 2. Check if registered group
    const matchedGroup = groups.find(g => g.name.toLowerCase() === trimmed.toLowerCase());
    if (matchedGroup) {
        const count = (matchedGroup.members || []).length;
        hintContainer.innerHTML = `
            <div class="target-hint-box target-hint-registered">
                <span>👥</span>
                <span>Cluster Group: <strong>${escapeHtml(matchedGroup.name)}</strong> (${count} nodes) • Blast Radius: Multi-host (+15 Risk)</span>
            </div>
        `;
        return;
    }

    // 3. Security Boundary: Loopback / Cloud Metadata
    const lower = trimmed.toLowerCase();
    if (lower.startsWith('127.') || lower === 'localhost' || lower === '::1') {
        hintContainer.innerHTML = `
            <div class="target-hint-box target-hint-blocked">
                <span>⛔</span>
                <span><strong>Security Boundary Violation:</strong> Loopback address is strictly prohibited.</span>
            </div>
        `;
        return;
    }

    if (lower.startsWith('169.254.')) {
        hintContainer.innerHTML = `
            <div class="target-hint-box target-hint-blocked">
                <span>⛔</span>
                <span><strong>Security Boundary Violation:</strong> Cloud metadata service IP (169.254.x.x) is strictly prohibited.</span>
            </div>
        `;
        return;
    }

    // 4. Ad-hoc target (Anti-Pivot rule)
    hintContainer.innerHTML = `
        <div class="target-hint-box target-hint-adhoc">
            <span>⚠️</span>
            <span><strong>Ad-hoc Target:</strong> Unregistered node (+20 Risk). Anti-Pivot policy requires you to explicitly select an authorized credential from Vault.</span>
        </div>
    `;
    // Anti-pivot: do not auto-fill credential for ad-hoc targets
    if (credInput && credInput.value === 'cred-db01') {
        credInput.value = '';
    }
}

async function createChange() {
    const objective = document.getElementById('objectiveInput').value;
    const target = document.getElementById('targetInput').value;
    const domain = document.getElementById('domainInput').value;
    const credentialId = document.getElementById('credentialInput')?.value || null;
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
                credentialId: credentialId || undefined,
                constraints: { maintenanceWindow },
                stepOverrides: state.changeStepOverrides || []
            })
        });
        
        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            alert('Failed to create change: ' + (errData.error || res.statusText));
            return;
        }

        const change = await res.json();
        state.changes.push(change);
        state.activeChangeId = change.id;
        sessionStorage.setItem('synapse_active_change_id', change.id);
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
                        ${change.credentialId ? `
                        <div>
                            <div style="color: #9ca3af; font-size: 0.875rem;">Credential (Vault)</div>
                            <div style="margin-top: 0.25rem;"><span class="badge badge-success" style="background: rgba(16,185,129,0.15); color: #6ee7b7; border: 1px solid rgba(16,185,129,0.3);">🔐 ${escapeHtml(state.credentials.find(c => c.id === change.credentialId)?.name || change.credentialId)}</span></div>
                        </div>
                        ` : ''}
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
                    ${change.state === 'Approved' ? `<button class="btn btn-primary" onclick="closeModal(); executeChange('${change.id}', true)">▶ Execute</button>` : ''}
                    ${change.state === 'Executing' || change.state === 'Verified' || change.state === 'Failed' ? `<button class="btn btn-primary" onclick="closeModal(); executeChange('${change.id}', false)">View Execution</button>` : ''}
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
    state.executionLog = ['[INFO] Resolving execution plan...'];
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
        state.executionLog.push(`[INFO] Blueprint: ${plan.blueprint} (${plan.steps.length} step(s))`);
        updateExecutionLog();

        // Step 2: Execute Plan (launches orchestration loop)
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
        state.currentExecution = execution;
        updatePipelineStepsDOM(execution);

        state.executionLog.push(`[INFO] Orchestration pipeline started: ${execution.executionId}`);
        state.executionLog.push(`[INFO] Tracking real-time steps progress...`);
        state.executionLog.push('');
        updateExecutionLog();

        // Update change in local state to Executing
        const change = state.changes.find(c => c.id === changeId);
        if (change) {
            change.state = 'Executing';
            change.executionId = execution.executionId;
        }

        // Step 3: Poll status frequently (every 1.5s for responsive updates)
        const maxPolls = 200;
        let pollCount = 0;
        let lastReportedStep = -1;
        const loggedSteps = new Set();
        
        const pollInterval = setInterval(async () => {
            pollCount++;
            
            if (pollCount > maxPolls) {
                clearInterval(pollInterval);
                state.executionLog.push('[WARNING] Execution taking longer than expected');
                updateExecutionLog();
                return;
            }
            
            try {
                const statusRes = await fetch(`${state.backendUrl}/api/executions/${execution.executionId}/status`);
                
                if (!statusRes.ok) return;
                
                const status = await statusRes.json();
                state.currentExecution = status;
                updatePipelineStepsDOM(status);

                // Fetch real-time Ansible playbook execution log
                try {
                    const logRes = await fetch(`${state.backendUrl}/api/executions/${execution.executionId}/log`);
                    if (logRes.ok) {
                        const rawLog = await logRes.text();
                        if (rawLog && rawLog.trim()) {
                            state.executionLog = rawLog.split('\n');
                            updateExecutionLog();
                        }
                    }
                } catch (logErr) {
                    // ignore log fetch glitch
                }

                if (status.finished) {
                    clearInterval(pollInterval);
                    
                    // Update local change state
                    if (change) {
                        change.state = (status.status === 'completed' || status.status === 'successful') ? 'Verified' : 'Failed';
                    }
                    
                    state.executionLog.push('');
                    if (status.status === 'completed' || status.status === 'successful') {
                        state.executionLog.push('================================================');
                        state.executionLog.push('✓ [SUCCESS] ALL ORCHESTRATION STEPS COMPLETED!');
                        state.executionLog.push(`✓ [SUCCESS] Workflow ${plan.blueprint} verified.`);
                        state.executionLog.push('================================================');
                    } else {
                        state.executionLog.push('================================================');
                        state.executionLog.push('✕ [FAILED] Workflow aborted due to step failure.');
                        state.executionLog.push('✕ [FAILED] Compensation NOTIFY_ONCALL triggered.');
                        state.executionLog.push('================================================');
                    }
                    
                    updateExecutionLog();
                    // Update header badge & buttons in-place (avoid full re-render which would "jump" the page)
                    const headerActions = document.querySelector('.execution-actions') || document.querySelector('.view-header > div:last-child');
                    if (headerActions && change) {
                        const isSuccess = status.status === 'completed' || status.status === 'successful';
                        headerActions.innerHTML = `
                            <span class="badge badge-${isSuccess ? 'success' : 'danger'}" style="padding: 0.4rem 0.8rem; font-size: 0.85rem;">
                                ${isSuccess ? '✓ Completed &amp; Verified' : '✕ Execution Failed'}
                            </span>
                            <button class="btn btn-secondary" onclick="runExecution('${changeId}')" style="border: 1px solid #4b5563;" title="Re-run this orchestration workflow">
                                ↻ Re-run Pipeline
                            </button>
                            <button class="btn btn-secondary" onclick="renderView('changes')">← Back to Changes</button>
                        `;
                    }

                    // Update Stepper in-place so "Verified ✅" shows up immediately
                    const stepperEl = document.querySelector('.stepper');
                    if (stepperEl && change) {
                        stepperEl.outerHTML = renderStepper(change.state);
                    }

                    // Update Change Details badge in-place
                    const changeDetailsBadge = document.querySelector('#changeDetailsStateBadge') || document.querySelector('.card .badge');
                    if (changeDetailsBadge && change) {
                        changeDetailsBadge.className = `badge badge-${getStateColor(change.state)}`;
                        changeDetailsBadge.textContent = change.state;
                    }

                    // Update dropdown selector if present
                    const selector = document.getElementById('changeExecutionSelector');
                    if (selector && change) {
                        const opt = selector.querySelector(`option[value="${change.id}"]`);
                        if (opt) opt.textContent = `${change.id} [${change.state}] — ${change.objective}`;
                    }
                }
            } catch (error) {
                console.error('Poll error:', error);
            }
        }, 1500);
        
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

// ============================================================
// HELPER: Reload Actions
// ============================================================
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

