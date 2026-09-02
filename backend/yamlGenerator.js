import Handlebars from 'handlebars';
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

// Register Handlebars helpers
Handlebars.registerHelper('eq', function(a, b, options) {
  return a === b ? options.fn(this) : options.inverse(this);
});

Handlebars.registerHelper('ne', function(a, b, options) {
  return a !== b ? options.fn(this) : options.inverse(this);
});

Handlebars.registerHelper('gt', function(a, b, options) {
  return a > b ? options.fn(this) : options.inverse(this);
});

Handlebars.registerHelper('lt', function(a, b, options) {
  return a < b ? options.fn(this) : options.inverse(this);
});

/**
 * Generate YAML from template
 * @param {string} templateId - Template ID (e.g. "RESTART_SERVICE")
 * @param {object} params - Parameters to fill into template
 * @returns {string} Generated YAML content
 */
export function generateYAML(templateId, params) {
  const templates = getTemplates();
  const template = templates.templates.find(t => t.id === templateId);
  
  if (!template) {
    throw new Error(`Template not found: ${templateId}`);
  }

  // Validate required parameters
  for (const param of template.parameters) {
    if (param.required && !params[param.name]) {
      // Check if there's a default value
      if (param.default === undefined) {
        throw new Error(`Missing required parameter: ${param.name}`);
      }
      // Use default value
      params[param.name] = param.default;
    }
  }

  // Apply defaults for missing optional parameters
  for (const param of template.parameters) {
    if (param.default !== undefined && params[param.name] === undefined) {
      params[param.name] = param.default;
    }
  }

  // Load YAML template file
  const templatePath = path.join(__dirname, 'templates', 'yaml', template.yamlTemplate);
  
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template file not found: ${template.yamlTemplate}`);
  }

  const templateContent = fs.readFileSync(templatePath, 'utf-8');
  
  // Compile and execute template
  try {
    const compiled = Handlebars.compile(templateContent, { noEscape: true });
    const yaml = compiled(params);
    return yaml;
  } catch (error) {
    throw new Error(`Failed to generate YAML: ${error.message}`);
  }
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
 * Validate parameters against template schema
 * @param {string} templateId - Template ID
 * @param {object} params - Parameters to validate
 * @returns {object} { valid: boolean, errors: string[] }
 */
export function validateParameters(templateId, params) {
  const template = getTemplate(templateId);
  const errors = [];

  for (const param of template.parameters) {
    const value = params[param.name];

    // Check required
    if (param.required && (value === undefined || value === null || value === '')) {
      if (param.default === undefined) {
        errors.push(`Parameter '${param.name}' is required`);
        continue;
      }
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
 * Preview YAML generation without creating action
 * @param {string} templateId - Template ID
 * @param {object} params - Parameters
 * @returns {object} { yaml: string, valid: boolean, errors: string[] }
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
    const yaml = generateYAML(templateId, params);
    return {
      yaml,
      valid: true,
      errors: []
    };
  } catch (error) {
    return {
      yaml: null,
      valid: false,
      errors: [error.message]
    };
  }
}
