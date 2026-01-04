const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 3000;

// 编译脚本路径 - 检查路径是否存在
const COMPILE_SCRIPT = '/xx/xx/xx/run-script.sh';

// 检查必要文件和路径是否存在
function checkPrerequisites() {
    console.log('检查预配置...');
    
    // 检查编译脚本是否存在
    if (!fs.existsSync(COMPILE_SCRIPT)) {
        console.error(`错误: 编译脚本不存在: ${COMPILE_SCRIPT}`);
        console.log('请确保脚本路径正确，或修改COMPILE_SCRIPT变量');
        return false;
    }
    
    // 检查编译脚本是否有执行权限
    try {
        fs.accessSync(COMPILE_SCRIPT, fs.constants.X_OK);
    } catch (err) {
        console.error(`错误: 编译脚本没有执行权限: ${COMPILE_SCRIPT}`);
        console.log('请执行: chmod +x ' + COMPILE_SCRIPT);
        return false;
    }
    
    // 检查index.html是否存在
    const indexPath = path.join(__dirname, 'index.html');
    if (!fs.existsSync(indexPath)) {
        console.error(`错误: index.html不存在: ${indexPath}`);
        return false;
    }
    
    console.log('预配置检查通过 ✓');
    return true;
}

// 获取本地IP地址
function getLocalIPAddress() {
    const os = require('os');
    const interfaces = os.networkInterfaces();
    for (const iface of Object.values(interfaces)) {
        for (const config of iface) {
            if (config.family === 'IPv4' && !config.internal) {
                return config.address;
            }
        }
    }
    return 'localhost';
}

