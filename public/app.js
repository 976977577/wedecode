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
        this.uploadArea = document.getElementById('uploadArea');
        this.multiFileInput = document.getElementById('multiFileInput');
        this.folderInput = document.getElementById('folderInput');
        this.uploadText = document.getElementById('uploadText');
        this.uploadHint = document.getElementById('uploadHint');
        this.uploadBtn = document.getElementById('uploadBtn');
        this.downloadBtn = document.getElementById('downloadBtn');
        this.viewFullLogBtn = document.getElementById('viewFullLogBtn');
        this.status = document.getElementById('status');
        this.logContent = document.getElementById('logContent');
        this.clearLogBtn = document.getElementById('clearLogBtn');

        // 本机包扫描元素
        this.scanBtn = document.getElementById('scanBtn');
        this.scanBody = document.getElementById('scanBody');
        
        // 配置选项元素
        this.wxidInput = document.getElementById('wxidInput');
        this.usePx = document.getElementById('usePx');
        this.unpackOnly = document.getElementById('unpackOnly');
        
        // 模态框元素
        this.logModal = document.getElementById('logModal');
        this.closeModal = document.getElementById('closeModal');
        this.fullLogContent = document.getElementById('fullLogContent');
        this.copyLogBtn = document.getElementById('copyLogBtn');
        
        // 文件夹编译相关元素
        this.folderCompileBtn = document.getElementById('folderCompileBtn');
        this.folderCompileModal = document.getElementById('folderCompileModal');
        this.closeFolderModal = document.getElementById('closeFolderModal');
        this.folderPath = document.getElementById('folderPath');
        this.folderUsePx = document.getElementById('folderUsePx');
        this.folderUnpackOnly = document.getElementById('folderUnpackOnly');
        this.startFolderCompile = document.getElementById('startFolderCompile');
        this.cancelFolderCompile = document.getElementById('cancelFolderCompile');
        
        // 进度显示元素
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
            <div style="color:#666;margin-bottom:8px;">找到 ${packages.length} 个小程序包，点击可查看路径:</div>
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
        tip.innerHTML = `已选择 <strong>${this.escapeHtml(pkg.appName || pkg.appId)}</strong><br>
            <span style="color:#888;">包目录: ${this.escapeHtml(pkg.storagePath)}</span>`;
    }

    escapeHtml(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    setupEventListeners() {
        // 本机包扫描按钮
        this.scanBtn?.addEventListener('click', () => this.handleScan());

        // 文件上传区域事件
        this.uploadArea.addEventListener('click', () => {
            if (!this.isProcessing) {
                this.showFileSelectionOptions();
            }
        });

        this.uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (!this.isProcessing) {
                this.uploadArea.classList.add('dragover');
            }
        });

        this.uploadArea.addEventListener('dragleave', () => {
            this.uploadArea.classList.remove('dragover');
        });

        this.uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            this.uploadArea.classList.remove('dragover');
            if (!this.isProcessing && e.dataTransfer.files.length > 0) {
                // 传递 DataTransferItems 以支持文件夹拖拽
                this.handleDroppedFiles(e.dataTransfer.files, e.dataTransfer.items);
            }
        });

        // 多文件选择事件
        this.multiFileInput.addEventListener('change', (e) => {
            console.log('多文件选择事件触发，文件数量:', e.target.files ? e.target.files.length : 0);
            
            if (e.target.files && e.target.files.length > 0 && !this.isProcessing) {
                this.handleMultiFileSelect(e.target.files);
            }
        });

        // 按钮事件
        this.uploadBtn.addEventListener('click', () => {
            this.uploadAndDecompile();
        });

        this.downloadBtn.addEventListener('click', () => {
            this.downloadResults();
        });

        this.clearLogBtn.addEventListener('click', () => {
            this.clearLogs();
        });

        // 查看完整日志按钮事件
        this.viewFullLogBtn.addEventListener('click', () => {
            this.showFullLogModal();
        });

        // 模态框关闭事件
        this.closeModal.addEventListener('click', () => {
            this.hideFullLogModal();
        });

        // 复制日志按钮事件
        this.copyLogBtn.addEventListener('click', () => {
            this.copyLogsToClipboard();
        });

        // 点击模态框背景关闭
        this.logModal.addEventListener('click', (e) => {
            if (e.target === this.logModal) {
                this.hideFullLogModal();
            }
        });

        // ESC键关闭模态框
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.logModal.style.display === 'block') {
                this.hideFullLogModal();
            }
        });





        // 文件夹选择事件
        this.folderInput.addEventListener('change', (e) => {
            console.log('文件夹选择事件触发，文件数量:', e.target.files ? e.target.files.length : 0);
            
            if (e.target.files && e.target.files.length > 0 && !this.isProcessing) {
                this.handleFolderSelect(e.target.files);
            }
        });

        // 文件夹编译相关事件
        this.folderCompileBtn.addEventListener('click', () => {
            this.showFolderCompileModal();
        });

        this.closeFolderModal.addEventListener('click', () => {
            this.hideFolderCompileModal();
        });

        this.cancelFolderCompile.addEventListener('click', () => {
            this.hideFolderCompileModal();
        });

        this.startFolderCompile.addEventListener('click', () => {
            this.startFolderCompilation();
        });

        // 点击文件夹编译模态框背景关闭
        this.folderCompileModal.addEventListener('click', (e) => {
            if (e.target === this.folderCompileModal) {
                this.hideFolderCompileModal();
            }
        });

        // ESC键关闭文件夹编译模态框
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.folderCompileModal.style.display === 'block') {
                this.hideFolderCompileModal();
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
                
                this.uploadBtn.disabled = false;
                this.uploadBtn.innerHTML = '<i class="fas fa-play"></i> 开始反编译';
            }
        }
    }



    handleMultiFileSelect(files) {
        console.log('多文件选择开始，文件数量:', files ? files.length : 0);
        
        // 清空之前的状态
        this.clearLogs();
        this.closeFileSelectionModal();
        
        if (!files || files.length === 0) {
            this.addLog('❌ 错误: 未选择任何文件', 'error');
            return;
        }

        // 转换为数组并过滤 .wxapkg 文件
        const fileArray = Array.from(files);
        const wxapkgFiles = fileArray.filter(file => 
            file.name.toLowerCase().endsWith('.wxapkg')
        );

        if (wxapkgFiles.length === 0) {
            this.addLog('❌ 错误: 选择的文件中没有找到 .wxapkg 文件', 'error');
            return;
        }

        // 更新选择的文件（先复制后再清空 input）
        this.selectedFiles = wxapkgFiles;
        // 现在可以安全地清空 input 值，避免影响 FileList
        this.multiFileInput.value = '';
        
        // 启用上传按钮
        this.uploadBtn.disabled = false;
        this.downloadBtn.disabled = true;

        // 显示成功信息
        this.addLog(`✅ 成功选择 ${wxapkgFiles.length} 个 .wxapkg 文件`, 'success');
        wxapkgFiles.forEach((file, index) => {
            this.addLog(`📄 文件 ${index + 1}: ${file.name} (${this.formatFileSize(file.size)})`, 'info');
        });
        

        
        console.log('多文件选择完成，有效文件数:', wxapkgFiles.length);
    }

    getDecompileOptions() {
        // 返回对象格式，匹配后端期望的格式
        const wxidValue = this.wxidInput ? this.wxidInput.value.trim() : '';
        const options = {
            clear: true, // 固定设置：清空旧产物为 true
            px: this.usePx.checked,
            unpackOnly: this.unpackOnly.checked,
            wxid: wxidValue || null
        };
        
        // 控制台打印配置参数
        console.log('🔧 传给 wedecode 的配置参数:', options);
        console.log('📋 配置详情:');
        console.log('  - 清空旧产物 (clear):', options.clear);
        console.log('  - 使用px单位 (px):', options.px);
        console.log('  - 仅解包模式 (unpackOnly):', options.unpackOnly);
        console.log('  - WXID:', options.wxid || '(未设置)');
        
        return options;
    }

    checkFileSizes() {
        const maxFileSize = 500 * 1024 * 1024; // 500MB
        const maxTotalSize = 2 * 1024 * 1024 * 1024; // 2GB
        const maxFileCount = 200;

        let totalSize = 0;
        let fileCount = 0;
        let largeFiles = [];

        // 检查选中的文件
        const filesToCheck = this.selectedFiles && this.selectedFiles.length > 0 
            ? this.selectedFiles 
            : (this.selectedFile ? [this.selectedFile] : []);

        for (const file of filesToCheck) {
            fileCount++;
            totalSize += file.size;

            if (file.size > maxFileSize) {
                largeFiles.push({
                    name: file.name,
                    size: this.formatFileSize(file.size)
                });
            }
        }

        // 检查文件数量
        if (fileCount > maxFileCount) {
            return {
                valid: false,
                message: `文件数量超过限制，最多只能上传 ${maxFileCount} 个文件，当前选择了 ${fileCount} 个文件`
            };
        }

        // 检查单个文件大小
        if (largeFiles.length > 0) {
            const fileList = largeFiles.map(f => `${f.name} (${f.size})`).join(', ');
            return {
                valid: false,
                message: `以下文件超过 500MB 限制: ${fileList}`
            };
        }

        // 检查总大小
        if (totalSize > maxTotalSize) {
            return {
                valid: false,
                message: `文件总大小超过限制，最大允许 2GB，当前总大小: ${this.formatFileSize(totalSize)}`
            };
        }

        return {
            valid: true,
            message: `文件检查通过，共 ${fileCount} 个文件，总大小: ${this.formatFileSize(totalSize)}`
        };
    }

    async uploadAndDecompile() {
        // 检查是否有选择的文件或文件夹
        if (this.selectedFiles && this.selectedFiles.length > 0) {
            // 文件夹模式：有多个文件
        } else if (this.selectedFile) {
            // 单文件模式
        } else {
            this.showStatus('请先选择 wxapkg 文件或包含 wxapkg 文件的文件夹', 'error');
            return;
        }



        if (this.isProcessing) {
            this.showStatus('正在处理中，请稍候...', 'warning');
            return;
        }

        this.isProcessing = true;
        this.uploadBtn.disabled = true;
        this.downloadBtn.disabled = true;
        this.uploadBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 处理中...';
        
        // 清空历史日志
        this.clearLogs();
        
        this.showStatus('正在上传并反编译...', 'processing');
        this.addLog('🚀 开始反编译流程...', 'info');

        try {
            // 检查文件大小
            const sizeCheck = this.checkFileSizes();
            if (!sizeCheck.valid) {
                throw new Error(sizeCheck.message);
            }

            // 创建工作区
            const workspace = await this.createWorkspace();
            this.currentWorkspaceId = workspace.id;
            this.currentWorkspace = workspace;
            this.addLog(`✅ 创建工作区: ${workspace.name}`, 'success');
            
            // 重新订阅新的工作区ID
            if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                this.socket.send(JSON.stringify({
                    type: 'subscribe',
                    workspaceId: workspace.id
                }));
                console.log('重新订阅工作区:', workspace.id);
            }

            // 获取配置选项
            const options = this.getDecompileOptions();
            const optionsText = [];
            if (options.clear) optionsText.push('清理输出目录');
            if (options.px) optionsText.push('转换为px');
            if (options.unpackOnly) optionsText.push('仅解包');

            this.addLog(`⚙️ 反编译选项: ${optionsText.length > 0 ? optionsText.join(', ') : '默认配置'}`, 'info');

            // 判断是否需要分批上传
            if (this.selectedFiles && this.selectedFiles.length > 0) {
                // 多文件模式：检查是否需要分批上传
                await this.uploadMultipleFiles(this.selectedFiles, options);
            } else {
                // 单文件模式：直接上传，显示详细进度
                await this.uploadSingleFile(this.selectedFile, options, true);
            }

        } catch (error) {
            this.isProcessing = false;
            this.addLog(`❌ 错误: ${error.message}`, 'error');
            this.showStatus('上传失败', 'error');
            this.uploadBtn.disabled = false;
            this.uploadBtn.innerHTML = '<i class="fas fa-play"></i> 开始反编译';
        }
    }

    async uploadFileOnly(file, options) {
        const formData = new FormData();
        formData.append('wxapkg', file);
        formData.append('options', JSON.stringify(options));
        
        this.addLog(`📤 正在上传文件 ${file.name} (${this.formatFileSize(file.size)})...`, 'info');

        const response = await fetch(`/api/workspaces/${this.currentWorkspaceId}/decompile`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            if (response.status === 413) {
                // 处理文件大小超限错误
                try {
                    const errorData = await response.json();
                    throw new Error(errorData.message || '文件大小超过限制');
                } catch (parseError) {
                    throw new Error('文件大小超过限制，请确保单个文件不超过500MB，总大小不超过2GB，文件数量不超过200个');
                }
            } else {
                throw new Error(`上传失败: ${response.statusText}`);
            }
        }

        const result = await response.json();
        this.addLog(`✅ 文件 ${file.name} 上传成功`, 'success');
        
        return {
            file: file,
            executionId: result.executionId,
            result: result
        };
    }

    async decompileFile(uploadResult) {
        const { file, executionId } = uploadResult;
        
        if (!executionId) {
            throw new Error('未能获取执行ID');
        }
        
        this.addLog(`🔄 开始反编译 ${file.name}...`, 'info');
        
        // 等待反编译完成的信号
        return new Promise((resolve, reject) => {
            const originalHandler = this.handleWebSocketMessage.bind(this);
            this.handleWebSocketMessage = (data) => {
                originalHandler(data);
                
                if (data.type === 'execution' && data.executionId === executionId) {
                    if (data.event === 'exit') {
                        if (data.code === 0) {
                            this.addLog(`🎉 ${file.name} 反编译完成！`, 'success');
                            resolve(uploadResult);
                        } else {
                            reject(new Error(`${file.name} 反编译失败，退出码: ${data.code}`));
                        }
                    } else if (data.event === 'error') {
                        reject(new Error(`${file.name} 反编译错误: ${data.data}`));
                    }
                }
            };
        });
    }

    async uploadSingleFile(file, options, showIndividualProgress = false) {
        const formData = new FormData();
        formData.append('wxapkg', file);
        formData.append('options', JSON.stringify(options));
        
        // 如果需要显示单个文件进度，则显示进度条
        if (showIndividualProgress) {
            this.showProgress(0, 100, '文件处理', `正在上传 ${file.name}...`);
        }
        
        this.addLog(`📤 正在上传文件 ${file.name} (${this.formatFileSize(file.size)})...`, 'info');

        // 模拟上传进度
        if (showIndividualProgress) {
            this.showProgress(30, 100, '文件处理', `正在上传 ${file.name}...`);
        }

        const response = await fetch(`/api/workspaces/${this.currentWorkspaceId}/decompile`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            if (showIndividualProgress) {
                this.hideProgress();
            }
            if (response.status === 413) {
                // 处理文件大小超限错误
                try {
                    const errorData = await response.json();
                    throw new Error(errorData.message || '文件大小超过限制');
                } catch (parseError) {
                    throw new Error('文件大小超过限制，请确保单个文件不超过500MB，总大小不超过2GB，文件数量不超过200个');
                }
            } else {
                throw new Error(`上传失败: ${response.statusText}`);
            }
        }

        const result = await response.json();
        
        if (showIndividualProgress) {
            this.showProgress(60, 100, '文件处理', `${file.name} 上传完成，开始反编译...`);
        }
        
        this.addLog(`✅ 文件 ${file.name} 上传成功，开始反编译...`, 'success');
        
        if (result.executionId) {
            this.executionId = result.executionId;
            
            if (showIndividualProgress) {
                this.showProgress(80, 100, '文件处理', `${file.name} 反编译进程已启动...`);
            }
            
            this.addLog(`🔄 ${file.name} 反编译进程已启动，正在处理...`, 'info');
            this.showStatus('正在反编译，请查看日志...', 'processing');
            
            // 等待反编译完成的信号
            return new Promise((resolve, reject) => {
                const originalHandler = this.handleWebSocketMessage.bind(this);
                this.handleWebSocketMessage = (data) => {
                    originalHandler(data);
                    
                    if (data.type === 'execution' && data.executionId === result.executionId) {
                        if (data.event === 'exit') {
                            if (showIndividualProgress) {
                                this.showProgress(100, 100, '文件处理', `${file.name} 处理完成`);
                                setTimeout(() => this.hideProgress(), 1000);
                            }
                            
                            if (data.code === 0) {
                                this.addLog(`🎉 ${file.name} 反编译完成！`, 'success');
                                resolve(result);
                            } else {
                                reject(new Error(`反编译失败，退出码: ${data.code}`));
                            }
                        } else if (data.event === 'error') {
                            if (showIndividualProgress) {
                                this.hideProgress();
                            }
                            reject(new Error(`反编译错误: ${data.data}`));
                        }
                    }
                };
            });
        } else {
            if (showIndividualProgress) {
                this.hideProgress();
            }
            throw new Error('未能启动反编译进程');
        }
    }

    async uploadMultipleFiles(files, options) {
        this.showProgress(0, files.length, '文件上传', `准备上传 ${files.length} 个文件...`);
        
        let uploadResults = [];
        let uploadFailedFiles = [];
        
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const currentProgress = i + 1;
            
            this.showProgress(i, files.length, '文件上传', `正在上传 ${file.name} (${currentProgress}/${files.length})`);
            
            try {
                const uploadResult = await this.uploadFileOnly(file, options);
                uploadResults.push(uploadResult);
                this.addLog(`✅ ${file.name} 上传成功 (${currentProgress}/${files.length})`, 'success');
            } catch (error) {
                uploadFailedFiles.push({ name: file.name, error: error.message });
                this.addLog(`❌ ${file.name} 上传失败: ${error.message}`, 'error');
            }
            
            // 文件之间稍微延迟，避免服务器压力过大
            if (i < files.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
        
        this.showProgress(files.length, files.length, '文件上传', `上传阶段完成 (${uploadResults.length}/${files.length})`);
        
        // 上传阶段总结
        if (uploadFailedFiles.length === 0) {
            this.addLog(`🎉 所有 ${files.length} 个文件上传完成！`, 'success');
        } else {
            this.addLog(`⚠️ 上传完成：成功 ${uploadResults.length} 个，失败 ${uploadFailedFiles.length} 个`, 'warning');
            uploadFailedFiles.forEach(failed => {
                this.addLog(`❌ 上传失败 ${failed.name}: ${failed.error}`, 'error');
            });
        }
        
        // 如果没有成功上传的文件，直接结束
        if (uploadResults.length === 0) {
            this.hideProgress();
            this.showStatus('所有文件上传失败', 'error');
            return;
        }
        
        // 第二阶段：批量反编译所有已上传的文件
        this.addLog(`🔄 阶段2：开始批量反编译所有已上传的文件...`, 'info');
        this.showProgress(0, 1, '批量反编译', `准备批量反编译 ${uploadResults.length} 个文件...`);
        
        try {
            // 调用批量反编译API
            const result = await this.batchDecompileFiles(options);
            
            // 设置执行状态，这样WebSocket消息才能被正确处理
            this.executionId = result.executionId;
            this.isProcessing = true;
            
            // 更新按钮状态
            this.uploadBtn.disabled = true;
            this.uploadBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 批量反编译进行中...';
            
            this.hideProgress();
        } catch (error) {
            this.hideProgress();
            this.addLog(`❌ 批量反编译启动失败: ${error.message}`, 'error');
            this.showStatus(`批量反编译失败`, 'error');
            
            // 如果批量反编译失败，显示失败的文件详情
            const totalFailed = uploadFailedFiles.length;
            if (totalFailed > 0) {
                uploadFailedFiles.forEach(failed => {
                    this.addLog(`❌ 上传失败 ${failed.name}: ${failed.error}`, 'error');
                });
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
    splitPath(filePath) {
        if (!filePath) return [];
        
        // 处理不同操作系统的路径分隔符
        // Windows: \ 或 /
        // macOS/Linux: /
        // 同时处理混合路径分隔符的情况
        return filePath.split(/[/\\]+/).filter(part => part.length > 0);
    }







    handleFolderSelect(files) {
        console.log('文件夹选择开始，文件数量:', files ? files.length : 0);
        
        // 清空之前的状态
        this.clearLogs();
        this.closeFileSelectionModal();
        
        if (!files || files.length === 0) {
            this.addLog('❌ 错误: 文件夹为空或无法访问', 'error');
            return;
        }

        // 转换为数组并过滤 .wxapkg 文件
        const fileArray = Array.from(files);
        const wxapkgFiles = fileArray.filter(file => 
            file.name.toLowerCase().endsWith('.wxapkg')
        );

        if (wxapkgFiles.length === 0) {
            this.addLog('❌ 错误: 选择的文件夹中没有找到 .wxapkg 文件', 'error');
            return;
        }

        // 更新选择的文件（先复制后再清空 input）
        this.selectedFiles = wxapkgFiles;
        // 现在可以安全地清空 input 值，避免影响 FileList
        this.folderInput.value = '';
        
        // 启用上传按钮
        this.uploadBtn.disabled = false;
        this.downloadBtn.disabled = true;

        // 显示成功信息
        const totalSize = wxapkgFiles.reduce((sum, file) => sum + file.size, 0);
        this.addLog(`✅ 成功选择文件夹，找到 ${wxapkgFiles.length} 个 .wxapkg 文件 (总大小: ${this.formatFileSize(totalSize)})`, 'success');
        
        this.showStatus(`已选择 ${wxapkgFiles.length} 个 .wxapkg 文件`, 'success');
        

        
        console.log('文件夹选择完成，有效文件数:', wxapkgFiles.length);
    }

    showFileSelectionOptions() {
        // 检查是否已经有弹窗存在，避免多层模态框
        if (document.getElementById('fileSelectionModal')) {
            return;
        }

        // 创建简单的选择界面，设置唯一ID
        const overlay = document.createElement('div');
        overlay.id = 'fileSelectionModal';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 1000;
        `;

        const dialog = document.createElement('div');
        dialog.style.cssText = `
            background: white;
            padding: 30px;
            border-radius: 10px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
            text-align: center;
            max-width: 400px;
            width: 90%;
        `;

        dialog.innerHTML = `
            <h3 style="margin: 0 0 20px 0; color: #333;">选择上传方式</h3>
            <div style="display: flex; flex-direction: column; gap: 12px;">
                <button id="selectFolder" style="
                    padding: 12px 20px;
                    border: 2px solid #17a2b8;
                    background: #17a2b8;
                    color: white;
                    border-radius: 8px;
                    cursor: pointer;
                    font-size: 15px;
                    transition: all 0.3s;
                ">📁 选择文件夹</button>
                <div style="margin: 10px 0; padding: 10px; background: #e8f4fd; border-radius: 6px; font-size: 13px; color: #0c5460; text-align: left;">
                    • 支持批量处理多个 .wxapkg 文件<br>
                </div>
                <div style="margin: 10px 0; padding: 10px; background: #f8f9fa; border-radius: 6px; font-size: 13px; color: #666; text-align: left;">
                    <strong>使用提示：💡</strong><br>
                    • <strong>拖拽</strong>：直接将文件夹拖到上传区域<br>
                </div>
                <button id="cancelSelection" style="
                    padding: 8px 20px;
                    border: 1px solid #ccc;
                    background: #f8f9fa;
                    color: #666;
                    border-radius: 8px;
                    cursor: pointer;
                    font-size: 14px;
                ">取消</button>
            </div>
        `;

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        // 添加事件监听器
        document.getElementById('selectFolder').addEventListener('click', () => {
            this.folderInput.click();
        });

        document.getElementById('cancelSelection').addEventListener('click', () => {
            this.closeFileSelectionModal();
        });

        // 点击背景关闭
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                this.closeFileSelectionModal();
            }
        });
    }

    closeFileSelectionModal() {
        const modal = document.getElementById('fileSelectionModal');
        if (modal) {
            document.body.removeChild(modal);
        }
    }

    async handleDroppedFiles(files, dataTransferItems = null) {
        // 清空之前的日志
        this.clearLogs();
        
        this.addLog(`📂 拖拽检测: 开始处理拖拽内容`, 'info');
        
        // 如果有 DataTransferItems，尝试使用高级API处理文件夹
        if (dataTransferItems && dataTransferItems.length > 0) {
            try {
                const allFiles = await this.processDataTransferItems(dataTransferItems);
                if (allFiles.length > 0) {
                    this.processExtractedFiles(allFiles);
                    return;
                }
            } catch (error) {
                this.addLog(`⚠️ 高级API处理失败: ${error.message}`, 'warning');
                this.addLog(`🔄 回退到基础文件处理模式`, 'info');
            }
        }
        
        // 回退到基础文件处理
        this.processBasicFiles(files);
    }

    async processDataTransferItems(items) {
        const allFiles = [];
        
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.kind === 'file') {
                const entry = item.webkitGetAsEntry();
                if (entry) {
                    if (entry.isDirectory) {
                        const folderFiles = await this.readDirectoryRecursively(entry, entry.name);
                        allFiles.push(...folderFiles);
                    } else if (entry.isFile) {
                        this.addLog(`📄 处理文件: ${entry.name}`, 'info');
                        const file = await this.getFileFromEntry(entry);
                        if (file) {
                            // 为单个文件也设置路径信息
                            try {
                                Object.defineProperty(file, 'webkitRelativePath', {
                                    value: entry.name,
                                    writable: false,
                                    enumerable: true,
                                    configurable: true
                                });
                            } catch (pathError) {
                                file.relativePath = entry.name;
                            }
                            allFiles.push(file);
                        }
                    }
                }
            }
        }
        
        return allFiles;
    }

    async readDirectoryRecursively(directoryEntry, path = '') {
        const files = [];
        
        return new Promise((resolve, reject) => {
            const reader = directoryEntry.createReader();
            
            const readEntries = () => {
                reader.readEntries(async (entries) => {
                    if (entries.length === 0) {
                        resolve(files);
                        return;
                    }
                    
                    try {
                        for (const entry of entries) {
                            const currentPath = path ? `${path}/${entry.name}` : entry.name;
                            
                            if (entry.isFile) {
                                try {
                                    const file = await this.getFileFromEntry(entry);
                                    if (file) {
                                        // 添加相对路径信息 - 使用Object.defineProperty因为webkitRelativePath是只读的
                                        try {
                                            Object.defineProperty(file, 'webkitRelativePath', {
                                                value: currentPath,
                                                writable: false,
                                                enumerable: true,
                                                configurable: true
                                            });
                                        } catch (pathError) {
                                            // 如果无法设置webkitRelativePath，添加自定义属性
                                            file.relativePath = currentPath;
                                        }
                                        files.push(file);
                                        
                                        // 只记录 .wxapkg 文件
                                        if (file.name.toLowerCase().endsWith('.wxapkg')) {
                                            this.addLog(`📄 发现 .wxapkg 文件: ${currentPath} (${this.formatFileSize(file.size)})`, 'success');
                                        }
                                    }
                                } catch (error) {
                                    this.addLog(`❌ 文件读取异常: ${currentPath} - ${error.message}`, 'error');
                                }
                            } else if (entry.isDirectory) {
                                try {
                                    const subFiles = await this.readDirectoryRecursively(entry, currentPath);
                                    files.push(...subFiles);
                                } catch (error) {
                                    this.addLog(`❌ 子目录处理失败: ${currentPath} - ${error.message}`, 'error');
                                }
                            }
                        }
                        
                        // 继续读取更多条目（某些浏览器分批返回）
                        readEntries();
                    } catch (error) {
                        this.addLog(`❌ 处理目录条目时出错: ${path || directoryEntry.name} - ${error.message}`, 'error');
                        reject(error);
                    }
                }, (error) => {
                    this.addLog(`❌ 读取目录失败: ${path || directoryEntry.name} - ${error.message}`, 'error');
                    reject(error);
                });
            };
            
            readEntries();
        });
    }

    async getFileFromEntry(fileEntry) {
        return new Promise((resolve, reject) => {
            fileEntry.file(resolve, reject);
        });
    }

    processExtractedFiles(allFiles) {
        // 过滤 .wxapkg 文件
        const wxapkgFiles = allFiles.filter(file => {
            const fileName = file.name.toLowerCase();
            return fileName.endsWith('.wxapkg');
        });

        if (wxapkgFiles.length === 0) {
            this.addLog('❌ 错误: 拖拽的内容中没有找到 .wxapkg 文件', 'error');
            this.showStatus('未找到 .wxapkg 文件', 'error');
            return;
        }

        // 设置选择的文件
        this.selectedFiles = wxapkgFiles;
        this.uploadBtn.disabled = false;
        this.downloadBtn.disabled = true;

        // 显示成功信息
        const totalSize = wxapkgFiles.reduce((sum, file) => sum + file.size, 0);
        this.addLog(`✅ 成功选择文件夹，找到 ${wxapkgFiles.length} 个 .wxapkg 文件 (总大小: ${this.formatFileSize(totalSize)})`, 'success');
        
        this.showStatus(`已选择 ${wxapkgFiles.length} 个 .wxapkg 文件`, 'success');


    }

    processBasicFiles(files) {
        // 检查拖拽的文件类型
        const fileArray = Array.from(files);
        
        this.addLog(`📂 基础模式: 共接收到 ${fileArray.length} 个项目`, 'info');
        
        // 检查是否有 .wxapkg 文件（大小写不敏感）
        const wxapkgFiles = fileArray.filter(file => {
            const fileName = file.name.toLowerCase();
            const isWxapkg = fileName.endsWith('.wxapkg');
            this.addLog(`  检查: "${file.name}" -> ${isWxapkg ? '✅ 是 .wxapkg 文件' : '❌ 不是 .wxapkg 文件'}`, 'info');
            return isWxapkg;
        });
        
        this.addLog(`🔍 找到 ${wxapkgFiles.length} 个 .wxapkg 文件`, 'info');
        
        if (wxapkgFiles.length === 1 && fileArray.length === 1) {
            // 单个 .wxapkg 文件
            this.addLog('📄 处理方式: 单个文件模式', 'info');
            this.selectedFiles = [wxapkgFiles[0]];
            this.uploadBtn.disabled = false;
            this.downloadBtn.disabled = true;
            this.addLog(`✅ 已选择文件: ${wxapkgFiles[0].name}`, 'success');
            this.showStatus(`已选择文件: ${wxapkgFiles[0].name}`, 'success');
            

        } else if (wxapkgFiles.length > 0) {
            // 多个 .wxapkg 文件或混合文件
            this.addLog('📁 处理方式: 多文件模式', 'info');
            this.selectedFiles = wxapkgFiles;
            this.uploadBtn.disabled = false;
            this.downloadBtn.disabled = true;
            
            const totalSize = wxapkgFiles.reduce((sum, file) => sum + file.size, 0);
            this.addLog(`✅ 已选择 ${wxapkgFiles.length} 个 .wxapkg 文件 (总大小: ${this.formatFileSize(totalSize)})`, 'success');
            this.showStatus(`已选择 ${wxapkgFiles.length} 个 .wxapkg 文件`, 'success');
            
            // 列出所有选择的文件
            wxapkgFiles.forEach(file => {
                this.addLog(`  📄 ${file.name} (${this.formatFileSize(file.size)})`, 'info');
            });
            

        } else {
            // 没有 .wxapkg 文件
            this.showStatus('拖拽的文件中没有找到 .wxapkg 文件', 'error');
            this.addLog('❌ 错误: 拖拽的文件中没有找到 .wxapkg 文件', 'error');
            this.addLog('💡 提示: 请拖拽 .wxapkg 文件，或使用文件夹选择按钮选择包含 .wxapkg 文件的文件夹', 'info');
        }
    }

    // 显示文件夹编译选项
    showFolderCompileOption() {
        this.folderCompileBtn.style.display = 'inline-block';
        this.addLog('💡 提示: 您可以使用文件夹编译功能对上传的文件进行批量编译', 'info');
    }

    // 显示文件夹编译模态框
    showFolderCompileModal() {
        this.folderCompileModal.style.display = 'block';
        this.folderPathInput.focus();
    }

    // 隐藏文件夹编译模态框
    hideFolderCompileModal() {
        this.folderCompileModal.style.display = 'none';
        // 清空输入
        this.folderPathInput.value = '';
        this.folderPxOption.checked = false;
        this.folderUnpackOnlyOption.checked = false;

    }

    // 开始文件夹编译
    async startFolderCompilation() {
        const folderPath = this.folderPathInput.value.trim();
        
        if (!folderPath) {
            this.addLog('❌ 请输入文件夹路径', 'error');
            return;
        }

        // 构建编译选项
        const options = [];
        
        if (this.folderPxOption.checked) {
            options.push('--px');
        }
        
        if (this.folderUnpackOnlyOption.checked) {
            options.push('--unpack-only');
        }
        


        this.hideFolderCompileModal();
        this.addLog(`🚀 开始文件夹编译: ${folderPath}`, 'info');
        
        if (options.length > 0) {
            this.addLog(`📋 编译选项: ${options.join(' ')}`, 'info');
        }

        try {
            const response = await fetch(`/api/workspaces/${this.currentWorkspaceId}/compile-folder`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    folderPath: folderPath,
                    options: options
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || '文件夹编译请求失败');
            }

            const result = await response.json();
            this.addLog(`✅ 文件夹编译已启动，执行ID: ${result.executionId}`, 'success');
            
        } catch (error) {
            this.addLog(`❌ 文件夹编译失败: ${error.message}`, 'error');
            console.error('文件夹编译错误:', error);
        }
    }

    async batchDecompileFiles(options) {
        if (!this.currentWorkspaceId) {
            throw new Error('工作区未创建');
        }

        const response = await fetch(`/api/workspaces/${this.currentWorkspaceId}/batch-decompile`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                options: options
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || '批量反编译请求失败');
        }

        const result = await response.json();
        this.addLog(`✅ 批量反编译已启动，执行ID: ${result.executionId}`, 'success');
        this.addLog(`📊 将处理 ${result.fileCount} 个文件`, 'info');
        
        return result;
    }
}

// 初始化应用
document.addEventListener('DOMContentLoaded', () => {
    new WedecodeApp();
});
