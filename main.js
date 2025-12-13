/**
 * Architecture Refactor: Separating logic from view.
 * ProjectProcessor handles core logic (Filtering, Stats, parsing).
 */
class ProjectProcessor {
    constructor() {
        // Refactoring A: Consolidated Configuration
        this.config = {
            REPO_README_URL: "./README.md",
            IGNORE_DIRS: [
                '.git', '.svn', '.hg', '.idea', '.vscode', '.settings',
                'node_modules', 'bower_components', 'build', 'dist', 'out', 'target',
                '__pycache__', '.venv', 'venv', 'env', '.pytest_cache',
                '.dart_tool', '.pub-cache', 'bin', 'obj', '.gradle', 'vendor',
                'tmp', 'temp', 'logs', 'coverage', '.next', '.nuxt',
                'ios', 'android'
            ],
            IGNORE_EXTS: [
                '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp', '.mp4', '.mp3', '.wav',
                '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.zip', '.tar', '.gz', '.7z', '.rar',
                '.exe', '.dll', '.so', '.dylib', '.class', '.jar', '.db', '.sqlite', '.sqlite3',
                '.lock', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', '.DS_Store'
            ],
            // Stability Optimization: Max file size (1MB)
            MAX_FILE_SIZE: 1024 * 1024 
        };
        this.gitIgnoreRules = [];
    }

    // Security Optimization: Improved .gitignore parsing (Fix 1.A)
    parseGitIgnore(content) {
        this.gitIgnoreRules = content.split('\n')
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#'))
            .map(rule => {
                // Determine if it's a directory rule based on trailing slash
                // Logic Fix: Even without trailing slash, it might be a dir, but we mark explicit ones
                const isDir = rule.endsWith('/');
                const clean = rule.replace(/\/$/, '');
                return { rule: clean, isDir }; 
            });
    }

    shouldIgnore(path) {
        path = path.replace(/\\/g, '/');
        const parts = path.split('/');
        const fileName = parts[parts.length - 1];
        // 1. Hardcoded Checks
        if (parts.some(p => this.config.IGNORE_DIRS.includes(p))) return true;
        if (this.config.IGNORE_EXTS.some(ext => fileName.toLowerCase().endsWith(ext))) return true;

        // 2. Advanced GitIgnore Logic (Critical Logic Fix)
        if (this.gitIgnoreRules.length > 0) {
            for (const { rule, isDir } of this.gitIgnoreRules) {
                // If parts array contains the rule, treat it as a directory ignore (e.g. node_modules)
                if (parts.includes(rule)) return true;
                
                // Fix 1: Multi-level path support (Optimization 1)
                if (rule.includes('/')) {
                    const normalizedRule = rule.startsWith('/') ? rule.slice(1) : rule;
                    if (path === normalizedRule || 
                        path.startsWith(normalizedRule + '/') || 
                        path.includes('/' + normalizedRule + '/')) {
                        return true;
                    }
                }

                // File rule: Exact match or simple wildcard
                if (fileName === rule) return true;
                if (rule.startsWith('*') && fileName.endsWith(rule.slice(1))) return true;
            }
        }

        return false;
    }

    // Optimization: Mixed Token Algorithm
    estimateTokens(text) {
        const chinese = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
        const other = text.length - chinese;
        // Chinese ~1.5, English/Code ~0.25 (approx 4 chars/token)
        return Math.ceil(chinese * 1.5 + other * 0.25);
    }

    generateTree(paths) {
        let tree = {};
        paths.forEach(path => {
            path.replace(/\\/g, '/').split('/').reduce((r, k) => r[k] = r[k] || {}, tree);
        });
        const print = (node, prefix = "") => {
            let keys = Object.keys(node);
            return keys.map((key, i) => {
                let last = i === keys.length - 1;
                let str = prefix + (last ? "└── " : "├── ") + key + "\n";
                if (Object.keys(node[key]).length) str += print(node[key], prefix + (last ? "    " : "│   "));
                return str;
            }).join('');
        };
        return Object.keys(tree).length ? (paths.length > 1 ? "Root/\n" : "") + print(tree) : "";
    }
}

