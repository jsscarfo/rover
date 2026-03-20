/**
 * @endorhq/rover-constellation — Configuration Schema & Defaults
 *
 * Exports:
 *  DEFAULT_AGENTS       — All agent role definitions with defaults
 *  DEFAULT_PROJECT_CONFIG — Template project configuration
 *  validateConfig(config) — Validates a project config object
 *  getAgentDefaults(roleId) — Returns the default config for a role
 */

// ── Agent role definitions ─────────────────────────────────────────────────

/**
 * Complete set of agent roles with full default configurations.
 *
 * @type {Record<string, AgentConfig>}
 */
export const DEFAULT_AGENTS = {
  director: {
    roleId: 'director',
    label: 'Director',
    model: 'claude-opus-4-6-20250620',
    maxTokens: 8192,
    thinkingEnabled: true,
    thinkingBudget: 4096,
    priority: 'standard',
    costLimitDaily: 20.0,
    costLimitMonthly: 400.0,
    autoApprove: 'none',
    contextBudget: 20000,
    repos: ['*'],
    charterSource: 'charters/director.md',
    enabled: true,
  },

  'coder-backend': {
    roleId: 'coder-backend',
    label: 'Coder (Backend)',
    model: 'claude-sonnet-4-6-20250620',
    maxTokens: 8192,
    thinkingEnabled: true,
    thinkingBudget: 4096,
    priority: 'batch',
    costLimitDaily: 10.0,
    costLimitMonthly: 200.0,
    autoApprove: 'p2_and_below',
    contextBudget: 15000,
    repos: ['*'],
    charterSource: 'charters/coding.md',
    enabled: true,
  },

  'coder-frontend': {
    roleId: 'coder-frontend',
    label: 'Coder (Frontend)',
    model: 'claude-sonnet-4-6-20250620',
    maxTokens: 8192,
    thinkingEnabled: true,
    thinkingBudget: 4096,
    priority: 'batch',
    costLimitDaily: 10.0,
    costLimitMonthly: 200.0,
    autoApprove: 'p2_and_below',
    contextBudget: 15000,
    repos: ['*'],
    charterSource: 'charters/frontend.md',
    enabled: true,
  },

  'coder-integration': {
    roleId: 'coder-integration',
    label: 'Coder (Integration)',
    model: 'claude-sonnet-4-6-20250620',
    maxTokens: 8192,
    thinkingEnabled: true,
    thinkingBudget: 4096,
    priority: 'batch',
    costLimitDaily: 10.0,
    costLimitMonthly: 200.0,
    autoApprove: 'p2_and_below',
    contextBudget: 15000,
    repos: ['*'],
    charterSource: 'charters/coding.md',
    enabled: true,
  },

  'docs-prod': {
    roleId: 'docs-prod',
    label: 'Docs & Production',
    model: 'claude-haiku-4-6-20250620',
    maxTokens: 4096,
    thinkingEnabled: false,
    thinkingBudget: 0,
    priority: 'batch',
    costLimitDaily: 5.0,
    costLimitMonthly: 100.0,
    autoApprove: 'p3_only',
    contextBudget: 10000,
    repos: ['*'],
    charterSource: 'charters/documentation.md',
    enabled: true,
  },

  security: {
    roleId: 'security',
    label: 'Security & Debug',
    model: 'claude-sonnet-4-6-20250620',
    maxTokens: 8192,
    thinkingEnabled: true,
    thinkingBudget: 4096,
    priority: 'urgent',
    costLimitDaily: 10.0,
    costLimitMonthly: 200.0,
    autoApprove: 'none',
    contextBudget: 15000,
    repos: ['*'],
    charterSource: 'charters/supervisor.md',
    enabled: true,
  },

  aiml: {
    roleId: 'aiml',
    label: 'AI/ML Specialist',
    model: 'claude-opus-4-6-20250620',
    maxTokens: 8192,
    thinkingEnabled: true,
    thinkingBudget: 4096,
    priority: 'standard',
    costLimitDaily: 20.0,
    costLimitMonthly: 400.0,
    autoApprove: 'p2_and_below',
    contextBudget: 20000,
    repos: ['*'],
    charterSource: 'charters/llm_integration.md',
    enabled: true,
  },

  whatsapp: {
    roleId: 'whatsapp',
    label: 'WhatsApp Specialist',
    model: 'claude-sonnet-4-6-20250620',
    maxTokens: 8192,
    thinkingEnabled: true,
    thinkingBudget: 4096,
    priority: 'batch',
    costLimitDaily: 10.0,
    costLimitMonthly: 200.0,
    autoApprove: 'p2_and_below',
    contextBudget: 15000,
    repos: ['*'],
    charterSource: 'charters/whatsapp_specialist.md',
    enabled: true,
  },

  'context-engineer': {
    roleId: 'context-engineer',
    label: 'Context Engineer',
    model: 'claude-haiku-4-6-20250620',
    maxTokens: 4096,
    thinkingEnabled: false,
    thinkingBudget: 0,
    priority: 'batch',
    costLimitDaily: 5.0,
    costLimitMonthly: 100.0,
    autoApprove: 'p3_only',
    contextBudget: 10000,
    repos: ['*'],
    charterSource: null, // built-in
    enabled: true,
  },
};

