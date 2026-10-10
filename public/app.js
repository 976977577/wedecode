class WedecodeApp {
    constructor() {
        this.currentWorkspaceId = null;
        this.selectedFiles = [];
        this.socket = null;
        this.executionId = null;
        this.isProcessing = false;
        this.fullLogHistory = []; // 存储完整日志历史
        this.processOutputHistory = []; // 存储反编译进程的详细输出
        this.scanPackages = []; // 扫描到的小程序包
        this.selectedScanPackage = null; // 用户选中的扫描包
        
        this.initializeElements();
        this.setupEventListeners();
        this.connectWebSocket();
    }

    initializeElements() {
        this.downloadBtn = document.getElementById('downloadBtn');
        this.viewFullLogBtn = document.getElementById('viewFullLogBtn');
        this.status = document.getElementById('status');
        this.logContent = document.getElementById('logContent');
        this.clearLogBtn = document.getElementById('clearLogBtn');

        // 本机包扫描
        this.scanBtn = document.getElementById('scanBtn');
        this.scanBody = document.getElementById('scanBody');

        // 日志模态框
        this.logModal = document.getElementById('logModal');
        this.closeModal = document.getElementById('closeModal');
        this.fullLogContent = document.getElementById('fullLogContent');
        this.copyLogBtn = document.getElementById('copyLogBtn');

        // 进度显示
        this.progressContainer = document.getElementById('progressContainer');
        this.progressText = document.getElementById('progressText');
        this.progressPercent = document.getElementById('progressPercent');
        this.progressFill = document.getElementById('progressFill');
        this.progressDetails = document.getElementById('progressDetails');
    }



    /**
     * 扫描本机已安装的小程序包
     *
     * 调用 GET /api/scan, 该接口是纯查询: 不弹终端提示、不修改任何文件。
     */
    async handleScan() {
        if (this.isScanning) return;
        this.isScanning = true;
        this.scanBtn.disabled = true;
        this.scanBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 扫描中...';
        this.scanBody.style.display = 'block';
        this.scanBody.innerHTML = '<div style="color:#888;">正在扫描本机小程序缓存，请稍候...</div>';

        try {
            const res = await fetch('/api/scan');
            const data = await res.json();

            if (!res.ok || !data.success) {
                this.renderScanError(data.message || data.error || '扫描失败');
                return;
            }
            this.scanPackages = data.packages || [];
            this.selectedScanPackage = null;
            this.renderScanResult(data);
        } catch (err) {
            this.renderScanError(err.message || String(err));
        } finally {
            this.isScanning = false;
            this.scanBtn.disabled = false;
            this.scanBtn.innerHTML = '<i class="fas fa-radar"></i> 开始扫描';
        }
    }

    renderScanError(message) {
        this.scanBody.innerHTML = `<div class="scan-hint">扫描失败: ${this.escapeHtml(message)}</div>`;
    }

    renderScanResult(data) {
        const packages = this.scanPackages;
        const pathList = data.scannedPathList || [];

        if (!packages.length) {
            // 没扫到时把「为什么」和「怎么办」说清楚, 而不是只丢一个空列表
            const pathsHtml = pathList.length
                ? `<div class="scan-paths">已查找:<br>${pathList.map(p => `<code>${this.escapeHtml(p)}</code>`).join('<br>')}</div>`
                : '';
            this.scanBody.innerHTML = `
                <div class="scan-hint">
                    ${this.escapeHtml(data.hint || '未找到小程序包')}
                    <br><br>
                    小程序包是在用微信打开小程序后才缓存到本地的。如果路径与你的微信版本不符,
                    可以在 GitHub 反馈你的微信版本号与实际缓存路径。
                </div>
                ${pathsHtml}
            `;
            return;
        }

        const items = packages.map((pkg, index) => `
            <li class="scan-list-item" data-scan-index="${index}">
                <div class="scan-item-main">
                    <div class="scan-item-name">${this.escapeHtml(pkg.appName || pkg.appId)}</div>
                    <div class="scan-item-meta">${this.escapeHtml(pkg.description || pkg.storagePath)}</div>
                </div>
                <div class="scan-item-date">${this.escapeHtml(pkg.updateDate)}</div>
            </li>
        `).join('');

        this.scanBody.innerHTML = `
            <div style="color:#666;margin-bottom:8px;">找到 ${packages.length} 个小程序包，点击选中后可反编译:</div>
            <ul class="scan-list" id="scanList">${items}</ul>
            <div class="scan-selected-tip" id="scanSelectedTip" style="display:none;"></div>
        `;

        this.scanBody.querySelectorAll('.scan-list-item').forEach(el => {
            el.addEventListener('click', () => this.selectScanPackage(Number(el.dataset.scanIndex), el));
        });
    }

    selectScanPackage(index, el) {
        const pkg = this.scanPackages[index];
        if (!pkg) return;
        this.selectedScanPackage = pkg;

        this.scanBody.querySelectorAll('.scan-list-item').forEach(n => n.classList.remove('selected'));
        el.classList.add('selected');

        const tip = document.getElementById('scanSelectedTip');
        tip.style.display = 'block';
        tip.innerHTML = `
            <div style="margin-bottom:10px;">
                已选择 <strong>${this.escapeHtml(pkg.appName || pkg.appId)}</strong><br>
                <span style="color:#888;">包目录: ${this.escapeHtml(pkg.storagePath)}</span>
            </div>
            <button type="button" class="scan-btn" id="compileScanBtn">
                <i class="fas fa-play"></i> 反编译此包
            </button>
        `;

        // 按钮每次选中都会重建, 需重新绑定
        const btn = document.getElementById('compileScanBtn');
        btn?.addEventListener('click', () => this.compileSelectedPackage());
    }

    /**
     * 反编译选中的扫描包。
     *
     * 走 compile-folder 接口直接编译本机目录 —— 扫描出的包本来就在磁盘上,
     * 不需要像上传流程那样先传给服务端。
     */
    async compileSelectedPackage() {
        const pkg = this.selectedScanPackage;
        if (!pkg) {
            this.showStatus('请先点击选择一个要反编译的小程序包', 'warning');
            return;
        }
        if (this.isProcessing) return;

        this.isProcessing = true;
        const btn = document.getElementById('compileScanBtn');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 反编译中...';
        }
        this.showStatus('正在启动反编译...', 'info');

        try {
            const workspace = await this.ensureWorkspace();
            const res = await fetch(`/api/workspaces/${workspace.id}/compile-folder`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ folderPath: pkg.storagePath, options: [] })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || '启动失败');
            this.showStatus('反编译已启动, 日志实时显示在下方', 'success');
        } catch (err) {
            const msg = err.message || String(err);
            this.showStatus('反编译失败: ' + msg, 'error');
            this.addLog('反编译启动失败: ' + msg);
        } finally {
            this.isProcessing = false;
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-play"></i> 反编译此包';
            }
        }
    }

    /**
     * 复用或创建工作区(反编译产物按工作区隔离存放)
     */
    async ensureWorkspace() {
        if (this.currentWorkspaceId) return { id: this.currentWorkspaceId };

        const res = await fetch('/api/workspaces', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: '默认工作区',
                type: 'miniapp',
                description: '本机小程序包反编译'
            })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '创建工作区失败');

        const ws = data.workspace || data;
        this.currentWorkspaceId = ws.id;
        return ws;
    }

    escapeHtml(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    setupEventListeners() {
        // 本机包扫描
        this.scanBtn?.addEventListener('click', () => this.handleScan());

        // 工具栏
        this.downloadBtn?.addEventListener('click', () => this.downloadResults());
        this.clearLogBtn?.addEventListener('click', () => this.clearLogs());
        this.viewFullLogBtn?.addEventListener('click', () => this.showFullLogModal());

        // 日志模态框
        this.closeModal?.addEventListener('click', () => this.hideFullLogModal());
        this.copyLogBtn?.addEventListener('click', () => this.copyLogsToClipboard());
        this.logModal?.addEventListener('click', (e) => {
            if (e.target === this.logModal) this.hideFullLogModal();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.logModal?.style.display === 'block') {
                this.hideFullLogModal();
            }
        });
    }

    connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;
        
        this.socket = new WebSocket(wsUrl);
        
        this.socket.onopen = () => {
            this.addLog('WebSocket 连接已建立', 'success');
            
            // 订阅工作区事件 - 使用当前工作区ID或默认ID
            const workspaceId = this.currentWorkspace?.id || 'default';
            this.socket.send(JSON.stringify({
                type: 'subscribe',
                workspaceId: workspaceId
            }));
            console.log('已发送 subscribe 消息，workspaceId:', workspaceId);
        };
        
        this.socket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                console.log('收到 WebSocket 消息:', data); // 添加调试日志
                this.handleWebSocketMessage(data);
            } catch (error) {
                console.error('WebSocket 消息解析错误:', error);
            }
        };
        
        this.socket.onclose = () => {
            this.addLog('WebSocket 连接已断开', 'warning');
            // 尝试重连
            setTimeout(() => {
                this.connectWebSocket();
            }, 3000);
        };
        
        this.socket.onerror = (error) => {
            this.addLog('WebSocket 连接错误', 'error');
            console.error('WebSocket error:', error);
        };
    }

    handleWebSocketMessage(data) {
        if (data.type === 'execution' && data.executionId === this.executionId) {
            if (data.event === 'output') {
                // 处理不同类型的输出
                const output = data.data.trim();
                if (output) {
                    // 添加到反编译进程输出历史（用于完整日志显示）
                    this.processOutputHistory.push({
                        timestamp: new Date().toLocaleString(),
                        content: output,
                        type: 'output'
                    });
                    
                    // 根据输出内容判断日志类型
                    let logType = 'info';
                    // 只有明确的错误信息才标记为error，避免误判文件名中包含error的情况
                    if (output.includes('❌') || output.includes('错误:') || output.includes('Error:') || 
                        output.includes('失败') || output.includes('异常') || output.includes('Exception')) {
                        logType = 'error';
                    } else if (output.includes('⚠️') || output.includes('警告:') || output.includes('Warning:')) {
                        logType = 'warning';
                    } else if (output.includes('✅') || output.includes('🎉') || output.includes('成功') || 
                               output.includes('完成') || output.includes('Success') || output.includes('Completed')) {
                        logType = 'success';
                    }
                    
                    this.addLog(output, logType);
                }
            } else if (data.event === 'error') {
                // 添加到反编译进程输出历史
                this.processOutputHistory.push({
                    timestamp: new Date().toLocaleString(),
                    content: data.data,
                    type: 'error'
                });
                
                this.addLog(data.data, 'error');
            } else if (data.event === 'exit') {
                console.log('收到 exit 事件，退出码:', data.code); // 添加调试日志
                
                this.isProcessing = false;
                this.executionId = null;
                
                if (data.code === 0) {
                    this.addLog('🎉 反编译完成！', 'success');
                    this.showStatus('反编译成功完成', 'success');
                    this.downloadBtn.disabled = false;
                } else {
                    this.addLog(`❌ 反编译失败，退出码: ${data.code}`, 'error');
                    this.showStatus('反编译失败', 'error');
                }
            }
        }
    }





    async createWorkspace() {
        const response = await fetch('/api/workspaces', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: `反编译_${new Date().toISOString().slice(0, 19).replace(/[:-]/g, '')}`,
                type: 'miniapp',
                description: '微信小程序反编译工作区'
            })
        });

        if (!response.ok) {
            throw new Error('创建工作区失败');
        }

        return await response.json();
    }

    async downloadResults() {
        if (!this.currentWorkspaceId) {
            this.showStatus('没有可下载的结果', 'error');
            return;
        }

        this.addLog('📦 正在打包下载文件...', 'info');
        this.showStatus('正在准备下载...', 'processing');

        try {
            const response = await fetch(`/api/workspaces/${this.currentWorkspaceId}/download`, {
                method: 'GET'
            });

            if (!response.ok) {
                if (response.status === 404) {
                    throw new Error('未找到反编译结果，请先完成反编译');
                }
                throw new Error('下载失败');
            }

            // 从响应头中获取文件名
            let filename = `反编译结果_${new Date().toISOString().slice(0, 10)}.zip`; // 默认文件名
            const contentDisposition = response.headers.get('Content-Disposition');
            
            // 调试日志
            console.log('🔍 [下载调试] Content-Disposition响应头:', contentDisposition);
            console.log('🔍 [下载调试] 默认文件名:', filename);
            
            if (contentDisposition) {
                const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
                console.log('🔍 [下载调试] 文件名匹配结果:', filenameMatch);
                if (filenameMatch && filenameMatch[1]) {
                    // 移除引号并解码
                    const rawFilename = filenameMatch[1].replace(/['"]/g, '');
                    filename = decodeURIComponent(rawFilename);
                    console.log('🔍 [下载调试] 原始文件名:', rawFilename);
                    console.log('🔍 [下载调试] 解码后文件名:', filename);
                }
            } else {
                console.log('� [下载调试] 未找到Content-Disposition响应头，使用默认文件名');
            }

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);

            this.addLog(`✅ 下载完成！文件名: ${filename}`, 'success');
            this.showStatus('下载完成', 'success');

        } catch (error) {
            this.addLog(`❌ 下载失败: ${error.message}`, 'error');
            this.showStatus('下载失败', 'error');
        }
    }

    addLog(message, type = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        const fullTimestamp = new Date().toLocaleString();
        const logLine = document.createElement('div');
        logLine.className = `log-line ${type}`;
        logLine.textContent = `[${timestamp}] ${message}`;
        
        // 添加到显示区域
        this.logContent.appendChild(logLine);
        this.logContent.scrollTop = this.logContent.scrollHeight;
        
        // 添加到完整日志历史
        this.fullLogHistory.push({
            timestamp: fullTimestamp,
            message: message,
            type: type
        });
        
        // 启用查看完整日志按钮
        if (this.viewFullLogBtn) {
            this.viewFullLogBtn.disabled = false;
        }
    }

    clearLogs() {
        this.logContent.innerHTML = '';
        this.fullLogHistory = [];
        this.processOutputHistory = []; // 同时清空反编译进程输出历史
        
        // 禁用查看完整日志按钮
        if (this.viewFullLogBtn) {
            this.viewFullLogBtn.disabled = true;
        }
    }

    showStatus(message, type) {
        this.status.textContent = message;
        this.status.className = `status ${type}`;
        this.status.classList.remove('hidden');

        // 清除之前的 spinner
        const existingSpinner = this.status.querySelector('.spinner');
        if (existingSpinner) {
            existingSpinner.remove();
        }

        if (type === 'processing') {
            const spinner = document.createElement('span');
            spinner.className = 'spinner';
            spinner.style.marginRight = '10px';
            this.status.insertBefore(spinner, this.status.firstChild);
        }
    }

    showProgress(current, total, text = '上传进度', details = '') {
        const percent = Math.round((current / total) * 100);
        
        this.progressContainer.classList.remove('hidden');
        this.progressText.textContent = text;
        this.progressPercent.textContent = `${percent}%`;
        this.progressFill.style.width = `${percent}%`;
        
        if (details) {
            this.progressDetails.textContent = details;
        }
    }

    hideProgress() {
        this.progressContainer.classList.add('hidden');
        this.progressFill.style.width = '0%';
        this.progressPercent.textContent = '0%';
        this.progressDetails.textContent = '';
    }

    showFullLogModal() {
        // 生成完整日志内容 - 显示反编译进程的详细输出
        let logText = '';
        if (this.processOutputHistory.length === 0) {
            logText = '暂无反编译进程日志内容\n\n如果您看到此消息，说明反编译进程尚未开始或没有产生输出。';
        } else {
            logText = this.processOutputHistory.map(log => {
                const typePrefix = log.type === 'error' ? '❌ [错误] ' : '';
                return `${typePrefix}${log.content}`;
            }).join('\n');
        }
        
        this.fullLogContent.textContent = logText;
        this.logModal.style.display = 'block';
        
        // 滚动到底部
        setTimeout(() => {
            this.fullLogContent.scrollTop = this.fullLogContent.scrollHeight;
        }, 100);
    }

    hideFullLogModal() {
        this.logModal.style.display = 'none';
    }

    async copyLogsToClipboard() {
        try {
            // 获取当前显示的日志内容
            const logText = this.fullLogContent.textContent;
            
            // 使用现代的 Clipboard API
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(logText);
            } else {
                // 降级方案：使用传统的 document.execCommand
                const textArea = document.createElement('textarea');
                textArea.value = logText;
                textArea.style.position = 'fixed';
                textArea.style.left = '-999999px';
                textArea.style.top = '-999999px';
                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
            }
            
            // 显示成功提示
            this.showCopySuccess();
        } catch (err) {
            console.error('复制失败:', err);
            this.showCopyError();
        }
    }

    showCopySuccess() {
        const originalText = this.copyLogBtn.innerHTML;
        this.copyLogBtn.innerHTML = '<i class="fas fa-check"></i> 已复制';
        this.copyLogBtn.style.background = '#28a745';
        
        setTimeout(() => {
            this.copyLogBtn.innerHTML = originalText;
            this.copyLogBtn.style.background = '';
        }, 2000);
    }

    showCopyError() {
        const originalText = this.copyLogBtn.innerHTML;
        this.copyLogBtn.innerHTML = '<i class="fas fa-times"></i> 复制失败';
        this.copyLogBtn.style.background = '#dc3545';
        
        setTimeout(() => {
            this.copyLogBtn.innerHTML = originalText;
            this.copyLogBtn.style.background = '';
        }, 2000);
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }



    /**
     * 跨平台路径分割函数
     */
}

// 初始化应用
document.addEventListener('DOMContentLoaded', () => {
    new WedecodeApp();
});