// --- GLOBAL STATE & DOM HANDLERS ---
const PROCESSOR = new ProjectProcessor();
const STATE = {
    globalFiles: [],
    finalOutput: "",
    currentProjectName: "code_press_context",
    readmeLoaded: false
};
// Removed global CONFIG, merged into PROCESSOR.config (Fix 2.A)

// Architecture Optimization: Helper to get CSS vars
function getThemeColor(varName) {
    return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
}

document.addEventListener('DOMContentLoaded', () => {
    setupDragAndDrop();
});

// UI/UX Optimization: Drag & Drop Logic
function setupDragAndDrop() {
    const packZone = document.getElementById('packZone');
    const inflateZone = document.getElementById('inflateZone');

    [packZone, inflateZone].forEach(zone => {
        zone.addEventListener('dragover', (e) => {
            e.preventDefault();
            zone.classList.add('drag-active');
        });
        zone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            zone.classList.remove('drag-active');
        });
    });
    // Pack Zone Drop (Folder scanning)
    packZone.addEventListener('drop', async (e) => {
        e.preventDefault();
        packZone.classList.remove('drag-active');
        
        const items = e.dataTransfer.items;
        if (!items) return;

        showLoading(true);
        resetResultsArea();
        
        // Enforce minimum loading time to avoid flash (min 500ms)
        const minWait = new Promise(resolve => setTimeout(resolve, 500));

        try {
            // Identify project name from first item (Refactoring 2.B: Removed redundant try-catch)
            const entries = [];
            for (let i = 0; i < items.length; i++) {
                try {
                    // Check capability first
                    if (typeof items[i].webkitGetAsEntry === 'function') {
                        const ent = items[i].webkitGetAsEntry();
                        if(ent) entries.push(ent);
                    } else if (items[i].kind === 'file') {
                        // Fallback for non-webkit browsers if needed, though mostly using webkit logic here
                        console.warn("webkitGetAsEntry not supported for item", i);
                    }
                } catch(e) { console.warn("Skipping item", e); }
            }

            if (entries.length > 0) {
                STATE.currentProjectName = entries[0].name;
            }

            // Logic Fix: Scan files returns array, we replace STATE only after scan
            STATE.globalFiles = [];
            const scannedFiles = await scanFiles(entries);
            
            await minWait; // Ensure loading showed for at least 500ms

            STATE.globalFiles = scannedFiles;
            if (STATE.globalFiles.length === 0) {
                showToast('未找到有效文件', 'error');
            } else {
                renderFileTree();
                updateCapsuleStats();
            }
        } catch (error) {
            console.error(error);
            showToast('处理出错: ' + error.message, 'error');
        } finally {
            showLoading(false);
        }
    });

    // Inflate Zone Drop (Txt file)
    inflateZone.addEventListener('drop', async (e) => {
        e.preventDefault();
        inflateZone.classList.remove('drag-active');
        
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleInflateUpload(files[0]);
        }
    });
}

// Helper: Recursive File Scanner (Now Pure Function logic)
async function scanFiles(entries, pathPrefix = "") {
    let results = [];
    for (const entry of entries) {
        if (!entry) continue;
        const fullPath = pathPrefix ? `${pathPrefix}/${entry.name}` : entry.name;

        if (entry.isFile) {
            if (PROCESSOR.shouldIgnore(fullPath)) continue;
            try {
                // We need to get the File object from FileEntry
                const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
                // Logic Fix: processSingleFile returns object instead of side-effect
                const processed = await processSingleFile(file, fullPath);
                if (processed) results.push(processed);
            } catch (err) { console.warn(`Error reading ${fullPath}`, err); }
        } else if (entry.isDirectory) {
            if (PROCESSOR.shouldIgnore(fullPath)) continue;
            const dirReader = entry.createReader();
            const childEntries = await new Promise((resolve, reject) => {
                dirReader.readEntries(resolve, reject);
            });
            const childResults = await scanFiles(childEntries, fullPath);
            results = results.concat(childResults);
        }
    }
    return results;
}

