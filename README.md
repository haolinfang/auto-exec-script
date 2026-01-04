# auto-exec-script

################################################
# 使用pm2来启动server.js
# 安装pm2
npm install -g pm2

# 启动服务
pm2 start server.js --name "mobile-auto-push"

# 设置开机自启
pm2 startup
pm2 save

# 查看进程状态
pm2 status

# 查看日志
pm2 logs server

# 停止服务
pm2 stop server

# 重启服务
pm2 restart server

# 删除服务
pm2 delete server

################################################
# linux登录codepush
# code-push login --accessKey xxxxxxxx http://ip:port/xx
################################################
# 查看code-push-server服务器监听端口
# 执行sudo netstat -tulpn | grep node
# 输出tcp6 0 0 :::3000 :::* LISTEN 71111/node
# :::3000： 这表示您的 CodePush 服务器正监听在 3000 端口
# 执行curl -v http://xx.xx.xx.xx:3000/
################################################