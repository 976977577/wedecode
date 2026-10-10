/**
 * Wedecode 可视化界面
 *
 * 三状态设计:
 * 1. 空态     —— 只有扫描入口
 * 2. 结果列表 —— 每行一个包, 直接点「反编译」
 * 3. 日志弹窗 —— 点反编译后弹出, 实时显示编译过程;
 *               编译中关闭弹窗则后台继续, 列表行角标显示状态,
 *               点角标可随时重开日志窗回看 (日志按 executionId 缓存)。
 */
class WedecodeApp {
    constructor() {
        this.packages = [];          // 扫描到的小程序包
        this.rowRefs = [];           // 每行 DOM 引用 { row, badge, compileBtn, session }

        this.workspaceId = null;
        this.workspacePath = null;
        this.socket = null;

        // 一次只允许一个编译任务 (后端多个执行共用同一 OUTPUT 目录, 并发会互相覆盖产物)
        this.isCompiling = false;
        this.isScanning = false;

        // executionId -> session { status, lines, pkgIndex, pkgName, executionId }
        this.sessions = new Map();
        // HTTP 响应到达前的日志缓冲 (服务端日志可能先于响应返回)
        this.pendingSession = null;

        this.modalSession = null;    // 当前日志弹窗展示的 session

        this.initElements();
        this.bindEvents();
        this.connectWebSocket();
    }

    initElements() {
        // 空态
        this.emptyState = document.getElementById('emptyState');
        this.scanEntryBtn = document.getElementById('scanEntryBtn');

        // 扫描结果
        this.scanSection = document.getElementById('scanSection');
        this.scanBody = document.getElementById('scanBody');
        this.scanCount = document.getElementById('scanCount');
        this.rescanBtn = document.getElementById('rescanBtn');

        // 日志弹窗
        this.logModal = document.getElementById('logModal');
        this.logStatusDot = document.getElementById('logStatusDot');
        this.logTitle = document.getElementById('logTitle');
        this.logView = document.getElementById('logView');
        this.copyLogBtn = document.getElementById('copyLogBtn');
        this.closeLogBtn = document.getElementById('closeLogBtn');
        this.logFooter = document.getElementById('logFooter');
        this.openDirBtn = document.getElementById('openDirBtn');
        this.downloadZipBtn = document.getElementById('downloadZipBtn');
        this.clearOutputBtn = document.getElementById('clearOutputBtn');
    }

    bindEvents() {
        this.scanEntryBtn?.addEventListener('click', () => this.handleScan());
        this.rescanBtn?.addEventListener('click', () => this.handleScan());

        // 日志弹窗: 关闭 = 后台继续编译, 不终止
        this.closeLogBtn?.addEventListener('click', () => this.closeLogModal());
        this.logModal?.addEventListener('click', (e) => {
            if (e.target === this.logModal) this.closeLogModal();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !this.logModal.classList.contains('hidden')) {
                this.closeLogModal();
            }
        });

