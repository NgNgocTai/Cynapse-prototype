#!/usr/bin/env node

/**
 * Verify Setup Script
 * Kiểm tra AWX connection và config trước khi start server
 */

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log('🔍 Synapse Setup Verification\n');
console.log('=' .repeat(50));

// Check 1: .env file
console.log('\n1️⃣  Checking .env file...');
if (!fs.existsSync('.env')) {
    console.log('   ❌ .env file not found!');
    console.log('   → Run: cp .env.example .env');
    console.log('   → Then edit .env with your AWX token');
    process.exit(1);
}
console.log('   ✅ .env file exists');

// Load env
dotenv.config();

// Check 2: Required env vars
console.log('\n2️⃣  Checking environment variables...');
const required = ['AWX_URL', 'AWX_TOKEN', 'PORT'];
let envOk = true;

for (const key of required) {
    if (!process.env[key]) {
        console.log(`   ❌ ${key} not set in .env`);
        envOk = false;
    } else if (key === 'AWX_TOKEN' && process.env[key].includes('paste_your')) {
        console.log(`   ⚠️  ${key} still has placeholder value`);
        console.log('   → Replace with actual token from AWX UI');
        envOk = false;
    } else {
        const display = key === 'AWX_TOKEN' 
            ? process.env[key].substring(0, 10) + '...' 
            : process.env[key];
        console.log(`   ✅ ${key} = ${display}`);
    }
}

if (!envOk) {
    console.log('\n❌ Environment configuration incomplete');
    process.exit(1);
}

// Check 3: catalog.json
console.log('\n3️⃣  Checking catalog.json...');
const catalogPath = path.join(__dirname, 'catalog.json');
if (!fs.existsSync(catalogPath)) {
    console.log('   ❌ catalog.json not found!');
    process.exit(1);
}

const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));
const action = catalog.actions.find(a => a.id === 'DB_RESTART_CYCLE');

if (!action) {
    console.log('   ❌ DB_RESTART_CYCLE action not found in catalog');
    process.exit(1);
}

const templateId = action.implementation.awxJobTemplateId;
if (templateId === 0) {
    console.log('   ⚠️  awxJobTemplateId is still 0 (placeholder)');
    console.log('   → Update catalog.json with actual Job Template ID from AWX');
    console.log('   → Find it in AWX UI: Job Templates → click template → see ID in URL');
    process.exit(1);
}

console.log(`   ✅ catalog.json OK (Job Template ID: ${templateId})`);

// Check 4: AWX connectivity
console.log('\n4️⃣  Testing AWX connectivity...');
try {
    const res = await fetch(`${process.env.AWX_URL}/api/v2/me/`, {
        headers: { 'Authorization': `Bearer ${process.env.AWX_TOKEN}` }
    });
    
    if (!res.ok) {
        console.log(`   ❌ AWX returned HTTP ${res.status}`);
        if (res.status === 401) {
            console.log('   → Token is invalid or expired');
            console.log('   → Generate new token in AWX UI: Users → admin → Tokens');
        }
        process.exit(1);
    }
    
    const data = await res.json();
    console.log(`   ✅ Connected to AWX as: ${data.username || data.email || 'user'}`);
    
} catch (error) {
    console.log(`   ❌ Cannot reach AWX: ${error.message}`);
    console.log(`   → Check AWX_URL: ${process.env.AWX_URL}`);
    console.log('   → Is AWX running? Try: kubectl get pods -n awx');
    console.log('   → Is port-forward active? Try: minikube service awx-service -n awx');
    process.exit(1);
}

// Check 5: Job Template exists
console.log('\n5️⃣  Verifying Job Template...');
try {
    const res = await fetch(`${process.env.AWX_URL}/api/v2/job_templates/${templateId}/`, {
        headers: { 'Authorization': `Bearer ${process.env.AWX_TOKEN}` }
    });
    
    if (!res.ok) {
        console.log(`   ❌ Job Template ${templateId} not found (HTTP ${res.status})`);
        console.log('   → List all templates: GET /api/v2/job_templates/');
        console.log('   → Update catalog.json with correct ID');
        process.exit(1);
    }
    
    const template = await res.json();
    console.log(`   ✅ Job Template found: "${template.name}"`);
    console.log(`      Playbook: ${template.playbook}`);
    console.log(`      Inventory: ${template.summary_fields?.inventory?.name || 'N/A'}`);
    
    if (!template.playbook.includes('restart_cycle')) {
        console.log(`   ⚠️  Playbook name doesn't match expected 'restart_cycle.yml'`);
        console.log('   → Make sure you selected the correct Job Template ID');
    }
    
} catch (error) {
    console.log(`   ❌ Error fetching Job Template: ${error.message}`);
    process.exit(1);
}

// Success
console.log('\n' + '='.repeat(50));
console.log('✅ All checks passed!\n');
console.log('You can now start the server:');
console.log('  npm start\n');
console.log('Then start frontend:');
console.log('  cd ../frontend && python -m http.server 5500\n');
console.log('Note: Frontend runs on port 5500 (port 8080 is used by AWX)\n');
