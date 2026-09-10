import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';
import zlib from 'zlib';
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

// Maximum uncompressed size: 50MB (Zip Bomb Protection)
const MAX_UNCOMPRESSED_SIZE = 50 * 1024 * 1024;
const MAX_ENTRY_COUNT = 500;
const SENSITIVE_PATTERNS = [/\.env$/i, /\.pem$/i, /\.key$/i, /id_rsa/i, /id_ed25519/i, /credentials\.json$/i, /vault_pass/i];

export const ALLOWED_ROLE_SUBDIRS = new Set([
  'tasks', 'defaults', 'vars', 'handlers', 'templates', 'files', 'meta', 'tests'
]);

// Python plugin directories — rejected outright for self-service import.
// Python is Turing-complete: no static analysis can reliably detect malicious code
// (eval, pickle.loads, obfuscated payloads). Admin manual installation required.
export const REJECTED_PLUGIN_DIRS = new Set([
  'library', 'lookup_plugins', 'filter_plugins', 'module_utils',
  'callback_plugins', 'connection_plugins', 'action_plugins', 'inventory_plugins'
]);

export const ALLOWED_ROOT_FILES = new Set([
  'readme.md', 'readme.txt', 'readme',
  'license', 'license.txt', 'license.md',
  'changelog.md', 'changelog.txt',
  'contributing.md',
  '.gitkeep', '.ansible-lint',
  'requirements.yml', 'requirements.yaml',
  'meta.yml', 'meta.yaml'
]);

// Windows reserved device names (CON, PRN, AUX, NUL, COM1-9, LPT1-9)
const WINDOWS_RESERVED_DEVICE_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

