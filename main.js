/**
 * Project Packer Main Logic
 * 包含：文件打包、文件还原、UI 交互、历史记录管理
 */

// ================= 全局配置 (Configuration) =================
const CONFIG = {
    // 忽略的目录
    IGNORE_DIRS: [
        '.git', '.svn', '.hg', '.idea', '.vscode', '.settings',
        'node_modules', 'bower_components', 'build', 'dist', 'out', 'target',
        '__pycache__', '.venv', 'venv', 'env', '.pytest_cache',
        '.dart_tool', '.pub-cache', 'bin', 'obj', '.gradle', 'vendor',
        'tmp', 'temp', 'logs', 'coverage', '.next', '.nuxt',
        'ios', 'android'
    ],
    // 忽略的文件后缀
    IGNORE_EXTS: [
        '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp', '.mp4', '.mp3', '.wav',
        '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.zip', '.tar', '.gz', '.7z', '.rar',
        '.exe', '.dll', '.so', '.dylib', '.class', '.jar', '.db', '.sqlite', '.sqlite3',
        '.lock', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', '.DS_Store'
    ]
};

// 全局状态
let globalFiles = [];
let finalOutput = "";
let currentProjectName = "project_context"; // 默认为 generic name

// ================= UI 交互 (UI Interactions) =================

/**
 * 切换打包/还原模式 Tab
 */
function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.section-content').forEach(s => s.classList.remove('active'));
    const btns = document.querySelectorAll('.tab-btn');
    if(tab === 'pack') {
        btns[0].classList.add('active');
        document.getElementById('packSection').classList.add('active');
    } else {
        btns[1].classList.add('active');
        document.getElementById('unpackSection').classList.add('active');
    }
}

// ================= 核心逻辑 A: Packer (打包) =================

// 监听文件夹上传
document.getElementById('fileInput').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    resetUI();
    setStatus('processing', '正在分析文件结构...');
    
    // UI 延迟优化体验
    await new Promise(r => setTimeout(r, 400));
    
    globalFiles = [];

    // 尝试提取项目名
    if (files.length > 0) {
        const firstPath = files[0].webkitRelativePath;
        if (firstPath) {
            currentProjectName = firstPath.split('/')[0];
        }
    }

    // 遍历读取文件
    for (const file of files) {
        const path = file.webkitRelativePath || file.name;
        if (shouldIgnore(path)) continue;

        try {
            const text = await readFileAsText(file);
            globalFiles.push({ file, path, content: text, selected: true });
        } catch (err) { console.warn(`Skipped binary: ${path}`); }
    }

    if (globalFiles.length === 0) {
        setStatus('error', '未找到有效代码文件 (全部被过滤)');
        return;
    }

    renderFileList();
    generateOutput();
});

// 检查文件是否应忽略
function shouldIgnore(path) {
    path = path.replace(/\\/g, '/'); // 标准化路径
    const parts = path.split('/');
    if (parts.some(p => CONFIG.IGNORE_DIRS.includes(p))) return true;
    if (CONFIG.IGNORE_EXTS.some(ext => path.toLowerCase().endsWith(ext))) return true;
    return false;
}

// 渲染文件列表 DOM
function renderFileList() {
    const container = document.getElementById('fileList');
    document.getElementById('fileListContainer').style.display = 'block';
    container.innerHTML = '';

    globalFiles.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = 'file-item';
        const icon = item.path.includes('/') ? '📄' : '📝';
        
        div.innerHTML = `
            <input type="checkbox" id="f_${index}" ${item.selected ? 'checked' : ''}>
            <span style="margin-right:8px; opacity:0.7">${icon}</span>
            <label for="f_${index}" style="cursor:pointer; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                ${item.path}
            </label>
        `;
        div.querySelector('input').addEventListener('change', (e) => {
            globalFiles[index].selected = e.target.checked;
            e.target.checked ? div.classList.remove('ignored') : div.classList.add('ignored');
            generateOutput();
        });
        container.appendChild(div);
    });
}

// 全选/反选逻辑
function toggleAllFiles() {
    const hasUnchecked = globalFiles.some(f => !f.selected);
    globalFiles.forEach(f => f.selected = hasUnchecked);
    renderFileList();
    generateOutput();
}

