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

// ==================== drama-text-skills 检测 ====================

function uniquePaths(paths) {
  return [...new Set(paths.filter(Boolean))];
}

function getDramaSkillCandidates() {
  const skillFile = path.join('skills', 'drama-text-skills', 'SKILL.md');
  const projectSkillFile = path.join('.claude', skillFile);
  return uniquePaths([
    path.join(os.homedir(), '.claude', skillFile),
    path.join(process.cwd(), projectSkillFile),
    path.join(__dirname, projectSkillFile),
    path.join(app.getAppPath(), projectSkillFile),
  ]);
}

function checkDramaSkillInstall() {
  const checkedPaths = getDramaSkillCandidates();
  const foundPath = checkedPaths.find(p => fs.existsSync(p));
  return {
    installed: !!foundPath,
    path: foundPath || null,
    checkedPaths,
  };
}

function getClaudeCwdForSkill(skillPath) {
  const globalSkillPath = path.join(os.homedir(), '.claude', 'skills', 'drama-text-skills', 'SKILL.md');
  if (!skillPath || path.normalize(skillPath) === path.normalize(globalSkillPath)) {
    return process.cwd();
  }

  const marker = `${path.sep}.claude${path.sep}`;
  const markerIndex = skillPath.indexOf(marker);
  if (markerIndex > -1) {
    return skillPath.slice(0, markerIndex);
  }

  return process.cwd();
}

ipcMain.handle('check-drama-skill', async () => checkDramaSkillInstall());

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
  if (process.platform !== 'win32') {
    return { installed: true, path: 'macOS/Linux 不需要 Git Bash', skipped: true };
  }
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

// ==================== Claude 调用 ====================
let activeClaudeProcess = null;

