// Shared TypeScript interfaces for standup CLI

export interface Commit {
  hash: string;
  author: string;
  timestamp: Date;
  message: string;
  refNames: string;
  isUnpushed: boolean;
  repoName: string;
  branch?: string;
}

export interface CommitGroup {
  repoName: string;
  commits: Commit[];
  pushedCount: number;
  unpushedCount: number;
}

export interface GitAggregationResult {
  groups: CommitGroup[];
  timeRange: {
    since: Date;
    until: Date;
  };
  totalCommits: number;
}

export interface StandupData {
  date: string;
  mood: string;
  accomplishments: string[];
  blockers: string[];
  todaysPlan: string[];
}

export interface StreakData {
  current: number;
  longest: number;
  lastStandup: string;
}

export interface ReminderState {
  lastCheck: string;
  dismissedToday: boolean;
  lastNotification: string;
}
