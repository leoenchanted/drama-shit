const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');
const os = require('os');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 720,
    minHeight: 560,
    title: 'dramaShit',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    frame: false,
    transparent: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.setMenuBarVisibility(false);

  // 通知渲染进程窗口最大化/还原状态
  mainWindow.on('maximize', () => mainWindow.webContents.send('win-state-changed', true));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('win-state-changed', false));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());

// ==================== Window Controls ====================
ipcMain.handle('win-minimize', () => mainWindow?.minimize());
ipcMain.handle('win-maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});
ipcMain.handle('win-close', () => mainWindow?.close());
ipcMain.handle('win-is-maximized', () => mainWindow?.isMaximized() ?? false);

// ==================== Skills 扫描 ====================

function scanSkills(dirPath, depth = 0) {
  if (depth > 4) return [];
  const results = [];
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
      results.push(...scanSkills(full, depth + 1));
    } else if (entry.isFile() && entry.name === 'SKILL.md') {
      const parsed = parseSkillFrontmatter(full);
      if (parsed) results.push(parsed);
    }
  }
  return results;
}

function parseSkillFrontmatter(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const match = raw.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!match) return null;
    const fm = {};
    for (const line of match[1].split('\n')) {
      const kv = line.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
      if (kv) fm[kv[1]] = kv[2].trim();
    }
    return {
      name: fm.name || path.basename(path.dirname(filePath)),
      description: fm.description || '',
      path: filePath,
    };
  } catch {
    return null;
  }
}

ipcMain.handle('list-skills', async () => {
  const claudeDir = path.join(os.homedir(), '.claude');
  const skills = scanSkills(claudeDir);
  return skills;
});

ipcMain.handle('get-skill-content', async (event, skillPath) => {
  try {
    return fs.readFileSync(skillPath, 'utf-8');
  } catch {
    return '';
  }
});

// ==================== IPC Handlers ====================

// 检测 Claude Code 是否安装
ipcMain.handle('check-claude', async () => {
  return new Promise((resolve) => {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    exec(`${cmd} claude`, (err, stdout) => {
      if (err) {
        resolve({ installed: false });
      } else {
        resolve({ installed: true, path: stdout.trim().split('\n')[0] });
      }
    });
  });
});

// 安装 Claude Code（实时输出进度）
ipcMain.handle('install-claude', async (event) => {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', ['install', '-g', '@anthropic-ai/claude-code'], {
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (data) => {
      event.sender.send('install-progress', data.toString());
    });

    child.stderr.on('data', (data) => {
      event.sender.send('install-progress', data.toString());
    });

    child.on('close', (code) => {
      resolve({ success: code === 0, code });
    });

    child.on('error', (err) => {
      reject(err.message);
    });
  });
});

// 查找 Git Bash 路径
function findGitBash() {
  // 先检查常见安装路径
  const commonPaths = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    'D:\\Program Files\\Git\\bin\\bash.exe',
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Git', 'bin', 'bash.exe'),
  ];
  for (const p of commonPaths) {
    if (fs.existsSync(p)) return p;
  }
  // 再尝试 PATH 中搜索
  try {
    const result = require('child_process').execSync('where bash', { encoding: 'utf-8' });
    const lines = result.trim().split('\n');
    if (lines.length > 0 && lines[0].trim()) return lines[0].trim();
  } catch {}
  return null;
}

// 检测 Git Bash
ipcMain.handle('check-git', async () => {
  const bashPath = findGitBash();
  return { installed: !!bashPath, path: bashPath };
});