async function processSingleFile(file, path) {
    // Stability: OOM Protection for large files
    if (file.size > PROCESSOR.config.MAX_FILE_SIZE) {
        return { 
            file, path, 
            content: `// [WARN] File skipped: size (${(file.size/1024/1024).toFixed(2)}MB) exceeds limit.\n`, 
            selected: true 
        };
    }

    // Security: Check for .gitignore in root
    // Logic Fix: Use "/" detection or simple logic, parse but return null
    if (file.name === '.gitignore') {
        const text = await readFileAsText(file);
        PROCESSOR.parseGitIgnore(text);
        return null; // Don't add .gitignore to output
    }

    try {
        const text = await readFileAsText(file);
        // Logic Fix: Return the object
        return { file, path, content: text, selected: true };
    } catch (err) { 
        console.warn(`Skipped binary or error: ${path}`);
        return null;
    }
}

// Optimization 2.A: Support Encoding Selection
function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = reject;
        const encoding = document.getElementById('encodingSelect') ? document.getElementById('encodingSelect').value : 'UTF-8';
        reader.readAsText(file, encoding);
    });
}

// UI/UX Optimization: Loading Overlay
function showLoading(show) {
    const overlay = document.getElementById('loadingOverlay');
    if (show) overlay.classList.remove('hidden');
    else overlay.classList.add('hidden');
}

function doFlatten() {
    const activeFiles = STATE.globalFiles.filter(f => f.selected);
    if (activeFiles.length === 0) {
        showToast('请至少选择一个文件', 'error');
        return;
    }

    showLoading(true);
    // UI/UX: Force minimum load time to avoid flash
    const minWait = new Promise(r => setTimeout(r, 500));
    // Defer processing to next tick to allow UI update
    setTimeout(async () => {
        const paths = activeFiles.map(f => f.path);
        let result = "Project Structure:\n" + PROCESSOR.generateTree(paths) + "\n\n================================================\n\n";
        
        activeFiles.forEach(f => {
            const cleanPath = f.path.replace(/\\/g, '/');
            result += `=== File: ${cleanPath} ===\n${f.content}\n\n`;
        });
        
        STATE.finalOutput = result;
        
        const previewArea = document.getElementById('previewArea');
        // Stability: Limit preview size
        const previewText = STATE.finalOutput.length > 3000 ?
            STATE.finalOutput.substring(0, 3000) + "\n... (内容过长，仅显示预览)" : STATE.finalOutput;
        
        previewArea.innerText = previewText;

        await minWait; // Wait for minimum time
        
        showToast(`已成功压扁 ${activeFiles.length} 个文件`, 'success');
        showLoading(false);
    }, 50);
}