// ── Per-agent config schema (reference shape) ──────────────────────────────

/**
 * @typedef {Object} AgentConfig
 * @property {string} roleId
 * @property {string} label
 * @property {string} model
 * @property {number} maxTokens
 * @property {boolean} thinkingEnabled
 * @property {number} thinkingBudget
 * @property {'batch'|'standard'|'urgent'} priority
 * @property {number} costLimitDaily
 * @property {number} costLimitMonthly
 * @property {'none'|'p3_only'|'p2_and_below'|'all'} autoApprove
 * @property {number} contextBudget
 * @property {string[]} repos
 * @property {string|null} charterSource
 * @property {boolean} enabled
 */

// ── Project config default ─────────────────────────────────────────────────

/**
 * Template for a Rover Constellation project configuration.
 * Projects are defined in `.rover/constellation/project.json` within the target repo.
 *
 * @type {ProjectConfig}
 */
export const DEFAULT_PROJECT_CONFIG = {
  projectId: '',
  name: '',
  repos: [],
  team: {
    // roleId → partial AgentConfig overrides (merged with DEFAULT_AGENTS defaults)
    // Example:
    // 'coder-backend': { model: 'claude-opus-4-6-20250620', costLimitDaily: 20 }
  },
  mcp: {
    // MCP server name → { enabled: boolean, ...options }
    // Example: 'laureline-code': { enabled: true }
  },
  autoApproveRules: {
    // Rules for automatic task approval by priority level
    // 'p3': true,   // auto-approve p3 tasks
    // 'p2': false,  // require human approval for p2+
  },
  defaults: {
    model: 'claude-sonnet-4-6-20250620',
    maxTokens: 8192,
    priority: 'batch',
    thinkingEnabled: true,
    thinkingBudget: 4096,
  },
};

/**
 * @typedef {Object} ProjectConfig
 * @property {string} projectId
 * @property {string} name
 * @property {string[]} repos
 * @property {Record<string, Partial<AgentConfig>>} team
 * @property {Record<string, { enabled: boolean }>} mcp
 * @property {Record<string, boolean>} autoApproveRules
 * @property {{ model: string, maxTokens: number, priority: string, thinkingEnabled: boolean, thinkingBudget: number }} defaults
 */

// ── Validators ─────────────────────────────────────────────────────────────

/**
 * Validate a project configuration object.
 * Throws on invalid configs; returns the validated config on success.
 *
 * @param {Partial<ProjectConfig>} config
 * @returns {ProjectConfig}
 */
export function validateConfig(config) {
  if (!config || typeof config !== 'object') {
    throw new Error('Config must be a non-null object');
  }

  const requiredFields = ['projectId', 'name', 'repos'];
  for (const field of requiredFields) {
    if (!config[field]) {
      throw new Error(`Config is missing required field: '${field}'`);
    }
  }

  if (!Array.isArray(config.repos) || config.repos.length === 0) {
    throw new Error("Config 'repos' must be a non-empty array of repository URLs");
  }

  if (typeof config.projectId !== 'string' || config.projectId.trim() === '') {
    throw new Error("Config 'projectId' must be a non-empty string");
  }

  if (typeof config.name !== 'string' || config.name.trim() === '') {
    throw new Error("Config 'name' must be a non-empty string");
  }

  // Validate team overrides reference known roles
  if (config.team) {
    for (const roleId of Object.keys(config.team)) {
      if (!DEFAULT_AGENTS[roleId]) {
        throw new Error(
          `Unknown role '${roleId}' in team config. Valid roles: ${Object.keys(DEFAULT_AGENTS).join(', ')}`,
        );
      }
    }
  }

  // Return a fully merged config
  return {
    ...DEFAULT_PROJECT_CONFIG,
    ...config,
    team: config.team || {},
    mcp: config.mcp || {},
    autoApproveRules: config.autoApproveRules || {},
    defaults: {
      ...DEFAULT_PROJECT_CONFIG.defaults,
      ...(config.defaults || {}),
    },
  };
}

/**
 * Get the complete default agent configuration for a role,
 * optionally merged with project-level overrides.
 *
 * @param {string} roleId
 * @param {Partial<AgentConfig>} [overrides]
 * @returns {AgentConfig}
 */
export function getAgentDefaults(roleId, overrides = {}) {
  const base = DEFAULT_AGENTS[roleId];
  if (!base) {
    throw new Error(
      `Unknown agent role: '${roleId}'. Valid roles: ${Object.keys(DEFAULT_AGENTS).join(', ')}`,
    );
  }
  return { ...base, ...overrides };
}