// Malicious execution patterns in task & template definitions (Critical - BLOCKING)
const MALICIOUS_PATTERNS = [
  { pattern: /(?:curl|wget)\s+[^\n|]*\|\s*(?:ba|z|t?c)?sh/i, description: 'Lệnh tải mã độc từ xa và pipe trực tiếp vào shell (curl/wget | bash)' },
  { pattern: /(?:base64\s+-(?:d|-decode)|openssl\s+enc\s+-d)\s*\|\s*(?:ba|z|t?c)?sh/i, description: 'Lệnh giải mã base64 và pipe trực tiếp vào shell' },
  { pattern: /(?:python[23]?|perl|ruby|php)\s+-c\s+['"][^'"]*(?:urllib|requests|socket|pty|subprocess|eval|exec|system)/i, description: 'Lệnh thực thi script nội dòng (inline python/perl/ruby) mở socket/subprocess' },
  { pattern: /\brm\s+(?:-[a-zA-Z]*f[a-zA-Z]*\s+)?(?:\/|\/\*)\b/, description: 'Lệnh xóa trắng hệ thống tệp gốc (rm -rf /)' },
  { pattern: /(?:\/etc\/shadow|\/etc\/gshadow)\b/i, description: 'Đọc/can thiệp file mật khẩu băm của hệ thống (/etc/shadow)' },
  { pattern: /(?:\/dev\/tcp\/|\/dev\/udp\/|\bnc\s+-[a-zA-Z0-9]*e\b|\bmkfifo\s+\/tmp\/|\bbash\s+-i\s+>&)/i, description: 'Lệnh tạo Reverse Shell kết nối trái phép ra bên ngoài' },
  { pattern: /-----BEGIN\s+(?:RSA|EC|DSA|OPENSSH)?\s*PRIVATE\s+KEY-----/i, description: 'Chứa Private Key nhúng trực tiếp trong nội dung task/template' },
  { pattern: /lookup\s*\(\s*['"]pipe['"]/i, description: 'Hàm lookup("pipe", ...) cho phép chạy lệnh tùy ý trên máy chủ Controller' },
  { pattern: /(?:__class__|__mro__|__subclasses__|__globals__|__builtins__|subprocess\.Popen)/i, description: 'Khai thác Server-Side Template Injection (SSTI) / Python Introspection' }
];

// High-risk Ansible modules requiring explicit admin audit (Warnings)
const HIGH_RISK_MODULES = new Set([
  'ansible.builtin.shell', 'shell',
  'ansible.builtin.raw', 'raw',
  'ansible.builtin.script', 'script',
  'ansible.builtin.fetch', 'fetch'
]);

/**
 * Gate 2b: Scan Task Execution Security (Per-file YAML AST & Pattern scan)
 */
export function scanTaskExecutionSecurity(tasksYamlContent, sourceContext = 'tasks/main.yml') {
  const blockingErrors = [];
  const auditWarnings = [];

  if (!tasksYamlContent || typeof tasksYamlContent !== 'string') {
    return { pass: true, blockingErrors, auditWarnings };
  }

  // 1. Scan for critical malicious string patterns
  for (const item of MALICIOUS_PATTERNS) {
    if (item.pattern.test(tasksYamlContent)) {
      blockingErrors.push(`[CẢNH BÁO AN NINH CỰC NGUY HIỂM] ${item.description} trong '${sourceContext}'.`);
    }
  }

  // 2. Parse YAML AST to inspect tasks and modules
  try {
    const tasksDoc = yaml.load(tasksYamlContent);
    if (Array.isArray(tasksDoc)) {
      for (const t of tasksDoc) {
        if (!t || typeof t !== 'object') continue;
        const taskName = t.name || 'Unnamed Task';
        for (const key of Object.keys(t)) {
          if (HIGH_RISK_MODULES.has(key)) {
            if (key.includes('fetch')) {
              auditWarnings.push(`Tác vụ "${taskName}" dùng module '${key}': Cho phép lấy file từ máy chủ đích về controller; cần kiểm toán đường dẫn tránh rò rỉ dữ liệu.`);
            } else {
              auditWarnings.push(`Tác vụ "${taskName}" dùng module '${key}': Cho phép thực thi lệnh shell tùy ý; cần Quản trị viên thẩm định kỹ mã nguồn trước khi Publish.`);
            }
          }
        }
      }
    }
  } catch (e) {
    // YAML parsing errors will be caught by syntax checker
  }

  return {
    pass: blockingErrors.length === 0,
    blockingErrors,
    auditWarnings
  };
}

/**
 * Gate 2b Comprehensive: Scans tasks/, handlers/, templates/, vars/, and defaults/
 * Ensures malicious logic cannot hide in secondary directories or templates.
 */
export function scanRoleSecurityComprehensive(roleDir) {
  const blockingErrors = [];
  const auditWarnings = [];

  function scanDir(subDirName, allowedExts, handler) {
    const targetDir = path.join(roleDir, subDirName);
    if (!fs.existsSync(targetDir)) return;
    try {
      function walk(dir) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const ent of entries) {
          if (ent.isSymbolicLink()) continue;
          const full = path.join(dir, ent.name);
          if (ent.isDirectory()) {
            walk(full);
          } else if (ent.isFile()) {
            const ext = path.extname(ent.name).toLowerCase();
            if (allowedExts.some(e => ent.name.toLowerCase().endsWith(e))) {
              const rel = path.relative(roleDir, full).replace(/\\/g, '/');
              const content = fs.readFileSync(full, 'utf-8');
              handler(content, rel);
            }
          }
        }
      }
      walk(targetDir);
    } catch (e) {}
  }

  // 1. Scan tasks/
  scanDir('tasks', ['.yml', '.yaml'], (content, rel) => {
    const res = scanTaskExecutionSecurity(content, rel);
    if (!res.pass) blockingErrors.push(...res.blockingErrors);
    auditWarnings.push(...res.auditWarnings);
  });

  // 2. Scan handlers/
  scanDir('handlers', ['.yml', '.yaml'], (content, rel) => {
    const res = scanTaskExecutionSecurity(content, rel);
    if (!res.pass) blockingErrors.push(...res.blockingErrors);
    auditWarnings.push(...res.auditWarnings);
  });

  // 3. Scan templates/ (.j2, .jinja2)
  scanDir('templates', ['.j2', '.jinja2'], (content, rel) => {
    for (const item of MALICIOUS_PATTERNS) {
      if (item.pattern.test(content)) {
        blockingErrors.push(`[CẢNH BÁO AN NINH CỰC NGUY HIỂM] ${item.description} trong template '${rel}'.`);
      }
    }
  });

  // 4. Scan vars/ and defaults/
  const scanVarsOrDefaults = (content, rel) => {
    for (const item of MALICIOUS_PATTERNS) {
      if (item.pattern.test(content)) {
        blockingErrors.push(`[CẢNH BÁO AN NINH CỰC NGUY HIỂM] ${item.description} trong biến '${rel}'.`);
      }
    }
  };
  scanDir('vars', ['.yml', '.yaml'], scanVarsOrDefaults);
  scanDir('defaults', ['.yml', '.yaml'], scanVarsOrDefaults);

  return {
    pass: blockingErrors.length === 0,
    blockingErrors: [...new Set(blockingErrors)],
    auditWarnings: [...new Set(auditWarnings)]
  };
}

/**
 * Gate 1: Unzip with Dual-Layer Zip Bomb Defense, Windows-Hardened Zip-Slip Guard & Symlink Block
 */
export function extractZipWithSecurity(zipBuffer, destDir) {
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  const zip = new AdmZip(zipBuffer);
  const zipEntries = zip.getEntries();
  const canonicalDest = path.resolve(destDir);

  // Layer 1 Check: Entry count limit
  if (zipEntries.length > MAX_ENTRY_COUNT) {
    throw new Error(`CẢNH BÁO BẢO MẬT: File zip chứa quá nhiều entry (${zipEntries.length} > ${MAX_ENTRY_COUNT}). Nghi vấn Zip Bomb!`);
  }

  // Layer 1 Pre-Scan: Header uncompressed size & sensitive file hints
  let declaredUncompressedSize = 0;
  const sensitiveWarnings = [];

  for (const entry of zipEntries) {
    declaredUncompressedSize += (entry.header ? entry.header.size : 0);

    const baseName = path.basename(entry.entryName);
    if (SENSITIVE_PATTERNS.some(p => p.test(baseName))) {
      sensitiveWarnings.push(entry.entryName);
    }

    // Header compression ratio sanity check
    if (entry.header && entry.header.compressedSize > 0 && entry.header.size > 1024 * 1024) {
      const ratio = entry.header.size / entry.header.compressedSize;
      if (ratio > 100) {
        throw new Error(`CẢNH BÁO BẢO MẬT: Entry '${entry.entryName}' có tỷ lệ nén bất thường (${Math.round(ratio)}x theo header). Nghi vấn Zip Bomb!`);
      }
    }
  }

  if (declaredUncompressedSize > MAX_UNCOMPRESSED_SIZE) {
    throw new Error(`CẢNH BÁO BẢO MẬT: Tổng dung lượng giải nén theo khai báo (${(declaredUncompressedSize / (1024 * 1024)).toFixed(1)}MB) vượt quá giới hạn an toàn 50MB (Zip Bomb Protection)!`);
  }

  // Layer 2 Extraction & Real Runtime Byte Metering
  let actualTotalDecompressedBytes = 0;

  for (const entry of zipEntries) {
    const rawName = entry.entryName.replace(/\\/g, '/');

    // Windows & POSIX Zip-Slip Guard 1: Reject absolute paths, UNC paths, and drive letters
    if (
      rawName.startsWith('/') ||
      rawName.startsWith('//') ||
      entry.entryName.startsWith('\\\\') ||
      /^[a-zA-Z]:/.test(rawName)
    ) {
      throw new Error(`CẢNH BÁO BẢO MẬT: Phát hiện entry có đường dẫn tuyệt đối hoặc UNC trái phép '${entry.entryName}'!`);
    }

    // Windows Device Name Guard: Reject CON, PRN, AUX, NUL, COM1..9, LPT1..9
    const baseName = path.basename(rawName).toLowerCase();
    if (WINDOWS_RESERVED_DEVICE_NAMES.test(baseName)) {
      throw new Error(`CẢNH BÁO BẢO MẬT: Phát hiện entry sử dụng tên thiết bị hệ thống Windows trái phép '${entry.entryName}'!`);
    }

    // Canonical Boundary Check
    const targetPath = path.resolve(destDir, rawName);
    if (!targetPath.startsWith(canonicalDest + path.sep) && targetPath !== canonicalDest) {
      throw new Error(`CẢNH BÁO BẢO MẬT: Phát hiện tấn công Path Traversal (Zip-Slip) với entry '${entry.entryName}'!`);
    }

    // Reject Symbolic Link entries
    if (entry.header && (entry.header.isSymbolicLink || (entry.attr && (entry.attr & 0o120000) === 0o120000))) {
      throw new Error(`CẢNH BÁO BẢO MẬT: Chặn entry là Symbolic Link '${entry.entryName}' để ngăn ngừa Symbolic Link Traversal.`);
    }

    if (entry.isDirectory) {
      fs.mkdirSync(targetPath, { recursive: true });
    } else {
      const parentDir = path.dirname(targetPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

      // Native Memory-Guarded Decompression:
      // entry.getData() would allocate the entire uncompressed buffer in RAM at once,
      // which can trigger an OOM crash if a 10KB zip deflates to several GBs.
      // Instead, we decompress with native zlib.inflateRawSync using maxOutputLength.
      let content;
      const remainingAllowedBytes = MAX_UNCOMPRESSED_SIZE - actualTotalDecompressedBytes;
      if (remainingAllowedBytes <= 0) {
        throw new Error(`CẢNH BÁO BẢO MẬT: Tổng dung lượng giải nén thực tế vượt quá giới hạn an toàn 50MB (Zip Bomb Protection)!`);
      }

      try {
        const compressed = entry.getCompressedData();
        if (entry.header && entry.header.method === 0) {
          // Stored (no compression): directly verify length before allocation
          if (compressed.length > remainingAllowedBytes) {
            throw new Error(`CẢNH BÁO BẢO MẬT: Entry '${entry.entryName}' (${(compressed.length / (1024 * 1024)).toFixed(1)}MB) vượt quá dung lượng cho phép!`);
          }
          content = compressed;
        } else {
          // Deflate (method 8): native zlib enforcement with maxOutputLength ceiling
          content = zlib.inflateRawSync(compressed, { maxOutputLength: remainingAllowedBytes });
        }
      } catch (decompressErr) {
        if (decompressErr.code === 'ERR_BUFFER_TOO_LARGE' || decompressErr.message?.includes('larger than')) {
          throw new Error(`CẢNH BÁO BẢO MẬT: Entry '${entry.entryName}' giải nén vượt quá trần bộ nhớ cho phép (50MB). Chặn đứng Zip Bomb trước khi cấp phát RAM!`);
        }
        // Fallback to entry.getData() only if custom compression method, but guarded by remainingAllowedBytes
        content = entry.getData();
        if (content.length > remainingAllowedBytes) {
          throw new Error(`CẢNH BÁO BẢO MẬT: Entry '${entry.entryName}' giải nén (${(content.length / (1024 * 1024)).toFixed(1)}MB) vượt quá giới hạn an toàn 50MB!`);
        }
      }

      actualTotalDecompressedBytes += content.length;

      if (actualTotalDecompressedBytes > MAX_UNCOMPRESSED_SIZE) {
        throw new Error(`CẢNH BÁO BẢO MẬT: Dung lượng giải nén thực tế (${(actualTotalDecompressedBytes / (1024 * 1024)).toFixed(1)}MB) vượt quá giới hạn an toàn 50MB (Zip Bomb Protection)!`);
      }

      if (entry.header && entry.header.compressedSize > 0 && content.length > 1024 * 1024) {
        const actualRatio = content.length / entry.header.compressedSize;
        if (actualRatio > 100) {
          throw new Error(`CẢNH BÁO BẢO MẬT: Entry '${entry.entryName}' có tỷ lệ nén thực tế bất thường (${Math.round(actualRatio)}x). Nghi vấn Zip Bomb!`);
        }
      }

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

  return {
    success: true,
    count: zipEntries.length,
    uncompressedSize: actualTotalDecompressedBytes,
    sensitiveWarnings: [...new Set(sensitiveWarnings)]
  };
}

/**
 * Recursively search for role root (directory containing 'tasks/' folder)
 * or standalone playbook in extracted zip directory.
 * Uses fs.lstatSync to guarantee symlinks are never followed.
 */
export function findRoleRoot(startDir, isRole = true) {
  const lstat = fs.lstatSync(startDir);
  if (lstat.isSymbolicLink()) {
    throw new Error('CẢNH BÁO BẢO MẬT: Không cho phép Symbolic Link trong thư mục Role.');
  }

  if (fs.existsSync(path.join(startDir, 'tasks'))) {
    return { type: 'role', dir: startDir };
  }

  function searchTasks(dir, depth) {
    if (depth > 4) return null;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        if (e.isSymbolicLink()) continue; // Never follow symlinks
        if (e.isDirectory()) {
          const full = path.join(dir, e.name);
          if (fs.existsSync(path.join(full, 'tasks'))) {
            return { type: 'role', dir: full };
          }
          const nested = searchTasks(full, depth + 1);
          if (nested) return nested;
        }
      }
    } catch (err) {}
    return null;
  }

  const roleRes = searchTasks(startDir, 1);
  if (roleRes) return roleRes;

  if (!isRole) {
    function searchPlaybook(dir, depth) {
      if (depth > 3) return null;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const e of entries) {
          if (e.isSymbolicLink()) continue; // Never follow symlinks
          if (e.isFile() && (e.name.endsWith('.yml') || e.name.endsWith('.yaml'))) {
            return { type: 'playbook', file: path.join(dir, e.name) };
          }
          if (e.isDirectory()) {
            const nested = searchPlaybook(path.join(dir, e.name), depth + 1);
            if (nested) return nested;
          }
        }
      } catch (err) {}
      return null;
    }

    const pbRes = searchPlaybook(startDir, 1);
    if (pbRes) return pbRes;
  }

  return { type: isRole ? 'role_missing_tasks' : 'unknown', dir: startDir };
}

/**
 * Strict Ansible Doc Role Directory Structure Validator
 * Enforces presence of tasks/main.yml and separates subdirs vs root files allowlists.
 */
export function validateRoleDirectoryStructure(roleDir) {
  const lstat = fs.lstatSync(roleDir);
  if (lstat.isSymbolicLink()) {
    return {
      valid: false,
      error: 'Quy chuẩn Ansible thất bại: Thư mục Role không được là một Symbolic Link.'
    };
  }

  // 1. Core Requirement: tasks/main.yml or tasks/main.yaml must exist
  const tasksDir = path.join(roleDir, 'tasks');
  if (!fs.existsSync(tasksDir)) {
    return {
      valid: false,
      error: "Quy chuẩn Ansible Docs thất bại: Không tìm thấy thư mục 'tasks/'. Theo tài liệu chính thức của Ansible, mọi Role bắt buộc phải có thư mục 'tasks/' chứa file 'main.yml' (https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_reuse_roles.html#role-directory-structure)."
    };
  }

  const tasksLstat = fs.lstatSync(tasksDir);
  if (!tasksLstat.isDirectory() || tasksLstat.isSymbolicLink()) {
    return {
      valid: false,
      error: "Quy chuẩn Ansible Docs thất bại: 'tasks' phải là một thư mục thực sự (không phải file hay symbolic link)."
    };
  }

  const hasMainYml = fs.existsSync(path.join(tasksDir, 'main.yml'));
  const hasMainYaml = fs.existsSync(path.join(tasksDir, 'main.yaml'));

  if (!hasMainYml && !hasMainYaml) {
    return {
      valid: false,
      error: "Quy chuẩn Ansible Docs thất bại: Thiếu file cốt lõi 'tasks/main.yml' (hoặc 'tasks/main.yaml'). Đây là entrypoint bắt buộc của mọi Ansible Role."
    };
  }

  // 2. Scan and validate entries in role root (Separating subdirectories vs root files)
  const detectedSubdirs = [];
  const detectedRootFiles = [];
  const warnings = [];

  const entries = fs.readdirSync(roleDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      return {
        valid: false,
        error: `Quy chuẩn Ansible thất bại: Phát hiện Symbolic Link '${entry.name}' trong cấu trúc Role.`
      };
    }

    const lowerName = entry.name.toLowerCase();

    if (entry.isDirectory()) {
      // BLOCK: Python plugin directories — cannot be safely audited via self-service
      if (REJECTED_PLUGIN_DIRS.has(lowerName)) {
        return {
          valid: false,
          error: `[CHẶN CỨNG] Role chứa thư mục custom Python plugin '${entry.name}/'. ` +
            `Synapse Self-Service Import không hỗ trợ custom Python module/plugin vì không thể ` +
            `kiểm toán an ninh mã Python tự động một cách tin cậy (ngôn ngữ Turing-complete). ` +
            `Nếu thực sự cần custom module, hãy liên hệ Quản trị viên để thêm thủ công ngoài luồng Self-Service.`
        };
      }
      // Check against standard Ansible role directories
      if (ALLOWED_ROLE_SUBDIRS.has(lowerName)) {
        detectedSubdirs.push(entry.name);
      } else if (!lowerName.startsWith('.')) {
        warnings.push(`Thư mục '${entry.name}' không nằm trong chuẩn Ansible Role tiêu chuẩn.`);
      }
    } else if (entry.isFile()) {
      // Check against strictly allowed root files (no wildcards)
      if (ALLOWED_ROOT_FILES.has(lowerName)) {
        detectedRootFiles.push(entry.name);
      } else if (!lowerName.startsWith('.')) {
        warnings.push(`File rời '${entry.name}' ở thư mục gốc không thuộc danh mục tài liệu chuẩn.`);
      }
    }
  }

  return {
    valid: true,
    detectedSubdirs,
    detectedRootFiles,
    warnings
  };
}

/**
 * Generate a standard, compliant Ansible Role template .zip in-memory
 */
export function generateStandardRoleTemplateZip(roleName = 'sample_custom_role') {
  const zip = new AdmZip();

  const mainTasksContent = `---
# ============================================================
# Synapse Sample Ansible Role: ${roleName}
# Tài liệu chuẩn: https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_reuse_roles.html
# ============================================================
- name: "1. Ping Target Server"
  ansible.builtin.ping:

- name: "2. Check Service Status"
  ansible.builtin.command:
    cmd: "systemctl status {{ target_service_name | default('postgresql@18-main.service') }}"
  register: service_status_result
  failed_when: false
  changed_when: false

- name: "3. Verify Health Assertion"
  ansible.builtin.assert:
    that:
      - service_status_result.rc is defined
    success_msg: "Host và dịch vụ {{ target_service_name }} đã sẵn sàng."
    fail_msg: "Dịch vụ {{ target_service_name }} không hoạt động như mong đợi."
`;

  const defaultsContent = `---
# ============================================================
# Default Variables for Role: ${roleName}
# Synapse sẽ tự động trích xuất các biến này để sinh Form Inputs
# ============================================================
target_service_name: "postgresql@18-main.service"
check_timeout_seconds: 15
enable_debug_mode: false
`;

  const readmeContent = `# ${roleName}

Role tự động hóa được đóng gói theo chuẩn chính thức của Red Hat / Ansible Docs.

## Cấu trúc thư mục:
- \`tasks/main.yml\`: (Bắt buộc) Danh sách tác vụ Ansible thực thi.
- \`defaults/main.yml\`: (Khuyến nghị) Khai báo các biến mặc định. Synapse đọc file này để tự sinh Form Inputs trên giao diện.
- \`README.md\`: Tài liệu hướng dẫn sử dụng role.

## Quy tắc đóng gói khi tải lên Synapse:
1. Đặt tên role bằng chữ thường và gạch dưới: \`^[a-z0-9_]+$\` (ví dụ: \`${roleName}\`).
2. Nén toàn bộ thư mục thành file \`.zip\` (ví dụ: \`${roleName}.zip\`).
3. Tải lên tại mục **Actions -> Import Role / Playbook** trên giao diện Synapse.
`;

  // Pack into zip with standard role folder layout
  zip.addFile(`${roleName}/tasks/main.yml`, Buffer.from(mainTasksContent, 'utf-8'));
  zip.addFile(`${roleName}/defaults/main.yml`, Buffer.from(defaultsContent, 'utf-8'));
  zip.addFile(`${roleName}/README.md`, Buffer.from(readmeContent, 'utf-8'));

  return zip.toBuffer();
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

  const tmpDir = path.join(os.tmpdir(), 'synapse_roles');
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
      const internalFacts = new Set();
      try {
        const tasksDoc = yaml.load(taskContent);
        if (Array.isArray(tasksDoc)) {
          tasksDoc.forEach(t => {
            if (t) {
              if (t.name) {
                const mod = Object.keys(t).find(k => k.includes('.') || ['debug', 'copy', 'template', 'service', 'command', 'shell', 'include_role'].includes(k)) || 'ansible';
                detectedTasks.push({ name: t.name, module: mod });
              }
              if (t.register) internalFacts.add(String(t.register).trim());
              const setFactObj = t.set_fact || t['ansible.builtin.set_fact'];
              if (setFactObj && typeof setFactObj === 'object') {
                Object.keys(setFactObj).forEach(k => internalFacts.add(k.trim()));
              }
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
        if (!IGNORED_ANSIBLE_VARS.has(varName) && !internalFacts.has(varName) && !detectedVars.has(varName)) {
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
