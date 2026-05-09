// ==================== 窗口控制 ====================
document.getElementById('btn-minimize').addEventListener('click', () => window.api.winMinimize());
document.getElementById('btn-maximize').addEventListener('click', () => window.api.winMaximize());
document.getElementById('btn-close').addEventListener('click', () => window.api.winClose());

window.api.onWinStateChanged((isMaximized) => {
  document.querySelector('#btn-maximize .icon-restore').style.display = isMaximized ? 'none' : '';
  document.querySelector('#btn-maximize .icon-max').style.display = isMaximized ? '' : 'none';
});

// 标题栏双击最大化
document.getElementById('title-bar').addEventListener('dblclick', (e) => {
  if (e.target.closest('.title-bar-controls')) return;
  window.api.winMaximize();
});

// ==================== 状态管理 ====================
const state = {
  claudeInstalled: false,
  selectedFile: null,
  subtitleText: '',
  isProcessing: false,
  currentStep: 1,
  highestReachedStep: 1,
  selectedSkill: null,
  skills: [],
  chineseScript: null,
  englishScript: null,
};

// ==================== 步骤导航 ====================
function switchStep(step) {
  state.currentStep = step;
  if (step > state.highestReachedStep) {
    state.highestReachedStep = step;
  }

  // 切换面板
  document.querySelectorAll('.step-panel').forEach(el => el.classList.remove('active'));
  const panel = document.getElementById(`step-${step}`);
  if (panel) panel.classList.add('active');

  // 更新侧边栏步骤项状态
  document.querySelectorAll('.step-item').forEach(item => {
    const itemStep = parseInt(item.dataset.step, 10);
    item.classList.remove('active', 'done');
    if (itemStep < step) item.classList.add('done');
    if (itemStep === step) item.classList.add('active');
  });

  // 切换到相应步骤时触发检测/加载
  if (step === 1) checkClaudeInstall();
  if (step === 2) loadSavedConfig();
  if (step === 3) loadSkills();
}

// 侧边栏点击导航
document.querySelectorAll('.step-item').forEach(item => {
  item.addEventListener('click', () => {
    const step = parseInt(item.dataset.step, 10);
    switchStep(step);
  });
});

// ==================== Skills 加载 ====================
async function loadSkills() {
  if (state.skills.length > 0) return; // 已加载
  try {
    state.skills = await window.api.listSkills();
    const select = document.getElementById('skill-select');
    select.innerHTML = '<option value="">不使用 Skill（直接处理）</option>';
    for (const skill of state.skills) {
      const opt = document.createElement('option');
      opt.value = skill.path;
      opt.textContent = `${skill.name}`;
      if (skill.description) {
        opt.title = skill.description;
      }
      select.appendChild(opt);
    }
  } catch {
    // 加载失败则留空
  }
}

document.getElementById('skill-select').addEventListener('change', (e) => {
  state.selectedSkill = e.target.value || null;
});

// ==================== 步骤1：环境检测 ====================
let envChecks = { claude: false, git: false };

function setEnvStatus(id, state, desc) {
  const item = document.getElementById(`env-${id}`);
  const spinner = item.querySelector('.env-spinner');
  const check = item.querySelector('.env-check');
  const warn = item.querySelector('.env-warn');
  const descEl = document.getElementById(`env-${id}-desc`);
  const actionsEl = document.getElementById(`env-${id}-actions`);

  spinner.classList.add('hidden');
  check.classList.add('hidden');
  warn.classList.add('hidden');

  if (state === 'loading') {
    spinner.classList.remove('hidden');
  } else if (state === 'ok') {
    check.classList.remove('hidden');
  } else {
    warn.classList.remove('hidden');
  }

  descEl.textContent = desc;
  envChecks[id] = (state === 'ok');

  // 两个都就绪才跳转
  if (envChecks.claude && envChecks.git) {
    state.claudeInstalled = true;
    setTimeout(() => switchStep(2), 800);
  }

  return actionsEl;
}

