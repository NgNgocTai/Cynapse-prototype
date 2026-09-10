import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runAnsiblePlaybook } from './ansibleRunner.js';
import { calculateRisk, evaluatePolicy } from './policy.js';
import { writeAudit, readAudit } from './audit.js';
import {
  getCatalog,
  listActions, getAction, addAction, updateAction, deleteAction, publishAction,
  listBlueprints, getBlueprint, addBlueprint, updateBlueprint, deleteBlueprint
} from './catalogStore.js';
import {
  validateRoleName, extractZipWithSecurity, runSyntaxCheck, extractParametersAndTasks, installRoleToProject, findRoleRoot,
  validateRoleDirectoryStructure, generateStandardRoleTemplateZip
} from './roleManager.js';
import net from 'net';
import {
  listCredentials, getCredential, addCredential, updateCredential, deleteCredential, getCredentialSecrets
} from './credentialStore.js';
import {
  getInventory, getHosts, getHost, saveHost, deleteHost, getGroups, saveGroup, validateTargetSecurity, resolveTarget
} from './inventoryStore.js';
import {
  getPlaybookSource,
  getAvailableTemplates,
  getTemplate,
  validateParameters,
  previewYAML,
  generateBlueprintPlaybook
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
const PORT = parseInt(process.env.PORT || '8000', 10);

// CORS config chỉ allow localhost:5500 (frontend port)
app.use(cors({
  origin: ['http://localhost:5500', 'http://127.0.0.1:5500'],
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

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
// ANSIBLE MODULE SCHEMAS API (Task Definition Builder)
// ===========================
// Cách 1: Built-in schema thư viện JSON (13 core modules chuẩn hóa cho đồ án)
app.get('/api/module-schemas', (req, res) => {
  try {
    const schemasPath = path.join(__dirname, 'moduleSchemas.json');
    const content = fs.readFileSync(schemasPath, 'utf-8');
    res.json(JSON.parse(content));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Cách 2: Extensible dynamic schema via `ansible-doc -j <module>` khi host có cài Ansible
app.get('/api/module-schemas/inspect/:module', (req, res) => {
  const { module } = req.params;
  import('child_process').then(({ exec }) => {
    exec(`ansible-doc -j ${module}`, (error, stdout, stderr) => {
      if (error) {
        return res.json({
          mode: 'dynamic_ansible_doc',
          available: false,
          error: 'ansible-doc is not installed or not in PATH on this host. Falling back to built-in moduleSchemas.json.',
          module
        });
      }
      try {
        const parsed = JSON.parse(stdout);
        res.json({
          mode: 'dynamic_ansible_doc',
          available: true,
          data: parsed
        });
      } catch (parseErr) {
        res.status(500).json({ error: 'Failed to parse ansible-doc JSON output' });
      }
    });
  });
});


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

// POST /api/actions/:id/publish - Publish action from DRAFT to PUBLISHED
app.post('/api/actions/:id/publish', (req, res) => {
  const actor = req.headers['x-actor'] || req.body?.actor || 'operator';
  const result = publishAction(req.params.id, actor);
  if (!result.ok) {
    return res.status(400).json({ error: result.error });
  }
  writeAudit('Action', req.params.id, actor, 'published', 'success',
    `Action "${req.params.id}" published from DRAFT to PUBLISHED.`);
  res.json(result.action);
});

// ===========================
// ROLES & PLAYBOOKS IMPORT WIZARD API
// ===========================

// GET /api/roles/template - Download standard Ansible Role template .zip
app.get('/api/roles/template', (req, res) => {
  try {
    const rawName = (req.query.name || 'sample_custom_role').toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const zipBuffer = generateStandardRoleTemplateZip(rawName);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${rawName}.zip"`);
    res.send(zipBuffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/roles/validate - Wizard Step 1: Check syntax and scan parameters
app.post('/api/roles/validate', async (req, res) => {
  try {
    const roleName = req.body.roleName;
    const zipBase64 = req.body.zipBase64 || req.body.fileBase64;
    const yamlContent = req.body.yamlContent || req.body.playbookContent;
    const isRole = req.body.isRole !== false;

    if (isRole) {
      const nameVal = validateRoleName(roleName);
      if (!nameVal.valid) {
        return res.status(400).json({ error: nameVal.error });
      }

      if (!zipBase64) {
        return res.status(400).json({ error: 'Thiếu dữ liệu file zip (zipBase64 hoặc fileBase64).' });
      }

      const tmpValidationDir = path.join(__dirname, 'temp', `val_${Date.now()}`);
      const tmpRoleDir = path.join(tmpValidationDir, nameVal.roleName);
      fs.mkdirSync(tmpRoleDir, { recursive: true });

      try {
        const zipBuffer = Buffer.from(zipBase64, 'base64');
        let zipMeta;
        try {
          zipMeta = extractZipWithSecurity(zipBuffer, tmpRoleDir);
        } catch (zipErr) {
          return res.status(400).json({ error: zipErr.message });
        }

        const roleDetection = findRoleRoot(tmpRoleDir, true);
        let effectiveRoleDir = tmpRoleDir;
        let isPlaybookZip = false;
        let detectedPlaybookContent = null;
        let structureVal = null;

        if (roleDetection.type === 'role' || roleDetection.type === 'role_missing_tasks') {
          effectiveRoleDir = roleDetection.dir;

          // Gate 1b: Strict Ansible Doc Role Directory Structure Validation
          structureVal = validateRoleDirectoryStructure(effectiveRoleDir);
          if (!structureVal.valid) {
            return res.status(400).json({ error: structureVal.error });
          }
        } else if (roleDetection.type === 'playbook') {
          isPlaybookZip = true;
          detectedPlaybookContent = fs.readFileSync(roleDetection.file, 'utf-8');
        } else {
          return res.status(400).json({
            error: `Cấu trúc zip không hợp lệ: Không tìm thấy thư mục 'tasks/' (cho Ansible Role) hoặc file '.yml' (cho Playbook) trong file zip.`
          });
        }

        let syntaxResult;
        let detectedTasks = [];
        let inputs = [];

        if (isPlaybookZip) {
          syntaxResult = await runSyntaxCheck({
            roleName: nameVal.roleName,
            roleDir: path.join(__dirname, 'temp'),
            isRole: false,
            playbookContent: detectedPlaybookContent
          });
          const extracted = extractParametersAndTasks(null, false, detectedPlaybookContent);
          detectedTasks = extracted.detectedTasks;
          inputs = extracted.inputs;
        } else {
          // Gate 2: Run syntax check
          syntaxResult = await runSyntaxCheck({
            roleName: nameVal.roleName,
            roleDir: effectiveRoleDir,
            isRole: true
          });

          // Gate 3: Extract parameters and tasks
          const extracted = extractParametersAndTasks(effectiveRoleDir, true);
          detectedTasks = extracted.detectedTasks;
          inputs = extracted.inputs;
        }

        res.json({
          pass: syntaxResult.pass,
          exitCode: syntaxResult.exitCode,
          output: syntaxResult.output,
          syntaxOutput: syntaxResult.output,
          stderr: syntaxResult.stderr,
          roleName: nameVal.roleName,
          tasks: detectedTasks,
          inputs,
          detectedType: isPlaybookZip ? 'playbook' : 'role',
          warnings: [
            ...(zipMeta?.sensitiveWarnings?.length ? [`Phát hiện file có thể chứa thông tin nhạy cảm: ${zipMeta.sensitiveWarnings.join(', ')}`] : []),
            ...(structureVal?.warnings || [])
          ]
        });
      } finally {
        try {
          if (fs.existsSync(tmpValidationDir)) {
            fs.rmSync(tmpValidationDir, { recursive: true, force: true });
          }
        } catch (cleanErr) {
          console.warn('[VALIDATE] Cleanup warning:', cleanErr.message);
        }
      }
    } else {
      // Standalone YAML validation
      if (!yamlContent || !yamlContent.trim()) {
        return res.status(400).json({ error: 'Nội dung YAML không được để trống.' });
      }

      const syntaxResult = await runSyntaxCheck({
        roleName: 'standalone_playbook',
        roleDir: path.join(__dirname, 'temp'),
        isRole: false,
        playbookContent: yamlContent
      });

      const { detectedTasks, inputs } = extractParametersAndTasks(null, false, yamlContent);

      res.json({
        pass: syntaxResult.pass,
        exitCode: syntaxResult.exitCode,
        output: syntaxResult.output,
        syntaxOutput: syntaxResult.output,
        stderr: syntaxResult.stderr,
        tasks: detectedTasks,
        inputs
      });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/roles/import - Wizard Step 2: Save role and register action in catalog as DRAFT
app.post('/api/roles/import', async (req, res) => {
  try {
    const roleName = req.body.roleName;
    const zipBase64 = req.body.zipBase64 || req.body.fileBase64;
    const yamlContent = req.body.yamlContent || req.body.playbookContent;
    const isRole = req.body.isRole !== false;
    const actionId = req.body.actionId || (roleName ? `ACTION_ROLE_${roleName.toUpperCase()}` : null);
    const actionName = req.body.actionName || req.body.displayName || (roleName ? `Role: ${roleName}` : null);
    const domain = req.body.domain || 'CNTT';
    const capability = req.body.capability || 'DATABASE_ADMIN';
    const riskDefault = req.body.riskDefault || 'MEDIUM';
    const description = req.body.description || '';
    let inputs = req.body.inputs || [];
    const autoCreateBlueprint = Boolean(req.body.autoCreateBlueprint ?? req.body.createBlueprint ?? false);
    const overwrite = Boolean(req.body.overwrite);

    const actor = req.headers['x-actor'] || req.body?.actor || 'operator';

    if (!actionId || !actionName) {
      return res.status(400).json({ error: 'actionId và actionName là bắt buộc.' });
    }

    if (isRole) {
      const nameVal = validateRoleName(roleName);
      if (!nameVal.valid) {
        return res.status(400).json({ error: nameVal.error });
      }

      if (!zipBase64) {
        return res.status(400).json({ error: 'Thiếu dữ liệu file zip (zipBase64 hoặc fileBase64).' });
      }

      const tmpInstallDir = path.join(__dirname, 'temp', `inst_${Date.now()}`);
      const tmpRoleDir = path.join(tmpInstallDir, nameVal.roleName);
      fs.mkdirSync(tmpRoleDir, { recursive: true });

      try {
        const zipBuffer = Buffer.from(zipBase64, 'base64');
        try {
          extractZipWithSecurity(zipBuffer, tmpRoleDir);
        } catch (zipErr) {
          return res.status(400).json({ error: zipErr.message });
        }

        const roleDetection = findRoleRoot(tmpRoleDir, true);
        let effectiveRoleDir = tmpRoleDir;
        let isPlaybookZip = false;
        let detectedPlaybookContent = null;

        if (roleDetection.type === 'role' || roleDetection.type === 'role_missing_tasks') {
          effectiveRoleDir = roleDetection.dir;

          // Gate 1b: Strict Ansible Doc Role Directory Structure Validation
          const structureVal = validateRoleDirectoryStructure(effectiveRoleDir);
          if (!structureVal.valid) {
            return res.status(400).json({ error: structureVal.error });
          }
        } else if (roleDetection.type === 'playbook') {
          isPlaybookZip = true;
          detectedPlaybookContent = fs.readFileSync(roleDetection.file, 'utf-8');
        } else {
          return res.status(400).json({
            error: `Cấu trúc zip không hợp lệ: Không tìm thấy thư mục 'tasks/' (cho Ansible Role) hoặc file '.yml' (cho Playbook) trong file zip.`
          });
        }

        if (isPlaybookZip) {
          const syntaxResult = await runSyntaxCheck({
            roleName: nameVal.roleName,
            roleDir: path.join(__dirname, 'temp'),
            isRole: false,
            playbookContent: detectedPlaybookContent
          });

          if (!syntaxResult.pass) {
            return res.status(400).json({
              error: `Syntax check failed: ${syntaxResult.stderr || syntaxResult.output}`
            });
          }

          if (!inputs || inputs.length === 0) {
            const extracted = extractParametersAndTasks(null, false, detectedPlaybookContent);
            inputs = extracted.inputs || [];
          }
        } else {
          // Run syntax check before permanent installation
          const syntaxResult = await runSyntaxCheck({
            roleName: nameVal.roleName,
            roleDir: effectiveRoleDir,
            isRole: true
          });

          if (!syntaxResult.pass) {
            return res.status(400).json({
              error: `Syntax check failed: ${syntaxResult.stderr || syntaxResult.output}`
            });
          }

          // Install role permanently into project roles folder
          installRoleToProject(nameVal.roleName, effectiveRoleDir);

          // Auto extract inputs if not passed
          if (!inputs || inputs.length === 0) {
            const extracted = extractParametersAndTasks(effectiveRoleDir, true);
            inputs = extracted.inputs || [];
          }
        }

        // Register Action in catalogStore
        const actionPayload = {
          id: actionId,
          name: actionName,
          domain,
          capability,
          riskDefault,
          description: description || `Imported Ansible Role: ${nameVal.roleName}`,
          inputs,
          outputs: [],
          task_template: [
            {
              name: actionName,
              module: 'ansible.builtin.include_role',
              args: {
                name: nameVal.roleName,
                become_user: 'postgres'
              }
            }
          ],
          implementation: {
            provider: 'ansible',
            role: nameVal.roleName,
            become_user: 'postgres',
            estimatedDurationSec: 60
          },
          status: 'DRAFT',
          overwrite: !!overwrite
        };

        const actionRes = addAction(actionPayload);
        if (!actionRes.ok) {
          return res.status(409).json({ error: actionRes.errors.join('; ') });
        }

        writeAudit('Action', actionId, actor, 'imported', 'success',
          `Action "${actionId}" imported from Role "${nameVal.roleName}" with DRAFT status.`);

        let createdBlueprint = null;
        if (autoCreateBlueprint) {
          const bpName = `${nameVal.roleName.replace(/_/g, '-')}-pipeline`;
          const bpPayload = {
            name: bpName,
            version: '1.0.0',
            owner: actor,
            domain,
            description: `Auto-generated pipeline for role ${nameVal.roleName}`,
            steps: [{ stepIndex: 1, action: actionId, inputs: {} }],
            compensation: { onFailure: 'NOTIFY_ONCALL' },
            status: 'DRAFT'
          };
          const bpRes = addBlueprint(bpPayload);
          if (bpRes.ok) {
            createdBlueprint = bpRes.blueprint;
            writeAudit('Blueprint', bpName, actor, 'created_auto', 'success',
              `Auto-generated blueprint "${bpName}" for action "${actionId}"`);
          }
        }

        res.status(201).json({
          ok: true,
          action: actionRes.action,
          blueprint: createdBlueprint
        });
      } finally {
        try {
          if (fs.existsSync(tmpInstallDir)) {
            fs.rmSync(tmpInstallDir, { recursive: true, force: true });
          }
        } catch (e) {}
      }
    } else {
      // Standalone YAML
      const actionPayload = {
        id: actionId,
        name: actionName,
        domain,
        capability,
        description: description || 'Imported Standalone YAML Playbook',
        inputs,
        outputs: [],
        task_template: null,
        implementation: {
          provider: 'ansible',
          estimatedDurationSec: 60
        },
        status: 'DRAFT',
        overwrite: !!overwrite
      };
      const actionRes = addAction(actionPayload);
      if (!actionRes.ok) {
        return res.status(409).json({ error: actionRes.errors.join('; ') });
      }
      res.status(201).json({ ok: true, action: actionRes.action });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
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
  // Gate 4: Reject if any step action is in DRAFT status
  const steps = req.body.steps || req.body.spec?.steps || [];
  for (const step of steps) {
    const actId = typeof step === 'string' ? step : step.action;
    const act = getAction(actId);
    if (act && act.status === 'DRAFT') {
      return res.status(400).json({
        error: `Không thể thêm Action '${act.id}' vào Blueprint: Action đang ở trạng thái DRAFT. Vui lòng duyệt (Publish) Action trước.`
      });
    }
  }

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
  // Gate 4: Reject if any step action is in DRAFT status
  const steps = req.body.steps || req.body.spec?.steps || [];
  for (const step of steps) {
    const actId = typeof step === 'string' ? step : step.action;
    const act = getAction(actId);
    if (act && act.status === 'DRAFT') {
      return res.status(400).json({
        error: `Không thể thêm Action '${act.id}' vào Blueprint: Action đang ở trạng thái DRAFT. Vui lòng duyệt (Publish) Action trước.`
      });
    }
  }

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

// GET /api/blueprints/:name/yaml - Generate and preview complete Ansible Playbook YAML
app.get('/api/blueprints/:name/yaml', (req, res) => {
  try {
    const { name } = req.params;
    const { target_hosts } = req.query;
    const blueprint = getBlueprint(name);
    if (!blueprint) {
      return res.status(404).json({ error: `Blueprint "${name}" not found` });
    }

    const yaml = generateBlueprintPlaybook(blueprint, target_hosts || 'db_servers');
    res.json({
      name,
      targetHosts: target_hosts || 'db_servers',
      yaml
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===========================
// CREDENTIALS CRUD (AWX Architecture)
// ===========================

// GET /api/credentials - List all credentials (sanitized)
app.get('/api/credentials', (req, res) => {
  res.json(listCredentials());
});

// GET /api/credentials/:id - Get single credential (sanitized)
app.get('/api/credentials/:id', (req, res) => {
  const cred = getCredential(req.params.id);
  if (!cred) return res.status(404).json({ error: 'Credential not found' });
  res.json(cred);
});

// POST /api/credentials - Create new credential
app.post('/api/credentials', (req, res) => {
  const result = addCredential(req.body);
  if (!result.ok) {
    return res.status(400).json({ error: result.errors.join('; ') });
  }
  writeAudit('Credential', result.credential.id, 'user', 'created', 'success',
    `Credential "${result.credential.name}" (${result.credential.type.toUpperCase()}) created`);
  res.status(201).json(result.credential);
});

// PUT /api/credentials/:id - Update credential (Rule: blank secret = keep existing)
app.put('/api/credentials/:id', (req, res) => {
  const result = updateCredential(req.params.id, req.body);
  if (!result.ok) {
    return res.status(400).json({ error: result.errors.join('; ') });
  }
  writeAudit('Credential', req.params.id, 'user', 'updated', 'success',
    `Credential "${result.credential.name}" updated`);
  res.json(result.credential);
});

// DELETE /api/credentials/:id - Delete credential
app.delete('/api/credentials/:id', (req, res) => {
  const result = deleteCredential(req.params.id);
  if (!result.ok) {
    return res.status(400).json({ error: result.error });
  }
  writeAudit('Credential', req.params.id, 'user', 'deleted', 'success',
    `Credential ${req.params.id} deleted`);
  res.json({ message: `Credential ${req.params.id} deleted` });
});

// ===========================
// INVENTORY & HYBRID TARGET MANAGEMENT (AWX Architecture)
// ===========================

// GET /api/inventory - Full inventory (hosts & groups)
app.get('/api/inventory', (req, res) => {
  res.json(getInventory());
});

// GET /api/inventory/hosts
app.get('/api/inventory/hosts', (req, res) => {
  res.json(getHosts());
});

// POST /api/inventory/hosts - Add or update host
app.post('/api/inventory/hosts', (req, res) => {
  const { name, ansible_host, ansible_port } = req.body;
  if (!name || !ansible_host) {
    return res.status(400).json({ error: 'name and ansible_host are required' });
  }

  // Security format validation
  const sec = validateTargetSecurity(`${ansible_host}:${ansible_port || 22}`);
  if (!sec.valid && sec.targetType !== 'host' && sec.targetType !== 'group') {
    return res.status(400).json({ error: `Security check failed: ${sec.reason}` });
  }

  const record = saveHost(req.body);
  writeAudit('Inventory', record.name, 'user', 'saved_host', 'success',
    `Host ${record.name} (${record.ansible_host}:${record.ansible_port}) updated in inventory`);
  res.status(201).json(record);
});

// DELETE /api/inventory/hosts/:name - Delete host
app.delete('/api/inventory/hosts/:name', (req, res) => {
  const ok = deleteHost(req.params.name);
  if (!ok) {
    return res.status(404).json({ error: 'Host not found' });
  }
  writeAudit('Inventory', req.params.name, 'user', 'deleted_host', 'success',
    `Host ${req.params.name} deleted from inventory`);
  res.json({ message: `Host ${req.params.name} deleted` });
});

// GET /api/inventory/groups
app.get('/api/inventory/groups', (req, res) => {
  res.json(getGroups());
});

// POST /api/inventory/groups - Create or update group
app.post('/api/inventory/groups', (req, res) => {
  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Group name is required' });
  }
  const record = saveGroup(req.body);
  writeAudit('Inventory', record.name, 'user', 'saved_group', 'success',
    `Group ${record.name} (${(record.members || []).length} members) saved`);
  res.status(201).json(record);
});

// POST /api/inventory/validate-target - Test target string against security guardrails
app.post('/api/inventory/validate-target', (req, res) => {
  const { target } = req.body;
  const result = validateTargetSecurity(target);
  res.json(result);
});

// Rate limiter state for ping tests (max 10 requests per minute)
const pingRateLimits = new Map();

// POST /api/inventory/ping - Test network connectivity (TCP port scan)
app.post('/api/inventory/ping', async (req, res) => {
  const { target } = req.body;
  if (!target) {
    return res.status(400).json({ error: 'Target is required' });
  }

  // 1. Rate limiting check (Sliding 60s window)
  const clientIp = req.ip || 'client';
  const now = Date.now();
  const clientHistory = pingRateLimits.get(clientIp) || [];
  const recentPings = clientHistory.filter(ts => now - ts < 60000);
  if (recentPings.length >= 10) {
    return res.status(429).json({ error: 'Rate limit exceeded for ping test (max 10/min)' });
  }
  recentPings.push(now);
  pingRateLimits.set(clientIp, recentPings);

  // 2. Security validation
  const security = validateTargetSecurity(target);
  if (!security.valid) {
    return res.status(400).json({ error: `Target blocked by security policy: ${security.reason}` });
  }

  // 3. Resolve destination host & port
  let host = security.host;
  let port = security.port || 22;

  if (security.targetType === 'host' && security.hostRecord) {
    host = security.hostRecord.ansible_host;
    port = security.hostRecord.ansible_port || 22;
  } else if (security.targetType === 'group' && security.group) {
    const { hosts } = getInventory();
    const firstMember = hosts.find(h => security.group.members.includes(h.name));
    if (firstMember) {
      host = firstMember.ansible_host;
      port = firstMember.ansible_port || 22;
    }
  }

  // 4. Perform TCP socket check
  const start = Date.now();
  const checkSocket = () => new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(3500);

    socket.connect(port, host, () => {
      const latencyMs = Date.now() - start;
      socket.destroy();
      resolve({ reachable: true, latencyMs });
    });

    socket.on('error', (err) => {
      socket.destroy();
      resolve({ reachable: false, error: err.message, latencyMs: Date.now() - start });
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve({ reachable: false, error: 'Connection timed out (3.5s)', latencyMs: Date.now() - start });
    });
  });

  const outcome = await checkSocket();
  writeAudit('Inventory', target, 'operator', 'connectivity_test', outcome.reachable ? 'success' : 'failed',
    `Ping TCP ${host}:${port} -> ${outcome.reachable ? `Reachable (${outcome.latencyMs}ms)` : `Unreachable: ${outcome.error}`}`);

  res.json({
    target,
    resolvedHost: host,
    port,
    ...outcome
  });
});

// ===========================
// CHANGES
// ===========================

// GET /api/changes
app.get('/api/changes', (req, res) => {
  const changes = Array.from(state.changes.values());
  res.json(changes);
});

// POST /api/changes - Tạo Change mới
app.post('/api/changes', (req, res) => {
  const objective = req.body.objective || req.body.blueprintName || req.body.action || '';
  const target = req.body.target || req.body.targetHost || 'db_servers';
  const domain = req.body.domain || 'CNTT';
  const credentialId = req.body.credentialId || null;
  const constraints = req.body.constraints || {};
  let stepOverrides = req.body.stepOverrides || [];
  if (!Array.isArray(stepOverrides) && req.body.actionOverrides) {
    stepOverrides = Object.entries(req.body.actionOverrides).map(([stepIdx, inputs]) => ({
      stepIndex: Number(stepIdx) + 1,
      inputs
    }));
  }

  // SECURITY GUARDRAIL 1: Target boundary validation
  const targetValidation = validateTargetSecurity(target);
  if (!targetValidation.valid) {
    return res.status(400).json({
      error: `Security Boundary Violation: ${targetValidation.reason}`
    });
  }

  // SECURITY GUARDRAIL 2 (Anti-Pivot): Ad-hoc target requires explicit credential selection
  if (targetValidation.targetType === 'adhoc' && !credentialId) {
    return res.status(400).json({
      error: `Ad-hoc target '${target}' requires explicit credential selection from the Vault.`
    });
  }
  
  const changeId = `CHG-${String(changeCounter++).padStart(3, '0')}`;
  const change = {
    id: changeId,
    objective,
    target,
    targetType: targetValidation.targetType,
    domain,
    credentialId,
    constraints,
    stepOverrides,
    riskScore: null,
    policyResult: null,
    state: 'Draft',
    createdAt: new Date().toISOString()
  };
  
  state.changes.set(changeId, change);
  writeAudit('Change', changeId, 'system', 'created', 'success', `Objective: ${objective}, Target: ${target} (${targetValidation.targetType})`);
  
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
      const override = (change.stepOverrides || []).find(o => o.stepIndex === idx + 1 || o.action === step.action);
      const stepInputs = (override && override.inputs) ? override.inputs : (step.inputs || {});
      return {
        stepIndex: idx + 1,
        stepId: step.stepId || override?.stepId || (step.action || '').toLowerCase().replace(/[^a-z0-9_]/g, '_'),
        action: step.action,
        name: stepAction ? stepAction.name : `Step ${idx + 1}: ${step.action}`,
        provider: 'ansible',
        inputs: stepInputs
      };
    });
  } else {
    // Check 2: Does objective match an Action primitive?
    const action = catalog.actions.find(a => 
      objStr === a.id || 
      (objStr && objStr.includes(a.id)) ||
      (objStr && a.id.includes(objStr))
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
        const override = (change.stepOverrides || []).find(o => o.stepIndex === idx + 1 || o.action === step.action);
        const stepInputs = (override && override.inputs) ? override.inputs : (step.inputs || {});
        return {
          stepIndex: idx + 1,
          action: step.action,
          name: stepAction ? stepAction.name : `Step ${idx + 1}: ${step.action}`,
          provider: 'ansible',
          inputs: stepInputs
        };
      });
    } else {
      // Primitive Action Execution: synthesize an autonomous 1-step plan directly
      planBlueprintName = `${action.id}-primitive@1.0.0`;
      planSteps = [{
        stepIndex: 1,
        action: action.id,
        name: action.name || action.id,
        provider: 'ansible',
        inputs: {}
      }];
    }
  }

  // Gate 4: Reject if any step action is in DRAFT status
  for (const step of planSteps) {
    const act = getAction(step.action);
    if (act && act.status === 'DRAFT') {
      return res.status(400).json({
        error: `Không thể tạo Execution Plan: Action '${act.id}' đang ở trạng thái DRAFT. Vui lòng duyệt (Publish) Action trước khi thực thi.`
      });
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
// BACKGROUND ORCHESTRATOR WORKER (Direct Ansible Playbook Runner)
// ===========================
async function runOrchestrator(executionId, plan, changeId) {
  const execution = state.executions.get(executionId);
  const change = state.changes.get(changeId);
  if (!execution || !change) return;

  const catalog = getCatalog();
  const bpName = plan.blueprint.split('@')[0];
  const blueprint = catalog.blueprints.find(b => b.metadata.name === bpName) || catalog.blueprints[0];
  const targetHosts = change.target || 'db_servers';

  // Build per-step overrides from plan.steps
  const stepOverrides = (plan.steps || []).map(s => ({
    stepIndex: s.stepIndex,
    stepId: s.stepId,
    action: s.action,
    inputs: s.inputs || {}
  }));

  // 1. Generate the complete, parameter-bound Playbook YAML
  const playbookContent = generateBlueprintPlaybook(blueprint, targetHosts, stepOverrides);

  // 2. Prepare structured extraVars for per-action inputs (dynamic for any N steps)
  const extraVars = {
    target_hosts: targetHosts
  };
  const bpStepsList = blueprint.spec?.steps || [];
  const totalStepsCount = Math.max(stepOverrides.length, bpStepsList.length);
  for (let i = 0; i < totalStepsCount; i++) {
    const sOverride = stepOverrides[i];
    const sBp = bpStepsList[i];
    const stepInputs = sOverride?.inputs || sBp?.inputs || {};
    extraVars[`action${i + 1}`] = stepInputs;

    const stepId = sOverride?.stepId || sBp?.stepId;
    if (stepId) {
      extraVars[stepId] = stepInputs;
    }
  }

  let effectiveCredId = change.credentialId;
  if (!effectiveCredId && change.target) {
    const hostRec = getHost(change.target);
    if (hostRec && hostRec.defaultCredentialId) {
      effectiveCredId = hostRec.defaultCredentialId;
      execution.logTail += `[ORCHESTRATOR] Auto-bound Default Host Credential "${hostRec.defaultCredentialId}" for registered host "${hostRec.name}"\n`;
    }
  }

  // 2.1 Inject Managed Credential (AWX Architecture)
  if (effectiveCredId) {
    const credSecrets = getCredentialSecrets(effectiveCredId);
    if (credSecrets) {
      execution.logTail += `[ORCHESTRATOR] Attached Credential: "${credSecrets.name}" (${credSecrets.type.toUpperCase()})\n`;
      if (credSecrets.username) {
        extraVars.ansible_user = credSecrets.username;
      }
      if (credSecrets.type === 'machine') {
        if (credSecrets.authType === 'ssh_key') {
          if (credSecrets.sshKeyPath) {
            extraVars.ansible_ssh_private_key_file = credSecrets.sshKeyPath;
          }
          if (credSecrets.sshKeyData) {
            extraVars.ssh_key_data = credSecrets.sshKeyData;
          }
        } else if (credSecrets.password) {
          extraVars.ansible_password = credSecrets.password;
        }
        const becomePass = credSecrets.becomePassword || credSecrets.password;
        if (becomePass) {
          extraVars.ansible_become_method = credSecrets.becomeMethod || 'sudo';
          extraVars.ansible_become_password = becomePass;
        }
      } else if (credSecrets.type === 'network') {
        if (credSecrets.password) {
          extraVars.ansible_password = credSecrets.password;
        }
        if (credSecrets.enablePassword) {
          extraVars.ansible_become = 'yes';
          extraVars.ansible_become_method = 'enable';
          extraVars.ansible_become_password = credSecrets.enablePassword;
        }
      }
    } else {
      execution.logTail += `[ORCHESTRATOR] Warning: Credential "${change.credentialId}" not found in store.\n`;
    }
  }

  writeAudit('Execution', executionId, 'orchestrator', 'playbook_generated', 'success',
    `Generated Ansible playbook for ${blueprint.metadata.name} on target ${targetHosts}`);

  // 3. Run directly with Ansible CLI Runner
  try {
    const result = await runAnsiblePlaybook({
      playbookContent,
      targetHosts,
      extraVars,
      executionId,
      onLog: (line) => {
        execution.logTail += line + '\n';
      },
      onStepProgress: (stepIdx, status, details) => {
        if (execution.steps[stepIdx]) {
          execution.steps[stepIdx].status = status;
          if (status === 'RUNNING') {
            execution.currentStepIndex = stepIdx;
            execution.steps[stepIdx].startedAt = new Date().toISOString();
          }
          if (status === 'SUCCESS' || status === 'FAILED') {
            execution.steps[stepIdx].finishedAt = new Date().toISOString();
          }
        }
        if (details) {
          if (details.tasks) execution.tasks = details.tasks;
          if (details.failureDiagnosis) execution.failureDiagnosis = details.failureDiagnosis;
        }
      }
    });

    if (result.tasks) execution.tasks = result.tasks;
    if (result.failureDiagnosis) execution.failureDiagnosis = result.failureDiagnosis;

    if (result.success) {
      execution.status = 'completed';
      execution.finishedAt = new Date().toISOString();
      change.state = 'Verified';
      state.changes.set(changeId, change);

      writeAudit('Execution', executionId, 'orchestrator', 'workflow_completed', 'success',
        `Blueprint ${plan.blueprint} completed all ${execution.steps.length} steps successfully.`);
    } else {
      execution.status = 'failed';
      execution.finishedAt = new Date().toISOString();
      change.state = 'Failed';
      state.changes.set(changeId, change);

      writeAudit('Execution', executionId, 'orchestrator', 'workflow_failed', 'failed',
        `Playbook execution failed with exit code ${result.exitCode}.`);
      writeAudit('Compensation', changeId, 'orchestrator', 'NOTIFY_ONCALL', 'escalated',
        `Workflow failed. Triggered NOTIFY_ONCALL.`);
    }
  } catch (err) {
    execution.status = 'failed';
    execution.finishedAt = new Date().toISOString();
    execution.logTail += `\n[FATAL ERROR] ${err.message}\n`;
    change.state = 'Failed';
    state.changes.set(changeId, change);

    writeAudit('Execution', executionId, 'orchestrator', 'workflow_exception', 'failed', err.message);
  }
}

// ===========================
// EXECUTIONS API
// ===========================

// GET /api/executions - List all executions
app.get('/api/executions', (req, res) => {
  res.json(Array.from(state.executions.values()));
});

// GET /api/executions/:id - Get execution details
app.get('/api/executions/:id', (req, res) => {
  const execution = state.executions.get(req.params.id);
  if (!execution) return res.status(404).json({ error: 'Execution not found' });
  res.json(execution);
});

// GET /api/executions/:id/status - Polling execution status
app.get('/api/executions/:id/status', (req, res) => {
  const execution = state.executions.get(req.params.id);
  if (!execution) return res.status(404).json({ error: 'Execution not found' });
  res.json({
    ...execution,
    finished: execution.status === 'completed' || execution.status === 'failed'
  });
});

// GET /api/executions/:id/log - Real-time terminal log stream
app.get('/api/executions/:id/log', (req, res) => {
  const execution = state.executions.get(req.params.id);
  if (!execution) return res.status(404).send('Execution not found');
  res.type('text/plain').send(execution.logTail || '');
});

// POST /api/plans/:id/execute - Execute plan (launches Ansible Playbook directly)
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

  // Gate 4: Reject if any step action is in DRAFT status
  for (const step of plan.steps || []) {
    const act = getAction(step.action);
    if (act && act.status === 'DRAFT') {
      return res.status(403).json({
        error: `Thực thi bị chặn: Action '${act.id}' đang ở trạng thái DRAFT. Vui lòng duyệt (Publish) Action trước khi thực thi.`
      });
    }
  }
  
  const executionId = `EXEC-${String(executionCounter++).padStart(3, '0')}`;
  
  const execution = {
    executionId,
    planId: id,
    changeId: plan.changeId,
    blueprint: plan.blueprint,
    status: 'running',
    currentStepIndex: 0,
    steps: plan.steps.map((step, idx) => ({
      stepIndex: idx,
      stepName: step.name || `Step ${idx + 1}: ${step.action}`,
      actionId: step.action,
      inputs: step.inputs || {},
      status: 'PENDING',
      startedAt: null,
      finishedAt: null,
      logTail: ''
    })),
    tasks: [],
    failureDiagnosis: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    logTail: `[ORCHESTRATOR] Starting direct Ansible execution for ${plan.blueprint} (${plan.steps.length} actions)...\n`
  };
  
  state.executions.set(executionId, execution);
  
  // Update change state
  change.state = 'Executing';
  change.executionId = executionId;
  state.changes.set(plan.changeId, change);
  
  writeAudit('Execution', executionId, 'system', 'launched', 'success', 
    `Started direct Ansible orchestration for plan ${id} (${execution.steps.length} steps)`);
  
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
  
  res.type('text/plain').send(execution.logTail || '');
});

// GET /api/executions/:id/events - Get execution events (step progression)
app.get('/api/executions/:id/events', async (req, res) => {
  const { id } = req.params;
  const execution = state.executions.get(id);
  
  if (!execution) {
    return res.status(404).json({ error: 'Execution not found' });
  }
  
  res.json(execution.steps || []);
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
  console.log(`✓ Ansible Direct Engine: Active (No AWX required)`);
  console.log(`✓ Ready to accept requests from frontend`);
});