// 安装 Git for Windows（通过 winget）
ipcMain.handle('install-git', async (event) => {
  return new Promise((resolve, reject) => {
    const child = spawn('winget', ['install', 'Git.Git', '--accept-package-agreements', '--silent'], {
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (data) => {
      event.sender.send('install-progress', data.toString());
    });

    child.stderr.on('data', (data) => {
      event.sender.send('install-progress', data.toString());
    });

    child.on('close', (code) => {
      if (code === 0) {
        // winget 成功后等一小会儿让 PATH 生效
        setTimeout(() => {
          const bashPath = findGitBash();
          resolve({ success: true, path: bashPath });
        }, 3000);
      } else {
        resolve({ success: false, code });
      }
    });

    child.on('error', (err) => {
      reject(err.message);
    });
  });
});

// 读取当前配置
ipcMain.handle('load-config', async () => {
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
  try {
    const raw = fs.readFileSync(settingsPath, 'utf-8');
    const settings = JSON.parse(raw);
    return settings.env || {};
  } catch {
    return {};
  }
});

// 保存配置
ipcMain.handle('save-config', async (event, config) => {
  const settingsDir = path.join(os.homedir(), '.claude');
  const settingsPath = path.join(settingsDir, 'settings.json');

  let settings = {};
  try {
    const raw = fs.readFileSync(settingsPath, 'utf-8');
    settings = JSON.parse(raw);
  } catch {
    // 文件不存在则新建
  }

  if (!settings.env) settings.env = {};

  settings.env.ANTHROPIC_AUTH_TOKEN = config.token;
  settings.env.ANTHROPIC_BASE_URL = config.baseUrl;
  settings.env.ANTHROPIC_MODEL = config.model;
  if (config.subAgentModel) {
    settings.env.CLAUDE_CODE_SUBAGENT_MODEL = config.subAgentModel;
  }
  settings.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';

  if (!fs.existsSync(settingsDir)) {
    fs.mkdirSync(settingsDir, { recursive: true });
  }

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
  return { success: true };
});

// 打开文件选择对话框
ipcMain.handle('select-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择字幕文件（可多选）',
    filters: [
      { name: '字幕文件', extensions: ['srt', 'ass', 'ssa', 'vtt'] },
      { name: '所有文件', extensions: ['*'] },
    ],
    properties: ['openFile', 'multiSelections'],
  });
  if (result.canceled) return [];
  return result.filePaths;
});

// 打开 TXT 文件选择对话框
ipcMain.handle('select-txt-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择 TXT 字幕文件（可多选）',
    filters: [
      { name: '文本文件', extensions: ['txt'] },
      { name: '所有文件', extensions: ['*'] },
    ],
    properties: ['openFile', 'multiSelections'],
  });
  if (result.canceled) return [];
  return result.filePaths;
});

