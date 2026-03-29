/**
 * Notification Service — ntfy + voice only
 *
 * Simplified from multi-channel (Discord, Twilio, Desktop) to just ntfy push.
 * Voice notifications are handled by the voice server (localhost:8888).
 *
 * Design principles:
 * - Async, non-blocking (fire-and-forget)
 * - Fail gracefully (never block hook execution)
 * - Expandable later if needed
 */

import { readFile, fileExists, writeFile } from "@hooks/core/adapters/fs";
import { getEnv } from "@hooks/core/adapters/process";
import { tryCatch, type Result } from "@hooks/core/result";
import { jsonParseFailed, type PaiError } from "@hooks/core/error";
import { join } from 'path';
import { homedir } from 'os';
import { getIdentity } from "@hooks/lib/identity";

// ============================================================================
// Types
// ============================================================================

export type NotificationPriority = 'min' | 'low' | 'default' | 'high' | 'urgent';

export type NotificationEvent =
  | 'taskComplete'
  | 'longTask'
  | 'backgroundAgent'
  | 'error'
  | 'security';

export interface NotificationOptions {
  title?: string;
  priority?: NotificationPriority;
  tags?: string[];
  click?: string;
  actions?: Array<{
    action: 'view' | 'http';
    label: string;
    url: string;
  }>;
}

export interface NotificationConfig {
  ntfy: {
    enabled: boolean;
    topic: string;
    server: string;
  };
  thresholds: {
    longTaskMinutes: number;
  };
  routing: {
    [key in NotificationEvent]: ('ntfy')[];
  };
}

// ============================================================================
// Deps
// ============================================================================

export interface NotificationDeps {
  readFile: (path: string) => Result<string, PaiError>;
  fileExists: (path: string) => boolean;
  writeFile: (path: string, content: string) => Result<void, PaiError>;
  parseJson: <T>(raw: string) => Result<T, PaiError>;
  lookupEnv: (key: string) => string | undefined;
  paiDir: string;
  stderr: (msg: string) => void;
}

function resolvePaiDir(): string {
  const envResult = getEnv('PAI_DIR');
  return envResult.ok ? envResult.value : join(homedir(), '.claude');
}

function envLookup(key: string): string | undefined {
  const result = getEnv(key);
  return result.ok ? result.value : undefined;
}

export const defaultNotificationDeps: NotificationDeps = {
  readFile,
  fileExists,
  writeFile,
  parseJson: <T>(raw: string): Result<T, PaiError> =>
    tryCatch(() => JSON.parse(raw) as T, (e) => jsonParseFailed(raw.slice(0, 80), e)),
  lookupEnv: envLookup,
  paiDir: resolvePaiDir(),
  stderr: (msg: string) => process.stderr.write(msg + '\n'),
};

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_CONFIG: NotificationConfig = {
  ntfy: {
    enabled: false,
    topic: '',
    server: 'ntfy.sh'
  },
  thresholds: {
    longTaskMinutes: 5
  },
  routing: {
    taskComplete: [],
    longTask: ['ntfy'],
    backgroundAgent: ['ntfy'],
    error: ['ntfy'],
    security: ['ntfy']
  }
};

function expandEnvVars(content: string, lookupEnv: (key: string) => string | undefined): string {
  return content.replace(/\$\{(\w+)\}/g, (_, key: string) => lookupEnv(key) || '');
}

interface SettingsWithNotifications {
  notifications?: {
    ntfy?: Partial<NotificationConfig['ntfy']>;
    thresholds?: Partial<NotificationConfig['thresholds']>;
    routing?: Partial<NotificationConfig['routing']>;
  };
}

export function getNotificationConfig(deps: NotificationDeps = defaultNotificationDeps): NotificationConfig {
  const settingsPath = join(deps.paiDir, 'settings.json');

  if (!deps.fileExists(settingsPath)) return DEFAULT_CONFIG;

  const result = deps.readFile(settingsPath);
  if (!result.ok) {
    deps.stderr(`Failed to load notification config: ${result.error.message}`);
    return DEFAULT_CONFIG;
  }

  const expandedContent = expandEnvVars(result.value, deps.lookupEnv);
  const parseResult = deps.parseJson<SettingsWithNotifications>(expandedContent);
  if (!parseResult.ok) {
    deps.stderr('Failed to parse notification config');
    return DEFAULT_CONFIG;
  }

  const settings = parseResult.value;
  if (!settings.notifications) return DEFAULT_CONFIG;

  return {
    ...DEFAULT_CONFIG,
    ntfy: { ...DEFAULT_CONFIG.ntfy, ...settings.notifications.ntfy },
    thresholds: { ...DEFAULT_CONFIG.thresholds, ...settings.notifications.thresholds },
    routing: { ...DEFAULT_CONFIG.routing, ...settings.notifications.routing }
  };
}

// ============================================================================
// Session Timing
// ============================================================================

const SESSION_START_FILE = '/tmp/pai-session-start.txt';

