import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load template definitions
function getTemplates() {
  const templatesPath = path.join(__dirname, 'templates', 'actionTemplates.json');
  const content = fs.readFileSync(templatesPath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Get raw playbook source for a template (unrendered Jinja2).
 * NOTE: We do NOT render/compile this file. The real Ansible engine on the
 * AWX execution node evaluates the Jinja2 expressions ({{ }}, {% if %}) at
 * job-run time using the extra_vars passed via the launch API. This function
 * exists only to show the BO what the underlying playbook looks like.
 * @param {string} templateId - Template ID (e.g. "RESTART_SERVICE")
 * @returns {string} Raw playbook file content (Jinja2, unrendered)
 */
export function getPlaybookSource(templateId) {
  const templates = getTemplates();
  const template = templates.templates.find(t => t.id === templateId);

  if (!template) {
    throw new Error(`Template not found: ${templateId}`);
  }

  const templatePath = path.join(__dirname, 'templates', 'yaml', template.yamlTemplate);

  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template file not found: ${template.yamlTemplate}`);
  }

  return fs.readFileSync(templatePath, 'utf-8');
}

/**
 * Get all available templates
 * @returns {Array} Array of template definitions
 */
export function getAvailableTemplates() {
  const templates = getTemplates();
  return templates.templates;
}

/**
 * Get a specific template by ID
 * @param {string} templateId - Template ID
 * @returns {object} Template definition
 */
export function getTemplate(templateId) {
  const templates = getTemplates();
  const template = templates.templates.find(t => t.id === templateId);

  if (!template) {
    throw new Error(`Template not found: ${templateId}`);
  }

  return template;
}

/**
 * Validate parameters against template schema.
 * Mutates `params` in place to fill in defaults for missing optional/required
 * fields, matching the previous behavior relied on by callers.
 * @param {string} templateId - Template ID
 * @param {object} params - Parameters to validate
 * @returns {object} { valid: boolean, errors: string[] }
 */
export function validateParameters(templateId, params) {
  const template = getTemplate(templateId);
  const errors = [];

  for (const param of template.parameters) {
    // Apply defaults for missing values (required or optional)
    if (params[param.name] === undefined && param.default !== undefined) {
      params[param.name] = param.default;
    }

    const value = params[param.name];

    // Check required
    if (param.required && (value === undefined || value === null || value === '')) {
      errors.push(`Parameter '${param.name}' is required`);
      continue;
    }

    // Skip validation if value is not provided and not required
    if (value === undefined || value === null || value === '') {
      continue;
    }

    // Type validation
    switch (param.type) {
      case 'number':
        if (typeof value !== 'number' && isNaN(Number(value))) {
          errors.push(`Parameter '${param.name}' must be a number`);
        }
        break;
      case 'boolean':
        if (typeof value !== 'boolean') {
          errors.push(`Parameter '${param.name}' must be a boolean`);
        }
        break;
      case 'string':
      case 'textarea':
        if (typeof value !== 'string') {
          errors.push(`Parameter '${param.name}' must be a string`);
        }
        break;
      case 'select':
        if (param.options) {
          const validValues = param.options.map(opt => opt.value);
          if (!validValues.includes(value)) {
            errors.push(`Parameter '${param.name}' must be one of: ${validValues.join(', ')}`);
          }
        }
        break;
    }

    // Regex validation
    if (param.validation && typeof value === 'string') {
      const regex = new RegExp(param.validation);
      if (!regex.test(value)) {
        errors.push(`Parameter '${param.name}' does not match required format`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Preview the playbook for a template: validates params, then returns the
 * RAW (unrendered) Jinja2 playbook source, plus a note clarifying that the
 * {{ }} values shown are placeholders evaluated by Ansible at real run time,
 * not a pre-filled build.
 * @param {string} templateId - Template ID
 * @param {object} params - Parameters (validated but not injected into YAML)
 * @returns {object} { yaml: string, valid: boolean, errors: string[], note?: string }
 */
export function previewYAML(templateId, params) {
  const validation = validateParameters(templateId, params);

  if (!validation.valid) {
    return {
      yaml: null,
      valid: false,
      errors: validation.errors
    };
  }

  try {
    const yaml = getPlaybookSource(templateId);
    return {
      yaml,
      valid: true,
      errors: [],
      note: 'Đây là playbook gốc (Jinja2, chưa render). Các giá trị {{ }} sẽ được Ansible điền tại thời điểm chạy thật trên AWX bằng extra_vars bạn đã nhập trên form — đây không phải bản build sẵn.'
    };
  } catch (error) {
    return {
      yaml: null,
      valid: false,
      errors: [error.message]
    };
  }
}