async function checkClaudeInstall() {
  const actionsEl = setEnvStatus('claude', 'loading', '正在检测...');
  actionsEl.innerHTML = '';

  try {
    const result = await window.api.checkClaude();
    if (result.installed) {
      setEnvStatus('claude', 'ok', result.path || '已安装');
    } else {
      const el = setEnvStatus('claude', 'warn', '未安装');
      el.innerHTML = '<button id="btn-install-claude" class="btn btn-accent">安装</button>';
      bindInstallClaude();
    }
  } catch (err) {
    setEnvStatus('claude', 'warn', '检测失败：' + err);
  }
}

async function checkGitInstall() {
  const actionsEl = setEnvStatus('git', 'loading', '正在检测...');
  actionsEl.innerHTML = '';

  try {
    const result = await window.api.checkGit();
    if (result.installed) {
      setEnvStatus('git', 'ok', result.path || '已安装');
    } else {
      const el = setEnvStatus('git', 'warn', '未安装（Claude Code 依赖 Git Bash）');
      el.innerHTML = '<button id="btn-install-git" class="btn btn-accent">安装 Git</button>';
      bindInstallGit();
    }
  } catch (err) {
    setEnvStatus('git', 'warn', '检测失败：' + err);
  }
}

function bindInstallClaude() {
  document.getElementById('btn-install-claude').addEventListener('click', async () => {
    const btn = document.getElementById('btn-install-claude');
    const logBox = document.getElementById('install-log');
    btn.disabled = true;
    btn.textContent = '安装中...';
    logBox.classList.remove('hidden');
    logBox.textContent = '正在安装 Claude Code...\n';

    const unsub = window.api.onInstallProgress((data) => {
      logBox.textContent += data;
      logBox.scrollTop = logBox.scrollHeight;
    });

    try {
      const result = await window.api.installClaude();
      unsub();
      if (result.success) {
        logBox.textContent += '\n✅ Claude Code 安装完成！';
        setEnvStatus('claude', 'ok', '已安装');
        document.getElementById('env-claude-actions').innerHTML = '';
      } else {
        logBox.textContent += '\n❌ 安装失败，请检查网络或手动安装';
        btn.disabled = false;
        btn.textContent = '重试安装';
      }
    } catch (err) {
      unsub();
      logBox.textContent += '\n❌ 错误：' + err;
      btn.disabled = false;
      btn.textContent = '重试安装';
    }
  });
}

function bindInstallGit() {
  document.getElementById('btn-install-git').addEventListener('click', async () => {
    const btn = document.getElementById('btn-install-git');
    const logBox = document.getElementById('install-log');
    btn.disabled = true;
    btn.textContent = '安装中...';
    logBox.classList.remove('hidden');
    logBox.textContent = '正在通过 winget 安装 Git for Windows...\n';

    const unsub = window.api.onInstallProgress((data) => {
      logBox.textContent += data;
      logBox.scrollTop = logBox.scrollHeight;
    });

    try {
      const result = await window.api.installGit();
      unsub();
      if (result.success) {
        logBox.textContent += '\n✅ Git 安装完成！';
        setEnvStatus('git', 'ok', result.path || '已安装');
        document.getElementById('env-git-actions').innerHTML = '';
      } else {
        logBox.textContent += '\n❌ 安装失败（退出码: ' + (result.code || '?') + '）';
        logBox.textContent += '\n请手动安装：https://git-scm.com/downloads/win';
        btn.disabled = false;
        btn.textContent = '重试安装';
      }
    } catch (err) {
      unsub();
      logBox.textContent += '\n❌ 错误：' + err;
      logBox.textContent += '\n请手动安装：https://git-scm.com/downloads/win';
      btn.disabled = false;
      btn.textContent = '重试安装';
    }
  });
}

