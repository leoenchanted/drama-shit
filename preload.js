const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // 窗口控制
  winMinimize: () => ipcRenderer.invoke('win-minimize'),
  winMaximize: () => ipcRenderer.invoke('win-maximize'),
  winClose: () => ipcRenderer.invoke('win-close'),
  winIsMaximized: () => ipcRenderer.invoke('win-is-maximized'),
  onWinStateChanged: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('win-state-changed', handler);
    return () => ipcRenderer.removeListener('win-state-changed', handler);
  },

  // Claude Code 环境检测
  checkClaude: () => ipcRenderer.invoke('check-claude'),
  checkDramaSkill: () => ipcRenderer.invoke('check-drama-skill'),

  // Git Bash 环境检测 & 安装
  checkGit: () => ipcRenderer.invoke('check-git'),
  installGit: () => ipcRenderer.invoke('install-git'),

  // 安装 Claude Code（进度通过回调推送）
  installClaude: () => ipcRenderer.invoke('install-claude'),
  onInstallProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('install-progress', handler);
    return () => ipcRenderer.removeListener('install-progress', handler);
  },

  // 配置读写
  loadConfig: () => ipcRenderer.invoke('load-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),

  // 文件选择
  selectFile: () => ipcRenderer.invoke('select-file'),
  selectTxtFile: () => ipcRenderer.invoke('select-txt-file'),

  // 字幕转换
  convertSubtitle: (filePath) => ipcRenderer.invoke('convert-subtitle', filePath),

  // 两阶段脚本生成 & 翻译
  startScriptGeneration: (params) => ipcRenderer.invoke('start-script-generation', params),
  confirmAndTranslate: (chineseScript) => ipcRenderer.invoke('confirm-and-translate', chineseScript),
  cancelSession: () => ipcRenderer.invoke('cancel-session'),
  onChineseScript: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('chinese-script', handler);
    return () => ipcRenderer.removeListener('chinese-script', handler);
  },
  onEnglishTranslation: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('english-translation', handler);
    return () => ipcRenderer.removeListener('english-translation', handler);
  },
  onSessionClosed: (callback) => {
    const handler = (_event, code) => callback(code);
    ipcRenderer.on('session-closed', handler);
    return () => ipcRenderer.removeListener('session-closed', handler);
  },
  onSessionError: (callback) => {
    const handler = (_event, msg) => callback(msg);
    ipcRenderer.on('session-error', handler);
    return () => ipcRenderer.removeListener('session-error', handler);
  },
  onSessionLog: (callback) => {
    const handler = (_event, msg) => callback(msg);
    ipcRenderer.on('session-log', handler);
    return () => ipcRenderer.removeListener('session-log', handler);
  },
});