        this.copyLogBtn?.addEventListener('click', () => this.copyCurrentLog());
        this.openDirBtn?.addEventListener('click', () => this.openOutputDir());
        this.downloadZipBtn?.addEventListener('click', () => this.downloadZip());
        this.clearOutputBtn?.addEventListener('click', () => this.clearOutput());
    }

    /* ==================== 扫描 ==================== */

    /**
     * 扫描本机已安装的小程序包。GET /api/scan 为纯查询, 无副作用。
     */
    async handleScan() {
        if (this.isScanning) return;
        this.isScanning = true;

        this.scanEntryBtn.disabled = true;
        this.rescanBtn.disabled = true;
        this.emptyState.classList.add('hidden'); // 首次扫描后空态永久退场
        this.scanSection.classList.remove('hidden');
        this.scanCount.textContent = '';
        this.scanBody.innerHTML = `
            <div class="scan-loading"><i class="fas fa-spinner fa-spin"></i>正在扫描本机小程序缓存, 请稍候...</div>
        `;

        try {
            const res = await fetch('/api/scan');
            const data = await res.json();
            if (!res.ok || !data.success) {
                this.renderScanError(data.message || data.error || '扫描失败');
                return;
            }
            this.packages = data.packages || [];
            this.renderScanResult(data);
        } catch (err) {
            this.renderScanError(err.message || String(err));
        } finally {
            this.isScanning = false;
            this.scanEntryBtn.disabled = false;
            this.rescanBtn.disabled = false;
        }
    }

    renderScanError(message) {
        this.packages = [];
        this.rowRefs = [];
        this.scanCount.textContent = '';
        this.scanBody.innerHTML = `
            <div class="scan-hint">扫描失败: ${this.escapeHtml(message)}</div>
        `;
    }

    renderScanResult(data) {
        const packages = this.packages;
        const pathList = data.scannedPathList || [];

        if (!packages.length) {
            // 没扫到时把「为什么」和「怎么办」说清楚, 而不是只丢一个空列表
            const pathsHtml = pathList.length
                ? `<div class="scan-paths">已查找:<br>${pathList.map(p => `<code>${this.escapeHtml(p)}</code>`).join('<br>')}</div>`
                : '';
            this.rowRefs = [];
            this.scanCount.textContent = '';
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

        const items = packages.map((pkg, index) => {
            // 头像文字: appid 去掉 wx 前缀后的前两位
            const iconText = String(pkg.appId).replace(/^wx/i, '').slice(0, 2).toUpperCase() || 'WX';

            // 图标来自微信本地缓存(纯本地, 不联网)。默认只显示中性色块+文字,
            // 图片真正加载成功(onload)后才显示并盖住文字; 加载失败/缓存里没有
            // 则保持色块, 不会出现破图。统一灰调, 避免和真图标混排时花花绿绿。
            const iconInner = pkg.hasIcon
                ? `<span class="icon-fallback">${this.escapeHtml(iconText)}</span>`
                  + `<img class="icon-img" src="/api/applet-icon?appid=${encodeURIComponent(pkg.appId)}" alt="" `
                  + `style="display:none" onload="this.style.display='block';this.previousElementSibling.style.display='none'">`
                : this.escapeHtml(iconText);

            // 第二行只放有信息量的内容: 版本号 + 时间(去秒)。
            // 路径尾部就是 appid 本身, 平铺出来只是噪音, 完整路径挪到行悬浮提示。
            const segs = String(pkg.storagePath).replace(/\/+$/, '').split('/');
            const version = segs[segs.length - 1] || '1';
            const shortTime = String(pkg.updateDate).replace(/:\d\d$/, '');

            return `
            <li class="pkg-row" title="${this.escapeHtml(pkg.storagePath)}">
                <div class="pkg-icon">${iconInner}</div>
                <div class="pkg-main">
                    <div class="pkg-name"><span class="appid-text">${this.escapeHtml(pkg.appId)}</span></div>
                    <div class="pkg-meta"><span class="ver">v${this.escapeHtml(version)}</span><span>${this.escapeHtml(shortTime)}</span></div>
                </div>
                <div class="pkg-side">
                    <span class="pkg-badge" title="点击查看反编译日志"></span>
                    <button type="button" class="btn-decompile compile-btn">
                        <i class="fas fa-play"></i> 反编译
                    </button>
                </div>
            </li>
            `;
        }).join('');

        this.scanCount.innerHTML = `找到 <strong>${packages.length}</strong> 个包`;
        this.scanBody.innerHTML = `<ul class="pkg-list">${items}</ul>`;

        // 收集行内元素引用, 后续只更新角标, 不整块重绘
        this.rowRefs = Array.from(this.scanBody.querySelectorAll('.pkg-row')).map((row, index) => {
            const badge = row.querySelector('.pkg-badge');
            const compileBtn = row.querySelector('.compile-btn');
            compileBtn.addEventListener('click', () => this.startCompile(index));
            badge.addEventListener('click', () => {
                const session = this.rowRefs[index]?.session;
                if (session) this.openLogModal(session);
            });
            return { row, badge, compileBtn, session: null };
        });
    }

    /* ==================== 反编译 ==================== */

    async startCompile(index) {
        const pkg = this.packages[index];
        const ref = this.rowRefs[index];
        if (!pkg || !ref || this.isCompiling) return;

        this.isCompiling = true;
        this.setCompileUI(true);

        // 编译会话先建立, HTTP 响应回来前收到的日志先缓冲在 session 里
        const session = {
            status: 'running',
            lines: [],
            pkgIndex: index,
            pkgName: pkg.appName || pkg.appId,
            executionId: null
        };
        ref.session = session;
        this.pendingSession = session;
        this.setBadge(ref, 'running');
        this.openLogModal(session);

        try {
            const workspace = await this.ensureWorkspace();
            const res = await fetch(`/api/workspaces/${workspace.id}/compile-folder`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ folderPath: pkg.storagePath, options: [] })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || '启动失败');

            if (data.executionId) {
                session.executionId = data.executionId;
                this.sessions.set(data.executionId, session);
            }
            // 编译是异步子进程, 收尾由 WebSocket 的 exit 事件负责
        } catch (err) {
            const msg = err.message || String(err);
            session.status = 'error';
            session.executionId = null;
            this.appendLog(session, '反编译启动失败: ' + msg, 'error');
            this.finishCompile(session, 'error');
        } finally {
            this.pendingSession = null;
        }
    }

    /**
     * 编译结束 (成功/失败/启动失败) 的统一收尾。
     */
    finishCompile(session, status) {
        this.isCompiling = false;
        this.setCompileUI(false);

        const ref = this.rowRefs[session.pkgIndex];
        if (ref) this.setBadge(ref, status);

        // 弹窗如果正展示该 session, 刷新头部状态与产物操作区
        if (this.modalSession === session) {
            this.refreshModalChrome();
        }
    }

    setCompileUI(compiling) {
        this.rowRefs.forEach(ref => { if (ref) ref.compileBtn.disabled = compiling; });
        this.rescanBtn.disabled = compiling; // 重扫会重绘列表、丢失角标, 编译中禁用
    }

    setBadge(ref, status) {
        if (!ref?.badge) return;
        const icons = {
            running: '<i class="fas fa-spinner fa-spin"></i>',
            success: '<i class="fas fa-check"></i>',
            error: '<i class="fas fa-xmark"></i>'
        };
        const titles = {
            running: '反编译进行中, 点击查看日志',
            success: '反编译完成, 点击查看日志',
            error: '反编译失败, 点击查看日志'
        };
        ref.badge.className = `pkg-badge show ${status}`;
        ref.badge.innerHTML = icons[status] || '';
        ref.badge.title = titles[status] || '';
    }

    /* ==================== 日志弹窗 ==================== */

    openLogModal(session) {
        this.modalSession = session;

        // 重放缓冲的全部日志
        this.logView.innerHTML = '';
        session.lines.forEach(line => this.appendLogLine(line.text, line.type));
        this.logView.scrollTop = this.logView.scrollHeight;

        this.refreshModalChrome();
        this.logModal.classList.remove('hidden');
    }

    closeLogModal() {
        this.logModal.classList.add('hidden');
        this.modalSession = null;
    }

    /**
     * 根据当前 modalSession 的状态刷新弹窗头部 (圆点/标题) 与底部操作区。
     */
    refreshModalChrome() {
        const session = this.modalSession;
        if (!session) return;

        const statusText = {
            running: '正在反编译',
            success: '反编译完成',
            error: '反编译失败'
        };
        this.logStatusDot.className = `status-dot ${session.status}`;
        this.logTitle.textContent = `${statusText[session.status] || ''} · ${session.pkgName}`;

        // 产物操作区只在编译成功后出现
        this.logFooter.classList.toggle('hidden', session.status !== 'success');
    }

    /**
     * 追加一条日志到 session 缓冲; 若弹窗正展示该 session 则同步渲染。
     */
    appendLog(session, text, type = 'info') {
        if (!session) return;
        String(text).split('\n').forEach(raw => {
            const line = raw.trim();
            if (!line) return;
            session.lines.push({ text: line, type });

            let logType = type;
            if (logType === 'info') {
                // 只有明确的错误标识才标记为 error, 避免误判文件名中包含 error 的情况
                if (line.includes('❌') || line.includes('错误:') || line.includes('Error:') ||
                    line.includes('失败') || line.includes('异常') || line.includes('Exception')) {
                    logType = 'error';
                } else if (line.includes('⚠️') || line.includes('警告:') || line.includes('Warning:')) {
                    logType = 'warning';
                } else if (line.includes('✅') || line.includes('🎉') || line.includes('成功') ||
                    line.includes('完成') || line.includes('Success') || line.includes('Completed')) {
                    logType = 'success';
                }
            }

            if (this.modalSession === session) {
                this.appendLogLine(line, logType);
                this.logView.scrollTop = this.logView.scrollHeight;
            }
        });
    }

    appendLogLine(text, type) {
        const el = document.createElement('div');
        el.className = `log-line ${type}`;
        el.textContent = text;
        this.logView.appendChild(el);
    }

    async copyCurrentLog() {
        if (!this.modalSession) return;
        const text = this.modalSession.lines.map(l => l.text).join('\n');

        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(text);
            } else {
                // 降级: 传统 execCommand
                const textArea = document.createElement('textarea');
                textArea.value = text;
                textArea.style.position = 'fixed';
                textArea.style.left = '-999999px';
                textArea.style.top = '-999999px';
                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
            }
            this.flashButton(this.copyLogBtn, '<i class="fas fa-check"></i> 已复制');
        } catch (err) {
            console.error('复制失败:', err);
            this.flashButton(this.copyLogBtn, '<i class="fas fa-xmark"></i> 复制失败');
        }
    }

    flashButton(btn, html) {
        const original = btn.innerHTML;
        btn.innerHTML = html;
        setTimeout(() => { btn.innerHTML = original; }, 2000);
    }

    /* ==================== 产物操作 ==================== */

    /**
     * 打开产物目录。
     *
     * 产物固定输出在 workspace.path/OUTPUT; 由服务端调用系统文件管理器打开,
     * 因此桌面版与浏览器访问都能用, 也不受工作区根目录所在位置影响。
     */
    async openOutputDir() {
        if (!this.workspaceId) return;

        this.openDirBtn.disabled = true;
        try {
            const res = await fetch(`/api/workspaces/${this.workspaceId}/open-output`, { method: 'POST' });
            const data = await res.json();
            if (!res.ok) {
                this.appendLog(this.modalSession, `打开产物目录失败: ${data.error || '未知错误'}`, 'error');
                alert('打开产物目录失败: ' + (data.error || '未知错误'));
            }
        } catch (err) {
            alert('打开产物目录失败: ' + (err.message || err));
        } finally {
            this.openDirBtn.disabled = false;
        }
    }

    /**
     * 清除本次构建产物 (删除 OUTPUT 目录), 便于重新编译。
     */
    async clearOutput() {
        if (!this.workspaceId) return;
        if (!window.confirm('确定清除本次反编译的产物吗?\n产物目录将被删除, 可重新反编译生成。')) return;

        this.clearOutputBtn.disabled = true;
        try {
            const res = await fetch(`/api/workspaces/${this.workspaceId}/output`, { method: 'DELETE' });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || '清除失败');

            const msg = data.removed ? '已清除本次构建产物' : (data.message || '产物目录不存在, 无需清理');
            if (this.modalSession) {
                this.appendLog(this.modalSession, msg, data.removed ? 'success' : 'info');
            }
            this.flashButton(this.clearOutputBtn, '<i class="fas fa-check"></i> 已清除');
        } catch (err) {
            const msg = err.message || String(err);
            if (this.modalSession) this.appendLog(this.modalSession, '清除产物失败: ' + msg, 'error');
            alert('清除产物失败: ' + msg);
        } finally {
            this.clearOutputBtn.disabled = false;
        }
    }

    async downloadZip() {
        if (!this.workspaceId) {
            alert('没有可下载的结果');
            return;
        }

        this.downloadZipBtn.disabled = true;
        try {
            const response = await fetch(`/api/workspaces/${this.workspaceId}/download`);
            if (!response.ok) {
                if (response.status === 404) throw new Error('未找到反编译结果, 请先完成反编译');
                throw new Error('下载失败');
            }

            let filename = `反编译结果_${new Date().toISOString().slice(0, 10)}.zip`;
            const contentDisposition = response.headers.get('Content-Disposition');
            if (contentDisposition) {
                const match = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
                if (match && match[1]) {
                    filename = decodeURIComponent(match[1].replace(/['"]/g, ''));
                }
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

            this.flashButton(this.downloadZipBtn, '<i class="fas fa-check"></i> 已下载');
        } catch (error) {
            alert('下载失败: ' + (error.message || error));
        } finally {
            this.downloadZipBtn.disabled = false;
        }
    }

    /* ==================== WebSocket ==================== */

    /**
     * 连接/断开/重连对用户是不可见的实现细节, 不进 UI;
     * 只有反编译进程的输出才会显示。
     */
    connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        this.socket = new WebSocket(`${protocol}//${window.location.host}`);

        this.socket.onopen = () => this.subscribeWorkspace();

        this.socket.onmessage = (event) => {
            try {
                this.handleWebSocketMessage(JSON.parse(event.data));
            } catch (error) {
                // 非 JSON 消息直接忽略
            }
        };

        this.socket.onclose = () => {
            // 静默重连, 编译日志在重连窗口内的丢失由 exit 事件兜底
            setTimeout(() => this.connectWebSocket(), 3000);
        };
    }

    /**
     * 订阅工作区事件。服务端按 client.workspaceId 定向广播,
     * 拿到真实 workspace id 后必须重新订阅, 否则编译日志一条都收不到。
     */
    subscribeWorkspace() {
        if (this.socket?.readyState !== 1 || !this.workspaceId) return;
        this.socket.send(JSON.stringify({
            type: 'subscribe',
            workspaceId: this.workspaceId
        }));
    }

    handleWebSocketMessage(data) {
        if (data.type !== 'execution') return;

        let session = data.executionId ? this.sessions.get(data.executionId) : null;

        // 竞态兜底: 服务端日志可能先于 compile-folder 的 HTTP 响应到达,
        // 此时 executionId 尚未登记 —— 由于编译被串行化, 未识别的日志
        // 只可能属于当前 pendingSession。
        if (!session && this.pendingSession && this.isCompiling) {
            session = this.pendingSession;
        }
        if (!session) return;

        if (data.event === 'output') {
            this.appendLog(session, data.data, 'info');
        } else if (data.event === 'error') {
            this.appendLog(session, data.data, 'error');
        } else if (data.event === 'exit') {
            const ok = data.code === 0;
            session.status = ok ? 'success' : 'error';
            this.appendLog(
                session,
                ok ? '反编译完成' : `反编译失败, 退出码: ${data.code}`,
                ok ? 'success' : 'error'
            );
            this.finishCompile(session, session.status);
        }
    }

    /* ==================== 工作区 ==================== */

    /**
     * 复用或创建工作区 (反编译产物按工作区隔离存放)。
     */
    async ensureWorkspace() {
        if (this.workspaceId) return { id: this.workspaceId, path: this.workspacePath };

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
        this.workspaceId = ws.id;
        this.workspacePath = ws.path;

        // 关键: 服务端按 workspaceId 定向广播, 拿到真实 id 后必须重新订阅
        this.subscribeWorkspace();

        return ws;
    }

    /* ==================== 工具 ==================== */

    escapeHtml(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new WedecodeApp();
});