// 生成最终 Prompt 文本
function generateOutput() {
    const activeFiles = globalFiles.filter(f => f.selected);
    const paths = activeFiles.map(f => f.path);
    
    // 1. 生成树
    let result = "Project Structure:\n" + generateTree(paths) + "\n\n================================================\n\n";
    
    // 2. 拼接文件内容
    activeFiles.forEach(f => {
        const cleanPath = f.path.replace(/\\/g, '/');
        result += `=== File: ${cleanPath} ===\n${f.content}\n\n`;
    });
    finalOutput = result;
    
    // 3. UI 更新
    document.getElementById('dashboard').style.display = 'grid';
    document.getElementById('previewContainer').style.display = 'block';
    
    const previewText = finalOutput.length > 3000 
        ? finalOutput.substring(0, 3000) + "\n... (内容过长，仅显示预览)" 
        : finalOutput;
    document.getElementById('previewArea').innerText = previewText;
    
    // 4. 更新统计
    const tokenEst = Math.ceil(finalOutput.length / 4).toLocaleString();
    animateValue('fileCountVal', 0, activeFiles.length, 500);
    document.getElementById('tokenVal').innerText = `~${tokenEst}`;
    setStatus('success', `✅ 已成功打包 ${activeFiles.length} 个文件`);
}

// ================= 核心逻辑 B: Unpacker (还原) =================

// 读取拖入的 txt 文件
document.getElementById('txtInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) {
        document.getElementById('pasteArea').value = await readFileAsText(file);
        showToast("文件已读取", "success");
    }
});

// 复制防转义 Prompt
function copyPromptHint() {
    // 使用模板字符串保持换行
    const text = `请修改代码，并严格按照 Project Packer 格式输出（包含 Project Structure 和 === File: path === 标记）。

⚠️ 重要格式要求：
1. 请直接输出【纯文本 (Raw Text)】，严禁将代码包裹在 JSON 字符串或对其进行转义处理。
2. 不要将换行符写成 \\n，不要将引号写成 \\"，请保留原始的代码换行和缩进。
3. 确保输出完整，不要省略任何文件内容。`;

    navigator.clipboard.writeText(text);
    showToast("Prompt 已复制！", "success");
}

// 解析文本并下载 Zip
async function unpackToZip() {
    const content = document.getElementById('pasteArea').value;
    if (!content.trim()) { 
        showToast("内容为空，请先粘贴代码", "error"); 
        return;
    }

    const btn = document.querySelector('.large-btn');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<span class="status-icon">⏳</span> 解析中...';
    
    const zip = new JSZip();
    let fileCount = 0;

    // --- Regex 解析 ---
    const markerRegex = /(?:\r?\n|^)=== File: (.*?) ===(?:\r?\n|$)/g;
    let match;
    let matches = [];

    while ((match = markerRegex.exec(content)) !== null) {
        matches.push({
            path: match[1].trim(),
            startIndex: match.index,
            endIndex: match.index + match[0].length
        });
    }

    if (matches.length === 0) {
        alert("未找到有效的文件标记！格式应为：=== File: path/to/file.ext ===");
        btn.innerHTML = originalText;
        return;
    }

    // --- 提取项目名 ---
    let extractedName = "project_unpacked";
    if (matches.length > 0) {
        const firstPath = matches[0].path.replace(/\\/g, '/');
        const parts = firstPath.split('/');
        if (parts.length > 1) {
            extractedName = parts[0]; 
        }
    }

    // --- 遍历构建 Zip ---
    for (let i = 0; i < matches.length; i++) {
        const current = matches[i];
        const next = matches[i + 1];
        const contentStart = current.endIndex;
        const contentEnd = next ? next.startIndex : content.length;
        
        let rawContent = content.substring(contentStart, contentEnd);
        let cleanPath = current.path.replace(/\\/g, '/').replace(/^(\.\/|\/)/, '');

        if (!cleanPath || cleanPath.endsWith('/')) continue;
        
        // 清理首尾空行
        rawContent = rawContent.replace(/^\s*[\r\n]/, '').replace(/[\r\n]\s*$/, '');
        zip.file(cleanPath, rawContent);
        fileCount++;
    }

    if (fileCount > 0) {
        try {
            const blob = await zip.generateAsync({type:"blob"});
            // 使用 Helper 生成统一格式文件名
            const zipFileName = `${extractedName}_${getFormattedTimestamp()}.zip`;
            saveAs(blob, zipFileName);
            showToast(`成功还原 ${fileCount} 个文件`, "success");
        } catch (e) {
            console.error(e);
            showToast("Zip 生成失败: " + e.message, "error");
        }
    } else {
        showToast("未提取到任何有效文件", "error");
    }
    
    btn.innerHTML = originalText;
}

