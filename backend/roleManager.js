import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';
import * as yaml from 'js-yaml';
import { detectAnsibleEnvironment, toWslPath } from './ansibleRunner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ROLE_NAME_REGEX = /^[a-z0-9_]+$/;
const JINJA2_VAR_REGEX = /\{\{\s*([a-zA-Z0-9_]+)(?:\s*\|[^}]*)?\s*\}\}/g;

const IGNORED_ANSIBLE_VARS = new Set([
  'ansible_check_mode', 'item', 'inventory_hostname', 'omit',
  'ansible_user', 'ansible_host', 'ansible_port', 'ansible_password',
  'ansible_become', 'ansible_become_password', 'ansible_ssh_user',
  'playbook_dir', 'role_path', 'ansible_os_family', 'ansible_distribution'
]);

/**
 * Gate 1: Validate role name strictly against Path Traversal & illegal characters
 */
export function validateRoleName(roleName) {
  if (!roleName || typeof roleName !== 'string') {
    return { valid: false, error: 'Tên Role không được để trống.' };
  }
  const trimmed = roleName.trim();
  if (!ROLE_NAME_REGEX.test(trimmed)) {
    return { 
      valid: false, 
      error: `[Gate 1] Tên Role '${trimmed}' không hợp lệ. Chỉ cho phép chữ thường, số và dấu gạch dưới (a-z, 0-9, _) để ngăn chặn Path Traversal.` 
    };
  }
  return { valid: true, roleName: trimmed };
}

/**
 * Gate 1: Unzip with Zip-Slip Guard & Line Ending Normalization (CRLF -> LF)
 */