// 读取字幕文件（不做解析，只改后缀存为 .txt）
ipcMain.handle('convert-subtitle', async (event, arg) => {
  try {
    let content, txtPath, fileName;

    if (typeof arg === 'string') {
      // 对话框选文件：传的是文件路径
      content = fs.readFileSync(arg, 'utf-8');
      fileName = path.basename(arg);
      const ext = path.extname(arg);
      txtPath = arg.replace(ext, '.txt');
      fs.writeFileSync(txtPath, content, 'utf-8');
    } else {
      // 拖放文件：传的是 { fileName, content }
      content = arg.content;
      fileName = arg.fileName;
      txtPath = null;
    }

    const lineCount = content.split('\n').filter(l => l.trim()).length;
    return { success: true, txtPath, text: content, lineCount };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ==================== Claude 持久会话 ====================
let claudeSession = null;

function parseClaudeOutput(stdout) {
  const result = { chineseScript: null, englishScript: null };
  const scriptMatch = stdout.match(/<<<DRAMA_SCRIPT>>>\n([\s\S]*?)\n<<<END_SCRIPT>>>/);
  if (scriptMatch) result.chineseScript = scriptMatch[1].trim();
  const englishMatch = stdout.match(/<<<DRAMA_ENGLISH>>>\n([\s\S]*?)\n<<<END_ENGLISH>>>/);
  if (englishMatch) result.englishScript = englishMatch[1].trim();
  return result;
}

function getEnvVars() {
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
  let envVars = { ...process.env };
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    if (settings.env) envVars = { ...envVars, ...settings.env };
  } catch {}
  return envVars;
}

// 解析 stream-json 的一行，返回文本片段或 null
function parseStreamChunk(line) {
  try {
    const obj = JSON.parse(line);
    if (obj.type === 'content_block_delta' && obj.delta && obj.delta.type === 'text_delta') {
      return obj.delta.text;
    }
  } catch {}
  return null;
}

// 阶段一：生成中文文案（stream-json 实时流式）
ipcMain.handle('start-script-generation', async (event, { subtitleText, dramaName, notes, skillContent }) => {
  if (claudeSession) {
    try { claudeSession.process.kill(); } catch {}
    claudeSession = null;
  }

  const envVars = getEnvVars();
  if (!envVars.CLAUDE_CODE_GIT_BASH_PATH) {
    const bashPath = findGitBash();
    if (bashPath) envVars.CLAUDE_CODE_GIT_BASH_PATH = bashPath;
  }
  if (!envVars.CLAUDE_CODE_GIT_BASH_PATH) {
    event.sender.send('session-error', '未找到 Git Bash，请先在步骤1安装 Git for Windows');
    return;
  }

  const prompt = buildPrompt(subtitleText, dramaName, notes, skillContent);
  const claude = spawn('claude', ['-p', '--output-format', 'stream-json', '--verbose'], {
    shell: true,
    env: envVars,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  return new Promise((resolve) => {
    let fullText = '';
    let lineBuf = '';
    let stderrBuffer = '';

    claude.stdout.on('data', (data) => {
      lineBuf += data.toString();
      const lines = lineBuf.split('\n');
      lineBuf = lines.pop(); // 保留不完整的最后一行

      for (const line of lines) {
        if (!line.trim()) continue;
        const chunk = parseStreamChunk(line);
        if (chunk !== null) {
          fullText += chunk;
          // 实时推送给渲染进程显示
          event.sender.send('session-log', chunk);
          // 检查是否已生成中文脚本
          const parsed = parseClaudeOutput(fullText);
          if (parsed.chineseScript !== null) {
            event.sender.send('chinese-script', parsed.chineseScript);
          }
        }
      }
    });

    claude.stderr.on('data', (data) => {
      const msg = data.toString();
      stderrBuffer += msg;
      event.sender.send('session-log', msg);
      if (stderrBuffer.includes('requires git-bash')) {
        event.sender.send('session-error', 'Claude Code 需要 Git Bash，请先在步骤1安装 Git for Windows');
        try { claude.kill(); } catch {}
      }
    });

    claude.on('close', (code) => {
      if (claudeSession && claudeSession.process === claude) {
        claudeSession = null;
      }
      event.sender.send('session-closed', code);
      resolve();
    });

    claude.on('error', (err) => {
      claudeSession = null;
      event.sender.send('session-error', err.message);
      resolve();
    });

    claudeSession = { process: claude, buffer: '' };

    claude.stdin.write(prompt);
    claude.stdin.end();
  });
});

// 阶段二：确认文案并翻译
ipcMain.handle('confirm-and-translate', async (event) => {
  if (!claudeSession) {
    return { success: false, error: '没有活跃的会话，请先生成文案' };
  }

  const envVars2 = getEnvVars();
  if (!envVars2.CLAUDE_CODE_GIT_BASH_PATH) {
    const bashPath2 = findGitBash();
    if (bashPath2) envVars2.CLAUDE_CODE_GIT_BASH_PATH = bashPath2;
  }

  return new Promise((resolve) => {
    const claude = spawn('claude', ['-p', '--output-format', 'stream-json', '--verbose'], {
      shell: true,
      env: envVars2,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let fullText2 = '';
    let lineBuf2 = '';

    claude.stdout.on('data', (data) => {
      lineBuf2 += data.toString();
      const lines = lineBuf2.split('\n');
      lineBuf2 = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        const chunk = parseStreamChunk(line);
        if (chunk !== null) {
          fullText2 += chunk;
          event.sender.send('session-log', chunk);
          const parsed = parseClaudeOutput(fullText2);
          if (parsed.englishScript !== null) {
            event.sender.send('english-translation', parsed.englishScript);
          }
        }
      }
    });

    claude.stderr.on('data', (data) => {
      event.sender.send('session-log', data.toString());
    });

    claude.on('close', (code) => {
      resolve({ success: code === 0, code });
    });

    claude.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });

    // 把中文文案 + 翻译指令发过去
    const previousScript = claudeSession.buffer || '';
    claude.stdin.write(previousScript + '\n确认，翻译吧\n');
    claude.stdin.end();

    // 更新 session
    try { claudeSession.process.kill(); } catch {}
    claudeSession = { process: claude, buffer: fullText2 };
  });
});

// 取消会话
ipcMain.handle('cancel-session', async () => {
  if (claudeSession) {
    try { claudeSession.process.kill(); } catch {}
    claudeSession = null;
  }
  return { success: true };
});

function buildPrompt(subtitleText, dramaName, notes, skillContent) {
  let prompt = `这些是剧名和对应的字幕文件：\n\n`;
  prompt += `剧名：${dramaName}\n`;
  if (notes) {
    prompt += `附加信息：${notes}\n`;
  }
  if (skillContent) {
    prompt += `\n--- 使用的 Skill 工作流 ---\n\n${skillContent}\n\n--- Skill 结束 ---\n\n`;
  }
  prompt += `--- 字幕内容 ---\n\n${subtitleText}\n\n--- 结束 ---`;
  return prompt;
}