async function inflateToZip() {
    const content = document.getElementById('pasteArea').value;
    if (!content.trim()) { 
        showToast("内容为空，请先粘贴代码", "error"); 
        return;
    }

    const btn = document.querySelector('#inflateSection .large-btn');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<span class="status-icon">⏳</span> 正在熔铸...';
    // Stability Optimization: Looser Regex
    const markerRegex = /(?:^|\r?\n)[=-]{3,}\s*File:\s*(.*?)\s*[=-]{3,}(?:\r?\n|$)/g;
    const zip = new JSZip();
    let fileCount = 0;
    
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
        alert("未找到有效的文件标记！\n格式应为：=== File: path/to/file.ext ===");
        btn.innerHTML = originalText;
        return;
    }

    let extractedName = "code_restored";
    if (matches.length > 0) {
        const firstPath = matches[0].path.replace(/\\/g, '/');
        const parts = firstPath.split('/');
        if (parts.length > 1) extractedName = parts[0];
    }
    const now = new Date();
    const timeStr = generateTimeStr(now);
    const zipFileName = `${extractedName}_${timeStr}.zip`;

    for (let i = 0; i < matches.length; i++) {
        const current = matches[i];
        const next = matches[i + 1];
        const contentStart = current.endIndex;
        // Determine end of content based on next match start
        const contentEnd = next ? next.startIndex : content.length;
        
        let rawContent = content.substring(contentStart, contentEnd);
        
        // Security Optimization: Sanitize Paths (Fix 1.B: Safer Regex)
        let cleanPath = current.path
            .replace(/\\/g, '/')
            .replace(/^(\.\/|\/)+/, '') // Remove leading ./ or /
            .replace(/(^|[\/\\])\.\.([\/\\]|$)/g, '$1$2');
        // Smart remove .. to prevent traversal

        if (!cleanPath || cleanPath.endsWith('/')) continue;
        // Trim leading newline from the extraction if present
        rawContent = rawContent.replace(/^\s*[\r\n]/, '').replace(/[\r\n]\s*$/, '');
        zip.file(cleanPath, rawContent);
        fileCount++;
    }

    if (fileCount > 0) {
        try {
            const blob = await zip.generateAsync({type:"blob"});
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

function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.section-content').forEach(s => s.classList.remove('active'));
    
    const btns = document.querySelectorAll('.tab-btn');
    if(tab === 'pack') {
        btns[0].classList.add('active');
        document.getElementById('packSection').classList.add('active');
    } else {
        btns[1].classList.add('active');
        document.getElementById('inflateSection').classList.add('active');
    }
}

// Native File Input Handler (Legacy support + Extra files)
document.getElementById('fileInput').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    showLoading(true);
    resetResultsArea(); 
    
    // UI/UX: Min wait time
    const minWait = new Promise(r => setTimeout(r, 500));
    
    STATE.globalFiles = [];

    if (files.length > 0) {
        const firstPath = files[0].webkitRelativePath;
        if (firstPath) {
             STATE.currentProjectName = firstPath.split('/')[0];
        }
    }

    // Pre-scan for .gitignore using simple find (since we can't easily structure native files yet)
    // Fix: Improve logic to find root .gitignore
    const gitIgnoreFile = files.find(f => f.name === '.gitignore' && (f.webkitRelativePath.split('/').length === 2));
    if (gitIgnoreFile) {
        const text = await readFileAsText(gitIgnoreFile);
        PROCESSOR.parseGitIgnore(text);
    }

    const processedList = [];
    for (const file of files) {
        const path = file.webkitRelativePath || file.name;
        if (PROCESSOR.shouldIgnore(path)) continue;
        
        const res = await processSingleFile(file, path);
        if (res) processedList.push(res);
    }

    await minWait;
    STATE.globalFiles = processedList;

    if (STATE.globalFiles.length === 0) {
        showToast('未找到有效代码文件 (全部被过滤)', 'error');
        showLoading(false);
        return;
    }

    renderFileTree();
    updateCapsuleStats(); 
    showLoading(false);
});

document.getElementById('extraFileInput').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    let addedCount = 0;
    for (const file of files) {
        const path = "Extra_Files/" + file.name;
        // Logic fix: Handle return object
        const existIndex = STATE.globalFiles.findIndex(f => f.path === path);
        if (existIndex > -1) STATE.globalFiles.splice(existIndex, 1);

        try {
            const res = await processSingleFile(file, path);
            if (res) {
                STATE.globalFiles.push(res); // Logic: Only here we modify state for extra files
                addedCount++;
            }
        } 
        catch (err) { console.warn(`Skipped: ${path}`); }
    }

    if (addedCount > 0) {
        renderFileTree();
        updateCapsuleStats();
        showToast(`已追加 ${addedCount} 个文件`, "success");
        
        if (STATE.currentProjectName === "code_press_context" && files.length > 0) {
             STATE.currentProjectName = "Mixed_Files";
        }
        resetResultsArea();
    }
    e.target.value = '';
});

function triggerAddExtra() { 
    document.getElementById('extraFileInput').click();
}

// UI/UX: Copy Tree Only feature
async function copyTreeOnly() {
    // UI/UX Optimization 3.A: Check if project loaded first
    if (STATE.globalFiles.length === 0) {
        showToast("请先上传项目", "error");
        return;
    }

    const activeFiles = STATE.globalFiles.filter(f => f.selected);
    if (activeFiles.length === 0) {
        showToast("请至少选择一个文件", "error");
        return;
    }
    const paths = activeFiles.map(f => f.path);
    const treeText = "Project Structure:\n" + PROCESSOR.generateTree(paths);
    try {
        await navigator.clipboard.writeText(treeText);
        showToast("已仅复制目录树", "success");
    } catch (e) {
        console.error(e);
        showToast("复制失败", "error");
    }
}

