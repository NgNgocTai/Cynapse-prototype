import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INVENTORY_FILE = path.join(__dirname, 'inventory.json');
const EXAMPLE_FILE = path.join(__dirname, 'inventory.example.json');

// Allowed external domain suffixes for ad-hoc targets in lab/testing
const ALLOWED_DOMAIN_SUFFIXES = [
  '.local',
  '.internal',
  '.lan',
  'duckdns.org'
];

/**
 * Load inventory data from disk.
 * Falls back to inventory.example.json if inventory.json does not exist.
 */
export function getInventory() {
  let fileToRead = INVENTORY_FILE;
  if (!fs.existsSync(fileToRead)) {
    if (fs.existsSync(EXAMPLE_FILE)) {
      fileToRead = EXAMPLE_FILE;
    } else {
      return { hosts: [], groups: [] };
    }
  }

  try {
    const raw = fs.readFileSync(fileToRead, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      hosts: Array.isArray(parsed.hosts) ? parsed.hosts : [],
      groups: Array.isArray(parsed.groups) ? parsed.groups : []
    };
  } catch (err) {
    console.error('Failed to parse inventory file:', err);
    return { hosts: [], groups: [] };
  }
}

/**
 * Persist inventory data to inventory.json
 */
export function saveInventory(data) {
  const payload = {
    hosts: Array.isArray(data.hosts) ? data.hosts : [],
    groups: Array.isArray(data.groups) ? data.groups : []
  };
  fs.writeFileSync(INVENTORY_FILE, JSON.stringify(payload, null, 2), 'utf-8');
}

/**
 * Get all hosts
 */
export function getHosts() {
  return getInventory().hosts;
}

/**
 * Find host by name or ansible_host
 */
export function getHost(identifier) {
  const { hosts } = getInventory();
  return hosts.find(h => h.name === identifier || h.ansible_host === identifier);
}

/**
 * Create or update a host definition
 */
export function saveHost(hostData) {
  const inventory = getInventory();
  const existingIdx = inventory.hosts.findIndex(h => h.name === hostData.name);
  
  const record = {
    name: hostData.name.trim(),
    ansible_host: hostData.ansible_host.trim(),
    ansible_port: parseInt(hostData.ansible_port, 10) || 22,
    os: hostData.os || 'Linux',
    domain: hostData.domain || 'CNTT',
    environment: hostData.environment || 'production',
    groups: Array.isArray(hostData.groups) ? hostData.groups : ['all'],
    defaultCredentialId: hostData.defaultCredentialId || null,
    description: hostData.description || '',
    updatedAt: new Date().toISOString()
  };

  if (existingIdx >= 0) {
    inventory.hosts[existingIdx] = { ...inventory.hosts[existingIdx], ...record };
  } else {
    record.createdAt = new Date().toISOString();
    inventory.hosts.push(record);
  }

  saveInventory(inventory);
  return record;
}

/**
 * Delete a host from inventory
 */
export function deleteHost(name) {
  const inventory = getInventory();
  const initialCount = inventory.hosts.length;
  inventory.hosts = inventory.hosts.filter(h => h.name !== name);
  if (inventory.hosts.length !== initialCount) {
    // Also remove from groups
    inventory.groups.forEach(g => {
      if (Array.isArray(g.members)) {
        g.members = g.members.filter(m => m !== name);
      }
    });
    saveInventory(inventory);
    return true;
  }
  return false;
}

/**
 * Get all groups
 */
export function getGroups() {
  return getInventory().groups;
}

/**
 * Create or update a group
 */
export function saveGroup(groupData) {
  const inventory = getInventory();
  const existingIdx = inventory.groups.findIndex(g => g.name === groupData.name);
  
  const record = {
    name: groupData.name.trim(),
    description: groupData.description || '',
    domain: groupData.domain || 'CNTT',
    members: Array.isArray(groupData.members) ? groupData.members : []
  };

  if (existingIdx >= 0) {
    inventory.groups[existingIdx] = { ...inventory.groups[existingIdx], ...record };
  } else {
    inventory.groups.push(record);
  }

  saveInventory(inventory);
  return record;
}

// ==============================================================================
// SECURITY GUARDRAILS: Network Boundary & Injection Prevention
// ==============================================================================

/**
 * Check if an IP is in an IPv4 CIDR range
 */
function ipInCidr(ip, cidr) {
  if (!ip || typeof ip !== 'string' || !/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
    return false;
  }
  const [range, bits = 32] = cidr.split('/');
  const mask = ~(2 ** (32 - parseInt(bits, 10)) - 1);
  const ipToLong = (addr) => addr.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
  
  try {
    return (ipToLong(ip) & mask) === (ipToLong(range) & mask);
  } catch (e) {
    return false;
  }
}

/**
 * Validate target string against Hard Network Boundaries and Injection attacks.
 * 
 * Rules:
 * 1. Syntax check: Only valid hostname/IP characters and port (1-65535).
 * 2. Hard Deny:
 *    - Loopback: 127.0.0.0/8, localhost, ::1
 *    - Cloud metadata / Link-Local: 169.254.0.0/16
 *    - Unspecified / Broadcast: 0.0.0.0/8, 255.255.255.255
 *    - Multicast: 224.0.0.0/4
 * 3. Allowlist for Ad-hoc:
 *    - RFC1918 private subnets: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
 *    - OR Allowed domain suffixes (e.g. .local, .internal, duckdns.org)
 * 4. Registered Inventory hosts/groups ALWAYS pass network boundary check.
 * 
 * @param {string} targetStr 
 * @returns {{ valid: boolean, host: string, port: number|null, targetType: 'group'|'host'|'adhoc', reason?: string }}
 */
