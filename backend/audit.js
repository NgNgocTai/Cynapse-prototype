import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUDIT_FILE = path.join(__dirname, 'audit.log');

// Khởi tạo file nếu chưa có
if (!fs.existsSync(AUDIT_FILE)) {
  fs.writeFileSync(AUDIT_FILE, '');
}

export function writeAudit(object, id, actor, action, result, detail = '') {
  const entry = {
    timestamp: new Date().toISOString(),
    object,
    id,
    actor,
    action,
    result,
    detail
  };
  
  const line = JSON.stringify(entry) + '\n';
  fs.appendFileSync(AUDIT_FILE, line);
  
  console.log(`[AUDIT] ${object} ${id} - ${action} - ${result}`);
}

export function readAudit(filters = {}) {
  const content = fs.readFileSync(AUDIT_FILE, 'utf-8');
  const lines = content.trim().split('\n').filter(l => l);
  
  let entries = lines.map(line => JSON.parse(line));
  
  // Apply filters
  if (filters.changeId) {
    entries = entries.filter(e => e.id === filters.changeId || e.detail.includes(filters.changeId));
  }
  
  if (filters.object) {
    entries = entries.filter(e => e.object === filters.object);
  }
  
  return entries;
}