function renderFileTree() {
    const container = document.getElementById('fileTree');
    container.innerHTML = '';
    const treeRoot = {};
    STATE.globalFiles.forEach((fileItem, index) => {
        const parts = fileItem.path.split('/'); 
        let currentLevel = treeRoot;
        
        parts.forEach((part, i) => {
            if (i === parts.length - 1) {
                currentLevel[part] = { _type: 'file', _index: index, _name: part };
            } else {
                if (!currentLevel[part]) {
                    currentLevel[part] = { _type: 'folder', _name: part, _children: {} };
                }
                currentLevel = currentLevel[part]._children;
             }
        });
    });
    Object.keys(treeRoot).forEach(key => {
        const rootNode = treeRoot[key];
        const rootEl = createTreeNode(rootNode);
        container.appendChild(rootEl);
    });
}

function createTreeNode(node) {
    if (node._type === 'file') {
        const fileData = STATE.globalFiles[node._index];
        const div = document.createElement('div');
        div.className = `tree-leaf ${!fileData.selected ? 'deselected' : ''}`;
        div.innerHTML = `
            <span class="leaf-icon">📄</span>
            <span class="leaf-name">${node._name}</span>
            ${!fileData.selected ? '' : '<span class="status-dot"></span>'}
        `;
        div.onclick = () => toggleFileSelection(node._index, div);
        return div;
    } else {
        const details = document.createElement('details');
        details.className = 'tree-branch';
        details.open = true;
        const summary = document.createElement('summary');
        summary.className = 'tree-summary';
        summary.innerHTML = `<span class="folder-icon">📂</span> ${node._name}`;
        
        details.appendChild(summary);
        
        const childrenContainer = document.createElement('div');
        childrenContainer.className = 'branch-content';
        const childrenKeys = Object.keys(node._children).sort((a, b) => {
            const nodeA = node._children[a];
            const nodeB = node._children[b];
            if (nodeA._type !== nodeB._type) {
                return nodeA._type === 'folder' ? -1 : 1;
            }
            return a.localeCompare(b);
        });
        
        childrenKeys.forEach(key => {
            childrenContainer.appendChild(createTreeNode(node._children[key]));
        });
        details.appendChild(childrenContainer);
        return details;
    }
}

function toggleFileSelection(index, domElement) {
    STATE.globalFiles[index].selected = !STATE.globalFiles[index].selected;
    if (STATE.globalFiles[index].selected) {
        domElement.classList.remove('deselected');
        const dot = domElement.querySelector('.status-dot');
        if(dot) dot.remove();
        domElement.insertAdjacentHTML('beforeend', '<span class="status-dot"></span>');
    } else {
        domElement.classList.add('deselected');
        const dot = domElement.querySelector('.status-dot');
        if(dot) dot.remove();
    }
    
    updateCapsuleStats();
    resetResultsArea();
}

function toggleAllFiles() {
    const hasUnchecked = STATE.globalFiles.some(f => !f.selected);
    STATE.globalFiles.forEach(f => f.selected = hasUnchecked);
    renderFileTree();
    updateCapsuleStats();
    resetResultsArea();
}

function updateCapsuleStats() {
    const activeFiles = STATE.globalFiles.filter(f => f.selected);
    document.getElementById('fileCountVal').innerText = activeFiles.length;
    let totalChars = 0;
    activeFiles.forEach(f => totalChars += f.content.length);
    
    // Stability Optimization: New Token Algorithm
    const tokenEst = PROCESSOR.estimateTokens(activeFiles.map(f => f.content).join(''));
    document.getElementById('tokenVal').innerText = `~${tokenEst.toLocaleString()}`;
}

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
        if (!STATE.readmeLoaded) {
            await fetchAndRenderReadme();
        }
    }
}