// ================= 工具函数 (Helpers) =================

// [新增] 统一时间戳生成器 (YYYYMMDD_HHMM)
function getFormattedTimestamp() {
    const now = new Date();
    return now.getFullYear() +
           String(now.getMonth() + 1).padStart(2, '0') +
           String(now.getDate()).padStart(2, '0') + "_" +
           String(now.getHours()).padStart(2, '0') +
           String(now.getMinutes()).padStart(2, '0');
}

function resetUI() {
    document.getElementById('dashboard').style.display = 'none';
    document.getElementById('previewContainer').style.display = 'none';
    document.getElementById('fileListContainer').style.display = 'none';
    finalOutput = "";
    const cap = document.getElementById('statusCapsule');
    cap.className = 'status-capsule idle';
    document.getElementById('statusText').innerText = '准备就绪';
}

function setStatus(type, msg) {
    const cap = document.getElementById('statusCapsule');
    const txt = document.getElementById('statusText');
    const icon = cap.querySelector('.status-icon');
    cap.className = 'status-capsule ' + type;
    txt.innerText = msg;
    
    if(type === 'processing') icon.innerText = '⏳';
    else if(type === 'success') icon.innerText = '🎉';
    else if(type === 'error') icon.innerText = '❌';
    else icon.innerText = '✨';
}

function showToast(msg, type = 'normal') {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = type === 'success' ? `<span>✅</span> ${msg}` : (type === 'error' ? `<span>⚠️</span> ${msg}` : msg);
    container.appendChild(el);
    setTimeout(() => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(-20px)';
        setTimeout(() => el.remove(), 300);
    }, 3000);
}

// 数字滚动动画
function animateValue(id, start, end, duration) {
    if (start === end) return;
    const range = end - start;
    let current = start;
    const increment = end > start ? 1 : -1;
    const stepTime = Math.abs(Math.floor(duration / range));
    const obj = document.getElementById(id);
    const timer = setInterval(function() {
        current += increment;
        obj.innerHTML = current;
        if (current == end) clearInterval(timer);
    }, Math.max(stepTime, 20));
}

function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsText(file);
    });
}

function downloadFile() {
    if (!finalOutput) {
        showToast("没有可下载的内容", "error");
        return;
    }
    const blob = new Blob([finalOutput], { type: 'text/plain' });
    // 使用统一 helper 生成文件名
    const fileName = `${currentProjectName}_${getFormattedTimestamp()}.txt`;
    
    saveAs(blob, fileName);
    showToast(`文件下载已开始: ${fileName}`, "success");
    saveHistory();
}

async function copyToClipboard() {
    if (!finalOutput) {
        showToast("没有可复制的内容", "error");
        return;
    }
    try {
        await navigator.clipboard.writeText(finalOutput);
        showToast("已复制到剪贴板！", "success");
        saveHistory();
    } catch (e) { 
        showToast('复制失败，请尝试下载文件', 'error'); 
        console.error(e);
    }
}

// 生成目录树字符串
function generateTree(paths) {
    let tree = {};
    paths.forEach(path => {
        path.replace(/\\/g, '/').split('/').reduce((r, k) => r[k] = r[k] || {}, tree);
    });
    function print(node, prefix = "") {
        let keys = Object.keys(node);
        return keys.map((key, i) => {
            let last = i === keys.length - 1;
            let str = prefix + (last ? "└── " : "├── ") + key + "\n";
            if (Object.keys(node[key]).length) str += print(node[key], prefix + (last ? "    " : "│   "));
            return str;
        }).join('');
    }
    return Object.keys(tree).length ? (paths.length > 1 ? "Root/\n" : "") + print(tree) : "";
}

// ================= Sidebar & README 逻辑 =================

let readmeLoaded = false;
const REPO_README_URL = "./README.md";