export function extractZipWithSecurity(zipBuffer, destDir) {
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  const zip = new AdmZip(zipBuffer);
  const zipEntries = zip.getEntries();
  const canonicalDest = path.resolve(destDir);

  for (const entry of zipEntries) {
    const entryName = entry.entryName.replace(/\\/g, '/');
    const targetPath = path.resolve(destDir, entryName);

    // Zip-Slip Protection Check
    if (!targetPath.startsWith(canonicalDest + path.sep) && targetPath !== canonicalDest) {
      throw new Error(`CẢNH BÁO BẢO MẬT: Phát hiện tấn công Path Traversal (Zip-Slip) với entry '${entry.entryName}'!`);
    }

    if (entry.isDirectory) {
      fs.mkdirSync(targetPath, { recursive: true });
    } else {
      const parentDir = path.dirname(targetPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

      let content = entry.getData();
      const ext = path.extname(targetPath).toLowerCase();
      // Line Ending Normalization to LF for text/yaml files
      if (['.yml', '.yaml', '.j2', '.json', '.txt', '.ini', '.cfg'].includes(ext)) {
        const text = content.toString('utf-8').replace(/\r\n/g, '\n');
        fs.writeFileSync(targetPath, text, 'utf-8');
      } else {
        fs.writeFileSync(targetPath, content);
      }
    }
  }

  return { success: true, count: zipEntries.length };
}

function prioritizeSyntaxErrors(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const lines = raw.split('\n');
  const errorIdx = lines.findIndex(l => l.trim().startsWith('ERROR!'));
  if (errorIdx > 0) {
    const warnings = lines.slice(0, errorIdx).filter(l => l.trim().startsWith('[WARNING]'));
    const errorsAndRest = lines.slice(errorIdx);
    return [...errorsAndRest, '', ...warnings].join('\n').trim();
  }
  return raw.trim();
}

/**
 * Gate 2: Mandatory Syntax Check using dynamic runner and spawn() without shell
 */
export async function runSyntaxCheck({ roleName, roleDir, isRole = true, playbookContent = null }) {
  const env = detectAnsibleEnvironment();
  if (env.type === 'simulated') {
    return {
      pass: true,
      exitCode: 0,
      output: '[SYNTAX CHECK] Simulated mode: syntax check bypassed (Ansible CLI not available locally).'
    };
  }

  const tmpDir = path.join(__dirname, 'temp');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  const timestamp = Date.now();
  const tempPlaybookPath = path.join(tmpDir, `syntax_check_${timestamp}.yml`);

  let testPlaybook = '';
  if (isRole) {
    testPlaybook = `---
- name: Syntax Check Role ${roleName}
  hosts: localhost
  connection: local
  gather_facts: no
  roles:
    - role: ${roleName}
`;
  } else {
    testPlaybook = playbookContent || '';
  }

  fs.writeFileSync(tempPlaybookPath, testPlaybook, 'utf-8');

  try {
    const configuredRolesPath = process.env.ANSIBLE_ROLES_PATH;
    if (!configuredRolesPath) {
      throw new Error('Cấu hình thiếu: ANSIBLE_ROLES_PATH chưa được khai báo trong backend/.env');
    }

    // Include the parent of roleDir in roles path so ansible-playbook finds the newly extracted role
    const parentRoleDir = path.dirname(roleDir);
    const effectiveRolesPath = `${parentRoleDir}:${configuredRolesPath}`;

    let bin = 'ansible-playbook';
    let args = ['--syntax-check', tempPlaybookPath];

    if (env.type === 'wsl') {
      bin = 'wsl';
      const wslDistro = process.env.WSL_DISTRO || env.distro;
      const wslUser = process.env.WSL_USER || env.user;
      if (!wslUser) {
        throw new Error('Cấu hình thiếu: WSL_USER chưa được khai báo trong backend/.env cho môi trường WSL');
      }
      const wslPrefix = [];
      if (wslDistro) wslPrefix.push('-d', wslDistro);
      wslPrefix.push('-u', wslUser);

      const wslRolesPath = `${toWslPath(parentRoleDir)}:${configuredRolesPath}`;
      const ansibleExecutable = process.env.ANSIBLE_PLAYBOOK_BIN || env.ansibleBin || 'ansible-playbook';

      args = [
        ...wslPrefix,
        'env',
        'TERM=dumb',
        'ANSIBLE_FORCE_COLOR=0',
        `ANSIBLE_ROLES_PATH=${wslRolesPath}`,
        ansibleExecutable,
        '--syntax-check',
        toWslPath(tempPlaybookPath)
      ];
    }

    // Execute via child_process.spawn with safe args array (NO shell execution)
    const result = await new Promise((resolve) => {
      let stdout = '';
      let stderr = '';

      const child = spawn(bin, args, {
        env: {
          ...process.env,
          TERM: 'dumb',
          ANSIBLE_FORCE_COLOR: '0'
        }
      });

      child.stdout.on('data', (d) => { stdout += d.toString('utf-8'); });
      child.stderr.on('data', (d) => { stderr += d.toString('utf-8'); });

      child.on('close', (code) => {
        const fullOutput = (stdout + '\n' + stderr).trim();
        const prioritized = prioritizeSyntaxErrors(fullOutput);
        resolve({
          pass: code === 0,
          exitCode: code,
          output: prioritized,
          stderr: prioritizeSyntaxErrors(stderr.trim())
        });
      });

      child.on('error', (err) => {
        resolve({
          pass: false,
          exitCode: 1,
          output: `Spawn error: ${err.message}`,
          stderr: err.message
        });
      });
    });

    return result;
  } finally {
    // Cleanup temporary check playbook
    try {
      if (fs.existsSync(tempPlaybookPath)) {
        fs.unlinkSync(tempPlaybookPath);
      }
    } catch (e) {
      console.warn('[ROLE MANAGER] Cleanup warning:', e.message);
    }
  }
}

/**
 * Gate 3: Auto-extract Jinja2 parameters & task names from role or YAML
 */
export function extractParametersAndTasks(roleDir, isRole = true, rawYaml = null) {
  const detectedTasks = [];
  const detectedVars = new Map(); // name -> { default, type, label }

  if (isRole) {
    // 1. Read defaults/main.yml
    const defaultsPath = path.join(roleDir, 'defaults', 'main.yml');
    if (fs.existsSync(defaultsPath)) {
      try {
        const doc = yaml.load(fs.readFileSync(defaultsPath, 'utf-8'));
        if (doc && typeof doc === 'object') {
          for (const [k, v] of Object.entries(doc)) {
            if (!IGNORED_ANSIBLE_VARS.has(k)) {
              detectedVars.set(k, {
                default: v,
                type: typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'boolean' : 'string'
              });
            }
          }
        }
      } catch (e) {
        console.warn('[ROLE MANAGER] Could not parse defaults/main.yml:', e.message);
      }
    }

    // 2. Read vars/main.yml
    const varsPath = path.join(roleDir, 'vars', 'main.yml');
    if (fs.existsSync(varsPath)) {
      try {
        const doc = yaml.load(fs.readFileSync(varsPath, 'utf-8'));
        if (doc && typeof doc === 'object') {
          for (const [k, v] of Object.entries(doc)) {
            if (!IGNORED_ANSIBLE_VARS.has(k) && !detectedVars.has(k)) {
              detectedVars.set(k, {
                default: v,
                type: typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'boolean' : 'string'
              });
            }
          }
        }
      } catch (e) {
        console.warn('[ROLE MANAGER] Could not parse vars/main.yml:', e.message);
      }
    }

    // 3. Scan tasks/main.yml
    const tasksPath = path.join(roleDir, 'tasks', 'main.yml');
    if (fs.existsSync(tasksPath)) {
      const taskContent = fs.readFileSync(tasksPath, 'utf-8');
      try {
        const tasksDoc = yaml.load(taskContent);
        if (Array.isArray(tasksDoc)) {
          tasksDoc.forEach(t => {
            if (t && t.name) {
              const mod = Object.keys(t).find(k => k.includes('.') || ['debug', 'copy', 'template', 'service', 'command', 'shell', 'include_role'].includes(k)) || 'ansible';
              detectedTasks.push({ name: t.name, module: mod });
            }
          });
        }
      } catch (e) {
        console.warn('[ROLE MANAGER] Could not parse tasks/main.yml as YAML:', e.message);
      }

      // Regex scan Jinja2 variables {{ var_name }}
      let match;
      while ((match = JINJA2_VAR_REGEX.exec(taskContent)) !== null) {
        const varName = match[1];
        if (!IGNORED_ANSIBLE_VARS.has(varName) && !detectedVars.has(varName)) {
          detectedVars.set(varName, {
            default: '',
            type: 'string'
          });
        }
      }
    }
  } else if (rawYaml) {
    // Standalone YAML
    try {
      const doc = yaml.load(rawYaml);
      const tasks = Array.isArray(doc) ? (doc[0]?.tasks || doc) : (doc?.tasks || []);
      if (Array.isArray(tasks)) {
        tasks.forEach(t => {
          if (t && t.name) detectedTasks.push(t.name);
        });
      }
    } catch (e) {}

    let match;
    while ((match = JINJA2_VAR_REGEX.exec(rawYaml)) !== null) {
      const varName = match[1];
      if (!IGNORED_ANSIBLE_VARS.has(varName) && !detectedVars.has(varName)) {
        detectedVars.set(varName, { default: '', type: 'string' });
      }
    }
  }

  // Convert to Synapse Action inputs contract schema
  const inputs = Array.from(detectedVars.entries()).map(([name, meta]) => {
    // Generate human-friendly label
    const label = name
      .split('_')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');

    return {
      name,
      label,
      type: meta.type || 'string',
      default: meta.default !== undefined ? meta.default : '',
      required: true,
      description: `Auto-extracted variable: ${name}`
    };
  });

  return { detectedTasks, inputs };
}

/**
 * Copy validated role into active project roles directory
 */
export function installRoleToProject(roleName, sourceRoleDir) {
  const projectRolesDir = path.join(__dirname, 'roles');
  if (!fs.existsSync(projectRolesDir)) {
    fs.mkdirSync(projectRolesDir, { recursive: true });
  }

  const destRoleDir = path.join(projectRolesDir, roleName);
  if (fs.existsSync(destRoleDir)) {
    fs.rmSync(destRoleDir, { recursive: true, force: true });
  }

  copyFolderRecursiveSync(sourceRoleDir, destRoleDir);
  return destRoleDir;
}

function copyFolderRecursiveSync(source, target) {
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
  }

  const files = fs.readdirSync(source);
  for (const file of files) {
    const curSource = path.join(source, file);
    const curTarget = path.join(target, file);
    if (fs.lstatSync(curSource).isDirectory()) {
      copyFolderRecursiveSync(curSource, curTarget);
    } else {
      fs.copyFileSync(curSource, curTarget);
    }
  }
}