function parseClaudeOutput(stdout) {
  const result = { chineseScript: null, englishScript: null };
  const scriptMatch = stdout.match(/<<<DRAMA_SCRIPT>>>\s*\r?\n([\s\S]*?)\r?\n<<<END_SCRIPT>>>/);
  if (scriptMatch) result.chineseScript = scriptMatch[1].trim();
  const englishMatch = stdout.match(/<<<DRAMA_ENGLISH>>>\s*\r?\n([\s\S]*?)\r?\n<<<END_ENGLISH>>>/);
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

function prepareClaudeEnv() {
  const envVars = getEnvVars();
  if (process.platform !== 'win32') return { ok: true, envVars };

  if (!envVars.CLAUDE_CODE_GIT_BASH_PATH) {
    const bashPath = findGitBash();
    if (bashPath) envVars.CLAUDE_CODE_GIT_BASH_PATH = bashPath;
  }
  if (!envVars.CLAUDE_CODE_GIT_BASH_PATH) {
    return { ok: false, error: '未找到 Git Bash，请先在步骤1安装 Git for Windows' };
  }
  return { ok: true, envVars };
}

// 解析 stream-json 的一行，返回文本片段或 null
function parseStreamChunk(line) {
  try {
    const obj = JSON.parse(line);
    if (obj.type === 'content_block_delta' && obj.delta && obj.delta.type === 'text_delta') {
      return obj.delta.text;
    }
    if (obj.type === 'assistant' && Array.isArray(obj.message?.content)) {
      return obj.message.content
        .filter(item => item && item.type === 'text' && typeof item.text === 'string')
        .map(item => item.text)
        .join('');
    }
    if (obj.type === 'result' && typeof obj.result === 'string') {
      return obj.result;
    }
  } catch {}
  return null;
}

function createParserState(event, expectedOutput) {
  return {
    fullText: '',
    chineseSent: false,
    englishSent: false,
    append(text) {
      if (!text) return;
      this.fullText += text;
      event.sender.send('session-log', text);
      this.emitIfReady();
    },
    emitIfReady() {
      const parsed = parseClaudeOutput(this.fullText);
      if (expectedOutput === 'chinese' && parsed.chineseScript !== null && !this.chineseSent) {
        this.chineseSent = true;
        event.sender.send('chinese-script', parsed.chineseScript);
      }
      if (expectedOutput === 'english' && parsed.englishScript !== null && !this.englishSent) {
        this.englishSent = true;
        event.sender.send('english-translation', parsed.englishScript);
      }
    },
    hasExpectedOutput() {
      return expectedOutput === 'chinese' ? this.chineseSent : this.englishSent;
    },
  };
}

function consumeJsonLine(line, parserState) {
  if (!line.trim()) return;
  const chunk = parseStreamChunk(line);
  if (chunk !== null) parserState.append(chunk);
}

function runClaudePrompt(event, prompt, expectedOutput) {
  if (activeClaudeProcess) {
    try { activeClaudeProcess.kill(); } catch {}
    activeClaudeProcess = null;
  }

  const skillCheck = checkDramaSkillInstall();
  if (!skillCheck.installed) {
    event.sender.send('session-error', '未检测到 drama-text-skills，请先安装后再处理');
    return Promise.resolve({ success: false, error: 'missing-drama-text-skills' });
  }

  const envResult = prepareClaudeEnv();
  if (!envResult.ok) {
    event.sender.send('session-error', envResult.error);
    return Promise.resolve({ success: false, error: envResult.error });
  }

  const parserState = createParserState(event, expectedOutput);
  const claude = spawn('claude', ['-p', '--output-format', 'stream-json', '--verbose'], {
    shell: true,
    cwd: getClaudeCwdForSkill(skillCheck.path),
    env: envResult.envVars,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  activeClaudeProcess = claude;

  return new Promise((resolve) => {
    let lineBuf = '';
    let stderrBuffer = '';

    claude.stdout.on('data', (data) => {
      lineBuf += data.toString();
      const lines = lineBuf.split('\n');
      lineBuf = lines.pop();
      for (const line of lines) {
        consumeJsonLine(line, parserState);
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
      if (lineBuf.trim()) consumeJsonLine(lineBuf, parserState);
      parserState.emitIfReady();
      if (activeClaudeProcess === claude) activeClaudeProcess = null;

      if (code === 0 && !parserState.hasExpectedOutput()) {
        const name = expectedOutput === 'chinese' ? '中文文案' : '英文翻译';
        event.sender.send('session-error', `Claude Code 已结束，但没有检测到 drama-text-skills 返回的${name}。请确认 skill 已安装并能被触发。`);
      }
      event.sender.send('session-closed', code);
      resolve({ success: code === 0 && parserState.hasExpectedOutput(), code });
    });

    claude.on('error', (err) => {
      if (activeClaudeProcess === claude) activeClaudeProcess = null;
      event.sender.send('session-error', err.message);
      resolve({ success: false, error: err.message });
    });

    claude.stdin.write(prompt);
    claude.stdin.end();
  });
}

// 阶段一：生成中文文案（stream-json 实时流式）
ipcMain.handle('start-script-generation', async (event, { subtitleText, dramaName, notes }) => {
  const prompt = buildScriptPrompt(subtitleText, dramaName, notes);
  return runClaudePrompt(event, prompt, 'chinese');
});

// 阶段二：确认文案并翻译
ipcMain.handle('confirm-and-translate', async (event, chineseScript) => {
  if (!chineseScript || !chineseScript.trim()) {
    return { success: false, error: '中文文案为空，请先生成或填写中文文案' };
  }
  const prompt = buildTranslationPrompt(chineseScript.trim());
  return runClaudePrompt(event, prompt, 'english');
});

// 取消会话
ipcMain.handle('cancel-session', async () => {
  if (activeClaudeProcess) {
    try { activeClaudeProcess.kill(); } catch {}
    activeClaudeProcess = null;
  }
  return { success: true };
});

function buildScriptPrompt(subtitleText, dramaName, notes) {
  let prompt = `帮我给这个短剧写解说文案。\n\n`;
  prompt += `剧名：${dramaName}\n`;
  if (notes) {
    prompt += `附加信息：${notes}\n`;
  }
  prompt += `\n请使用已安装的 drama-text-skills 工作流处理下面的 TXT 字幕内容。\n\n`;
  prompt += `--- 字幕内容 ---\n\n${subtitleText}\n\n--- 结束 ---`;
  return prompt;
}

function buildTranslationPrompt(chineseScript) {
  let prompt = `下面是已经确认的短剧文案脚本，确认，翻译吧。\n\n`;
  prompt += `请使用 drama-text-skills 的英文翻译阶段处理下面这版中文文案。\n\n`;
  prompt += `--- 已确认中文文案 ---\n\n${chineseScript}\n\n--- 结束 ---`;
  return prompt;
}
