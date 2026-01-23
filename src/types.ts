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

export interface RetroData {
  weekStart: string;
  weekEnd: string;
  weekNumber: number;
  year: number;
  totalDays: number;
  moods: string[];
  themes: string[];
  highlights: string[];
  challenges: string[];
  lessonsLearned: string[];
  nextWeekFocus: string[];
}
