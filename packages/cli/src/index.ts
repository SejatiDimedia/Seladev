#!/usr/bin/env node

import * as readline from 'readline';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

const CONFIG_DIR = path.join(os.homedir(), '.config', 'seladev');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
};

function error(msg: string) {
  console.error(`${colors.red}${colors.bold}Error:${colors.reset} ${msg}`);
}

function success(msg: string) {
  console.log(`${colors.green}${colors.bold}Success:${colors.reset} ${msg}`);
}

function info(msg: string) {
  console.log(`${colors.cyan}Info:${colors.reset} ${msg}`);
}

function saveConfig(data: { accessToken?: string; refreshToken?: string; email?: string; organizationId?: string }) {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err: any) {
    error(`Failed to save config: ${err.message}`);
  }
}

function loadConfig(): { accessToken?: string; refreshToken?: string; email?: string; organizationId?: string } | null {
  if (!fs.existsSync(CONFIG_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

function askQuestion(query: string, hideInput = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    if (hideInput) {
      let value = '';
      process.stdout.write(query);

      const onData = (char: Buffer) => {
        const str = char.toString('utf-8');
        for (let i = 0; i < str.length; i++) {
          const c = str[i];
          if (c === '\n' || c === '\r') {
            process.stdin.removeListener('data', onData);
            if (process.stdin.isTTY) {
              process.stdin.setRawMode(false);
            }
            process.stdout.write('\n');
            rl.close();
            resolve(value);
            return;
          } else if (c === '\b' || c === '\x7f') { // Backspace
            if (value.length > 0) {
              value = value.slice(0, -1);
              process.stdout.write('\b \b');
            }
          } else {
            value += c;
            process.stdout.write('*');
          }
        }
      };

      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
      }
      process.stdin.resume();
      process.stdin.on('data', onData);
    } else {
      rl.question(query, (answer) => {
        rl.close();
        resolve(answer);
      });
    }
  });
}

const args = process.argv.slice(2);
const command = args[0];

function getOption(longName: string, shortName?: string): string | undefined {
  const longIndex = args.indexOf(longName);
  if (longIndex !== -1 && longIndex + 1 < args.length) {
    return args[longIndex + 1];
  }
  if (shortName) {
    const shortIndex = args.indexOf(shortName);
    if (shortIndex !== -1 && shortIndex + 1 < args.length) {
      return args[shortIndex + 1];
    }
  }
  return undefined;
}

function parseRefreshToken(setCookieHeader: string | null): string | null {
  if (!setCookieHeader) return null;
  const match = setCookieHeader.match(/refreshToken=([^;]+)/);
  return match ? match[1] || null : null;
}

async function authenticatedFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const apiBase = process.env.SELADEV_API_URL || 'http://localhost:3000';
  let token = process.env.SELADEV_API_KEY;
  const config = loadConfig();

  if (!token && config?.accessToken) {
    token = config.accessToken;
  }

  const headers = {
    ...options.headers,
    'Content-Type': 'application/json',
  } as Record<string, string>;

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const finalOptions = {
    ...options,
    headers,
  };

  let response = await fetch(url, finalOptions);

  // If 401 Unauthorized and we have a refreshToken, try to refresh
  if (response.status === 401 && config?.refreshToken && !process.env.SELADEV_API_KEY) {
    info('Access token expired, attempting to refresh token...');
    try {
      const refreshRes = await fetch(`${apiBase}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: config.refreshToken }),
      });

      const refreshJson = await refreshRes.json() as any;
      if (refreshRes.ok && refreshJson.success) {
        const newAccessToken = refreshJson.data.accessToken;
        const newRefreshToken = parseRefreshToken(refreshRes.headers.get('set-cookie')) || config.refreshToken;

        config.accessToken = newAccessToken;
        config.refreshToken = newRefreshToken;
        saveConfig(config);

        // Retry the original request with the new token
        headers['Authorization'] = `Bearer ${newAccessToken}`;
        response = await fetch(url, finalOptions);
      } else {
        error('Session expired. Please run "seladev login" to re-authenticate.');
        process.exit(1);
      }
    } catch {
      error('Authentication failed. Please login again.');
      process.exit(1);
    }
  }

  return response;
}

async function handleLogin() {
  const email = await askQuestion('Enter Email: ');
  const password = await askQuestion('Enter Password: ', true);

  const apiBase = process.env.SELADEV_API_URL || 'http://localhost:3000';

  try {
    const res = await fetch(`${apiBase}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const json = await res.json() as any;

    if (!res.ok) {
      throw new Error(json.message || 'Login failed');
    }

    if (json.data?.requiresMfa) {
      info('Multi-Factor Authentication (MFA) is enabled for your account.');
      const mfaToken = json.data.mfaToken;
      const totpCode = await askQuestion('Enter 6-digit TOTP code: ');

      const mfaRes = await fetch(`${apiBase}/api/v1/auth/login/mfa`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mfaToken, token: totpCode }),
      });

      const mfaJson = await mfaRes.json() as any;
      if (!mfaRes.ok) {
        throw new Error(mfaJson.message || 'MFA verification failed');
      }

      const { accessToken, user } = mfaJson.data;
      const newRefreshToken = parseRefreshToken(mfaRes.headers.get('set-cookie'));

      saveConfig({
        accessToken,
        refreshToken: newRefreshToken || '',
        email: user.email,
        organizationId: user.organizationId,
      });

      success('Successfully logged in (MFA Verified)!');
    } else {
      const { accessToken, user } = json.data;
      const newRefreshToken = parseRefreshToken(res.headers.get('set-cookie'));

      saveConfig({
        accessToken,
        refreshToken: newRefreshToken || '',
        email: user.email,
        organizationId: user.organizationId,
      });

      success('Successfully logged in!');
    }
  } catch (err: any) {
    error(err.message);
    process.exit(1);
  }
}

