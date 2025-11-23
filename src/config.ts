import { existsSync } from 'fs';
import { join } from 'path';

export interface CustomField {
  id: string;
  message: string;
  type: 'text' | 'multiline';
}

export interface CustomQuestions {
  accomplishments?: {
    message: string;
    enabled: boolean;
  };
  blockers?: {
    message: string;
    enabled: boolean;
  };
  todaysPlan?: {
    message: string;
    enabled: boolean;
  };
  additionalFields?: CustomField[];
}

export interface StandupConfig {
  gitScanPath: string;
  authorFilter?: string; // Git author name or email to filter commits by
  excludeRepos?: string[]; // Repository names to exclude from scanning
  skipMergeCommits?: boolean; // Skip merge commits in git log
  customQuestions?: CustomQuestions; // Customize standup questions
  enableAI?: boolean; // Enable AI-powered summaries (requires Ollama)
  standupDir: string;
  streakFile: string;
  remindersFile: string;
}

// Use home directory for default paths (works in both dev and compiled modes)
const HOME_DIR = process.env.HOME;
if (!HOME_DIR) {
  throw new Error('HOME environment variable is not set');
}

const STANDUP_BASE_DIR = join(HOME_DIR, '.standup-cli');

const CONFIG_FILE = join(STANDUP_BASE_DIR, 'config.json');
const DEFAULT_SCAN_PATH = join(HOME_DIR, 'dev');
const DEFAULT_STANDUP_DIR = join(STANDUP_BASE_DIR, 'standups');
const DEFAULT_STREAK_FILE = join(STANDUP_BASE_DIR, 'streak.json');
const DEFAULT_REMINDERS_FILE = join(STANDUP_BASE_DIR, 'reminders.json');

let cachedConfig: StandupConfig | null = null;

/**
 * Get git user name from global config
 */
async function getGitUserName(): Promise<string | null> {
  try {
    const proc = Bun.spawn(['git', 'config', 'user.name'], {
      stdout: 'pipe',
      stderr: 'ignore',
    });

    const output = await new Response(proc.stdout).text();
    await proc.exited;

    if (proc.exitCode === 0 && output.trim()) {
      return output.trim();
    }
  } catch {
    // Failed to get git user name
  }
  return null;
}

/**
 * Load configuration from file and merge with defaults
 */
export async function loadConfig(): Promise<StandupConfig> {
  // Return cached config if available
  if (cachedConfig) {
    return cachedConfig;
  }

  let fileConfig: Partial<StandupConfig> = {};
  let configFileCreated = false;

  // Try to load config from file
  if (existsSync(CONFIG_FILE)) {
    try {
      const configText = await Bun.file(CONFIG_FILE).text();
      fileConfig = JSON.parse(configText);
    } catch (error) {
      console.warn(`Warning: Failed to parse config.json, using defaults. Error: ${error}`);
    }
  } else {
    // Config file doesn't exist - we'll create it with defaults
    configFileCreated = true;
  }

  // Get git user name as default author filter
  const gitUserName = await getGitUserName();

  // Default custom questions
  const defaultCustomQuestions: CustomQuestions = {
    accomplishments: {
      message: 'What did you accomplish?',
      enabled: true,
    },
    blockers: {
      message: 'Any blockers or questions?',
      enabled: true,
    },
    todaysPlan: {
      message: "What are you working on today?",
      enabled: true,
    },
    additionalFields: [],
  };

  // Merge with defaults
  cachedConfig = {
    gitScanPath: fileConfig.gitScanPath ?? DEFAULT_SCAN_PATH,
    authorFilter: fileConfig.authorFilter ?? gitUserName ?? undefined,
    excludeRepos: fileConfig.excludeRepos ?? [],
    skipMergeCommits: fileConfig.skipMergeCommits ?? false,
    customQuestions: fileConfig.customQuestions ?? defaultCustomQuestions,
    enableAI: fileConfig.enableAI ?? false, // AI is opt-in
    standupDir: fileConfig.standupDir ?? DEFAULT_STANDUP_DIR,
    streakFile: fileConfig.streakFile ?? DEFAULT_STREAK_FILE,
    remindersFile: fileConfig.remindersFile ?? DEFAULT_REMINDERS_FILE,
  };

  // Create default config file if it didn't exist
  if (configFileCreated) {
    await createDefaultConfigFile(cachedConfig);
  }

  return cachedConfig;
}

/**
 * Create a default config file with helpful comments
 */
async function createDefaultConfigFile(config: StandupConfig): Promise<void> {
  try {
    // Ensure directory exists
    const { mkdirSync } = await import('fs');
    const { dirname } = await import('path');

    const configDir = dirname(CONFIG_FILE);
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }

    // Create config with comments (as a string to preserve formatting)
    const configContent = `{
  // Path to scan for git repositories
  "gitScanPath": "${config.gitScanPath}",

  // Git author to filter commits by (auto-detected: ${config.authorFilter || 'none'})
  "authorFilter": ${config.authorFilter ? `"${config.authorFilter}"` : 'null'},

  // Repository names to exclude from scanning
  "excludeRepos": [],

  // Skip merge commits in git log
  "skipMergeCommits": false,

  // Enable AI-powered summaries (requires Ollama installed)
  // To enable: 1) Install Ollama, 2) Run 'ollama pull qwen2.5:7b', 3) Set to true
  "enableAI": false
}`;

    // Write to temp file without comments, then inform user
    const configJson = {
      gitScanPath: config.gitScanPath,
      authorFilter: config.authorFilter,
      excludeRepos: [],
      skipMergeCommits: false,
      enableAI: false,
    };

    await Bun.write(CONFIG_FILE, JSON.stringify(configJson, null, 2));

    // Store that we created it so we can show a message
    (globalThis as any).__configFileCreated = true;
  } catch (error) {
    // Silently fail - config will work from memory
    if (process.env.DEBUG === 'true') {
      console.error('Failed to create default config:', error);
    }
  }
}

/**
 * Check if config file was just created and show helpful message
 */
export function wasConfigFileCreated(): boolean {
  return (globalThis as any).__configFileCreated === true;
}

/**
 * Get current config (throws if not loaded)
 */
export function getConfig(): StandupConfig {
  if (!cachedConfig) {
    throw new Error('Config not loaded. Call loadConfig() first.');
  }
  return cachedConfig;
}

/**
 * Reset cached config (useful for testing)
 */
export function resetConfigCache(): void {
  cachedConfig = null;
}