async function toggleSidebar() {
    const body = document.body;
    const isOpen = body.classList.contains('sidebar-open');
    if (isOpen) {
        body.classList.remove('sidebar-open');
        document.getElementById('mainContainer').onclick = null;
    } else {
        body.classList.add('sidebar-open');
        setTimeout(() => {
            document.getElementById('mainContainer').onclick = toggleSidebar;
        }, 100);
        if (!readmeLoaded) await fetchAndRenderReadme();
    }
}

async function fetchAndRenderReadme() {
    const contentDiv = document.getElementById('readmeContent');
    try {
        // 添加时间戳防止缓存
        const response = await fetch(REPO_README_URL + '?t=' + Date.now());
        if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
        
        const markdownText = await response.text();
        if (typeof marked !== 'undefined') {
            contentDiv.innerHTML = marked.parse(markdownText);
            readmeLoaded = true;
        } else {
            contentDiv.innerHTML = "<p style='color:red'>Marked.js library not loaded.</p>";
        }
    } catch (error) {
        console.error("README Load Error:", error);
        contentDiv.innerHTML = `
            <div style="text-align:center; padding-top:50px; color:var(--text-secondary)">
                <p>⚠️ 无法加载 README</p>
                <p style="font-size:0.8rem; opacity:0.7">${error.message}</p>
                <button class="btn btn-secondary" onclick="fetchAndRenderReadme()" style="margin:20px auto">重试</button>
            </div>`;
    }
}

// ================= 手动添加额外文件 =================

const extraInput = document.getElementById('extraFileInput');

function triggerAddExtra() { extraInput.click(); }

extraInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    setStatus('processing', '正在追加文件...');
    let addedCount = 0;
    
    for (const file of files) {
        // 虚拟路径处理
        const path = "Extra_Files/" + file.name;
        // 查重删除
        const existIndex = globalFiles.findIndex(f => f.path === path);
        if (existIndex > -1) globalFiles.splice(existIndex, 1);

        try {
            const text = await readFileAsText(file);
            globalFiles.push({ file, path, content: text, selected: true });
            addedCount++;
        } catch (err) { console.warn(`Skipped: ${path}`); }
    }

    if (addedCount > 0) {
        renderFileList();
        generateOutput();
        showToast(`已追加 ${addedCount} 个文件`, "success");
        if (currentProjectName === "project_context" && files.length > 0) {
             currentProjectName = "Mixed_Files";
        }
    }
    extraInput.value = '';
});

// ================= 历史记录管理系统 =================

const MAX_HISTORY = 10;

window.addEventListener('DOMContentLoaded', () => {
    renderHistory();
    const history = getHistory();
    if (history.length > 0) console.log("Welcome back. Last project: " + history[0].name);
});

function getHistory() {
    try { return JSON.parse(localStorage.getItem('packer_history') || '[]'); } 
    catch { return []; }
}

function saveHistory() {
    const history = getHistory();
    const newRecord = {
        name: currentProjectName,
        time: new Date().toLocaleString(),
        count: globalFiles.length,
        tokenEst: document.getElementById('tokenVal').innerText
    };
    
    const existingIndex = history.findIndex(h => h.name === newRecord.name);
    if (existingIndex > -1) history.splice(existingIndex, 1);

    history.unshift(newRecord);
    if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
    localStorage.setItem('packer_history', JSON.stringify(history));
    renderHistory();
}

function renderHistory() {
    const history = getHistory();
    const panel = document.getElementById('historyPanel');
    const list = document.getElementById('historyList');
    
    if (history.length === 0) {
        panel.style.display = 'none';
        return;
    }

    panel.style.display = 'block';
    list.innerHTML = '';
    history.forEach(item => {
        const div = document.createElement('div');
        div.className = 'file-item';
        div.style.justifyContent = 'space-between';
        div.style.cursor = 'default';
        div.innerHTML = `
            <div>
                <span style="color:var(--accent-primary); font-weight:bold;">${item.name}</span>
                <span style="font-size:0.8em; opacity:0.6; margin-left:8px;">${item.time}</span>
            </div>
            <div style="font-size:0.8em; opacity:0.8;">
                ${item.count} Files | ${item.tokenEst} Tokens
            </div>
        `;
        list.appendChild(div);
    });
}

function clearHistory() {
    if(confirm("确定清空所有历史记录吗？")) {
        localStorage.removeItem('packer_history');
        renderHistory();
        showToast("历史记录已清空", "success");
    }
}