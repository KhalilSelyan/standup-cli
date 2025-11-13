import pc from 'picocolors';

/**
 * Check if git is installed
 */
export async function checkGitInstalled(): Promise<boolean> {
  try {
    const proc = Bun.spawn(['git', '--version'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    await proc.exited;
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Get helpful error message for missing git
 */
export function getGitInstallMessage(): string {
  return (
    pc.red('✗ Git is not installed\n\n') +
    pc.yellow('Git is required for commit aggregation features.\n') +
    pc.gray('Install git:\n') +
    pc.cyan('  • Ubuntu/Debian: ') + 'sudo apt install git\n' +
    pc.cyan('  • Fedora:        ') + 'sudo dnf install git\n' +
    pc.cyan('  • Arch:          ') + 'sudo pacman -S git\n' +
    pc.cyan('  • macOS:         ') + 'brew install git\n'
  );
}

/**
 * Get helpful message for no repositories found
 */
export function getNoReposFoundMessage(scanPath: string): string {
  return (
    pc.yellow('⚠ No git repositories found\n\n') +
    pc.gray('Scanned path: ') + pc.cyan(scanPath) + '\n\n' +
    pc.gray('To customize the scan path, create a config.json:\n') +
    pc.cyan('  {\n    "gitScanPath": "/your/repos/path"\n  }\n')
  );
}

/**
 * Get helpful message for clipboard tools
 */
export function getClipboardToolsMessage(): string {
  return (
    pc.yellow('⚠ No clipboard tool found\n\n') +
    pc.gray('Install one of these clipboard tools to enable copy functionality:\n') +
    pc.cyan('  • Wayland: ') + 'wl-clipboard (wl-copy)\n' +
    pc.cyan('  • X11:     ') + 'xclip or xsel\n\n' +
    pc.gray('Install:\n') +
    pc.cyan('  • Ubuntu/Debian: ') + 'sudo apt install wl-clipboard xclip\n' +
    pc.cyan('  • Arch:          ') + 'sudo pacman -S wl-clipboard xclip\n' +
    pc.cyan('  • Fedora:        ') + 'sudo dnf install wl-clipboard xclip\n'
  );
}

/**
 * Check if clipboard tools are available
 */
export async function checkClipboardAvailable(): Promise<{ available: boolean; tool: string | null }> {
  const tools = ['wl-copy', 'xclip', 'xsel'];

  for (const tool of tools) {
    try {
      const proc = Bun.spawn(['which', tool], {
        stdout: 'pipe',
        stderr: 'ignore',
      });

      await proc.exited;
      if (proc.exitCode === 0) {
        return { available: true, tool };
      }
    } catch {
      continue;
    }
  }

  return { available: false, tool: null };
}