async function handleSecretsPull() {
  const project = getOption('--project', '-p');
  const env = getOption('--env', '-e');
  const out = getOption('--out', '-o') || '.env';

  if (!project || !env) {
    error('Missing required options: --project <id_or_slug> and --env <id_or_slug>');
    console.log('\nUsage: seladev secrets pull --project <project> --env <env> [--out <file>]');
    process.exit(1);
    return;
  }

  const apiBase = process.env.SELADEV_API_URL || 'http://localhost:3000';
  const url = `${apiBase}/api/v1/projects/${encodeURIComponent(project)}/environments/${encodeURIComponent(env)}/secrets/reveal-all`;

  info(`Fetching secrets for project "${project}" in environment "${env}"...`);

  try {
    const res = await authenticatedFetch(url, { method: 'POST' });
    const json = await res.json() as any;

    if (!res.ok) {
      throw new Error(json.message || `Failed to fetch secrets (HTTP ${res.status})`);
    }

    const secrets = json.data as { key: string; value: string }[];
    if (!Array.isArray(secrets)) {
      throw new Error('Invalid secrets response format from server');
    }

    // Write to env file format
    const fileContent = secrets
      .map(s => `${s.key}=${s.value}`)
      .join('\n') + '\n';

    fs.writeFileSync(out, fileContent, 'utf-8');
    success(`Pulled ${secrets.length} secrets and wrote to "${out}"!`);
  } catch (err: any) {
    error(err.message);
    process.exit(1);
  }
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'queued': return colors.cyan;
    case 'building': return colors.yellow;
    case 'success': return colors.green;
    case 'failed': return colors.red;
    case 'cancelled': return colors.dim;
    case 'pending_approval': return colors.yellow + colors.bold;
    default: return colors.reset;
  }
}

async function handleDeploy() {
  const project = getOption('--project', '-p');
  const env = getOption('--env', '-e');
  const branch = getOption('--branch', '-b');
  const commit = getOption('--commit', '-c');
  const message = getOption('--message', '-m');

  if (!project || !env || !branch) {
    error('Missing required options: --project <id_or_slug>, --env <id_or_slug>, and --branch <branch>');
    console.log('\nUsage: seladev deploy --project <project> --env <env> --branch <branch> [--commit <sha>] [--message <msg>]');
    process.exit(1);
    return;
  }

  const apiBase = process.env.SELADEV_API_URL || 'http://localhost:3000';
  const url = `${apiBase}/api/v1/projects/${encodeURIComponent(project)}/deployments`;

  info(`Triggering deployment on branch "${branch}"...`);

  try {
    const res = await authenticatedFetch(url, {
      method: 'POST',
      body: JSON.stringify({
        environmentId: env,
        branch,
        commitHash: commit,
        commitMessage: message,
      }),
    });

    const json = await res.json() as any;
    if (!res.ok) {
      throw new Error(json.message || `Failed to trigger deployment (HTTP ${res.status})`);
    }

    const dep = json.data;
    success(`Deployment triggered successfully!`);
    console.log(`\n${colors.bold}Deployment Details:${colors.reset}`);
    console.log(`- ID:      ${colors.cyan}${dep.id}${colors.reset}`);
    console.log(`- Status:  ${getStatusColor(dep.status)}${dep.status}${colors.reset}`);
    console.log(`- Version: ${dep.version}`);
    console.log(`- Branch:  ${dep.branch}`);
    if (dep.status === 'pending_approval') {
      info('Notice: This deployment requires manual approval before it can build.');
    }
  } catch (err: any) {
    error(err.message);
    process.exit(1);
  }
}