// ==================== 步骤2：模型配置 ====================
async function loadSavedConfig() {
  try {
    const config = await window.api.loadConfig();
    if (config.ANTHROPIC_AUTH_TOKEN) {
      document.getElementById('token').value = config.ANTHROPIC_AUTH_TOKEN;
    }
    if (config.ANTHROPIC_BASE_URL) {
      document.getElementById('baseUrl').value = config.ANTHROPIC_BASE_URL;
    } else {
      document.getElementById('baseUrl').value = 'https://api.deepseek.com/anthropic';
    }
    if (config.ANTHROPIC_MODEL) {
      document.getElementById('model').value = config.ANTHROPIC_MODEL;
    }
    if (config.CLAUDE_CODE_SUBAGENT_MODEL) {
      document.getElementById('subModel').value = config.CLAUDE_CODE_SUBAGENT_MODEL;
    }
  } catch {
    document.getElementById('baseUrl').value = 'https://api.deepseek.com/anthropic';
  }
}

document.getElementById('btn-save-config').addEventListener('click', async () => {
  const token = document.getElementById('token').value.trim();
  const baseUrl = document.getElementById('baseUrl').value.trim();
  const model = document.getElementById('model').value.trim();
  const subAgentModel = document.getElementById('subModel').value.trim();

  if (!token || !baseUrl || !model) {
    alert('请填写必填字段（API 密钥、Base URL、模型名称）');
    return;
  }

  try {
    await window.api.saveConfig({ token, baseUrl, model, subAgentModel });
    const msg = document.getElementById('config-saved-msg');
    msg.classList.remove('hidden');
    setTimeout(() => {
      msg.classList.add('hidden');
      switchStep(3);
    }, 600);
  } catch (err) {
    alert('保存配置失败：' + err);
  }
});

document.getElementById('btn-skip-config').addEventListener('click', () => switchStep(3));

// ==================== 步骤3：工作台 ====================

// 全局拖放拦截（阻止 Electron 默认打开文件）
document.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); });
document.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); });

// FileReader 工具
function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsText(file, 'utf-8');
  });
}

// 通用 drop zone 绑定
function bindDropZone(zoneId, acceptExts, onFiles) {
  const zone = document.getElementById(zoneId);
  if (!zone) return;

  zone.addEventListener('dragenter', (e) => {
    e.preventDefault(); e.stopPropagation();
    zone.classList.add('drag-over');
  });
  zone.addEventListener('dragover', (e) => {
    e.preventDefault(); e.stopPropagation();
    zone.classList.add('drag-over');
  });
  zone.addEventListener('dragleave', (e) => {
    e.preventDefault(); e.stopPropagation();
    if (!zone.contains(e.relatedTarget)) zone.classList.remove('drag-over');
  });
  zone.addEventListener('drop', async (e) => {
    e.preventDefault(); e.stopPropagation();
    zone.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer.files).filter(f => {
      const ext = f.name.split('.').pop().toLowerCase();
      return acceptExts.includes(ext);
    });
    if (files.length === 0) {
      alert(`不支持的文件格式，请使用 ${acceptExts.join(' / ')} 文件`);
      return;
    }
    onFiles(files, 'drop');
  });
}

// ========== 区域一：字幕转 TXT ==========
let srtFiles = []; // { name, path?, file? }

function resetSrtUI() {
  srtFiles = [];
  document.getElementById('srt-file-info').classList.add('hidden');
  document.getElementById('btn-convert').disabled = true;
  document.getElementById('convert-results').classList.add('hidden');
  document.getElementById('convert-results').innerHTML = '';
}

bindDropZone('drop-srt', ['srt', 'ass', 'ssa', 'vtt'], (files, source) => {
  srtFiles = files.map(f => ({ name: f.name, file: f, path: f.path }));
  document.getElementById('srt-file-name').textContent = files.map(f => f.name).join(', ');
  document.getElementById('srt-file-status').textContent = `已选 ${files.length} 个文件`;
  document.getElementById('srt-file-info').classList.remove('hidden');
  document.getElementById('btn-convert').disabled = false;
});

document.getElementById('drop-srt').addEventListener('click', async () => {
  const paths = await window.api.selectFile();
  if (paths && paths.length > 0) {
    srtFiles = paths.map(p => ({ name: p.split(/[\\/]/).pop(), path: p, file: null }));
    document.getElementById('srt-file-name').textContent = srtFiles.map(f => f.name).join(', ');
    document.getElementById('srt-file-status').textContent = `已选 ${srtFiles.length} 个文件`;
    document.getElementById('srt-file-info').classList.remove('hidden');
    document.getElementById('btn-convert').disabled = false;
  }
});

