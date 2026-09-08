import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CREDENTIALS_FILE = path.join(__dirname, 'credentials.json');
const EXAMPLE_FILE = path.join(__dirname, 'credentials.example.json');

/**
 * Ensure credentials.json exists; if not, initialize from credentials.example.json
 */
function ensureCredentialsFile() {
  if (!fs.existsSync(CREDENTIALS_FILE)) {
    if (fs.existsSync(EXAMPLE_FILE)) {
      fs.copyFileSync(EXAMPLE_FILE, CREDENTIALS_FILE);
    } else {
      fs.writeFileSync(CREDENTIALS_FILE, '[]\n', 'utf-8');
    }
  }
}

function loadCredentialsRaw() {
  ensureCredentialsFile();
  try {
    const content = fs.readFileSync(CREDENTIALS_FILE, 'utf-8');
    return JSON.parse(content || '[]');
  } catch (err) {
    console.error('[CREDENTIAL STORE] Error loading credentials.json:', err.message);
    return [];
  }
}

function saveCredentialsRaw(list) {
  const tmp = CREDENTIALS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, CREDENTIALS_FILE);
}

/**
 * Sanitize secret fields before exposing via API
 */
export function sanitizeCredential(cred) {
  if (!cred) return null;
  const {
    password,
    sshKeyData,
    becomePassword,
    enablePassword,
    ...safeFields
  } = cred;

  return {
    ...safeFields,
    hasPassword: Boolean(password && password.trim().length > 0),
    hasSshKey: Boolean((sshKeyData && sshKeyData.trim().length > 0) || (cred.sshKeyPath && cred.sshKeyPath.trim().length > 0)),
    hasBecomePassword: Boolean(becomePassword && becomePassword.trim().length > 0),
    hasEnablePassword: Boolean(enablePassword && enablePassword.trim().length > 0)
  };
}

/**
 * List all credentials (sanitized by default)
 */
export function listCredentials({ sanitize = true } = {}) {
  const list = loadCredentialsRaw();
  return sanitize ? list.map(sanitizeCredential) : list;
}

/**
 * Get a single credential
 */
export function getCredential(id, { sanitize = true } = {}) {
  const list = loadCredentialsRaw();
  const cred = list.find(c => c.id === id);
  if (!cred) return null;
  return sanitize ? sanitizeCredential(cred) : cred;
}

/**
 * Get raw credential secrets for internal orchestrator execution only
 */
export function getCredentialSecrets(id) {
  const list = loadCredentialsRaw();
  return list.find(c => c.id === id) || null;
}

/**
 * Create a new credential
 */
export function addCredential(data) {
  const errors = [];
  if (!data.name || data.name.trim().length === 0) {
    errors.push('Name is required');
  }
  if (!['machine', 'network'].includes(data.type)) {
    errors.push('Type must be either "machine" or "network"');
  }
  if (!data.username || data.username.trim().length === 0) {
    errors.push('Username is required');
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const list = loadCredentialsRaw();
  const idSlug = data.name.toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 20);
  const id = data.id || `cred-${idSlug}-${Date.now().toString(36)}`;

  if (list.some(c => c.id === id)) {
    return { ok: false, errors: [`Credential with ID "${id}" already exists`] };
  }

  const now = new Date().toISOString();
  const newCred = {
    id,
    name: data.name.trim(),
    type: data.type,
    description: (data.description || '').trim(),
    username: data.username.trim(),
    authType: data.type === 'machine' ? (data.authType || 'ssh_key') : 'password',
    sshKeyPath: data.type === 'machine' ? (data.sshKeyPath || '').trim() : '',
    sshKeyData: data.type === 'machine' ? (data.sshKeyData || '').trim() : '',
    password: data.password || '',
    becomeMethod: data.type === 'machine' ? (data.becomeMethod || 'sudo') : 'enable',
    becomePassword: data.becomePassword || '',
    enablePassword: data.enablePassword || '',
    createdAt: now,
    updatedAt: now
  };

  list.push(newCred);
  saveCredentialsRaw(list);

  return { ok: true, credential: sanitizeCredential(newCred) };
}

/**
 * Update an existing credential
 * Follows Rule: "Blank secret in update payload = keep existing secret"
 */
export function updateCredential(id, data) {
  const list = loadCredentialsRaw();
  const index = list.findIndex(c => c.id === id);
  if (index === -1) {
    return { ok: false, errors: [`Credential "${id}" not found`] };
  }

  const existing = list[index];
  const errors = [];

  if (data.name !== undefined && data.name.trim().length === 0) {
    errors.push('Name cannot be empty');
  }
  if (data.type && !['machine', 'network'].includes(data.type)) {
    errors.push('Type must be either "machine" or "network"');
  }
  if (data.username !== undefined && data.username.trim().length === 0) {
    errors.push('Username cannot be empty');
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // Preserve existing secrets if empty or not provided
  const password = (data.password !== undefined && data.password !== '') 
    ? data.password 
    : existing.password;

  const sshKeyData = (data.sshKeyData !== undefined && data.sshKeyData !== '') 
    ? data.sshKeyData 
    : existing.sshKeyData;

  const becomePassword = (data.becomePassword !== undefined && data.becomePassword !== '') 
    ? data.becomePassword 
    : existing.becomePassword;

  const enablePassword = (data.enablePassword !== undefined && data.enablePassword !== '') 
    ? data.enablePassword 
    : existing.enablePassword;

  const updatedCred = {
    ...existing,
    name: data.name !== undefined ? data.name.trim() : existing.name,
    type: data.type || existing.type,
    description: data.description !== undefined ? data.description.trim() : existing.description,
    username: data.username !== undefined ? data.username.trim() : existing.username,
    authType: data.authType || existing.authType,
    sshKeyPath: data.sshKeyPath !== undefined ? data.sshKeyPath.trim() : existing.sshKeyPath,
    sshKeyData,
    password,
    becomeMethod: data.becomeMethod || existing.becomeMethod,
    becomePassword,
    enablePassword,
    updatedAt: new Date().toISOString()
  };

  list[index] = updatedCred;
  saveCredentialsRaw(list);

  return { ok: true, credential: sanitizeCredential(updatedCred) };
}

/**
 * Delete a credential
 */
export function deleteCredential(id) {
  const list = loadCredentialsRaw();
  const index = list.findIndex(c => c.id === id);
  if (index === -1) {
    return { ok: false, error: `Credential "${id}" not found` };
  }

  list.splice(index, 1);
  saveCredentialsRaw(list);
  return { ok: true, id };
}