const server = http.createServer((req, res) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    
    // 设置CORS头
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }
    
    // 首页 - 返回HTML页面
    if (req.url === '/' || req.url === '/index.html') {
        const indexPath = path.join(__dirname, 'index.html');
        fs.readFile(indexPath, (err, data) => {
            if (err) {
                console.error('读取index.html失败:', err);
                res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('错误: 无法加载页面\n' + err.message);
                return;
            }
            res.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-cache'
            });
            res.end(data);
        });
        return;
    }
    
    // 执行编译脚本的API端点
    if (req.url.startsWith('/compile')) {
        // 检查编译脚本是否存在
        if (!fs.existsSync(COMPILE_SCRIPT)) {
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(`错误: 编译脚本不存在: ${COMPILE_SCRIPT}\n请检查服务器配置。`);
            return;
        }
        
        // 解析参数
        const urlParams = new URL(req.url, `http://${req.headers.host}`);
        const type = urlParams.searchParams.get('type');
        const version = urlParams.searchParams.get('version');
        const push = urlParams.searchParams.get('push') === 'true';
        const desc = urlParams.searchParams.get('desc') || `自动编译推送 ${type} ${version}`;
        
        if (!type || !version) {
            res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('缺少参数：需要 type 和 version\n例如：/compile?type=android&version=2.5.3');
            return;
        }
        
        // 验证参数
        const validTypes = ['android', 'ios'];
        const validVersions = {
            android: ['2.4.9', '2.5.3'],
            ios: ['2.0.5', '2.5.3']
        };
        
        if (!validTypes.includes(type)) {
            res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(`无效的编译类型: ${type}\n支持的类型: ${validTypes.join(', ')}`);
            return;
        }
        
        if (!validVersions[type].includes(version)) {
            res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(`无效的版本号: ${version}\n${type}支持的版本: ${validVersions[type].join(', ')}`);
            return;
        }
        
        // 设置流式响应头
        res.writeHead(200, {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-cache',
            'Transfer-Encoding': 'chunked',
            'X-Content-Type-Options': 'nosniff'
        });
        
        // 构建环境变量
        const env = { ...process.env };
        if (push) {
            env.AUTO_PUSH = 'true';
            env.HOT_UPDATE_DESCRIPTION = desc;
        }
        
        console.log(`开始执行编译: ${type} ${version}, push: ${push}, desc: ${desc}`);
        
        try {
            // 使用spawn执行脚本
            const child = spawn(COMPILE_SCRIPT, [type, version], {
                cwd: path.dirname(COMPILE_SCRIPT),
                env: env,
                shell: true
            });
            
            // 设置超时（20分钟）
            const timeout = 20 * 60 * 1000;
            let timeoutId = setTimeout(() => {
                console.log('编译超时，终止进程');
                child.kill('SIGKILL');
                res.write('\n\n❌ 编译超时（超过20分钟）\n');
                res.end();
            }, timeout);
            
            // 发送数据到客户端
            const sendToClient = (data, isError = false) => {
                try {
                    const prefix = isError ? '❌ ' : '';
                    const lines = data.toString().split('\n');
                    lines.forEach(line => {
                        if (line.trim()) {
                            res.write(prefix + line + '\n');
                        }
                    });
                } catch (e) {
                    console.error('发送数据到客户端失败:', e);
                }
            };
            
            // 处理标准输出
            child.stdout.on('data', (data) => {
                sendToClient(data, false);
            });
            
            // 处理错误输出
            child.stderr.on('data', (data) => {
                sendToClient(data, true);
            });
            
            // 处理进程结束
            child.on('close', (code) => {
                clearTimeout(timeoutId);
                console.log(`编译进程结束，退出码: ${code}`);
                
                if (code === 0) {
                    res.write('\n✅ 编译成功完成！\n');
                } else {
                    res.write(`\n❌ 编译失败，退出码: ${code}\n`);
                }
                
                res.end();
            });
            
            // 处理错误
            child.on('error', (error) => {
                clearTimeout(timeoutId);
                console.error('执行编译脚本错误:', error);
                res.write(`❌ 执行错误: ${error.message}\n`);
                res.end();
            });
            
            // 处理客户端断开连接
            req.on('close', () => {
                clearTimeout(timeoutId);
                if (!child.killed) {
                    console.log('客户端断开连接，终止编译进程');
                    child.kill('SIGKILL');
                }
            });
            
        } catch (error) {
            console.error('启动编译进程失败:', error);
            res.write(`❌ 启动编译失败: ${error.message}\n`);
            res.end();
        }
        
        return;
    }
    
    // 404 页面
    res.writeHead(404);
    res.end('Not Found');
});

// 检查预配置
if (!checkPrerequisites()) {
    console.error('预配置检查失败，请解决问题后再启动服务器。');
    process.exit(1);
}

// 启动服务器
server.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ 服务器已启动`);
    console.log(`📁 本地访问: http://localhost:${PORT}`);
    console.log(`🌐 网络访问: http://${getLocalIPAddress()}:${PORT}`);
    console.log(`🛠️  编译脚本: ${COMPILE_SCRIPT}`);
    console.log('\n按 Ctrl+C 停止服务器');
}).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`❌ 端口 ${PORT} 已被占用，请尝试以下方法:`);
        console.log(`1. 使用其他端口: PORT=3001 node server.js`);
        console.log(`2. 停止占用端口的进程:`);
        console.log(`   sudo lsof -i :${PORT}`);
        console.log(`   sudo kill -9 <PID>`);
        console.log(`3. 修改server.js中的PORT常量`);
    } else {
        console.error('❌ 启动服务器失败:', err);
    }
    process.exit(1);
});

// 处理退出信号
process.on('SIGINT', () => {
    console.log('\n🛑 收到停止信号，关闭服务器...');
    server.close(() => {
        console.log('✅ 服务器已关闭');
        process.exit(0);
    });
    
    // 5秒后强制退出
    setTimeout(() => {
        console.log('⚠️  强制退出');
        process.exit(1);
    }, 5000);
});

// 处理未捕获的异常
process.on('uncaughtException', (err) => {
    console.error('未捕获的异常:', err);
    console.log('服务器将继续运行...');
});