document.getElementById('btn-browse-srt').addEventListener('click', async (e) => {
  e.stopPropagation();
  const paths = await window.api.selectFile();
  if (paths && paths.length > 0) {
    srtFiles = paths.map(p => ({ name: p.split(/[\\/]/).pop(), path: p, file: null }));
    document.getElementById('srt-file-name').textContent = srtFiles.map(f => f.name).join(', ');
    document.getElementById('srt-file-status').textContent = `已选 ${srtFiles.length} 个文件`;
    document.getElementById('srt-file-info').classList.remove('hidden');
    document.getElementById('btn-convert').disabled = false;
  }
});

document.getElementById('btn-convert').addEventListener('click', async () => {
  if (srtFiles.length === 0) return;
  const btn = document.getElementById('btn-convert');
  btn.disabled = true;
  btn.innerHTML = `<svg class="spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" stroke-opacity="0.2"/><path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"/></svg> 转换中...`;

  const resultsDiv = document.getElementById('convert-results');
  resultsDiv.classList.remove('hidden');
  resultsDiv.innerHTML = '';

  let successCount = 0;
  for (const f of srtFiles) {
    try {
      let result;
      if (f.path) {
        result = await window.api.convertSubtitle(f.path);
      } else {
        const content = await readFileAsText(f.file);
        result = await window.api.convertSubtitle({ fileName: f.name, content });
      }
      if (result.success) {
        successCount++;
        const item = document.createElement('div');
        item.className = 'convert-result-item';
        const baseName = f.name.replace(/\.\w+$/, '');
        item.innerHTML = `<span class="cr-check">&#10003;</span> <span class="cr-name">${baseName}.txt</span> <span class="cr-meta">(${result.lineCount} 行)</span>`;
        resultsDiv.appendChild(item);
      } else {
        const item = document.createElement('div');
        item.className = 'convert-result-item cr-fail';
        item.innerHTML = `<span class="cr-check">&#10007;</span> <span class="cr-name">${f.name}</span> <span class="cr-meta">${result.error}</span>`;
        resultsDiv.appendChild(item);
      }
    } catch (err) {
      const item = document.createElement('div');
      item.className = 'convert-result-item cr-fail';
      item.innerHTML = `<span class="cr-check">&#10007;</span> <span class="cr-name">${f.name}</span> <span class="cr-meta">${err.message}</span>`;
      resultsDiv.appendChild(item);
    }
  }

  btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg> 转换为 TXT`;
  btn.disabled = false;
  document.getElementById('srt-file-status').textContent = `转换完成：${successCount}/${srtFiles.length} 成功`;
});

// ========== 区域二：导入 TXT 并生成文案 ==========

bindDropZone('drop-txt', ['txt'], async (files) => {
  let allText = '';
  let totalLines = 0;
  for (const file of files) {
    const content = await readFileAsText(file);
    allText += (allText ? '\n\n' : '') + content;
    totalLines += content.split('\n').filter(l => l.trim()).length;
  }
  document.getElementById('txt-file-name').textContent = files.map(f => f.name).join(', ');
  document.getElementById('txt-file-status').textContent = `${files.length} 个文件，共 ${totalLines} 行`;
  document.getElementById('txt-file-info').classList.remove('hidden');
  state.subtitleText = allText;
  updateRunButton();
});

document.getElementById('drop-txt').addEventListener('click', async () => {
  const paths = await window.api.selectTxtFile();
  if (paths && paths.length > 0) {
    let allText = '';
    let totalLines = 0;
    for (const p of paths) {
      const result = await window.api.convertSubtitle(p);
      if (result.success) {
        allText += (allText ? '\n\n' : '') + result.text;
        totalLines += result.lineCount;
      }
    }
    const names = paths.map(p => p.split(/[\\/]/).pop());
    document.getElementById('txt-file-name').textContent = names.join(', ');
    document.getElementById('txt-file-status').textContent = `${paths.length} 个文件，共 ${totalLines} 行`;
    document.getElementById('txt-file-info').classList.remove('hidden');
    state.subtitleText = allText;
    updateRunButton();
  }
});

document.getElementById('btn-browse-txt').addEventListener('click', async (e) => {
  e.stopPropagation();
  const paths = await window.api.selectTxtFile();
  if (paths && paths.length > 0) {
    let allText = '';
    let totalLines = 0;
    for (const p of paths) {
      const result = await window.api.convertSubtitle(p);
      if (result.success) {
        allText += (allText ? '\n\n' : '') + result.text;
        totalLines += result.lineCount;
      }
    }
    const names = paths.map(p => p.split(/[\\/]/).pop());
    document.getElementById('txt-file-name').textContent = names.join(', ');
    document.getElementById('txt-file-status').textContent = `${paths.length} 个文件，共 ${totalLines} 行`;
    document.getElementById('txt-file-info').classList.remove('hidden');
    state.subtitleText = allText;
    updateRunButton();
  }
});

['drama-name', 'drama-notes'].forEach(id => {
  document.getElementById(id).addEventListener('input', updateRunButton);
});

function updateRunButton() {
  const btn = document.getElementById('btn-run');
  const dramaName = document.getElementById('drama-name').value.trim();
  btn.disabled = !state.subtitleText || !dramaName || state.isProcessing;
}

// ========== 运行按钮 — 阶段一：生成中文文案 ==========
document.getElementById('btn-run').addEventListener('click', async () => {
  if (state.isProcessing) return;

  const dramaName = document.getElementById('drama-name').value.trim();
  const notes = document.getElementById('drama-notes').value.trim();

  if (!dramaName) {
    alert('请输入剧名');
    return;
  }

  state.isProcessing = true;
  updateRunButton();
  state.chineseScript = null;
  state.englishScript = null;

  document.getElementById('script-panel').classList.add('hidden');
  document.getElementById('english-panel').classList.add('hidden');

  const statusCard = document.getElementById('session-status');
  const statusText = document.getElementById('session-status-text');
  const logBox = document.getElementById('session-log');
  statusCard.classList.remove('hidden');
  logBox.classList.remove('hidden');
  logBox.textContent = '';
  statusText.textContent = 'Claude Code 处理中... (0s)';

  // 计时器：每秒更新，让用户知道没卡死
  const startTime = Date.now();
  const timer = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    statusText.textContent = `Claude Code 处理中... (${elapsed}s)`;
  }, 1000);

  const btn = document.getElementById('btn-run');
  btn.innerHTML = `<svg class="spinner" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" stroke-opacity="0.2"/><path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"/></svg> 处理中...`;

  let skillContent = '';
  if (state.selectedSkill) {
    skillContent = await window.api.getSkillContent(state.selectedSkill);
  }

  const unsubLog = window.api.onSessionLog((msg) => {
    logBox.textContent += msg;
    logBox.scrollTop = logBox.scrollHeight;
  });

  const unsubScript = window.api.onChineseScript((script) => {
    clearInterval(timer);
    state.chineseScript = script;
    document.getElementById('script-edit').value = script;
    document.getElementById('script-panel').classList.remove('hidden');
    document.getElementById('btn-confirm-translate').disabled = false;
    statusText.textContent = '✅ 中文文案已生成，请审阅后确认翻译';
    setTimeout(() => statusCard.classList.add('hidden'), 3000);
  });

  const unsubError = window.api.onSessionError((msg) => {
    clearInterval(timer);
    statusText.textContent = '会话出错：' + msg;
    state.isProcessing = false;
    updateRunButton();
    resetRunButton();
  });

  const unsubClosed = window.api.onSessionClosed((code) => {
    clearInterval(timer);
    if (code !== 0 && !state.chineseScript) {
      statusText.textContent = `会话异常结束（退出码: ${code}）`;
      state.isProcessing = false;
      updateRunButton();
      resetRunButton();
    }
  });

  try {
    await window.api.startScriptGeneration({
      subtitleText: state.subtitleText,
      dramaName,
      notes,
      skillContent,
    });
  } catch (err) {
    statusText.textContent = '启动失败：' + err;
    state.isProcessing = false;
    updateRunButton();
    resetRunButton();
  }

  unsubLog();
  unsubScript();
  unsubError();
  unsubClosed();
  resetRunButton();
  state.isProcessing = false;
  updateRunButton();
});

function resetRunButton() {
  const btn = document.getElementById('btn-run');
  btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg> 确认处理`;
}

// 阶段二：确认并翻译
document.getElementById('btn-confirm-translate').addEventListener('click', async () => {
  if (state.isProcessing) return;

  state.isProcessing = true;
  const btn = document.getElementById('btn-confirm-translate');
  btn.disabled = true;
  btn.innerHTML = `<svg class="spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" stroke-opacity="0.2"/><path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"/></svg> 翻译中...`;

  // 读取用户可能修改过的中文文案
  const editedScript = document.getElementById('script-edit').value.trim();
  const logBox = document.getElementById('session-log');
  document.getElementById('session-status').classList.remove('hidden');
  logBox.classList.remove('hidden');
  logBox.textContent = '';
  document.getElementById('session-status-text').textContent = 'Claude Code 翻译中... (0s)';

  const startTime2 = Date.now();
  const timer2 = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime2) / 1000);
    document.getElementById('session-status-text').textContent = `Claude Code 翻译中... (${elapsed}s)`;
  }, 1000);

  const unsubLog = window.api.onSessionLog((msg) => {
    logBox.textContent += msg;
    logBox.scrollTop = logBox.scrollHeight;
  });

  const unsubEnglish = window.api.onEnglishTranslation((text) => {
    clearInterval(timer2);
    state.englishScript = text;
    document.getElementById('english-output').textContent = text;
    document.getElementById('english-panel').classList.remove('hidden');
    document.getElementById('english-badge').textContent = '翻译完成';
    document.getElementById('session-status-text').textContent = '✅ 英文翻译已完成';
    setTimeout(() => document.getElementById('session-status').classList.add('hidden'), 3000);
  });

  const unsubError = window.api.onSessionError((msg) => {
    clearInterval(timer2);
    document.getElementById('session-status-text').textContent = '翻译出错：' + msg;
  });

  try {
    const result = await window.api.confirmAndTranslate();
    if (!result.success) {
      clearInterval(timer2);
      document.getElementById('session-status-text').textContent = '翻译失败：' + (result.error || `退出码 ${result.code}`);
    }
  } catch (err) {
    clearInterval(timer2);
    document.getElementById('session-status-text').textContent = '翻译失败：' + err;
  }

  unsubLog();
  unsubEnglish();
  unsubError();
  state.isProcessing = false;
  btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 17 9 11 13 15 21 5"/><path d="M3 17h18"/></svg> 确认文案，翻译为英文`;
  btn.disabled = false;
});

// 复制中文文案
document.getElementById('btn-copy-script').addEventListener('click', () => {
  const text = document.getElementById('script-edit').value;
  navigator.clipboard.writeText(text).then(() => showCopied('btn-copy-script'));
});

// 复制英文翻译
document.getElementById('btn-copy-english').addEventListener('click', () => {
  const text = document.getElementById('english-output').textContent;
  navigator.clipboard.writeText(text).then(() => showCopied('btn-copy-english'));
});

// 保存英文翻译
document.getElementById('btn-save-english').addEventListener('click', () => {
  const text = document.getElementById('english-output').textContent;
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `english_${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
});

function showCopied(btnId) {
  const btn = document.getElementById(btnId);
  const orig = btn.innerHTML;
  btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> 已复制!`;
  setTimeout(() => { btn.innerHTML = orig; }, 2000);
}

// ==================== 初始化 ====================
switchStep(1);
checkClaudeInstall();
checkGitInstall();
