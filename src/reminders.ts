#!/usr/bin/env bun

import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { format, parseISO } from 'date-fns';
import { findGitRepositories, aggregateCommits } from './gitUtils';
import type { ReminderState, StreakData } from './types';
import { loadConfig } from './config';

// Load config at startup
const config = await loadConfig();

const STANDUP_DIR = config.standupDir;
const STREAK_FILE = config.streakFile;
const REMINDER_STATE_FILE = config.remindersFile;

// Try to find standup binary in common locations
function findStandupBinary(): string {
  const possiblePaths = [
    '/usr/local/bin/standup',
    join(process.env.HOME || '', 'dev/scripts/standup/standup'),
    './standup',
  ];

  for (const path of possiblePaths) {
    if (existsSync(path)) {
      return path;
    }
  }

  // Default to system PATH
  return 'standup';
}

const STANDUP_BINARY = findStandupBinary();

async function getReminderState(): Promise<ReminderState> {
  if (!existsSync(REMINDER_STATE_FILE)) {
    return {
      lastCheck: new Date().toISOString(),
      dismissedToday: false,
      lastNotification: '',
    };
  }

  const text = await Bun.file(REMINDER_STATE_FILE).text();
  return JSON.parse(text);
}

async function saveReminderState(state: ReminderState): Promise<void> {
  await Bun.write(REMINDER_STATE_FILE, JSON.stringify(state, null, 2));
}

async function getStreakData(): Promise<StreakData> {
  if (!existsSync(STREAK_FILE)) {
    return { current: 0, longest: 0, lastStandup: '' };
  }
  const text = await Bun.file(STREAK_FILE).text();
  return JSON.parse(text);
}

function getTodayDateString(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

function hasStandupToday(): boolean {
  const todayFile = `${getTodayDateString()}.md`;
  const filepath = join(STANDUP_DIR, todayFile);
  return existsSync(filepath);
}

function getLastStandupDate(): Date | null {
  try {
    const files = readdirSync(STANDUP_DIR)
      .filter(f => f.endsWith('.md'))
      .sort()
      .reverse();

    if (files.length === 0) return null;

    const lastFile = files[0];
    const dateStr = lastFile.replace('.md', '');
    return parseISO(dateStr);
  } catch {
    return null;
  }
}

function daysSinceLastStandup(): number {
  const lastDate = getLastStandupDate();
  if (!lastDate) return 999;

  const now = new Date();
  const diffMs = now.getTime() - lastDate.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

async function hasRecentCommits(): Promise<boolean> {
  try {
    const repos = await findGitRepositories();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000); // Last 24 hours
    const result = await aggregateCommits(repos, since);
    return result.totalCommits > 0;
  } catch {
    return false;
  }
}

async function sendNotification(title: string, body: string, urgency: 'low' | 'normal' | 'critical' = 'normal'): Promise<boolean> {
  try {
    const proc = Bun.spawn(
      ['notify-send', '-u', urgency, '-a', 'Standup CLI', title, body],
      {
        stdout: 'ignore',
        stderr: 'ignore',
      }
    );

    await proc.exited;
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

function getScheduledTime(): { hour: number; minute: number } {
  // 8 AM UTC
  return { hour: 8, minute: 0 };
}

function hasPassedScheduledTime(): boolean {
  const now = new Date();
  const utcHours = now.getUTCHours();
  const utcMinutes = now.getUTCMinutes();

  const scheduled = getScheduledTime();

  if (utcHours > scheduled.hour) return true;
  if (utcHours === scheduled.hour && utcMinutes >= scheduled.minute) return true;

  return false;
}

function isWorkHoursEnd(): boolean {
  // Check if it's around 5 PM local time (17:00)
  const now = new Date();
  const hours = now.getHours();
  return hours === 17;
}

async function checkReminders(): Promise<void> {
  const state = await getReminderState();
  const today = getTodayDateString();

  // Reset dismissed flag if it's a new day
  if (state.lastNotification && !state.lastNotification.startsWith(today)) {
    state.dismissedToday = false;
  }

  // Don't send notifications if already dismissed today
  if (state.dismissedToday) {
    return;
  }

  // Don't send notifications if standup is already done today
  if (hasStandupToday()) {
    return;
  }

  const streak = await getStreakData();
  const daysSince = daysSinceLastStandup();

  let shouldNotify = false;
  let title = '⏰ Standup Reminder';
  let body = '';
  let urgency: 'low' | 'normal' | 'critical' = 'normal';

  // Check 1: Missed scheduled standup (if it's past 8 AM UTC)
  if (hasPassedScheduledTime() && !hasStandupToday()) {
    shouldNotify = true;
    body = `You haven't done standup today. Current streak: ${streak.current} days`;
    urgency = 'normal';
  }

  // Check 2: Streak at risk (2+ days without standup)
  if (daysSince >= 2) {
    shouldNotify = true;
    title = '🔥 Streak at Risk!';
    body = `It's been ${daysSince} days since your last standup. Don't break your ${streak.current} day streak!`;
    urgency = 'critical';
  }

  // Check 3: End of work day reminder
  if (isWorkHoursEnd() && !hasStandupToday()) {
    shouldNotify = true;
    body = `End of day reminder: Haven't done standup yet. Streak: ${streak.current} days`;
    urgency = 'normal';
  }

  // Check 4: New commits detected
  const hasCommits = await hasRecentCommits();
  if (hasCommits && !hasStandupToday() && daysSince === 0) {
    // Only if last standup was today, meaning we haven't done one yet today
    shouldNotify = true;
    title = '📦 New Commits Detected';
    body = `You have new commits but haven't done standup today. Streak: ${streak.current} days`;
    urgency = 'low';
  }

  if (shouldNotify) {
    const sent = await sendNotification(title, body, urgency);

    if (sent) {
      state.lastNotification = new Date().toISOString();
      state.lastCheck = new Date().toISOString();
      await saveReminderState(state);
    }
  } else {
    // Just update last check time
    state.lastCheck = new Date().toISOString();
    await saveReminderState(state);
  }
}

// Run the reminder check
await checkReminders();