export function validateTargetSecurity(targetStr) {
  if (!targetStr || typeof targetStr !== 'string') {
    return { valid: false, reason: 'Target cannot be empty' };
  }

  const trimmed = targetStr.trim();

  // 1. Check if it is a registered group or host first
  const { hosts, groups } = getInventory();
  const matchedGroup = groups.find(g => g.name.toLowerCase() === trimmed.toLowerCase());
  if (matchedGroup) {
    return { valid: true, host: matchedGroup.name, port: null, targetType: 'group', group: matchedGroup };
  }

  const matchedHost = hosts.find(h => h.name.toLowerCase() === trimmed.toLowerCase());
  if (matchedHost) {
    return { 
      valid: true, 
      host: matchedHost.ansible_host, 
      port: matchedHost.ansible_port || 22, 
      targetType: 'host', 
      hostRecord: matchedHost 
    };
  }

  // 2. Syntax & Port parsing (Anti-Command Injection)
  // Format: hostname/IP optional :port
  const portMatch = trimmed.match(/^(.+):(\d{1,5})$/);
  const hostPart = portMatch ? portMatch[1] : trimmed;
  const portPart = portMatch ? parseInt(portMatch[2], 10) : null;

  if (portPart !== null && (portPart < 1 || portPart > 65535)) {
    return { valid: false, reason: `Port ${portPart} is out of valid range (1 - 65535)` };
  }

  const HOST_REGEX = /^([a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?)$/;
  if (!HOST_REGEX.test(hostPart)) {
    return { valid: false, reason: 'Target contains invalid characters or format' };
  }

  // 3. HARD DENY GUARDRAILS (Never bypassable)
  const lowerHost = hostPart.toLowerCase();

  // Deny Loopback
  if (lowerHost === 'localhost' || lowerHost === '::1' || ipInCidr(lowerHost, '127.0.0.0/8')) {
    return { valid: false, reason: 'Security Violation: Loopback addresses (127.0.0.0/8, localhost) are strictly prohibited' };
  }

  // Deny Cloud Metadata & Link-Local (169.254.169.254)
  if (ipInCidr(lowerHost, '169.254.0.0/16')) {
    return { valid: false, reason: 'Security Violation: Cloud Metadata & Link-Local IP (169.254.0.0/16) is strictly prohibited' };
  }

  // Deny Unspecified / Broadcast / Multicast
  if (lowerHost === '255.255.255.255' || ipInCidr(lowerHost, '0.0.0.0/8') || ipInCidr(lowerHost, '224.0.0.0/4')) {
    return { valid: false, reason: 'Security Violation: Broadcast, multicast, or unspecified IP is strictly prohibited' };
  }

  // 4. ALLOWLIST CHECK for Ad-hoc targets
  const isIPv4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(hostPart);
  if (isIPv4) {
    const isPrivate = 
      ipInCidr(hostPart, '10.0.0.0/8') ||
      ipInCidr(hostPart, '172.16.0.0/12') ||
      ipInCidr(hostPart, '192.168.0.0/16');

    if (!isPrivate) {
      return { 
        valid: false, 
        reason: `Public IP (${hostPart}) is not allowed as an ad-hoc target. Only RFC1918 private subnets (10.x, 172.16-31.x, 192.168.x) or registered inventory hosts are permitted.` 
      };
    }
  } else {
    // FQDN check
    const isAllowedDomain = ALLOWED_DOMAIN_SUFFIXES.some(suffix => 
      lowerHost === suffix || lowerHost.endsWith(suffix)
    );
    if (!isAllowedDomain) {
      return { 
        valid: false, 
        reason: `Hostname '${hostPart}' does not match allowed domain suffixes (${ALLOWED_DOMAIN_SUFFIXES.join(', ')}) or registered inventory.` 
      };
    }
  }

  return { 
    valid: true, 
    host: hostPart, 
    port: portPart, 
    targetType: 'adhoc' 
  };
}

/**
 * Resolve target into comprehensive execution metadata
 */
export function resolveTarget(targetStr) {
  const security = validateTargetSecurity(targetStr);
  if (!security.valid) {
    throw new Error(security.reason);
  }

  if (security.targetType === 'group') {
    const group = security.group;
    const { hosts } = getInventory();
    const resolvedMembers = hosts.filter(h => group.members.includes(h.name));
    return {
      type: 'group',
      name: group.name,
      members: resolvedMembers,
      isRegistered: true,
      environment: resolvedMembers.some(m => m.environment === 'production') ? 'production' : 'staging',
      domain: group.domain || 'CNTT'
    };
  }

  if (security.targetType === 'host') {
    const host = security.hostRecord;
    return {
      type: 'host',
      name: host.name,
      ansible_host: host.ansible_host,
      ansible_port: host.ansible_port || 22,
      environment: host.environment || 'production',
      domain: host.domain || 'CNTT',
      defaultCredentialId: host.defaultCredentialId || null,
      isRegistered: true
    };
  }

  // Ad-hoc
  return {
    type: 'adhoc',
    name: targetStr,
    ansible_host: security.host,
    ansible_port: security.port || 22,
    environment: 'unverified',
    domain: 'AD-HOC',
    defaultCredentialId: null,
    isRegistered: false
  };
}