async function handleStatus() {
  const deploymentId = getOption('--deployment', '-d');
  const project = getOption('--project', '-p');

  if (!deploymentId || !project) {
    error('Missing required options: --project <project_id_or_slug> and --deployment <deployment_id>');
    console.log('\nUsage: seladev status --project <project> --deployment <id>');
    process.exit(1);
    return;
  }

  const apiBase = process.env.SELADEV_API_URL || 'http://localhost:3000';
  const url = `${apiBase}/api/v1/projects/${encodeURIComponent(project)}/deployments/${encodeURIComponent(deploymentId)}`;

  try {
    const res = await authenticatedFetch(url, { method: 'GET' });
    const json = await res.json() as any;

    if (!res.ok) {
      throw new Error(json.message || `Failed to fetch status (HTTP ${res.status})`);
    }

    const dep = json.data;
    console.log(`\n${colors.bold}Deployment Status:${colors.reset}`);
    console.log(`- ID:         ${dep.id}`);
    console.log(`- Status:     ${getStatusColor(dep.status)}${dep.status}${colors.reset}`);
    console.log(`- Version:    ${dep.version}`);
    console.log(`- Branch:     ${dep.branch}`);
    if (dep.errorMessage) {
      console.log(`- Error:      ${colors.red}${dep.errorMessage}${colors.reset}`);
    }

    if (dep.buildLogs && Array.isArray(dep.buildLogs) && dep.buildLogs.length > 0) {
      console.log(`\n${colors.bold}Build Logs:${colors.reset}`);
      dep.buildLogs.forEach((log: string) => {
        console.log(`  ${colors.dim}${log}${colors.reset}`);
      });
    } else {
      console.log(`\n${colors.dim}No build logs available yet.${colors.reset}`);
    }
  } catch (err: any) {
    error(err.message);
    process.exit(1);
  }
}

function printHelp() {
  console.log(`
${colors.bold}SELADEV CLI${colors.reset} - CLI tool to interact with the SELADEV platform

${colors.bold}Usage:${colors.reset}
  npx seladev <command> [options]

${colors.bold}Commands:${colors.reset}
  ${colors.bold}login${colors.reset}
    Handshake login requesting Email, Password, and TOTP. Saves session.

  ${colors.bold}secrets pull${colors.reset}
    Pulls decrypted environment variables for a project and writes them to a file.
    Options:
      -p, --project <id_or_slug>  (Required) Project ID or slug
      -e, --env <id_or_slug>      (Required) Environment ID or slug
      -o, --out <file>            (Optional) Output destination file (defaults to .env)

  ${colors.bold}deploy${colors.reset}
    Triggers a new deployment.
    Options:
      -p, --project <id_or_slug>  (Required) Project ID or slug
      -e, --env <id_or_slug>      (Required) Environment ID or slug
      -b, --branch <branch>       (Required) Branch to deploy
      -c, --commit <sha>          (Optional) Git commit hash
      -m, --message <msg>         (Optional) Git commit message

  ${colors.bold}status${colors.reset}
    Check deployment status and logs.
    Options:
      -p, --project <id_or_slug>  (Required) Project ID or slug
      -d, --deployment <id>       (Required) Deployment ID

  ${colors.bold}help, --help, -h${colors.reset}
    Print this help menu.
`);
}

async function main() {
  if (!command) {
    printHelp();
    process.exit(0);
  }

  switch (command) {
    case 'login':
      await handleLogin();
      break;
    case 'secrets':
      if (args[1] === 'pull') {
        await handleSecretsPull();
      } else {
        error(`Unknown secrets command: "${args[1]}"`);
        console.log('Available secrets subcommands: pull');
        process.exit(1);
      }
      break;
    case 'deploy':
      await handleDeploy();
      break;
    case 'status':
      await handleStatus();
      break;
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      break;
    default:
      error(`Unknown command: "${command}"`);
      printHelp();
      process.exit(1);
  }
}

main().catch((err) => {
  error(`Fatal CLI Error: ${err.message}`);
  process.exit(1);
});
