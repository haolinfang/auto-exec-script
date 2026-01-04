#!/bin/bash

# 编译版本类型 android/ios
app_type=$1
# 编译版本号
app_version=$2

# 设置项目目录
proj_home="/xx/xx/xx/xx"
deve_folder=$proj_home
node_version=v14.19.0

# 支持的版本
android_versions="2.4.9&2.5.3"
ios_versions="2.0.5&2.5.3"

# git仓库地址
src_git_url="http://xx/xx/xx.git"
src_git_branch="CC"

# 输出带标记的信息
function log_info() {
    echo "[INFO] $1"
}

function log_success() {
    echo "[SUCCESS] $1"
}

function log_error() {
    echo "[ERROR] $1"
}

function log_warning() {
    echo "[WARNING] $1"
}

# 检查版本号是否在支持列表中
function check_version() {
    if [ "$app_type" == "android" ]; then
        if [[ ! "$android_versions" =~ "$app_version" ]]; then
            log_error "不支持的Android版本号 $app_version"
            echo "支持的版本：2.4.9, 2.5.3"
            exit -1
        fi
    elif [ "$app_type" == "ios" ]; then
        if [[ ! "$ios_versions" =~ "$app_version" ]]; then
            log_error "不支持的iOS版本号 $app_version"
            echo "支持的版本：2.0.5, 2.5.3"
            exit -1
        fi
    fi
}

# CodePush推送函数
function push_code_push() {
    local platform=$1
    local description="${HOT_UPDATE_DESCRIPTION:-自动编译推送}"
    
    log_info "开始推送 CodePush 热更新..."
    echo "平台: $platform"
    echo "部署环境: Production"
    echo "描述: $description"
    
    # 确定应用名称
    local code_push_app=""
    if [ "$platform" == "android" ]; then
        code_push_app="ncb-android"
    elif [ "$platform" == "ios" ]; then
        code_push_app="ncb-ios"
    else
        log_error "不支持的平台 $platform"
        return 1
    fi
    
    echo "检查 CodePush 登录状态..."
    if ! command -v code-push &> /dev/null; then
        log_error "未安装 code-push-cli"
        echo "请先执行: npm install -g code-push-cli"
        return 1
    fi
    
    if ! code-push whoami &> /dev/null; then
        log_error "未登录 CodePush"
        echo "请先执行: code-push login"
        return 1
    fi
    
    log_info "CodePush 登录状态正常"
    
    echo "执行 CodePush 发布命令..."
    echo "命令: code-push release-cordova $code_push_app $platform -d \"Production\" --des \"$description\""
    
    # 执行发布命令
    code-push release-cordova $code_push_app $platform -d "Production" --des "$description"
    
    local result=$?
    if [ $result -eq 0 ]; then
        log_success "CodePush 发布成功"
        return 0
    else
        log_error "CodePush 发布失败，错误码: $result"
        return 1
    fi
}

if [ $app_type != "android" ] && [ $app_type != "ios" ]; then 
    log_error "无法识别编译类型，参考命令 ./run-script.sh android 2.5.3"
    echo "或 ./run-script.sh ios 2.5.3"
    exit -1   
fi

if [ ! $app_version ]; then
    log_error "请传入编译的版本号.."
    if [ "$app_type" == "android" ]; then
        echo "支持的Android版本：2.4.9, 2.5.3"
    else
        echo "支持的iOS版本：2.0.5, 2.5.3"
    fi
    exit -1
fi

# 检查版本号是否支持
check_version

# 直接进入Deve目录
cd $deve_folder

log_info "开始编译 $app_type 版本 $app_version ..."

# 进入src目录并拉取mobile-bb.git的CC分支
if [ ! -d "src" ]; then
    log_info "src目录不存在，创建src目录..."
    mkdir src
fi

cd src

log_info "拉取mobile-bb.git的CC分支代码..."

# 检查是否已经是git仓库
if [ -d ".git" ]; then
    log_info "更新代码..."
    git pull origin $src_git_branch
else
    log_info "初始化并拉取代码..."
    git clone -b $src_git_branch $src_git_url .
fi

if [ $? -ne 0 ]; then
    log_error "拉取mobile-bb.git失败！"
    exit -1
fi

log_success "代码拉取完成"

# 返回Deve目录
cd ..

# 清理隐藏文件
find . -name '.DS*' 2>/dev/null | xargs rm -f 2>/dev/null
find . -name '__MACOSX' 2>/dev/null | xargs rm -rf 2>/dev/null
log_info "清理隐藏文件完成"

# 编译结果标志
COMPILE_SUCCESS=false
APK_FILE=""

if [ ${app_type} == "android" ]; then
    log_info "编译android版本 $app_version ..."    
    node --max_old_space_size=8192 /具体路径/ionic cordova build android --prod --release
    if [ $? -eq 0 ]; then
        COMPILE_SUCCESS=true
        if [ -d platforms/android/app/build/outputs/apk/release/ ]; then
            APK_FILE=$(find platforms/android/app/build/outputs/apk/release/ -name "*.apk" | head -1)
            if [ -n "$APK_FILE" ]; then
                log_success "编译成功！APK文件: $APK_FILE"
            fi
        fi
    else
        log_error "Android编译失败！"
        exit 1
    fi
else
    log_info "编译ios版本 $app_version ..."
    node --max_old_space_size=8192 /具体路径/ionic cordova prepare ios --prod
    if [ $? -eq 0 ]; then
        COMPILE_SUCCESS=true
        log_success "iOS编译准备完成"
    else
        log_error "iOS编译失败！"
        exit 1
    fi
fi

# 编译成功后推送 CodePush
if [ "$COMPILE_SUCCESS" = true ]; then
    echo "========================================="
    log_success "编译成功"
    echo "========================================="
    
    # 检查是否配置了自动推送
    if [ "$AUTO_PUSH" = "true" ]; then
        log_info "自动推送模式已启用，开始推送 CodePush 热更新"
        push_code_push "$app_type"
        
        if [ $? -eq 0 ]; then
            log_success "CodePush 热更新推送完成"
        else
            log_warning "CodePush 推送失败，但编译已完成"
        fi
    else
        log_info "CodePush 热更新推送已跳过 (未启用自动推送)"
    fi
fi

echo "========================================="
log_info "编译完成！"
echo "应用类型: $app_type"
echo "版本号: $app_version"
echo "部署环境: Production"
if [ -n "$APK_FILE" ]; then
    echo "APK文件: $APK_FILE"
fi
if [ "$AUTO_PUSH" = "true" ]; then
    echo "热更新推送: 已推送"
else
    echo "热更新推送: 已跳过"
fi
echo "========================================="