export function recordSessionStart(deps: NotificationDeps = defaultNotificationDeps): void {
  deps.writeFile(SESSION_START_FILE, Date.now().toString());
}

export function getSessionDurationMinutes(deps: NotificationDeps = defaultNotificationDeps): number {
  if (!deps.fileExists(SESSION_START_FILE)) return 0;
  const result = deps.readFile(SESSION_START_FILE);
  if (!result.ok) return 0;
  const startTime = parseInt(result.value, 10);
  if (isNaN(startTime)) return 0;
  return (Date.now() - startTime) / 1000 / 60;
}

export function isLongRunningTask(deps: NotificationDeps = defaultNotificationDeps): boolean {
  const config = getNotificationConfig(deps);
  return getSessionDurationMinutes(deps) >= config.thresholds.longTaskMinutes;
}

// ============================================================================
// ntfy Push
// ============================================================================

export async function sendPush(
  message: string,
  options: NotificationOptions = {},
  deps: NotificationDeps = defaultNotificationDeps,
): Promise<boolean> {
  const config = getNotificationConfig(deps);

  if (!config.ntfy.enabled || !config.ntfy.topic) {
    return false;
  }

  const url = `https://${config.ntfy.server}/${config.ntfy.topic}`;

  const headers: Record<string, string> = {
    'Content-Type': 'text/plain',
  };

  if (options.title) headers['Title'] = options.title;

  if (options.priority) {
    const priorityMap: Record<NotificationPriority, string> = {
      'min': '1', 'low': '2', 'default': '3', 'high': '4', 'urgent': '5'
    };
    headers['Priority'] = priorityMap[options.priority] || '3';
  }

  if (options.tags?.length) headers['Tags'] = options.tags.join(',');
  if (options.click) headers['Click'] = options.click;

  if (options.actions?.length) {
    headers['Actions'] = options.actions
      .map(a => `${a.action}, ${a.label}, ${a.url}`)
      .join('; ');
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: message,
    signal: AbortSignal.timeout(5000),
  }).catch(() => null);

  if (!response) {
    deps.stderr('ntfy send failed: fetch error');
    return false;
  }

  return response.ok;
}

// ============================================================================
// Smart Router
// ============================================================================

export async function notify(
  event: NotificationEvent,
  message: string,
  options: NotificationOptions = {},
  deps: NotificationDeps = defaultNotificationDeps,
): Promise<void> {
  const config = getNotificationConfig(deps);
  const channels = config.routing[event] || [];

  for (const channel of channels) {
    if (channel === 'ntfy') {
      sendPush(message, {
        title: options.title || getDefaultTitle(event),
        priority: options.priority || getDefaultPriority(event),
        tags: options.tags || getDefaultTags(event),
        ...options
      }, deps).catch(() => {});
    }
  }
}

export async function notifyTaskComplete(message: string, options: NotificationOptions = {}, deps: NotificationDeps = defaultNotificationDeps): Promise<void> {
  const event: NotificationEvent = isLongRunningTask(deps) ? 'longTask' : 'taskComplete';
  await notify(event, message, options, deps);
}

export async function notifyBackgroundAgent(
  agentType: string,
  message: string,
  options: NotificationOptions = {},
  deps: NotificationDeps = defaultNotificationDeps,
): Promise<void> {
  await notify('backgroundAgent', message, {
    title: `${agentType} Agent Complete`,
    tags: ['robot', 'white_check_mark'],
    ...options
  }, deps);
}

export async function notifyError(message: string, options: NotificationOptions = {}, deps: NotificationDeps = defaultNotificationDeps): Promise<void> {
  await notify('error', message, {
    priority: 'high',
    tags: ['warning', 'x'],
    ...options
  }, deps);
}

// ============================================================================
// Helpers
// ============================================================================

function getDefaultTitle(event: NotificationEvent): string {
  const DA_NAME = getIdentity().name;
  const titles: Record<NotificationEvent, string> = {
    taskComplete: DA_NAME,
    longTask: `${DA_NAME} - Task Complete`,
    backgroundAgent: `${DA_NAME} - Agent Complete`,
    error: `${DA_NAME} - Error`,
    security: `${DA_NAME} - Security Alert`
  };
  return titles[event];
}

function getDefaultPriority(event: NotificationEvent): NotificationPriority {
  const priorities: Record<NotificationEvent, NotificationPriority> = {
    taskComplete: 'default',
    longTask: 'default',
    backgroundAgent: 'default',
    error: 'high',
    security: 'urgent'
  };
  return priorities[event];
}

function getDefaultTags(event: NotificationEvent): string[] {
  const tags: Record<NotificationEvent, string[]> = {
    taskComplete: ['white_check_mark'],
    longTask: ['hourglass', 'white_check_mark'],
    backgroundAgent: ['robot', 'white_check_mark'],
    error: ['warning', 'x'],
    security: ['rotating_light', 'lock']
  };
  return tags[event];
}