async function fetchAndRenderReadme() {
    const contentDiv = document.getElementById('readmeContent');
    try {
        // Refactoring A: Use merged config
        const response = await fetch(PROCESSOR.config.REPO_README_URL + '?t=' + Date.now());
        if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
        
        const markdownText = await response.text();
        // Security Optimization: Use DOMPurify
        if (typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined') {
            const rawHtml = marked.parse(markdownText);
            contentDiv.innerHTML = DOMPurify.sanitize(rawHtml);
            STATE.readmeLoaded = true;
        } else {
            contentDiv.innerHTML = "<p style='color:red'>Marked or DOMPurify not loaded.</p>";
        }
    } catch (error) {
        console.error("README Load Error:", error);
        contentDiv.innerHTML = `
            <div style="text-align:center; padding-top:50px; color:var(--text-secondary)">
                <p>⚠️ 无法加载 README</p>
                <button class="btn btn-secondary" onclick="fetchAndRenderReadme()" style="margin:20px auto">重试</button>
            </div>
        `;
    }
}

// UI/UX Optimization: Explicit File Upload for Inflate
document.getElementById('txtInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    handleInflateUpload(file);
});
async function handleInflateUpload(file) {
    if (file) {
        try {
            const text = await readFileAsText(file);
            document.getElementById('pasteArea').value = text;
            showToast(`已加载文件: ${file.name}`, "success");
        } catch (e) {
            showToast("文件读取失败", "error");
        }
    }
}

function cleanEscapedText() {
    const area = document.getElementById('pasteArea');
    let text = area.value;
    if (!text) { showToast("请先粘贴内容", "error"); return; }
    
    if (text.trim().startsWith('"') && text.trim().endsWith('"')) { 
        text = text.trim().slice(1, -1);
    }
    text = text.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\t/g, '\t').replace(/\\\\/g, '\\');
    area.value = text;
    showToast("格式已修复！", "success");
}

function clearPasteArea() {
    document.getElementById('pasteArea').value = '';
    showToast('内容已清空');
}

function resetResultsArea() {
    STATE.finalOutput = "";
    document.getElementById('previewArea').innerText = "";
}

function showToast(msg, type = 'normal') {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = type === 'success' ?
    `<span>✅</span> ${msg}` : (type === 'error' ? `<span>⚠️</span> ${msg}` : msg);
    
    container.appendChild(el);
    setTimeout(() => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(-20px)';
        setTimeout(() => el.remove(), 300);
    }, 3000);
}

function generateTimeStr(date) {
    return date.getFullYear() +
           String(date.getMonth() + 1).padStart(2, '0') +
           String(date.getDate()).padStart(2, '0') + "_" +
           String(date.getHours()).padStart(2, '0') +
           String(date.getMinutes()).padStart(2, '0');
}

function downloadFile() {
    if (!STATE.finalOutput) {
        showToast("没有可下载的内容", "error");
        return;
    }
    // Stability: Blob is better than large strings
    const blob = new Blob([STATE.finalOutput], { type: 'text/plain;charset=utf-8' });
    const timeStr = generateTimeStr(new Date());
    const fileName = `${STATE.currentProjectName}_${timeStr}.txt`;
    
    saveAs(blob, fileName);
    showToast(`下载开始: ${fileName}`, "success");
}

async function copyToClipboard() {
    if (!STATE.finalOutput) {
        showToast("没有可复制的内容", "error");
        return;
    }

    // Optimization 2.B: UI Feedback for large copy operations
    const btn = document.querySelector('#previewContainer .tool-btn');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<span class="btn-icon">⏳</span>复制中...'; // Feedback

    // Force wait to let UI render the change
    await new Promise(r => setTimeout(r, 100));

    try {
        await navigator.clipboard.writeText(STATE.finalOutput);
        showToast("已复制到剪贴板！", "success");
    } catch (e) { 
        showToast('复制失败，请尝试下载文件', 'error'); 
        console.error(e);
    } finally {
        btn.innerHTML = originalText; // Restore
    }
}

function copyPromptHint() {
    const promptElement = document.getElementById('promptText');
    if (!promptElement) return;
    navigator.clipboard.writeText(promptElement.innerText);
    showToast("Prompt 已复制！", "success");
}